// The front end: everything the person sees and answers goes through the one `main` creates
// and passes in, the terminal front end for now. Importing a module draws nothing and changes
// nothing about the process; only creating the terminal front end does. Questions name no key,
// since how to accept a default is the front end's to show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeHome, readOnlyLog, repo, runWith, stateFolder } from './harness.js';

const sources = join(repo, 'installer', 'src');

test('importing any of the Installer’s modules prints nothing and patches neither stdout nor stderr', async () => {
  // main.js is the program itself, which runs as it's imported.
  const modules = (await readdir(sources)).filter((name) => name.endsWith('.js') && name !== 'main.js').map((name) => join(sources, name));
  const script = `
    import { pathToFileURL } from 'node:url';
    const before = [process.stdout.write, process.stderr.write, process.env.WT_SESSION];
    for (const file of JSON.parse(process.argv[1])) await import(pathToFileURL(file).href);
    const after = [process.stdout.write, process.stderr.write, process.env.WT_SESSION];
    process.exitCode = before.every((value, i) => value === after[i]) ? 0 : 3;
  `;
  const { code, stdout, stderr } = await new Promise((resolve) => {
    const env = { ...process.env };
    delete env.WT_SESSION;
    execFile(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(modules)], { env, windowsHide: true }, (error, stdout, stderr) =>
      resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    );
  });

  assert.equal(code, 0, `importing patched the process (code ${code})\n${stdout}${stderr}`);
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});

test('an error the Installer didn’t expect is told in plain words, then ends the run as before, with the stack in the log', async (t) => {
  const where = await makeHome(t);
  // A settings "file" that's a folder: it can't be read, so every question is asked, and then it
  // can't be written, which nothing expects.
  await mkdir(join(stateFolder(where.home), 'settings.json'), { recursive: true });

  const result = await runWith(where, 'default');

  assert.notEqual(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /x\s+Something went wrong that the Installer didn't expect: EISDIR/);
  assert.match(result.stdout, /The log says more: .*\.log/);
  const { text } = await readOnlyLog(where.home);
  assert.match(text, /Failed: Error: EISDIR/);
});

// What the person sees is checked through the page harness: once a run sends the page a question
// naming a key, every later wait on the page fails, so nearly every page test checks it. The
// terminal can't be checked that way (an answers-file run shows no question, and an attended one
// needs a real console), and no set of runs reaches every question (each sign-in's retry,
// Software Center's), so this reads the questions' own words too.
test('no question, and nothing waiting for the person, names a key in its own words', async () => {
  const offenders = [];
  // The terminal front end words its own prompts, `waitForDone`'s "Press Enter once …" among them.
  for (const name of (await readdir(sources)).filter((name) => name.endsWith('.js') && name !== 'terminal.js')) {
    const text = await readFile(join(sources, name), 'utf8');
    // A question's message, or what a wait is for: the front end words how to answer it.
    // (Only a ternary's first wording is caught; neither second one could name a key.)
    for (const match of text.matchAll(/(?:\bmessage:|waitForDone\()[^'"`]*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
      if (/\bEnter\b/i.test(match[2])) offenders.push(`${name}: ${match[2]}`);
    }
  }
  assert.deepEqual(offenders, []);
});
