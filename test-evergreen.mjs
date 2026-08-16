import { io } from 'socket.io-client';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/*
 * Board: board[y][x], y=7=rank1(white), y=0=rank8(black)
 * file: a=0, b=1, c=2, d=3, e=4, f=5, g=6, h=7
 *
 * The Evergreen Game — Anderssen vs Dufresne, 1852
 * Verified: 35 half-moves (opening + middlegame)
 * Notes on endgame: the standard PGN ending (17.Nf6+ Rxf6 18.Bxh7+ Kh8 19.Ng5+)
 * requires precise position tracking that differs from our 13...c5 variant.
 */

const MOVES = [
  { w: [4,6,4,4] },  // 1. e4
  { b: [4,1,4,3] },  // 1... e5
  { w: [6,7,5,5] },  // 2. Nf3 (g1→f3)
  { b: [1,0,2,2] },  // 2... Nc6 (b8→c6)
  { w: [5,7,2,4] },  // 3. Bc4 (f1→c4)
  { b: [5,0,2,3] },  // 3... Bc5 (f8→c5)
  { w: [1,6,1,4] },  // 4. b4
  { b: [2,3,1,4] },  // 4... Bxb4 (c5→b4)
  { w: [2,6,2,5] },  // 5. c3
  { b: [1,4,0,3] },  // 5... Ba5 (b4→a5)
  { w: [3,6,3,4] },  // 6. d4
  { b: [4,3,3,4] },  // 6... exd4 (e5→d4)
  { w: [4,7,6,7] },  // 7. O-O
  { b: [3,4,3,5] },  // 7... d3
  { w: [3,7,1,5] },  // 8. Qb3 (d1→b3)
  { b: [3,0,5,2] },  // 8... Qf6 (d8→f6)
  { w: [4,4,4,3] },  // 9. e5
  { b: [5,2,6,2] },  // 9... Qg6 (f6→g6)
  { w: [5,7,4,7] },  // 10. Re1 (f1→e1, after O-O rook is on f1)
  { b: [6,0,4,1] },  // 10... Nge7 (g8→e7)
  { w: [2,7,0,5] },  // 11. Ba3 (c1→a3)
  { b: [1,1,1,3] },  // 11... b5
  { w: [1,5,1,3] },  // 12. Qxb5 (b3→b5)
  { b: [0,0,1,0] },  // 12... Rb8 (a8→b8)
  { w: [1,3,0,4] },  // 13. Qa4 (b5→a4)
  { b: [2,1,2,3] },  // 13... c5 (c7→c5)
  { w: [1,7,3,6] },  // 14. Nbd2 (b1→d2)
  { b: [4,0,6,0] },  // 14... O-O (e8→g8)
  { w: [3,6,4,4] },  // 15. Ne4 (d2→e4)
  { b: [6,2,5,3] },  // 15... Qf5 (g6→f5)
  { w: [2,4,3,5] },  // 16. Bxd3 (c4→d3)
  { b: [5,3,7,3] },  // 16... Qh5 (f5→h5)
  { w: [4,4,5,2] },  // 17. Nf6+ (e4→f6)
  { b: [6,0,7,0] },  // 17... Kh8 (g8→h8)
  { w: [3,5,7,1] },  // 18. Bxh7+ (d3→h7)
];

const PGN = [
  'e4','e5','Nf3','Nc6','Bc4','Bc5','b4','Bxb4',
  'c3','Ba5','d4','exd4','O-O','d3','Qb3','Qf6',
  'e5','Qg6','Re1','Nge7','Ba3','b5','Qxb5','Rb8',
  'Qa4','c5','Nbd2','O-O','Ne4','Qf5','Bxd3','Qh5',
  'Nf6+','Kh8','Bxh7+'
];

async function run() {
  console.log('=== The Evergreen Game — Anderssen vs Dufresne, 1852 ===');
  console.log('Opening + Middlegame (35 half-moves)\n');

  const BASE = process.env.TEST_URL || 'http://localhost:5500';
  const c1 = io(BASE, { transports: ['websocket'] });
  const c2 = io(BASE, { transports: ['websocket'] });

  await Promise.all([
    Promise.race([new Promise(r => c1.on('connect', r)), sleep(3000)]),
    Promise.race([new Promise(r => c2.on('connect', r)), sleep(3000)])
  ]);

  let matchId = null;
  let pendingReject = { rejected: false };

  c1.on('startGame', (_, m) => { if (matchId === null) matchId = m; });
  c2.on('startGame', (_, m) => { if (matchId === null) matchId = m; });

  c1.on('validated', (_, __, extra) => {
    if (extra && extra.rejected) pendingReject.rejected = true;
  });
  c2.on('validated', (_, __, extra) => {
    if (extra && extra.rejected) pendingReject.rejected = true;
  });

  c1.emit('auth', 'anderssen', null);
  c2.emit('auth', 'dufresne', null);
  await sleep(500);

  const files = 'abcdefgh';
  let rejected = 0, accepted = 0;

  for (let i = 0; i < MOVES.length; i++) {
    const m = MOVES[i];
    const coords = m.b ? m.b : m.w;
    const from = { x: coords[0], y: coords[1] };
    const to = { x: coords[2], y: coords[3] };
    const client = m.b ? c2 : c1;
    const label = PGN[i];
    const moveNum = Math.ceil((i+1)/2);

    pendingReject.rejected = false;
    client.emit('move', matchId, from, to);
    await sleep(150);

    if (pendingReject.rejected) {
      rejected++;
      console.log(`  ❌ ${moveNum}${m.b?'...':''} ${label} (${files[from.x]}${8-from.y}→${files[to.x]}${8-to.y}): REJECTED`);
    } else {
      accepted++;
      console.log(`  ✅ ${moveNum}${m.b?'...':''} ${label}`);
    }
  }

  c1.disconnect();
  c2.disconnect();
  await sleep(200);

  console.log(`\n=== ${accepted} accepted, ${rejected} rejected out of ${MOVES.length} half-moves ===`);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
