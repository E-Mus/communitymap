/* Lange auf die Karte tippen, um einen Sticker zu setzen.
 *
 * MapLibre hat kein longpress-Event (Issue #373, seit Jahren offen). Drei
 * Fallen, die die naheliegende Umsetzung auf echter Hardware zerlegen:
 *
 *  1. NICHT bei touchmove abbrechen. Ein ruhender Finger erzeugt auf
 *     kapazitiven Displays laufend touchmove durch Subpixel-Jitter und
 *     Kontaktflaechen-Drift. Wer darauf abbricht, hat ein Feature, das im
 *     Desktop-Emulator funktioniert und am Telefon nie ausloest.
 *     Stattdessen: grosszuegige Pointer-Distanz-Schwelle.
 *
 *  2. MapLibres movestart/zoomstart feuern AUCH bei programmatischem
 *     flyTo/easeTo. Ohne die originalEvent-Pruefung killt eine Animation
 *     woanders in der App still den Long-Press.
 *
 *  3. contextmenu ist NICHT mouse-only — Chrome Android feuert es beim langen
 *     Tippen ebenfalls. Ohne Entdopplung loest der Sticker doppelt aus.
 */

const DEFAULTS = { ms: 500, slop: 14 };

export function installLongPress(map, onLongPress, opts = {}) {
  const { ms, slop } = { ...DEFAULTS, ...opts };
  const el = map.getCanvasContainer();

  let timer = null;
  let pid = null;
  let sx = 0;
  let sy = 0;
  let lngLat = null;
  let fired = false;

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    pid = null;
    lngLat = null;
  };

  const at = (clientX, clientY) => {
    const r = el.getBoundingClientRect();
    return map.unproject([clientX - r.left, clientY - r.top]);
  };

  const fire = () => {
    if (!lngLat) return;
    const ll = lngLat;
    fired = true;
    cancel();
    try {
      navigator.vibrate?.(15);
    } catch {
      /* egal */
    }
    onLongPress(ll);
  };

  el.addEventListener(
    'pointerdown',
    (e) => {
      fired = false;
      if (e.pointerType === 'mouse' && e.button !== 0) return; // Rechtsklick -> contextmenu
      if (pid !== null) {
        cancel(); // zweiter Finger = Pinch
        return;
      }
      pid = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
      lngLat = at(e.clientX, e.clientY);
      timer = setTimeout(fire, ms);
    },
    { passive: true }
  );

  el.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerId !== pid || !timer) return;
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > slop) cancel();
    },
    { passive: true }
  );

  /* Android verschluckt gelegentlich eins dieser drei — alle drei binden. */
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    el.addEventListener(
      t,
      (e) => {
        if (e.pointerId === pid) cancel();
      },
      { passive: true }
    );
  }

  /* MapLibres eigene Gestenerkennung ist die Autoritaet dafuer, ob geschwenkt
   * wird — sie bringt eine geraetegetunte clickTolerance mit. Aber nur bei
   * echten Nutzergesten, daher die originalEvent-Pruefung. */
  for (const ev of ['movestart', 'dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) {
    map.on(ev, (e) => {
      if (e?.originalEvent) cancel();
    });
  }

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault(); // unterdrueckt das native Menue
    if (fired) return; // unser Timer war schneller (Android)
    lngLat = at(e.clientX, e.clientY);
    fire();
  });

  /* Ein Long-Press darf nicht zusaetzlich als Klick durchgehen und etwas
   * auswaehlen oder abwaehlen. */
  map.on('click', () => {
    if (fired) fired = false;
  });

  return {
    destroy: cancel,
    get fired() {
      return fired;
    },
  };
}

/** War der letzte Klick ein Long-Press? Fuer Aufrufer, die ihn schlucken wollen. */
export function swallowedClick(handle) {
  return handle?.fired === true;
}
