// Seam 3: the Installer page's scrollbars (installer/page/scrollbar.js). Where something can be
// taller than its room (the page in a small window, the Details panel, the skills terminal), the
// browser's own scrollbar is hidden, so it never takes room or moves the column, and the page
// draws a thin thumb over the content instead. These are the thumb's size and place, and where
// dragging it scrolls to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrolledTo, thumbOf } from '../page/scrollbar.js';

test('nothing to scroll shows no thumb', () => {
  assert.equal(thumbOf({ room: 600, content: 600, scrolled: 0, track: 600 }), undefined);
  assert.equal(thumbOf({ room: 600, content: 400, scrolled: 0, track: 600 }), undefined);
  // Less than a pixel over, as fractional sizes leave it, isn't something to scroll.
  assert.equal(thumbOf({ room: 600, content: 600.6, scrolled: 0, track: 600 }), undefined);
});

test("the thumb is the room's share of the content, and moves from the track's top to its bottom", () => {
  // Half the content fits: half the track, at the top, then at the bottom.
  assert.deepEqual(thumbOf({ room: 500, content: 1000, scrolled: 0, track: 500 }), { size: 250, at: 0 });
  assert.deepEqual(thumbOf({ room: 500, content: 1000, scrolled: 500, track: 500 }), { size: 250, at: 250 });
  assert.deepEqual(thumbOf({ room: 500, content: 1000, scrolled: 250, track: 500 }), { size: 250, at: 125 });
  // A shorter track (inset from the ends) keeps the same share.
  assert.deepEqual(thumbOf({ room: 500, content: 1000, scrolled: 500, track: 400 }), { size: 200, at: 200 });
});

test('a long content still gets a thumb big enough to see and drag, which stays inside its track', () => {
  assert.deepEqual(thumbOf({ room: 300, content: 30000, scrolled: 0, track: 300 }), { size: 32, at: 0 });
  assert.deepEqual(thumbOf({ room: 300, content: 30000, scrolled: 29700, track: 300 }), { size: 32, at: 268 });
  // Scrolled past the end (an overscroll bounce), it stops at the end.
  assert.deepEqual(thumbOf({ room: 300, content: 30000, scrolled: 31000, track: 300 }), { size: 32, at: 268 });
  assert.deepEqual(thumbOf({ room: 300, content: 30000, scrolled: -40, track: 300 }), { size: 32, at: 0 });
});

test('dragging the thumb by some distance scrolls the content by its share of that distance', () => {
  // Half the content fits: the thumb has 250 to travel and the content 500, so twice as far.
  assert.equal(scrolledTo({ room: 500, content: 1000, track: 500, from: 100, by: 50 }), 200);
  assert.equal(scrolledTo({ room: 500, content: 1000, track: 500, from: 100, by: -80 }), 0);
  assert.equal(scrolledTo({ room: 500, content: 1000, track: 500, from: 400, by: 120 }), 500);
  // With the least thumb, the travel is what's left of the track.
  assert.equal(scrolledTo({ room: 300, content: 30000, track: 300, from: 0, by: 134 }), 14850);
});
