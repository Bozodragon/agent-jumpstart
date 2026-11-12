
# Installer questions vs #55, #56, #57

All paths are relative to the repo root. Line numbers are from this worktree (branch `wayfinder/plan-destination`).

## FACTS

### 1. Questions the Installer asks today, in order

`main.js:190` calls `askQuestions` (`questions.js:107`). A re-run wraps the asker in `knownFrom` (`questions.js:312`), so any key already in `settings.json` is not asked again. An answers file replaces the person (`answersFrom`, `questions.js:348`). Nothing in this list is the "skills" question. Skills are never asked (see 2.4).

Before anything is asked, `main.js:181-187` detects Claude's memory use (`autoMemoryInUse`) and an installed T3 Code (`findT3`).

| # | Key | Type | Options | Default | Asked when | Driven by |
|---|---|---|---|---|---|---|
| 1 | `topWorkspace` | choose (`questions.js:157`) | `Use <folder>` per existing T3 project (hint "already in T3 Code"), `new` ("Make a new one at/called ..."), `another` | the first existing T3 project, else `new` | Skipped if the settings' `topWorkspace` folder still exists (`questions.js:142-146`), or the settings predate this key (`:152-155`) | `workspaces.top` (folder name, e.g. "Claude"), `workspaces.choices[].name` (an existing T3 project matches if its title is `top` or its folder holds a workspace, `workspaces.js:160`), `workspaces.inGoogleDrive`, `workspaces.defaultLocation` |
| 1a | `topWorkspace` (again) | folder (`questions.js:176`) | typed path | none (placeholder `Documents\<top>`) | Only if 1 was `another` | `workspaces.top` (placeholder only) |
| 1b | `googleDriveReady` | choose (`google-drive.js:112`) | `again` or `documents` | `again` | Only if 1 was `new`, the profile uses Drive, and Drive is installed but not signed in or never opened | `workspaces.inGoogleDrive` |
| 1c | `softwareCenter` | choose (`google-drive.js:181`) | `install` or `documents` | `install` | Only if Drive isn't installed and Software Center offers it | `googleDrive.softwareCenter` and `.softwareCenterOffer` (york only) |
| 1d | `withoutGoogleDrive` | choose (`google-drive.js:293`) | `documents` or `install-first` (ends the run) | `documents` | Only if Drive isn't installed and Software Center doesn't offer it | `workspaces.inGoogleDrive` |
| 1e | `googleDriveFolder` | folder (`questions.js:218`) | typed path | the detected My Drive folder | Only for a new top workspace in Drive | `workspaces.inGoogleDrive` |
| 1f | `workspacesLocation` | folder (`questions.js:229`) | typed path | `<home>\<defaultLocation>` | Only for a new top workspace with a non-Drive profile | `workspaces.defaultLocation` (default.json has "Documents") |
| 2 | `channel` | choose (`questions.js:251`) | `stable` ("recommended"), `nightly` | `stable` | Skipped when T3 Code is already installed (`found.t3Channel`, `:247`) | None. Hard-coded in `questions.js:254-258`. |
| 3 | `github` | confirm (`questions.js:261`) | yes or no | **false** | Always (unless a re-run has it saved) | None. The `profile.github` block only supplies the sign-up page and email wording for the flow that follows (`github.js:29-32`). |
| 4 | `workspaces` | pick (`questions.js:264`) | `workspaces.choices` | the entries with `default: true` (Thinking space, Personal assistant in both profiles) | Always | `workspaces.choices` |
| 5 | `connectors` | pick (`questions.js:270`) | `connectors` | the entries with `default: true` (Gmail, Google Drive, Google Calendar; the rest false) | Always | `connectors[].name`, `.default` (`.what` and `.note` are used later) |
| 6 | `extraTools` | pick (`questions.js:275`) | `extraTools[]` (only `apps-script`) | `apps-script` default false | Always | `extraTools[].id`, `.question`, `.default` |
| 7 | `switchOffMemory` | confirm (`questions.js:284-291`) | yes or no | false (keep memory) | Only if `autoMemoryInUse` found signs of use, or an earlier run recorded the answer. Otherwise the answer is silently `true`. | None |
| later | `claudeSignIn` | choose, `inTurn` (`claude.js:93`) | `again` or `skip` | `again` (`skip` when unattended) | Only after a failed Claude sign-in | None |

Other prompts after the questions step are not in `Answers`: a "Press Enter once you have a GitHub account" pause (`github.js:105`) and "Press Enter once you've connected them" (`connectors.js:55`).

Profile differences:
- Drive prompts 1b, 1c, 1d and 1e only exist for york. `inGoogleDrive` is true in york and false in default.
- default has no `googleDrive` block.
- default has no `defaultLocation` in york, so york never asks 1f.
- Everything else, including the `connectors`, `extraTools`, `workspaces.choices` and `t3` lists, is identical between the two profiles.
- `t3` (`defaultModel`, `effort`, `codex`) drives T3 settings, not a question (`t3.js:150-169`).
- `skills[]` is identical in both profiles and is never asked about.

### 2. Mapping onto #56's experienced-user ideas

**2.1 GitHub on by default. Exists but fixed.**
- It is a question (`github`, `questions.js:261`), but the default is hard-coded `false`. No profile field controls it.
- Nothing is detected before asking.
- `gh auth status` is checked only after the person has said yes (`github.js:44-48`), to skip the sign-up page and sign-in.

**2.2 Where the top workspace goes. Exists as a question, with some detection.**
- It is the richest question (1 to 1f). It detects T3 projects (`workspaces.js:134`), an earlier run's setting, and Drive state.
- The folder name (`workspaces.top`) is fixed by the profile.
- The person can pick "Use another folder" (`questions.js:176-185`) and give any path. The folder name can then be anything.

**2.3 Keeping existing Claude Code, T3 Code or skills setup.**
- **Claude Code.** Detected, not asked.
  - `setUpClaude` installs only if `claude.exe` isn't present (`claude.js:60-67`) and signs in only if not signed in (`:71`).
  - It does not look for a `claude` elsewhere on PATH. It checks only `<home>\.local\bin` (`claude.js:47-48`).
  - It always adds that folder to the user PATH (`:50`).
- **T3 Code.** Detected. `findT3` (`t3.js:47`) leaves an existing install alone on either channel and at any build, and skips the `channel` question. Missing T3 settings keys are still added on every run (`t3.js:14-16`, `:94`).
- **Other tools** (git, gh, node and so on). `installTool` leaves a copy found on PATH or in its folder alone (`tools.js:95-110`, `leaveTheirs`).
- **Skills.** Detected, not asked. A skill already in `~/.claude/skills` that the installer didn't put there is left as it is (`skills.js:21-24`, `:65`, `:110`). The settings keys `skillsInstalled` and `skillSources` track the installer's own skills.
- **Claude memory.** Detected from `~/.claude/settings.json`, the Windows variable and project memory folders (`memory.js:29-55`). It is asked only for someone who uses it.
- **Gap.** There is no "keep my setup as is" switch. Detection is per item, and the installer still installs every profile skill that isn't already there.

**2.4 Choosing skills. Not present as a question; the list is fixed in the profile.**
- `profile.skills` is installed wholesale (`main.js:214`, `skills.js:45`), as the same 18 names in both profiles.
- Per-skill status shows only in the end summary.
- The page does list skills (`skill texts on the setup page`, recent commit aa04b30), but that is not a choice.

**2.5 Skipping Jumpstart's workspace setup. Not present.**
- The installer's `workspaces` pick chooses which workspace folders to create (`workspaces.js:182`).
- `createWorkspaces` always creates the top workspace.
- `jumpstart` is always installed, as a profile skill.
- The Jumpstart workspace setup itself (SKILL.md steps 7 to 9, `SKILL.md:137-176`) is run by the person typing `/jumpstart`, and the Installer has no option to hide or skip it.
- On a re-run, Jumpstart already treats an earlier run as "update only" (`SKILL.md:30`, `:218`).
- Inside Jumpstart, step 7.1 (`SKILL.md:141-145`) asks per folder whether to keep existing `CLAUDE.md` and related files. The default is "keep mine".

**2.6 T3 Code stable vs nightly. Exists as a question, conditionally hidden.**
- `channel` (`questions.js:251`) is asked only when no T3 Code is found. It is not profile-driven, and "nightly" is shown to everyone with the hint "can need troubleshooting".

**2.7 Detecting an existing setup.**

| Signal | Status |
|---|---|
| T3 Code installed | Detected already (`findT3`, `t3.js:47`; `Found.t3Channel`, `questions.js:32`). It changes what is asked. |
| `~/.claude` existing | **Detected only in part.** `places.claudeConfig` is read by `memory.js` (settings, `projects/*/memory`) and by `skills.js` (`skills/<name>`). Nothing treats "`~/.claude` exists" as an experience signal. |
| `gh` signed in | Detected, but only after the person says yes to GitHub (`github.js:44`). It does not feed the `github` default. |
| Claude Code present and signed in | Detected (`claude.js:60-71`), but only to skip install and sign-in, and it comes late in the run (after skills). It does not shape the questions. |
| Existing T3 project / top workspace | Detected (`workspaces.js:134`). |
| `git`, `gh` and other tools on PATH | Detected (`tools.js:103`). They change install behaviour, not questions. |
| Earlier run's settings | Detected (`readEarlierSettings`, `main.js:67`). It is profile-scoped (`:83`), and a different profile resets every question. |

**2.8 Experience in `skills/jumpstart`.** None as a concept. Nothing in the skill reads an experience level.
- `SKILL.md:11` hard-codes the audience: "They aren't technical, so write plain UK English and keep the plumbing out of sight".
- The settings file Jumpstart reads is the source for `email`, `workspaces`, `connectors` and `profile` only (`SKILL.md:19-24`).
- `agent-instructions.md:62` mentions GitHub issues only as a later opt-in.
- Jumpstart gets `autoMemory` from settings (`SKILL.md:152`).
- The skill would have to learn any new settings key (the `skills/jumpstart` text, `SKILL.md:19-24`).

### 3. Where #55's team question would sit

- **Profile.** Today a profile is per organisation (`profile.js:7-45`). Nothing in it is team-shaped.
  - A new optional field would be a `teams` array on the profile, for example `{ name, connectors: {add/default overrides}, skills: [...], workspaces: [...] }`.
  - Each team would layer onto the existing top-level lists: `connectors` (e.g. Marketing adds Google Analytics, which is not in either profile's connector list), `skills`, `workspaces.choices`.
  - The `Profile` typedef (`profile.js:19-45`) and `loadProfile`'s validation (`:98`) would need extending.
- **Question order.** It must come before the picks it changes, so before `workspaces` (`questions.js:263`), `connectors` (`:269`) and the skills step.
  - It cannot come after `connectors`, whose defaults and options it would change.
  - For "near the start" per #55, put it first in `theRest`, or before `whereWorkspacesLive` in `askQuestions` (`questions.js:107-109`).
  - It is independent of the location questions 1 to 1f, so either end works. First is the safest.
  - #56's experience question would sit beside it, and both would decide what the later picks offer.
- **Answers and settings.** `team` would join the `Answers` typedef (`questions.js:12-25`). It would be written to `settings.json` by `{ ...earlier, profile, ...choices }` (`main.js:198`), so a re-run would not ask again.
  - `knownFrom` would reuse it.
  - A person changing teams on a re-run is the same open problem as the other saved answers (see `rerun.test.js`). There is no "change my answer" path today.
  - Jumpstart could read it from the settings file once `SKILL.md:19-24` lists it.
- **Skills have no question today (2.4).** A team's skills therefore go straight into `installSkills(profile, ...)`, a new input. It reads `profile.skills` at `skills.js:47`, and `main.js:214` is the only caller.
- **Multi-team.** `choose` is single-select. The Asker has `pick` for multiple (`questions.js:52`). The `ui.ask` and `answersFrom` implementations exist for both.

### 4. #57 against the code

Confirmed:
- `claude.js:64` runs `irm https://claude.ai/install.ps1 | iex` straight in the window (`runOnScreen`). `claude.js:62-63` is the comment and the false "Its progress shows below" notice.
- The 15-minute Software Center wait is `softwareCenterPatience = 15 * 60 * 1000` (`google-drive.js:149`), used by the `keepTrying` at `:195-200`. #57's range `148-152` covers the constants, but the waiting call is at `:195-201`.
- The Asker interface is `questions.js:44-53` (cited as `44-52`, which is close enough).
- `ui.js:20` reads `WT_SESSION` and discards it (the code sets it for clack and then deletes it, `:21-24`).
- `ui.js:234` (`comeBack` text "the blue PowerShell window") and `google-drive.js:108` are as stated.
- `ui.js:4` says "York's PowerShell window is the old Windows console (conhost)". `README.md:62` repeats it ("made for York's window, the old Windows PowerShell console (conhost)").
- #57 says "#55's team question and #56's experience question fit as the first screens". The code agrees: nothing before `topWorkspace` is asked, and `theRest` is a clean insertion point.

Partly wrong or off:
- `machine.js:85-91` does not claim the window shows the code as it's typed. It says "what the person types still goes straight from the window to the program". The echo claim is at `claude.js:146-148` ("the window shows it as it's typed, without it passing through the installer"). Treat `machine.js:85-91` as only indirectly implying it.
- #57 says the blue-window wording is pinned by "two tests". I did not check the tests.
- #57 says "York's window is the old console" appears in `ui.js`, README and #28. It appears at `ui.js:4` and `README.md:62`. I did not check #28.
- #57 describes the `Asker` as the seam for a second front end. That is true, but several questions are *not* routed through `ask` because of `knownFrom` and `answersFrom`. Those wrap the Asker, so they carry over. `ui.pressEnter`, `ui.notice`, `ui.busy`, `ui.summary` and `ui.step` are separate direct calls on `ui` in `main.js`, `github.js`, `connectors.js` and others, not on the Asker. A second front end needs a `ui`-shaped interface as well, not just the Asker. #57 says "All drawing goes through ui.js", which is right, but `ui` is imported as a module (`import * as ui`) in about 10 files, not injected.
- #57 lists `runOnScreen` and `runOnScreenAndKeep` as the hard part. Callers: `claude.js:64` (installer script), `claude.js:86` (`claude auth login`, `AndKeep`), `github.js:63` (`gh auth login --web`), plus the extra tools (`extra-tools.js`). That is consistent with #57.
- #57 point 2 and 3 about `BROWSER`: `grep BROWSER installer/src` finds nothing, so it is untried.

Not contradicted but worth knowing:
- #56 says "Today everyone gets the beginner's walkthrough". True, and there is no profile-level or question-level switch.
- #56's "detected rather than asked" is already how Claude Code, T3 Code, skills and tools work, but not the GitHub answer.

## OPINIONS

- The cheapest first step for #56 is to make `github`'s default depend on a `gh auth status` check made before asking, and to make the pick defaults overridable from the profile. The detection code is already there (`github.js:44`).
- An experience level is best saved as a settings key the way `switchOffMemory` is, so a re-run and Jumpstart can read it. It should not be a separate profile, because profiles are per organisation and the pasted line picks them.
- Skills are the biggest gap for #55 and #56 alike. Both want skills chosen per person or per team, and there is no question, no `Answers` key and no settings key for the choice. The choice would need its own `skills` pick before `installSkills` runs.
- The fixed `channel` default and "nightly" being shown to beginners is the lowest-risk thing to hide for the guided route.
- The team question is better placed as the very first question than inside `theRest`, because the existing top workspace question has its own re-run shortcut (`questions.js:142`) that skips the question entirely. A team question after it could be skipped on a re-run for reasons that have nothing to do with the team.
- #57 should say that `ui` needs an injected seam, not only `Asker`. That is where the work is, and the claim "so a second front end can stand beside the terminal one" reads as if the Asker alone were enough.