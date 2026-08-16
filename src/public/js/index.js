play = () => {
  // C5: if the author generated a private link, Play must join THAT match,
  // not the public lobby.
  if (window.__privateMatchId) {
    window.location.href = '/game?matchId=' + window.__privateMatchId;
  } else {
    window.location.href = '/game';
  }
};

genLink = () => {
  socket.emit('private-match', 1);
};