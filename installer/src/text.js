// Plain text helpers for what's shown, whichever front end shows it. They draw nothing.

/**
 * Names in plain English: "A", "A and B", "A, B and C".
 * @param {string[]} names
 */
export function inWords(names) {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export const bullet = '•';

/**
 * What a program printed, as lines of plain text: without the colours and links a terminal
 * would draw, and without the blank lines.
 * @param {string} output
 */
export function plainLines(output) {
  return output
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
}

/**
 * The lines a program has finished printing so far, as plain text (see plainLines): a line still
 * being printed isn't one yet, so an address split between two pieces of output is never cut short.
 * @param {string} printed
 */
export function wholeLines(printed) {
  return plainLines(printed.slice(0, printed.lastIndexOf('\n') + 1));
}
