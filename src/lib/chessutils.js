import assert from 'assert';

const noOfSquares = 8;

const whiteTurn = 0;
const blackTurn = 1;

export const blank = 0b0000;
export const white = 0b0000;
export const black = 0b1000;

export const pawn = 0b0001;
export const king = 0b0010;
const queen = 0b0011;
const rook = 0b0100;
export const bishop = 0b0101;
export const knight = 0b0110;

function Coord(x, y) {
    let coord = { "x": x, "y": y };
    coordValidate(coord);
    return coord;
}

function Move(from, to){
    return {
        "from" : Coord(from.x, from.y),
        "to" : Coord(to.x, to.y)
    }
}

function coordEqual(a, b) {
    return a.x == b.x && a.y == b.y;
}

export function getPiece(value) {
    // the piece information is stored in the first 3 bits
    return value & (0b111);
}

export function getColor(value) {
    if (value == blank)
        return -1;
    // the 4th bit denotes color
    return value & (0b1000);
}

export function turnToColor(turn) {
    if (turn == whiteTurn)
        return white;
    else
        return black;
}

function colorToTurn(color) {
    if (color == white)
        return whiteTurn;
    else
        return blackTurn;
}

export function chessMakeMove(match, fromCoords, toCoords) {
    let piece = match.boardState[fromCoords.y][fromCoords.x];
    let destPiece = match.boardState[toCoords.y][toCoords.x];
    let isWhitePawn = (getPiece(piece) == pawn && getColor(piece) == white);
    let isBlackPawn = (getPiece(piece) == pawn && getColor(piece) == black);

    match.boardState[toCoords.y][toCoords.x] = piece;
    match.boardState[fromCoords.y][fromCoords.x] = 0;

    // Castling: move the rook
    const dx = toCoords.x - fromCoords.x;
    if (Math.abs(dx) === 2 && (match.boardState[toCoords.y][toCoords.x] & king) === king) {
        if (dx === 2) {
            // King-side: rook from x=7 to x=5
            match.boardState[toCoords.y][5] = match.boardState[toCoords.y][7];
            match.boardState[toCoords.y][7] = 0;
        } else if (dx === -2) {
            // Queen-side: rook from x=0 to x=3
            match.boardState[toCoords.y][3] = match.boardState[toCoords.y][0];
            match.boardState[toCoords.y][0] = 0;
        }
    }

    // Strip castling rights when king or rook moves
    if (match.castlingRights) {
        const moved = match.boardState[toCoords.y][toCoords.x];
        if ((moved & king) === king) {
            // King moved — strip both sides for this color
            if (match.turnState === whiteTurn) {
                match.castlingRights.whiteKingSide = false;
                match.castlingRights.whiteQueenSide = false;
            } else {
                match.castlingRights.blackKingSide = false;
                match.castlingRights.blackQueenSide = false;
            }
        }
        if ((moved & rook) === rook) {
            // Rook moved from starting square
            if (fromCoords.x === 7 && fromCoords.y === 0) match.castlingRights.whiteKingSide = false;
            if (fromCoords.x === 0 && fromCoords.y === 0) match.castlingRights.whiteQueenSide = false;
            if (fromCoords.x === 7 && fromCoords.y === 7) match.castlingRights.blackKingSide = false;
            if (fromCoords.x === 0 && fromCoords.y === 7) match.castlingRights.blackQueenSide = false;
        }
    }

    // En passant capture: pawn moves diagonally to an EMPTY square
    // (normal diagonal capture already handled by moving the pawn above).
    // Remove the captured pawn on the same row as the moving pawn.
    if ((piece & pawn) === pawn && fromCoords.x !== toCoords.x && destPiece === blank) {
        match.boardState[fromCoords.y][toCoords.x] = 0; // remove captured pawn
    }

    // Pawn promotion: mark pending, don't change turn yet
    if (isWhitePawn && toCoords.y == 7) {
        match.pendingPromotion = { from: fromCoords, to: toCoords, color: white };
        return;
    }

    if (isBlackPawn && toCoords.y == 0) {
        match.pendingPromotion = { from: fromCoords, to: toCoords, color: black };
        return;
    }

    match.turnState = 1 - match.turnState;
    match.lastMove = { from: fromCoords, to: toCoords, piece: piece };
};

export function checkLegalMove(board, moveFromCoord, moveToCoord, turnOrMatch){
    let turn, match;
    if (typeof turnOrMatch === 'object' && turnOrMatch !== null && 'castlingRights' in turnOrMatch) {
      match = turnOrMatch;
      turn = match.turnState;
    } else {
      turn = turnOrMatch;
      match = null;
    }
    return chessMoveValidate(board, moveFromCoord, moveToCoord, turn, match)
        && !checkCheck(board, moveFromCoord, moveToCoord, turn)
}

export function chessMoveValidate(board, moveFromCoord, moveToCoord, turn, match) {
    // check if the board is of right size,
    // this shouldn't be wrong as it is not user controlled
    assert.equal(board.length, noOfSquares);
    assert.equal(board[0].length, noOfSquares);

    let valid = true;

    valid = valid && coordValidate(moveFromCoord);
    valid = valid && coordValidate(moveToCoord);
    valid = valid && turnValidate(turn);

    // move to same position not a move
    if (coordEqual(moveFromCoord, moveToCoord)) {
        // console.log("ChessError: move to same position not a move");
        return false;
    }

    if (valid == false) {
        // console.log("ChessError: Invalid board positions");
        return false;
    }
    let piece = getPiece(board[moveFromCoord.y][moveFromCoord.x]);

    // if player moved a blank square its invalid
    if (piece == blank) {
        // console.log("2");
        return false;
    }
    if (turn == 0 && getColor(board[moveFromCoord.y][moveFromCoord.x]) != white)
        return false;
    if (turn == 1 && getColor(board[moveFromCoord.y][moveFromCoord.x]) != black)
        return false;

    // check if the piece can even move it to that spot
    // in a non-blocking board
    switch (piece) {
        case pawn: valid = valid && pawnMoveValidate(board,
            moveFromCoord, moveToCoord, turn);
            break;
        case knight: valid = valid && knightMoveValidate(board,
            moveFromCoord, moveToCoord, turn);
            break;
        case bishop: valid = valid && bishopMoveValidate(board,
            moveFromCoord, moveToCoord, turn);
            break;
        case rook: valid = valid && rookMoveValidate(board,
            moveFromCoord, moveToCoord, turn);
            break;
        case queen: valid = valid && queenMoveValidate(board,
            moveFromCoord, moveToCoord, turn);
            break;
        case king: valid = valid && kingMoveValidate(board,
            moveFromCoord, moveToCoord, turn, match);
            break;
        default: valid = false;
            // console.log("ChessError: not a piece");
            break;
    }
    // console.log('Validator: Reached the end of validator::' + valid);
    return valid;
}

function checkCheck(board, moveFromCoord, moveToCoord, turn){
    let newBoard = board.map((arr)=>{return arr.slice();});
    newBoard[moveToCoord.y][moveToCoord.x] = newBoard[moveFromCoord.y][moveFromCoord.x];
    newBoard[moveFromCoord.y][moveFromCoord.x] = blank;
    let currColor = turnToColor(turn);
    let kingPos = Coord(0, 0);
    for(let i = 0; i < noOfSquares; i++){
        for(let j =0; j < noOfSquares; j++){
            if(newBoard[j][i] == (king | currColor)){
                kingPos.x = i;
                kingPos.y = j;
                break;
            }
        }
    }
    let moves = genAllMoves(newBoard, (black - currColor));
    for (let m of moves){
        if(coordEqual(m.to, kingPos)){
            return true;
        }
    }
    return false;
}

function coordValidate(coord) {
    if (coord.x == undefined)
        return false;
    if (coord.y == undefined)
        return false;
    if (coord.x < 0 || coord.x >= noOfSquares)
        return false;
    if (coord.y < 0 || coord.y >= noOfSquares)
        return false;
    return true;
}

function turnValidate(turn) {
    // im not dumb just for clarity sake
    if (turn == whiteTurn || turn == blackTurn)
        return true;
    return false;
}

function validBoard(board){
    return board.length == noOfSquares && board[0].length == noOfSquares;
}

function pawnMoveValidate(board, moveFromCoord, moveToCoord, turn) {
    if (turn == whiteTurn)
        return whitePawnMoveValidate(board, moveFromCoord, moveToCoord);
    else
        return blackPawnMoveValidate(board, moveFromCoord, moveToCoord);

}

function whitePawnMoveValidate(board, moveFromCoord, moveToCoord) {

    let destValue = board[moveToCoord.y][moveToCoord.x];

    // cannot capture own pieces
    if (getColor(destValue) == white) {
        // console.log("Chess Error: Capturing your own pieces");
        return false;
    }

    let differenceX = Math.abs(moveToCoord.x - moveFromCoord.x);
    if (differenceX > 1)
        return false;

    if (getColor(destValue) == -1 && moveFromCoord.y == 6 && differenceX == 0 && moveToCoord.y == 4) {
        // pawns can move two moves ahead at the start
        return true;
    }
    // only one step ahead at atime and in only one direction
    if (moveFromCoord.y - 1 != moveToCoord.y) {
        // console.log('Chess Error: Too much ahead')
        return false;
    }
    // cannot capture own pieces
    if (getColor(destValue) == black && differenceX == 0) {
        // console.log("Chess Error: pawns cannot capture pieces infront");
        return false;
    }

    // can move diagonally only during captures
    if (differenceX == 1 && destValue == blank) {
        // En passant: check if adjacent enemy pawn moved 2 squares
        if (moveToCoord.y == moveFromCoord.y - 1 && getPiece(board[moveFromCoord.y][moveToCoord.x]) == pawn && getColor(board[moveFromCoord.y][moveToCoord.x]) == black) {
          return true;
        }
        // console.log('Chess Error: cant move diagonally without enemy');
        return false;
    }

    return true;
}

function blackPawnMoveValidate(board, moveFromCoord, moveToCoord) {
    let destValue = board[moveToCoord.y][moveToCoord.x];

    // cannot capture own pieces
    if (getColor(destValue) == black) {
        // console.log("Chess Error: Capturing your own pieces");
        return false;
    }


    let differenceX = Math.abs(moveToCoord.x - moveFromCoord.x);
    if (differenceX > 1)
        return false;


    if (getColor(destValue) == -1 && moveFromCoord.y == 1 && differenceX == 0 && moveToCoord.y == 3) {
        // pawns can move two moves ahead at the start
        return true;
    }

    // only one step ahead at atime and in only one direction
    if (moveFromCoord.y + 1 != moveToCoord.y)
        return false;

    // cannot capture own pieces
    if (getColor(destValue) == white && differenceX == 0) {
        // console.log("Chess Error: pawns cannot capture pieces infront");
        return false;
    }

    // can move diagonally only during captures
    if (differenceX == 1 && destValue == blank) {
        // En passant: check if adjacent enemy pawn moved 2 squares
        if (moveToCoord.y == moveFromCoord.y + 1 && getPiece(board[moveFromCoord.y][moveToCoord.x]) == pawn && getColor(board[moveFromCoord.y][moveToCoord.x]) == white) {
          return true;
        }
        return false;
    }

    return true;
}

function knightMoveValidate(board, moveFromCoord, moveToCoord, turn) {
    let destValue = board[moveToCoord.y][moveToCoord.x];

    // cannot capture own pieces
    if (getColor(destValue) == turnToColor(turn))
        return false;

    let differenceX = Math.abs(moveToCoord.x - moveFromCoord.x);
    let differenceY = Math.abs(moveToCoord.y - moveFromCoord.y);

    if (differenceX == 2 && differenceY == 1)
        return true;
    if (differenceX == 1 && differenceY == 2)
        return true;

    return false;
}

function bishopMoveValidate(board, moveFromCoord, moveToCoord, turn) {
    // console.log("Validator: Validating Bishop move...");
    let destValue = board[moveToCoord.y][moveToCoord.x];

    // cannot capture own pieces
    if (getColor(destValue) == turnToColor(turn)) {
        // console.log("Chess Error: Capturing own pieces");
        return false;
    }

    let differenceX = Math.abs(moveToCoord.x - moveFromCoord.x);
    let differenceY = Math.abs(moveToCoord.y - moveFromCoord.y);
    let directionX = Math.sign(moveToCoord.x - moveFromCoord.x);
    let directionY = Math.sign(moveToCoord.y - moveFromCoord.y);
    if (differenceX != differenceY) {
        // console.log("ChessError: bishop can only move in diagonal");
        return false;
    }
    let currCoord = Coord(moveFromCoord.x, moveFromCoord.y);
    // // console.log(currCoord);

    // go in the direction one step
    currCoord.x += 1 * directionX;
    currCoord.y += 1 * directionY;
    // // console.log(currCoord);

    let valid = false;
    // go in the direction and check if its all clear
    while (coordValidate(currCoord) && !coordEqual(currCoord, moveToCoord)) {
        if (board[currCoord.y][currCoord.x] != blank)
            break;
        currCoord.x += 1 * directionX;
        currCoord.y += 1 * directionY;
    }
    // // console.log(currCoord);
    // // console.log(moveToCoord);
    if (coordEqual(currCoord, moveToCoord))
        valid = true;
    // console.log('Bishop validator::' + valid);
    return valid;
}

function rookMoveValidate(board, moveFromCoord, moveToCoord, turn) {
    let destValue = board[moveToCoord.y][moveToCoord.x];

    // cannot capture own pieces
    if (getColor(destValue) == turnToColor(turn)) {
        // console.log("Chess Error: Capturing own pieces");
        return false;
    }

    let differenceX = Math.abs(moveToCoord.x - moveFromCoord.x);
    let differenceY = Math.abs(moveToCoord.y - moveFromCoord.y);
    let directionX = Math.sign(moveToCoord.x - moveFromCoord.x);
    let directionY = Math.sign(moveToCoord.y - moveFromCoord.y);

    if (differenceY != 0 && differenceX != 0) {
        return false;
    }

    let currCoord = Coord(moveFromCoord.x, moveFromCoord.y);
    // console.log(currCoord);

    // go in the direction one step
    currCoord.x += 1 * directionX;
    currCoord.y += 1 * directionY;
    // console.log(currCoord);

    let valid = false;
    // go in the direction and check if its all clear
    while (coordValidate(currCoord) && !coordEqual(currCoord, moveToCoord)) {
        if (board[currCoord.y][currCoord.x] != blank)
            break;
        currCoord.x += 1 * directionX;
        currCoord.y += 1 * directionY;
    }
    // console.log(currCoord);

    if (coordEqual(currCoord, moveToCoord)) {
        // console.log('Can reach this square');
        valid = true;
    }
    return valid;
}

function queenMoveValidate(board, moveFromCoord, moveToCoord, turn) {
    return bishopMoveValidate(board, moveFromCoord, moveToCoord, turn)
        || rookMoveValidate(board, moveFromCoord, moveToCoord, turn);
}

function kingMoveValidate(board, moveFromCoord, moveToCoord, turn, match) {
    let destValue = board[moveToCoord.y][moveToCoord.x];

    // Castling: king moves 2 squares horizontally on the same row
    if (Math.abs(moveToCoord.x - moveFromCoord.x) === 2 && moveToCoord.y === moveFromCoord.y && match) {
        const kingRow = turn === whiteTurn ? 0 : 7;
        if (moveFromCoord.y !== kingRow || moveFromCoord.x !== 4) return false;
        if (isKingInCheck(board, turn)) return false;

        const rights = match.castlingRights;
        const dx = moveToCoord.x - moveFromCoord.x;
        if (turn === whiteTurn) {
            if (dx === 2 && !rights.whiteKingSide) return false;
            if (dx === -2 && !rights.whiteQueenSide) return false;
        } else {
            if (dx === 2 && !rights.blackKingSide) return false;
            if (dx === -2 && !rights.blackQueenSide) return false;
        }

        // Path must be clear
        if (dx === 2) {
            if (board[kingRow][6] !== blank || board[kingRow][7] !== blank) return false;
            if ((board[kingRow][7] & 0b0111) !== rook) return false;
        } else {
            if (board[kingRow][1] !== blank || board[kingRow][2] !== blank || board[kingRow][3] !== blank) return false;
            if ((board[kingRow][0] & 0b0111) !== rook) return false;
        }

        // King must not pass through check (simulate intermediate position)
        const simBoard = board.map(r => [...r]);
        simBoard[moveFromCoord.y][moveFromCoord.x] = blank;
        const midX = moveFromCoord.x + (dx > 0 ? 1 : -1);
        simBoard[moveFromCoord.y][midX] = board[moveFromCoord.y][moveFromCoord.x];
        if (isKingInCheck(simBoard, turn)) return false;

        return true;
    }

    // cannot capture own pieces
    if (getColor(destValue) == turnToColor(turn))
        return false;

    let differenceX = Math.abs(moveToCoord.x - moveFromCoord.x);
    let differenceY = Math.abs(moveToCoord.y - moveFromCoord.y);

    if (differenceX <= 1 && differenceY <= 1)
        return true;
    return false;
}

function genMoves(board, position){
    // if(!validBoard(board))
    //     return [];
    let moves = [];
    let value = board[position.y][position.x];
    // console.log(getColor(value));
    for(let i = 0; i < noOfSquares; i++){
        for(let j = 0; j < noOfSquares; j++){
            let to = Coord(i, j);
            if(chessMoveValidate(board, position, to, colorToTurn(getColor(value)))){
                moves.push(Move(position, to));
            }
        }
    }
    return moves;
}

function genAllMoves(board, color){
    // if(!validBoard(board))
    //     return [];
    let moves = [];
    for(let i = 0; i < noOfSquares; i++){
        for(let j = 0; j < noOfSquares; j++){
            let pos = Coord(i, j);
            if(getColor(board[j][i]) == color){
                for (let k of genMoves(board, pos)){
                    moves.push(k);
                }
            }
        }
    }
    return moves;
}

function genLegalMoves(board, position){
    // if(!validBoard(board))
    //     return [];
    let moves = [];
    let value = board[position.y][position.x];
    // console.log(getColor(value));
    for(let i = 0; i < noOfSquares; i++){
        for(let j = 0; j < noOfSquares; j++){
            let to = Coord(i, j);
            if(checkLegalMove(board, position, to, colorToTurn(getColor(value)))){
                moves.push(Move(position, to));
            }
        }
    }
    return moves;
}

function genAllLegalMoves(board, color){
    // if(!validBoard(board))
    //     return [];
    let moves = [];
    for(let i = 0; i < noOfSquares; i++){
        for(let j = 0; j < noOfSquares; j++){
            let pos = Coord(i, j);
            if(getColor(board[j][i]) == color){
                for (let k of genLegalMoves(board, pos)){
                    moves.push(k);
                }
            }
        }
    }
    return moves;
}

// Check if the king is currently in check on the given board for the given turn
export function isKingInCheck(board, turn) {
    let currColor = turnToColor(turn);
    let kingPos = Coord(0, 0);
    for (let i = 0; i < noOfSquares; i++) {
        for (let j = 0; j < noOfSquares; j++) {
            if (board[j][i] == (king | currColor)) {
                kingPos.x = i;
                kingPos.y = j;
                break;
            }
        }
    }
    let enemyColor = black - currColor;
    let moves = genAllMoves(board, enemyColor);
    for (let m of moves) {
        if (coordEqual(m.to, kingPos)) {
            return true;
        }
    }
    return false;
}

// Returns 'checkmate', 'stalemate', or null (game continues)
export function isGameEndReason(board, turn) {
    let color = turnToColor(turn);
    let legal = genAllLegalMoves(board, color);
    if (legal.length > 0) return null;

    if (isKingInCheck(board, turn)) return 'checkmate';
    return 'stalemate';
}

// no more legal moves for whose turn it is 
export function checkMateCheck(board, turn){
    return isGameEndReason(board, turn) == 'checkmate';
}

export function checkThreefoldDraw(match) {
  const history = match.moveHistory;
  if (history.length < 2) return { draw: false, isWarning: false };

  // Build complete round pairs: (move[i], move[i+1]) stepping by 2
  const pairCount = {};
  for (let i = 0; i + 1 < history.length; i += 2) {
    const a = history[i], b = history[i + 1];
    const key = `${a.from.x},${a.from.y}-${a.to.x},${a.to.y}|${b.from.x},${b.from.y}-${b.to.x},${b.to.y}`;
    pairCount[key] = (pairCount[key] || 0) + 1;
  }

  // Draw: any round pattern appeared 3+ times
  for (const key of Object.keys(pairCount)) {
    if (pairCount[key] >= 3) {
      return { draw: true, isWarning: false };
    }
  }

  // Warning: incomplete round — last move matches the first half of a 2-count pattern
  if (history.length % 2 === 1) {
    const last = history[history.length - 1];
    for (const key of Object.keys(pairCount)) {
      if (pairCount[key] !== 2) continue;
      const parts = key.split('|')[0];
      const firstHalf = `${last.from.x},${last.from.y}-${last.to.x},${last.to.y}`;
      if (firstHalf === parts) {
        const parts2 = key.split('|');
        const desc = `⚠️ The same pair of moves has been repeated twice: ${parts2[0]}, then ${parts2[1]}. One more time and it's a draw.`;
        return { draw: false, isWarning: true, patternDescription: desc };
      }
    }
  }

  return { draw: false, isWarning: false };
}

export function isInsufficientMaterial(board) {
  const whitePieces = [];
  const blackPieces = [];

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const piece = board[y][x];
      if (piece === blank) continue;
      const color = getColor(piece);
      const type = getPiece(piece);
      if (color === white) whitePieces.push({ type, x, y });
      if (color === black) blackPieces.push({ type, x, y });
    }
  }

  // Remove kings from lists
  const wNonKing = whitePieces.filter(p => p.type !== king);
  const bNonKing = blackPieces.filter(p => p.type !== king);

  const wCount = wNonKing.length;
  const bCount = bNonKing.length;

  // K vs K
  if (wCount === 0 && bCount === 0) return true;

  // K+B vs K or K vs K+B
  if (wCount === 1 && bCount === 0 && wNonKing[0].type === bishop) return true;
  if (wCount === 0 && bCount === 1 && bNonKing[0].type === bishop) return true;

  // K+N vs K or K vs K+N
  if (wCount === 1 && bCount === 0 && wNonKing[0].type === knight) return true;
  if (wCount === 0 && bCount === 1 && bNonKing[0].type === knight) return true;

  // K+B vs K+B same color
  if (wCount === 1 && bCount === 1 && wNonKing[0].type === bishop && bNonKing[0].type === bishop) {
    const wbColor = (wNonKing[0].x + wNonKing[0].y) % 2;
    const bbColor = (bNonKing[0].x + bNonKing[0].y) % 2;
    if (wbColor === bbColor) return true;
  }

  return false;
}

export function isFiftyMoveRule(board, halfMoveClock) {
  return halfMoveClock >= 100;
}


