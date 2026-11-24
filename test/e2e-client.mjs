// e2e-client.mjs — headless E2E regression gate for the chess client (real UI:
// click-to-move + drag on the canvas), two guest players, one private match,
// server DEBUG=1.
//
// SEATING (contract 32): the LOBBY no longer creates the private match (that
// moved to the GAME page). The harness now opens a RAW socket.io client to the
// server, emits 'private-match', and reads the echoed matchId from the
// 'private-match' event (server event unchanged: the generator socket receives
// the id). It then disconnects that raw socket (its disconnect would otherwise
// end the pre-start match) and navigates BOTH guest pages to /game?matchId=<id>
// — the white page joins as white (host branch), the black page as black, and
// startGame fires on both.
//
// Requires (system deps — see the "test:e2e" script in package.json):
//   - a Chromium binary at /snap/bin/chromium
//   - a GLOBAL puppeteer-core install (resolved from
//     /root/.nvm/versions/node/v24.22.1/lib/node_modules; override with
//     E2E_PUPPETEER_ROOT)
//   Run:  node test/e2e-client.mjs   (env: E2E_PORT, E2E_SERVER_LOG)
//
// Coordinate model (matches the server engine + client layout.js): the board is
// stored as board[y][x] where x = file (a=0..h=7) and y = rank ROW (0 = rank 8
// = black back rank, 7 = rank 1). The SERVER always speaks these server
// coordinates. The BLACK page displays the board rotated 180 degrees, so its
// VISUAL coordinates are the 180-degree reflection of the server coordinates
// ({x:7-x, y:7-y}); the white page's visual coords ARE the server coords.
//
// Game (full scholar's mate with a castling detour; 11 half-moves):
//   1.e4 (DRAG, white)  1...e5 (DRAG, black)
//   2.Nh3 (click)  2...Nc6 (click)  3.Bc4 (click)  3...Be7 (click)
//   4.O-O (click, white — castling)  4...Nf6 (click)  5.Qh5 (click)  5...a6
//   6.Qxf7# (click, white)
// Asserted for EVERY move: a server DEBUG "move: APPLIED" line; BOTH pages'
// boards equal the expected server board (each page's board is normalised back
// to server orientation with its own ChessLayout.rotateBoard before comparing);
// en-passant indicator bits present after 1.e4 / 1...e5; the check indicator on
// the black king at mate. Also: the black page's initial board must equal
// ChessLayout.rotateBoard(start position) — the bug-A (onload/startGame race)
// regression; the king-selection highlight must include the O-O target square
// (closes the A2 harness's index-9 castling gap); an illegal-move probe
// (white e2->e5, blocked double push) -> server REJECTED + canvas shake; and
// no JS console errors.
//
// The `expected` boards are the exact positions the server engine produces for
// this move list (piece identity only, indicators stripped), so the sync check
// is exact. Two DRAG moves (1.e4, 1...e5) and nine CLICK moves are driven
// through the real canvas input path; the promotion-popup, REJECTED-shake and
// validated-overwrite flows are exercised by the game itself.
//
// Board state on the pages is read via window.__chessDebug (a tiny test-only
// hook in game.js); boards are normalised with the page's own
// ChessLayout.rotateBoard before comparison.
//
// Contract 38 rows (38A/38B/38C): takeback accept/decline UI (38A, 38B — one
// fresh guest match for both) and capture/check click sfx (38C1..38C3 — the
// sound pages install an evaluateOnNewDocument HTMLAudioElement.prototype.play
// stub pushing {src, t} into window.__played, so the rows count played
// click.mp3 entries). Every test gets a FRESH private match via the same
// raw-socket seating, so the rows are independent of the main game.

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const require = createRequire(import.meta.createRequire ? undefined : import.meta.url);
const PUPPETEER_ROOT = process.env.E2E_PUPPETEER_ROOT
  || '/root/.nvm/versions/node/v24.22.1/lib/node_modules';
const puppeteer = require(path.join(PUPPETEER_ROOT, 'puppeteer-core'));
// socket.io-client for the RAW harness socket (seating). Lives in the project's
// node_modules (a devDependency), so resolve it relative to the harness like the
// other require() calls — NOT the global puppeteer root. The UMD export is a
// function that is also its own namespace (io.default is undefined), so
// io(url, opts) is the constructor.
const io = require('socket.io-client');

const PORT = Number(process.env.E2E_PORT || 6321);
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_LOG = process.env.E2E_SERVER_LOG || '/tmp/e2e-client-server.log';
const REPORT_EVIDENCE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'checkpoints', 'e2e-client-evidence.json');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- coordinate facts (mirror of src/public/js/game.js / chessutils.js) ----------
const FILES = 'abcdefgh';
// server coords: x = file, y = rank row (0 = rank 8). e2 -> (4,6).
const toXY = (alg) => ({ x: FILES.indexOf(alg[0]), y: 8 - Number(alg[1]) });
// black-page visual coords = 180-degree rotation of server coords
const rot = (x, y) => ({ x: 7 - x, y: 7 - y });

// Expected server-orientation board (piece identity, indicators stripped) after
// each step of the game above. expected[0] = start; expected[i] = after move i.
// (Captured verbatim from a run of the server engine over the `plan` below.)
const expected = [
  [[12,14,13,11,10,13,14,12],[9,9,9,9,9,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[1,1,1,1,1,1,1,1],[4,6,5,3,2,5,6,4]],
  [[12,14,13,11,10,13,14,12],[9,9,9,9,9,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,1,0,0,0],[0,0,0,0,0,0,0,0],[1,1,1,1,0,1,1,1],[4,6,5,3,2,5,6,4]],
  [[12,14,13,11,10,13,14,12],[9,9,9,9,0,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,0,9,0,0,0],[0,0,0,0,1,0,0,0],[0,0,0,0,0,0,0,0],[1,1,1,1,0,1,1,1],[4,6,5,3,2,5,6,4]],
  [[12,14,13,11,10,13,14,12],[9,9,9,9,0,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,0,9,0,0,0],[0,0,0,0,1,0,0,0],[0,0,0,0,0,0,0,6],[1,1,1,1,0,1,1,1],[4,6,5,3,2,5,0,4]],
  [[12,0,13,11,10,13,14,12],[9,9,9,9,0,9,9,9],[0,0,14,0,0,0,0,0],[0,0,0,0,9,0,0,0],[0,0,0,0,1,0,0,0],[0,0,0,0,0,0,0,6],[1,1,1,1,0,1,1,1],[4,6,5,3,2,5,0,4]],
  [[12,0,13,11,10,13,14,12],[9,9,9,9,0,9,9,9],[0,0,14,0,0,0,0,0],[0,0,0,0,9,0,0,0],[0,0,5,0,1,0,0,0],[0,0,0,0,0,0,0,6],[1,1,1,1,0,1,1,1],[4,6,5,3,2,0,0,4]],
  [[12,0,13,11,10,0,14,12],[9,9,9,9,13,9,9,9],[0,0,14,0,0,0,0,0],[0,0,0,0,9,0,0,0],[0,0,5,0,1,0,0,0],[0,0,0,0,0,0,0,6],[1,1,1,1,0,1,1,1],[4,6,5,3,2,0,0,4]],
  [[12,0,13,11,10,0,14,12],[9,9,9,9,13,9,9,9],[0,0,14,0,0,0,0,0],[0,0,0,0,9,0,0,0],[0,0,5,0,1,0,0,0],[0,0,0,0,0,0,0,6],[1,1,1,1,0,1,1,1],[4,6,5,3,0,4,2,0]],
  [[12,0,13,11,10,0,0,12],[9,9,9,9,13,9,9,9],[0,0,14,0,0,14,0,0],[0,0,0,0,9,0,0,0],[0,0,5,0,1,0,0,0],[0,0,0,0,0,0,0,6],[1,1,1,1,0,1,1,1],[4,6,5,3,0,4,2,0]],
  [[12,0,13,11,10,0,0,12],[9,9,9,9,13,9,9,9],[0,0,14,0,0,14,0,0],[0,0,0,0,9,0,0,3],[0,0,5,0,1,0,0,0],[0,0,0,0,0,0,0,6],[1,1,1,1,0,1,1,1],[4,6,5,0,0,4,2,0]],
  [[12,0,13,11,10,0,0,12],[0,9,9,9,13,9,9,9],[9,0,14,0,0,14,0,0],[0,0,0,0,9,0,0,3],[0,0,5,0,1,0,0,0],[0,0,0,0,0,0,0,6],[1,1,1,1,0,1,1,1],[4,6,5,0,0,4,2,0]],
  [[12,0,13,11,10,0,0,12],[0,9,9,9,13,3,9,9],[9,0,14,0,0,14,0,0],[0,0,0,0,9,0,0,0],[0,0,5,0,1,0,0,0],[0,0,0,0,0,0,0,6],[1,1,1,1,0,1,1,1],[4,6,5,0,0,4,2,0]],
];

// Drive table: from/to in ALGEBRAIC; side 0=white 1=black; kind click|drag.
// The E-ill illegal probe is driven separately right after move 4 (black Nc6).
const plan = [
  { w: 'e2', b: 'e4', side: 0, kind: 'drag' },   // 1.  e4     -> EP on e5 (server (4,3))
  { w: 'e7', b: 'e5', side: 1, kind: 'drag' },   // 1... e5    -> EP on e4 (server (4,4))
  { w: 'g1', b: 'h3', side: 0, kind: 'click' },  // 2.  Nh3
  { w: 'b8', b: 'c6', side: 1, kind: 'click' },  // 2... Nc6
  { w: 'f1', b: 'c4', side: 0, kind: 'click' },  // 3.  Bc4
  { w: 'f8', b: 'e7', side: 1, kind: 'click' },  // 3... Be7
  { w: 'e1', b: 'g1', side: 0, kind: 'click', o0: true }, // 4.  O-O
  { w: 'g8', b: 'f6', side: 1, kind: 'click' },  // 4... Nf6
  { w: 'd1', b: 'h5', side: 0, kind: 'click' },  // 5.  Qh5
  { w: 'a7', b: 'a6', side: 1, kind: 'click' },  // 5... a6
  { w: 'h5', b: 'f7', side: 0, kind: 'click', mate: true }, // 6.  Qxf7#
];

// Indicator squares in SERVER coords (board[y][x]) to assert after each move.
// The server ORs INDICATOR_EN_PASSANT (0b1000000, src/index.js:33) onto the
// pawn's LANDED square after a double push (src/index.js:348-352:
// sentBoard[4][x] for white e2-e4, sentBoard[3][x] for black e7-e5), NOT the
// square behind the pawn. The previous expectation had the two constants
// swapped (e5 for e4 and vice versa) — corrected per the cited server lines;
// the bit constant itself (0b1000000) was already correct.
const EP_AFTER_E4 = { x: 4, y: 4 };  // e4 = landed square after white 1.e4 (src/index.js:349)
const EP_AFTER_E5 = { x: 4, y: 3 };  // e5 = landed square after black 1...e5 (src/index.js:352)
const CHECK_AT_MATE = { x: 4, y: 0 }; // e8 (black king)

const rows = [];
const logRow = (test, status, detail) => {
  rows.push({ test, status, detail: String(detail).slice(0, 400) });
  console.log(`[${status === 'PASS' ? 'PASS' : 'FAIL'}] ${test} :: ${String(detail).slice(0, 200)}`);
};

function waitFor(fn, what, timeoutMs = 20000) {
  return Promise.race([
    (async () => {
      const t0 = Date.now();
      for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting: ' + what);
        await sleep(50);
      }
    })(),
    sleep(timeoutMs).then(() => { throw new Error('timeout waiting: ' + what); })
  ]);
}

// ---------- main ----------
fs.writeFileSync(SERVER_LOG, '');
const results = { env: { port: PORT, chromium: '/snap/bin/chromium', serverLog: SERVER_LOG, time: new Date().toISOString() },
                  matchId: null, rows: [] };

let serverProc = null;
let browser = null;
const white = { __ctx: null, __consoleErrors: [] };
const black = { __ctx: null, __consoleErrors: [] };
const restore = { __ctx: null, __consoleErrors: [] };
// Contract 36: extra isolated contexts for the users-directory rows.
// invitee (registered target, receives the push), u1 (inviter on /users),
// u2 (the target's own profile/guest-view pages), ghost (fake-username probe).
const invitee = { __ctx: null, __consoleErrors: [] };
const u1 = { __ctx: null, __consoleErrors: [] };
const u2 = { __ctx: null, __consoleErrors: [] };
const ghost = { __ctx: null, __consoleErrors: [] };
// u3: a third registered user with a NON-default Elo (1543) — its only purpose
// is to make the /users stats sort (elo desc) observable and the profile
// opponent cells unambiguous (each user has a distinct name).
const u3 = { __ctx: null, __consoleErrors: [] };
// Contract 38: isolated page pairs for the contract-38 rows (each row group
// seats into its OWN fresh private match, independent of the main game).
const tbA = { __ctx: null, __consoleErrors: [] };
const tbB = { __ctx: null, __consoleErrors: [] };
const snd1 = { __ctx: null, __consoleErrors: [] };
const snd2 = { __ctx: null, __consoleErrors: [] };
const snd3 = { __ctx: null, __consoleErrors: [] };

try {
  // ---------- server (async spawn, never spawnSync) ----------
  const DATA_DIR = fs.mkdtempSync('/tmp/e2e-data-');
  serverProc = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js')], {
    env: { ...process.env, DEBUG: '1', PORT: String(PORT), DATA_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: path.dirname(fileURLToPath(import.meta.url)) + '/..',
  });
  serverProc.stdout.on('data', d => fs.appendFileSync(SERVER_LOG, d));
  serverProc.stderr.on('data', d => fs.appendFileSync(SERVER_LOG, d));
  await waitFor(() => fs.existsSync(SERVER_LOG) && fs.readFileSync(SERVER_LOG, 'utf8').includes('server started'),
    'server to start', 15000);

  // ---------- browser + two isolated contexts ----------
  browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
    dumpio: false,
  });

  const mkPage = async (slot, name) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 800, height: 900, deviceScaleFactor: 1 });
    slot.__ctx = ctx;
    slot.page = page;
    page.__name = name;
    page.__consoleErrors = slot.__consoleErrors;
    page.on('console', (m) => {
      if (m.type() === 'error') {
        let loc = '';
        try { const l = m.location() || {}; loc = ` [${l.url || l.file || ''}:${l.lineNumber}]`; } catch (e) {}
        slot.__consoleErrors.push(m.text() + loc);
      }
    });
    page.on('pageerror', (e) => slot.__consoleErrors.push('pageerror: ' + e.message));
    return page;
  };

  // ----- SEATING (contract 32): the lobby no longer creates the private match. -----
  // The harness opens a RAW socket.io client to the server, emits 'private-match',
  // and reads the echoed id back from the 'private-match' event (server event is
  // unchanged: the generator socket receives the id). We then disconnect that raw
  // socket (its disconnect would otherwise end the pre-start match, since a match
  // whose host seat is empty + one player disconnects ends immediately) and point
  // BOTH guest pages at /game?matchId=<id>.
  const rawIo = await new Promise((resolve, reject) => {
    const r = io(BASE, { transports: ['websocket'] });
    const to = setTimeout(() => reject(new Error('raw socket: no connect')), 10000);
    r.on('connect', () => { clearTimeout(to); resolve(r); });
    r.on('connect_error', e => { clearTimeout(to); reject(e); });
  });
  results.matchId = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('raw socket: no private-match echo')), 10000);
    rawIo.on('private-match', id => { clearTimeout(to); resolve(id); });
    rawIo.emit('private-match', 1);
  });
  const matchId = results.matchId;
  console.log('harness RAW socket created private match, matchId =', matchId);
  // Drop the raw socket now: its disconnect must NOT end the not-yet-seated match.
  rawIo.close();
  await sleep(150);

  // White page joins first (host branch -> player1Socket); black page second
  // (player1Socket connected -> player2Socket; startMatch fires).
  const whitePage = await mkPage(white, 'white');
  await whitePage.goto(BASE + `/game?matchId=${matchId}`, { waitUntil: 'networkidle2' });
  await sleep(800);

  const blackPage = await mkPage(black, 'black');
  await blackPage.goto(BASE + `/game?matchId=${matchId}`, { waitUntil: 'networkidle2' });

  await waitFor(async () => (await white.page.evaluate(() => document.getElementById('status').innerText)) === 'Playing as white',
    'white seated as white');
  await waitFor(async () => (await black.page.evaluate(() => document.getElementById('status').innerText)) === 'Playing as black',
    'black seated as black');
  await sleep(300);
  logRow('S0 both guests seated in one private match; startGame(0/1) delivered', 'PASS',
    `white="${await white.page.evaluate(() => document.getElementById('status').innerText)}", black="${await black.page.evaluate(() => document.getElementById('status').innerText)}" (matchId ${matchId}; created by harness raw socket.io private-match — contract 32)`);

  // ---------- move-driver (viewport pixel coords from the PAGE's own layout) ----------
  async function squarePx(page, x, y) {
    return await page.evaluate((xx, yy) => {
      const r = document.getElementById('cnv').getBoundingClientRect();
      const c = side_len / 8;
      return { x: r.left + offset_x + (xx + 0.5) * c, y: r.top + offset_y + (yy + 0.5) * c };
    }, x, y);
  }

  async function drive(page, from, to, kind) {
    if (kind === 'drag') {
      const start = await squarePx(page, from.x, from.y);
      const end = await squarePx(page, to.x, to.y);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await sleep(40); // mousedown handler grabbed the piece; loop redraws sprite
      await page.mouse.move(start.x + 20, start.y + 20, { steps: 4 }); // > CLICK_THRESHOLD => isDragging
      await sleep(40);
      await page.mouse.move(end.x, end.y, { steps: 6 });
      await sleep(40);
      await page.mouse.up(); // mouseup handler completes the drop + emits 'move'
    } else {
      const a = await squarePx(page, from.x, from.y);
      const b = await squarePx(page, to.x, to.y);
      await page.mouse.click(a.x, a.y);
      await sleep(70);
      await page.mouse.click(b.x, b.y);
    }
  }

  async function waitBothSettled() {
    await Promise.all([
      waitFor(async () => (await white.page.evaluate(() => !is_being_validated)) === true, 'white validated'),
      waitFor(async () => (await black.page.evaluate(() => !is_being_validated)) === true, 'black validated'),
    ]);
    await sleep(60);
  }

  // board on a page, normalised to SERVER orientation via the page's own seam.
  // Piece-identity view: strips the high indicator bits (last-move / check /
  // en-passant, 0b10000 and up) so it can be compared against the stripped
  // `expected` tables.
  const serverOriented = () => `
    (function () {
      // prefer the validated snapshot: the end-of-game replay browser rewrites
      // the global board immediately after mate (applyReplayPosition(0))
      const src = window.__lastValidatedRaw ||
        window.__chessDebug.getBoard().map(r => r.slice().map(v => v & 0b1111))
          .slice();
      if (window.__lastValidatedRaw) return src.map(r => r.map(v => v & 0b1111));
      return window.ChessLayout.rotateBoard(src, window.__chessDebug.myColor);
    })()`;

  // board on a page in SERVER orientation WITHOUT masking (raw values, so the
  // high indicator bits are intact) — used to read en-passant / check bits.
  const serverOrientedRaw = () => `
    (function () {
      if (window.__lastValidatedRaw) return window.__lastValidatedRaw.map(r => r.slice());
      const b = window.__chessDebug.getBoard().map(r => r.slice());
      return window.ChessLayout.rotateBoard(b, window.__chessDebug.myColor);
    })()`;

  function assertSync(stepNo, note) {
    const exp = expected[stepNo];
    return Promise.all([
      white.page.evaluate(serverOriented()),
      black.page.evaluate(serverOriented()),
      white.page.evaluate(() => document.getElementById('status').innerText),
      black.page.evaluate(() => document.getElementById('status').innerText),
    ]).then(([wb, bb, ws, bs]) => {
      const wOk = JSON.stringify(wb) === JSON.stringify(exp);
      const bOk = JSON.stringify(bb) === JSON.stringify(exp);
      const agree = JSON.stringify(wb) === JSON.stringify(bb);
      const ok = wOk && bOk && agree;
      logRow(`S${stepNo} board SYNC after move (both pages == expected server board${note ? ' ' + note : ''})`,
        ok ? 'PASS' : 'FAIL',
        `whiteOk=${wOk} blackOk=${bOk} agree=${agree}; statuses: W="${ws}" B="${bs}"`);
      if (!ok) {
        const diff = [];
        for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
          if (wb[i][j] !== exp[i][j]) diff.push(`W [${j},${i}]: got ${wb[i][j] & 15} want ${exp[i][j]}`);
          if (bb[i][j] !== exp[i][j]) diff.push(`B [${j},${i}]: got ${bb[i][j] & 15} want ${exp[i][j]}`);
        }
        if (diff.length) logRow(`S${stepNo} board diff detail`, 'FAIL', diff.join('; ').slice(0, 400));
      }
      return ok;
    });
  }

  // in-page genLegalMoves for the selected piece (via the page's own seam),
  // compared against the highlights the client actually drew.
  async function selectAndCheck(page, from, label) {
    const a = await squarePx(page, from.x, from.y);
    await page.mouse.click(a.x, a.y);
    await sleep(100); // draw loop picks up the selection on the next tick
    const r = await page.evaluate(({ x, y }) => {
      const hi = Array.from(legalMoveSquares).map(k => {
        const [hx, hy] = k.split(',').map(Number);
        return [hx, hy];
      });
      let eng = [];
      try {
        const L = window.ChessLayout;
        let engineBoard = board, px = x, py = y;
        if (my_color !== 0) {
          engineBoard = L.rotateBoard(board, my_color);
          const sp = L.orientToServer(x, y, my_color);
          px = sp.x; py = sp.y;
        }
        for (const m of genLegalMoves(engineBoard, { x: px, y: py }, null, lastMove)) {
          const t = L.orientToVisual(m.to.x, m.to.y, my_color);
          eng.push([t.x, t.y]);
        }
      } catch (e) { return { hi, eng: [], equal: false, err: String(e) }; }
      const sameSet = (a2, b2) => a2.length === b2.length && a2.every(e => b2.some(f => f[0] === e[0] && f[1] === e[1]));
      return { hi, eng, equal: sameSet(hi, eng), myColor: my_color, isMyTurn: can_move };
    }, from);
    logRow(`H${label}-${page.__name} highlights on select(${from.x},${from.y}) == genLegalMoves (in-page)`,
      r.equal ? 'PASS' : 'FAIL',
      `highlights=${JSON.stringify(r.hi)} engine=${JSON.stringify(r.eng)} equal=${r.equal}${r.err ? ' err=' + r.err : ''}`);
    return r;
  }

  // ---------- S1: initial boards (regression for bug A: black must be rotated) ----------
  // DIAG: dump myColor + first/last rows from BOTH pages' actual board global
  const wMyColor = await white.page.evaluate(() => window.__chessDebug.myColor);
  const bMyColor = await black.page.evaluate(() => window.__chessDebug.myColor);
  const wRow0diag = await white.page.evaluate(() => board[0].slice(0,3));
  const wRow7diag = await white.page.evaluate(() => board[7].slice(0,3));
  const bRow0diag = await black.page.evaluate(() => board[0].slice(0,3));
  const bRow7diag = await black.page.evaluate(() => board[7].slice(0,3));
  console.log('DIAG S1 myColor W=', wMyColor, 'B=', bMyColor,
              ' W row0[0:3]=', JSON.stringify(wRow0diag), 'W row7[0:3]=', JSON.stringify(wRow7diag),
              ' B row0[0:3]=', JSON.stringify(bRow0diag), 'B row7[0:3]=', JSON.stringify(bRow7diag));
  const wBoard0 = await white.page.evaluate(serverOriented());
  const bBoard0 = await black.page.evaluate(serverOriented());
  // RAW (un-normalised, indicator-stripped) black board: bug-A regression is
  // about the INTERNAL visual state — black must hold the 180-rotated start
  // position. The old assertion compared the NORMALISED board against the
  // rotated expectation — an inverted check that demanded the buggy
  // unrotated state (it could never pass). Corrected: normalised == server
  // start for BOTH pages, and raw black == rotateBoard(start).
  const bBoardRaw = await black.page.evaluate(() =>
    window.__chessDebug.getBoard().map(r => r.slice().map(v => v & 0b1111)));
  const bExpect = await black.page.evaluate(() => window.ChessLayout.rotateBoard(
    [[12,14,13,11,10,13,14,12],[9,9,9,9,9,9,9,9],
     [0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],
     [1,1,1,1,1,1,1,1],[4,6,5,3,2,5,6,4]], 1));
  const wOk0 = JSON.stringify(wBoard0) === JSON.stringify(expected[0]);
  const bNormOk = JSON.stringify(bBoard0) === JSON.stringify(expected[0]);
  const bRawOk = JSON.stringify(bBoardRaw) === JSON.stringify(bExpect);
  logRow('S1 initial boards: normalised==start both pages; black raw==rotateBoard(start) — bug A regression',
    wOk0 && bNormOk && bRawOk ? 'PASS' : 'FAIL',
    `white norm==start: ${wOk0}; black norm==start: ${bNormOk}; black raw==rotated: ${bRawOk}`);

  // ---------- server move log helpers ----------
  const serverLog = () => fs.readFileSync(SERVER_LOG, 'utf8');
  const appliedLines = () => serverLog().split('\n')
    .filter(l => l.includes('move: APPLIED') && l.includes('matchId= ' + matchId));
  const rejectedLines = () => serverLog().split('\n')
    .filter(l => l.includes('move: REJECTED') && l.includes('matchId= ' + matchId));

  // ---------- user bughunt 2026-11-23: touch-disappear + highlight transposition ----------
  {
    const bAt = (x, y) => white.page.evaluate(({ x, y }) => board[y][x] & 0b1111, { x, y });
    const holdSt = () => white.page.evaluate(() => ({ hold: is_holding_piece, sel: selectedSquare !== null }));

    // H1: 60ms press on an ENEMY pawn (e7 = server (4,1)) must not remove it.
    const e7 = await squarePx(white.page, 4, 1);
    await white.page.mouse.move(e7.x, e7.y);
    await white.page.mouse.down();
    await sleep(60);
    await white.page.mouse.up();
    await sleep(60);
    const h1 = await bAt(4, 1);
    const h1st = await holdSt();
    logRow('H1 enemy-piece touch (60ms press on e7): piece stays, no grab state',
      h1 === 9 && !h1st.hold ? 'PASS' : 'FAIL',
      `board[1][4]=${h1} (want 9), holding=${h1st.hold}`);

    // H2: 60ms press on OWN pawn (e2 = server (4,6)) — the grab tick blanks
    // the square, release must RESTORE it (old code deleted the piece).
    const e2 = await squarePx(white.page, 4, 6);
    await white.page.mouse.move(e2.x, e2.y);
    await white.page.mouse.down();
    await sleep(60);
    await white.page.mouse.up();
    await sleep(60);
    const h2 = await bAt(4, 6);
    const h2st = await holdSt();
    logRow('H2 own-piece light click (60ms press on e2): piece restored after grab tick',
      h2 === 1 && !h2st.hold ? 'PASS' : 'FAIL',
      `board[6][4]=${h2} (want 1), holding=${h2st.hold}`);
    // clear the click-selection so H3 starts clean
    if (h2st.sel) {
      const d6 = await squarePx(white.page, 3, 2);
      await white.page.mouse.click(d6.x, d6.y);
      await sleep(60);
    }

    // H3: pixel probe. Selecting the e2 pawn must tint e3 (4,5) and NOT the
    // diagonal mirror d4 (5,4) — the old draw() filled rects with x=i,y=j
    // (transposed) while pieces used x=j; the mirror of a target across the
    // main diagonal is exactly where the buggy code painted. (e3/d4 are
    // EMPTY at start: a glyph would hide a tint painted underneath, since
    // pieces draw on top of the square overlays.) Green-vs-red channel gap
    // grows ~35 with the 0.3-alpha #74f551 tint on either square colour.
    const pxAt = (x, y) => white.page.evaluate(({ x, y }) => {
      const cnv = document.getElementById('cnv');
      const dpr = window.devicePixelRatio || 1;
      const cell = side_len / 8;
      const cx = Math.round((offset_x + x * cell + cell / 2) * dpr);
      const cy = Math.round((offset_y + y * cell + cell / 2) * dpr);
      const d = cnv.getContext('2d').getImageData(cx, cy, 1, 1).data;
      return [d[0], d[1], d[2]];
    }, { x, y });
    const grGap = (p) => p[1] - p[0];
    const e3Before = await pxAt(4, 5);
    const d4Before = await pxAt(5, 4);
    const e2b = await squarePx(white.page, 4, 6);
    await white.page.mouse.click(e2b.x, e2b.y);
    await sleep(120); // selection tint live from the next draw tick
    const e3After = await pxAt(4, 5);
    const d4After = await pxAt(5, 4);
    const tinted = grGap(e3After) - grGap(e3Before) > 25;
    const mirrorClean = JSON.stringify(d4Before) === JSON.stringify(d4After);
    // cleanup: deselect
    const empty2 = await squarePx(white.page, 3, 2);
    await white.page.mouse.click(empty2.x, empty2.y);
    await sleep(60);
    logRow('H3 selection highlight pixels land on e3, NOT on the transposed mirror d4',
      tinted && mirrorClean ? 'PASS' : 'FAIL',
      `e3 ${JSON.stringify(e3Before)}->${JSON.stringify(e3After)} tinted=${tinted}; d4 ${JSON.stringify(d4Before)}->${JSON.stringify(d4After)} clean=${mirrorClean}`);

    // H4: DRAG own pawn e2 onto the ILLEGAL target e5 (blocked) — the server
    // rejects and the rejected branch keeps the client board, so the piece
    // must be restored on e2 by completeDrag itself (user report 2026-11-23:
    // "dragging my piece to an unavailable square makes it disappear").
    await drive(white.page, toXY('e2'), toXY('e5'), 'drag');
    await sleep(300); // server REJECTED + shake + rejected validated round-trip
    const h4Board = await white.page.evaluate(() =>
      window.__chessDebug.getBoard().map(r => r.slice().map(v => v & 0b1111)));
    const h4Count = h4Board.flat().filter(v => v !== 0).length;
    const h4Pawn = h4Board[6][4];
    const h4Applied = appliedLines().length;
    logRow('H4 drag own piece to illegal square (e2->e5 drag) -> rejected, piece stays on e2, board intact',
      h4Pawn === 1 && h4Count === 32 && h4Applied === 0 ? 'PASS' : 'FAIL',
      `board[6][4]=${h4Pawn} (want 1), pieces=${h4Count} (want 32), appliedLines=${h4Applied} (want 0)`);
  }

  // ---------- E-ill: illegal-move probe (white e2->e5, blocked by own pawn) ----------
  {
    const before = appliedLines().length;
    const f = toXY('e2'), t = toXY('e5'); // server coords
    await white.page.evaluate(({ x: fx, y: fy }, { x: tx, y: ty }) => {
      socket.emit('move', matchId, { x: fx, y: fy }, { x: tx, y: ty });
    }, f, t);
    const shook = await white.page.evaluate(() => new Promise(res => {
      const cnv = document.getElementById('cnv');
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (cnv.classList.contains('shake')) { clearInterval(iv); return res(true); }
        if (Date.now() - t0 > 400) { clearInterval(iv); res(false); }
      }, 6);
    }));
    await sleep(80);
    const after = appliedLines().length;
    const rej = rejectedLines().filter(l => l.includes('3:4'));
    const boardUnchanged = (await white.page.evaluate(() => board[6][4] & 15)) === 1;
    logRow('E-ill illegal move e2->e5 (raw socket emit) -> server REJECTED + canvas shake, board unchanged',
      (after === before) && shook && rej.length > 0 && boardUnchanged ? 'PASS' : 'FAIL',
      `applied ${before}->${after} shake=${shook} boardUnchanged=${boardUnchanged} serverRejLine=${(rej[0] || 'NONE').slice(0, 120)}`);
    await sleep(120);
  }

  // ---------- drive the whole game (all rows of the plan) ----------
  for (let idx = 0; idx < plan.length; idx++) {
    const m = plan[idx];
    const stepNo = idx + 1;
    const page = m.side === 0 ? white.page : black.page;
    // VISUAL from/to on `page`
    const svFrom = toXY(m.w), svTo = toXY(m.b); // server coords
    const vFrom = (m.side === 0) ? svFrom : rot(svFrom.x, svFrom.y);
    const vTo = (m.side === 0) ? svTo : rot(svTo.x, svTo.y);

    // Wait until the MOVER page has caught up to the server turn (can_move===true,
    // the client's own "it's my turn" flag that gates input) and is idle before
    // clicking. can_move is the correct in-page signal — the STATUS text is NOT:
    // a freshly seated white page reports "Playing as white" (never "Your turn"),
    // so matching on the status string deadlocked step 1. The raw-socket seating
    // has less latency than the old lobby detour, so a fast turn flip used to land
    // before the mover's board updated -> the click was REJECTED as out-of-turn and
    // the page desynced. Waiting on can_move is a legal, non-deadlocking wait that
    // keeps the 46-row gate deterministic without touching the server code.
    const preBoardAtFrom = await page.evaluate(({ x, y }) => (board[y][x] & 0b1111), vFrom);
    await waitFor(async () => (await page.evaluate(() => can_move === true && !is_being_validated)) === true,
      `mover(${m.side === 0 ? 'white' : 'black'}) turn to propagate before step ${stepNo}`,
      15000);
    // Diagnostic (self-logging): if the MOVER still reports a non-piece at the
    // from-square after the turn wait, its board was stale/blanked (a draw-loop
    // race) and its click WILL be rejected -> surfaces as a desync instead of a
    // hard harness crash, so the row fails visibly. Expected value 0 (never fires).
    const boardAtFromNow = await page.evaluate(({ x, y }) => (board[y][x] & 0b1111), vFrom);
    if (boardAtFromNow === 0 && preBoardAtFrom !== 0) {
      logRow(`H-stale mover(${m.side === 0 ? 'white' : 'black'}) board blank at from-square before step ${stepNo} (draw-race)`, 'FAIL',
        `from=${vFrom.x},${vFrom.y} piece before-wait=${preBoardAtFrom} after-wait=${boardAtFromNow} (want non-zero)`);
    }

    if (m.o0) {
      // 4. O-O: the king selection must highlight the castling target square
      // (g1, visual == server for white), then click it. Closes the A2
      // harness's index-9 castling gap.
      const r = await selectAndCheck(page, vFrom, 'castling');
      const hasO0 = r.hi.some(c => c[0] === 6 && c[1] === 7);
      logRow('H-Castle king highlights include O-O target (g1) before O-O',
        hasO0 ? 'PASS' : 'FAIL',
        `highlights=${JSON.stringify(r.hi)} contains (6,7): ${hasO0}`);
      await drive(page, vFrom, { x: 6, y: 7 }, 'click');
    } else {
      await selectAndCheck(page, vFrom, 'm' + stepNo);
      await drive(page, vFrom, vTo, m.kind);
    }
    await waitBothSettled();

    const applied = appliedLines();
    const okApplied = applied.length >= stepNo;
    logRow(`M${stepNo} ${m.w}${m.o0 ? '(O-O)' : ''}->${m.b} (${page.__name}, ${m.kind}) — server "move: APPLIED"`,
      okApplied ? 'PASS' : 'FAIL',
      `appliedLines=${applied.length} (expected >= ${stepNo}); last: ${applied[applied.length - 1] || 'NONE'}`);
    await assertSync(stepNo, `${m.w}${m.o0 ? '(O-O)' : ''}->${m.b}`);

    // en-passant indicator (server coords; the bit travels with the square on
    // the rotated black page, so reading it in server-normalised orientation is
    // identical on both pages).
    if (stepNo === 1) {
      const epW = await white.page.evaluate(serverOrientedRaw()).then(b => b[EP_AFTER_E4.y][EP_AFTER_E4.x] & 0b1000000);
      const epB = await black.page.evaluate(serverOrientedRaw()).then(b => b[EP_AFTER_E4.y][EP_AFTER_E4.x] & 0b1000000);
      logRow(`M1 en-passant indicator on e5 (server ${EP_AFTER_E4.x},${EP_AFTER_E4.y}) present on BOTH pages`,
        epW === 0b1000000 && epB === 0b1000000 ? 'PASS' : 'FAIL',
        `white bit=${epW} black bit=${epB} (expected ${0b1000000})`);
    }
    if (stepNo === 2) {
      const epW = await white.page.evaluate(serverOrientedRaw()).then(b => b[EP_AFTER_E5.y][EP_AFTER_E5.x] & 0b1000000);
      const epB = await black.page.evaluate(serverOrientedRaw()).then(b => b[EP_AFTER_E5.y][EP_AFTER_E5.x] & 0b1000000);
      logRow(`M2 en-passant indicator on e4 (server ${EP_AFTER_E5.x},${EP_AFTER_E5.y}) present on BOTH pages`,
        epW === 0b1000000 && epB === 0b1000000 ? 'PASS' : 'FAIL',
        `white bit=${epW} black bit=${epB} (expected ${0b1000000})`);
    }
    if (m.mate) {
      const [ws, bs] = await Promise.all([
        white.page.evaluate(() => document.getElementById('status').innerText),
        black.page.evaluate(() => document.getElementById('status').innerText),
      ]);
      logRow(`M${stepNo} checkmate delivered to BOTH pages`,
        /Check Mate/i.test(ws) && /Check Mate/i.test(bs) && ws.includes('Won') && bs.includes('lost') ? 'PASS' : 'FAIL',
        `white="${ws}" black="${bs}"`);
      const wBit = await white.page.evaluate(serverOrientedRaw()).then(b => b[CHECK_AT_MATE.y][CHECK_AT_MATE.x] & 0b100000);
      const bBit = await black.page.evaluate(serverOrientedRaw()).then(b => b[CHECK_AT_MATE.y][CHECK_AT_MATE.x] & 0b100000);
      logRow(`M${stepNo} check indicator on the black king (both pages, at mate)`,
        wBit === 0b100000 && bBit === 0b100000 ? 'PASS' : 'FAIL',
        `white bit=${wBit} black bit=${bBit} (expected ${0b100000})`);
    }
  }

  // ---------- ADDENDUM (contract 32): lobby restore-on-load ----------
  // The lobby loses the login on F5 (the cookie survived, the UI didn't check it).
  // Now the lobby fetches /api/me on load: 200 {username, elo} -> logged-in state.
  // E2E: sign up a user through a RAW socket (signup -> signin -> sessionID), then
  // open a FRESH lobby page carrying that cookie and assert the page renders the
  // logged-in state WITHOUT a form submission (form hidden, auth-success shows the
  // username, Кабинет visible) — i.e. exactly what an F5 of a signed-in lobby now does.
  const mePage = await mkPage(restore, 'me');
  let a1Ok = false;
  let a1Detail = '';
  try {
    const r2 = io(BASE, { transports: ['websocket'] });
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('raw socket: no connect (restore)')), 10000);
      r2.on('connect', () => { clearTimeout(to); res(null); });
      r2.on('connect_error', e => { clearTimeout(to); rej(e); });
    });
    const uname = 'restore_' + Math.random().toString(36).slice(2, 8);
    const upass = 'restor-pass-1';
    const sessionID = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('restore: no session after signin')), 10000);
      r2.on('signup', (valid) => {
        if (valid !== 1) { clearTimeout(to); return reject(new Error('restore: signup invalid code ' + valid)); }
        r2.emit('signin', { username: uname, password: upass });
      });
      r2.on('signin', (valid, sid) => {
        if (valid && sid) { clearTimeout(to); resolve(sid); }
      });
      r2.emit('signup', { username: uname, password: upass });
    });
    r2.close();
    // Fresh lobby load as that user: set the session cookie BEFORE navigating
    // (the page's own restore logic reads /api/me with it).
    await restore.__ctx.setCookie({ name: 'sessionID', value: sessionID, url: BASE });
    await mePage.goto(BASE + '/index', { waitUntil: 'networkidle2' });
    a1Ok = await waitFor(async () => {
      return mePage.evaluate((u) => {
        const form = document.getElementById('form');
        const authed = document.getElementById('authed');
        const ok = document.getElementById('auth-success');
        if (!form || !authed || !ok) return false;
        const formHidden = form.classList.contains('hide') && !form.classList.contains('show');
        const authedShown = authed.classList.contains('show') && !authed.classList.contains('hide');
        // Contract 36 adaptation: a logged-in lobby ALSO hides [Вход]/[Регистрация]
        // (user feedback: «кнопка вход не нужна, если я уже залогинился»).
        const loginBtn = document.getElementById('login-button');
        const registerBtn = document.getElementById('register-button');
        const authBtnsHidden = !!loginBtn && loginBtn.classList.contains('hide')
          && !!registerBtn && registerBtn.classList.contains('hide');
        return formHidden && authedShown && authBtnsHidden && ok.textContent.indexOf(u) !== -1;
      }, uname);
    }, 'lobby logged-in state after fresh load', 15000);
    a1Detail = `user=${uname}; form hidden, [Вход]/[Регистрация] hidden (contract 36), Кабинет/Выход visible, success line shows the username`;
  } catch (e) {
    a1Ok = false;
    a1Detail = 'restore flow error: ' + (e && e.message || e);
  }
  logRow('A1 lobby restore-on-load: fresh load with a valid session cookie shows the logged-in state (GET /api/me 200)', a1Ok ? 'PASS' : 'FAIL', a1Detail);

  // ---------- Contract 36: users directory, invite-by-method, public profile ----------
  // Two fresh registered users (u1 the inviter, invitee the target); a raw
  // socket does signup+signin for each (same as A1). u1 then opens /users and
  // right-clicks the invitee row -> menu -> «Рапид» -> invite:create {method:'rapid'}.
  // The invitee's LOBBY shows the pushed invite row (method «Рапид», Elo 1500);
  // the invitee accepts -> joins the match, u1 joins -> startGame on both.
  // The game page's method select must be ENABLED with both options. Finally
  // the public profile (/user?name=) lists the finished game with the method
  // label «Рапид» + per-view result, a fresh visitor sees the enabled select
  // too, /api/users/stats reflects the new elo+game counts, and an unknown
  // username renders the Russian 404 message.
  {
    const randsuf = Math.random().toString(36).slice(2, 8);
    const u1Name = 'u1_' + randsuf;
    const invName = 'invitee_' + randsuf;
    const u3Name = 'u3_' + randsuf;   // distinct-Elo spectator (1543)
    const upass = 'contract36-pass';
    const mkSession = async (name) => {
      const r = io(BASE, { transports: ['websocket'] });
      await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('raw socket: no connect (' + name + ')')), 10000);
        r.on('connect', () => { clearTimeout(to); res(null); });
        r.on('connect_error', e => { clearTimeout(to); rej(e); });
      });
      const sid = await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error(name + ': no session after signin')), 10000);
        r.on('signup', (valid) => {
          if (valid !== 1) { clearTimeout(to); return reject(new Error(name + ': signup invalid code ' + valid)); }
          r.emit('signin', { username: name, password: upass });
        });
        r.on('signin', (valid, s) => { if (valid && s) { clearTimeout(to); resolve(s); } });
        r.emit('signup', { username: name, password: upass });
      });
      r.close();
      return sid;
    };

    let x1Ok = false, x1Detail = '';
    try {
      const sidU1 = await mkSession(u1Name);
      const sidInv = await mkSession(invName);
      const sidU3 = await mkSession(u3Name);
      u1.sessionID = sidU1;
      invitee.sessionID = sidInv;
      u3.sessionID = sidU3;
      x1Ok = true;
      x1Detail = `u1=${u1Name}, invitee=${invName}, u3=${u3Name} (all registered, Elo 1500, 0 games)`;
    } catch (e) {
      x1Detail = 'signup flow error: ' + (e && e.message || e);
    }
    logRow('X1 contract 36: two users registered (inviter + invitee) for the users-directory flow', x1Ok ? 'PASS' : 'FAIL', x1Detail);

    // X2: the /users page is PUBLIC (ghost context, no cookie at all).
    const ghostPage = await mkPage(ghost, 'ghost');
    let x2Ok = false, x2Detail = '';
    try {
      const res = await fetch(BASE + '/api/users/stats');
      const stats = res.ok ? await res.json() : null;
      const ok = Array.isArray(stats) && stats.some(s => s.username === u1Name && s.elo === 1500 && s.games === 0)
        && stats.some(s => s.username === invName && s.elo === 1500 && s.games === 0)
        && stats.some(s => s.username === u3Name && s.elo === 1500 && s.games === 0);
      x2Ok = !!ok;
      x2Detail = `GET /api/users/stats (no auth) status=${res.status}: users with elo 1500 / 0 games incl. all three fresh users: ${ok}; count=${Array.isArray(stats) ? stats.length : 'n/a'}`;
      await ghostPage.goto(BASE + '/users', { waitUntil: 'networkidle2' });
      await waitFor(async () => (await ghostPage.evaluate(() => {
        const tb = document.getElementById('users-body');
        return tb && tb.querySelectorAll('tr[data-username]').length >= 3;
      })) === true, 'guest /users directory to render', 15000);
      x2Ok = x2Ok && (await ghostPage.evaluate((inv) => {
        const row = document.querySelector(`tr[data-username="${inv}"]`);
        return row && row.querySelectorAll('td').length === 3;
      }, invName));
      // Sort order (contract 36 §3): all three fresh users share elo 1500, so
      // the stats list must order them by username ASC — invitee < u1 < u3.
      const order = await ghostPage.evaluate(() => {
        const tb = document.getElementById('users-body');
        return Array.from(tb.querySelectorAll('tr[data-username]')).map(r => r.dataset.username);
      });
      const iInv = order.indexOf(invName), iU1 = order.indexOf(u1Name), iU3 = order.indexOf(u3Name);
      x2Ok = x2Ok && iInv !== -1 && iU1 !== -1 && iU3 !== -1 && iInv < iU1 && iU1 < iU3;
      x2Detail = x2Detail + `; page row order ${JSON.stringify(order)} (want invitee<u1<u3): ${iInv < iU1 && iU1 < iU3}`;
    } catch (e) {
      x2Ok = false;
      x2Detail = 'guest /users error: ' + (e && e.message || e);
    }
    logRow('X2 /users public directory: guest sees the table; /api/users/stats lists all three users (elo 1500, 0 games) in elo-desc/name-asc order', x2Ok ? 'PASS' : 'FAIL', x2Detail);

    // X3-X6: logged-in inviter on /users -> right-click the target row ->
    // menu -> «Рапид» -> invite:create {method:'rapid'} -> toasts + server log.
    const u1Page = await mkPage(u1, 'u1');
    await u1.__ctx.setCookie({ name: 'sessionID', value: u1.sessionID, url: BASE });
    await u1Page.goto(BASE + '/users', { waitUntil: 'networkidle2' });

    let x3Ok = false, x3Detail = '';
    try {
      await u1Page.goto(BASE + '/users', { waitUntil: 'networkidle2' });
      // Row availability is a single post-goto read. networkidle2 can resolve
      // before the client's in-place row enhancement runs, so a naive immediate
      // probe races the enhancement; read the row once (it is server-rendered
      // into the HTML, so it is present) and fall back to a short poll only if
      // it is not there yet (client rebuild path).
      const rowPresent = (inv) => u1Page.evaluate((u) => !!document.querySelector(`tr[data-username="${u}"]`), inv);
      let found = await rowPresent(invName);
      if (!found) {
        const t0 = Date.now();
        while (!found && Date.now() - t0 < 10000) {
          await new Promise(r => setTimeout(r, 50));
          found = await rowPresent(invName);
        }
      }
      if (!found) {
        const diag = await u1Page.evaluate((inv) => ({
          url: location.href,
          anyRows: document.querySelectorAll('tr[data-username]').length,
          sample: (document.getElementById('users-body') || document.body).innerHTML.slice(0, 300),
        }), invName);
        x3Detail = `invitee row NOT present after goto+poll; DIAG=${JSON.stringify(diag).slice(0, 300)}`;
      }
      const rowInfo = await u1Page.evaluate((inv) => {
        const row = document.querySelector(`tr[data-username="${inv}"]`);
        if (!row) return null;
        const tds = Array.from(row.querySelectorAll('td'));
        return { cells: tds.map(t => t.textContent.trim()), self: row.classList.contains('user-self') };
      }, invName);
      const x3row = rowInfo && rowInfo.cells.length === 3 && rowInfo.cells[1] === '1500' && rowInfo.cells[2] === '0' && !rowInfo.self;
      x3Ok = !!found && !!x3row;
      if (x3Ok) x3Detail = `invitee row present post-goto (found=${found}); cells=${JSON.stringify(rowInfo && rowInfo.cells)}, self=${rowInfo && rowInfo.self} (want name/1500/0, self=false)`;
    } catch (e) {
      x3Detail = 'invitee row error: ' + (e && e.message || e);
    }
    logRow('X3 /users lists the invitee with Elo 1500 and 0 games (row not marked self for the inviter)', x3Ok ? 'PASS' : 'FAIL', x3Detail);

    let x4Ok = false, x4Detail = '';
    try {
      await u1Page.evaluate((inv) => {
        const row = document.querySelector(`tr[data-username="${inv}"]`);
        const r = row.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, invName).then(p => u1Page.mouse.click(p.x, p.y, { button: 'right' }));
      const menu = await waitFor(async () => u1Page.evaluate((inv) => {
        const m = document.getElementById('user-context-menu');
        if (!m || m.classList.contains('hide')) return null;
        const items = Array.from(m.querySelectorAll('.user-menu-item')).map(i => i.textContent);
        const head = m.querySelector('.user-menu-head');
        return { head: head ? head.textContent : '', items };
      }, invName), 'invite context menu to open', 10000);
      x4Ok = !!menu && String(menu.head || '').indexOf(invName) !== -1 && menu.items.some(t => t === 'Рапид') && menu.items.some(t => t === 'Классика');
      x4Detail = `menu head="${menu ? menu.head : 'NONE'}" items=${JSON.stringify(menu ? menu.items : [])}`;
    } catch (e) {
      x4Detail = 'menu error: ' + (e && e.message || e);
    }
    logRow('X4 right-click on a users row opens the invite menu with method choice (Классика / Рапид)', x4Ok ? 'PASS' : 'FAIL', x4Detail);

    let x5Ok = false, x5Detail = '', inviteMatchId = null;
    try {
      await u1Page.evaluate((inv) => {
        const m = document.getElementById('user-context-menu');
        const item = m && Array.from(m.querySelectorAll('.user-menu-method')).find(i => i.textContent === 'Рапид');
        if (item) item.click();
      }, invName);
      // Contract 36 INTEGRATION FIX (orchestrator smoke): invite:created now
      // also NAVIGATES the inviter into the invite-bound match (without it the
      // invitee sat alone — the inviter had no way back into the match it
      // created). The toast can therefore be destroyed by the navigation, so
      // the client-side signal is the toast OR the /game?matchId= navigation.
      let toast = null;
      try {
        toast = await waitFor(async () => {
          const t = await u1Page.evaluate(() => {
            const el = document.querySelector('.toast');
            return el ? el.textContent : null;
          });
          return (t === 'Приглашение отправлено') ? t : null;
        }, 'success toast after invite:create', 4000);
      } catch (e) { toast = null; }
      const inviteLine = serverLog().split('\n').filter(l => l.includes('invite:create: OK') && l.includes('from= ' + u1Name) && l.includes('to= ' + invName));
      // The stored invite record (A2's lib/invites.js persists to DATA_DIR/invites.json)
      // carries the chosen method — it is the authoritative source for the match id.
      let invitesOk = null, inviteMatchId = null;
      try {
        const invJson = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'invites.json'), 'utf8'));
        const rec = invJson.find(r => r && r.to === invName && r.from === u1Name);
        invitesOk = !!rec && rec.method === 'rapid' && rec.matchId !== undefined;
        if (rec && rec.matchId) inviteMatchId = String(rec.matchId);
      } catch (e) { invitesOk = null; }
      let navigated = null;
      try {
        navigated = await waitFor(async () => {
          const u = u1Page.url();
          const m2 = /[?&]matchId=([^&]+)/.exec(u);
          return (u.indexOf('/game') !== -1 && m2) ? m2[1] : null;
        }, 'inviter navigated into the invite match', 10000);
      } catch (e) { navigated = null; }
      x5Ok = invitesOk === true && inviteLine.length > 0 &&
        (toast === 'Приглашение отправлено' || navigated === inviteMatchId);
      x5Detail = `toast="${toast}"; navigated=${navigated}; server line=${(inviteLine[0] || 'NONE').slice(0, 140)}; invites.json record method=rapid matchId=${inviteMatchId}: ${invitesOk}`;
      results.invite36 = { u1: u1Name, invitee: invName, method: 'rapid', matchId: inviteMatchId };
    } catch (e) {
      x5Detail = 'invite flow error: ' + (e && e.message || e);
    }
    logRow('X5 users-page invite: «Рапид» chosen -> invite:create {method:"rapid"} -> success toast + server OK line', x5Ok ? 'PASS' : 'FAIL', x5Detail);

    // X6: the INVITEE's lobby shows the pushed invite row (real-time delivery).
    const inviteePage = await mkPage(invitee, 'invitee');
    await invitee.__ctx.setCookie({ name: 'sessionID', value: invitee.sessionID, url: BASE });
    // Let u1's /users-page socket drain before the invitee loads the lobby: the
    // invitee must find the player1 slot FREE (u1 has not joined yet, but the
    // /users page that created the invite must be gone, else its socket would
    // still hold a seat and the invitee's join would be refused).
    await sleep(500);
    await inviteePage.goto(BASE + '/index', { waitUntil: 'networkidle2' });
    let x6Ok = false, x6Detail = '';
    try {
      await waitFor(async () => (await inviteePage.evaluate((inv) => {
        const list = document.getElementById('invites-list');
        return list && list.textContent.indexOf(inv) !== -1;
      }, u1Name)) === true, 'invitee lobby to show the invite', 15000);
      const rowText = await inviteePage.evaluate((inv) => {
        const list = document.getElementById('invites-list');
        const row = list && Array.from(list.children).find(r => r.textContent.indexOf(inv) !== -1);
        return row ? row.textContent : '';
      }, u1Name);
      const accept = await inviteePage.evaluate((inv) => {
        const list = document.getElementById('invites-list');
        const row = list && Array.from(list.children).find(r => r.textContent.indexOf(inv) !== -1);
        const a = row && row.querySelector('a.invite-accept');
        return a ? { href: a.getAttribute('href'), label: a.textContent } : null;
      }, u1Name);
      x6Ok = rowText.indexOf('Рапид') !== -1 && rowText.indexOf('1500') !== -1 && !!accept && (accept.href || '').indexOf('matchId=') !== -1;
      x6Detail = `row="${rowText.slice(0, 120)}"; accept=<${accept ? accept.href : 'NONE'}> ${accept ? accept.label : ''}`;
      results.invite36 = Object.assign(results.invite36 || {}, { acceptHref: accept && accept.href });
    } catch (e) {
      x6Detail = 'invitee lobby error: ' + (e && e.message || e);
    }
    logRow('X6 invitee lobby shows the invite row: inviter name, Elo 1500, method «Рапид», [Принять] -> /game?matchId', x6Ok ? 'PASS' : 'FAIL', x6Detail);

    // X7: the invitee accepts -> joins the match (seats into player1, the
    // host slot); u1 joins second -> startGame fires for BOTH. Navigate u1 in
    // the background (no await before the wait) so both seatings happen inside
    // one 20s window; the status text flips to "Playing as ..." only AFTER
    // startGame, so each player's wait covers the whole round-trip.
    let x7Ok = false, x7Detail = '';
    try {
      const href = results.invite36 && results.invite36.acceptHref;
      const matchId36 = results.invite36 && results.invite36.matchId;
      await inviteePage.goto(BASE + (href || '/game?matchId='), { waitUntil: 'networkidle2' });
      // Contract 36 integration fix: the inviter was ALREADY navigated into the
      // match by invite:created (X5). Reload it only if it is not there yet — a
      // needless reload would risk the pre-start disconnect path.
      if (!String(u1Page.url()).includes('matchId=' + matchId36)) {
        void (async () => {
          try { await u1Page.goto(BASE + '/game?matchId=' + (matchId36 || ''), { waitUntil: 'networkidle2' }); }
          catch (e) { /* reported through the seating waits */ }
        })();
      }
      const seated = await waitFor(async () => {
        const sInv = await inviteePage.evaluate(() => document.getElementById('status').innerText).catch(() => '');
        const sU1 = await u1Page.evaluate(() => document.getElementById('status').innerText).catch(() => '');
        if (/^Playing as (white|black)$/.test(sInv) && /^Playing as (white|black)$/.test(sU1)) return { inv: sInv, u1: sU1 };
        return null;
      }, 'both players seated (startGame on both) in the invite match', 20000);
      x7Ok = true;
      x7Detail = `invitee="${seated.inv}" u1="${seated.u1}" (invite-bound match ${matchId36})`;
    } catch (e) {
      x7Detail = 'accept flow error: ' + (e && e.message || e);
    }
    logRow('X7 invitee accepts the invite: joins the match, u1 joins, startGame delivered to both', x7Ok ? 'PASS' : 'FAIL', x7Detail);

    // X8: the game page's method select is ENABLED with Классика/Рапид.
    let x8Ok = false, x8Detail = '';
    try {
      const probe = await u1Page.evaluate(() => {
        const sel = document.getElementById('method-select');
        if (!sel) return null;
        const opts = Array.from(sel.options).map(o => ({ value: o.value, label: o.textContent }));
        return { disabled: sel.disabled, value: sel.value, opts };
      });
      x8Ok = !!probe && probe.disabled === false && probe.opts.length === 2
        && probe.opts.some(o => o.value === 'standard' && o.label === 'Классика')
        && probe.opts.some(o => o.value === 'rapid' && o.label === 'Рапид');
      x8Detail = JSON.stringify(probe);
    } catch (e) {
      x8Detail = 'method select error: ' + (e && e.message || e);
    }
    logRow('X8 game page: method select ENABLED with options Классика(standard) / Рапид(rapid)', x8Ok ? 'PASS' : 'FAIL', x8Detail);

    // X9: a FRESH logged-in visitor on the same match sees the same select
    // (u2 context — also proves the select is not tied to the creator socket).
    // The visitor is NOT in the invite, so the server answers gameNotFound and
    // the page redirects to /index. A `window` global is per-document (reset by
    // the redirect), so the in-page hook persists the select snapshot to
    // sessionStorage (same-tab scope — survives the redirect) and we read it back.
    let x9Ok = false, x9Detail = '';
    try {
      const sidU2 = await mkSession('u2_' + randsuf);
      const u2Page = await mkPage(u2, 'u2');
      await u2.__ctx.setCookie({ name: 'sessionID', value: sidU2, url: BASE });
      await u2Page.evaluateOnNewDocument(() => {
        document.addEventListener('DOMContentLoaded', () => {
          try {
            const sel = document.getElementById('method-select');
            if (sel) sessionStorage.setItem('__x9probe', JSON.stringify({ disabled: sel.disabled, value: sel.value, count: sel.options.length }));
          } catch (e) {
            try { sessionStorage.setItem('__x9probe', JSON.stringify({ err: String(e) })); } catch (e2) {}
          }
        });
      });
      await u2Page.goto(BASE + '/game?matchId=' + (results.invite36 && results.invite36.matchId || ''), { waitUntil: 'networkidle2' });
      await sleep(700); // allow the gameNotFound redirect if the visitor is bounced
      const raw = await u2Page.evaluate(() => { try { return sessionStorage.getItem('__x9probe'); } catch (e) { return null; } });
      const probe = raw ? JSON.parse(raw) : null;
      x9Ok = !!probe && probe.disabled === false && probe.count === 2 && probe.value === 'standard';
      x9Detail = 'probe (sessionStorage, survives redirect) = ' + JSON.stringify(probe);
    } catch (e) {
      x9Detail = 'fresh visitor select error: ' + (e && e.message || e);
    }
    logRow('X9 fresh logged-in visitor: same match page, method select enabled (2 options) before any redirect', x9Ok ? 'PASS' : 'FAIL', x9Detail);

    // X10: public profile — the finished game is listed (Дата/Соперник/Результат/Метод),
    // newest first, method label «Рапид», per-view result; elo updated in the directory.
  let invColor = null;   // the invitee's seat color (0 white / 1 black), known after X10
  let x10Ok = false, x10Detail = '';
  // Contract 37 stage D (the 37D row): half A = pre-start silent return-drop,
  // half B = board-derived captured strip. Both are set inside X10's try (pre-
  // start and post-loop) and read by the 37D row at X-flow scope, so the row stays
  // defined even if X10's profile fetch throws.
  let x37dropOk = false, x37dropDetail = '';
  let x37strip = null, x37stripDetail = '';

    try {
      // End the invite match with a fast scholar's mate (white wins in 6 moves).
      // `side` in plan36 is the SERVER color; the mover page depends on who was
      // seated as white (server seating order), and the black page's board is
      // 180-degree rotated — visual coords = rot(server coords) for black.
      invColor = (await inviteePage.evaluate(() => window.__chessDebug.myColor));
      const whitePage = invColor === 0 ? inviteePage : u1Page; // white = player1
      const blackPage = invColor === 0 ? u1Page : inviteePage;
      const pageFor = (side) => (side === 0 ? whitePage : blackPage);
      const rot36 = (p) => ({ x: 7 - p.x, y: 7 - p.y });
      const drive36 = async (pg, vFrom, vTo) => {
        const p = await pg.evaluate((fx, fy, tx, ty) => {
          const r = document.getElementById('cnv').getBoundingClientRect();
          const c = side_len / 8;
          return { a: { x: r.left + offset_x + (fx + 0.5) * c, y: r.top + offset_y + (fy + 0.5) * c },
                   b: { x: r.left + offset_x + (tx + 0.5) * c, y: r.top + offset_y + (ty + 0.5) * c } };
        }, vFrom.x, vFrom.y, vTo.x, vTo.y);
        await pg.mouse.click(p.a.x, p.a.y);
        await sleep(70);
        await pg.mouse.click(p.b.x, p.b.y);
      };

      // CONTRACT 37 stage D — two behavior fixes, ONE E2E row, on the seated
      // registered-pair invite match (the same match X10 finishes).
      //   HALF A: a drag released on the piece's OWN square cancels SILENTLY in
      //     completeDrag (no socket.emit -> the SERVER never logs 'move: REJECTED'
      //     for it and the canvas is never given the 'shake' class). It must
      //     precede any capture, so it runs PRE-START here (before X10's loop).
      //   HALF B: the captured strip is DERIVED from the live board with explicit
      //     color classes — white's strip (#captured-white for the white viewer)
      //     shows the BLACK pieces white captured as .cap-piece.cap-dark. In this
      //     scholar's-mate line the ONLY black piece white captures is the f7
      //     PAWN (6.Qxf7#; black's rook stays on a8/h8), so the strip after that
      //     capture must contain exactly ONE .cap-piece.cap-dark and NO
      //     .cap-piece.cap-light. A MutationObserver is armed HERE (pre-start,
      //     before the loop) and latches the strip + a board-derived count into
      //     window.__strip37 at the FIRST black capture; the post-X10 37D row
      //     reads that latch (frozen at the capture instant, immune to the
      //     game-end replay resetting the live board to the start position).
      try {
        const whitePage37 = invColor === 0 ? inviteePage : u1Page;
        const whiteName = invColor === 0 ? 'invitee' : 'u1';
        const invMatchId = results.invite36 && results.invite36.matchId;
        await waitFor(async () => (await whitePage37.evaluate(() => {
          try { return my_color === 0 && can_move === true && !is_being_validated; } catch (e) { return false; }
        })) === true, 'white pre-start turn (invite match) ready', 15000);

        // HALF A: pre-start silent return-drop. Drag the white e2 pawn out (toward
        // e4 by a few px), then release ON the e2 pixel (the origin square).
        // completeDrag's to===from branch calls releaseGrab() and returns BEFORE
        // socket.emit -> no server 'move: REJECTED' line, no 'shake' class.
        const e2 = await squarePx(whitePage37, 4, 6);   // white visual e2 == server (4,6)
        const cnvHasShake = async () => whitePage37.evaluate(() => document.getElementById('cnv').classList.contains('shake'));
        const sawShake = await cnvHasShake();
        await whitePage37.mouse.move(e2.x, e2.y);
        await whitePage37.mouse.down();
        await sleep(40);
        await whitePage37.mouse.move(e2.x + 14, e2.y - 14, { steps: 3 }); // >CLICK_THRESHOLD => isDragging (toward e4 by a few px)
        await sleep(40);
        await whitePage37.mouse.move(e2.x, e2.y, { steps: 3 });           // back ON the origin square (e2)
        await sleep(40);
        await whitePage37.mouse.up();                                       // completeDrag(to===from) -> releaseGrab, no emit
        await sleep(500);
        const sawShake2 = await cnvHasShake();
        // The silent drop is on the INVITE match (the guest `matchId` game is
        // already over). Count the TOTAL 'move: REJECTED' delta: pre-start, the
        // only live match that could emit a new REJECTED line is the invite
        // match, so delta>0 would mean the silent cancel reached the server.
        const rejAll = () => serverLog().split('\n').filter(l => l.includes('move: REJECTED')).length;
        const rejBeforeTotal = rejAll();
        await sleep(120);
        const rejNew = rejAll() - rejBeforeTotal;
        const e2Piece = await whitePage37.evaluate(() => (board[6][4] & 0b1111));
        const rejInv = invMatchId
          ? serverLog().split('\n').filter(l => l.includes('move: REJECTED') && l.includes('matchId= ' + invMatchId))
          : [];
        x37dropOk = (rejNew === 0) && !(sawShake || sawShake2) && e2Piece === 1;
        x37dropDetail = `halfA return-drop e2->e2 on ${whiteName}(white, invite match ${invMatchId || 'n/a'}): new REJECTED lines=${rejNew} (want 0, silent completeDrag) sawShake=${sawShake || sawShake2} (want false, no 'shake' class within 500ms) e2 piece=${e2Piece} (want 1=white pawn) inviteRejTotal=${rejInv.length} rejLine=${(rejInv[0] || 'NONE').slice(0, 120)}`;
        // ARM the capture-strip latch NOW (before the loop's first capture). For
        // the white viewer, #captured-white shows the BLACK pieces white captured
        // as .cap-piece.cap-dark. The 10ms render loop re-derives this strip from
        // the LIVE board and rewrites it to '' until the first black capture; the
        // game-end replay later resets the board to the start position (which would
        // re-derive an EMPTY strip). So we latch, via a MutationObserver, the first
        // frame that shows a cap-dark span — the f7-pawn capture in this mate line —
        // and store it in window.__strip37, immune to the later replay reset.
        await whitePage37.evaluate(() => {
          try { delete window.__strip37; } catch (e) {}
          window.__strip37 = { latched: null, glyph: null, raw: '' };
          const el = document.getElementById('captured-white');
          if (!el) return;
          // Count (color,type) pieces on the LIVE board exactly as
          // renderCapturedPieces does (expected-vs-present), so the latched
          // board-derived counts are consistent with the DOM strip BY
          // CONSTRUCTION (the strip is itself derived from this same board).
          const derive = () => {
            const count = (colorBit) => {
              const d = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
              for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
                const v = board[i][j] & 0b1111;
                if (v === 0) continue;
                if ((v & 0b1000) === colorBit) d[v & 0b0111]++;
              }
              return d;
            };
            const exp = { 1: 8, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2 };
            const whitePieces = count(0), blackPieces = count(0b1000);
            let dk = 0, lt = 0;
            for (const t in exp) {
              dk += Math.max(0, exp[t] - (blackPieces[t] || 0));
              lt += Math.max(0, exp[t] - (whitePieces[t] || 0));
            }
            return { dark: dk, light: lt };
          };
          const io = new MutationObserver(() => {
            const s2 = document.getElementById('captured-white');
            if (!s2) return;
            const domDark = s2.querySelectorAll('.cap-piece.cap-dark').length;
            const domLight = s2.querySelectorAll('.cap-piece.cap-light').length;
            if (domDark > 0 && !window.__strip37.latched) {
              // Fire on the first black capture (this MO is armed pre-start and
              // the strip stays empty until a black piece is captured). Latch the
              // board-derived counts NOW — the live board is post-capture at this
              // instant (that is why the strip shows a dark span), and latching
              // freezes them before the game-end replay resets the live board to
              // the start position (which would re-derive an empty strip).
              const first = s2.querySelector('.cap-piece.cap-dark');
              const d = derive();
              window.__strip37.latched = { dark: d.dark, light: d.light, domDark, domLight };
              window.__strip37.glyph = first ? first.textContent : null;
              window.__strip37.raw = s2.innerHTML;
            }
          });
          io.observe(el, { childList: true, subtree: true, characterData: true });
        });
        // HALF B is read after X10's loop (the post-X10 37D row).
      } catch (e) {
        x37dropDetail = (x37dropDetail ? x37dropDetail + ' | ' : '') + '37 halfA error: ' + (e && e.message || e);
        if (!x37dropDetail) x37dropDetail = '37 halfA error: ' + (e && e.message || e);
        x37dropOk = x37dropOk === true; // stays false unless explicitly set
      }

      for (const m of plan) {
        const page = pageFor(m.side);
        await waitFor(async () => (await page.evaluate(() => {
          try { return can_move === true && !is_being_validated; } catch (e) { return false; }
        })) === true,
          `mover turn step36 (white=${invColor === 0 ? 'invitee' : 'u1'})`, 15000);
        const svFrom = toXY(m.w), svTo = toXY(m.b);
        const vFrom = (m.side === 1) ? rot36(svFrom) : svFrom;
        const vTo = (m.o0) ? { x: 6, y: 7 } : ((m.side === 1) ? rot36(svTo) : svTo); // O-O -> g1
        await drive36(page, vFrom, vTo);
        await Promise.all([
          waitFor(async () => (await inviteePage.evaluate(() => !is_being_validated)) === true, 'invitee settled'),
          waitFor(async () => (await u1Page.evaluate(() => !is_being_validated)) === true, 'u1 settled'),
        ]);
      }
      await sleep(400); // gameEnd + status update land right after the last validated
      const endInv = await inviteePage.evaluate(() => document.getElementById('status').innerText);
      const endU1 = await u1Page.evaluate(() => document.getElementById('status').innerText);


      // Per-view result on each player's public profile. A profile row's
      // OPPONENT column (cell 1) names the other player — select the row whose
      // cell 1 is the target user (matching on the whole textContent wrongly
      // matched the opponent's row, whose opponent-cell contains this user).
      const ghost2 = await mkPage(ghost, 'ghost-profile');
      await ghost2.goto(BASE + '/user?name=' + encodeURIComponent(invName), { waitUntil: 'networkidle2' });
      const profile = await ghost2.evaluate((name) => {
        const rows = Array.from(document.querySelectorAll('#profile-games-body tr'))
          .filter(r => { const t = r.querySelectorAll('td'); return t.length >= 2 && t[1].textContent.trim() === name; });
        if (!rows.length) return { rows: 0, cells: [] };
        return { rows: rows.length, cells: Array.from(rows[0].querySelectorAll('td')).map(t => t.textContent.trim()) };
      }, u1Name);
      await ghost2.goto(BASE + '/user?name=' + encodeURIComponent(u1Name), { waitUntil: 'networkidle2' });
      const u1Profile = await ghost2.evaluate((name) => {
        const rows = Array.from(document.querySelectorAll('#profile-games-body tr'))
          .filter(r => { const t = r.querySelectorAll('td'); return t.length >= 2 && t[1].textContent.trim() === name; });
        if (!rows.length) return { rows: 0, cells: [] };
        return { rows: rows.length, cells: Array.from(rows[0].querySelectorAll('td')).map(t => t.textContent.trim()) };
      }, invName);
      // White (the invitee in this seating) won the mate; per-view: winner
      // «Победа», loser «Поражение»; both rows carry the «Рапид» label.
      const wantInvResult = invColor === 0 ? 'Победа' : 'Поражение';
      const wantU1Result = invColor === 0 ? 'Поражение' : 'Победа';
      x10Ok = profile.rows === 1 && profile.cells.length === 4
        && profile.cells[1] === u1Name && profile.cells[2] === wantInvResult && profile.cells[3] === 'Рапид'
        && u1Profile.rows === 1 && u1Profile.cells[1] === invName && u1Profile.cells[2] === wantU1Result && u1Profile.cells[3] === 'Рапид';
      x10Detail = `invitee(seated ${invColor === 0 ? 'white' : 'black'}) end="${endInv}" u1 end="${endU1}"; invitee profile cells=${JSON.stringify(profile.cells)}; u1 profile cells=${JSON.stringify(u1Profile.cells)}`;
    } catch (e) {
      x10Detail = 'profile error: ' + (e && e.message || e);
    }
    logRow('X10 public profiles list the finished game: opponent, per-view result (Победа/Поражение), method «Рапид»', x10Ok ? 'PASS' : 'FAIL', x10Detail);

    // CONTRACT 37 stage D — the new row (one). Half A (silent return-drop) was
    // asserted in the pre-start block above (before X10's loop). Half B reads
    // the capture-strip LATCH (window.__strip37) armed in that pre-start block:
    // a MutationObserver on the white viewer's #captured-white fired at the
    // FIRST black capture — 6.Qxf7# in this scholar's-mate line — and latched
    // BOTH the DOM strip counts and the board-derived counts taken from the live
    // board at that instant (frozen before the end-modal replay resets the live
    // board to the start position, which would otherwise re-derive an EMPTY strip
    // long before this row runs). Latching at the capture instant makes the read
    // immune to the game-end replay and to any late 'validated' that overwrites
    // __lastValidatedRaw with the reset start board. In this line the ONLY black
    // piece white captures is the f7 pawn (black's rook stays on a8/h8), so the
    // board-derived strip = exactly ONE cap-dark (a black glyph), NO cap-light.
    {
      let latch = null;
      try {
        latch = await (invColor === 0 ? inviteePage : u1Page).evaluate(() => {
          const h = window.__strip37;
          if (!h) return { ok: false, reason: 'no __strip37 latch (pre-start arm failed)' };
          if (!h.latched) return { ok: false, reason: 'strip latch never fired (no black capture observed — mover-turn flake?)' };
          return { ok: true, derivedDark: h.latched.dark, derivedLight: h.latched.light,
                   domDark: h.latched.domDark, domLight: h.latched.domLight,
                   glyph: h.glyph, raw: h.raw };
        });
      } catch (e) {
        latch = { ok: false, reason: 'evaluate error: ' + (e && e.message || e) };
      }
      x37strip = latch;
      if (latch && latch.ok) {
        x37stripDetail = `halfB white capture strip (#captured-white for the white viewer, the board-derived renderCapturedPieces output) at first black-capture (6.Qxf7# f7 pawn): DOM ${latch.domDark} cap-dark / ${latch.domLight} cap-light (glyph="${latch.glyph}"); board-derived count at latch instant ${latch.derivedDark}/${latch.derivedLight} (diagnostic — can read the replay-reset start board if validated+replay packets were batched in one task, so the DOM counts are authoritative)`;
      } else {
        x37stripDetail = `halfB strip: ${latch && latch.reason || 'strip not read'}`;
      }
      // The rendered DOM strip IS the output of the board-derived
      // renderCapturedPieces (the fix under test): for the white viewer it lists
      // the black pieces white captured as .cap-piece.cap-dark and nothing
      // white as .cap-piece.cap-light. In this line white captured exactly ONE
      // black pawn (f7), never a white piece. The DOM is the reliable signal
      // (it is only re-derived by the 10ms loop and stays non-empty through the
      // end-modal replay reset, which changes the board but not the strip until
      // the next tick), so the PASS condition is on the DOM counts.
      const stripOk = latch && latch.ok && latch.domDark === 1 && latch.domLight === 0;
      logRow('37D registered-pair game: drag-on-own-square cancels silently (no server REJECTED, no shake) + white capture strip shows a board-derived black (.cap-dark) glyph, no light',
        (x37dropOk && stripOk) ? 'PASS' : 'FAIL',
        (x37dropDetail + ' | ' + x37stripDetail).slice(0, 400));
    }


    // X11: /api/users/stats reflects the finished game (elo changed from 1500, games=1).
    let x11Ok = false, x11Detail = '';
    try {
      const res = await fetch(BASE + '/api/users/stats');
      const stats = await res.json();
      const u1s = stats.find(s => s.username === u1Name);
      const inVs = stats.find(s => s.username === invName);
      // White won: the winner's elo rises above 1500, the loser's drops below,
      // and both users now count exactly 1 game in the directory.
      const winner = invColor === 0 ? inVs : u1s;
      const loser = invColor === 0 ? u1s : inVs;
      x11Ok = !!u1s && !!inVs && u1s.games === 1 && inVs.games === 1
        && winner.elo > 1500 && loser.elo < 1500;
      x11Detail = `u1 elo=${u1s && u1s.elo} games=${u1s && u1s.games}; invitee elo=${inVs && inVs.elo} games=${inVs && inVs.games} (invitee seated ${invColor === 0 ? 'white' : 'black'})`;
    } catch (e) {
      x11Detail = 'stats after game error: ' + (e && e.message || e);
    }
    logRow('X11 /api/users/stats after the game: both users games=1, winner elo>1500, loser elo<1500', x11Ok ? 'PASS' : 'FAIL', x11Detail);

    // X12: unknown username -> 404 with the Russian message.
    let x12Ok = false, x12Detail = '';
    try {
      const res = await fetch(BASE + '/user?name=ghost_' + randsuf);
      const html = await res.text();
      x12Ok = res.status === 404 && html.indexOf('Пользователь не найден') !== -1;
      x12Detail = `status=${res.status}; contains «Пользователь не найден»: ${html.indexOf('Пользователь не найден') !== -1}`;
    } catch (e) {
      x12Detail = '404 probe error: ' + (e && e.message || e);
    }
    logRow('X12 /user?name=<unknown> -> 404 with the Russian «Пользователь не найден»', x12Ok ? 'PASS' : 'FAIL', x12Detail);
  }

  // ---------- Contract 38: takeback accept/decline UI + capture/check click sfx ----------
  // Each test seats a FRESH private match (same raw-socket pattern as S0) so the
  // rows are independent of the main scholar's-mate game and of each other.
  {   // ---- contract-38 helpers (fresh-match seating + board/turn assertions) ----
    const seatContract38 = async (wSlot, bSlot) => {
      const raw = io(BASE, { transports: ['websocket'] });
      await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('c38 raw socket: no connect')), 10000);
        raw.on('connect', () => { clearTimeout(to); res(null); });
        raw.on('connect_error', e => { clearTimeout(to); rej(e); });
      });
      const mid = await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('c38 raw socket: no private-match echo')), 10000);
        raw.on('private-match', id => { clearTimeout(to); resolve(id); });
        raw.emit('private-match', 1);
      });
      raw.close();
      await sleep(150);
      const wp = await mkPage(wSlot, wSlot === tbA ? 'c38A-white' : 'c38-white');
      await wp.goto(BASE + `/game?matchId=${mid}`, { waitUntil: 'networkidle2' });
      await sleep(700);
      const bp = await mkPage(bSlot, bSlot === tbB ? 'c38B-black' : 'c38-black');
      await bp.goto(BASE + `/game?matchId=${mid}`, { waitUntil: 'networkidle2' });
      await waitFor(async () => (await wp.evaluate(() => document.getElementById('status').innerText)) === 'Playing as white', 'c38 white seated');
      await waitFor(async () => (await bp.evaluate(() => document.getElementById('status').innerText)) === 'Playing as black', 'c38 black seated');
      await sleep(250);
      return { wp, bp, mid };
    };
    // Server-orientation board snapshot of a page (strip indicators, rotate via
    // the page's own ChessLayout) — same seam as the main harness: prefers the
    // last 'validated' snapshot (__lastValidatedRaw), which is immune to the
    // game-end replay resetting the live board to the start position.
    const c38Board = (page) => page.evaluate(`
      (function () {
        const src = window.__lastValidatedRaw ||
          window.__chessDebug.getBoard().map(r => r.slice().map(v => v & 0b1111)).slice();
        if (window.__lastValidatedRaw) return src.map(r => r.map(v => v & 0b1111));
        return window.ChessLayout.rotateBoard(src, window.__chessDebug.myColor);
      })()`);
    // Visual pixel coords for `page` (same model as squarePx; the black page
    // rotates the passed SERVER coords, the white page uses them as-is).
    const c38Px = (page, x, y) => page.evaluate(({ x, y }) => {
      const r = document.getElementById('cnv').getBoundingClientRect();
      const c = side_len / 8;
      const my = window.__chessDebug.myColor;
      const p = my === 1 ? { x: 7 - x, y: 7 - y } : { x, y };
      return { x: r.left + offset_x + (p.x + 0.5) * c, y: r.top + offset_y + (p.y + 0.5) * c };
    }, { x, y });
    const c38Drive = async (page, from, to, kind) => {
      if (kind === 'drag') {
        const s = await c38Px(page, from.x, from.y);
        const e = await c38Px(page, to.x, to.y);
        await page.mouse.move(s.x, s.y);
        await page.mouse.down();
        await sleep(40);
        await page.mouse.move(s.x + 20, s.y + 20, { steps: 4 });
        await sleep(40);
        await page.mouse.move(e.x, e.y, { steps: 6 });
        await sleep(40);
        await page.mouse.up();
      } else {
        const a = await c38Px(page, from.x, from.y);
        const b = await c38Px(page, to.x, to.y);
        await page.mouse.click(a.x, a.y);
        await sleep(70);
        await page.mouse.click(b.x, b.y);
      }
    };
    const c38Settled = (wp, bp) => Promise.all([
      waitFor(async () => (await wp.evaluate(() => !is_being_validated)) === true, 'c38 white validated'),
      waitFor(async () => (await bp.evaluate(() => !is_being_validated)) === true, 'c38 black validated'),
    ]).then(() => sleep(80));
    const c38Btn = (page) => page.evaluate(() => document.getElementById('btn-takeback').disabled);
    const c38Status = (page) => page.evaluate(() => document.getElementById('status').innerText);
    const c38Modal = (page) => page.evaluate(() => {
      const m = document.getElementById('takebackOfferModal');
      if (!m) return null;
      const h3 = m.querySelector('h3');
      const acc = document.getElementById('btn-takeback-accept');
      const dec = document.getElementById('btn-takeback-decline');
      return { visible: m.style.display === 'flex', title: h3 ? h3.innerText : null,
               accept: acc ? acc.innerText : null, decline: dec ? dec.innerText : null };
    });
    // Board expectations (server orientation, stripped):
    const C38_START = expected[0];
    const C38_AFTER_E4 = expected[1];
    const C38_AFTER_D5 = [[12,14,13,11,10,13,14,12],[9,9,9,0,9,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,9,0,0,0,0],[0,0,0,0,1,0,0,0],[0,0,0,0,0,0,0,0],[1,1,1,1,0,1,1,1],[4,6,5,3,2,5,6,4]];
    const C38_AFTER_EXD5 = [[12,14,13,11,10,13,14,12],[9,9,9,0,9,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,1,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[1,1,1,1,0,1,1,1],[4,6,5,3,2,5,6,4]];
    const C38_AFTER_1F3 = [[12,14,13,11,10,13,14,12],[9,9,9,9,9,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[1,1,1,1,1,0,1,1],[4,6,5,3,2,5,6,4]];
    const C38_AFTER_E6 = [[12,14,13,11,10,13,14,12],[9,9,9,9,0,9,9,9],[0,0,0,0,9,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[1,1,1,1,1,0,1,1],[4,6,5,3,2,5,6,4]];
    const C38_AFTER_G4 = [[12,14,13,11,10,13,14,12],[9,9,9,9,0,9,9,9],[0,0,0,0,9,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,1,0],[1,1,1,1,1,0,0,1],[4,6,5,3,2,5,6,4]];
    const C38_AFTER_QH4 = [[12,14,13,0,10,13,14,12],[9,9,9,9,0,9,9,9],[0,0,0,0,9,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,1,11],[0,0,0,0,0,1,0,0],[1,1,1,1,1,0,0,1],[4,6,5,3,2,5,6,4]];
    const c38BoardEqual = (pages, want) => Promise.all(pages.map(p => c38Board(p)))
      .then(bs => bs.every(b => JSON.stringify(b) === JSON.stringify(want)));

    // ================= 38A: takeback accept (UI) =================
    // Seat a fresh match; before any move white's #btn-takeback is DISABLED
    // (no history); white plays 1.e4 via the canvas-drag helper; the button
    // becomes ENABLED (requester = the side that just moved); white clicks it;
    // the black page shows #takebackOfferModal with the Russian title; black
    // clicks Принять; BOTH pages restore the pre-move board and the status
    // says white to move.
    {
      const { wp, bp, mid } = await seatContract38(tbA, tbA);
      let step0 = false, step0d = '';
      try {
        const dis0 = await c38Btn(wp);
        step0 = dis0 === true;
        step0d = `white #btn-takeback disabled=${dis0} before any move (no history)`;
      } catch (e) { step0d = '38A step0 error: ' + (e && e.message || e); }
      logRow('38A takeback: before any move the white #btn-takeback is disabled (no move history)', step0 ? 'PASS' : 'FAIL', step0d);

      let step1 = false, step1d = '';
      try {
        await waitFor(async () => (await wp.evaluate(() => can_move === true && !is_being_validated)) === true, '38A white turn', 15000);
        await c38Drive(wp, toXY('e2'), toXY('e4'), 'drag');
        await c38Settled(wp, bp);
        const applied = serverLog().split('\n').filter(l => l.includes('move: APPLIED') && l.includes('matchId= ' + mid)).length;
        const en = await c38Btn(wp);
        const boardsOk = await c38BoardEqual([wp, bp], C38_AFTER_E4);
        step1 = applied === 1 && en === false && boardsOk;
        step1d = `white 1.e4 (canvas drag): appliedLines=${applied} (want 1); #btn-takeback enabled after own move: ${en === false}; both boards == post-1.e4: ${boardsOk}`;
      } catch (e) { step1d = '38A step1 error: ' + (e && e.message || e); }
      logRow('38A takeback: after white 1.e4 (drag) the #btn-takeback is enabled (requester = the side that just moved)', step1 ? 'PASS' : 'FAIL', step1d);

      let step2 = false, step2d = '';
      try {
        await wp.evaluate(() => document.getElementById('btn-takeback').click());
        const mi = await waitFor(async () => {
          const m = await c38Modal(bp);
          return (m && m.visible) ? m : null;
        }, '38A black offer modal', 15000);
        step2 = mi.title === 'Соперник предлагает вернуть ход' && mi.accept === 'Принять' && mi.decline === 'Отклонить';
        step2d = `black #takebackOfferModal title="${mi.title}" accept="${mi.accept}" decline="${mi.decline}" visible=${mi.visible}`;
      } catch (e) { step2d = '38A step2 error: ' + (e && e.message || e); }
      logRow('38A takeback: white requests -> black page shows #takebackOfferModal «Соперник предлагает вернуть ход» with Принять/Отклонить', step2 ? 'PASS' : 'FAIL', step2d);

      let step3 = false, step3d = '';
      try {
        await bp.evaluate(() => document.getElementById('btn-takeback-accept').click());
        await waitFor(async () => (await c38BoardEqual([wp], C38_START)) === true, '38A board restored on white', 15000);
        const wB = await c38Board(wp), bB = await c38Board(bp);
        const boardsOk = JSON.stringify(wB) === JSON.stringify(C38_START) && JSON.stringify(bB) === JSON.stringify(C38_START);
        const ws = await c38Status(wp);
        const bs2 = await c38Status(bp);
        const wDis = await c38Btn(wp), bDis = await c38Btn(bp);
        const modalGone = (await c38Modal(bp)).visible === false;
        const turnWhite = /^Your turn/i.test(ws) && /Opponent/i.test(bs2);
        step3 = boardsOk && turnWhite && modalGone && wDis === true && bDis === false;
        step3d = `after Принять: both boards == pre-move position: ${boardsOk}; W status="${ws}" (white to move) B status="${bs2}"; modal closed=${modalGone}; W btn disabled=${wDis} (own turn) B btn enabled=${bDis === false} (last move was white's)`;
      } catch (e) { step3d = '38A step3 error: ' + (e && e.message || e); }
      logRow('38A takeback: black clicks Принять -> BOTH pages restore the pre-move board and the status shows white to move', step3 ? 'PASS' : 'FAIL', step3d);
      const errsA = [...tbA.__consoleErrors].filter(e => !/favicon|net::ERR|Failed to load resource|\/api\/me/i.test(e));
      logRow('38A no JS console/page errors on the takeback match pages', errsA.length === 0 ? 'PASS' : 'FAIL', errsA.length ? errsA.slice(0, 3).join(' | ') : 'none');
    }

    // ================= 38B: takeback decline =================
    // Fresh match: white 1.e4, white requests, black clicks Отклонить -> white
    // #status shows «Соперник отказался возвращать ход», then restores to the
    // turn text; the decline must NOT permanently disable #btn-takeback.
    {
      const { wp, bp, mid } = await seatContract38(tbB, tbB);
      let step1 = false, step1d = '';
      try {
        await waitFor(async () => (await wp.evaluate(() => can_move === true && !is_being_validated)) === true, '38B white turn', 15000);
        await c38Drive(wp, toXY('e2'), toXY('e4'), 'drag');
        await c38Settled(wp, bp);
        const en = await c38Btn(wp);
        await wp.evaluate(() => document.getElementById('btn-takeback').click());
        await waitFor(async () => { const m = await c38Modal(bp); return m && m.visible ? true : null; }, '38B offer modal on black', 15000);
        step1 = en === false;
        step1d = `white 1.e4 + takeback request: #btn-takeback enabled after own move=${en === false}; offer modal shown on black page`;
      } catch (e) { step1d = '38B step1 error: ' + (e && e.message || e); }
      logRow('38B takeback: fresh match, white 1.e4, white requests — the offer modal reaches the black page', step1 ? 'PASS' : 'FAIL', step1d);

      let step2 = false, step2d = '';
      try {
        await bp.evaluate(() => document.getElementById('btn-takeback-decline').click());
        const seen = await waitFor(async () => {
          const t = await c38Status(wp);
          return t === 'Соперник отказался возвращать ход' ? t : null;
        }, '38B white status decline message', 15000);
        const cls = await wp.evaluate(() => document.getElementById('status').className);
        const shake = await wp.evaluate(() => document.getElementById('cnv').classList.contains('shake'));
        step2 = seen === 'Соперник отказался возвращать ход' && !shake;
        step2d = `white #status shows "${seen}" (want «Соперник отказался возвращать ход»); class="${cls}"; canvas shake=${shake}`;
      } catch (e) { step2d = '38B step2 error: ' + (e && e.message || e); }
      logRow('38B takeback: black clicks Отклонить -> white #status shows «Соперник отказался возвращать ход» (no canvas shake)', step2 ? 'PASS' : 'FAIL', step2d);

      let step3 = false, step3d = '';
      try {
        const restored = await waitFor(async () => {
          const t = await c38Status(wp);
          return t === "Opponent's turn" ? t : null;
        }, '38B white status restores to the turn text', 15000);
        const wDis = await c38Btn(wp);
        const boardsOk = await c38BoardEqual([wp, bp], C38_AFTER_E4);
        step3 = restored === "Opponent's turn" && wDis === false && boardsOk;
        step3d = `white #status restored to "${restored}"; #btn-takeback NOT disabled after the decline: disabled=${wDis} (want false — no permanent lock); boards still == post-1.e4 (the move stands): ${boardsOk}`;
      } catch (e) { step3d = '38B step3 error: ' + (e && e.message || e); }
      logRow('38B takeback: the status restores to the turn text and #btn-takeback stays enabled (no permanent lock after a decline)', step3 ? 'PASS' : 'FAIL', step3d);
      const errsB = [...tbB.__consoleErrors].filter(e => !/favicon|net::ERR|Failed to load resource|\/api\/me/i.test(e));
      logRow('38B no JS console/page errors on the decline match pages', errsB.length === 0 ? 'PASS' : 'FAIL', errsB.length ? errsB.slice(0, 3).join(' | ') : 'none');
    }

    // ================= 38C: capture/check click sfx (audio stub) =================
    // The sound pages install an evaluateOnNewDocument stub that patches
    // HTMLAudioElement.prototype.play to push {src, t} into window.__played
    // before any page script runs (pattern from the F3 verification harness).
    const seatSound = async (slot) => {
      const raw = io(BASE, { transports: ['websocket'] });
      await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('c38 sound socket: no connect')), 10000);
        raw.on('connect', () => { clearTimeout(to); res(null); });
        raw.on('connect_error', e => { clearTimeout(to); rej(e); });
      });
      const mid = await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('c38 sound socket: no private-match echo')), 10000);
        raw.on('private-match', id => { clearTimeout(to); resolve(id); });
        raw.emit('private-match', 1);
      });
      raw.close();
      await sleep(150);
      const wp = await mkPage(slot, 'c38snd-white');
      await wp.evaluateOnNewDocument(() => {
        window.__played = [];
        try {
          const proto = HTMLAudioElement.prototype;
          const orig = proto.play;
          proto.play = function () {
            try { window.__played.push({ src: this.src, t: performance.now() }); } catch (e) {}
            return Promise.resolve();
          };
        } catch (e) {}
      });
      await wp.goto(BASE + `/game?matchId=${mid}`, { waitUntil: 'networkidle2' });
      await sleep(700);
      const bp = await mkPage(slot, 'c38snd-black');
      await bp.evaluateOnNewDocument(() => {
        window.__played = [];
        try {
          const proto = HTMLAudioElement.prototype;
          const orig = proto.play;
          proto.play = function () {
            try { window.__played.push({ src: this.src, t: performance.now() }); } catch (e) {}
            return Promise.resolve();
          };
        } catch (e) {}
      });
      await bp.goto(BASE + `/game?matchId=${mid}`, { waitUntil: 'networkidle2' });
      await waitFor(async () => (await wp.evaluate(() => document.getElementById('status').innerText)) === 'Playing as white', 'c38snd white seated');
      await waitFor(async () => (await bp.evaluate(() => document.getElementById('status').innerText)) === 'Playing as black', 'c38snd black seated');
      await sleep(250);
      return { wp, bp, mid };
    };
    const playedOf = (page) => page.evaluate(() => (window.__played || []).slice());
    const clicksOf = (entries) => entries.filter(e => String(e.src).split('/').pop() === 'click.mp3');

    // 38C1: a QUIET move (1.e4) -> click.mp3 count unchanged (move-self plays instead).
    {
      const { wp, bp, mid } = await seatSound(snd1);
      let ok = false, detail = '';
      try {
        const base = (await playedOf(wp)).length;
        await waitFor(async () => (await wp.evaluate(() => can_move === true && !is_being_validated)) === true, '38C1 white turn', 15000);
        await c38Drive(wp, toXY('e2'), toXY('e4'), 'click');
        await c38Settled(wp, bp);
        await sleep(350); // let any (absent) check double-click window close
        const delta = (await playedOf(wp)).slice(base);
        const clicks = clicksOf(delta).length;
        const applied = serverLog().split('\n').filter(l => l.includes('move: APPLIED') && l.includes('matchId= ' + mid)).length;
        const boardsOk = await c38BoardEqual([wp, bp], C38_AFTER_E4);
        const moveSelf = delta.filter(e => String(e.src).split('/').pop() === 'move-self.mp3').length;
        ok = clicks === 0 && applied === 1 && boardsOk && moveSelf === 1;
        detail = `white 1.e4 (quiet, click-to-move): __played delta=[${delta.map(e => String(e.src).split('/').pop()).join(',') || 'none'}] click.mp3=${clicks} (want 0) move-self=${moveSelf} (want 1); appliedLines=${applied}; boards synced=${boardsOk}`;
      } catch (e) { detail = '38C1 error: ' + (e && e.message || e); }
      logRow('38C sound: quiet move (1.e4) -> click.mp3 count unchanged (move-self plays, no click)', ok ? 'PASS' : 'FAIL', detail);
    }

    // 38C2: a CAPTURE (2.exd5, not check) -> click.mp3 count +1.
    {
      const { wp, bp, mid } = await seatSound(snd2);
      let ok = false, detail = '';
      try {
        await waitFor(async () => (await wp.evaluate(() => can_move === true && !is_being_validated)) === true, '38C2 white turn', 15000);
        await c38Drive(wp, toXY('e2'), toXY('e4'), 'click');
        await c38Settled(wp, bp);
        await waitFor(async () => (await bp.evaluate(() => can_move === true && !is_being_validated)) === true, '38C2 black turn', 15000);
        await c38Drive(bp, toXY('d7'), toXY('d5'), 'click');
        await c38Settled(wp, bp);
        const boardsD5 = await c38BoardEqual([wp, bp], C38_AFTER_D5);
        const base = (await playedOf(wp)).length;
        await waitFor(async () => (await wp.evaluate(() => can_move === true && !is_being_validated)) === true, '38C2 white turn after 1...d5', 15000);
        await c38Drive(wp, toXY('e4'), toXY('d5'), 'click');
        await c38Settled(wp, bp);
        await sleep(350);
        const delta = (await playedOf(wp)).slice(base);
        const clicks = clicksOf(delta).length;
        const boardsOk = await c38BoardEqual([wp, bp], C38_AFTER_EXD5);
        ok = clicks === 1 && boardsOk && boardsD5;
        detail = `white 2.exd5 (capture, no check): __played delta=[${delta.map(e => String(e.src).split('/').pop()).join(',') || 'none'}] click.mp3=${clicks} (want 1); boards after 1...d5 synced=${boardsD5}, after 2.exd5 synced=${boardsOk}`;
      } catch (e) { detail = '38C2 error: ' + (e && e.message || e); }
      logRow('38C sound: capture (2.exd5, no check) -> click.mp3 count +1', ok ? 'PASS' : 'FAIL', detail);
    }

    // 38C3: a CHECK — the Fool's-mate line 1.f3 1...e6 2.g4 2...Qh4+ (non-capture
    // check on white's king; the F3-verified check line) -> +2 click.mp3 within
    // 300 ms on the move that delivers the check.
    // The full harness keeps many game pages open (main game, contract-36 match,
    // 38A/38B, 38C1/38C2); their 10 ms render loops can delay the +100 ms
    // second-click setTimeout on the mover page to well past 300 ms. The F3
    // verification harness (committed evidence: gap 126-189 ms) ran the check
    // line with ONLY that match's two pages open, so mirror it: close every
    // other page context before seating the check-line match (all those
    // matches are already finished; the error arrays the C-err rows read were
    // populated before this point). The snd3 pair stays open.
    {
      for (const s of [white, black, restore, invitee, u1, u2, u3, ghost, tbA, tbB, snd1, snd2]) {
        try { if (s.__ctx) { await s.__ctx.close(); s.__ctx = null; } } catch (e) {}
      }
      let ok = false, detail = '';
      const { wp, bp, mid } = await seatSound(snd3);
      try {
        await waitFor(async () => (await wp.evaluate(() => can_move === true && !is_being_validated)) === true, '38C3 white turn', 15000);
        await c38Drive(wp, toXY('f2'), toXY('f3'), 'click');
        await c38Settled(wp, bp);
        await waitFor(async () => (await bp.evaluate(() => can_move === true && !is_being_validated)) === true, '38C3 black turn', 15000);
        await c38Drive(bp, toXY('e7'), toXY('e6'), 'click');
        await c38Settled(wp, bp);
        await waitFor(async () => (await wp.evaluate(() => can_move === true && !is_being_validated)) === true, '38C3 white turn after 1...e6', 15000);
        await c38Drive(wp, toXY('g2'), toXY('g4'), 'click');
        await c38Settled(wp, bp);
        const baseW = (await playedOf(wp)).length;
        const baseB = (await playedOf(bp)).length;
        await waitFor(async () => (await bp.evaluate(() => can_move === true && !is_being_validated)) === true, '38C3 black turn after 2.g4', 15000);
        await c38Drive(bp, toXY('d8'), toXY('h4'), 'click');
        await c38Settled(wp, bp);
        await sleep(450); // the second click lands at +100 ms; wait well past it
        const deltaW = (await playedOf(wp)).slice(baseW);
        const deltaB = (await playedOf(bp)).slice(baseB);
        const clicksW = clicksOf(deltaW);
        const clicksB = clicksOf(deltaB);
        // The <300 ms gap is measured on the MOVER page (the F3-verified seam —
        // the 'validated' handler + setTimeout(100) runs in the page that owns
        // the turn); the remote page's second-click timer is best-effort under
        // headless load, so only the count is asserted there.
        const gapB = clicksB.length === 2 ? Math.round(clicksB[1].t - clicksB[0].t) : null;
        const boardsOk = await c38BoardEqual([wp, bp], C38_AFTER_QH4);
        const ws = await c38Status(wp);
        ok = clicksB.length === 2 && gapB !== null && gapB > 0 && gapB < 300 && clicksW.length === 2 && boardsOk;
        detail = `black 2...Qh4+ (Fool-mate check on the white king, no capture): mover(black) __played delta=[${deltaB.map(e => String(e.src).split('/').pop()).join(',')}] click.mp3=${clicksB.length} (want 2) gap=${gapB}ms (want <300); white clicks=${clicksW.length} (want 2); boards synced=${boardsOk}; W status="${ws}"`;
      } catch (e) { detail = '38C3 error: ' + (e && e.message || e); }
      logRow('38C sound: check (2...Qh4+, the Fool-mate line) -> +2 click.mp3 within 300 ms (double click)', ok ? 'PASS' : 'FAIL', detail);
    }
  }

  // ---------- console errors ----------
  const wErr = white.__consoleErrors.filter(e => !/favicon|net::ERR/i.test(e));
  const bErr = black.__consoleErrors.filter(e => !/favicon|net::ERR/i.test(e));
  const mErr = restore.__consoleErrors.filter(e => !/favicon|net::ERR/i.test(e));
  // Guest / unauthed pages hit /api/me on load (401 expected — the restore
  // check) and a bounced visitor may land on /index; the browser's "Failed to
  // load resource" console line for those is the same class as the net::ERR
  // noise the main C-err row already ignores.
  const cErr = [...invitee.__consoleErrors, ...u1.__consoleErrors, ...u2.__consoleErrors, ...ghost.__consoleErrors]
    .filter(e => !/favicon|net::ERR|Failed to load resource|\/api\/me/i.test(e));
  logRow('C-err no JS console/page errors on white or black page', wErr.length === 0 && bErr.length === 0 && mErr.length === 0 ? 'PASS' : 'FAIL',
    `white errors=${JSON.stringify(wErr).slice(0, 200)}; black errors=${JSON.stringify(bErr).slice(0, 200)}; lobby(restore) errors=${JSON.stringify(mErr).slice(0, 200)}`);
  logRow('C-err36 no JS console/page errors on the contract-36 pages (users, invitee lobby, game, profiles)', cErr.length === 0 ? 'PASS' : 'FAIL',
    `users/invitee/game/profile errors=${JSON.stringify(cErr).slice(0, 300)}`);

  results.serverLog = serverLog().split('\n').filter(l => l.includes('move:'));
  results.rows = rows;
  const allPass = rows.every(r => r.status === 'PASS');
  console.log(allPass ? '\nALL PASS' : '\nNOT ALL PASS');
  process.exitCode = allPass ? 0 : 1;
} catch (e) {
  console.error('E2E RUN ERROR:', e);
  results.error = String(e && e.stack || e);
  results.rows = rows;
  process.exitCode = 1;
} finally {
  try { if (browser) await browser.close(); } catch {}
  try { if (white.__ctx) await white.__ctx.close(); } catch {}
  try { if (black.__ctx) await black.__ctx.close(); } catch {}
  try { if (restore.__ctx) await restore.__ctx.close(); } catch {}
  try { if (invitee.__ctx) await invitee.__ctx.close(); } catch {}
  try { if (u1.__ctx) await u1.__ctx.close(); } catch {}
  try { if (u2.__ctx) await u2.__ctx.close(); } catch {}
  try { if (ghost.__ctx) await ghost.__ctx.close(); } catch {}
  try { if (u3.__ctx) await u3.__ctx.close(); } catch {}
  try { if (tbA.__ctx) await tbA.__ctx.close(); } catch {}
  try { if (tbB.__ctx) await tbB.__ctx.close(); } catch {}
  try { if (snd1.__ctx) await snd1.__ctx.close(); } catch {}
  try { if (snd2.__ctx) await snd2.__ctx.close(); } catch {}
  try { if (snd3.__ctx) await snd3.__ctx.close(); } catch {}
  try { if (serverProc && serverProc.exitCode === null) serverProc.kill('SIGTERM'); } catch {}
  await sleep(150);
  try {
    fs.mkdirSync(path.dirname(REPORT_EVIDENCE), { recursive: true });
    fs.writeFileSync(REPORT_EVIDENCE, JSON.stringify(results, null, 2));
    console.log('evidence written to', REPORT_EVIDENCE);
  } catch (e) { console.error('evidence write failed:', e.message); }
  const passed = rows.filter(r => r.status === 'PASS').length;
  console.log(`\nSUMMARY: ${passed}/${rows.length} rows PASS, matchId=${results.matchId}`);
  if (process.exitCode !== 0) process.exit(1);
}
