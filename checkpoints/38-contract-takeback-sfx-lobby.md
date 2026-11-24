# Contract 38 — takeback semantics, capture/check click, lobby button layout

Owner request 2026-11-24 (screenshot of logged-in lobby attached):
1. Lobby logged-in button layout is crooked/ugly (Играть/Пользователи big row, Кабинет/Выйти small cramped row).
2. Capture should produce a small click sound.
3. Check should produce two quick clicks of the same sound.
4. Takeback flow must be: player moved → presses "Взять назад" → request goes to opponent → opponent accepts → piece returns, move passes back to the requester (the one who made the undone move).
5. (addendum 10:04) Mobile login modal is broken (screenshot 390px): modal wider than viewport (fields clipped at right edge), password field overlaps the username input, native autofill paints fields white (username:-internal-autofill-selected), submit/secondary buttons misaligned, modal floats over the Регистрация button.

## Recon (HEAD a0d3dc9)
- Server `src/index.js`:
  - `takebackRequest` (line ~1199) requires `requesterColor === match.turnState` — i.e. only the side TO MOVE may request. Owner's scenario (requester just moved, it is opponent's turn) is REJECTED with "Not your turn to request takeback". This is the core defect.
  - Decline path (~1250): `const requesterColor = match.player1Socket.id !== socket.id ? 0 : 1;` then `match.player1Socket.id === requesterColor` compares a socket id STRING to 0/1 — always false → requester resolves to player2Socket always; when responder is player1 the decline notice is sent to the WRONG socket.
  - `match.takebackOffered === 'declined'` latch is never cleared → one decline poisons the whole match.
  - Accept path itself is correct: pops stateHistory snapshot, restores board+turnState (snapshot turnState = the mover) → exactly the owner's "ход остается у первоначального игрока".
- Client `src/public/js/gameSockets.js`:
  - Sounds ARE wired: `validated` extra.rejected → wrong_move_sound (553); accepted moves → capture_sound/move_sound (571/573, 584/586). capture.mp3 (6889 B) exists but is not a short click; no click sound; no check sound at all.
  - Takeback client: btn-takeback emits `takebackRequest`; `takebackOfferReceived` modal (Принять/Отклонить exists); on `takebackDeclined` the button is permanently disabled (`takebackDeclined=true`).
  - `window.isFigureUnderAttack` exists (used by E2E 37B) → client can detect check locally after each accepted board.
- Lobby: logged-in view stacks differ in width/alignment (index.ejs/index.css, contract-32 B1 layout).

## Stages (micro)
- [ ] F1 server: requester = side NOT to move (just moved); fix decline requester lookup; clear declined latch on next accepted move; Russian takebackError texts; unit rows in test-chess.mjs.
- [ ] F2 client game: takeback UX — button enabled only when ≥1 move made; decline re-enables later (no permanent lock); modal/texts Russian; takebackError surfaced in status line.
- [ ] F3 client audio: generate click.mp3 (short sharp click); validated → 1 click on capture (replace capture.mp3 usage), 2 quick clicks (~90 ms apart) when resulting position puts the side-to-move's king under attack; keep wrong-move duff.
- [ ] F4 lobby: single aligned full-width button stack in logged-in state (Играть, Пользователи, Кабинет, Выйти), even gaps; screenshots 390/1280.  <!-- DONE 2026-11-24, see completion line under Gates -->
- [ ] F4b login modal (after F4, same files): modal fits viewport with padding on 320-430px widths; fields full-width, box-sizing border-box; no overlap between username and password rows; dark autofill styling (-webkit-autofill shadow/inset fix); buttons inside modal aligned to the same stack metrics; open-modal must not cover content weirdly (scroll into view).
- [ ] F5 E2E: rows — takeback accept restores pre-move board and turn to requester (UI); audio stub rows: capture → 1 click, check → 2 clicks, no click on quiet move.
- Gates: npm test; E2E 61+ rows twice if flaky.
- [x] F4 done 2026-11-24: single aligned vertical stack in logged-in state (Играть→Пользователи→Кабинет→Выйти) — #authed nested inside #action-stack, `.show` uses `display:contents` so all four direct items share identical width/center-x/height (58px bordered) with one uniform 8px gap; [Регистрация] raised to the same 58px so the guest stack shares the metrics; screenshots checkpoints/design-38/lobby-390.png + lobby-1280.png; E2E A1 + X6 PASS (full gate left to orchestrator).

## Owners
- Orchestrator: contract, gates, deploy, PR #3 comment.
- F1/F4 parallel; then F4b (mobile login modal, same files as F4) and F2 → F3 (same file gameSockets.js, serialized); then F5; orchestrator integration review + deploy.
