// The optional GitHub flow, for the person who said yes. The installer can't make the account
// for them, so it opens the profile's sign-up page, says what to do and waits. Then the GitHub
// CLI (the copy the tools step found or put in place: the person's own, if they had one) signs
// them in through the browser and makes itself Git's credential helper, so a later clone needs
// no password. Someone already signed in keeps Git set up the way they had it. No organisation
// invites: the username goes in the checklist so Jacob can send one.
import { githubHost as host, loadManifest, toolEntry } from './manifest.js';
import { showPage } from './open-page.js';
import { messageOf, Stop } from './stop.js';
import { bullet, plainLines, wholeLines } from './text.js';
import { findTool } from './tools.js';

/**
 * Before the questions: whether the GitHub CLI already on the laptop (the copy the tools step
 * will find and use) is signed in. Then GitHub isn't asked (see theRest). Undefined when there's
 * no copy to ask, or the list of versions can't be read; the tools step says why later.
 * @param {import('./tools.js').Context} context
 * @returns {Promise<boolean | undefined>}
 */
export async function signedInBefore(context) {
  const { machine, downloads, log } = context;
  const say = (/** @type {string} */ line) => log.write(`GitHub: ${line}`);
  let entry;
  try {
    entry = toolEntry(await loadManifest(downloads), 'gh');
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    say(`couldn't look for the GitHub CLI before the questions: ${messageOf(error)}`);
    return undefined;
  }
  const program = entry && (await findTool(entry, context));
  if (!program) {
    say(entry ? "the GitHub CLI isn't on the laptop yet, so nobody is signed in" : 'the list of versions has no GitHub CLI, so nobody is signed in');
    return undefined;
  }
  const status = await machine.run(program.file, [...program.args, 'auth', 'status', '--hostname', host]);
  say(status.code === 0 ? `${program.file} is already signed in` : `${program.file} isn't signed in yet`);
  return status.code === 0;
}

/**
 * Someone already signed in (a re-run, or an earlier gh) is left signed in and isn't sent to the
 * sign-up page. When nobody is at the screen (answers came from a file) it waits for nothing.
 * The page and gh go through the machine, which under a home override is the fake.
 * @param {import('./profile.js').Profile} profile
 * @param {boolean} wanted Whether the person chose to set up GitHub now.
 * @param {Partial<Record<string, import('./tools.js').Command>>} programs The tools in place, by id.
 * @param {import('./tools.js').Context} context
 * @param {boolean} [signedIn] Whether gh was signed in before the questions (see signedInBefore),
 *   if that was looked at, so gh's sign-in isn't checked a second time.
 * @returns {Promise<string>} The checklist's GitHub line.
 */
export async function setUpGitHub(profile, wanted, programs, context, signedIn) {
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

  const already = signedIn ?? (await gh(['auth', 'status', '--hostname', host])).code === 0;
  /** @type {import('./machine.js').Ran | undefined} */
  let git;
  if (already) {
    say('already signed in, so the sign-up page and sign-in were skipped');
  } else {
    say('not signed in yet');
    await walkThroughSignUp(github, { ...context, say });
    const login = [...program.args, 'auth', 'login', '--hostname', host, '--git-protocol', 'https', '--web', '--clipboard'];
    const code = context.frontEnd.inWindow ? await signInInTheWindow(program.file, login, context) : await signInOnThePage(program.file, login, context, say);
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
 * gh's sign-in in the person's window, where gh is interactive: it asks about Git and waits for
 * Enter before it opens the browser, which the notice says.
 * @param {string} file @param {string[]} args
 * @param {import('./tools.js').Context} context
 * @returns {Promise<number>} its exit code
 */
function signInInTheWindow(file, args, { machine, frontEnd }) {
  frontEnd.notice(
    [
      "GitHub's own tool signs you in next, in your browser:",
      '',
      `  ${bullet} Asked to authenticate Git? Press Enter for Yes.`,
      `  ${bullet} It copies a one-time code for you.`,
      `  ${bullet} Press Enter to open the browser.`,
      `  ${bullet} Paste the code, sign in, and click Authorize.`,
    ].join('\n'),
    'Sign in to GitHub',
  );
  return machine.runOnScreen(file, args);
}

/**
 * gh's sign-in on the page. Piped, gh asks nothing (the Git step after it covers Git) and opens
 * nothing: it prints its one-time code and the address to sign in at. The page is given the
 * code, and the Installer opens the address itself. All gh printed goes to the log.
 * @param {string} file @param {string[]} args
 * @param {import('./tools.js').Context} context @param {(line: string) => void} say
 * @returns {Promise<number>} its exit code
 */
async function signInOnThePage(file, args, { machine, frontEnd }, say) {
  frontEnd.notice(
    [
      "GitHub's own tool signs you in next, in your browser:",
      '',
      `  ${bullet} A new tab opens at GitHub's sign-in page. If no tab opens, use the link below.`,
      `  ${bullet} Copy the one-time code below and paste it there. Then sign in, if GitHub asks, and click Authorize.`,
      `  ${bullet} ${frontEnd.comeBack()} It carries on by itself.`,
    ].join('\n'),
    'Sign in to GitHub',
  );
  /** @type {Promise<void>} */
  let opening = Promise.resolve();
  const ran = await frontEnd.signIn((show) => {
    /** @type {string | undefined} */
    let code;
    /** @type {string | undefined} */
    let address;
    return machine.runOnScreenAndKeep(file, args, {
      watch(printed) {
        const lines = wholeLines(printed);
        const found = lines.map((line) => /one-time code\W+([A-Z0-9]{4}-[A-Z0-9]{4})\b/i.exec(line)?.[1]).find(Boolean);
        if (code === undefined && found) {
          code = found;
          show({ code });
        }
        const url = lines.map((line) => /\b(https:\/\/\S+)/.exec(line)?.[1]).find(Boolean);
        if (address === undefined && url) {
          address = url;
          show({ link: { url, label: 'If no tab opens, use this link' } });
          opening = machine.openPage(url).then(
            () => say(`sign-in page: ${url} (opened)`),
            (error) => say(`sign-in page: ${url} (couldn't open: ${messageOf(error)})`),
          );
        }
      },
    });
  });
  await opening;
  for (const line of plainLines(ran.output)) say(`sign-in said: ${line}`);
  return ran.code;
}

/**
 * Opens the sign-up page, says what to do, and waits for Enter.
 * @param {{ signUpPage: string, email: string }} github
 * @param {import('./tools.js').Context & { say: (line: string) => void }} context
 */
async function walkThroughSignUp({ signUpPage, email }, { attended, machine, frontEnd, log, say }) {
  await showPage('GitHub sign-up page', signUpPage, { machine, frontEnd, log });
  frontEnd.notice(
    [
      `If you don't have a GitHub account yet, create one on the sign-up page with ${email}.`,
      'Follow its steps, including the code GitHub emails you.',
      "If you already have an account, there's nothing to do here.",
      '',
      frontEnd.comeBack(),
    ].join('\n'),
    'Create a GitHub account',
  );
  if (attended) {
    await frontEnd.waitForDone('you have a GitHub account');
    say('the person pressed Enter after the sign-up page');
  } else {
    say('account taken as made from the answers file');
  }
}
