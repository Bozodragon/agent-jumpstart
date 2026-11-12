// A re-run asks "Anything to change from last time?", and asks again whatever the person ticks,
// with last time's answer as the default. Everything else is still known from settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { answerOnly, checklistSays, fakeMachine, gitOnMachinePath, makeHome, readOnlyLog, readProfile, readSettings, runWith, seedSettings, skillsCli, supplyDownloads } from './harness.js';

/**
 * York settings as a run of this release leaves them, with the top workspace there.
 * @param {string} home @param {Record<string, unknown>} [overrides]
 */
async function seedYork(home, overrides = {}) {
  const myDrive = join(home, 'My Drive');
  const top = join(myDrive, 'Claude');
  await mkdir(top, { recursive: true });
  const earlier = {
    profile: 'york',
    team: 'Another team',
    googleDriveFolder: myDrive,
    workspacesLocation: myDrive,
    topWorkspace: top,
    channel: 'stable',
    github: false,
    workspaces: ['Thinking space', 'Personal assistant'],
    connectors: ['Gmail'],
    extraTools: [],
    fullSkills: 'no',
    switchOffMemory: true,
    skillsInstalled: [],
    autoMemory: 'off',
    ...overrides,
  };
  await seedSettings(home, earlier);
  return earlier;
}

test('a re-run with everything saved and no change answer asks nothing else and keeps every answer', async (t) => {
  const where = await makeHome(t);
  const earlier = await seedYork(where.home);
  await answerOnly(where.answersFile, {});

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const { email, ...kept } = await readSettings(where.home);
  assert.deepEqual(kept, earlier);
  const log = await readOnlyLog(where.home);
  assert.ok(!log.text.includes('is to change'), log.text);
  for (const key of ['team', 'channel', 'github', 'workspaces', 'connectors', 'extraTools', 'fullSkills', 'switchOffMemory']) {
    assert.ok(log.text.includes(`Known from settings: ${key}:`), `${key} is known: ${log.text}`);
  }
});

test("each answer in change is asked again, and one the answers file doesn't give keeps last time's", async (t) => {
  const where = await makeHome(t);
  // York ticks both workspaces by itself, so only last time's answer leaves one out.
  await seedYork(where.home, { workspaces: ['Personal assistant'] });
  await answerOnly(where.answersFile, { change: ['github', 'workspaces'], github: true });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.equal(settings.github, true, 'asked again, and answered');
  assert.deepEqual(settings.workspaces, ['Personal assistant'], "asked again, with last time's as the default");
  const log = await readOnlyLog(where.home);
  for (const key of ['github', 'workspaces']) {
    assert.ok(log.text.includes(`Settings: ${key} is to change, so it's asked again`), log.text);
    assert.ok(!log.text.includes(`Known from settings: ${key}:`), log.text);
  }
});

test("a choose and a confirm asked again with no answer given keep last time's, not the question's own default", async (t) => {
  const where = await makeHome(t);
  // The team question's own default is Another team, and GitHub's is No.
  await seedYork(where.home, { team: 'Marketing', github: true });
  await answerOnly(where.answersFile, { change: ['team', 'github'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.equal(settings.team, 'Marketing');
  assert.equal(settings.github, true);
  const log = await readOnlyLog(where.home);
  for (const key of ['team', 'github']) assert.ok(log.text.includes(`Settings: ${key} is to change, so it's asked again`), log.text);
});

test('under york with a team saved, ticking Team asks the team question once, after the change question', async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home);
  // Marketing ticks Asana, which last time's connectors don't have, so they're asked again too.
  await answerOnly(where.answersFile, { change: ['team'], team: 'Marketing' }, { asked: ['connectors'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await readSettings(where.home)).team, 'Marketing');
  const log = (await readOnlyLog(where.home)).text;
  assert.equal(log.match(/Answer: team:/g)?.length, 1, log);
  assert.ok(log.indexOf('Answer: change: ["team"]') < log.indexOf("Settings: team is to change, so it's asked again"), log);
  assert.ok(log.indexOf("Settings: team is to change, so it's asked again") < log.indexOf('Answer: team:'), log);
});

test("a change the list doesn't offer stops the run, naming the options: Team under the default profile", async (t) => {
  const where = await makeHome(t, {}, { googleDrive: 'missing' });
  const first = await runWith(where, 'default');
  assert.equal(first.code, 0, first.stdout + first.stderr);
  await writeFile(where.answersFile, JSON.stringify({ change: ['team'] }));

  const result = await runWith(where, 'default');

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.ok(
    result.stdout.includes(`The answers file's "change" is wrong: "team" isn't one of "workspaces", "connectors", "extraTools", "github", "fullSkills".`),
    result.stdout,
  );
});

test("a change the list doesn't offer stops the run: Skills before fullSkills is saved, and Memory with no sign of use", async (t) => {
  for (const [change, overrides] of /** @type {[string, Record<string, unknown>][]} */ ([['fullSkills', { fullSkills: undefined }], ['switchOffMemory', {}]])) {
    const where = await makeHome(t);
    await seedYork(where.home, overrides);
    await writeFile(where.answersFile, JSON.stringify({ change: [change] }));

    const result = await runWith(where, 'york');

    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.ok(result.stdout.includes(`The answers file's "change" is wrong: "${change}" isn't one of "team", "workspaces", "connectors", "extraTools", "github"`), result.stdout);
  }
});

test('Memory is offered when there is a sign of memory use, and when last time it was left on', async (t) => {
  const used = await makeHome(t);
  await seedYork(used.home);
  await mkdir(join(used.home, '.claude', 'projects', 'C--work', 'memory'), { recursive: true });
  await writeFile(join(used.home, '.claude', 'projects', 'C--work', 'memory', 'MEMORY.md'), 'remembered');
  const leftOn = await makeHome(t);
  await seedYork(leftOn.home, { switchOffMemory: false, autoMemory: 'left on' });

  for (const where of [used, leftOn]) {
    await answerOnly(where.answersFile, { change: ['switchOffMemory'] });

    const result = await runWith(where, 'york');

    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.ok((await readOnlyLog(where.home)).text.includes("Settings: switchOffMemory is to change, so it's asked again"));
  }
});

test('change is never saved', async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home);
  await answerOnly(where.answersFile, { change: ['github'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.ok(!('change' in (await readSettings(where.home))));
});

test('re-asking a pick whose saved answer names something no longer offered defaults to the rest of it, and the run carries on', async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home, { workspaces: ['Recruitment', 'Personal assistant'] });
  await answerOnly(where.answersFile, { change: ['workspaces'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual((await readSettings(where.home)).workspaces, ['Personal assistant']);
});

test("a pick that comes back by itself, naming something no longer offered, defaults to the rest of last time's, not the profile's ticks", async (t) => {
  const where = await makeHome(t);
  // York ticks both workspaces by itself.
  await seedYork(where.home, { workspaces: ['Recruitment', 'Personal assistant'] });
  await answerOnly(where.answersFile, {}, { asked: ['workspaces'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual((await readSettings(where.home)).workspaces, ['Personal assistant']);
  assert.ok((await readOnlyLog(where.home)).text.includes("Settings: workspaces is no longer right"));
});

test("a re-asked pick defaults to last time's ticks, never to the profile's own", async (t) => {
  const where = await makeHome(t);
  // York ticks Google Drive, Google Calendar, Google Docs, Google Sheets and clasp by default.
  await seedYork(where.home, { connectors: ['Gmail'], extraTools: [] });
  await answerOnly(where.answersFile, { change: ['connectors', 'extraTools'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.deepEqual(settings.connectors, ['Gmail']);
  assert.deepEqual(settings.extraTools, []);
});

test('"Using your answers from last time" lists the reused answers and leaves out those asked again', async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home);
  await answerOnly(where.answersFile, { change: ['github', 'connectors', 'fullSkills'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const start = result.stdout.indexOf('Using your answers from last time');
  assert.ok(start >= 0, result.stdout);
  const note = result.stdout.slice(start, result.stdout.indexOf('├', start));
  for (const row of ['Team', 'Workspaces', 'Extra tools', "Claude's memory"]) assert.match(note, new RegExp(`│  ${row} `), note);
  for (const row of ['GitHub', 'Connectors', 'Skills']) assert.doesNotMatch(note, new RegExp(`│  ${row} `), note);
});

test("changing Memory from off to on touches neither switch, keeps autoMemory off, and the row says it's still off", async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home);
  // Switched off by the earlier run, with memory files from before it as the sign of use.
  const claudeSettings = join(where.home, '.claude', 'settings.json');
  await mkdir(join(where.home, '.claude', 'projects', 'C--work', 'memory'), { recursive: true });
  await writeFile(join(where.home, '.claude', 'projects', 'C--work', 'memory', 'MEMORY.md'), 'remembered');
  await writeFile(claudeSettings, JSON.stringify({ theme: 'dark', autoMemoryEnabled: false }, null, 2));
  const machine = fakeMachine(where.home);
  await machine.setEnvironment({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
  await answerOnly(where.answersFile, { change: ['switchOffMemory'], switchOffMemory: false });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.equal(settings.switchOffMemory, false);
  assert.equal(settings.autoMemory, 'off');
  checklistSays(result.stdout, 'Memory', "Still off: the Installer doesn't switch it back on");
  assert.deepEqual(JSON.parse(await readFile(claudeSettings, 'utf8')), { theme: 'dark', autoMemoryEnabled: false });
  assert.equal((await machine.environment()).CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
});

/** Matt Pocock's source, and the commit its default branch is at in these tests. */
const matt = 'mattpocock/skills';
const commit = 'a'.repeat(40);

/**
 * A home where the skills CLI can be installed, Git is on the PATH and Matt Pocock's source is
 * at `commit`, with York settings that recorded his source at that commit, and every skill of
 * his an earlier run installed (`installed`) still in Claude's skills folder.
 * @param {import('node:test').TestContext} t @param {string} fullSkills @param {string[]} installed
 */
async function homeWithMattSkills(t, fullSkills, installed) {
  const where = await makeHome(t);
  await supplyDownloads(where, ['skills']);
  await gitOnMachinePath(where.home);
  const cli = skillsCli(where.home);
  await fakeMachine(where.home).setReplies({ ...cli.install, [`git.exe ls-remote https://github.com/${matt}.git HEAD`]: { output: `${commit}\tHEAD\n` } });
  for (const name of installed) {
    await mkdir(join(where.home, '.claude', 'skills', name), { recursive: true });
    await writeFile(join(where.home, '.claude', 'skills', name, 'SKILL.md'), name);
  }
  await seedYork(where.home, { fullSkills, skillsInstalled: installed, skillSources: { [matt]: commit } });
  return { ...where, cli };
}

/** Each add the skills CLI was run with for Matt Pocock's source, after its script. @param {string} home */
async function mattAdds(home) {
  const cli = skillsCli(home);
  return (await fakeMachine(home).runs()).filter((ran) => cli.isRun(ran) && ran.args[1] === 'add' && ran.args[2] === matt).map((ran) => ran.args.slice(1));
}

test("changing Skills to more adds Matt Pocock's source again with the chosen names, even at the commit recorded last time", async (t) => {
  const york = await readProfile('york');
  const usual = york.skills.find((/** @type {any} */ source) => source.source === matt).names;
  // Chosen on an earlier run, then not, so still in the folder, at an older commit.
  const where = await homeWithMattSkills(t, 'no', [...usual, ...york.fullSkills.finished]);
  await answerOnly(where.answersFile, { change: ['fullSkills'], fullSkills: 'finished' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const adds = await mattAdds(where.home);
  assert.equal(adds.length, 1, 'added again');
  const names = adds[0].slice(adds[0].indexOf('-s') + 1);
  assert.deepEqual(names, [...usual, ...york.fullSkills.finished]);
});

test('unticking a workspace or an extra tool leaves its folder in place and runs no uninstall', async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home, { extraTools: ['apps-script'] });
  const thinking = join(where.home, 'My Drive', 'Claude', 'Thinking space', 'ideas.md');
  await mkdir(join(thinking, '..'), { recursive: true });
  await writeFile(thinking, 'half an idea');
  await answerOnly(where.answersFile, { change: ['workspaces', 'extraTools'], workspaces: ['Personal assistant'], extraTools: [] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.deepEqual(settings.workspaces, ['Personal assistant']);
  assert.deepEqual(settings.extraTools, []);
  assert.equal(await readFile(thinking, 'utf8'), 'half an idea');
  const runs = await fakeMachine(where.home).runs();
  assert.deepEqual(runs.filter((ran) => ran.args.some((arg) => ['uninstall', 'remove', 'rm'].includes(arg))), []);
});

test("choosing fewer skills leaves them in Claude's skills folder and in skillsInstalled", async (t) => {
  const york = await readProfile('york');
  const usual = york.skills.find((/** @type {any} */ source) => source.source === matt).names;
  const where = await homeWithMattSkills(t, 'finished', [...usual, ...york.fullSkills.finished]);
  await answerOnly(where.answersFile, { change: ['fullSkills'], fullSkills: 'no' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.equal(settings.fullSkills, 'no');
  for (const name of york.fullSkills.finished) {
    assert.equal(await readFile(join(where.home, '.claude', 'skills', name, 'SKILL.md'), 'utf8'), name, `${name} is still there`);
    assert.ok(settings.skillsInstalled.includes(name), `${name} is still the installer's`);
  }
});
