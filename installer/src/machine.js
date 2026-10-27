// Everything that would change the machine outside the installer's own folders: the user's
// environment variables (PATH among them), the programs it runs (vendor installers, gh,
// claude, npm) and the pages it opens in the browser. With a home override all of it is faked inside that home, so a test
// can run the real installer end to end and touch nothing else:
//
//   <home>/fake-machine/environment.json  the user environment variables, as HKCU\Environment
//                                         holds them; the user PATH is `Path`, joined with `;`
//   <home>/fake-machine/runs.json         every program it was asked to run: [{ file, args, path }],
//                                         `path` being the PATH it was started with, and
//                                         `onScreen: true` for one run in the person's window
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
//   <home>/fake-machine/machine-path.json written by a test: the machine-wide PATH, a list of
//                                         folders. The real one is read from the registry.
//   <home>/fake-machine/waiting.json      written by a test: time, which the fake only counts.
//                                         { "patience": ms } is how long the installer may wait
//                                         for something (none if not written), and "appears":
//                                         [{ "after": ms, "folders": [...] }] makes folders,
//                                         relative to the home, once it has waited that long in
//                                         all (My Drive a while after Google Drive signs in).
//                                         Every wait returns at once.
//
// Every program is started with a PATH rebuilt at that moment, as a window opened then would
// get it: the machine PATH, then the user PATH (both with their %VARIABLES% expanded), then any
// entries of the installer's own PATH not already there. The installer's own PATH is the
// PowerShell window's, from before anything installed since the window opened (by this run, or
// by Software Centre), so on its own it would hide those from the programs it runs: the skills
// CLI wouldn't find Git, and T3 Code, which reads PATH only when it starts, wouldn't find Node or
// Claude Code. On the fake machine the two PATHs are machine-path.json and environment.json's.
//
// Every program the installer runs goes through `run`, `runHere` or `runOnScreen`, real or fake,
// so a debug run's log holds each one with its exit code and full output (for `runOnScreen`,
// the command and code only: its output goes to the person's window), and every run's log holds
// each `run` or `runHere` that failed (a code other than 0), with its output. Nothing else has
// to log a program's command or output. A debug run's log also holds the PATH programs are
// given, each time it changes.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
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
 * @property {(file: string, args: string[]) => Promise<Ran>} run Runs a program and waits for it.
 *   Never throws: a program that couldn't start gives code -1 and the reason as its output.
 * @property {(file: string, args: string[]) => Promise<Ran>} runHere Like `run`, but always runs
 *   the program for real, even on the fake machine. Only for programs that change nothing but
 *   the installer's own folders, such as tar.exe unpacking a download into its scratch folder.
 * @property {(file: string, args: string[]) => Promise<number>} runOnScreen Runs a program in the
 *   person's window, so they see what it prints and can answer it, and waits for it. Returns its
 *   exit code, or -1 if it couldn't start.
 * @property {(url: string) => Promise<void>} openPage Opens an address in the person's default
 *   browser without waiting for it. Rejects if the browser couldn't be started.
 * @property {number} patience How long, in milliseconds, to wait for what happens after a
 *   program has returned, such as an app it started opening. None for the fake, which does
 *   everything a program does before the run returns, unless a test gives it some.
 * @property {(ms: number) => Promise<void>} wait Waits this long. The fake only counts it.
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

/** @typedef {(file: string, args: string[]) => Promise<Ran>} Runner */

/** @typedef {{ code: number, output: string }} Ran */

/** @typedef {Partial<Ran> & { creates?: string[], writes?: Record<string, string>, reads?: string[] }} Reply What a fake run returns, leaves behind, and looks for as it starts. */

/** @typedef {{ machinePath: string[], userPath: string[] }} PathSources The two PATHs, unexpanded. */

/**
 * What the real and the fake machine each supply: everything but running programs, the two
 * PATHs a program's PATH is rebuilt from, and how to start a program with an environment.
 * @typedef {object} Parts
 * @property {Omit<Machine, 'run' | 'runHere' | 'runOnScreen'>} machine
 * @property {() => Promise<PathSources>} pathSources
 * @property {(file: string, args: string[], env: NodeJS.ProcessEnv) => Promise<Ran>} start
 * @property {(file: string, args: string[], env: NodeJS.ProcessEnv) => Promise<number>} startOnScreen
 */

/**
 * @param {import('./places.js').Places} places
 * @param {import('./log.js').Log} log
 * @returns {Machine}
 */
export function openMachine(places, log) {
  // In a debug run, logged before it starts as well as after, so a program that never returns
  // still shows. In any run, a program that fails is logged once it has, with its output.
  /** @param {Runner} run @returns {Runner} */
  const logged = (run) => async (file, args) => {
    const running = `Running: ${[file, ...args].map(quoted).join(' ')}`;
    log.detail(running);
    const ran = await run(file, args);
    const output = ran.output.trimEnd();
    const lines = [
      `Ran: ${basename(file)} (code ${ran.code})`,
      ...(output ? output.split(/\r?\n/).map((line) => `  | ${line}`) : ['  (no output)']),
    ];
    if (ran.code === 0) log.detail(lines.join('\n'));
    else for (const line of [...(log.debug ? [] : [running]), ...lines]) log.write(line);
    return ran;
  };
  // A program in the person's window writes straight to it: catching its output would take the
  // real terminal away from it (gh auth login needs one), so only the command and code are logged.
  /** @param {Machine['runOnScreen']} run @returns {Machine['runOnScreen']} */
  const loggedOnScreen = (run) => async (file, args) => {
    log.detail(`Running in the person's window: ${[file, ...args].map(quoted).join(' ')}`);
    const code = await run(file, args);
    log.detail(`Ran: ${basename(file)} (code ${code})`);
    log.detail("  (its output went to the person's window, not the log)");
    return code;
  };
  const { machine, pathSources, start, startOnScreen } = places.fakeMachine
    ? fakeMachine(places.fakeMachine, places.home)
    : realMachine(logged((file, args) => runProgram(file, args)));
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
    run: logged(async (file, args) => start(file, args, await environment())),
    runHere: logged(async (file, args) => runProgram(file, args, await environment())),
    runOnScreen: loggedOnScreen(async (file, args) => startOnScreen(file, args, await environment())),
    openPage,
  };
}

/** @param {string} arg */
const quoted = (arg) => (/[\s"]/.test(arg) ? `"${arg}"` : arg);

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
 * @returns {Parts}
 */
function fakeMachine(folder, home) {
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
  /** @type {{ patience?: number, appears?: { after: number, folders: string[] }[] }} */
  const waiting = existsSync(join(folder, 'waiting.json')) ? JSON.parse(readFileSync(join(folder, 'waiting.json'), 'utf8')) : {};
  let waited = 0;

  return {
    machine: {
      patience: waiting.patience ?? 0,
      async wait(ms) {
        const before = waited;
        waited += ms;
        for (const { after, folders } of waiting.appears ?? []) {
          if (after <= before || after > waited) continue;
          for (const path of folders) await mkdir(inside(home, path), { recursive: true });
        }
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
      },
    },
    pathSources,
    start: (file, args, env) => reply(file, args, { file, args, path: env.Path ?? '' }),
    startOnScreen: async (file, args, env) => (await reply(file, args, { file, args, path: env.Path ?? '', onScreen: true })).code,
  };

  /**
   * @param {string} file @param {string[]} args
   * @param {{ file: string, args: string[], path: string, onScreen?: boolean, found?: string[] }} record
   * @returns {Promise<Ran>}
   */
  async function reply(file, args, record) {
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
    return { code: found.code ?? 0, output: found.output ?? '' };
  }
}

/**
 * A path the fake machine may make something at: relative to the home, and inside it.
 * @param {string} home @param {string} path
 */
function inside(home, path) {
  const target = resolve(home, path);
  if (relative(home, target).startsWith('..')) throw new Error(`the fake machine can't make ${path}: it's outside the home`);
  return target;
}

/** @param {string} name */
export const system32 =(name) => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', name);

/**
 * The real user environment lives in HKCU\Environment. It's read and written with reg.exe
 * and setx.exe rather than PowerShell, because Constrained Language Mode blocks the .NET
 * calls PowerShell would need, and these are ordinary programs in System32.
 * @param {Runner} loggedRun runs a program with this process's environment, logged, so reg.exe
 *   and setx.exe are logged too
 * @returns {Parts}
 */
function realMachine(loggedRun) {
  const reg = system32('reg.exe');
  const machineKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';

  /**
   * @param {string} name @param {string} [key] @param {Runner} [run] how reg.exe is run
   * @returns {Promise<string | undefined>}
   */
  async function readVariable(name, key = 'HKCU\\Environment', run = loggedRun) {
    const { code, output } = await run(reg, ['query', key, '/v', name]);
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
      openPage(url) {
        return new Promise((resolve, reject) => {
          const child = spawn(system32('rundll32.exe'), ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' });
          child.once('error', reject);
          child.once('spawn', () => {
            child.unref();
            resolve();
          });
        });
      },
    },
    pathSources,
    start: runProgram,
    startOnScreen(file, args, env) {
      const how = startable(file, args);
      if ('refused' in how) return Promise.resolve(-1);
      return new Promise((resolve) => {
        const child = spawn(how.file, how.args, { ...how.options, env, stdio: 'inherit' });
        child.once('error', () => resolve(-1));
        child.once('close', (code) => resolve(code ?? -1));
      });
    },
  };
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
 * @returns {Promise<Ran>}
 */
function runProgram(file, args, env = process.env) {
  const how = startable(file, args);
  if ('refused' in how) return Promise.resolve({ code: -1, output: how.refused });
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(how.file, how.args, { ...how.options, env, windowsHide: true });
    child.stdout?.on('data', (chunk) => (output += chunk));
    child.stderr?.on('data', (chunk) => (output += chunk));
    child.once('error', (error) => resolve({ code: -1, output: error.message }));
    child.once('close', (code) => resolve({ code: code ?? -1, output }));
  });
}
