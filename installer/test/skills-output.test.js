// The skills step is the one step that shows a program's own output: the skills installer's, with
// its colours and its spinner, in a small terminal on the Installer page (issue #88). Here, through
// the page conversation (seam 2), and in the terminal front end, which shows its own spinner as
// it always has (seam 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fakeMachine, gitOnMachinePath, makeHome, runWith, skillsCli, supplyDownloads } from './harness.js';
import { answerEverything, runOnPage } from './page-harness.js';

/** What the skills installer prints for a source, coloured and with a spinner redrawn, as it really does. @param {string} source */
const printed = (source) =>
  `\x1b[90m|\x1b[39m\n\x1b[32mo\x1b[39m  Source: https://github.com/${source}.git\n\x1b[35m•\x1b[39m  Cloning repository…\x1b[1G\x1b[J\x1b[32mo\x1b[39m  Repository cloned\n`;

/** The default profile's skills from mattpocock/skills. */
const mattpocock = ['ask-matt', 'grilling', 'grill-me', 'grill-with-docs', 'domain-modeling', 'teach', 'to-questionnaire', 'handoff', 'wait-what', 'research', 'wayfinder', 'to-spec', 'to-tickets', 'setup-matt-pocock-skills', 'prototype', 'wizard'];

/**
 * A home where the skills CLI installs, with Git on the PATH and every skill arriving. The add for
 * anthropics/skills takes a while, so what it prints can be seen before it ends.
 * @param {import('node:test').TestContext} t @param {Record<string, unknown>} [answers]
 */
async function homeWhereSkillsInstall(t, answers) {
  const where = await makeHome(t, answers);
  await supplyDownloads(where, ['skills']);
  await gitOnMachinePath(where.home);
  const cli = skillsCli(where.home);
  const arrives = (/** @type {string[]} */ ...names) => Object.fromEntries(names.map((name) => [join('.claude', 'skills', name, 'SKILL.md'), `# ${name}`]));
  await fakeMachine(where.home).setReplies({
    ...cli.install,
    [cli.key('add', 'mattpocock/skills')]: { output: printed('mattpocock/skills'), writes: arrives(...mattpocock) },
    [cli.key('add', 'anthropics/skills')]: { output: printed('anthropics/skills'), writes: arrives('frontend-design'), takes: 1500 },
    [cli.key('add', 'cursor/plugins/pstack/skills/unslop')]: { output: printed('cursor/plugins'), writes: arrives('unslop') },
    [cli.key('add', 'Bozodragon/agent-jumpstart')]: { output: printed('Bozodragon/agent-jumpstart'), writes: arrives('jumpstart') },
  });
  return { ...where, cli };
}

test("on the page, the skills installer's own output reaches the page while it runs, colours and redraws as it printed them, with the source's busy line", async (t) => {
  const where = await homeWhereSkillsInstall(t);

  const run = await runOnPage(where, 'default');
  t.after(run.kill);
  const page = run.connect();
  const answering = answerEverything(page, run.answer);
  const busy = await page.next((event) => event.type === 'busy' && /anthropics\/skills/.test(event.message));
  const output = await page.next((event) => event.type === 'output' && event.busy === busy.id);
  // It's there before the skills installer has finished.
  assert.ok(!page.events.some((event) => event.type === 'ended' && event.busy === busy.id), 'the output came only once the run had ended');
  await answering;
  const result = await run.ended;

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(output.text, printed('anthropics/skills'));
  // One busy per source, each with what its own run printed.
  const busies = page.events.filter((event) => event.type === 'busy' && /^Installing .* from /.test(event.message));
  assert.equal(busies.length, 4);
  for (const each of busies) {
    const shown = page.events.filter((event) => event.type === 'output' && event.busy === each.id).map((event) => event.text).join('');
    assert.match(shown, /Repository cloned/, each.message);
    const ended = page.events.find((event) => event.type === 'ended' && event.busy === each.id);
    assert.ok(ended && ended.ok, `${each.message} didn't end well`);
  }
});

test('the skills installer is run with FORCE_COLOR=1, so its own rails and spinner keep their colours when piped', async (t) => {
  const where = await homeWhereSkillsInstall(t, {});

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stderr);
  const adds = (await fakeMachine(where.home).runs()).filter((ran) => where.cli.isRun(ran) && ran.args[1] === 'add');
  assert.equal(adds.length, 4);
  for (const ran of adds) assert.deepEqual(ran.env, { FORCE_COLOR: '1' });
});

test("in the terminal front end, the skills step shows its own lines as it always has, and none of the skills installer's output", async (t) => {
  const where = await homeWhereSkillsInstall(t, {});

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Repository cloned|Cloning repository|Source: https/);
  for (const source of ['mattpocock/skills', 'anthropics/skills', 'cursor/plugins/pstack/skills/unslop', 'Bozodragon/agent-jumpstart']) {
    // Not a terminal here, so each busy line is a plain line, as it always is then.
    assert.match(result.stdout, new RegExp(`Installing (the skill|\\d+ skills) from ${source.replaceAll('/', '\\/')}\\n`));
  }
});
