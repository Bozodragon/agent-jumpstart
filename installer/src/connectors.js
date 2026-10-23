// The connectors walkthrough. The installer can't connect anything for the person or
// check that it worked (Jumpstart does that later), so it opens the profile's connectors
// page, names the connectors they ticked, and waits for Enter.
import { tryToOpen } from './open-page.js';
import { Stop } from './stop.js';
import * as ui from './ui.js';

/**
 * Names in plain English: "A", "A and B", "A, B and C".
 * @param {string[]} names
 */
function inWords(names) {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * Walks the person through connecting the connectors they ticked. With none
 * ticked, does nothing. When nobody is at the screen (answers came from a file)
 * it opens no browser and waits for nothing, and takes the answers file's word
 * that they were connected.
 * @param {import('./profile.js').Profile} profile
 * @param {string[]} connectors The names of the ticked connectors.
 * @param {{ attended: boolean, log: { write(line: string): void } }} how
 * @returns {Promise<string>} The checklist's Connectors line.
 */
export async function walkThroughConnectors(profile, connectors, { attended, log }) {
  if (connectors.length === 0) {
    log.write('Connectors: none chosen, so the walkthrough was skipped');
    return 'None chosen';
  }
  const page = profile.connectorsPage;
  if (typeof page !== 'string') throw new Stop(`The "${profile.id}" profile needs a connectors page address.`);

  ui.step(`Connectors page: ${page}`);
  log.write(`Connectors page: ${page} (${attended ? await tryToOpen(page) : 'not opened: answers came from a file'})`);
  ui.notice(
    [
      'On the connectors page, click Connect next to each of these and sign in when asked:',
      '',
      ...connectors.map((name) => `  ${ui.bullet} ${name}`),
      '',
      "If one isn't there or won't connect, carry on. Jumpstart checks each one later.",
    ].join('\n'),
    'Connect these',
  );

  if (attended) {
    await ui.pressEnter("Press Enter once you've connected them.");
    log.write('Connectors: the person pressed Enter');
  } else {
    log.write('Connectors: taken as connected from the answers file');
  }
  return `You said you connected ${inWords(connectors)}`;
}
