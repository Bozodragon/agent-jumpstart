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
 * @property {{ inGoogleDrive: boolean, defaultLocation?: string, choices: Choice[] }} workspaces
 *   `defaultLocation` is the folder, within the user's profile folder, offered for workspaces when they aren't in Google Drive.
 * @property {Choice[]} connectors
 * @property {string} [connectorsPage] The address of the page where the person connects the connectors they ticked.
 * @property {{ id: string, question: string, default: boolean }[]} extraTools
 * @property {{ source: string, names?: string[] }[]} skills
 */

/** @typedef {{ name: string, default: boolean }} Choice */

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
