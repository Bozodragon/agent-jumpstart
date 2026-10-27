// Every program the installer runs is started with a PATH rebuilt from the registry at that
// moment: the machine PATH, then the user PATH (expanded), then whatever of the installer's own
// PATH isn't already there. The installer inherits the PowerShell window's environment, which
// predates anything installed before or during the run (Git from Software Centre, say), so a
// program given that PATH alone wouldn't find it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename, join } from 'node:path';
import { exists, fakeMachine, gitOnMachinePath, makeHome, programsFolder, runWith, skillsCli, supplyDownloads, supplyT3, t3Leaves } from './harness.js';

/** @param {string} path */
const entriesOf = (path) => path.split(';').filter(Boolean);

/** @param {string} entry */
const folder = (entry) => entry.replace(/[\\/]+$/, '').toLowerCase();

test('a program the installer runs sees a Git on the machine PATH that the installer\'s own PATH lacks, then the user PATH expanded, then the rest of its own', async (t) => {
  const where = await makeHome(t);
  await supplyDownloads(where, ['skills']);
  const cli = skillsCli(where.home);
  const git = await gitOnMachinePath(where.home);
  const machine = fakeMachine(where.home);
  await machine.setEnvironment({ Path: '%SystemRoot%\\jumpstart-test-tools' });
  await machine.setReplies(cli.install);
  const own = entriesOf(process.env.Path ?? '');
  assert.ok(!own.map(folder).includes(folder(git)), 'the installer starts without it');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const add = (await machine.runs()).find((run) => cli.isRun(run) && run.args[1] === 'add');
  assert.ok(add, 'the skills CLI was run');
  const given = entriesOf(add.path).map(folder);
  const userEntry = folder(join(process.env.SystemRoot ?? 'C:\\Windows', 'jumpstart-test-tools'));
  assert.equal(given[0], folder(git), add.path);
  assert.ok(given.indexOf(userEntry) > 0, `the user PATH, with %SystemRoot% expanded, comes next:\n${add.path}`);
  const firstOwn = own.map(folder).find((entry) => entry !== folder(git) && entry !== userEntry);
  assert.ok(firstOwn && given.indexOf(firstOwn) > given.indexOf(userEntry), `then the installer's own PATH:\n${add.path}`);
  assert.equal(new Set(given).size, given.length, 'each folder once');
});

test("T3 Code starts with Claude Code's folder on its PATH before Claude Code is there, and with the folders this run added, so it finds both without a refresh", async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  await supplyDownloads(where, ['node']);
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  const machine = fakeMachine(where.home);
  // The silent install starts T3, which leaves its shim; Claude Code isn't installed yet.
  await machine.setReplies({ [`${installer} /S --force-run`]: { creates: [t3Leaves.program, t3Leaves.shim] } });
  const claudeFolder = join(where.home, '.local', 'bin');
  const nodeFolder = join(programsFolder(where.home), 'nodejs');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Node\.js\s+[\d.]+ \(installed\)/);
  const t3 = (await machine.runs()).find((run) => basename(run.file) === installer);
  assert.ok(t3, 'the T3 installer was run');
  const given = entriesOf(t3.path).map(folder);
  assert.ok(given.includes(folder(claudeFolder)), `Claude Code's folder:\n${t3.path}`);
  assert.ok(given.includes(folder(nodeFolder)), `Node's folder, added this run:\n${t3.path}`);
  assert.ok((await machine.userPath()).includes(claudeFolder), "and it stays on the user PATH, for T3's next start");
  assert.ok(!(await exists(join(claudeFolder, 'claude.exe'))));
});
