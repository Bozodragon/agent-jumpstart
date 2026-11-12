import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { checklistSays, fakeMachine, fixtureProfiles, gitOnMachinePath, makeHome, readOnlyLog, readProfile, readSettings, runWith, seedSettings, skillsCli, supplyDownloads } from './harness.js';

// With York's real profile.

test("a york run with no team answered takes Another team, saves it, and keeps York's own ticks", async (t) => {
  const where = await makeHome(t);
  const profile = await readProfile('york');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.equal(settings.team, 'Another team');
  const ticked = profile.connectors.filter((/** @type {any} */ connector) => connector.default).map((/** @type {any} */ connector) => connector.name);
  assert.deepEqual(settings.connectors, ticked);
  assert.ok(!settings.connectors.includes('Asana'));
  const tools = profile.extraTools.filter((/** @type {any} */ tool) => tool.default).map((/** @type {any} */ tool) => tool.id);
  assert.deepEqual(settings.extraTools, tools);
  assert.ok(tools.length > 0, "York ticks an extra tool of its own, so there's something to keep");
});

for (const team of ['Marketing', 'Systems, Data and Operations']) {
  test(`a york run answering ${team} saves the team and ticks Asana`, async (t) => {
    const where = await makeHome(t, { team });

    const result = await runWith(where, 'york');

    assert.equal(result.code, 0, result.stdout + result.stderr);
    const settings = await readSettings(where.home);
    assert.equal(settings.team, team);
    assert.equal(settings.connectors.filter((/** @type {string} */ name) => name === 'Asana').length, 1, JSON.stringify(settings.connectors));
  });
}

test('a default run never asks which team, even with one in the answers file, and saves no team', async (t) => {
  const where = await makeHome(t, { team: 'Marketing' }, { googleDrive: 'missing' });

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.ok(!('team' in settings), JSON.stringify(settings));
  assert.ok(!settings.connectors.includes('Asana'));
  const log = await readOnlyLog(where.home);
  assert.ok(!log.text.includes('team:'), log.text);
});

test("a team york doesn't offer stops the run with the answers file's usual message, naming the options", async (t) => {
  const where = await makeHome(t, { team: 'Finance' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.ok(
    result.stdout.includes(`The answers file's "team" is wrong: it should be one of "Systems, Data and Operations", "Marketing", "Another team".`),
    result.stdout,
  );
});

/** York settings as a run from before teams would have left them. @param {string} home */
async function seedYorkSettingsWithoutTeam(home) {
  const myDrive = join(home, 'My Drive');
  const top = join(myDrive, 'Claude');
  await mkdir(top, { recursive: true });
  const earlier = {
    profile: 'york',
    googleDriveFolder: myDrive,
    workspacesLocation: myDrive,
    topWorkspace: top,
    channel: 'stable',
    github: false,
    workspaces: ['Thinking space', 'Personal assistant'],
    connectors: ['Gmail', 'Asana'],
    extraTools: [],
    switchOffMemory: true,
  };
  await seedSettings(home, earlier);
  return earlier;
}

test('a york re-run with no saved team asks it, through the answers file, and saves it', async (t) => {
  const where = await makeHome(t, { team: 'Marketing' });
  await seedYorkSettingsWithoutTeam(where.home);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await readSettings(where.home)).team, 'Marketing');
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes('Answer: team: "Marketing"'), log.text);
  assert.ok(!log.text.includes('Known from settings: team'), log.text);
});

test('a york re-run with a saved team reuses it, and "Using your answers from last time" shows it as Team', async (t) => {
  const where = await makeHome(t, { team: 'a question was asked' });
  const earlier = await seedYorkSettingsWithoutTeam(where.home);
  await seedSettings(where.home, { ...earlier, team: 'Systems, Data and Operations' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await readSettings(where.home)).team, 'Systems, Data and Operations');
  assert.match(result.stdout, /Using your answers from last time/);
  checklistSays(result.stdout, 'Team', 'Systems, Data and Operations');
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes('Known from settings: team: "Systems, Data and Operations"'), log.text);
});

// With fixture profiles, through --profiles.

/**
 * A small profile whose one team ticks one of the profile's own unticked connectors, adds a
 * connector, adds the Apps Script extra tool the profile leaves out (so the pinned clasp entry is
 * what installs), and adds skills from one of the profile's sources and from a source of its own.
 */
const fixture = {
  name: 'Fixture',
  page: 'https://fixture.example/',
  workspaces: { top: 'Claude', inGoogleDrive: false, defaultLocation: 'Documents', choices: [{ name: 'Thinking space', default: true }] },
  connectors: [
    { name: 'Gmail', what: 'search and read your email', default: true },
    { name: 'Asana', what: 'see your tasks', default: false },
  ],
  connectorsPage: 'https://claude.ai/customize/connectors',
  extraTools: [],
  skills: [
    { source: 'mattpocock/skills', names: ['grilling'] },
    { source: 'anthropics/skills', names: ['frontend-design'] },
  ],
  teams: [
    {
      name: 'Research',
      connectors: [{ name: 'Asana' }, { name: 'Linear', what: 'see your issues and, when you ask, update them' }],
      extraTools: [{ id: 'apps-script', question: 'Would you like the agent to be able to publish and manage Apps Script projects for you?' }],
      skills: [
        { source: 'mattpocock/skills', names: ['tdd'] },
        { source: 'acme/skills', names: ['triage'] },
      ],
    },
  ],
};

test("a team's added connector is ticked and appears in the connectors walkthrough with its own wording", async (t) => {
  const where = await makeHome(t, { team: 'Research' }, { googleDrive: 'missing' });

  const result = await runWith(where, 'fixture', await fixtureProfiles(where, { fixture }));

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual((await readSettings(where.home)).connectors, ['Gmail', 'Asana', 'Linear']);
  assert.match(result.stdout, /Linear: see your issues and, when you ask, update them/);
});

test("a team entry for one of the profile's own unticked connectors ticks it, without listing it twice", async (t) => {
  const ticked = await makeHome(t, { team: 'Research' }, { googleDrive: 'missing' });
  const wrong = await makeHome(t, { team: 'Research', connectors: ['Slack'] }, { googleDrive: 'missing' });

  const tickedRun = await runWith(ticked, 'fixture', await fixtureProfiles(ticked, { fixture }));
  const wrongRun = await runWith(wrong, 'fixture', await fixtureProfiles(wrong, { fixture }));

  assert.equal(tickedRun.code, 0, tickedRun.stdout + tickedRun.stderr);
  assert.ok((await readSettings(ticked.home)).connectors.includes('Asana'));
  // A wrong answer names every option the connectors pick offered.
  assert.equal(wrongRun.code, 1, wrongRun.stdout + wrongRun.stderr);
  assert.ok(wrongRun.stdout.includes(`"Slack" isn't one of "Gmail", "Asana", "Linear".`), wrongRun.stdout);
});

test("a team's added extra tool is ticked and installed", async (t) => {
  const where = await makeHome(t, { team: 'Research' }, { googleDrive: 'missing' });
  const manifest = await supplyDownloads(where, ['clasp']);
  const clasp = manifest.tools.find((/** @type {any} */ tool) => tool.id === 'clasp');

  const result = await runWith(where, 'fixture', await fixtureProfiles(where, { fixture }));

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual((await readSettings(where.home)).extraTools, ['apps-script']);
  const npm = (await fakeMachine(where.home).runs()).find((run) => basename(run.file) === 'npm.cmd' && run.args[0] === 'install');
  assert.ok(npm, 'clasp is installed through npm');
  checklistSays(result.stdout, 'clasp', clasp.version);
});

test("a team's skills install alongside the profile's, and one from the profile's own source goes in that source's single add", async (t) => {
  const where = await makeHome(t, { team: 'Research' }, { googleDrive: 'missing' });
  await supplyDownloads(where, ['skills']);
  await gitOnMachinePath(where.home);
  const cli = skillsCli(where.home);
  await fakeMachine(where.home).setReplies(cli.install);

  const result = await runWith(where, 'fixture', await fixtureProfiles(where, { fixture }));

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const adds = (await fakeMachine(where.home).runs()).filter((ran) => cli.isRun(ran) && ran.args[1] === 'add').map((ran) => ran.args.slice(1));
  assert.deepEqual(adds, [
    ['add', 'mattpocock/skills', '-g', '-a', 'claude-code', '-y', '-s', 'grilling', 'tdd'],
    ['add', 'anthropics/skills', '-g', '-a', 'claude-code', '-y', '-s', 'frontend-design'],
    ['add', 'acme/skills', '-g', '-a', 'claude-code', '-y', '-s', 'triage'],
  ]);
});
