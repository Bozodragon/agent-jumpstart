// A run that stops says honestly what it had done: nothing, or what it had changed so far. The
// same goes for Ctrl+C at any prompt, which no test can press; a list of versions that can't be
// read stops the run the same way, after the answers are saved and the workspaces made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeHome, readOnlyLog, readProfile, readSettings, runWith } from './harness.js';

test("a run that stops partway lists what it had already done, and doesn't say nothing has been changed", async (t) => {
  const where = await makeHome(t);
  const profile = await readProfile('york');
  const top = join(where.home, 'My Drive', profile.workspaces.top);
  await writeFile(join(where.downloads, 'manifest.json'), '{ "tools": [');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /The list of versions to install .* isn't valid/);
  assert.doesNotMatch(result.stdout, /Nothing has been changed/);
  assert.match(result.stdout, /Done before it stopped/);
  // The workspaces it created are listed (clack wraps their long paths, so the log holds them whole).
  for (const name of ['Thinking space', 'Personal assistant']) assert.match(result.stdout, new RegExp(`│\\s+${name}\\s`));
  assert.match(result.stdout, /Settings\s+Your answers, saved/);
  // What it listed is what it left behind.
  assert.equal((await readSettings(where.home)).topWorkspace, top);
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes(`Done before it stopped: ${profile.workspaces.top}: ${top}`), log.text);
});

test('a run that stops before changing anything says nothing has been changed', async (t) => {
  const where = await makeHome(t, { channel: 'beta' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Nothing has been changed\./);
  assert.doesNotMatch(result.stdout, /Done before it stopped/);
});
