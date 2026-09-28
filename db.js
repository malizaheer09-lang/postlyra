// db.js
//
// A tiny file-based datastore so this project runs with zero external
// services. It is fine for development and small deployments, but it is
// NOT safe for concurrent writes at scale. When you're ready to go to
// production, swap the functions below for calls to a real database
// (Postgres, MySQL, etc.) — the rest of the app only talks to this file,
// so that's the only place you'd need to change.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
  }
}

function readUsers() {
  ensureStore();
  const raw = fs.readFileSync(USERS_FILE, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeUsers(users) {
  ensureStore();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function findUserByEmail(email) {
  const normalized = email.trim().toLowerCase();
  return readUsers().find((u) => u.email === normalized) || null;
}

function findUserById(id) {
  return readUsers().find((u) => u.id === id) || null;
}

function createUser({ businessName, email, passwordHash }) {
  const users = readUsers();
  const user = {
    id: crypto.randomUUID(),
    businessName,
    email: email.trim().toLowerCase(),
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeUsers(users);
  return user;
}

// Strip the password hash before sending a user object to the client.
function toPublicUser(user) {
  if (!user) return null;
  const { passwordHash, ...publicFields } = user;
  return publicFields;
}

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  toPublicUser,
};
