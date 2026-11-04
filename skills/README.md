# Skills

Skills the installer installs from this repo with the skills CLI, listed in each profile's `skills`.

| Skill | What it's for |
| --- | --- |
| `jumpstart/` | Run once as `/jumpstart` in the top workspace: learns who the person is, shows the profile for approval, then writes their workspaces, adds them to T3 and checks their connectors. Its help categories are in `jumpstart/help-categories.md`, the research prompt in `jumpstart/research-brief.md`, the writing picker in `jumpstart/writing-picker.js` and the review page in `jumpstart/review-page.js` (both published with the setup site, which the skill's small pages load them from; see `page/README.md`), the top workspace's rules in `jumpstart/agent-instructions.md`, each workspace's template in `jumpstart/workspaces/<workspace name>.md` (add a file named after a new workspace), and each connector's check in `jumpstart/connector-checks.md`. |
