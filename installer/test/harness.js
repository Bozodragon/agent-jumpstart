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

/**
 * A temporary home with an answers file and an empty downloads folder,
 * removed when the test ends.
 * @param {import('node:test').TestContext} t
 * @param {object} [answers]
 */
export async function makeHome(t, answers = {}) {
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
export function programsFolder(home) {
  return join(home, 'AppData', 'Local', 'Programs');
}

/** The pinned manifest in the repo. */
export async function readManifest() {
  return JSON.parse(await readFile(join(repo, 'manifest.json'), 'utf8'));
}

/**
 * With `--home`, whatever would change the real machine lands in `<home>/fake-machine/`:
 * `environment.json` stands for the user's environment variables (the user PATH is its
 * `Path`, entries joined with `;`), `runs.json` lists every program it was asked to run, and
 * `replies.json`, if a test writes one, says what a run returns.
 * @param {string} home
 */
export function fakeMachine(home) {
  const folder = join(home, 'fake-machine');
  /** @param {string} name */
  const readJson = async (name, empty = {}) => {
    try {
      return JSON.parse(await readFile(join(folder, name), 'utf8'));
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return empty;
      throw error;
    }
  };
  /** @param {string} name @param {unknown} value */
  const writeJson = async (name, value) => {
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, name), JSON.stringify(value, null, 2));
  };
  return {
    /** @returns {Promise<Record<string, string>>} */
    environment: () => readJson('environment.json'),
    /** @returns {Promise<string[]>} the user PATH, one entry per item */
    userPath: async () => ((await readJson('environment.json')).Path ?? '').split(';').filter(Boolean),
    /** @returns {Promise<{ file: string, args: string[] }[]>} */
    runs: () => readJson('runs.json', []),
    /** @param {Record<string, string>} variables */
    setEnvironment: (variables) => writeJson('environment.json', variables),
    /**
     * Keyed by the program's file name, optionally followed by its arguments
     * (`"node.exe --version"`); the longer key wins. Runs with no reply succeed with no output.
     * @param {Record<string, { code?: number, output?: string }>} replies
     */
    setReplies: (replies) => writeJson('replies.json', replies),
  };
}

/**
 * Zips a folder's contents with Windows' own tar, the same one the installer unpacks with.
 * @param {string} folder
 * @param {string} zipFile
 */
export async function makeZip(folder, zipFile) {
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  const entries = await readdir(folder);
  await new Promise((resolve, reject) => {
    execFile(tar, ['-a', '-cf', zipFile, '-C', folder, ...entries], (error) => (error ? reject(error) : resolve(undefined)));
  });
}

/** @param {string} home */
export async function readOnlyLog(home) {
  const logs = await readdir(join(stateFolder(home), 'logs'));
  assert.equal(logs.length, 1);
  return { name: logs[0], text: await readFile(join(stateFolder(home), 'logs', logs[0]), 'utf8') };
}
