# 33 — Server: user account + invites (S-A, branch feat/user-account)

Contract: `checkpoints/32-contract-account.md` (Storage + Server events 2–5).
MatchId rules: `checkpoints/30-server-id-elo.md` (opaque 8-char a-z0-9, T30).
Scope: src/index.js, src/lib/**, src/views/account.ejs (PLACEHOLDER — S-B refines markup),
test-chess.mjs, this file.
FORBIDDEN: src/public/**, src/views/index.ejs, src/views/game.ejs, src/views/layout*.ejs,
test/e2e-client.mjs, test/e2e-gate.sh (S-B works there concurrently). No branches, no push.
Gates after each commit: `node --check` every touched js; `cd /root/proj/chess && npm test`
green (~77 rows: 64 existing + T31). One transient failure under parallel load may be
re-run ONCE; on second failure it is real.

## Step checklist

- [x] 1. Checkpoint file created + committed (with account.ejs placeholder).
- [x] 2. src/lib/games.js: GAMES_CSV path (DATA_DIR/games.csv), appendGameRow() (header
      materialization + one append), loadGames() parser. node --check OK.
- [x] 3. index.js endMatch: users.csv elo before/after captured BEFORE the K-factor update
      (and re-read after saveUsersFile); games.csv row appended in endMatch exactly once per match
      (same code path as the gameEnd emissions, guarded by match.gameEnded):
      `ts,white,black,result,reason,white_elo_before,white_elo_after,black_elo_before,black_elo_after`
      — white/black = username or `-`; result = white-win|black-win|draw; skipped when
      both sides are guests (u1 && u2 both null). npm test green (64).
- [x] 4. src/lib/invites.js: invites.json load at startup + RAM map + lazy persist
      (same pattern as sessions.json); createInvite / getInviteByMatch / getInviteTo /
      removeInviteByMatch / listLiveInvitesTo (filters the RAM match pool — dead matches never shown, record kept).
- [x] 5. index.js socket handlers: `invite:create` (auth -> method 'standard' -> target
      exists -> not self; failures emit `invite:failed` {reason: auth|method-na|no-user|self};
      success: genMatchId, unseated private match, createInvite, emit `invite:created`
      {matchId}); `invites:list` -> emit `invites` [live records addressed to me];
      automatic `invites` push right after any successful authenticated `auth`.
- [x] 6. matchmaking.js findPrivateMatch: optional invite {to, from} param — invite-bound
      matches are joinable ONLY by invite.to (target; black, or white if seat is free) and
      invite.from (inviter; white/first seat); anyone else -> gameNotFound. Plain
      private matches (invite=null) keep open-join semantics. index.js 'auth' path passes
      getInviteByMatch(matchId); when a WELL-FORMED id (^[a-z0-9]{8}$) with an invite is
      refused/absent, the auth path emits gameNotFound (malformed/stale ids keep the T30
      silent-miss behavior). npm test green.
- [x] 7a. (contract addendum 2026-11-23) index.js GET /api/me: parse sessionID cookie
      (same regex as socket handshake logger), validateSession -> 200 {username, elo} or
      401 {}. Thin route. T31 row: valid cookie -> 200 username; absent/bogus -> 401.
- [x] 7. index.js GET /account: sessionID cookie -> user (same lookup as the socket
      handshake log); else redirect to /. Renders account.ejs with
      {username, elo, games:[{date, opponent, result: win|loss|draw (from MY view),
      method:'стандартная', eloBefore, eloAfter}], played} newest-first, computed in the
      route (thin). account.ejs placeholder renders the data minimally. npm test green.
      NOTE: step 7's npm test first run failed once on a REPLAY/B4 parallel-load flake
      (known transient class, run.mjs 3s connect races); re-run was 64/64 green.
- [x] 8. test-chess.mjs T31 rows (temp DATA_DIR — runner's mkdtemp, same pattern F2 uses
      with USERS_CSV; never writes into a real data/ dir). 20 new rows:
      - games.csv F2 row (reg vs reg checkmate): one row, result white-win/black-win,
        reason checkmate, elo_before 1500/1500, elo_after = final CSV values
      - games.csv guest-vs-guest game end: row count unchanged (no row)
      - games.csv registered-vs-guest: one row, guest = '-' (null in parser), correct
        result/reason, elo 1500/0 before and after (unchanged — unrated)
      - invite:create failures: guest -> {reason:'auth'}; unknown -> 'no-user'; self -> 'self';
        method 'rapid' -> 'method-na' (all 4, in order, no invite:created)
      - invite:created {matchId} /^[a-z0-9]{8}$/
      - automatic `invites` push after authenticated auth contains the record (from/fromElo/
        method/matchId/createdAt)
      - invites:list returns only LIVE invites (1 while match alive, [] after it ends;
        record kept in RAM/JSON, filtered by the pool)
      - invite-bound join: guest -> gameNotFound (inviter seated, not yet started);
        wrong registered user -> gameNotFound; target user -> startGame(color 1);
        inviter -> startGame(color 0)
      - dead invite match id after end -> gameNotFound (graceful)
      - games.csv row for the invite game: A(white) vs B(black), resign -> white-win,
        elo_before 1500/1500, after = K-factor update values
      - GET /account without cookie -> 302 Location /; with cookie -> 200, contains
        username + current elo + opponent; game row renders opponent + per-view result
        (Победа) + elo 1500->final
      - GET /api/me: valid cookie -> 200 {username, elo}; absent -> 401; bogus -> 401
      Hardening: signinWithRetry helper (3x4s) for T31 + T30 seat-elo signins —
      the suite shares load with the concurrent e2e harness and a single 3s signin
      budget flaked under that load (2026-11-23, 2 separate runs).
      GATES: npm test run 9 and run 10 both 84/84 (84 = 64 pre-existing + 20 T31).
      (runs 2-8 had transient flakes in T30 seat-elo / T31 rg signin / B4 reconnect
      under parallel load — all resolved by the retry hardening; no server code
      changes after commit 9b813ce.)
- [x] 9. Final: full verification notes + commit log written below.

## Schemas as landed (filled in at each step)

- `data/games.csv` header:
  `ts,white,black,result,reason,white_elo_before,white_elo_after,black_elo_before,black_elo_after`
  - ts: ISO-8601 of endMatch; white/black: username or `-` (guest)
  - result: `white-win` | `black-win` | `draw` (agreed/threefold/insufficient/fifty/stalemate all -> draw)
  - reason: endMatch reason string verbatim (checkmate, stalemate, draw, threefold,
    insufficient, fifty, resign, challenge, opponent_disconnect)
  - elo before/after: read from the users.csv FILE before / after saveUsersFile's
    K-factor update (contract: captured before the update + after); guests -> `0` in
    all four columns. Row is written in endMatch exactly once (gameEnded guard +
    splice from pool), skipped for guest-vs-guest.
- `data/invites.json`: `[{"to": username, "from": username, "fromElo": int,
  "method": "standard", "matchId": "xxxxxxxx", "createdAt": iso}]` — JSON array,
  atomic rewrite on every createInvite (sessions.json pattern). Records of dead
  matches are KEPT; `listLiveInvitesTo` filters by the RAM match pool for the
  payload. Loaded at server start; corrupt/missing file -> [].

## Event payloads (T31, contract §Server socket events 2–5)

- Client -> server: `invite:create` {targetUsername, method} | `invites:list` (no args).
- Server -> client:
  - `invite:failed` {reason: 'auth'|'method-na'|'no-user'|'self'} — to the inviter.
  - `invite:created` {matchId: 'xxxxxxxx'} — to the inviter.
  - `invites` [{from, fromElo, method, matchId, createdAt}] — emitted on
    `invites:list` AND automatically right after a successful authenticated `auth`
    (fresh lobby page shows them without an extra round-trip). Only LIVE matches
    are listed; dead ones stay in the stored record.
  - `gameNotFound` (no args) — NEW in the AUTH path (new, T31): emitted when a
    well-formed invite-bound match id (^[a-z0-9]{8}$) is absent from the pool or
    the joiner is not invite.to/invite.from. Malformed/stale ids (T30: uppercase,
    short, integer) keep the silent-miss behavior (no emission).
- HTTP: `GET /account` -> 200 account page (username, elo, played, games newest
  first with per-view win|loss|draw) or 302 -> /. `GET /api/me` -> 200
  {username, elo} or 401 {} (lobby session restore, contract addendum).

## Commit log

- 81938ee docs: checkpoint 33 (S-A scope: games.csv, invites, /account) + account.ejs placeholder
- acd93f0 feat(server): T31 games.csv lib — append-only history + parser (DATA_DIR)
- 2b1dfff feat(server): T31 — games.csv in endMatch (elo before/after, guest-skip) + invites lib/events + invite-bound join + /account + /api/me
- 9b813ce fix(server): T31 — invite push in auth reads socket.data.user (scoped-const ReferenceError)
- (next) test(server): T31 — 20 rows: games.csv content (F2 row, guest-guest skip, reg-guest, invite game), invite:create failure reasons + created, automatic invites push, invites:list live/dead filter, invite-bound join (guest/wrong-user/target/inviter), /account (no cookie / with cookie / row data), /api/me (200/401/401) + signinWithRetry hardening for T30/T31 under parallel load
- 612bc5d docs: contract addendum — lobby session restore (S-A: GET /api/me) [orchestrator]
- 3c9869d feat(client): lobby big-button stack + invites + game link/invite + account page (contract 32) [S-B]

## Verification notes / could-not-verify

- VERIFIED: `node --check` on every touched js (src/index.js, src/lib/games.js,
  src/lib/invites.js, src/lib/matchmaking.js, test-chess.mjs) green after each commit.
- VERIFIED: `npm test` two consecutive green runs (run 9 and run 10): **84/84 passed,
  0 failed** (64 pre-existing + 20 T31). Perft: 13/13 EXACT both runs.
- VERIFIED: forbidden files untouched in MY commits — diff vs 81938ee touches only
  src/index.js, src/lib/games.js, src/lib/invites.js, src/lib/matchmaking.js,
  src/views/account.ejs, test-chess.mjs, checkpoints/33-a1-account-server.md.
  (S-B's concurrent commits 60bb6ac/3c9869d touched src/public/**, src/views/index.ejs,
  src/views/game.ejs, test/e2e-client.mjs — disjoint, expected.)
- VERIFIED: games.csv never written into a real data/ dir during tests — the runner
  points DATA_DIR at a fresh mkdtemp dir (test/run.mjs), and GAMES_CSV is derived
  from DATA_DIR (same as USERS_CSV). The temp dir is created fresh per npm test run.
- COULD-NOT-VERIFY: e2e/browser suite (test/e2e-client.mjs + test/e2e-gate.sh) — S-B
  owns those; the orchestrator runs the e2e gate after both agents land. My server-side
  contract for the client (invite:created {matchId}, invites payload, /account route,
  /api/me, gameNotFound on dead invite id) is covered by the 20 T31 unit rows but not
  by a real browser page load.
- COULD-NOT-VERIFY: actual browser navigation to /game?matchId=<invite.matchId> and
  the client-side invite-bound join UX (S-B's scope). Server-side: the auth path emits
  gameNotFound when the id is well-formed + invite-bound + absent/refused; a dead id
  after the match ends also emits gameNotFound (tested).
- NOTE for S-B: account.ejs placeholder was created by me (step 1) as a minimal
  stub; you may refine the markup to use the same server-provided fields
  (username, elo, played, games[{date, opponent, result, method, eloBefore, eloAfter}]).
  The /account route's response contains the username, elo, and opponent name — my T31
  rows assert on those substrings. If you restructure the markup, keep those three
  values in the rendered HTML so the T31 /account rows stay green.
- NOTE: the invite-bound join check in findPrivateMatch is a NEW third parameter
  (invite). Plain private matches pass `null` (no behavior change). The auth path
  resolves the invite via getInviteByMatch(matchId) BEFORE calling findPrivateMatch.
