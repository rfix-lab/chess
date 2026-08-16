play = () => {
  window.location.href = '/game';
};

genLink = () => {
  socket.emit('private-match', 1);
};