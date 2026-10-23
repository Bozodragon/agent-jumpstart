// What the person sees. The shape (a guide line, short steps, a closing
// summary) follows the skills CLI's; the colours and symbols are our own.
import { intro, log, note, outro, unicodeOr } from '@clack/prompts';
import { styleText } from 'node:util';

const accent = 'magenta';

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
