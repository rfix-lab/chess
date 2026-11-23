const move_sound = new Audio('/audio/move-self.mp3');
const capture_sound = new Audio('/audio/capture.mp3');
const wrong_move_sound = new Audio('/audio/wrong_move_sound.mp3');

const canvas = document.getElementById("cnv");
const ctx = canvas.getContext('2d');

var dark_square_color = '#55648a';
var label_color = '#eef2f9'; // board rank/file labels — synced to --text by updateBoardColors
var light_square_color = '#e9eef6';
const move_square_color = '#7af4ae';
const possible_move_color = '#74f551';
const check_square_color = '#ff4444';

const start_fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

// TEST-ONLY (test/e2e-client.mjs): lets the harness read the client's board
// global and known color without scraping the canvas. Deliberately tiny;
// safe to delete if the headless harness is ever retired.
window.__chessDebug = {
    getBoard: () => board,
    get myColor() { return my_color; }
};

// Single source of truth for canvas geometry and the server<->visual
// coordinate orientation seam (window.ChessLayout, layout.js — loaded first).
const layout = window.ChessLayout;

let side_len, offset_x, offset_y;
const no_of_squares = 8;
const blank = 0b0000;
const white = 0b0000;
const black = 0b1000;

const pawn = 0b0001;
const king = 0b0010;
const queen = 0b0011;
const rook = 0b0100;
const bishop = 0b0101;
const knight = 0b0110;

// Captured pieces tracking
let capturedByWhite = [];
let capturedByBlack = [];

const pieceSortOrder = {
  0b0011: 0, // queen
  0b0100: 1, // rook
  0b0101: 2, // bishop
  0b0110: 3, // knight
  0b0001: 4, // pawn
};

function sortCaptured(arr) {
  return arr.slice().sort((a, b) => (pieceSortOrder[a] || 9) - (pieceSortOrder[b] || 9));
}

function recalcLayout() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Canvas must fit within vw minus 8px safe margin — all geometry now lives
  // in layout.js (OFFSET / CELL_CAP / VIEW_HF); see the style constants there.
  const maxCanvas = Math.min(vw - 8, layout.CELL_CAP);
  const maxH = vh * layout.VIEW_HF;
  const total = Math.floor(Math.min(maxCanvas, maxH));

  offset_x = layout.OFFSET.x;
  offset_y = layout.OFFSET.y;
  side_len = layout.cellSize();

  const dpr = window.devicePixelRatio || 1;
  canvas.width = total * dpr;
  canvas.height = total * dpr;
  canvas.style.maxWidth = (vw - 8) + 'px';
  canvas.style.maxHeight = (vh * layout.VIEW_HF) + 'px';
  ctx.scale(dpr, dpr);
}

const delta_time = 10;

let is_mouse_down = false;
let was_mouse_down = false; // legacy (kept for the 10ms loop's state); drag is event-driven (fix C)
let is_holding_piece = false;
let holding_piece = 0; // the value of the piece held
let mouse_x, mouse_y;
let curr_position;
let dragSettled = false; // set by completeDrag(): the drop was finished+emitted in the mouseup handler
let from_position = {'x' : 0, 'y' : 0}; // position being dragged from
let to_position= {'x' : 0, 'y' : 0};    // position being dragged to
let old_piece; // value of the piece at the target square originally
let new_piece; // value of the piece being dragged to the square
let is_being_validated = false;
let can_move = false; // to disable dragging when it's not your turn
let my_color = null;  // white or black

// Click-to-move state
let selectedSquare = null;        // {x, y} in visual coords or null
let lastMove = null;              // {from: {x,y}, to: {x,y}, piece} in server coords
let lastMouseDownPx = null;       // {x, y} pixel coords for click vs drag detection
let isDragging = false;           // true if mouse moved significantly after mousedown
let legalMoveSquares = new Set(); // "x,y" keys of legal move targets (visual coords)
const CLICK_THRESHOLD = 5;        // pixels — if mouse moved less, treat as click
const selected_square_color = '#4a90d9';
const selected_square_opacity = 0.5;

let sprites = [];
sprites[blank] = ' ';
// USER-FACING RENDERING FIX (2026-11-23): the OUTLINE glyphs (U+2654-59) the
// white side used to map to are hollow: on canvas the square color shows
// through the interior — on dark squares white pieces looked "transparent /
// nearly black". Both colors now use the SOLID glyph set (U+265A-5F); the
// color distinction is done at draw time (white pieces: white fill + dark
// stroke, see render_board). '\uFE0E' (text variation selector) forces a text
// glyph on platforms that otherwise render chess symbols as COLOR EMOJI
// (Android/macOS), which would ignore fillStyle entirely.
const VS15 = '\uFE0E';
sprites[white | pawn] = '♟' + VS15;
sprites[white | king] = '♚' + VS15;
sprites[white | queen] = '♛' + VS15;
sprites[white | rook] = '♜' + VS15;
sprites[white | bishop] = '♝' + VS15;
sprites[white | knight] = '♞' + VS15;

sprites[black | pawn] = '♟' + VS15;
sprites[black | king] = '♚' + VS15;
sprites[black | queen] = '♛' + VS15;
sprites[black | rook] = '♜' + VS15;
sprites[black | bishop] = '♝' + VS15;
sprites[black | knight] = '♞' + VS15;

let board = [
  [12, 14, 13, 11, 10, 13, 14, 12],
  [9, 9, 9, 9, 9, 9, 9, 9],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [4, 6, 5, 3, 2, 5, 6, 4]];


// updates the board based on given FEN string 
function fen_to_board(fen) {
    let new_board = board;
    let rank = 0, file = 0;
    let ind = 0;
    while (ind < fen.length) {
        let c = fen[ind];
        ind++;
        if (c == '/') {
            rank++;
            file = 0;
            continue;
        }
        if (!isNaN(parseInt(c, 10))) {
            file += parseInt(c, 10);
            continue;
        }
        switch (c) {
            case 'p': new_board[rank][file] = black | pawn;
                break;
            case 'k': new_board[rank][file] = black | king;
                break;
            case 'q': new_board[rank][file] = black | queen;
                break;
            case 'r': new_board[rank][file] = black | rook;
                break;
            case 'b': new_board[rank][file] = black | bishop;
                break;
            case 'n': new_board[rank][file] = black | knight;
                break;
            case 'P': new_board[rank][file] = white | pawn;
                break;
            case 'K': new_board[rank][file] = white | king;
                break;
            case 'Q': new_board[rank][file] = white | queen;
                break;
            case 'R': new_board[rank][file] = white | rook;
                break;
            case 'B': new_board[rank][file] = white | bishop;
                break;
            case 'N': new_board[rank][file] = white | knight;
                break;
        }
        file++;
    }

    board = new_board;
}

// Draws the pieces and pawns.
// Both colors use the SOLID glyph set now (see sprites): white pieces are
// painted white with a dark outline (a bare outline glyph was invisible on
// dark squares), black pieces dark with a subtle light outline.
function drawPieceGlyph(glyph, isWhite, gx, gy) {
    if (isWhite) {
        ctx.fillStyle = '#ffffff';
        ctx.fillText(glyph, gx, gy);
        ctx.strokeStyle = 'rgba(20, 26, 38, 0.9)';
    } else {
        ctx.fillStyle = '#141a26';
        ctx.fillText(glyph, gx, gy);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    }
    ctx.strokeText(glyph, gx, gy);
}

function render_board() {
    let side_len_square = side_len / no_of_squares;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = Math.floor(side_len_square * 0.75) + 'px sans-serif';
    ctx.lineJoin = 'round';
    // OUTLINE WEIGHT (user bughunt 2026-11-23): 0.045 produced a ~3px halo on
    // 64px cells — 2.5x too thick. 0.018 keeps the glyph edge readable.
    ctx.lineWidth = Math.max(0.5, side_len_square * 0.018);
    for (let i = 0; i < no_of_squares; i++) {
        for (let j = 0; j < no_of_squares; j++) {
            const v = board[i][j] & 0b1111;
            if (v === blank) continue; // strip indicators; empty needs no glyph
            drawPieceGlyph(sprites[v], (v & black) === 0,
                offset_x + j * side_len_square + side_len_square / 2,
                offset_y + i * side_len_square + side_len_square / 2);
        }
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
}


// draws the board
function draw() {

    let side_len_square = side_len / no_of_squares;
    for (let i = 0; i < no_of_squares; i++) {
        for (let j = 0; j < no_of_squares; j++) {
            if ((i + j) % 2 == 0) {
                ctx.fillStyle = light_square_color;
            }
            else
                ctx.fillStyle = dark_square_color;
            if(board.length != 0  && (board[i][j] & 0b10000) > 0){
                // console.log(i, j)
                ctx.fillStyle = move_square_color;
            }
            // En passant target square indicator
            if(board[i][j] & 0b1000000) {
                ctx.fillStyle = '#ffcc44';
            }
            // Check indicator: red highlight on king's square
            if (board[i][j] & 0b100000) {
                ctx.fillStyle = check_square_color;
            }

            ctx.fillRect(offset_x + j * side_len_square,
                offset_y + i * side_len_square,
                side_len_square, side_len_square);

            // Click-to-move: selected square highlight
            // PIXEL TRANSPOSITION FIX (2026-11-23, user bughunt): every fillRect
            // here used x=i, y=j while pieces (render_board), pixelToSquare and
            // the board convention board[y][x] all use x=j, y=i. Result: every
            // overlay (last-move/check/en-passant squares, selection, legal-move
            // tints) rendered mirrored across the main diagonal while the JS
            // state was correct — invisible to state-reading tests, glaring in
            // the browser. Geometry only change; keys/conditions untouched.
            if (selectedSquare && j === selectedSquare.x && i === selectedSquare.y) {
                ctx.globalAlpha = selected_square_opacity;
                ctx.fillStyle = selected_square_color;
                ctx.fillRect(offset_x + j * side_len_square, offset_y + i * side_len_square, side_len_square, side_len_square);
                ctx.globalAlpha = 1.0;
            }
            // Click-to-move: legal move indicators
            if (legalMoveSquares.has(j + ',' + i)) {
                ctx.globalAlpha = 0.3;
                ctx.fillStyle = possible_move_color;
                ctx.fillRect(offset_x + j * side_len_square, offset_y + i * side_len_square, side_len_square, side_len_square);
                ctx.globalAlpha = 1.0;
            }
        }
    }
    // Display the rank and file numbers and letters
    // THEME-AWARE (2026-11-23 fix): labels used to be drawn in 'black' on a
    // 10px margin — invisible on the dark theme and half-clipped off-canvas.
    // They now use the theme text color (label_color, refreshed by
    // updateBoardColors) and sit CENTERED inside the layout.OFFSET margins.
    const cell = side_len_square;
    ctx.fillStyle = label_color;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < no_of_squares; i++) {
        // ranks: left margin, vertical center of each row
        ctx.fillText(my_color == 0 ? String(8 - i) : String(1 + i),
            offset_x / 2, offset_y + (i + 0.5) * cell);
        // files: bottom margin, horizontal center of each column
        ctx.fillText(my_color == 0 ? String.fromCharCode(97 + i) : String.fromCharCode(104 - i),
            offset_x + (i + 0.5) * cell, offset_y + side_len + offset_y / 2);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
}

// get_box_coords -> layout.pixelToSquare: canvas px -> visual square.
// Returns [i, j] (legacy array shape, -1 when off-board) so existing call
// sites keep working; the layout.js seam is the single source of the math.
function get_box_coords() {
    const p = layout.pixelToSquare(mouse_x, mouse_y);
    return p ? [p.y, p.x] : [-1, -1];
}

function getVisualPieceColor(value) {
    if ((value & 0b111) === blank) return -1;
    return (value & black) ? 1 : 0;
}

function selectPiece(x, y) {
    let piece = board[y][x];
    if ((piece & 0b1111) === blank) return false;
    if (getVisualPieceColor(piece) !== my_color) return false;
    selectedSquare = {x: x, y: y};
    legalMoveSquares.clear();

    // The engine (chessutils.js) works in SERVER orientation (row 7 = white home
    // rank, white pawns on row 6, black pawns on row 1). For black the local
    // `board` is rotated 180 degrees and (x, y) are visual coordinates, so undo
    // the rotation before querying the engine and rotate the targets back for
    // highlighting. Without this, black pawns sit on visual row 6 while the
    // engine expects row 1: click-to-move highlights were wrong/empty for
    // pawns and castling was never highlighted for black, so black could not
    // make pawn moves via click at all. (The drag path in display_possible_moves
    // already does this conversion.)
    let engineBoard = board;
    let pos = Coord(x, y);
    if (my_color != 0) {
        engineBoard = layout.rotateBoard(board, my_color);
        let sp = layout.orientToServer(x, y, my_color);
        pos.x = sp.x;
        pos.y = sp.y;
    }
    let moves = genLegalMoves(engineBoard, pos, null, lastMove);
    for (let m of moves) {
        // rotate the engine (server-orientation) targets back to visual coords
        let t = layout.orientToVisual(m.to.x, m.to.y, my_color);
        legalMoveSquares.add(t.x + ',' + t.y);
    }
    return true;
}

function clearSelection() {
    selectedSquare = null;
    legalMoveSquares.clear();
}

function sendMoveToServer(fromX, fromY, toX, toY) {
    from_position = { x: fromX, y: fromY };
    to_position = { x: toX, y: toY };

    // visual -> server orientation (identity for white): single seam call
    let serverFrom = layout.orientToServer(fromX, fromY, my_color);
    let serverTo = layout.orientToServer(toX, toY, my_color);
    // F3: lastMove is server-authoritative now — 'validated' carries
    // match.lastMove for BOTH clients. Setting it locally here polluted the
    // EP target whenever the server later rejected the move, so we no longer
    // track it on click; the payload updates it for both sides atomically with
    // the new board.
    socket.emit('move', matchId, serverFrom, serverTo);
    is_being_validated = true;
}

function executeClickToMove(clickX, clickY) {
    if (selectedSquare === null) {
        selectPiece(clickX, clickY);
    } else {
        let key = clickX + ',' + clickY;
        if (legalMoveSquares.has(key)) {
            sendMoveToServer(selectedSquare.x, selectedSquare.y, clickX, clickY);
            clearSelection();
        } else {
            let piece = board[clickY][clickX];
            if ((piece & 0b1111) !== blank && getVisualPieceColor(piece) === my_color) {
                selectPiece(clickX, clickY);
            } else {
                clearSelection();
            }
        }
    }
}

function grabDragPiece(px, py) {
    // Called from the mousedown/touchstart handler. Sets the held-piece state
    // immediately if the press is on a piece square (state is consumed by the
    // render loop from the first mousemove onward). No board mutation yet —
    // the loop's sprite redraw (is_holding_piece) does that, exactly as before.
    let pos = layout.pixelToSquare(px, py);
    if (!pos) return;
    let i = pos.y, j = pos.x;
    if ((board[i][j] & 0b1111) === 0)
        return;
    // USER-BUGHUNT FIX (2026-11-23): grabbing an OPPONENT piece blanked its
    // square just the same (the render loop clears from_position while a grab
    // is active) — "touching any piece makes it disappear". Only our own
    // pieces may be grabbed; the click-to-move path handles enemy squares.
    if (getVisualPieceColor(board[i][j]) !== my_color)
        return;
    // set the holding piece to whatever is on that square
    is_holding_piece = true;
    // strip indicator bits (last-move/check/en-passant, >= 0b10000): the held
    // piece may be RESTORED into the board later (cancel branch / click flow),
    // and a raw value would plant a piece+indicator ghost square.
    holding_piece = board[i][j] & 0b1111;
    from_position = { x: j, y: i };
}

// Shared grab release for every NON-drag end of a grab (click path on
// mouseup/touchend, window-level mouseup after a drop outside the canvas,
// cancelled grab in handle_drag). The render loop blanks from_position while
// a grab is live; clearing is_holding_piece WITHOUT restoring that square
// deleted the piece off the board array — user complaint "a touched piece
// disappears" (a quick click kept the grab live across one tick, then the
// click path dropped the state). Restore only when the square is still the
// loop-blanked hole: if an authoritative update already refilled it, leave it.
function releaseGrab() {
    if (!is_holding_piece) return;
    if (from_position && board[from_position.y][from_position.x] === blank)
        board[from_position.y][from_position.x] = holding_piece & 0b1111;
    is_holding_piece = false;
    dragSettled = false;
    holding_piece = 0;
}

function completeDrag(px, py) {
    // Called from the mouseup/touchend handler. Finishes the drop and emits
    // the move IMMEDIATELY — no dependency on the 10ms render loop observing
    // the down->up transition (that is the bug C fix).
    let pos = layout.pixelToSquare(px, py);
    let i = pos ? pos.y : -1, j = pos ? pos.x : -1;

    // store the actions, these will be sent to the server
    old_piece = (i >= 0 && i < no_of_squares && j >= 0 && j < no_of_squares)
        ? board[i][j] : blank; // mouseup outside the board -> treat as no capture
    new_piece = holding_piece;
    to_position = { x: j, y: i };
    dragSettled = true;

    // Detect capture
    if ((old_piece & 0b0111) !== blank) {
        const capturedType = old_piece & 0b0111;
        if (my_color === white) {
            capturedByWhite.push(capturedType);
        } else {
            capturedByBlack.push(capturedType);
        }
    }

    // send movement data to the server (visual -> server via the seam;
    // identity for white, 180-degree rotation for black)
    // if(!coordEqual(from_position, to_position))
    let serverFrom = layout.orientToServer(from_position.x, from_position.y, my_color);
    let serverTo = layout.orientToServer(to_position.x, to_position.y, my_color);
    // F3: no local lastMove bookkeeping here anymore — the authoritative
    // value arrives with 'validated' (see sendMoveToServer comment).
    socket.emit('move', matchId, serverFrom, serverTo);
    is_being_validated = true;
    // The drag is finished HERE. If the holding state lingers, handle_drag()
    // blanks the square under the cursor on its next tick — and once the
    // 'validated' broadcast has replaced the board, that blank wipes the
    // freshly confirmed piece off the local board (E2E desync: dropped pawn
    // disappeared one move later). handle_drag must never see a completed drop.
    is_holding_piece = false;
    dragSettled = false;
    holding_piece = 0;
}

// The most complicated function ever
// Handles drag. Fix C: the down->up state machine that emitted 'move' is now
// event-driven (mousedown/touchstart -> grabDragPiece, mouseup/touchend ->
// completeDrag). This loop only updates the hover position and redraws the
// held-piece sprite at the cursor; the emit no longer depends on the 10 ms
// interval observing both the down and the up transition.
function handle_drag() {

    // Dont allow dragging while previous move is being validated
    if(is_being_validated)
        return;

    // get the square on which the mouse is hovering on
    let coords = get_box_coords();
    let i = coords[0], j = coords[1];

    // update the hover position (read by the sprite below)
    curr_position = {
        "x": j,
        "y": i
    }

    if (is_mouse_down) {
        if (is_holding_piece) {
            // if already holding a piece and the mouse is held down,
            // display the held piece at the mouse
            ctx.font = Math.floor(side_len / no_of_squares) * 0.8 + 'px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineJoin = 'round';
            ctx.lineWidth = Math.max(0.5, (side_len / no_of_squares) * 0.018);
            drawPieceGlyph(sprites[holding_piece], (holding_piece & black) === 0,
                mouse_x, mouse_y);
            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
        }
    }
    else if (is_holding_piece) {
        // Cancelled grab: mouse released outside the canvas so no mouseup hit
        // the canvas. A COMPLETED drop is finalized inside completeDrag().
        releaseGrab();
    }
}

// Indicates all the allowed legal moves with green circles
function display_possible_moves(){
    let side_len_square = side_len / no_of_squares;
    let new_board = board;
    let new_from_position = Coord(from_position.x, from_position.y);
    
    // if color is black, the engine needs a rotated copy of the board and
    // rotated from-coordinates (server orientation); else keep it the same
    // — single orientation seam: layout.js
    if (my_color == 0) {
        new_board = board;
    } else {
        new_board = layout.rotateBoard(board, my_color);
        let sp = layout.orientToServer(from_position.x, from_position.y, my_color);
        new_from_position.x = sp.x;
        new_from_position.y = sp.y;
    }

    // Get all the legal moves from the current held piece
    let moves = genLegalMoves(new_board, new_from_position, null, lastMove);
    // console.log(moves);

    // For every legal move draw a green circle indicating that square.
    // BUGHUNT FIX (2026-11-23): was a 15px '⬤' glyph drawn from the square's
    // TOP-LEFT with textAlign 'start' and an off_y of offset_y*1.5 — visibly
    // off-center and size-fixed. Now a centered arc at the true square center
    // (x=j convention), scaled with the cell.
    ctx.beginPath();
    for(let m of moves){
        ctx.fillStyle = possible_move_color;
        // rotate the engine target back to visual coordinates
        let t = layout.orientToVisual(m.to.x, m.to.y, my_color);
        ctx.moveTo(offset_x + t.x * side_len_square + side_len_square / 2 + side_len_square * 0.16, offset_y + t.y * side_len_square + side_len_square / 2);
        ctx.arc(offset_x + t.x * side_len_square + side_len_square / 2,
                offset_y + t.y * side_len_square + side_len_square / 2,
                side_len_square * 0.16, 0, 2 * Math.PI);
    }
    ctx.fill();
}

window.onload = () => {
    // apply the SAVED theme to the canvas colors before the first draw (theme.js
    // runs before game.js exists, so its load-time updateBoardColors() is a no-op
    // without this — a saved LIGHT theme used to paint dark-theme squares).
    updateBoardColors();
    recalcLayout();
    // Only draw the initial board if there's no saved session.
    // If reconnecting, skip draw() here and wait for the 'reconnected' event
    // from the server, which will restore the real board state and call draw().
    const saved = loadSession();
    if (!saved) {
        draw();
        fen_to_board(start_fen);
        // Bug A: if startGame arrived BEFORE onload, startGame already rotated
        // the board for black — and fen_to_board() just overwrote it with the
        // server-orientation start position, leaving black unrotated (wrong
        // opening-move highlights until the first 'validated'). Invariant now
        // enforced regardless of event order: whenever my_color is KNOWN to be
        // black, the visual board equals rotateBoard(serverBoard, 1). Strict
        // === 1 is required: my_color is null until startGame, and `null != 0`
        // is TRUE, so the old loose guard rotated the board for a player whose
        // color was not yet assigned (E2E: white page started 180-flipped
        // until the first 'validated' overwrite).
        if (my_color === 1) {
            board = window.ChessLayout.rotateBoard(board, my_color);
        }
        render_board();
    }
}

canvas.onmousedown = (e) => {
    is_mouse_down = true;
    const rect = canvas.getBoundingClientRect();
    lastMouseDownPx = {x: e.clientX - rect.left, y: e.clientY - rect.top};
    isDragging = false;
    dragSettled = false;
    mouse_x = lastMouseDownPx.x;
    mouse_y = lastMouseDownPx.y;
    // fix C: down->up drag state machine lives in the event handlers now.
    // mousedown selects/grabs the held piece immediately (if we have a turn);
    // the 10ms loop only redraws the sprite from the first mousemove onward.
    if (can_move && !is_being_validated && !is_holding_piece) {
        grabDragPiece(lastMouseDownPx.x, lastMouseDownPx.y);
    }
}
canvas.onmouseup = (e) => {
    is_mouse_down = false;
    const rect = canvas.getBoundingClientRect();
    const ux = e.clientX - rect.left;
    const uy = e.clientY - rect.top;
    if (!isDragging && lastMouseDownPx && can_move) {
        // click-to-move (unchanged click-vs-drag CLICK_THRESHOLD semantics)
        const cx = ux, cy = uy;
        let coords = get_box_coords();
        let i = coords[0], j = coords[1];
        if (i >= 0 && i < no_of_squares && j >= 0 && j < no_of_squares) {
            executeClickToMove(j, i);
        }
        // BUGFIX (Immortal-game audit): a completed click must leave no grab
        // state. USER-BUGHUNT (2026-11-23): release via releaseGrab() so the
        // loop-blanked source square is RESTORED — the old bare state-clear
        // is what deleted a merely-touched piece from the board.
        releaseGrab();
    }
    if (isDragging) {
        // fix C: complete the drop and emit the move right here in the
        // handler — never lost to the 10ms tick boundary again.
        if (can_move && is_holding_piece) completeDrag(ux, uy);
        clearSelection();
    }
    lastMouseDownPx = null;
}

// USER-BUGHUNT (2026-11-23): releasing the button OUTSIDE the canvas fired no
// canvas.onmouseup at all — is_mouse_down stayed true, the grab stayed live
// (piece off the board, sprite stuck at the last position) until the next
// interaction. Window-level safety net: by the time the event bubbles here a
// canvas-handled drop/click has already released the grab, so releaseGrab()
// is a no-op for every canvas-finished interaction; it only heals the
// outside-the-canvas release.
window.addEventListener('mouseup', () => {
    is_mouse_down = false;
    releaseGrab();
});

canvas.ontouchstart = (e) => {
    is_mouse_down = true;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    mouse_x = touch.clientX - rect.left;
    mouse_y = touch.clientY - rect.top;
    lastMouseDownPx = {x: mouse_x, y: mouse_y};
    isDragging = false;
    dragSettled = false;
    // fix C: same event-driven grab as mousedown
    if (can_move && !is_being_validated && !is_holding_piece) {
        grabDragPiece(mouse_x, mouse_y);
    }
};
canvas.ontouchend = (e) => {
    is_mouse_down = false;
    if (!isDragging && lastMouseDownPx && can_move) {
        const touch = e.changedTouches[0];
        const rect = canvas.getBoundingClientRect();
        mouse_x = touch.clientX - rect.left;
        mouse_y = touch.clientY - rect.top;
        let coords = get_box_coords();
        let i = coords[0], j = coords[1];
        if (i >= 0 && i < no_of_squares && j >= 0 && j < no_of_squares) {
            executeClickToMove(j, i);
        }
        // same grab-state release as the mouseup click path (restore via
        // releaseGrab — see USER-BUGHUNT there)
        releaseGrab();
    }
    if (isDragging) {
        // fix C: same event-driven drop + emit as mouseup
        if (can_move && is_holding_piece) completeDrag(mouse_x, mouse_y);
        clearSelection();
    }
    lastMouseDownPx = null;
};


canvas.onmousemove = (event) => {
    const rect = canvas.getBoundingClientRect();
    mouse_x = event.clientX - rect.left;
    mouse_y = event.clientY - rect.top;
    if (is_mouse_down && lastMouseDownPx && !isDragging) {
        let dx = mouse_x - lastMouseDownPx.x;
        let dy = mouse_y - lastMouseDownPx.y;
        if (Math.sqrt(dx * dx + dy * dy) > CLICK_THRESHOLD) {
            isDragging = true;
        }
    }
}
canvas.ontouchmove = (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    mouse_x = touch.clientX - rect.left;
    mouse_y = touch.clientY - rect.top;
    if (is_mouse_down && lastMouseDownPx && !isDragging) {
        let dx = mouse_x - lastMouseDownPx.x;
        let dy = mouse_y - lastMouseDownPx.y;
        if (Math.sqrt(dx * dx + dy * dy) > CLICK_THRESHOLD) {
            isDragging = true;
        }
    }
};

function renderCapturedPieces() {
    const whiteRow = document.getElementById('captured-white');
    const blackRow = document.getElementById('captured-black');
    if (!whiteRow || !blackRow) return;

    let whiteHtml = '';
    let blackHtml = '';

    // White's captures (black pieces taken by white)
    sortCaptured(capturedByWhite).forEach(p => {
        const sym = sprites[black | p];
        if (sym) whiteHtml += `<span class="cap-piece">${sym}</span>`;
    });

    // Black's captures (white pieces taken by black)
    sortCaptured(capturedByBlack).forEach(p => {
        const sym = sprites[white | p];
        if (sym) blackHtml += `<span class="cap-piece">${sym}</span>`;
    });

    // For the player's view: show their captures below, opponent's above
    if (my_color === white) {
        whiteRow.innerHTML = whiteHtml;
        blackRow.innerHTML = blackHtml;
    } else {
        whiteRow.innerHTML = blackHtml;
        blackRow.innerHTML = whiteHtml;
    }
}

// main draw loop
setInterval(() => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    draw();

    if(can_move)
        handle_drag();

    render_board();
    renderCapturedPieces();
    if(is_holding_piece){
        board[from_position.y][from_position.x] = holding_piece;
        display_possible_moves();
        board[from_position.y][from_position.x] = blank;
    }
}, delta_time);

// Update board square colors from CSS variables (called on theme change)
function updateBoardColors() {
  var root = getComputedStyle(document.documentElement);
  dark_square_color = root.getPropertyValue('--board-dark').trim() || '#4f5969';
  light_square_color = root.getPropertyValue('--board-light').trim() || '#c1c8d4';
  label_color = root.getPropertyValue('--text').trim() || '#eef2f9';
}

window.onresize = () => { recalcLayout(); };

function showPromotionSelector(color) {
    const modal = document.getElementById('promotionModal');
    if (!modal) return;

    const isWhite = color === 0;
    const pieces = [
        { type: 0b0011, symbol: isWhite ? '♕' : '♛' },
        { type: 0b0100, symbol: isWhite ? '♖' : '♜' },
        { type: 0b0110, symbol: isWhite ? '♘' : '♞' },
        { type: 0b0101, symbol: isWhite ? '♗' : '♝' },
    ];

    const container = document.getElementById('promotionChoices');
    container.innerHTML = '';
    pieces.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'promotion-piece';
        btn.textContent = p.symbol;
        btn.onclick = () => {
            socket.emit('promotion:choose', { gameId: matchId, pieceType: p.type });
            modal.style.display = 'none';
        };
        container.appendChild(btn);
    });

    modal.style.display = 'flex';
}