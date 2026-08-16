# F3 — История ходов + проигрывание партии (реплей) — Отчёт
**Дата:** 2026-08-16 (МСК), после F1+F2 (ac90570)

## Что сделано

### Сервер (src/index.js)
- `boardToFen(board, match)` — новая функция (в index.js, НЕ в chessutils.js, который нельзя трогать): сериализует доску в полный FEN (расстановка + ход + рокировки + en-passant + счётчики). Используется только для replay-снимков.
- Move-хендлер: в `match.moveHistory.push(...)` добавлены поля:
  - `piece` — значение фигуры (тип|цвет) с начальной клетки ДО chessMakeMove
  - `capture` — true при взятии ИЛИ en passant
  - `fen` — FEN-снимок ДО хода
  - `fenAfter` — FEN-снимок ПОСЛЕ хода
  `initMatch` уже инициализировал `moveHistory: []` (matchmaking.js:56) — не меняли.
- `promotion:choose`: после выбора фигуры переписывает `fenAfter` последнего элемента moveHistory (pawn ещё на последней ранге на момент снимка в move-хендлере).
- `endMatch`: после gameEnd emit'ов обоим живым socket'ам — `socket.emit('replay', normalized)`. Нормализация:
  ```js
  { n: 1, color: 0, piece: 0b0001, capture: false,
    from: {x:4, y:6}, to: {x:4, y:4}, san: "e2-e4",
    fen: "RNBQKBNR/...", fenAfter: "RNBQKBNR/...e6 0 1" }
  ```
  `color` = ходивший (turnBefore), `san` = файл(from)+ранг(from)+('-'|'x')+файл(to)+ранг(to), ранг = 8-y. `n` = 1-based на каждый полуход.

**Источник снимков для реплея: FEN с сервера** (предпочтительный вариант по брифу) — клиент НЕ пересчитывает позицию движком, просто `fen_to_board(fenAfter[n])` + `draw()` + `render_board()`.

### Клиент (src/public/js/gameSockets.js + src/views/game.ejs)
- `socket.on('replay', moves)`: сохранение в localStorage (`replay_<matchId>` = JSON + `replay_<matchId>_ready = true`) — переживает перезагрузку; если gameEndModal уже открыт — сразу `showReplay()`.
- UI в `#gameEndModal` (game.ejs): `#replay-box` с `#replay-controls` (⏮ / ▶ Play / ⏸ / Next ⏭ / ⟲) и `#replay-list` (ul/li: «n. иконка san», активный ход — bold + цвет, autoscroll). Кнопка Back to Lobby получила id `replay-back-lobby` и onclick-обёртку: перед переходом в лобби чистит localStorage-ключи реплея текущего matchId.
- Логика (только gameSockets.js, движок/game.js не тронуты):
  - `PIECE_ICONS` — Unicode-маппинг по low 4 бита, индекс по цвету-биту 0b1000
  - `applyReplayPosition(idx)`: idx=0 → `fen_to_board(start_fen)`; иначе → `fen_to_board(replayMoves[idx-1].fenAfter)`; затем `draw()` + `render_board()` (существующие функции game.js, без их изменения). Ротация доски для чёрных не мешает: board — тот же объект, который читают draw/render_board.
  - Play: setInterval 1000 мс, до конца → stop; Pause — stop; Prev/Next — ±1 (Prev от 0 остаётся в стартовой позиции); Reset → 0. Ручная навигация останавливает автопроигрывание.
  - Пустой массив (resign без ходов) — replay-box не показывается, ничего не падает.

### Тесты (test-chess.mjs, in-process)
- **T-REPLAY**: 2 гостя → полный матч до checkmate (scholar's mate, 7 полуходов) → ассерты:
  - оба клиента получили `replay` (массив), `moves.length >= 4`
  - `moves[0]` = { color: 0, san: 'e2-e4' }
  - каждый элемент: n (1-based), color ∈ {0,1}, piece (number), capture (bool), from/to {x,y} (number), san (string)
  - san совпадает с regex `^[a-h][1-8]([-x])[a-h][1-8]$` И с рекомьютером по from/to (файл+ранг+оператор)
  - последний ход: color=0 (белые) = победитель (чёрные мотованы)
  - истории обоих клиентов идентичны (JSON-равенство)
- **T-REPLAY-EDGE**: дегенеративный кейс — 2 гостя, 0 ходов, resign → replay = `[]` обоим, gameEnd reason=resign, без краха.

## Верификация
- `npm test`: **evergreen 35/35 + test-chess 36/36 (25 старых + 11 новых), exit 0**
- `node --check`: src/index.js, src/lib/matchmaking.js, src/public/js/gameSockets.js, test-chess.mjs — OK (matchmaking.js не менялся, проверен)
- EJS-рендер: `replay-box` присутствует в выводе game.ejs
- **Деплой:** docker build cherry:latest = `sha256:2ccc3067f15e962590c92e09d091db69221f2b4463f6e692d2cc0050b67c9887`; docker save|gzip|ssh first docker load; `docker service update --force chess_cherry` → converged; контейнер на first: `Up (healthy)`; image id на elastic2 == first (2ccc3067…); `curl https://mycheserv.duckdns.org/index` → **200 ×5**; /game?matchId=1 → 200, replay-box на странице
- **Прод-репро** (2 гостя через mycheserv.duckdns.org): 4 валидных хода (e4 e5 Nf3 Nc6) → resign → gameEnd {resign, loss/win} → оба клиента получили `replay` (4 хода, идентичные) → **REPLAY OK**
- **Не тронуты:** chessutils.js (client+server), game.js, auth.js, test/run.mjs, test-evergreen.mjs
