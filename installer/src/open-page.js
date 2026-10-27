import { messageOf } from './stop.js';
import * as ui from './ui.js';

/**
 * Shows a page's address on screen and opens it in the browser through the machine (under a
 * home override, the fake records it instead). A browser that won't start doesn't stop the run:
 * the address is on screen to copy.
 * @param {string} label What the page is, such as "Connectors page".
 * @param {string} url
 * @param {{ machine: import('./machine.js').Machine, log: { write(line: string): void } }} context
 */
export async function showPage(label, url, { machine, log }) {
  ui.step(`${label}: ${url}`);
  let opened = 'opened';
  try {
    await machine.openPage(url);
  } catch (error) {
    opened = `couldn't open: ${messageOf(error)}`;
  }
  log.write(`${label}: ${url} (${opened})`);
}
