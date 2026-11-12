# Report: how the pasted line becomes a running Installer

Paths are relative to the repo root. I changed no files and ran no installs. `node_modules` isn't installed in this worktree, so I couldn't run the tests or check the `@clack/prompts` version.

## FACTS

### 1. Bootstrap

- **Four pasted lines.** `bootstrap/york.ps1`, `install.ps1`, `york-debug.ps1` and `share-log.ps1`.
  - The first three are the same file with a different line 1 (`$AgentJumpstart = @{ Profile = ...; Debug = ... }`). `bootstrap/install.ps1:1` is `default`, `york.ps1` is `york`.
  - `share-log.ps1` copies the newest log to the clipboard (`share-log.ps1:27-54`).
  - The pasted line is `irm https://jumpstart-install.portall.dev/<name>.ps1 | iex` (`install.ps1:34`, `installer/test/page.test.js:44-47`).
- **Constraints on the scripts.**
  - They run through `iex` on Windows PowerShell 5.1, possibly in Constrained Language Mode (`install.ps1:15-19`).
  - Plain ASCII, no exit, no Add-Type/New-Object/.NET method calls, and `-UseBasicParsing` on every web request.
  - `installer/test/pasted-lines.test.js` enforces these (tests at lines 26-41, 82).
  - Any new PowerShell has to stay within them.
- **Getting Node.**
  - The pinned Node is 26.12.1, with a per-arch SHA-256 (`install.ps1:28-32`). The same pin is in `manifest.json` (tool `node`), and a test checks the two match (`pasted-lines.test.js:59`).
  - The zip comes from nodejs.org (`install.ps1:39`) and is unpacked to `%LOCALAPPDATA%\agent-jumpstart\node` (`install.ps1:46`).
  - That folder is never on PATH, and an existing Node is never touched (`install.ps1:8-11`, test at `pasted-lines.test.js:73`).
  - If `node.exe --version` already equals the pin, the download is skipped (`install.ps1:158-161`).
  - A checksum mismatch deletes the zip and stops (`install.ps1:168-171`).
  - The old Node folder is swapped by moving it aside (`install.ps1:174-185`).
- **Getting the program.**
  - `$portall/installer.zip` is downloaded and unpacked to `...\agent-jumpstart\program` (`install.ps1:189-194`). The old `program` folder is deleted first.
  - There's no checksum on `installer.zip`, only on Node.
- **Downloads.** `curl.exe` from System32 is preferred, with its stderr meter parsed into one redrawn line. `Invoke-WebRequest` is the fallback (`install.ps1:64-117`).
- **Launch.** `& $nodeExe <program>\installer\src\main.js --profile <id> [--debug]` (`install.ps1:200-202`). It runs in the same window, with no `--home`, `--answers` or `--downloads`.
- **After the run.** On a non-zero exit it prints `irm .../share-log.ps1 | iex` as the help line (`install.ps1:203-207`).
- **Failures before launch.** They print in red and `return`, with no launch (`install.ps1:195-198`).

### 2. Packaging

- `bootstrap/build.js` writes `dist/portall/` (git-ignored). It holds the four `.ps1` files plus `installer.zip`.
- The zip is built by hand: deflate, fixed 1980 timestamp, no extras (`build.js:56-103`).
- It holds `shipped = ['installer/package.json', 'installer/src', 'profiles', 'manifest.json']` plus the production dependency folders found by walking `dependencies` (`build.js:20,32-50,109`).
  - The layout mirrors the repo, so `profiles/` and `manifest.json` resolve as in a checkout (`build.js:10`).
  - `installer/test` and `page/` are not shipped.
- **For the Installer page:** any new asset, such as HTML, CSS or JS for the page, must go into `shipped` or the zip won't contain it (`build.js:11`). If it lives inside `installer/src`, it ships automatically.
- The only runtime dependency is `@clack/prompts ^1.2.0` (`installer/package.json`). It's an npm workspace, and the root devDependencies are `@types/node` and `typescript`.
- `installer/package.json` says `engines.node >= 22.20.0`, but the bootstrap actually runs it on 26.12.1. `package.json` is `"type": "module"`.
- `tsc` runs with `checkJs`, strict, `include: installer/**/*.js`, `bootstrap/**/*.js`, `page/**/*.js` (`tsconfig.json`).
- `npm run publish:portall` builds and publishes the Portall item `jumpstart-install`.

### 3. How `main.js` starts

- **Flags** (`installer/src/main.js:38-48`, `parseArgs` with `strict: true`; an unknown flag returns exit 2, at lines 134-138).

  | Flag | Meaning |
  |---|---|
  | `--profile <id>` | Default `default`. |
  | `--debug` | Boolean. |
  | `--home <dir>` | Fakes the whole machine inside that folder. |
  | `--answers <file>` | JSON that answers every question; nothing waits for Enter. |
  | `--downloads <dir>` | Takes downloads from this folder instead of the internet. |

- A new flag, such as `--page`, would need adding to that `parseArgs` call.
- **Opening.**
  - Places come from `findPlaces(home)` (`installer/src/places.js:34-56`).
  - The log is opened with `openLog` (`installer/src/log.js:51`), then the machine with `openMachine` (`main.js:140-148`).
  - Then the profile, the answers and `ui.start` (`main.js:167-172`).
- **Stages, in order** (`main.js:166-280`).
  1. Read earlier settings, check Claude's automatic memory, and find T3.
  2. Ask the questions.
  3. Write settings.
  4. Create workspaces.
  5. Install tools.
  6. Set up GitHub.
  7. Install skills.
  8. Switch off memory.
  9. Walk the person through connectors.
  10. Set up extra tools.
  11. Set up Claude, with sign-in.
  12. Install T3.
  13. Add workspaces to T3.
  14. Print the summary and checklist.
  15. Open T3.
  16. Show the ending.
- **No UI abstraction beyond the module itself.** `main.js` calls `ui.*` directly: `ui.start`, `ui.summary`, `ui.step`, `ui.problem`, `ui.finish`. It chooses `const asker = unattended ? answersFrom(answers) : ui.ask` at `main.js:176`. `ui.js` is a module of functions, not an injected interface, and `ending.js` and the other step modules also call it.
- Only the `Asker` interface (`installer/src/questions.js:44-52`) is a real seam. It has four methods:
  - `folder`
  - `choose`
  - `confirm`
  - `pick`
- Anything that is not a question has no seam. That covers `step`, `summary`, `busy` (the spinner, `ui.js:191`), `notice` and `pressEnter`. It also covers the `comeBack` wording (`ui.js:234`) and `showPage`'s `ui.step` line.
- `ui.js` also monkey-patches `process.stdout` and `process.stderr` `write` (`ui.js:69-75`), and `await import('@clack/prompts')` happens at module load (`ui.js:22`). Importing `ui.js` therefore has global side effects, including temporarily setting `WT_SESSION`.

### 4. Log

- The log is `%LOCALAPPDATA%\agent-jumpstart\logs\install-YYYY-MM-DD-HHMMSS.log`, in local time (`log.js:51-53`). Every line is `appendFileSync`'d with an `HH:MM:SS` prefix, so a run that dies early still leaves a log.
- `log.write` goes to every run, and `log.detail` only to `--debug` runs.
- The first lines are Node version, profile, debug, home, and answers/downloads if given (`main.js:142-147`).
- `machine.js` logs every program run. A failed run is logged with its output in any run, and everything is logged in debug.
- `runOnScreen` logs only the command and code, because the output goes to the window (`machine.js:173-182`).
- `main.js:272` prints `Log: <path>`.
- **WT_SESSION is not logged.** `ui.js:20` reads it into `windowsTerminalSession`, and line 23 restores or deletes it. This agrees with #57.

### 5. How the run ends

- `main()` returns an exit code, and `process.exitCode = await main()` is set at `main.js:320`. There is no `process.exit` in `main.js`.
- **Success.** Exit 0, after `showEnding` and the log line `Installer finished` (`main.js:280-282`).
  - T3 is opened at the end unless this run's install has just started it (`main.js:274-279`).
- **`End`.** A chosen early end, such as skipped sign-in. It prints `ui.finish(message)` and returns 0 (`main.js:284-289`; `End` and `Stop` are in `installer/src/stop.js`).
- **`Stop`.** A plain-language problem. It prints it, lists "Done before it stopped" if anything was done, and says that running the same line again carries on. It returns 1 (`main.js:294-305`).
  - `done.length === 0` adds "Nothing has been changed."
- **Any other error.** It is logged with its stack and rethrown (`main.js:290-293`). Node prints it and exits 1, and `install.ps1` then shows the share-log line.
- **`finally`.** In debug runs it logs the User PATH after (`main.js:306-308`).
- `Installer finished` is not logged on the `Stop` path or on an unexpected throw.

### 6. Re-runs

- **Settings file.** The file is `%LOCALAPPDATA%\agent-jumpstart\settings.json` (`places.js:45`). It is written once after the answers (`main.js:199`), again after skills and memory (`main.js:229`), and again with the email after Claude (`main.js:246`).
  - Keys the run doesn't write are kept (`main.js:196-198`).
- **How a re-run is decided.** `readEarlierSettings` (`main.js:67-89`) treats the file as an earlier run only if it parses as a JSON object and its `profile` matches. Otherwise every question is asked.
- **Reuse.** `knownFrom(earlier, asker, log, reused)` (`questions.js:312`) wraps the asker so saved answers aren't asked again. `main.js:191-194` then shows "Using your answers from last time".
- **`memory.js` is not re-run logic.** It handles Claude's automatic memory: `autoMemoryInUse` (`memory.js:109`) decides whether to ask, and `switchOffAutoMemory` (`memory.js:143`) writes `autoMemoryEnabled:false` to Claude's `settings.json` and sets the user variable `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.
  - The re-run state lives in `main.js` and `questions.js`.
- A stopped run is resumed by running the same line again, using the saved settings and the idempotent steps. It is not a checkpoint system.

### 7. Opening a browser: `open-page.js` and the machine

- `showPage(label, url, {machine, log})` (`installer/src/open-page.js:12-21`) prints `label: url` with `ui.step`, calls `machine.openPage(url)`, and logs the outcome. A failure to open doesn't stop the run.
- Callers:
  - `connectors.js:32`
  - `extra-tools.js:52`
  - `github.js:93`
  - `google-drive.js:193` (the `softwarecenter:` URI)
- **Real `openPage`.** It spawns `System32\rundll32.exe url.dll,FileProtocolHandler <url>`, detached with `stdio: 'ignore'`, and unrefs it (`machine.js:~500-510`). This agrees with #57.
- **Fake `openPage`** (under `--home`). It appends the URL to `<home>/fake-machine/pages.json` and never opens a browser (`machine.js:~346-348`). `fakeMachine(home).pagesOpened()` in the harness reads it.
- **Local HTTP server.**
  - **Nothing like this exists today.** There is no use of `node:http`, `node:net` or `createServer` in `installer/src`. The only network use is global `fetch` in `tools.js:375` (downloads, piped to a file) and `t3-release.js:73`.
  - Node 26 provides `node:http`, `fetch`, `EventSource` and `WebSocket`, all built in, so no new dependency is needed.
  - Because the program runs on the pinned bootstrap Node (26.12.1), the Node APIs are known. The `engines` field says 22.20.
  - Anything that serves the page must be run under the same `machine` seam if a test is not to touch the real machine. Right now `--home` fakes only machine effects, and nothing fakes a listening socket.
- **Programs run in the window** (`machine.runOnScreen` and `runOnScreenAndKeep`, defined in `machine.js` around `:82-91`).
  - Real `startOnScreen` uses `spawn(..., stdio: 'inherit')` (`machine.js:~519`), and `startOnScreenAndKeep` uses `['inherit','pipe','pipe']` (`machine.js:~533`).
  - Callers:
    - `claude.js:64` (Anthropic's `install.ps1`)
    - `claude.js:86` (`claude auth login`, keeps output)
    - `github.js:63` (`gh auth login --web --clipboard`)
    - `extra-tools.js:90`
  - These are what a page front end would have to replace or mirror.
- **Spinner.** `ui.busy` (`ui.js:191`) wraps long tasks, and `ui.js:192` checks `process.stdout.isTTY`.

### 8. How tests drive the Installer

- **The seam is `installer/test/harness.js`.**
  - `run(args)` is `execFile(process.execPath, [installer/src/main.js, ...args], { env: {...process.env, NO_COLOR:'1'}, timeout: 30_000 })`. It resolves `{code, stdout, stderr}` (`harness.js:~93-100`).
  - `runWith(where, profile, extra)` adds `--profile`, `--home`, `--answers` and `--downloads`.
  - `makeHome(t, answers, {googleDrive})` makes a temp dir with `home/`, `downloads/` and `answers.json`, and pre-seeds a signed-in Google Drive. It removes the dir on test end (`harness.js:36-48`).
- **The fake machine** lives in `machine.js` (`fakeMachine`, `:91-~175`), writing under `<home>/fake-machine/`.
  - `environment.json` is the user environment and PATH.
  - `runs.json` records every run, with `onScreen` and `leftRunning` flags.
  - `pages.json` records the opened URLs.
  - `replies.json` is what tests write to script program results. It supports `creates`, `writes`, `reads`, lists of successive replies, and longest-key matching.
  - `machine-path.json` is the machine-wide PATH.
  - `waiting.json` gives a patience budget and "appears" folders. Every wait returns instantly.
  - The harness exposes `fakeMachine(home)` with `pagesOpened()`, `setMachinePath` and similar helpers.
- **Fixture helpers in `harness.js`.** `seedSettings`, `readSettings`, `readOnlyLog`, `skillsCli(home)`, `gitOnMachinePath`, `readManifest` and `fakeGoogleDrive`.
- **Assertions** run on stdout, the exit code, the log text, `settings.json` and the `fake-machine/*.json` files. `test/installer.test.js` and `test/bootstrap.test.js` are the smallest examples.
- **No tests drive stdin or a TTY.** `execFile` has no stdin and no TTY, and all questions come from `--answers`. `grep` finds no `stdin` or `spawn(` in the tests, and no test exercises `ui.ask`, the clack prompts or the real `ui.busy` path.
- **Other tests.**
  - `page.test.js` and `pages.test.js` test the setup page by rendering it with `page/build.js` and reading the output.
  - `pasted-lines.test.js` tests the `.ps1` files statically, and by parse if PowerShell is available.
  - `bootstrap.test.js` tests the flag contract.

### 9. Does #57's description match the code? Checks against the code

Matches:
- `installer/src/claude.js:62-64` — the comment assumes Anthropic's script shows its own progress, it runs with `runOnScreen`, and the screen text says "Its progress shows below".
- `installer/src/google-drive.js:148-152` — the 15-minute `softwareCenterPatience`, and the 5 s poll.
- `installer/src/questions.js:44-52` is the `Asker` interface.
- `ui.js:20` reads `WT_SESSION` and discards it.
- `ui.js:234` has the "blue PowerShell window" wording, and `google-drive.js:108` has it too.
- `machine.js:85-91` and `claude.js:146-148` do say the window shows the code as it's typed. `machine.js:89-90` says the program "reads a pasted code as a plain line and checks only that what it reads from is a terminal". `claude.js:146-148` says "the window shows it as it's typed".

Contradicts, or imprecise:
- **#57 says "the Installer can read the offered version from Software Center (`CCM_Application` in `root\ccm\ClientSDK`)".** There is already a PowerShell query in `google-drive.js:~262` (`machine.run(...powershell.exe -NoProfile -NonInteractive -Command <script>)`). I didn't read its script, so I can't confirm it reads the version.
- **`ui.js`'s header (lines 3-4) says "York's PowerShell window is the old Windows console (conhost)".** #57 already says to correct it.
- **The `Asker` interface is not the only seam.** #57 says "All drawing goes through `installer/src/ui.js`, and questions through the `Asker` interface", so that "a second front end can stand beside the terminal one". Only questions go through an interface. The rest of the drawing is direct calls to `ui.*` module functions from about ten modules (see 3), and the `ui.js` import has global side effects. A second front end means turning `ui` into an injected object or a swappable module.
- **There are no `--page` or server flags yet.**

## OPINIONS

- **Test seam.** A page front end can very likely be tested the same way.
  - Run the real `main.js` with `--home`, `--answers` and `--downloads`. The page server should be started inside the machine seam, so the fake machine records "page served on port N" and `pages.json` records the opened URL.
  - For an end-to-end page test, a harness variant would have to start `main.js` with a `--page` flag and keep it alive, find the port from stdout or a file under `fake-machine`, and drive it with `fetch` or `EventSource` from the test process. The current `run()` waits for exit with a 30 s timeout, so that needs a second helper that starts the process and then waits.
  - Since `fetch` and `http` are built into Node 26, no browser or extra dependency is needed for the test. A real browser could still be used for a smoke test.
- **Answers file and the page.** The `--answers` path (`answersFrom`) is the model for an `Asker` backed by the page. A page asker could implement the same four methods by long-polling or Server-Sent Events.
- **The hard part is `runOnScreen`, not the server.**
  - It has four users, and it hands the window's stdin and stdout to the program.
  - Redirecting stdout is already done for `claude auth login` (`pipe`). Redirecting stdin is not done anywhere, and `claude` insists on a terminal for its input.
- **Fallback.** The terminal front end should stay the default when the page can't be reached, and a failed `openPage` already doesn't stop the run, which suits this.
- **Packaging.** Put the page's static files under `installer/src/` (or add a new folder to `shipped` in `build.js:20`), so the zip carries them. Keep the zip's no-checksum property in mind: the page runs code from `installer.zip` served over Portall.
- **Where it can break.**
  - The 127.0.0.1 server on a York laptop is untested, which #57 already flags.
  - Windows Firewall may prompt for a listening Node (a rule is usually created only for non-loopback listeners, which I haven't verified).
  - Port choice should be an OS-assigned port (`listen(0, '127.0.0.1')`).
  - The page should be told to tolerate the Installer finishing, and the end-of-run `process.exitCode` flow relies on nothing keeping the event loop alive. An open server would stop Node from exiting by itself, so it must be closed.
- **Before building.** Reading `claude.js:70-150` (the sign-in flow) and the `google-drive.js` Software Center script is worth doing, because the page's sign-in box and the Drive change both touch them.