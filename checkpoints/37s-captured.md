# Contract 37 — Stage S3: captured-pieces strips derived from the live board

Date: 2026-11-24 · Branch: feat/user-account · Base: 5af5ad1
Write scope: src/public/js/game.js, src/public/styles/game.css (append block `/* contract-37 S3 */` at END), this checkpoint.

## What was wrong
The strips were fed by speculative bookkeeping: `completeDrag()` pushed the
captured piece type onto `capturedByWhite`/`capturedByBlack` at EMIT time
(i.e. before the server accepted the move) and `renderCapturedPieces()` just
re-rendered those arrays (also reset to `[]` on startGame/reconnected).
Consequences:
- A rejected (illegal) drop left a ghost entry — the board kept the piece
  (rejection restores nothing) but the strip still showed it as captured.
- En-passant: the captured pawn is NOT the piece on the destination square,
  so the push-on-emit detection was wrong in principle.
- `reconnected` reset the lists while the restored board still contained
  earlier captures — strips emptied until the next capture.
- Both colors map to the SAME solid glyphs in `sprites[]`, so the HTML
  spans were identical — no color distinction at all (the original
  "captured pieces all look the same color" defect).

## Changes (game.js)
1. `completeDrag()`: deleted the `capturedByWhite.push / capturedByBlack.push`
   block (right after the return-drop guard). `old_piece`/`new_piece` kept —
   still part of the socket payload.
2. `renderCapturedPieces()` rewritten: scans the live `board` array
   (mask `& 0b1111` to strip indicator bits 0b10000+), counts each
   (color, type); expected initial per color = pawn 8, knight 2, bishop 2,
   rook 2, queen 1, king 1; captured count = max(0, expected − present)
   per (color, type). Pieces captured BY white = missing black pieces;
   BY black = missing white pieces. Order preserved via existing
   `sortCaptured()` (queen→rook→bishop→knight→pawn).

## Call-site finding (step 4)
`renderCapturedPieces()` is ALREADY CALLED EVERY FRAME: it sits in the
10 ms `setInterval` main draw loop, immediately after `render_board()`
(game.js, loop body: `draw(); handle_drag(); render_board();
renderCapturedPieces();`). The loop runs unconditionally, so the strips
re-derive from whatever `board` holds at every tick — board replacements
(`fen_to_board`, `validated`/`reconnected` payloads, the drag restore
writes) are all picked up on the next tick. NO extra call sites were added.
The stale `capturedByWhite/capturedByBlack` arrays are now written only
by gameSockets.js (startGame/reconnected resets) and read by nothing;
they are harmless dead state left in place to respect the write scope
(no edits to gameSockets.js).

## Spans / CSS
- Black pieces (captured by white): `<span class="cap-piece cap-dark">`
- White pieces (captured by black): `<span class="cap-piece cap-light">`
- Appended at the END of styles/game.css in a block marked
  `/* contract-37 S3 ... */`:
  - `.cap-piece.cap-dark { color:#11161f; -webkit-text-stroke:.6px rgba(233,238,249,.75); text-shadow:0 0 2px rgba(233,238,249,.35); }`
  - `.cap-piece.cap-light { color:#eef2fb; -webkit-text-stroke:.6px rgba(17,22,31,.75); text-shadow:0 0 2px rgba(0,0,0,.5); }`
- Step-6 conflict check: the only pre-existing `.cap-piece` rule is
  `.captured-row .cap-piece { margin: 1px; }` (game.css:189) — MARGIN
  ONLY, no `color` property; tokens.css sets a generic body-level `color:
  var(--text)` which our explicit `color:` overrides. NO CONFLICT.
  Strips remain visible in both dark and light themes (light theme flips
  the card background, the glyph colors + opposing-color text-stroke
  keep both glyph sets readable).

## Gate
- `node --check src/public/js/game.js` — OK
- `bash test/e2e-gate.sh <free-port> | grep -E "FAIL|SUMMARY"` — see final
  report (target 60/60).

## Caveats / follow-ups
- Promotion can create more pieces than the initial set; `max(0, …)` means
  extra captured pieces beyond the initial quota are simply not shown —
  acceptable for now (rare), tracked as a possible v2 (list actual captured
  pieces from server events instead of diffing against the initial set).
- King captures can't happen (check), so the king count stays 1/1.
