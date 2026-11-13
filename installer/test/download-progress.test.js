// Downloads report how far they've got, and the terminal shows it in its spinner line. Every
// download is written under a temporary name and given its own name only once it's whole.
// These runs download from the fake internet (fake-internet.js), with no `--downloads` folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fakeMachine, makeHome, readOnlyLog, runOnline, supplyT3 } from './harness.js';

/** What T3's stable installer leaves, relative to the home: its program, and the shim T3 writes as it starts. */
const t3Program = join('AppData', 'Local', 'Programs', 't3code', 'T3 Code (Beta).exe');
const t3Shim = join('.t3', 'bin', 't3.cmd');

/**
 * Replies for a York run that installs T3 Code: its silent install leaves the program and T3
 * starting leaves its shim, and Claude Code is installed and signed in.
 * @param {string} installer T3's installer's file name
 */
const t3Replies = (installer) => ({
  'powershell.exe': { creates: [join('.local', 'bin', 'claude.exe')] },
  [`${installer} /S --force-run`]: { creates: [t3Program, t3Shim] },
  'claude.exe --version': { output: '2.1.306 (Claude Code)\n' },
  'claude.exe auth status': { output: JSON.stringify({ loggedIn: true, email: 'jo.bloggs@york.ac.uk' }) },
});

/**
 * The percentages a spinner line showed, in the order it showed them. The line is rewritten in
 * place (each drawing starts with a carriage return), so each drawing is one piece.
 * @param {string} stdout @param {string} message how the line starts
 */
function percentagesShown(stdout, message) {
  return stdout
    .split('\r')
    .filter((drawing) => drawing.includes(message))
    .flatMap((drawing) => [.../(\d+)%/.exec(drawing) ?? []].slice(1, 2))
    .map(Number);
}

test("in a terminal, T3 Code's download shows a percentage in its spinner line that rises to 100%, and none of it reaches the log", async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2', { size: 100_000 });
  await fakeMachine(where.home).setReplies(t3Replies(installer));

  const result = await runOnline(where, 'york', { folder: where.downloads, chunk: 10_000, terminal: true });

  assert.equal(result.code, 0, result.stderr);
  const shown = percentagesShown(result.stdout, 'Installing T3 Code');
  assert.ok(new Set(shown).size >= 3, `it rose in steps, not all at once: ${shown.join(', ')}\n${result.stdout}`);
  assert.deepEqual(shown, [...shown].sort((a, b) => a - b), `it only ever rose: ${shown.join(', ')}`);
  assert.equal(shown.at(-1), 100, `it reached 100%: ${shown.join(', ')}`);

  const log = await readOnlyLog(where.home);
  assert.match(log.text, /T3 Code: checksum matches/);
  assert.doesNotMatch(log.text, /\d%/, 'no progress in the log');
});
