// The experience questions: how much the person has used AI tools, and whether they've written
// code. They come straight after the team (or first, under a profile with no teams), and change
// only which later questions are asked and what those start with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { answerOnly, checklistSays, fakeMachine, ghAlreadyInstalled, ghCommands, makeHome, readOnlyLog, readSettings, runWith, seedSettings, shows, stateFolder, t3Leaves } from './harness.js';

/** The keys of the log's `Answer:` lines, in the order they were written. @param {string} log */
const answered = (log) => [...log.matchAll(/Answer: (\w+):/g)].map((match) => match[1]);

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
    // A hidden question would take its default too, so the log is read for which were hidden.
    const { text } = await readOnlyLog(where.home);
    for (const key of ['channel', 'fullSkills']) {
      assert.equal(text.includes(`Experience: ${key} isn't asked`), !row.asked.includes(key), `${key}: ${text}`);
    }
  });
}

test("a first-timer isn't asked full skills, so an answers file's beta is set aside and full skills is No", async (t) => {
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

test('"Anything to change?" offers Experience straight after Team', async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home);
  await answerOnly(where.answersFile, { change: ['nothing'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.deepEqual(changeOffered(result.stdout).slice(0, 3), ['team', 'experience', 'workspaces']);
});

test('ticking Experience asks both again, each starting at last time\'s answer', async (t) => {
  const where = await makeHome(t);
  // The code question's own default is No, so only last time's answer gives "a little".
  await seedYork(where.home, { aiExperience: 'dabbled', codingExperience: 'a-little' });
  await answerOnly(where.answersFile, { change: ['experience'], aiExperience: 'first-time' }, { asked: ['codingExperience'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.deepEqual([settings.aiExperience, settings.codingExperience], ['first-time', 'a-little']);
  const { text } = await readOnlyLog(where.home);
  for (const key of ['aiExperience', 'codingExperience']) assert.ok(text.includes(`Settings: ${key} is to change, so it's asked again`), text);
});

test('"Anything to change?" leaves out Skills when last time\'s AI answer was a first time, which Skills isn\'t asked of', async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home, { aiExperience: 'first-time' });
  await answerOnly(where.answersFile, { change: ['nothing'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 1, result.stdout + result.stderr);
  const offered = changeOffered(result.stdout);
  assert.ok(!offered.includes('fullSkills'), offered.join(', '));
  assert.ok(offered.includes('experience'), offered.join(', '));
});

test('settings from before this release get both experience questions asked once', async (t) => {
  const where = await makeHome(t);
  const { aiExperience, codingExperience, ...older } = await seedYork(where.home);
  await seedSettings(where.home, older);
  await answerOnly(where.answersFile, { aiExperience: 'confident', codingExperience: 'work' });

  const first = await runWith(where, 'york');

  assert.equal(first.code, 0, first.stdout + first.stderr);
  const settings = await readSettings(where.home);
  assert.deepEqual([settings.aiExperience, settings.codingExperience], ['confident', 'work']);
  const asked = (await readOnlyLog(where.home)).text;
  for (const key of ['aiExperience', 'codingExperience']) assert.ok(!asked.includes(`Known from settings: ${key}:`), asked);

  // The next run knows them, and asks neither.
  await rm(join(stateFolder(where.home), 'logs'), { recursive: true });
  await answerOnly(where.answersFile, {});
  const second = await runWith(where, 'york');

  assert.equal(second.code, 0, second.stdout + second.stderr);
  const { text } = await readOnlyLog(where.home);
  for (const key of ['aiExperience', 'codingExperience']) assert.ok(text.includes(`Known from settings: ${key}:`), text);
});

test('new experience answers that reveal T3 Code\'s channel ask it, and keep every other answer, even one whose default has changed', async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home, { aiExperience: 'dabbled', codingExperience: 'no', channel: 'stable', fullSkills: 'no' });
  // Full skills was asked last time, so it isn't now, though confident with work starts it at his finished skills.
  await answerOnly(where.answersFile, { change: ['experience'], aiExperience: 'confident', codingExperience: 'work', channel: 'nightly' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.deepEqual({ channel: settings.channel, fullSkills: settings.fullSkills, github: settings.github }, { channel: 'nightly', fullSkills: 'no', github: false });
});

test('new experience answers that reveal full skills ask it with its own default for those answers, not the No it was given last time', async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home, { aiExperience: 'first-time', codingExperience: 'no', fullSkills: 'no' });
  await answerOnly(where.answersFile, { change: ['experience'], aiExperience: 'teach', codingExperience: 'work' }, { asked: ['channel', 'fullSkills'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.deepEqual({ channel: settings.channel, fullSkills: settings.fullSkills }, { channel: 'stable', fullSkills: 'finished' });
});

test('new experience answers that hide a question keep its saved answer', async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home, { aiExperience: 'teach', codingExperience: 'work', channel: 'nightly', fullSkills: 'finished' });
  await answerOnly(where.answersFile, { change: ['experience'], aiExperience: 'first-time', codingExperience: 'no' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.deepEqual({ channel: settings.channel, fullSkills: settings.fullSkills }, { channel: 'nightly', fullSkills: 'finished' });
});

test('an answers file from before the experience questions can still change Skills on a re-run', async (t) => {
  const where = await makeHome(t, { fullSkills: 'finished' });
  const first = await runWith(where, 'york');
  assert.equal(first.code, 0, first.stdout + first.stderr);
  await rm(join(stateFolder(where.home), 'logs'), { recursive: true });
  await writeFile(where.answersFile, JSON.stringify({ change: ['fullSkills'], fullSkills: 'no' }));

  const second = await runWith(where, 'york');

  assert.equal(second.code, 0, second.stdout + second.stderr);
  assert.equal((await readSettings(where.home)).fullSkills, 'no');
});

test('Skills ticked along with Experience, then hidden by a first-time answer, takes its first-time No rather than last time\'s', async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home, { aiExperience: 'dabbled', fullSkills: 'finished' });
  await answerOnly(where.answersFile, { change: ['experience', 'fullSkills'], aiExperience: 'first-time' }, { asked: ['codingExperience'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await readSettings(where.home)).fullSkills, 'no');
  const { text } = await readOnlyLog(where.home);
  assert.ok(!text.includes("Settings: fullSkills is to change, so it's asked again"), text);
});

test("a first-timer's re-run summary doesn't list the answers they were never asked", async (t) => {
  const where = await makeHome(t);
  await seedYork(where.home, { aiExperience: 'first-time', codingExperience: 'no' });
  await answerOnly(where.answersFile, {});

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.ok(shows(result.stdout, 'AI tools This is my first time'), result.stdout);
  assert.ok(!shows(result.stdout, 'Skills Just the usual ones'), result.stdout);
  assert.ok(!/T3 Code\s+[│|]?\s*Stable/.test(result.stdout), result.stdout);
});
