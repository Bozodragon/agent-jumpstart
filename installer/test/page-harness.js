// Seam 2: the page conversation. The real Installer, run as `harness.js` runs it (a temporary home,
// the fake machine, counted time) but with no answers file, so it serves the Installer page. A
// test finds the page's address where the Bootstrap would, reads the page's events with `fetch`
// and answers with `POST`, as the page does, and checks only what the page is sent and what the
// run leaves behind.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { program, repo, stateFolder } from './harness.js';

/**
 * What the Installer sends the page: one event per front-end call, numbered in order from 1.
 * `type` says which call; the rest is that call's (see installer/src/installer-page.js).
 * @typedef {{ id: number, type: string, [field: string]: any }} PageEvent
 */

/**
 * The file the Installer writes the page's address to, in its own folder in local AppData, where
 * the Bootstrap looks for it. It's also the lock that says an Installer is running: its first line
 * is the address, its second the Installer's process id, and it's removed as the run ends.
 * @param {string} home
 */
export const addressFile = (home) => join(stateFolder(home), 'page-address.txt');

/**
 * The file the Installer writes once a page has connected, holding that page's address, so the
 * Bootstrap knows it can close the window.
 * @param {string} home
 */
export const connectedFile = (home) => join(stateFolder(home), 'page-connected.txt');

/**
 * Starts the real Installer with the page front end: `--home`, `--downloads` and no answers file.
 * Resolves once the page's address is written, with what a test needs to talk to the page.
 * @param {{ home: string, downloads: string }} where
 * @param {string} profile
 * @param {string[]} [extra] more flags, such as `--profiles <folder>`
 * @param {{ internet?: import('./harness.js').Internet }} [options] `internet`: answer the run's
 *   downloads from a folder, as `runOnline` does, with no `--downloads`
 */
export async function runOnPage(where, profile, extra = [], { internet } = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.WT_SESSION;
  delete env.AGENT_JUMPSTART_FAKE_INTERNET;
  if (internet) env.AGENT_JUMPSTART_FAKE_INTERNET = JSON.stringify(internet);
  const preload = internet ? ['--import', pathToFileURL(join(repo, 'installer', 'test', 'fake-internet.js')).href] : [];
  const downloads = internet ? [] : ['--downloads', where.downloads];
  const child = spawn(process.execPath, [...preload, program, '--profile', profile, ...extra, '--home', where.home, ...downloads], {
    env,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const killer = setTimeout(() => child.kill(), 60_000);
  /** @type {Promise<{ code: number, stdout: string, stderr: string }>} */
  const ended = new Promise((resolve) => {
    child.once('close', (code) => {
      clearTimeout(killer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
  let gone = false;
  ended.then(() => (gone = true));

  // Looked for as the Bootstrap looks: until it's there, or the run has ended without it.
  /** @type {string | undefined} */
  let address;
  while (address === undefined) {
    address = await readFile(addressFile(where.home), 'utf8').then((text) => text.split(/\r?\n/)[0].trim() || undefined, () => undefined);
    if (address === undefined) {
      if (gone) throw new Error(`the run ended without writing the page's address:\n${stdout}\n${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  const url = new URL(address);
  const page = address;

  return {
    /** The page's address, as written to the file: `http://127.0.0.1:<port>/<secret>/`. */
    address: page,
    /** How the run ended, once it has. */
    ended,
    /** The Installer's process id. */
    pid: child.pid,
    /** Ends the run at once, with nothing tidied up. */
    kill: () => child.kill(),
    /**
     * Opens one connection to the page's event stream, as a page (or a second window) does.
     * @param {{ lastEventId?: number }} [options] as a browser reconnecting sends it
     */
    connect: (options) => connect(new URL('events', page), options),
    /**
     * Answers a question, as the page does.
     * @param {number} question its id @param {unknown} answer
     * @returns {Promise<{ status: number, body: any }>}
     */
    answer: (question, answer) => post(new URL('answer', page), { question, answer }),
    /**
     * Any request to the page's server, by path from its root, for the tests of what it refuses.
     * @param {string} path such as `/<secret>/` or `/favicon.ico`
     * @param {{ method?: string, headers?: Record<string, string>, body?: string }} [init]
     */
    request: (path, init = {}) => rawRequest(url.port, path, init),
    url,
  };
}

/**
 * One connection to the event stream. Events arrive in `events` as they come; `next` waits for
 * the next one a test is looking for.
 * @param {URL} events @param {{ lastEventId?: number }} [options]
 */
export function connect(events, { lastEventId } = {}) {
  const abort = new AbortController();
  /** @type {PageEvent[]} */
  const seen = [];
  /** @type {{ match: (event: PageEvent) => boolean, resolve: (event: PageEvent) => void, from: number }[]} */
  let waiting = [];
  let closed = false;
  /** The id the server gives this connection, once its stream has opened. @type {number | undefined} */
  let id;
  /** How many events the run had sent when this connection opened. @type {number | undefined} */
  let before;
  /** @type {(error: unknown) => void} */
  let failed = () => {};
  const finished = new Promise((resolve) => (failed = resolve));

  /** @param {PageEvent} event */
  const arrive = (event) => {
    seen.push(event);
    waiting = waiting.filter((wait) => {
      if (!wait.match(event)) return true;
      wait.resolve(event);
      return false;
    });
  };

  const headers = /** @type {Record<string, string>} */ (lastEventId === undefined ? {} : { 'Last-Event-ID': String(lastEventId) });
  const reading = (async () => {
    const response = await fetch(events, { signal: abort.signal, headers });
    if (!response.ok || !response.body) throw new Error(`the event stream answered ${response.status}`);
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        /** @type {Record<string, string>} */
        const fields = {};
        for (const line of block.split('\n')) {
          const colon = line.indexOf(':');
          if (colon <= 0) continue;
          fields[line.slice(0, colon)] = line.slice(colon + 1).trimStart();
        }
        if (fields.event === 'connection') {
          ({ connection: id, before } = JSON.parse(fields.data));
          continue;
        }
        if (fields.data === undefined) continue;
        arrive({ ...JSON.parse(fields.data), id: Number(fields.id) });
      }
    }
  })().catch((error) => {
    if (!abort.signal.aborted) failed(error);
  }).finally(() => (closed = true));

  const connection = {
    /** The id the server gave this connection, once its stream has opened. */
    get id() {
      return id;
    },
    /** How many events the run had sent when the stream opened: those it sends first, as history. */
    get before() {
      return before;
    },
    /** Every event received so far, in the order received. */
    events: seen,
    /** Whether the server has ended the stream. */
    get closed() {
      return closed;
    },
    /** Resolves when the stream ends, by the server's doing or the test's. */
    reading,
    /**
     * The next event (counting from those already received, unless `fresh`) that matches.
     * @param {(event: PageEvent) => boolean} match
     * @param {{ timeout?: number, fresh?: boolean }} [options]
     * @returns {Promise<PageEvent>}
     */
    next(match, { timeout = 20_000, fresh = false } = {}) {
      if (!fresh) {
        const found = seen.find(match);
        if (found) return Promise.resolve(found);
      }
      return /** @type {Promise<PageEvent>} */ (
        Promise.race([
          new Promise((resolve) => waiting.push({ match, resolve, from: seen.length })),
          finished.then((error) => Promise.reject(error)),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`no matching event within ${timeout} ms; had:\n${seen.map((e) => JSON.stringify(e)).join('\n')}`)), timeout).unref(),
          ),
        ])
      );
    },
    /** Says this page has shown everything up to `event`, as a page does. @param {number} event */
    seen: (event) => post(new URL('seen', events), { connection: id, event }),
    /** Closes the connection, as closing the page does. */
    close: () => abort.abort(),
  };
  return connection;
}

/** @param {URL} url @param {unknown} body */
async function post(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

/**
 * A request with whatever headers a test gives, `Host` among them, which `fetch` won't let a
 * caller set.
 * @param {string} port @param {string} path
 * @param {{ method?: string, headers?: Record<string, string>, body?: string }} init
 * @returns {Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, body: string }>}
 */
async function rawRequest(port, path, { method = 'GET', headers = {}, body }) {
  const { request } = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: Number(port), path, method, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8').on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
    });
    req.once('error', reject);
    req.end(body);
  });
}

/**
 * Answers every question the page is asked, in turn, until the run's last event: each question
 * by its key from `answers` when it's there, and otherwise with the question's own default, as a
 * person pressing Continue would. Something to wait for is said to be done.
 * @param {ReturnType<typeof connect>} page
 * @param {(question: number, answer: unknown) => Promise<{ status: number, body: any }>} answer
 * @param {Record<string, unknown>} [answers]
 * @returns {Promise<PageEvent[]>} the questions asked, in order
 */
export async function answerEverything(page, answer, answers = {}) {
  /** @type {PageEvent[]} */
  const asked = [];
  let from = 0;
  for (;;) {
    const event = await page.next((e) => e.id > from && (e.type === 'question' || e.type === 'finish'));
    if (event.type === 'finish') return asked;
    from = event.id;
    asked.push(event);
    const given = event.kind === 'done' ? 'done' : event.key in answers ? answers[event.key] : event.initial;
    const { status, body } = await answer(event.question, given);
    if (status !== 200) throw new Error(`the answer to ${JSON.stringify(event)} was refused: ${status} ${JSON.stringify(body)}`);
  }
}
