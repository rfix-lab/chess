# T1 — автономные тесты + `npm test`

**Дата:** 2026-08-16
**Статус:** DONE (коммит 98886ae)

## Итог
- `npm test` из корня: **test-evergreen 35/35 PASS + test-chess 9/9 PASS**, exit 0, процесс завершается сам.
  (В T1-критерии было «8/8» — после исправления auth-флоу в тесте появилось 9-е
  прохождение «signup+login: real session IDs»; исходные 8 проверок сохранены.)

## Изменённые файлы
| Файл | Суть |
|---|---|
| `package.json` | `+ "test": "node ./test/run.mjs"` |
| `src/index.js` | `export { app, server, io }`; `server.listen(PORT)` только при запуске как main (`pathToFileURL(process.argv[1]).href === import.meta.url`). Standalone-запуск не сломан. |
| `test/run.mjs` (new) | in-process сервер: `server.listen(0)` → **ephemeral порт** (не 5500, не 5597/5599). Тестовые сьюты — child-процессы с `TEST_URL` на поднятый порт. Teardown: `io.close()` + `server.close()`, exit code = combined. |
| `test-chess.mjs` | (a) auth: вместо фиктивных `sess_w`/`sess_b` — реальный флоу `signup` → `signin` → `auth(реальный sessionID)`; (b) `crSeen` — «not seen» теперь ожидаемо (C3: сервер НЕ шлёт castlingRights, только доску) — не считается багом; (c) exit code = `failed === 0` (раньше всегда exit 0 при 3/8). |
| `.gitignore` | `!test/`, `!test-chess.mjs`, `!test-evergreen.mjs` — сьюты трекаются (ранее падали под `test-*.mjs` из debug-секции). |
| `test-evergreen.mjs` | не тронут (35/35 как был). |

Движки (`src/lib/chessutils.js`, клиентская копия) и клиент — **не тронуты** (git diff это подтверждает).

## Корневые причины старых падений (5/8 → 0)
1. **spawnSync замораживает сервер** (главная): ранний вариант `test/run.mjs` использовал `spawnSync` —
   синхронный spawn блокирует event loop родительского процесса, где жив in-process сервер, и
   websocket-хендшейк дочернего клиента вечно зависал (верификация: child `TIMEOUT no connect` при живом сервере;
   parent-кlient в тот же момент коннектится). Фикс: **async `spawn`** + `await`.
2. **Устаревший auth**: `socket.emit('auth', 'sess_w', null)` — фиктивные сессии; `validateSession` их
   отклоняет (`authFailed`), гостевого режима больше нет → `Match created: null`, 0 validated. Фикс: реальный
   signup/signin с уникальными именами.
3. **castlingRights**: тест ждал `castlingRights` в `validated` — по C3 сервер по дизайну шлёт только доску.
   Ожидание поправлено (инфо-лог, не fail).
4. **exit code**: test-chess всегда выходил 0 (3/8 проходили) — runner не видел фейлы. Теперь `process.exit(failed ? 1 : 0)`.

## Несоответствий ожидания тестов / багов сервера
Настоящих багов сервера не найдено. Единственное расхождение — castlingRights в `validated` — осознанное
архитектурное решение C3 (задокументировано в 05-c3-sync.md), не баг.

## Верификация (факт)
```
$ npm test
[runner] in-process test server up at http://localhost:4XXXXX (ephemeral)
test-evergreen: … === 35 accepted, 0 rejected out of 35 half-moves ===
[runner] test-evergreen.mjs: PASS
=== Chess Integration Tests ===
✅ Client 1 connected
✅ Client 2 connected
✅ signup+login: real session IDs
✅ Match created
✅ All 7 moves accepted (incl. castling)
✅ C1 validated count OK (7)
✅ C2 validated count OK (7)
ℹ️ castlingRights not in validated events — expected (server sends board only, by design since C3)
✅ Move after disconnect handled (no crash)
✅ Disconnect handler tested
=== Results: 9/9 passed, 0 failed ===
[runner] test-chess.mjs: PASS
[runner] ALL TESTS PASSED
npm test exit: 0
```
- `PORT=5501 node src/index.js` → `Live on 5501`, `GET /` → 302 (redirect /index), порт слушался, после `timeout 5` убит.
- `node --check`: `src/index.js`, `test-chess.mjs`, `test/run.mjs` — OK.
- `git diff --stat` (до коммита): `package.json +2/-1`, `src/index.js +13/-4`, `.gitignore +7`, новые: `test/run.mjs`, `test-chess.mjs`, `test-evergreen.mjs`. Ничего в `src/lib/` и `src/public/`.

## Решения
- **Ephemeral порт вместо фиксированного**: `listen(0)` исключает конфликты с живым dev-сервером (5500)
  и с портами прошлых верификаций (5597/5599).
- **Экспорт из `src/index.js`, а не отдельный модуль**: создание app/io/server уже связано с модульными
  состояниями (users, matches, rateLimits) — вынос ломал бы их. Main-guard через `import.meta.url` минимально инвазивен.
- **Тесты в child-процессах, не in-process**: изоляция состояния (users/matches не загрязняются между сьютами),
  как и в раннем варианте; единственный нюанс — только async spawn.
