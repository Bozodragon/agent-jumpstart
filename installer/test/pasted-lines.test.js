// The four files people paste the address of. They run through `irm <url> | iex` on
// Windows PowerShell 5.1, perhaps in Constrained Language Mode, so these checks read
// the files as text; nothing here runs them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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

  test(`${name} has no exit, Add-Type, New-Object or .NET method calls, and uses basic parsing`, async () => {
    const text = code((await read(name)).toString('ascii'));
    assert.doesNotMatch(text, /\bexit\b/i, 'exit would close the window');
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

test('Windows PowerShell parses all four with no errors and finds no method calls or exit', { skip: !powershell && 'needs Windows PowerShell' }, () => {
  const paths = files.map((name) => `'${join(bootstrap, name).replaceAll("'", "''")}'`).join(',');
  const script = `
    $found = @()
    foreach ($path in @(${paths})) {
      $tokens = $null; $errors = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
      foreach ($e in $errors) { $found += "$path parse error: $($e.Message)" }
      $bad = $ast.FindAll({ param($n)
        $n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -or
        $n -is [System.Management.Automation.Language.ExitStatementAst] }, $true)
      foreach ($n in $bad) { $found += "$path line $($n.Extent.StartLineNumber): $($n.Extent.Text)" }
    }
    $found -join [char]10`;
  const out = execFileSync(/** @type {string} */ (powershell), ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  });
  assert.equal(out.trim(), '');
});
