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
const steps = ['Paste the line', 'Type /jumpstart in your top workspace', 'Start work in the workspace it belongs to.'];
/** The page's sections, in the order they appear. */
const sections = [
  'Set up',
  'When you need it',
  'What Jumpstart does',
  'Your privacy',
  'Your workspaces',
  'Your skills',
  'Your connectors',
  'Finding your way round T3 Code',
  'If something went wrong',
  'Why T3 Code rather than the Claude app?',
];
/** The five points under "Finding your way round T3 Code", as a reader sees them. */
const tour = [
  'Threads are down the left, grouped by workspace. T3 Code calls workspaces "projects". New thread starts a conversation: pick the workspace it belongs in. Ctrl+B hides or shows the list.',
  'Files is a tab in the panel on the right. Open the panel with the button at the top right, or Ctrl+Alt+B.',
  "Terminal is a drawer at the bottom, Ctrl+J. You'll rarely need it.",
  'Settings is the gear at the bottom left.',
  "Usage and context are on the Thread details card at the top right of a thread. If it doesn't show them, right-click it and turn them on. When the context is nearly full, start a new thread.",
];
/** The sections the Jumpstart skill's closing links to, by their anchors. */
const anchors = {
  'your-workspaces': 'Your workspaces',
  'your-connectors': 'Your connectors',
  'your-skills': 'Your skills',
  'finding-your-way-round-t3-code': 'Finding your way round T3 Code',
  'if-something-went-wrong': 'If something went wrong',
};
const pages = {
  york: 'irm https://jumpstart-install.arcforge.uk/york.ps1 | iex',
  default: 'irm https://jumpstart-install.arcforge.uk/install.ps1 | iex',
};
/** What each page says after the share-log line: who to email the log to, and where. @type {Record<string, string>} */
const sendTheLogSays = {
  york: 'Then email it to Jacob at jacob.hamood@york.ac.uk. The email opens ready to send',
  default: 'Then email it to Jacob at jacob.hamood@live.co.uk. The email opens ready to send',
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

/**
 * The visible text of one section: from its heading to the next section's heading.
 * @param {string} text the page's visible text @param {string} heading one of `sections`
 */
function sectionOf(text, heading) {
  const at = sections.indexOf(heading);
  const start = text.indexOf(` ${heading} `);
  assert.ok(start >= 0, `no "${heading}" section`);
  const next = sections[at + 1];
  const end = next === undefined ? text.length : text.indexOf(` ${next} `, start);
  assert.ok(end > start, `"${next}" does not follow "${heading}"`);
  return text.slice(start, end);
}

/** @param {string} html @returns {string} the page's visible text, roughly as a reader sees it */
function textOf(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
    .replace(/<\/?(strong|em|a|code)\b[^>]*>/g, '')
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
    // The workspaces demo has buttons of its own; neither line's box has one, and none says Copy.
    const boxes = html.split('class="copybox"').slice(1).map((box) => box.slice(0, box.indexOf('</div>', box.indexOf('class="line"'))));
    assert.equal(boxes.length, 2, 'the install line and the share-log line each have a box');
    for (const box of boxes) assert.doesNotMatch(box, /<button/i, "a button is still in a line's box");
    assert.doesNotMatch(html, /<button[^>]*>[^<]*copy/i, 'a Copy button is still on the page');
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

  test(`the ${id} page has its sections in order`, async (t) => {
    const text = textOf(await readFile(join(await render(t), id, 'index.html'), 'utf8'));
    const places = sections.map((heading) => text.indexOf(` ${heading} `));
    assert.ok(places.every((place) => place >= 0), `missing from the page: ${sections.filter((_, i) => places[i] < 0)}`);
    assert.deepEqual([...places].sort((a, b) => a - b), places, 'out of order');
  });

  test(`the ${id} page's step 3 says to start work in the workspace it belongs to`, async (t) => {
    const text = sectionOf(textOf(await readFile(join(await render(t), id, 'index.html'), 'utf8')), 'Set up');
    assert.ok(
      text.includes(
        "Start work in the workspace it belongs to. Give each area of your work its own workspace, such as 'Event management' or 'Email campaigns'. " +
          "Ask your agent to make one, for example 'Make me a workspace for event management'. Then open it in T3 Code and start a conversation there. " +
          'Your messages, calendar and tasks go in Personal assistant.',
      ),
      text,
    );
  });

  test(`the ${id} site publishes Jumpstart's writing picker template beside its page, as it is in the skill`, async (t) => {
    const built = await readFile(join(await render(t), id, 'jumpstart', 'writing-picker.js'), 'utf8');
    assert.equal(built, await readFile(join(repo, 'skills', 'jumpstart', 'writing-picker.js'), 'utf8'));
  });

  test(`the ${id} site publishes Jumpstart's review page template beside its page, as it is in the skill`, async (t) => {
    const built = await readFile(join(await render(t), id, 'jumpstart', 'review-page.js'), 'utf8');
    assert.equal(built, await readFile(join(repo, 'skills', 'jumpstart', 'review-page.js'), 'utf8'));
  });

  test(`the ${id} page has none of the old setup page's steps`, async (t) => {
    const text = textOf(await readFile(join(await render(t), id, 'index.html'), 'utf8'));
    for (const old of ['Before the call', 'Install Claude Code', 'Setup prompt', 'Plan your day', 'Software Centre', 'Open Personal assistant and start a conversation']) {
      assert.ok(!text.includes(old), `still says "${old}"`);
    }
  });
}

/** @param {import('node:test').TestContext} t @param {string} id @returns {Promise<{ html: string, text: string }>} */
async function pageOf(t, id) {
  const html = await readFile(join(await render(t), id, 'index.html'), 'utf8');
  return { html, text: textOf(html) };
}

/** @param {string} html @param {string} heading @returns {string} the HTML from that section's heading to the next one's */
function sectionHtml(html, heading) {
  const start = html.indexOf(`<h2>${heading}</h2>`);
  assert.ok(start >= 0, `no "${heading}" section`);
  const next = sections[sections.indexOf(heading) + 1];
  return html.slice(start, next === undefined ? html.length : html.indexOf(`<h2>${next}</h2>`, start));
}

/** Where each skill's own text is: its SKILL.md in the source the profiles install it from. */
const skillText = {
  'grill-me': 'https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md',
  grilling: 'https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md',
  'grill-with-docs': 'https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md',
  'domain-modeling': 'https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md',
  'wait-what': 'https://github.com/mattpocock/skills/blob/main/skills/productivity/wait-what/SKILL.md',
  teach: 'https://github.com/mattpocock/skills/blob/main/skills/productivity/teach/SKILL.md',
  wayfinder: 'https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md',
  'to-spec': 'https://github.com/mattpocock/skills/blob/main/skills/engineering/to-spec/SKILL.md',
  'to-tickets': 'https://github.com/mattpocock/skills/blob/main/skills/engineering/to-tickets/SKILL.md',
  'to-questionnaire': 'https://github.com/mattpocock/skills/blob/main/skills/productivity/to-questionnaire/SKILL.md',
  handoff: 'https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md',
  research: 'https://github.com/mattpocock/skills/blob/main/skills/engineering/research/SKILL.md',
  prototype: 'https://github.com/mattpocock/skills/blob/main/skills/engineering/prototype/SKILL.md',
  wizard: 'https://github.com/mattpocock/skills/blob/main/skills/engineering/wizard/SKILL.md',
  'frontend-design': 'https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md',
  unslop: 'https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md',
  jumpstart: 'https://github.com/Bozodragon/agent-jumpstart/blob/main/skills/jumpstart/SKILL.md',
  'setup-matt-pocock-skills': 'https://github.com/mattpocock/skills/blob/main/skills/engineering/setup-matt-pocock-skills/SKILL.md',
};
const skillHeadings = {
  'Thinking something through': ['grill-me', 'grilling', 'grill-with-docs', 'domain-modeling', 'wait-what', 'teach'],
  'Planning work': ['wayfinder', 'to-spec', 'to-tickets', 'to-questionnaire', 'handoff'],
  'Finding out and making things': ['research', 'prototype', 'wizard', 'frontend-design', 'unslop'],
  'Setting up': ['jumpstart', 'setup-matt-pocock-skills'],
};

for (const id of Object.keys(pages)) {
  test(`the ${id} page lists the skills under four headings, each name linking to the skill's own text with a short line`, async (t) => {
    const { html } = await pageOf(t, id);
    const groups = sectionHtml(html, 'Your skills').split('<h3>').slice(1);
    assert.deepEqual(
      groups.map((group) => group.slice(0, group.indexOf('</h3>'))),
      Object.keys(skillHeadings),
    );
    for (const group of groups) {
      const heading = group.slice(0, group.indexOf('</h3>'));
      const listed = [...group.matchAll(/<a href="([^"]+)"[^>]*>\/([\w-]+)<\/a>\s*<span>([^<]*)<\/span>/g)];
      assert.deepEqual(listed.map((match) => match[2]), skillHeadings[/** @type {keyof typeof skillHeadings} */ (heading)], heading);
      for (const [, href, name, line] of listed) {
        assert.equal(href, skillText[/** @type {keyof typeof skillText} */ (name)], name);
        const words = line.trim().split(/\s+/).length;
        assert.ok(words >= 6 && words <= 15, `/${name}'s line is ${words} words: "${line}"`);
      }
    }
    assert.ok(
      textOf(sectionHtml(html, 'Your skills')).includes('the agent runs this one when a skill needs it'),
      '/setup-matt-pocock-skills should say the agent runs it when a skill needs it',
    );
  });

  test(`the ${id} page says "project" once, to say T3 Code calls workspaces that`, async (t) => {
    const { text } = await pageOf(t, id);
    assert.equal(text.match(/project/gi)?.length, 1, 'our own things are workspaces, never projects');
    assert.ok(sectionOf(text, 'Finding your way round T3 Code').includes('T3 Code calls workspaces "projects".'));
  });

  test(`the ${id} page's "Finding your way round T3 Code" gives its five points`, async (t) => {
    const section = sectionOf((await pageOf(t, id)).text, 'Finding your way round T3 Code');
    for (const point of tour) assert.ok(section.includes(point), `missing: ${point}\n\n${section}`);
  });

  test(`the ${id} page shows T3 Code's layout and making a new workspace as screenshots the page labels`, async (t) => {
    const figures = sectionHtml((await pageOf(t, id)).html, 'Finding your way round T3 Code').split('<figure').slice(1);
    assert.deepEqual(
      figures.map((figure) => textOf(figure.slice(figure.indexOf('<figcaption'), figure.indexOf('</figcaption>'))).trim().split(':')[0]),
      ["T3 Code's layout", 'Making a new workspace'],
    );
    for (const figure of figures) {
      assert.match(figure, /<img src="data:image\/png;base64,[A-Za-z0-9+/=]{1000,}" alt="[^"]+"/, 'the screenshot is in the page, with a description');
      const callouts = [...figure.matchAll(/class="callout[^"]*"[^>]*>(\d+)</g)].map((match) => Number(match[1]));
      assert.ok(callouts.length > 0, 'the screenshot has no numbered labels');
      assert.deepEqual(callouts, callouts.map((_, i) => i + 1), 'the labels count up from 1');
      for (const n of callouts) assert.match(figure, new RegExp(`<figcaption[\\s\\S]*>${n}</span>`), `label ${n} isn't explained under the screenshot`);
    }
  });

  test(`the ${id} page has the anchors the Jumpstart skill links to, and opens a section that's linked to`, async (t) => {
    const { html } = await pageOf(t, id);
    for (const [anchor, heading] of Object.entries(anchors)) {
      assert.equal(html.split(`id="${anchor}"`).length - 1, 1, `#${anchor} should be on the page once`);
      assert.match(html, new RegExp(`<details [^>]*id="${anchor}"[^>]*>\\s*<summary[^>]*><h2>${heading.replace('?', '\\?')}</h2>`), `#${anchor} isn't "${heading}"`);
    }
    assert.match(html, /addEventListener\("hashchange"/, 'nothing opens a section when the address changes to its anchor');
    assert.match(html, /\.open = true/, 'nothing opens the linked section');
    assert.match(html, /scrollIntoView/, 'nothing scrolls to the linked section');
  });

  test(`the ${id} page says how to reconnect a connector, and lists the profile's connectors`, async (t) => {
    const { html, text } = await pageOf(t, id);
    const profile = JSON.parse(await readFile(join(repo, 'profiles', `${id}.json`), 'utf8'));
    const section = sectionOf(text, 'Your connectors');
    for (const step of [
      "On claude.ai's Connectors page, disconnect it and connect it again.",
      "For Asana, choose your team's workspace at the top of Asana's page.",
      'Start a new thread.',
    ]) {
      assert.ok(section.includes(step), `missing: ${step}`);
    }
    assert.match(sectionHtml(html, 'Your connectors'), new RegExp(`<a href="${profile.connectorsPage}"[^>]*>Connectors page</a>`));
    for (const connector of profile.connectors) assert.ok(section.includes(`${connector.name} ${connector.what}`), connector.name);
  });

  test(`the ${id} page says where to send the log, under "If something went wrong"`, async (t) => {
    const { text } = await pageOf(t, id);
    const said = sendTheLogSays[id];
    const section = sectionOf(text, 'If something went wrong');
    assert.ok(section.includes(said), `missing: ${said}`);
    assert.ok(section.indexOf(shareLogLine) < section.indexOf(said), `"${said}" belongs after the share-log line`);
  });

  test(`the ${id} page's "Claude sign-in didn't work" says what the Installer's ending says: close T3 Code, then paste the install line again`, async (t) => {
    const { text } = await pageOf(t, id);
    const section = sectionOf(text, 'If something went wrong');
    const fix = section.slice(section.indexOf("Claude sign-in didn't work"), section.indexOf('Asana shows the wrong workspace'));
    assert.ok(
      fix.includes("If T3 Code is open, close it. Then paste the install line from step 1 into Windows PowerShell again: it signs you in and skips everything that's already done."),
      fix,
    );
    assert.doesNotMatch(fix, /Refresh|claude auth login/);
  });
}

for (const id of Object.keys(pages)) {
  test(`the ${id} page's "Your workspaces" has the workspaces demo: the example tree, its key and the "What it sees" panel`, async (t) => {
    const { html, text } = await pageOf(t, id);
    const profile = JSON.parse(await readFile(join(repo, 'profiles', `${id}.json`), 'utf8'));
    const section = sectionOf(text, 'Your workspaces');
    assert.ok(section.includes('Drag your agent onto a workspace to see what it works with there.'), section);
    for (const key of [
      'Agent instructions it follows from the start',
      'What it looks through first',
      'Files its instructions point to, read when needed',
      'Out of the way: it can reach them, but has to go looking',
    ]) {
      assert.ok(section.includes(key), `the key is missing "${key}"`);
    }
    const tree = [
      profile.workspaces.top,
      'Personal assistant',
      'Thinking space',
      'Event management',
      'Open day 2026',
      'Graduation 2027',
      'Email campaigns',
      'Offer holders 2026',
      'Marketing',
    ];
    const places = tree.map((name) => section.indexOf(` ${name} `));
    assert.ok(places.every((place) => place >= 0), `missing from the tree: ${tree.filter((_, i) => places[i] < 0)}`);
    assert.deepEqual([...places].sort((a, b) => a - b), places, 'the tree is out of order');
    assert.ok(section.includes('Show deeper nesting'), 'no way to show deeper nesting');
    assert.ok(section.includes('Drag your agent onto a workspace on the left to see what it works with there.'), 'the panel is missing');
    // What the panel says after a drop is written by the demo's script, which is part of the section.
    const panel = sectionHtml(html, 'Your workspaces');
    for (const label of ['Your agent, starting in', 'Follows from the start', 'Looks through first', 'Reads when it needs them', 'Has to go looking']) {
      assert.ok(panel.includes(label), `the panel never says "${label}"`);
    }
  });

  test(`the ${id} page is one page: its scripts and styles are in it, and only its fonts come from elsewhere`, async (t) => {
    const { html } = await pageOf(t, id);
    assert.doesNotMatch(html, /<script[^>]+src=/i, 'a script is loaded from elsewhere');
    const sheets = [...html.matchAll(/<link [^>]*rel="stylesheet"[^>]*>/g)].map((match) => match[0]);
    assert.ok(sheets.every((sheet) => sheet.includes('https://fonts.googleapis.com/')), `a stylesheet is loaded from elsewhere: ${sheets}`);
  });
}

test('the york page explains why Google Drive, with a line for those who chose Documents', async (t) => {
  const section = sectionOf((await pageOf(t, 'york')).text, 'Your workspaces');
  assert.ok(
    section.includes(
      'Why Google Drive? Your top workspace is in your Google Drive. Drive keeps your workspaces backed up and reachable from any device, ' +
        'and you can see and share their files like any others.',
    ),
    section,
  );
  assert.ok(section.includes('If you chose Documents when the installer asked, your workspaces are on that laptop only.'), section);
});

test('the default page names Documents as where workspaces are, and not Google Drive', async (t) => {
  const { text } = await pageOf(t, 'default');
  const section = sectionOf(text, 'Your workspaces');
  assert.ok(section.includes('Your top workspace is in your Documents folder, on this laptop.'), section);
  assert.doesNotMatch(section, /Google Drive|My Drive/);
  assert.ok(!text.includes('Why Google Drive?'));
});

test('the york page says T3 Code needs no admin rights, then what else it does', async (t) => {
  const section = sectionOf((await pageOf(t, 'york')).text, 'Why T3 Code rather than the Claude app?');
  assert.ok(
    section.includes(
      "The full Claude app needs admin rights to install, which York's laptops don't give you. T3 Code doesn't. " +
        'It also names your threads for you, saves a version of your work in one click, and keeps gaining features.',
    ),
    section,
  );
});

test('the default page says what T3 Code does, without the admin point', async (t) => {
  const section = sectionOf((await pageOf(t, 'default')).text, 'Why T3 Code rather than the Claude app?');
  assert.ok(
    section.includes(' T3 Code names your threads for you, saves a version of your work in one click, and keeps gaining features.'),
    section,
  );
  assert.doesNotMatch(section, /admin/i);
});

/** Anthropic's own sentence on commercial products and training, from "Is my data used for model training?". */
const notForTraining =
  '"By default, we will not use your inputs or outputs from our commercial products (e.g. Claude for Work, Anthropic API, Claude Gov, etc.) to train our models."';

test("the york page's privacy section: Claude Enterprise under contract, not used for training, deleted within 30 days unless flagged", async (t) => {
  const { html, text } = await pageOf(t, 'york');
  const section = sectionOf(text, 'Your privacy');
  assert.ok(section.includes('York is on Claude Enterprise, under contract with Anthropic.'), section);
  assert.ok(section.includes(notForTraining), section);
  assert.ok(section.includes('within 30 days'), section);
  assert.ok(section.includes('automated trust and safety systems'), section);
  assert.ok(!section.includes('Help improve Claude'), 'York people have no such setting');
  assert.match(sectionHtml(html, 'Your privacy'), /href="https:\/\/privacy\.claude\.com\/en\/articles\/7996868-is-my-data-used-for-model-training"/);
});

test("the default page's privacy section adds the Help improve Claude setting, linking to claude.ai's data privacy controls", async (t) => {
  const { html, text } = await pageOf(t, 'default');
  const section = sectionOf(text, 'Your privacy');
  assert.ok(section.includes('Help improve Claude'), section);
  assert.match(sectionHtml(html, 'Your privacy'), /<a href="https:\/\/claude\.ai\/settings\/data-privacy-controls"[^>]*>data privacy controls<\/a>/);
  assert.ok(section.includes(notForTraining), section);
  assert.ok(section.includes('within 30 days'), section);
  assert.doesNotMatch(section, /York/);
});

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

test('the default page links to a Gmail draft to Jacob at his live.co.uk address, and names him and that address', async (t) => {
  const html = await readFile(join(await render(t), 'default', 'index.html'), 'utf8');
  const href = html.match(/href="(https:\/\/mail\.google\.com\/[^"]+)"/)?.[1];
  assert.ok(href, 'no Gmail link on the page');
  const draft = new URL(href.replace(/&amp;/g, '&')).searchParams;
  assert.equal(draft.get('to'), 'jacob.hamood@live.co.uk');
  assert.match(draft.get('body') ?? '', /^Hi Jacob,\n/);
  const text = textOf(html);
  assert.ok(text.includes('email it to Jacob'));
  assert.ok(text.includes('jacob.hamood@live.co.uk'), 'the address is not shown');
  assert.ok(!text.includes('the person who sent you this page'));
});

test('the york page also shows the address it sends the log to', async (t) => {
  const text = textOf(await readFile(join(await render(t), 'york', 'index.html'), 'utf8'));
  assert.ok(text.includes('jacob.hamood@york.ac.uk'), 'the address is not shown');
});
