// Audit: play the "Immortal Game" (Anderssen–Kieseritzky, London 1851, 23 moves,
// 1-0, 23.Be7#) move-by-move against a LIVE server via two guest socket clients
// in a PRIVATE match. Every ply must be ACCEPTED; the game must end in checkmate
// for black (winner = white). 23 white / 22 black moves (>=20 per side).
//
// Usage: node test/audit-immortal-game.mjs [BASE_URL]
// Default BASE_URL = https://mycheserv.duckdns.org (prod)

import { io } from 'socket.io-client';
import { initMatch } from '../src/lib/matchmaking.js';
import { checkLegalMove, chessMakeMove, getPiece, getColor, blank, white, black,
         pawn, king, queen, rook, bishop, knight, isKingInCheck } from '../src/lib/chessutils.js';

const BASE = process.argv[2] || 'https://mycheserv.duckdns.org';
const FILES = 'abcdefgh';
const xy = (s) => ({ x: FILES.indexOf(s[0]), y: 8 - Number(s[1]) });
const sq = (c) => FILES[c.x] + (8 - c.y);
const PIECE_BY_CHAR = { Q: queen, R: rook, B: bishop, N: knight, K: king, P: pawn };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------- the game (45 plies) ----------------
const SAN = [
 'e4','e5','f4','exf4','Bc4','Qh4+','Kf1','b5','Bxb5','Nf6','Nf3','Qh6','d3','Nh5',
 'Nh4','Qg5','Nf5','c6','g4','Nf6','Rg1','cxb5','h4','Qg6','h5','Qg5','Qf3','Ng8',
 'Bxf4','Qf6','Nc3','Bc5','Nd5','Qxb2','Bd6','Bxg1','e5','Qxa1+','Ke2','Na6',
 'Nxg7+','Kd8','Qf6+','Nxf6','Be7#',
];

// ---------------- offline SAN -> coordinate resolution using the engine ----------------
function resolveAll() {
  const match = initMatch(0, null); // fresh start board, server orientation
  const moves = [];
  for (let i = 0; i < SAN.length; i++) {
    const turn = match.turnState;
    const wantColor = turn === 0 ? white : black;
    let s = SAN[i].replace(/[+#!?]/g, '');
    let from = null, to = null;

    if (s === 'O-O' || s === '0-0') {
      const y = turn === 0 ? 7 : 0;
      from = { x: 4, y }; to = { x: 6, y };
    } else if (s === 'O-O-O' || s === '0-0-0') {
      const y = turn === 0 ? 7 : 0;
      from = { x: 4, y }; to = { x: 2, y };
    } else {
      let pieceType = pawn;
      if ('KQRBN'.includes(s[0])) { pieceType = PIECE_BY_CHAR[s[0]]; s = s.slice(1); }
      const capture = s.includes('x');
      to = xy(s.slice(-2));
      const disamb = s.slice(0, -2).replace('x', '');
      const dFile = [...disamb].find(ch => FILES.includes(ch));
      const dRank = [...disamb].find(ch => '12345678'.includes(ch));

      const cands = [];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const v = match.boardState[y][x];
        if (v === blank) continue;
        if (getPiece(v) !== pieceType || getColor(v) !== wantColor) continue;
        const f = { x, y };
        if (!checkLegalMove(match.boardState, f, to, match)) continue;
        if (dFile && FILES[x] !== dFile) continue;
        if (dRank && String(8 - y) !== dRank) continue;
        if (capture && pieceType !== pawn) {
          const victim = match.boardState[to.y][to.x];
          if (victim === blank || getColor(victim) === wantColor) continue;
        }
        cands.push(f);
      }
      if (cands.length === 0) throw new Error(`ply ${i + 1} (${SAN[i]}): no legal move found`);
      if (cands.length > 1) throw new Error(`ply ${i + 1} (${SAN[i]}): ambiguous ${cands.map(sq)}`);
      from = cands[0];
    }
    if (!checkLegalMove(match.boardState, from, to, match))
      throw new Error(`ply ${i + 1} (${SAN[i]}): resolved ${sq(from)}-${sq(to)} illegal`);
    moves.push({ san: SAN[i], side: turn, from: { ...from }, to: { ...to } });
    chessMakeMove(match, from, to);
    if (match.pendingPromotion) throw new Error(`ply ${i + 1}: unexpected promotion`);
  }
  return { moves, match };
}

// Independent final-state checks on the locally-resolved board:
// black king in check AND black has zero legal replies => checkmate.
function assertFinalMate(match) {
  const turn = match.turnState;
  if (turn !== 1) throw new Error(`final turn should be black (1), got ${turn}`);
  if (!isKingInCheck(match.boardState, 1)) throw new Error('black king NOT in check at end');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const v = match.boardState[y][x];
    if (v === blank || getColor(v) !== black) continue;
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
      if (checkLegalMove(match.boardState, { x, y }, { x: tx, y: ty }, match))
        throw new Error(`black has legal reply ${sq({ x, y })}->${sq({ x: tx, y: ty })} — not mate`);
    }
  }
}

// ---------------- live protocol against the server ----------------
function mkClient(tag) {
  const sock = io(BASE, { transports: ['websocket'] });
  const c = { tag, sock, matchId: null, color: null, events: [], rejected: 0 };
  for (const ev of ['startGame', 'validated', 'gameEnd', 'replay', 'invalidMove',
                    'checkMate', 'stalemate', 'authFailed', 'gameNotFound', 'elo']) {
    sock.on(ev, (...a) => {
      c.events.push({ ev, t: Date.now(), args: a, brief: JSON.stringify(a).slice(0, 160) });
      if (ev === 'startGame') { c.color = a[0]; c.matchId = a[1]; }
      if (ev === 'validated' && a[2] && a[2].rejected) c.rejected++;
    });
  }
  return c;
}
const wait = (sock, ev, ms = 8000) => new Promise((res, rej) => {
  const t = setTimeout(() => { sock.off(ev, h); rej(new Error(`timeout waiting '${ev}' (${ms}ms)`)); }, ms);
  const h = (...a) => { clearTimeout(t); sock.off(ev, h); res(a); };
  sock.on(ev, h);
});

async function main() {
  console.log(`BASE=${BASE}`);
  console.log(`offline resolve ${SAN.length} plies (white ${(SAN.length + 1) >> 1}, black ${SAN.length >> 1})...`);
  const { moves, match } = resolveAll();
  assertFinalMate(match);
  console.log('offline: all 45 plies legal per engine; final position = checkmate for black (independent scan). OK');

  const W = mkClient('W'), B = mkClient('B');
  await Promise.all([wait(W.sock, 'connect'), wait(B.sock, 'connect')]);

  // private match so we never steal an opponent from the public lobby
  W.sock.emit('private-match');
  const [pm] = await wait(W.sock, 'private-match');
  const matchId = pm;
  console.log(`private matchId=${matchId}`);

  W.sock.emit('auth', null, matchId);          // host -> white (seated, waits)
  await sleep(300);
  B.sock.emit('auth', null, matchId);          // joiner -> black -> startGame both
  await Promise.all([wait(W.sock, 'startGame'), wait(B.sock, 'startGame')]);
  if (W.color !== 0 || B.color !== 1) throw new Error(`unexpected colors W=${W.color} B=${B.color}`);
  console.log(`startGame: W color=${W.color}, B color=${B.color}, server matchId=${W.matchId}`);

  const serverMatchId = W.matchId;
  const t0 = Date.now();
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const c = m.side === 0 ? W : B;
    const before = c.rejected;
    c.sock.emit('move', serverMatchId, m.from, m.to);
    await sleep(70); // let the server validate + broadcast
    if (c.rejected > before) throw new Error(`ply ${i + 1} (${m.san}) ${sq(m.from)}->${sq(m.to)}: server REJECTED`);
    const bad = c.events.find(e => e.ev === 'invalidMove');
    if (bad) throw new Error(`ply ${i + 1} (${m.san}): server sent invalidMove ${bad.brief}`);
    if ((i + 1) % 10 === 0) console.log(`  ...${i + 1}/${moves.length} plies accepted (${m.san})`);
  }
  console.log(`all ${moves.length} plies accepted in ${((Date.now() - t0) / 1000).toFixed(1)}s; rejections: W=${W.rejected} B=${B.rejected}`);

  // final result events (checkmate -> endMatch -> gameEnd + replay)
  await sleep(800);
  const endW = W.events.filter(e => ['gameEnd', 'checkMate'].includes(e.ev));
  const replayW = W.events.find(e => e.ev === 'replay');
  const replayB = B.events.find(e => e.ev === 'replay');
  console.log('W end events:', JSON.stringify(endW.map(e => ({ ev: e.ev, brief: e.brief }))));
  if (replayW) console.log('replay(W) len:', replayW.args[0]?.length ?? 'n/a');

  let fails = 0;
  const need = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}`); if (!ok) fails++; };
  need(W.rejected === 0 && B.rejected === 0, 'zero move rejections on 45-plies game');
  need(endW.some(e => e.ev === 'gameEnd'), 'server emitted gameEnd (result) to loser/winner');
  need(!!replayW && !!replayB, 'replay history delivered to both players');
  const rp = replayW ? replayW.args[0] : [];
  need(Array.isArray(rp) && rp.length === moves.length, `replay has ${moves.length} entries (got ${Array.isArray(rp) ? rp.length : 'n/a'})`);
  if (Array.isArray(rp)) console.log('replay first/last:', JSON.stringify(rp[0]).slice(0, 140), '|', JSON.stringify(rp[rp.length - 1]).slice(0, 140));
  need(endW.some(e => e.ev === 'gameEnd' && /checkmate/.test(e.brief) && /"win"/.test(e.brief)),
       'gameEnd: reason=checkmate, winner=white present');

  W.sock.close(); B.sock.close();
  if (fails) { console.log(`RESULT: ${fails} FAIL`); process.exit(1); }
  console.log('RESULT: ALL PASS — Immortal Game played correctly on the live server');
  process.exit(0);
}
main().catch(e => { console.error('AUDIT ERROR:', e.message); process.exit(2); });
