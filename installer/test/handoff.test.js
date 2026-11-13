// The Installer's side of the Bootstrap's handoff (Seam 2): the files the Bootstrap reads, the
// Installer stopping itself when no page connects, and programs never given the hidden console's
// input. The Bootstrap's own side is checked in pasted-lines.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { claudeProgram, exists, fakeMachine, makeHome, program, readOnlyLog, repo, run, runWith, stateFolder, supplyT3, t3Leaves } from './harness.js';
import { addressFile, answerEverything, connectedFile, runOnPage } from './page-harness.js';

/** @param {string} path @returns {Promise<string[] | undefined>} its lines, or nothing if it isn't there */
const linesOf = (path) => readFile(path, 'utf8').then((text) => text.split(/\r?\n/).filter((line) => line !== ''), () => undefined);

test("while it runs, the Installer's address file is its lock, holding the page's address and its process; a page connecting writes the connected file with that address", async (t) => {
  const where = await makeHome(t);

  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const lock = await linesOf(addressFile(where.home));
  const connectedBefore = await exists(connectedFile(where.home));
  const page = run.connect();
  await page.next((event) => event.type === 'question');
  const connected = await linesOf(connectedFile(where.home));
  run.kill();
  await run.ended;

  assert.deepEqual(lock, [run.address, String(run.pid)]);
  assert.equal(connectedBefore, false, 'the connected file waits for a page');
  assert.deepEqual(connected, [run.address]);
});

test('with no page connecting, the Installer stops itself after about 20 seconds of counted time, before it has run or changed anything, and its lock goes with it', async (t) => {
  const where = await makeHome(t);
  // Nothing from outside the Installer (a page) is given any real time: the wait is only counted.
  await fakeMachine(where.home).setWaiting({ outside: 0 });

  const from = performance.now();
  const result = await run(['--profile', 'york', '--home', where.home, '--downloads', where.downloads]);
  const took = performance.now() - from;

  assert.notEqual(result.code, 0, 'a run that stopped');
  assert.ok(took < 10_000, `it counted the 20 seconds rather than waiting them: ${Math.round(took)} ms`);
  const log = await readOnlyLog(where.home);
  assert.match(log.text, /Front end: the Installer page/);
  assert.match(log.text, /No page connected within 20 seconds, so the Installer stops, for the Bootstrap to run it in the window/);
  assert.equal(await exists(addressFile(where.home)), false, 'the lock is gone');
  assert.equal(await exists(connectedFile(where.home)), false);
  assert.equal(await exists(join(stateFolder(where.home), 'settings.json')), false);
  assert.deepEqual(await fakeMachine(where.home).runs(), [], 'nothing was run');
});

test("a page counts as connected only once the connected file is written: one that can't be is told to the log, and the run stops as with no page, before running anything", async (t) => {
  const where = await makeHome(t);
  // A folder where the file goes, so it can't be written.
  await mkdir(connectedFile(where.home), { recursive: true });

  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  const result = await run.ended;
  page.close();

  assert.equal(result.code, 3, result.stdout + result.stderr);
  const log = await readOnlyLog(where.home);
  assert.match(log.text, /A page connected, but page-connected\.txt couldn't be written \(.+\), so the Installer stops, for the Bootstrap to run it in the window/);
  assert.equal(await exists(addressFile(where.home)), false, 'the lock is gone');
  assert.deepEqual(await fakeMachine(where.home).runs(), [], 'nothing was run');
});

test("an Installer run in the window with --terminal holds the lock too, with no page's address, so a second paste leaves it be; an answers-file run holds none", async (t) => {
  const where = await makeHome(t);
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.WT_SESSION;
  const child = spawn(process.execPath, [program, '--profile', 'york', '--terminal', '--home', where.home, '--downloads', where.downloads], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  t.after(() => child.kill());
  let stdout = '';
  await new Promise((resolve, reject) => {
    const giveUp = setTimeout(() => reject(new Error(`no question in the window:\n${stdout}`)), 20_000);
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('Which team are you in?')) resolve(clearTimeout(giveUp));
    });
  });
  const lock = await readFile(addressFile(where.home), 'utf8').catch(() => undefined);
  child.kill();
  await new Promise((resolve) => child.once('close', resolve));
  const filed = await makeHome(t, { channel: 'stable' });
  const fromFile = await runWith(filed, 'york');

  assert.deepEqual(lock?.split(/\r?\n/), ['', String(child.pid), '']);
  assert.equal(fromFile.code, 0, fromFile.stderr);
  assert.equal(await exists(addressFile(filed.home)), false, 'an answers-file run, with nobody at the screen, holds no lock');
});

const signedOut = { code: 1, output: JSON.stringify({ loggedIn: false, authMethod: 'none' }) };
const signedIn = { output: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'jo.bloggs@york.ac.uk' }) };

/**
 * A laptop where the run starts each kind of program: some run and waited for, Claude Code's
 * sign-in on the front end's screen, and T3 Code (installed by this run, which doesn't start it)
 * left running at the end.
 * @param {import('node:test').TestContext} t
 */
async function aLaptopThatRunsEveryKind(t) {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.3');
  await mkdir(dirname(join(where.home, claudeProgram)), { recursive: true });
  await writeFile(join(where.home, claudeProgram), 'already here');
  await fakeMachine(where.home).setReplies({
    'claude.exe --version': { output: '2.1.317 (Claude Code)\n' },
    'claude.exe auth status': [signedOut, signedIn],
    'claude.exe auth login': { output: 'Login successful.\n' },
    [`${installer} /S --force-run`]: { creates: [t3Leaves.program] },
    [`${installer} /S`]: { creates: [t3Leaves.program] },
  });
  return where;
}

test("on the page, every program the Installer starts gets piped input, never the hidden console's, as the terminal's on-screen programs get the window's", async (t) => {
  const onPage = await aLaptopThatRunsEveryKind(t);
  const inWindow = await aLaptopThatRunsEveryKind(t);

  const run = await runOnPage(onPage, 'york');
  t.after(run.kill);
  await answerEverything(run.connect(), run.answer, { channel: 'stable' });
  const result = await run.ended;
  const filed = await runWith(inWindow, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(filed.code, 0, filed.stdout + filed.stderr);
  const runs = await fakeMachine(onPage.home).runs();
  assert.ok(runs.some((ran) => ran.onScreen) && runs.some((ran) => ran.leftRunning), `each kind of program was started: ${JSON.stringify(runs, null, 2)}`);
  assert.deepEqual(runs.filter((ran) => ran.input !== 'pipe'), [], 'every program on the page was given piped input');
  const windowRuns = await fakeMachine(inWindow.home).runs();
  assert.deepEqual(
    windowRuns.filter((ran) => ran.onScreen).map((ran) => ran.input),
    windowRuns.filter((ran) => ran.onScreen).map(() => 'inherit'),
    "in the window, a program on screen reads the person's window",
  );
  assert.deepEqual(windowRuns.filter((ran) => !ran.onScreen && ran.input !== 'pipe'), [], 'and every other program a pipe');
});

test("the page never tells an app window from a tab by the browser's toolbar, which is visible in an app window too (display-mode: standalone says)", async () => {
  // Found on a York laptop (#90): window.toolbar.visible is true in Chrome's --app window as well.
  const folder = join(repo, 'installer', 'page');
  for (const name of await readdir(folder)) {
    if (!/\.(js|css|html)$/.test(name)) continue;
    assert.doesNotMatch(await readFile(join(folder, name), 'utf8'), /\btoolbar\b/, name);
  }
});
