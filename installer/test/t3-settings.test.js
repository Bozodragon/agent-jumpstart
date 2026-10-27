// T3 Code is set up for the person rather than walked through: on a fresh install, before T3
// first starts, its first-run wizard is marked done and new threads default to the profile's
// model and effort, with Codex off. T3 reads both files only when it starts, so they must be
// there before its silent install starts it. A T3 already on the laptop is left as it is.
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

test('a fresh T3 install finds its first-run wizard done, Codex off, and new threads on Claude Opus 5.5 at Medium, written before it first starts', async (t) => {
  const { where, installer, machine } = await aLaptopWithoutT3(t);
  const startedBefore = Date.now();

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const client = JSON.parse(await readFile(join(where.home, clientSettings), 'utf8'));
  assert.deepEqual(Object.keys(client), ['onboardingCompletedAt']);
  assert.match(client.onboardingCompletedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(Date.parse(client.onboardingCompletedAt) >= startedBefore - 1000);
  assert.deepEqual(JSON.parse(await readFile(join(where.home, settings), 'utf8')), {
    providerInstances: { codex: { driver: 'codex', enabled: false } },
    defaultModelSelection: { instanceId: 'claudeAgent', model: 'claude-opus-5-5', options: [{ id: 'effort', value: 'medium' }] },
  });
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

test('a settings file already in T3\'s data folder on a fresh install is left byte for byte as it was', async (t) => {
  const { where } = await aLaptopWithoutT3(t);
  const theirs = '{ "defaultModelSelection": { "instanceId": "codex", "model": "gpt-6" } }\n';
  await mkdir(join(where.home, userdata), { recursive: true });
  await writeFile(join(where.home, settings), theirs);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(await readFile(join(where.home, settings), 'utf8'), theirs);
  assert.ok(await exists(join(where.home, clientSettings)), 'the wizard is still marked done');
  assert.ok((await readOnlyLog(where.home)).text.includes(`T3 Code: ${join(where.home, settings)} is already there, so it's left as it is`));
});

test('a T3 already installed has neither settings file written', async (t) => {
  const where = await makeHome(t);
  await supplyT3(where.downloads, 'latest.yml', '0.1.3');
  for (const path of [t3Leaves.program, t3Leaves.shim]) {
    await mkdir(join(where.home, path, '..'), { recursive: true });
    await writeFile(join(where.home, path), 'already here');
  }
  await fakeMachine(where.home).setReplies({
    [`reg.exe query ${uninstallKey} /v DisplayVersion`]: { output: '    DisplayVersion    REG_SZ    0.1.2\r\n' },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(await exists(join(where.home, clientSettings)), false);
  assert.equal(await exists(join(where.home, settings)), false);
});
