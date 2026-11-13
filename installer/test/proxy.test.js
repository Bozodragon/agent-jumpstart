// The Windows proxy setting, recorded once at the start of each run's log (through fake replies to
// reg.exe), so a download that fails on another network can be explained. Nothing else is done
// with it: no proxy is followed or passed to the programs the Installer runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeMachine, makeHome, readOnlyLog, runWith } from './harness.js';

const internetSettings = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const connections = `${internetSettings}\\Connections`;
const keys = {
  settings: `reg.exe query ${internetSettings}`,
  connections: `reg.exe query ${connections} /v DefaultConnectionSettings`,
};

/** reg.exe's listing of a key's values, as it prints it. @param {string} key @param {string[]} values */
const listing = (key, values) => ({
  output: ['', key.replace(/^HKCU/, 'HKEY_CURRENT_USER'), ...values.map((value) => `    ${value}`), '', ''].join('\r\n'),
});

/** The saved connection settings, with this flags byte (0x01 direct, 0x02 proxy, 0x04 PAC address, 0x08 auto-detect). @param {number} flags */
const connectionSettings = (flags) =>
  listing(connections, [`DefaultConnectionSettings    REG_BINARY    4600000002000000${flags.toString(16).padStart(2, '0')}000000${'0'.repeat(96)}`]);

/** The lines of the log that record the proxy setting. @param {string} home */
async function proxyLines(home) {
  return (await readOnlyLog(home)).text.split(/\r?\n/).filter((line) => line.includes('Windows proxy'));
}

test('a laptop with a proxy, a PAC address and auto-detection off has all four in one log line', async (t) => {
  const where = await makeHome(t);
  await fakeMachine(where.home).setReplies({
    [keys.settings]: listing(internetSettings, [
      'User Agent    REG_SZ    Mozilla/4.0 (compatible; MSIE 8.0; Win32)',
      'AutoConfigProxy    REG_SZ    wininet.dll',
      'ProxyEnable    REG_DWORD    0x1',
      'ProxyServer    REG_SZ    proxy.example.ac.uk:8080',
      'AutoConfigURL    REG_SZ    http://wpad.example.ac.uk/proxy.pac',
    ]),
    [keys.connections]: connectionSettings(0x07),
  });

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const lines = await proxyLines(where.home);
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /^\d\d:\d\d:\d\d Windows proxy: on, server: proxy\.example\.ac\.uk:8080, PAC address: http:\/\/wpad\.example\.ac\.uk\/proxy\.pac, auto-detection: off$/);
});

test('a laptop with no proxy, as on the York laptop checked, logs it off with auto-detection on', async (t) => {
  const where = await makeHome(t);
  await fakeMachine(where.home).setReplies({
    [keys.settings]: listing(internetSettings, ['ProxyEnable    REG_DWORD    0x0', 'MigrateProxy    REG_DWORD    0x1', 'AutoConfigURL    REG_SZ    ']),
    [keys.connections]: connectionSettings(0x09),
  });

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual((await proxyLines(where.home)).map((line) => line.slice(9)), [
    'Windows proxy: off, server: none, PAC address: none, auto-detection: on',
  ]);
});

test("a setting that can't be read is logged as such, and the run carries on", async (t) => {
  const where = await makeHome(t);
  await fakeMachine(where.home).setReplies({
    [keys.settings]: { code: 1, output: 'ERROR: Access is denied.\r\n' },
    [keys.connections]: { code: 1, output: 'ERROR: Access is denied.\r\n' },
  });

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const log = (await readOnlyLog(where.home)).text;
  assert.deepEqual((await proxyLines(where.home)).map((line) => line.slice(9)), [
    "Windows proxy: whether it's on, its server and its PAC address couldn't be read (ERROR: Access is denied.), auto-detection couldn't be read (ERROR: Access is denied.)",
  ]);
  assert.match(log, /Installer finished/);
  assert.doesNotMatch(result.stdout, /proxy|Access is denied/i, 'the person is told nothing about it');
});

test('connection settings never saved are logged as Windows\' default, auto-detection on', async (t) => {
  const where = await makeHome(t);
  await fakeMachine(where.home).setReplies({
    [keys.settings]: listing(internetSettings, ['ProxyEnable    REG_DWORD    0x0']),
    [keys.connections]: { code: 1, output: '\r\n\r\nERROR: The system was unable to find the specified registry key or value.\r\n' },
  });

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual((await proxyLines(where.home)).map((line) => line.slice(9)), [
    "Windows proxy: off, server: none, PAC address: none, auto-detection: on (no connection settings saved, so Windows' default)",
  ]);
});

test('a proxy that is set is only logged: only the registry is read for it, and no program is given it', async (t) => {
  const where = await makeHome(t);
  const machine = fakeMachine(where.home);
  await machine.setReplies({
    [keys.settings]: listing(internetSettings, ['ProxyEnable    REG_DWORD    0x1', 'ProxyServer    REG_SZ    proxy.example.ac.uk:8080']),
    [keys.connections]: connectionSettings(0x03),
  });

  const result = await runWith(where, 'default');

  assert.equal(result.code, 0, result.stdout + result.stderr);
  const runs = await machine.runs();
  const touchingProxy = runs.filter((run) => JSON.stringify(run).includes('Internet Settings'));
  assert.deepEqual(touchingProxy.map((run) => run.args), [
    ['query', internetSettings],
    ['query', connections, '/v', 'DefaultConnectionSettings'],
  ]);
  assert.deepEqual(runs.filter((run) => /proxy/i.test(JSON.stringify(run.env ?? {}))), [], 'no run is given a proxy');
});
