/* Boot + die EINZIGE Stelle, an der Module miteinander verdrahtet werden.
 *
 * Jedes andere Modul kennt nur `store` und `bus`. Wer hier Reaktionen
 * hinzufuegt, sieht in einer Bildschirmhoehe, was auf was reagiert — genau
 * darum steht das alles beisammen. */

import * as store from './store.js';
import * as mapmod from './map.js';
import * as ui from './ui.js';
import * as share from './share.js';
import * as search from './search.js';
import { on } from './bus.js';
import { loadArtwork, cutout, cutoutURL } from './sticker.js';
import { setArtwork } from './seed.js';
import { installLongPress } from './gestures.js';
import { tryLogin, logout, DEMO_PASSWORD } from './admin.js';

const $ = (id) => document.getElementById(id);

/* ── Sticker setzen ──────────────────────────────────────────────────────── */

function beginAdd(lngLat) {
  const c = lngLat || mapmod.center();
  if (!c) return;
  store.state.pending = { lng: c.lng, lat: c.lat, tags: [], photo: null };
  ui.openSheet();
}

async function commitSpot() {
  const p = store.state.pending;
  if (!p) return;
  const spot = store.makeSpot(p);
  try {
    store.addSpot(spot);
  } catch (err) {
    if (err instanceof store.QuotaError) return quotaFallback(spot, err);
    throw err;
  }
  ui.closeSheet();
  await mapmod.slap(spot);
  ui.toast('geklebt.', {
    action: 'rückgängig',
    onAction: () => {
      store.removeSpot(spot.id);
      store.setSelected(null);
      ui.toast('wieder abgezogen.');
    },
  });
}

/* Bei vollem Speicher gibt es drei ECHTE Optionen statt einer Sackgasse —
 * und niemals stilles Verdraengen aelterer Fotos. */
function quotaFallback(spot, err) {
  const mb = (err.bytes / 1048576).toFixed(1);
  ui.toast(`speicher voll (${mb} mb) — foto weglassen?`, {
    action: 'ohne foto',
    warn: true,
    ms: 9000,
    onAction: async () => {
      try {
        store.addSpot({ ...spot, photo: null });
        ui.closeSheet();
        await mapmod.slap(spot);
        ui.toast('ohne foto geklebt.');
      } catch {
        ui.toast('speicher ist wirklich voll. lösch ein paar sichtungen.', { warn: true });
      }
    },
  });
}

/* ── Fadenkreuz ──────────────────────────────────────────────────────────── */
let crossActive = false;

function openCross(hint) {
  if (!store.state.pending) beginAdd();
  crossActive = true;
  $('sheet').hidden = true;
  $('scrim').hidden = true;
  $('cross').hidden = false;
  $('crossHint').innerHTML = `<span>${hint || 'karte schieben, dann bestätigen'}</span>`;
}

function closeCross(commit) {
  crossActive = false;
  $('cross').hidden = true;
  if (commit) {
    const c = mapmod.center();
    if (c && store.state.pending) {
      store.state.pending.lng = c.lng;
      store.state.pending.lat = c.lat;
    }
  }
  ui.openSheet();
}

/* ── Standort ────────────────────────────────────────────────────────────── */
function useLocation() {
  if (!window.isSecureContext) {
    ui.toast('standort braucht https — tippe stattdessen lang auf die karte.', { warn: true });
    return;
  }
  const btn = $('useLoc');
  btn.disabled = true;
  btn.textContent = 'suche …';
  const done = () => {
    btn.disabled = false;
    btn.textContent = 'mein standort';
  };

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      done();
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      if (!store.state.pending) beginAdd({ lng, lat });
      store.state.pending.lng = lng;
      store.state.pending.lat = lat;
      mapmod.flyTo([lng, lat], 17);
      /* WLAN-Ortung liegt am Desktop routinemaessig kilometerweit daneben.
       * Das als Sichtung zu speichern waere gelogen — also erst genauer machen. */
      if (accuracy > 100) {
        openCross(`genauigkeit ±${Math.round(accuracy)} m — pin genauer setzen`);
      } else {
        ui.syncSheet();
        ui.openSheet();
      }
    },
    (err) => {
      done();
      const msg =
        err.code === err.PERMISSION_DENIED
          ? 'standort abgelehnt — tippe lang auf die karte.'
          : err.code === err.TIMEOUT
            ? 'standort dauert zu lange — tippe lang auf die karte.'
            : 'standort nicht ermittelbar — tippe lang auf die karte.';
      ui.toast(msg, { warn: true });
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
  );
}

/* ── Router ──────────────────────────────────────────────────────────────── */
function handleRoute() {
  const r = share.route();
  if (!r) return;

  if (r.kind === 'broken') {
    ui.toast('dieser link ist unterwegs kaputtgegangen.', { warn: true });
    share.clearRoute();
    return;
  }

  if (r.kind === 'seed') {
    const spot = store.state.byId.get(r.id);
    if (!spot) {
      ui.toast('dieser nö existiert nur auf einem anderen gerät.', { warn: true });
      share.clearRoute();
      return;
    }
    store.setSelected(spot.id);
    mapmod.flyToSpot(spot, 17);
    return;
  }

  const decoded = share.decode(r.code);
  if (!decoded) {
    ui.toast('dieser link ist unterwegs kaputtgegangen.', { warn: true });
    share.clearRoute();
    return;
  }
  /* NICHT in den Store mischen: das wuerde Daten erfinden, beim Reload ohne
   * Hash Geister hinterlassen und beim zweiten Oeffnen duplizieren. Der
   * importierte Sticker lebt als EIN transientes Objekt. */
  const imported = { ...decoded, id: '@import', ts: Date.now() };
  store.state.imported = imported;
  store.state.selectedId = null;
  mapmod.showImported(imported);
  mapmod.flyTo([imported.lng, imported.lat], 17);
  ui.renderDetail(imported, { imported: true });
}

/* ── Suche ───────────────────────────────────────────────────────────────── */
let searchTimer = null;

function renderResults(items, note) {
  const ul = $('searchResults');
  ul.replaceChildren();
  if (note) {
    const li = document.createElement('li');
    li.className = 'hint';
    li.textContent = note;
    ul.append(li);
  }
  for (const it of items) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    const b = document.createElement('b');
    b.textContent = it.title;
    const s = document.createElement('small');
    s.textContent = it.sub;
    li.append(b, s);
    li.addEventListener('click', () => {
      ul.hidden = true;
      $('searchInput').value = '';
      if (it.kind === 'spot') {
        store.setSelected(it.id);
        mapmod.flyToSpot({ lng: it.lng, lat: it.lat }, 17);
      } else {
        mapmod.flyTo([it.lng, it.lat], it.kind === 'coords' ? 17 : 14);
      }
      if (innerWidth < 900) ui.setFeedOpen(false);
    });
    ul.append(li);
  }
  ul.hidden = !ul.childElementCount;
}

function runSearch(q) {
  const ul = $('searchResults');
  if (q.trim().length < 2) {
    ul.hidden = true;
    return;
  }

  /* Koordinaten zuerst: braucht kein Netz und ist immer eindeutig. */
  const co = search.parseCoords(q);
  const local = search.localHits(q, store.visibleSpots(), store.tagLabel);
  const instant = [];
  if (co) {
    instant.push({
      kind: 'coords',
      title: ui.fmtCoords(co.lat, co.lng),
      sub: 'koordinaten',
      lng: co.lng,
      lat: co.lat,
    });
  }
  instant.push(...local);
  renderResults(instant);

  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const hits = await search.geocode(q);
    if ($('searchInput').value !== q) return; // Nutzer hat weitergetippt
    if (hits === null) {
      renderResults(instant, instant.length ? null : search.offlineNote());
      return;
    }
    renderResults([...instant, ...hits]);
  }, 300);
}

/* ── Verdrahtung ─────────────────────────────────────────────────────────── */
function wire() {
  /* Feed */
  $('menuBtn').addEventListener('click', () => ui.setFeedOpen(true));
  $('feedClose').addEventListener('click', () => ui.setFeedOpen(false));

  $('feedTabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t) store.setFeedTab(t.dataset.tab);
  });

  $('cards').addEventListener('click', (e) => {
    const like = e.target.closest('[data-like-for]');
    const card = e.target.closest('.card');
    if (like && card) {
      e.stopPropagation();
      store.toggleLike(like.dataset.likeFor);
      return;
    }
    if (!card) return;
    const spot = store.state.byId.get(card.dataset.id);
    if (!spot) return;
    store.setSelected(spot.id);
    mapmod.flyToSpot(spot, 17);
    if (innerWidth < 900) ui.setFeedOpen(false);
  });

  /* Suche */
  $('searchInput').addEventListener('input', (e) => runSearch(e.target.value));
  $('searchInput').addEventListener('blur', () => {
    setTimeout(() => ($('searchResults').hidden = true), 160);
  });

  /* Hinzufuegen */
  $('addBtn').addEventListener('click', () => beginAdd());
  $('sheetClose').addEventListener('click', () => ui.closeSheet());
  $('scrim').addEventListener('click', () => {
    ui.closeSheet();
    ui.closeModal('adminSheet');
  });

  $('tagPick').addEventListener('click', (e) => {
    const b = e.target.closest('.pill');
    if (!b || !store.state.pending) return;
    const t = b.dataset.tag;
    const list = store.state.pending.tags;
    const i = list.indexOf(t);
    if (i < 0) list.push(t);
    else list.splice(i, 1);
    b.setAttribute('aria-pressed', String(i < 0));
  });

  $('useLoc').addEventListener('click', useLocation);
  $('usePick').addEventListener('click', () => openCross());
  $('crossOk').addEventListener('click', () => closeCross(true));
  $('crossCancel').addEventListener('click', () => closeCross(false));
  $('locBtn').addEventListener('click', () => {
    if (!window.isSecureContext) return;
    navigator.geolocation.getCurrentPosition(
      (p) => mapmod.flyTo([p.coords.longitude, p.coords.latitude], 16),
      () => ui.toast('standort nicht verfügbar.', { warn: true }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });

  $('photoInput').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f || !store.state.pending) return;
    try {
      const url = await ui.downscale(f);
      /* Vorpruefung beim Auswaehlen, nicht erst beim Speichern — dem Nutzer
       * erst nach dem Taggen zu sagen, dass sein Foto zu gross ist, ist
       * schlechtes Benehmen. */
      if (url.length * 2 > 3_500_000) {
        store.state.pending.photo = await ui.downscale(f, { max: 480, quality: 0.5 });
        ui.toast('foto war sehr gross — stärker komprimiert.');
      } else {
        store.state.pending.photo = url;
      }
      ui.syncSheet();
    } catch {
      ui.toast('foto konnte nicht gelesen werden.', { warn: true });
    }
    e.target.value = '';
  });

  $('photoDrop').addEventListener('click', () => {
    if (store.state.pending) store.state.pending.photo = null;
    ui.syncSheet();
  });

  $('stickBtn').addEventListener('click', () => {
    commitSpot().catch((err) => {
      console.error(err);
      ui.toast('konnte nicht gespeichert werden.', { warn: true });
    });
  });

  /* Detail */
  $('panelClose').addEventListener('click', () => {
    store.state.imported = null;
    share.clearRoute();
    store.setSelected(null);
  });

  $('likeBtn').addEventListener('click', () => {
    const id = $('likeBtn').dataset.likeFor;
    if (id) store.toggleLike(id);
  });

  $('shareBtn').addEventListener('click', async () => {
    const s = store.state.byId.get(store.state.selectedId);
    if (!s) return;
    const url = share.urlFor(s, store.state.seedIds.has(s.id));
    const res = await share.share(url);
    if (res === 'copied') ui.toast('link kopiert.');
    else if (res === 'failed') ui.toast(url);
  });

  $('reportBtn').addEventListener('click', () => {
    const id = store.state.selectedId;
    if (!id) return;
    const r = store.toggleReport(id);
    if (r.already) return;
    if (r.hidden) {
      ui.toast(`${store.REPORT_LIMIT}× gemeldet — verborgen.`, { warn: true });
      store.setSelected(null);
    } else {
      ui.toast(`gemeldet (${r.reports}/${store.REPORT_LIMIT}).`);
      $('reportBtn').textContent = 'gemeldet';
      $('reportBtn').disabled = true;
    }
  });

  $('delBtn').addEventListener('click', () => {
    const id = store.state.selectedId;
    if (!id) return;
    const spot = store.removeSpot(id);
    store.setSelected(null);
    ui.toast('gelöscht.', {
      action: 'rückgängig',
      onAction: () => {
        try {
          store.addSpot(spot);
        } catch {
          ui.toast('konnte nicht wiederhergestellt werden.', { warn: true });
        }
      },
    });
  });

  /* Geteilter Link */
  $('importAdd').addEventListener('click', async () => {
    const imp = store.state.imported;
    if (!imp) return;
    const spot = store.makeSpot({ lng: imp.lng, lat: imp.lat, tags: imp.tags });
    try {
      store.addSpot(spot);
    } catch {
      ui.toast('speicher voll.', { warn: true });
      return;
    }
    store.state.imported = null;
    share.clearRoute();
    await mapmod.slap(spot);
    ui.toast('zu deiner karte hinzugefügt.');
  });

  $('importDrop').addEventListener('click', () => {
    store.state.imported = null;
    share.clearRoute();
    mapmod.setSelected(null);
    ui.renderDetail(null);
  });

  /* Admin */
  $('adminBtn').addEventListener('click', () => {
    if (store.state.admin) {
      logout();
      ui.toast('abgemeldet.');
      return;
    }
    ui.openModal('adminSheet');
    $('adminPw').value = '';
    $('adminPw').focus();
  });
  $('adminClose').addEventListener('click', () => ui.closeModal('adminSheet'));
  const doLogin = () => {
    if (tryLogin($('adminPw').value)) {
      ui.closeModal('adminSheet');
      ui.toast('angemeldet — löschen und meldungen sind jetzt sichtbar.');
    } else {
      ui.toast(`falsch. das demo-passwort ist „${DEMO_PASSWORD}".`, { warn: true });
    }
  };
  $('adminGo').addEventListener('click', doLogin);
  $('adminPw').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  /* Lightbox: Klick aufs Foto im Detail zeigt es gross. */
  $('panelShot').addEventListener('click', () => {
    const id = $('panelShot').dataset.spot;
    const spot = id && store.state.byId.get(id);
    if (spot) ui.openLightbox(spot);
  });
  $('lightboxClose').addEventListener('click', () => ui.closeLightbox());
  /* Klick daneben schliesst, Klick aufs Bild nicht. */
  $('lightbox').addEventListener('click', (e) => {
    if (e.target.tagName !== 'IMG') ui.closeLightbox();
  });

  /* Tastatur */
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (ui.closeLightbox()) return; // liegt ganz oben, geht zuerst zu
    if (!$('sheet').hidden) return ui.closeSheet();
    if (!$('adminSheet').hidden) return ui.closeModal('adminSheet');
    if (crossActive) return closeCross(false);
    if (store.state.selectedId || store.state.imported) {
      store.state.imported = null;
      share.clearRoute();
      return store.setSelected(null);
    }
    ui.setFeedOpen(false);
  });

  addEventListener('hashchange', handleRoute);
}

/* ── Boot ────────────────────────────────────────────────────────────────── */
async function boot() {
  const { volatile } = store.init();
  if (volatile) {
    const bar = document.createElement('div');
    bar.className = 'volatile';
    bar.textContent = 'speicher nicht verfügbar — deine nös verschwinden beim neuladen';
    document.body.prepend(bar);
  }

  ui.renderTagPicker();
  ui.renderFeed();

  /* Am Desktop ist das Menue eine echte Spalte und startet offen; am Handy
   * verdeckt es die ganze Karte und startet deshalb zu. Schliessen geht
   * ueberall — die Spalte klappt dann auf Breite 0. */
  ui.setFeedOpen(matchMedia('(min-width: 900px)').matches);

  if (!window.isSecureContext) {
    const b = $('locBtn');
    b.disabled = true;
    b.title = 'standort braucht https';
  }

  await mapmod.init('map');

  /* Ueberall wo "Nö" steht, steht das freigestellte Artwork — Logo, Buttons,
   * Leerzustaende und die prozeduralen Seed-Fotos benutzen dieselbe Grafik
   * wie die Kartenmarker. */
  loadArtwork()
    .then((img) => {
      const cut = cutout(img);
      setArtwork(cut);
      const url = cutoutURL(cut);
      for (const el of document.querySelectorAll('img.noe')) el.src = url;
      ui.renderFeed();
    })
    .catch(() => {});

  /* ── Reaktionen. Alles, was modueluebergreifend passiert, steht hier. ── */
  on('spots:changed', () => mapmod.syncSource());
  on('spots:changed', () => ui.scheduleFeed());
  on('spot:like', (d) => ui.patchLike(d)); // gezielter Patch, KEIN Re-Render
  on('spot:report', (d) => ui.patchReport(d));
  on('feed:tab', () => ui.renderFeed());
  on('select', ({ id }) => {
    mapmod.setSelected(id);
    ui.renderDetail(id ? store.state.byId.get(id) : null);
  });

  wire();

  installLongPress(mapmod.map, (lngLat) => {
    if (crossActive) return;
    beginAdd(lngLat);
  });

  handleRoute();

  window.__noe = { store, map: mapmod, ui, share };
}

boot().catch((err) => {
  console.error(err);
  const el = $('fatal');
  if (el) el.hidden = false;
});

$('fatalReload')?.addEventListener('click', () => location.reload());
for (const ev of ['error', 'unhandledrejection']) {
  addEventListener(ev, () => {
    const el = $('fatal');
    if (el) el.hidden = false;
  });
}
