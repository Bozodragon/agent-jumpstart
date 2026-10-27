// Finds Google Drive for desktop by the traces it leaves for this user, so
// that a home override redirects every one of them. When a new top workspace is to go in Google
// Drive and Drive for desktop isn't ready, says how to get it ready and, with someone at the
// screen, waits for them to do it.
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { keepTrying } from './machine.js';
import { showPage } from './open-page.js';
import { Stop } from './stop.js';
import * as ui from './ui.js';

/**
 * @typedef {{ status: 'not-installed' } | { status: 'signed-out' } | { status: 'signed-in', folder: string | undefined }} GoogleDrive
 */

/** Where to get Google Drive for desktop, for a profile that doesn't say. */
const downloadPage = 'https://www.google.com/drive/download/';

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

/** @param {GoogleDrive} drive */
export const describeGoogleDrive = (drive) => `${drive.status}${drive.status === 'signed-in' ? `, My Drive ${drive.folder ?? 'not found'}` : ''}`;

/**
 * Google Drive for desktop, signed in, for a new top workspace in Google Drive. If it isn't
 * installed or isn't signed in, says how to get it ready (in the profile's words, where it has
 * them). Someone at the screen is then waited for, and it's looked for again each time they
 * press Enter, until it's signed in or they choose to do it later, which stops the run. With
 * nobody at the screen, the run stops at once. Once it's signed in, My Drive, which can take a
 * few seconds to appear, is looked for again for up to the machine's patience.
 * @param {import('./profile.js').Profile} profile @param {import('./places.js').Places} places
 * @param {GoogleDrive} drive what was found
 * @param {{ machine: import('./machine.js').Machine, log: { write(line: string): void }, attended: boolean }} context
 * @returns {Promise<{ status: 'signed-in', folder: string | undefined }>}
 */
export async function readyGoogleDrive(profile, places, drive, { machine, log, attended }) {
  const say = (/** @type {string} */ line) => log.write(`Google Drive for desktop: ${line}`);
  let pageShown = false;
  while (drive.status !== 'signed-in') {
    const install = profile.googleDrive?.install;
    if (drive.status === 'not-installed' && !install && !pageShown) {
      await showPage('Google Drive download page', downloadPage, { machine, log });
      pageShown = true;
    }
    ui.notice(
      [
        drive.status === 'not-installed'
          ? "Your workspaces live in Google Drive, so Google Drive for desktop is needed, and it isn't on this laptop yet (or hasn't been opened yet)."
          : 'Your workspaces live in Google Drive, and Google Drive for desktop is installed but not signed in.',
        '',
        drive.status === 'signed-out'
          ? 'Open Google Drive from the Start menu and sign in with your work Google account.'
          : (install ?? 'Install Google Drive for desktop from google.com/drive/download, then open it and sign in.'),
        '',
        "Once it's signed in, come back to this window (the blue PowerShell window) and press Enter.",
      ].join('\n'),
      'Get Google Drive ready',
    );
    if (!attended) throw new Stop(notReady(drive));
    const choice = await ui.ask.choose({
      key: 'googleDriveReady',
      message: 'Is Google Drive for desktop signed in?',
      options: [
        { value: 'again', label: "Yes, it's signed in", hint: "it's looked for again" },
        { value: 'later', label: "I'll do this later", hint: 'this stops here, and you paste the same line again once it is' },
      ],
      initial: 'again',
    });
    if (choice === 'later') {
      say('the person chose to do this later');
      throw new Stop(notReady(drive));
    }
    drive = await findGoogleDrive(places);
    say(`looked again: ${describeGoogleDrive(drive)}`);
  }
  if (drive.folder) return drive;

  if (machine.patience > 0) ui.step('Looking for My Drive, which can take a few seconds to appear after Google Drive signs in');
  const { result, waited } = await keepTrying(
    { machine, every: 1000 },
    () => findGoogleDrive(places),
    (found) => found.status === 'signed-in' && found.folder !== undefined,
  );
  const folder = result.status === 'signed-in' ? result.folder : undefined;
  say(folder ? `My Drive found at ${folder} after ${waited / 1000} seconds` : `My Drive not found after ${waited / 1000} seconds, so where it is is asked`);
  return { status: 'signed-in', folder };
}

/**
 * Why the run stops when Google Drive for desktop isn't ready.
 * @param {GoogleDrive} drive
 */
function notReady(drive) {
  return drive.status === 'signed-out'
    ? 'Google Drive for desktop is installed but not signed in. Open it from the Start menu, sign in with your work Google account, then paste the same line again.'
    : "Your workspaces live in Google Drive, so Google Drive for desktop is needed first, and it isn't on this laptop (or hasn't been opened yet). Install it, sign in, then paste the same line again.";
}

/** @param {string} path */
export async function isFolder(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
