// Seam 3: how the Installer page lays out the run's words (installer/page/words.js). The run
// words things for both front ends, so the page splits a two-sentence question into a heading
// and a line under it, a notice into paragraphs and bullets, and finds the links and paths in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, pieces, split } from '../page/words.js';

test("a question's first sentence is the heading and the rest goes under it; one sentence is all heading", () => {
  assert.deepEqual(split('Is this your Google Drive folder? If not, type the right one.'), ['Is this your Google Drive folder?', 'If not, type the right one.']);
  assert.deepEqual(split("Where's your top workspace? Your other workspaces go inside it."), ["Where's your top workspace?", 'Your other workspaces go inside it.']);
  assert.deepEqual(split('How much experience do you have using AI tools like ChatGPT, Claude, or Gemini?'), [
    'How much experience do you have using AI tools like ChatGPT, Claude, or Gemini?',
    '',
  ]);
  assert.deepEqual(split('Installing T3 Code. This takes about a minute.'), ['Installing T3 Code.', 'This takes about a minute.']);
  // A path's dots aren't the end of a sentence.
  assert.deepEqual(split('Using the Git already at C:\\Program Files\\Git'), ['Using the Git already at C:\\Program Files\\Git', '']);
});

test("a notice's lines are paragraphs, and its bullet lines a list", () => {
  const text = [
    'Claude Code signs you in next, in your browser.',
    '',
    '  • A browser window opens at Claude\'s sign-in page. Sign in there.',
    '  • If the page shows a code, copy it.',
    '',
    'Click Install in Software Center.',
    'Once you\'re done in Software Center, come back to the Installer page.',
  ].join('\n');
  assert.deepEqual(blocks(text), [
    { paragraph: 'Claude Code signs you in next, in your browser.' },
    { list: ["A browser window opens at Claude's sign-in page. Sign in there.", 'If the page shows a code, copy it.'] },
    { paragraph: 'Click Install in Software Center.' },
    { paragraph: "Once you're done in Software Center, come back to the Installer page." },
  ]);
});

test('a link in the words can be clicked, and a Windows path at the end of a line is set apart, without the full stop after it', () => {
  assert.deepEqual(pieces('Open https://script.google.com/home/usersettings, then switch it on.'), [
    { text: 'Open ' },
    { url: 'https://script.google.com/home/usersettings' },
    { text: ', then switch it on.' },
  ]);
  assert.deepEqual(pieces('The Installer has stopped. The log says more: C:\\Users\\jo\\AppData\\Local\\agent-jumpstart\\logs\\install.log'), [
    { text: 'The Installer has stopped. The log says more: ' },
    { path: 'C:\\Users\\jo\\AppData\\Local\\agent-jumpstart\\logs\\install.log' },
  ]);
  assert.deepEqual(pieces('There is no folder at G:\\Not My Drive.'), [{ text: 'There is no folder at ' }, { path: 'G:\\Not My Drive' }, { text: '.' }]);
  assert.deepEqual(pieces('All done.'), [{ text: 'All done.' }]);
});

test("a problem's own words after a colon go under its heading, so the heading stays short", () => {
  assert.deepEqual(split("Something went wrong that the Installer didn't expect: EISDIR: illegal operation on a directory.", { atColon: true }), [
    "Something went wrong that the Installer didn't expect",
    'EISDIR: illegal operation on a directory.',
  ]);
  assert.deepEqual(split('Stopped at your request.', { atColon: true }), ['Stopped at your request.', '']);
  // Without it, a colon is part of the heading.
  assert.deepEqual(split("Claude Code's sign-in said: that code wasn't accepted."), ["Claude Code's sign-in said: that code wasn't accepted.", '']);
});

test('quotes after a path are not part of it', () => {
  assert.deepEqual(pieces("illegal operation on a directory, open 'C:\\Users\\sam\\settings.json'"), [
    { text: "illegal operation on a directory, open '" },
    { path: 'C:\\Users\\sam\\settings.json' },
    { text: "'" },
  ]);
});
