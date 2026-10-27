// Installs T3 Code per user on the channel the person chose. Unlike the other tools, T3 isn't
// pinned: `t3-release.js` finds the channel's current build in T3's own release feed and checks
// the download against the hash T3 published. Stable and nightly replace each other and share
// one settings folder. It runs after the other tools and their PATH entries, because T3 reads
// PATH only when it starts. The silent install starts T3, and T3's first start leaves its
// command-line shim, which is how the installer knows T3 has opened at least once.
//
// T3 is set up for the person rather than walked through: just before its installer runs, two
// files go in T3's data folder, which T3 reads only as it starts. client-settings.json marks its
// first-run wizard done, and settings.json sets what the profile's `t3` says (Codex off; new
// threads on Claude, with its model and effort). Either file already there is left as it is.
//
// A T3 already on the laptop, on either channel and at any build, is left exactly as it is: no
// download, no update and no switch of channel (T3 updates itself), and the channel isn't asked.
// Its settings aren't touched.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { keepTrying, system32 } from './machine.js';
import { loadManifest, toolEntry } from './manifest.js';
import { messageOf } from './stop.js';
import { checkSha512, findRelease } from './t3-release.js';
import { change, exists, NotInstalled, obtain } from './tools.js';
import * as ui from './ui.js';

/**
 * @typedef {object} T3Result
 * @property {string} row The checklist's T3 Code line.
 * @property {boolean} installed Whether T3 is in place.
 * @property {boolean} opened Whether T3 has started at least once (its shim is there).
 * @property {string} [shim] T3's command-line shim, which it writes when it starts.
 */

/**
 * A T3 already installed: the version Windows records for it, if any, and its channel.
 * @typedef {{ version?: string, channel: 'stable' | 'nightly' }} FoundT3
 */

/**
 * Looks for a T3 already installed: Windows' record of its version, or either channel's program
 * in its folder. The channel is the one whose tags the version matches (a nightly's version
 * names it), or else the one whose program is there, or else stable.
 * @param {import('./tools.js').Context} context
 * @returns {Promise<FoundT3 | undefined>}
 */
export async function findT3({ places, machine, downloads, log }) {
  const entry = toolEntry(await loadManifest(downloads), 't3');
  if (!entry) return undefined;
  const version = await installedVersion(machine, entry.install.versionIn);
  /** @type {('stable' | 'nightly')[]} */
  const channels = ['stable', 'nightly'];
  /** @type {('stable' | 'nightly')[]} */
  const programsThere = [];
  for (const channel of channels) {
    const where = entry.channels[channel];
    if (where && (await exists(join(places.programs, entry.install.folder, where.program)))) programsThere.push(channel);
  }
  if (!version && programsThere.length === 0) {
    log.write(`${entry.name}: not installed yet`);
    return undefined;
  }
  const byVersion = channels.find((channel) => {
    const tag = entry.channels[channel]?.tag;
    return version !== undefined && tag !== undefined && new RegExp(tag).test(`v${version}`);
  });
  const channel = byVersion ?? (programsThere.length === 1 ? programsThere[0] : 'stable');
  log.write(`${entry.name}: already installed (${version ?? "Windows doesn't record its version"}; ${channel}; program for ${programsThere.join(' and ') || 'neither channel'} there), so it's left as it is`);
  return { version, channel };
}

/**
 * @param {import('./profile.js').Profile} profile Its `t3` says how a T3 installed now is set up.
 * @param {'stable' | 'nightly'} channel
 * @param {FoundT3 | undefined} found A T3 already installed, which is left as it is.
 * @param {import('./tools.js').Context} context
 * @returns {Promise<T3Result>}
 */
export async function installT3(profile, channel, found, context) {
  const { places, machine, downloads, keepDownloads, log, attended } = context;
  const entry = toolEntry(await loadManifest(downloads), 't3');
  if (!entry) return { row: 'Not installed: the list of versions has no entry for it', installed: false, opened: false };
  const say = (/** @type {string} */ line) => log.write(`${entry.name}: ${line}`);
  const shim = join(places.home, entry.install.firstLaunchLeaves);

  if (found) {
    ui.step(`Checking ${entry.name}`);
    say(`${found.version ?? 'a version Windows doesn\'t record'} (${found.channel}) is already installed, so it was left as it is`);
    // An install that was already there may never have been opened.
    const opened = await waitForFirstLaunch(shim, 0, { machine, attended, say, name: entry.name });
    const state = [found.channel, 'already installed, left as it is', ...(opened ? [] : ['not opened yet'])].join(', ');
    return { row: `${found.version ?? 'Version unknown'} (${state})`, installed: true, opened, shim };
  }

  /** @returns {Promise<{ release: { version: string, url: string, sha512: string } } | { reason: string }>} */
  const install = async () => {
    try {
      const where = entry.channels[channel];
      if (!where) throw new NotInstalled(`the list of versions has no ${channel} channel`);
      const release = await findRelease(entry, where, { downloads, say });
      say(`${channel} is ${release.version}, ${basename(new URL(release.url).pathname)}`);

      const program = join(places.programs, entry.install.folder, where.program);
      const file = await obtain({ url: release.url }, { downloads, saveIn: join(places.state, 'downloads'), say });
      try {
        await checkSha512(file, release.sha512, say);
        // The install starts T3, which reads its settings only as it starts.
        await setUpT3(profile, places.t3UserData, say);
        const ran = await machine.run(file, entry.install.arguments);
        if (ran.code !== 0) throw new NotInstalled(`its installer stopped with code ${ran.code}`);
      } finally {
        if (keepDownloads) say(`kept ${file}`);
        else await rm(file, { force: true });
      }
      if (!(await exists(program))) {
        say(`${program} isn't there after the install`);
        throw new NotInstalled("its installer didn't leave it in place");
      }
      say(`installed ${release.version}`);
      return { release };
    } catch (error) {
      if (!(error instanceof NotInstalled)) say(`failed: ${error instanceof Error ? error.stack : String(error)}`);
      const reason = error instanceof NotInstalled ? error.message : messageOf(error);
      say(`not installed: ${reason}`);
      return { reason };
    }
  };
  // The download and the silent install show nothing of their own for about half a minute.
  const outcome = await ui.busy(`Installing ${entry.name}. This takes about a minute, and ${entry.name} opens by itself when it's done.`, install, (outcome) =>
    'release' in outcome
      ? { text: `${entry.name} ${outcome.release.version} installed`, ok: true }
      : { text: `${entry.name} not installed: ${outcome.reason}`, ok: false },
  );
  if (!('release' in outcome)) return { row: `Not installed: ${outcome.reason}`, installed: false, opened: await exists(shim), shim };
  const { release } = outcome;

  // The silent install starts T3 (--force-run).
  const opened = await waitForFirstLaunch(shim, machine.patience, { machine, attended, say, name: entry.name });
  const state = [channel, change.installed, ...(opened ? [] : ['not opened yet'])].join(', ');
  return { row: `${release.version} (${state})`, installed: true, opened, shim };
}

/**
 * Writes T3's settings for a T3 about to be installed, before it first starts: its first-run
 * wizard marked done, and what the profile's `t3` says. A file that's already there is left as it
 * is. Each written is read back and parsed, since T3 ignores one it can't parse. A file that
 * can't be written is logged, and the install goes ahead: T3 then starts with its own defaults.
 * @param {import('./profile.js').Profile} profile @param {string} folder T3's data folder
 * @param {(line: string) => void} say
 */
async function setUpT3(profile, folder, say) {
  const { defaultModel, effort, codex } = profile.t3 ?? {};
  /** @type {Record<string, unknown>} */
  const settings = {};
  if (codex === false) settings.providerInstances = { codex: { driver: 'codex', enabled: false } };
  if (defaultModel) {
    settings.defaultModelSelection = { instanceId: 'claudeAgent', model: defaultModel, options: effort ? [{ id: 'effort', value: effort }] : [] };
  }
  /** @type {[string, Record<string, unknown>][]} */
  const files = [['client-settings.json', { onboardingCompletedAt: new Date().toISOString() }]];
  if (Object.keys(settings).length > 0) files.push(['settings.json', settings]);
  for (const [name, contents] of files) {
    const file = join(folder, name);
    if (await exists(file)) {
      say(`${file} is already there, so it's left as it is`);
      continue;
    }
    try {
      await mkdir(folder, { recursive: true });
      await writeFile(file, `${JSON.stringify(contents, null, 2)}\n`, { flag: 'wx' });
      JSON.parse(await readFile(file, 'utf8'));
      say(`wrote ${file}: ${JSON.stringify(contents)}`);
    } catch (error) {
      say(`couldn't write ${file}: ${messageOf(error)}`);
    }
  }
}

/**
 * The version Windows records for T3's per-user install, read with reg.exe (CLM-safe).
 * @param {import('./machine.js').Machine} machine @param {string} key
 * @returns {Promise<string | undefined>}
 */
async function installedVersion(machine, key) {
  const reg = system32('reg.exe');
  const { code, output } = await machine.run(reg, ['query', key, '/v', 'DisplayVersion']);
  if (code !== 0) return undefined;
  return /^\s+DisplayVersion\s+REG_SZ\s+(\S+)/im.exec(output)?.[1];
}

/**
 * Waits for T3's first start to leave its shim. If it doesn't come, the person (when there is
 * one) is asked to open T3 from the Start menu.
 * @param {string} shim @param {number} patience
 * @param {{ machine: import('./machine.js').Machine, attended: boolean, say: (line: string) => void, name: string }} how
 */
async function waitForFirstLaunch(shim, patience, { machine, attended, say, name }) {
  const wait = () => keepTrying({ machine, every: 1000, patience }, () => exists(shim), (there) => there);
  if (patience > 0 && !(await exists(shim))) await ui.busy(`Waiting for ${name} to open`, wait, ({ result }) => ({ text: result ? `${name} is open` : `${name} hasn't opened`, ok: result }));
  if (!(await exists(shim)) && attended) {
    ui.notice(`Open ${name} from the Start menu and wait for its window to appear.`, `Open ${name}`);
    await ui.pressEnter(`Press Enter once ${name} is open.`);
  }
  const opened = await exists(shim);
  say(opened ? `first launch seen (${shim})` : `hasn't been opened yet (no ${shim})`);
  return opened;
}
