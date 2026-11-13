// The Installer page: issue #66's round-two look, one thing at a time. It reads the run's events
// (installer/src/installer-page.js lists them), and pacing.js decides what's on screen and for
// how long; screens.js draws it. Addresses are relative: the page lives under the server's
// secret path.
import { StrictMode, useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { begin, dashes, onScreen, reduce, wakeAt } from './pacing.js';
import { icons } from './parts.js';
import { Screen, postAnswer } from './screens.js';

/** @typedef {import('./pacing.js').PageEvent} PageEvent */
/** @typedef {import('./pacing.js').Shown} Shown */

function App() {
  const [page, dispatch] = useReducer(reduce, begin);
  const connection = useRef(/** @type {number | undefined} */ (undefined));

  useEffect(() => {
    const events = new EventSource('events');
    events.addEventListener('connection', (message) => {
      const { connection: id, before } = JSON.parse(message.data);
      connection.current = id;
      dispatch({ type: 'connected', before });
    });
    events.onmessage = (message) => {
      /** @type {PageEvent} */
      const event = { ...JSON.parse(message.data), id: Number(message.lastEventId) };
      dispatch({ type: 'event', event, now: performance.now() });
      // The run's last words: the server is about to close, and the page keeps them on screen.
      if (event.type === 'finish') events.close();
    };
    return () => events.close();
  }, []);

  // Tells the Installer how far this page has got, so it can close once the page has the end.
  useEffect(() => {
    if (page.last === 0 || connection.current === undefined) return;
    fetch('seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connection: connection.current, event: page.last }) }).catch(() => undefined);
  }, [page.last]);

  // A screen that stays a moment is looked at again when its moment is up.
  useEffect(() => {
    const due = wakeAt(page);
    if (due === undefined || !Number.isFinite(due)) return;
    const timer = setTimeout(() => dispatch({ type: 'tick', now: performance.now() }), Math.max(due - performance.now(), 0));
    return () => clearTimeout(timer);
  }, [page]);

  useEffect(() => {
    document.title = page.title;
  }, [page.title]);

  const shown = onScreen(page);
  const ending = shown.kind === 'ending';
  return (
    <div className={`shell${ending ? ' is-ending' : ''}`}>
      <Header page={page} />
      <Stage
        shown={shown}
        actions={{
          answer: postAnswer,
          carryOn: (screen) => dispatch({ type: 'continue', screen, now: performance.now() }),
          shareLogLine: page.shareLogLine,
        }}
      />
    </div>
  );
}

/**
 * The name, the way back to the setup page, and the dashes that say how far along the run is.
 * @param {{ page: import('./pacing.js').Page }} props
 */
function Header({ page }) {
  const { questions, work, ending } = dashes(page);
  const count = (/** @type {string[]} */ run) => run.filter((dash) => dash !== 'to-come' && dash !== 'now').length;
  const said = `${count(questions)} ${count(questions) === 1 ? 'question' : 'questions'} answered, ${count(work)} ${count(work) === 1 ? 'step' : 'steps'} done${ending === 'now' ? ', and finished' : ''}`;
  return (
    <header className="head">
      <div className="brand">
        <span className="mark" aria-hidden="true">
          {icons.mark}
        </span>
        <span>{page.title}</span>
      </div>
      {page.setupPage && (
        <a className="setup" href={page.setupPage} target="_blank" rel="noopener noreferrer">
          Setup page
          {icons.out}
          <span className="offscreen"> (opens in your browser)</span>
        </a>
      )}
      <div className="progress" role="img" aria-label={`How far along: ${said}`}>
        <span className="run">{questions.map((dash, index) => <i key={index} className={`dash is-${dash}`} />)}</span>
        <span className="run is-work">{work.map((dash, index) => <i key={index} className={`dash is-${dash}`} />)}</span>
        <span className="run">
          <i className={`dash is-${ending}`} />
        </span>
      </div>
    </header>
  );
}

/** How long the screen going off takes, in ms, as its style sheet animates it. */
const leavingFor = 180;

/**
 * Where the screen is: the one on screen, and for a moment the one going off, so one gives way
 * to the next. A screen that changes in place (a busy line's figure, a notice joined by its Done)
 * stays put.
 * @param {{ shown: Shown, actions: import('./screens.js').Actions }} props
 */
function Stage({ shown, actions }) {
  const [leaving, setLeaving] = useState(/** @type {Shown | undefined} */ (undefined));
  const previous = useRef(shown);
  useEffect(() => {
    const before = previous.current;
    previous.current = shown;
    if (before.key === shown.key) return;
    setLeaving(before);
    const timer = setTimeout(() => setLeaving(undefined), leavingFor);
    return () => clearTimeout(timer);
  }, [shown]);
  return (
    <main className="stage">
      {leaving && leaving.key !== shown.key && (
        <section key={`leaving-${leaving.key}`} className="screen is-leaving" inert>
          <Screen shown={leaving} actions={actions} />
        </section>
      )}
      <section key={shown.key} className="screen">
        <Screen shown={shown} actions={actions} />
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
