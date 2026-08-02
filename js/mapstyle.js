/* Kartenstil — weisses Papier, schwarze Strassen, graue Bloecke.
 *
 * Datenquelle: OpenFreeMap (keyless, OpenMapTiles-Schema).
 * Zwei Dinge, die man hier NICHT anders machen darf:
 *
 *  1. Die Source zeigt auf die TileJSON-URL, nicht auf ein {z}/{x}/{y}-Template.
 *     Der echte Kachelpfad enthaelt einen rotierenden Datums-Slug
 *     (.../planet/20260726_080001_pt/...), der sich beim naechsten Planet-Import
 *     aendert. Hardcoden = Karte stirbt in ein paar Tagen.
 *
 *  2. text-font enthaelt immer GENAU EINEN Font. MapLibre joint das Array mit
 *     Komma zu einem einzigen Fontstack-Request, und OpenFreeMap kennt nur drei
 *     einzelne Stacks. Geprueft:
 *        "Noto Sans Regular"                  -> 200
 *        "Noto Sans Regular,Noto Sans Bold"   -> 404
 */

export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const TILEJSON = 'https://tiles.openfreemap.org/planet';

/* Papier + die drei Grautoene. Muessen mit Tier 1 in base.css uebereinstimmen. */
const PAPER = '#ffffff';
const BLOCK = '#e8e8e8';
const WATER = '#ededed'; /* nicht #f2f2f2 — das waeren 1.5% gegen Weiss, unsichtbar */
const LABEL = '#9a9a9a';
const INK = '#000000';

/* Strassenbreiten. Basis 1.6 waechst schneller als linear, aber langsamer als
 * echte konstante Bodenbreite (das waere 2.0) — dadurch bleiben die Linien beim
 * Rauszoomen grafisch dick statt zu Haarlinien zu zerfallen. */
const widthMinor = [
  'interpolate', ['exponential', 1.6], ['zoom'],
  12, 0.4,
  14, 1.2,
  16, 3,
  18, 8,
  20, 22,
];

const widthMajor = [
  'interpolate', ['exponential', 1.6], ['zoom'],
  5, 0.5,
  10, 1.5,
  13, 3,
  16, 7,
  18, 16,
  20, 40,
];

const isLine = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];

/* Latin-Schrift ueberall, damit die Weltkarte lesbar bleibt statt in 30 Skripten
 * zu erscheinen. Faellt auf den lokalen Namen zurueck, wo es keine Transkription gibt. */
const nameField = ['coalesce', ['get', 'name:latin'], ['get', 'name']];

export function baseStyle() {
  return {
    version: 8,
    name: 'noemap',
    glyphs: GLYPHS,
    sources: {
      ofm: {
        type: 'vector',
        url: TILEJSON,
        attribution:
          '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · ' +
          '<a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · ' +
          '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': PAPER } },

      {
        id: 'water',
        type: 'fill',
        source: 'ofm',
        'source-layer': 'water',
        paint: { 'fill-color': WATER, 'fill-antialias': true },
      },

      /* Auf Weltebene gibt es keine Gebaeude (erst ab z13) und kaum Strassen.
       * Ohne Landesgrenzen waere der Startzustand ein weisses Nichts mit
       * schwebenden Clustern. */
      {
        id: 'boundary',
        type: 'line',
        source: 'ofm',
        'source-layer': 'boundary',
        filter: ['all', ['<=', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': INK,
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 4, 0.7, 8, 1, 12, 1.4],
        },
      },

      {
        id: 'buildings',
        type: 'fill',
        source: 'ofm',
        'source-layer': 'building',
        minzoom: 13,
        paint: { 'fill-color': BLOCK, 'fill-outline-color': BLOCK, 'fill-antialias': true },
      },

      {
        id: 'roads-minor',
        type: 'line',
        source: 'ofm',
        'source-layer': 'transportation',
        minzoom: 12,
        filter: [
          'all',
          isLine,
          ['match', ['get', 'class'], ['minor', 'service', 'track'], true, false],
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': INK, 'line-width': widthMinor },
      },

      {
        id: 'roads-major',
        type: 'line',
        source: 'ofm',
        'source-layer': 'transportation',
        minzoom: 5,
        filter: [
          'all',
          isLine,
          [
            'match',
            ['get', 'class'],
            ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
            true,
            false,
          ],
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': INK, 'line-width': widthMajor },
      },

      {
        id: 'place-labels',
        type: 'symbol',
        source: 'ofm',
        'source-layer': 'place',
        minzoom: 2,
        maxzoom: 12,
        filter: ['match', ['get', 'class'], ['country', 'city'], true, false],
        layout: {
          'text-field': nameField,
          'text-font': ['Noto Sans Regular'],
          'text-transform': 'lowercase',
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 9, 6, 11, 10, 13],
          'text-letter-spacing': 0.08,
          'text-padding': 6,
          'text-max-width': 8,
        },
        paint: { 'text-color': LABEL, 'text-halo-color': PAPER, 'text-halo-width': 1.4 },
      },

      {
        id: 'street-labels',
        type: 'symbol',
        source: 'ofm',
        'source-layer': 'transportation_name',
        minzoom: 14,
        filter: isLine,
        layout: {
          'symbol-placement': 'line',
          'text-field': nameField,
          'text-font': ['Noto Sans Regular'],
          'text-transform': 'lowercase',
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9, 18, 12],
          'text-letter-spacing': 0.06,
          'text-max-angle': 30, /* Default 45 laesst Labels um scharfe Ecken wickeln */
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'viewport',
          'symbol-spacing': 300,
          'text-padding': 4,
        },
        paint: { 'text-color': LABEL, 'text-halo-color': PAPER, 'text-halo-width': 1.4 },
      },
    ],
  };
}

/* Notfall-Stil: wenn die Kacheln gar nicht kommen, gibt es nichts zu retten —
 * aber ein leerer Stil sorgt dafuer, dass Cluster und Sticker weiter gerendert
 * werden koennen, statt dass die ganze Karte tot ist. Die Fehlerflaeche selbst
 * kommt aus dem CSS (schwarze Schraffur), nicht von hier. */
export function emptyStyle() {
  return {
    version: 8,
    name: 'noemap-offline',
    glyphs: GLYPHS,
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': PAPER } }],
  };
}
