# Claude Code install and sign-in: facts from the code

Paths below are under `installer/` unless noted. Read-only; nothing was fetched from the internet. I did not run the tests, so the test descriptions are from reading them.

## FACTS

### 1. Install (`src/claude.js` `setUpClaude`, line 43)
- **Order of steps.**
  - It loads the manifest entry `claude` (`claude.js:44`). The entry is `{folder: ".local/bin", check: "claude.exe"}` (`manifest.json:160-167`). There is no URL, version or checksum, so Claude Code is unpinned.
  - It adds `~/.local/bin` to the user PATH *before* anything else (`claude.js:50`).
  - It runs `look()` (`claude.js:53`), a spinner "Checking Claude Code" (`ui.busy`) around `lookAt` (`claude.js:176`). `lookAt` checks that the file exists, then runs `claude.exe --version`, then `claude.exe auth status`, both captured through `machine.run`. It parses the JSON for `loggedIn` and `email`. Signed in means exit code 0 and `loggedIn !== false` (`claude.js:188`).
  - If `claude.exe` is not present, it calls `ui.step("Installing Claude Code with Anthropic's own installer. Its progress shows below; it takes a minute or two.")` (`claude.js:63`). It then calls `machine.runOnScreen(powershell.exe, args)` (`claude.js:64`) and runs `look()` again.
- **Command (`claude.js:20-23`).**
  - File: `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` (`system32()`).
  - Args: `-NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"`.
- **Environment.**
  - `runOnScreen` gets `environment()`, which is `process.env` with `Path` rebuilt from the machine PATH, then the user PATH, then the process PATH (`machine.js:195-203`, `withPath` at ~`machine.js:262`).
  - There is no per-call env parameter. `Machine.runOnScreen(file, args)` and `runOnScreenAndKeep(file, args)` (`machine.js:82,85`) take no env, so nothing can set `BROWSER` for one process today.
- **Real implementation.**
  - `startOnScreen` (`machine.js:514`) is `spawn(..., {stdio: 'inherit'})` and resolves with the exit code, or -1 on error.
  - `startable()` wraps `.cmd` and `.bat` files in `cmd.exe /d /s /c`. It is not used for `powershell.exe` or `claude.exe`.
- **Logging.**
  - `runOnScreen` logs only at `log.detail`, which is debug only: "Running in the person's window: …", "Ran: … (code N)", and "(its output went to the person's window, not the log)" (`machine.js:176-182`).
  - Then `say(...)` in the always-on log (`claude.js:66`): either `installed by its installer (code N)` or `its installer finished with code N, and <path> isn't there`.
  - Nothing is logged about the download itself.
- **Failure handling.**
  - There is no retry and no Try again / Skip for the install.
  - If `claude.exe` is still absent, the row reads "Not installed: Claude Code's installer didn't finish" (`claude.js:202`) and the run carries on.
  - `state.present` is false, so the sign-in block is skipped (`claude.js:71`).
  - If it is present but `--version` fails, the row is "Not installed: Windows wouldn't run it" (`claude.js:203`).
  - The exit code is only logged. A code other than 0 does not matter if the file appeared.

### 2. Sign-in (`claude.js:71-111`)
- **When.** It runs when `present && runs && !signedIn`, so a re-run signs in too.
- **Notice (`claude.js:72-82`).** A `ui.notice` titled "Sign in to Claude Code" with four bullets:
  - "A browser window opens at Claude's sign-in page. Sign in there."
  - "Then come back here. This window carries on by itself."
  - "If no window opens, copy the link below into your browser."
  - "Only if the page shows a code: copy it, paste it here and press Enter."
  - The notice has no "nothing appears when you paste" line and no mention of right-click paste.
  - The test pins the four bullets word for word (`test/claude-sign-in.test.js:56-72`).
- **Command.** `machine.runOnScreenAndKeep(<home>\.local\bin\claude.exe, ['auth','login'])` (`claude.js:86`).
- **How it runs (`machine.js:523-543`).**
  - `spawn(..., {env, stdio: ['inherit','pipe','pipe']})`. Input is inherited from the window. stdout and stderr are piped, decoded as utf8, appended to `output`, and echoed to `process.stdout` and `process.stderr`.
  - So Claude sees a TTY on stdin but not on stdout. The `machine.js:88-90` doc comment says it "checks only that what it reads from is a terminal".
  - It resolves `{code, output}`, or `{code: -1, output: error.message}` on a spawn error.
  - There is no timeout.
- **Logging.**
  - Every line goes through `plainLines` (strips OSC and CSI escapes and blank lines) and `withoutWhatWasTyped` (`claude.js:153`).
  - Each kept line is logged as `Claude Code: sign-in said: <line>` (`claude.js:87`).
  - On any line containing `Paste code here…>`, everything after the prompt is cut. The exception is a trailing `Login successful.` or `Login failed:…`, which is kept.
  - Then `sign-in finished with code N` (`claude.js:88`).
  - Test: `claude-sign-in.test.js:136-150` checks the pasted code never reaches the log, in both ordinary and debug runs.
- **Failure loop (`claude.js:85-110`).**
  - After each try it runs `look()`. If signed in, it breaks.
  - Otherwise `reason` is the first line starting `Login failed:`, or "Claude Code's sign-in ended with code N" (`claude.js:91,140`). It shows `ui.problem(reason)`.
  - Then `ask.choose({key: 'claudeSignIn', options: [again 'Try again' (hint 'a new link and code'), skip 'Skip for now' (hint 'the rest of the install carries on')], initial: attended ? 'again' : 'skip', inTurn: true})` (`claude.js:93-103`). The answer is logged as `Answer: claudeSignIn: "…"`.
  - Try again re-runs `claude auth login`. There is no attempt limit. Skip sets `skipped = reason` and breaks.
- **Skip.**
  - The row becomes "<version>, not signed in".
  - `endAfterSkippedSignIn` (`claude.js:127`) pushes Claude's reason and sets a closing line telling the person to close T3 Code and paste the line again. It sets `openT3 = false`.

### 3. Download and progress code that could be reused
- **`tools.js:357` `obtain({url}, {downloads, saveIn, say})`.**
  - It uses Node `fetch(url)` with no headers, then `pipeline(Readable.fromWeb(body), createWriteStream(file))` (`tools.js:375-377`).
  - It has no progress callback and does not read `content-length`.
  - It has a `--downloads` folder override for tests. On failure it deletes the file and throws `NotInstalled`.
  - It is exported and used by `t3.js:110` and `tools.js:160,228`.
  - Checksums: `checkSum` (SHA-256, `tools.js:388`, not exported) and `checkSha512` (`t3-release.js:84`, exported).
- **`t3-release.js:59` `fetchText`** is for small files. It reads from the downloads folder, or uses `fetch` with a User-Agent header.
- **Progress in the Node installer.**
  - No download progress exists anywhere. A download is only wrapped in `ui.busy(message, task)` (`ui.js:~190-218`): a spinner with elapsed time, one line redrawn each second.
  - Where stdout is not a TTY it falls back to `ui.step(message)`.
  - Example: T3 Code download and install, `t3.js:135`, "Installing T3 Code. This takes about a minute…". Tools: `tools.js:117`.
  - Progress goes through `ui.js` (a clack-based wrapper), not direct writes. There is no percent or bytes bar and no event type. `busy` takes only a string and a promise.
- **The only "N% of size" code is in PowerShell, `bootstrap/install.ps1`** (the same code is in `york.ps1` and `york-debug.ps1`). `Save-Download` (`install.ps1:~58-120`) runs Windows' `curl.exe --fail --location --output`, parses its stderr meter with a regex, and redraws `"Downloading X (size) N%"` with `` `r ``. If curl fails it falls back to `Invoke-WebRequest`.
  - It sets `$ProgressPreference='SilentlyContinue'` (`install.ps1:26`) with the comment that 5.1 is much slower with a progress bar.
  - Nothing in Node reuses this.
- **Proxy.**
  - `fetch` is used with no dispatcher, proxy or agent options anywhere (`grep fetch(` found only `tools.js:375` and `t3-release.js:73`).
  - So #57's "check that Node's fetch ignores the Windows proxy" is plausible. The bootstrap comment says curl.exe "doesn't use the proxy Windows is set to" either.

### 4. Wording claims that the window shows typed code (what #57 says is wrong)
- `claude.js:146-148`: "(the window shows it as it's typed, without it passing through the installer)".
- `machine.js:527-530`, a comment inside `startOnScreenAndKeep` (my line numbers are approximate): "…(and the window shows it as they type, not the program)".
- `machine.js:85-91`, the doc for `runOnScreenAndKeep`: "What the person types still goes straight from the window to the program…" It does not literally say the code is shown, but it supports that reading.
- `README.md` (the Claude sign-in paragraph, ~line 58): "so its `Paste code here if prompted >` prompt gets what the person types, and the window shows it as they type".
- Comments or README that say the install script shows progress:
  - `claude.js:1-4`: "run in the person's window so they see its progress".
  - `claude.js:62`: "Its own installer shows its progress in this window, so there's no spinner over it."
  - `claude.js:63`: the screen text "Its progress shows below".
  - `test/claude.test.js:1-3` (header comment) and `:41` (assert message "in the person's window, so they see its progress").
  - `README.md:20` and `:56` say the script runs "in the person's window" but do not claim progress.

### 5. "Blue PowerShell window" wording
- `ui.js:234` `comeBack`, `google-drive.js:108`, and README (twice). Tests: `test/apps-script.test.js:105` and `test/pages.test.js:43`.
- `ui.js:19-23`: `WT_SESSION` is read into `windowsTerminalSession`, defaulted to `'agent-jumpstart'` so clack picks Unicode, then restored after the clack import (`ui.js:24`). It is not logged.

## Things in #57 that the code contradicts or refines
- **#57's line references are right.** `claude.js:64`, `claude.js:62`, `machine.js:85-91`, `claude.js:146-148` and `ui.js:234` all match.
- **Refinement on `machine.js:85-91`.** The echo claim is in the comment at `machine.js:~527-530`, not in the doc comment at lines 85-91.
- **Refinement on the notice.** #57 says the notice "adds" a paste line. The current notice already says "Only if the page shows a code: …" and "carries on by itself". There is nothing about no-echo.
- **`BROWSER` experiment: the interface does not support it.** Neither on-screen runner takes an env, so `BROWSER=explorer.exe` would need a new parameter. The real `startOnScreenAndKeep` already builds an env, so it would be a small change. The fake machine's run records only `{file, args, path}`, so tests could not assert the env without extending it.
- **No Claude Code self-download exists.** The manifest entry has no URL, so #57's plan needs manifest `claude` fields, a new fetch, and a way to run `claude.exe install`. The existing `obtain` could serve as the base, but it needs a progress hook and the `downloads` override must still apply.
- **The sign-in already has a Try again / Skip loop.** Only the install lacks one.
- **Test harness gap.** `runOnScreenAndKeep` on the fake prints the reply's `output` straight to stdout (`machine.js:351-356`).

## OPINIONS
- Add an optional `onProgress(received, total)` to `obtain`. Draw it through a new `ui.js` function (`ui.busy` only takes a string), which would also suit a browser front end. This is better than writing to stdout directly.
- Capturing `claude auth login` output while stdin is inherited is already the main risk for a browser page. A page cannot inherit the window's stdin, so the sign-in code box means piping stdin. That needs the "redirected I/O" check #57 lists.
- The README, comments and the two tests that quote "see its progress" will all need updating together with the code.