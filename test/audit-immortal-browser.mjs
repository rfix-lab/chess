// audit-immortal-browser.mjs — play the Immortal Game (Anderssen–Kieseritzky 1851,
// 45 plies, 23.Be7#) through a REAL browser UI (canvas click-to-move), two tabs
// (isolated browser contexts), against a live server.
//   node test/audit-immortal-browser.mjs --mode=guest   two GUEST players, public lobby
//   node test/audit-immortal-browser.mjs --mode=user    two REGISTERED players (sign-up via UI), public lobby
// Env: BASE_URL (default https://mycheserv.duckdns.org)

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const puppeteer = require('/root/.nvm/versions/node/v24.22.1/lib/node_modules/puppeteer-core');

import { initMatch } from '../src/lib/matchmaking.js';
import { checkLegalMove, chessMakeMove, getPiece, getColor, blank, white as W_,
         pawn, king, queen, rook, bishop, knight, isKingInCheck } from '../src/lib/chessutils.js';

const BASE = process.env.BASE_URL || 'https://mycheserv.duckdns.org';
const MODE = (process.argv.find(a => a.startsWith('--mode=')) || '--mode=guest').split('=')[1];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const FILES = 'abcdefgh';
const toXY = (s) => ({ x: FILES.indexOf(s[0]), y: 8 - Number(s[1]) });
const rot = (x, y) => ({ x: 7 - x, y: 7 - y });
const PIECE_BY_CHAR = { Q: queen, R: rook, B: bishop, N: knight, K: king, P: pawn };

const SAN = ['e4','e5','f4','exf4','Bc4','Qh4+','Kf1','b5','Bxb5','Nf6','Nf3','Qh6','d3','Nh5',
 'Nh4','Qg5','Nf5','c6','g4','Nf6','Rg1','cxb5','h4','Qg6','h5','Qg5','Qf3','Ng8',
 'Bxf4','Qf6','Nc3','Bc5','Nd5','Qxb2','Bd6','Bxg1','e5','Qxa1+','Ke2','Na6',
 'Nxg7+','Kd8','Qf6+','Nxf6','Be7#'];

// ---- offline: SAN -> server-coord plies + expected board after each ply ----
function resolveAll() {
  const match = initMatch(0, null);
  const boards = [match.boardState.map(r => r.slice())];
  const moves = [];
  for (const san of SAN) {
    const turn = match.turnState, wantColor = turn === 0 ? W_ : 0b1000;
    let s = san.replace(/[+#!?]/g, ''), pieceType = pawn;
    if ('KQRBN'.includes(s[0])) { pieceType = PIECE_BY_CHAR[s[0]]; s = s.slice(1); }
    const capture = s.includes('x');
    const to = toXY(s.slice(-2));
    const dis = s.slice(0, -2).replace('x', '');
    const dFile = [...dis].find(c => FILES.includes(c)), dRank = [...dis].find(c => '12345678'.includes(c));
    let from = null;
    for (let y = 0; y < 8 && !from; y++) for (let x = 0; x < 8 && !from; x++) {
      const v = match.boardState[y][x];
      if (v === blank || getPiece(v) !== pieceType || getColor(v) !== wantColor) continue;
      if (!checkLegalMove(match.boardState, { x, y }, to, match)) continue;
      if (dFile && FILES[x] !== dFile) continue;
      if (dRank && String(8 - y) !== dRank) continue;
      from = { x, y };
    }
    if (!from) throw new Error(`no move for ${san}`);
    chessMakeMove(match, from, to);
    boards.push(match.boardState.map(r => r.slice()));
    moves.push({ san, side: turn, from, to });
  }
  return { moves, boards };
}

const rows = [];
const logRow = (t, st, d = '') => { rows.push({ t, st, d: String(d).slice(0, 300) });
  console.log(`[${st}] ${t}${d ? ' :: ' + String(d).slice(0, 180) : ''}`); };

async function main() {
  console.log(`MODE=${MODE} BASE=${BASE}`);
  const { moves, boards } = resolveAll();

  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=900,800'],
    defaultViewport: { width: 880, height: 780 },
  });
  const errs = [];
  const ctxA = await browser.createBrowserContext(), ctxB = await browser.createBrowserContext();
  async function mkPlayer(name) {
    const ctx = name === 'A' ? ctxA : ctxB;
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    return { name, page };
  }
  const A = await mkPlayer('A'), B = await mkPlayer('B');

  // ---------- lobby ----------
  for (const P of [A, B]) {
    await P.page.goto(BASE + '/index', { waitUntil: 'networkidle2' });
    if (MODE === 'user') {
      const user = `imm_${MODE}_${Date.now().toString(36)}_${P.name}`;
      const pass = 'audit_' + Math.random().toString(36).slice(2, 10);
      await P.page.type('#username', user);
      await P.page.type('#password', pass);
      const ok = await P.page.evaluate(() => new Promise(res => {
        const iv = setInterval(() => {
          const el = document.getElementById('auth-success');
          if (el && !el.classList.contains('hide')) { clearInterval(iv); res(true); }
        }, 50);
        setTimeout(() => { clearInterval(iv); res(false); }, 4000);
        window.submitSignUpDetails();
      }));
      if (!ok) throw new Error(`${P.name}: sign-up failed for ${user}`);
      P.user = user;
      logRow(`UI sign-up+auto-signin ${P.name}`, 'PASS', user);
    }
  }
  // A enters the lobby first (waits as white), then B (pairs, game starts)
  for (const P of [A, B]) {
    await P.page.click('#play-button');
    await P.page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
    await P.page.waitForFunction(() => window.__chessDebug && window.socket, { timeout: 8000 });
    // hook elo events early (fired only for registered players)
    await P.page.evaluate(() => { window.__elo = null; socket.on('elo', d => { window.__elo = d; }); });
    // probe: record click-to-move decisions (for desync forensics)
    await P.page.evaluate(() => {
      window.__clicks = [];
      const _e = executeClickToMove;
      executeClickToMove = function (x, y) {
        const legal = legalMoveSquares.has(x + ',' + y);
        const r = _e(x, y);
        window.__clicks.push({ x, y, legal, can: can_move, ibv: is_being_validated,
          holding: is_holding_piece, afterSel: selectedSquare ? [selectedSquare.x, selectedSquare.y] : null,
          nlegal: legalMoveSquares.size });
        return r;
      };
      const _s = socket.emit.bind(socket);
      window.__emits = [];
      socket.emit = function (ev, ...a) { if (ev === 'move') window.__emits.push(JSON.stringify(a)); return _s(ev, ...a); };
    });
    if (P === A) await sleep(400);
  }
  const waitStatus = (page, txt) => page.waitForFunction(
    (t) => document.getElementById('status')?.innerText === t, { timeout: 10000 }, txt);
  const colA = await A.page.evaluate(() => window.__chessDebug.myColor);
  const colB = await B.page.evaluate(() => window.__chessDebug.myColor);
  await Promise.all([waitStatus(A.page, `Playing as ${colA === 0 ? 'white' : 'black'}`),
                     waitStatus(B.page, `Playing as ${colB === 0 ? 'white' : 'black'}`)]);
  if (colA === colB) throw new Error(`both players same color ${colA}`);
  const pages = { 0: colA === 0 ? A : B, 1: colA === 0 ? B : A };
  logRow('pairing in public lobby + startGame', 'PASS', `A color=${colA} B color=${colB}`);

  // ---------- helpers (from e2e-client.mjs) ----------
  async function squarePx(page, x, y) {
    return page.evaluate((xx, yy) => {
      const r = document.getElementById('cnv').getBoundingClientRect();
      const c = side_len / 8;
      return { x: r.left + offset_x + (xx + 0.5) * c, y: r.top + offset_y + (yy + 0.5) * c };
    }, x, y);
  }
  async function drive(page, from, to) {
    const a = await squarePx(page, from.x, from.y), b = await squarePx(page, to.x, to.y);
    await page.mouse.click(a.x, a.y); await sleep(80); await page.mouse.click(b.x, b.y);
  }
  const serverOriented = () => `(function(){const b=window.__chessDebug.getBoard().map(r=>r.slice().map(v=>v&0b1111));return window.ChessLayout.rotateBoard(b,window.__chessDebug.myColor);})()`;

  // ---------- drive the game ----------
  let failAt = null;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i], P = pages[m.side], myColor = m.side;
    const vf = myColor === 0 ? m.from : rot(m.from.x, m.from.y);
    const vt = myColor === 0 ? m.to : rot(m.to.x, m.to.y);
    const plier = `${Math.floor(i / 2) + 1}${m.side === 0 ? '.' : '..'}`;
    await drive(P.page, vf, vt);
    if (i === moves.length - 1) { logRow('45/45 plies via UI clicks (final mate move sent)', 'PASS', 'board check via modal+replay'); continue; }
    // both pages must converge to boards[i+1]
    let ok = false;
    for (let t = 0; t < 40 && !ok; t++) {
      await sleep(60);
      const [wb, bb] = await Promise.all([A.page.evaluate(serverOriented()), B.page.evaluate(serverOriented())]);
      ok = JSON.stringify(wb) === JSON.stringify(boards[i + 1]) && JSON.stringify(bb) === JSON.stringify(boards[i + 1]);
    }
    if (!ok) { failAt = i; logRow(`${plier} ${m.san} click-to-move`, 'FAIL', 'board desync after 2.4s');
      const [wb, bb] = await Promise.all([A.page.evaluate(serverOriented()), B.page.evaluate(serverOriented())]);
      const exp = boards[i + 1]; const diff = [];
      for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) {
        if (wb[yy][xx] !== exp[yy][xx]) diff.push(`A ${FILES[xx]}${8 - yy}: got ${wb[yy][xx]} want ${exp[yy][xx]}`);
        if (bb[yy][xx] !== exp[yy][xx]) diff.push(`B ${FILES[xx]}${8 - yy}: got ${bb[yy][xx]} want ${exp[yy][xx]}`);
      }
      logRow('diff detail', 'FAIL', diff.join('; ').slice(0, 500));
      logRow('pages agree with each other', JSON.stringify(wb) === JSON.stringify(bb) ? 'PASS' : 'FAIL');
      for (const [nm, Pg] of [['A', A], ['B', B]]) {
        const cl = await Pg.page.evaluate(() => ({ clicks: window.__clicks.slice(-4), emits: window.__emits.slice(-2) }));
        require('fs').writeFileSync(`/tmp/imm-clicks-${nm}.json`, JSON.stringify(cl, null, 1));
        logRow(`clicks ${nm} written`, 'INFO', `/tmp/imm-clicks-${nm}.json last=${JSON.stringify(cl.clicks[cl.clicks.length - 1])}`);
      }
      break; }
    if ((i + 1) % 15 === 0) logRow(`${(i + 1)}/45 plies via UI clicks`, 'PASS', `last=${m.san}`);
  }
  if (failAt === null) logRow('all 44 non-final plies played via real canvas clicks; boards in sync on BOTH tabs', 'PASS');

  // ---------- final state ----------
  await sleep(1200);
  const finA = await A.page.evaluate(() => ({
    modal: document.getElementById('gameEndModal')?.style.display,
    replayRows: document.querySelectorAll('#replay-list li').length,
    status: document.getElementById('status')?.innerText, elo: window.__elo }));
  const finB = await B.page.evaluate(() => ({
    modal: document.getElementById('gameEndModal')?.style.display,
    replayRows: document.querySelectorAll('#replay-list li').length,
    status: document.getElementById('status')?.innerText, elo: window.__elo }));
  const modalOk = (f) => f.modal && f.modal !== 'none';
  logRow('gameEnd modal visible on both tabs (checkmate)', modalOk(finA) && modalOk(finB) ? 'PASS' : 'FAIL',
    `A:${finA.modal}/"${finA.status}" B:${finB.modal}/"${finB.status}"`);
  logRow('replay list 45 rows on both tabs', finA.replayRows === 45 && finB.replayRows === 45 ? 'PASS' : 'FAIL',
    `A=${finA.replayRows} B=${finB.replayRows}`);
  // black's replay board must keep the visual-rotation invariant (a1 white rook
  // at raw visual (7,7) means UNROTATED = bug; rotated puts it at (0,0))
  if (colB === 1) {
    const bRaw00 = await B.page.evaluate(() => (board[0][0] & 0b1111));
    logRow('replay position 0 on BLACK tab is rotated (raw a8-square = white rook)', bRaw00 === 4 ? 'PASS' : 'FAIL', `raw board[0][0]&15=${bRaw00}`);
  }
  if (MODE === 'user') logRow('elo event delivered to both registered players', finA.elo && finB.elo ? 'PASS' : 'FAIL',
    `A=${JSON.stringify(finA.elo)} B=${JSON.stringify(finB.elo)}`);
  logRow('no uncaught JS errors in either tab', errs.length === 0 ? 'PASS' : 'FAIL', errs.join(' | ').slice(0, 300));

  await browser.close();
  const fails = rows.filter(r => r.st === 'FAIL').length;
  console.log(`\nMODE=${MODE} RESULT: ${rows.length - fails}/${rows.length} PASS ${fails ? '— FAILURES' : '— ALL PASS'}`);
  process.exit(fails || failAt !== null ? 1 : 0);
}
main().catch(e => { console.error('BROWSER AUDIT ERROR:', e); process.exit(2); });
