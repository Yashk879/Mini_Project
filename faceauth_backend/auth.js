// Passwords (scrypt) and login tokens (JWT).
require('dotenv').config();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { fail } = require('./helpers');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET is missing. Copy .env.example to .env and set it.');

// Store "salt:hash". The real password is never saved.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const signToken = t => jwt.sign({ id: t.id, role: t.role, department: t.department }, SECRET, { expiresIn: '8h' });

// Middleware: every protected route runs this first and gets req.user.
function auth(req, res, next) {
  try {
    req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET);
    next();
  } catch {
    fail(401, 'Please sign in again.');
  }
}
// Middleware: only the department HOD may continue.
const hodOnly = (req, res, next) => req.user.role === 'hod' ? next() : fail(403, 'Only the department HOD can do this.');

module.exports = { hashPassword, verifyPassword, signToken, auth, hodOnly };
