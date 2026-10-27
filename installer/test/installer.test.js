import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fakeMachine, makeHome, readOnlyLog, readProfile, runWith, stateFolder } from './harness.js';

for (const id of ['york', 'default']) {
  test(`a ${id} run doesn't open its setup page again, writes settings and a dated log, and prints an honest checklist`, async (t) => {
    const where = await makeHome(t);
    const profile = await readProfile(id);
    const dayBefore = new Date().toLocaleDateString('en-CA');

    const result = await runWith(where, id);
    const dayAfter = new Date().toLocaleDateString('en-CA');

    assert.equal(result.code, 0, result.stderr);
    // The person has just pasted the line from it.
    assert.ok(!result.stdout.includes(profile.page), result.stdout);
    assert.ok(!(await fakeMachine(where.home).pagesOpened()).includes(profile.page));
    assert.match(result.stdout, /Checklist/);
    assert.match(result.stdout, /Not installed/);

    const settings = JSON.parse(await readFile(join(stateFolder(where.home), 'settings.json'), 'utf8'));
    assert.equal(settings.profile, id);

    const log = await readOnlyLog(where.home);
    assert.match(log.name, new RegExp(`^install-(${dayBefore}|${dayAfter})-\\d{6}\\.log$`));
    assert.match(log.text, /Not installed/);
  });
}

test('an unknown profile stops with a plain message, exits non-zero and writes no settings', async (t) => {
  const where = await makeHome(t);

  const result = await runWith(where, 'nowhere');

  assert.equal(result.code, 1);
  assert.ok(result.stdout.includes('There is no profile called "nowhere". The profiles are: default, york.'), result.stdout);
  await assert.rejects(readFile(join(stateFolder(where.home), 'settings.json')), { code: 'ENOENT' });
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes('Stopped: There is no profile called "nowhere"'), log.text);
});
