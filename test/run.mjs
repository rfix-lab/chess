// Autonomous test runner: boots the server IN-PROCESS on an EPHEMERAL port
// (listen(0) — never 5500, which may be taken by a real server), runs the
// evergreen + chess integration suites as child processes with TEST_URL
// pointing at the live server, then tears everything down and exits with
// the combined status.
//
// IMPORTANT: child processes are spawned ASYNC (not spawnSync) — the server
// lives in this same process, and a synchronous spawn would block the event
// loop, so the child could never complete a websocket handshake (root cause
// of the old 3/8: server frozen while test-chess ran).
import { spawn } from 'child_process';
import fs from 'fs';
import { POSITIONS, FAST_SUBSET, runPerft } from './perft.mjs';

// F1: point the server's user-persistence dir at a throwaway tmp dir so the
// suites never touch a real /app/data or repo-local users.csv.
const DATA_DIR = fs.mkdtempSync(new URL('..', import.meta.url).pathname + 'test-data-');
process.env.DATA_DIR = DATA_DIR;
console.log(`[runner] DATA_DIR=${DATA_DIR}`);


function runSuite(file, env, cwd) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [file], { stdio: 'inherit', env, cwd });
    child.on('close', (status, signal) => resolve({ file, status, signal }));
  });
}

const { app, server, io } = await import('../src/index.js');

// Ephemeral port: no fixed port, no collisions with a running dev server.
const port = await new Promise((resolve, reject) => {
  server.once('listening', () => resolve(server.address().port));
  server.once('error', reject);
  server.listen(0);
});
const BASE = `http://localhost:${port}`;
console.log(`[runner] in-process test server up at ${BASE} (ephemeral)`);

const results = [];

// Perft engine check (pure CPU, runs in-process before the socket suites):
// d1-d2 for all six canonical positions + startpos d3 (npm-test budget).
{
  console.log('\n[runner] perft (engine move generator vs canonical counts)');
  const depthMap = {};
  for (const name of Object.keys(POSITIONS)) depthMap[name] = FAST_SUBSET[name] || [];
  const perftResults = runPerft(Object.keys(POSITIONS), depthMap, { quiet: true, budgetMs: 60000 });
  const perftFailed = perftResults.filter(r => !r.ok);
  for (const r of perftResults) {
    console.log(`  ${r.name} d${r.d}: ${r.actual} (expected ${r.expected}) ${r.ok ? 'OK' : 'MISMATCH'}  ${r.ms}ms`);
  }
  if (perftFailed.length) {
    console.error(`[runner] perft: ${perftFailed.length} MISMATCH(es)`);
    results.push({ file: 'perft', status: 1, signal: null });
  } else {
    console.log(`[runner] perft: all ${perftResults.length} checks EXACT`);
  }
}

for (const file of ['test-evergreen.mjs', 'test-chess.mjs']) {
  const r = await runSuite(file, { ...process.env, TEST_URL: BASE }, new URL('..', import.meta.url).pathname);
  results.push(r);
  console.log(`[runner] ${file}: ${(r.status === 0 && !r.signal) ? 'PASS' : `FAIL (status ${r.status}, signal ${r.signal})`}`);
}

// Full teardown: close socket.io (drains websockets) then the http server,
// so the runner process exits by itself without hanging.
io.close();
server.close();

const failed = results.filter(x => x.status !== 0 || x.signal);
if (failed.length) {
  console.error(`[runner] ${failed.length} suite(s) FAILED: ${failed.map(x => x.file).join(', ')}`);
  process.exit(1);
}
console.log('[runner] ALL TESTS PASSED');
process.exit(0);
