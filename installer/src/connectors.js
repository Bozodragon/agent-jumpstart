// The connectors walkthrough. The installer can't connect anything for the person or
// check that it worked (Jumpstart does that later), so it opens the profile's connectors
// page, names the connectors they ticked, and waits for Enter.
import { showPage } from './open-page.js';
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
 * it waits for nothing, and takes the answers file's word that they were
 * connected. On a re-run with the same connectors, the person was walked
 * through them last time, so they aren't sent again.
 * @param {import('./profile.js').Profile} profile
 * @param {string[]} connectors The names of the ticked connectors.
 * @param {import('./tools.js').Context & { connectedBefore?: boolean }} context
 *   `connectedBefore`: the same connectors came from an earlier run's settings.
 * @returns {Promise<string>} The checklist's Connectors line.
 */
export async function walkThroughConnectors(profile, connectors, { attended, connectedBefore = false, machine, log }) {
  if (connectors.length === 0) {
    log.write('Connectors: none chosen, so the walkthrough was skipped');
    return 'None chosen';
  }
  if (connectedBefore) {
    log.write('Connectors: walked through on an earlier run, so skipped');
    return `You said you connected ${inWords(connectors)} last time`;
  }
  const page = profile.connectorsPage;
  if (typeof page !== 'string') throw new Stop(`The "${profile.id}" profile needs a connectors page address.`);

  await showPage('Connectors page', page, { machine, log });
  ui.notice(
    [
      'On the connectors page, click Connect next to each of these and sign in when asked:',
      '',
      ...connectors.map((name) => `  ${ui.bullet} ${name}`),
      '',
      "If one isn't there or won't connect, carry on. Jumpstart checks each one later.",
      '',
      ui.comeBack,
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
