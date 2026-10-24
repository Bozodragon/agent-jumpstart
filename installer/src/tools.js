// Installs the pinned tools per user: downloads each from its vendor (or takes it from the
// downloads folder), checks it against its pinned checksum, puts it under
// %LOCALAPPDATA%\Programs and its folders on the user PATH. A tool that can't be installed is
// reported in the checklist with the reason; it never stops the run.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { loadManifest } from './manifest.js';
import { messageOf } from './stop.js';
import * as ui from './ui.js';

/** A reason a tool isn't installed, worded for the checklist. */
class NotInstalled extends Error {}

/**
 * @typedef {object} Context
 * @property {import('./places.js').Places} places
 * @property {import('./machine.js').Machine} machine
 * @property {string} [downloads] The downloads-folder override. It stands in for the internet
 *   only: what's taken from it is still copied into the installer's own downloads folder.
 * @property {boolean} [keepDownloads] Leave the downloads in the installer's own folder after
 *   use (a debug run) rather than deleting them.
 * @property {{ write(line: string): void }} log
 */

/**
 * Installs every tool in the manifest, in order.
 * @param {Context} context
 * @returns {Promise<[string, string][]>} checklist rows
 */
export async function installTools(context) {
  const manifest = await loadManifest(context.downloads);
  context.log.write(`Versions from: ${manifest.source}`);
  /** @type {[string, string][]} */
  const rows = [];
  for (const tool of manifest.tools) rows.push([tool.name, await installTool(tool, context)]);
  return rows;
}

/**
 * @param {import('./manifest.js').Tool} tool
 * @param {Context} context
 * @returns {Promise<string>} the version installed, or why it isn't
 */
export async function installTool(tool, { places, machine, downloads, keepDownloads, log }) {
  const say = (/** @type {string} */ line) => log.write(`${tool.name}: ${line}`);
  ui.step(`Installing ${tool.name} ${tool.version}`);
  const folder = join(places.programs, tool.install.folder);
  const check = join(folder, tool.install.check);
  try {
    if ((await exists(check)) && (await reportsVersion(machine, check, tool.version))) {
      say(`${tool.version} is already in ${folder}`);
      await addToPath(tool, folder, machine, say);
      return `${tool.version} (already installed)`;
    }

    const download = tool.downloads[process.arch];
    if (!download) throw new NotInstalled(`there's no pinned download for this kind of computer (${process.arch})`);
    const file = await obtain(download, { downloads, saveIn: join(places.state, 'downloads'), say });

    try {
      await checkSum(file, download.sha256, say);
      if (tool.install.how === 'zip') {
        await unpack(file, folder, tool.install.check, { scratch: join(places.state, 'unpacking'), machine, say });
        say(`unpacked to ${folder}`);
      } else {
        const args = (tool.install.arguments ?? []).map((arg) => arg.replaceAll('{folder}', folder));
        say(`running ${basename(file)} ${args.join(' ')}`);
        const ran = await machine.run(file, args);
        if (ran.code !== 0) {
          say(`installer output: ${ran.output.trim()}`);
          throw new NotInstalled(`its installer stopped with code ${ran.code}`);
        }
      }
    } finally {
      if (keepDownloads) say(`kept ${file}`);
      else await rm(file, { force: true });
    }

    // A per-user program can be blocked from running (AppLocker), so prove it runs.
    const ran = await machine.run(check, ['--version']);
    if (ran.code !== 0) {
      say(`${check} --version: ${ran.output.trim()}`);
      throw new NotInstalled("Windows wouldn't run it");
    }
    await addToPath(tool, folder, machine, say);
    say(`installed ${tool.version}`);
    return tool.version;
  } catch (error) {
    if (!(error instanceof NotInstalled)) say(`failed: ${error instanceof Error ? error.stack : String(error)}`);
    const reason = error instanceof NotInstalled ? error.message : messageOf(error);
    say(`not installed: ${reason}`);
    return `Not installed: ${reason}`;
  }
}

/** @param {string} path */
const exists = (path) => access(path).then(() => true, () => false);

/** @param {import('./machine.js').Machine} machine @param {string} program @param {string} version */
async function reportsVersion(machine, program, version) {
  const ran = await machine.run(program, ['--version']);
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return ran.code === 0 && new RegExp(`(?<![\\d.])${escaped}(?![\\d])`).test(ran.output);
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
 * @param {import('./manifest.js').Download} download
 * @param {{ downloads?: string, saveIn: string, say: (line: string) => void }} where
 * @returns {Promise<string>} the file
 */
async function obtain({ url }, { downloads, saveIn, say }) {
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
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    const ran = await machine.runHere(tar, ['-xf', zip, '-C', scratch]);
    if (ran.code !== 0) {
      say(`tar: ${ran.output.trim()}`);
      throw new NotInstalled("the download couldn't be unpacked");
    }
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
