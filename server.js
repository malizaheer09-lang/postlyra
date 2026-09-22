// server.js

require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/uploads');
const socialRoutes = require('./routes/social');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('replace_this')) {
  console.warn(
    '\n⚠️  JWT_SECRET is missing or still the placeholder value.\n' +
    '   Set a real secret in .env before deploying anywhere public.\n' +
    '   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
  );
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/', socialRoutes); // handles /auth/meta, /auth/google, /api/social/*

// Friendly JSON 404 for unmatched API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Catch-all error handler. Without this, errors thrown inside middleware
// (e.g. multer rejecting a bad file) bubble up to Express's default
// handler, which sends back a raw stack trace — fine for us to see in the
// terminal, not fine to show a user in the browser.
app.use((err, req, res, next) => {
  console.error(err);

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That file is larger than 15MB.' });
  }

  const status = err.status || 400;
  return res.status(status).json({ error: err.message || 'Something went wrong.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Postlyra server running on port ${PORT}`);
});

// Without these, one unexpected error anywhere in the app (a network hiccup
// deep inside a library, for example) can silently crash the entire server
// — every user gets "could not reach the server" until someone notices the
// terminal window has gone quiet and restarts it manually. These keep the
// server itself alive no matter what; the specific request that triggered
// the error still fails (and gets logged below), but everything else
// keeps working.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (server is still running):', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection (server is still running):', err);
});
