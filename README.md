# agent-jumpstart

Sets a team member up with an agent: the **Installer** puts everything on their laptop from one pasted line, and **Jumpstart** is a skill they run once to set up their workspaces. The spec is [#1](https://github.com/Bozodragon/agent-jumpstart/issues/1).

| Folder | What it's for |
| --- | --- |
| `bootstrap/` | The four PowerShell files people paste the address of, and the script that builds the Portall item they're published from. |
| `installer/` | The Node program the pasted line runs. It reads a profile, asks its questions, installs the tools and prints a checklist. |
| `profiles/` | One JSON file per profile (`york`, `default`): the workspace, connector, extra-tool and skill lists, which are ticked by default, the top workspace's folder name and whether it lives in Google Drive, and the setup page's address, its line to paste and who to send a log to. Adapting the setup for a new team is an edit here, not to the code. |
| `manifest.json` | The pinned version, download address and SHA-256 of each tool the installer installs (Node, Git, the GitHub CLI). Bumping a version is an edit here. T3 Code isn't pinned: its entry names the release feeds the installer follows for each channel, and the build is checked against the SHA-512 T3 publishes in them. |
| `skills/` | Skills the installer installs from this repo, such as `jumpstart`. |
| `page/` | The setup page, one source rendered per profile and published to the address in that profile's `page`. See `page/README.md`. |

`.agents/` and `.claude/` hold the skills used to build this repo, not ones the installer ships.

The installer's code names no workspace, connector, tool or skill: those come from the profile and the manifest. The one exception is the steps the spec fixes for every run: signing in to GitHub with the GitHub CLI, installing T3 Code, and checking Claude Code. Their manifest ids (`gh`, `t3`, `claude`) and GitHub's host (`github.com`) are named once, in `installer/src/manifest.js`, and every step reaches its entry through `toolEntry`.

## The pasted lines

A team member opens Windows PowerShell from the Start menu and pastes one of these:

| Line | What it's for |
| --- | --- |
| `irm https://jumpstart-install.arcforge.uk/york.ps1 \| iex` | York team members |
| `irm https://jumpstart-install.arcforge.uk/install.ps1 \| iex` | Everyone else (the `default` profile) |
| `irm https://jumpstart-install.arcforge.uk/york-debug.ps1 \| iex` | A supervised York test run: debug on, downloads kept |
| `irm https://jumpstart-install.arcforge.uk/share-log.ps1 \| iex` | Copies the newest installer log to the clipboard and opens its folder |

The first three are the same bootstrap with a different top line naming the profile and whether debug is on. It downloads the Node.js zip pinned in `manifest.json`, checks its SHA-256, unpacks it into `%LOCALAPPDATA%\Programs\nodejs` (unless that already holds the pinned version), downloads `installer.zip` (this program, its profiles and its dependencies) from the same Portall item into `%LOCALAPPDATA%\agent-jumpstart\program\`, and runs it. It has to work through `irm | iex` on Windows PowerShell 5.1 under Constrained Language Mode, so it stays plain ASCII with no byte-order mark and avoids `exit`, `Add-Type` and .NET method calls; `npm test` checks this.

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

It writes `settings.json` and a dated log under `%LOCALAPPDATA%\agent-jumpstart\`. With `--debug` (the debug line passes it) the person sees exactly the same questions and checklist, but the log also holds every program the installer ran with its exit code and full output, and the user PATH before and after; and the downloads are kept in `%LOCALAPPDATA%\agent-jumpstart\downloads\` rather than deleted after use.

Running it again updates. If `settings.json` is there for the same profile, its answers are used and nothing it holds is asked again; only an answer it lacks, or one that no longer fits (a folder that's gone, a name the profile no longer offers), is asked. To answer everything afresh, delete `settings.json` first. Each tool is moved to the pinned version (T3 to its channel's current build) if it's at another, missing PATH entries are put back, and anyone already signed in (Claude, GitHub, clasp) isn't signed in again or sent to the connectors page again. Every tool's checklist row says what this run did: `(installed)`, `(updated from <version>)`, `(reinstalled)` when the old version couldn't be read, or `(already up to date)`.

Three overrides let it run with no network and no prompts:

- `--home <folder>` uses that folder as the user's profile folder, with local AppData inside it. Nothing outside it is touched: changes to the user PATH and environment, and the programs it would run (such as Git's installer, or T3's `t3.cmd project add` that puts the top workspace in T3's list), are recorded under `<folder>\fake-machine\` instead.
- `--answers <file>` answers every question from a JSON file. Nothing is asked and no browser is opened. Its keys are the settings file's: `googleDriveFolder` (Google Drive profiles) or `workspacesLocation` (others), `channel` (`stable` or `nightly`), `github` (true or false), and `workspaces`, `connectors` and `extraTools` (lists of names, or of ids for extra tools, from the profile). A key left out takes its default, as pressing Enter would. On a re-run the settings file's answers come first, and the answers file stands in for the person only for what the settings file doesn't know.
- `--downloads <folder>` takes downloads from that folder instead of the internet. It stands in for the internet only: each file is copied into the installer's own downloads folder as a real download would be, and that folder is never changed. A `manifest.json` there replaces the pinned one, so a test's stand-in files can pass the checksum check. T3's release feed (`latest.yml` or `nightly.yml`) and GitHub's release list (`releases`) are read from there too.

## Testing

```
npm test
npm run typecheck
```

The tests run the real installer end to end in a temporary home with all three overrides, and check only what it leaves behind: the printed checklist, the exit code, the log, the settings file, the folders, and the fake machine's PATH and record of programs run. `pasted-lines.test.js` reads the four PowerShell files as text (it never runs them) and checks the rules above, that the three bootstrap lines differ only in their top line, and that their Node.js pin matches `manifest.json`. `page.test.js` renders the setup page for each profile and checks it shows that profile's own line once, the three steps in order and the share-log line.
