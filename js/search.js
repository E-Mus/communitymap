/* Ortssuche.
 *
 * Photon (Komoot) ist keyless, CORS-offen und ausdruecklich fuer Autocomplete
 * gebaut — Nominatim verbietet Autocomplete in seiner Nutzungsrichtlinie.
 *
 * Photon hat aber keine Verfuegbarkeitszusage ("we do not guarantee for the
 * availability"). Deshalb faellt die Suche nicht auf einen Fehler zurueck,
 * sondern auf zwei Quellen, die immer da sind: die eigenen Sichtungen und
 * direkte Koordinaten-Eingabe.
 */

const ENDPOINT = 'https://photon.komoot.io/api';

/* Ein AbortController pro Tastendruck. Ohne das kommen Antworten in falscher
 * Reihenfolge zurueck und die Ergebnisliste springt — das ist ein
 * Korrektheitsfehler, keine Optimierung. */
let inflight = null;

/** "52.512, 13.453" oder "52° 30′ 43″ N, 13° 27′ 13″ E" */
export function parseCoords(q) {
  const s = q.trim();

  const dec = s.match(/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
  if (dec) {
    const lat = parseFloat(dec[1].replace(',', '.'));
    const lng = parseFloat(dec[2].replace(',', '.'));
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }

  const dmsRe =
    /(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:[.,]\d+)?)\s*["″]?\s*([NSEWnsew])/g;
  const parts = [...s.matchAll(dmsRe)].map((m) => {
    const v = +m[1] + +m[2] / 60 + parseFloat(m[3].replace(',', '.')) / 3600;
    const h = m[4].toUpperCase();
    return { v: h === 'S' || h === 'W' ? -v : v, h };
  });
  if (parts.length === 2) {
    const lat = parts.find((p) => p.h === 'N' || p.h === 'S');
    const lng = parts.find((p) => p.h === 'E' || p.h === 'W');
    if (lat && lng) return { lat: lat.v, lng: lng.v };
  }
  return null;
}

/** Photon-Abfrage. Wirft nie — liefert im Fehlerfall null. */
export async function geocode(q, { signal } = {}) {
  inflight?.abort();
  const ctl = new AbortController();
  inflight = ctl;
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  const timeout = setTimeout(() => ctl.abort(), 5000);
  try {
    const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&limit=6&lang=de`;
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.features || []).map((f) => {
      const p = f.properties || {};
      const where = [p.city || p.district || p.county, p.state, p.country]
        .filter(Boolean)
        .join(', ');
      return {
        kind: 'place',
        title: p.name || p.street || where || 'ort',
        sub: where,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
      };
    });
  } catch {
    return null; // abgebrochen, offline, oder Photon down
  } finally {
    clearTimeout(timeout);
    if (inflight === ctl) inflight = null;
  }
}

/** Lokale Sichtungen nach Tag durchsuchen — funktioniert immer. */
export function localHits(q, spots, tagLabel) {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  return spots
    .filter((s) => s.tags.some((t) => tagLabel(t).toLowerCase().includes(needle)))
    .slice(0, 4)
    .map((s) => ({
      kind: 'spot',
      id: s.id,
      title: s.tags.map(tagLabel).join(' · '),
      sub: `sichtung · ${s.lat.toFixed(3)}, ${s.lng.toFixed(3)}`,
      lng: s.lng,
      lat: s.lat,
    }));
}

export const offlineNote = () =>
  navigator.onLine ? 'ortssuche gerade nicht erreichbar' : 'keine verbindung';
