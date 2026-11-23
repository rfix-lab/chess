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
import { randomInt } from 'node:crypto';
import { log } from './debuglog.js';

export let matches = [];

// T30 (TASK 2): hook called right after the startGame emissions in startMatch with
// (socket, match) for EACH seated socket. index.js sets it to emit the seat 'elo'
// payload ({ own, rated, opponent }) to registered players. Kept here (not in
// index.js) so both the public and private seating paths reach it via startMatch.
export let seatHook = null;
export function setSeatHook(fn) { seatHook = fn; }

// T30: match ids are opaque 8-char random strings (alphabet a-z0-9, 36^8 ≈ 2.8e12
// combinations — collision probability is negligible, but genMatchId still checks
// the whole pool and regenerates on a hit, so an id is never a guess).
const MATCH_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const MATCH_ID_ALPHABET_SIZE = 36;
export const MATCH_ID_LENGTH = 8;

export function genMatchId() {
  let id = '';
  for (let i = 0; i < MATCH_ID_LENGTH; i++) {
    id += MATCH_ID_ALPHABET[randomInt(MATCH_ID_ALPHABET_SIZE)];
  }
  // Collision check over the WHOLE pool (private + public); regenerate on hit.
  while (matches.some(m => m.matchId === id)) {
    id = '';
    for (let i = 0; i < MATCH_ID_LENGTH; i++) {
      id += MATCH_ID_ALPHABET[randomInt(MATCH_ID_ALPHABET_SIZE)];
    }
    log('genMatchId: collision on', id, '— regenerated (pool=', matches.length, ')');
  }
  return id;
}

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
      log('matchmaking findMatch: seated as black in existing match matchId=', matches[i].matchId, 'pool=', matches.length);
      startMatch(matches[i].matchId);
      return i;
    }
  }
  // T30: opaque random id (was maxId+1 — numeric comparison is gone, id is opaque).
  const newId = genMatchId();
  matches.push(initMatch(newId, playerSocket));
  log('matchmaking findMatch: no open slot, created new match matchId=', newId, 'pool=', matches.length);
  return matches.length - 1;
}

export function findPrivateMatch(playerSocket, matchId) {
  for(let match of matches) {
    if (match.matchId === matchId && match.private) {
      if (match.gameEnded) continue; // finished private matches never re-enterable (S2)

      if (match.player1Socket && match.player1Socket.connected) {
        match.player2Socket = playerSocket;
        log('matchmaking findPrivateMatch: joined as black matchId=', matchId, 'host connected');
        startMatch(matchId);
        return 1;
      } else {
        match.player1Socket = playerSocket;
        log('matchmaking findPrivateMatch: joined as white (host not connected yet) matchId=', matchId);
        return 1;
      }
    }
  }
  log('matchmaking findPrivateMatch: NO MATCH found matchId=', matchId, 'private-pool=', matches.filter(m => m.private).length);
  return 0;
}

function startMatch(id) {
  // matchId is NOT an array index — completed matches get spliced out (S2).
  // Look the match up by id (C5: matches[i] hit undefined → startGame never sent).
  const m = matches.find(x => x.matchId === id);
  if (!m || !m.player1Socket || !m.player2Socket) {
    log('matchmaking startMatch: ABORTED (missing match or socket) matchId=', id,
        'found=', !!m, 'p1=', !!(m && m.player1Socket), 'p2=', !!(m && m.player2Socket));
    return;
  }
  log('matchmaking startMatch: both seated, emitting startGame matchId=', id);
  m.player1Socket.emit('startGame', 0, id);
  m.player2Socket.emit('startGame', 1, id);
  // T30 (TASK 2): seat 'elo' payload for registered players (index.js's hook).
  if (seatHook) {
    seatHook(m.player1Socket, m);
    seatHook(m.player2Socket, m);
  }
}