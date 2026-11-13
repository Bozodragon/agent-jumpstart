// Under the York profile, Google Drive for desktop installed from York's Software Center when it
// offers Drive: what's detected (through fake replies), the page Software Center is opened at,
// and the wait while it installs (in counted time).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { exists, fakeMachine, makeHome, readOnlyLog, readSettings, runWith } from './harness.js';

/** @param {string} text */
const flowing = (text) => text.replace(/[│|]/g, ' ').replace(/\s+/g, ' ');

const offerText =
  "Google Drive isn't on this laptop. With it, your workspaces are backed up and you can reach them from any device. York's Software Center can install it for you, with no admin rights needed.";

const documentsText =
  "Google Drive isn't on this laptop. Your workspaces can go in Documents instead. They'll be on this laptop only, so they aren't backed up and you can't reach them from another device. Or install Google Drive for desktop first, then paste the line again.";

const driveId = 'ScopeId_0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9/Application_11223344-5566-7788-99aa-bbccddeeff00';

/** The detection's three steps, as the fake machine is asked them. */
const keys = {
  client: 'sc.exe query CcmExec',
  protocol: 'reg.exe query HKCR\\softwarecenter',
  offered: 'powershell.exe -NoProfile -NonInteractive -Command',
};

const running = { output: 'SERVICE_NAME: CcmExec\r\n        TYPE               : 10  WIN32_OWN_PROCESS\r\n        STATE              : 4  RUNNING\r\n' };
const registered = { output: 'HKEY_CLASSES_ROOT\\softwarecenter\r\n    URL Protocol    REG_SZ    \r\n' };
const offersDrive = { output: `${JSON.stringify({ Id: driveId, Name: 'Google Drive', InstallState: 'NotInstalled' })}\r\n` };

/** Software Center there and offering Drive. */
const softwareCenterOffering = { [keys.client]: running, [keys.protocol]: registered, [keys.offered]: offersDrive };

const fifteenMinutes = 15 * 60 * 1000;
const driveProgram = join('Program Files', 'Google', 'Drive File Stream', '112.0.3.0');
const signedIn = [join('AppData', 'Local', 'Google', 'DriveFS', '118204763951833607324'), 'My Drive'];

/**
 * @param {import('node:test').TestContext} t
 * @param {Record<string, unknown>} [answers]
 * @param {Record<string, import('./harness.js').Reply>} [replies]
 */
async function aYorkLaptopWithoutDrive(t, answers = {}, replies = softwareCenterOffering) {
  const where = await makeHome(t, answers, { googleDrive: 'missing' });
  const machine = fakeMachine(where.home);
  await machine.setReplies(replies);
  return { where, machine };
}

test('a york run without Google Drive, where Software Center offers it, says Software Center can install it, and installing from there is the default', async (t) => {
  const { where } = await aYorkLaptopWithoutDrive(t);

  const result = await runWith(where, 'york');

  const text = flowing(result.stdout);
  assert.ok(text.includes(offerText), result.stdout);
  assert.ok(text.indexOf(offerText) < text.indexOf('Software Center: softwarecenter:SoftwareID='), result.stdout);
  assert.ok((await readOnlyLog(where.home)).text.includes('Answer: softwareCenter: "install"'));
});

// An answers file sees the choices by their values, in the order they're offered: Software
// Center first ("Install it from Software Center"), then Documents ("Use Documents instead").
test('the choices where Software Center offers Google Drive are installing from there, then Documents', async (t) => {
  const { where } = await aYorkLaptopWithoutDrive(t, { softwareCenter: 'later' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.ok(result.stdout.includes(`The answers file's "softwareCenter" is wrong: it should be one of "install", "documents".`), result.stdout);
  assert.ok(!flowing(result.stdout).includes(documentsText), result.stdout);
});

test('a york run that uses Documents instead of Software Center makes the top workspace in Documents and opens nothing', async (t) => {
  const { where, machine } = await aYorkLaptopWithoutDrive(t, { softwareCenter: 'documents' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.deepEqual([settings.topWorkspace, settings.googleDriveFolder], [join(where.home, 'Documents', 'Claude'), null]);
  assert.equal('softwareCenter' in settings, false);
  assert.equal((await machine.pagesOpened()).some((page) => page.startsWith('softwarecenter:')), false);
  assert.ok((await readOnlyLog(where.home)).text.includes('Answer: softwareCenter: "documents"'));
});

test('a york run that installs Google Drive from Software Center opens it at Drive, waits visibly until Drive is installed, asks for the sign-in, then makes the top workspace in My Drive', async (t) => {
  const { where, machine } = await aYorkLaptopWithoutDrive(t, { softwareCenter: 'install' });
  await machine.setWaiting({ patience: 0, appears: [{ after: 4 * 60 * 1000, folders: [driveProgram] }, { after: 6 * 60 * 1000, folders: signedIn }] });
  const myDrive = join(where.home, 'My Drive');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.ok((await machine.pagesOpened()).includes(`softwarecenter:SoftwareID=${driveId}`));
  const text = flowing(result.stdout);
  const steps = ["Click Install in Software Center. Once you're done in Software Center, come back to the Agent Jumpstart window, where you pasted the line.", 'Waiting until Google Drive is installed', 'Open Google Drive from the Start menu and sign in'];
  const at = steps.map((step) => text.indexOf(step));
  assert.ok(at.every((place) => place !== -1) && at[0] < at[1] && at[1] < at[2], result.stdout);
  const settings = await readSettings(where.home);
  assert.deepEqual([settings.topWorkspace, settings.googleDriveFolder], [join(myDrive, 'Claude'), myDrive]);
  const log = (await readOnlyLog(where.home)).text;
  assert.ok(log.includes('Google Drive for desktop: installed from Software Center after 240 seconds'), log);
});

test('the Software Center steps say to choose a later time if it asks for a restart', async (t) => {
  const { where } = await aYorkLaptopWithoutDrive(t, { softwareCenter: 'install' });

  const result = await runWith(where, 'york');

  assert.ok(flowing(result.stdout).includes('If it asks you to restart, choose a later time'), result.stdout);
});

test('a york run whose Software Center install of Google Drive takes 15 minutes offers Documents', async (t) => {
  const { where, machine } = await aYorkLaptopWithoutDrive(t, { softwareCenter: 'install' });
  await machine.setWaiting({ patience: 0, appears: [{ after: fifteenMinutes + 60_000, folders: [driveProgram] }] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const text = flowing(result.stdout);
  const waiting = text.indexOf('Waiting until Google Drive is installed');
  assert.ok(waiting !== -1 && text.indexOf(documentsText) > waiting, result.stdout);
  const settings = await readSettings(where.home);
  assert.deepEqual([settings.topWorkspace, settings.googleDriveFolder], [join(where.home, 'Documents', 'Claude'), null]);
  assert.equal(await exists(join(where.home, driveProgram)), false);
  assert.ok((await readOnlyLog(where.home)).text.includes('Google Drive for desktop: not installed from Software Center after 900 seconds'));
});

const missing = {
  'no Configuration Manager client': { [keys.client]: { code: 1060, output: '[SC] EnumQueryServicesStatus:OpenService FAILED 1060:\r\n\r\nThe specified service does not exist as an installed service.\r\n' } },
  'no softwarecenter: protocol': {
    [keys.client]: running,
    [keys.protocol]: { code: 1, output: 'ERROR: The system was unable to find the specified registry key or value.\r\n' },
  },
  'a Software Center that does not offer Google Drive': { [keys.client]: running, [keys.protocol]: registered, [keys.offered]: { output: '' } },
  'a Software Center that cannot be asked what it offers': {
    [keys.client]: running,
    [keys.protocol]: registered,
    [keys.offered]: { code: 1, output: 'Get-CimInstance : Invalid namespace\r\n' },
  },
};

for (const [what, replies] of Object.entries(missing)) {
  test(`a york run without Google Drive and with ${what} says Documents can be used, and never mentions Software Center`, async (t) => {
    const { where, machine } = await aYorkLaptopWithoutDrive(t, {}, replies);

    const result = await runWith(where, 'york');

    assert.equal(result.code, 0, result.stdout + result.stderr);
    const text = flowing(result.stdout);
    assert.ok(text.includes(documentsText), result.stdout);
    assert.ok(!text.includes('Software Center'), result.stdout);
    assert.equal((await machine.pagesOpened()).some((page) => page.startsWith('softwarecenter:')), false);
  });
}

for (const [what, says] of [
  ['no Configuration Manager client', "Software Center: the Configuration Manager client (CcmExec) isn't running, so Software Center isn't offered"],
  ['no softwarecenter: protocol', "Software Center: the softwarecenter: protocol isn't registered, so Software Center isn't offered"],
]) {
  test(`a Software Center check that finds ${what} logs nothing alarming, only what it means`, async (t) => {
    const { where } = await aYorkLaptopWithoutDrive(t, {}, missing[/** @type {keyof typeof missing} */ (what)]);

    const result = await runWith(where, 'york');

    assert.equal(result.code, 0, result.stdout + result.stderr);
    const log = (await readOnlyLog(where.home)).text;
    assert.doesNotMatch(log, /Ran: (sc|reg)\.exe/);
    assert.ok(log.includes(says), log);
  });
}

test('a default run never checks for Software Center', async (t) => {
  const { where, machine } = await aYorkLaptopWithoutDrive(t);

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const runs = (await machine.runs()).map((run) => [run.file.split('\\').at(-1), ...run.args].join(' '));
  assert.deepEqual(runs.filter((run) => Object.values(keys).some((key) => run.startsWith(key))), []);
  assert.ok(!flowing(result.stdout).includes('Software Center'), result.stdout);
});
