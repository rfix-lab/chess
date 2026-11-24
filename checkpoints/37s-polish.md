# 37s-polish — contract 37 D-b: final visual polish on the game page

One file changed: `src/public/styles/game.css` (appended marked block
`/* contract-37 D-b */`; D-a and S3 blocks preserved — S3 cap-dark/cap-light
rules verified byte-identical to HEAD). Screenshots re-taken in the seated
"Playing as white" state (guest pair, raw socket.io private-match, same
seating as the E2E gate).

Measured with `test/tmp-measure-37d.mjs` (puppeteer geometry, /snap/bin/chromium,
headless) at 390x844 and 1280x900, on port 8805 (before) / 8999 (after).
All gaps measured as `next.top - previous.bottom` (bounding boxes).

## 0) Header title centering (orchestrator addendum to the D-b brief)

Contract-37 item: header has "← В лобби" on the left and "Партия" centered in
the column. Markup (game.ejs, unchanged): `.game-header` flex row =
`a.nav-back` (~105px) + `h1.nav-title{flex:1;text-align:center}` +
`span.nav-spacer{width:52px}`. Because the back button is ~2x wider than the
right spacer, the flex:1 title's center was NOT the column center.

| metric (puppeteer) | before | after |
|---|---|---|
| 390: .nav-title center (px) | 221.53 | 195.0 |
| 390: viewport/column center (px) | 195.0 | 195.0 |
| 390: title-center delta (px) | 26.53 | 0.0 |
| 1280: .nav-title center (px) | 666.53 | 640.0 |
| 1280: viewport/column center (px) | 640.0 | 640.0 |
| 1280: title-center delta (px) | 26.53 | 0.0 |

Target <=2px met (0px). Fix (D-b block, CSS-only): `.game-header{position:
relative}` and `.game-header .nav-title{position:absolute; left:50%;
transform:translateX(-50%); flex:0 1 auto; max-width:100%; overflow:hidden;
text-overflow:ellipsis; white-space:nowrap}` — pins the title to the column
midpoint independent of the asymmetric back-button/spacer widths; the
higher-specificity `.game-header .nav-title` selector overrides D-a's
`flex:1` so the absolute centering wins. No E2E row asserts the title's
position, and all other D-b metrics (rhythm, tap targets, pill, strips) are
unchanged by this addition (re-verified below).

## 1) Vertical rhythm (gap between stacked blocks)

| gap | before 390 | after 390 | before 1280 | after 1280 |
|---|---|---|---|---|
| header -> captured-black | 0 | 12 | 0 | 12 |
| captured-black -> board | 0 | 12 | 0 | 12 |
| board -> captured-white | 0 | 12 | 0 | 12 |
| captured-white -> status | 12 | 12 | 12 | 12 |
| status -> actions | 12 | 12 | 12 | 12 |

How: each `.captured-row` now owns a 12px gap on both sides
(`margin: var(--sp-3) 0`); `#status` sets `margin: 0 auto var(--sp-3)` so its
top margin (0) does not stack with the white strip's bottom margin — adjacent
block margins collapse, they never sum. `.game-header` keeps D-a's top padding
(no bottom margin added, which would have stacked to 24px). Result: uniform
12px (= var(--sp-3)) rhythm, no doubled margins.

## 2) Action bar tap targets / single row

| metric | before 390 | after 390 | before 1280 | after 1280 |
|---|---|---|---|---|
| bar height (px) | 148 (3 rows) | 89 (2 rows) | 96 (2 rows) | 44 (1 row) |
| control heights | 44 each (min-height) | 44 each (fixed) | 44 each | 44 each |
| method select height | 44 | 44 | 44 | 44 |
| control widths (px) | [142,111,118,170,80,92] | [91,70,73,113,44,53] | [142,111,118,170,80,92] | [91,70,73,113,44,53] |
| bar width (px) | 347 (2-3 row wrap) | 347 (2-row wrap) | 456 | 456 |
| horizontal overflow | sw 390=iw (ok) | sw 390=iw (ok) | sw 1280=iw (ok) | sw 1280=iw (ok) |

How: `.game-actions { gap: 1px }`, `.game-actions > .game-btn {
height:44px; padding:9px 3px; font-size:var(--fs-xs); letter-spacing:-0.7px;
flex-shrink:0; white-space:nowrap }`, `#method-select { height:44px;
flex:0 0 70px; width:70px; min-width:0; padding:9px 4px; font-size:
var(--fs-xs); letter-spacing:-0.7px }`. Natural 13px labels would need
~470px of content + gaps in the 456px bar (2 rows); the compact 12px labels
+ pinned 70px select fit 443.6px + 10px gaps < 456px => ONE row at 1280.
At 390 (347px bar) the same six controls wrap to a balanced 2+3 two-row grid
(row 1: link+select+takeback=234px; row 2: draw+challenge+resign=151px),
scrollWidth stays 390 — no horizontal overflow. Select height == button
height == 44px.

## 3) Status pill

| metric | before | after (both viewports) |
|---|---|---|
| #status width (px) | 371 (390) / 480 (1280) — full column | 155 (hugs "Playing as white") |
| #status center (px) | 195 / 640 | 195 / 640 |
| page center (px) | 195 / 640 | 195 / 640 |
| board width (px) | 382 / 482 | 382 / 482 |

How: `#status { width: fit-content; max-width: var(--game-col);
margin: 0 auto var(--sp-3) }`. Pill now hugs its text, is visually centered
(center == page/board center, measured 195@390, 640@1280) and (155px) can
never be wider than the board (382/482px).

## 4) Captured strips: stability + baseline

| metric | before 390 | after 390 | before 1280 | after 1280 |
|---|---|---|---|---|
| empty strip height (px) | 30 | 42 | 30 | 52 |
| filled strip height (3 glyphs) (px) | n/a (measured in D-a pass: 31) | 43 | n/a | 52 |
| board top after injecting 3 glyphs (px) | n/a | 127 (+1px, subpixel) | n/a | 136 (jump 0) |

How: `.captured-row { align-items: baseline; margin: var(--sp-3) 0;
min-height: 52px }`. 52px is the exact height of a filled strip at the 24px
desktop font (36px line-box + 12px padding + 2px border); an EMPTY strip now
renders at the same 52px, so the board does not move when the first capture
glyph appears (stripProbe: jump 0 at 1280, 1px subpixel at 390 where the
18px-font filled strip is 43px < 52px). `align-items: baseline` keeps all
glyphs on one baseline. (S3 cap-dark/cap-light color rules untouched.)

## 5) Screenshots (re-taken, overwrote)

- checkpoints/design-37/game-390.png (390x844, seated as white)
- checkpoints/design-37/game-1280.png (1280x900, seated as white)
- checkpoints/design-37/game-390-actions.png (390 viewport, scrolled to action bar)

## Gate

bash test/e2e-gate.sh <free port> | grep -E "FAIL|SUMMARY"
=> (see commit report)
