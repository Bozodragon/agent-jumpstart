// The one test seam: the real installer, run end to end in a temporary home with the
// three overrides, so tests see only what it leaves behind.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = fileURLToPath(new URL('../..', import.meta.url));
export const program = join(repo, 'installer', 'src', 'main.js');

/** @param {string} name */
export async function readProfile(name) {
  return JSON.parse(await readFile(join(repo, 'profiles', `${name}.json`), 'utf8'));
}

/** @typedef {'signed-in' | 'signed-out' | 'missing'} GoogleDriveState */

/** @typedef {{ code?: number, output?: string, creates?: string[] }} Reply What a faked program run returns and leaves behind. */

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

/**
 * @param {{ home: string, downloads: string, answersFile: string }} where @param {string} profile
 * @param {string[]} [extra] more flags, such as `--debug`
 */
export function runWith(where, profile, extra = []) {
  return run(['--profile', profile, ...extra, '--home', where.home, '--answers', where.answersFile, '--downloads', where.downloads]);
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
    /** @returns {Promise<{ file: string, args: string[], onScreen?: boolean }[]>} */
    runs: () => readJson('runs.json', []),
    /** @param {Record<string, string>} variables */
    setEnvironment: (variables) => writeJson('environment.json', variables),
    /**
     * Keyed by the program's file name, optionally followed by its arguments
     * (`"node.exe --version"`); the longer key wins. Runs with no reply succeed with no output.
     * A list answers successive runs with that key in turn, and its last reply repeats.
     * A reply may also list files the run leaves, relative to the home (`creates`).
     * @param {Record<string, Reply | Reply[]>} replies
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

/**
 * Puts a stand-in T3 installer in the downloads folder with the release feed
 * (`latest.yml` or `nightly.yml`) that names it, as T3's releases publish them.
 * @param {string} downloads @param {string} feedName @param {string} version
 * @param {{ wrongHash?: boolean }} [options]
 * @returns {Promise<string>} the installer's file name, for this computer's processor
 */
export async function supplyT3(downloads, feedName, version, { wrongHash = false } = {}) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const lines = [`version: '${version}'`, 'files:'];
  let ours = '';
  for (const kind of ['x64', 'arm64']) {
    const name = `T3-Code-${version}-${kind}.exe`;
    const bytes = `stand-in for ${name}`;
    await writeFile(join(downloads, name), bytes);
    const sha512 = createHash('sha512').update(wrongHash ? 'something else' : bytes).digest('base64');
    lines.push(`  - url: ${name}`, `    sha512: ${sha512}`, `    size: ${bytes.length}`);
    if (kind === arch) ours = name;
  }
  lines.push(`releaseDate: '2026-10-22T20:41:35.907Z'`);
  await writeFile(join(downloads, feedName), `${lines.join('\n')}\n`);
  return ours;
}

/**
 * What T3's stable installer leaves, relative to the home: its program, and the command-line
 * shim T3 writes each time it starts (so its being there means T3 has been opened).
 */
export const t3Leaves = {
  program: join('AppData', 'Local', 'Programs', 't3code', 'T3 Code (Beta).exe'),
  shim: join('.t3', 'bin', 't3.cmd'),
};

/**
 * The projects T3 Code would list after the run, as the person sees them in its sidebar: a
 * folder and a title. T3 keeps the list in a database in the home (`.t3\userdata`); on the
 * fake machine, each `project add <folder> --title <title>` run through T3's own shim in the
 * home stands for an entry in it. T3 lists a folder only once (it refuses to add one it
 * already has), so a folder added again is still one project. Only for tests whose replies
 * let those runs succeed.
 * @param {string} home
 * @returns {Promise<{ folder: string, title: string }[]>}
 */
export async function t3Projects(home) {
  const shim = join(home, t3Leaves.shim);
  /** @type {Map<string, { folder: string, title: string }>} */
  const projects = new Map();
  for (const { file, args } of await fakeMachine(home).runs()) {
    if (file !== shim || args[0] !== 'project' || args[1] !== 'add') continue;
    const title = args.includes('--title') ? args[args.indexOf('--title') + 1] : basename(args[2]);
    const key = args[2].toLowerCase();
    if (!projects.has(key)) projects.set(key, { folder: args[2], title });
  }
  return [...projects.values()];
}

/** @param {string} home */
export async function readOnlyLog(home) {
  const logs = await readdir(join(stateFolder(home), 'logs'));
  assert.equal(logs.length, 1);
  return { name: logs[0], text: await readFile(join(stateFolder(home), 'logs', logs[0]), 'utf8') };
}
