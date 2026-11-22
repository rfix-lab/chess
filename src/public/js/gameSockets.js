var socket = io();

// B4: remember the current socket.io id — on page reload/reconnect socket.io
// v4 generates a NEW id, and the server needs the PREVIOUS id to recognize the
// returning client (socket.io reconnect race: the new connection can arrive
// before the old socket's 'disconnect' event, so the old one may still be .connected).
socket.on('connect', () => {
  try { sessionStorage.setItem('cherry_socketId', socket.id); } catch (e) {}
});

// --- Session persistence helpers ---
const SESSION_KEY = 'cherry_session';

function saveSession(gameId, color) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ gameId, color }));
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch { return null; }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// --- Auth / reconnect ---
// readCookie provided by cookieUtil.js (H5: deduplicated)

sendCookie = () => {
  let sessionID = readCookie('sessionID');

  if (matchId == "")
    matchId = null;
  else
    matchId = Number(matchId);

  socket.emit('auth', sessionID, matchId);
};

// Attempt reconnect if we have a saved session
function tryReconnect() {
  const session = loadSession();
  if (!session || session.gameId == null) return false;

  const sessionID = readCookie('sessionID');
  let prevSocketId = null;
  try { prevSocketId = sessionStorage.getItem('cherry_socketId'); } catch (e) {}
  socket.emit('reconnect', { gameId: session.gameId, color: session.color, sessionID, prevSocketId });
  return true;
}

// On page load: try reconnect first; if no session, fall back to normal auth
if (!tryReconnect()) {
  sendCookie();
}

// Server tells us to start a new game (normal flow)
socket.on('startGame', (color, gameId) => {
  my_color = color;
  matchId = gameId;
  saveSession(gameId, color);
  capturedByWhite = [];
  capturedByBlack = [];
  if (color == 0) {
    document.getElementById('status').innerText = 'Playing as white';
    can_move = true;
  }
  else {
    document.getElementById('status').innerText = 'Playing as black';
    // Black sees rotated board (180°) — single orientation seam: layout.js
    board = window.ChessLayout.rotateBoard(board, 1);
  }
  // Show game action buttons
  const actionsPanel = document.getElementById('game-actions');
  if (actionsPanel) actionsPanel.style.display = 'flex';
  resetGameActionButtons();
});

// Server confirms reconnect — restores board state
socket.on('reconnected', (color, gameId, boardState, turnState) => {
  clearSession(); // no longer need to reconnect
  my_color = color;
  matchId = gameId;
  saveSession(gameId, color);
  capturedByWhite = [];
  capturedByBlack = [];

  // Restore board from server state
  if (color == 0) {
    board = boardState;
  } else {
    // Black sees rotated board (180°) — single orientation seam: layout.js
    board = window.ChessLayout.rotateBoard(boardState, 1);
  }

  // Show action buttons
  const actionsPanel = document.getElementById('game-actions');
  if (actionsPanel) actionsPanel.style.display = 'flex';
  resetGameActionButtons();

  if (turnState == my_color) {
    document.getElementById('status').innerText = 'Your turn';
    can_move = true;
  } else {
    document.getElementById('status').innerText = 'Opponent\'s turn';
    can_move = false;
  }
  // Redraw the board after restoring state
  draw();
  render_board();
  renderCapturedPieces();
});

// Server says game is gone → redirect to lobby
socket.on('gameNotFound', () => {
  clearSession();
  window.location.href = '/index';
});

// B5: session invalid/expired (e.g. washed out by a container restart) — drop
// both the localStorage game session and the cookie, then back to the lobby.
// Without this the client just sat on "Waiting for player..." forever.
socket.on('authFailed', () => {
  clearSession();
  deleteSessionCookie();
  window.location.href = '/index';
});

function deleteSessionCookie() {
  deleteCookie('sessionID');
}

// ============================
// Draw / Resign / Challenge
// ============================

let drawOfferDeclined = false;
let challengeDeclined = false;
let gameIsOver = false;

function resetGameActionButtons() {
  drawOfferDeclined = false;
  challengeDeclined = false;
  gameIsOver = false;
}

function disableAllGameActions() {
  const btns = document.querySelectorAll('.game-btn');
  btns.forEach(b => b.disabled = true);
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// --- Resign button ---
const btnResign = document.getElementById('btn-resign');
if (btnResign) {
  btnResign.addEventListener('click', () => {
    if (gameIsOver) return;
    const modal = document.getElementById('resignModal');
    if (modal) modal.style.display = 'flex';
  });
}

const btnResignCancel = document.getElementById('btn-resign-cancel');
if (btnResignCancel) {
  btnResignCancel.addEventListener('click', () => {
    document.getElementById('resignModal').style.display = 'none';
  });
}

const btnResignConfirm = document.getElementById('btn-resign-confirm');
if (btnResignConfirm) {
  btnResignConfirm.addEventListener('click', () => {
    document.getElementById('resignModal').style.display = 'none';
    socket.emit('resign', matchId);
    gameIsOver = true;
    can_move = false;
    disableAllGameActions();
  });
}

// --- Offer Draw button ---
const btnOfferDraw = document.getElementById('btn-offer-draw');
if (btnOfferDraw) {
  btnOfferDraw.addEventListener('click', () => {
    if (gameIsOver || drawOfferDeclined) return;
    socket.emit('drawOffer', matchId);
    btnOfferDraw.disabled = true;
    showToast('Draw offer sent');
  });
}

// --- Challenge button ---
const btnChallenge = document.getElementById('btn-challenge');
if (btnChallenge) {
  btnChallenge.addEventListener('click', () => {
    if (gameIsOver || challengeDeclined) return;
    socket.emit('challenge', matchId);
    btnChallenge.disabled = true;
    showToast('Challenge sent');
  });
}

// --- Incoming: Draw offer from opponent ---
socket.on('drawOfferReceived', (data) => {
  if (gameIsOver) return;
  const modal = document.getElementById('drawOfferModal');
  if (modal) modal.style.display = 'flex';
});

// Draw offer: Accept
const btnDrawAccept = document.getElementById('btn-draw-accept');
if (btnDrawAccept) {
  btnDrawAccept.addEventListener('click', () => {
    document.getElementById('drawOfferModal').style.display = 'none';
    socket.emit('drawResponse', matchId, true);
    gameIsOver = true;
    can_move = false;
    disableAllGameActions();
  });
}

// Draw offer: Decline
const btnDrawDecline = document.getElementById('btn-draw-decline');
if (btnDrawDecline) {
  btnDrawDecline.addEventListener('click', () => {
    document.getElementById('drawOfferModal').style.display = 'none';
    socket.emit('drawResponse', matchId, false);
  });
}

// Draw declined by opponent (sent back to offerer)
socket.on('drawDeclined', () => {
  drawOfferDeclined = true;
  showToast('Draw offer declined');
});

// --- Incoming: Challenge from opponent ---
socket.on('challengeReceived', (data) => {
  if (gameIsOver) return;
  const modal = document.getElementById('challengeModal');
  if (modal) modal.style.display = 'flex';
});

// Challenge: Accept
const btnChallengeAccept = document.getElementById('btn-challenge-accept');
if (btnChallengeAccept) {
  btnChallengeAccept.addEventListener('click', () => {
    document.getElementById('challengeModal').style.display = 'none';
    socket.emit('challengeResponse', matchId, true);
    gameIsOver = true;
    can_move = false;
    disableAllGameActions();
  });
}

// Challenge: Decline
const btnChallengeDecline = document.getElementById('btn-challenge-decline');
if (btnChallengeDecline) {
  btnChallengeDecline.addEventListener('click', () => {
    document.getElementById('challengeModal').style.display = 'none';
    socket.emit('challengeResponse', matchId, false);
  });
}

// Challenge declined by opponent
socket.on('challengeDeclined', () => {
  challengeDeclined = true;
  showToast('Challenge declined');
});

// --- Incoming: Resign from opponent ---
socket.on('resignReceived', (data) => {
  gameIsOver = true;
  can_move = false;
  clearSession();
  disableAllGameActions();
  const colorName = data.resigned === 0 ? 'white' : 'black';
  if (my_color === data.resigned) {
    document.getElementById('status').innerText = 'You resigned. You lost. 😢';
  } else {
    document.getElementById('status').innerText = `${colorName} resigned. You won! 🎉`;
  }
});

// --- Incoming: Game end (agreement draw) ---
socket.on('gameEnd', (data) => {
  can_move = false;
  gameIsOver = true;
  clearSession();
  disableAllGameActions();
  if (!data) {
    document.getElementById('status').innerText = 'Game over';
    return;
  }
  const messages = {
    'draw': 'Ничья! 🤝',
    'win': 'Победа! 🎉',
    'loss': 'Поражение 😞',
    'timeout': 'Время вышло! ⏰',
    'opponent_disconnect': 'Оппонент отключился — победа! 🎉',
  };
  document.getElementById('status').innerText = messages[data.result] || 'Game over';
  is_being_validated = false;

  // F2: show updated ratings in the status line (rated games only — the
  // server emits 'elo' right after 'gameEnd' with both players' new ratings).
  if (myElo !== null && oppElo !== null) {
    document.getElementById('status').innerText += ` (Elo: вы ${myElo}, соперник ${oppElo})`;
  }
  // F3: if the replay is already in hand (or saved from a pre-end receive),
  // expose it in the end modal.
  if (replayMoves && replayMoves.length) showReplay();
});

// --- F3: replay (move history + playback) ---
// The server emits 'replay' with the full move list right after 'gameEnd'.
// Each move: { n, color, piece, capture, from {x,y}, to {x,y}, san, fen,
// fenAfter } — fen/fenAfter are FEN snapshots (before/after the move), so
// rewinding is just fen_to_board + draw + render_board; no re-simulation.
const PIECE_ICONS = { '0001': ['♙','♟'], '0010': ['♘','♞'], '0011': ['♗','♝'], '0100': ['♖','♜'], '0101': ['♕','♛'], '0110': ['♔','♚'] };
let replayMoves = null;      // normalized move list from the server
let replayIndex = 0;         // how many moves are applied to the displayed board (0 = start)
let replayTimer = null;      // autoplay interval handle

function replayKey() { return 'replay_' + matchId; }

function saveReplayLocal(moves) {
  try {
    localStorage.setItem(replayKey(), JSON.stringify(moves));
    localStorage.setItem(replayKey() + '_ready', 'true');
  } catch (e) { /* storage full/unavailable — replay still works in-memory */ }
}

function clearReplayLocal() {
  try {
    localStorage.removeItem(replayKey());
    localStorage.removeItem(replayKey() + '_ready');
  } catch (e) {}
}

function loadReplayLocal() {
  try {
    const raw = localStorage.getItem(replayKey());
    if (!raw || localStorage.getItem(replayKey() + '_ready') !== 'true') return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) { return null; }
}

function pieceIcon(piece) {
  const key = (piece & 0b1111).toString(2).padStart(4, '0');
  const icons = PIECE_ICONS[key];
  if (!icons) return '?';
  // color bit 0b1000 set = black piece
  return icons[piece & 0b1000 ? 1 : 0];
}

function stopReplayAutoplay() {
  if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
}

function renderReplayList() {
  const list = document.getElementById('replay-list');
  if (!list || !replayMoves) return;
  list.innerHTML = '';
  const ul = document.createElement('ul');
  ul.style.listStyle = 'none';
  ul.style.padding = '0';
  for (const m of replayMoves) {
    const li = document.createElement('li');
    li.textContent = `${m.n}. ${pieceIcon(m.piece)} ${m.san}`;
    if (m.n === replayIndex) { li.style.fontWeight = 'bold'; li.style.color = '#ffd369'; }
    ul.appendChild(li);
  }
  list.appendChild(ul);
  // keep the active entry visible
  const active = ul.children[replayIndex - 1];
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
}

function applyReplayPosition(idx) {
  if (!replayMoves) return;
  // board is the global from game.js (possibly rotated for black); the board
  // variable itself is what draw()/render_board() read, so just replace it.
  if (idx <= 0) {
    fen_to_board(start_fen); // rewrites global `board`
  } else {
    // position after move idx = the fenAfter of the idx-th move
    const m = replayMoves[idx - 1];
    if (m && m.fenAfter) fen_to_board(m.fenAfter);
  }
  replayIndex = Math.max(0, Math.min(idx, replayMoves.length));
  draw();
  render_board();
  renderReplayList();
}

function showReplay() {
  const box = document.getElementById('replay-box');
  if (!box) return;
  box.style.display = 'block';
  replayIndex = 0;
  stopReplayAutoplay();
  applyReplayPosition(0);
}

socket.on('replay', (moves) => {
  if (!Array.isArray(moves)) return;
  replayMoves = moves;
  saveReplayLocal(moves);
  // If the game is already over and the end modal is open, reveal the replay.
  const modal = document.getElementById('gameEndModal');
  if (modal && modal.style.display !== 'none' && moves.length) showReplay();
});

// Replay controls (wired once; elements exist in game.ejs)
(function initReplayControls() {
  const prev = document.getElementById('replay-prev');
  const play = document.getElementById('replay-play');
  const pause = document.getElementById('replay-pause');
  const next = document.getElementById('replay-next');
  const reset = document.getElementById('replay-reset');
  if (!prev || !play || !pause || !next || !reset) return;
  prev.onclick = () => { stopReplayAutoplay(); applyReplayPosition(replayIndex - 1); };
  next.onclick = () => { stopReplayAutoplay(); applyReplayPosition(replayIndex + 1); };
  reset.onclick = () => { stopReplayAutoplay(); applyReplayPosition(0); };
  pause.onclick = () => { stopReplayAutoplay(); };
  play.onclick = () => {
    if (!replayMoves || replayTimer) return;
    if (replayIndex >= replayMoves.length) applyReplayPosition(0); // restart from the top
    replayTimer = setInterval(() => {
      if (replayIndex >= replayMoves.length) { stopReplayAutoplay(); return; }
      applyReplayPosition(replayIndex + 1);
    }, 1000);
  };
  // "Back to Lobby" — drop this match's replay from localStorage before leaving.
  const backBtn = document.getElementById('replay-back-lobby');
  if (backBtn) {
    backBtn.onclick = () => { stopReplayAutoplay(); clearReplayLocal(); window.location.href = '/index'; };
  }
})();

let myElo = null;
let oppElo = null;
socket.on('elo', (data) => {
  // player1 = white = color 0, player2 = black = color 1
  if (my_color === 0) {
    myElo = data.player1;
    oppElo = data.player2;
  } else {
    myElo = data.player2;
    oppElo = data.player1;
  }
});

// return from server on whether a move was validated or not
socket.on('validated', (boardState, turnState, extra) => {
  // Server rejected the move — show feedback and don't update board
  if (extra && extra.rejected) {
    wrong_move_sound.play();
    const cnv = document.getElementById('cnv');
    cnv.classList.add("shake");
    setTimeout(() => cnv.classList.remove("shake"), 100);
    is_being_validated = false;
    // Don't clear selection — let the player try again
    return;
  }

  // Handle pending promotion — show selector before updating board
  if (extra && extra.pendingPromotion) {
    showPromotionSelector(extra.promotionColor);
  }
  // Play sound for the move (server already confirmed validity)
  if (can_move) {
    if (my_color == white) {
      if (((boardState[from_position.y][from_position.x] & 0b1111) == blank)
        && (board[to_position.y][to_position.x] & 0b1111) != blank)
        capture_sound.play();
      else if ((boardState[from_position.y][from_position.x] & 0b1111) == blank)
        move_sound.play();
    }
    else {
      // black: from_position/to_position are VISUAL coords; boardState is in
      // server orientation — orientToServer is the same 180-degree map for
      // both directions (identity for white, so this keeps the legacy index
      // arithmetic byte-for-byte) — single orientation seam: layout.js
      let sf = window.ChessLayout.orientToServer(from_position.x, from_position.y, my_color);
      let tf = window.ChessLayout.orientToServer(to_position.x, to_position.y, my_color);
      if (((boardState[sf.y][sf.x] & 0b1111) == blank)
        && (board[tf.y][tf.x] & 0b1111) != blank)
        capture_sound.play();
      else if ((boardState[sf.y][sf.x] & 0b1111) == blank)
        move_sound.play();
    }
  }
  if (my_color == 0)
    board = boardState;
  else
    // Black sees rotated board (180°) — single orientation seam: layout.js
    board = window.ChessLayout.rotateBoard(boardState, my_color);
  is_being_validated = false;
  // Clear click-to-move selection after server response
  selectedSquare = null;
  legalMoveSquares.clear();
  if (turnState == my_color) {
    document.getElementById('status').innerText = 'Your turn';
    can_move = true;
  }
  else {
    document.getElementById('status').innerText = 'Opponent\'s turn';
    can_move = false;
  }
  // Redraw the board after move validation
  render_board();
  renderCapturedPieces();
  
});

// checkmate is reached
socket.on('checkMate', turn => {
  can_move = false;
  gameIsOver = true;
  selectedSquare = null;
  legalMoveSquares.clear();
  clearSession();
  disableAllGameActions();
  if(my_color == turn){
    document.getElementById('status').innerText = 'Check Mate you lost! 😢';
  }
  else
    document.getElementById('status').innerText = 'Check Mate you Won! 🎉';
});

// stalemate (draw)
socket.on('stalemate', () => {
  can_move = false;
  gameIsOver = true;
  clearSession();
  disableAllGameActions();
  document.getElementById('status').innerText = 'Stalemate — Draw! 🤝';
});

// draw (threefold repetition)
socket.on('draw', (data) => {
  can_move = false;
  gameIsOver = true;
  clearSession();
  disableAllGameActions();
  if (!data) {
    document.getElementById('status').innerText = 'Ничья! 🤝';
    return;
  }
  const reasons = {
    'threefold': 'Ничья — три повторения хода! 🤝',
    'insufficient': 'Ничья — недостаточный материал! 🤝',
    'fifty': 'Ничья — правило 50 ходов! 🤝',
  };
  document.getElementById('status').innerText = reasons[data.reason] || 'Ничья! 🤝';
});

// Takeback button
const btnTakeback = document.getElementById('btn-takeback');
let takebackDeclined = false;
if (btnTakeback) {
  btnTakeback.addEventListener('click', () => {
    if (gameIsOver || takebackDeclined) return;
    socket.emit('takebackRequest', matchId);
    showToast('Takeback request sent');
  });
}

// Incoming takeback offer from opponent
socket.on('takebackOfferReceived', (data) => {
  if (gameIsOver) return;
  const modal = document.getElementById('takebackOfferModal');
  if (modal) modal.style.display = 'flex';
});

// Takeback: Accept
const btnTakebackAccept = document.getElementById('btn-takeback-accept');
if (btnTakebackAccept) {
  btnTakebackAccept.addEventListener('click', () => {
    document.getElementById('takebackOfferModal').style.display = 'none';
    socket.emit('takebackResponse', matchId, true);
  });
}

// Takeback: Decline
const btnTakebackDecline = document.getElementById('btn-takeback-decline');
if (btnTakebackDecline) {
  btnTakebackDecline.addEventListener('click', () => {
    document.getElementById('takebackOfferModal').style.display = 'none';
    socket.emit('takebackResponse', matchId, false);
  });
}

// Takeback accepted by opponent → restore board
socket.on('takebackAccepted', (boardState, turnState) => {
  if (my_color == 0) {
    board = boardState;
  } else {
    // Black sees rotated board (180°) — single orientation seam: layout.js
    board = window.ChessLayout.rotateBoard(boardState, my_color);
  }
  if (turnState == my_color) {
    document.getElementById('status').innerText = 'Your turn';
    can_move = true;
  } else {
    document.getElementById('status').innerText = 'Opponent\'s turn';
    can_move = false;
  }
});

// Takeback declined by opponent
socket.on('takebackDeclined', () => {
  takebackDeclined = true;
  document.getElementById('btn-takeback').disabled = true;
  showToast('Takeback declined');
});

// Takeback error
socket.on('takebackError', (msg) => {
  showToast(msg);
});

// repetition warning
socket.on('repetitionWarning', (data) => {
  document.getElementById('repetitionWarningText').innerText = data.patternDescription;
  document.getElementById('repetitionWarningModal').style.display = 'block';
});

// --- Socket disconnect / error — unlock move validation ---
socket.on('disconnect', () => {
  is_being_validated = false;
});
socket.on('connect_error', () => {
  is_being_validated = false;
});
socket.on('reconnect_failed', () => {
  is_being_validated = false;
});