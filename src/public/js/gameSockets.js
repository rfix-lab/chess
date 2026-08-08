var socket = io();

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
function readCookie(name) {
  return document.cookie.split('; ').find(row => row.split('=')[0] === name);
}

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
  socket.emit('reconnect', { gameId: session.gameId, color: session.color, sessionID });
  return true;
}

// On page load: try reconnect first; if no session, fall back to normal auth
if (!tryReconnect()) {
  sendCookie();
}

// Server tells us to start a new game (normal flow)
socket.on('startGame', (color, gameId) => {
  my_color = color;
  match_id = gameId;
  saveSession(gameId, color);
  capturedByWhite = [];
  capturedByBlack = [];
  if (color == 0) {
    document.getElementById('status').innerText = 'Playing as white';
    can_move = true;
  }
  else {
    document.getElementById('status').innerText = 'Playing as black';
    // Black sees rotated board (180°)
    let rotated = [];
    for (let i = 7; i >= 0; i--) {
      rotated.push(board[i].slice().reverse());
    }
    board = rotated;
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
  match_id = gameId;
  saveSession(gameId, color);
  capturedByWhite = [];
  capturedByBlack = [];

  // Restore board from server state
  if (color == 0) {
    board = boardState;
  } else {
    // Black sees rotated board (180°)
    let rotated = [];
    for (let i = 7; i >= 0; i--) {
      rotated.push(boardState[i].slice().reverse());
    }
    board = rotated;
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
});

// Server says game is gone → redirect to lobby
socket.on('gameNotFound', () => {
  clearSession();
  window.location.href = '/index';
});

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
    socket.emit('resign', match_id);
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
    socket.emit('drawOffer', match_id);
    btnOfferDraw.disabled = true;
    showToast('Draw offer sent');
  });
}

// --- Challenge button ---
const btnChallenge = document.getElementById('btn-challenge');
if (btnChallenge) {
  btnChallenge.addEventListener('click', () => {
    if (gameIsOver || challengeDeclined) return;
    socket.emit('challenge', match_id);
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
    socket.emit('drawResponse', match_id, true);
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
    socket.emit('drawResponse', match_id, false);
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
    socket.emit('challengeResponse', match_id, true);
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
    socket.emit('challengeResponse', match_id, false);
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
  gameIsOver = true;
  can_move = false;
  clearSession();
  disableAllGameActions();
  if (data.result === 'draw') {
    document.getElementById('status').innerText = 'Draw by agreement! 🤝';
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
      if (((boardState[no_of_squares - 1 - from_position.y][no_of_squares - 1 - from_position.x] & 0b1111) == blank)
        && (board[no_of_squares - 1 - to_position.y][no_of_squares - 1 - to_position.x] & 0b1111) != blank)
        capture_sound.play();
      else if ((boardState[no_of_squares - 1 - from_position.y][no_of_squares - 1 - from_position.x] & 0b1111) == blank)
        move_sound.play();
    }
  }
  if (my_color == 0)
    board = boardState;
  else {
    for (let i = 0; i < no_of_squares; i++) {
      for (let j = 0; j < no_of_squares; j++) {
        board[i][j] = boardState[no_of_squares - i - 1][no_of_squares - j - 1];
      }
    }
  }
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
  
});

// checkmate is reached
socket.on('checkMate', turn => {
  can_move = false;
  gameIsOver = true;
  selectedSquare = null;
  legalMoveSquares.clear();
  clearSession();
  disableAllGameActions();
  if(my_color == turnToColor(turn)){
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
    socket.emit('takebackRequest', match_id);
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
    socket.emit('takebackResponse', match_id, true);
  });
}

// Takeback: Decline
const btnTakebackDecline = document.getElementById('btn-takeback-decline');
if (btnTakebackDecline) {
  btnTakebackDecline.addEventListener('click', () => {
    document.getElementById('takebackOfferModal').style.display = 'none';
    socket.emit('takebackResponse', match_id, false);
  });
}

// Takeback accepted by opponent → restore board
socket.on('takebackAccepted', (boardState, turnState) => {
  if (my_color == 0) {
    board = boardState;
  } else {
    for (let i = 0; i < no_of_squares; i++) {
      for (let j = 0; j < no_of_squares; j++) {
        board[i][j] = boardState[no_of_squares - i - 1][no_of_squares - j - 1];
      }
    }
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