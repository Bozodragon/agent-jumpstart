# agent-jumpstart

Sets a team member up with an agent: the **Installer** puts everything on their laptop from one pasted line, and **Jumpstart** is a skill they run once to set up their workspaces. The spec is [#1](https://github.com/Bozodragon/agent-jumpstart/issues/1).

| Folder | What it's for |
| --- | --- |
| `bootstrap/` | The four PowerShell files people paste the address of, and the script that builds the Portall item they're published from. |
| `installer/` | The Node program the pasted line runs. It reads a profile, asks its questions, installs the tools and prints a checklist. |
| `manifest.json` | Every version the installer installs, pinned with its download address and SHA-256 checksum. Bumping one is an edit here. |
| `profiles/` | One JSON file per profile (`york`, `default`): the workspace, connector, extra-tool and skill lists, which are ticked by default, whether workspaces live in Google Drive, and the setup page's address. Adapting the setup for a new team is an edit here, not to the code. |
| `skills/` | Skills the installer installs from this repo, such as `jumpstart`. |
| `page/` | The setup page, one source rendered per profile. |

`.agents/` and `.claude/` hold the skills used to build this repo, not ones the installer ships.

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

## Running the installer

```
npm install
node installer/src/main.js --profile york
```

It writes `settings.json` and a dated log under `%LOCALAPPDATA%\agent-jumpstart\`. Three overrides let it run with no network and no prompts:

- `--home <folder>` uses that folder as the user's profile folder, with local AppData inside it.
- `--answers <file>` answers every question from a JSON file. Nothing is asked and no browser is opened. Its keys are the settings file's: `googleDriveFolder` (Google Drive profiles) or `workspacesLocation` (others), `channel` (`stable` or `nightly`), `github` (true or false), and `workspaces`, `connectors` and `extraTools` (lists of names, or of ids for extra tools, from the profile). A key left out takes its default, as pressing Enter would.
- `--downloads <folder>` takes downloads from that folder instead of the internet.

## Testing

```
npm test
npm run typecheck
```

The tests run the real installer end to end in a temporary home with all three overrides, and check only what it leaves behind: the printed checklist, the exit code, the log and the settings file. `pasted-lines.test.js` reads the four PowerShell files as text (it never runs them) and checks the rules above, that the three bootstrap lines differ only in their top line, and that their Node.js pin matches `manifest.json`.
