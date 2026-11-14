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
//   question { question, kind, key, message, options?, initial?, placeholder? }
//            kind is folder, choose, confirm, pick, or done (waitForDone: `what` in place of a
//            message, answered with anything)
//   answered { question, answer }           the first answer, which counts; the page moves on
//   refused  { question, answer, reason }   a folder that won't do; the question is still open
//   output   { text, busy? }                what a program on screen printed; with `busy`, what
//                                            the skills installer printed during that busy (the
//                                            one program whose own output the page shows), as
//                                            it printed it, escape codes and all
//   finish   { text }                       the run's last words
//   stopping {}                             the run is stopping (Stop was pressed, or the page was
//                                            closed and none came back): nothing before this is
//                                            waited on any more, and the stop screen follows
//
// Stopping: Stop on the page throws `Stop('Stopped at your request.')` from whichever call the
// run is waiting on (a question; a busy, whose task is left to itself; a program on the screen,
// such as a sign-in, which is ended), or from the next one it makes, if it's waiting on none. A
// run whose every page has gone finishes the step it's on, then waits at the next question (or
// program on the screen, which needs the page) about 10 minutes for a page to come back (a
// reload, the Bootstrap reopening it, a second window), and stops the same way if none does.
import { spawn } from 'node:child_process';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { openPageServer } from './page-server.js';
import { Stop } from './stop.js';

/**
 * How often, at most, a busy's progress is sent: a download reports every piece it gets, far
 * more often than a page can show.
 */
const progressEvery = 200;

/** How long a run with no page open waits at a question for one to come back, before it stops. */
const comeBackWithin = 10 * 60_000;

/**
 * Waits for something from outside the Installer for at most `ms`, and says whether it happened:
 * the machine's `waitFor`, once `use` has given it.
 * @typedef {(happens: Promise<unknown>, ms: number) => Promise<boolean>} WaitFor
 */

/**
 * @typedef {object} OpenQuestion
 * @property {(answer: unknown) => Promise<{ value: unknown } | { refused: string }>} check What
 *   the answer means, or why it won't do.
 * @property {(value: unknown) => void} resolve
 * @property {(error: Stop) => void} reject Ends the wait for it, as the run stops.
 * @property {boolean} checking Whether an answer to it is being checked now.
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
 * @returns {Promise<import('./front-end.js').FrontEnd & { address: string, connected: Promise<void>, use: (tools: { waitFor: WaitFor, say: (line: string) => void }) => void }>}
 *   `use` gives it the machine's clock, which counts the wait for a page to come back, and a
 *   way to log, once `main` has them.
 */
export async function openInstallerPage({ addressFile, connectedFile, page }) {
  /** @type {Map<number, OpenQuestion>} */
  const open = new Map();
  let nextQuestion = 1;
  /** @type {WaitFor} */
  let waitFor = (happens, ms) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      happens.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  /** @type {(line: string) => void} */
  let say = () => {};
  /** Why the run is stopping, once it is: every call that waits throws it from then on. @type {Stop | undefined} */
  let stopped;
  /** @type {(error: Stop) => void} */
  let stopNow = () => {};
  /** Rejects as the run stops, for whatever it's waiting on then. @type {Promise<never>} */
  const stopping = new Promise((_, reject) => (stopNow = reject));
  stopping.catch(() => {});
  /** Whether the run has had its last words, after which there's nothing to stop. */
  let over = false;
  /** The programs on the screen now, which a stop ends. @type {Set<import('node:child_process').ChildProcess>} */
  const onScreen = new Set();

  /**
   * Ends a program on the screen, and whatever it started (cmd.exe's child, say).
   * @param {import('node:child_process').ChildProcess} child
   */
  const end = (child) => {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
    if (process.platform !== 'win32') return void child.kill();
    const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    spawn(taskkill, ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).once('error', () => child.kill());
  };

  /**
   * Stops the run: whatever it's waiting on throws `why`, and so does whatever it waits on next.
   * A program on the screen is ended: nobody can answer it now.
   * @param {Stop} why
   */
  const stop = (why) => {
    if (stopped || over) return;
    stopped = why;
    server.send({ type: 'stopping' });
    for (const asked of open.values()) asked.reject(why);
    open.clear();
    for (const child of onScreen) end(child);
    stopNow(why);
  };

  const server = await openPageServer({
    page,
    stop() {
      if (stopped || over) return;
      say('Stop was pressed');
      stop(new Stop('Stopped at your request.'));
    },
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
      // Stopped while it was being checked: the question isn't asked any more.
      if (!open.has(question)) return { status: 409, body: { ok: false, reason: 'The Installer has stopped.' } };
      if ('refused' in checked) {
        server.send({ type: 'refused', question, answer, reason: checked.refused });
        return { status: 422, body: { ok: false, reason: checked.refused } };
      }
      open.delete(question);
      server.send({ type: 'answered', question, answer: checked.value });
      asked.resolve(checked.value);
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
   * Sends a question and waits for its first answer that `check` accepts.
   * @param {Record<string, unknown>} question what the page is told
   * @param {OpenQuestion['check']} check
   * @returns {Promise<any>}
   */
  const ask = (question, check) => {
    if (stopped) return Promise.reject(stopped);
    return new Promise((resolve, reject) => {
      const id = nextQuestion++;
      /** @type {() => void} */
      let settle = () => {};
      /** Resolves once it's answered, or the run stops. @type {Promise<void>} */
      const settled = new Promise((done) => (settle = () => done(undefined)));
      open.set(id, {
        check,
        checking: false,
        resolve(value) {
          settle();
          resolve(value);
        },
        reject(error) {
          settle();
          reject(error);
        },
      });
      server.send({ type: 'question', question: id, ...question });
      waitForAPage(() => open.has(id), settled);
    });
  };

  /**
   * While the run waits on the person (`waiting()`: a question, or a program on the screen):
   * whenever no page is open, waits for one to come back, and stops the run if none does within
   * `comeBackWithin`.
   * @param {() => boolean} waiting @param {Promise<void>} settled resolves once it's over
   */
  const waitForAPage = async (waiting, settled) => {
    const minutes = comeBackWithin / 60_000;
    for (;;) {
      await Promise.race([server.whenNone(), settled]);
      if (!waiting() || stopped) return;
      say(`no page is open, so the run waits, up to ${minutes} minutes, for one to come back`);
      const back = await waitFor(Promise.race([server.whenConnected(), settled]), comeBackWithin);
      if (!waiting() || stopped) return;
      if (!back) {
        say(`no page came back within ${minutes} minutes`);
        return stop(new Stop(`The Installer page was closed, and wasn't opened again within ${minutes} minutes.`));
      }
      say('a page is open again');
    }
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
      if (stopped) return end(child);
      onScreen.add(child);
      child.once('close', () => onScreen.delete(child));
    },
    write(text) {
      if (text !== '') server.send({ type: 'output', text });
    },
    // A program on the page's screen waits on the person (a sign-in), like a question: a stop
    // throws from it at once, and with no page open it's waited on only so long.
    wait(running) {
      let finished = false;
      const settled = running.then(
        () => void (finished = true),
        () => void (finished = true),
      );
      waitForAPage(() => !finished, settled);
      return Promise.race([running, stopping]);
    },
  };

  return {
    address: server.address,
    connected,
    use(tools) {
      ({ waitFor, say } = tools);
    },
    start(title, links) {
      server.send({ type: 'start', title, ...links });
    },
    step(text) {
      server.send({ type: 'step', text });
    },
    async busy(message, task, ended) {
      if (stopped) throw stopped;
      const busy = server.send({ type: 'busy', message });
      let last = -Infinity;
      let shownReceived = -1;
      /** @type {import('./front-end.js').Progress} */
      const progress = (received, total) => {
        if (stopped) return;
        const now = performance.now();
        const whole = total !== undefined && received >= total;
        if (received === shownReceived || (!whole && now - last < progressEvery)) return;
        last = now;
        shownReceived = received;
        server.send({ type: 'progress', busy, received, ...(total === undefined ? {} : { total }) });
      };
      /** @type {import('./front-end.js').Output} */
      const output = (text) => {
        // A task left to itself by a stop says nothing after the stop screen.
        if (text !== '' && !stopped) server.send({ type: 'output', busy, text });
      };
      let result;
      try {
        // A stop doesn't wait for the task: what it started is left to finish by itself.
        result = await Promise.race([task(progress, output), stopping]);
      } catch (error) {
        // Stopped, it simply ended, with no mark of failure.
        server.send({ type: 'ended', busy, text: message, ...(error === stopped ? {} : { ok: false }) });
        throw error;
      }
      const { text, ok } = ended?.(result) ?? { text: message, ok: true };
      server.send({ type: 'ended', busy, text, ok });
      return result;
    },
    problem(text) {
      server.send({ type: 'problem', text });
    },
    summary(rows, title) {
      server.send({ type: 'summary', title, rows });
    },
    notice(text, title) {
      server.send({ type: 'notice', title, text });
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
    comeBack: (from = 'the browser') => `Once you're done in ${from}, come back to the Installer page.`,
    inWindow: false,
    screen,
    description: `Front end: the Installer page, on 127.0.0.1 port ${server.port}`,
    finish(text) {
      over = true;
      server.send({ type: 'finish', text });
    },
    async close() {
      over = true;
      await server.close();
      await connectedWritten;
      await rm(addressFile, { force: true });
    },
  };
}
