# H-батч: H1, H2, H3, T4, T3 — выполнен

**Дата:** 2026-08-16
**Коммит:** один батч, только свои файлы (`git add` поимённо).

## Что сделано

### H1 — мёртвый бэкап
- Удалён `src/lib/chessutils.js.bak` (22 912 B, ~692 строки). В git-индексе не был (`*.bak` в .gitignore).

### H2 — ложный коммент в game.js
- `src/public/js/game.js:1` — удалена строка `// no en passant, castling, or advance drawing yet`. Ничего else не тронуто (diff = 1 строка).

### H3 — отладочный log в indexSockets.js
- `src/public/js/indexSockets.js:4` — удалён `console.log('signing valid: ' + valid);` (+ пустая строка). Единственный console.log в файле.

### T4 — 17 debug/trace-файлов (1529 строк)
- Удалены поимённо, каждый сверен с `checkpoints/02-inventory-root.md` (разделы/размеры/линии совпадают): check-check-debug.mjs, debug-kxh7.mjs, debug-after-bxh7.mjs, debug-qg6.mjs, debug-rxh7.mjs, debug-ba3.mjs, debug-qf6.mjs, debug-qf6-direct.mjs, debug-clean.mjs, trace-queen.mjs, debug-step.mjs, debug-castling.mjs, debug-move.mjs, debug-final-pos.mjs, debug-coords.mjs, castling-trace.mjs, trace-c1.mjs.
- Все не были в git-индексе (0 совпадений `git ls-files`), все были покрыты паттернами .gitignore.
- .gitignore НЕ тронут: паттерны debug-* / castling-trace.mjs / check-check-debug.mjs / trace-*.mjs / *.bak уже присутствуют.

### T3 — .dockerignore
- Файл уже существовал и полностью покрывает требуемые паттерны: `node_modules/`, `.git/`, `checkpoints/`, `tune/`, `debug-*.mjs`, `trace-*.mjs`, `check-*.mjs`, `test-*.mjs`, `*.bak` (плюс errors/, Dockerfile, compose). Переписывать не потребовалось; Dockerfile не трогался (H7).

## Верификация
- `node --check src/public/js/indexSockets.js` — OK
- `node --check src/public/js/game.js` — OK (standalone-валиден)
- `git status --porcelain` перед коммитом: в index только мои 2 файла (game.js, indexSockets.js) + этот отчёт; чужие изменения T1-агента (package.json, src/index.js, test-*.mjs, test/, checkpoints/07, STATE.md) не закоммичены
- Сервер: `PORT=5598 node src/index.js` → «Live on 5598», процесс завершён. Порты 5500/5597/5599 были свободны.
- docker build не запускался (не требуется).

## Итог
5 issue закрыты одним коммитом: 18 файлов удалено (17 debug + 1 .bak), 2 файла изменены (по 1 строке).
