#!/usr/bin/env node
// Renders the setup page once per profile from page/template.html, filling in that
// profile's pastedLine, shareLogLine (and the script address inside each, for the "See what this
// runs" links), top workspace's name, connectors, the sentence saying where to send the log and
// the wording in its `setupPage` (where workspaces are, why T3 Code, privacy), plus the skills
// in page/skills.json with each one's text (from page/skill-texts, which
// page/fetch-skill-texts.js fills) and the screenshots in page/screenshots (as data addresses, so
// each page is one file), and checks each page shows its own line to paste exactly once.
//
//   node page/build.js [<folder>]       write <folder>/<profile>/index.html (default: dist/page)
//   node page/build.js --publish        render, then publish each page as a public Portall
//                                       item named after its profile's page address
//
// Each profile's `page` is the address its item ends up at, so https://jumpstart-york.portall.dev/
// is published as the item `jumpstart-york`.
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { skillNames } from '../installer/src/profile.js';
import { ownSource, skillTextHtml } from './skill-texts.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
/** Each placeholder, and where in a profile its text is (`workspaces.top` is the key `top` inside `workspaces`). */
const fields = {
  pastedLine: 'pastedLine',
  shareLogLine: 'shareLogLine',
  logGoesTo: 'logGoesTo',
  topWorkspace: 'workspaces.top',
  connectorsPage: 'connectorsPage',
  workspacesHeading: 'setupPage.workspaces.heading',
  workspacesText: 'setupPage.workspaces.text',
};
/** The screenshots, by placeholder: the files in page/screenshots that the page shows. */
const screenshots = { t3Layout: 't3-layout.png', t3NewWorkspace: 't3-new-workspace.png' };
/** The `setupPage` keys that hold a list of paragraphs. */
const paragraphs = { whyT3Code: 'setupPage.whyT3Code', privacy: 'setupPage.privacy' };

/** The draft a profile's `logEmail` link opens: who it's to is filled in after "Hi". */
const supportEmail = {
  subject: 'Jumpstart Support',
  /** @param {string} name */
  body: (name) =>
    [
      `Hi ${name},`,
      '',
      'I have encountered a problem while going through the Jumpstart setup process.',
      '',
      'Installer logs',
      '```text',
      'Delete this line and paste the installer logs here (Ctrl+V).',
      '```',
      '',
    ].join('\n'),
};

const { values, positionals } = parseArgs({ options: { publish: { type: 'boolean', default: false } }, allowPositionals: true });
const out = positionals[0] ?? join(repo, 'dist', 'page');

/** @param {string} text */
const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * A profile's wording as HTML: escaped, with `**words**` in bold and `[words](address)` as a link
 * that opens in a new tab.
 * @param {string} text
 */
const inline = (text) =>
  escape(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

/** @param {string} id @param {string} key @param {unknown} list @returns {string} each item as a paragraph */
function paragraphsOf(id, key, list) {
  if (!Array.isArray(list) || list.length === 0 || !list.every((item) => typeof item === 'string' && item !== '')) {
    fail(`profiles/${id}.json needs "${key}", a list of paragraphs, for its setup page.`);
  }
  return list.map((item) => `          <p>${inline(item)}</p>`).join('\n');
}

/**
 * The connectors' rows, as the installer offers them: each name and what it lets the agent do.
 * @param {string} id @param {unknown} connectors
 */
function connectorRows(id, connectors) {
  if (!Array.isArray(connectors) || !connectors.every((one) => typeof one?.name === 'string' && typeof one?.what === 'string')) {
    fail(`profiles/${id}.json needs "connectors", each with a "name" and "what", for its setup page.`);
  }
  return connectors.map((one) => `            <b>${escape(one.name)}</b><span>${escape(one.what)}</span>`).join('\n');
}

/**
 * The names of the skills a profile installs, named as the Installer names them.
 * @param {unknown} skills
 */
function installedSkills(skills) {
  if (!Array.isArray(skills)) return new Set();
  return new Set(skills.flatMap((source) => skillNames({ source: String(source?.source), names: source?.names })));
}

/**
 * @typedef {{ name: string, line: string, source: string, about?: string, runs?: string[] }} Skill
 * One skill on the page, from page/skills.json. `source` is its SKILL.md on GitHub, `about` the
 * page that says more about it (AI Hero's, for Matt Pocock's skills), and `runs` the skills its
 * text only hands over to, whose texts its box shows too.
 */

/**
 * The skills under their headings, each name a button that opens the box with the skill's text.
 * Fails if the page lists a skill the profile doesn't install.
 * @param {string} id @param {Record<string, Skill[]>} skills
 * @param {Set<string>} installed
 */
function skillGroups(id, skills, installed) {
  return Object.entries(skills)
    .map(([heading, list]) => {
      const rows = list.map((skill) => {
        if (!installed.has(skill.name)) fail(`page/skills.json lists /${skill.name}, which profiles/${id}.json doesn't install.`);
        return `            <button type="button" data-skill="${escape(skill.name)}" aria-haspopup="dialog">/${escape(skill.name)}</button><span>${escape(skill.line)}</span>`;
      });
      return `          <h3>${escape(heading)}</h3>\n          <div class="rows skills">\n${rows.join('\n')}\n          </div>`;
    })
    .join('\n');
}

/** @param {string[]} names @returns {string} HTML: "/a", "/a and /b", "/a, /b and /c" */
const listOf = (names) =>
  names
    .map((name) => `<code>/${escape(name)}</code>`)
    .join(', ')
    .replace(/, ([^,]*)$/, ' and $1');

/**
 * Each skill's box: its text as the agent reads it, the text of any skill it only hands over to,
 * and a link to read more (AI Hero's page for Matt Pocock's skills, the skill's source otherwise).
 * @param {Record<string, Skill[]>} skills @param {Record<string, string>} texts each skill's text, as HTML
 * @returns {string}
 */
function skillBoxes(skills, texts) {
  const all = Object.values(skills).flat();
  const names = new Set(all.map((skill) => skill.name));
  return all
    .map((skill) => {
      const name = escape(skill.name);
      const runs = (skill.runs ?? []).map((other) => {
        if (!names.has(other)) fail(`page/skills.json says /${skill.name} runs /${other}, which isn't on the page.`);
        return `        <h3 class="skill-runs">/${escape(other)}</h3>\n        <div class="skill-text">\n${texts[other]}\n        </div>`;
      });
      const handsOver = runs.length
        ? `\n        <p class="skill-note">All <code>/${name}</code> does is hand over to ${listOf(skill.runs ?? [])}, so ${runs.length === 1 ? 'its text is' : 'their texts are'} below.</p>\n${runs.join('\n')}`
        : '';
      const more = skill.about
        ? `<a href="${escape(skill.about)}" target="_blank" rel="noopener">Matt Pocock on /${name}, at AI Hero</a>`
        : `<a href="${escape(skill.source)}" target="_blank" rel="noopener">/${name}'s source, on GitHub</a>`;
      return [
        `    <dialog class="skill" id="skill-${name}" aria-labelledby="skill-${name}-name" closedby="any">`,
        `      <div class="skill-head">`,
        `        <div><h2 id="skill-${name}-name">/${name}</h2><p>${escape(skill.line)}</p></div>`,
        `        <form method="dialog"><button class="skill-close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></form>`,
        `      </div>`,
        `      <div class="skill-body" tabindex="-1" autofocus>`,
        `        <p class="skill-note">This is what your agent follows when you type <code>/${name}</code>. It's written to the agent, so "you" is your agent and "the user" is you.</p>`,
        `        <div class="skill-text">\n${texts[skill.name]}\n        </div>${handsOver}`,
        `      </div>`,
        `      <p class="skill-foot">${more}</p>`,
        `    </dialog>`,
      ].join('\n');
    })
    .join('\n');
}

/**
 * Each skill's text, as HTML: its copy in page/skill-texts or, for one of this repository's own
 * skills, its SKILL.md where it is.
 * @param {Record<string, Skill[]>} skills
 * @returns {Promise<Record<string, string>>}
 */
async function skillTexts(skills) {
  /** @type {Record<string, string>} */
  const texts = {};
  for (const skill of Object.values(skills).flat()) {
    const own = ownSource(skill.source);
    const file = own ? join(repo, own) : join(repo, 'page', 'skill-texts', `${skill.name}.md`);
    const markdown = await readFile(file, 'utf8').catch(() => undefined);
    if (markdown === undefined) fail(`/${skill.name} has no text at ${file}. Run node page/fetch-skill-texts.js to copy the skills' texts.`);
    texts[skill.name] = skillTextHtml(markdown, skill.source);
  }
  return texts;
}

/**
 * The sentence after the share-log box. With a `logEmail` it links to a Gmail draft to that
 * address with the support email filled in (the profiles' people use Gmail, which a mailto link
 * wouldn't open on a laptop with no mail app set up); without one, it names who to send it to.
 * @param {string} logGoesTo @param {unknown} logEmail @returns {string} HTML
 */
function sendTheLog(logGoesTo, logEmail) {
  if (typeof logEmail !== 'string' || logEmail === '') {
    return `Then paste the log into a message (Ctrl+V) and send it to <strong>${escape(logGoesTo)}</strong>.`;
  }
  const draft = new URLSearchParams({ view: 'cm', fs: '1', to: logEmail, su: supportEmail.subject, body: supportEmail.body(logGoesTo) });
  const href = `https://mail.google.com/mail/?${draft.toString().replace(/\+/g, '%20')}`;
  return `Then <a href="${escape(href)}" target="_blank" rel="noopener">email it to ${escape(logGoesTo)}</a> at ${escape(logEmail)}. The email opens ready to send: paste the log (Ctrl+V) where it says, then send it.`;
}

/**
 * The address inside a pasted `irm <address> | iex` line: where "See what this runs" goes.
 * @param {string} line @param {string} id @param {string} key
 */
function scriptAddress(line, id, key) {
  const address = line.match(/^irm (\S+) \| iex$/)?.[1];
  if (!address) fail(`profiles/${id}.json: "${key}" must look like "irm <address> | iex", so the page can link to its script.`);
  return address;
}

/**
 * @param {Record<string, unknown>} profile
 * @param {string} key a dotted path, such as `workspaces.top`
 * @returns {unknown}
 */
const lookUp = (profile, key) => key.split('.').reduce((/** @type {any} */ inside, part) => inside?.[part], profile);

/** @param {string} haystack @param {string} needle */
const count = (haystack, needle) => haystack.split(needle).length - 1;

/** @param {string} message @returns {never} */
function fail(message) {
  console.error(message);
  process.exit(1);
}

/**
 * @param {string} template
 * @param {string} id
 * @param {Record<string, unknown>} profile
 * @param {string[]} otherLines every other profile's pasted line, none of which may appear
 * @param {Record<string, Skill[]>} skills page/skills.json
 * @param {string} boxes every skill's box, which goes in the page after its checks: a skill's text is
 *   its author's, so it may say what the page's own text mustn't
 * @param {Record<string, string>} shots each screenshot's placeholder and its data address
 */
function render(template, id, profile, otherLines, skills, boxes, shots) {
  /** @type {Record<string, string>} */
  const filled = {};
  for (const [field, key] of Object.entries(fields)) {
    const value = lookUp(profile, key);
    if (typeof value !== 'string' || value === '') fail(`profiles/${id}.json needs "${key}" for its setup page.`);
    filled[field] = value;
  }
  /** @type {Record<string, string>} each placeholder's HTML */
  const html = {
    sendTheLog: sendTheLog(filled.logGoesTo, profile.logEmail),
    pastedUrl: escape(scriptAddress(filled.pastedLine, id, 'pastedLine')),
    shareLogUrl: escape(scriptAddress(filled.shareLogLine, id, 'shareLogLine')),
    whereWorkspacesAre: `          <p><strong>${escape(filled.workspacesHeading)}</strong> ${inline(filled.workspacesText)}</p>`,
    connectorRows: connectorRows(id, profile.connectors),
    skills: skillGroups(id, skills, installedSkills(profile.skills)),
    ...shots,
  };
  for (const [field, key] of Object.entries(paragraphs)) html[field] = paragraphsOf(id, key, lookUp(profile, key));
  for (const [field, value] of Object.entries(filled)) html[field] = escape(value);
  const page = template.replace(/\{\{(\w+)\}\}/g, (whole, name) => html[name] ?? whole);
  const left = page.match(/\{\{\w+\}\}/);
  if (left) fail(`page/template.html has ${left[0]}, which no profile fills.`);
  if (count(page, escape(filled.pastedLine)) !== 1) fail(`The ${id} page must show its line to paste exactly once.`);
  if (count(page, escape(filled.shareLogLine)) !== 1) fail(`The ${id} page must show the share-log line exactly once.`);
  for (const other of otherLines) {
    if (other !== filled.pastedLine && page.includes(escape(other))) fail(`The ${id} page shows another profile's line: ${other}`);
  }
  if (count(page, '<!-- skill texts -->') !== 1) fail('page/template.html needs <!-- skill texts --> once, where the skills\' boxes go.');
  return page.replace('<!-- skill texts -->', () => `<!-- skill texts -->\n${boxes}\n    <!-- end of skill texts -->`);
}

const template = await readFile(join(repo, 'page', 'template.html'), 'utf8');
const skills = JSON.parse(await readFile(join(repo, 'page', 'skills.json'), 'utf8'));
const boxes = skillBoxes(skills, await skillTexts(skills));
/** @type {Record<string, string>} */
const shots = {};
for (const [field, file] of Object.entries(screenshots)) {
  shots[field] = `data:image/png;base64,${(await readFile(join(repo, 'page', 'screenshots', file))).toString('base64')}`;
}
const ids = (await readdir(join(repo, 'profiles'))).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5)).sort();
/** @type {Record<string, Record<string, unknown>>} */
const profiles = {};
for (const id of ids) profiles[id] = JSON.parse(await readFile(join(repo, 'profiles', `${id}.json`), 'utf8'));
const allLines = ids.map((id) => profiles[id].pastedLine).filter((line) => typeof line === 'string');

await rm(out, { recursive: true, force: true });
for (const id of ids) {
  const folder = join(out, id);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'index.html'), render(template, id, profiles[id], allLines, skills, boxes, shots));
}
console.log(`Rendered the setup page for ${ids.join(', ')} into ${out}`);

// Jumpstart's page templates are published with every profile's site, at <page>jumpstart/<name>,
// so the skill's small pages can load them (docs/adr/0001). Their source is beside the skill.
const jumpstartTemplates = ['writing-picker.js', 'review-page.js'];
for (const id of ids) {
  await mkdir(join(out, id, 'jumpstart'), { recursive: true });
  for (const name of jumpstartTemplates) await copyFile(join(repo, 'skills', 'jumpstart', name), join(out, id, 'jumpstart', name));
}

if (values.publish) {
  for (const id of ids) {
    const page = profiles[id].page;
    if (typeof page !== 'string') fail(`profiles/${id}.json needs a "page" address.`);
    const item = new URL(page).hostname.split('.')[0];
    // portall is a .cmd on Windows, so it needs a shell; the arguments are quoted for it.
    const result = spawnSync(`portall publish "${join(out, id)}" --item ${item} --public`, {
      shell: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    process.stdout.write(result.stdout ?? '');
    if (result.status !== 0) fail(`Publishing the ${id} page failed.`);
    if (!result.stdout.includes(page)) {
      fail(`The ${id} page was published, but not at ${page}, the address in profiles/${id}.json. Use the address portall printed in the profile.`);
    }
  }
}
