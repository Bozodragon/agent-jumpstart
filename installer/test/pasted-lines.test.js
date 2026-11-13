// The four files people paste the address of. They run through `irm <url> | iex` on
// Windows PowerShell 5.1, perhaps in Constrained Language Mode, so these checks read
// the files as text; nothing here runs them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { findPlaces } from '../src/places.js';
import { repo } from './harness.js';

const bootstrap = join(repo, 'bootstrap');
const lines = { 'york.ps1': ['york', false], 'install.ps1': ['default', false], 'york-debug.ps1': ['york', true] };
const files = [...Object.keys(lines), 'share-log.ps1'];

/** @param {string} name */
const read = (name) => readFile(join(bootstrap, name));

/** @param {string} text the code with whole-line comments removed */
const code = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

for (const name of files) {
  test(`${name} is plain ASCII with no byte-order mark`, async () => {
    const bytes = await read(name);
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'starts with a UTF-8 byte-order mark');
    const offending = bytes.findIndex((byte) => byte > 0x7e || (byte < 0x20 && byte !== 0x0a && byte !== 0x0d));
    assert.equal(offending, -1, `byte ${offending} isn't printable ASCII`);
  });

  test(`${name} has no Add-Type, New-Object or .NET method calls, no exit but the Bootstrap's one, and uses basic parsing`, async () => {
    const text = code((await read(name)).toString('ascii'));
    // exit closes the person's window: only the Bootstrap does, once, after the page has connected.
    assert.equal(text.match(/\bexit\b/gi)?.length ?? 0, name in lines ? 1 : 0, 'exit closes the window');
    assert.doesNotMatch(text, /\bAdd-Type\b/i);
    assert.doesNotMatch(text, /\bNew-Object\b/i);
    assert.doesNotMatch(text, /::/, 'static .NET members are blocked in Constrained Language Mode');
    assert.doesNotMatch(text, /\.\w+\s*\(/, 'method calls are blocked in Constrained Language Mode');
    assert.doesNotMatch(text, /\[scriptblock\]/i);
    for (const line of text.split('\n').filter((l) => /Invoke-WebRequest|Invoke-RestMethod/i.test(l))) {
      assert.match(line, /-UseBasicParsing/i, line);
    }
  });
}

test('york.ps1, install.ps1 and york-debug.ps1 differ only in their top line, which names the profile and debug', async () => {
  /** @type {string[][]} */
  const bodies = [];
  for (const [name, [profile, debug]] of Object.entries(lines)) {
    const [top, ...rest] = (await read(name)).toString('ascii').split(/\r?\n/);
    assert.equal(top, `$AgentJumpstart = @{ Profile = '${profile}'; Debug = $${debug} }`, name);
    bodies.push(rest);
  }
  assert.deepEqual(bodies[1], bodies[0], 'install.ps1 differs from york.ps1 below the top line');
  assert.deepEqual(bodies[2], bodies[0], 'york-debug.ps1 differs from york.ps1 below the top line');
});

test('the bootstrap pins the same Node.js version and checksums as manifest.json', async () => {
  const manifest = JSON.parse(await readFile(join(repo, 'manifest.json'), 'utf8'));
  /** @type {{ version: string, downloads: Record<string, { url: string, sha256: string }> }} */
  const node = manifest.tools.find((/** @type {{ id: string }} */ tool) => tool.id === 'node');
  const text = (await read('york.ps1')).toString('ascii');
  assert.match(text, new RegExp(`\\$nodeVersion = '${node.version.replaceAll('.', '\\.')}'`));
  assert.deepEqual(Object.keys(node.downloads).sort(), ['arm64', 'x64']);
  for (const [arch, { url, sha256 }] of Object.entries(node.downloads)) {
    assert.match(text, new RegExp(`\\b${arch} = '${sha256}'`), arch);
    // The bootstrap builds the address from the version and arch rather than repeating it.
    assert.equal(url, `https://nodejs.org/dist/v${node.version}/node-v${node.version}-win-${arch}.zip`);
  }
});

test("the bootstrap unpacks Node.js into the installer's own folder and never touches a Node.js the person already has", async () => {
  const text = code((await read('york.ps1')).toString('ascii'));
  assert.match(text, /\$root = Join-Path \$env:LOCALAPPDATA 'agent-jumpstart'/);
  assert.match(text, /\$nodeDir = Join-Path \$root 'node'/);
  assert.doesNotMatch(text, /'Programs'|'nodejs'|\\Programs\\/i, "%LOCALAPPDATA%\\Programs\\nodejs may be the person's own Node.js");
});

const powershell = process.platform === 'win32' ? 'powershell.exe' : undefined;

test("Windows PowerShell parses all four with no errors, finds no method calls, and finds one exit in each Bootstrap and none in share-log.ps1", { skip: !powershell && 'needs Windows PowerShell' }, () => {
  const paths = files.map((name) => `'${join(bootstrap, name).replaceAll("'", "''")}'`).join(',');
  const script = `
    $found = @()
    foreach ($path in @(${paths})) {
      $tokens = $null; $errors = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
      foreach ($e in $errors) { $found += "$path parse error: $($e.Message)" }
      $bad = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true)
      foreach ($n in $bad) { $found += "$path line $($n.Extent.StartLineNumber): $($n.Extent.Text)" }
      $exits = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.ExitStatementAst] }, $true))
      $found += "$([System.IO.Path]::GetFileName($path)) exits: $($exits.Count)"
    }
    $found -join [char]10`;
  const out = execFileSync(/** @type {string} */ (powershell), ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  });
  assert.deepEqual(out.trim().split(/\r?\n/), files.map((name) => `${name} exits: ${name in lines ? 1 : 0}`));
});

/** The Bootstrap's code (york.ps1's; the others differ only in their top line), with comments taken out. */
const bootstrapCode = async () => code((await read('york.ps1')).toString('ascii'));

/** What the Bootstrap does once its own functions are defined, from its first word to the person. @param {string} text */
const running = (text) => text.slice(text.indexOf("Write-Host 'Agent Jumpstart'"));

test("before it changes anything, the Bootstrap looks for a running Installer's lock, the Installer's own address file, and while its process runs reopens that page and does nothing else", async () => {
  const text = await bootstrapCode();
  const places = findPlaces(join(repo, 'a-home'));
  assert.match(text, new RegExp(`\\$addressFile = Join-Path \\$root '${basename(places.pageAddress).replace('.', '\\.')}'`));
  const body = running(text);
  const lockCheck = body.indexOf('if (Test-RunningInstaller) { return }');
  assert.ok(lockCheck >= 0, 'the lock is looked for');
  const firstChange = body.search(/New-Item|Remove-Item|Move-Item|Save-Download|Expand-Zip|Start-Process/);
  assert.ok(lockCheck < firstChange, `the lock is looked for before anything changes: ${body.slice(firstChange, firstChange + 80)}`);
  // And again just before each thing that would break a running Installer, which a paste made
  // while another was still downloading might otherwise do.
  for (const change of [/Move-Item -LiteralPath \$nodeDir/, /Remove-Item -LiteralPath \$programDir/, /Remove-Item -LiteralPath \$addressFile, \$connectedFile/]) {
    const at = body.search(change);
    const before = body.slice(0, at).trimEnd().split('\n');
    assert.ok(at > 0 && before.slice(-6).some((line) => line.includes('if (Test-RunningInstaller) { return }')), `the lock is looked for again just before ${change}`);
  }
  const [, check] = /function Test-RunningInstaller \{\n([\s\S]*?)\n {2}\}\n/.exec(text) ?? [];
  assert.ok(check, 'the lock check');
  // The lock's second line is the Installer's process: a lock left by one that has stopped is no lock.
  assert.match(check, /\$lock = @\(Get-Content -LiteralPath \$addressFile/);
  assert.match(check, /Get-Process -Id \$lock\[1\]/);
  // Its path, where it can be read; 32-bit PowerShell can't read a 64-bit program's, so then its name.
  assert.match(check, /\$running\.Path -eq \$nodeExe -or \(-not \$running\.Path -and \$running\.ProcessName -eq 'node'\)/);
  // A page to open again, or none for an Installer in a window of its own (--terminal).
  assert.match(check, /if \(\$lock\[0\]\) \{\s+Write-Host [^\n]+\s+Open-InstallerPage \$lock\[0\]\s+\} else \{\s+Write-Host '[^']*another window[^']*'/);
});

test('the Bootstrap starts the Installer hidden with Start-Process, neither detached nor through a hidden powershell.exe', async () => {
  const text = await bootstrapCode();
  assert.match(text, /\$installer = Start-Process -FilePath \$nodeExe -ArgumentList \$arguments\b[^\n]* -WindowStyle Hidden -PassThru/);
  // The program's path is quoted for Start-Process, which joins its arguments with spaces.
  assert.match(text, /\$arguments = @\("`"\$main`"", '--profile', \$ProfileId\)/);
  for (const [line] of text.matchAll(/Start-Process [^\n]*/g)) {
    assert.doesNotMatch(line, /powershell|pwsh|cmd\.exe/i, `a hidden powershell.exe runs into microsoft/terminal#12464: ${line}`);
    assert.doesNotMatch(line, /-NoNewWindow/i, line);
  }
  assert.equal(text.match(/-WindowStyle Hidden/g)?.length, 1, 'only the Installer is started hidden');
  // Started in this window only with --terminal.
  for (const [line] of text.matchAll(/& \$nodeExe [^\n]*/g)) assert.match(line, /^& \$nodeExe (--version\)|@fallback)$/, line);
});

test("the Bootstrap opens the address from the Installer's file as an app window of Chrome, then Edge, found through App Paths, in the person's own profile, and otherwise as a tab of the default browser", async () => {
  const text = await bootstrapCode();
  assert.match(text, /foreach \(\$name in @\('chrome\.exe', 'msedge\.exe'\)\)/);
  assert.match(text, /foreach \(\$hive in @\('HKCU:', 'HKLM:'\)\)/);
  assert.match(text, /"\$hive\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\\$name"/);
  assert.match(text, /Start-Process -FilePath \$browser -ArgumentList "--app=\$Address"/);
  assert.match(text, /Start-Process -FilePath \$Address/);
  assert.doesNotMatch(text, /--user-data-dir|--profile-directory|--incognito|--inprivate/i, "the person's own profile");
  const body = running(text);
  assert.match(body, /\$address = @\(Get-Content -LiteralPath \$addressFile[^)]*\)\[0\]\s+if \(\$address\) \{ Open-InstallerPage \$address \}/);
});

test('once the page has connected, the Installer writes its address to the connected file, and the Bootstrap closes the window with its one exit', async () => {
  const text = await bootstrapCode();
  const places = findPlaces(join(repo, 'a-home'));
  assert.match(text, new RegExp(`\\$connectedFile = Join-Path \\$root '${basename(places.pageConnected).replace('.', '\\.')}'`));
  // The connected file names the page it's for, so one left by an earlier run is never taken for this one's.
  assert.match(text, /\$connected = \$address -and @\(Get-Content -LiteralPath \$connectedFile[^)]*\)\[0\] -eq \$address/);
  const [, block] = /\n\s*if \(\$connected\) \{\n([^}]*)\}/.exec(text) ?? [];
  assert.ok(block, 'a block for a connected page');
  assert.match(block, /^\s*exit\s*$/m, 'the window is closed there');
  // Stale files from a run that stopped are cleared before the Installer starts, so they're never read as its own.
  assert.match(text, /Remove-Item -LiteralPath \$addressFile, \$connectedFile -Force -ErrorAction SilentlyContinue\s+\$installer = \$null/);
});

test('with no page, the Bootstrap runs the Installer in the window with --terminal, says why, and still offers the line that copies the log', async () => {
  const text = await bootstrapCode();
  const body = running(text);
  const exit = body.search(/\bexit\b/);
  const fallback = body.indexOf('& $nodeExe @fallback');
  assert.ok(exit >= 0 && fallback > exit, 'the fallback comes after the window would have closed');
  assert.match(text, /\$fallback = @\(\$main, '--profile', \$ProfileId, '--terminal'\)/);
  assert.match(text, /if \(\$DebugOn\) \{ \$fallback \+= '--debug' \}/);
  assert.match(body.slice(exit, fallback), /Write-Host \$why/);
  assert.match(body.slice(exit, fallback), /carries on in this window/);
  assert.match(body.slice(fallback), /irm \$portall\/share-log\.ps1 \| iex/);
  // An Installer that never stops by itself is stopped, so two never run at once.
  assert.match(body.slice(exit, fallback), /Stop-Process -Id \$installer\.Id -Force/);
});

test("the bootstrap shows one line per download, with its size and a percentage, instead of curl's progress bar, and falls back to Invoke-WebRequest", async () => {
  const text = code((await read('york.ps1')).toString('ascii'));
  // Invoke-WebRequest's own progress bar makes Windows PowerShell 5.1 download very slowly, so it stays off.
  assert.match(text, /\$ProgressPreference = 'SilentlyContinue'/);
  assert.match(text, /Join-Path \$env:SystemRoot 'System32\\curl\.exe'/);
  // curl's bar flashed #=#=# on the redirect, then jumped to 100%.
  assert.doesNotMatch(text, /--progress-bar|\s-#(\s|$)/m, "curl's progress bar");
  // curl's own progress meter (its stderr) is read line by line while it runs...
  assert.match(text, /& \$curl --fail --location --output \$Path \$Url 2>&1 \| ForEach-Object/);
  // ...and each download's line, naming it with its size and a percentage, is redrawn in place.
  assert.match(text, /\$line = "\$label \(\$size\) \$percent%"/);
  assert.match(text, /Write-Host -NoNewline "`r\$line"/);
  // A redirect's reply is finished the moment it starts, so a finished line waits for curl to end.
  assert.match(text, /Write-Host "`r\$line"/);
  assert.match(text, /Save-Download \$nodeUrl \$nodeZip "Node\.js \$nodeVersion"/);
  assert.match(text, /Save-Download \$programUrl \$programZip 'the installer'/);
  assert.match(text, /Invoke-WebRequest -UseBasicParsing -Uri \$Url -OutFile \$Path/);
});

test('both profiles name who the log goes to, with an email address', async () => {
  for (const [id, who, email] of [['york', 'Jacob', 'jacob.hamood@york.ac.uk'], ['default', 'Jacob', 'jacob.hamood@live.co.uk']]) {
    const profile = JSON.parse(await readFile(join(repo, 'profiles', `${id}.json`), 'utf8'));
    assert.equal(profile.logGoesTo, who, id);
    assert.equal(profile.logEmail, email, id);
  }
});

test("share-log.ps1 reads which profile ran from the installer's settings.json, and names that profile's person and email, with a plain fallback", async () => {
  const text = code((await read('share-log.ps1')).toString('ascii'));
  assert.match(text, /Join-Path \$env:LOCALAPPDATA 'agent-jumpstart'/);
  assert.match(text, /'settings\.json'/);
  assert.match(text, /ConvertFrom-Json/);
  assert.match(text, /\.profile\b/, 'the profile key of settings.json');
  assert.match(text, /program\\profiles\\\$\w+\.json/, "the unpacked profile's own file");
  assert.match(text, /\.logGoesTo\b/);
  assert.match(text, /\.logEmail\b/);
  // No one hard-coded: the person comes only from the profile.
  assert.doesNotMatch(text, /Jacob|hamood/i);
  // A run that stopped before settings.json, or an old install with no profile file, still gets a line that works.
  assert.match(text, /person helping you/);
  assert.match(text, /\bcatch\b/);
});
