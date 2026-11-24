# Contract 36 — UX round 3: lobby actions, users directory, public profiles, method picker

Owner: orchestrator (Полкан). Agents: S-A2 (server), S-B2 (client), D1 (designer, starts AFTER A2+B2
merge clean — do not touch files before your dispatch).
Branch: `feat/user-account` (continue stacking; NO push, NO branches, NO baseline).

## User feedback driving this round (verbatim, 2026-11-23)
1. «кнопка вход не нужна, если я уже залогинился» — [Вход]/[Регистрация] must be HIDDEN when logged in.
2. «кнопка "игра" ни к чему не приводит. Должна создаваться игра с ссылкой приглашением» — [Играть]
   must immediately create the game and surface the invite link.
3. «на основной странице кнопка "пользователи"» — lobby button [Пользователи] -> users menu:
   every user with Elo and games count. Right-click / long-tap on a user -> «Пригласить» with method
   choice (Классика, Рапид...). Click on a user -> public profile: whom they played, when, result.
4. Designer pass afterwards (D1): make it all beautiful; orchestrator reviews.

## Scope split (disjoint file sets, same rules as contract 32)
- S-A2: `src/index.js`, `src/lib/**`, `test-chess.mjs`, NEW `src/views/users.ejs`, `src/views/user.ejs`
  (server-rendered placeholders OK; D1/B2 may restyle later), checkpoints `36-*.md`.
- S-B2: `src/views/index.ejs`, `src/public/**`, `test/e2e-client.mjs` (users.ejs/user.ejs styling is
  allowed for B2 ONLY in `src/public/styles/`, not the EJS itself). Checkpoints `36b-*.md`.
- D1 (later): `src/views/**`, `src/public/**` styling/markup only, no behavior, no JS logic changes
  beyond class names? NO — no JS changes at all; CSS + EJS markup/classes only.

## S-A2 (server)
1. Shared session-user resolver: factor the cookie->user resolution (already in invites:list
   integration fix) into `resolveUserFromSocket(socket)`; use it for `invites:list`, `invite:create`,
   and any new socket handlers from unauthenticated-page sockets (the /users page has no 'auth').
   Cache result in socket.data.user. Keep the guest path silent.
2. `invite:create` method: accept `'standard' | 'rapid'` (reject others with 'method-na'). Store the
   real method on the invite and copy it to the match (`match.method`). games.csv gains an optional
   trailing `method` column (10th); `loadGames()` defaults missing -> 'standard' (backward compatible
   with existing files). gameEnd payload: add `method`. NOTE (state in checkpoint): rapid does NOT
   yet change clocks — the game currently has no clock at all; method is carried end-to-end so the
   real clock feature can land later without schema churn. Do NOT implement clocks.
3. `GET /api/users/stats` -> 200 `[{username, elo, games}]` for ALL registered users, sorted by elo
   desc then name asc; `games` = rows in games.csv where the user is white or black.
4. `GET /users` -> render `users.ejs` (simple table skeleton: Имя | Elo | Игр; markup minimal, D1
   restyles). Public page, no auth required to VIEW.
5. `GET /user?name=<username>` -> render `user.ejs`: public profile — table Дата | Соперник |
   Результат (+ method label) from games.csv for that user (opponent = the other column; guest '-'),
   newest first; unknown user -> 404 with a short Russian message. Also expose
   `GET /api/users/:name/games` with the raw rows (client E2E can assert JSON).
6. Tests (T33 rows in test-chess.mjs): stats shape+order; /users 200 html; /user 200 + rows; /user
   unknown 404; invite method rapid accepted + lands in invites.json + match + games.csv method col;
   method 'blitz' -> invite:failed method-na; legacy CSV line w/o method loads as standard.

## S-B2 (client)
1. Lobby (`index.ejs`, `indexSockets.js`, styles):
   - logged-in: HIDE [Вход] and [Регистрация] (restore on logout); logged-out keeps them.
   - [Играть]: create a game immediately — emit `private-match` over the lobby socket, on the echoed
     matchId navigate to `/game?matchId=<id>` AND append `#link` so the game page auto-opens the link
     modal once (gameSockets: if location.hash === '#link', open the modal after seat). Guests and
     users alike use this path (private match works unauthenticated).
   - add [Пользователи] button (same stack) -> `/users`.
2. Users page (`src/public/js/users.js` new + styles; page shell rendered by server at /users):
   - fetch `/api/users/stats`, render rows Имя | Elo | Игр (click on row -> /user?name=).
   - context menu: `contextmenu` on a row and long-press (500 ms touch) -> small menu with
     «Пригласить в игру»; opens a method choice (Классика / Рапид) -> connect socket.io (page has no
     auth event; the cookie rides the handshake) -> `invite:create {targetUsername, method}` ->
     `invite:created` = Russian success toast («Приглашение отправлено»); `invite:failed` -> Russian
     reason toast (auth = «Нужно войти», no-user, self, method-na). Logged-out click on «Пригласить»
     -> toast «Сначала войдите» (client-side check via /api/me; server still authoritative).
   - self row: no invite option.
3. Game page: method `<select>` becomes ENABLED with Классика/Рапид (value standard/rapid), the invite
   button sends the selected method. Guest: button stays hidden (unchanged).
4. Public profile page client JS: none needed (server-rendered); styles only.
5. E2E (`test/e2e-client.mjs`): adapt lobby rows to the new button behavior (the harness currently
   navigates to /game directly — keep, but the old rows referencing removed elements must be updated:
   e.g. D1-restore row must now also expect [Вход]/[Регистрация] hidden; [Играть] creates a match —
   assert row exists; NEW rows: /users lists the signed-up user with elo 1500 and long-press menu
   markup class present; /user?name= shows the page + invite method select on game page enabled).
   Keep ALL existing rows green; final gate `bash test/e2e-gate.sh <port>` ALL PASS x2 consecutive.
   NOTE: do not touch game.ejs/users.ejs/user.ejs themselves (D1 territory later); game.ejs IS B2's
   (same as contract 32) — correction: B2 owns index.ejs + game.ejs + public/**; users.ejs/user.ejs
   belong to A2 until D1.

## Gates (each agent, self-verified, report-first protocol as before)
- A2: `npm test` ALL PASS x2 consecutive (incl. new T33).
- B2: `node --check` all touched JS; E2E gate ALL PASS x2 consecutive on distinct free ports
  (ss -ltn check first; kill stragglers).
- Orchestrator afterwards: full gates, browser smoke (new lobby + users + invite-by-method),
  then dispatch D1, review designer screenshots, deploy, push (PR #3).
