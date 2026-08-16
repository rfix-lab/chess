/*
  match{
    matchId,
    player1Socket,
    player2Socket,
    boardState,
    turnState,
    private
  }
*/
export let matches = [];

// Remove a match from the pool by object reference (NOT by index — matchIds are not array
// indices; see docs/archive/errors/02.err). No-op if the match is already gone.
export function removeMatch(match) {
  const idx = matches.indexOf(match);
  if (idx !== -1) matches.splice(idx, 1);
}

// Cancel all pending disconnect/forfeit timers for a match (call before setting gameEnded).
export function clearMatchTimers(match) {
  if (!match || !match.disconnectTimers) return;
  for (const key of Object.keys(match.disconnectTimers)) {
    clearTimeout(match.disconnectTimers[key]);
  }
  match.disconnectTimers = {};
}


const initBoardState = [
  [12, 14, 13, 11, 10, 13, 14, 12],
  [9, 9, 9, 9, 9, 9, 9, 9],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [4, 6, 5, 3, 2, 5, 6, 4]];

export function initMatch(id, playerSocket) {
  return {
    matchId: id,
    player1Socket: playerSocket,
    player2Socket: null,
    boardState: initBoardState.map(function (arr) {
      return arr.slice();
    }),
    turnState: 0,
    castlingRights: {
      whiteKingSide: true,
      whiteQueenSide: true,
      blackKingSide: true,
      blackQueenSide: true
    },
    lastMove: null,
    moveHistory: [],
    stateHistory: [],
    halfMoveClock: 0,
    private: false,
    gameEnded: false,
    drawOffered: null,
    challengeFrom: null,
    takebackOffered: null
  }
}

export function findMatch(playerSocket) {
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].private)
      continue;
    if (matches[i].gameEnded)
      continue; // never re-seat a finished match (S2: completed matches are removed, but be safe)

    if (matches[i].player2Socket == null) {
      matches[i].player2Socket = playerSocket;
      startMatch(matches[i].matchId);
      return i;
    }
  }
  // next unique id — matches.length is NOT safe after splice (completed matches get removed)
  let maxId = -1;
  for (const m of matches) {
    if (m.matchId > maxId) maxId = m.matchId;
  }
  matches.push(initMatch(maxId + 1, playerSocket));
  return matches.length - 1;
}

export function findPrivateMatch(playerSocket, matchId) {
  for(let match of matches) {
    if (match.matchId === matchId && match.private) {
      if (match.gameEnded) continue; // finished private matches never re-enterable (S2)

      if (match.player1Socket && match.player1Socket.connected) {
        match.player2Socket = playerSocket;
        startMatch(matchId);
        return 1;
      } else {
        match.player1Socket = playerSocket;
        return 1;
      }
    }
  }
  return 0;
}

function startMatch(id) {
  // matchId is NOT an array index — completed matches get spliced out (S2).
  // Look the match up by id (C5: matches[i] hit undefined → startGame never sent).
  const m = matches.find(x => x.matchId === id);
  if (!m || !m.player1Socket || !m.player2Socket) return;
  m.player1Socket.emit('startGame', 0, id);
  m.player2Socket.emit('startGame', 1, id);
}