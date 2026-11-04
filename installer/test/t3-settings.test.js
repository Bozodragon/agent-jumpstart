// T3 Code is set up for the person rather than walked through: before T3 first starts, its
// first-run wizard is marked done, new threads default to the profile's model and effort, Codex
// is off, and the floating island shows usage and context. T3 reads its files only when it
// starts, so on a fresh install they must be there before its silent install starts it. On a T3
// that was already there, only the settings that are missing are added, on every run: whatever
// the person already has stays as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { exists, fakeMachine, makeHome, readOnlyLog, readProfile, runWith, supplyT3, t3Leaves } from './harness.js';

/** T3's data folder, relative to the home, and the two files the installer writes in it. */
const userdata = join('.t3', 'userdata');
const clientSettings = join(userdata, 'client-settings.json');
const settings = join(userdata, 'settings.json');

/** T3's uninstall entry, where Windows keeps the installed version. */
const uninstallKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\e9197887-efb3-55e0-985e-d6d3b5dd594a';

/** What the installer writes for the profile's model, effort and Codex setting. */
const ourSettings = {
  providerInstances: { codex: { driver: 'codex', enabled: false } },
  defaultModelSelection: { instanceId: 'claudeAgent', model: 'claude-opus-5-5', options: [{ id: 'effort', value: 'medium' }] },
};

/** What the person already has in their T3 Code, with values the installer would otherwise set. */
const theirSettings = {
  providerInstances: { codex: { driver: 'codex', enabled: true }, claudeAgent_work: { driver: 'claudeAgent', enabled: true } },
  defaultModelSelection: { instanceId: 'codex', model: 'gpt-6', options: [] },
};
const theirClient = { onboardingCompletedAt: '2026-01-02T03:04:05.678Z', fontSizeCode: 15, contextWindowMeterEnabled: true };

/**
 * A laptop without T3, whose stable installer, when run, reads T3's two settings files as T3
 * does when the install starts it, and leaves the program and shim.
 * @param {import('node:test').TestContext} t
 */
async function aLaptopWithoutT3(t) {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.3');
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    [`${installer} /S --force-run`]: { reads: [clientSettings, settings], creates: [t3Leaves.program, t3Leaves.shim] },
  });
  return { where, installer, machine };
}

/**
 * A laptop whose T3 is already installed and has been opened.
 * @param {import('node:test').TestContext} t
 */
async function aLaptopWithT3(t) {
  const where = await makeHome(t);
  await supplyT3(where.downloads, 'latest.yml', '0.1.3');
  for (const path of [t3Leaves.program, t3Leaves.shim]) {
    await mkdir(join(where.home, path, '..'), { recursive: true });
    await writeFile(join(where.home, path), 'already here');
  }
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    [`reg.exe query ${uninstallKey} /v DisplayVersion`]: { output: '    DisplayVersion    REG_SZ    0.1.2\r\n' },
  });
  return { where, machine };
}

/** @param {{ home: string }} where @param {string} file */
async function read(where, file) {
  return JSON.parse(await readFile(join(where.home, file), 'utf8'));
}

/** The person's own settings files, as T3 wrote them. @param {{ home: string }} where @param {object} [client] @param {object} [server] */
async function seed(where, client, server) {
  await mkdir(join(where.home, userdata), { recursive: true });
  if (client) await writeFile(join(where.home, clientSettings), JSON.stringify(client));
  if (server) await writeFile(join(where.home, settings), JSON.stringify(server));
}

test('a fresh T3 install finds its first-run wizard done, Codex off, new threads on Claude Opus 5.5 at Medium, and usage and context on, written before it first starts', async (t) => {
  const { where, installer, machine } = await aLaptopWithoutT3(t);
  const startedBefore = Date.now();

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const client = await read(where, clientSettings);
  assert.deepEqual(Object.keys(client), ['onboardingCompletedAt', 'threadDetailsItems']);
  assert.match(client.onboardingCompletedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(Date.parse(client.onboardingCompletedAt) >= startedBefore - 1000);
  assert.deepEqual(client.threadDetailsItems, { usage: true, context: true });
  assert.deepEqual(await read(where, settings), ourSettings);
  // T3's installer starts T3, which reads both as it starts: they were there by then.
  const install = (await machine.runs()).find((run) => basename(run.file) === installer);
  assert.deepEqual(install?.found, [clientSettings, settings]);
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes(`T3 Code: wrote ${join(where.home, settings)}`), log.text);
});

test('the model, effort and Codex come from the profile', async (t) => {
  const york = await readProfile('york');
  const fallback = await readProfile('default');
  for (const profile of [york, fallback]) assert.deepEqual(profile.t3, { defaultModel: 'claude-opus-5-5', effort: 'medium', codex: false });
});

test('a settings file already in T3\'s data folder on a fresh install keeps the person\'s values and gains only what is missing, before T3 first starts', async (t) => {
  const { where, installer, machine } = await aLaptopWithoutT3(t);
  await seed(where, undefined, { defaultModelSelection: theirSettings.defaultModelSelection });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(await read(where, settings), {
    defaultModelSelection: theirSettings.defaultModelSelection,
    providerInstances: ourSettings.providerInstances,
  });
  assert.deepEqual((await read(where, clientSettings)).threadDetailsItems, { usage: true, context: true });
  const install = (await machine.runs()).find((run) => basename(run.file) === installer);
  assert.deepEqual(install?.found, [clientSettings, settings]);
});

test('a T3 already installed with no settings files gets them, with only the installer\'s own keys', async (t) => {
  const { where } = await aLaptopWithT3(t);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const client = await read(where, clientSettings);
  assert.deepEqual(Object.keys(client), ['onboardingCompletedAt', 'threadDetailsItems']);
  assert.deepEqual(client.threadDetailsItems, { usage: true, context: true });
  assert.deepEqual(await read(where, settings), ourSettings);
});

test('a T3 already installed keeps every value the person has and gains only the keys that are missing', async (t) => {
  const { where } = await aLaptopWithT3(t);
  await seed(where, { fontSizeCode: 15, contextWindowMeterEnabled: true }, { providerInstances: { claudeAgent_work: { driver: 'claudeAgent', enabled: true } } });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const client = await read(where, clientSettings);
  assert.equal(client.fontSizeCode, 15);
  assert.equal(client.contextWindowMeterEnabled, true);
  assert.match(client.onboardingCompletedAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(client.threadDetailsItems, { usage: true, context: true });
  assert.deepEqual(await read(where, settings), {
    providerInstances: { claudeAgent_work: { driver: 'claudeAgent', enabled: true }, codex: ourSettings.providerInstances.codex },
    defaultModelSelection: ourSettings.defaultModelSelection,
  });
});

test('a T3 already installed whose person has Codex on and another default model has those choices left as they are', async (t) => {
  const { where } = await aLaptopWithT3(t);
  await seed(where, theirClient, theirSettings);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(await read(where, settings), theirSettings);
  const client = await read(where, clientSettings);
  assert.equal(client.onboardingCompletedAt, theirClient.onboardingCompletedAt);
  assert.equal(client.fontSizeCode, 15);
});

test('a threadDetailsItems the person already has, even with usage or context off, is left as it is', async (t) => {
  for (const theirs of [{ usage: false, context: true }, { usage: true, context: false }, { usage: false }, {}]) {
    const { where } = await aLaptopWithT3(t);
    await seed(where, { ...theirClient, threadDetailsItems: theirs });

    const result = await runWith(where, 'york');

    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.deepEqual((await read(where, clientSettings)).threadDetailsItems, theirs, JSON.stringify(theirs));
  }
});

test('a second run keeps what the first one wrote and what the person changed in between', async (t) => {
  const { where } = await aLaptopWithT3(t);
  await runWith(where, 'york');
  const changed = { ...(await read(where, clientSettings)), threadDetailsItems: { usage: false, context: true } };
  await seed(where, changed);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(await read(where, clientSettings), changed);
  assert.deepEqual(await read(where, settings), ourSettings);
});

test('the legacy context meter is never written, whether T3 is new or already there', async (t) => {
  const fresh = await aLaptopWithoutT3(t);
  const existing = await aLaptopWithT3(t);
  await seed(existing.where, { fontSizeCode: 15 });

  for (const { where } of [fresh, existing]) {
    const result = await runWith(where, 'york');

    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal('contextWindowMeterEnabled' in (await read(where, clientSettings)), false);
  }
});

test('a settings file that isn\'t valid JSON is left as it was, and the run still finishes', async (t) => {
  const { where } = await aLaptopWithT3(t);
  await seed(where);
  await writeFile(join(where.home, clientSettings), '{ not json');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(await readFile(join(where.home, clientSettings), 'utf8'), '{ not json');
  assert.ok(await exists(join(where.home, settings)), 'the other file is still set up');
  assert.ok((await readOnlyLog(where.home)).text.includes(`T3 Code: ${join(where.home, clientSettings)} can't be read`));
});
