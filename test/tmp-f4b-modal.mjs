// F4b (contract 38) login-modal verification at 320/390/1280.
// Flow: raw socket.io signup (e2e A1 pattern) -> guest page at each viewport ->
// click [Вход] -> metric asserts on the revealed modal (#form.auth-card) ->
// screenshot at 390 -> fill+submit login with the raw-socket user -> assert
// success state. Metrics -> checkpoints/design-38/metrics-f4b.json.
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const require = createRequire(import.meta.url);
const PUPPETEER_ROOT = '/root/.nvm/versions/node/v24.22.1/lib/node_modules';
const puppeteer = require(path.join(PUPPETEER_ROOT, 'puppeteer-core'));
const io = require('socket.io-client');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 34567); // pre-checked free via ss -ltn
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(ROOT, 'checkpoints', 'design-38');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const waitFor = (fn, what, timeoutMs = 20000) =>
  Promise.race([
    (async () => {
      const t0 = Date.now();
      for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting: ' + what);
        await sleep(50);
      }
    })(),
    sleep(timeoutMs).then(() => { throw new Error('timeout waiting: ' + what); })
  ]);

// ---------- server on an ephemeral port ----------
const DATA_DIR = fs.mkdtempSync('/tmp/f4b-modal-');
const serverLog = '/tmp/f4b-modal-server.log';
fs.writeFileSync(serverLog, '');
const serverProc = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], {
  env: { ...process.env, DEBUG: '1', PORT: String(PORT), DATA_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: ROOT,
});
serverProc.stdout.on('data', d => fs.appendFileSync(serverLog, d));
serverProc.stderr.on('data', d => fs.appendFileSync(serverLog, d));
await waitFor(() => fs.readFileSync(serverLog, 'utf8').includes('server started'),
  'server to start', 15000);
console.log('server started on', BASE);

let browser = null;
const out = { base: BASE, rows: [], metrics: {} };
const logRow = (test, status, detail) => {
  out.rows.push({ test, status, detail: String(detail).slice(0, 600) });
  console.log(`[${status}] ${test} :: ${String(detail).slice(0, 250)}`);
};

// In-page modal metrics. Assert targets (task):
//  - modal right edge <= innerWidth, left >= 0
//  - username input fully inside viewport
//  - field rows do not overlap (each next.top >= prev.bottom)
//  - submit button width == input width, height >= 44
//  - document.scrollWidth == innerWidth
const METRIC_FN = () => {
  const form = document.getElementById('form');
  const fb = form.getBoundingClientRect();
  const fieldRects = Array.from(document.querySelectorAll('#form .field')).map(el => {
    const b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height };
  });
  const overlaps = [];
  for (let i = 1; i < fieldRects.length; i++) {
    if (fieldRects[i].top < fieldRects[i - 1].bottom - 0.5)
      overlaps.push({ pair: i - 1 + '-' + i, nextTop: fieldRects[i].top, prevBottom: fieldRects[i - 1].bottom });
  }
  const ui = document.getElementById('username').getBoundingClientRect();
  const pw = document.getElementById('password').getBoundingClientRect();
  const sb = document.getElementById('submit-auth').getBoundingClientRect();
  const gaps = [];
  for (let i = 1; i < fieldRects.length; i++)
    gaps.push(fieldRects[i].top - fieldRects[i - 1].bottom);
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    form: { left: fb.left, right: fb.right, top: fb.top, bottom: fb.bottom, w: fb.width, h: fb.height },
    formFits: fb.right <= window.innerWidth + 0.5 && fb.left >= -0.5,
    formMaxHeight: fb.height <= window.innerHeight * 0.905,
    usernameInput: { left: ui.left, right: ui.right, top: ui.top, bottom: ui.bottom, w: ui.width },
    usernameInViewport: ui.left >= 0 && ui.right <= window.innerWidth,
    passwordInput: { left: pw.left, right: pw.right, top: pw.top, bottom: pw.bottom, w: pw.width },
    fieldRects, overlaps, gaps,
    rowsGapMin: Math.min(...gaps),
    submitBtn: { left: sb.left, right: sb.right, top: sb.top, bottom: sb.bottom, w: sb.width, h: sb.height },
    btnEqInput: Math.abs(sb.width - ui.width) < 0.5 && Math.abs(sb.left - ui.left) < 0.5,
    btnHeight: sb.height,
    formVisible: !form.classList.contains('hide'),
    formTitle: document.getElementById('form-title').textContent,
    autofill: {
      boxShadow: getComputedStyle(document.getElementById('username')).boxShadow,
      webkitTextFill: getComputedStyle(document.getElementById('username')).webkitTextFillColor,
    },
  };
};

try {
  // ---------- raw socket signup (A1 pattern) -> a user to log in with ----------
  browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
  });
  const r = io(BASE, { transports: ['websocket'] });
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('raw socket: no connect')), 10000);
    r.on('connect', () => { clearTimeout(to); res(null); });
    r.on('connect_error', e => { clearTimeout(to); rej(e); });
  });
  const uname = 'modal_f4b_' + Math.random().toString(36).slice(2, 8);
  const upass = 'modal-pass-1';
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('no session after signin')), 10000);
    r.on('signup', (valid) => {
      if (valid !== 1) { clearTimeout(to); return reject(new Error('signup invalid code ' + valid)); }
      r.emit('signin', { username: uname, password: upass });
    });
    r.on('signin', (valid, sid) => {
      if (valid && sid) { clearTimeout(to); resolve(sid); }
    });
    r.emit('signup', { username: uname, password: upass });
  });
  r.close();
  out.user = uname;
  console.log('signed up', uname);

  // ---------- metric pass at each viewport (GUEST state; login is done at 390) ----------
  for (const [w, h] of [[320, 568], [390, 844], [1280, 900]]) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE + '/index', { waitUntil: 'networkidle2' });
    // guest: form starts hidden; open it via the [Вход] button (real trigger)
    await page.click('#login-button');
    const m = await waitFor(async () => {
      const v = await page.evaluate(METRIC_FN);
      return v.formVisible && v.formTitle === 'Вход' ? v : null;
    }, `modal open at ${w}x${h}`, 10000);
    const ok = m.formFits && m.usernameInViewport
      && m.fieldRects.every(rc => rc.left >= 0 && rc.right <= m.innerWidth)
      && m.overlaps.length === 0
      && m.rowsGapMin >= 12
      && m.btnEqInput && m.btnHeight >= 44
      && m.scrollWidth === m.innerWidth
      && m.formMaxHeight;
    logRow(`F4b login modal @ ${w}x${h}: right edge ${m.form.right} <= innerWidth ${m.innerWidth}, left ${m.form.left} >= 0, username input inside (L ${m.usernameInput.left} R ${m.usernameInput.right}), rows no-overlap (gaps ${JSON.stringify(m.gaps)}), submit btn ${m.submitBtn.w}x${m.submitBtn.h} == input ${m.usernameInput.w}, scrollWidth ${m.scrollWidth} == innerWidth ${m.innerWidth}`,
      ok ? 'PASS' : 'FAIL',
      `form=${JSON.stringify(m.form)} fields=${JSON.stringify(m.fieldRects.map(f => [f.top, f.bottom]))} overlaps=${JSON.stringify(m.overlaps)} btn=${JSON.stringify(m.submitBtn)} btnEqInput=${m.btnEqInput} btnH=${m.btnHeight} autofillShadow=${m.autofill.boxShadow} err=${JSON.stringify(errs.slice(0, 3))}`);
    out.metrics[w + 'x' + h] = m;

    if (w === 390) {
      await page.screenshot({ path: path.join(SHOTS, 'login-modal-390.png') });
      // ---------- functional: fill + submit login with the raw-socket user ----------
      await page.type('#username', uname);
      await page.type('#password', upass);
      await page.click('#submit-auth');
      const s = await waitFor(async () => {
        const v = await page.evaluate(() => {
          const form = document.getElementById('form');
          const succ = document.getElementById('auth-success');
          const fail = document.getElementById('auth-fail');
          return {
            formHidden: form.classList.contains('hide'),
            formVisible2: form.classList.contains('show'),
            successShown: succ.classList.contains('show'),
            successText: succ.textContent,
            failShown: fail.classList.contains('show'),
            authedShown: document.getElementById('authed').classList.contains('show'),
            loginHidden: document.getElementById('login-button').classList.contains('hide'),
          };
        });
        return (v.successShown || v.failShown) ? v : null;
      }, `login outcome at ${w}x${h}`, 15000);
      const lok = s.successShown && !s.failShown && s.formHidden && !s.formVisible2
        && s.authedShown && s.loginHidden && s.successText.includes(uname);
      logRow(`F4b login submit @ ${w}x${h} (raw-socket user ${uname}): form closed, auth-success shows username, Кабинет state active, [Вход] hidden`,
        lok ? 'PASS' : 'FAIL', JSON.stringify(s));
      out.metrics.login390 = s;
    }
    await ctx.close();
  }
} catch (e) {
  logRow('F4b verification run', 'FAIL', (e && e.stack) || String(e));
} finally {
  try { if (browser) await browser.close(); } catch {}
  try { if (serverProc.exitCode === null) serverProc.kill('SIGTERM'); } catch {}
  fs.writeFileSync(path.join(SHOTS, 'metrics-f4b.json'), JSON.stringify(out, null, 2));
  console.log('metrics written to', path.join(SHOTS, 'metrics-f4b.json'));
  const passed = out.rows.filter(r => r.status === 'PASS').length;
  console.log(`SUMMARY: ${passed}/${out.rows.length} rows PASS`);
  process.exit(passed === out.rows.length ? 0 : 1);
}
