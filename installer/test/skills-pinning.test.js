// The skills CLI is pinned like clasp: its npm package, by checksum, installed per user into a
// folder of its own before any skill, and run from there with the installer's own Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { checklistSays, fakeMachine, fileName, gitOnMachinePath, makeHome, readManifest, runWith, skillsCli, supplyDownloads } from './harness.js';

test("the skills CLI is installed from its pinned package, checked, into its own folder, before any skill is added with it, and run with the installer's own Node", async (t) => {
  const where = await makeHome(t);
  await supplyDownloads(where, ['skills']);
  await gitOnMachinePath(where.home);
  const cli = skillsCli(where.home);
  await fakeMachine(where.home).setReplies(cli.install);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Skills CLI', '1.7.4 (installed)');
  const runs = await fakeMachine(where.home).runs();
  const npm = runs.findIndex((run) => basename(run.file) === 'npm.cmd');
  assert.notEqual(npm, -1, JSON.stringify(runs));
  assert.deepEqual(runs[npm].args.slice(0, 4), ['install', '--global', '--prefix', cli.folder]);
  assert.equal(basename(runs[npm].args.at(-1) ?? ''), 'skills-1.7.4.tgz', 'the checked download is what npm installs');
  const adds = runs.filter((run) => cli.isRun(run) && run.args[1] === 'add');
  assert.equal(adds.length, 4);
  // The bin script its package.json names, with the Node running the installer: never skills.cmd,
  // which runs whichever node is first on PATH.
  assert.ok(adds.every((run) => run.file === process.execPath && run.args[0] === cli.script), JSON.stringify(adds));
  assert.deepEqual(runs.filter((run) => basename(run.file) === 'skills.cmd'), []);
  assert.ok(runs.indexOf(adds[0]) > npm);
  assert.deepEqual(runs.filter((run) => /npx/i.test(run.file)), [], 'npx would fetch whatever the registry serves');
  assert.ok(!(await fakeMachine(where.home).userPath()).includes(cli.folder), "it's for the installer, so it isn't put on the user PATH");
});

test('a skills CLI on the PATH is no reason not to install the pinned one: only the installer runs it', async (t) => {
  const where = await makeHome(t);
  await supplyDownloads(where, ['skills']);
  await gitOnMachinePath(where.home);
  const cli = skillsCli(where.home);
  const theirs = join(where.home, 'AppData', 'Roaming', 'npm');
  await mkdir(theirs, { recursive: true });
  await writeFile(join(theirs, 'skills.cmd'), 'their own skills CLI');
  await fakeMachine(where.home).setEnvironment({ Path: theirs });
  await fakeMachine(where.home).setReplies(cli.install);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Skills CLI', '1.7.4 (installed)');
  assert.ok((await fakeMachine(where.home).runs()).some((run) => cli.isRun(run) && run.args[1] === 'add'));
});

test("a skills CLI download that doesn't match its pinned checksum adds no skill, and the checklist says why", async (t) => {
  const where = await makeHome(t);
  const cli = (await readManifest()).tools.find((/** @type {any} */ tool) => tool.id === 'skills');
  await writeFile(join(where.downloads, fileName(cli.downloads[process.arch].url)), 'not really the skills CLI');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Skills CLI', "Not installed: the download didn't match its pinned checksum");
  checklistSays(result.stdout, '/jumpstart', "Not installed: the skills CLI isn't installed");
  checklistSays(result.stdout, 'Skills', 'None installed');
  assert.deepEqual((await fakeMachine(where.home).runs()).filter((run) => skillsCli(where.home).isRun(run)), []);
});
