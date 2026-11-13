// The Installer page's server: `node:http` on 127.0.0.1, at a port the system picks, with a
// random secret in the path of every address, so no other web page can read the run or answer it.
//
// It knows nothing of questions or steps. It keeps the run's events in order and sends all of
// them to every page that connects, as Server-Sent Events, so a reload, a reopened page or a
// second window rebuilds the same screen; and it hands each answer a page posts to whoever opened
// it (the page asker, installer-page.js).
//
//   GET  /<secret>/          the page (index.html), and its files beside it (app.js, fonts/...)
//   GET  /<secret>/events    the event stream: every event so far, then each as it's sent
//   POST /<secret>/answer    an answer, `{ question, answer }`, passed to `answer`
//   POST /<secret>/seen      `{ connection, event }`: that page has every event up to `event`
//   GET  /favicon.ico        answered with nothing, so the browser stops asking
//
// The page's files are read into memory as it opens, so nothing can change them under a running
// Installer, and the page may load nothing from anywhere else (its Content-Security-Policy says so).
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the built page is: `installer/page/built`, made by `installer/page/build.js`. */
export const builtPage = fileURLToPath(new URL('../page/built/', import.meta.url));

/** @type {Record<string, string>} */
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

/** Everything the page may load comes from its own server; it may connect nowhere else. */
const policy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const sharedHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': policy,
};

/** How long `close` waits for the pages to say they have the last event. */
const patienceAtTheEnd = 2_000;

/** The most an answer may be: a folder path, or a list of names, is far less. */
const largestPost = 64 * 1024;

/**
 * What a page posted as its answer, and what the server says back.
 * @typedef {(posted: unknown) => Promise<{ status: number, body: object }>} AnswerHandler
 */

/**
 * @typedef {object} PageServer
 * @property {string} address The page's whole address: `http://127.0.0.1:<port>/<secret>/`.
 * @property {number} port
 * @property {(event: Record<string, unknown>) => number} send Adds an event to the run's events
 *   and sends it to every connected page. Its id, which numbers the events from 1, is returned.
 * @property {() => number} connections How many pages are connected now.
 * @property {() => Promise<void>} whenConnected Resolves once a page is connected: at once if
 *   one is now, otherwise when the next one connects.
 * @property {() => Promise<void>} close Waits until each connected page says it has the last
 *   event, or about 2 seconds, then closes the server and every connection.
 */

/**
 * Reads every file of the built page into memory, by its path from the page's folder.
 * @param {string} folder
 * @returns {Promise<Map<string, { type: string, bytes: Buffer }>>}
 */
async function readPage(folder) {
  const names = await readdir(folder, { recursive: true, withFileTypes: true }).catch((error) => {
    throw new Error(`The Installer page isn't built (${folder}): ${error.message}. Run npm run build:installer-page.`);
  });
  /** @type {Map<string, { type: string, bytes: Buffer }>} */
  const files = new Map();
  for (const entry of names) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const type = types[extname(entry.name)];
    if (type) files.set(relative(folder, path).split(sep).join('/'), { type, bytes: await readFile(path) });
  }
  if (!files.has('index.html')) throw new Error(`The Installer page isn't built: there's no index.html in ${folder}. Run npm run build:installer-page.`);
  return files;
}

/**
 * Starts the server. It's open, and listening, once this resolves.
 * @param {{ answer: AnswerHandler, page?: string }} options `answer` is given every answer a page
 *   posts; `page` is the built page's folder (`builtPage`, if not given).
 * @returns {Promise<PageServer>}
 */
export async function openPageServer({ answer, page = builtPage }) {
  const files = await readPage(page);
  const secret = randomBytes(24).toString('base64url');
  /** @type {{ id: number, data: string }[]} */
  const events = [];
  /** @type {Map<number, { response: import('node:http').ServerResponse, seen: number }>} */
  const streams = new Map();
  let nextConnection = 1;
  /** Woken whenever a page says what it has seen, or goes away. @type {() => void} */
  let changed = () => {};
  /** Those waiting for a page to connect. @type {(() => void)[]} */
  let awaitingPage = [];
  let port = 0;

  /** @param {import('node:http').ServerResponse} response @param {number} status @param {object} [body] */
  const reply = (response, status, body) => {
    response.writeHead(status, { ...sharedHeaders, 'Content-Type': 'application/json; charset=utf-8' });
    response.end(body === undefined ? undefined : JSON.stringify(body));
  };

  /** @param {{ id: number, data: string }} event */
  const framed = (event) => `id: ${event.id}\ndata: ${event.data}\n\n`;

  /** @param {import('node:http').IncomingMessage} request @returns {Promise<unknown>} */
  const readJson = (request) =>
    new Promise((resolve, reject) => {
      let size = 0;
      /** @type {Buffer[]} */
      const chunks = [];
      request.on('data', (/** @type {Buffer} */ chunk) => {
        size += chunk.length;
        if (size > largestPost) {
          reject(new Error('too large'));
          request.destroy();
        } else chunks.push(chunk);
      });
      request.once('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('not JSON'));
        }
      });
      request.once('error', reject);
    });

  /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
  const stream = (request, response) => {
    const connection = nextConnection++;
    response.writeHead(200, { ...sharedHeaders, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
    // A browser reconnecting by itself says which event it had last, and gets only those after
    // it; any other connection (a reload, a second window) gets every event so far.
    const last = Number(request.headers['last-event-id']);
    const from = Number.isInteger(last) && last >= 0 ? last : 0;
    response.write(`event: connection\ndata: ${JSON.stringify({ connection })}\n\n`);
    for (const event of events) if (event.id > from) response.write(framed(event));
    streams.set(connection, { response, seen: from });
    for (const wake of awaitingPage) wake();
    awaitingPage = [];
    response.once('close', () => {
      streams.delete(connection);
      changed();
    });
  };

  /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
  const handle = async (request, response) => {
    // Only this address is answered: a page reached by any other name (a DNS rebinding, say) is
    // refused before anything else is looked at.
    if (request.headers.host !== `127.0.0.1:${port}`) return reply(response, 421, { reason: 'Wrong address.' });
    const path = new URL(request.url ?? '/', `http://127.0.0.1:${port}`).pathname;
    if (path === '/favicon.ico') {
      response.writeHead(204, sharedHeaders);
      return response.end();
    }
    const prefix = `/${secret}/`;
    if (!path.startsWith(prefix)) return reply(response, 404, { reason: 'Not found.' });
    const rest = path.slice(prefix.length);

    if (request.method === 'POST') {
      // Posted only by the page itself: a browser says where a post comes from.
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== `http://127.0.0.1:${port}`) return reply(response, 403, { reason: 'Not from the Installer page.' });
      let posted;
      try {
        posted = await readJson(request);
      } catch (error) {
        return reply(response, 400, { reason: `The answer couldn't be read: ${/** @type {Error} */ (error).message}.` });
      }
      if (rest === 'answer') {
        const { status, body } = await answer(posted);
        return reply(response, status, body);
      }
      if (rest === 'seen') {
        const { connection, event } = /** @type {{ connection?: unknown, event?: unknown }} */ (posted ?? {});
        const open = typeof connection === 'number' ? streams.get(connection) : undefined;
        if (open && typeof event === 'number') {
          open.seen = Math.max(open.seen, event);
          changed();
        }
        return reply(response, 200, { ok: true });
      }
      return reply(response, 404, { reason: 'Not found.' });
    }
    if (request.method !== 'GET') return reply(response, 405, { reason: 'Not allowed.' });
    if (rest === 'events') return stream(request, response);
    const file = files.get(rest === '' ? 'index.html' : rest);
    if (!file) return reply(response, 404, { reason: 'Not found.' });
    response.writeHead(200, { ...sharedHeaders, 'Content-Type': file.type, 'Content-Length': file.bytes.length });
    response.end(file.bytes);
  };

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) reply(response, 500, { reason: 'Something went wrong.' });
      else response.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;

  return {
    address: `http://127.0.0.1:${port}/${secret}/`,
    port,
    send(event) {
      const id = events.length + 1;
      const framedEvent = { id, data: JSON.stringify(event) };
      events.push(framedEvent);
      for (const { response } of streams.values()) response.write(framed(framedEvent));
      return id;
    },
    connections: () => streams.size,
    whenConnected: () => (streams.size > 0 ? Promise.resolve() : new Promise((resolve) => awaitingPage.push(() => resolve()))),
    async close() {
      const last = events.length;
      const allSeen = () => [...streams.values()].every(({ seen }) => seen >= last);
      const deadline = performance.now() + patienceAtTheEnd;
      while (!allSeen() && performance.now() < deadline) {
        await new Promise((resolve) => {
          changed = () => resolve(undefined);
          setTimeout(resolve, Math.max(deadline - performance.now(), 0));
        });
      }
      changed = () => {};
      await new Promise((resolve) => {
        server.close(() => resolve(undefined));
        server.closeAllConnections();
      });
    },
  };
}
