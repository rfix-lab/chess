// Shared cookie helpers (H5: previously duplicated in index.js and gameSockets.js).
// Behavior is 1:1 with the original inline implementations.

function writeCookie(name, value, days) {
  let date = new Date();
  let expires = "";

  if (days) {
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    expires = "; expires=" + date.toGMTString();
  }

  document.cookie = name + "=" + value + expires + "; path=/";
}

function readCookie(name) {
  // BUGFIX (user-mode browser audit): the H5 dedup copy returned the whole
  // "name=value" ROW instead of the value. Both call sites (game page 'auth'
  // and 'reconnect') need the VALUE: the server received "sessionID=<hex>"
  // as the session id -> validateSession unknown-session -> authFailed ->
  // EVERY signed-in user was bounced from /game back to /index.
  const row = document.cookie.split('; ').find(r => r.split('=')[0] === name);
  return row ? row.slice(name.length + 1) : null;
}

function deleteCookie(name) {
  // path=/ must match writeCookie, otherwise the browser won't expire the cookie.
  document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
}
