# The setup page

The page a team member follows along with, and comes back to as a reference. "Set up" has the three steps: paste the line, type `/jumpstart` in their top workspace, and start work in the workspace it belongs to. "When you need it" has the reference sections, each closed until opened: What Jumpstart does, Your privacy, Your workspaces, Your skills, Your connectors, Finding your way round T3 Code, If something went wrong (with the share-log line and where to send the log), and Why T3 Code rather than the Claude app?. The installer doesn't open it.

`template.html` is the one source. `build.js` renders it once per profile, filling it in from `profiles/<id>.json`:

| Key | What the page does with it |
| --- | --- |
| `pastedLine` | The one line to paste, in step 1. |
| `shareLogLine` | The line under "If something went wrong". |
| `logGoesTo` | Who to send the log to, as it reads after "send it to". |
| `logEmail` | Optional. With it, "If something went wrong" links to a Gmail draft to this address instead of only naming `logGoesTo`. |
| `workspaces.top` | The top workspace's folder name (`{{topWorkspace}}`), which step 2 says T3 Code already lists and "Your workspaces" draws at the top of its tree. The installer creates that folder. |
| `connectors` | Each connector's `name` and `what`, listed under "Your connectors". |
| `connectorsPage` | claude.ai's Connectors page, linked from the steps for reconnecting a connector. |
| `setupPage.workspaces` | `heading` and `text`: the paragraph that ends "Your workspaces", saying where they are and why ("Why Google Drive?" for York; Documents only for the default profile). |
| `setupPage.whyT3Code` | The paragraphs under "Why T3 Code rather than the Claude app?". York's names the admin rights its laptops don't give; the default profile's leaves that out. |
| `setupPage.privacy` | The paragraphs under "Your privacy". Keep them to what Anthropic's own pages say, quoting them where it matters, and check them again when those pages change. |

The `setupPage` texts are plain text with two marks: `**words**` for bold and `[words](https://address)` for a link, which opens in a new tab. Everything else is shown as written. Adapting the page for a new team is an edit to its profile, not to the template.

`skills.json` holds "Your skills": the four headings, and under each the skills in order, each with a line of about ten words and `text`, the address of its own `SKILL.md` in the source it's installed from. The build refuses a skill that a profile doesn't install (a name in its `skills`, or the last part of a one-skill source).

Our own text never says "project": a workspace is a "workspace", and what's in one is "work" or "a piece of work". The one exception is the sentence in "Finding your way round T3 Code" saying T3 Code calls workspaces "projects". That includes the profiles' wording, and the tests count it.

"Finding your way round T3 Code" (`id="t3-code"`) and "Your workspaces" (`id="workspaces"`, with the workspaces demo in its `.demo-slot`) are where the labelled screenshots and the demo go.

The workspaces demo is ported from its prototype ("What it sees"): drag the agent onto a workspace and it lights the agent instructions it follows from the start (that workspace's and every one above it), what it looks through first (everything inside it), and, dashed, the files those instructions point to. Its styles are in the page's `<style>` and its script sits in the slot, so each page stays one file. The example tree is the nested list in the slot, which is also what shows if the script doesn't run: each `li[data-node]` is a workspace, with `data-instr` for its agent instructions, `data-points` for the files they point to and `data-files` for the rest (`|` between names); `data-work` marks a piece of work, and `data-top` the top workspace, named from the profile. The script reads the list and draws the tree you drag onto, so changing the example is an edit to the list, plus the notes in the script that name its workspaces. The tests check the demo's text is on both pages; the dragging is checked by hand in a browser, with a mouse and at phone width.

```
npm run build:page      # renders dist/page/<profile>/index.html, with Jumpstart's templates beside it
npm run publish:page    # renders, then publishes each page as a public Portall item
```

Each page is published as the item named by the first part of its profile's `page` address, so `https://jumpstart-york.arcforge.uk/` is the item `jumpstart-york` and `https://jumpstart.arcforge.uk/` is `jumpstart`. The publish stops if Portall prints a different address.

The build refuses a page that doesn't show its own line exactly once, shows another profile's line, leaves a `{{placeholder}}` unfilled, or lacks one of the keys above. `installer/test/page.test.js` renders both pages and checks the lines, the order of the steps and sections, each section's text in that profile's wording, every skill under its heading with its link, the one "projects", where to send the log, and that none of the old setup page's steps are back.

## The two lines

The install line and the share-log line are shown the same way, and neither has a Copy button. No script on the page writes to the clipboard, because uBlock Origin's default list blocks pages that put an `irm ... | iex` line there while the browser still reports success. Instead, one click anywhere in a line's box selects the whole line (the page's script only selects the text; it reads and writes nothing), and the box says "Click the line, then press Ctrl+C". Selecting it yourself and pressing Ctrl+C always gets through.

Each box also has a "See what this runs" link. The build takes the address out of the line (`irm <address> | iex`) and links to it, so the link is that profile's script for the install line and `share-log.ps1` for the share-log line. The build fails if a line isn't in that form.

Under the install line the page warns that nothing may appear for up to half a minute after pasting: that wait is Windows PowerShell fetching the script, before the installer's own code runs.

## Jumpstart's templates

The build also copies Jumpstart's page templates into every profile's site, under `jumpstart/`, so `https://jumpstart-york.arcforge.uk/jumpstart/writing-picker.js` is the writing picker for York and `jumpstart/review-page.js` beside it is the review page, where the person checks what Jumpstart found. Jumpstart writes only a small page that loads its template from there, with any data it needs (the review page's Findings, as JSON), instead of writing the whole page out ([ADR 0001](../docs/adr/0001-jumpstart-pages-load-from-the-setup-site.md)). A template's source is beside the skill, in `skills/jumpstart/`, so it changes in the same commit as the instructions that use it. The skill reaches people from `main` and the templates from this site, so run `npm run publish:page` whenever a merge to `main` changes a template. `installer/test/page.test.js` checks that each profile's build holds them.
