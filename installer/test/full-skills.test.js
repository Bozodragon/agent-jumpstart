// Both profiles offer Matt Pocock's full set of skills for writing code: his finished ones, or
// those plus his unfinished ones as a beta. No is the default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { checklistSays, fakeMachine, gitOnMachinePath, makeHome, readProfile, readSettings, runWith, seedSettings, skillsCli, supplyDownloads } from './harness.js';

/** His finished skills for writing code, as the ticket lists them. */
const finished = [
  'code-review', 'codebase-design', 'diagnosing-bugs', 'implement', 'implement-spec', 'improve-codebase-architecture',
  'pr', 'retro', 'tdd', 'triage', 'writing-for-agents',
];
/** His unfinished ones, offered as a beta. */
const beta = ['chief-of-staff', 'claude-handoff', 'loop-me', 'setup-ts-deep-modules', 'software-factory', 'writing-beats', 'writing-fragments', 'writing-shape'];
/** His one-offs, which are never offered. */
const oneOffs = ['git-guardrails-claude-code', 'migrate-to-shoehorn', 'scaffold-exercises', 'setup-pre-commit'];

const source = 'mattpocock/skills';
const lookUp = `git.exe ls-remote https://github.com/${source}.git HEAD`;
const commit = 'a'.repeat(40);

/** Where a skill's SKILL.md is, relative to the home. @param {string} name */
const skillFile = (name) => join('.claude', 'skills', name, 'SKILL.md');

/** A home where the skills CLI can be installed and Git is on the PATH. @param {import('node:test').TestContext} t @param {object} [answers] */
async function homeWithSkillsCli(t, answers = {}) {
  const where = await makeHome(t, answers);
  await supplyDownloads(where, ['skills']);
  await gitOnMachinePath(where.home);
  const cli = skillsCli(where.home);
  await fakeMachine(where.home).setReplies({ ...cli.install, [lookUp]: { output: `${commit}\tHEAD\n` } });
  return { ...where, cli };
}

/** Each add the skills CLI was run with, after its script, for the Matt Pocock source. @param {string} home */
async function mattAdds(home) {
  const cli = skillsCli(home);
  return (await fakeMachine(home).runs())
    .filter((ran) => cli.isRun(ran) && ran.args[1] === 'add' && ran.args[2] === source)
    .map((ran) => ran.args.slice(1));
}

/** The names a run of the add was asked for: everything after -s. @param {string[]} args */
const namesIn = (args) => args.slice(args.indexOf('-s') + 1);

for (const profile of ['york', 'default']) {
  test(`under ${profile}, pressing Enter keeps the usual skills only and saves the answer as no`, async (t) => {
    const where = await homeWithSkillsCli(t);
    const usual = (await readProfile(profile)).skills.find((/** @type {any} */ s) => s.source === source).names;

    const result = await runWith(where, profile);

    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal((await readSettings(where.home)).fullSkills, 'no');
    const adds = await mattAdds(where.home);
    assert.equal(adds.length, 1);
    assert.deepEqual(namesIn(adds[0]), usual);
  });

  test(`under ${profile}, the finished skills are added to the one add for ${source}, and the answer is saved`, async (t) => {
    const where = await homeWithSkillsCli(t, { fullSkills: 'finished' });
    const usual = (await readProfile(profile)).skills.find((/** @type {any} */ s) => s.source === source).names;

    const result = await runWith(where, profile);

    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal((await readSettings(where.home)).fullSkills, 'finished');
    const adds = await mattAdds(where.home);
    assert.equal(adds.length, 1, 'the source is still added once');
    assert.deepEqual(namesIn(adds[0]), [...usual, ...finished]);
  });

  test(`under ${profile}, the beta adds the finished skills and the unfinished ones, and none of his one-offs`, async (t) => {
    const where = await homeWithSkillsCli(t, { fullSkills: 'beta' });

    const result = await runWith(where, profile);

    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal((await readSettings(where.home)).fullSkills, 'beta');
    const adds = await mattAdds(where.home);
    assert.equal(adds.length, 1);
    const names = namesIn(adds[0]);
    for (const name of [...finished, ...beta]) assert.ok(names.includes(name), `${name} is added`);
    for (const name of oneOffs) assert.ok(!names.includes(name), `${name} is never offered`);
    assert.equal(new Set(names).size, names.length, 'no name twice');
  });
}

test('the full set is looked up once and recorded once, and its names are not in the usual skills list', async (t) => {
  const where = await homeWithSkillsCli(t, { fullSkills: 'beta' });
  const all = (await readProfile('york')).skills.flatMap((/** @type {any} */ s) => s.names ?? [basename(s.source)]);
  const here = [...finished, ...beta];
  await fakeMachine(where.home).setReplies({
    ...where.cli.install,
    [lookUp]: { output: `${commit}\tHEAD\n` },
    [where.cli.key('add')]: { creates: [...all, ...here].map(skillFile) },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const lookUps = (await fakeMachine(where.home).runs()).filter((ran) => basename(ran.file) === 'git.exe' && ran.args[1]?.includes(source));
  assert.equal(lookUps.length, 1);
  assert.equal((await readSettings(where.home)).skillSources[source], commit);
  const profile = await readProfile('york');
  const usual = profile.skills.find((/** @type {any} */ s) => s.source === source).names;
  for (const name of here) assert.ok(!usual.includes(name), `${name} sits apart from the usual list`);
});

test("a full-set skill that doesn't arrive says so in its row, the run carries on, and the source isn't recorded", async (t) => {
  const where = await homeWithSkillsCli(t, { fullSkills: 'beta' });
  const usual = (await readProfile('york')).skills.find((/** @type {any} */ s) => s.source === source).names;
  const others = (await readProfile('york')).skills.flatMap((/** @type {any} */ s) => (s.source === source ? [] : s.names ?? [basename(s.source)]));
  const arriving = [...usual, ...others, ...finished, ...beta.filter((name) => name !== 'loop-me')];
  await fakeMachine(where.home).setReplies({
    ...where.cli.install,
    [lookUp]: { output: `${commit}\tHEAD\n` },
    'git.exe ls-remote https://github.com/anthropics/skills.git HEAD': { output: `${'b'.repeat(40)}\tHEAD\n` },
    [where.cli.key('add')]: { creates: arriving.map(skillFile) },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, '/loop-me ', "Not installed: it didn't arrive");
  checklistSays(result.stdout, '/tdd ', 'Installed');
  const settings = await readSettings(where.home);
  assert.equal(settings.skillSources['anthropics/skills'], 'b'.repeat(40), 'the other sources are recorded');
  assert.ok(!(source in settings.skillSources), 'a skill that is genuinely missing keeps the source from being recorded');
  assert.ok(settings.skillsInstalled.includes('tdd'));
});

test('a value that is not offered stops the run, naming the options', async (t) => {
  const where = await makeHome(t, { fullSkills: 'everything' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /The answers file's "fullSkills" is wrong: it should be one of "no", "finished", "beta"\./);
});

for (const profile of ['york', 'default']) {
  // A wrong answer stops the run at the first question that reads it, so of two wrong answers,
  // the one named was asked first. Memory is asked only of someone who has been using it.
  test(`under ${profile}, the question comes after the extra tools and before memory`, async (t) => {
    /** @param {Record<string, unknown>} answers */
    const stopsAt = async (answers) => {
      const where = await makeHome(t, answers);
      const memory = join(where.home, '.claude', 'projects', 'C--work', 'memory');
      await mkdir(memory, { recursive: true });
      await writeFile(join(memory, 'MEMORY.md'), 'remembered');
      const result = await runWith(where, profile);
      assert.equal(result.code, 1, result.stdout + result.stderr);
      return result.stdout.match(/The answers file's "(\w+)" is wrong/)?.[1];
    };

    assert.equal(await stopsAt({ extraTools: ['nothing offered'], fullSkills: 'all of them' }), 'extraTools');
    assert.equal(await stopsAt({ fullSkills: 'all of them', switchOffMemory: 'maybe' }), 'fullSkills');
  });
}

test('a re-run whose settings have no fullSkills asks it once, and a re-run with it saved reuses it, showing Skills', async (t) => {
  const where = await homeWithSkillsCli(t, { fullSkills: 'finished' });
  const myDrive = join(where.home, 'My Drive');
  const earlier = {
    profile: 'york',
    googleDriveFolder: myDrive,
    workspacesLocation: myDrive,
    topWorkspace: join(myDrive, 'Claude'),
    channel: 'stable',
    github: false,
    workspaces: ['Thinking space'],
    connectors: ['Gmail'],
    extraTools: [],
    switchOffMemory: true,
  };
  await mkdir(join(myDrive, 'Claude'), { recursive: true });
  await seedSettings(where.home, earlier);

  const first = await runWith(where, 'york');

  assert.equal(first.code, 0, first.stdout + first.stderr);
  assert.equal((await readSettings(where.home)).fullSkills, 'finished', 'asked, because it was never answered');

  await writeFile(where.answersFile, JSON.stringify({ fullSkills: 'a question was asked' }));
  const second = await runWith(where, 'york');

  assert.equal(second.code, 0, second.stdout + second.stderr);
  assert.equal((await readSettings(where.home)).fullSkills, 'finished');
  assert.match(second.stdout, /Using your answers from last time/);
  checklistSays(second.stdout, 'Skills', "Matt Pocock's finished skills");
});
