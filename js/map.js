/* Karte: Cluster-Source, Symbol-Layer, genau EIN DOM-Overlay.
 *
 * Warum kein Pool aus DOM-Markern:
 *  - querySourceFeatures liefert nur Features aus GELADENEN Kacheln, Marker
 *    flackern also beim Streamen herein, und dieselbe Geometrie kommt an
 *    Kachelgrenzen mehrfach zurueck.
 *  - "die naechsten 80" wechselt beim Schwenken nicht-monoton; ein
 *    wiederverwendeter Knoten teleportiert sichtbar.
 *  - feature-state ist auf geclusterten Sources gar nicht verfuegbar.
 *  - 80 DOM-Knoten ueber einem WebGL-Canvas sind auf Mittelklasse-Android
 *    ein Frame-Killer.
 *
 * Stattdessen: alle Sticker im GPU-Symbol-Layer, und genau ein DOM-Overlay
 * fuer die drei Zustaende, die sich ohnehin ausschliessen (wird gerade
 * geklebt / ist ausgewaehlt / kommt aus einem geteilten Link).
 */

import { baseStyle, emptyStyle } from './mapstyle.js';
import { loadArtwork, cutout, buildDieCut, dieCutURL } from './sticker.js';
import * as store from './store.js';
import { emit } from './bus.js';

const SRC = 'spots';
const L_CLUSTER = 'clusters';
const L_COUNT = 'cluster-count';
const L_STICK = 'stickers';
const SPOT_LAYERS = new Set([L_CLUSTER, L_COUNT, L_STICK]);

const C = '#009DE0';
const M = '#C4007A';
const Y = '#FFF300';
const K = '#000000';

export let map = null;

let artImg = null;
let stickerImage = null; // ImageData, ueberlebt setStyle NICHT
let overlayURL = ''; // Data-URL fuer das DOM-Overlay, pixelgleich zum Symbol
let overlay = null; // der eine Marker
let layersReady = false;
let tileErrors = 0;
let degraded = false;

/* ── Groessen ────────────────────────────────────────────────────────────── */

function stickerPx() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--sticker-px');
  return parseFloat(v) || 46;
}

/* Farb-Token aufloesen.
 * Nicht getPropertyValue lesen — das liefert bei `--cl-1: var(--m)` je nach
 * Engine den unaufgeloesten Text zurueck. Stattdessen einen Probe-Knoten
 * `color: var(--x)` faerben und die berechnete Farbe abholen: das ergibt
 * immer ein fertiges rgb(). */
let probe = null;
function resolveColor(name, fallback) {
  if (!probe) {
    probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
    document.body.append(probe);
  }
  probe.style.color = '';
  probe.style.color = `var(${name})`;
  const v = getComputedStyle(probe).color;
  return v && v !== 'rgba(0, 0, 0, 0)' ? v : fallback;
}

/* Cluster nach Anzahl: kleine Gruppen gelb, mittlere magenta, grosse cyan.
 * Die Textfarbe wandert zwingend mit — gelbe Zahl auf gelber Blase waere
 * unsichtbar, und Schwarz auf Magenta liegt bei nur ~3.6:1. */
const CL_BREAK = [10, 50];
function clusterColor() {
  return [
    'step', ['get', 'point_count'],
    resolveColor('--cl-1', M), CL_BREAK[0],
    resolveColor('--cl-2', M), CL_BREAK[1],
    resolveColor('--cl-3', M),
  ];
}
function clusterInk() {
  return [
    'step', ['get', 'point_count'],
    resolveColor('--cl-1-ink', Y), CL_BREAK[0],
    resolveColor('--cl-2-ink', Y), CL_BREAK[1],
    resolveColor('--cl-3-ink', Y),
  ];
}
const clusterRadius = () => [
  'step', ['get', 'point_count'],
  16, CL_BREAK[0],
  22, CL_BREAK[1],
  29,
];

/* Das Atlas-Bild ist (256 + 2*13) breit und wird mit pixelRatio 2 registriert,
 * rendert also bei icon-size 1 mit halber Pixelbreite in CSS-px. */
function iconSizeExpr() {
  if (!stickerImage) return 1;
  const cssW = stickerImage.width / 2;
  const base = stickerPx() / cssW;
  return [
    'interpolate', ['linear'], ['zoom'],
    3, base * 0.5,
    9, base * 0.68,
    12, base * 0.85,
    14, base,
  ];
}

/* ── Aufbau ──────────────────────────────────────────────────────────────── */

function installSpotLayers() {
  if (!map || map.getSource(SRC)) return; // idempotent — wird nach jedem setStyle gerufen

  map.addSource(SRC, {
    type: 'geojson',
    data: store.toGeoJSON(),
    cluster: true,
    clusterRadius: 52,
    clusterMaxZoom: 13, // ab z14 immer einzelne Nös
    promoteId: 'id',
  });

  map.addLayer({
    id: L_CLUSTER,
    type: 'circle',
    source: SRC,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': clusterColor(),
      'circle-stroke-color': K,
      'circle-stroke-width': 2,
      'circle-radius': clusterRadius(),
    },
  });

  map.addLayer({
    id: L_COUNT,
    type: 'symbol',
    source: SRC,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Bold'], // GENAU EIN Font — Mehrfachstacks liefern 404
      'text-size': ['step', ['get', 'point_count'], 12, CL_BREAK[0], 13, CL_BREAK[1], 15],
      'text-allow-overlap': true,
    },
    paint: { 'text-color': clusterInk() },
  });

  if (stickerImage) addStickerLayer();

  layersReady = true;
}

function addStickerLayer() {
  if (!map || map.getLayer(L_STICK)) return;
  map.addLayer({
    id: L_STICK,
    type: 'symbol',
    source: SRC,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': 'noe',
      /* Ohne diese beiden laesst MapLibres Kollisionspruefung im dichten
       * Friedrichshain-Cluster still Sticker weg — und dann fehlen Marker,
       * ohne dass irgendwo ein Fehler steht. */
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-rotate': ['get', 'rot'],
      'icon-rotation-alignment': 'viewport',
      'icon-pitch-alignment': 'viewport',
      'icon-size': iconSizeExpr(),
      'icon-padding': 4,
    },
    paint: { 'icon-opacity': 1 },
  });
}

function registerImage() {
  if (!map || !stickerImage || map.hasImage('noe')) return;
  try {
    map.addImage('noe', stickerImage, { pixelRatio: 2 });
  } catch (err) {
    console.warn('[map] addImage', err);
  }
}

/* ── Fehlerzustaende ─────────────────────────────────────────────────────── */

function setLoad(stage) {
  const bar = document.getElementById('loadbar');
  if (bar) bar.dataset.p = stage;
}

/* Der Kartenstil ist weiss auf weiss: eine nicht geladene Karte saehe aus wie
 * eine geladene. Deshalb explizite Flaeche statt Weiss. */
function showFail(on) {
  const el = document.getElementById('mapfail');
  if (el) el.hidden = !on;
}

function degrade(reason) {
  if (degraded) return;
  degraded = true;
  console.warn('[map] degraded:', reason);
  setLoad('done');
  showFail(true);

  /* Sticker und Cluster bleiben sichtbar — die Daten sind lokal und gueltig.
   * transformStyle rettet Source und Layer ueber den Stilwechsel; die per
   * addImage registrierten Bilder ueberleben ihn NICHT und muessen erneut. */
  try {
    map.setStyle(emptyStyle(), {
      transformStyle: (prev, next) => {
        if (!prev) return next;
        return {
          ...next,
          sources: { ...next.sources, [SRC]: prev.sources[SRC] },
          layers: [...next.layers, ...prev.layers.filter((l) => SPOT_LAYERS.has(l.id))],
        };
      },
    });
    map.once('styledata', () => {
      registerImage();
      restorePaint();
    });
  } catch (err) {
    console.warn('[map] setStyle fallback failed', err);
  }
}

function retry() {
  degraded = false;
  tileErrors = 0;
  showFail(false);
  setLoad('start');
  layersReady = false;
  map.setStyle(baseStyle());
  map.once('styledata', () => {
    registerImage();
    installSpotLayers();
    restorePaint();
    setLoad('done');
  });
}

/* ── Overlay-Slot ────────────────────────────────────────────────────────── */

/* Symbol unter dem Overlay ausblenden — ueber icon-opacity (Paint, praktisch
 * gratis), NICHT ueber setFilter: das loest ein Bucket-Re-Layout im Worker aus. */
function setOverlaid(id) {
  if (!map || !map.getLayer(L_STICK)) return;
  map.setPaintProperty(
    L_STICK,
    'icon-opacity',
    id ? ['case', ['==', ['get', 'id'], id], 0, 1] : 1
  );
}

let overlaidId = null;
function restorePaint() {
  refreshSizes();
  if (map && map.getLayer(L_STICK)) setOverlaid(overlaidId);
}

function makeOverlayEl(spot, cls) {
  const el = document.createElement('div');
  el.className = `ov ${cls}`;
  el.style.setProperty('--rot', `${spot.rot || 0}deg`);
  const img = document.createElement('img');
  img.className = 'ov__img';
  img.src = overlayURL;
  img.alt = 'Nö';
  img.draggable = false;
  el.append(img);
  return el;
}

function clearOverlay() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

/** Auswahl: derselbe Slot, andere Klasse. */
export function setSelected(id) {
  /* Reihenfolge zaehlt: erst Overlay weg, dann icon-opacity zuruecksetzen,
   * sonst gibt es einen Frame, in dem weder das eine noch das andere da ist. */
  clearOverlay();
  overlaidId = null;
  setOverlaid(null);
  if (!id) return;

  const s = store.state.byId.get(id);
  if (!s || !map) return;

  overlay = new maplibregl.Marker({ element: makeOverlayEl(s, 'ov--sel'), anchor: 'center' })
    .setLngLat([s.lng, s.lat])
    .addTo(map);
  overlaidId = id;
  setOverlaid(id);
}

/** Geteilter Sticker aus einem Link — cyan geringt, transient, nie im Store. */
export function showImported(spot) {
  clearOverlay();
  overlaidId = null;
  setOverlaid(null);
  if (!spot || !map) return;
  overlay = new maplibregl.Marker({ element: makeOverlayEl(spot, 'ov--import'), anchor: 'center' })
    .setLngLat([spot.lng, spot.lat])
    .addTo(map);
}

/* ── Slap ────────────────────────────────────────────────────────────────── */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Zwei gezeichnete Frames abwarten — aber niemals daran haengen bleiben.
 * requestAnimationFrame wird in Hintergrund-Tabs gedrosselt oder ganz
 * angehalten; ohne den Timeout wuerde slap() dort nie aufloesen, und der
 * Nutzer bekaeme weder den Toast noch die Rueckgaengig-Aktion. */
const twoFrames = () =>
  Promise.race([
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    wait(400),
  ]);

/**
 * Der Sticker knallt auf die Karte und wird dann an den Symbol-Layer uebergeben.
 * Die Uebergabe ist der Teil, den man leicht falsch macht:
 *   setData() gibt ein Promise zurueck, das aufloest NACHDEM der Worker
 *   geparst hat — das ist das verlaessliche Signal. Danach zwei rAF, damit
 *   garantiert ein Frame mit sichtbarem Symbol gezeichnet wurde, erst dann
 *   faellt der DOM-Knoten weg. Weil Overlay und Symbol pixelgleich sind
 *   (gleiche Grafik, gleiche Groesse, gleicher Anker), sieht man nichts.
 */
export async function slap(spot) {
  if (!map) return;
  clearOverlay();

  const el = makeOverlayEl(spot, 'ov--slap');
  const ring = document.createElement('i');
  ring.className = 'shock';
  const ring2 = document.createElement('i');
  ring2.className = 'shock shock--2';
  el.append(ring, ring2);

  const m = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat([spot.lng, spot.lat])
    .addTo(map);
  overlay = m;

  try {
    navigator.vibrate?.(18); // iOS Safari kann das in keiner Version — reines Extra
  } catch {
    /* egal */
  }

  const app = document.getElementById('app');
  if (app) {
    app.dataset.hit = '1';
    setTimeout(() => delete app.dataset.hit, 200);
  }

  /* Animation abwarten — aber niemals daran haengen bleiben. Ein Tabwechsel
   * oder prefers-reduced-motion kann animationend verschlucken. */
  await Promise.race([
    new Promise((res) => el.addEventListener('animationend', res, { once: true })),
    wait(900),
  ]);

  const src = map.getSource(SRC);
  if (src) {
    try {
      await src.setData(store.toGeoJSON());
    } catch {
      src.setData(store.toGeoJSON());
    }
  }

  await twoFrames();
  if (overlay === m) {
    clearOverlay();
    /* Ueber den Store, nicht ueber das lokale setSelected — sonst zeigt die
     * Karte eine Auswahl an, von der der Rest der App nichts weiss, und das
     * Detail-Panel bleibt zu. */
    store.setSelected(spot.id);
  }
}

/* ── Öffentliche API ─────────────────────────────────────────────────────── */

export function syncSource() {
  const src = map?.getSource(SRC);
  if (src) src.setData(store.toGeoJSON());
}

export function flyToSpot(spot, zoom) {
  if (!map || !spot) return;
  map.flyTo({
    center: [spot.lng, spot.lat],
    zoom: Math.max(zoom ?? 16, map.getZoom()),
    duration: 900,
    essential: true,
  });
}

export function flyTo(center, zoom = 15) {
  map?.flyTo({ center, zoom, duration: 900, essential: true });
}

export const center = () => map?.getCenter();
export const canvasEl = () => map?.getCanvasContainer();

/** Variante gewechselt: Sticker-Groesse und Clusterfarben koennen andere sein. */
export function refreshSizes() {
  if (!map) return;
  if (map.getLayer(L_STICK)) map.setLayoutProperty(L_STICK, 'icon-size', iconSizeExpr());
  if (map.getLayer(L_CLUSTER)) {
    map.setPaintProperty(L_CLUSTER, 'circle-color', clusterColor());
    map.setPaintProperty(L_CLUSTER, 'circle-radius', clusterRadius());
  }
  if (map.getLayer(L_COUNT)) map.setPaintProperty(L_COUNT, 'text-color', clusterInk());
}

/* ── Init ────────────────────────────────────────────────────────────────── */

export async function init(container) {
  setLoad('start');

  map = new maplibregl.Map({
    container,
    style: baseStyle(),
    center: [12, 30],
    zoom: 1.4,
    minZoom: 1,
    maxZoom: 19,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    /* Der Long-Press braucht saubere Pointer-Events; Doppeltipp-Zoom wuerde
     * sich mit "kurz zweimal tippen" beissen, bleibt aber an, weil er
     * erwartet wird. */
  });
  map.touchZoomRotate.disableRotation();

  /* Artwork parallel zum Kartenstil laden. */
  loadArtwork()
    .then((img) => {
      artImg = cutout(img); // Hintergrund freistellen, dann erst stanzen
      stickerImage = buildDieCut(artImg);
      overlayURL = dieCutURL(artImg);
      registerImage();
      if (layersReady) addStickerLayer();
      emit('artwork:ready', { cut: artImg });
    })
    .catch((err) => console.warn('[map]', err));

  setLoad('mid');

  /* Harte Zeitgrenze: wenn der Stil in 9s nicht steht, ist er tot. */
  const styleTimeout = setTimeout(() => degrade('timeout'), 9000);

  map.on('load', () => {
    clearTimeout(styleTimeout);
    registerImage();
    installSpotLayers();
    setLoad('done');
  });

  map.on('error', (e) => {
    const status = e?.error?.status;
    /* Zwei verschiedene Fehler, zwei verschiedene Reaktionen:
     * TileJSON tot = harter Ausfall, sofort umschalten.
     * Vereinzelte Kachelfehler = nicht mitten in der Sitzung umschalten. */
    if (e?.sourceId === 'ofm' && !e?.tile) {
      degrade('tilejson');
      return;
    }
    if (status >= 400 && ++tileErrors > 14) degrade('tiles');
  });

  /* Cluster antippen -> aufloesen. In MapLibre 5 ist das ein Promise; ein per
   * Callback kopiertes Mapbox-Beispiel waere hier still ein No-Op. */
  map.on('click', L_CLUSTER, async (e) => {
    const f = e.features?.[0];
    if (!f) return;
    try {
      const z = await map.getSource(SRC).getClusterExpansionZoom(f.properties.cluster_id);
      map.easeTo({ center: f.geometry.coordinates, zoom: z, duration: 560 });
    } catch {
      map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2 });
    }
  });

  map.on('click', L_STICK, (e) => {
    const f = e.features?.[0];
    if (f) store.setSelected(f.properties.id);
  });

  for (const id of [L_CLUSTER, L_STICK]) {
    map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
  }

  document.getElementById('mapRetry')?.addEventListener('click', retry);

  return map;
}

export { SRC, L_STICK, L_CLUSTER };
