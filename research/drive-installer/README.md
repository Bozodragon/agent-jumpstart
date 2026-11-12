# Google's Drive installer: versions, silent install and checks

Researched 12 November 2026 for the Installer's Drive question. Primary sources: Google's Workspace admin help, the installer file itself (downloaded to a throwaway folder, read, never run), and Microsoft's documentation. Each finding is marked **confirmed** (with a source) or **unconfirmed**.

## Answer

- **There is no address for an older version.** Google publishes one address, `https://dl.google.com/drive-file-stream/GoogleDriveSetup.exe`, and it serves "the prior version" until a new release is fully rolled out. Today it serves 133.0.2.0 even though 134.0 was released on 10 November. So the Installer cannot ask for "132". It can only fetch whatever the address serves, read its version, and compare.
- **Google's installer needs admin rights by design.** The installer's own manifest says `requireAdministrator`, and Google's admin help says users need admin privileges to install. It installs per-machine (`Program Files\Google\Drive File Stream\<version>`). Nothing Google documents makes it per-user. So the York result (a matching version runs without admin rights) is **not** Google's behaviour. It is most likely a York policy that lets an approved version elevate. That is unconfirmed, and it means the route cannot be assumed to work off York's laptops.
- **Silent flags are documented:** `GoogleDriveSetup.exe --silent --desktop_shortcut --skip_launch_new --gsuite_shortcuts=false`. No documented flag chooses the install folder or per-user mode.
- **Reading versions is straightforward.**
  - Downloaded file: the version resource reads `133.0.2.0` (four parts, where release notes say "133.0").
  - Installed Drive: the folder name under `Program Files\Google\Drive File Stream\`.
  - Software Center's offer: `CCM_Application` does have a `SoftwareVersion` string. It is free text set by whoever packaged the application, so it may not equal the file's version. That match is unconfirmed until read on a York laptop.
- **Checking the download.** Google publishes no hash, feed or versioned list. The file is Authenticode-signed (Google LLC, valid, timestamped), and `Get-AuthenticodeSignature` is the check. It is a cmdlet, so Constrained Language Mode permits it, but I could not test it under Constrained Language here. Node has no built-in signature check, so the Installer would call PowerShell.
- **Recommended shape.** Fetch the latest installer, check its signature, read its version, compare with the `SoftwareVersion` offered in Software Center. On a match, run it. On a mismatch or any doubt, fall back to the Software Center route that is already built. Do not treat "latest" as stable: it changes under the Installer's feet.

## Detail

### 1. Versions

| Finding | Status | Source |
|---|---|---|
| The one published installer address is `https://dl.google.com/drive-file-stream/GoogleDriveSetup.exe`. Google's setup guide lists no stable, enterprise, MSI, versioned or older download. | confirmed | [Set up Drive for desktop](https://knowledge.workspace.google.com/admin/drive/set-up-drive-for-desktop-for-your-organization) |
| "Until we reach 100% roll-out, the Drive for desktop download link provides the prior version." This explains 133 served while 132 or 134 are the "current" version. | confirmed | [Release notes](https://knowledge.workspace.google.com/admin/drive/google-drive-for-desktop-release-notes) |
| Checked live on 12 November 2026: the address returned a file last modified 10 November 2026 (279,001,752 bytes, ETag `6f5fbd4`) whose version resource is **133.0.2.0**. The release notes list 134.0 on 10 November, 133.0 on 19 October, 132.0 on 28 September. | confirmed (observation, will age) | the file; release notes |
| `GoogleDriveFSSetup.exe` at the same folder returns the same size and ETag, so it is the same file under its internal name. `GoogleDriveSetup-x64.exe` is a 404. | confirmed (observation) | HTTP headers |
| The file is a full installer (about 279 MB), not a thin downloader. The Installer's download progress and disk space need to allow for that. | confirmed | HTTP headers |
| Release notes list versions as one number shared by Windows and macOS, newest first, with no per-version download links and no update feed. | confirmed | [Release notes](https://knowledge.workspace.google.com/admin/drive/google-drive-for-desktop-release-notes) |
| An archive of older release notes exists, and one 2023 entry linked a dated installer (`https://www.google.com/dl/release2/drive-file-stream/<hash>_64.0.2.0/setup.exe`). That link now returns 404, and the hash prefix means addresses cannot be guessed. Treat versioned addresses as not available. | confirmed (link tested) | [Release notes archive](https://knowledge.workspace.google.com/admin/drive/google-drive-for-desktop-release-notes-archive) |
| Google recommends staying on a version released within 12 months and says it "may disable outdated versions of Drive for desktop at any time". Drive updates itself by default (Google Update). | confirmed | [Manage updates](https://knowledge.workspace.google.com/admin/drive/manage-drive-for-desktop-updates-for-your-users) |
| An admin-console setting, "Show Google Drive for desktop download link", is described as requiring admin privileges on the computer to install. | confirmed | [Set up Drive for desktop](https://knowledge.workspace.google.com/admin/drive/set-up-drive-for-desktop-for-your-organization) |

Consequence for York: if Software Center offers 132 while Google's address serves 133, the two will not match for as long as York lags. A matching window exists only when York's offer equals what the address serves, and the Installer cannot choose a version to fit.

### 2. Silent install, and per-user or per-machine

| Finding | Status | Source |
|---|---|---|
| Google's silent install command: `GoogleDriveSetup --silent --desktop_shortcut`. | confirmed | [Set up Drive for desktop](https://knowledge.workspace.google.com/admin/drive/set-up-drive-for-desktop-for-your-organization) |
| `--desktop_shortcut` is optional. `--skip_launch_new` stops Drive launching after install. `--gsuite_shortcuts=false` turns off the Docs, Sheets and Slides desktop shortcuts (on by default). | confirmed | same page |
| The strings `silent`, `desktop_shortcut`, `skip_launch_new` and `gsuite_shortcuts` all appear in the downloaded installer, so the flags are not stale documentation. | confirmed (string search, not executed) | the file |
| Silent uninstall: `"%PROGRAMFILES%\Google\Drive File Stream\<VERSION>\uninstall.exe" --silent --force_stop`. This also shows the install lives in Program Files, which is per-machine. | confirmed | same page |
| `--installation_dir`, `--force_launch` and any per-user switch are not documented. | confirmed (absent from Google's page) | same page |
| The installer's embedded manifest contains `requestedExecutionLevel level="requireAdministrator"`. Windows therefore asks for elevation whenever it is started, whatever flags are passed. A plain spawn from a standard-user process fails or prompts instead of running. | confirmed (read from the file) | the file |
| Google's page does not say whether a silent install needs admin rights, and does not mention per-user installs. | confirmed (absent) | same page |
| What decides per-user or per-machine: the manifest (always admin) and the Program Files destination. Nothing selectable. | confirmed for the manifest; the destination follows from Google's uninstall path | the file; Google's page |
| **Why a matching version ran without admin rights on York laptops.** The manifest rules out Google's installer doing this by itself. A likely cause is York's endpoint policy, such as a rule that approves an installer by version, publisher or hash, or running it through Software Center's own context. This is inference. A York IT contact or a test of the exact file on a laptop would settle it. | unconfirmed | no source |

Consequence: off York's laptops, expect an elevation prompt that a standard user cannot pass. The Installer's `machine.run` neither elevates nor detects this (see the code survey), so it would hang or fail without a clear message unless handled.

### 3. Reading versions

| Finding | Status | Source |
|---|---|---|
| Downloaded installer: the file's version resource reads FileVersion and ProductVersion `133.0.2.0`, ProductName `Google Drive`, CompanyName `Google LLC.`, FileDescription `Google Drive Installer`, OriginalFilename `GoogleDriveFSSetup.exe`. In PowerShell this is `(Get-Item $file).VersionInfo.FileVersion`. | confirmed (read in full-language PowerShell, file not run) | the file |
| Under Constrained Language Mode, cmdlets work and "users can get all properties of allowed types". `FileVersionInfo` is not on the allowed-types list, so reading `.VersionInfo` there is not guaranteed. Fallback: parse the PE version resource in Node, or compare file size and signature instead. | unconfirmed in Constrained Language | [about_Language_Modes](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_language_modes) |
| Installed Drive: the folder name under `Program Files\Google\Drive File Stream\`. The existing Installer already finds this folder. Whether the folder name always equals the installer's four-part file version (for example `133.0.2.0`) was not seen directly. | folder layout confirmed from Google's uninstall path; exact equality unconfirmed | [Set up Drive for desktop](https://knowledge.workspace.google.com/admin/drive/set-up-drive-for-desktop-for-your-organization) |
| `CCM_Application` has `SoftwareVersion` (String, "Software version"), `InstallState` (String: NotInstalled, Unknown, Error, Installed, NotEvaluated, NotUpdated, NotConfigured) and `EvaluationState` (UInt32, 0 to 28, for example 4 "last failed to enforce", 12 "currently enforcing", 24 "download failed"). Also `ErrorCode`, `PercentComplete`, `IsMachineTarget` and `Revision`. | confirmed | [CCM_Application class](https://learn.microsoft.com/en-us/mem/configmgr/develop/reference/core/clients/sdk/ccm_application-client-wmi-class) |
| `SoftwareVersion` is the packager's own text. It may read `132.0` where the installer file says `132.0.4.0`, so comparison should be by leading numbers (major, perhaps major.minor) and must be tried on a real York laptop. | unconfirmed | no source |
| `EvaluationState` 4 or 24 and `ErrorCode` would let the Installer tell a failed Software Center install from a slow one (the survey's open complaint). | confirmed for what the fields mean; unconfirmed that York's deployment reports them | same Microsoft page |

### 4. Checking the download

| Finding | Status | Source |
|---|---|---|
| Google publishes no hash, checksum list or feed for the installer. | confirmed (absent from Google's setup page and release notes) | Google pages above |
| The file carries a valid Authenticode signature: subject `CN=Google LLC, O=Google LLC, L=Mountain View, S=California, C=US` with serial number 3582691, issued by `DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1`, countersigned by a DigiCert timestamp, certificate valid to 11 April 2027. `Get-AuthenticodeSignature` returned `Valid`. | confirmed (observation) | the file |
| `Get-AuthenticodeSignature` is a cmdlet for Windows only. Constrained Language Mode allows all Windows-module cmdlets and property reads on allowed types, and `[X509Certificate]` is on the allowed list, so reading `.Status` and `.SignerCertificate.Subject` should work. Not tested under Constrained Language. | cmdlet behaviour confirmed; Constrained Language run unconfirmed | [Get-AuthenticodeSignature](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature), [about_Language_Modes](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_language_modes) |
| Node has no built-in Authenticode verification, so from Node the check means spawning PowerShell and reading its output. | based on my knowledge of Node, not a source I checked | none |
| Check `Status -eq 'Valid'` and that the subject is Google LLC. A `Valid` status alone only means a trusted chain, so also compare the subject (and ideally the certificate's serial or thumbprint pattern), or any validly signed program would pass. The signing certificate will be replaced before April 2027, so pin the subject name, not the thumbprint. | recommendation | none |
| The signature stops tampering in transit and a wrong file, but does not tell which version it is. Version comes from the version resource and must be read after the signature check (the version resource sits inside the signed file, so it is trustworthy once the signature is valid). | recommendation | none |
| A pinned SHA-256 is not useful: the address changes version without notice. For reference only, today's file hashes to `0b05cafc98a7e360add5e9b0b5911b11af535256fa4e350ef880fddf3ce4454c`. | confirmed (observation, will age) | the file |

## What this means for the map

- The Installer cannot get "the version Software Center offers" from Google. It can only check whether the latest one happens to match.
- Reading the offered version is a one-field change (`SoftwareVersion`) in the existing CIM query, but the comparison rule needs a real York laptop to settle.
- The no-admin result is a York policy effect, not something Google provides. Keep the Software Center route as the fallback, and keep Documents as the final fallback.
- If the Installer runs Google's installer without York's policy, a standard user hits an elevation prompt. The Installer needs to detect that rather than wait 15 minutes.
- Open questions for a York check: the exact `SoftwareVersion` string and `InstallState` of the Drive entry, whether Software Center's version equals the installer's file version, and why a matching version avoids admin rights.

## Method note

The installer was downloaded into a new empty temporary folder and only read: its HTTP headers, version resource, signature and embedded strings. It was never run. Nothing was signed in, changed or installed.

## Sources

- [Set up Drive for desktop for your organization](https://knowledge.workspace.google.com/admin/drive/set-up-drive-for-desktop-for-your-organization) (Google; the older `support.google.com/a/answer/7491144` address redirects here)
- [Google Drive for desktop release notes](https://knowledge.workspace.google.com/admin/drive/google-drive-for-desktop-release-notes) (Google)
- [Google Drive for desktop release notes archive](https://knowledge.workspace.google.com/admin/drive/google-drive-for-desktop-release-notes-archive) (Google)
- [Manage Drive for desktop updates for your users](https://knowledge.workspace.google.com/admin/drive/manage-drive-for-desktop-updates-for-your-users) (Google)
- [Install Drive for desktop](https://support.google.com/drive/answer/10838124) (Google; no admin or per-user statement)
- [CCM_Application class](https://learn.microsoft.com/en-us/mem/configmgr/develop/reference/core/clients/sdk/ccm_application-client-wmi-class) (Microsoft)
- [Get-AuthenticodeSignature](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature) (Microsoft)
- [about_Language_Modes](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_language_modes) (Microsoft)
- `https://dl.google.com/drive-file-stream/GoogleDriveSetup.exe` itself: headers, version resource, signature, manifest, strings
- [Code survey, `drive-residue.md`](https://github.com/Bozodragon/agent-jumpstart/tree/research/installer-code-survey/research/installer-code-survey) (this repository)
