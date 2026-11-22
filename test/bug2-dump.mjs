// Investigate BUG #2: dump legal moves for pos4/pos5/pos6 at depth 1 (server
// engine, after BUG#1+S1 fixes) and inspect candidate defects.
import { POSITIONS, runPerft } from './perft.mjs';
import { checkLegalMove, getPiece, blank, white, black, pawn, knight, bishop, king } from '../src/lib/chessutils.js';
const queen = 0b0011, rook = 0b0100;
const TYPE_TO_PIECE = { 1: 'p', 2: 'k', 3: 'q', 4: 'r', 5: 'b', 6: 'n' };
const sq = (x, y) => String.fromCharCode(97 + x) + (8 - y);

function fenToBoard(fen) {
  const PIECE_TO_TYPE = { 'p': pawn, 'n': knight, 'b': bishop, 'r': rook, 'q': queen, 'k': king };
  const rows = fen.split(/\s+/)[0].split('/');
  return rows.map(r => {
    const row = [];
    for (const ch of r) {
      if (ch >= '1' && ch <= '8') for (let k = 0; k < +ch; k++) row.push(blank);
      else {
        const t = PIECE_TO_TYPE[ch.toLowerCase()];
        row.push((ch === ch.toUpperCase()) ? t : 0b1000 | t);
      }
    }
    return row;
  });
}
// board -> fen (verify the FEN we're parsing)
function boardToFen(board) {
  return board.map(row => {
    let s = '', e = 0;
    for (const v of row) {
      if (v === blank) { e++; continue; }
      if (e) { s += e; e = 0; }
      const ch = { 1: 'p', 2: 'k', 3: 'q', 4: 'r', 5: 'b', 6: 'n' }[getPiece(v)];
      s += (v & 0b1000) ? ch.toUpperCase() : ch;
    }
    if (e) s += e;
    return s;
  }).join('/');
}

function dump(name) {
  const pos = POSITIONS[name];
  const board = fenToBoard(pos.fen);
  console.log(`\n=== ${name}: ${pos.fen}`);
  console.log('parsed board fen:', boardToFen(board));
  const match = {
    boardState: board, turnState: 0,
    castlingRights: {
      whiteKingSide: pos.fen.includes('K'), whiteQueenSide: pos.fen.includes('Q'),
      blackKingSide: pos.fen.includes('k'), blackQueenSide: pos.fen.includes('q')
    },
    lastMove: null, halfMoveClock: 0
  };
  const moves = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const v = board[y][x];
    if (v === blank || (v & 0b1000) !== 0) continue; // white to move
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
      if (checkLegalMove(board, { x, y }, { x: tx, y: ty }, match))
        moves.push(`${TYPE_TO_PIECE[getPiece(v)]}${sq(x, y)}-${sq(tx, ty)}`);
    }
  }
  console.log(`legal (${moves.length}): ${moves.sort().join(' ')}`);
}

for (const n of ['pos3', 'pos4', 'pos5', 'pos6']) dump(n);
