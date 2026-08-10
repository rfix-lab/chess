import crypto from 'crypto';
import bcrypt from 'bcrypt';

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

export let signupUser = async (users, username, password) => {
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

  users.push({
    username: username,
    password: hashed,
    sessions: []
  });

  return 1;
}