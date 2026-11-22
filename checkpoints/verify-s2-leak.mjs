/*
 * S2 verification: memory leak — completed matches removed from matches[]
 *
 * Direct-imports src/lib/matchmaking.js (the match store) and drives the same
 * primitives the server uses: findMatch (seats two players), removeMatch +
 * clearMatchTimers (called by endMatch for every game-end path).
 *
 * Criteria:
 *   1. 3 matches in pool -> complete 1 -> matches.length === 2
 *   2. After N completed games the pool is stable (no unbounded growth)
 *   3. findMatch never seats a player into a finished match (gameEnded guard)
 *   4. New match IDs are unique after splice (maxId+1, not matches.length)
 *   5. removeMatch by object reference is safe when the match is already gone
 *   6. clearMatchTimers cancels pending forfeit timers
 *   7. findPrivateMatch rejects finished private matches
 */
import { matches, findMatch, findPrivateMatch, initMatch, removeMatch, clearMatchTimers } from '../src/lib/matchmaking.js';
import assert from 'assert';

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}: ${e.message}`);
    fail++;
  }
}
const mkSock = (id) => ({ id, connected: true, emit: () => {} });
const nextId = () => matches.reduce((mx, m) => Math.max(mx, m.matchId), -1) + 1;

console.log('S2 — match pool leak verification (direct module import)');

// --- 1. create 3 matches, end 1, pool === 2 ---
matches.length = 0;
{
  findMatch(mkSock('a1'));   // match 0 (white seat, black waiting)
  findMatch(mkSock('a2'));   // seats into match 0
  matches.push(initMatch(nextId(), mkSock('a3'))); // 2nd live match
  matches.push(initMatch(nextId(), mkSock('a4'))); // 3rd live match
  check('3 matches in pool', () => assert.strictEqual(matches.length, 3));

  // "end" the 3rd match exactly as endMatch() does: gameEnded flag + clearMatchTimers + removeMatch
  const victim = matches[2];
  victim.gameEnded = true;
  clearMatchTimers(victim);
  removeMatch(victim);
  check('after ending 1 match: matches.length === 2', () => assert.strictEqual(matches.length, 2));
  check('removed match gone from pool', () => assert.ok(!matches.includes(victim)));
}

// --- 2. stability over N games ---
{
  matches.length = 0;
  const N = 50;
  for (let i = 0; i < N; i++) {
    findMatch(mkSock(`w${i}`));
    findMatch(mkSock(`b${i}`));   // seats into the same match
    const m = matches[matches.length - 1];
    assert.strictEqual(m.gameEnded, false, 'precondition: match alive before end');
    m.gameEnded = true;
    clearMatchTimers(m);
    removeMatch(m);               // what endMatch() does
  }
  check(`pool empty after ${N} completed games (stable, no growth)`, () => assert.strictEqual(matches.length, 0));
}

// --- 3. findMatch skips finished matches (defense in depth) ---
{
  matches.length = 0;
  findMatch(mkSock('x1'));        // match 0, black seat free
  matches[0].gameEnded = true;    // simulate a finished match (hypothetically left in pool)
  findMatch(mkSock('x2'));        // must NOT seat x2 into the finished match
  check('findMatch does not seat into a gameEnded match', () => {
    assert.strictEqual(matches.length, 2);
    assert.strictEqual(matches[0].player2Socket, null);
  });
}

// --- 4. unique IDs after splice (the S2 "match 1/match 2/match 3" scenario) ---
{
  matches.length = 0;
  findMatch(mkSock('y1'));        // id 0 (white)
  findMatch(mkSock('y2'));        // seats into id 0 (now full)
  findMatch(mkSock('y3'));        // id 1 (white)
  findMatch(mkSock('y4'));        // seats into id 1 (now full)
  removeMatch(matches[0]);        // splice id 0 out -> pool: [id 1 (full)], matches.length === 1
  findMatch(mkSock('y5'));        // no seat free -> new match; must get id 2 (OLD length-based id => 1 => collision!)
  check('new match id after splice is maxId+1 (unique, no collision with live match)', () => {
    const ids = matches.map(m => m.matchId).sort((a, b) => a - b);
    assert.deepStrictEqual(ids, [1, 2]);
  });
}

// --- 5. removeMatch idempotent ---
{
  matches.length = 0;
  const m = initMatch(0, mkSock('z1'));
  matches.push(m);
  removeMatch(m);
  removeMatch(m); // second call must be a no-op
  check('removeMatch twice: no crash, pool empty', () => assert.strictEqual(matches.length, 0));
}

// --- 6. clearMatchTimers cancels pending forfeit timers ---
let timerFired = false;
{
  matches.length = 0;
  const m = initMatch(0, mkSock('t1'));
  m.disconnectTimers = { [m.player1Socket.id]: setTimeout(() => { timerFired = true; }, 30) };
  clearMatchTimers(m);
  check('clearMatchTimers empties the map', () => assert.deepStrictEqual(m.disconnectTimers, {}));
  const m2 = initMatch(1, null);
  clearMatchTimers(m2);
  clearMatchTimers(null);
  check('clearMatchTimers safe on missing/null timers', () => assert.ok(true));
}
await new Promise(r => setTimeout(r, 80)); // wait past the 30ms timer — it must NOT fire
check('forfeit timer was actually cancelled (did not fire)', () => assert.strictEqual(timerFired, false));

// --- 7. findPrivateMatch skips finished private matches ---
{
  matches.length = 0;
  const p = initMatch(7, mkSock('p1'));
  p.private = true;
  matches.push(p);
  p.gameEnded = true;
  const r = findPrivateMatch(mkSock('p2'), 7);
  check('findPrivateMatch rejects finished private match (returns 0)', () => assert.strictEqual(r, 0));
}

matches.length = 0;
console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
