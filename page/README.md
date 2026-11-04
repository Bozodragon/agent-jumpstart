# The setup page

The page a team member follows along with: paste the line, type `/jumpstart` in their top workspace, open Personal assistant and start a conversation, plus "If something went wrong" with the share-log line. The installer doesn't open it.

`template.html` is the one source. `build.js` renders it once per profile, filling in four keys from `profiles/<id>.json`:

| Key | What the page does with it |
| --- | --- |
| `pastedLine` | The one line to paste, in step 1. |
| `shareLogLine` | The line under "If something went wrong". |
| `logGoesTo` | Who to send the log to, as it reads after "send it to". |
| `logEmail` | Their email address. The page links to a Gmail draft to it and shows it. The log-sharing line names the same person and address, from the same profile. |
| `workspaces.top` | The top workspace's folder name (`{{topWorkspace}}`), which step 2 says T3 Code already lists. The installer creates that folder. |

```
npm run build:page      # renders dist/page/<profile>/index.html
npm run publish:page    # renders, then publishes each page as a public Portall item
```

Each page is published as the item named by the first part of its profile's `page` address, so `https://jumpstart-york.arcforge.uk/` is the item `jumpstart-york` and `https://jumpstart.arcforge.uk/` is `jumpstart`. The publish stops if Portall prints a different address.

The build refuses a page that doesn't show its own line exactly once, shows another profile's line, or leaves a `{{placeholder}}` unfilled. `installer/test/page.test.js` renders both pages and checks the lines, the order of the steps, and that none of the old setup page's steps are back.

## The two lines

The install line and the share-log line are shown the same way, and neither has a Copy button. No script on the page writes to the clipboard, because uBlock Origin's default list blocks pages that put an `irm ... | iex` line there while the browser still reports success. Instead, one click anywhere in a line's box selects the whole line (the page's script only selects the text; it reads and writes nothing), and the box says "Click the line, then press Ctrl+C". Selecting it yourself and pressing Ctrl+C always gets through.

Each box also has a "See what this runs" link. The build takes the address out of the line (`irm <address> | iex`) and links to it, so the link is that profile's script for the install line and `share-log.ps1` for the share-log line. The build fails if a line isn't in that form.

Under the install line the page warns that nothing may appear for up to half a minute after pasting: that wait is Windows PowerShell fetching the script, before the installer's own code runs.
