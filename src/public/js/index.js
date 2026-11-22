play = () => {
  // C5: if the author generated a private link, Play must join THAT match,
  // not the public lobby.
  // != null: matchId 0 (first private match after a restart) is a valid id.
  if (window.__privateMatchId != null) {
    window.location.href = '/game?matchId=' + window.__privateMatchId;
  } else {
    window.location.href = '/game';
  }
};

genLink = () => {
  socket.emit('private-match', 1);
};