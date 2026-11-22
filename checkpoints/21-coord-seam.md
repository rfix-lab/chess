# 21 — coord-seam: client-fix stage (completed by orchestrator)

Worktree `/root/proj/chess-coordseam`, branch `feat/coord-seam-input`.
Agent lineage: F1 (died twice mid-debug on provider timeouts, left commits b19fa5b/8f529af/a47b39c/017aaed), F1b (died third time after reproducing 36/44). Orchestrator finished root-cause analysis and fixes directly; every claim below has E2E/log evidence.

## 1. Decisions

- Invariant kept as decided by orchestrator: internal `board` is VISUAL orientation (rotated for black); all orientation math only via `layout.js`. Not re-litigated.
- fix A (a47b39c) was incomplete and fix C (017aaed) left a hole — both superseded by 619cbb0 (see §3).

## 2. Harness corrections (with citations)

1. EN PASSANT indicator asserted on the pawn's LANDED square, not the square behind it. Proof: src/index.js:33 `INDICATOR_EN_PASSANT = 0b1000000`; src/index.js:348-352 `sentBoard[4][x]` for white e2-e4, `sentBoard[3][x]` for black e7-e5. The old constants `EP_AFTER_E4={4,3}`/`EP_AFTER_E5={4,4}` were swapped AND pointed at the wrong convention; now `{4,4}`/`{4,3}` respectively. (The bit constant itself was already correct; checkpoints/20 report quoted the constants wrong - actual values are LAST=16, CHECK=32, EP=64.)
2. Bug-A assertion: old form compared the NORMALISED (server-oriented) black board against the ROTATED expectation — an inverted check that demanded the buggy unrotated state and could never pass. New form: normalised==start for both pages AND raw black internal==rotateBoard(start,1) (true regression of bug A).

## 3. Product bugs found / fixed (commit 619cbb0)

1. Rotation for unassigned color. `window.onload` guard `my_color != 0` is TRUE for `null` (loose compare; null != 0), and `rotateBoard` treated only `color === 0` as identity — so a page whose `startGame` had not arrived yet got its board 180-flipped. E2E DIAG evidence: white page row0 == white back rank at game start; explains S1 both-false and E-ill boardUnchanged=false (white pawn missing from e2 at read time). Fix: strict `my_color === 1` guard + `color !== 1` identity in layout.js.
2. Post-drag desync (S2/S3 sync rows: exactly the DRAG destination square empty one move later on the mover's page). `completeDrag()` emitted 'move' but left `is_holding_piece` set; while `is_being_validated` was true `handle_drag()` early-returned, and on the first tick AFTER `validated` had replaced the board with the fresh server array, its dragSettled branch blanked the cursor square of the NEW board — wiping the just-confirmed piece. Fix: completeDrag clears the whole hold state itself; handle_drag's mouse-up branch is now cancel-only (mouse released outside canvas) and never mutates the board for a completed drop.
3. E-ill and all indicator/mate rows were consequences of 1-2, not independent defects.

Residual (deferred to F3, needs src/index.js validated payload -> conflicts with engine branch):
- Client `lastMove` is set only for CLICK-path moves of the LOCAL player (sendMoveToServer); the DRAG path and the OPPONENT's moves never update it (S2 of checkpoints/19) — client-side EP target detection for the opponent's double push is therefore incomplete; server validation unaffected. Fix direction: carry `match.lastMove` in the `validated` payload.

## 4. En-passant residual

No server-side defect: after the harness constants were corrected per §2.1, EP bits appear on both pages for both double pushes (E2E rows M1/M2 PASS).

## 5. E2E final (test/e2e-client.mjs, commit 9abcb0e)

- run 1 (port 6482): `ALL PASS`, 42/42 rows
- run 2 (port 6483): `ALL PASS`, 42/42 rows
Covers: seating, both-page initial boards (normalised + raw bug-A check), illegal raw emit (REJECTED + shake + board untouched), 11-move game (2 drags + 9 clicks incl. O-O), per-move server `move: APPLIED`, both-page board sync after every move, EP bits after both double pushes, check bit + mate status on both pages, zero console errors.

## 6. Gates

- npm test (43/43): PASS
- node test/e2e-client.mjs run1: 42/42 PASS
- node test/e2e-client.mjs run2: 42/42 PASS

## 7. Commits

- b19fa5b feat: layout.js seam (F1)
- 8f529af refactor: 4 rotation sites through seam (F1)
- a47b39c fix A, first attempt (superseded by 619cbb0, kept in history)
- 017aaed fix C: event-driven drag (foundation kept; hold-state hole closed in 619cbb0)
- 619cbb0 fix(client): bug-A residue + drag desync (+ __chessDebug hook)
- 9abcb0e test(e2e): tracked regression gate + package.json test:e2e
- (this file) docs
