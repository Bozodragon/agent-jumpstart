// The Installer's ending, after the checklist: what to do next, every step that didn't work
// repeated with why (so it can't have scrolled out of sight during the run), and the closing
// line, either "All done." or the steps that didn't work.
//
// The ending is a plain structure the run fills in as it goes. A step whose row says it didn't
// work is noted by `note`; a step that knows better (Claude's sign-in, skipped) can add its own
// failure and lines, give its own closing line (with any other step that didn't work named on a
// line after it), and say T3 Code isn't to be opened.
import { inWords } from './text.js';

/** @typedef {{ step: string, message: string }} Failure A step that didn't work, and why, as its row says. */

/**
 * @typedef {object} Ending
 * @property {Failure[]} failed Each step that didn't work, in the order the run met them.
 * @property {string[]} lines More lines repeated with them, such as a program's own reason in its
 *   own words.
 * @property {{ step: string, line: string }} [closing] A step's own closing line, in place of the
 *   one made from `failed`. It says what to do, so the ending doesn't add its own; any other step
 *   that didn't work is named on one line after it.
 * @property {boolean} openT3 Whether T3 Code may be opened at the end.
 */

/** @returns {Ending} */
export function newEnding() {
  return { failed: [], lines: [], openT3: true };
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
 * The ending's closing line, or a step's own closing line and then the other steps that didn't work.
 * @param {Ending} ending
 * @returns {string[]}
 */
export function closingLines(ending) {
  const steps = [...new Set(ending.failed.map(({ step }) => step))];
  const { closing } = ending;
  if (closing !== undefined) {
    const others = steps.filter((step) => step !== closing.step);
    if (others.length === 1) return [closing.line, `One more step didn't work: ${others[0]}.`];
    if (others.length > 1) return [closing.line, `These steps didn't work either: ${inWords(others)}.`];
    return [closing.line];
  }
  return [closingLine(steps)];
}

/** @param {string[]} steps */
function closingLine(steps) {
  if (steps.length === 1) return `One step didn't work: ${steps[0]}.`;
  if (steps.length > 1) return `These steps didn't work: ${inWords(steps)}.`;
  return 'All done.';
}

/**
 * The steps Jumpstart needs, in T3 Code, in the top workspace.
 * @param {ToolNames} tools
 */
const neededForJumpstart = (tools) => [tools.claude, tools.t3, 'Workspaces'];

/** @typedef {{ claude: string, t3: string }} ToolNames Claude Code's and T3 Code's names, as their manifest entries give them. */

/**
 * Shows the ending: what to do next, the failures repeated, and the closing line.
 * @param {Ending} ending
 * @param {{ top: string, t3Installed: boolean, tools: ToolNames, log: import('./log.js').Log, frontEnd: import('./front-end.js').FrontEnd }} how
 *   `top` is the top workspace's name, as T3 Code lists it; `tools` names the steps for Claude
 *   Code and T3 Code, as the checklist does.
 */
export function showEnding(ending, { top, t3Installed, tools, log, frontEnd }) {
  /** @type {string[]} */
  const next = [];
  if (t3Installed && !ending.failed.some(({ step }) => neededForJumpstart(tools).includes(step))) {
    next.push(`In T3 Code, open ${top}, your top workspace, and start a new conversation there. Type /jumpstart and press Enter.`);
  }
  if (ending.failed.length > 0 && ending.closing === undefined) {
    next.push("Paste the same line again to try again what didn't work. It skips everything that's already done.");
  }
  if (next.length > 0) frontEnd.notice(next.join('\n\n'), 'What to do next');
  for (const { step, message } of ending.failed) {
    frontEnd.problem(`${step}: ${message}`);
    log.write(`Ending: didn't work: ${step}: ${message}`);
  }
  for (const line of ending.lines) {
    frontEnd.problem(line);
    log.write(`Ending: ${line}`);
  }
  const closing = closingLines(ending);
  for (const line of closing) log.write(`Ending: ${line}`);
  frontEnd.finish(closing.join('\n'));
}
