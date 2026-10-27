import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { fakeMachine, fileName, makeHome, programsFolder, readOnlyLog, readProfile, readSettings, runWith, seedSettings, supplyDownloads, supplyT3, t3Leaves, t3Projects } from './harness.js';

/** @param {string} stdout @param {string} label @param {string} value */
function checklistSays(stdout, label, value) {
  const line = stdout.split('\n').find((row) => row.includes(label) && row.includes(value));
  assert.ok(line, `expected a checklist line "${label} … ${value}" in:\n${stdout}`);
}

/**
 * Leaves files as an earlier run (or the person) would have.
 * @param {string} home @param {Record<string, string>} files contents by path, absolute or relative to the home
 */
async function seed(home, files) {
  for (const [path, contents] of Object.entries(files)) {
    const file = isAbsolute(path) ? path : join(home, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
}

/**
 * An answers file that stops the run if any question is put to it: every answer is wrong, so
 * a run that gets past the questions asked none of them.
 * @param {string} answersFile
 */
async function refuseEveryQuestion(answersFile) {
  const asked = 'a question was asked';
  const keys = ['googleDriveFolder', 'workspacesLocation', 'channel', 'github', 'workspaces', 'connectors', 'extraTools'];
  await writeFile(answersFile, JSON.stringify(Object.fromEntries(keys.map((key) => [key, asked]))));
}

test('a second run with a settings file present asks none of the four questions and keeps those answers', async (t) => {
  const where = await makeHome(t);
  const profile = await readProfile('york');
  const myDrive = join(where.home, 'My Drive');
  const earlier = {
    profile: 'york',
    googleDriveFolder: myDrive,
    workspacesLocation: myDrive,
    channel: 'nightly',
    github: true,
    workspaces: ['Personal assistant'],
    connectors: ['Gmail', 'Asana'],
    extraTools: ['apps-script'],
    email: 'jo.bloggs@york.ac.uk',
  };
  await seedSettings(where.home, earlier);
  await refuseEveryQuestion(where.answersFile);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  // Claude isn't there in this home, so the email it last saw is no longer confirmed. The top
  // workspace's path is worked out from the answers, so a settings file without it gains it.
  assert.deepEqual(await readSettings(where.home), { ...earlier, email: null, topWorkspace: join(myDrive, profile.workspaces.top), skillsInstalled: [] });
  assert.match(result.stdout, /Using your answers from last time/);
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes('Known from settings: channel: "nightly"'), log.text);
});

test('a settings file missing an answer, or holding one the profile no longer offers, asks only that question', async (t) => {
  const where = await makeHome(t);
  const myDrive = join(where.home, 'My Drive');
  // From before the extra tools were asked, with a workspace since taken out of the profile.
  await seedSettings(where.home, {
    profile: 'york',
    googleDriveFolder: myDrive,
    workspacesLocation: myDrive,
    channel: 'nightly',
    github: false,
    workspaces: ['Personal assistant', 'Recruitment'],
    connectors: ['Gmail'],
  });
  await writeFile(where.answersFile, JSON.stringify({ channel: 'stable', workspaces: ['Thinking space'], extraTools: ['apps-script'] }));

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.equal(settings.channel, 'nightly', 'known, so not asked');
  assert.deepEqual(settings.workspaces, ['Thinking space'], 'asked again: one of them is no longer offered');
  assert.deepEqual(settings.extraTools, ['apps-script'], 'asked: it was never answered');
});

test('a tool at another version is moved to the pinned one, a tool at the pinned version is left alone, and each row says which', async (t) => {
  const where = await makeHome(t);
  const manifest = await supplyDownloads(where);
  const [node, git, gh] = ['node', 'git', 'gh'].map((id) => manifest.tools.find((/** @type {any} */ tool) => tool.id === id));
  const programs = programsFolder(where.home);
  // An older Node from an earlier run, the pinned gh, and no Git yet.
  await seed(where.home, { [join(programs, 'nodejs', 'node.exe')]: 'the older copy', [join(programs, 'GitHub CLI', 'bin', 'gh.exe')]: 'the copy already there' });
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    'node.exe --version': { output: 'v24.11.0\r\n' },
    'gh.exe --version': { output: `gh version ${gh.version} (2026-10-01)\nhttps://github.com/cli/cli/releases/tag/v${gh.version}\n` },
  });

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Node.js', `${node.version} (updated from 24.11.0)`);
  checklistSays(result.stdout, 'Git', `${git.version} (installed)`);
  checklistSays(result.stdout, 'GitHub CLI', `${gh.version} (already up to date)`);
  assert.equal(await readFile(join(programs, 'nodejs', 'node.exe'), 'utf8'), 'stand-in', 'the pinned Node replaced the older one');
  assert.equal(await readFile(join(programs, 'GitHub CLI', 'bin', 'gh.exe'), 'utf8'), 'the copy already there');
  const log = await readOnlyLog(where.home);
  assert.ok(log.text.includes('Node.js: replacing 24.11.0'), log.text);
});

/**
 * Every folder and file under a folder, each file with its contents and when it was last
 * written, so a test can tell that nothing in it was removed, rewritten or touched.
 * @param {string} folder
 */
async function snapshot(folder) {
  /** @type {Record<string, string>} */
  const entries = {};
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    entries[relative(folder, path)] = entry.isDirectory() ? 'folder' : `${await readFile(path, 'utf8')} @ ${(await stat(path)).mtimeMs}`;
  }
  return entries;
}

test('a re-run of a home set up earlier updates what is out of date, re-adds PATH entries, and leaves sign-ins, settings and folders alone', async (t) => {
  const where = await makeHome(t);
  const profile = await readProfile('york');
  const manifest = await supplyDownloads(where);
  const [node, git, gh, clasp, skillsCli] = ['node', 'git', 'gh', 'clasp', 'skills'].map((id) => manifest.tools.find((/** @type {any} */ tool) => tool.id === id));
  const nightly = '0.1.3-nightly.20261023.3579';
  await writeFile(join(where.downloads, 'releases'), JSON.stringify([{ tag_name: `v${nightly}`, draft: false, prerelease: true }]));
  const t3Installer = await supplyT3(where.downloads, 'nightly.yml', nightly);
  const programs = programsFolder(where.home);
  const myDrive = join(where.home, 'My Drive');
  const top = join(myDrive, profile.workspaces.top);
  const email = 'jo.bloggs@york.ac.uk';
  const uninstallKey = manifest.tools.find((/** @type {any} */ tool) => tool.id === 't3').install.versionIn;
  /** @type {string[]} */
  const skills = profile.skills.flatMap((/** @type {any} */ source) => source.names ?? [source.source.split('/').at(-1)]);

  // The home as an earlier run left it, with Git since bumped in the manifest.
  const earlier = {
    profile: 'york',
    googleDriveFolder: myDrive,
    workspacesLocation: myDrive,
    channel: 'nightly',
    github: true,
    workspaces: ['Personal assistant'],
    connectors: ['Gmail', 'Google Calendar'],
    extraTools: ['apps-script'],
    email,
    topWorkspace: top,
    skillsInstalled: skills,
  };
  await seedSettings(where.home, earlier);
  await refuseEveryQuestion(where.answersFile);
  await seed(where.home, {
    [join(programs, 'nodejs', 'node.exe')]: 'the copy already there',
    [join(programs, 'Git', 'cmd', 'git.exe')]: 'the older copy',
    [join(programs, 'GitHub CLI', 'bin', 'gh.exe')]: 'the copy already there',
    [join(programs, 'npm', 'clasp.cmd')]: 'the copy already there',
    [join(programs, 'skills-cli', 'skills.cmd')]: 'the copy already there',
    [join(programs, 't3code', 'T3 Code (Nightly).exe')]: 'the copy already there',
    [join('.t3', 'bin', 't3.cmd')]: 'left by T3',
    [join('.local', 'bin', 'claude.exe')]: 'installed from T3',
    [join('.claude', 'settings.json')]: JSON.stringify({ theme: 'dark', autoMemoryEnabled: false }, null, 2),
    ...Object.fromEntries(skills.map((name) => [join('.claude', 'skills', name, 'SKILL.md'), name])),
    // Workspaces Jumpstart has written into, and one the person made themselves.
    [join(top, 'CLAUDE.md')]: 'my agent instructions',
    [join(top, 'me.md')]: 'About me',
    [join(top, 'Personal assistant', 'CLAUDE.md')]: 'PA instructions',
    [join(top, 'Personal assistant', '.claude', 'settings.local.json')]: '{ "autoMemoryEnabled": false }',
    [join(top, 'Thinking space', 'ideas.md')]: 'half an idea',
    [join(myDrive, 'Budget 2026.xlsx')]: 'not ours',
  });
  await mkdir(join(top, 'Personal assistant', 'Drafts'));
  const foldersBefore = await snapshot(myDrive);

  // The user PATH as the person left it: gh's entry has gone, Git's has a trailing backslash.
  const userPathBefore = [
    'C:\\Already\\There',
    join(programs, 'nodejs'),
    `${join(programs, 'Git', 'cmd')}\\`,
    join(programs, 'npm'),
    join(where.home, '.local', 'bin'),
  ];
  const machine = fakeMachine(where.home);
  await machine.setEnvironment({ Path: userPathBefore.join(';'), CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
  // The earlier run added the top workspace to T3, as the fake machine recorded it.
  const addTop = ['project', 'add', top, '--title', profile.workspaces.top];
  await writeFile(join(where.home, 'fake-machine', 'runs.json'), JSON.stringify([{ file: join(where.home, t3Leaves.shim), args: addTop }]));
  await machine.setReplies({
    'node.exe --version': { output: `v${node.version}\r\n` },
    'git.exe --version': [{ output: 'git version 2.50.1.windows.1\n' }, { output: `git version ${git.version}\n` }],
    'gh.exe --version': { output: `gh version ${gh.version} (2026-10-01)\n` },
    'clasp.cmd --version': { output: `${clasp.version}\n` },
    'skills.cmd --version': { output: `${skillsCli.version}\n` },
    [`reg.exe query ${uninstallKey} /v DisplayVersion`]: { output: `    DisplayVersion    REG_SZ    ${nightly}\r\n` },
    'gh.exe auth status --hostname github.com': { output: 'Logged in to github.com account octocat (keyring)\n' },
    'gh.exe api user --jq .login': { output: 'octocat\n' },
    'clasp.cmd show-authorized-user': { output: `You are logged in as ${email}.\n` },
    'claude.exe --version': { output: '2.1.306 (Claude Code)\n' },
    'claude.exe auth status': { output: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email }) },
    // As T3 answers for a folder it already lists.
    [`t3.cmd ${addTop.join(' ')}`]: { code: 1, output: `An active project already exists for '${top}'.` },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Node.js', `${node.version} (already up to date)`);
  checklistSays(result.stdout, 'Git', `${git.version} (updated from 2.50.1.windows.1)`);
  checklistSays(result.stdout, 'GitHub CLI', `${gh.version} (already up to date)`);
  checklistSays(result.stdout, 'clasp', `${clasp.version} (already up to date), signed in as ${email}`);
  checklistSays(result.stdout, 'T3 Code', `${nightly} (nightly, already up to date)`);
  checklistSays(result.stdout, 'Claude Code', `2.1.306, signed in as ${email}`);
  checklistSays(result.stdout, 'GitHub', 'Signed in as octocat');
  checklistSays(result.stdout, 'Skills CLI', `${skillsCli.version} (already up to date)`);
  checklistSays(result.stdout, 'Skills', `All ${skills.length} installed`);
  checklistSays(result.stdout, 'Memory', "Claude's automatic memory is off");

  assert.deepEqual(await readSettings(where.home), earlier);
  // Every folder and file already there is untouched, and nothing new is made: the ticked
  // workspace is there, and the unticked one the person kept is left as it is.
  assert.deepEqual(await snapshot(myDrive), foldersBefore);
  // T3 still lists the top workspace once.
  assert.deepEqual(await t3Projects(where.home), [{ folder: top, title: profile.workspaces.top }]);
  checklistSays(result.stdout, 'Workspaces', `${profile.workspaces.top}, already in T3 Code`);

  // Missing entries come back at the end; those already there aren't added again.
  assert.deepEqual(await machine.userPath(), [...userPathBefore, join(programs, 'GitHub CLI', 'bin')]);

  const runs = await machine.runs();
  assert.deepEqual(runs.filter((run) => run.onScreen), [], 'no sign-in was run: Claude, GitHub and clasp were already signed in');
  assert.ok(runs.some((run) => basename(run.file) === fileName(git.downloads[process.arch].url)), 'the newer Git was installed');
  assert.equal(runs.some((run) => basename(run.file) === t3Installer), false, 'T3 was left alone');
  assert.equal(runs.some((run) => basename(run.file) === 'npm.cmd'), false, 'clasp was left alone');
  assert.equal(await readFile(join(programs, 'nodejs', 'node.exe'), 'utf8'), 'the copy already there');
  assert.equal(await readFile(join(programs, 'GitHub CLI', 'bin', 'gh.exe'), 'utf8'), 'the copy already there');

  const log = await readOnlyLog(where.home);
  assert.ok(!log.text.includes('GitHub sign-up page'), 'nobody is sent to sign up again');
  assert.ok(!log.text.includes('Settings page:'), 'nobody is sent to the Apps Script settings page again');
  assert.ok(!result.stdout.includes(profile.connectorsPage), 'nobody is sent to connect the same connectors again');
  checklistSays(result.stdout, 'Connectors', 'You said you connected Gmail and Google Calendar last time');
});

test("a settings file from another profile isn't used", async (t) => {
  const where = await makeHome(t);
  await seedSettings(where.home, { profile: 'default', workspacesLocation: join(where.home, 'Documents'), channel: 'nightly', github: true });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const settings = await readSettings(where.home);
  assert.equal(settings.profile, 'york');
  assert.equal(settings.channel, 'stable');
  assert.equal(settings.github, false);
});
