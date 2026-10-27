import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, fakeMachine, makeHome, readOnlyLog, readSettings, runWith, seedSettings, seedT3Projects, supplyT3, t3Database, t3Leaves, t3Projects } from './harness.js';

/**
 * A line of the summaries at the end (the workspaces, the checklist). A temporary home's paths
 * are long enough for the boxes to wrap them, so the output is read as flowing text: borders
 * gone and each run of spaces and line breaks one space.
 * @param {string} stdout @param {string} label @param {string} value
 */
function summarySays(stdout, label, value) {
  const flowing = (/** @type {string} */ text) => text.replace(/[│|]/g, ' ').replace(/\s+/g, ' ');
  assert.ok(flowing(stdout).includes(flowing(`${label} ${value}`)), `expected a line "${label}  ${value}" in:\n${stdout}`);
}

/** @param {string} folder */
const foldersIn = async (folder) =>
  (await readdir(folder, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

test('a york run creates the top workspace in My Drive with each ticked workspace inside it, and lists them with their paths', async (t) => {
  const where = await makeHome(t);
  const drive = join(where.home, 'My Drive');
  const top = join(drive, 'Claude');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(await foldersIn(drive), ['Claude']);
  assert.deepEqual(await foldersIn(top), ['Personal assistant', 'Thinking space']);
  summarySays(result.stdout, 'Claude', top);
  summarySays(result.stdout, 'Thinking space', join(top, 'Thinking space'));
  summarySays(result.stdout, 'Personal assistant', join(top, 'Personal assistant'));
  assert.equal((await readSettings(where.home)).topWorkspace, top);
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes(`Workspace created: ${join(top, 'Thinking space')}`), log.text);
});

test("once T3 has opened, the top workspace is in T3's project list under its folder name, without the person adding it", async (t) => {
  const where = await makeHome(t);
  const top = join(where.home, 'My Drive', 'Claude');
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  // The silent install leaves T3, and T3 starting leaves its shim.
  await fakeMachine(where.home).setReplies({ [`${installer} /S --force-run`]: { creates: [t3Leaves.program, t3Leaves.shim] } });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(await t3Projects(where.home), [{ folder: top, title: 'Claude' }]);
  summarySays(result.stdout, 'Workspaces', 'Claude, added to T3 Code');
});

test('a second run leaves the workspace folders and their contents alone, and T3 still lists the top workspace once', async (t) => {
  const where = await makeHome(t);
  const top = join(where.home, 'My Drive', 'Claude');
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  await fakeMachine(where.home).setReplies({
    [`${installer} /S --force-run`]: { creates: [t3Leaves.program, t3Leaves.shim] },
    // As T3 answers: the second time, the folder is one it already lists.
    [`t3.cmd project add ${top} --title Claude`]: [
      { code: 0, output: `Added project 1b2c (Claude) at ${top}.` },
      { code: 1, output: `An active project already exists for '${top}'.` },
    ],
  });
  assert.equal((await runWith(where, 'york')).code, 0);
  await writeFile(join(top, 'CLAUDE.md'), 'my agent instructions');
  await writeFile(join(top, 'Thinking space', 'ideas.md'), 'my ideas');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(await readFile(join(top, 'CLAUDE.md'), 'utf8'), 'my agent instructions');
  assert.equal(await readFile(join(top, 'Thinking space', 'ideas.md'), 'utf8'), 'my ideas');
  assert.deepEqual(await foldersIn(top), ['Personal assistant', 'Thinking space']);
  assert.deepEqual(await t3Projects(where.home), [{ folder: top, title: 'Claude' }]);
  summarySays(result.stdout, 'Claude', `${top}, already there`);
  summarySays(result.stdout, 'Thinking space', `${join(top, 'Thinking space')}, already there`);
  summarySays(result.stdout, 'Workspaces', 'Claude, already in T3 Code');
});

test('a default run creates the top workspace in the folder the person chose, with only the workspaces they ticked', async (t) => {
  const where = await makeHome(t);
  const location = join(where.home, 'Work folders');
  await writeFile(where.answersFile, JSON.stringify({ workspacesLocation: location, workspaces: ['Personal assistant'] }));

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(await foldersIn(location), ['Claude']);
  assert.deepEqual(await foldersIn(join(location, 'Claude')), ['Personal assistant']);
  summarySays(result.stdout, 'Personal assistant', join(location, 'Claude', 'Personal assistant'));
  // T3 couldn't be installed here (no release details), so there was nothing to add it to.
  summarySays(result.stdout, 'Workspaces', "Claude, not in T3 Code: it isn't installed");
  assert.deepEqual(await t3Projects(where.home), []);
});

test("if T3 hasn't been opened yet, the workspaces are still created and the checklist says to open T3 and run this again", async (t) => {
  const where = await makeHome(t);
  const top = join(where.home, 'My Drive', 'Claude');
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  // Installed, but T3 never started, so it left no shim.
  await fakeMachine(where.home).setReplies({ [`${installer} /S --force-run`]: { creates: [t3Leaves.program] } });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(await foldersIn(top), ['Personal assistant', 'Thinking space']);
  assert.deepEqual(await t3Projects(where.home), []);
  summarySays(result.stdout, 'Workspaces', 'Claude, not in T3 Code yet: open T3 Code, then run this again');
});

test("if T3 won't add the top workspace, the checklist says so and the run still finishes", async (t) => {
  const where = await makeHome(t);
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  await fakeMachine(where.home).setReplies({
    [`${installer} /S --force-run`]: { creates: [t3Leaves.program, t3Leaves.shim] },
    't3.cmd': { code: 1, output: 'Failed to open the project database.' },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  summarySays(result.stdout, 'Workspaces', "Claude, not in T3 Code: T3 Code wouldn't add it");
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes('Failed to open the project database.'), log.text);
});

test("a file where the top workspace folder should be is left alone, and the checklist says it's in the way", async (t) => {
  const where = await makeHome(t);
  const top = join(where.home, 'My Drive', 'Claude');
  await writeFile(top, 'a file, not a folder');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(await readFile(top, 'utf8'), 'a file, not a folder');
  summarySays(result.stdout, 'Workspaces', 'Not created: a file called Claude is in the way');
  assert.equal(result.stdout.includes('Thinking space'), false, 'no workspace is listed inside it');
  assert.deepEqual(await t3Projects(where.home), []);
});

/**
 * The bytes of a file and when it was last written, so a test can tell it wasn't changed.
 * @param {string} file
 */
const fingerprint = async (file) => `${(await readFile(file)).toString('base64')} @ ${(await stat(file)).mtimeMs}`;

test("a top workspace already in T3 Code is offered and, by default, used as it is: no Google Drive check, no second top workspace, and only the missing workspaces made inside it", async (t) => {
  // Google Drive for desktop isn't even installed: a run that looked for it would stop.
  const where = await makeHome(t, {}, { googleDrive: 'missing' });
  const top = join(where.home, 'Work', 'Claude');
  await mkdir(join(top, 'Thinking space'), { recursive: true });
  await writeFile(join(top, 'Thinking space', 'ideas.md'), 'my ideas');
  await seedT3Projects(where.home, [{ title: 'Claude', folder: top }]);
  const database = join(where.home, t3Database);
  const before = await fingerprint(database);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(await foldersIn(top), ['Personal assistant', 'Thinking space']);
  assert.equal(await readFile(join(top, 'Thinking space', 'ideas.md'), 'utf8'), 'my ideas');
  assert.equal(await exists(join(where.home, 'My Drive')), false, 'no top workspace was made in Google Drive');
  const settings = await readSettings(where.home);
  assert.equal(settings.topWorkspace, top);
  assert.equal(settings.workspacesLocation, join(where.home, 'Work'));
  assert.equal(settings.googleDriveFolder, null);
  // The summary box can wrap a long path mid-word, so the log, which holds it whole, is read.
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes(`Workspace already there: ${join(top, 'Thinking space')}`), log.text);
  assert.ok(log.text.includes(`Workspace created: ${join(top, 'Personal assistant')}`), log.text);
  assert.equal(await fingerprint(database), before, "T3's database is only read, never written");
});

test("a T3 project is offered when its title is the profile's top workspace or it holds one of the profile's workspaces, and its folder is there", async (t) => {
  // An answer that isn't one of the options stops the run and lists them.
  const where = await makeHome(t, { topWorkspace: 'not one of them' });
  const named = join(where.home, 'Documents', 'Claude');
  const holding = join(where.home, 'Agents');
  const removed = join(where.home, 'Removed');
  for (const folder of [named, join(holding, 'Personal assistant'), join(where.home, 'Other'), join(removed, 'Thinking space')]) await mkdir(folder, { recursive: true });
  await seedT3Projects(where.home, [
    { title: 'Claude', folder: named },
    { title: 'Agents', folder: holding },
    { title: 'Other', folder: join(where.home, 'Other') },
    { title: 'Claude', folder: join(where.home, 'Gone', 'Claude') },
    { title: 'Removed', folder: removed, deleted: true },
  ]);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.ok(result.stdout.includes(`it should be one of "${named}", "${holding}", "new", or a folder's whole path.`), result.stdout);
});

test('choosing to set up a new top workspace makes it where it always went, and T3 lists it beside the old one', async (t) => {
  const where = await makeHome(t, { topWorkspace: 'new' });
  const existing = join(where.home, 'Work', 'Claude');
  await mkdir(existing, { recursive: true });
  await seedT3Projects(where.home, [{ title: 'Claude', folder: existing }]);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const top = join(where.home, 'My Drive', 'Claude');
  assert.deepEqual(await foldersIn(top), ['Personal assistant', 'Thinking space']);
  assert.deepEqual(await foldersIn(existing), [], 'the existing one is left alone');
  assert.equal((await readSettings(where.home)).topWorkspace, top);
});

test('a re-run whose top workspace is still there asks nothing about where workspaces live, and looks for no Google Drive', async (t) => {
  const where = await makeHome(t, { topWorkspace: 'a question was asked', googleDriveFolder: 'a question was asked' }, { googleDrive: 'missing' });
  const top = join(where.home, 'Work', 'Claude');
  await mkdir(top, { recursive: true });
  // T3 lists another candidate, which would be offered if the question were asked.
  await mkdir(join(where.home, 'Other', 'Claude'), { recursive: true });
  await seedT3Projects(where.home, [{ title: 'Claude', folder: join(where.home, 'Other', 'Claude') }]);
  await seedSettings(where.home, { profile: 'york', googleDriveFolder: null, workspacesLocation: join(where.home, 'Work'), topWorkspace: top });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await readSettings(where.home)).topWorkspace, top);
  assert.deepEqual(await foldersIn(top), ['Personal assistant', 'Thinking space']);
});

test('a folder of their own, whatever its name and with nothing in T3 Code like it, is used as it is: no Google Drive check, only the missing workspaces made inside it, and T3 lists it', async (t) => {
  // Google Drive for desktop isn't even installed: a run that looked for it would stop.
  const where = await makeHome(t, {}, { googleDrive: 'missing' });
  const top = join(where.home, 'Steve', 'Agents');
  await mkdir(join(top, 'Thinking space'), { recursive: true });
  await writeFile(join(top, 'Thinking space', 'ideas.md'), 'my ideas');
  await writeFile(where.answersFile, JSON.stringify({ topWorkspace: top }));
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  await fakeMachine(where.home).setReplies({ [`${installer} /S --force-run`]: { creates: [t3Leaves.program, t3Leaves.shim] } });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(await foldersIn(top), ['Personal assistant', 'Thinking space']);
  assert.equal(await readFile(join(top, 'Thinking space', 'ideas.md'), 'utf8'), 'my ideas');
  assert.equal(await exists(join(where.home, 'My Drive')), false, 'no top workspace was made in Google Drive');
  const settings = await readSettings(where.home);
  assert.equal(settings.topWorkspace, top);
  assert.equal(settings.workspacesLocation, join(where.home, 'Steve'));
  assert.equal(settings.googleDriveFolder, null);
  assert.deepEqual(await t3Projects(where.home), [{ folder: top, title: 'Agents' }]);
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes(`Workspace already there: ${top}`), log.text);
  assert.ok(log.text.includes(`Workspace already there: ${join(top, 'Thinking space')}`), log.text);
  assert.ok(log.text.includes(`Workspace created: ${join(top, 'Personal assistant')}`), log.text);
});

test("a T3 database that can't be read offers nothing, says so in the log, and the run carries on as before", async (t) => {
  const where = await makeHome(t);
  await mkdir(join(where.home, '.t3', 'userdata'), { recursive: true });
  await writeFile(join(where.home, t3Database), 'not a database');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await readSettings(where.home)).topWorkspace, join(where.home, 'My Drive', 'Claude'));
  assert.equal(await readFile(join(where.home, t3Database), 'utf8'), 'not a database');
  assert.match((await readOnlyLog(where.home)).text, /T3 Code's projects couldn't be read/);
});
