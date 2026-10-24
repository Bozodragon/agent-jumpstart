# Connector checks

The one harmless read that checks each connector works, made in step 10 of `SKILL.md`. Each heading is a connector's name exactly as it appears in the installer's settings file. This is the only place the reads live: edit them here, and add a heading when a profile offers a new connector.

A connector's tools are named `mcp__claude_ai_` followed by its name with spaces turned into underscores, such as `mcp__claude_ai_Google_Calendar__...`. Use the tool that does the read described; every read here touches only names and titles, and changes nothing.

## Gmail

List their labels. Open no message: this checks the link without reading their email, whatever they chose in step 3.

## Google Calendar

List their calendars, or, if it can't, today's events. Keep to the titles.

## Google Drive

Search their Drive for the one file they changed most recently. Take its title; leave the file unopened.

## Asana

List their Asana workspaces.

## Google Docs

Find one document of theirs by listing or searching. Take its title; leave the document unopened.

## Google Sheets

Find one spreadsheet of theirs by listing or searching. Take its title; leave the spreadsheet unopened.

## Google Slides

Find one presentation of theirs by listing or searching. Take its title; leave the presentation unopened.
