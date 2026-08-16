# Chess (Cherry) — PLAN: реестр issue
**Создано:** 2026-08-15. Источник: 01-inventory-src.md, 02-inventory-root.md.
**Правило процесса:** 1 issue за ход → результат в `checkpoints/NN-<issue>.md` → обновление STATE.md → git-коммит.

## Легенда приоритетов
- **P1** — баг влияет на корректность игры или безопасность
- **P2** — качество/архитектура/рассинхрон
- **P3** — гигиена

## Реестр

| ID | Приор. | Заголовок | Где | Критерий готовности |
|----|--------|-----------|-----|---------------------|
| **C1** | P1 | Клиент: `isKingInCheck` undefined (ReferenceError) | src/public/js/chessutils.js:425,451 | Функция определена в клиентской chessutils; kingMoveValidate/castling-валидация не падают; evergreen-тест зелёный |
| **C2** | P1 | Клиент: king-side castling path check невалиден (требует [7] blank И rook; [5] не проверяется) | src/public/js/chessutils.js:437-440 | Подсветка ходов при O-O совпадает с серверной валидацией (проверка [5],[6] blank + [7]=rook) |
| **C3** | P2 | Синхронизация client/server chessutils (12 расхождений, 394 строки diff) | оба chessutils.js | Одна копия логики: либо shared-файл, либо client = точная копия server (diff = 0 по логике); validBoard-гвардей синхронен (server 560 vs client 486) |
| **S1** | P2 | XSS: username в innerHTML | src/views/index.ejs:31 | Текст через textContent / эскейп; проверка payload `<img src=x onerror=...>` |
| **S2** | P2 | Memory leak: завершённые матчи не удаляются из matches[] | src/lib/matchmaking.js:11, src/index.js (gameEnd-путь) | После checkmate/draw/resign матч вычищается; массив стабилен после N партий |
| **S3** | P2 | Нет персистентности: users/sessions в RAM | src/index.js:45, auth.js | Риск-приёмка: зафиксировать в README "stateless", ИЛИ sqlite/better-sqlite3 (решение от пользователя) |
| **T1** | P2 | Тесты неавтономны (требуют внешний :5500) + нет npm test | package.json, test-*.mjs, src/index.js | `npm test` поднимает in-process `app.listen(0)` и прогоняет test-chess + test-evergreen: 8/8 и 35/35 |
| **T2** | P1* | Typosquat `http@0.0.1-security` в dependencies | package.json | Пакет удалён из deps + lockfile; `npm ls http` пуст; сервер стартует |
| **T3** | P2 | Dockerfile без .dockerignore | Dockerfile | Создан .dockerignore (node_modules, tune, debug-*.mjs, checkpoints, .git); образ не содержит мусора |
| **T4** | P3 | 17 debug/trace-файлов в корне (1529 строк) | корень | Удалены (в .gitignore, не в VCS — история в errors/) |
| **T5** | P3 | Лишние builtins (assert, path), socket.io-client в prod deps | package.json | deps: bcrypt, ejs, express, socket.io; devDeps: socket.io-client |
| **T6** | P3 | errors/ + errors.md — шум | корень | Перенос в docs/archive/ (решение от пользователя) |
| **T7** | P3 | README устарел (bcrypt, Docker, аудит) | README.md | Секции: install (npm + Docker), auth, порт 5500, тесты |
| **H1** | P3 | Мёртвый src/lib/chessutils.js.bak (692 строки) | src/lib/ | Удалён |
| **H2** | P3 | Ложный коммент game.js:1 "no en passant, castling yet" | src/public/js/game.js:1 | Удалён |
| **H3** | P3 | console.log в клиенте indexSockets.js:4 | src/public/js/indexSockets.js | Удалён |
| **H4** | P3 | Магические числа (rate-limit, битовые маски, forfeit) | src/index.js:82,150-151,459,499,579 | Именованные константы |
| **H5** | P3 | readCookie/writeCookie дублируются в 3 файлах | index.js(client), gameSockets.js | Общий shared util |
| **H6** | P3 | package.json main: index.js (файла нет) | package.json | Поле удалено/поправлено |
| **H7** | P3 | Docker: node:18-alpine устарел, version 3.8 deprecated, no volumes | Dockerfile, docker-compose.yml | Обновить при следующем touch (после T3) |
| **C4** | P1 | РЕГРЕСС (найдено 2026-08-16 в проде после деплоя): гостевой матчмейкинг сломан — guest (sessionID=null) получает authFailed, матч не создаётся, оба на «Waiting for player...». Причина: `!sessionID \|\|` в auth-хендлере (e4f1b02, «fix 12 errors») — оригинал (ec52707) позволял гостей; README/UI обещают guest-режим. src/index.js:283 | src/index.js:283-286 | `sessionID && !validateSession(...)` — гость (пустой) проходит, невалидный непустой → authFailed; регресс-тест «2 guest → startGame both» в test-chess.mjs; npm test зелёный; прод задеплоен и гостевой матч работает |

\* T2 помечен P1-гигиена (security-скан), но не блокирует игру — в очереди после P1-багов.

## Очередь (рекомендованная)
1. **C1 + C2** (одна правка клиентской chessutils — один и тот же файл, один субагент)
2. **T2** (1 мин, security)
3. **S1** (XSS, 1 строка)
4. **C3** (синк client/server — самый объёмный, после C1/C2)
5. **T1** (автономные тесты — после C3, чтобы проверять оба движка)
6. **S2** (memory leak)
7. **H1+H2+H3+H4+H5+T4+T5** (гигиена — 1-2 батча)
8. **T3 + H7** (Docker)
9. **T6, T7, S3** (требуют решения пользователя)
10. **C4** (P1-регресс, найден post-audit 2026-08-16; в работе — гостевой матчмейкинг)

## Статус (2026-08-16)
- Закрыто: C1, C2, C3, S1, S2, S3, T1–T7, H1–H7 (16/16)
- Открыто: **C4** (P1, регресс гостевого режима; в работе, checkpoints/12-guest-auth-fix.md)
