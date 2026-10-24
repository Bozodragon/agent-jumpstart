import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { messageOf, Stop } from './stop.js';

const pinned = fileURLToPath(new URL('../../manifest.json', import.meta.url));

/**
 * The versions the installer installs, pinned in `manifest.json` at the repo root.
 * Bumping a tool is an edit there.
 * @typedef {object} Tool
 * @property {string} id
 * @property {string} name What the checklist calls it.
 * @property {string} version As the tool's own `--version` prints it.
 * @property {Partial<Record<string, Download>>} downloads By processor (`x64`, `arm64`).
 * @property {Install} install
 */

/** @typedef {{ url: string, sha256: string }} Download */

/**
 * The skills CLI, run with npx at this version.
 * @typedef {{ package: string, version: string }} SkillsCli
 */

/**
 * @typedef {object} Install
 * @property {'zip' | 'installer'} how A zip is unpacked into the folder (dropping a single top
 *   folder if it has one); an installer is run with `arguments`.
 * @property {string} folder Under `%LOCALAPPDATA%\Programs`.
 * @property {string[]} path Folders inside it to put on the user PATH.
 * @property {string} check The program inside it to run with `--version`.
 * @property {string[]} [arguments] For an installer; `{folder}` is replaced with the folder.
 */

/**
 * A test (or an offline run) can put its own `manifest.json` in the downloads folder,
 * so its stand-in files can pass the checksum check.
 * @param {string | undefined} downloads
 * @returns {Promise<{ tools: Tool[], skillsCli: SkillsCli, source: string }>}
 */
export async function loadManifest(downloads) {
  for (const source of downloads ? [join(downloads, 'manifest.json'), pinned] : [pinned]) {
    let text;
    try {
      text = await readFile(source, 'utf8');
    } catch (error) {
      if (source !== pinned && /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') continue;
      throw new Stop(`The list of versions to install (${source}) couldn't be read: ${messageOf(error)}`);
    }
    let manifest;
    try {
      manifest = JSON.parse(text);
    } catch (error) {
      throw new Stop(`The list of versions to install (${source}) isn't valid: ${messageOf(error)}`);
    }
    if (!Array.isArray(manifest.tools)) throw new Stop(`The list of versions to install (${source}) has no tools.`);
    const { skillsCli } = manifest;
    if (typeof skillsCli?.package !== 'string' || typeof skillsCli?.version !== 'string') {
      throw new Stop(`The list of versions to install (${source}) doesn't pin the skills CLI.`);
    }
    return { tools: manifest.tools, skillsCli, source };
  }
  throw new Error('unreachable');
}
