// Claude Code, before T3 Code is installed and started. T3's first-run wizard, which would have
// offered to install it, is skipped (see t3.js), so the installer installs it. It downloads
// Claude Code itself, as Anthropic's own script would: the version from Anthropic's `latest`, the
// platform's checksum and size from that version's manifest, then the program, with a
// percentage, into the installer's own downloads folder. It checks the SHA-256 and runs
// `claude.exe install latest`, which copies the program into the profile folder's .local\bin and
// records the channel it updates itself on, then deletes the download (kept in a debug run). If
// the version, the manifest, the download or the checksum fails, Anthropic's script installs it
// instead, quietly: it runs hidden with its output captured, under a spinner that says it can
// take several minutes, and why it was needed goes only to the log. A failed `claude install`
// doesn't fall back, since the script ends in the same command. With a downloads folder, the
// three files come from there and nothing falls back. When Claude Code still isn't installed,
// the person can try the whole thing again, as often as it fails, or skip it for now, which
// ends the run as a skipped sign-in does.
//
// Neither route adds .local\bin to PATH, so the installer does, first, whether or not Claude
// Code is there yet: T3 reads PATH only as it starts. Then it asks Claude Code whether it's
// signed in. If it isn't, Claude Code's own sign-in runs in the person's window, reading a
// pasted code from the window (nothing shows in the window as it's pasted, which the notice
// says), while what it prints is kept for the log. The sign-in runs with BROWSER=explorer.exe,
// for that run only, so Claude opens its page in the default browser by itself. A sign-in that
// fails can be tried again, as often as it fails, or skipped for now, and the ending then says
// how to finish. The signed-in email is what Jumpstart reads.
//
// Claude Code isn't pinned: both routes install Anthropic's current release.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { system32 } from './machine.js';
import { loadManifest, toolEntry } from './manifest.js';
import { messageOf } from './stop.js';
import { exists, isRecord, NotInstalled, obtain } from './tools.js';
import { bullet, plainLines, wholeLines } from './text.js';

/**
 * Anthropic's own install script, run as Anthropic says to, in Windows PowerShell from System32.
 * @param {string} script its address
 */
const anthropicsInstaller = (script) => ({
  file: system32(join('WindowsPowerShell', 'v1.0', 'powershell.exe')),
  args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `irm ${script} | iex`],
});

/**
 * What a run skipped for now: Claude Code's install or its sign-in, with why it didn't work.
 * @typedef {{ reason: string, missing: 'installed' | 'signed in' }} Skipped
 */

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
 * @param {import('./questions.js').Asker} ask What answers whether to try a failed install or
 *   sign-in again.
 * @returns {Promise<{ row: string, email: string | null, skipped?: Skipped }>} The checklist's
 *   Claude Code line, the signed-in email, if any, and, when the person skipped the install or
 *   the sign-in for now, which, and why it didn't work.
 */
export async function setUpClaude(context, ask) {
  const { places, machine, frontEnd, downloads, log, attended } = context;
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
  // A failed install is offered again, as often as it fails, each time the whole thing afresh.
  // "Checking Claude Code" starts only once the install's last spinner has ended.
  while (!state.present) {
    const reason = await install(entry, program, context, say);
    state = await look();
    if (state.present) break;
    frontEnd.problem(`${entry.name} isn't installed: ${reason}.`);
    const choice = await ask.choose({
      key: 'claudeInstall',
      message: `${entry.name} isn't installed yet.`,
      options: [
        { value: 'again', label: 'Try again', hint: 'it starts again from the beginning' },
        { value: 'skip', label: 'Skip for now', hint: 'the rest of the install carries on' },
      ],
      // With nobody at the screen, an answers file that says no more doesn't try for ever.
      initial: attended ? 'again' : 'skip',
      inTurn: true,
    });
    log.write(`Answer: claudeInstall: ${JSON.stringify(choice)}`);
    if (choice === 'skip') {
      say('install skipped for now');
      return { row: `Not installed: ${reason}`, email: null, skipped: { reason, missing: 'installed' } };
    }
  }

  /** @type {Skipped | undefined} */
  let skipped;
  if (state.present && state.runs && !state.signedIn) {
    const login = frontEnd.inWindow ? inTheWindow(entry.name, program, context) : onThePage(entry.name, program, context, say);
    frontEnd.notice(login.notice, `Sign in to ${entry.name}`);
    // One rejected code ends Claude's sign-in, so a failed one is offered again, as often as it
    // fails. Each try is a fresh `claude auth login`, with a new link and code.
    for (;;) {
      const { code, output } = await login.run();
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
        skipped = { reason, missing: 'signed in' };
        break;
      }
    }
  }

  return { row: rowFor(state), email: state.signedIn ? (state.email ?? null) : null, ...(skipped !== undefined && { skipped }) };
}

/**
 * Claude's sign-in: what's said before it, and one try at it. Either way it runs as `claude auth
 * login`, with BROWSER=explorer.exe for that run only, and what it prints comes back for the log.
 * @typedef {{ notice: string, run: () => Promise<import('./machine.js').Ran> }} Login
 */

/** For BROWSER: Claude runs it with the address as its only argument, which opens the default browser. */
const authLogin = { args: ['auth', 'login'], env: { BROWSER: 'explorer.exe' } };

/**
 * In the person's window: Claude reads a pasted code from the window itself, and nothing shows
 * as it's pasted, which the notice says.
 * @param {string} name @param {string} program @param {import('./tools.js').Context} context
 * @returns {Login}
 */
function inTheWindow(name, program, { machine, frontEnd }) {
  return {
    notice: [
      `${name} signs you in next, in your browser.`,
      '',
      `  ${bullet} A browser window opens at Claude's sign-in page. Sign in there. ${frontEnd.comeBack()} It carries on by itself.`,
      `  ${bullet} If no window opens, copy the link below into your browser: select it with the mouse, then right-click to copy it.`,
      `  ${bullet} If the page shows a code, copy it, come back here and right-click to paste it. Nothing appears when you paste. Paste once, then press Enter.`,
    ].join('\n'),
    run: () => machine.runOnScreenAndKeep(program, authLogin.args, { env: authLogin.env }),
  };
}

/**
 * On the page: Claude runs piped. Its paste-a-code link, taken from what it prints, goes to the
 * page with a box for the code, which the page writes into Claude's input.
 * @param {string} name @param {string} program @param {import('./tools.js').Context} context @param {(line: string) => void} say
 * @returns {Login}
 */
function onThePage(name, program, { machine, frontEnd }, say) {
  /** Claude's own check: a code is its two parts, with a # between them. @param {string} code */
  const checkCode = (code) => {
    if (!/^[^#\s]+#[^#\s]+$/.test(code)) return "That isn't the whole code. Copy all of it from Claude's page, then paste it again.";
    say('a code was pasted on the page, for the sign-in');
    return undefined;
  };
  return {
    notice: [
      `${name} signs you in next, in your browser.`,
      '',
      `  ${bullet} A new tab opens at Claude's sign-in page. Sign in there. ${frontEnd.comeBack()} It carries on by itself.`,
      `  ${bullet} If no tab opens, use the link below.`,
      `  ${bullet} If the page shows a code, copy it, then paste it into the box below.`,
    ].join('\n'),
    run: () =>
      frontEnd.signIn((show) => {
        let shown = false;
        return machine.runOnScreenAndKeep(program, authLogin.args, {
          env: authLogin.env,
          watch(printed) {
            const link = pasteLinkIn(printed);
            if (shown || link === undefined) return;
            shown = true;
            show({ link: { url: link, label: 'If no tab opens, use this link' }, codeBox: checkCode });
          },
        });
      }),
  };
}

/**
 * The paste-a-code address `claude auth login` prints ("If the browser didn't open, visit: …"),
 * once it has printed the whole line.
 * @param {string} printed
 */
function pasteLinkIn(printed) {
  for (const line of wholeLines(printed)) {
    const link = /visit:\s*(https:\/\/\S+)/.exec(line)?.[1];
    if (link) return link;
  }
  return undefined;
}

/**
 * The outcome of a step of Claude Code's own route: installed, or why not, and whether it failed
 * before `claude install`, so Anthropic's script may install it instead.
 * @typedef {{ installed: true } | { installed: false, reason: string, fallBack: boolean }} Outcome
 */

/**
 * One try at installing Claude Code: its own download, then, if that fails before `claude
 * install` and there's no downloads folder, Anthropic's script.
 * @param {import('./manifest.js').ClaudeEntry} entry @param {string} program where it should end up
 * @param {import('./tools.js').Context} context @param {(line: string) => void} say
 * @returns {Promise<string>} why it isn't installed, in words for the checklist; empty once it is
 */
async function install(entry, program, context, say) {
  const { machine, frontEnd, downloads, log } = context;
  const own = await ownRoute(entry, program, context, say);
  if (own.installed) {
    say('installed by its own download');
    return '';
  }
  if (!own.fallBack) return own.reason;
  if (downloads) {
    say(`Anthropic's script isn't run when the files come from the downloads folder, so it isn't installed: ${own.reason}`);
    return own.reason;
  }
  say(`falling back to Anthropic's script, because ${own.reason}`);
  const script = anthropicsInstaller(entry.fallback.script);
  const { ran, there } = await frontEnd.busy(
    `Installing ${entry.name}. It's over 300 MB, so this can take several minutes`,
    async () => {
      const ran = await machine.run(script.file, script.args);
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
  if (!there) {
    say(`Anthropic's script finished with code ${ran.code}, and ${program} isn't there`);
    return `${entry.name}'s installer didn't finish`;
  }
  say(`installed by Anthropic's script (code ${ran.code})`);
  return '';
}

/**
 * The Installer's own route: the version, the manifest, the download with progress, the
 * checksum, and `claude install`. Each step is logged; how far the download has got isn't.
 * @param {import('./manifest.js').ClaudeEntry} entry @param {string} program
 * @param {import('./tools.js').Context} context @param {(line: string) => void} say
 * @returns {Promise<Outcome>}
 */
async function ownRoute(entry, program, { places, machine, frontEnd, downloads, keepDownloads, log }, say) {
  /** Why a step failed, in words for the checklist; an unexpected error's whole story is logged. @param {unknown} error */
  const why = (error) => {
    if (!(error instanceof NotInstalled)) say(`failed: ${error instanceof Error ? error.stack : String(error)}`);
    return error instanceof NotInstalled ? error.message : messageOf(error);
  };
  /** A file's address below the release server's, which is where a downloads folder holds it. @param {string} url */
  const inFolder = (url) => url.slice(entry.releases.length + 1);

  /** @type {{ url: string, checksum: string, size?: number }} */
  let release;
  try {
    release = await findRelease(entry, { downloads, inFolder, say });
  } catch (error) {
    return { installed: false, reason: why(error), fallBack: true };
  }

  const megabytes = release.size === undefined ? '' : ` (${Math.round(release.size / 1_000_000)} MB)`;
  const message = `Downloading ${entry.name}${megabytes}`;
  const expected = release.size === undefined ? '' : `, of the ${release.size} expected`;
  const started = performance.now();
  const took = () => `${((performance.now() - started) / 1000).toFixed(1)} s`;
  let received = 0;
  const fetched = await frontEnd.busy(
    message,
    /** @returns {Promise<{ file: string } | { reason: string }>} */
    async (progress) => {
      try {
        const file = await obtain(
          { url: release.url, size: release.size, from: inFolder(release.url) },
          {
            downloads,
            saveIn: join(places.state, 'downloads'),
            say,
            progress: (bytes, total) => {
              received = bytes;
              progress(bytes, total);
            },
          },
        );
        say(`${(await stat(file)).size} bytes came${expected}, in ${took()}`);
        return { file };
      } catch (error) {
        say(`${received} bytes came${expected}, before it stopped, in ${took()}`);
        return { reason: why(error) };
      }
    },
    // A download that fails gives way quietly to Anthropic's script, with no mark of failure.
    (fetched) => ('file' in fetched ? { text: `${entry.name} downloaded`, ok: true } : { text: message }),
  );
  if (!('file' in fetched)) return { installed: false, reason: fetched.reason, fallBack: true };
  const { file } = fetched;

  try {
    return await frontEnd.busy(
      `Setting up ${entry.name}`,
      /** @returns {Promise<Outcome>} */
      async () => {
        try {
          await checkSha256(file, release.checksum, say);
        } catch (error) {
          return { installed: false, reason: why(error), fallBack: true };
        }
        const ran = await machine.run(file, ['install', entry.channel]);
        say(`claude install ${entry.channel} finished with code ${ran.code}`);
        // The machine has logged what it printed after a non-zero exit, and in a debug run.
        if (ran.code === 0 && !log.debug) for (const line of plainLines(ran.output)) say(`claude install said: ${line}`);
        if (ran.code !== 0) return { installed: false, reason: `its setup stopped with code ${ran.code}`, fallBack: false };
        if (!(await exists(program))) {
          say(`${program} isn't there after claude install`);
          return { installed: false, reason: "its setup didn't leave it in place", fallBack: false };
        }
        return { installed: true };
      },
      (outcome) =>
        outcome.installed
          ? { text: `${entry.name} installed`, ok: true }
          : outcome.fallBack
            ? { text: `Setting up ${entry.name}` }
            : { text: `${entry.name} not installed: ${outcome.reason}`, ok: false },
    );
  } finally {
    if (keepDownloads) say(`kept ${file}`);
    else {
      // A program that has only just run can still be held open for a moment (by antivirus, say).
      // A download that can't be deleted is logged, and never changes how the install went.
      try {
        await rm(file, { force: true, maxRetries: 5, retryDelay: 200 });
      } catch (error) {
        say(`couldn't delete ${file}: ${messageOf(error)}`);
      }
    }
  }
}

/**
 * Claude Code's current release on the entry's channel, for this computer: its address, and the
 * checksum and size Anthropic's manifest gives it.
 * @param {import('./manifest.js').ClaudeEntry} entry
 * @param {{ downloads?: string, inFolder: (url: string) => string, say: (line: string) => void }} how
 * @returns {Promise<{ url: string, checksum: string, size?: number }>}
 */
async function findRelease(entry, { downloads, inFolder, say }) {
  /** @param {string} url */
  const read = (url) => readText(url, { downloads, from: inFolder(url), say });
  const platform = entry.files[process.arch];
  if (!platform) throw new NotInstalled(`there's no build of it for this kind of computer (${process.arch})`);
  const version = (await read(`${entry.releases}/${entry.channel}`)).trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    say(`the ${entry.channel} version, ${JSON.stringify(version.slice(0, 80))}, isn't a version number`);
    throw new NotInstalled(`its ${entry.channel} version couldn't be read`);
  }
  say(`the ${entry.channel} version is ${version}`);
  const found = platformIn(await read(`${entry.releases}/${version}/manifest.json`), platform, say);
  const url = `${entry.releases}/${version}/${platform}/claude.exe`;
  say(`${platform}: ${found.size === undefined ? 'no size given' : `${found.size} bytes expected`}, SHA-256 ${found.checksum}`);
  return { url, ...found };
}

/**
 * A small text file of Claude Code's release (its version, its manifest): read from the release
 * server, or from the downloads folder at `from`.
 * @param {string} url @param {{ downloads?: string, from: string, say: (line: string) => void }} how
 */
async function readText(url, { downloads, from, say }) {
  if (downloads) {
    const file = join(downloads, from);
    try {
      const text = await readFile(file, 'utf8');
      say(`taking ${file}`);
      return text;
    } catch {
      say(`${file} isn't there`);
      throw new NotInstalled("it wasn't in the downloads folder");
    }
  }
  say(`reading ${url}`);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`the server said ${response.status} ${response.statusText}`);
    return await response.text();
  } catch (error) {
    const cause = error instanceof Error && error.cause ? error.cause : error;
    say(`couldn't read ${url}: ${messageOf(cause)}`);
    throw new NotInstalled(`${url} couldn't be read`);
  }
}

/**
 * A platform's checksum and size in Anthropic's manifest for a version. The size is left out
 * if it isn't a whole number of bytes.
 * @param {string} text @param {string} platform @param {(line: string) => void} say
 * @returns {{ checksum: string, size?: number }}
 */
function platformIn(text, platform, say) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    say(`Anthropic's manifest isn't valid JSON: ${messageOf(error)}`);
    throw new NotInstalled("Anthropic's list of its files couldn't be read");
  }
  const found = isRecord(manifest) && isRecord(manifest.platforms) ? manifest.platforms[platform] : undefined;
  const checksum = isRecord(found) ? found.checksum : undefined;
  if (!isRecord(found) || typeof checksum !== 'string' || !/^[0-9a-f]{64}$/i.test(checksum)) {
    say(`Anthropic's manifest has no SHA-256 for ${platform}`);
    throw new NotInstalled(`Anthropic's list of its files has nothing for ${platform}`);
  }
  const size = found.size;
  return { checksum, ...(typeof size === 'number' && Number.isSafeInteger(size) && size > 0 && { size }) };
}

/** @param {string} file @param {string} expected @param {(line: string) => void} say */
async function checkSha256(file, expected, say) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  const actual = hash.digest('hex');
  if (actual !== expected.toLowerCase()) {
    say(`checksum ${actual} isn't Anthropic's ${expected}`);
    throw new NotInstalled("the download didn't match Anthropic's checksum");
  }
  say("checksum matches Anthropic's");
}

/**
 * The ending after Claude Code's install or sign-in was skipped for now: no "All done", and T3
 * Code isn't opened, since it can't use Claude Code yet. A T3 Code that was open during the
 * install reads PATH only when it starts, so it has to be closed first. Pasting the line again
 * installs it or signs in, as a run that finds Claude Code missing or signed out always does.
 * Claude Code's row is already among what didn't work. After a sign-in, Claude's own reason is
 * repeated with it (an install's is in its row already). Any other step that didn't work is
 * named on a line after this closing line.
 * @param {import('./ending.js').Ending} ending
 * @param {Skipped} skipped What was skipped, and why.
 * @param {import('./ending.js').ToolNames} tools
 */
export function endAfterSkipped(ending, { reason, missing }, { claude, t3 }) {
  if (missing === 'signed in') ending.lines.push(reason);
  const again = missing === 'installed' ? 'installs it' : 'signs you in';
  ending.closing = {
    step: claude,
    line: `One step didn't work: ${claude} isn't ${missing}, so ${t3} can't use it yet. If ${t3} is open, close it. Then paste the line again: it ${again} and skips everything that's already done.`,
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
