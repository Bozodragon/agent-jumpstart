# agent-jumpstart

Sets a team member up with an agent: the **Installer** puts everything on their laptop from one pasted line, and **Jumpstart** is a skill they run once to set up their workspaces. The spec is [#1](https://github.com/Bozodragon/agent-jumpstart/issues/1).

| Folder | What it's for |
| --- | --- |
| `bootstrap/` | The four PowerShell files people paste the address of, and the script that builds the Portall item they're published from. |
| `installer/` | The Node program the pasted line runs. It reads a profile, asks its questions, installs the tools and prints a checklist. |
| `profiles/` | One JSON file per profile (`york`, `default`): the workspace, connector, extra-tool and skill lists, which are ticked by default, what each connector lets the agent do (its `what`, shown after its name when the person is sent to connect it), the top workspace's folder name and whether it lives in Google Drive (and, if it does, how to get Google Drive for desktop on the team's laptops), and the setup page's address, its line to paste and who to send a log to. Adapting the setup for a new team is an edit here, not to the code. |
| `manifest.json` | The pinned version, download address and SHA-256 of each tool the installer installs (Node, Git, the GitHub CLI, clasp and the skills CLI). Bumping a version is an edit here. T3 Code isn't pinned: its entry names the release feeds the installer follows for each channel, and the build is checked against the SHA-512 T3 publishes in them. |
| `skills/` | Skills the installer installs from this repo, such as `jumpstart`. |
| `page/` | The setup page, one source rendered per profile and published to the address in that profile's `page`. See `page/README.md`. |

`.agents/` and `.claude/` hold the skills used to build this repo, not ones the installer ships.

Only Node.js and the command-line tools are pinned. What the pins don't cover:

- clasp and the skills CLI are npm packages pinned by their own tarball's checksum, but their dependencies aren't: neither ships a lock file (`npm-shrinkwrap.json`), so npm picks their dependencies' versions within the packages' ranges on the day, checked only against the registry's own hashes.
- Skills aren't pinned: each comes from its source's default branch on the day, as the profile names it.
- Claude Code isn't installed by the installer (T3 Code's welcome screen installs it), so its version isn't pinned here.

The installer's code names no workspace, connector, tool or skill: those come from the profile and the manifest. The one exception is the steps the spec fixes for every run: signing in to GitHub with the GitHub CLI, installing the skills with the skills CLI, installing T3 Code, and checking Claude Code. Their manifest ids (`gh`, `t3`, `claude`, `skills`) and GitHub's host (`github.com`) are named once, in `installer/src/manifest.js`, and every step reaches its entry through `toolEntry`.

## The pasted lines

A team member opens Windows PowerShell from the Start menu and pastes one of these:

| Line | What it's for |
| --- | --- |
| `irm https://jumpstart-install.arcforge.uk/york.ps1 \| iex` | York team members |
| `irm https://jumpstart-install.arcforge.uk/install.ps1 \| iex` | Everyone else (the `default` profile) |
| `irm https://jumpstart-install.arcforge.uk/york-debug.ps1 \| iex` | A supervised York test run: debug on, downloads kept |
| `irm https://jumpstart-install.arcforge.uk/share-log.ps1 \| iex` | Copies the newest installer log to the clipboard and opens its folder |

The first three are the same bootstrap with a different top line naming the profile and whether debug is on. It downloads the Node.js zip pinned in `manifest.json`, checks its SHA-256, unpacks it into `%LOCALAPPDATA%\agent-jumpstart\node` (unless that already holds the pinned version), a folder of the installer's own that is never on PATH, so a Node.js the person already has is never moved or replaced; downloads `installer.zip` (this program, its profiles and its dependencies) from the same Portall item into `%LOCALAPPDATA%\agent-jumpstart\program\`, and runs it. It has to work through `irm | iex` on Windows PowerShell 5.1 under Constrained Language Mode, so it stays plain ASCII with no byte-order mark and avoids `exit`, `Add-Type` and .NET method calls; `npm test` checks this.

All four and `installer.zip` are one public Portall item, so one publish ships them together:

```
npm run publish:portall
```

## The setup page

Each profile has its own page showing only its line to paste: [York](https://jumpstart-york.arcforge.uk/) and [everyone else](https://jumpstart.arcforge.uk/). `npm run publish:page` renders and publishes both; see `page/README.md`.

## Running the installer

```
npm install
node installer/src/main.js --profile york
```

It writes `settings.json` and a dated log under `%LOCALAPPDATA%\agent-jumpstart\`. The log holds each program that failed, with its exit code and output. With `--debug` (the debug line passes it) the person sees exactly the same questions and checklist, but the log also holds every program the installer ran with its exit code and full output, the user PATH before and after, and the PATH programs are given each time it changes; and the downloads are kept in `%LOCALAPPDATA%\agent-jumpstart\downloads\` rather than deleted after use.

Every program it runs is started with a PATH rebuilt from the registry at that moment: the machine PATH, then the user PATH, with their `%VARIABLES%` expanded, then whatever of the PowerShell window's own PATH isn't already there. The window's PATH dates from when it opened, so this is how the programs it runs see a Git that Software Centre installed since, and the tools this run installs. T3 Code reads PATH only when it starts, and its silent install starts it, so it's installed last, after every tool's PATH entry, and after Claude Code's folder (`%USERPROFILE%\.local\bin`, where Claude Code's own installer puts `claude.exe`) is put on the user PATH, whether or not it's there yet: T3 then finds Claude Code as soon as its welcome screen has installed it. Once T3 has started, the top workspace is added to its project list with T3's own `t3.cmd project add`. Just after T3 starts, its server hasn't yet said it's running, and the command refuses with `ServerAlreadyRunningError`, so it's tried again every 2 seconds for up to two minutes; the checklist says if T3 was still starting after that.

It doesn't open the setup page: the person has just pasted its line, and the browser would take them away from the PowerShell window. Each page it does open (the connectors page, GitHub's sign-up page, an extra tool's settings page, Google's Drive download page) comes with a note to come back to this window (the blue PowerShell window) and press Enter once they're done in the browser. Each slow step that shows nothing of its own (each tool's download and install, T3 Code's, which takes about a minute, the skills CLI's runs, waiting for T3 Code or My Drive) shows a spinner with the time so far; where the output isn't a terminal, as in the tests, it's a plain line instead.

It never quietly replaces or duplicates a setup the person already has: anything already in place is either left alone and used, or the person is asked.

- **Tools** (Node.js, Git, the GitHub CLI, clasp): one already on the machine or user PATH outside the installer's folder for it, or in that folder but not put there by the installer, is left as it is, gets no PATH entry, and is the copy later steps use (the GitHub sign-in runs that `gh`, the Apps Script sign-in that `clasp`). Its row reads `<version> (already installed at <folder>, left as it is)`. The installer knows its own copies by the `.installed-by-agent-jumpstart` file it leaves in a tool's folder after each install; only those are updated. A folder of the installer's that holds something else, and not the tool, is left alone and the tool isn't installed. The skills CLI sits off PATH in its own folder and is only ever run by the installer, with the installer's own Node and the bin script its package names, so it never depends on whichever `node` is first on PATH.
- **T3 Code**: one already installed (Windows records its version, or either channel's program is in its folder) isn't downloaded, updated or switched, and the channel isn't asked; the channel found is recorded. Its row reads `<version> (<channel>, already installed, left as it is)`.
- **The top workspace**: the person is always asked where it is ("Where's your top workspace? Your other workspaces go inside it."), unless a re-run already knows. They can choose a project already in T3 Code that looks like one, make a new one where the profile says (in Google Drive, or a folder they then give), or use another folder of their own by typing its path. A folder that's already there is used as it is, whatever it's called, and only the missing workspaces are made inside it; one that isn't is made, if the folder it goes in is there. Google Drive for desktop is needed only when a new one is made under a Google Drive profile. If it isn't installed or isn't signed in then, the person is told how to get it ready, in the profile's words (`googleDrive.install`; without them, they're sent to Google's download page), and asked to press Enter once it's signed in; it's looked for again each time, until it's signed in or they choose "I'll do this later", which stops the run. With answers from a file nobody is waited for, and the run stops at once. My Drive can take a few seconds to appear after the sign-in, so it's looked for again for up to two minutes before its folder is asked for. See `topWorkspace` below.
- **Skills**: one already in Claude's skills folder is left as it is (`Already there, left as it is`) unless this installer installed it before (`skillsInstalled` in `settings.json`); those are added again, which updates them. The skills CLI clones each source with Git, so with no `git.exe` on the machine or user PATH after the tools step it isn't run, and each skill's row reads `Not installed: Git is needed and isn't installed`.
- **Memory**: someone who has been using Claude's automatic memory is asked before it's switched off, and by default it's left on.
- **Sign-ins**: anyone already signed in (Claude, GitHub, clasp) isn't signed in again or sent to the connectors page again, and Git's settings aren't touched for someone already signed in to GitHub.

Running it again carries on and updates what the installer itself put there. If `settings.json` is there for the same profile, its answers are used and nothing it holds is asked again; only an answer it lacks, or one that no longer fits (a folder that's gone, a name the profile no longer offers), is asked. A top workspace that's gone is asked about afresh rather than made again; settings from before the top workspace was recorded are taken as a new one where their Google Drive folder or workspaces folder says. So a No to GitHub, or an extra tool left unticked, stays that way on every re-run, and the GitHub question says so; to answer everything afresh, delete `settings.json` first. Each tool the installer installed is moved to the pinned version if it's at another, and its missing PATH entries are put back. Every tool's checklist row says what this run did: `(installed)`, `(updated from <version>)`, `(reinstalled)` when the old version couldn't be read, `(already up to date)`, or `(already installed at <folder>, left as it is)`.

Three overrides let it run with no network and no prompts:

- `--home <folder>` uses that folder as the user's profile folder, with local AppData inside it. Nothing outside it is touched: changes to the user PATH and environment, the programs it would run (such as Git's installer, or T3's `t3.cmd project add` that puts the top workspace in T3's list), and the pages it would open in the browser are recorded under `<folder>\fake-machine\` instead, each program with the PATH it was given. The machine-wide PATH it searches for tools already installed is `<folder>\fake-machine\machine-path.json` (a list of folders), and the user PATH is the fake environment's. The fake machine never really waits: it has no patience for what happens after a program returns (T3 opening, My Drive appearing), unless a test gives it some in `<folder>\fake-machine\waiting.json`, and then it only counts the time, so a test can also say what appears after a while. What it only reads from the profile folder, such as T3 Code's project list (`.t3\userdata\statev2.sqlite`, opened read-only), is read from the override.
- `--answers <file>` answers every question from a JSON file. Nothing is asked and nothing waits for Enter. Pages still open, and programs still run, through the machine: without `--home` that is the real one. Its keys are the settings file's: `topWorkspace` (one of the folders of the projects T3 Code already lists that look like a top workspace, that is titled as the profile's top workspace or holding one of its workspaces; or `new`, to make one where the profile says; or any folder's whole path. A folder, listed or not, is used as it is wherever it is and whatever it's called, with no Google Drive check, and one that isn't there is made if the folder it goes in is; otherwise the answer is wrong. The default is the first such project, or `new` if there's none), `googleDriveFolder` (Google Drive profiles) or `workspacesLocation` (others; either asked only for `new`; for a folder, `workspacesLocation` is the folder it's in and `googleDriveFolder` is null), `channel` (`stable` or `nightly`; not asked when T3 Code is already installed, whose channel is recorded instead), `github` (true or false), `workspaces`, `connectors` and `extraTools` (lists of names, or of ids for extra tools, from the profile), and `switchOffMemory` (true or false, default false; asked only of someone who has been using Claude's automatic memory, that is whose Claude settings switch it on, whose `CLAUDE_CODE_DISABLE_AUTO_MEMORY` is set to anything but `1`, or who has files in a project's `memory` folder, and when No neither switch is touched). The settings file also records `autoMemory` (`"off"` or `"left on"`) for Jumpstart. A key left out takes its default, as pressing Enter would. On a re-run the settings file's answers come first, and the answers file stands in for the person only for what the settings file doesn't know.
- `--downloads <folder>` takes downloads from that folder instead of the internet. It stands in for the internet only: each file is copied into the installer's own downloads folder as a real download would be, and that folder is never changed. A `manifest.json` there replaces the pinned one, so a test's stand-in files can pass the checksum check. That replacement is for tests only: it's reachable only through `--downloads`, which nothing but a test passes, and a real run always reads the pinned `manifest.json`. T3's release feed (`latest.yml` or `nightly.yml`) and GitHub's release list (`releases`) are read from there too.

## Testing

```
npm test
npm run typecheck
```

The tests run the real installer end to end in a temporary home with all three overrides, and check only what it leaves behind: the printed checklist, the exit code, the log, the settings file, the folders, and the fake machine's PATH and record of programs run. `pasted-lines.test.js` reads the four PowerShell files as text (it never runs them) and checks the rules above, that the three bootstrap lines differ only in their top line, that their Node.js pin matches `manifest.json`, and that they unpack Node.js into the installer's own folder. `page.test.js` renders the setup page for each profile and checks it shows that profile's own line once, the three steps in order and the share-log line.
