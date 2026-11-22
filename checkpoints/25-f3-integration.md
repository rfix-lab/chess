# 25 — F3 + integration branch (2026-11-22)

Branch: `feat/round3-f3` in `/root/proj/chess` (main worktree).
Base merges: `2261640`+`a26da07` (client `feat/coord-seam-input` @94fc2a9, engine `feat/engine-perft-fixes` @c34fa7b).
One untracked file had to be moved out of the way pre-merge: `test/audit-a1-perft.mjs` -> `/tmp/audit-a1-untracked.mjs.bak` (was untracked in main worktree, tracked in engine branch).

## F3: server-authoritative lastMove (commit 404b8ea)

Bug: client `lastMove` was only set on the local click path, so `genLegalMoves`
EP target for the OPPONENT's double push never existed — en-passant highlight
and capture were dead for the side that did not move. Rejected moves also
polluted the local value.

Fix:
- `src/index.js`: `validated` payload gains `{ lastMove: match.lastMove }` on
  the normal-move emit (both sockets), the promotion-resolution emit and the
  pending-promotion emit. Rejected payloads unchanged (no stamp).
- `src/index.js`: `reconnected` carries `match.lastMove` (5th field) — EP
  targets survive a reconnect right after a double push (E2E F5 scenario).
- `src/public/js/gameSockets.js`: `validated` adopts `extra.lastMove` when
  present (server coords, identical shape to the old local object);
  `reconnected` adopts field 5; `startGame` clears `lastMove` for fresh
  matches (server sends the first real value with the first `validated`).
- `src/public/js/game.js`: local `lastMove` bookkeeping removed from click
  path (`sendMoveToServer`) and from `completeDrag`; server value is adopted
  atomically with the board update. Input is blocked by `is_being_validated`
  between emit and `validated`, so there is no gap. Drag path now emits
  server-orientation coords through the layout seam (was visual for black).
- Compatibility: `_wasPawnDoublePush` consumes `lm.piece` through `getPiece`
  (&0b111) / `getColor` (&0b1000); server `match.lastMove.piece` is the raw
  server-board value — indicator bits (>=16) cannot leak into the compare.

## Harness fixes in test-chess.mjs (same commit)

- `fxA.once('private-match')` await had a never-resolving `sleep` branch —
  replaced with `Promise.race` (this is what produced the earlier "hang").
- Flaky sleeps under parallel load: guest seating 500->1200ms, bogus-session
  300->800ms (false FAIL observed 2026-11-22 while E2E ran concurrently).
- New F3 rows: double-push payload carries `lastMove e2-e4` to both sockets;
  rejected payload carries no stamp (seating via private-match code 7).

## Gates on 404b8ea (all re-run personally)

- `npm test` -> **51/51** (`=== Results: 51/51 passed, 0 failed ===`)
- `node test/perft.mjs` -> **all 20 (position, depth) checks EXACT**
- engine byte-identity: `git diff feat/engine-perft-fixes..HEAD -- src/lib/chessutils.js src/public/js/chessutils.js src/lib/matchmaking.js` -> **0 lines**
- `node checkpoints/verify-c3-sync.mjs` -> 27/27 (pre-F3; F3 touches no chessutils)
- `E2E_PORT=6510` and `6511` -> **42/42 ALL PASS** each, exit 0

## Not covered by E2E (stated explicitly)

The E2E game never performs a real en-passant capture in either direction;
cross-client EP CLICK is covered transitively: payload sync (F3 unit rows) +
byte-identical chessutils EP validation (perft) + seam invariant (V1 review).

## Next

1. D1 designer restyle on this branch (style-only; E2E gate 42/42 mandatory).
2. Redeploy prod: `docker build -t cherry:latest .` on elastic2 ->
   `docker save|gzip|ssh first docker load` -> `docker stack deploy -c docker-compose.yml chess`
   (service `chess_cherry` and `cherry_data` volume were removed earlier — accounts start empty;
   Traefik router `cherry`, Host `mycheserv.duckdns.org`, port 5500; stack name MUST be `chess`).
3. Push `feat/round3-f3` -> PR to `baseline` (owner rule: no direct push).
