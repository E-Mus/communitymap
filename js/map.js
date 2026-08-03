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
import { loadArtwork, squareImageData, buildStackImage, ART_URL } from './sticker.js';
import { stickOn } from './peel.js';
import * as store from './store.js';
import { emit } from './bus.js';

const SRC = 'spots';
const L_CLUSTER = 'clusters';
const L_COUNT = 'cluster-count';
const L_STICK = 'stickers';
/* Alle Ebenen, die zu den Sichtungen gehoeren — sie muessen einen
 * Stilwechsel ueberleben (siehe degrade()). Die Kartenlagen kommen unten
 * dazu, sobald ihre ids feststehen. */
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

/* Zusammengefasste Gruppen sind ein STAPEL Sticker, kein Punkt.
 *
 * Zwei Dinge kodieren die Menge:
 *   Farbe  — kleine Gruppen gelb, mittlere magenta, grosse cyan
 *   Hoehe  — je mehr Sichtungen, desto mehr Lagen im Stapel
 *
 * Die Textfarbe wandert zwingend mit der Fuellfarbe — gelbe Zahl auf gelber
 * Karte waere weg, und Schwarz auf Magenta liegt bei nur ~3.6:1.
 *
 * Weil ein Symbol-Layer sein Bild ueber einen Namen waehlt, werden alle
 * Kombinationen einmal vorgebacken (3 Farben x 5 Hoehen = 15 kleine Bilder)
 * und per Ausdruck zusammengesetzt: "stack-<hoehe>-<farbe>". */
const CL_BREAK = [10, 50]; // Farbstufen
const CL_TIERS = [
  { key: 'a', fill: '--cl-1', ink: '--cl-1-ink' }, // wenige
  { key: 'b', fill: '--cl-2', ink: '--cl-2-ink' }, // viele
  { key: 'c', fill: '--cl-3', ink: '--cl-3-ink' }, // sehr viele
];

const clusterTierExpr = () => [
  'step', ['get', 'point_count'],
  CL_TIERS[0].key, CL_BREAK[0],
  CL_TIERS[1].key, CL_BREAK[1],
  CL_TIERS[2].key,
];

const cardImageExpr = () => ['concat', 'card-', clusterTierExpr()];

function clusterInk() {
  return [
    'step', ['get', 'point_count'],
    resolveColor(CL_TIERS[0].ink, Y), CL_BREAK[0],
    resolveColor(CL_TIERS[1].ink, Y), CL_BREAK[1],
    resolveColor(CL_TIERS[2].ink, Y),
  ];
}

/* ── Der Stapel raffelt sich zusammen ─────────────────────────────────────
 *
 * Jede Lage ist eine eigene Symbol-Ebene mit einem eigenen icon-translate.
 * Dieser Versatz haengt am ZOOM: nah beieinander weit draussen, weit
 * auseinander kurz bevor die Gruppen ohnehin verschwinden. Beim Rauszoomen
 * fliegen die Karten also sichtbar zusammen und legen sich zum Stapel.
 *
 * Warum so und nicht per Animation in JavaScript: icon-translate ist eine
 * Paint-Eigenschaft und laesst sich ueber den Zoom interpolieren. Damit
 * rechnet MapLibre die Bewegung auf der GPU aus — kein Timer, kein
 * setData pro Frame, keine DOM-Knoten. Und sie haengt direkt an der Geste
 * statt an einer festen Dauer: wer langsam zoomt, sieht es langsam.
 *
 * Wie viele Lagen eine Gruppe zeigt, entscheidet der Filter jeder Ebene
 * ueber point_count — der Stapel waechst also mit der Menge. */
const CL_GATHER = [13.2, 13.99]; // gesammelt -> verstreut
const CARD_MIN = [0, 5, 15, 40, 100]; // ab so vielen Sichtungen gibt es diese Lage
const CARD_REST = [[0, 0], [-4, 9], [4, 18], [-3, 27], [3, 36]];
const CARD_SCATTER = [[2, -34], [-40, -4], [36, 10], [-28, 40], [30, 46]];

const cardLayerId = (lvl) => (lvl === 0 ? L_CLUSTER : `cluster-card-${lvl}`);
for (let lvl = 1; lvl < CARD_MIN.length; lvl++) SPOT_LAYERS.add(cardLayerId(lvl));

/* ['literal', [x, y]] ist Pflicht: ein rohes Array liest MapLibre als
 * Ausdruck (erstes Element = Operator) und lehnt die ganze Ebene ab. */
const cardTranslate = (lvl) => [
  'interpolate', ['linear'], ['zoom'],
  CL_GATHER[0], ['literal', CARD_REST[lvl]],
  CL_GATHER[1], ['literal', CARD_SCATTER[lvl]],
];

/* Weiche Uebergaenge.
 *
 * Kameraflug: easeInOutCubic statt der linearen Voreinstellung — die Bewegung
 * setzt sanft an und laeuft sanft aus, statt an beiden Enden zu rucken. */
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* Stapel loesen sich auf, statt zu verschwinden.
 *
 * MapLibre fragt Kacheln auf ganzzahligen Zoomstufen ab. Mit
 * clusterMaxZoom 13 gibt es Gruppen also bis einschliesslich Kartenzoom
 * 13.99 und ab 14.0 schlagartig nicht mehr — die Stapel waeren von einem
 * Frame auf den naechsten weg.
 *
 * Der Uebergang liegt bewusst erst im LETZTEN Stueck davor. Ein frueherer
 * Bogen (etwa ab 13.3) sieht auf dem Papier weicher aus, laesst die Gruppen
 * aber schon bei Zoom 13.5 auf 69% verblassen — und das ist eine Stufe, auf
 * der man normal stoebert und auf der die Stapel die einzige Darstellung von
 * ~36 Sichtungen sind. Nachgemessen: bei 13.5 stehen dort acht Gruppen. */
const CL_FADE = [13.7, 13.99];
const clusterFade = () => [
  'interpolate', ['linear'], ['zoom'],
  CL_FADE[0], 1,
  CL_FADE[1], 0,
];

/* Eine Stapelkarte soll ungefaehr so gross sein wie ein einzelner Sticker.
 * Die Bilder liegen mit pixelRatio 2 im Atlas, eine Karte ist 76 Atlas-px
 * breit — bei icon-size 1 also 38 CSS-px. */
const clusterIconSize = () => [
  'interpolate', ['linear'], ['zoom'],
  3, 0.78,
  9, 0.95,
  13, 1.15,
];

/* Eine einzelne Karte je Farbstufe — den Stapel bauen die Ebenen selbst.
 * Muss nach jedem setStyle erneut laufen: addImage-Bilder ueberleben einen
 * Stilwechsel nicht. */
function registerStackImages() {
  if (!map) return;
  for (const tier of CL_TIERS) {
    const id = `card-${tier.key}`;
    if (map.hasImage(id)) continue;
    try {
      map.addImage(id, buildStackImage({ extra: 0, color: resolveColor(tier.fill, M) }), {
        pixelRatio: 2,
      });
    } catch (err) {
      console.warn('[map] addImage', id, err);
    }
  }
}

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
  try {
    buildSpotLayers();
  } catch (err) {
    /* Ohne das scheitert der Aufbau still: die Karte laedt, aber es gibt
     * keine Sticker, und in der Konsole steht nichts. */
    console.error('[map] Sichtungs-Ebenen konnten nicht aufgebaut werden', err);
  }
}

function buildSpotLayers() {

  map.addSource(SRC, {
    type: 'geojson',
    data: store.toGeoJSON(),
    cluster: true,
    clusterRadius: 52,
    clusterMaxZoom: 13, // ab z14 immer einzelne Nös
    promoteId: 'id',
  });

  /* Von der untersten Lage zur obersten, damit die oberste Karte die
   * darunterliegenden ueberdeckt. Lage 0 traegt die id `clusters` — daran
   * haengen Klick und Abfragen. */
  for (let lvl = CARD_MIN.length - 1; lvl >= 0; lvl--) {
    map.addLayer({
      id: cardLayerId(lvl),
      type: 'symbol',
      source: SRC,
      filter: CARD_MIN[lvl]
        ? ['all', ['has', 'point_count'], ['>=', ['get', 'point_count'], CARD_MIN[lvl]]]
        : ['has', 'point_count'],
      layout: {
        'icon-image': cardImageExpr(),
        'icon-size': clusterIconSize(),
        /* Gruppen duerfen nie wegfallen — sonst fehlen auf der Weltkarte
         * ganze Regionen, ohne dass irgendwo ein Fehler steht. */
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center',
        'icon-rotation-alignment': 'viewport',
        'icon-pitch-alignment': 'viewport',
      },
      paint: {
        'icon-opacity': clusterFade(),
        'icon-opacity-transition': { duration: 250, delay: 0 },
        'icon-translate': cardTranslate(lvl),
        /* In Bildschirmpixeln, nicht in Kartenrichtung — der Stapel soll
         * immer gleich liegen, egal wie die Karte steht. */
        'icon-translate-anchor': 'viewport',
      },
    });
  }

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
      'text-ignore-placement': true,
    },
    /* Kein Versatz noetig: das Stapelbild ist so gebaut, dass die oberste
     * Karte in der Bildmitte sitzt — die Zahl landet also genau darauf.
     * Die Zahl blendet mit dem Stapel aus, sonst schwebte sie kurz allein. */
    paint: {
      'text-color': clusterInk(),
      'text-opacity': clusterFade(),
      'text-opacity-transition': { duration: 250, delay: 0 },
      /* Die Zahl reitet auf der obersten Karte mit, auch waehrend die
       * Lagen auseinanderfliegen. */
      'text-translate': cardTranslate(0),
      'text-translate-anchor': 'viewport',
    },
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
    paint: {
      'icon-opacity': 1,
      /* Der ausgewaehlte Sticker wird unter dem DOM-Overlay ausgeblendet —
       * mit Uebergang statt hartem Schnitt. */
      'icon-opacity-transition': { duration: 200, delay: 0 },
    },
  });
}

function registerImage() {
  if (!map) return;
  registerStackImages();
  if (!stickerImage || map.hasImage('noe')) return;
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

/* Aufbau:  .ov  >  .ov__in  >  img
 * Die Drehung sitzt auf .ov__in und nicht auf .ov, weil MapLibre das
 * Marker-Element selbst per transform positioniert — eine eigene Drehung
 * dort wuerde jeden Frame ueberschrieben. .ov__in ist ausserdem genau das
 * Element, dessen Inhalt der Peel austauscht. */
function makeOverlayEl(spot, cls) {
  const el = document.createElement('div');
  el.className = `ov ${cls}`;
  const inner = document.createElement('div');
  inner.className = 'ov__in';
  inner.style.setProperty('--rot', `${spot.rot || 0}deg`);
  const img = document.createElement('img');
  img.className = 'ov__img';
  img.src = overlayURL;
  img.alt = 'Nö';
  img.draggable = false;
  inner.append(img);
  el.append(inner);
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

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Der Sticker wird aufgeklebt und dann an den Symbol-Layer uebergeben.
 *
 * Die Animation ist ein rueckwaerts laufender Peel (js/peel.js): der Sticker
 * startet hochgeklappt und legt sich flach auf die Karte.
 *
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

  const el = makeOverlayEl(spot, 'ov--placing');
  const m = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat([spot.lng, spot.lat])
    .addTo(map);
  overlay = m;

  try {
    navigator.vibrate?.(18); // iOS Safari kann das in keiner Version — reines Extra
  } catch {
    /* egal */
  }

  /* Der Peel laeuft auf .ov__in, dem inneren Knoten mit der Drehung. */
  if (!reducedMotion()) {
    await stickOn(el.querySelector('.ov__in'), 720);
  }

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

/* Gemeinsame Flugkurve fuer alle Kamerabewegungen.
 * `curve` steuert, wie weit die Kamera zwischendurch herauszoomt: 1.42 ist
 * MapLibres Standard, etwas flacher wirkt bei kurzen Wegen ruhiger. */
const FLY = { duration: 900, curve: 1.3, easing: easeInOutCubic, essential: true };

export function flyToSpot(spot, zoom) {
  if (!map || !spot) return;
  map.flyTo({
    ...FLY,
    center: [spot.lng, spot.lat],
    zoom: Math.max(zoom ?? 16, map.getZoom()),
  });
}

export function flyTo(center, zoom = 15) {
  map?.flyTo({ ...FLY, center, zoom });
}

export const center = () => map?.getCenter();
export const canvasEl = () => map?.getCanvasContainer();

/** Nach einem Stilwechsel: Groessen und Clusterfarben neu setzen. */
export function refreshSizes() {
  if (!map) return;
  if (map.getLayer(L_STICK)) map.setLayoutProperty(L_STICK, 'icon-size', iconSizeExpr());
  for (let lvl = 0; lvl < CARD_MIN.length; lvl++) {
    const id = cardLayerId(lvl);
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, 'icon-image', cardImageExpr());
    map.setLayoutProperty(id, 'icon-size', clusterIconSize());
    map.setPaintProperty(id, 'icon-opacity', clusterFade());
    map.setPaintProperty(id, 'icon-translate', cardTranslate(lvl));
  }
  if (map.getLayer(L_COUNT)) {
    map.setPaintProperty(L_COUNT, 'text-color', clusterInk());
    map.setPaintProperty(L_COUNT, 'text-opacity', clusterFade());
    map.setPaintProperty(L_COUNT, 'text-translate', cardTranslate(0));
  }
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
    /* Symbole, die durch Kollision wegfallen, blenden weich weg statt zu
     * springen. Greift nicht bei icon-allow-overlap, schadet aber nie. */
    fadeDuration: 250,
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
      /* Auf der Karte das unveraenderte Quadrat mit cyanem Grund — ein
       * Sticker ist ein rechteckiges Stueck Papier, und nur so laesst er
       * sich ueberzeugend aufkleben. */
      artImg = img;
      stickerImage = squareImageData(img);
      overlayURL = ART_URL;
      registerImage();
      if (layersReady) addStickerLayer();
      emit('artwork:ready', { img });
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
  /* Auf JEDER Stapellage, nicht nur der obersten — die unteren ragen heraus
   * und ein Tipper darauf soll genauso aufklappen. */
  const onClusterClick = async (e) => {
    const f = e.features?.[0];
    if (!f) return;
    try {
      const z = await map.getSource(SRC).getClusterExpansionZoom(f.properties.cluster_id);
      map.easeTo({
        center: f.geometry.coordinates,
        zoom: z,
        duration: 650,
        easing: easeInOutCubic,
      });
    } catch {
      map.easeTo({
        center: f.geometry.coordinates,
        zoom: map.getZoom() + 2,
        duration: 650,
        easing: easeInOutCubic,
      });
    }
  };

  const cardLayers = CARD_MIN.map((_, lvl) => cardLayerId(lvl));
  for (const id of cardLayers) map.on('click', id, onClusterClick);

  map.on('click', L_STICK, (e) => {
    const f = e.features?.[0];
    if (f) store.setSelected(f.properties.id);
  });

  for (const id of [...cardLayers, L_STICK]) {
    map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
  }

  document.getElementById('mapRetry')?.addEventListener('click', retry);

  return map;
}

export { SRC, L_STICK, L_CLUSTER };
