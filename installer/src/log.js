import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {object} Log
 * @property {string} path
 * @property {(line: string) => void} write Writes a line, in every run.
 * @property {(text: string) => void} detail Writes only in a debug run, which the debug pasted
 *   line starts. Each line of a text with several is written as a log line of its own.
 */

/** @param {number} n */
const twoDigits = (n) => String(n).padStart(2, '0');

/** @param {Date} when */
const localDate = (when) => `${when.getFullYear()}-${twoDigits(when.getMonth() + 1)}-${twoDigits(when.getDate())}`;

/** @param {Date} when @param {string} [separator] */
const localTime = (when, separator = ':') =>
  [when.getHours(), when.getMinutes(), when.getSeconds()].map(twoDigits).join(separator);

/**
 * Opens a new log named for the local date and time the run started, and
 * writes each line as it happens so a run that stops early still leaves one.
 * @param {string} folder
 * @param {{ debug?: boolean, now?: Date }} [options]
 * @returns {Log}
 */
export function openLog(folder, { debug = false, now = new Date() } = {}) {
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `install-${localDate(now)}-${localTime(now, '')}.log`);
  /** @param {string[]} lines */
  const append = (lines) => {
    const when = localTime(new Date());
    appendFileSync(path, lines.map((line) => `${when} ${line}\n`).join(''));
  };
  return {
    path,
    write: (line) => append([line]),
    detail: (text) => {
      if (debug) append(text.split(/\r?\n/));
    },
  };
}
