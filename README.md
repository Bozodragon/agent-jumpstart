# agent-jumpstart

Sets a team member up with an agent: the **Installer** puts everything on their laptop from one pasted line, and **Jumpstart** is a skill they run once to set up their workspaces. The spec is [#1](https://github.com/Bozodragon/agent-jumpstart/issues/1).

| Folder | What it's for |
| --- | --- |
| `installer/` | The Node program the pasted line runs. It reads a profile, asks its questions, installs the tools and prints a checklist. |
| `profiles/` | One JSON file per profile (`york`, `default`): the workspace, connector, extra-tool and skill lists, which are ticked by default, whether workspaces live in Google Drive, and the setup page's address. Adapting the setup for a new team is an edit here, not to the code. |
| `skills/` | Skills the installer installs from this repo, such as `jumpstart`. |
| `page/` | The setup page, one source rendered per profile. |

`.agents/` and `.claude/` hold the skills used to build this repo, not ones the installer ships.

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

The one test runs the real installer end to end in a temporary home with all three overrides, and checks only what it leaves behind: the printed checklist, the exit code, the log and the settings file.
