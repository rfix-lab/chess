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
  saveSession(gameId, color); // persist session
  if (color == 0) {
    document.getElementById('status').innerText = 'Playing as white';
    can_move = true;
  }
  else {
    document.getElementById('status').innerText = 'Playing as black';
    for (let i = 0; i < no_of_squares; i++) {
      for (let j = i; j < no_of_squares; j++) {
        let temp = board[i][j];
        board[i][j] = board[no_of_squares - i - 1][no_of_squares - j - 1];
        board[no_of_squares - i - 1][no_of_squares - j - 1] = temp;
      }
    }
    for (let i = 0; i < no_of_squares / 2; i++) {
      let temp = board[i][i];
      board[i][i] = board[no_of_squares - i - 1][no_of_squares - i - 1];
      board[no_of_squares - i - 1][no_of_squares - i - 1] = temp;
    }
  }
});

// Server confirms reconnect — restores board state
socket.on('reconnected', (color, gameId, boardState, turnState) => {
  clearSession(); // no longer need to reconnect
  my_color = color;
  match_id = gameId;
  saveSession(gameId, color);

  // Restore board from server state
  if (color == 0) {
    board = boardState;
  } else {
    // Black sees rotated board
    for (let i = 0; i < no_of_squares; i++) {
      board[i] = [];
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

// Server says game is gone → redirect to lobby
socket.on('gameNotFound', () => {
  clearSession();
  window.location.href = '/index';
});

// return from server on whether a move was validated or not
socket.on('validated', (boardState, turnState) => {
  let changedSquares = 2;
  // for(let i = 0; i < noOfSquares; i++){
  //   for(let j = 0; j < noOfSquares; j++){
  //     if(my_color == 0 && (boardState[i][j] == board[i][j]))
  //       changedSquares++;
  //     if(my_color == 1 && (boardState[i][j] == boardState[noOfSquares - i - 1][noOfSquares - j - 1]))
  //       changedSquares++;
  //   }
  // }
  if(can_move){
    if(my_color == white){
      if (((boardState[from_position.y][from_position.x] & 0b1111) == blank) 
        && (board[to_position.y][to_position.x] & 0b1111) != blank)
        capture_sound.play();
      else if ((boardState[from_position.y][from_position.x] & (0b1111)) == blank)
          move_sound.play();
      else{
        if(changedSquares > 1){
          wrong_move_sound.play();
          document.getElementById('cnv').classList.add("shake");
          setTimeout(()=>{
            document.getElementById('cnv').classList.remove("shake");
          }, 100)
        }
      }
    }
    else{
      if (((boardState[no_of_squares - 1 - from_position.y][no_of_squares - 1 - from_position.x] & 0b1111) == blank) 
        && (board[ no_of_squares - 1 - to_position.y][no_of_squares - 1 - to_position.x] & 0b1111) != blank)
        capture_sound.play();
      else if ((boardState[no_of_squares - 1 - from_position.y][no_of_squares - 1 - from_position.x] & (0b1111)) == blank)
          move_sound.play();
      else{
        if(changedSquares == 0){
          wrong_move_sound.play();
          document.getElementById('cnv').classList.add("shake");
          setTimeout(()=>{
            document.getElementById('cnv').classList.remove("shake");
          }, 100)
        }
      }
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
  clearSession(); // game over, don't reconnect
  if(my_color == turnToColor(turn)){
    document.getElementById('status').innerText = 'Check Mate you lost! 😢';
  }
  else
    document.getElementById('status').innerText = 'Check Mate you Won! 🎉';
});