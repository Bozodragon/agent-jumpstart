# The setup page

The page a team member follows along with: paste the line, type `/jumpstart` in their top workspace, open Personal assistant and start a conversation, plus "If something went wrong" with the share-log line. The installer opens it as it starts.

`template.html` is the one source. `build.js` renders it once per profile, filling in four keys from `profiles/<id>.json`:

| Key | What the page does with it |
| --- | --- |
| `pastedLine` | The one line to paste, in step 1. |
| `shareLogLine` | The line under "If something went wrong". |
| `logGoesTo` | Who to send the log to, as it reads after "send it to". |
| `workspaces.top` | The top workspace's folder name (`{{topWorkspace}}`), which step 2 says T3 Code already lists. The installer creates that folder. |

```
npm run build:page      # renders dist/page/<profile>/index.html
npm run publish:page    # renders, then publishes each page as a public Portall item
```

Each page is published as the item named by the first part of its profile's `page` address, so `https://jumpstart-york.arcforge.uk/` is the item `jumpstart-york` and `https://jumpstart.arcforge.uk/` is `jumpstart`. The publish stops if Portall prints a different address.

The build refuses a page that doesn't show its own line exactly once, shows another profile's line, or leaves a `{{placeholder}}` unfilled. `installer/test/page.test.js` renders both pages and checks the lines, the order of the steps, and that none of the old setup page's steps are back.
