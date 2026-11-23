// Lobby page sockets (contract 32 — client scope).
// The lobby NO LONGER generates a private link: that moved to the GAME page
// ("Ссылка на игру"). The lobby now (a) handles login / registration and (b)
// renders the 'invites' event so a logged-in user sees pending invitations.

let socket = io();

// login/signup form mode — [Вход] and [Регистрация] toggle it; #submit-auth
// emits whichever event the current mode calls for.
let authMode = 'login';

// Show the shared form in the requested mode (events.js also exposes the old
// submitLoginDetails/submitSignUpDetails; those still work and switch mode).
function showAuthForm(mode) {
  authMode = (mode === 'signup') ? 'signup' : 'login';
  const form = document.getElementById('form');
  const title = document.getElementById('form-title');
  const submit = document.getElementById('submit-auth');
  if (!form || !submit) return;
  if (title) title.textContent = (authMode === 'signup') ? 'Регистрация' : 'Вход';
  submit.textContent = (authMode === 'signup') ? 'Зарегистрироваться' : 'Войти';
  form.classList.remove('hide');
  form.classList.add('show');
}

function hideAuthForm() {
  const form = document.getElementById('form');
  if (!form) return;
  form.classList.remove('show');
  form.classList.add('hide');
}

// Unified submit: emits 'signin' or 'signup' per the current mode.
function submitAuth() {
  if (authMode === 'signup') {
    submitSignUpDetails();
  } else {
    submitLoginDetails();
  }
}

// --- Session state helpers ---
// Login state is read from the sessionID cookie (same check the GAME page uses
// to hide invite UI from guests). A fresh load with a valid cookie shows the
// authenticated controls immediately.
function isLoggedIn() {
  return readCookie('sessionID') != null;
}

function reflectAuthState() {
  const authed = document.getElementById('authed');
  if (!authed) return;
  if (isLoggedIn()) {
    authed.classList.remove('hide');
    authed.classList.add('show');
  } else {
    authed.classList.remove('show');
    authed.classList.add('hide');
  }
}

function doLogout() {
  deleteCookie('sessionID');
  // Addendum (contract 32): the lobby restores login state from /api/me on page
  // load, so clearing the cookie alone would be overwritten by the already-rendered
  // state — reload to re-run the restore check (401 -> form).
  window.location.reload();
}

// Big-button wiring (index.ejs).
(function wireBigButtons() {
  const login = document.getElementById('login-button');
  const register = document.getElementById('register-button');
  if (login) login.addEventListener('click', () => showAuthForm('login'));
  if (register) register.addEventListener('click', () => showAuthForm('signup'));
  // A returning, still-authenticated user: reveal Кабинет at load time (cookie
  // only — /api/me below is the authority on whether the session is still valid).
  reflectAuthState();
})();

// --- Addendum (contract 32): lobby restore-on-load (bug: F5 loses the login) ---
// The cookie survives the reload (writeCookie day=1), but the lobby used to
// render the logged-out form unconditionally. The server route GET /api/me (S-A)
// validates the cookie: 200 {username, elo} -> render the logged-in state
// exactly as after a signin; 401 -> the form, as today. Network failure is
// non-fatal (falls through to the logged-out form).
async function restoreSession() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok) return;
    const me = await res.json();
    if (!me || !me.username) return;
    const successDiv = document.getElementById('auth-success');
    if (successDiv) {
      successDiv.textContent = 'Вы вошли как ' + me.username;
      successDiv.classList.remove('hide');
      successDiv.classList.add('show');
    }
    hideAuthForm();
    reflectAuthState();
    // A valid session means the server recognizes us — request our live invites.
    socket.emit('invites:list');
  } catch (e) { /* non-fatal: stay logged out */ }
}
restoreSession();;

socket.on('signin', (valid, sessionID) => {
  if (valid) {
    let successDiv = document.getElementById('auth-success');
    let failDiv = document.getElementById('auth-fail');
    let usrnDiv = document.getElementById('signup-fail-usrnmexists');
    let psdDiv = document.getElementById('signup-fail-pswdlen');
    let invDiv = document.getElementById('signup-fail-pswdinvalid');
    let usernameInput = document.getElementById('username');

    hideAuthForm();

    if (failDiv.classList.contains('show')) failDiv.classList.remove('show');
    [usrnDiv, psdDiv, invDiv].forEach(d => { if (d) d.classList.remove('show'); });

    if (usernameInput && usernameInput.value) {
      successDiv.textContent = 'Вы вошли как ' + usernameInput.value;
    }
    successDiv.classList.remove('hide');
    successDiv.classList.add('show');

    writeCookie('sessionID', sessionID, 1);
    reflectAuthState();
    // Contract 32 §3: a fresh authenticated load gets its live invites pushed
    // right after auth — request them explicitly too (idempotent).
    socket.emit('invites:list');
  } else {
    let usernameInput = document.getElementById('username');
    let passwordInput = document.getElementById('password');
    let failDiv = document.getElementById('auth-fail');

    if (usernameInput) usernameInput.value = "";
    if (passwordInput) passwordInput.value = "";

    failDiv.classList.remove('hide');
    failDiv.classList.add('show');
  }
});

socket.on('signup', valid => {
  if (valid == 1) {
    // A fresh registration must log the user in to get a sessionID cookie.
    let usernameInput = document.getElementById('username');
    let passwordInput = document.getElementById('password');
    if (usernameInput && passwordInput) {
      socket.emit('signin', {
        username: usernameInput.value,
        password: passwordInput.value
      });
    }
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

// Contract 32: private-link generation MOVED to the GAME page ("Ссылка на игру").
// The lobby no longer listens for 'private-match' at all (its own socket never
// requests one now, and the E2E harness creates the match via its OWN raw socket).

// --- Invites (contract 32 §3) ---
// Server payload: [{from, fromElo, method, matchId, createdAt}] — stored
// invites addressed to the current user whose match is still LIVE. Rendered as
// rows "Имя (Elo N) — метод: <method> [Принять]" -> /game?matchId=<id>.
function renderInvites(payload) {
  const section = document.getElementById('invites');
  const list = document.getElementById('invites-list');
  if (!section || !list) return;
  if (!Array.isArray(payload)) payload = [];

  if (payload.length === 0) {
    section.classList.remove('show');
    section.classList.add('hide');
    list.textContent = '';
    return;
  }

  section.classList.remove('hide');
  section.classList.add('show');
  list.textContent = '';

  for (const inv of payload) {
    const row = document.createElement('div');
    row.className = 'invite-row';

    const label = document.createElement('span');
    label.className = 'invite-label';
    const methodText = (inv.method && inv.method !== 'standard') ? inv.method : 'стандартная';
    label.textContent = inv.from + (inv.fromElo != null ? ` (Elo ${inv.fromElo})` : '') +
      ' — метод: ' + methodText;
    row.appendChild(label);

    const accept = document.createElement('a');
    accept.className = 'invite-accept';
    accept.href = '/game?matchId=' + encodeURIComponent(inv.matchId);
    accept.textContent = 'Принять';
    row.appendChild(accept);

    list.appendChild(row);
  }
}

// Server emits 'invites' on load / after a successful auth (and on any change
// per the contract). Replace the section contents each time.
socket.on('invites', (payload) => {
  renderInvites(payload);
});

// On a fresh page load, if we already carry a session cookie, pull our invites.
// (The server also pushes them right after an authenticated 'auth', but the
// lobby page opens its own socket without authing, so we request here.)
if (isLoggedIn()) {
  socket.emit('invites:list');
}
