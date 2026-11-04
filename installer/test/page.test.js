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
/** @param {string} line @returns {string} the address inside an `irm <address> | iex` line */
const addressIn = (line) => line.split(' ')[1];

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

  test(`the ${id} page has no Copy button and no script that writes to the clipboard`, async (t) => {
    const html = await readFile(join(await render(t), id, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /<button/i, 'a button is still on the page');
    assert.ok(!textOf(html).includes('Copy'), 'the page still says "Copy"');
    assert.doesNotMatch(html, /clipboard|execCommand/i, 'a script still writes to the clipboard');
  });

  test(`the ${id} page tells you to click each line and press Ctrl+C, and a click selects the whole line`, async (t) => {
    const html = await readFile(join(await render(t), id, 'index.html'), 'utf8');
    const hint = textOf(html).split('Click the line, then press Ctrl+C').length - 1;
    assert.equal(hint, 2, 'the hint belongs in the box of the install line and the box of the share-log line');
    assert.match(html, /addEventListener\("click"/, 'nothing happens on a click');
    assert.match(html, /selectNodeContents/, 'a click does not select the line');
  });

  test(`the ${id} page links "See what this runs" to the script of each of its two lines`, async (t) => {
    const html = await readFile(join(await render(t), id, 'index.html'), 'utf8');
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>\s*See what this runs\s*<\/a>/g)].map((match) => match[1]);
    assert.deepEqual(links, [addressIn(ownLine), addressIn(shareLogLine)]);
  });

  test(`the ${id} page warns that nothing may appear for up to half a minute after pasting`, async (t) => {
    const text = textOf(await readFile(join(await render(t), id, 'index.html'), 'utf8'));
    const warning = text.indexOf('nothing may appear for up to half a minute');
    assert.ok(warning >= 0, 'the half-minute warning is missing');
    assert.ok(text.indexOf(ownLine) < warning && warning < text.indexOf(steps[1]), 'the warning belongs after the install line, in step 1');
    assert.ok(text.includes('Windows PowerShell fetching the script'), 'it should say what the wait is');
  });

  test(`the ${id} site publishes Jumpstart's writing picker template beside its page, as it is in the skill`, async (t) => {
    const built = await readFile(join(await render(t), id, 'jumpstart', 'writing-picker.js'), 'utf8');
    assert.equal(built, await readFile(join(repo, 'skills', 'jumpstart', 'writing-picker.js'), 'utf8'));
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

test('the york page links to a Gmail draft to Jacob, with the subject and a place for the log', async (t) => {
  const html = await readFile(join(await render(t), 'york', 'index.html'), 'utf8');
  const href = html.match(/href="(https:\/\/mail\.google\.com\/[^"]+)"/)?.[1];
  assert.ok(href, 'no Gmail link on the page');
  const draft = new URL(href.replace(/&amp;/g, '&')).searchParams;
  assert.equal(draft.get('to'), 'jacob.hamood@york.ac.uk');
  assert.equal(draft.get('su'), 'Jumpstart Support');
  const body = draft.get('body') ?? '';
  assert.match(body, /^Hi Jacob,\n/);
  assert.match(body, /Installer logs\n```text\nDelete this line and paste the installer logs here \(Ctrl\+V\)\.\n```/);
  assert.ok(textOf(html).includes('email it to Jacob'));
});

test('the default page, with no email to send the log to, says who to send it to and links nowhere', async (t) => {
  const html = await readFile(join(await render(t), 'default', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /mail\.google\.com|mailto:/);
  assert.ok(textOf(html).includes('send it to the person who sent you this page'));
});
