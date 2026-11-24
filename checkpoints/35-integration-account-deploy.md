# 35 — Integration & deploy: user account (contract 32)

## Inputs
- A1 server (runId 7adc32c7 + addendum 660c968e): commits 81938ee..a21c477 — games.csv lib, invites lib/events, invite-bound join, /account, /api/me, T31 x20 rows. Self-gate 84/84 x3.
- B1 client (runId 654d8705 + addendum 9d61c07d): commits 60bb6ac..807db30 — lobby stack, game link/invite buttons, account page, harness re-seat via raw socket, A1 restore E2E row. Self-gate 47/47.

## Orchestrator gates (me, at 807db30)
- npm test: 84/84 PASS.
- bash test/e2e-gate.sh 6361: 47/47 PASS.

## Browser smoke of unverified paths (test/tmp-smoke-invite-account.mjs, chromium)
Signup x2 (raw) -> lobby restore via cookie -> A invites B from game page (prompt dialog) ->
B lobby shows "Имя (Elo 1500) — метод: стандартная [Принять]" -> accept seats B black ->
B resigns -> games.csv `ts,alpha,bravo,white-win,resign,1500,1516,1500,1484` ->
/account lists the game («Победа», elo before/after), no console errors. 8/8 PASS.

## Defects found by the smoke, fixed in 40f2cbd
1. invites:list was gated on socket.data.user, but the LOBBY socket never emits
   'auth' (only the game page does) -> target never saw invites until reload.
   Fix: resolve user from the handshake cookie (same regex as the connection
   logger) and cache into socket.data.user.
2. Real-time delivery: on invite:create success push `invites` to every socket
   attributed to the target username (open lobby receives it without reload).
3. Pre-start opponent_disconnect (B3 path, zero moves) wrote a games.csv row ->
   ghost games polluted /account. Fix: skip the row when reason is
   opponent_disconnect AND moveHistory is empty; client gameEnd unchanged (B3
   rows still pass); T31 rg row (resign at zero moves) still written.
4. /favicon.ico 404 console error: added src/public/favicon.svg + <link rel="icon">
   in all three views.

## T32 (test-chess.mjs, +3 rows): bogus cookie => no invites payload; lobby-style
socket (no 'auth', polling handshake cookie) receives live invite; pre-start
disconnect writes no CSV row. Unit gate after fixes: 87/87. E2E rerun: 47/47.

## Deploy
- Image cherry:latest 5b042640 built on elastic2, `docker save|ssh first docker load`,
  `docker service update --force chess_cherry` (manager = elastic2; `first` is a worker).
- Transient 404 for ~1 min after converged (known B-notice); then /index /game
  /favicon.svg /js/indexSockets.js all 200; live indexSockets.js carries /api/me
  restore; /api/me -> 401 (no/bogus cookie); favicon md5 matches repo.
- Prod data note: data/games.csv now written on first rated game end; sessions.json
  count=20 loaded — login cookies survive restarts (no Redis needed for one replica).

## PR
- https://github.com/rfix-lab/chess/pull/3 — feat/user-account -> baseline.
