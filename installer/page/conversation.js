// What the bare page shows, folded from the Installer's events (installer/src/installer-page.js
// lists them). Plain JavaScript, no React, so it can be tested on its own. An event is folded in
// once: a stream that sends earlier events again (a reconnect) changes nothing.

/**
 * @typedef {{ id: number, type: string, [field: string]: any }} PageEvent
 *
 * @typedef {{ kind: 'line', id: number, type: 'step' | 'problem' | 'finish', text: string }
 *   | { kind: 'rows', id: number, title: string, rows: [string, string][] }
 *   | { kind: 'notice', id: number, title: string, text: string }
 *   | { kind: 'output', id: number, text: string }
 *   | { kind: 'busy', id: number, message: string, received?: number, total?: number, ended?: { text: string, ok: boolean } }
 *   | { kind: 'question', id: number, question: PageEvent, answer?: { value: unknown }, refused?: { answer: unknown, reason: string } }} Item
 *
 * @typedef {{ title: string, items: Item[], last: number }} Conversation
 */

/** @type {Conversation} */
export const empty = { title: 'Agent Jumpstart', items: [], last: 0 };

/**
 * @param {Item[]} items @param {(item: Item) => boolean} which @param {(item: any) => Item} change
 * @returns {Item[]}
 */
const changed = (items, which, change) => items.map((item) => (which(item) ? change(item) : item));

/**
 * The conversation with one more event in it. An event already folded in (a reconnect that sends
 * it again) changes nothing.
 * @param {Conversation} state @param {PageEvent} event
 * @returns {Conversation}
 */
export function fold(state, event) {
  if (event.id <= state.last) return state;
  const next = { ...state, last: event.id };
  const { items } = state;
  switch (event.type) {
    case 'start':
      return { ...next, title: event.title };
    case 'step':
    case 'problem':
    case 'finish':
      return { ...next, items: [...items, { kind: 'line', id: event.id, type: event.type, text: event.text }] };
    case 'summary':
      return { ...next, items: [...items, { kind: 'rows', id: event.id, title: event.title, rows: event.rows }] };
    case 'notice':
      return { ...next, items: [...items, { kind: 'notice', id: event.id, title: event.title, text: event.text }] };
    case 'output': {
      // A program's output, as it comes, is one block until something else is shown.
      const previous = items.at(-1);
      if (previous?.kind === 'output') return { ...next, items: [...items.slice(0, -1), { ...previous, text: previous.text + event.text }] };
      return { ...next, items: [...items, { kind: 'output', id: event.id, text: event.text }] };
    }
    case 'busy':
      return { ...next, items: [...items, { kind: 'busy', id: event.id, message: event.message }] };
    case 'progress':
      return { ...next, items: changed(items, (item) => item.kind === 'busy' && item.id === event.busy, (item) => ({ ...item, received: event.received, total: event.total })) };
    case 'ended':
      return { ...next, items: changed(items, (item) => item.kind === 'busy' && item.id === event.busy, (item) => ({ ...item, ended: { text: event.text, ok: event.ok } })) };
    case 'question':
      return { ...next, items: [...items, { kind: 'question', id: event.id, question: event }] };
    case 'answered':
      return {
        ...next,
        items: changed(items, (item) => item.kind === 'question' && item.question.question === event.question, (item) => ({ ...item, answer: { value: event.answer }, refused: undefined })),
      };
    case 'refused':
      return {
        ...next,
        items: changed(items, (item) => item.kind === 'question' && item.question.question === event.question, (item) => ({ ...item, refused: { answer: event.answer, reason: event.reason } })),
      };
    default:
      return next;
  }
}

/**
 * How far something slow has got, in words: a percentage of the total, or the amount so far.
 * Rounded down, so 100% means all of it.
 * @param {number | undefined} received @param {number | undefined} total
 */
export function soFar(received, total) {
  if (received === undefined) return '';
  if (total !== undefined && total > 0) return `${Math.min(Math.floor((received / total) * 100), 100)}%`;
  return `${(received / 1_000_000).toFixed(1)} MB`;
}
