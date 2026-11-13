// The page front end: the Installer in a page of the person's own browser, served by
// page-server.js. Each front-end call sends the page one event, which the page shows at its own
// pace; the run waits only for answers.
//
// The events, each with `type` (and an `id` the server numbers them by, from 1):
//   start    { title }
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
//   output   { text }                       what a program on screen printed
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
 */

/**
 * Opens the page front end: starts the page's server and writes its address to `addressFile`,
 * where the Bootstrap finds it. The file is removed again as the front end closes.
 * @param {{ addressFile: string, page?: string }} options `page`: the built page's folder, for tests
 * @returns {Promise<import('./front-end.js').FrontEnd & { address: string }>}
 */
export async function openInstallerPage({ addressFile, page }) {
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
        server.send({ type: 'refused', question, answer, reason: checked.refused });
        return { status: 422, body: { ok: false, reason: checked.refused } };
      }
      open.delete(question);
      server.send({ type: 'answered', question, answer: checked.value });
      asked.resolve(checked.value);
      return { status: 200, body: { ok: true } };
    },
  });
  // Written under another name and renamed, so whoever looks for it (the Bootstrap, a test)
  // never reads it empty or half-written.
  await mkdir(dirname(addressFile), { recursive: true });
  const writing = `${addressFile}.${process.pid}.partial`;
  await writeFile(writing, `${server.address}\n`);
  await rename(writing, addressFile);

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
    start(title) {
      server.send({ type: 'start', title });
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
      await rm(addressFile, { force: true });
    },
  };
}
