# T2 + S1 — deps typosquat + XSS — результат
**Дата:** 2026-08-15

## T2 — Typosquat `http` в dependencies
- Убедился: http-модуль в коде — только builtin: `src/index.js:3: import http from 'http';` (grep по require/import 'http' — единственный хит; npm-пакет не нужен).
- **Удалено из package.json:** `"http": "^0.0.1-security",` (заметка: в плановом задании была `0.0.1-security` без `^` — фактическое значение в package.json было `"^0.0.1-security"`).
- `npm install --package-lock-only` — прошёл (lockfile обновили, 11 строк: узел node_modules/http + package.json-ссылка).
- `npm ls http` → `http@0.0.1-security extraneous` — это артефакт: пакет всё ещё физически лежит в node_modules (не переинсталлирован). В package.json и package-lock.json его больше нет (grep `0.0.1-security` по обоим файлам — 0 хитов). При любом `npm install`/собрании docker-образа node_modules пересоздаётся без него.
- `node -e "import('http')..."` → `http builtin OK: function`.

## S1 — XSS: username в innerHTML
- **Важное расхождение с планом:** кода `successDiv.innerHTML = 'Logged in as ' + usernameInput.value;` НЕТ в `src/views/index.ejs` — он в **`src/public/js/indexSockets.js:30`** (ejs-шаблон только обёртка `<div id="auth-success" class="hide"></div>`, вся логика логина — в клиентском js).
- **Старая строка (indexSockets.js:30):** `successDiv.innerHTML = 'Logged in as ' + usernameInput.value;`
- **Новая строка:** `successDiv.textContent = 'Logged in as ' + usernameInput.value;`
- Контекст проверен: `successDiv` (`#auth-success`) используется ТОЛЬКО для этого success-сообщения (без HTML-разметки) — textContent подходит без span/appendChild. Ошибки рендерятся отдельным статическим `#auth-fail`.
- Смежный (не в scope S1): `linkDiv.innerHTML = url` в indexSockets.js (~78) — url из `window.location.host + matchId`, не user-input; оставил, можно в T-очередь.

## Верификация
- `node -e "JSON.parse(...package.json...)"` → OK (валидный JSON).
- `PORT=5599 timeout 6 node src/index.js` → напечатал **`Live on 5599`**, сервер стартует штатно.
- `git diff --stat`: `package-lock.json | 11 -`, `package.json | 1 -`, `src/public/js/indexSockets.js | 2 +-` (3 файла, 13 строк удалено/1 изменено).
- `node_modules/http` физически остаётся до следующей `npm install` — harmless, не в VCS.

## Git
Коммит: см. STATE.md (fix: T2 — remove typosquat http dep; S1 — XSS username innerHTML→textContent).
