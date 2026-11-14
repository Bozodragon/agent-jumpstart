// Reading what a run drew in the terminal front end, as a person would read it, for the tests of
// its downloads (Seam 1): its spinner lines, and text that a note's box rails and the window's
// width have broken across lines.
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { stateFolder } from './harness.js';

/** The Installer's own downloads folder, where every download lands first. @param {string} home */
export const downloadsFolder = (home) => join(stateFolder(home), 'downloads');

/**
 * Text as it reads across the window's lines: a note's rails gone and every run of spaces and
 * line breaks one space, so a sentence a note wrapped can be matched whole.
 * @param {string} text
 */
export const flowing = (text) => text.replace(/[│|]/g, ' ').replace(/\s+/g, ' ');

/**
 * Each drawing of the spinner lines that include `message`, without their colours, in order. A
 * line is redrawn in place, each drawing after a carriage return.
 * @param {string} stdout @param {string} message
 */
export const drawings = (stdout, message) =>
  stripVTControlCharacters(stdout)
    .split(/[\r\n]/)
    .filter((drawing) => drawing.includes(message));

/** The percentages these drawings showed, in order. @param {string[]} drawn */
export const percentages = (drawn) => drawn.flatMap((drawing) => [.../(\d+)% \[/.exec(drawing) ?? []].slice(1, 2)).map(Number);

/**
 * The amounts so far these drawings showed, for a download of no known size, as they changed:
 * the spinner redraws its line each second of real time, and the same amount drawn again is no change.
 * @param {string[]} drawn
 */
export const amounts = (drawn) =>
  drawn.flatMap((drawing) => [.../(\d+\.\d) MB \[/.exec(drawing) ?? []].slice(1, 2)).filter((amount, index, all) => amount !== all[index - 1]);
