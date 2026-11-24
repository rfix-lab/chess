play = () => {
  // Contract 36 §1: [Играть] creates the game IMMEDIATELY — emit 'private-match'
  // over the lobby socket; on the echoed matchId navigate to /game?matchId=<id>
  // WITH #link so the game page auto-opens the link modal once (the game page
  // owns link display: contract 32). Guests and logged-in users alike use this
  // path (private matches work unauthenticated). While the echo is pending the
  // button is disabled to keep double-creates from double-clicks.
  const btn = document.getElementById('play-button');
  if (btn) { btn.disabled = true; }
  socket.once('private-match', (id) => {
    if (!id) { if (btn) btn.disabled = false; return; }
    // != null guard: a matchId of 0 (first private match after a restart) is a
    // valid id — the id is an opaque string anyway, so any truthy id navigates.
    window.location.href = '/game?matchId=' + encodeURIComponent(id) + '#link';
  });
  socket.emit('private-match', 1);
};

genLink = play; // legacy alias — events.js still exposes the old name
