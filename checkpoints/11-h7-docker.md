# H7 — Docker-обвязка (Dockerfile + docker-compose.yml)

**Дата:** 2026-08-16 (13:08–13:30 MSK)
**Статус:** выполнено

## Было → стало

### Dockerfile
| Пункт | Было | Стало |
|---|---|---|
| FROM | `node:18-alpine` | `node:22-alpine` |
| Сборка | `npm ci --production` | `npm ci --omit=dev` (современный эквивалент, npm ≥8.3) |
| USER | не было (root) | `USER node` (встроенный non-root юзер alpine-образа) |
| CMD | `["npm", "start"]` | `["node", "src/index.js"]` (прямой запуск) |
| EXPOSE | 5500 (осталось) | 5500 |

- devDeps (socket.io-client, перенесённый T5/d56f19e) в образ не попадают: `--omit=dev` + `npm ci` по package-lock.json.
- `ENV PORT=5500` оставлено (src/index.js читает `process.env.PORT || 5500`, строка 70).

### docker-compose.yml
- `version: "3.8"` — **удалено** (deprecated в compose v2, compose v2.33.1 на эластике ругается предупреждением).
- **volumes: не добавлены.** Проверил src/ на запись файлов: `grep -rn "writeFile|createWriteStream|appendFile|fs.rm|mkdir" src/` — ноль совпадений. Пользователи/сессии/матчи живут в RAM (аудит). Persist-объектов нет → volume был бы лишний.
- **healthcheck добавлен:** `wget -qO- http://127.0.0.1:5500/` (alpine, busybox wget, без curl), interval 30s / timeout 5s / retries 3 / start_period 10s.
- Добавлено `restart: unless-stopped` (для swarm-реплики на `first`; остальные deploy-параметры/traefik-лейблы/external-сеть не трогал).

## Почему именно node:22-alpine
- Node 22 (Jod) — **актуальный LTS в 2026** (LTS с Apr 2024, maintenance до Apr 2027). Node 24 (current) становится LTS только в Oct 2025 и к августу 2026 находится в ранней LTS-фазе; 22 — проверенный, безопасный выбор.
- `engines` в package.json **нет** — жёсткой привязки к v24 нет; локальный v24.16.0 — это просто хостовая среда.
- Проект ESM (`"type": "module"`) — полностью поддерживается с Node 14+, на 22 без особенностей; bcrypt@6 (нативный модуль) имеет prebuilds для node:22-alpine (musl) — на 18-alpine (EOL Apr 2025) новые нативные зависимости начали бы ломаться.
- node:18-alpine — **EOL**, обновление обязательно.

## Docker-демон / валидация
- `docker info` — демон **работает** (сюрприз: на elastic2 swarm-нод, отсюда deploy-конфигuration). Build по задаче НЕ запускал (не требуется).
- `docker compose config` — **OK** (валидация проведена, compose v2.33.1, без предупреждений о version).
- `python3 -c "import yaml; ..."` — YAML_OK (двойная страховка).
- `npm test` из хоста: **35/35 + 9/9, ALL TESTS PASSED** — Docker-правки тесты не влияют, как и ожидалось.

## Важная находка: Dockerfile/docker-compose.yml в .gitignore
Строки 2–3 `.gitignore` игнорируют оба файла (они никогда не были в git — `git log --all -- Dockerfile` пуст). Т.е. docker-обвязка хранилась как локальный артефакт. Чтобы H7 реально вошёл в git, выполнил **`git add -f`** (без этого коммит был бы невозможен). .gitignore **не трогаю** (чужая территория, не входит в scope H7) — но если owner хочет держать compose в git, строки 2–3 в .gitignore стоит удалить отдельным решением.

## Self-check
- `git status --porcelain` до коммита: чужие dirty (src/index.js, src/lib/matchmaking.js, staged renames errors/→docs/archive/ от параллельного субагента, checkpoints/09-t5-deps.md) — **НЕ включены**.
- Коммит поимённый: `Dockerfile`, `docker-compose.yml`, `checkpoints/11-h7-docker.md`.
- .dockerignore (b686b05) не тронут, по-прежнему покрывает node_modules/, .git/, checkpoints/, tune/, debug/trace/check/test-*.mjs, *.bak.
