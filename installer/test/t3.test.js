import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { checklistSays, exists, fakeMachine, makeHome, markAsInstalledByUs, programsFolder, readManifest, readOnlyLog, readSettings, runWith, supplyT3 } from './harness.js';

/** T3's uninstall entry, where Windows keeps the installed version. */
const uninstallKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\e9197887-efb3-55e0-985e-d6d3b5dd594a';

/** What T3's per-user installer leaves, relative to the home: the program and, once T3 has started, its command-line shim. */
const t3Program = (/** @type {'Beta' | 'Nightly'} */ brand) => join('AppData', 'Local', 'Programs', 't3code', `T3 Code (${brand}).exe`);
const t3Shim = join('.t3', 'bin', 't3.cmd');
const claudeProgram = join('.local', 'bin', 'claude.exe');

/** @param {string} home @param {string[]} paths relative to the home */
async function seed(home, paths) {
  for (const path of paths) {
    await mkdir(dirname(join(home, path)), { recursive: true });
    await writeFile(join(home, path), 'already here');
  }
}

const signedIn = {
  output: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'jo.bloggs@york.ac.uk', orgName: 'University of York', subscriptionType: 'enterprise' }),
};

test('with stable chosen, the current stable T3 is installed per user after its hash is checked, then Claude is confirmed signed in', async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  // Node is already in place, as an earlier run left it.
  const node = (await readManifest()).tools.find((/** @type {any} */ tool) => tool.id === 'node');
  await seed(where.home, [join('AppData', 'Local', 'Programs', 'nodejs', 'node.exe')]);
  await markAsInstalledByUs(join(programsFolder(where.home), 'nodejs'));
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    'node.exe --version': { output: `v${node.version}\r\n` },
    // The silent install leaves the program, and T3 starting leaves its shim. Claude Code
    // was installed from T3's welcome screen.
    [`${installer} /S --force-run`]: { creates: [t3Program('Beta'), t3Shim, claudeProgram] },
    'claude.exe --version': { output: '2.1.306 (Claude Code)\n' },
    'claude.exe auth status': signedIn,
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, 'T3 Code', '0.1.2 (stable, installed)');
  checklistSays(result.stdout, 'Claude Code', '2.1.306, signed in as jo.bloggs@york.ac.uk');

  const runs = await machine.runs();
  const t3 = runs.findIndex((run) => basename(run.file) === installer);
  assert.ok(t3 >= 0, 'the T3 installer was run');
  assert.deepEqual(runs[t3].args, ['/S', '--force-run']);
  // T3 reads PATH only when it starts, so it comes after the other tools and their PATH entries.
  const nodeChecked = runs.findIndex((run) => basename(run.file) === 'node.exe');
  assert.ok(nodeChecked >= 0 && nodeChecked < t3, runs.map((run) => run.file).join('\n'));
  const userPath = await machine.userPath();
  const nodeOnPath = userPath.indexOf(join(programsFolder(where.home), 'nodejs'));
  const claudeOnPath = userPath.indexOf(join(where.home, '.local', 'bin'));
  assert.ok(nodeOnPath >= 0 && claudeOnPath > nodeOnPath, `Claude Code's folder is on the user PATH, after Node's:\n${userPath.join('\n')}`);
  assert.equal((await readSettings(where.home)).email, 'jo.bloggs@york.ac.uk');

  const log = await readOnlyLog(where.home);
  assert.match(log.text, /T3 Code: checksum matches/);
  assert.ok(log.text.includes(`T3 Code: first launch seen (${join(where.home, t3Shim)})`), log.text);
});

test('with nightly chosen, the newest nightly build listed by GitHub is installed per user', async (t) => {
  const where = await makeHome(t, { channel: 'nightly' });
  const nightly = '0.1.3-nightly.20261023.3579';
  // GitHub's release list, newest first: a preview (never offered) above the newest nightly.
  await writeFile(
    join(where.downloads, 'releases'),
    JSON.stringify([
      { tag_name: 'v0.1.3-preview.20261023.3590', draft: false, prerelease: true },
      { tag_name: `v${nightly}`, draft: false, prerelease: true },
      { tag_name: 'v0.1.2', draft: false, prerelease: false },
      { tag_name: 'v0.1.2-nightly.20261022.3541', draft: false, prerelease: true },
    ]),
  );
  const installer = await supplyT3(where.downloads, 'nightly.yml', nightly);
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    [`${installer} /S --force-run`]: { creates: [t3Program('Nightly'), t3Shim] },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, 'T3 Code', `${nightly} (nightly, installed)`);
  assert.ok((await machine.runs()).some((run) => basename(run.file) === installer), 'the nightly installer was run');
  assert.ok(await exists(join(where.home, t3Program('Nightly'))));
});

test("a T3 download that doesn't match the hash T3 published is never run, and the checklist says why", async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2', { wrongHash: true });
  const machine = fakeMachine(where.home);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, 'T3 Code', "Not installed: the download didn't match T3's checksum");
  checklistSays(result.stdout, 'Claude Code', 'Not installed');
  assert.equal((await machine.runs()).some((run) => basename(run.file) === installer), false, 'the installer was not run');
  assert.equal(await exists(join(where.home, t3Program('Beta'))), false);
});

test('with no release details to go on, T3 is reported not installed rather than stopping the run', async (t) => {
  const where = await makeHome(t, { channel: 'nightly' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, 'T3 Code', "Not installed: its release details were missing");
  assert.equal((await readSettings(where.home)).email, null);
});

test("when Claude isn't signed in, its own sign-in runs in the person's window, and the installer confirms it afterwards", async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    [`${installer} /S --force-run`]: { creates: [t3Program('Beta'), t3Shim, claudeProgram] },
    'claude.exe --version': { output: '2.1.306 (Claude Code)\n' },
    'claude.exe auth status': [{ code: 1, output: JSON.stringify({ loggedIn: false, authMethod: 'none' }) }, signedIn],
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, 'Claude Code', '2.1.306, signed in as jo.bloggs@york.ac.uk');
  const login = (await machine.runs()).find((run) => basename(run.file) === 'claude.exe' && run.args.join(' ') === 'auth login');
  assert.ok(login, 'claude auth login was run');
  assert.equal(login.onScreen, true, 'in the person\'s window');
  assert.equal(login.file, join(where.home, claudeProgram), 'by full path, not whatever claude is on PATH');
  assert.equal((await readSettings(where.home)).email, 'jo.bloggs@york.ac.uk');
});

test("a sign-in that doesn't finish leaves Claude reported as not signed in, with no email recorded", async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    [`${installer} /S --force-run`]: { creates: [t3Program('Beta'), t3Shim, claudeProgram] },
    'claude.exe --version': { output: '2.1.306 (Claude Code)\n' },
    'claude.exe auth status': { code: 1, output: JSON.stringify({ loggedIn: false, authMethod: 'none' }) },
    'claude.exe auth login': { code: 1 },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, 'Claude Code', '2.1.306, not signed in');
  assert.ok((await machine.userPath()).includes(join(where.home, '.local', 'bin')));
  assert.equal((await readSettings(where.home)).email, null);
});

test("if Claude Code wasn't installed from T3's welcome screen, the checklist says so, nothing runs it, and its folder is still on the PATH for when it is", async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  const machine = fakeMachine(where.home);
  await machine.setReplies({ [`${installer} /S --force-run`]: { creates: [t3Program('Beta'), t3Shim] } });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, 'T3 Code', '0.1.2 (stable, installed)');
  checklistSays(result.stdout, 'Claude Code', "Not installed: T3 Code's welcome screen installs it");
  // Put there before T3 started, so T3 finds Claude Code as soon as its welcome screen installs it.
  assert.ok((await machine.userPath()).includes(join(where.home, '.local', 'bin')));
  assert.equal((await machine.runs()).some((run) => basename(run.file) === 'claude.exe'), false);
});

test('a T3 already installed is left alone, and a signed-in Claude is not signed in again', async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  await seed(where.home, [t3Program('Beta'), t3Shim, claudeProgram]);
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    [`reg.exe query ${uninstallKey} /v DisplayVersion`]: { output: `\r\n${uninstallKey}\r\n    DisplayVersion    REG_SZ    0.1.2\r\n\r\n` },
    'claude.exe --version': { output: '2.1.306 (Claude Code)\n' },
    'claude.exe auth status': signedIn,
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, 'T3 Code', '0.1.2 (stable, already installed, left as it is)');
  checklistSays(result.stdout, 'Claude Code', '2.1.306, signed in as jo.bloggs@york.ac.uk');
  const runs = await machine.runs();
  assert.equal(runs.some((run) => basename(run.file) === installer), false, 'the installer was not run');
  assert.equal(runs.some((run) => run.args.join(' ') === 'auth login'), false);
});

test('a T3 already installed on another channel, or at an older build, is left as it is: no download, no update, no switch, and no channel question', async (t) => {
  const nightly = '0.1.3-nightly.20261023.3579';
  // Were the channel asked, this answer would stop the run.
  const where = await makeHome(t, { channel: 'a question was asked' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.4');
  await seed(where.home, [t3Program('Nightly'), t3Shim]);
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    [`reg.exe query ${uninstallKey} /v DisplayVersion`]: { output: `    DisplayVersion    REG_SZ    ${nightly}\r\n` },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'T3 Code', `${nightly} (nightly, already installed, left as it is)`);
  assert.equal((await machine.runs()).some((run) => basename(run.file) === installer), false, 'the installer was not run');
  assert.equal(await exists(join(where.home, t3Program('Beta'))), false);
  assert.equal((await readSettings(where.home)).channel, 'nightly', 'the channel found is recorded');
  const log = await readOnlyLog(where.home);
  assert.ok(!log.text.includes('latest.yml'), 'no release feed was even read');
});

test("a T3 whose program is there but whose version Windows doesn't know is still left as it is, and still waited for if it hasn't been opened", async (t) => {
  const where = await makeHome(t, { channel: 'a question was asked' });
  await supplyT3(where.downloads, 'latest.yml', '0.1.4');
  await seed(where.home, [t3Program('Beta')]);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'T3 Code', 'Version unknown (stable, already installed, left as it is, not opened yet)');
  assert.equal((await readSettings(where.home)).channel, 'stable');
});

test("when T3 hasn't opened after its install, the checklist says it hasn't been opened yet", async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  const machine = fakeMachine(where.home);
  await machine.setReplies({ [`${installer} /S --force-run`]: { creates: [t3Program('Beta')] } });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, 'T3 Code', '0.1.2 (stable, installed, not opened yet)');
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes(`T3 Code: hasn't been opened yet (no ${join(where.home, t3Shim)})`), log.text);
});
