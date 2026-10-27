#!/usr/bin/env node
// Builds the folder published as one public Portall item:
//
//   york.ps1, install.ps1, york-debug.ps1, share-log.ps1  the pasted lines, copied as they are
//   installer.zip  the Node program with everything it reads at run time and its
//                  production dependencies, which the bootstrap unpacks and runs
//
//   node bootstrap/build.js [<folder>]     (default: dist/portall)
//
// The zip is laid out like the repo, so the program finds `profiles/` and `manifest.json`
// where it does in a checkout. Anything new the program reads at run time goes in `shipped`.
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const repo = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(repo, 'dist', 'portall');
const pastedLines = ['york.ps1', 'install.ps1', 'york-debug.ps1', 'share-log.ps1'];
const shipped = ['installer/package.json', 'installer/src', 'profiles', 'manifest.json'];

/** @param {string} path @returns {Promise<string[]>} every file under path, or path itself */
async function filesUnder(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => undefined);
  if (!entries) return [path];
  const nested = await Promise.all(
    entries.filter((entry) => !entry.isSymbolicLink()).map((entry) => filesUnder(join(path, entry.name))),
  );
  return nested.flat();
}

/**
 * The installer's production dependencies, found the way Node would from the repo root.
 * @returns {Promise<string[]>} package folders relative to the repo
 */
async function dependencyFolders() {
  const found = new Set();
  /** @param {string} manifestPath */
  const visit = async (manifestPath) => {
    const { dependencies = {} } = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const name of Object.keys(dependencies)) {
      const folder = join('node_modules', name);
      if (found.has(folder)) continue;
      found.add(folder);
      await visit(join(repo, folder, 'package.json'));
    }
  };
  await visit(join(repo, 'installer', 'package.json'));
  return [...found].sort();
}

/**
 * A plain zip (deflate, no extras) with a fixed timestamp, so the same files give the same bytes.
 * @param {{ name: string, data: Buffer }[]} entries
 */
function zip(entries) {
  const dosTime = 0;
  const dosDate = (0 << 9) | (1 << 5) | 1; // 1 January 1980
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(dosTime, 10);
    header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, packed);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(dosTime, 12);
    record.writeUInt16LE(dosDate, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(packed.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBytes);
    offset += header.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const name of pastedLines) await cp(join(repo, 'bootstrap', name), join(out, name));

const roots = [...shipped, ...(await dependencyFolders())].map((path) => join(repo, path));
const files = (await Promise.all(roots.map(filesUnder))).flat().sort();
const entries = await Promise.all(
  files.map(async (file) => ({ name: relative(repo, file).split(sep).join('/'), data: await readFile(file) })),
);
await writeFile(join(out, 'installer.zip'), zip(entries));
console.log(`Built ${out}: ${pastedLines.join(', ')} and installer.zip (${entries.length} files)`);
