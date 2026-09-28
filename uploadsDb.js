// uploadsDb.js
//
// Same idea as db.js — a simple JSON file so this works with zero external
// services. Swap for a real database alongside db.js when you move to
// production.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_FILE = path.join(DATA_DIR, 'uploads.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_FILE)) {
    fs.writeFileSync(UPLOADS_FILE, JSON.stringify([], null, 2));
  }
}

function readUploads() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(UPLOADS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeUploads(uploads) {
  ensureStore();
  fs.writeFileSync(UPLOADS_FILE, JSON.stringify(uploads, null, 2));
}

function createUpload({ id, userId, originalFilename, platformVersions, captions }) {
  const uploads = readUploads();
  const upload = {
    id: id || crypto.randomUUID(),
    userId,
    originalFilename,
    platformVersions, // [{ platformId, filename, width, height }]
    captions, // { platformId: { caption, hashtags } }
    createdAt: new Date().toISOString(),
  };
  uploads.push(upload);
  writeUploads(uploads);
  return upload;
}

function listUploadsByUser(userId) {
  return readUploads()
    .filter((u) => u.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function findUploadById(uploadId) {
  return readUploads().find((u) => u.id === uploadId) || null;
}

function deleteUpload(uploadId, userId) {
  const uploads = readUploads();
  const record = uploads.find((u) => u.id === uploadId && u.userId === userId);
  if (!record) return false;
  writeUploads(uploads.filter((u) => u.id !== uploadId));
  return true;
}

module.exports = { createUpload, listUploadsByUser, findUploadById, deleteUpload };
