#!/usr/bin/env node
// The Installer. The bootstrap runs this as:
//
//   node main.js --profile <id> [--debug]
//
// --debug comes from the debug pasted line (york-debug.ps1).
//
// Three overrides let a test run it end to end with no network and no prompts:
//   --home <folder>       use this as the user's profile folder (local AppData sits inside it)
//   --answers <file>      answer every question from this JSON file; nothing is asked and no
//                         browser is opened, because nobody is at the screen
//   --downloads <folder>  take downloads from this folder instead of the internet
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { openLog } from './log.js';
import { walkThroughConnectors } from './connectors.js';
import { setUpGitHub } from './github.js';
import { tryToOpen } from './open-page.js';
import { findPlaces } from './places.js';
import { openMachine } from './machine.js';
import { switchOffAutoMemory } from './memory.js';
import { loadProfile } from './profile.js';
import { answersFrom, askQuestions } from './questions.js';
import { installSkills } from './skills.js';
import { messageOf, Stop } from './stop.js';
import { installTools } from './tools.js';
import * as ui from './ui.js';

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

  try {
    const profile = await loadProfile(options.profile);
    const answers = options.answers === undefined ? undefined : await readAnswers(options.answers);
    const unattended = answers !== undefined;

    ui.start(`Agent Jumpstart · ${profile.name}`);

    ui.step(`Setup page: ${profile.page}`);
    log.write(`Setup page: ${profile.page} (${unattended ? 'not opened: answers came from a file' : await tryToOpen(profile.page)})`);

    const choices = await askQuestions(profile, places, unattended ? answersFrom(answers) : ui.ask, log);

    const settings = { profile: profile.id, ...choices };
    await mkdir(dirname(places.settings), { recursive: true });
    await writeFile(places.settings, `${JSON.stringify(settings, null, 2)}\n`);
    log.write(`Settings written to ${places.settings}`);

    const tools = await installTools({ places, machine, downloads: options.downloads, keepDownloads: options.debug, log });
    const github = await setUpGitHub(profile, choices.github, { attended: !unattended, places, machine, downloads: options.downloads, log });
    const skills = await installSkills(profile, { places, machine, downloads: options.downloads, log });
    const memory = await switchOffAutoMemory({ places, machine, log });
    const connectors = await walkThroughConnectors(profile, choices.connectors, { attended: !unattended, log });

    /** @type {[string, string][]} */
    const checklist = [
      ['Profile', profile.name],
      ...tools,
      ['Skills', skills.line],
      ['Memory', memory],
      ['Workspaces', 'None created'],
      ['Connectors', connectors],
      ['GitHub', github],
    ];
    if (skills.rows.length > 0) ui.summary(skills.rows, 'Skills');
    ui.summary(checklist, 'Checklist');
    for (const [label, value] of [...skills.rows, ...checklist]) log.write(`Checklist: ${label}: ${value}`);
    ui.step(`Log: ${log.path}`);

    ui.finish('Done.');
    log.write('Installer finished');
    return 0;
  } catch (error) {
    if (!(error instanceof Stop)) {
      log.write(`Failed: ${error instanceof Error ? error.stack : String(error)}`);
      throw error;
    }
    ui.problem(error.message);
    log.write(`Stopped: ${error.message}`);
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
