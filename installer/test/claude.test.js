// Claude Code is installed by the installer before T3 Code is installed and started: T3's
// first-run wizard, which would have offered to install it, is skipped, and T3 reads PATH only as
// it starts. Its own download is tested in claude-download.test.js. When that fails, Anthropic's
// own install script runs hidden, its output captured, under a spinner (the script shows no
// progress of its own).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { checklistSays, claudeFolder, claudeProgram, fakeMachine, makeHome, readOnlyLog, readSettings, run, runWith, supplyT3, t3Leaves } from './harness.js';

/** Windows PowerShell, from System32, as the installer runs it. */
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** Anthropic's own install script, run as Anthropic says to. */
const installClaude = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'];

const signedIn = { output: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'jo.bloggs@york.ac.uk' }) };

/**
 * Runs the installer with no downloads folder and nothing on the fake internet, so Claude Code's
 * own download fails at its first step and Anthropic's script runs instead (and the pinned tools
 * aren't installed, which these tests don't look at).
 * @param {{ home: string, downloads: string, answersFile: string }} where @param {string[]} [extra] more flags
 */
async function withAnthropicsScript(where, extra = []) {
  const nowhere = join(where.downloads, '..', 'nowhere');
  await mkdir(nowhere, { recursive: true });
  return run(['--profile', 'york', ...extra, '--home', where.home, '--answers', where.answersFile], { internet: { folder: nowhere } });
}

test("with no Claude Code, it's installed hidden, not in the person's window, before T3 is installed, and Claude is then signed in as before", async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.3');
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    'claude.exe --version': { output: '2.1.311 (Claude Code)\n' },
    'claude.exe auth status': signedIn,
    [`${installer} /S --force-run`]: { creates: [t3Leaves.program, t3Leaves.shim] },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Claude Code', '2.1.311, signed in as jo.bloggs@york.ac.uk');
  const runs = await machine.runs();
  const install = runs.findIndex((run) => basename(run.file) === 'claude.exe' && run.args[0] === 'install');
  assert.notEqual(install, -1, JSON.stringify(runs.map((run) => run.file)));
  assert.equal(runs[install].onScreen, undefined, "not in the person's window: it shows no progress there");
  const t3 = runs.findIndex((run) => basename(run.file) === installer);
  const status = runs.findIndex((run) => basename(run.file) === 'claude.exe' && run.args.join(' ') === 'auth status');
  assert.ok(install < status && status < t3, 'Claude Code is installed and checked before T3 is installed and started');
  assert.ok(runs[t3].path.toLowerCase().split(';').includes(claudeFolder(where.home).toLowerCase()), 'and T3 starts with it on its PATH');
  assert.equal((await readSettings(where.home)).email, 'jo.bloggs@york.ac.uk');
  assert.doesNotMatch(result.stdout, /welcome screen/);
});

test("Anthropic's script runs hidden, not in the person's window, under a spinner that opens with its warning, and nothing promises progress below or says how it ended outside a terminal", async (t) => {
  const where = await makeHome(t);
  const machine = fakeMachine(where.home);
  await machine.setReplies({ 'powershell.exe': { creates: [claudeProgram] }, 'claude.exe --version': { output: '2.1.311 (Claude Code)\n' }, 'claude.exe auth status': signedIn });

  const result = await withAnthropicsScript(where);

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Claude Code', '2.1.311, signed in as jo.bloggs@york.ac.uk');
  const script = (await machine.runs()).find((run) => run.file === powershell);
  assert.ok(script);
  assert.deepEqual(script.args, installClaude);
  assert.equal(script.onScreen, undefined, "not in the person's window: it shows no progress there");
  assert.match(result.stdout, /Installing Claude Code\. It's over 300 MB, so this can take several minutes/);
  assert.doesNotMatch(result.stdout, /Its progress shows below/);
  assert.doesNotMatch(result.stdout, /Claude Code installed|Claude Code not installed/);
});

test('a fake reply can be given a time to take, and the run waits that long for it', async (t) => {
  const where = await makeHome(t);
  const machine = fakeMachine(where.home);
  await machine.setReplies({ 'claude.exe install': { creates: [claudeProgram], takes: 800 }, 'claude.exe --version': { output: '2.1.311 (Claude Code)\n' }, 'claude.exe auth status': signedIn });
  const before = Date.now();

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  // Starting node and the run's other steps take a while on their own; only a lower bound is steady.
  assert.ok(Date.now() - before >= 800, `the run took ${Date.now() - before} ms`);
});

/** @param {string} text @param {string} part */
const timesIn = (text, part) => text.split(part).length - 1;

for (const { name, reply, debug, logged } of [
  { name: 'after a non-zero exit', reply: { code: 1, output: 'Download failed: 403' }, debug: false, logged: true },
  { name: 'after an exit code of 0 that leaves no claude.exe', reply: { output: 'Download failed: 403' }, debug: false, logged: true },
  { name: 'after an exit code of 0 that leaves no claude.exe, in a debug run', reply: { output: 'Download failed: 403' }, debug: true, logged: true },
  { name: 'after a success, in a debug run', reply: { output: 'Download failed: 403', creates: [claudeProgram] }, debug: true, logged: true },
  { name: 'after a success in an ordinary run', reply: { output: 'Download failed: 403', creates: [claudeProgram] }, debug: false, logged: false },
]) {
  test(`Anthropic's script's output is ${logged ? 'in' : 'not in'} the log ${name}${logged ? ', once' : ''}`, async (t) => {
    const where = await makeHome(t);
    await fakeMachine(where.home).setReplies({ 'powershell.exe': reply, 'claude.exe --version': { output: '2.1.311 (Claude Code)\n' }, 'claude.exe auth status': signedIn });

    const result = await withAnthropicsScript(where, debug ? ['--debug'] : []);

    assert.equal(result.code, 0, result.stdout + result.stderr);
    const { text } = await readOnlyLog(where.home);
    assert.equal(timesIn(text, 'Download failed: 403'), logged ? 1 : 0, text);
    // Quiet runs hold it as Claude Code's own lines; a failed run holds it the way any program's is.
    if (logged && !debug && reply.code === undefined) assert.match(text, /Claude Code: installer said: Download failed: 403/);
    if (!debug && reply.code === undefined) assert.doesNotMatch(text, /Running:.*powershell|Ran: powershell/);
  });
}

test('an ordinary run logs no Running: or Ran: line for an Anthropic script that exited 0 and left nothing', async (t) => {
  const where = await makeHome(t);
  await fakeMachine(where.home).setReplies({ 'powershell.exe': { output: 'odd' } });

  const result = await withAnthropicsScript(where);

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.doesNotMatch((await readOnlyLog(where.home)).text, /Running:.*powershell|Ran: powershell/);
});

test("if Anthropic's script doesn't leave Claude Code in place either, the checklist says so, an answers-file run skips it, and its folder is on the PATH for later", async (t) => {
  const where = await makeHome(t);
  const machine = fakeMachine(where.home);
  await machine.setReplies({ 'powershell.exe': { code: 1 } });

  const result = await withAnthropicsScript(where);

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Claude Code', "Not installed: Claude Code's installer didn't finish");
  assert.equal((await machine.runs()).some((run) => basename(run.file) === 'claude.exe'), false, "nothing runs a Claude Code that isn't there");
  assert.ok((await machine.userPath()).includes(claudeFolder(where.home)));
  const { text } = await readOnlyLog(where.home);
  assert.match(text, /Claude Code: Anthropic's script finished with code 1, and .*claude\.exe isn't there/);
  assert.match(text, /Answer: claudeInstall: "skip"/);
  assert.equal((await readSettings(where.home)).email, null);
});

test('a Claude Code already there is not installed again', async (t) => {
  const where = await makeHome(t);
  await mkdir(claudeFolder(where.home), { recursive: true });
  await writeFile(join(where.home, claudeProgram), 'already here');
  const machine = fakeMachine(where.home);
  await machine.setReplies({ 'claude.exe --version': { output: '2.1.311 (Claude Code)\n' }, 'claude.exe auth status': signedIn });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Claude Code', '2.1.311, signed in as jo.bloggs@york.ac.uk');
  const runs = await machine.runs();
  assert.equal(runs.some((run) => run.file === powershell), false);
  assert.equal(runs.some((run) => basename(run.file) === 'claude.exe' && run.args[0] === 'install'), false);
  assert.doesNotMatch((await readOnlyLog(where.home)).text, /Claude Code: (reading|taking) /, 'nothing of its release is read');
});
