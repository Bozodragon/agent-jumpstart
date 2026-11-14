// Seam 2: stopping from the page, and a page that's been closed. The person stops with the page's
// Stop button, which throws a Stop from whichever call the run is waiting on; a run whose page has
// gone finishes the step it's on, then waits about 10 minutes at the next question for a page to
// come back, and stops itself if none does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { claudeFolder, exists, fakeMachine, makeHome, readManifest, readOnlyLog, readProfile, readSettings, skillsCli, supplyDownloads, supplyT3, t3Leaves, claudeProgram } from './harness.js';
import { addressFile, runOnPage } from './page-harness.js';

/** The answers given on the page: a team, a first-timer, and the connectors, which end in a Done. */
let answers = { team: 'Marketing', aiExperience: 'first-time', codingExperience: 'no', github: false, workspaces: ['Thinking space'], connectors: ['Gmail'] };

/**
 * A York laptop where the tools are already there and the skills install, taking `skillsTake`
 * ms of real time to, so a test can act while that step is under way. After the skills, the run
 * walks through the connectors and waits for the person to say they're done.
 * @param {import('node:test').TestContext} t
 * @param {{ skillsTake?: number, replies?: Record<string, import('../src/machine.js').Reply>, claudeThere?: boolean, skillsArrive?: boolean }} [options] `replies`: more of the fake machine's.
 *   `claudeThere`: whether Claude Code is already installed (it is, unless this says not).
 *   `skillsArrive`: whether the skills CLI, which always says it worked, leaves the skills in place
 */
async function aLaptop(t, { skillsTake = 0, replies = {}, claudeThere = true, skillsArrive = true } = {}) {
  const where = await makeHome(t);
  const profile = await readProfile('york');
  await supplyDownloads(where, ['skills']);
  const theirs = join(where.home, 'Program Files', 'Tools');
  for (const path of [join(theirs, 'node.exe'), join(theirs, 'git.exe'), join(theirs, 'gh.exe'), ...(claudeThere ? [join(claudeFolder(where.home), 'claude.exe')] : [])]) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'already here');
  }
  const cli = skillsCli(where.home);
  /** @type {Record<string, string>} */
  const skillFiles = {};
  for (const { names, source } of profile.skills) {
    for (const name of names ?? [source.split('/').at(-1)]) skillFiles[join('.claude', 'skills', name, 'SKILL.md')] = `# ${name}`;
  }
  const machine = fakeMachine(where.home);
  await machine.setMachinePath([theirs]);
  await machine.setReplies({
    ...cli.install,
    [cli.key('add')]: { ...(skillsArrive ? { writes: skillFiles } : {}), ...(skillsTake > 0 ? { takes: skillsTake } : {}) },
    'node.exe --version': { output: 'v26.12.1\r\n' },
    'git.exe --version': { output: 'git version 2.56.0.windows.4\n' },
    'gh.exe --version': { output: 'gh version 2.103.1 (2026-10-01)\n' },
    'gh.exe auth status --hostname github.com': { code: 1, output: 'You are not logged into any GitHub hosts.' },
    'claude.exe --version': { output: '2.1.311 (Claude Code)\n' },
    'claude.exe auth status': { output: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'jo.bloggs@york.ac.uk' }) },
    ...replies,
  });
  return { where, machine };
}

/**
 * Answers the questions from `answers` (otherwise with their defaults) until the run sends an
 * event that `until` matches, which is returned.
 * @param {ReturnType<Awaited<ReturnType<typeof runOnPage>>['connect']>} page
 * @param {Awaited<ReturnType<typeof runOnPage>>} run
 * @param {(event: import('./page-harness.js').PageEvent) => boolean} until
 * @param {number} [from] the id after which to start: the events up to it are done with
 */
async function answerUntil(page, run, until, from = 0) {
  for (;;) {
    const event = await page.next((e) => e.id > from && (until(e) || e.type === 'question'));
    if (until(event)) return event;
    from = event.id;
    const given = event.kind === 'done' ? 'done' : event.key in answers ? answers[/** @type {keyof typeof answers} */ (event.key)] : event.initial;
    const { status, body } = await run.answer(event.question, given);
    if (status !== 200) throw new Error(`the answer to ${JSON.stringify(event)} was refused: ${status} ${JSON.stringify(body)}`);
  }
}

/** The connectors' Done, which comes after the skills and memory are set up. @param {import('./page-harness.js').PageEvent} event */
const connectorsDone = (event) => event.type === 'question' && event.kind === 'done' && event.what === "you've connected them";

test('Stop, pressed at a question, ends the run with what was done before it stopped, and the page is told the run is over', async (t) => {
  const { where } = await aLaptop(t);
  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  const done = await answerUntil(page, run, connectorsDone);

  const pressed = await run.stop();
  assert.equal(pressed.status, 200);
  const stopping = await page.next((event) => event.type === 'stopping');
  const problem = await page.next((event) => event.type === 'problem');
  const summary = await page.next((event) => event.type === 'summary' && event.title === 'Done before it stopped');
  const last = page.events.at(-1);
  await page.seen(last?.id ?? 0);
  const result = await run.ended;
  await page.reading;

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.ok(stopping.id > done.id, 'the page hears the run is stopping');
  assert.equal(problem.text, 'Stopped at your request.');
  assert.ok(summary.rows.some((/** @type {[string, string]} */ [label]) => label === 'Settings'), JSON.stringify(summary.rows));
  // The question it was waiting on is never answered, and nothing comes after the stop screen
  // but the server saying it's closing, so the page stops listening rather than keep retrying.
  assert.ok(!page.events.some((event) => event.type === 'answered' && event.question === done.question));
  assert.equal(page.events.at(-1)?.type, 'step');
  assert.match(page.events.at(-1)?.text, /^Running the same line again carries on/);
  assert.ok(page.over, 'the server said the run is over before it closed');
  const log = await readOnlyLog(where.home);
  assert.match(log.text, /Stopped: Stopped at your request\./);
  assert.match(log.text, /Done before it stopped: Settings/);
  assert.equal(await exists(addressFile(where.home)), false);
});

test('Stop, pressed while a step installs something, waits for it to finish, then stops, with it among what was done', async (t) => {
  const { where } = await aLaptop(t, { skillsTake: 2_000 });
  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  const busy = await answerUntil(page, run, (event) => event.type === 'busy' && /^Installing .* skills? from /.test(event.message));

  assert.equal((await run.stop()).status, 200);
  // The page is told which step the run stops after, so it can say so while that step finishes.
  const stopping = await page.next((event) => event.type === 'stopping');
  assert.equal(stopping.after, busy.id);
  const summary = await page.next((event) => event.type === 'summary' && event.title === 'Done before it stopped');
  await page.next((event) => event.type === 'step' && /^Running the same line again/.test(event.text));
  await page.seen(page.events.at(-1)?.id ?? 0);
  const result = await run.ended;

  assert.equal(result.code, 1, result.stdout + result.stderr);
  // The step finished, and finished well, before the stop screen.
  const ended = await page.next((event) => event.type === 'ended' && event.busy === busy.id);
  assert.equal(ended.ok, true);
  assert.ok(ended.id > stopping.id);
  const problem = await page.next((event) => event.type === 'problem');
  assert.equal(problem.text, 'Stopped at your request.');
  assert.ok(ended.id < problem.id);
  // Nothing else was started after it: the next source's skills aren't installed.
  assert.ok(!page.events.some((event) => event.type === 'busy' && event.id > stopping.id), JSON.stringify(page.events.slice(-8)));
  // What it installed is listed, though the rest of the skills step never ran.
  const [, line] = busy.message.match(/^Installing (.*)$/);
  assert.ok(
    summary.rows.some((/** @type {[string, string]} */ [label, value]) => label === 'Skills' && value === `Installed ${line}`),
    JSON.stringify(summary.rows),
  );
  assert.ok(page.over);
  const log = await readOnlyLog(where.home);
  assert.match(log.text, /Installer page: Stop was pressed/);
  assert.match(log.text, new RegExp(`Installer page: the run stops once this step is done: Installing ${line}`));
  assert.match(log.text, /Stopped: Stopped at your request\./);
  assert.match(log.text, new RegExp(`Done before it stopped: Skills: Installed ${line}`));
});

test("Stop, pressed while the last skills install, stops as that install ends: the steps after it, which make no call that waits at first, don't run", async (t) => {
  const { where, machine } = await aLaptop(t, { skillsTake: 1_500 });
  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  const sources = (await readProfile('york')).skills.map((/** @type {{ source: string }} */ { source }) => source);
  const busy = await answerUntil(page, run, (event) => event.type === 'busy' && event.message.endsWith(` from ${sources.at(-1)}`));

  assert.equal((await run.stop()).status, 200);
  const summary = await page.next((event) => event.type === 'summary' && event.title === 'Done before it stopped');
  await page.seen(page.events.at(-1)?.id ?? 0);
  const result = await run.ended;

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal((await page.next((event) => event.type === 'ended' && event.busy === busy.id)).ok, true);
  assert.ok(summary.rows.some((/** @type {[string, string]} */ [label, value]) => label === 'Skills' && value === busy.message.replace(/^Installing/, 'Installed')), JSON.stringify(summary.rows));
  // Memory isn't switched off, and the connectors' page isn't opened: the run stopped first.
  const log = await readOnlyLog(where.home);
  assert.doesNotMatch(log.text, /Written to settings: skillsInstalled/);
  assert.ok(!summary.rows.some((/** @type {[string, string]} */ [label]) => label === 'Memory'), JSON.stringify(summary.rows));
  assert.deepEqual(await machine.pagesOpened(), []);
});

test("Stop, pressed while a skills install says it worked but leaves no skills, doesn't count them as installed", async (t) => {
  const { where } = await aLaptop(t, { skillsTake: 1_500, skillsArrive: false });
  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  await answerUntil(page, run, (event) => event.type === 'busy' && /^Installing .* skills? from /.test(event.message));

  assert.equal((await run.stop()).status, 200);
  const summary = await page.next((event) => event.type === 'summary' && event.title === 'Done before it stopped');
  await page.seen(page.events.at(-1)?.id ?? 0);
  const result = await run.ended;

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.ok(!summary.rows.some((/** @type {[string, string]} */ [label]) => label === 'Skills'), JSON.stringify(summary.rows));
});

test("Stop, pressed while an install has hung, waits 10 minutes of counted time for it, then stops without it", async (t) => {
  const { where, machine } = await aLaptop(t, { skillsTake: 60_000 });
  // A wait for something outside the Installer is given a moment of real time, then counted out.
  await machine.setWaiting({ outside: 1_000 });
  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  const busy = await answerUntil(page, run, (event) => event.type === 'busy' && /^Installing .* skills? from /.test(event.message));

  const pressed = performance.now();
  assert.equal((await run.stop()).status, 200);
  const summary = await page.next((event) => event.type === 'summary' && event.title === 'Done before it stopped');
  await page.seen(page.events.at(-1)?.id ?? 0);
  const result = await run.ended;
  const took = performance.now() - pressed;

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.ok(took < 15_000, `the 10 minutes were counted, not waited: ${Math.round(took)} ms`);
  // It simply ended, neither done nor failed, and isn't counted as done.
  assert.equal((await page.next((event) => event.type === 'ended' && event.busy === busy.id)).ok, undefined);
  assert.ok(!summary.rows.some((/** @type {[string, string]} */ [label]) => label === 'Skills'), JSON.stringify(summary.rows));
  const log = await readOnlyLog(where.home);
  assert.match(log.text, /Installer page: the step wasn't done within 10 minutes of the stop, so it's left to finish by itself: Installing /);
});

test("Stop, pressed while T3 Code installs, waits for its installer, and lists T3 Code as done, though its step went on to wait for it to open", async (t) => {
  const installer = 'T3-Code-0.0.30-x64.exe';
  // Its installer takes a while, and leaves T3 Code in place but not yet opened.
  const { where } = await aLaptop(t, { replies: { [installer]: { creates: [t3Leaves.program], takes: 2_000 }, 'T3-Code-0.0.30-arm64.exe': { creates: [t3Leaves.program], takes: 2_000 } } });
  await supplyT3(where.downloads, 'latest.yml', '0.0.30');
  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  const busy = await answerUntil(page, run, (event) => event.type === 'busy' && /^Installing T3 Code/.test(event.message));

  assert.equal((await run.stop()).status, 200);
  const summary = await page.next((event) => event.type === 'summary' && event.title === 'Done before it stopped');
  await page.seen(page.events.at(-1)?.id ?? 0);
  const result = await run.ended;

  assert.equal(result.code, 1, result.stdout + result.stderr);
  const ended = await page.next((event) => event.type === 'ended' && event.busy === busy.id);
  assert.equal(ended.ok, true);
  assert.equal(await exists(join(where.home, t3Leaves.program)), true);
  assert.ok(summary.rows.some((/** @type {[string, string]} */ [label, value]) => label === 'T3 Code' && /^0\.0\.30 \(stable, /.test(value)), JSON.stringify(summary.rows));
  // Listed once: the busy's row stands in for the step's, which never came.
  assert.equal(summary.rows.filter((/** @type {[string, string]} */ [label]) => label === 'T3 Code').length, 1);
});

test('Stop, pressed while `claude install` sets Claude Code up, waits for it, and lists Claude Code as done, though its sign-in never came', async (t) => {
  const { where } = await aLaptop(t, { claudeThere: false, replies: { 'claude.exe install': { output: 'Claude Code successfully installed!\n', creates: [claudeProgram], takes: 2_000 } } });
  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  const busy = await answerUntil(page, run, (event) => event.type === 'busy' && event.message === 'Setting up Claude Code');

  assert.equal((await run.stop()).status, 200);
  const summary = await page.next((event) => event.type === 'summary' && event.title === 'Done before it stopped');
  await page.seen(page.events.at(-1)?.id ?? 0);
  const result = await run.ended;

  assert.equal(result.code, 1, result.stdout + result.stderr);
  const ended = await page.next((event) => event.type === 'ended' && event.busy === busy.id);
  assert.deepEqual([ended.text, ended.ok], ['Claude Code installed', true]);
  assert.equal(await exists(join(where.home, claudeProgram)), true);
  assert.ok(summary.rows.some((/** @type {[string, string]} */ [label, value]) => label === 'Claude Code' && value === 'Installed'), JSON.stringify(summary.rows));
});

/** Waits until the run's log says `what`, as Jacob reading it would see. @param {string} home @param {RegExp} what */
async function logSays(home, what) {
  const giveUp = performance.now() + 20_000;
  for (;;) {
    const text = await readOnlyLog(home).then((log) => log.text, () => '');
    if (what.test(text)) return text;
    if (performance.now() > giveUp) throw new Error(`the log never said ${what}:\n${text}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('a page closed during a step: the step finishes, the next question waits, and with no page back within 10 minutes of counted time the run stops itself', async (t) => {
  const { where, machine } = await aLaptop(t, { skillsTake: 400 });
  // A page connecting is given a moment of real time before a wait for it is counted out.
  await machine.setWaiting({ outside: 1_000 });
  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  await answerUntil(page, run, (event) => event.type === 'busy' && /^Installing .* skills? from /.test(event.message));
  page.close();
  const closed = performance.now();
  const result = await run.ended;
  const took = performance.now() - closed;

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.ok(took < 10_000, `the 10 minutes were counted, not waited: ${Math.round(took)} ms`);
  // The skills step finished, and so did the memory step after it, before the run stopped at the
  // connectors' Done.
  assert.ok(Array.isArray((await readSettings(where.home)).skillsInstalled), 'the skills were recorded');
  const log = await readOnlyLog(where.home);
  const waits = log.text.indexOf('Installer page: no page is open, so the run waits, up to 10 minutes, for one to come back');
  assert.ok(waits > log.text.indexOf('Written to settings: skillsInstalled'), log.text);
  assert.match(log.text, /Installer page: no page came back within 10 minutes/);
  assert.match(log.text, /Stopped: The Installer page was closed, and wasn't opened again within 10 minutes\./);
  assert.match(log.text, /Done before it stopped: Skills: /);
  assert.equal(await exists(addressFile(where.home)), false);
});

test('a page that comes back within the 10 minutes finds the question waiting, and the run carries on', async (t) => {
  const { where } = await aLaptop(t, { skillsTake: 400 });
  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const first = run.connect();
  await answerUntil(first, run, (event) => event.type === 'busy' && /^Installing .* skills? from /.test(event.message));
  first.close();
  await logSays(where.home, /Installer page: no page is open, so the run waits, up to 10 minutes/);

  // Opened again (a reload, or the Bootstrap reopening it): the same question, still open.
  const again = run.connect();
  const done = await again.next(connectorsDone);
  assert.ok(!again.events.some((event) => event.type === 'answered' && event.question === done.question));
  assert.equal((await run.answer(done.question, 'done')).status, 200);
  await answerUntil(again, run, (event) => event.type === 'finish', done.id);
  const result = await run.ended;

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const log = await readOnlyLog(where.home);
  assert.match(log.text, /Installer page: a page is open again/);
  assert.doesNotMatch(log.text, /no page came back/);
  assert.ok(!again.events.some((event) => event.type === 'stopping'));
});

/** GitHub's own sign-in, run on screen, which takes `ms` of real time to come back. @param {number} ms */
const aSlowGitHubSignIn = (ms) => ({ 'gh.exe auth login': { takes: ms } });

/** The notice just before GitHub's sign-in runs on screen. @param {import('./page-harness.js').PageEvent} event */
const signInToGitHub = (event) => event.type === 'notice' && event.title === 'Sign in to GitHub';

test("Stop, pressed while a sign-in runs on screen, ends the run at once, without waiting for the sign-in", async (t) => {
  const { where } = await aLaptop(t, { replies: aSlowGitHubSignIn(15_000) });
  answers = { ...answers, github: true };
  t.after(() => (answers = { ...answers, github: false }));
  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  await answerUntil(page, run, signInToGitHub);
  // Under way: the run has gone to the sign-in, with nothing more to say until it comes back.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const pressed = performance.now();
  assert.equal((await run.stop()).status, 200);
  await page.next((event) => event.type === 'step' && /^Running the same line again/.test(event.text));
  await page.seen(page.events.at(-1)?.id ?? 0);
  const result = await run.ended;
  const took = performance.now() - pressed;

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.ok(took < 8_000, `it stopped without waiting for the sign-in: ${Math.round(took)} ms`);
  const problem = await page.next((event) => event.type === 'problem');
  assert.equal(problem.text, 'Stopped at your request.');
  await page.next((event) => event.type === 'summary' && event.title === 'Done before it stopped');
  assert.doesNotMatch((await readOnlyLog(where.home)).text, /gh auth login stopped with code/);
});

test('a page closed while a sign-in runs on screen: with no page back within 10 minutes of counted time, the run stops itself', async (t) => {
  const { where, machine } = await aLaptop(t, { replies: aSlowGitHubSignIn(15_000) });
  await machine.setWaiting({ outside: 1_000 });
  answers = { ...answers, github: true };
  t.after(() => (answers = { ...answers, github: false }));
  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  await answerUntil(page, run, signInToGitHub);
  page.close();
  const closed = performance.now();
  const result = await run.ended;
  const took = performance.now() - closed;

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.ok(took < 8_000, `the 10 minutes were counted, and the sign-in not waited for: ${Math.round(took)} ms`);
  const log = await readOnlyLog(where.home);
  assert.match(log.text, /Installer page: no page is open, so the run waits, up to 10 minutes, for one to come back/);
  assert.match(log.text, /Stopped: The Installer page was closed, and wasn't opened again within 10 minutes\./);
});

test('Stop, pressed while the run looks for an earlier T3 Code, stops at once, without waiting for the look, before anything is changed', async (t) => {
  const t3 = (await readManifest()).tools.find((/** @type {{ id: string }} */ tool) => tool.id === 't3');
  const look = { code: 1, output: 'ERROR: The system was unable to find the specified registry key or value.', takes: 15_000 };
  const { where } = await aLaptop(t, { replies: { [`reg.exe query ${t3.install.versionIn}`]: look } });
  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  const busy = await answerUntil(page, run, (event) => event.type === 'busy' && /^Checking whether T3 Code is installed/.test(event.message));

  const pressed = performance.now();
  assert.equal((await run.stop()).status, 200);
  const problem = await page.next((event) => event.type === 'problem');
  await page.seen(page.events.at(-1)?.id ?? 0);
  const result = await run.ended;
  const took = performance.now() - pressed;

  assert.equal(result.code, 1, result.stdout + result.stderr);
  // A look changes nothing, so there's nothing to finish: it simply ends, neither done nor failed.
  assert.ok(took < 8_000, `it stopped without waiting for the look: ${Math.round(took)} ms`);
  const stopping = page.events.find((event) => event.type === 'stopping');
  assert.equal(stopping?.after, undefined);
  const ended = page.events.find((event) => event.type === 'ended' && event.busy === busy.id);
  assert.equal(ended?.ok, undefined);
  assert.equal(problem.text, 'Stopped at your request. Nothing has been changed.');
  assert.equal(await exists(join(where.home, 'AppData', 'Local', 'agent-jumpstart', 'settings.json')), false);
  const log = await readOnlyLog(where.home);
  assert.doesNotMatch(log.text, /couldn't look for an earlier install/);
  assert.doesNotMatch(log.text, /Settings written/);
});
