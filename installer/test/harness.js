// The one test seam: the real installer, run end to end in a temporary home with the
// three overrides, so tests see only what it leaves behind.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
 * Leaves a settings file as an earlier run would have, so the next run is a re-run.
 * @param {string} home @param {Record<string, unknown>} settings
 */
export async function seedSettings(home, settings) {
  await mkdir(stateFolder(home), { recursive: true });
  await writeFile(join(stateFolder(home), 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
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
 * `Path`, entries joined with `;`), `runs.json` lists every program it was asked to run,
 * `pages.json` every page it was asked to open in the browser, and `replies.json`, if a test
 * writes one, says what a run returns.
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
    /** @returns {Promise<string[]>} the addresses it was asked to open in the browser, in order */
    pagesOpened: () => readJson('pages.json', []),
    /** @param {Record<string, string>} variables */
    setEnvironment: (variables) => writeJson('environment.json', variables),
    /**
     * Keyed by the program's file name, optionally followed by its first arguments
     * (`"node.exe --version"`, `"skills.cmd add"`); the longest key that matches wins. Runs with no reply succeed with no output.
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

/**
 * Asserts the printed checklist (or another summary) has a row with this label and value. A row
 * can be long enough for its box to wrap it, so the output is read as flowing text: borders gone
 * and each run of spaces and line breaks one space.
 * @param {string} stdout @param {string} label @param {string} value
 */
export function checklistSays(stdout, label, value) {
  const flowing = (/** @type {string} */ text) => text.replace(/[│|]/g, ' ').replace(/\s+/g, ' ');
  assert.ok(flowing(stdout).includes(flowing(`${label} ${value}`)), `expected a checklist line "${label} … ${value}" in:\n${stdout}`);
}

/** @param {string} home */
export async function readOnlyLog(home) {
  const logs = await readdir(join(stateFolder(home), 'logs'));
  assert.equal(logs.length, 1);
  return { name: logs[0], text: await readFile(join(stateFolder(home), 'logs', logs[0]), 'utf8') };
}

/** @param {string} path */
export const exists = (path) => access(path).then(() => true, () => false);

/** The file name a download's address ends in: what the downloads folder holds it as. @param {string} url */
export const fileName = (url) => basename(new URL(url).pathname);

/**
 * Stand-ins for the vendors' downloads, shaped like the real ones: Node's zip has one
 * top folder, gh's has `bin\gh.exe`, and Git's installer is a file the fake machine "runs".
 * @param {string} folder where to build them
 * @param {any} tool a manifest entry
 * @returns {Promise<string>} the file, named as the vendor names it
 */
async function standIn(folder, tool) {
  const name = fileName(tool.downloads[process.arch].url);
  const file = join(folder, name);
  if (tool.install.how === 'installer') {
    await writeFile(file, `stand-in for ${name}`);
    return file;
  }
  const contents = join(folder, `${tool.id}-contents`);
  const inner = tool.id === 'node' ? join(contents, name.replace(/\.zip$/, '')) : contents;
  const check = join(inner, tool.install.check);
  await mkdir(join(check, '..'), { recursive: true });
  await writeFile(check, 'stand-in');
  await writeFile(join(inner, tool.id === 'node' ? 'npm.cmd' : 'LICENSE'), 'stand-in');
  await makeZip(contents, file);
  return file;
}

/**
 * Fills the downloads folder with stand-ins and a copy of the pinned manifest whose
 * checksums are the stand-ins', so the run can succeed without the vendors' files.
 * @param {{ downloads: string }} where
 * @param {string[]} [ids] which tools to supply (default all)
 */
export async function supplyDownloads(where, ids) {
  const manifest = await readManifest();
  const workshop = join(where.downloads, '..', 'workshop');
  await mkdir(workshop, { recursive: true });
  for (const tool of manifest.tools) {
    // T3 isn't pinned, so it has no download here (supplyT3 gives it its own).
    if (!tool.downloads || (ids && !ids.includes(tool.id))) continue;
    const built = await standIn(workshop, tool);
    const bytes = await readFile(built);
    await writeFile(join(where.downloads, basename(built)), bytes);
    tool.downloads[process.arch].sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  await writeFile(join(where.downloads, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}
