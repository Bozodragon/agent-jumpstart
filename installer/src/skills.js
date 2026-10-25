// Installs the profile's skills for Claude Code with the skills CLI. The CLI is pinned like
// clasp: its npm package, checked against the manifest's checksum and installed per user into
// a folder of its own (off the user PATH: only the installer runs it). Then, per source, with
// the flags that stop it asking anything:
//
//   <folder>\skills.cmd add <source>[#<commit>] -g -a claude-code -y [-s <name> ...]
//
// The commit is the manifest's pin for the source's repository (`skillSources`); the CLI checks
// that commit out. -a claude-code is always given: with -y alone the CLI installs to every agent
// it knows. -s comes last because it takes every word after it. The CLI clones public sources
// with Git, so it runs after the tools, and needs no GitHub account.
//
// A skill counts as installed only if it is in Claude's skills folder afterwards: the CLI's
// exit code alone isn't trusted.
import { join } from 'node:path';
import { loadManifest, toolEntry } from './manifest.js';
import { exists, installTool } from './tools.js';
import * as ui from './ui.js';

/**
 * @param {import('./profile.js').Profile} profile
 * @param {import('./tools.js').Context} context
 * @returns {Promise<{ cli?: string, rows: [string, string][], line: string }>} The checklist's
 *   Skills CLI row, when the profile has skills; one row per skill, labelled as the person types
 *   it, for the Skills summary; and the checklist's Skills line.
 */
export async function installSkills(profile, context) {
  const { places, machine, downloads, log } = context;
  const sources = profile.skills ?? [];
  if (sources.length === 0) return { rows: [], line: 'None in this profile' };

  const manifest = await loadManifest(downloads);
  const entry = toolEntry(manifest, 'skills');
  const cli = entry ? await installTool(entry, context) : { installed: false, row: 'Not installed: the list of versions has no entry for it' };
  const program = entry && join(places.programs, entry.install.folder, entry.install.check);
  const folder = join(places.claudeConfig, 'skills');
  if (cli.installed) log.write(`Skills: each counts as installed once ${join(folder, '<name>', 'SKILL.md')} is there`);

  /** @type {[string, string][]} */
  const rows = [];
  for (const { source, names } of sources) {
    // A source with no names is the path to a single skill, which is named by its last part.
    const skills = names ?? [source.split('/').at(-1) ?? source];
    let ran;
    if (cli.installed && program) {
      ui.step(`Installing ${skills.length === 1 ? 'the skill' : `${skills.length} skills`} from ${source}`);
      const commit = manifest.skillSources[source.split('/').slice(0, 2).join('/')];
      const args = ['add', commit ? `${source}#${commit}` : source, '-g', '-a', 'claude-code', '-y', ...(names ? ['-s', ...names] : [])];
      ran = await machine.run(program, args);
    }
    for (const name of skills) {
      let value;
      // Kept short: skill names make the label column wide, and clack wraps long rows.
      if (!ran) value = "Not installed: the skills CLI isn't installed";
      else if (ran.code !== 0) value = `Not installed: its installer stopped (code ${ran.code})`;
      else if (!(await exists(join(folder, name, 'SKILL.md')))) value = "Not installed: it didn't arrive";
      else value = 'Installed';
      log.write(`Skills: ${name} from ${source}: ${value}`);
      rows.push([`/${name}`, value]);
    }
  }
  const installed = rows.filter(([, value]) => value === 'Installed').length;
  const line =
    installed === rows.length ? `All ${rows.length} installed`
    : installed === 0 ? 'None installed'
    : `${installed} of ${rows.length} installed`;
  return { cli: cli.row, rows, line };
}
