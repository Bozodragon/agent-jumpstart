// The Installer's side of the Bootstrap's handoff (Seam 2): the files the Bootstrap reads, the
// Installer stopping itself when no page connects, and programs never given the hidden console's
// input. The Bootstrap's own side is checked in pasted-lines.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, fakeMachine, makeHome, readOnlyLog, run, stateFolder } from './harness.js';
import { addressFile, connectedFile, runOnPage } from './page-harness.js';

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
