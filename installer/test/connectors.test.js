import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHome, readOnlyLog, readProfile, runWith } from './harness.js';

test('the checklist lists the connectors the answers file says were connected, in the person\'s words', async (t) => {
  const where = await makeHome(t, { connectors: ['Gmail', 'Asana', 'Google Sheets'] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const log = await readOnlyLog(where.home);
  assert.ok(
    log.text.includes('Checklist: Connectors: You said you connected Gmail, Asana and Google Sheets'),
    log.text,
  );
  assert.match(result.stdout, /Connectors\s+You said you connected Gmail, Asana and Google Sheets/);
});

test('the walkthrough names each chosen connector beside the profile\'s connectors page, and with answers from a file opens nothing', async (t) => {
  const where = await makeHome(t);
  const profile = await readProfile('york');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes(`Connectors page: ${profile.connectorsPage}`), result.stdout);
  for (const name of ['Gmail', 'Google Drive', 'Google Calendar']) {
    assert.match(result.stdout, new RegExp(`[•-] ${name}\\s`), `${name} should be named on screen`);
  }
  assert.doesNotMatch(result.stdout, /[•-] Asana/);
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes(`Connectors page: ${profile.connectorsPage} (not opened: answers came from a file)`), log.text);
  assert.ok(log.text.includes('Checklist: Connectors: You said you connected Gmail, Google Drive and Google Calendar'), log.text);
});

test('with no connectors chosen the walkthrough is skipped and the checklist says none were chosen', async (t) => {
  const where = await makeHome(t, { connectors: [] });
  const profile = await readProfile('default');

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.ok(!result.stdout.includes(profile.connectorsPage), result.stdout);
  assert.match(result.stdout, /Connectors\s+None chosen/);
  const log = await readOnlyLog(where.home);
  assert.ok(!log.text.includes(profile.connectorsPage), log.text);
  assert.ok(log.text.includes('Checklist: Connectors: None chosen'), log.text);
});
