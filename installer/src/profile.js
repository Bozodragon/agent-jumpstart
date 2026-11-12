import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { messageOf, Stop } from './stop.js';

const profilesFolder = fileURLToPath(new URL('../../profiles/', import.meta.url));

/**
 * A profile's choices, edited in `profiles/<id>.json`.
 * @typedef {object} Profile
 * @property {string} id The file name, which is what the bootstrap passes.
 * @property {string} name
 * @property {string} page The address of this profile's setup page.
 * @property {string} [pastedLine] The one line the setup page tells a person to paste into PowerShell.
 * @property {string} [shareLogLine] The line the setup page gives for copying the newest installer log.
 * @property {string} [logGoesTo] Who the setup page says to send the log to, as it reads after "send it to".
 * @property {string} [logEmail] Their email address. With it, the setup page links to a Gmail
 *   draft to them, ready for the log; the draft's greeting uses `logGoesTo`. The log-sharing
 *   script (bootstrap/share-log.ps1) reads both from the unpacked profile to say who to send it to.
 * @property {{ workspaces: { heading: string, text: string }, whyT3Code: string[], privacy: string[] }} [setupPage]
 *   The setup page's wording for this profile, read only by `page/build.js`: where workspaces are
 *   (and why), why T3 Code, and the privacy explanation. See `page/README.md`.
 * @property {{ top: string, inGoogleDrive: boolean, defaultLocation?: string, choices: Choice[] }} workspaces
 *   `top` is the top workspace's folder name, created in the confirmed location with the chosen
 *   workspaces inside it. `defaultLocation` is the folder, within the user's profile folder,
 *   offered for workspaces when they aren't in Google Drive.
 * @property {{ softwareCenter?: string, softwareCenterOffer?: string }} [googleDrive] Under a
 *   profile whose workspaces live in Google Drive: `softwareCenter` is the name (or part of it)
 *   that the laptop's Software Center lists Google Drive under. With it, a laptop without Drive
 *   is checked for a Software Center that offers Drive, and the person is offered to install it
 *   from there; without it, that check never runs. `softwareCenterOffer` is what's said then,
 *   in the organisation's words ("York's Software Center can install it for you...").
 * @property {{ defaultModel?: string, effort?: string, codex?: boolean }} [t3] What T3 Code's
 *   settings get, just before the installer installs it and on every run for a T3 already there
 *   (only what's missing: a key the person already has keeps its value): new threads use Claude
 *   with `defaultModel`, which must be a model id T3 knows exactly (`claude-opus-5-5`; T3 quietly
 *   falls back to its own default for one it doesn't), at `effort` (such as `medium`); and
 *   `codex: false` turns T3's Codex off.
 * @property {Connector[]} connectors
 * @property {string} [connectorsPage] The address of the page where the person connects the connectors they ticked.
 * @property {{ signUpPage: string, email: string }} [github] For the person who chooses to set up
 *   GitHub: the sign-up page, and which email to sign up with, in words ("your university email address").
 * @property {ExtraTool[]} extraTools
 * @property {SkillSource[]} skills Installed with the skills CLI. A source
 *   given without names is the path to one skill (`owner/repo/path/to/skill`), named by its last part.
 * @property {Team[]} [teams] The teams the Installer's first question offers, in order. Another
 *   team isn't listed here: the Installer adds it, last, and it brings nothing.
 * @property {TeamTicks} [teamTicks] Only on the profile the rest of a run works from (see
 *   `withTeam`): what the chosen team ticked or added.
 * @property {FullSkillSet} [fullSkills] A full set of skills the person can choose to add to
 *   `skills`, kept apart from it: the setup page build and the tests read `skills` as always installed.
 */

/** @typedef {{ source: string, names?: string[] }} SkillSource */

/**
 * A team within a profile. Its connectors, extra tools and skills are in the same shape as its
 * profile's. A connector named like one of the profile's ticks that connector, and an extra tool
 * with the id of one of the profile's ticks that tool; any other is added after the profile's
 * own, ticked, so its `default` can be left out. Its skills are installed alongside the
 * profile's: those from a source the profile already lists join that source's entry.
 * @typedef {object} Team
 * @property {string} name
 * @property {(Omit<Connector, 'default'> & { default?: boolean })[]} [connectors]
 * @property {(Omit<ExtraTool, 'default'> & { default?: boolean })[]} [extraTools]
 * @property {SkillSource[]} [skills]
 */

/**
 * The names of the connectors and the ids of the extra tools a team ticked, its own additions
 * among them, which the merged profile can't otherwise tell from the profile's own defaults.
 * @typedef {{ connectors: string[], extraTools: string[] }} TeamTicks
 */

/**
 * Matt Pocock's full set of skills for writing code, offered as a choice. Both lists are skills
 * from `source`; the `beta` list is added only with the `finished` one, when the person chooses his
 * unfinished skills too. His one-offs (skills for a single setup job) aren't listed.
 * @typedef {object} FullSkillSet
 * @property {string} source Where the skills come from, as in `skills`.
 * @property {string[]} finished His finished skills.
 * @property {string[]} beta His unfinished skills.
 */

/**
 * How much of the full set a person can choose, smallest first: none of it, the finished
 * skills, or those and the unfinished ones. The answer and the settings file's `fullSkills`.
 */
export const fullSkillsSizes = /** @type {const} */ (['no', 'finished', 'beta']);

/** @typedef {typeof fullSkillsSizes[number]} FullSkills */

/**
 * Something extra the person can tick. The manifest entries whose `when` is its id are
 * installed only when it's ticked.
 * @typedef {object} ExtraTool
 * @property {string} id
 * @property {string} question
 * @property {boolean} default
 * @property {string} [signIn] Said before a tool's browser sign-in starts.
 * @property {string} [settingsPage] A page the person must change a setting on themselves.
 * @property {string} [settings] What to do on that page.
 */

/** @typedef {{ name: string, default: boolean }} Choice */

/**
 * A connector the person can tick. `what` says what it lets the agent do, in a few plain words
 * that follow its name in the connectors notice ("Gmail: search and read your email"). `note`, when
 * it's ticked, is said under the list, such as which of the service's workspaces to choose.
 * @typedef {Choice & { what?: string, note?: string }} Connector
 */

/**
 * The skills one of a profile's skill sources brings: its `names`, or, for a source that is the
 * path to one skill, its last part.
 * @param {{ source: string, names?: string[] }} source
 */
export function skillNames({ source, names }) {
  return names ?? [source.split('/').at(-1) ?? source];
}

/** The answer for a team the profile doesn't list. It's always offered, last, and brings nothing. */
export const anotherTeam = 'Another team';

/**
 * The profile the rest of the run works from: this one with the team's entries merged in, so
 * the questions, the connectors walkthrough, the extra tools' setup and the skills install need
 * no team logic of their own. Another team, or none, leaves the profile as it is.
 * @param {Profile} profile @param {string | undefined} name the chosen team
 * @returns {Profile}
 */
export function withTeam(profile, name) {
  const team = profile.teams?.find((candidate) => candidate.name === name);
  if (!team) return profile;
  const connectors = profile.connectors.map((connector) => ({ ...connector }));
  for (const entry of team.connectors ?? []) {
    const own = connectors.find((connector) => connector.name === entry.name);
    if (own) own.default = true;
    else connectors.push({ ...entry, default: true });
  }
  const extraTools = profile.extraTools.map((tool) => ({ ...tool }));
  for (const entry of team.extraTools ?? []) {
    const own = extraTools.find((tool) => tool.id === entry.id);
    if (own) own.default = true;
    else extraTools.push({ ...entry, default: true });
  }
  // Each source still gets one add, one lookup and one recorded commit.
  const skills = (profile.skills ?? []).map((source) => ({ ...source }));
  for (const entry of team.skills ?? []) {
    const own = skills.find((source) => source.source === entry.source);
    if (!own) skills.push({ ...entry });
    else if (own.names || entry.names) own.names = [...new Set([...skillNames(own), ...skillNames(entry)])];
  }
  const teamTicks = {
    connectors: (team.connectors ?? []).map((connector) => connector.name),
    extraTools: (team.extraTools ?? []).map((tool) => tool.id),
  };
  return { ...profile, connectors, extraTools, skills, teamTicks };
}

/**
 * The profile with the full skill set the person chose merged into its skills: into the entry
 * for the set's source, so that source is still added, looked up and recorded once, or as a new
 * entry if the profile doesn't list that source. `no` leaves the profile as it is.
 * @param {Profile} profile
 * @param {FullSkills} chosen
 * @returns {Profile}
 */
export function withFullSkills(profile, chosen) {
  const set = profile.fullSkills;
  if (chosen === 'no' || !set) return profile;
  const added = [...set.finished, ...(chosen === 'beta' ? set.beta : [])];
  const skills = profile.skills ?? [];
  const entry = skills.find(({ source }) => source === set.source);
  if (!entry) return { ...profile, skills: [...skills, { source: set.source, names: added }] };
  const names = [...new Set([...skillNames(entry), ...added])];
  return { ...profile, skills: skills.map((each) => (each === entry ? { ...entry, names } : each)) };
}

/** @param {string} folder @returns {Promise<string[]>} */
async function profileIds(folder) {
  const files = await readdir(folder);
  return files.filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -'.json'.length)).sort();
}

/**
 * @param {string} id
 * @param {string} [folder] Where the profiles are: the repo's, unless a test gives its own.
 * @returns {Promise<Profile>}
 */
export async function loadProfile(id, folder = profilesFolder) {
  const ids = await profileIds(folder);
  if (!ids.includes(id)) {
    throw new Stop(`There is no profile called "${id}". The profiles are: ${ids.join(', ')}.`);
  }
  let profile;
  try {
    profile = JSON.parse(await readFile(join(folder, `${id}.json`), 'utf8'));
  } catch (error) {
    throw new Stop(`The "${id}" profile couldn't be read: ${messageOf(error)}`);
  }
  if (typeof profile.name !== 'string' || typeof profile.page !== 'string') {
    throw new Stop(`The "${id}" profile needs a name and a page address.`);
  }
  return { ...profile, id };
}
