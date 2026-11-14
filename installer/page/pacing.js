// What the Installer page shows, and for how long. Plain JavaScript, no React, so it's tested on
// its own (installer/test/pacing.test.js, seam 3).
//
// The Installer sends one event per front-end call (installer/src/installer-page.js lists them)
// and never waits for the page, except for an answer. So the page decides:
//
// - which calls make one screen (`screensOf`): a busy with its progress and how it ended, a
//   question with its answer, and the joined screens listed there;
// - how long each screen stays (`isThrough`): a question until it's answered, a notice until
//   Continue, a step for a moment, a busy until it has ended and then a moment more; the run's
//   last screen for good;
// - what's on screen (`onScreen`): the first screen, in order, that isn't through yet. Whatever
//   arrives meanwhile waits its turn.
//
// What had already happened when the page connected (a reload, a second window) is rebuilt
// without pausing on it: its steps and busy lines are through at once, so the page opens on what
// the run is doing now.
//
// The page's state is a `Page`, changed only by `reduce`, so React holds it with useReducer and
// the tests drive it with plain times.

/**
 * @typedef {{ id: number, type: string, [field: string]: any }} PageEvent
 *
 * @typedef {{ value: string, label: string, hint?: string }} Option
 *
 * @typedef {object} Asked A question the run asked, as the page was sent it.
 * @property {number} question Its id, which an answer names.
 * @property {'choose' | 'confirm' | 'pick' | 'folder' | 'done'} kind
 * @property {string} [key]
 * @property {string} [message]
 * @property {Option[]} [options]
 * @property {unknown} [initial]
 * @property {string} [placeholder]
 * @property {string} [what] For `done`: what it's waiting for, which completes "once …".
 *
 * @typedef {{ title: string, rows: [string, string][] }} Summary
 *
 * @typedef {{ key: number, output: string }} Shared Every screen has a key (the id of its first
 *   event, for React) and what programs printed while it was the newest screen.
 *
 * @typedef {Shared & { kind: 'step', text: string }} StepScreen
 * @typedef {Shared & { kind: 'notice', title: string, text: string }} NoticeScreen
 * @typedef {Shared & { kind: 'summary', title: string, rows: [string, string][] }} SummaryScreen
 * @typedef {Shared & { kind: 'busy', message: string, received?: number, total?: number, ended?: { text: string, ok?: boolean }, endedBy?: number, terminal?: string, stopsAfter?: boolean }} BusyScreen
 *   `terminal`: what the skills installer printed during it, which the page shows in a small
 *   terminal (output events with this busy's id). `stopsAfter`: Stop came while it ran, and the
 *   run finishes it before it stops (it installs something), so it stays until it has ended.
 * @typedef {Shared & { kind: 'question', question: Asked, number?: number, answer?: { value: unknown }, refused?: { answer: unknown, reason: string }, problem?: string, notice?: { title: string, text: string } }} QuestionScreen
 *   `problem` or `notice`: the call just before it, joined to it. `number`: which question this
 *   is, counting only the person's answers to the setup's questions (not Done, not Try again).
 * @typedef {Shared & { kind: 'signIn', notice?: { title: string, text: string }, link?: { url: string, label: string }, code?: string, codeBox?: number, sent?: boolean, refused?: { reason: string, by: number }, over?: boolean }} SignInScreen
 *   A sign-in in the browser, joined to the notice before it, which explains it: the link and
 *   code the person needs, as the program prints them, and a box for a code, posted as an answer
 *   to `codeBox` (`sent` once it's gone to the program, `refused` with why the last code wasn't
 *   taken, `by` the event that said so, so the same reason twice is two refusals).
 *   `over` once the program has finished.
 * @typedef {Shared & { kind: 'ending' | 'problem', summaries: Summary[], problems: string[], lines: string[], next?: { title: string, text: string }, log?: string, closing?: string }} EndScreen
 *   The run's last screen, which gathers every call after it that isn't a question or a busy.
 *   `ending`: the checklist onwards. `problem`: a problem nothing is asked about, which only
 *   comes as a run stops or fails, with what's said after it.
 * @typedef {Shared & { kind: 'between' }} BetweenScreen Nothing to show yet: the page has
 *   finished with the last screen (answered, continued) and the run hasn't said what's next.
 *
 * @typedef {StepScreen | NoticeScreen | SummaryScreen | BusyScreen | QuestionScreen | SignInScreen | EndScreen} Screen
 * @typedef {Screen | BetweenScreen} Shown
 */

/**
 * @typedef {object} Page
 * @property {PageEvent[]} events Every event so far, in order, each once.
 * @property {Record<number, number>} times When each event arrived; `-Infinity` for one that had
 *   already happened when the page connected.
 * @property {number} before The number of events the run had sent when the page last connected.
 * @property {number} last The id of the last event folded in.
 * @property {string} title
 * @property {string} [setupPage]
 * @property {string} [shareLogLine]
 * @property {Screen[]} screens
 * @property {Record<number, number>} shown When each screen (by key) first came on screen.
 * @property {number[]} continued The screens the person pressed Continue on.
 * @property {number} current The index in `screens` of the one on screen, or -1 when every
 *   screen is through.
 * @property {number} now The time of the last action.
 */

/**
 * @typedef {{ type: 'connected', before: number }
 *   | { type: 'event', event: PageEvent, now: number }
 *   | { type: 'continue', screen: number, now: number }
 *   | { type: 'tick', now: number }} Action
 *   `connected`: a stream has opened, the run having sent `before` events. `continue`: the person
 *   pressed Continue on a screen. `tick`: time has passed.
 */

/** How long, in ms, a screen with nothing to wait for stays. */
export const holds = {
  /** A plain step. */
  step: 2200,
  /** A busy line once it has ended, with its tick or its warning. */
  done: 1700,
  /** A busy that showed the skills installer's own output, once it has ended: its terminal, to be looked at. */
  terminal: 3400,
  /** Either, while the page is a long way behind the run. */
  catchUp: 600,
};

/** How many screens waiting behind the one on screen make the page catch up. */
export const behindToCatchUp = 4;

/**
 * The summaries the run ends with (installer/src/main.js): the first of them starts the ending.
 * Any other summary is a screen of its own, or part of a stop.
 */
export const endingSummaries = ['Skills', 'Workspaces', 'Checklist'];

/** @type {Page} */
export const begin = {
  events: [],
  times: {},
  before: 0,
  last: 0,
  title: 'Agent Jumpstart',
  screens: [],
  shown: {},
  continued: [],
  current: -1,
  now: 0,
};

/**
 * The page after an action. Returns the same page when nothing has changed.
 * @param {Page} page @param {Action} action
 * @returns {Page}
 */
export function reduce(page, action) {
  switch (action.type) {
    case 'connected':
      return { ...page, before: action.before };
    case 'event': {
      const { event, now } = action;
      if (event.id <= page.last) return settle(page, now);
      const events = [...page.events, event];
      const times = { ...page.times, [event.id]: event.id <= page.before ? -Infinity : now };
      const started = event.type === 'start' ? { title: event.title, setupPage: event.setupPage, shareLogLine: event.shareLogLine } : {};
      return settle({ ...page, ...started, events, times, last: event.id, screens: screensOf(events) }, now);
    }
    case 'continue':
      if (page.continued.includes(action.screen)) return settle(page, action.now);
      return settle({ ...page, continued: [...page.continued, action.screen] }, action.now);
    case 'tick':
      return settle(page, action.now);
  }
}

/**
 * The screens the events make, in the order they're shown. A screen's later events (a busy's
 * progress and end, a question's answer) change it rather than make another. Joined into one:
 *
 * - a problem and the question straight after it (Try again or Skip for now);
 * - a notice and the Done straight after it (waitForDone);
 * - a notice and the sign-in straight after it (signIn), which it explains;
 * - the run's last screen: from the first of `endingSummaries`, or a problem nothing is asked
 *   about, or `finish`, everything up to the end that isn't a question or a busy. Those that do
 *   come then (T3 Code that couldn't be opened, say) are shown before it.
 *
 * What a program prints goes with the newest screen; what the skills installer prints, with its
 * busy, as its `terminal`.
 * @param {PageEvent[]} events
 * @returns {Screen[]}
 */
export function screensOf(events) {
  /** @type {Screen[]} */
  const screens = [];
  /** @type {EndScreen | undefined} */
  let end;
  /** The screen the last call made or joined, which a question or output joins. @type {Screen | undefined} */
  let newest;
  /** @type {Map<number, QuestionScreen>} */
  const questions = new Map();
  /** @type {Map<number, BusyScreen>} */
  const busies = new Map();
  /** Sign-ins by their id. @type {Map<number, SignInScreen>} */
  const signIns = new Map();
  /** Sign-ins by their code box's id. @type {Map<number, SignInScreen>} */
  const codeBoxes = new Map();
  /** A problem or notice the question coming next joins. @type {{ key: number, problem?: string, notice?: { title: string, text: string } } | undefined} */
  let joining;

  /** The next event, after `index`, that makes or joins a screen. @param {number} index */
  const nextCall = (index) => events.slice(index + 1).find((event) => makesAScreen.has(event.type));
  /** @param {Screen} screen */
  const add = (screen) => {
    screens.push(screen);
    newest = screen;
  };
  /** @param {PageEvent} event @param {'ending' | 'problem'} kind */
  const ending = (event, kind) => {
    end ??= { kind, key: event.id, output: '', summaries: [], problems: [], lines: [] };
    newest = end;
    return end;
  };

  events.forEach((event, index) => {
    switch (event.type) {
      case 'step': {
        if (end) {
          const log = /^Log: (.*)$/.exec(event.text);
          if (log) ending(event, end.kind).log = log[1];
          else ending(event, end.kind).lines.push(event.text);
        } else add({ kind: 'step', key: event.id, output: '', text: event.text });
        break;
      }
      case 'notice': {
        const next = nextCall(index);
        if ((next?.type === 'question' && next.kind === 'done') || next?.type === 'signIn') joining = { key: event.id, notice: { title: event.title, text: event.text } };
        else if (end) {
          if (end.next) end.lines.push(event.text);
          else end.next = { title: event.title, text: event.text };
          newest = end;
        } else add({ kind: 'notice', key: event.id, output: '', title: event.title, text: event.text });
        break;
      }
      case 'problem': {
        if (nextCall(index)?.type === 'question') joining = { key: event.id, problem: event.text };
        else ending(event, 'problem').problems.push(event.text);
        break;
      }
      case 'summary': {
        if (end || endingSummaries.includes(event.title)) ending(event, 'ending').summaries.push({ title: event.title, rows: event.rows });
        else add({ kind: 'summary', key: event.id, output: '', title: event.title, rows: event.rows });
        break;
      }
      case 'finish':
        ending(event, 'ending').closing = event.text;
        break;
      case 'busy': {
        /** @type {BusyScreen} */
        const busy = { kind: 'busy', key: event.id, output: '', message: event.message };
        busies.set(event.id, busy);
        add(busy);
        break;
      }
      case 'progress': {
        const busy = busies.get(event.busy);
        if (busy) Object.assign(busy, { received: event.received, total: event.total });
        break;
      }
      case 'ended': {
        const busy = busies.get(event.busy);
        if (busy) Object.assign(busy, { ended: { text: event.text, ok: event.ok }, endedBy: event.id });
        break;
      }
      case 'question': {
        const { id, type, ...asked } = event;
        /** @type {QuestionScreen} */
        const screen = { kind: 'question', key: id, output: '', question: /** @type {Asked} */ (asked), ...joining };
        joining = undefined;
        add(screen);
        questions.set(event.question, screen);
        break;
      }
      case 'signIn': {
        /** @type {SignInScreen} */
        const screen = { kind: 'signIn', key: joining?.key ?? event.id, output: '', ...(joining?.notice && { notice: joining.notice }) };
        joining = undefined;
        add(screen);
        signIns.set(event.id, screen);
        break;
      }
      case 'signInShows': {
        const screen = signIns.get(event.signIn);
        if (!screen) break;
        if (event.link) screen.link = event.link;
        if (event.code !== undefined) screen.code = event.code;
        if (event.codeBox !== undefined) {
          screen.codeBox = event.codeBox;
          codeBoxes.set(event.codeBox, screen);
        }
        break;
      }
      case 'signInEnded': {
        const screen = signIns.get(event.signIn);
        if (screen) screen.over = true;
        break;
      }
      case 'answered': {
        const screen = questions.get(event.question);
        if (screen) {
          screen.answer = { value: event.answer };
          delete screen.refused;
        }
        const signIn = codeBoxes.get(event.question);
        if (signIn) {
          signIn.sent = true;
          delete signIn.refused;
        }
        break;
      }
      case 'refused': {
        const screen = questions.get(event.question);
        if (screen) screen.refused = { answer: event.answer, reason: event.reason };
        const signIn = codeBoxes.get(event.question);
        if (signIn) signIn.refused = { reason: event.reason, by: event.id };
        break;
      }
      case 'output': {
        const busy = event.busy === undefined ? undefined : busies.get(event.busy);
        if (busy) busy.terminal = (busy.terminal ?? '') + event.text;
        else if (newest && event.busy === undefined) newest.output += event.text;
        break;
      }
      case 'stopping': {
        const busy = event.after === undefined ? undefined : busies.get(event.after);
        if (busy) busy.stopsAfter = true;
        break;
      }
    }
  });

  let number = 0;
  for (const screen of screens) {
    if (screen.kind === 'question' && screen.question.kind !== 'done' && screen.problem === undefined) screen.number = ++number;
  }
  return end ? [...screens, end] : screens;
}

/** The events that make a screen or join one, as opposed to changing one. */
const makesAScreen = new Set(['step', 'notice', 'problem', 'summary', 'finish', 'busy', 'question', 'signIn']);

/**
 * Whether a screen has had its time, at `now`, `behind` screens waiting after it.
 * @param {Screen} screen @param {Page} page @param {number} now @param {number} behind
 */
function isThrough(screen, page, now, behind) {
  // Once the run is stopping, nothing is waited on but the stop screen: not what came before, nor
  // a notice or step the run sends on its way to the call that throws the Stop. The one thing
  // the run finishes first, a step that installs something, stays until it has ended.
  const finishing = screen.kind === 'busy' && screen.stopsAfter && !screen.ended;
  if (screen.kind !== 'ending' && screen.kind !== 'problem' && !finishing && page.events.some((event) => event.type === 'stopping')) return true;
  switch (screen.kind) {
    case 'question':
      return screen.answer !== undefined;
    case 'signIn':
      // The person's turn, however long it takes; over as soon as its program has finished.
      return screen.over === true;
    case 'notice':
    case 'summary':
      // Continued here, or the person has moved on past it: answered a later question, on this
      // page before a reload or in another window, or the run had gone on to something else
      // before this page connected.
      return page.continued.includes(screen.key) || answeredSince(page, screen.key) || movedOnBefore(page, screen.key);
    case 'step':
    case 'busy': {
      const due = dueAt(screen, page, behind);
      return due !== undefined && now >= due;
    }
    default:
      return false;
  }
}

/**
 * When a step or busy screen has had its time: a moment after it came on screen (a busy: after it
 * ended, too), or at once if it had happened before the page connected. Undefined while a busy
 * runs.
 * @param {StepScreen | BusyScreen} screen @param {Page} page @param {number} behind
 */
function dueAt(screen, page, behind) {
  const shown = page.shown[screen.key] ?? Infinity;
  const done = screen.kind === 'step' ? screen.key : screen.endedBy;
  if (done === undefined) return undefined;
  const at = page.times[done];
  if (at === -Infinity) return -Infinity;
  const hold = behind >= behindToCatchUp ? holds.catchUp : screen.kind === 'step' ? holds.step : screen.terminal ? holds.terminal : holds.done;
  return Math.max(shown, at) + hold;
}

/** When the screen on screen now is due to have had its time, if time alone decides it. @param {Page} page */
export function wakeAt(page) {
  const screen = page.screens[page.current];
  if (screen?.kind !== 'step' && screen?.kind !== 'busy') return undefined;
  return dueAt(screen, page, page.screens.length - 1 - page.current);
}

/**
 * Whether the run had already gone on from event `key` to another screen when the page last
 * connected. The newest thing it had shown isn't counted as past: the person may not have read it.
 * @param {Page} page @param {number} key
 */
function movedOnBefore(page, key) {
  return page.events.some((event) => event.id > key && event.id <= page.before && makesAScreen.has(event.type));
}

/** Whether a question asked after event `key` has been answered. @param {Page} page @param {number} key */
function answeredSince(page, key) {
  const asked = new Set(page.events.filter((event) => event.type === 'question' && event.id > key).map((event) => event.question));
  return page.events.some((event) => event.type === 'answered' && asked.has(event.question));
}

/**
 * Moves the page on, at `now`, to the first screen that isn't through, noting when each screen
 * first comes on screen.
 * @param {Page} page @param {number} now
 * @returns {Page}
 */
function settle(page, now) {
  let shown = page.shown;
  let current = -1;
  for (let index = 0; index < page.screens.length; index++) {
    const screen = page.screens[index];
    if (shown[screen.key] === undefined) shown = { ...shown, [screen.key]: now };
    if (!isThrough(screen, { ...page, shown }, now, page.screens.length - 1 - index)) {
      current = index;
      break;
    }
  }
  if (shown === page.shown && current === page.current && now === page.now) return page;
  return { ...page, shown, current, now };
}

/**
 * What's on screen: the first screen that isn't through. Once all are, the last step or busy
 * line stays; after an answer or a Continue, the page shows it's waiting on the run.
 * @param {Page} page
 * @returns {Shown}
 */
export function onScreen(page) {
  const screen = page.screens[page.current];
  if (screen) return screen;
  const last = page.screens.at(-1);
  if (last && (last.kind === 'step' || last.kind === 'busy')) return last;
  return { kind: 'between', key: -(last?.key ?? 0), output: '' };
}

/** @typedef {'done' | 'now' | 'warn' | 'to-come'} Dash */

/**
 * The header's dashes, which say how far along the run is: one per question asked, one per thing
 * done since (each other screen), and one for the ending, which is always there to come. A dash
 * is done once its screen is through, lit while it's on screen, and amber for something that
 * didn't work (a busy line that failed, a problem). Nothing says how many are still to come,
 * since the run doesn't know until it gets there.
 * @param {Page} page
 * @returns {{ questions: Dash[], work: Dash[], ending: Dash }}
 */
export function dashes(page) {
  /** @param {Screen} screen @param {number} index @returns {Dash} */
  const dash = (screen, index) => {
    if ((screen.kind === 'busy' && screen.ended?.ok === false) || (screen.kind === 'question' && screen.problem !== undefined) || screen.kind === 'problem') return 'warn';
    // Never answered (the run stopped): not one of those done.
    if (screen.kind === 'question' && screen.answer === undefined) return index === page.current ? 'now' : 'to-come';
    if (page.current === -1 || index < page.current) return 'done';
    return index === page.current ? 'now' : 'to-come';
  };
  /** @type {Dash[]} */
  const questions = [];
  /** @type {Dash[]} */
  const work = [];
  /** @type {Dash} */
  let ending = 'to-come';
  page.screens.forEach((screen, index) => {
    if (screen.kind === 'ending' || screen.kind === 'problem') ending = dash(screen, index);
    else if (screen.kind === 'question' && screen.number !== undefined) questions.push(dash(screen, index));
    else work.push(dash(screen, index));
  });
  return { questions, work, ending };
}
