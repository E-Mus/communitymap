/* Teilen-Links ohne Server.
 *
 * Zwei Formen:
 *   #/s/<id>            — kurz, funktioniert nur fuer die Seed-Sichtungen,
 *                         die auf jedem Geraet identisch existieren
 *   #/n/<17 Zeichen>    — selbsttragend: Koordinaten, Tags und Neigung
 *                         stecken IM Link, funktioniert also auch auf einem
 *                         fremden Geraet
 *
 * Warum kein base64 von JSON: btoa ist latin1-only und wuerde an einem Umlaut
 * in einem Tag mit InvalidCharacterError sterben, base64url muesste man von
 * Hand nachbauen (+/= -> -_), und das Ergebnis waere dreimal so lang.
 *
 * Aufbau (alles base36, Alphabet [0-9a-z] — kein Prozent-Encoding noetig,
 * ueberlebt jede Messenger-Linkerkennung, passt in einen QR-Code):
 *
 *   1 Zeichen   Version
 *   5 Zeichen   lat  = round((lat+90)  * 1e5)   max 18 000 000 < 36^5
 *   5 Zeichen   lng  = round((lng+180) * 1e5)   max 36 000 000 < 36^5
 *   4 Zeichen   Tag-Bitmaske
 *   1 Zeichen   Neigung, 36 Stufen von -8° bis +8°
 *   1 Zeichen   Pruefziffer
 *
 * 5 Nachkommastellen sind ~1.1 m. Vier waeren 11 m — also die andere
 * Strassenseite, und das sieht man auf einem Screenshot sofort.
 *
 * Die Pruefziffer ist nicht Kosmetik: ohne sie dekodiert ein vom Chat-Client
 * abgeschnittener Link zu PLAUSIBLEN Koordinaten irgendwo im Atlantik.
 */

import { TAGS } from './store.js';

const VER = '1';
const b36 = (n, w) => Math.max(0, Math.round(n)).toString(36).padStart(w, '0').slice(-w);
const sum = (s) => [...s].reduce((a, ch) => a + parseInt(ch, 36), 0) % 36;

export function encode(spot) {
  const lat = b36((spot.lat + 90) * 1e5, 5);
  const lng = b36((spot.lng + 180) * 1e5, 5);
  const mask = spot.tags.reduce((m, t) => {
    const i = TAGS.findIndex((x) => x.id === t);
    return i < 0 ? m : m | (1 << i);
  }, 0);
  const rot = b36(((Math.max(-8, Math.min(8, spot.rot || 0)) + 8) / 16) * 35, 1);
  const body = lat + lng + b36(mask, 4) + rot;
  return VER + body + b36(sum(body), 1);
}

export function decode(code) {
  if (typeof code !== 'string' || code.length !== 17) return null;
  if (code[0] !== VER) return null;
  const body = code.slice(1, 16);
  if (!/^[0-9a-z]{16}$/.test(code.slice(1))) return null;
  if (b36(sum(body), 1) !== code[16]) return null;

  const lat = parseInt(body.slice(0, 5), 36) / 1e5 - 90;
  const lng = parseInt(body.slice(5, 10), 36) / 1e5 - 180;
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return null;

  const mask = parseInt(body.slice(10, 14), 36);
  const tags = TAGS.filter((_, i) => mask & (1 << i)).map((t) => t.id);
  const rot = Math.round((parseInt(body[14], 36) / 35) * 16 - 8);

  return { lat: +lat.toFixed(5), lng: +lng.toFixed(5), tags, rot, photo: null, likes: 0, reports: 0 };
}

const base = () => location.origin + location.pathname;

export function urlFor(spot, isSeed) {
  return base() + (isSeed ? `#/s/${spot.id}` : `#/n/${encode(spot)}`);
}

/** Liest den aktuellen Hash. */
export function route() {
  const h = location.hash;
  let m = h.match(/^#\/s\/([a-z0-9]+)$/i);
  if (m) return { kind: 'seed', id: m[1] };
  m = h.match(/^#\/n\/([0-9a-z]{17})$/i);
  if (m) return { kind: 'link', code: m[1].toLowerCase() };
  if (h.startsWith('#/n/')) return { kind: 'broken' };
  return null;
}

export function clearRoute() {
  history.replaceState(null, '', base());
}

/** Teilen: mobil ueber die System-Freigabe, sonst Zwischenablage. */
export async function share(url, title = 'Nö gesichtet') {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
