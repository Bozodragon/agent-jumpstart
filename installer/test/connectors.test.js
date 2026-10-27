import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeMachine, makeHome, readOnlyLog, readProfile, runWith } from './harness.js';

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

test('the walkthrough names each chosen connector beside the profile\'s connectors page, opened on the fake machine under --home', async (t) => {
  const where = await makeHome(t);
  const profile = await readProfile('york');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes(`Connectors page: ${profile.connectorsPage}`), result.stdout);
  const flowing = result.stdout.replace(/[│|]/g, ' ').replace(/\s+/g, ' ');
  // The page's heading reads Customize, so the notice says so.
  assert.ok(flowing.includes("This opens claude.ai's Customize page, on Connectors."), result.stdout);
  // Each chosen connector by name, with what it lets the agent do.
  assert.ok(flowing.includes('Gmail: search and read your email, and write drafts for you to check and send'), result.stdout);
  for (const name of ['Gmail', 'Google Drive', 'Google Calendar']) {
    const { what } = profile.connectors.find((/** @type {{ name: string }} */ connector) => connector.name === name);
    assert.ok(flowing.includes(`${name}: ${what}`), `${name} should be named on screen with what it does`);
  }
  assert.doesNotMatch(result.stdout, /[•-] Asana/);
  assert.ok(flowing.includes('The agent uses them as you, and only for what you ask it to do. You can disconnect any of them on the same page.'), result.stdout);
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes(`Connectors page: ${profile.connectorsPage} (opened)`), log.text);
  assert.ok((await fakeMachine(where.home).pagesOpened()).includes(profile.connectorsPage));
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
