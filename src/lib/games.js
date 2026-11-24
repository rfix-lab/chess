import fs from 'fs';
import path from 'path';
import { DATA_DIR, atomicWriteFile } from './auth.js';
import { log } from './debuglog.js';

// T31 (contract 32, Storage): games.csv — append-only game history in DATA_DIR
// (same volume as users.csv). Header:
//   ts,white,black,result,reason,white_elo_before,white_elo_after,black_elo_before,black_elo_after[,method]
//   ts      ISO timestamp of the endMatch
//   white/black  username or '-' (guest)
//   result  white-win | black-win | draw
//   reason  the endMatch reason string (checkmate / resign / draw / timeout / ...)
//   *_elo_before  elo read from the users.csv file BEFORE the K-factor update
//   *_elo_after   elo re-read from the users.csv file AFTER the K-factor update
//   method  T33 (contract 36): optional 10th column, 'standard' | 'rapid'.
//           Legacy files lack the column; loadGames() defaults to 'standard'.
// Guests (elo untouched) keep 0 in the elo columns — they are not in users.csv.
// One row per completed game IF at least one side is registered; guest-vs-guest
// games are skipped entirely. Appended from endMatch exactly once (the match is
// spliced out of the pool before the next endMatch, so the gameEnded guard holds).
export const GAMES_CSV = path.join(DATA_DIR, 'games.csv');
// Legacy 9-column header — pre-contract-36 files (see T33 note below).
export const GAMES_CSV_HEADER_LEGACY =
  'ts,white,black,result,reason,white_elo_before,white_elo_after,black_elo_before,black_elo_after';
// T33 (contract 36): an OPTIONAL trailing `method` column (10th) was appended
// to the header. Pre-T33 files keep the old 9-column header and rows; the
// loader defaults a missing value to 'standard' (backward compatible).
export const GAMES_CSV_HEADER =
  'ts,white,black,result,reason,white_elo_before,white_elo_after,black_elo_before,black_elo_after,method';
// T33: allowed game methods; 'standard' is the default for legacy rows.
export const GAME_METHODS = ['standard', 'rapid'];

// Append one game row. Missing file -> materialize the header row first
// (same missing-file semantics as loadUsersFile in auth.js).
export function appendGameRow(row, file = GAMES_CSV) {
  let lines = null;
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim().length > 0);
  } catch (e) {
    lines = null;
  }
  let out = '';
  if (!lines || lines.length === 0) {
    out = GAMES_CSV_HEADER;
  } else if (lines[0] !== GAMES_CSV_HEADER && lines[0] !== GAMES_CSV_HEADER_LEGACY) {
    // A file without the expected header (shouldn't happen — we always write
    // it) — keep it parseable by putting the header first.
    log('games: header missing/mismatch, prepending', JSON.stringify(lines[0]));
    out = GAMES_CSV_HEADER + '\n' + lines.join('\n');
  } else {
    out = lines.join('\n');
  }
  const line = [
    row.ts,
    row.white || '-',
    row.black || '-',
    row.result,
    row.reason,
    String(row.whiteEloBefore),
    String(row.whiteEloAfter),
    String(row.blackEloBefore),
    String(row.blackEloAfter),
    (row.method && row.method !== 'standard') ? row.method : 'standard'
  ].join(',');
  atomicWriteFile(file, out + '\n' + line + '\n');
}

// Parse games.csv into row objects (newest last, file order). Missing file -> [].
// Used by GET /account. Fields mirror the CSV columns; elo values are numbers.
export function loadGames(file = GAMES_CSV) {
  let rows = [];
  try {
    rows = fs.readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(l => l.length > 0);
  } catch (e) {
    return [];
  }
  if (rows.length === 0) return [];
  const hasHeader = rows[0] === GAMES_CSV_HEADER || rows[0] === GAMES_CSV_HEADER_LEGACY;
  const data = hasHeader ? rows.slice(1) : rows;
  const games = [];
  for (const row of data) {
    const parts = row.split(',');
    if (parts.length < 9) continue;
    const white = parts[1];
    const black = parts[2];
    const wBefore = Number(parts[5]);
    const wAfter = Number(parts[6]);
    const bBefore = Number(parts[7]);
    const bAfter = Number(parts[8]);
    // T33: optional 10th column — legacy rows (9 fields) default to 'standard'.
    // An out-of-alphabet value is kept verbatim (never happens with the T33
    // method-na gate) so historical rows stay visible.
    const method = (parts.length >= 10 && parts[9]) ? parts[9] : 'standard';
    games.push({
      ts: parts[0],
      white: white === '-' ? null : white,
      black: black === '-' ? null : black,
      result: parts[3],
      reason: parts[4],
      method: method,
      whiteEloBefore: Number.isFinite(wBefore) ? wBefore : 0,
      whiteEloAfter: Number.isFinite(wAfter) ? wAfter : 0,
      blackEloBefore: Number.isFinite(bBefore) ? bBefore : 0,
      blackEloAfter: Number.isFinite(bAfter) ? bAfter : 0
    });
  }
  return games;
}
