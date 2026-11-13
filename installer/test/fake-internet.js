// Loaded into the Installer with `--import` by the harness (`run`'s `internet` option), before
// the Installer's own code runs. It stands in for the internet, the way the fake machine stands
// in for Windows: every `fetch` is answered from a folder, by the file name its address ends in
// (as `--downloads` names files), or by more of its path where the folder holds that (Claude
// Code's release files, laid out as on Anthropic's server: `2.1.400/manifest.json`), and nothing
// reaches the real network. A file that isn't there is a 404. Each answer comes in small pieces
// with a pause between, like a real download, and can be cut short partway, as a dropped
// connection cuts one short. `cutShort`, `stall` and `unsized` name files by their file name.
//
// It's told what to do by AGENT_JUMPSTART_FAKE_INTERNET, as JSON (see `Internet` in harness.js).
// It may also make the Installer's output look like a terminal (`terminal`), so its spinner line
// shows, as it would in a real window.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** @type {import('./harness.js').Internet} */
const internet = JSON.parse(process.env.AGENT_JUMPSTART_FAKE_INTERNET ?? '{}');

if (internet.terminal) {
  process.stdout.isTTY = true;
  process.stdout.columns = 200;
}

/** @param {string | URL | Request} input */
globalThis.fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const parts = url.pathname.split('/').filter(Boolean);
  const name = parts.at(-1) ?? '';
  // The longest end of the address's path that the folder holds.
  /** @type {Buffer | undefined} */
  let bytes;
  for (let from = 0; from < parts.length && bytes === undefined; from++) {
    bytes = await readFile(join(internet.folder, ...parts.slice(from))).catch(() => undefined);
  }
  if (bytes === undefined) return new Response('Not Found', { status: 404, statusText: 'Not Found' });
  const chunk = internet.chunk ?? 64 * 1024;
  const cutAfter = internet.cutShort?.[name];
  const stallAfter = internet.stall?.[name];
  let sent = 0;
  const body = new ReadableStream({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, internet.pause ?? 0));
      // Nothing more ever comes, and the connection stays open, until the run is stopped.
      if (stallAfter !== undefined && sent >= stallAfter) await new Promise(() => setInterval(() => {}, 60_000));
      if (cutAfter !== undefined && sent >= cutAfter) {
        // What Node's own fetch throws when the connection drops partway through a body.
        controller.error(new TypeError('terminated'));
        return;
      }
      if (sent >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(sent + chunk, bytes.length, cutAfter ?? Infinity, stallAfter ?? Infinity);
      controller.enqueue(new Uint8Array(bytes.subarray(sent, end)));
      sent = end;
    },
  });
  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/octet-stream' };
  if (!internet.unsized?.includes(name)) headers['Content-Length'] = String(bytes.length);
  return new Response(body, { status: 200, headers });
};
