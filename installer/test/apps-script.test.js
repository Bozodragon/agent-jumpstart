import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { checklistSays, claudeFolder, fakeMachine, makeHome, markAsInstalledByUs, programsFolder, readManifest, readOnlyLog, readProfile, runWith } from './harness.js';

/**
 * A stand-in for clasp's package from the npm registry, and a copy of the pinned manifest
 * whose clasp checksum is the stand-in's.
 * @param {{ downloads: string }} where
 */
async function supplyClasp(where) {
  const manifest = await readManifest();
  const clasp = manifest.tools.find((/** @type {any} */ tool) => tool.id === 'clasp');
  const bytes = Buffer.from('stand-in for the clasp package');
  const download = clasp.downloads[process.arch];
  const file = join(where.downloads, basename(new URL(download.url).pathname));
  await writeFile(file, bytes);
  download.sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(where.downloads, 'manifest.json'), JSON.stringify(manifest));
  return { clasp, file };
}

test('with the Apps Script extra tool unticked, clasp appears only as a skipped checklist line', async (t) => {
  const where = await makeHome(t, { extraTools: [] });
  const profile = await readProfile('york');
  const appsScript = profile.extraTools.find((/** @type {any} */ extra) => extra.id === 'apps-script');
  const machine = fakeMachine(where.home);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const mentions = result.stdout.split('\n').filter((line) => /clasp/i.test(line));
  assert.equal(mentions.length, 1, result.stdout);
  checklistSays(result.stdout, 'clasp', 'Skipped (not chosen)');
  assert.ok(!result.stdout.includes(appsScript.settingsPage), result.stdout);
  assert.deepEqual((await machine.runs()).filter((run) => /clasp|npm/i.test(run.file)), []);
  assert.ok(!(await machine.userPath()).some((entry) => entry.startsWith(programsFolder(where.home)) && /npm/i.test(entry)));
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes('Checklist: clasp: Skipped (not chosen)'), log.text);
});

test('with Apps Script ticked, clasp installs per user at the pinned version, outside the Node folder, through npm.cmd', async (t) => {
  const where = await makeHome(t, { extraTools: ['apps-script'] });
  const { clasp, file } = await supplyClasp(where);
  const machine = fakeMachine(where.home);
  const programs = programsFolder(where.home);
  const prefix = join(programs, 'npm');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'clasp', clasp.version);
  const runs = await machine.runs();
  const npm = runs.find((run) => basename(run.file) === 'npm.cmd');
  assert.ok(npm, JSON.stringify(runs));
  assert.deepEqual(npm.args.slice(0, 4), ['install', '--global', '--prefix', prefix]);
  assert.equal(basename(npm.args.at(-1) ?? ''), basename(file), 'the checked download is what npm installs');
  assert.ok(runs.some((run) => run.file === join(prefix, 'clasp.cmd') && run.args.join(' ') === '--version'));
  // The installer replaces its Node folder when Node's pin changes, so nothing global may live in it.
  assert.ok(!prefix.startsWith(join(programs, 'nodejs')));
  assert.ok((await machine.userPath()).includes(prefix));
  assert.deepEqual(runs.filter((run) => /\.ps1$/i.test(run.file)), []);
});

test("clasp's browser sign-in runs in the person's window and the installer waits for it; the checklist says who signed in", async (t) => {
  const where = await makeHome(t, { extraTools: ['apps-script'] });
  const { clasp } = await supplyClasp(where);
  const profile = await readProfile('york');
  const appsScript = profile.extraTools.find((/** @type {any} */ extra) => extra.id === 'apps-script');
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    'clasp.cmd show-authorized-user': [
      { output: 'Not logged in.\n' },
      { output: 'You are logged in as a.person@york.ac.uk.\nOAuth client ID: 1072944905499 (default).\n' },
    ],
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'clasp', `${clasp.version} (installed), signed in as a.person@york.ac.uk`);
  assert.ok(result.stdout.includes(appsScript.signIn.slice(0, 40)), result.stdout);
  const claspRuns = (await machine.runs()).filter((run) => basename(run.file) === 'clasp.cmd' && run.args[0] !== '--version');
  assert.deepEqual(
    claspRuns.map((run) => [run.args.join(' '), Boolean(run.onScreen)]),
    [['show-authorized-user', false], ['login', true], ['show-authorized-user', false]],
  );
});

test('after the sign-in, the Apps Script settings page is given with a plain instruction to turn on the API, opened on the fake machine under --home', async (t) => {
  const where = await makeHome(t, { extraTools: ['apps-script'] });
  await supplyClasp(where);
  const profile = await readProfile('york');
  const appsScript = profile.extraTools.find((/** @type {any} */ extra) => extra.id === 'apps-script');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const page = result.stdout.indexOf(appsScript.settingsPage);
  assert.ok(page > result.stdout.indexOf(appsScript.signIn.slice(0, 40)), 'the page comes after the sign-in');
  assert.match(result.stdout, /Google Apps Script API and switch it on/);
  const flowing = result.stdout.slice(page).replace(/[│|]/g, ' ').replace(/\s+/g, ' ');
  assert.match(flowing, /come back to this window \(the blue PowerShell window\) and press Enter/);
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes(`Settings page: ${appsScript.settingsPage} (opened)`), log.text);
  assert.ok((await fakeMachine(where.home).pagesOpened()).includes(appsScript.settingsPage));
});

test("a sign-in that doesn't finish leaves clasp installed and the checklist says it isn't signed in", async (t) => {
  const where = await makeHome(t, { extraTools: ['apps-script'] });
  const { clasp } = await supplyClasp(where);
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    'clasp.cmd show-authorized-user': { output: 'Not logged in.\n' },
    'clasp.cmd login': { code: 1, output: 'Error: Authorization failed.' },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'clasp', `${clasp.version} (installed), not signed in`);
});

test('on a re-run with clasp at the pinned version and signed in, nothing is reinstalled, signed in again or asked again', async (t) => {
  const where = await makeHome(t, { extraTools: ['apps-script'] });
  const { clasp } = await supplyClasp(where);
  const profile = await readProfile('york');
  const appsScript = profile.extraTools.find((/** @type {any} */ extra) => extra.id === 'apps-script');
  const prefix = join(programsFolder(where.home), 'npm');
  await markAsInstalledByUs(prefix);
  await writeFile(join(prefix, 'clasp.cmd'), 'the copy already there');
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    'clasp.cmd --version': { output: `${clasp.version}\n` },
    'clasp.cmd show-authorized-user': { output: 'You are logged in as a.person@york.ac.uk.\n' },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'clasp', `${clasp.version} (already up to date), signed in as a.person@york.ac.uk`);
  const runs = await machine.runs();
  assert.deepEqual(runs.filter((run) => basename(run.file) === 'npm.cmd' || run.args[0] === 'login'), []);
  assert.ok(!result.stdout.includes(appsScript.settingsPage), result.stdout);
  assert.ok((await machine.userPath()).includes(prefix));
});

test("if clasp can't be installed, the checklist says why and there is no sign-in or settings page", async (t) => {
  const where = await makeHome(t, { extraTools: ['apps-script'] });
  const profile = await readProfile('york');
  const appsScript = profile.extraTools.find((/** @type {any} */ extra) => extra.id === 'apps-script');
  const machine = fakeMachine(where.home);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'clasp', "Not installed: it wasn't in the downloads folder");
  assert.deepEqual((await machine.runs()).filter((run) => /clasp|npm/i.test(basename(run.file))), []);
  assert.ok(!result.stdout.includes(appsScript.settingsPage), result.stdout);
});

test('a clasp the person already has on the PATH is left as it is, gets no PATH entry, and is the one signed in', async (t) => {
  const where = await makeHome(t, { extraTools: ['apps-script'] });
  await supplyClasp(where);
  // Where npm puts a global package by default, outside the installer's folders.
  const theirs = join(where.home, 'AppData', 'Roaming', 'npm');
  await mkdir(theirs, { recursive: true });
  await writeFile(join(theirs, 'clasp.cmd'), 'their own clasp');
  const machine = fakeMachine(where.home);
  await machine.setEnvironment({ Path: theirs });
  await machine.setReplies({
    'clasp.cmd --version': { output: '2.4.2\n' },
    'clasp.cmd show-authorized-user': [{ output: 'Not logged in.\n' }, { output: 'You are logged in as a.person@york.ac.uk.\n' }],
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'clasp', `2.4.2 (already installed at ${theirs}, left as it is), signed in as a.person@york.ac.uk`);
  const runs = await machine.runs();
  assert.deepEqual(runs.filter((run) => basename(run.file) === 'npm.cmd'), [], 'nothing was installed');
  const login = runs.find((run) => run.args[0] === 'login');
  assert.equal(login?.file, join(theirs, 'clasp.cmd'));
  assert.deepEqual(await machine.userPath(), [theirs, claudeFolder(where.home)]);
});
