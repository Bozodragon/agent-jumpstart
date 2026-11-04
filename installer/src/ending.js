// The Installer's ending, after the checklist: what to do next, every step that didn't work
// repeated with why (so it can't have scrolled out of sight during the run), and one closing
// line, either "All done." or the steps that didn't work.
//
// The ending is a plain structure the run fills in as it goes. A step whose row says it didn't
// work is noted by `note`; a step that knows better (Claude's sign-in, skipped) can add its own
// failure and lines, give its own closing line, and say T3 Code isn't to be opened.
import * as ui from './ui.js';

/** @typedef {{ step: string, message: string }} Failure A step that didn't work, and why, as its row says. */

/**
 * @typedef {object} Ending
 * @property {Failure[]} failed Each step that didn't work, in the order the run met them.
 * @property {string[]} lines More lines repeated with them, such as a program's own reason in its
 *   own words.
 * @property {string} [closing] The closing line, in place of the one made from `failed`. When
 *   it's given, it says what to do about them, so the ending doesn't add its own.
 * @property {boolean} sayDone Whether the closing line may say all done, which it does only when
 *   nothing failed.
 * @property {boolean} openT3 Whether T3 Code may be opened at the end.
 */

/** @returns {Ending} */
export function newEnding() {
  return { failed: [], lines: [], sayDone: true, openT3: true };
}

/**
 * Whether a checklist value says its step didn't work. Skipped, left as it is, already there and
 * not opened yet (the ending opens T3 Code) all worked.
 * @param {string} value
 */
export function didntWork(value) {
  return /^(Not installed|Not checked|Not signed in|Not switched off|Not created|Partly off)\b/.test(value) || /, not (signed in$|in T3 Code\b)/.test(value);
}

/**
 * Notes each of a step's rows that says it didn't work.
 * @param {Ending} ending
 * @param {[string, string][]} rows
 * @param {string} [step] The step's name, when the rows are named for its parts (each skill,
 *   each workspace); otherwise each row's label is its step.
 */
export function note(ending, rows, step) {
  for (const [label, value] of rows) {
    if (!didntWork(value)) continue;
    ending.failed.push(step === undefined ? { step: label, message: value } : { step, message: `${label}: ${value}` });
  }
}

/**
 * The ending's last line.
 * @param {Ending} ending
 */
export function closingLine(ending) {
  if (ending.closing !== undefined) return ending.closing;
  const steps = [...new Set(ending.failed.map(({ step }) => step))];
  if (steps.length === 1) return `One step didn't work: ${steps[0]}.`;
  if (steps.length > 1) return `These steps didn't work: ${ui.inWords(steps)}.`;
  return ending.sayDone ? 'All done.' : 'Finished.';
}

/** The steps Jumpstart needs, in T3 Code, in the top workspace. */
const neededForJumpstart = ['Claude Code', 'T3 Code', 'Workspaces'];

/**
 * Shows the ending: what to do next, the failures repeated, and the closing line.
 * @param {Ending} ending
 * @param {{ top: string, t3Installed: boolean, log: import('./log.js').Log }} how `top` is the
 *   top workspace's name, as T3 Code lists it.
 */
export function showEnding(ending, { top, t3Installed, log }) {
  /** @type {string[]} */
  const next = [];
  if (t3Installed && !ending.failed.some(({ step }) => neededForJumpstart.includes(step))) {
    next.push(`In T3 Code, open ${top}, your top workspace, and start a new conversation there. Type /jumpstart and press Enter.`);
  }
  if (ending.failed.length > 0 && ending.closing === undefined) {
    next.push("Paste the same line again to try again what didn't work. It skips everything that's already done.");
  }
  if (next.length > 0) ui.notice(next.join('\n\n'), 'What to do next');
  for (const { step, message } of ending.failed) {
    ui.problem(`${step}: ${message}`);
    log.write(`Ending: didn't work: ${step}: ${message}`);
  }
  for (const line of ending.lines) {
    ui.problem(line);
    log.write(`Ending: ${line}`);
  }
  const closing = closingLine(ending);
  log.write(`Ending: ${closing}`);
  ui.finish(closing);
}
