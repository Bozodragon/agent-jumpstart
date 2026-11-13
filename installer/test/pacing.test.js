// Seam 3: what the Installer page shows, and for how long (installer/page/pacing.js). The page
// is sent one event per front-end call and the run never waits for it, so the page decides how
// long each thing stays on screen, which calls join into one screen, and what follows in order.
// These tests play events in at given times (in ms) and read what's on screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { begin, dashes, holds, onScreen, reduce, wakeAt } from '../page/pacing.js';

/** @typedef {import('../page/pacing.js').Page} Page */

/**
 * A page that has connected to a run that had sent `before` events, then is sent `events`, each
 * at the time given with it (the history all at once, at 0).
 * @param {[number, Record<string, unknown>][]} timed [time, event] pairs; ids are numbered from 1
 * @param {{ before?: number }} [options]
 */
function play(timed, { before = 0 } = {}) {
  let page = reduce(begin, { type: 'connected', before });
  timed.forEach(([now, event], index) => {
    page = reduce(page, { type: 'event', event: /** @type {any} */ ({ id: index + 1, ...event }), now });
  });
  return page;
}

/** What's on screen at `now`. @param {Page} page @param {number} now */
const at = (page, now) => onScreen(reduce(page, { type: 'tick', now }));

/** @param {Page} page @param {number} now */
const later = (page, now) => reduce(page, { type: 'tick', now });

/** The screen's words, for comparing: its heading or its text. @param {any} screen */
const words = (screen) => screen.ended?.text ?? screen.text ?? screen.title ?? screen.message ?? screen.question?.message ?? screen.kind;

test('a step stays on screen for a moment, then the next thing follows', () => {
  const page = play([
    [0, { type: 'step', text: 'Using the Git already at C:\\Program Files\\Git' }],
    [5, { type: 'step', text: 'Using the GitHub CLI already there' }],
  ]);

  assert.equal(words(at(page, 10)), 'Using the Git already at C:\\Program Files\\Git');
  assert.equal(words(at(page, holds.step - 1)), 'Using the Git already at C:\\Program Files\\Git');
  assert.equal(wakeAt(later(page, 10)), holds.step, 'the page looks again when the first step has had its moment');
  assert.equal(words(at(page, holds.step)), 'Using the GitHub CLI already there');
  // The last thing stays, however long nothing else comes.
  assert.equal(words(at(page, 10 * 60_000)), 'Using the GitHub CLI already there');
});

test('a notice stays until Continue, however long it takes, and whatever arrives meanwhile follows in order', () => {
  let page = play([
    [0, { type: 'notice', title: 'Google Drive', text: "Google Drive isn't on this laptop." }],
    [20, { type: 'step', text: 'Using the Git already at C:\\Program Files\\Git' }],
    [40, { type: 'busy', message: 'Installing the skills CLI' }],
    [900, { type: 'ended', busy: 3, text: 'Skills CLI installed', ok: true }],
    [950, { type: 'step', text: 'Memory: switched off' }],
  ]);

  const notice = at(page, 5 * 60_000);
  assert.equal(notice.kind, 'notice');
  assert.equal(notice.title, 'Google Drive');
  assert.equal(wakeAt(later(page, 5 * 60_000)), undefined, 'nothing but Continue moves a notice on');

  page = reduce(page, { type: 'continue', screen: notice.key, now: 5 * 60_000 });
  assert.equal(words(onScreen(page)), 'Using the Git already at C:\\Program Files\\Git');
  // The busy had ended long before it came on screen: its end is shown for a moment all the same.
  page = later(page, 5 * 60_000 + holds.step);
  const busy = onScreen(page);
  assert.equal(busy.kind, 'busy');
  assert.deepEqual(/** @type {any} */ (busy).ended, { text: 'Skills CLI installed', ok: true });
  assert.equal(words(at(page, 5 * 60_000 + holds.step + holds.done - 1)), 'Skills CLI installed');
  assert.equal(words(at(page, 5 * 60_000 + holds.step + holds.done)), 'Memory: switched off');
});

/** A choose question as the run sends it. @param {number} question @param {string} key @param {string} message */
const choose = (question, key, message) => ({
  type: 'question',
  question,
  kind: 'choose',
  key,
  message,
  options: [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ],
  initial: 'a',
});

test('a question stays until it is answered, here or in another window, and questions are numbered in the order asked', () => {
  let page = play([
    [0, { type: 'start', title: 'Agent Jumpstart · York', setupPage: 'https://jumpstart-york.portall.dev/', shareLogLine: 'irm https://x/share-log.ps1 | iex' }],
    [0, choose(1, 'team', 'Which team are you in?')],
  ]);
  assert.equal(page.title, 'Agent Jumpstart · York');
  assert.equal(page.setupPage, 'https://jumpstart-york.portall.dev/');
  assert.equal(page.shareLogLine, 'irm https://x/share-log.ps1 | iex');

  const team = /** @type {any} */ (at(page, 60 * 60_000));
  assert.equal(team.kind, 'question');
  assert.equal(team.number, 1);
  assert.equal(team.question.key, 'team');
  assert.equal(wakeAt(later(page, 60 * 60_000)), undefined);

  // A folder the run won't take stays on screen, with the reason.
  page = reduce(page, { type: 'event', event: { id: 3, type: 'refused', question: 1, answer: 'c', reason: 'Choose one of the options.' }, now: 61 * 60_000 });
  assert.deepEqual(/** @type {any} */ (onScreen(page)).refused, { answer: 'c', reason: 'Choose one of the options.' });

  // The answer, from whichever window gave it, moves every window on.
  page = reduce(page, { type: 'event', event: { id: 4, type: 'answered', question: 1, answer: 'b' }, now: 62 * 60_000 });
  page = reduce(page, { type: 'event', event: { id: 5, ...choose(2, 'aiExperience', 'How much experience do you have using AI tools like ChatGPT, Claude, or Gemini?') }, now: 62 * 60_000 });
  const next = /** @type {any} */ (onScreen(page));
  assert.equal(next.question.key, 'aiExperience');
  assert.equal(next.number, 2);
});

test('after an answer, until the run says what comes next, the page shows it is waiting on the run', () => {
  let page = play([[0, choose(1, 'connectors', 'Which connectors?')]]);
  page = reduce(page, { type: 'event', event: { id: 2, type: 'answered', question: 1, answer: 'a' }, now: 10 });
  assert.equal(onScreen(page).kind, 'between');
  // Before the run has said anything at all, too.
  assert.equal(onScreen(play([])).kind, 'between');
});

test('something slow stays while it runs, with how far it has got, and its end shows for a moment', () => {
  let page = play([
    [0, { type: 'busy', message: 'Downloading Claude Code (351 MB)' }],
    [200, { type: 'progress', busy: 1, received: 35_100_000, total: 351_000_000 }],
  ]);
  const running = /** @type {any} */ (at(page, 10 * 60_000));
  assert.equal(running.kind, 'busy');
  assert.equal(running.ended, undefined);
  assert.deepEqual([running.received, running.total], [35_100_000, 351_000_000]);
  assert.equal(wakeAt(later(page, 10 * 60_000)), undefined, 'a busy that is still running has no end in sight');

  page = reduce(page, { type: 'event', event: { id: 3, type: 'ended', busy: 1, text: 'Claude Code downloaded', ok: true }, now: 11 * 60_000 });
  page = reduce(page, { type: 'event', event: { id: 4, type: 'busy', message: 'Setting up Claude Code' }, now: 11 * 60_000 + 5 });
  assert.equal(words(onScreen(page)), 'Claude Code downloaded');
  assert.equal(wakeAt(page), 11 * 60_000 + holds.done);
  assert.equal(words(at(page, 11 * 60_000 + holds.done)), 'Setting up Claude Code');
});

test("a problem and the Try again or Skip for now question after it are one screen, which isn't counted as a question", () => {
  let page = play([
    [0, choose(1, 'team', 'Which team are you in?')],
    [5, { type: 'answered', question: 1, answer: 'a' }],
    [10, { type: 'problem', text: "Claude Code's sign-in said: that code wasn't accepted." }],
  ]);
  // Until the question comes, the problem is on screen alone.
  assert.equal(onScreen(page).kind, 'problem');
  page = reduce(page, {
    type: 'event',
    event: { id: 4, ...choose(2, 'claudeSignIn', "Claude Code isn't signed in yet."), options: [{ value: 'again', label: 'Try again', hint: 'a new link and code' }, { value: 'skip', label: 'Skip for now' }] },
    now: 11,
  });
  const joined = /** @type {any} */ (onScreen(page));
  assert.equal(joined.kind, 'question');
  assert.equal(joined.key, 3, 'the same screen as the problem, so it stays put');
  assert.equal(joined.problem, "Claude Code's sign-in said: that code wasn't accepted.");
  assert.equal(joined.question.key, 'claudeSignIn');
  assert.equal(joined.number, undefined);
  assert.equal(page.screens.length, 2);
});

const connectNotice = { type: 'notice', title: 'Connect these', text: "This opens claude.ai's Customize page, on Connectors.\n\nOnce you're done in the browser, come back to the Installer page." };
const connected = { type: 'question', question: 1, kind: 'done', what: "you've connected them" };

test('a notice and the Done after it are one screen, which stays until Done', () => {
  let page = play([
    [0, connectNotice],
    [3, connected],
  ]);
  const joined = /** @type {any} */ (at(page, 60 * 60_000));
  assert.equal(joined.kind, 'question');
  assert.equal(joined.key, 1);
  assert.deepEqual(joined.notice, { title: connectNotice.title, text: connectNotice.text });
  assert.equal(joined.question.what, "you've connected them");
  assert.equal(joined.number, undefined, 'Done is not one of the questions');
  // Continue isn't what moves it on: Done is.
  page = reduce(page, { type: 'continue', screen: 1, now: 60 * 60_000 });
  assert.equal(onScreen(page).kind, 'question');
  page = reduce(page, { type: 'event', event: { id: 3, type: 'answered', question: 1, answer: 'done' }, now: 61 * 60_000 });
  assert.equal(onScreen(page).kind, 'between');
});

test('a notice continued before its Done arrives comes back with the Done button', () => {
  let page = play([[0, connectNotice]]);
  page = reduce(page, { type: 'continue', screen: 1, now: 100 });
  assert.equal(onScreen(page).kind, 'between');
  page = reduce(page, { type: 'event', event: { id: 2, ...connected }, now: 400 });
  const back = /** @type {any} */ (onScreen(page));
  assert.equal(back.key, 1);
  assert.equal(back.question.kind, 'done');
});

/** The run's last calls, as installer/src/main.js and ending.js make them. @param {string} closing */
const theEnd = (closing, failed = /** @type {string[]} */ ([])) => [
  { type: 'summary', title: 'Skills', rows: [['jumpstart', 'Installed']] },
  { type: 'summary', title: 'Workspaces', rows: [['Thinking space', 'Created']] },
  { type: 'summary', title: 'Checklist', rows: [['Profile', 'York'], ['Claude Code', 'Already there, signed in as jo.bloggs@york.ac.uk']] },
  { type: 'step', text: 'Log: C:\Users\jo\AppData\Local\agent-jumpstart\logs\install-1.log' },
  { type: 'notice', title: 'What to do next', text: 'In T3 Code, open Claude, your top workspace, and start a new conversation there. Type /jumpstart and press Enter.' },
  ...failed.map((text) => ({ type: 'problem', text })),
  { type: 'finish', text: closing },
];

test('the ending is one screen, from the summaries to the last words, and it stays', () => {
  const page = play(
    [{ type: 'step', text: 'T3 Code installed' }, ...theEnd("One step didn't work: Connectors.", ['Connectors: Not checked'])].map((event) => /** @type {[number, any]} */ ([0, event])),
  );
  const ending = /** @type {any} */ (at(page, holds.step));
  assert.equal(ending.kind, 'ending');
  assert.deepEqual(ending.summaries.map((/** @type {any} */ summary) => summary.title), ['Skills', 'Workspaces', 'Checklist']);
  assert.equal(ending.log, 'C:\Users\jo\AppData\Local\agent-jumpstart\logs\install-1.log');
  assert.equal(ending.next.title, 'What to do next');
  assert.deepEqual(ending.problems, ['Connectors: Not checked']);
  assert.equal(ending.closing, "One step didn't work: Connectors.");
  assert.equal(page.screens.length, 2);
  assert.equal(at(page, 24 * 60 * 60_000).kind, 'ending', 'the ending stays on screen');
});

test("something the run asks once the ending has begun, such as opening T3 Code by hand, comes before the ending", () => {
  const [skills, workspaces, checklist, log, next, finish] = theEnd('All done.');
  let page = play([
    [0, skills],
    [0, workspaces],
    [0, checklist],
    [0, log],
    [5, { type: 'notice', title: 'Open T3 Code', text: 'Open T3 Code from the Start menu and wait for its window to appear.' }],
    [6, { ...connected, what: 'T3 Code is open' }],
  ]);
  const ask = /** @type {any} */ (onScreen(page));
  assert.equal(ask.notice.title, 'Open T3 Code');
  page = reduce(page, { type: 'event', event: { id: 7, type: 'answered', question: 1, answer: 'done' }, now: 30_000 });
  page = reduce(page, { type: 'event', event: { id: 8, ...next }, now: 30_001 });
  page = reduce(page, { type: 'event', event: { id: 9, ...finish }, now: 30_002 });
  const ending = /** @type {any} */ (onScreen(page));
  assert.equal(ending.kind, 'ending');
  assert.equal(ending.next.title, 'What to do next', "the ending's own notice joins it");
  assert.equal(ending.closing, 'All done.');
});

test("a problem nothing is asked about is the run's last screen, with what's said after it: a stop, or a failure", () => {
  const stopped = at(
    play([
      [0, { type: 'step', text: 'Using the Git already at C:\Program Files\Git' }],
      [5, { type: 'problem', text: 'Stopped at your request.' }],
      [5, { type: 'summary', title: 'Done before it stopped', rows: [['Settings', 'Your answers, saved for next time']] }],
      [5, { type: 'step', text: 'Running the same line again carries on from here, without asking your answers again.' }],
    ]),
    holds.step,
  );
  assert.equal(stopped.kind, 'problem');
  assert.deepEqual(/** @type {any} */ (stopped).problems, ['Stopped at your request.']);
  assert.deepEqual(/** @type {any} */ (stopped).summaries, [{ title: 'Done before it stopped', rows: [['Settings', 'Your answers, saved for next time']] }]);
  assert.deepEqual(/** @type {any} */ (stopped).lines, ['Running the same line again carries on from here, without asking your answers again.']);

  const failed = /** @type {any} */ (
    onScreen(
      play([
        [0, { type: 'problem', text: "Something went wrong that the Installer didn't expect: EISDIR: illegal operation on a directory." }],
        [0, { type: 'finish', text: 'The Installer has stopped. The log says more: C:\Users\jo\install.log' }],
      ]),
    )
  );
  assert.equal(failed.kind, 'problem');
  assert.equal(failed.closing, 'The Installer has stopped. The log says more: C:\Users\jo\install.log');
});

test("a run that ends early as the person chose ends on its last words", () => {
  const page = play([[0, { type: 'finish', text: 'Nothing was set up. Paste the line again whenever you like.' }]]);
  const ending = /** @type {any} */ (onScreen(page));
  assert.equal(ending.kind, 'ending');
  assert.equal(ending.closing, 'Nothing was set up. Paste the line again whenever you like.');
});

test('a page opened mid-run rebuilds what had happened without pausing on it, and opens on what the run is doing now', () => {
  /** @type {[number, Record<string, unknown>][]} */
  const history = [
    [0, { type: 'start', title: 'Agent Jumpstart · York' }],
    [0, { type: 'notice', title: 'Before you start', text: 'Read this first.' }],
    [0, choose(1, 'team', 'Which team are you in?')],
    [0, { type: 'answered', question: 1, answer: 'a' }],
    [0, { type: 'step', text: 'Settings written' }],
    [0, { type: 'busy', message: 'Installing Git' }],
    [0, { type: 'ended', busy: 6, text: 'Git installed', ok: true }],
    [0, { type: 'step', text: 'Using the GitHub CLI already there' }],
    [0, { type: 'busy', message: 'Installing the skills CLI' }],
  ];
  let page = play(history, { before: history.length });
  assert.equal(words(onScreen(page)), 'Installing the skills CLI', "a notice the person had already moved past isn't shown again");

  // What happens from now on is paced as usual.
  page = reduce(page, { type: 'event', event: { id: 10, type: 'ended', busy: 9, text: 'Skills CLI installed', ok: true }, now: 1000 });
  page = reduce(page, { type: 'event', event: { id: 11, type: 'step', text: 'Memory: switched off' }, now: 1001 });
  assert.equal(words(at(page, 1000 + holds.done - 1)), 'Skills CLI installed');
});

test('a page that had stopped at a step opens on that step, the last thing that happened', () => {
  const page = play(
    [
      [0, { type: 'step', text: 'Settings written' }],
      [0, { type: 'step', text: 'Using the GitHub CLI already there' }],
    ],
    { before: 2 },
  );
  assert.equal(words(onScreen(page)), 'Using the GitHub CLI already there');
});

test('an event sent again, as a reconnect does, changes nothing', () => {
  const once = play([
    [0, { type: 'step', text: 'Settings written' }],
    [5, { type: 'busy', message: 'Installing Git' }],
  ]);
  const twice = reduce(reduce(once, { type: 'connected', before: 2 }), { type: 'event', event: { id: 1, type: 'step', text: 'Settings written' }, now: 10 });
  assert.deepEqual(twice.screens, once.screens);
  assert.deepEqual(twice.events, once.events);
});

test('a page far behind the run catches up: a step or a finished busy line gets a shorter moment', () => {
  const steps = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((text) => /** @type {[number, any]} */ ([0, { type: 'step', text }]));
  let page = play(steps);
  assert.equal(wakeAt(page), holds.catchUp, `${steps.length - 1} waiting behind it`);
  page = later(page, holds.catchUp);
  assert.equal(words(onScreen(page)), 'Two');
  page = later(page, 2 * holds.catchUp);
  assert.equal(words(onScreen(page)), 'Three');
  // Close enough to the run again: the usual moment.
  assert.equal(wakeAt(page), 2 * holds.catchUp + holds.step);
});

test("what a program prints goes with the newest screen, and is never a screen of its own", () => {
  const page = play([
    [0, { type: 'notice', title: 'Sign in to GitHub', text: "GitHub's own tool signs you in next." }],
    [5, { type: 'output', text: '! First copy your one-time code: ABCD-1234\n' }],
    [6, { type: 'output', text: 'Press Enter to open github.com in your browser...\n' }],
  ]);
  assert.equal(page.screens.length, 1);
  assert.equal(onScreen(page).output, '! First copy your one-time code: ABCD-1234\nPress Enter to open github.com in your browser...\n');
});

test("the header's dashes: one per question, one per thing done, and the ending's, lit up to the screen that's showing", () => {
  let page = play([
    [0, choose(1, 'team', 'Which team are you in?')],
    [1, { type: 'answered', question: 1, answer: 'a' }],
    [2, choose(2, 'aiExperience', 'How much experience do you have using AI tools?')],
  ]);
  assert.deepEqual(dashes(page), { questions: ['done', 'now'], work: [], ending: 'to-come' });

  page = reduce(page, { type: 'event', event: { id: 4, type: 'answered', question: 2, answer: 'a' }, now: 3 });
  page = reduce(page, { type: 'event', event: { id: 5, type: 'busy', message: 'Installing Git' }, now: 4 });
  page = reduce(page, { type: 'event', event: { id: 6, type: 'ended', busy: 5, text: "Git didn't install", ok: false }, now: 5 });
  page = reduce(page, { type: 'event', event: { id: 7, type: 'step', text: 'Memory: switched off' }, now: 6 });
  assert.deepEqual(dashes(page), { questions: ['done', 'done'], work: ['warn', 'to-come'], ending: 'to-come' });
  page = later(page, 5 + holds.done);
  assert.deepEqual(dashes(page), { questions: ['done', 'done'], work: ['warn', 'now'], ending: 'to-come' });

  page = reduce(page, { type: 'event', event: { id: 8, type: 'finish', text: 'All done.' }, now: 10_000 });
  page = later(page, 20_000);
  assert.deepEqual(dashes(page), { questions: ['done', 'done'], work: ['warn', 'done'], ending: 'now' });
});
