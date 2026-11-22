# 16 — DEBUG-логирование для прод-диагностики «игра не начинается»

**Коммит:** `54e5b39fbb60b1278aaaf277631dca31d4abdb91`
**Дата:** 2026-08-16 15:57 MSK
**Изменено:** `src/index.js` (+57), `src/lib/auth.js` (+10), `src/lib/matchmaking.js` (+14), новый `src/lib/debuglog.js` (12 строк). Только логирование, поведение не менялось (diff проверен построчно; существующие console.log сохранены).

## Включение
ENV-флаг: `DEBUG=1` (или `DEBUG=true`) в окружении процесса.
- Локальный smoke: `DEBUG=1 PORT=5591 node src/index.js`
- Docker prod: `docker service update --env-add DEBUG=1 chess_cherry` (или через compose `environment: - DEBUG=1` + redeploy). Без флага — вывод полностью отсутствует (ноль затрат).

## Как читать
```bash
docker logs --since 10m <container> | grep '\[DEBUG\]'
```
Формат: `[DEBUG] <ISO-timestamp> <тег>: key=value ...`. Все строки — один prefix, удобно grep'ить.

## Точки логирования
**Сервер / сокеты (src/index.js):**
- `server started: PORT, DEBUG, users loaded` — при listen
- `socket connect: id, sessionCookie yes/no, username` (username резолвится READ-ONLY из users[] по cookie sessionID — без side-effect'ов validateSession)
- `socket disconnect: id, username`
- `api /api/users GET status=200 prefix, returned=N` (autocomplete; users-csv write логируется в auth: signup OK / endMatch elo)

**Auth (src/index.js + src/lib/auth.js):**
- `auth signin attempt: username` (index.js, до bcrypt)
- `auth signin OK / FAIL reason=wrong-password` (auth.js)
- `auth signup OK / FAIL reason=invalid-username|username-taken|empty-password`
- `auth validateSession OK / FAIL reason=expired|unknown-session`
- `auth: guest (no sessionID)` / `auth: REJECTED (invalid/expired session) ... emitting authFailed`
- `auth: routing to findMatch / findPrivateMatch: matchId`

**Matchmaking (src/lib/matchmaking.js + index.js):**
- `matchmaking findMatch: seated as black in existing match matchId / created new match matchId, pool`
- `matchmaking findPrivateMatch: joined as black (host connected) / joined as white (host not connected yet) / NO MATCH found matchId, private-pool`
- `matchmaking startMatch: both seated, emitting startGame matchId / ABORTED (missing match or socket)` — это и есть «игра не начинается»: если ABORTED — причина видна (found/p1/p2)
- `private-match: created matchId`

**Move (src/index.js):**
- `move: REJECTED (no active match or game ended)` / `reason=invalid-coordinates` / `reason=illegal` (turnState, mover-is-p1, from/to)
- `move: rate-limited`
- `move: APPLIED matchId, turn, from, to`
- `move: pendingPromotion color`
- `promotion:choose: matchId, pieceType, color / REJECTED (no pending promotion)`

**Завершение:**
- `endMatch: matchId, reason, lostColor, turnState` → `resolved loser` → `elo update delta` (единая точка — все 12 путей завершения проходят через endMatch)
- `resign / challengeResponse: ACCEPTED / drawResponse: ACCEPTED`
- gameNotFound: `reconnect: gameNotFound reason=no-such-match|game-ended|slot-occupied` (все 3 ветки) + `reconnect: OK`

**Таймеры:**
- `timer: forfeit scheduled in 300000 ms matchId, socket` (при disconnect)
- `timer: forfeit timeout fired matchId, disconnecting-side` (срабатывание)
- draw-offer timeout в коде нет (предложение живёт до ответа) — таймеров только forfeit

## Проверки
- `node --check` — OK на всех 4 touched-файлах
- `npm test` — exit 0: evergreen 35/35 + test-chess 36/36 (runner: ALL TESTS PASSED)
- Smoke `DEBUG=1 PORT=5591 node src/index.js` + socket.io-client: при старте без ошибок, в stdout: `server started`, `socket connect` (guest), `auth: guest`, `auth: routing to findMatch`, `matchmaking findMatch: created new matchId=0`, `socket disconnect`, `timer: forfeit scheduled` — [DEBUG]-строки приходят. Процесс убит, smoke-client.mjs удалён.
- `git status` после коммита чистый (чужих pre-staged не было); diff = только `dlog(`/`log(` + импорт (проверен grep'ом: в diff нет изменений ветвлений — 2 единственных переписанных блока (move no-active-match, promotion:choose guard) — 1:1 с оригиналом, внутри только дlog).

## Как диагностировать «игра не начинается»
1. `docker logs --since 10m <c> | grep '\[DEBUG\]'` в момент попыток.
2. Ожидаемая цепочка для гостевого матча: `socket connect` → `auth: guest` → `routing to findMatch` → `findMatch: no open slot, created new match` (первый игрок) → `findMatch: seated as black` + `startMatch: both seated, emitting startGame` (второй).
3. Обрывы: `auth: REJECTED ... authFailed` (сломанная сессия), `findPrivateMatch: NO MATCH found` (битый приватный линк), `startMatch: ABORTED` (сокет второго игрока обломался между seating и start — плагин-кейс C5), `findMatch` без `startMatch` (один игрок в пуле — нормально, ждёт второго).
