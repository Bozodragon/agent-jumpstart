// A re-run that joins a team, or changes team, asks the connectors and extra-tools picks again
// when the team ticks something last time's answers don't have, with the team's ticks added to
// last time's. Anything else stays known from settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { answerOnly, fixtureProfiles, makeHome, readOnlyLog, readSettings, runWith, seedSettings } from './harness.js';

/**
 * York settings as a run of this release leaves them, with the top workspace there. `team`
 * undefined leaves it out, as a run from before teams did.
 * @param {string} home @param {Record<string, unknown>} [overrides]
 */
async function seedYork(home, overrides = {}) {
  const myDrive = join(home, 'My Drive');
  const top = join(myDrive, 'Claude');
  await mkdir(top, { recursive: true });
  /** @type {Record<string, unknown>} */
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
  for (const key of Object.keys(earlier)) if (earlier[key] === undefined) delete earlier[key];
  await seedSettings(home, earlier);
  return earlier;
}

test("a york re-run with no saved team, answering Marketing, asks the connectors again with Asana added to last time's ticks, and not the extra tools", async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home, { team: undefined, connectors: ['Gmail', 'Google Drive'] });
  await answerOnly(where.answersFile, { team: 'Marketing' }, { asked: ['connectors'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.deepEqual(settings.connectors, ['Gmail', 'Google Drive', 'Asana']);
  assert.deepEqual(settings.extraTools, []);
  const log = (await readOnlyLog(where.home)).text;
  assert.ok(log.includes("Settings: connectors is to change, so it's asked again"), log);
  assert.ok(log.includes('Known from settings: extraTools: []'), log);
});

test('the same re-run, when the saved connectors already include Asana, asks neither pick', async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home, { team: undefined, connectors: ['Gmail', 'Asana'] });
  // Any other question put to the answers file stops the run.
  await answerOnly(where.answersFile, { team: 'Marketing' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual((await readSettings(where.home)).connectors, ['Gmail', 'Asana']);
});

test('joining Another team re-asks nothing', async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home, { team: undefined });
  await answerOnly(where.answersFile, { team: 'Another team' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual((await readSettings(where.home)).connectors, ['Gmail']);
});

test("ticking Team and choosing last time's team re-asks neither pick, even when last time's connectors lack its ticks", async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home, { team: 'Marketing', connectors: ['Gmail'] });
  await answerOnly(where.answersFile, { change: ['team'], team: 'Marketing' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual((await readSettings(where.home)).connectors, ['Gmail']);
});

test("changing team through change to one that ticks something new asks that pick again, with the team's ticks added", async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home, { team: 'Another team', connectors: ['Gmail', 'Google Docs'] });
  await answerOnly(where.answersFile, { change: ['team'], team: 'Systems, Data and Operations' }, { asked: ['connectors'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.equal(settings.team, 'Systems, Data and Operations');
  assert.deepEqual(settings.connectors, ['Gmail', 'Google Docs', 'Asana']);
});

test("a pick the person already chose to change is asked once, with the team's ticks added and none of the profile's own defaults", async (t) => {
  const where = await makeHome(t);
  // York ticks Google Drive, Google Calendar, Google Docs, Google Sheets and Apps Script by default.
  await seedYork(where.home, { team: 'Another team', connectors: ['Gmail'], extraTools: [] });
  await answerOnly(where.answersFile, { change: ['team', 'connectors', 'extraTools'], team: 'Marketing' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.deepEqual(settings.connectors, ['Gmail', 'Asana']);
  assert.deepEqual(settings.extraTools, []);
  const log = (await readOnlyLog(where.home)).text;
  assert.equal(log.match(/Settings: connectors is to change/g)?.length, 1, log);
  assert.equal(log.match(/Answer: connectors:/g)?.length, 1, log);
});

/** A small profile whose one team adds the Apps Script extra tool the profile leaves out. */
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
  skills: [],
  teams: [
    {
      name: 'Research',
      connectors: [{ name: 'Asana' }],
      extraTools: [{ id: 'apps-script', question: 'Would you like the agent to be able to publish and manage Apps Script projects for you?' }],
    },
  ],
};

test('with a fixture profile, a team that adds an extra tool asks the extra-tools pick again with that tool ticked', async (t) => {
  const where = await makeHome(t, {}, { googleDrive: 'missing' });
  const documents = join(where.home, 'Documents');
  await mkdir(join(documents, 'Claude'), { recursive: true });
  await seedSettings(where.home, {
    profile: 'fixture',
    googleDriveFolder: null,
    workspacesLocation: documents,
    topWorkspace: join(documents, 'Claude'),
    channel: 'stable',
    github: false,
    workspaces: ['Thinking space'],
    connectors: ['Gmail', 'Asana'],
    extraTools: [],
    fullSkills: 'no',
    switchOffMemory: true,
  });
  await answerOnly(where.answersFile, { team: 'Research' }, { asked: ['extraTools'] });

  const result = await runWith(where, 'fixture', await fixtureProfiles(where, { fixture }));

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.deepEqual(settings.extraTools, ['apps-script']);
  assert.deepEqual(settings.connectors, ['Gmail', 'Asana']);
  assert.ok((await readOnlyLog(where.home)).text.includes("Settings: extraTools is to change, so it's asked again"));
});
