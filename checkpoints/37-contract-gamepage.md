# Contract 37 — game-page defects (user report 2026-11-24, with screenshot) + directed design pass

User report (verbatim, Russian): captured pieces of white look white; the board is
shifted relative to the buttons; asymmetry — the "В лобби" button sticks to the
block under "Партия"; board borders are not symmetric; design is crooked/dated;
the wrong-move sound is loud, sharp, annoying; the sound fires even when you put
the piece back onto its own square (lift + drop in place).

Two sequential agents (shared worktree => NO file overlap):
- S-B3 (behavior): `src/public/js/game.js`, `src/public/js/gameSockets.js`,
  `src/public/audio/wrong_move_sound.mp3`, `test/e2e-client.mjs`, checkpoints `37-*.md`.
  May add up to ~20 lines of CSS ONLY inside game.css at a dedicated marker block
  `/* contract-37 S-B3 */` (keep D2's regions untouched).
- D2 (design, starts ONLY after S-B3 finishes): `src/public/styles/game.css`
  (full rewrite allowed outside the S-B3 marker block), `src/views/game.ejs`
  markup-only, `src/public/styles/tokens.css` (additive tokens only), checkpoints
  `37d-*.md`, screenshots `checkpoints/design-37/`.

## S-B3 — root-cause fixes
1. **Sound on lift-and-return**: the drag mouseup path (game.js ~line 440+) emits
   `move` even when to == from; the server rejects it; 'validated.rejected' plays
   wrong_move_sound + shake. Fix: on mouseup, if to == from -> silently restore
   (render_board, no emit, no sound, no shake). Check the click-to-move path too:
   clicking the same square must clear selection silently (verify, don't guess).
2. **Captured lists are polluted and mis-colored**:
   a. Removal: the mouseup capture push (`capturedByWhite.push...` ~line 448) is
      speculative — a REJECTED move leaves a ghost capture. Delete the push.
   b. Recompute from the board: `renderCapturedPieces()` derives both lists from
      the CURRENT `board` by comparing piece counts against the initial array
      (8P/2R/2N/2B/1Q/1K per color; clamp at 0 for promotions). Color bit:
      white=8/black=0, type = p & 0b0111, blank check `(p & 0b1111) === 0`.
      Idempotent, self-healing on reject/reconnect/reload; call it wherever the
      board is replaced (the `board = boardState` sites and reconnect/replay paths
      — grep all `board =` assignments).
   c. Colors: render glyphs with explicit classes — pieces CAPTURED BY white are
      BLACK pieces -> `<span class="cap-piece cap-dark">`, captured by black ->
      `cap-light`. In the S-B3 marker CSS block: `.cap-dark { color:#11161f;
      -webkit-text-stroke:.6px rgba(233,238,249,.7);} .cap-light { color:#eef2fb;
      -webkit-text-stroke:.6px rgba(17,22,31,.7);}` (solid glyph set + VS15).
   d. E2E: new row — registered pair, white drag e2-e4 then a REJECTED attempt
      (drag own piece back e4->e4 must make NO server move at all: assert no
      'move rejected' log line and no capture glyph); then white captures a black
      pawn (e4-e5 click path? use an actual capture in the scholar-mate line) and
      assert the captured strip contains a `.cap-dark` (black) glyph for white.
3. **Wrong-move sound**: regenerate `wrong_move_sound.mp3` with ffmpeg: soft low
   sine "duff" ~150 ms, ~180->140 Hz, fade-in 15 ms + fade-out 60 ms, lowpass,
   normalized to about -20 dBFS (NOT a click/buzz). Keep the filename. Also set
   `wrong_move_sound.volume = 0.35` after creation. Verify loudness by decoding
   peak (ffmpeg volumedetect) and record the numbers in the checkpoint.
4. Gate: `node --check`; `npm test` 101/101 (server untouched, keep green);
   E2E gate ALL PASS twice consecutive distinct free ports.

## D2 — directed design pass (game page), AFTER S-B3
Concrete defects to fix (from the user screenshot + report):
1. **Column width mismatch = the asymmetry**: `.game-header` is `min(95vw,560px)`
   while the board/captured strips/status/actions use 480px — every element must
   sit on ONE centered column: define `--game-col: min(95vw, 480px)` and use it
   for header, game-container, #status, #eloBadge, .game-actions; `margin-inline:
   auto`; board centered, equal side gaps; canvas keeps aspect (max-height 70vh
   rule must not break centering — wrap in a centered flex column).
2. Header: "← В лобби" left, "Партия" centered (absolutely centered in the column
   so the button never "sticks" to the title/block below), consistent vertical
   rhythm: header 56px, gap 12px, captured strip, board, captured strip, status,
   actions. Theme toggle must not overlap the title at 390px (title gets padding).
3. Captured strips: same width as the board, subtle card, min-height stable so
   the board never jumps when a glyph appears.
4. Overall freshness pass on the game page: consistent radii/shadows from tokens,
   action buttons equal height in a 2x2 grid on mobile / one row >=560px, status
   line as a quiet pill, no default h1 sizes anywhere, Russian labels kept.
   NO behavior/JS changes; preserve every id/class the E2E asserts (same
   preservation list as contract 36c, including the new cap-dark/cap-light).
5. Screenshots: /game as white 1280+390, /game black 390, both themes 1280,
   with a mid-game captured set (drive with the tmp-design tool pattern);
   save to checkpoints/design-37/; include them in the report.
6. Gate: E2E gate ALL PASS twice consecutive distinct ports; if a CSS/markup
   issue breaks a row, fix the CSS, never the tests.

## Orchestrator
Re-runs both gates at merged HEAD, reviews D2 screenshots via vision pass with
the concrete defect list, deploys, pushes, updates PR #3.
