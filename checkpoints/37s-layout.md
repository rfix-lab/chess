# 37s — game page layout: single centered column (D-a)

Date: 2026-11-24. Repo: /root/proj/chess, branch feat/user-account, base HEAD d7e3ba3.

## Problem

The game page was horizontally asymmetric: the header/status area rendered at
560–620px while the board was capped at 480px, so the page looked lopsided.

## Width sources found (BEFORE)

| Selector            | File | Property          | Value (before)          |
|---------------------|------|-------------------|--------------------------|
| `.game-header`      | src/public/styles/game.css | `width` | `min(95vw, 560px)` (plus `max-width: calc(100vw - 32px)`) |
| `#status`           | src/public/styles/game.css | `width` | `min(95vw, 520px)` (plus `max-width: calc(100vw - 32px)`) |
| `.game-actions`     | src/public/styles/game.css | `width` | `min(95vw, 620px)` |
| `canvas#cnv`        | src/public/styles/game.css | `max-width` | `min(95vw, 480px)` |
| `.captured-row`     | src/public/styles/game.css | `width`/`max-width` | `min(95vw, 480px)` / `calc(min(95vw, 480px) - 24px)` |

Board canvas geometry lives in src/public/js/layout.js (`CELL_CAP = 480`,
mirrors the CSS 480px cap) — out of scope per contract.

## Fix (AFTER)

One column variable in game.css, marked `/* contract-37 D-a */`:

```css
:root {
  --game-col: min(95vw, 480px);
  ...
}
```

All five blocks above now use `width: var(--game-col)` (canvas keeps
`max-width: var(--game-col)`; `#status` uses it as a plain width; header,
captured rows and action bar use `max-width: calc(var(--game-col) - 24px)`
to stay inside the column despite box/borders). All remain centered via
`margin: 0 auto` / parent `align-items: center`. The conflicting
560px/520px/620px literals are gone.

game.ejs: added a `<body>` comment documenting the single-column contract so
future edits do not reintroduce per-block widths. No Russian text or status
strings changed; the `/* contract-37 S3 */` cap-dark/cap-light block untouched.

## Mobile gate

At 390px viewport: `--game-col = min(95vw, 480px) = 370.5px` < 390px, so every
block collapses to 95vw with 5vw side gaps — no horizontal scroll. Screenshots
in checkpoints/design-37/game-390.png and game-1280.png.

## Gate

`bash test/e2e-gate.sh 8899 | grep -E "FAIL|SUMMARY"` -> `SUMMARY: 61/61 rows PASS, matchId=r7hq1v3p`
(first run; no X10/X11 mover-turn flake, no rerun needed). `node --check` on
src/index.js and all touched client JS (untouched this task) pass; the CSS/EJS
edits are non-JS.
