// verify-c3-sync.mjs — C3: client/server chessutils sync verification.
//
// (A) IDENTITY: for each function in the validator list, extract the body from
//     BOTH src/lib/chessutils.js (server, reference) and src/public/js/chessutils.js
//     (client), normalize (strip `export `, comments, ALL whitespace), and compare.
//     All listed functions must be 1:1.
//     Special case: chessMoveValidate — client has 2 commented-out `// assert.equal`
//     lines instead of 2 active assert calls (client has no `import assert`).
//     For it we strip ALL lines starting with `//` on BOTH sides before comparing,
//     so only the executable code is compared. (Documented as "diff = comments only".)
//     genLegalMoves + deriveCastlingRights are intentionally CLIENT-ONLY (server never
//     sends castlingRights to the client; client derives rights from the board for
//     highlight/click-to-move) — reported separately, NOT a failure.
//
// (B) UI REGRESSION: actually run the CLIENT genLegalMoves (4-arg) in a scope with
//     game.js constants (blank/white/black/pawn/king/rook/queen/bishop/knight) and
//     check that castling + en-passant squares are still highlighted:
//       - white O-O (king e1 (4,7), rook h1 (7,7), f1/g1 blank) -> (6,7) in moves
//       - white O-O blocked (pawn f1 (5,7)) -> (6,7) NOT in moves
//       - white O-O-O (rook a1 (0,7), b1/c1/d1 blank) -> (2,7) in moves
//       - black O-O (king e8 (4,0), rook h8 (7,0)) -> (6,0) in moves
//       - en-passant: white pawn e5 (4,3) vs black pawn d5 (3,4); lastMove = black
//         pawn double push (3,6)->(3,4) -> (3,4) in moves (e5xd6)
//       - same without lastMove (null) -> (3,4) NOT in moves
//
// Exit 0 = all PASS, 1 = at least one FAIL.

import { readFileSync } from 'node:fs';

const ROOT = '/root/proj/chess';
const SERVER = `${ROOT}/src/lib/chessutils.js`;
const CLIENT = `${ROOT}/src/public/js/chessutils.js`;

const serverCode = readFileSync(SERVER, 'utf8');
const clientCode = readFileSync(CLIENT, 'utf8');

let pass = 0, fail = 0;
function report(name, ok, note) {
  if (ok) { pass++; console.log(`  PASS  ${name}${note ? ' — ' + note : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${note ? ' — ' + note : ''}`); }
}

// ---------- (A) IDENTITY ----------

// Extract the body of `function NAME(...)` (optionally `export function`) via
// brace balancing from the first `{` after the signature.
function extractFnBody(code, name) {
  const re = new RegExp('^(?:export\\s+)?function ' + name + '\\s*\\(', 'm');
  const m = re.exec(code);
  if (!m) return null;
  const start = code.indexOf('{', m.index + m[0].length - 1);
  if (start === -1) return null;
  let depth = 0, i = start;
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) return null;
  return code.slice(start + 1, i);
}

// Normalize: remove comment lines, remove ALL whitespace.
// stripComments=true  -> drop whole lines whose first non-space char is `//`
// removeAsserts=true  -> additionally drop lines containing `assert.equal`
//                        (chessMoveValidate: server has 2 active assert lines,
//                        client has them commented out — no `import assert` there)
function normalize(body, { stripComments = true, removeAsserts = false } = {}) {
  let lines = body.split('\n');
  if (stripComments) lines = lines.filter(l => l.trim().indexOf('//') !== 0);
  if (removeAsserts) lines = lines.filter(l => l.indexOf('assert.equal') === -1);
  return lines.join('').replace(/\s+/g, '');
}

// Functions that must be 1:1 between client and server (validator bodies).
const STRICT_IDS = [
  'checkLegalMove', 'chessMoveValidate', 'checkCheck', 'pawnMoveValidate',
  '_wasPawnDoublePush', 'whitePawnMoveValidate', 'blackPawnMoveValidate',
  'knightMoveValidate', 'bishopMoveValidate', 'rookMoveValidate',
  'queenMoveValidate', 'kingMoveValidate', 'genAllMoves', 'genAllLegalMoves',
  'isKingInCheck', 'validBoard', 'coordValidate', 'turnValidate',
];

console.log('--- (A) IDENTITY: client vs server function bodies ---');

for (const name of STRICT_IDS) {
  const s = extractFnBody(serverCode, name);
  const c = extractFnBody(clientCode, name);
  if (s === null || c === null) {
    report(`identity: ${name}`, false, `missing in server=${s === null} client=${c === null}`);
    continue;
  }
  const dropAsserts = name === 'chessMoveValidate'; // active (server) vs // commented (client)
  const same = normalize(s, { removeAsserts: dropAsserts }) === normalize(c, { removeAsserts: dropAsserts });
  report(`identity: ${name}`, same, dropAsserts ? 'assert lines excluded (comment-only diff, no import assert on client)' : '');
}

// client-only, expected to differ — report, not fail
for (const name of ['genLegalMoves', 'deriveCastlingRights']) {
  const c = extractFnBody(clientCode, name);
  const s = extractFnBody(serverCode, name);
  const differs = (s === null || c === null) ||
    normalize(s ?? '', { stripComments: false }) !== normalize(c, { stripComments: false });
  const hasBody = c !== null;
  report(`client-only: ${name}`, hasBody,
    hasBody ? `present in client, ${differs ? 'differs from server (expected)' : 'matches server'}` : 'MISSING');
}

// ---------- (B) UI REGRESSION (client genLegalMoves, 4-arg) ----------

// game.js:19-28 defines these piece/color constants in browser scope; the
// client chessutils.js does not (its const block is commented out) and relies
// on them. chessutils.js itself defines noOfSquares/whiteTurn/blackTurn + all
// functions (Coord, getPiece, getColor, turnToColor, colorToTurn, Move, ...).
const blank = 0b0000;
const white = 0b0000;
const black = 0b1000;
const pawn = 0b0001;
const king = 0b0010;
const queen = 0b0011;
const rook = 0b0100;
const bishop = 0b0101;
const knight = 0b0110;
const whiteTurn = 0;
const blackTurn = 1;

// Evaluate the client file in a scope where those constants are visible,
// and pull out the client genLegalMoves (4-arg).
const runClient = new Function(
  'blank','white','black','pawn','king','queen','rook','bishop','knight',
  'whiteTurn','blackTurn','code',
  'const out={}; with(globalThis){ eval(code); }' +
    'return { genLegalMoves, deriveCastlingRights };'
);

let genLegalMoves, deriveCastlingRights, evalError = null;
try {
  const api = runClient(blank, white, black, pawn, king, queen, rook, bishop, knight,
    whiteTurn, blackTurn, clientCode);
  genLegalMoves = api.genLegalMoves;
  deriveCastlingRights = api.deriveCastlingRights;
} catch (e) {
  evalError = e;
  console.log(`  [eval] client file threw: ${e.constructor.name}: ${e.message}`);
}

console.log('--- (B) UI REGRESSION: client genLegalMoves still highlights castling + en-passant ---');

if (evalError) {
  report('client code evaluates', false, evalError.message);
} else {
  report('client code evaluates', true);

  const emptyBoard = () => Array.from({ length: 8 }, () => Array(8).fill(blank));
  const has = (moves, x, y) => moves.some(m => m.to.x === x && m.to.y === y);

  // --- White O-O: king (4,7), rook (7,7), f1/g1 blank ---
  {
    const b = emptyBoard();
    b[7][4] = white | king;
    b[7][7] = white | rook;
    const moves = genLegalMoves(b, { x: 4, y: 7 }, null, null);
    report('white O-O (e1->g1) highlighted', has(moves, 6, 7));
  }
  // --- White O-O blocked: pawn on f1 (5,7) ---
  {
    const b = emptyBoard();
    b[7][4] = white | king;
    b[7][7] = white | rook;
    b[7][5] = white | pawn;
    const moves = genLegalMoves(b, { x: 4, y: 7 }, null, null);
    report('white O-O blocked by f1 pawn: (6,7) NOT highlighted', !has(moves, 6, 7));
  }
  // --- White O-O-O: king (4,7), rook (0,7), b1/c1/d1 blank ---
  {
    const b = emptyBoard();
    b[7][4] = white | king;
    b[7][0] = white | rook;
    const moves = genLegalMoves(b, { x: 4, y: 7 }, null, null);
    report('white O-O-O (e1->c1) highlighted', has(moves, 2, 7));
  }
  // --- Black O-O: king (4,0), rook (7,0) ---
  {
    const b = emptyBoard();
    b[0][4] = black | king;
    b[0][7] = black | rook;
    const moves = genLegalMoves(b, { x: 4, y: 0 }, null, null);
    report('black O-O (e8->g8) highlighted', has(moves, 6, 0));
  }
  // --- En-passant (coordinates verified against the code, NOT the task brief) ---
  // Code anchors: white back rank y=7 (king e1=(4,7)); white pawn start y=6, double
  // push y=6->y=4 (whitePawnMoveValidate) => white moves toward DECREASING y;
  // rank r => y = 8 - r. Hence:
  //   white pawn e5 = (4,3)                      [matches brief]
  //   black pawn d5 = (3,3)                      [brief said (3,4) — off-by-one]
  //   black d7->d5 double push: (3,1) -> (3,3)   [brief said (3,6)->(3,4) = the WHITE
  //                                               pawn pattern; a BLACK pawn starts at
  //                                               the 7th rank y=1 and double-pushes
  //                                               to the 5th rank y=3 — see
  //                                               blackPawnMoveValidate: from y==1 to y==3]
  //   ep capture e5xd6 target = (3,2)            [brief said (3,4); the white pawn at
  //                                               y=3 captures to y=2 per
  //                                               `moveFromCoord.y - 1 == moveToCoord.y`]
  // whitePawnMoveValidate EP branch: dest (3,2) blank, adjacent (3,3) === black|pawn,
  // _wasPawnDoublePush(match, 3, 3, black) on lastMove to (3,3) from (3,1) => true.
  {
    const b = emptyBoard();
    b[3][4] = white | pawn;   // white pawn e5 (4,3)
    b[3][3] = black | pawn;   // black pawn d5 (3,3), just double-pushed (3,1)->(3,3)
    const lastMove = { from: { x: 3, y: 1 }, to: { x: 3, y: 3 }, piece: black | pawn };
    const withLast = genLegalMoves(b, { x: 4, y: 3 }, null, lastMove);
    const withoutLast = genLegalMoves(b, { x: 4, y: 3 }, null, null);
    report('en-passant e5xd6 (3,2) highlighted WITH lastMove', has(withLast, 3, 2));
    report('en-passant (3,2) NOT highlighted without lastMove', !has(withoutLast, 3, 2));
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
