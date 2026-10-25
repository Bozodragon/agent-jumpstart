// Finds T3 Code's current build on a channel and checks a download of it. T3 isn't pinned: the
// installer follows T3's own release feed (the file its in-app updater reads), which names the
// current build and its SHA-512, so the download is checked against the hash T3 published.
// Stable's feed has a fixed address; nightly has none, so the newest nightly tag comes from the
// GitHub API.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { messageOf } from './stop.js';
import { NotInstalled } from './tools.js';

/**
 * @param {import('./manifest.js').T3Entry} entry @param {import('./manifest.js').T3Channel} where
 * @param {{ downloads?: string, say: (line: string) => void }} how
 * @returns {Promise<{ version: string, url: string, sha512: string }>}
 */
export async function findRelease(entry, where, how) {
  let tag = '';
  if (where.releases) {
    const listed = JSON.parse(await fetchText(where.releases, how));
    const pattern = new RegExp(where.tag ?? '.');
    const newest = Array.isArray(listed) ? listed.find((release) => !release.draft && pattern.test(release.tag_name)) : undefined;
    if (!newest) throw new NotInstalled("GitHub didn't list a build for that channel");
    tag = newest.tag_name;
  }
  const feed = parseFeed(await fetchText(where.feed.replaceAll('{tag}', tag), how));
  const pattern = entry.files[process.arch];
  const build = pattern ? feed.files.find((file) => new RegExp(pattern).test(file.url)) : undefined;
  if (!feed.version || !build) throw new NotInstalled(`there's no build for this kind of computer (${process.arch})`);
  const url = where.download.replaceAll('{tag}', tag).replaceAll('{version}', feed.version).replaceAll('{file}', build.url);
  return { version: feed.version, url, sha512: build.sha512 };
}

/**
 * An electron-builder release feed (`latest.yml`, `nightly.yml`): the version and each
 * build's file name and Base64 SHA-512. Only those few lines are read.
 * @param {string} text
 */
function parseFeed(text) {
  const version = /^version:\s*'?([^'\s]+)'?\s*$/m.exec(text)?.[1];
  /** @type {{ url: string, sha512: string }[]} */
  const files = [];
  for (const line of text.split(/\r?\n/)) {
    const url = /^\s*-\s*url:\s*'?([^'\s]+)'?\s*$/.exec(line)?.[1];
    if (url) files.push({ url, sha512: '' });
    const sha512 = /^\s+sha512:\s*'?([^'\s]+)'?\s*$/.exec(line)?.[1];
    if (sha512 && files.length > 0) files[files.length - 1].sha512 = sha512;
  }
  return { version, files };
}

/**
 * Small files (the feed, the release list): fetched, or taken from the downloads folder
 * by the address's file name (the GitHub release list is the file `releases`).
 * @param {string} url @param {{ downloads?: string, say: (line: string) => void }} how
 */
async function fetchText(url, { downloads, say }) {
  if (downloads) {
    const file = join(downloads, basename(new URL(url).pathname));
    try {
      const text = await readFile(file, 'utf8');
      say(`taking ${file}`);
      return text;
    } catch {
      say(`${file} isn't there`);
      throw new NotInstalled('its release details were missing');
    }
  }
  say(`reading ${url}`);
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'agent-jumpstart', Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`the server said ${response.status} ${response.statusText}`);
    return await response.text();
  } catch (error) {
    const cause = error instanceof Error && error.cause ? error.cause : error;
    say(`couldn't read ${url}: ${messageOf(cause)}`);
    throw new NotInstalled("its release details couldn't be downloaded");
  }
}

/** @param {string} file @param {string} expected Base64 @param {(line: string) => void} say */
export async function checkSha512(file, expected, say) {
  const hash = createHash('sha512');
  await pipeline(createReadStream(file), hash);
  const actual = hash.digest('base64');
  if (!expected || actual !== expected) {
    say(`checksum ${actual} isn't the published ${expected || '(none)'}`);
    throw new NotInstalled("the download didn't match T3's checksum");
  }
  say('checksum matches');
}
