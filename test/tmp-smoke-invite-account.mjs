// One-off orchestrator smoke (contract 32): registered invite flow end-to-end
// in a real browser: signup x2 (raw), lobby restore, invite from game page,
// accept from lobby invites, resign, /account shows the game. Not part of gates.
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const require = createRequire(import.meta.url);
const PUPPETEER_ROOT = process.env.E2E_PUPPETEER_ROOT || '/root/.nvm/versions/node/v24.22.1/lib/node_modules';
const puppeteer = require(path.join(PUPPETEER_ROOT, 'puppeteer-core'));
const io = require('socket.io-client');

const PORT = Number(process.env.E2E_PORT || 6365);
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_LOG = '/tmp/smoke-invite-server.log';
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
const step = (n, s) => console.log(`SMOKE ${n}: ${s}`);

const dataDir = fs.mkdtempSync('/tmp/smoke-invite-data-');
const serverProc = spawn(process.execPath, ['src/index.js'], {
  env: { ...process.env, DEBUG: '1', PORT: String(PORT), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
});
fs.writeFileSync(SERVER_LOG, '');
serverProc.stdout.on('data', d => fs.appendFileSync(SERVER_LOG, d));
serverProc.stderr.on('data', d => fs.appendFileSync(SERVER_LOG, d));

let browser = null;
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
  const u1 = 'alpha_' + Math.random().toString(36).slice(2, 6);
  const u2 = 'bravo_' + Math.random().toString(36).slice(2, 6);
  const sid1 = await signupSignin(u1, 'smoke-pass-1');
  const sid2 = await signupSignin(u2, 'smoke-pass-2');
  step(2, `signed up ${u1}, ${u2}`);

  browser = await puppeteer.launch({ executablePath: '/snap/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const mk = async (sid, name) => {
    const ctx = await browser.createBrowserContext();
    await ctx.setCookie({ name: 'sessionID', value: sid, url: BASE });
    const page = await ctx.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR/i.test(m.text())) page.__errors.push(m.text()); });
    return page;
  };

  // 3. restore-on-load for u1 (fresh lobby page, cookie only)
  const pageA = await mk(sid1, 'A');
  await pageA.goto(BASE + '/index', { waitUntil: 'networkidle2' });
  await waitFor(() => pageA.evaluate((u) => {
    const form = document.getElementById('form');
    const ok = document.getElementById('auth-success');
    return form.classList.contains('hide') && ok.textContent.includes(u);
  }, u1), 'A logged-in lobby');
  step(3, 'lobby restore: A shows logged-in state with cookie only');

  // 4. A enters a game, invites u2 via the real button (prompt dialog)
  const m0 = await new Promise((resolve, reject) => {
    const r = io(BASE, { transports: ['websocket'] });
    r.on('connect', () => r.emit('private-match', 1));
    r.on('private-match', id => { r.close(); resolve(id); });
    setTimeout(() => reject(new Error('no m0')), 10000);
  });
  await pageA.goto(BASE + `/game?matchId=${m0}`, { waitUntil: 'networkidle2' });
  await sleep(800);
  pageA.on('dialog', d => d.accept(u2));
  // Actions panel is hidden until startGame; click the button programmatically.
  await waitFor(() => pageA.evaluate(() => { const b = document.getElementById('btn-invite'); if (!b) return false; b.click(); return true; }), 'invite button click');
  await waitFor(() => pageA.url().includes('matchId=') && !pageA.url().includes(m0), 'A navigated to invited match', 15000);
  const invUrl = pageA.url();
  step(4, 'invite created from game page, A at ' + invUrl);

  // 5. u2 lobby shows the invite (name + Elo + method), accept joins as black
  const pageB = await mk(sid2, 'B');
  await pageB.goto(BASE + '/index', { waitUntil: 'networkidle2' });
  await waitFor(() => pageB.evaluate((u) => {
    const sec = document.getElementById('invites');
    if (!sec.classList.contains('show')) return false;
    const label = document.querySelector('.invite-label');
    return !!label && label.textContent.includes(u) && /Elo \d+/.test(label.textContent) && label.textContent.includes('метод');
  }, u1), 'B sees invite row', 15000);
  const label = await pageB.evaluate(() => document.querySelector('.invite-label').textContent);
  await pageB.click('.invite-accept');
  await waitFor(() => pageB.evaluate(() => /black|Black/.test(document.getElementById('status').innerText)), 'B seated black in invited match', 20000);
  await waitFor(() => pageA.evaluate(() => /Playing as white/.test(document.getElementById('status').innerText)), 'A seated white in invited match', 20000);
  step(5, `invite accepted from lobby: "${label}" -> B playing black`);

  // 6. B resigns -> rated end, games.csv row
  await pageB.click('#btn-resign');
  await pageB.click('#btn-resign-confirm');
  await sleep(1500);
  const csv = fs.readFileSync(path.join(dataDir, 'games.csv'), 'utf8').trim().split('\n');
  const row = csv.find(l => l.includes(u1) && l.includes(u2));
  if (!row) throw new Error('no games.csv row: ' + JSON.stringify(csv));
  step(6, 'games.csv row: ' + row);

  // 7. /account for u1 shows the game and the counter
  await pageA.goto(BASE + '/account', { waitUntil: 'networkidle2' });
  const acc = await pageA.evaluate((opp) => {
    const rows = Array.from(document.querySelectorAll('#games-body tr')).map(tr => tr.textContent);
    const m = document.body.textContent.match(/Сыграно партий: (\d+)/);
    return { played: m && Number(m[1]) >= 1, opp: rows.some(r => r.includes(opp)), rows };
  }, u2);
  if (!acc.played || !acc.opp) throw new Error('account mismatch: ' + JSON.stringify(acc));
  step(7, `account shows ${acc.rows.length} row(s), vs ${u2}: ` + acc.rows.find(r => r.includes(u2)).replace(/\s+/g, ' ').trim());

  const errs = [...pageA.__errors, ...pageB.__errors];
  if (errs.length) throw new Error('console errors: ' + errs.join(' | '));
  step(8, 'no console/page errors');
  console.log('SMOKE RESULT: PASS');
} catch (e) {
  console.error('SMOKE RESULT: FAIL — ' + e.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  serverProc.kill('SIGTERM');
  await sleep(500);
  if (!serverProc.killed) serverProc.kill('SIGKILL');
}
