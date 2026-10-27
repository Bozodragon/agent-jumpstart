import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { checklistSays, claudeFolder, exists, fakeMachine, fileName, installedMarker, makeHome, markAsInstalledByUs, programsFolder, readManifest, readOnlyLog, runWith, supplyDownloads } from './harness.js';

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
    claudeFolder(where.home),
  ]);
  // Each is marked as the installer's, so a later run knows it may update it.
  for (const folder of ['nodejs', 'Git', 'GitHub CLI']) assert.ok(await exists(join(programs, folder, installedMarker)), folder);
});

test('a tool already on the PATH outside the installer\'s folders is left as it is and used: nothing downloaded, no PATH entry, and later steps run that copy', async (t) => {
  const where = await makeHome(t, { github: true });
  const manifest = await supplyDownloads(where);
  const git = manifest.tools.find((/** @type {any} */ tool) => tool.id === 'git');
  const programs = programsFolder(where.home);
  // Node.js installed for everyone (on the machine PATH), and gh installed for this user elsewhere.
  const theirNode = join(where.home, 'Program Files', 'nodejs');
  const theirGh = join(where.home, 'Tools', 'gh', 'bin');
  for (const [folder, file] of [[theirNode, 'node.exe'], [theirGh, 'gh.exe']]) {
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, file), 'their own copy');
  }
  const machine = fakeMachine(where.home);
  await machine.setMachinePath([theirNode]);
  await machine.setEnvironment({ Path: `${theirGh}\\` });
  await machine.setReplies({
    'node.exe --version': { output: 'v22.11.0\r\n' },
    'gh.exe --version': { output: 'gh version 2.40.1 (2024-01-01)\n' },
    'gh.exe api user --jq .login': { output: 'octocat\n' },
  });

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Node.js', `22.11.0 (already installed at ${theirNode}, left as it is)`);
  checklistSays(result.stdout, 'GitHub CLI', `2.40.1 (already installed at ${theirGh}, left as it is)`);
  checklistSays(result.stdout, 'Git', `${git.version} (installed)`);
  assert.equal(await exists(join(programs, 'nodejs')), false, 'no second Node.js');
  assert.equal(await exists(join(programs, 'GitHub CLI')), false, 'no second gh');
  assert.deepEqual(await machine.userPath(), [`${theirGh}\\`, join(programs, 'Git', 'cmd'), claudeFolder(where.home)]);
  // The GitHub step signs in with their gh.
  const ghRuns = (await machine.runs()).filter((run) => basename(run.file) === 'gh.exe' && run.args[0] === 'auth');
  assert.ok(ghRuns.length > 0);
  assert.ok(ghRuns.every((run) => run.file === join(theirGh, 'gh.exe')), JSON.stringify(ghRuns));
  checklistSays(result.stdout, 'GitHub', 'Signed in as octocat');
});

test("a copy in the installer's own folder that the installer didn't put there is the person's: left as it is, kept off the PATH, and used", async (t) => {
  const where = await makeHome(t);
  const manifest = await supplyDownloads(where);
  const git = manifest.tools.find((/** @type {any} */ tool) => tool.id === 'git');
  const folder = join(programsFolder(where.home), 'Git');
  await mkdir(join(folder, 'cmd'), { recursive: true });
  await writeFile(join(folder, 'cmd', 'git.exe'), 'their own copy');
  const machine = fakeMachine(where.home);
  await machine.setReplies({ 'git.exe --version': { output: 'git version 2.40.0.windows.1\n' } });

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Git', `2.40.0.windows.1 (already installed at ${folder}, left as it is)`);
  assert.equal(await readFile(join(folder, 'cmd', 'git.exe'), 'utf8'), 'their own copy');
  assert.equal(await exists(join(folder, installedMarker)), false);
  assert.equal((await machine.runs()).some((run) => basename(run.file) === fileName(git.downloads[process.arch].url)), false, "Git's installer wasn't run");
  assert.ok(!(await machine.userPath()).includes(join(folder, 'cmd')));
});

test("a folder of the installer's that holds something else, and not the tool, is left as it is and the tool isn't installed", async (t) => {
  const where = await makeHome(t);
  await supplyDownloads(where);
  const folder = join(programsFolder(where.home), 'GitHub CLI');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'notes.txt'), 'something of theirs');

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'GitHub CLI', `Not installed: ${folder} already holds something else`);
  assert.equal(await readFile(join(folder, 'notes.txt'), 'utf8'), 'something of theirs');
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
  // No tool's installer or check runs. Only the registry is read, for a T3 already installed, and
  // Anthropic's installer runs for Claude Code, which isn't one of these pinned tools.
  const ran = (await machine.runs()).filter((run) => !(basename(run.file) === 'reg.exe' && run.args[0] === 'query') && basename(run.file) !== 'powershell.exe');
  assert.deepEqual(ran, [], 'nothing was run');
  assert.deepEqual(await machine.userPath(), [claudeFolder(where.home)], "no tool's folder, only Claude Code's");
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
  assert.deepEqual(await machine.userPath(), [join(programs, 'nodejs'), claudeFolder(where.home)]);
  const log = await readOnlyLog(where.home);
  assert.match(log.text, /Setup was blocked/);
  assert.match(log.text, /blocked by group policy/);
});

test('a tool the installer put there before, at the pinned version, is left in place and put back on the PATH', async (t) => {
  const where = await makeHome(t);
  const manifest = await supplyDownloads(where, ['git', 'gh']);
  const node = manifest.tools.find((/** @type {any} */ tool) => tool.id === 'node');
  const nodeFolder = join(programsFolder(where.home), 'nodejs');
  await markAsInstalledByUs(nodeFolder);
  await writeFile(join(nodeFolder, 'node.exe'), 'the copy already there');
  const machine = fakeMachine(where.home);
  await machine.setReplies({ 'node.exe --version': { output: `v${node.version}\r\n` } });

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, 'Node.js', `${node.version} (already up to date)`);
  assert.equal(await readFile(join(nodeFolder, 'node.exe'), 'utf8'), 'the copy already there');
  assert.ok((await machine.userPath()).includes(nodeFolder));
});
