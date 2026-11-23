# 31 — User bughunt round 4 (2026-11-23)

Five complaints from the owner (10:47 MSK). All fixed on `feat/round3-f3`; gates: `npm test` 64/64, E2E 45/45 x2 (ports 6545/6546, cleaned after each).

## 1. "Touching a piece makes it disappear" (also enemy pieces)
Root cause chain (client, `src/public/js/game.js`):
- `grabDragPiece` grabbed ANY piece including enemy ones; the render loop blanks
  `from_position` while a grab is live.
- the click path (mouseup/ontouchend, non-drag) cleared the grab state WITHOUT
  restoring the blanked square -> a 60ms press deleted the piece from the board
  array (fixed by the other session in 32ad04a partially: state was cleared,
  but the restore never happened; any press longer than one 10ms tick lost it).
- releasing the mouse button OUTSIDE the canvas never fired canvas.onmouseup:
  grab stayed live forever (piece off board, sprite stuck).
Fix: grab restricted to own color; shared `releaseGrab()` restores the
loop-blanked square on every non-drag release; window-level `mouseup` safety
net for outside-the-canvas releases.
Regressions: E2E rows H1 (enemy press 60ms keeps piece), H2 (own press restores).

## 2. Outline too thick
`drawPieceGlyph` stroke width was `max(1, cell*0.045)` (~2.9px on 64px cells).
Now `max(0.5, cell*0.018)` (both piece painter and drag sprite) — ~2.5x thinner.

## 3. Wrong move highlighting
Pixel-space transposition since the ORIGINAL baseline: `draw()` filled square
overlays (last-move / check / en-passant / selection / legal-move tints) with
`offset_x + i, offset_y + j` while pieces, `pixelToSquare` and the `board[y][x]`
convention all use x=j,y=i. Every overlay was mirrored across the main
diagonal; JS-state tests could not see it. Fixed the three fillRects to x=j,y=i.
Also `display_possible_moves`: drag dots were a 15px glyph painted from the
square top-left with `offset_y*1.5`; now centered arcs scaled with the cell.
Regression: E2E row H3 pixel-probes e3 (tinted after selecting e2) and its
diagonal mirror d4 (must stay clean) via getImageData.

## 4. 8-character match ids (S1 agent, commits c61141f..2be02a1 + client fix)
Server: `genMatchId()` = 8 chars a-z0-9 via node:crypto randomInt (~2.8e12
space, pool collision check); private-match echo now ALWAYS carries the
server-generated id (client arg ignored); matchId is an opaque string at every
socket entry (normId=String, no parseInt anywhere); /game route validates
`^[a-z0-9]{1,32}$`; stale numeric ids from old clients miss gracefully
(gameNotFound).
CLIENT BUG found in combined run: `sendCookie` did `matchId = Number(matchId)`
-> NaN -> server null -> private-link players silently landed in PUBLIC
matchmaking (log proof: page authed with matchId=null while the echo id was
bfs8r048). Fixed to pass the string verbatim. E2E verifies the full private
link flow with string ids (45/45).

## 5. Elo display + guest games unrated
Rating gate was already correct (`endMatch` updates Elo only when BOTH sockets
have `socket.data.user` — guest games never rated; checkpoint 14 F2). New:
server emits SEAT payload `{own, rated, opponent}` to each REGISTERED socket on
startGame/reconnect (checkpoint/30 contract, S1 tests T30 cover all phases);
client shows a badge under the status: `Elo: N · соперник: M` or
`Elo: N — игра с гостем, рейтинг не меняется`. Game-end payload {player1,
player2} unchanged; badge refreshes from it too.

## Test harness additions (test/e2e-client.mjs)
- H1/H2 touch-disappear rows (real mouse down 60ms + up, board array asserted)
- H3 canvas pixel probe (getImageData, dpr-aware)
- `window.__lastValidatedRaw` snapshot (gameSockets.js): the end-of-game replay
  browser (showReplay -> applyReplayPosition(0)) rewrites the global board the
  instant the mate modal opens; the S11/M11 assertions raced it (flaky 42/42 vs
  39/42). Assertions now read the authoritative snapshot.

## Commits
Client: (see git log: fix(client) round-4 + feat(client) elo badge + test(e2e) rows).
Server (S1): c61141f, b374cdb, 2be02a1, 89bf1fb, cb723f7, 6a1da2b, c9c2cab, 615079e, e9304dc.

## Not covered
Seat-elo badge is browser-unverified (server contract covered by T30 socket
tests); check visually on prod after deploy.
