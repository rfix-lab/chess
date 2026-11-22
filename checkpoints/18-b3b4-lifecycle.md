# 18 — B3+B4 (lifecycle): ghost seat on pre-start disconnect + F5 reconnect

**Статус:** DONE (один фикс-коммит; commit SHA: `5e01a27`)
**Изменённые файлы:** `src/index.js`, `src/public/js/gameSockets.js`, `test-chess.mjs` (regression), `checkpoints/*`.

## B3 — Ghost seat (pre-start disconnect)
- **Корень** (src/index.js disconnect-handler, ~778-801): forfeit-таймер 5 мин ставился для
  ЛЮБОГО незавершённого матча, включая pre-start (moveHistory пуст). Мёртвый сид оставался в
  matches[] 5 минут → второй игрок сажался в этот матч и получал `startGame` на мёртвого
  соперника (прод 14:40:25–33: m4 white disconnect, black seated, startGame мёртвому white).
- **Фикс:** в disconnect-handler, ПОСЛЕ `clearMatchTimers(match)` (порядок сохранён):
  `if (match.moveHistory.length === 0)` → НЕМЕДЛЕННО `endMatch(match, 'opponent_disconnect', lostColor)`
  (lostColor = сторона, чей socket отключился), БЕЗ таймера. `moveHistory.length>0` — текущая
  5-мин логика без изменений. `endMatch` — единственная точка завершения (gameEnded, clearMatchTimers,
  splice из matches[], broadcast gameEnd обоим).
  `moveHistory.length===0` = pre-start корректно: push в moveHistory идёт ДО проверки pendingPromotion
  (src/index.js:318), т.е. pendingPromotion уже считает матч started → падает в таймер-ветку.
- **Клиент:** gameSockets.js `socket.on('gameEnd')` уже читает `data.result` и имеет
  `messages['opponent_disconnect']` → «Оппонент отключился — победа! 🎉» (win для оставшегося) — не трогал.

## B4 — F5 → gameNotFound (slot-occupied)
- **Корень** (src/index.js reconnect-handler, ~450-490): `if (playerSocket && playerSocket !== socket)
  → gameNotFound`. После F5/обрыва сервер ХРАНИТ отсоединённый socket-объект в player1/2Socket.
  Новый (reload) != старый объект → отклонён, даже когда старый мёртв. Плюс socket.io race: новый
  connect прилетает ДО disconnect-события старого (старый ещё `.connected`).
- **Фикс:**
  1. Сервер (reconnect-handler): в ветке `playerSocket && playerSocket !== socket`:
     `sameClient = prevSocketId && playerSocket.id === prevSocketId` (тот же клиент, гонка) ИЛИ
     `staleDead = !playerSocket.connected` (F5 уже обработал disconnect) → НЕ gameNotFound: log
     `reconnect: replacing stale socket ... old= new= oldConnected= sameClient=` и продолжаем к замене;
     перед заменой отменяем forfeit-таймер по СТАРОМУ `playerSocket.id` (disconnectTimers key'ятся по
     старому socket.id; текущий код отменял только по новому `socket.id`). Иначе (чужой живой) →
     gameNotFound reason=slot-occupied (лог сохранён).
  2. Клиент (gameSockets.js): (a) `socket.on('connect', () => sessionStorage.setItem('cherry_socketId', socket.id))`
     (socket.io v4 меняет id при reconnect — записываем актуальный); (b) `tryReconnect()` передаёт
     `prevSocketId` из sessionStorage (try/catch, null если нет). Больше клиент не тронут.

## Тесты (regression, test-chess.mjs; 36 → 39, +3)
- **T-B3:** 2 гостя → startGame, БЕЗ ходов (moveHistory пуст), один disconnect → второй получает
  `gameEnd` (reason 'opponent_disconnect', result 'win') немедленно; матч удалён — reconnect в него
  → `gameNotFound` (no ghost re-seat). Numeric matchId НЕ сравниваем (S2 reuse maxId+1: новый здоровый
  матч может легально получить тот же id, что и удалённый).
- **T-B4:** 2 гостя → startGame, 1 ход (moveHistory=1), белый disconnect, НОВЫЙ сокет белого делает
  `reconnect {gameId, color, sessionID:null, prevSocketId:<старый socket.id>}` → `reconnected` (НЕ
  gameNotFound), board 8×8 + turnState корректны, чёрный не получает gameEnd.

## Верификация
- `npm test`: evergreen 35/35 + test-chess 39/39 (было 36), exit 0.
- `node --check` на все 3 изменённых .js — OK.
- **live-repro** (test/debug-b3b4.mjs, НЕ в git; in-process server, реальные socket.io-клиенты):
  - B3: pre-start disconnect → survivor `gameEnd={"reason":"opponent_disconnect","result":"win"}`;
    reconnect в мёртвый матч → gameNotFound=true, reconnected=false. PASS.
  - B4: 1 ход, F5 (disconnect + reconnect c prevSocketId=старый) → reconnected
    (color/gid/rows=8/turn=1), gameNotFound=false, black без gameEnd. PASS.
  - До фикса: B3 — ghost seat (startGame мёртвому, таймер 5 мин); B4 — gameNotFound slot-occupied.
- **Deploy:** image sha256:`a95d838efa970151791eaffae599c63229ba096d2d54b6702a8642b86e6a3cc3`
  (elastic2==first); chess_cherry 1/1 healthy (running task = a95d838e, first);
  (a) /index 200; (b) serv-ed gameSockets.js sha256 e637fb54… == repo; (d) 1/1 healthy;
  (e) свежий лог `[DEBUG] server started: PORT=5500 DEBUG=1`.

## Не трогал
game.js / client chessutils.js (B1/B2), серверный движок, matchmaking findMatch/findPrivateMatch
(ghost чиним в disconnect-handler, не в matchmaking), B1/B2 логику, существующие тесты.
