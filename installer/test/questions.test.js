import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeHome, readOnlyLog, readSettings, runWith } from './harness.js';

/** Everything in a home except the installer's own folder, which always holds a log. */
async function homeContents(/** @type {string} */ home) {
  const own = join('AppData', 'Local', 'agent-jumpstart');
  // The fake machine's record of pages opened in the browser: opening one changes nothing.
  const pages = join('fake-machine', 'pages.json');
  return (await readdir(home, { recursive: true }))
    .filter((path) => !path.startsWith(own) && !own.startsWith(path) && path !== pages && !pages.startsWith(path))
    .sort();
}

test('a york run with nothing answered takes every default: the Drive folder it found, stable, no GitHub, the ticked lists', async (t) => {
  const where = await makeHome(t);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(await readSettings(where.home), {
    profile: 'york',
    googleDriveFolder: join(where.home, 'My Drive'),
    workspacesLocation: join(where.home, 'My Drive'),
    channel: 'stable',
    github: false,
    workspaces: ['Thinking space', 'Personal assistant'],
    connectors: ['Gmail', 'Google Drive', 'Google Calendar'],
    extraTools: [],
    topWorkspace: join(where.home, 'My Drive', 'Claude'),
    skillsInstalled: [],
    switchOffMemory: true,
    autoMemory: 'off',
    email: null,
  });
});

test('a york run answered from a file asks nothing and writes exactly those answers to the settings file', async (t) => {
  const where = await makeHome(t);
  const otherDrive = join(where.home, 'Other Drive');
  await mkdir(otherDrive);
  const answers = {
    googleDriveFolder: otherDrive,
    channel: 'nightly',
    github: true,
    workspaces: ['Personal assistant'],
    connectors: ['Gmail', 'Asana', 'Google Sheets'],
    extraTools: ['apps-script'],
  };
  await writeFile(where.answersFile, JSON.stringify(answers));

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(await readSettings(where.home), {
    profile: 'york',
    ...answers,
    workspacesLocation: otherDrive,
    topWorkspace: join(otherDrive, 'Claude'),
    skillsInstalled: [],
    switchOffMemory: true,
    autoMemory: 'off',
    email: null,
  });
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes('Answer: channel: "nightly"'), log.text);
});

test('a default run asks where workspaces should live, offering Documents, and never looks for Google Drive', async (t) => {
  const where = await makeHome(t, {}, { googleDrive: 'missing' });

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(await readSettings(where.home), {
    profile: 'default',
    googleDriveFolder: null,
    workspacesLocation: join(where.home, 'Documents'),
    channel: 'stable',
    github: false,
    workspaces: ['Thinking space', 'Personal assistant'],
    connectors: ['Gmail', 'Google Drive', 'Google Calendar'],
    extraTools: [],
    topWorkspace: join(where.home, 'Documents', 'Claude'),
    skillsInstalled: [],
    switchOffMemory: true,
    autoMemory: 'off',
    email: null,
  });
});

test('a default run answered from a file puts workspaces where the answer says, with nothing ticked if so answered', async (t) => {
  const where = await makeHome(t);
  const elsewhere = join(where.home, 'Work', 'Agents');
  await writeFile(
    where.answersFile,
    JSON.stringify({ workspacesLocation: elsewhere, workspaces: [], connectors: [], extraTools: [] }),
  );

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.equal(settings.workspacesLocation, elsewhere);
  assert.deepEqual([settings.workspaces, settings.connectors, settings.extraTools], [[], [], []]);
});

for (const [answers, message] of /** @type {[object, string][]} */ ([
  [{ workspaces: ['Thinking space', 'Recruitment'] }, `The answers file's "workspaces" is wrong: "Recruitment" isn't one of "Thinking space", "Personal assistant".`],
  [{ channel: 'beta' }, `The answers file's "channel" is wrong: it should be one of "stable", "nightly".`],
  [{ googleDriveFolder: 'Z:\\Nowhere\\My Drive' }, `The answers file's "googleDriveFolder" is wrong: There is no folder at Z:\\Nowhere\\My Drive.`],
])) {
  test(`a wrong answer in the answers file (${Object.keys(answers)[0]}) stops the run with a plain message and writes no settings`, async (t) => {
    const where = await makeHome(t, answers);

    const result = await runWith(where, 'york');

    assert.equal(result.code, 1);
    assert.ok(result.stdout.includes(message), result.stdout);
    await assert.rejects(readSettings(where.home), { code: 'ENOENT' });
  });
}

for (const [state, message] of [
  ['missing', "Google Drive for desktop is needed first, and it isn't on this laptop"],
  ['signed-out', 'Google Drive for desktop is installed but not signed in.'],
]) {
  test(`a york run with Google Drive for desktop ${state} says so plainly and stops before creating anything`, async (t) => {
    const where = await makeHome(t, {}, { googleDrive: /** @type {'missing' | 'signed-out'} */ (state) });
    const before = await homeContents(where.home);

    const result = await runWith(where, 'york');

    assert.equal(result.code, 1);
    assert.ok(result.stdout.includes(message), result.stdout);
    assert.ok(result.stdout.includes('Nothing has been changed.'), result.stdout);
    await assert.rejects(readSettings(where.home), { code: 'ENOENT' });
    assert.deepEqual(await homeContents(where.home), before);
    const log = await readOnlyLog(where.home);
    assert.match(log.text, /Stopped: .*Google Drive for desktop/);
  });
}
