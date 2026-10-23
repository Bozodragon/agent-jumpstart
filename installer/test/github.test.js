// The optional GitHub flow. Under --answers nobody is at the screen, so the sign-up page is
// printed but not opened and nothing waits for Enter. gh still runs, through the fake machine:
// a test scripts what gh says in replies.json (for example the username `gh api user` prints),
// and sees what was run in runs.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fakeMachine, makeHome, programsFolder, readManifest, readOnlyLog, readProfile, runWith } from './harness.js';

/** @param {string} stdout @param {string} label @param {string} value */
function checklistSays(stdout, label, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(stdout, new RegExp(`${label}\\s+${escaped}`), stdout);
}

/**
 * Puts the pinned gh where the installer installs it, so it's taken as already installed.
 * @param {string} home
 * @returns {Promise<{ gh: string, replies: Record<string, { code?: number, output?: string }> }>}
 */
async function ghAlreadyInstalled(home) {
  const { tools } = await readManifest();
  const tool = tools.find((/** @type {any} */ entry) => entry.id === 'gh');
  const gh = join(programsFolder(home), tool.install.folder, tool.install.check);
  await mkdir(join(gh, '..'), { recursive: true });
  await writeFile(gh, 'stand-in');
  return { gh, replies: { 'gh.exe --version': { output: `gh version ${tool.version} (2026-10-01)\n` } } };
}

/** @param {{ file: string, args: string[] }[]} runs @param {string} gh */
const ghCommands = (runs, gh) => runs.filter((run) => run.file === gh && run.args[0] !== '--version').map((run) => run.args.join(' '));

test('with GitHub declined no page opens, gh signs nobody in, and the checklist says GitHub was skipped', async (t) => {
  const where = await makeHome(t, { github: false });
  const { gh, replies } = await ghAlreadyInstalled(where.home);
  await fakeMachine(where.home).setReplies(replies);
  const profile = await readProfile('york');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'GitHub', 'Skipped');
  assert.ok(!result.stdout.includes(profile.github.signUpPage), result.stdout);
  assert.deepEqual(ghCommands(await fakeMachine(where.home).runs(), gh), []);
  const log = await readOnlyLog(where.home);
  assert.ok(!log.text.includes(profile.github.signUpPage), log.text);
  assert.ok(log.text.includes('Checklist: GitHub: Skipped'), log.text);
});

test('with GitHub chosen, the sign-up page is shown with what to do, then gh (the installed one) signs in in the browser and sets up Git, and the checklist records the username', async (t) => {
  const where = await makeHome(t, { github: true });
  const { gh, replies } = await ghAlreadyInstalled(where.home);
  await fakeMachine(where.home).setReplies({
    ...replies,
    'gh.exe auth status --hostname github.com': { code: 1, output: 'You are not logged into any GitHub hosts.' },
    'gh.exe api user --jq .login': { output: 'octocat-york\n' },
  });
  const profile = await readProfile('york');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes(`GitHub sign-up page: ${profile.github.signUpPage}`), result.stdout);
  assert.ok(result.stdout.includes(profile.github.email), result.stdout);
  const runs = await fakeMachine(where.home).runs();
  assert.deepEqual(ghCommands(runs, gh), [
    'auth status --hostname github.com',
    'auth login --hostname github.com --git-protocol https --web --clipboard',
    'auth setup-git --hostname github.com',
    'api user --jq .login',
  ]);
  const login = runs.find((run) => run.args[1] === 'login');
  assert.equal(/** @type {any} */ (login).onScreen, true, 'the person must see the one-time code gh prints');
  checklistSays(result.stdout, 'GitHub', 'Signed in as octocat-york');
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes(`GitHub sign-up page: ${profile.github.signUpPage} (not opened: answers came from a file)`), log.text);
  assert.ok(log.text.includes('Checklist: GitHub: Signed in as octocat-york'), log.text);
});

test('someone already signed in to gh is left signed in, sent to no sign-up page, and their username still goes in the checklist', async (t) => {
  const where = await makeHome(t, { github: true });
  const { gh, replies } = await ghAlreadyInstalled(where.home);
  await fakeMachine(where.home).setReplies({ ...replies, 'gh.exe api user --jq .login': { output: 'already-here\n' } });
  const profile = await readProfile('york');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.ok(!result.stdout.includes(profile.github.signUpPage), result.stdout);
  assert.deepEqual(ghCommands(await fakeMachine(where.home).runs(), gh), [
    'auth status --hostname github.com',
    'auth setup-git --hostname github.com',
    'api user --jq .login',
  ]);
  checklistSays(result.stdout, 'GitHub', 'Signed in as already-here');
});

test('a GitHub sign-in that is abandoned is reported in the checklist and the run carries on', async (t) => {
  const where = await makeHome(t, { github: true });
  const { replies } = await ghAlreadyInstalled(where.home);
  await fakeMachine(where.home).setReplies({
    ...replies,
    'gh.exe auth status --hostname github.com': { code: 1 },
    'gh.exe auth login --hostname github.com --git-protocol https --web --clipboard': { code: 1 },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'GitHub', "Not signed in: the GitHub sign-in didn't finish");
  checklistSays(result.stdout, 'Connectors', 'You said you connected');
});

test('with GitHub chosen but the GitHub CLI not installed, the checklist says GitHub was not set up', async (t) => {
  const where = await makeHome(t, { github: true });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'GitHub CLI', 'Not installed');
  checklistSays(result.stdout, 'GitHub', "Not set up: the GitHub CLI isn't installed");
});
