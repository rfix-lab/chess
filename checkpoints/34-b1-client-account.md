# 34 — B1: client (lobby + game UI + account page + E2E harness)

Agent S-B (client). Code strictly to contract **checkpoints/32-contract-account.md**
("Client scope"). Server side (S-A: src/index.js, src/lib/*, test-chess.mjs) was
built CONCURRENTLY in the same worktree — I coded to the contract event
names/payloads and did not wait for it, and did NOT edit src/index.js to fix
server-side breakage.

## Owned files (mine ONLY)
- src/views/index.ejs, src/views/game.ejs, src/views/account.ejs
- src/public/** (js/css for lobby, game, account)
- test/e2e-client.mjs
- checkpoints/34-*.md

## FORBIDDEN (S-A owns) — src/index.js, src/lib/**, test-chess.mjs, docker files
No branches, no push.

## Step checklist (all done)
- [x] S1 checkpoint file created (this file) — commit 60bb6ac
- [x] S2 lobby index.ejs: big buttons [Вход]/[Играть] (>=56px) + [Регистрация]
      (~40px) same-width stack; private-link generation removed from the lobby;
      "Приглашения" section renders the `invites` event (from, fromElo, method,
      [Принять] -> /game?matchId=); "Кабинет" + logout visible when logged in
- [x] S3 lobby indexSockets.js: mode-aware #form (login/signup), render `invites`,
      login -> show Кабинет; then dropped the lobby `private-match` listener
      (generation moved to the GAME page)
- [x] S4 index.css: big-button stack sizing, invites section, authed controls
- [x] S5 game.ejs: #game-actions adds "Ссылка на игру" + "Пригласить игрока"
      (guest-hidden) + disabled method <select> "Стандартная"; gameLinkModal
- [x] S6 gameSockets.js: private-match echo -> modal (location.origin +
      /game?matchId=<id> + copy); invite:create -> invite:created navigate /
      invite:failed Russian reason; guest check via sessionID cookie
- [x] S7 game.css: new buttons + #method-select + link-modal URL styling
- [x] S8 account.ejs refined from S-A's placeholder + account.css: table
      Дата|Соперник|Результат|Elo до|Elo после + "Сыграно партий: N" using the
      game theme vars + themeToggle (same fields S-A's route renders)
- [x] S9 E2E harness: lobby no longer creates the private match — seating now via a
      RAW socket.io private-match from the harness + both pages /game?matchId=<id>;
      all 46 rows kept green
- [x] S10 gates: node --check on every touched js + E2E gate 46/46 (x4, clean ports)

## UI commit 3c9869d
`feat(client): lobby big-button stack + invites + game link/invite + account page (contract 32)`
Files: index.ejs, game.ejs, account.ejs, indexSockets.js, gameSockets.js,
index.css, game.css, account.css.
Notes:
- Lobby: [Вход]/[Играть] each 60px tall (>=56), [Регистрация] 40px, all same width
  (min(92vw,420px)). Private-link generation removed (the generated-link <a> is
  gone from the DOM). "Приглашения" section + rows from the `invites` event;
  "Кабинет" + "Выйти" shown when the sessionID cookie is present.
- Game: "Ссылка на игру" (all players) emits private-match, on echo shows a modal
  with the full URL + Копировать; "Пригласить игрока" (registered only — hidden for
  guests via the sessionID cookie) prompts a username, emits invite:create, on
  invite:created navigates to /game?matchId=, on invite:failed toasts the Russian
  reason (auth/no-user/self/method-na per contract); a disabled method <select> with
  the single option "Стандартная".
- Account: final markup (refined S-A's stub to the real table + "Сыграно партий: N",
  theme vars + theme toggle); server-provided fields unchanged
  ({username, elo, played, games:[{date,opponent,result,method,eloBefore,eloAfter}]}).

## Harness commits 4911162 (seating) + d17a3b7 (hardening)
`feat(client): E2E harness — lobby no longer creates the private match` and
`feat(client): harden E2E move-driver against client turn-propagation races`.
How the seating changed: the white player's page no longer opens /index, clears
storage, calls genLink() and reads window.__privateMatchId. Instead the harness
opens a RAW socket.io client to the server (io from the project node_modules),
emits 'private-match', resolves the matchId from the echoed 'private-match'
event (server event unchanged: the generator socket receives the id), then
closes that raw socket (its disconnect would otherwise end the not-yet-seated
pre-start match) and navigates BOTH guest pages to /game?matchId=<id> — the white
page joins as white (host branch), the black page as black -> startGame on both.
All 46 existing rows kept; row labels that referenced "lobby" now say "white"/"black".

### Seating-race hardening (why d17a3b7)
The raw-socket seating has LESS latency than the old lobby detour, so two client
propagation races the old harness had hidden surfaced: (a) a fast turn flip reached
the mover before its board updated -> the click was REJECTED as out-of-turn and the
mover desynced (seen at M6/M7 on port 6323, and at M1 on port 6327); (b) a
draw-loop race could blank the from-square right before the click. Fix (harness
only, no server edit): before each move wait for the MOVER page's own `can_move`
flag (the client's "it's my turn" flag that gates input — NOT the status text, which
is "Playing as white" at seat time and would deadlock step 1) plus an idle state,
and log an H-stale diagnostic row if the from-square is blank after that wait.

## Gates (per commit)
- node --check: indexSockets.js, gameSockets.js, e2e-client.mjs — all clean
- E2E (the HARD gate): bash test/e2e-gate.sh <free-port>
  - 6321 => 46/46 PASS (after the initial UI+harness pass)
  - 6323 => 32/52 (turn-propagation desync at M6 — before the fix)
  - 6331 => 46/46, 6333 => 46/46, 6335 => 46/46 (after can_move fix)
  - 6337 => 46/46 (final, on the committed state)
  All stragglers killed, port verified free each time.
- npm test (informational, NOT my hard gate): 83/84 — the single failure is a
  SERVER-side row "B4: F5 reconnect: notFound=true recon=null" in S-A's
  test-chess.mjs (src/index.js reconnect race), expected transient while S-A commits.

## Commit list (mine, on feat/user-account)
- 60bb6ac feat(client): checkpoint 34 — B1 client scope step checklist
- 3c9869d feat(client): lobby big-button stack + invites + game link/invite + account page (contract 32)
- 4911162 feat(client): E2E harness — lobby no longer creates the private match (contract 32)
- d17a3b7 feat(client): harden E2E move-driver against client turn-propagation races

(Interleaved S-A commits in the same worktree: 81938ee, acd93f0, 2b1dfff, 9b813ce,
275aa26, a21c477 — all `feat(server)`/`fix(server)`/`test(server)`/`docs`; note
275aa26 captured my raw-socket seating edits since we share the worktree, which is
why I also commit 4911162 for that same change so my scope is self-documenting.)

## Could NOT be fully verified (need the server side)
- Invite flow END-TO-END in a real browser: "Пригласить игрока" -> invite:created
  navigate + invite:failed Russian reasons, and the lobby "Приглашения" section
  rendering — the client emits/listens with the exact contract names and I unit
  smoke-tested the JS, but the SERVER emit of those events (invite:created/
  invite:failed/invites) was being committed concurrently, so I did not drive the
  full invite round-trip headlessly.
- Account page with LIVE data: the /account route + games.csv + games table were
  rendered via a standalone ejs render with contract-shaped fixtures and the client
  markup matches the exact fields S-A's route passes; the live end-to-end (a
  finished game appearing in Кабинет) is covered by S-A's T31 /account rows
  (84/84 in their committed run) but I did not own those assertions.
- npm test: 1 server-side row (B4 F5 reconnect) was failing during my window —
  expected transient, not attributable to the client.

## Final gate line
E2E (hard gate): **46/46 rows PASS** (bash test/e2e-gate.sh, ports 6331/6333/6335/6337 all green).
