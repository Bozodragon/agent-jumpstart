// PROTOTYPE, throwaway. Variant C, "The checklist fills in".
//
// Two regions. The rail holds the run's checklist from the first moment: every row the ending
// will show, empty until the run reaches it. The stage holds whatever is being dealt with now.
// An answer that decides a row is written against that row straight away (dimmer, not yet done);
// an answer with no row of its own goes in "About you" above the checklist.
// At the ending the two regions swap weight: the checklist takes most of the page.
(function () {
  'use strict';

  const TICK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.6 8.4l2.9 2.9 5.9-6.6"/></svg>';
  const BANG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.8v5"/><path d="M8 11.9v.2"/></svg>';
  const LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>';
  const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  // What a row's marker means, for someone who can't see it.
  const SAY = { empty: 'not started', planned: 'answered, not started', work: 'in progress', you: 'waiting for you', done: 'done', bad: "didn't work" };

  // Answers with no checklist row of their own, and the short label each gets in "About you".
  const ABOUT = { team: 'Team', aiExperience: 'AI tools', codingExperience: 'Code', googleDriveFolder: 'Google Drive' };
  // Answers that decide a checklist row.
  const PLANS = { topWorkspace: 'Workspaces', github: 'GitHub', connectors: 'Connectors' };
  // Which row each piece of work belongs to, and which screens finish their row.
  const ROW_OF = { git: 'Git', checkClaude: 'Claude Code', downloadClaude: 'Claude Code', signInNotice: 'Claude Code', signIn: 'Claude Code', signInProblem: 'Claude Code', installT3: 'T3 Code', appsScriptSetting: 'Apps Script' };
  const CLOSES = { git: true, signIn: true, installT3: true, appsScriptSetting: true };

  const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // Paths are set in the mono face, as on the setup page.
  const rich = (text) => esc(text).replace(/[A-Za-z]:\\.*$/, '<span class="c-path">$&</span>');
  const list = (items) => (items.length === 0 ? 'None' : items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
  const mark = (state, number) => (state === 'done' ? TICK : state === 'bad' ? BANG : state === 'num' ? String(number) : '');

  window.PROTO.register({ key: 'C', name: 'The checklist fills in', mount });

  function mount(root, { flow, startAt, onScreen }) {
    const screens = flow.screens;
    const byId = Object.fromEntries(screens.map((screen) => [screen.id, screen]));
    const ending = byId.ending;
    const labels = ending.checklist.map((row) => row[0]);
    const questions = screens.filter((screen) => ['choose', 'confirm', 'pick', 'folder'].includes(screen.kind));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const S = {
      answers: {},
      rows: Object.fromEntries(labels.map((label) => [label, { s: 'empty', v: '', pct: null }])),
      live: null, // the row the stage is about
      skipped: false,
      tries: 0,
      quiet: true, // no fill-in motion while catching up to `startAt`
    };
    let primary = null; // what Enter does on the current screen
    let timers = [];
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));
    const clearTimers = () => { timers.forEach(clearTimeout); timers.forEach(clearInterval); timers = []; };

    // ---- The page's two regions ----
    root.innerHTML = `
      <div class="c-app">
        <aside class="c-rail">
          <div class="c-brand"><span class="c-logo">${LOGO}</span><span>${esc(flow.title)}</span></div>
          <h1 class="c-closing" tabindex="-1" hidden></h1>
          <button type="button" class="c-strip" aria-expanded="false" aria-controls="c-rail-body">
            <span class="c-dots" aria-hidden="true">${labels.map(() => '<i data-s="empty"></i>').join('')}</span>
            <span class="c-strip-now"></span>
            <span class="c-strip-count"></span>
            <span class="c-strip-chevron">${CHEVRON}</span>
          </button>
          <div class="c-rail-body" id="c-rail-body">
            <section class="c-about">
              <div class="c-head"><h2>About you</h2></div>
              <dl class="c-panel c-about-list">
                ${Object.entries(ABOUT).map(([id, label]) => `<div class="c-about-row" data-id="${id}"><dt>${label}</dt><dd></dd></div>`).join('')}
              </dl>
            </section>
            <section class="c-check">
              <div class="c-head"><h2>Set up on this laptop</h2><span class="c-count"></span></div>
              <ol class="c-panel c-rows">
                ${labels.map((label) => `
                  <li class="c-row" data-s="empty" data-label="${esc(label)}">
                    <span class="c-mk" data-s="empty"></span>
                    <span class="c-row-label">${esc(label)}<span class="c-vh"></span></span>
                    <span class="c-row-value"></span>
                    <span class="c-row-bar" aria-hidden="true"></span>
                  </li>`).join('')}
              </ol>
            </section>
          </div>
        </aside>
        <main class="c-stage"></main>
      </div>`;
    const app = root.querySelector('.c-app');
    const rail = root.querySelector('.c-rail');
    const stage = root.querySelector('.c-stage');
    const strip = root.querySelector('.c-strip');
    const rowEls = Object.fromEntries([...root.querySelectorAll('.c-row')].map((el) => [el.dataset.label, el]));
    const dots = [...root.querySelectorAll('.c-dots i')];

    strip.addEventListener('click', () => {
      const open = rail.classList.toggle('c-rail--open');
      strip.setAttribute('aria-expanded', String(open));
    });

    // ---- The checklist ----
    const finalValue = (label) => {
      if (label === 'Connectors' && S.answers.connectors) return list(S.answers.connectors);
      return ending.checklist.find((row) => row[0] === label)[1];
    };

    function setRow(label, state, value, still) {
      const row = S.rows[label];
      const changed = value !== undefined && value !== row.v;
      row.s = state;
      if (value !== undefined) row.v = value;
      const el = rowEls[label];
      el.dataset.s = state;
      el.classList.toggle('c-row--live', S.live === label);
      el.classList.toggle('c-row--bar', row.pct !== null);
      el.style.setProperty('--pct', `${row.pct ?? 0}%`);
      const mk = el.querySelector('.c-mk');
      if (mk.dataset.s !== state) { mk.dataset.s = state; mk.innerHTML = mark(state); }
      el.querySelector('.c-vh').textContent = `, ${SAY[state]}`;
      const valueEl = el.querySelector('.c-row-value');
      if (changed) {
        valueEl.innerHTML = rich(row.v);
        if (!S.quiet && !still) { valueEl.classList.remove('c-pop'); void valueEl.offsetWidth; valueEl.classList.add('c-pop'); }
      }
      paintStrip();
    }

    function paintStrip() {
      const reached = labels.filter((label) => S.rows[label].s === 'done' || (S.rows[label].s === 'bad' && S.live !== label)).length;
      labels.forEach((label, i) => { dots[i].dataset.s = S.rows[label].s; });
      root.querySelector('.c-count').textContent = `${reached} of ${labels.length}`;
      root.querySelector('.c-strip-count').textContent = `${reached} of ${labels.length}`;
      root.querySelector('.c-strip-now').textContent = S.live ?? '';
    }

    function setLive(label) {
      const before = S.live;
      S.live = label;
      if (before && before !== label) setRow(before, S.rows[before].s);
      if (label) setRow(label, S.rows[label].s);
      paintStrip();
    }

    // ---- What an answer or a finished piece of work writes into the rail ----
    function answer(screen, value) {
      S.answers[screen.id] = value;
      const text = screen.kind === 'pick' ? list(value)
        : screen.kind === 'confirm' ? (value ? 'Yes' : 'No')
        : screen.kind === 'folder' ? value
        : screen.options.find((option) => option.value === value).label;
      if (ABOUT[screen.id]) {
        const dd = root.querySelector(`.c-about-row[data-id="${screen.id}"] dd`);
        dd.innerHTML = rich(text);
        dd.parentElement.classList.add('c-about-row--set');
        if (!S.quiet) { dd.classList.remove('c-pop'); void dd.offsetWidth; dd.classList.add('c-pop'); }
      }
      if (PLANS[screen.id]) setRow(PLANS[screen.id], 'planned', text);
    }

    // The row as it stands once this screen is behind us.
    // `lit` keeps the row lit while the stage still shows its last line.
    function settle(screen, lit) {
      const label = ROW_OF[screen.id];
      if (!label) return;
      if (CLOSES[screen.id]) {
        S.rows[label].pct = null;
        if (S.live === label && !lit) S.live = null;
        setRow(label, 'done', finalValue(label));
      } else if (screen.id === 'downloadClaude') {
        S.rows[label].pct = null;
        // Between the download and the sign-in, this is exactly where Claude Code stands.
        setRow(label, S.rows[label].s === 'empty' ? 'work' : S.rows[label].s, ending.ifSignInSkipped.row[1]);
      }
    }

    function finishRest(then) {
      const rest = labels.filter((label) => !['done', 'bad'].includes(S.rows[label].s));
      rest.forEach((label, i) => later(S.quiet ? 0 : 260 + i * 300, () => setRow(label, 'done', finalValue(label))));
      later(S.quiet ? 0 : 260 + rest.length * 300 + 500, then);
    }

    // ---- The stage ----
    function card({ kind, badge, number, note, title, body = '', actions = '', status }) {
      const long = title.length > 70;
      stage.innerHTML = `
        <div class="c-card c-card--${kind}">
          <div class="c-lead">
            <span class="c-badge" data-s="${badge}">${mark(badge, number)}</span>
            ${note ? `<span class="c-lead-note">${note}</span>` : ''}
          </div>
          <h1 class="c-title${long ? ' c-title--long' : ''}" id="c-title"${status ? ' role="status"' : ''}>${title}</h1>
          ${body}
          ${actions}
        </div>`;
    }
    const setBadge = (state) => { const badge = stage.querySelector('.c-badge'); badge.dataset.s = state; badge.innerHTML = mark(state); };
    const actionsRow = (label, hint) => `
      <div class="c-actions">
        <button type="button" class="c-btn c-btn--primary" data-primary>${label}</button>
        <span class="c-hint">${hint ?? 'or press <kbd>Enter</kbd>'}</span>
      </div>`;
    const questionNote = (screen) => `<span class="c-vh">Question ${questions.indexOf(screen) + 1} </span>of ${questions.length}`;
    stage.addEventListener('click', (event) => { if (event.target.closest('[data-primary]') && primary) primary(); });
    const focus = (selector) => stage.querySelector(selector)?.focus({ preventScroll: true });

    // One choice from a few: a radio group. Arrows move the choice, Enter accepts it.
    function radios(options, chosen, sideBySide) {
      return `<div class="c-opts${sideBySide ? ' c-opts--pair' : ''}" role="radiogroup" aria-labelledby="c-title">
        ${options.map((option, i) => `
          <div class="c-opt" role="radio" aria-checked="${option.value === chosen}" tabindex="${option.value === chosen ? 0 : -1}" data-i="${i}">
            <span class="c-radio" aria-hidden="true"></span>
            <span class="c-opt-text"><span class="c-opt-label">${rich(option.label)}</span>${option.hint ? `<span class="c-opt-hint">${esc(option.hint)}</span>` : ''}</span>
          </div>`).join('')}
      </div>`;
    }
    function wireRadios(options, onChoose) {
      const els = [...stage.querySelectorAll('.c-opt')];
      const choose = (i) => {
        els.forEach((el, j) => { el.setAttribute('aria-checked', String(i === j)); el.tabIndex = i === j ? 0 : -1; });
        els[i].focus({ preventScroll: true });
        onChoose(options[i].value);
      };
      els.forEach((el, i) => {
        el.addEventListener('click', () => choose(i));
        el.addEventListener('keydown', (event) => {
          if (['ArrowDown', 'ArrowRight'].includes(event.key)) { event.preventDefault(); choose((i + 1) % els.length); }
          if (['ArrowUp', 'ArrowLeft'].includes(event.key)) { event.preventDefault(); choose((i - 1 + els.length) % els.length); }
          if (event.key === ' ') { event.preventDefault(); choose(i); }
        });
      });
    }

    const draw = {
      choose(screen) {
        let chosen = S.answers[screen.id] ?? screen.initial;
        card({ kind: 'question', badge: 'num', number: questions.indexOf(screen) + 1, note: questionNote(screen), title: esc(screen.message), body: radios(screen.options, chosen), actions: actionsRow('Continue') });
        wireRadios(screen.options, (value) => { chosen = value; });
        primary = () => { answer(screen, chosen); advance(screen); };
        focus('.c-opt[aria-checked="true"]');
      },

      confirm(screen) {
        const options = [{ value: true, label: 'Yes' }, { value: false, label: 'No' }];
        let chosen = S.answers[screen.id] ?? screen.initial;
        card({ kind: 'question', badge: 'num', number: questions.indexOf(screen) + 1, note: questionNote(screen), title: esc(screen.message), body: radios(options, chosen, true), actions: actionsRow('Continue') });
        wireRadios(options, (value) => { chosen = value; });
        primary = () => { answer(screen, chosen); advance(screen); };
        focus('.c-opt[aria-checked="true"]');
      },

      // Several from a list: Space ticks or unticks, arrows move, Enter accepts.
      pick(screen) {
        const chosen = new Set(S.answers[screen.id] ?? screen.initial);
        card({
          kind: 'question', badge: 'num', number: questions.indexOf(screen) + 1, note: questionNote(screen), title: esc(screen.message),
          body: `<div class="c-opts c-opts--pick" role="listbox" aria-multiselectable="true" aria-labelledby="c-title">
            ${screen.options.map((option, i) => `
              <div class="c-opt" role="option" aria-selected="${chosen.has(option.value)}" tabindex="${i === 0 ? 0 : -1}" data-i="${i}">
                <span class="c-box" aria-hidden="true">${TICK}</span>
                <span class="c-opt-text"><span class="c-opt-label">${esc(option.label)}</span>${option.hint ? `<span class="c-opt-hint">${esc(option.hint)}</span>` : ''}</span>
              </div>`).join('')}
          </div>`,
          actions: actionsRow('Continue'),
        });
        const els = [...stage.querySelectorAll('.c-opt')];
        const toggle = (i) => {
          const value = screen.options[i].value;
          chosen.has(value) ? chosen.delete(value) : chosen.add(value);
          els[i].setAttribute('aria-selected', String(chosen.has(value)));
        };
        const move = (i) => { els.forEach((el, j) => { el.tabIndex = i === j ? 0 : -1; }); els[i].focus({ preventScroll: true }); };
        els.forEach((el, i) => {
          el.addEventListener('click', () => { toggle(i); move(i); });
          el.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); move((i + 1) % els.length); }
            if (event.key === 'ArrowUp') { event.preventDefault(); move((i - 1 + els.length) % els.length); }
            if (event.key === ' ') { event.preventDefault(); toggle(i); }
          });
        });
        // Kept in the list's own order, so the row reads the way the ending will.
        primary = () => { answer(screen, screen.options.map((option) => option.value).filter((value) => chosen.has(value))); advance(screen); };
        focus('.c-opt');
      },

      folder(screen) {
        card({
          kind: 'question', badge: 'num', number: questions.indexOf(screen) + 1, note: questionNote(screen), title: esc(screen.message),
          body: `<input class="c-input c-mono" id="c-folder" type="text" aria-labelledby="c-title" aria-describedby="c-folder-error" autocomplete="off" spellcheck="false"
              value="${esc(S.answers[screen.id] ?? screen.initial)}" placeholder="${esc(screen.placeholder)}">
            <p class="c-error" id="c-folder-error" role="alert" hidden></p>`,
          actions: actionsRow('Continue'),
        });
        const input = stage.querySelector('#c-folder');
        const error = stage.querySelector('.c-error');
        input.addEventListener('input', () => { error.hidden = true; input.removeAttribute('aria-invalid'); });
        primary = () => {
          const value = input.value.trim();
          if (!/^[A-Za-z]:/.test(value)) {
            error.textContent = screen.invalid;
            error.hidden = false;
            input.setAttribute('aria-invalid', 'true');
            input.focus();
            return;
          }
          answer(screen, value);
          advance(screen);
        };
        input.focus({ preventScroll: true });
        input.select();
      },

      // A plain line: noted, nothing to wait for. It stays long enough to read, then the run carries on.
      step(screen) {
        card({ kind: 'work', badge: 'done', title: rich(screen.text), status: true });
        primary = null;
        settle(screen, true);
        later(2200, () => advance(screen));
      },

      busy(screen) {
        const label = ROW_OF[screen.id];
        card({
          kind: 'work', badge: 'work', title: esc(screen.message), status: true,
          body: screen.totalMB ? `
            <div class="c-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="c-prog-fill"></span></div>
            <p class="c-prog-read"><span class="c-prog-pct">0%</span> of ${screen.totalMB} MB</p>` : '',
        });
        primary = null;
        if (screen.totalMB) {
          const started = performance.now();
          const bar = stage.querySelector('.c-prog');
          const paint = () => {
            const pct = Math.min(100, Math.round(((performance.now() - started) / (screen.seconds * 1000)) * 100));
            bar.setAttribute('aria-valuenow', String(pct));
            bar.setAttribute('aria-valuetext', `${screen.message}: ${pct}% of ${screen.totalMB} MB`);
            bar.firstElementChild.style.width = `${pct}%`;
            stage.querySelector('.c-prog-pct').textContent = `${pct}%`;
            S.rows[label].pct = pct;
            setRow(label, 'work', `${pct}% of ${screen.totalMB} MB`, true);
          };
          paint();
          timers.push(setInterval(paint, 90));
        }
        later(screen.seconds * 1000, () => {
          clearTimers();
          stage.querySelector('.c-prog')?.remove();
          stage.querySelector('.c-prog-read')?.remove();
          setBadge(screen.done.ok ? 'done' : 'bad');
          const title = stage.querySelector('.c-title');
          title.classList.remove('c-title--long');
          title.textContent = screen.done.text;
          settle(screen, true);
          later(1400, () => advance(screen));
        });
      },

      notice(screen) {
        card({
          kind: 'you', badge: 'you', title: esc(screen.title),
          body: `<div class="c-prose">
            ${screen.lines.map((line) => `<p>${esc(line)}</p>`).join('')}
            ${screen.bullets ? `<ul>${screen.bullets.map((bullet) => `<li>${esc(bullet)}</li>`).join('')}</ul>` : ''}
          </div>`,
          actions: actionsRow('Continue'),
        });
        primary = () => advance(screen);
        focus('[data-primary]');
      },

      // The page's screen for a program: its link, a box that feeds it a code, and a wait.
      signIn(screen) {
        card({
          kind: 'you', badge: 'you', title: esc(screen.waiting), status: true,
          body: `
            <div class="c-linkbox">
              <span class="c-linkbox-text"><b>Claude's sign-in page</b><span class="c-mono c-url">${esc(screen.link.replace(/^https:\/\//, ''))}</span></span>
              <a class="c-btn c-btn--quiet" href="${esc(screen.link)}" target="_blank" rel="noopener">Open</a>
            </div>
            <label class="c-label" for="c-code">${esc(screen.codeLabel)}</label>
            <div class="c-field">
              <input class="c-input c-mono" id="c-code" type="text" autocomplete="off" spellcheck="false">
              <button type="button" class="c-btn c-btn--primary" data-primary>Continue</button>
            </div>`,
        });
        const input = stage.querySelector('#c-code');
        primary = () => {
          if (!input.value.trim()) { input.focus(); return; }
          primary = null;
          input.disabled = true;
          stage.querySelector('[data-primary]').disabled = true;
          setBadge('work');
          later(1200, () => {
            // The first code pasted is turned down; the second is taken.
            if (S.tries === 0) { S.tries = 1; show('signInProblem'); return; }
            stage.querySelector('.c-linkbox').remove();
            stage.querySelector('.c-label').remove();
            stage.querySelector('.c-field').remove();
            setBadge('done');
            stage.querySelector('.c-title').textContent = screen.done.text;
            settle(screen, true);
            later(1700, () => advance(screen));
          });
        };
        input.focus({ preventScroll: true });
      },

      // A problem, then the choice the Installer asks straight after it.
      problem(screen) {
        let chosen = screen.initial;
        card({ kind: 'problem', badge: 'bad', note: esc(screen.text), title: esc(screen.message), body: radios(screen.options, chosen), actions: actionsRow('Continue') });
        wireRadios(screen.options, (value) => { chosen = value; });
        primary = () => {
          if (chosen === 'again') { show('signIn'); return; }
          S.skipped = true;
          S.live = null;
          setRow(ROW_OF[screen.id], 'bad', ending.ifSignInSkipped.row[1]);
          advance(screen);
        };
        focus('.c-opt[aria-checked="true"]');
      },

      // Something the person does elsewhere, then says they have.
      waitForDone(screen) {
        card({
          kind: 'you', badge: 'you', title: esc(screen.title),
          body: `<div class="c-prose">${screen.lines.map((line) => `<p>${esc(line)}</p>`).join('')}</div>
            <p class="c-elsewhere"><a class="c-btn c-btn--quiet" href="${esc(screen.link.url)}" target="_blank" rel="noopener">${esc(screen.link.label)}</a></p>`,
          actions: actionsRow('Done', `Once ${esc(screen.what)}`),
        });
        primary = () => {
          primary = null;
          stage.querySelector('[data-primary]').disabled = true;
          stage.querySelector('.c-card').classList.add('c-card--settled');
          setBadge('done');
          settle(screen);
          // The rows with no step of their own fill in here, so the checklist is whole before it takes over.
          finishRest(() => advance(screen));
        };
        // The link comes first: it's the first thing to do. Done is one Tab away.
        const link = stage.querySelector('.c-elsewhere a');
        link.addEventListener('click', () => setTimeout(() => focus('[data-primary]'), 0));
        link.focus({ preventScroll: true });
      },
    };

    // The ending: the checklist is already whole, and it takes the page.
    function drawEnding(first) {
      const skipped = S.skipped ? ending.ifSignInSkipped : null;
      const paint = () => {
        app.classList.add('c-app--ending');
        if (skipped) app.classList.add('c-app--skipped');
        const closing = root.querySelector('.c-closing');
        closing.textContent = skipped ? skipped.closing : ending.closing;
        closing.hidden = false;
        stage.innerHTML = `
          <div class="c-end">
            ${skipped ? `<div class="c-trouble"><span class="c-badge" data-s="bad">${BANG}</span><p>${esc(skipped.problem)}</p></div>` : ''}
            <div class="c-head"><h2>${esc(ending.next.title)}</h2></div>
            <div class="c-panel c-next">
              <p>${esc(skipped ? skipped.next : ending.next.text).replace(/\/jumpstart/, '<code>$&</code>')}</p>
            </div>
            <p class="c-back"><a href="${esc(flow.setupPage)}">Back to the setup page</a></p>
            <dl class="c-log"><dt>Log</dt><dd class="c-mono">${esc(ending.log)}</dd></dl>
          </div>`;
        primary = null;
        if (!first) closing.focus({ preventScroll: true });
        scrollTo(0, 0);
      };
      if (!first && !reduced && document.startViewTransition) document.startViewTransition(paint);
      else paint();
    }

    // ---- Moving through the run ----
    function show(id, first) {
      clearTimers();
      const screen = byId[id];
      onScreen(id);
      const label = ROW_OF[id];
      if (label) {
        // The row the stage is about lights up, and says whether the laptop or the person is being waited on.
        const state = screen.kind === 'problem' ? 'bad' : ['notice', 'signIn', 'waitForDone'].includes(screen.kind) ? 'you' : 'work';
        S.live = label;
        labels.forEach((other) => { if (other !== label) rowEls[other].classList.remove('c-row--live'); });
        setRow(label, state);
      } else {
        setLive(null);
      }
      if (screen.kind === 'ending') { drawEnding(first); return; }
      draw[screen.kind](screen);
      if (!first) scrollTo(0, 0);
    }

    function advance(screen) {
      let next = screens[screens.indexOf(screen) + 1];
      // A problem screen is only ever reached by something going wrong.
      while (next && next.kind === 'problem') next = screens[screens.indexOf(next) + 1];
      if (next) show(next.id);
    }

    addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.repeat || !primary || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target instanceof Element && event.target.closest('a, button, select, #proto-bar')) return;
      event.preventDefault();
      primary();
    });

    // Catch up to `startAt`: every earlier question answered with its default, every earlier step done.
    for (const screen of screens) {
      if (screen.id === startAt) break;
      if (questions.includes(screen)) answer(screen, screen.initial);
      // Starting at the problem means the sign-in before it didn't work.
      else if (screen.kind !== 'problem' && !(startAt === 'signInProblem' && screen.id === 'signIn')) settle(screen);
    }
    if (startAt === 'signInProblem') S.tries = 1;
    if (startAt === 'ending') labels.forEach((label) => setRow(label, 'done', finalValue(label)));
    paintStrip();
    show(startAt, true);
    S.quiet = false;
  }
})();
