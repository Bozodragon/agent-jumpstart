// What the person sees. The shape (a guide line, short steps, a closing
// summary) follows the skills CLI's; the colours and symbols are our own.
import { confirm, intro, isCancel, log, multiselect, note, outro, select, text, unicodeOr } from '@clack/prompts';
import { styleText } from 'node:util';
import { Stop } from './stop.js';

const accent = 'magenta';

/**
 * @template T
 * @param {T} value
 * @returns {Exclude<T, symbol>}
 */
function unlessCancelled(value) {
  if (isCancel(value)) throw new Stop('Stopped at your request. Nothing has been changed.');
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

/** @param {string} text */
export function problem(text) {
  log.message(text, { symbol: styleText('red', unicodeOr('✖', 'x')) });
}

/** @param {[string, string][]} rows @param {string} title */
export function summary(rows, title) {
  const width = Math.max(...rows.map(([label]) => label.length));
  note(rows.map(([label, value]) => `${styleText('bold', label.padEnd(width))}  ${value}`).join('\n'), title);
}

/** @param {string} text */
export function finish(text) {
  outro(styleText(accent, text));
}
