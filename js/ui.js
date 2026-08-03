/* UI: Feed, Detail, Sheet, Toast.
 *
 * Rendert ueber den Bus, aber NICHT alles bei jeder Aenderung: Likes feuern
 * ein eigenes Event und werden gezielt gepatcht (siehe patchLike). Ein Like
 * hat keine Kartendarstellung und keinen Einfluss auf die Sortierung des
 * gerade sichtbaren Tabs, also gibt es nichts neu zu zeichnen ausser der Zahl.
 */

import * as store from './store.js';
import { schedule } from './bus.js';
import { photoSrc } from './seed.js';

const $ = (id) => document.getElementById(id);

/* ── Koordinaten im Format des Prototyps ─────────────────────────────────── */
function dms(value, posChar, negChar) {
  const hemi = value >= 0 ? posChar : negChar;
  const abs = Math.abs(value);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = Math.round((mFloat - m) * 60);
  const mm = s === 60 ? m + 1 : m;
  const ss = s === 60 ? 0 : s;
  return `${d}° ${String(mm).padStart(2, '0')}′ ${String(ss).padStart(2, '0')}″ ${hemi}`;
}
export const fmtCoords = (lat, lng) => `${dms(lat, 'N', 'S')}, ${dms(lng, 'E', 'W')}`;

const relTime = (ts) => {
  const d = Math.floor((Date.now() - ts) / 864e5);
  if (d <= 0) return 'heute';
  if (d === 1) return 'gestern';
  if (d < 30) return `vor ${d} tagen`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `vor ${mo} mon.` : `vor ${Math.floor(mo / 12)} j.`;
};

/* ── Toast mit Undo ──────────────────────────────────────────────────────── */
let toastTimer = null;

export function toast(msg, { action, onAction, warn = false, ms = 5000 } = {}) {
  const el = $('toast');
  if (!el) return;
  clearTimeout(toastTimer);
  el.className = `toast${warn ? ' toast--warn' : ''}`;
  el.replaceChildren();

  const span = document.createElement('span');
  span.textContent = msg;
  el.append(span);

  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action;
    b.addEventListener('click', () => {
      hideToast();
      onAction?.();
    });
    el.append(b);
  }
  el.hidden = false;
  toastTimer = setTimeout(hideToast, ms);
}

export function hideToast() {
  clearTimeout(toastTimer);
  const el = $('toast');
  if (el) el.hidden = true;
}

/* ── Feed ────────────────────────────────────────────────────────────────── */
function cardFor(spot) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card';
  btn.dataset.id = spot.id;
  btn.setAttribute('role', 'option');
  btn.setAttribute('aria-selected', String(store.state.selectedId === spot.id));

  /* 320 ist ein Kompromiss ueber alle fuenf Varianten: gross genug fuer die
   * Bildkacheln in Variante 4, klein genug, dass die 64px-Miniatur in
   * Variante 1/2/5 nicht zu Matsch skaliert. */
  const src = photoSrc(spot, 320);
  if (src) {
    const img = document.createElement('img');
    img.className = 'card__shot';
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    btn.append(img);
  } else {
    /* Kein Foto: statt einer leeren Box ein grosses Nö. */
    const d = document.createElement('div');
    d.className = 'card__shot card__shot--empty';
    const i = document.createElement('img');
    i.className = 'noe';
    i.src = document.querySelector('img.noe')?.src || 'noe.png';
    i.alt = '';
    d.append(i);
    btn.append(d);
  }

  const body = document.createElement('div');
  body.className = 'card__body';

  const tags = document.createElement('p');
  tags.className = 'card__tags';
  tags.textContent = spot.tags.length ? spot.tags.map(store.tagLabel).join(' · ') : 'ohne tags';
  body.append(tags);

  const co = document.createElement('p');
  co.className = 'card__co';
  co.textContent = `${relTime(spot.ts)} · ${spot.lat.toFixed(4)}, ${spot.lng.toFixed(4)}`;
  body.append(co);

  if (spot.reports > 0) {
    const f = document.createElement('p');
    f.className = 'card__flag';
    f.textContent = store.isHidden(spot)
      ? `${spot.reports}× gemeldet — verborgen`
      : `${spot.reports}× gemeldet`;
    body.append(f);
  }
  btn.append(body);

  const like = document.createElement('span');
  like.className = 'like';
  like.dataset.likeFor = spot.id;
  if (store.state.liked.has(spot.id)) like.dataset.on = '';
  like.innerHTML = '<span class="like__heart" aria-hidden="true">♥</span><span class="n"></span>';
  like.querySelector('.n').textContent = spot.likes;
  btn.append(like);

  li.append(btn);
  return li;
}

export function renderFeed() {
  const list = $('cards');
  if (!list) return;
  const spots = store.feedSpots();
  list.replaceChildren(...spots.map(cardFor));

  if (!spots.length) {
    const li = document.createElement('li');
    li.className = 'hint';
    li.textContent =
      store.state.feedTab === 'gemeldet' ? 'nichts gemeldet.' : 'noch keine sichtungen.';
    list.append(li);
  }

  for (const t of document.querySelectorAll('#feedTabs .tab')) {
    t.setAttribute('aria-selected', String(t.dataset.tab === store.state.feedTab));
  }
  const adminTab = document.querySelector('.tab--admin');
  if (adminTab) adminTab.hidden = !store.state.admin;

  renderMeter();
}

/* Gezielter Patch statt Neurendern — laeuft ueber alle Stellen, die diese id
 * anzeigen (Feed-Karte UND Detail-Panel). */
export function patchLike({ id, likes, liked }) {
  for (const el of document.querySelectorAll(`[data-like-for="${CSS.escape(id)}"]`)) {
    el.querySelector('.n').textContent = likes;
    if (liked) el.dataset.on = '';
    else delete el.dataset.on;
  }
}

export function patchReport({ id, reports }) {
  const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"] .card__body`);
  if (!card) return;
  let f = card.querySelector('.card__flag');
  if (!f) {
    f = document.createElement('p');
    f.className = 'card__flag';
    card.append(f);
  }
  f.textContent = `${reports}× gemeldet`;
}

function renderMeter() {
  const el = $('meter');
  if (!el) return;
  if (store.volatile) {
    el.textContent = 'speicher: nicht verfügbar';
    return;
  }
  const { bytes, max } = store.usage();
  const mb = (bytes / 1048576).toFixed(1);
  el.textContent = `speicher: ca. ${mb} / 5 mb · ${store.state.spots.length} sichtungen`;
}

/* ── Detail-Panel ────────────────────────────────────────────────────────── */
export function renderDetail(spot, { imported = false } = {}) {
  const panel = $('panel');
  if (!panel) return;

  if (!spot) {
    document.getElementById('app').dataset.panel = 'closed';
    setTimeout(() => {
      if (document.getElementById('app').dataset.panel === 'closed') panel.hidden = true;
    }, 320);
    return;
  }

  panel.hidden = false;

  $('panelBanner').hidden = !imported;

  const fig = $('panelShot');
  fig.replaceChildren();
  const src = imported ? null : photoSrc(spot, 720);
  if (src) {
    fig.className = 'shot shot--zoom';
    fig.dataset.spot = spot.id;
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Foto der Sichtung';
    fig.append(img);
  } else {
    delete fig.dataset.spot;
    fig.className = 'shot shot--empty';
    const i = document.createElement('img');
    i.className = 'noe';
    i.src = document.querySelector('img.noe')?.src || 'noe.png';
    i.alt = 'Nö';
    fig.append(i);
    if (imported) {
      const cap = document.createElement('figcaption');
      cap.className = 'hint';
      cap.textContent = 'kein foto im link — fotos passen nicht in eine url';
      fig.append(cap);
    }
  }

  const like = $('likeBtn');
  like.dataset.likeFor = imported ? '' : spot.id;
  like.hidden = imported;
  if (!imported) {
    like.querySelector('.n').textContent = spot.likes;
    if (store.state.liked.has(spot.id)) like.dataset.on = '';
    else delete like.dataset.on;
  }

  $('panelCoords').textContent = fmtCoords(spot.lat, spot.lng);

  const tl = $('panelTags');
  tl.replaceChildren();
  for (const t of spot.tags) {
    const li = document.createElement('li');
    li.textContent = store.tagLabel(t);
    tl.append(li);
  }

  $('shareBtn').hidden = imported;
  $('reportBtn').hidden = imported;
  $('reportBtn').textContent = store.state.reported.has(spot.id) ? 'gemeldet' : 'melden';
  $('reportBtn').disabled = store.state.reported.has(spot.id);
  $('delBtn').hidden = imported || !store.state.admin;

  requestAnimationFrame(() => {
    document.getElementById('app').dataset.panel = 'open';
  });

  for (const c of document.querySelectorAll('.card')) {
    c.setAttribute('aria-selected', String(c.dataset.id === spot.id));
  }
}

/* ── Sheet zum Hinzufuegen ───────────────────────────────────────────────── */
export function renderTagPicker() {
  const row = $('tagPick');
  if (!row) return;
  row.replaceChildren();
  for (const t of store.TAGS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill';
    b.dataset.tag = t.id;
    b.textContent = t.label;
    b.setAttribute('aria-pressed', 'false');
    row.append(b);
  }
}

export function syncSheet() {
  const p = store.state.pending;
  if (!p) return;
  $('sheetCoords').textContent = fmtCoords(p.lat, p.lng);
  for (const b of document.querySelectorAll('#tagPick .pill')) {
    b.setAttribute('aria-pressed', String(p.tags.includes(b.dataset.tag)));
  }
  const prev = $('photoPrev');
  if (p.photo) {
    $('photoImg').src = p.photo;
    prev.hidden = false;
  } else {
    prev.hidden = true;
  }
}

export function openSheet() {
  $('scrim').hidden = false;
  $('sheet').hidden = false;
  syncSheet();
}

export function closeSheet() {
  $('scrim').hidden = true;
  $('sheet').hidden = true;
  store.state.pending = null;
}

export function openModal(id) {
  $('scrim').hidden = false;
  $(id).hidden = false;
}
export function closeModal(id) {
  $(id).hidden = true;
  if ($('sheet').hidden && $('adminSheet').hidden) $('scrim').hidden = true;
}

/* ── Fotos ───────────────────────────────────────────────────────────────── */
/* Clientseitig herunterskalieren. localStorage deckelt bei ~5 MB und ein
 * unbehandeltes Handyfoto ist als base64 schnell 4 MB davon. */
export function downscale(file, { max = 720, quality = 0.7 } = {}) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s);
      cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      res(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error('Bild konnte nicht gelesen werden'));
    };
    img.src = url;
  });
}

/* ── Lightbox ────────────────────────────────────────────────────────────── */
/* Fuer die grosse Ansicht wird das Seed-Foto in hoeherer Aufloesung neu
 * erzeugt — die 720px-Fassung aus dem Detail waere auf einem grossen Schirm
 * sichtbar weich. Bei echten Nutzerfotos gibt es nur die eine gespeicherte
 * Fassung, photoSrc() liefert die dann unveraendert zurueck. */
let lastFocus = null;

export function openLightbox(spot) {
  const box = $('lightbox');
  const img = $('lightboxImg');
  const src = photoSrc(spot, 1400);
  if (!src) return;
  lastFocus = document.activeElement;
  img.src = src;
  img.alt = `Sichtung ${spot.tags.map(store.tagLabel).join(', ') || 'ohne tags'}`;
  $('lightboxMeta').textContent = fmtCoords(spot.lat, spot.lng);
  box.hidden = false;
  $('lightboxClose').focus();
}

export function closeLightbox() {
  const box = $('lightbox');
  if (box.hidden) return false;
  box.hidden = true;
  $('lightboxImg').removeAttribute('src');
  lastFocus?.focus?.();
  lastFocus = null;
  return true;
}

export const lightboxOpen = () => !$('lightbox').hidden;

/* ── Feed / Panel oeffnen ────────────────────────────────────────────────── */
export const setFeedOpen = (open) => {
  document.getElementById('app').dataset.feed = open ? 'open' : 'closed';
};

export const scheduleFeed = () => schedule(renderFeed);
