// What the log holds of the programs the installer runs: every program in a debug run, and a
// program that failed in every run, each written once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeMachine, fileName, makeHome, readOnlyLog, runWith, supplyDownloads } from './harness.js';

/** @param {string} text @param {string} part */
const timesIn = (text, part) => text.split(part).length - 1;

/**
 * A laptop whose Git installer is refused, saying why.
 * @param {import('node:test').TestContext} t
 */
async function gitRefused(t) {
  const where = await makeHome(t);
  const manifest = await supplyDownloads(where, ['git']);
  const git = manifest.tools.find((/** @type {any} */ tool) => tool.id === 'git');
  const installer = fileName(git.downloads[process.arch].url);
  await fakeMachine(where.home).setReplies({ [installer]: { code: 5, output: 'Setup was blocked by your administrator' } });
  return { where, installer };
}

for (const mode of ['an ordinary', 'a debug']) {
  test(`${mode} run logs a program that failed once, with its exit code and output`, async (t) => {
    const { where, installer } = await gitRefused(t);

    const result = await runWith(where, 'york', mode === 'a debug' ? ['--debug'] : []);

    assert.equal(result.code, 0, result.stdout + result.stderr);
    const { text } = await readOnlyLog(where.home);
    assert.equal(timesIn(text, 'Setup was blocked by your administrator'), 1, text);
    assert.match(text, new RegExp(`Ran: ${installer.replaceAll('.', '\\.')} \\(code 5\\)`));
  });
}
