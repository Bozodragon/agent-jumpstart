// York's PowerShell window is Windows Terminal on Windows 11, but one test laptop had the old
// Windows console (conhost), whose fonts draw far fewer characters than Windows Terminal's: the
// prompt library's diamonds, circles and spinner frames come out as boxes there. Everything the Installer prints is kept to what it can draw: printable
// ASCII, the single-line box drawing its guide lines and boxes are made of, and the two dots.
// Prompts, the spinner and colours need a person at a real terminal, so they're checked by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { checklistSays, fakeMachine, makeHome, runWith } from './harness.js';

const drawable = new Set([
  '\n',
  ...Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)),
  ...'│─┌┐└┘├┤',
  ...'•·',
]);

/** @param {string} printed */
function undrawable(printed) {
  return [...new Set([...printed].filter((character) => !drawable.has(character)))].map(
    (character) => `${JSON.stringify(character)} (U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')})`,
  );
}

test('everything a run prints, from its first line through notices, the checklist and a stop, is a character the old console can draw', async (t) => {
  // Every question's answer leads somewhere that prints: GitHub's and Apps Script's notices, the
  // connectors walkthrough, and, with nothing to install from, a checklist of what failed.
  const full = await makeHome(t, { github: true, extraTools: ['apps-script'], connectors: ['Gmail', 'Asana', 'Google Calendar'] });
  const stopped = await makeHome(t, { channel: 'beta' });
  // Claude Code is there but signed out, so the run reaches Claude's sign-in and its notice. The
  // fake sign-in prints what Claude prints, but in ASCII: Claude's own output isn't the Installer's.
  const signingIn = await makeHome(t, { connectors: [], extraTools: [] });
  await mkdir(dirname(join(signingIn.home, '.local', 'bin', 'claude.exe')), { recursive: true });
  await writeFile(join(signingIn.home, '.local', 'bin', 'claude.exe'), 'already here');
  await fakeMachine(signingIn.home).setReplies({
    'claude.exe --version': { output: '2.1.317 (Claude Code)\n' },
    'claude.exe auth status': [{ code: 1, output: JSON.stringify({ loggedIn: false }) }, { output: JSON.stringify({ loggedIn: true, email: 'jo.bloggs@york.ac.uk' }) }],
    'claude.exe auth login': { output: "Opening browser to sign in...\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true\nPaste code here if prompted > Login successful.\n" },
  });

  // York's team names, as a stop on a team it doesn't offer prints them.
  const noSuchTeam = await makeHome(t, { team: 'Finance' });

  const fullRun = await runWith(full, 'york');
  const stoppedRun = await runWith(stopped, 'default');
  const signInRun = await runWith(signingIn, 'york');
  const noSuchTeamRun = await runWith(noSuchTeam, 'york');
  // A re-run of the first, which says what it reuses from last time, its team and skills choice among them.
  const reRun = await runWith(full, 'york');

  assert.equal(fullRun.code, 0, fullRun.stdout + fullRun.stderr);
  assert.match(fullRun.stdout, /Checklist/);
  assert.match(fullRun.stdout, /Not installed/);
  assert.equal(stoppedRun.code, 1, stoppedRun.stdout + stoppedRun.stderr);
  assert.equal(signInRun.code, 0, signInRun.stdout + signInRun.stderr);
  assert.match(signInRun.stdout, /Paste once, then press Enter\./);
  assert.equal(noSuchTeamRun.code, 1, noSuchTeamRun.stdout + noSuchTeamRun.stderr);
  assert.match(noSuchTeamRun.stdout, /"Systems, Data and Operations", "Marketing", "Another team"/);
  assert.equal(reRun.code, 0, reRun.stdout + reRun.stderr);
  checklistSays(reRun.stdout, 'Team', 'Another team');
  checklistSays(reRun.stdout, 'Skills', 'Just the usual ones');
  for (const { stdout, stderr } of [fullRun, stoppedRun, signInRun, noSuchTeamRun, reRun]) {
    assert.deepEqual(undrawable(stdout + stderr), [], stdout + stderr);
  }
});
