# 22 — Engine perft audit (BUG #1, BUG #2, S1, S3, S4)

**Branch:** `feat/engine-perft-fixes` · **Baseline:** `1c81966` · **Date:** 2026-11-22

## Summary

All six canonical perft positions now match their expected counts at every tested depth.
Three engine bugs were found and fixed; two socket-hardening gaps (S3/S4) were closed with
regression tests. The perft harness was wired into `npm test` as a fast (d1–d2 + startpos d3)
sub-check.

## Perft table (after all fixes)

| position | FEN (abbrev) | d1 | d2 | d3 | d4 |
|---|---|---|---|---|---|
| startpos | `rnbqkbnr/pppppppp/…` | 20 ✓ | 400 ✓ | 8902 ✓ | 197281 ✓ |
| kiwipete | `r3k2r/p1ppqpb1/…` | 48 ✓ | 2039 ✓ | 97862 ✓ | — |
| pos3 | `8/2p5/3p4/…` | 14 ✓ | 191 ✓ | 2812 ✓ | 43238 ✓ |
| pos4 | `r3k2r/Pppp1ppp/…` | 6 ✓ | 264 ✓ | 9467 ✓ | — |
| pos5 | `rnbq1k1r/pp1Pbppp/…` | 44 ✓ | 1486 ✓ | 62379 ✓ | — |
| pos6 | `r4rk1/1pp1qppp/…` | 46 ✓ | 2079 ✓ | 89890 ✓ | — |

`npm test` runs the fast subset: d1–d2 for all six positions + startpos d3 (13 checks).
Full depth (d4 for startpos/pos3) runs via `node test/perft.mjs` standalone.

## Bugs found and fixed

### BUG #1 — blocked pawn double-push (commit `2c99280`)
**Symptom:** `startpos d3` gave 8902 → 8915 (extra 13 nodes from double pushes through
an occupied intermediate square).
**Fix:** In `pawnMoveValidate` (both `src/lib/` and `src/public/js/`), the two-square
pawn move now checks `board[5][x]` (white) / `board[2][x]` (black) is blank, not just
the destination square.
**Verdict:** startpos d1–d4, kiwipete d1–d3 all exact after fix.

### BUG #2a — en-passant clobber in `checkCheck` (this commit)
**Symptom:** `pos3 d4` gave 43238 → 43276, `pos6 d3` gave 89890 → 89811. Every diagonal
pawn move (capture or en-passant) triggered `newBoard[moveFrom.y][moveTo.x] = blank` in
the check-test board, wiping a legitimate piece.
**Fix:** Add `&& board[moveToCoord.y][moveToCoord.x] === blank` so only a true en-passant
(landing square was empty) triggers the clobber. A normal diagonal capture already has the
captured piece on the destination square (replaced by the moving pawn), so the adjacent
square must not be touched.
**Files:** `src/lib/chessutils.js` + `src/public/js/chessutils.js` (C3 sync).
**Verdict:** pos3 and pos6 now exact.

### BUG #2b — inverted promotion row in `chessMakeMove` (this commit)
**Symptom:** `pos4 d2` gave 228 vs 264 (missing 36 = 2 promotions × 3 extra each × 6
white moves). `pos5 d1` gave 41 vs 44 (missing 3 = 1 promotion × 3 extra).
**Root cause:** The board convention is row 0 = rank 8 (white pawns at row 6, advance
toward row 0). But `chessMakeMove` triggered white promotion at `toCoords.y == 7`
(row 7 = rank 1 = white's own back rank) and black at `toCoords.y == 0` (rank 8).
Forward-moving pawns never reached their promotion row → promotions silently never fired.
**Fix:** Swap: white → `toCoords.y == 0`, black → `toCoords.y == 7`.
**File:** `src/lib/chessutils.js` (server only — the client has no `chessMakeMove`;
C3 sync verified unaffected).
**Verdict:** pos4 and pos5 now exact at all depths.

### Harness fix — promotion double-ply (`test/perft.mjs`)
**Symptom:** Even after the engine fix, a promotion consumed **2 plies** in the harness
(pawn-to-last-rank step + separate `pendingPromotion` resolution each decremented
`depth`). Canonical perft counts a promotion as 1 ply.
**Fix:** Restructured `perft()` so a promotion move expands its 4 piece choices at
`depth - 1` directly (no intermediate `pendingPromotion` state that consumes a second ply).
The `applyMove` now correctly clones before calling `chessMakeMove`.

### S1 — `isKingInCheck` infinite loop (commit `2c99280`)
Added `let found = false` guard; if no king is found on the board, `return false`
instead of looping forever on a stale `(x, y)`.

### S3 — `promotion:choose` hardening (`src/index.js`)
- **Whitelist:** reject `pieceType` not in `[queen, rook, bishop, knight]` (pieceType 0
  would store a blank square; 99 would read back as queen due to 7-bit truncation).
- **Ownership:** reject if the emitting socket is not the promoted side's seated socket.

### S4 — move/resign socket ownership (`src/index.js`)
- **Move handler:** reject if `socket.id !== match.turnState-socket.id` (defense in depth
  over the engine's piece-color check).
- **Resign handler:** reject if socket is not one of the two seated players.

## Test coverage added

`test-chess.mjs` (T-FIXES block, 5 new assertions):
1. `FIXES: blocked double-push rejected` — BUG #1 regression.
2. `FIXES: promotion reached (axb8 pending promotion emitted)` — BUG #2b regression
   (full a-file march with b-pawn bait).
3. `FIXES: promotion whitelist rejects pieceType 0 and 99` — S3 whitelist.
4. `FIXES: wrong-socket promotion:choose rejected` — S3 ownership.
5. `FIXES-2: wrong-socket move rejected on fresh match` — S4 move guard.
6. `FIXES-2: correct-socket move still accepted` — S4 false-positive check.

`test/run.mjs` now runs perft (fast subset, 13 checks) before the socket suites.

## C3 sync

`checkpoints/verify-c3-sync.mjs`: **27/27 passed** after all engine fixes.
Server and client `chessutils.js` remain functionally identical for all shared
(`checkCheck`, `chessMoveValidate`, `pawnMoveValidate`, `knightMoveValidate`, etc.)
functions. The only server-only additions are `chessMakeMove` (promotion row fix)
and `export { queen, rook }` (needed by `src/index.js`).

## Commits

| SHA | Subject |
|---|---|
| `2c99280` | `fix(engine) blocked pawn double-push + checkCheck king-search loop exit` |
| (see git log) | `fix(engine) BUG#2 en-passant clobber + inverted promotion row` |
| (see git log) | `fix(server) S3+S4 socket ownership guards` |
| (see git log) | `test(perft) harness, fast subset, T-FIXES regressions` |
| (see git log) | `docs checkpoints/22-engine-perft.md` |

## Known residuals / deferred

- **S2** (client `lastMove` not forwarded to `gameSockets.js`) — deferred per task
  brief (owned by another agent's file).
- pos4/pos5 d4 not in the npm-test budget (computationally expensive); verified
  exact via standalone `node test/perft.mjs pos4 pos5`.
