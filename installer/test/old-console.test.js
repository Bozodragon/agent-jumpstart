// York's PowerShell window is the old Windows console (conhost), whose fonts draw far fewer
// characters than Windows Terminal's: the prompt library's diamonds, circles and spinner frames
// come out as boxes there. Everything the Installer prints is kept to what it can draw: printable
// ASCII, the single-line box drawing its guide lines and boxes are made of, and the two dots.
// Prompts, the spinner and colours need a person at a real terminal, so they're checked by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHome, runWith } from './harness.js';

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

  const fullRun = await runWith(full, 'york');
  const stoppedRun = await runWith(stopped, 'default');

  assert.equal(fullRun.code, 0, fullRun.stdout + fullRun.stderr);
  assert.match(fullRun.stdout, /Checklist/);
  assert.match(fullRun.stdout, /Not installed/);
  assert.equal(stoppedRun.code, 1, stoppedRun.stdout + stoppedRun.stderr);
  for (const { stdout, stderr } of [fullRun, stoppedRun]) {
    assert.deepEqual(undrawable(stdout + stderr), [], stdout + stderr);
  }
});
