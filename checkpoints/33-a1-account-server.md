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

- [ ] 1. Checkpoint file created + committed (with account.ejs placeholder).
- [ ] 2. src/lib/games.js: GAMES_CSV path (DATA_DIR/games.csv), appendGameRow() (header
      materialization + one append), loadGames() parser. node --check OK.
- [ ] 3. index.js endMatch: users.csv elo before/after captured BEFORE the K-factor update
      (and re-read after); games.csv row appended in endMatch exactly once per match
      (same code path as the gameEnd emissions, guarded by match.gameEnded):
      `ts,white,black,result,reason,white_elo_before,white_elo_after,black_elo_before,black_elo_after`
      — white/black = username or `-`; result = white-win|black-win|draw; skipped when
      both sides are guests (u1 && u2 both null). npm test green (64).
- [ ] 4. src/lib/invites.js: invites.json load at startup + RAM map + lazy persist
      (same pattern as sessions.json); createInvite / getInviteByMatch / removeInviteByMatch /
      listLiveInvitesTo (filters the RAM match pool — dead matches never shown, record kept).
- [ ] 5. index.js socket handlers: `invite:create` (auth -> method 'standard' -> target
      exists -> not self; failures emit `invite:failed` {reason: auth|method-na|no-user|self};
      success: genMatchId, unseated private match, createInvite, emit `invite:created`
      {matchId}); `invites:list` -> emit `invites` [live records addressed to me];
      automatic `invites` push right after any successful authenticated `auth`.
- [ ] 6. matchmaking.js findPrivateMatch: optional invite {to, from} param — invite-bound
      matches are joinable ONLY by invite.to (target; black, or white if seat is free) and
      invite.from (inviter; white/first seat); anyone else -> gameNotFound. Plain
      private matches (invite=null) keep open-join semantics. index.js 'auth' path passes
      getInviteByMatch(matchId). npm test green.
- [ ] 7a. (contract addendum 2026-11-23) index.js GET /api/me: parse sessionID cookie
      (same regex as socket handshake logger), validateSession -> 200 {username, elo} or
      401 {}. Thin route. T31 row: valid cookie -> 200 username; absent/bogus -> 401.
- [ ] 7. index.js GET /account: sessionID cookie -> user (same lookup as the socket
      handshake log); else redirect to /. Renders account.ejs with
      {username, elo, games:[{date, opponent, result: win|loss|draw (from MY view),
      method:'стандартная', eloBefore, eloAfter}], played} newest-first, computed in the
      route (thin). account.ejs placeholder renders the data minimally. npm test green.
- [ ] 8. test-chess.mjs T31 rows (temp DATA_DIR — runner's mkdtemp, same pattern F2 uses
      with USERS_CSV; never writes into a real data/ dir):
      - F2 reg-vs-reg game: row exists, elo_before=1500/1500, after = final CSV elo values
      - guest-vs-guest game end: row count unchanged (no row)
      - reg-vs-guest: row with `-` for the guest, correct result/reason, elo columns
      - invite:create failures: guest -> {reason:'auth'}; unknown -> 'no-user'; self -> 'self';
        method 'rapid' -> 'method-na'
      - invite:created {matchId} /^[a-z0-9]{8}$/
      - automatic `invites` push after authenticated auth contains the record (from/fromElo/
        method/matchId/createdAt)
      - invites:list returns only LIVE invites (1 while match alive, [] after it ends;
        record kept in RAM/JSON, filtered by the pool)
      - invite-bound join: guest -> gameNotFound; wrong registered user -> gameNotFound;
        target user -> startGame(color 1); inviter was seated white (startGame color 0)
      - GET /account without cookie -> 302 Location /; with cookie -> 200, contains
        username + per-view result + opponent
      npm test green twice (one re-run of a transient parallel-load failure allowed).
- [ ] 9. Final: full verification notes + commit log written below.

## Schemas as landed (filled in at each step)

- `data/games.csv` header:
  `ts,white,black,result,reason,white_elo_before,white_elo_after,black_elo_before,black_elo_after`
- `data/invites.json`: `[{to, from, fromElo, method, matchId, createdAt}]`

## Event payloads (T31, contract §Server socket events 2–5)

(see contract 32; examples added in step 5)

## Commit log

(filled in per commit)

## Verification notes / could-not-verify

(filled in at the end)
