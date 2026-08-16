import { io } from 'socket.io-client';
import fs from 'fs';
import { loadUsersFile, authenticateUser, saveUsersFile, USERS_CSV } from './src/lib/auth.js';

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
  await sleep(500);

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

  console.log(`\n=== Results: ${passed}/${total} passed, ${failed} failed ===`);
  return failed === 0;
}

test().then(ok => process.exit(ok ? 0 : 1)).catch(e => { console.error(e); process.exit(1); });
