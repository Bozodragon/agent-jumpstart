// Installs T3 Code per user on the channel the person chose. Unlike the other tools, T3 isn't
// pinned: the installer follows T3's own release feed (the file its in-app updater reads),
// which names the current build and its SHA-512, so the download is checked against the hash
// T3 published. Stable's feed has a fixed address; nightly has none, so the newest nightly tag
// comes from the GitHub API. Stable and nightly replace each other and share one settings
// folder. It runs after the other tools and their PATH entries, because T3 reads PATH only
// when it starts. The silent install starts T3, and T3's first start leaves its command-line
// shim, which is how the installer knows T3 has opened at least once.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadManifest } from './manifest.js';
import { messageOf } from './stop.js';
import { change, exists, NotInstalled, obtain } from './tools.js';
import * as ui from './ui.js';

/**
 * T3's entry in the manifest.
 * @typedef {object} T3Entry
 * @property {string} name
 * @property {Record<string, T3Channel>} channels By channel (`stable`, `nightly`).
 * @property {Partial<Record<string, string>>} files By processor: a pattern the build's file name matches.
 * @property {{ folder: string, arguments: string[], versionIn: string, firstLaunchLeaves: string }} install
 *   `folder` is under `%LOCALAPPDATA%\Programs`; `versionIn` is the registry key whose
 *   `DisplayVersion` is the installed version; `firstLaunchLeaves` is the file, relative to the
 *   home, that T3 writes when it starts.
 */

/**
 * @typedef {object} T3Channel
 * @property {string} feed The release feed's address. `{tag}` is the release's tag.
 * @property {string} download The build's address: `{tag}`, `{version}` and `{file}` are filled in.
 * @property {string} program The program the install leaves in the folder.
 * @property {string} [releases] Where to list releases, when the feed has no fixed address.
 * @property {string} [tag] The pattern the channel's tags match.
 */

/**
 * @typedef {object} T3Result
 * @property {string} row The checklist's T3 Code line.
 * @property {boolean} installed Whether T3 is in place.
 * @property {boolean} opened Whether T3 has started at least once (its shim is there).
 */

/**
 * @param {'stable' | 'nightly'} channel
 * @param {import('./tools.js').Context & { attended: boolean }} context
 * @returns {Promise<T3Result>}
 */
export async function installT3(channel, context) {
  const { places, machine, downloads, keepDownloads, log, attended } = context;
  const manifest = await loadManifest(downloads);
  const entry = /** @type {T3Entry | undefined} */ (/** @type {unknown} */ (manifest.tools.find((tool) => tool.id === 't3')));
  if (!entry) return { row: 'Not installed: the list of versions has no entry for it', installed: false, opened: false };
  const say = (/** @type {string} */ line) => log.write(`${entry.name}: ${line}`);
  ui.step(`Installing ${entry.name} (${channel})`);
  const shim = join(places.home, entry.install.firstLaunchLeaves);

  let release;
  let already = false;
  let changed = change.installed;
  try {
    const where = entry.channels[channel];
    if (!where) throw new NotInstalled(`the list of versions has no ${channel} channel`);
    release = await findRelease(entry, where, { downloads, say });
    say(`${channel} is ${release.version}, ${basename(new URL(release.url).pathname)}`);

    const program = join(places.programs, entry.install.folder, where.program);
    const installed = await installedVersion(machine, entry.install.versionIn);
    const programThere = await exists(program);
    if (programThere && installed === release.version) {
      say(`${release.version} is already in ${program}`);
      already = true;
      changed = change.upToDate;
    } else {
      if (installed && installed !== release.version) changed = change.updatedFrom(installed);
      else if (installed || programThere) changed = change.reinstalled;
      if (installed) say(`replacing ${installed}`);
      const file = await obtain({ url: release.url }, { downloads, saveIn: join(places.state, 'downloads'), say });
      try {
        await checkSha512(file, release.sha512, say);
        say(`running ${basename(file)} ${entry.install.arguments.join(' ')}`);
        const ran = await machine.run(file, entry.install.arguments);
        if (ran.code !== 0) {
          say(`installer output: ${ran.output.trim()}`);
          throw new NotInstalled(`its installer stopped with code ${ran.code}`);
        }
      } finally {
        if (keepDownloads) say(`kept ${file}`);
        else await rm(file, { force: true });
      }
      if (!(await exists(program))) {
        say(`${program} isn't there after the install`);
        throw new NotInstalled("its installer didn't leave it in place");
      }
      say(`installed ${release.version}`);
    }
  } catch (error) {
    if (!(error instanceof NotInstalled)) say(`failed: ${error instanceof Error ? error.stack : String(error)}`);
    const reason = error instanceof NotInstalled ? error.message : messageOf(error);
    say(`not installed: ${reason}`);
    return { row: `Not installed: ${reason}`, installed: false, opened: await exists(shim) };
  }

  // The silent install starts T3 (--force-run); an install that was already there may never have been opened.
  const opened = await waitForFirstLaunch(shim, already ? 0 : machine.patience, { attended, say, name: entry.name });
  const state = [channel, changed, ...(opened ? [] : ['not opened yet'])].join(', ');
  return { row: `${release.version} (${state})`, installed: true, opened };
}

/**
 * @param {T3Entry} entry @param {T3Channel} where
 * @param {{ downloads?: string, say: (line: string) => void }} how
 * @returns {Promise<{ version: string, url: string, sha512: string }>}
 */
async function findRelease(entry, where, how) {
  let tag = '';
  if (where.releases) {
    const listed = JSON.parse(await fetchText(where.releases, how));
    const pattern = new RegExp(where.tag ?? '.');
    const newest = Array.isArray(listed) ? listed.find((release) => !release.draft && pattern.test(release.tag_name)) : undefined;
    if (!newest) throw new NotInstalled("GitHub didn't list a build for that channel");
    tag = newest.tag_name;
  }
  const feed = parseFeed(await fetchText(where.feed.replaceAll('{tag}', tag), how));
  const pattern = entry.files[process.arch];
  const build = pattern ? feed.files.find((file) => new RegExp(pattern).test(file.url)) : undefined;
  if (!feed.version || !build) throw new NotInstalled(`there's no build for this kind of computer (${process.arch})`);
  const url = where.download.replaceAll('{tag}', tag).replaceAll('{version}', feed.version).replaceAll('{file}', build.url);
  return { version: feed.version, url, sha512: build.sha512 };
}

/**
 * An electron-builder release feed (`latest.yml`, `nightly.yml`): the version and each
 * build's file name and Base64 SHA-512. Only those few lines are read.
 * @param {string} text
 */
function parseFeed(text) {
  const version = /^version:\s*'?([^'\s]+)'?\s*$/m.exec(text)?.[1];
  /** @type {{ url: string, sha512: string }[]} */
  const files = [];
  for (const line of text.split(/\r?\n/)) {
    const url = /^\s*-\s*url:\s*'?([^'\s]+)'?\s*$/.exec(line)?.[1];
    if (url) files.push({ url, sha512: '' });
    const sha512 = /^\s+sha512:\s*'?([^'\s]+)'?\s*$/.exec(line)?.[1];
    if (sha512 && files.length > 0) files[files.length - 1].sha512 = sha512;
  }
  return { version, files };
}

/**
 * Small files (the feed, the release list): fetched, or taken from the downloads folder
 * by the address's file name (the GitHub release list is the file `releases`).
 * @param {string} url @param {{ downloads?: string, say: (line: string) => void }} how
 */
async function fetchText(url, { downloads, say }) {
  if (downloads) {
    const file = join(downloads, basename(new URL(url).pathname));
    try {
      const text = await readFile(file, 'utf8');
      say(`taking ${file}`);
      return text;
    } catch {
      say(`${file} isn't there`);
      throw new NotInstalled('its release details were missing');
    }
  }
  say(`reading ${url}`);
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'agent-jumpstart', Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`the server said ${response.status} ${response.statusText}`);
    return await response.text();
  } catch (error) {
    const cause = error instanceof Error && error.cause ? error.cause : error;
    say(`couldn't read ${url}: ${messageOf(cause)}`);
    throw new NotInstalled("its release details couldn't be downloaded");
  }
}

/** @param {string} file @param {string} expected Base64 @param {(line: string) => void} say */
async function checkSha512(file, expected, say) {
  const hash = createHash('sha512');
  await pipeline(createReadStream(file), hash);
  const actual = hash.digest('base64');
  if (!expected || actual !== expected) {
    say(`checksum ${actual} isn't the published ${expected || '(none)'}`);
    throw new NotInstalled("the download didn't match T3's checksum");
  }
  say('checksum matches');
}

/**
 * The version Windows records for T3's per-user install, read with reg.exe (CLM-safe).
 * @param {import('./machine.js').Machine} machine @param {string} key
 * @returns {Promise<string | undefined>}
 */
async function installedVersion(machine, key) {
  const reg = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe');
  const { code, output } = await machine.run(reg, ['query', key, '/v', 'DisplayVersion']);
  if (code !== 0) return undefined;
  return /^\s+DisplayVersion\s+REG_SZ\s+(\S+)/im.exec(output)?.[1];
}

/**
 * Waits for T3's first start to leave its shim. If it doesn't come, the person (when there is
 * one) is asked to open T3 from the Start menu.
 * @param {string} shim @param {number} patience
 * @param {{ attended: boolean, say: (line: string) => void, name: string }} how
 */
async function waitForFirstLaunch(shim, patience, { attended, say, name }) {
  const until = Date.now() + patience;
  if (patience > 0 && !(await exists(shim))) ui.step(`Waiting for ${name} to open`);
  while (!(await exists(shim)) && Date.now() < until) await sleep(1000);
  if (!(await exists(shim)) && attended) {
    ui.notice(`Open ${name} from the Start menu and wait for its window to appear.`, `Open ${name}`);
    await ui.pressEnter(`Press Enter once ${name} is open.`);
  }
  const opened = await exists(shim);
  say(opened ? `first launch seen (${shim})` : `hasn't been opened yet (no ${shim})`);
  return opened;
}
