// The setup page, one source rendered per profile. Checked by rendering it: the build
// script is run as it would be before publishing, and only the pages it writes are read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { repo } from './harness.js';

const run = promisify(execFile);
const shareLogLine = 'irm https://jumpstart-install.arcforge.uk/share-log.ps1 | iex';
const steps = ['Paste the line', 'Type /jumpstart in your top workspace', 'Open Personal assistant and start a conversation'];
const pages = {
  york: 'irm https://jumpstart-install.arcforge.uk/york.ps1 | iex',
  default: 'irm https://jumpstart-install.arcforge.uk/install.ps1 | iex',
};

/** @param {import('node:test').TestContext} t @returns {Promise<string>} the folder the pages were rendered into */
async function render(t) {
  const out = await mkdtemp(join(tmpdir(), 'jumpstart-page-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  await run(process.execPath, [join(repo, 'page', 'build.js'), out]);
  return out;
}

/** @param {string} html @returns {string} the page's visible text, roughly as a reader sees it */
function textOf(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}

for (const [id, ownLine] of Object.entries(pages)) {
  test(`the ${id} page shows its own line to paste, once, and no other installer line`, async (t) => {
    const html = await readFile(join(await render(t), id, 'index.html'), 'utf8');
    const pasted = [...html.matchAll(/irm\s+\S+\s*\|\s*iex/g)].map((match) => match[0]);
    assert.deepEqual(pasted, [ownLine, shareLogLine]);
    assert.doesNotMatch(html, /york-debug/);
    assert.doesNotMatch(html, /\{\{/, 'a placeholder was left unfilled');
  });

  test(`the ${id} page gives the three steps in order, then the share-log line under "If something went wrong"`, async (t) => {
    const text = textOf(await readFile(join(await render(t), id, 'index.html'), 'utf8'));
    const places = [...steps, 'If something went wrong', shareLogLine].map((phrase) => text.indexOf(phrase));
    assert.ok(places.every((place) => place >= 0), `missing from the page: ${steps.filter((_, i) => places[i] < 0)}`);
    assert.deepEqual([...places].sort((a, b) => a - b), places, 'out of order');
    assert.ok(text.indexOf(ownLine) < places[1], 'the line to paste belongs to the first step');
  });

  test(`the ${id} page has none of the old setup page's steps`, async (t) => {
    const text = textOf(await readFile(join(await render(t), id, 'index.html'), 'utf8'));
    for (const old of ['Before the call', 'Install Claude Code', 'Setup prompt', 'Plan your day', 'Software Centre']) {
      assert.ok(!text.includes(old), `still says "${old}"`);
    }
  });
}

test('each profile names the line its page shows, and that line runs the bootstrap for that profile', async () => {
  for (const [id, ownLine] of Object.entries(pages)) {
    const profile = JSON.parse(await readFile(join(repo, 'profiles', `${id}.json`), 'utf8'));
    assert.equal(profile.pastedLine, ownLine, id);
    assert.equal(profile.shareLogLine, shareLogLine, id);
    const file = ownLine.match(/\/([\w-]+\.ps1) \| iex$/)?.[1] ?? '';
    const [top] = (await readFile(join(repo, 'bootstrap', file), 'ascii')).split(/\r?\n/);
    assert.equal(top, `$AgentJumpstart = @{ Profile = '${id}'; Debug = $false }`, file);
  }
});
