// Theme management: dark (default) / light
// Persists choice in localStorage, respects prefers-color-scheme on first visit

(function () {
  'use strict';

  var STORAGE_KEY = 'chess_theme';

  function getSystemPreference() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark';
  }

  function initTheme() {
    var saved = localStorage.getItem(STORAGE_KEY);
    var theme = saved || getSystemPreference();
    applyTheme(theme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var icon = document.getElementById('themeIcon');
    if (icon) {
      icon.textContent = theme === 'light' ? '\u2600\ufe0f' : '\ud83c\udf19';
    }
    // Notify canvas code that colors need updating
    if (typeof updateBoardColors === 'function') {
      updateBoardColors();
    }
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme') || 'dark';
    var next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  // Listen for system theme changes (only if user hasn't made a choice)
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (!localStorage.getItem(STORAGE_KEY)) {
        applyTheme(getSystemPreference());
      }
    });
  }

  // Expose to global scope
  window.initTheme = initTheme;
  window.toggleTheme = toggleTheme;
  window.applyTheme = applyTheme;

  // Run on load
  initTheme();
})();
