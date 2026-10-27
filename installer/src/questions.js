// The questions, built from the profile and what is already on the laptop. Each has a default,
// so pressing Enter (or leaving it out of an answers file) gives a sensible setup.
import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { findGoogleDrive, isFolder } from './google-drive.js';
import { Stop } from './stop.js';
import { existingTopWorkspaces, topWorkspaceIn } from './workspaces.js';

/**
 * What the person chose. These are the settings file's keys, which Jumpstart
 * and a re-run read, and the keys an answers file uses.
 * @typedef {object} Answers
 * @property {string | null} googleDriveFolder The confirmed My Drive folder, or null when the profile doesn't use Drive.
 * @property {string} workspacesLocation The folder the top workspace is in.
 * @property {string} topWorkspace The top workspace: a new one, named by the profile, in Google
 *   Drive or the folder the person gave; or one already in T3 Code, or another folder of their
 *   own, that they chose to use, under whatever name it has. Jumpstart reads it.
 * @property {'stable' | 'nightly'} channel Which T3 Code.
 * @property {boolean} github Whether to set up GitHub now.
 * @property {string[]} workspaces The names of the ticked workspaces.
 * @property {string[]} connectors The names of the ticked connectors.
 * @property {string[]} extraTools The ids of the ticked extra tools.
 * @property {boolean} switchOffMemory Whether to switch off Claude's automatic memory. Asked only
 *   of someone who has been using it, with No as the default; otherwise true.
 */

/**
 * What the installer found before asking, which decides what is asked.
 * @typedef {object} Found
 * @property {Record<string, unknown>} [earlier] The settings file an earlier run wrote, if any.
 * @property {boolean} memoryInUse Whether the person has been using Claude's automatic memory.
 * @property {'stable' | 'nightly'} [t3Channel] The channel of a T3 Code already installed, which
 *   is left as it is, so the channel isn't asked.
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
 * @property {<T extends string>(q: { key: string, message: string, options: Option<T>[], initial: T, other?: T }) => Promise<T>} choose
 *   `other`, if given, is the option whose answer a follow-up `folder` question with the same key
 *   asks for; an answers file gives that folder's whole path in place of the option.
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

/** @param {string} value */
async function mustBeAFolderOrMakeable(value) {
  if (!isAbsolute(value)) return 'Give the whole path, starting with the drive letter.';
  const found = await stat(value).catch(() => undefined);
  if (found?.isDirectory()) return undefined;
  if (found) return `${value} is a file, not a folder.`;
  if (!(await isFolder(dirname(value)))) return `There is no folder at ${dirname(value)} to make it in.`;
  return undefined;
}

/** The `topWorkspace` answer that sets up a new top workspace, where the profile says. */
const newTopWorkspace = 'new';
/** The `topWorkspace` answer that uses a folder the person names. An answers file gives the folder's path instead. */
const anotherFolder = 'another';

/**
 * Under a profile that keeps workspaces in Google Drive, stops if Drive for desktop isn't there
 * or isn't signed in, but only once the person has chosen to make a new top workspace.
 * @param {import('./profile.js').Profile} profile
 * @param {import('./places.js').Places} places
 * @param {Asker} ask
 * @param {{ write(line: string): void }} log
 * @param {Found} found
 * @returns {Promise<Answers>}
 */
export async function askQuestions(profile, places, ask, log, found) {
  return theRest(profile, ask, log, found, await whereWorkspacesLive(profile, places, ask, log, found));
}

/**
 * On a re-run, an earlier run's top workspace that's still there.
 * @param {Record<string, unknown> | undefined} earlier
 * @param {{ write(line: string): void }} log
 */
async function earlierTopWorkspace(earlier, log) {
  const top = earlier?.topWorkspace;
  if (typeof top !== 'string' || !isAbsolute(top)) return undefined;
  if (await isFolder(top)) return top;
  log.write(`Settings: topWorkspace ${top} is no longer there, so where the top workspace is is asked again`);
  return undefined;
}

/** @typedef {Pick<Answers, 'googleDriveFolder' | 'workspacesLocation' | 'topWorkspace'>} Location */

/**
 * Where the top workspace is: an earlier run's, if it's still there. Otherwise the person is
 * asked, and chooses one already in T3 Code, a new one where the profile says (in Google Drive
 * or the folder they give), or another folder of their own. Only a new one in Google Drive
 * needs Drive for desktop; the others are used wherever they are.
 * @param {import('./profile.js').Profile} profile @param {import('./places.js').Places} places
 * @param {Asker} ask @param {{ write(line: string): void }} log @param {Found} found
 * @returns {Promise<Location>}
 */
async function whereWorkspacesLive(profile, places, ask, log, found) {
  /** @param {string} top @returns {Location} */
  const using = (top) => ({
    googleDriveFolder: typeof found.earlier?.googleDriveFolder === 'string' && top === found.earlier.topWorkspace ? found.earlier.googleDriveFolder : null,
    workspacesLocation: dirname(top),
    topWorkspace: top,
  });
  const earlier = await earlierTopWorkspace(found.earlier, log);
  if (earlier) {
    log.write(`Known from settings: topWorkspace: ${JSON.stringify(earlier)}`);
    return using(earlier);
  }
  // Only looked at here, to say where a new one would go; whether it stops the run waits for the answer.
  const drive = profile.workspaces.inGoogleDrive ? await findGoogleDrive(places) : undefined;
  if (drive) log.write(`Google Drive for desktop: ${drive.status}${drive.status === 'signed-in' ? `, My Drive ${drive.folder ?? 'not found'}` : ''}`);
  // Settings from before this was asked: that run set up a new one where its answers say.
  const earlierLocation = drive ? 'googleDriveFolder' : 'workspacesLocation';
  if (found.earlier && !('topWorkspace' in found.earlier) && earlierLocation in found.earlier) {
    log.write(`Known from settings: topWorkspace: "${newTopWorkspace}" (an earlier run set one up where its ${earlierLocation} says)`);
    return newLocation(profile, places, ask, drive);
  }
  const existing = await existingTopWorkspaces(profile, places, log);
  const chosen = await ask.choose({
    key: 'topWorkspace',
    message: "Where's your top workspace? Your other workspaces go inside it.",
    options: [
      ...existing.map((folder) => ({ value: folder, label: `Use ${folder}`, hint: 'already in T3 Code' })),
      { value: newTopWorkspace, label: `Make a new one ${whereNewGoes(profile, places, drive)}` },
      { value: anotherFolder, label: 'Use another folder', hint: "you'll type where it is next" },
    ],
    initial: existing[0] ?? newTopWorkspace,
    other: anotherFolder,
  });
  if (chosen === newTopWorkspace) {
    log.write(`Answer: topWorkspace: "${newTopWorkspace}"`);
    return newLocation(profile, places, ask, drive);
  }
  if (chosen !== anotherFolder) {
    log.write(`Answer: topWorkspace: ${JSON.stringify(chosen)} (already there, so it's used as it is)`);
    return using(chosen);
  }
  const folder = await ask.folder({
    key: 'topWorkspace',
    message: "What's the folder's whole path? If it's already there, it's used as it is; if not, it's made.",
    initial: undefined,
    placeholder: join(places.home, 'Documents', profile.workspaces.top),
    validate: mustBeAFolderOrMakeable,
  });
  const there = await isFolder(folder);
  log.write(`Answer: topWorkspace: ${JSON.stringify(folder)} (${there ? "already there, so it's used as it is" : "not there yet, so it's made"})`);
  return { googleDriveFolder: null, workspacesLocation: dirname(folder), topWorkspace: folder };
}

/**
 * Where a new top workspace would go, for the option that makes one.
 * @param {import('./profile.js').Profile} profile @param {import('./places.js').Places} places
 * @param {import('./google-drive.js').GoogleDrive | undefined} drive what was found, under a Google Drive profile
 */
function whereNewGoes(profile, places, drive) {
  if (!drive) return `at ${topWorkspaceIn(profile, join(places.home, profile.workspaces.defaultLocation ?? ''))}`;
  if (drive.status === 'signed-in' && drive.folder) return `at ${topWorkspaceIn(profile, drive.folder)}`;
  return `called ${profile.workspaces.top} in your Google Drive`;
}

/**
 * The questions for a new top workspace: the Google Drive folder, or the folder workspaces live
 * in. Under a Google Drive profile, stops first if Drive for desktop isn't there or isn't signed in.
 * @param {import('./profile.js').Profile} profile @param {import('./places.js').Places} places
 * @param {Asker} ask
 * @param {import('./google-drive.js').GoogleDrive | undefined} drive what was found, under a Google Drive profile
 * @returns {Promise<Location>}
 */
async function newLocation(profile, places, ask, drive) {
  let googleDriveFolder = null;
  let workspacesLocation;
  if (drive) {
    if (drive.status === 'not-installed') {
      throw new Stop(
        "Your workspaces live in Google Drive, so Google Drive for desktop is needed first, and it isn't on this laptop (or hasn't been opened yet). Install it, sign in, then paste the same line again.",
      );
    }
    if (drive.status === 'signed-out') {
      throw new Stop(
        'Google Drive for desktop is installed but not signed in. Open it from the Start menu, sign in with your work Google account, then paste the same line again.',
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
  return { googleDriveFolder, workspacesLocation, topWorkspace: topWorkspaceIn(profile, workspacesLocation) };
}

/**
 * The rest of the questions.
 * @param {import('./profile.js').Profile} profile @param {Asker} ask
 * @param {{ write(line: string): void }} log @param {Found} found @param {Location} location
 * @returns {Promise<Answers>}
 */
async function theRest(profile, ask, log, found, { googleDriveFolder, workspacesLocation, topWorkspace }) {
  if (found.t3Channel) log.write(`T3 Code is already installed (${found.t3Channel}), so which T3 Code isn't asked`);
  /** @type {'stable' | 'nightly'} */
  const channel =
    found.t3Channel ??
    (await ask.choose({
      key: 'channel',
      message: 'Which T3 Code?',
      options: /** @type {Option<'stable' | 'nightly'>[]} */ ([
        { value: 'stable', label: 'Stable', hint: 'recommended' },
        { value: 'nightly', label: 'Nightly', hint: 'the newest build, which can need troubleshooting' },
      ]),
      initial: 'stable',
    }));

  const github = await ask.confirm({ key: 'github', message: "Set up GitHub now? A later run won't ask this again.", initial: false });

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

  // Someone who has been using it is asked, and keeps it unless they say otherwise. So is anyone
  // who answered before, so that answer is kept even once the signs of use have gone.
  const switchOffMemory =
    found.memoryInUse || (found.earlier !== undefined && 'switchOffMemory' in found.earlier)
      ? await ask.confirm({
          key: 'switchOffMemory',
          message: "Claude has been keeping its own memory on this laptop. Switch it off, so it only remembers what's in files you can read?",
          initial: false,
        })
      : true;

  /** @type {Answers} */
  const answers = { googleDriveFolder, workspacesLocation, topWorkspace, channel, github, workspaces, connectors, extraTools, switchOffMemory };
  for (const [key, value] of Object.entries(answers)) log.write(`Answer: ${key}: ${JSON.stringify(value)}`);
  return answers;
}

/**
 * On a re-run: answers from the settings file an earlier run wrote, so nothing already known is
 * asked again. Only an answer that's missing (a key added since), or no longer right (a folder
 * that's gone, a name the profile no longer offers), goes to `ask`, the person or the answers
 * file. The top workspace is the exception: askQuestions uses the settings' one itself while
 * it's there, so the question is put only when it's gone or was never written down, and the
 * settings never answer it.
 * @param {Record<string, unknown>} settings
 * @param {Asker} ask
 * @param {{ write(line: string): void }} log
 * @returns {Asker}
 */
export function knownFrom(settings, ask, log) {
  const { topWorkspace, ...answerable } = settings;
  const known = answersFrom(answerable);
  /**
   * @template T
   * @param {string} key @param {() => Promise<T>} fromSettings @param {() => Promise<T>} otherwise
   * @returns {Promise<T>}
   */
  const either = async (key, fromSettings, otherwise) => {
    if (key in answerable) {
      try {
        const value = await fromSettings();
        log.write(`Known from settings: ${key}: ${JSON.stringify(value)}`);
        return value;
      } catch (error) {
        if (!(error instanceof Stop)) throw error;
        log.write(`Settings: ${key} is no longer right (${JSON.stringify(settings[key])}), so it's asked again`);
      }
    }
    return otherwise();
  };
  return {
    folder: (q) => either(q.key, () => known.folder(q), () => ask.folder(q)),
    choose: (q) => either(q.key, () => known.choose(q), () => ask.choose(q)),
    confirm: (q) => either(q.key, () => known.confirm(q), () => ask.confirm(q)),
    pick: (q) => either(q.key, () => known.pick(q), () => ask.pick(q)),
  };
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
    async choose({ key, options, initial, other }) {
      const value = file[key] ?? initial;
      // The option for a folder of the person's own is answered with the folder's path.
      const named = options.filter((candidate) => candidate.value !== other);
      const option = named.find((candidate) => candidate.value === value);
      if (option) return option.value;
      if (other !== undefined && typeof value === 'string' && isAbsolute(value)) return other;
      throw wrong(key, `it should be one of ${listOf(named)}${other === undefined ? '' : ", or a folder's whole path"}.`);
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
