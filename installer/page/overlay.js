// The page's scrollbars: a thin thumb drawn over the right edge of whatever is taller than its
// room, in place of the browser's own, which style.css hides everywhere. The browser's took room
// as it came and went (the column moved over by half its width on every screen that ran past the
// window's foot); this one takes none. Its size and place come from scrollbar.js.
//
// The wheel, the keys and touch scroll as ever. The thumb can be dragged too; it's hidden from
// screen readers, which have their own ways to scroll.
import { useEffect, useRef, useState } from 'react';
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
 * @param {HTMLElement | undefined} element the scroller, or none for the page itself
 * @returns {Measured | undefined}
 */
function measure(element) {
  if (!element) {
    const page = document.scrollingElement ?? document.documentElement;
    return { room: window.innerHeight, content: page.scrollHeight, scrolled: window.scrollY, top: inset, track: window.innerHeight - 2 * inset };
  }
  if (!element.isConnected) return undefined;
  return { room: element.clientHeight, content: element.scrollHeight, scrolled: element.scrollTop, top: element.offsetTop + inset, track: element.clientHeight - 2 * inset };
}

/**
 * The thumb. With `of`, it's drawn over that scroller's right edge, so it goes in the scroller's
 * offset parent (a positioned box the same height as the scroller, or one holding it); without,
 * it's the page's, fixed to the window's right edge.
 * @param {{ of?: import('react').RefObject<HTMLElement | null> }} props
 */
export function Thumb({ of }) {
  const [measured, setMeasured] = useState(/** @type {Measured | undefined} */ (undefined));
  const [bright, setBright] = useState(false);
  const drag = useRef(/** @type {{ y: number, from: number } | undefined} */ (undefined));

  useEffect(() => {
    const element = of ? of.current ?? undefined : undefined;
    if (of && !element) return;
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
    const target = element ?? window;
    target.addEventListener('scroll', scrolled, { passive: true });
    window.addEventListener('resize', update);
    // The content grows (a new screen, a terminal line) without the scroller changing size.
    const watched = element ?? document.body;
    const resized = new ResizeObserver(update);
    resized.observe(watched);
    for (const child of watched.children) resized.observe(child);
    const changed = new MutationObserver(() => {
      for (const child of watched.children) resized.observe(child);
      update();
    });
    changed.observe(watched, { childList: true, subtree: true, characterData: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(dim);
      target.removeEventListener('scroll', scrolled);
      window.removeEventListener('resize', update);
      resized.disconnect();
      changed.disconnect();
    };
  }, [of]);

  const thumb = measured && thumbOf(measured);
  if (!measured || !thumb) return null;

  /** @param {number} to */
  const scrollTo = (to) => {
    const element = of?.current;
    if (element) element.scrollTop = to;
    else window.scrollTo(0, to);
  };
  return (
    <div
      className={`thumb${of ? '' : ' is-page'}${bright || drag.current ? ' is-bright' : ''}`}
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
        const now = measure(of?.current ?? undefined);
        if (!from || !now) return;
        scrollTo(scrolledTo({ room: now.room, content: now.content, track: now.track, from: from.from, by: event.clientY - from.y }));
      }}
      onPointerUp={() => (drag.current = undefined)}
      onPointerCancel={() => (drag.current = undefined)}
    />
  );
}
