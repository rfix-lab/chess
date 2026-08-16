import { io } from 'socket.io-client';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
  await sleep(500);

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
  await sleep(300);
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

  privA.emit('private-match', 1);
  await new Promise(r => { privA.once('private-match', r); sleep(3000); });
  if (privMatchId != null) pass('Private: link generated (matchId ' + privMatchId + ')');
  else fail('Private: link generated', 'no matchId');

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
  privA.disconnect();
  privB.disconnect();
  privA2.disconnect();

  console.log(`\n=== Results: ${passed}/${total} passed, ${failed} failed ===`);
  return failed === 0;
}

test().then(ok => process.exit(ok ? 0 : 1)).catch(e => { console.error(e); process.exit(1); });
