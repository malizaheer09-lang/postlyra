// socialAccountsDb.js
//
// Stores OAuth access tokens for each user's connected social accounts.
// Same JSON-file approach as db.js and uploadsDb.js — swap for a real
// database (Postgres etc.) before going to production, since tokens are
// sensitive credentials and a flat file isn't safe at scale.
//
// IMPORTANT: In production, encrypt tokens at rest before storing them.
// For now they're stored in plaintext, which is fine for local testing
// but not for a server with real users.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'social_accounts.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ACCOUNTS_FILE)) fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify([], null, 2));
}

function readAccounts() {
  ensureStore();
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8')); }
  catch { return []; }
}

function writeAccounts(accounts) {
  ensureStore();
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

// Save or update a connected account for a user.
function upsertAccount({ userId, provider, providerAccountId, accessToken, refreshToken, expiresAt, accountName, accountType }) {
  const accounts = readAccounts();
  const existingIndex = accounts.findIndex(
    (a) => a.userId === userId && a.provider === provider && a.providerAccountId === providerAccountId
  );
  const record = { userId, provider, providerAccountId, accessToken, refreshToken: refreshToken || null, expiresAt: expiresAt || null, accountName, accountType, connectedAt: new Date().toISOString() };
  if (existingIndex >= 0) {
    accounts[existingIndex] = record;
  } else {
    accounts.push(record);
  }
  writeAccounts(accounts);
  return record;
}

function getAccountsByUser(userId) {
  return readAccounts().filter((a) => a.userId === userId);
}

function getAccount(userId, provider, providerAccountId) {
  return readAccounts().find(
    (a) => a.userId === userId && a.provider === provider && a.providerAccountId === providerAccountId
  ) || null;
}

function deleteAccount(userId, provider, providerAccountId) {
  const accounts = readAccounts();
  const filtered = accounts.filter(
    (a) => !(a.userId === userId && a.provider === provider && a.providerAccountId === providerAccountId)
  );
  writeAccounts(filtered);
  return filtered.length < accounts.length;
}

// Strip the access token before sending to the client — the frontend
// only needs to know which accounts are connected, not the raw tokens.
function toPublicAccount(account) {
  const { accessToken, refreshToken, ...pub } = account;
  return pub;
}

module.exports = { upsertAccount, getAccountsByUser, getAccount, deleteAccount, toPublicAccount };
