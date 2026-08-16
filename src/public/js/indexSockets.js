let socket = io();

socket.on('signin', (valid, sessionID) => {
  if (valid) {
    let form = document.getElementById('form');
    let successDiv = document.getElementById('auth-success');
    let failDiv = document.getElementById('auth-fail');
    let usrnDiv = document.getElementById('signup-fail-usrnmexists');
    let psdDiv = document.getElementById('signup-fail-pswdlen');
    let usernameInput = document.getElementById('username');
    let playButton = document.getElementById('play-button');

    form.classList.add('hide');

    if (failDiv.classList.contains('show')) {
      failDiv.classList.remove('show');
      failDiv.classList.add('hide');
    }
    if (usrnDiv.classList.contains('show')) {
      usrnDiv.classList.remove('show');
      usrnDiv.classList.add('hide');
    }
    if (psdDiv.classList.contains('show')) {
      psdDiv.classList.remove('show');
      psdDiv.classList.add('hide');
    }

    successDiv.textContent = 'Logged in as ' + usernameInput.value;
    successDiv.classList.remove('hide');
    successDiv.classList.add('show');

    playButton.innerHTML = 'Play';

    writeCookie('sessionID', sessionID, 1);
  } else {
    let usernameInput = document.getElementById('username');
    let passwordInput = document.getElementById('password');
    let failDiv = document.getElementById('auth-fail');

    usernameInput.value = "";
    passwordInput.value = "";

    failDiv.classList.remove('hide');
    failDiv.classList.add('show');
  }
});

socket.on('signup', valid => {
  if (valid == 1) {
    let usernameInput = document.getElementById('username');
    let passwordInput = document.getElementById('password');

    let username = usernameInput.value;
    let password = passwordInput.value;

    socket.emit('signin', {
      username: username,
      password: password
    });
  } else {
    let signupDiv = document.getElementById('signup-fail');
    let failDiv = document.getElementById('auth-fail');

    if (failDiv.classList.contains('show')) {
      failDiv.classList.remove('show');
      failDiv.classList.add('hide');
    }

    signupDiv.classList.remove('hide');
    signupDiv.classList.add('show');

    if (valid == 0) {
      let usrnDiv = document.getElementById('signup-fail-usrnmexists');
      usrnDiv.classList.remove('hide');
      usrnDiv.classList.add('show');
    } else if (valid == -1) {
      let psdDiv = document.getElementById('signup-fail-pswdlen');
      psdDiv.classList.remove('hide');
      psdDiv.classList.add('show');
    } else if (valid == -2) {
      let invDiv = document.getElementById('signup-fail-pswdinvalid');
      invDiv.classList.remove('hide');
      invDiv.classList.add('show');
    }
  }
});

// F1: username autocomplete (native datalist, debounced ~300ms fetch).
(function () {
  let debounceTimer = null;
  let lastPrefix = '';
  let input = document.getElementById('username');
  let list = document.getElementById('username-list');
  if (!input || !list) return;

  const render = (names) => {
    list.textContent = '';
    for (const n of names) {
      const opt = document.createElement('option');
      opt.value = n;
      list.appendChild(opt);
    }
  };

  input.addEventListener('input', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    const prefix = input.value.trim();
    if (!prefix || prefix === lastPrefix) return;
    lastPrefix = prefix;
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch('/api/users?prefix=' + encodeURIComponent(prefix));
        if (res.ok) render(await res.json());
      } catch (e) { /* non-fatal: typing still works without suggestions */ }
    }, 300);
  });
})();

socket.on('private-match', matchId => {
  // C5: remember the match id so play() joins the author's own private match.
  window.__privateMatchId = matchId;

  let linkDiv = document.getElementById('generated-link'); 

  let url = window.location.host + '/game?matchId=' + matchId;

  linkDiv.innerHTML = url;
  linkDiv.href = url;

  linkDiv.classList.remove('hide');
  linkDiv.classList.add('show');
});