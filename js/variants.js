/* Variantenwechsler.
 *
 * Der Trick, der die Bandbreite rettet: @font-face-Regeln in einem Stylesheet,
 * das nie eingehaengt ist, werden NIE geladen. Jede vN.css bringt ihre eigenen
 * Schriften mit, und es haengt immer nur genau eine im Dokument. Kaltstart
 * laedt also die Schriften EINER Variante, nicht fuenf.
 *
 * Und: erst tauschen, dann data-variant umschalten. Andersherum blitzt fuer
 * ein paar Frames das neue Layout mit den alten Schriften auf.
 */

import * as store from './store.js';
import { emit } from './bus.js';

/* `feedFirst` ist der einzige Fall, in dem eine Variante mehr als CSS braucht:
 * Galerie startet in der Liste und nicht auf der Karte. Steht bewusst hier als
 * Datenfeld statt als if-Zweig irgendwo im UI-Code. */
export const VARIANTS = [
  { n: '1', name: 'prototyp', note: 'anybody · archivo · martian mono — breite statt gewicht' },
  { n: '2', name: 'hi-vis', note: 'messapia · apfel grotezk · necto mono — siebdruck-plakat' },
  { n: '3', name: 'zine', note: 'rubik spray paint · bricolage · space mono — fotokopie' },
  { n: '4', name: 'galerie', note: 'sprat · instrument sans · dm mono — kunsthalle', feedFirst: true },
  { n: '5', name: 'terminal', note: 'recursive · departure mono — eine achse, drei rollen' },
  { n: '6', name: 'cmyk', note: 'wie 1, aber das ui steht auf cyan · cluster wechseln die druckfarbe' },
];

export const byId = (n) => VARIANTS.find((v) => v.n === String(n));

let switching = false;

export function setVariant(n, { persist = true } = {}) {
  n = String(n);
  if (!VARIANTS.some((v) => v.n === n) || switching) return;

  const link = document.getElementById('variant-css');
  const href = `css/v${n}.css`;
  if (link.getAttribute('href') === href) {
    document.documentElement.dataset.variant = n;
    return;
  }

  switching = true;
  const next = document.createElement('link');
  next.rel = 'stylesheet';
  next.href = href;

  const commit = () => {
    link.replaceWith(next);
    next.id = 'variant-css';
    document.documentElement.dataset.variant = n;
    if (persist) store.setVariant(n);
    const num = document.getElementById('variantNum');
    if (num) num.textContent = n;
    switching = false;
    emit('variant', { n });
  };

  next.addEventListener('load', commit, { once: true });
  /* Wenn das Stylesheet nicht laedt, darf die App nicht haengenbleiben. */
  next.addEventListener('error', commit, { once: true });
  setTimeout(() => {
    if (switching) commit();
  }, 2500);

  document.head.append(next);
}

/* Die anderen vier im Leerlauf vorholen, sobald der Nutzer das Stilmenue
 * oeffnet — dann fuehlt sich das Umschalten sofort an, ohne den Kaltstart
 * zu belasten. */
let prefetched = false;
export function prefetchOthers() {
  if (prefetched) return;
  prefetched = true;
  const cur = document.documentElement.dataset.variant;
  for (const v of VARIANTS) {
    if (v.n === cur) continue;
    const l = document.createElement('link');
    l.rel = 'prefetch';
    l.as = 'style';
    l.href = `css/v${v.n}.css`;
    document.head.append(l);
  }
}

export function renderList(onPick) {
  const total = document.getElementById('variantTotal');
  if (total) total.textContent = String(VARIANTS.length);
  const ul = document.getElementById('varList');
  if (!ul) return;
  ul.replaceChildren();
  for (const v of VARIANTS) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-current', String(document.documentElement.dataset.variant === v.n));
    const s = document.createElement('strong');
    s.textContent = `${v.n} · ${v.name}`;
    const sm = document.createElement('small');
    sm.textContent = v.note;
    b.append(s, sm);
    b.addEventListener('click', () => onPick(v.n));
    li.append(b);
    ul.append(li);
  }
}
