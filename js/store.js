/* Zustand + Persistenz.
 *
 * Die wichtigste Regel hier ist SCHREIBEN VOR MUTIEREN. Wer erst den Zustand
 * aendert und dann speichert, hinterlaesst bei vollem localStorage einen
 * Sticker, der auf dem Schirm ist, auf der Karte ist — und nach dem Reload
 * weg. Das ist der schlimmste denkbare Fehlerfall, weil der Nutzer glaubt,
 * es haette geklappt. Also: persist() zuerst, und wenn es wirft, wurde nichts
 * angefasst und es gibt nichts zurueckzurollen.
 */

import { emit } from './bus.js';
import { seedSpots } from './seed.js';

const K = {
  spots: 'noemap.v1.spots',
  liked: 'noemap.v1.liked',
  reported: 'noemap.v1.reported',
  admin: 'noemap.v1.admin',
};

/* Ab so vielen Meldungen verschwindet eine Sichtung aus Karte und Feed und
 * landet in der Admin-Warteschlange. Einzelne Boeswillige koennen damit nichts
 * loeschen, echte Probleme verschwinden trotzdem von selbst. */
export const REPORT_LIMIT = 3;

/* ACHTUNG: Diese Liste ist AB JETZT APPEND-ONLY.
 * Die Reihenfolge ist der Bit-Index in der Tag-Bitmaske der Teilen-Links.
 * Umsortieren aendert still die Bedeutung jedes bereits geteilten Links. */
export const TAGS = [
  { id: 'stadt', label: 'stadt' },
  { id: 'land', label: 'land' },
  { id: 'hoehe', label: 'luftige höhe' },
  { id: 'fahrzeug', label: 'fahrzeug' },
  { id: 'indoor', label: 'indoor' },
  { id: 'outdoor', label: 'outdoor' },
  { id: 'schild', label: 'schild' },
  { id: 'klo', label: 'klo' },
];

export const tagLabel = (id) => TAGS.find((t) => t.id === id)?.label ?? id;

/* ── Speicher-Verfuegbarkeit ─────────────────────────────────────────────── */
/* Safari im privaten Modus hat historisch bei jedem setItem geworfen. Einmal
 * beim Start pruefen; wenn nicht verfuegbar, laeuft die App im fluechtigen
 * Modus weiter — alles funktioniert, verschwindet aber beim Neuladen. */
export let volatile = false;

function probeStorage() {
  try {
    const t = '__noemap_probe__';
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
    return false;
  } catch {
    return true;
  }
}

export class QuotaError extends Error {
  constructor(bytes) {
    super('localStorage voll');
    this.name = 'QuotaError';
    this.bytes = bytes;
  }
}

const isQuota = (e) =>
  !!e &&
  (e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014);

function writeKey(key, value) {
  if (volatile) return;
  const json = JSON.stringify(value);
  try {
    localStorage.setItem(key, json);
  } catch (e) {
    if (isQuota(e)) throw new QuotaError(new Blob([json]).size);
    throw e;
  }
}

function readKey(key, fallback) {
  if (volatile) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/* ── Zustand ─────────────────────────────────────────────────────────────── */
export const state = {
  spots: [],
  byId: new Map(),
  liked: new Set(),
  reported: new Set(),
  selectedId: null,
  imported: null, // transient, aus einem geteilten Link — NIE im Store
  pending: null, // Sticker im Entstehen (Sheet offen)
  admin: false,
  feedTab: 'neu',
  seedIds: new Set(),
};

function index() {
  state.byId = new Map(state.spots.map((s) => [s.id, s]));
}

export function init() {
  volatile = probeStorage();

  const seeded = seedSpots();
  state.seedIds = new Set(seeded.map((s) => s.id));

  const stored = readKey(K.spots, null);
  state.spots = Array.isArray(stored) && stored.length ? stored : seeded;
  index();

  state.liked = new Set(readKey(K.liked, []));
  state.reported = new Set(readKey(K.reported, []));
  state.admin = readKey(K.admin, false) === true;

  return { volatile };
}

/* ── Abfragen ────────────────────────────────────────────────────────────── */

/* Sichtbar = nicht durch Meldungen verborgen. Der Admin sieht alles. */
export const isHidden = (s) => s.reports >= REPORT_LIMIT;
export function visibleSpots() {
  return state.admin ? state.spots : state.spots.filter((s) => !isHidden(s));
}

/* Altersgewichtetes Ranking im Stil von Hacker News: oben steht, was gerade
 * gut laeuft, statt was vor Monaten mal viele Likes bekam. */
export const hotScore = (s) => s.likes / Math.pow((Date.now() - s.ts) / 864e5 + 2, 0.55);

export function feedSpots(tab = state.feedTab) {
  if (tab === 'gemeldet') {
    return state.spots.filter((s) => s.reports > 0).sort((a, b) => b.reports - a.reports);
  }
  const list = visibleSpots().slice();
  if (tab === 'top') return list.sort((a, b) => b.likes - a.likes || b.ts - a.ts);
  if (tab === 'heiss') return list.sort((a, b) => hotScore(b) - hotScore(a));
  return list.sort((a, b) => b.ts - a.ts);
}

/* GeoJSON fuer die Karte.
 * KRITISCH: nur primitive Properties. GeoJSON-Sources laufen durch dieselbe
 * Vektor-Tile-Serialisierung wie Remote-Tiles, dabei werden Arrays und Objekte
 * zu JSON-Strings — `tags` kaeme als '["stadt"]' zurueck. Alles andere wird
 * per id im Store nachgeschlagen. */
export function toGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: visibleSpots().map((s) => ({
      type: 'Feature',
      properties: { id: s.id, rot: s.rot },
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    })),
  };
}

/* ── Mutationen ──────────────────────────────────────────────────────────── */

export function newId() {
  return Math.random().toString(36).slice(2, 8);
}

export function makeSpot({ lng, lat, tags = [], photo = null }) {
  return {
    id: newId(),
    lng: +lng.toFixed(5),
    lat: +lat.toFixed(5),
    tags: tags.slice(),
    photo,
    likes: 1, // wer klebt, mag seinen eigenen Nö
    reports: 0,
    ts: Date.now(),
    rot: Math.round(Math.random() * 16 - 8),
  };
}

export function addSpot(spot) {
  const next = [...state.spots, spot];
  writeKey(K.spots, next); // wirft VOR jeder Mutation
  state.spots = next;
  state.byId.set(spot.id, spot);
  state.liked.add(spot.id);
  writeKey(K.liked, [...state.liked]);
  emit('spots:changed', { reason: 'add', spot });
  return spot;
}

export function removeSpot(id) {
  const spot = state.byId.get(id);
  const next = state.spots.filter((s) => s.id !== id);
  writeKey(K.spots, next);
  state.spots = next;
  state.byId.delete(id);
  emit('spots:changed', { reason: 'delete', id, spot });
  return spot;
}

export function toggleLike(id) {
  const s = state.byId.get(id);
  if (!s) return;
  const on = !state.liked.has(id);
  s.likes = Math.max(0, s.likes + (on ? 1 : -1));
  if (on) state.liked.add(id);
  else state.liked.delete(id);
  try {
    writeKey(K.spots, state.spots);
    writeKey(K.liked, [...state.liked]);
  } catch {
    /* Ein Like ist keinen Abbruch wert — es bleibt in dieser Sitzung stehen. */
  }
  /* Eigenes Event, nicht spots:changed. Eine Like-Zahl hat keine
   * Kartendarstellung, also fassen Likes die GeoJSON-Source nicht an, und
   * der Feed patcht gezielt statt neu zu rendern. */
  emit('spot:like', { id, likes: s.likes, liked: on });
}

export function toggleReport(id) {
  const s = state.byId.get(id);
  if (!s || state.reported.has(id)) return { already: true };
  s.reports += 1;
  state.reported.add(id);
  try {
    writeKey(K.spots, state.spots);
    writeKey(K.reported, [...state.reported]);
  } catch {
    /* egal */
  }
  const hidden = isHidden(s);
  emit(hidden ? 'spots:changed' : 'spot:report', { id, reports: s.reports, hidden });
  return { reports: s.reports, hidden };
}

export function setAdmin(on) {
  state.admin = !!on;
  try {
    writeKey(K.admin, state.admin);
  } catch {
    /* egal */
  }
  emit('spots:changed', { reason: 'admin' });
}

export function setSelected(id) {
  state.selectedId = id;
  emit('select', { id });
}

export function setFeedTab(tab) {
  state.feedTab = tab;
  emit('feed:tab', { tab });
}

/* Grober Fuellstand fuer die Anzeige im Menue. localStorage deckelt bei ~5 MB,
 * und Fotos als base64-JPEG fressen das schnell. */
export function usage() {
  if (volatile) return { bytes: 0, max: 0 };
  let bytes = 0;
  for (const key of Object.values(K)) {
    bytes += (localStorage.getItem(key) || '').length * 2; // UTF-16
  }
  return { bytes, max: 5 * 1024 * 1024 };
}

export { K as KEYS };
