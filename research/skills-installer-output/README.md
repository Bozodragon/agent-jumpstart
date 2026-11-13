# The skills installer's own output on the Installer page

Research for issue #88. The question: can the Installer page show what the skills CLI really prints during the skills step, instead of the faked output in the prototype?

Each finding is marked:

- **Confirmed**: read in the source of the version named, with a link or file and line; or seen in a run done for this research (in `samples/`).
- **Unconfirmed**: inferred, or not tested.

Versions: the skills CLI **1.7.4** (pinned in `manifest.json`), from [its npm tarball](https://registry.npmjs.org/skills/-/skills-1.7.4.tgz). Its SHA-256 matched the manifest (`fee71731…d838dd`). The tag [`v1.7.4`](https://github.com/vercel-labs/skills/tree/v1.7.4) is on GitHub, so source links point there. The runs used Node **26.12.1**, the Installer's own Node, also checked against the manifest. node-pty **1.1.0**, @lydell/node-pty **1.2.0-beta.18** and xterm.js **6.0.0** are the versions on npm on 2026-11-13.

## How the runs were done

- The tarball was installed into its own folder with `npm install --ignore-scripts`. The CLI was run as `<node 26.12.1> …\skills\bin\cli.mjs add mattpocock/skills -g -a claude-code -y -s grilling`, the same shape as `installer/src/skills.js`.
- A small runner spawned it the way `runProgram` in `installer/src/machine.js` (about line 618) does: `spawn(file, args, { env, windowsHide: true })` with stdout and stderr piped. It kept every chunk with its arrival time and stream.
- The environment was cut down to what a plain PowerShell console gives: PATH, SystemRoot, TEMP and similar. `USERPROFILE` and `HOME` pointed at a fresh empty folder for each run. Skills landed there, never in a real `.claude\skills`.
  - This mattered. The research session itself sets `TERM`, `CLAUDECODE`, `AI_AGENT` and `CLAUDE_CONFIG_DIR`, and each one changes what the CLI prints or where it installs (see below).
- Variants: plain; `FORCE_COLOR=1`; `WT_SESSION` set (Windows Terminal sets this); `CI=true`; `NO_COLOR=1`; `--color`; `--json`; two skills; and a subpath source (`cursor/plugins/pstack/skills/unslop`). Every run exited 0 in 1.3 to 3 seconds.
- The CLI's telemetry and audit lookup were left on, as they are when the Installer runs it.

The captured chunks are in [`samples/`](samples/), JSON-escaped, with local paths redacted.

## Answer

- **Piped, it still prints everything.** It shows the logo, the rails, the boxes, the ticks and an animated spinner. It never drops to plain lines.
- **The spinner animates on a pipe too.** It redraws with `ESC[1G` `ESC[J` (go to column 1, erase down), not with `\r`. It also hides and shows the cursor (`ESC[?25l`, `ESC[?25h`).
- **On Windows, colour comes from two places.**
  - picocolors colours everything the CLI colours itself, piped or not, because it turns colour on for every `win32` process.
  - clack's own colours (grey rails, magenta spinner frames) are dropped on a pipe. `FORCE_COLOR=1` brings them back. Nothing else changes.
- **ASCII or Unicode depends on the environment, not the pipe.** In a plain console the rails are ASCII (`T | o — +-`), with spinner frames `• o O 0`. If `WT_SESSION` or `CI` is set, they are Unicode (`┌ │ ◇ └ ╮`), with frames `◒ ◐ ◓ ◑`.
- **A pseudo-terminal is possible without a compiler or admin rights, but it isn't needed.**
  - node-pty 1.1.0 ships prebuilt N-API binaries for Windows x64 and arm64. They loaded on Node 26.12.1 with install scripts turned off.
  - A ConPTY re-encodes the output into absolute cursor moves and screen clears. Only a full emulator draws that.
- **For the page, the piped output needs only a small converter and one pre-pass.** The sequences that appear are SGR colour codes, `ESC[1G`, `ESC[J` and `ESC[?25l/h`. `ESC[nA` appears only if a spinner line wraps.
- **`--json` exists.** It gives one record per skill on stdout and moves all the human output to stderr. That human output has no logo, no spinner and no cursor codes.
- **There's no per-skill progress while it installs.** Each source is one clone, then a single "Installing skills…" spinner. Skill names appear only in the boxes before and after.

## 1. What `skills add` 1.7.4 prints when stdout and stderr are pipes

### The libraries

**Confirmed (package).** The CLI bundles its UI libraries into `dist/_chunks/libs/`. It has no runtime dependency on them; its only runtime dependencies are `tar` and `yaml`.

- **@clack/prompts and @clack/core** draw the rails, boxes and spinner. `ThirdPartyNoticeText.txt` names `@clack/prompts@1.7.0`; `package.json` asks for `^1.2.0`. The behaviour below was read in the bundled code itself.
- **picocolors 1.1.1** colours the CLI's own text: the cyan skill names, green ticks, the `skills` badge.
- clack colours its own symbols with Node's built-in `util.styleText`, not picocolors.
- **@vercel/detect-agent** looks for coding agents.
- No ora or chalk.

### Colour: who checks what

**Confirmed (bundled code and runs).**

- **picocolors**, `dist/_chunks/libs/picocolors.mjs` line 6:
  ```js
  isColorSupported = !(!!env.NO_COLOR || argv.includes("--no-color")) &&
    (!!env.FORCE_COLOR || argv.includes("--color") || p.platform === "win32" || (p.stdout || {}).isTTY && env.TERM !== "dumb" || !!env.CI)
  ```
  On Windows, `p.platform === "win32"` makes it true unless `NO_COLOR` or `--no-color` is given. So the CLI's own colours survive a pipe.
- **clack** (`dist/_chunks/libs/@clack/prompts.mjs`) calls `styleText(...)` with its defaults. Node's docs say `validateStream` defaults to `true`, against `process.stdout`, and "acts according to … `NO_COLOR`, `NODE_DISABLE_COLORS` and `FORCE_COLOR`" ([util.styleText](https://nodejs.org/docs/latest-v26.x/api/util.html#utilstyletextformat-text-options)). So on a pipe, clack's grey rails, magenta spinner frames and blue `●` are plain. The plain run has no `ESC[90m`, `ESC[35m` or `ESC[34m`.
- **The logo** is written with hard-coded escape codes (`\x1B[38;5;250m` … `238m`) and no check of any kind ([`src/cli.ts` L57](https://github.com/vercel-labs/skills/blob/v1.7.4/src/cli.ts#L57)). It appears even with `NO_COLOR=1`.

### Unicode or ASCII

**Confirmed (bundled code and runs).** `isUnicodeSupported()` (`prompts.mjs` lines 6-9) returns true on Windows only if one of these is set: `CI`, `WT_SESSION`, `TERMINUS_SUBLIME`, `ConEmuTask={cmd::Cmder}`, `TERM_PROGRAM` of `vscode` or `Terminus-Sublime`, `TERM` of `xterm-256color` or `alacritty`, or `TERMINAL_EMULATOR=JetBrains-JediTerm`. It doesn't look at the pipe.

- Plain run: `T`, `|`, `o`, `•`, `—`, `+---+`, and spinner frames `• o O 0` every 120 ms.
- `WT_SESSION` set: `┌ │ ◇ ● └ ╮ ╯ ├ ─`, and spinner frames `◒ ◐ ◓ ◑` every 80 ms.
- The `✓` and `→` in the result box come from the CLI itself, and are Unicode in every run.

**Unconfirmed:** which console York laptops open the Installer in. On Windows 11, the default is usually Windows Terminal, which sets `WT_SESSION`. The Installer passes its whole environment on to the CLI (`withPath` in `installer/src/machine.js` about line 286). So the rails follow whatever console the person started it from.

### The spinner on a pipe

**Confirmed (bundled code and run).** clack's `spinner()` (`prompts.mjs` from line 311) has no TTY check.

- It starts with `block()`, which writes `ESC[?25l` (hide the cursor) and opens a readline on stdin.
- Each tick it writes `ESC[1G` `ESC[J` and then the next frame. If the last frame wrapped, it writes `ESC[nA` first.
- `stop` writes the final line with `\n` and `ESC[?25h`.
- On a pipe, its width is taken as 80 (`getColumns` in `core.mjs`).

From [`samples/piped-plain.spinner.od.txt`](samples/piped-plain.spinner.od.txt):

```
0000000    |  \n 342 200 242           C   l   o   n   i   n   g       r
0000020    e   p   o   s   i   t   o   r   y 342 200 246\033   [   1   G
0000040 \033   [   J   o           C   l   o   n   i   n   g       r   e
```

Sequences counted in the plain piped run ([`samples/piped-plain.chunks.txt`](samples/piped-plain.chunks.txt)):

| Sequence | Count | From |
|---|---|---|
| SGR (`ESC[…m`): 16 colours, 256-colour `38;5;n`, bold, dim, background | 60 | picocolors, the logo |
| `ESC[1G` (column 1) | 9 | spinner redraws |
| `ESC[J` (erase down) | 9 | spinner redraws |
| `ESC[?25l` / `ESC[?25h` (hide/show cursor) | 4 / 4 | spinner start/stop |
| `\r` | **0** | (none) |
| Anything else | 0 | (none) |

### Everything it prints, in order

**Confirmed (run, plain environment).** This is the output after settling the redraws (see question 4), with the colour codes removed. The 6-line SKILLS logo comes first and is left out here, and the temporary path is redacted:

```
T   skills
|
|  Tip: use the --yes (-y) and --global (-g) flags to install without prompts.
|
o  Source: https://github.com/mattpocock/skills.git
|
o  Repository cloned
|
⚠ Skipped <TEMP>\skills-ZPj5tw\skills\in-progress\software-factory\SKILL.md — YAML parse error: Nested mappings are not allowed in compact mappings at line 2, column 14:

description: Shared language for designing a software factory: the tasks it run…
             ^

o  Found 38 skills
|
•  Selected 1 skill: grilling

|
o  Installation Summary ------+
|                             |
|                             |
|  Mattpocock Skills          |
|                             |
|  ~\.agents\skills\grilling  |
|    copy → Claude Code       |
|                             |
+-----------------------------+
|
o  Security Risk Assessments ------------------------------+
|                                                          |
|            Gen               Socket            Snyk      |
|  grilling  Safe              0 alerts          Low Risk  |
|                                                          |
|  Details: https://skills.sh/mattpocock/skills            |
|                                                          |
+----------------------------------------------------------+
|
o  Installation complete

|
o  Installed 1 skill -------------+
|                                 |
|                                 |
|  Mattpocock Skills              |
|  ✓ grilling (copied)            |
|    → ~\.claude\skills\grilling  |
|                                 |
+---------------------------------+

|
—  Done!  Review skills before use; they run with full agent permissions.
```

- **Everything goes to stdout except the CLI's own warnings.** `⚠ Skipped …` comes from `console.warn` ([`src/skills.ts` L77](https://github.com/vercel-labs/skills/blob/v1.7.4/src/skills.ts#L77)).
  - The one above is a real flaw in `mattpocock/skills` today: a `SKILL.md` it can't parse in an `in-progress` folder.
  - It shows the full temporary path, so a page would show it too.
  - Because stdout and stderr are separate pipes, its exact position among the stdout lines isn't guaranteed.
- **The Tip line appears because stdin isn't a terminal** ([`src/add.ts` L1524-L1525](https://github.com/vercel-labs/skills/blob/v1.7.4/src/add.ts#L1524-L1525)). It shows even though `-y` and `-g` are given.
- **The "Security Risk Assessments" box needs the network.** It comes from `https://www.skills.sh/tele/audit`. It's left out when `DISABLE_TELEMETRY` or `DO_NOT_TRACK` is set ([`src/telemetry.ts` L87](https://github.com/vercel-labs/skills/blob/v1.7.4/src/telemetry.ts#L87)), or when the repository is private or the lookup fails.

### Things in the environment that change the output

**Confirmed (bundled code and [`src/add.ts` L1515-L1525](https://github.com/vercel-labs/skills/blob/v1.7.4/src/add.ts#L1515-L1525)); not run, since every run cleared these variables.**

- **Any of these makes it think it's run by a coding agent:** `AI_AGENT`, `CLAUDECODE`, `CLAUDE_CODE`, `CURSOR_TRACE_ID`, `CURSOR_AGENT`, `GEMINI_CLI`, `CODEX_SANDBOX`, `CODEX_CI`, `CODEX_THREAD_ID`, `ANTIGRAVITY_AGENT`, `AUGMENT_AGENT`, `OPENCODE_CLIENT`, `REPL_ID` and `COPILOT_*`. The list is in `dist/_chunks/libs/@vercel/detect-agent.mjs` lines 62-127. A Devin file on disk does the same.
  - Then it drops the logo and the `┌ skills` intro.
  - It prints `● <name>  Agent detected — installing non-interactively` instead.
  - If no `-a` is given, it picks that agent.
  - The Installer always gives `-a claude-code`, so only the look changes. Someone who runs the Installer from inside Claude Code would see this.
- **`CLAUDE_CONFIG_DIR`** moves where Claude Code skills go ([`dist/cli.mjs` line 1400](https://registry.npmjs.org/skills/-/skills-1.7.4.tgz)). **`XDG_STATE_HOME`** moves the `.skill-lock.json` (line 3758).

## 2. Keeping colour and graphics on a pipe

**Confirmed (runs).**

| Environment | The CLI's own colours (picocolors) | clack's colours (rails, spinner) | Logo colour | Rails | Spinner |
|---|---|---|---|---|---|
| plain | yes (win32) | no | yes | ASCII | animated, 120 ms |
| `FORCE_COLOR=1` | yes | **yes** (57 × `ESC[90m`, 7 × `ESC[35m`) | yes | ASCII | animated, 120 ms |
| `--color` flag | yes | no | yes | ASCII | animated, 120 ms |
| `NO_COLOR=1` | **no** | no | **yes** (hard-coded) | ASCII | animated, 120 ms |
| `WT_SESSION` set | yes | no | yes | **Unicode** | animated, 80 ms, `◒◐◓◑` |
| `CI=true` | yes | no | yes | **Unicode** | **one line per message**, no animation |

- **`FORCE_COLOR=1` only adds colour.** The cursor and erase sequences are the same in both runs (9 × `ESC[1G`, 9 × `ESC[J`, 4 × hide/show). The spinner animates on a pipe anyway, so there's nothing for it to bring back.
- **`--color` is a picocolors-only flag.** picocolors reads it from `process.argv`, and the CLI's option parser skips it. Node's `styleText` doesn't read argv. So it changes nothing on Windows.
- **`CI=true`** makes clack's spinner write a frame only when the message changes, followed by a newline (`isCI()` and `u &&` in `spinner()`, `prompts.mjs` line 11). It still writes `ESC[1G ESC[J` before each final line. It also turns on Unicode. The CLI's telemetry reports it as CI (`ci=1`).
- **Unicode rails without `CI`:** set `WT_SESSION` (any value) or `TERM=xterm-256color`. Both are read only by `isUnicodeSupported()`.
  - **Unconfirmed** for `TERM`, which wasn't run. It's in the same check.
  - **Unconfirmed** whether anything else in the CLI reads `TERM`. The only other reader found is picocolors' `TERM !== "dumb"`.

## 3. What a real terminal (pseudo-console) would cost

### Node itself

**Confirmed ([Node child_process docs](https://nodejs.org/docs/latest-v26.x/api/child_process.html#optionsstdio)).** `stdio` takes `'pipe'`, `'overlapped'`, `'ignore'`, `'inherit'`, a stream or an IPC channel. There's no pseudo-terminal option. `'inherit'` gives the child the Installer's own console, as the on-screen runs do now, and then the Installer can't read the output.

### Windows ConPTY

**Confirmed ([CreatePseudoConsole](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole)).**

- It's a `Kernel32.dll` function, available from Windows 10 1809 and Windows Server 2019 ("desktop apps only").
- The page lists no elevation requirement.
- Its output stream is "plain text interleaved with Virtual Terminal Sequences" that "the calling application" must decode.

### node-pty 1.1.0 ([npm](https://www.npmjs.com/package/node-pty), [microsoft/node-pty](https://github.com/microsoft/node-pty), MIT, published 2025-12-22)

**Confirmed (tarball and run).**

- **Prebuilt binaries.** `prebuilds/win32-x64/` and `prebuilds/win32-arm64/` hold:
  - `conpty.node`, `pty.node` and `conpty_console_list.node`;
  - `winpty.dll` and `winpty-agent.exe`, for Windows older than build 18309;
  - `conpty/conpty.dll` and `conpty/OpenConsole.exe`, used only with the experimental `useConptyDll: true`.
- **No Node ABI tie.** All three `.node` files export `napi_register_module_v1` (N-API), so they don't depend on the Node version. They loaded and ran on Node 26.12.1.
- **The install script, and when it needs a compiler.** The script is `node scripts/prebuild.js || node-gyp rebuild`.
  - `prebuild.js` exits 0 if `prebuilds/<platform>-<arch>` exists. It forces a rebuild only if `npm_config_build_from_source=true`.
  - So on win32-x64 and arm64, npm needs no compiler.
  - At run time, `loadNativeModule` looks in `build/Release`, `build/Debug`, then `prebuilds/<platform>-<arch>` (`lib/utils.js`). So the package works with no install script at all.
  - In this research it was installed with `--ignore-scripts`, and it ran the skills CLI in a ConPTY with exit code 0 ([`samples/conpty.chunks.txt`](samples/conpty.chunks.txt)).
  - It ran from a normal user account. Whether the account had admin rights wasn't checked.
- **Size.** The tarball is 15.5 MB and unpacks to 63 MB (286 files). 55 MB of that is `.pdb` debug files for all platforms.
  - The win32-x64 runtime files without `.pdb` are 2.57 MB. Without the winpty files (not needed on Windows 10 1809 or later) they are 2.0 MB.
  - Plus about 55 KB of `lib/*.js`.
  - Its one dependency, `node-addon-api`, is only used at build time.
- **Shipping it in `installer.zip`.** `bootstrap/build.js` zips every package reachable through `dependencies` in `installer/package.json` (`dependencyFolders`, line 36), files and all.
  - Adding `node-pty` as it is would put all 63 MB in the zip, unless the build leaves out `.pdb` files and other platforms.
  - `install.ps1` supports arm64 (line 37), so both Windows folders would be needed.
- **Unconfirmed:**
  - whether York's endpoint security allows an unsigned `.node` DLL loaded from `%LOCALAPPDATA%`;
  - whether a hidden `conhost.exe` (which ConPTY starts) is allowed;
  - whether any window flashes.
  - The `.node` files' signatures weren't checked.

### @lydell/node-pty 1.2.0-beta.18 ([npm](https://www.npmjs.com/package/@lydell/node-pty), [lydell/node-pty](https://github.com/lydell/node-pty), MIT)

**Confirmed (npm metadata and tarball).**

- A repackaging of node-pty's 1.2.0 beta line. The main package has no install scripts. It lists one `optionalDependencies` package per platform, such as `@lydell/node-pty-win32-x64`, which declares `os: win32` and `cpu: x64`.
- `@lydell/node-pty-win32-x64` is 3.0 MB packed and 12.3 MB unpacked (21 files). It holds only ConPTY files: `conpty.node`, `conpty_console_list.node`, `conpty/conpty.dll` and `OpenConsole.exe`, with no winpty. Without its two `.pdb` files it is 1.65 MB.
- Its `latest` tag points at a beta (`1.2.0-beta.18`, 2026-10-24). Upstream node-pty's own `beta` tag is the same number (2026-10-23).
- `bootstrap/build.js` follows only `dependencies`, not `optionalDependencies`. So as written, it wouldn't put the platform package in the zip.
  - Also, npm installs only the package for the build machine's platform.
  - The build would need to name the win32-x64 and win32-arm64 packages itself.
- It wasn't run.

### Other routes

- **@homebridge/node-pty-prebuilt-multiarch 0.15.0** (npm metadata, confirmed) has the same `prebuild.js || node-gyp rebuild` install script and a 6.4 MB unpacked size. It wasn't examined further.
- **ConPTY with no native module:** PowerShell can call `CreatePseudoConsole` through `Add-Type` C# P/Invoke. **Unconfirmed and not tried.** `Add-Type` compiles code at run time, which managed laptops often block (Constrained Language Mode, AppLocker). The bootstrap already logs `LanguageMode` (`install.ps1` line 149).

### What a pseudo-console changes in the output

**Confirmed (run).** Inside ConPTY (80 × 30), stdin is a terminal and Windows re-encodes the output:

- The Tip line is gone.
- clack's colours appear, as with `FORCE_COLOR=1`. The rails are still ASCII without `WT_SESSION`.
- The CLI's `ESC[1G ESC[J` turns into ConPTY's own drawing:
  - absolute cursor moves (`ESC[13;1H`, `ESC[22;1H`);
  - a screen clear (`ESC[2J`) at the start;
  - 137 × `ESC[K`;
  - `ESC[nX` (erase characters) and `ESC[nC` (move right) in place of spaces;
  - `\r\n` line ends (156 × `\r`);
  - a window title (`ESC]0;…node.exe BEL`);
  - `ESC[?9001h` (win32-input-mode) and `ESC[?1004h` (focus reporting).
- ConPTY lays the text out on its own 80-column screen. After the long `⚠ Skipped` warning it jumps to the row where that line would end once wrapped (`ESC[19;1H`). So the page's terminal has to be the same size as the pseudo-console.

So a pseudo-console adds clack's colours (also available from `FORCE_COLOR=1`) and drops the Tip line. In exchange, the output can only be drawn by a full terminal emulator.

## 4. Drawing it in a browser page

**Confirmed (captures and runs of the libraries on them).**

### Which sequences have to be handled

- **Piped:** SGR, `ESC[1G`, `ESC[J`, `ESC[?25l/h`, `ESC[nA` (only when a spinner line passes 80 columns), and bare `\n`.
  - No `\r`.
  - No absolute positioning.
  - No OSC hyperlinks in these runs.
- **ConPTY:** all of the list in question 3 above.

### A small converter: ansi_up or anser

- **ansi_up 6.0.6** ([npm](https://www.npmjs.com/package/ansi_up), MIT, no dependencies) is 22.7 KB, 3.8 KB gzipped.
- **anser 2.3.5** ([npm](https://www.npmjs.com/package/anser), MIT, no dependencies) is 23.2 KB, 5.3 KB gzipped.
- Fed the plain piped capture, both turn SGR into styled spans, including the logo's 256-colour greys. Both silently drop `ESC[1G`, `ESC[J` and `ESC[?25l/h`, leaving no stray `[1G` text.
- But they don't act on them, so all six spinner frames run together on one line: `•  Cloning repository…o  Cloning repository…O  Cloning repository…`.
- **The fix is a short pre-pass before the converter.** It needs about 20 lines:
  - on `ESC[1G` (or a lone `\r`), cut back to the last `\n`;
  - on `ESC[nA`, drop n lines;
  - drop `ESC[J` and `ESC[?25l/h`.
- Run on all nine piped captures, this left no escape codes other than SGR. The plain one came out as shown in question 1.
- On a live stream, the page would apply the same rule to the open last line as each chunk arrives. That redraws the spinner in place.
  - **Unconfirmed:** chunks split mid-sequence. The runner saw `ESC[1G` and `ESC[J` arrive in separate chunks, so a live pre-pass has to hold an incomplete `ESC[` until the next chunk.

### A full emulator: xterm.js

- **xterm.js 6.0.0** ([npm `@xterm/xterm`](https://www.npmjs.com/package/@xterm/xterm), [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js), MIT, no dependencies). `lib/xterm.js` is 489 KB, 121 KB gzipped, plus 7 KB of CSS. It unpacks to 5.9 MB, mostly source maps.
- Its headless build (`@xterm/headless` 6.0.0) drew **both** captures to the right final screen:
  - the ConPTY capture as it was;
  - the piped capture with `convertEol: true`, which is needed because the pipe has bare `\n`.
- It handled every ConPTY sequence; nothing was left on screen.
- **Unconfirmed:** how the browser build looks and performs in the Installer page, and how `?9001h` is treated beyond leaving nothing on screen.

### Summary

| | Piped output | ConPTY output |
|---|---|---|
| ansi_up or anser alone | colours right, spinner frames pile up | breaks (absolute moves, `ESC[nX`, `ESC[nC`) |
| ansi_up or anser + 20-line pre-pass | **correct** | not enough |
| xterm.js | correct (with `convertEol`) | correct |

## 5. What `-y`, `-g -a claude-code` and one run per source change

**Confirmed (source at v1.7.4 and runs).**

- **Prompts `-y` skips** (all in `runAdd`, [`src/add.ts`](https://github.com/vercel-labs/skills/blob/v1.7.4/src/add.ts)):
  - the skill multiselect, only when no `-s` is given;
  - the agent selection (`-a` makes it moot);
  - "Installation scope" (`-g` makes it moot);
  - "Installation method" (symlink or copy; only asked when more than one folder is involved);
  - "Proceed with installation?" ([L2143](https://github.com/vercel-labs/skills/blob/v1.7.4/src/add.ts#L2143));
  - the one-time "Install the find-skills skill?" offer. That one is also skipped whenever stdin isn't a terminal ([L2505](https://github.com/vercel-labs/skills/blob/v1.7.4/src/add.ts#L2505)).
- **What remains is the same summary an interactive run shows,** minus the prompts:
  - the Source line;
  - "Repository cloned", then "Found N skills";
  - "Selected N skills: …", or, when the source has only one skill, "Skill: <name>" plus its description;
  - the "Installation Summary" box;
  - the "Security Risk Assessments" box;
  - "Installation complete";
  - the "Installed N skills" box;
  - "Done!".
- **The Tip line is the only line added by not being interactive.**
- **Copy, not symlink.** With only `claude-code` as the target, the CLI copies instead of linking (`uniqueDirs.size <= 1`, `dist/cli.mjs` line 5614). So the result box says `✓ grilling (copied)`, then `→ ~\.claude\skills\grilling`.
  - The Installation Summary box shows `~\.agents\skills\grilling` with `copy → Claude Code`, a path where nothing was written in these runs.
- **Per source:** each run is one clone, then everything for that source together.
  - In the two-skill run, both skills appear in each box, and there's a single "Installing skills…" spinner for both.
  - No line is printed as each skill is installed.
  - Time goes mostly to the clone: 1 to 2 seconds for `mattpocock/skills` and `cursor/plugins` here. **Unconfirmed** for `anthropics/skills` (larger) and on York's network.
- **What a page could use for progress:**
  - one "source started / source finished" step per CLI run, which the Installer already knows;
  - within a run, the spinner messages "Cloning repository…", "Discovering skills…" and "Installing skills…".
  - Per-skill outcomes come only at the end: from the "Installed N skills" box, or, structured, from `--json`.
- **`--json`** ([`src/add.ts` L1403-L1416](https://github.com/vercel-labs/skills/blob/v1.7.4/src/add.ts#L1403-L1416), [`src/cli.ts` L382](https://github.com/vercel-labs/skills/blob/v1.7.4/src/cli.ts#L382)):
  - It needs `-y`.
  - It skips the logo and makes the spinner a no-op. The intro, Tip, Summary and Security boxes still print, but to **stderr** (it redirects `process.stdout.write` to stderr). They have no cursor codes.
  - At the end, stdout gets one JSON array with one record per selected skill: `{ name, status: "installed" | "failed", source, ref, hash, path, scope, agents, mode, security: { gen, socket, snyk, details } }`. See [`samples/piped-json.chunks.txt`](samples/piped-json.chunks.txt).
  - The "Installed N skills" box and "Done!" aren't printed.
  - It's refused for "well-known" (non-GitHub web) sources.
  - Today the Installer joins stdout and stderr into one string (`runProgram`), so it would need to keep them apart to use this.

## What this means for the decision

- Real output can be shown without a pseudo-terminal. The Installer already gets the logo, colours, rails, boxes and a moving spinner over its pipes. `FORCE_COLOR=1` adds the remaining colours, and `WT_SESSION` or `CI` controls Unicode against ASCII.
- A page needs a small ANSI-to-HTML converter plus a short redraw pre-pass. xterm.js also works, at about 121 KB gzipped.
- A pseudo-terminal (node-pty) would ship 2 to 2.6 MB of native files per architecture, with build changes to keep out 55 MB of debug files. It would bring only clack's colours (already available) and remove the Tip line. Whether York's endpoint security allows it is unconfirmed.
- What appears isn't fully under the Installer's control:
  - third-party warnings, such as the `⚠ Skipped … YAML parse error` with a temporary path;
  - the network-dependent Security box;
  - the "Agent detected" variant, when an agent's variables are set.
- `--json` is there if the page wants per-skill results rather than a terminal picture.

## Sources

The skills CLI 1.7.4:

- [npm tarball](https://registry.npmjs.org/skills/-/skills-1.7.4.tgz). Read: `dist/cli.mjs`, `dist/_chunks/libs/@clack/prompts.mjs`, `dist/_chunks/libs/@clack/core.mjs`, `dist/_chunks/libs/picocolors.mjs`, `dist/_chunks/libs/@vercel/detect-agent.mjs`, `ThirdPartyNoticeText.txt`.
- Source at tag [`v1.7.4`](https://github.com/vercel-labs/skills/tree/v1.7.4): [`src/add.ts`](https://github.com/vercel-labs/skills/blob/v1.7.4/src/add.ts), [`src/cli.ts`](https://github.com/vercel-labs/skills/blob/v1.7.4/src/cli.ts), [`src/skills.ts`](https://github.com/vercel-labs/skills/blob/v1.7.4/src/skills.ts), [`src/telemetry.ts`](https://github.com/vercel-labs/skills/blob/v1.7.4/src/telemetry.ts).
- Upstream libraries: [bombshell-dev/clack](https://github.com/bombshell-dev/clack), [alexeyraspopov/picocolors](https://github.com/alexeyraspopov/picocolors).

Node and Windows:

- Node 26: [`util.styleText`](https://nodejs.org/docs/latest-v26.x/api/util.html#utilstyletextformat-text-options), [`child_process` `options.stdio`](https://nodejs.org/docs/latest-v26.x/api/child_process.html#optionsstdio).
- Microsoft: [CreatePseudoConsole](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole).

Pseudo-terminal packages:

- [node-pty 1.1.0 tarball](https://registry.npmjs.org/node-pty/-/node-pty-1.1.0.tgz) (`scripts/prebuild.js`, `scripts/post-install.js`, `lib/utils.js`, `lib/windowsPtyAgent.js`, `typings/node-pty.d.ts`, `binding.gyp`), [microsoft/node-pty](https://github.com/microsoft/node-pty).
- [@lydell/node-pty](https://registry.npmjs.org/@lydell/node-pty/latest) and [@lydell/node-pty-win32-x64 1.2.0-beta.18](https://registry.npmjs.org/@lydell/node-pty-win32-x64/-/node-pty-win32-x64-1.2.0-beta.18.tgz), [lydell/node-pty](https://github.com/lydell/node-pty).
- [@homebridge/node-pty-prebuilt-multiarch](https://registry.npmjs.org/@homebridge/node-pty-prebuilt-multiarch/latest) (metadata only).

Drawing libraries:

- [@xterm/xterm 6.0.0](https://registry.npmjs.org/@xterm/xterm/-/xterm-6.0.0.tgz), [@xterm/headless 6.0.0](https://registry.npmjs.org/@xterm/headless/-/headless-6.0.0.tgz).
- [ansi_up 6.0.6](https://registry.npmjs.org/ansi_up/-/ansi_up-6.0.6.tgz), [anser 2.3.5](https://registry.npmjs.org/anser/-/anser-2.3.5.tgz).

This repo:

- `manifest.json` (the skills and Node pins).
- `installer/src/skills.js`.
- `installer/src/machine.js`: `runProgram` at about line 618, `withPath` at about 286.
- `bootstrap/build.js`: `dependencyFolders` at line 36.
- `bootstrap/install.ps1`: arch at line 37, `LanguageMode` at line 149.
- `profiles/york.json`.

Runs: [`samples/`](samples/). They hold the timestamped chunks of seven runs and an `od -c` style dump of the spinner bytes.
