// Seam 3: what the Installer page shows once the run is stopping (installer/page/pacing.js). After
// Stop, nothing before it is waited on any more: the stop screen comes straight away, not after
// an answer, a Continue, or a step's moment on screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { begin, onScreen, reduce } from '../page/pacing.js';

/**
 * A page sent `events`, each at the time given with it; ids are numbered from 1.
 * @param {[number, Record<string, unknown>][]} timed
 */
function play(timed) {
  let page = reduce(begin, { type: 'connected', before: 0 });
  timed.forEach(([now, event], index) => {
    page = reduce(page, { type: 'event', event: /** @type {any} */ ({ id: index + 1, ...event }), now });
  });
  return page;
}

/** What a stop sends after `stopping`, as main.js says it. */
const stopScreen = [
  { type: 'problem', text: 'Stopped at your request.' },
  { type: 'summary', title: 'Done before it stopped', rows: [['Settings', 'Your answers, saved for next time']] },
  { type: 'step', text: 'Running the same line again carries on from here, without asking your answers again.' },
];

test('Stop at a question: the question, never answered, gives way to the stop screen at once', () => {
  const page = play([
    [0, { type: 'notice', title: 'Connect your connectors', text: 'Open the connectors page.' }],
    [0, { type: 'question', question: 7, kind: 'done', what: "you've connected them" }],
    [5000, { type: 'stopping' }],
    ...stopScreen.map((event) => /** @type {[number, Record<string, unknown>]} */ ([5010, event])),
  ]);

  const shown = /** @type {any} */ (onScreen(page));
  assert.equal(shown.kind, 'problem');
  assert.deepEqual(shown.problems, ['Stopped at your request.']);
  assert.deepEqual(shown.summaries.map((/** @type {{ title: string }} */ summary) => summary.title), ['Done before it stopped']);
});

test('Stop while a notice waits for Continue and a step is under way behind it: the stop screen comes without a Continue or a moment for the step', () => {
  const page = play([
    [0, { type: 'notice', title: 'Google Drive', text: "Google Drive isn't on this laptop." }],
    [10, { type: 'busy', message: 'Installing 16 skills from mattpocock/skills' }],
    [3000, { type: 'stopping' }],
    [3005, { type: 'ended', busy: 2, text: 'Installing 16 skills from mattpocock/skills' }],
    ...stopScreen.map((event) => /** @type {[number, Record<string, unknown>]} */ ([3010, event])),
  ]);

  assert.equal(onScreen(page).kind, 'problem');
});

test('before the stop screen arrives, the page shows it is waiting on the run, not the question it was on', () => {
  const page = play([
    [0, { type: 'question', question: 1, kind: 'confirm', key: 'github', message: 'Set up GitHub?', initial: true }],
    [4000, { type: 'stopping' }],
  ]);

  assert.equal(onScreen(page).kind, 'between');
});
