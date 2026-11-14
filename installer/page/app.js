// The Installer page: issue #66's round-two look, one thing at a time. It reads the run's events
// (installer/src/installer-page.js lists them), and pacing.js decides what's on screen and for
// how long; screens.js draws it. Addresses are relative: the page lives under the server's
// secret path.
import { StrictMode, useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { backTo } from './details.js';
import { Details } from './details-panel.js';
import { begin, onScreen, reduce, wakeAt } from './pacing.js';
import { Thumb } from './overlay.js';
import { icons } from './parts.js';
import { Screen, announced, postAnswer, postBack } from './screens.js';
import { StopButton } from './stop.js';

/** @typedef {import('./pacing.js').PageEvent} PageEvent */
/** @typedef {import('./pacing.js').Shown} Shown */

function App() {
  const [page, dispatch] = useReducer(reduce, begin);
  const connection = useRef(/** @type {number | undefined} */ (undefined));
  const [over, setOver] = useState(false);
  const scroller = useRef(/** @type {HTMLDivElement | null} */ (null));

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
    // However the run ended (a stop sends no last words), the server says so as it closes, and
    // the page stops listening rather than keep trying a server that's gone.
    events.addEventListener('closing', () => {
      events.close();
      setOver(true);
    });
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
  const back = backTo(page, shown);
  // The window never scrolls: the header stays, and under it the stage scrolls in its own room
  // when a screen is taller than that, under its own thumb. Above the screen, the space that
  // gives way first: generous while there's room, down to a little before anything scrolls.
  return (
    <div className={`app${ending ? ' is-ending' : ''}`}>
      <div className="shell is-top">
        <Header page={page} over={over} />
      </div>
      <div className="scroller" ref={scroller}>
        <div className="shell column">
          <div className="room" aria-hidden="true" />
          <Stage
            shown={shown}
            scroller={scroller}
            actions={{
              answer: postAnswer,
              goBack: back === undefined ? undefined : () => postBack(back),
              carryOn: (screen) => dispatch({ type: 'continue', screen, now: performance.now() }),
              shareLogLine: page.shareLogLine,
            }}
          />
          <div className="foot" aria-hidden="true" />
        </div>
      </div>
      <Thumb of={scroller} />
    </div>
  );
}

/**
 * The way back to the setup page, the dashes that say how far along the run is, which open the
 * Details panel, and Stop. The profile's name isn't here: it's the page's title, which an app
 * window shows in its title bar and on the taskbar, beside the >_ mark (icon.svg).
 * @param {{ page: import('./pacing.js').Page, over: boolean }} props
 */
function Header({ page, over }) {
  return (
    <header className="head">
      {page.setupPage && (
        <a className="setup" href={page.setupPage} target="_blank" rel="noopener noreferrer">
          Setup page
          {icons.out}
          <span className="offscreen"> (opens in your browser)</span>
        </a>
      )}
      <Details page={page} onChange={(question) => postBack(question)} />
      <StopButton page={page} over={over} />
    </header>
  );
}

/** How long the screen going off takes, in ms, as its style sheet animates it. */
const leavingFor = 180;

/**
 * Where the screen is: the one on screen, and for a moment the one going off, so one gives way
 * to the next. The one going off is the same element, kept as it was (with the answer just
 * given); a screen that changes in place (a busy line's figure, a notice joined by its Done)
 * stays put. What a screen says is announced from one live region that's always there.
 * @param {{ shown: Shown, actions: import('./screens.js').Actions, scroller: import('react').RefObject<HTMLDivElement | null> }} props
 */
function Stage({ shown, actions, scroller }) {
  // The screen as last drawn, and the one going off: worked out while drawing, so the outgoing
  // screen is never dropped and drawn again from scratch.
  const [current, setCurrent] = useState(shown);
  const [leaving, setLeaving] = useState(/** @type {Shown | undefined} */ (undefined));
  // A 'between' screen is made afresh each time it's asked for, so it's the same if its key is.
  if (shown !== current && !(shown.kind === 'between' && current.kind === 'between' && shown.key === current.key)) {
    if (shown.key !== current.key) setLeaving(current);
    setCurrent(shown);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(undefined), leavingFor);
    return () => clearTimeout(timer);
  }, [leaving]);
  // A new screen starts at the top, whatever was scrolled to on the one before.
  // (In braces: newer browsers return a promise from scrollTo, which React would take for a cleanup.)
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [shown.key]);
  return (
    <main className="stage">
      {leaving && leaving.key !== shown.key && (
        <section key={leaving.key} className="screen is-leaving" inert>
          <Screen shown={leaving} actions={actions} />
        </section>
      )}
      <section key={shown.key} className={`screen${shown.kind === 'question' && shown.again ? ' is-back' : ''}`}>
        <Screen shown={shown} actions={actions} />
      </section>
      <p className="offscreen" role="status">
        {announced(shown)}
      </p>
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
