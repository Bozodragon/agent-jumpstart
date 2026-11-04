# Jumpstart's pages load from the setup site

Jumpstart shows people pages in the chat, starting with the writing picker. The agent used to write each page out in full with T3 Code's page tools. The writing picker is about 24 KB, and the skill had the agent write it twice, once to preview it for its height and once to render it. People waited 2.5 to 4 minutes for it. We decided that each page's template is published with the setup site (`page/build.js` copies it into every profile's site, under `jumpstart/`), and that the agent writes only a small page that loads the template from the profile's setup site with a script tag and carries a few lines of data. The page is rendered once, with no preview step, because T3 Code's render tool fits the frame to the page itself.

The render frame allows this. A script from cdnjs loads there. A script from the setup site's own host gets a plain 404 while the template isn't published (the address redirects to Portall and Portall answers), with no content-security or sandbox error, so that host isn't blocked.

## Considered options

- **Keep writing the page out, but only once.** This halves the wait, but it's still a minute or more of output, and every page we add makes it worse.
- **Shrink the page.** Fewer examples and less styling would shorten the wait, but the examples are what make the picker useful.
- **Load the template from the skill's own folder.** T3 Code's page tools inline only local images, not scripts, so a template on the laptop can't be loaded by the page; the agent would have to read and write it out again.
- **Load the template from a public CDN of the GitHub repo (jsDelivr).** No publish step, but it ties the pages to a third party's cache of the repo, and York's network or blockers may treat it differently from the setup site people already open.

## Consequences

- **Released together.** A template's source lives next to the skill (`skills/jumpstart/`), so the template and the instructions that use it change in one commit. The skill reaches people from GitHub's `main` when the skills CLI installs it, and the template reaches them when the setup site is published, so publish the setup site (`npm run publish:page`) whenever a merge to `main` changes a template. Keep what a small page passes to its template working across one release, for a person whose skill is a version behind the site.
- **No setup site.** If the template can't be loaded (no network, the site is down, or a blocker stops it), the page shows one line saying so, and Jumpstart asks the same question in the chat instead and carries on. The setup still finishes.
- **The setup site becomes a dependency of Jumpstart,** not only a page people read. Moving its address means updating the addresses the skill names for each profile.
