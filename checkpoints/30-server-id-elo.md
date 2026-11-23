# 30 — Server: random matchId + elo payload (S1, branch feat/round3-f3)

Report-first checkpoint. Update after every step; commit with each incremental change.
Scope: src/index.js, src/lib/matchmaking.js, src/lib/auth.js, test-chess.mjs, this file.
FORBIDDEN: src/public/**, test/e2e-client.mjs, test/repro-*.mjs, test/audit-*.mjs, package.json, docker files.

## Step checklist

- [x] 0. Read code: matchmaking.js (maxId+1 in findMatch), index.js 'private-match' handler
      (client-passed arg ignored anyway — server already generated its own maxId+1),
      'auth' (URL-string matchId path), 'reconnect'/'move'/all handlers use `m.matchId === id`,
      /game route integer validation, endMatch elo gate. Findings logged above.
- [x] 1. Checkpoint file created + committed with first code change (commit A: TASK 1 server).
- [x] 2. matchmaking.js: `genMatchId()` (node:crypto randomInt, 8 x [a-z0-9], 36^8 ≈ 2.8e12),
      `hasMatchId(id)` whole-pool collision check + regenerate loop; findMatch creates with
      genMatchId(); maxId+1 numeric logic removed (the only > comparison).
      auth.js untouched (START_ELO only used by index.js; no change needed there).
- [x] 3. index.js: 'private-match' handler ignores any client-supplied id, generates one,
      emits 'private-match' back with the generated id (single string arg — contract kept for
      lobby link building + test/e2e-client.mjs).
- [x] 4. index.js: normalize to string at socket entry points (auth, private-match, reconnect,
      move, promotion:choose, draw*, resign, challenge*, takeback*): `String(id)`. No parseInt
      anywhere; all comparisons stay `===` string-to-string. Stale integer ids from old clients'
      storage flow through String() and simply miss the pool (gameNotFound / no-match path).
- [x] 5. index.js: /game route — matchId query param validated against /^[a-z0-9]{1,32}$/
      instead of Number.isInteger (URL ids are now opaque; still strict, no XSS escape).
- [x] 6. TASK 2 elo payload: `emitSeatElo(socket, match)` helper — when socket.data.user is set
      and the socket is seated (both startGame emissions in startMatch, and a successful
      'reconnect' that replaces a socket), emit 'elo' to THAT socket with
      { own, rated, opponent } — rated=true only if the opponent's socket.data.user is also set;
      opponent = opponent elo when rated else null. End-of-game 'elo' emission in endMatch
      untouched (still { player1, player2 } for backward compat).
- [x] 7. test-chess.mjs: private-match tests now take the id from the 'private-match' echo
      (pre-registered persistent listener; `once` would fire on the same emission and leak the
      second listener); regression rows added:
      - public startGame id matches /^[a-z0-9]{8}$/
      - private echo id matches /^[a-z0-9]{8}$/
      - join with EXACT echoed id works (existing B+author rows already cover this)
      - join with uppercase id refused / join with wrong-length id refused (no startGame)
      - stale integer id: auth(null, 42) with no match 42 → no startGame, no authFailed, no crash
      - reconnect with stale integer gameId → gameNotFound (graceful)
      - seat elo: registered player seated next to a guest → { own: 1500, rated: false, opponent: null };
        second registered player seats → both get rated: true with opponent = other's elo
- [x] 8. Gates: node --check on src/index.js, src/lib/matchmaking.js, src/lib/auth.js,
      test-chess.mjs after each commit; final `npm test` all-green.

## Event contract (for the client agent)

Server → client:
- `private-match` (string id) — private match created; argument = generated id
  /^[a-z0-9]{8}$/, opaque, NOT numeric. Any client-supplied argument is ignored.
- `startGame` (int color, string matchId) — unchanged.
- `elo` — TWO payload shapes, disambiguate by keys:
  - SEAT payload (new, TASK 2): `{ own: <number>, rated: <bool>, opponent: <number|null> }`
    Sent to a single socket when a REGISTERED player is seated: on each startGame emission
    (only if that socket has socket.data.user) and on a successful 'reconnect' into the match.
    `rated` true only if the opponent is ALSO a registered player; `opponent` = opponent's
    current elo when rated, else null. `own` = this player's current elo.
  - GAME-END payload (existing, unchanged): `{ player1: <number>, player2: <number> }` — final
    ratings after the end-of-game K-factor update, sent to both sockets.
  Client rule: `typeof d.player1 === 'number'` → game-end shape; `typeof d.own === 'number'` →
  seat shape.
- `reconnected` (int color, string matchId, board, turnState, lastMove) — matchId is a string.
- `gameNotFound` — no args; stale/unknown id (incl. old numeric ids) lands here.

Client → server (matchId is an opaque string; server String()s at the boundary):
- `auth` (sessionID, matchId|null) | `private-match` (any, ignored) | `reconnect` ({ gameId, ... })
  | `move` (matchId, from, to) | `promotion:choose` ({ gameId, ... }) | `drawOffer`/`drawResponse`/
  `resign`/`challenge`/`challengeResponse`/`takebackRequest`/`takebackResponse` (matchId, ...)

## Commit log

(append after each commit)
