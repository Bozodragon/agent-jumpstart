// How the Installer page lays out the run's words. The run words things once, for both front
// ends (a terminal shows them as lines), so the page finds the shape in them: a heading and the
// line under it, paragraphs and bullets, links and paths. Plain JavaScript, tested on its own
// (installer/test/page-words.test.js).
import { bullet } from '../src/text.js';

/**
 * "A question? And a sentence about it." The first sentence is the heading and the rest goes
 * under it. A sentence ends at a full stop or question mark followed by a space, so a path's
 * dots don't end one. With `atColon`, a colon ends the heading too (a problem: "Something went
 * wrong: <the reason>"), and isn't kept.
 * @param {string} message @param {{ atColon?: boolean }} [options]
 * @returns {[string, string]}
 */
export function split(message, { atColon = false } = {}) {
  const match = (atColon ? /^(.*?)(?:([?.])|:)\s+(.+)$/s : /^(.*?)([?.])\s+(.+)$/s).exec(message);
  return match ? [match[1] + (match[2] ?? ''), match[3]] : [message, ''];
}

/** @typedef {{ paragraph: string } | { list: string[] }} Block */

/**
 * A notice's text as paragraphs and lists: each line is a paragraph, and lines that start with
 * a bullet make a list. Blank lines only separate.
 * @param {string} text
 * @returns {Block[]}
 */
export function blocks(text) {
  /** @type {Block[]} */
  const found = [];
  const marker = new RegExp(`^\\s*${bullet}\\s+`);
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    if (marker.test(line)) {
      const item = line.replace(marker, '');
      const previous = found.at(-1);
      if (previous && 'list' in previous) previous.list.push(item);
      else found.push({ list: [item] });
    } else found.push({ paragraph: line.trim() });
  }
  return found;
}

/** @typedef {{ text: string } | { url: string } | { path: string }} Piece */

/**
 * A line in pieces: plain text, links (https://…), and a Windows path at the end of the line,
 * which the page sets in its mono face. A full stop after a link or a path isn't part of it, nor
 * is a quote or bracket after a path.
 * @param {string} line
 * @returns {Piece[]}
 */
export function pieces(line) {
  /** @type {Piece[]} */
  const found = [];
  /** @param {string} text */
  const text = (text) => {
    if (text !== '') found.push({ text });
  };
  const path = /(?<![\w/])([A-Za-z]:\\.*?)([.'"’)]*)$/.exec(line);
  const before = path ? line.slice(0, path.index) : line;
  let from = 0;
  for (const match of before.matchAll(/https?:\/\/[^\s<>"]*[^\s<>".,;:!?)]/g)) {
    text(before.slice(from, match.index));
    found.push({ url: match[0] });
    from = (match.index ?? 0) + match[0].length;
  }
  text(before.slice(from));
  if (path) {
    found.push({ path: path[1] });
    text(path[2]);
  }
  return found;
}

/**
 * How far something slow has got, in words: a percentage of the total, or the amount so far.
 * Rounded down, so 100% means all of it.
 * @param {number | undefined} received @param {number | undefined} total
 */
export function soFar(received, total) {
  if (received === undefined) return '';
  if (total !== undefined && total > 0) return `${Math.min(Math.floor((received / total) * 100), 100)}%`;
  return `${(received / 1_000_000).toFixed(1)} MB`;
}
