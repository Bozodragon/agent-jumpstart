// Everything that would change the machine outside the installer's own folders: the user's
// environment variables (PATH among them) and the programs it runs (vendor installers, and
// later gh, claude, npm). With a home override all of it is faked inside that home, so a test
// can run the real installer end to end and touch nothing else:
//
//   <home>/fake-machine/environment.json  the user environment variables, as HKCU\Environment
//                                         holds them; the user PATH is `Path`, joined with `;`
//   <home>/fake-machine/runs.json         every program it was asked to run: [{ file, args }]
//   <home>/fake-machine/replies.json      written by a test: what a run returns, keyed by the
//                                         file name, or the file name and its arguments
//                                         ("gh.exe auth status"). No reply means code 0, no output.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/**
 * @typedef {object} Machine
 * @property {() => Promise<string[]>} userPath The user PATH, one entry per item, unexpanded.
 * @property {(folder: string) => Promise<boolean>} addToUserPath Adds a folder to the end of the
 *   user PATH unless it's already there. Returns whether it was added.
 * @property {(name: string, value: string) => Promise<void>} setUserVariable Sets a user
 *   environment variable, seen by programs started afterwards.
 * @property {(file: string, args: string[]) => Promise<Ran>} run Runs a program and waits for it.
 *   Never throws: a program that couldn't start gives code -1 and the reason as its output.
 */

/** @typedef {{ code: number, output: string }} Ran */

/** @param {import('./places.js').Places} places @returns {Machine} */
export function openMachine(places) {
  return places.fakeMachine ? fakeMachine(places.fakeMachine) : realMachine();
}

/** @param {string} entry */
const sameFolder = (entry) => expand(entry).replace(/[\\/]+$/, '').toLowerCase();

/** Expands `%NAME%` the way Windows does for a REG_EXPAND_SZ value. @param {string} text */
const expand = (text) => text.replace(/%([^%]+)%/g, (whole, name) => process.env[name] ?? whole);

/** @param {string[]} entries @param {string} folder */
const includesFolder = (entries, folder) => entries.some((entry) => sameFolder(entry) === sameFolder(folder));

/** @param {string} raw */
const splitPath = (raw) => raw.split(';').filter((entry) => entry.trim() !== '');

/** @param {string} folder @returns {Machine} */
function fakeMachine(folder) {
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
    async setUserVariable(name, value) {
      await write('environment.json', { ...(await environment()), [name]: value });
    },
    async run(file, args) {
      await write('runs.json', [...(await read('runs.json', [])), { file, args }]);
      /** @type {Record<string, Partial<Ran>>} */
      const replies = await read('replies.json', {});
      const reply = replies[[basename(file), ...args].join(' ')] ?? replies[basename(file)] ?? {};
      return { code: reply.code ?? 0, output: reply.output ?? '' };
    },
  };
}

/** @param {string} name */
const system32 = (name) => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', name);

/**
 * The real user environment lives in HKCU\Environment. It's read and written with reg.exe
 * and setx.exe rather than PowerShell, because Constrained Language Mode blocks the .NET
 * calls PowerShell would need, and these are ordinary programs in System32.
 * @returns {Machine}
 */
function realMachine() {
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
    async setUserVariable(name, value) {
      const { code, output } = await runProgram(system32('setx.exe'), [name, value]);
      if (code !== 0) throw new Error(`${name} couldn't be set: ${output.trim()}`);
      process.env[name] = value;
    },
    run: runProgram,
  };
}

/**
 * Node won't start a .cmd or .bat file by itself, so those run through cmd.exe. The command line
 * is built here, quoted for cmd, and passed as it is: anything cmd would still expand inside
 * quotes (`%`, `!`, `"`, line breaks) is refused rather than escaped.
 * @param {string} file @param {string[]} args @returns {Promise<Ran>}
 */
function runProgram(file, args) {
  if (!/\.(cmd|bat)$/i.test(file)) return spawnAndWait(file, args, {});
  const unsafe = [file, ...args].find((arg) => /["%!\r\n]/.test(arg));
  if (unsafe !== undefined) return Promise.resolve({ code: -1, output: `can't pass ${unsafe} to ${basename(file)} safely` });
  const line = [file, ...args].map((arg) => (arg === '' || /[\s&|<>^(),;=]/.test(arg) ? `"${arg}"` : arg)).join(' ');
  // /d skips AutoRun commands; /s with the outer quotes keeps the line exactly as built.
  return spawnAndWait(process.env.ComSpec ?? system32('cmd.exe'), ['/d', '/s', '/c', `"${line}"`], { windowsVerbatimArguments: true });
}

/**
 * @param {string} file @param {string[]} args @param {import('node:child_process').SpawnOptions} options
 * @returns {Promise<Ran>}
 */
function spawnAndWait(file, args, options) {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(file, args, { ...options, windowsHide: true });
    child.stdout?.on('data', (chunk) => (output += chunk));
    child.stderr?.on('data', (chunk) => (output += chunk));
    child.once('error', (error) => resolve({ code: -1, output: error.message }));
    child.once('close', (code) => resolve({ code: code ?? -1, output }));
  });
}
