// Going back on the Installer page, and what its Details panel lists. Plain JavaScript, no React,
// so it's tested on its own (installer/test/details.test.js, seam 3).
//
// The run says which questions may be gone back to (a question's `back`), and when Back and
// Change are gone for good (`fixed`: the questions are over, or something has acted on the
// answers). Going back is the run's to do: the page asks it to (`postBack`), and the run sends
// `back`, which pacing.js reads.

import { inWordsOrNone } from '../src/text.js';
import { checklistOf, failedIn } from './pacing.js';

/** @typedef {import('./pacing.js').Page} Page */
/** @typedef {import('./pacing.js').Shown} Shown */
/** @typedef {import('./pacing.js').QuestionScreen} QuestionScreen */

/** What each question is called in the panel, by its key. */
const labels = /** @type {Record<string, string>} */ ({
  change: 'To change',
  team: 'Team',
  aiExperience: 'AI tools',
  codingExperience: 'Writing code',
  topWorkspace: 'Top workspace',
  googleDriveFolder: 'Google Drive folder',
  workspacesLocation: 'Workspaces folder',
  softwareCenter: 'Google Drive',
  googleDriveReady: 'Google Drive',
  withoutGoogleDrive: 'Google Drive',
  channel: 'T3 Code',
  github: 'GitHub',
  workspaces: 'Workspaces',
  connectors: 'Connectors',
  extraTools: 'Extra tools',
  fullSkills: 'Skills',
  switchOffMemory: "Claude's memory",
});

/**
 * Whether Back and Change still last: the run hasn't said they're gone, nor that it's stopping
 * (after which no question is waiting to go back from).
 * @param {Page} page
 */
export const backLasts = (page) => !page.events.some((event) => event.type === 'fixed' || event.type === 'stopping');

/**
 * An answer in the person's words: the option chosen or ticked, Yes or No, or the folder.
 * @param {import('./pacing.js').Asked} question @param {unknown} value
 */
function inWords(question, value) {
  /** @param {unknown} chosen */
  const labelOf = (chosen) => question.options?.find((option) => option.value === chosen)?.label ?? String(chosen);
  if (question.kind === 'confirm') return value ? 'Yes' : 'No';
  if (question.kind === 'pick') return inWordsOrNone((Array.isArray(value) ? value : []).map(labelOf));
  if (question.kind === 'choose') return labelOf(value);
  return String(value);
}

/**
 * @typedef {object} Answer A row of "Your answers".
 * @property {number} question The question's id, which going back names.
 * @property {string} label What the question is called.
 * @property {string} value The answer, in the person's words; empty while it's being answered.
 * @property {boolean} now Whether it's the question being answered.
 * @property {boolean} change Whether it can be changed: gone back to.
 */

/**
 * The answers given so far on this page, the question being answered last: one row per question
 * of the setup's (numbered, as on its screen), each with Change while Back lasts and the run is
 * waiting at a question it can go back from (between questions, it couldn't).
 * @param {Page} page
 * @returns {Answer[]}
 */
export function answers(page) {
  const waiting = page.screens.some((screen) => screen.kind === 'question' && screen.answer === undefined && screen.question.back === true);
  const lasts = backLasts(page) && waiting;
  return page.screens
    .filter((screen) => screen.kind === 'question' && screen.number !== undefined)
    .map((screen) => {
      const { question, answer } = /** @type {QuestionScreen} */ (screen);
      return {
        question: question.question,
        label: labels[question.key ?? ''] ?? question.key ?? '',
        value: answer === undefined ? '' : inWords(question, answer.value),
        now: answer === undefined,
        change: lasts && question.back === true && answer !== undefined,
      };
    });
}

/**
 * Which question Back on the screen shown goes to: the setup's question before it, if the run
 * said it may be gone back to and Back still lasts. None for anything but a setup question.
 * @param {Page} page @param {Shown} shown
 * @returns {number | undefined}
 */
export function backTo(page, shown) {
  if (shown.kind !== 'question' || shown.number === undefined || shown.problem !== undefined || !shown.question.back || !backLasts(page)) return undefined;
  const at = page.screens.findIndex((screen) => screen.key === shown.key);
  const before = page.screens
    .slice(0, Math.max(at, 0))
    .findLast((screen) => screen.kind === 'question' && screen.number !== undefined);
  const question = /** @type {QuestionScreen | undefined} */ (before);
  return question?.question.back && question.answer !== undefined ? question.question.question : undefined;
}

/**
 * @typedef {object} SetUp The panel's "Set up on this laptop".
 * @property {{ label: string, value?: string, state: 'done' | 'now' | 'bad' }[]} rows What's been
 *   done since the answers were fixed, as it happens; at the end, the checklist's rows.
 * @property {number} [of] How many rows the checklist has, once the run has sent it: until then,
 *   nobody knows how many there will be.
 * @property {number} [worked] How many of them worked.
 */

/**
 * What's been set up on this laptop: each step and busy line since the answers were fixed, as
 * the run goes; then the checklist, each row marked as the ending marks it (see screens.js).
 * @param {Page} page
 * @returns {SetUp}
 */
export function setUp(page) {
  const last = page.screens.find((screen) => screen.kind === 'ending' || screen.kind === 'problem');
  const end = last?.kind === 'ending' || last?.kind === 'problem' ? last : undefined;
  const checklist = end && checklistOf(end);
  if (end && checklist) {
    const rows = checklist.rows.map(([label, value]) => ({
      label,
      value,
      state: /** @type {'done' | 'bad'} */ (failedIn(end, label) ? 'bad' : 'done'),
    }));
    return { rows, of: rows.length, worked: rows.filter((row) => row.state === 'done').length };
  }
  const fixed = page.events.find((event) => event.type === 'fixed')?.id;
  if (fixed === undefined) return { rows: [] };
  /** @type {SetUp['rows']} */
  const rows = [];
  for (const screen of page.screens) {
    if (screen.key < fixed) continue;
    if (screen.kind === 'step') rows.push({ label: screen.text, state: 'done' });
    else if (screen.kind === 'busy') {
      if (!screen.ended) rows.push({ label: screen.message, state: 'now' });
      else rows.push({ label: screen.ended.text, state: screen.ended.ok === false ? 'bad' : 'done' });
    }
  }
  return { rows };
}
