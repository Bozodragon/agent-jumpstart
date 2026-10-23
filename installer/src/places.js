import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where the installer reads and writes on this machine.
 * @typedef {object} Places
 * @property {string} home The user's profile folder.
 * @property {string} state The installer's own folder in local AppData.
 * @property {string} settings The settings file Jumpstart reads.
 * @property {string} logs The folder of dated logs.
 */

/**
 * With a home override, local AppData is taken to sit inside it, so a test
 * never touches the real one.
 * @param {string} [homeOverride]
 * @returns {Places}
 */
export function findPlaces(homeOverride) {
  const home = homeOverride || homedir();
  const localAppData = homeOverride
    ? join(home, 'AppData', 'Local')
    : (process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'));
  const state = join(localAppData, 'agent-jumpstart');
  return { home, state, settings: join(state, 'settings.json'), logs: join(state, 'logs') };
}
