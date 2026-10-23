import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const program = join(repo, 'installer', 'src', 'main.js');

/** @param {string} name */
async function readProfile(name) {
  return JSON.parse(await readFile(join(repo, 'profiles', `${name}.json`), 'utf8'));
}

/**
 * A temporary home with an answers file and an empty downloads folder,
 * removed when the test ends.
 * @param {import('node:test').TestContext} t
 * @param {object} [answers]
 */
async function makeHome(t, answers = {}) {
  const root = await mkdtemp(join(tmpdir(), 'jumpstart-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const downloads = join(root, 'downloads');
  const answersFile = join(root, 'answers.json');
  await mkdir(home);
  await mkdir(downloads);
  await writeFile(answersFile, JSON.stringify(answers));
  return { home, downloads, answersFile };
}

/**
 * Runs the real installer with the three test overrides.
 * @param {string[]} args
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function run(args) {
  return new Promise((resolve) => {
    const options = { env: { ...process.env, NO_COLOR: '1' }, timeout: 30_000 };
    execFile(process.execPath, [program, ...args], options, (error, stdout, stderr) => {
      resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr });
    });
  });
}

/** @param {{ home: string, downloads: string, answersFile: string }} where @param {string} profile */
function runWith(where, profile) {
  return run(['--profile', profile, '--home', where.home, '--answers', where.answersFile, '--downloads', where.downloads]);
}

/** @param {string} home */
function stateFolder(home) {
  return join(home, 'AppData', 'Local', 'agent-jumpstart');
}

/** @param {string} home */
async function readOnlyLog(home) {
  const logs = await readdir(join(stateFolder(home), 'logs'));
  assert.equal(logs.length, 1);
  return { name: logs[0], text: await readFile(join(stateFolder(home), 'logs', logs[0]), 'utf8') };
}

for (const id of ['york', 'default']) {
  test(`a ${id} run shows its setup page, writes settings and a dated log, and prints an honest checklist`, async (t) => {
    const where = await makeHome(t);
    const profile = await readProfile(id);
    const dayBefore = new Date().toLocaleDateString('en-CA');

    const result = await runWith(where, id);
    const dayAfter = new Date().toLocaleDateString('en-CA');

    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes(`Setup page: ${profile.page}`), result.stdout);
    assert.match(result.stdout, /Checklist/);
    assert.match(result.stdout, /Nothing was installed/);

    const settings = JSON.parse(await readFile(join(stateFolder(where.home), 'settings.json'), 'utf8'));
    assert.equal(settings.profile, id);

    const log = await readOnlyLog(where.home);
    assert.match(log.name, new RegExp(`^install-(${dayBefore}|${dayAfter})-\\d{6}\\.log$`));
    assert.ok(log.text.includes(profile.page), log.text);
    assert.match(log.text, /Nothing was installed/);
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
