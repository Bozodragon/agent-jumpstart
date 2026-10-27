// Everything that would change the machine outside the installer's own folders: the user's
// environment variables (PATH among them), the programs it runs (vendor installers, gh,
// claude, npm) and the pages it opens in the browser. With a home override all of it is faked inside that home, so a test
// can run the real installer end to end and touch nothing else:
//
//   <home>/fake-machine/environment.json  the user environment variables, as HKCU\Environment
//                                         holds them; the user PATH is `Path`, joined with `;`
//   <home>/fake-machine/runs.json         every program it was asked to run: [{ file, args }],
//                                         with `onScreen: true` for one run in the person's window
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
//                                         program, the files an app writes when it starts).
//
// Every program the installer runs goes through `run`, `runHere` or `runOnScreen`, real or fake,
// so a debug run's log holds each one with its exit code and full output (for `runOnScreen`,
// the command and code only: its output goes to the person's window), and every run's log holds
// each `run` or `runHere` that failed (a code other than 0), with its output. Nothing else has
// to log a program's command or output.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

/**
 * @typedef {object} Machine
 * @property {() => Promise<string[]>} userPath The user PATH, one entry per item, unexpanded.
 * @property {(folder: string) => Promise<boolean>} addToUserPath Adds a folder to the end of the
 *   user PATH unless it's already there. Returns whether it was added.
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
 * @property {number} patience How long, in milliseconds, to wait for what a program does after
 *   it has returned, such as an app it started opening. None for the fake, which does everything
 *   a program does before the run returns.
 */

/** @typedef {(file: string, args: string[]) => Promise<Ran>} Runner */

/** @typedef {{ code: number, output: string }} Ran */

/** @typedef {Partial<Ran> & { creates?: string[] }} Reply What a fake run returns and leaves behind. */

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
  const machine = places.fakeMachine ? fakeMachine(places.fakeMachine, places.home, logged) : realMachine(logged(runProgram));
  /** @type {Machine['openPage']} */
  const openPage = (url) => {
    log.detail(`Opening in the browser: ${url}`);
    return machine.openPage(url);
  };
  return { ...machine, runOnScreen: loggedOnScreen(machine.runOnScreen), runHere: logged(runProgram), openPage };
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
 * @param {string} folder
 * @param {string} home Where a reply's `creates` paths are, and the only place they may be.
 * @param {(run: Runner) => Runner} logged
 * @returns {Omit<Machine, 'runHere'>}
 */
function fakeMachine(folder, home, logged) {
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

  return {
    patience: 0,
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
    async userVariable(name) {
      return (await environment())[name];
    },
    async setUserVariable(name, value) {
      await write('environment.json', { ...(await environment()), [name]: value });
    },
    run: logged((file, args) => reply(file, args, { file, args })),
    async runOnScreen(file, args) {
      return (await reply(file, args, { file, args, onScreen: true })).code;
    },
    async openPage(url) {
      await write('pages.json', [...(await read('pages.json', [])), url]);
    },
  };

  /** @param {string} file @param {string[]} args @param {{ file: string, args: string[], onScreen?: boolean }} record @returns {Promise<Ran>} */
  async function reply(file, args, record) {
    /** @type {{ file: string, args: string[] }[]} */
    const runs = await read('runs.json', []);
    await write('runs.json', [...runs, record]);
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
    for (const path of found.creates ?? []) {
      const target = resolve(home, path);
      if (relative(home, target).startsWith('..')) throw new Error(`a fake run can't create ${path}: it's outside the home`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `left by a fake run of ${basename(file)}`);
    }
    return { code: found.code ?? 0, output: found.output ?? '' };
  }
}

/** @param {string} name */
export const system32 = (name) => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', name);

/**
 * The real user environment lives in HKCU\Environment. It's read and written with reg.exe
 * and setx.exe rather than PowerShell, because Constrained Language Mode blocks the .NET
 * calls PowerShell would need, and these are ordinary programs in System32.
 * @param {Runner} runProgram the logged runner, so reg.exe and setx.exe are logged too
 * @returns {Omit<Machine, 'runHere'>}
 */
function realMachine(runProgram) {
  const reg = system32('reg.exe');

  /** @param {string} name @returns {Promise<string | undefined>} */
  async function readVariable(name) {
    const { code, output } = await runProgram(reg, ['query', 'HKCU\\Environment', '/v', name]);
    if (code !== 0) return undefined;
    const match = new RegExp(`^\\s+${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.*)$`, 'im').exec(output);
    return match ? match[1].trimEnd() : '';
  }

  /**
   * setx writes the value and tells Windows the environment changed, so Explorer, and the
   * apps opened from it afterwards, pick up the new PATH.
   */
  async function announceChange() {
    const ping = 'AGENT_JUMPSTART_REFRESH';
    await runProgram(system32('setx.exe'), [ping, '1']);
    await runProgram(reg, ['delete', 'HKCU\\Environment', '/v', ping, '/f']);
  }

  return {
    async userPath() {
      return splitPath((await readVariable('Path')) ?? '');
    },
    async addToUserPath(folder) {
      const entries = splitPath((await readVariable('Path')) ?? '');
      if (!includesFolder(entries, folder)) {
        // REG_EXPAND_SZ keeps any %USERPROFILE%-style entries as they were.
        const value = [...entries, folder].join(';');
        const { code, output } = await runProgram(reg, ['add', 'HKCU\\Environment', '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', value, '/f']);
        if (code !== 0) throw new Error(`the user PATH couldn't be changed: ${output.trim()}`);
        await announceChange();
      }
      // Later steps in this run (gh, npm) need it too, and this process has the old PATH.
      if (!includesFolder(splitPath(process.env.Path ?? ''), folder)) process.env.Path = `${process.env.Path};${folder}`;
      return !includesFolder(entries, folder);
    },
    userVariable: readVariable,
    async setUserVariable(name, value) {
      const { code, output } = await runProgram(system32('setx.exe'), [name, value]);
      if (code !== 0) throw new Error(`${name} couldn't be set: ${output.trim()}`);
      process.env[name] = value;
    },
    patience: 120_000,
    run: runProgram,
    runOnScreen(file, args) {
      const how = startable(file, args);
      if ('refused' in how) return Promise.resolve(-1);
      return new Promise((resolve) => {
        const child = spawn(how.file, how.args, { ...how.options, stdio: 'inherit' });
        child.once('error', () => resolve(-1));
        child.once('close', (code) => resolve(code ?? -1));
      });
    },
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

/** @param {string} file @param {string[]} args @returns {Promise<Ran>} */
function runProgram(file, args) {
  const how = startable(file, args);
  if ('refused' in how) return Promise.resolve({ code: -1, output: how.refused });
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(how.file, how.args, { ...how.options, windowsHide: true });
    child.stdout?.on('data', (chunk) => (output += chunk));
    child.stderr?.on('data', (chunk) => (output += chunk));
    child.once('error', (error) => resolve({ code: -1, output: error.message }));
    child.once('close', (code) => resolve({ code: code ?? -1, output }));
  });
}
