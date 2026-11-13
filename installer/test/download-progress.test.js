// Downloads report how far they've got, and the terminal shows it in its spinner line. Every
// download is written under a temporary name and given its own name only once it's whole.
// These runs download from the fake internet (fake-internet.js), with no `--downloads` folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { checklistSays, fakeMachine, makeHome, readOnlyLog, run, runOnline, stateFolder, supplyT3 } from './harness.js';

/** What T3's stable installer leaves, relative to the home: its program, and the shim T3 writes as it starts. */
const t3Program = join('AppData', 'Local', 'Programs', 't3code', 'T3 Code (Beta).exe');
const t3Shim = join('.t3', 'bin', 't3.cmd');

/**
 * Replies for a York run that installs T3 Code: its silent install leaves the program and T3
 * starting leaves its shim, and Claude Code (installed by its own download, as in every test
 * home) is signed in.
 * @param {string} installer T3's installer's file name
 */
const t3Replies = (installer) => ({
  [`${installer} /S --force-run`]: { creates: [t3Program, t3Shim] },
  'claude.exe --version': { output: '2.1.306 (Claude Code)\n' },
  'claude.exe auth status': { output: JSON.stringify({ loggedIn: true, email: 'jo.bloggs@york.ac.uk' }) },
});

/** The Installer's own downloads folder, where every download lands first. @param {string} home */
const downloadsFolder = (home) => join(stateFolder(home), 'downloads');

/** What the Installer's own downloads folder holds, by name and size. @param {string} home */
async function heldIn(home) {
  const folder = downloadsFolder(home);
  const names = await readdir(folder).catch(() => []);
  return Promise.all(names.map(async (name) => ({ name, size: (await stat(join(folder, name))).size })));
}

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

test("a run ended partway through T3 Code's download leaves no file under the installer's name, and a later run downloads it whole and installs it", async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2', { size: 100_000 });
  await fakeMachine(where.home).setReplies(t3Replies(installer));

  // The download stops coming halfway, and the window is closed while it waits.
  /** @type {{ name: string, size: number }[]} */
  let seen = [];
  const ended = await runOnline(
    where,
    'york',
    { folder: where.downloads, chunk: 10_000, stall: { [installer]: 50_000 } },
    { stopWhen: async () => (seen = await heldIn(where.home)).some(({ size }) => size >= 50_000) },
  );
  assert.notEqual(ended.code, 0, 'the run was ended partway');
  assert.ok(seen.some(({ size }) => size >= 50_000), 'it had half the download when it was ended');
  const left = await heldIn(where.home);
  assert.ok(!left.some(({ name }) => name === installer), `nothing is under the installer's own name: ${JSON.stringify(left)}`);

  // Only the later run's log is read.
  await rm(join(stateFolder(where.home), 'logs'), { recursive: true, force: true });
  const later = await runOnline(where, 'york', { folder: where.downloads, chunk: 10_000 });

  assert.equal(later.code, 0, later.stderr);
  checklistSays(later.stdout, 'T3 Code', '0.1.2 (stable, installed)');
  const runs = await fakeMachine(where.home).runs();
  assert.ok(runs.some((run) => run.file === join(downloadsFolder(where.home), installer)), 'the installer was run under its own name');
  assert.match((await readOnlyLog(where.home)).text, /T3 Code: checksum matches/);
  assert.deepEqual(await heldIn(where.home), [], 'nothing is left in the downloads folder');
});

test("a dropped connection partway through T3 Code's download leaves nothing behind, and T3 Code isn't installed", async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2', { size: 100_000 });
  await fakeMachine(where.home).setReplies(t3Replies(installer));

  const result = await runOnline(where, 'york', { folder: where.downloads, chunk: 10_000, cutShort: { [installer]: 50_000 } });

  assert.equal(result.code, 0, result.stderr);
  checklistSays(result.stdout, 'T3 Code', "Not installed: it couldn't be downloaded (terminated)");
  assert.deepEqual(await heldIn(where.home), [], 'nothing is left in the downloads folder');
  const runs = await fakeMachine(where.home).runs();
  assert.ok(!runs.some((run) => run.file.endsWith(installer)), 'no installer was run');
});

test('a copy from the downloads folder shows no percentage, even in a terminal, and is made as it always was', async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2', { size: 100_000 });
  await fakeMachine(where.home).setReplies(t3Replies(installer));

  const args = ['--profile', 'york', '--home', where.home, '--answers', where.answersFile, '--downloads', where.downloads];
  // The fake internet only to make the output look like a terminal: nothing is downloaded.
  const result = await run(args, { internet: { folder: join(where.downloads, 'nowhere'), terminal: true } });

  assert.equal(result.code, 0, result.stderr);
  // Output that looks like a terminal is coloured.
  checklistSays(stripVTControlCharacters(result.stdout), 'T3 Code', '0.1.2 (stable, installed)');
  assert.ok(result.stdout.includes('Installing T3 Code'), result.stdout);
  assert.deepEqual(percentagesShown(result.stdout, 'Installing T3 Code'), [], 'no percentage for a copy');
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes(`T3 Code: taking ${join(where.downloads, installer)}`), log.text);
  assert.ok(log.text.includes(`T3 Code: downloaded to ${join(downloadsFolder(where.home), installer)}`), log.text);
  assert.doesNotMatch(log.text, /partial/);
});

test("a download whose size the server doesn't give shows how much has come so far, in its spinner line", async (t) => {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2', { size: 3_000_000 });
  await fakeMachine(where.home).setReplies(t3Replies(installer));

  const result = await runOnline(where, 'york', { folder: where.downloads, chunk: 500_000, unsized: [installer], terminal: true });

  assert.equal(result.code, 0, result.stderr);
  const drawn = result.stdout.split('\r').filter((drawing) => drawing.includes('Installing T3 Code'));
  const amounts = drawn.flatMap((drawing) => [.../(\d+\.\d) MB/.exec(drawing) ?? []].slice(1, 2));
  assert.deepEqual(amounts, ['0.0', '0.5', '1.0', '1.5', '2.0', '2.5', '3.0'], drawn.join('\n'));
  assert.deepEqual(percentagesShown(result.stdout, 'Installing T3 Code'), [], 'no percentage without a size');
});
