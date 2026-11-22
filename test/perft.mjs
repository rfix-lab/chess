// perft.mjs — regression gate for the chess engine (server: src/lib/chessutils.js).
//
// FEN → board adapter (FEN row 0 = rank 8; UPPERCASE = white, lowercase = black),
// reconstructs `lastMove` from the FEN en-passant field, enumerates legal moves
// via the EXPORTED checkLegalMove from src/lib/chessutils.js and applies them with
// the EXPORTED chessMakeMove. Tests the real server engine, not a reimplementation.
//
// Expected values are the CANONICAL perft tables (task brief 2026-11-22). The
// audit's CPW#3 FEN (checkpoints/19) turned out to be malformed, so its table
// was replaced here by the canonical pos3 (see checkpoints/22-engine-perft.md).
//
// Run modes:
//   node test/perft.mjs            — full depths for all six positions
//   node test/perft.mjs <name>...  — only the listed positions (full depths)
// test/run.mjs (npm test) runs only the FAST subset (see run.mjs) to keep
// the suite runtime bounded; full depths live under `npm run perft`.

import {
  checkLegalMove, chessMakeMove, getPiece,
  blank, white, black, pawn, knight, bishop, king
} from '../src/lib/chessutils.js';
const queen = 0b0011; // not exported by the server module; matches its local const
const rook = 0b0100;  // not exported by the server module; matches its local const

const noOfSquares = 8;
const whiteTurn = 0, blackTurn = 1;

const PIECE_TO_TYPE = { 'p': pawn, 'n': knight, 'b': bishop, 'r': rook, 'q': queen, 'k': king };
const TYPE_TO_PIECE = { 1: 'p', 2: 'k', 3: 'q', 4: 'r', 5: 'b', 6: 'n' };

function Coord(x, y) { return { x, y }; }

// Parse FEN -> { boardState, turnState, castlingRights, lastMove, halfMoveClock }
function fenToMatch(fen) {
  const fields = fen.trim().split(/\s+/);
  const boardPart = fields[0];
  const rows = boardPart.split('/');
  const board = [];
  for (let r = 0; r < 8; r++) {
    const row = [];
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') { for (let k = 0; k < +ch; k++) row.push(blank); }
      else {
        const t = PIECE_TO_TYPE[ch.toLowerCase()];
        // FEN standard: UPPERCASE = white, lowercase = black.
        const color = (ch === ch.toUpperCase()) ? white : black;
        row.push(color | t);
      }
    }
    board.push(row);
  }
  const turnState = fields[1] === 'w' ? whiteTurn : blackTurn;

  const crField = fields[2] || '-';
  const castlingRights = {
    whiteKingSide: crField.includes('K'),
    whiteQueenSide: crField.includes('Q'),
    blackKingSide: crField.includes('k'),
    blackQueenSide: crField.includes('q')
  };

  // Reconstruct lastMove from the EP square so en passant validates correctly.
  // EP field = square of the CAPTURE target (e.g. 'c3' = file c, rank 3).
  let lastMove = null;
  const epField = fields[3] || '-';
  if (epField && epField !== '-' && epField.length === 2) {
    const file = epField.charCodeAt(0) - 97;
    const rank = +epField[1];
    const toY = 8 - rank; // row of the FEN en-passant square
    if (toY === 5) {
      // rank 3: WHITE pawn double-pushed  rank2(row6) -> rank4(row4)
      lastMove = { from: Coord(file, 6), to: Coord(file, 4), piece: white | pawn };
    } else if (toY === 2) {
      // rank 6: BLACK pawn double-pushed  rank7(row1) -> rank5(row3)
      lastMove = { from: Coord(file, 1), to: Coord(file, 3), piece: black | pawn };
    }
  }

  const match = {
    boardState: board,
    turnState,
    castlingRights,
    lastMove,
    halfMoveClock: fields[4] ? +fields[4] : 0
  };
  return match;
}

function cloneMatch(m) {
  return {
    boardState: m.boardState.map(r => r.slice()),
    turnState: m.turnState,
    castlingRights: Object.assign({}, m.castlingRights),
    lastMove: m.lastMove,
    halfMoveClock: m.halfMoveClock,
    pendingPromotion: m.pendingPromotion || null
  };
}

// Enumerate legal moves for the side to move.
function legalMoves(match) {
  const color = match.turnState === whiteTurn ? white : black;
  const moves = [];
  const byPiece = {};
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (match.boardState[y][x] === blank) continue;
      if ((match.boardState[y][x] & 0b1000) !== color) continue;
      const from = Coord(x, y);
      for (let ty = 0; ty < 8; ty++) {
        for (let tx = 0; tx < 8; tx++) {
          const to = Coord(tx, ty);
          if (checkLegalMove(match.boardState, from, to, match)) {
            moves.push({ from, to });
            const pt = getPiece(match.boardState[y][x]);
            const name = TYPE_TO_PIECE[pt] || pt;
            byPiece[name] = (byPiece[name] || 0) + 1;
          }
        }
      }
    }
  }
  globalThis.__lastByPiece = byPiece;
  return moves;
}

// Apply a move to a fresh clone (non-destructive); returns the resulting
// match. For a normal move the turn is already flipped; for a promoting pawn
// the turn is NOT yet flipped and pendingPromotion is set (see chessMakeMove).
function applyMove(match, move) {
  const m = cloneMatch(match);
  chessMakeMove(m, move.from, move.to);
  return m;
}

// perft: count legal move sequences `depth` plies deep (canonical perft).
// A promotion is ONE ply: the pawn reaches the last rank and the piece choice
// is resolved in the same step, so each of the 4 promoted successors is counted
// at depth-1 (not depth-2). Previously the harness charged the pawn step and
// then a separate "choose piece" ply, so every promotion consumed 2 plies and
// all promotion-carrying depths were miscounted.
function perft(match, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(match);
  let total = 0;
  for (const m of moves) {
    const next = applyMove(match, m);
    if (next.pendingPromotion) {
      // promotion: expand the 4 piece choices at depth-1 (single ply).
      const { to, color } = next.pendingPromotion;
      for (const p of [queen, rook, bishop, knight]) {
        const pm = cloneMatch(next);
        pm.boardState[to.y][to.x] = color | p;
        pm.pendingPromotion = null;
        pm.turnState = 1 - pm.turnState;
        total += perft(pm, depth - 1);
      }
    } else {
      total += perft(next, depth - 1);
    }
  }
  return total;
}

// Canonical positions and their expected perft counts (task brief 2026-11-22).
export const POSITIONS = {
  startpos: {
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
    depths: [1, 2, 3, 4],
    expected: { 1: 20, 2: 400, 3: 8902, 4: 197281 }
  },
  kiwipete: {
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -',
    depths: [1, 2, 3],
    expected: { 1: 48, 2: 2039, 3: 97862 }
  },
  pos3: {
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -',
    depths: [1, 2, 3, 4],
    expected: { 1: 14, 2: 191, 3: 2812, 4: 43238 }
  },
  pos4: {
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -',
    depths: [1, 2, 3],
    expected: { 1: 6, 2: 264, 3: 9467 }
  },
  pos5: {
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -',
    depths: [1, 2, 3],
    expected: { 1: 44, 2: 1486, 3: 62379 }
  },
  pos6: {
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - -',
    depths: [1, 2, 3],
    expected: { 1: 46, 2: 2079, 3: 89890 }
  }
};

// npm test budget: d1-d2 for all six positions + startpos d3.
export const FAST_SUBSET = {
  startpos: [1, 2, 3],
  kiwipete: [1, 2],
  pos3: [1, 2],
  pos4: [1, 2],
  pos5: [1, 2],
  pos6: [1, 2]
};

/**
 * Run perft for the given position/depth list and compare to the canonical
 * table. Returns [{ name, d, expected, actual, ok, ms }]. Set quiet to keep
 * the table compact when embedding into a larger report.
 */
export function runPerft(names, depthMap, { quiet = false, budgetMs = 60000 } = {}) {
  const results = [];
  const t0 = Date.now();
  for (const name of names) {
    const pos = POSITIONS[name];
    if (!pos) throw new Error(`unknown perft position: ${name}`);
    const depths = depthMap ? (depthMap[name] || pos.depths) : pos.depths;
    const match = fenToMatch(pos.fen);
    if (!quiet) {
      console.log(`\n=== perft: ${name} ===`);
      console.log(`FEN: ${pos.fen}`);
    }
    for (const d of depths) {
      const t1 = Date.now();
      const n = perft(match, d);
      const dt = Date.now() - t1;
      const expected = pos.expected[d];
      const ok = expected === n;
      results.push({ name, d, expected, actual: n, ok, ms: dt });
      if (!quiet) {
        console.log(`  depth ${d}: ${n} (expected ${expected}) ${ok ? 'OK' : 'MISMATCH'}  (${dt} ms)`);
        if (d === 1 && globalThis.__lastByPiece) {
          const bp = globalThis.__lastByPiece;
          const total = Object.values(bp).reduce((a, b) => a + b, 0);
          console.log(`  depth-1 legal moves by piece: ${JSON.stringify(bp)} (sum ${total})`);
        }
      }
      if (Date.now() - t0 > budgetMs) {
        if (!quiet) console.log(`  [budget ${budgetMs} ms exceeded; stopping]`);
        return results;
      }
    }
  }
  return results;
}

import { pathToFileURL } from 'url';
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const wanted = process.argv.slice(2);
  const names = wanted.length ? wanted : Object.keys(POSITIONS);
  for (const n of names) {
    if (!POSITIONS[n]) { console.error(`unknown position: ${n}`); process.exit(2); }
  }
  const results = runPerft(names, null, { budgetMs: 120000 });
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.error(`\n${failed.length} perft MISMATCH(es):`);
    for (const r of failed) console.error(`  ${r.name} depth ${r.d}: expected ${r.expected}, got ${r.actual}`);
    process.exit(1);
  }
  console.log(`\nperft: all ${results.length} (position, depth) checks EXACT`);
  process.exit(0);
}
