// Claude's automatic memory, switched off for the person, so the only record of them is in
// files they can open and read. Two switches, because either alone can be undone:
//   - `autoMemoryEnabled: false` in their Claude settings (what `/memory` toggles), merged so
//     the settings they already had survive;
//   - CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 in their user environment. It must be 1: set to 0 the
//     variable forces memory back on, whatever the settings say.
// Someone who has been using it is asked first (see questions.js), and by default it's left on:
// then neither switch is touched.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { messageOf } from './stop.js';

const variable = 'CLAUDE_CODE_DISABLE_AUTO_MEMORY';

/**
 * @typedef {object} MemoryContext
 * @property {import('./places.js').Places} places
 * @property {import('./machine.js').Machine} machine
 * @property {{ write(line: string): void }} log
 */

/**
 * Whether the person has been using Claude's automatic memory on this laptop: their Claude
 * settings switch it on, its Windows variable is set to anything but 1, or Claude has written
 * memory files for a project (`<claudeConfig>\projects\*\memory\`).
 * @param {MemoryContext} context
 * @returns {Promise<boolean>}
 */
export async function autoMemoryInUse({ places, machine, log }) {
  const say = (/** @type {string} */ line) => log.write(`Automatic memory: ${line}`);
  const file = join(places.claudeConfig, 'settings.json');
  try {
    if ((await readSettings(file)).autoMemoryEnabled === true) {
      say(`in use: autoMemoryEnabled is true in ${file}`);
      return true;
    }
  } catch (error) {
    say(`${file} couldn't be read (${messageOf(error)}), so it isn't taken as a sign either way`);
  }
  const value = await machine.userVariable(variable).catch(() => undefined);
  if (value !== undefined && value !== '1') {
    say(`in use: ${variable} is ${JSON.stringify(value)}`);
    return true;
  }
  const projects = join(places.claudeConfig, 'projects');
  for (const project of await readdir(projects).catch(() => [])) {
    const memory = join(projects, project, 'memory');
    if ((await readdir(memory).catch(() => [])).length > 0) {
      say(`in use: ${memory} has files`);
      return true;
    }
  }
  say('no sign it has been used');
  return false;
}

/**
 * @param {boolean} wanted Whether to switch it off (always, unless the person was asked and said No).
 * @param {MemoryContext} context
 * @returns {Promise<{ row: string, autoMemory: 'off' | 'left on' }>} The checklist's Memory line,
 *   and what the settings file records for Jumpstart.
 */
export async function switchOffAutoMemory(wanted, { places, machine, log }) {
  if (!wanted) {
    log.write('Automatic memory: left on, as the person chose; neither switch was touched');
    return { row: 'Left on, as you had it', autoMemory: 'left on' };
  }
  const problems = [];

  const file = join(places.claudeConfig, 'settings.json');
  try {
    const settings = await readSettings(file);
    await mkdir(places.claudeConfig, { recursive: true });
    await writeFile(file, `${JSON.stringify({ ...settings, autoMemoryEnabled: false }, null, 2)}\n`);
    log.write(`Automatic memory: autoMemoryEnabled set to false in ${file}`);
  } catch (error) {
    log.write(`Automatic memory: ${file} left as it was: ${messageOf(error)}`);
    problems.push("Claude's settings file couldn't be read");
  }

  try {
    await machine.setUserVariable(variable, '1');
    log.write(`Automatic memory: ${variable} set to 1 for the user`);
  } catch (error) {
    log.write(`Automatic memory: ${variable} not set: ${messageOf(error)}`);
    problems.push("its Windows environment setting couldn't be saved");
  }

  if (problems.length === 0) return { row: "Claude's automatic memory is off", autoMemory: 'off' };
  if (problems.length === 2) return { row: `Not switched off: ${problems.join(', and ')}`, autoMemory: 'left on' };
  return { row: `Partly off: ${problems.join(', and ')}`, autoMemory: 'off' };
}

/**
 * The settings already there, or none. Anything that isn't a JSON object stops the change, so a
 * file the person (or Claude) wrote is never overwritten with less than it held.
 * @param {string} file
 * @returns {Promise<Record<string, unknown>>}
 */
async function readSettings(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return {};
    throw error;
  }
  if (text.trim() === '') return {};
  const settings = JSON.parse(text.replace(/^﻿/, ''));
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('it is not a JSON object');
  return settings;
}
