// Seam 2: the questions as a person at the page meets them. Which questions their experience
// answers hide from them, and going back (Back, or Change from the Details panel) while the
// questions last: the run asks again from the question gone back to, the answers before it
// standing, and every answer given before as the default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeMachine, fixtureProfiles, ghAlreadyInstalled, makeHome, readOnlyLog, readProfile, readSettings, runWith } from './harness.js';
import { runOnPage } from './page-harness.js';

/** @typedef {import('./page-harness.js').PageEvent} PageEvent */

/**
 * A run on the page, with what the tests below do to it: answer the next question, which must be
 * the one with `key`, and go back to an earlier one, as the page's Back and Change do.
 * @param {import('node:test').TestContext} t @param {{ home: string, downloads: string }} where
 * @param {string[]} [extra]
 */
async function onPage(t, where, extra = []) {
  const run = await runOnPage(where, 'york', extra);
  t.after(run.kill);
  const page = run.connect();
  t.after(page.close);
  /** The last question this test has met; the next one comes after it. */
  let from = 0;
  /** @returns {Promise<PageEvent>} */
  const nextQuestion = async () => {
    const question = await page.next((event) => event.type === 'question' && event.id > from);
    from = question.id;
    return question;
  };
  return {
    run,
    page,
    nextQuestion,
    /**
     * Answers the next question, which must be `key`'s, with `value`, or its default if not given.
     * @param {string} key @param {unknown} [value] @returns {Promise<PageEvent>} the question
     */
    async answer(key, value) {
      const question = await nextQuestion();
      assert.equal(question.key, key, `the next question is ${question.key}, not ${key}`);
      const reply = await run.answer(question.question, value === undefined ? question.initial : value);
      assert.equal(reply.status, 200, JSON.stringify(reply.body));
      return question;
    },
    /** Goes back to an earlier question, by its id. @param {number} to */
    back: (to) => run.request(`${run.url.pathname}back`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }) }),
    /**
     * Answers every question from here to the end with its default (Done for a Done), and says
     * which were asked.
     * @returns {Promise<PageEvent[]>}
     */
    async finish() {
      /** @type {PageEvent[]} */
      const asked = [];
      for (;;) {
        const event = await page.next((e) => e.id > from && (e.type === 'question' || e.type === 'finish'));
        if (event.type === 'finish') return asked;
        from = event.id;
        asked.push(event);
        const reply = await run.answer(event.question, event.kind === 'done' ? 'done' : event.initial);
        assert.equal(reply.status, 200, `${JSON.stringify(event)}: ${JSON.stringify(reply.body)}`);
      }
    },
  };
}

test("someone at the page who's pretty confident with AI tools and writes code for work is asked which T3 Code and about skills, with the full set's finished skills as the default", async (t) => {
  const where = await makeHome(t);
  const { run, answer, finish } = await onPage(t, where);

  for (const [key, value] of [['team', 'Marketing'], ['aiExperience', 'confident'], ['codingExperience', 'work'], ['topWorkspace', 'new']]) await answer(key, value);
  const rest = await finish();
  assert.equal((await run.ended).code, 0);

  const keys = rest.filter((question) => question.kind !== 'done').map((question) => question.key);
  assert.ok(keys.includes('channel'), keys.join(', '));
  assert.equal(rest.find((question) => question.key === 'fullSkills')?.initial, 'finished');
  // A first-timer isn't sent either (installer-page.test.js's whole setup).
});

test("someone at the page whose GitHub CLI is already signed in isn't sent the GitHub question, and is told why", async (t) => {
  const where = await makeHome(t);
  const { replies } = await ghAlreadyInstalled(where.home);
  await fakeMachine(where.home).setReplies(replies);
  const { run, page, finish } = await onPage(t, where);

  const asked = await finish();
  assert.equal((await run.ended).code, 0);

  assert.ok(!asked.some((question) => question.key === 'github'), 'GitHub was asked');
  assert.ok(page.events.some((event) => event.type === 'step' && event.text === "GitHub: you're already signed in with GitHub's own tool, so GitHub is set up without asking."));
  assert.equal((await readSettings(where.home)).github, true);
});

test('going back to an earlier question asks it and everything after it again, each with the answer given before as its default, and the settings are the final answers', async (t) => {
  const where = await makeHome(t);
  const { run, page, answer, nextQuestion, back, finish } = await onPage(t, where);

  await answer('team', 'Marketing');
  const ai = await answer('aiExperience', 'confident');
  await answer('codingExperience', 'work');
  await answer('topWorkspace', 'new');
  const driveFolder = await answer('googleDriveFolder');
  await answer('channel', 'nightly');
  await answer('github', false);
  await answer('workspaces', ['Thinking space']);
  const connectors = await nextQuestion();
  assert.equal(connectors.key, 'connectors');

  const went = await back(ai.question);
  assert.equal(went.status, 200, went.body);
  const wentBack = await page.next((event) => event.type === 'back');
  assert.equal(wentBack.to, ai.question);
  // The question the run was waiting at is gone: an answer to it is too late.
  assert.equal((await run.answer(connectors.question, [])).status, 409);

  // Asked again from the question gone back to, the team standing as it was.
  const again = await nextQuestion();
  assert.equal(again.key, 'aiExperience');
  assert.equal(again.initial, 'confident');
  assert.ok(!page.events.some((event) => event.type === 'question' && event.key === 'team' && event.id > wentBack.id), 'the team was asked again');
  assert.equal((await run.answer(again.question, 'first-time')).status, 200);
  assert.equal((await answer('codingExperience')).initial, 'work');
  assert.equal((await answer('topWorkspace')).initial, 'new');
  assert.equal((await answer('googleDriveFolder')).initial, driveFolder.initial);
  // A first-timer isn't asked which T3 Code: it's Stable, whatever was answered before.
  assert.equal((await answer('github')).initial, false);
  assert.deepEqual((await answer('workspaces')).initial, ['Thinking space']);
  const rest = await finish();
  const result = await run.ended;

  assert.equal(result.code, 0, result.stdout + result.stderr);
  for (const key of ['team', 'channel', 'fullSkills']) assert.ok(!rest.some((question) => question.key === key), `${key} was asked`);
  const settings = await readSettings(where.home);
  assert.deepEqual(
    { team: settings.team, aiExperience: settings.aiExperience, codingExperience: settings.codingExperience, channel: settings.channel, github: settings.github, workspaces: settings.workspaces, fullSkills: settings.fullSkills },
    { team: 'Marketing', aiExperience: 'first-time', codingExperience: 'work', channel: 'stable', github: false, workspaces: ['Thinking space'], fullSkills: 'no' },
  );
  const log = await readOnlyLog(where.home);
  assert.match(log.text, /Back: to aiExperience/);
});

test("on a re-run, changing an answer from the Details panel asks again from it, what to change and the experience questions among what's asked again", async (t) => {
  // Last time: a first-timer, so Skills was No without asking.
  const where = await makeHome(t, { team: 'Marketing', aiExperience: 'first-time', codingExperience: 'no', workspaces: ['Thinking space', 'Personal assistant'] });
  const first = await runWith(where, 'york');
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const { run, page, answer, nextQuestion, back, finish } = await onPage(t, where);

  const change = await answer('change', ['experience']);
  const ai = await answer('aiExperience', 'confident');
  await answer('codingExperience', 'work');
  // Pretty confident now, so the questions the first time hid are asked.
  await answer('channel');
  const skills = await nextQuestion();
  assert.equal(skills.key, 'fullSkills');

  // Changing what to change, the first question, asks everything after it again too.
  assert.equal((await back(change.question)).status, 200);
  const again = await nextQuestion();
  assert.equal(again.key, 'change');
  assert.deepEqual(again.initial, ['experience']);
  assert.equal((await run.answer(again.question, ['experience', 'workspaces'])).status, 200);
  assert.equal((await answer('aiExperience', 'first-time')).initial, 'confident');
  assert.equal((await answer('codingExperience')).initial, 'work');
  // Workspaces, ticked this time, is asked with last time's; a first-timer isn't asked about skills.
  assert.deepEqual((await answer('workspaces', ['Thinking space'])).initial, ['Thinking space', 'Personal assistant']);
  const rest = await finish();
  const result = await run.ended;

  assert.equal(result.code, 0, result.stdout + result.stderr);
  for (const key of ['channel', 'fullSkills']) assert.ok(!rest.some((question) => question.key === key), `${key} was asked`);
  assert.ok(page.events.some((event) => event.type === 'back' && event.to === change.question));
  const settings = await readSettings(where.home);
  assert.deepEqual(
    { aiExperience: settings.aiExperience, codingExperience: settings.codingExperience, workspaces: settings.workspaces, fullSkills: settings.fullSkills },
    { aiExperience: 'first-time', codingExperience: 'work', workspaces: ['Thinking space'], fullSkills: 'no' },
  );
  assert.ok(ai.back && again.back, 'the questions could be gone back to');
});

test('once the questions are over, Back and Change are gone: nothing asked later can be gone back from, and going back to an answered question is refused', async (t) => {
  const where = await makeHome(t);
  const { run, page, answer, nextQuestion, back } = await onPage(t, where);

  const team = await answer('team', 'Marketing');
  for (const key of ['aiExperience', 'codingExperience', 'topWorkspace', 'googleDriveFolder', 'github', 'workspaces', 'connectors']) await answer(key);
  const last = await answer('extraTools');
  // The next thing the person is asked is to connect the connectors, once the settings are written.
  const done = await nextQuestion();
  assert.equal(done.kind, 'done');

  // Straight after the last answer, before the Installer does anything with the answers.
  const answered = await page.next((event) => event.type === 'answered' && event.question === last.question);
  const fixed = await page.next((event) => event.type === 'fixed');
  assert.equal(fixed.id, answered.id + 1);
  assert.equal(done.back, undefined);
  const refused = await back(team.question);
  assert.equal(refused.status, 409);
  assert.ok(!page.events.some((event) => event.type === 'back'), 'the run went back');
  // The run carries on as if nothing had been asked of it.
  assert.equal((await run.answer(done.question, 'done')).status, 200);
});

test("once something in the questions acts on the laptop (Google Drive's installer opened in the browser), there's no going back to before it", async (t) => {
  const where = await makeHome(t, {}, { googleDrive: 'missing' });
  const york = await readProfile('york');
  york.googleDrive.hostedInstaller = { id: 'a-test-drive-file', version: '132.0.0.0', size: 4000, sha256: '0'.repeat(64) };
  const flags = await fixtureProfiles(where, { york });
  // Software Center offers Drive at the hosted installer's version, so the Installer gets it from there.
  const offered = JSON.stringify({ Id: 'ScopeId_0/Application_1', Name: 'Google Drive', InstallState: 'NotInstalled', SoftwareVersion: '132.0.0' });
  await fakeMachine(where.home).setReplies({
    'sc.exe query CcmExec': { output: 'SERVICE_NAME: CcmExec\r\n        STATE              : 4  RUNNING\r\n' },
    'reg.exe query HKCR\softwarecenter': { output: 'HKEY_CLASSES_ROOT\softwarecenter\r\n    URL Protocol    REG_SZ    \r\n' },
    'powershell.exe -NoProfile -NonInteractive -Command': { output: `${offered}\r\n` },
  });
  const { page, answer, back } = await onPage(t, where, flags);

  const ai = await answer('team', 'Marketing').then(() => answer('aiExperience'));
  await answer('codingExperience');
  await answer('topWorkspace', 'new');
  const opened = await page.next((event) => event.type === 'step' && /Google Drive's installer/.test(event.text));
  const fixed = await page.next((event) => event.type === 'fixed');
  assert.ok(fixed.id < opened.id, "Back was gone before the installer's page was opened");
  assert.equal((await back(ai.question)).status, 409);
});
