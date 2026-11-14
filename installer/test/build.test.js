// What the published installer.zip holds (bootstrap/build.js): the Installer, the built
// Installer page with its fonts, and the Installer's own dependencies, nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { repo } from './harness.js';

const run = promisify(execFile);
const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');

test("the build ships the Installer page's bundle and its fonts, and none of React's, esbuild's or the fonts' packages", async (t) => {
  const out = await mkdtemp(join(tmpdir(), 'jumpstart-build-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  await run(process.execPath, [join(repo, 'bootstrap', 'build.js'), out], { timeout: 120_000 });
  await run(tar, ['-xf', join(out, 'installer.zip'), '-C', out]);

  const page = join(out, 'installer', 'page', 'built');
  assert.deepEqual((await readdir(page)).sort(), ['app.js', 'fonts', 'index.html', 'style.css']);
  assert.deepEqual((await readdir(join(page, 'fonts'))).sort(), [
    'instrument-sans-latin-400-normal.woff2',
    'instrument-sans-latin-500-normal.woff2',
    'instrument-sans-latin-600-normal.woff2',
    'jetbrains-mono-latin-400-normal.woff2',
  ]);
  // React is in the bundle, not beside it.
  assert.match(await readFile(join(page, 'app.js'), 'utf8'), /react/i);
  // The page's source isn't shipped, only what's built from it.
  assert.deepEqual((await readdir(join(out, 'installer', 'page'))).sort(), ['built']);
  // Only the Installer's own dependencies, the prompt library and what it needs.
  const shipped = await readdir(join(out, 'node_modules'));
  for (const name of ['react', 'react-dom', 'scheduler', 'esbuild', '@esbuild', '@fontsource', '@types', 'typescript']) {
    assert.ok(!shipped.includes(name), `node_modules/${name} is shipped: ${shipped.join(', ')}`);
  }
  assert.ok(shipped.includes('@clack'), shipped.join(', '));
});
