/* Winziger Event-Bus.
 *
 * Die Disziplin, die diese App vor Spaghetti bewahrt:
 *   Module importieren `store` und `bus`. Module importieren einander NIE.
 *   main.js ist der einzige Ort, an dem modueluebergreifend verdrahtet wird.
 *   Einzige Ausnahme: map.js exportiert eine imperative API.
 */

const subs = new Map();

export function on(type, fn) {
  if (!subs.has(type)) subs.set(type, new Set());
  subs.get(type).add(fn);
  return () => subs.get(type).delete(fn);
}

export function emit(type, detail) {
  const set = subs.get(type);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(detail);
    } catch (err) {
      console.error(`[bus] handler failed for "${type}"`, err);
    }
  }
}

/* rAF-Koaleszenz fuer teure Renderfunktionen: ein Schwall Events (Seeding,
 * Import, Mehrfachaenderung) soll den Feed einmal neu zeichnen, nicht fuenfmal. */
const queued = new Set();
export function schedule(fn) {
  if (queued.has(fn)) return;
  queued.add(fn);
  requestAnimationFrame(() => {
    queued.delete(fn);
    fn();
  });
}
