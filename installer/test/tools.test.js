import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { checklistSays, exists, fakeMachine, fileName, makeHome, programsFolder, readManifest, readOnlyLog, runWith, supplyDownloads } from './harness.js';

test('Node, Git and gh install per user from checked downloads, with their folders on the user PATH', async (t) => {
  const where = await makeHome(t);
  const manifest = await supplyDownloads(where);
  const machine = fakeMachine(where.home);
  await machine.setEnvironment({ Path: 'C:\\Already\\There' });
  const programs = programsFolder(where.home);

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stderr);
  // Tools with `when` (an extra tool's, or T3's) are installed by their own step.
  for (const tool of manifest.tools.filter((/** @type {any} */ tool) => !tool.when)) checklistSays(result.stdout, tool.name, tool.version);

  assert.ok(await exists(join(programs, 'nodejs', 'node.exe')), 'node.exe unpacked without its top folder');
  assert.ok(await exists(join(programs, 'nodejs', 'npm.cmd')));
  assert.ok(await exists(join(programs, 'GitHub CLI', 'bin', 'gh.exe')));

  const gitInstaller = (await machine.runs()).find((run) => basename(run.file).startsWith('Git-'));
  assert.ok(gitInstaller, 'the Git installer was run');
  assert.ok(gitInstaller.args.includes(`/DIR=${join(programs, 'Git')}`), gitInstaller.args.join(' '));
  assert.ok(gitInstaller.args.includes('/VERYSILENT'));
  // A locked-down execution policy blocks .ps1 entry points.
  assert.deepEqual((await machine.runs()).filter((run) => /\.ps1$/i.test(run.file)), []);

  assert.deepEqual(await machine.userPath(), [
    'C:\\Already\\There',
    join(programs, 'nodejs'),
    join(programs, 'Git', 'cmd'),
    join(programs, 'GitHub CLI', 'bin'),
  ]);
});

test('a download that fails its pinned checksum, or is missing, leaves that tool uninstalled and says why', async (t) => {
  const where = await makeHome(t);
  const manifest = await readManifest();
  const [node, git, gh] = ['node', 'git', 'gh'].map((id) => manifest.tools.find((/** @type {any} */ tool) => tool.id === id));
  // Files with the vendors' names but not the vendors' bytes, and no gh at all.
  await writeFile(join(where.downloads, fileName(node.downloads[process.arch].url)), 'not really Node');
  await writeFile(join(where.downloads, fileName(git.downloads[process.arch].url)), 'not really Git');
  const machine = fakeMachine(where.home);

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, 'Node.js', "Not installed: the download didn't match its pinned checksum");
  checklistSays(result.stdout, 'Git', "Not installed: the download didn't match its pinned checksum");
  checklistSays(result.stdout, 'GitHub CLI', "Not installed: it wasn't in the downloads folder");
  assert.equal(await exists(join(programsFolder(where.home), 'nodejs')), false);
  // No tool's installer or check runs. Only the registry is read, for a T3 already installed.
  const ran = (await machine.runs()).filter((run) => !(basename(run.file) === 'reg.exe' && run.args[0] === 'query'));
  assert.deepEqual(ran, [], 'nothing was run');
  assert.deepEqual(await machine.userPath(), []);
  const log = await readOnlyLog(where.home);
  assert.match(log.text, /Node\.js: checksum [0-9a-f]{64} isn't the pinned/);
  assert.ok(log.text.includes(fileName(gh.downloads[process.arch].url)), log.text);
});

test("an installer that fails, or a tool that won't run once installed, is reported and kept off the PATH", async (t) => {
  const where = await makeHome(t);
  const manifest = await supplyDownloads(where);
  const git = manifest.tools.find((/** @type {any} */ tool) => tool.id === 'git');
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    [fileName(git.downloads[process.arch].url)]: { code: 5, output: 'Setup was blocked' },
    'gh.exe --version': { code: -1, output: 'This program is blocked by group policy.' },
  });
  const programs = programsFolder(where.home);

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, 'Git', 'Not installed: its installer stopped with code 5');
  checklistSays(result.stdout, 'GitHub CLI', "Not installed: Windows wouldn't run it");
  assert.deepEqual(await machine.userPath(), [join(programs, 'nodejs')]);
  const log = await readOnlyLog(where.home);
  assert.match(log.text, /Setup was blocked/);
  assert.match(log.text, /blocked by group policy/);
});

test('a tool already at the pinned version, such as the Node the bootstrap unpacked, is left in place and put on the PATH', async (t) => {
  const where = await makeHome(t);
  const manifest = await supplyDownloads(where, ['git', 'gh']);
  const node = manifest.tools.find((/** @type {any} */ tool) => tool.id === 'node');
  const nodeFolder = join(programsFolder(where.home), 'nodejs');
  await mkdir(nodeFolder, { recursive: true });
  await writeFile(join(nodeFolder, 'node.exe'), 'the copy already there');
  const machine = fakeMachine(where.home);
  await machine.setReplies({ 'node.exe --version': { output: `v${node.version}\r\n` } });

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, 'Node.js', `${node.version} (already up to date)`);
  assert.equal(await readFile(join(nodeFolder, 'node.exe'), 'utf8'), 'the copy already there');
  assert.ok((await machine.userPath()).includes(nodeFolder));
});
