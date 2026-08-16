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
  return document.cookie.split('; ').find(row => row.split('=')[0] === name);
}

function deleteCookie(name) {
  // path=/ must match writeCookie, otherwise the browser won't expire the cookie.
  document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
}
