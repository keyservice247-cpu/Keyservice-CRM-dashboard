// Verzonnen gegevens voor de TESTOMGEVING (OMGEVING=test). Alles hier is nep: namen,
// nummers (0611000xxx), adressen (Testdorp, Proefwijk …) en e-mailadressen (.test).
// De gegevens gaan via dezelfde ingangen als echt verkeer (de gewone routes), zodat de
// schermen er precies zo uitzien als met echte opdrachten. Draait één keer per database.
import { db, saveSoon } from './db.js';
import { createSession } from './auth.js';
import { TEST } from './omgeving.js';
import { TEST_MONTEUR } from './beheerder.js';

const dag = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });

export async function vulTestdata(port) {
  if (!TEST) return false;
  const s = db().settings;
  if (s._testdataV1) return false;
  const admin = (db().users || []).find((u) => u.role === 'admin');
  if (!admin) { console.error('[testdata] geen beheerder — zet ADMIN_EMAIL en ADMIN_PASSWORD'); return false; }
  s._testdataV1 = new Date().toISOString(); // direct zetten: nooit twee keer vullen
  const BASE = `http://127.0.0.1:${port}`;
  const cookie = `sid=${createSession(admin.id)}`;
  const api = async (method, path, body, token = false) => {
    const headers = { 'content-type': 'application/json' };
    if (token) headers['x-ingest-token'] = process.env.INGEST_TOKEN; else headers.cookie = cookie;
    try {
      const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => null);
      if (r.status >= 400) console.error('[testdata]', method, path, r.status, JSON.stringify(j).slice(0, 120));
      return j || {};
    } catch (e) { console.error('[testdata]', method, path, e.message); return {}; }
  };
  const mk = async (o, na) => {
    const r = await api('POST', '/api/orders', o);
    if (r && r.id && na) await api('PATCH', `/api/orders/${r.id}`, na);
    return r || {};
  };

  await api('PATCH', '/api/settings', { whatsappOrderGroups: 'opdrachtgever testgroep', autoMergeWindowHours: 0 });
  const sam = await api('POST', '/api/monteurs', { name: 'Sam', phone: '0611000101', waGroup: 'Sam testgroep' });
  const daan = await api('POST', '/api/monteurs', { name: 'Daan', phone: '0611000102', waGroup: 'Daan testgroep' });
  // Het proefaccount van de monteur hoort bij Sam.
  const mu = (db().users || []).find((u) => u.email === TEST_MONTEUR);
  if (mu && sam.id) mu.monteurId = sam.id;

  const DRS = 'DRS WhatsApp groep';
  const o = {};
  o.n1 = await mk({ source: 'Website', customerName: 'Familie Jansen', customerPhone: '0611000001', customerEmail: 'jansen@voorbeeld.test', customerAddress: 'Lindelaan 12, 1234 AB Testdorp', title: 'Testdorp — schuifpui loopt zwaar', description: 'Hefschuifpui schuift zwaar, graag een prijs.', status: 'nieuw' });
  o.n2 = await mk({ source: 'Keyservice e-mail', customerName: 'Mevrouw De Boer', customerPhone: '0611000002', customerEmail: 'deboer@voorbeeld.test', customerAddress: 'Kerkpad 3, 2345 BC Voorbeeldstad', title: 'Voorbeeldstad — cilinder vervangen', status: 'nieuw', urgent: true });
  o.b1 = await mk({ source: DRS, customerName: 'Bakkerij Smit', customerPhone: '0611000003', customerAddress: 'Marktstraat 8, 3456 CD Proefwijk', title: 'Proefwijk — achterdeur sluit niet', monteurId: sam.id });
  o.b2 = await mk({ source: 'Telefoon', customerName: 'Peter Visser', customerPhone: '0611000004', customerAddress: 'Havenweg 21, 4567 HK Demoveen', title: 'Demoveen — sleutel afgebroken in slot', monteurId: daan.id });
  o.b3 = await mk({ source: 'Keyservice WhatsApp', customerName: 'VvE Parkzicht', customerPhone: '0611000005', customerEmail: 'beheer@parkzicht.test', customerAddress: 'Parkzicht 1-40, 5678 EF Testdorp', title: 'Testdorp — centrale toegangsdeur klemt' });
  o.q1 = await mk({ source: 'Website', customerName: 'Familie Bakker', customerPhone: '0611000006', customerEmail: 'bakker@voorbeeld.test', customerAddress: 'Molenweg 5, 6789 FG Proefwijk', title: 'Proefwijk — schuifpui complete reparatie', price: '640' }, { status: 'offerte_verzonden', notes: 'Offerte € 640 excl. btw verstuurd.' });
  o.q2 = await mk({ source: DRS, customerName: 'Mevrouw Mulder', customerPhone: '0611000007', customerAddress: 'Dijkstraat 44, 7890 GH Demoveen', title: 'Demoveen — meerpuntssluiting defect', monteurId: sam.id }, { status: 'offerte_verzonden', notes: 'Onderdeel besteld, offerte € 285.' });
  o.a1 = await mk({ source: DRS, customerName: 'Tom Meijer', customerPhone: '0611000008', customerAddress: 'Schoolstraat 17, 1234 CD Testdorp', title: 'Testdorp — voordeurslot vervangen', monteurId: sam.id }, { status: 'afspraak_ingepland', appointmentAt: `${dag(0)}T10:00`, appointmentEndAt: `${dag(0)}T11:00` });
  o.a2 = await mk({ source: 'Website', customerName: 'Familie De Groot', customerPhone: '0611000009', customerEmail: 'degroot@voorbeeld.test', customerAddress: 'Tuinlaan 9, 2345 HG Voorbeeldstad', title: 'Voorbeeldstad — schuifpui loopwagens', monteurId: sam.id, price: '520' }, { status: 'afspraak_ingepland', appointmentAt: `${dag(0)}T14:30`, appointmentEndAt: `${dag(0)}T16:00` });
  o.a3 = await mk({ source: DRS, customerName: 'Kapsalon Bos', customerPhone: '0611000010', customerAddress: 'Winkelhof 2, 3456 EF Proefwijk', title: 'Proefwijk — winkeldeur afstellen', monteurId: daan.id }, { status: 'afspraak_ingepland', appointmentAt: `${dag(1)}T09:00`, appointmentEndAt: `${dag(1)}T10:00` });
  o.a4 = await mk({ source: 'Keyservice e-mail', customerName: 'Sanne Kuipers', customerPhone: '0611000015', customerEmail: 'kuipers@voorbeeld.test', customerAddress: 'Vaartweg 30, 4567 KL Demoveen', title: 'Demoveen — drie cilinders SKG3 plaatsen', monteurId: daan.id, price: '285' }, { status: 'afspraak_ingepland', appointmentAt: `${dag(2)}T13:00`, appointmentEndAt: `${dag(2)}T14:30` });
  o.d1 = await mk({ source: DRS, customerName: 'Henk Hendriks', customerPhone: '0611000011', customerAddress: 'Beukenlaan 30, 4567 FG Demoveen', title: 'Demoveen — deur geopend na buitensluiting', monteurId: sam.id, price: '145' }, { status: 'afgerond', notes: 'Deur geopend, cilinder vervangen. Gepind.' });
  o.d2 = await mk({ source: 'Website', customerName: 'Familie Peters', customerPhone: '0611000012', customerEmail: 'peters@voorbeeld.test', customerAddress: 'Zonnehof 6, 5678 GH Testdorp', title: 'Testdorp — schuifpui hefsluiting', monteurId: sam.id, price: '740' }, { status: 'afgerond', notes: 'Hefsluiting en loopwagens vervangen.' });
  o.d3 = await mk({ source: DRS, customerName: 'Mevrouw Dekker', customerPhone: '0611000013', customerAddress: 'Rozenstraat 2, 6789 HJ Voorbeeldstad', title: 'Voorbeeldstad — raamsluiting vervangen', monteurId: daan.id }, { status: 'afgerond', notes: 'Raamsluiting vervangen.' });
  o.c1 = await mk({ source: DRS, customerName: 'Karel Vos', customerPhone: '0611000014', customerAddress: 'Kanaaldijk 80, 7890 JK Proefwijk', title: 'Proefwijk — klant onbereikbaar' }, { status: 'geannuleerd', notes: 'Klant drie keer gebeld, geen gehoor.' });

  // Nieuwe berichten voor de Inbox en voor Berichten
  const grp = 'Opdrachtgever testgroep';
  await api('POST', '/api/ingest/whatsapp', { group: grp, name: 'Kim (opdrachtgever)', externalId: 'test-g1', body: 'Hallo. We sturen je de volgende klant:\nNaam: Peter Smits\nAdres: Eikenlaan 14\nWoonplaats: 1234 EF - Testdorp\nTelefoon: 0611000021\nOpmerkingen: voordeur klemt, graag vandaag' }, true);
  await api('POST', '/api/ingest/whatsapp', { group: grp, name: 'Kim (opdrachtgever)', externalId: 'test-g2', body: 'Hallo. We sturen je de volgende klant:\nNaam: Anna Koster\nAdres: Wilgenhof 3\nWoonplaats: 2345 FG - Voorbeeldstad\nTelefoon: 0611000022\nOpmerkingen: slot achterdeur draait door' }, true);
  await api('POST', '/api/ingest/whatsapp', { group: grp, name: 'Kim (opdrachtgever)', externalId: 'test-g3', body: 'Is die klant in Proefwijk al gebeld? Graag even terugkoppeling.' }, true);
  await api('POST', '/api/ingest/email', { from: 'Jan Willems <willems@voorbeeld.test>', subject: 'Offerte schuifpui', externalId: 'test-m1', body: 'Goedemiddag,\n\nOnze schuifpui in de woonkamer schuift erg zwaar en sluit niet goed af. Kunt u langskomen?\n\nAdres: Vijverlaan 22, 3456 GH Proefwijk\nTel: 0611000023\n\nMet vriendelijke groet,\nJan Willems' }, true);
  await api('POST', '/api/ingest/email', { from: 'Groothandel Slotenwereld <factuur@groothandel.test>', subject: 'Uw factuur 20261120 staat klaar', externalId: 'test-m2', body: 'Geachte klant,\n\nIn de bijlage vindt u uw factuur.\n\nMet vriendelijke groet,\nAdministratie' }, true);
  await api('POST', '/api/ingest/form', { name: 'Lisa Kok', phone: '0611000024', email: 'kok@voorbeeld.test', subject: 'Offerte aanvraag', message: 'Graag een prijs voor het vervangen van 3 cilinders, SKG3. Adres: Dennenweg 7, 4567 HJ Demoveen', site: 'keyservice247.nl' }, true);
  await api('POST', '/api/ingest/whatsapp', { name: 'Familie Bakker', fromPhone: '0611000006', externalId: 'test-d1', body: 'Goedemorgen, wij gaan akkoord met de offerte. Wanneer kunnen jullie komen?\nTelefoon: +31611000006' }, true);
  await api('POST', '/api/ingest/whatsapp', { name: 'Familie Jansen', fromPhone: '0611000001', externalId: 'test-d3', body: 'Hallo, heeft u al een prijsindicatie voor onze schuifpui?\nTelefoon: +31611000001' }, true);
  await api('POST', '/api/ingest/whatsapp', { name: 'Onbekend', fromPhone: '0611000030', externalId: 'test-d2', body: 'Hallo, zijn jullie vandaag nog bereikbaar voor een buitensluiting?\nTelefoon: +31611000030' }, true);

  // Facturen en een offerte
  if (o.d1.id) await api('POST', `/api/orders/${o.d1.id}/invoice`, { lines: [{ description: 'Deur openen na buitensluiting', qty: 1, priceExcl: 95 }, { description: 'Cilinder SKG2', qty: 1, priceExcl: 50 }], btwPct: 21, type: 'factuur' });
  if (o.d2.id) {
    const f2 = await api('POST', `/api/orders/${o.d2.id}/invoice`, { lines: [{ description: 'Hefschuifpui complete reparatie', qty: 1, priceExcl: 740 }], btwPct: 21, type: 'factuur' });
    const f2id = (f2.invoice || f2).id; if (f2id) await api('POST', `/api/invoices/${f2id}/status`, { status: 'verzonden' });
  }
  if (o.q1.customerId) {
    const q = await api('POST', '/api/invoices', { customerId: o.q1.customerId, type: 'offerte' });
    const qid = (q.invoice || q).id; if (qid) await api('PATCH', `/api/invoices/${qid}`, { lines: [{ description: 'Schuifpui: loopwagens + afstellen', qty: 1, priceExcl: 640 }], btwPct: 21 });
  }

  // Taken en een paar boekingen
  await api('POST', '/api/taken', { titel: 'Opdrachtgever bellen over planning volgende week', urgentie: 'hoog', deadline: dag(2) });
  await api('POST', '/api/taken', { titel: 'Voorraad cilinders bestellen', urgentie: 'middel' });
  await api('POST', '/api/taken', { titel: 'Offerte VvE Parkzicht nalopen', urgentie: 'middel', deadline: dag(6) });
  await api('POST', '/api/finance', { kind: 'income', amount: 1450, category: 'DRS opdracht', date: dag(0), monteurId: sam.id });
  await api('POST', '/api/finance', { kind: 'expense', amount: 650, category: 'Google Ads', date: dag(0) });
  await api('POST', '/api/finance', { kind: 'expense', amount: 310, category: 'Producten', date: dag(0) });

  saveSoon();
  console.log(`  Testomgeving gevuld met verzonnen gegevens (${(db().orders || []).length} opdrachten).`);
  return true;
}
