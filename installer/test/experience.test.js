// The experience questions: how much the person has used AI tools, and whether they've written
// code. They come straight after the team (or first, under a profile with no teams), and change
// only which later questions are asked and what those start with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { answerOnly, makeHome, readOnlyLog, readSettings, runWith, t3Leaves } from './harness.js';

/** The keys of the log's `Answer:` lines, in the order they were written. @param {string} log */
const answered = (log) => [...log.matchAll(/Answer: (\w+):/g)].map((match) => match[1]);

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
