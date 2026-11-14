// The page's scrollbars: a thin thumb drawn over the right edge of whatever is taller than its
// room, in place of the browser's own, which style.css hides everywhere. The browser's took room
// as it came and went (the column moved over by half its width on every screen that ran past the
// window's foot); this one takes none. Its size and place come from scrollbar.js. What scrolls:
// the stage under the header (app.js), a notice's words (ScrollArea), the Details panel and the
// skills terminal. The window itself never does.
//
// The wheel, the keys and touch scroll as ever. The thumb can be dragged too; it's hidden from
// screen readers, which have their own ways to scroll.
import { useEffect, useRef, useState } from 'react';

/** @typedef {import('react').ReactNode} ReactNode */
import { scrolledTo, thumbOf } from './scrollbar.js';

/** How far the thumb keeps from each end of its track, in CSS pixels. */
const inset = 3;
/** How long, in ms, the thumb stays bright after the content last scrolled. */
const brightFor = 1200;

/**
 * What a thumb measures: how much shows, the content's height, how far it's scrolled, where its
 * track starts (from the top of the thumb's own box) and how long it is.
 * @typedef {{ room: number, content: number, scrolled: number, top: number, track: number }} Measured
 */

/**
 * @param {HTMLElement} element the scroller
 * @returns {Measured | undefined}
 */
function measure(element) {
  if (!element.isConnected) return undefined;
  return { room: element.clientHeight, content: element.scrollHeight, scrolled: element.scrollTop, top: element.offsetTop + inset, track: element.clientHeight - 2 * inset };
}

/**
 * The thumb, drawn over the scroller's right edge. It goes in the scroller's offset parent: a
 * positioned box as wide as the scroller, the same height or holding it.
 * @param {{ of: import('react').RefObject<HTMLElement | null> }} props
 */
export function Thumb({ of }) {
  const [measured, setMeasured] = useState(/** @type {Measured | undefined} */ (undefined));
  const [bright, setBright] = useState(false);
  const drag = useRef(/** @type {{ y: number, from: number } | undefined} */ (undefined));

  useEffect(() => {
    const element = of.current;
    if (!element) return;
    let frame = 0;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let dim;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setMeasured(measure(element)));
    };
    const scrolled = () => {
      update();
      setBright(true);
      clearTimeout(dim);
      dim = setTimeout(() => setBright(false), brightFor);
    };
    element.addEventListener('scroll', scrolled, { passive: true });
    window.addEventListener('resize', update);
    // The content grows (a new screen, a terminal line, a list opened) without the scroller
    // changing size. Two levels down: the stage's column keeps the scroller's height, and what's
    // in it is what grows.
    const resized = new ResizeObserver(update);
    const watch = () => {
      resized.observe(element);
      for (const child of element.children) {
        resized.observe(child);
        for (const grandchild of child.children) resized.observe(grandchild);
      }
    };
    watch();
    const changed = new MutationObserver(() => {
      watch();
      update();
    });
    changed.observe(element, { childList: true, subtree: true, characterData: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(dim);
      element.removeEventListener('scroll', scrolled);
      window.removeEventListener('resize', update);
      resized.disconnect();
      changed.disconnect();
    };
  }, [of]);

  const thumb = measured && thumbOf(measured);
  if (!measured || !thumb) return null;

  /** @param {number} to */
  const scrollTo = (to) => {
    if (of.current) of.current.scrollTop = to;
  };
  return (
    <div
      className={`thumb${bright || drag.current ? ' is-bright' : ''}`}
      style={{ top: `${measured.top + thumb.at}px`, height: `${thumb.size}px` }}
      aria-hidden="true"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { y: event.clientY, from: measured.scrolled };
        setBright(true);
      }}
      onPointerMove={(event) => {
        const from = drag.current;
        const now = of.current ? measure(of.current) : undefined;
        if (!from || !now) return;
        scrollTo(scrolledTo({ room: now.room, content: now.content, track: now.track, from: from.from, by: event.clientY - from.y }));
      }}
      onPointerUp={() => (drag.current = undefined)}
      onPointerCancel={() => (drag.current = undefined)}
    />
  );
}

/**
 * Words that scroll in their own room, under the thumb, so what's around them (a heading, a
 * button) stays in view however long they run. style.css gives the room: on a notice, whatever
 * the stage has once its heading and buttons are in.
 * @param {{ className?: string, children: ReactNode }} props
 */
export function ScrollArea({ className = '', children }) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  return (
    <div className="scroll-area">
      <div ref={ref} className={`scroll-body ${className}`}>
        {children}
      </div>
      <Thumb of={ref} />
    </div>
  );
}
