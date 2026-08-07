# Chess Logic Audit

**Date:** 2026-08-08  
**Scope:** Full review of move validation, special moves, and game-ending logic in Cherry chess.  
**Key files:**

| File | Role |
|------|------|
| `src/lib/chessutils.js` | Server-side move validation + check/checkmate logic |
| `src/public/js/chessutils.js` | Client-side copy of chessutils (subset, missing `chessMakeMove`, `checkMateCheck`, `genAllMoves`) |
| `src/public/js/game.js` | Canvas render, drag-and-drop, possible-move highlighting |
| `src/public/js/gameSockets.js` | WebSocket handlers: `validated`, `startGame`, `checkMate` |
| `src/index.js` | Server entry, `move` event handler |
| `src/lib/matchmaking.js` | Match state: `boardState`, `turnState` — no move history |
| `src/views/game.ejs` | Page template (canvas + status header only) |
| `src/public/styles/game.css` | Shake animation for wrong moves |

---

## a) Рокировка (Castling)

- **Статус:** ❌ Не работает
- **Где:** `src/lib/chessutils.js:252-261`, `src/public/js/chessutils.js:233-242` (`kingMoveValidate`)
- **Проблема:**
  - `kingMoveValidate` проверяет только `differenceX <= 1 && differenceY <= 1`. Король может пойти максимум на 1 клетку в любом направлении.
  - Двухклеточный ход короля (O-O / O-O-O) — невозможно.
  - Нет отслеживания: двигался ли король? Двигалась ли ладья? (в `match` нет полей `kingMoved`, `rookMovedW`, `rookMovedB`).
  - Нет проверки: путь свободен? Король не проходит через шах?
- **Фикс:**
  1. В `src/lib/matchmaking.js`: добавить в `initMatch` поля:
     ```js
     kingMovedWhite: false, kingMovedBlack: false,
     rookMovedA1: false, rookMovedH1: false,
     rookMovedA8: false, rookMovedH8: false,
     ```
  2. В `src/lib/chessutils.js`:
     - Обновить `chessMakeMove`: при перемещении короля/ладьи отмечать соответствующие флаги.
     - Переписать `kingMoveValidate`: добавить параметры `match` (для доступа к флагам) + проверку двухклеточного хода:
       ```
       если |dx| == 2 && dy == 0:
         проверить: король/ладья не двигались
         проверить: клетки между королём и ладьёй пусты
         проверить: король не под шахом, не проходит через шах, не попадает под шах
         выполнить двойное перемещение (король + ладья)
       ```
  3. В `chessMakeMove`: при рокировке переместить и ладью тоже:
     ```js
     // O-O: king e1→g1, rook h1→f1
     // O-O-O: king e1→c1, rook a1→d1
     ```
  4. В `src/index.js`: передать `match` (не только `boardState`) в `checkLegalMove` и `kingMoveValidate`.
  5. Синхронизировать клиентскую копию `chessutils.js` (подсветка рокировок).

---

## b) Превращение пешки (Promotion)

- **Статус:** ❌ Не работает
- **Где:** `src/lib/chessutils.js:152-194` (`whitePawnMoveValidate`), `src/lib/chessutils.js:196-229` (`blackPawnMoveValidate`)
- **Проблема:**
  - Пешка, дошедшая до 1-й (white) или 8-й (black) горизонтали, остаётся пешкой.
  - В `whitePawnMoveValidate`: при `moveToCoord.y == 0` нет специальной обработки — пешка просто перемещается.
  - В `blackPawnMoveValidate`: при `moveToCoord.y == 7` аналогично.
  - Нет UI-выбора фигуры (ферзь/ладья/конь/слон).
  - В `src/public/js/game.js` (строка 4): закомментировано `// no en passant, castling, or advance drawing yet` — подтверждает отсутствие.
- **Фикс:**
  1. В `src/lib/chessutils.js`:
     - В `chessMakeMove`: проверить, является ли перемещаемая фигура пешкой и попала ли она на крайнюю горизонталь. Если да → заменить на ферзя (по умолчанию) или принять параметр `promotionPiece`.
  2. WebSocket: изменить схему `move` события:
     ```js
     socket.emit('move', matchId, fromCoords, toCoords, promotionPiece); // optional, default: queen
     ```
  3. В `src/public/js/game.js`:
     - При перемещении пешки на 1-ю/8-ю горизонталь → показать модальный выбор фигуры (4 кнопки: ♕ ♖ ♗ ♞).
     - Заблокировать валидацию до выбора.
  4. Минимальный фикс (без UI): автоматически превращать в ферзя на сервере.

---

## c) Взятие на проходе (En Passant)

- **Статус:** ❌ Не работает
- **Где:** `src/lib/chessutils.js:152-194`, `src/public/js/game.js:4`
- **Проблема:**
  - Нет отслеживания последнего хода (в `match` нет `lastMove`).
  - В `pawnMoveValidate` нет проверки: если `differenceX == 1`, а на целевой клетке пусто — это потенциально en passant, но код возвращает `false` (строки 189-191, 228-229).
  - Коммент в `game.js`: `// no en passant, castling, or advance drawing yet`.
- **Фикс:**
  1. В `src/lib/matchmaking.js`: добавить в `initMatch`:
     ```js
     lastMove: null, // {from: {x,y}, to: {x,y}, piece: value}
     ```
  2. В `src/lib/chessutils.js` → `chessMakeMove`: сохранять последний ход.
  3. В `pawnMoveValidate`: добавить проверку en passant:
     ```
     если differenceX == 1 && destValue == blank:
       если lastMove была пешка, пошедшая на 2 клетки:
         если moveToCoord == {lastMove.from.x, lastMove.from.y ± 1}:
           return true (и при выполнении хода — удалить взятую пешку, не ту, на которую встаём)
     ```
  4. `chessMakeMove`: при en passant также обнулить клетку с взятой пешкой.

---

## d) Шах, Мат, Пат

### Шах

- **Статус:** ⚠️ Частично (логика есть, но нет визуальной индикации)
- **Где:** `src/lib/chessutils.js:118-143` (`checkCheck`), `src/public/js/game.js:205-210` (отрисовка)
- **Проблема:**
  - `checkCheck` корректно проверяет, находится ли король под атакой после хода.
  - **НЕТ визуальной индикации:** при шахе король не подсвечивается. Сервер не отправляет событие "check".
  - В `draw()` подсвечиваются только клетки `move_square_color` (бит `0b10000`), но нет подсветки короля при шахе.
  - `checkCheck` содержит `console.log` — мусор в продакшене.
- **Фикс:**
  1. В `src/index.js`: после `chessMakeMove` проверить, находится ли король под шахом → добавить бит `0b100000` (или отдельный флаг) на клетке короля.
  2. В `src/public/js/game.js` → `draw()`: если клетка короля отмечена флагом шаха → подсветить красным.
  3. Удалить `console.log` из `checkCheck`.

### Мат

- **Статус:** ⚠️ Частично (detects lack of moves, but conflates mate + stalemate)
- **Где:** `src/lib/chessutils.js:316-321` (`checkMateCheck`), `src/index.js:73-76`, `src/public/js/gameSockets.js:76-82`
- **Проблема:**
  - `checkMateCheck` возвращает `true`, если у текущей стороны нет легальных ходов. Но не различает:
    - **Мат** — король под шахом + нет ходов
    - **Пат** — король НЕ под шахом + нет ходов
  - В `src/index.js` (строки 73-76): при `checkMateCheck` отправляется событие `checkMate` — для пата тоже.
  - В `gameSockets.js` (строки 76-82): при получении `checkMate` пишет "Check Mate you lost/Won" — для пата это неправильно (пат = ничья).
- **Фикс:**
  1. Переименовать `checkMateCheck` → `isGameOver` или разделить на две функции:
     ```js
     function isCheckmate(board, turn) {
       return inCheck(board, turn) && genAllLegalMoves(board, turnToColor(turn)).length == 0;
     }
     function isStalemate(board, turn) {
       return !inCheck(board, turn) && genAllLegalMoves(board, turnToColor(turn)).length == 0;
     }
     ```
  2. В `src/index.js`: отправить `checkMate` ИЛИ `stalemate` в зависимости от результата.
  3. В `gameSockets.js`: обработать `stalemate` → "Draw — stalemate 🤝".

### Ничья (Draw conditions)

- **Статус:** ❌ Не работает
- **Проблема:**
  - **Insufficient material** (K vs K, K+B vs K, K+N vs K, K+B vs K+B same color) — не проверяется.
  - **Threefold repetition** — не отслеживается (нет истории позиций/FEN).
  - **Правило 50 ходов** — не отслеживается.
- **Фикс:**
  1. В `src/lib/matchmaking.js`: добавить в `initMatch`:
     ```js
     positionHistory: [],   // для threefold repetition (FEN strings)
     halfMoveClock: 0,      // для правила 50 ходов
     ```
  2. Создать `src/lib/chessutils.js` → `isInsufficientMaterial(board)`.
  3. В `src/index.js`: после каждого хода обновлять `positionHistory`, `halfMoveClock`.
  4. Добавить WebSocket-события: `draw` (с причиной: `stalemate`, `insufficient`, `threefold`, `fifty`).

---

## e) Нумерация доски (Board Coordinates)

- **Статус:** ❌ Неверная
- **Где:** `src/public/js/game.js:174-192` (`draw()`)
- **Проблема:**
  - Номера рядов (1–8) и буквы (a–h) рисуются одинаково для обеих сторон.
  - Белые видят: 8 сверху, 1 снизу → правильно.
  - Чёрные видят ту же нумерацию: 8 сверху, 1 снизу → **неправильно**. Чёрные должны видеть 1 сверху, 8 снизу (как будто доска повернута на 180°).
  - Код на строках 180-186: `ctx.fillText(8 - i, ...)` — всегда 8 сверху, 1 снизу.
  - Код на строках 189-195: `ctx.fillText(String.fromCharCode(i + 97), ...)` — всегда a слева, h справа.
  - При этом `my_color` и `board` инвертируются для чёрных, но нумерация — нет.
- **Фикс:**
  1. В `src/public/js/game.js` → `draw()`:
     ```js
     if (my_color == 0) {
       // white: rank 8 at top (i=0), rank 1 at bottom (i=7)
       ctx.fillText(8 - i, ...);
       ctx.fillText(String.fromCharCode(i + 97), ...);
     } else {
       // black: rank 1 at top (i=0), rank 8 at bottom (i=7)
       ctx.fillText(1 + i, ...);
       ctx.fillText(String.fromCharCode(104 - i), ...);
     }
     ```
  2. Аналогично: координаты на hover/click нужно инвертировать для чёрных.

---

## f) Дополнительные проблемы

### 1. Дублирование кода

- **Где:** `src/lib/chessutils.js` и `src/public/js/chessutils.js`
- **Проблема:** Почти идентичный код серверной и клиентской валидации. При изменении одной версии другая устаревает. Клиентская копия не имеет `chessMakeMove`, `checkMateCheck`, `genAllMoves`.
- **Фикс:** Вынести общую логику в отдельный модуль (`src/lib/chess-logic.js`), импортировать и на сервере, и на клиенте (через bundler или `<script type="module">`).

### 2. `checkCheck` не фильтрует по legal moves

- **Где:** `src/lib/chessutils.js:132`
- **Проблема:** `genAllMoves` возвращает все псевдoleh (без проверки на шах). При проверке "король под угрозой" нужно использовать именно `genAllMoves` (не `genAllLegalMoves`), иначе получится бесконечная рекурсия. Текущий код использует `genAllMoves` — это правильно по сути, но:
  - `genAllMoves` не проверяет, что ход не оставляет короля под шахом — это нормально для проверки шаха.
  - Однако `genAllMoves` может генерировать нелегальные ходы, которые "атакуют" короля через собственную фигуру — это edge case, который может дать false positive.
- **Фикс:** Оставить `genAllMoves` для проверки шаха (это стандартный подход), но убедиться, что `checkLegalMove` использует `genAllLegalMoves` через `checkCheck`.

### 3. Отладочные console.log

- **Где:** `src/lib/chessutils.js:135, 137, 139` (`checkCheck`)
- **Проблема:** `console.log(kingPos)`, `console.log(moves)`, `console.log("king in danger")` — засоряют серверный лог при каждом ходе.
- **Фикс:** Удалить или обернуть в `if (DEBUG)`.

### 4. `chessMakeMove` не обновляет `enPassantTarget`, `castlingRights`

- **Где:** `src/lib/chessutils.js:58-63`
- **Проблема:** `chessMakeMove` — это простое перемещение: ставит фигуру на новую клетку, обнуляет старую, переключает ход. Не обновляет никакие метаданные матча.
- **Фикс:** Добавить обновление `lastMove`, `kingMoved`, `rookMoved*`, `enPassantTarget`, `halfMoveClock`.

### 5. `startGame` для чёрных — неправильная инверсия доски

- **Где:** `src/public/js/gameSockets.js:62-75`
- **Проблема:** Инверсия доски для чёрных выполняется двумя циклами:
  1. Первый цикл: `board[i][j] ↔ board[7-i][7-j]` — поворот на 180°
  2. Второй цикл: `board[i][i] ↔ board[7-i][7-i]` — дополнительная инверсия по диагонали?
  - Второй цикл выглядит как ошибка — он инвертирует только диагональные клетки, что ломает симметрию.
- **Фикс:** Использовать одну операцию поворота на 180°:
  ```js
  let rotated = [];
  for (let i = 7; i >= 0; i--) {
    rotated.push(board[i].slice().reverse());
  }
  board = rotated;
  ```

### 6. Нет защиты от отправки хода не в свою очередь

- **Где:** `src/public/js/game.js:227-228`
- **Проблема:** `can_move` блокирует отправку, но визуально можно начать drag (условие `if(can_move) handle_drag()` на строке 287). Если `can_move == false`, drag не сработает — OK, но нет визуальной обратной связи (доска не "заблокирована").

---

## Сводная таблица

| Механика | Статус | Критичность |
|----------|--------|-------------|
| Рокировка (O-O, O-O-O) | ❌ Нет | 🔴 Высокая |
| Превращение пешки | ❌ Нет | 🔴 Высокая |
| En passant | ❌ Нет | 🟡 Средняя |
| Шах (визуал) | ⚠️ Частично | 🟡 Средняя |
| Мат | ⚠️ Нет различия с патом | 🟡 Средняя |
| Пат | ❌ Считается матом | 🟡 Средняя |
| Ничья (insufficient/threefold/50-move) | ❌ Нет | 🟢 Низкая |
| Нумерация доски для чёрных | ❌ Неверная | 🟡 Средняя |
| Инверсия доски (black startGame) | ❌ Подозрительный код | 🔴 Высокая |

---

## Приоритетный план работ

1. **P0:** Исправить инверсию доски для чёрных (`gameSockets.js:62-75`) — ломает отображение с начала игры
2. **P0:** Добавить рокировку (`chessutils.js`, `matchmaking.js`, `game.js`)
3. **P0:** Добавить превращение пешки (минимум: авто-ферзь на сервере)
4. **P1:** Разделить мат/пат (`chessutils.js`, `index.js`, `gameSockets.js`)
5. **P1:** Исправить нумерацию доски для чёрных (`game.js:174-195`)
6. **P2:** Добавить en passant
7. **P2:** Визуальная индикация шаха
8. **P3:** Убрать console.log из `checkCheck`
9. **P3:** Insufficient material, threefold repetition, 50-move rule
