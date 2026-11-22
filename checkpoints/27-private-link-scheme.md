# 27 — Приватная ссылка без схемы → «Cannot GET /mycheserv.duckdns.org/game» (2026-11-23)

**Симптом (прод, юзер rfix):** сгенерированная ссылка `mycheserv.duckdns.org/game?matchId=0`; браузер открыл `https://mycheserv.duckdns.org/mycheserv.duckdns.org/game` → Cannot GET.

**Корень:** `src/public/js/indexSockets.js:125` — `window.location.host` (без схемы) как href/текст → браузер считал относительным путём.

**Фикс (коммит `99eb3bd`):** `window.location.origin` (https://...); `innerHTML` → `textContent` для текста ссылки.

**Деплой:** build cherry:latest = sha256:ad8e29a36920 (elastic2==first, docker save|ssh load). ⚠️ `stack deploy` НЕ пересоздал задачу — tag в spec не изменился → нужен `docker service update --force chess_cherry` (уроки: 16:15 августа). После force: converged, healthy на first, /index 200, /game?matchId=0 200, serv-ed indexSockets.js sha256 58e06b5b == repo, grep location.origin=2.

**Нюанс для юзера:** рестарт чистит RAM-матчи → старые matchId умерли, ссылку генерить заново; браузеру нужен hard-refresh (старый JS в кэше).
