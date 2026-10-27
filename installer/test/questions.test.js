import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fakeMachine, makeHome, readOnlyLog, readProfile, readSettings, runWith } from './harness.js';

/**
 * Everything in a home except the installer's own folder, which always holds a log, and the fake
 * machine's records of what only looks: the pages opened in the browser, and the programs run if
 * every one of them was a registry query (such as T3's installed version).
 */
async function homeContents(/** @type {string} */ home) {
  const own = join('AppData', 'Local', 'agent-jumpstart');
  const lookedOnly = [join('fake-machine', 'pages.json')];
  const runs = await fakeMachine(home).runs();
  if (runs.every((run) => basename(run.file) === 'reg.exe' && run.args[0] === 'query')) lookedOnly.push(join('fake-machine', 'runs.json'));
  return (await readdir(home, { recursive: true }))
    .filter((path) => !path.startsWith(own) && !own.startsWith(path) && !lookedOnly.some((file) => path === file || file.startsWith(path)))
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

test('a york run answering "new" for the top workspace makes it in the Drive folder it found, as a run that answers nothing does', async (t) => {
  const where = await makeHome(t, { topWorkspace: 'new' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.deepEqual(
    [settings.topWorkspace, settings.workspacesLocation, settings.googleDriveFolder],
    [join(where.home, 'My Drive', 'Claude'), join(where.home, 'My Drive'), join(where.home, 'My Drive')],
  );
});

/** @param {string} text */
const flowing = (text) => text.replace(/[│|]/g, ' ').replace(/\s+/g, ' ');

for (const [state, message, answers] of /** @type {['missing' | 'signed-out', string, object][]} */ ([
  ['missing', "Google Drive for desktop is needed first, and it isn't on this laptop", {}],
  ['signed-out', 'Google Drive for desktop is installed but not signed in.', {}],
  ['missing', "Google Drive for desktop is needed first, and it isn't on this laptop", { topWorkspace: 'new' }],
  ['signed-out', 'Google Drive for desktop is installed but not signed in.', { topWorkspace: 'new' }],
])) {
  test(`a york run making a new top workspace${'topWorkspace' in answers ? ' (answered "new")' : ' (the default)'} with Google Drive for desktop ${state} says how to get it ready, and with nobody to wait for, stops before creating anything`, async (t) => {
    const where = await makeHome(t, answers, { googleDrive: state });
    const profile = await readProfile('york');
    const before = await homeContents(where.home);

    const result = await runWith(where, 'york');

    assert.equal(result.code, 1);
    // How to get it, in the profile's words where it's missing.
    const how = state === 'missing' ? profile.googleDrive.install : 'Open Google Drive from the Start menu and sign in';
    assert.ok(flowing(result.stdout).includes(flowing(how)), result.stdout);
    assert.ok(result.stdout.includes(message), result.stdout);
    assert.ok(result.stdout.includes('Nothing has been changed.'), result.stdout);
    await assert.rejects(readSettings(where.home), { code: 'ENOENT' });
    assert.deepEqual(await homeContents(where.home), before);
    const log = await readOnlyLog(where.home);
    assert.match(log.text, /Stopped: .*Google Drive for desktop/);
  });
}

test('My Drive that appears a few seconds after Google Drive signs in is looked for again, and offered, rather than asked for', async (t) => {
  const where = await makeHome(t, {}, { googleDrive: 'signed-in, no My Drive yet' });
  const myDrive = join(where.home, 'My Drive');
  await fakeMachine(where.home).setWaiting({ patience: 10_000, appears: [{ after: 4_000, folders: ['My Drive'] }] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.deepEqual([settings.googleDriveFolder, settings.topWorkspace], [myDrive, join(myDrive, 'Claude')]);
  assert.ok((await readOnlyLog(where.home)).text.includes(`Google Drive for desktop: My Drive found at ${myDrive} after 4 seconds`));
});

test("My Drive that doesn't appear while the installer waits for it is asked for, as before", async (t) => {
  const where = await makeHome(t, {}, { googleDrive: 'signed-in, no My Drive yet' });
  await fakeMachine(where.home).setWaiting({ patience: 6_000 });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.ok(result.stdout.includes(`The answers file's "googleDriveFolder" is wrong: it is needed, because no folder was found to offer as the default.`), result.stdout);
  assert.ok((await readOnlyLog(where.home)).text.includes('Google Drive for desktop: My Drive not found after 6 seconds, so where it is is asked'));
});
