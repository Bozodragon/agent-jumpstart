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
 * @property {string} [when] Set aside from the main run of installs: installed only by the
 *   step this names (for an extra tool in the profile, its id, when ticked; `"skills"` for the
 *   skills CLI, installed by `skills.js` when the profile has skills; `"t3"` for T3 Code and
 *   Claude Code, installed after the other tools and their PATH entries by `t3.js` and
 *   `claude.js`, whose entries keep `id` and `name` but otherwise have their own shape).
 * @property {SignIn} [signIn] For a tool the person signs in to in the browser.
 */

/** @typedef {{ url: string, sha256: string }} Download */

/**
 * @typedef {object} SignIn
 * @property {string[]} run The tool's arguments that start its browser sign-in and wait for it.
 * @property {string[]} check The tool's arguments that report who is signed in.
 * @property {string} signedInAs A pattern `check`'s output matches when someone is signed
 *   in; its first group is the account.
 */

/**
 * @typedef {object} Install
 * @property {'zip' | 'installer' | 'npm'} how A zip is unpacked into the folder (dropping a
 *   single top folder if it has one); an installer is run with `arguments`; an npm package
 *   (the downloaded .tgz) is installed globally with the folder as npm's prefix.
 * @property {string} folder Under `%LOCALAPPDATA%\Programs`.
 * @property {string[]} path Folders inside it to put on the user PATH.
 * @property {string} check The program inside it to run with `--version`.
 * @property {string[]} [arguments] For an installer; `{folder}` is replaced with the folder.
 */

/**
 * T3's entry in the manifest.
 * @typedef {object} T3Entry
 * @property {string} id
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
 * Claude Code's entry in the manifest. `folder` is relative to the home.
 * @typedef {{ id: string, name: string, install: { folder: string, check: string } }} ClaudeEntry
 */

/**
 * The tools the spec makes fixed steps of every run, rather than entries in a profile's lists:
 * the only manifest ids the code names, each with the shape of its entry. Every other tool is
 * reached through the manifest's order or a profile's extra tools, never by id.
 * @typedef {{ claude: ClaudeEntry, t3: T3Entry, gh: Tool, skills: Tool }} FixedTools
 */

/** The host the GitHub step signs in to, with the `gh` entry. */
export const githubHost = 'github.com';

/**
 * One of the fixed steps' entries, if the manifest has it.
 * @template {keyof FixedTools} K
 * @param {{ tools: Tool[] }} manifest @param {K} id
 * @returns {FixedTools[K] | undefined}
 */
export function toolEntry(manifest, id) {
  // Each fixed entry has its own shape, documented above; the manifest's JSON isn't checked against it.
  return /** @type {FixedTools[K] | undefined} */ (/** @type {unknown} */ (manifest.tools.find((tool) => tool.id === id)));
}

/**
 * A test (or an offline run) can put its own `manifest.json` in the downloads folder,
 * so its stand-in files can pass the checksum check.
 * @param {string | undefined} downloads
 * @returns {Promise<{ tools: Tool[], source: string }>}
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
    return { tools: manifest.tools, source };
  }
  throw new Error('unreachable');
}
