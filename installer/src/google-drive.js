// Finds Google Drive for desktop by the traces it leaves: its program in Program Files and its
// data for this user, so that a home override redirects every one of them. When a new top
// workspace is to go in Google Drive and Drive for desktop isn't ready, says how to get it ready
// and, with someone at the screen, waits for them to do it, or offers Documents instead. Drive is
// optional. When it isn't installed, a profile can name Drive's entry in its organisation's
// Software Center and keep a copy of Google's Drive installer on a shared drive (York does).
// When Software Center offers the same version as that copy, the browser downloads the copy, and
// the Installer checks it against its pinned SHA-256 and runs it silently, as a double-click
// would, so the person does nothing until Drive asks them to sign in. Anything that goes wrong
// there leads to Software Center, where the person clicks Install, which needs no admin rights,
// and Documents is always one choice away.
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { keepTrying, registryMiss, system32 } from './machine.js';
import { showPage } from './open-page.js';
import { End, messageOf, Stop } from './stop.js';
import { sha256Of } from './tools.js';

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
  const { machine, frontEnd, log, attended } = context;
  const say = (/** @type {string} */ line) => log.write(`Google Drive for desktop: ${line}`);
  if (drive.status === 'not-installed') {
    const name = profile.googleDrive?.softwareCenter;
    const offered = name ? await driveInSoftwareCenter(name, context) : undefined;
    const hosted = offered ? await fromHostedInstaller(profile, places, offered, context) : undefined;
    if (hosted) drive = hosted;
    else if (offered) {
      const installed = await fromSoftwareCenter(profile, places, ask, offered.id, context);
      if (installed === 'documents') return { status: 'documents' };
      if (installed) drive = installed;
    }
  }
  while (drive.status !== 'signed-in') {
    if (drive.status === 'not-installed') return withoutGoogleDrive(ask, context);
    frontEnd.notice(
      [
        drive.status === 'never-opened'
          ? 'Your workspaces live in Google Drive, and Google Drive for desktop is installed but has never been opened.'
          : 'Your workspaces live in Google Drive, and Google Drive for desktop is installed but not signed in.',
        '',
        'Open Google Drive from the Start menu and sign in with your work Google account.',
        '',
        frontEnd.comeBack(),
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
  // Looked for once a run: the questions asked again after going back don't wait for it again.
  /** @type {Promise<string | undefined>} */
  const looking =
    context.once?.get('myDrive') ??
    (machine.patience > 0 ? frontEnd.busy(message, look, ({ result }) => ({ text: 'Looked for My Drive', ok: result.status === 'signed-in' && result.folder !== undefined }), { changesNothing: true }) : look()).then(({ result, waited }) => {
      const found = result.status === 'signed-in' ? result.folder : undefined;
      say(found ? `My Drive found at ${found} after ${waited / 1000} seconds` : `My Drive not found after ${waited / 1000} seconds, so where it is is asked`);
      return found;
    });
  context.once?.set('myDrive', looking);
  return { status: 'signed-in', folder: await looking };
}

/**
 * `keepDownloads`: a debug run, which leaves the downloaded Drive installer in Downloads.
 * `once`: looks made once a run, however often the questions are asked (main asks them again
 * after going back on the page), by name. `atEnd`: what's done once the run is over, however it
 * ends, such as deleting a Drive installer that arrived after the Installer had moved on.
 * @typedef {{ machine: import('./machine.js').Machine, frontEnd: import('./front-end.js').FrontEnd, log: { write(line: string): void }, attended: boolean, keepDownloads?: boolean, once?: Map<string, Promise<any>>, atEnd?: (() => Promise<void>)[] }} Context
 */

/** What's said when Software Center offers Drive, unless the profile words it its own way. */
const softwareCenterOffer =
  "Google Drive isn't on this laptop. With it, your workspaces are backed up and you can reach them from any device. Software Center can install it for you, with no admin rights needed.";

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
 * Here the person clicks Install.
 * @param {import('./profile.js').Profile} profile
 * @param {import('./places.js').Places} places
 * @param {import('./questions.js').Asker} ask
 * @param {string} id Drive's Id in Software Center
 * @param {Context} context
 * @returns {Promise<GoogleDrive | 'documents' | undefined>} what was found once Drive is
 *   installed; `documents` when the person chose Documents; undefined when Software Center
 *   didn't install it in time, so Documents is offered as without it
 */
async function fromSoftwareCenter(profile, places, ask, id, context) {
  const { machine, frontEnd, log } = context;
  const say = (/** @type {string} */ line) => log.write(`Google Drive for desktop: ${line}`);

  frontEnd.notice(profile.googleDrive?.softwareCenterOffer ?? softwareCenterOffer, 'Google Drive');
  const choice = await ask.choose({
    key: 'softwareCenter',
    message: 'Install Google Drive, or use Documents?',
    options: [
      { value: 'install', label: 'Install it from Software Center', hint: 'it opens at Google Drive, and the Installer waits while it installs' },
      { value: 'documents', label: 'Use Documents instead', hint: "your workspaces stay on this laptop only, so they aren't backed up" },
    ],
    initial: 'install',
  });
  log.write(`Answer: softwareCenter: ${JSON.stringify(choice)}`);
  if (choice === 'documents') return 'documents';

  await showPage('Software Center', `softwarecenter:SoftwareID=${id}`, context);
  frontEnd.notice(['Click Install in Software Center.', frontEnd.comeBack('Software Center'), restartLine].join('\n'), 'Install Google Drive');
  const waitFor = /** @template T @param {() => Promise<T>} look @param {(found: T) => boolean} done */ (look, done) =>
    keepTrying({ machine, every: softwareCenterEvery, patience: softwareCenterPatience }, look, done);
  const install = await frontEnd.busy(
    'Waiting until Google Drive is installed',
    () => waitFor(() => installing(places), (there) => there),
    ({ result }) => (result ? { text: 'Google Drive is installed', ok: true } : { text: "Google Drive still isn't installed after 15 minutes", ok: false }),
    // Software Center installs it, not the Installer: a stop doesn't wait up to 15 minutes for it.
    { changesNothing: true },
  );
  if (!install.result) {
    say(`not installed from Software Center after ${install.waited / 1000} seconds, so Documents is offered`);
    return undefined;
  }
  say(`installed from Software Center after ${install.waited / 1000} seconds`);
  return waitForSignIn(places, context);
}

/**
 * Once Drive is installed: asks the person to open it and sign in, and waits up to 15 minutes
 * until they have.
 * @param {import('./places.js').Places} places
 * @param {Context} context
 * @returns {Promise<GoogleDrive>}
 */
async function waitForSignIn(places, { machine, frontEnd, log }) {
  const say = (/** @type {string} */ line) => log.write(`Google Drive for desktop: ${line}`);
  frontEnd.notice(
    [
      'Google Drive is installed. Open Google Drive from the Start menu and sign in with your work Google account.',
      '',
      "The Installer carries on by itself once it's signed in.",
    ].join('\n'),
    'Sign in to Google Drive',
  );
  const signIn = await frontEnd.busy(
    'Waiting until Google Drive is signed in',
    () => keepTrying({ machine, every: softwareCenterEvery, patience: softwareCenterPatience }, () => findGoogleDrive(places), (drive) => drive.status === 'signed-in'),
    ({ result }) => (result.status === 'signed-in' ? { text: 'Google Drive is signed in', ok: true } : { text: "Google Drive still isn't signed in after 15 minutes", ok: false }),
    { changesNothing: true },
  );
  say(`${signIn.result.status === 'signed-in' ? 'signed in' : 'not signed in'} after ${signIn.waited / 1000} more seconds`);
  // Drive's version folder comes first, and its program follows: it's installed.
  return signIn.result.status === 'not-installed' ? { status: 'never-opened' } : signIn.result;
}

/**
 * The copy of Google's Drive installer that the profile's organisation keeps on a shared drive,
 * open only to its own accounts: its Drive file ID, the version it installs, and its size and
 * SHA-256, which are the only check made of it here. Whoever puts a new copy there checks its
 * Authenticode signature once, and changes all four.
 * @typedef {{ id: string, version: string, size: number, sha256: string }} HostedInstaller
 */

/** Google's flags for a silent install that doesn't open Drive when it's done, and adds no Docs, Sheets and Slides shortcuts. */
const silentFlags = ['--silent', '--desktop_shortcut', '--skip_launch_new', '--gsuite_shortcuts=false'];

/** How long, in milliseconds, a download is waited for to appear, and once it has, how long it may go without growing. */
const downloadStarts = 60_000;
const downloadStalls = 120_000;

/** How often Downloads is looked in while the browser downloads the installer. */
const downloadEvery = 1000;

/** How long Drive's program is waited for once its installer has returned. */
const installPatience = 5 * 60 * 1000;

/**
 * A version's numbers without trailing zeros, so `132.0.0` and `132.0.0.0` are both `132`;
 * undefined for one that isn't numbers.
 * @param {string} version
 */
function versionNumbers(version) {
  const numbers = version.trim().split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : NaN));
  if (numbers.some((number) => Number.isNaN(number))) return undefined;
  while (numbers.length > 1 && numbers.at(-1) === 0) numbers.pop();
  return numbers.join('.');
}

/** The one line said when the hosted installer isn't used after all, by why; Software Center is next. */
const missed = {
  none: "Google Drive's installer didn't start downloading within a minute, so the Installer moves on to Software Center",
  stopped: "Google Drive's installer stopped downloading, so the Installer moves on to Software Center",
  mismatch: "The downloaded file isn't Google's Drive installer, so the Installer moves on to Software Center",
  install: "Google Drive's installer didn't install it, so the Installer moves on to Software Center",
};

/**
 * Installs Drive with the copy of Google's installer the profile names, when Software Center
 * offers the same version. The browser, signed in to the organisation, downloads it from the
 * shared drive by itself; Downloads is watched for it, wherever that folder is, and the file is
 * known by its size and SHA-256 (so the browser's name for an unfinished download, and a ` (1)`
 * added to a name already taken, don't matter). Nothing is asked. It's run as a double-click
 * runs it, silently, Drive's program is waited for, and the person is asked to sign in. The
 * installer is deleted afterwards, unless it's a debug run. Anything that goes wrong is said in
 * one line.
 * @param {import('./profile.js').Profile} profile
 * @param {import('./places.js').Places} places
 * @param {{ id: string, version: string | undefined }} offered what Software Center offers
 * @param {Context} context
 * @returns {Promise<GoogleDrive | undefined>} what was found once Drive is installed; undefined
 *   when it wasn't, so Software Center is next
 */
async function fromHostedInstaller(profile, places, offered, context) {
  const hosted = profile.googleDrive?.hostedInstaller;
  if (!hosted) return undefined;
  const { machine, frontEnd, log, keepDownloads } = context;
  const say = (/** @type {string} */ line) => log.write(`Google Drive for desktop: ${line}`);
  const ours = versionNumbers(hosted.version);
  const theirs = offered.version === undefined ? undefined : versionNumbers(offered.version);
  if (ours === undefined || theirs !== ours) {
    const offers = offered.version === undefined ? "Software Center doesn't say which version it offers" : `Software Center offers ${theirs ?? offered.version}`;
    say(`${offers}, the hosted installer is ${ours ?? hosted.version}, so Software Center is used`);
    return undefined;
  }

  const folder = await downloadsFolder(places, machine);
  const before = new Set(await filesIn(folder));
  say(`watching ${folder} for the hosted installer (${hosted.size} bytes)`);
  frontEnd.notice(
    "Google Drive isn't on this laptop, so the Installer is installing it for you. Your browser downloads Google's installer by itself. There's nothing to do until Google Drive asks you to sign in.",
    'Google Drive',
  );
  await showPage("Google Drive's installer", `https://drive.usercontent.google.com/download?id=${encodeURIComponent(hosted.id)}&export=download&confirm=t`, context);
  /** The new files the watch took for the download, or its start: all of them the run's, as far as it can tell. @type {Set<string>} */
  const counted = new Set();
  const downloading = `Downloading Google Drive's installer (${Math.round(hosted.size / 1_000_000)} MB)`;
  const downloaded = await frontEnd.busy(
    downloading,
    (progress) => watchDownloads(folder, before, hosted, machine, progress, counted),
    // One that isn't found gives way quietly to Software Center: the line saying why is its only mark.
    (outcome) => (outcome.status === 'found' ? { text: "Google Drive's installer downloaded", ok: true } : { text: downloading }),
    // The browser downloads it: a stop needn't wait to watch it.
    { changesNothing: true },
  );
  /** @param {string} file */
  const tidy = async (file) => {
    if (keepDownloads) return say(`kept ${file}, as this is a debug run`);
    await rm(file, { force: true }).then(
      () => say(`deleted ${file}`),
      (/** @type {unknown} */ error) => say(`couldn't delete ${file}: ${messageOf(error)}`),
    );
  };
  if (downloaded.status === 'none') say(`no download appeared in ${folder} within ${downloadStarts / 1000} seconds`);
  if (downloaded.status === 'stopped') say(`the download stopped growing for ${downloadStalls / 1000} seconds, at ${downloaded.size} bytes`);
  if (downloaded.status === 'mismatch') {
    say(`${downloaded.file} is the hosted installer's size, but its SHA-256 is ${downloaded.sha256}, not ${hosted.sha256}`);
    await tidy(downloaded.file);
  }
  if (downloaded.status !== 'found') {
    // The browser may still be downloading it, or finish it later (such as once the person
    // agrees to keep an .exe): what's there of it now goes, and so does whatever of it has
    // arrived by the time the run is over.
    const leftovers = async () => {
      for (const file of await ourDownloads(folder, before, hosted, counted)) await tidy(file);
    };
    await leftovers();
    context.atEnd?.push(leftovers);
    frontEnd.step(missed[downloaded.status]);
    return undefined;
  }
  say(`found the hosted installer at ${downloaded.file}, and its SHA-256 matches`);

  const quote = (/** @type {string} */ text) => `'${text.replaceAll("'", "''")}'`;
  // Start-Process goes through Windows' ShellExecute, as a double-click does, which is how the
  // organisation's privilege management lets an approved installer through.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$setup = Start-Process -FilePath ${quote(downloaded.file)} -ArgumentList ${silentFlags.map(quote).join(',')} -Wait -PassThru`,
    'exit $setup.ExitCode',
  ].join('; ');
  const install = await frontEnd.busy(
    'Installing Google Drive',
    async () => {
      const ran = await machine.run(system32(join('WindowsPowerShell', 'v1.0', 'powershell.exe')), ['-NoProfile', '-NonInteractive', '-Command', script]);
      if (ran.code !== 0) return { code: ran.code, there: false };
      const { result: there } = await keepTrying({ machine, every: softwareCenterEvery, patience: installPatience }, () => programThere(places), (found) => found);
      return { code: ran.code, there };
    },
    ({ there }) => (there ? { text: 'Google Drive is installed', ok: true, done: ['Google Drive', 'Installed'] } : { text: 'Installing Google Drive' }),
  );
  await tidy(downloaded.file);
  if (!install.there) {
    say(install.code === 0 ? `the hosted installer finished, but Drive's program wasn't there after ${installPatience / 1000} more seconds` : `the hosted installer failed (code ${install.code})`);
    frontEnd.step(missed.install);
    return undefined;
  }
  say('installed with the hosted installer');
  return waitForSignIn(places, context);
}

/** Where Windows records the person's Downloads folder, a known folder that can be moved. */
const downloadsKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders';
const downloadsValue = '{374DE290-123F-4565-9164-39C4925E467B}';

/**
 * The person's Downloads folder, wherever it has been moved, as Windows records it, with
 * `%USERPROFILE%` read as the profile folder; `Downloads` in the profile folder when it isn't recorded.
 * @param {import('./places.js').Places} places
 * @param {import('./machine.js').Machine} machine
 */
async function downloadsFolder(places, machine) {
  const ran = await machine.run(system32('reg.exe'), ['query', downloadsKey, '/v', downloadsValue], { expected: registryMiss });
  const match = /REG_(?:EXPAND_)?SZ[ \t]+(.+)$/im.exec(ran.output);
  if (ran.code !== 0 || !match) return join(places.home, 'Downloads');
  return match[1].trim().replace(/%([^%]+)%/g, (whole, name) => (name.toUpperCase() === 'USERPROFILE' ? places.home : (process.env[name] ?? whole)));
}

/** The names of the files in a folder; none if it isn't there. @param {string} folder */
async function filesIn(folder) {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

/** A name a browser gives a download until it's whole. @param {string} name */
const unfinished = (name) => /\.(crdownload|part|partial|tmp)$/i.test(name);

/**
 * Whether a new file in Downloads may be the hosted installer, or its download under way: one of
 * its size, or a smaller one with an unfinished download's name or that has grown since it was
 * first seen. A finished file of another size that doesn't change, such as a PDF saved from an
 * email meanwhile, isn't.
 * @param {{ name: string, size: number }} file @param {HostedInstaller} hosted @param {boolean} grew
 */
const mayBeIt = ({ name, size }, hosted, grew) => size === hosted.size || (size < hosted.size && (unfinished(name) || grew));

/**
 * Watches Downloads for the hosted installer among the files that weren't there before and may
 * be it (see mayBeIt): a finished one of its size is it if its SHA-256 matches, and the wrong
 * file if not. The largest of them shows how far the download has got. With none after a
 * minute, or none changing for two minutes once there is one, it's given up on, naming the
 * largest. Only the waits count.
 * @param {string} folder @param {Set<string>} before the names already there
 * @param {HostedInstaller} hosted
 * @param {import('./machine.js').Machine} machine
 * @param {import('./front-end.js').Progress} progress
 * @param {Set<string>} counted given the name of each file it takes for the download
 * @returns {Promise<{ status: 'found', file: string } | { status: 'mismatch', file: string, sha256: string } | { status: 'stopped', file: string, size: number } | { status: 'none' }>}
 */
async function watchDownloads(folder, before, hosted, machine, progress, counted) {
  let waited = 0;
  let changedAt = 0;
  let seen = '';
  /** Each new file's size when it was first seen. @type {Map<string, number>} */
  const first = new Map();
  /** The new files that have grown since. @type {Set<string>} */
  const grown = new Set();
  progress(0, hosted.size);
  for (;;) {
    /** @type {{ name: string, size: number }[]} */
    const fresh = [];
    for (const name of await filesIn(folder)) {
      if (before.has(name)) continue;
      const size = await stat(join(folder, name)).then((found) => found.size, () => undefined);
      if (size === undefined) continue;
      const firstSize = first.get(name);
      if (firstSize === undefined) first.set(name, size);
      else if (size > firstSize) grown.add(name);
      if (!mayBeIt({ name, size }, hosted, grown.has(name))) continue;
      fresh.push({ name, size });
      counted.add(name);
    }
    for (const { name, size } of fresh) {
      if (size !== hosted.size || unfinished(name)) continue;
      const file = join(folder, name);
      const sha256 = await sha256Of(file).catch(() => undefined);
      if (sha256 === undefined) continue;
      if (sha256 !== hosted.sha256.toLowerCase()) return { status: 'mismatch', file, sha256 };
      progress(size, hosted.size);
      return { status: 'found', file };
    }
    const largest = fresh.reduce((most, each) => (each.size > most.size ? each : most), { name: '', size: 0 });
    const now = fresh.map(({ name, size }) => `${name}:${size}`).sort().join('|');
    if (now !== seen) {
      seen = now;
      changedAt = waited;
    }
    if (fresh.length > 0) progress(largest.size, hosted.size);
    if (fresh.length === 0 && waited >= downloadStarts) return { status: 'none' };
    if (fresh.length > 0 && waited - changedAt >= downloadStalls) return { status: 'stopped', file: join(folder, largest.name), size: largest.size };
    await machine.wait(downloadEvery);
    waited += downloadEvery;
  }
}

/**
 * What the run can tell is its own download of the hosted installer, among the files that
 * weren't in Downloads before: a finished one of its size whose SHA-256 matches, or a smaller one
 * with an unfinished download's name that the watch took for the download. Anything else, such
 * as a download of the person's own that started after the Installer moved on, is left be.
 * @param {string} folder @param {Set<string>} before the names already there @param {HostedInstaller} hosted
 * @param {Set<string>} counted the names the watch took for the download
 * @returns {Promise<string[]>} their paths
 */
async function ourDownloads(folder, before, hosted, counted) {
  const ours = [];
  for (const name of await filesIn(folder)) {
    if (before.has(name)) continue;
    const file = join(folder, name);
    const size = await stat(file).then((found) => found.size, () => undefined);
    if (size === undefined || size > hosted.size) continue;
    if (size < hosted.size ? unfinished(name) && counted.has(name) : (await sha256Of(file).catch(() => undefined)) === hosted.sha256.toLowerCase()) ours.push(file);
  }
  return ours;
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
 * Drive's Id in Software Center, and the version it lists, found by name, if the laptop has Software Center and it offers
 * Drive: the Configuration Manager client's service (CcmExec) running, the `softwarecenter:`
 * protocol registered, and Drive among the applications the client offers (`CCM_Application`).
 * Any step that finds nothing, or fails, means no Software Center. Only reads.
 * @param {string} name what Software Center lists Drive under, or part of it
 * @param {Context} context
 * @returns {Promise<{ id: string, version: string | undefined } | undefined>} Drive's Id, and its `SoftwareVersion` when Software Center lists one
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
    `$app = Get-CimInstance -Namespace 'root\\ccm\\ClientSDK' -ClassName CCM_Application | Where-Object { $_.Name -like '*${name.replaceAll("'", "''")}*' } | Select-Object -First 1 -Property Id, Name, InstallState, SoftwareVersion`,
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
  const version = app && typeof app === 'object' && 'SoftwareVersion' in app && typeof app.SoftwareVersion === 'string' && app.SoftwareVersion !== '' ? app.SoftwareVersion : undefined;
  log.write(`Software Center: offers ${name} as ${id}${version ? `, version ${version}` : ''}`);
  return { id, version };
}

/** What the installer says when Drive for desktop isn't on the laptop. */
const documentsInstead =
  "Google Drive isn't on this laptop. Your workspaces can go in Documents instead. They'll be on this laptop only, so they aren't backed up and you can't reach them from another device. Or install Google Drive for desktop first, then paste the line again.";

/**
 * What's offered when Drive for desktop isn't on the laptop: Documents (the default), or
 * installing Drive first, which ends the run cleanly, before anything is changed. A check for
 * another way to get Drive goes here, in front of the Documents text.
 * @param {import('./questions.js').Asker} ask
 * @param {Context} context
 * @returns {Promise<WhereItGoes>}
 */
async function withoutGoogleDrive(ask, { frontEnd, log }) {
  frontEnd.notice(documentsInstead, 'Google Drive');
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
