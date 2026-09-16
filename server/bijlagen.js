// Bijlage-verwijzingen door het hele CRM heen (16 sep 2026).
//
// Sinds de ontdubbeling deelt één bestand op schijf meerdere verwijzingen: dezelfde
// foto op kaart A én kaart B, in de gesprekshistorie, als los inbox-bericht, op een
// taak, of als factuur-PDF in de wachtrij. Een bestand mag dus pas van schijf als
// NIEMAND er meer naar wijst. Elk verwijderpad hoort daarom via
// verwijderBestandenAlsOngebruikt() te lopen — nooit rechtstreeks deleteFile().
import { db } from './db.js';
import { deleteFile } from './storage.js';

const bestandUitUrl = (url) => { const m = /\/uploads\/(att_[a-zA-Z0-9_.]+)/.exec(String(url || '')); return m ? m[1] : ''; };

// Alle verwijzingen: kaarten, prullenbak, gesprekshistorie, losse berichten, taken,
// factuur-PDF's voor WhatsApp en media op wachtrij-items.
export function alleBijlageVerwijzingen() {
  const uit = [];
  for (const o of [...(db().orders || []), ...(db().trash || [])]) {
    for (const a of o.attachments || []) if (a) uit.push(a);
    for (const t of o.thread || []) for (const a of t.attachments || []) if (a) uit.push(a);
  }
  for (const m of db().messages || []) for (const a of m.attachments || []) if (a) uit.push(a);
  for (const t of db().taken || []) for (const a of t.bijlagen || []) if (a) uit.push(a);
  for (const i of db().invoices || []) if (i && i.waPdfFile) uit.push({ id: `inv:${i.id}`, file: i.waPdfFile, url: `/uploads/${i.waPdfFile}`, kind: 'file', mime: 'application/pdf' });
  for (const it of db().outbox || []) {
    if (it && it.status === 'queued' && Array.isArray(it.media)) {
      for (const m of it.media) { const f = m?.file || bestandUitUrl(m?.url); if (f) uit.push({ id: `out:${it.id}`, file: f, url: `/uploads/${f}`, kind: 'file', mime: m?.mime || '' }); }
    }
  }
  return uit;
}

// Bestanden waar een werkbon-handtekening naar wijst: NOOIT verwijderen.
export function beschermdeBijlageIds() {
  const ids = new Set();
  for (const o of [...(db().orders || []), ...(db().trash || [])]) {
    const sigId = o.werkbon && o.werkbon.signatureAttachmentId;
    if (sigId) ids.add(sigId);
  }
  return ids;
}

// Verwijder de opgegeven bestanden van schijf, maar ALLEEN als er nergens meer een
// verwijzing naar bestaat. Roep dit aan NÁ het weghalen van de eigen verwijzing(en).
// Geeft het aantal daadwerkelijk verwijderde bestanden terug.
export function verwijderBestandenAlsOngebruikt(files) {
  const kandidaten = new Set((Array.isArray(files) ? files : [files]).filter((f) => f && /^att_[a-zA-Z0-9_.]+$/.test(f)));
  if (!kandidaten.size) return 0;
  const inGebruik = new Set();
  const beschermd = beschermdeBijlageIds();
  for (const a of alleBijlageVerwijzingen()) {
    if (a.file && kandidaten.has(a.file)) inGebruik.add(a.file);
    if (a.file && beschermd.has(a.id)) inGebruik.add(a.file);
  }
  let n = 0;
  for (const f of kandidaten) {
    if (inGebruik.has(f)) continue;
    try { deleteFile(f); n++; } catch { /* al weg */ }
  }
  return n;
}
