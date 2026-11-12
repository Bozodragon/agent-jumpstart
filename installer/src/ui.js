// What the person sees. The shape (a guide line, short steps, a closing
// summary) follows the skills CLI's; the colours and symbols are our own.
//
// York's PowerShell window is Windows Terminal on Windows 11, but some laptops still open the old
// Windows console (conhost), so everything here is made for the old console first, and looks the
// same in Windows Terminal:
// - Only characters its fonts draw: printable ASCII, single-line box drawing and the two dots
//   (• ·). The prompt library picks its symbols once, as it loads, by guessing whether the window
//   draws Unicode; the guess is made yes everywhere, so its guide lines are always box drawing,
//   and the symbols the old console can't draw are swapped for ones it can as they're printed.
// - Colour only on symbols and guide lines, never on the words, and never magenta or blue:
//   the old console draws dark magenta in its own background blue, so the library's colours
//   are swapped for ones that read on that blue and on Windows Terminal's black alike.
// - A spinner that doesn't flicker: one line updated in place once a second, never cleared.
import { emitKeypressEvents } from 'node:readline';
import { styleText } from 'node:util';
import { Stop } from './stop.js';

// The library guesses the window draws Unicode when it's inside Windows Terminal, which sets this.
const windowsTerminal = 'WT_SESSION';
const windowsTerminalSession = process.env[windowsTerminal];
/** Whether the window the installer was started in is Windows Terminal, as found, before it's set below. */
export const inWindowsTerminal = windowsTerminalSession !== undefined;
process.env[windowsTerminal] ??= 'agent-jumpstart';
const { confirm, intro, isCancel, log, multiselect, note, outro, select, text } = await import('@clack/prompts');
// Put back, so the programs the installer runs see the window as it is.
if (windowsTerminalSession === undefined) delete process.env[windowsTerminal];

/** The prompt library's symbols the old console can't draw, and what's printed in their place. */
const swaps = new Map(
  Object.entries({
    '◆': '*', // a question waiting for an answer
    '◇': 'o', // an answered question, a notice
    '■': 'x', // a cancelled question
    '▲': '!', // a question's answer that isn't valid yet
    '●': '>', // the chosen option
    '○': ' ', // the other options
    '◻': '-', // an option not ticked
    '◼': '+', // an option ticked
    '▪': '*',
    '╭': '┌',
    '╮': '┐',
    '╰': '└',
    '╯': '┘',
    '—': '-',
    '↑': '^',
    '↓': 'v',
    '━': '=',
    '█': '#',
    '◒': '•',
    '◐': '•',
    '◓': '•',
    '◑': '•',
  }),
);
const swappable = new RegExp(`[${[...swaps.keys()].join('')}]`, 'g');

// Dark red is unreadable on the blue, dark yellow draws as white there, dark magenta draws as the
// blue itself, and dark blue barely shows: each is printed as its bright form, blue and magenta as
// cyan. Gray, for the guide lines, reads on both backgrounds as it is.
/** @type {Record<string, string>} */
const colours = { 31: '91', 32: '92', 33: '93', 34: '96', 35: '96', 36: '96' };

/** @param {string} printed */
function drawable(printed) {
  return printed
    .replace(swappable, (symbol) => swaps.get(symbol) ?? symbol)
    .replace(/\x1b\[(3[1-6])m/g, (_, code) => `\x1b[${colours[code]}m`);
}

// Everything printed passes through here, the prompt library's output and any stray line alike.
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = /** @type {typeof stream.write} */ (
    (/** @type {unknown} */ chunk, /** @type {any[]} */ ...rest) => write(typeof chunk === 'string' ? drawable(chunk) : /** @type {any} */ (chunk), ...rest)
  );
}

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
  intro(styleText('bold', title));
}

/** @param {string} text */
export function step(text) {
  log.message(text, { symbol: styleText('cyan', '>') });
}

/** @param {number} since @returns {string} */
function timeSince(since) {
  const seconds = Math.floor((performance.now() - since) / 1000);
  return seconds >= 60 ? `[${Math.floor(seconds / 60)}m ${seconds % 60}s]` : `[${seconds}s]`;
}

/**
 * The spinner: the message with the time so far, on one line that's rewritten in place each
 * second and never cleared, so nothing flickers. A message too long for the window is cut short
 * while it spins (a line that wraps can't be rewritten in place) and shown whole once it's done.
 * Keys pressed meanwhile are swallowed, so none reaches the next question, and Ctrl+C stops the run.
 * @param {string} message
 */
function spin(message) {
  const out = process.stdout;
  const since = performance.now();
  let longest = 0;
  const draw = () => {
    const time = timeSince(since);
    const room = (out.columns || 80) - 1 - '•  '.length - ' '.length - time.length;
    const shown = message.length <= room ? message : `${message.slice(0, Math.max(room - 3, 0))}...`;
    const width = '•  '.length + shown.length + 1 + time.length;
    out.write(`\r${styleText('cyan', '•')}  ${shown} ${styleText('gray', time)}${' '.repeat(Math.max(longest - width, 0))}`);
    longest = Math.max(longest, width);
  };
  const showCursor = () => out.write('\x1b[?25h');
  const input = process.stdin;
  /** @param {string} _ @param {{ ctrl?: boolean, name?: string } | undefined} key */
  const pressed = (_, key) => {
    if (key?.ctrl && key.name === 'c') {
      out.write('\n');
      process.exit(130);
    }
  };
  if (input.isTTY) {
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.on('keypress', pressed);
    input.resume();
  }
  process.once('exit', showCursor);
  out.write(`${styleText('gray', '│')}\n\x1b[?25l`);
  draw();
  const ticking = setInterval(draw, 1000);
  /** @param {string} text @param {boolean} ok */
  return (text, ok) => {
    clearInterval(ticking);
    if (input.isTTY) {
      input.off('keypress', pressed);
      input.setRawMode(false);
      input.pause();
    }
    const symbol = ok ? styleText('green', 'o') : styleText('red', 'x');
    out.write(`\r\x1b[2K${symbol}  ${text} ${styleText('gray', timeSince(since))}\n`);
    showCursor();
    process.off('exit', showCursor);
  };
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
  const stop = spin(message);
  let result;
  try {
    result = await task();
  } catch (error) {
    stop(message, false);
    throw error;
  }
  const { text, ok } = ended?.(result) ?? { text: message, ok: true };
  stop(text, ok);
  return result;
}

/** @param {string} text */
export function problem(text) {
  log.message(text, { symbol: styleText('red', 'x') });
}

/** @param {[string, string][]} rows @param {string} title */
export function summary(rows, title) {
  const width = Math.max(...rows.map(([label]) => label.length));
  note(rows.map(([label, value]) => `${styleText('bold', label.padEnd(width))}  ${value}`).join('\n'), title);
}

/**
 * Names in plain English: "A", "A and B", "A, B and C".
 * @param {string[]} names
 */
export function inWords(names) {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export const bullet = '•';

/**
 * Said beside every page the installer opens: the browser takes the focus, and the person has to
 * find their way back to the window that's waiting for them.
 */
export const comeBack = "Once you're done in the browser, come back to the Agent Jumpstart window, where you pasted the line, and press Enter.";

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

/**
 * The run's last words. A second line, if there is one, lines up under the first.
 * @param {string} text
 */
export function finish(text) {
  outro(styleText('bold', text.replaceAll('\n', '\n   ')));
}
