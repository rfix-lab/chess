# 03 — C1 + C2: client chessutils.js (isKingInCheck + king-side castling path)

**Дата:** 2026-08-15 09:05 MSK
**Файл:** `src/public/js/chessutils.js` (client copy — only this file touched)
**Эталон (НЕ трогал):** `src/lib/chessutils.js` (server, 732 lines, ES module)
**Коммит:** (см. git log ниже — заполняется после коммита)

## Что исправлено

### C1 — `isKingInCheck` была undefined (ReferenceError)
- **Было:** `isKingInCheck(board, turn)` вызывалась в `kingMoveValidate` (строки 425 и 451 в HEAD) но НЕ была определена в клиентской копии → любой castling-запрос (и даже `genLegalMoves` через castling-ветку) падал с `ReferenceError: isKingInCheck is not defined`.
- **Стало:** добавлена `function isKingInCheck(board, turn)` **без `export`** (клиент — обычный скрипт, глобальные функции). Логика 1-в-1 с серверной `src/lib/chessutils.js:611` (export-версия). Вставлена прямо перед `kingMoveValidate` (новое начало блока ~строка 418-438; тело функции с 419 по 438).
- Серверная функция и клиентская идентичны по логике (поиск король-позиции через `king | currColor`, генерация ходов противника `black - currColor`, проверка попадает ли какой-то ход противника на короля).

### C2 — king-side castling path check был невалиден
- **Было (HEAD, строка 439):**
  ```js
  if (board[kingRow][6] !== blank || board[kingRow][7] !== blank) return false;
  if ((board[kingRow][7] & 0b0111) !== rook) return false;
  ```
  Противоречие: `[7]` требовалось **одновременно** blank (первая строчка) **и** rook (вторая). ⇒ king-side рокировка (O-O) никогда не проходила в подсветке. Плюс `[5]` (f-файл) вообще не проверялся — король мог «перескочить» над занятым f1.
- **Стало (строка 462):**
  ```js
  if (board[kingRow][5] !== blank || board[kingRow][6] !== blank) return false;
  if ((board[kingRow][7] & 0b0111) !== rook) return false;
  ```
  Точная копия серверного эталона (`src/lib/chessutils.js:513`): путь `[5]` и `[6]` (f1,g1) = blank, `[7]` (h1) = rook.
- **Queen-side (dx = -2), строка 465:** уже была корректной — `[1],[2],[3]` (b1,c1,d1) blank + `[0]` (a1) rook. Сверено с сервером — **совпадает**, не менял.

## Результаты верификации

- **(a) `node --check src/public/js/chessutils.js`** → SYNTAX OK.
- **(b) `/root/proj/chess/checkpoints/verify-c1c2.mjs`** (быстро-скрипт, имитирует позицию O-O для белых: король e1 = y7/x4, rook a1 = y7/x0, rook h1 = y7/x7):
  - **ДО фикса** (запущен на `git show HEAD:src/public/js/chessutils.js`): **0/6** — файл падает с `ReferenceError: isKingInCheck is not defined`, все castling-вызовы = `THROW:isKingInCheck is not defined`.
  - **ПОСЛЕ фикса** (рабочее дерево): **6/6 PASS**:
    - C1: `isKingInCheck` typeof = `function` ✅
    - O-O (f1,g1 blank + rook h1) → `true` ✅
    - O-O с занятой f1 (x=5) → `false` ✅
    - O-O с занятой g1 (x=6) → `false` ✅
    - O-O без права `whiteKingSide` → `false` ✅
    - O-O-O (b1,c1,d1 blank + rook a1) → `true` ✅
- **(c) `node test-evergreen.mjs`** → `35 accepted, 0 rejected out of 35 half-moves`, exit 0. (Сервер НЕ требует — тест самодостаточен, логику движка проверяет standalone.) Зелёный.
- **(d) `git diff --stat`** → единственный изменённый tracked-файл: `src/public/js/chessutils.js | 24 +++++, 1 -`. Новый файл `checkpoints/verify-c1c2.mjs` (untracked, добавляется в коммит). Серверный chessutils, game.js, gameSockets.js, index.js — **не тронуты**.

## git diff (только клиентская chessutils.js)
- `+` блок `function isKingInCheck(board, turn) { ... }` (23 строки) перед `kingMoveValidate`.
- `-` `if (board[kingRow][6] !== blank || board[kingRow][7] !== blank) return false;`
- `+` `if (board[kingRow][5] !== blank || board[kingRow][6] !== blank) return false;`
- Queen-side блок — без изменений.

## Само-чек
Верификация (b) ПОСЛЕ фикса показывает `true` там, где ожидается `true` (6/6). Коммит разрешён и сделан.
