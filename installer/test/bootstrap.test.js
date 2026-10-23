// The bootstrap's side of the contract: the flags the pasted lines pass to the program.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHome, readOnlyLog, run } from './harness.js';

/** @param {{ home: string, downloads: string, answersFile: string }} where @param {string[]} extra */
const runAsBootstrap = (where, extra) =>
  run(['--profile', 'york', ...extra, '--home', where.home, '--answers', where.answersFile, '--downloads', where.downloads]);

test('the debug line starts the program with debug on, and the log says so', async (t) => {
  const where = await makeHome(t);

  const result = await runAsBootstrap(where, ['--debug']);

  assert.equal(result.code, 0, result.stderr);
  const log = await readOnlyLog(where.home);
  assert.match(log.text, /Debug: on/);
});

test('the ordinary lines start the program with debug off', async (t) => {
  const where = await makeHome(t);

  const result = await runAsBootstrap(where, []);

  assert.equal(result.code, 0, result.stderr);
  const log = await readOnlyLog(where.home);
  assert.match(log.text, /Debug: off/);
});
