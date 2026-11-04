// Finds Google Drive for desktop by the traces it leaves: its program in Program Files and its
// data for this user, so that a home override redirects every one of them. When a new top
// workspace is to go in Google Drive and Drive for desktop isn't ready, says how to get it ready
// and, with someone at the screen, waits for them to do it, or offers Documents instead. Drive is
// optional, and it's never installed here.
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { keepTrying } from './machine.js';
import { End, Stop } from './stop.js';
import * as ui from './ui.js';

/**
 * `never-opened`: installed, but never started, so it holds nothing for this user yet.
 * @typedef {{ status: 'not-installed' } | { status: 'never-opened' } | { status: 'signed-out' } | { status: 'signed-in', folder: string | undefined }} GoogleDrive
 */

/**
 * Where a new top workspace goes: Google Drive, signed in, with My Drive's folder if it was
 * found; or Documents, without Drive.
 * @typedef {{ status: 'signed-in', folder: string | undefined } | { status: 'documents' }} WhereItGoes
 */

/**
 * Drive for desktop is installed for every user, into a folder per version in Program Files.
 * Once it has been opened, it keeps its data in local AppData, with one folder per signed-in
 * account named by the account's number. My Drive is either a folder on its own drive letter
 * (streaming) or a folder in the profile (mirroring); a streamed one is looked for first.
 * @param {import('./places.js').Places} places
 * @returns {Promise<GoogleDrive>}
 */
export async function findGoogleDrive(places) {
  let entries;
  try {
    entries = await readdir(join(places.localAppData, 'Google', 'DriveFS'), { withFileTypes: true });
  } catch {
    return { status: (await programThere(places)) ? 'never-opened' : 'not-installed' };
  }
  const accounts = entries.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name));
  if (accounts.length === 0) return { status: 'signed-out' };

  const candidates = [...places.driveRoots, places.home].map((root) => join(root, 'My Drive'));
  for (const candidate of candidates) {
    if (await isFolder(candidate)) return { status: 'signed-in', folder: candidate };
  }
  return { status: 'signed-in', folder: undefined };
}

/**
 * Whether Drive for desktop's program is in Program Files, at
 * `Google\Drive File Stream\<version>\GoogleDriveFS.exe`.
 * @param {import('./places.js').Places} places
 */
async function programThere(places) {
  const folder = join(places.programFiles, 'Google', 'Drive File Stream');
  const versions = await readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const version of versions) {
    if (!version.isDirectory()) continue;
    const program = await stat(join(folder, version.name, 'GoogleDriveFS.exe')).catch(() => undefined);
    if (program?.isFile()) return true;
  }
  return false;
}

/** @param {GoogleDrive} drive */
export function describeGoogleDrive(drive) {
  if (drive.status === 'never-opened') return 'installed, never opened';
  return `${drive.status}${drive.status === 'signed-in' ? `, My Drive ${drive.folder ?? 'not found'}` : ''}`;
}

/**
 * Where a new top workspace goes when it's to go in Google Drive. Not installed: see
 * withoutGoogleDrive. Installed but never opened, or not signed in: the person is asked to open
 * it and sign in, and it's looked for again each time they say it's signed in, until it is or
 * they choose Documents instead. With nobody at the screen to wait for, the run stops, unless the
 * answers file chose Documents. Once it's signed in, My Drive, which can take a few seconds to
 * appear, is looked for again for up to the machine's patience.
 * @param {import('./places.js').Places} places
 * @param {import('./questions.js').Asker} ask
 * @param {GoogleDrive} drive what was found
 * @param {{ machine: import('./machine.js').Machine, log: { write(line: string): void }, attended: boolean }} context
 * @returns {Promise<WhereItGoes>}
 */
export async function readyGoogleDrive(places, ask, drive, { machine, log, attended }) {
  const say = (/** @type {string} */ line) => log.write(`Google Drive for desktop: ${line}`);
  while (drive.status !== 'signed-in') {
    if (drive.status === 'not-installed') return withoutGoogleDrive(ask, log);
    ui.notice(
      [
        drive.status === 'never-opened'
          ? 'Your workspaces live in Google Drive, and Google Drive for desktop is installed but has never been opened.'
          : 'Your workspaces live in Google Drive, and Google Drive for desktop is installed but not signed in.',
        '',
        'Open Google Drive from the Start menu and sign in with your work Google account.',
        '',
        "Once it's signed in, come back to this window (the blue PowerShell window) and press Enter.",
      ].join('\n'),
      'Get Google Drive ready',
    );
    const choice = await ask.choose({
      key: 'googleDriveReady',
      message: 'Is Google Drive for desktop signed in?',
      options: [
        { value: 'again', label: "Yes, it's signed in", hint: "it's looked for again" },
        { value: 'documents', label: 'Use Documents instead', hint: "your workspaces stay on this laptop only, so they aren't backed up" },
      ],
      initial: 'again',
    });
    log.write(`Answer: googleDriveReady: ${JSON.stringify(choice)}`);
    if (choice === 'documents') return { status: 'documents' };
    if (!attended) throw new Stop(notReady(drive));
    drive = await findGoogleDrive(places);
    say(`looked again: ${describeGoogleDrive(drive)}`);
  }
  if (drive.folder) return drive;

  const look = () =>
    keepTrying(
      { machine, every: 1000 },
      () => findGoogleDrive(places),
      (found) => found.status === 'signed-in' && found.folder !== undefined,
    );
  const message = 'Looking for My Drive, which can take a few seconds to appear after Google Drive signs in';
  const { result, waited } = machine.patience > 0 ? await ui.busy(message, look, ({ result }) => ({ text: 'Looked for My Drive', ok: result.status === 'signed-in' && result.folder !== undefined })) : await look();
  const folder = result.status === 'signed-in' ? result.folder : undefined;
  say(folder ? `My Drive found at ${folder} after ${waited / 1000} seconds` : `My Drive not found after ${waited / 1000} seconds, so where it is is asked`);
  return { status: 'signed-in', folder };
}

/** What the installer says when Drive for desktop isn't on the laptop. */
const documentsInstead =
  "Google Drive isn't on this laptop. Your workspaces can go in Documents instead. They'll be on this laptop only, so they aren't backed up and you can't reach them from another device. Or install Google Drive for desktop first, then paste the line again.";

/**
 * What's offered when Drive for desktop isn't on the laptop: Documents (the default), or
 * installing Drive first, which ends the run cleanly, before anything is changed. A check for
 * another way to get Drive goes here, in front of the Documents text.
 * @param {import('./questions.js').Asker} ask
 * @param {{ write(line: string): void }} log
 * @returns {Promise<WhereItGoes>}
 */
async function withoutGoogleDrive(ask, log) {
  ui.notice(documentsInstead, 'Google Drive');
  const choice = await ask.choose({
    key: 'withoutGoogleDrive',
    message: 'Where should your workspaces go?',
    options: [
      { value: 'documents', label: 'Use Documents' },
      { value: 'install-first', label: "I'll install Google Drive first", hint: 'this ends here, and you paste the same line again once it is installed' },
    ],
    initial: 'documents',
  });
  log.write(`Answer: withoutGoogleDrive: ${JSON.stringify(choice)}`);
  if (choice === 'install-first') throw new End('Install Google Drive for desktop, open it and sign in, then paste the same line again.');
  return { status: 'documents' };
}

/**
 * Why the run stops when Google Drive for desktop isn't ready and nobody is at the screen.
 * @param {GoogleDrive} drive
 */
function notReady(drive) {
  return drive.status === 'never-opened'
    ? 'Google Drive for desktop is installed but has never been opened. Open it from the Start menu, sign in with your work Google account, then paste the same line again.'
    : 'Google Drive for desktop is installed but not signed in. Open it from the Start menu, sign in with your work Google account, then paste the same line again.';
}

/** @param {string} path */
export async function isFolder(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
