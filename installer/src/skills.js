// Installs the profile's skills for Claude Code with the skills CLI, pinned in the manifest and
// run through npx, with the flags that stop it asking anything:
//
//   npx -y <cli>@<version> add <source> -g -a claude-code -y [-s <name> ...]
//
// -a claude-code is always given: with -y alone the CLI installs to every agent it knows.
// -s comes last because it takes every word after it. The CLI clones public sources with Git,
// so it runs after the tools, and needs no GitHub account.
//
// A skill counts as installed only if it is in Claude's skills folder afterwards: the CLI's
// exit code alone isn't trusted.
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { loadManifest } from './manifest.js';
import * as ui from './ui.js';

/**
 * @param {import('./profile.js').Profile} profile
 * @param {{ places: import('./places.js').Places, machine: import('./machine.js').Machine, downloads?: string, log: { write(line: string): void } }} context
 * @returns {Promise<{ rows: [string, string][], line: string }>} One row per skill, labelled as the
 *   person types it, for the Skills summary; and the checklist's Skills line.
 */
export async function installSkills(profile, { places, machine, downloads, log }) {
  const { skillsCli } = await loadManifest(downloads);
  const cli = `${skillsCli.package}@${skillsCli.version}`;
  const folder = join(places.claudeConfig, 'skills');
  if (profile.skills?.length) log.write(`Skills: each counts as installed once ${join(folder, '<name>', 'SKILL.md')} is there`);
  /** @type {[string, string][]} */
  const rows = [];
  for (const { source, names } of profile.skills ?? []) {
    // A source with no names is the path to a single skill, which is named by its last part.
    const skills = names ?? [source.split('/').at(-1) ?? source];
    ui.step(`Installing ${skills.length === 1 ? 'the skill' : `${skills.length} skills`} from ${source}`);
    const args = ['-y', cli, 'add', source, '-g', '-a', 'claude-code', '-y', ...(names ? ['-s', ...names] : [])];
    log.write(`Skills: running npx.cmd ${args.join(' ')}`);
    // The .cmd, not npx.ps1, which a locked-down execution policy blocks.
    const ran = await machine.run('npx.cmd', args);
    if (ran.output.trim()) log.write(`Skills: output from ${source}:\n${ran.output.trim()}`);
    for (const name of skills) {
      let value;
      // Kept short: skill names make the label column wide, and clack wraps long rows.
      if (ran.code !== 0) value = `Not installed: its installer stopped (code ${ran.code})`;
      else if (!(await exists(join(folder, name, 'SKILL.md')))) value = "Not installed: it didn't arrive";
      else value = 'Installed';
      log.write(`Skills: ${name} from ${source}: ${value}`);
      rows.push([`/${name}`, value]);
    }
  }
  const installed = rows.filter(([, value]) => value === 'Installed').length;
  const line =
    rows.length === 0 ? 'None in this profile'
    : installed === rows.length ? `All ${rows.length} installed`
    : installed === 0 ? 'None installed'
    : `${installed} of ${rows.length} installed`;
  return { rows, line };
}

/** @param {string} path */
const exists = (path) => access(path).then(() => true, () => false);
