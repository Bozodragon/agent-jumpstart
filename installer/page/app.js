// The bare Installer page: everything the Installer sends, in order, and a plain form for the
// question that's open. The look (issue #66's round two) replaces this later; what it's sent and
// how it answers stay. Addresses are relative: the page lives under the server's secret path.
import { StrictMode, useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { empty, fold, soFar } from './conversation.js';

/** @typedef {import('./conversation.js').PageEvent} PageEvent */
/** @typedef {import('./conversation.js').Item} Item */

/**
 * Sends an answer. A refusal comes back as an event too, so nothing more is done with the reply.
 * @param {number} question @param {unknown} answer
 */
function send(question, answer) {
  return fetch('answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, answer }) }).catch(() => undefined);
}

function App() {
  const [state, dispatch] = useReducer(fold, empty);
  const connection = useRef(/** @type {number | undefined} */ (undefined));

  useEffect(() => {
    const events = new EventSource('events');
    events.addEventListener('connection', (message) => {
      connection.current = JSON.parse(message.data).connection;
    });
    events.onmessage = (message) => {
      /** @type {PageEvent} */
      const event = { ...JSON.parse(message.data), id: Number(message.lastEventId) };
      dispatch(event);
      // The run's last words: the server is about to close, and the page keeps them on screen.
      if (event.type === 'finish') events.close();
    };
    return () => events.close();
  }, []);

  // Tells the Installer how far this page has got, so it can close once the page has the end.
  useEffect(() => {
    if (state.last === 0 || connection.current === undefined) return;
    fetch('seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connection: connection.current, event: state.last }) }).catch(() => undefined);
  }, [state.last]);

  useEffect(() => {
    document.title = state.title;
  }, [state.title]);

  return (
    <main>
      <h1>{state.title}</h1>
      <ol className="events">
        {state.items.map((item) => (
          <li key={item.id} className={`event ${item.kind === 'line' ? item.type : item.kind}`}>
            <Shown item={item} />
          </li>
        ))}
      </ol>
    </main>
  );
}

/** @param {{ item: Item }} props */
function Shown({ item }) {
  switch (item.kind) {
    case 'line':
      return <>{item.text}</>;
    case 'notice':
      return (
        <>
          <h2>{item.title}</h2>
          {item.text}
        </>
      );
    case 'rows':
      return (
        <>
          <h2>{item.title}</h2>
          <table>
            <tbody>
              {item.rows.map(([label, value], index) => (
                <tr key={index}>
                  <td>{label}</td>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
    case 'output':
      return <pre className="output">{item.text}</pre>;
    case 'busy':
      return item.ended ? (
        <span className={item.ended.ok ? 'ok' : 'failed'}>{item.ended.text}</span>
      ) : (
        <>
          {item.message} <span className="muted">{soFar(item.received, item.total)}</span>
        </>
      );
    case 'question':
      return <Question item={item} />;
  }
}

/** @param {{ item: Extract<Item, { kind: 'question' }> }} props */
function Question({ item }) {
  const { question, answer, refused } = item;
  if (question.kind === 'done') {
    if (answer) return <span className="muted">Done once {question.what}.</span>;
    return (
      <>
        Click Done once {question.what}.
        <form onSubmit={(event) => (event.preventDefault(), send(question.question, 'done'))}>
          <button type="submit" autoFocus>
            Done
          </button>
        </form>
      </>
    );
  }
  if (answer) {
    return (
      <>
        {question.message} <span className="muted">{said(question, answer.value)}</span>
      </>
    );
  }
  return (
    <>
      {question.message}
      <Form question={question} />
      {refused && <p className="refused">{refused.reason}</p>}
    </>
  );
}

/** An answer in words: the options' labels, Yes or No, or the folder. @param {PageEvent} question @param {unknown} value */
function said(question, value) {
  /** @param {unknown} v */
  const label = (v) => question.options?.find((/** @type {{ value: string }} */ option) => option.value === v)?.label ?? String(v);
  if (question.kind === 'confirm') return value ? 'Yes' : 'No';
  if (question.kind === 'pick') return Array.isArray(value) && value.length > 0 ? value.map(label).join(', ') : 'None';
  return label(value);
}

/** @param {{ question: PageEvent }} props */
function Form({ question }) {
  const [choice, setChoice] = useState(question.initial);
  const [ticked, setTicked] = useState(/** @type {string[]} */ (question.initial ?? []));
  const [folder, setFolder] = useState(question.initial ?? '');
  const id = (/** @type {string} */ value) => `q${question.question}-${value}`;

  /** @param {import('react').FormEvent} event @param {unknown} answer */
  const submit = (event, answer) => {
    event.preventDefault();
    send(question.question, answer);
  };

  if (question.kind === 'confirm') {
    return (
      <form onSubmit={(event) => event.preventDefault()}>
        <div>
          <button type="button" autoFocus={question.initial === true} onClick={() => send(question.question, true)}>
            Yes
          </button>
          <button type="button" autoFocus={question.initial === false} onClick={() => send(question.question, false)}>
            No
          </button>
        </div>
      </form>
    );
  }
  if (question.kind === 'folder') {
    return (
      <form onSubmit={(event) => submit(event, folder)}>
        <input type="text" value={folder} placeholder={question.placeholder} aria-label={question.message} onChange={(event) => setFolder(event.target.value)} autoFocus />
        <button type="submit">Continue</button>
      </form>
    );
  }
  /** @type {{ value: string, label: string, hint?: string }[]} */
  const options = question.options ?? [];
  if (question.kind === 'pick') {
    return (
      <form onSubmit={(event) => submit(event, ticked)}>
        {options.map((option) => (
          <label key={option.value} htmlFor={id(option.value)}>
            <input
              id={id(option.value)}
              type="checkbox"
              checked={ticked.includes(option.value)}
              onChange={(event) => setTicked(event.target.checked ? [...ticked, option.value] : ticked.filter((value) => value !== option.value))}
            />
            {option.label}
            {option.hint && <span className="muted">{option.hint}</span>}
          </label>
        ))}
        <button type="submit">Continue</button>
      </form>
    );
  }
  return (
    <form onSubmit={(event) => submit(event, choice)}>
      {options.map((option) => (
        <label key={option.value} htmlFor={id(option.value)}>
          <input id={id(option.value)} type="radio" name={`q${question.question}`} checked={choice === option.value} onChange={() => setChoice(option.value)} />
          {option.label}
          {option.hint && <span className="muted">{option.hint}</span>}
        </label>
      ))}
      <button type="submit" autoFocus>
        Continue
      </button>
    </form>
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
