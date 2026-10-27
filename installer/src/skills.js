// Installs the profile's skills for Claude Code with the skills CLI. The CLI is pinned like
// clasp: its npm package, checked against the manifest's checksum and installed per user into
// a folder of its own (off the user PATH: only the installer runs it). Then, per source, with
// the flags that stop it asking anything:
//
//   <folder>\skills.cmd add <source> -g -a claude-code -y [-s <name> ...]
//
// Skill sources aren't pinned: each is added from its default branch, as the profile gives it.
// -a claude-code is always given: with -y alone the CLI installs to every agent it knows. -s
// comes last because it takes every word after it. The CLI clones public sources with Git, so
// it runs after the tools, and needs no GitHub account.
//
// A skill already in Claude's skills folder is the person's and is left exactly as it is, unless
// this installer put it there on an earlier run (the settings file's `skillsInstalled`): those
// are added again, which updates them. A skill counts as installed only if it is in Claude's
// skills folder afterwards: the CLI's exit code alone isn't trusted.
import { join } from 'node:path';
import { loadManifest, toolEntry } from './manifest.js';
import { exists, installTool } from './tools.js';
import * as ui from './ui.js';

const leftAlone = 'Already there, left as it is';

/**
 * @param {import('./profile.js').Profile} profile
 * @param {string[]} ours The skills an earlier run installed (the settings file's `skillsInstalled`).
 * @param {import('./tools.js').Context} context
 * @returns {Promise<{ cli?: string, rows: [string, string][], line: string, installed: string[] }>}
 *   The checklist's Skills CLI row, when the profile has skills; one row per skill, labelled as
 *   the person types it, for the Skills summary; the checklist's Skills line; and the skills this
 *   run installed.
 */
export async function installSkills(profile, ours, context) {
  const { places, machine, downloads, log } = context;
  const sources = profile.skills ?? [];
  if (sources.length === 0) return { rows: [], line: 'None in this profile', installed: [] };

  const manifest = await loadManifest(downloads);
  const entry = toolEntry(manifest, 'skills');
  const cli = entry ? await installTool(entry, context) : { installed: false, row: 'Not installed: the list of versions has no entry for it' };
  const program = entry && join(places.programs, entry.install.folder, entry.install.check);
  const folder = join(places.claudeConfig, 'skills');
  if (cli.installed) log.write(`Skills: each counts as installed once ${join(folder, '<name>', 'SKILL.md')} is there`);

  // A source with no names is the path to a single skill, which is named by its last part.
  const named = sources.map(({ source, names }) => ({ source, names, skills: names ?? [source.split('/').at(-1) ?? source] }));
  // Looked at before any source is added, so a skill one source brings isn't taken for theirs.
  /** @type {string[]} */
  const theirs = [];
  for (const name of named.flatMap(({ skills }) => skills)) if (!ours.includes(name) && (await exists(join(folder, name)))) theirs.push(name);

  /** @type {[string, string][]} */
  const rows = [];
  /** @type {string[]} */
  const installed = [];
  for (const { source, names, skills } of named) {
    const wanted = skills.filter((name) => !theirs.includes(name));
    let ran;
    if (cli.installed && program && wanted.length > 0) {
      ui.step(`Installing ${wanted.length === 1 ? 'the skill' : `${wanted.length} skills`} from ${source}`);
      const args = ['add', source, '-g', '-a', 'claude-code', '-y', ...(names ? ['-s', ...wanted] : [])];
      ran = await machine.run(program, args);
    }
    for (const name of skills) {
      let value;
      // Kept short: skill names make the label column wide, and clack wraps long rows.
      if (theirs.includes(name)) value = leftAlone;
      else if (!ran) value = "Not installed: the skills CLI isn't installed";
      else if (ran.code !== 0) value = `Not installed: its installer stopped (code ${ran.code})`;
      else if (!(await exists(join(folder, name, 'SKILL.md')))) value = "Not installed: it didn't arrive";
      else value = 'Installed';
      log.write(`Skills: ${name} from ${source}: ${value === leftAlone ? `already in ${join(folder, name)} and not put there by this installer, so left as it is` : value}`);
      rows.push([`/${name}`, value]);
      if (value === 'Installed') installed.push(name);
    }
  }
  return { cli: cli.row, rows, line: lineFor(rows), installed };
}

/** @param {[string, string][]} rows */
function lineFor(rows) {
  const installed = rows.filter(([, value]) => value === 'Installed').length;
  const there = rows.filter(([, value]) => value === leftAlone).length;
  const total = rows.length;
  if (installed === total) return `All ${total} installed`;
  if (there === total) return `All ${total} already there`;
  if (installed + there === total) return `All ${total} there: ${installed} installed, ${there} already there`;
  if (installed === 0 && there === 0) return 'None installed';
  return `${installed} of ${total} installed${there > 0 ? `, ${there} already there` : ''}`;
}
