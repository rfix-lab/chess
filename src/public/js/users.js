// Users directory page (contract 36 §2).
// The /users page shell is server-rendered (A2 owns users.ejs); this script
// re-renders the directory client-side from GET /api/users/stats so every row
// gets the invite menu (the server skeleton stays as the pre-JS fallback):
//   - rows (Имя | Elo | Игр); clicking a row opens /user?name=<username>.
//   - context menu (desktop right-click, or a 500 ms long-press on touch) on a
//     row -> «Пригласить» with the method choice (Классика / Рапид). The page
//     has no 'auth' socket event — the sessionID cookie rides the socket.io
//     handshake and the server resolves the user itself (resolveUserFromSocket).
//   - invite:create {targetUsername, method} -> invite:created (success toast)
//     / invite:failed (Russian reason toast). A logged-out click on «Пригласить»
//     fails fast client-side via /api/me with «Сначала войдите» (the server
//     remains authoritative: it answers 'auth' regardless).
//   - the own row (me from /api/me) gets no invite option.
//
// All user-visible texts are Russian; no emoji (contract 36).

function usersToast(text) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = text;
  // restart the fade-out animation
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  clearTimeout(t.__timer);
  t.__timer = setTimeout(() => t.remove(), 3000);
}

const USER_METHODS = [
  { value: 'standard', label: 'Классика' },
  { value: 'rapid', label: 'Рапид' },
];

let meName = null;

// Row click -> public profile of that user.
function openProfile(username) {
  window.location.href = '/user?name=' + encodeURIComponent(username);
}

// Build one table row. Classes match the server skeleton (A2's users.ejs) so
// D1's CSS keeps applying: .user-row (+ .user-self for the own row).
function buildRow(u) {
  const username = String(u.username || '');
  const isSelf = !!(meName && username === meName);
  const tr = document.createElement('tr');
  tr.className = isSelf ? 'user-row user-self' : 'user-row';
  tr.dataset.username = username;

  const nameTd = document.createElement('td');
  const link = document.createElement('a');
  link.href = '/user?name=' + encodeURIComponent(username);
  link.textContent = username + (isSelf ? ' (вы)' : '');
  nameTd.appendChild(link);
  tr.appendChild(nameTd);

  const eloTd = document.createElement('td');
  eloTd.textContent = String(u.elo != null ? u.elo : '-');
  tr.appendChild(eloTd);

  const gamesTd = document.createElement('td');
  gamesTd.textContent = String(u.games != null ? u.games : 0);
  tr.appendChild(gamesTd);

  // The row's click navigates to the profile (the inner <a> does the same);
  // a click landing on the link itself must not fire the row handler twice.
  tr.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    openProfile(username);
  });

  // The own row has no invite option (its menu opens with no entries).
  wireUserMenu(tr, username, !isSelf);
  return tr;
}

// ---- invite context menu (right-click / long-press) ----
let userMenu = null;

function openUserMenu(username, anchorEl) {
  let menu = document.getElementById('user-context-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'user-context-menu';
    menu.className = 'user-menu hide';
    document.body.appendChild(menu);
    document.addEventListener('click', () => closeUserMenu(), true);
  }
  userMenu = menu;

  menu.textContent = '';
  const head = document.createElement('div');
  head.className = 'user-menu-head';
  head.textContent = 'Пригласить ' + username + ':';
  menu.appendChild(head);

  const inviteHead = document.createElement('div');
  inviteHead.className = 'user-menu-item user-menu-invite';
  inviteHead.textContent = 'Пригласить';
  menu.appendChild(inviteHead);

  if (meName) {
    for (const m of USER_METHODS) {
      const item = document.createElement('div');
      item.className = 'user-menu-item user-menu-method';
      item.dataset.method = m.value;
      item.textContent = m.label;
      item.addEventListener('click', () => startInvite(username, m.value));
      menu.appendChild(item);
    }
  } else {
    // Logged out: the single entry carries the client-side check (server
    // still answers 'auth' authoritatively if we are wrong about the session).
    const item = document.createElement('div');
    item.className = 'user-menu-item user-menu-method';
    item.dataset.method = 'standard';
    item.textContent = 'Пригласить';
    item.addEventListener('click', () => startInvite(username, 'standard'));
    menu.appendChild(item);
  }

  // Position at the anchor row (rows are short; the menu is small).
  const rect = anchorEl.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(rect.right - 180, window.innerWidth - 190)) + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.classList.remove('hide');
  menu.classList.add('show');
}

function closeUserMenu() {
  if (userMenu) {
    userMenu.classList.remove('show');
    userMenu.classList.add('hide');
  }
}

// Logged-out click on «Пригласить» -> toast «Сначала войдите» (contract 36).
async function startInvite(username, method) {
  let me = null;
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.ok) me = await res.json();
  } catch (e) { /* non-fatal: let the server reject with 'auth' */ }
  if (!me || !me.username) {
    usersToast('Сначала войдите');
    return;
  }
  ioSocketsEmit({ targetUsername: username, method });
}

// Rows with menu support: desktop right-click + touch long-press (500 ms).
function wireUserMenu(tr, username, invitable) {
  tr.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openUserMenu(username, tr);
  });
  tr.addEventListener('touchstart', (e) => {
    const touch = e.touches && e.touches[0];
    if (!touch || !invitable) return;
    // A hold of 500 ms without moving 10px+ opens the menu; movement cancels.
    tr.__hold = {
      timer: setTimeout(() => {
        tr.__hold = null;
        openUserMenu(username, tr);
      }, 500),
      x: touch.clientX,
      y: touch.clientY,
    };
  }, { passive: true });
  const cancelHold = (e) => {
    const hold = tr.__hold;
    if (!hold) return;
    clearTimeout(hold.timer);
    tr.__hold = null;
    const touch = e.changedTouches && e.changedTouches[0];
    if (touch && (Math.abs(touch.clientX - hold.x) > 10 || Math.abs(touch.clientY - hold.y) > 10)) {
      return; // it was a scroll — the click handler opens the profile
    }
  };
  tr.addEventListener('touchend', cancelHold);
  tr.addEventListener('touchmove', cancelHold);
  tr.addEventListener('touchcancel', cancelHold);
}

// ---- socket (the sessionID cookie rides the handshake; the server resolves
// the user itself — no 'auth' emission from this page) ----
let socket = null;
function ioSocketsEmit(payload) {
  if (!socket) {
    socket = io();
    socket.on('invite:created', (data) => {
      closeUserMenu();
      usersToast('Приглашение отправлено');
    });
    socket.on('invite:failed', (data) => {
      const reason = (data && data.reason) || '';
      const text = {
        'auth': 'Нужно войти',
        'no-user': 'Нет такого пользователя',
        'self': 'Нельзя пригласить самого себя',
        'method-na': 'Неизвестный метод',
      }[reason] || 'Не удалось отправить приглашение';
      usersToast(text);
    });
  }
  socket.emit('invite:create', payload);
}

// ---- main: mark the own row and make every row interactive ----
// The /users page is server-rendered (A2) with the full user table. We PREFER
// to enhance those rows in place (mark the own row, wire the invite menu) so
// the list is visible from first paint and NEVER depends on a slow fetch — a
// clear-then-rebuild would blank the directory for the whole fetch window, and
// a slow /api/me + /api/users/stats under load made the rows reappear after the
// E2E row's poll had already timed out. The API rebuild is only the fallback
// for when the server rendered an empty skeleton (no users yet).
(async function loadUsers() {
  let me = null;
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.ok) me = await res.json();
  } catch (e) { /* guest */ }
  if (me && me.username) meName = me.username;

  const tbody = document.getElementById('users-body');
  if (!tbody) return;

  const serverRows = Array.from(tbody.querySelectorAll('tr[data-username]'));
  if (serverRows.length > 0) {
    // Enhance the server-rendered rows in place (no blank window).
    for (const tr of serverRows) wireServerRow(tr);
    return;
  }

  // Fallback: the server rendered the empty skeleton — build from the API.
  let stats = [];
  try {
    const res = await fetch('/api/users/stats', { credentials: 'same-origin' });
    if (res.ok) stats = await res.json();
    if (!Array.isArray(stats)) stats = [];
  } catch (e) { stats = []; }
  tbody.textContent = '';
  for (const u of stats) tbody.appendChild(buildRow(u));
})();

// Wire an existing server-rendered row: self-class + the invite context menu.
function wireServerRow(tr) {
  const username = tr.getAttribute('data-username');
  if (!username) return;
  const isSelf = !!(meName && username === meName);
  if (isSelf) tr.classList.add('user-self'); else tr.classList.remove('user-self');
  // Row click -> profile (the inner <a> already points at /user?name=);
  // a click landing on the link must not double-fire the row handler.
  tr.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    openProfile(username);
  });
  // The own row has no invite option (its menu opens with no entries).
  wireUserMenu(tr, username, !isSelf);
  tr.setAttribute('data-wired', '1');
};
