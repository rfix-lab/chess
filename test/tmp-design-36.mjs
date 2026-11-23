// D1 designer screenshots (contract 36c). One-off, untracked (like
// tmp-smoke-ux3.mjs): starts the server on E2E_PORT with a temp DATA_DIR,
// creates a few users + one private match via RAW sockets (same pattern as the
// e2e harness), then screenshots every page at 1280px and 390px into
// checkpoints/design-36/.
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const require = createRequire(import.meta.url);
const PUPPETEER_ROOT = process.env.E2E_PUPPETEER_ROOT || '/root/.nvm/versions/node/v24.22.1/lib/node_modules';
const puppeteer = require(path.join(PUPPETEER_ROOT, 'puppeteer-core'));
const io = require('socket.io-client');

const PORT = Number(process.env.E2E_PORT || 18940);
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_LOG = '/tmp/design-36-server.log';
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'checkpoints', 'design-36');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, what, to = 15000) => {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await fn(); } catch (e) {}
    if (v) return v;
    if (Date.now() - t0 > to) throw new Error('timeout waiting for ' + what);
    await sleep(150);
  };
};

const dataDir = fs.mkdtempSync('/tmp/design-36-data-');
fs.mkdirSync(OUT_DIR, { recursive: true });
const serverProc = spawn(process.execPath, ['src/index.js'], {
  env: { ...process.env, DEBUG: '1', PORT: String(PORT), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
});
fs.writeFileSync(SERVER_LOG, '');
serverProc.stdout.on('data', d => fs.appendFileSync(SERVER_LOG, d));
serverProc.stderr.on('data', d => fs.appendFileSync(SERVER_LOG, d));

let browser = null;
let raw = null;
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT_DIR, name), fullPage: true });
  console.log('shot: ' + name);
};
const signupSignin = (username, password) => new Promise((resolve, reject) => {
  const s = io(BASE, { transports: ['websocket'] });
  const to = setTimeout(() => reject(new Error('raw: no session for ' + username)), 15000);
  s.on('connect', () => s.emit('signup', { username, password }));
  s.on('signup', valid => { if (valid === 1) s.emit('signin', { username, password }); });
  s.on('signin', (valid, sid) => { if (valid && sid) { clearTimeout(to); s.close(); resolve(sid); } });
  s.on('connect_error', e => reject(e));
});

// The design target is the dark board-game theme, but the container's OS
// colour scheme is light. CDP media emulation is per-target, so every page
// gets its own session forcing prefers-color-scheme: dark (theme.js sets
// data-theme="dark" accordingly; the lobby has no toggle and follows the
// media query directly).
const forceDark = async (pg) => {
  await pg.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
};

try {
  await waitFor(() => fs.readFileSync(SERVER_LOG, 'utf8').includes('server started'), 'server start', 15000);
  console.log('server up on ' + PORT);

  browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
  });

  // Two registered users + one private match so /game and profiles have content.
  const u1 = 'alice_' + Math.random().toString(36).slice(2, 6);
  const u2 = 'bob_' + Math.random().toString(36).slice(2, 6);
  const u3 = 'carol_' + Math.random().toString(36).slice(2, 6);
  const sid1 = await signupSignin(u1, 'design-pass-1');
  await signupSignin(u2, 'design-pass-2');
  await signupSignin(u3, 'design-pass-3');
  console.log('signed up ' + u1 + ', ' + u2 + ', ' + u3);

  // Private match created by a raw socket (harness pattern), then the raw
  // socket is dropped so the first joiner (u1) seats WHITE.
  raw = io(BASE, { transports: ['websocket'] });
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('no connect')), 10000);
    raw.on('connect', () => { clearTimeout(to); res(null); });
    raw.on('connect_error', e => { clearTimeout(to); rej(e); });
  });
  const matchId = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('no private-match echo')), 10000);
    raw.once('private-match', id => { if (id) { clearTimeout(to); resolve(id); } });
    raw.emit('private-match', 1);
  });
  console.log('match created: ' + matchId);
  raw.close();
  await sleep(300);

  const page = await browser.newPage();
  await forceDark(page);
  page.on('pageerror', e => console.log('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|401/.test(m.text())) console.log('console: ' + m.text()); });

  // (1) lobby logged-out
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(BASE + '/index', { waitUntil: 'networkidle2' });
  await sleep(400);
  await shot(page, 'index-logged-out-1280.png');
  await page.setViewport({ width: 390, height: 844 });
  await sleep(300);
  await shot(page, 'index-logged-out-390.png');

  // (2) lobby logged-in (sessionID cookie from the raw signup+signin)
  await page.setViewport({ width: 1280, height: 900 });
  await page.setCookie({ name: 'sessionID', value: sid1, url: BASE + '/' });
  await page.goto(BASE + '/index', { waitUntil: 'networkidle2' });
  await waitFor(async () => {
    const el = await page.$('#authed');
    return el ? await el.evaluate(n => n.classList.contains('show')) : false;
  }, 'authed visible');
  await sleep(400);
  await shot(page, 'index-logged-in-1280.png');
  await page.setViewport({ width: 390, height: 844 });
  await sleep(300);
  await shot(page, 'index-logged-in-390.png');

  // (3) /users directory (logged in, so the own row is highlighted)
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(BASE + '/users', { waitUntil: 'networkidle2' });
  await waitFor(async () => (await page.$$('#users-body tr[data-username]')).length >= 3, 'directory rows');
  await sleep(400);
  await shot(page, 'users-1280.png');
  await page.setViewport({ width: 390, height: 844 });
  await sleep(300);
  await shot(page, 'users-390.png');

  // (4) public profile (guest view of u1 — the pre-start match means the
  // games table is still empty; the honest state for a fresh user).
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(BASE + '/user?name=' + encodeURIComponent(u1), { waitUntil: 'networkidle2' });
  await sleep(400);
  await shot(page, 'user-profile-1280.png');
  await page.setViewport({ width: 390, height: 844 });
  await sleep(300);
  await shot(page, 'user-profile-390.png');

  // (5) game page (u1 as host/white, board drawn, waiting for opponent)
  await page.setViewport({ width: 1280, height: 900 });
  await page.setCookie({ name: 'sessionID', value: sid1, url: BASE + '/' });
  await page.goto(BASE + '/game?matchId=' + encodeURIComponent(matchId), { waitUntil: 'networkidle2' });
  await sleep(1200);
  await shot(page, 'game-1280.png');
  await page.setViewport({ width: 390, height: 844 });
  await sleep(400);
  await shot(page, 'game-390.png');

  // (6) cabinet
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(BASE + '/account', { waitUntil: 'networkidle2' });
  await sleep(400);
  await shot(page, 'account-1280.png');
  await page.setViewport({ width: 390, height: 844 });
  await sleep(300);
  await shot(page, 'account-390.png');

  console.log('DONE');
} catch (e) {
  console.log('FATAL: ' + e.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  try { if (raw) raw.close(); } catch (e) {}
  serverProc.kill('SIGTERM');
}
