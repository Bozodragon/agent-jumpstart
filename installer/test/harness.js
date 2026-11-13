// The one test seam: the real installer, run end to end in a temporary home with the
// test overrides, so tests see only what it leaves behind.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repo = fileURLToPath(new URL('../..', import.meta.url));
export const program = join(repo, 'installer', 'src', 'main.js');
const fakeInternet = join(repo, 'installer', 'test', 'fake-internet.js');

/**
 * The internet, for a run that downloads rather than taking its downloads from a folder. Every
 * address is answered from `folder`, by the file name it ends in (a 404 if it isn't there), in
 * pieces of `chunk` bytes (64 KB if not given) with `pause` milliseconds between them.
 * `cutShort` drops the connection after so many bytes of the named files; `stall` sends nothing
 * more after so many bytes, and keeps the connection open, until the run is stopped. `unsized`
 * names files sent without their size. `terminal` makes the run's output look like a terminal,
 * so its spinner line shows.
 * @typedef {{ folder: string, chunk?: number, pause?: number, cutShort?: Record<string, number>, stall?: Record<string, number>, unsized?: string[], terminal?: boolean }} Internet
 */

/**
 * Runs the real installer with no downloads folder: its downloads come from `internet`. The
 * home, fake machine and answers file are as for `runWith`.
 * @param {{ home: string, answersFile: string }} where @param {string} profile @param {Internet} internet
 * @param {{ stopWhen?: () => Promise<boolean> }} [options] as for `run`
 */
export function runOnline(where, profile, internet, { stopWhen } = {}) {
  return run(['--profile', profile, '--home', where.home, '--answers', where.answersFile], { internet, stopWhen });
}

/** @param {string} name */
export async function readProfile(name) {
  return JSON.parse(await readFile(join(repo, 'profiles', `${name}.json`), 'utf8'));
}

/**
 * `signed-in, no My Drive yet`: signed in, but My Drive hasn't appeared yet, as it can take a few
 * seconds to after the sign-in (a test can make it appear later, with the fake machine's `setWaiting`).
 * `installed, never opened`: its program is in Program Files, but it has never been started, so
 * it has left nothing in the profile folder yet.
 * @typedef {'signed-in' | 'signed-out' | 'missing' | 'signed-in, no My Drive yet' | 'installed, never opened'} GoogleDriveState
 */

/** @typedef {{ code?: number, output?: string, creates?: string[], writes?: Record<string, string>, reads?: string[], takes?: number }} Reply What a faked program run returns, leaves behind, and looks for as it starts (its record says which of `reads` it `found`), and how many milliseconds it really takes before it returns (`takes`, to watch a spinner over a fake run; only claude.test.js uses it, in its test of `takes` itself, over Claude Code's install). */

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
 * when signed in, the mirrored `My Drive` folder. One installed but never
 * opened leaves only its program, in a version folder in Program Files, which
 * the home stands in for (`<home>\Program Files`).
 * @param {string} home
 * @param {GoogleDriveState} state
 */
export async function fakeGoogleDrive(home, state) {
  if (state === 'missing') return;
  if (state === 'installed, never opened') {
    const program = join(home, 'Program Files', 'Google', 'Drive File Stream', '112.0.3.0');
    await mkdir(program, { recursive: true });
    await writeFile(join(program, 'GoogleDriveFS.exe'), 'stand-in');
    return;
  }
  const data = join(home, 'AppData', 'Local', 'Google', 'DriveFS');
  await mkdir(join(data, 'Logs'), { recursive: true });
  if (state === 'signed-in' || state === 'signed-in, no My Drive yet') await mkdir(join(data, driveAccount), { recursive: true });
  if (state === 'signed-in') await mkdir(join(home, 'My Drive'));
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
 * Runs the real installer with the test overrides. It starts with `WT_SESSION` unset unless
 * `windowsTerminal` says otherwise, whatever window the tests themselves run in. It starts with no
 * console of its own (detached), so the title it sets for its window can't reach the console the
 * tests run in.
 * @param {string[]} args
 * @param {{ windowsTerminal?: boolean, internet?: Internet, stopWhen?: () => Promise<boolean> }} [options]
 *   `windowsTerminal`: start with `WT_SESSION` set (true) or unset (false, the default).
 *   `internet`: answer the run's downloads from a folder (fake-internet.js); a run given it has
 *   no `--downloads`. `stopWhen`: checked every 50 ms while the run goes on; once it's true, the
 *   run is ended at once, as closing its window would end it.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function run(args, { windowsTerminal = false, internet, stopWhen } = {}) {
  return new Promise((resolve) => {
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env, NO_COLOR: '1' };
    if (windowsTerminal) env.WT_SESSION = 'a-test-window';
    else delete env.WT_SESSION;
    if (internet) env.AGENT_JUMPSTART_FAKE_INTERNET = JSON.stringify(internet);
    else delete env.AGENT_JUMPSTART_FAKE_INTERNET;
    const preload = internet ? ['--import', pathToFileURL(fakeInternet).href] : [];
    const options = { env, timeout: 30_000, detached: true, windowsHide: true };
    const child = execFile(process.execPath, [...preload, program, ...args], options, (error, stdout, stderr) => {
      clearInterval(watching);
      resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr });
    });
    // Ended the way closing its window ends it: at once, with nothing tidied up.
    const watching = setInterval(async () => {
      if (stopWhen && (await stopWhen())) child.kill();
    }, 50);
  });
}

/**
 * @param {{ home: string, downloads: string, answersFile: string }} where @param {string} profile
 * @param {string[]} [extra] more flags, such as `--debug`
 * @param {{ windowsTerminal?: boolean }} [options] as for `run`
 */
export function runWith(where, profile, extra = [], options = {}) {
  return run(['--profile', profile, ...extra, '--home', where.home, '--answers', where.answersFile, '--downloads', where.downloads], options);
}

/**
 * Writes fixture profiles, by id, to a folder beside the home, for a run to take instead of the
 * repo's. Spread what it returns into `runWith`'s flags.
 * @param {{ home: string }} where @param {Record<string, object>} profiles
 * @returns {Promise<string[]>} the `--profiles` flag and its folder
 */
export async function fixtureProfiles(where, profiles) {
  const folder = join(where.home, '..', 'profiles');
  await mkdir(folder, { recursive: true });
  for (const [id, profile] of Object.entries(profiles)) await writeFile(join(folder, `${id}.json`), JSON.stringify(profile, null, 2));
  return ['--profiles', folder];
}

/** @param {string} home */
export function stateFolder(home) {
  return join(home, 'AppData', 'Local', 'agent-jumpstart');
}

/** @param {string} home */
export function programsFolder(home) {
  return join(home, 'AppData', 'Local', 'Programs');
}

/**
 * The file the installer leaves in a tool's folder once it has installed the tool there: how a
 * later run knows that copy is its own to update, rather than the person's to leave alone.
 */
export const installedMarker = '.installed-by-agent-jumpstart';

/**
 * Leaves the marker in a tool's folder, as an earlier run of the installer would have.
 * @param {string} folder
 */
export async function markAsInstalledByUs(folder) {
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, installedMarker), 'Installed by agent-jumpstart');
}

/**
 * The skills CLI as the installer runs it: with the installer's own Node (in a test, the Node
 * running the tests) and the bin script its package names, never through skills.cmd.
 * @param {string} home
 */
export function skillsCli(home) {
  const folder = join(programsFolder(home), 'skills-cli');
  const packageFolder = join(folder, 'node_modules', 'skills');
  const script = join(packageFolder, 'bin', 'cli.mjs');
  /** What npm leaves in the CLI's folder: the package's package.json, naming its bin script, and the script. */
  const leaves = {
    [join(packageFolder, 'package.json')]: JSON.stringify({ name: 'skills', version: '1.7.4', bin: { skills: 'bin/cli.mjs', 'add-skill': 'bin/cli.mjs' } }),
    [script]: 'stand-in',
  };
  return {
    folder,
    script,
    leaves,
    /** A reply key for a run of the CLI with these first arguments. @param {string[]} args */
    key: (...args) => [basename(process.execPath), script, ...args].join(' '),
    /** Whether a recorded run is a run of the CLI. @param {{ file: string, args: string[] }} run */
    isRun: (run) => run.file === process.execPath && run.args[0] === script,
    /**
     * npm installing the CLI into its folder, as a reply to spread into a test's replies.
     * @type {Record<string, Reply>}
     */
    install: { [`npm.cmd install --global --prefix ${folder}`]: { writes: leaves } },
  };
}

/**
 * Puts a Git on the machine-wide PATH, as Software Centre would, outside the installer's own
 * folders: `<home>\Program Files\Git\cmd\git.exe`.
 * @param {string} home
 * @returns {Promise<string>} the folder on the machine PATH
 */
export async function gitOnMachinePath(home) {
  const folder = join(home, 'Program Files', 'Git', 'cmd');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'git.exe'), 'stand-in');
  const machine = fakeMachine(home);
  await machine.setMachinePath([folder]);
  return folder;
}

/** The pinned manifest in the repo. */
export async function readManifest() {
  return JSON.parse(await readFile(join(repo, 'manifest.json'), 'utf8'));
}

/**
 * Puts the pinned gh where the installer installs it, so it's taken as already installed. With
 * no reply for `gh.exe auth status`, it says it's signed in, as any run with no reply succeeds.
 * @param {string} home
 * @returns {Promise<{ gh: string, replies: Record<string, { code?: number, output?: string }> }>}
 */
export async function ghAlreadyInstalled(home) {
  const { tools } = await readManifest();
  const tool = tools.find((/** @type {any} */ entry) => entry.id === 'gh');
  const gh = join(programsFolder(home), tool.install.folder, tool.install.check);
  await mkdir(join(gh, '..'), { recursive: true });
  await writeFile(gh, 'stand-in');
  return { gh, replies: { 'gh.exe --version': { output: `gh version ${tool.version} (2026-10-01)\n` } } };
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
    /**
     * Each program it was asked to run, with the PATH it was started with (`path`, entries joined
     * with `;`), rebuilt at that moment from the machine PATH, the user PATH and the installer's own.
     * A reply's `reads` adds `found`: which of those files were there when the program started.
     * `env` is the environment variables a run was given beyond PATH, for that run only (the
     * record has none for a run given none).
     * @returns {Promise<{ file: string, args: string[], path: string, env?: Record<string, string>, onScreen?: boolean, leftRunning?: boolean, found?: string[] }[]>}
     */
    runs: () => readJson('runs.json', []),
    /** @returns {Promise<string[]>} the addresses it was asked to open in the browser, in order */
    pagesOpened: () => readJson('pages.json', []),
    /** @param {Record<string, string>} variables */
    setEnvironment: (variables) => writeJson('environment.json', variables),
    /** @param {string[]} folders the machine-wide PATH, which Windows searches before the user's */
    setMachinePath: (folders) => writeJson('machine-path.json', folders),
    /**
     * Time, which the fake only counts: how long the installer may wait for something (its
     * patience; none unless set), and what appears once it has waited so long in all, such as
     * My Drive a few seconds after Google Drive signs in. Each wait returns at once.
     * @param {{ patience: number, appears?: { after: number, folders: string[] }[] }} waiting
     *   `folders` relative to the home
     */
    setWaiting: (waiting) => writeJson('waiting.json', waiting),
    /**
     * Keyed by the program's file name, optionally followed by its first arguments
     * (`"node.exe --version"`, `"skills.cmd add"`); the longest key that matches wins. Runs with no reply succeed with no output.
     * A list answers successive runs with that key in turn, and its last reply repeats.
     * A reply may also list files the run leaves, relative to the home (`creates`), or files with
     * their contents (`writes`).
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
 * @param {{ wrongHash?: boolean, size?: number }} [options] `size`: pad each stand-in out to
 *   so many bytes, for a download that comes in many pieces
 * @returns {Promise<string>} the installer's file name, for this computer's processor
 */
export async function supplyT3(downloads, feedName, version, { wrongHash = false, size = 0 } = {}) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const lines = [`version: '${version}'`, 'files:'];
  let ours = '';
  for (const kind of ['x64', 'arm64']) {
    const name = `T3-Code-${version}-${kind}.exe`;
    const bytes = `stand-in for ${name}`.padEnd(size, '.');
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
 * The folder Claude Code's own installer puts claude.exe in. Every run puts it on the user PATH,
 * at the end, before T3 Code starts, whether or not Claude Code is there yet.
 * @param {string} home
 */
export const claudeFolder = (home) => join(home, '.local', 'bin');

/** Where T3 Code keeps its state, relative to the home, project list among it. */
export const t3Database = join('.t3', 'userdata', 'statev2.sqlite');

/**
 * Leaves T3 Code's database in the home with these projects in it, as T3 keeps them (its
 * `projection_projects` table; a removed project keeps its row with `deleted_at` set).
 * @param {string} home
 * @param {{ title: string, folder: string, deleted?: boolean }[]} projects
 */
export async function seedT3Projects(home, projects) {
  const { DatabaseSync } = await import('node:sqlite');
  const file = join(home, t3Database);
  await mkdir(join(file, '..'), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(`CREATE TABLE projection_projects (
      project_id TEXT PRIMARY KEY, title TEXT NOT NULL, workspace_root TEXT NOT NULL, scripts_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`);
    const add = db.prepare('INSERT INTO projection_projects VALUES (?, ?, ?, ?, ?, ?, ?)');
    const when = '2026-10-01T09:00:00.000Z';
    projects.forEach(({ title, folder, deleted }, index) => add.run(`project-${index}`, title, folder, '[]', when, when, deleted ? when : null));
  } finally {
    db.close();
  }
}

/**
 * Asserts the printed checklist (or another summary) has a row with this label and value. A row
 * can be long enough for its box to wrap it, even in the middle of a path, so the output is read
 * with its borders and all its spaces and line breaks taken out.
 * @param {string} stdout @param {string} label @param {string} value
 */
export function checklistSays(stdout, label, value) {
  assert.ok(shows(stdout, `${label} ${value}`), `expected a checklist line "${label} … ${value}" in:\n${stdout}`);
}

/**
 * Whether the window showed this text, read as checklistSays reads it: borders, spaces and line
 * breaks aside.
 * @param {string} stdout @param {string} text
 */
export function shows(stdout, text) {
  const flowing = (/** @type {string} */ words) => words.replace(/[│|]|\s/g, '');
  return flowing(stdout).includes(flowing(text));
}

/**
 * The arguments of each run of this gh, apart from asking its version, in order.
 * @param {{ file: string, args: string[] }[]} runs @param {string} gh
 */
export const ghCommands = (runs, gh) => runs.filter((run) => run.file === gh && run.args[0] !== '--version').map((run) => run.args.join(' '));

/** @param {string} home */
export async function readOnlyLog(home) {
  const logs = await readdir(join(stateFolder(home), 'logs'));
  assert.equal(logs.length, 1);
  return { name: logs[0], text: await readFile(join(stateFolder(home), 'logs', logs[0]), 'utf8') };
}

/** Every question a run can put, keyed as the answers file keys them. */
const questions = ['team', 'aiExperience', 'codingExperience', 'topWorkspace', 'googleDriveFolder', 'workspacesLocation', 'channel', 'github', 'workspaces', 'connectors', 'extraTools', 'fullSkills', 'switchOffMemory'];

/**
 * An answers file that gives these answers and stops the run if any other question is put to
 * it: every other answer is wrong, so a run that gets past the questions asked only these, and
 * those in its `change` and in `asked`, which it leaves to their defaults.
 * @param {string} answersFile @param {Record<string, unknown> & { change?: string[] }} answers
 * @param {{ asked?: string[] }} [options]
 */
export async function answerOnly(answersFile, answers, { asked = [] } = {}) {
  const left = (/** @type {string} */ key) => key in answers || [...(answers.change ?? []), ...asked].includes(key);
  const refused = Object.fromEntries(questions.filter((key) => !left(key)).map((key) => [key, 'a question was asked']));
  await writeFile(answersFile, JSON.stringify({ ...refused, ...answers }));
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
    // A self-extracting fallback (Git's portable copy) is a file the fake machine "runs" too.
    const fallback = tool.fallback?.downloads[process.arch];
    if (fallback) {
      const stand = Buffer.from(`stand-in for ${fileName(fallback.url)}`);
      await writeFile(join(where.downloads, fileName(fallback.url)), stand);
      fallback.sha256 = createHash('sha256').update(stand).digest('hex');
    }
  }
  await writeFile(join(where.downloads, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}
