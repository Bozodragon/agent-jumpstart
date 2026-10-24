// The extra tools the person can tick (the profile's `extraTools`). Each one is the manifest
// entries whose `when` is its id. Unticked, they are only a skipped line in the checklist.
// Ticked, each is installed, the person signs in to it in the browser if it has a sign-in,
// and is then sent to the profile's settings page for anything only they can switch on.
import { join } from 'node:path';
import { loadManifest } from './manifest.js';
import { tryToOpen } from './open-page.js';
import { installTool } from './tools.js';
import * as ui from './ui.js';

/**
 * @typedef {import('./tools.js').Context & { attended: boolean }} Context
 */

/**
 * @param {import('./profile.js').Profile} profile
 * @param {string[]} ticked The ids of the ticked extra tools.
 * @param {Context} context
 * @returns {Promise<[string, string][]>} checklist rows
 */
export async function setUpExtraTools(profile, ticked, context) {
  const { tools } = await loadManifest(context.downloads);
  /** @type {[string, string][]} */
  const rows = [];
  for (const extra of profile.extraTools) {
    let anyInstalled = false;
    let signInRan = false;
    for (const tool of tools.filter((tool) => tool.when === extra.id)) {
      if (!ticked.includes(extra.id)) {
        context.log.write(`${tool.name}: skipped, because "${extra.id}" wasn't ticked`);
        rows.push([tool.name, 'Skipped (not chosen)']);
        continue;
      }
      const installed = await installTool(tool, context);
      // installTool's way of saying it couldn't.
      if (installed.startsWith('Not installed')) {
        rows.push([tool.name, installed]);
        continue;
      }
      anyInstalled = true;
      if (!tool.signIn) {
        rows.push([tool.name, installed]);
        continue;
      }
      const program = join(context.places.programs, tool.install.folder, tool.install.check);
      const { account, already } = await signIn(tool, program, extra, context);
      if (!already) signInRan = true;
      rows.push([tool.name, `${installed}, ${account ? `signed in as ${account}` : 'not signed in'}`]);
    }
    // Someone already signed in has been here before (a re-run), so isn't sent again.
    if (anyInstalled && signInRan) await walkThroughSettings(extra, context);
  }
  return rows;
}

/**
 * Opens the extra tool's settings page, says what to switch on there, and waits for Enter.
 * When nobody is at the screen it opens nothing and waits for nothing.
 * @param {import('./profile.js').ExtraTool} extra
 * @param {Context} context
 */
async function walkThroughSettings(extra, { attended, log }) {
  if (!extra.settingsPage) return;
  ui.step(`Settings page: ${extra.settingsPage}`);
  log.write(`Settings page: ${extra.settingsPage} (${attended ? await tryToOpen(extra.settingsPage) : 'not opened: answers came from a file'})`);
  ui.notice(extra.settings ?? 'Change the setting on this page.', 'One setting only you can change');
  if (attended) {
    await ui.pressEnter("Press Enter once you've done that.");
    log.write(`Settings page for ${extra.id}: the person pressed Enter`);
  } else {
    log.write(`Settings page for ${extra.id}: taken as done from the answers file`);
  }
}

/**
 * Someone already signed in (a re-run) is left signed in. Otherwise the tool's own browser
 * sign-in runs in the person's window, so they see its address if no browser opens, and the
 * installer waits for it to finish.
 * @param {import('./manifest.js').Tool} tool
 * @param {string} program
 * @param {import('./profile.js').ExtraTool} extra
 * @param {Context} context
 * @returns {Promise<{ account?: string, already: boolean }>} the account signed in, if any, and
 *   whether it was signed in before this run
 */
async function signIn(tool, program, extra, { machine, log }) {
  const say = (/** @type {string} */ line) => log.write(`${tool.name}: ${line}`);
  const how = /** @type {import('./manifest.js').SignIn} */ (tool.signIn);
  const whoIsSignedIn = async () => {
    const ran = await machine.run(program, how.check);
    const match = ran.code === 0 ? new RegExp(how.signedInAs, 'm').exec(ran.output) : null;
    if (!match) say(`not signed in: ${ran.output.trim() || `code ${ran.code}`}`);
    return match?.[1];
  };

  const before = await whoIsSignedIn();
  if (before) {
    say(`already signed in as ${before}, so the sign-in was skipped`);
    return { account: before, already: true };
  }
  ui.notice(extra.signIn ?? 'A browser window will open for you to sign in.', `Sign in to ${tool.name}`);
  const code = await machine.runOnScreen(program, how.run);
  say(`sign-in finished with code ${code}`);
  const after = await whoIsSignedIn();
  if (after) say(`signed in as ${after}`);
  return { account: after, already: false };
}
