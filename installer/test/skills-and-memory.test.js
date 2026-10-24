import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fakeMachine, makeHome, readOnlyLog, readProfile, runWith } from './harness.js';

/** @param {string} stdout @param {string} label @param {string} value */
function checklistSays(stdout, label, value) {
  const line = stdout.split('\n').find((row) => row.includes(label) && row.includes(value));
  assert.ok(line, `expected a checklist line "${label} … ${value}" in:\n${stdout}`);
}

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

/** @param {string} home */
async function skillsCliRuns(home) {
  return (await fakeMachine(home).runs()).filter((ran) => ran.file === 'npx.cmd');
}

test('each skill in the profile is installed with the pinned skills CLI, globally, for Claude Code, with no prompts', async (t) => {
  const where = await makeHome(t);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  const runs = await skillsCliRuns(where.home);
  // The flags the skills CLI's research settled: npx -y (no "Ok to proceed?"), then
  // add <source> -g -a claude-code -y, with -s <names> last because it takes every word after it.
  assert.deepEqual(runs.map((ran) => ran.args), [
    ['-y', 'skills@1.7.4', 'add', 'mattpocock/skills', '-g', '-a', 'claude-code', '-y', '-s',
      'grilling', 'grill-me', 'grill-with-docs', 'domain-modeling', 'teach', 'to-questionnaire', 'handoff', 'wait-what',
      'research', 'wayfinder', 'to-spec', 'to-tickets', 'setup-matt-pocock-skills', 'prototype', 'wizard'],
    ['-y', 'skills@1.7.4', 'add', 'anthropics/skills', '-g', '-a', 'claude-code', '-y', '-s', 'frontend-design'],
    ['-y', 'skills@1.7.4', 'add', 'cursor/plugins/pstack/skills/unslop', '-g', '-a', 'claude-code', '-y'],
    ['-y', 'skills@1.7.4', 'add', 'Bozodragon/agent-jumpstart', '-g', '-a', 'claude-code', '-y', '-s', 'jumpstart'],
  ]);
});

test("with no network, every skill is reported as not installed, since none arrived in Claude's skills folder", async (t) => {
  const where = await makeHome(t);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  for (const { names } of await yorkSkills()) {
    for (const name of names) checklistSays(result.stdout, `/${name} `, "Not installed: it didn't arrive");
  }
  checklistSays(result.stdout, 'Skills', 'None installed');
});

test('a skills CLI that fails is reported, with its output in the log', async (t) => {
  const where = await makeHome(t);
  await fakeMachine(where.home).setReplies({ 'npx.cmd': { code: 1, output: 'Failed to clone repository' } });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, '/jumpstart', 'Not installed: its installer stopped (code 1)');
  assert.match((await readOnlyLog(where.home)).text, /Failed to clone repository/);
});

test("skills found in Claude's skills folder after the skills CLI ran are reported as installed", async (t) => {
  const where = await makeHome(t);
  for (const { names } of await yorkSkills()) {
    for (const name of names) {
      await mkdir(join(where.home, '.claude', 'skills', name), { recursive: true });
      await writeFile(join(where.home, '.claude', 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
    }
  }

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  for (const { names } of await yorkSkills()) {
    for (const name of names) checklistSays(result.stdout, `/${name} `, 'Installed');
  }
  assert.doesNotMatch(result.stdout, /Not installed: it didn't arrive/);
  checklistSays(result.stdout, 'Skills', 'All 18 installed');
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
