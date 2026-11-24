// One-off review-fix screenshots (390px): /users hint + /account empty state.
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
const puppeteer = require('/root/.nvm/versions/node/v24.22.1/lib/node_modules/puppeteer-core');
const io = require('socket.io-client');
const PORT = 18980, BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dataDir = fs.mkdtempSync('/tmp/review36-data-');
const srv = spawn(process.execPath, ['src/index.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), stdio: 'ignore' });
const out = '/root/.openclaw/workspace/polkan/design-36';
const browser = await puppeteer.launch({ executablePath: '/snap/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
for await (const _ of [1]) {
  await sleep(2000);
  const sid = await new Promise((res, rej) => {
    const s = io(BASE, { transports: ['websocket'] });
    s.on('connect', () => s.emit('signup', { username: 'review36', password: 'p' }));
    s.on('signup', v => { if (v === 1) s.emit('signin', { username: 'review36', password: 'p' }); });
    s.on('signin', (v, id) => { if (v && id) { s.close(); res(id); } });
    setTimeout(() => rej(new Error('no sid')), 15000);
  });
  const p = await browser.newPage();
  await p.setViewport({ width: 390, height: 844 });
  const cdp = await p.createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await p.setCookie({ name: 'sessionID', value: sid, url: BASE });
  await p.goto(BASE + '/users', { waitUntil: 'networkidle0' });
  await p.screenshot({ path: out + '/users-390-fixed.png' });
  await p.goto(BASE + '/account', { waitUntil: 'networkidle0' });
  await p.screenshot({ path: out + '/account-390-fixed.png' });
  console.log('shots done');
}
await browser.close(); srv.kill('SIGTERM'); process.exit(0);
