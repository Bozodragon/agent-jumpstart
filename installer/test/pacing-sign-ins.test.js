// Seam 3: the sign-in screen on the Installer page (installer/page/pacing.js). The sign-in's
// notice and the sign-in are one screen: the explanation, the link, the code, the wait and the
// code box. It stays as long as the sign-in runs, whatever the person does, and goes once it has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { begin, dashes, holds, onScreen, reduce } from '../page/pacing.js';

/** @typedef {import('../page/pacing.js').Page} Page */

/**
 * A page that has connected to a run that had sent `before` events, then is sent `events`, each
 * at the time given with it.
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

/** What's on screen at `now`. @param {Page} page @param {number} now @returns {any} */
const at = (page, now) => onScreen(reduce(page, { type: 'tick', now }));

const notice = { type: 'notice', title: 'Sign in to Claude Code', text: 'Claude Code signs you in next, in your browser.' };
const link = { url: 'https://claude.com/cai/oauth/authorize?code=true&state=abc123', label: 'If no tab opens, use this link' };

test('the sign-in notice and the sign-in are one screen, with the link and the code box as they come, and it stays while the sign-in runs', () => {
  const page = play([
    [0, notice],
    [5, { type: 'signIn' }],
    [400, { type: 'signInShows', signIn: 2, link, codeBox: 7 }],
  ]);

  const shown = at(page, 30 * 60_000);
  assert.equal(shown.kind, 'signIn');
  assert.deepEqual(shown.notice, { title: notice.title, text: notice.text });
  assert.deepEqual(shown.link, link);
  assert.equal(shown.codeBox, 7);
  assert.equal(page.screens.length, 1, 'one screen, not a notice and then the sign-in');
  assert.equal(shown.key, 1, "its key is the notice's, so nothing changes as the sign-in joins it");
});

test("GitHub's code joins the screen too, and a code pasted shows as sent, or the reason it wasn't taken", () => {
  let page = play([
    [0, notice],
    [5, { type: 'signIn' }],
    [10, { type: 'signInShows', signIn: 2, code: '3A4B-7C8D' }],
    [11, { type: 'signInShows', signIn: 2, link, codeBox: 9 }],
    [20, { type: 'refused', question: 9, reason: "That isn't the whole code." }],
  ]);
  assert.equal(at(page, 30).code, '3A4B-7C8D');
  assert.deepEqual(at(page, 30).link, link, 'what a later show adds joins what was there');
  assert.equal(at(page, 30).refused, "That isn't the whole code.");
  assert.equal(at(page, 30).sent, undefined);

  page = reduce(page, { type: 'event', event: { id: 6, type: 'answered', question: 9, answer: 'sent' }, now: 40 });
  assert.equal(at(page, 50).sent, true);
  assert.equal(at(page, 50).refused, undefined);
  assert.equal(at(page, 50).kind, 'signIn', 'a code sent is still waited on: the sign-in decides');
});

test('the sign-in screen goes as soon as its program has finished, and what comes next follows', () => {
  const timed = /** @type {[number, Record<string, unknown>][]} */ ([
    [0, notice],
    [5, { type: 'signIn' }],
    [400, { type: 'signInShows', signIn: 2, link, codeBox: 7 }],
    [9000, { type: 'signInEnded', signIn: 2 }],
    [9010, { type: 'busy', message: 'Checking Claude Code' }],
  ]);
  assert.equal(at(play(timed.slice(0, 3)), 8999).kind, 'signIn', 'not before it has ended');
  const page = play(timed);
  assert.equal(at(page, 9020).message, 'Checking Claude Code');
  assert.deepEqual(dashes(reduce(page, { type: 'tick', now: 9020 })).work, ['done', 'now']);
});

test('a notice not followed by a sign-in is still a notice of its own', () => {
  const page = play([
    [0, notice],
    [5, { type: 'busy', message: 'Checking Claude Code' }],
  ]);
  assert.equal(at(page, holds.step * 10).kind, 'notice');
});

test('a page opened after a sign-in is over goes straight past it', () => {
  const history = [
    [0, notice],
    [0, { type: 'signIn' }],
    [0, { type: 'signInShows', signIn: 2, link, codeBox: 7 }],
    [0, { type: 'signInEnded', signIn: 2 }],
    [0, { type: 'busy', message: 'Checking Claude Code' }],
  ];
  const page = play(/** @type {any} */ (history), { before: history.length });
  assert.equal(at(page, 1).message, 'Checking Claude Code');
});
