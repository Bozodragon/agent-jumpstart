// Agent Jumpstart York check. Usage: node check.mjs <folder>
// Serves a test page on 127.0.0.1, writes its address to <folder>\address.txt, and logs to <folder>\log.txt:
// a heartbeat each second, what the page reports, and console programs it starts 20 s after it starts.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = process.argv[2];
const log = (line) => appendFileSync(join(folder, 'log.txt'), `${new Date().toISOString()} ${line}\n`);
log(`started pid ${process.pid} node ${process.version} stdin is a terminal: ${Boolean(process.stdin.isTTY)}`);
setInterval(() => log('alive'), 1000);

const page = `<!doctype html><meta charset="utf-8"><title>Jumpstart check</title><p>Jumpstart check. This window closes itself.</p>
<script>
const say = (what) => fetch('/report?' + new URLSearchParams(what), { method: 'POST' });
const look = () => ({ focus: document.hasFocus(), visibility: document.visibilityState,
  standalone: matchMedia('(display-mode: standalone)').matches, toolbar: window.toolbar.visible,
  chromeHeight: outerHeight - innerHeight });
say({ at: 'load', ...look() });
setTimeout(() => say({ at: '2s', ...look() }), 2000);
const events = new EventSource('/events');
events.onmessage = (event) => { if (event.data === 'close') { say({ at: 'closing' }); window.close(); setTimeout(() => say({ at: 'still-open-1s-after-close' }), 1000); } };
</script>`;

let connections = 0;
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/report') { log(`page ${url.searchParams}`); response.end(); return; }
  if (url.pathname === '/events') {
    connections += 1;
    log(`page connected #${connections}`);
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    const timer = setTimeout(() => response.write('data: close\n\n'), 8000);
    request.on('close', () => { clearTimeout(timer); log('page disconnected'); });
    return;
  }
  // Opens the page from this hidden process, as the Installer's openPage does: how=tab through rundll32
  // (the default browser), how=app through the browser named in ?browser= with --app.
  if (url.pathname === '/open' && request.method === 'POST') {
    const address = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/`;
    const [file, args] = url.searchParams.get('how') === 'app'
      ? [url.searchParams.get('browser') ?? '', [`--app=${address}`]]
      : ['rundll32.exe', ['url.dll,FileProtocolHandler', address]];
    log(`opening from the hidden process: ${url.searchParams.get('how')}`);
    spawn(file, args, { detached: true, stdio: 'ignore' }).on('error', (error) => log(`open error ${error.message}`)).unref();
    response.end();
    return;
  }
  if (url.pathname === '/') { response.writeHead(200, { 'content-type': 'text/html' }); response.end(page); return; }
  response.writeHead(204); response.end();
});

server.listen(0, '127.0.0.1', () => {
  const address = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/`;
  writeFileSync(join(folder, 'address.txt'), address);
  log(`serving ${address}`);
});

// Console programs started the way the Installer starts them (piped), with and without windowsHide.
setTimeout(() => {
  const children = [
    ['cmd.exe', ['/d', '/s', '/c', 'ver'], false],
    ['cmd.exe', ['/d', '/s', '/c', 'ver'], true],
    ['powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 3'], false],
    ['powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 3'], true],
  ];
  for (const [file, args, windowsHide] of children) {
    const child = spawn(String(file), /** @type {string[]} */ (args), { stdio: 'pipe', windowsHide: Boolean(windowsHide) });
    log(`child ${file} windowsHide=${windowsHide} started pid ${child.pid}`);
    child.on('exit', (code) => log(`child ${file} windowsHide=${windowsHide} exited ${code}`));
    child.on('error', (error) => log(`child ${file} windowsHide=${windowsHide} error ${error.message}`));
  }
}, 20000);
