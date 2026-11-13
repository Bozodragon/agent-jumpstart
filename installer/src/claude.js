// Claude Code, before T3 Code is installed and started. T3's first-run wizard, which would have
// offered to install it, is skipped (see t3.js), so the installer installs it with Anthropic's
// own install script. The script shows no progress of its own, so it runs hidden with its output
// captured, like every other install, under a spinner that says it can take several minutes. It
// puts claude.exe in the profile folder's .local\bin and never adds that folder to PATH, so the
// installer does, first, whether or not Claude Code is there yet: T3 reads PATH only as it
// starts. Then it asks Claude Code whether it's signed in. If it isn't, Claude Code's own
// sign-in runs in the person's window, reading a pasted code from the window (nothing shows in
// the window as it's pasted, which the notice says), while what it prints is kept for the log.
// The sign-in runs with BROWSER=explorer.exe, for that run only, so Claude opens its page in the
// default browser by itself. A sign-in that fails can be tried again, as often as it fails, or
// skipped for now, and the ending then says how to finish. The signed-in email is what
// Jumpstart reads.
//
// Claude Code isn't pinned: the script installs Anthropic's current release.
import { join } from 'node:path';
import { system32 } from './machine.js';
import { loadManifest, toolEntry } from './manifest.js';
import { exists } from './tools.js';
import { bullet } from './text.js';

/** Anthropic's own installer, run as Anthropic says to, in Windows PowerShell from System32. */
const anthropicsInstaller = {
  file: system32(join('WindowsPowerShell', 'v1.0', 'powershell.exe')),
  args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'],
};

/**
 * @typedef {object} ClaudeState
 * @property {boolean} present
 * @property {boolean} runs
 * @property {string} [version]
 * @property {boolean} signedIn
 * @property {string} [email]
 */

/**
 * Installs Claude Code if it isn't there, puts its folder on the user PATH, and signs the person
 * in if they aren't. Before T3 is installed and started.
 * @param {import('./tools.js').Context} context
 * @param {import('./questions.js').Asker} ask What answers whether to try a failed sign-in again.
 * @returns {Promise<{ row: string, email: string | null, skipped?: string }>} The checklist's
 *   Claude Code line, the signed-in email, if any, and, when the person skipped the sign-in for
 *   now, Claude's own reason it failed.
 */
export async function setUpClaude({ places, machine, frontEnd, downloads, log, attended }, ask) {
  const entry = toolEntry(await loadManifest(downloads), 'claude');
  if (!entry) return { row: 'Not checked: the list of versions has no entry for it', email: null };
  const say = (/** @type {string} */ line) => log.write(`${entry.name}: ${line}`);
  const folder = join(places.home, entry.install.folder);
  const program = join(folder, entry.install.check);
  // Before T3 starts, even if the install below doesn't finish: T3 then finds it once it's there.
  say((await machine.addToUserPath(folder)) ? `added ${folder} to the user PATH` : `${folder} was already on the user PATH`);

  // Claude Code takes a few seconds to answer each time, with nothing on screen of its own.
  const look = () =>
    frontEnd.busy(`Checking ${entry.name}`, async () => {
      const state = await lookAt(program, machine);
      say(describe(state, program));
      return state;
    });

  let state = await look();
  if (!state.present) {
    // Whether claude.exe is there afterwards is checked inside the spinner, which shows nothing
    // else while it runs, so "Checking Claude Code" starts only once this spinner has ended.
    const { ran, there } = await frontEnd.busy(
      `Installing ${entry.name}. It's over 300 MB, so this can take several minutes`,
      async () => {
        const ran = await machine.run(anthropicsInstaller.file, anthropicsInstaller.args);
        return { ran, there: await exists(program) };
      },
      ({ there }) =>
        there
          ? { text: `${entry.name} installed`, ok: true }
          : { text: `${entry.name} not installed: its installer didn't finish`, ok: false },
    );
    // The machine has logged what the script printed after a non-zero exit, and in a debug run.
    // An exit code of 0 that left no claude.exe would otherwise leave no trace of it.
    if (ran.code === 0 && !there && !log.debug) for (const line of plainLines(ran.output)) say(`installer said: ${line}`);
    state = await look();
    say(state.present ? `installed by its installer (code ${ran.code})` : `its installer finished with code ${ran.code}, and ${program} isn't there`);
  }

  /** @type {string | undefined} */
  let skipped;
  if (state.present && state.runs && !state.signedIn) {
    frontEnd.notice(
      [
        `${entry.name} signs you in next, in your browser.`,
        '',
        `  ${bullet} A browser window opens at Claude's sign-in page. Sign in there. ${frontEnd.comeBack()} It carries on by itself.`,
        `  ${bullet} If no window opens, copy the link below into your browser: select it with the mouse, then right-click to copy it.`,
        `  ${bullet} If the page shows a code, copy it, come back here and right-click to paste it. Nothing appears when you paste. Paste once, then press Enter.`,
      ].join('\n'),
      `Sign in to ${entry.name}`,
    );
    // One rejected code ends Claude's sign-in, so a failed one is offered again, as often as it
    // fails. Each try is a fresh `claude auth login`, with a new link and code.
    for (;;) {
      const { code, output } = await machine.runOnScreenAndKeep(program, ['auth', 'login'], { env: { BROWSER: 'explorer.exe' } });
      for (const line of withoutWhatWasTyped(output)) say(`sign-in said: ${line}`);
      say(`sign-in finished with code ${code}`);
      state = await look();
      if (state.signedIn) break;
      const reason = reasonFrom(output) ?? `${entry.name}'s sign-in ended with code ${code}`;
      frontEnd.problem(reason);
      const choice = await ask.choose({
        key: 'claudeSignIn',
        message: `${entry.name} isn't signed in yet.`,
        options: [
          { value: 'again', label: 'Try again', hint: 'a new link and code' },
          { value: 'skip', label: 'Skip for now', hint: 'the rest of the install carries on' },
        ],
        // With nobody at the screen, an answers file that says no more doesn't try for ever.
        initial: attended ? 'again' : 'skip',
        inTurn: true,
      });
      log.write(`Answer: claudeSignIn: ${JSON.stringify(choice)}`);
      if (choice === 'skip') {
        say('sign-in skipped for now');
        skipped = reason;
        break;
      }
    }
  }

  return { row: rowFor(state), email: state.signedIn ? (state.email ?? null) : null, ...(skipped !== undefined && { skipped }) };
}

/**
 * The ending after a sign-in skipped for now: no "All done", and T3 Code isn't opened, since it
 * can't use Claude Code yet. A T3 Code that was open during the install reads PATH only when it
 * starts, so it has to be closed first. Pasting the line again signs in, as a run that finds
 * Claude Code signed out always does. Claude Code's row (", not signed in") is already among
 * what didn't work; Claude's own reason is repeated with it. Any other step that didn't work is
 * named on a line after this closing line.
 * @param {import('./ending.js').Ending} ending
 * @param {string} reason Claude's own reason the sign-in failed.
 * @param {import('./ending.js').ToolNames} tools
 */
export function endAfterSkippedSignIn(ending, reason, { claude, t3 }) {
  ending.lines.push(reason);
  ending.closing = {
    step: claude,
    line: `One step didn't work: ${claude} isn't signed in, so ${t3} can't use it yet. If ${t3} is open, close it. Then paste the line again: it signs you in and skips everything that's already done.`,
  };
  ending.openT3 = false;
}

/**
 * Claude's own reason for a failed sign-in: its "Login failed: ..." line.
 * @param {string} output
 */
function reasonFrom(output) {
  return plainLines(output).find((line) => line.startsWith('Login failed:'));
}

/**
 * Claude's sign-in lines, for the log, cut short after its paste prompt ("Paste code here if
 * prompted >"): the code the person pastes there could be used to sign in as them. Claude doesn't
 * print the code (nothing shows as it's pasted, and it doesn't pass through the installer),
 * but if it ever did, it would be there, so nothing after the prompt on its line is kept but
 * Claude's own "Login successful." or "Login failed: ...", which follows it there when the
 * browser hands the sign-in back by itself.
 * @param {string} output
 */
function withoutWhatWasTyped(output) {
  return plainLines(output).flatMap((line) => {
    const prompt = /^.*?Paste code here[^>]*>/.exec(line)?.[0];
    if (prompt === undefined) return [line];
    const after = line.slice(prompt.length).trim();
    return /^Login (successful\.|failed:)/.test(after) ? [prompt, after] : [prompt];
  });
}

/**
 * What a program printed, as lines of plain text: without the colours and links a terminal
 * would draw, and without the blank lines.
 * @param {string} output
 */
function plainLines(output) {
  return output
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
}

/** @param {string} program @param {import('./machine.js').Machine} machine @returns {Promise<ClaudeState>} */
async function lookAt(program, machine) {
  if (!(await exists(program))) return { present: false, runs: false, signedIn: false };
  const ran = await machine.run(program, ['--version']);
  if (ran.code !== 0) return { present: true, runs: false, signedIn: false };
  const version = /\d+\.\d+\.\d+/.exec(ran.output)?.[0];
  // Exit 0 and loggedIn means signed in; signed out prints loggedIn false and exits 1.
  const status = await machine.run(program, ['auth', 'status']);
  let details = {};
  try {
    details = JSON.parse(status.output);
  } catch {}
  const signedIn = status.code === 0 && /** @type {{ loggedIn?: boolean }} */ (details).loggedIn !== false;
  const email = /** @type {{ email?: unknown }} */ (details).email;
  return { present: true, runs: true, version, signedIn, email: typeof email === 'string' ? email : undefined };
}

/** @param {ClaudeState} state @param {string} program */
function describe(state, program) {
  if (!state.present) return `${program} isn't there`;
  if (!state.runs) return `${program} --version failed`;
  return `${state.version ?? 'unknown version'}, ${state.signedIn ? `signed in${state.email ? ` as ${state.email}` : ''}` : 'not signed in'}`;
}

/** @param {ClaudeState} state */
function rowFor(state) {
  if (!state.present) return "Not installed: Claude Code's installer didn't finish";
  if (!state.runs) return "Not installed: Windows wouldn't run it";
  const version = state.version ?? 'Installed';
  if (!state.signedIn) return `${version}, not signed in`;
  return state.email ? `${version}, signed in as ${state.email}` : `${version}, signed in`;
}
