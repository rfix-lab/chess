# Chess (Cherry) — аудит и починка — Состояние
**Обновлено:** 2026-08-15 09:20 MSK
**Выполнено:**
- Инвентаризация src/ — Готово (01-inventory-src.md, 19 файлов / 4691 строка)
- Инвентаризация корня (тесты/docker/docs/debug) — Готово (02-inventory-root.md)
- Верификация P1-находок по исходнику — Готово (isKingInCheck undefined + castling path bug подтверждены grep'ом)
- Декомпозиция на issues — Готово (PLAN.md)
- **C1 + C2 — DONE** (коммит `bb03f89`; 03-c1c2-client-chessutils.md): клиентская chessutils — добавлена isKingInCheck (1-в-1 с сервером, без export) + исправлен king-side castling path ([5],[6] blank + [7] rook; queen-side уже был верным). Верификация: verify-c1c2.mjs 6/6 (до — 0/6 ReferenceError), node --check OK, test-evergreen 35/35, diff только клиентская chessutils.
- **T2 — DONE** (коммит `c27d5b7`; 04-t2-s1-deps-xss.md): typosquat `http@^0.0.1-security` удалён из package.json + lockfile (http — builtin, `import http from 'http'` в src/index.js:3 работает без npm-пакета). Сервер стартует (`Live on 5599`), `npm ls http` — только артефакт `extraneous` в node_modules (уходит при любом npm install).
- **S1 — DONE** (коммит `c27d5b7`; 04-t2-s1-deps-xss.md): XSS username в innerHTML. ВАЖНО: код был НЕ в src/views/index.ejs (как в плане), а в `src/public/js/indexSockets.js:30` — `innerHTML` → `textContent`. `#auth-success` используется только для success-сообщения (без HTML), textContent корректен.
- **S2 — DONE** (коммит `c163cfa`; 06-s2-match-leak.md): memory leak — завершённые матчи не удалялись из matches[]. Централизованный `endMatch(match, reason, lostColor)` в src/index.js (12 точек завершения: checkmate/stalemate/draw×4/resign/challenge/forfeit в move + promotion:choose + drawResponse/resign/challengeResponse/disconnect): gameEnded flag → clearMatchTimers → сброс pending drawOffer/challenge/takeback → `removeMatch` по объекту (не по индексу, урок errors/02.err) → broadcast gameEnd (win/loss/draw). matchmaking.js: +removeMatch/clearMatchTimers, findMatch/findPrivateMatch пропускают gameEnded-матчи, новые matchId = maxId+1 (ранее matches.length — коллизии после splice: «матч 3 получает завершённый матч 1»). Reconnect в завершённый матч → gameNotFound (матча нет). Follow-up (C3): клиентский handler `gameNotFound` отсутствует в gameSockets.js. Верификация: verify-s2-leak.mjs 11/11, node --check OK, test-evergreen 35/35, старт :5597 OK.
**В работе:** ожидание выбора следующего issue
**Дальше:** очередь по PLAN.md: C3 (sync client/server) → T1 (автономные тесты) → S2 (memory leak) → H1..H7/T3/T5/T6/T7/S3
**Ключевые файлы:**
- checkpoints/01-inventory-src.md — инвентаризация src/ + техдолг + кандидаты
- checkpoints/02-inventory-root.md — инвентаризация корня + разбор test-chess + Docker
- checkpoints/PLAN.md — реестр issue с приоритетами и критериями готовности
- tune/chess-logic-audit.md — аудит игровой логики (2026-08-08)
- errors.md + errors/ — 30 исправленных багов (архив)
**Решения и контекст:**
- Движок (серверная src/lib/chessutils.js, 732 строки) — полный: castling, en passant, promotion, мат/пат, threefold, insufficient material, 50-move. test-evergreen 35/35 PASS.
- Клиентская копия (src/public/js/chessutils.js, 540) — РАСШЕДШАЯСЯ ВЕТВЬ (12 расхождений), 2 P1-бага: ReferenceError isKingInCheck (425,451), king-side castling path check невалиден (437-440: требует [7] одновременно blank И rook → king-side рокировка в подсветке никогда не проходит; [5] не проверяется вообще).
- test-chess.mjs 3/8 — 5 падений environmental (требуют сервер на :5500), не логики.
- 2026-08-15: maxTokens vllm 8000→35000 (openclaw.json); правило чекпоинтов в AGENTS.md.
- Гигиена: 17 debug/trace-файлов (1529 строк) мусор; http@0.0.1-security — typosquat в deps; .dockerignore отсутствует; .bak (692 строки) мёртвый.
