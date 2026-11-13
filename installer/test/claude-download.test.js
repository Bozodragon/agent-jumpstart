// The Installer downloads Claude Code itself: the version from Anthropic's `latest`, the
// platform's checksum and size from that version's manifest, the binary with a percentage, a
// SHA-256 check, then `claude.exe install latest`. If the version, the manifest, the download or
// the checksum fails, Anthropic's script installs it instead, quietly. With `--downloads`, all
// three files come from the folder (laid out as on Anthropic's server) and nothing falls back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { checklistSays, claudeProgram, fakeMachine, makeHome, readOnlyLog, runOnline, runWith, stateFolder, supplyClaude, supplyT3, t3Leaves } from './harness.js';

const signedIn = { output: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'jo.bloggs@york.ac.uk' }) };

/** The Installer's own downloads folder. @param {string} home */
const downloadsFolder = (home) => join(stateFolder(home), 'downloads');

/** Replies for a laptop with no Claude Code, whose `claude install` puts it in place. */
const installs = {
  'claude.exe install': { output: 'Setting up Claude Code...\nClaude Code successfully installed!\n', creates: [claudeProgram] },
  'claude.exe --version': { output: '2.1.400 (Claude Code)\n' },
  'claude.exe auth status': signedIn,
};

test('with the three files in the downloads folder, Claude Code is installed with `install latest` from its own download, which is then deleted', async (t) => {
  const where = await makeHome(t);
  const machine = fakeMachine(where.home);
  await machine.setReplies(installs);

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Claude Code', '2.1.400, signed in as jo.bloggs@york.ac.uk');
  const runs = await machine.runs();
  const install = runs.find((run) => basename(run.file) === 'claude.exe' && run.args[0] === 'install');
  assert.ok(install, JSON.stringify(runs.map((run) => [run.file, ...run.args])));
  assert.equal(install.file, join(downloadsFolder(where.home), 'claude.exe'));
  assert.deepEqual(install.args, ['install', 'latest']);
  assert.equal(install.onScreen, undefined, "not in the person's window");
  assert.ok(!runs.some((run) => basename(run.file) === 'powershell.exe'), "Anthropic's script isn't run");
  assert.deepEqual(await readdir(downloadsFolder(where.home)), [], 'the download is deleted');
  assert.match(result.stdout, /Downloading Claude Code/);
  assert.match(result.stdout, /Setting up Claude Code/);
  assert.doesNotMatch(result.stdout, /over 300 MB/);
});

test('a debug run keeps the downloaded Claude Code in the installer\'s folder, and says so in the log', async (t) => {
  const where = await makeHome(t);
  await fakeMachine(where.home).setReplies(installs);

  const result = await runWith(where, 'york', ['--debug']);

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(await readdir(downloadsFolder(where.home)), ['claude.exe']);
  assert.ok((await readOnlyLog(where.home)).text.includes(`Claude Code: kept ${join(downloadsFolder(where.home), 'claude.exe')}`));
});

/** Anthropic's own install script, run as Anthropic says to, in Windows PowerShell from System32. */
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const installScript = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'];

/**
 * A laptop with no Claude Code, run with no downloads folder: Claude Code's release files are on
 * the fake internet, as `supplyClaude` lays them out with these options, and Anthropic's script
 * and `claude install` would each put it in place.
 * @param {import('node:test').TestContext} t
 * @param {Parameters<typeof supplyClaude>[2]} [release]
 * @param {Record<string, object>} [replies] more fake replies
 * @param {object} [answers]
 */
async function online(t, release = {}, replies = {}, answers = {}) {
  const where = await makeHome(t, answers);
  const internet = join(where.downloads, '..', 'internet');
  await mkdir(internet);
  await supplyClaude(internet, '2.1.400', release);
  const machine = fakeMachine(where.home);
  await machine.setReplies({ ...installs, 'powershell.exe': { creates: [claudeProgram] }, ...replies });
  return { where, internet, machine };
}

for (const { failure, release, internet, reason } of [
  { failure: "a reply from `latest` that isn't a version", release: { latest: '<html>Service unavailable</html>' }, reason: "its latest version couldn't be read" },
  { failure: 'a missing manifest', release: { noManifest: true }, reason: 'https://downloads.claude.ai/claude-code-releases/2.1.400/manifest.json couldn\'t be read' },
  { failure: 'a download cut short', release: { size: 50_000 }, internet: { chunk: 10_000, cutShort: { 'claude.exe': 20_000 } }, reason: "it couldn't be downloaded (terminated)" },
  { failure: 'a checksum mismatch', release: { wrongChecksum: true }, reason: "the download didn't match Anthropic's checksum" },
]) {
  test(`${failure} falls back to Anthropic's script, with no problem shown, and the reason only in the log`, async (t) => {
    const { where, internet: folder, machine } = await online(t, release);

    const result = await runOnline(where, 'york', { folder, ...internet });

    assert.equal(result.code, 0, result.stdout + result.stderr);
    checklistSays(result.stdout, 'Claude Code', '2.1.400, signed in as jo.bloggs@york.ac.uk');
    const runs = await machine.runs();
    const script = runs.filter((run) => run.file === powershell);
    assert.equal(script.length, 1, JSON.stringify(runs.map((run) => [run.file, ...run.args])));
    assert.deepEqual(script[0].args, installScript);
    assert.ok(!runs.some((run) => basename(run.file) === 'claude.exe' && run.args[0] === 'install'), 'no claude install');
    assert.match(result.stdout, /Installing Claude Code\. It's over 300 MB, so this can take several minutes/);
    // The other pinned tools aren't on the fake internet, so their rows say they couldn't be downloaded.
    assert.ok(!result.stdout.includes(reason), `the reason isn't shown:\n${result.stdout}`);
    assert.doesNotMatch(result.stdout, /Claude Code isn't installed|Try again/);
    // No problem notice at all (a line marked x) while Claude Code is installed, before T3 Code's step.
    const during = result.stdout.slice(result.stdout.indexOf('Checking Claude Code'), result.stdout.indexOf('Installing T3 Code'));
    assert.ok(during.includes('Installing Claude Code'), result.stdout);
    assert.doesNotMatch(during, /^x {2}/m, `no problem notice:\n${during}`);
    const { text } = await readOnlyLog(where.home);
    assert.ok(text.includes(`Claude Code: falling back to Anthropic's script, because ${reason}`), text);
    assert.match(text, /Claude Code: installed by Anthropic's script \(code 0\)/);
    assert.deepEqual(await readdir(downloadsFolder(where.home)).catch(() => []), [], 'nothing is left in the downloads folder');
  });
}

const skippedEnding =
  "One step didn't work: Claude Code isn't installed, so T3 Code can't use it yet. If T3 Code is open, close it. Then paste the line again: it installs it and skips everything that's already done.";

/** The printed output with the boxes' borders and line breaks taken out, as one line of text. @param {string} stdout */
const flowing = (stdout) => stdout.replace(/[│|]/g, ' ').replace(/\s+/g, ' ');

/** @param {{ file: string, args: string[] }[]} runs */
const installsOf = (runs) => runs.filter((run) => basename(run.file) === 'claude.exe' && run.args[0] === 'install');

for (const { failure, release, reason } of [
  { failure: "a `latest` that isn't a version", release: { latest: 'not a version' }, reason: "its latest version couldn't be read" },
  { failure: 'a missing manifest', release: { noManifest: true }, reason: "it wasn't in the downloads folder" },
  { failure: 'a missing claude.exe', release: { noBinary: true }, reason: "it wasn't in the downloads folder" },
  { failure: 'a checksum mismatch', release: { wrongChecksum: true }, reason: "the download didn't match Anthropic's checksum" },
]) {
  test(`with the files from the downloads folder, ${failure} never falls back to Anthropic's script`, async (t) => {
    const where = await makeHome(t);
    await supplyClaude(where.downloads, '2.1.400', release);
    const machine = fakeMachine(where.home);
    await machine.setReplies({ ...installs, 'powershell.exe': { creates: [claudeProgram] } });

    const result = await runWith(where, 'york');

    assert.equal(result.code, 0, result.stdout + result.stderr);
    checklistSays(result.stdout, 'Claude Code', `Not installed: ${reason}`);
    const runs = await machine.runs();
    assert.ok(!runs.some((run) => run.file === powershell), "Anthropic's script isn't run");
    assert.deepEqual(installsOf(runs), []);
    assert.doesNotMatch((await readOnlyLog(where.home)).text, /falling back/);
  });
}

test("a failed `claude install` doesn't fall back to Anthropic's script, even with no downloads folder, and says why", async (t) => {
  const { where, internet, machine } = await online(t, {}, { 'claude.exe install': { code: 1, output: 'Error: could not write to .local\\bin' } });

  const result = await runOnline(where, 'york', { folder: internet });

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const runs = await machine.runs();
  assert.equal(installsOf(runs).length, 1);
  assert.ok(!runs.some((run) => run.file === powershell), "Anthropic's script isn't run");
  checklistSays(result.stdout, 'Claude Code', 'Not installed: its setup stopped with code 1');
  assert.match(flowing(result.stdout), /Claude Code isn't installed: its setup stopped with code 1\./);
  const { text } = await readOnlyLog(where.home);
  assert.match(text, /Claude Code: claude install latest finished with code 1/);
  assert.match(text, /\| Error: could not write to \.local\\bin/, "what it said is logged, as any program's that fails");
  assert.doesNotMatch(text, /falling back/);
  assert.deepEqual(await readdir(downloadsFolder(where.home)), [], 'the download is deleted all the same');
});

test("a `claude install` that exits 0 but leaves no Claude Code doesn't fall back either, and says why", async (t) => {
  const { where, internet, machine } = await online(t, {}, { 'claude.exe install': { output: 'Done.' } });

  const result = await runOnline(where, 'york', { folder: internet });

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.ok(!(await machine.runs()).some((run) => run.file === powershell), "Anthropic's script isn't run");
  checklistSays(result.stdout, 'Claude Code', "Not installed: its setup didn't leave it in place");
  assert.match(flowing(result.stdout), /Claude Code isn't installed: its setup didn't leave it in place\./);
  const { text } = await readOnlyLog(where.home);
  assert.match(text, /Claude Code: claude install said: Done\./);
  assert.match(text, /Claude Code: .*claude\.exe isn't there after claude install/);
});

test('Try again, after both routes fail, starts again from the beginning, and goes on as normal once Claude Code is installed', async (t) => {
  // Anthropic's manifest is missing, so its own download fails each time, and the script fails once.
  const { where, internet, machine } = await online(t, { noManifest: true }, { 'powershell.exe': [{ code: 1 }, { creates: [claudeProgram] }] }, { claudeInstall: ['again'] });

  const result = await runOnline(where, 'york', { folder: internet });

  assert.equal(result.code, 0, result.stdout + result.stderr);
  checklistSays(result.stdout, 'Claude Code', '2.1.400, signed in as jo.bloggs@york.ac.uk');
  assert.equal((await machine.runs()).filter((run) => run.file === powershell).length, 2);
  const { text } = await readOnlyLog(where.home);
  assert.equal(text.match(/Claude Code: reading .*\/latest$/gm)?.length, 2, 'its own download is tried again from the version');
  assert.equal(text.match(/Answer: claudeInstall: "again"/g)?.length, 1, text);
  assert.doesNotMatch(flowing(result.stdout), /isn't installed, so T3 Code can't use it yet/);
});

for (const { who, answers } of [
  { who: 'Skip for now', answers: { claudeInstall: ['skip'] } },
  { who: 'an answers-file run that says nothing about it', answers: {} },
]) {
  test(`${who}, after both routes fail, gives the skipped sign-in's ending: no All done, T3 Code not opened, and a note to paste the line again`, async (t) => {
    const where = await makeHome(t, { channel: 'stable', ...answers });
    const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.3');
    const machine = fakeMachine(where.home);
    await machine.setReplies({
      'claude.exe install': { code: 1 },
      [`${installer} /S --force-run`]: { creates: [t3Leaves.program, t3Leaves.shim] },
      [`${installer} /S`]: { creates: [t3Leaves.program] },
    });

    const result = await runWith(where, 'york');

    assert.equal(result.code, 0, result.stdout + result.stderr);
    checklistSays(result.stdout, 'Claude Code', 'Not installed: its setup stopped with code 1');
    assert.equal(installsOf(await machine.runs()).length, 1, 'tried once');
    const ending = flowing(result.stdout);
    assert.ok(ending.includes(skippedEnding), result.stdout);
    assert.doesNotMatch(ending, /All done/);
    const t3 = (await machine.runs()).filter((run) => basename(run.file) === installer || run.file === join(where.home, t3Leaves.program));
    assert.deepEqual(t3.map((run) => run.args), [['/S']], "T3 Code is installed without starting, and isn't opened");
    const { text } = await readOnlyLog(where.home);
    assert.match(text, /Answer: claudeInstall: "skip"/);
    assert.match(text, /Claude Code: install skipped for now/);
    assert.match(text, /Ending: T3 Code isn't opened/);
    assert.doesNotMatch(text, /Ending: its setup stopped/, 'the reason is in its row, and not repeated on a line of its own');
  });
}

const releases = 'https://downloads.claude.ai/claude-code-releases';
const platform = process.arch === 'arm64' ? 'win32-arm64' : 'win32-x64';

test("the log has a line for each step of Claude Code's own download, and none for how far it had got", async (t) => {
  const { where, internet } = await online(t, { size: 200_000 });

  const result = await runOnline(where, 'york', { folder: internet, chunk: 10_000 });

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const lines = (await readOnlyLog(where.home)).text.split(/\r?\n/).filter((line) => line.includes('Claude Code: '));
  const said = lines.map((line) => line.slice(line.indexOf('Claude Code: ') + 'Claude Code: '.length));
  const expected = [
    `reading ${releases}/latest`,
    'the latest version is 2.1.400',
    `reading ${releases}/2.1.400/manifest.json`,
    new RegExp(`^${platform}: 200000 bytes expected, SHA-256 [0-9a-f]{64}$`),
    `downloading ${releases}/2.1.400/${platform}/claude.exe`,
    `downloaded to ${join(downloadsFolder(where.home), 'claude.exe')}`,
    /^200000 bytes received of the 200000 expected, in \d+\.\d s$/,
    "checksum matches Anthropic's",
    'claude install latest finished with code 0',
    'claude install said: Setting up Claude Code...',
    'claude install said: Claude Code successfully installed!',
    'installed by its own download',
  ];
  let at = said.indexOf(`reading ${releases}/latest`);
  assert.notEqual(at, -1, said.join('\n'));
  for (const line of expected) {
    assert.ok(typeof line === 'string' ? said[at] === line : line.test(said[at]), `expected ${line} at line ${at} of:\n${said.join('\n')}`);
    at++;
  }
  assert.ok(!lines.some((line) => /\d%|MB/.test(line)), 'nothing about how far it had got');
});

test('a download cut short logs how many bytes came, of how many, and how long it took', async (t) => {
  const { where, internet } = await online(t, { size: 50_000 });

  const result = await runOnline(where, 'york', { folder: internet, chunk: 10_000, cutShort: { 'claude.exe': 20_000 } });

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const { text } = await readOnlyLog(where.home);
  assert.match(text, /Claude Code: download failed: terminated/);
  assert.match(text, /Claude Code: 20000 bytes received of the 50000 expected before it stopped, in \d+\.\d s/);
});

/**
 * Each drawing of the spinner lines that start with this message, without their colours. A line
 * is redrawn in place, each drawing after a carriage return.
 * @param {string} stdout @param {string} message
 */
const drawings = (stdout, message) =>
  stripVTControlCharacters(stdout)
    .split(/[\r\n]/)
    .filter((drawing) => drawing.includes(message));

/** The percentages shown in these drawings, in order. @param {string[]} drawn */
const percentages = (drawn) => drawn.flatMap((drawing) => [.../(\d+)% \[/.exec(drawing) ?? []].slice(1, 2)).map(Number);

for (const { from, release, internet, message } of [
  { from: "Anthropic's manifest, when the server doesn't give it", release: { size: 3_000_000 }, internet: { unsized: ['claude.exe'] }, message: 'Downloading Claude Code (3 MB)' },
  { from: "the server, when Anthropic's manifest doesn't give it", release: { size: 3_000_000, unsized: true }, internet: {}, message: 'Downloading Claude Code' },
]) {
  test(`in a terminal, the download shows a percentage that rises to 100%, against the size from ${from}, then a separate step to set it up`, async (t) => {
    const { where, internet: folder } = await online(t, release);

    const result = await runOnline(where, 'york', { folder, chunk: 300_000, terminal: true, ...internet });

    assert.equal(result.code, 0, result.stdout + result.stderr);
    const drawn = drawings(result.stdout, 'Downloading Claude Code');
    assert.ok(drawn.every((drawing) => drawing.includes(message)), drawn.join('\n'));
    if (message === 'Downloading Claude Code') assert.ok(!drawn.some((drawing) => drawing.includes(' MB)')), drawn.join('\n'));
    const shown = percentages(drawn);
    assert.ok(new Set(shown).size >= 3, `it rose in steps: ${shown.join(', ')}`);
    assert.deepEqual(shown, [...shown].sort((a, b) => a - b), `it only ever rose: ${shown.join(', ')}`);
    assert.equal(shown.at(-1), 100);
    const plain = stripVTControlCharacters(result.stdout);
    assert.match(plain, /o {2}Claude Code downloaded/);
    assert.match(plain, /Setting up Claude Code/);
    assert.match(plain, /o {2}Claude Code installed/);
    assert.ok(plain.indexOf('Claude Code downloaded') < plain.indexOf('Setting up Claude Code'));
  });
}

test('in a terminal, a download whose size neither the manifest nor the server gives shows how much has come so far', async (t) => {
  const { where, internet } = await online(t, { size: 1_500_000, unsized: true });

  const result = await runOnline(where, 'york', { folder: internet, chunk: 500_000, unsized: ['claude.exe'], terminal: true });

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const drawn = drawings(result.stdout, 'Downloading Claude Code');
  const amounts = [...new Set(drawn.flatMap((drawing) => [.../(\d+\.\d) MB \[/.exec(drawing) ?? []].slice(1, 2)))];
  assert.deepEqual(amounts, ['0.0', '0.5', '1.0', '1.5'], drawn.join('\n'));
  assert.deepEqual(percentages(drawn), []);
});

test('in a terminal, a download that fails closes quietly, with no cross, and the small release spinner follows', async (t) => {
  const { where, internet } = await online(t, { size: 3_000_000 });

  const result = await runOnline(where, 'york', { folder: internet, chunk: 300_000, cutShort: { 'claude.exe': 900_000 }, terminal: true });

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const plain = stripVTControlCharacters(result.stdout);
  // How the line was closed once the spinner stopped: marked done (o), failed (x) or neither (-).
  const closed = plain.split(/[\r\n]/).filter((line) => /^[-ox] {2}Downloading Claude Code/.test(line));
  assert.deepEqual(closed.map((line) => line.replace(/\s*\[\d+s\]\s*$/, '')), ['-  Downloading Claude Code (3 MB)'], plain);
  assert.match(plain, /o {2}Claude Code installed/);
  assert.ok(plain.indexOf('Downloading Claude Code (3 MB)') < plain.indexOf("Installing Claude Code. It's over 300 MB"));
  assert.doesNotMatch(plain, /x {2}(Claude Code|Downloading)/);
});

test('in a terminal, a checksum mismatch closes the setting-up line quietly too, with no cross', async (t) => {
  const { where, internet } = await online(t, { size: 3_000_000, wrongChecksum: true });

  const result = await runOnline(where, 'york', { folder: internet, chunk: 300_000, terminal: true });

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const plain = stripVTControlCharacters(result.stdout);
  const closed = plain.split(/[\r\n]/).filter((line) => /^[-ox] {2}(Setting up Claude Code|Claude Code)/.test(line));
  assert.deepEqual(
    closed.map((line) => line.replace(/\s*\[\d+s\]\s*$/, '')),
    ['o  Claude Code downloaded', '-  Setting up Claude Code', 'o  Claude Code installed'],
    plain,
  );
  assert.ok(plain.indexOf('Setting up Claude Code') < plain.indexOf("Installing Claude Code. It's over 300 MB"));
});
