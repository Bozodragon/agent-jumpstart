// Where a skill's text is, for the setup page: page/skills.json gives each skill's `source`,
// the address of its SKILL.md on GitHub. page/fetch-skill-texts.js copies the text from there into
// page/skill-texts/, except for a skill in this repository, which the build reads where it is.

/** This repository's address on GitHub, as a skill's `source` begins when the skill is ours. */
const ours = 'https://github.com/Bozodragon/agent-jumpstart/blob/main/';

/**
 * @param {string} source a skill's `source`
 * @returns {string | undefined} the path of its SKILL.md in this repository, if it's one of ours
 */
export const ownSource = (source) => (source.startsWith(ours) ? source.slice(ours.length) : undefined);

/**
 * @param {string} source a GitHub page address, `https://github.com/<owner>/<repo>/blob/<branch>/<path>`
 * @returns {string} the address of the file's own text
 */
export function rawAddress(source) {
  const match = source.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (!match) throw new Error(`${source} isn't the address of a file on GitHub.`);
  return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`;
}

/** @param {string} text */
const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * A link's address as the page links it: a full address as it is, and a file beside the skill
 * (such as `./ADR-FORMAT.md` or `workspaces/`) as that file on GitHub. Anything else, such as a
 * placeholder the skill fills in (`<address>#your-skills`), isn't a link.
 * @param {string} href @param {string} source the skill's `source`
 * @returns {string | undefined}
 */
function linkTo(href, source) {
  if (/^https?:\/\//.test(href)) return href;
  if (/^(\.{0,2}\/)?[\w.-]+(\/[\w.-]+)*\/?$/.test(href) && /[./]/.test(href)) return new URL(href, source).href;
  return undefined;
}

/**
 * One line's Markdown, as HTML: `code`, **bold**, _italic_ or *italic*, and [links](address),
 * which open in a new tab. Everything else is escaped, so a placeholder such as
 * `<question title>` shows as written.
 * @param {string} text @param {string} source
 */
function inline(text, source) {
  /** @type {string[]} */
  const codes = [];
  const marked = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _ticks, code) => {
    codes.push(`<code>${escape(code.trim())}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  return escape(marked)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, words, href) => {
      const address = linkTo(href.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'), source);
      return address ? `<a href="${escape(address)}" target="_blank" rel="noopener">${words}</a>` : words;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/\u0000(\d+)\u0000/g, (_, n) => codes[Number(n)]);
}

const fence = /^\s*(```|~~~)/;
const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const rule = /^\s*([-*_])(\s*\1){2,}\s*$/;
const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const quote = /^\s*>\s?/;

/** @param {string} line */
const indentOf = (line) => (line.match(/^\s*/)?.[0].length ?? 0);
/** @param {string} line */
const startsBlock = (line) => fence.test(line) || heading.test(line) || rule.test(line) || item.test(line) || quote.test(line);

/**
 * Markdown blocks, as HTML: headings (two levels down, so a skill's `#` sits under the box's
 * own heading), paragraphs, lists (nested by indent), fenced code, quotes and rules.
 * @param {string[]} lines @param {string} source
 * @returns {string}
 */
function blocks(lines, source) {
  /** @type {string[]} */
  const out = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at];
    if (line.trim() === '') {
      at += 1;
    } else if (fence.test(line)) {
      const mark = line.trim().slice(0, 3);
      const body = [];
      for (at += 1; at < lines.length && !lines[at].trim().startsWith(mark); at += 1) body.push(lines[at]);
      at += 1;
      const indent = Math.min(...body.filter((one) => one.trim() !== '').map(indentOf), indentOf(line));
      out.push(`<pre><code>${escape(body.map((one) => one.slice(indent)).join('\n'))}</code></pre>`);
    } else if (heading.test(line)) {
      const [, hashes, words] = /** @type {RegExpMatchArray} */ (line.match(heading));
      const level = Math.min(hashes.length + 2, 6);
      out.push(`<h${level}>${inline(words, source)}</h${level}>`);
      at += 1;
    } else if (rule.test(line)) {
      out.push('<hr>');
      at += 1;
    } else if (quote.test(line)) {
      const body = [];
      for (; at < lines.length && lines[at].trim() !== '' && (quote.test(lines[at]) || !startsBlock(lines[at])); at += 1) {
        body.push(lines[at].replace(quote, ''));
      }
      out.push(`<blockquote>${blocks(body, source)}</blockquote>`);
    } else if (item.test(line)) {
      const indent = indentOf(line);
      const ordered = /\d/.test(/** @type {RegExpMatchArray} */ (line.match(item))[2]);
      /** @type {string[][]} */
      const items = [];
      while (at < lines.length) {
        const match = lines[at].match(item);
        if (!match || indentOf(lines[at]) !== indent || /\d/.test(match[2]) !== ordered) break;
        const content = [match[3]];
        const inner = indent + match[2].length + 1;
        for (at += 1; at < lines.length; at += 1) {
          const next = lines[at];
          if (next.trim() === '') {
            // A blank line ends the item unless what follows is indented under it.
            const following = lines.slice(at + 1).find((one) => one.trim() !== '');
            if (following === undefined || indentOf(following) <= indent) break;
            content.push('');
          } else if (indentOf(next) > indent) {
            content.push(next.slice(Math.min(inner, indentOf(next))));
          } else if (!startsBlock(next) && content.at(-1) !== '') {
            content.push(next.trim());
          } else {
            break;
          }
        }
        items.push(content);
        while (at < lines.length && lines[at].trim() === '' && lines.slice(at).find((one) => one.trim() !== '')?.match(item) && indentOf(/** @type {string} */ (lines.slice(at).find((one) => one.trim() !== ''))) === indent) at += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      const rows = items.map((content) => {
        const first = content.findIndex((one, i) => i > 0 && (one === '' || startsBlock(one)));
        const lead = first === -1 ? content : content.slice(0, first);
        const rest = first === -1 ? [] : content.slice(first);
        return `<li>${inline(lead.join(' ').trim(), source)}${rest.length ? blocks(rest, source) : ''}</li>`;
      });
      out.push(`<${tag}>${rows.join('')}</${tag}>`);
    } else {
      const body = [];
      for (; at < lines.length && lines[at].trim() !== '' && (body.length === 0 || !startsBlock(lines[at])); at += 1) body.push(lines[at].trim());
      out.push(`<p>${inline(body.join(' '), source)}</p>`);
    }
  }
  return out.join('\n');
}

/**
 * A skill's SKILL.md as HTML, without its front matter (the name and description the agent
 * reads to pick it): what the agent follows once the skill is used.
 * @param {string} markdown @param {string} source the skill's `source`, which files it links to are beside
 * @returns {string}
 */
export function skillTextHtml(markdown, source) {
  const text = markdown.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
  return blocks(text.split('\n'), source);
}
