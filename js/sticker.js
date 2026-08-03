/* Das Nö-Artwork.
 *
 * Zwei Fassungen, beide einmalig beim Start erzeugt:
 *
 * 1. QUADRAT — so wie das PNG ist, mit cyanem Grund. Das ist die Fassung
 *    fuer die Karte: ein Sticker ist ein rechteckiges Stueck Papier, und
 *    nur so laesst er sich ueberzeugend aufkleben (siehe js/peel.js).
 *
 * 2. FREIGESTELLT — Hintergrund per Flood-Fill von den Raendern entfernt.
 *    Nur fuers UI: als Logo im gelben Kopfband und in den Leerzustaenden
 *    wuerde ein cyanes Kaestchen stoeren. Cyan INNERHALB der Buchstaben
 *    bleibt stehen, wie bei einem Stanzschnitt entlang der Aussenkontur.
 */

const ART_URL = 'noe.png';

/* Zielgroesse im Sprite-Atlas. Das Original ist 851x851 RGBA = 2.9 MB Textur
 * fuer etwas, das mit ~46 CSS-px gezeichnet wird. 256 @ pixelRatio 2 ergibt
 * 128 CSS-px — reichlich Reserve, und der Atlas laeuft nicht ueber. */
const ATLAS_PX = 256;

let artPromise = null;
let cutoutCanvas = null;

/** Laedt noe.png einmal und gibt das HTMLImageElement zurueck. */
export function loadArtwork() {
  if (!artPromise) {
    artPromise = new Promise((res, rej) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('noe.png konnte nicht geladen werden'));
      img.src = ART_URL;
    });
  }
  return artPromise;
}

/**
 * Das unveraenderte Quadrat als ImageData — fuer map.addImage().
 * Der Umweg ueber Canvas laundert nebenbei paletten-optimierte PNGs, bei
 * denen addImage sonst ueber die erwartete Bytelaenge stolpert.
 */
export function squareImageData(img, size = ATLAS_PX) {
  const s = size / Math.max(img.width, img.height);
  const w = Math.round(img.width * s);
  const h = Math.round(img.height * s);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Entfernt den Hintergrund per Flood-Fill von allen vier Raendern.
 * @param {HTMLImageElement} img
 * @param {number} tol Farbabstand, ab dem ein Pixel NICHT mehr als Hintergrund gilt
 * @returns {HTMLCanvasElement}
 */
export function cutout(img, { tol = 76, size = 512 } = {}) {
  if (cutoutCanvas) return cutoutCanvas;

  const s = size / Math.max(img.width, img.height);
  const W = Math.round(img.width * s);
  const H = Math.round(img.height * s);

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);

  const data = ctx.getImageData(0, 0, W, H);
  const p = data.data;

  /* Referenzfarbe: Mittel der vier Ecken. Robuster als eine einzelne Ecke,
   * falls das PNG einen Rand oder eine Kompressionsspur hat. */
  const corner = (x, y) => {
    const i = (y * W + x) * 4;
    return [p[i], p[i + 1], p[i + 2]];
  };
  const cs = [corner(0, 0), corner(W - 1, 0), corner(0, H - 1), corner(W - 1, H - 1)];
  const ref = [0, 1, 2].map((k) => Math.round(cs.reduce((a, c) => a + c[k], 0) / cs.length));

  const tol2 = tol * tol;
  const near = (i) => {
    const dr = p[i] - ref[0];
    const dg = p[i + 1] - ref[1];
    const db = p[i + 2] - ref[2];
    return dr * dr + dg * dg + db * db <= tol2;
  };

  /* Iterative Flood-Fill (kein Rekursions-Stackoverflow bei 512x512). */
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, x + (H - 1) * W);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);

  while (stack.length) {
    const idx = stack.pop();
    if (idx < 0 || idx >= W * H || seen[idx]) continue;
    const i = idx * 4;
    if (!near(i)) continue;
    seen[idx] = 1;
    p[i + 3] = 0;
    const x = idx % W;
    if (x > 0) stack.push(idx - 1);
    if (x < W - 1) stack.push(idx + 1);
    stack.push(idx - W, idx + W);
  }

  /* Kantenglaettung: Pixel, die an freigestellte grenzen und noch stark nach
   * Hintergrundfarbe aussehen, teilweise transparent machen — sonst bleibt
   * ein harter cyanfarbener Saum. */
  const alpha = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) alpha[i] = p[i * 4 + 3];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const idx = y * W + x;
      if (alpha[idx] === 0) continue;
      const touchesHole = !alpha[idx - 1] || !alpha[idx + 1] || !alpha[idx - W] || !alpha[idx + W];
      if (!touchesHole) continue;
      const i = idx * 4;
      const dr = p[i] - ref[0];
      const dg = p[i + 1] - ref[1];
      const db = p[i + 2] - ref[2];
      const d = Math.sqrt(dr * dr + dg * dg + db * db);
      if (d < tol * 1.9) p[i + 3] = Math.round(255 * Math.min(1, d / (tol * 1.9)));
    }
  }

  ctx.putImageData(data, 0, 0);
  cutoutCanvas = cv;
  return cv;
}

/** Freigestelltes Nö als Data-URL — fuer Logo, Feed und die Seed-Fotos. */
export function cutoutURL(src) {
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  cv.getContext('2d').drawImage(src, 0, 0);
  return cv.toDataURL('image/png');
}

export { ATLAS_PX, ART_URL };
