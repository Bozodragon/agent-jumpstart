// Debug mode, from the debug pasted line: the log widens to every program's full output and
// the user PATH before and after; the downloads are kept. What the person sees is the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fakeMachine, makeHome, programsFolder, readManifest, readOnlyLog, runWith } from './harness.js';

/** What the Node already on the machine says when asked its version: more than one line. */
const nodeSays = (/** @type {string} */ version) => `v${version}\r\nfirst detail line\r\nsecond detail line\r\n`;

/**
 * A home where Node is already at the pinned version (so the installer runs it and gets
 * output back) and Git and gh are in the downloads folder under their vendors' names, but
 * aren't the vendors' files (so they're obtained, then fail their checksums).
 * @param {import('node:test').TestContext} t
 */
async function aLaptop(t) {
  const where = await makeHome(t);
  const manifest = await readManifest();
  const tool = (/** @type {string} */ id) => manifest.tools.find((/** @type {any} */ entry) => entry.id === id);
  const node = tool('node');
  const nodeFolder = join(programsFolder(where.home), 'nodejs');
  await mkdir(nodeFolder, { recursive: true });
  await writeFile(join(nodeFolder, 'node.exe'), 'the copy already there');
  const downloaded = ['git', 'gh'].map((id) => basename(new URL(tool(id).downloads[process.arch].url).pathname));
  for (const name of downloaded) await writeFile(join(where.downloads, name), `not really ${name}`);
  const machine = fakeMachine(where.home);
  await machine.setEnvironment({ Path: 'C:\\Already\\There' });
  await machine.setReplies({ 'node.exe --version': { output: nodeSays(node.version) } });
  return { where, node, nodeFolder, downloaded };
}

/** The installer's own downloads folder, not the test's downloads override. @param {string} home */
async function keptDownloads(home) {
  try {
    return (await readdir(join(home, 'AppData', 'Local', 'agent-jumpstart', 'downloads'))).sort();
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return [];
    throw error;
  }
}

test('a debug run logs every program it ran with its full output', async (t) => {
  const { where, node } = await aLaptop(t);

  const result = await runWith(where, 'york', ['--debug']);

  assert.equal(result.code, 0, result.stderr);
  const { text } = await readOnlyLog(where.home);
  assert.match(text, /Running: .*node\.exe --version\n.*Ran: node\.exe \(code 0\)/);
  for (const line of nodeSays(node.version).trim().split(/\r?\n/)) {
    assert.match(text, new RegExp(`^\\d\\d:\\d\\d:\\d\\d \\s+\\| ${line.replaceAll('.', '\\.')}$`, 'm'));
  }
});

/**
 * The entries listed under a heading line such as `User PATH before:`, one per log line.
 * @param {string} text @param {string} heading
 */
function listedUnder(text, heading) {
  const lines = text.split('\n').map((line) => line.replace(/^\d\d:\d\d:\d\d /, ''));
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `expected "${heading}" in the log:\n${text}`);
  const entries = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('  ')) break;
    entries.push(line.trim());
  }
  return entries;
}

test("a debug run logs a program run in the person's window, though its output went to the screen", async (t) => {
  const where = await makeHome(t, { github: true });
  const { tools } = await readManifest();
  const tool = tools.find((/** @type {any} */ entry) => entry.id === 'gh');
  const gh = join(programsFolder(where.home), tool.install.folder, tool.install.check);
  await mkdir(join(gh, '..'), { recursive: true });
  await writeFile(gh, 'stand-in');
  await fakeMachine(where.home).setReplies({
    'gh.exe --version': { output: `gh version ${tool.version} (2026-10-01)\n` },
    'gh.exe auth status --hostname github.com': { code: 1, output: 'You are not logged into any GitHub hosts.' },
    'gh.exe auth login --hostname github.com --git-protocol https --web --clipboard': { code: 0 },
  });

  const result = await runWith(where, 'york', ['--debug']);

  assert.equal(result.code, 0, result.stderr);
  const { text } = await readOnlyLog(where.home);
  assert.match(text, /Running in the person's window: .*gh\.exe"? auth login .*\n.*Ran: gh\.exe \(code 0\)\n.*its output went to the person's window/);
  assert.match(text, /Running: .*gh\.exe"? auth status .*\n.*Ran: gh\.exe \(code 1\)\n.* {2}\| You are not logged into any GitHub hosts\./);
});

test('a debug run logs the user PATH before and after', async (t) => {
  const { where, nodeFolder } = await aLaptop(t);

  const result = await runWith(where, 'york', ['--debug']);

  assert.equal(result.code, 0, result.stderr);
  const { text } = await readOnlyLog(where.home);
  assert.deepEqual(listedUnder(text, 'User PATH before:'), ['C:\\Already\\There']);
  assert.deepEqual(listedUnder(text, 'User PATH after:'), ['C:\\Already\\There', nodeFolder]);
});

test("a debug run keeps the downloads in the installer's folder", async (t) => {
  const { where, downloaded } = await aLaptop(t);

  const result = await runWith(where, 'york', ['--debug']);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await keptDownloads(where.home), [...downloaded].sort());
  assert.deepEqual((await readdir(where.downloads)).sort(), [...downloaded].sort(), 'the downloads override is left as it was');
});

test("an ordinary run deletes the downloads from the installer's folder", async (t) => {
  const { where, downloaded } = await aLaptop(t);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  assert.match((await readOnlyLog(where.home)).text, /Git: downloaded to .*agent-jumpstart\\downloads/, 'it was obtained there first');
  assert.deepEqual(await keptDownloads(where.home), []);
  assert.deepEqual((await readdir(where.downloads)).sort(), [...downloaded].sort(), 'the downloads override is left as it was');
});

test('the person sees the same questions and checklist in both modes; only the log is bigger', async (t) => {
  const ordinary = await aLaptop(t);
  const debug = await aLaptop(t);

  const ordinaryRun = await runWith(ordinary.where, 'york');
  const debugRun = await runWith(debug.where, 'york', ['--debug']);

  assert.equal(ordinaryRun.code, 0, ordinaryRun.stderr);
  assert.equal(debugRun.code, 0, debugRun.stderr);
  /** @param {string} stdout @param {string} home */
  const seen = (stdout, home) => stdout.replaceAll(home, '<home>').replace(/install-[\d-]+\.log/, '<log>');
  assert.match(debugRun.stdout, /Checklist/);
  assert.equal(seen(debugRun.stdout, debug.where.home), seen(ordinaryRun.stdout, ordinary.where.home));
  assert.ok(
    (await readOnlyLog(debug.where.home)).text.length > (await readOnlyLog(ordinary.where.home)).text.length,
    'the debug log holds more',
  );
});

test('an ordinary run leaves programs’ output and the PATH out of the log', async (t) => {
  const { where } = await aLaptop(t);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stderr);
  const { text } = await readOnlyLog(where.home);
  assert.doesNotMatch(text, /Running: |Ran: /);
  assert.doesNotMatch(text, /detail line/);
  assert.doesNotMatch(text, /User PATH/);
});
