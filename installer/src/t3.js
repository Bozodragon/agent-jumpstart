// Installs T3 Code per user on the channel the person chose. Unlike the other tools, T3 isn't
// pinned: `t3-release.js` finds the channel's current build in T3's own release feed and checks
// the download against the hash T3 published. Stable and nightly replace each other and share
// one settings folder. It runs after the other tools and their PATH entries, because T3 reads
// PATH only when it starts. The silent install starts T3, and T3's first start leaves its
// command-line shim, which is how the installer knows T3 has opened at least once.
import { rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { system32 } from './machine.js';
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
 * @param {'stable' | 'nightly'} channel
 * @param {import('./tools.js').Context} context
 * @returns {Promise<T3Result>}
 */
export async function installT3(channel, context) {
  const { places, machine, downloads, keepDownloads, log, attended } = context;
  const entry = toolEntry(await loadManifest(downloads), 't3');
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
    return { row: `Not installed: ${reason}`, installed: false, opened: await exists(shim), shim };
  }

  // The silent install starts T3 (--force-run); an install that was already there may never have been opened.
  const opened = await waitForFirstLaunch(shim, already ? 0 : machine.patience, { attended, say, name: entry.name });
  const state = [channel, changed, ...(opened ? [] : ['not opened yet'])].join(', ');
  return { row: `${release.version} (${state})`, installed: true, opened, shim };
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
