// no en passant, castling, or advance drawing yet
const move_sound = new Audio('/audio/move-self.mp3');
const capture_sound = new Audio('/audio/capture.mp3');
const wrong_move_sound = new Audio('/audio/wrong_move_sound.mp3');

const canvas = document.getElementById("cnv");
const ctx = canvas.getContext('2d');

var dark_square_color = '#4f5969';
var light_square_color = '#c1c8d4';
const move_square_color = '#7af4ae';
const possible_move_color = '#74f551';
const check_square_color = '#ff4444';

const start_fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

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
  // Canvas must fit within vw minus 8px safe margin
  const maxCanvas = Math.min(vw - 8, 480);
  const maxH = vh * 0.7;
  const total = Math.floor(Math.min(maxCanvas, maxH));

  offset_x = 10;
  offset_y = 10;
  side_len = total - offset_x * 2 - 10;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = total * dpr;
  canvas.height = total * dpr;
  canvas.style.maxWidth = (vw - 8) + 'px';
  canvas.style.maxHeight = (vh * 0.7) + 'px';
  ctx.scale(dpr, dpr);
}

const delta_time = 10;

let is_mouse_down = false;
let was_mouse_down = false;
let is_holding_piece = false;
let holding_piece = 0; // the value of the piece held
let mouse_x, mouse_y;
let curr_position;
let from_position = {'x' : 0, 'y' : 0}; // position being dragged from
let to_position= {'x' : 0, 'y' : 0};    // position being dragged to
let old_piece; // value of the piece at the target square originally
let new_piece; // value of the piece being dragged to the square
let is_being_validated = false;
let can_move = false; // to disable dragging when it's not your turn
let my_color = null;  // white or black
let matchId = null;

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
sprites[white | pawn] = '♙';
sprites[white | king] = '♔';
sprites[white | queen] = '♕';
sprites[white | rook] = '♖';
sprites[white | bishop] = '♗';
sprites[white | knight] = '♘';

sprites[black | pawn] = '♟︎';
sprites[black | king] = '♚';
sprites[black | queen] = '♛';
sprites[black | rook] = '♜';
sprites[black | bishop] = '♝';
sprites[black | knight] = '♞';

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

// Draws the pieces and pawns
function render_board() {
    let side_len_square = side_len / no_of_squares;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = Math.floor(side_len_square * 0.75) + 'px sans-serif';
    for (let i = 0; i < no_of_squares; i++) {
        for (let j = 0; j < no_of_squares; j++) {
            ctx.fillStyle = 'black';
            ctx.fillText(
                sprites[board[i][j] & (0b1111)],
                offset_x + j * side_len_square + side_len_square / 2,
                offset_y + i * side_len_square + side_len_square / 2
            );
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

            ctx.fillRect(offset_x + i * side_len_square,
                offset_y + j * side_len_square,
                side_len_square, side_len_square);

            // Click-to-move: selected square highlight
            if (selectedSquare && j === selectedSquare.x && i === selectedSquare.y) {
                ctx.globalAlpha = selected_square_opacity;
                ctx.fillStyle = selected_square_color;
                ctx.fillRect(offset_x + i * side_len_square, offset_y + j * side_len_square, side_len_square, side_len_square);
                ctx.globalAlpha = 1.0;
            }
            // Click-to-move: legal move indicators
            if (legalMoveSquares.has(j + ',' + i)) {
                ctx.globalAlpha = 0.3;
                ctx.fillStyle = possible_move_color;
                ctx.fillRect(offset_x + i * side_len_square, offset_y + j * side_len_square, side_len_square, side_len_square);
                ctx.globalAlpha = 1.0;
            }
        }
    }
    // Display the rank and file numbers and letters

    // write the numbers (1 - 8 ranks)
    ctx.fillStyle = 'black'
    for (let i = 0; i < no_of_squares; i++) {
        ctx.font = '15px sans-serif';
        if (my_color == 0) {
            ctx.fillText(8 - i, offset_x / 3,
                offset_y * 1.3 + side_len_square / 2 + i * side_len_square);
        } else {
            ctx.fillText(1 + i, offset_x / 3,
                offset_y * 1.3 + side_len_square / 2 + i * side_len_square);
        }
    }

    // write the letters (a - h files)
    for (let i = 0; i < no_of_squares; i++) {
        ctx.font = '15px sans-serif';
        if (my_color == 0) {
            ctx.fillText(String.fromCharCode(97 + i),
                offset_x * 0.9 + side_len_square / 2 + i * side_len_square,
                offset_y * 1.1 + side_len + 10);
        } else {
            ctx.fillText(String.fromCharCode(104 - i),
                offset_x * 0.9 + side_len_square / 2 + i * side_len_square,
                offset_y * 1.1 + side_len + 10);
        }
    }
}

function get_box_coords() {
    let x = mouse_x - offset_x;
    let y = mouse_y - offset_y;
    let side_len_square = side_len / no_of_squares;
    let j = Math.floor(x / side_len_square);
    let i = Math.floor(y / side_len_square);
    return [i, j];
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
    let visualBoard = board;
    let pos = Coord(x, y);
    let moves = genLegalMoves(visualBoard, pos, null, lastMove);
    for (let m of moves) {
        legalMoveSquares.add(m.to.x + ',' + m.to.y);
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

    // Capture piece and server-side coords for lastMove tracking
    let visualPiece = board[fromY][fromX];
    let serverFrom, serverTo;
    if (my_color == 0) {
        serverFrom = { x: fromX, y: fromY };
        serverTo = { x: toX, y: toY };
    } else {
        serverFrom = { x: no_of_squares - fromX - 1, y: no_of_squares - fromY - 1 };
        serverTo = { x: no_of_squares - toX - 1, y: no_of_squares - toY - 1 };
    }
    lastMove = { from: serverFrom, to: serverTo, piece: visualPiece };

    if (my_color == 0) {
        socket.emit('move', matchId, {x: fromX, y: fromY}, {x: toX, y: toY});
    } else {
        socket.emit('move', matchId, {
                x: no_of_squares - fromX - 1,
                y: no_of_squares - fromY - 1
            }, {
                x: no_of_squares - toX - 1,
                y: no_of_squares - toY - 1
            });
    }
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

// The most complicated function ever
// Handles drag
function handle_drag() {

    // Dont allow dragging while previous move is being validated
    if(is_being_validated)
        return;

    // get the square on which the mouse is hovering on
    let coords = get_box_coords();
    let i = coords[0], j = coords[1];

    // if mouse got clicked, update the from_position
    // Only process drag actions if mouse actually moved (isDragging flag)
    // Otherwise this eats the click before onmouseup can handle click-to-move
    if (is_mouse_down && !isDragging) {
        // Just update tracking vars, don't touch the board yet
        was_mouse_down = is_mouse_down;
        curr_position = { "x": j, "y": i };
        return;
    }

    if(was_mouse_down == false && is_mouse_down == true){
        if (can_move) {
            from_position.x = curr_position.x;
            from_position.y = curr_position.y;
        }
    }

    // if mouse was released and the player was holding a piece
    if(was_mouse_down == true && is_mouse_down == false && is_holding_piece){
        
        // store the actions, these will be sent to the server
        old_piece = board[i][j];
        new_piece = holding_piece;
        to_position.x = curr_position.x;
        to_position.y = curr_position.y;

        // Detect capture
        if ((old_piece & 0b0111) !== blank) {
            const capturedType = old_piece & 0b0111;
            if (my_color === white) {
                capturedByWhite.push(capturedType);
            } else {
                capturedByBlack.push(capturedType);
            }
        }

        // send movement data to the server
        if (my_color == 0){
            // if(!coordEqual(from_position, to_position))
            socket.emit('move', matchId, from_position, to_position);
        }
        else
            // Black has the board in a different perspective so
            // adjust the coordinates accordingly
            socket.emit('move', matchId, {
                    x : no_of_squares - from_position.x - 1 ,
                    y : no_of_squares - from_position.y - 1 
                },
                {
                    x : no_of_squares - to_position.x - 1 ,
                    y : no_of_squares - to_position.y - 1 
                });
        is_being_validated = true;
    }

    // store current mouse state as the old mouse state
    was_mouse_down = is_mouse_down;

    // update current position
    curr_position = {
        "x": j,
        "y": i
    }

    if (is_mouse_down) {
        if (!is_holding_piece) {
            // if not holding a piece, check if the current square has a piece
            // & (0b1111) is done as other bits maybe used for other purposes
            if ((board[i][j] & 0b1111) === 0) 
                return;
            
            // set the holding piece to whatever is on that square
            is_holding_piece = true;
            holding_piece = board[i][j];
            board[i][j] = 0;
        }
        else {
            // if already holding a piece and the mouse is held down,
            // display the held piece at the mouse
            ctx.fillStyle = 'black';
            ctx.font = Math.floor(side_len / no_of_squares) * 0.8 + 'px sans serif';
            let off_x = Math.floor(side_len / no_of_squares) * 0.3;
            ctx.fillText(sprites[holding_piece], mouse_x - off_x, mouse_y);
        }
    }
    else {
        if (is_holding_piece) {
            // If mouse is up and we are still holding a piece,
            // Drop the piece 
            is_holding_piece = false;
            old_piece = board[i][j];
            board[i][j] = holding_piece;
            holding_piece = 0;
        }
    }
}

// Indicates all the allowed legal moves with green circles
function display_possible_moves(){
    let side_len_square = side_len / no_of_squares;
    let new_board = []
    let new_from_position = Coord(from_position.x, from_position.y);
    
    // if color is black. make a rotated version of the board and coordinates ;
    // else keep it same
    if (my_color == 0)
        new_board = board;
    else {
        for (let i = 0; i < no_of_squares; i++) {
            new_board.push([]);
            for (let j = 0; j < no_of_squares; j++) {
                new_board[i].push(board[no_of_squares - i - 1][no_of_squares - j - 1]);
            }
        }
        new_from_position.x = no_of_squares - new_from_position.x - 1;
        new_from_position.y = no_of_squares - new_from_position.y - 1;
    }

    // Get all the legal moves from the current held piece
    let moves = genLegalMoves(new_board, new_from_position, null, lastMove);
    // console.log(moves);

    // For every legal move draw a green circle indicating that
    for(let m of moves){
        ctx.fillStyle = possible_move_color;
        ctx.font = '15px sans-serif';
        let off_x = offset_x + (side_len_square) / 3;
        let off_y = offset_y * 1.5 + (side_len_square) / 3;
        if(my_color == 0)
            ctx.fillText('⬤', off_x + m.to.x * side_len_square,
        off_y + m.to.y * side_len_square);
        else
        ctx.fillText('⬤', off_x + (no_of_squares - m.to.x - 1) * side_len_square,
        off_y + (no_of_squares - m.to.y - 1) * side_len_square);
            // ⬤
    }
}

window.onload = () => {
    recalcLayout();
    // Only draw the initial board if there's no saved session.
    // If reconnecting, skip draw() here and wait for the 'reconnected' event
    // from the server, which will restore the real board state and call draw().
    const saved = loadSession();
    if (!saved) {
        draw();
        fen_to_board(start_fen);
        render_board();
    }
}

canvas.onmousedown = (e) => {
    is_mouse_down = true;
    const rect = canvas.getBoundingClientRect();
    lastMouseDownPx = {x: e.clientX - rect.left, y: e.clientY - rect.top};
    isDragging = false;
    mouse_x = lastMouseDownPx.x;
    mouse_y = lastMouseDownPx.y;
}
canvas.onmouseup = (e) => {
    is_mouse_down = false;
    if (!isDragging && lastMouseDownPx && can_move) {
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        let coords = get_box_coords();
        let i = coords[0], j = coords[1];
        if (i >= 0 && i < no_of_squares && j >= 0 && j < no_of_squares) {
            executeClickToMove(j, i);
        }
    }
    if (isDragging) {
        clearSelection();
    }
    lastMouseDownPx = null;
}

canvas.ontouchstart = (e) => {
    is_mouse_down = true;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    mouse_x = touch.clientX - rect.left;
    mouse_y = touch.clientY - rect.top;
    lastMouseDownPx = {x: mouse_x, y: mouse_y};
    isDragging = false;
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
    }
    if (isDragging) {
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