# C4 — Guest matchmaking regression (P1)
**Дата:** 2026-08-16, найдено post-audit (после деплоя полного аудита), воспроизведено и зафиксировано в prod.

## Симптом
Два гостя (без логина) открывают `https://mycheserv.duckdns.org/game` → оба на «Waiting for player...», доска не появляется, игра не начинается.

## Корневая причина
`src/index.js` auth-хендлер:
```js
if (!sessionID || !validateSession(users, sessionID)) {
  socket.emit('authFailed');
  return;
}
```
Гость шлёт `sessionID = null` (нет cookie) → `!sessionID` = true → `authFailed` → `findMatch`/`findPrivateMatch` не вызываются → матч не создаётся.

Регресс введён в `e4f1b02` («fix: all 12 errors + bcrypt auth + session validation + XSS fix + memory leak cleanup»). Оригинал (`ec52707`, baseline Cherry) позволял гостей:
```js
// if sessionID is undefined, then the user plays as a guest
```
README и UI (index.ejs: «both users can simply play as guest and their matches aren't saved on the server») обещают guest-режим.

## Воссоздание
2 клиента (socket.io-client, `emit('auth', null, null)`) → оба `authFailed`, `GUEST MATCHMAKING BROKEN`.

## Фикс
```js
if (sessionID && !validateSession(users, sessionID)) {
  socket.emit('authFailed');
  return;
}
```
Пустой/undefined `sessionID` = гость → проходит в матчмейкинг. Невалидный непустой `sessionID` → `authFailed` (безопасность не ослаблена: чужой сессионный токен по-прежнему отклоняется). Остальная логика auth (matchId null → findMatch, иначе findPrivateMatch) — не тронута.

## Регресс-тесты (test-chess.mjs, +3)
- T-GUEST: 2 гостя (sessionID=null) → оба `startGame`, разные цвета (0 и 1), один gameId.
- + 2 дополнительных (невалидный сессионный токен → authFailed; см. файл).
Итог: test-chess 9 → **12/12**, npm test ALL PASS.

## Верификация
- `npm test`: evergreen 35/35 + test-chess 12/12, exit 0
- in-process repro: `GUEST MATCHMAKING OK` (2 startGame)
- **Prod**: rebuild → `docker save|ssh first docker load` → `docker service update --force chess_cherry`
  - image id совпадает на elastic2 И first: `119b604f9858` (урок: swarm не реплицирует образы; проверять worker)
  - контейнер `Up 2 min (healthy)`, в логах `Live on 5500`
  - внешний `https://mycheserv.duckdns.org/index` → 200 (5 раз подряд)

## Коммит
21dbe35 (fix + 3 regression tests + deploy 119b604f) + f33d84d (report) + 6b3e270 (issue in PLAN)
