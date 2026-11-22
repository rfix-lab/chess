// layout.js — single source of truth for canvas geometry (style) and the
// server<->visual coordinate orientation seam (logic).
//
// Two concerns live here:
//
//   STYLE (S-class): the canvas geometry — margin offsets, the 480px size cap,
//     the 70% viewport-height fraction, and label placement. A designer
//     restyling the board edits ONLY these constants.
//
//   LOGIC (L-class): the orientation transforms between the SERVER orientation
//     (the one the engine in chessutils.js and the network use: row 0 = black
//     back rank, x = file a-h) and the VISUAL orientation the canvas draws.
//     White (color 0) sees the server orientation directly; black (color 1)
//     sees it rotated 180 degrees. Before this module, that 180-degree
//     transform was copy-pasted in four+ places (selectPiece,
//     display_possible_moves, gameSockets start/reconnect/validated, and the
//     move-emit); every copy had to be re-derived on any restyle. All of them
//     now call orientToServer / orientToVisual / rotateBoard.
//
// Plain script (no ES modules) to match how the other client scripts are
// loaded in game.ejs; must be included BEFORE game.js and gameSockets.js,
// which consume window.ChessLayout.
(function (global) {
  'use strict';

  const SIZE = 8;

  // ---- pure style: designer-owned constants (values identical to the old
  // recalcLayout()/draw()/get_box_coords() magic numbers) ----
  const OFFSET = { x: 10, y: 10 };   // board inset inside the canvas
  const CELL_CAP = 480;              // max board size in px (mirrors CSS max-width)
  const VIEW_HF = 0.7;               // board may occupy at most 70% of viewport height
  // Rank/file label placement as FRACTIONS of the offset and board size —
  // draw() multiplies these by the live OFFSET/side_len so labels follow any
  // restyle. Values reproduce the old draw() magic numbers exactly
  // (offset_x/3, offset_y*1.3, offset_x*0.9, offset_y*1.1 + side_len + 10).
  const LABELS = { rankX: 1 / 3, rankY: 1.3, fileX: 0.9, fileY: 1.1, fileGap: 10 };

  // Board size in px: min(viewport width - 8px, 480, viewport height * 0.7),
  // minus the two margins. Exactly the old recalcLayout() arithmetic.
  function cellSize() {
    const vw = global.innerWidth || 0;
    const vh = global.innerHeight || 0;
    const maxCanvas = Math.min(vw - 8, CELL_CAP);
    const maxH = vh * VIEW_HF;
    const total = Math.floor(Math.min(maxCanvas, maxH));
    return total - OFFSET.x * 2 - 10; // side_len
  }

  // visual square (x = file 0..7 left->right, y = rank 0..7 top->bottom on the
  // canvas) -> canvas pixel position of the square center. Replaces the old
  // `offset_x + j * cell + cell/2` arithmetic.
  function squareToPixel(x, y) {
    const cell = cellSize() / SIZE;
    return { x: OFFSET.x + (x + 0.5) * cell, y: OFFSET.y + (y + 0.5) * cell };
  }

  // visual square -> canvas pixel position of the square's TOP-LEFT corner
  // (replaces the old `offset_x + i * cell` fillRect arithmetic in draw()).
  function squareTopLeft(x, y) {
    const cell = cellSize() / SIZE;
    return { x: OFFSET.x + x * cell, y: OFFSET.y + y * cell, cell: cell };
  }

  // canvas px -> visual square. Replaces get_box_coords(). Returns {x, y}
  // (or null when outside the 0..7 grid).
  function pixelToSquare(px, py) {
    const cell = cellSize() / SIZE;
    const x = Math.floor((px - OFFSET.x) / cell);
    const y = Math.floor((py - OFFSET.y) / cell);
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return null;
    return { x, y };
  }

  // ---- LOGIC: the ONLY orientation code in the app ----
  // color: 0 = white (server orientation), 1 = black (rotated 180 degrees).
  // 180-degree rotation is its own inverse, so visual->server and
  // server->visual are the same mapping; both names are exposed to keep call
  // sites readable. Identity ONLY for color === 0 — any other value (1, or an
  // unset/null my_color) rotates, mirroring the legacy `color == 0` branches
  // exactly.
  function orientToServer(x, y, color) {
    if (color === 0) return { x: x, y: y };
    return { x: SIZE - 1 - x, y: SIZE - 1 - y };
  }
  function orientToVisual(x, y, color) {
    return orientToServer(x, y, color); // same 180-degree map, inverse direction
  }

  // 180-degree-rotated copy of an 8x8 board for `color` (a plain copy for
  // white). Tolerates indicator bits (last-move / check / en-passant) as
  // opaque ints — each cell is copied wholesale, never decomposed. Does NOT
  // mutate the input.
  function rotateBoard(board, color) {
    if (color === 0) return board.map(function (row) { return row.slice(); });
    const out = [];
    for (let i = SIZE - 1; i >= 0; i--) out.push(board[i].slice().reverse());
    return out;
  }

  global.ChessLayout = {
    SIZE, OFFSET, CELL_CAP, VIEW_HF, LABELS,
    cellSize, squareToPixel, squareTopLeft, pixelToSquare,
    orientToServer, orientToVisual, rotateBoard
  };
})(window);
