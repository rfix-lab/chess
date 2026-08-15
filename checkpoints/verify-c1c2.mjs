// verify-c1c2.mjs — verifies C1 (isKingInCheck defined) + C2 (king-side castling path)
// in the CLIENT chessutils (src/public/js/chessutils.js).
//
// Client script uses bare globals (blank/white/black/king/rook/...) normally provided
// by game.js in the browser. We define them here in the same scope, then evaluate the
// client file in that scope so all functions share them.
//
// Exit code 0 = all expectations met, 1 = at least one mismatch.

import { readFileSync } from 'node:fs';

const CLIENT = process.argv[2] || '/root/proj/chess/src/public/js/chessutils.js';

const code = readFileSync(CLIENT, 'utf8');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  PASS  ${name} -> ${actual}`); }
  else { fail++; console.log(`  FAIL  ${name} -> got ${actual}, expected ${expected}`); }
}

const run = new Function(
  'blank','white','black','pawn','knight','bishop','rook','queen','king',
  'whiteTurn','blackTurn','code',
  'const out={}; with(globalThis){ eval(code); }' +
    'return {kingMoveValidate, checkLegalMove, isKingInCheck, chessMoveValidate};'
);

// Piece / color constants (mirror server src/lib/chessutils.js + game.js)
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

// Evaluate the client. In the broken (pre-fix) build `isKingInCheck` is undefined,
// so the trailing `return { ... isKingInCheck ... }` itself throws a ReferenceError.
// Catch that so the before/after comparison produces a clean report, not a crash.
let kingMoveValidate;
let isKingInCheck;
let evalError = null;
try {
  const api = run(blank, white, black, pawn, knight, bishop, rook, queen, king, whiteTurn, blackTurn, code);
  kingMoveValidate = api.kingMoveValidate;
  isKingInCheck = api.isKingInCheck;
} catch (e) {
  evalError = e;
  console.log(`  [eval] client file threw: ${e.constructor.name}: ${e.message}`);
  kingMoveValidate = () => { throw evalError; };
  isKingInCheck = undefined;
}

// C1: function must be a function (was undefined -> ReferenceError)
check('C1: isKingInCheck is defined (typeof function)', typeof isKingInCheck, 'function');

// Empty 8x8 board
const emptyBoard = () => Array.from({ length: 8 }, () => Array(8).fill(blank));

// Starting-castling position for WHITE (row 7): king e1 (4,7), rook a1 (0,7), rook h1 (7,7)
function castlingPosWhite() {
  const b = emptyBoard();
  b[7][4] = king | white;   // e1
  b[7][0] = rook | white;   // a1
  b[7][7] = rook | white;   // h1
  return b;
}
const fullRights = { whiteKingSide: true, whiteQueenSide: true, blackKingSide: true, blackQueenSide: true };
const fromKing = { x: 4, y: 7 };
const toKingside = { x: 6, y: 7 };
const toQueenside = { x: 2, y: 7 };

console.log('--- C2: white castling (king e1 row 7) ---');

// Wrap a castling call: if it throws (e.g. ReferenceError from the pre-fix build),
// report the throw as the result instead of crashing the whole run.
function callValidate(b, to, rights) {
  try {
    return kingMoveValidate(b, fromKing, to, whiteTurn, { castlingRights: rights });
  } catch (e) {
    return 'THROW:' + e.message;
  }
}

// (0) O-O: f1(5),g1(6) blank + rook h1(7) -> true
{
  const b = castlingPosWhite();
  check('O-O valid path (f1,g1 blank, rook h1) == true',
    callValidate(b, toKingside, fullRights), true);
}

// (1) O-O with f1 (x=5) occupied -> false
{
  const b = castlingPosWhite();
  b[7][5] = bishop | white;
  check('O-O with f1 occupied == false',
    callValidate(b, toKingside, fullRights), false);
}

// (2) O-O with g1 (x=6) occupied -> false
{
  const b = castlingPosWhite();
  b[7][6] = bishop | white;
  check('O-O with g1 occupied == false',
    callValidate(b, toKingside, fullRights), false);
}

// (3) O-O without king-side right -> false
{
  const b = castlingPosWhite();
  check('O-O without whiteKingSide right == false',
    callValidate(b, toKingside, { ...fullRights, whiteKingSide: false }), false);
}

// (4) O-O-O: b1(1),c1(2),d1(3) blank + rook a1(0) -> true
{
  const b = castlingPosWhite();
  check('O-O-O valid path (b1,c1,d1 blank, rook a1) == true',
    callValidate(b, toQueenside, fullRights), true);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
