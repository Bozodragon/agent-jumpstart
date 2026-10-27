// The pages the run sends the person to (GitHub's sign-up page, the connectors page, an extra
// tool's settings page) are opened through the machine, like any other change to the laptop:
// under --home the fake records them and no real browser opens. The setup page isn't opened: the
// person has just pasted its line, so opening it again only takes them away from this window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fakeMachine, makeHome, programsFolder, readManifest, readOnlyLog, readProfile, runWith } from './harness.js';

/**
 * A York laptop where gh is already installed and nobody is signed in to GitHub yet, so the run
 * sends the person to GitHub's sign-up page.
 * @param {import('node:test').TestContext} t
 */
async function aLaptopNewToGitHub(t) {
  const where = await makeHome(t, { github: true });
  const { tools } = await readManifest();
  const tool = tools.find((/** @type {any} */ entry) => entry.id === 'gh');
  const gh = join(programsFolder(where.home), tool.install.folder, tool.install.check);
  await mkdir(join(gh, '..'), { recursive: true });
  await writeFile(gh, 'stand-in');
  await fakeMachine(where.home).setReplies({
    'gh.exe --version': { output: `gh version ${tool.version} (2026-10-01)\n` },
    'gh.exe auth status --hostname github.com': { code: 1, output: 'You are not logged into any GitHub hosts.' },
    'gh.exe api user --jq .login': { output: 'octocat-york\n' },
  });
  return where;
}

test('under --home each page the run sends the person to is opened on the fake machine, in order', async (t) => {
  const where = await aLaptopNewToGitHub(t);
  const profile = await readProfile('york');

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(await fakeMachine(where.home).pagesOpened(), [profile.github.signUpPage, profile.connectorsPage]);
  const log = await readOnlyLog(where.home);
  assert.ok(!log.text.includes(profile.page), log.text);
  assert.ok(log.text.includes(`Connectors page: ${profile.connectorsPage} (opened)`), log.text);
  // Beside each page, the way back to the window that's waiting for Enter.
  const back = /come back to this window \(the blue PowerShell window\) and press Enter/g;
  assert.equal(result.stdout.replace(/[│|]/g, ' ').replace(/\s+/g, ' ').match(back)?.length, 2, result.stdout);
});

test('a debug run logs each page it opens', async (t) => {
  const where = await aLaptopNewToGitHub(t);
  const profile = await readProfile('york');

  const result = await runWith(where, 'york', ['--debug']);

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const { text } = await readOnlyLog(where.home);
  for (const page of [profile.github.signUpPage, profile.connectorsPage]) {
    assert.ok(text.includes(`Opening in the browser: ${page}`), `${page} in:\n${text}`);
  }
});
