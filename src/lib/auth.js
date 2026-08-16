import crypto from 'crypto';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';

// F1: user persistence in users.csv (username,password_hash,elo).
// DATA_DIR is overridable via env (tests point it at a tmp dir); in the
// container the Dockerfile creates /app/data and the compose file binds
// a named volume to it.
export const DATA_DIR = process.env.DATA_DIR || '/app/data';
export const USERS_CSV = path.join(DATA_DIR, 'users.csv');
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
        return [1, session.id];
      }
    }
  }
  return [0, null];
}

export let validateSession = (users, sessionID) => {
  for (let user of users) {
    for (let session of user.sessions) {
      if (session.id === sessionID) {
        if (new Date(session.expires) > new Date()) {
          return user;
        } else {
          // expired — remove it
          user.sessions = user.sessions.filter(s => s.id !== sessionID);
          return null;
        }
      }
    }
  }
  return null;
}

// F1: atomic write — temp file in the same directory, then rename.
export function atomicWriteFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
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
    return -2;
  }

  // check if user is created
  for (let user of users) {
    if (user.username === username) {
      return 0;
    }
  }

  // check if password is non empty
  if (password.length <= 0) {
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

  return 1;
}
