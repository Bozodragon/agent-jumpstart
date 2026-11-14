// Seam 3: the skills installer's output, drawn as the Installer page's small terminal shows it
// (installer/page/ansi.js). The captures in skills-output/ are the research's (issue #88, branch
// research/skills-installer-output): the skills CLI 1.7.4 run as the Installer runs it, its output
// piped, each chunk as it arrived. The CLI redraws its spinner with ESC[1G ESC[J (start of the
// line, erase down), never a carriage return, and colours with SGR codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { draw } from '../page/ansi.js';

/**
 * A capture's chunks, in the order they arrived, both streams together as the Installer relays them.
 * @param {string} name
 * @returns {Promise<string[]>}
 */
async function chunksOf(name) {
  const text = await readFile(new URL(`./skills-output/${name}.chunks.txt`, import.meta.url), 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => /^\s*\d+ms (?:out|err) (".*")$/.exec(line)?.[1])
    .filter((chunk) => chunk !== undefined)
    .map((chunk) => JSON.parse(chunk));
}

/** What the lines say, without their colours. @param {import('../page/ansi.js').Line[]} lines */
const plain = (lines) => lines.map((line) => line.map((span) => span.text).join(''));

/** The run of text a line has at `text`, with its look. @param {import('../page/ansi.js').Line[]} lines @param {string} text */
const spanOf = (lines, text) => {
  const found = lines.flat().find((span) => span.text.includes(text));
  assert.ok(found, `no span holds ${JSON.stringify(text)}`);
  return found;
};

const logo = [
  '███████╗██╗  ██╗██╗██╗     ██╗     ███████╗',
  '██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝',
  '███████╗█████╔╝ ██║██║     ██║     ███████╗',
  '╚════██║██╔═██╗ ██║██║     ██║     ╚════██║',
  '███████║██║  ██╗██║███████╗███████╗███████║',
  '╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝',
];

test("the plain capture comes out as the research settled it: every line once, and each spinner only as it last stood", async () => {
  const lines = draw((await chunksOf('piped-plain')).join(''));

  // The research's "Everything it prints, in order", with the logo and the line before it.
  assert.deepEqual(plain(lines), [
    '',
    ...logo,
    '',
    'T   skills ',
    '|',
    '|  Tip: use the --yes (-y) and --global (-g) flags to install without prompts.',
    '|',
    'o  Source: https://github.com/mattpocock/skills.git',
    '|',
    'o  Repository cloned',
    '|',
    '⚠ Skipped <TEMP>\\skills-ZPj5tw\\skills\\in-progress\\software-factory\\SKILL.md — YAML parse error: Nested mappings are not allowed in compact mappings at line 2, column 14:',
    '',
    'description: Shared language for designing a software factory: the tasks it run…',
    '             ^',
    '',
    'o  Found 38 skills',
    '|',
    '•  Selected 1 skill: grilling',
    '',
    '|',
    'o  Installation Summary ------+',
    '|                             |',
    '|                             |',
    '|  Mattpocock Skills          |',
    '|                             |',
    '|  ~\\.agents\\skills\\grilling  |',
    '|    copy → Claude Code       |',
    '|                             |',
    '+-----------------------------+',
    '|',
    'o  Security Risk Assessments ------------------------------+',
    '|                                                          |',
    '|            Gen               Socket            Snyk      |',
    '|  grilling  Safe              0 alerts          Low Risk  |',
    '|                                                          |',
    '|  Details: https://skills.sh/mattpocock/skills            |',
    '|                                                          |',
    '+----------------------------------------------------------+',
    '|',
    'o  Installation complete',
    '',
    '|',
    'o  Installed 1 skill -------------+',
    '|                                 |',
    '|                                 |',
    '|  Mattpocock Skills              |',
    '|  ✓ grilling (copied)            |',
    '|    → ~\\.claude\\skills\\grilling  |',
    '|                                 |',
    '+---------------------------------+',
    '',
    '|',
    '—  Done!  Review skills before use; they run with full agent permissions.',
    '',
  ]);
});

test("the CLI's own colours come through: the logo's greys, the skills badge, dim tips, bold names, cyan skills and green ticks", async () => {
  const lines = draw((await chunksOf('piped-plain')).join(''));

  // The logo fades from light to dark grey, in the 256-colour greys.
  assert.deepEqual(
    lines.slice(1, 7).map((line) => line.map(({ text, ...look }) => look)),
    [250, 248, 245, 243, 240, 238].map((fg) => [{ fg }]),
  );
  assert.deepEqual(spanOf(lines, ' skills '), { text: ' skills ', bg: 6, fg: 0 });
  assert.deepEqual(spanOf(lines, 'Tip:'), { text: 'Tip: use the --yes (-y) and --global (-g) flags to install without prompts.', dim: true });
  assert.deepEqual(spanOf(lines, '38'), { text: '38', fg: 2 });
  assert.deepEqual(spanOf(lines, 'grilling'), { text: 'grilling', fg: 6 });
  assert.deepEqual(spanOf(lines, 'Mattpocock'), { text: 'Mattpocock Skills', bold: true });
  assert.deepEqual(spanOf(lines, '✓'), { text: '✓', fg: 2 });
  // Each look ends where the CLI ends it: the text after a coloured word is plain again.
  assert.deepEqual(spanOf(lines, 'Selected'), { text: '•  Selected 1 skill: ' });
});

test('with FORCE_COLOR=1 the rails are grey too, and a spinner that has finished keeps the colour of its last frame, not its turning one', async () => {
  const lines = draw((await chunksOf('piped-force-color')).join(''));
  const text = plain(lines);

  // Only what FORCE_COLOR adds is different: the same lines as without it.
  assert.deepEqual(text, plain(draw((await chunksOf('piped-plain')).join(''))).map((line) => line.replace('skills-ZPj5tw', 'skills-oEjaY6')));
  const rails = lines.filter((line) => line[0]?.text === '|' && line.length === 1);
  assert.ok(rails.length > 5);
  for (const rail of rails) assert.deepEqual(rail, [{ text: '|', fg: 8 }]);
  const cloned = lines[text.indexOf('o  Repository cloned')];
  assert.deepEqual(cloned, [{ text: 'o', fg: 2 }, { text: '  Repository cloned' }]);
});

const captures = ['piped-plain', 'piped-force-color', 'piped-two-skills', 'piped-windows-terminal', 'piped-ci', 'piped-json'];

/** Whether a line shows any part of an escape code or a control character. @param {string} line */
const garbled = (line) => /[\x00-\x1f\x7f]|\[\??\d*(?:;\d+)*[A-Za-z]/.test(line);

test('every piped capture comes out as text alone: no escape codes, no pieces of them, no control characters', async () => {
  for (const name of captures) {
    const text = plain(draw((await chunksOf(name)).join('')));
    for (const line of text) assert.ok(!garbled(line), `${name}: ${JSON.stringify(line)}`);
    assert.ok(text.includes('|  Tip: use the --yes (-y) and --global (-g) flags to install without prompts.') || text.includes('│  Tip: use the --yes (-y) and --global (-g) flags to install without prompts.'), name);
  }
});

test("in Windows Terminal the rails and marks are Unicode, and come out as the CLI drew them", async () => {
  const text = plain(draw((await chunksOf('piped-windows-terminal')).join('')));

  assert.equal(text[8], '┌   skills ');
  assert.ok(text.includes('◇  Repository cloned'));
  assert.ok(text.includes('◇  Installation Summary ──────╮'));
  assert.ok(text.includes('●  Selected 1 skill: grilling'));
  assert.ok(!text.some((line) => /[◒◐◓◑]/.test(line)), 'a turning frame was left behind');
});

test('drawn as it streams, cut anywhere, even part-way through an escape code, it never shows a piece of a code or two frames of a spinner', async () => {
  const whole = (await chunksOf('piped-plain')).join('');
  const final = plain(draw(whole));
  /** A spinner frame, or the start of one: the line it turns on is the newest until it stops. @param {string} line */
  const turning = (line) =>
    ['Cloning repository…', 'Discovering skills…'].some((message) => [...'•oO0'].some((frame) => line !== '' && `${frame}  ${message}`.startsWith(line)));
  for (let end = 0; end <= whole.length; end++) {
    const text = plain(draw(whole.slice(0, end)));
    // Every line above the newest is already as it ends up; the newest is on its way to its
    // final words, or is a spinner turning, one frame of it.
    assert.deepEqual(text.slice(0, -1), final.slice(0, text.length - 1), `cut at ${end}`);
    const newest = text.at(-1) ?? '';
    const ending = final[text.length - 1] ?? '';
    assert.ok(ending.startsWith(newest) || turning(newest), `cut at ${end}: ${JSON.stringify(newest)}`);
    assert.ok(!garbled(newest), `cut at ${end}: ${JSON.stringify(newest)}`);
  }
  // Part-way through, the spinner's line stands as its newest frame.
  const cut = whole.indexOf('O  Cloning repository…') + 'O  Cloning repository…'.length;
  assert.equal(plain(draw(whole.slice(0, cut))).at(-1), 'O  Cloning repository…');
});

test("a spinner line too long for the CLI's 80 columns, which it moves up over to redraw, is redrawn in place, and the line above it stays", () => {
  const long = `•  Cloning ${'x'.repeat(100)}…`;
  // clack takes a pipe to be 80 columns wide, so a frame of 113 characters took two rows: it
  // moves up one before going back to the start of the line and erasing down.
  const lines = draw(`|\n${long}\x1b[1A\x1b[1G\x1b[J${long.replace('•', 'o')}\x1b[1A\x1b[1G\x1b[Jo  Repository cloned\n|\n`);
  assert.deepEqual(plain(lines), ['|', 'o  Repository cloned', '|']);
  // One of exactly 80 fills its row without wrapping, so it isn't moved up over.
  const full = `•  ${'y'.repeat(77)}`;
  assert.deepEqual(plain(draw(`|\n${full}\x1b[1G\x1b[Jdone\n`)), ['|', 'done']);
});

test("between a spinner's erase and its next frame, its line is still there, empty, as in a terminal, so nothing below or above it moves", () => {
  assert.deepEqual(plain(draw('|\n•  Cloning repository…\x1b[1G\x1b[J')), ['|', '']);
  // A line break with nothing after it yet is where the next line will go, not a line.
  assert.deepEqual(plain(draw('|\n')), ['|']);
});
