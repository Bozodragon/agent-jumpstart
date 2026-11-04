import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { claudeFolder, fakeMachine, makeHome, readOnlyLog, readProfile, runWith, seedSettings, skillsCli, supplyDownloads, supplyT3, t3Leaves } from './harness.js';

const signedIn = { output: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'jo.bloggs@york.ac.uk' }) };

/** The printed output with the boxes' borders and line breaks taken out, as one line of text. @param {string} stdout */
const flowing = (stdout) => stdout.replace(/[│|]/g, ' ').replace(/\s+/g, ' ');

/** The last line the person sees, without the guide line's symbols before it. @param {string} stdout */
const lastLine = (stdout) =>
  stdout
    .split(/\r?\n/)
    .map((line) => line.replace(/^[^\w/]+/, '').trim())
    .filter((line) => line !== '')
    .at(-1);

/** @param {string} home @param {string[]} paths relative to the home */
async function seed(home, paths) {
  for (const path of paths) {
    await mkdir(dirname(join(home, path)), { recursive: true });
    await writeFile(join(home, path), 'already here');
  }
}

/**
 * A laptop on which every step works: Node.js, Git and the GitHub CLI already on the machine
 * PATH, the skills CLI installable and each skill arriving, Claude Code there and signed in.
 * T3 Code is left to each test.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, unknown>} [answers]
 */
async function aLaptopWhereEverythingWorks(t, answers = { channel: 'stable' }) {
  const where = await makeHome(t, answers);
  const profile = await readProfile('york');
  await supplyDownloads(where, ['skills']);
  const theirs = join(where.home, 'Program Files', 'Tools');
  await seed(where.home, [join('Program Files', 'Tools', 'node.exe'), join('Program Files', 'Tools', 'git.exe'), join('Program Files', 'Tools', 'gh.exe')]);
  await seed(where.home, [join('.local', 'bin', 'claude.exe')]);
  const cli = skillsCli(where.home);
  /** @type {Record<string, string>} */
  const skillFiles = {};
  for (const { names, source } of profile.skills) {
    for (const name of names ?? [source.split('/').at(-1)]) skillFiles[join('.claude', 'skills', name, 'SKILL.md')] = `# ${name}`;
  }
  const machine = fakeMachine(where.home);
  await machine.setMachinePath([theirs]);
  /** @type {Record<string, import('../src/machine.js').Reply>} */
  const replies = {
    ...cli.install,
    [cli.key('add')]: { writes: skillFiles },
    'node.exe --version': { output: 'v26.12.1\r\n' },
    'git.exe --version': { output: 'git version 2.56.0.windows.4\n' },
    'gh.exe --version': { output: 'gh version 2.103.1 (2026-10-01)\n' },
    'claude.exe --version': { output: '2.1.311 (Claude Code)\n' },
    'claude.exe auth status': signedIn,
  };
  return { where, machine, replies, t3Program: join(where.home, t3Leaves.program) };
}

/**
 * The runs that started T3 Code's own program (not its installer, nor its shim).
 * @template {{ file: string }} Run
 * @param {Run[]} runs @param {string} program
 */
const startsOf = (runs, program) => runs.filter((run) => run.file === program);

test('a first run where every step works says what to do next, opens nothing more, and ends with all done', async (t) => {
  const { where, machine, replies, t3Program } = await aLaptopWhereEverythingWorks(t);
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  // T3's silent install starts T3, which leaves its shim.
  await machine.setReplies({ ...replies, [`${installer} /S --force-run`]: { creates: [t3Leaves.program, t3Leaves.shim] } });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const text = flowing(result.stdout);
  assert.ok(text.includes('What to do next'), result.stdout);
  assert.ok(text.includes('In T3 Code, open Claude, your top workspace, and start a new conversation there. Type /jumpstart and press Enter.'), result.stdout);
  assert.doesNotMatch(text, /didn't work/);
  assert.equal(lastLine(result.stdout), 'All done.', result.stdout);
  // Its installer started it already, so a second one isn't started.
  assert.deepEqual(startsOf(await machine.runs(), t3Program), []);
  assert.match((await readOnlyLog(where.home)).text, /Ending: T3 Code isn't opened again: its install just started it/);
});

test('a first run where T3 Code\'s installer didn\'t start it opens it at the end', async (t) => {
  const { where, machine, replies, t3Program } = await aLaptopWhereEverythingWorks(t);
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  await machine.setReplies({ ...replies, [`${installer} /S --force-run`]: { creates: [t3Leaves.program] } });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const started = startsOf(await machine.runs(), t3Program);
  assert.equal(started.length, 1, JSON.stringify(await machine.runs(), null, 2));
  assert.equal(started[0].leftRunning, true);
  assert.ok(flowing(result.stdout).includes('Opening T3 Code'), result.stdout);
});

test('a re-run opens T3 Code at the end, as a first run does, with the fresh PATH', async (t) => {
  const { where, machine, replies, t3Program } = await aLaptopWhereEverythingWorks(t);
  const profile = await readProfile('york');
  const myDrive = join(where.home, 'My Drive');
  const top = join(myDrive, profile.workspaces.top);
  await seedSettings(where.home, {
    profile: 'york',
    googleDriveFolder: myDrive,
    workspacesLocation: myDrive,
    topWorkspace: top,
    channel: 'stable',
    github: false,
    workspaces: ['Thinking space', 'Personal assistant'],
    connectors: ['Gmail'],
    extraTools: [],
    switchOffMemory: true,
  });
  await mkdir(top, { recursive: true });
  // T3 Code as the first run left it: installed and opened once.
  await seed(where.home, [t3Leaves.program, t3Leaves.shim]);
  await machine.setReplies({ ...replies, 't3.cmd project add': { code: 1, output: 'Project already exists' } });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Using your answers from last time/);
  const started = startsOf(await machine.runs(), t3Program);
  assert.equal(started.length, 1, JSON.stringify(await machine.runs(), null, 2));
  assert.deepEqual(started[0].args, []);
  assert.equal(started[0].leftRunning, true);
  assert.ok(started[0].path.includes(claudeFolder(where.home)), started[0].path);
  assert.equal(lastLine(result.stdout), 'All done.', result.stdout);
});

test("a step that didn't work is repeated at the end, with why, and named in the closing line", async (t) => {
  const { where, machine, replies, t3Program } = await aLaptopWhereEverythingWorks(t);
  await supplyT3(where.downloads, 'latest.yml', '0.1.2', { wrongHash: true });
  await machine.setReplies(replies);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const text = flowing(result.stdout);
  const ending = text.slice(text.lastIndexOf('Checklist'));
  // After the checklist, so it can't have scrolled out of sight.
  assert.ok(ending.includes("T3 Code: Not installed: the download didn't match T3's checksum"), result.stdout);
  assert.ok(ending.includes("Claude, not in T3 Code: it isn't installed"), result.stdout);
  assert.ok(ending.includes('Paste the same line again to try again what didn\'t work. It skips everything that\'s already done.'), result.stdout);
  assert.doesNotMatch(ending, /\/jumpstart/);
  assert.equal(lastLine(result.stdout), "These steps didn't work: T3 Code and Workspaces.", result.stdout);
  assert.doesNotMatch(result.stdout, /All done/);
  assert.deepEqual(startsOf(await machine.runs(), t3Program), []);
});

test("a single step that didn't work is named in the closing line on its own", async (t) => {
  const { where, machine, replies } = await aLaptopWhereEverythingWorks(t, { channel: 'stable', github: true });
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  // GitHub's sign-in doesn't finish; everything else works.
  await machine.setReplies({ ...replies, [`${installer} /S --force-run`]: { creates: [t3Leaves.program, t3Leaves.shim] }, 'gh.exe auth status': { code: 1 } });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const text = flowing(result.stdout);
  assert.ok(text.slice(text.lastIndexOf('Checklist')).includes('GitHub: Not signed in'), result.stdout);
  // The rest worked, so Jumpstart is still the next step.
  assert.ok(text.includes('Type /jumpstart and press Enter.'), result.stdout);
  assert.equal(lastLine(result.stdout), "One step didn't work: GitHub.", result.stdout);
});
