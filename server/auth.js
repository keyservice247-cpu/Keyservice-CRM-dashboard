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

// Sessies verlopen na 30 dagen en verlopen exemplaren worden opgeruimd (audit 18
// aug): eerder bleef een gelekt cookie eeuwig geldig en groeide de lijst onbegrensd.
const SESSIE_DAGEN = 30;
export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const nu = Date.now();
  db().sessions = (db().sessions || []).filter((s) => !s.expiresAt || new Date(s.expiresAt).getTime() > nu);
  db().sessions.push({ token, userId, createdAt: now(), expiresAt: new Date(nu + SESSIE_DAGEN * 86400000).toISOString() });
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
  if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) return null; // verlopen
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

// ---------- Rechten (per gebruiker aan/uit te zetten) ----------
// De rol is het BASISPROFIEL; per gebruiker kan de beheerder losse functies
// aan- of uitzetten (user.perms = { sleutel: true/false }). Geen override
// ingesteld? Dan geldt de standaard van de rol hieronder. De beheerder heeft
// altijd alles (kan zichzelf nooit buitensluiten).
export const PERM_KEYS = [
  'inbox',        // Inbox/AI-wachtrij behandelen (goedkeuren/afwijzen)
  'orders',       // Opdrachten aanmaken/bewerken/samenvoegen
  'deleteOrders', // Opdrachten naar de prullenbak verplaatsen/terugzetten
  'customers',    // Klanten & monteurs beheren (bewerken/samenvoegen)
  'invoicesAll',  // Alle facturen & offertes zien (uit = alleen eigen)
  'finance',      // Cijfers (omzet/kosten/winst) bekijken & boeken
  'system',       // AI-controle & Abonnementen (systeembewaking) bekijken
  'settings',     // Instellingen wijzigen
  'hardDelete',   // Definitief verwijderen (prullenbak/afgewezen legen)
];
export const ROLE_PERM_DEFAULTS = {
  admin:     { inbox: true,  orders: true,  deleteOrders: true,  customers: true,  invoicesAll: true,  finance: true,  system: true,  settings: true,  hardDelete: true },
  assistent: { inbox: true,  orders: true,  deleteOrders: true,  customers: true,  invoicesAll: true,  finance: false, system: false, settings: false, hardDelete: false },
  monteur:   { inbox: false, orders: false, deleteOrders: false, customers: false, invoicesAll: false, finance: false, system: false, settings: false, hardDelete: false },
};
export function can(user, key) {
  if (!user) return false;
  if (user.role === 'admin') return true; // beheerder altijd alles
  const override = user.perms && typeof user.perms[key] === 'boolean' ? user.perms[key] : undefined;
  if (override !== undefined) return override;
  return !!(ROLE_PERM_DEFAULTS[user.role] || {})[key];
}
export function requirePerm(key) {
  // Bij het OPSTARTEN afdwingen dat de sleutel bestaat (audit 18 aug): een typfout
  // zoals 'invoices' i.p.v. 'invoicesAll' gaf maandenlang stil 403 voor iedereen
  // behalve admin. Nu weigert de server te starten met een duidelijke fout.
  if (!PERM_KEYS.includes(key)) throw new Error(`requirePerm('${key}'): onbekend recht — kies uit ${PERM_KEYS.join(', ')}`);
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Niet ingelogd' });
    if (!can(req.user, key)) return res.status(403).json({ error: 'Geen rechten voor deze functie — vraag de beheerder' });
    next();
  };
}

export function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

export function setSessionCookie(res, token, secure = false) {
  // Secure alléén over HTTPS (productie/Render), anders zou de cookie lokaal (http)
  // niet werken en kon je niet meer inloggen tijdens ontwikkelen.
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure ? '; Secure' : ''}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

export function createUser({ name, email, password, role, monteurId, functie }) {
  const user = {
    id: id('user'),
    name,
    email: (email || '').toLowerCase(),
    role: role || 'assistent',
    // Functie zoals die onder uitgaande mail komt te staan (bv. "Monteur",
    // "Kantoor & planning"). Leeg = de standaardfunctie uit de handtekening.
    functie: String(functie || '').slice(0, 60),
    monteurId: monteurId || null, // koppeling naar een monteur-record (alleen voor rol 'monteur')
    passwordHash: hashPassword(password),
    createdAt: now(),
  };
  db().users.push(user);
  saveSoon();
  return user;
}
