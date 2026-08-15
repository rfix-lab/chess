# S2 — Memory leak: completed matches never removed from matches[]

**Issue:** PLAN.md S2 (P2). Массив `matches` (src/lib/matchmaking.js:11) растёт безbound:
единственный splice был в forfeit-таймере (index.js:575). Завершённые матчи (checkmate,
stalemate, draw по соглашению, resign, threefold, insufficient, 50-move, challenge→resign)
оставались в массиве навсегда. Вторая часть бага: findMatch/findPrivateMatch могли вернуть
завершённый матч новому игроку (matchId переиспользуется после splice → matches.length-based ID).

## Архитектура решения

**Центральный point of cleanup: `endMatch(match, reason)` в src/index.js**
(рядом с точками завершения — все 8 путей уже там). matchmaking.js остаётся хранилищем
(массив + find/init) и получает 2 примитива:

- `removeMatch(match)` — удаление **по объекту** (`indexOf`), не по индексу (урок errors/02.err:
  индексный доступ `matches[matchId]` ломался после splice; все обработчики уже используют
  `find(m => m.matchId === ...)`).
- `clearMatchTimers(match)` — clearTimeout всех `match.disconnectTimers` **до** установки
  gameEnded (порядок важен: guard-функция не должна пропускать cleanup).

`endMatch` последовательность: (1) gameEnded=true + reason (идемпотентный guard), (2) clearMatchTimers,
(3) обнуление pending-предложений (drawOffered/challengeFrom/takebackOffered — висевший в момент
завершения pending drawOffer чистится), (4) removeMatch, (5) broadcast `gameEnd` c персонным
`result: 'draw'|'win'|'loss'` (клиентский handler `gameEnd` в gameSockets.js читает data.result;
без этого broadcast localStorage-session не чистится, и reload после завершения пытался бы
reconnect в умерший матч → gameNotFound). Третий аргумент `lostColor` называет проигравшего
(resign/challenge/forfeit); для checkmate/stalemate ловер = `match.turnState`.

**Идентификаторы матчей:** `findMatch` теперь даёт новый матч id = `max(existing)+1` вместо
`matches.length` (после splice length-based ID коллидируют — сценарий «матч 1 завершён, матч 2
создан, матч 3 получает матч 1» именно отсюда). `private-match` уже так делал — теперь один путь.

**Двойные страховки (дёшево):** `findMatch`/`findPrivateMatch` пропускают `gameEnded`-матчи,
`startMatch` гвардится `(m && m.player1Socket && m.player2Socket)`.

**Reconnect-сценарий (по коду):** `socket.on('reconnect')` ищет матч по id → после endMatch матч
удалён → `!match` → `gameNotFound` (существующий путь, без изменений). Дополнительно:
`endReason = isGameEndReason(...)` покрывает только checkmate/stalemate — resign/draw/forfeit
уходят через удаление. Клиент: `gameSockets.js` НЕ имеет handler'а `gameNotFound` (gap,
зафиксировать в C3/follow-up: на gameNotFound/gameEnd — clearSession()).

**НЕ тронуто:** src/public/js/* (C3), src/lib/chessutils.js, src/lib/auth.js, `users` (index.js:45).

## Изменения

### src/lib/matchmaking.js
- (новое) `removeMatch(match)`, `clearMatchTimers(match)` — экспорт
- `findMatch`: +`if (matches[i].gameEnded) continue;`; новый матч: `maxId+1` вместо `matches.length`
- `findPrivateMatch`: +`if (match.gameEnded) continue;`
- `startMatch`: `const m = matches[i]; if (m && m.player1Socket && m.player2Socket) { ... }`

### src/index.js
- (новое) `endMatch(match, reason, lostColor)` после isRateLimited
- `move` handler: 4 отдельных блока (threefold/insufficient/fifty/endReason) → 1 `endMatch(...)`
- `promotion:choose` handler: то же самое (4 блока → 1 вызов)
- `drawResponse` (accept), `resign`, `challengeResponse` (accept): emit как раньше, затем `endMatch(...)`
  (resign/challenge — с `lostColor` для правильного win/loss в gameEnd broadcast)
- `disconnect` handler: `clearMatchTimers(match)` при disconnect (отменяет предыдущий forfeit-таймер);
  внутри 5-мин таймера: `if (match.gameEnded) return;` + `endMatch(match, 'opponent_disconnect', lostColor)`
  (вместо ручного splice — единая точка cleanup)
- Импорты: + `removeMatch, clearMatchTimers`

## Верификация
1. `node --check src/index.js` + `node --check src/lib/matchmaking.js` — **OK**
2. `node checkpoints/verify-s2-leak.mjs` — **11/11 PASS** (3→2, N=50 стабилен, gameEnded guard, maxId+1, idempotent remove, timer cancel, private reject)
3. `node test-evergreen.mjs` (server :5500) — **35/35 PASS**
4. `PORT=5597 timeout 6 node src/index.js` — `Live on 5597`, exit 124 (timeout) — **OK**
5. Reconnect-сценарий (по коду): `endMatch` → `removeMatch` → матч удалён из `matches[]` → `socket.on('reconnect')` находит `!match` → `socket.emit('gameNotFound')` → корректное отклонение. Клиентский gap: `gameSockets.js` нет handler'а `gameNotFound` (не чистит localStorage) → зафиксировано как follow-up (C3).

## Git

Коммит: `c163cfa` — fix: S2 — completed matches removed from matches[] (memory leak) + centralized endMatch
Файлы: src/index.js, src/lib/matchmaking.js, checkpoints/06-s2-match-leak.md, checkpoints/verify-s2-leak.mjs, checkpoints/STATE.md
(заполняется при коммите)
