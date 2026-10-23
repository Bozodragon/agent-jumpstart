import { spawn } from 'node:child_process';
import { messageOf } from './stop.js';

/**
 * Opens an address in the person's default browser without waiting for it.
 * @param {string} url
 * @returns {Promise<void>} Rejects if the browser couldn't be started.
 */
export function openPage(url) {
  return new Promise((resolve, reject) => {
    const child = spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * Opens an address if it can, without stopping the run if it can't.
 * @param {string} url
 * @returns {Promise<string>} What happened, for the log.
 */
export async function tryToOpen(url) {
  try {
    await openPage(url);
    return 'opened';
  } catch (error) {
    return `couldn't open: ${messageOf(error)}`;
  }
}
