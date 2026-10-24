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
import { checkClaude } from './claude.js';
import { walkThroughConnectors } from './connectors.js';
import { setUpGitHub } from './github.js';
import { tryToOpen } from './open-page.js';
import { findPlaces } from './places.js';
import { openMachine } from './machine.js';
import { loadProfile } from './profile.js';
import { answersFrom, askQuestions } from './questions.js';
import { messageOf, Stop } from './stop.js';
import { installT3 } from './t3.js';
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
  const log = openLog(places.logs);
  log.write(`Installer started with Node ${process.version}`);
  log.write(`Profile: ${options.profile}`);
  log.write(`Debug: ${options.debug ? 'on' : 'off'}`);
  log.write(`Home: ${places.home}`);
  if (options.answers) log.write(`Answers from: ${options.answers}`);
  if (options.downloads) log.write(`Downloads from: ${options.downloads}`);

  try {
    const profile = await loadProfile(options.profile);
    const answers = options.answers === undefined ? undefined : await readAnswers(options.answers);
    const unattended = answers !== undefined;

    ui.start(`Agent Jumpstart · ${profile.name}`);

    ui.step(`Setup page: ${profile.page}`);
    log.write(`Setup page: ${profile.page} (${unattended ? 'not opened: answers came from a file' : await tryToOpen(profile.page)})`);

    const choices = await askQuestions(profile, places, unattended ? answersFrom(answers) : ui.ask, log);

    /** @type {Record<string, unknown>} */
    const settings = { profile: profile.id, ...choices };
    await writeSettings(places.settings, settings);
    log.write(`Settings written to ${places.settings}`);

    const machine = openMachine(places);
    const context = { places, machine, downloads: options.downloads, log, attended: !unattended };
    const tools = await installTools(context);
    const github = await setUpGitHub(profile, choices.github, context);
    // After the other tools and their PATH entries: T3 reads PATH only when it starts.
    const t3 = await installT3(choices.channel, context);
    const claude = await checkClaude({ ...context, t3 });
    settings.email = claude.email;
    await writeSettings(places.settings, settings);
    log.write(`Signed-in email written to settings: ${claude.email ?? 'none'}`);
    const connectors = await walkThroughConnectors(profile, choices.connectors, { attended: !unattended, log });

    /** @type {[string, string][]} */
    const checklist = [
      ['Profile', profile.name],
      ...tools,
      ['T3 Code', t3.row],
      ['Claude Code', claude.row],
      ['Workspaces', 'None created'],
      ['Connectors', connectors],
      ['GitHub', github],
    ];
    ui.summary(checklist, 'Checklist');
    for (const [label, value] of checklist) log.write(`Checklist: ${label}: ${value}`);
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
  }
}

process.exitCode = await main();
