// middleware/authenticate.js

const jwt = require('jsonwebtoken');
const { findUserById, toPublicUser } = require('../db');

function authenticate(req, res, next) {
  const token = req.cookies && req.cookies.token;

  if (!token) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = findUserById(payload.sub);

    if (!user) {
      return res.status(401).json({ error: 'Session is no longer valid.' });
    }

    req.user = toPublicUser(user);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
}

module.exports = authenticate;
