// Plain text helpers for what's shown, whichever front end shows it. They draw nothing.

/**
 * Names in plain English: "A", "A and B", "A, B and C".
 * @param {string[]} names
 */
export function inWords(names) {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export const bullet = '•';
