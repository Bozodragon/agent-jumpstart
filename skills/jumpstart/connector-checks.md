# Connector checks

The one harmless read that checks each connector works, made in step 2 of `SKILL.md`, before the other questions. Each heading is a connector's name exactly as it appears in the installer's settings file. This is the only place the reads live: edit them here, and add a heading when a profile offers a new connector.

A connector's tools are named `mcp__claude_ai_` followed by its name with spaces turned into underscores, such as `mcp__claude_ai_Google_Calendar__...`. Use the tool that does the read described; every read here touches only names and titles, and changes nothing.

## Gmail

List their labels. Open no message: this checks the link without reading their email, whatever they chose in step 3.

## Google Calendar

List their calendars, or, if it can't, today's events. Keep to the titles.

## Google Drive

Search their Drive for the one file they changed most recently. Take its title; leave the file unopened.

## Asana

Asana's connector is tied to the one workspace chosen when it was connected, and its project and task tools take no workspace: they read that one. It's easy to choose the wrong one, because Asana makes a workspace named after the organisation's email domain for everyone with an address there (york.ac.uk at York), and that's almost never where a team's tasks are. So this check goes further than a read:

1. **The workspace.** Call `mcp__claude_ai_Asana__asana_list_workspaces`; each workspace's name is `name` in `data`. Ask with a single-select question card headed "Asana": "Your Asana is connected to [workspace name]. Is that where your team's tasks are?", with **Yes, that's the one** and **No, it's a different one**. If it lists more than one, name them all and ask whether their team's tasks are in one of them.
   - **york.ac.uk:** if the workspace is `york.ac.uk` and their `profile` is `york`, add, before the question: "Asana makes york.ac.uk for everyone with a York email address, so it's usually not where a team's tasks are."
   - **The default profile:** if the workspace's name is their email's domain (the part of `email` after the @), add instead: "Asana makes that one for everyone with your organisation's email address, so it's usually not where a team's tasks are."
2. **The fix,** if the answer is no (anything short of a clear yes), word for word:
   1. On claude.ai's Connectors page, disconnect Asana and connect it again.
   2. Choose your team's workspace at the top of Asana's page.
   3. Start a new thread.

   Then say they can type `/jumpstart` in the new thread once it's done, or carry on here without Asana. If they carry on, the result is **Not working** ("connected to the wrong Asana workspace") and Asana stays out of the research.
3. **The final check,** once they've said yes: look for Asana projects they're a member of and tasks assigned to them, taking only names and counts, opening nothing.
   - Projects: `mcp__claude_ai_Asana__asana_get_projects` with `limit: 100` and `opt_fields: "name,members.email"`; count those whose members include their `email`.
   - Tasks: `mcp__claude_ai_Asana__asana_search_tasks` with `assignee_any: "me"`, `completed: false` and `limit: 1`. If it fails because the workspace hasn't got Asana's paid search, use `mcp__claude_ai_Asana__asana_get_tasks` with `assignee: "me"` and `limit: 1` instead.

   If there are neither, say: "I can't find any of your projects or tasks in [workspace name]. If your team's work is in a different Asana workspace, here's how to switch:" and give the fix above, with what follows it. Otherwise Asana is **Working**.

## Google Docs

Find one document of theirs by listing or searching. Take its title; leave the document unopened.

## Google Sheets

Find one spreadsheet of theirs by listing or searching. Take its title; leave the spreadsheet unopened.

## Google Slides

Find one presentation of theirs by listing or searching. Take its title; leave the presentation unopened.
