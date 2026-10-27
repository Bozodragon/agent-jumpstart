// Claude Code, before T3 Code is installed and started. T3's first-run wizard, which would have
// offered to install it, is skipped (see t3.js), so the installer installs it with Anthropic's
// own install script, run in the person's window so they see its progress. The script puts
// claude.exe in the profile folder's .local\bin and never adds that folder to PATH, so the
// installer does, first, whether or not Claude Code is there yet: T3 reads PATH only as it
// starts. Then it asks Claude Code whether it's signed in. If it isn't, Claude Code's own
// sign-in runs in the person's window. The signed-in email is what Jumpstart reads.
//
// Claude Code isn't pinned: the script installs Anthropic's current release.
import { join } from 'node:path';
import { system32 } from './machine.js';
import { loadManifest, toolEntry } from './manifest.js';
import { exists } from './tools.js';
import * as ui from './ui.js';

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
 * @returns {Promise<{ row: string, email: string | null }>} The checklist's Claude Code line and
 *   the signed-in email, if any.
 */
export async function setUpClaude({ places, machine, downloads, log }) {
  const entry = toolEntry(await loadManifest(downloads), 'claude');
  if (!entry) return { row: 'Not checked: the list of versions has no entry for it', email: null };
  const say = (/** @type {string} */ line) => log.write(`${entry.name}: ${line}`);
  const folder = join(places.home, entry.install.folder);
  const program = join(folder, entry.install.check);
  // Before T3 starts, even if the install below doesn't finish: T3 then finds it once it's there.
  say((await machine.addToUserPath(folder)) ? `added ${folder} to the user PATH` : `${folder} was already on the user PATH`);

  const look = async () => {
    const state = await lookAt(program, machine);
    say(describe(state, program));
    return state;
  };

  ui.step(`Checking ${entry.name}`);
  let state = await look();
  if (!state.present) {
    // Its own installer shows its progress in this window, so there's no spinner over it.
    ui.step(`Installing ${entry.name} with Anthropic's own installer. Its progress shows below; it takes a minute or two.`);
    const code = await machine.runOnScreen(anthropicsInstaller.file, anthropicsInstaller.args);
    state = await look();
    say(state.present ? `installed by its installer (code ${code})` : `its installer finished with code ${code}, and ${program} isn't there`);
  }

  if (state.present && state.runs) {
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
  if (!state.present) return "Not installed: Claude Code's installer didn't finish";
  if (!state.runs) return "Not installed: Windows wouldn't run it";
  const version = state.version ?? 'Installed';
  if (!state.signedIn) return `${version}, not signed in`;
  return state.email ? `${version}, signed in as ${state.email}` : `${version}, signed in`;
}
