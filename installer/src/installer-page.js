// The page front end: the Installer in a page of the person's own browser, served by
// page-server.js. Each front-end call sends the page one event, which the page shows at its own
// pace; the run waits only for answers.
//
// The events, each with `type` (and an `id` the server numbers them by, from 1):
//   start    { title, setupPage?, shareLogLine? }   the profile's setup page and share-log line
//   step     { text }
//   busy     { message }                     something slow under way; its id is the busy's id
//   progress { busy, received, total? }     how far it has got (bytes), a few times a second at most
//   ended    { busy, text, ok? }             how it ended: done (ok true), failed (false), or
//                                            neither, with no ok (a step that gave way quietly)
//   problem  { text }
//   summary  { title, rows: [label, value][] }
//   notice   { title, text }
//   question { question, kind, key, message, options?, initial?, placeholder?, back? }
//            kind is folder, choose, confirm, pick, or done (waitForDone: `what` in place of a
//            message, answered with anything). `back`: true for a question asked while Back and
//            Change last, which the person may go back to once it's answered (and from, while
//            it's open)
//   answered { question, answer }           the first answer, which counts; the page moves on
//   refused  { question, answer, reason }   a folder that won't do; the question is still open
//   back     { to }                         the person went back to question `to`: it and
//                                            everything since are asked again, as new questions
//   fixed    {}                              Back and Change are gone for good: the questions are
//                                            over, or something has acted on the answers
//   output   { text, busy? }                what a program on screen printed; with `busy`, what
//                                            the skills installer printed during that busy (the
//                                            one program whose own output the page shows), as
//                                            it printed it, escape codes and all
//   finish   { text }                       the run's last words
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { openPageServer } from './page-server.js';
import { GoBack } from './questions.js';

/**
 * How often, at most, a busy's progress is sent: a download reports every piece it gets, far
 * more often than a page can show.
 */
const progressEvery = 200;

/**
 * @typedef {(answer: unknown) => Promise<{ value: unknown } | { refused: string }>} Check What an
 *   answer means, or why it won't do.
 */

/**
 * @typedef {object} OpenQuestion
 * @property {Check} check
 * @property {(value: unknown) => void} resolve
 * @property {(error: GoBack) => void} reject
 * @property {boolean} checking Whether an answer to it is being checked now.
 */

/**
 * A question answered while Back and Change last: what it was, by the id the page knows it by,
 * and the answer.
 * @typedef {{ id: number, key?: string, kind: string, answer: unknown }} Answered
 */

/**
 * Writes a file under another name and renames it, so whoever looks for it (the Bootstrap, a
 * test) never reads it empty or half-written.
 * @param {string} path @param {string} text
 */
export async function writeWhole(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const writing = `${path}.${process.pid}.partial`;
  await writeFile(writing, text);
  await rename(writing, path);
}

/**
 * Opens the page front end: starts the page's server and writes its address to `addressFile`,
 * where the Bootstrap finds it, with this process's id on the line after. That file is the lock
 * that says an Installer is running, and it's removed again as the front end closes. Once a page
 * first connects, its address is written to `connectedFile`, which tells the Bootstrap it can
 * close the window. `connected` resolves once it's written, and rejects if it can't be.
 * @param {{ addressFile: string, connectedFile: string, page?: string }} options `page`: the built
 *   page's folder, for tests
 * @returns {Promise<import('./front-end.js').FrontEnd & { address: string, connected: Promise<void> }>}
 */
export async function openInstallerPage({ addressFile, connectedFile, page }) {
  /** @type {Map<number, OpenQuestion>} */
  const open = new Map();
  let nextQuestion = 1;

  // Back and Change (see FrontEnd's `questions`). They last from the questions' `begin` until
  // they're fixed.
  let backOpen = false;
  let fixed = false;
  /** The questions answered since the last `begin`, in order. @type {Answered[]} */
  let pass = [];
  /** The answers before the question gone back to, given again without asking. @type {Answered[]} */
  let replay = [];
  /**
   * After going back, until a question is put to the page again: what's shown then was shown the
   * first time through, and the page still has it.
   */
  let quiet = false;
  /** Whether the person has gone back, after which every question starts with their last answer to it. */
  let wentBack = false;
  /** The last answer given to each question, by its kind and key. @type {Map<string, unknown>} */
  const given = new Map();
  /** @param {{ kind?: unknown, key?: unknown }} question */
  const named = ({ kind, key }) => `${kind}:${key}`;
  /** Back and Change are gone for good. */
  const fix = () => {
    backOpen = false;
    replay = [];
    quiet = false;
    if (fixed) return;
    fixed = true;
    server.send({ type: 'fixed' });
  };

  const server = await openPageServer({
    page,
    async answer(posted) {
      const { question, answer } = /** @type {{ question?: unknown, answer?: unknown }} */ (posted ?? {});
      const asked = typeof question === 'number' ? open.get(question) : undefined;
      // The first answer to a question wins; any other page has moved on by the time it's in.
      if (typeof question !== 'number' || !asked || asked.checking) return { status: 409, body: { ok: false, reason: 'That question has already been answered.' } };
      asked.checking = true;
      let checked;
      try {
        checked = await asked.check(answer);
      } finally {
        asked.checking = false;
      }
      if ('refused' in checked) {
        server.send({ type: 'refused', question, answer, reason: checked.refused });
        return { status: 422, body: { ok: false, reason: checked.refused } };
      }
      open.delete(question);
      server.send({ type: 'answered', question, answer: checked.value });
      asked.resolve(checked.value);
      return { status: 200, body: { ok: true } };
    },
    async back(posted) {
      const { to } = /** @type {{ to?: unknown }} */ (posted ?? {});
      if (!backOpen) return { status: 409, body: { ok: false, reason: "Your answers can't be changed now: the Installer has started using them." } };
      const at = pass.findIndex((answered) => answered.id === to && answered.key !== undefined);
      const waiting = [...open].filter(([, asked]) => !asked.checking);
      if (at < 0 || waiting.length !== 1) return { status: 409, body: { ok: false, reason: "That question can't be gone back to now." } };
      const [[id, asked]] = waiting;
      open.delete(id);
      replay = pass.slice(0, at);
      wentBack = true;
      quiet = true;
      server.send({ type: 'back', to });
      asked.reject(new GoBack(/** @type {string} */ (pass[at].key)));
      return { status: 200, body: { ok: true } };
    },
  });
  await writeWhole(addressFile, `${server.address}\n${process.pid}\n`);
  // For the first page only: the Bootstrap waits for it once, and knows a page has connected only
  // from it, so a page counts as connected only once it's written.
  let connectedWritten = Promise.resolve();
  /** @type {Promise<void>} */
  const connected = new Promise((resolve, reject) => {
    server.whenConnected().then(() => {
      connectedWritten = writeWhole(connectedFile, `${server.address}\n`).then(resolve, reject);
    });
  });
  // Whoever waits for it hears how it failed; nothing else need.
  connected.catch(() => {});

  /**
   * A question's default once the person has gone back: the answer they last gave it, if it would
   * still do, otherwise its own.
   * @param {Record<string, any>} question
   */
  const defaultOf = (question) => {
    const before = given.get(named(question));
    if (!wentBack || before === undefined) return question.initial;
    /** @type {string[]} */
    const values = (question.options ?? []).map((/** @type {{ value: string }} */ { value }) => value);
    switch (question.kind) {
      case 'choose':
        return values.includes(/** @type {string} */ (before)) ? before : question.initial;
      case 'pick':
        return Array.isArray(before) ? values.filter((value) => before.includes(value)) : question.initial;
      case 'confirm':
        return typeof before === 'boolean' ? before : question.initial;
      case 'folder':
        return typeof before === 'string' ? before : question.initial;
      default:
        return question.initial;
    }
  };

  /**
   * Sends a question and waits for its first answer that `check` accepts. After going back, a
   * question before the one gone back to is answered as it was, without being sent.
   * @param {Record<string, any>} question what the page is told
   * @param {Check} check
   * @returns {Promise<any>}
   */
  const ask = async (question, check) => {
    const [again] = replay;
    if (again) {
      replay = replay.slice(1);
      const checked = again.key === question.key && again.kind === question.kind ? await check(again.answer) : undefined;
      if (checked && 'value' in checked) {
        pass.push({ ...again, answer: checked.value });
        return checked.value;
      }
      // Asked differently this time (something on the laptop changed meanwhile, such as Google
      // Drive signed in): from here, it's asked, and the page takes off what it had from here.
      replay = [];
      server.send({ type: 'back', to: again.id });
    }
    quiet = false;
    return new Promise((resolve, reject) => {
      const id = nextQuestion++;
      const inPass = backOpen;
      /** @param {unknown} value */
      const answered = (value) => {
        given.set(named(question), value);
        if (inPass && backOpen) pass.push({ id, key: question.key, kind: question.kind, answer: value });
        resolve(value);
      };
      open.set(id, { check, resolve: answered, reject, checking: false });
      server.send({ type: 'question', question: id, ...question, initial: defaultOf(question), ...(inPass ? { back: true } : {}) });
    });
  };

  /** @param {string} reason */
  const refuse = async (reason) => ({ refused: reason });

  /**
   * An answer that must be one of the options' values.
   * @param {{ value: string }[]} options @param {unknown} answer
   */
  const oneOf = (options, answer) => options.some(({ value }) => value === answer);

  /** @param {import('./questions.js').Option<string>[]} options */
  const shown = (options) => options.map(({ value, label, hint }) => ({ value, label, ...(hint === undefined ? {} : { hint }) }));

  /** @type {import('./front-end.js').Screen} */
  const screen = {
    // Nothing on the page is a terminal: a program's input and output are always pipes. What it
    // prints is relayed to the page; its input stays open, for a page to write to.
    stdio: () => ['pipe', 'pipe', 'pipe'],
    attach(child) {
      for (const from of [child.stdout, child.stderr]) {
        from?.setEncoding('utf8');
        from?.on('data', (/** @type {string} */ text) => server.send({ type: 'output', text }));
      }
    },
    write(text) {
      if (text !== '') server.send({ type: 'output', text });
    },
  };

  return {
    address: server.address,
    connected,
    start(title, links) {
      server.send({ type: 'start', title, ...links });
    },
    step(text) {
      if (!quiet) server.send({ type: 'step', text });
    },
    async busy(message, task, ended) {
      // Going back, it was shown the first time through.
      if (quiet) return task(() => {}, () => {});
      const busy = server.send({ type: 'busy', message });
      let last = -Infinity;
      let shownReceived = -1;
      /** @type {import('./front-end.js').Progress} */
      const progress = (received, total) => {
        const now = performance.now();
        const whole = total !== undefined && received >= total;
        if (received === shownReceived || (!whole && now - last < progressEvery)) return;
        last = now;
        shownReceived = received;
        server.send({ type: 'progress', busy, received, ...(total === undefined ? {} : { total }) });
      };
      /** @type {import('./front-end.js').Output} */
      const output = (text) => {
        if (text !== '') server.send({ type: 'output', busy, text });
      };
      let result;
      try {
        result = await task(progress, output);
      } catch (error) {
        server.send({ type: 'ended', busy, text: message, ok: false });
        throw error;
      }
      const { text, ok } = ended?.(result) ?? { text: message, ok: true };
      server.send({ type: 'ended', busy, text, ok });
      return result;
    },
    problem(text) {
      if (!quiet) server.send({ type: 'problem', text });
    },
    summary(rows, title) {
      if (!quiet) server.send({ type: 'summary', title, rows });
    },
    notice(text, title) {
      if (!quiet) server.send({ type: 'notice', title, text });
    },
    async waitForDone(what) {
      await ask({ kind: 'done', what }, async () => ({ value: 'done' }));
    },
    ask: {
      folder: ({ key, message, initial, placeholder, validate }) =>
        ask({ kind: 'folder', key, message, initial, placeholder }, async (answer) => {
          if (typeof answer !== 'string') return refuse('Type a folder.');
          const folder = answer.trim();
          const problem = await validate(folder);
          return problem ? { refused: problem } : { value: folder };
        }),
      choose: ({ key, message, options, initial }) =>
        ask({ kind: 'choose', key, message, options: shown(options), initial }, async (answer) =>
          oneOf(options, answer) ? { value: answer } : refuse('Choose one of the options.'),
        ),
      confirm: ({ key, message, initial }) =>
        ask({ kind: 'confirm', key, message, initial }, async (answer) => (typeof answer === 'boolean' ? { value: answer } : refuse('Choose Yes or No.'))),
      pick: ({ key, message, options, initial }) =>
        ask({ kind: 'pick', key, message, options: shown(options), initial }, async (answer) =>
          Array.isArray(answer) && answer.every((value) => oneOf(options, value))
            ? { value: options.map(({ value }) => value).filter((value) => answer.includes(value)) }
            : refuse('Tick only the options shown.'),
        ),
    },
    questions: {
      begin() {
        pass = [];
        backOpen = !fixed;
      },
      fix,
    },
    comeBack: (from = 'the browser') => `Once you're done in ${from}, come back to the Installer page.`,
    inWindow: false,
    screen,
    description: `Front end: the Installer page, on 127.0.0.1 port ${server.port}`,
    finish(text) {
      server.send({ type: 'finish', text });
    },
    async close() {
      await server.close();
      await connectedWritten;
      await rm(addressFile, { force: true });
    },
  };
}
