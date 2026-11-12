# Google Drive: code findings for #57

All paths are relative to the repo root. FACTS come first, OPINIONS last.

## FACTS

### 1. What is built today (Software Center route, Documents fallback, detection)

**Detection of Drive's state:** `findGoogleDrive` (`installer/src/google-drive.js:34-49`) returns one of four states:
- `not-installed`
- `never-opened`
- `signed-out`
- `signed-in` (with `folder`, possibly undefined)

How it decides:
- It reads `%LOCALAPPDATA%\Google\DriveFS`. If the folder is missing, it checks `programThere` (`:56-65`): `Program Files\Google\Drive File Stream\<ver>\GoogleDriveFS.exe`.
- A program with no DriveFS folder means `never-opened`. No program means `not-installed`.
- Account folders are directories with numeric names. None means `signed-out`.
- Otherwise it looks for `My Drive` on each drive root, then on `home` (`:44-48`).
- This only reads the disk. It never reads a Drive version.
- Opened-or-not is inferred from the DriveFS folder, not from a process or a registry entry.

**Where it is called:**
- `installer/src/questions.js:148` calls `findGoogleDrive`, only when `profile.workspaces.inGoogleDrive` is true. That is York only (`profiles/york.json:26`; `profiles/default.json:27` is false).
- `questions.js:213` calls `readyGoogleDrive`.
- `readyGoogleDrive` (`google-drive.js:90-140`) is a loop:
  - `not-installed` goes to `fromSoftwareCenter`.
  - Then it asks the person to open Drive and sign in, and offers "Yes, it's signed in" or "Use Documents instead".
  - With nobody at the screen it stops (`notReady`, `:311-315`).
  - After sign-in it polls for My Drive with `keepTrying`.

**Software Center route** (`fromSoftwareCenter`, `:172-224`). It runs only if the profile has `googleDrive.softwareCenter`. That key exists only in `profiles/york.json:38-41` (value "Google Drive").
- `driveInSoftwareCenter` (`:245-277`), read-only:
  - `sc query CcmExec` must say RUNNING.
  - `reg query HKCR\softwarecenter /v "URL Protocol"` must succeed.
  - PowerShell runs `Get-CimInstance root\ccm\ClientSDK CCM_Application | Where Name -like '*Drive*' | Select -First 1 Id,Name,InstallState` (`:259`).
  - It returns the `Id` string, or `undefined` with a log line, so nothing alarming is shown.
- It then offers "Install it from Software Center" or "Use Documents instead".
- On install it opens `softwarecenter:SoftwareID=<id>` through `showPage` (`:193`).
- It then waits up to 15 minutes (`:149`), polling every 5 s (`:152`), until a version folder exists in Program Files (`installing`, `:231-234`).
- It then asks for the sign-in and waits up to another 15 minutes.
- It cannot tell a failed Software Center install from a slow one. This confirms the claim in #57.
- `restartLine` (`:156`) is still shown, pending #37.

**Documents fallback** (`withoutGoogleDrive`, `:291-305`). It is reached when Drive is `not-installed` and Software Center is not offered or timed out.
- The choices are "Use Documents" (default) or "I'll install Google Drive first".
- The second choice throws `End`, which ends the run cleanly.
- `questions.js:213-218`: a `documents` result puts the workspaces in `~/Documents`.

**Detection of "installed/opened Drive" beyond the above:** nothing else exists. There is no registry check, no process check, and no Drive version read.

### 2. CCM_Application querying

- It exists at `google-drive.js:257-262`, and it selects only `Id, Name, InstallState`.
- It does **not** read the offered version. `CCM_Application` has a `SoftwareVersion` property, which the code never selects.
- `InstallState` is selected but never used. The code only parses `Id` (`:273`).
- The name match is a wildcard `-like '*Google Drive*'`, taking the first match.
- #57's statement that "the Installer can read the offered version from Software Center" is true of the CIM class. It is **not** built.
- Adding the version means a new select field and a new return shape. `driveInSoftwareCenter` currently returns a bare `string | undefined`.
- Test fixture: `installer/test/software-center.test.js:29` fakes `{Id, Name, InstallState}` only.
- CIM access works in Constrained Language Mode: the code comment at `google-drive.js:256` says so, and nothing was verified.

### 3. #38 built vs not built

- **Built:** all acceptance criteria except the restart line. #38 says it was built in merge b695bea via PR #52, and #38's open state is deliberate (comment on #38). The tests are `installer/test/software-center.test.js`, with these cases:
  - the offer and the default choice
  - the choice order
  - Documents without opening anything
  - install, wait and sign-in
  - the restart line
  - the 15-minute timeout offering Documents
  - no Software Center or no offer, with no alarming log
  - the default profile never checking
- **Not done:**
  - the restart-line decision, which waits on #37
  - #37 itself (a human check on a York laptop: Drive's Id, device or user offer, restart behaviour). It is open, and no result comment exists.
  - #38's comment says "Not yet tried on a laptop with Software Center". #57 says it was tried at the session: the Software Center opened at Drive's entry, but the install failed for several people. So the open/Id part works on real laptops, and the install step failed.

### 4. How the Installer downloads and runs T3 Code's installer

**T3 Code (`installer/src/t3.js`):**
- `findRelease` (`t3-release.js:19-34`) fetches T3's `latest.yml` feed (nightly goes through the GitHub API). The feed gives the version, the file name and a base64 SHA-512.
- `parseFeed` (`:45-56`) reads those lines. The file is matched by architecture regex (`manifest.json:148-151`).
- `obtain` (`tools.js:357-386`) is a plain `fetch` streamed to `places.state/downloads/<name>`. It is not a progress bar. In tests it can take the file from a `downloads` override folder instead.
- `checkSha512` (`t3-release.js:110-119`) checks the hash. It throws `NotInstalled` on a mismatch.
- `machine.run(file, ["/S", "--force-run"])` (`t3.js:115`, `manifest.json:154`) runs it per-user with no UAC.
- It checks that exit code is 0. It then checks that `Programs\t3code\<exe>` exists (`t3.js:118-124`).
- It wraps the lot in `ui.busy` (`:135`). The file is deleted afterwards unless `keepDownloads`.
- Success is detected by the shim `.t3/bin/t3.cmd` (`waitForFirstLaunch`).
- An existing install is detected through the registry `DisplayVersion` (`t3.js:236-241`), and is never updated.

**Generic tools (`installer/src/tools.js`):**
- They use `obtain` plus a pinned SHA-256 (`checkSum`, `:388-398`) from `manifest.json`, then `machine.run(file, args)` (`:182`).

**Could that machinery run Google's Drive installer?**

Reusable as is:
- `obtain` (any URL; the only requirement is that a basename comes out of `new URL(url).pathname`)
- `machine.run`
- `keepTrying`
- `ui.busy`
- the `downloads` test override
- the log pattern
- the registry and file-existence "installed?" checks

The differences for Drive:
- **No published hash and no feed.** The T3 path is verified by the vendor's feed hash. Google's `GoogleDriveSetup.exe` is a stable bootstrapper that fetches the real build, and the code has no hash for it. So `checkSha512` and the pinned `checkSum` have no equivalent. At most the code could check Authenticode, which is not built anywhere.
- **No version-aware address.** There is no `findRelease` equivalent for Google. This is the open question in #57. The code has no per-version mechanism.
- **The installer's own flags and elevation behaviour are not in the repo.** The T3 arguments `/S` and `--force-run` are Electron/NSIS-specific. Google's silent flags (e.g. `--silent`) are not encoded anywhere. I did not verify them.
- **Admin:** `machine.run` neither elevates nor detects a UAC prompt. If Google's installer asks for admin rights, the Installer sees whatever the process does (a hang, or an exit code), with no handling written.
- **Result check:** `installing()` (`google-drive.js:231`) looks for a version folder in Program Files, which is the Drive-side equivalent of T3's `program exists` check. It would carry over.
- The Windows proxy is not honoured: `obtain` uses Node `fetch` (`tools.js:375`). #57 lists the proxy as "to check" for Claude, and the same caveat applies here.

### 5. What survives in `google-drive.js` if Software Center is replaced by Google's installer

**Survives unchanged:**
- `findGoogleDrive`, `programThere`, `programFolder`, `describeGoogleDrive`, `isFolder`
- the whole `signed-in` and My Drive wait in `readyGoogleDrive` (`:98-140`), including the never-opened and signed-out prompt, the "Use Documents instead" choice, and the `notReady` stop
- `withoutGoogleDrive` (`:279-305`), the Documents fallback
- the `GoogleDrive` and `WhereItGoes` typedefs
- the `Context` typedef
- the `installing()` check, as the post-install check
- the sign-in wait (`:208-224`) and the 15-minute patience and 5 s polling constants (`:149,152`), as the pattern

**Goes or is replaced:**
- `driveInSoftwareCenter` (`:245-277`), partly. The CcmExec, protocol and CCM reads would only matter if they are kept for reading the offered version (see below).
- `softwareCenterOffer` and the profile keys `googleDrive.softwareCenter` and `softwareCenterOffer` (`profiles/york.json:38-41`, `profile.js:26`).
- The `showPage('Software Center', 'softwarecenter:SoftwareID=…')` step (`:193`).
- The `restartLine` (`:156`), if Google's installer does not ask for a restart.
- The `softwareCenter` choice key (an answers-file key).
- `software-center.test.js` mostly gets rewritten. `google-drive.test.js` mostly survives.

**Version-mismatch idea from #57:** the existing CCM query could be kept narrowly to read the offered `SoftwareVersion`. That needs the CIM select changed. The "what to do on a mismatch" decision is unbuilt, and so is the mismatch comparison.

### 6. What in #28 is still unbuilt (merged code vs issue text)

Sub-issue states (via `gh`):
- #29-36 and #39-50 are CLOSED.
- #37 (human check), #38 (leave open for the restart line) and #51 (human checks) are OPEN.
- #28 says 20/23 are complete.

Also unbuilt or untested against a real laptop, per the #28 comment:
- #33: a real-PowerShell check of Claude's `Paste code here if prompted >` prompt. Also a fresh install after Skip for now, to see whether T3 Code stays closed on `/S` alone.
- #44: that the writing picker appears within about 15 s, and that a script loaded from the setup host works in T3 Code's render tool.
- #46: the thread rename without a prompt.
- #50: a `/jumpstart` re-run shows its menu.
- #41/#46: the "Help improve Claude" label.
- #42: screenshots from Nightly 0.1.7 rather than Stable.
- #51 items 2 to 5, including T3 Code on a laptop that has never had it.

I only verified that those issues are closed or open. I did not read the code for each closed ticket.

### 7. Where #57 and the code disagree or mislead

- **#57:** "Today the Installer can't tell a failed Software Center install from a slow one. It waits up to 15 minutes (`google-drive.js:148-152`)."
  - **Code:** accurate. Success is only "a version folder appears" (`installing`, `:231-234`). A failed install, a cancelled one and a pending one all look the same.
- **#57:** "The Installer can read the offered version from Software Center (`CCM_Application`)."
  - **Code:** the query exists but does not select the version (`:259`). Reading it is not built. The `CCM_Application` property name is the standard `SoftwareVersion`, but that is my knowledge, not verified on a York laptop. Nothing in the repo confirms the field exists there.
- **#57:** "Spec #28 assumed Google's installer always needs admin rights."
  - **Code:** the assumption is in #38's text ("Google's own installer needs admin rights and is never used"). The code comment at `google-drive.js:5-7` also states "Drive is optional, and it's never installed here ... which needs no admin rights". Both would need rewriting.
- **#57:** "the Software Center route (#38, `installer/src/google-drive.js`) is to be replaced."
  - **Code:** the route lives in `fromSoftwareCenter` and `driveInSoftwareCenter`. Detection, sign-in and the Documents fallback are separate and are not Software-Center-specific, so only part of the file is replaced.
- **#57 (side note):** "Today the Installer ... waits 15 minutes either way."
  - **Code:** the first 15 minutes apply to install, and then up to another 15 apply to sign-in. The total can be 30.
- **The #57 text about the earlier 133 vs 132 mismatch** is not evidenced in the code or the tests. The code has no version knowledge about Drive.

## OPINIONS

- **Design:** the T3 pipeline is the right shape to copy (find release, `obtain`, verify, `machine.run`, check the result, `ui.busy`). The unsolved piece is verification, because Google publishes no feed or hash. Without one, the Installer would be running an unverified `.exe` it downloaded. I would at least check Authenticode (Google LLC signature), or accept the risk on purpose and record it in an ADR.
- **The version problem is the core risk.** The code has nothing that handles "Google's latest != offered". The cheapest option is to read `SoftwareVersion` from `CCM_Application` (a one-field change) and compare it with the version of the downloaded installer. I could not find where the downloaded installer's version would come from before running it (file version metadata is one idea; unverified).
- **On mismatch, I would suggest** falling back to the Software Center offer, which is already built. That avoids deleting working code. It also means `driveInSoftwareCenter` should be kept and extended, not dropped.
- **A failed Software Center install** could be detected better from `CCM_Application.InstallState` or `EvaluationState` while waiting. That field is already selected but never read. This is cheap and independent of the Google-installer decision.
- **The default profile** has `inGoogleDrive: false`, so nothing about Drive runs for it. Giving it Drive would also need a new `inGoogleDrive` value in `profiles/default.json`, plus a new offer text.
- **#37** is mostly moot if Software Center is replaced. It still decides whether `restartLine` is needed, so it can be closed or reframed. #38 can close once its replacement is decided.
- **Proxy risk:** Node `fetch` ignores the Windows proxy (#57 flags this as unchecked for Claude). The same applies to `obtain`, so a Drive download over a proxied network may fail where T3's works.

Key files:
- `installer/src/google-drive.js`
- `installer/src/questions.js` (lines 148 and 213)
- `installer/src/t3.js`
- `installer/src/t3-release.js`
- `installer/src/tools.js` (`obtain` at 357)
- `installer/test/software-center.test.js`
- `installer/test/google-drive.test.js`
- `profiles/york.json` (38-41)
- `manifest.json` (131-158)