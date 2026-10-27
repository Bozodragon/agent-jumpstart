// The optional GitHub flow, for the person who said yes. The installer can't make the account
// for them, so it opens the profile's sign-up page, says what to do and waits. Then the GitHub
// CLI (the copy the tools step found or put in place: the person's own, if they had one) signs
// them in through the browser and makes itself Git's credential helper, so a later clone needs
// no password. Someone already signed in keeps Git set up the way they had it. No organisation
// invites: the username goes in the checklist so Jacob can send one.
import { githubHost as host, loadManifest, toolEntry } from './manifest.js';
import { showPage } from './open-page.js';
import { Stop } from './stop.js';
import * as ui from './ui.js';

/**
 * Someone already signed in (a re-run, or an earlier gh) is left signed in and isn't sent to the
 * sign-up page. When nobody is at the screen (answers came from a file) it waits for nothing.
 * The page and gh go through the machine, which under a home override is the fake.
 * @param {import('./profile.js').Profile} profile
 * @param {boolean} wanted Whether the person chose to set up GitHub now.
 * @param {Partial<Record<string, import('./tools.js').Command>>} programs The tools in place, by id.
 * @param {import('./tools.js').Context} context
 * @returns {Promise<string>} The checklist's GitHub line.
 */
export async function setUpGitHub(profile, wanted, programs, context) {
  const { machine, downloads, log } = context;
  const say = (/** @type {string} */ line) => log.write(`GitHub: ${line}`);
  if (!wanted) {
    say('not chosen, so it was skipped');
    return 'Skipped';
  }
  const github = profile.github;
  if (typeof github?.signUpPage !== 'string' || typeof github.email !== 'string') {
    throw new Stop(`The "${profile.id}" profile needs a GitHub sign-up page address and the email to sign up with.`);
  }

  const entry = toolEntry(await loadManifest(downloads), 'gh');
  const program = entry && programs[entry.id];
  if (!program) {
    say("the GitHub CLI isn't installed, so nobody could be signed in");
    return "Not set up: the GitHub CLI isn't installed";
  }
  say(`using ${program.file}`);
  /** @param {string[]} args */
  const gh = (args) => machine.run(program.file, [...program.args, ...args]);

  const status = await gh(['auth', 'status', '--hostname', host]);
  /** @type {import('./machine.js').Ran | undefined} */
  let git;
  if (status.code === 0) {
    say('already signed in, so the sign-up page and sign-in were skipped');
  } else {
    say('not signed in yet');
    await walkThroughSignUp(github, { ...context, say });
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
    const code = await machine.runOnScreen(program.file, [...program.args, 'auth', 'login', '--hostname', host, '--git-protocol', 'https', '--web', '--clipboard']);
    if (code !== 0) {
      say(`gh auth login stopped with code ${code}`);
      return "Not signed in: the GitHub sign-in didn't finish";
    }
    // Covers someone who answered No to gh's own Git question. Only after this run's sign-in:
    // it rewrites Git's credential settings, which someone already signed in has set up already.
    git = await gh(['auth', 'setup-git', '--hostname', host]);
  }

  const user = await gh(['api', 'user', '--jq', '.login']);
  const username = user.output.trim();
  if (user.code !== 0 || username === '') {
    say("GitHub didn't say who is signed in");
    return "Not signed in: GitHub didn't say who you are";
  }
  say(`signed in as ${username}`);
  if (git && git.code !== 0) {
    say("Git couldn't be set up to use the sign-in");
    return `Signed in as ${username}, but Git isn't set up to use it`;
  }
  return `Signed in as ${username}`;
}

/**
 * Opens the sign-up page, says what to do, and waits for Enter.
 * @param {{ signUpPage: string, email: string }} github
 * @param {import('./tools.js').Context & { say: (line: string) => void }} context
 */
async function walkThroughSignUp({ signUpPage, email }, { attended, machine, log, say }) {
  await showPage('GitHub sign-up page', signUpPage, { machine, log });
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
