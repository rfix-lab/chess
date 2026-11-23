# 34 — B1: client (lobby + game UI + account page + E2E harness)

Agent S-B (client). Code strictly to contract **checkpoints/32-contract-account.md**
("Client scope" section). Server side (S-A: src/index.js, src/lib/*) is built
CONCURRENTLY in the same worktree — do NOT wait for it; code to the contract
event names/payloads.

## Owned files (mine ONLY)
- src/views/index.ejs
- src/views/game.ejs
- src/views/account.ejs (refine S-A's placeholder if it lands; else build final
  markup against contract fields {username, elo, games:[{date,opponent,result,
  method,eloBefore,eloAfter}], played})
- src/public/** (js/css for lobby, game, account)
- test/e2e-client.mjs
- checkpoints/34-*.md

## FORBIDDEN (S-A owns)
- src/index.js, src/lib/**, test-chess.mjs, docker files
No branches, no push.

## Step checklist (update after each step; commit each change)
- [ ] S1 checkpoint file created (this file)
- [ ] S2 lobby index.ejs: big buttons [Вход]/[Играть] (>=56px) + [Регистрация]
      (same width ~40px); REMOVE private-link generation (button + #generated-link);
      invites section "Приглашения" rendering `invites` event (from, fromElo,
      method, accept link /game?matchId=); "Кабинет" link when logged in
- [ ] S3 lobby indexSockets.js: render `invites` rows; keep signin/signup
      listeners; drop private-match generation (index.js play/genLink); wire login
      -> show Кабинет
- [ ] S4 index.css: big-button stack sizing, invites section styling
- [ ] S5 game.ejs: #game-actions add "Ссылка на игру" + "Пригласить игрока"
      (guest-hidden) + disabled method <select> "Стандартная"; link modal
- [ ] S6 gameSockets.js: wire private-match echo -> modal with copy; invite:create
      -> invite:created navigate / invite:failed Russian reason; guest check via
      sessionID cookie
- [ ] S7 game.css: new buttons + link modal styling
- [ ] S8 account.ejs: table Дата|Соперник|Результат|Elo до|Elo после +
      "Сыграно партий: N" using theme vars (theme.js + themeToggle)
- [ ] S9 E2E harness: lobby no longer creates the private match — rework seating
      to a raw socket.io private-match from the harness + both pages via
      /game?matchId=<id>; keep ALL 46 rows green
- [ ] S10 gates: node --check each touched js + bash test/e2e-gate.sh <free-port>
      => 46/46 PASS (kill stragglers, verify port free)

## Gates (after each commit)
- node --check on every touched js
- bash test/e2e-gate.sh <free-port> => 46/46 PASS (kill stragglers, verify port free)
- npm test MAY be run but expect transient failures while S-A commits — ONLY the
  E2E gate is the hard gate; do NOT edit src/index.js to "fix" server-side breakage

## Commit prefix
feat(client): …  (incremental commits)
