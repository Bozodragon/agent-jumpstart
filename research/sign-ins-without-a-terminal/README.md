# The sign-ins without a terminal

Research for the Installer page: how each sign-in the Installer runs behaves when it has no terminal, and how each one can get the browser open by itself.

Each finding is marked:

- **Confirmed**: read in the vendor's documentation or in the source code of the version named, with a link.
- **Unconfirmed**: inferred, reported by a third party, or not tested. Nothing here was run: no sign-in, sign-out or installer was started on any machine.

Versions read: Claude Code **2.1.322** (the newest on npm on 2026-11-12; the Installer doesn't pin it), GitHub CLI **2.103.1** (pinned in `manifest.json`), clasp **3.4.1** (pinned) and T3 Code **`main` at `5911884`**.

## Answer

- **None of the four sign-ins needs a terminal.** Each one can run with all three of its streams piped, as long as the Installer reads what it prints and, for Claude Code, can write to its input.
- **Claude Code (`claude auth login`).**
  - It reads a pasted code from standard input whether or not that's a terminal. So the page's code box can write `code#state` and a newline into a pipe.
  - It does **two things at once**. It prints a *paste-a-code* address, then opens a *come-back-by-itself* address in the browser. Whichever answer arrives first wins.
  - It **does honour `BROWSER` on Windows**: it runs that program with the address as its only argument, with no shell. Without `BROWSER` it runs `rundll32 url,OpenURL <address>`, the call that #60126 reports failing on Windows 11.
  - `BROWSER=explorer.exe` should open the come-back-by-itself address in the default browser. Claude Code ignores the opener's exit code here, so explorer's usual non-zero code does no harm. This hasn't been tested on a York laptop.
  - The address it prints is only the paste-a-code one. The Installer can open it itself, but then the person always has to paste a code.
- **T3 Code** doesn't sign in to Claude itself. Its welcome page opens a real terminal (node-pty running PowerShell), types `claude auth login`, and the person presses Enter. Claude Code then opens the browser with its own opener. A link clicked in that terminal goes to Electron's `shell.openExternal`, which uses Windows' `ShellExecuteEx`.
- **GitHub (`gh auth login --web`).**
  - Without a terminal on both input and output, gh is "non-interactive". It then asks nothing: no "Authenticate Git?" and no "Press Enter". It prints the one-time code and the address to standard error, and **doesn't open the browser**.
  - So the Installer reads the code, shows it on the page, and opens `https://github.com/login/device` itself. The `gh auth setup-git` it runs afterwards already covers Git.
  - In a terminal, no flag skips the two prompts. `GH_PROMPT_DISABLED` skips them only by making gh non-interactive.
- **clasp (`clasp login`)** needs no terminal at all. It starts its own local server, opens the browser through PowerShell (`Start "<address>"`) and prints the address. That address still comes back by itself, so the Installer could open it as a fallback. It reads nothing from its input.

**What this means for the page front end:** the four on-screen runs can become piped runs relayed to the page. The Claude code box writes into Claude's input. GitHub's code is read from gh's output and shown on the page. Nothing needs the person's console.

## Claude Code: `claude auth login`

The code below is from the JavaScript bundled in the shipped `claude.exe` (Windows x64, 2.1.322), read as text from the npm package [`@anthropic-ai/claude-code-win32-x64@2.1.322`](https://registry.npmjs.org/@anthropic-ai/claude-code-win32-x64/-/claude-code-win32-x64-2.1.322.tgz). The code is minified, so the function names quoted (`w`, `zi`, `ri`) are the minifier's, not Anthropic's. Claude Code isn't open source, so this is the most primary source there is. The Installer doesn't pin a version, so any of this can change in a later release.

### What it prints and reads

**Confirmed (shipped code).** The handler for `claude auth login`:

- It creates a line reader on standard input with no terminal check: `b=ne({input:process.stdin})`, where `ne` is `readline.createInterface`. Each line is trimmed and split on `#`. Anything without both parts gets `Invalid code. Please make sure the full code was copied.` on stderr. Otherwise it hands `{authorizationCode, state}` to the OAuth flow.
- Before the browser opens, it writes three lines to **stdout**:
  ```
  Opening browser to sign in…
  If the browser didn't open, visit: <manual address>
  Paste code here if prompted >
  ```
- On success it prints `Login successful.` (stdout) and exits 0. On failure it prints `Login failed: <reason>` (stderr) and exits 1.
- The address goes through a hyperlink helper. That helper prints the bare address when `process.stdout.isTTY` isn't true, unless hyperlink support is detected some other way. The Installer already strips OSC escapes in `plainLines`.

**Confirmed (docs).** Anthropic's troubleshooting page says to "use `claude auth login` instead, which reads the pasted code from standard input", and that "with `claude auth login`, copy the URL that it prints" ([troubleshoot-install: OAuth login fails in WSL2, SSH, or containers](https://code.claude.com/docs/en/troubleshoot-install#oauth-login-fails-in-wsl2-ssh-or-containers)). The changelog for 2.1.126 says: "`claude auth login` now accepts the OAuth code pasted into the terminal when the browser callback can't reach localhost" ([CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)).

### How it chooses between the automatic sign-in and the pasted code

**Confirmed (shipped code).** In `startOAuthFlow`:

1. It starts a local HTTP listener for the callback.
2. It builds **two** addresses from the same PKCE challenge and state: `C` (`isManual:!0`), which ends on a page that shows a code, and `R` (`isManual:!1`), which redirects back to `localhost:<port>`.
3. It runs `await e(C), await zi(R)`. The handler `e` prints `C` (the "If the browser didn't open, visit:" line above), then `zi` opens `R` in the browser.
4. It waits for whichever comes first: the browser's redirect reaching the listener (automatic), or a `code#state` line on stdin (pasted). Either one resolves the same promise, and the listener is closed.

So **there's no choice to make in advance**. Both routes are live together. The printed address is always the *pasted-code* one; the *automatic* address is passed only to the browser opener and is never printed.

If the listener can't start:

- With stdin a terminal, it switches to paste-only. It prints `The browser can't return the sign-in to Claude Code automatically. After you sign in, paste the code shown.`, then `Sign in at: <address>` and `Paste code here > `.
- **With stdin redirected, there's no such fallback**. It fails with "Couldn't start the local listener that receives the browser sign-in. Try again." The paste-only switch is registered only when `process.stdin.isTTY` is true: `...process.stdin.isTTY&&{onCallbackListenerUnavailable:()=>{T=!0}}`.

### When its input is redirected

**Confirmed (shipped code).**

- **A pipe the Installer keeps open:** works. Writing `code#state\n` completes a pasted sign-in. Writing nothing lets the automatic sign-in complete. The process then exits by itself with `process.exit(0)`.
- **Input closed or empty** (for example `stdio: 'ignore'`): the reader's `close` sets a flag, but it only fails the sign-in in the paste-only case (`if(u=!0,T)f(new z)`). The automatic sign-in still completes; pasting is impossible.
- Nothing in the `auth login` path refuses to run because stdin or stdout isn't a terminal. The only `isTTY` gates are:
  - the gateway and `--gateway-json` paths, which don't apply;
  - the paste-only fallback above;
  - a post-login step that returns early when stdout isn't a terminal.
- Output redirection is already proven on York laptops (the code survey, `terminal-coupling.md` section 6).

### Opening the browser, `BROWSER`, and `rundll32 url,OpenURL`

**Confirmed (shipped code).** The opener in the Windows build:

```js
async function w(e){try{let r=kf()?.browser,o=r!==void 0?r??void 0:i.BROWSER,n="win32";
  if(!o&&d())return{ok:!1,reason:"no_display"};
  if(o)return f(await ct(o,[e]));
  return f(await ct("rundll32",["url,OpenURL",e],{}))}catch(r){...}}
```

- **`BROWSER` is honoured on Windows.** When it's set, Claude Code runs it with the address as its single argument. `kf()?.browser` is a browser chosen by an attached surface, such as an editor extension. It overrides `BROWSER` when one is attached, and none is attached for `claude auth login` run by the Installer.
- **Without `BROWSER`, it runs `rundll32 url,OpenURL <address>`.** By contrast, Claude Code's own Claude Desktop deep-link opener, in the same binary, uses `rundll32 url.dll,FileProtocolHandler`. So does the Installer's `openPage` (`machine.js:503`).
- `ct` is Claude Code's `execFileNoThrow`. It resolves the command on PATH (or takes it as-is if it contains a slash or backslash) and starts it **without a shell**. So `BROWSER` must be one program, not a command line: a value like `cmd.exe /c start ""` would be looked up as a single file name.
- `ct` waits for the opener to exit. In the sign-in, `zi`'s result is thrown away (`await zi(R)`), so a failed or non-zero opener only means no browser appears. The printed address and the paste route are unaffected.

**What `BROWSER=explorer.exe` would do.**

- **Confirmed (code):** Claude Code would run `explorer.exe "<automatic address>"` and ignore its exit code.
- **Confirmed (code):** Claude Code's own code expects a non-zero exit code from Explorer. Its "reveal a file" helper treats any exit code from `explorer` as success (`return u!==void 0`).
- **Unconfirmed:** Explorer handing an `https:` address to the default browser is widely used, but Microsoft doesn't document it as a command-line contract. Explorer also treats commas in its command line as switch separators, so an address containing a comma might be split. Claude's addresses aren't known to contain one. Try it on a York laptop before relying on it.
- If it works, the person gets the **automatic** sign-in (the browser comes back to Claude Code by itself) without the `rundll32 url,OpenURL` call.
- `BROWSER` must be passed only to this process. Today `runOnScreenAndKeep` has no per-call environment (code survey, `claude-install.md`), so that's a small change to `machine.js`.

**Background, Unconfirmed (third-party reports):**

- [anthropics/claude-code#60126](https://github.com/anthropics/claude-code/issues/60126) (2.1.143, Windows 11, closed for inactivity): no browser opens in PowerShell or cmd, but one does in VS Code's terminal.
  - The reporter says `Start-Process` works from the same window.
  - Setting `BROWSER` to Edge's path made "no change" **in 2.1.143**. That conflicts with the 2.1.322 code above, so either the code has changed since or the report is wrong. That's one more reason to test the exact version the Installer installs.
- [#59194](https://github.com/anthropics/claude-code/issues/59194) (2.1.141) reports the same regression under Git Bash. It reports a `BROWSER` workaround with arguments that the 2.1.322 code wouldn't split.
- Neither issue names the root cause. The ticket's "`rundll32 url,OpenURL` failing" matches what the current code runs, but no Anthropic source confirms why it fails.

### Whether it can print the sign-in address for the Installer to open itself

- **Confirmed (code and docs):** it already prints the *pasted-code* address on stdout, on the line starting `If the browser didn't open, visit: `. The Installer can parse that line and open the address with its own `openPage`. The browser then shows a code, which the person pastes into the page, and the page writes it to Claude's stdin.
- **Confirmed (code):** the *automatic* address is never printed. The only ways to get it are:
  - let Claude Code's opener open it (default `rundll32`, or `BROWSER`);
  - set `BROWSER` to a program the Installer controls that receives it as its argument.
- **Unconfirmed:** a `.cmd` or `.bat` file as `BROWSER` would need a shell, and `ct` starts programs without one. Node itself refuses to spawn `.cmd` files without a shell (CVE-2024-27980), and Bun's behaviour wasn't checked. So a capture helper would have to be a real `.exe`.
- **Confirmed (docs), not suitable:** `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` makes `claude auth login` skip the browser ([env-vars](https://code.claude.com/docs/en/env-vars)). But it needs a refresh token obtained elsewhere first, so it doesn't help a first sign-in. `claude setup-token` uses the same browser flow ([authentication](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)).

### A suggested shape (opinion)

1. Run `claude auth login` with all three streams piped, keeping stdin open, and with `BROWSER` set to `%SystemRoot%\explorer.exe` for that one process.
2. Read stdout. Show the "If the browser didn't open" address on the page as an "Open the sign-in page" button, with a code box under it.
3. If the person pastes a code, write it and `\n` to Claude's stdin. Otherwise wait for `Login successful.` or the exit.
4. Keep the existing Try again / Skip loop. Check with `claude auth status` as today.

If `explorer.exe` turns out unreliable on York, drop `BROWSER` and open the printed address with `openPage` instead. That route always ends in a pasted code, but it never depends on `rundll32 url,OpenURL`.

## T3 Code's own Claude sign-in

**Confirmed (source, [pingdotgg/t3code @ 5911884](https://github.com/pingdotgg/t3code/tree/591188471a6d8df7dad63083670afb6c2fb4d100)).**

- **The command.** The welcome page builds the command `claude auth login`, using the configured binary path if there is one ([`providerReadiness.logic.ts` L67-L78](https://github.com/pingdotgg/t3code/blob/591188471a6d8df7dad63083670afb6c2fb4d100/apps/web/src/onboarding/providerReadiness.logic.ts#L67-L78)).
- **Typing it into a real terminal.** "Set up" or "Sign in" opens a terminal session for the provider ([`WelcomePage.tsx` L467-L491](https://github.com/pingdotgg/t3code/blob/591188471a6d8df7dad63083670afb6c2fb4d100/apps/web/src/components/onboarding/WelcomePage.tsx#L467-L491)). Then it:
  - opens a PTY;
  - writes the command into it **without a newline** ([L1224-L1263](https://github.com/pingdotgg/t3code/blob/591188471a6d8df7dad63083670afb6c2fb4d100/apps/web/src/components/onboarding/WelcomePage.tsx#L1224-L1263));
  - tells the person to "Review the command, then press Enter to run it." ([L1307](https://github.com/pingdotgg/t3code/blob/591188471a6d8df7dad63083670afb6c2fb4d100/apps/web/src/components/onboarding/WelcomePage.tsx#L1307)).
- **What the terminal is.**
  - The PTY is `node-pty` ([`NodePtyAdapter.ts`](https://github.com/pingdotgg/t3code/blob/591188471a6d8df7dad63083670afb6c2fb4d100/apps/server/src/terminal/NodePtyAdapter.ts)).
  - On Windows it starts `pwsh.exe`, then falls back to Windows PowerShell, then `cmd.exe` ([`Manager.ts` L515-L519, L613-L630](https://github.com/pingdotgg/t3code/blob/591188471a6d8df7dad63083670afb6c2fb4d100/apps/server/src/terminal/Manager.ts#L613-L630)).
  - The terminal's environment is T3's own minus a short blocklist, plus `TERM_PROGRAM=t3code`. **It doesn't set `BROWSER`** ([L117-L128, L1357-L1376](https://github.com/pingdotgg/t3code/blob/591188471a6d8df7dad63083670afb6c2fb4d100/apps/server/src/terminal/Manager.ts#L1357-L1376)).
- **So Claude Code sees a real terminal on both sides** and opens the browser with its own opener: `rundll32 url,OpenURL`, unless `BROWSER` is set in the person's environment.
- **Clicked links.** A link clicked in T3's terminal goes to T3's in-app preview when that's allowed, and otherwise to `shell.openExternal` ([`ThreadTerminalDrawer.tsx` L1041-L1077](https://github.com/pingdotgg/t3code/blob/591188471a6d8df7dad63083670afb6c2fb4d100/apps/web/src/components/ThreadTerminalDrawer.tsx#L1041-L1077)). The desktop app maps that to Electron's `shell.openExternal` ([`ElectronShell.ts` L74-L85](https://github.com/pingdotgg/t3code/blob/591188471a6d8df7dad63083670afb6c2fb4d100/apps/desktop/src/electron/ElectronShell.ts#L74-L85)). On Windows, Electron calls `ShellExecuteEx` ([electron `platform_util_win.cc`](https://github.com/electron/electron/blob/main/shell/common/platform_util_win.cc)).
- **Not used for Claude.** T3 also has a provider-auth flow with a "browser" interaction that opens the address itself through `shell.openExternal` and catches the callback ([`providerAuth.ts`](https://github.com/pingdotgg/t3code/blob/591188471a6d8df7dad63083670afb6c2fb4d100/apps/desktop/src/ipc/methods/providerAuth.ts)). That's wired to Codex (ChatGPT) sign-in, not Claude.

The lesson for the Installer page: T3 doesn't work around Claude Code's opener. It gives Claude Code a real terminal and makes the address clickable.

## GitHub CLI: `gh auth login --web`

**Confirmed (source, [cli/cli v2.103.1](https://github.com/cli/cli/tree/v2.103.1)).**

### When gh counts as interactive

- `opts.Interactive = true` only when `opts.IO.CanPrompt()` and no token was given ([`login.go` L158-L160](https://github.com/cli/cli/blob/v2.103.1/pkg/cmd/auth/login/login.go#L158-L160)).
- `CanPrompt()` is `IsStdinTTY() && IsStdoutTTY()`, and false when prompting is disabled ([`iostreams.go` L276-L282](https://github.com/cli/cli/blob/v2.103.1/pkg/iostreams/iostreams.go#L276-L282)). So **piping either stream makes gh non-interactive**. Today the Installer runs gh with `runOnScreen`, which inherits the console, so gh is interactive.
- `GH_PROMPT_DISABLED` (any value), or the config `prompt disabled`, sets "never prompt" ([`ghcmd/cmd.go` L352-L355](https://github.com/cli/cli/blob/v2.103.1/internal/ghcmd/cmd.go#L352-L355); documented in `gh help environment`, [`help_topic.go` L111](https://github.com/cli/cli/blob/v2.103.1/pkg/cmd/root/help_topic.go#L111)).
- `GH_FORCE_TTY` does the opposite: it forces stdout to count as a terminal ([`help_topic.go` L89](https://github.com/cli/cli/blob/v2.103.1/pkg/cmd/root/help_topic.go#L89)).

### The prompts, and what skips them

| Prompt | When it's shown | What skips it |
|---|---|---|
| "How would you like to authenticate GitHub CLI?" | Interactive, without `--web` | `--web` ([`login_flow.go` L90-L98](https://github.com/cli/cli/blob/v2.103.1/pkg/cmd/auth/shared/login_flow.go#L90-L98)) |
| Git protocol choice | Interactive, without `--git-protocol` | `--git-protocol https` ([L117-L131](https://github.com/cli/cli/blob/v2.103.1/pkg/cmd/auth/shared/login_flow.go#L117-L131)) |
| "Authenticate Git with your GitHub credentials?" | Interactive **and** protocol `https` ([L143-L145](https://github.com/cli/cli/blob/v2.103.1/pkg/cmd/auth/shared/login_flow.go#L143-L145)) | Not asked when gh is already Git's credential helper ([`git_credential.go` L40-L66](https://github.com/cli/cli/blob/v2.103.1/pkg/cmd/auth/shared/git_credential.go#L40-L66)), or when gh is non-interactive. **No flag answers it.** |
| "Press Enter to open `<address>` in your browser..." | Interactive only | Non-interactive skips it, **and also skips opening the browser** ([`authflow/flow.go` L73-L96](https://github.com/cli/cli/blob/v2.103.1/internal/authflow/flow.go#L73-L96)) |

**When it's non-interactive:**

- gh also never sets up the Git credential helper itself, because `shouldSetup` stays false. The Installer already runs `gh auth setup-git` after a fresh sign-in (`github.js:70`), so Git is still covered.
- **Confirmed:** gh's stdin isn't read at all in this mode, so it can be piped or ignored.

### Reading the one-time code without a terminal

**Confirmed (source).**

- The flow is the device flow ([`cli/oauth` v1.3.0 `DetectFlow`](https://github.com/cli/oauth/blob/v1.3.0/oauth.go#L105-L111) tries it first; [`oauth_device.go` L42-L66](https://github.com/cli/oauth/blob/v1.3.0/oauth_device.go#L42-L66)).
- gh's `DisplayCode` writes to **stderr** ([`flow.go` L60-L72](https://github.com/cli/cli/blob/v2.103.1/internal/authflow/flow.go#L60-L72)):
  - with `--clipboard`, if copying works: `! One-time code (XXXX-XXXX) copied to clipboard`;
  - otherwise, or when copying fails: `! First copy your one-time code: XXXX-XXXX`.
- Non-interactive, `BrowseURL` then writes `Open this URL to continue in your web browser: <verification address>` to stderr and returns without opening anything ([L82-L85](https://github.com/cli/cli/blob/v2.103.1/internal/authflow/flow.go#L82-L85)).
- Colour comes from the terminal check, so piped output is plain text.
- gh then polls until the person authorises, prints `✓ Authentication complete.` and exits.

So the Installer page can:

1. Read stderr for the code (pattern `[A-Z0-9]{4}-[A-Z0-9]{4}`) and the address.
2. Show the code with a copy button.
3. Open the address itself with `openPage`. GitHub returns `https://github.com/login/device` as the verification address. Take it from gh's output rather than hard-coding it.
4. Wait for gh to exit.

`--clipboard` can stay: copying still works without a terminal (Unconfirmed on York; it uses the Windows clipboard API through `atotto/clipboard`).

### If gh does open the browser (interactive mode)

**Confirmed (source).** It uses `GH_BROWSER`, then the `browser` config, then `BROWSER`, split like a shell command line ([go-gh v2.17.0 `browser.go` L45-L93](https://github.com/cli/go-gh/blob/v2.17.0/pkg/browser/browser.go#L45-L93)). Otherwise it uses `ShellExecute` on the address ([cli/browser v1.3.0 `browser_windows.go`](https://github.com/cli/browser/blob/v1.3.0/browser_windows.go)).

## clasp: `clasp login`

**Confirmed (source, [google/clasp v3.4.1](https://github.com/google/clasp/tree/v3.4.1), the same version as the npm tarball `manifest.json` pins).**

- **What the Installer runs.** The manifest's `signIn.run` is `["login"]`, with no `--no-localhost`, so clasp uses its **local-server flow** ([`login.ts` L96, L174](https://github.com/google/clasp/blob/v3.4.1/src/commands/login.ts#L96)).
- **How it signs in.** `LocalServerAuthorizationCodeFlow`:
  - listens on a free localhost port and uses `http://localhost:<port>` as the redirect;
  - calls `void open(authorizationUrl)`, without waiting or checking the result;
  - logs "Authorize clasp by visiting this url:" with the address on stdout;
  - resolves when Google redirects back ([`localhost_auth_code_flow.ts` L146-L151](https://github.com/google/clasp/blob/v3.4.1/src/auth/localhost_auth_code_flow.ts#L146-L151)).
- **How it opens the browser.** `open` (`^10.1.2`, which resolves to 10.2.0) runs, on Windows:
  ```
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand <Start "<address>">
  ```
  It's detached, with its stdio ignored ([open v10.2.0 `index.js` L165-L203](https://github.com/sindresorhus/open/blob/v10.2.0/index.js#L165-L203)). It doesn't read `BROWSER`.
- **No terminal needed.**
  - The login command and the local-server flow read no input.
  - Neither checks `isTTY`. clasp's `isBrowserPresent = process.stdout.isTTY` gate sits in `openUrl`, which the login flow doesn't use.
  - It prints `You are logged in as <email>.` and exits.
- **A fallback for the Installer.** The printed address carries the localhost redirect, so it **still comes back by itself** if the Installer opens it with `openPage` because PowerShell's `Start` didn't open a browser.
- **Unconfirmed:** whether endpoint security on York laptops blocks `powershell.exe -EncodedCommand`. If it did, the fallback above covers it.
- `--no-localhost` would switch to an `inquirer` prompt asking for the redirect address to be pasted back ([`serverless_auth_code_flow.ts`](https://github.com/google/clasp/blob/v3.4.1/src/auth/serverless_auth_code_flow.ts)). The Installer shouldn't use it.

## Summary table

| Sign-in | Needs a terminal? | Opens the browser with | Address printed? | Input needed |
|---|---|---|---|---|
| `claude auth login` | No | `BROWSER` if set, else `rundll32 url,OpenURL` | Yes, the **paste-a-code** address (stdout) | Only for a pasted code: `code#state\n` on stdin |
| T3 Code's Claude sign-in | Gives Claude a real PTY | Claude's own opener; clicked links use Electron's `ShellExecuteEx` | (Claude's) | The person presses Enter, and pastes if asked |
| `gh auth login --web` | No; piped means non-interactive | Nothing when non-interactive; the Installer opens it | Yes, with the code (stderr) | None when non-interactive |
| `clasp login` | No | PowerShell `Start "<address>"` via `open` | Yes, the **automatic** address (stdout) | None |

## Sources

Vendor documentation:

- Claude Code: [Authentication](https://code.claude.com/docs/en/authentication), [CLI reference](https://code.claude.com/docs/en/cli-reference), [Environment variables](https://code.claude.com/docs/en/env-vars), [Troubleshooting install and login](https://code.claude.com/docs/en/troubleshoot-install#login-and-authentication), [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) (2.1.126, 2.1.202 entries).
- GitHub CLI: `gh help environment` text in [`help_topic.go`](https://github.com/cli/cli/blob/v2.103.1/pkg/cmd/root/help_topic.go).

Source code:

- Claude Code 2.1.322 shipped bundle: [npm `@anthropic-ai/claude-code-win32-x64@2.1.322`](https://registry.npmjs.org/@anthropic-ai/claude-code-win32-x64/-/claude-code-win32-x64-2.1.322.tgz) (read as text, not run).
- GitHub CLI v2.103.1: [`login.go`](https://github.com/cli/cli/blob/v2.103.1/pkg/cmd/auth/login/login.go), [`login_flow.go`](https://github.com/cli/cli/blob/v2.103.1/pkg/cmd/auth/shared/login_flow.go), [`git_credential.go`](https://github.com/cli/cli/blob/v2.103.1/pkg/cmd/auth/shared/git_credential.go), [`authflow/flow.go`](https://github.com/cli/cli/blob/v2.103.1/internal/authflow/flow.go), [`iostreams.go`](https://github.com/cli/cli/blob/v2.103.1/pkg/iostreams/iostreams.go), [`ghcmd/cmd.go`](https://github.com/cli/cli/blob/v2.103.1/internal/ghcmd/cmd.go); [cli/oauth v1.3.0](https://github.com/cli/oauth/tree/v1.3.0); [go-gh v2.17.0 browser](https://github.com/cli/go-gh/blob/v2.17.0/pkg/browser/browser.go); [cli/browser v1.3.0](https://github.com/cli/browser/blob/v1.3.0/browser_windows.go).
- clasp v3.4.1: [`login.ts`](https://github.com/google/clasp/blob/v3.4.1/src/commands/login.ts), [`localhost_auth_code_flow.ts`](https://github.com/google/clasp/blob/v3.4.1/src/auth/localhost_auth_code_flow.ts), [`serverless_auth_code_flow.ts`](https://github.com/google/clasp/blob/v3.4.1/src/auth/serverless_auth_code_flow.ts); [open v10.2.0](https://github.com/sindresorhus/open/blob/v10.2.0/index.js).
- T3 Code at [`5911884`](https://github.com/pingdotgg/t3code/tree/591188471a6d8df7dad63083670afb6c2fb4d100): files linked in its section above. Electron [`platform_util_win.cc`](https://github.com/electron/electron/blob/main/shell/common/platform_util_win.cc).

Third-party reports (lower trust):

- [anthropics/claude-code#60126](https://github.com/anthropics/claude-code/issues/60126), [#59194](https://github.com/anthropics/claude-code/issues/59194).

This repo:

- Code survey on branch `research/installer-code-survey`: `terminal-coupling.md`, `claude-install.md`.
- `installer/src/machine.js` (`openPage` at about line 503; `startOnScreenAndKeep` at about 523-543), `installer/src/github.js`, `installer/src/extra-tools.js`, `manifest.json`.
