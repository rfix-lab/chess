import { fileURLToPath } from 'url';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { chessMakeMove, checkLegalMove, isGameEndReason, isKingInCheck, turnToColor, king } from './lib/chessutils.js';
import { matches, findMatch, initMatch, findPrivateMatch } from './lib/matchmaking.js';
import { authenticateUser, signupUser } from './lib/auth.js';

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
    if (!match || !match.player1Socket || !match.player2Socket) return;

    // authenticating move
    let valid = checkLegalMove(
      match.boardState,
      fromCoords, toCoords,
      match
    );

    let sentBoard = match.boardState.map((arr) => { return arr.slice(); });
    if (valid) {
      chessMakeMove(match, fromCoords, toCoords);

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
    }

    match.player1Socket.emit('validated', sentBoard, match.turnState);
    match.player2Socket.emit('validated', sentBoard, match.turnState);

    // check if game over
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

    const board = match.boardState.map((arr) => { return arr.slice(); });
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

    const endReason = isGameEndReason(match.boardState, match.turnState);
    if (endReason === 'checkmate') {
      socket.emit('checkMate', match.turnState);
      if (opponent) opponent.emit('checkMate', match.turnState);
    } else if (endReason === 'stalemate') {
      socket.emit('stalemate');
      if (opponent) opponent.emit('stalemate');
    }
  });

  // thie route is fired when a socket disconnects
  socket.on('disconnect', () => {
    // console.log(`User[${socket.id}]: disconnected`);
  });
});

// start the server
server.listen(PORT, () => {
  console.log(`Live on ${PORT}`);
});
