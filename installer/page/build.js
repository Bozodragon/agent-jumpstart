#!/usr/bin/env node
// Builds the Installer page into installer/page/built, which the Installer serves
// (installer/src/page-server.js) and bootstrap/build.js ships in installer.zip:
//
//   index.html, style.css  copied as they are
//   app.js                 the page's code (app.js and what it imports, React among it), bundled
//                          by esbuild into one file
//   fonts/*.woff2          Instrument Sans and JetBrains Mono (OFL), from their @fontsource
//                          packages, so the page loads no font from the internet
//
//   node installer/page/build.js [<folder>]     (default: installer/page/built)
//
// React, esbuild and the fonts are the repo's devDependencies, never the Installer's own, so the
// zip ships what they build and none of them.
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..', '..');
export const builtFolder = join(here, 'built');

/** The fonts the page's style sheet names, as each @fontsource package holds them. */
export const fonts = [
  'instrument-sans/files/instrument-sans-latin-400-normal.woff2',
  'instrument-sans/files/instrument-sans-latin-500-normal.woff2',
  'instrument-sans/files/instrument-sans-latin-600-normal.woff2',
  'jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
];

/**
 * Builds the page into `out`, replacing whatever was there.
 * @param {string} [out]
 */
export async function buildPage(out = builtFolder) {
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, 'fonts'), { recursive: true });
  await build({
    entryPoints: [join(here, 'app.js')],
    outfile: join(out, 'app.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['chrome120', 'edge120'],
    loader: { '.js': 'jsx' },
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    legalComments: 'none',
    logLevel: 'warning',
  });
  for (const name of ['index.html', 'style.css']) await copyFile(join(here, name), join(out, name));
  for (const font of fonts) await copyFile(join(repo, 'node_modules', '@fontsource', font), join(out, 'fonts', font.split('/').at(-1) ?? font));
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = await buildPage(process.argv[2]);
  console.log(`Built the Installer page in ${out}`);
}
