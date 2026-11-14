// The one terminal on the Installer page: the skills installer's own output, drawn as the person
// would see it in a window of their own, so they recognise a skill install when they next meet
// one (issue #66). ansi.js turns what it printed into styled lines; this draws them.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { draw } from './ansi.js';
import { Thumb } from './overlay.js';
import { icons } from './parts.js';

/** What the panel's title bar says, as a window's would. */
const title = 'Skills installer';

/**
 * Characters the terminal's font may not have (arrows, ticks, warning signs, shapes), which a
 * browser takes from another font, wider or narrower. Each is set in a cell one character wide,
 * as a terminal sets it, so the boxes the CLI draws around them still line up. Box-drawing and
 * block characters aren't: the font has them, and in cells they wouldn't join up.
 */
const odd = /[←-⇿⌀-⏿■-◿☀-➿]/u;

/**
 * A colour from ansi.js as CSS: the first 16 are the panel's theme (style.css), the rest the
 * standard 256-colour cube and greys, or the colour given exactly.
 * @param {import('./ansi.js').Colour} colour
 */
function css(colour) {
  if (typeof colour === 'string') return colour;
  if (colour < 16) return `var(--ansi-${colour})`;
  if (colour >= 232) {
    const grey = 8 + (colour - 232) * 10;
    return `rgb(${grey}, ${grey}, ${grey})`;
  }
  const levels = [0, 95, 135, 175, 215, 255];
  const n = colour - 16;
  return `rgb(${levels[Math.floor(n / 36)]}, ${levels[Math.floor(n / 6) % 6]}, ${levels[n % 6]})`;
}

/** @param {import('./ansi.js').Span} span @returns {import('react').CSSProperties | undefined} */
function lookOf({ fg, bg, inverse }) {
  const color = inverse ? (bg === undefined ? 'var(--term-bg)' : css(bg)) : fg === undefined ? undefined : css(fg);
  const background = inverse ? (fg === undefined ? 'var(--term-text)' : css(fg)) : bg === undefined ? undefined : css(bg);
  if (color === undefined && background === undefined) return undefined;
  return { color, backgroundColor: background };
}

/** @param {import('./ansi.js').Span} span */
const classOf = ({ bold, dim, italic, underline, strike }) =>
  [bold && 't-bold', dim && 't-dim', italic && 't-italic', underline && 't-under', strike && 't-strike'].filter(Boolean).join(' ') || undefined;

/**
 * A span's text, with any character the font may lack in a cell of its own, and each run of full
 * blocks (the logo) drawn as one box that wide: side by side, block glyphs show hairline seams
 * where a browser smooths their edges, which a terminal's never do.
 * @param {{ text: string }} props
 */
function Text({ text }) {
  if (!odd.test(text) && !text.includes('█')) return text;
  return text.split(/(█+)/u).flatMap((part, index) => {
    if (part.startsWith('█')) return [<span key={index} className="t-blk" style={{ width: `${part.length}ch` }} aria-hidden="true" />];
    if (!odd.test(part)) return [part];
    return [...part].map((char, at) => (odd.test(char) ? <span key={`${index}.${at}`} className="t-cell">{char}</span> : char));
  });
}

/**
 * @param {{ text: string, running: boolean }} props `text`: everything the skills installer has
 *   printed so far. `running`: whether it still is, which shows a cursor after it.
 */
export function Terminal({ text, running }) {
  const lines = useMemo(() => draw(text), [text]);
  const view = useRef(/** @type {HTMLDivElement | null} */ (null));
  // The newest line stays in view, as in a terminal, unless the person has scrolled back to read.
  // It isn't a live region: a spinner redrawing would be read out on every frame, and the heading
  // above already says what's happening.
  const following = useRef(true);
  useLayoutEffect(() => {
    if (following.current && view.current) view.current.scrollTop = view.current.scrollHeight;
  }, [lines, running]);
  const onScroll = () => {
    const at = view.current;
    if (at) following.current = at.scrollTop + at.clientHeight >= at.scrollHeight - 4;
  };
  const cursor = running && <span className="t-caret" aria-hidden="true" />;
  // After the last line break (whatever codes come after it), or else at the end of the last line.
  const endsLine = lines.length === 0 || /\n(?:\x1b\[[0-9;?]*[A-Za-z])*$/.test(text);
  return (
    <div className="term">
      <div className="term-head">
        <span className="term-icon" aria-hidden="true">
          {icons.mark}
        </span>
        {title}
      </div>
      <div className="term-body" tabIndex={0} role="region" aria-label={`${title} output`} ref={view} onScroll={onScroll}>
        {lines.map((line, index) => (
          <div key={index} className={`t-line${line.some((span) => /[═-╬▀-▟]/u.test(span.text)) ? ' t-blocks' : ''}`}>
            {line.map((span, at) => (
              <span key={at} className={classOf(span)} style={lookOf(span)}>
                <Text text={span.text} />
              </span>
            ))}
            {index === lines.length - 1 && !endsLine && cursor}
          </div>
        ))}
        {endsLine && <div className="t-line">{cursor}</div>}
      </div>
      <Thumb of={view} />
    </div>
  );
}
