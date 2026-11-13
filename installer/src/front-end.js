// The front end: what the person sees and answers. It's a dependency passed in, like `machine`:
// `main` creates one, and each step gets it in the context it already takes (`context.frontEnd`).
// Nothing else draws, asks or prints. There are two: the terminal front end (terminal.js) and the
// Installer page (installer-page.js), behind the same interface, so a step never checks which one
// it has, except a sign-in, whose steps differ on the page, which picks its version by `inWindow`.
//
// Words a step passes in name neither a key nor the window: how to accept a default, what to
// press once something's done and where to come back to are each front end's own to say.

/**
 * Where programs run "on screen" show what they print and read what the person types. The
 * machine starts such a program with the screen's `stdio`, then attaches it; it never decides
 * where a program's output goes. The terminal's screen is the window itself: `inherit`, or
 * `inherit` with the output piped, kept by the caller and passed on to the window as it comes.
 * @typedef {object} Screen
 * @property {(keep: boolean) => import('node:child_process').StdioOptions} stdio How to start a
 *   program on the screen. With `keep`, its stdout and stderr must be pipes, which the caller
 *   reads too.
 * @property {(child: import('node:child_process').ChildProcess) => void} attach Joins a program,
 *   just started with `stdio`, to the screen: whatever of it is piped is relayed. Called before
 *   the caller listens for the program closing.
 * @property {(text: string) => void} write Shows text as a program on the screen would print it.
 *   For the fake machine, whose runs print their recorded output here.
 */

/**
 * How far something slow has got, such as a download: `received` bytes so far, of `total` when
 * the total is known. It may be called very often (once per piece of a download), with the same
 * figures more than once, so a front end shows only what has changed. Nothing it's told is logged.
 * @typedef {(received: number, total?: number) => void} Progress
 */

/**
 * What a sign-in in the person's browser needs them to have, taken from its program's output as
 * it comes. Each `show` adds to what's there.
 * @typedef {object} SignInShown
 * @property {{ url: string, label: string }} [link] An address to open, such as the program's
 *   own address for when the browser didn't open by itself. `label` says when to use it.
 * @property {string} [code] A code to copy into the browser, such as GitHub's one-time code.
 * @property {(code: string) => string | undefined} [codeBox] A box to paste a code into, which
 *   goes to the program's input as a line once this finds nothing wrong with it (it's given the
 *   code trimmed, and returns why it won't do, if it won't). The first code it takes is the only one.
 */

/**
 * @typedef {object} Links
 * @property {string} [setupPage] The profile's setup page, which the person came from.
 * @property {string} [shareLogLine] The line that copies the newest installer log, for asking for help.
 */

/**
 * @typedef {object} FrontEnd
 * @property {(title: string, links?: Links) => void} start The run's first words. `links` are
 *   the profile's, for a front end that shows them (the page does; the terminal doesn't).
 * @property {(text: string) => void} step A line saying what's happening.
 * @property {<T>(message: string, task: (progress: Progress) => Promise<T>, ended?: (result: T) => { text: string, ok?: boolean }) => Promise<T>} busy
 *   Shows that something slow is under way while `task` runs, then how it ended (`ended`, or
 *   the message, if not given): done (`ok` true), failed (false), or, with no `ok`, simply over,
 *   with no mark either way (a step that gave way quietly to another, such as Claude Code's own
 *   download to Anthropic's script). Nothing else may be shown while it runs. The task may report
 *   how far it has got through `progress` (the terminal shows a percentage beside the message,
 *   or the amount so far when the total isn't known); it needn't.
 * @property {<T>(task: (show: (shown: SignInShown) => void) => Promise<T>) => Promise<T>} signIn
 *   A sign-in under way in the person's browser, for a front end whose screen isn't the person's
 *   window (`inWindow` false), so the program can't be seen or answered there: `task` runs it and
 *   hands `show` the link and code the person needs as the program prints them. The notice just
 *   before it is its explanation, and the page shows the two as one screen, until `task` is over.
 *   Like `busy`, nothing else may be shown while it runs. (The terminal shows the link and code as
 *   steps, and no code box: there, the program reads the window itself.)
 * @property {(text: string) => void} problem Something that didn't work, or why the run stopped.
 * @property {(rows: [string, string][], title: string) => void} summary Labelled rows, such as the checklist.
 * @property {(text: string, title: string) => void} notice Something to read before what comes next.
 * @property {(what: string) => Promise<void>} waitForDone Waits until the person says something
 *   done elsewhere is done. `what` completes "once …", such as "you've connected them"; the front
 *   end words the action (the terminal: "Press Enter once you've connected them.").
 * @property {import('./questions.js').Asker} ask Asks the person. Messages name no key.
 * @property {(from?: string) => string} comeBack The sentence that sends the person back to the
 *   Installer from `from` ("the browser", if not given), such as after a notice that opens a page.
 * @property {boolean} inWindow Whether programs on screen run in the person's own window, where
 *   they can see and answer them directly. A sign-in whose steps differ picks its version by this.
 * @property {Screen} screen Where programs run on screen go (see openMachine).
 * @property {string} description One line saying which front end this is, for the log.
 * @property {(text: string) => void} finish The run's last words. A second line, if there is
 *   one, lines up under the first.
 * @property {() => Promise<void>} close Called once, as the run ends, whichever way it ends.
 */

export {};
