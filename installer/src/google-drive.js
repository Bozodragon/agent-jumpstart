// Finds Google Drive for desktop by the traces it leaves for this user, so
// that a home override redirects every one of them.
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * @typedef {{ status: 'not-installed' } | { status: 'signed-out' } | { status: 'signed-in', folder: string | undefined }} GoogleDrive
 */

/**
 * Drive for desktop keeps its data in local AppData, with one folder per
 * signed-in account named by the account's number. My Drive is either a
 * folder on its own drive letter (streaming) or a folder in the profile
 * (mirroring); a streamed one is looked for first.
 * @param {import('./places.js').Places} places
 * @returns {Promise<GoogleDrive>}
 */
export async function findGoogleDrive(places) {
  let entries;
  try {
    entries = await readdir(join(places.localAppData, 'Google', 'DriveFS'), { withFileTypes: true });
  } catch {
    return { status: 'not-installed' };
  }
  const accounts = entries.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name));
  if (accounts.length === 0) return { status: 'signed-out' };

  const candidates = [...places.driveRoots, places.home].map((root) => join(root, 'My Drive'));
  for (const candidate of candidates) {
    if (await isFolder(candidate)) return { status: 'signed-in', folder: candidate };
  }
  return { status: 'signed-in', folder: undefined };
}

/** @param {string} path */
export async function isFolder(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
