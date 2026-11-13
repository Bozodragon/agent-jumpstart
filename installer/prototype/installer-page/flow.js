// PROTOTYPE, throwaway. The fake run the page draws: one York laptop, first run.
//
// Each screen is one call the Installer would make on its front end (see the front-end seam,
// issue 64): start, ask.choose / confirm / pick / folder, step, busy, notice, waitForDone,
// the Claude sign-in on the page's screen, problem, summary, finish. The wording is the
// Installer's own, with the page's wording where the seam says the two front ends differ.
//
// The work screens are in the order installer/src/main.js does the work: the tools (Git),
// GitHub (not chosen, which the Installer only logs, so it has no screen), the skills, then
// Memory and the connectors (no screens here), the extra tools (Apps Script), Claude Code,
// and T3 Code last, because T3 Code opens over the page when it's installed.
window.FLOW = {
  title: 'Agent Jumpstart · York',
  // The page people have just come from, and go back to.
  setupPage: 'https://jumpstart-york.portall.dev/',
  person: 'sam.okafor@york.ac.uk',
  screens: [
    // ---- The questions. All come before anything is installed, so all can still be changed. ----
    // `short` is the answer's label in the page's panel of answers.
    {
      id: 'team',
      kind: 'choose',
      short: 'Team',
      message: 'Which team are you in?',
      options: [
        { value: 'sdo', label: 'Systems, Data and Operations' },
        { value: 'marketing', label: 'Marketing' },
        { value: 'another', label: 'Another team' },
      ],
      initial: 'another',
    },
    {
      id: 'aiExperience',
      kind: 'choose',
      short: 'AI tools',
      message: 'How much experience do you have using AI tools like ChatGPT, Claude, or Gemini?',
      options: [
        { value: 'first', label: 'This is my first time' },
        { value: 'dabbled', label: "I've dabbled a bit" },
        { value: 'confident', label: "I'm pretty confident" },
        { value: 'teach', label: 'I could teach you a thing or two' },
      ],
      initial: 'first',
    },
    {
      id: 'codingExperience',
      kind: 'choose',
      short: 'Code',
      message: 'Have you written code before?',
      options: [
        { value: 'no', label: 'No' },
        { value: 'little', label: 'A little', hint: 'spreadsheet formulas, mail merges' },
        { value: 'projects', label: 'A few small projects', hint: 'Apps Script, Python' },
        { value: 'work', label: "Yes, it's part of my work" },
      ],
      initial: 'no',
    },
    {
      id: 'topWorkspace',
      kind: 'choose',
      short: 'Top workspace',
      message: "Where's your top workspace? Your other workspaces go inside it.",
      options: [
        { value: 'new', label: 'Make a new one at G:\\My Drive\\Claude' },
        { value: 'another', label: 'Use another folder', hint: "you'll type where it is next" },
      ],
      initial: 'new',
    },
    {
      id: 'googleDriveFolder',
      kind: 'folder',
      short: 'Google Drive',
      message: 'Is this your Google Drive folder?',
      initial: 'G:\\My Drive',
      placeholder: 'G:\\My Drive',
      // What the Installer's own check says. Fake rule here: anything not starting with a drive letter is wrong.
      invalid: 'Give the whole path, starting with the drive letter.',
    },
    {
      id: 'github',
      kind: 'confirm',
      short: 'GitHub',
      message: 'Set up GitHub now? You can change this on a later run.',
      initial: false,
    },
    {
      id: 'connectors',
      kind: 'pick',
      short: 'Connectors',
      message: 'Which connectors?',
      // The terminal shows only the names. `hint` is each connector's line from the setup page, which a page has room for.
      options: [
        { value: 'Gmail', label: 'Gmail', hint: 'search and read your email, and write drafts for you to check and send' },
        { value: 'Google Drive', label: 'Google Drive', hint: 'search and read your files' },
        { value: 'Google Calendar', label: 'Google Calendar', hint: 'see your calendar and, when you ask, add or change events' },
        { value: 'Asana', label: 'Asana', hint: 'see your tasks and, when you ask, create or update them' },
        { value: 'Google Docs', label: 'Google Docs', hint: 'read and edit your docs when you ask' },
        { value: 'Google Sheets', label: 'Google Sheets', hint: 'read and edit your spreadsheets when you ask' },
        { value: 'Google Slides', label: 'Google Slides', hint: 'read and edit your slides when you ask' },
      ],
      initial: ['Gmail', 'Google Drive', 'Google Calendar', 'Google Docs', 'Google Sheets'],
    },

    // ---- The work. From here nothing can be changed: the answers are being acted on. ----
    // installTools
    {
      id: 'git',
      kind: 'step',
      // A plain line: something noted, with nothing to wait for.
      text: 'Using the Git already at C:\\Program Files\\Git',
    },
    // setUpGitHub: not chosen, so the Installer only writes it in the log. No screen.
    // installSkills
    {
      id: 'skills',
      kind: 'terminal',
      // The one step that shows a terminal: the skills installer's own output, so the person
      // has seen it before they ever add a skill themselves.
      message: 'Installing your skills',
      lede: 'This is the skills installer at work. Adding a skill yourself later looks just like this.',
      window: 'Skills installer',
      prompt: 'PS C:\\Users\\sam>',
      // MADE UP FOR THE PROTOTYPE. Plausible output of the `skills` CLI (`npx skills add`) for
      // York's four skill sources (profiles/york.json), not a recording: the counts found, the
      // wording and the layout are invented, and the banner is shown once where the real CLI
      // prints it on every run. The Installer really runs `skills add <source> -g -a claude-code
      // -y -s <names>`; the command is shown here the short way a person would type it.
      // Each line: [ms after the line before, text, kind]. kind: 'cmd' (typed at the prompt), 'banner'.
      output: [
        [200, 'npx skills add mattpocock/skills', 'cmd'],
        [460, ''],
        [40, '███████ ██   ██ ██ ██      ██      ███████', 'banner'],
        [40, '██      ██  ██  ██ ██      ██      ██', 'banner'],
        [40, '███████ █████   ██ ██      ██      ███████', 'banner'],
        [40, '     ██ ██  ██  ██ ██      ██           ██', 'banner'],
        [40, '███████ ██   ██ ██ ███████ ███████ ███████', 'banner'],
        [50, ''],
        [80, '┌   skills'],
        [40, '│'],
        [130, '◇  Source: https://github.com/mattpocock/skills.git'],
        [40, '│'],
        [720, '◇  Repository cloned'],
        [40, '│'],
        [200, '◇  Found 27 skills'],
        [40, '│'],
        [160, '●  Selected 16 skills for Claude Code'],
        [40, '│'],
        [520, '◇  Installed 16 skills'],
        [50, '│  ✓ ask-matt'],
        [50, '│  ✓ grilling'],
        [50, '│  ✓ grill-me'],
        [50, '│  ✓ grill-with-docs'],
        [50, '│  ✓ domain-modeling'],
        [50, '│  ✓ teach'],
        [50, '│  ✓ to-questionnaire'],
        [50, '│  ✓ handoff'],
        [50, '│  ✓ wait-what'],
        [50, '│  ✓ research'],
        [50, '│  ✓ wayfinder'],
        [50, '│  ✓ to-spec'],
        [50, '│  ✓ to-tickets'],
        [50, '│  ✓ setup-matt-pocock-skills'],
        [50, '│  ✓ prototype'],
        [50, '│  ✓ wizard'],
        [40, '│'],
        [130, '└  Done'],
        [260, ''],
        [200, 'npx skills add anthropics/skills', 'cmd'],
        [330, '┌   skills'],
        [100, '◇  Source: https://github.com/anthropics/skills.git'],
        [590, '◇  Repository cloned'],
        [160, '◇  Found 17 skills'],
        [130, '●  Selected 1 skill for Claude Code'],
        [330, '◇  Installed 1 skill'],
        [50, '│  ✓ frontend-design'],
        [130, '└  Done'],
        [260, ''],
        [200, 'npx skills add cursor/plugins/pstack/skills/unslop', 'cmd'],
        [330, '┌   skills'],
        [100, '◇  Source: https://github.com/cursor/plugins.git (pstack/skills/unslop)'],
        [520, '◇  Repository cloned'],
        [160, '◇  Found 1 skill'],
        [290, '◇  Installed 1 skill'],
        [50, '│  ✓ unslop'],
        [130, '└  Done'],
        [260, ''],
        [200, 'npx skills add Bozodragon/agent-jumpstart', 'cmd'],
        [330, '┌   skills'],
        [100, '◇  Source: https://github.com/Bozodragon/agent-jumpstart.git'],
        [460, '◇  Repository cloned'],
        [160, '◇  Found 1 skill'],
        [290, '◇  Installed 1 skill'],
        [50, '│  ✓ jumpstart'],
        [130, '└  Done'],
      ],
      // The Installer's own count for York: 16 + 1 + 1 + 1.
      done: { text: '19 skills installed', ok: true },
    },
    // switchOffAutoMemory, then walkThroughConnectors: no screens in the prototype.
    // setUpExtraTools (clasp is installed and signed in first; only its settings page is shown here)
    {
      id: 'appsScriptSetting',
      kind: 'waitForDone',
      // A notice the person acts on elsewhere, then says they have: the terminal's "Press Enter once…", the page's Done button.
      title: 'One setting only you can change',
      lines: [
        'On the Apps Script settings page, check your York account is the one shown at the top right. Then click Google Apps Script API and switch it on. Only you can change this setting.',
        'Then come back to the Installer page.',
      ],
      link: { label: 'Apps Script settings', url: 'https://script.google.com/home/usersettings' },
      what: "you've switched it on",
    },
    // setUpClaude
    {
      id: 'checkClaude',
      kind: 'busy',
      // A spinner only: no size is known. About 3 seconds in the prototype.
      message: 'Checking Claude Code',
      seconds: 3,
      done: { text: "Claude Code isn't on this laptop yet", ok: true },
    },
    {
      id: 'downloadClaude',
      kind: 'busy',
      // A progress bar: "Downloading Claude Code: N% of 330 MB". About 8 seconds in the prototype.
      message: 'Downloading Claude Code',
      totalMB: 330,
      seconds: 8,
      done: { text: 'Claude Code installed', ok: true },
    },
    {
      id: 'signIn',
      kind: 'signIn',
      // One screen: what's about to happen, the link the program printed, the wait, and a box that feeds its input.
      name: 'Claude Code',
      title: 'Sign in to Claude Code',
      lines: ['Claude Code signs you in next, in your browser.'],
      bullets: [
        "A new tab opens at Claude's sign-in page. Sign in there, then come back to this page: it carries on by itself.",
        'If the page shows a code, copy it, come back here and paste it into the box below.',
      ],
      linkLabel: 'If no tab opens, use this link',
      link: 'https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&scope=user%3Ainference',
      waiting: 'Waiting for you to sign in',
      checking: 'Checking the code',
      codeLabel: 'Code from the sign-in page',
      // In the prototype the first code pasted is rejected (leading to `signInProblem`), and the second is accepted.
      done: { text: 'Claude Code signed in as sam.okafor@york.ac.uk', ok: true },
    },
    {
      id: 'signInProblem',
      kind: 'problem',
      // A problem, then the choose the Installer asks straight after it.
      text: "Claude Code's sign-in said: that code wasn't accepted.",
      message: "Claude Code isn't signed in yet.",
      options: [
        { value: 'again', label: 'Try again', hint: 'a new link and code' },
        { value: 'skip', label: 'Skip for now', hint: 'the rest of the install carries on' },
      ],
      initial: 'again',
      // 'again' goes back to `signIn`, which then works. 'skip' carries on, and the ending says Claude Code didn't work.
    },
    // installT3: last, because T3 Code opens over the page when it's done. Then addToT3 adds the workspaces.
    {
      id: 'installT3',
      kind: 'busy',
      // The second spinner-only step, and a long message.
      message: "Installing T3 Code. This takes about a minute, and T3 Code opens by itself when it's done.",
      seconds: 5,
      done: { text: 'T3 Code installed', ok: true },
    },

    // ---- The ending. ----
    {
      id: 'ending',
      kind: 'ending',
      // The checklist: label and value, in the order the run does the work, so the page's
      // "Set up on this laptop" list fills in from the top. A value starting "Not" is a step that didn't work.
      checklist: [
        ['Git', 'Already there'],
        ['GitHub', 'Skipped for now'],
        ['Skills', 'All 19 installed'],
        ['Memory', 'Switched off'],
        ['Connectors', 'Gmail, Google Drive, Google Calendar, Google Docs and Google Sheets'],
        ['Apps Script', 'Installed, signed in'],
        ['Claude Code', 'Installed, signed in as sam.okafor@york.ac.uk'],
        ['T3 Code', 'Installed (Stable)'],
        ['Workspaces', 'Claude, Thinking space and Personal assistant, in T3 Code'],
      ],
      next: {
        title: 'What to do next',
        text: 'In T3 Code, open Claude, your top workspace, and start a new conversation there. Type /jumpstart and press Enter.',
      },
      closing: 'All done.',
      log: 'C:\\Users\\sam\\AppData\\Local\\agent-jumpstart\\logs\\install-2026-11-16-0932.log',
      // When the sign-in was skipped: the row, the failure repeated, and the closing line change.
      ifSignInSkipped: {
        row: ['Claude Code', 'Installed, not signed in'],
        problem: "Claude Code: Installed, not signed in. Claude Code's sign-in said: that code wasn't accepted.",
        next: "Paste the same line again to try again what didn't work. It skips everything that's already done.",
        closing: "One step didn't work: Claude Code.",
      },
    },
  ],
};
