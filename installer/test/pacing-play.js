// Seam 3's driver: plays events into the Installer page's pacing (installer/page/pacing.js) as
// the page is sent them, and reads what's on screen at a given time.
import { begin, onScreen, reduce } from '../page/pacing.js';

/** @typedef {import('../page/pacing.js').Page} Page */

/**
 * A page that has connected to a run that had sent `before` events, then is sent `events`, ids
 * numbered from 1. Each is a [time, event] pair, sent at that time (in ms), or an event alone,
 * sent at `now`.
 * @param {([number, Record<string, unknown>] | Record<string, unknown>)[]} events
 * @param {{ before?: number, now?: number }} [options] `before`: 0 if not given; `now`: 0 if not given
 * @returns {Page}
 */
export function play(events, { before = 0, now = 0 } = {}) {
  let page = reduce(begin, { type: 'connected', before });
  events.forEach((entry, index) => {
    const [time, event] = Array.isArray(entry) ? entry : [now, entry];
    page = reduce(page, { type: 'event', event: /** @type {any} */ ({ id: index + 1, ...event }), now: time });
  });
  return page;
}

/**
 * What's on screen at `now`, typed loosely so a test can read the fields of whichever screen it
 * expects there.
 * @param {Page} page @param {number} now @returns {any}
 */
export const at = (page, now) => onScreen(reduce(page, { type: 'tick', now }));
