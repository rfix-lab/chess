# T5 — deps cleanup in package.json

**Дата:** 2026-08-16
**Итог:** deps = bcrypt, ejs, express, socket.io; devDeps = socket.io-client.

## Инвентаризация импортов (grep src/ + test/)
npm-пакеты, реально импортируемые:
- `bcrypt` — src/lib/auth.js
- `express` — src/index.js
- `socket.io` (Server) — src/index.js
- `ejs` — шаблонизатор, `app.set('view engine', 'ejs')` в src/index.js:88 (не через import — встроен в express)
- `socket.io-client` — ТОЛЬКО в тестах: test-evergreen.mjs:1, test-chess.mjs:1

Builtins (import без npm-пакета): assert, crypto, http, path, url, fs, child_process (тесты) — npm-пакеты для них не нужны.

## Изменения
Было в `dependencies`: assert, bcrypt, ejs, express, path, socket.io, socket.io-client
Стало:
- `dependencies`: bcrypt ^6.0.0, ejs ^3.1.8, express ^4.18.2, socket.io ^4.5.4
- `devDependencies`: socket.io-client ^4.8.3 (перенесён — используется только в тестах)
- удалено: `assert ^2.0.0`, `path ^0.12.7` (npm-обёртки builtins — не нужны)
- `scripts` не тронуто (test из T1 сохранён)

## Верификация
- `rm -rf node_modules && npm install` → чисто (ушёл и extraneous-артефакт от T2)
- `npm ls`: 5 пакетов (bcrypt, ejs, express, socket.io, socket.io-client) — нет missing/extraneous
- `npm test`: test-evergreen 35/35 PASS, test-chess 9/9 PASS, ALL TESTS PASSED, exit 0
- `node -e "JSON.parse(...)"` package.json — OK
- `PORT=5502 node src/index.js` → "Live on 5502", остановлен
- Dockerfile: `npm ci --production` — devDeps не попадают в образ; удалённые assert/path там не фигурировали. Dockerfile не менялся (H7).
- `git status --porcelain`: коммитятся ТОЛЬКО package.json + package-lock.json (STATE.md dirty — H-батч/аудит, не включал).
