// Installs the pinned tools per user: downloads each from its vendor (or takes it from the
// downloads folder), checks it against its pinned checksum, puts it under
// %LOCALAPPDATA%\Programs and its folders on the user PATH. A tool that can't be installed is
// reported in the checklist with the reason; it never stops the run.
//
// A copy the person already has is never replaced, moved or shadowed:
//   - one on the machine or user PATH outside the tool's folder here is left as it is, gets no
//     PATH entry, and is the copy later steps run (the GitHub sign-in uses that gh, the Apps
//     Script sign-in that clasp);
//   - so is one in the tool's folder here that the installer didn't put there.
// The installer knows a copy is its own by the marker file it leaves in the tool's folder after
// each install (`installedMarker`). Only those are updated to the pin. A folder here that holds
// something else, and not the tool, is left alone too, and the tool isn't installed.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { system32 } from './machine.js';
import { loadManifest } from './manifest.js';
import { messageOf } from './stop.js';
import * as ui from './ui.js';

/** A reason a tool isn't installed, worded for the checklist. */
export class NotInstalled extends Error {}

/** The file the installer leaves in a tool's folder once it has installed the tool there. */
export const installedMarker = '.installed-by-agent-jumpstart';

/**
 * @typedef {object} Context
 * @property {import('./places.js').Places} places
 * @property {import('./machine.js').Machine} machine
 * @property {string} [downloads] The downloads-folder override. It stands in for the internet
 *   only: what's taken from it is still copied into the installer's own downloads folder.
 * @property {boolean} [keepDownloads] Leave the downloads in the installer's own folder after
 *   use (a debug run) rather than deleting them.
 * @property {import('./log.js').Log} log
 * @property {boolean} attended Whether someone is at the screen. Not when the answers came from
 *   a file: then nothing waits for Enter.
 */

/**
 * How to run a tool: a program, and the arguments that come before the tool's own (for a
 * package run with Node, its script).
 * @typedef {{ file: string, args: string[] }} Command
 */

/**
 * @typedef {object} Installed
 * @property {boolean} installed Whether the tool is in place, the installer's or the person's.
 * @property {string} row Its checklist row: the version and what this run did (see `change`),
 *   or why it isn't installed.
 * @property {Command} [program] The copy later steps run, when it's in place.
 */

/**
 * Installs every tool in the manifest, in order, except those set aside for a later step
 * (`when`).
 * @param {Context} context
 * @returns {Promise<{ rows: [string, string][], programs: Partial<Record<string, Command>> }>}
 *   checklist rows, and the copy of each tool in place that later steps run, by id
 */
export async function installTools(context) {
  const manifest = await loadManifest(context.downloads);
  context.log.write(`Versions from: ${manifest.source}`);
  /** @type {[string, string][]} */
  const rows = [];
  /** @type {Partial<Record<string, Command>>} */
  const programs = {};
  for (const tool of manifest.tools) {
    if (tool.when) continue;
    const { row, program } = await installTool(tool, context);
    rows.push([tool.name, row]);
    if (program) programs[tool.id] = program;
  }
  return { rows, programs };
}

/**
 * @param {import('./manifest.js').Tool} tool
 * @param {Context} context
 * @returns {Promise<Installed>} A copy of the installer's at another version is replaced; the
 *   person's own copy is left as it is.
 */
export async function installTool(tool, { places, machine, downloads, keepDownloads, log }) {
  const say = (/** @type {string} */ line) => log.write(`${tool.name}: ${line}`);
  const folder = join(places.programs, tool.install.folder);
  const marker = join(folder, installedMarker);
  /** @type {Command | undefined} */
  let here;
  try {
    here = await commandIn(tool, folder);
    const ours = await exists(marker);
    if (here && !ours) {
      say(`${folder} holds it, but the installer didn't put it there`);
      return await leaveTheirs(tool, here, folder, { machine, say });
    }
    if (!here && !ours) {
      // A tool only the installer runs (no PATH entry) is always its own copy.
      const name = basename(tool.install.check);
      const elsewhere = tool.install.path.length === 0 ? [] : (await machine.findOnPath(name)).filter((found) => !isInside(found, folder));
      if (elsewhere.length > 0) {
        say(`found on the PATH at ${elsewhere.join(', ')}`);
        return await leaveTheirs(tool, { file: join(elsewhere[0], name), args: [] }, elsewhere[0], { machine, say });
      }
      if (await holdsAnything(folder)) {
        say(`${folder} holds other things, not ${tool.install.check}, and the installer didn't put them there, so it's left as it is`);
        throw new NotInstalled(`${folder} already holds something else`);
      }
    }
  } catch (error) {
    return notInstalled(error, say);
  }

  // The download and the install show nothing of their own, for a minute or more.
  const there = here;
  return ui.busy(
    `Installing ${tool.name} ${tool.version}`,
    () => putInPlace(tool, there, { places, machine, downloads, keepDownloads, say }),
    ({ installed, row }) => ({ text: `${tool.name}: ${row}`, ok: installed }),
  );
}

/**
 * Why a tool isn't installed, logged, as its result.
 * @param {unknown} error @param {(line: string) => void} say
 * @returns {Installed}
 */
function notInstalled(error, say) {
  if (!(error instanceof NotInstalled)) say(`failed: ${error instanceof Error ? error.stack : String(error)}`);
  const reason = error instanceof NotInstalled ? error.message : messageOf(error);
  say(`not installed: ${reason}`);
  return { installed: false, row: `Not installed: ${reason}` };
}

/**
 * Puts the pinned version in the tool's folder here, unless the installer's copy there is it
 * already, and its folders on the user PATH. Prints nothing.
 * @param {import('./manifest.js').Tool} tool
 * @param {Command | undefined} here the installer's copy already in the folder, if any
 * @param {Pick<Context, 'places' | 'machine' | 'downloads' | 'keepDownloads'> & { say: (line: string) => void }} how
 * @returns {Promise<Installed>}
 */
async function putInPlace(tool, here, { places, machine, downloads, keepDownloads, say }) {
  const folder = join(places.programs, tool.install.folder);
  const marker = join(folder, installedMarker);
  try {
    const before = here ? await versionThere(machine, here, tool.version) : { present: false, upToDate: false };
    if (here && before.upToDate) {
      say(`${tool.version} is already in ${folder}`);
      await addToPath(tool, folder, machine, say);
      return { installed: true, row: `${tool.version} (${change.upToDate})`, program: here };
    }
    if (before.present) say(`replacing ${before.version ?? "a copy whose version couldn't be read"}`);

    const download = tool.downloads[process.arch];
    if (!download) throw new NotInstalled(`there's no pinned download for this kind of computer (${process.arch})`);
    const file = await obtain(download, { downloads, saveIn: join(places.state, 'downloads'), say });
    /** Why the tool's installer stopped, when its portable copy was unpacked instead. */
    let portable;

    try {
      await checkSum(file, download.sha256, say);
      if (tool.install.how === 'zip') {
        await unpack(file, folder, tool.install.check, { scratch: join(places.state, 'unpacking'), machine, say });
        say(`unpacked to ${folder}`);
      } else if (tool.install.how === 'npm') {
        // The npm beside the Node running this (the pinned one the bootstrap unpacked in the
        // installer's own folder). The package goes in its own prefix, not npm's default.
        const npm = join(dirname(process.execPath), 'npm.cmd');
        const args = ['install', '--global', '--prefix', folder, '--no-audit', '--no-fund', file];
        const ran = await machine.run(npm, args);
        if (ran.code !== 0) throw new NotInstalled(`npm stopped with code ${ran.code}`);
      } else {
        // An installer that keeps its own log (Git's) is told to keep it here, since its exit
        // code alone rarely says why it stopped; a failed one's log is copied into this one's.
        const setupLog = join(places.state, `${tool.id}-setup.log`);
        await rm(setupLog, { force: true });
        const args = (tool.install.arguments ?? []).map((arg) => arg.replaceAll('{folder}', folder).replaceAll('{log}', setupLog));
        const ran = await machine.run(file, args);
        if (ran.code !== 0) {
          const kept = await readFile(setupLog, 'utf8').catch(() => undefined);
          if (kept !== undefined) {
            const lines = kept.trimEnd().split(/\r?\n/).slice(-60);
            say([`the end of its installer's own log (${setupLog}):`, ...lines.map((line) => `  | ${line}`)].join('\n'));
          }
          const stopped = `its installer stopped with code ${ran.code}`;
          if (!tool.fallback) throw new NotInstalled(stopped);
          say(`${stopped}, so its portable copy is unpacked instead`);
          const code = await unpackFallback(tool.fallback, folder, { places, machine, downloads, keepDownloads, say });
          if (code !== 0) throw new NotInstalled(`${stopped}, and its portable copy with code ${code}`);
          portable = stopped;
        }
      }
    } finally {
      if (keepDownloads) say(`kept ${file}`);
      else await rm(file, { force: true });
    }

    const program = tool.install.package ? await commandIn(tool, folder) : { file: join(folder, tool.install.check), args: [] };
    if (!program) throw new NotInstalled("npm didn't leave it in place");
    // A per-user program can be blocked from running (AppLocker), so prove it runs.
    const ran = await machine.run(program.file, [...program.args, '--version']);
    if (ran.code !== 0) throw new NotInstalled("Windows wouldn't run it");
    await mkdir(folder, { recursive: true });
    await writeFile(marker, `Installed by agent-jumpstart (${tool.name} ${tool.version}). A later run updates what's in this folder.\n`);
    await addToPath(tool, folder, machine, say);
    say(`installed ${tool.version}`);
    const how = portable ? ` as a portable copy, because ${portable}` : '';
    return { installed: true, row: `${tool.version} (${changeFrom(before)}${how})`, program };
  } catch (error) {
    return notInstalled(error, say);
  }
}

/**
 * Downloads a tool's self-extracting fallback, checks it against its pinned checksum and runs it
 * to unpack into the tool's folder.
 * @param {import('./manifest.js').Fallback} fallback @param {string} folder
 * @param {Pick<Context, 'places' | 'machine' | 'downloads' | 'keepDownloads'> & { say: (line: string) => void }} how
 * @returns {Promise<number>} its exit code
 */
async function unpackFallback(fallback, folder, { places, machine, downloads, keepDownloads, say }) {
  const download = fallback.downloads[process.arch];
  if (!download) throw new NotInstalled(`there's no pinned portable copy for this kind of computer (${process.arch})`);
  const file = await obtain(download, { downloads, saveIn: join(places.state, 'downloads'), say });
  try {
    await checkSum(file, download.sha256, say);
    const ran = await machine.run(file, fallback.arguments.map((arg) => arg.replaceAll('{folder}', folder)));
    if (ran.code === 0) say(`portable copy unpacked to ${folder}`);
    return ran.code;
  } finally {
    if (keepDownloads) say(`kept ${file}`);
    else await rm(file, { force: true });
  }
}

/**
 * The person's own copy: asked its version for the checklist, and otherwise left exactly as it
 * is, with no PATH entry added for it.
 * @param {import('./manifest.js').Tool} tool @param {Command} program @param {string} folder
 * @param {{ machine: import('./machine.js').Machine, say: (line: string) => void }} how
 * @returns {Promise<Installed>}
 */
async function leaveTheirs(tool, program, folder, { machine, say }) {
  ui.step(`Using the ${tool.name} already at ${folder}`);
  const ran = await machine.run(program.file, [...program.args, '--version']);
  const version = ran.code === 0 ? versionIn(ran.output) : undefined;
  say(`${version ?? "a version that couldn't be read"} is already installed at ${folder}, so it's left as it is and used`);
  return { installed: true, row: `${version ?? 'Version unknown'} (already installed at ${folder}, left as it is)`, program };
}

/**
 * How to run the tool in its folder here, if it's there: its program, or for a package only the
 * installer runs, the installer's own Node with the bin script the package's package.json names
 * (so it never depends on whichever node is first on PATH, as npm's .cmd shim would).
 * @param {import('./manifest.js').Tool} tool @param {string} folder
 * @returns {Promise<Command | undefined>}
 */
async function commandIn(tool, folder) {
  const name = tool.install.package;
  if (!name) {
    const program = join(folder, tool.install.check);
    return (await exists(program)) ? { file: program, args: [] } : undefined;
  }
  const packageFolder = join(folder, 'node_modules', name);
  let bin;
  try {
    bin = JSON.parse(await readFile(join(packageFolder, 'package.json'), 'utf8')).bin;
  } catch {
    return undefined;
  }
  const script = typeof bin === 'string' ? bin : bin && typeof bin === 'object' ? (bin[name] ?? Object.values(bin)[0]) : undefined;
  if (typeof script !== 'string') return undefined;
  const path = join(packageFolder, script);
  return (await exists(path)) ? { file: process.execPath, args: [path] } : undefined;
}

/** @param {string} inner @param {string} outer */
function isInside(inner, outer) {
  const path = relative(outer.toLowerCase(), inner.toLowerCase());
  return !path.startsWith('..') && !isAbsolute(path);
}

/** @param {string} folder */
const holdsAnything = async (folder) => (await readdir(folder).catch(() => [])).length > 0;

/** @param {string} path */
export const exists = (path) => access(path).then(() => true, () => false);

/**
 * What a tool's checklist row says this run did to it, worded the same for every tool (T3 and
 * the extra tools too), so a re-run's checklist shows what changed and what was already right.
 */
export const change = {
  installed: 'installed',
  /** @param {string} version */
  updatedFrom: (version) => `updated from ${version}`,
  reinstalled: 'reinstalled',
  upToDate: 'already up to date',
};

/**
 * @typedef {object} Before What was in a tool's folder before this run.
 * @property {boolean} present Whether its program was there.
 * @property {boolean} upToDate Whether that program reported the pinned version.
 * @property {string} [version] The version it reported, if one could be read.
 */

/** @param {Before} before */
const changeFrom = (before) => (!before.present ? change.installed : before.version ? change.updatedFrom(before.version) : change.reinstalled);

/**
 * The first version-shaped word: `v24.11.0`, `git version 2.50.1.windows.1`, `gh version 2.90.0 (…)`.
 * @param {string} output
 */
const versionIn = (output) => /\d+\.\d+(?:\.[0-9A-Za-z-]+)*/.exec(output)?.[0];

/**
 * Asks the installer's copy already in the tool's folder for its version.
 * @param {import('./machine.js').Machine} machine @param {Command} program @param {string} pinned
 * @returns {Promise<Before>}
 */
async function versionThere(machine, program, pinned) {
  const ran = await machine.run(program.file, [...program.args, '--version']);
  if (ran.code !== 0) return { present: true, upToDate: false };
  const escaped = pinned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(?<![\\d.])${escaped}(?![\\d])`).test(ran.output)) return { present: true, upToDate: true, version: pinned };
  return { present: true, upToDate: false, version: versionIn(ran.output) };
}

/**
 * @param {import('./manifest.js').Tool} tool @param {string} folder
 * @param {import('./machine.js').Machine} machine @param {(line: string) => void} say
 */
async function addToPath(tool, folder, machine, say) {
  for (const inside of tool.install.path) {
    const entry = join(folder, inside);
    say((await machine.addToUserPath(entry)) ? `added ${entry} to the user PATH` : `${entry} was already on the user PATH`);
  }
}

/**
 * @param {{ url: string }} download
 * @param {{ downloads?: string, saveIn: string, say: (line: string) => void }} where
 * @returns {Promise<string>} the file
 */
export async function obtain({ url }, { downloads, saveIn, say }) {
  const name = basename(new URL(url).pathname);
  const file = join(saveIn, name);
  if (downloads) {
    const source = join(downloads, name);
    if (!(await exists(source))) {
      say(`${source} isn't there`);
      throw new NotInstalled("it wasn't in the downloads folder");
    }
    say(`taking ${source}`);
    await mkdir(saveIn, { recursive: true });
    await copyFile(source, file);
    say(`downloaded to ${file}`);
    return file;
  }
  await mkdir(saveIn, { recursive: true });
  say(`downloading ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`the server said ${response.status} ${response.statusText}`);
    await pipeline(Readable.fromWeb(/** @type {any} */ (response.body)), createWriteStream(file));
  } catch (error) {
    await rm(file, { force: true });
    const cause = error instanceof Error && error.cause ? error.cause : error;
    say(`download failed: ${messageOf(cause)}`);
    throw new NotInstalled(`it couldn't be downloaded (${messageOf(cause)})`);
  }
  say(`downloaded to ${file}`);
  return file;
}

/** @param {string} file @param {string} expected @param {(line: string) => void} say */
async function checkSum(file, expected, say) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  const actual = hash.digest('hex');
  if (actual !== expected.toLowerCase()) {
    say(`checksum ${actual} isn't the pinned ${expected}`);
    throw new NotInstalled("the download didn't match its pinned checksum");
  }
  say('checksum matches');
}

/**
 * Unpacks with Windows' own tar (in System32 since Windows 10), into a scratch folder first,
 * then swaps it in for any earlier copy.
 * @param {string} zip @param {string} folder @param {string} check the program it must hold
 * @param {{ scratch: string, machine: import('./machine.js').Machine, say: (line: string) => void }} how
 */
async function unpack(zip, folder, check, { scratch, machine, say }) {
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  try {
    const ran = await machine.runHere(system32('tar.exe'),['-xf', zip, '-C', scratch]);
    if (ran.code !== 0) throw new NotInstalled("the download couldn't be unpacked");
    // Node's zip wraps everything in one top folder; gh's doesn't.
    const entries = await readdir(scratch);
    const candidates = entries.length === 1 ? [scratch, join(scratch, entries[0])] : [scratch];
    let contents;
    for (const candidate of candidates) if (!contents && (await exists(join(candidate, check)))) contents = candidate;
    if (!contents) throw new NotInstalled(`the download didn't hold ${check}`);
    try {
      await rm(folder, { recursive: true, force: true });
    } catch (error) {
      say(`couldn't remove ${folder}: ${messageOf(error)}`);
      throw new NotInstalled("the copy already there couldn't be replaced");
    }
    await mkdir(dirname(folder), { recursive: true });
    await rename(contents, folder);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
