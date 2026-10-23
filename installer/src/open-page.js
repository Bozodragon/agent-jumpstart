import { spawn } from 'node:child_process';

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
