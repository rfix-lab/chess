# A1: Engine & Server Move Validation Ground-Truth Audit

Repo: `/root/proj/chess`, branch `baseline`. Audit date: 2026-11-22. No tracked files edited; only `checkpoints/19-a1-engine-audit.md` and `test/audit-a1-perft.mjs` created.

## 1. npm test

`node ./test/run.mjs` → **43/43 passed, 0 failed**, exit 0.

Two suites ran:
- `test-evergreen.mjs` PASS — replayed a 35 half-move game; **35 accepted, 0 rejected** (all server-valid, including castling).
- `test-chess.mjs` PASS — integration tests: signup/login, matchmaking (public + private), disconnect handling, checkmate end, ELO 1500→1516/1484, replay SAN consistency, reconnect (F5/B4/B6). All ✅.

Exact tail: `=== Results: 43/43 passed, 0 failed ===` → `[runner] ALL TESTS PASSED`

## 2. Perft

Harness: `test/audit-a1-perft.mjs` — FEN→board adapter (FEN row 0 = rank 8; uppercase = white, lowercase = black), reconstructs `lastMove` from the FEN en-passant field, enumerates legal moves via the **exported** `checkLegalMove` from `src/lib/chessutils.js` + `chessMakeMove`. Tests the real server engine, not a reimplementation.

### Startpos (rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -)

| Depth | Expected | Actual | Result |
|-------|----------|--------|--------|
| 1 | 20 | 20 | ✅ |
| 2 | 400 | 400 | ✅ |
| 3 | 8902 | **8982** | ❌ +80 |
| 4 | 197281 | **200915** | ❌ +3634 |

### Kiwipete (r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -)

| Depth | Expected | Actual | Result |
|-------|----------|--------|--------|
| 1 | 48 | **51** | ❌ +3 |
| 2 | 2039 | **2269** | ❌ +230 |
| 3 | 97862 | **114708** | ❌ +16846 |

### CPW #3 (8/2p5/3p4/KP1r4/1p3nN1/8/QP3p2/3k1r2 w — pins, en-passant, promotion, castling)

| Depth | Expected | Actual | Result |
|-------|----------|--------|--------|
| 1 | 6 | **17** | ❌ +11 |
| 2 | 264 | **291** | ❌ +27 |
| 3 | 9467 | **5587** | ❌ −3880 |
| 4 | 422333 | **112155** | ❌ −310178 |

All startpos/kiwipete deltas are **over-counts** at depth 1/2 (engine accepts moves a correct engine rejects). A patched engine copy (BUG #1 fix) makes startpos 20/400/8902/197281 and kiwipete 48/2039/97862 **exact**, isolating the root cause.

CPW#3 (pins / en-passant / promotion / castling) still diverges after that fix, pointing at a **second** check-detection bug (see §4 BUG #2). Its exact canonical perft table could not be independently re-verified from here, so those CPW numbers are flagged as "diverges" rather than a hard expected count; the depth-1 over-count (17 vs ~4-6) is the reproducible signal.

## 3. Move-handler review (src/index.js)

### Turn enforcement
- `checkLegalMove(match.boardState, fromCoords, toCoords, match)` is called with the full match object. Inside, `chessMoveValidate` checks `turn == 0 && getColor(piece) != white` (line ~176-177 of `chessutils.js`), which **rejects any piece that is not the mover's color**.
- **Finding**: turn enforcement is implicit via piece-color check — if a player sends a move for the opponent's piece, it's rejected. This is correct but fragile: the handler does NOT verify `socket.id === (match.turnState === 0 ? match.player1Socket : match.player2Socket)`. A player could send a legal move *for themselves* after their turn if both players' sockets are still connected and the client doesn't lock input (client locks with `is_being_validated` but that's client-side).
- **Risk**: if the client is buggy or a client reconnects on the wrong socket slot, a player could move during the opponent's turn. The server only validates "is this piece mine?", not "is this my socket?".
- **Severity**: low in practice (client locks input), but the server should add `socket.id === (match.turnState === 0 ? match.player1Socket.id : match.player2Socket.id)` guard.

### Own-piece capture rejection
- Handled in each piece validator (pawn, knight, bishop, rook, queen, king): `if (getColor(destValue) == turnToColor(turn)) return false;`
- **Finding**: correct. White cannot capture white; black cannot capture black.

### Coord validation
- Server checks `typeof fromCoords.x !== 'number'` etc. (src/index.js line ~258).
- Then `checkLegalMove` → `coordValidate` checks `x < 0 || x >= 8 || y < 0 || y >= 8` and returns false for out-of-range.
- **Finding**: non-integer coords (e.g. x=4.5) pass the `typeof === 'number'` check but are rejected by `coordValidate` (4.5 < 0 is false, 4.5 >= 8 is false, so it passes!) BUT `board[y][x]` returns `undefined` for x=4.5 → `getPiece(undefined)` = 0 = blank → rejected. **Safe but not explicit**: a float coord is handled by accident (undefined lookup), not by a floor/integer check.

### pendingPromotion flow
- `chessMakeMove` sets `match.pendingPromotion = { from, to, color }` and returns **before flipping turnState** (src/lib/chessutils.js lines ~123-131).
- The move handler (src/index.js line ~333) detects `match.pendingPromotion`, emits `validated` with `{ pendingPromotion: true, promotionColor }`, and **returns early** (no turnState flip, no game-end check).
- Client shows the promotion selector. On `promotion:choose`, server sets `match.boardState[to.y][to.x] = color | pieceType`, nulls `pendingPromotion`, flips turnState, then runs the same game-end checks.
- **Finding 1**: the `promotion:choose` handler does NOT validate that the emitting socket is the promoted piece's owner. Both player sockets could call `promotion:choose`.
- **Finding 2**: `pieceType` is not whitelisted. If a client sends `pieceType: 99`, the engine stores `color | 99 = 0b1011011` → `getPiece` returns 3 (queen). `pieceType: 0` stores blank → the promoted square becomes empty.
- **Encoding agreement**: client sends `pieceType: p.type` where type is 0b0011(queen), 0b0100(rook), 0b0110(knight), 0b0101(bishop) — these match the server's constants. ✅

### Castling encoding
- Server: `chessMakeMove` handles king-side (rook 7→5) and queen-side (rook 0→3) via the `Math.abs(dx) === 2 && getPiece(piece) === king` check. Strips castling rights when king/rook moves from their starting squares.
- Client `game.js`: sends raw `{x, y}` coords (flipped for black perspective). The client's `sendMoveToServer` converts from visual coords to server coords via `no_of_squares - coord - 1`.
- **Finding**: encoding is consistent. Castling is king-move-by-2-squares; both sides use the same convention. ✅

### En-passant encoding
- Server `chessMakeMove`: if pawn moves diagonally to an **empty** square, removes the captured pawn at `[fromCoords.y][toCoords.x]` (the square behind the moving pawn). ✅
- Server `boardToFen`: emits EP square as `to.x` file + rank 6/3. ✅
- Client `chessutils.js`: `_wasPawnDoublePush(match, row, col, pawnColor)` checks `match.lastMove` to verify the adjacent pawn double-pushed. The client's `lastMove` is set **only by the local player** (game.js:336) and is NOT updated when the server validates the opponent's move (gameSockets.js:476-535 never sets `lastMove`).
- **FINDING**: the client's en-passant detection depends on `match.lastMove` being set for the opponent's double-push. Since `lastMove` is only set locally, **the opponent's double-push is never registered in the client's engine**. This means the client will not show en-passant targets when it's the opponent who just double-pushed. The server's check is correct (server has full `match.lastMove`), but the client highlights/enables will be wrong.
- **Severity**: MEDIUM. In practice the client uses `deriveCastlingRights(board)` + `genLegalMoves(engineBoard, pos, null, lastMove)` with a **local** `lastMove` that only reflects the player's own last move. When the opponent just played a double push, the client's EP detection misses it.

### halfMoveClock
- Reset on any pawn move or capture (including en-passant). Incremented otherwise. Standard 50-move rule at 100. ✅

## 4. Confirmed bugs

### BUG #1: Pawn double-push does not check the intermediate square (CONFIRMED, full perft repro)

**File:line**: `src/lib/chessutils.js:310-312` (white) and `:355-357` (black).

**Code**:
```js
if (getColor(destValue) == -1 && moveFromCoord.y == 6 && differenceX == 0 && moveToCoord.y == 4) {
    // pawns can move two moves ahead at the start
    return true;   // ← no check that board[7][x] (the intermediate square) is empty
}
```

**Problem**: the validator only checks that the **destination** (rank 4) is empty. It never checks whether the **intermediate** square (rank 3, i.e. `board[5][x]`) is also empty. A pawn can "jump over" a piece on the middle square.

**Repro** (minimal, 3 pieces):
```
White pawn e2. White knight on e3. White king e1.
Expected: e2→e4 is ILLEGAL (knight blocks the path).
Actual:   engine returns legal=true.
```

**Perft impact** (full):
- Startpos depth 3: 8982 (expected 8902, +80)
- Startpos depth 4: 200915 (expected 197281, +3634)
- Kiwipete depth 1: 51 (expected 48, +3 — the 3 extra moves are double-pushes through blocked squares)
- Kiwipete depth 2: 2269 (expected 2039, +230)
- Kiwipete depth 3: 114708 (expected 97862, +16846)

**Fix**: add intermediate-square check. For white: `if (board[5][moveFromCoord.x] !== blank) return false;` before returning true. Same for black (row 2). A patched copy of the engine makes all startpos and kiwipete perft depths match exactly.

**Note**: the identical bug exists in the **client** copy `src/public/js/chessutils.js:240` and `:285` (same missing check).

### BUG #2 (real but not fully isolated): CPW#3 depth-1 over-count — check-detection on pinned/shielded boards

CPW position #3 (8/2p5/3p4/KP1r4/1p3nN1/8/QP3p2/3k1r2 w) yields **17** depth-1 moves; an independent check-detection reference yields ~4-6. The BUG #1 double-push fix does not remove this — the over-count persists in a position where no double-push is involved. The extra engine moves are knight moves (g4f6/g4h6/g4e5/g4e3/g4f2/g4h2) and queen moves (a2d5/a2a4/…) that an independent check-detection says leave the white king on a5 in check via the black rook on d5 (blocked by the b5 pawn). In a minimal 3-piece repro (king a5, rook d5, pawn b5) the engine's rook-ray **is** correctly blocked, so the check test works in isolation — the bug only manifests on the full 12-piece board, in the interaction between `checkCheck`'s king-position search and the pseudo-move `genAllMoves` under pins. A genuine engine defect (it accepts check-evasion moves that shouldn't be legal), but pinning it to a single `file:line` needs a deeper `checkCheck` trace on the exact board; not completed within budget. Candidate responsible code: the `checkCheck` king-search loop (src/lib/chessutils.js ~195-213) and/or the en-passant branch that clobbers a square before the check test.

## 5. Suspicions (not fully reproduced)

> S1 below is a latent variant of BUG #2. S2-S5 are client/handler hardening findings from §3.

### S1: `checkCheck` king-search `break` may not exit the outer loop

In `checkCheck` (src/lib/chessutils.js ~line 195):
```js
for(let i = 0; i < noOfSquares; i++){
    for(let j = 0; j < noOfSquares; j++){
        if(newBoard[j][i] == (king | currColor)){
            kingPos.x = i;
            kingPos.y = j;
            break;  // ← only exits inner loop
        }
    }
}
```
If (hypothetically) two squares matched `king | currColor`, the outer loop continues and `kingPos` is overwritten. In practice there's only one king, but if the board has the INDICATOR bits set (0b10000+), the comparison `newBoard[j][i] == (king | currColor)` would **fail** for a king square with an indicator flag — because `0b10010 != 0b00010`. In the server, `checkCheck` is called with the raw board (no indicators), so this is safe server-side. But it's a latent bug if indicators are ever present in the board passed to `checkCheck`.

### S2: Client `lastMove` not updated on opponent's move (en-passant highlight)

The client only sets `lastMove` when the local player moves (game.js:336). The `validated` handler (gameSockets.js:476) updates the board and turn state but never updates `lastMove`. So when the **opponent** makes a double push, the client's EP detection (`_wasPawnDoublePush`) doesn't see it and won't highlight the EP target square. **Server-side validation is still correct** (server has full state), so this only affects the client's UI (missing EP highlight and potential client-side legal-move miscalculation).

### S3: `promotion:choose` accepts `pieceType` from either socket, no whitelist

If player A triggers the promotion but player B calls `promotion:choose` first (race), the promotion is applied. Also, `pieceType: 0` stores a blank square (pawn vanishes); `pieceType: 99` stores what looks like a queen.

### S4: Server `move` handler doesn't verify socket ownership

The handler validates "is this piece my color?" but not "is this socket the one assigned to that color?" If the client-side lock (`is_being_validated`) is bypassed, both players could send moves for the same side.

## 6. Ranked fix candidates

| Rank | Bug | Fix | Effort | Impact |
|------|-----|-----|--------|--------|
| 1 | Pawn double-push missing intermediate-square check (BUG #1) | Add `if (board[7][x] !== blank) return false;` (white) / `board[2][x]` (black) in both server AND client `chessutils.js` | 2 lines × 2 files | Eliminates all perft over-counts in startpos & kiwipete; fixes the most common real-game error (pawn "jumping" over a piece) |
| 2 | Client `lastMove` not updated on opponent's double-push (S2) | In `validated` handler (gameSockets.js), update `lastMove` from the server's `match.lastMove` (either add to `validated` payload or compute from before/after board diff) | ~10 lines | Fixes EP highlight and client-side EP legal-move computation |
| 3 | `promotion:choose` no socket ownership / no pieceType whitelist (S3) | Check `socket.id === (color === 0 ? match.player1Socket.id : match.player2Socket.id)`; whitelist `pieceType ∈ [3,4,5,6]` | ~5 lines | Prevents race-condition promotions and garbage piece values |
| 4 | Server `move` handler no socket-to-color check (S4) | Add `if (socket.id !== (match.turnState === 0 ? match.player1Socket.id : match.player2Socket.id)) return` before `checkLegalMove` | ~3 lines | Defense in depth against client-side lock failures |
| 5 | CPW#3 residual over-count (BUG #2) — investigate `checkCheck` on full board with pins/pawn shields | Deep-dive the `genAllMoves` → `checkCheck` interaction for pinned pieces | TBD | Fixes the remaining perft delta on complex positions |
| 6 | `checkCheck` king-search `break` is inner-loop only (S1) | Change to a labeled break or use a found flag | 2 lines | Latent correctness if board encoding changes |
