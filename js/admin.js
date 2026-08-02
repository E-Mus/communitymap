/* Admin.
 *
 * Das ist bewusst Theater: das Passwort steht hier im Quelltext und die App
 * hat keinen Server, der irgendetwas pruefen koennte. Es bildet den Ablauf
 * ab (anmelden -> Melde-Warteschlange sehen -> loeschen), ohne so zu tun,
 * als waere das Sicherheit. Die UI sagt das auch.
 */

import * as store from './store.js';

export const DEMO_PASSWORD = 'nö';

export function tryLogin(input) {
  const v = String(input || '').trim().toLowerCase();
  const ok = v === DEMO_PASSWORD || v === 'noe' || v === 'no';
  if (ok) store.setAdmin(true);
  return ok;
}

export function logout() {
  store.setAdmin(false);
  if (store.state.feedTab === 'gemeldet') store.setFeedTab('neu');
}
