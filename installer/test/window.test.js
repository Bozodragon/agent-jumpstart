// The window the person pasted the line into: the log says whether it was Windows Terminal, and
// every notice that ends with pressing Enter names the window the same way. The window's title
// can't be seen from here, so a person checks that on a York laptop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHome, readOnlyLog, runWith } from './harness.js';

test('the log says the run was in Windows Terminal when WT_SESSION is set', async (t) => {
  const where = await makeHome(t);

  const result = await runWith(where, 'default', [], { windowsTerminal: true });

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const { text } = await readOnlyLog(where.home);
  assert.match(text, /^.*Window: Windows Terminal$/m);
  assert.doesNotMatch(text, /Window: not Windows Terminal/);
});

test('the log says the window was most likely the old console when WT_SESSION is unset, even if the tests run in Windows Terminal', async (t) => {
  const where = await makeHome(t);
  const inherited = process.env.WT_SESSION;
  process.env.WT_SESSION = 'the window the tests run in';
  t.after(() => {
    if (inherited === undefined) delete process.env.WT_SESSION;
    else process.env.WT_SESSION = inherited;
  });

  const result = await runWith(where, 'default', [], { windowsTerminal: false });

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const { text } = await readOnlyLog(where.home);
  assert.match(text, /^.*Window: not Windows Terminal, most likely the old console$/m);
  assert.doesNotMatch(text, /Window: Windows Terminal/);
});

test("Google Drive's notice to sign in ends with the same come-back sentence as the pages' notices, and no run calls the window the blue PowerShell window", async (t) => {
  const where = await makeHome(t, {}, { googleDrive: 'signed-out' });

  const result = await runWith(where, 'york');

  const flowing = result.stdout.replace(/[│|]/g, ' ').replace(/\s+/g, ' ');
  assert.ok(
    flowing.includes("Once you're done in the browser, come back to the Agent Jumpstart window, where you pasted the line, and press Enter."),
    result.stdout,
  );
  assert.doesNotMatch(result.stdout + result.stderr, /blue PowerShell window/);
});
