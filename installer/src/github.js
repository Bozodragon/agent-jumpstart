// The optional GitHub flow, for the person who said yes. The installer can't make the account
// for them, so it opens the profile's sign-up page, says what to do and waits. Then the GitHub
// CLI (the copy the installer put in place, not whatever else is on the machine) signs them in
// through the browser and makes itself Git's credential helper, so a later clone needs no
// password. No organisation invites: the username goes in the checklist so Jacob can send one.
import { join } from 'node:path';
import { githubHost as host, loadManifest, toolEntry } from './manifest.js';
import { tryToOpen } from './open-page.js';
import { Stop } from './stop.js';
import { exists } from './tools.js';
import * as ui from './ui.js';

/**
 * Someone already signed in (a re-run, or an earlier gh) is left signed in and isn't sent to the
 * sign-up page. When nobody is at the screen (answers came from a file) it opens no browser and
 * waits for nothing; gh still runs through the machine, which under a home override is the fake.
 * @param {import('./profile.js').Profile} profile
 * @param {boolean} wanted Whether the person chose to set up GitHub now.
 * @param {import('./tools.js').Context} context
 * @returns {Promise<string>} The checklist's GitHub line.
 */
export async function setUpGitHub(profile, wanted, { attended, places, machine, downloads, log }) {
  const say = (/** @type {string} */ line) => log.write(`GitHub: ${line}`);
  if (!wanted) {
    say('not chosen, so it was skipped');
    return 'Skipped';
  }
  const github = profile.github;
  if (typeof github?.signUpPage !== 'string' || typeof github.email !== 'string') {
    throw new Stop(`The "${profile.id}" profile needs a GitHub sign-up page address and the email to sign up with.`);
  }

  const gh = await installedGh(places, downloads);
  if (!gh) {
    say("the GitHub CLI isn't installed, so nobody could be signed in");
    return "Not set up: the GitHub CLI isn't installed";
  }

  const status = await machine.run(gh, ['auth', 'status', '--hostname', host]);
  if (status.code === 0) {
    say('already signed in, so the sign-up page and sign-in were skipped');
  } else {
    say(`not signed in yet: ${status.output.trim()}`);
    await walkThroughSignUp(github, { attended, log, say });
    ui.notice(
      [
        "GitHub's own tool signs you in next, in your browser:",
        '',
        `  ${ui.bullet} Asked to authenticate Git? Press Enter for Yes.`,
        `  ${ui.bullet} It copies a one-time code for you.`,
        `  ${ui.bullet} Press Enter to open the browser.`,
        `  ${ui.bullet} Paste the code, sign in, and click Authorize.`,
      ].join('\n'),
      'Sign in to GitHub',
    );
    const code = await machine.runOnScreen(gh, ['auth', 'login', '--hostname', host, '--git-protocol', 'https', '--web', '--clipboard']);
    if (code !== 0) {
      say(`gh auth login stopped with code ${code}`);
      return "Not signed in: the GitHub sign-in didn't finish";
    }
  }

  // Safe to repeat, and covers someone who answered No to gh's own Git question.
  const git = await machine.run(gh, ['auth', 'setup-git', '--hostname', host]);
  const user = await machine.run(gh, ['api', 'user', '--jq', '.login']);
  const username = user.output.trim();
  if (user.code !== 0 || username === '') {
    say(`gh api user: ${username || `code ${user.code}`}`);
    return "Not signed in: GitHub didn't say who you are";
  }
  say(`signed in as ${username}`);
  if (git.code !== 0) {
    say(`gh auth setup-git: ${git.output.trim()}`);
    return `Signed in as ${username}, but Git isn't set up to use it`;
  }
  return `Signed in as ${username}`;
}

/**
 * Opens the sign-up page, says what to do, and waits for Enter.
 * @param {{ signUpPage: string, email: string }} github
 * @param {{ attended: boolean, log: { write(line: string): void }, say: (line: string) => void }} how
 */
async function walkThroughSignUp({ signUpPage, email }, { attended, log, say }) {
  ui.step(`GitHub sign-up page: ${signUpPage}`);
  log.write(`GitHub sign-up page: ${signUpPage} (${attended ? await tryToOpen(signUpPage) : 'not opened: answers came from a file'})`);
  ui.notice(
    [
      `If you don't have a GitHub account yet, create one on the sign-up page with ${email}.`,
      'Follow its steps, including the code GitHub emails you.',
      "If you already have an account, there's nothing to do here.",
    ].join('\n'),
    'Create a GitHub account',
  );
  if (attended) {
    await ui.pressEnter('Press Enter once you have a GitHub account.');
    say('the person pressed Enter after the sign-up page');
  } else {
    say('account taken as made from the answers file');
  }
}

/**
 * Where the installer put the GitHub CLI, if it's there.
 * @param {import('./places.js').Places} places
 * @param {string | undefined} downloads
 */
async function installedGh(places, downloads) {
  const tool = toolEntry(await loadManifest(downloads), 'gh');
  if (!tool) return undefined;
  const gh = join(places.programs, tool.install.folder, tool.install.check);
  return (await exists(gh)) ? gh : undefined;
}
