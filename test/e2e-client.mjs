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

try {
  // ---------- server (async spawn, never spawnSync) ----------
  serverProc = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js')], {
    env: { ...process.env, DEBUG: '1', PORT: String(PORT), DATA_DIR: fs.mkdtempSync('/tmp/e2e-data-') },
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
        return formHidden && authedShown && ok.textContent.indexOf(u) !== -1;
      }, uname);
    }, 'lobby logged-in state after fresh load', 15000);
    a1Detail = `user=${uname}; form hidden, Кабинет/Выход visible, success line shows the username`;
  } catch (e) {
    a1Ok = false;
    a1Detail = 'restore flow error: ' + (e && e.message || e);
  }
  logRow('A1 lobby restore-on-load: fresh load with a valid session cookie shows the logged-in state (GET /api/me 200)', a1Ok ? 'PASS' : 'FAIL', a1Detail);

  // ---------- console errors ----------
  const wErr = white.__consoleErrors.filter(e => !/favicon|net::ERR/i.test(e));
  const bErr = black.__consoleErrors.filter(e => !/favicon|net::ERR/i.test(e));
  const mErr = restore.__consoleErrors.filter(e => !/favicon|net::ERR/i.test(e));
  logRow('C-err no JS console/page errors on white or black page', wErr.length === 0 && bErr.length === 0 && mErr.length === 0 ? 'PASS' : 'FAIL',
    `white errors=${JSON.stringify(wErr).slice(0, 200)}; black errors=${JSON.stringify(bErr).slice(0, 200)}; lobby(restore) errors=${JSON.stringify(mErr).slice(0, 200)}`);

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
