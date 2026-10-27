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
 * @property {string} programs Where per-user programs go (`%LOCALAPPDATA%\Programs`).
 * @property {string} claudeConfig Claude Code's user folder (its `settings.json`, its `skills`):
 *   `%USERPROFILE%\.claude`, or `CLAUDE_CONFIG_DIR` when that is set.
 * @property {string} t3Database T3 Code's state database (`%USERPROFILE%\.t3\userdata\statev2.sqlite`),
 *   which holds its project list. Only ever read.
 * @property {string} [fakeMachine] Set only with a home override: the folder that stands in
 *   for the rest of the machine (user environment, programs run). See machine.js.
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
  return {
    home,
    localAppData,
    state,
    settings: join(state, 'settings.json'),
    logs: join(state, 'logs'),
    driveRoots,
    programs: join(localAppData, 'Programs'),
    // Under a home override the real CLAUDE_CONFIG_DIR is ignored: it points outside the home.
    claudeConfig: (!homeOverride && process.env.CLAUDE_CONFIG_DIR) || join(home, '.claude'),
    t3Database: join(home, '.t3', 'userdata', 'statev2.sqlite'),
    ...(homeOverride ? { fakeMachine: join(home, 'fake-machine') } : {}),
  };
}
