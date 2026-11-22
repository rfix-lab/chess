# F1 + F2 — CSV-персист пользователей + Elo

**Дата:** 2026-08-16
**Коммит:** `ac90570` (F1+F2), прод-образ `sha256:2660ca455dab6de72c2e4e2e8a5af145ba57e864dc24fc8982d05d401ca0a533`
**npm test:** evergreen 35/35 + test-chess 25/25, exit 0

## F1: CSV-персист + autocomplete
- `src/lib/auth.js`:
  - `DATA_DIR = process.env.DATA_DIR || '/app/data'`; `USERS_CSV = $DATA_DIR/users.csv`
  - Формат CSV: `username,password_hash,elo` (bcrypt hash, НЕ plaintext)
  - `loadUsersFile()` на старте (нет файла → создать с заголовком), `saveUsersFile()` — атомарно (tmp + rename)
  - `USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/`, signup возвращает `-2` для невалидного имени; новый UI-сообщение в index.ejs
- `src/index.js`: `let users = loadUsersFile()`; `GET /api/users?prefix=` → JSON массив имён (только username, без hash/elo/паролей), max 10
- `src/public/js/indexSockets.js`: native `<datalist id="username-list">` + debounced fetch 300ms
- `Dockerfile`: `RUN mkdir -p /app/data && chown node:node /app/data` (иначе volume создаётся root-ом, USER node не пишет)
- `docker-compose.yml`: named volume `cherry_data:/app/data` (на first: `/wd18/400/docker_files/volumes/chess_cherry_data/_data`)
- Тесты: персист через «перезапуск» (стоп/старт in-process с тем же DATA_DIR) → signin OK; неверный пароль → fail; /api/users не содержит hash/password

## F2: Elo
- `endMatch` (src/index.js): `ELO_K = 32`, `START_ELO = 1500`; стандартная формула `new = R + K*(score - 1/(1+10^((Rb-Ra)/400)))`
- Rated = оба игрока зарегистрированы (`socket.data.user` из auth-хендлера; гости — null, рейтинг не трогается)
- Дельта победителя = минус дельта проигравшего (сумма сохраняется); запись в CSV атомарно; событие `elo` обоим игрокам
- UI: `gameSockets.js` — при `gameEnd` в строку статуса добавляется `(Elo: вы X, соперник Y)` (гостевые матчи — без)
- Тесты: полный матч до checkmate → winner 1516 > 1500 > 1484 loser, сумма 3000, значения в CSV; матч двух гостей — /api/users не меняется

## Деплой
- build на elastic2 → `docker save|gzip|ssh first docker load` → `docker service update --force chess_cherry`
- healthy; running image id == `2660ca455...` == local (elastic2 == first)
- volume `chess_cherry_data` → `/app/data` (node:node, users.csv существует)
- curl /index: 200×5; /api/users: `[]` (после смоука — имя)

## Прод-смоук (через https://mycheserv.duckdns.org)
1. signup `smoke_f1_msvrkmai` → valid=1 → строка в users.csv на first: `smoke_f1_msvrkmai,$2b$10$... ,1500` (bcrypt, не пароль)
2. редистарт контейнера (`docker service update --force`) → юзер жив
3. signin → valid=1, sessionID выдан (`9c609d15...`) — **юзер переживает redeploy**

## Дегенеративные кейсы
- id=0 не касается (F1/F2 не используют id)
- guests: T-GUEST зелёные (гость не получает elo, не пишет в CSV)
- volume без файла: loadUsersFile создаёт заголовок; Dockerfile mkdir+chown до volume-байнда
