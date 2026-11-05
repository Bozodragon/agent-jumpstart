#!/usr/bin/env node
// Copies each skill's text into page/skill-texts/<name>.md, so the setup page can show it
// without the reader leaving the page, and the build needs no network. The text is the
// skill's SKILL.md, from the `source` page/skills.json gives it: the default branch of the
// repository the profiles install it from, which is what the installer installs. A skill
// whose source is in this repository isn't copied: the build reads it where it is.
//
//   node page/fetch-skill-texts.js      run by `npm run publish:page` before the build, and by
//                                       hand after a change to page/skills.json
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownSource, rawAddress } from './skill-texts.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const folder = join(repo, 'page', 'skill-texts');

/** @type {Record<string, { name: string, source: string }[]>} */
const groups = JSON.parse(await readFile(join(repo, 'page', 'skills.json'), 'utf8'));
const skills = Object.values(groups).flat();

await mkdir(folder, { recursive: true });
const kept = new Set();
for (const { name, source } of skills) {
  if (ownSource(source)) continue;
  const response = await fetch(rawAddress(source));
  if (!response.ok) {
    console.error(`/${name}'s text couldn't be fetched from ${rawAddress(source)}: ${response.status} ${response.statusText}`);
    process.exit(1);
  }
  await writeFile(join(folder, `${name}.md`), (await response.text()).replace(/\r\n/g, '\n'));
  kept.add(`${name}.md`);
}
// A skill taken off the page takes its copy with it.
for (const file of await readdir(folder)) if (!kept.has(file)) await rm(join(folder, file));
console.log(`Copied ${kept.size} skills' texts into ${folder}`);
