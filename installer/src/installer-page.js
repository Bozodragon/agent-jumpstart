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
//   refused  { question, answer?, reason }  a folder that won't do; the question is still open
//                                            (no `answer` for a code box: a code is never sent back)
//   signIn   {}                              a sign-in under way in the browser; its id is the
//                                            sign-in's id, and the notice just before it explains it
//   signInShows { signIn, link?, code?, codeBox? }  what the person needs for it, as its program
//                                            prints it: `link` { url, label }, a `code` to copy,
//                                            and `codeBox`, the id a pasted code is posted to as
//                                            an answer (answered with 'sent' once it's gone to the
//                                            program's input, or refused with the reason)
//   signInEnded { signIn }                   its program has finished, whichever way
//   output   { text }                       what a program printed, for the page to show (nothing
//                                            sends it yet: a sign-in's program keeps its output)
//   finish   { text }                       the run's last words
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { openPageServer } from './page-server.js';

/**
 * How often, at most, a busy's progress is sent: a download reports every piece it gets, far
 * more often than a page can show.
 */
const progressEvery = 200;

/**
 * @typedef {object} OpenQuestion
 * @property {(answer: unknown) => Promise<{ value: unknown } | { refused: string }>} check What
 *   the answer means, or why it won't do.
 * @property {(value: unknown) => void} resolve
 * @property {boolean} checking Whether an answer to it is being checked now.
 * @property {boolean} [secret] Whether what's posted is kept from the events (a sign-in code).
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
        server.send({ type: 'refused', question, ...(asked.secret ? {} : { answer }), reason: checked.refused });
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
  const ask = (question, check) =>
    new Promise((resolve) => {
      const id = nextQuestion++;
      open.set(id, { check, resolve, checking: false });
      server.send({ type: 'question', question: id, ...question });
    });

  /** @param {string} reason */
  const refuse = async (reason) => ({ refused: reason });

  /**
   * An answer that must be one of the options' values.
   * @param {{ value: string }[]} options @param {unknown} answer
   */
  const oneOf = (options, answer) => options.some(({ value }) => value === answer);

  /** @param {import('./questions.js').Option<string>[]} options */
  const shown = (options) => options.map(({ value, label, hint }) => ({ value, label, ...(hint === undefined ? {} : { hint }) }));

  /** The input of the program on the screen now, while it runs: where a pasted code goes. @type {import('node:stream').Writable | undefined} */
  let typing;

  /** @type {import('./front-end.js').Screen} */
  const screen = {
    // Nothing on the page is a terminal: a program's input and output are always pipes. What it
    // prints is its caller's (a sign-in takes the link and code from it and logs the rest), so
    // none of it goes to the page; it's read anyway, so a program never waits on a full pipe. Its
    // input stays open while it runs, for a code pasted on the page.
    stdio: () => ['pipe', 'pipe', 'pipe'],
    attach(child) {
      for (const from of [child.stdout, child.stderr]) from?.resume();
      const input = child.stdin ?? undefined;
      if (!input) return;
      // A program that has gone before its code arrives mustn't take the Installer with it.
      input.on('error', () => {});
      typing = input;
      child.once('close', () => {
        if (typing === input) typing = undefined;
      });
    },
    write() {},
  };

  return {
    address: server.address,
    connected,
    start(title, links) {
      server.send({ type: 'start', title, ...links });
    },
    step(text) {
      server.send({ type: 'step', text });
    },
    async busy(message, task, ended) {
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
      let result;
      try {
        result = await task(progress);
      } catch (error) {
        server.send({ type: 'ended', busy, text: message, ok: false });
        throw error;
      }
      const { text, ok } = ended?.(result) ?? { text: message, ok: true };
      server.send({ type: 'ended', busy, text, ok });
      return result;
    },
    async signIn(task) {
      const signIn = server.send({ type: 'signIn' });
      /** The code box's id, while it's open. @type {number | undefined} */
      let box;
      /** @type {import('./front-end.js').SignInShown['codeBox'] & {}} */
      const pasted = (code) => (code === '' ? 'Paste the code first.' : undefined);
      try {
        return await task(({ link, code, codeBox }) => {
          /** @type {Record<string, unknown>} */
          const shown = {};
          if (link) shown.link = { url: link.url, label: link.label };
          if (code !== undefined) shown.code = code;
          if (codeBox && box === undefined) {
            box = nextQuestion++;
            const id = box;
            open.set(id, {
              checking: false,
              secret: true,
              resolve: () => {},
              async check(posted) {
                const code = typeof posted === 'string' ? posted.trim() : '';
                const why = pasted(code) ?? codeBox(code);
                if (why !== undefined) return { refused: why };
                if (!typing?.writable) return { refused: 'The sign-in has already finished.' };
                typing.write(`${code}\n`);
                return { value: 'sent' };
              },
            });
            shown.codeBox = id;
          }
          if (Object.keys(shown).length > 0) server.send({ type: 'signInShows', signIn, ...shown });
        });
      } finally {
        if (box !== undefined) open.delete(box);
        server.send({ type: 'signInEnded', signIn });
      }
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
      server.send({ type: 'finish', text });
    },
    async close() {
      await server.close();
      await connectedWritten;
      await rm(addressFile, { force: true });
    },
  };
}
