// F3 (contract 38) verification — capture/check click SFX wiring (game page).
//
// Raw-socket private-match seating (same pattern as test/e2e-client.mjs and
// tmp-f2-takeback.mjs): a RAW socket.io client emits 'private-match', reads the
// echoed matchId, closes the raw socket, then points isolated guest pages at
// /game?matchId=<id> (white = player1, black = player2).
//
// Audio capture: BEFORE page scripts load, evaluateOnNewDocument patches
// HTMLAudioElement.prototype.play to push {src, t: performance.now()} into
// window.__played and return Promise.resolve() (no real audio / autoplay race).
//
// Lines played (per the objective):
//   Match A (quiet + capture + takeback-decline):
//     (a) white 1.e4          -> move-self.mp3 played, NO click.mp3
//     (d) white requests takeback, BLACK declines -> white #status shows
//             'Соперник отказался возвращать ход' (F2 status helper, ~3 s)
//     (b) black 1...d5, white 2.exd5 -> capture: click.mp3 count +1 (no check)
//   Match B (clean check, no capture):
//     (c) white 1.Nc3, black 1...e5, white 2.Nf6+ -> check: EXACTLY 2
//         click.mp3 entries within <300 ms on that move
//
// Board truth: window.__lastValidatedRaw / __chessDebug normalised through the
// page's own ChessLayout.rotateBoard (server orientation, indicators stripped).
//
// Run: node test/tmp-f3-audio.mjs   (PORT pre-checked free via ss -ltn; the
// spawned server is killed in the finally block)

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
const PORT = Number(process.env.PORT || 39711); // pre-checked free via ss -ltn
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_LOG = process.env.SERVER_LOG || '/tmp/f3-audio-server.log';
const EVIDENCE = path.join(ROOT, 'checkpoints', 'design-38', 'f3-audio-evidence.json');
fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });

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

// ---------- coordinate facts (mirror of e2e-client.mjs / tmp-f2) ----------
const FILES = 'abcdefgh';
const toXY = (alg) => ({ x: FILES.indexOf(alg[0]), y: 8 - Number(alg[1]) });
const rot = (p) => ({ x: 7 - p.x, y: 7 - p.y }); // black page is 180-rotated

// Server-orientation boards, piece identity only (indicators stripped) —
// generated with the server's own engine (src/lib/chessutils.js).
const expected = {
  after_e4:     [[12,14,13,11,10,13,14,12],[9,9,9,9,9,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,1,0,0,0],[0,0,0,0,0,0,0,0],[1,1,1,1,0,1,1,1],[4,6,5,3,2,5,6,4]],
  after_d5:     [[12,14,13,11,10,13,14,12],[9,9,9,0,9,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,9,0,0,0,0],[0,0,0,0,1,0,0,0],[0,0,0,0,0,0,0,0],[1,1,1,1,0,1,1,1],[4,6,5,3,2,5,6,4]],
  after_exd5:   [[12,14,13,11,10,13,14,12],[9,9,9,0,9,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,1,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[1,1,1,1,0,1,1,1],[4,6,5,3,2,5,6,4]],
  after_Nc3:    [[12,14,13,11,10,13,14,12],[9,9,9,9,9,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,6,0,0,0,0],[1,1,1,1,1,1,1],[4,0,5,3,2,5,6,4]],
  after_e5:     [[12,14,13,11,10,13,14,12],[9,9,9,9,0,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,0,9,0,0],[0,0,0,0,0,0,0],[0,0,6,0,0,0,0],[1,1,1,1,1,1,1],[4,0,5,3,2,5,6,4]],
  after_Nf6:    [[12,14,13,11,10,13,14,12],[9,9,9,9,0,9,9,9],[0,0,0,0,0,6,0],[0,0,0,0,9,0,0],[0,0,0,0,0,0,0],[0,0,6,0,0,0,0],[1,1,1,1,1,1,1],[4,0,5,3,2,5,6,4]],
  // Fool's-mate check line (test c) — all moves legal in this engine, check on
  // the final move, NO capture: 1.f3 1...e6 2.g4 2...Qh4+ (white king in check)
  after_1f3:    [[12,14,13,11,10,13,14,12],[9,9,9,9,9,9,9,9],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,1,0,0],[1,1,1,1,1,0,1,1],[4,6,5,3,2,5,6,4]],
  after_e6:     [[12,14,13,11,10,13,14,12],[9,9,9,9,0,9,9,9],[0,0,0,0,9,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,1,0,0],[1,1,1,1,1,0,1,1],[4,6,5,3,2,5,6,4]],
  after_g4:     [[12,14,13,11,10,13,14,12],[9,9,9,9,0,9,9,9],[0,0,0,0,9,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,1,0],[0,0,0,0,0,1,0,0],[1,1,1,1,1,0,0,1],[4,6,5,3,2,5,6,4]],
  after_Qh4:    [[12,14,13,0,10,13,14,12],[9,9,9,9,0,9,9,9],[0,0,0,0,9,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,1,11],[0,0,0,0,0,1,0,0],[1,1,1,1,1,0,0,1],[4,6,5,3,2,5,6,4]],
};

const rows = [];
const playedBySrc = (entries, src) => entries.filter(e => e.src.split('/').pop() === src).length;
const logRow = (test, status, detail) => {
  rows.push({ test, status, detail: String(detail).slice(0, 900) });
  console.log(`[${status}] ${test} :: ${String(detail).slice(0, 180)}`);
};

// ---------- server ----------
fs.writeFileSync(SERVER_LOG, '');
const DATA_DIR = fs.mkdtempSync('/tmp/f3-audio-');
const serverProc = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], {
  env: { ...process.env, DEBUG: '1', PORT: String(PORT), DATA_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: ROOT,
});
serverProc.stdout.on('data', d => fs.appendFileSync(SERVER_LOG, d));
serverProc.stderr.on('data', d => fs.appendFileSync(SERVER_LOG, d));
await waitFor(() => fs.readFileSync(SERVER_LOG, 'utf8').includes('server started'), 'server to start', 15000);
console.log('server started on', BASE);

const boardOriented = () => `
  (function () {
    const src = window.__lastValidatedRaw ||
      window.__chessDebug.getBoard().map(r => r.slice().map(v => v & 0b1111)).slice();
    if (window.__lastValidatedRaw) return src.map(r => r.map(v => v & 0b1111));
    return window.ChessLayout.rotateBoard(src, window.__chessDebug.myColor);
  })()`;
const appliedCount = () => fs.readFileSync(SERVER_LOG, 'utf8')
  .split('\n').filter(l => l.includes('move: APPLIED') && l.includes('matchId= ' + (matchId || ''))).length;
const waitForApplied = (n, what) => waitFor(async () => (await appliedCount()) >= n ? true : null, what || (n + ' moves applied'));

// The AUDIO stub installed before any page script runs.
const AUDIO_STUB = () => {
  window.__played = [];
  try {
    const proto = HTMLAudioElement.prototype;
    const orig = proto.play;
    proto.play = function () {
      try { window.__played.push({ src: this.src, t: performance.now() }); } catch (e) {}
      return Promise.resolve();
    };
  } catch (e) {}
};

let browser = null;
let matchA = null, matchB = null;
let matchId = null; // current match id (bound per match) — read by appliedCount()
let whiteA = { page: null, __consoleErrors: [] }, blackA = { page: null, __consoleErrors: [] };
let whiteB = { page: null, __consoleErrors: [] }, blackB = { page: null, __consoleErrors: [] };

const mkPage = async (slot, name) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 800, height: 900, deviceScaleFactor: 1 });
  slot.__ctx = ctx;
  slot.page = page;
  page.__name = name;
  page.on('console', (m) => { if (m.type() === 'error') slot.__consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => slot.__consoleErrors.push('pageerror: ' + e.message));
  // Install the audio stub BEFORE the page's own scripts load.
  await page.evaluateOnNewDocument(AUDIO_STUB);
  return page;
};

// raw-socket private-match seating (e2e-client.mjs pattern)
async function seatPrivateMatch(slotWhite, slotBlack) {
  const rawIo = await new Promise((resolve, reject) => {
    const r = io(BASE, { transports: ['websocket'] });
    const to = setTimeout(() => reject(new Error('raw socket: no connect')), 10000);
    r.on('connect', () => { clearTimeout(to); resolve(r); });
    r.on('connect_error', e => { clearTimeout(to); reject(e); });
  });
  const id = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('raw socket: no private-match echo')), 10000);
    rawIo.on('private-match', (mid) => { clearTimeout(to); resolve(mid); });
    rawIo.emit('private-match', 1);
  });
  rawIo.close();
  await sleepMs(150);
  const wp = await mkPage(slotWhite, 'white');
  await wp.goto(BASE + `/game?matchId=${id}`, { waitUntil: 'networkidle2' });
  await sleepMs(700);
  const bp = await mkPage(slotBlack, 'black');
  await bp.goto(BASE + `/game?matchId=${id}`, { waitUntil: 'networkidle2' });
  await waitFor(async () => (await wp.evaluate(() => document.getElementById('status').innerText)) === 'Playing as white', 'white seated');
  await waitFor(async () => (await bp.evaluate(() => document.getElementById('status').innerText)) === 'Playing as black', 'black seated');
  await sleepMs(300);
  return { wp, bp };
}

try {
  browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required'],
    dumpio: false,
  });

  // ===================== MATCH A: quiet + capture + takeback decline =====================
  {
    ({ wp: whiteA.page, bp: blackA.page } = await seatPrivateMatch(whiteA, blackA));
    // recover the match id from the seated page (it is in the URL) for the APPLIED counter
    matchA = await whiteA.page.evaluate(() => matchId);
    matchId = matchA;

    const squarePx = (page, x, y) => page.evaluate((xx, yy) => {
      const r = document.getElementById('cnv').getBoundingClientRect();
      const c = side_len / 8;
      return { x: r.left + offset_x + (xx + 0.5) * c, y: r.top + offset_y + (yy + 0.5) * c };
    }, x, y);
    async function drive(page, from, to) {
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
    }
    const statusText = (page) => page.evaluate(() => document.getElementById('status').innerText);
    const readPlayed = (page) => page.evaluate(() => (window.__played || []).slice());
    const board = (page) => page.evaluate(boardOriented());

    // ---- (a) white 1.e4 — QUIET move: move-self.mp3 played, NO click.mp3 ----
    let base = await readPlayed(whiteA.page).then(a => a.length);
    await drive(whiteA.page, toXY('e2'), toXY('e4'), );
    await waitForApplied(1, '1.e4 applied');
    await waitFor(async () => (await whiteA.page.evaluate(() => !is_being_validated && can_move === false)) === true, 'white settled after 1.e4');
    await sleepMs(350); // let any (nonexistent) check double-click window close
    const deltaA = (await readPlayed(whiteA.page)).slice(base);
    const wBoardA = await board(whiteA.page), bBoardA = await board(blackA.page);
    const boardsOk = JSON.stringify(wBoardA) === JSON.stringify(expected.after_e4)
                  && JSON.stringify(bBoardA) === JSON.stringify(expected.after_e4);
    const aMove = playedBySrc(deltaA, 'move-self.mp3'), aClick = playedBySrc(deltaA, 'click.mp3');
    const aWrong = playedBySrc(deltaA, 'wrong_move_sound.mp3');
    logRow('(a) white 1.e4 (quiet) -> move-self.mp3 played, NO click.mp3',
      aMove === 1 && aClick === 0 && aWrong === 0 && boardsOk ? 'PASS' : 'FAIL',
      `white __played delta=[${deltaA.map(e => e.src.split('/').pop()).join(',')}] move-self=${aMove} (want 1) click=${aClick} (want 0) wrong=${aWrong} (want 0); boardsSync=${boardsOk}; W="${await statusText(whiteA.page)}"`);
    (whiteA.__playedAfterA = deltaA);

    // ---- (d) takeback decline: white requests (just moved), BLACK declines ----
    //    -> white #status shows 'Соперник отказался возвращать ход' for ~3 s
    await whiteA.page.evaluate(() => document.getElementById('btn-takeback').click());
    await waitFor(async () => (await blackA.page.evaluate(() => document.getElementById('takebackOfferModal').style.display)) === 'flex', 'black takeback offer modal');
    await blackA.page.evaluate(() => document.getElementById('btn-takeback-decline').click());
    const declinedStatus = await waitFor(async () => {
      const t = await statusText(whiteA.page);
      return t === 'Соперник отказался возвращать ход' ? t : null;
    }, 'white status shows the decline message');
    const dCls = await whiteA.page.evaluate(() => document.getElementById('status').className);
    const dShake = await whiteA.page.evaluate(() => document.getElementById('cnv').classList.contains('shake'));
    logRow('(d) takeback declined -> white #status shows «Соперник отказался возвращать ход» (~3 s, F2 helper)',
      declinedStatus === 'Соперник отказался возвращать ход' ? 'PASS' : 'FAIL',
      `white status="${declinedStatus}" statusClass="${dCls}" cnvShake=${dShake}; black status="${await statusText(blackA.page)}"`);

    // the decline does not move the piece; it is still BLACK's turn (1.e4 stands).
    // Black plays 1...d5 (the capture line needs the black pawn on d5) — this
    // also clears the decline latch on the server, so white's 2.exd5 is legal.
    await waitFor(async () => (await blackA.page.evaluate(() => !is_being_validated && can_move === true)) === true, 'black can move after decline', 15000);
    // (black page is rotated: d7->visual rot, d5->visual rot)
    await drive(blackA.page, rot(toXY('d7')), rot(toXY('d5')));
    await waitForApplied(2, '1...d5 applied');
    await waitFor(async () => (await whiteA.page.evaluate(() => !is_being_validated && can_move === true)) === true, 'white can move after 1...d5');
    await sleepMs(120);

    // ---- (b) white 2.exd5 — CAPTURE (not check): click.mp3 count +1 ----
    base = await readPlayed(whiteA.page).then(a => a.length);
    await drive(whiteA.page, toXY('e4'), toXY('d5'));
    await waitForApplied(3, '2.exd5 applied');
    await waitFor(async () => (await whiteA.page.evaluate(() => !is_being_validated && can_move === false)) === true, 'white settled after 2.exd5');
    await sleepMs(350);
    const deltaB = (await readPlayed(whiteA.page)).slice(base);
    const wBoardB = await board(whiteA.page), bBoardB = await board(blackA.page);
    const boardsCapOk = JSON.stringify(wBoardB) === JSON.stringify(expected.after_exd5)
                    && JSON.stringify(bBoardB) === JSON.stringify(expected.after_exd5);
    const bClick = playedBySrc(deltaB, 'click.mp3'), bMove = playedBySrc(deltaB, 'move-self.mp3');
    logRow('(b) white 2.exd5 (capture, no check) -> click.mp3 count +1, no move-self, no double-click',
      bClick === 1 && bMove === 0 && boardsCapOk ? 'PASS' : 'FAIL',
      `white __played delta=[${deltaB.map(e => e.src.split('/').pop()).join(',')}] click=${bClick} (want 1) move-self=${bMove} (want 0); boardsSync=${boardsCapOk}; W="${await statusText(whiteA.page)}"`);
    (whiteA.__playedAfterB = deltaB);

    // full per-move transcript for the report (white page, match A)
    whiteA.__fullPlayed = await readPlayed(whiteA.page);
  }

  // ===================== MATCH B: clean check -> exactly 2 clicks <300 ms =====================
  {
    ({ wp: whiteB.page, bp: blackB.page } = await seatPrivateMatch(whiteB, blackB));
    matchB = await whiteB.page.evaluate(() => matchId);
    matchId = matchB;

    const squarePx = (page, x, y) => page.evaluate((xx, yy) => {
      const r = document.getElementById('cnv').getBoundingClientRect();
      const c = side_len / 8;
      return { x: r.left + offset_x + (xx + 0.5) * c, y: r.top + offset_y + (yy + 0.5) * c };
    }, x, y);
    async function drive(page, from, to) {
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
    }
    const statusText = (page) => page.evaluate(() => document.getElementById('status').innerText);
    const readPlayed = (page) => page.evaluate(() => (window.__played || []).slice());
    const board = (page) => page.evaluate(boardOriented());

    // 1.f3 (quiet, white page)
    await drive(whiteB.page, toXY('f2'), toXY('f3'));
    await waitForApplied(1, '1.f3 applied');
    await waitFor(async () => (await whiteB.page.evaluate(() => !is_being_validated && can_move === false)) === true, 'white settled after 1.f3');
    // 1...e6 (quiet, black page rotated: e7->visual, e6->visual)
    await waitFor(async () => (await blackB.page.evaluate(() => can_move === true)) === true, 'black can move');
    await drive(blackB.page, rot(toXY('e7')), rot(toXY('e6')));
    await waitForApplied(2, '1...e6 applied');
    await waitFor(async () => (await whiteB.page.evaluate(() => !is_being_validated && can_move === true)) === true, 'white can move after 1...e6');
    await sleepMs(120);
    // 2.g4 (quiet, white page)
    await drive(whiteB.page, toXY('g2'), toXY('g4'));
    await waitForApplied(3, '2.g4 applied');
    await waitFor(async () => (await blackB.page.evaluate(() => !is_being_validated && can_move === true)) === true, 'black can move after 2.g4');
    await sleepMs(120);

    // 2...Qh4+ — CHECK on white's king (Fool's mate), NOT a capture.
    // (black page rotated: d8->visual, h4->visual). Qh4+ is checkmate in this
    // engine; the 'validated' handler fires the check double-click off the
    // board BEFORE the checkmate modal blocks anything, so both pages must
    // log exactly two click.mp3 entries.
    let base = await readPlayed(blackB.page).then(a => a.length);
    await drive(blackB.page, rot(toXY('d8')), rot(toXY('h4')));
    await waitForApplied(4, '2...Qh4+ applied');
    await waitFor(async () => (await blackB.page.evaluate(() => !is_being_validated)) === true, 'black settled after 2...Qh4+');
    await sleepMs(450); // second click lands at +100 ms; wait well past it
    const deltaC = (await readPlayed(blackB.page)).slice(base);

    const wBoardC = await board(whiteB.page), bBoardC = await board(blackB.page);
    const boardsChkOk = JSON.stringify(wBoardC) === JSON.stringify(expected.after_Qh4)
                    && JSON.stringify(bBoardC) === JSON.stringify(expected.after_Qh4);
    const cClicks = deltaC.filter(e => e.src.split('/').pop() === 'click.mp3');
    const cMove = playedBySrc(deltaC, 'move-self.mp3');
    let span = null, spanOk = false;
    if (cClicks.length === 2) {
      span = Math.round(cClicks[1].t - cClicks[0].t);
      spanOk = span < 300 && span > 0;
    }
    logRow('(c) black 2...Qh4+ (check on white king, no capture) -> EXACTLY 2 click.mp3 within <300 ms',
      cClicks.length === 2 && spanOk && cMove === 1 && boardsChkOk ? 'PASS' : 'FAIL',
      `black __played delta=[${deltaC.map(e => e.src.split('/').pop() + '@' + Math.round(e.t)).join(',')}] click=${cClicks.length} (want 2) clickSpanMs=${span} (want <300) move-self=${cMove} (want 1 — black's own quiet move); boardsSync=${boardsChkOk}; W="${await statusText(whiteB.page)}" B="${await statusText(blackB.page)}"`);
    whiteB.__playedAfterC = deltaC;
    whiteB.__fullPlayed = await readPlayed(blackB.page);
    // also record the white page's double-click (both pages detect the check)
    whiteB.__whiteDeltaC = (await readPlayed(whiteB.page)).filter(e => e.src.split('/').pop() === 'click.mp3');
  }

  const errs = [...whiteA.__consoleErrors, ...blackA.__consoleErrors, ...whiteB.__consoleErrors, ...blackB.__consoleErrors];
  logRow('No JS console/page errors on any page',
    errs.length === 0 ? 'PASS' : 'FAIL', errs.length ? errs.slice(0, 4).join(' | ') : 'none');

  const allPass = rows.every(r => r.status === 'PASS');
  console.log(`\n==== F3 SUMMARY: ${rows.filter(r => r.status === 'PASS').length}/${rows.length} PASS ${allPass ? '— ALL GREEN' : '— FAILURES PRESENT'} ====`);

  fs.writeFileSync(EVIDENCE, JSON.stringify({
    env: { port: PORT, chromium: '/snap/bin/chromium', serverLog: SERVER_LOG, time: new Date().toISOString() },
    matches: { A: matchA, B: matchB },
    rows,
    playedTranscripts: {
      matchA_white: {
        after_1e4_quiet: whiteA.__playedAfterA || null,
        after_2exd5_capture: whiteA.__playedAfterB || null,
        full: whiteA.__fullPlayed || null,
      },
      matchB_white: {
        after_2Nf6_check: whiteB.__playedAfterC || null,
        full: whiteB.__fullPlayed || null,
        black_clicks_on_check: whiteB.__blackDeltaC || null,
      },
    },
  }, null, 2));
  console.log('evidence ->', EVIDENCE);
  if (!allPass) process.exitCode = 1;
} catch (e) {
  console.error('F3 harness error:', e && e.stack || e);
  fs.writeFileSync(EVIDENCE, JSON.stringify({ env: { port: PORT }, error: String(e), rows }, null, 2));
  process.exitCode = 1;
} finally {
  if (browser) { try { await browser.close(); } catch (e) {} }
  try { serverProc.kill('SIGTERM'); } catch (e) {}
  await sleepMs(300);
}
