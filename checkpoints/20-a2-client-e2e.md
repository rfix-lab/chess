# A2 — Headless E2E audit: chess client sync/moves + coordinate-coupling map

Repo `/root/proj/chess` @ `baseline` (working tree left clean; only untracked `test/audit-a2-*.mjs` + `checkpoints/a2-e2e-evidence.json` written, no tracked file touched). Full server DEBUG log + per-page socket traces: `checkpoints/a2-e2e-evidence.json`.

## 1. Environment

| item | value |
|---|---|
| Server | `DEBUG=1 PORT=5991 DATA_DIR=$(mktemp -d) node src/index.js` — port 5991 (checked `ss -ltn`, avoided 5500-5600) |
| Server session | pid 3296990 — killed after audit (verified port free) |
| Browser | `puppeteer-core` (global, `/root/.nvm/versions/node/v24.22.1/lib/node_modules`), chromium `/snap/bin/chromium`, args `--no-sandbox --disable-dev-shm-usage --force-device-scale-factor=1`, viewport 800x900 dpr=1 |
| Test scripts (untracked) | `test/audit-a2-e2e.mjs` (main), `test/audit-a2-trace2.mjs` / `audit-a2-trace.mjs` / `audit-a2-debug.mjs` (forensics) |

Canvas geometry resolved live from the page (not invented): viewport 800x900 -> `side_len=450`, `offset_x=offset_y=10`, cell=56.25px, canvas origin on page at (160, 34).

## 2. E2E matrix (pass/fail with evidence)

Seat model: `findPrivateMatch` (src/lib/matchmaking.js:107) seats the first live socket as **white** and the second as **black**. The white player created the match and navigated its own socket to `/game`; black used a separate context.

| # | Check | Result | Evidence (server DEBUG / DOM / client trace) |
|---|---|---|---|
| S0 | Both guests seated, startGame(0/1) delivered | **PASS** | `startMatch: both seated, emitting startGame matchId= 0`; white=`"Playing as white"`, black=`"Playing as black"` |
| S1 | Initial boards agree (white=server start, black=rotated 180) | **FAIL (racy)** | `white==start: true; black==rotated: false`. For black, `after:startGame` precedes `window.onload`, so `fen_to_board(start_fen)` (guarded only by `!loadSession()`) re-wrote the already-rotated black board in server orientation. See Bug A. |
| E-ill | Illegal move e2->e5 -> server REJECTED + canvas shake + board unchanged | **PASS** | `move: REJECTED reason=illegal ... from= 6:4 to= 3:4`; `shake=true`, `board[6][4]` still a white pawn, 0 `move: APPLIED` |
| H* (15x) | Highlight set on piece select == in-page `genLegalMoves` (orientation-converted) | **PASS** (all settled-board selections, both colors) | e.g. white `highlights=[[4,4],[4,5]] engine=[[4,4],[4,5]] equal=true`; black knight `engine=[[4,6],[5,5],[7,5]]` matches. **This is the B2 fix working** — once the board is in the right orientation, click highlights are correct for black. |
| M1 | 1.e4 (drag, white) -> `move: APPLIED` | **FAIL** | `appliedLines=0` (server never logged the e4 push). Local board did change -> desync. See Bug C. |
| M2 | 1...e5 (click, black) -> `move: APPLIED` | **FAIL** | `appliedLines=0` |
| S1...S15 | Board sync (both pages == expected server board) after each move | **FAIL from M1 on** | `agree` flips from `true` (S0) to `false`/nondeterministic; diffs like `W a8: got 0 want 12` in one run vs `a8=12` (correct) in the clean trace run -> **nondeterministic desync** |
| M1/M15 | En-passant indicator (white on e5 / black on visual (3,3)); check-indicator on black king after 8.Qh3; mate delivery to both pages | **FAIL (cascade)** | `bit=0` everywhere; consequences of M1/M2 never landing (server only ever applied the g1->f3 push: `from= 7:6 to= 5:5`) |
| H-Castle | O-O highlight after Kf1/h6 | **NOT EXERCISED (harness gap)** | O-O branch keyed to plan index 9, but drive table skips 9 (jumps 8->10); castling never driven. King highlights after Kf1 were correct |
| C-err | No JS console/page errors | **PASS** | `white errors=[]; black errors=[]` |

**Summary: 18/68 rows PASS.** The click-to-move highlight logic (the actual B2 fix) is verified correct; the failures concentrate in (a) the board-orientation race at game start and (b) the drag/input path dropping the first moves, which then cascades into every indicator/mate assertion.

## 3. CONFIRMED sync / move / capture bugs

**A. `window.onload` `fen_to_board` races the `startGame` rotation -> black board orientation lost.**
- `src/public/js/game.js:371-379` (`window.onload`): runs `draw(); fen_to_board(start_fen); render_board();` guarded only by `if (!saved)` where `saved = loadSession()`.
- `src/public/js/game.js:143-178` (`fen_to_board`): writes the start position into the **current** `board` global in **server orientation** (`board[rank][file]`, rank 0 = black back rank).
- `src/public/js/gameSockets.js:30-49` (`startGame`) and `:55-70` (`reconnected`): for black, re-assigns `board` to a 180-degree-rotated copy.
- **Mechanism:** if `startGame` fires *before* `window.onload` runs, and `loadSession()` has not yet persisted (or was cleared), the `!saved` guard is true, so `fen_to_board` re-writes the already-rotated black board in server orientation -> black ends up unrotated. **Repro:** seat black via `/index` -> clear storage -> `/game` (startGame beats the onload guard). Nondeterministic on a straight `/game` load.
- Impact: black's opening-move highlights/targets (a B2-class symptom) are wrong until the first `validated` overwrites the board.

**B. The 180-degree orientation transform is implemented in >=3 independent places (no single source of truth) — the structural root of the B2 class.**
- `game.js:276-321` `selectPiece`: builds a rotated `engineBoard` + `pos.x=8-x-1`, calls `genLegalMoves`, then rotates each target back.
- `game.js:470-515` `display_possible_moves` (drag): a **second, separate** copy of the same rotate->engine->rotate-back.
- `gameSockets.js:38-47` + `:60-70`: a **third** copy (rotate the whole board for black on `startGame`/`reconnected`).
- `game.js:323-349` `sendMoveToServer` + drag `socket.emit('move', ..., {x:8-x-1,...})`: a **fourth** copy at the network boundary.
- Any one copy wrong (or a fifth added) re-breaks black. This duplication is the "coordinate coupling" the audit targets.

**C. The drag path is a 10 ms polling state-machine that can drop the mouse down->up transition, so `move` is never emitted.**
- `game.js:373-455` `handle_drag()`: only emits `move` in the branch `was_mouse_down==true && is_mouse_down==false && is_holding_piece`. `was_mouse_down`/`is_mouse_down` are sampled by the `setInterval` draw loop (`game.js` ~690-705, `delta_time=10`).
- **Repro:** puppeteer synthetic down->move->up coalesced across two interval ticks -> the transition is never observed in the same tick -> `move` not sent, while `board[i][j]=0` (line ~452) already mutated the local board -> **client/server desync**. Observed as M1/M2 `appliedLines=0`. The click path (`executeClickToMove` on `onmouseup`) is event-driven and robust — which is why all click highlights passed.

**D. (minor, deterministic) Board array doubles as both piece store and UI-indicator store.**
- `src/index.js:30-33` defines `INDICATOR_LAST_MOVE=0b100000`, `INDICATOR_CHECK=0b1000000`, `INDICATOR_EN_PASSANT=0b10000000` OR'ed onto `boardState` values; client `draw()`/`render_board()` must mask `& 0b1111` to read piece identity. Correct today, but a two-use coupling that every new indicator/reader must remember to mask.

Cascade note: the absent en-passant / check indicators and undelivered checkmate are downstream of **C** (first moves not landing), not independent defects.

## 4. Static coordinate-coupling map

Legend — **L** = logic-facing (orientation/coordinate math that feeds the engine or the network); **S** = pure style (pixels that only affect drawing).

| Location | Value / statement | Role | Class |
|---|---|---|---|
| game.js:43-62 `recalcLayout` | `offset_x=10; offset_y=10; side_len=total-20; maxCanvas=min(vw-8,480); maxH=vh*0.7; canvas.width=total*dpr; style.maxWidth=(vw-8); style.maxHeight=vh*0.7` | sets pixel layout + backing store | **S** (feeds L via cellSize/offsets) |
| game.js:170 `render_board` | `side_len/8`; `offset_x + j*cell + cell/2` | glyph positions | S |
| game.js:189-258 `draw` | `fillRect(offset_x+i*cell,...)`; rank labels at `offset_x/3`, `offset_y*1.3`, `offset_y*1.1+side_len+10`; file labels at `offset_x*0.9` | square + coordinate labels | S |
| game.js:261-269 `get_box_coords` | `(mouse_x-offset_x)/cell`, `(mouse_y-offset_y)/cell` | pixel->**visual** square | **L** (input->board) |
| game.js:276-321 `selectPiece` | `engineBoard` 180 flip; `pos.x=8-x-1; pos.y=8-y-1`; `genLegalMoves(engineBoard, ...)`; targets flipped back | visual->server for engine, back for highlight | **L** (copy #1) |
| game.js:323-349 `sendMoveToServer` | `serverFrom={x:8-x-1,...}` for black | visual->server on emit | **L** (copy #4) |
| game.js:373-455 `handle_drag` | `board[i][j]=0`; sprite at `mouse_x-off_x`; emit with `{x:8-x-1,...}` for black; 10 ms state machine | input->board + visual->server | **L** (copy #4 + fragility C) |
| game.js:470-515 `display_possible_moves` | rotated `new_board`, `genLegalMoves`, rotate targets back, circles at `offset_x+cell/3`, `offset_y*1.5` | visual->server->visual | **L** (copy #2) + S (circle pixels) |
| game.js:88-101 | `0b1111` masks; `CLICK_THRESHOLD=5px`; indicator bit tests `&0b100000/0b1000000` in draw | piece/indicator separation, click-vs-drag | **L** |
| gameSockets.js:38-47 / 55-70 | rotate whole `board` for black on start/reconnect | server->visual | **L** (copy #3) |
| gameSockets.js `validated` handler | re-rotates incoming `boardState` for black | server->visual (also D) | **L** (copy #3) |
| game.ejs | `<canvas id="cnv">` has **no** width/height attrs (set only in JS) | layout source | S |
| game.css:~175 `#cnv` | `max-width:95vw; max-height:70vh` | overrides/competes with JS `recalcLayout` (480 / 0.7) | S (but **couples** to L sizing) |
| game.css `.captured-row` | `min-height:30px; width:min(95vw,480px)` | mirrors JS 480 cap | S (but coupled to JS cap) |

**Takeaway:** there is exactly **one** logical fact — "map a square between the *server* orientation the engine/network use and the *visual* orientation the canvas draws, keyed on `my_color`" — and it is currently spelled out **four** times (selectPiece, display_possible_moves, gameSockets x2, sendMoveToServer) with a **fifth** implicit copy in the pixel<->square mapping. That is the coupling to collapse.

## 5. Refactor seam — one layout/orientation module

Introduce `src/public/js/layout.js` (loaded before `game.js`) as the **single source of truth**; a designer restyles by editing only the S-class constants there, and logic keeps reading the engine in server orientation:

```
layout.js  exports:
  // pure style — designer owns these:
  OFFSET = {x:10, y:10}; CELL_CAP = 480; VIEW_HF = 0.7;
  cellSize();            // recomputed from viewport, one place
  squareToPixel(x, y);   // visual square -> canvas px  (was offset_x+j*cell)
  pixelToSquare(px, py); // canvas px -> visual square  (was get_box_coords)

  // LOGIC — the ONLY orientation code in the app:
  orientToServer(x, y, color);   // identity if color==0, else {x:7-x, y:7-y}
  orientToVisual(x, y, color);   // inverse
  rotateBoard(board, color);     // the single 180 transform (replaces all 3 board-rotations)
```

Concrete consolidations:
1. **Kill the four 180 copies.** `selectPiece`, `display_possible_moves`, `gameSockets` startGame/reconnected/validated, and `sendMoveToServer`/drag-emit all call `orientToServer`/`orientToVisual`/`rotateBoard`.
2. **Fix Bug A in the same move.** `window.onload` should init from the server start FEN and apply `rotateBoard(board, my_color)` whenever `my_color` is known (guard on orientation state, not on `!loadSession()`), so black can never be left unrotated.
3. **Fix Bug C.** Move the drag down->up detection to the real event handlers (`onmousedown`/`onmouseup` already compute canvas-internal px) and emit from there; keep the 10 ms loop only for redrawing.
4. **Keep engine in server orientation** (`chessutils.js` untouched) — the seam guarantees a restyle (new cell size, offsets, or a non-180 scheme) never leaks into `genLegalMoves`/`checkLegalMove`.

## Bottom line

The **B2 fix (click-to-move highlight vs `genLegalMoves`) is confirmed correct** for both colors on a settled board. Two real defects remain in the same coordinate-coupling family: **(A)** the onload/`startGame` race that can leave black unrotated, and **(C)** the 10 ms drag state-machine that drops early moves and desyncs the boards (the en-passant/check/mate assertion failures all trace to C). A single `layout.js` orientation module collapses the four duplicated 180 transforms and fixes both at the seam.

NOTE (orchestrator): implementer decision recorded — first stage keeps the current internal-board semantics (visual board stays rotated for black) and only collapses transforms through the seam module (behaviour-preserving refactor) + fixes A and C; harness `test/audit-a2-e2e.mjs` expectations stay valid and become the E2E regression gate.
