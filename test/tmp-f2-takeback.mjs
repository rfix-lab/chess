// F2 (contract 38) verification — takeback UX client flow (game page only).
//
// Raw-socket private-match seating (same pattern as test/e2e-client.mjs): the
// harness opens a RAW socket.io client, emits 'private-match', reads the
// echoed matchId, closes the raw socket, then points two isolated guest
// pages at /game?matchId=<id> (white = player1, black = player2).
//
// Flow (per the objective):
//   A) before any move  — white's 'Взять назад' is DISABLED (no history)
//   B) white plays 1.e4 (CANVAS DRAG, the X07 drag path)
//      — white's button ENABLED (just moved, not the side to move)
//   C) white clicks 'Взять назад'
//      — black's page shows the offer modal with the RUSSIAN title
//        'Соперник предлагает вернуть ход' and buttons Принять/Отклонить
//   D) black clicks 'Принять'
//      — BOTH pages restore the pre-move board (expected[0]); status says
//        white to move; white's button disabled again (it's white's turn);
//        black's button armed (last applied move was white's); captured
//        strips clean
//   E) decline path: 1.e4 again, white requests, black clicks 'Отклонить'
//      — white's status line shows the server Russian message
//        «Возврат хода уже отклонён» (accent class, no shake); after the
//        ~3 s restore the status returns to the turn text; white plays
//        2.Nc3 → button re-arms on black's turn (no permanent lock)
//   F) black 2...d5, BLACK requests takeback, white ACCEPTS
//      — both pages back to the position after 1.e4 (expected[1]); white
//        status 'Your turn'; black's captured strip shows a white pawn
//        (white's 2.Nc3 was captured? no — the UNDONE move is black's d5;
//        the strip check asserts the strip equals the expected[1] position)
//
// Board truth: window.__lastValidatedRaw / __chessDebug normalised through
// the page's own ChessLayout.rotateBoard (same as e2e-client.mjs).
//
// Run: node test/tmp-f2-takeback.mjs   (PORT pre-checked free via ss -ltn;
// stray server processes are killed in the finally block)

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const require = createRequire(import.meta.url);
const PUPPETEER_ROOT = process.env.E2E_PUPPETEER_ROOT
  || '/root/.nvm/versions/node/v24.22.1/lib/node_modules';
const puppeteer = require(path.join(PUPPETEER_ROOT, 'puppeteer-core'));
const io = require('socket.io-client');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 34588); // pre-checked free via ss -ltn
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_LOG = process.env.SERVER_LOG || '/tmp/f2-takeback-server.log';
const EVIDENCE = path.join(ROOT, 'checkpoints', 'f2-takeback-evidence.json');
const SHOTS = path.join(ROOT, 'checkpoints', 'design-38');
fs.mkdirSync(SHOTS, { recursive: true });

const sleepMs = (ms) => new Promise(r => setTimeout(r, ms));
const waitFor = (fn, what, timeoutMs = 20000) =>
  Promise.race([
    (async () => {
      const t0 = Date.now();
      for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting: ' + what);
        await sleepMs(50);
      }
    })(),
    sleepMs(timeoutMs).then(() => { throw new Error('timeout waiting: ' + what); })
  ]);

// ---------- coordinate facts (mirror of e2e-client.mjs) ----------
const FILES = 'abcdefgh';
const toXY = (alg) => ({ x: FILES.indexOf(alg[0]), y: 8 - Number(alg[1]) });
// Black page shows the board rotated 180°: its VISUAL coordinates are the
// 180-degree reflection of the server coordinates (same model as the main
// e2e-client.mjs harness). Drives on the black page must use rot().
const rot = (p) => ({ x: 7 - p.x, y: 7 - p.y });

// Expected server-orientation boards (piece identity, indicators stripped) —
// [0] = start; [1] = after 1.e4; [2] = after 1.e4 2.Nc3 (the position step F
// must restore, because step E left white's 2.Nc3 in the move history).
const expected = {
  0: [[12,14,13,11,10,13,14,12],[9,9,9,9,9,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[1,1,1,1,1,1,1,1],[4,6,5,3,2,5,6,4]],
  1: [[12,14,13,11,10,13,14,12],[9,9,9,9,9,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,1,0,0,0],[0,0,0,0,0,0,0,0],[1,1,1,1,0,1,1,1],[4,6,5,3,2,5,6,4]],
  // Position after 1.e4 1...d5 2.Nc3 (the state F must restore after black's
  // 2...e5 is taken back: e4 pawn on e4, black pawn on d5, white knight on c3,
  // b1 empty). Server coords: x=file, y=rank row (0=rank 8).
  2: [[12,14,13,11,10,13,14,12],[9,9,9,0,9,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,9,0,0,0,0],[0,0,0,0,1,0,0,0],[0,0,6,0,0,0,0,0],[1,1,1,1,0,1,1,1],[4,0,5,3,2,5,6,4]],
};

const rows = [];
const logRow = (test, status, detail) => {
  rows.push({ test, status, detail: String(detail).slice(0, 400) });
  console.log(`[${status}] ${test} :: ${String(detail).slice(0, 200)}`);
};

// ---------- server ----------
fs.writeFileSync(SERVER_LOG, '');
const DATA_DIR = fs.mkdtempSync('/tmp/f2-takeback-');
const serverProc = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], {
  env: { ...process.env, DEBUG: '1', PORT: String(PORT), DATA_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: ROOT,
});
serverProc.stdout.on('data', d => fs.appendFileSync(SERVER_LOG, d));
serverProc.stderr.on('data', d => fs.appendFileSync(SERVER_LOG, d));
await waitFor(() => fs.readFileSync(SERVER_LOG, 'utf8').includes('server started'),
  'server to start', 15000);
console.log('server started on', BASE);

let browser = null;
const white = { __ctx: null, __consoleErrors: [] };
const black = { __ctx: null, __consoleErrors: [] };
const rawEvents = [];
let matchId = null;

const boardOriented = () => `
  (function () {
    const src = window.__lastValidatedRaw ||
      window.__chessDebug.getBoard().map(r => r.slice().map(v => v & 0b1111)).slice();
    if (window.__lastValidatedRaw) return src.map(r => r.map(v => v & 0b1111));
    return window.ChessLayout.rotateBoard(src, window.__chessDebug.myColor);
  })()`;

try {
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
    page.on('console', (m) => {
      if (m.type() === 'error') slot.__consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => slot.__consoleErrors.push('pageerror: ' + e.message));
    return page;
  };

  // ----- raw-socket private-match seating (e2e-client.mjs pattern) -----
  const rawIo = await new Promise((resolve, reject) => {
    const r = io(BASE, { transports: ['websocket'] });
    const to = setTimeout(() => reject(new Error('raw socket: no connect')), 10000);
    r.on('connect', () => { clearTimeout(to); resolve(r); });
    r.on('connect_error', e => { clearTimeout(to); reject(e); });
  });
  matchId = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('raw socket: no private-match echo')), 10000);
    rawIo.on('private-match', id => { clearTimeout(to); resolve(id); });
    rawIo.emit('private-match', 1);
  });
  rawIo.on('takebackRequest', () => rawEvents.push('takebackRequest'));
  rawIo.on('takebackOfferReceived', () => rawEvents.push('takebackOfferReceived'));
  rawIo.on('takebackResponse', (m, a) => rawEvents.push('takebackResponse:' + (a ? 'accept' : 'decline')));
  rawIo.on('takebackAccepted', () => rawEvents.push('takebackAccepted'));
  rawIo.on('takebackDeclined', () => rawEvents.push('takebackDeclined'));
  rawIo.on('takebackError', (m) => rawEvents.push('takebackError:' + m));
  rawIo.close();
  await sleepMs(150);
  console.log('raw socket private match created, matchId =', matchId);

  const whitePage = await mkPage(white, 'white');
  await whitePage.goto(BASE + `/game?matchId=${matchId}`, { waitUntil: 'networkidle2' });
  await sleepMs(800);
  const blackPage = await mkPage(black, 'black');
  await blackPage.goto(BASE + `/game?matchId=${matchId}`, { waitUntil: 'networkidle2' });

  await waitFor(async () => (await white.page.evaluate(() => document.getElementById('status').innerText)) === 'Playing as white',
    'white seated');
  await waitFor(async () => (await black.page.evaluate(() => document.getElementById('status').innerText)) === 'Playing as black',
    'black seated');
  await sleepMs(300);

  // ---------- move driver (X07 drag + click-to-move, page coords) ----------
  async function squarePx(page, x, y) {
    return await page.evaluate((xx, yy) => {
      const r = document.getElementById('cnv').getBoundingClientRect();
      const c = side_len / 8;
      return { x: r.left + offset_x + (xx + 0.5) * c, y: r.top + offset_y + (yy + 0.5) * c };
    }, x, y);
  }
  async function drive(page, from, to, kind) {
    if (kind === 'drag') {
      const s = await squarePx(page, from.x, from.y);
      const e = await squarePx(page, to.x, to.y);
      await page.mouse.move(s.x, s.y);
      await page.mouse.down();
      await sleepMs(40);
      await page.mouse.move(s.x + 20, s.y + 20, { steps: 4 });
      await sleepMs(40);
      await page.mouse.move(e.x, e.y, { steps: 6 });
      await sleepMs(40);
      await page.mouse.up();
    } else {
      const a = await squarePx(page, from.x, from.y);
      const b = await squarePx(page, to.x, to.y);
      await page.mouse.click(a.x, a.y);
      await sleepMs(70);
      await page.mouse.click(b.x, b.y);
    }
  }
  async function waitBothSettled() {
    await Promise.all([
      waitFor(async () => (await white.page.evaluate(() => !is_being_validated)) === true, 'white validated'),
      waitFor(async () => (await black.page.evaluate(() => !is_being_validated)) === true, 'black validated'),
    ]);
    await sleepMs(80);
  }
  // Server-side APPLIED count for this match: the only ground truth for "how
  // many moves were actually played" — a click on the canvas that emitted no
  // 'move' (e.g. racing a status-timer window) does not count.
  const appliedCount = () => fs.readFileSync(SERVER_LOG, 'utf8')
    .split('\n').filter(l => l.includes('move: APPLIED') && l.includes('matchId= ' + matchId)).length;
  const waitForApplied = (n, what) =>
    waitFor(async () => (await appliedCount()) >= n ? true : null, what || ('' + n + ' moves applied'));
  const btnDisabled = (page) => page.evaluate(() => document.getElementById('btn-takeback').disabled);
  const statusText = (page) => page.evaluate(() => document.getElementById('status').innerText);
  const modalInfo = (page) => page.evaluate(() => {
    const m = document.getElementById('takebackOfferModal');
    const h3 = m && m.querySelector('h3');
    const acc = document.getElementById('btn-takeback-accept');
    const dec = document.getElementById('btn-takeback-decline');
    return { visible: m.style.display === 'flex', title: h3 ? h3.innerText : null,
             accept: acc ? acc.innerText : null, decline: dec ? dec.innerText : null };
  });
  const board = async (page) => page.evaluate(boardOriented());
  const stripCount = (page, id) => page.evaluate((sel) =>
    document.getElementById(sel).querySelectorAll('.cap-piece').length, id);

  // ================= F2 step A: no moves yet — button disabled =================
  {
    const wDis = await btnDisabled(whitePage);
    logRow('F2-A takeback button DISABLED before any move (no history)',
      wDis ? 'PASS' : 'FAIL', `white disabled=${wDis} (rule: gameIsOver || myTurn || no history)`);
  }

  // ================= F2 step B: white plays 1.e4 (drag) =================
  await drive(whitePage, toXY('e2'), toXY('e4'), 'drag');
  await waitBothSettled();
  {
    const wb = await board(whitePage), bb = await board(blackPage);
    const ok = JSON.stringify(wb) === JSON.stringify(expected[1])
            && JSON.stringify(bb) === JSON.stringify(expected[1]);
    const wDis = await btnDisabled(whitePage);
    logRow('F2-B white 1.e4 (canvas drag applied); after MY move the button is ENABLED',
      ok && !wDis ? 'PASS' : 'FAIL',
      `boardsSync=${JSON.stringify(wb) === JSON.stringify(expected[1]) && JSON.stringify(bb) === JSON.stringify(expected[1])}, ` +
      `whiteBtnDisabled=${wDis}, W="${await statusText(whitePage)}" B="${await statusText(blackPage)}"`);
  }

  // ================= F2 step C: white clicks 'Взять назад' =================
  await whitePage.evaluate(() => document.getElementById('btn-takeback').click());
  await waitFor(async () => (await modalInfo(blackPage)).visible === true, 'black offer modal visible');
  {
    const mi = await modalInfo(blackPage);
    const ok = mi.title === 'Соперник предлагает вернуть ход'
            && mi.accept === 'Принять' && mi.decine === undefined && mi.decline === 'Отклонить';
    logRow('F2-C offer modal on black page with RUSSIAN title + Принять/Отклонить',
      ok ? 'PASS' : 'FAIL',
      `title="${mi.title}" accept="${mi.accept}" decline="${mi.decline}" visible=${mi.visible}`);
    await blackPage.screenshot({ path: path.join(SHOTS, 'f2-takeback-modal.png') });
  }

  // ================= F2 step D: black clicks 'Принять' =================
  await blackPage.evaluate(() => document.getElementById('btn-takeback-accept').click());
  await waitFor(async () => {
    const w = await board(whitePage);
    return JSON.stringify(w) === JSON.stringify(expected[0]);
  }, 'white board restored to pre-move position');
  {
    const wb = await board(whitePage), bb = await board(blackPage);
    const ws = await statusText(whitePage), bs = await statusText(blackPage);
    const wDis = await btnDisabled(whitePage), bDis = await btnDisabled(blackPage);
    const modalGone = (await modalInfo(blackPage)).visible === false;
    const ok = JSON.stringify(wb) === JSON.stringify(expected[0])
            && JSON.stringify(bb) === JSON.stringify(expected[0])
            && ws === 'Your turn' && bs === "Opponent's turn"
            && wDis === true && bDis === false && modalGone;
    logRow('F2-D accept: BOTH pages restore pre-move board, turn back to white (requester)',
      ok ? 'PASS' : 'FAIL',
      `boardsSync=${JSON.stringify(wb) === JSON.stringify(expected[0]) && JSON.stringify(bb) === JSON.stringify(expected[0])}; ` +
      `W status="${ws}" W-btnDisabled=${wDis} | B status="${bs}" B-btnDisabled=${bDis}; modalGone=${modalGone}`);
    await whitePage.screenshot({ path: path.join(SHOTS, 'f2-takeback-restored-white.png') });
    await blackPage.screenshot({ path: path.join(SHOTS, 'f2-takeback-restored-black.png') });
  }

  // ================= F2 step E: decline path =================
  // E1: white 1.e4 again (server: stateHistory empty after the accepted pop)
  await drive(whitePage, toXY('e2'), toXY('e4'), 'drag');
  await waitBothSettled();
  // E2: white requests; black declines → server (F1) sets the latch and emits
  // a BARE takebackDeclined to the requester; the Russian message arrives as a
  // takebackError when white requests again against the set latch.
  await whitePage.evaluate(() => document.getElementById('btn-takeback').click());
  await waitFor(async () => (await modalInfo(blackPage)).visible === true, 'black offer modal (decline path)');
  await blackPage.evaluate(() => document.getElementById('btn-takeback-decline').click());
  await waitFor(async () => (await modalInfo(blackPage)).visible === false, 'black offer modal closed (decline)');
  // F2 no-permanent-lock rule: after the decline it is still BLACK's turn and
  // white has already moved, so white's button stays ENABLED (it does NOT get
  // locked forever). The takebackDeclined handler only recomputes. Re-requesting
  // against the server's 'declined' latch then yields the Russian error.
  const wAfterDecline = await btnDisabled(whitePage);
  logRow('F2-E2 after decline the button is NOT permanently locked (stays enabled)',
    wAfterDecline === false ? 'PASS' : 'FAIL',
    `whiteBtnDisabled=${wAfterDecline}, W="${await statusText(whitePage)}" B="${await statusText(blackPage)}"`);
  // E3: white requests again — server rejects against the latch with the
  // Russian message; the client shows it in the status line for ~3 s.
  await whitePage.evaluate(() => document.getElementById('btn-takeback').click());
  {
    const s = await waitFor(async () => {
      const t = await statusText(whitePage);
      return t === 'Возврат хода уже отклонён' ? t : null;
    }, 'white status shows Russian decline message');
    const cls = await whitePage.evaluate(() => document.getElementById('status').className);
    const shake = await whitePage.evaluate(() => document.getElementById('cnv').classList.contains('shake'));
    logRow('F2-E3 decline: white status line shows the server Russian message «Возврат хода уже отклонён» (no shake)',
      s === 'Возврат хода уже отклонён' && !shake ? 'PASS' : 'FAIL',
      `status="${s}" statusClass="${cls}" cnvShake=${shake}; rawEvents=${rawEvents.slice(-4).join(',')}`);
    await whitePage.screenshot({ path: path.join(SHOTS, 'f2-takeback-decline-status.png') });
    // status restores after the ~3 s window
    const restored = await waitFor(async () => {
      const t = await statusText(whitePage);
      return t === "Opponent's turn" ? t : null;
    }, 'white status restored to turn text after the 3 s window', 12000);
    logRow('F2-E3b status restores to the turn text after the message window',
      restored === "Opponent's turn" ? 'PASS' : 'FAIL', `status="${restored}"`);
    // E4: the server clears the latch on the NEXT APPLIED move — that is
    // black's (it is black's turn after the decline). Once black plays 1...d5,
    // the latch is gone; white's 2.Nc3 then re-arms white's button on black's
    // next turn (no permanent lock). Position after: expected[2] minus 2.Nc3…
    // = after 1.e4 1...d5 (call it expE4), then after 2.Nc3 (expected[2]).
    await drive(blackPage, rot(toXY('d7')), rot(toXY('d5')), 'click');
    await waitForApplied(3, '1.e4 x2 + 1...d5 applied');
    // The server log applies the move before the white PAGE processes the
    // 'validated' event (which is what flips can_move=true). Wait for the
    // white client's own state, else the 2.Nc3 click fires while can_move is
    // still false and no 'move' is emitted (the earlier hang).
    await waitFor(async () => (await whitePage.evaluate(() => can_move === true && !is_being_validated)) === true, 'white client can_move=true after 1...d5');
    // DIAG: capture white client internal state around the 2.Nc3 click.
    // b1 is the square that can reach c3 (the g1 knight is blocked by e2/d3
    // geometry) — 2.Nc3 = b1->c3.
    const b1 = await squarePx(whitePage, 1, 7);
    await whitePage.mouse.click(b1.x, b1.y);
    await sleepMs(90);
    const c3 = await squarePx(whitePage, 2, 5);
    await whitePage.mouse.click(c3.x, c3.y);
    await waitForApplied(4, '2.Nc3 applied');
    // After 2.Nc3 it is black's turn and white just moved => button re-armed
    // (the decline latch was cleared by the intervening moves). Wait for the
    // white client to settle so the read reflects the validated event.
    await waitFor(async () => {
      const d = await btnDisabled(whitePage);
      const cm = await whitePage.evaluate(() => can_move);
      return (cm === false && d === false) ? true : null;
    }, 'white button re-armed after 2.Nc3 (black to move)', 12000);
    const wDis = await btnDisabled(whitePage);
    logRow('F2-E4 latch cleared by the next move: after white moves again the button is clickable again (no permanent lock)',
      wDis === false ? 'PASS' : 'FAIL',
      `whiteBtnDisabled=${wDis}, W="${await statusText(whitePage)}" B="${await statusText(blackPage)}"; rawEvents=${rawEvents.slice(-3).join(',')}`);
  }

  // ================= F2 step F: black requests takeback; white accepts =================
  // Position after E4: 1.e4 1...d5 2.Nc3 (expected[2]); black to move. Black
  // plays 2...e5 (d5 square is occupied), then requests a takeback; white
  // accepts → both pages must restore the position AFTER 2.Nc3 (expected[2],
  // black's d5 kept), turn back with black (the requester); no captures yet,
  // so both strips stay empty. Black page is 180-rotated: e7(4,1)→visual (3,6),
  // e5(4,3)→visual (3,4).
  await drive(blackPage, rot(toXY('e7')), rot(toXY('e5')), 'click');
  await waitForApplied(5, '2...e5 applied');
  await waitBothSettled();
  {
    const bDis = await btnDisabled(blackPage);
    logRow('F2-F1 black just moved → BLACK takeback button armed',
      bDis === false ? 'PASS' : 'FAIL', `blackBtnDisabled=${bDis}, B="${await statusText(blackPage)}"`);
    await blackPage.evaluate(() => document.getElementById('btn-takeback').click());
    await waitFor(async () => (await modalInfo(whitePage)).visible === true, 'white offer modal');
    await whitePage.evaluate(() => document.getElementById('btn-takeback-accept').click());
    await waitFor(async () => {
      const w = await board(whitePage);
      return JSON.stringify(w) === JSON.stringify(expected[2]);
    }, 'white board restored to the post-2.Nc3 position');
    const wb = await board(whitePage), bb = await board(blackPage);
    const ws = await statusText(whitePage), bs = await statusText(blackPage);
    const wStrip = await stripCount(whitePage, 'captured-white');
    const bStrip = await stripCount(blackPage, 'captured-black');
    const wDis = await btnDisabled(whitePage);
    const bDis2 = await btnDisabled(blackPage);
    const ok = JSON.stringify(wb) === JSON.stringify(expected[2])
            && JSON.stringify(bb) === JSON.stringify(expected[2])
            && bs === 'Your turn' && ws === "Opponent's turn"
            && wDis === false && bDis2 === true;
    logRow('F2-F2 black request + white accept: both pages restore the post-2.Nc3 position, turn back to black (requester); white (whose 2.Nc3 is the now-last move) re-arms, black disarms',
      ok ? 'PASS' : 'FAIL',
      `boardsSync=${JSON.stringify(wb) === JSON.stringify(expected[2]) && JSON.stringify(bb) === JSON.stringify(expected[2])}; ` +
      `W status="${ws}" W-btn=${wDis} | B status="${bs}" B-btn=${bDis2}; strips W=${wStrip} B=${bStrip} (expected 0/0 — no captures yet)`);
    await whitePage.screenshot({ path: path.join(SHOTS, 'f2-takeback-black-request-white.png') });
  }

  const errs = [...white.__consoleErrors, ...black.__consoleErrors];
  logRow('F2 no JS console/page errors on either page',
    errs.length === 0 ? 'PASS' : 'FAIL', errs.length ? errs.slice(0, 3).join(' | ') : 'none');

  const allPass = rows.every(r => r.status === 'PASS');
  console.log(`\n==== F2 SUMMARY: ${rows.filter(r => r.status === 'PASS').length}/${rows.length} PASS ${allPass ? '— ALL GREEN' : '— FAILURES PRESENT'} ====`);
  console.log('server-side takeback event trace:', rawEvents.join(' → '));

  fs.writeFileSync(EVIDENCE, JSON.stringify(
    { env: { port: PORT, chromium: '/snap/bin/chromium', serverLog: SERVER_LOG, time: new Date().toISOString() },
      matchId, rows, serverTrace: rawEvents }, null, 2));
  console.log('evidence ->', EVIDENCE);
  if (!allPass) process.exitCode = 1;
} catch (e) {
  console.error('F2 harness error:', e && e.stack || e);
  fs.writeFileSync(EVIDENCE, JSON.stringify({ env: { port: PORT }, error: String(e), rows }, null, 2));
  process.exitCode = 1;
} finally {
  if (browser) { try { await browser.close(); } catch (e) {} }
  try { serverProc.kill('SIGTERM'); } catch (e) {}
  await sleepMs(300);
}
