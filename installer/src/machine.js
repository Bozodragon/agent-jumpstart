// Everything that would change the machine outside the installer's own folders: the user's
// environment variables (PATH among them), the programs it runs (vendor installers, gh,
// claude, npm) and the pages it opens in the browser. With a home override all of it is faked inside that home, so a test
// can run the real installer end to end and touch nothing else:
//
//   <home>/fake-machine/environment.json  the user environment variables, as HKCU\Environment
//                                         holds them; the user PATH is `Path`, joined with `;`
//   <home>/fake-machine/runs.json         every program it was asked to run: [{ file, args, path }],
//                                         `path` being the PATH it was started with,
//                                         `env` the environment variables it was given beyond
//                                         PATH, for that run only (none are recorded for a run
//                                         given none), and
//                                         `onScreen: true` for one run in the person's window
//                                         (one whose output is kept also prints its reply's
//                                         output to the front end's screen, as the program
//                                         would have),
//                                         `leftRunning: true` for one started and not waited for,
//                                         and `input`, what its input was: `pipe` (the
//                                         Installer's, as every program's is), or `inherit`
//                                         (the person's window, for a program on the terminal's
//                                         screen), or `own window`, and `typed`, the line a run
//                                         that reads one was given (see `readsALine` below).
//                                         `ownWindow` is the title of the console window a run
//                                         was given of its own (`runInItsOwnWindow`); what it
//                                         prints goes to that window, not to the screen
//                                         (its reply's output stands for what `start`
//                                         complained of, if anything)
//   <home>/fake-machine/pages.json        every address it was asked to open in the browser
//   <home>/fake-machine/replies.json      written by a test: what a run returns, keyed by the
//                                         file name, or the file name and its first arguments
//                                         ("gh.exe auth status"); the longest key that matches
//                                         wins. No reply means code 0, no output.
//                                         A list of replies answers successive runs in turn
//                                         (the last one repeats), e.g. a status before and
//                                         after a sign-in. A reply may list files to create,
//                                         relative to the home ("creates": [...]), standing in
//                                         for what the program leaves behind (an installer's
//                                         program, the files an app writes when it starts), and
//                                         files to write with their contents ("writes": { path:
//                                         contents }), such as the package.json npm leaves.
//                                         It may also list files, relative to the home, that
//                                         the program reads as it starts ("reads": [...]); the
//                                         run's record then says which of them were there
//                                         ("found": [...]), before it left anything.
//                                         It may give a time it takes ("takes": ms): a real
//                                         wait before the run returns, so a spinner over a fake
//                                         run can be watched. Tests that don't watch one leave
//                                         it out. A run on the page's screen, whose input is a
//                                         pipe, may wait for a line on it ("readsALine": true),
//                                         as `claude auth login` waits for a pasted code: its
//                                         output is printed first, and the line is recorded as
//                                         the run's `typed`. On the terminal's screen, whose
//                                         input is the window, it reads nothing.
//   <home>/fake-machine/machine-path.json written by a test: the machine-wide PATH, a list of
//                                         folders. The real one is read from the registry.
//   <home>/fake-machine/waiting.json      written by a test: time, which the fake only counts.
//                                         { "patience": ms } is how long the installer may wait
//                                         for something (none if not written), and "appears":
//                                         [{ "after": ms, "folders": [...] }] makes folders,
//                                         relative to the home, once it has waited that long in
//                                         all (My Drive a while after Google Drive signs in).
//                                         Every wait returns at once, except a wait for something
//                                         from outside the Installer (`waitFor`, such as a test
//                                         connecting as the page), which is given "outside": ms
//                                         of real time (10 seconds if not written) to happen in
//                                         before the rest of the wait is counted.
//   <home>/fake-machine/browser.json      written by a test: what the browser downloads when an
//                                         address is opened, standing in for Chrome's download,
//                                         keyed by the address: { "from": a file of the bytes,
//                                         "saves": where, relative to the home, "after": ms,
//                                         "perSecond": bytes, "stopsAt": bytes }. Counted from
//                                         when the address was opened, it appears `after` so
//                                         long (at once if not given) as `<saves>.crdownload`,
//                                         grows by `perSecond` bytes each counted second (all at
//                                         once if not given), and is renamed to `saves` once
//                                         whole. With `stopsAt` it grows no further than that.
//
// Every program is started with a PATH rebuilt at that moment, as a window opened then would
// get it: the machine PATH, then the user PATH (both with their %VARIABLES% expanded), then any
// entries of the installer's own PATH not already there. The installer's own PATH is the
// PowerShell window's, from before anything installed since the window opened (by this run, or
// by Software Centre), so on its own it would hide those from the programs it runs: the skills
// CLI wouldn't find Git, and T3 Code, which reads PATH only when it starts, wouldn't find Node or
// Claude Code. On the fake machine the two PATHs are machine-path.json and environment.json's.
//
// Every program the installer runs goes through `run`, `runHere`, `runOnScreen`, `runOnScreenAndKeep`,
// `runInItsOwnWindow` or `launch`, real or fake, so a debug run's log holds each one with its exit
// code and full output (for `runOnScreen` and `runInItsOwnWindow`, the command and code only: its
// output goes to a window; for
// `runOnScreenAndKeep`, the step that ran it logs what it printed), and every run's log holds
// each `run` or `runHere` that failed (a code other than 0), with its output. Nothing else has
// to log a program's command or output, with one exception: the Claude Code step also logs what
// Anthropic's install script printed when it exited 0 and left no claude.exe (see claude.js).
// A failure the caller expects (`run`'s `expected`, such as
// a registry value that isn't there) isn't one: only a debug run's log holds it, and the caller
// logs what it means in plain words. A debug run's log also holds the PATH programs are
// given, each time it changes.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * @typedef {object} Machine
 * @property {() => Promise<string[]>} userPath The user PATH, one entry per item, unexpanded.
 * @property {(folder: string) => Promise<boolean>} addToUserPath Adds a folder to the end of the
 *   user PATH unless it's already there. Returns whether it was added.
 * @property {(name: string) => Promise<string[]>} findOnPath The folders on the machine PATH and
 *   then the user PATH (expanded, in that order, as Windows searches them) that hold a file of
 *   this name, such as `git.exe`. Only reads.
 * @property {(name: string) => Promise<string | undefined>} userVariable A user environment
 *   variable's value, or undefined if it isn't set.
 * @property {(name: string, value: string) => Promise<void>} setUserVariable Sets a user
 *   environment variable, seen by programs started afterwards.
 * @property {(file: string, args: string[], how?: RunOptions) => Promise<Ran>} run Runs a program
 *   and waits for it. Never throws: a program that couldn't start gives code -1 and the reason as
 *   its output.
 * @property {(file: string, args: string[]) => Promise<Ran>} runHere Like `run`, but always runs
 *   the program for real, even on the fake machine. Only for programs that change nothing but
 *   the installer's own folders, such as tar.exe unpacking a download into its scratch folder.
 * @property {(file: string, args: string[], how?: WindowOptions) => Promise<number>} runOnScreen Runs
 *   a program on the front end's screen (for the terminal, the person's window), so they see what
 *   it prints and can answer it, and waits for it. Returns its exit code, or -1 if it couldn't start.
 * @property {(file: string, args: string[], how?: WindowOptions) => Promise<Ran>} runOnScreenAndKeep Like `runOnScreen`,
 *   but what the program prints also comes back, for the caller to log. What the person types
 *   still goes straight from the window to the program; only what the program prints passes
 *   through the installer, on its way to the window. Only for a program that needs the window
 *   for what it reads but not for what it prints, such as `claude auth login`, which reads a
 *   pasted code as a plain line and checks only that what it reads from is a terminal. Never
 *   throws: a program that couldn't start gives code -1 and the reason as its output.
 * @property {(file: string, args: string[], how: WindowOptions & { title: string }) => Promise<Ran>} runInItsOwnWindow
 *   Runs a console program in a visible console window of its own, titled `title`, and waits for
 *   it to end (the window closes with it). That window is its input and output, so it counts as
 *   in a terminal, and the person reads and answers it there: for the page, whose screen is no
 *   terminal, when a program needs one (`claude auth login`'s paste-a-code prompt). Nothing it
 *   prints passes through the Installer. It's still attached to the front end's screen, which
 *   can end it (a Stop on the page ends it, and its window closes). Its `output` is only what
 *   opening the window said, which is nothing unless that failed. Never throws: a window that
 *   couldn't be opened gives code -1 and the reason as its output.
 * @property {(file: string, args: string[]) => Promise<void>} launch Starts a program, such as an
 *   app with a window, and leaves it running without waiting for it. Rejects if it couldn't start.
 * @property {(url: string) => Promise<void>} openPage Opens an address in the person's default
 *   browser without waiting for it. Rejects if the browser couldn't be started.
 * @property {number} patience How long, in milliseconds, to wait for what happens after a
 *   program has returned, such as an app it started opening. None for the fake, which does
 *   everything a program does before the run returns, unless a test gives it some.
 * @property {(ms: number) => Promise<void>} wait Waits this long. The fake only counts it.
 * @property {(happens: Promise<unknown>, ms: number) => Promise<boolean>} waitFor Waits for
 *   something from outside the Installer, such as a page connecting, for at most this long, and
 *   says whether it happened. The fake gives it a little real time (waiting.json's `outside`), then
 *   only counts the rest.
 */

/**
 * Tries something, and while it isn't done tries it again every so often, until the machine's
 * patience (or the patience given) runs out. Only the waits count towards it.
 * @template T
 * @param {{ machine: Machine, every: number, patience?: number }} how
 * @param {() => Promise<T>} attempt
 * @param {(result: T) => boolean} done
 * @param {(result: T) => void} [beforeWaiting] Called before each wait, to say why.
 * @returns {Promise<{ result: T, waited: number }>} the last try's result, and how long was waited
 */
export async function keepTrying({ machine, every, patience = machine.patience }, attempt, done, beforeWaiting) {
  let result = await attempt();
  let waited = 0;
  while (!done(result) && waited < patience) {
    beforeWaiting?.(result);
    await machine.wait(every);
    waited += every;
    result = await attempt();
  }
  return { result, waited };
}

/** @typedef {(file: string, args: string[], how?: RunOptions) => Promise<Ran>} Runner */

/**
 * @typedef {object} WindowOptions
 * @property {Record<string, string>} [env] Environment variables for this one run, added to the
 *   environment the machine builds (the rebuilt PATH among it). The person's own environment
 *   variables never gain them.
 * @property {(printed: string) => void} [watch] For `runOnScreenAndKeep`: called with everything
 *   the program has printed so far, each time it prints more, so the caller can act on a line
 *   (show a link it prints) while the program still runs.
 */

/**
 * @typedef {object} RunOptions
 * @property {(ran: Ran) => boolean} [expected] Whether a run that failed failed as expected: a
 *   miss the caller looks for, such as a registry value that isn't there or T3 Code still
 *   starting, rather than something going wrong. Only a debug run's log holds it.
 * @property {Record<string, string>} [env] Environment variables for this one run, as for a
 *   program on screen (`WindowOptions`).
 * @property {(text: string) => void} [onOutput] Called with what the program prints, stdout and
 *   stderr together, as it prints it, while it runs; it all still comes back in `output` too. The
 *   fake machine passes on its reply's output in one piece, as soon as the run starts (before
 *   the reply's `takes`).
 */

/** @typedef {{ code: number, output: string }} Ran */

/** @typedef {Partial<Ran> & { creates?: string[], writes?: Record<string, string>, reads?: string[], takes?: number, readsALine?: boolean }} Reply What a fake run returns, leaves behind, and looks for as it starts, how many milliseconds it really takes before it returns, and whether it waits for a line on its input first. */

/** @typedef {{ from: string, saves: string, after?: number, perSecond?: number, stopsAt?: number }} BrowserDownload What the fake browser downloads when an address is opened (see browser.json above). */

/** @typedef {{ machinePath: string[], userPath: string[] }} PathSources The two PATHs, unexpanded. */

/**
 * What the real and the fake machine each supply: everything but running programs, the two
 * PATHs a program's PATH is rebuilt from, and how to start a program with an environment.
 * @typedef {object} Parts
 * @property {Omit<Machine, 'run' | 'runHere' | 'runOnScreen' | 'runOnScreenAndKeep' | 'runInItsOwnWindow' | 'launch'>} machine
 * @property {() => Promise<PathSources>} pathSources
 * @property {(file: string, args: string[], env: NodeJS.ProcessEnv, how?: RunOptions) => Promise<Ran>} start
 *   `how.env` is the part of `env` that the run was given of its own, which the fake machine records.
 * @property {(file: string, args: string[], env: NodeJS.ProcessEnv, extra?: Record<string, string>) => Promise<number>} startOnScreen
 *   `env` is the whole environment to start it with; `extra` is the part of it that a run was
 *   given of its own, which the fake machine records.
 * @property {(file: string, args: string[], env: NodeJS.ProcessEnv, extra?: Record<string, string>, watch?: WindowOptions['watch']) => Promise<Ran>} startOnScreenAndKeep
 * @property {(file: string, args: string[], env: NodeJS.ProcessEnv, title: string, extra?: Record<string, string>) => Promise<Ran>} startInItsOwnWindow
 * @property {(file: string, args: string[], env: NodeJS.ProcessEnv) => Promise<void>} startAndLeave
 */

/**
 * @param {import('./places.js').Places} places
 * @param {import('./log.js').Log} log
 * @param {import('./front-end.js').Screen} screen The front end's screen, which every program run
 *   on screen (`runOnScreen`, `runOnScreenAndKeep`) is started for and attached to.
 * @returns {Machine}
 */
export function openMachine(places, log, screen) {
  // In a debug run, logged before it starts as well as after, so a program that never returns
  // still shows. In any run, a program that fails is logged once it has, with its output.
  /** @param {Runner} run @returns {Runner} */
  const logged = (run) => async (file, args, how = {}) => {
    const running = `Running: ${commandLine(file, args)}${withEnv(how)}`;
    log.detail(running);
    const ran = await run(file, args, how);
    const output = ran.output.trimEnd();
    const lines = [
      `Ran: ${basename(file)} (code ${ran.code})`,
      ...(output ? output.split(/\r?\n/).map((line) => `  | ${line}`) : ['  (no output)']),
    ];
    if (ran.code === 0 || how.expected?.(ran)) log.detail(lines.join('\n'));
    else for (const line of [...(log.debug ? [] : [running]), ...lines]) log.write(line);
    return ran;
  };
  /** Waits for a program on the screen as the screen says (the page can stop the wait). @type {<T>(running: Promise<T>) => Promise<T>} */
  const waitOnScreen = (running) => (screen.wait ? screen.wait(running) : running);
  // A program in the person's window writes straight to it: catching its output would take the
  // real terminal away from it (gh auth login needs one), so only the command and code are logged.
  /** @param {Machine['runOnScreen']} run @returns {Machine['runOnScreen']} */
  const loggedOnScreen = (run) => async (file, args, how) => {
    log.detail(`Running in the person's window: ${commandLine(file, args)}${withEnv(how)}`);
    const code = await waitOnScreen(run(file, args, how));
    log.detail(`Ran: ${basename(file)} (code ${code})`);
    log.detail("  (its output went to the person's window, not the log)");
    return code;
  };
  // What it prints is kept, but logged by the step that ran it, which knows what to leave out
  // (anything the person typed that the program might have shown).
  /** @param {Machine['runOnScreenAndKeep']} run @returns {Machine['runOnScreenAndKeep']} */
  const loggedOnScreenAndKept = (run) => async (file, args, how) => {
    log.detail(`Running in the person's window, keeping what it prints: ${commandLine(file, args)}${withEnv(how)}`);
    const ran = await waitOnScreen(run(file, args, how));
    log.detail(`Ran: ${basename(file)} (code ${ran.code})`);
    log.detail("  (what it printed went to the person's window, and is logged by the step that ran it)");
    return ran;
  };
  // Its own window shows what it prints, so only the command and code are logged here.
  /** @param {Machine['runInItsOwnWindow']} run @returns {Machine['runInItsOwnWindow']} */
  const loggedInItsOwnWindow = (run) => async (file, args, how) => {
    log.detail(`Running in a window of its own: ${commandLine(file, args)}${withEnv(how)}`);
    const ran = await waitOnScreen(run(file, args, how));
    log.detail(`Ran: ${basename(file)} (code ${ran.code})`);
    log.detail(ran.output.trim() ? ran.output.trimEnd().split(/\r?\n/).map((line) => `  | ${line}`).join('\n') : '  (what it printed went to its own window, not the log)');
    return ran;
  };
  const { machine, pathSources, start, startOnScreen, startOnScreenAndKeep, startInItsOwnWindow, startAndLeave } = places.fakeMachine
    ? fakeMachine(places.fakeMachine, places.home, screen)
    : realMachine(logged((file, args) => runProgram(file, args)), screen);
  /** @type {string | undefined} */
  let pathLogged;
  const environment = async () => {
    const path = freshPath(await pathSources());
    if (path !== pathLogged) log.detail(['PATH given to programs from here on:', ...path.split(';').map((entry) => `  ${entry}`)].join('\n'));
    pathLogged = path;
    return withPath(path);
  };
  /** @type {Machine['openPage']} */
  const openPage = (url) => {
    log.detail(`Opening in the browser: ${url}`);
    return machine.openPage(url);
  };
  return {
    ...machine,
    run: logged(async (file, args, how) => start(file, args, { ...(await environment()), ...how?.env }, how)),
    runHere: logged(async (file, args) => runProgram(file, args, await environment())),
    runOnScreen: loggedOnScreen(async (file, args, how) => startOnScreen(file, args, { ...(await environment()), ...how?.env }, how?.env)),
    runOnScreenAndKeep: loggedOnScreenAndKept(async (file, args, how) =>
      startOnScreenAndKeep(file, args, { ...(await environment()), ...how?.env }, how?.env, how?.watch),
    ),
    runInItsOwnWindow: loggedInItsOwnWindow(async (file, args, how) =>
      startInItsOwnWindow(file, args, { ...(await environment()), ...how.env }, how.title, how.env),
    ),
    async launch(file, args) {
      log.detail(`Starting, without waiting for it: ${commandLine(file, args)}`);
      await startAndLeave(file, args, await environment());
    },
    openPage,
  };
}

/** @param {string} arg */
const quoted = (arg) => (/[\s"]/.test(arg) ? `"${arg}"` : arg);

/** What a run was given of its own environment, for the log line that starts it. @param {{ env?: Record<string, string> }} [how] */
const withEnv = (how) => (how?.env && Object.keys(how.env).length > 0 ? ` (with ${Object.entries(how.env).map(([name, value]) => `${name}=${value}`).join(' ')})` : '');

/** A program and its arguments as one line, for the log. @param {string} file @param {string[]} args */
const commandLine = (file, args) => [file, ...args].map(quoted).join(' ');

/** @param {string} entry */
const sameFolder = (entry) => expand(entry).replace(/[\\/]+$/, '').toLowerCase();

/** Expands `%NAME%` the way Windows does for a REG_EXPAND_SZ value. @param {string} text */
const expand = (text) => text.replace(/%([^%]+)%/g, (whole, name) => process.env[name] ?? whole);

/** @param {string[]} entries @param {string} folder */
const includesFolder = (entries, folder) => entries.some((entry) => sameFolder(entry) === sameFolder(folder));

/** @param {string} raw */
const splitPath = (raw) => raw.split(';').filter((entry) => entry.trim() !== '');

/**
 * The PATH a program is started with: the machine PATH, then the user PATH, then the entries of
 * this process's own PATH not already there, each expanded, and each folder once.
 * @param {PathSources} sources
 */
function freshPath({ machinePath, userPath }) {
  /** @type {string[]} */
  const entries = [];
  for (const entry of [...machinePath, ...userPath, ...splitPath(process.env.Path ?? '')]) {
    const folder = expand(entry.trim());
    if (!includesFolder(entries, folder)) entries.push(folder);
  }
  return entries.join(';');
}

/**
 * This process's environment with its PATH replaced. Windows ignores the case of a variable's
 * name but a copy of process.env doesn't, so every spelling of PATH is dropped before `Path` is set.
 * @param {string} path
 * @returns {NodeJS.ProcessEnv}
 */
function withPath(path) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const [name, value] of Object.entries(process.env)) if (name.toLowerCase() !== 'path') env[name] = value;
  env.Path = path;
  return env;
}

/**
 * The folders among PATH entries that hold a file of this name, each once, in order.
 * @param {string[]} entries @param {string} name
 */
async function foldersHolding(entries, name) {
  /** @type {string[]} */
  const found = [];
  for (const entry of entries) {
    const folder = expand(entry.trim()).replace(/[\\/]+$/, '');
    if (includesFolder(found, folder)) continue;
    if (await access(join(folder, name)).then(() => true, () => false)) found.push(folder);
  }
  return found;
}

/**
 * @param {string} folder
 * @param {string} home Where a reply's `creates` paths are, and the only place they may be.
 * @param {import('./front-end.js').Screen} screen
 * @returns {Parts}
 */
function fakeMachine(folder, home, screen) {
  /** @param {string} name @param {unknown} empty */
  const read = async (name, empty) => {
    try {
      return JSON.parse(await readFile(join(folder, name), 'utf8'));
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return empty;
      throw error;
    }
  };
  /** @param {string} name @param {unknown} value */
  const write = async (name, value) => {
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, name), `${JSON.stringify(value, null, 2)}\n`);
  };
  /** @returns {Promise<Record<string, string>>} */
  const environment = () => read('environment.json', {});
  /** @returns {Promise<PathSources>} */
  const pathSources = async () => ({ machinePath: await read('machine-path.json', []), userPath: splitPath((await environment()).Path ?? '') });
  // Read once, when the run starts: patience is a number, not a promise.
  /** @type {{ patience?: number, appears?: { after: number, folders: string[] }[], outside?: number }} */
  const waiting = existsSync(join(folder, 'waiting.json')) ? JSON.parse(readFileSync(join(folder, 'waiting.json'), 'utf8')) : {};
  let waited = 0;
  /** The browser's downloads under way, each with the counted time its address was opened and how much of it is written. @type {{ download: BrowserDownload, opened: number, written: number }[]} */
  const downloading = [];
  /** @param {typeof downloading[number]} under @returns {Promise<boolean>} whether it's whole */
  const grow = async (under) => {
    const { from, saves, after = 0, perSecond, stopsAt } = under.download;
    const elapsed = waited - under.opened - after;
    if (elapsed < 0) return false;
    const bytes = await readFile(from);
    const due = perSecond === undefined ? bytes.length : Math.floor((elapsed / 1000) * perSecond);
    const reached = Math.min(bytes.length, stopsAt ?? bytes.length, due);
    const target = inside(home, saves);
    await mkdir(dirname(target), { recursive: true });
    if (reached === bytes.length) {
      await writeFile(target, bytes);
      await rm(`${target}.crdownload`, { force: true });
      return true;
    }
    if (reached !== under.written) await writeFile(`${target}.crdownload`, bytes.subarray(0, reached));
    under.written = reached;
    return false;
  };

  /** @param {number} ms */
  const wait = async (ms) => {
    const before = waited;
    waited += ms;
    for (const { after, folders } of waiting.appears ?? []) {
      if (after <= before || after > waited) continue;
      for (const path of folders) await mkdir(inside(home, path), { recursive: true });
    }
    for (const under of [...downloading]) if (await grow(under)) downloading.splice(downloading.indexOf(under), 1);
  };

  return {
    machine: {
      patience: waiting.patience ?? 0,
      wait,
      // A test standing in for the outside (a page) acts in real time, so it's given some before
      // the wait is counted out.
      async waitFor(happens, ms) {
        let happened = false;
        happens.then(() => (happened = true), () => {});
        if (await withinRealTime(happens, waiting.outside ?? 10_000)) return true;
        await wait(ms);
        return happened;
      },
      async userPath() {
        return splitPath((await environment()).Path ?? '');
      },
      async addToUserPath(entry) {
        const variables = await environment();
        const entries = splitPath(variables.Path ?? '');
        if (includesFolder(entries, entry)) return false;
        await write('environment.json', { ...variables, Path: [...entries, entry].join(';') });
        return true;
      },
      async findOnPath(name) {
        const { machinePath, userPath } = await pathSources();
        return foldersHolding([...machinePath, ...userPath], name);
      },
      async userVariable(name) {
        return (await environment())[name];
      },
      async setUserVariable(name, value) {
        await write('environment.json', { ...(await environment()), [name]: value });
      },
      async openPage(url) {
        await write('pages.json', [...(await read('pages.json', [])), url]);
        /** @type {Record<string, BrowserDownload>} */
        const downloads = await read('browser.json', {});
        if (downloads[url]) downloading.push({ download: downloads[url], opened: waited, written: -1 });
      },
    },
    pathSources,
    start: (file, args, env, how) => reply(file, args, { file, args, path: env.Path ?? '', ...recordOf(how?.env), input: inputOf(waitedFor) }, how?.onOutput),
    startOnScreen: async (file, args, env, extra) =>
      (await reply(file, args, { file, args, path: env.Path ?? '', ...recordOf(extra), onScreen: true, input: inputOf(screen.stdio(false)) })).code,
    // The reply's output is what the program prints, so it's shown on the screen, as it would be,
    // and watched. A screen whose input is a pipe (the page's) is given a stand-in for the program
    // to write to, as it would be given the program, and a reply that reads a line waits for it.
    async startOnScreenAndKeep(file, args, env, extra, watch) {
      const input = inputOf(screen.stdio(true));
      const stdin = input === 'pipe' ? new PassThrough() : undefined;
      const standIn = stdin && Object.assign(new EventEmitter(), { stdin, stdout: null, stderr: null });
      if (standIn) screen.attach(/** @type {any} */ (standIn));
      /** @type {{ file: string, args: string[], path: string, env?: Record<string, string>, onScreen: boolean, input: string, typed?: string }} */
      const record = { file, args, path: env.Path ?? '', ...recordOf(extra), onScreen: true, input };
      const ran = await reply(file, args, record, undefined, async (found) => {
        watch?.(found.output ?? '');
        if (found.readsALine && stdin) record.typed = await aLineFrom(stdin);
      });
      standIn?.emit('close', ran.code);
      screen.write(ran.output);
      return ran;
    },
    // Attached to the screen as the real one is (through a stand-in for cmd.exe, with nothing to
    // write to), so the screen knows it's running; what it prints is its own window's.
    async startInItsOwnWindow(file, args, env, title, extra) {
      const standIn = Object.assign(new EventEmitter(), { stdin: null, stdout: null, stderr: null });
      screen.attach(/** @type {any} */ (standIn));
      const ran = await reply(file, args, { file, args, path: env.Path ?? '', ...recordOf(extra), ownWindow: title, input: 'own window' });
      standIn.emit('close', ran.code);
      return ran;
    },
    async startAndLeave(file, args, env) {
      const { code, output } = await reply(file, args, { file, args, path: env.Path ?? '', leftRunning: true, input: inputOf(leftRunning) });
      if (code === -1) throw new Error(output || `${basename(file)} couldn't be started`);
    },
  };

  /**
   * @param {string} file @param {string[]} args
   * @param {{ file: string, args: string[], path: string, env?: Record<string, string>, onScreen?: boolean, leftRunning?: boolean, ownWindow?: string, input: string, found?: string[], typed?: string }} record
   * @param {RunOptions['onOutput']} [onOutput] given the reply's output as the run starts
   * @param {(found: Reply) => Promise<void>} [whileRunning] what the program does once it has
   *   started, before it returns; what it adds to the record is recorded too
   * @returns {Promise<Ran>}
   */
  async function reply(file, args, record, onOutput, whileRunning) {
    /** @type {{ file: string, args: string[] }[]} */
    const runs = await read('runs.json', []);
    /** @type {Record<string, Reply | Reply[]>} */
    const replies = await read('replies.json', {});
    /** @param {string} key @param {(run: { file: string, args: string[] }) => string} keyOf */
    const answer = (key, keyOf) => {
      const found = replies[key];
      if (!Array.isArray(found)) return found;
      const earlier = runs.filter((run) => keyOf(run) === key).length;
      return found[Math.min(earlier, found.length - 1)];
    };
    // The longest key that matches wins: the file name and all its arguments, then fewer of them.
    let found;
    for (let count = args.length; found === undefined && count >= 0; count--) {
      found = answer([basename(file), ...args.slice(0, count)].join(' '), (run) => [basename(run.file), ...run.args.slice(0, count)].join(' '));
    }
    found ??= {};
    // What the program reads as it starts, looked at before it leaves anything.
    if (found.reads) {
      record.found = [];
      for (const path of found.reads) if (existsSync(inside(home, path))) record.found.push(path);
    }
    await write('runs.json', [...runs, record]);
    const leaves = [
      ...(found.creates ?? []).map((path) => [path, `left by a fake run of ${basename(file)}`]),
      ...Object.entries(found.writes ?? {}),
    ];
    for (const [path, contents] of leaves) {
      const target = inside(home, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
    if (onOutput && found.output) onOutput(found.output);
    if (found.takes) await sleep(found.takes);
    if (whileRunning) {
      await whileRunning(found);
      // Nothing else runs while it does, so its record is still the last.
      if (record.typed !== undefined) await write('runs.json', [...runs, record]);
    }
    return { code: found.code ?? 0, output: found.output ?? '' };
  }
}

/**
 * How a program started and not waited for is connected: its input a pipe of the Installer's,
 * which is closed at once, and its output nowhere. Never the Installer's own input: started
 * hidden by the Bootstrap, the Installer's input is a hidden console, which still counts as a
 * terminal, so a program that read it would wait for an Enter nobody can press.
 * @type {import('node:child_process').StdioOptions}
 */
const leftRunning = ['pipe', 'ignore', 'ignore'];

/**
 * How a program run and waited for is connected: everything a pipe of the Installer's, its
 * input never the hidden console (see `leftRunning`).
 * @type {import('node:child_process').StdioOptions}
 */
const waitedFor = ['pipe', 'pipe', 'pipe'];

/**
 * What a program's input is, from how it's started: `pipe`, or `inherit` (the Installer's own).
 * @param {import('node:child_process').StdioOptions} stdio
 */
const inputOf = (stdio) => String(Array.isArray(stdio) ? stdio[0] : stdio);

/**
 * Starts a program and leaves it running, detached, so it stays open after the Installer and its
 * window have gone.
 * @param {string} file @param {string[]} args @param {import('node:child_process').SpawnOptions} [options]
 * @returns {Promise<void>}
 */
function leave(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...options, detached: true, stdio: leftRunning });
    child.stdin?.destroy();
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * Whether something happens within this many milliseconds of real time. The timer goes as soon
 * as it does, so it never holds the Installer open.
 * @param {Promise<unknown>} happens @param {number} ms
 * @returns {Promise<boolean>}
 */
async function withinRealTime(happens, ms) {
  const timer = new AbortController();
  try {
    return await Promise.race([happens.then(() => true), sleep(ms, false, { signal: timer.signal })]);
  } finally {
    timer.abort();
  }
}

/**
 * The first line written to a fake program's input, without its line break, as the program
 * would read it; what there was if the input closes first.
 * @param {import('node:stream').Readable} input
 * @returns {Promise<string>}
 */
function aLineFrom(input) {
  return new Promise((resolve) => {
    let text = '';
    input.setEncoding('utf8');
    input.on('data', (/** @type {string} */ chunk) => {
      text += chunk;
      const end = text.indexOf('\n');
      if (end >= 0) resolve(text.slice(0, end).replace(/\r$/, ''));
    });
    input.once('end', () => resolve(text));
  });
}

/** The record's `env`: the environment a run was given beyond PATH, left out when it was given none. @param {Record<string, string>} [extra] */
const recordOf = (extra) => (extra && Object.keys(extra).length > 0 ? { env: extra } : {});

/**
 * A path the fake machine may make something at: relative to the home, and inside it.
 * @param {string} home @param {string} path
 */
function inside(home, path) {
  const target = resolve(home, path);
  if (relative(home, target).startsWith('..')) throw new Error(`the fake machine can't make ${path}: it's outside the home`);
  return target;
}

/**
 * Whether `reg.exe query` found nothing: the key or value isn't there, which is how a variable
 * that isn't set or a program that isn't installed looks. Anything else, such as access denied,
 * is a failure.
 * @param {Ran} ran
 */
export const registryMiss = (ran) => ran.code === 1 && /unable to find the specified registry key or value/i.test(ran.output);

/** @param {string} name */
export const system32 =(name) => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', name);

/**
 * The real user environment lives in HKCU\Environment. It's read and written with reg.exe
 * and setx.exe rather than PowerShell, because Constrained Language Mode blocks the .NET
 * calls PowerShell would need, and these are ordinary programs in System32.
 * @param {Runner} loggedRun runs a program with this process's environment, logged, so reg.exe
 *   and setx.exe are logged too
 * @param {import('./front-end.js').Screen} screen
 * @returns {Parts}
 */
function realMachine(loggedRun, screen) {
  const reg = system32('reg.exe');
  const machineKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';

  /**
   * @param {string} name @param {string} [key] @param {Runner} [run] how reg.exe is run
   * @returns {Promise<string | undefined>}
   */
  async function readVariable(name, key = 'HKCU\\Environment', run = loggedRun) {
    const { code, output } = await run(reg, ['query', key, '/v', name], { expected: registryMiss });
    if (code !== 0) return undefined;
    const match = new RegExp(`^\\s+${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.*)$`, 'im').exec(output);
    return match ? match[1].trimEnd() : '';
  }

  /**
   * Read before every program the installer runs, so unlogged by default: the debug log holds
   * the PATH they make instead, each time it changes.
   * @param {Runner} [run]
   * @returns {Promise<PathSources>}
   */
  async function pathSources(run = (file, args) => runProgram(file, args)) {
    const machinePath = splitPath((await readVariable('Path', machineKey, run)) ?? '');
    return { machinePath, userPath: splitPath((await readVariable('Path', 'HKCU\\Environment', run)) ?? '') };
  }

  /**
   * setx writes the value and tells Windows the environment changed, so Explorer, and the
   * apps opened from it afterwards, pick up the new PATH.
   */
  async function announceChange() {
    const ping = 'AGENT_JUMPSTART_REFRESH';
    await loggedRun(system32('setx.exe'), [ping, '1']);
    await loggedRun(reg, ['delete', 'HKCU\\Environment', '/v', ping, '/f']);
  }

  return {
    machine: {
      async userPath() {
        return splitPath((await readVariable('Path')) ?? '');
      },
      async addToUserPath(folder) {
        const entries = splitPath((await readVariable('Path')) ?? '');
        if (!includesFolder(entries, folder)) {
          // REG_EXPAND_SZ keeps any %USERPROFILE%-style entries as they were.
          const value = [...entries, folder].join(';');
          const { code, output } = await loggedRun(reg, ['add', 'HKCU\\Environment', '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', value, '/f']);
          if (code !== 0) throw new Error(`the user PATH couldn't be changed: ${output.trim()}`);
          await announceChange();
        }
        // This process has the old PATH; the programs it runs get theirs rebuilt anyway.
        if (!includesFolder(splitPath(process.env.Path ?? ''), folder)) process.env.Path = `${process.env.Path};${folder}`;
        return !includesFolder(entries, folder);
      },
      async findOnPath(name) {
        const { machinePath, userPath } = await pathSources(loggedRun);
        return foldersHolding([...machinePath, ...userPath], name);
      },
      userVariable: (name) => readVariable(name),
      async setUserVariable(name, value) {
        const { code, output } = await loggedRun(system32('setx.exe'), [name, value]);
        if (code !== 0) throw new Error(`${name} couldn't be set: ${output.trim()}`);
        process.env[name] = value;
      },
      patience: 120_000,
      wait: (ms) => sleep(ms),
      waitFor: withinRealTime,
      openPage: (url) => leave(system32('rundll32.exe'), ['url.dll,FileProtocolHandler', url]),
    },
    pathSources,
    start: runProgram,
    // The screen decides where an on-screen program's input and output go; the machine only
    // starts it, and keeps what it prints when asked to.
    startOnScreen(file, args, env) {
      const how = startable(file, args);
      if ('refused' in how) return Promise.resolve(-1);
      return new Promise((resolve) => {
        const child = spawn(how.file, how.args, { ...how.options, env, stdio: screen.stdio(false) });
        screen.attach(child);
        child.once('error', () => resolve(-1));
        child.once('close', (code) => resolve(code ?? -1));
      });
    },
    startOnScreenAndKeep(file, args, env, extra, watch) {
      const how = startable(file, args);
      if ('refused' in how) return Promise.resolve({ code: -1, output: how.refused });
      return new Promise((resolve) => {
        let output = '';
        // On the terminal's screen, the window stays the program's input, so its prompt reads what
        // the person types (a paste shows nothing in the window, and nothing passes through the
        // installer); what it prints is passed on to the window as it comes, and kept. On the
        // page's, its input is a pipe the page's code box writes to. Decoded as it comes, so a
        // character split between two chunks isn't broken.
        const child = spawn(how.file, how.args, { ...how.options, env, stdio: screen.stdio(true) });
        for (const from of [child.stdout, child.stderr]) {
          from?.setEncoding('utf8');
          from?.on('data', (/** @type {string} */ chunk) => {
            output += chunk;
            watch?.(output);
          });
        }
        screen.attach(child);
        child.once('error', (error) => resolve({ code: -1, output: error.message }));
        child.once('close', (code) => resolve({ code: code ?? -1, output }));
      });
    },
    startInItsOwnWindow(file, args, env, title) {
      // A file that isn't there would make `start` ask Windows to open it, which can show a dialog.
      if (!existsSync(file)) return Promise.resolve({ code: -1, output: `${file} isn't there` });
      const how = inItsOwnWindow(file, args, title);
      if ('refused' in how) return Promise.resolve({ code: -1, output: how.refused });
      return new Promise((resolve) => {
        let output = '';
        // cmd.exe shares the Installer's console, hidden on the page, as every program on the
        // screen does, so nothing flashes; only the window `start` opens is seen. Its own output
        // is only what `start` says if it can't open it.
        const child = spawn(how.file, how.args, { ...how.options, env, stdio: waitedFor });
        for (const from of [child.stdout, child.stderr]) {
          from?.setEncoding('utf8');
          from?.on('data', (/** @type {string} */ chunk) => (output += chunk));
        }
        screen.attach(child);
        child.once('error', (error) => resolve({ code: -1, output: error.message }));
        child.once('close', (code) => resolve({ code: code ?? -1, output }));
      });
    },
    startAndLeave(file, args, env) {
      const how = startable(file, args);
      if ('refused' in how) return Promise.reject(new Error(how.refused));
      return leave(how.file, how.args, { ...how.options, env });
    },
  };
}

/**
 * How to run a program in a console window of its own and wait for it: cmd.exe's `start /wait`.
 * Node can't open one itself: `detached` leaves a console program with no console at all, and
 * otherwise it shares the Installer's, which is hidden on the page. `start` gives it a new
 * console, shown as any new window is (in Windows Terminal, where that's the default terminal),
 * titled `title`, and `/wait` waits for the program, not for anything it leaves running. Alone,
 * `cmd /c start /wait` exits 0 whatever the program's code, so the line ends by passing that on
 * (`!errorlevel!`, with `/v:on`). The line is quoted for cmd and passed as it is: anything cmd
 * would still expand inside quotes, `^` among them with `/v:on`, is refused rather than escaped.
 * Checked on Windows 11 from a Node started hidden: the window opened, its program's input and
 * output were a terminal, its exit code came back, and ending cmd.exe's tree closed the window.
 * @param {string} file @param {string[]} args @param {string} title
 * @returns {{ file: string, args: string[], options: import('node:child_process').SpawnOptions } | { refused: string }}
 */
function inItsOwnWindow(file, args, title) {
  const unsafe = [title, file, ...args].find((arg) => /["%!^\r\n]/.test(arg));
  if (unsafe !== undefined) return { refused: `can't pass ${unsafe} to a window of its own safely` };
  const program = [file, ...args].map((arg, index) => (index === 0 || arg === '' || /[\s&|<>(),;=]/.test(arg) ? `"${arg}"` : arg)).join(' ');
  const line = `start "${title}" /wait ${program} & exit !errorlevel!`;
  // /d skips AutoRun commands; /s with the outer quotes keeps the line exactly as built.
  const cmd = process.env.ComSpec ?? system32('cmd.exe');
  return { file: cmd, args: ['/d', '/v:on', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true } };
}

/**
 * Node won't start a .cmd or .bat file by itself, so those run through cmd.exe. The command line
 * is built here, quoted for cmd, and passed as it is: anything cmd would still expand inside
 * quotes (`%`, `!`, `"`, line breaks) is refused rather than escaped.
 * @param {string} file @param {string[]} args
 * @returns {{ file: string, args: string[], options: import('node:child_process').SpawnOptions } | { refused: string }}
 */
function startable(file, args) {
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args, options: {} };
  const unsafe = [file, ...args].find((arg) => /["%!\r\n]/.test(arg));
  if (unsafe !== undefined) return { refused: `can't pass ${unsafe} to ${basename(file)} safely` };
  const line = [file, ...args].map((arg) => (arg === '' || /[\s&|<>^(),;=]/.test(arg) ? `"${arg}"` : arg)).join(' ');
  // /d skips AutoRun commands; /s with the outer quotes keeps the line exactly as built.
  const cmd = process.env.ComSpec ?? system32('cmd.exe');
  return { file: cmd, args: ['/d', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true } };
}

/**
 * @param {string} file @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env] what to start it with; this process's environment if none
 * @param {RunOptions} [options] `onOutput`, given what it prints as it prints it
 * @returns {Promise<Ran>}
 */
function runProgram(file, args, env = process.env, { onOutput } = {}) {
  const how = startable(file, args);
  if ('refused' in how) return Promise.resolve({ code: -1, output: how.refused });
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(how.file, how.args, { ...how.options, env, windowsHide: true, stdio: waitedFor });
    // Decoded as it comes, so a character split between two chunks isn't broken.
    for (const from of [child.stdout, child.stderr]) {
      from?.setEncoding('utf8');
      from?.on('data', (/** @type {string} */ chunk) => {
        output += chunk;
        onOutput?.(chunk);
      });
    }
    child.once('error', (error) => resolve({ code: -1, output: error.message }));
    child.once('close', (code) => resolve({ code: code ?? -1, output }));
  });
}
