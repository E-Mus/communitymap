/* Demo-Daten.
 *
 * Die "Fotos" werden ZUR LAUFZEIT aus einem gesaeten PRNG erzeugt, nicht als
 * Data-URIs ausgeliefert: deterministisch ueber Reloads und Geraete hinweg,
 * und es kostet null Bytes im Transfer. Jede Sichtung bekommt dadurch ein
 * eigenes Bild statt fuenf recycelter Platzhalter.
 *
 * Alle erzeugten Bilder bleiben strikt in C/M/Y/K.
 */

/* Kein Import aus store.js — store.js importiert seedSpots() von hier, und
 * ein Zyklus waere fragil. Die Tag-ids unten stehen bewusst als Literale. */

/* ── PRNG ────────────────────────────────────────────────────────────────── */
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rngFor = (id) => mulberry32(hash32(id));

/* ── Geografie ───────────────────────────────────────────────────────────── */

/* Strassenzuege in Friedrichshain (grob). Sichtungen werden entlang dieser
 * Linien gestreut statt gleichmaessig in eine Box — sonst kleben die Haelfte
 * der Sticker mitten in Hoefen und es sieht sofort erfunden aus. */
const FHAIN_STREETS = [
  [[13.4487, 52.506], [13.4497, 52.515]],   // warschauer str
  [[13.449, 52.5075], [13.46, 52.509]],     // revaler str
  [[13.454, 52.5085], [13.4548, 52.5125]],  // simon-dach-str
  [[13.452, 52.5105], [13.468, 52.5115]],   // boxhagener str
  [[13.448, 52.5175], [13.47, 52.5155]],    // rigaer str
  [[13.454, 52.5155], [13.475, 52.514]],    // frankfurter allee
  [[13.448, 52.512], [13.465, 52.5125]],    // gruenberger str
  [[13.457, 52.509], [13.47, 52.51]],       // wuehlischstr
];

const WORLD = [
  [13.405, 52.52, 'berlin mitte'],
  [9.9937, 53.5511, 'hamburg'],
  [11.582, 48.1351, 'münchen'],
  [16.3738, 48.2082, 'wien'],
  [8.5417, 47.3769, 'zürich'],
  [4.9041, 52.3676, 'amsterdam'],
  [4.3517, 50.8503, 'brüssel'],
  [2.3522, 48.8566, 'paris'],
  [-0.1276, 51.5074, 'london'],
  [-6.2603, 53.3498, 'dublin'],
  [12.4964, 41.9028, 'rom'],
  [2.1734, 41.3851, 'barcelona'],
  [-9.1393, 38.7223, 'lissabon'],
  [12.5683, 55.6761, 'kopenhagen'],
  [18.0686, 59.3293, 'stockholm'],
  [21.0122, 52.2297, 'warschau'],
  [14.4378, 50.0755, 'prag'],
  [23.7275, 37.9838, 'athen'],
  [28.9784, 41.0082, 'istanbul'],
  [-74.006, 40.7128, 'new york'],
  [-118.2437, 34.0522, 'los angeles'],
  [-99.1332, 19.4326, 'mexiko-stadt'],
  [-46.6333, -23.5505, 'são paulo'],
  [-58.3816, -34.6037, 'buenos aires'],
  [139.6503, 35.6762, 'tokio'],
  [151.2093, -33.8688, 'sydney'],
  [18.4241, -33.9249, 'kapstadt'],
  [3.3792, 6.5244, 'lagos'],
];

/* Tag-Kombinationen, die zueinander passen. Stadt+Land und Indoor+Outdoor
 * schliessen sich gegenseitig aus — der Seed soll nicht Unsinn behaupten. */
const COMBOS = [
  ['stadt', 'outdoor'],
  ['stadt', 'outdoor', 'schild'],
  ['stadt', 'outdoor', 'hoehe'],
  ['stadt', 'indoor', 'klo'],
  ['stadt', 'outdoor', 'fahrzeug'],
  ['stadt', 'indoor'],
  ['land', 'outdoor'],
  ['land', 'outdoor', 'schild'],
  ['stadt', 'outdoor', 'hoehe', 'schild'],
  ['stadt', 'indoor', 'fahrzeug'],
];

function alongStreet(street, t, rnd) {
  const [[x1, y1], [x2, y2]] = street;
  const lng = x1 + (x2 - x1) * t;
  const lat = y1 + (y2 - y1) * t;
  /* seitlicher Versatz: Sticker kleben am Rand, nicht auf der Fahrbahn */
  const side = rnd() < 0.5 ? -1 : 1;
  return [lng + side * (0.00004 + rnd() * 0.00012), lat + side * (0.00002 + rnd() * 0.00008)];
}

export function seedSpots() {
  const now = Date.now();
  const spots = [];
  const push = (id, lng, lat, i) => {
    const rnd = rngFor(id);
    spots.push({
      id,
      lng: +lng.toFixed(5),
      lat: +lat.toFixed(5),
      tags: COMBOS[Math.floor(rnd() * COMBOS.length)].slice(),
      /* Foto wird lazy erzeugt; null hiesse "kein Foto", deshalb der Marker */
      photo: rnd() < 0.78 ? '@seed' : null,
      likes: Math.floor(rnd() * 180) + 1,
      reports: 0,
      ts: now - Math.floor(rnd() * 92 + i * 0.7) * 864e5 - Math.floor(rnd() * 864e5),
      rot: Math.round(rnd() * 16 - 8),
    });
  };

  // ~40 in Friedrichshain
  let n = 0;
  FHAIN_STREETS.forEach((street, si) => {
    const count = 5;
    for (let i = 0; i < count; i++) {
      const id = `s${String(n).padStart(2, '0')}`;
      const rnd = rngFor(id + 'geo');
      const [lng, lat] = alongStreet(street, (i + 0.5) / count + (rnd() - 0.5) * 0.12, rnd);
      push(id, lng, lat, n);
      n++;
    }
  });

  // weltweit, damit Weltansicht und Clustering ueberhaupt etwas zeigen
  WORLD.forEach(([lng, lat], i) => {
    const id = `w${String(i).padStart(2, '0')}`;
    const rnd = rngFor(id + 'geo');
    push(id, lng + (rnd() - 0.5) * 0.02, lat + (rnd() - 0.5) * 0.02, n);
    n++;
  });

  return spots;
}

/* ── Prozedurale Fotos ───────────────────────────────────────────────────── */

const C = '#009DE0';
const M = '#C4007A';
const Y = '#FFF300';
const K = '#000000';
const INKS = [C, M, Y];

let artwork = null;
const cache = new Map();

/** Wird von main.js gesetzt, sobald noe.png geladen ist. */
export function setArtwork(img) {
  artwork = img;
  cache.clear();
}

/* Halbton: Raster in einer Druckfarbe, Dichte folgt einem Verlauf.
 *
 * Bewusst RECHTECKE auf ganzzahligen Koordinaten, keine Kreise und keine
 * gedrehte Matrix. Grund: antialiaste Kreiskanten mischen die Punktfarbe mit
 * dem Untergrund, und bei dichtem Raster verschmelzen diese Saeume zu einer
 * Flaeche — cyane Punkte auf Gelb lesen dann schlicht als Gruen. Genau das
 * ist der Palettenverstoss, den es hier nicht geben darf.
 * Die versetzten Zeilen geben den diagonalen Rasterlook ohne Drehung. */
function halftone(ctx, w, h, ink, cell) {
  const c = Math.max(3, Math.round(cell));
  ctx.fillStyle = ink;
  let row = 0;
  for (let y = 0; y < h; y += c, row++) {
    const offset = row % 2 ? Math.round(c / 2) : 0;
    for (let x = -offset; x < w; x += c) {
      const d = 1 - y / h;
      const s = Math.round(c * (0.18 + d * 0.62));
      if (s < 1) continue;
      ctx.fillRect(x, y, s, s);
    }
  }
}

/* Ein paar Kulissen, damit die 68 Bilder nicht alle gleich aussehen.
 *
 * AUSSCHLIESSLICH fillRect auf ganzzahligen Koordinaten — kein stroke(), kein
 * arc(). Jede antialiaste Kante mischt zwei Druckfarben zu einer dritten, und
 * bei den duennen Rasterlinien einer Kachelwand summiert sich das zu einer
 * sichtbaren Mischfarbe. Ein Rechteckraster ist ausserdem naeher am Siebdruck
 * als eine weichgezeichnete Illustration. */
const r_ = (v) => Math.round(v);
const box = (ctx, x, y, w, h, color) => {
  ctx.fillStyle = color;
  ctx.fillRect(r_(x), r_(y), r_(w), r_(h));
};
/* Rahmen aus vier Balken statt strokeRect */
const frame = (ctx, x, y, w, h, t, color) => {
  box(ctx, x, y, w, t, color);
  box(ctx, x, y + h - t, w, t, color);
  box(ctx, x, y, t, h, color);
  box(ctx, x + w - t, y, t, h, color);
};

const SCENES = [
  function pole(ctx, w, h, rnd, ink) {
    const x = w * (0.34 + rnd() * 0.3);
    const bw = w * (0.14 + rnd() * 0.08);
    box(ctx, x, 0, bw, h, ink);
    box(ctx, x, 0, 3, h, K);
    box(ctx, x + bw - 3, 0, 3, h, K);
    return [x + bw / 2, h * (0.34 + rnd() * 0.3), Math.min(bw * 1.5, w * 0.3)];
  },
  function sign(ctx, w, h, rnd, ink) {
    const bw = w * (0.46 + rnd() * 0.2);
    const bh = bw * (0.66 + rnd() * 0.4);
    const x = (w - bw) / 2 + (rnd() - 0.5) * w * 0.12;
    const y = (h - bh) / 2 + (rnd() - 0.5) * h * 0.12;
    box(ctx, x, y, bw, bh, ink);
    frame(ctx, x, y, bw, bh, 5, K);
    box(ctx, w / 2 - 4, y + bh, 8, h - y - bh, K);
    return [x + bw / 2, y + bh / 2, bw * 0.6];
  },
  function tiles(ctx, w, h, rnd, ink) {
    const cols = 3 + Math.floor(rnd() * 3);
    const cw = Math.round(w / cols);
    const rows = Math.ceil(h / cw);
    box(ctx, Math.floor(rnd() * cols) * cw, Math.floor(rnd() * rows) * cw, cw, cw, ink);
    for (let i = 0; i <= cols; i++) box(ctx, i * cw - 2, 0, 4, h, K);
    for (let j = 0; j <= rows; j++) box(ctx, 0, j * cw - 2, w, 4, K);
    return [w * (0.3 + rnd() * 0.4), h * (0.3 + rnd() * 0.4), w * 0.34];
  },
  function door(ctx, w, h, rnd, ink) {
    const bw = w * (0.5 + rnd() * 0.16);
    const x = (w - bw) / 2;
    const y = h * 0.08;
    box(ctx, x, y, bw, h - y, ink);
    frame(ctx, x, y, bw, h - y, 6, K);
    box(ctx, x + bw * 0.84, h * 0.54, 14, 8, K); // Klinke
    return [x + bw * 0.42, h * (0.3 + rnd() * 0.22), bw * 0.52];
  },
  function bin(ctx, w, h, rnd, ink) {
    const bw = w * 0.44;
    const bh = h * 0.6;
    const x = (w - bw) / 2;
    const y = h - bh;
    box(ctx, x, y, bw, bh, ink);
    box(ctx, x - 8, y - 14, bw + 16, 14, K);
    return [x + bw / 2, y + bh * 0.42, bw * 0.66];
  },
  function wall(ctx, w, h, rnd, ink) {
    box(ctx, 0, 0, w, h, ink);
    const rows = 5 + Math.floor(rnd() * 3);
    const rh = Math.round(h / rows);
    for (let j = 1; j < rows; j++) box(ctx, 0, j * rh - 1, w, 3, K);
    return [w * (0.3 + rnd() * 0.4), h * (0.3 + rnd() * 0.4), w * 0.4];
  },
];

/**
 * Erzeugt deterministisch ein "Foto" fuer eine Seed-Sichtung.
 * @param {string} id  Spot-id — gleiche id, gleiches Bild, immer.
 * @param {number} size Kantenlaenge in px (Breite; Hoehe = 3/4 davon).
 */
export function seedPhoto(id, size = 480) {
  const key = `${id}@${size}`;
  if (cache.has(key)) return cache.get(key);

  const w = size;
  const h = Math.round((size * 3) / 4);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const rnd = rngFor(id + 'photo');

  /* Untergrund: eine Druckfarbe oder Papier — haeufiger Papier, damit das
   * farbige Raster (siehe unten) oefter zum Zug kommt. */
  const bgInk = rnd() < 0.5 ? '#ffffff' : INKS[Math.floor(rnd() * 3)];
  ctx.fillStyle = bgInk;
  ctx.fillRect(0, 0, w, h);

  /* Halbton in einer ZWEITEN Farbe — bewusst DECKEND, nicht multipliziert.
   * Ueberdruck waere drucktechnisch richtiger, erzeugt aber zwangslaeufig
   * Farben ausserhalb der Palette: multiply(Cyan, Gelb) ist Gruen,
   * multiply(Cyan, Magenta) ein dunkles Blau. Die Regel lautet "nur C/M/Y/K",
   * also bleibt es bei zwei reinen Druckfarben uebereinander. */
  /* Zwei Regeln, beide aus demselben Problem geboren:
   *
   * 1. Rasterweite RELATIV zur Bildbreite. Sonst hat ein 320px-Bild dieselbe
   *    Zellgroesse wie ein 720px-Bild und wird beim Herunterskalieren zu Brei.
   *
   * 2. Das Raster ist immer SCHWARZ auf Farbe oder Farbe auf WEISS — nie
   *    Farbe auf Farbe. Sobald der Browser ein feines Raster verkleinert,
   *    mittelt er benachbarte Pixel: Cyan neben Gelb ergibt dann optisch
   *    Gruen. Schwarz auf Cyan ergibt gemittelt dunkleres Cyan und Magenta
   *    auf Weiss helleres Magenta — beides liest sich als "mehr oder weniger
   *    Farbe derselben Platte", also genau das, was ein Halbton bedeutet. */
  const dotInk = bgInk === '#ffffff' ? INKS[Math.floor(rnd() * 3)] : K;
  halftone(ctx, w, h, dotInk, (w / 26) * (0.8 + rnd() * 0.8));

  /* Kulisse — ebenfalls deckend, damit nichts mischt */
  const scene = SCENES[Math.floor(rnd() * SCENES.length)];
  const sceneInk = INKS[Math.floor(rnd() * 3)];
  const [sx, sy, ssize] = scene(ctx, w, h, rnd, sceneInk);

  /* Das Nö selbst */
  if (artwork) {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(((rnd() * 26 - 13) * Math.PI) / 180);
    const s = ssize * (0.8 + rnd() * 0.45);
    ctx.drawImage(artwork, -s / 2, -s / 2, s, s);
    ctx.restore();
  }

  /* Korn — schwarze Punkte, deckend. Halbtransparentes Schwarz waere ein
   * Grau und damit ausserhalb der Palette; einzelne harte Punkte lesen sich
   * ohnehin mehr nach Druck als eine graue Schleier-Ebene. */
  ctx.fillStyle = K;
  for (let i = 0; i < w * 0.5; i++) {
    ctx.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
  }

  /* PNG, nicht JPEG: die DCT-Kompression setzt an jeder harten Kante
   * Ringing-Artefakte, und die sind per Definition Mischfarben. Bei einer
   * Flaechengrafik aus vier Farben ist PNG ausserdem kleiner. */
  const url = cv.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

/** Auflösen des '@seed'-Markers zu einem echten Bild. */
export function photoSrc(spot, size = 480) {
  if (!spot.photo) return null;
  return spot.photo === '@seed' ? seedPhoto(spot.id, size) : spot.photo;
}
