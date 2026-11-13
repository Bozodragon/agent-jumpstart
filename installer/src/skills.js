// Installs the profile's skills for Claude Code with the skills CLI. The CLI is pinned like
// clasp: its npm package, checked against the manifest's checksum and installed per user into
// a folder of its own (off the user PATH: only the installer runs it), and run with the
// installer's own Node and the bin script the package names, never through skills.cmd, which
// would run whichever node is first on PATH. Then, per source, with the flags that stop it
// asking anything:
//
//   <installer's node> <folder>\node_modules\skills\<bin script> add <source> -g -a claude-code -y [-s <name> ...]
//
// Skill sources aren't pinned: each is added from its default branch, as the profile gives it.
// So that a re-run doesn't download every source again, each source's default branch is looked
// up first with `git ls-remote <repository> HEAD` (one small request), and the commit it was
// installed from is kept in the settings file's `skillSources`. On a re-run, a source still at
// that commit, with every skill it brings still in Claude's skills folder, isn't added again; one
// that has changed, was never recorded, or couldn't be looked up is added as on a first run.
// -a claude-code is always given: with -y alone the CLI installs to every agent it knows. -s
// comes last because it takes every word after it. The CLI clones public sources with Git, so
// it runs after the tools, and needs no GitHub account; with no Git on the machine or user PATH
// it isn't run at all, and each skill's row says Git is needed.
//
// A skill already in Claude's skills folder is the person's and is left exactly as it is, unless
// this installer put it there on an earlier run (the settings file's `skillsInstalled`): those
// are added again, which updates them. A skill counts as installed only if it is in Claude's
// skills folder afterwards: the CLI's exit code alone isn't trusted.
import { join } from 'node:path';
import { loadManifest, toolEntry } from './manifest.js';
import { skillNames } from './profile.js';
import { exists, installTool } from './tools.js';

const leftAlone = 'Already there, left as it is';
const upToDate = 'Up to date';

/**
 * @param {import('./profile.js').Profile} profile
 * @param {string[]} ours The skills an earlier run installed (the settings file's `skillsInstalled`).
 * @param {Record<string, string>} installedFrom The commit an earlier run installed each source
 *   from (the settings file's `skillSources`).
 * @param {import('./tools.js').Context} context
 * @returns {Promise<{ cli?: string, rows: [string, string][], line: string, installed: string[], sources: Record<string, string> }>}
 *   The checklist's Skills CLI row, when the profile has skills; one row per skill, labelled as
 *   the person types it, for the Skills summary; the checklist's Skills line; the skills this
 *   run installed; and the commit each source's skills are now from, where that's known.
 */
export async function installSkills(profile, ours, installedFrom, context) {
  const { places, machine, frontEnd, downloads, log } = context;
  const sources = profile.skills ?? [];
  if (sources.length === 0) return { rows: [], line: 'None in this profile', installed: [], sources: {} };

  const manifest = await loadManifest(downloads);
  const entry = toolEntry(manifest, 'skills');
  /** @type {import('./tools.js').Installed} */
  const cli = entry ? await installTool(entry, context) : { installed: false, row: 'Not installed: the list of versions has no entry for it' };
  const program = cli.installed ? cli.program : undefined;
  const folder = join(places.claudeConfig, 'skills');
  if (cli.installed) log.write(`Skills: each counts as installed once ${join(folder, '<name>', 'SKILL.md')} is there`);
  // The CLI clones each source with Git, found on the PATH it's given: the machine and user PATH.
  const git = program ? await machine.findOnPath('git.exe') : [];
  if (program && git.length === 0) log.write("Skills: no git.exe on the machine or user PATH, so the skills CLI isn't run");

  const named = sources.map(({ source, names }) => ({ source, names, skills: skillNames({ source, names }) }));
  // Looked at before any source is added, so a skill one source brings isn't taken for theirs.
  /** @type {string[]} */
  const theirs = [];
  for (const name of named.flatMap(({ skills }) => skills)) if (!ours.includes(name) && (await exists(join(folder, name)))) theirs.push(name);

  // Where each source's default branch is now, looked up before anything is downloaded, so
  // what's recorded is never newer than what came.
  /** @type {Map<string, string | undefined>} */
  const latest = new Map();
  const toLookUp = program && git.length > 0 ? named.filter(({ skills }) => skills.some((name) => !theirs.includes(name))) : [];
  if (toLookUp.length > 0) {
    await frontEnd.busy(
      'Checking the skill sources for changes',
      async () => {
        for (const { source } of toLookUp) latest.set(source, await latestCommit(source, join(git[0], 'git.exe'), context));
      },
      () => ({ text: 'Checked the skill sources for changes', ok: true }),
    );
  }

  /** @type {[string, string][]} */
  const rows = [];
  /** @type {string[]} */
  const installed = [];
  /** @type {Record<string, string>} */
  const recorded = {};
  for (const { source, names, skills } of named) {
    const wanted = skills.filter((name) => !theirs.includes(name));
    const commit = latest.get(source);
    const before = installedFrom[source];
    let unchanged = false;
    if (commit !== undefined && commit === before) {
      unchanged = (await Promise.all(wanted.map((name) => exists(join(folder, name, 'SKILL.md'))))).every(Boolean);
      log.write(`Skills: ${source} is still at ${commit}, as last time, ${unchanged ? "so it isn't downloaded again" : 'but one of its skills has gone, so it is added again'}`);
    } else if (commit !== undefined) {
      log.write(`Skills: ${source} is at ${commit}${before === undefined ? '' : `, changed since last time (${before})`}`);
    }
    let ran;
    if (program && git.length > 0 && wanted.length > 0 && !unchanged) {
      const args = ['add', source, '-g', '-a', 'claude-code', '-y', ...(names ? ['-s', ...wanted] : [])];
      const what = `${wanted.length === 1 ? 'the skill' : `${wanted.length} skills`} from ${source}`;
      ran = await frontEnd.busy(`Installing ${what}`, () => machine.run(program.file, [...program.args, ...args]), ({ code }) =>
        code === 0 ? { text: `Installed ${what}`, ok: true } : { text: `Couldn't install ${what}`, ok: false },
      );
    }
    for (const name of skills) {
      let value;
      // Kept short: skill names make the label column wide, and clack wraps long rows.
      if (theirs.includes(name)) value = leftAlone;
      else if (unchanged) value = upToDate;
      else if (!program) value = "Not installed: the skills CLI isn't installed";
      else if (!ran) value = "Not installed: Git is needed and isn't installed";
      else if (ran.code !== 0) value = `Not installed: its installer stopped (code ${ran.code})`;
      else if (!(await exists(join(folder, name, 'SKILL.md')))) value = "Not installed: it didn't arrive";
      else value = 'Installed';
      log.write(`Skills: ${name} from ${source}: ${value === leftAlone ? `already in ${join(folder, name)} and not put there by this installer, so left as it is` : value}`);
      rows.push([`/${name}`, value]);
      if (value === 'Installed') installed.push(name);
    }
    // A source is recorded once every skill it brings is there, from a known commit. One that
    // wasn't run at all this time (no Git, or all its skills theirs) keeps what was recorded.
    if (unchanged && commit !== undefined) recorded[source] = commit;
    else if (ran && commit !== undefined && wanted.every((name) => installed.includes(name))) recorded[source] = commit;
    else if (!ran && before !== undefined) recorded[source] = before;
  }
  return { cli: cli.row, rows, line: lineFor(rows), installed, sources: recorded };
}

/**
 * The commit a source's default branch is at, from `git ls-remote <repository> HEAD`, or
 * undefined when that can't be told: no network, or a source that isn't GitHub's `owner/repo[/path]`.
 * @param {string} source @param {string} git @param {import('./tools.js').Context} context
 * @returns {Promise<string | undefined>}
 */
async function latestCommit(source, git, { machine, log }) {
  const [owner, repository] = source.split('/');
  if (!owner || !repository || /[:\\@]/.test(source)) {
    log.write(`Skills: ${source} isn't a GitHub owner/repository, so whether it has changed can't be checked`);
    return undefined;
  }
  const { code, output } = await machine.run(git, ['ls-remote', `https://github.com/${owner}/${repository}.git`, 'HEAD']);
  const commit = code === 0 ? /^([0-9a-f]{40,64})\s+HEAD\s*$/m.exec(output)?.[1] : undefined;
  if (commit === undefined) log.write(`Skills: couldn't look up where ${source} is now, so it's added as on a first run`);
  return commit;
}

/** @param {[string, string][]} rows */
function lineFor(rows) {
  /** @param {string} wanted */
  const count = (wanted) => rows.filter(([, value]) => value === wanted).length;
  const total = rows.length;
  const installed = count('Installed');
  // The skills that are there but weren't installed this time, by why.
  const others = /** @type {[number, string][]} */ ([
    [count(upToDate), 'up to date'],
    [count(leftAlone), 'already there'],
  ]).filter(([n]) => n > 0);
  const there = installed + others.reduce((sum, [n]) => sum + n, 0);
  const parts = others.map(([n, why]) => `${n} ${why}`);
  if (installed === total) return `All ${total} installed`;
  if (there === 0) return 'None installed';
  if (there < total) return [`${installed} of ${total} installed`, ...parts].join(', ');
  if (installed === 0 && others.length === 1) return `All ${total} ${others[0][1]}`;
  return `All ${total} there: ${[...(installed > 0 ? [`${installed} installed`] : []), ...parts].join(', ')}`;
}
