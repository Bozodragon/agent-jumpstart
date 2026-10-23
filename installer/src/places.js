import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where the installer reads and writes on this machine.
 * @typedef {object} Places
 * @property {string} home The user's profile folder.
 * @property {string} localAppData The user's local AppData folder.
 * @property {string} state The installer's own folder in local AppData.
 * @property {string} settings The settings file Jumpstart reads.
 * @property {string} logs The folder of dated logs.
 * @property {string[]} driveRoots The roots of the drive letters to look on for a streamed Google Drive.
 */

const driveLetters = 'DEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * With a home override, local AppData is taken to sit inside it and no drive
 * letters are looked on, so a test never touches the real machine.
 * @param {string} [homeOverride]
 * @returns {Places}
 */
export function findPlaces(homeOverride) {
  const home = homeOverride || homedir();
  const localAppData = homeOverride
    ? join(home, 'AppData', 'Local')
    : (process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'));
  const state = join(localAppData, 'agent-jumpstart');
  const driveRoots = homeOverride ? [] : [...driveLetters].map((letter) => `${letter}:\\`);
  return { home, localAppData, state, settings: join(state, 'settings.json'), logs: join(state, 'logs'), driveRoots };
}
