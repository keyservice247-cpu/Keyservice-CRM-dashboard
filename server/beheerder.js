// Eerste beheerder uit de omgeving (23 nov 2026). Lost twee dingen op:
//   - een NIEUWE of herstelde installatie waar niemand kan inloggen (de voorbeeld-
//     wachtwoorden zijn op een echte installatie geblokkeerd): zet ADMIN_EMAIL en
//     ADMIN_PASSWORD, herstart, log in, en haal de twee instellingen weer weg;
//   - de testomgeving: daar bestaat de database na elke herstart opnieuw, dus de
//     beheerder én twee proefaccounts (assistente, monteur) komen elke keer hieruit.
// Op een bestaande installatie wordt een wachtwoord NOOIT overschreven: bestaat het
// account al, dan gebeurt er niets (behalve in de testomgeving).
import { db, id, now, saveSoon, logActivity } from './db.js';
import { hashPassword } from './auth.js';
import { TEST } from './omgeving.js';

export const TEST_ASSISTENTE = 'assistente@keyservice.test';
export const TEST_MONTEUR = 'monteur@keyservice.test';

function maakOfWerkBij({ email, name, role, password, monteurId = null, overschrijf }) {
  const users = db().users;
  let u = users.find((x) => x.email === email);
  if (u) {
    if (!overschrijf) return { user: u, nieuw: false };
    u.passwordHash = hashPassword(password); u.role = role; if (monteurId) u.monteurId = monteurId;
    return { user: u, nieuw: false };
  }
  u = { id: id('user'), name, email, role, functie: '', monteurId, passwordHash: hashPassword(password), createdAt: now() };
  users.push(u);
  return { user: u, nieuw: true };
}

export function ensureBeheerderUitOmgeving() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!email && !password) {
    if (!(db().users || []).length) {
      console.error('  LET OP: er bestaat geen enkele gebruiker. Zet ADMIN_EMAIL en ADMIN_PASSWORD (minstens 10 tekens) en herstart om de eerste beheerder aan te maken.');
    }
    return null;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('  ADMIN_EMAIL is geen geldig e-mailadres — geen beheerder aangemaakt.'); return null; }
  if (password.length < 10) { console.error('  ADMIN_PASSWORD is korter dan 10 tekens — geen beheerder aangemaakt.'); return null; }
  const r = maakOfWerkBij({ email, name: 'Beheerder', role: 'admin', password, overschrijf: TEST });
  if (r.nieuw) { logActivity('systeem', 'eerste beheerder aangemaakt uit de omgeving', email); console.log(`  Beheerder aangemaakt: ${email}`); }
  if (TEST) {
    // Proefaccounts om de andere rollen te bekijken — zelfde wachtwoord als de beheerder.
    const monteur = (db().monteurs || [])[0] || null;
    maakOfWerkBij({ email: TEST_ASSISTENTE, name: 'Noor (test)', role: 'assistent', password, overschrijf: true });
    maakOfWerkBij({ email: TEST_MONTEUR, name: 'Sam (test)', role: 'monteur', password, monteurId: monteur ? monteur.id : null, overschrijf: true });
  }
  saveSoon();
  return r.user;
}
