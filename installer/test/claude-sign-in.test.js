// Claude Code's sign-in never leaves anyone stuck: the notice says what really happens (the
// browser opens by itself, and a code is pasted once, with nothing showing as it's pasted), a failed
// sign-in shows Claude's own reason and offers Try again (as often as it fails) or Skip for now,
// a skip carries on to an ending that says how to fix it, and the log keeps Claude's own lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { checklistSays, fakeMachine, makeHome, readOnlyLog, readSettings, runWith, supplyT3, t3Leaves } from './harness.js';

const claudeProgram = join('.local', 'bin', 'claude.exe');

const signedOut = { code: 1, output: JSON.stringify({ loggedIn: false, authMethod: 'none' }) };
const signedIn = { output: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'jo.bloggs@york.ac.uk' }) };

/** What `claude auth login` prints before it waits, as it prints it. */
const claudesLines = [
  'Opening browser to sign in…',
  "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=abc123",
];
const prompt = 'Paste code here if prompted > ';
const loginFailed = 'Login failed: Request failed with status code 400';
const failedLogin = { code: 1, output: `${claudesLines.join('\n')}\n${prompt}\n${loginFailed}\n` };
const goodLogin = { code: 0, output: `${claudesLines.join('\n')}\n${prompt}Login successful.\n` };

const skippedEnding =
  "One step didn't work: Claude Code isn't signed in, so T3 Code can't use it yet. If T3 Code is open, close it. Then paste the line again: it signs you in and skips everything that's already done.";

/** The printed output with the boxes' borders and line breaks taken out, as one line of text. @param {string} stdout */
const flowing = (stdout) => stdout.replace(/[│|]/g, ' ').replace(/\s+/g, ' ');

/**
 * A laptop with Claude Code there but signed out, and T3 Code to install (its installer doesn't
 * start it, so the ending would).
 * @param {import('node:test').TestContext} t
 * @param {{ status: object[], login: object[], answers?: Record<string, unknown> }} how
 */
async function aLaptopSignedOut(t, { status, login, answers = {} }) {
  const where = await makeHome(t, { channel: 'stable', ...answers });
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
  });
  const logins = async () => (await machine.runs()).filter((run) => basename(run.file) === 'claude.exe' && run.args.join(' ') === 'auth login');
  const t3Starts = async () => (await machine.runs()).filter((run) => run.file === join(where.home, t3Leaves.program));
  const t3Install = async () => (await machine.runs()).find((run) => basename(run.file) === installer);
  return { where, machine, logins, t3Starts, t3Install };
}

test('before the sign-in starts, the notice says what really happens, word for word', async (t) => {
  const { where } = await aLaptopSignedOut(t, { status: [signedOut, signedIn], login: [goodLogin] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const text = flowing(result.stdout);
  const notice = [
    'Sign in to Claude Code',
    'Claude Code signs you in next, in your browser.',
    "• A browser window opens at Claude's sign-in page. Sign in there. Once you're done in the browser, come back to the Agent Jumpstart window, where you pasted the line. It carries on by itself.",
    '• If no window opens, copy the link below into your browser: select it with the mouse, then right-click to copy it.',
    '• If the page shows a code, copy it, come back here and right-click to paste it. Nothing appears when you paste. Paste once, then press Enter.',
  ];
  // The box's wrapping can break a line anywhere, so the text is compared as it flows. The
  // bullet's symbol is a • on the old console too, but the box can't be told where to break.
  for (const line of notice) assert.ok(text.includes(line), `${line}

${result.stdout}`);
  assert.ok(text.indexOf(notice[4]) < text.indexOf(claudesLines[0]), 'the notice comes before Claude prints anything');
  assert.doesNotMatch(text, /Press Enter to choose your Claude account/);
  assert.doesNotMatch(text, /Only if the page shows a code|as you type|as it's typed/);
});

test("Claude's sign-in is run with BROWSER=explorer.exe, no other run is given BROWSER, and the person's environment variables don't gain it", async (t) => {
  const { where, machine, logins } = await aLaptopSignedOut(t, { status: [signedOut, signedIn], login: [goodLogin] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual((await logins()).map((run) => run.env), [{ BROWSER: 'explorer.exe' }]);
  const others = (await machine.runs()).filter((run) => !(basename(run.file) === 'claude.exe' && run.args.join(' ') === 'auth login'));
  assert.ok(others.length > 5, 'the other runs are there to be checked');
  assert.deepEqual(others.filter((run) => run.env !== undefined), [], 'no other run is given an environment of its own');
  assert.equal((await machine.environment()).BROWSER, undefined, "the person's environment variables don't gain BROWSER");
});

test("a sign-in that fails shows Claude's reason and offers Try again, which signs in afresh and carries on as normal", async (t) => {
  const { where, logins, t3Starts } = await aLaptopSignedOut(t, {
    status: [signedOut, signedOut, signedOut, signedIn],
    login: [failedLogin, failedLogin, goodLogin],
    answers: { claudeSignIn: ['again', 'again'] },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await logins()).length, 3, 'a fresh claude auth login after each failure');
  assert.ok((await logins()).every((run) => run.onScreen === true), "each in the person's window");
  const text = flowing(result.stdout);
  assert.ok(text.includes(loginFailed), result.stdout);
  const log = (await readOnlyLog(where.home)).text;
  assert.equal(log.match(/Answer: claudeSignIn: "again"/g)?.length, 2, log);
  checklistSays(result.stdout, 'Claude Code', '2.1.317, signed in as jo.bloggs@york.ac.uk');
  assert.equal((await readSettings(where.home)).email, 'jo.bloggs@york.ac.uk');
  assert.equal((await t3Starts()).length, 1, 'the ending opens T3 Code');
  assert.ok(!text.includes(skippedEnding), result.stdout);
  assert.doesNotMatch(text, /Claude Code: 2\.1\.317, not signed in/);
});

test("Skip for now finishes the install, with an ending that says how to fix it, shows Claude's reason, and doesn't open T3 Code", async (t) => {
  const { where, logins, t3Starts, t3Install } = await aLaptopSignedOut(t, { status: [signedOut], login: [failedLogin], answers: { claudeSignIn: ['skip'] } });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await logins()).length, 1);
  checklistSays(result.stdout, 'Claude Code', '2.1.317, not signed in');
  checklistSays(result.stdout, 'T3 Code', '0.1.3 (stable, installed, not opened yet)');
  const ending = flowing(result.stdout.slice(result.stdout.lastIndexOf('Checklist')));
  assert.ok(ending.includes(skippedEnding), result.stdout);
  assert.ok(ending.includes(loginFailed), 'Claude\'s own reason is repeated in the ending');
  assert.doesNotMatch(ending, /All done|Done\./);
  assert.doesNotMatch(ending, /Type \/jumpstart/);
  assert.equal(ending.match(/Claude Code: 2\.1\.317, not signed in/g)?.length, 1, 'Claude Code is named once among what didn\'t work');
  assert.deepEqual(await t3Starts(), [], "T3 Code's program isn't started by the ending");
  assert.deepEqual((await t3Install())?.args, ['/S'], "T3 Code's installer isn't told to start it");
  checklistSays(result.stdout, 'Workspaces', "Claude, not in T3 Code yet: it's added when you paste the line again");
  assert.doesNotMatch(ending, /open T3 Code/, "nothing in the ending asks for T3 Code to be opened, since its closing line says to close it");
  assert.equal((await readSettings(where.home)).email, null);
  assert.match((await readOnlyLog(where.home)).text, /Ending: T3 Code isn't opened/);
});

test("Skip for now, when other steps didn't work too, ends with the sign-in's own line, then one line naming the others", async (t) => {
  // This laptop's downloads folder has none of the other tools, so their installs don't work, and
  // T3 Code, never opened, can't list the workspaces yet.
  const { where } = await aLaptopSignedOut(t, { status: [signedOut], login: [failedLogin], answers: { claudeSignIn: ['skip'], extraTools: [] } });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Git', "Not installed: it wasn't in the downloads folder");
  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.replace(/^[^\w/]+/, '').trim())
    .filter((line) => line !== '');
  assert.deepEqual(lines.slice(-2), [skippedEnding, "These steps didn't work either: Node.js, Git, GitHub CLI, Skills CLI, Skills and Workspaces."], result.stdout);
});

for (const mode of ['an ordinary', 'a debug']) {
  test(`${mode} run's log keeps Claude's own sign-in lines, and never the code pasted at its prompt`, async (t) => {
    // Claude doesn't print the code back (nothing shows as it's pasted), but were it ever to, it would be after the prompt.
    const code = 'a1B2c3D4e5F6g7H8#state-9z8y7x';
    const echoed = { code: 1, output: `${claudesLines.join('\n')}\n${prompt}${code}\n${loginFailed}\n` };
    const { where } = await aLaptopSignedOut(t, { status: [signedOut], login: [echoed], answers: { claudeSignIn: ['skip'] } });

    const result = await runWith(where, 'york', mode === 'a debug' ? ['--debug'] : []);

    assert.equal(result.code, 0, result.stdout + result.stderr);
    const log = (await readOnlyLog(where.home)).text;
    for (const line of [...claudesLines, prompt.trimEnd(), loginFailed]) assert.ok(log.includes(`Claude Code: sign-in said: ${line}`), `${line}\n\n${log}`);
    assert.ok(!log.includes('a1B2c3D4e5F6g7H8') && !log.includes('state-9z8y7x'), log);
  });
}

test('a sign-in that works the first time asks nothing more and carries on as normal', async (t) => {
  const { where, logins, t3Starts } = await aLaptopSignedOut(t, { status: [signedOut, signedIn], login: [goodLogin] });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal((await logins()).length, 1);
  checklistSays(result.stdout, 'Claude Code', '2.1.317, signed in as jo.bloggs@york.ac.uk');
  const log = (await readOnlyLog(where.home)).text;
  assert.doesNotMatch(log, /claudeSignIn/);
  assert.match(log, /Claude Code: sign-in said: Login successful\./);
  assert.equal((await t3Starts()).length, 1, 'the ending opens T3 Code');
  assert.ok(!flowing(result.stdout).includes(skippedEnding), result.stdout);
});
