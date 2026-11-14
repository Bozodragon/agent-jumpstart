// Seam 3: going back on the Installer page, and its Details panel (installer/page/details.js, with
// pacing.js). The run says which questions may be gone back to (a question's `back`), when it has
// gone back (`back`), and when Back and Change are gone (`fixed`); the page works out the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answers, backTo, setUp } from '../page/details.js';
import { dashes, onScreen } from '../page/pacing.js';
import { play } from './pacing-play.js';

const options = {
  team: [
    { value: 'Marketing', label: 'Marketing' },
    { value: 'Another team', label: 'Another team' },
  ],
  aiExperience: [
    { value: 'first-time', label: 'This is my first time' },
    { value: 'confident', label: "I'm pretty confident" },
  ],
  connectors: [
    { value: 'Gmail', label: 'Gmail' },
    { value: 'Asana', label: 'Asana' },
    { value: 'Google Drive', label: 'Google Drive' },
  ],
};

/** The questions of a first run, as the run sends them while Back lasts. */
const team = { type: 'question', question: 1, kind: 'choose', key: 'team', message: 'Which team are you in?', options: options.team, initial: 'Another team', back: true };
const ai = { type: 'question', question: 2, kind: 'choose', key: 'aiExperience', message: 'How much experience do you have using AI tools?', options: options.aiExperience, initial: 'first-time', back: true };
const github = { type: 'question', question: 3, kind: 'confirm', key: 'github', message: 'Set up GitHub now? You can change this on a later run.', initial: false, back: true };
const folder = { type: 'question', question: 4, kind: 'folder', key: 'googleDriveFolder', message: 'Is this your Google Drive folder?', initial: 'G:\\My Drive', back: true };
const connectors = { type: 'question', question: 5, kind: 'pick', key: 'connectors', message: 'Which connectors?', options: options.connectors, initial: ['Gmail'], back: true };

/** @param {number} question @param {unknown} answer */
const answered = (question, answer) => ({ type: 'answered', question, answer });

test('going back takes off the question gone back to and everything after it, so what is asked again is numbered from there and comes in as going back', () => {
  const page = play([
    { type: 'start', title: 'Agent Jumpstart · York' },
    team,
    answered(1, 'Marketing'),
    ai,
    answered(2, 'confident'),
    { type: 'step', text: "GitHub: you're already signed in with GitHub's own tool, so GitHub is set up without asking." },
    connectors,
    { type: 'back', to: 2 },
    { ...ai, question: 6, initial: 'confident' },
  ]);

  const shown = /** @type {import('../page/pacing.js').QuestionScreen} */ (onScreen(page));
  assert.equal(shown.kind, 'question');
  assert.equal(shown.question.question, 6);
  assert.equal(shown.number, 2);
  assert.equal(shown.again, true);
  assert.deepEqual(
    page.screens.map((screen) => (screen.kind === 'question' ? screen.question.question : screen.kind)),
    [1, 6],
  );
  assert.deepEqual(dashes(page).questions, ['done', 'now']);
});

test("the panel lists the answers given so far in the person's words, the one on screen as being answered, each with Change while Back lasts", () => {
  const events = [
    { type: 'start', title: 'Agent Jumpstart · York' },
    team,
    answered(1, 'Marketing'),
    ai,
    answered(2, 'confident'),
    github,
    answered(3, false),
    folder,
    answered(4, 'G:\\My Drive'),
    connectors,
    answered(5, ['Gmail', 'Google Drive']),
    { ...connectors, question: 7, key: 'extraTools', message: 'Anything extra?', options: [{ value: 'azure', label: 'The Azure CLI' }], initial: [] },
  ];

  assert.deepEqual(answers(play(events)), [
    { question: 1, label: 'Team', value: 'Marketing', now: false, change: true },
    { question: 2, label: 'AI tools', value: "I'm pretty confident", now: false, change: true },
    { question: 3, label: 'GitHub', value: 'No', now: false, change: true },
    { question: 4, label: 'Google Drive folder', value: 'G:\\My Drive', now: false, change: true },
    { question: 5, label: 'Connectors', value: 'Gmail and Google Drive', now: false, change: true },
    { question: 7, label: 'Extra tools', value: '', now: true, change: false },
  ]);

  // Once the run says Back and Change are gone, the answers stay, fixed.
  const fixed = answers(play([...events, answered(7, []), { type: 'fixed' }, { type: 'step', text: 'Installing Git' }]));
  assert.deepEqual(fixed.at(-1), { question: 7, label: 'Extra tools', value: 'None', now: false, change: false });
  assert.ok(fixed.every((answer) => !answer.change));
});

test("Back goes to the question before the one on screen, while Back lasts, and only to one the run said may be gone back to", () => {
  const two = play([team, answered(1, 'Marketing'), ai]);
  assert.equal(backTo(two, onScreen(two)), 1);
  // The first question has nothing before it.
  const one = play([team]);
  assert.equal(backTo(one, onScreen(one)), undefined);
  // Back is gone once the run says so, and from a question asked after it (connecting the connectors).
  const fixed = play([team, answered(1, 'Marketing'), { type: 'fixed' }, { ...ai, back: undefined }]);
  assert.equal(backTo(fixed, onScreen(fixed)), undefined);
  // A problem's Try again or Skip for now is never gone back from.
  const problem = play([team, answered(1, 'Marketing'), { type: 'problem', text: 'Claude Code: the download failed.' }, { ...ai, key: 'claudeRetry' }]);
  assert.equal(backTo(problem, onScreen(problem)), undefined);
});

test("the panel's other half is what's been set up so far, as it happens, and then the checklist, with how many of its rows worked", () => {
  const working = play([
    team,
    answered(1, 'Marketing'),
    { type: 'fixed' },
    { type: 'busy', message: 'Installing Git' },
    { type: 'ended', busy: 4, text: 'Git is installed', ok: true },
    { type: 'busy', message: 'Installing the GitHub CLI' },
    { type: 'ended', busy: 6, text: "The GitHub CLI couldn't be installed", ok: false },
    { type: 'step', text: 'Memory: switched off' },
    { type: 'busy', message: 'Installing T3 Code' },
  ]);
  assert.deepEqual(setUp(working), {
    rows: [
      { label: 'Git is installed', state: 'done' },
      { label: "The GitHub CLI couldn't be installed", state: 'bad' },
      { label: 'Memory: switched off', state: 'done' },
      { label: 'Installing T3 Code', state: 'now' },
    ],
  });

  const ended = play([
    { type: 'summary', title: 'Checklist', rows: [['Profile', 'York'], ['Git', 'Installed 2.56'], ['GitHub', 'Not set up']] },
    { type: 'problem', text: 'GitHub: the sign-in was skipped.' },
    { type: 'finish', text: 'Nearly done.' },
  ]);
  assert.deepEqual(setUp(ended), {
    rows: [
      { label: 'Profile', value: 'York', state: 'done' },
      { label: 'Git', value: 'Installed 2.56', state: 'done' },
      { label: 'GitHub', value: 'Not set up', state: 'bad' },
    ],
    of: 3,
    worked: 2,
  });
});

test("Change is offered only while the run waits at a question, which it goes back from, and every question has a name", () => {
  // Between questions (looking for My Drive), there's no question to go back from.
  const between = play([team, answered(1, 'Marketing'), { type: 'busy', message: 'Looking for My Drive' }]);
  assert.deepEqual(answers(between).map((answer) => answer.change), [false]);
  const asking = play([team, answered(1, 'Marketing'), { type: 'busy', message: 'Looking for My Drive' }, { type: 'ended', busy: 3, text: 'Looked for My Drive', ok: false }, folder]);
  assert.deepEqual(answers(asking).map((answer) => answer.change), [true, false]);

  const drive = play([{ type: 'question', question: 1, kind: 'choose', key: 'withoutGoogleDrive', message: 'Use Documents?', options: [{ value: 'documents', label: 'Use Documents' }], initial: 'documents', back: true }]);
  assert.equal(answers(drive)[0].label, 'Google Drive');
});

test('once the run is stopping, the questions left open offer neither Back nor Change, and a sign-in is never gone back from', () => {
  const stopped = play([team, answered(1, 'Marketing'), ai, { type: 'stopping' }]);
  assert.deepEqual(answers(stopped).map((answer) => answer.change), [false, false]);
  const question = /** @type {import('../page/pacing.js').Shown} */ (stopped.screens.find((screen) => screen.kind === 'question' && screen.question.question === 2));
  assert.equal(backTo(stopped, question), undefined);

  // A sign-in comes after the answers are fixed; its screen is never a question to go back from.
  const signingIn = play([team, answered(1, 'Marketing'), { type: 'fixed' }, { type: 'signIn' }, { type: 'signInShows', signIn: 4, codeBox: 5 }]);
  assert.equal(onScreen(signingIn).kind, 'signIn');
  assert.equal(backTo(signingIn, onScreen(signingIn)), undefined);
  assert.deepEqual(answers(signingIn).map((answer) => answer.change), [false]);
});
