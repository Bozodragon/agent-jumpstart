// The header's progress dashes, as the button that opens the Details panel: the answers given so
// far, each with Change while Back lasts, and what's been set up on this laptop. Closed by
// default; it drops from the header, the column's width, over a dimmed stage, as in issue #66's
// round-two reference. details.js works out what it lists.
import { useEffect, useRef, useState } from 'react';
import { answers, backLasts, setUp } from './details.js';
import { dashes } from './pacing.js';
import { Thumb } from './overlay.js';
import { Line, icons } from './parts.js';

/** What a screen reader hears of each row's mark. */
const said = { done: 'done', now: 'under way', bad: "didn't work" };

/**
 * @param {{ page: import('./pacing.js').Page, onChange: (question: number) => void }} props
 *   `onChange`: go back to that question.
 */
export function Details({ page, onChange }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const body = useRef(/** @type {HTMLDivElement | null} */ (null));
  // Escape closes it, and the focus goes back to the button that opened it.
  useEffect(() => {
    if (!open) return;
    /** @param {KeyboardEvent} event */
    const keys = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [open]);

  const { questions, work, ending } = dashes(page);
  const count = (/** @type {string[]} */ run) => run.filter((dash) => dash !== 'to-come' && dash !== 'now').length;
  const far = `${count(questions)} ${count(questions) === 1 ? 'question' : 'questions'} answered, ${count(work)} ${count(work) === 1 ? 'step' : 'steps'} done${ending === 'now' ? ', and finished' : ''}`;
  const given = answers(page);
  const lasts = backLasts(page);
  const laptop = setUp(page);
  const worked = laptop.rows.filter((row) => row.state === 'done').length;
  return (
    <>
      <button
        ref={toggle}
        className="progress"
        type="button"
        aria-expanded={open}
        aria-controls="details"
        aria-label={`Details. How far along: ${far}`}
        onClick={() => setOpen(!open)}
      >
        <span className="dashes" aria-hidden="true">
          <span className="run">{questions.map((dash, index) => <i key={index} className={`dash is-${dash}`} />)}</span>
          <span className="run is-work">{work.map((dash, index) => <i key={index} className={`dash is-${dash}`} />)}</span>
          <span className="run">
            <i className={`dash is-${ending}`} />
          </span>
        </span>
        <span className="progress-label">Details</span>
        {icons.chevron}
      </button>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="sheet" id="details" role="region" aria-label="Your answers, and what's set up on this laptop" hidden={!open}>
        <div className="sheet-body" ref={body}>
          <section className="part">
            <div className="part-head">
              <h2>Your answers</h2>
            </div>
            <p className="part-note">{lasts ? 'You can change these until the install starts.' : 'Fixed now the install has started.'}</p>
            {given.length === 0 ? (
              <p className="part-empty">Nothing asked yet.</p>
            ) : (
              <dl className="answers">
                {given.map((answer) => (
                  <div key={answer.question} className={`answer${answer.now ? ' is-now' : ''}`}>
                    <dt>{answer.label}</dt>
                    <dd>{answer.now ? <span className="quiet">Answering now</span> : <Line text={answer.value} />}</dd>
                    {answer.change && (
                      <button
                        className="change"
                        type="button"
                        aria-label={`Change your answer: ${answer.label}`}
                        onClick={() => {
                          setOpen(false);
                          onChange(answer.question);
                        }}
                      >
                        Change
                      </button>
                    )}
                  </div>
                ))}
              </dl>
            )}
          </section>
          <section className="part">
            <div className="part-head">
              <h2>Set up on this laptop</h2>
              <span className="part-count">{laptop.of === undefined ? (worked > 0 ? `${worked} so far` : '') : `${laptop.worked} of ${laptop.of}`}</span>
            </div>
            {laptop.rows.length === 0 ? (
              <p className="part-empty">Nothing yet: the install starts once the questions are answered.</p>
            ) : (
              <ol className="did-rows">
                {laptop.rows.map((row, index) => (
                  <li key={index} className={`did is-${row.state}`}>
                    <span className="did-mark" aria-hidden="true">
                      {row.state === 'done' ? icons.smallTick : row.state === 'bad' ? '!' : ''}
                    </span>
                    <span className="did-label">
                      <Line text={row.label} />
                      <span className="offscreen">, {said[row.state]}</span>
                    </span>
                    {row.value !== undefined && (
                      <span className="did-value">
                        <Line text={row.value} />
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
        <Thumb of={body} />
      </div>
    </>
  );
}
