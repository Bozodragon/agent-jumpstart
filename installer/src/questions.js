// The four questions, built from the profile. Each has a default, so pressing
// Enter (or leaving it out of an answers file) gives a sensible setup.
import { isAbsolute, join } from 'node:path';
import { findGoogleDrive, isFolder } from './google-drive.js';
import { Stop } from './stop.js';

/**
 * What the person chose. These are the settings file's keys, which Jumpstart
 * and a re-run read, and the keys an answers file uses.
 * @typedef {object} Answers
 * @property {string | null} googleDriveFolder The confirmed My Drive folder, or null when the profile doesn't use Drive.
 * @property {string} workspacesLocation The folder the top workspace goes in.
 * @property {'stable' | 'nightly'} channel Which T3 Code.
 * @property {boolean} github Whether to set up GitHub now.
 * @property {string[]} workspaces The names of the ticked workspaces.
 * @property {string[]} connectors The names of the ticked connectors.
 * @property {string[]} extraTools The ids of the ticked extra tools.
 */

/**
 * @template T
 * @typedef {{ value: T, label: string, hint?: string }} Option
 */

/**
 * Something that answers questions: the person at the screen, or an answers
 * file. `key` names the answer in an answers file.
 * @typedef {object} Asker
 * @property {(q: { key: string, message: string, initial: string | undefined, placeholder: string, validate: (value: string) => Promise<string | undefined> }) => Promise<string>} folder
 * @property {<T extends string>(q: { key: string, message: string, options: Option<T>[], initial: T }) => Promise<T>} choose
 * @property {(q: { key: string, message: string, initial: boolean }) => Promise<boolean>} confirm
 * @property {<T extends string>(q: { key: string, message: string, options: Option<T>[], initial: T[] }) => Promise<T[]>} pick
 */

/** @param {{ name: string, default: boolean }[]} choices */
const optionsOf = (choices) => choices.map(({ name }) => ({ value: name, label: name }));

/** @param {{ name: string, default: boolean }[]} choices */
const tickedOf = (choices) => choices.filter((choice) => choice.default).map(({ name }) => name);

/** @param {string} value */
async function mustBeAFolder(value) {
  if (!isAbsolute(value)) return 'Give the whole path, starting with the drive letter.';
  if (!(await isFolder(value))) return `There is no folder at ${value}.`;
  return undefined;
}

/** @param {string} value */
async function mustBeAPath(value) {
  return isAbsolute(value) ? undefined : 'Give the whole path, starting with the drive letter.';
}

/**
 * Under a profile that keeps workspaces in Google Drive, stops before asking
 * anything if Drive for desktop isn't there or isn't signed in.
 * @param {import('./profile.js').Profile} profile
 * @param {import('./places.js').Places} places
 * @param {Asker} ask
 * @param {{ write(line: string): void }} log
 * @returns {Promise<Answers>}
 */
export async function askQuestions(profile, places, ask, log) {
  let googleDriveFolder = null;
  let workspacesLocation;
  if (profile.workspaces.inGoogleDrive) {
    const drive = await findGoogleDrive(places);
    log.write(`Google Drive for desktop: ${drive.status}${drive.status === 'signed-in' ? `, My Drive ${drive.folder ?? 'not found'}` : ''}`);
    if (drive.status === 'not-installed') {
      throw new Stop(
        "Your workspaces live in Google Drive, so Google Drive for desktop is needed first, and it isn't on this laptop (or hasn't been opened yet). Install it, sign in, then paste the same line again. Nothing has been changed.",
      );
    }
    if (drive.status === 'signed-out') {
      throw new Stop(
        'Google Drive for desktop is installed but not signed in. Open it from the Start menu, sign in with your work Google account, then paste the same line again. Nothing has been changed.',
      );
    }
    googleDriveFolder = await ask.folder({
      key: 'googleDriveFolder',
      message: drive.folder
        ? 'Is this your Google Drive folder? Press Enter if so, or type the right one.'
        : "Where is your Google Drive folder? It's usually a drive letter followed by My Drive.",
      initial: drive.folder,
      placeholder: 'G:\\My Drive',
      validate: mustBeAFolder,
    });
    workspacesLocation = googleDriveFolder;
  } else {
    workspacesLocation = await ask.folder({
      key: 'workspacesLocation',
      message: 'Where should your workspaces live? Press Enter for this folder, or type another.',
      initial: join(places.home, profile.workspaces.defaultLocation ?? ''),
      placeholder: join(places.home, 'Documents'),
      validate: mustBeAPath,
    });
  }

  const channel = await ask.choose({
    key: 'channel',
    message: 'Which T3 Code?',
    options: /** @type {Option<'stable' | 'nightly'>[]} */ ([
      { value: 'stable', label: 'Stable', hint: 'recommended' },
      { value: 'nightly', label: 'Nightly', hint: 'the newest build, which can need troubleshooting' },
    ]),
    initial: 'stable',
  });

  const github = await ask.confirm({ key: 'github', message: 'Set up GitHub now? You can do it later.', initial: false });

  const workspaces = await ask.pick({
    key: 'workspaces',
    message: 'Which workspaces?',
    options: optionsOf(profile.workspaces.choices),
    initial: tickedOf(profile.workspaces.choices),
  });
  const connectors = await ask.pick({
    key: 'connectors',
    message: 'Which connectors?',
    options: optionsOf(profile.connectors),
    initial: tickedOf(profile.connectors),
  });
  const extraTools = await ask.pick({
    key: 'extraTools',
    message: 'Anything extra?',
    options: profile.extraTools.map(({ id, question }) => ({ value: id, label: question })),
    initial: profile.extraTools.filter((tool) => tool.default).map(({ id }) => id),
  });

  /** @type {Answers} */
  const answers = { googleDriveFolder, workspacesLocation, channel, github, workspaces, connectors, extraTools };
  for (const [key, value] of Object.entries(answers)) log.write(`Answer: ${key}: ${JSON.stringify(value)}`);
  return answers;
}

/**
 * Answers from an answers file: a JSON object keyed as {@link Answers}. A
 * missing answer takes the default, as Enter would; a wrong one stops the run.
 * @param {Record<string, unknown>} file
 * @returns {Asker}
 */
export function answersFrom(file) {
  /** @param {string} key @param {string} problem */
  const wrong = (key, problem) => new Stop(`The answers file's "${key}" is wrong: ${problem}`);
  /** @param {Option<string>[]} options */
  const listOf = (options) => options.map(({ value }) => `"${value}"`).join(', ');

  return {
    async folder({ key, initial, validate }) {
      const value = file[key] ?? initial;
      if (value === undefined) throw wrong(key, 'it is needed, because no folder was found to offer as the default.');
      if (typeof value !== 'string') throw wrong(key, 'it should be a path.');
      const problem = await validate(value);
      if (problem) throw wrong(key, problem);
      return value;
    },
    async choose({ key, options, initial }) {
      const value = file[key] ?? initial;
      const option = options.find((candidate) => candidate.value === value);
      if (!option) throw wrong(key, `it should be one of ${listOf(options)}.`);
      return option.value;
    },
    async confirm({ key, initial }) {
      const value = file[key] ?? initial;
      if (typeof value !== 'boolean') throw wrong(key, 'it should be true or false.');
      return value;
    },
    async pick({ key, options, initial }) {
      const values = file[key] ?? initial;
      if (!Array.isArray(values)) throw wrong(key, `it should be a list drawn from ${listOf(options)}.`);
      return values.map((value) => {
        const option = options.find((candidate) => candidate.value === value);
        if (!option) throw wrong(key, `${JSON.stringify(value)} isn't one of ${listOf(options)}.`);
        return option.value;
      });
    },
  };
}
