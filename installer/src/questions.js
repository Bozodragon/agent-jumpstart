// The questions, built from the profile and what is already on the laptop. Each has a default,
// so accepting the default (Enter, or leaving it out of an answers file) gives a sensible setup.
import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { describeGoogleDrive, findGoogleDrive, isFolder, readyGoogleDrive } from './google-drive.js';
import { anotherTeam } from './profile.js';
import { Stop } from './stop.js';
import { existingTopWorkspaces, topWorkspaceIn } from './workspaces.js';

/**
 * What the person chose. These are the settings file's keys, which Jumpstart
 * and a re-run read, and the keys an answers file uses.
 * @typedef {object} Answers
 * @property {string} [team] The chosen team's name, or `Another team`. Only under a profile that
 *   lists teams. Saved for a later release: Jumpstart and the setup page don't read it yet.
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
 * @property {FullSkills} fullSkills Which of Matt Pocock's full set of skills for writing code to
 *   install as well as the profile's usual ones: none, his finished ones, or those and his unfinished ones.
 * @property {boolean} switchOffMemory Whether to switch off Claude's automatic memory. Asked only
 *   of someone who has been using it, with No as the default; otherwise true.
 */

/** @typedef {import('./profile.js').FullSkills} FullSkills */

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
 * @property {<T extends string>(q: { key: string, message: string, options: Option<T>[], initial: T, other?: T, inTurn?: boolean }) => Promise<T>} choose
 *   `other`, if given, is the option whose answer a follow-up `folder` question with the same key
 *   asks for; an answers file gives that folder's whole path in place of the option. `inTurn`
 *   marks a question that may be asked several times in a run: an answers file may give a list,
 *   which answers it one item at a time, and then the default.
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
 * How the questions reach the laptop and the person beyond the asker: to look again for Google
 * Drive for desktop, and to wait for someone at the screen to get it ready.
 * @typedef {{ machine: import('./machine.js').Machine, frontEnd: import('./front-end.js').FrontEnd, attended: boolean }} Reach
 */

/**
 * Under a profile that keeps workspaces in Google Drive, needs Drive for desktop signed in, but
 * only once the person has chosen to make a new top workspace: if it isn't, they're told how to
 * get it ready and, when they're at the screen, waited for, or offered Documents instead (see
 * readyGoogleDrive).
 * @param {import('./profile.js').Profile} profile
 * @param {import('./places.js').Places} places
 * @param {Asker} ask
 * @param {{ write(line: string): void }} log
 * @param {Found} found
 * @param {Reach} reach
 * @returns {Promise<Answers>}
 */
export async function askQuestions(profile, places, ask, log, found, reach) {
  return theRest(profile, ask, log, found, await whereWorkspacesLive(profile, places, ask, log, found, reach));
}

/**
 * Under a profile that lists teams, the first question: which team the person is in. Another
 * team, last, is the default, so an answers file without `team` sets up what the profile does.
 * Under a profile without teams it isn't asked, and gives no answer.
 * @param {import('./profile.js').Profile} profile @param {Asker} ask
 * @param {{ write(line: string): void }} log
 * @returns {Promise<string | undefined>}
 */
export async function askTeam(profile, ask, log) {
  if (!profile.teams?.length) return undefined;
  const team = await ask.choose({
    key: 'team',
    message: 'Which team are you in?',
    options: [...profile.teams.map(({ name }) => ({ value: name, label: name })), { value: anotherTeam, label: anotherTeam }],
    initial: anotherTeam,
  });
  log.write(`Answer: team: ${JSON.stringify(team)}`);
  return team;
}

/**
 * On a re-run, which of last time's answers to ask again. Only answers the settings hold are
 * offered: Team only under a profile with teams, and Memory only when a first run would ask it
 * (`memoryInUse`) or last time it was left on. The top workspace and T3 Code's channel never
 * are. Nothing ticked, the default, keeps everything. Settings never answer it, and it isn't saved.
 * @param {import('./profile.js').Profile} profile @param {Record<string, unknown>} earlier
 * @param {boolean} memoryInUse @param {Asker} ask the person or the answers file, not the settings
 * @param {{ write(line: string): void }} log
 * @returns {Promise<string[]>} the keys of the answers to ask again
 */
export async function askChange(profile, earlier, memoryInUse, ask, log) {
  /** @type {[string, string, boolean][]} */
  const offered = [
    ['team', 'Team', Boolean(profile.teams?.length)],
    ['workspaces', 'Workspaces', true],
    ['connectors', 'Connectors', true],
    ['extraTools', 'Extra tools', true],
    ['github', 'GitHub', true],
    ['fullSkills', 'Skills', true],
    ['switchOffMemory', 'Memory', memoryInUse || earlier.switchOffMemory === false],
  ];
  const options = offered.filter(([key, , shown]) => shown && key in earlier).map(([value, label]) => ({ value, label }));
  if (options.length === 0) return [];
  const change = await ask.pick({
    key: 'change',
    message: "Anything to change from last time? Tick what to change, or nothing to keep it all. Unticking something later doesn't remove it.",
    options,
    initial: [],
  });
  log.write(`Answer: change: ${JSON.stringify(change)}`);
  return change;
}

/**
 * On a re-run that answers the team for the first time or changes it, the picks the team ticks
 * something in that last time's answers don't have, each with the team's ticks to add to last
 * time's. Choosing last time's team again, or a team that ticks nothing (Another team), brings
 * nothing. A pick the person chose to change as well is still asked once, with the ticks added.
 * @param {import('./profile.js').Profile} profile the profile with the team merged in (see withTeam)
 * @param {Record<string, unknown>} earlier @param {string | undefined} team
 * @param {{ write(line: string): void }} log
 * @returns {[string, string[]][]}
 */
export function teamTicksToAdd(profile, earlier, team, log) {
  if (!profile.teamTicks || team === earlier.team) return [];
  /** @type {[string, string[]][]} */
  const picks = [];
  for (const key of /** @type {const} */ (['connectors', 'extraTools'])) {
    const ticks = profile.teamTicks[key];
    const saved = earlier[key];
    // A pick with no list saved is asked anyway, with the team's ticks in its usual default.
    if (!Array.isArray(saved)) continue;
    const missing = ticks.filter((tick) => !saved.includes(tick));
    if (missing.length === 0) continue;
    log.write(`Settings: the ${team} team ticks ${missing.join(', ')}, which last time's ${key} doesn't have`);
    picks.push([key, ticks]);
  }
  return picks;
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
 * @param {Asker} ask @param {{ write(line: string): void }} log @param {Found} found @param {Reach} reach
 * @returns {Promise<Location>}
 */
async function whereWorkspacesLive(profile, places, ask, log, found, reach) {
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
  if (drive) log.write(`Google Drive for desktop: ${describeGoogleDrive(drive)}`);
  // Settings from before this was asked: that run set up a new one where its answers say.
  const earlierLocation = drive ? 'googleDriveFolder' : 'workspacesLocation';
  if (found.earlier && !('topWorkspace' in found.earlier) && earlierLocation in found.earlier) {
    log.write(`Known from settings: topWorkspace: "${newTopWorkspace}" (an earlier run set one up where its ${earlierLocation} says)`);
    return newLocation(profile, places, ask, drive, { ...reach, log });
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
    return newLocation(profile, places, ask, drive, { ...reach, log });
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
 * in. Under a Google Drive profile, Drive for desktop has to be signed in first, or Documents is
 * used instead (see readyGoogleDrive).
 * @param {import('./profile.js').Profile} profile @param {import('./places.js').Places} places
 * @param {Asker} ask
 * @param {import('./google-drive.js').GoogleDrive | undefined} found what was found, under a Google Drive profile
 * @param {Reach & { log: { write(line: string): void } }} context
 * @returns {Promise<Location>}
 */
async function newLocation(profile, places, ask, found, context) {
  let googleDriveFolder = null;
  let workspacesLocation;
  if (found) {
    const drive = await readyGoogleDrive(profile, places, ask, found, context);
    if (drive.status === 'documents') {
      const documents = join(places.home, 'Documents');
      return { googleDriveFolder: null, workspacesLocation: documents, topWorkspace: topWorkspaceIn(profile, documents) };
    }
    googleDriveFolder = await ask.folder({
      key: 'googleDriveFolder',
      message: drive.folder
        ? 'Is this your Google Drive folder? If not, type the right one.'
        : "Where is your Google Drive folder? It's usually a drive letter followed by My Drive.",
      initial: drive.folder,
      placeholder: 'G:\\My Drive',
      validate: mustBeAFolder,
    });
    workspacesLocation = googleDriveFolder;
  } else {
    workspacesLocation = await ask.folder({
      key: 'workspacesLocation',
      message: 'Where should your workspaces live? Keep this folder, or type another.',
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

  const github = await ask.confirm({ key: 'github', message: 'Set up GitHub now? You can change this on a later run.', initial: false });

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

  const fullSkills = await ask.choose({
    key: 'fullSkills',
    message: "Would you also like Matt Pocock's full set of skills for writing code?",
    options: /** @type {Option<FullSkills>[]} */ ([
      { value: 'no', label: 'No, just the usual ones' },
      { value: 'finished', label: 'Yes, his finished skills' },
      { value: 'beta', label: 'Yes, and his unfinished ones as a beta' },
    ]),
    initial: 'no',
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
  const answers = { googleDriveFolder, workspacesLocation, topWorkspace, channel, github, workspaces, connectors, extraTools, fullSkills, switchOffMemory };
  for (const [key, value] of Object.entries(answers)) log.write(`Answer: ${key}: ${JSON.stringify(value)}`);
  return answers;
}

/**
 * On a re-run: answers from the settings file an earlier run wrote, so nothing already known is
 * asked again. Only an answer the person chose to change, or one that's missing (a key added
 * since) or no longer right (a folder that's gone, a name the profile no longer offers), goes to
 * `ask`, the person or the answers file. The top workspace is the exception: askQuestions uses
 * the settings' one itself while it's there, so the question is put only when it's gone or was
 * never written down, and the settings never answer it.
 * @param {Record<string, unknown>} settings
 * @param {Asker} ask
 * @param {{ write(line: string): void }} log
 * @param {Set<string>} [reused] Filled with the key of each answer the settings gave.
 * @param {Map<string, string[]>} [changing] The keys of the answers to ask again, filled in before
 *   their questions come: those the person chose to change (see askChange), and the picks a team
 *   joined or changed brings ticks to (see teamTicksToAdd), each with those ticks. Each is put to
 *   `ask` with last time's answer as the default, and for a pick, the ticks added to it. A pick
 *   whose saved answer is no longer right is asked the same way, by itself; a choose or confirm
 *   whose saved answer is no longer right is asked with the question's own default.
 * @returns {Asker}
 */
export function knownFrom(settings, ask, log, reused = new Set(), changing = new Map()) {
  const { topWorkspace, ...answerable } = settings;
  const known = answersFrom(answerable);
  /**
   * A question the person chose to change, asked with `initial`, last time's answer, or, when
   * that's no longer right, the question's own default.
   * @template Q, T
   * @param {Q & { key: string }} q @param {() => Promise<unknown>} lastTime @param {(q: Q) => Promise<T>} put
   * @returns {Promise<T>}
   */
  const again = async (q, lastTime, put) => {
    log.write(`Settings: ${q.key} is to change, so it's asked again`);
    const initial = await lastTime().catch((error) => {
      if (!(error instanceof Stop)) throw error;
      return /** @type {any} */ (q).initial;
    });
    return put({ ...q, initial });
  };
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
        reused.add(key);
        return value;
      } catch (error) {
        if (!(error instanceof Stop)) throw error;
        log.write(`Settings: ${key} is no longer right (${JSON.stringify(settings[key])}), so it's asked again`);
      }
    }
    return otherwise();
  };
  return {
    folder: (q) => (changing.has(q.key) ? again(q, () => known.folder(q), (r) => ask.folder(r)) : either(q.key, () => known.folder(q), () => ask.folder(q))),
    choose: (q) => (changing.has(q.key) ? again(q, () => known.choose(q), (r) => ask.choose(r)) : either(q.key, () => known.choose(q), () => ask.choose(q))),
    confirm: (q) => (changing.has(q.key) ? again(q, () => known.confirm(q), (r) => ask.confirm(r)) : either(q.key, () => known.confirm(q), () => ask.confirm(q))),
    // A re-asked pick's default is last time's ticks without anything the profile no longer
    // offers, and with a team's, whether the person chose to change it or it came back by itself.
    pick: (q) => {
      const lastTime = () => lastTicks(settings[q.key], q.options, q.initial, changing.get(q.key));
      return changing.has(q.key) ? again(q, async () => lastTime(), (r) => ask.pick(r)) : either(q.key, () => known.pick(q), () => ask.pick({ ...q, initial: lastTime() }));
    },
  };
}

/**
 * A re-asked pick's default: last time's ticks that are still offered, then any of `added` it
 * doesn't have. When none were saved as a list, the question's own default: that's a pick with
 * nothing saved, a question added since, which a re-run asks as a first run does, or one whose
 * saved answer isn't a list at all, which is no longer right.
 * @template {string} T
 * @param {unknown} saved @param {Option<T>[]} options @param {T[]} initial @param {string[]} [added]
 * @returns {T[]}
 */
function lastTicks(saved, options, initial, added = []) {
  if (!Array.isArray(saved)) return initial;
  return [...new Set([...saved, ...added])].flatMap((value) => options.filter((option) => option.value === value).map((option) => option.value));
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

  /** How many times each key has been asked, for a list that answers it in turn. @type {Record<string, number>} */
  const turns = {};

  return {
    async folder({ key, initial, validate }) {
      const value = file[key] ?? initial;
      if (value === undefined) throw wrong(key, 'it is needed, because no folder was found to offer as the default.');
      if (typeof value !== 'string') throw wrong(key, 'it should be a path.');
      const problem = await validate(value);
      if (problem) throw wrong(key, problem);
      return value;
    },
    async choose({ key, options, initial, other, inTurn }) {
      // A question asked again and again (after each failed sign-in) takes a list, one answer
      // each time, and the default once the list runs out.
      let value = file[key] ?? initial;
      if (inTurn && Array.isArray(value)) {
        const turn = turns[key] ?? 0;
        turns[key] = turn + 1;
        value = turn < value.length ? value[turn] : initial;
      }
      // The option for a folder of the person's own is answered with the folder's path.
      const named = options.filter((candidate) => candidate.value !== other);
      const option = named.find((candidate) => candidate.value === value);
      if (option) return option.value;
      if (other !== undefined && typeof value === 'string' && isAbsolute(value)) return other;
      throw wrong(key, `it should be one of ${listOf(named)}${other === undefined ? '' : ", or a folder's whole path"}${inTurn ? ', or a list of them' : ''}.`);
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
