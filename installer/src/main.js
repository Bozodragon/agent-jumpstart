#!/usr/bin/env node
// The Installer. The bootstrap runs this as:
//
//   node main.js --profile <id> [--debug]
//
// --debug comes from the debug pasted line (york-debug.ps1).
//
// Three overrides let a test run it end to end with no network and no prompts:
//   --home <folder>       use this as the user's profile folder (local AppData sits inside it);
//                         everything that would change the rest of the machine, opening a page
//                         in the browser among it, is faked inside it (machine.js)
//   --answers <file>      answer every question from this JSON file; nothing is asked and
//                         nothing waits for Enter, because nobody is at the screen
//   --downloads <folder>  take downloads from this folder instead of the internet
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { openLog } from './log.js';
import { checkClaude } from './claude.js';
import { walkThroughConnectors } from './connectors.js';
import { setUpExtraTools } from './extra-tools.js';
import { setUpGitHub } from './github.js';
import { showPage } from './open-page.js';
import { findPlaces } from './places.js';
import { openMachine } from './machine.js';
import { autoMemoryInUse, switchOffAutoMemory } from './memory.js';
import { loadProfile } from './profile.js';
import { answersFrom, askQuestions, knownFrom } from './questions.js';
import { installSkills } from './skills.js';
import { messageOf, Stop } from './stop.js';
import { findT3, installT3 } from './t3.js';
import { installTools } from './tools.js';
import * as ui from './ui.js';
import { addToT3, createWorkspaces } from './workspaces.js';

/** @returns {{ profile: string, debug: boolean, home?: string, answers?: string, downloads?: string }} */
function readOptions() {
  const { values } = parseArgs({
    options: {
      profile: { type: 'string', default: 'default' },
      debug: { type: 'boolean', default: false },
      home: { type: 'string' },
      answers: { type: 'string' },
      downloads: { type: 'string' },
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
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
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

/** @param {string} path @param {Record<string, unknown>} settings */
async function writeSettings(path, settings) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
}

async function main() {
  let options;
  try {
    options = readOptions();
  } catch (error) {
    console.error(messageOf(error));
    return 2;
  }

  const places = findPlaces(options.home);
  const log = openLog(places.logs, { debug: options.debug });
  log.write(`Installer started with Node ${process.version}`);
  log.write(`Profile: ${options.profile}`);
  log.write(`Debug: ${options.debug ? 'on' : 'off'}`);
  log.write(`Home: ${places.home}`);
  if (options.answers) log.write(`Answers from: ${options.answers}`);
  if (options.downloads) log.write(`Downloads from: ${options.downloads}`);
  const machine = openMachine(places, log);
  if (options.debug) await logUserPath(machine, log, 'before');
  /**
   * What this run has changed so far, step by step, for a run that stops partway.
   * @type {[string, string][]}
   */
  const done = [];

  try {
    const profile = await loadProfile(options.profile);
    const answers = options.answers === undefined ? undefined : await readAnswers(options.answers);
    const unattended = answers !== undefined;

    ui.start(`Agent Jumpstart · ${profile.name}`);

    await showPage('Setup page', profile.page, { machine, log });

    // A re-run asks nothing an earlier run already wrote down.
    const earlier = await readEarlierSettings(places.settings, profile.id, log);
    const asker = unattended ? answersFrom(answers) : ui.ask;
    if (earlier) ui.step('Using your answers from last time.');
    /** @type {import('./tools.js').Context} */
    const context = { places, machine, downloads: options.downloads, keepDownloads: options.debug, log, attended: !unattended };
    // What's already on the laptop decides what's asked. A list of versions that can't be read
    // isn't a reason to stop yet: the first install stops on it, once the answers are saved.
    const memoryInUse = await autoMemoryInUse(context);
    const foundT3 = await findT3(context).catch((error) => {
      if (!(error instanceof Stop)) throw error;
      log.write(`T3 Code: couldn't look for an earlier install: ${error.message}`);
      return undefined;
    });
    const found = { earlier, memoryInUse, t3Channel: foundT3?.channel };
    const choices = await askQuestions(profile, places, earlier ? knownFrom(earlier, asker, log) : asker, log, found);

    // Keys this run doesn't write (another program's, or a later version's) are kept.
    /** @type {Record<string, unknown>} */
    const settings = { ...earlier, profile: profile.id, ...choices };
    await writeSettings(places.settings, settings);
    log.write(`Settings written to ${places.settings}`);
    done.push(['Settings', 'Your answers, saved for next time']);

    const workspaces = await createWorkspaces(choices.topWorkspace, choices.workspaces, log);
    done.push(...workspaces.rows);

    const tools = await installTools(context);
    done.push(...tools);
    const github = await setUpGitHub(profile, choices.github, context);
    done.push(['GitHub', github]);
    const ours = Array.isArray(earlier?.skillsInstalled) ? earlier.skillsInstalled.filter((name) => typeof name === 'string') : [];
    const skills = await installSkills(profile, ours, context);
    /** @type {[string, string][]} */
    const skillsRows = skills.cli === undefined ? [] : [['Skills CLI', skills.cli]];
    skillsRows.push(['Skills', skills.line]);
    done.push(...skillsRows);
    const skillsInstalled = [...new Set([...ours, ...skills.installed])];
    const memoryResult = await switchOffAutoMemory(choices.switchOffMemory, context);
    const memory = memoryResult.row;
    done.push(['Memory', memory]);
    // Written now, so a run that stops later still knows which skills are the installer's to
    // update, and Jumpstart knows whether memory is off.
    Object.assign(settings, { skillsInstalled, autoMemory: memoryResult.autoMemory });
    await writeSettings(places.settings, settings);
    log.write(`Written to settings: skillsInstalled: ${JSON.stringify(skillsInstalled)}, autoMemory: "${memoryResult.autoMemory}"`);
    // Settings' connectors are kept only when every one is still offered, so equal means known.
    const connectedBefore = JSON.stringify(earlier?.connectors) === JSON.stringify(choices.connectors);
    const connectors = await walkThroughConnectors(profile, choices.connectors, { ...context, connectedBefore });
    done.push(['Connectors', connectors]);
    const extraTools = await setUpExtraTools(profile, choices.extraTools, context);
    done.push(...extraTools);
    // Last of the installs, after every other tool and its PATH entry: T3 reads PATH only when it starts.
    const t3 = await installT3(choices.channel, foundT3, context);
    done.push(['T3 Code', t3.row]);
    // After T3's first start, which leaves the command-line shim that adds a project.
    const workspacesLine = await addToT3(workspaces, t3, context);
    done.push(['Workspaces', workspacesLine]);
    const claude = await checkClaude({ ...context, t3 });
    settings.email = claude.email;
    await writeSettings(places.settings, settings);
    log.write(`Signed-in email written to settings: ${claude.email ?? 'none'}`);

    /** @type {[string, string][]} */
    const checklist = [
      ['Profile', profile.name],
      ...tools,
      ...extraTools,
      ['T3 Code', t3.row],
      ['Claude Code', claude.row],
      ...skillsRows,
      ['Memory', memory],
      ['Workspaces', workspacesLine],
      ['Connectors', connectors],
      ['GitHub', github],
    ];
    if (skills.rows.length > 0) ui.summary(skills.rows, 'Skills');
    ui.summary(workspaces.rows, 'Workspaces');
    ui.summary(checklist, 'Checklist');
    for (const [label, value] of [...skills.rows, ...workspaces.rows, ...checklist]) log.write(`Checklist: ${label}: ${value}`);
    ui.step(`Log: ${log.path}`);

    ui.finish('Done.');
    log.write('Installer finished');
    return 0;
  } catch (error) {
    if (!(error instanceof Stop)) {
      log.write(`Failed: ${error instanceof Error ? error.stack : String(error)}`);
      throw error;
    }
    log.write(`Stopped: ${error.message}`);
    // Only here is the person told what a stop left behind, so it's never claimed that nothing
    // changed after something did.
    if (done.length === 0) {
      ui.problem(`${error.message} Nothing has been changed.`);
    } else {
      ui.problem(error.message);
      ui.summary(done, 'Done before it stopped');
      for (const [label, value] of done) log.write(`Done before it stopped: ${label}: ${value}`);
      ui.step('Running the same line again carries on from here, without asking your answers again.');
    }
    return 1;
  } finally {
    if (options.debug) await logUserPath(machine, log, 'after');
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

process.exitCode = await main();
