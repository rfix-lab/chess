# 36a — S-A2 server: lobby actions support, users directory, public profiles, method picker

Contract: `36-contract-ux3.md` (contract 36, UX round 3). Branch `feat/user-account`, stacked on
`a9cf2d9` (contract 36 doc). Self-gate: `npm test` ALL PASS x2 consecutive (87 base + 14
T33/T33b rows = 101/101).

## Commits (incremental, one per feature, NO push)
- `46a00df` feat(server): T33 — games.csv optional 10th method column (standard|rapid; legacy 9-col files load as standard) — src/lib/games.js
- `c7f85af` feat(server): T33 — shared cookie->user socket resolver resolveUserFromSocket(); used by invites:list and invite:create (unauthenticated /users and lobby sockets); guest path silent — src/index.js
- `d57dfce` feat(server): T33 — invite:create accepts method standard|rapid (else invite:failed method-na); method stored on the invite AND copied to the match (match.method); GET /api/users/stats + GET /users (users.ejs) + GET /user?name= (user.ejs) + GET /api/users/:name/games — src/index.js, src/views/users.ejs, src/views/user.ejs
- `15b1020` feat(server): T33 — gameEnd carries the match method; CSV row writes it — src/index.js
- `341a90a` test(server): T33 + T33b — 14 rows (stats shape/order, /users 200, /user 200+rows, /user unknown 404, /api/users/:name/games, method picker standard|rapid, rapid end-to-end incl. games.csv 10th column + gameEnd method, legacy CSV -> standard, unauthenticated-socket cookie-fallback invite:create + blitz method-na + target cookie invites:list) — test-chess.mjs
- `f9afb33` feat(server): T33 — public profile view (user.ejs) — src/views/user.ejs
- `bf3dcdb` test(server): T33 — harden B3/B4 guest-lifecycle rows (event-driven waits) — test-chess.mjs
- `5bfd50c` test(server): T33 — kill the B3/B4/F2/REPLAY socket-alternation race — test-chess.mjs
- `docs: checkpoint 36a (S-A2 server)` — this file

## Endpoints / schemas landed
| Route | Status | Payload |
|---|---|---|
| `GET /api/users/stats` | 200 | `[{username, elo, games}]` ALL registered users, sorted elo desc then username asc (localeCompare); `games` = games.csv rows where the user is white or black (guest rows use '-', so only registered sides match) |
| `GET /users` | 200 | renders `users.ejs` (public, no auth to view): table Имя \| Elo \| Игр, same sort order; rows are `<tr class="user-row" data-username=...>` with `<a href="/user?name=...">` (client S-B may re-render from the API and attach the context menu) |
| `GET /user?name=<u>` | 200 / 404 | renders `user.ejs` (public profile): header name+Elo+played count; table Дата \| Соперник \| Результат \| Метод, newest first; opponent = the OTHER side of the row (guest shows '-'); result is per-view (win/loss/draw -> Победа/Поражение/Ничья); method label is Russian («Классика»/«Рапид»); unknown user -> 404 page with «Пользователь не найден» |
| `GET /api/users/:name/games` | 200 / 404 | `[{date, opponent, result: win\|loss\|draw, method: <label>}]` newest first; 404 `{}` for unknown name (client E2E can assert JSON) |

## Socket changes
- `resolveUserFromSocket(socket)` (NEW, src/index.js): `socket.data.user` cache first; on miss,
  validates the handshake `sessionID` cookie via `validateSession` (same call as /api/me and the
  connection logger) and caches the result. Guest path silent (no dlog) per contract point 1.
  Used by `invites:list` (was inline) and `invite:create` (NEW — the /users page never emits
  'auth', so the cookie fallback is required for the directory's invite action).
- `invite:create`: now accepts `method: 'standard' | 'rapid'` (reject others with
  `invite:failed {reason:'method-na'}`). The chosen method is stored on the invite record
  (invites.json) AND copied onto the created match (`match.method`).
- `gameEnd` payload: `{reason, result, method}` — `method` is `'standard' | 'rapid'` (matches
  without a method, i.e. public matchmaking and plain private matches, carry `'standard'`).
- **NOTE per contract:** rapid does NOT yet change clocks — the game currently has no clock at
  all. The method is carried end-to-end (invite -> match -> gameEnd -> games.csv) so the real
  clock feature can land later without schema churn. Clocks are NOT implemented here.

## games.csv schema
- Header now `...,black_elo_after,method` (10th, OPTIONAL). `GAMES_CSV_HEADER_LEGACY` keeps the
  9-column string; `loadGames()` accepts either header and defaults a missing 10th field to
  `'standard'` (backward compatible with existing files — T33 row asserts a hand-written
  9-column file loads with method 'standard' on every row).
- `appendGameRow` always writes the 10th column (method, defaulting to 'standard').
- `endMatch` writes `method: match.method || 'standard'`.

## /account note
`/account`'s per-row `method` label (previously the constant 'стандартная') now uses the shared
`methodLabel(g.method)` helper, so a rapid game shows «Рапид» there too. T31 rows did not
assert the old literal, so no base row changed; the bad-method case in T31 moved from
`method:'rapid'` to `method:'blitz'` (T33 made rapid valid — see Deviations).

## Views (S-A2 scope; D1 restyles later)
- `src/views/users.ejs` — NEW. Reuses the account page shell/styles (account.css classes) so the
  page renders correctly before D1. Table Имя | Elo | Игр; rows server-rendered from the sorted
  stats; each row `user-row` + `data-username`; Имя links to `/user?name=...`; empty state
  «Пользователей пока нет».
- `src/views/user.ejs` — NEW. Same shell. Public profile table Дата | Соперник | Результат | Метод
  (server-rendered; contract point 5: no client JS needed); 404 variant renders the same table
  empty with «Пользователь не найден». Back link to /users.

## Test rows (test-chess.mjs, +14)
- T33 stats: shape for ALL users; global invariants (elo non-increasing; name asc within each
  equal-elo group); the two newly signed-up users adjacent + in name order inside the 1500 group;
  ivA (1516 from the T31 resign win) ranks above the group and has games >= 1.
- T33 /users: 200 + Имя/Elo/Игр columns + new users present BEFORE ivA in document order.
- T33 /user unknown: 404 + «Пользователь не найден».
- T33 /user known: 200 + rows (opponent = ivA, per-view «Поражение», method label present).
- T33 /api/users/:name/games: 200 + `{date, opponent, result, method}` rows, newest first.
- T33 rapid end-to-end: invite:create method 'rapid' -> invite:created; invites.json record
  method=rapid; both sides join; target resigns -> games.csv row method=rapid + 10th CSV column
  'rapid' in the raw file + BOTH gameEnd payloads carry method='rapid'.
- T33 legacy CSV: hand-written 9-column file loads with method defaulted to 'standard' (both
  registered and guest rows).
- T33 final state: users.csv contains the new pair; games.csv has the rapid row alongside
  standard rows.
- T33b: on an UNAUTHENTICATED socket (handshake cookie only, no 'auth' — the /users page flow):
  `invite:create {method:'blitz'}` -> `invite:failed {reason:'method-na'}`;
  `invite:create {method:'standard'}` -> `invite:created` + stored record method=standard; the
  TARGET's own unauthenticated socket receives the live invite via `invites:list` on the
  cookie-resolved path.

## Deviations / report-first notes
1. **T31 bad-method row adapted.** The T31 row asserted `invite:create method:'rapid'` fails with
   `method-na` (contract 32: standard was the only method). Contract 36 point 2 makes rapid
   valid, which would turn that row into an ACCEPTED invite and cascade into four T31 list
   assertions (push/list live/dead). Conservative fix: the T31 row now uses `method:'blitz'`
   (same code path, same expected `method-na`), with an inline comment pointing to T33. All other
   T31 expectations untouched. Contract point 6 keeps its own 'blitz -> method-na' row, so the
   semantics are still asserted twice.
2. **method labels use the user's picker wording** («Классика» / «Рапид») for the NEW
   /user + /api/users/:name/games surfaces, and /account was switched from the old constant
   «стандартная» to the same labels for consistency. If the orchestrator wants /account to keep
   «стандартная», it is a one-line revert in `methodLabel` (the T31 rows do not assert either
   literal on /account).
3. **`/api/users` (autocomplete) left as-is** (name-prefix list) — the contract only adds
   `/api/users/stats`, `/users`, `/user`, `/api/users/:name/games`.
4. **`match.method`** is set at invite creation on the invite-bound match object (not in
   matchmaking.js — the match object is built in index.js's handler); public matches and plain
   private matches never set it (undefined -> 'standard' everywhere it is read).
5. The untracked orchestrator files `checkpoints/a2-e2e-evidence.json` /
   `test/audit-a2-e2e.mjs` are pre-existing in the worktree and were left untracked (not this
   run's scope).

## Gates
- `npm test` (runner: perft 13/13 + evergreen + test-chess): **101/101 PASS** (87 base + 14
  T33/T33b). Self-gate met: 2 consecutive ALL-PASS runs (GATE-A load 1.12, GATE-B load 0.81),
  preceded by 8 consecutive 101/101 (4 normal + 4 DEBUG, load 0.55–1.36) after the race fix.

## Race fix (the real B4 F5 flake)
- **Symptom:** the `B4: F5 reconnect` row (and, only under the parallel-load runner, F2/REPLAY/
  B3) flaked: `gameNotFound` on reconnect, or a missing pre-start `gameEnd`.
- **Root cause:** the row assumed the *first-emitting* socket was WHITE. The two guest `auth`
  packets are two separate connections with no ordering guarantee, so under load the server can
  seat them in the opposite order (the `b4b`/`e2`/`r2` variable socket ends up WHITE). The move
  sequence was then routed by the wrong color → rejected `not-movers-socket` (or illegal on the
  wrong turn) → `moveHistory` stayed 0 → the disconnect handler's pre-start gate read it as
  pre-start and `endMatch` removed the match before the reconnect found it. DEBUG masked it by
  slowing the loop enough that the packets processed in connect order (why DEBUG runs passed 100%
  while normal runs flaked at load ≥ ~0.8).
- **Fix (`5bfd50c`):** every two-socket row now (a) waits for BOTH sockets to report their seat
  COLOR (the match id alone was set by the first `startGame` echo, before the second socket was
  seated), and (b) drives moves / picks the winner / reconnects by the socket the server actually
  gave color 0 — never by the variable name. B4's reconnect now carries color 0 explicitly, and
  B3's pre-start winner is the socket that stayed connected (no color keying needed). The 300 ms
  settle after the applied-move echo is kept as the second half of the F5 gap (server bookkeeping
  vs. the disconnect dispatch).
