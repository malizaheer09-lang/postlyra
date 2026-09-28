// routes/auth.js

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { findUserByEmail, createUser, toPublicUser } = require('../db');
const authenticate = require('../middleware/authenticate');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL = '7d';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isStrongPassword(password) {
  // At least 8 chars, one letter, one number — matches the strength
  // indicator described in the product spec.
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    /[A-Za-z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

// POST /api/auth/signup
router.post('/signup', (req, res) => {
  const { businessName, email, password, confirmPassword, agreedToTerms } = req.body || {};

  if (!businessName || !businessName.trim()) {
    return res.status(400).json({ error: 'Business name is required.' });
  }
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (!isStrongPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include a letter and a number.' });
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  if (agreedToTerms !== undefined && !agreedToTerms) {
    return res.status(400).json({ error: 'You must agree to the Terms of Service.' });
  }
  if (findUserByEmail(email)) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const user = createUser({ businessName: businessName.trim(), email, passwordHash });

  issueSession(res, user);
  return res.status(201).json({ user: toPublicUser(user) });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = findUserByEmail(email);
  const passwordMatches = user && bcrypt.compareSync(password, user.passwordHash);

  if (!passwordMatches) {
    // Deliberately generic — don't reveal whether the email exists.
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  issueSession(res, user);
  return res.json({ user: toPublicUser(user) });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  return res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  return res.json({ user: req.user });
});

// POST /api/auth/forgot-password
// Stub: in production this would email a reset link via a provider like
// Resend/SendGrid/SES. Always returns a generic success message so the
// endpoint can't be used to check which emails are registered.
router.post('/forgot-password', (req, res) => {
  const { email } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  // TODO: generate a reset token, store it with an expiry, and email it.
  return res.json({ ok: true, message: 'If that email is registered, a reset link is on its way.' });
});

module.exports = router;
