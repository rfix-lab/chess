# 32 — CONTRACT: user account, lobby redesign, invites (owner request 2026-11-23 12:17)

Branch `feat/user-account` (stacked on `feat/round3-f3` head 375d48a, PR #2 still open —
PR #3 will include those commits until #2 merges; note it in the PR body).
Two agents work in the SAME worktree with DISJOINT files. This file is the interface
contract; deviation requires orchestrator approval. All UI texts in Russian (user-facing),
identifiers/events in English.

## Storage (data/ dir, same volume as users.csv — cherry_data)
- `data/games.csv` — append-only game history, header
  `ts,white,black,result,reason,white_elo_before,white_elo_after,black_elo_before,black_elo_after`.
  `white`/`black` = username or `-` (guest). `result` = `white-win|black-win|draw`.
  `reason` = the endMatch reason string (checkmate/resign/draw/timeout/...). One row per
  completed game IF at least one side is registered. Written in endMatch exactly once
  (guard: a match writes at most once — matches are spliced after end; use the same code
  path that already emits gameEnd).
- `data/invites.json` — `[{ "to": username, "from": username, "fromElo": int,
  "method": "standard", "matchId": "xxxxxxxx", "createdAt": iso }]`. In-RAM map + lazy
  persist (same pattern as sessions.json). Match itself lives only in RAM: accept after
  a server restart -> gameNotFound (graceful, existing path).

## Server socket events (all matchIds are opaque 8-char strings, T30 rules apply)
1. `private-match` (unchanged): any client (guest or user) -> server generates id, seats
   nobody yet (current semantics), echoes id. Lobby will NO LONGER call it; the GAME page
   button calls it (client scope).
2. `invite:create` {targetUsername, method} from an AUTHENTICATED socket only
   (socket.data.user else emit `invite:failed` {reason:'auth'}). Server:
   - method must be 'standard' for now ('rapid'/'custom' -> {reason:'method-na'});
   - target must exist in users, not be the inviter -> {reason:'no-user'|'self'};
   - generate matchId (genMatchId), create a private match NOT yet seated, store invite
     for target, emit to inviter `invite:created` {matchId};
   - inviter's client navigates to /game?matchId=<id> and joins as white via the normal
     auth(matchId) flow; target's link does the same and must additionally satisfy the
     invite check (see 4).
3. `invites:list` from an authenticated socket -> server emits `invites`
   [{from, fromElo, method, matchId, createdAt}] = stored invites addressed to this
   username that still reference a LIVE match (filter RAM pool); keep the stored record
   but never show dead ones. Also push `invites` automatically right after a successful
   authenticated `auth` (so a fresh lobby page shows them without extra round-trip).
4. Invite-bound join: in the auth/findPrivateMatch path, if a live match has an invite
   record, ONLY the socket whose socket.data.user.username === invite.to may join it as
   BLACK (others -> gameNotFound). The inviter joins as white by being the first
   participant (existing host-join branch) — matches created by `invite:create` store
   invite.matchId so the check can find it. Matches created via plain `private-match`
   keep current open-join semantics (no invite record).
5. History read: server route `GET /account` (cookie session; else redirect to /) renders
   `views/account.ejs` with {username, elo, games:[rows where I am white or black,
   newest first, each: date, opponent, result-from-my-view win|loss|draw, method:'стандартная',
   eloBefore, eloAfter], played} — computation server-side in index.js route (thin).

## Server file scope (agent S-A): src/index.js, src/lib/* (auth.js/invites.js/games.js as
needed), views/account.ejs MAY be a stub (S-B owns its markup; create a placeholder that
renders username/elo/games JSON if missing). FORBIDDEN: src/public/**, src/views/index.ejs,
src/views/game.ejs, test/e2e-client.mjs. Gate: node --check + npm test (+ new T31 rows:
games.csv written for registered-vs-guest and reg-vs-reg, absent for guest-vs-guest;
invite:create auth/no-user/self/method failures; invites:list live-filter; invite-bound
join refusal for wrong user and success for target; /account requires auth). Run npm test
twice; a single failure under parallel load may be re-run once before treating it real.

## Client scope (agent S-B)
### Lobby (views/index.ejs, public/js/indexSockets.js, public/styles/index.css)
- Big buttons stack, same width: [Вход] [Играть] each height >= 56px; below them
  [Регистрация] same width, height ~40px. [Играть] = guest play as today (goes to /game
  WITHOUT matchId) — when logged in it plays AS the user (auth sends sessionID already).
- Remove private-link generation from the lobby entirely (button + generated-link block;
  keep indexSockets' 'private-match' LISTENER only if still needed by tests — prefer
  removing the generation code and letting the GAME page own it).
- Invites: on `invites` payload show a section "Приглашения": each row "Имя (Elo N) —
  метод: стандартная [Принять]" -> link /game?matchId=...
- Add a link "Кабинет" visible when logged in (and a logout control if present today keep).
### Game page (views/game.ejs, public/js/gameSockets.js, public/styles/game.css)
- In #game-actions add button "Ссылка на игру": emits private-match, waits for echo id,
  shows modal/toast with `location.origin + '/game?matchId=' + id` and a copy button.
  Works for guests AND logged-in users.
- Registered-only button "Пригласить игрока": prompt username -> emit invite:create ->
  on `invite:created` {matchId} navigate current tab to /game?matchId=... ; on
  `invite:failed` show reason (нет такого пользователя / приглашение только для
  зарегистрированных / пока доступен только метод «стандартная»).
  Buttons must HIDE for guests (no user -> no invite button) — decide from the existing
  login state (sessionID cookie presence as today).
- Method UI: a <select> disabled with the single option "Стандартная" (rapid/custom later).
### Account page markup (views/account.ejs + its css): table Дата | Соперник | Результат |
Elo до | Elo после + header "Сыграно партий: N". Russian texts. Server renders data
(S-A stub -> you may refine markup to use the same server-provided fields).
### Harness (test/e2e-client.mjs): lobby private-match creation is gone — switch seating to
two guest pages opening /game?matchId=... created via a RAW socket.io private-match from
the harness (server event unchanged), or two plain /game pages (public matchmaking).
Keep ALL 46 existing rows green (S/H/M rows), adapt names only where the lobby changed.
Gates: node --check each touched js; npm test green; E2E (bash test/e2e-gate.sh <port>)
46/46 after your final commit. Do NOT run npm test and e2e simultaneously with the other
agent's heavy suite if ports collide — harness uses its own ephemeral ports, fine.

## UI language: Russian for all user-visible texts (keep ids/classes English).

## Addendum (2026-11-23 12:25, owner bug report): lobby loses login on refresh
Root cause (verified in HEAD 375d48a): server sessions are ALREADY persistent
(data/sessions.json since B6, 7-day expiry; client cookie 1 day). The LOBBY UI simply
never checks the cookie on page load: index.ejs renders the logged-out form unconditionally
and indexSockets.js has no restore-on-load; only the game page ever sends the cookie
(via 'auth'). Fix (no Redis):
- S-A ADD: HTTP `GET /api/me` — parses the sessionID cookie (same regex as the socket
  handshake logger, src/index.js ~256), validateSession -> 200 {username, elo} or 401 {}.
  Thin route, no new deps. T31 row: valid cookie -> 200 with username; absent/bogus -> 401.
- S-B ADD: on lobby load, fetch('/api/me'); on 200 render the logged-in state exactly as
  after signin (hide form, 'Вы вошли как <name>', Play as user, Кабинет/Выход visible);
  on 401 show the form (current default). Also verify the cookie survives F5 (writeCookie
  day=1 — yes) and that Выход clears cookie + reloads.
