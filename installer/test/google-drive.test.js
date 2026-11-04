import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { exists, makeHome, readOnlyLog, readSettings, runWith, seedSettings } from './harness.js';

/** @param {string} text */
const flowing = (text) => text.replace(/[│|]/g, ' ').replace(/\s+/g, ' ');

/** What the installer says when Google Drive for desktop isn't on the laptop. */
const documentsText =
  "Google Drive isn't on this laptop. Your workspaces can go in Documents instead. They'll be on this laptop only, so they aren't backed up and you can't reach them from another device. Or install Google Drive for desktop first, then paste the line again.";

/** @param {string} folder */
const foldersIn = async (folder) =>
  (await readdir(folder, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

for (const answers of [{}, { topWorkspace: 'new' }, { withoutGoogleDrive: 'documents' }]) {
  test(`a york run making a new top workspace without Google Drive for desktop says Documents can be used and, answered ${JSON.stringify(answers)}, makes it in Documents and finishes`, async (t) => {
    const where = await makeHome(t, answers, { googleDrive: 'missing' });
    const documents = join(where.home, 'Documents');
    const top = join(documents, 'Claude');

    const result = await runWith(where, 'york');

    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.ok(flowing(result.stdout).includes(documentsText), result.stdout);
    // Nothing is downloadable in this test, so 32's ending names the steps that didn't work; the run still got to its end.
    assert.match(flowing(result.stdout), /What to do next|These steps didn't work/);
    const settings = await readSettings(where.home);
    assert.deepEqual([settings.topWorkspace, settings.workspacesLocation, settings.googleDriveFolder], [top, documents, null]);
    assert.deepEqual(await foldersIn(top), ['Personal assistant', 'Thinking space']);
    assert.equal(await exists(join(where.home, 'My Drive')), false);
    assert.ok((await readOnlyLog(where.home)).text.includes('Answer: withoutGoogleDrive: "documents"'));
  });
}

test("a york run whose person chooses to install Google Drive first ends cleanly, saying to paste the line again, with nothing made", async (t) => {
  const where = await makeHome(t, { withoutGoogleDrive: 'install-first' }, { googleDrive: 'missing' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.ok(flowing(result.stdout).includes(documentsText), result.stdout);
  assert.match(flowing(result.stdout), /paste the same line again/);
  assert.doesNotMatch(result.stdout, /Nothing has been changed|Done before it stopped|What to do next|All done|didn't work/);
  await assert.rejects(readSettings(where.home), { code: 'ENOENT' });
  assert.equal(await exists(join(where.home, 'Documents')), false);
  assert.equal(await exists(join(where.home, 'My Drive')), false);
  const log = (await readOnlyLog(where.home)).text;
  assert.ok(log.includes('Answer: withoutGoogleDrive: "install-first"'), log);
  assert.doesNotMatch(log, /Stopped:|Failed:/);
});

test('a wrong answer to what to do without Google Drive says which ones are right', async (t) => {
  const where = await makeHome(t, { withoutGoogleDrive: 'later' }, { googleDrive: 'missing' });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.ok(result.stdout.includes(`The answers file's "withoutGoogleDrive" is wrong: it should be one of "documents", "install-first".`), result.stdout);
});

test('a york run with Google Drive for desktop installed but never opened asks the person to open it and sign in, not to install it', async (t) => {
  const where = await makeHome(t, {}, { googleDrive: 'installed, never opened' });

  const result = await runWith(where, 'york');

  const text = flowing(result.stdout);
  assert.ok(text.includes('Google Drive for desktop is installed but has never been opened.'), result.stdout);
  assert.ok(text.includes('Open Google Drive from the Start menu and sign in'), result.stdout);
  assert.doesNotMatch(text, /isn't on this laptop|Install Google Drive|Software Centre/);
  // With nobody at the screen to wait for, the run stops before making anything.
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.ok(text.includes('Nothing has been changed.'), result.stdout);
  assert.equal(await exists(join(where.home, 'Documents')), false);
  assert.ok((await readOnlyLog(where.home)).text.includes('Google Drive for desktop: installed, never opened'));
});

for (const state of /** @type {const} */ (['installed, never opened', 'signed-out'])) {
  test(`a york run with Google Drive for desktop ${state} can use Documents instead, and finishes`, async (t) => {
    const where = await makeHome(t, { googleDriveReady: 'documents' }, { googleDrive: state });
    const documents = join(where.home, 'Documents');

    const result = await runWith(where, 'york');

    assert.equal(result.code, 0, result.stdout + result.stderr);
    const settings = await readSettings(where.home);
    assert.deepEqual([settings.topWorkspace, settings.googleDriveFolder], [join(documents, 'Claude'), null]);
  });
}

test('a york run with Google Drive for desktop signed in makes the top workspace in My Drive, as before, and says nothing about Documents', async (t) => {
  const where = await makeHome(t);
  const myDrive = join(where.home, 'My Drive');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.doesNotMatch(flowing(result.stdout), /Documents|isn't on this laptop/);
  const settings = await readSettings(where.home);
  assert.deepEqual([settings.topWorkspace, settings.googleDriveFolder], [join(myDrive, 'Claude'), myDrive]);
});

test('a re-run with Google Drive signed in since leaves the top workspace in Documents where it is', async (t) => {
  const where = await makeHome(t, { topWorkspace: 'a question was asked', googleDriveFolder: 'a question was asked', withoutGoogleDrive: 'a question was asked' });
  const documents = join(where.home, 'Documents');
  const top = join(documents, 'Claude');
  await mkdir(top, { recursive: true });
  await seedSettings(where.home, { profile: 'york', googleDriveFolder: null, workspacesLocation: documents, topWorkspace: top });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await readSettings(where.home)).topWorkspace, top);
  assert.deepEqual(await foldersIn(top), ['Personal assistant', 'Thinking space']);
  assert.deepEqual(await foldersIn(join(where.home, 'My Drive')), []);
});
