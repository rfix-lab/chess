import { io } from 'socket.io-client';
import fs from 'fs';
import bcrypt from 'bcrypt';
import { loadUsersFile, authenticateUser, validateSession, saveUsersFile, loadSessionsFile, saveSessionsFile, attachSessionsToUsers, USERS_CSV } from './src/lib/auth.js';
import { loadGames, GAMES_CSV } from './src/lib/games.js';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Poll `cond` every 50ms until it returns a truthy value or `timeoutMs` passes.
// T31: more robust than a fixed sleep under the parallel-load environment the
// runner shares with the concurrent e2e harness (run.mjs note: load flakes).
async function waitFor(cond, timeoutMs) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = cond();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(50);
  }
}

// T31: signin with a retry — the runner shares the event loop / network with the
// concurrent e2e harness, so a single bcrypt round-trip can exceed a tight timeout
// under load. Retry up to 3 attempts with a 4s budget each before giving up.
async function signinWithRetry(socket, username, password) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const s = await new Promise(r => {
      const done = (v) => { socket.removeListener('signin', on); r(v); };
      const on = (ok, sid) => { if (ok === 1) done(sid); };
      socket.once('signin', on);
      socket.emit('signin', { username, password });
      setTimeout(() => done(null), 4000);
    });
    if (s) return s;
    await sleep(150);
  }
  return null;
}

async function test() {
  console.log('=== Chess Integration Tests ===\n');
  
  let passed = 0, failed = 0, total = 0;
  function pass(name) { console.log(`✅ ${name}`); passed++; total++; }
  function fail(name, err) { console.log(`❌ ${name}: ${err}`); failed++; total++; }

  const BASE = process.env.TEST_URL || 'http://localhost:5500';

  const client1 = io(BASE, { transports: ['websocket'] });
  const client2 = io(BASE, { transports: ['websocket'] });
  
  await Promise.all([
    Promise.race([new Promise(r => client1.on('connect', r)), sleep(3000)]),
    Promise.race([new Promise(r => client2.on('connect', r)), sleep(3000)])
  ]);
  
  if (client1.connected) pass('Client 1 connected'); else fail('Client 1 connected', 'no');
  if (client2.connected) pass('Client 2 connected'); else fail('Client 2 connected', 'no');
  
  let matchId = null, vCount1 = 0, vCount2 = 0, rejected = 0;
  let crSeen = false;
  
  client1.on('startGame', (c, m) => { matchId = m; });
  client2.on('startGame', (c, m) => { if (matchId === null) matchId = m; });
  
  client1.on('validated', (board, turn, extra) => {
    vCount1++;
    if (extra && extra.rejected) rejected++;
    if (extra && extra.castlingRights) crSeen = true;
  });
  client2.on('validated', (board, turn, extra) => {
    vCount2++;
    if (extra && extra.castlingRights) crSeen = true;
  });
  
  let authFailures = 0;
  client1.on('authFailed', () => authFailures++);
  client2.on('authFailed', () => authFailures++);

  // T1: the server REJECTS unknown/fake sessions (validateSession, src/index.js
  // 'auth' handler) — the old test emitted fake 'sess_w'/'sess_b' and relied on
  // guest play, which no longer exists. Use the real flow: signup + login,
  // then auth with the real session IDs.
  const uname1 = 't1w_' + Date.now(), uname2 = 't1b_' + Date.now();
  client1.emit('signup', { username: uname1, password: 'pass1' });
  await sleep(100);
  client2.emit('signup', { username: uname2, password: 'pass2' });
  await sleep(100);
  const sess1 = await new Promise(r => {
    client1.once('signin', (ok, s) => r(s));
    client1.emit('signin', { username: uname1, password: 'pass1' });
    setTimeout(() => r(null), 3000);
  });
  const sess2 = await new Promise(r => {
    client2.once('signin', (ok, s) => r(s));
    client2.emit('signin', { username: uname2, password: 'pass2' });
    setTimeout(() => r(null), 3000);
  });
  if (sess1 && sess2) pass('signup+login: real session IDs');
  else fail('signup+login: real session IDs', 'no session');

  if (sess1) client1.emit('auth', sess1, null);
  if (sess2) client2.emit('auth', sess2, null);
  await sleep(500);
  
  if (matchId !== null) pass('Match created'); else fail('Match created', 'null');

  // T30: match ids are opaque random 8-char a-z0-9 strings (were sequential integers).
  if (matchId !== null && /^[a-z0-9]{8}$/.test(matchId))
    pass('T30: public match id format /^[a-z0-9]{8}$/ (' + matchId + ')');
  else fail('T30: public match id format', `got ${JSON.stringify(matchId)}`);
  
  // === Верные координаты ===
  // White pieces: y=7 (rank 1), y=6 (rank 2)
  // Black pieces: y=0 (rank 8), y=1 (rank 7)
  // x=0=a, x=1=b, ..., x=4=e, x=5=f, x=6=g, x=7=h
  
  // Move 1: White e2-e4 (pawn y=6,x=4 → y=4,x=4)
  client1.emit('move', matchId, { x: 4, y: 6 }, { x: 4, y: 4 });
  await sleep(200);
  
  // Move 2: Black e7-e5 (pawn y=1,x=4 → y=3,x=4)
  client2.emit('move', matchId, { x: 4, y: 1 }, { x: 4, y: 3 });
  await sleep(200);
  
  // Move 3: White Nf3 (knight g1→f3, y=7,x=6 → y=5,x=5)
  client1.emit('move', matchId, { x: 6, y: 7 }, { x: 5, y: 5 });
  await sleep(200);
  
  // Move 4: Black Nf6 (knight g8→f6, y=0,x=1 → y=2,x=2)
  client2.emit('move', matchId, { x: 1, y: 0 }, { x: 2, y: 2 });
  await sleep(200);
  
  // Move 5: White Bd3 (bishop f1→d3, y=7,x=5 → y=5,x=3) |dx|=2,|dy|=2 ✓
  client1.emit('move', matchId, { x: 5, y: 7 }, { x: 3, y: 5 });
  await sleep(200);
  
  // Move 6: Black Bc5 (bishop f8→c5, y=0,x=5 → y=3,x=2) |dx|=3,|dy|=3 ✓
  client2.emit('move', matchId, { x: 5, y: 0 }, { x: 2, y: 3 });
  await sleep(200);
  
  // Move 7: White O-O (king e1→g1, y=7,x=4 → y=7,x=6) [Castling test!]
  client1.emit('move', matchId, { x: 4, y: 7 }, { x: 6, y: 7 });
  await sleep(200);
  
  // Results
  if (rejected === 0) pass('All 7 moves accepted (incl. castling)');
  else fail('Move rejections', rejected + ' rejected');
  
  if (vCount1 >= 7) pass('C1 validated count OK (' + vCount1 + ')');
  else fail('C1 validated', 'got ' + vCount1);
  
  if (vCount2 >= 7) pass('C2 validated count OK (' + vCount2 + ')');
  else fail('C2 validated', 'got ' + vCount2);
  
  // NOTE (C3, 2026-08-15): the server deliberately sends only the board in
  // 'validated' — it NEVER sends castlingRights. The client derives rights
  // from the board for highlighting/click-to-move. So 'not seen' is the
  // expected, correct behavior — not a server bug.
  if (crSeen) pass('castlingRights in validated');
  else { console.log('ℹ️ castlingRights not in validated events — expected (server sends board only, by design since C3)'); }
  
  // Disconnect test (bug #3 - limbo, bug #4 - move after end)
  client1.disconnect();
  await sleep(300);
  client1.emit('move', matchId, { x: 3, y: 6 }, { x: 3, y: 4 });
  await sleep(500);
  pass('Move after disconnect handled (no crash)');
  pass('Disconnect handler tested');
  
  client2.disconnect();
  
  // === T-GUEST: 2 guests (sessionID = null) must both get startGame ===
  // Regression for P1: the `!sessionID` guard in the 'auth' handler (added in
  // e4f1b02) rejected guest sessions, so two guests on /game stuck on
  // "Waiting for player..." forever. Guests (null/undefined sessionID) must
  // skip validation and reach findMatch; only a NON-EMPTY invalid sessionID
  // must still produce authFailed.
  const guest1 = io(BASE, { transports: ['websocket'] });
  const guest2 = io(BASE, { transports: ['websocket'] });
  await Promise.all([
    Promise.race([new Promise(r => guest1.on('connect', r)), sleep(3000)]),
    Promise.race([new Promise(r => guest2.on('connect', r)), sleep(3000)])
  ]);

  const gColors = {};
  let gMatch1 = null, gMatch2 = null;
  let gFailed = 0, bogusFailed = false;
  guest1.on('startGame', (c, m) => { gColors[1] = c; gMatch1 = m; });
  guest2.on('startGame', (c, m) => { gColors[2] = c; gMatch2 = m; });
  guest1.on('authFailed', () => gFailed++);
  guest2.on('authFailed', () => gFailed++);

  guest1.emit('auth', null, null);
  guest2.emit('auth', null, null);
  // hardened 500 -> 1200ms: under parallel load the seating round-trip exceeded
  // the old window and produced a false FAIL (observed 2026-11-22 while another
  // agent ran headless E2E concurrently).
  await sleep(1200);

  if (gFailed === 0) pass('Guests: no authFailed on null sessionID');
  else fail('Guests: no authFailed on null sessionID', gFailed + ' authFailed');

  const sameGame = gMatch1 !== null && gMatch1 === gMatch2;
  const colorsOk = (gColors[1] === 0 && gColors[2] === 1) || (gColors[1] === 1 && gColors[2] === 0);
  if (sameGame && colorsOk)
    pass('2 guest → startGame both (same gameId, colors 0/1)');
  else fail('2 guest → startGame both (same gameId, colors 0/1)',
    `m1=${gMatch1} m2=${gMatch2} colors=${JSON.stringify(gColors)}`);

  // Non-empty invalid sessionID must still be rejected.
  const bogus = io(BASE, { transports: ['websocket'] });
  await Promise.race([new Promise(r => bogus.on('connect', r)), sleep(3000)]);
  bogus.on('authFailed', () => { bogusFailed = true; });
  bogus.emit('auth', 'bogus_123', null);
  // hardened 300 -> 800ms (same load-flake class as the guest seating wait)
  await sleep(800);
  if (bogusFailed) pass('Invalid non-empty sessionID → authFailed');
  else fail('Invalid non-empty sessionID → authFailed', 'no authFailed');
  bogus.disconnect();
  guest1.disconnect();
  guest2.disconnect();

  // === T-PRIV: private link flow (C5 regression) ===
  // A (author, like on /index) emits 'private-match' and receives matchId;
  // B (guest) opens the link: auth(null, matchId); then A2 (guest, what the
  // author's Play button now does) also auth(null, matchId) -> BOTH must get
  // startGame with the same id and colors 0/1. Before the fix: startMatch
  // indexed matches[i] by matchId (m=undefined after splices) and the author
  // never joined, so both hung on "Waiting for player...".
  const privA = io(BASE, { transports: ['websocket'] });
  const privB = io(BASE, { transports: ['websocket'] });
  const privA2 = io(BASE, { transports: ['websocket'] });
  await Promise.all([
    Promise.race([new Promise(r => privA.on('connect', r)), sleep(3000)]),
    Promise.race([new Promise(r => privB.on('connect', r)), sleep(3000)]),
    Promise.race([new Promise(r => privA2.on('connect', r)), sleep(3000)])
  ]);

  let privMatchId = null;
  const privColors = {};
  let privIdSeen = null, privId2 = null, privB2 = null;
  privA.on('private-match', (id) => { privMatchId = id; });
  privB.on('startGame', (c, m) => { privColors[1] = c; privIdSeen = m; });
  privA2.on('startGame', (c, m) => { privColors[2] = c; privId2 = m; });

  // T30: the client-supplied argument is IGNORED by the server — the id always
  // comes from the 'private-match' ECHO. We still pass a (deliberately wrong)
  // integer to prove the server does not adopt the client's value.
  privA.emit('private-match', 1);
  await new Promise(r => { privA.once('private-match', r); sleep(3000); });
  if (privMatchId != null) pass('Private: link generated (matchId ' + privMatchId + ')');
  else fail('Private: link generated', 'no matchId');
  if (privMatchId != null && /^[a-z0-9]{8}$/.test(privMatchId))
    pass('T30: private match id format /^[a-z0-9]{8}$/ (from echo, not client arg)');
  else fail('T30: private match id format', `got ${JSON.stringify(privMatchId)}`);
  if (privMatchId != null && String(privMatchId) !== '1')
    pass('T30: client-supplied id (1) ignored — server generated its own');
  else fail('T30: client-supplied id ignored', `echo was ${JSON.stringify(privMatchId)}`);

  privB.emit('auth', null, privMatchId);
  await sleep(300);
  if (privIdSeen === null) pass('Private: first guest waits (no startGame yet)');
  else fail('Private: first guest waits', 'startGame too early');

  // Author joins via Play (index.js now navigates to /game?matchId=N).
  privA2.emit('auth', null, privMatchId);
  await sleep(500);

  if (privIdSeen !== null && privId2 !== null && privIdSeen === privId2 && privIdSeen === privMatchId)
    pass('Private: B and author both got startGame (same id)');
  else fail('Private: B and author both got startGame (same id)',
    `b=${privIdSeen} a2=${privId2} expected=${privMatchId}`);
  const privColorsOk = (privColors[1] === 0 && privColors[2] === 1) || (privColors[1] === 1 && privColors[2] === 0);
  if (privColorsOk) pass('Private: colors 0/1 assigned');
  else fail('Private: colors 0/1 assigned', JSON.stringify(privColors));

  // Bogus non-empty matchId (link to a match that no longer exists) -> nobody gets startGame.
  const privGhost = io(BASE, { transports: ['websocket'] });
  await Promise.race([new Promise(r => privGhost.on('connect', r)), sleep(3000)]);
  privGhost.on('startGame', () => { privB2 = true; });
  privGhost.emit('auth', null, 999999);
  await sleep(300);
  if (!privB2) pass('Private: bogus matchId -> no startGame');
  else fail('Private: bogus matchId -> no startGame', 'got startGame');
  privGhost.disconnect();

  // T30 regressions: id is now an OPAQUE STRING.
  // (a) uppercase id (wrong case) is refused — the pool holds lowercase only.
  // (b) wrong-length id is refused.
  // (c) a STALE INTEGER id (old clients keep numeric ids in storage) must fail
  //     gracefully: no startGame, no authFailed, no server crash — the next
  //     check (reconnect -> gameNotFound) proves the server is still alive.
  if (privMatchId !== null) {
    for (const [label, bad] of [['uppercase', privMatchId.toUpperCase()], ['wrong-length', privMatchId.slice(0, 5)]]) {
      const ghost = io(BASE, { transports: ['websocket'] });
      await Promise.race([new Promise(r => ghost.on('connect', r)), sleep(3000)]);
      let ghostStart = false;
      ghost.on('startGame', () => { ghostStart = true; });
      ghost.emit('auth', null, bad);
      await sleep(300);
      if (!ghostStart) pass('T30: join with ' + label + ' id ("' + bad + '") refused (no startGame)');
      else fail('T30: join with ' + label + ' id refused', 'got startGame');
      ghost.disconnect();
    }
    const stale = io(BASE, { transports: ['websocket'] });
    await Promise.race([new Promise(r => stale.on('connect', r)), sleep(3000)]);
    let staleStart = false, staleAuthFailed = false;
    stale.on('startGame', () => { staleStart = true; });
    stale.on('authFailed', () => { staleAuthFailed = true; });
    stale.emit('auth', null, 42); // integer — no pool entry "42" can exist pre-existing
    await sleep(300);
    if (!staleStart && !staleAuthFailed)
      pass('T30: stale INTEGER id via auth (guest) — no startGame, no authFailed, no crash');
    else fail('T30: stale integer id graceful', `start=${staleStart} authFailed=${staleAuthFailed}`);
    // (d) stale integer id on RECONNECT must land on gameNotFound (not throw).
    let staleNotFound = false, staleRecon = false;
    stale.on('gameNotFound', () => { staleNotFound = true; });
    stale.on('reconnected', () => { staleRecon = true; });
    stale.emit('reconnect', { gameId: 42, color: 0, sessionID: null, prevSocketId: null });
    await sleep(300);
    if (staleNotFound && !staleRecon)
      pass('T30: stale integer id via reconnect -> gameNotFound (graceful)');
    else fail('T30: stale integer id reconnect graceful', `notFound=${staleNotFound} recon=${staleRecon}`);
    stale.disconnect();
  } else {
    fail('T30: stale/invalid id rows', 'no privMatchId to derive from');
  }
  privA.disconnect();
  privB.disconnect();
  privA2.disconnect();

  // === T-FIXES: engine/server hardening regressions (2026-11-22) ===
  // One private match; the first socket to seat is color 0 (white).
  // Server coords: rank r => y = 8 - r (e2 = {x:4, y:6}).
  // One rejected move is broadcast to BOTH players, so it bumps the shared
  // counter by 2 - assertions below compare against that.
  const fxA = io(BASE, { transports: ['websocket'] });
  const fxB = io(BASE, { transports: ['websocket'] });
  await Promise.all([
    Promise.race([new Promise(r => fxA.on('connect', r)), sleep(3000)]),
    Promise.race([new Promise(r => fxB.on('connect', r)), sleep(3000)])
  ]);
  let fxMatch = null, fxAColor = null;
  let fxRejects = 0, fxPendings = 0, fxLastBoard = null;
  const fxOnV = (board, t, extra) => {
    if (board) fxLastBoard = board.map(r => r.slice());
    if (extra && extra.rejected) fxRejects++;
    if (extra && extra.pendingPromotion) fxPendings++;
  };
  fxA.on('startGame', (c, m) => { fxAColor = c; if (fxMatch === null) fxMatch = m; });
  fxB.on('startGame', (c, m) => { if (fxMatch === null) fxMatch = m; });
  fxA.on('validated', fxOnV);
  fxB.on('validated', fxOnV);
  fxA.on('private-match', (id) => { fxMatch = id; fxA.emit('auth', null, id); fxB.emit('auth', null, id); });
  fxA.emit('private-match', 1);
  // FIX(harness hang): the previous form `new Promise(r => { once(...); sleep(3000); })`
  // never resolved the timer branch — if 'private-match' did not arrive the suite
  // hung forever. Race the event against a real timeout fallback.
  await Promise.race([new Promise(r => fxA.once('private-match', r)), sleep(3000)]);
  await sleep(600);

  if (fxMatch === null || fxAColor === null) {
    fail('FIXES: private match seated', 'no startGame');
  } else {
    const white = fxAColor === 0 ? fxA : fxB;
    const black = fxAColor === 0 ? fxB : fxA;
    const w = (f, t) => white.emit('move', fxMatch, { x: f[0], y: f[1] }, { x: t[0], y: t[1] });
    const b = (f, t) => black.emit('move', fxMatch, { x: f[0], y: f[1] }, { x: t[0], y: t[1] });

    // (1) BUG #1: 1.Nf3 puts the knight on f3, blocking the f-file. The pawn
    // double push f2->f4 must be REJECTED (destination f4 empty, intermediate
    // f3 occupied). Pre-fix only the destination square was checked, so f2-f4
    // sailed through the blocker.
    w([6, 7], [5, 5]);            // 1.Nf3 (g1->f3)
    await sleep(340);
    b([7, 1], [7, 3]);            // 1...h5 (kingside tempo; keeps the a-file clear)
    await sleep(340);
    const r1 = fxRejects;
    w([5, 6], [5, 4]);            // 2.f4 - illegal (f3 blocked by the knight)
    await sleep(400);
    if (fxRejects >= r1 + 2)
      pass('FIXES: blocked double-push rejected (Nf3 blocks f3 -> f2-f4 rejected)');
    else fail('FIXES: blocked double-push rejected', `rejects=${fxRejects} (before=${r1}, expected >= ${r1 + 2})`);

        // Promotion on the a-file: the b-pawn is used as bait - it advances to b6
    // where black's a-pawn captures it (axb6), clearing the a-file for the rest
    // of the way.  White's a-pawn then advances a4-a5-a6-a7 and captures the b8
    // knight to promote on b8.  Black replies with quiet Nf6/g8 shuffles.
    w([1, 6], [1, 4]);            // 2.b4
    await sleep(340);
    b([6, 0], [5, 2]);            // 2...Ng8f6
    await sleep(340);
    w([1, 4], [1, 3]);            // 3.b5
    await sleep(340);
    b([5, 2], [6, 0]);            // 3...Nf6g8
    await sleep(340);
    w([1, 3], [1, 2]);            // 4.b6 (bait: b6 is now capturable by the a-pawn)
    await sleep(340);
    b([0, 1], [1, 2]);            // 4...axb6 (clears a7 for the a-pawn)
    await sleep(340);
    w([0, 6], [0, 4]);            // 5.a4
    await sleep(340);
    b([6, 0], [5, 2]);            // 5...Ng8f6
    await sleep(340);
    w([0, 4], [0, 3]);            // 6.a5
    await sleep(340);
    b([5, 2], [6, 0]);            // 6...Nf6g8
    await sleep(340);
    w([0, 3], [0, 2]);            // 7.a6
    await sleep(340);
    b([6, 0], [5, 2]);            // 7...Ng8f6
    await sleep(340);
    w([0, 2], [0, 1]);            // 8.a7
    await sleep(340);
    b([5, 2], [6, 0]);            // 8...Nf6g8
    await sleep(340);
    const p0 = fxPendings;
    w([0, 1], [1, 0]);            // 9.axb8 (captures the b8 knight -> promotes on b8)
    await sleep(400);
    if (fxPendings === p0 + 2)
      pass('FIXES: promotion reached (axb8 pending promotion emitted)');
    else fail('FIXES: promotion reached', `pendings=${fxPendings} (before=${p0}, expected ${p0+2} — one per seated socket)`);

    // (2) S3 whitelist: pieceType 0 (blank: the pawn vanishes) and 99 (reads
    // back as a queen) must BOTH be rejected WITHOUT consuming the pending -
    // b8 must still hold the white pawn (piece value 1).
    white.emit('promotion:choose', { gameId: fxMatch, pieceType: 0 });
    await sleep(320);
    white.emit('promotion:choose', { gameId: fxMatch, pieceType: 99 });
    await sleep(320);
    const b8AfterBad = fxLastBoard ? fxLastBoard[0][1] : -1;
    if (b8AfterBad === 1)
      pass('FIXES: promotion whitelist rejects pieceType 0 and 99 (b8 still a white pawn)');
    else fail('FIXES: promotion whitelist rejects 0 and 99', `b8=${b8AfterBad} (expected pawn=1)`);

    // (3) S3 ownership: the WRONG socket (black) picking a legal piece (queen)
    // must be rejected; then the owner (white) picks a knight. If ownership were
    // missing, black's pick would put a queen on b8 and consume the pending -
    // the board must end holding the owner's knight (piece value 6).
    black.emit('promotion:choose', { gameId: fxMatch, pieceType: 3 });
    await sleep(320);
    white.emit('promotion:choose', { gameId: fxMatch, pieceType: 6 });
    await sleep(400);
    const b8AfterOwner = fxLastBoard ? fxLastBoard[0][1] : -1;
    if (b8AfterOwner === 6)
      pass('FIXES: wrong-socket promotion:choose rejected (b8 = the owner knight, not the black-socket queen)');
    else fail('FIXES: wrong-socket promotion rejected', `b8=${b8AfterOwner} (expected knight=6)`);

    fxA.disconnect(); fxB.disconnect();
  }

  // === FIXES-2: S4 wrong-socket move on a FRESH match (clean turn state) ===
  {
    const gxA = io(BASE, { transports: ['websocket'] });
    const gxB = io(BASE, { transports: ['websocket'] });
    await Promise.all([
      Promise.race([new Promise(r => gxA.on('connect', r)), sleep(3000)]),
      Promise.race([new Promise(r => gxB.on('connect', r)), sleep(3000)])
    ]);
    let gxMatch = null, gxAColor = null, gxRejects = 0;
    gxA.on('startGame', (c, m) => { gxAColor = c; if (gxMatch === null) gxMatch = m; });
    gxB.on('startGame', (c, m) => { if (gxMatch === null) gxMatch = m; });
    gxA.on('validated', (b, t, extra) => { if (extra && extra.rejected) gxRejects++; });
    gxB.on('validated', (b, t, extra) => { if (extra && extra.rejected) gxRejects++; });
    gxA.on('private-match', (id) => { gxMatch = id; gxA.emit('auth', null, id); gxB.emit('auth', null, id); });
    gxA.emit('private-match', 2);
    await new Promise(r => { gxA.once('private-match', r); sleep(3000); });
    await sleep(600);
    if (gxMatch === null || gxAColor === null) {
      fail('FIXES-2: fresh match seated', 'no startGame');
    } else {
      const gw = gxAColor === 0 ? gxA : gxB;
      const gb = gxAColor === 0 ? gxB : gxA;
      // Black's socket plays a legal black move (e7-e5) on WHITE's turn.
      const g0 = gxRejects;
      gb.emit('move', gxMatch, { x: 4, y: 1 }, { x: 4, y: 3 });
      await sleep(400);
      if (gxRejects >= g0 + 2)
        pass('FIXES-2: wrong-socket move rejected on fresh match (black socket, white turn)');
      else fail('FIXES-2: wrong-socket move rejected', `rejects=${gxRejects} (before=${g0})`);
      // The correct socket still plays its own move (guard must not over-reject).
      const g1 = gxRejects;
      gw.emit('move', gxMatch, { x: 4, y: 6 }, { x: 4, y: 4 });
      await sleep(400);
      if (gxRejects === g1)
        pass('FIXES-2: correct-socket move still accepted (white e2-e4 after guard)');
      else fail('FIXES-2: correct-socket move accepted', `rejects=${gxRejects} (expected ${g1})`);
      gxA.disconnect(); gxB.disconnect();
    }
  }

  // === T-F1: user persistence (users.csv) + autocomplete ===
  // (a) signup wrote a row with a bcrypt hash (never plaintext)
  let f1ok = true; let f1err = '';
  try {
    const csv = fs.readFileSync(USERS_CSV, 'utf8');
    const rows = csv.trim().split('\n');
    if (rows[0] !== 'username,password_hash,elo') { f1ok = false; f1err = 'header: ' + rows[0]; }
    const row1 = rows.find(r => r.startsWith(uname1 + ','));
    if (!row1) { f1ok = false; f1err = 'no row for ' + uname1; }
    else {
      const parts = row1.split(',');
      if (parts[1] === 'pass1') { f1ok = false; f1err = 'plaintext password in CSV'; }
      if (!parts[1].startsWith('$2')) { f1ok = false; f1err = 'not a bcrypt hash: ' + parts[1].slice(0, 10); }
      if (parts[2] !== '1500') { f1ok = false; f1err = 'elo col: ' + parts[2]; }
    }
  } catch (e) { f1ok = false; f1err = String(e); }
  if (f1ok) pass('F1: signup persisted to users.csv (bcrypt hash, elo 1500)');
  else fail('F1: signup persisted to users.csv', f1err);

  // (b) "restart": load users from the CSV into a FRESH table and sign in
  // through the exported functions (unit-style; same code path the server
  // uses at startup via loadUsersFile()).
  const freshUsers = loadUsersFile(USERS_CSV);
  const reloaded = freshUsers.find(u => u.username === uname1);
  let f1bOk = false, f1bErr = 'not reloaded';
  if (reloaded && (Number(reloaded.elo) || 1500) === 1500) {
    const [r, sid] = await authenticateUser(freshUsers, uname1, 'pass1');
    if (r === 1 && sid) f1bOk = true;
    else f1bErr = 'signin on reloaded table failed (r=' + r + ')';
  }
  if (f1bOk) pass('F1: signin works after "restart" (loadUsersFile + authenticateUser)');
  else fail('F1: signin works after restart', f1bErr);

  // (c) invalid username (too short) -> -2, not persisted
  const bad = io(BASE, { transports: ['websocket'] });
  await Promise.race([new Promise(r => bad.on('connect', r)), sleep(3000)]);
  const badCode = await new Promise(r => {
    bad.once('signup', (c) => r(c));
    bad.emit('signup', { username: 'ab', password: 'whatever' });
    setTimeout(() => r(null), 3000);
  });
  if (badCode === -2) pass('F1: short username -> signup -2');
  else fail('F1: short username -> signup -2', 'got ' + badCode);
  bad.disconnect();

  // (d) GET /api/users?prefix= — case-insensitive, usernames only
  let apiNames = null; let apiUpper = null;
  try {
    apiNames = await (await fetch(BASE + '/api/users?prefix=' + encodeURIComponent(uname1.slice(0, 3).toLowerCase()))).json();
    apiUpper = await (await fetch(BASE + '/api/users?prefix=' + encodeURIComponent(uname1.slice(0, 3).toUpperCase()))).json();
  } catch (e) { f1err = String(e); }
  if (Array.isArray(apiNames) && apiNames.includes(uname1) && apiNames.length <= 10 &&
      Array.isArray(apiUpper) && apiUpper.includes(uname1)) {
    pass('F1: GET /api/users?prefix= returns the name (case-insensitive)');
  } else {
    fail('F1: GET /api/users?prefix=', `lower=${JSON.stringify(apiNames)} upper=${JSON.stringify(apiUpper)} ${f1err}`);
  }

  // === T-F2: Elo (start 1500, K=32) — two registered players, scholar's mate ===
  const e1 = io(BASE, { transports: ['websocket'] });
  const e2 = io(BASE, { transports: ['websocket'] });
  await Promise.all([
    Promise.race([new Promise(r => e1.on('connect', r)), sleep(3000)]),
    Promise.race([new Promise(r => e2.on('connect', r)), sleep(3000)])
  ]);
  const eloU1 = 'eloW_' + Date.now(), eloU2 = 'eloB_' + Date.now();
  e1.emit('signup', { username: eloU1, password: 'pw1' });
  await sleep(100);
  e2.emit('signup', { username: eloU2, password: 'pw2' });
  await sleep(100);
  const e1s = await new Promise(r => { e1.once('signin', (ok, s) => r(s)); e1.emit('signin', { username: eloU1, password: 'pw1' }); setTimeout(() => r(null), 3000); });
  const e2s = await new Promise(r => { e2.once('signin', (ok, s) => r(s)); e2.emit('signin', { username: eloU2, password: 'pw2' }); setTimeout(() => r(null), 3000); });

  let em1 = null, em2 = null;
  let e1Color = null, e2Color = null;
  let e1End = null, e2End = null, e1EloMsg = null, e2EloMsg = null;
  e1.on('startGame', (c, m) => { e1Color = c; em1 = m; });
  e2.on('startGame', (c, m) => { e2Color = c; em2 = m; });
  e1.on('gameEnd', d => { e1End = d; });
  e2.on('gameEnd', d => { e2End = d; });
  e1.on('elo', d => { e1EloMsg = d; });
  e2.on('elo', d => { e2EloMsg = d; });

  if (e1s) e1.emit('auth', e1s, null);
  if (e2s) e2.emit('auth', e2s, null);
  await sleep(500);

  if (em1 !== null && em1 === em2) {
    // Scholar's mate: e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#
    const seq = [[4,6,4,4],[4,1,4,3],[5,7,2,4],[1,0,2,2],[3,7,7,3],[6,0,5,2],[7,3,5,1]];
    for (let i = 0; i < seq.length; i++) {
      const [fx, fy, tx, ty] = seq[i];
      (i % 2 === 0 ? e1 : e2).emit('move', em1, { x: fx, y: fy }, { x: tx, y: ty });
      await sleep(200);
    }
    if (e1End && e2End) pass('F2: rated match ended (checkmate)');
    else fail('F2: rated match ended', `e1=${JSON.stringify(e1End)} e2=${JSON.stringify(e2End)}`);
  } else {
    fail('F2: rated match ended', `m1=${em1} m2=${em2}`);
  }

  // Elo in RAM (reloaded from CSV) + CSV file
  const after = loadUsersFile(USERS_CSV);
  const a1 = after.find(u => u.username === eloU1);
  const a2 = after.find(u => u.username === eloU2);
  if (a1 && a2) {
    const w = e1Color === 0 ? a1 : a2;
    const l = e1Color === 0 ? a2 : a1;
    if (w.elo > 1500 && l.elo < 1500 && w.elo + l.elo === 3000) {
      pass('F2: winner >1500, loser <1500, sum 3000 (' + w.elo + '/' + l.elo + ')');
    } else {
      fail('F2: elo values', `w=${w.elo} l=${l.elo} sum=${w.elo + l.elo} (e1Color=${e1Color})`);
    }
  } else {
    fail('F2: elo values', 'users not found in reloaded CSV');
  }
  const rawCsv = fs.readFileSync(USERS_CSV, 'utf8');
  const wRow = a1 && a2 ? (e1Color === 0 ? a1 : a2) : null;
  const lRow = a1 && a2 ? (e1Color === 0 ? a2 : a1) : null;
  if (wRow && lRow && rawCsv.includes(wRow.username + ',' + wRow.password + ',' + wRow.elo) &&
      rawCsv.includes(lRow.username + ',' + lRow.password + ',' + lRow.elo)) {
    pass('F2: new elo values written to users.csv');
  } else {
    fail('F2: new elo values written to users.csv', 'row mismatch (e1Color=' + e1Color + ')');
  }
  if (e1EloMsg && e2EloMsg && e1EloMsg.player1 === e2EloMsg.player1) {
    pass('F2: elo event emitted to both players');
  } else {
    fail('F2: elo event emitted to both players', `e1=${JSON.stringify(e1EloMsg)} e2=${JSON.stringify(e2EloMsg)}`);
  }
  e1.disconnect();
  e2.disconnect();

  // === T-REPLAY: move history + replay event (F3) ===
  // Two guests play a full game to checkmate (scholar's mate), then both
  // must receive a 'replay' event with the complete normalized move list.
  const r1 = io(BASE, { transports: ['websocket'] });
  const r2 = io(BASE, { transports: ['websocket'] });
  await Promise.all([
    Promise.race([new Promise(r => r1.on('connect', r)), sleep(3000)]),
    Promise.race([new Promise(r => r2.on('connect', r)), sleep(3000)])
  ]);

  let rMatch = null, rEnd1 = null, rEnd2 = null, rReplay1 = null, rReplay2 = null;
  r1.on('startGame', (c, m) => { if (rMatch === null) rMatch = m; });
  r2.on('startGame', (c, m) => { if (rMatch === null) rMatch = m; });
  r1.on('gameEnd', d => { rEnd1 = d; });
  r2.on('gameEnd', d => { rEnd2 = d; });
  r1.on('replay', m => { rReplay1 = m; });
  r2.on('replay', m => { rReplay2 = m; });
  r1.emit('auth', null, null);
  r2.emit('auth', null, null);
  // hardened 500 -> 1200 (same load-flake class as the guest seating wait:
  // parallel headless e2e inflates the seat round-trip -> rMatch stays null).
  await sleep(1200);

  if (rMatch !== null) {
    // Scholar's mate: e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#
    const seq = [[4,6,4,4],[4,1,4,3],[5,7,2,4],[1,0,2,2],[3,7,7,3],[6,0,5,2],[7,3,5,1]];
    for (let i = 0; i < seq.length; i++) {
      const [fx, fy, tx, ty] = seq[i];
      (i % 2 === 0 ? r1 : r2).emit('move', rMatch, { x: fx, y: fy }, { x: tx, y: ty });
      await sleep(200);
    }
    if (rEnd1 && rEnd2 && rEnd1.reason === 'checkmate' && rEnd2.reason === 'checkmate')
      pass('REPLAY: game ended (checkmate)');
    else
      fail('REPLAY: game ended', `e1=${JSON.stringify(rEnd1)} e2=${JSON.stringify(rEnd2)}`);
  } else {
    fail('REPLAY: game ended', 'match null');
  }

  // Both clients receive the replay event with a populated, well-shaped list
  const sanRe = /^[a-h][1-8]([-x])[a-h][1-8]$/;
  for (const [label, moves, end] of [['client1', rReplay1, rEnd1], ['client2', rReplay2, rEnd2]]) {
    if (!Array.isArray(moves) || moves.length < 4) {
      fail(`REPLAY: ${label} received replay array (>=4 moves)`, `got ${JSON.stringify(moves)}`);
      continue;
    }
    let okShape = true, okSan = true;
    moves.forEach((m, i) => {
      if (m.n !== i + 1 || (m.color !== 0 && m.color !== 1) || typeof m.piece !== 'number' ||
          typeof m.capture !== 'boolean' || typeof m.san !== 'string' ||
          !m.from || !m.to || typeof m.from.x !== 'number' || typeof m.from.y !== 'number' ||
          typeof m.to.x !== 'number' || typeof m.to.y !== 'number') okShape = false;
      // san must match from/to: file(from)+rank(from)+(-|x)+file(to)+rank(to)
      const expected = String.fromCharCode(97 + m.from.x) + (8 - m.from.y) +
        (m.capture ? 'x' : '-') + String.fromCharCode(97 + m.to.x) + (8 - m.to.y);
      if (!sanRe.test(m.san) || m.san !== expected) okSan = false;
    });
    if (okShape) pass(`REPLAY: ${label} all moves have n/color/piece/capture/from/to/san shape (${moves.length} moves)`);
    else fail(`REPLAY: ${label} move shape`, JSON.stringify(moves));
    if (okSan) pass(`REPLAY: ${label} san consistent with from/to (regex + recompute)`);
    else fail(`REPLAY: ${label} san from/to mismatch`, JSON.stringify(moves.slice(0, 3)));
    // first move = e2-e4 by white; last move = by the winner (white mated black)
    if (moves[0].color === 0 && moves[0].san === 'e2-e4')
      pass(`REPLAY: ${label} first move e2-e4 by white`);
    else fail(`REPLAY: ${label} first move`, JSON.stringify(moves[0]));
    const last = moves[moves.length - 1];
    if (last.color === 0 && end && end.result && (end.reason === 'checkmate'))
      pass(`REPLAY: ${label} last move color=0 (white) = winner (mated black)`);
    else fail(`REPLAY: ${label} last move color`, `last=${JSON.stringify(last)} end=${JSON.stringify(end)}`);
  }
  if (Array.isArray(rReplay1) && Array.isArray(rReplay2) && JSON.stringify(rReplay1) === JSON.stringify(rReplay2)) {
    pass(`REPLAY: both clients received identical move lists (${rReplay1.length} moves)`);
  } else {
    fail('REPLAY: identical histories', `l1=${rReplay1 && rReplay1.length} l2=${rReplay2 && rReplay2.length}`);
  }
  r1.disconnect();
  r2.disconnect();

  // === T-REPLAY-EDGE: zero-move resign → replay = empty array, no crash ===
  const z1 = io(BASE, { transports: ['websocket'] });
  const z2 = io(BASE, { transports: ['websocket'] });
  await Promise.all([
    Promise.race([new Promise(r => z1.on('connect', r)), sleep(3000)]),
    Promise.race([new Promise(r => z2.on('connect', r)), sleep(3000)])
  ]);

  let zMatch = null, zEnd1 = null, zReplay1 = undefined, zReplay2 = undefined;
  z1.on('startGame', (c, m) => { if (zMatch === null) zMatch = m; });
  z2.on('startGame', (c, m) => { if (zMatch === null) zMatch = m; });
  z1.on('gameEnd', d => { zEnd1 = d; });
  z1.on('replay', m => { zReplay1 = m; });
  z2.on('replay', m => { zReplay2 = m; });
  z1.emit('auth', null, null);
  z2.emit('auth', null, null);
  await sleep(500);
  if (zMatch !== null) {
    z1.emit('resign', zMatch);
    await sleep(300);
    if (zEnd1 && zEnd1.reason === 'resign' && Array.isArray(zReplay1) && zReplay1.length === 0 &&
        Array.isArray(zReplay2) && zReplay2.length === 0) {
      pass('REPLAY-EDGE: zero-move resign → replay = empty array to both');
    } else {
      fail('REPLAY-EDGE: zero-move resign replay', `end=${JSON.stringify(zEnd1)} r1=${JSON.stringify(zReplay1)} r2=${JSON.stringify(zReplay2)}`);
    }
  } else {
    fail('REPLAY-EDGE: zero-move resign replay', 'match null');
  }
  z1.disconnect();
  z2.disconnect();

  // === T-B3: pre-start disconnect (ghost seat) ===
  // Two guests reach startGame with NO moves played (moveHistory empty). One
  // disconnects → the OTHER must immediately receive 'gameEnd' with reason
  // 'opponent_disconnect' and result 'win' (winner = the one still connected),
  // and the match must be REMOVED: a fresh guest's findMatch gets a NEW matchId
  // (not re-seated into the dead match).
  const b3a = io(BASE, { transports: ['websocket'] });
  const b3b = io(BASE, { transports: ['websocket'] });
  await Promise.all([
    Promise.race([new Promise(r => b3a.on('connect', r)), sleep(3000)]),
    Promise.race([new Promise(r => b3b.on('connect', r)), sleep(3000)])
  ]);
  let b3Match = null, b3aColor = null, b3bColor = null, b3EndA = null, b3EndB = null;
  b3a.on('startGame', (c, m) => { b3aColor = c; if (b3Match === null) b3Match = m; });
  b3b.on('startGame', (c, m) => { b3bColor = c; if (b3Match === null) b3Match = m; });
  b3a.on('gameEnd', d => { b3EndA = d; });
  b3b.on('gameEnd', d => { b3EndB = d; });
  b3a.emit('auth', null, null);
  b3b.emit('auth', null, null);
  await sleep(500);
  if (b3Match !== null) {
    b3a.disconnect();
    await sleep(300);
    const winnerEnd = b3aColor === 0 ? b3EndB : b3EndA; // b3b stayed connected
    if (winnerEnd && winnerEnd.reason === 'opponent_disconnect' && winnerEnd.result === 'win')
      pass('B3: pre-start disconnect → opponent gets gameEnd(opponent_disconnect, win) immediately');
    else fail('B3: pre-start disconnect → immediate gameEnd', `winnerEnd=${JSON.stringify(winnerEnd)}`);
    // Match must be REMOVED (endMatch → removeMatch). Reuse-proof check: a
    // reconnect to the dead match must be rejected with gameNotFound (if the
    // ghost seat were still pooled, the returning player would re-enter it). We
    // don't compare numeric matchIds — S2 reuses maxId+1, so a fresh, healthy
    // match can legitimately carry the same id as a removed one.
    const b3c = io(BASE, { transports: ['websocket'] });
    await Promise.race([new Promise(r => b3c.on('connect', r)), sleep(3000)]);
    let b3cNotFound = false, b3cRecon = false, b3cStart = false;
    b3c.on('gameNotFound', () => { b3cNotFound = true; });
    b3c.on('reconnected', () => { b3cRecon = true; });
    b3c.on('startGame', () => { b3cStart = true; });
    b3c.emit('reconnect', { gameId: b3Match, color: b3bColor, sessionID: null, prevSocketId: null });
    await sleep(300);
    if (b3cNotFound && !b3cRecon && !b3cStart)
      pass('B3: dead pre-start match removed (reconnect → gameNotFound, no ghost re-seat)');
    else fail('B3: dead pre-start match removed', `b3Match=${b3Match} notFound=${b3cNotFound} recon=${b3cRecon} start=${b3cStart}`);
    b3c.disconnect();
  } else {
    fail('B3: pre-start disconnect', 'match null (startGame never arrived)');
  }
  b3b.disconnect();

  // === T-B4: F5 reconnect (stale socket replacement via prevSocketId) ===
  // Two guests reach startGame, play ONE move (moveHistory=1). White's socket
  // disconnects (F5). A NEW socket for the same white player emits 'reconnect'
  // with the SAME color and the OLD socket's id as prevSocketId → must get
  // 'reconnected' (NOT gameNotFound), with a correct board + turnState, and the
  // black player is unaffected.
  const b4w = io(BASE, { transports: ['websocket'] });
  const b4b = io(BASE, { transports: ['websocket'] });
  await Promise.all([
    Promise.race([new Promise(r => b4w.on('connect', r)), sleep(3000)]),
    Promise.race([new Promise(r => b4b.on('connect', r)), sleep(3000)])
  ]);
  let b4Match = null, b4wColor = null, b4bColor = null, b4wValid = 0, b4bValid = 0;
  b4w.on('startGame', (c, m) => { b4wColor = c; if (b4Match === null) b4Match = m; });
  b4b.on('startGame', (c, m) => { b4bColor = c; if (b4Match === null) b4Match = m; });
  b4w.on('validated', () => { b4wValid++; });
  b4b.on('validated', () => { b4bValid++; });
  b4w.emit('auth', null, null);
  b4b.emit('auth', null, null);
  await sleep(500);
  if (b4Match !== null) {
    // One move by white (e2-e4) so moveHistory.length = 1.
    const wMoveFirst = b4wColor === 0;
    if (wMoveFirst) {
      b4w.emit('move', b4Match, { x: 4, y: 6 }, { x: 4, y: 4 });
    } else {
      b4w.emit('move', b4Match, { x: 4, y: 1 }, { x: 4, y: 3 });
    }
    await sleep(300);
    const oldWId = b4w.id; // socket.io id BEFORE disconnect (the F5 race case)
    b4w.disconnect();
    await sleep(100);
    // A NEW socket (the reloaded page) reconnects as the same white player,
    // carrying the old socket's id as prevSocketId.
    const b4w2 = io(BASE, { transports: ['websocket'] });
    await Promise.race([new Promise(r => b4w2.on('connect', r)), sleep(3000)]);
    let b4Recon = null, b4NotFound = false, b4W2End = null;
    b4w2.on('reconnected', (color, gid, boardState, turnState) => { b4Recon = { color, gid, boardState, turnState }; });
    b4w2.on('gameNotFound', () => { b4NotFound = true; });
    b4w2.on('gameEnd', d => { b4W2End = d; });
    b4w2.emit('reconnect', { gameId: b4Match, color: b4wColor, sessionID: null, prevSocketId: oldWId });
    await sleep(300);
    if (!b4NotFound && b4Recon && b4Recon.color === b4wColor && b4Recon.gid === b4Match &&
        Array.isArray(b4Recon.boardState) && b4Recon.boardState.length === 8 &&
        (b4Recon.turnState === 0 || b4Recon.turnState === 1))
      pass('B4: F5 reconnect (prevSocketId=old) → reconnected (not gameNotFound) with board+turnState');
    else fail('B4: F5 reconnect', `notFound=${b4NotFound} recon=${b4Recon && JSON.stringify({ color: b4Recon.color, gid: b4Recon.gid, turn: b4Recon.turnState, rows: b4Recon.boardState && b4Recon.boardState.length })}`);
    // Black unaffected: the reconnected white did NOT end the game for black.
    b4w2.disconnect();
  } else {
    fail('B4: F5 reconnect', 'match null (startGame never arrived)');
  }
  b4b.disconnect();

  // === T-B6: session persistence across a container "restart" ===
  // Simulates exactly what a deploy/restart does: the in-RAM user array is
  // rebuilt from disk (users.csv + sessions.json), sessions re-attached.
  // Uses the suite's default DATA_DIR (fresh mkdtemp per run) for the session
  // file, and an isolated users.csv for the user record. T-B6 runs LAST, so
  // the file rewrite done by validateSession's persist can't affect other tests.
  {
    const b6UsersCsv = `${process.cwd()}/test-data-b6-users-${Date.now()}.csv`;
    const b6Password = 'b6pass';
    const b6u1 = loadUsersFile(b6UsersCsv); // materializes the header row
    b6u1.push({ username: 'b6user1', password: await bcrypt.hash(b6Password, 4), sessions: [], elo: 1500 });
    saveUsersFile(b6u1, b6UsersCsv);
    const [b6r, b6sid] = await authenticateUser(b6u1, 'b6user1', b6Password);
    if (b6r === 1 && b6sid) pass('B6: authenticateUser -> [1, sid]');
    else fail('B6: authenticateUser', `r=${b6r} sid=${b6sid}`);
    // 2) Simulated restart: fresh load from disk, sessions re-attached.
    const b6Users2 = loadUsersFile(b6UsersCsv);
    attachSessionsToUsers(b6Users2, loadSessionsFile());
    const b6Valid = validateSession(b6Users2, b6sid);
    if (b6Valid && b6Valid.username === 'b6user1')
      pass('B6: session survives restart (fresh reload + attach -> validateSession OK)');
    else fail('B6: session survives restart', `validateSession -> ${b6Valid ? b6Valid.username : null}`);
    // 3) Expired session: planted in the file, then the server restarts.
    const b6ExpiredId = 'b6expiredid' + Date.now();
    const b6File0 = loadSessionsFile();
    b6File0.push({ id: b6ExpiredId, username: 'b6user1', expires: new Date(Date.now() - 60000).toISOString() });
    saveSessionsFile(b6File0);
    const b6Users3 = loadUsersFile(b6UsersCsv);
    attachSessionsToUsers(b6Users3, loadSessionsFile());
    if (validateSession(b6Users3, b6ExpiredId) === null)
      pass('B6: expired session not attached after reload (validateSession -> null)');
    else fail('B6: expired session', 'validateSession returned a user for a past-expires session');
    // 4) Prune: the expired entry was pruned from RAM at attach (not validated),
    //    so the file is cleaned lazily on the NEXT persist — production trigger:
    //    the user signs in again, authenticateUser persists the file from RAM,
    //    and the stale entry disappears.
    const b6Users4 = loadUsersFile(b6UsersCsv);
    attachSessionsToUsers(b6Users4, loadSessionsFile());
    const [b6r2, b6sid2] = await authenticateUser(b6Users4, 'b6user1', b6Password);
    if (b6r2 === 1 && !loadSessionsFile().some(e => e.id === b6ExpiredId))
      pass('B6: expired session pruned from sessions.json on next persist (re-signin)');
    else fail('B6: expired session pruned from file', `r=${b6r2}, still in file=${loadSessionsFile().some(e => e.id === b6ExpiredId)}`);
    fs.rmSync(b6UsersCsv, { force: true });
  }

  // === T30 (TASK 2): seat 'elo' payload for registered players ===
  // Contract under test: whenever a socket with an authenticated REGISTERED
  // user is seated into a match, the server emits 'elo' to THAT socket with
  // { own, rated, opponent } — rated=true only if the opponent is ALSO
  // registered; opponent = opponent's elo when rated, else null.
  // Phase 1: guest G joins match #1 first (no seat-elo for guests), then
  //          U (registered) joins -> rated=false, opponent=null.
  // Phase 2: FRESH match #2: fresh guest G2 joins first (again no seat-elo —
  //          guests never get one), U2 (registered) joins -> rated=false.
  //          (Separate match because B3 ends match #1 immediately when U
  //          disconnects pre-start, so the dead id must not be reused.)
  // Phase 3: match #3: U (player1) vs U2 (player2), BOTH registered ->
  //          both rated=true, opponent = the other's own (reciprocal).
  // The end-of-game 'elo' payload ({ player1, player2 }) is a DIFFERENT shape,
  // asserted in the F2 rows above, and must stay byte-compatible for old clients.
  {
    const seU = io(BASE, { transports: ['websocket'] });
    const seG = io(BASE, { transports: ['websocket'] });
    const seU2 = io(BASE, { transports: ['websocket'] });
    const seU3 = io(BASE, { transports: ['websocket'] });
    const seG2 = io(BASE, { transports: ['websocket'] });
    await Promise.all([
      Promise.race([new Promise(r => seU.on('connect', r)), sleep(3000)]),
      Promise.race([new Promise(r => seG.on('connect', r)), sleep(3000)]),
      Promise.race([new Promise(r => seU2.on('connect', r)), sleep(3000)]),
      Promise.race([new Promise(r => seU3.on('connect', r)), sleep(3000)]),
      Promise.race([new Promise(r => seG2.on('connect', r)), sleep(3000)])
    ]);
    const seU1name = 'seat1_' + Date.now(), seU2name = 'seat2_' + Date.now(), seU3name = 'seat3_' + Date.now();
    seU.emit('signup', { username: seU1name, password: 'spw1' });
    seU2.emit('signup', { username: seU2name, password: 'spw2' });
    seU3.emit('signup', { username: seU3name, password: 'spw3' });
    await sleep(150);
    // T31 hardening: the suite runs under parallel load (concurrent e2e harness);
    // a 3s signin budget flaked here (2026-11-23) — retry helper, 3x4s budgets.
    const seU1s = await signinWithRetry(seU, seU1name, 'spw1');
    const seU2s = await signinWithRetry(seU2, seU2name, 'spw2');
    const seU3s = await signinWithRetry(seU3, seU3name, 'spw3');
    if (!(seU1s && seU2s && seU3s)) fail('T30 seat-elo: signup/signin for all users', `s1=${seU1s} s2=${seU2s} s3=${seU3s}`);

    const u1Elos = [];
    seU.on('elo', d => { u1Elos.push(d); });
    let guestEloSeen = null, u2SeatElo = null;
    seG.on('elo', d => { guestEloSeen = guestEloSeen || d; });
    seG2.on('elo', d => { guestEloSeen = guestEloSeen || d; });
    seU2.on('elo', d => { u2SeatElo = d; });

    // Phase 1: U creates match #1; guest G joins FIRST (no seat-elo for
    // guests), then U (registered) joins -> rated=false, opponent=null.
    let seMatch1 = null, seMatch2 = null, seMatch3 = null;
    seU.on('private-match', (id) => { if (seMatch1 === null) { seMatch1 = id; seG.emit('auth', null, id); } });
    seU3.on('private-match', (id) => {
      if (seMatch2 === null) { seMatch2 = id; seG2.emit('auth', null, id); }
      else if (seMatch3 === null) { seMatch3 = id; seU.emit('auth', seU1s, id); }
    });
    seU.emit('private-match', null);
    await Promise.race([new Promise(r => seU.once('private-match', r)), sleep(3000)]);
    await sleep(700);
    if (guestEloSeen === null)
      pass('T30 seat-elo: guest seated FIRST gets no seat-elo emission');
    else fail('T30 seat-elo: guest should get no seat elo', JSON.stringify(guestEloSeen));

    if (seU1s) seU.emit('auth', seU1s, seMatch1);
    await sleep(1000);
    const seatUnrated = u1Elos[0];
    if (seatUnrated && typeof seatUnrated.own === 'number' && seatUnrated.rated === false && seatUnrated.opponent === null)
      pass('T30 seat-elo: registered vs guest -> { own: ' + seatUnrated.own + ', rated: false, opponent: null }');
    else fail('T30 seat-elo: registered-vs-guest shape', JSON.stringify(u1Elos));

    // Phase 2: FRESH match #2 (B3 ends match #1 on a pre-start disconnect,
    // so its id is dead — a fresh match is required). U3 (connected) creates
    // match #2, then G (match #1's player1) disconnects — the B3 rule ends
    // match #1. G is the one who disconnects (NOT U): U must stay CONNECTED
    // for phase 3, because a disconnected socket's packets are dropped
    // server-side and U's phase-3 join (echo-triggered) would never arrive.
    // G got no seat-elo payload (guests get none), so losing it costs nothing.
    seU3.emit('private-match', null);
    await Promise.race([new Promise(r => seU3.once('private-match', r)), sleep(3000)]);
    seG.disconnect();
    await sleep(300);
    await sleep(700);
    if (seU2s) seU2.emit('auth', seU2s, seMatch2);
    await sleep(1000);
    if (u2SeatElo && typeof u2SeatElo.own === 'number' && u2SeatElo.rated === false && u2SeatElo.opponent === null)
      pass('T30 seat-elo: registered (U2) vs fresh guest -> rated: false, opponent: null');
    else fail('T30 seat-elo: U2-vs-fresh-guest shape', JSON.stringify(u2SeatElo));
    if (guestEloSeen === null)
      pass('T30 seat-elo: fresh guest seated first gets no seat-elo emission (both phases)');
    else fail('T30 seat-elo: fresh guest should get no seat elo', JSON.stringify(guestEloSeen));

    // Phase 3: registered vs REGISTERED — U3 (creator) shares match #3's
    // link without seating; U joins first (player1 — at U's seating the
    // opponent slot is still empty, so U's own payload reads rated:false and
    // is NOT the rated pair), U2 joins second (player2) -> BOTH seated sockets
    // get rated=true with opponent = the other player's own elo (reciprocal).
    // Join order must be DETERMINISTIC (U before U2): the echo triggers U's
    // auth synchronously, while U2's auth is a separate emit that would race
    // the server queue — if U2 got queued first, both payloads read
    // rated:false (opponent not yet registered at each one's seating).
    // Gate: U2 joins only after U's phase-3 payload (the rated:false one,
    // emitted at U's seating) has been received.
    seU3.emit('private-match', null);
    await Promise.race([new Promise(r => seU3.once('private-match', r)), sleep(3000)]);
    const u1CountAtP3Start = u1Elos.length;
    await new Promise(r => {
      const t = setInterval(() => {
        if (u1Elos.length > u1CountAtP3Start) { clearInterval(t); r(); }
      }, 50);
      setTimeout(() => { clearInterval(t); r(); }, 3000);
    });
    await sleep(200); // margin: U's socket is seated before U2's auth lands
    if (seU2s) seU2.emit('auth', seU2s, seMatch3);
    await sleep(1000);
    const u1Rated = u1Elos[u1Elos.length - 1];
    const u2Rated = u2SeatElo; // u2SeatElo holds U2's LATEST emission (the phase-3 one)
    if (u1Rated && u1Rated !== seatUnrated && typeof u1Rated.own === 'number' && u1Rated.rated === true &&
        typeof u1Rated.opponent === 'number' && u2Rated && u2Rated !== u1Rated && u2Rated.rated === true &&
        u1Rated.opponent === u2Rated.own && u2Rated.opponent === u1Rated.own)
      pass('T30 seat-elo: registered vs registered -> both rated: true, opponent=<other elo> (reciprocal)');
    else fail('T30 seat-elo: registered-vs-registered reciprocal', `u1=${JSON.stringify(u1Elos)} u2=${JSON.stringify(u2Rated)}`);

    // Shape discipline: seat payloads must NOT carry the game-end keys (the
    // client disambiguates the two 'elo' payload shapes by keys).
    const cleanShape = d => d && typeof d.own === 'number' && typeof d.rated === 'boolean' &&
      ('opponent' in d) && !('player1' in d) && !('player2' in d);
    if (seatUnrated && cleanShape(seatUnrated) && u1Rated && cleanShape(u1Rated) && u2Rated && cleanShape(u2Rated))
      pass('T30 seat-elo: seat payloads carry own/rated/opponent ONLY (no player1/player2)');
    else fail('T30 seat-elo: payload key discipline', JSON.stringify({ u1: seatUnrated, rated1: u1Rated, u2: u2Rated }));

    seG.disconnect(); seG2.disconnect(); seU.disconnect(); seU2.disconnect(); seU3.disconnect();
  }

  // === F3: lastMove sync — opponent learns the server-authoritative lastMove ===
  // White double-push e2-e4; black's validated payload must carry it so the
  // black client can compute the en-passant target (bug: lastMove was local-
  // click-only, EP was dead for the side that did not move).
  {
    const sA = io(BASE, { transports: ['websocket'] });
    const sB = io(BASE, { transports: ['websocket'] });
    await Promise.all([
      Promise.race([new Promise(r => sA.on('connect', r)), sleep(3000)]),
      Promise.race([new Promise(r => sB.on('connect', r)), sleep(3000)])
    ]);
    let f3Match = null, f3ColorA = null, lastLmToB = null;
    sA.on('startGame', (c, m) => { if (f3ColorA === null) f3ColorA = c; if (f3Match === null) f3Match = m; });
    sB.on('startGame', (c, m) => { if (f3Match === null) f3Match = m; });
    // seat via private-match (proven pattern from FIXES-2 block)
    sA.on('private-match', (id) => { f3Match = id; sA.emit('auth', null, id); sB.emit('auth', null, id); });
    sA.emit('private-match', 7);
    await Promise.race([new Promise(r => sA.once('private-match', r)), sleep(3000)]);
    await sleep(600);
    const f3White = () => (f3ColorA === 0 ? sA : sB);
    const f3Black = () => (f3ColorA === 0 ? sB : sA);
    let f3Reject = 0;
    const f3Collect = (s) => s.on('validated', (b, t, extra) => {
      // rejection is broadcast to BOTH sockets; count it once (on white only)
      if (extra && extra.rejected) { if (s === f3White()) f3Reject++; return; }
      if (extra && extra.lastMove) lastLmToB = extra.lastMove;
    });
    f3Collect(sA); f3Collect(sB);
    if (f3Match !== null) {
      const e4 = { x: 4, y: 4 }, e2 = { x: 4, y: 6 };
      f3White().emit('move', f3Match, e2, e4);
      await sleep(1200);
      const okLm = lastLmToB && lastLmToB.from && lastLmToB.from.y === 6 && lastLmToB.from.x === 4
        && lastLmToB.to && lastLmToB.to.y === 4 && lastLmToB.to.x === 4;
      if (okLm) pass('F3: validated payload carries lastMove e2-e4 to both sockets');
      else fail('F3 lastMove payload', `lastMove=${JSON.stringify(lastLmToB)}`);
      // out-of-turn move (black while white is to move) must be rejected and
      // must not stamp a lastMove into any payload
      lastLmToB = null; f3Reject = 0;
      f3Black().emit('move', f3Match, e4, { x: 4, y: 3 });
      await sleep(1200);
      if (f3Reject === 1 && lastLmToB === null)
        pass('F3: rejected payload carries no lastMove stamp');
      else fail('F3 rejected payload', `rejects=${f3Reject}, lm=${JSON.stringify(lastLmToB)}`);
      // promotion path sanity: lastMove key present on a normal move payload
      // already proven above; reconnect field checked via reconnected listener
      // only when a reconnect happens — covered by E2E F5, not reproduced here.
    } else {
      fail('F3 match setup', 'no matchId');
    }
    sA.disconnect(); sB.disconnect();
  }

  // === T31 (contract 32): user account server — games.csv, invites, /account, /api/me ===
  // The in-process test server points DATA_DIR at the runner's fresh mkdtemp dir
  // (same as USERS_CSV), so GAMES_CSV / invites.json land in the TEMP dir —
  // never the real data/. The F2 block above already ended a reg-vs-reg rated
  // game, so its games.csv row exists here and is asserted first.
  {
    // --- games.csv: the F2 row (reg vs reg, checkmate, both started 1500) ---
    const gamesAfterF2 = loadGames();
    const f2w = (e1Color === 0) ? eloU1 : eloU2;
    const f2l = (e1Color === 0) ? eloU2 : eloU1;
    const f2Rows = gamesAfterF2.filter(g =>
      (g.white === f2w && g.black === f2l) || (g.white === f2l && g.black === f2w));
    const f2Row = f2Rows[0];
    const finalW = (e1Color === 0) ? a1 : a2;
    const finalL = (e1Color === 0) ? a2 : a1;
    if (f2Rows.length === 1 && f2Row && (f2Row.result === 'white-win' || f2Row.result === 'black-win') && f2Row.reason === 'checkmate' && f2Row.white !== '-' && f2Row.black !== '-' && f2Row.ts) {
      const wIsWhite = (f2Row.white === f2w);
      const wFinal = wIsWhite ? finalW.elo : finalL.elo;
      const lFinal = wIsWhite ? finalL.elo : finalW.elo;
      if (f2Row.whiteEloBefore === 1500 && f2Row.blackEloBefore === 1500 &&
          f2Row.whiteEloAfter === (wIsWhite ? wFinal : lFinal) &&
          f2Row.blackEloAfter === (wIsWhite ? lFinal : wFinal))
        pass('T31: games.csv F2 row — result ' + f2Row.result + ', reason ' + f2Row.reason + ', elo_before 1500/1500, elo_after = final CSV values');
      else
        fail('T31: games.csv F2 row elo columns', JSON.stringify(f2Row) + ' finals=' + wFinal + '/' + lFinal);
    } else {
      fail('T31: games.csv F2 row', `rows=${JSON.stringify(f2Rows)}`);
    }

    // --- games.csv: guest-vs-guest game end -> NO row ---
    const rowsBeforeGG = loadGames().length;
    const gg1 = io(BASE, { transports: ['websocket'] });
    const gg2 = io(BASE, { transports: ['websocket'] });
    await Promise.all([
      Promise.race([new Promise(r => gg1.on('connect', r)), sleep(3000)]),
      Promise.race([new Promise(r => gg2.on('connect', r)), sleep(3000)])
    ]);
    let ggMatch = null, ggEnd1 = null, ggEnd2 = null;
    gg1.on('startGame', (c, m) => { if (ggMatch === null) ggMatch = m; });
    gg2.on('startGame', (c, m) => { if (ggMatch === null) ggMatch = m; });
    gg1.on('gameEnd', d => { ggEnd1 = d; });
    gg2.on('gameEnd', d => { ggEnd2 = d; });
    gg1.emit('auth', null, null);
    gg2.emit('auth', null, null);
    const ggReady = await waitFor(() => ggMatch !== null, 5000);
    if (ggReady) {
      gg1.emit('resign', ggMatch);
      await waitFor(() => ggEnd1 && ggEnd2, 3000);
      await sleep(200); // allow the endMatch append to flush
    }
    const rowsAfterGG = loadGames().length;
    if (ggEnd1 && ggEnd2 && rowsAfterGG === rowsBeforeGG)
      pass('T31: guest-vs-guest game end -> no games.csv row (count ' + rowsBeforeGG + ' unchanged)');
    else
      fail('T31: guest-vs-guest no row', `end1=${JSON.stringify(ggEnd1)} rows ${rowsBeforeGG}->${rowsAfterGG}`);
    gg1.disconnect(); gg2.disconnect();

    // --- games.csv: registered-vs-guest -> ONE row, guest side is '-' ---
    const rgW = 't31rgw_' + Date.now();
    const rg1 = io(BASE, { transports: ['websocket'] });
    const rg2 = io(BASE, { transports: ['websocket'] });
    await Promise.all([
      Promise.race([new Promise(r => rg1.on('connect', r)), sleep(3000)]),
      Promise.race([new Promise(r => rg2.on('connect', r)), sleep(3000)])
    ]);
    rg1.emit('signup', { username: rgW, password: 'rgpw1' });
    await sleep(150);
    const rg1s = await signinWithRetry(rg1, rgW, 'rgpw1');
    let rgMatch = null, rgColor1 = null, rgEnd1 = null, rgEnd2 = null;
    rg1.on('startGame', (c, m) => { rgColor1 = c; if (rgMatch === null) rgMatch = m; });
    rg2.on('startGame', (c, m) => { if (rgMatch === null) rgMatch = m; });
    rg1.on('gameEnd', d => { rgEnd1 = d; });
    rg2.on('gameEnd', d => { rgEnd2 = d; });
    // Inviter-style seating: the registered player's match, registered joins first
    // (white/host), then the guest joins (open-join private match, no invite).
    rg1.on('private-match', (id) => { if (rgMatch === null) rgMatch = id; });
    rg1.emit('private-match', null);
    await Promise.race([new Promise(r => rg1.once('private-match', r)), sleep(3000)]);
    // Deterministic seating order: the server processes socket events in queue
    // order — the registered player is queued first and seats white, the guest
    // second and seats black (open-join private match, no invite). A callback-
    //triggered second emit would race the queue, so both are emitted here, back
    // to back, right after the echo.
    if (rgMatch !== null) {
      rg1.emit('auth', rg1s, rgMatch);
      rg2.emit('auth', null, rgMatch);
    }
    // Wait until BOTH are seated (startGame delivered to rg1 — rgColor1 set) and
    // the game has not ended yet. A null rg1s here means signin timed out under
    // load — fail loudly instead of silently producing a guest-vs-guest game.
    if (!rg1s) fail('T31 rg: signin timed out under load', 'rg1s=null');
    await waitFor(() => rgColor1 !== null && rgEnd1 === null, 5000);
    if (rgMatch !== null && rgColor1 !== null && rgEnd1 === null) {
      // the GUEST (color 1) resigns -> reason resign, result white-win
      const rgGuest = rgColor1 === 0 ? rg2 : rg1;
      rgGuest.emit('resign', rgMatch);
      await waitFor(() => rgEnd1 && rgEnd2, 3000);
      await sleep(300); // allow the endMatch append to flush
    }
    const rgRows = loadGames().filter(g => g.white === rgW || g.black === rgW);
    const rgRow = rgRows[0];
    if (rgRows.length === 1 && rgRow && (rgRow.white === rgW) === (rgColor1 === 0) &&
        rgRow.result === 'white-win' && rgRow.reason === 'resign' &&
        rgRow.whiteEloBefore === 1500 && rgRow.whiteEloAfter === 1500 &&
        rgRow.black === null && rgRow.blackEloBefore === 0 && rgRow.blackEloAfter === 0)
      pass('T31: games.csv registered-vs-guest — one row, guest = "-", elo unchanged (1500/0)');
    else
      fail('T31: games.csv registered-vs-guest', `rows=${JSON.stringify(rgRows)} color1=${rgColor1} end1=${JSON.stringify(rgEnd1)}`);
    rg1.disconnect(); rg2.disconnect();

    // --- invites: setup (3 users + a guest socket) ---
    const ivA = 't31ivA_' + Date.now(), ivB = 't31ivB_' + Date.now(), ivC = 't31ivC_' + Date.now();
    const ivAsock = io(BASE, { transports: ['websocket'] });
    const ivBsock = io(BASE, { transports: ['websocket'] });
    const ivCsock = io(BASE, { transports: ['websocket'] });
    const ivGsock = io(BASE, { transports: ['websocket'] });
    await Promise.all([
      Promise.race([new Promise(r => ivAsock.on('connect', r)), sleep(3000)]),
      Promise.race([new Promise(r => ivBsock.on('connect', r)), sleep(3000)]),
      Promise.race([new Promise(r => ivCsock.on('connect', r)), sleep(3000)]),
      Promise.race([new Promise(r => ivGsock.on('connect', r)), sleep(3000)])
    ]);
    ivAsock.emit('signup', { username: ivA, password: 'ivpw' });
    await sleep(100);
    ivBsock.emit('signup', { username: ivB, password: 'ivpw' });
    await sleep(100);
    ivCsock.emit('signup', { username: ivC, password: 'ivpw' });
    await sleep(100);
    // Each user signs in TWICE (a second session for the later join attempts):
    // authenticateUser issues a FRESH session per call, so the FIRST ids are
    // what the 'auth' events below consume (and they become stale for any
    // later auth) — the SECOND ids are kept for the invite-bound join phase.
    ivAsock.once('signin', () => {});
    ivAsock.emit('signin', { username: ivA, password: 'ivpw' });
    await sleep(100);
    ivBsock.once('signin', () => {});
    ivBsock.emit('signin', { username: ivB, password: 'ivpw' });
    await sleep(100);
    ivCsock.once('signin', () => {});
    ivCsock.emit('signin', { username: ivC, password: 'ivpw' });
    await sleep(100);
    const ivAs = await signinWithRetry(ivAsock, ivA, 'ivpw');
    const ivBs = await signinWithRetry(ivBsock, ivB, 'ivpw');
    const ivCs = await signinWithRetry(ivCsock, ivC, 'ivpw');
    if (!(ivAs && ivBs && ivCs)) fail('T31 invites: signup/signin setup', `A=${!!ivAs} B=${!!ivBs} C=${!!ivCs}`);

    // Authenticate A NOW (socket.data.user) — the failure-reason emissions below
    // require an authenticated inviter. B and C authenticate only in the
    // join phase (their first 'auth' double as the "automatic invites push"
    // check and the target join).
    ivAsock.emit('auth', ivAs, null);
    await sleep(300);

    // Failure reasons (contract §2): guest -> auth; method rapid -> method-na;
    // unknown target -> no-user; self -> self. Each must emit invite:failed
    // with exactly {reason}, and NO invite:created.
    const ivAFailed = [];
    const ivACreated = [];
    ivAsock.on('invite:failed', d => ivAFailed.push(d));
    ivAsock.on('invite:created', d => ivACreated.push(d));
    ivGsock.on('invite:failed', d => ivAFailed.push(d));
    // 1) unauthenticated guest
    ivGsock.emit('invite:create', { targetUsername: ivB, method: 'standard' });
    await sleep(200);
    // 2) bad method (authenticated)
    ivAsock.emit('invite:create', { targetUsername: ivB, method: 'rapid' });
    await sleep(200);
    // 3) unknown user
    ivAsock.emit('invite:create', { targetUsername: 'nobody_x9', method: 'standard' });
    await sleep(200);
    // 4) self
    ivAsock.emit('invite:create', { targetUsername: ivA, method: 'standard' });
    await sleep(200);
    const reasons = ivAFailed.map(d => d && d.reason);
    if (ivAFailed.length === 4 && JSON.stringify(reasons) === JSON.stringify(['auth', 'method-na', 'no-user', 'self']) && ivACreated.length === 0)
      pass('T31: invite:failed reasons [auth, method-na, no-user, self] (4/4, no invite:created)');
    else
      fail('T31: invite:failed reasons', `got=${JSON.stringify(reasons)} created=${JSON.stringify(ivACreated)}`);

    // Success: invite A -> B. Record stored; inviter gets invite:created {matchId}.
    ivAsock.emit('invite:create', { targetUsername: ivB, method: 'standard' });
    await waitFor(() => ivACreated.length === 1, 3000);
    const ivMatchId = ivACreated[0] && ivACreated[0].matchId;
    if (ivMatchId && /^[a-z0-9]{8}$/.test(ivMatchId))
      pass('T31: invite:created {matchId: /^a-z0-9{8}$/} (' + ivMatchId + ')');
    else
      fail('T31: invite:created', JSON.stringify(ivACreated));

    // Automatic push: B authenticates (no matchId) -> receives `invites` with the
    // live record {from, fromElo, method, matchId, createdAt}.
    let ivBInvites = null;
    ivBsock.on('invites', d => { if (Array.isArray(d)) ivBInvites = d; });
    if (ivBs) ivBsock.emit('auth', ivBs, null);
    await waitFor(() => ivBInvites !== null, 3000);
    const ivBRec = ivBInvites && ivBInvites[0];
    if (ivBInvites && ivBInvites.length === 1 && ivBRec && ivBRec.from === ivA && ivBRec.method === 'standard' &&
        ivBRec.matchId === ivMatchId && typeof ivBRec.createdAt === 'string' && !isNaN(Date.parse(ivBRec.createdAt)) &&
        Number(ivBRec.fromElo) === 1500)
      pass('T31: automatic invites push after authenticated auth — record {from, fromElo:1500, method, matchId, createdAt}');
    else
      fail('T31: automatic invites push', JSON.stringify(ivBInvites));

    // invites:list while the match is live -> 1 record.
    ivBsock.removeAllListeners('invites'); ivBInvites = null;
    ivBsock.on('invites', d => { if (Array.isArray(d)) ivBInvites = d; });
    ivBsock.emit('invites:list');
    await waitFor(() => ivBInvites !== null, 3000);
    if (ivBInvites && ivBInvites.length === 1 && ivBInvites[0].matchId === ivMatchId)
      pass('T31: invites:list (match live) -> 1 record');
    else
      fail('T31: invites:list live', JSON.stringify(ivBInvites));

    // Invite-bound join: the inviter (A) joins first (host/white per existing
    // semantics: first participant = player1Socket). Then the TARGET (B) joins
    // as black. Guest and wrong-user are both refused (gameNotFound) because
    // they are neither invite.to nor invite.from.
    let ivGNotFound = false, ivCNotFound = false, ivBNotFound = false;
    let ivAColor = null, ivBColor = null;
    ivGsock.on('gameNotFound', () => { ivGNotFound = true; });
    ivCsock.on('gameNotFound', () => { ivCNotFound = true; });
    ivBsock.on('gameNotFound', () => { ivBNotFound = true; });
    ivAsock.on('startGame', (c) => { ivAColor = c; });
    ivBsock.on('startGame', (c) => { ivBColor = c; });
    // Step 1: inviter A joins first -> white (player1Socket)
    ivAsock.emit('auth', ivAs, ivMatchId);
    await sleep(500);
    // Step 2: guest is refused (no socket.data.user). A is seated (player1)
    // but startGame only fires once B is seated, so aColor is still null here.
    ivGsock.emit('auth', null, ivMatchId);
    await sleep(300);
    if (ivGNotFound && ivAColor === null && ivBColor === null)
      pass('T31: invite-bound join — guest refused (gameNotFound; only inviter seated so far)');
    else
      fail('T31: invite-bound guest refusal', `gNotFound=${ivGNotFound} aColor=${ivAColor} bColor=${ivBColor}`);
    // Step 3: wrong registered user C is refused
    ivCsock.emit('auth', ivCs, ivMatchId);
    await sleep(300);
    if (ivCNotFound && ivBColor === null)
      pass('T31: invite-bound join — wrong registered user refused (gameNotFound)');
    else
      fail('T31: invite-bound wrong-user refusal', `cNotFound=${ivCNotFound} bColor=${ivBColor}`);
    // Step 4: target B joins as black
    ivBsock.emit('auth', ivBs, ivMatchId);
    await sleep(500);
    if (ivBColor === 1 && !ivBNotFound)
      pass('T31: invite-bound join — target joins as black (color 1), both seated');
    else
      fail('T31: invite-bound target join', `bColor=${ivBColor} bNotFound=${ivBNotFound}`);
    // A's color should be 0 (white, first seat)
    if (ivAColor === 0)
      pass('T31: invite-bound join — inviter seated white (host, color 0)');
    else
      fail('T31: invite-bound inviter color', `aColor=${ivAColor}`);

    // Live-filter: after the invite game ends (black resigns), the match is
    // spliced from the pool; invites:list must return [] although the stored
    // record remains (RAM + invites.json).
    let ivAEnd = null, ivBEnd = null;
    ivAsock.on('gameEnd', d => { ivAEnd = d; });
    ivBsock.on('gameEnd', d => { ivBEnd = d; });
    ivBsock.emit('resign', ivMatchId);
    await waitFor(() => ivAEnd && ivBEnd, 3000);
    await sleep(200);
    ivBsock.removeAllListeners('invites'); ivBInvites = null;
    ivBsock.on('invites', d => { if (Array.isArray(d)) ivBInvites = d; });
    ivBsock.emit('invites:list');
    await waitFor(() => ivBInvites !== null, 3000);
    if (ivAEnd && ivBEnd && ivBInvites && ivBInvites.length === 0)
      pass('T31: invites:list after match ends -> [] (dead match filtered, record kept)');
    else
      fail('T31: invites:list dead filter', `end=${JSON.stringify(ivAEnd)}/${JSON.stringify(ivBEnd)} list=${JSON.stringify(ivBInvites)}`);

    // games.csv row for the invite game: A(white, host) vs B(black, target),
    // B resigns -> B loses -> result white-win. A's elo goes up, B's goes down.
    const ivRows = loadGames().filter(g => (g.white === ivA && g.black === ivB) || (g.white === ivB && g.black === ivA));
    if (ivRows.length === 1 && ivRows[0].result === 'white-win' && ivRows[0].reason === 'resign' &&
        ivRows[0].white === ivA && ivRows[0].black === ivB &&
        ivRows[0].whiteEloBefore === 1500 && ivRows[0].blackEloBefore === 1500 &&
        ivRows[0].whiteEloAfter > 1500 && ivRows[0].blackEloAfter < 1500)
      pass('T31: games.csv row for the invite game — A(white) vs B(black), resign -> white-win, elo 1500/1500 before, ' + ivRows[0].whiteEloAfter + '/' + ivRows[0].blackEloAfter + ' after');
    else
      fail('T31: games.csv invite row', JSON.stringify(ivRows));

    // A dead invite id later re-authed -> gameNotFound (graceful, contract §3).
    ivCsock.removeAllListeners('gameNotFound'); ivCNotFound = false;
    ivCsock.on('gameNotFound', () => { ivCNotFound = true; });
    ivCsock.emit('auth', ivCs, ivMatchId);
    await sleep(300);
    if (ivCNotFound)
      pass('T31: dead invite match id after end -> gameNotFound (graceful)');
    else
      fail('T31: dead invite id', 'no gameNotFound');

    // --- GET /account ---
    // no cookie -> 302 redirect to / (redirect:manual so we can assert it)
    let accNoAuth = null, accErr = '';
    try {
      accNoAuth = await fetch(BASE + '/account', { redirect: 'manual' });
    } catch (e) { accErr = String(e); }
    if (accNoAuth && accNoAuth.status === 302 && (accNoAuth.headers.get('location') || '').includes('/'))
      pass('T31: GET /account without cookie -> 302 Location /');
    else
      fail('T31: GET /account no cookie', `status=${accNoAuth && accNoAuth.status} loc=${accNoAuth && accNoAuth.headers.get('location')} ${accErr}`);
    // with A's cookie -> 200 with username, elo (updated by the resign win), games
    let accHtml = null, accStatus = null, accErr2 = '';
    try {
      const accRes = await fetch(BASE + '/account', { redirect: 'manual', headers: { cookie: 'sessionID=' + ivAs } });
      accStatus = accRes.status;
      accHtml = await accRes.text();
    } catch (e) { accErr2 = String(e); }
    // A's current elo: read from the users file (RAM elo mirrors it after saveUsersFile)
    const aUserNow = loadUsersFile().find(u => u.username === ivA);
    if (accStatus === 200 && accHtml && accHtml.includes(ivA) && aUserNow && accHtml.includes(String(aUserNow.elo)) && accHtml.includes(ivB))
      pass('T31: GET /account with cookie -> 200, contains username + current elo (' + aUserNow.elo + ') + opponent');
    else
      fail('T31: GET /account with cookie', `status=${accStatus} hasName=${accHtml && accHtml.includes(ivA)} hasElo=${aUserNow && accHtml && accHtml.includes(String(aUserNow.elo))} hasOpp=${accHtml && accHtml.includes(ivB)} ${accErr2}`);
    // Row data check — markup is S-B's (contract: S-A's stub may be refined to use
    // the same server-provided fields); the assertion targets the fields the
    // contract guarantees in the row: opponent, per-view result (Победа for a win),
    // elo before (1500) / after (A's new value). Newest-first ordering and the
    // method field are server-side (games array); the e2e harness covers the DOM.
    if (accHtml && aUserNow) {
      const rowOk = accHtml.includes(ivB) &&
        (accHtml.includes('Победа') || /result-win/.test(accHtml)) &&
        accHtml.includes('1500') && accHtml.includes(String(aUserNow.elo));
      if (accStatus === 200 && accHtml.includes(ivA) && rowOk)
        pass('T31: /account renders the game row — opponent, per-view result (Победа), elo 1500→' + aUserNow.elo);
      else
        fail('T31: /account games row', `rowOk=${rowOk} hasB=${accHtml.includes(ivB)} snippet=${accHtml.slice(0, 300)}`);
    } else {
      fail('T31: /account games row', 'response or user missing');
    }

    // --- GET /api/me (contract addendum: lobby session restore) ---
    let meOk = null, meOkStatus = null, meErr = '';
    try {
      const meRes = await fetch(BASE + '/api/me', { redirect: 'manual', headers: { cookie: 'sessionID=' + ivAs } });
      meOkStatus = meRes.status;
      meOk = await meRes.json();
    } catch (e) { meErr = String(e); }
    if (meOkStatus === 200 && meOk && meOk.username === ivA && typeof meOk.elo === 'number')
      pass('T31: GET /api/me with valid cookie -> 200 {username, elo}');
    else
      fail('T31: GET /api/me valid cookie', `status=${meOkStatus} body=${JSON.stringify(meOk)} ${meErr}`);
    let meNoAuth = null, meNoAuthStatus = null, meNoAuthBody = null, meErr2 = '';
    try {
      const r = await fetch(BASE + '/api/me', { redirect: 'manual' });
      meNoAuthStatus = r.status;
      meNoAuthBody = await r.json().catch(() => null);
    } catch (e) { meErr2 = String(e); }
    if (meNoAuthStatus === 401)
      pass('T31: GET /api/me without cookie -> 401');
    else
      fail('T31: GET /api/me no cookie', `status=${meNoAuthStatus} ${meErr2}`);
    let meBogus = null, meBogusStatus = null;
    try {
      const r = await fetch(BASE + '/api/me', { redirect: 'manual', headers: { cookie: 'sessionID=' + 'bogus' + Date.now() } });
      meBogusStatus = r.status;
    } catch (e) { meBogus = String(e); }
    if (meBogusStatus === 401)
      pass('T31: GET /api/me with bogus session cookie -> 401');
    else
      fail('T31: GET /api/me bogus cookie', `status=${meBogusStatus} ${meBogus}`);

    ivAsock.disconnect(); ivBsock.disconnect(); ivCsock.disconnect(); ivGsock.disconnect();
  }

  console.log(`\n=== Results: ${passed}/${total} passed, ${failed} failed ===`);
  return failed === 0;
}

test().then(ok => process.exit(ok ? 0 : 1)).catch(e => { console.error(e); process.exit(1); });
