// Claude's automatic memory, switched off for the person, so the only record of them is in
// files they can open and read. Two switches, because either alone can be undone:
//   - `autoMemoryEnabled: false` in their Claude settings (what `/memory` toggles), merged so
//     the settings they already had survive;
//   - CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 in their user environment. It must be 1: set to 0 the
//     variable forces memory back on, whatever the settings say.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { messageOf } from './stop.js';

const variable = 'CLAUDE_CODE_DISABLE_AUTO_MEMORY';

/**
 * @param {{ places: import('./places.js').Places, machine: import('./machine.js').Machine, log: { write(line: string): void } }} context
 * @returns {Promise<string>} The checklist's Memory line.
 */
export async function switchOffAutoMemory({ places, machine, log }) {
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

  if (problems.length === 0) return "Claude's automatic memory is off";
  return `${problems.length === 2 ? 'Not switched off' : 'Partly off'}: ${problems.join(', and ')}`;
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
