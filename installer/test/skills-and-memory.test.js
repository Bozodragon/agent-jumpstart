import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fakeMachine, makeHome, readOnlyLog, readProfile, readSettings, runWith, seedSettings, supplyDownloads } from './harness.js';

/** @param {string} stdout @param {string} label @param {string} value */
function checklistSays(stdout, label, value) {
  const line = stdout.split('\n').find((row) => row.includes(label) && row.includes(value));
  assert.ok(line, `expected a checklist line "${label} … ${value}" in:\n${stdout}`);
}

/** Where a skill's SKILL.md is, relative to the home. @param {string} name */
const skillFile = (name) => join('.claude', 'skills', name, 'SKILL.md');

/** @param {string} home */
const claudeSettingsFile = (home) => join(home, '.claude', 'settings.json');

/**
 * Each skill the York profile installs, with the source it comes from. A source given
 * without names is the path to one skill, named by its last part.
 * @returns {Promise<{ source: string, names: string[] }[]>}
 */
async function yorkSkills() {
  const profile = await readProfile('york');
  return profile.skills.map((/** @type {{ source: string, names?: string[] }} */ { source, names }) => ({
    source,
    names: names ?? [source.split('/').at(-1) ?? source],
  }));
}

/** A home where the pinned skills CLI can be installed (see skills-pinning.test.js). @param {import('node:test').TestContext} t */
async function homeWithSkillsCli(t) {
  const where = await makeHome(t);
  await supplyDownloads(where, ['skills']);
  return where;
}

/** @param {string} home */
async function skillsCliRuns(home) {
  return (await fakeMachine(home).runs()).filter((ran) => basename(ran.file) === 'skills.cmd' && ran.args[0] === 'add');
}

test('each skill in the profile is installed with the pinned skills CLI, from its source as the profile gives it, globally, for Claude Code, with no prompts', async (t) => {
  const where = await homeWithSkillsCli(t);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  const runs = await skillsCliRuns(where.home);
  // The flags the skills CLI's research settled: add <source> -g -a claude-code -y, with
  // -s <names> last because it takes every word after it. Skill sources aren't pinned at a commit.
  assert.deepEqual(runs.map((ran) => ran.args), [
    ['add', 'mattpocock/skills', '-g', '-a', 'claude-code', '-y', '-s',
      'grilling', 'grill-me', 'grill-with-docs', 'domain-modeling', 'teach', 'to-questionnaire', 'handoff', 'wait-what',
      'research', 'wayfinder', 'to-spec', 'to-tickets', 'setup-matt-pocock-skills', 'prototype', 'wizard'],
    ['add', 'anthropics/skills', '-g', '-a', 'claude-code', '-y', '-s', 'frontend-design'],
    ['add', 'cursor/plugins/pstack/skills/unslop', '-g', '-a', 'claude-code', '-y'],
    ['add', 'Bozodragon/agent-jumpstart', '-g', '-a', 'claude-code', '-y', '-s', 'jumpstart'],
  ]);
});

test("with no network, every skill is reported as not installed, since none arrived in Claude's skills folder", async (t) => {
  const where = await homeWithSkillsCli(t);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  for (const { names } of await yorkSkills()) {
    for (const name of names) checklistSays(result.stdout, `/${name} `, "Not installed: it didn't arrive");
  }
  checklistSays(result.stdout, 'Skills', 'None installed');
});

test('a skills CLI that fails is reported, with its output in the log', async (t) => {
  const where = await homeWithSkillsCli(t);
  await fakeMachine(where.home).setReplies({
    'skills.cmd --version': { output: '1.7.4\n' },
    'skills.cmd': { code: 1, output: 'Failed to clone repository' },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, '/jumpstart', 'Not installed: its installer stopped (code 1)');
  assert.match((await readOnlyLog(where.home)).text, /Failed to clone repository/);
});

test("skills found in Claude's skills folder after the skills CLI ran are reported as installed, and recorded as the installer's", async (t) => {
  const where = await homeWithSkillsCli(t);
  const all = (await yorkSkills()).flatMap(({ names }) => names);
  await fakeMachine(where.home).setReplies({ 'skills.cmd add': { creates: all.map(skillFile) } });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  for (const name of all) checklistSays(result.stdout, `/${name} `, 'Installed');
  assert.doesNotMatch(result.stdout, /Not installed: it didn't arrive/);
  checklistSays(result.stdout, 'Skills', 'All 18 installed');
  assert.deepEqual((await readSettings(where.home)).skillsInstalled, all);
});

test("a skill already in Claude's skills folder that the installer didn't put there is left as it is, and only the missing ones are added", async (t) => {
  const where = await homeWithSkillsCli(t);
  // The person's own copies: one of Matt Pocock's, the only one from Anthropic, and unslop.
  const theirs = ['grilling', 'frontend-design', 'unslop'];
  for (const name of theirs) {
    await mkdir(join(where.home, '.claude', 'skills', name), { recursive: true });
    await writeFile(join(where.home, skillFile(name)), 'their own version');
  }
  const all = (await yorkSkills()).flatMap(({ names }) => names);
  await fakeMachine(where.home).setReplies({ 'skills.cmd add': { creates: all.filter((name) => !theirs.includes(name)).map(skillFile) } });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  const runs = await skillsCliRuns(where.home);
  // No call at all for a source whose skills are all there already.
  assert.deepEqual(runs.map((ran) => ran.args[1]), ['mattpocock/skills', 'Bozodragon/agent-jumpstart']);
  assert.ok(!runs[0].args.includes('grilling'), runs[0].args.join(' '));
  assert.ok(runs[0].args.includes('grill-me'), runs[0].args.join(' '));
  for (const name of theirs) {
    checklistSays(result.stdout, `/${name} `, 'Already there, left as it is');
    assert.equal(await readFile(join(where.home, skillFile(name)), 'utf8'), 'their own version');
  }
  checklistSays(result.stdout, '/grill-me ', 'Installed');
  checklistSays(result.stdout, 'Skills', 'All 18 there: 15 installed, 3 already there');
  const recorded = (await readSettings(where.home)).skillsInstalled;
  assert.deepEqual(recorded, all.filter((name) => !theirs.includes(name)));
});

test('on a re-run, the skills the installer put there before are added again, so they update', async (t) => {
  const where = await homeWithSkillsCli(t);
  const all = (await yorkSkills()).flatMap(({ names }) => names);
  for (const name of all) {
    await mkdir(join(where.home, '.claude', 'skills', name), { recursive: true });
    await writeFile(join(where.home, skillFile(name)), 'an earlier copy');
  }
  // An earlier run installed all but jumpstart, which the person had already.
  const ours = all.filter((name) => name !== 'jumpstart');
  await seedSettings(where.home, { profile: 'york', skillsInstalled: ours });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  const runs = await skillsCliRuns(where.home);
  assert.deepEqual(runs.map((ran) => ran.args[1]), ['mattpocock/skills', 'anthropics/skills', 'cursor/plugins/pstack/skills/unslop']);
  assert.ok(runs[0].args.includes('grilling'), runs[0].args.join(' '));
  checklistSays(result.stdout, '/jumpstart ', 'Already there, left as it is');
  checklistSays(result.stdout, '/frontend-design ', 'Installed');
  assert.deepEqual((await readSettings(where.home)).skillsInstalled, ours);
});

test("Claude's automatic memory is switched off in its settings, keeping what was there, and in the user environment", async (t) => {
  const where = await makeHome(t);
  await mkdir(join(where.home, '.claude'));
  await writeFile(claudeSettingsFile(where.home), JSON.stringify({ theme: 'dark', autoMemoryEnabled: true }));

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  const settings = JSON.parse(await readFile(claudeSettingsFile(where.home), 'utf8'));
  assert.deepEqual(settings, { theme: 'dark', autoMemoryEnabled: false });
  // 1, not 0: set to 0 the variable forces memory back on.
  assert.equal((await fakeMachine(where.home).environment()).CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  checklistSays(result.stdout, 'Memory', "Claude's automatic memory is off");
});

test("With no Claude settings yet, the installer creates them with automatic memory off", async (t) => {
  const where = await makeHome(t);

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(claudeSettingsFile(where.home), 'utf8')), { autoMemoryEnabled: false });
});

test("Claude settings that aren't valid JSON are left untouched and memory is switched off only through the environment", async (t) => {
  const where = await makeHome(t);
  await mkdir(join(where.home, '.claude'));
  await writeFile(claudeSettingsFile(where.home), '{ "theme": "dark", ');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(await readFile(claudeSettingsFile(where.home), 'utf8'), '{ "theme": "dark", ');
  checklistSays(result.stdout, 'Memory', "Partly off: Claude's settings file couldn't be read");
  assert.equal((await fakeMachine(where.home).environment()).CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  assert.match((await readOnlyLog(where.home)).text, /settings\.json/);
});
