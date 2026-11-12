# Inventory: where the Installer assumes a terminal (for #57's Installer page)

Read-only. Paths are relative to the repo root; `installer/src/` is shortened to `src/`.

## FACTS

### 1. ui.js: the terminal front end (`src/ui.js`, 256 lines)

Everything in it is terminal-specific, and it is one module of free functions, not an object.

| Line | What it does |
|---|---|
| 14-24 | Imports `node:readline`, sets `WT_SESSION` before dynamically importing `@clack/prompts`, then restores it. The original value is read at line 20 and thrown away. |
| 26-66 | `swaps` and `colours`: rewrite glyphs and ANSI colours for the old console. |
| 69-74 | **Monkey-patches `process.stdout.write` and `process.stderr.write` globally.** Every byte written by anything in the process, including `machine.js` output, passes through `drawable()`. |
| 91-109 | `ask`: the `Asker` implementation for the terminal. It wraps clack's `text`, `select`, `confirm` and `multiselect`. Cancel throws `Stop('Stopped at your request.')` (81-84). |
| 112-119 | `start` and `step`: `intro` and `log.message`. |
| 134-178 | `spin`: reads `process.stdout.columns` and writes `\r` and `\x1b[?25l` directly. Puts `process.stdin` in raw mode and swallows keys. Ctrl+C calls `process.exit(130)`. |
| 191-207 | `busy`: if `!process.stdout.isTTY` it degrades to `step()` (192-195). The tests rely on this. |
| 210-218 | `problem` and `summary`: `log.message` and `note`. |
| 224-228 | `inWords` and `bullet`: pure text helpers. |
| 234 | `comeBack`: wording "come back to this window (the blue PowerShell window) and press Enter". |
| 237-239 | `notice` calls clack `note`. |
| 246-248 | `pressEnter` is a clack `select` with the single option "Done". |
| 254-256 | `finish` calls `outro`. |

**The ui surface used by the rest of the Installer is 12 functions:** `start`, `step`, `busy`, `problem`, `summary`, `notice`, `pressEnter`, `finish`, `ask`, `inWords`, `bullet` and `comeBack`.

**ui.js is not injected.** Every consumer does `import * as ui from './ui.js'`. That covers `main.js:34`, `ending.js:9`, `claude.js:17`, `connectors.js:6`, `extra-tools.js:8`, `github.js:10`, `google-drive.js:13`, `open-page.js:2`, `skills.js:29`, `t3.js:25`, `tools.js:23` and `workspaces.js:12`. Only `ui.ask` is passed in: `main.js:176` picks `unattended ? answersFrom(answers) : ui.ask` and hands it to `askQuestions` and `setUpClaude`.

### 2. The Asker (`src/questions.js:41-53`)

- Four methods: `folder`, `choose`, `confirm`, `pick`.
- Each takes `{key, message, ...}`.
- The shape is already screen-agnostic. Two implementations exist: `ui.ask` and `answersFrom` (`questions.js:~348`). `knownFrom` (`questions.js:~312-339`) wraps any Asker to reuse settings on a re-run.
- `folder` takes a `validate` callback that returns an error string or undefined. Validation runs inside the Asker, so a page front end must call it per submission.
- `choose.other` and `inTurn` are hints that only the answers-file Asker uses.
- Callers are `askQuestions` (`questions.js` ask.* calls at about lines 157, 177, 219, 230, 239, 252, 262, 264, 276, 287) and `claude.js:94`, `claudeSignIn`, a `choose`.
- **Asker calls that bypass `questions.js`:**
  - `claude.js:94-103`: the Try again / Skip choice.
  - `google-drive.js`: `ask.choose` after its `ui.notice` at about line 100-112.
  - Both use the same interface, so they are in class (a).

### 3. Classification of the terminal assumptions

**(a) Behind ui.js or Asker, so a second front end could replace them:**
- All `ui.*` calls listed in section 1. About 40 call sites, in the files from section 1.
- All `ask.*` calls.
- `ending.js:100-111`: `showEnding` uses only `ui.notice`, `ui.problem` and `ui.finish`. The Ending structure itself (`newEnding`, `note`, `closingLines`) is pure data. This is the cleanest piece.
- `main.js` uses `ui.start` (172), `ui.summary` (193, 268-270, 301), `ui.step` (272, 303), `ui.problem` (298, 300) and `ui.finish` (286).

**(b) Bypasses ui.js and Asker:**
- `main.js:136`: `console.error(messageOf(error))` for bad command-line options. It runs before the log opens.
- `main.js:292`: rethrows non-Stop errors, so Node prints the stack to stderr. The path is `throw error` at line 292, then `process.exitCode = await main()` at 320.
- `machine.js:355`: the **fake** `startOnScreenAndKeep` does `process.stdout.write(ran.output)`.
- `machine.js:533-538`: the **real** `startOnScreenAndKeep` pipes the child's stdout and stderr to `process.stdout` and `process.stderr`.
- `machine.js:~490-495`: the real `startOnScreen` uses `stdio: 'inherit'`, so the child owns the console, stdin and stdout.
- `ui.js:147-160`: stdin raw mode and the keypress handler. This is inside ui.js but is a direct `process.stdin` use.
- `bootstrap/install.ps1:~200-202`: `& $nodeExe @arguments` runs node with the console attached. It then writes `Write-Host` lines after a non-zero exit (about line 205) and prints `irm .../share-log.ps1` advice at about line 206. These are PowerShell output outside the Node process.
- **No other** `process.stdout`, `process.stderr`, `process.stdin`, `console.*` or `readline` use exists in `installer/src/`. A grep confirms this; the only hits are in ui.js, machine.js and main.js:136.

**Other terminal-shaped assumptions found along the way (in the code, not in #57):**
- The `attended` flag is derived from "answers file absent", not from "a terminal is present" (`main.js:169, 178`). It gates every `pressEnter` wait (`connectors.js:54`, `extra-tools.js:54`, `github.js:104`, `t3.js:252`, `google-drive.js:123`). A page front end is attended, so it passes the existing flag unchanged.
- `ui.busy` has a "no TTY" branch (`ui.js:192`). It decides by `process.stdout.isTTY`, a property of the process rather than of the front end.
- The `comeBack` text is a string constant in ui.js, but `google-drive.js:108` hard-codes its own copy, "come back to this window (the blue PowerShell window) and press Enter", in a `notice` body.
- Wording that assumes the terminal is baked into notice bodies in the callers, not only in ui.js. This includes "come back here. This window carries on by itself" and "paste it here and press Enter" (`claude.js:77, 79`), "Press Enter to open the browser" (`github.js:58`), and "Its progress shows below" (`claude.js:63`).

### 4. Programs run on screen

| File:line | Program | Method | What the person does |
|---|---|---|---|
| `claude.js:64` | Anthropic's `install.ps1`, via `anthropicsInstaller` | `runOnScreen` | Nothing. It is watched, and nothing prints for minutes (#57 section 2). The comment at `claude.js:62` and the step text at 63 say "Its progress shows below". The code only confirms that nothing is spinning over it; it does not verify the claim about the script. |
| `claude.js:86` | `claude.exe auth login` | `runOnScreenAndKeep` (stdin inherited; stdout and stderr piped, kept and echoed) | Signs in through the browser. Only if the page shows a code: pastes it and presses Enter at `Paste code here if prompted >`. Looped on failure by the `claudeSignIn` choose (94-103). Output is logged with `withoutWhatWasTyped` (`claude.js:~107-140`). |
| `github.js:63` | `gh auth login --hostname H --git-protocol https --web --clipboard` | `runOnScreen` | Presses Enter for "Authenticate Git?". Presses Enter to open the browser, then pastes the one-time code in the browser. The test at `github.test.js:74` asserts the person must see the code gh prints. |
| `extra-tools.js:90` | The tool's `signIn.run` args from the manifest (clasp login, per `apps-script.test.js:87`) | `runOnScreen` | Signs in through the browser. The notice text comes from `extra.signIn` (89). |

- Four call sites in total.
- `launch`, `openPage`, `run` and `runHere` are not on screen, since their output is captured or discarded.
- `openPage` is a rundll32 spawn with `stdio: 'ignore'`, and `open-page.js:13` prints the URL with `ui.step`.

The #57 text names "the extra tools' sign-ins", and those are the one `extra-tools.js:90` call site, driven by the manifest.

### 5. Tests that pin terminal wording

**Pin "blue PowerShell window":**
- `test/apps-script.test.js:105`: `/come back to this window \(the blue PowerShell window\) and press Enter/`.
- `test/pages.test.js:43`: same regex, matched with the `g` flag. It counts how many pages carry it.
- #57 says "two tests that pin the wording". That is correct for the "blue" wording specifically.

**Pin other terminal-wording:**
- `test/claude-sign-in.test.js:56-72`: the exact four notice lines ("Then come back here. This window carries on by itself.", "paste it here and press Enter"). It also checks `doesNotMatch /Press Enter to choose your Claude account/`.
- `test/claude-sign-in.test.js:20`: the `Paste code here if prompted > ` prompt.
- `test/software-center.test.js:96`: "Click Install in Software Center, then come back to this window."
- `test/claude.test.js:39`: asserts the Anthropic script `onScreen === true` "so they see its progress".
- `test/github.test.js:74`, `test/t3.test.js:140`, `test/apps-script.test.js:87` and `test/claude-sign-in.test.js:85`: assert `onScreen` for specific runs.
- `test/rerun.test.js:271`: asserts there were no `onScreen` runs when already signed in.
- `test/old-console.test.js:24-45`: asserts every character printed to stdout and stderr is in a hard-coded old-console set. A page front end doesn't print to stdout, but the terminal path must still pass.
- `test/output.test.js` (46, 82, 102): spinner or "says they're working" lines and the no-stack-trace behaviour.

**General coupling:**
- The test seam (`test/harness.js:109`, `runWith`) spawns the real `main.js` with the `--answers`, `--home` and `--downloads` overrides and captures `stdout` and `stderr`.
- About 25 of the 27 test files assert on `stdout` text. Counts range from 1 (`logging.test.js`) to 40 (`workspaces.test.js`). `harness.js` itself references `stdout` 6 times.
- Any change to ui.js wording or output shape will touch most of the suite.
- Tests run unattended (answers file), so `ui.ask` and the spinner's TTY branches are never run in tests. The old-console test comment says "Prompts, the spinner and colours need a person at a real terminal, so they're checked by hand."

### 6. Where the code contradicts or qualifies #57

- **Supported:** the `Asker` is at `questions.js:44-52`, so the line range matches (the typedef starts at 44; the block comment at 41-43).
- **Supported:** "All drawing goes through ui.js". A grep shows no other stdout, stderr or `console` use in the Installer except the three exceptions above (main.js:136, machine.js:355 and 533).
- **Qualified:** "`claude.js:64` ... no spinner" matches. The source comment at `claude.js:62` actually reads "Its own installer shows its progress in this window, so there's no spinner over it." The "Its progress shows below" wording is the user-facing step text at 63, which matches #57.
- **Qualified:** #57 puts the `WT_SESSION` read at "ui.js:20". It is there (`const windowsTerminalSession = process.env[windowsTerminal]` at 20). It is restored at 24 only when it was previously undefined; if it was set, it is left alone. It is not "thrown away" strictly, since it's a module-level const, but nothing uses it and it is never logged.
- **Qualified:** the `ui.js:234` pointer is exact for the `comeBack` constant. #57's second site, `google-drive.js:108`, holds its own **copy** of the sentence rather than calling `ui.comeBack`. That is why the "blue" wording exists in two places, and a rewrite must change both.
- **Not in #57:** `ui.js:4` and the README still say York's window is the old console (#57 section 4 already plans to correct this).
- **Not contradicted but unverified:** the claim that `claude auth login` "switches the console to no-echo mode". The code comments (`machine.js:85-91`, `claude.js:146-148`) say the opposite, as #57 notes. I found no code that tests no-echo behaviour. `claude-sign-in.test.js:138` says "Were the code ever printed back after the prompt".
- **Unmentioned in #57:** `runOnScreenAndKeep` already puts `claude auth login`'s stdout and stderr through pipes. Only stdin is `inherit`. This is a partial redirect that already works on York laptops (the README describes it). So #57's "whether `claude auth login` runs with its input and output redirected" is half-answered: output redirection is proven; input redirection is not. The JSDoc at `machine.js:85-91` says it "checks only that what it reads from is a terminal", which is the thing a page front end would break.

## OPINIONS

- **ui.js is the right seam, but it's wired as a singleton.** With 12 consumers each doing `import * as ui`, a second front end can't coexist without either (a) making `ui` a runtime-chosen object or (b) making the exported functions delegate. Option (b) is the smallest change.
- **`machine.runOnScreen` and `runOnScreenAndKeep` are the hard seam.** They mix "run a program" with "give it the person's console". For a page front end they need to become "run a program with its stdio relayed to a page". `gh auth login --web --clipboard` is the worst case: it prompts on stdin ("Press Enter to open the browser") and prints a code to copy. A page can parse the code from the stream, but only if gh isn't checking `isatty`. That is untested and could force a fallback to the terminal front end for GitHub.
- **Notice text should become data, not strings with bullets and "this window".** Today the wording is both content and terminal layout (`  • ` bullets, "press Enter"). A page needs structured notices (title, lines, a "Done" action). Unlike the Asker, ui has no data-level interface for notices.
- **The `attended` flag and the `isTTY` check in `busy` overlap in confusing ways.** A page front end needs to say attended is true even when stdout is not a TTY. That means `busy` should ask the front end, not `process.stdout.isTTY`.
- **Test cost is the real expense.** Roughly all the tests that match stdout will keep working if the terminal front end stays untouched, so it is cheaper to leave the terminal path byte-identical and add a page path beside it than to reshape ui.js's output.

## What a page front end must replace

1. The 12 ui.js functions listed in section 1, plus `ui.ask` (four methods).
2. The global stdout/stderr patch (`ui.js:69-74`): a page doesn't need it, and a page front end must not install it.
3. `ui.busy`'s "no TTY, so a plain step" branch (`ui.js:192`): replace it with a progress channel (percent, bytes) that also carries the downloads #57 wants to show.
4. The three on-screen programs, `runOnScreen` (`claude.js:64`, `github.js:63`, `extra-tools.js:90`) and `runOnScreenAndKeep` (`claude.js:86`). That means relaying their output to the page and accepting input from it (the Claude code box).
5. The ending screen: `showEnding` already routes through ui, so only the three ui calls need page equivalents.
6. `main.js:136` `console.error` and the unhandled-error path (`main.js:292`): they need a page "failed" screen, or must stay terminal-only.
7. Terminal wording in notice bodies in `claude.js`, `github.js`, `google-drive.js`, `connectors.js` and `extra-tools.js`. Reword these ("come back to this window", "press Enter") for the page, ideally via per-front-end text.
8. `bootstrap/install.ps1:~200-205`: it must also open the page, or the Node program must open it itself.

## Smallest seam change that lets two front ends coexist

1. Turn `ui.js`'s exports into a thin facade over a **front end object** with the existing 12-function shape, `terminal` being the current implementation. Add `ui.use(frontEnd)`, called once in `main.js` before `ui.start` (`main.js:172`). No consumer changes, since they all keep `import * as ui`. The default is `terminal`, so the existing tests stay unchanged. One edge: `ui.js` currently patches stdout at import time, so the patch has to move inside `terminal`'s setup, or run only when `terminal` is chosen.
2. In the same change, make `ui.ask` pick from the same `use()` object, so `main.js:176` needs no new branch.
3. Make `comeBack` (and the duplicated sentence at `google-drive.js:108`) a function of the front end, e.g. `ui.comeBack()`, so terminal keeps today's text and the page gets its own. This is the one step that touches callers (2 places).
4. Add a `machine` option for how on-screen programs get their stdio (`'inherit'` vs `'pipe'` plus a relay callback), chosen by the front end, leaving the `Machine` method names alone so the fake machine and the tests don't change.
5. Pick the front end by `--page` (or the opposite), and fall back to `terminal` if the local server can't start or the browser can't reach `127.0.0.1`.

Smallest viable first cut is steps 1 and 2 only: that alone lets `pressEnter`, `notice`, `busy`, `summary`, `ask` and `finish` run on the page, with the four on-screen programs temporarily still opening in the terminal.