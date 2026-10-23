# agent-jumpstart

Sets a team member up with an agent: the **Installer** puts everything on their laptop from one pasted line, and **Jumpstart** is a skill they run once to set up their workspaces. The spec is [#1](https://github.com/Bozodragon/agent-jumpstart/issues/1).

| Folder | What it's for |
| --- | --- |
| `installer/` | The Node program the pasted line runs. It reads a profile, asks its questions, installs the tools and prints a checklist. |
| `profiles/` | One JSON file per profile (`york`, `default`): the workspace, connector, extra-tool and skill lists, which are ticked by default, whether workspaces live in Google Drive, and the setup page's address. Adapting the setup for a new team is an edit here, not to the code. |
| `manifest.json` | The pinned version, download address and SHA-256 of each tool the installer installs (Node, Git, the GitHub CLI). Bumping a version is an edit here. |
| `skills/` | Skills the installer installs from this repo, such as `jumpstart`. |
| `page/` | The setup page, one source rendered per profile. |

`.agents/` and `.claude/` hold the skills used to build this repo, not ones the installer ships.

## Running the installer

```
npm install
node installer/src/main.js --profile york
```

It writes `settings.json` and a dated log under `%LOCALAPPDATA%\agent-jumpstart\`. Three overrides let it run with no network and no prompts:

- `--home <folder>` uses that folder as the user's profile folder, with local AppData inside it. Nothing outside it is touched: changes to the user PATH and environment, and the programs it would run (such as Git's installer), are recorded under `<folder>\fake-machine\` instead.
- `--answers <file>` answers every question from a JSON file. Nothing is asked and no browser is opened.
- `--downloads <folder>` takes downloads from that folder instead of the internet. A `manifest.json` there replaces the pinned one, so a test's stand-in files can pass the checksum check.

## Testing

```
npm test
npm run typecheck
```

The tests run the real installer end to end in a temporary home with all three overrides, and check only what it leaves behind: the printed checklist, the exit code, the log, the settings file, the folders, and the fake machine's PATH and record of programs run.
