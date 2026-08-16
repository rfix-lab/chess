import crypto from 'crypto';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { log } from './debuglog.js';

// F1: user persistence in users.csv (username,password_hash,elo).
// DATA_DIR is overridable via env (tests point it at a tmp dir); in the
// container the Dockerfile creates /app/data and the compose file binds
// a named volume to it.
export const DATA_DIR = process.env.DATA_DIR || '/app/data';
export const USERS_CSV = path.join(DATA_DIR, 'users.csv');
export const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
export const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
export const START_ELO = 1500;

let generateSessionID = () => {
  return crypto.randomBytes(16).toString('hex');
};

export let authenticateUser = async (users, username, password) => {
  for (let user of users) {
    if (user.username === username) {
      const match = await bcrypt.compare(password, user.password);
      if (match) {
        let session = {
          id: generateSessionID(),
          expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        }
        user.sessions.push(session);
        persistUserSessions(users);
        log('auth signin OK username=', username);
        return [1, session.id];
      }
    }
  }
  log('auth signin FAIL reason=wrong-password username=', username);
  return [0, null];
}

export let validateSession = (users, sessionID) => {
  for (let user of users) {
    for (let session of user.sessions) {
      if (session.id === sessionID) {
        if (new Date(session.expires) > new Date()) {
          log('auth validateSession OK username=', user.username);
          return user;
        } else {
          // expired — remove it (from RAM and from sessions.json)
          user.sessions = user.sessions.filter(s => s.id !== sessionID);
          persistUserSessions(users);
          log('auth validateSession FAIL reason=expired username=', user.username);
          return null;
        }
      }
    }
  }
  log('auth validateSession FAIL reason=unknown-session');
  return null;
}

// F1: atomic write — temp file in the same directory, then rename.
export function atomicWriteFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// B6: session persistence in sessions.json — [{id, username, expires(ISO string)}].
// This is the ONLY place user.sessions mutates (authenticateUser / validateSession),
// so these three helpers + persistUserSessions cover the whole lifecycle.
export function loadSessionsFile(file = SESSIONS_FILE) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return []; // missing/corrupt file -> start empty
  }
}

export function saveSessionsFile(entries, file = SESSIONS_FILE) {
  atomicWriteFile(file, JSON.stringify(entries));
}

export function attachSessionsToUsers(users, entries) {
  // Attach live sessions to the loaded users. Prune: expired entries are not
  // attached (and thus drop out of the file on the next persistUserSessions).
  const now = new Date();
  for (const entry of entries) {
    if (!entry || !entry.id || !entry.username || !entry.expires) continue;
    const user = users.find(u => u.username === entry.username);
    if (!user) continue;
    if (new Date(entry.expires) > now) {
      user.sessions.push({ id: entry.id, expires: entry.expires });
    }
  }
}

// Rebuild the flat entries array from the in-RAM users and write it atomically.
function persistUserSessions(users) {
  const entries = [];
  for (const u of users) {
    for (const s of u.sessions) {
      entries.push({
        id: s.id,
        username: u.username,
        expires: s.expires instanceof Date ? s.expires.toISOString() : s.expires
      });
    }
  }
  saveSessionsFile(entries);
}

export function loadUsersFile(file = USERS_CSV) {
  // Returns the users array loaded from the CSV (sessions start empty).
  // Missing file/dir -> create both with the header row and return [].
  let rows = [];
  try {
    const text = fs.readFileSync(file, 'utf8');
    rows = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  } catch (e) {
    rows = [];
  }
  let users = [];
  const hasHeader = rows.length > 0 && rows[0] === 'username,password_hash,elo';
  const dataRows = hasHeader ? rows.slice(1) : rows;
  for (const row of dataRows) {
    // The bcrypt hash and the allowed username charset never contain commas,
    // so a plain split is safe here.
    const parts = row.split(',');
    if (parts.length < 2) continue;
    const username = parts[0];
    const hash = parts[1];
    const elo = Number(parts[2]);
    if (!username || !hash) continue;
    users.push({
      username: username,
      password: hash,
      sessions: [],
      elo: Number.isFinite(elo) ? elo : START_ELO
    });
  }
  // Missing file (or file with no data) -> materialize the header row.
  if (rows.length === 0) {
    atomicWriteFile(file, 'username,password_hash,elo\n');
  }
  return users;
}

export function saveUsersFile(users, file = USERS_CSV) {
  let out = 'username,password_hash,elo\n';
  for (const u of users) {
    out += `${u.username},${u.password},${Number(u.elo) || START_ELO}\n`;
  }
  atomicWriteFile(file, out);
}

export function findUserByName(users, username) {
  return users.find(u => u.username === username) || null;
}

// signup codes: 1=ok, 0=username taken, -1=empty password, -2=invalid username.
export let signupUser = async (users, username, password) => {
  if (!USERNAME_RE.test(username)) {
    log('auth signup FAIL reason=invalid-username username=', JSON.stringify(username));
    return -2;
  }

  // check if user is created
  for (let user of users) {
    if (user.username === username) {
      log('auth signup FAIL reason=username-taken username=', username);
      return 0;
    }
  }

  // check if password is non empty
  if (password.length <= 0) {
    log('auth signup FAIL reason=empty-password username=', JSON.stringify(username));
    return -1;
  }

  const hashed = await bcrypt.hash(password, 10);

  const user = {
    username: username,
    password: hashed,
    sessions: [],
    elo: START_ELO
  };

  users.push(user);

  // F1: persist immediately (atomic append == full rewrite of the small file).
  saveUsersFile(users);

  log('auth signup OK username=', username, 'elo=', user.elo);
  return 1;
}
