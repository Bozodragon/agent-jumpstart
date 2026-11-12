# How Anthropic's native Claude Code install works on Windows

Research for the Installer: can it download Claude Code itself and show "N% of 330 MB"? Checked on 12 November 2026 against Claude Code 2.1.322. Each finding is marked **confirmed** (with a source) or **unconfirmed** (with what would settle it).

## Answer

- **Yes, a self-download is straightforward.** `install.ps1` is 110 lines and does five plain things: get the latest version number, get `manifest.json`, download `claude.exe`, check its SHA-256, run `claude.exe install`. All of it is ordinary HTTPS from `downloads.claude.ai`. Nothing needs a browser, a login or admin rights. (confirmed)
- **The size is in the manifest, so the percentage is easy.** `platforms.win32-x64.size` is 346,496,160 bytes for 2.1.322. That is 330.4 MiB (346.5 MB in decimal), so "330 MB" is the x64 figure in MiB. The server's `Content-Length` matches it exactly, and the server accepts byte ranges. The ARM64 file is smaller (329,660,576 bytes, 314.4 MiB), so take the size from the manifest, not a constant. (confirmed)
- **Anthropic's own script shows no progress at all.** It sets `$ProgressPreference = 'SilentlyContinue'`, and the docs say "The install command shows no progress while it downloads". The Installer's current wording ("Its progress shows below") is wrong today. (confirmed)
- **The signature does not have to be checked by the Installer.** `install.ps1` checks only the SHA-256 from the manifest. `manifestSignatureEnforcement` is a manifest field read by `claude.exe` itself, which verifies a separate signature file when it installs or updates. The Installer can match what the script does (SHA-256) and, if it wants more, check the Authenticode signature of the downloaded file ("Anthropic, PBC"). (confirmed for the script and docs; the field's exact meaning is unconfirmed)
- **`claude install` is not just a copy.** Anthropic's docs describe `claude install` as fetching a binary itself (three attempts, a 10-minute limit, a signature check). Whether it downloads again when it is run from a binary of the version it is asked to install is **unconfirmed**, and it can't be settled without running it. Plan for the possibility of a second 330 MB download, or test it on a throwaway machine. (unconfirmed)
- **The proxy problem is real, and bigger than `fetch`.** Node's `fetch` ignores the Windows proxy, and it ignores `HTTPS_PROXY` too unless it is switched on. `curl.exe` reads only environment variables. Windows PowerShell 5.1 (what `claude.js` uses) does follow the Windows proxy. `claude.exe` itself reads only environment variables. (confirmed by docs and a test, except that no real Windows proxy was available to test)
- **What a self-download must do that the script does for you:** pick the architecture (x64 or ARM64), refuse a non-version reply, delete a bad file, pass the channel to `claude install`, and clean up. It does **not** touch PATH: `claude install` only prints a note. The Installer already adds `~/.local/bin` to the user PATH itself, so that part is covered. (confirmed)

## The script, step by step (`https://claude.ai/install.ps1`)

I downloaded the script into a temporary folder and read it. It was not run. (confirmed, source: the script)

1. **Parameter.** `$Target` is `stable`, `latest` or an exact version such as `2.1.89` (validated by regex). The default is `latest`. `irm ... | iex` can't pass a parameter, so the docs use `& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable` to choose another.
2. **Quiet mode and 64-bit check.** `$ProgressPreference = 'SilentlyContinue'`. It stops if `[Environment]::Is64BitProcess` is false.
3. **Addresses.** `$DOWNLOAD_BASE_URL = https://downloads.claude.ai/claude-code-releases`; download folder `%USERPROFILE%\.claude\downloads`.
4. **Architecture.** `win32-arm64` if `$env:PROCESSOR_ARCHITECTURE` is `ARM64`, otherwise `win32-x64`. (The CMD installer, `bootstrap.cmd`, also checks `PROCESSOR_ARCHITEW6432`.)
5. **Version.** `GET {base}/latest` returns plain text such as `2.1.322`. **It always downloads `latest`, whatever the target**, "which has the most up-to-date installer". The reply must match `^\d+\.\d+\.\d+` or the script stops (this catches HTML error pages and region blocks).
6. **Manifest.** `GET {base}/{version}/manifest.json`. It reads `platforms.<platform>.checksum` and stops if there is none.
7. **Binary.** `GET {base}/{version}/{platform}/claude.exe` with `Invoke-WebRequest -OutFile %USERPROFILE%\.claude\downloads\claude-{version}-{platform}.exe`. On failure it deletes the partial file.
8. **Check.** SHA-256 of the file (`Get-FileHash`, lower-cased) must equal the manifest checksum, or the file is deleted and the script stops. Nothing else is checked.
9. **Install.** Prints "Setting up Claude Code...", then runs `<downloaded file> install <Target>`. It records `$LASTEXITCODE`.
10. **Clean-up.** In a `finally`, waits a second and deletes the downloaded file. A non-zero exit code from `claude install` fails the script; otherwise it prints "Installation complete!".

The script never edits PATH, never writes to `.local\bin`, and never records a channel itself. All of that is `claude install`'s work.

Other addresses, all under `https://downloads.claude.ai/claude-code-releases/` (confirmed by fetching them):

| Address | Reply |
| --- | --- |
| `latest` | `2.1.322` (plain text) |
| `stable` | `2.1.311` (plain text; about a week behind) |
| `2.1.322/manifest.json` | the manifest below |
| `2.1.322/win32-x64/claude.exe` | the binary, `Content-Length: 346496160`, `Accept-Ranges: bytes`, served from Google Cloud Storage |
| `2.1.322/manifest.json.sig` | detached GPG signature (the one the docs describe) |
| `2.1.322/manifest.json.raw-sig.json` | a second signature file in JSON, read by `claude.exe` (see below) |
| `2.1.322/manifest.zst.json` | a compressed-binary manifest, used by the Linux and macOS script, not the Windows one |

`https://claude.ai/install.cmd` redirects to `.../claude-code-releases/bootstrap.cmd`, a 220-line batch file that follows the same steps using `curl.exe`.

## The manifest

Real `manifest.json` for 2.1.322 (abridged), fetched from the address above (confirmed):

```json
{
  "version": "2.1.322",
  "manifestSignatureEnforcement": "flag",
  "commit": "660928a5946898d0c8d3488f20dd9b0b2da4ec09",
  "buildDate": "2026-11-10T00:53:25Z",
  "platforms": {
    "win32-x64":   { "binary": "claude.exe", "checksum": "345996b4...b298", "size": 346496160 },
    "win32-arm64": { "binary": "claude.exe", "checksum": "8e32c3f2...94c4", "size": 329660576 }
  },
  "sdkCompat": { "testedWrapperVersions": ["0.3.288", "..."], "harnessSchema": 1 }
}
```

(The real file also lists six macOS and Linux platforms.)

- `version`, `commit`, `buildDate`: what and when. `platforms.<name>`: `binary` is the file name, `checksum` is SHA-256 in lower-case hex, `size` is bytes. `sdkCompat` is for Anthropic's SDK wrappers and is irrelevant to the Installer.
- The manifest's own schema inside `claude.exe` (read from the shipped binary, not from documentation) declares `version`, `manifestSignatureEnforcement` (optional string), and per platform `checksum`, `size` (optional) and `binary` (optional). So `size` can in principle be missing: fall back to `Content-Length`, then to a spinner. (confirmed from the binary)
- The 2.1.322 `size` equals the file's `Content-Length` and the size of the installed `claude.exe` on a machine that has this version. (confirmed)

### `manifestSignatureEnforcement` and signatures

- **Not in the public docs.** The docs describe the GPG-signed manifest and say "verifying the signature on the manifest transitively verifies every binary it lists", but never mention this field. (confirmed that it is undocumented)
- **What I could establish from the shipped `claude.exe`** (strings in Anthropic's own binary, 2.1.322; this is evidence, not documentation):
  - When `claude install` or `claude update` fetches a release, it downloads `manifest.json` **and** `manifest.json.raw-sig.json`, then verifies an RSASSA-PKCS1-v1_5 / SHA-512 signature over the manifest bytes with a public key compiled into the binary. A failure prints "Release verification failed for Claude Code <version> (<reason>). The update was not installed." The docs list this message too.
  - Releases older than 2.1.207, requested by an explicit version, are allowed to be unsigned ("continuing with checksum-only verification"). Anything else needs the signature.
  - For some install paths the client compares the manifest's `manifestSignatureEnforcement` value with a client-side setting (the code has a constant `"flag"`) and refuses a release that "predates enforcement". Every current manifest says `"flag"`.
- **Not confirmed:** the field's precise meaning. My reading is that it tells the client how strictly to enforce the signature for that release, but no document says so.
- **Does the Installer have to check a signature? No, not to match Anthropic's own script.** `install.ps1` checks only the SHA-256 and trusts HTTPS. Options if more assurance is wanted, cheapest first:
  1. SHA-256 from the manifest (what the script does).
  2. Authenticode: the docs say the Windows binary is "signed by 'Anthropic, PBC'. Verify with `Get-AuthenticodeSignature .\claude.exe`". I checked the installed 2.1.322 binary: status Valid, subject `CN="Anthropic, PBC"`. (confirmed) The Installer would run PowerShell for this; needs a note on what to do if Windows can't reach its certificate revocation servers (the docs mention `CRYPT_E_NO_REVOCATION_CHECK`).
  3. GPG on `manifest.json.sig` with the key fingerprint `31DD DE24 DDFA B679 F42D 7BD2 BAA9 29FF 1A7E CACE`. I did this in a throwaway keyring and got "Good signature" for 2.1.322. (confirmed) Not practical for a Windows laptop with no `gpg`.
  4. Verify `manifest.json.raw-sig.json` in Node. The signed-message framing (a prefix `claude-code-manifest-v1\0` appears in the binary) and public key are not documented. Not recommended.
- Whatever the Installer does, `claude install` will verify the release again by itself if it downloads (see next section).

## Does `claude install` download again?

- **Help text** (`claude install --help`, run on a machine that already has 2.1.322): "Install Claude Code native build. Use [target] to specify version (stable, latest, or specific version)". Option `--force`: "Force installation even if already installed". (confirmed)
- **CLI reference:** "`claude install [version]`: Install or reinstall the native binary. Accepts a version like `2.1.118`, or `stable` or `latest`." (confirmed)
- **Troubleshooting page:** "The connection to the download server closed while `claude install` or `claude update` was fetching the Claude Code binary... retries the download when the connection drops, the transfer stalls, or the downloaded file fails its checksum, up to three attempts in total." A download that does not finish in 10 minutes fails ("exceeded the total deadline") and is not retried. So `claude install` has its own download code. (confirmed)
- **What it does with the binary it was run from:** `install.ps1` deletes the downloaded file afterwards, and on a machine with the native install, `%USERPROFILE%\.local\bin\claude.exe` has the same SHA-256 as the manifest and `.local\share\claude\versions\2.1.322` has the same size. So the end state is a verified copy of the release binary, which is consistent with both "copies itself" and "downloads again". (confirmed as evidence, not as proof)
- **Unconfirmed:** whether `claude install latest`, run from the 2.1.322 binary while 2.1.322 is the latest, skips the download. Anthropic does not document it and the source is not public. The binary has a "reverify" path that compares an existing binary in the versions folder, which hints at a skip, but that is a guess. **To settle it:** on a throwaway Windows machine, run the downloaded binary with `install latest` while watching network traffic (or with the network off after the manifest and signature are cached). I did not do this, because it would change installed software on this machine.
- **Consequence for the design.** If the Installer wants one download only, the options are: (a) accept that `claude install` may fetch again, with its own silent progress; (b) copy the verified file to `%USERPROFILE%\.local\bin\claude.exe` itself and skip `claude install`, which would lose whatever `claude install` records (the install method in `~/.claude.json` and the `versions` folder layout, which auto-update relies on) and is unsupported; (c) pass the exact version number of the file just downloaded and test whether that skips it. None of these is confirmed.

## Node's `fetch`, `curl.exe`, PowerShell and the proxy

| Client | Uses the Windows system proxy? | How to make it use a proxy | Status |
| --- | --- | --- | --- |
| Node `fetch` (undici) | **No.** | Environment variables only, and only when switched on: `NODE_USE_ENV_PROXY=1`, `--use-env-proxy`, or `http.setGlobalProxyFromEnv()` | confirmed (docs and test) |
| `curl.exe` (the one in `System32`) | **No, environment variables only** | `HTTPS_PROXY`/`http_proxy`/`ALL_PROXY`/`NO_PROXY`, or `--proxy` | confirmed for variables; "does not read the Windows setting" is unconfirmed (see below) |
| Windows PowerShell 5.1 `Invoke-WebRequest` / `Invoke-RestMethod` | **Yes**, the current user's Internet options | `-Proxy`, `-ProxyCredential`, `-ProxyUseDefaultCredentials` | confirmed (docs) |
| `claude.exe` (install, update, sign-in, API) | **No, environment variables only** | `HTTPS_PROXY` etc., or the `env` block in `settings.json` | confirmed (docs) |

### Node

- Node's built-in proxy support is documented only for environment variables: `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` (and lower-case). The text says: "if the `NODE_USE_ENV_PROXY` environment variable is set to `1` or `--use-env-proxy` is enabled, the global agent will be constructed with `proxyEnv: process.env`". It is **Stability 1.1 (active development)**, added in v24.5.0 and v22.21.0. (confirmed)
- `http.setGlobalProxyFromEnv([proxyEnv])` (added v25.4.0 and v24.14.0, so present in Node 26) "enable[s] built-in proxy support for `fetch()` and `http.request()`/`https.request()` at runtime". It takes an object, so the Installer could pass proxy values it found itself. Call it before any request. (confirmed)
- The Node 26 documentation mentions no Windows registry, WinINET or PAC support anywhere in this section. That is how I conclude `fetch` ignores the Windows proxy; I could not test against a real Windows system proxy, so that part is **unconfirmed by test**.
- **Test I ran** (Node 24.19, not 26, with `HTTPS_PROXY=http://127.0.0.1:9`, a port with nothing listening): with no opt-in, `fetch` connected straight to `downloads.claude.ai` and got status 200 (the proxy was ignored); with `NODE_USE_ENV_PROXY=1`, it failed with `ECONNREFUSED` (it tried the proxy). (confirmed on 24.19; Node 26 documentation says the same)
- So to make the Installer's `fetch` follow a proxy it would have to find the proxy itself (Windows keeps it in the user's Internet settings, or `netsh winhttp`), and then set `HTTPS_PROXY`/`NO_PROXY` for the process or call `http.setGlobalProxyFromEnv({HTTPS_PROXY: ...})`. Proxy auto-config (PAC) scripts and proxies that need Windows login (NTLM, Kerberos) are not covered by Node's support. (Node's documented formats are `http://`/`https://` proxy URLs with optional `user:password@`; I found nothing about NTLM or Kerberos, so that is unconfirmed.)

### curl.exe

- libcurl documentation: "libcurl respects the proxy environment variables named http_proxy, ftp_proxy, sftp_proxy etc." and "`all_proxy` is used if no protocol specific proxy was set". The documentation does not mention the Windows Internet settings. (confirmed for variables)
- **Test I ran:** `curl.exe` with `HTTPS_PROXY` pointing at the dead port failed with "Failed to connect to downloads.claude.ai:443 over proxy 127.0.0.1". (confirmed: it reads the variable)
- That `curl.exe` does not read the Windows proxy is **unconfirmed**: the absence from the documentation is the only evidence. The Installer's own bootstrap script says the same of `curl.exe`, so this agrees with the code survey.

### PowerShell

- The default proxy for .NET `WebRequest` (which Windows PowerShell 5.1's web cmdlets use) is documented: "The `DefaultWebProxy` property reads proxy settings from the app.config file. If there is no config file, the current user's Internet options proxy settings are used." (confirmed for the .NET property; that 5.1's cmdlets are built on it is my reading and is **unconfirmed** in a source I fetched)
- `install.ps1` passes no `-Proxy` or credential parameters, so a proxy that needs a login would most likely fail with a 407 error in it. (unconfirmed, reasoned)
- The Installer runs `powershell.exe` 5.1 (`System32\WindowsPowerShell\v1.0`). PowerShell 7 differs and was not checked. (unconfirmed)

### What this means for the whole install

- On a machine that has only the Windows proxy: the script's own downloads (PowerShell 5.1) can work, but `claude install` (which fetches `manifest.json`, `manifest.json.raw-sig.json` and possibly the binary) and `claude auth login` use `HTTPS_PROXY`. Anthropic's troubleshooting page tells people behind a corporate proxy to set `$env:HTTPS_PROXY` and `$env:HTTP_PROXY` "before installing". (confirmed that it says so; that the script's download would work with only the Windows proxy is reasoned, not tested)
- So a proxy fix is not only a `fetch` question: whatever proxy the Installer finds would have to be passed on to the `claude.exe` processes it starts too. That agrees with the map's note that the proxy affects every download (T3 Code's as well).
- Also relevant: the network page lists `storage.googleapis.com` for the native installer only "on versions prior to 2.1.116"; current versions use `downloads.claude.ai`. A firewall allow-list needs `downloads.claude.ai` (and `claude.ai`, `platform.claude.com`, `api.anthropic.com` for sign-in and use). (confirmed, network-config page)

## What a self-download would miss

| Thing | What the script / `claude install` does | Confirmed? |
| --- | --- | --- |
| PATH | **Neither adds `~/.local/bin` to PATH on Windows.** The docs: the installer "detects this case and reports it under `Setup notes:`... It prints the fix with that note but doesn't change PATH itself." The Installer already does this (`claude.js:50`) before anything else. | confirmed |
| `.local\bin` and `.local\share\claude\versions` | Created by `claude install`. `claude.exe` ends up at `%USERPROFILE%\.local\bin\claude.exe`. | confirmed (docs, observed on a real install) |
| Architecture | `win32-arm64` when `PROCESSOR_ARCHITECTURE` is `ARM64`, else `win32-x64`. Stops on a 32-bit PowerShell process (a 32-bit PowerShell on 64-bit Windows triggers this too). Node's `process.arch` is the architecture of the Node build, so a Node x64 build on an ARM64 laptop would say `x64`, like the script does. The Installer should choose on purpose which build to download. | confirmed (script); the emulation point is reasoned |
| Channel (`stable` / `latest`) | Always downloads the `latest` binary, then runs `claude install <Target>` with the target (`stable`, `latest` or a version). The channel chosen "becomes your default for auto-updates" (docs). The default is `latest`. A self-download that wants `stable` should read `.../stable` for the version and pass `stable` (or that version) to `claude install`, but note that the script itself would use the `latest` binary. | confirmed |
| Updates | The native install auto-updates in the background by default. The Installer should not disable it. Settings: `autoUpdatesChannel`, `DISABLE_AUTOUPDATER`. | confirmed |
| Git for Windows | Optional. Without it Claude Code uses PowerShell as its shell tool. | confirmed |
| Admin rights | Not needed; everything is under `%USERPROFILE%`. | confirmed |
| Bad replies | The script rejects a `latest` reply that is not a version number (an HTML error page, or a region block). A self-download should do the same before building the manifest address. | confirmed |
| Failure | Deletes a partial or bad file. Docs: antivirus scanning a partly downloaded file in `%USERPROFILE%\.claude\downloads` can cause "The process cannot access the file ... because it is being used by another process". Consider downloading to a temporary name and renaming when complete. | confirmed (docs) |
| Locked file | `claude install` renames an existing `claude.exe` to `claude.exe.old.<timestamp>` and moves the new one in. A running Claude Code can therefore be updated, and a failure can leave no `claude.exe` (docs have a recovery step). | confirmed (docs) |
| TLS | Windows PowerShell 5.1 may need TLS 1.2 enabled on some machines (docs, "TLS or SSL connection errors"). Node and `curl.exe` don't have that problem. | confirmed (docs) |
| Retries | The script has none. `claude install` retries up to three times and gives up after 10 minutes. Node has no resume, but the server supports `Range`, so the Installer could add one. | confirmed |

## Corrections to the code survey and the map

- The survey (`claude-install.md`) says Anthropic's installer "shows its progress"; the code comments and one test say the same. The script and docs say it shows none. These words need changing whatever else is decided. (confirmed)
- `claude.js` runs the script with `irm https://claude.ai/install.ps1 | iex`, which always means target `latest`. That is the current behaviour a self-download would be copying.

## Not settled, and what would settle it

1. **Does `claude install latest` download again?** Test on a throwaway machine with a network capture, or ask Anthropic (`anthropics/claude-code` issues).
2. **Exact meaning of `manifestSignatureEnforcement`.** Ask Anthropic; nothing in the docs.
3. **Windows system proxy with Node 26 and PowerShell 5.1.** Test on a laptop behind a real Windows proxy (York's network would be the real test).
4. **Authenticated proxies.** Whether the script's downloads work through one without extra parameters.
5. **ARM64 under x64 emulation.** What `PROCESSOR_ARCHITECTURE` shows to the Installer's Node process on an ARM64 laptop.

## Sources

Primary sources read for this note (all fetched on 12 November 2026):

- The install script: `https://claude.ai/install.ps1` (110 lines, 3,189 bytes), and for comparison `https://claude.ai/install.sh` and `https://claude.ai/install.cmd` (which redirects to `https://downloads.claude.ai/claude-code-releases/bootstrap.cmd`).
- Release files: `https://downloads.claude.ai/claude-code-releases/latest`, `.../stable`, `.../2.1.322/manifest.json`, `.../2.1.322/manifest.json.sig`, `.../2.1.322/manifest.json.raw-sig.json`, `.../2.1.322/win32-x64/claude.exe` (HEAD only), and the signing key `https://downloads.claude.ai/keys/claude-code.asc`.
- Claude Code documentation:
  - Advanced setup: https://code.claude.com/docs/en/setup (install commands, "shows no progress", channels, auto-update, binary integrity and code signing)
  - Troubleshoot installation and login: https://code.claude.com/docs/en/troubleshoot-install (PATH note, retries, "Release verification failed", Windows file lock, TLS)
  - Enterprise network configuration: https://code.claude.com/docs/en/network-config (proxy variables, allow-list)
  - CLI reference: https://code.claude.com/docs/en/cli-reference (`claude install [version]`)
- Node.js 26 documentation: https://nodejs.org/docs/latest-v26.x/api/http.html (Built-in Proxy Support; `http.setGlobalProxyFromEnv`), https://nodejs.org/docs/latest-v26.x/api/cli.html (`--use-env-proxy`, `NODE_USE_ENV_PROXY`).
- curl: https://curl.se/libcurl/c/CURLOPT_PROXY.html (environment variables) and https://curl.se/docs/manpage.html.
- Microsoft: https://learn.microsoft.com/en-us/dotnet/api/system.net.webrequest.defaultwebproxy and https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/invoke-webrequest?view=powershell-5.1.
- Evidence from a machine with Claude Code 2.1.322 already installed (read-only): `claude install --help`; the SHA-256 and size of the installed `claude.exe` against the manifest; its Authenticode signature; strings in the shipped binary for the manifest schema, `manifest.json.raw-sig.json`, and the verification messages. None of these ran an installer or changed anything.
- Own tests: `fetch` in Node 24.19 and `curl.exe` against a dead proxy address, with and without `NODE_USE_ENV_PROXY=1`.
- Context: the code survey, `research/installer-code-survey/claude-install.md` on the `research/installer-code-survey` branch.
