// The skills installer's own output, as the Installer page's small terminal draws it. Plain
// JavaScript, no React, so it's tested on its own against the research's captures
// (installer/test/ansi.test.js, seam 3).
//
// The skills CLI's output is piped, not a terminal, and still keeps its look (issue #88): colours
// as SGR codes (16 colours, the logo's 256-colour greys, bold, dim), and a spinner that redraws
// its line with ESC[1G ESC[J (back to the start of the line, erase down), never a carriage return.
// It hides and shows the cursor too, and moves up a row (ESC[nA) only when a spinner's line was
// too long for the 80 columns it takes a pipe to have, and wrapped. So this is a small screen,
// not a terminal emulator: lines of styled text, a cursor that moves along them, and those few
// moves. A line isn't broken at 80 columns (the page wraps it to fit); the cursor only counts in
// rows of 80, as the CLI does, to move up and back to the start of one. Anything else it's sent
// is left out.
//
// `draw` takes everything printed so far, so a page redraws from the start as each piece comes.
// A piece may end part-way through an escape code; what's there of it is held back until the
// rest comes.

/**
 * A colour: one of the terminal's 256 (0-15 the theme's own, 16-255 the standard cube and greys),
 * or `#rrggbb` for one given exactly.
 * @typedef {number | string} Colour
 */

/**
 * @typedef {object} Look
 * @property {Colour} [fg]
 * @property {Colour} [bg]
 * @property {true} [bold]
 * @property {true} [dim]
 * @property {true} [italic]
 * @property {true} [underline]
 * @property {true} [inverse]
 * @property {true} [strike]
 */

/** @typedef {Look & { text: string }} Span A run of text in one look. */
/** @typedef {Span[]} Line */

/** One character on a line, with its look. @typedef {{ char: string, look: Look }} Cell */

/** How wide clack takes a pipe to be (`getColumns` in @clack/core), in characters. */
const columns = 80;

/**
 * The lines everything printed so far leaves on screen, each a list of spans. The line the cursor
 * ends on is left out when nothing's on it, as it is after the last line break.
 * @param {string} text
 * @returns {Line[]}
 */
export function draw(text) {
  /** @type {Cell[][]} */
  const screen = [[]];
  /** The line the cursor is on. */
  let row = 0;
  /** Where along it, counting every row of 80 it has wrapped onto. */
  let column = 0;
  /**
   * Whether the last character filled a row of 80: the cursor stays at that row's end, as a
   * terminal's does, until the next character wraps it.
   */
  let full = false;
  /** @type {Look} */
  let look = {};

  /** @param {string} char */
  const put = (char) => {
    const line = screen[row];
    while (line.length < column) line.push({ char: ' ', look: {} });
    line[column] = { char, look };
    column++;
    full = column % columns === 0;
  };
  /** Which row of 80, along its line, the cursor is on. */
  const rowAlong = () => Math.floor(column / columns) - (full ? 1 : 0);

  let at = 0;
  while (at < text.length) {
    const char = text[at];
    if (char === '\x1b') {
      const code = escapeAt(text, at);
      if (code === undefined) break;
      at = code.end;
      if (code.kind !== 'csi') continue;
      const numbers = code.params === '' ? [] : code.params.split(';').map((part) => (part === '' ? 0 : Number(part)));
      const count = Math.max(1, numbers[0] ?? 1);
      switch (code.final) {
        case 'm':
          if (!code.private) look = sgr(look, numbers);
          break;
        case 'G':
          column = rowAlong() * columns + Math.min(count, columns) - 1;
          full = false;
          break;
        case 'A': {
          // Up a row: within a wrapped line first, then onto the last row of the line above.
          let along = rowAlong();
          const across = full ? columns - 1 : column % columns;
          for (let up = count; up > 0; up--) {
            if (along > 0) along--;
            else if (row > 0) {
              row--;
              along = Math.max(0, Math.ceil(screen[row].length / columns) - 1);
            }
          }
          column = along * columns + across;
          full = false;
          break;
        }
        case 'J':
          // Erase down: the rest of this line and every line below. (1 and 2, erase up or all, never come.)
          if ((numbers[0] ?? 0) === 0) {
            screen[row].length = Math.min(screen[row].length, column);
            screen.length = row + 1;
          }
          break;
        case 'K':
          if ((numbers[0] ?? 0) === 0) screen[row].length = Math.min(screen[row].length, column);
          break;
      }
      continue;
    }
    at++;
    if (char === '\n') {
      row++;
      column = 0;
      full = false;
      screen[row] ??= [];
    } else if (char === '\r') {
      column = rowAlong() * columns;
      full = false;
    } else if (char === '\b') {
      column = Math.max(rowAlong() * columns, column - (full ? 2 : 1));
      full = false;
    } else if (char === '\t') {
      do put(' ');
      while (column % 8 !== 0);
    } else if (char >= ' ' && char !== '\x7f') put(char);
  }

  if (screen.length > 1 && screen.at(-1)?.length === 0) screen.pop();
  return screen.map(spans);
}

/**
 * The escape code starting at `at`: a control sequence (`ESC [`, its parameters and its final
 * letter), an operating-system command (`ESC ]` up to BEL or `ESC \`), or a two-character code.
 * Undefined when the text ends before it does.
 * @param {string} text @param {number} at
 * @returns {{ kind: 'csi', private: boolean, params: string, final: string, end: number } | { kind: 'other', end: number } | undefined}
 */
function escapeAt(text, at) {
  const next = text[at + 1];
  if (next === undefined) return undefined;
  if (next === '[') {
    const csi = /^\x1b\[([<=>?]?)([0-9;:]*)[ -/]*([@-~])/.exec(text.slice(at, at + 64));
    if (csi) return { kind: 'csi', private: csi[1] !== '', params: csi[2].replaceAll(':', ';'), final: csi[3], end: at + csi[0].length };
    // Not finished yet, or not a sequence at all: wait for more only while it could still be one.
    return /^\x1b\[[<=>?]?[0-9;:]*[ -/]*$/.test(text.slice(at)) ? undefined : { kind: 'other', end: at + 2 };
  }
  if (next === ']') {
    const end = /\x07|\x1b\\/.exec(text.slice(at + 2));
    return end ? { kind: 'other', end: at + 2 + end.index + end[0].length } : undefined;
  }
  return { kind: 'other', end: at + 2 };
}

/**
 * The look after an SGR code's numbers.
 * @param {Look} before @param {number[]} numbers
 * @returns {Look}
 */
function sgr(before, numbers) {
  /** @type {Look} */
  const look = { ...before };
  if (numbers.length === 0) return {};
  for (let index = 0; index < numbers.length; index++) {
    const n = numbers[index];
    if (n === 0) for (const key of Object.keys(look)) delete look[/** @type {keyof Look} */ (key)];
    else if (n === 1) look.bold = true;
    else if (n === 2) look.dim = true;
    else if (n === 3) look.italic = true;
    else if (n === 4) look.underline = true;
    else if (n === 7) look.inverse = true;
    else if (n === 9) look.strike = true;
    else if (n === 22) {
      delete look.bold;
      delete look.dim;
    } else if (n === 23) delete look.italic;
    else if (n === 24) delete look.underline;
    else if (n === 27) delete look.inverse;
    else if (n === 29) delete look.strike;
    else if (n >= 30 && n <= 37) look.fg = n - 30;
    else if (n >= 90 && n <= 97) look.fg = n - 90 + 8;
    else if (n === 39) delete look.fg;
    else if (n >= 40 && n <= 47) look.bg = n - 40;
    else if (n >= 100 && n <= 107) look.bg = n - 100 + 8;
    else if (n === 49) delete look.bg;
    else if (n === 38 || n === 48) {
      const which = n === 38 ? 'fg' : 'bg';
      if (numbers[index + 1] === 5 && numbers[index + 2] !== undefined) {
        look[which] = Math.min(255, numbers[index + 2]);
        index += 2;
      } else if (numbers[index + 1] === 2 && numbers[index + 4] !== undefined) {
        look[which] = `#${numbers
          .slice(index + 2, index + 5)
          .map((part) => Math.min(255, part).toString(16).padStart(2, '0'))
          .join('')}`;
        index += 4;
      } else break;
    }
  }
  return look;
}

/** A line's cells as spans, each run of one look together. @param {Cell[]} cells @returns {Line} */
function spans(cells) {
  /** @type {Line} */
  const line = [];
  /** @type {Look | undefined} */
  let last;
  for (const { char, look } of cells) {
    const span = line.at(-1);
    if (span && last === look) span.text += char;
    else if (span && last && sameLook(last, look)) {
      span.text += char;
      last = look;
    } else {
      line.push({ ...look, text: char });
      last = look;
    }
  }
  return line;
}

/** @param {Look} a @param {Look} b */
function sameLook(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[/** @type {keyof Look} */ (key)] !== b[/** @type {keyof Look} */ (key)]) return false;
  return true;
}
