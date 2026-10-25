// The skills CLI is pinned like clasp: its npm package, by checksum, installed per user into a
// folder of its own before any skill, and run from there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fakeMachine, fileName, makeHome, programsFolder, readManifest, runWith, supplyDownloads } from './harness.js';

/** @param {string} stdout @param {string} label @param {string} value */
function checklistSays(stdout, label, value) {
  const line = stdout.split('\n').find((row) => row.includes(label) && row.includes(value));
  assert.ok(line, `expected a checklist line "${label} … ${value}" in:\n${stdout}`);
}

/** @param {{ file: string, args: string[] }} run */
const isSkillAdd = (run) => basename(run.file) === 'skills.cmd' && run.args[0] === 'add';

test('the skills CLI is installed from its pinned package, checked, into its own folder, before any skill is added with it', async (t) => {
  const where = await makeHome(t);
  await supplyDownloads(where, ['skills']);
  const folder = join(programsFolder(where.home), 'skills-cli');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Skills CLI', '1.7.4 (installed)');
  const runs = await fakeMachine(where.home).runs();
  const npm = runs.findIndex((run) => basename(run.file) === 'npm.cmd');
  assert.notEqual(npm, -1, JSON.stringify(runs));
  assert.deepEqual(runs[npm].args.slice(0, 4), ['install', '--global', '--prefix', folder]);
  assert.equal(basename(runs[npm].args.at(-1) ?? ''), 'skills-1.7.4.tgz', 'the checked download is what npm installs');
  const adds = runs.filter(isSkillAdd);
  assert.equal(adds.length, 4);
  assert.ok(adds.every((run) => run.file === join(folder, 'skills.cmd')), 'the pinned CLI adds every skill');
  assert.ok(runs.indexOf(adds[0]) > npm);
  assert.deepEqual(runs.filter((run) => /npx/i.test(run.file)), [], 'npx would fetch whatever the registry serves');
  assert.ok(!(await fakeMachine(where.home).userPath()).includes(folder), "it's for the installer, so it isn't put on the user PATH");
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
  assert.deepEqual((await fakeMachine(where.home).runs()).filter(isSkillAdd), []);
});
