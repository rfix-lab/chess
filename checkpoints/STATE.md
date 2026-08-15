# Chess (Cherry) — аудит и починка — Состояние
**Обновлено:** 2026-08-15 08:55 MSK
**Выполнено:**
- Инвентаризация src/ — Готово (01-inventory-src.md, 19 файлов / 4691 строка)
- Инвентаризация корня (тесты/docker/docs/debug) — Готово (02-inventory-root.md)
- Верификация P1-находок по исходнику — Готово (isKingInCheck undefined + castling path bug подтверждены grep'ом)
- Декомпозиция на issues — Готово (PLAN.md)
**В работе:** ожидание выбора issue от пользователя (рекомендация: C1)
**Дальше:** очередь по PLAN.md: C1 → C2 → S1 → T2 → T3 → B1 → ... (см. PLAN.md)
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
