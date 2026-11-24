import fs from 'fs';
import path from 'path';
import { DATA_DIR, atomicWriteFile } from './auth.js';
import { matches } from './matchmaking.js';
import { log } from './debuglog.js';

// T31 (contract 32, Storage): invites.json — [{ "to": username, "from":
// username, "fromElo": int, "method": "standard", "matchId": "xxxxxxxx",
// "createdAt": iso }]. Same load-at-startup + lazy-persist pattern as
// sessions.json in auth.js (the users array lives in index.js; here we only
// manage the invite records). The match itself lives ONLY in RAM (the
// matches pool in matchmaking.js): an accept after a server restart lands on
// the existing gameNotFound path (graceful) — the record stays in the file,
// listLiveInvitesTo filters it out of the payload because its match is dead.
export const INVITES_FILE = path.join(DATA_DIR, 'invites.json');

export function loadInvitesFile(file = INVITES_FILE) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return []; // missing/corrupt file -> start empty
  }
}

export function saveInvitesFile(invites, file = INVITES_FILE) {
  atomicWriteFile(file, JSON.stringify(invites));
}

let invites = loadInvitesFile();
log('invites: loaded from disk count=', invites.length);

// Add an invite record to RAM + persist (atomic rewrite of the small file).
// `invite` must carry {to, from, fromElo, method, matchId}; createdAt is
// stamped here so callers do not build the ISO string themselves.
export function createInvite(invite, file = INVITES_FILE) {
  const record = Object.assign({}, invite, { createdAt: new Date().toISOString() });
  invites.push(record);
  saveInvitesFile(invites, file);
  return record;
}

// Find the stored invite record bound to a match (one invite per match at a
// time; matches created via plain private-match have no record -> null).
export function getInviteByMatch(matchId) {
  return invites.find(i => i && i.matchId === matchId) || null;
}

// All stored invite records addressed to a username.
export function getInviteTo(username) {
  return invites.filter(i => i && i.to === username);
}

// Drop stored records whose match is gone (used by tests / optional GC;
// listLiveInvitesTo already hides them from the payload, so the record stays
// unless explicitly removed).
export function removeInviteByMatch(matchId, file = INVITES_FILE) {
  const before = invites.length;
  invites = invites.filter(i => !i || i.matchId !== matchId);
  if (invites.length !== before) saveInvitesFile(invites, file);
}

// Stored invites addressed to `username` that still reference a LIVE match
// (payload shape for the `invites` event): [{from, fromElo, method, matchId,
// createdAt}]. A match that disappeared (server restart, pre-start disconnect
// ending it) drops out of the payload — the stored record is kept, per the
// contract. The matches pool is read from matchmaking.js (single source of
// truth; a match is live while it is pooled and not gameEnded).
export function listLiveInvitesTo(username) {
  const liveMatchIds = new Set();
  for (const m of matches) {
    if (m && !m.private) continue;
    if (m.gameEnded) continue;
    liveMatchIds.add(m.matchId);
  }
  const out = [];
  for (const i of invites) {
    if (!i || i.to !== username) continue;
    if (!liveMatchIds.has(i.matchId)) continue;
    out.push({ from: i.from, fromElo: i.fromElo, method: i.method, matchId: i.matchId, createdAt: i.createdAt });
  }
  return out;
}
