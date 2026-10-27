import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { messageOf, Stop } from './stop.js';

const profilesFolder = fileURLToPath(new URL('../../profiles/', import.meta.url));

/**
 * A profile's choices, edited in `profiles/<id>.json`.
 * @typedef {object} Profile
 * @property {string} id The file name, which is what the bootstrap passes.
 * @property {string} name
 * @property {string} page The address of this profile's setup page.
 * @property {string} [pastedLine] The one line the setup page tells a person to paste into PowerShell.
 * @property {string} [shareLogLine] The line the setup page gives for copying the newest installer log.
 * @property {string} [logGoesTo] Who the setup page says to send the log to, as it reads after "send it to".
 * @property {string} [logEmail] Their email address. With it, the setup page links to a Gmail
 *   draft to them, ready for the log; the draft's greeting uses `logGoesTo`.
 * @property {{ top: string, inGoogleDrive: boolean, defaultLocation?: string, choices: Choice[] }} workspaces
 *   `top` is the top workspace's folder name, created in the confirmed location with the chosen
 *   workspaces inside it. `defaultLocation` is the folder, within the user's profile folder,
 *   offered for workspaces when they aren't in Google Drive.
 * @property {{ install?: string }} [googleDrive] For a profile whose workspaces are in Google Drive:
 *   `install` says, in the person's words, how to get Google Drive for desktop and sign in, for
 *   a laptop that hasn't got it. Without it, they're sent to Google's download page.
 * @property {{ defaultModel?: string, effort?: string, codex?: boolean }} [t3] How T3 Code is set up
 *   when the installer installs it (never for a T3 already there): new threads use Claude with
 *   `defaultModel`, which must be a model id T3 knows exactly (`claude-opus-5-5`; T3 quietly
 *   falls back to its own default for one it doesn't), at `effort` (such as `medium`); and
 *   `codex: false` turns T3's Codex off.
 * @property {Connector[]} connectors
 * @property {string} [connectorsPage] The address of the page where the person connects the connectors they ticked.
 * @property {{ signUpPage: string, email: string }} [github] For the person who chooses to set up
 *   GitHub: the sign-up page, and which email to sign up with, in words ("your university email address").
 * @property {ExtraTool[]} extraTools
 * @property {{ source: string, names?: string[] }[]} skills Installed with the skills CLI. A source
 *   given without names is the path to one skill (`owner/repo/path/to/skill`), named by its last part.
 */

/**
 * Something extra the person can tick. The manifest entries whose `when` is its id are
 * installed only when it's ticked.
 * @typedef {object} ExtraTool
 * @property {string} id
 * @property {string} question
 * @property {boolean} default
 * @property {string} [signIn] Said before a tool's browser sign-in starts.
 * @property {string} [settingsPage] A page the person must change a setting on themselves.
 * @property {string} [settings] What to do on that page.
 */

/** @typedef {{ name: string, default: boolean }} Choice */

/**
 * A connector the person can tick. `what` says what it lets the agent do, in a few plain words
 * that follow its name in the connectors notice ("Gmail: search and read your email").
 * @typedef {Choice & { what?: string }} Connector
 */

/** @returns {Promise<string[]>} */
async function profileIds() {
  const files = await readdir(profilesFolder);
  return files.filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -'.json'.length)).sort();
}

/**
 * @param {string} id
 * @returns {Promise<Profile>}
 */
export async function loadProfile(id) {
  const ids = await profileIds();
  if (!ids.includes(id)) {
    throw new Stop(`There is no profile called "${id}". The profiles are: ${ids.join(', ')}.`);
  }
  let profile;
  try {
    profile = JSON.parse(await readFile(`${profilesFolder}${id}.json`, 'utf8'));
  } catch (error) {
    throw new Stop(`The "${id}" profile couldn't be read: ${messageOf(error)}`);
  }
  if (typeof profile.name !== 'string' || typeof profile.page !== 'string') {
    throw new Stop(`The "${id}" profile needs a name and a page address.`);
  }
  return { ...profile, id };
}
