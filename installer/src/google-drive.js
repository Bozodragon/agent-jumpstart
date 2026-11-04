// Finds Google Drive for desktop by the traces it leaves: its program in Program Files and its
// data for this user, so that a home override redirects every one of them. When a new top
// workspace is to go in Google Drive and Drive for desktop isn't ready, says how to get it ready
// and, with someone at the screen, waits for them to do it, or offers Documents instead. Drive is
// optional, and it's never installed here: under a profile that names Drive's entry in York's
// Software Center, the person can be sent there to install it, which needs no admin rights.
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { keepTrying, registryMiss, system32 } from './machine.js';
import { showPage } from './open-page.js';
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
  const folder = programFolder(places);
  const versions = await readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const version of versions) {
    if (!version.isDirectory()) continue;
    const program = await stat(join(folder, version.name, 'GoogleDriveFS.exe')).catch(() => undefined);
    if (program?.isFile()) return true;
  }
  return false;
}

/** @param {import('./places.js').Places} places */
const programFolder = (places) => join(places.programFiles, 'Google', 'Drive File Stream');

/** @param {GoogleDrive} drive */
export function describeGoogleDrive(drive) {
  if (drive.status === 'never-opened') return 'installed, never opened';
  return `${drive.status}${drive.status === 'signed-in' ? `, My Drive ${drive.folder ?? 'not found'}` : ''}`;
}

/**
 * Where a new top workspace goes when it's to go in Google Drive. Not installed: see
 * fromSoftwareCenter, then withoutGoogleDrive. Installed but never opened, or not signed in: the person is asked to open
 * it and sign in, and it's looked for again each time they say it's signed in, until it is or
 * they choose Documents instead. With nobody at the screen to wait for, the run stops, unless the
 * answers file chose Documents. Once it's signed in, My Drive, which can take a few seconds to
 * appear, is looked for again for up to the machine's patience.
 * @param {import('./profile.js').Profile} profile
 * @param {import('./places.js').Places} places
 * @param {import('./questions.js').Asker} ask
 * @param {GoogleDrive} drive what was found
 * @param {Context} context
 * @returns {Promise<WhereItGoes>}
 */
export async function readyGoogleDrive(profile, places, ask, drive, context) {
  const { machine, log, attended } = context;
  const say = (/** @type {string} */ line) => log.write(`Google Drive for desktop: ${line}`);
  if (drive.status === 'not-installed') {
    const installed = await fromSoftwareCenter(profile, places, ask, context);
    if (installed === 'documents') return { status: 'documents' };
    if (installed) drive = installed;
  }
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

/** @typedef {{ machine: import('./machine.js').Machine, log: { write(line: string): void }, attended: boolean }} Context */

/** How long Software Center is given to install Drive, and then Drive to be signed in, in milliseconds. */
const softwareCenterPatience = 15 * 60 * 1000;

/** How often Drive is looked for while Software Center installs it, and while it's signed in. */
const softwareCenterEvery = 5000;

// Said after "Click Install in Software Center". Ticket #37's check on a York laptop (whether
// Drive's setup asked for a restart) decides whether this line stays; until then it's kept.
const restartLine = 'If it asks you to restart, choose a later time.';

/**
 * When the profile names Drive's entry in Software Center and the laptop's Software Center offers
 * it, the person is offered to install it from there, or to use Documents. Installing opens
 * Software Center at Drive's entry and waits, up to 15 minutes, until Drive is installed; then
 * they're asked to open Google Drive and sign in, and waited for again, up to another 15 minutes.
 * Drive is never installed here: the person clicks Install.
 * @param {import('./profile.js').Profile} profile
 * @param {import('./places.js').Places} places
 * @param {import('./questions.js').Asker} ask
 * @param {Context} context
 * @returns {Promise<GoogleDrive | 'documents' | undefined>} what was found once Drive is
 *   installed; `documents` when the person chose Documents; undefined when Software Center
 *   doesn't offer Drive or didn't install it in time, so Documents is offered as without it
 */
async function fromSoftwareCenter(profile, places, ask, context) {
  const name = profile.googleDrive?.softwareCenter;
  if (!name) return undefined;
  const { machine, log } = context;
  const say = (/** @type {string} */ line) => log.write(`Google Drive for desktop: ${line}`);
  const id = await driveInSoftwareCenter(name, context);
  if (!id) return undefined;

  ui.notice(
    "Google Drive isn't on this laptop. With it, your workspaces are backed up and you can reach them from any device. York's Software Center can install it for you, with no admin rights needed.",
    'Google Drive',
  );
  const choice = await ask.choose({
    key: 'softwareCenter',
    message: 'Install Google Drive, or use Documents?',
    options: [
      { value: 'install', label: 'Install it from Software Center', hint: 'it opens at Google Drive, and this window waits while it installs' },
      { value: 'documents', label: 'Use Documents instead', hint: "your workspaces stay on this laptop only, so they aren't backed up" },
    ],
    initial: 'install',
  });
  log.write(`Answer: softwareCenter: ${JSON.stringify(choice)}`);
  if (choice === 'documents') return 'documents';

  await showPage('Software Center', `softwarecenter:SoftwareID=${id}`, context);
  ui.notice(['Click Install in Software Center, then come back to this window.', restartLine].filter(Boolean).join('\n'), 'Install Google Drive');
  const waitFor = /** @template T @param {() => Promise<T>} look @param {(found: T) => boolean} done */ (look, done) =>
    keepTrying({ machine, every: softwareCenterEvery, patience: softwareCenterPatience }, look, done);
  const install = await ui.busy(
    'Waiting until Google Drive is installed',
    () => waitFor(() => installing(places), (there) => there),
    ({ result }) => (result ? { text: 'Google Drive is installed', ok: true } : { text: "Google Drive still isn't installed after 15 minutes", ok: false }),
  );
  if (!install.result) {
    say(`not installed from Software Center after ${install.waited / 1000} seconds, so Documents is offered`);
    return undefined;
  }
  say(`installed from Software Center after ${install.waited / 1000} seconds`);

  ui.notice(
    [
      'Google Drive is installed. Open Google Drive from the Start menu and sign in with your work Google account.',
      '',
      "This window carries on by itself once it's signed in.",
    ].join('\n'),
    'Sign in to Google Drive',
  );
  const signIn = await ui.busy(
    'Waiting until Google Drive is signed in',
    () => waitFor(() => findGoogleDrive(places), (drive) => drive.status === 'signed-in'),
    ({ result }) => (result.status === 'signed-in' ? { text: 'Google Drive is signed in', ok: true } : { text: "Google Drive still isn't signed in after 15 minutes", ok: false }),
  );
  say(`${signIn.result.status === 'signed-in' ? 'signed in' : 'not signed in'} after ${signIn.waited / 1000} more seconds`);
  // Software Center makes Drive's version folder first, and its program follows: it's installed.
  return signIn.result.status === 'not-installed' ? { status: 'never-opened' } : signIn.result;
}

/**
 * Whether Software Center has installed Drive, or got far enough that it soon will have: a
 * version folder in Drive's program folder, which its program goes in.
 * @param {import('./places.js').Places} places
 */
async function installing(places) {
  const versions = await readdir(programFolder(places), { withFileTypes: true }).catch(() => []);
  return versions.some((version) => version.isDirectory());
}

/**
 * Drive's Id in Software Center, found by name, if the laptop has Software Center and it offers
 * Drive: the Configuration Manager client's service (CcmExec) running, the `softwarecenter:`
 * protocol registered, and Drive among the applications the client offers (`CCM_Application`).
 * Any step that finds nothing, or fails, means no Software Center. Only reads.
 * @param {string} name what Software Center lists Drive under, or part of it
 * @param {Context} context
 * @returns {Promise<string | undefined>}
 */
async function driveInSoftwareCenter(name, { machine, log }) {
  /** @param {string} why */
  const none = (why) => {
    log.write(`Software Center: ${why}, so Software Center isn't offered`);
    return undefined;
  };
  // 1060 is sc.exe's code for a service that isn't installed.
  const client = await machine.run(system32('sc.exe'), ['query', 'CcmExec'], { expected: (ran) => ran.code === 1060 });
  if (client.code !== 0 || !/STATE\s*:\s*\d+\s+RUNNING/i.test(client.output)) return none("the Configuration Manager client (CcmExec) isn't running");
  const protocol = await machine.run(system32('reg.exe'), ['query', 'HKCR\\softwarecenter', '/v', 'URL Protocol'], { expected: registryMiss });
  if (protocol.code !== 0) return none("the softwarecenter: protocol isn't registered");
  // A cmdlet, and its answer as one line of JSON: both allowed in Constrained Language Mode.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$app = Get-CimInstance -Namespace 'root\\ccm\\ClientSDK' -ClassName CCM_Application | Where-Object { $_.Name -like '*${name.replaceAll("'", "''")}*' } | Select-Object -First 1 -Property Id, Name, InstallState`,
    'if ($app) { $app | ConvertTo-Json -Compress }',
  ].join('; ');
  const offered = await machine.run(system32(join('WindowsPowerShell', 'v1.0', 'powershell.exe')), ['-NoProfile', '-NonInteractive', '-Command', script]);
  if (offered.code !== 0) return none("it couldn't be asked what it offers");
  const line = offered.output.split(/\r?\n/).filter((text) => text.trim() !== '').at(-1);
  if (line === undefined) return none(`it doesn't offer ${name}`);
  /** @type {unknown} */
  let app;
  try {
    app = JSON.parse(line);
  } catch {
    return none(`what it offers couldn't be read (${line})`);
  }
  const id = app && typeof app === 'object' && 'Id' in app && typeof app.Id === 'string' && app.Id !== '' ? app.Id : undefined;
  if (!id) return none(`it doesn't offer ${name}`);
  log.write(`Software Center: offers ${name} as ${id}`);
  return id;
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
