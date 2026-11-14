// The small pieces every screen of the Installer page is made of: icons, the badge that says
// whose turn it is, the run's words with their links and paths, and the Copy button.
import { useEffect, useRef, useState } from 'react';
import { blocks, pieces } from './words.js';

export const icons = {
  mark: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 17l6-6-6-6" />
      <path d="M12 19h8" />
    </svg>
  ),
  tick: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path className="draw" d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
  smallTick: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
  ring: (
    <svg viewBox="0 0 34 34" fill="none" aria-hidden="true">
      <circle className="ring-track" cx="17" cy="17" r="15.5" />
      <circle className="ring-arc" cx="17" cy="17" r="15.5" pathLength="100" />
    </svg>
  ),
  chevron: (
    <svg className="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  ),
  out: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 5h5v5" />
      <path d="M19 5l-8 8" />
      <path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a1 1 0 0 1 1-1h10" />
    </svg>
  ),
};

/**
 * The round badge, which says whose turn it is: a question's number, the turning ring while the
 * Installer works, a tick once something's done, the blue dot when it's the person's turn, and
 * amber when something didn't work. It comes just before the screen's heading. Where the window
 * has the room, style.css hangs it in the margin, level with the heading's first line and out of
 * the flow, so the column stays where it is; in a narrow window it sits above the heading.
 * @param {{ kind: 'number' | 'ring' | 'tick' | 'you' | 'warn', number?: number, waiting?: boolean }} props
 *   `waiting`: the dot's ring breathes out, while the run waits on the person.
 */
export function Status({ kind, number, waiting = false }) {
  const inside = { number, ring: icons.ring, tick: icons.tick, you: <i />, warn: '!' }[kind];
  return (
    <div className="status">
      <span className={`badge is-${kind}${waiting ? ' is-waiting' : ''}`} aria-hidden="true">
        {inside}
      </span>
    </div>
  );
}

/**
 * One line of the run's words: its links can be clicked (they open in the person's browser),
 * and a path is set in the mono face, breaking only after a backslash.
 * @param {{ text: string }} props
 */
export function Line({ text }) {
  return (
    <>
      {pieces(text).map((piece, index) => {
        if ('url' in piece) {
          return (
            <a key={index} href={piece.url} target="_blank" rel="noopener noreferrer">
              {piece.url}
            </a>
          );
        }
        if ('path' in piece) return <Path key={index} path={piece.path} />;
        return <Commands key={index} text={piece.text} />;
      })}
    </>
  );
}

/** A Windows path, which breaks after a backslash and never inside a name. @param {{ path: string }} props */
export function Path({ path }) {
  const parts = path.split('\\');
  return (
    <span className="path">
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && (
            <>
              \<wbr />
            </>
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * Words with a slash command (/jumpstart) set as something to type. Only a word that starts with
 * the slash: the parts of a skill source (mattpocock/skills) aren't commands.
 * @param {{ text: string }} props
 */
function Commands({ text }) {
  const parts = text.split(/((?<![\w/.-])\/[a-z][a-z-]*\b)/);
  return <>{parts.map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part))}</>;
}

/**
 * A notice's text as paragraphs and bullets.
 * @param {{ text: string, className?: string }} props
 */
export function Words({ text, className = 'lede' }) {
  return (
    <>
      {blocks(text).map((block, index) =>
        'list' in block ? (
          <ul key={index} className="bullets">
            {block.list.map((item, at) => (
              <li key={at}>
                <Line text={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index} className={className}>
            <Line text={block.paragraph} />
          </p>
        ),
      )}
    </>
  );
}

/**
 * Copies `text` to the clipboard. The page is served from 127.0.0.1, which a browser counts as
 * secure, so the clipboard is there; the older way is kept for a browser that says no.
 * @param {string} text
 */
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.className = 'offscreen';
    document.body.append(box);
    box.select();
    const copied = document.execCommand('copy');
    box.remove();
    return copied;
  }
}

/**
 * A line to paste somewhere else, in the setup page's copy box, with a Copy button.
 * @param {{ label: string, text: string }} props
 */
export function CopyBox({ label, text }) {
  const [copied, setCopied] = useState(/** @type {boolean | undefined} */ (undefined));
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));
  useEffect(() => () => clearTimeout(timer.current), []);
  const click = async () => {
    const done = await copy(text);
    setCopied(done);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(undefined), 2500);
  };
  return (
    <div className="copybox">
      <div className="copybox-head">{label}</div>
      <div className="copybox-row">
        <code className="copybox-text">{text}</code>
        <button type="button" className="secondary small" onClick={click}>
          {icons.copy}
          <span>{copied === undefined ? 'Copy' : copied ? 'Copied' : 'Select it and copy'}</span>
        </button>
      </div>
      <p className="offscreen" role="status">
        {copied ? 'Copied to the clipboard.' : ''}
      </p>
    </div>
  );
}
