# Chess (Cherry) — issues из прод-использования (2026-08-16)

Реестр багов, найденных в живом использовании после деплоя deecd39.

## B1 — [DONE, deecd39] Доска не рендерится
Двойное top-level `let matchId` (game.ejs:13 + game.js:80) → SyntaxError → game.js не выполняется.
Фикс: удалена строка 80 game.js. Верификация: живой браузер, canvas 305×305, draw=function.

## B2 — [OPEN, в работе] Неверная подсветка ходов + ходы не синхронизируются
- Симптом 1: при выборе фигуры подсвечиваются клетки, не соответствующие легальным ходам этой фигуры.
- Симптом 2: ход игрока не отображается у соперника (синхронизация сломана).
- Ключевое доказательство (DEBUG-лог прод, контейнер 77d1c1ba18bd, ~40+ подключений, 3+ игры):
  **`move: APPLIED` всего 1 за 60 минут** → сервер ходы почти никогда не получает/не принимает.
  Единственная строка: `14:37:13 move: APPLIED matchId=2 turn=0 from= 6:4 to= 4:4` (формат row:col).
- Значит: либо клиент шлёт ходы в невалидном виде (координатный трансформ/перспектива),
  либо `socket`/`matchId`/`my_color` на клиенте не те, либо сервер отклоняет валидные.
- Подозреваемые места:
  - src/public/js/game.js: `sendMoveToServer` (296-320), `executeClickToMove` (323-340),
    drag-ветка `socket.emit('move', ...)` (396-407), `selectPiece` + `genLegalMoves(visualBoard,pos,null,lastMove)` (284-292),
    `board_flipped = (my_color === black)` (93), `recalcLayout` (236-247).
  - src/public/js/chessutils.js: `genLegalMoves` (510+) — клиентская РАСШЕДШАЯСЯ ВЕТВЬ (12 расхождений с серверной).
  - src/index.js: `socket.on('move')` — валидация (turnState, isLegalMove).
  - Критический вопрос: `my_color` приходит как color bit (0/1?) или как piece-value, и сравнение `my_color === black`.
- Критерий готовности: два живых клиента (или headless-эмуляция обоих концов) — ход одним отображается у другого;
  подсветка = легальным ходам фигуры (spot-проверка: конь/ладья/пешка, включая начало партии e2-e4/e2-e5 + рокировка после разработки);
  `move: APPLIED` в логах на каждый ход; npm test 35/35+36/36; прод задеплоен, verify (a)-(e).

## B3 — [DONE, commit в 18-b3b4-lifecycle.md, `5e01a27`] Ghost seat после обрыва до/в начале матча
- Симптом: игрок обрывает связь (закрытие вкладки, потеря сети) до старта или в начале;
  seat не освобождается; второй получает `startGame` на мёртвого/ушедшего соперника
  (прошлый вид: «у одного waiting, у второго playing as black»).
- Лог: `reconnect: gameNotFound reason=slot-occupied` — слот занят старым живым/мертвым сокетом;
  `timer: forfeit scheduled in 300000 ms` — forfeit только через 5 минут.
- Фикс-направление: в disconnect-handler — если матч ПРЕ-СТАРТ (оба не начали, no moves) → освободить слот
  + удалить матч (или оставить одиночку с уведомлением оставшемуся); если матч ИДЁТ — текущий forfeit-таймер корректен.
- Критерий: обрыв одного из двух в лобби → второй не получает startGame на привидение; матч либо удаляется,
  либо второй видит «соперник ушёл» и возвращается в лобби. npm test + прод verify.
- ЗАКРЫТО (см. 18-b3b4-lifecycle.md): disconnect-handler (src/index.js) — moveHistory.length===0 →
  НЕМЕДЛЕННО endMatch('opponent_disconnect', lostColor) БЕЗ таймера; moveHistory.length>0 — 5-мин таймер как был.
  Клиент gameSockets.js: gameEnd уже читает data.result + reason opponent_disconnect → UI «Победа 🎉» (не трогал).
  Регресс-тест T-B3 (2 клиента, pre-start, один disconnect → второй gameEnd(opponent_disconnect,win) + матч удалён).

## B4 — [DONE, commit в 18-b3b4-lifecycle.md, `5e01a27`] Session не переживает обновление страницы
- Симптом: F5 в игре → игрок не возвращается в партию.
- Лог: `reconnect: gameNotFound reason=slot-occupied gameId= N color= C` → новый сокет отклонён,
  т.к. старый ещё жив (socket.io reconnect-гонка: новое соединение прилетает ДО disconnect-события старого).
- Фикс-направление: (1) в reconnect-handler (src/index.js:470): `playerSocket && playerSocket !== socket && !playerSocket.connected` → это stale мёртвый сокет (F5 race) → заменить сокет (не gameNotFound); (2) для живого старого (socket.io reconnect, старый ещё connected) → client шлёт `prevSocketId` (sessionStorage, save on startGame/reconnected), сервер сравнивает: `playerSocket.id === data.prevSocketId` → тот же клиент → заменить; иначе → gameNotFound (чужой double-connect).
- Критерий: F5 в активной партии → игрок возвращается в ту же партию с тем же цветом и доской. npm test + прод verify (headless: 2 клиента, один F5 → reconnect OK).
- ЗАКРЫТО (см. 18-b3b4-lifecycle.md): reconnect-handler (src/index.js) — ветка `playerSocket && playerSocket!==socket`:
  если `!playerSocket.connected` (стари мёртв, F5 race) ИЛИ `playerSocket.id===data.prevSocketId` (тот же клиент, старый ещё
  .connected) → НЕ gameNotFound, а log + замена сокета (перевод к replace-ветке; отмена forfeit-таймера и по старому socket.id);
  иначе (чужой живой) → gameNotFound reason=slot-occupied. Клиент gameSockets.js: записывает `cherry_socketId` (sessionStorage)
  в socket.on('connect'); tryReconnect() передаёт `prevSocketId` из sessionStorage. Регресс-тест T-B4 (1 ход, F5 c prevSocketId → reconnected).

## B5 — [DONE, P0] Нет authFailed-хендлера на клиенте → «за белых, жду чёрных» вечно
- **STATUS: DONE** — закрыт одним коммитом с B6 (SHA в STATE.md / git log).
- Симптом (прод, 2026-08-16 20:20-20:28 МСК, оба игрока): «оба заходят за белых и ожидают черных»
  = оба зависли на «Waiting for player...» (белая ориентация по умолчанию), не попали в матчмейкинг.
- Лог (контейнер ec76a1ced0e7): `socket connect sessionCookie= yes` → `auth validateSession FAIL
  reason=unknown-session` → `auth: REJECTED ... emitting authFailed, matchId= 1` → далее тишина (ни findMatch,
  ни startGame, ни gameNotFound).
- Корень: (1) сессии in-memory (см. B6) — после рестарта контейнера (деплой 18:52) сессия вымыта, cookie (1 день)
  остался → unknown-session; (2) `gameSockets.js` НЕ имеет `socket.on('authFailed', ...)` (grep по src/public/js/
  пустой; в списке socket.on: startGame/reconnected/gameNotFound/... — authFailed отсутствует). → клиент застревает.
- Фикс: добавить в `gameSockets.js` `socket.on('authFailed', () => { clearSession(); /* удалить cookie sessionID */
  window.location.href = '/index'; })` (по образцу уже существующего `gameNotFound`-хендлера на строке ~125, который
  делает clearSession() + redirect /index). Для чистоты — deleteCookie-хелпер в cookieUtil.js (сейчас есть только
  write/read; delete = writeCookie с expires в прошлом).
- Критерий: клиент с валидным cookie, после серверного рестарта (сессия вымыта) → попадает на /index (перелогин),
  а не зависает в лобби. npm test; прод verify (a)-(e).

## B6 — [DONE, P1, корень B5] Сессии не переживают рестарт контейнера
- **STATUS: DONE** — sessions.json в DATA_DIR (loadSessionsFile/saveSessionsFile/attachSessionsToUsers + persist при
  authenticateUser/validateSession), загрузка при старте в src/index.js, 4 regression-теста T-B6. npm test: evergreen 35/35, chess 43/43.
- Корень: `user.sessions` только в памяти (src/lib/auth.js: «sessions start empty», строки 92/141 `sessions: []`).
  users.csv = username,password_hash,elo — сессий нет. DATA_DIR=/app/data — volume (cherry_data), уже живёт.
- Симптом: любой деплой/ребут → все логины сгорают, cookie живут дольше → триггер B5.
- Фикс-направление: персистентность сессий в DATA_DIR (отдельный файл, напр. sessions.json: [{id,username,expires}])
  через atomicWriteFile (уже есть в auth.js). load при старте (src/index.js ~183, рядом с loadUsersFile) —
  прицепить не-протухшие сессии к пользователям; save при authenticateUser (новый session); delete при expiry
  (validateSession) — prune. Публичный API (authenticateUser/validateSession/saveUsersFile/loadUsersFile) не ломать.
- Безопасность: session id уже random 16-byte hex; хранение {id,username,expires} — стандарт. Не логировать id в
  stdout (debuglog уже не логит id — только username/reason).
- Критерий: T-B6 (in-process): authenticateUser → «рестарт» (перезагрузка из диска) → validateSession OK;
  expired → FAIL + prune. npm test; прод: залогиниться → `docker service update --force chess_cherry` → тот же
  cookie продолжает валидироваться (без перелога).
