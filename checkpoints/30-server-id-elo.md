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
- [x] 2. matchmaking.js (c61141f): `genMatchId()` (node:crypto randomInt, 8 x [a-z0-9], 36^8 ≈ 2.8e12)
      with whole-pool collision check + regenerate loop; findMatch creates public matches with it;
      maxId+1 numeric logic and the only `>` matchId comparison removed; seatHook hook added
      (null-safe until wired in the next commit). auth.js untouched — it only exports START_ELO,
      which index.js consumes directly; no auth.js change was needed.
- [x] 3. index.js (b374cdb): 'private-match' handler IGNORES any client-supplied id, generates the
      8-char id itself (genMatchId) and emits 'private-match' back with it — one string arg, the
      exact contract lobby link building + test/e2e-client.mjs rely on.
- [x] 4. index.js (b374cdb): normId() (= String()) at every socket entry point — auth, private-match,
      reconnect, move, promotion:choose, draw*, resign, challenge*, takeback*. NO parseInt of
      matchId anywhere; every lookup/comparison stays strict === string-to-string. Stale INTEGER ids
      from old clients' sessionStorage/localStorage flow through String() and simply miss the pool
      → gameNotFound / no-match path, never a crash. /game route: query matchId validated
      /^[a-z0-9]{1,32}$/ (was Number.isInteger) — still strict, no XSS through the ejs view.
- [x] 5. index.js (b374cdb, TASK 2): emitSeatElo(socket, match) wired via setSeatHook. startMatch
      calls the hook for BOTH sockets after the startGame emissions; the 'reconnect' handler calls it
      directly after a successful re-seat. Only sockets with socket.data.user set (registered) get
      it. Payload { own, rated, opponent }: rated=true only if the opponent socket.data.user is also
      set; opponent = opponent's current elo when rated, else null. The end-of-game 'elo' emission in
      endMatch is byte-for-byte unchanged ({ player1, player2 }) — backward compat kept; the rating
      gate (rated only when BOTH socket.data.user set) was NOT touched.
- [x] 6. test-chess.mjs (this commit): every private-match test reads the id from the 'private-match'
      ECHO (persistent pre-registered listener; an `once` on the same emission would fire and leak a
      second listener). New regression rows:
      - public startGame id matches /^[a-z0-9]{8}$/
      - private echo id matches /^[a-z0-9]{8}$/; client-supplied arg (1) ignored — server's own id
      - join with EXACT echoed id still works (existing 'B and author both got startGame' row now
        runs on a generated id)
      - join with uppercase id refused; join with wrong-length id refused (no startGame)
      - stale INTEGER id via auth → no startGame, no authFailed, no crash
      - stale INTEGER id via reconnect → gameNotFound (graceful)
      - seat-elo phase 1: guest first (no emission); registered vs guest → rated:false, opponent:null
      - seat-elo phase 2: FRESH match — B3 ends phase-1's match on U's pre-start disconnect, so the
        dead id must not be reused (first naive run hit exactly this: U2 got nothing)
      - seat-elo phase 3: registered vs registered → both rated:true, reciprocal opponent elo
      - seat-elo key discipline: seat payloads carry own/rated/opponent only, never player1/player2
- [x] 7. Gates: node --check on all touched files after each commit (all green); final `npm test`
      all-green: **64/64 passed, 0 failed** (51 pre-existing rows + perft + 13 new T30 rows),
      final run 2026-11-23 ~11:40 MSK. e2e/browser suites NOT run (client agent owns the tree;
      orchestrator runs the e2e gate after both agents land).

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

- c61141f feat(server): genMatchId() — opaque 8-char a-z0-9 ids from node:crypto
  (src/lib/matchmaking.js + checkpoint). node --check OK.
- b374cdb feat(server): matchId opaque-string everywhere + private-match ignores client arg
  (src/index.js + checkpoint). Includes TASK 2's emitSeatElo/setSeatHook wiring
  (verified by the T30 seat-elo rows). node --check OK.
- 2be02a1 feat(server): T30 test rows — echo-based ids, format/refusal/stale-id + seat-elo phases
  (test-chess.mjs + checkpoint).
- 89bf1fb feat(server): harden T30 + REPLAY seat waits against parallel-load flakes
  (REPLAY 500→1200ms; T30 post-auth 500→1000ms, post-create 300→700ms).
- cb723f7 feat(server): fix T30 seat-elo phase 2/3 — create match #2 before U disconnects
  (disconnected socket's packets are dropped → match #2 was never created).
- 615079e feat(server): T30 seat-elo — G (not U) disconnects to end match #1, keeping U
  connected for the phase-3 join; deterministic join order (U2 waits on U's p3 payload).

## Verification notes / could-not-verify

- Verified: npm test 64/64 green (6 runs total; the first 4 runs surfaced and fixed real
  test-design races, see commit log — the SERVER code itself did not change after b374cdb
  except the already-committed wiring).
- Verified: no parseInt of matchId anywhere in src/; the only numeric matchId comparison
  (maxId >) removed; all joins use === on stringified ids.
- Verified: forbidden files untouched — diff vs 380ff73 touches only
  src/index.js, src/lib/matchmaking.js, test-chess.mjs, checkpoints/30-server-id-elo.md
  (src/lib/auth.js is in scope but needed no change — START_ELO is consumed by index.js).
- Could NOT verify: e2e/browser suite (client agent works in the same tree; orchestrator runs it
  after both land). The e2e contract the client relies on — 'private-match' echo = one string
  id, /game?matchId=<id> accepted by the /game route's new /^[a-z0-9]{1,32}$/ check — is
  covered by the unit rows but not a real browser page load.
- Note for client agent: old client JS that does `parseInt(matchId)` or builds
  `matchId+1` will now misbehave on the OPAQUE id; and the /game route now 400s on
  uppercase matchId query values (was: only non-integers 400'd). See the Event contract above.
