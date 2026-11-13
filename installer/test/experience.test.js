// The experience questions: how much the person has used AI tools, and whether they've written
// code. They come straight after the team (or first, under a profile with no teams), and change
// only which later questions are asked and what those start with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { answerOnly, checklistSays, fakeMachine, ghAlreadyInstalled, makeHome, readOnlyLog, readSettings, runWith, seedSettings, t3Leaves } from './harness.js';

/** The keys of the log's `Answer:` lines, in the order they were written. @param {string} log */
const answered = (log) => [...log.matchAll(/Answer: (\w+):/g)].map((match) => match[1]);

/** Whether the window showed this text, read as checklistSays reads it, line breaks and borders aside. @param {string} stdout @param {string} text */
const shows = (stdout, text) => stdout.replace(/[│|]|\s/g, '').includes(text.replace(/\s/g, ''));

/** gh's runs, apart from asking its version. @param {{ file: string, args: string[] }[]} runs @param {string} gh */
const ghCommands = (runs, gh) => runs.filter((run) => run.file === gh && run.args[0] !== '--version').map((run) => run.args.join(' '));

const signedInLine = "GitHub: you're already signed in with GitHub's own tool, so GitHub is set up without asking.";

test('under york both experience questions come straight after the team, and are saved', async (t) => {
  const where = await makeHome(t, { team: 'Marketing', aiExperience: 'confident', codingExperience: 'small-projects' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.equal(settings.aiExperience, 'confident');
  assert.equal(settings.codingExperience, 'small-projects');
  const order = answered((await readOnlyLog(where.home)).text);
  assert.deepEqual(order.slice(0, 3), ['team', 'aiExperience', 'codingExperience'], order.join(', '));
});

test('under a profile with no teams the experience questions come first, and a run without them saves the defaults', async (t) => {
  const where = await makeHome(t, {}, { googleDrive: 'missing' });

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.equal(settings.aiExperience, 'first-time');
  assert.equal(settings.codingExperience, 'no');
  const order = answered((await readOnlyLog(where.home)).text);
  assert.deepEqual(order.slice(0, 2), ['aiExperience', 'codingExperience'], order.join(', '));
});

// The spec's table, row by row: who's asked T3 Code's channel, full skills and GitHub, and what
// each starts with. A question that isn't expected is refused by the answers file, so a run that
// gets to the end asked only these, and left them to their defaults.
/** @type {{ ai: string, coding: string, asked: string[], channel: string, fullSkills: string, github: boolean }[]} */
const rows = [
  { ai: 'first-time', coding: 'no', asked: ['github'], channel: 'stable', fullSkills: 'no', github: false },
  { ai: 'first-time', coding: 'work', asked: ['github'], channel: 'stable', fullSkills: 'no', github: true },
  { ai: 'dabbled', coding: 'no', asked: ['fullSkills', 'github'], channel: 'stable', fullSkills: 'no', github: false },
  { ai: 'dabbled', coding: 'small-projects', asked: ['fullSkills', 'github'], channel: 'stable', fullSkills: 'no', github: true },
  { ai: 'confident', coding: 'a-little', asked: ['channel', 'fullSkills', 'github'], channel: 'stable', fullSkills: 'no', github: false },
  { ai: 'confident', coding: 'small-projects', asked: ['channel', 'fullSkills', 'github'], channel: 'stable', fullSkills: 'finished', github: true },
  { ai: 'teach', coding: 'no', asked: ['channel', 'fullSkills', 'github'], channel: 'stable', fullSkills: 'no', github: false },
  { ai: 'teach', coding: 'work', asked: ['channel', 'fullSkills', 'github'], channel: 'stable', fullSkills: 'finished', github: true },
];

/** The questions every fresh york run asks, whatever the experience answers. */
const alwaysAsked = ['team', 'topWorkspace', 'googleDriveFolder', 'workspaces', 'connectors', 'extraTools'];

for (const row of rows) {
  test(`AI tools "${row.ai}" and code "${row.coding}": asked ${row.asked.join(', ')}, starting at ${row.channel}, full skills ${row.fullSkills}, GitHub ${row.github ? 'Yes' : 'No'}`, async (t) => {
    const where = await makeHome(t);
    await answerOnly(where.answersFile, { aiExperience: row.ai, codingExperience: row.coding }, { asked: [...alwaysAsked, ...row.asked] });

    const result = await runWith(where, 'york');

    assert.equal(result.code, 0, result.stdout + result.stderr);
    const settings = await readSettings(where.home);
    assert.deepEqual(
      { channel: settings.channel, fullSkills: settings.fullSkills, github: settings.github },
      { channel: row.channel, fullSkills: row.fullSkills, github: row.github },
    );
  });
}

test('the beta skills are never the default, and a first-timer whose answers file asks for them still gets none', async (t) => {
  const where = await makeHome(t, { aiExperience: 'first-time', codingExperience: 'work', fullSkills: 'beta' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await readSettings(where.home)).fullSkills, 'no');
});

test('a confident person with T3 Code already installed is not asked its channel', async (t) => {
  const where = await makeHome(t);
  await mkdir(join(where.home, t3Leaves.program, '..'), { recursive: true });
  await writeFile(join(where.home, t3Leaves.program), 'stand-in');
  await answerOnly(where.answersFile, { aiExperience: 'teach', codingExperience: 'work' }, { asked: [...alwaysAsked, 'fullSkills', 'github'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
});

test("a signed-in gh skips GitHub with a line saying why, saves it as Yes, and isn't asked whether it's signed in twice", async (t) => {
  const where = await makeHome(t);
  const { gh, replies } = await ghAlreadyInstalled(where.home);
  await fakeMachine(where.home).setReplies({ ...replies, 'gh.exe api user --jq .login': { output: 'already-here\n' } });
  await answerOnly(where.answersFile, { aiExperience: 'dabbled', codingExperience: 'no' }, { asked: [...alwaysAsked, 'fullSkills'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.ok(shows(result.stdout, signedInLine), result.stdout);
  assert.equal((await readSettings(where.home)).github, true);
  assert.deepEqual(ghCommands(await fakeMachine(where.home).runs(), gh), ['auth status --hostname github.com', 'api user --jq .login']);
  checklistSays(result.stdout, 'GitHub', 'Signed in as already-here');
});

test('a gh that is there but not signed in leaves GitHub asked, with no line about it', async (t) => {
  const where = await makeHome(t);
  const { gh, replies } = await ghAlreadyInstalled(where.home);
  await fakeMachine(where.home).setReplies({ ...replies, 'gh.exe auth status --hostname github.com': { code: 1 } });
  await answerOnly(where.answersFile, { aiExperience: 'dabbled', codingExperience: 'no' }, { asked: [...alwaysAsked, 'fullSkills', 'github'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.ok(!shows(result.stdout, signedInLine), result.stdout);
  assert.equal((await readSettings(where.home)).github, false);
  assert.deepEqual(ghCommands(await fakeMachine(where.home).runs(), gh), ['auth status --hostname github.com']);
});

test("an answers file from before the experience questions doesn't look for a signed-in gh, and GitHub stays No", async (t) => {
  const where = await makeHome(t);
  const { gh, replies } = await ghAlreadyInstalled(where.home);
  await fakeMachine(where.home).setReplies(replies);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.ok(!shows(result.stdout, signedInLine), result.stdout);
  assert.equal((await readSettings(where.home)).github, false);
  assert.deepEqual(ghCommands(await fakeMachine(where.home).runs(), gh), []);
  checklistSays(result.stdout, 'GitHub', 'Skipped');
});

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
    aiExperience: 'dabbled',
    codingExperience: 'no',
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

/**
 * What "Anything to change?" offered, read from what an answers file is told when it ticks
 * something that isn't offered: the run stops and lists the options.
 * @param {string} stdout
 */
const changeOffered = (stdout) => {
  const listed = /"change" is wrong: "\w+" isn't one of ((?:"\w+"(?:, )?)+)/.exec(stdout.replace(/[│|]|\s+/g, ' ').replace(/" ,/g, '",'));
  assert.ok(listed, stdout);
  return [...listed[1].matchAll(/"(\w+)"/g)].map((match) => match[1]);
};

test('a re-run with gh signed in sets GitHub to Yes without asking, whatever last time said, with its line', async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home, { github: false });
  const { replies } = await ghAlreadyInstalled(where.home);
  await fakeMachine(where.home).setReplies({ ...replies, 'gh.exe api user --jq .login': { output: 'already-here\n' } });
  await answerOnly(where.answersFile, {});

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await readSettings(where.home)).github, true);
  assert.ok(shows(result.stdout, signedInLine), result.stdout);
  checklistSays(result.stdout, 'GitHub', 'Signed in as already-here');
});

test('a re-run with gh signed in leaves GitHub out of "Anything to change?"', async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home);
  const { replies } = await ghAlreadyInstalled(where.home);
  await fakeMachine(where.home).setReplies(replies);
  await answerOnly(where.answersFile, { change: ['github'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 1, result.stdout + result.stderr);
  const offered = changeOffered(result.stdout);
  assert.ok(!offered.includes('github'), offered.join(', '));
  assert.ok(offered.includes('workspaces'), offered.join(', '));
});
