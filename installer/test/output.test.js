// What the person sees while the installer works: every slow check says it's working, and the
// misses it expects (a registry key that isn't there, T3 Code still starting) print nothing
// alarming. Real failures still show, on screen and in the log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { claudeFolder, fakeMachine, makeHome, readManifest, readOnlyLog, runWith, supplyT3, t3Leaves } from './harness.js';

const uninstallKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\e9197887-efb3-55e0-985e-d6d3b5dd594a';

/** What reg.exe says, with code 1, when the key or value it's asked for isn't there. */
const noSuchKey = { code: 1, output: '\r\n\r\nERROR: The system was unable to find the specified registry key or value.\r\n' };

/** What T3's command line says, with code 78, while T3 has just started (as seen on a York laptop). */
const t3StillStarting = {
  code: 78,
  output: [
    '[13:02:21.091] ERROR (#2): ServerAlreadyRunningError: A T3 Code server already owns C:\\Users\\jo\\.t3\\userdata. Stop that server, or use a separate T3 home and pair with it, then retry. No server was stopped.',
    '    at catch (file:///C:/Users/jo/AppData/Local/Programs/t3code/resources/server.asar/apps/server/dist/binCli.mjs:144239:43)',
    '    at acquireServerOwnership (file:///C:/Users/jo/AppData/Local/Programs/t3code/resources/server.asar/apps/server/dist/binCli.mjs:304676:10)',
  ].join('\n'),
};

/** Nothing alarming: no error line and no stack trace. @param {string} text */
function assertCalm(text) {
  assert.doesNotMatch(text, /ERROR|Error:|ServerAlreadyRunning|unable to find/, text);
  assert.doesNotMatch(text, /^\s*(\|\s*)?at .*\(.*:\d+:\d+\)/m, text);
}

/**
 * A stand-in for clasp's package, and a copy of the manifest whose clasp checksum is the stand-in's.
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

test("clasp's sign-in check, the Claude Code check and the T3 Code check each say they're working", async (t) => {
  const where = await makeHome(t, { extraTools: ['apps-script'] });
  await supplyClasp(where);
  await mkdir(claudeFolder(where.home), { recursive: true });
  await writeFile(join(claudeFolder(where.home), 'claude.exe'), 'already here');
  await fakeMachine(where.home).setReplies({
    'clasp.cmd show-authorized-user': { output: 'You are logged in as a.person@york.ac.uk.\n' },
    'claude.exe --version': { output: '2.1.311 (Claude Code)\n' },
    'claude.exe auth status': { output: JSON.stringify({ loggedIn: true, email: 'jo.bloggs@york.ac.uk' }) },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  for (const step of ["Checking clasp's sign-in", 'Checking Claude Code', 'Checking whether T3 Code is installed']) {
    assert.ok(result.stdout.includes(step), `expected "${step}" in:\n${result.stdout}`);
  }
});

for (const mode of ['an ordinary', 'a debug']) {
  test(`in ${mode} run, a registry query that finds nothing prints nothing alarming, and the log says what it means in plain words`, async (t) => {
    const where = await makeHome(t);
    await fakeMachine(where.home).setReplies({ [`reg.exe query ${uninstallKey} /v DisplayVersion`]: noSuchKey });

    const result = await runWith(where, 'york', mode === 'a debug' ? ['--debug'] : []);

    assert.equal(result.code, 0, result.stdout + result.stderr);
    assertCalm(result.stdout + result.stderr);
    const log = await readOnlyLog(where.home);
    assert.match(log.text, /T3 Code: not installed yet/);
    // The miss is kept in a debug log, with reg.exe's own words, and left out of an ordinary one.
    if (mode === 'a debug') assert.match(log.text, /Ran: reg\.exe \(code 1\)\n(.*\n)*?.*\| ERROR: The system was unable to find/);
    else assertCalm(log.text);
  });
}

test("T3 Code's ServerAlreadyRunningError while it starts prints no error or stack trace, on screen or in an ordinary log", async (t) => {
  const where = await makeHome(t);
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  const machine = fakeMachine(where.home);
  await machine.setWaiting({ patience: 10_000 });
  await machine.setReplies({
    [`${installer} /S --force-run`]: { creates: [t3Leaves.program, t3Leaves.shim] },
    't3.cmd project add': [t3StillStarting, t3StillStarting, { code: 0 }],
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assertCalm(result.stdout + result.stderr);
  const log = await readOnlyLog(where.home);
  assertCalm(log.text);
  assert.match(log.text, /T3 Code project: T3 Code is still starting, so adding .* is tried again in 2 seconds/);
  assert.match(log.text, /T3 Code project: added /);
});

test('a real failure still shows on screen and is logged with what the program said', async (t) => {
  const where = await makeHome(t);
  const installer = await supplyT3(where.downloads, 'latest.yml', '0.1.2');
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    [`${installer} /S --force-run`]: { creates: [t3Leaves.program, t3Leaves.shim] },
    't3.cmd project add': { code: 1, output: 'Error: Failed to open the project database.\n    at open (file:///C:/t3/db.mjs:12:3)' },
    [`reg.exe query ${uninstallKey} /v DisplayVersion`]: { code: 1, output: 'ERROR: Access is denied.\r\n' },
  });

  const result = await runWith(where, 'york');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout.replace(/[│|]/g, ' ').replace(/\s+/g, ' '), /Claude, not in T3 Code: T3 Code wouldn't add it/);
  const log = await readOnlyLog(where.home);
  assert.match(log.text, /Ran: t3\.cmd \(code 1\)\n.*\| Error: Failed to open the project database\./);
  assert.match(log.text, /Ran: reg\.exe \(code 1\)\n.*\| ERROR: Access is denied\./);
});
