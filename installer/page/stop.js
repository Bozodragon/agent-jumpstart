// The header's Stop button. It asks "Are you sure?" first, then tells the Installer, which throws
// a Stop from whatever the run is waiting on, once a step that's installing something has
// finished (installer/src/installer-page.js); the page then shows
// what was done before it stopped. It's there until the run's last screen, and says "Stopping" in
// every window once one of them has pressed it.
import { useRef, useState } from 'react';
import { onScreen } from './pacing.js';

const square = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="5" y="5" width="14" height="14" rx="2.5" />
  </svg>
);

/**
 * @param {{ page: import('./pacing.js').Page, over: boolean }} props `over`: the Installer has
 *   said the run is over, and its server is going.
 */
export function StopButton({ page, over }) {
  const dialog = useRef(/** @type {HTMLDialogElement | null} */ (null));
  // Pressed here, before the run has said it's stopping.
  const [pressed, setPressed] = useState(false);
  const stopping = pressed || page.events.some((event) => event.type === 'stopping');
  const shown = onScreen(page);
  if (over || shown.kind === 'ending' || shown.kind === 'problem' || page.events.some((event) => event.type === 'finish')) return null;

  const ask = () => {
    dialog.current?.showModal();
    // Keep going is the safe choice, so Enter or a stray press doesn't stop the run.
    dialog.current?.querySelector(/** @type {'button'} */ ('button.secondary'))?.focus();
  };
  const stop = () => {
    dialog.current?.close();
    setPressed(true);
    fetch('stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then((response) => {
        if (!response.ok) setPressed(false);
      })
      .catch(() => setPressed(false));
  };

  return (
    <>
      <button type="button" className="stop" onClick={ask} disabled={stopping}>
        {square}
        {stopping ? 'Stopping' : 'Stop'}
      </button>
      <dialog ref={dialog} className="confirm" aria-labelledby="stop-title" aria-describedby="stop-text">
        <h2 id="stop-title" className="confirm-title">
          Are you sure?
        </h2>
        <p id="stop-text" className="lede small">
          The Installer stops as soon as it can: a step that's installing something finishes first. Anything it has already set up stays as it is, and you can run the same line again later to carry on.
        </p>
        <form method="dialog" className="actions">
          <button type="button" className="primary is-stop" onClick={stop}>
            Stop the Installer
          </button>
          <button type="submit" className="secondary">
            Keep going
          </button>
        </form>
      </dialog>
    </>
  );
}
