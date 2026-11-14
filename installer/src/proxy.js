// The Windows proxy setting, written once to the log at the start of each run, so a download that
// fails on another network (York's campus auto-detection, or its VPN from home) can be explained
// from the log. Only that: the Installer follows no proxy and passes none to the programs it runs
// (#70). Read with reg.exe, as the rest of the registry is (CLM-safe).
import { registryMiss, system32 } from './machine.js';
import { messageOf } from './stop.js';

const internetSettings = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

/**
 * A value from reg.exe's listing of a key, or undefined if it isn't listed. An empty string value
 * comes back as ''.
 * @param {string} output @param {string} name
 */
function valueIn(output, name) {
  const match = new RegExp(`^[ \\t]+${name}[ \\t]+REG_\\w+(?:[ \\t]+(.*))?$`, 'im').exec(output);
  return match ? (match[1] ?? '').trim() : undefined;
}

/** The first line reg.exe printed, to say why a read failed. @param {import('./machine.js').Ran} ran */
const why = (ran) => ran.output.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '') ?? `reg.exe exited with code ${ran.code}`;

/**
 * Whether a proxy is on, its server and its PAC address, as Internet Settings holds them.
 * @param {import('./machine.js').Machine} machine
 */
async function proxyAndPac(machine) {
  // A failure is logged here in plain words, so the machine logs it only in a debug run.
  const ran = await machine.run(system32('reg.exe'), ['query', internetSettings], { expected: () => true });
  if (ran.code !== 0) return `whether it's on, its server and its PAC address couldn't be read (${why(ran)})`;
  const on = Number(valueIn(ran.output, 'ProxyEnable') ?? 0) !== 0;
  const server = valueIn(ran.output, 'ProxyServer') || 'none';
  const pac = valueIn(ran.output, 'AutoConfigURL') || 'none';
  return `${on ? 'on' : 'off'}, server: ${server}, PAC address: ${pac}`;
}

/**
 * Whether auto-detection (WPAD) is on: the 0x08 flag in the ninth byte of the connection settings
 * Windows saves. With none saved, Windows' default applies, which is on.
 * @param {import('./machine.js').Machine} machine
 */
async function autoDetection(machine) {
  const ran = await machine.run(system32('reg.exe'), ['query', `${internetSettings}\\Connections`, '/v', 'DefaultConnectionSettings'], { expected: () => true });
  if (ran.code !== 0 && !registryMiss(ran)) return `auto-detection couldn't be read (${why(ran)})`;
  const saved = ran.code === 0 ? valueIn(ran.output, 'DefaultConnectionSettings') : undefined;
  if (!saved) return "auto-detection: on (no connection settings saved, so Windows' default)";
  const flags = Number.parseInt(saved.slice(16, 18), 16);
  if (Number.isNaN(flags)) return `auto-detection couldn't be read (the connection settings are too short: ${saved})`;
  return `auto-detection: ${flags & 0x08 ? 'on' : 'off'}`;
}

/**
 * Writes the Windows proxy setting to the log as one line. A setting that can't be read is said
 * to be so in that line, and never stops the run.
 * @param {import('./machine.js').Machine} machine @param {import('./log.js').Log} log
 */
export async function logProxySetting(machine, log) {
  /** @param {(machine: import('./machine.js').Machine) => Promise<string>} read */
  const part = (read) => read(machine).catch((error) => `couldn't be read (${messageOf(error)})`);
  // One after the other: the fake machine records each run by rewriting one file.
  const proxy = await part(proxyAndPac);
  log.write(`Windows proxy: ${proxy}, ${await part(autoDetection)}`);
}
