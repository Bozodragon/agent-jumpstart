// What the person sees. The shape (a guide line, short steps, a closing
// summary) follows the skills CLI's; the colours and symbols are our own.
import { confirm, intro, isCancel, log, multiselect, note, outro, select, spinner, text, unicodeOr } from '@clack/prompts';
import { styleText } from 'node:util';
import { Stop } from './stop.js';

const accent = 'magenta';

/**
 * @template T
 * @param {T} value
 * @returns {Exclude<T, symbol>}
 */
function unlessCancelled(value) {
  if (isCancel(value)) throw new Stop('Stopped at your request.');
  return /** @type {Exclude<T, symbol>} */ (value);
}

/**
 * Asks the person at the screen. Each prompt starts on its default, so Enter
 * accepts it.
 * @type {import('./questions.js').Asker}
 */
export const ask = {
  async folder({ message, initial, placeholder, validate }) {
    const value = unlessCancelled(
      await text({ message, initialValue: initial, placeholder, validate: (value) => validate(value?.trim() ?? '') }),
    );
    return value.trim();
  },
  async choose({ message, options, initial }) {
    return unlessCancelled(await select({ message, options: /** @type {any} */ (options), initialValue: initial }));
  },
  async confirm({ message, initial }) {
    return unlessCancelled(await confirm({ message, initialValue: initial }));
  },
  async pick({ message, options, initial }) {
    return unlessCancelled(
      await multiselect({ message, options: /** @type {any} */ (options), initialValues: initial, required: false }),
    );
  },
};

/** @param {string} title */
export function start(title) {
  intro(styleText(['bold', accent], `${unicodeOr('◈', '*')} ${title}`));
}

/** @param {string} text */
export function step(text) {
  log.message(text, { symbol: styleText(accent, unicodeOr('▸', '>')) });
}

/**
 * Shows a spinner, with the time so far, beside the message while something slow that prints
 * nothing runs (a download, a silent install), then puts how it ended in its place. Nothing
 * else may be shown while it runs. Where the output isn't a terminal (a test) there's no
 * spinner, which would fill it with cursor movements: the message is a step, as any other.
 * @template T
 * @param {string} message
 * @param {() => Promise<T>} task
 * @param {(result: T) => { text: string, ok: boolean }} [ended] How it ended; the message, if not given.
 * @returns {Promise<T>}
 */
export async function busy(message, task, ended) {
  if (!process.stdout.isTTY) {
    step(message);
    return task();
  }
  // Ctrl+C stops the run, as it does without a spinner, which otherwise catches it.
  const spin = spinner({ indicator: 'timer', onCancel: () => process.exit(130) });
  spin.start(message);
  let result;
  try {
    result = await task();
  } catch (error) {
    spin.error(message);
    throw error;
  }
  const { text, ok } = ended?.(result) ?? { text: message, ok: true };
  if (ok) spin.stop(text);
  else spin.error(text);
  return result;
}

/** @param {string} text */
export function problem(text) {
  log.message(text, { symbol: styleText('red', unicodeOr('✖', 'x')) });
}

/** @param {[string, string][]} rows @param {string} title */
export function summary(rows, title) {
  const width = Math.max(...rows.map(([label]) => label.length));
  note(rows.map(([label, value]) => `${styleText('bold', label.padEnd(width))}  ${value}`).join('\n'), title);
}

export const bullet = unicodeOr('•', '-');

/**
 * Said beside every page the installer opens: the browser takes the focus, and the person has to
 * find their way back to the window that's waiting for them.
 */
export const comeBack = "Once you're done in the browser, come back to this window (the blue PowerShell window) and press Enter.";

/** @param {string} text @param {string} title */
export function notice(text, title) {
  note(text, title);
}

/**
 * Waits for the person to press Enter. A single choice, so there is nothing to
 * type and nothing to get wrong.
 * @param {string} message
 */
export async function pressEnter(message) {
  unlessCancelled(await select({ message, options: [{ value: 'done', label: 'Done' }] }));
}

/** @param {string} text */
export function finish(text) {
  outro(styleText(accent, text));
}
