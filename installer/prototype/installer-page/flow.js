// PROTOTYPE, throwaway. The fake run every variant draws: one York laptop, first run.
//
// Each screen is one call the Installer would make on its front end (see the front-end seam,
// issue 64): start, ask.choose / confirm / pick / folder, step, busy, notice, waitForDone,
// the Claude sign-in on the page's screen, problem, summary, finish. The wording is the
// Installer's own, with the page's wording where the seam says the two front ends differ.
// A variant decides how each is drawn, and may group, collapse or keep them on screen as it likes.
window.FLOW = {
  title: 'Agent Jumpstart · York',
  // The page people have just come from, and go back to.
  setupPage: 'https://jumpstart-york.portall.dev/',
  person: 'sam.okafor@york.ac.uk',
  screens: [
    // ---- The questions. All come before anything is installed. ----
    {
      id: 'team',
      kind: 'choose',
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
      message: 'Is this your Google Drive folder?',
      initial: 'G:\\My Drive',
      placeholder: 'G:\\My Drive',
      // What the Installer's own check says. Fake rule here: anything not starting with a drive letter is wrong.
      invalid: 'Give the whole path, starting with the drive letter.',
    },
    {
      id: 'github',
      kind: 'confirm',
      message: 'Set up GitHub now? You can change this on a later run.',
      initial: false,
    },
    {
      id: 'connectors',
      kind: 'pick',
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

    // ---- The work. The person watches; nothing to answer until the sign-in. ----
    {
      id: 'git',
      kind: 'step',
      // A plain line: something noted, with nothing to wait for.
      text: 'Using the Git already at C:\\Program Files\\Git',
    },
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
      id: 'signInNotice',
      kind: 'notice',
      title: 'Sign in to Claude Code',
      lines: ['Claude Code signs you in next, in your browser.'],
      bullets: [
        "A new tab opens at Claude's sign-in page. Sign in there, then come back to the Installer page: it carries on by itself.",
        'If no tab opens, use the link below.',
        'If the page shows a code, copy it, come back here and paste it into the box.',
      ],
    },
    {
      id: 'signIn',
      kind: 'signIn',
      // The page's screen for a program: the link the program printed, a box that feeds its input, and a wait.
      name: 'Claude Code',
      link: 'https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&scope=user%3Ainference',
      waiting: 'Waiting for you to sign in',
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
    {
      id: 'installT3',
      kind: 'busy',
      // The second spinner-only step, and a long message.
      message: "Installing T3 Code. This takes about a minute, and T3 Code opens by itself when it's done.",
      seconds: 5,
      done: { text: 'T3 Code installed', ok: true },
    },
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

    // ---- The ending. ----
    {
      id: 'ending',
      kind: 'ending',
      // The checklist: label and value. A value starting "Not" is a step that didn't work.
      checklist: [
        ['Git', 'Already there'],
        ['Claude Code', 'Installed, signed in as sam.okafor@york.ac.uk'],
        ['T3 Code', 'Installed (Stable)'],
        ['GitHub', 'Skipped for now'],
        ['Workspaces', 'Claude, Thinking space and Personal assistant, in T3 Code'],
        ['Connectors', 'Gmail, Google Drive, Google Calendar, Google Docs and Google Sheets'],
        ['Apps Script', 'Installed, signed in'],
        ['Skills', '17 installed'],
        ['Memory', 'Switched off'],
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
