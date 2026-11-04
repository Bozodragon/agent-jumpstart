// Jumpstart's review page: published with the setup site (page/build.js copies it to
// <page address>jumpstart/review-page.js for every profile) and loaded by the small page the skill
// writes, so the agent writes only the Findings, as JSON, never this file. See docs/adr/0001. It
// builds the page into the element with id "review-page", or just before this script if there's
// none, from the JSON in the element with id "findings". Edit it here, beside SKILL.md, and publish
// the setup site when the change reaches main.
//
// The Findings (SKILL.md, "The profile", says what goes in each):
//   about     labelled items, { label, text }: Name, Email, Job title, Team.
//   work      lines, { text }: one per strand of their work. Only the first 6 are shown.
//   people    lines, { text }: one per person. Only the first 8 are shown.
//   notFound  plain-words strings, shown in one line.
// Any item can also have
//   unsure    true when the research marked it (not sure). Only then is its source shown.
//   source    where it came from, read after the word "from".
//   status    "new" or "changed", shown as a small tag: for a re-run's page of what's different.
// What they want help with and how they like things written are their own answers, so they are
// never on this page, whatever the Findings hold.
(() => {
/** The sections, in page order: their titles are what the pasted changes name. */
const SECTIONS = [
  { key: 'about', title: 'About you', labelled: true, addable: false },
  { key: 'work', title: 'Your work', limit: 6 },
  { key: 'people', title: 'People you work with', limit: 8 },
];
/** What the page copies. SKILL.md relies on both. */
const LOOKS_RIGHT = 'Looks right for now';
const HEADER = 'My profile changes (everything else is right):';
const STATUS = { new: 'new', changed: 'changed' };

const STYLE = `
  :root { color-scheme: light dark; }
  [hidden] { display: none !important; }
  body { font-family: var(--font-sans, system-ui, sans-serif); color: var(--foreground, inherit); line-height: 1.45; }
  .page { display: flex; flex-direction: column; gap: 20px; padding: 4px 0 8px; }
  .intro { margin: 0; color: var(--muted-foreground, inherit); max-width: 62ch; }
  section h2 { font-size: 15px; font-weight: 600; margin: 0 0 8px; }
  .items { display: flex; flex-direction: column; gap: 8px; }
  .item { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: start; }
  .item.labelled { grid-template-columns: 8.5em 1fr; align-items: center; }
  .item label { font-size: 13px; color: var(--muted-foreground, inherit); }
  .meta { grid-column: 1 / -1; font-size: 12px; color: var(--muted-foreground, inherit); }
  .item.labelled .meta { grid-column: 2; }
  .tag { display: inline-block; margin-right: 6px; padding: 0 6px; border-radius: 999px; font-size: 11px; border: 1px solid var(--border, #8886); }
  .tag.unsure { background: var(--warning-surface, transparent); color: var(--warning, inherit); border-color: var(--warning, currentColor); }
  input, textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 14px; color: var(--foreground, inherit); background: var(--input, transparent); border: 1px solid var(--border, #8884); border-radius: calc(var(--radius, 8px) * 0.75); padding: 6px 8px; }
  textarea { resize: none; overflow: hidden; min-height: 2.2em; display: block; }
  input:focus, textarea:focus { outline: 2px solid var(--ring, Highlight); outline-offset: 0; }
  .item.removed textarea { text-decoration: line-through; opacity: 0.55; }
  .changed input, .changed textarea { border-color: var(--accent, var(--ring, Highlight)); }
  button { font: inherit; font-size: 13px; cursor: pointer; border-radius: calc(var(--radius, 8px) * 0.75); }
  .quiet { background: none; border: 1px solid transparent; color: var(--muted-foreground, inherit); padding: 4px 8px; }
  .quiet:hover { border-color: var(--border, #8884); color: var(--foreground, inherit); }
  .add { align-self: flex-start; margin-top: 2px; }
  .notfound { margin: 0; font-size: 14px; color: var(--muted-foreground, inherit); }
  .finish { display: flex; flex-direction: column; gap: 10px; }
  .copy { align-self: flex-start; background: var(--primary, ButtonFace); color: var(--primary-foreground, ButtonText); border: none; padding: 8px 16px; font-size: 14px; font-weight: 600; }
  .copy:focus-visible { outline: 2px solid var(--ring, Highlight); outline-offset: 2px; }
  .status { margin: 0; font-size: 13px; color: var(--muted-foreground, inherit); min-height: 1.2em; }
  .status:empty { display: none; }
  .output { font-family: var(--font-mono, monospace); font-size: 13px; background: var(--code-background, transparent); color: var(--code-foreground, inherit); }
  .error { margin: 0; color: var(--destructive, inherit); }
  @media (max-width: 480px) { .item.labelled { grid-template-columns: 1fr; } .item.labelled .meta { grid-column: 1; } }
`;

const script = document.currentScript;
let page = document.getElementById('review-page');
if (!page) {
  page = document.createElement('div');
  if (script && script.parentNode) script.parentNode.insertBefore(page, script);
  else document.body.append(page);
}
page.classList.add('page');
page.replaceChildren();
const style = document.createElement('style');
style.textContent = STYLE;
document.head.append(style);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let data;
try {
  data = JSON.parse(document.getElementById('findings').textContent);
  if (!data || typeof data !== 'object') throw new Error('The Findings are not an object.');
} catch (error) {
  // One short line, so the skill sees the page as not loaded and asks in the chat instead.
  page.append(el('p', 'error', "What I found couldn't be shown here, so I'll show it in the chat."));
  console.error('The review page could not read the Findings.', error);
  return;
}

/** Every editable thing on the page, with what it started as. */
const entries = [];

function grow(area) {
  area.style.height = 'auto';
  area.style.height = area.scrollHeight + 2 + 'px';
}

/** Text as compared and copied: runs of spaces and line breaks become one space. */
function tidy(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/** The line under an item: its re-run tag, and "not sure" with its source. Sources show only on lines marked not sure. */
function meta(item) {
  const status = STATUS[item.status];
  if (!status && !item.unsure) return null;
  const line = el('div', 'meta');
  if (status) line.append(el('span', 'tag', status));
  if (item.unsure) {
    line.append(el('span', 'tag unsure', 'not sure'));
    if (tidy(item.source)) line.append(document.createTextNode('from ' + tidy(item.source)));
  }
  return line;
}

function markChanged(entry) {
  entry.row.classList.toggle('changed', tidy(entry.field.value) !== entry.original);
}

function labelledRow(section, item) {
  const row = el('div', 'item labelled');
  const id = 'review-field-' + entries.length;
  const label = el('label', '', tidy(item.label));
  label.htmlFor = id;
  const field = el('input');
  field.id = id;
  field.value = tidy(item.text);
  row.append(label, field);
  const m = meta(item);
  if (m) row.append(m);
  const entry = { section, label: tidy(item.label), original: tidy(item.text), field, row, removed: false };
  field.addEventListener('input', () => markChanged(entry));
  entries.push(entry);
  return row;
}

function lineRow(section, item, added) {
  const row = el('div', 'item');
  const field = el('textarea');
  field.rows = 1;
  field.value = tidy(item.text);
  field.setAttribute('aria-label', section.title);
  const remove = el('button', 'quiet', 'Remove');
  remove.type = 'button';
  row.append(field, remove);
  const m = meta(item);
  if (m) row.append(m);
  const entry = { section, original: tidy(item.text), field, row, removed: false, added };
  field.addEventListener('input', () => { grow(field); if (!added) markChanged(entry); });
  remove.addEventListener('click', () => {
    if (added) {
      entries.splice(entries.indexOf(entry), 1);
      row.remove();
      return;
    }
    entry.removed = !entry.removed;
    row.classList.toggle('removed', entry.removed);
    field.disabled = entry.removed;
    remove.textContent = entry.removed ? 'Undo' : 'Remove';
  });
  entries.push(entry);
  requestAnimationFrame(() => grow(field));
  return row;
}

/** A copy button with its own status line and output box. The top one and the bottom one copy the same thing. */
const finishes = [];
function finish() {
  const block = el('div', 'finish');
  const copy = el('button', 'copy', LOOKS_RIGHT);
  copy.type = 'button';
  const status = el('p', 'status');
  status.setAttribute('role', 'status');
  const output = el('textarea', 'output');
  output.readOnly = true;
  output.hidden = true;
  output.setAttribute('aria-label', 'What to paste into the chat');
  block.append(copy, status, output);
  const one = { copy, status, output };
  copy.addEventListener('click', () => copyNow(one));
  finishes.push(one);
  return block;
}

page.append(el('p', 'intro', "Here's what I found. If it looks right, copy that into the chat: you can update it any time by running /jumpstart again. Or change what's wrong, remove what you'd rather I didn't keep, add what's missing, and copy your changes. Typing in the chat works just as well."));
page.append(finish());

for (const section of SECTIONS) {
  const found = Array.isArray(data[section.key]) ? data[section.key].filter((item) => item && typeof item === 'object') : [];
  const shown = section.labelled ? found.filter((item) => tidy(item.label)) : found.filter((item) => tidy(item.text));
  const block = el('section');
  block.append(el('h2', '', section.title));
  const items = el('div', 'items');
  for (const item of section.limit ? shown.slice(0, section.limit) : shown) {
    items.append(section.labelled ? labelledRow(section, item) : lineRow(section, item, false));
  }
  block.append(items);
  if (section.addable !== false) {
    const add = el('button', 'quiet add', '+ Add a line');
    add.type = 'button';
    add.addEventListener('click', () => {
      const row = lineRow(section, { text: '' }, true);
      items.append(row);
      row.querySelector('textarea').focus();
    });
    block.append(add);
  }
  page.append(block);
}

const notFound = Array.isArray(data.notFound) ? data.notFound.map(tidy).filter(Boolean) : [];
if (notFound.length) page.append(el('p', 'notfound', "Couldn't find: " + notFound.join('; ') + '.'));

const elseBlock = el('section');
elseBlock.append(el('h2', '', 'Anything else I should know?'));
const elseField = el('textarea');
elseField.rows = 1;
elseField.setAttribute('aria-label', 'Anything else I should know?');
elseField.addEventListener('input', () => grow(elseField));
elseBlock.append(elseField);
page.append(elseBlock);
page.append(finish());

const quote = (text) => '"' + tidy(text) + '"';

function changes() {
  const lines = [];
  for (const entry of entries) {
    const now = tidy(entry.field.value);
    const where = entry.section.title;
    if (entry.label) {
      if (now !== entry.original) lines.push(`- ${where}, ${entry.label}: ${quote(now)} (was ${quote(entry.original)})`);
    } else if (entry.added) {
      if (now) lines.push(`- ${where}, added: ${quote(now)}`);
    } else if (entry.removed) {
      lines.push(`- ${where}, removed: ${quote(entry.original)}`);
    } else if (now !== entry.original) {
      lines.push(now ? `- ${where}, changed: ${quote(entry.original)} to ${quote(now)}` : `- ${where}, removed: ${quote(entry.original)}`);
    }
  }
  if (elseField.value.trim()) lines.push(`- Anything else: ${quote(elseField.value)}`);
  return lines.length ? [HEADER, ...lines].join('\n') : LOOKS_RIGHT;
}

function show(one, text, message) {
  one.output.hidden = false;
  one.output.value = text;
  grow(one.output);
  one.status.textContent = message;
}

function refresh() {
  const text = changes();
  for (const one of finishes) {
    one.copy.textContent = text === LOOKS_RIGHT ? LOOKS_RIGHT : 'Copy my changes';
    if (!one.output.hidden && one.output.value !== text) show(one, text, 'You changed something since you copied it: copy it again.');
  }
}
page.addEventListener('input', refresh);
page.addEventListener('click', refresh);

function copyNow(one) {
  const text = changes();
  show(one, text, '');
  one.output.focus();
  one.output.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch (error) { copied = false; }
  if (copied) {
    one.status.textContent = 'Copied. Paste it into the chat and send it.';
    return;
  }
  const fallback = 'This page couldn\'t copy it. Select the text below, copy it and paste it into the chat.';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => { one.status.textContent = 'Copied. Paste it into the chat and send it.'; },
      () => { one.status.textContent = fallback; one.output.select(); },
    );
  } else {
    one.status.textContent = fallback;
  }
}

refresh();
})();
