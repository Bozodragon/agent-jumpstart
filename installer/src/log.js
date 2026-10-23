import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

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
 * @param {Date} [now]
 */
export function openLog(folder, now = new Date()) {
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `install-${localDate(now)}-${localTime(now, '')}.log`);
  return {
    path,
    /** @param {string} line */
    write(line) {
      appendFileSync(path, `${localTime(new Date())} ${line}\n`);
    },
  };
}
