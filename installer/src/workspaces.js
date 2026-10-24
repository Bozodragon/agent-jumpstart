// The person's workspaces: the top workspace folder in the confirmed location (the profile
// names it), each ticked workspace inside it, and the top workspace added to T3 Code as a
// project. All of it is safe to do again: a folder that's already there is left exactly as it
// is, and T3 itself refuses to add a folder it already lists, which is taken as done.
import { mkdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { messageOf } from './stop.js';

/**
 * @typedef {object} Workspaces
 * @property {string} top The top workspace's full path.
 * @property {boolean} topReady Whether the top workspace folder is there (created now or before).
 * @property {string} [notCreated] Why the top workspace folder isn't there, for the checklist.
 * @property {[string, string][]} rows Each workspace's folder name and path, the top one first,
 *   for the summary of workspaces.
 */

/**
 * Where the top workspace goes: the profile's folder name in the confirmed location.
 * @param {import('./profile.js').Profile} profile @param {string} workspacesLocation
 */
export function topWorkspaceIn(profile, workspacesLocation) {
  return join(workspacesLocation, profile.workspaces.top);
}

/**
 * @param {string} top @param {string[]} chosen the ticked workspaces' names
 * @param {import('./log.js').Log} log
 * @returns {Promise<Workspaces>}
 */
export async function createWorkspaces(top, chosen, log) {
  const made = await makeFolder(top, log);
  /** @type {[string, string][]} */
  const rows = [[basename(top), made.row]];
  if (!made.ready) return { top, topReady: false, notCreated: made.row, rows };
  for (const name of chosen) rows.push([name, (await makeFolder(join(top, name), log)).row]);
  return { top, topReady: true, rows };
}

/**
 * Adds the top workspace to T3 Code's project list with T3's own command-line shim, which T3
 * writes when it first starts, so it's done only once T3 has opened. The shim works whether T3
 * is open or closed. T3 refuses a folder it already lists, which is taken as done, so a re-run
 * leaves the project as it is.
 * @param {Workspaces} workspaces @param {import('./t3.js').T3Result} t3
 * @param {{ machine: import('./machine.js').Machine, log: import('./log.js').Log }} context
 * @returns {Promise<string>} the checklist's Workspaces line
 */
export async function addToT3(workspaces, t3, { machine, log }) {
  const { top, topReady, notCreated } = workspaces;
  if (!topReady) return notCreated ?? 'Not created';
  const name = basename(top);
  const say = (/** @type {string} */ line) => log.write(`T3 Code project: ${line}`);
  if (!t3.installed) {
    say(`${top} not added: T3 Code isn't installed`);
    return `${name}, not in T3 Code: it isn't installed`;
  }
  if (!t3.opened || !t3.shim) {
    say(`${top} not added: T3 Code hasn't been opened yet`);
    return `${name}, not in T3 Code yet: open T3 Code, then run this again`;
  }
  const ran = await machine.run(t3.shim, ['project', 'add', top, '--title', name]);
  if (ran.code === 0) {
    say(`added ${top}`);
    return `${name}, added to T3 Code`;
  }
  if (/already exists/i.test(ran.output)) {
    say(`${top} is already in T3 Code's list`);
    return `${name}, already in T3 Code`;
  }
  say(`${top} not added: code ${ran.code}: ${ran.output.trim()}`);
  return `${name}, not in T3 Code: T3 Code wouldn't add it`;
}

/**
 * Creates a folder unless it's already there. One that's there is never opened, emptied or replaced.
 * @param {string} folder @param {import('./log.js').Log} log
 * @returns {Promise<{ ready: boolean, row: string }>}
 */
async function makeFolder(folder, log) {
  const found = await stat(folder).catch(() => undefined);
  if (found?.isDirectory()) {
    log.write(`Workspace already there: ${folder}`);
    return { ready: true, row: `${folder}, already there` };
  }
  if (found) {
    log.write(`Workspace not created: ${folder} is a file`);
    return { ready: false, row: `Not created: a file called ${basename(folder)} is in the way` };
  }
  try {
    await mkdir(folder, { recursive: true });
  } catch (error) {
    log.write(`Workspace not created: ${folder}: ${messageOf(error)}`);
    return { ready: false, row: "Not created: Windows wouldn't let it be made" };
  }
  log.write(`Workspace created: ${folder}`);
  return { ready: true, row: folder };
}
