#!/usr/bin/env node
// Renders the setup page once per profile from page/template.html, filling in that
// profile's pastedLine, shareLogLine, logGoesTo and top workspace's name, and checks each
// page shows its own line to paste exactly once.
//
//   node page/build.js [<folder>]       write <folder>/<profile>/index.html (default: dist/page)
//   node page/build.js --publish        render, then publish each page as a public Portall
//                                       item named after its profile's page address
//
// Each profile's `page` is the address its item ends up at, so https://jumpstart-york.arcforge.uk/
// is published as the item `jumpstart-york`.
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repo = fileURLToPath(new URL('..', import.meta.url));
/** Each placeholder, and where in a profile its text is (`workspaces.top` is the key `top` inside `workspaces`). */
const fields = { pastedLine: 'pastedLine', shareLogLine: 'shareLogLine', logGoesTo: 'logGoesTo', topWorkspace: 'workspaces.top' };

const { values, positionals } = parseArgs({ options: { publish: { type: 'boolean', default: false } }, allowPositionals: true });
const out = positionals[0] ?? join(repo, 'dist', 'page');

/** @param {string} text */
const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
 */
function render(template, id, profile, otherLines) {
  /** @type {Record<string, string>} */
  const filled = {};
  for (const [field, key] of Object.entries(fields)) {
    /** @type {unknown} */
    const value = key.split('.').reduce((/** @type {any} */ inside, part) => inside?.[part], profile);
    if (typeof value !== 'string' || value === '') fail(`profiles/${id}.json needs "${key}" for its setup page.`);
    filled[field] = value;
  }
  const html = template.replace(/\{\{(\w+)\}\}/g, (whole, name) => (name in filled ? escape(filled[name]) : whole));
  const left = html.match(/\{\{\w+\}\}/);
  if (left) fail(`page/template.html has ${left[0]}, which no profile fills.`);
  if (count(html, escape(filled.pastedLine)) !== 1) fail(`The ${id} page must show its line to paste exactly once.`);
  if (count(html, escape(filled.shareLogLine)) !== 1) fail(`The ${id} page must show the share-log line exactly once.`);
  for (const other of otherLines) {
    if (other !== filled.pastedLine && html.includes(escape(other))) fail(`The ${id} page shows another profile's line: ${other}`);
  }
  return html;
}

const template = await readFile(join(repo, 'page', 'template.html'), 'utf8');
const ids = (await readdir(join(repo, 'profiles'))).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5)).sort();
/** @type {Record<string, Record<string, unknown>>} */
const profiles = {};
for (const id of ids) profiles[id] = JSON.parse(await readFile(join(repo, 'profiles', `${id}.json`), 'utf8'));
const allLines = ids.map((id) => profiles[id].pastedLine).filter((line) => typeof line === 'string');

await rm(out, { recursive: true, force: true });
for (const id of ids) {
  const folder = join(out, id);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'index.html'), render(template, id, profiles[id], allLines));
}
console.log(`Rendered the setup page for ${ids.join(', ')} into ${out}`);

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
