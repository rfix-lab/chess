// Repro: user report 2026-11-23 — guests in TWO TABS OF THE SAME BROWSER
// (shared localStorage!) — black can't move until refresh; then opponent
// moves visible only after refresh; wrong move highlights.
// Audit used two ISOLATED browser contexts, which masks shared-storage bugs.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('/root/.nvm/versions/node/v24.22.1/lib/node_modules/puppeteer-core');
const BASE = process.argv[2] || 'https://mycheserv.duckdns.org';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(pg, fn, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await pg.evaluate(fn)) return true; } catch (e) {}
    await sleep(250);
  }
  return false;
}

const results = [];
function check(name, ok, info = '') {
  results.push([ok, name, info]);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${info ? ' :: ' + info : ''}`);
}

async function clickMove(pg, color, from, to) {
  // server coords: file a-h -> 0-7, rank 1-8 -> row 7-0
  const sq = s => [s.charCodeAt(0) - 97, 8 - Number(s[1])];
  const pt = async (x, y) => pg.evaluate((col, sx, sy) => {
    const r = document.getElementById('cnv').getBoundingClientRect();
    const c = side_len / 8;
    const [vx, vy] = col === 1 ? [7 - sx, 7 - sy] : [sx, sy];
    return { x: r.left + offset_x + (vx + 0.5) * c, y: r.top + offset_y + (vy + 0.5) * c };
  }, color, x, y);
  const p1 = await pt(...sq(from)), p2 = await pt(...sq(to));
  await pg.mouse.click(p1.x, p1.y);
  await sleep(150);
  await pg.mouse.click(p2.x, p2.y);
}

// board in SERVER orientation (undo the black tab's visual rotation), masked
const serverBoard = pg => pg.evaluate(() =>
  window.ChessLayout.rotateBoard(window.__chessDebug.getBoard(), window.__chessDebug.myColor)
    .map(r => r.map(v => v & 15)));

const status = pg => pg.evaluate(() => document.getElementById('status')?.innerText || '?');
const boardOf = pg => pg.evaluate(() => window.__chessDebug ? window.__chessDebug.getBoard().map(r => r.map(v => v & 15)) : null);

(async () => {
  const br = await puppeteer.launch({ executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await br.createBrowserContext(); // ONE profile — two tabs share localStorage
  const A = await ctx.newPage(), B = await ctx.newPage();
  for (const [n, p] of [['A', A], ['B', B]]) {
    p.on('pageerror', e => console.log(`[${n}] PAGEERROR:`, e.message));
    p.on('console', m => { if (m.type() === 'error') console.log(`[${n}] CONSOLE:`, m.text().slice(0, 200)); });
    p.on('response', r => { if (r.status() >= 400) console.log(`[${n}] HTTP`, r.status(), r.url()); });
  }

  // --- exactly the user flow: lobby -> "Play as Guest" in tab1, then tab2
  const diag = async where => {
    for (const [n, p] of [['A', A], ['B', B]]) {
      try {
        const st = await p.evaluate(() => (document.getElementById('status') || {}).innerText || '(no status el)');
        const dbg = await p.evaluate(() => typeof window.__chessDebug + '/' + typeof window.ChessLayout + '/' + typeof window.socket);
        console.log(`DIAG@${where} ${n}: url=${p.url()} status="${st}" dbg=${dbg}`);
      } catch (e) { console.log(`DIAG@${where} ${n}: eval failed ${e.message.slice(0, 80)}`); }
    }
  };
  await A.goto(BASE + '/index', { waitUntil: 'networkidle2' });
  await A.evaluate(() => play());
  if (!await waitFor(A, () => !!window.__chessDebug)) { await diag('A-not-game'); throw new Error('A never reached game'); }
  await sleep(300);
  await B.goto(BASE + '/index', { waitUntil: 'networkidle2' });
  await B.evaluate(() => play());
  if (!await waitFor(B, () => !!window.__chessDebug)) { await diag('B-not-game'); throw new Error('B never reached game'); }

  await sleep(1500); // pairing time
  const stA = await status(A), stB = await status(B);
  const colA = await A.evaluate(() => window.__chessDebug.myColor);
  const colB = await B.evaluate(() => window.__chessDebug.myColor);
  check('pairing (one white, one black)', (colA === 0 && colB === 1) || (colA === 1 && colB === 0), `A=${stA}|${colA} B=${stB}|${colB}`);

  // localStorage state after pairing — SHARED between tabs
  const lsA = await A.evaluate(() => sessionStorage.getItem('cherry_session'));
  const lsB = await B.evaluate(() => sessionStorage.getItem('cherry_session'));
  console.log('per-tab sessionStorage A:', lsA, '| B:', lsB);
  const colorA = colA, colorB = colB;

  // --- White plays e4 (whoever has white)
  const W = colorA === 0 ? A : B, Bl = colorA === 0 ? B : A;
  await clickMove(W, colorA === 0 ? 0 : 1, 'e2', 'e4');
  await sleep(1200);
  const bB = await serverBoard(Bl);
  const whiteMovedVisible = bB && (bB[4][4] & 15) === 1 && (bB[6][4] & 15) === 0;
  check('white e4 visible on black tab WITHOUT refresh', whiteMovedVisible, `status(black)=${await status(Bl)}`);
  const stBl = await status(Bl);
  check('black tab says "Your turn" without refresh', /your turn/i.test(stBl), stBl);

  // --- Black plays e5 (click-based)
  await clickMove(Bl, colorB, 'e7', 'e5');
  await sleep(1200);
  const bW = await serverBoard(W);
  check('black e5 visible on white tab WITHOUT refresh', bW && (bW[3][4] & 15) === 9 && (bW[5][4] & 15) === 0, `status(white)=${await status(W)}`);

  // --- third ply: white Nc3, visible live on black tab
  await clickMove(W, colorA === 0 ? 0 : 1, 'b1', 'c3');
  await sleep(1200);
  const bB1 = await serverBoard(Bl);
  check('white Nc3 applied + visible on black tab', bB1[5][2] === 6 && (await serverBoard(W))[5][2] === 6,
    `black=${bB1[5][2]} white=${(await serverBoard(W))[5][2]}`);

  // --- simulate a WS blip on the black tab (what happens behind NAT/proxy),
  // then check whether live delivery resumes WITHOUT a manual refresh.
  await Bl.evaluate(() => { window.socket.io && window.socket.io.engine && window.socket.io.engine.close(); });
  await sleep(3000); // socket.io auto-reconnect window
  const reconnected = await Bl.evaluate(() => window.socket.connected);
  console.log('black tab socket auto-reconnected:', reconnected);
  await clickMove(Bl, colorB, 'g8', 'f6');
  await sleep(1500);
  const bW2 = await serverBoard(W);
  check('after WS blip on black tab: black Nf6 visible on white tab WITHOUT refresh',
    bW2 && bW2[2][5] === 14, `white=${bW2 && bW2[2][5]} blstatus=${await status(Bl)}`);

  const fails = results.filter(r => !r[0]).length;
  console.log(`\nREPRO RESULT: ${results.length - fails}/${results.length} PASS${fails ? ' — REPRODUCED ' + fails + ' FAILURE(S)' : ''}`);
  await br.close();
  process.exit(fails ? 1 : 0);
})().catch(async e => { console.error('FATAL', e.message); process.exit(2); });
