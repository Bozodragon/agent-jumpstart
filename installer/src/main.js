#!/usr/bin/env node
// The Installer. The bootstrap runs this as:
//
//   node main.js --profile <id> [--debug] [--terminal]
//
// --debug comes from the debug pasted line (york-debug.ps1).
// --terminal keeps the Installer in the window (the terminal front end). Without it, a run with
// nobody's answers file serves the Installer page and writes its address to a file, for the
// Bootstrap to open (installer-page.js).
//
// Four overrides are for tests. Three let a test run it end to end with no network and no prompts:
//   --home <folder>       use this as the user's profile folder (local AppData sits inside it);
//                         everything that would change the rest of the machine, opening a page
//                         in the browser among it, is faked inside it (machine.js)
//   --answers <file>      answer every question from this JSON file; nothing is asked and
//                         nothing waits for Enter, because nobody is at the screen. The run
//                         uses the terminal front end
//   --downloads <folder>  take downloads from this folder instead of the internet
//
// A fourth, for tests only, which the bootstrap never passes:
//   --profiles <folder>   take profiles from this folder instead of the repo's
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { openLog } from './log.js';
import { endAfterSkipped, setUpClaude } from './claude.js';
import { walkThroughConnectors } from './connectors.js';
import { newEnding, note, showEnding } from './ending.js';
import { setUpExtraTools } from './extra-tools.js';
import { setUpGitHub, signedInBefore } from './github.js';
import { loadManifest, toolEntry } from './manifest.js';
import { findPlaces } from './places.js';
import { openMachine } from './machine.js';
import { autoMemoryInUse, switchOffAutoMemory } from './memory.js';
import { fullSkillsSizes, loadProfile, withFullSkills, withTeam } from './profile.js';
import { logProxySetting } from './proxy.js';
import { answersFrom, askChange, askExperience, askingThePerson, askQuestions, askTeam, experienceOptions, fromBeforeExperience, hiddenFor, knownFrom, revealedBy, teamTicksToAdd } from './questions.js';
import { installSkills } from './skills.js';
import { findT3, installT3, openT3 } from './t3.js';
import { End, messageOf, Stop } from './stop.js';
import { installTools, isRecord } from './tools.js';
import { openTerminal } from './terminal.js';
import { inWords } from './text.js';
import { openInstallerPage } from './installer-page.js';
import { setWindowTitle } from './window.js';
import { addToT3, createWorkspaces } from './workspaces.js';

/** @returns {{ profile: string, debug: boolean, terminal: boolean, home?: string, answers?: string, downloads?: string, profiles?: string }} */
function readOptions() {
  const { values } = parseArgs({
    options: {
      profile: { type: 'string', default: 'default' },
      debug: { type: 'boolean', default: false },
      terminal: { type: 'boolean', default: false },
      home: { type: 'string' },
      answers: { type: 'string' },
      downloads: { type: 'string' },
      profiles: { type: 'string' },
    },
    strict: true,
  });
  return values;
}

/** @param {string} path */
async function readAnswers(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Stop(`The answers file ${path} couldn't be read: ${messageOf(error)}`);
  }
}

/**
 * The settings file an earlier run wrote for this profile, if there is one. One that can't be
 * read, or was written for another profile, is set aside and every question is asked.
 * @param {string} path @param {string} profile @param {{ write(line: string): void }} log
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
async function readEarlierSettings(path, profile, log) {
  let settings;
  try {
    settings = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      log.write('Settings: none yet, so this is a first run');
    } else {
      log.write(`Settings: ${path} couldn't be read (${messageOf(error)}), so every question is asked`);
    }
    return undefined;
  }
  if (!isRecord(settings)) {
    log.write(`Settings: ${path} isn't a JSON object, so every question is asked`);
    return undefined;
  }
  if (settings.profile !== profile) {
    log.write(`Settings: ${path} is for the "${settings.profile}" profile, so every question is asked`);
    return undefined;
  }
  log.write(`Settings: found ${path}, so this is a re-run`);
  return settings;
}

/**
 * What a re-run takes from the settings file instead of asking, in the person's words: the top
 * workspace, if it's the one an earlier run wrote down, and each answer the settings gave, except
 * those to questions this person isn't asked, which they never chose.
 * @param {Record<string, unknown>} earlier
 * @param {import('./questions.js').Answers} choices
 * @param {Set<string>} given The keys of the answers the settings gave.
 * @param {string[]} hidden The keys of the questions the experience answers hide (see hiddenFor).
 * @param {string | undefined} downloads
 * @returns {Promise<[string, string][]>}
 */
async function reusedRows(earlier, choices, given, hidden, downloads) {
  const reused = new Set([...given].filter((key) => !hidden.includes(key)));
  /** @param {string[]} names */
  const list = (names) => (names.length === 0 ? 'None' : inWords(names));
  /** @type {[string, string][]} */
  const rows = [];
  if (reused.has('team') && choices.team !== undefined) rows.push(['Team', choices.team]);
  // Each in the words it was answered in.
  for (const [key, label] of /** @type {const} */ ([['aiExperience', 'AI tools'], ['codingExperience', 'Writing code']])) {
    const said = experienceOptions[key].find((option) => option.value === choices[key]);
    if (reused.has(key) && said) rows.push([label, said.label]);
  }
  if (choices.topWorkspace === earlier.topWorkspace || reused.has('googleDriveFolder') || reused.has('workspacesLocation')) {
    rows.push(['Top workspace', choices.topWorkspace]);
  }
  if (reused.has('channel')) rows.push(['T3 Code', choices.channel === 'nightly' ? 'Nightly' : 'Stable']);
  if (reused.has('github')) rows.push(['GitHub', choices.github ? 'Set up' : 'Not set up']);
  if (reused.has('workspaces')) rows.push(['Workspaces', list(choices.workspaces)]);
  if (reused.has('connectors')) rows.push(['Connectors', list(choices.connectors)]);
  if (reused.has('extraTools')) {
    // Named as the checklist names them, by the tools they install.
    const tools = await loadManifest(downloads).then(({ tools }) => tools, () => []);
    const names = choices.extraTools.flatMap((id) => {
      const named = tools.filter((tool) => tool.when === id).map((tool) => tool.name);
      return named.length > 0 ? named : [id];
    });
    rows.push(['Extra tools', list(names)]);
  }
  if (reused.has('fullSkills')) {
    /** @type {Record<import('./profile.js').FullSkills, string>} */
    const said = { no: 'Just the usual ones', finished: "Matt Pocock's finished skills", beta: "Matt Pocock's finished and unfinished skills" };
    rows.push(['Skills', said[choices.fullSkills]]);
  }
  if (reused.has('switchOffMemory')) rows.push(["Claude's memory", choices.switchOffMemory ? 'Switch it off' : 'Leave it on']);
  return rows;
}

/** @param {string} path @param {Record<string, unknown>} settings */
async function writeSettings(path, settings) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
}

async function main() {
  // First, so the window is titled even on a run that stops at flags it can't read.
  setWindowTitle();
  let options;
  try {
    options = readOptions();
  } catch (error) {
    console.error(messageOf(error));
    return 2;
  }

  // Everything the person sees and answers from here on goes through it: steps are given it in
  // their context, as they're given the machine.
  const places = findPlaces(options.home);
  const { frontEnd, why } = await openFrontEnd(options, places);
  const log = openLog(places.logs, { debug: options.debug });
  log.write(`Installer started with Node ${process.version}`);
  log.write(`Profile: ${options.profile}`);
  log.write(`Debug: ${options.debug ? 'on' : 'off'}`);
  log.write(`Home: ${places.home}`);
  log.write(frontEnd.description);
  if (why) log.write(why);
  if (options.answers) log.write(`Answers from: ${options.answers}`);
  if (options.downloads) log.write(`Downloads from: ${options.downloads}`);
  if (options.profiles) log.write(`Profiles from: ${options.profiles}`);
  const machine = openMachine(places, log, frontEnd.screen);
  if (options.debug) await logUserPath(machine, log, 'before');
  await logProxySetting(machine, log);
  /**
   * What this run has changed so far, step by step, for a run that stops partway.
   * @type {[string, string][]}
   */
  const done = [];
  /** What the ending says: the steps that didn't work, noted as the run meets them. */
  const ending = newEnding();
  /**
   * A step's rows, added to what's done and, for each that didn't work, noted for the ending.
   * @param {[string, string][]} rows @param {string} [step] as for `note`
   */
  const record = (rows, step) => {
    done.push(...rows);
    note(ending, rows, step);
  };

  try {
    const offered = await loadProfile(options.profile, options.profiles);
    const answers = options.answers === undefined ? undefined : await readAnswers(options.answers);
    const unattended = answers !== undefined;

    // The setup page isn't opened: the person has just pasted its line into this window.
    frontEnd.start(`Agent Jumpstart · ${offered.name}`);

    // A re-run asks nothing an earlier run already wrote down, unless the person chooses to change it.
    const earlier = await readEarlierSettings(places.settings, offered.id, log);
    const asker = unattended ? answersFrom(answers) : askingThePerson(frontEnd.ask);
    /** @type {Set<string>} */
    const reused = new Set();
    /** The keys of the answers the settings no longer give, which are put as on a first run. @type {Set<string>} */
    const fresh = new Set();
    /**
     * The keys of the answers to ask again, which the settings no longer answer, each with the
     * ticks a team adds to a pick's default.
     * @type {Map<string, string[]>}
     */
    const changing = new Map();
    const ask = earlier ? knownFrom(earlier, asker, log, reused, fresh, changing) : asker;
    /** @type {import('./tools.js').Context} */
    const context = { places, machine, frontEnd, downloads: options.downloads, keepDownloads: options.debug, log, attended: !unattended };
    // What's already on the laptop decides what's asked. Memory's sign is looked for before
    // what to change, which offers Memory only when there's a sign of it or it was left on.
    const memoryInUse = await autoMemoryInUse(context);
    // An answers file from before the experience questions answers every question as it did then,
    // hidden or not, so nothing the experience answers hide is left out or brought back for it.
    const olderAnswers = answers !== undefined && fromBeforeExperience(answers);
    // So is whether GitHub's own tool is signed in, which leaves nothing to ask about GitHub. An
    // older answers file doesn't look, so it runs what it did.
    const githubSignedIn = olderAnswers ? undefined : await signedInBefore(context);
    if (githubSignedIn) fresh.add('github');
    // The team first, and on a re-run, what to change from last time. With a team saved, what
    // to change comes first, so a ticked Team is asked next, in its usual place. From here on
    // the run works from the profile with the team's entries merged in.
    const teamSaved = earlier !== undefined && 'team' in earlier;
    let team = teamSaved ? undefined : await askTeam(offered, ask, log);
    if (earlier) for (const key of await askChange(offered, earlier, { memoryInUse, githubSignedIn, olderAnswers }, asker, log)) changing.set(key, []);
    if (teamSaved) team = await askTeam(offered, ask, log);
    const experience = await askExperience(ask, log);
    // A question the new experience answers reveal is asked, rather than kept from last time.
    if (earlier && !olderAnswers) for (const key of revealedBy(earlier, experience, log)) fresh.add(key);
    const profile = withTeam(offered, team);
    // A team joined or changed asks again each pick it ticks something new in, with its ticks added.
    if (earlier) for (const [key, ticks] of teamTicksToAdd(profile, earlier, team, log)) changing.set(key, ticks);
    // A list of versions that can't be read isn't a reason to stop yet: the first install stops
    // on it, once the answers are saved.
    const foundT3 = await findT3(context).catch((error) => {
      if (!(error instanceof Stop)) throw error;
      log.write(`T3 Code: couldn't look for an earlier install: ${error.message}`);
      return undefined;
    });
    const found = { earlier, memoryInUse, t3Channel: foundT3?.channel, experience, githubSignedIn };
    const choices = {
      ...(team === undefined ? {} : { team }),
      ...experience,
      ...(await askQuestions(profile, places, ask, log, found, { machine, frontEnd, attended: !unattended, keepDownloads: options.debug })),
    };
    if (earlier) {
      const rows = await reusedRows(earlier, choices, reused, olderAnswers ? [] : hiddenFor(experience), options.downloads);
      if (rows.length > 0) frontEnd.summary(rows, 'Using your answers from last time');
    }

    // Keys this run doesn't write (another program's, or a later version's) are kept.
    /** @type {Record<string, unknown>} */
    const settings = { ...earlier, profile: profile.id, ...choices };
    await writeSettings(places.settings, settings);
    log.write(`Settings written to ${places.settings}`);
    done.push(['Settings', 'Your answers, saved for next time']);

    const workspaces = await createWorkspaces(choices.topWorkspace, choices.workspaces, log);
    record(workspaces.rows, 'Workspaces');

    const { rows: tools, programs } = await installTools(context);
    record(tools);
    const github = await setUpGitHub(profile, choices.github, programs, context, githubSignedIn);
    record([['GitHub', github]]);
    const ours = Array.isArray(earlier?.skillsInstalled) ? earlier.skillsInstalled.filter((name) => typeof name === 'string') : [];
    const installedFrom = /** @type {Record<string, string>} */ (
      Object.fromEntries(Object.entries(isRecord(earlier?.skillSources) ? earlier.skillSources : {}).filter(([, commit]) => typeof commit === 'string'))
    );
    // A skills answer that has grown since last time can bring back skills left from an earlier,
    // larger one, at an older commit, so the full set's source is added again whatever its commit.
    /** @type {readonly string[]} */
    const sizes = fullSkillsSizes;
    const fullSet = profile.fullSkills?.source;
    if (fullSet && fullSet in installedFrom && sizes.includes(String(earlier?.fullSkills)) && sizes.indexOf(choices.fullSkills) > sizes.indexOf(String(earlier?.fullSkills))) {
      log.write(`Skills: fullSkills has grown from "${earlier?.fullSkills}" to "${choices.fullSkills}", so ${fullSet} is added again`);
      delete installedFrom[fullSet];
    }
    const skills = await installSkills(withFullSkills(profile, choices.fullSkills), ours, installedFrom, context);
    /** @type {[string, string][]} */
    const skillsRows = skills.cli === undefined ? [] : [['Skills CLI', skills.cli]];
    skillsRows.push(['Skills', skills.line]);
    record(skillsRows);
    note(ending, skills.rows, 'Skills');
    const skillsInstalled = [...new Set([...ours, ...skills.installed])];
    const memoryResult = await switchOffAutoMemory(choices.switchOffMemory, context, earlier?.autoMemory);
    const memory = memoryResult.row;
    record([['Memory', memory]]);
    // Written now, so a run that stops later still knows which skills are the installer's to
    // update, and Jumpstart knows whether memory is off.
    Object.assign(settings, { skillsInstalled, autoMemory: memoryResult.autoMemory });
    // And which commit each skill source was installed from, so the next run can skip those that haven't changed.
    if (Object.keys(skills.sources).length > 0 || 'skillSources' in settings) settings.skillSources = skills.sources;
    await writeSettings(places.settings, settings);
    log.write(`Written to settings: skillsInstalled: ${JSON.stringify(skillsInstalled)}, skillSources: ${JSON.stringify(skills.sources)}, autoMemory: "${memoryResult.autoMemory}"`);
    // Settings' connectors are kept only when every one is still offered, so equal means known.
    const connectedBefore = JSON.stringify(earlier?.connectors) === JSON.stringify(choices.connectors);
    const connectors = await walkThroughConnectors(profile, choices.connectors, { ...context, connectedBefore });
    done.push(['Connectors', connectors]);
    const extraTools = await setUpExtraTools(profile, choices.extraTools, context);
    record(extraTools);
    // Their steps are named as their manifest entries name them (installTools has read it).
    const manifest = await loadManifest(options.downloads);
    /** @type {import('./ending.js').ToolNames} */
    const named = { claude: toolEntry(manifest, 'claude')?.name ?? 'claude', t3: toolEntry(manifest, 't3')?.name ?? 't3' };
    // Before T3, which finds Claude Code only if it's on PATH when T3 starts.
    const claude = await setUpClaude(context, asker);
    record([[named.claude, claude.row]]);
    if (claude.skipped !== undefined) endAfterSkipped(ending, claude.skipped, named);
    settings.email = claude.email;
    await writeSettings(places.settings, settings);
    log.write(`Signed-in email written to settings: ${claude.email ?? 'none'}`);
    // Last of the installs, after every other tool and its PATH entry: T3 reads PATH only when it starts.
    const t3 = await installT3(profile, choices.channel, foundT3, ending.openT3, context);
    record([[named.t3, t3.row]]);
    // After T3's first start, which leaves the command-line shim that adds a project.
    const workspacesLine = await addToT3(workspaces, t3, ending.openT3, context);
    record([['Workspaces', workspacesLine]]);

    /** @type {[string, string][]} */
    const checklist = [
      ['Profile', profile.name],
      ...tools,
      ...extraTools,
      [named.claude, claude.row],
      [named.t3, t3.row],
      ...skillsRows,
      ['Memory', memory],
      ['Workspaces', workspacesLine],
      ['Connectors', connectors],
      ['GitHub', github],
    ];
    if (skills.rows.length > 0) frontEnd.summary(skills.rows, 'Skills');
    frontEnd.summary(workspaces.rows, 'Workspaces');
    frontEnd.summary(checklist, 'Checklist');
    for (const [label, value] of [...skills.rows, ...workspaces.rows, ...checklist]) log.write(`Checklist: ${label}: ${value}`);
    frontEnd.step(`Log: ${log.path}`);

    // T3 Code is opened at the end of every run that has it, so the person ends up where they
    // work, unless this run's install has just started it (its installer does, and it has opened).
    if (!ending.openT3) log.write("Ending: T3 Code isn't opened");
    else if (!t3.installed) log.write("Ending: T3 Code isn't opened: it isn't installed");
    else if (!foundT3 && t3.opened) log.write("Ending: T3 Code isn't opened again: its install just started it");
    else await openT3(foundT3?.channel ?? choices.channel, context);
    showEnding(ending, { top: basename(choices.topWorkspace), t3Installed: t3.installed, tools: named, log, frontEnd });
    log.write('Installer finished');
    return 0;
  } catch (error) {
    if (error instanceof End) {
      log.write(`Ended early, as the person chose: ${error.message}`);
      frontEnd.finish(error.message);
      log.write('Installer finished');
      return 0;
    }
    if (!(error instanceof Stop)) {
      log.write(`Failed: ${error instanceof Error ? error.stack : String(error)}`);
      // Said in plain words first; Node then prints the stack, as it always has.
      frontEnd.problem(`Something went wrong that the Installer didn't expect: ${messageOf(error)}`);
      frontEnd.finish(`The Installer has stopped. The log says more: ${log.path}`);
      throw error;
    }
    log.write(`Stopped: ${error.message}`);
    // Only here is the person told what a stop left behind, so it's never claimed that nothing
    // changed after something did.
    if (done.length === 0) {
      frontEnd.problem(`${error.message} Nothing has been changed.`);
    } else {
      frontEnd.problem(error.message);
      frontEnd.summary(done, 'Done before it stopped');
      for (const [label, value] of done) log.write(`Done before it stopped: ${label}: ${value}`);
      frontEnd.step('Running the same line again carries on from here, without asking your answers again.');
    }
    return 1;
  } finally {
    if (options.debug) await logUserPath(machine, log, 'after');
    await frontEnd.close();
  }
}

/**
 * The front end for this run: the Installer page for someone at the screen, unless `--terminal`
 * keeps them in the window; the terminal for a run whose answers come from a file. A page that
 * can't be served leaves the run in the window, and says why for the log.
 * @param {{ answers?: string, terminal: boolean }} options @param {import('./places.js').Places} places
 * @returns {Promise<{ frontEnd: import('./front-end.js').FrontEnd, why?: string }>}
 */
async function openFrontEnd(options, places) {
  if (options.answers !== undefined || options.terminal) return { frontEnd: await openTerminal() };
  try {
    const page = await openInstallerPage({ addressFile: places.pageAddress });
    // For whoever started it by hand: the Bootstrap opens the address from the file.
    process.stdout.write(`The Installer page: ${page.address}
`);
    return { frontEnd: page };
  } catch (error) {
    return { frontEnd: await openTerminal(), why: `The Installer page couldn't be served, so the run stays in the window: ${messageOf(error)}` };
  }
}

/**
 * For a debug run's log, whichever way the run ends.
 * @param {import('./machine.js').Machine} machine @param {import('./log.js').Log} log @param {string} when
 */
async function logUserPath(machine, log, when) {
  const entries = await machine.userPath().catch((error) => [`(couldn't be read: ${messageOf(error)})`]);
  log.detail([`User PATH ${when}:`, ...entries.map((entry) => `  ${entry}`)].join('\n'));
}

// Exits here rather than letting Node wind down by itself. On Windows, a question asked after a
// spinner can leave a read of the window pending (libuv's line-mode read isn't cancelled once the
// spinner has turned raw mode off and the question has turned it on again in the same tick), and
// Node waits for that read as it closes stdin, so the window wasn't given back until Enter (#85).
process.exit(await main());
