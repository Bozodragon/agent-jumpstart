// Claude Code, after T3's first launch. The installer doesn't install Claude Code: T3's welcome
// screen does, with Anthropic's own installer, which puts claude.exe in the profile folder's
// .local\bin and never adds that folder to PATH. So the installer adds the folder to the user
// PATH before T3 is installed and started (T3 reads PATH only when it starts, so it then finds
// Claude Code as soon as its welcome screen has installed it), checks it's there afterwards,
// and asks Claude Code whether it's signed in. If it isn't, Claude Code's own sign-in runs in
// the person's window. The signed-in email is what Jumpstart reads.
import { join } from 'node:path';
import { loadManifest, toolEntry } from './manifest.js';
import { exists } from './tools.js';
import * as ui from './ui.js';

/**
 * Puts the folder Claude Code's own installer uses on the user PATH, whether or not it's there
 * yet. Before T3 is installed and started.
 * @param {import('./tools.js').Context} context
 */
export async function makeWayForClaude({ places, machine, downloads, log }) {
  const entry = toolEntry(await loadManifest(downloads), 'claude');
  if (!entry) return;
  const folder = join(places.home, entry.install.folder);
  const added = await machine.addToUserPath(folder);
  log.write(`${entry.name}: ${added ? `added ${folder} to the user PATH, before T3 Code starts, so T3 Code finds it once installed` : `${folder} was already on the user PATH`}`);
}

/**
 * @typedef {object} ClaudeState
 * @property {boolean} present
 * @property {boolean} runs
 * @property {string} [version]
 * @property {boolean} signedIn
 * @property {string} [email]
 */

/**
 * @param {import('./tools.js').Context & { t3: import('./t3.js').T3Result }} context
 * @returns {Promise<{ row: string, email: string | null }>} The checklist's Claude Code line and
 *   the signed-in email, if any.
 */
export async function checkClaude({ places, machine, downloads, log, attended, t3 }) {
  const entry = toolEntry(await loadManifest(downloads), 'claude');
  if (!entry) return { row: 'Not checked: the list of versions has no entry for it', email: null };
  const say = (/** @type {string} */ line) => log.write(`${entry.name}: ${line}`);
  const folder = join(places.home, entry.install.folder);
  const program = join(folder, entry.install.check);
  ui.step(`Checking ${entry.name}`);

  const look = async () => {
    const state = await lookAt(program, machine);
    say(describe(state, program));
    return state;
  };

  let state = await look();
  if (!state.present && attended && t3.installed) {
    ui.notice(
      [
        `T3 Code installs ${entry.name}. In T3 Code's welcome screen, next to Claude:`,
        '',
        `  ${ui.bullet} Click Install.`,
        `  ${ui.bullet} A window opens with a command typed in. Press Enter in it.`,
        `  ${ui.bullet} Wait until it says it's finished.`,
        '',
        "Don't sign in there: that comes next, here.",
      ].join('\n'),
      `Install ${entry.name}`,
    );
    await ui.pressEnter(`Press Enter once T3 Code has installed ${entry.name}.`);
    say('the person pressed Enter');
    state = await look();
  }

  if (state.present && state.runs) {
    say((await machine.addToUserPath(folder)) ? `added ${folder} to the user PATH` : `${folder} was already on the user PATH`);
    if (!state.signedIn) {
      ui.notice(
        [
          `${entry.name} signs you in next, in your browser:`,
          '',
          `  ${ui.bullet} Press Enter to choose your Claude account.`,
          `  ${ui.bullet} Sign in in the browser window that opens.`,
          `  ${ui.bullet} Come back here and press Enter when it says Login successful.`,
        ].join('\n'),
        `Sign in to ${entry.name}`,
      );
      const code = await machine.runOnScreen(program, ['auth', 'login']);
      say(`sign-in finished with code ${code}`);
      state = await look();
    }
  }

  return { row: rowFor(state), email: state.signedIn ? (state.email ?? null) : null };
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
  if (!state.present) return "Not installed: T3 Code's welcome screen installs it";
  if (!state.runs) return "Not installed: Windows wouldn't run it";
  const version = state.version ?? 'Installed';
  if (!state.signedIn) return `${version}, not signed in`;
  return state.email ? `${version}, signed in as ${state.email}` : `${version}, signed in`;
}
