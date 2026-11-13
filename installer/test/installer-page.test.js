import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  claudeFolder,
  exists,
  fakeMachine,
  makeHome,
  program,
  readOnlyLog,
  readProfile,
  runWith,
  skillsCli,
  stateFolder,
  supplyDownloads,
  supplyT3,
  t3Leaves,
} from './harness.js';
import { addressFile, answerEverything, runOnPage } from './page-harness.js';

test('a run with no answers file serves the Installer page on 127.0.0.1, at an address with a secret in it, and its first event is the run starting', async (t) => {
  const where = await makeHome(t);

  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  const start = await page.next((event) => event.type === 'start');
  page.close();
  run.kill();
  await run.ended;

  assert.match(run.address, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{20,}\/$/);
  assert.equal(start.id, 1);
  assert.equal(start.title, 'Agent Jumpstart · York');
  const log = await readOnlyLog(where.home);
  assert.match(log.text, /Front end: the Installer page/);
});

test("the run's first event gives the page its profile's setup page and the line that copies the installer log", async (t) => {
  const where = await makeHome(t);
  const profile = await readProfile('york');

  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  const start = await page.next((event) => event.type === 'start');
  page.close();

  assert.equal(start.setupPage, profile.page);
  assert.equal(start.shareLogLine, profile.shareLogLine);
  assert.match(start.shareLogLine, /share-log\.ps1/);
});

test('a page connecting is told how far the run had got, so it can tell what had already happened from what happens next', async (t) => {
  const where = await makeHome(t);
  const run = await runOnPage(where, 'york');
  t.after(run.kill);

  const first = run.connect();
  const team = await first.next((event) => event.type === 'question' && event.key === 'team');
  // The run waits at the team question, so a page connecting now finds everything up to it had happened.
  const later = run.connect();
  await later.next((event) => event.id === team.id);
  assert.equal(later.before, team.id);
  assert.ok(first.before !== undefined && first.before <= team.id, `the first page was told ${first.before}`);
  for (const page of [first, later]) page.close();
});

/**
 * A York laptop on which every step works: Node.js, Git and the GitHub CLI already on the machine
 * PATH (the GitHub CLI not signed in yet, so GitHub is asked), the skills CLI installable and each
 * skill arriving, Claude Code there and signed in, and T3 Code's stable release in the downloads,
 * its first start leaving its shim.
 * @param {import('node:test').TestContext} t @param {Record<string, unknown>} [answers]
 */
async function aLaptopWhereEverythingWorks(t, answers = {}) {
  const where = await makeHome(t, answers);
  const profile = await readProfile('york');
  await supplyDownloads(where, ['skills']);
  await supplyT3(where.downloads, 'latest.yml', '0.0.30');
  const theirs = join(where.home, 'Program Files', 'Tools');
  for (const path of [join(theirs, 'node.exe'), join(theirs, 'git.exe'), join(theirs, 'gh.exe'), join(claudeFolder(where.home), 'claude.exe')]) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'already here');
  }
  const cli = skillsCli(where.home);
  /** @type {Record<string, string>} */
  const skillFiles = {};
  for (const { names, source } of profile.skills) {
    for (const name of names ?? [source.split('/').at(-1)]) skillFiles[join('.claude', 'skills', name, 'SKILL.md')] = `# ${name}`;
  }
  const machine = fakeMachine(where.home);
  await machine.setMachinePath([theirs]);
  await machine.setReplies({
    ...cli.install,
    [cli.key('add')]: { writes: skillFiles },
    'node.exe --version': { output: 'v26.12.1\r\n' },
    'git.exe --version': { output: 'git version 2.56.0.windows.4\n' },
    'gh.exe --version': { output: 'gh version 2.103.1 (2026-10-01)\n' },
    'gh.exe auth status --hostname github.com': { code: 1, output: 'You are not logged into any GitHub hosts.' },
    'claude.exe --version': { output: '2.1.311 (Claude Code)\n' },
    'claude.exe auth status': { output: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'jo.bloggs@york.ac.uk' }) },
    'T3-Code-0.0.30-x64.exe': { creates: [t3Leaves.program, t3Leaves.shim] },
    'T3-Code-0.0.30-arm64.exe': { creates: [t3Leaves.program, t3Leaves.shim] },
  });
  return where;
}

/**
 * What a run left behind, with the temporary folder it ran in written as `<root>`, so two runs in
 * two folders can be compared: the settings, the programs run, the pages opened, the user's
 * environment and the log's checklist.
 * @param {{ home: string }} where
 */
async function leftBehind(where) {
  const root = dirname(where.home);
  /** @param {string} text */
  const rooted = (text) => text.replaceAll(JSON.stringify(root).slice(1, -1), '<root>').replaceAll(root, '<root>');
  /** @param {string} path */
  const read = (path) => readFile(path, 'utf8').then(rooted, () => '(none)');
  const fake = join(where.home, 'fake-machine');
  const log = await readOnlyLog(where.home);
  return {
    settings: await read(join(stateFolder(where.home), 'settings.json')),
    runs: await read(join(fake, 'runs.json')),
    pages: await read(join(fake, 'pages.json')),
    environment: await read(join(fake, 'environment.json')),
    checklist: rooted(log.text)
      .split(/\r?\n/)
      .filter((line) => line.includes('Checklist: '))
      .map((line) => line.slice(line.indexOf('Checklist: '))),
  };
}

test('a whole setup done through the page conversation sets up exactly what the same answers in an answers file do', async (t) => {
  // With the experience answers, as a person on the page gives them, so the answers-file run looks
  // for a signed-in GitHub CLI before the questions too (one from before them deliberately doesn't).
  const answers = {
    team: 'Marketing',
    aiExperience: 'first-time',
    codingExperience: 'no',
    channel: 'stable',
    github: false,
    workspaces: ['Thinking space'],
    connectors: ['Gmail', 'Asana'],
    extraTools: [],
  };
  const fromFile = await aLaptopWhereEverythingWorks(t, answers);
  const onPage = await aLaptopWhereEverythingWorks(t);

  const filed = await runWith(fromFile, 'york');
  const run = await runOnPage(onPage, 'york');
  t.after(run.kill);
  const page = run.connect();
  const asked = await answerEverything(page, run.answer, answers);
  const result = await run.ended;

  assert.equal(filed.code, 0, filed.stdout + filed.stderr);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(await leftBehind(onPage), await leftBehind(fromFile));
  // Asked on the page, the team first, each question once; and where a person is, the run
  // waited for them to connect the connectors.
  const keys = asked.filter((question) => question.kind !== 'done').map((question) => question.key);
  assert.equal(keys[0], 'team');
  for (const key of ['aiExperience', 'codingExperience', 'topWorkspace', 'googleDriveFolder', 'github', 'workspaces', 'connectors']) assert.ok(keys.includes(key), `${key} wasn't asked: ${keys}`);
  // A first-timer isn't sent the questions their experience answers hide.
  for (const key of ['channel', 'fullSkills']) assert.ok(!keys.includes(key), `${key} was asked: ${keys}`);
  assert.equal(new Set(keys).size, keys.length, `a question was asked twice: ${keys}`);
  assert.ok(asked.some((question) => question.kind === 'done' && question.what === "you've connected them"));
  const finish = await page.next((event) => event.type === 'finish');
  assert.equal(finish.id, page.events.at(-1)?.id, 'the last event is the run finishing');
  assert.match(finish.text, /All done/);
  // The address is the page's only while the run lasts.
  assert.equal(await exists(addressFile(onPage.home)), false);
});

test('a second connection, or the same page reconnecting, gets every event so far in order, and the first answer to a question is the one that counts', async (t) => {
  const where = await makeHome(t);
  const run = await runOnPage(where, 'york');
  t.after(run.kill);

  const first = run.connect();
  const team = await first.next((event) => event.type === 'question' && event.key === 'team');
  const second = run.connect();
  await second.next((event) => event.id === team.id);
  assert.deepEqual(second.events, first.events.slice(0, second.events.length));
  assert.deepEqual(
    first.events.map((event) => event.id),
    first.events.map((_, index) => index + 1),
  );

  const won = await run.answer(team.question, 'Marketing');
  const lost = await run.answer(team.question, 'Systems, Data and Operations');
  assert.equal(won.status, 200);
  assert.equal(lost.status, 409);
  assert.match(lost.body.reason, /already been answered/);
  // Both windows move on, with the answer that counted.
  for (const page of [first, second]) {
    const answered = await page.next((event) => event.type === 'answered' && event.question === team.question);
    assert.equal(answered.answer, 'Marketing');
  }
  const next = await first.next((event) => event.type === 'question' && event.id > team.id);

  // A browser reconnecting by itself says which event it had last, and gets only those after it;
  // a page opened afresh gets them all, the answer among them.
  const reconnected = run.connect({ lastEventId: team.id });
  await reconnected.next((event) => event.id === next.id);
  assert.deepEqual(reconnected.events, first.events.filter((event) => event.id > team.id && event.id <= next.id));
  const fresh = run.connect();
  await fresh.next((event) => event.id === next.id);
  assert.deepEqual(fresh.events.slice(0, next.id), first.events.slice(0, next.id));
  for (const page of [first, second, reconnected, fresh]) page.close();
});

test("the page's server refuses a wrong secret and a wrong Host, answers /favicon.ico, and its page loads nothing from anywhere else", async (t) => {
  const where = await makeHome(t);
  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const secret = run.url.pathname;
  const page = run.connect();
  const team = await page.next((event) => event.type === 'question' && event.key === 'team');

  // Another secret, or none: nothing is served, and nothing can be answered.
  for (const path of ['/', '/index.html', '/events', '/not-the-secret/', '/not-the-secret/events', `${secret.slice(0, -2)}/`]) {
    assert.equal((await run.request(path)).status, 404, path);
  }
  const guessed = await run.request('/not-the-secret/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: team.question, answer: 'Marketing' }) });
  assert.equal(guessed.status, 404);
  // The right secret under any other name (a DNS rebinding) is refused too.
  for (const host of ['localhost', `localhost:${run.url.port}`, `evil.example:${run.url.port}`, '127.0.0.1', `127.0.0.1:${Number(run.url.port) + 1}`]) {
    assert.equal((await run.request(secret, { headers: { Host: host } })).status, 421, host);
    assert.equal((await run.request(`${secret}events`, { headers: { Host: host } })).status, 421, host);
  }
  // A post from another web page, which a browser says by its Origin, is refused.
  const elsewhere = await run.request(`${secret}answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ question: team.question, answer: 'Marketing' }),
  });
  assert.equal(elsewhere.status, 403);
  assert.ok(!page.events.some((event) => event.type === 'answered'), 'nothing was answered');

  const favicon = await run.request('/favicon.ico');
  assert.ok(favicon.status < 300, `favicon: ${favicon.status}`);

  // The page and every file it names are served from the Installer, by relative addresses, with a
  // policy that lets the browser load and connect to nothing else.
  const index = await run.request(secret);
  assert.equal(index.status, 200);
  assert.match(String(index.headers['content-type']), /^text\/html/);
  const policy = String(index.headers['content-security-policy']);
  assert.match(policy, /default-src 'none'/);
  for (const kind of ['script-src', 'style-src', 'font-src', 'connect-src']) assert.match(policy, new RegExp(`${kind} 'self'(;|$)`), kind);
  const named = [...index.body.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(named.sort(), ['app.js', 'style.css']);
  const style = await run.request(`${secret}style.css`);
  const fonts = [...style.body.matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.ok(fonts.length >= 4, style.body);
  for (const address of [...named, ...fonts]) {
    assert.doesNotMatch(address, /^(\w+:|\/)/, `${address} is relative`);
    const served = await run.request(`${secret}${address}`);
    assert.equal(served.status, 200, address);
    assert.equal(served.headers['content-security-policy'], policy, address);
  }
  assert.ok(fonts.some((font) => /instrument-sans/.test(font)) && fonts.some((font) => /jetbrains-mono/.test(font)), fonts.join(', '));
  page.close();
});

test("a folder the Installer won't take goes back to the page with the reason, and the question stays open until one it will", async (t) => {
  const where = await makeHome(t);
  const run = await runOnPage(where, 'york');
  t.after(run.kill);
  const page = run.connect();
  const answer = async (/** @type {string} */ key, /** @type {unknown} */ value) => {
    const question = await page.next((event) => event.type === 'question' && event.key === key);
    return { question, reply: await run.answer(question.question, value) };
  };
  await answer('team', 'Marketing');
  await answer('aiExperience', 'first-time');
  await answer('codingExperience', 'no');
  await answer('topWorkspace', 'new');

  const missing = join(where.home, 'Not My Drive');
  const { question, reply } = await answer('googleDriveFolder', missing);
  assert.equal(reply.status, 422);
  assert.equal(reply.body.reason, `There is no folder at ${missing}.`);
  const refused = await page.next((event) => event.type === 'refused' && event.question === question.question);
  assert.deepEqual({ answer: refused.answer, reason: refused.reason }, { answer: missing, reason: `There is no folder at ${missing}.` });

  const relative = await run.answer(question.question, 'My Drive');
  assert.equal(relative.status, 422);
  assert.equal(relative.body.reason, 'Give the whole path, starting with the drive letter.');

  // Typed with a space either side, as a paste can be: taken as the folder.
  const myDrive = join(where.home, 'My Drive');
  const taken = await run.answer(question.question, ` ${myDrive} `);
  assert.equal(taken.status, 200);
  const answered = await page.next((event) => event.type === 'answered' && event.question === question.question);
  assert.equal(answered.answer, myDrive);
  assert.ok(answered.id > refused.id);
  page.close();
});

test("a download's progress reaches the page as events under its busy step, rising to the whole size, and none of it reaches the log", async (t) => {
  const where = await makeHome(t);
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2', { size: 100_000 });
  await fakeMachine(where.home).setReplies({
    'powershell.exe': { creates: [join('.local', 'bin', 'claude.exe')] },
    [`${installer} /S --force-run`]: { creates: [t3Leaves.program, t3Leaves.shim] },
    'claude.exe --version': { output: '2.1.306 (Claude Code)\n' },
    'claude.exe auth status': { output: JSON.stringify({ loggedIn: true, email: 'jo.bloggs@york.ac.uk' }) },
  });

  const run = await runOnPage(where, 'york', [], { internet: { folder: where.downloads, chunk: 10_000, pause: 60 } });
  t.after(run.kill);
  const page = run.connect();
  await answerEverything(page, run.answer, { channel: 'stable' });
  const result = await run.ended;

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const busy = await page.next((event) => event.type === 'busy' && /^Installing T3 Code/.test(event.message));
  const progress = page.events.filter((event) => event.type === 'progress' && event.busy === busy.id);
  const received = progress.map((event) => event.received);
  assert.ok(progress.length >= 3, `it rose in steps, not all at once: ${received.join(', ')}`);
  assert.ok(progress.length <= 15, `a few times a second at most, not once per piece: ${received.join(', ')}`);
  assert.deepEqual(received, [...received].sort((a, b) => a - b));
  assert.deepEqual(progress.at(-1), { ...progress.at(-1), received: 100_000, total: 100_000 });
  const ended = await page.next((event) => event.type === 'ended' && event.busy === busy.id);
  assert.ok(ended.id > (progress.at(-1)?.id ?? Infinity) && ended.ok, JSON.stringify(ended));
  const log = await readOnlyLog(where.home);
  assert.doesNotMatch(log.text, /\d%|received/);
});

test("as the run ends, the server waits for each connected page to say it has the last event, or about 2 seconds, then closes", async (t) => {
  // A run that fails once the questions are answered, when it first writes its settings (made a
  // folder here), so its last events are the problem and the run's last words.
  /** @param {boolean} confirms */
  const failAfterTheQuestions = async (confirms) => {
    const where = await makeHome(t);
    await mkdir(join(stateFolder(where.home), 'settings.json'), { recursive: true });
    const run = await runOnPage(where, 'york');
    t.after(run.kill);
    const page = run.connect();
    await answerEverything(page, run.answer);
    const finish = await page.next((event) => event.type === 'finish');
    const from = performance.now();
    if (confirms) await page.seen(finish.id);
    const result = await run.ended;
    const waited = performance.now() - from;
    await page.reading;
    return { result, waited, finish, page, where };
  };

  const confirmed = await failAfterTheQuestions(true);
  assert.equal(confirmed.result.code, 1);
  const problem = await confirmed.page.next((event) => event.type === 'problem');
  assert.match(problem.text, /Something went wrong that the Installer didn't expect/);
  assert.match(confirmed.finish.text, /The Installer has stopped/);
  assert.equal(confirmed.page.events.at(-1)?.id, confirmed.finish.id, 'the run finishing is the last event');
  assert.ok(confirmed.waited < 1500, `it closed once the page had the last event, after ${Math.round(confirmed.waited)} ms`);
  assert.ok(confirmed.page.closed, 'the stream was closed');

  const unconfirmed = await failAfterTheQuestions(false);
  assert.equal(unconfirmed.result.code, 1);
  assert.ok(unconfirmed.waited >= 1500 && unconfirmed.waited < 6000, `it waited about 2 seconds for a page that never said, then closed: ${Math.round(unconfirmed.waited)} ms`);
  assert.equal(await exists(addressFile(unconfirmed.where.home)), false);
});

test('a run with --terminal, or with an answers file, stays in the window with the terminal front end and serves no page', async (t) => {
  const filed = await makeHome(t, { channel: 'stable' });
  const fromFile = await runWith(filed, 'york');
  assert.equal(fromFile.code, 0, fromFile.stderr);
  assert.match((await readOnlyLog(filed.home)).text, /Window: not Windows Terminal, most likely the old console/);
  assert.doesNotMatch(fromFile.stdout, /Installer page/);

  // With --terminal and nobody's answers, the questions are asked in the window. Nothing is typed
  // here, so the first one is all there is to see.
  const terminal = await makeHome(t);
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.WT_SESSION;
  const child = spawn(process.execPath, [program, '--profile', 'york', '--terminal', '--home', terminal.home, '--downloads', terminal.downloads], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  t.after(() => child.kill());
  let stdout = '';
  await new Promise((resolve, reject) => {
    const giveUp = setTimeout(() => reject(new Error(`no question in the window:\n${stdout}`)), 20_000);
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('Which team are you in?')) resolve(clearTimeout(giveUp));
    });
  });
  child.kill();
  await new Promise((resolve) => child.once('close', resolve));
  assert.doesNotMatch(stdout, /Installer page/);
  assert.equal(await exists(addressFile(terminal.home)), false);
  assert.match((await readOnlyLog(terminal.home)).text, /Window: not Windows Terminal/);
});
