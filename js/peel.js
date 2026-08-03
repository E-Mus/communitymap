/* Aufkleben statt Abziehen.
 *
 * peel-js (Andrew Plummer, MIT, vendor/peel.js) ist dafuer gebaut, dass man
 * einen Sticker mit dem Finger ABZIEHT. Hier laeuft es andersherum: der
 * Sticker startet fast ganz hochgeklappt und legt sich flach auf die Karte.
 *
 * Technisch macht die Bibliothek das mit drei uebereinanderliegenden Ebenen
 * (bottom / top / back), die entlang der Peel-Linie per SVG-clipPath geteilt
 * werden; die Rueckseite wird an dieser Linie gespiegelt. Wir brauchen davon
 * nur zwei Methoden:
 *
 *   setPeelPath(...)      — eine kubische Bezierkurve, auf der die Ecke laeuft
 *   setTimeAlongPath(t)   — Position auf dieser Kurve, 0..1
 *
 * Damit laesst sich der Ablauf skripten, statt ihn zu ziehen.
 */

/* Ecke unten rechts. peel-js zaehlt: 0 = oben links, 3 = unten rechts. */
const CORNER_BOTTOM_RIGHT = 3;

const OPTS = {
  corner: CORNER_BOTTOM_RIGHT,
  setPeelOnInit: false,
  /* Alle Schatten und Reflexe aus.
   *
   * peel-js zeichnet sie als halbtransparente Schwarz- und Weissverlaeufe.
   * Ueber Cyan ergibt das ein stumpfes Dunkeltuerkis, ueber Gelb ein Oliv —
   * also Farben ausserhalb der Palette, und das an der auffaelligsten Stelle
   * der ganzen App. Die Tiefenwirkung tragen hier die Geometrie und der
   * Farbwechsel Vorderseite/Rueckseite (cyan gegen gelb). */
  bottomShadow: false,
  topShadow: false,
  backShadow: false,
  backReflection: false,
};

/** Markup, das peel-js erwartet. */
function markup(src) {
  return (
    '<div class="peel">' +
    '<div class="peel-bottom"></div>' +
    `<div class="peel-top"><img src="${src}" alt="" draggable="false"></div>` +
    `<div class="peel-back"><img src="${src}" alt="" draggable="false"></div>` +
    '</div>'
  );
}

/* Die Bahn der Ecke: kommt weit oben links herein und schwingt auf ihre
 * Ruhelage unten rechts. Werte relativ zur Stickergroesse, damit dieselbe
 * Kurve bei jeder Markergroesse gleich aussieht. */
function setPath(p, w, h) {
  p.setPeelPath(
    -0.62 * w, -0.70 * h, // Start: fast ganz hochgeklappt
    -0.30 * w, -0.55 * h, // Kontrollpunkt 1
    0.45 * w, 0.28 * h,   // Kontrollpunkt 2
    w, h                  // Ende: flach aufgeklebt
  );
}

/* Der erste Abschnitt der Kurve zeigt fast nur Traegerpapier — dort zu
 * starten sieht aus wie ein Fehler. Deshalb erst ab hier. */
const T_START = 0.24;

export const supported = () => typeof Peel !== 'undefined' && Peel.supported;

function destroy(p) {
  try {
    p.removeEvents?.();
    /* peel-js parkt seine erzeugten clipPaths in einem <defs> weit ausserhalb
     * des Sichtfelds. Ohne Aufraeumen bleiben die pro Sticker im Dokument. */
    for (const clip of [p.topClip, p.backClip]) {
      const el = clip?.shape?.parentNode?.parentNode;
      if (el?.parentNode) el.parentNode.removeChild(el);
    }
  } catch {
    /* Interna der Bibliothek — wenn sie sich aendern, ist ein Leck
     * unschoen, aber kein Grund, die Animation abzubrechen. */
  }
}

/**
 * Klebt den Sticker in `el` auf: laeuft den Peel von hochgeklappt auf flach.
 * Stellt danach den urspruenglichen Inhalt wieder her.
 *
 * @param {HTMLElement} el   Container mit einem <img> darin
 * @param {number} duration  Dauer in ms
 * @returns {Promise<void>}  loest auf, wenn wieder flach
 */
export function stickOn(el, duration = 720) {
  return new Promise((resolve) => {
    if (!el || !supported()) return resolve();

    const img = el.querySelector('img');
    const src = img?.getAttribute('src');
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!src || !w || !h) return resolve();

    const flat = el.innerHTML;
    el.innerHTML = markup(src);

    let p;
    try {
      p = new Peel(el.firstElementChild, OPTS);
    } catch {
      el.innerHTML = flat; // im Zweifel lieber ohne Effekt als kaputt
      return resolve();
    }

    setPath(p, w, h);
    p.setTimeAlongPath(T_START);

    const start = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      destroy(p);
      el.innerHTML = flat;
      resolve();
    };

    /* Sicherheitsnetz: in einem Hintergrund-Tab laeuft requestAnimationFrame
     * nicht: ohne den Timeout bliebe der Sticker fuer immer hochgeklappt. */
    const guard = setTimeout(finish, duration + 400);

    (function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      p.setTimeAlongPath(T_START + (1 - T_START) * eased);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        clearTimeout(guard);
        finish();
      }
    })(start);
  });
}

/** Statisch angehobene Ecke — fuer den Sticker, der am Cursor haengt. */
export function hold(el, t = 0.78) {
  if (!el || !supported()) return null;
  const img = el.querySelector('img');
  const src = img?.getAttribute('src');
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (!src || !w || !h) return null;

  el.innerHTML = markup(src);
  try {
    const p = new Peel(el.firstElementChild, OPTS);
    setPath(p, w, h);
    p.setTimeAlongPath(t);
    return p;
  } catch {
    return null;
  }
}
