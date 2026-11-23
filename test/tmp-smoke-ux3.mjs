// One-off orchestrator smoke (contract 36): lobby [Играть] immediate game +
// #link modal, [Пользователи] directory, right-click invite with method
// «Рапид», accept from lobby, resign, stats + public profile. Not part of gates.
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const require = createRequire(import.meta.url);
const PUPPETEER_ROOT = process.env.E2E_PUPPETEER_ROOT || '/root/.nvm/versions/node/v24.22.1/lib/node_modules';
const puppeteer = require(path.join(PUPPETEER_ROOT, 'puppeteer-core'));
const io = require('socket.io-client');

const PORT = Number(process.env.E2E_PORT || 6375);
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_LOG = '/tmp/smoke-ux3-server.log';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, what, to = 15000) => {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await fn(); } catch (e) {}
    if (v) return v;
    if (Date.now() - t0 > to) throw new Error('timeout waiting for ' + what);
    await sleep(150);
  }
};
const step = (n, s) => console.log(`UX3 ${n}: ${s}`);

const dataDir = fs.mkdtempSync('/tmp/smoke-ux3-data-');
const serverProc = spawn(process.execPath, ['src/index.js'], {
  env: { ...process.env, DEBUG: '1', PORT: String(PORT), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
});
fs.writeFileSync(SERVER_LOG, '');
serverProc.stdout.on('data', d => fs.appendFileSync(SERVER_LOG, d));
serverProc.stderr.on('data', d => fs.appendFileSync(SERVER_LOG, d));

let browser = null;
let failed = 0;
const check = (ok, name, detail = '') => {
  if (ok) step('ok', name);
  else { failed++; step('FAIL', name + (detail ? ' :: ' + detail : '')); }
};

try {
  await waitFor(() => fs.readFileSync(SERVER_LOG, 'utf8').includes('server started'), 'server start', 15000);
  step(1, 'server up on ' + PORT);

  const signupSignin = (username, password) => new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'] });
    const to = setTimeout(() => reject(new Error('raw: no session for ' + username)), 15000);
    s.on('connect', () => s.emit('signup', { username, password }));
    s.on('signup', valid => { if (valid === 1) s.emit('signin', { username, password }); });
    s.on('signin', (valid, sid) => { if (valid && sid) { clearTimeout(to); s.close(); resolve(sid); } });
    s.on('connect_error', e => reject(e));
  });
  const u1 = 'carol_' + Math.random().toString(36).slice(2, 6);
  const u2 = 'dave_' + Math.random().toString(36).slice(2, 6);
  const sid1 = await signupSignin(u1, 'ux3-pass-1');
  const sid2 = await signupSignin(u2, 'ux3-pass-2');
  step(2, `signed up ${u1}, ${u2}`);

  browser = await puppeteer.launch({ executablePath: '/snap/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [];
  const newPage = async (sid) => {
    const p = await browser.newPage();
    p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
    p.on('pageerror', e => errors.push(String(e)));
    await p.setCookie({ name: 'sessionID', value: sid, url: BASE + '/' });
    return p;
  };
  const visFn = `(id) => { const el = document.getElementById(id); return !!el && !el.classList.contains('hide') && getComputedStyle(el).display !== 'none'; }`;

  // (1) logged-in lobby hides [Вход]/[Регистрация]; [Играть]+[Пользователи] visible.
  const pA = await newPage(sid1);
  await pA.goto(BASE + '/index', { waitUntil: 'networkidle0' });
  await waitFor(() => pA.evaluate(`(${visFn})('authed')`), 'u1 lobby restore');
  const lobbyState = await pA.evaluate(`(() => ({
    login: (${visFn})('login-button'), reg: (${visFn})('register-button'),
    play: (${visFn})('play-button'), users: (${visFn})('users-button'),
  }))()`);
  check(!lobbyState.login && !lobbyState.reg && lobbyState.play && lobbyState.users,
    'logged-in lobby hides Вход/Регистрация, shows Играть+Пользователи', JSON.stringify(lobbyState));

  // (2) [Играть] immediately creates the game and auto-opens the link modal.
  await pA.click('#play-button');
  await pA.waitForFunction(() => location.pathname === '/game' && /[?&]matchId=/.test(location.search), { timeout: 15000 });
  const gameUrl = new URL(pA.url());
  const matchId = gameUrl.searchParams.get('matchId');
  await waitFor(() => pA.evaluate(() => {
    const m = document.getElementById('gameLinkModal');
    return m && getComputedStyle(m).display !== 'none';
  }), 'link modal auto-open (#link)');
  check(!!matchId, '[Играть] created /game?matchId and #link opened the link modal', matchId);
  await pA.click('#btn-game-link-close');

  // (3) /users directory: u2 present, elo 1500, games 0.
  await pA.goto(BASE + '/users', { waitUntil: 'networkidle0' });
  await waitFor(() => pA.evaluate((n) => !!document.querySelector(`tr[data-username="${n}"]`), u2), 'u2 row in /users');
  const rowTxt = await pA.evaluate((n) => document.querySelector(`tr[data-username="${n}"]`).innerText.replace(/\s+/g, ' '), u2);
  check(/1500/.test(rowTxt), '/users lists u2 with elo 1500', rowTxt);

  // (4) right-click -> invite menu -> «Рапид» -> success toast; record lands with method rapid.
  const rowH = await pA.$(`tr[data-username="${u2}"]`);
  await rowH.click({ button: 'right' });
  await waitFor(() => pA.evaluate(() => {
    const m = document.getElementById('user-context-menu');
    return m && !m.classList.contains('hide') && !!m.querySelector('.user-menu-method[data-method="rapid"]');
  }), 'context menu with rapid');
  await pA.click('#user-context-menu .user-menu-method[data-method="rapid"]');
  // The inviter is taken into the new invite-bound match (integration fix).
  await pA.waitForFunction(u => location.pathname === '/game' && location.search.includes('matchId=') && !location.search.includes(u), { timeout: 15000 }, matchId);
  const m2 = new URL(pA.url()).searchParams.get('matchId');
  const invites = JSON.parse(fs.readFileSync(path.join(dataDir, 'invites.json'), 'utf8'));
  const rec = invites.find(i => i.to === u2 && i.from === u1);
  check(rec && rec.method === 'rapid', 'invites.json record method=rapid', JSON.stringify(rec));

  // (5) u2 lobby shows the invite with «Рапид»; accept seats both.
  const pB = await newPage(sid2);
  await pB.goto(BASE + '/index', { waitUntil: 'networkidle0' });
  await waitFor(() => pB.evaluate((n) => {
    const rows = Array.from(document.querySelectorAll('.invite-row'));
    return rows.some(r => r.textContent.includes(n) && /Рапид/.test(r.textContent) && r.querySelector('.invite-accept'));
  }, u1), 'u2 sees rapid invite row');
  check(true, 'u2 lobby invite row with Russian «Рапид» + Принять');
  await (await pB.$('.invite-accept')).click();
  await pB.waitForFunction(() => location.pathname === '/game', { timeout: 15000 });
  await waitFor(() => pB.evaluate(() => document.getElementById('status').innerText === 'Playing as black'), 'u2 seated black');
  await waitFor(() => pA.evaluate(() => document.getElementById('status').innerText === 'Playing as white'), 'u1 status -> Playing as white after accept');
  check(true, 'accept from lobby seated u2 black (u1 white)');

  // (6) u2 resigns (zero-move resign still writes the games.csv row per T31
  // semantics - only opponent_disconnect is suppressed pre-start) -> stats.
  await pB.click('#btn-resign');
  await pB.click('#btn-resign-confirm');
  await sleep(2000);

  // (7) /users stats updated; public profile of u2 shows the game «Рапид» + Поражение.
  await pA.goto(BASE + '/users', { waitUntil: 'networkidle0' });
  await waitFor(() => pA.evaluate((n) => {
    const tr = document.querySelector(`tr[data-username="${n}"]`);
    return tr && /\b1\b/.test(tr.innerText.replace(/\s+/g, ' ')) && !/ 0$/.test(tr.innerText.trim());
  }, u2), 'u2 games=1 in stats');
  const statRow = await pA.evaluate((n) => document.querySelector(`tr[data-username="${n}"]`).innerText.replace(/\s+/g, ' '), u2);
  check(/1/.test(statRow), 'stats show u2 games=1 after resign', statRow);

  await pA.goto(BASE + `/user?name=${encodeURIComponent(u2)}`, { waitUntil: 'networkidle0' });
  const prof = await pA.evaluate(() => document.body.innerText);
  check(/Рапид/.test(prof) && /Поражение/.test(prof) && prof.includes(u1),
    'public profile u2: opponent, Поражение, «Рапид»', prof.slice(0, 200).replace(/\n/g, ' | '));

  // (8) no console/page errors on any page.
  check(errors.length === 0, 'no console/page errors', errors.slice(0, 3).join(' ;; '));

  console.log('UX3 RESULT: ' + (failed === 0 ? 'PASS' : 'FAIL (' + failed + ')'));
} catch (e) {
  failed++;
  console.log('UX3 FATAL: ' + e.message);
  console.log('UX3 RESULT: FAIL');
} finally {
  if (browser) await browser.close().catch(() => {});
  serverProc.kill('SIGTERM');
  process.exit(failed === 0 ? 0 : 1);
}
