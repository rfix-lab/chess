# Инвентаризация /root/proj/chess/src/

**Создано:** 2026-08-15
**Статус:** завершено
**Всего:** 19 файлов, 4691 строк

## Файлы

| Путь | Строк | Роль | Ключевые функции/обработчики (имя:строка) |
|------|-------|------|-------------------------------------------|
| src/index.js | 589 | Сервер: Express + Socket.IO, вся игровая логика (ход, auth, draw, resign, challenge, takeback, promotion, disconnect/forfeit) | `isRateLimited:17`, `app.get('/'):56`, `app.get('/index'):60`, `app.get('/game'):64`, `socket.on('move'):78`, `socket.on('signin'):218`, `socket.on('signup'):224`, `socket.on('auth'):233`, `socket.on('reconnect'):250`, `socket.on('private-match'):307`, `socket.on('promotion:choose'):325`, `socket.on('drawOffer'):407`, `socket.on('drawResponse'):425`, `socket.on('resign'):444`, `socket.on('challenge'):455`, `socket.on('challengeResponse'):476`, `socket.on('takebackRequest'):495`, `socket.on('takebackResponse'):527`, `socket.on('disconnect'):563` |
| src/lib/auth.js | 63 | Авторизация: bcrypt, сессии в памяти | `generateSessionID:4`, `authenticateUser:8`, `validateSession:25`, `signupUser:42` |
| src/lib/chessutils.js | 732 | Серверная шахматная логика: валидация ходов, мат/пат, castling, en passant, promotion, threefold, insufficient material, 50-move rule | `chessMakeMove:66`, `checkLegalMove:133`, `chessMoveValidate:146`, `checkCheck:209`, `pawnMoveValidate:275`, `_wasPawnDoublePush:285`, `whitePawnMoveValidate:296`, `blackPawnMoveValidate:340`, `knightMoveValidate:384`, `bishopMoveValidate:402`, `rookMoveValidate:444`, `queenMoveValidate:487`, `kingMoveValidate:492`, `genLegalMoves:576`, `genAllLegalMoves:593`, `isKingInCheck:611`, `isGameEndReason:634`, `checkMateCheck:644`, `checkThreefoldDraw:648`, `isInsufficientMaterial:685`, `isFiftyMoveRule:728` |
| src/lib/chessutils.js.bak | 692 | Старая копия серверной chessutils (до castling/en-passant через match). Мёртвый файл. | — |
| src/lib/matchmaking.js | 84 | Пул матчей: создание, поиск, приватные, старт | `initMatch:24`, `findMatch:51`, `findPrivateMatch:66`, `startMatch:82` |
| src/public/js/chessutils.js | 540 | Клиентская копия шахматной логики (без export, для preview ходов). Содержит BUG: ссылается на `isKingInCheck` (425, 451) который НЕ определён в клиенте. | `checkLegalMove:170`, `checkCheck:127`, `chessMoveValidate:63`, `genLegalMoves:522`, `deriveCastlingRights:502`, `kingMoveValidate:418` |
| src/public/js/game.js | 673 | Клиент: canvas-рендер доски, drag&drop, click-to-move, звук, captured pieces, promotion UI | `recalcLayout:46`, `fen_to_board:121`, `render_board:170`, `draw:191`, `get_box_coords:264`, `selectPiece:278`, `sendMoveToServer:298`, `executeClickToMove:328`, `handle_drag:349`, `display_possible_moves:457`, `renderCapturedPieces:592`, `updateBoardColors:640`, `showPromotionSelector:648` |
| src/public/js/gameSockets.js | 489 | Клиент: все socket-хендлеры игровой страницы (startGame, validated, checkMate, draw, resign, challenge, takeback, reconnect, promotion) | `saveSession:6`, `loadSession:10`, `tryReconnect:37`, `socket.on('startGame'):52`, `socket.on('reconnected'):78`, `socket.on('validated'):126`, `socket.on('checkMate'):187`, `socket.on('stalemate'):202`, `socket.on('draw'):211`, `socket.on('drawOfferReceived'):202(rel 180+23)`, `socket.on('challengeReceived'):236`, `socket.on('resignReceived'):271`, `socket.on('gameEnd'):285`, `socket.on('takebackOfferReceived'):305`, `socket.on('takebackAccepted'):330`, `socket.on('takebackDeclined'):350`, `socket.on('takebackError'):357`, `socket.on('repetitionWarning'):362`, `socket.on('disconnect'):368` |
| src/public/js/index.js | 22 | Клиент: кнопки login page (play, genLink), cookie helpers | `play:1`, `writeCookie:5`, `readCookie:17`, `genLink:21` |
| src/public/js/indexSockets.js | 95 | Клиент: socket-хендлеры login page (signin, signup, private-match link) | `socket.on('signin'):3`, `socket.on('signup'):50`, `socket.on('private-match'):86` |
| src/public/js/events.js | 24 | Клиент: submit формы login/signup → socket.emit | `submitLoginDetails:1`, `submitSignUpDetails:14` |
| src/public/js/theme.js | 57 | Клиент: dark/light тема, localStorage, matchMedia | `getSystemPreference:9`, `initTheme:16`, `applyTheme:22`, `toggleTheme:34` |
| src/public/styles/game.css | 368 | CSS игровой страницы (доска, кнопки, модалки, toast) | — |
| src/public/styles/index.css | 6 | CSS login page (минимальный) | — |
| src/views/game.ejs | 117 | EJS-шаблон игровой страницы (canvas, кнопки, модалки) | — |
| src/views/index.ejs | 47 | EJS-шаблон login page | — |
| src/public/audio/capture.mp3 | 29 | Звук взятия фигуры | — |
| src/public/audio/move-self.mp3 | 19 | Звук своего хода | — |
| src/public/audio/wrong_move_sound.mp3 | 45 | Звук невалидного хода | — |

## Дуп server/client

**Файлы:** `src/lib/chessutils.js` (732 строк, ES module, `export`) vs `src/public/js/chessutils.js` (540 строк, IIFE/глобальные, без `export`)

**Размер:** 732 vs 540 строк (разница 192 строки)

**diff: 394 строки отличаются (diff | wc -l)**

### Ключевые расхождения:

| # | Расхождение | Сервер | Клиент |
|---|-------------|--------|--------|
| 1 | **`isKingInCheck` отсутствует** | `export function isKingInCheck` :611 | Не определён. Используется на 425 и 451 → **ReferenceError** |
| 2 | **Битовые маски castling (королевская сторона)** | `board[kingRow][5] !== blank` :513 | `board[kingRow][6] !== blank` :439 — **НЕПРАВИЛЬНО**: клиент проверяет клетку b-колонку вместо a-колонки |
| 3 | `assert` import | `import assert from 'assert'` :1, asserts :149-150 | Закоммечен `// let header_guard = true;` :1, asserts :66-67 закоммечены |
| 4 | `_wasPawnDoublePush` сигнатура | `(match, row, col, pawnColor)` :285 | `(lastMove, row, col, pawnColor)` :206 — принимает `lastMove` напрямую |
| 5 | En passant в pawnMoveValidate | Проверяет `board[y][x] === (black|pawn)` + `_wasPawnDoublePush(match,...)` :328-330 | Проверяет `getPiece==pawn && getColor==black` + `_wasPawnDoublePush(match ? match.lastMove : null,...)` :256-257 |
| 6 | `genLegalMoves` | `(board, position)` — без castling rights, без lastMove :576 | `(board, position, castlingRights, lastMove)` :522 — принимает и выводит `match` из них |
| 7 | `deriveCastlingRights` | Отсутствует (права хранятся в match) | Определён :502 — выводит права из позиции (fallback когда match не передан) |
| 8 | `chessMakeMove` | Определён (серверный apply) :66 | **Полностью отсутствует** — клиенту не нужно |
| 9 | `isGameEndReason`, `checkMateCheck`, `checkThreefoldDraw`, `isInsufficientMaterial`, `isFiftyMoveRule`, `genAllLegalMoves`, `genAllMoves` | Определены :593-731 | **Отсутствуют** |
| 10 | `validBoard` guard в genLegalMoves | Закоммечен `// if(!validBoard(board))` :560-561 | Активен `if(!validBoard(board)) return [];` :486-487 |
| 11 | Константы | `export const blank = 0` (dec) :8 | Закоммечены :8-17 (определены в game.js:19-28) |
| 12 | Нет newline в конце файла | Есть | `\ No newline at end of file` |

### Вывод:
Клиентская копия — **расходящаяся ветвь**, не зеркало. Критический баг: `isKingInCheck` вызывается (425, 451) но не определён. Castling path-проверка в клиенте **ошибочна** (клетка [6] вместо [5]).

**Доп. файл:** `src/lib/chessutils.js.bak` (692 строк) — старая версия серверной до добавления castling/en-passant через `match` объект. diff от текущей: 88 строк. Не используется нигде.

## Технический долг

### 1. `console.log` в проде (активные, не закоммеченные):
- `src/index.js:588` — `console.log('Live on ${PORT}')` — при старте сервера, допустимо
- `src/public/js/indexSockets.js:4` — `console.log('signing valid: ' + valid)` — **в клиентском JS, виден в browser console каждому**

### 2. Закомментированные `console.log` (шум):
- `src/lib/chessutils.js` — ~24 строки (`160,165,172,202,205,302,316,321,333,345,366,403,408,417,421,426,436,437,440,449,463,468,478,481,547,581`)
- `src/public/js/chessutils.js` — ~28 строк
- `src/index.js:225` — закоммент `console.log` с логином+паролем в шаблоне строки

### 3. Устаревшие/обманчивые комментарии:
- `src/public/js/game.js:1` — `// no en passant, castling, or advance drawing yet` — **ложно**: en passant и castling уже реализованы
- `src/lib/chessutils.js.bak:1` — `import assert from 'assert'` в .bak файле
- `src/index.js:45` — `/* user database, convert this to an actual database */` — актуальный TODO

### 4. Дубли логики:
- **chessutils.js server vs client** — ~400 строк дублирующейся валидационной логики с расхождениями (см. раздел "Дуп")
- `chessutils.js.bak` — полная мёртвая копия
- `game.js:19-28` — константы `blank/white/black/pawn/king/queen/rook/bishop/knight` дублируют `lib/chessutils.js:8-21`
- `game.js:21-22` vs `index.js(client):5-19` — `readCookie`/`writeCookie` дублируются
- `gameSockets.js:21-22` — третий `readCookie`

### 5. Магические числа:
- `src/index.js:82` — `isRateLimited(socket, 'move', 1000, 10)` — rate limit 10/s inline
- `src/index.js:459` — `isRateLimited(socket, 'challenge', 10000, 3)` — 3/10s inline
- `src/index.js:499` — `isRateLimited(socket, 'takeback', 10000, 5)` — 5/10s inline
- `src/index.js:579` — `5 * 60 * 1000` — 5-min forfeit timer
- `src/index.js:150-151` — `0b10000` (move indicator), `0b1000000` (en-passant target), `0b100000` (check) — битовые маски без именованных констант
- `src/public/js/game.js:623` — `setInterval(..., delta_time)` — FPS не задан в конфиге

### 6. Незакрытые ресурсы / утечки:
- `src/lib/matchmaking.js:11` — `matches` (массив) растёт безbound; матч удаляется только при disconnect-forfeit (`splice` в index.js:575). Завершённые матчи (checkmate, draw, resign) **не удаляются** из массива.
- `src/index.js:582` — `match.disconnectTimers` — `clearTimeout` вызывается при reconnect (:283), но если матч удаляется из `matches` при forfeit, timer на другом сокетe не чистится (timer ссылается на match, не на socket id, — в порядке, но disconnectTimers на удалённом match не cleanup)

### 7. Безопасность:
- `src/lib/auth.js:8-19` — `authenticateUser` итерует пользователей без rate-limit на уровне auth; `bcrypt.compare` в цикле — timing attack surface минимален (bcrypt), но перебор usernames возможен
- `src/index.js:45` — `users = []` в памяти; при рестарте сервера все аккаунты/сессии теряются
- `src/views/index.ejs:31` — `successDiv.innerHTML = 'Logged in as ' + usernameInput.value` — **XSS** (username вводится клиентом, рендерится в innerHTML)

## Кандидаты в issues

| # | Приоритет | Заголовок | Описание |
|---|-----------|-----------|----------|
| 1 | **P1** | Client chessutils: `isKingInCheck` is not defined (ReferenceError) | `src/public/js/chessutils.js:425,451` вызывается из `kingMoveValidate`. Функция отсутствует в клиентской копии. Любой castling-валидационный путь на клиенте → crash |
| 2 | **P1** | Client castling: wrong path check (column 6 instead of 5) | `src/public/js/chessutils.js:439` — `board[kingRow][6] !== blank` проверяет клетку b-колонку, должно быть `[kingRow][5]` (клетка перед ладьей). Расхождение с сервером (:513) |
| 3 | **P2** | XSS: username rendered via innerHTML | `src/views/index.ejs:31` — `successDiv.innerHTML = 'Logged in as ' + usernameInput.value`; username управляется клиентом |
| 4 | **P2** | Memory leak: completed matches never removed from `matches[]` | `src/lib/matchmaking.js:11` — массив `matches` растёт бесконечно. Только disconnect-forfeit делает `splice`. Checkmate/draw/resign не чистят |
| 5 | **P2** | No persistence: users & sessions in RAM | `src/index.js:45` — `let users = []`; при рестарте все данные теряются |
| 6 | **P2** | Client/server chessutils divergence (394-line diff) | Две копии валидационной логики разошлись: 12+ расхождений. Риск рассинхрона client- и server-side валидации |
| 7 | **P3** | Dead file: `src/lib/chessutils.js.bak` (692 строк) | Старая версия, не импортируется нигде. Удалить |
| 8 | **P3** | Stale comment: `game.js:1` "no en passant, castling" | Фичи давно реализованы. Комментарий вводит в заблуждение |
| 9 | **P3** | console.log in client (indexSockets.js:4) | `console.log('signing valid: ' + valid)` — утечка в browser console |
| 10 | **P3** | Magic numbers: rate-limit params, bit masks, forfeit timeout | `src/index.js:82,150-151,156,159,168,459,499,579` — извлечь в именованные константы |
| 11 | **P3** | Duplicated `readCookie`/`writeCookie` in 3 files | `index.js(client):5-19`, `gameSockets.js:21-22` — вынести в shared util |
| 12 | **P3** | `validBoard` guard inconsistency: server commented out, client active | `src/lib/chessutils.js:560` (закоммечен) vs `src/public/js/chessutils.js:486` (активен) — рассинхрон валидации |
