// Seam 2: the sign-ins on the Installer page. Nothing is handed back to a window, because on the
// page there's none: each sign-in's program runs piped, the Installer takes from what it prints
// only the link and code the person needs, and sends those to the page; everything it printed
// goes to the log. Claude's code box writes into Claude's input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { claudeProgram, fakeMachine, ghAlreadyInstalled, makeHome, readManifest, readOnlyLog, supplyT3, t3Leaves } from './harness.js';
import { answerEverything, runOnPage } from './page-harness.js';

const signedOut = { code: 1, output: JSON.stringify({ loggedIn: false, authMethod: 'none' }) };
const signedIn = { output: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'jo.bloggs@york.ac.uk' }) };

/** Claude's paste-a-code address, as `claude auth login` prints it. */
const claudesLink = 'https://claude.com/cai/oauth/authorize?code=true&state=abc123';
/** What `claude auth login` prints before it waits, as it prints it when its output isn't a terminal. */
const claudesLines = ['Opening browser to sign in…', `If the browser didn't open, visit: ${claudesLink}`, 'Paste code here if prompted > '];

/**
 * A laptop with Claude Code there but signed out, and T3 Code to install.
 * @param {import('node:test').TestContext} t
 * @typedef {import('./harness.js').Reply} Reply
 * @param {{ status: Reply[], login: Reply | Reply[], more?: (where: { home: string, downloads: string }) => Promise<Record<string, Reply | Reply[]>> }} how
 *   `more`: other replies, made once the home is there
 */
async function aLaptopSignedOutOfClaude(t, { status, login, more = async () => ({}) }) {
  const where = await makeHome(t, { channel: 'stable' });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.3');
  await mkdir(dirname(join(where.home, claudeProgram)), { recursive: true });
  await writeFile(join(where.home, claudeProgram), 'already here');
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    'claude.exe --version': { output: '2.1.317 (Claude Code)\n' },
    'claude.exe auth status': status,
    'claude.exe auth login': login,
    [`${installer} /S --force-run`]: { creates: [t3Leaves.program] },
    [`${installer} /S`]: { creates: [t3Leaves.program] },
    ...(await more(where)),
  });
  const logins = async () => (await machine.runs()).filter((run) => basename(run.file) === 'claude.exe' && run.args.join(' ') === 'auth login');
  return { where, machine, logins };
}

test("Claude's sign-in on the page: one screen with the explanation, Claude's paste-a-code link and a code box, and a code pasted there reaches Claude's input", async (t) => {
  const { where, logins } = await aLaptopSignedOutOfClaude(t, {
    status: [signedOut, signedIn],
    login: { output: `${claudesLines.join('\n')}\nLogin successful.\n`, readsALine: true },
  });

  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  const answering = answerEverything(page, run.answer, { channel: 'stable' });
  const signIn = await page.next((event) => event.type === 'signIn');
  const shows = await page.next((event) => event.type === 'signInShows' && event.signIn === signIn.id && event.codeBox !== undefined);
  const sent = await run.answer(shows.codeBox, '  a1B2c3#state-9z  ');
  await answering;
  const result = await run.ended;

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  // The notice just before the sign-in is its explanation.
  const notice = page.events.filter((event) => event.id < signIn.id && event.type !== 'output').at(-1);
  assert.equal(notice?.type, 'notice');
  assert.equal(notice?.title, 'Sign in to Claude Code');
  assert.equal(shows.link?.url, claudesLink);
  const [login] = await logins();
  assert.equal(login.typed, 'a1B2c3#state-9z', "the code, trimmed, is the line Claude's input gets");
  assert.equal(login.input, 'pipe');
  assert.deepEqual(login.env, { BROWSER: 'explorer.exe' });
  assert.ok(page.events.some((event) => event.type === 'signInEnded' && event.signIn === signIn.id));
  assert.equal(JSON.stringify(page.events).includes('a1B2c3'), false, 'the code is never sent back to any page');
  assert.equal((await readOnlyLog(where.home)).text.includes('a1B2c3'), false, 'nor logged');
});

test("a code Claude turns down shows Claude's own reason with Try again or Skip for now, and Try again is the whole explained sign-in screen again", async (t) => {
  // Piped, Claude doesn't echo the code or end its prompt's line, so its reason, on stderr, joins it.
  const turnedDown = "Login failed: That code wasn't accepted. It may be incomplete, expired, already used, or from an earlier sign-in attempt.";
  const { where, logins } = await aLaptopSignedOutOfClaude(t, {
    status: [signedOut, signedOut, signedIn],
    login: [
      { code: 1, output: `${claudesLines.join('\n')}${turnedDown}\n`, readsALine: true },
      { output: `${claudesLines.join('\n')}Login successful.\n` },
    ],
  });

  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  const answering = answerEverything(page, run.answer, { channel: 'stable', claudeSignIn: 'again' });
  const shows = await page.next((event) => event.type === 'signInShows' && event.codeBox !== undefined);
  await run.answer(shows.codeBox, 'old#code');
  await answering;
  const result = await run.ended;

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await logins()).length, 2);
  const question = page.events.find((event) => event.type === 'question' && event.key === 'claudeSignIn');
  assert.ok(question, 'Try again or Skip for now was asked');
  const before = page.events.filter((event) => event.id < question.id).at(-1);
  assert.deepEqual([before?.type, before?.text], ['problem', turnedDown], "Claude's reason, just before Try again or Skip for now");
  const signIns = page.events.filter((event) => event.type === 'signIn');
  assert.equal(signIns.length, 2);
  for (const signIn of signIns) {
    const notice = page.events.filter((event) => event.id < signIn.id).at(-1);
    assert.equal(notice?.title, 'Sign in to Claude Code', 'each try is explained');
  }
});

test("a code that isn't all of Claude's code is turned down on the page, with the reason, before Claude sees it, and the box stays open for the whole one", async (t) => {
  const { where, logins } = await aLaptopSignedOutOfClaude(t, {
    status: [signedOut, signedIn],
    login: { output: `${claudesLines.join('\n')}\nLogin successful.\n`, readsALine: true },
  });

  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  const answering = answerEverything(page, run.answer, { channel: 'stable' });
  const shows = await page.next((event) => event.type === 'signInShows' && event.codeBox !== undefined);
  const half = await run.answer(shows.codeBox, 'a1B2c3-without-its-state');
  const empty = await run.answer(shows.codeBox, '   ');
  const whole = await run.answer(shows.codeBox, 'a1B2c3#state-9z');
  const again = await run.answer(shows.codeBox, 'd4E5f6#state-8y');
  await answering;
  const result = await run.ended;

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(half.status, 422);
  assert.match(half.body.reason, /isn't the whole code/);
  assert.equal(empty.status, 422);
  assert.equal(whole.status, 200);
  assert.equal(again.status, 409, 'the first code taken is the only one');
  const refusals = page.events.filter((event) => event.type === 'refused' && event.question === shows.codeBox);
  assert.equal(refusals.length, 2);
  assert.ok(refusals.every((event) => !('answer' in event)), 'a code is never sent back to the page');
  assert.ok(page.events.some((event) => event.type === 'answered' && event.question === shows.codeBox && event.answer === 'sent'));
  assert.equal((await logins())[0].typed, 'a1B2c3#state-9z');
  assert.equal(JSON.stringify(page.events).includes('a1B2c3'), false);
});

/** What `gh auth login --web --clipboard` prints to stderr when it isn't in a terminal, then once it's done. */
const ghLines = [
  '! First copy your one-time code: 3A4B-7C8D',
  'Open this URL to continue in your web browser: https://github.com/login/device',
  '✓ Authentication complete.',
];

test("GitHub's sign-in on the page: gh's one-time code reaches the page, and the address gh prints is opened, with no key to press", async (t) => {
  const where = await makeHome(t, { github: true });
  const { gh, replies } = await ghAlreadyInstalled(where.home);
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    ...replies,
    'gh.exe auth status --hostname github.com': { code: 1, output: 'You are not logged into any GitHub hosts.' },
    'gh.exe auth login': { output: `${ghLines.join('\n')}\n` },
    'gh.exe api user --jq .login': { output: 'octocat-york\n' },
  });

  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  await answerEverything(page, run.answer, { github: true });
  const result = await run.ended;

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const signIn = await page.next((event) => event.type === 'signIn');
  const notice = page.events.filter((event) => event.id < signIn.id).at(-1);
  assert.equal(notice?.type, 'notice');
  assert.equal(notice?.title, 'Sign in to GitHub');
  const shown = page.events.filter((event) => event.type === 'signInShows' && event.signIn === signIn.id);
  assert.deepEqual(shown.map((event) => event.code).filter(Boolean), ['3A4B-7C8D']);
  assert.ok(shown.some((event) => event.link?.url === 'https://github.com/login/device'), 'the address is there to open again');
  assert.ok(shown.every((event) => event.codeBox === undefined), "gh reads nothing, so there's no box");
  assert.ok((await machine.pagesOpened()).includes('https://github.com/login/device'), 'the Installer opens the address itself');
  const login = (await machine.runs()).find((run) => run.file === gh && run.args[1] === 'login');
  assert.deepEqual(login?.args, ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--clipboard']);
  assert.equal(login?.input, 'pipe', 'piped, so gh asks nothing and opens nothing itself');
  const finish = await page.next((event) => event.type === 'finish');
  assert.ok(page.events.some((event) => event.type === 'summary' && event.rows.some((/** @type {[string, string]} */ [label, value]) => label === 'GitHub' && value === 'Signed in as octocat-york')), JSON.stringify(finish));
});

/**
 * A stand-in for clasp's package, and a copy of the pinned manifest whose clasp checksum is the
 * stand-in's, so the run installs it.
 * @param {{ downloads: string }} where
 */
async function supplyClasp(where) {
  const manifest = await readManifest();
  const clasp = manifest.tools.find((/** @type {any} */ tool) => tool.id === 'clasp');
  const bytes = Buffer.from('stand-in for the clasp package');
  const download = clasp.downloads[process.arch];
  await writeFile(join(where.downloads, basename(new URL(download.url).pathname)), bytes);
  download.sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(where.downloads, 'manifest.json'), JSON.stringify(manifest));
}

/** Google's sign-in address, as `clasp login` prints it. */
const claspsLink = 'https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&redirect_uri=http%3A%2F%2Flocalhost%3A54321';
const claspsLines = ['Authorize clasp by visiting this url:', claspsLink, '', 'You are logged in as a.person@york.ac.uk.'];

test("clasp's sign-in on the page: clasp opens the browser itself, and the address it prints reaches the page as the link to use if it didn't", async (t) => {
  const where = await makeHome(t, { extraTools: ['apps-script'] });
  await supplyClasp(where);
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    'clasp.cmd show-authorized-user': [{ output: 'Not logged in.\n' }, { output: 'You are logged in as a.person@york.ac.uk.\n' }],
    'clasp.cmd login': { output: `${claspsLines.join('\n')}\n` },
  });

  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  await answerEverything(page, run.answer, { extraTools: ['apps-script'] });
  const result = await run.ended;

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const signIn = await page.next((event) => event.type === 'signIn');
  const notice = page.events.filter((event) => event.id < signIn.id).at(-1);
  assert.equal(notice?.type, 'notice');
  assert.equal(notice?.title, 'Sign in to clasp');
  const shown = page.events.filter((event) => event.type === 'signInShows' && event.signIn === signIn.id);
  assert.deepEqual(shown.map((event) => event.link?.url), [claspsLink]);
  assert.ok(shown.every((event) => event.code === undefined && event.codeBox === undefined));
  assert.deepEqual(await machine.pagesOpened().then((pages) => pages.filter((url) => url.startsWith('https://accounts.google.com'))), [], 'clasp opens its own page');
  const login = (await machine.runs()).find((run) => basename(run.file) === 'clasp.cmd' && run.args[0] === 'login');
  assert.equal(login?.input, 'pipe');
  assert.ok(page.events.some((event) => event.type === 'summary' && event.rows.some((/** @type {[string, string]} */ [label, value]) => label === 'clasp' && /signed in as a\.person@york\.ac\.uk/.test(value))));
});

test('each sign-in on the page: all its program printed goes to the log, the page gets only the link and code, and no sign-in on the page names a key or the window', async (t) => {
  const more = {
    'gh.exe auth status --hostname github.com': { code: 1, output: 'You are not logged into any GitHub hosts.' },
    'gh.exe auth login': { output: `${ghLines.join('\n')}\n` },
    'gh.exe api user --jq .login': { output: 'octocat-york\n' },
    'clasp.cmd show-authorized-user': [{ output: 'Not logged in.\n' }, { output: 'You are logged in as a.person@york.ac.uk.\n' }],
    'clasp.cmd login': { output: `${claspsLines.join('\n')}\n` },
  };
  const { where } = await aLaptopSignedOutOfClaude(t, {
    status: [signedOut, signedIn],
    // The browser hands the sign-in back by itself, so nothing is pasted.
    login: { output: `${claudesLines.join('\n')}\nLogin successful.\n` },
    more: async (where) => {
      await supplyClasp(where);
      return { ...(await ghAlreadyInstalled(where.home)).replies, ...more };
    },
  });

  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  await answerEverything(page, run.answer, { channel: 'stable', github: true, extraTools: ['apps-script'] });
  const result = await run.ended;

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const log = (await readOnlyLog(where.home)).text;
  for (const [who, lines] of /** @type {[string, string[]][]} */ ([['Claude Code', [...claudesLines.map((line) => line.trimEnd()), 'Login successful.']], ['GitHub', ghLines], ['clasp', claspsLines.filter(Boolean)]])) {
    for (const line of lines) assert.ok(log.includes(`${who}: sign-in said: ${line}`), `${who}: ${line}\n\n${log}`);
  }
  const signIns = page.events.filter((event) => event.type === 'signIn');
  assert.equal(signIns.length, 3, 'GitHub, clasp and Claude Code each signed in on the page');
  assert.deepEqual(page.events.filter((event) => event.type === 'output'), [], "nothing a program printed is relayed as it is");
  const sent = JSON.stringify(page.events);
  for (const line of ['Opening browser to sign in', 'Paste code here', 'Login successful', 'Authentication complete', 'Open this URL', 'Authorize clasp', 'You are logged in as']) {
    assert.ok(!sent.includes(line), `the page was sent "${line}"`);
  }
  // What each sign-in's screen says: the notice it's joined to, and the labels of what it shows.
  const words = signIns.flatMap((signIn) => {
    const notice = page.events.filter((event) => event.id < signIn.id).at(-1);
    const shows = page.events.filter((event) => event.type === 'signInShows' && event.signIn === signIn.id);
    return [notice?.title, notice?.text, ...shows.map((event) => event.link?.label)].filter(Boolean);
  });
  for (const text of words) assert.doesNotMatch(text, /\b(press|Enter|here)\b|right-click|Agent Jumpstart window/i, text);
});
