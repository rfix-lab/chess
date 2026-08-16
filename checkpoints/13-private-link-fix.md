# C5 — сломанная приватная ссылка — фикс

**Дата:** 2026-08-16 ~14:15 MSK
**Статус:** DONE (коммиты `34fd5fd` + `bdebe01`; деплой + прод-репро OK)

## Корневые причины
1. `src/lib/matchmaking.js:107` — `startMatch(i)` индексировал `matches[i]` по matchId.
   matchId = maxId+1, а после splice завершённых матчей (S2) индекс ≠ id → `m = undefined`
   → `startGame` не уходил никому.
2. `src/public/js/index.js` — `play()` всегда шёл на `/game` (без matchId) → автор
   попадал в ОБЩУЮ очередь, а не в свой матч. B (гость по ссылке) зависал на
   «Waiting for player...» вечно.

## Изменения
- `src/lib/matchmaking.js` `startMatch(id)`: `matches.find(x => x.matchId === id)` +
  гвард `!m || !m.player1Socket || !m.player2Socket`. Call-sites (findMatch:76,
  findPrivateMatch:96) уже передавали matchId — не тронуты.
- `src/public/js/indexSockets.js` (~L84): в хендлере `private-match` запоминаем
  `window.__privateMatchId = matchId`.
- `src/public/js/index.js` `play()`: если `window.__privateMatchId != null` →
  `/game?matchId=...`, иначе `/game`. **`!= null`, не truthy:** первый приватный
  матч после рестарта получает id 0 (maxId=-1 → 0), и `if (id)` его бы отбросил
  (дегенеративный кейс; поймано локальным репро на свежем сервере).
- `test-chess.mjs`: новый блок T-PRIV (5 ассертов): A emit 'private-match' → matchId;
  B (гость) auth(null, matchId) — ждёт (startGame пока нет); A2 (гость, как Play
  автора) auth(null, matchId) → ОБА получают startGame с тем же id, цвета 0/1;
  бредовый matchId 999999 → никто не получает startGame.

НЕ тронуты: gameSockets.js, game.js, chessutils.js (движок).

## Верификация
- `node --check` — 4 изменённых файла OK.
- `npm test`: evergreen 35/35 (35/35 accepted) + test-chess 17/17, exit 0
  (было 12/12 до T-PRIV; +5 ассертов T-PRIV).
- Локальный репро (свежий сервер, matchId=0): PRIVATE LINK OK.
- **Прод-репро** через https://mycheserv.duckdns.org (после деплоя bdebe01):
  A 'private-match' → B auth(null,id) → A2 auth(null,id) → **PRIVATE LINK OK**
  (B и A2 получили startGame, цвета 0/1, тот же id).

## Деплой
- image `cherry:latest` = `sha256:41963431eacbb884d95864f93808f1cb0d410d68e073d9a28750af33d8838d07`
  (elastic2 == first), docker save|gzip|ssh first docker load, `docker service
  update --force chess_cherry` → converged, `Up (healthy)`, curl /index 5×200.

## Дегенеративный кейс
Матчи stateless (RAM): после рестарта maxId=0, id пересоздаются — покрывается T-PRIV
(свежий сервер в тесте, matchId = 2 после обычного матча из T1) + S2-тесты.
