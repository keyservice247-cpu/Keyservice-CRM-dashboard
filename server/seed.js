// Vult de database met een eerste admin-account en wat voorbeelddata,
// zodat je het dashboard meteen kunt proberen.
import { db, id, now, save, load } from './db.js';
import { hashPassword } from './auth.js';

const DEMO = [
  { type: 'user', name: 'Beheerder', email: 'admin@keyservice.nl', password: 'admin123', role: 'admin' },
  { type: 'user', name: 'Assistente Sara', email: 'sara@keyservice.nl', password: 'sara123', role: 'assistent' },
  { type: 'user', name: 'Monteur Ahmed', email: 'ahmed@keyservice.nl', password: 'ahmed123', role: 'monteur' },
];

export function ensureSeed() {
  const data = db();
  if (data._seeded) return;

  // Gebruikers
  for (const u of DEMO) {
    if (!data.users.some((x) => x.email === u.email)) {
      data.users.push({
        id: id('user'), name: u.name, email: u.email.toLowerCase(),
        role: u.role, passwordHash: hashPassword(u.password), createdAt: now(),
      });
    }
  }

  // Monteurs
  const mAhmed = { id: id('mont'), name: 'Ahmed', phone: '06-11111111', email: 'ahmed@keyservice.nl', createdAt: now() };
  const mPiet = { id: id('mont'), name: 'Piet', phone: '06-22222222', email: 'piet@keyservice.nl', createdAt: now() };
  data.monteurs.push(mAhmed, mPiet);

  // Klanten
  const c1 = { id: id('cust'), name: 'Familie de Vries', phone: '06-12345678', email: 'devries@example.nl', address: 'Hoofdstraat 1, Amsterdam', type: 'klant', source: 'email', notes: '', createdAt: now() };
  const c2 = { id: id('cust'), name: 'Bakkerij Jansen', phone: '020-9876543', email: 'info@bakkerijjansen.nl', address: 'Marktplein 5, Haarlem', type: 'klant', source: 'whatsapp', notes: 'Vaste klant', createdAt: now() };
  const c3 = { id: id('cust'), name: 'Mevr. El Amrani', phone: '06-55512345', email: '', address: 'Tulpstraat 12, Utrecht', type: 'lead', source: 'telefoon', notes: '', createdAt: now() };
  data.customers.push(c1, c2, c3);

  // Opdrachten verdeeld over de kolommen
  const ord = (o) => ({
    id: id('ord'), description: '', source: 'handmatig', monteurId: null,
    appointmentAt: null, price: '', urgent: false, notes: '', messageId: null,
    createdAt: now(), updatedAt: now(), ...o,
  });
  data.orders.push(
    ord({ title: 'Buitengesloten — voordeurslot', status: 'open', customerId: c3.id, source: 'Telefoon', urgent: true }),
    ord({ title: 'Offerte: cilindersloten vervangen (3x)', status: 'offerte_verzonden', customerId: c1.id, source: 'Keyservice e-mail', price: '€ 240' }),
    ord({ title: 'Inbraakschade herstellen achterdeur', status: 'afspraak_ingepland', customerId: c2.id, source: 'DRS WhatsApp groep', monteurId: mAhmed.id, appointmentAt: new Date(Date.now() + 86400000).toISOString().slice(0, 16) }),
    ord({ title: 'Slot gerepareerd kantoordeur', status: 'afgerond', customerId: c1.id, source: 'Keyservice WhatsApp', monteurId: mPiet.id, price: '€ 95' }),
    ord({ title: 'Extra sleutels bijmaken', status: 'geannuleerd', customerId: c2.id, source: 'Keyservice WhatsApp' }),
  );

  data._seeded = true;
  save();
  console.log('Database gevuld met voorbeelddata. Login: admin@keyservice.nl / admin123');
}

// Mogelijkheid om handmatig te seeden via: npm run seed
if (process.argv.includes('--force')) {
  load();
  db()._seeded = false;
  ensureSeed();
  console.log('Klaar.');
}
