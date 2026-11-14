// The lock that says an Installer is running, which the Bootstrap reads before it starts another
// (see places.js's `pageAddress`): its first line is the Installer page's address, empty for a
// run kept in the window, and its second the Installer's process id. Written and removed only here.
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Writes a file under another name and renames it, so whoever looks for it (the Bootstrap, a
 * test) never reads it empty or half-written.
 * @param {string} path @param {string} text
 */
export async function writeWhole(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const writing = `${path}.${process.pid}.partial`;
  await writeFile(writing, text);
  await rename(writing, path);
}

/**
 * Takes the lock for this process, with the page's address, if it has one.
 * @param {string} file @param {string} [address] none for a run kept in the window
 * @returns {Promise<{ release: () => Promise<void> }>} `release` removes it, as the run ends
 */
export async function holdLock(file, address = '') {
  await writeWhole(file, `${address}\n${process.pid}\n`);
  return { release: () => rm(file, { force: true }) };
}
