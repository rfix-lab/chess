# 36b — S-B2 client: lobby actions, users directory, invite-by-method, method picker

Contract: `36-contract-ux3.md` (contract 36, UX round 3). Branch `feat/user-account`, stacked
on `a9cf2d9` (contract 36 doc), alongside S-A2's server work (`36a`, uncommitted in the shared
tree at the time this was written — see Scope boundary below). Self-gate: `node --check` on every
touched JS + `bash test/e2e-gate.sh <port>` **ALL PASS 60/60 on two consecutive distinct free
ports** (7912, 7913; `ss -ltn` checked first, stragglers killed by the gate).

All user-visible texts Russian, no emoji. All existing E2E rows kept green (47 base rows unchanged
behaviourally except the A1 adaptation below). +12 new rows (X1–X12).

## Commits (incremental, one per feature, NO push, NO new branch, NO baseline)
- `feat(client): T36 — lobby [Играть] creates a game immediately (private-match over the lobby
  socket -> /game?matchId=<id>#link); new [Пользователи] button -> /users (reuses the existing
  .big-btn class — no CSS change); [Вход]/[Регистрация] HIDDEN while logged in (restored on
  logout)` — src/views/index.ejs, src/public/js/index.js, src/public/js/indexSockets.js
- `feat(client): T36 — /users directory client (users.js + users.css): renders /api/users/stats
  rows, right-click / 500ms long-press invite menu with method choice (Классика/Рапид),
  invite:create via the handshake cookie, Russian toasts, self-row no-invite; wired into
  users.ejs (one <script> + the css link + </head> close)` — src/public/js/users.js (NEW),
  src/public/styles/users.css (NEW), src/views/users.ejs
- `feat(client): T36 — game page: method <select> ENABLED with Классика(standard)/Рапид(rapid);
  the invite button sends the selected method; landing on ?matchId=<id>#link auto-opens the link
  modal once after seating` — src/views/game.ejs, src/public/js/gameSockets.js,
  src/public/styles/game.css
- `test(client): T36 — 12 E2E rows X1–X12 (users directory, invite-by-method end-to-end, game-page
  method select, public profiles, stats, 404) + 4 isolated browser contexts; adapt the A1 row to
  also expect [Вход]/[Регистрация] hidden when logged in` — test/e2e-client.mjs
- `docs: checkpoint 36b (S-B2 client)` — this file

## Scope boundary (parallel with S-A2) — for the orchestrator's A2+B2 merge
- MY files (committed here): `src/views/index.ejs`, `src/views/game.ejs`,
  `src/public/js/{index,indexSockets,gameSockets,users}.js`,
  `src/public/styles/{game,users}.css`, `test/e2e-client.mjs`,
  `checkpoints/e2e-client-evidence.json`, `checkpoints/36b-*.md`. (index.css is unchanged —
  [Пользователи] reuses the existing .big-btn class.)
- ONE cross-scope touch: `src/views/users.ejs`. A2 owns it (36a) but its 36a checkpoint
  explicitly says "the client (S-B) may re-render rows from /api/users/stats in
  src/public/js/users.js". To actually load that JS the page needs one
  `<script src="js/users.js">` (plus the `users.css` link). I made the MINIMAL EJS edits for
  that: added the `users.css` link, added the `</head>` close (it was missing — see note below),
  and moved the `users.js` include from a deferred head tag to the END of the body. A2 should NOT
  commit a conflicting users.ejs independently; rebase A2's server commit set onto these client
  commits (or take mine for that one file). `src/views/user.ejs` I did NOT touch (the profile page
  is server-rendered, styles only — per contract point 4 "client JS: none needed").
- A2's files (NOT in my commits; leave for A2): `src/index.js`, `src/lib/games.js`,
  `test-chess.mjs`, `src/views/user.ejs`, `checkpoints/36a-*.md`,
  `checkpoints/a2-e2e-evidence.json`, `test/audit-a2-e2e.mjs`.

## Behaviour changes (client)
1. **Lobby [Играть] now creates the game immediately** (feedback: «кнопка "игра" ни к чему не
   приводит»). Old behaviour: [Играть] navigated to `/game` (public matchmaking) or to a
   pre-generated private link if one existed. New: clicking [Играть] emits `private-match` on the
   lobby socket; on the echoed matchId it navigates to `/game?matchId=<id>#link` (works for guests
   AND logged-in users — private matches are unauthenticated). The button is disabled while the
   echo is pending to stop double-creates from double-clicks.
2. **New [Пользователи] button** (same big-button stack, placed between [Играть] and [Вход]) ->
   `/users` (feedback: «на основной странице кнопка "пользователи"»).
3. **[Вход]/[Регистрация] are HIDDEN while logged in** and restored on logout (feedback: «кнопка
   вход не нужна, если я уже залогинился»). `indexSockets.js reflectAuthState()` now toggles both
   the Кабинет/Выход controls AND the two auth buttons off the `/api/me` restore + signin + logout
   state. Logged-out users keep them.
4. **Game page method selector is ENABLED** with two options — Классика (`standard`) / Рапид
   (`rapid`) (was a disabled single «Стандартная»). The invite button now sends the SELECTED method
   in `invite:create {targetUsername, method}`. Guest still has the invite button hidden (unchanged).
   NOTE: rapid does not yet change clocks (game has no clock) — the method is carried end-to-end
   for the future clock feature (matches A2's server note).
5. **`#link` deep-link**: when the game page loads at `?matchId=<id>#link` (the [Играть] path), it
   auto-opens the "Ссылка на игру" modal exactly once, after seating (on `startGame` or
   `reconnected`), then clears the hash so a reload doesn't re-open it.
6. **Invite row label now uses the Russian method label** — the lobby's invite rows read
   «…метод: Рапид» (was the raw method string) via a small `renderInvites` change (rapid -> «Рапид»,
   else «Классика»), consistent with the picker and the profile page.

## /users directory client (NEW: users.js + users.css)
- Loads `/api/me` (own username, to mark the self row) then renders the directory. PREFERRED PATH:
  ENHANCE the server-rendered rows in place (mark self, wire the invite menu) so the list is
  visible from first paint and never depends on a slow fetch. FALLBACK (only when the server
  rendered the empty skeleton): rebuild from `GET /api/users/stats`. Rows are clickable ->
  `/user?name=<username>` (the inner `<a>` and the row both navigate; a click on the link does not
  double-fire).
- **Invite context menu**: `contextmenu` (desktop right-click) OR a 500ms touch long-press (with a
  10px movement threshold so a scroll doesn't trigger it) on a row opens a small anchored menu —
  header «Пригласить <name>:» + method entries «Классика» / «Рапид». The self row's menu opens with
  no entries (no invite to yourself).
- Choosing a method: a logged-out click fails fast client-side via `/api/me` with toast
  «Сначала войдите» (server still authoritative — it answers `auth`). Logged-in: connects a
  socket.io client (the sessionID cookie rides the handshake; the /users page never emits 'auth',
  so the server resolves the user itself — A2's `resolveUserFromSocket`) and emits
  `invite:create {targetUsername, method}`. `invite:created` -> toast «Приглашение отправлено»;
  `invite:failed` -> a Russian reason toast (auth = «Нужно войти», no-user, self, method-na).
- `users.css` is an ADD-ON stylesheet loaded after `account.css` (the A2 shell's theme); it only
  adds what the account page lacks: row cursor/hover, the self-row accent, the context menu, and a
  page-local toast (the page has no game.css). Class names are the contract for D1
  (`.user-row`, `.user-self`, `.user-menu`, `.user-menu-item`).

## E2E (`test/e2e-client.mjs`) — 60/60 (47 existing + 12 new + 1 adapted)
New isolated contexts: `invitee`, `u1` (inviter), `u2` (fresh visitor), `u3` (third user, distinct
name for unambiguous profile opponent cells), `ghost` (no-cookie probes). New rows:
- X1: two (+u3) users registered for the flow (raw-socket signup+signin).
- X2: `/users` is PUBLIC (no-cookie guest) — the table renders AND `GET /api/users/stats` lists all
  three fresh users (elo 1500, 0 games) **in elo-desc/name-asc order** (asserted on the page row
  order: invitee < u1 < u3).
- X3: the invitee row on /users shows name | 1500 | 0 and is NOT marked self for the inviter.
- X4: right-click on that row opens the invite menu with the method choice (Классика / Рапид).
- X5: choosing «Рапид» -> `invite:create {method:"rapid"}` -> success toast «Приглашение
  отправлено» + server `invite:create: OK` line + the invites.json record carries method=rapid.
- X6: the invitee's LOBBY shows the pushed invite row — inviter name, Elo 1500, method «Рапид»,
  [Принять] -> `/game?matchId=<id>`.
- X7: the invitee accepts (joins) and u1 joins the same invite-bound match -> startGame delivered
  to BOTH (seating order sets colours; both reach "Playing as white/black").
- X8: the game page's method select is ENABLED with exactly Классика(standard)/Рапид(rapid).
- X9: a FRESH logged-in visitor opening the same match sees the same enabled select (2 options) —
  the probe is stored in sessionStorage so it survives the visitor's gameNotFound redirect.
- X10: after the two players play the mate to the end, BOTH public profiles list the finished game —
  opponent (the other username), the per-view result (winner «Победа» / loser «Поражение»), method
  label «Рапид».
- X11: `GET /api/users/stats` after the game — both users games=1, winner elo>1500, loser elo<1500.
- X12: `/user?name=<unknown>` -> 404 with the Russian «Пользователь не найден».
- C-err36: no JS console/page errors on the contract-36 pages (users, invitee lobby, game,
  profiles).

### Adaptation to an EXISTING row (contract-mandated change)
- **A1 (lobby restore-on-load)** now ALSO asserts [Вход]/[Регистрация] are HIDDEN in the logged-in
  state. Required because this contract makes a logged-in lobby hide those two buttons (feedback
  item 1); the row's old expectation (form hidden + Кабинет shown) still holds, the two-button check
  is additive. No other existing row changed behaviour.

## Cross-scope / unverified notes
- **users.ejs** is A2's file; I made the minimal EJS edits to load users.js + users.css (see Scope
  boundary). A2 should rebase rather than commit a divergent users.ejs.
- **u2/u3/invitee/u1 contexts share one browser** — isolated browser contexts (separate cookies +
  sessionStorage), so the X9 sessionStorage probe and the X6 push-to-lobby are per-context.
- The X6 method label («Рапид») depends on my `renderInvites` change; if D1 restyles the invite
  row markup they must keep the label text method-aware (the data is `inv.method` = 'rapid').
- Not browser-smoked here (left to the orchestrator per contract): the 500ms touch long-press is
  exercised only via the right-click path in E2E (headless has no touch by default); the touch
  handlers are wired but not driven by a touch device in the gate.
- Rapid-clock behaviour is intentionally OUT of scope (carried, not applied) — matches A2's note.
