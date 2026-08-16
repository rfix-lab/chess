import { fileURLToPath } from 'url';
import express from 'express';
import http from 'http';
import { pathToFileURL } from 'url';
import { Server } from 'socket.io';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { chessMakeMove, checkLegalMove, isGameEndReason, isKingInCheck, turnToColor, king, white, black, pawn, checkThreefoldDraw, isInsufficientMaterial, isFiftyMoveRule, getPiece, blank } from './lib/chessutils.js';
import { matches, findMatch, initMatch, findPrivateMatch, removeMatch, clearMatchTimers } from './lib/matchmaking.js';
import { authenticateUser, signupUser, validateSession, loadUsersFile, saveUsersFile, loadSessionsFile, attachSessionsToUsers, START_ELO } from './lib/auth.js';
import { log as dlog } from './lib/debuglog.js';

// Rate limiting: prevent clients from spamming socket events
const rateLimits = new Map(); // socketId -> { move: 0, challenge: 0, takeback: 0, lastReset: timestamp }

// H4: magic numbers extracted into named constants (values unchanged)
const MOVE_RATE_LIMIT_WINDOW_MS = 1000;   // rate-limit window for 'move' events
const MOVE_RATE_LIMIT_MAX = 10;           // max 'move' events per window
const CHALLENGE_RATE_LIMIT_WINDOW_MS = 10000; // rate-limit window for 'challenge' events
const CHALLENGE_RATE_LIMIT_MAX = 3;       // max 'challenge' events per window
const TAKEBACK_RATE_LIMIT_WINDOW_MS = 10000;  // rate-limit window for 'takeback' events
const TAKEBACK_RATE_LIMIT_MAX = 5;        // max 'takeback' events per window
const FORFEIT_TIMEOUT_MS = 5 * 60 * 1000; // abandon game on disconnect after 5 minutes
const ELO_K = 32; // F2: Elo K-factor (classic)

// Board square bit masks (low 4 bits = piece type | color, high bits = UI indicators)
const PIECE_MASK = 0b01111;        // keep piece+color bits, strip indicators
const INDICATOR_LAST_MOVE = 0b10000;      // highlight last move from/to squares
const INDICATOR_CHECK = 0b100000;         // highlight king in check
const INDICATOR_EN_PASSANT = 0b1000000;   // highlight en-passant target square

// F3: serialize the board to a FEN string. Used for replay snapshots; the
// client's fen_to_board() only parses the piece-placement part, but the rest
// (side to move, castling, ep, counters) is filled in for a valid FEN.
function boardToFen(board, match) {
  let rows = [];
  for (let y = 0; y < 8; y++) {
    let row = '', empty = 0;
    for (let x = 0; x < 8; x++) {
      const v = board[y][x];
      if (v === blank) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      const letters = { 1: 'p', 2: 'k', 3: 'q', 4: 'r', 5: 'b', 6: 'n' };
      const ch = letters[getPiece(v)];
      row += (v & black) ? ch.toUpperCase() : ch;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  let fen = rows.join('/') + ' ' + (match.turnState === 0 ? 'w' : 'b');
  const cr = match.castlingRights || {};
  let c = '';
  if (cr.whiteKingSide) c += 'K';
  if (cr.whiteQueenSide) c += 'Q';
  if (cr.blackKingSide) c += 'k';
  if (cr.blackQueenSide) c += 'q';
  fen += ' ' + (c || '-');
  let ep = '-';
  const lm = match.lastMove;
  if (lm && lm.piece && getPiece(lm.piece) === pawn) {
    if (lm.from.y === 6 && lm.to.y === 4) ep = String.fromCharCode(97 + lm.to.x) + '6';
    if (lm.from.y === 1 && lm.to.y === 3) ep = String.fromCharCode(97 + lm.to.x) + '3';
  }
  fen += ' ' + ep + ' ' + (match.halfMoveClock || 0) + ' ' + (Math.floor(match.moveHistory.length / 2) + 1);
  return fen;
}

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

// Centralized match termination (S2: memory leak — completed matches were never
// removed from matches[]). Called from every game-end path: checkmate, stalemate,
// draw (agreement / threefold / insufficient / 50-move), resign, challenge->resign,
// forfeit on disconnect. Sequence: gameEnded flag (+ reason) -> clear forfeit timers
// -> clear pending offers (a pending drawOffer at end-of-game is wiped) -> splice the
// match out of matches[] BY OBJECT (never by index — docs/archive/errors/02.err) -> broadcast
// gameEnd so clients clear their saved session (reconnect after end is then rejected
// with 'gameNotFound' because the match is gone).
// `lostColor` (0=white, 1=black) names the loser: resign/challenge/forfeit. Without it,
// the result is draw for agreed draws, or the mated side loses on checkmate/stalemate.
// The client gameEnd handler (gameSockets.js) reads data.result: 'draw' | 'win' | 'loss'.
function endMatch(match, reason, lostColor) {
  if (match.gameEnded) return;
  match.gameEnded = true;
  match.endReason = reason;
  dlog('endMatch: matchId=', match.matchId, 'reason=', reason, 'lostColor=', lostColor, 'turnState=', match.turnState);
  clearMatchTimers(match);
  match.drawOffered = null;
  match.challengeFrom = null;
  match.takebackOffered = null;
  removeMatch(match);

  let loser = lostColor;
  if (loser === undefined) {
    if (reason === 'checkmate' || reason === 'stalemate') {
      loser = match.turnState; // side to move has no legal reply / is mated
    }
  }
  dlog('endMatch: resolved loser=', loser, 'reason=', reason, 'matchId=', match.matchId);
  const resultFor = (color) => {
    if (loser === undefined || reason === 'draw') return 'draw';
    return color === loser ? 'loss' : 'win';
  };
  if (match.player1Socket) match.player1Socket.emit('gameEnd', { reason, result: resultFor(0) });
  if (match.player2Socket) match.player2Socket.emit('gameEnd', { reason, result: resultFor(1) });

  // F3: replay — send both players the full move history right after gameEnd
  // (the match is already spliced, so the client must keep the history itself —
  // it stores the payload in localStorage per matchId). `moveHistory` entries
  // were recorded by the 'move' handler: { from, to, turn, piece, capture,
  // fen, fenAfter }. fen/fenAfter are FEN snapshots before/after the move,
  // letting the client rewind positions without re-running the engine.
  const toFile = (c) => String.fromCharCode(97 + c.x);
  const toRank = (c) => String(8 - c.y);
  const replay = (match.moveHistory || []).map((m, i) => ({
    n: i + 1,
    color: m.turn,
    piece: m.piece,
    capture: !!m.capture,
    from: m.from,
    to: m.to,
    san: toFile(m.from) + toRank(m.from) + (m.capture ? 'x' : '-') + toFile(m.to) + toRank(m.to),
    fen: m.fen,
    fenAfter: m.fenAfter
  }));
  if (match.player1Socket) match.player1Socket.emit('replay', replay);
  if (match.player2Socket) match.player2Socket.emit('replay', replay);

  // F2: Elo (K=32, start 1500). Rated match = both players registered
  // (socket.data.user set by the 'auth' handler; guests stay null). Guest
  // games never touch the rating. The loser's delta is the negative of the
  // winner's, so the pair sum is preserved (1500+1500=3000 baseline).
  const u1 = match.player1Socket && match.player1Socket.data && match.player1Socket.data.user;
  const u2 = match.player2Socket && match.player2Socket.data && match.player2Socket.data.user;
  if (u1 && u2) {
    const score1 = loser === undefined ? 0.5 : (loser === 1 ? 1 : 0);
    const exp1 = 1 / (1 + Math.pow(10, ((u2.elo - u1.elo) / 400)));
    const delta = Math.round(ELO_K * (score1 - exp1));
    dlog('endMatch: elo update matchId=', match.matchId, 'winner-side=', 1 - (loser === undefined ? -1 : loser), 'delta=', delta);
    u1.elo = (Number(u1.elo) || START_ELO) + delta;
    u2.elo = (Number(u2.elo) || START_ELO) - delta;
    saveUsersFile(users); // atomic rewrite
    const eloMsg = { player1: u1.elo, player2: u2.elo };
    if (match.player1Socket) match.player1Socket.emit('elo', eloMsg);
    if (match.player2Socket) match.player2Socket.emit('elo', eloMsg);
  }
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
// F1: user accounts persist in users.csv (DATA_DIR, default /app/data in the
// container — a named volume on the worker node). Loaded into RAM at startup;
// matches remain in-memory only. B6: sessions now persist too (sessions.json),
// so a container restart no longer wipes logins while cookies are still live.
let users = loadUsersFile();
const sessionEntries = loadSessionsFile();
attachSessionsToUsers(users, sessionEntries);
dlog('sessions: loaded from disk count=', sessionEntries.length);

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

// F1: username autocomplete for the lobby form. Registered usernames only —
// no passwords/elo/other data ever leaves this endpoint.
app.get('/api/users', (req, res) => {
  const prefix = String(req.query.prefix || '').toLowerCase();
  const names = users
    .filter(u => u.username.toLowerCase().startsWith(prefix))
    .map(u => u.username)
    .slice(0, 10);
  dlog('api /api/users GET status=200 prefix=', JSON.stringify(prefix), 'returned=', names.length);
  res.json(names);
});

app.get('/game', (req, res) => {
  let matchId = req.query.matchId;
  // Validate matchId is a non-negative integer to prevent XSS
  if (matchId !== undefined && matchId !== '' && (!Number.isInteger(Number(matchId)) || Number(matchId) < 0)) {
    return res.status(400).send('Invalid matchId');
  }
  res.render('game', {
    matchId: matchId ?? ""
  });
});

// socket.io server
io.on('connection', socket => {
  // DEBUG: log every connection with session context (cookie + resolved username).
  // The client stores the session ID in a 'sessionID' cookie; if present we resolve
  // the username so the log line ties the socket to a real user.
  const cookie = socket.handshake.headers['cookie'] || '';
  const sidMatch = cookie.match(/sessionID=([^;\s]+)/);
  let connUsername = null;
  if (sidMatch) {
    // READ-ONLY lookup for logging: must NOT call validateSession() here —
    // it has a side effect (removes expired sessions), which would change behavior.
    for (const u of users) {
      if (u.sessions.some(s => s.id === sidMatch[1])) { connUsername = u.username; break; }
    }
  }
  dlog('socket connect: id=', socket.id, 'sessionCookie=', sidMatch ? 'yes' : 'no', 'username=', connUsername || 'guest');

  // this route validates a move sent by a player
  socket.on('move', (matchId, fromCoords, toCoords) => {
    const match = matches.find(m => m.matchId === matchId);

    // Rate limit: max 10 moves per second
    if (isRateLimited(socket, 'move', MOVE_RATE_LIMIT_WINDOW_MS, MOVE_RATE_LIMIT_MAX)) {
      dlog('move: rate-limited matchId=', matchId, 'from=', JSON.stringify(fromCoords), 'to=', JSON.stringify(toCoords));
      return;
    }
    if (!match || !match.player1Socket || !match.player2Socket || match.gameEnded) {
      dlog('move: REJECTED (no active match or game ended) matchId=', matchId,
          'found=', !!match, 'ended=', !!(match && match.gameEnded));
      return;
    }

    // Validate coordinates
    if (!fromCoords || !toCoords || typeof fromCoords.x !== 'number' || typeof fromCoords.y !== 'number' ||
        typeof toCoords.x !== 'number' || typeof toCoords.y !== 'number') {
      dlog('move: REJECTED reason=invalid-coordinates matchId=', matchId, 'from=', JSON.stringify(fromCoords), 'to=', JSON.stringify(toCoords));
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
      dlog('move: REJECTED reason=illegal matchId=', matchId, 'turnState=', match.turnState,
          'mover-is-p1=', match.player1Socket.id === socket.id,
          'from=', fromCoords.y + ':' + fromCoords.x, 'to=', toCoords.y + ':' + toCoords.x);
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

    // F3: FEN snapshot BEFORE the move (pre-move position for the replay)
    const preFen = boardToFen(match.boardState, match);

    dlog('move: APPLIED matchId=', matchId, 'turn=', match.turnState, 'from=', fromCoords.y + ':' + fromCoords.x, 'to=', toCoords.y + ':' + toCoords.x);
    chessMakeMove(match, fromCoords, toCoords);

    // Update halfMoveClock
    if (isPawn || isCapture || isEnPassant) {
      match.halfMoveClock = 0;
    } else {
      match.halfMoveClock++;
    }

    // F3: FEN snapshot AFTER the move (post-move position for the replay).
    // For pending promotions the pawn is still on the back rank here; the
    // 'promotion:choose' handler rewrites fenAfter once the piece is chosen.
    const postFen = boardToFen(match.boardState, match);

    // Record move in history (before turnState flip)
    const turnBefore = 1 - match.turnState;
    match.moveHistory.push({
      from: fromCoords,
      to: toCoords,
      turn: turnBefore,
      piece,               // piece+color value moved (pre-move square)
      capture: isCapture || isEnPassant,
      fen: preFen,
      fenAfter: postFen
    });

    // If pawn reached promotion square, wait for piece choice
    if (match.pendingPromotion) {
      dlog('move: pendingPromotion matchId=', matchId, 'color=', match.pendingPromotion.color);
      sentBoard = match.boardState.map((arr) => { return arr.slice(); });
      const promoColor = match.pendingPromotion.color;
      match.player1Socket.emit('validated', sentBoard, match.turnState, { pendingPromotion: true, promotionColor: promoColor });
      match.player2Socket.emit('validated', sentBoard, match.turnState, { pendingPromotion: true, promotionColor: promoColor });
      return;
    }

    sentBoard = match.boardState.map((arr) => { return arr.slice(); });
    sentBoard[fromCoords.y][fromCoords.x] |= INDICATOR_LAST_MOVE; // move indicators
    sentBoard[toCoords.y][toCoords.x] |= INDICATOR_LAST_MOVE;

    // En passant: highlight the target square next to a pawn that just moved 2 squares
    const movedPiece = match.boardState[toCoords.y][toCoords.x];
    if (movedPiece === (white | pawn) && fromCoords.y === 6 && toCoords.y === 4) {
      sentBoard[4][fromCoords.x] |= INDICATOR_EN_PASSANT;
    }
    if (movedPiece === (black | pawn) && fromCoords.y === 1 && toCoords.y === 3) {
      sentBoard[3][fromCoords.x] |= INDICATOR_EN_PASSANT;
    }

    // Check indicator: highlight king if in check
    const nextColor = turnToColor(match.turnState);
    if (isKingInCheck(match.boardState, match.turnState)) {
      for (let ki = 0; ki < 8; ki++) {
        for (let kj = 0; kj < 8; kj++) {
          if (match.boardState[ki][kj] === (king | nextColor)) {
            sentBoard[ki][kj] |= INDICATOR_CHECK;
          }
        }
      }
    }

    match.player1Socket.emit('validated', sentBoard, match.turnState);
    match.player2Socket.emit('validated', sentBoard, match.turnState);

    // Check game end: threefold repetition / insufficient material / 50-move / checkmate / stalemate
    const threefold = checkThreefoldDraw(match);
    if (threefold.draw) {
      endMatch(match, 'threefold');
      match.player1Socket.emit('draw', { reason: 'threefold' });
      match.player2Socket.emit('draw', { reason: 'threefold' });
      return;
    }
    if (threefold.isWarning) {
      match.player1Socket.emit('repetitionWarning', { patternDescription: threefold.patternDescription });
      match.player2Socket.emit('repetitionWarning', { patternDescription: threefold.patternDescription });
    }

    if (isInsufficientMaterial(match.boardState)) {
      endMatch(match, 'insufficient');
      match.player1Socket.emit('draw', { reason: 'insufficient' });
      match.player2Socket.emit('draw', { reason: 'insufficient' });
      return;
    }

    if (isFiftyMoveRule(match.boardState, match.halfMoveClock)) {
      endMatch(match, 'fifty');
      match.player1Socket.emit('draw', { reason: 'fifty' });
      match.player2Socket.emit('draw', { reason: 'fifty' });
      return;
    }
    const endReason = isGameEndReason(match.boardState, match.turnState);
    if (endReason === 'checkmate') {
      endMatch(match, 'checkmate');
      match.player1Socket.emit('checkMate', match.turnState);
      match.player2Socket.emit('checkMate', match.turnState);
    } else if (endReason === 'stalemate') {
      endMatch(match, 'stalemate');
      match.player1Socket.emit('stalemate');
      match.player2Socket.emit('stalemate');
    }
  });

  // this route signs in a user
  socket.on('signin', async ({ username, password }) => {
    dlog('auth signin attempt: username=', username);
    let [r, sessionID] = await authenticateUser(users, username, password);
    socket.emit('signin', r, sessionID);
  });

  // this route signs up a user
  socket.on('signup', ({ username, password }) => {
    // console.log(`User[${socket.id}]: signup with [${username}, ${password}]`);

    signupUser(users, username, password).then(r => {
      socket.emit('signup', r);
    });
  });

  // this route authenticates a user with a sessionID
  socket.on('auth', (sessionID, matchId) => {
    // F2: remember who this socket is (null for guests) so endMatch can
    // decide whether the game is rated.
    socket.data.user = null;
    if (sessionID) {
      const user = validateSession(users, sessionID);
      if (!user) {
        dlog('auth: REJECTED (invalid/expired session) socket=', socket.id, 'emitting authFailed, matchId=', matchId);
        socket.emit('authFailed');
        return;
      }
      socket.data.user = user;
    } else {
      dlog('auth: guest (no sessionID) socket=', socket.id, 'matchId=', matchId);
    }

    if (matchId === null) {
      // regular match making
      dlog('auth: routing to findMatch socket=', socket.id);
      findMatch(socket);
    } else {
      dlog('auth: routing to findPrivateMatch socket=', socket.id, 'matchId=', matchId);
      findPrivateMatch(socket, matchId); // if func returns 0, no private match exists with that matchID (invalid link)
    }
    // use sessionID to identify the user
    // if sessionID is undefined, then the user plays as a guest
  });

  // reconnect: player reloads page and wants to rejoin their game with the same color
  socket.on('reconnect', ({ gameId, color, sessionID, prevSocketId }) => {
    const match = matches.find(m => m.matchId === gameId);
    if (!match) {
      dlog('reconnect: gameNotFound reason=no-such-match gameId=', gameId);
      socket.emit('gameNotFound');
      return;
    }

    // Game already finished — check if board has checkmate/stalemate for current turn
    const endReason = isGameEndReason(match.boardState, match.turnState);
    if (endReason) {
      dlog('reconnect: gameNotFound reason=game-ended gameId=', gameId, 'endReason=', endReason);
      socket.emit('gameNotFound');
      return;
    }

    const playerSocket = color === 0 ? match.player1Socket : match.player2Socket;

    // If current socket is the same (reconnect to self), that's fine.
    // If another socket already occupies this color slot:
    //  - B4: the slot holds a DEAD socket (F5 already fired the old socket's
    //    'disconnect') OR it's the SAME client (socket.io reconnect race: the
    //    new connection lands before the old socket's 'disconnect' event, so the
    //    old one is still .connected) → this is the returning player; replace
    //    the stale socket instead of rejecting with gameNotFound.
    //  - otherwise (a different LIVE client holds the slot) → reject.
    if (playerSocket && playerSocket !== socket) {
      const sameClient = !!(prevSocketId && playerSocket.id === prevSocketId);
      const staleDead = !playerSocket.connected;
      if (staleDead || sameClient) {
        dlog('reconnect: replacing stale socket gameId=', gameId, 'color=', color, 'old=', playerSocket.id, 'new=', socket.id, 'oldConnected=', playerSocket.connected, 'sameClient=', sameClient);
        // The forfeit timer is keyed by the OLD socket.id — cancel it here (the
        // code below only cancels by the new socket.id).
        if (match.disconnectTimers && match.disconnectTimers[playerSocket.id]) {
          clearTimeout(match.disconnectTimers[playerSocket.id]);
          delete match.disconnectTimers[playerSocket.id];
        }
      } else {
        dlog('reconnect: gameNotFound reason=slot-occupied gameId=', gameId, 'color=', color);
        socket.emit('gameNotFound');
        return;
      }
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
    const cleanBoard = match.boardState.map((arr) => arr.slice().map((v) => v & PIECE_MASK));

    // Add check indicator if applicable
    const reconnectedColor = color === 0 ? 0 : 1;
    if (isKingInCheck(match.boardState, reconnectedColor)) {
      const kingColor = turnToColor(reconnectedColor);
      for (let ki = 0; ki < 8; ki++) {
        for (let kj = 0; kj < 8; kj++) {
          if (match.boardState[ki][kj] === (king | kingColor)) {
            cleanBoard[ki][kj] |= INDICATOR_CHECK;
          }
        }
      }
    }

    socket.emit('reconnected', color, gameId, cleanBoard, match.turnState);
    dlog('reconnect: OK socket=', socket.id, 'gameId=', gameId, 'color=', color);
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

    dlog('private-match: created matchId=', privateMatch.matchId, 'for socket=', socket.id);
    socket.emit('private-match', privateMatch.matchId);
  });

  // Handle promotion piece selection
  socket.on('promotion:choose', (data) => {
    const match = matches.find(m => m.matchId === data.gameId);
    if (!match || !match.pendingPromotion) {
      dlog('promotion:choose: REJECTED (no pending promotion) gameId=', data && data.gameId, 'match=', !!match, 'pending=', !!(match && match.pendingPromotion));
      return;
    }

    const { from, to, color } = match.pendingPromotion;
    const pieceType = data.pieceType;

    dlog('promotion:choose: matchId=', match.matchId, 'pieceType=', pieceType, 'color=', color);
    match.boardState[to.y][to.x] = color | pieceType;
    match.pendingPromotion = null;
    match.turnState = 1 - match.turnState;

    // F3: fix the replay FEN snapshot — the pawn on the back rank has just
    // been replaced by the chosen promoted piece.
    if (match.moveHistory.length) {
      match.moveHistory[match.moveHistory.length - 1].fenAfter = boardToFen(match.boardState, match);
    }

    // Record the original pawn move in history (turn before flip)
    // moveHistory already recorded in the 'move' handler (line ~103).
    // Do NOT push here again — that was causing duplicate entries for promotion moves.

    const board = match.boardState.map((arr) => { return arr.slice(); });
    // En passant indicator after promotion (pawn moved 2 squares before promotion)
    const promotedPiece = match.boardState[to.y][to.x];
    if (promotedPiece === (white | pieceType) && from.y === 6 && to.y === 7) {
      board[4][from.x] |= INDICATOR_EN_PASSANT;
    }
    if (promotedPiece === (black | pieceType) && from.y === 1 && to.y === 0) {
      board[3][from.x] |= INDICATOR_EN_PASSANT;
    }
    // Check indicator: highlight king if in check
    const nextColor2 = turnToColor(match.turnState);
    if (isKingInCheck(match.boardState, match.turnState)) {
      for (let ki = 0; ki < 8; ki++) {
        for (let kj = 0; kj < 8; kj++) {
          if (match.boardState[ki][kj] === (king | nextColor2)) {
            board[ki][kj] |= INDICATOR_CHECK;
          }
        }
      }
    }
    const opponent = match.player1Socket.id === socket.id ? match.player2Socket : match.player1Socket;

    socket.emit('validated', board, match.turnState);
    if (opponent) opponent.emit('validated', board, match.turnState);

    // Check game end after promotion resolves (same paths as the 'move' handler)
    const threefold = checkThreefoldDraw(match);
    if (threefold.draw) {
      endMatch(match, 'threefold');
      socket.emit('draw', { reason: 'threefold' });
      if (opponent) opponent.emit('draw', { reason: 'threefold' });
      return;
    }
    if (threefold.isWarning) {
      socket.emit('repetitionWarning', { patternDescription: threefold.patternDescription });
      if (opponent) opponent.emit('repetitionWarning', { patternDescription: threefold.patternDescription });
    }

    if (isInsufficientMaterial(match.boardState)) {
      endMatch(match, 'insufficient');
      socket.emit('draw', { reason: 'insufficient' });
      if (opponent) opponent.emit('draw', { reason: 'insufficient' });
      return;
    }

    if (isFiftyMoveRule(match.boardState, match.halfMoveClock)) {
      endMatch(match, 'fifty');
      socket.emit('draw', { reason: 'fifty' });
      if (opponent) opponent.emit('draw', { reason: 'fifty' });
      return;
    }

    const endReason = isGameEndReason(match.boardState, match.turnState);
    if (endReason === 'checkmate') {
      endMatch(match, 'checkmate');
      socket.emit('checkMate', match.turnState);
      if (opponent) opponent.emit('checkMate', match.turnState);
    } else if (endReason === 'stalemate') {
      endMatch(match, 'stalemate');
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
      match.player1Socket.emit('gameEnd', { result: 'draw', reason: 'agreement' });
      match.player2Socket.emit('gameEnd', { result: 'draw', reason: 'agreement' });
      dlog('drawResponse: ACCEPTED matchId=', matchId, 'responder-socket=', socket.id);
      endMatch(match, 'draw'); // removes from matches[] + clears pending offers/timers
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

    const resignedColor = match.player1Socket.id === socket.id ? 0 : 1;
    dlog('resign: matchId=', matchId, 'resignedColor=', resignedColor);
    match.player1Socket.emit('resignReceived', { resigned: resignedColor });
    match.player2Socket.emit('resignReceived', { resigned: resignedColor });
    endMatch(match, 'resign', resignedColor); // removes from matches[] + clears pending offers/timers
  });

  // Challenge to resign
  socket.on('challenge', (matchId) => {
    const match = matches.find(m => m.matchId === matchId);

    // Rate limit: max 3 challenges per 10 seconds
    if (isRateLimited(socket, 'challenge', CHALLENGE_RATE_LIMIT_WINDOW_MS, CHALLENGE_RATE_LIMIT_MAX)) {
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
      match.challengeFrom = null;
      const challengedColor = match.player1Socket.id === socket.id ? 0 : 1;
      dlog('challengeResponse: ACCEPTED matchId=', matchId, 'challengedColor=', challengedColor);
      match.player1Socket.emit('resignReceived', { resigned: challengedColor });
      match.player2Socket.emit('resignReceived', { resigned: challengedColor });
      endMatch(match, 'challenge', challengedColor); // removes from matches[] + clears pending offers/timers
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
    if (isRateLimited(socket, 'takeback', TAKEBACK_RATE_LIMIT_WINDOW_MS, TAKEBACK_RATE_LIMIT_MAX)) {
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
    dlog('socket disconnect: id=', socket.id, 'username=', (socket.data.user && socket.data.user.username) || 'guest');
    rateLimits.delete(socket.id);
    const match = matches.find(m => m.player1Socket?.id === socket.id || m.player2Socket?.id === socket.id);
    if (!match || match.gameEnded) return;

    // Cancel any pre-existing forfeit timer (e.g. the other player disconnected
    // earlier and this player also left — we only want one active timer).
    clearMatchTimers(match);

    // B3: pre-start disconnect (no moves played yet) — the match never began.
    // A 5-minute forfeit timer here leaves a "ghost seat": the other player is
    // seated into this match and gets startGame against a dead opponent. End the
    // match immediately instead. moveHistory.length===0 = pre-start (the push in
    // the 'move' handler runs BEFORE the pendingPromotion check, so a pending
    // promotion already counts as started and falls through to the timer below).
    if (match.moveHistory.length === 0) {
      const lostColor = match.player1Socket?.id === socket.id ? 0 : 1;
      dlog('disconnect: pre-start (no moves) — immediate endMatch matchId=', match.matchId, 'lostColor=', lostColor);
      endMatch(match, 'opponent_disconnect', lostColor); // single cleanup point (S2)
      return;
    }

    // Set 5-minute forfeit timer (game in progress). The disconnected socket is
    // passed to endMatch so the gameEnd broadcast can compute win/loss per player
    // (client gameEnd handler reads data.result: 'draw'|'win'|'loss').
    const timer = setTimeout(() => {
      dlog('timer: forfeit timeout fired (', FORFEIT_TIMEOUT_MS, 'ms) matchId=', match.matchId, 'disconnecting-side=', match.player1Socket?.id === socket.id ? 0 : 1);
      if (match.gameEnded) return;
      const lostColor = match.player1Socket?.id === socket.id ? 0 : 1;
      endMatch(match, 'opponent_disconnect', lostColor); // single cleanup point (S2)
    }, FORFEIT_TIMEOUT_MS);

    if (!match.disconnectTimers) match.disconnectTimers = {};
    match.disconnectTimers[socket.id] = timer;
    dlog('timer: forfeit scheduled in', FORFEIT_TIMEOUT_MS, 'ms matchId=', match.matchId, 'for socket=', socket.id);
  });
});

// start the server (skip when imported by test runner)
export { app, server, io };
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  server.listen(PORT, () => {
    console.log(`Live on ${PORT}`);
    dlog('server started: PORT=', PORT, 'DEBUG=', process.env.DEBUG, 'users loaded=', users.length);
  });
}
