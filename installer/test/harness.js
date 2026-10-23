// The one test seam: the real installer, run end to end in a temporary home with the
// three overrides, so tests see only what it leaves behind.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = fileURLToPath(new URL('../..', import.meta.url));
export const program = join(repo, 'installer', 'src', 'main.js');

/** @param {string} name */
export async function readProfile(name) {
  return JSON.parse(await readFile(join(repo, 'profiles', `${name}.json`), 'utf8'));
}

/** @typedef {'signed-in' | 'signed-out' | 'missing'} GoogleDriveState */

/**
 * A temporary home with an answers file and an empty downloads folder,
 * removed when the test ends. Like a York laptop, it has Google Drive for
 * desktop signed in and mirroring to `My Drive` in the home folder, unless
 * told otherwise.
 * @param {import('node:test').TestContext} t
 * @param {object} [answers]
 * @param {{ googleDrive?: GoogleDriveState }} [options]
 */
export async function makeHome(t, answers = {}, { googleDrive = 'signed-in' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'jumpstart-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const downloads = join(root, 'downloads');
  const answersFile = join(root, 'answers.json');
  await mkdir(home);
  await mkdir(downloads);
  await writeFile(answersFile, JSON.stringify(answers));
  await fakeGoogleDrive(home, googleDrive);
  return { home, downloads, answersFile };
}

/** The account folder Google Drive for desktop keeps per signed-in account, named by Google account number. */
const driveAccount = '104857600123456789012';

/**
 * Leaves the traces Google Drive for desktop leaves in a profile folder: its
 * data folder in local AppData (with one folder per signed-in account) and,
 * when signed in, the mirrored `My Drive` folder.
 * @param {string} home
 * @param {GoogleDriveState} state
 */
export async function fakeGoogleDrive(home, state) {
  if (state === 'missing') return;
  const data = join(home, 'AppData', 'Local', 'Google', 'DriveFS');
  await mkdir(join(data, 'Logs'), { recursive: true });
  if (state === 'signed-in') {
    await mkdir(join(data, driveAccount), { recursive: true });
    await mkdir(join(home, 'My Drive'));
  }
}

/** @param {string} home */
export async function readSettings(home) {
  return JSON.parse(await readFile(join(stateFolder(home), 'settings.json'), 'utf8'));
}

/**
 * Runs the real installer with the three test overrides.
 * @param {string[]} args
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function run(args) {
  return new Promise((resolve) => {
    const options = { env: { ...process.env, NO_COLOR: '1' }, timeout: 30_000 };
    execFile(process.execPath, [program, ...args], options, (error, stdout, stderr) => {
      resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr });
    });
  });
}

/** @param {{ home: string, downloads: string, answersFile: string }} where @param {string} profile */
export function runWith(where, profile) {
  return run(['--profile', profile, '--home', where.home, '--answers', where.answersFile, '--downloads', where.downloads]);
}

/** @param {string} home */
export function stateFolder(home) {
  return join(home, 'AppData', 'Local', 'agent-jumpstart');
}

/** @param {string} home */
export async function readOnlyLog(home) {
  const logs = await readdir(join(stateFolder(home), 'logs'));
  assert.equal(logs.length, 1);
  return { name: logs[0], text: await readFile(join(stateFolder(home), 'logs', logs[0]), 'utf8') };
}
