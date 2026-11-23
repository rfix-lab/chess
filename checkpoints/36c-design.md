# 36c — D1 designer plan (contract 36, UX round 3)

Branch `feat/user-account`, base HEAD `98987b7`. Role: designer. Scope:
`src/public/styles/*.css` (all) + MARKUP-ONLY edits in `src/views/*.ejs`.
No JS (`src/public/js/**`), no server (`src/index.js`, `src/lib/**`,
`test-chess.mjs`, `test/e2e-client.mjs`).

## Design language

Cohesive dark board-game aesthetic ("evening club" feel):

- **Tokens** — new `src/public/styles/tokens.css` linked FIRST from all five
  page `<head>`s (index, game, users, user, account). One canonical set of
  CSS custom properties, dark default, light override via `data-theme="light"`
  AND `@media (prefers-color-scheme: light) :root:not([data-theme])` (the
  lobby has no theme toggle and follows the OS scheme; game/users/user/account
  have the toggle and set `data-theme` on `<html>` — same dual pattern the
  current CSS files already use).

  Token families:
  - color: `--bg-0`, `--bg-1`, `--bg-glow` (radial backdrop), `--card`,
    `--card-2` (inset/nested surface: inputs, menu, captured strips),
    `--line` (card border), `--line-strong`, `--text`, `--text-dim`,
    `--text-faint`, `--accent` (royal blue #6c8cff family), `--accent-strong`,
    `--accent-ink`, `--ok`, `--ok-soft`, `--danger`, `--danger-soft`,
    `--warn`, `--warn-soft`, `--focus-ring`.
  - board: `--board-light`, `--board-dark` — slate/steel in dark, warm wood
    in light (kept, harmonized with the chrome).
  - type: `--font` (one system stack for all pages), `--fs-xs 12 / sm 13 /
    md 14 / lg 16 / xl 18 / 2xl 22 / 3xl 30`, `--lh` 1.5.
  - space: `--sp-1 4 --sp-2 8 --sp-3 12 --sp-4 16 --sp-5 24 --sp-6 32 --sp-7 44`.
  - shape: `--r-sm 8 --r-md 12 --r-lg 16 --r-pill 999px`, `--shadow-1`,
    `--shadow-2`, `--focus-ring`.
  - motion: `--t-fast 0.12s`, `--t 0.2s`.

  Page CSS files are refactored to CONSUME the tokens and drop their own
  duplicated `:root` blocks (index.css and account.css currently redefine
  overlapping vars with slightly different values — that is the current
  inconsistency). The three board colors game.js reads via
  `getComputedStyle(root).getPropertyValue('--board-dark'|'--board-light'|'--text')`
  (game.js:767-771) keep the same names and remain on `:root` — no JS change
  needed.

  tokens.css also carries the shared component vocabulary (used by every page):
  `button` reset + `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`,
  `.btn-ghost`, `.chip` (pill stat), `.card`, `.page` (page shell: max-width,
  padding, centering), `.page-nav` (header pattern: back-link left, title
  center — one pattern across users/user/account), `.nav-back`, `.toast`,
  `.modal-overlay`, `.modal-box`, `.empty-row`, and the hide/show mechanism:
  `.hide { display: none !important; } .show { display: initial; }` — the
  classList pattern stays the ONLY visibility mechanism.

## Per-page work

### index.ejs / index.css — lobby
- head: add `<link rel="stylesheet" href="styles/tokens.css">` before
  `index.css`. No script-order changes.
- Markup: wrap main content in `<div class="lobby-shell">`; stack unchanged
  element ids (play-button, users-button, login-button, register-button all
  stay on the same `<button>`s, classes `big-btn`/`mid-btn` stay).
- Visual hierarchy (design goal: big-button stack visually dominant):
  - [Играть] = primary: accent-filled, 60px tall, 18-19px semibold, shadow-2 —
    the one saturated element on the page.
  - [Пользователи] = secondary card (surface + border), same 60px width/height
    family so the stack reads as one object.
  - [Вход] = secondary card (was accent — demoted; login is not the main
    action).
  - [Регистрация] = ghost: dashed border, text-dim, 40px.
- Invites card: gets a distinct "incoming" treatment — accent-tinted left
  border strip (3px) so a pending invite reads as actionable at a glance;
  rows: name + Elo chip + method chip, [Принять] accent button (classes
  invite-row / invite-label / invite-accept unchanged).
- Auth card, fields, banners (#auth-success green-soft, #auth-fail /
  #signup-fail red-soft) restyled on tokens; 390px width: single column,
  44px+ targets for inputs/buttons.
- `#authed` row (Кабинет / Выйти) becomes a compact pill pair, centered.

### game.ejs / game.css — game
- head: add tokens.css link before game.css.
- Markup: move `#themeToggle` (currently outside `<body>`, before the
  `<body>` tag) inside `<body>` right after the opening tag — markup only,
  all ids intact (themeToggle/themeIcon same elements); the game page gets the
  shared `.page-nav` header row (back link `← В лобби` + centered title
  `Партия` + theme toggle pinned right as today). Script order untouched.
- Action row: keep ids (game-actions, btn-game-link, btn-invite,
  method-select, btn-takeback, btn-offer-draw, btn-challenge, btn-resign);
  Russian labels only (no emoji, no marketing tone): `Ссылка на игру`,
  `Пригласить игрока`, `Взять назад`, `Предложить ничью`, `Вызов`, `Сдаться`,
  select `Классика`/`Рапид` (option values/labels unchanged — E2E X8 asserts
  `label === 'Классика'` / `'Рапид'`). Button roles: secondary for
  link/invite/takeback, warn for challenge, danger for resign. method-select
  keeps its own id styling, harmonized with the buttons (44px min touch).
- Status pill + elo badge: token-driven, consistent with other pages.
- Modals: gameLinkModal, resignModal (h3 `Сдаться?`), drawOfferModal,
  challengeModal, takebackOfferModal, gameEndModal — one `.modal-box`
  component (card + border + shadow-2), primary/secondary/danger/success
  buttons from tokens; replay box restyled (row hover, monospace move list
  optional). Russian modal texts (no emoji): `Сдача`, `Предложение ничьей`,
  `Вызов`, `Взятие хода`, `Выберите фигуру` (promotion), `Внимание`
  (repetition — its inline styles are replaced by a `.repeat-modal` class).
- Toast: shared tokens toast, same geometry on all pages.
- Board: canvas keeps layout.js geometry (480px cap, 70vh); border-radius +
  shadow from tokens; captured strips use `--card-2`.

### users.ejs / users.css (+account.css shared parts) — directory
- head: add tokens.css link (order: tokens.css, account.css, users.css —
  script order unchanged).
- Markup: `.page-nav` header (back `← В лобби` left, title `Пользователи`
  center, theme toggle right); the existing `.account-foot` back link is
  dropped (replaced by the header link — E2E asserts no footer element).
- Table: `.games-table` shared from account.css — rows `min-height: 48px`
  (≥44px touch target), `td` padding from space scale, Elo/Игр columns
  right-aligned tabular-nums, header row uppercase 12px dim. Row hover =
  `--card-2` + accent left hairline; `.user-self` row: accent-soft wash +
  the "(вы)" suffix is added by users.js text (unchanged).
- Context menu (user-context-menu / user-menu-head / user-menu-item /
  user-menu-method / user-menu-invite): elevated card (shadow-2, line-strong
  border, 12px radius), head 12px dim, items 40px tall, method entries
  indented with dim color, hover `--card-2`.
- Toast: shared.

### user.ejs — public profile
- head: tokens.css link added.
- Markup: `.page-nav` header (back `← К списку` left, title = username
  center — `<h1>` stays inside the nav title slot, server-rendered `<%-
  username %>` intact); identity block: avatar circle (new `<div
  class="avatar">` with the initial letter of the name — markup only), name,
  `Elo: N` chip, `Сыграно партий: N` chip.
- notFound branch: same structure, message `Пользователь не найден` kept in
  the same `#`/elements (E2E X12 greps the raw HTML for that exact string —
  it stays in the tbody empty-row AND the head count slot; keep BOTH).
- Games table: same shared table; result cell renders as a colored chip
  (Победа ok-soft / Поражение danger-soft / Ничья warn-soft) — class names
  `result result-win|loss|draw` unchanged (E2E X10 reads `td` textContent,
  chip text == words today); Method column shows «Классика»/«Рапид».
- Footer back link dropped (header owns it).

### account.ejs — cabinet
- head: tokens.css link added.
- Markup: `.page-nav` header (back `← В лобби`, title `Кабинет`); same
  identity block as user.ejs (avatar initial + name + Elo chip + count chip);
  footer back link dropped.
- Games table: shared; adds `Elo до` / `Elo после` columns — numbers
  right-aligned; delta implied by the result chip colors.

## Preservation rules (from the dispatch)

(a) Every listed id / data-attribute stays on the same element:
play-button, users-button, login-button, register-button, form, form-title,
username, password, submit-auth, auth-success, auth-fail, signup-fail (+3
child h3s), invites, invites-list, invite-row, invite-accept, authed,
account-link, logout-button, action-stack, status, chess-board (the canvas
cnv carries it via id="cnv" — note the canvas id is `cnv`, keep),
game-actions, btn-resign, btn-offer-draw, btn-challenge, btn-game-link,
gameLinkModal, game-link-text, btn-game-link-copy, btn-game-link-close,
resignModal, btn-resign-cancel, btn-resign-confirm, method-select,
user-row, user-self, data-username, user-context-menu, user-menu-head,
user-menu-item, user-menu-method, user-menu-invite, toast, plus the
non-listed-but-E2E-touched: themeToggle/themeIcon, cnv, eloBadge,
invites, users-body, games-body, profile-games-body, games-table,
gameEndModal/replay-*, promotion*, btn-draw-*, btn-challenge-*,
btn-takeback*.
(b) User-visible texts stay Russian, no emoji, no exclamation-mark marketing
  tone (the game-page JS sets some status strings with emoji itself — those
  are JS, out of scope; EJS static texts I touch get de-emojified where the
  E2E does not assert the exact string: X8 options and X12's «Пользователь
  не найден» are asserted verbatim and stay byte-identical).
(c) Script tag order in each EJS file unchanged (only `<link>` additions).
(d) `.hide/.show` classList mechanism preserved; tokens.css owns the
  `.hide{display:none!important}/.show{display:initial}` pair.

## E2E hazards checked (test/e2e-client.mjs, 60 rows)

- A1: form hide / authed show / login-button+register-button hide classes —
  JS-managed, untouched.
- X2: `tr[data-username]` rows >=3 with exactly 3 `<td>`s each, name-asc
  order — keep three tds per row (no added `<td>`; avatar goes in the profile
  header, not the directory row).
- X3: invitee row cells `[name, '1500', '0']` and `user-self` class — the
  (вы) suffix only applies to the self row via JS, safe.
- X4: `#user-context-menu` head text contains username; items textContent
  === 'Рапид' / 'Классика' — menu DOM built by users.js, I only restyle.
- X5: toast text 'Приглашение отправлено' (JS-set) OR navigation — safe.
- X6: invitee lobby `#invites-list` row textContent contains the inviter name
  (JS-built label) — safe.
- X8/X9: method-select enabled, 2 options, labels exact — options untouched.
- X10: profile tbody rows, 4 tds, cell[1]=opponent, cell[2] in
  {Победа,Поражение}, cell[3]='Рапид' — result chip text must equal those
  exact words (it does: chip IS the text).
- X12: raw HTML contains «Пользователь не найден».
- Board geometry: layout.js reads viewport (800x900 in E2E); a page-nav
  header above the canvas does not change cellSize (min(vw-8,480,vh*0.7))
  and E2E clicks are computed from `#cnv`.getBoundingClientRect() — safe.
- Console-error row: new `<link>` must exist; theme.js/themeToggle behavior
  unchanged.

## Screenshot matrix (puppeteer-core + /snap/bin/chromium, --no-sandbox)

Script `test/tmp-design-36.mjs` (untracked, like tmp-smoke-ux3.mjs): starts
the server on a free port with a temp DATA_DIR, raw-socket signup+signin for
2 users (one has a finished game via the rapid-invite flow? — no, keep it
cheap: signup 3 users + one raw private match for /game), then screenshots
into `checkpoints/design-36/`:
- index-logged-out.png @1280, @390
- index-logged-in.png @1280, @390 (sessionID cookie set from raw signup+signin)
- users.png @1280, @390
- user-profile.png @1280, @390 (a user with games, seeded via raw match flow
  if cheap, otherwise the empty state is acceptable)
- game.png @1280, @390 (a real /game?matchId= page, board drawn, waiting state)
- account.png @1280, @390

Iterate on the CSS until the set is cohesive; final set saved; script left
in test/ untracked (or removed — either way not committed).

## Commits (incremental, English, no push)

1. `feat(css): shared design tokens + shared components (styles/tokens.css)`
2. `feat(css): lobby — dominant play action, card stack, invite card, auth banners`
3. `feat(css): game page — page header, action row, modals, Russian labels`
4. `feat(css): users directory + public profile — 48px rows, context menu, avatar header`
5. `feat(css): account cabinet — shared header/identity, table polish`
(+ a final doc commit for this checkpoint if desired)

## Gate

`bash test/e2e-gate.sh <free port from ss -ltn>` twice consecutive on
distinct ports => 60/60 ALL PASS. `node --check` not needed (no JS touched).

## Open risks

- Lobby light theme (OS-scheme) vs toggled pages: tokens.css carries both
  branches; verify the 390px lobby screenshot (OS scheme = dark in the
  container) looks right in dark; light-variant correctness is token-level
  only.
- game-page header addition: E2E board clicks are rect-based — low risk,
  verify on gate run.
- users.js positions the context menu with fixed px at the row rect — the
  restyled (taller) rows shift the anchor slightly; menu geometry code is
  JS (untouched) and rect-based, so it follows.
