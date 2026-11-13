# Agent Jumpstart

Sets a team member up to work with an agent: one pasted line installs everything on their laptop, and a skill they run once sets up their workspaces.

## Getting started

**Pasted line**:
The one line a team member pastes into Windows PowerShell to start everything. Each profile has its own.
_Avoid_: install command, the command

**Bootstrap**:
What the pasted line fetches and runs first: it gets Node.js and the Installer, then starts the Installer.
_Avoid_: install script

**Installer**:
The program the Bootstrap starts, which asks its questions and puts everything on the laptop.
_Avoid_: the script, setup script

**Re-run**:
Pasting the line again on a laptop the Installer has already set up.

**Jumpstart**:
The skill a team member runs once in T3 Code, after the Installer, to set up their workspaces.

## What a team member sees

**The window**:
The PowerShell window the line was pasted into, titled Agent Jumpstart.
_Avoid_: the blue window, the console

**Front end**:
How the Installer shows its questions and progress to a person. There are two: the terminal front end and the page front end.

**Terminal front end**:
The Installer drawn in the window. It's the fallback when the Installer page can't be used.

**Page front end**:
The Installer drawn in the browser, as the Installer page.

**Installer page**:
The Installer as a page in the browser, with its questions, progress, sign-in code box and ending.
_Avoid_: setup page, web installer

**Setup page**:
A profile's web page that shows its pasted line and is the reference people come back to.
_Avoid_: Installer page, landing page

## What gets set up

**Profile**:
The setup for one organisation, or for one department within it, chosen by which pasted line is used. It lists the workspaces, connectors, extra tools and skills on offer.
_Avoid_: config, organisation settings

**Team**:
A group within the department or organisation a profile serves, chosen by the Installer's first question. It adds connectors, extra tools and skills to its profile's, and can tick ones the profile leaves unticked.
_Avoid_: department, area of work

**Experience questions**:
The Installer's questions, after the team, about how used a team member is to AI tools and to writing code. They decide which later questions are asked and what those questions start with.
_Avoid_: level, skill level

**Connector**:
A claude.ai connection to another service, such as Gmail or Asana, which a team member connects themselves on claude.ai.

**Extra tool**:
An optional tool the Installer installs and signs in to, such as clasp for Apps Script, or the MCP servers that read Google Analytics and Search Console.

**MCP server**:
A program the Installer installs and adds to Claude Code's settings so the agent can read another service, such as Google Analytics. Nobody connects it on claude.ai, and it reaches Claude Code and T3 Code but not claude.ai.
_Avoid_: connector, local connector

**Workspace**:
A folder the agent works in for one area of work, with its own agent instructions.

**Top workspace**:
The workspace that holds a team member's other workspaces.
