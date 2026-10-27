// Claude Code is installed by the installer, with Anthropic's own install script run in the
// person's window, before T3 Code is installed and started: T3's first-run wizard, which would
// have offered to install it, is skipped, and T3 reads PATH only as it starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { checklistSays, claudeFolder, fakeMachine, makeHome, readOnlyLog, readSettings, runWith, supplyT3, t3Leaves } from './harness.js';

const claudeProgram = join('.local', 'bin', 'claude.exe');

/** Windows PowerShell, from System32, as the installer runs it. */
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** Anthropic's own install script, run as Anthropic says to. */
const installClaude = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'];

const signedIn = { output: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'jo.bloggs@york.ac.uk' }) };

test("with no Claude Code, Anthropic's own installer runs in the person's window before T3 is installed, and Claude is then signed in as before", async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.3');
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    'powershell.exe': { creates: [claudeProgram] },
    'claude.exe --version': { output: '2.1.311 (Claude Code)\n' },
    'claude.exe auth status': signedIn,
    [`${installer} /S --force-run`]: { creates: [t3Leaves.program, t3Leaves.shim] },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Claude Code', '2.1.311, signed in as jo.bloggs@york.ac.uk');
  const runs = await machine.runs();
  const script = runs.findIndex((run) => run.file === powershell);
  assert.notEqual(script, -1, JSON.stringify(runs.map((run) => run.file)));
  assert.deepEqual(runs[script].args, installClaude);
  assert.equal(runs[script].onScreen, true, "in the person's window, so they see its progress");
  const t3 = runs.findIndex((run) => basename(run.file) === installer);
  const status = runs.findIndex((run) => basename(run.file) === 'claude.exe' && run.args.join(' ') === 'auth status');
  assert.ok(script < status && status < t3, 'Claude Code is installed and checked before T3 is installed and started');
  assert.ok(runs[t3].path.toLowerCase().split(';').includes(claudeFolder(where.home).toLowerCase()), 'and T3 starts with it on its PATH');
  assert.equal((await readSettings(where.home)).email, 'jo.bloggs@york.ac.uk');
  assert.doesNotMatch(result.stdout, /welcome screen/);
});

test("if Anthropic's installer doesn't leave Claude Code in place, the checklist says so, the run carries on, and its folder is on the PATH for later", async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.3');
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    'powershell.exe': { code: 1 },
    [`${installer} /S --force-run`]: { creates: [t3Leaves.program, t3Leaves.shim] },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Claude Code', "Not installed: Claude Code's installer didn't finish");
  checklistSays(result.stdout, 'T3 Code', '0.1.3 (stable, installed)');
  assert.equal((await machine.runs()).some((run) => basename(run.file) === 'claude.exe'), false, 'nothing runs a Claude Code that isn\'t there');
  assert.ok((await machine.userPath()).includes(claudeFolder(where.home)));
  assert.match((await readOnlyLog(where.home)).text, /Claude Code: its installer finished with code 1, and .*claude\.exe isn't there/);
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
  assert.equal((await machine.runs()).some((run) => run.file === powershell), false);
});
