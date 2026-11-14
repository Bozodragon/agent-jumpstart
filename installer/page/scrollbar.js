// The page's own scrollbar thumb: its size and place, and where dragging it scrolls to. Plain
// JavaScript, tested on its own (installer/test/page-scrollbar.test.js, seam 3); overlay.js
// draws it.
//
// The browser's scrollbars are hidden everywhere on the page (style.css), so none takes room or
// moves the column when it comes and goes. Where something can be taller than its room, a thin
// thumb is drawn over its right edge instead. All sizes are CSS pixels.

/** The smallest the thumb gets, so it can still be seen and dragged. */
export const leastThumb = 32;

/**
 * @typedef {object} Scrolling
 * @property {number} room How much of the content shows at once (the scroller's own height).
 * @property {number} content The content's whole height.
 * @property {number} track How far the thumb can reach, end to end.
 */

/** @param {Scrolling} scrolling */
const sizeOf = ({ room, content, track }) => Math.min(track, Math.max(leastThumb, (track * room) / content));

/**
 * The thumb, or undefined when everything fits (by less than a pixel counts as fitting, since
 * fractional sizes often leave that much).
 * @param {Scrolling & { scrolled: number }} scrolling `scrolled`: how far the content is scrolled.
 * @returns {{ size: number, at: number } | undefined} `at`: how far down its track it starts.
 */
export function thumbOf({ room, content, scrolled, track }) {
  if (content - room < 1) return undefined;
  const size = sizeOf({ room, content, track });
  const share = Math.min(1, Math.max(0, scrolled / (content - room)));
  return { size, at: (track - size) * share };
}

/**
 * Where the content is scrolled to once the thumb has been dragged `by` (down, or up if
 * negative) from where it was when the content was scrolled `from`.
 * @param {Scrolling & { from: number, by: number }} drag
 */
export function scrolledTo({ room, content, track, from, by }) {
  const travel = track - sizeOf({ room, content, track });
  const most = content - room;
  if (travel <= 0) return from;
  return Math.min(most, Math.max(0, from + (by * most) / travel));
}
