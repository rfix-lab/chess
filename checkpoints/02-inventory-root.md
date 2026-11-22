# Chess (Cherry) — Инвентаризация КОРНЕВЫХ файлов

**Дата:** 2026-08-15 08:19 MSK
**Объём:** только корень `/root/proj/chess/` (каталог `src/` — за другим субагентом)

---

## 1. Корневые файлы

| Файл | Строк | Роль | Ключевое содержимое |
|------|-------|------|---------------------|
| `package.json` | 22 | Манифест npm | name=`cherry`, `type: module`, `start: node ./src/index.js`, 8 deps |
| `package-lock.json` | ~ (90 KB) | Лок-файл | lockfile v2, ~110 пакетов в `node_modules/` |
| `Dockerfile` | 8 | Docker build | `node:18-alpine`, `npm ci --production`, EXPOSE 5500, CMD `npm start` |
| `docker-compose.yml` | 20 | Docker Swarm deploy | image `cherry:latest`, 1 реплика, узел `first`, traefik `mycheserv.duckdns.org` (websecure/LE), порт 5500 |
| `README.md` | 46 | Документация | Описание Cherry (мультисервер шахмат), install `npm start`, порт 5500, GIF-демо; клонируется с `github.com/vnnm404/Cherry` |
| `test-chess.mjs` | 104 | Интеграционный тест | 8 проверок через 2 сокета на `localhost:5500`, 7 ходов (вкл. рокировку), disconnect |
| `test-evergreen.mjs` | 122 | Интеграционный тест | «Evergreen Game» (Андерссен–Дюфрезне 1852), 35 полуходов, требует сервер |
| `errors.md` | 281 | Реестр багов | 18 багов, все `[FIXED]` (5 критических, 5 high, 5 medium, 5 low) + план исправления по группам |
| `checkpoints/` | — | Чекпоинты | Рабочая папка аудита (этот файл + STATE.md и др.) |
| `.gitignore` | 4 | Игнор | `node_modules/`, Dockerfile, docker-compose.yml, `tune/`, `debug-*.mjs`, `test-*.mjs`, `*.bak` |

---

## 2. Каталог `errors/` (12 файлов, 388 строк суммарно)

Каждый `NN.err` = один найденный и **исправленный** баг (статус `FIXED ✓ VERIFIED OK`).

| Файл | Тема (1 строка) |
|------|-----------------|
| `01.err` | `match.gameEnded` не ставится перед авто game-end (move + promotion) |
| `02.err` | `matches[matchId]` ломается после `splice` (индексный доступ) |
| `03.err` | Клиентский en passant не проверяет двойной ход пешки (chessutils.js:190-227) |
| `04.err` | Клиентская рокировка: `kingRow` инвертирован (white=0/black=7) — critical |
| `05.err` | XSS: неэкранированный `matchId` в EJS (`game.ejs:13`) |
| `06.err` | Пароли plain text, session не валидируется (`auth.js`) |
| `07.err` | `turnToColor()` вернул 0b1000 для чёрных, `my_color=1` — сравнение всегда false |
| `08.err` | Клиентская подсветка ходов не поддерживает рокировку (null castlingRights + kingRow) |
| `09.err` | Клиентский `checkCheck()` не симулирует рокировку-ладью и en passant-взятие — major |
| `10.err` | Приватный матч: stale socket при отключении создателя до входа соперника — major |
| `11.err` | Поле пароля `type="text"` вместо `type="password"` (`index.ejs:23`) |
| `12.err` | Утечка памяти: `rateLimits` Map не чистится при отключении сокета |

**Вывод:** каталог = «архив закрытых багов». Не нужен в runtime; кандидат на архив/очистку (см. ниже).

---

## 3. Каталог `tune/` (2 файла, ~30 KB)

| Файл | Размер | О чём |
|------|--------|-------|
| `chess-logic-audit.md` | 18 033 B | Полный аудит игровой логики: рокировка, en passant, промошн, завершение партии. Ключевые файлы: `src/lib/chessutils.js`, `src/public/js/chessutils.js` (копия-субсет), `game.js`, `gameSockets.js`, `src/index.js`, `matchmaking.js`. |
| `tune.md` | 12 650 B | Список улучшений: git-правила (ветки `fix/`,`feat/` от `baseline`), мобильная адаптация, съеденные фигуры и т.д. |

**Вывод:** рабочая документация/планы, не runtime. В `.gitignore` (локально).

---

## 4. Debug/Trace-скрипты в корне (17 файлов, **1529 строк суммарно**)

Чистый отладочный мусор (в `.gitignore`), каждый — один точечный баг-трейс по игре Evergreen.

| Файл | Строк |
|------|-------|
| `check-check-debug.mjs` | 174 |
| `debug-kxh7.mjs` | 157 |
| `debug-after-bxh7.mjs` | 132 |
| `debug-qg6.mjs` | 127 |
| `debug-rxh7.mjs` | 111 |
| `debug-ba3.mjs` | 86 |
| `debug-qf6.mjs` | 86 |
| `debug-qf6-direct.mjs` | 85 |
| `debug-clean.mjs` | 83 |
| `trace-queen.mjs` | 76 |
| `debug-step.mjs` | 76 |
| `debug-castling.mjs` | 69 |
| `debug-move.mjs` | 67 |
| `debug-final-pos.mjs` | 77 |
| `debug-coords.mjs` | 39 |
| `castling-trace.mjs` | 37 |
| `trace-c1.mjs` | 47 |

**Оценка:** суммарно **1529 строк** одноразового debug-кода (17 файлов), все в `.gitignore`, не импортируются из `src/`. **Стоит удалить** (или перенести в `debug/`) — не несут ценности, засоряют корень.

---

## 5. `test-chess.mjs` — разбор по тестам (8 тестов)

Интеграционный тест: 2 сокета (`client1`, `client2`) на `http://localhost:5500`, `auth` (`sess_w`/`sess_b`), 7 ходов (e4 e5 Nf3 Nf6 Bd3 Bc5 O-O), затем disconnect + ход после disconnect.

| # | Тест | Без сервера |
|---|------|-------------|
| 1 | Client 1 connected | ❌ FALL (нет сокета) |
| 2 | Client 2 connected | ❌ FALL (нет сокета) |
| 3 | Match created | ❌ FALL (`matchId=null`) |
| 4 | All 7 moves accepted (incl. castling) | ✅ PASS (0 rejected — vacuous) |
| 5 | C1 validated count OK (>=7) | ❌ FALL (got 0) |
| 6 | C2 validated count OK (>=7) | ❌ FALL (got 0) |
| 7 | Move after disconnect handled (no crash) | ✅ PASS |
| 8 | Disconnect handler tested | ✅ PASS |

**Итог прогонки (без сервера на 5500): `3/8 passed, 5 failed`, exit 0.**
Падающие 5 — все из-за одного и того же: **требуют запущенный сервер на порту 5500** (`io('http://localhost:5500')`). Сервер сейчас НЕ запущен (проверено `ss -ltnp`).

### Автономность
Сейчас тесты — «интеграционные», зависят от внешнего процесса. Варианты сделать автономными:

1. **Порог-порт в package.json** — скрипт `test` поднимает `node ./src/index.js` на тестовом порту (env `PORT`), ждёт ready, гонит тест, завершает процесс. Минимум кода.
2. **In-process server** — вынести `app` из `src/index.js` в экспортируемый модуль, в тесте `app.listen(0)` (эфемерный порт), читать `server.address().port`. Тест не зависит от внешнего порта, параллелен. **Рекомендуемый** (нужна небольшая рефакторка `src/index.js` — за другим субагентом).
3. **Абстрагировать адрес** — вынести `http://localhost:5500` в `process.env.TEST_URL ?? 'http://localhost:5500'`; тогда с поднятым сервером тесты прогоняются как есть.

`test-evergreen.mjs` — аналогично, тоже привязан к `localhost:5500`.

---

## 6. `package.json` — детали

```
name: cherry | version 1.0.0 | type: module
main: index.js (не используется, реальный entry — src/index.js)
scripts: { "start": "node ./src/index.js" }   // только 1 скрипт, НЕТ test script
dependencies (8):
  assert ^2.0.0        (builtin, не нужен как dep)
  bcrypt ^6.0.0        (auth — пароли)
  ejs ^3.1.8           (шаблоны)
  express ^4.18.2      (web-сервер)
  http ^0.0.1-security (⚠️ «security»-псевдопакет, builtin — мусор, см. issues)
  path ^0.12.7         (builtin, не нужен как dep)
  socket.io ^4.5.4     (сервер)
  socket.io-client ^4.8.3  (клиент, используется тестами)
```
**Замечания:**
- Нет `test`/`lint`/`build` скриптов.
- `assert`, `http`, `path` — это **builtins Node**, лишний `http@0.0.1-security` — known typosquat/пустышка, кандидат на удаление.
- `socket.io-client` в production-депе (используется только тестами) — можно в `devDependencies`.

---

## 7. Dockerfile + docker-compose — деплой

**Dockerfile** (8 строк):
- `node:18-alpine` → `npm ci --production` → `COPY . .` → `EXPOSE 5500` / `ENV PORT=5500` → `CMD npm start`.
- ⚠️ `--production` НЕ ставит `socket.io-client` (dev-зависимости не ставятся, но client помечен как production dep → в контейнере будет; однако `http@0.0.1-security` тоже заберётся).
- ⚠️ `COPY . .` копирует и `node_modules/`, `debug-*.mjs`, `tune/` — нужен `.dockerignore` (сейчас нет).

**docker-compose.yml** (20 строк, Swarm-стиль `version: 3.8`):
- Сервис `cherry`, image `cherry:latest`, `replicas: 1`, constraint `node.hostname==first`.
- Traefik: `Host(mycheserv.duckdns.org)`, entrypoint `websecure`, TLS certresolver `le` (Let's Encrypt).
- **Внутренний порт 5500** (`loadbalancer.server.port=5500`), наружу 443 (websecure).
- ⚠️ **Нет `volumes`** — state в контейнере (сессии/матчи в RAM, при рестарте теряются). Для stateless chess-сервера ок, но сессии (bcrypt auth) не переживут рестарт.
- Оба файла в `.gitignore` — деплой-конфигурация не в VCS (локально на хосте).

---

## 8. `README.md` — «обещает vs есть»

**Обещает:** self-hosted multiplayer chess, invite-ссылки, cookie/session auth, порт 5500, `npm start`. Клон с `github.com/vnnm404/Cherry`.
**Есть:** всё это реально (express + socket.io + ejs + bcrypt). Разрывы:
- README описывает **первобазовую** сборку (`npm install express ejs http assert path socket.io`) — не упоминает `bcrypt` (добавлен позже, есть в package.json).
- Не упоминает Docker-деплой (Dockerfile/compose существуют и в `.gitignore`).
- Не упоминает ни об аудите, ни об исправленных 18+12 багах (все в `errors.md`/`errors/`).
- GIF-демо и ссылки — от оригинального upstream-репо.
**Вывод:** README актуален по базовой функциональности, устарел по auth (bcrypt) и деплою (Docker). Кандидат на обновление.

---

## Кандидаты в issues (с приоритетами)

### P1 (критично для корректности/безопасности)
- **T1 — Нет `test`-скрипта + интеграционные тесты неавтономны.** `test-chess.mjs`/`test-evergreen.mjs` требуют внешний сервер на `:5500`, `package.json` без `test`/CI. Сделать автономно: in-process `app.listen(0)` (рефактор `src/index.js` → экспортировать `app`) + `npm test`. (Задевает src — координировать с субагентом src.)
- **T2 — Псевдо-зависимость `http@0.0.1-security`.** Это **typosquat** (настоящий `http` — builtin, не инсталлируется из npm). Удалить из `dependencies`. Риск: потенциально вредоносный пакет в lock-файле.
- **T3 — `Dockerfile` без `.dockerignore`.** `COPY . .` втягивает `node_modules/` (110 пакетов), `debug-*.mjs` (1529 строк), `tune/`, `.git/` (250+ объектов) в образ. Создать `.dockerignore`.

### P2 (гигиена/качество)
- **T4 — Удалить 17 debug/trace-скриптов (1529 строк).** Чистый отладочный мусор в корне (все в `.gitignore`). Удалить или перенести в `debug/`.
- **T5 — Лишние builtins в `dependencies`:** `assert`, `path` (и `http` после T2) — убрать. `socket.io-client` → `devDependencies` (используется только тестами).
- **T6 — Архив `errors/` (12 .err, 388 строк) + `errors.md` (281).** Все 30 багов `FIXED ✓ VERIFIED`. Кандидат: перенести в `docs/`/`archive/` или зафиксировать в git-истории и убрать из рабочей папки (уменьшает шумы при чтении).
- **T7 — README устарел:** не отражает bcrypt auth, Docker-деплой, исправленные баги. Обновить секции Installation/Usage + добавить Docker.

### P3 (низкий приоритет)
- **T8 — `Dockerfile` node:18-alpine** — устаревший LTS; обновить к актуальному LTS (20/22) при следующем touch.
- **T9 — `docker-compose.yml` без `volumes`.** Сессии/матчи живут только в RAM; при рестарте контейнера теряются. Если нужно — external-хранилище/redis (для stateless игры — скорее P3, не блокирует).
- **T10 — `package.json` `main: index.js`** — в корне `index.js` нет; не используется. Убрать поле или поправить.
- **T11 — `docker-compose.yml` `version: "3.8"`** — deprecated-поле (Compose 2+ игнорирует); убрать.
