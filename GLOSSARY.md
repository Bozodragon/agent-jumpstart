# Agent Jumpstart

Sets a team member up to work with an agent: one pasted line installs everything on their laptop, and a skill they run once sets up their workspaces.

## Getting started

**Pasted line**:
The one line a team member pastes into Windows PowerShell to start everything. Each profile has its own.
_Avoid_: install command, the command

**Bootstrap**:
What the pasted line fetches and runs first. It gets Node.js and the Installer, starts the Installer out of sight and hands over to the Installer page. If no page connects, it runs the Installer in the window instead.
_Avoid_: install script

**Installer**:
The program the Bootstrap starts, which asks its questions and puts everything on the laptop.
_Avoid_: the script, setup script

**Re-run**:
Pasting the line again on a laptop the Installer has already set up. It keeps the saved answers and asks what to change.

**Answers file**:
A file of answers given to the Installer instead of a person, used by the tests and by runs nobody watches. Such runs use the terminal front end.

**Jumpstart**:
The skill a team member runs in their top workspace, first after the Installer and again whenever they want to update what it set up. It learns who they are, asks only what it can't find out, and writes the agent instructions for their workspaces. Typed as `/jumpstart`.
_Avoid_: setup skill, onboarding skill

## What a team member sees

**The window**:
The PowerShell window the line was pasted into, titled Agent Jumpstart. It closes itself once the Installer page has connected, and stays only when the Installer runs in it.
_Avoid_: the blue window, the console

**Front end**:
How the Installer shows its questions and progress to a person. There are two: the terminal front end and the page front end.

**Terminal front end**:
The Installer drawn in the window. It's the fallback when the Installer page can't be used, and what answers-file runs, the tests and `--terminal` use.

**Page front end**:
The Installer drawn in the browser, as the Installer page.

**Installer page**:
The Installer as a page in an app window, with its questions, progress, sign-ins, a Details panel, a Stop button and the ending.
_Avoid_: setup page, web installer

**App window**:
A browser window with no address bar and no tabs, opened from the person's own Chrome or Edge with their signed-in profile. The Installer page shows in it.
_Avoid_: popup, tab, Chrome window

**Details panel**:
The Installer page's panel, opened from the progress dashes, that lists the answers given so far and what's been set up on this laptop. Answers can be changed from it only while the questions are going.

**Setup page**:
A profile's web page that shows its pasted line and the steps from there to a first conversation. It's also the reference people come back to: what Jumpstart does, how workspaces fit together, their skills and connectors, and what to do when something goes wrong.
_Avoid_: Installer page, landing page, jumpstart page

**Findings**:
What Jumpstart's research learned about a person and their work, before the person has checked it.
_Avoid_: profile, research report

**Review page**:
The page where the person checks Jumpstart's findings before anything is kept.
_Avoid_: profile page

## What gets set up

**Profile**:
The setup for one organisation, or for one department within it, chosen by which pasted line is used. It lists the workspaces, connectors, extra tools and skills on offer and, for some, the teams it serves. Never what Jumpstart learns about a person: those are findings.
_Avoid_: config, organisation settings

**Team**:
A group within the department or organisation a profile serves, chosen by the Installer's first question. It adds connectors, extra tools and skills to its profile's, and can tick ones the profile leaves unticked. Another team, the default and last choice, adds nothing.
_Avoid_: department, area of work

**Experience questions**:
The Installer's questions, after the team, about how used a team member is to AI tools and to writing code. They decide which later questions are asked and what those questions start with.
_Avoid_: level, skill level

**Connector**:
A claude.ai connection to another service, such as Gmail or Asana, which a team member connects themselves on claude.ai.
_Avoid_: integration, plugin

**Extra tool**:
An optional tool the Installer installs and signs in to, such as clasp for Apps Script.

**MCP server**:
A program the Installer would install and add to Claude Code's settings so the agent can read another service. Nobody connects it on claude.ai, and it reaches Claude Code and T3 Code but not claude.ai. None ships yet: the first planned is Google Analytics for Marketing.
_Avoid_: connector, local connector

## Working with an agent

**Workspace**:
A folder the agent works in for one area of work, such as event management or email campaigns, with its own agent instructions. Workspaces sit inside one another. Google's product is always written in full as "Google Workspace".
_Avoid_: project (T3 Code's word for it), project folder, repo

**Top workspace**:
The workspace that holds a team member's other workspaces, whose agent instructions apply in every one of them. It's where things get set up, not where work happens.
_Avoid_: Claude workspace, root workspace

**Agent instructions**:
The instructions an agent reads at the start of every session in a workspace, including those of the workspaces above it.
_Avoid_: standing instructions, system prompt, rules, memory

**Personal assistant**:
The workspace for a person's own organisation and admin: their messages, calendar and tasks. PA for short. Other work belongs in its own workspace.
_Avoid_: assistant (on its own), day-to-day, chief of staff

**Thinking space**:
The workspace for getting ideas out of your head and into somewhere you can come back to them.
_Avoid_: ADHD workspace, brain dump
