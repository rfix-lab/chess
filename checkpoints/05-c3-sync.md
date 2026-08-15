# C3 — синхронизация client/server chessutils

**Дата:** 2026-08-15
**Статус:** DONE
**Эталон:** `src/lib/chessutils.js` (732 строк, ES module, export) — НЕ ТРОГАТЬ
**Цель:** `src/public/js/chessutils.js` = точная SUBSET-копия серверной. Допустимые отличия:
нет `import assert` (assert-строки закомментированы), нет `export`, нет функций, не нужных клиенту
(`chessMakeMove`, `isGameEndReason`, `checkMateCheck`, `checkThreefoldDraw`, `isInsufficientMaterial`,
`isFiftyMoveRule`), константы определяет game.js (клиентская конст-блок закомментирован — как было).
**ИСКЛЮЧЕНИЯ (client-only, осознанно — см. раздел «Client-only» ниже):** `genLegalMoves` остаётся 4-arg
и `deriveCastlingRights` НЕ удалён — сервер не шлёт клиенту castlingRights (только доску), клиент
выводит их из доски для подсветки/click-to-move.

## Входное состояние (проверено grep'ом)

- `genLegalMatches`-вызовы в клиенте: `game.js:286` и `game.js:478` — `genLegalMoves(board, pos, null, lastMove)` (4 арг., старая клиентская сигнатура).
- `checkLegalMove`/`chessMoveValidate` извне chessutils клиентом НЕ вызываются (только внутри chessutils + server-side index.js:94 — свой серверный import, не трогать).
- `deriveCastlingRights` вызывается только из `genLegalMoves` внутри клиентской chessutils (grep по game.js/gameSockets.js: нет).
- `chessMakeMove`/`isGameEndReason`/`checkMateCheck`/`checkThreefoldDraw`/`isInsufficientMaterial`/`isFiftyMoveRule`/`genAllLegalMoves` в клиенте (game.js, gameSockets.js) НЕ используются (grep: только server-side index.js:10,94,127,...).
- `lastMove` (game.js:85) — `{from,to,piece}` в SERVER-координатах (game.js:312: `serverFrom/serverTo` + `visualPiece`). Передаётся в `genLegalMoves` и в `_wasPawnDoublePush` — client-копия уже работает с серверными координатами.
- C1+C2 (коммит bb03f89) уже внесены в клиент: `isKingInCheck` определён, king-side castling path `[5],[6] blank + [7] rook` — совпадает с сервером.

## Полный diff: 414 строк (checkpoints/tmp-c3.diff)

## План правок (12 расхождений из 01-inventory-src.md)

> ⚠️ **ПРИМЕЧАНИЕ:** строки #3 и #5 таблицы ниже отменены архитектурным решением (см. «Client-only» выше): `genLegalMoves` НЕ приводится к 2-arg, `deriveCastlingRights` НЕ удаляется — иначе ломается UI (подсветка/click-to-move рокировки и en-passant). Строки #1, #2, #4, #6 и доп. — выполнены как в таблице.

| # | Расхождение | Было (клиент) | Стало (клиент) |
|---|-------------|---------------|----------------|
| 1 | `_wasPawnDoublePush` сигнатура | `(lastMove, row, col, pawnColor)`, строка ~206 | серверная `(match, row, col, pawnColor)` — тело 1-в-1 |
| 2 | en-passant в pawnMoveValidate | `getPiece(...)==pawn && getColor(...)==black && _wasPawnDoublePush(match ? match.lastMove : null, ...)` | серверное: `board[moveFromCoord.y][moveToCoord.x] === (black \| pawn) && _wasPawnDoublePush(match, ...)` (и white-вариант) |
| 3 | `genLegalMoves` сигнатура | `(board, position, castlingRights, lastMove)` | серверная `(board, position)`; вызовы в game.js:286,478 → `genLegalMoves(board, pos, lastMove)` (2 строки) |
| 4 | validBoard-гвард в genAllMoves | активен (`if(!validBoard(board)) return [];`) | закомментирован 1-в-1 с сервером (`// if(!validBoard(board)) //     return [];`) — в genLegalMoves уже был закомментирован |
| 5 | `deriveCastlingRights` | определён (~:502), вызывается из genLegalMoves | удалён; вызовы обновлены (только внутренний, из genLegalMoves — см. #3) |
| 6 | прочие мелкие (комменты, порядок) | `checkLegalMove` ниже checkCheck; `// console.log("Move to: ", m.to)` в checkCheck; лишний blank line | порядок и тела 1-в-1 с сервером (server-order) |

Доп. (не в таблице 12, но часть subset-зрения):
- `genAllLegalMoves` — на сервере есть, в клиенте нет, клиентом не используется (grep) → добавлен 1-в-1 (subset-полнота: весь путь genAllMoves→genMoves→genAllLegalMoves идентичен серверу; без него diff client/server не был бы "subset-зеркалом").
- `checkLegalMove`: сервер проверяет `'castlingRights' in turnOrMatch`, клиент — `'turnState' in turnOrMatch` → приведено к серверному телу (1-в-1). Клиентский match-объект в genLegalMoves содержит `castlingRights` — поведение корректно.
- `isGameEndReason/checkMateCheck/checkThreefoldDraw/isInsufficientMaterial/isFiftyMoveRule/chessMakeMove` — НЕ добавляются (клиенту не нужны, grep подтверждён).

## Верификация

Скрипт: `checkpoints/verify-c3-sync.mjs` (новый; перезаписан черновик с багом в eval и неверной координатой en-passant). Два блока:

### (A) IDENTITY — тела функций клиент vs сервер

Регулярка `^(?:export\s+)?function NAME\s*\(` + баланс скобок → тело; нормализация (без комментов, без всех пробелов/переводов) → попарное сравнение. Результат: **18/18 PASS**:

checkLegalMove, chessMoveValidate*, checkCheck, pawnMoveValidate, _wasPawnDoublePush, whitePawnMoveValidate, blackPawnMoveValidate, knightMoveValidate, bishopMoveValidate, rookMoveValidate, queenMoveValidate, kingMoveValidate, genAllMoves, genAllLegalMoves, isKingInCheck, validBoard, coordValidate, turnValidate

\* `chessMoveValidate` — сравнение ПОСЛЕ удаления строк `assert.equal` (у сервера активные, у клиента закомментированы `// assert.equal(...)` — клиент без `import assert`). Diff = только комментарии → допустимое отличие, НЕ провал.

### Client-only (НЕ 1:1 с сервером — осознанно)

- **`genLegalMoves` (клиент, 4-arg: `board, position, castlingRights, lastMove`)** — отличается от серверной 2-arg. Причина: сервер хранит `castlingRights` в state матча и **НИКОГДА не шлёт их клиенту** (в эфир уходит только доска — см. broadcast в index.js). Клиентская копия нужна для подсветки ходов + click-to-move (game.js:333 гейтит клик по `moves` из `genLegalMoves`). Поэтому клиент выводит права из доски (`deriveCastlingRights`) и сам собирает match `{turnState, castlingRights, lastMove}` для валидаторов.
- **`deriveCastlingRights` (клиент-only)** — на сервере прав нет (есть в match state). Функция существует только потому, что сервер их не шлёт.
- **Если бы их привели к серверной 2-arg / удалили** → клик-по-рокировке и click-to-move en-passant перестали бы подсвечиваться (drag-and-drop отработал бы — он не гейтится, сервер валидирует авторитативно, но UI-подсветка сломалась бы). Именно это и случилось в первом C3-проходе, что побудило текущее решение. НЕ приводить, НЕ удалять.

### (B) UI REGRESSION — клиентский genLegalMoves реально запущен

Клиентский код eval'ится в скоупе с константами game.js:19-28 (blank/white/black/pawn/king/rook/queen/bishop/knight — их нет в клиентской chessutils, там закомментирован конст-блок); `noOfSquares/whiteTurn/blackTurn` + все функции — в самой chessutils.js. **7/7 PASS**:

- white O-O (king e1=(4,7), rook h1=(7,7), f1/g1 пустые) → (6,7) в moves
- white O-O blocked (pawn f1=(5,7)) → (6,7) НЕ в moves
- white O-O-O (rook a1=(0,7), b1/c1/d1 пустые) → (2,7) в moves
- black O-O (king e8=(4,0), rook h8=(7,0)) → (6,0) в moves
- en-passant e5xd6: белый (4,3), чёрный (3,3) (дубль-пуш (3,1)→(3,3)) + lastMove → (3,2) в moves
- то же без lastMove (null) → (3,2) НЕ в moves
- client code evaluates (нет ReferenceError)

> Координаты en-passant сверены по коду (whitePawnMoveValidate: white идёт на y-1; чёрная пешка стартует на y=1, дубль-пуш y=1→y=3; d5 = (3,3)). В брифе была ошибка (чёрная пешка (3,4), lastMove (3,6)→(3,4) — это паттерн БЕЛОЙ пешки; цель (3,4) тоже неверна, цель = (3,2)).

### Полный набор (все PASS)

| Проверка | Результат |
|---|---|
| `node --check src/public/js/chessutils.js` | OK |
| `node --check src/public/js/game.js` | OK |
| `node checkpoints/verify-c1c2.mjs` (regression C1+C2) | 6/6 |
| `node checkpoints/verify-c3-sync.mjs` | 27/27 (18 identity + 2 client-only + 7 UI) |
| `node test-evergreen.mjs` | 35/35 |
| `PORT=5599 timeout 6 node src/index.js` | "Live on 5599", сам умирает по timeout |
| grep game.js:286,478 | `genLegalMoves(..., pos, null, lastMove)` — 4-arg, верно |

## git

- Коммит: `refactor: C3 — client validators 1:1 with server; genLegalMoves/deriveCastlingRights kept client-only (server never sends castlingRights)` — hash в STATE.md.
- Файлы: `src/public/js/chessutils.js` (единственный изменённый код), `src/public/js/game.js` НЕ в diff'е (вызовы 4-arg уже были), `checkpoints/05-c3-sync.md`, `checkpoints/verify-c3-sync.mjs`.
