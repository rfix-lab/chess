# 17 — B2 fix: click-to-move coordinate bridge (highlights + sync)

**Дата:** 2026-08-16, **статус:** fix готов, задеплоен

## Корневая причина (одна)
`selectPiece` (src/public/js/game.js, ~стр. 284) передавал движку `genLegalMoves(visualBoard, pos)` **сырую** доску и координаты. Движок (src/public/js/chessutils.js == серверная src/lib/chessutils.js) работает в **серверной ориентации**: белые пешки row 6 (y→y-1), чёрные row 1 (y→y+1), рокировка: `kingRow = turn==0 ? 7 : 0`.
Для чёрного локальная `board` повёрнута на 180° (gameSockets.js startGame/reconnected), т.е. чёрные пешки в **visual row 6**, а движок ждёт row 1 → `blackPawnMoveValidate` не выдаёт ни одного хода пешке; `kingMoveValidate` ищет короля на row 0 (визуально row 7) → рокировка никогда не подсвечивается.
Итог для чёрного: (1) неверная/пустая подсветка; (2) реально-легальная цель не входит в `legalMoveSquares` → клик не распознаётся как ход → `sendMoveToServer` не вызывается → **чёрный не может ходить кликом вообще** → «ход не синхронизируется у соперника». Белый не пострадал (его board = доска сервера, identity) — поэтому в прод-логах ровно 1 `move: APPLIED` (turn=0, e2→e4), дальше партия застывала.
Drag-путь (`display_possible_moves`, game.js ~455) **уже** делал visual→server→visual → drag у чёрного работал; фикс только для click-пути, в точности по drag-паттерну.

## Ребро (test/debug-b2.mjs, НЕ в git — test-*.mjs в .dockerignore/.gitignore)
- (A) selectPiece-путь, чёрный, пешка e7 (visual 3:6): **0 целей** (до фикса); реальная цель e5 (visual 3:4) НЕ подсвечивалась.
- (B) drag-путь, та же фигура: 3:4, 3:5 (e5, e6) — корректно.
- (C) ground truth движок на серверной доске: e7 → e5, e6.
- (D) белый selectPiece-путь: e2 → e3, e4 — корректно (потому белый ходил).
- (E) socket.io: белый e2-e4 + чёрный e7-e5 (серверные координаты) → оба клиента получили `validated` (rejected=false), т.е. **сервер и валидация корректны**; ломается только клиентская подсветка чёрного.

## Фикс
src/public/js/game.js `selectPiece`: при `my_color != 0` доска переворачивается 180° в server-ориентацию, `pos` → server-координаты, `genLegalMoves(...)` на serverBoard, целевые клетки переворачиваются обратно в visual для `legalMoveSquares`. White-ветка не тронута (identity).

## Верификация фикса
- `node --check src/public/js/game.js` OK.
- `npm test` → evergreen 35/35 + test-chess 36/36, exit 0.
- Скрипт-эмуляция нового selectPiece: black pawn e7 → e5, e6 (до: NONE); black king в позиции с рокировкой → c8, d7, d8, f7, f8, g8 — **в точности совпадает с ground truth** движка на серверной доске (рокировки c8/g8 теперь подсвечиваются; до фикса — никогда).

## Проверки гипотез
- H1 (is_being_validated не сбрасывается) — **опровергнута**: сброс в 6 местах (gameSockets.js 460 rejected-ветка, 495 validated, 299 gameEnd, 631/634/637 disconnect/connect_error/reconnect_failed).
- H3 (движок расходится) — **не является причиной B2**: C3 уже свёл bodies 1:1 (verify-c3-sync 27/27); расхождение было только в способе ВЫЗОВА (ориентация доски) — H4.
- H4 (координатный мостик) — **подтверждена**, см. корневая причина. `my_color` = 0/1 (turn-значение из startGame/color, НЕ бит цвета); flip `(7-x, 7-y)` математически корректен для 180°-поворота — проблема была в том, что flip в click-пути НЕ применялся к движку.

## Деплой
- `docker build -t cherry:latest` (elastic2) → image sha256:c6355cc31bfdb74a202e41b9d577eb93091f284bf2677ba5b2759fbc01e50bb9
- `docker save | gzip | ssh first docker load`, image ID сверен elastic2 == first
- `docker service update --image <sha> --force chess_cherry` (с elastic2), converged
- Verify: /index 200; sha256 serv-ed game.js == repo (647cea3f...); chess_cherry 1/1 healthy; [DEBUG] server started в свежих логах.
