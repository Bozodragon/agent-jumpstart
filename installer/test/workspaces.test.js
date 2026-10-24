import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fakeMachine, makeHome, readOnlyLog, readSettings, runWith, supplyT3, t3Leaves, t3Projects } from './harness.js';

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
