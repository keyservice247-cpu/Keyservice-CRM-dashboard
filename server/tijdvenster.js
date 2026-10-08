// KLANTVRIENDELIJKE TIJDEN (8 okt 2026, casus Erik Kaper: automatische offerte-opvolging om
// 02:28 's nachts). De automatische rondes draaiden elk uur en de "één keer per dag"-sleutel
// was de UTC-datum — de eerste ronde na middernacht UTC (= 02:00 Nederlandse zomertijd)
// verstuurde dus alles midden in de nacht. Automatische berichten aan KLANTEN gaan nu
// alleen overdag weg, en "vandaag" is de Nederlandse kalenderdag.
export const KLANT_UREN = { van: 9, tot: 20 }; // 09:00 – 19:59 Nederlandse tijd

export function nlUur(d = new Date()) {
  return Number(d.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false })) % 24;
}

export function nlDag(d = new Date()) {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
}

export function klantvriendelijkMoment(d = new Date()) {
  const u = nlUur(d);
  return u >= KLANT_UREN.van && u < KLANT_UREN.tot;
}
