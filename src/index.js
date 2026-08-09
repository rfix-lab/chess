import { fileURLToPath } from 'url';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { chessMakeMove, checkLegalMove, isGameEndReason, isKingInCheck, turnToColor, king, white, black, pawn, checkThreefoldDraw, isInsufficientMaterial, isFiftyMoveRule, getPiece, blank } from './lib/chessutils.js';
import { matches, findMatch, initMatch, findPrivateMatch } from './lib/matchmaking.js';
import { authenticateUser, signupUser } from './lib/auth.js';

// Rate limiting: prevent clients from spamming socket events
const rateLimits = new Map(); // socketId -> { move: 0, challenge: 0, takeback: 0, lastReset: timestamp }

function isRateLimited(socket, event, windowMs, maxCount) {
  const now = Date.now();
  if (!rateLimits.has(socket.id)) {
    rateLimits.set(socket.id, { [event]: 1, lastReset: now });
    return false;
  }
  const limits = rateLimits.get(socket.id);
  if (now - limits.lastReset > windowMs) {
    limits[event] = 1;
    limits.lastReset = now;
    return false;
  }
  limits[event] = (limits[event] || 0) + 1;
  return limits[event] > maxCount;
}

// express server
const PORT = process.env.PORT || 5500;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

/*
user database, convert this to an actual database
user: { username, password, sessions }
sessions = [<session>]

session:
  id: sessionID,
  expires: expirationDate
*/
let users = [];

// set up express settings, use ejs for templating
app.use(express.static(path.dirname(__filename) + '/public'));
app.set('view engine', 'ejs');
app.set('views', path.dirname(__filename) + '/views');

// routes
app.get('/', (req, res) => {
  res.redirect('/index');
});

app.get('/index', (req, res) => {
  res.render('index');
});

app.get('/game', (req, res) => {
  let matchId = req.query.matchId;
  res.render('game', {
    matchId: matchId ?? ""
  });
});

// socket.io server
io.on('connection', socket => {
  // this route validates a move sent by a player
  socket.on('move', (matchId, fromCoords, toCoords) => {
    const match = matches[matchId];

    // Rate limit: max 10 moves per second
    if (isRateLimited(socket, 'move', 1000, 10)) {
      return;
    }
    if (!match || !match.player1Socket || !match.player2Socket || match.gameEnded) return;

    // Validate coordinates
    if (!fromCoords || !toCoords || typeof fromCoords.x !== 'number' || typeof fromCoords.y !== 'number' ||
        typeof toCoords.x !== 'number' || typeof toCoords.y !== 'number') {
      return socket.emit('invalidMove', { reason: 'invalid coordinates' });
    }

    // authenticating move
    let valid = checkLegalMove(
      match.boardState,
      fromCoords, toCoords,
      match
    );

    // Reject if not the current player's turn or move is illegal
    if (!valid) {
      // Send current board back with a rejection flag
      const currentBoard = match.boardState.map((arr) => { return arr.slice(); });
      match.player1Socket.emit('validated', currentBoard, match.turnState, { rejected: true });
      match.player2Socket.emit('validated', currentBoard, match.turnState, { rejected: true });
      return;
    }

    // Save state snapshot before move for takeback (only for valid moves)
    const snapshot = {
      board: match.boardState.map(arr => arr.slice()),
      turnState: match.turnState,
      castlingRights: Object.assign({}, match.castlingRights),
      lastMove: match.lastMove,
      halfMoveClock: match.halfMoveClock,
      pendingPromotion: match.pendingPromotion
    };
    match.stateHistory.push(snapshot);

    let sentBoard = match.boardState.map((arr) => { return arr.slice(); });
    const piece = match.boardState[fromCoords.y][fromCoords.x];
    const destPiece = match.boardState[toCoords.y][toCoords.x];
    const isPawn = getPiece(piece) === pawn;
    const isCapture = destPiece !== blank;
    const isEnPassant = isPawn && toCoords.x !== fromCoords.x && destPiece === blank;

    chessMakeMove(match, fromCoords, toCoords);

    // Update halfMoveClock
    if (isPawn || isCapture || isEnPassant) {
      match.halfMoveClock = 0;
    } else {
      match.halfMoveClock++;
    }

    // Record move in history (before turnState flip)
    const turnBefore = 1 - match.turnState;
    match.moveHistory.push({ from: fromCoords, to: toCoords, turn: turnBefore });

    // If pawn reached promotion square, wait for piece choice
    if (match.pendingPromotion) {
      sentBoard = match.boardState.map((arr) => { return arr.slice(); });
      const promoColor = match.pendingPromotion.color;
      match.player1Socket.emit('validated', sentBoard, match.turnState, { pendingPromotion: true, promotionColor: promoColor });
      match.player2Socket.emit('validated', sentBoard, match.turnState, { pendingPromotion: true, promotionColor: promoColor });
      return;
    }

    sentBoard = match.boardState.map((arr) => { return arr.slice(); });
    sentBoard[fromCoords.y][fromCoords.x] |= 0b10000; // move indicators
    sentBoard[toCoords.y][toCoords.x] |= 0b10000;

    // En passant: highlight the target square next to a pawn that just moved 2 squares
    const movedPiece = match.boardState[toCoords.y][toCoords.x];
    if (movedPiece === (white | pawn) && fromCoords.y === 6 && toCoords.y === 4) {
      sentBoard[4][fromCoords.x] |= 0b1000000;
    }
    if (movedPiece === (black | pawn) && fromCoords.y === 1 && toCoords.y === 3) {
      sentBoard[3][fromCoords.x] |= 0b1000000;
    }

    // Check indicator: highlight king if in check
    const nextColor = turnToColor(match.turnState);
    if (isKingInCheck(match.boardState, match.turnState)) {
      for (let ki = 0; ki < 8; ki++) {
        for (let kj = 0; kj < 8; kj++) {
          if (match.boardState[ki][kj] === (king | nextColor)) {
            sentBoard[ki][kj] |= 0b100000;
          }
        }
      }
    }

    match.player1Socket.emit('validated', sentBoard, match.turnState);
    match.player2Socket.emit('validated', sentBoard, match.turnState);

    // Check threefold repetition
    const threefold = checkThreefoldDraw(match);
    if (threefold.draw) {
      match.player1Socket.emit('draw', { reason: 'threefold' });
      match.player2Socket.emit('draw', { reason: 'threefold' });
      return;
    }
    if (threefold.isWarning) {
      match.player1Socket.emit('repetitionWarning', { patternDescription: threefold.patternDescription });
      match.player2Socket.emit('repetitionWarning', { patternDescription: threefold.patternDescription });
    }

    // Check insufficient material
    if (isInsufficientMaterial(match.boardState)) {
      match.player1Socket.emit('draw', { reason: 'insufficient' });
      match.player2Socket.emit('draw', { reason: 'insufficient' });
      return;
    }

    // Check 50-move rule
    if (isFiftyMoveRule(match.boardState, match.halfMoveClock)) {
      match.player1Socket.emit('draw', { reason: 'fifty' });
      match.player2Socket.emit('draw', { reason: 'fifty' });
      return;
    }
    const endReason = isGameEndReason(match.boardState, match.turnState);
    if (endReason === 'checkmate') {
      match.player1Socket.emit('checkMate', match.turnState);
      match.player2Socket.emit('checkMate', match.turnState);
    } else if (endReason === 'stalemate') {
      match.player1Socket.emit('stalemate');
      match.player2Socket.emit('stalemate');
    }
  });

  // this route signs in a user
  socket.on('signin', ({ username, password }) => {
    let [r, sessionID] = authenticateUser(users, username, password);
    socket.emit('signin', r, sessionID);
  });

  // this route signs up a user
  socket.on('signup', ({ username, password }) => {
    // console.log(`User[${socket.id}]: signup with [${username}, ${password}]`);

    let r = signupUser(users, username, password);
    socket.emit('signup', r);
  });

  // this route authenticates a user with a sessionID
  socket.on('auth', (sessionID, matchId) => {
    if (matchId === null) {
      // regular match making
      findMatch(socket);
    } else {
      findPrivateMatch(socket, matchId); // if func returns 0, no private match exists with that matchID (invalid link)
    }
    // use sessionID to identify the user
    // if sessionID is undefined, then the user plays as a guest
  });

  // reconnect: player reloads page and wants to rejoin their game with the same color
  socket.on('reconnect', ({ gameId, color, sessionID }) => {
    const match = matches.find(m => m.matchId === gameId);
    if (!match) {
      socket.emit('gameNotFound');
      return;
    }

    // Game already finished — check if board has checkmate/stalemate for current turn
    const endReason = isGameEndReason(match.boardState, match.turnState);
    if (endReason) {
      socket.emit('gameNotFound');
      return;
    }

    const playerSocket = color === 0 ? match.player1Socket : match.player2Socket;

    // If current socket is the same (reconnect to self), that's fine
    // If someone else has this socket slot already → reject (double connect)
    if (playerSocket && playerSocket !== socket) {
      // Another socket already occupies this color slot — reject
      socket.emit('gameNotFound');
      return;
    }

    // Replace the socket (old one disconnected or same)
    if (color === 0) {
      match.player1Socket = socket;
    } else {
      match.player2Socket = socket;
    }

    // Cancel forfeit timer if reconnecting
    if (match.disconnectTimers && match.disconnectTimers[socket.id]) {
      clearTimeout(match.disconnectTimers[socket.id]);
      delete match.disconnectTimers[socket.id];
    }

    // Deep-copy board state to avoid move indicator bits
    const cleanBoard = match.boardState.map((arr) => arr.slice().map((v) => v & 0b01111));

    // Add check indicator if applicable
    const reconnectedColor = color === 0 ? 0 : 1;
    if (isKingInCheck(match.boardState, reconnectedColor)) {
      const kingColor = turnToColor(reconnectedColor);
      for (let ki = 0; ki < 8; ki++) {
        for (let kj = 0; kj < 8; kj++) {
          if (match.boardState[ki][kj] === (king | kingColor)) {
            cleanBoard[ki][kj] |= 0b100000;
          }
        }
      }
    }

    socket.emit('reconnected', color, gameId, cleanBoard, match.turnState);
  });

  // this route generates a private match on demand
  socket.on('private-match', arg => {
    // generate link here and init new match
    let maxMatchId = -1;
    for(let match of matches) {
      if (match.matchId > maxMatchId) {
        maxMatchId = match.matchId;
      }
    }

    let privateMatch = initMatch(maxMatchId + 1, null);
    privateMatch.private = true;

    matches.push(privateMatch);

    socket.emit('private-match', privateMatch.matchId);
  });

  // Handle promotion piece selection
  socket.on('promotion:choose', (data) => {
    const match = matches.find(m => m.matchId === data.gameId);
    if (!match || !match.pendingPromotion) return;

    const { from, to, color } = match.pendingPromotion;
    const pieceType = data.pieceType;

    match.boardState[to.y][to.x] = color | pieceType;
    match.pendingPromotion = null;
    match.turnState = 1 - match.turnState;

    // Record the original pawn move in history (turn before flip)
    // moveHistory already recorded in the 'move' handler (line ~103).
    // Do NOT push here again — that was causing duplicate entries for promotion moves.

    const board = match.boardState.map((arr) => { return arr.slice(); });
    // En passant indicator after promotion (pawn moved 2 squares before promotion)
    const promotedPiece = match.boardState[to.y][to.x];
    if (promotedPiece === (white | pieceType) && from.y === 6 && to.y === 7) {
      board[4][from.x] |= 0b1000000;
    }
    if (promotedPiece === (black | pieceType) && from.y === 1 && to.y === 0) {
      board[3][from.x] |= 0b1000000;
    }
    // Check indicator: highlight king if in check
    const nextColor2 = turnToColor(match.turnState);
    if (isKingInCheck(match.boardState, match.turnState)) {
      for (let ki = 0; ki < 8; ki++) {
        for (let kj = 0; kj < 8; kj++) {
          if (match.boardState[ki][kj] === (king | nextColor2)) {
            board[ki][kj] |= 0b100000;
          }
        }
      }
    }
    const opponent = match.player1Socket.id === socket.id ? match.player2Socket : match.player1Socket;

    socket.emit('validated', board, match.turnState);
    if (opponent) opponent.emit('validated', board, match.turnState);

    // Check threefold repetition
    const threefold = checkThreefoldDraw(match);
    if (threefold.draw) {
      socket.emit('draw', { reason: 'threefold' });
      if (opponent) opponent.emit('draw', { reason: 'threefold' });
      return;
    }
    if (threefold.isWarning) {
      socket.emit('repetitionWarning', { patternDescription: threefold.patternDescription });
      if (opponent) opponent.emit('repetitionWarning', { patternDescription: threefold.patternDescription });
    }

    // Check insufficient material
    if (isInsufficientMaterial(match.boardState)) {
      socket.emit('draw', { reason: 'insufficient' });
      if (opponent) opponent.emit('draw', { reason: 'insufficient' });
      return;
    }

    // Check 50-move rule
    if (isFiftyMoveRule(match.boardState, match.halfMoveClock)) {
      socket.emit('draw', { reason: 'fifty' });
      if (opponent) opponent.emit('draw', { reason: 'fifty' });
      return;
    }

    const endReason = isGameEndReason(match.boardState, match.turnState);
    if (endReason === 'checkmate') {
      socket.emit('checkMate', match.turnState);
      if (opponent) opponent.emit('checkMate', match.turnState);
    } else if (endReason === 'stalemate') {
      socket.emit('stalemate');
      if (opponent) opponent.emit('stalemate');
    }
  });

  // Draw offer
  socket.on('drawOffer', (matchId) => {
    const match = matches.find(m => m.matchId === matchId);
    if (!match || match.gameEnded) return;

    // Check if already offered and declined in this game
    if (match.drawOffered === 'declined') return;

    const playerColor = match.player1Socket.id === socket.id ? 0 : 1;
    match.drawOffered = 'pending';

    // Send offer to opponent
    const opponent = match.player1Socket.id === socket.id ? match.player2Socket : match.player1Socket;
    if (opponent) {
      opponent.emit('drawOfferReceived', { from: playerColor });
    }
  });

  // Draw response (accept or decline)
  socket.on('drawResponse', (matchId, accepted) => {
    const match = matches.find(m => m.matchId === matchId);
    if (!match || !match.drawOffered || match.drawOffered === 'declined') return;

    if (accepted) {
      match.gameEnded = true;
      match.drawOffered = null;
      match.player1Socket.emit('gameEnd', { result: 'draw', reason: 'agreement' });
      match.player2Socket.emit('gameEnd', { result: 'draw', reason: 'agreement' });
    } else {
      match.drawOffered = 'declined';
      const offererColor = match.player1Socket.id !== socket.id ? 0 : 1;
      // Notify the offerer that their offer was declined
      const offerer = match.player1Socket.id === offererColor ? match.player1Socket : match.player2Socket;
      if (offerer) offerer.emit('drawDeclined', {});
    }
  });

  // Resign
  socket.on('resign', (matchId) => {
    const match = matches.find(m => m.matchId === matchId);
    if (!match || match.gameEnded) return;

    match.gameEnded = true;
    const resignedColor = match.player1Socket.id === socket.id ? 0 : 1;
    match.player1Socket.emit('resignReceived', { resigned: resignedColor });
    match.player2Socket.emit('resignReceived', { resigned: resignedColor });
  });

  // Challenge to resign
  socket.on('challenge', (matchId) => {
    const match = matches.find(m => m.matchId === matchId);

    // Rate limit: max 3 challenges per 10 seconds
    if (isRateLimited(socket, 'challenge', 10000, 3)) {
      return;
    }
    if (!match || match.gameEnded) return;

    if (match.challengeFrom === 'declined') return;

    const playerColor = match.player1Socket.id === socket.id ? 0 : 1;
    match.challengeFrom = 'pending';

    const opponent = match.player1Socket.id === socket.id ? match.player2Socket : match.player1Socket;
    if (opponent) {
      opponent.emit('challengeReceived', { from: playerColor });
    }
  });

  // Challenge response
  socket.on('challengeResponse', (matchId, accepted) => {
    const match = matches.find(m => m.matchId === matchId);
    if (!match || !match.challengeFrom || match.challengeFrom === 'declined') return;

    if (accepted) {
      match.gameEnded = true;
      match.challengeFrom = null;
      const challengedColor = match.player1Socket.id === socket.id ? 0 : 1;
      match.player1Socket.emit('resignReceived', { resigned: challengedColor });
      match.player2Socket.emit('resignReceived', { resigned: challengedColor });
    } else {
      match.challengeFrom = 'declined';
      const challengerColor = match.player1Socket.id !== socket.id ? 0 : 1;
      const challenger = match.player1Socket.id === challengerColor ? match.player1Socket : match.player2Socket;
      if (challenger) challenger.emit('challengeDeclined', {});
    }
  });

  // Takeback request
  socket.on('takebackRequest', (matchId) => {
    const match = matches.find(m => m.matchId === matchId);

    // Rate limit: max 5 takeback requests per 10 seconds
    if (isRateLimited(socket, 'takeback', 10000, 5)) {
      return;
    }
    if (!match || match.gameEnded) return;
    if (match.stateHistory.length === 0) return;

    // Only the player whose turn it is can request takeback
    const requesterColor = match.player1Socket.id === socket.id ? 0 : 1;
    if (requesterColor !== match.turnState) {
      socket.emit('takebackError', 'Not your turn to request takeback');
      return;
    }

    // Check if already declined once
    if (match.takebackOffered === 'declined') {
      socket.emit('takebackError', 'Takeback already declined');
      return;
    }

    match.takebackOffered = 'pending';

    const opponent = match.player1Socket.id === socket.id ? match.player2Socket : match.player1Socket;
    if (opponent) {
      opponent.emit('takebackOfferReceived', { from: requesterColor });
    }
  });

  // Takeback response (accept or decline)
  socket.on('takebackResponse', (matchId, accepted) => {
    const match = matches.find(m => m.matchId === matchId);
    if (!match || !match.takebackOffered || match.takebackOffered === 'declined') return;

    if (accepted) {
      // Restore previous state
      const prev = match.stateHistory.pop();
      if (prev) {
        match.boardState = prev.board;
        match.turnState = prev.turnState;
        match.castlingRights = prev.castlingRights;
        match.lastMove = prev.lastMove;
        match.halfMoveClock = prev.halfMoveClock;
        match.pendingPromotion = prev.pendingPromotion;

        // Also pop moveHistory entry
        if (match.moveHistory.length > 0) {
          match.moveHistory.pop();
        }

        // Send updated board to both players
        const cleanBoard = match.boardState.map(arr => arr.slice());
        match.player1Socket.emit('takebackAccepted', cleanBoard, match.turnState);
        match.player2Socket.emit('takebackAccepted', cleanBoard, match.turnState);
      }
      match.takebackOffered = null;
    } else {
      match.takebackOffered = 'declined';
      // Notify the requester
      const requesterColor = match.player1Socket.id !== socket.id ? 0 : 1;
      const requester = match.player1Socket.id === requesterColor ? match.player1Socket : match.player2Socket;
      if (requester) requester.emit('takebackDeclined', {});
    }
  });

  // this route is fired when a socket disconnects
  socket.on('disconnect', () => {
    const match = matches.find(m => m.player1Socket?.id === socket.id || m.player2Socket?.id === socket.id);
    if (!match || match.gameEnded) return;

    // Set 5-minute forfeit timer
    const timer = setTimeout(() => {
      if (match.gameEnded) return;
      match.gameEnded = true;
      const winnerSocket = match.player1Socket.id === socket.id ? match.player2Socket : match.player1Socket;
      if (winnerSocket) {
        winnerSocket.emit('gameEnd', { reason: 'opponent_disconnect', result: 'win' });
      }
      // Clean up match from array
      const idx = matches.indexOf(match);
      if (idx !== -1) matches.splice(idx, 1);
    }, 5 * 60 * 1000);

    if (!match.disconnectTimers) match.disconnectTimers = {};
    match.disconnectTimers[socket.id] = timer;
  });
});

// start the server
server.listen(PORT, () => {
  console.log(`Live on ${PORT}`);
});
