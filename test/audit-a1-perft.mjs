// A1 perft harness for the SERVER engine (src/lib/chessutils.js).
// Reads FEN, builds a board + a match-like object (turnState, castlingRights,
// lastMove), enumerates legal moves via the EXPORTED checkLegalMove, applies
// them with the EXPORTED chessMakeMove, and counts perft nodes.
//
// Board convention (must match server): row 0 = rank 8 (black side),
// row 7 = rank 1 (white side); col 0 = file 'a'. FEN row 0 is also rank 8.
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

// Parse FEN -> { board, match }
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
  // EP field = square of the CAPTURE target (e.g. 'e3' = file e, rank 3).
  let lastMove = null;
  const epField = fields[3] || '-';
  if (epField && epField !== '-' && epField.length === 2) {
    const file = epField.charCodeAt(0) - 97;
    const rank = +epField[1];
    const toY = 8 - rank; // row of the FEN en-passant square
    // EP square is always on rank 3 (white double push) or rank 6 (black double push).
    if (toY === 5) {
      // rank 3: WHITE pawn double-pushed  rank2(row6)->rank4(row4)
      lastMove = { from: Coord(file, 6), to: Coord(file, 4), piece: white | pawn };
    } else if (toY === 2) {
      // rank 6: BLACK pawn double-pushed  rank7(row1)->rank5(row3)
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
            const name = TYPE_TO_PIECE[pt];
            byPiece[name] = (byPiece[name] || 0) + 1;
          }
        }
      }
    }
  }
  globalThis.__lastByPiece = byPiece;
  return moves;
}

// Apply a move to a fresh clone; returns the resulting match (turn already flipped, or pendingPromotion set for a promoting pawn).
function applyMove(match, move) {
  const m = cloneMatch(match);
  chessMakeMove(m, move.from, move.to);
  return m;
}

// Expand a promotion (pawn on back rank) into the 4 promoted successors.
function expansionCount(match) {
  // If the move left a pending promotion, it counts as 4 perft nodes.
  if (match.pendingPromotion) {
    const { from, to, color } = match.pendingPromotion;
    for (const p of [queen, rook, bishop, knight]) {
      const m = cloneMatch(match);
      m.boardState[to.y][to.x] = color | p;
      m.pendingPromotion = null;
      m.turnState = 1 - m.turnState;
      // leaf expansion when at depth 0 would just be 1 each = 4 total
    }
    return 4;
  }
  return 1;
}

function perft(match, depth) {
  // A pending promotion (pawn on back rank, piece not yet chosen) still has
  // the MOVER's turn on the board (chessMakeMove returns before flipping).
  // Branch the 4 promoted successors, each of which flips the turn.
  if (match.pendingPromotion) {
    if (depth === 0) return 1; // only reachable via non-promo path
    const { to, color } = match.pendingPromotion;
    let total = 0;
    for (const p of [queen, rook, bishop, knight]) {
      const m = cloneMatch(match);
      m.boardState[to.y][to.x] = color | p;
      m.pendingPromotion = null;
      m.turnState = 1 - m.turnState;
      total += perft(m, depth - 1);
    }
    return total;
  }
  if (depth === 0) return 1;
  const moves = legalMoves(match);
  let total = 0;
  for (const m of moves) {
    total += perft(applyMove(match, m), depth - 1);
  }
  return total;
}

function run(label, fen, depths, budgetMs) {
  const match = fenToMatch(fen);
  const table = [];
  console.log(`\n=== ${label} ===`);
  console.log(`FEN: ${fen}`);
  const t0 = Date.now();
  for (const d of depths) {
    const t1 = Date.now();
    const n = perft(match, d);
    const dt = Date.now() - t1;
    table.push({ d, n });
    console.log(`  depth ${d}: ${n}  (${dt} ms)`);
    if (d === 1 && globalThis.__lastByPiece) {
      console.log(`  depth-1 legal moves by piece: ${JSON.stringify(globalThis.__lastByPiece)}`);
      const total = Object.values(globalThis.__lastByPiece).reduce((a, b) => a + b, 0);
      console.log(`  (sum of byPiece = ${total})`);
    }
    if (Date.now() - t0 > budgetMs) {
      console.log(`  [budget ${budgetMs} ms exceeded; stopping deeper]`);
      break;
    }
  }
  return table;
}

const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
// CPW position 3: exercises en passant (c6xe5), promotion (g7g8), castling, pins, checks.
const CPW3 = '8/2p5/3p4/KP1r4/1p3nN1/8/QP3p2/3k1r2 w - - 0 0';

const expected = {
  startpos: { 1: 20, 2: 400, 3: 8902, 4: 197281 },
  kiwipete: { 1: 48, 2: 2039, 3: 97862, 4: 4085603, 5: 193690690 },
  cpw3: { 1: 6, 2: 264, 3: 9467, 4: 422333, 5: 15833292 }
};

const results = {};
const s = run('Startpos', STARTPOS, [1, 2, 3, 4], 25000);
results.startpos = {};
for (const r of s) results.startpos[r.d] = r.n;

const k = run('Kiwipete', KIWIPETE, [1, 2, 3], 25000);
results.kiwipete = {};
for (const r of k) results.kiwipete[r.d] = r.n;

const c = run('CPW #3 (ep/promotion/castling/pins)', CPW3, [1, 2, 3, 4], 30000);
results.cpw3 = {};
for (const r of c) results.cpw3[r.d] = r.n;

console.log('\n\n=== ACTUAL RESULTS (for report) ===');
console.log(JSON.stringify({
  startpos: results.startpos,
  kiwipete: results.kiwipete,
  cpw3: results.cpw3,
  expected
}, null, 2));
