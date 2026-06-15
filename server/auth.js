// Authenticatie: wachtwoord-hashing met scrypt (ingebouwd in Node, geen dependency)
// en sessies via een cookie-token dat in de database staat.
import crypto from 'node:crypto';
import { db, id, now, saveSoon } from './db.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db().sessions.push({ token, userId, createdAt: now() });
  saveSoon();
  return token;
}

export function destroySession(token) {
  const sessions = db().sessions;
  const i = sessions.findIndex((s) => s.token === token);
  if (i >= 0) sessions.splice(i, 1);
  saveSoon();
}

export function userFromToken(token) {
  if (!token) return null;
  const session = db().sessions.find((s) => s.token === token);
  if (!session) return null;
  return db().users.find((u) => u.id === session.userId) || null;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > -1) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  });
  return out;
}

// Express-middleware: zet req.user op basis van het sessie-cookie.
export function attachUser(req, res, next) {
  const cookies = parseCookies(req);
  req.user = userFromToken(cookies.sid);
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Niet ingelogd' });
  next();
}

// Alleen toegankelijk voor bepaalde rollen (admin, assistent, monteur).
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Niet ingelogd' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Geen toegang voor jouw rol' });
    }
    next();
  };
}

export function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

export function createUser({ name, email, password, role, monteurId }) {
  const user = {
    id: id('user'),
    name,
    email: (email || '').toLowerCase(),
    role: role || 'assistent',
    monteurId: monteurId || null, // koppeling naar een monteur-record (alleen voor rol 'monteur')
    passwordHash: hashPassword(password),
    createdAt: now(),
  };
  db().users.push(user);
  saveSoon();
  return user;
}
