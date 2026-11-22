// BUG #2 diff: reference legal moves (pure final-position rules) vs engine.
// Reference: pseudo-moves from plain movement rules; legal iff opponent king
// is not attacked on the FINAL position (en-passant / castling handled explicitly).
import { POSITIONS } from './perft.mjs';

const blank = 0, white = 0, black = 0b1000;
const pawn = 1, knight = 2, bishop = 3, rook = 4, queen = 5, king = 6;
const N = 8;

function parse(fen) {
  const [boardPart, side, cr, ep] = fen.trim().split(/\s+/);
  const t = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
  const board = boardPart.split('/').map(r => {
    const row = [];
    for (const ch of r) {
      if (ch >= '1' && ch <= '8') for (let i = 0; i < +ch; i++) row.push(blank);
      else row.push(t[ch.toLowerCase()] | (ch === ch.toUpperCase() ? white : black));
    }
    return row;
  });
  const crs = {
    wK: (cr || '-').includes('K'), wQ: (cr || '-').includes('Q'),
    bK: (cr || '-').includes('k'), bQ: (cr || '-').includes('q')
  };
  let epSq = null;
  if (ep && ep !== '-') epSq = { x: ep.charCodeAt(0) - 97, y: 8 - +ep[1] }; // capture-target square
  return { board, turn: side === 'w' ? 0 : 1, crs, epSq };
}

const inB = (x, y) => x >= 0 && x < N && y >= 0 && y < N;
const colorOf = v => v === blank ? -1 : (v & black) ? 1 : 0;
const typeOf = v => v & 7;

function attacks(board, x, y, byColor) {
  // is square (x,y) attacked by byColor?
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (!dx || !dy) continue;
    if (!inB(x + dx, y + dy)) continue;
    const v = board[y + dy][x + dx];
    if (colorOf(v) === byColor && typeOf(v) === knight) return true;
  }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dy === 0) continue;
    if (!inB(x + dx, y + dy)) continue;
    const v = board[y + dy][x + dx];
    if (colorOf(v) === byColor && typeOf(v) === pawn) {
      // a pawn attacks (x,y) if the pawn sits at (x±1, y ∓1) relative to (x,y)
      // i.e. board[y+dy][x+dx] is a pawn and the pawn's forward direction points at (x,y).
      // white pawn (color 0) moves toward decreasing y: it attacks (px±1, py-1).
      // So pawn at (px,py) attacks (x,y) iff x = px±1 and y = py - 1 (white) or y = py + 1 (black).
      if (byColor === 0 && dy === 1) return true;    // pawn one row ABOVE target
      if (byColor === 1 && dy === -1) return true;   // pawn one row BELOW target
    }
  }
  const dirs = [
    ...([[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => ({ d: [a, b], t: [rook, queen] }))),
    ...([[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => ({ d: [a, b], t: [bishop, queen] })))
  ];
  for (const { d, t } of dirs) {
    let [cx, cy] = [x + d[0], y + d[1]];
    while (inB(cx, cy)) {
      const v = board[cy][cx];
      if (v !== blank) {
        if (colorOf(v) === byColor && t.includes(typeOf(v))) return true;
        break;
      }
      cx += d[0]; cy += d[1];
    }
  }
  return false;
}

function findKing(board, color) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    if (board[y][x] === (king | color)) return { x, y };
  throw new Error('king not found');
}

function kingAttacked(board, color, x, y) { return attacks(board, x, y, 1 - color); }

function pseudoMoves(board, turn, crs, epSq) {
  const color = turnToColor(turn);
  const enemy = 1 - color;
  const moves = [];
  const add = (x, y, tx, ty, extra) => moves.push({ x, y, tx, ty, extra });
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = board[y][x];
    if (v === blank || colorOf(v) !== color) continue;
    const p = typeOf(v);
    if (p === pawn) {
      const dir = color === 0 ? -1 : 1;
      const start = color === 0 ? 6 : 1;
      // forward
      if (inB(x, y + dir) && board[y + dir][x] === blank) {
        add(x, y, x, y + dir);
        if (y === start && board[y + 2 * dir][x] === blank) add(x, y, x, y + 2 * dir, 'double');
      }
      for (const s of [-1, 1]) {
        if (!inB(x + s, y + dir)) continue;
        const tv = board[y + dir][x + s];
        if (colorOf(tv) === enemy) add(x, y, x + s, y + dir);
        else if (tv === blank && epSq && epSq.x === x + s && epSq.y === y + dir) add(x, y, x + s, y + dir, 'ep');
      }
    } else if (p === knight) {
      for (const [dx, dy] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
        if (!inB(x + dx, y + dy)) continue;
        if (colorOf(board[y + dy][x + dx]) !== color) add(x, y, x + dx, y + dy);
      }
    } else if (p === king) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (!inB(x + dx, y + dy)) continue;
        if (colorOf(board[y + dy][x + dx]) !== color) add(x, y, x + dx, y + dy);
      }
      // castling
      const homeRow = color === 0 ? 7 : 0;
      if (y === homeRow && x === 4) {
        const rights = color === 0 ? { k: crs.wK, q: crs.wQ } : { k: crs.bK, q: crs.bQ };
        if (!kingAttacked(board, color, x, y)) {
          if (rights.k && board[y][5] === blank && board[y][6] === blank &&
              typeOf(board[y][7]) === rook && colorOf(board[y][7]) === color &&
              !kingAttacked(board, color, x + 1, y) && !kingAttacked(board, color, x + 2, y))
            add(x, y, x + 2, y, 'castleK');
          if (rights.q && board[y][3] === blank && board[y][2] === blank && board[y][1] === blank &&
              typeOf(board[y][0]) === rook && colorOf(board[y][0]) === color &&
              !kingAttacked(board, color, x - 1, y) && !kingAttacked(board, color, x - 2, y))
            add(x, y, x - 2, y, 'castleQ');
        }
      }
    } else {
      const dirs = p === bishop ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] :
                   p === rook   ? [[1, 0], [-1, 0], [0, 1], [0, -1]] :
                                   [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (const [dx, dy] of dirs) {
        let cx = x + dx, cy = y + dy;
        while (inB(cx, cy)) {
          if (board[cy][cx] === blank) { add(x, y, cx, cy); }
          else { if (colorOf(board[cy][cx]) !== color) add(x, y, cx, cy); break; }
          cx += dx; cy += dy;
        }
      }
    }
  }
  return moves;
}

function turnToColor(turn) { return turn === 0 ? white : black; }

function applyMove(board, m) {
  const b = board.map(r => r.slice());
  const piece = b[m.y][m.x];
  const enemy = 1 - colorOf(piece);
  if (m.extra === 'ep') {
    b[m.y][m.tx] = blank; // captured pawn (same row, on target file)
  }
  b[m.ty][m.tx] = piece;
  b[m.y][m.x] = blank;
  if (m.extra === 'castleK') { b[m.ty][m.tx - 1] = b[m.ty][m.tx + 2]; b[m.ty][m.tx + 2] = blank; }
  if (m.extra === 'castleQ') { b[m.ty][m.tx + 1] = b[m.ty][m.tx - 2]; b[m.ty][m.tx - 2] = blank; }
  return b;
}

function legalMoves(board, turn, crs, epSq) {
  const color = turn === 0 ? 0 : 1;
  const enemy = 1 - color;
  const out = [];
  for (const m of pseudoMoves(board, turn, crs, epSq)) {
    const b2 = applyMove(board, m);
    const k = findKing(b2, color);
    if (!kingAttacked(b2, color, k.x, k.y)) out.push(m);
  }
  return out;
}

const sqn = (x, y) => String.fromCharCode(97 + x) + (8 - y);

for (const name of ['pos3', 'pos4', 'pos5', 'pos6']) {
  const { board, turn, crs, epSq } = parse(POSITIONS[name].fen);
  const moves = legalMoves(board, turn, crs, epSq);
  console.log(`\n=== ${name} d1 reference: ${moves.length} moves`);
  const by = {};
  for (const m of moves) {
    const p = typeOf(board[m.y][m.x]);
    const name2 = { 1: 'p', 2: 'n', 3: 'b', 4: 'r', 5: 'q', 6: 'k' }[p];
    by[name2] = (by[name2] || 0) + 1;
  }
  console.log('  by piece:', JSON.stringify(by));
  console.log('  ' + moves.map(m => `${{ 1: 'p', 2: 'n', 3: 'b', 4: 'r', 5: 'q', 6: 'k' }[typeOf(board[m.y][m.x])]}${sqn(m.x, m.y)}-${sqn(m.tx, m.ty)}${m.extra ? '(' + m.extra + ')' : ''}`).sort().join(' '));
}
