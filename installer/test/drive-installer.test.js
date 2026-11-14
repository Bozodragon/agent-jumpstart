// Under the York profile, Google's Drive installer, from a copy on York's shared drive: Chrome
// downloads it (the fake machine's browser stands in, growing a file in Downloads over counted
// time), the Installer finds it there by size and SHA-256, runs it silently, and deletes it.
// Anything that goes wrong falls back to the Software Center route, then Documents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, fakeMachine, fixtureProfiles, makeHome, readOnlyLog, readProfile, readSettings, run as runInstaller, runWith } from './harness.js';

/** @param {string} text */
const flowing = (text) => text.replace(/[│|]/g, ' ').replace(/\s+/g, ' ');

const driveId = 'ScopeId_0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9/Application_11223344-5566-7788-99aa-bbccddeeff00';

/** The Software Center detection's three steps, as the fake machine is asked them. */
const keys = {
  client: 'sc.exe query CcmExec',
  protocol: 'reg.exe query HKCR\\softwarecenter',
  powershell: 'powershell.exe -NoProfile -NonInteractive -Command',
  downloads: 'reg.exe query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
};

const running = { output: 'SERVICE_NAME: CcmExec\r\n        TYPE               : 10  WIN32_OWN_PROCESS\r\n        STATE              : 4  RUNNING\r\n' };
const registered = { output: 'HKEY_CLASSES_ROOT\\softwarecenter\r\n    URL Protocol    REG_SZ    \r\n' };
/** @param {string} version what Software Center lists as Drive's SoftwareVersion */
const offersDrive = (version) => ({ output: `${JSON.stringify({ Id: driveId, Name: 'Google Drive', InstallState: 'NotInstalled', SoftwareVersion: version })}\r\n` });

const fileId = 'a-test-drive-file';
const address = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
const silentFlags = ['--silent', '--desktop_shortcut', '--skip_launch_new', '--gsuite_shortcuts=false'];
const driveProgram = join('Program Files', 'Google', 'Drive File Stream', '132.0.0.0', 'GoogleDriveFS.exe');
const signedIn = [join('AppData', 'Local', 'Google', 'DriveFS', '118204763951833607324'), 'My Drive'];
const installed = { creates: [driveProgram] };
const tenMinutes = 10 * 60 * 1000;

/**
 * A York laptop without Google Drive whose Software Center offers Drive at `version`, run with a
 * York profile whose hosted installer is a small stand-in: the bytes the browser downloads.
 * @param {import('node:test').TestContext} t
 * @param {{ answers?: Record<string, unknown>, version?: string, install?: import('./harness.js').Reply, browser?: Partial<import('./harness.js').BrowserDownload> | null, bytes?: string }} [options]
 *   `browser`: what the browser does when the address is opened (null: nothing); `bytes`: what it downloads, if not the stand-in
 */
async function aYorkLaptopWithoutDrive(t, { answers = {}, version = '132.0.0', install = installed, browser = {}, bytes } = {}) {
  const where = await makeHome(t, answers, { googleDrive: 'missing' });
  const standIn = 'stand-in for GoogleDriveFSSetup.exe'.padEnd(4000, '.');
  const source = join(where.home, '..', 'GoogleDriveFSSetup.exe');
  await writeFile(source, bytes ?? standIn);
  const york = await readProfile('york');
  york.googleDrive.hostedInstaller = { id: fileId, version: '132.0.0.0', size: standIn.length, sha256: createHash('sha256').update(standIn).digest('hex') };
  const flags = await fixtureProfiles(where, { york });
  const machine = fakeMachine(where.home);
  await machine.setReplies({ [keys.client]: running, [keys.protocol]: registered, [keys.powershell]: [offersDrive(version), install] });
  await machine.setWaiting({ patience: 0, appears: [{ after: tenMinutes, folders: signedIn }] });
  if (browser) await machine.setBrowser({ [address]: { from: source, saves: join('Downloads', 'GoogleDriveFSSetup.exe'), ...browser } });
  return { where, machine, flags, run: (/** @type {string[]} */ extra = []) => runWith(where, 'york', [...flags, ...extra]) };
}

/** @param {{ file: string, args: string[] }} run */
const isInstall = (run) => run.file.endsWith('powershell.exe') && /Start-Process/.test(run.args.at(-1) ?? '');

test('a york run without Google Drive downloads Google\'s installer through the browser, checks it, installs it silently, deletes it and carries on to the sign-in', async (t) => {
  const { where, machine, run } = await aYorkLaptopWithoutDrive(t);
  const downloaded = join(where.home, 'Downloads', 'GoogleDriveFSSetup.exe');

  const result = await run();

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const pages = await machine.pagesOpened();
  assert.ok(pages.includes(address), JSON.stringify(pages));
  assert.equal(pages.some((page) => page.startsWith('softwarecenter:')), false);
  const installs = (await machine.runs()).filter(isInstall);
  assert.equal(installs.length, 1);
  const script = installs[0].args.at(-1) ?? '';
  assert.ok(script.includes(`'${downloaded}'`), script);
  for (const flag of silentFlags) assert.ok(script.includes(`'${flag}'`), script);
  assert.equal(await exists(downloaded), false);
  const text = flowing(result.stdout);
  const steps = ["Downloading Google Drive's installer", 'Installing Google Drive', 'Open Google Drive from the Start menu and sign in'];
  const at = steps.map((step) => text.indexOf(step));
  assert.ok(at.every((place) => place !== -1) && at[0] < at[1] && at[1] < at[2], result.stdout);
  const settings = await readSettings(where.home);
  const myDrive = join(where.home, 'My Drive');
  assert.deepEqual([settings.topWorkspace, settings.googleDriveFolder], [join(myDrive, 'Claude'), myDrive]);
  const log = (await readOnlyLog(where.home)).text;
  assert.ok(log.includes(`Google Drive for desktop: found the hosted installer at ${downloaded}, and its SHA-256 matches`), log);
  assert.ok(log.includes('Google Drive for desktop: installed with the hosted installer'), log);
  assert.ok(log.includes(`Google Drive for desktop: deleted ${downloaded}`), log);
  assert.doesNotMatch(log, /Answer: softwareCenter/);
});

test('a debug run keeps the downloaded Drive installer', async (t) => {
  const { where, run } = await aYorkLaptopWithoutDrive(t);
  const downloaded = join(where.home, 'Downloads', 'GoogleDriveFSSetup.exe');

  const result = await run(['--debug']);

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(await exists(downloaded), true);
  assert.ok((await readOnlyLog(where.home)).text.includes(`Google Drive for desktop: kept ${downloaded}, as this is a debug run`));
});

test('a Software Center that offers another version of Google Drive than the hosted installer says so in the log, and its own route is used', async (t) => {
  const { where, machine, run } = await aYorkLaptopWithoutDrive(t, { version: '134.0.0' });

  const result = await run();

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const log = (await readOnlyLog(where.home)).text;
  assert.ok(log.includes('Software Center offers 134, the hosted installer is 132'), log);
  const pages = await machine.pagesOpened();
  assert.equal(pages.includes(address), false);
  assert.ok(pages.includes(`softwarecenter:SoftwareID=${driveId}`), JSON.stringify(pages));
  assert.equal((await machine.runs()).some(isInstall), false);
  assert.doesNotMatch(result.stdout, /Downloading Google Drive's installer/);
});

const sameSizeOtherBytes = 'not the file on the shared drive'.padEnd(4000, '!');
const movesOn = 'so the Installer moves on to Software Center';

/** @type {[string, Parameters<typeof aYorkLaptopWithoutDrive>[1], string, string][]} */
const failures = [
  ['no download within a minute', { browser: null }, `Google Drive's installer didn't start downloading within a minute, ${movesOn}`, 'no download appeared in'],
  ['a download that starts only after a minute', { browser: { after: 61_000 } }, `Google Drive's installer didn't start downloading within a minute, ${movesOn}`, 'no download appeared in'],
  ['a download that stops growing for 2 minutes', { browser: { perSecond: 100, stopsAt: 1000 } }, `Google Drive's installer stopped downloading, ${movesOn}`, 'the download stopped growing for 120 seconds, at 1000 bytes'],
  ['a download whose SHA-256 is wrong', { bytes: sameSizeOtherBytes }, `The downloaded file isn't Google's Drive installer, ${movesOn}`, "is the hosted installer's size, but its SHA-256 is"],
  ['an install that fails', { install: { code: 1, output: 'Google Drive setup failed.\r\n' } }, `Google Drive's installer didn't install it, ${movesOn}`, 'the hosted installer failed (code 1)'],
  [
    'an install refused admin rights',
    { install: { code: 1, output: 'Start-Process : This command cannot be run due to the error: The operation was canceled by the user.\r\n' } },
    `Google Drive's installer didn't install it, ${movesOn}`,
    'the hosted installer failed (code 1)',
  ],
  ['an install that leaves no Drive program', { install: {} }, `Google Drive's installer didn't install it, ${movesOn}`, "the hosted installer finished, but Drive's program wasn't there after 300 more seconds"],
];

for (const [what, options, line, logged] of failures) {
  test(`${what} says so in one line, then offers Software Center, then Documents`, async (t) => {
    const { where, machine, run } = await aYorkLaptopWithoutDrive(t, { ...options, answers: { softwareCenter: 'documents' } });

    const result = await run();

    assert.equal(result.code, 0, result.stdout + result.stderr);
    const text = flowing(result.stdout);
    assert.equal(text.split(line).length - 1, 1, result.stdout);
    assert.ok(text.indexOf(line) < text.indexOf("York's Software Center can install it for you"), result.stdout);
    assert.ok((await machine.pagesOpened()).includes(address));
    const settings = await readSettings(where.home);
    assert.deepEqual([settings.topWorkspace, settings.googleDriveFolder], [join(where.home, 'Documents', 'Claude'), null]);
    const log = (await readOnlyLog(where.home)).text;
    assert.ok(log.split('\n').some((each) => each.includes('Google Drive for desktop: ') && each.includes(logged)), log);
    assert.ok(log.includes('Answer: softwareCenter: "documents"'), log);
    // Whatever arrived, the wrong file, an installer that didn't install or a download that stopped partway, is deleted.
    assert.equal(await exists(join(where.home, 'Downloads', 'GoogleDriveFSSetup.exe')), false);
    assert.equal(await exists(join(where.home, 'Downloads', 'GoogleDriveFSSetup.exe.crdownload')), false);
  });
}

/**
 * A York run of `options` with its output made to look like a terminal's, so its busies draw and end as on a real screen.
 * @param {import('node:test').TestContext} t @param {Parameters<typeof aYorkLaptopWithoutDrive>[1]} options
 */
async function inATerminal(t, options) {
  const { where, machine, flags } = await aYorkLaptopWithoutDrive(t, options);
  const args = ['--profile', 'york', ...flags, '--home', where.home, '--answers', where.answersFile, '--downloads', where.downloads];
  // The fake internet only to make the output look like a terminal: nothing is fetched.
  const result = await runInstaller(args, { internet: { folder: join(where.downloads, 'nowhere'), terminal: true } });
  return { where, machine, result, drawings: result.stdout.split(/[\r\n]/).map((line) => line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')) };
}

for (const [what, options, line] of [failures[0], failures[4]]) {
  test(`in a terminal, ${what} is said in its one line, with no failed mark on the busy before it`, async (t) => {
    const { result, drawings } = await inATerminal(t, { ...options, answers: { softwareCenter: 'documents' } });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(flowing(result.stdout).split(line).length - 1, 1, result.stdout);
    const crossed = drawings.filter((drawing) => /^x {2}(Downloading Google Drive's installer|Installing Google Drive)/.test(drawing));
    assert.deepEqual(crossed, [], result.stdout);
  });
}

test('a slow download that keeps growing for minutes, after starting within a minute, finishes and is installed', async (t) => {
  // 4,000 bytes at 10 a second, starting after 50 seconds: over 7 minutes in all.
  const { where, machine, run } = await aYorkLaptopWithoutDrive(t, { browser: { after: 50_000, perSecond: 10 } });

  const result = await run();

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await machine.runs()).filter(isInstall).length, 1);
  assert.ok((await readOnlyLog(where.home)).text.includes('Google Drive for desktop: installed with the hosted installer'));
});

test("in a terminal, the download shows a percentage of the hosted installer's size that rises to 100%, and none of it reaches the log", async (t) => {
  // 4,000 bytes at 400 a second: 10% more each counted second.
  const { where, flags } = await aYorkLaptopWithoutDrive(t, { browser: { perSecond: 400 } });
  const args = ['--profile', 'york', ...flags, '--home', where.home, '--answers', where.answersFile, '--downloads', where.downloads];

  // The fake internet only to make the output look like a terminal: nothing is fetched.
  const result = await runInstaller(args, { internet: { folder: join(where.downloads, 'nowhere'), terminal: true } });

  assert.equal(result.code, 0, result.stderr);
  const shown = result.stdout
    .split('\r')
    .filter((drawing) => drawing.includes("Downloading Google Drive's installer"))
    .flatMap((drawing) => [.../(\d+)%/.exec(drawing) ?? []].slice(1, 2))
    .map(Number);
  assert.ok(new Set(shown).size >= 5, `it rose in steps, not all at once: ${shown.join(', ')}`);
  assert.deepEqual(shown, [...shown].sort((a, b) => a - b), `it only ever rose: ${shown.join(', ')}`);
  assert.equal(shown.at(-1), 100, `it reached 100%: ${shown.join(', ')}`);
  assert.doesNotMatch((await readOnlyLog(where.home)).text, /\d%/);
});

test('a download the browser names with a (1), as Downloads already holds a file of that name, is found, and only it is deleted', async (t) => {
  const { where, machine, run } = await aYorkLaptopWithoutDrive(t, { browser: { saves: join('Downloads', 'GoogleDriveFSSetup (1).exe') } });
  const older = join(where.home, 'Downloads', 'GoogleDriveFSSetup.exe');
  await mkdir(join(where.home, 'Downloads'));
  // The installer's size, but not the file: something already there is never taken for the download.
  await writeFile(older, 'an older download of something else'.padEnd(4000, '-'));
  const downloaded = join(where.home, 'Downloads', 'GoogleDriveFSSetup (1).exe');

  const result = await run();

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const [install] = (await machine.runs()).filter(isInstall);
  assert.ok(install.args.at(-1)?.includes(`'${downloaded}'`), install.args.at(-1));
  assert.equal(await exists(downloaded), false);
  assert.equal(await exists(older), true);
});

test('a Downloads folder that has been moved is watched where Windows says it is', async (t) => {
  const { where, machine, run } = await aYorkLaptopWithoutDrive(t, { browser: { saves: join('OneDrive', 'Downloads', 'GoogleDriveFSSetup.exe') } });
  const replies = JSON.parse(await readFile(join(where.home, 'fake-machine', 'replies.json'), 'utf8'));
  await machine.setReplies({
    ...replies,
    [keys.downloads]: { output: '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders\r\n    {374DE290-123F-4565-9164-39C4925E467B}    REG_EXPAND_SZ    %USERPROFILE%\\OneDrive\\Downloads\r\n\r\n' },
  });
  const downloaded = join(where.home, 'OneDrive', 'Downloads', 'GoogleDriveFSSetup.exe');

  const result = await run();

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const [install] = (await machine.runs()).filter(isInstall);
  assert.ok(install.args.at(-1)?.includes(`'${downloaded}'`), install.args.at(-1));
  assert.equal(await exists(downloaded), false);
});

test("the York profile's hosted installer is the 132 copy on York's shared drive, and its download address is the one opened", async (t) => {
  const where = await makeHome(t, { softwareCenter: 'documents' }, { googleDrive: 'missing' });
  const machine = fakeMachine(where.home);
  await machine.setReplies({ [keys.client]: running, [keys.protocol]: registered, [keys.powershell]: offersDrive('132.0.0') });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual((await readProfile('york')).googleDrive.hostedInstaller, {
    id: '1rRGalKcRRAW5b4AtmX8fWqdExYH2SzQd',
    version: '132.0.0.0',
    size: 292804760,
    sha256: '6ab7af8224736d4b6f0b06345f5bdc78a664c0a995973c0b1b38c3a0ad5cd853',
  });
  assert.ok((await machine.pagesOpened()).includes('https://drive.usercontent.google.com/download?id=1rRGalKcRRAW5b4AtmX8fWqdExYH2SzQd&export=download&confirm=t'));
  assert.ok(flowing(result.stdout).includes("Downloading Google Drive's installer (293 MB)"), result.stdout);
});

test('a default run without Google Drive opens no download and runs no installer for it', async (t) => {
  const where = await makeHome(t, {}, { googleDrive: 'missing' });
  const machine = fakeMachine(where.home);
  await machine.setReplies({ [keys.client]: running, [keys.protocol]: registered, [keys.powershell]: offersDrive('132.0.0') });

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await machine.pagesOpened()).some((page) => page.startsWith('https://drive.usercontent.google.com/')), false);
  assert.equal((await machine.runs()).some(isInstall), false);
  assert.doesNotMatch(result.stdout, /Google Drive's installer/);
});
