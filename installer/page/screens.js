// The Installer page's screens: one thing at a time, each with one heading and one control.
// Which screen shows, and what's joined into it, is pacing.js's to decide; these only draw it.
//
// Adding a screen: give pacing.js's `Screen` a kind (or a field on an existing one) and the rule
// in `screensOf` that makes it, then a case in `Screen` below. See the notes for #101.
import { useEffect, useRef, useState } from 'react';
import { CopyBox, Line, Path, Status, Words, icons } from './parts.js';
import { soFar, split } from './words.js';

/** @typedef {import('./pacing.js').Shown} Shown */
/** @typedef {import('./pacing.js').QuestionScreen} QuestionScreen */
/** @typedef {import('./pacing.js').Asked} Asked */

/**
 * What the screens can do: answer the run's open question, go back to the question before it
 * (`goBack`, while there's one to go back to), or say the person has read a notice.
 * @typedef {{ answer: (question: number, value: unknown) => Promise<void>, goBack?: () => Promise<boolean>, carryOn: (screen: number) => void, shareLogLine?: string }} Actions
 */

/**
 * Sends an answer. A refusal comes back as an event, which the screen shows, so the reply is
 * only waited for.
 * @param {number} question @param {unknown} value
 */
export async function postAnswer(question, value) {
  await fetch('answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, answer: value }) }).catch(() => undefined);
}

/**
 * Asks the run to go back to an earlier question. It says whether it has: once the questions are
 * over, or someone has just answered, it won't, and the page carries on as it was.
 * @param {number} to the question's id
 * @returns {Promise<boolean>}
 */
export async function postBack(to) {
  const response = await fetch('back', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }) }).catch(() => undefined);
  return response?.ok ?? false;
}

/**
 * Focuses the screen's control once it's on screen, so the keyboard is ready for it.
 * @param {string} selector within the screen
 */
function useFocus(selector) {
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  useEffect(() => {
    const target = ref.current?.querySelector(selector);
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }, [selector]);
  return ref;
}

/** A heading, with the line under it if there is one. @param {{ text: string }} props */
function Heading({ text }) {
  const [heading, lede] = split(text);
  return (
    <>
      <h1 className="title">
        <Line text={heading} />
      </h1>
      {lede && (
        <p className="lede">
          <Line text={lede} />
        </p>
      )}
    </>
  );
}

/**
 * What a screen that asks nothing says, for a screen reader to announce as it comes. A screen
 * that asks something puts the focus on its control instead, which is read out.
 * @param {Shown} shown
 */
export function announced(shown) {
  switch (shown.kind) {
    case 'step':
      return shown.text;
    case 'busy':
      return shown.ended?.text ?? shown.message;
    case 'ending':
      return shown.closing ?? '';
    case 'problem':
      return [...shown.problems, shown.closing ?? ''].join(' ');
    default:
      return '';
  }
}

/** @param {{ shown: Shown, actions: Actions }} props */
export function Screen({ shown, actions }) {
  switch (shown.kind) {
    case 'question':
      return <Question screen={shown} actions={actions} />;
    case 'notice':
      return <Notice title={shown.title} onContinue={() => actions.carryOn(shown.key)} body={<Words text={shown.text} />} />;
    case 'summary':
      return <Notice title={shown.title} onContinue={() => actions.carryOn(shown.key)} body={<Rows rows={shown.rows} />} />;
    case 'step':
      return (
        <>
          <Status kind="tick" />
          <h1 className="title">
            <Line text={shown.text} />
          </h1>
        </>
      );
    case 'busy':
      return <Busy screen={shown} />;
    case 'ending':
      return <Ending screen={shown} />;
    case 'problem':
      return <Stopped screen={shown} shareLogLine={actions.shareLogLine} />;
    case 'between':
      return (
        <>
          <Status kind="ring" />
          <h1 className="title quiet">
            One moment
          </h1>
        </>
      );
  }
}

/**
 * Something to read before what comes next. The run doesn't wait for it, but the page does:
 * it stays until Continue.
 * @param {{ title: string, body: import('react').ReactNode, onContinue: () => void }} props
 */
function Notice({ title, body, onContinue }) {
  const ref = useFocus('.primary');
  return (
    <div ref={/** @type {any} */ (ref)}>
      <Status kind="you" />
      <h1 className="title">{title}</h1>
      <div className="notice-body">{body}</div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onContinue();
        }}
      >
        <div className="actions">
          <button className="primary" type="submit">
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}

/** Labelled rows, such as answers kept from last time. @param {{ rows: [string, string][] }} props */
function Rows({ rows }) {
  return (
    <dl className="panel rows">
      {rows.map(([label, value], index) => (
        <div key={index} className="row">
          <dt>{label}</dt>
          <dd>
            <Line text={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Something slow: the turning ring while it runs, with a bar once its size is known, then how
 * it ended.
 * @param {{ screen: import('./pacing.js').BusyScreen }} props
 */
function Busy({ screen }) {
  const { message, received, total, ended } = screen;
  if (ended) {
    return (
      <>
        {/* An end that's neither done nor failed (Claude Code's download falling back quietly) keeps the ring: the Installer is still at it. */}
        <Status kind={ended.ok === undefined ? 'ring' : ended.ok ? 'tick' : 'warn'} />
        <Heading text={ended.text} />
      </>
    );
  }
  const sized = total !== undefined && total > 0;
  const percent = sized ? soFar(received ?? 0, total) : '';
  const megabytes = sized ? `${Math.round(total / 1_000_000)} MB` : '';
  return (
    <>
      <Status kind="ring" />
      <Heading text={message} />
      {sized && (
        <>
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={parseInt(percent, 10)} aria-valuetext={`${percent} of ${megabytes}`}>
            <i style={{ width: percent }} />
          </div>
          <p className="readout">
            <b>{percent}</b> of {megabytes}
          </p>
        </>
      )}
      {!sized && received !== undefined && (
        <p className="readout">
          <b>{soFar(received, undefined)}</b> so far
        </p>
      )}
    </>
  );
}

/**
 * A question, with whatever it's joined to: the problem it asks about (Try again or Skip for
 * now), or the notice it waits on (Done).
 * @param {{ screen: QuestionScreen, actions: Actions }} props
 */
function Question({ screen, actions }) {
  const { question, refused, problem, notice, number } = screen;
  const [sending, setSending] = useState(false);
  // A refusal hands the question back.
  useEffect(() => {
    setSending(false);
  }, [refused]);
  /** @param {unknown} value */
  const answer = (value) => {
    if (sending) return;
    setSending(true);
    actions.answer(question.question, value);
  };
  const { goBack } = actions;
  const back = goBack
    ? () => {
        if (sending) return;
        setSending(true);
        goBack().then((went) => {
          if (!went) setSending(false);
        });
      }
    : undefined;

  if (question.kind === 'done') {
    return (
      <Done
        title={notice?.title}
        text={notice?.text}
        what={question.what ?? ''}
        sending={sending}
        onDone={() => answer('done')}
      />
    );
  }
  const status = problem !== undefined ? <Status kind="warn" /> : number !== undefined ? <Status kind="number" number={number} /> : <Status kind="you" />;
  return (
    <>
      {status}
      <h1 className="title">
        <Line text={split(question.message ?? '')[0]} />
      </h1>
      {problem !== undefined && (
        <p className="lede">
          <Line text={problem} />
        </p>
      )}
      {split(question.message ?? '')[1] && (
        <p className="lede">
          <Line text={split(question.message ?? '')[1]} />
        </p>
      )}
      <Form question={question} refused={refused} sending={sending} onAnswer={answer} onBack={back} />
    </>
  );
}

/**
 * Something only the person can do elsewhere, then they say they have.
 * @param {{ title?: string, text?: string, what: string, sending: boolean, onDone: () => void }} props
 */
function Done({ title, text, what, sending, onDone }) {
  const ref = useFocus('.primary');
  return (
    <div ref={/** @type {any} */ (ref)}>
      <Status kind="you" waiting />
      <h1 className="title">{title ?? `Click Done once ${what}`}</h1>
      {text && (
        <div className="notice-body">
          <Words text={text} />
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onDone();
        }}
      >
        <div className="actions">
          <button className="primary" type="submit" disabled={sending}>
            Done
          </button>
          <span className="hint">once {what}</span>
        </div>
      </form>
    </div>
  );
}

/**
 * The control for a question: options to choose one of, Yes or No, ticks, or a folder to type.
 * The question's default is chosen already. Back, when there's a question to go back to.
 * @param {{ question: Asked, refused?: { answer: unknown, reason: string }, sending: boolean, onAnswer: (value: unknown) => void, onBack?: () => void }} props
 */
function Form({ question, refused, sending, onAnswer, onBack }) {
  const { kind } = question;
  const options = kind === 'confirm' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] : (question.options ?? []);
  const [chosen, setChosen] = useState(kind === 'confirm' ? (question.initial ? 'yes' : 'no') : String(question.initial ?? ''));
  const [ticked, setTicked] = useState(/** @type {string[]} */ (Array.isArray(question.initial) ? question.initial : []));
  const [folder, setFolder] = useState(typeof question.initial === 'string' ? question.initial : '');
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    setEdited(false);
  }, [refused]);
  const ref = useFocus(kind === 'folder' ? 'input' : kind === 'pick' ? 'input' : 'input:checked');
  const name = `q${question.question}`;
  const showRefusal = refused !== undefined && !edited;

  /** @param {import('react').FormEvent} event */
  const submit = (event) => {
    event.preventDefault();
    if (kind === 'confirm') onAnswer(chosen === 'yes');
    else if (kind === 'pick') onAnswer(options.map(({ value }) => value).filter((value) => ticked.includes(value)));
    else if (kind === 'folder') onAnswer(folder);
    else onAnswer(chosen);
  };
  /** Enter carries on from a tick box or option too, and up and down move between tick boxes. @param {import('react').KeyboardEvent<HTMLFormElement>} event */
  const keys = (event) => {
    const target = /** @type {HTMLInputElement} */ (event.target);
    if (event.key === 'Enter' && target.tagName === 'INPUT' && target.type !== 'text') {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && target.type === 'checkbox') {
      const boxes = [...event.currentTarget.querySelectorAll('input[type=checkbox]')];
      const to = boxes[boxes.indexOf(target) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (to instanceof HTMLElement) {
        event.preventDefault();
        to.focus();
      }
    }
  };

  return (
    <form ref={/** @type {any} */ (ref)} className="body" onSubmit={submit} onKeyDown={keys} noValidate>
      {kind === 'folder' ? (
        <>
          <input
            className="input"
            type="text"
            value={folder}
            placeholder={question.placeholder}
            aria-label={question.message}
            aria-invalid={showRefusal}
            aria-describedby={showRefusal ? `${name}-error` : undefined}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setFolder(event.target.value);
              setEdited(true);
            }}
          />
          {showRefusal && (
            <p className="error" id={`${name}-error`} role="alert">
              <Line text={refused.reason} />
            </p>
          )}
        </>
      ) : (
        <div className={`options${kind === 'pick' ? ' is-pick' : ''}`} role={kind === 'pick' ? 'group' : 'radiogroup'} aria-label={question.message}>
          {options.map((option) => {
            const on = kind === 'pick' ? ticked.includes(option.value) : chosen === option.value;
            return (
              <label key={option.value} className="option">
                <input
                  type={kind === 'pick' ? 'checkbox' : 'radio'}
                  name={name}
                  value={option.value}
                  checked={on}
                  onChange={(event) => {
                    if (kind !== 'pick') setChosen(option.value);
                    else setTicked(event.target.checked ? [...ticked, option.value] : ticked.filter((value) => value !== option.value));
                  }}
                />
                <span className="box" aria-hidden="true" />
                <span className="option-text">
                  <span className="option-label">
                    <Line text={option.label} />
                  </span>
                  {'hint' in option && option.hint && <span className="option-hint">{option.hint}</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}
      <div className="actions">
        <button className="primary" type="submit" disabled={sending}>
          Continue
        </button>
        <span className="hint is-key">
          or press <kbd>Enter</kbd>
        </span>
        {onBack && (
          <button className="back" type="button" disabled={sending} onClick={onBack}>
            {icons.back}
            <span>Back</span>
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * The ending, the one screen with everything at once: how it went, what to do next, and the
 * checklist. It stays, and its links keep working once the Installer has gone.
 * @param {{ screen: import('./pacing.js').EndScreen }} props
 */
function Ending({ screen }) {
  const { closing, problems, next, lines, log, summaries } = screen;
  // The closing's first sentence is the heading; the rest of it, and any line after, goes under it.
  const [first = '', ...after] = (closing ?? '').split('\n');
  const [heading, rest] = split(first);
  const more = rest ? [rest, ...after] : after;
  const checklist = summaries.find(({ title }) => title === 'Checklist');
  const others = summaries.filter((summary) => summary !== checklist);
  /** A checklist row whose step the ending says didn't work. @param {string} label */
  const failed = (label) => problems.some((problem) => problem.startsWith(`${label}: `));
  return (
    <div className="ending">
      <div>
        {closing === undefined ? <Status kind="ring" /> : <Status kind={problems.length > 0 ? 'warn' : 'tick'} />}
        <h1 className="title">
          {closing === undefined ? 'Finishing off' : <Line text={heading} />}
        </h1>
        {more.map((line, index) => (
          <p key={index} className="lede">
            <Line text={line} />
          </p>
        ))}
        {problems.length > 0 && (
          <div className="problems">
            {problems.map((problem, index) => (
              <p key={index}>
                <Line text={problem} />
              </p>
            ))}
          </div>
        )}
        {next && (
          <div className="panel next">
            <h2>{next.title}</h2>
            <Words text={next.text} className="" />
          </div>
        )}
        {lines.map((line, index) => (
          <p key={index} className="lede small">
            <Line text={line} />
          </p>
        ))}
        {log && (
          <p className="log">
            Log
            <Path path={log} />
          </p>
        )}
      </div>
      <div className="ending-side">
        {checklist && (
          <dl className="panel checklist">
            {checklist.rows.map(([label, value], index) => (
              <div key={index} className={`check${failed(label) ? ' is-bad' : ''}`} style={/** @type {any} */ ({ '--k': index })}>
                <span className="check-mark" aria-hidden="true">
                  {failed(label) ? '!' : icons.smallTick}
                </span>
                <dt>{label}</dt>
                <dd>
                  <Line text={value} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {others.map((summary) => (
          <details key={summary.title} className="more">
            <summary>{summary.title}</summary>
            <Rows rows={summary.rows} />
          </details>
        ))}
      </div>
    </div>
  );
}

/**
 * A run that stopped, or failed: what happened, what had been done, and how to send the log for
 * help, with the line that copies it.
 * @param {{ screen: import('./pacing.js').EndScreen, shareLogLine?: string }} props
 */
function Stopped({ screen, shareLogLine }) {
  const { problems, summaries, lines, closing } = screen;
  const [first = '', ...others] = problems;
  const [heading, reason] = split(first, { atColon: true });
  return (
    <>
      <Status kind="warn" />
      <h1 className="title">
        <Line text={heading} />
      </h1>
      {[...(reason ? [reason] : []), ...others, ...lines, ...(closing ? closing.split('\n') : [])].map((line, index) => (
        <p key={index} className="lede">
          <Line text={line} />
        </p>
      ))}
      {summaries.map((summary) => (
        <section key={summary.title} className="summary">
          <h2>{summary.title}</h2>
          <Rows rows={summary.rows} />
        </section>
      ))}
      {shareLogLine && (
        <div className="help">
          <p className="lede">If you need help, paste this line into PowerShell, as you did the first one, to copy your installer log. Then send it on.</p>
          <CopyBox label="Copies your installer log" text={shareLogLine} />
        </div>
      )}
    </>
  );
}
