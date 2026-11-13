// PROTOTYPE, throwaway. Variant B, "The running record": one column that grows downwards.
// Everything that has happened stays on the page as a one-line row; the current thing is the only
// panel, open at the bottom of the record, and the page keeps it in view. The checklist closes it.
(() => {
  'use strict';

  const QUESTION = ['choose', 'confirm', 'pick', 'folder'];
  const isQuestion = (screen) => QUESTION.includes(screen.kind);

  const stroke = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const SVG = {
    mark: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>',
    tick: `<svg viewBox="0 0 16 16" stroke-width="2" ${stroke}><path d="M3.5 8.6l3 3 6-7"/></svg>`,
    bang: `<svg viewBox="0 0 16 16" stroke-width="2" ${stroke}><path d="M8 3.6v5.2"/><path d="M8 12.1v.3"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" stroke-width="2" ${stroke}><path d="M6 9l6 6 6-6"/></svg>`,
    out: `<svg viewBox="0 0 16 16" stroke-width="1.6" ${stroke}><path d="M9.5 3H13v3.5"/><path d="M13 3L7.5 8.5"/><path d="M11.5 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2.5"/></svg>`,
  };

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...kids.flat(Infinity).filter((kid) => kid != null && kid !== false));
    return node;
  }

  // Paths and the one command are set in the mono face, as on the setup page.
  function rich(text) {
    const path = /[A-Z]:\\.*$/.exec(text);
    if (path) return [text.slice(0, path.index), el('span', { class: 'path' }, path[0])];
    const at = text.indexOf('/jumpstart');
    if (at >= 0) return [text.slice(0, at), el('code', null, '/jumpstart'), text.slice(at + 10)];
    return [text];
  }

  // "A question? The rest of it." The first sentence leads, the rest sits under it.
  function lead(text) {
    const match = /^(.+?[.?])\s+(\S.*)$/.exec(text);
    return match ? [match[1], match[2]] : [text, null];
  }

  function listing(names) {
    if (!names.length) return 'None';
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }

  window.PROTO.register({
    key: 'B',
    name: 'The running record',
    mount(root, { flow, startAt, onScreen }) {
      const screens = flow.screens;
      const total = screens.filter(isQuestion).length;
      const lastQuestion = screens.map(isQuestion).lastIndexOf(true);
      const reduce = matchMedia('(prefers-reduced-motion: reduce)');

      const answers = {};
      const entries = [];
      let frontier = null; // the entry for the current screen
      let editing = null; // an earlier question's row, reopened
      let primary = null; // what Enter does now
      let tries = 0;
      let skipped = false;
      let workHead = false;

      const meta = el('span', { class: 'meta' });
      const list = el('ol', { class: 'record' });
      const spacer = el('div', { class: 'spacer', 'aria-hidden': 'true' });
      const live = el('div', { class: 'sr', 'aria-live': 'polite' });
      const page = el('div', { class: 'b-page' },
        el('header', { class: 'b-head' },
          el('span', { class: 'mark', 'aria-hidden': 'true', html: SVG.mark }),
          el('h1', null, flow.title),
          el('a', { class: 'back', href: flow.setupPage, target: '_blank', rel: 'noopener' }, 'Setup page')),
        list, spacer, live);
      root.append(page);

      const later = (ms, fn) => setTimeout(fn, ms);
      const node = (kind, content) => el('span', {
        class: `node ${kind}`,
        'aria-hidden': 'true',
        html: kind.includes('tick') ? SVG.tick : kind.includes('warn') ? SVG.bang : /spin|dot/.test(kind) ? '<i></i>' : null,
      }, content != null ? String(content) : null);

      const section = (title, right) => list.append(el('li', { class: 'entry sect' }, el('h2', null, title), right));
      const sectionFor = (i) => {
        if (i <= lastQuestion || workHead || screens[i].kind === 'ending') return;
        workHead = true;
        section('Setting up');
      };

      // ---- The record ----

      const paint = (entry, fresh) => {
        const open = entry.state === 'open';
        entry.li.className = `entry ${open ? 'open' : 'row'} k-${entry.screen.kind}${entry.state === 'held' ? ' held' : ''}${fresh ? ' fresh' : ''}`;
        entry.li.replaceChildren(...(open ? drawOpen(entry) : drawRow(entry)).filter(Boolean));
      };
      const push = (screen, state, result = {}, fresh) => {
        const entry = { screen, state, result, li: el('li') };
        entries.push(entry);
        list.append(entry.li);
        paint(entry, fresh);
        return entry;
      };
      const drop = (entry) => {
        entry.li.remove();
        entries.splice(entries.indexOf(entry), 1);
      };

      const answerOf = (screen) => {
        const value = answers[screen.id];
        if (screen.kind === 'choose') return rich(screen.options.find((option) => option.value === value).label);
        if (screen.kind === 'confirm') return value ? 'Yes' : 'No';
        if (screen.kind === 'pick') return listing(screen.options.filter((option) => value.includes(option.value)).map((option) => option.label));
        return el('span', { class: 'path' }, value);
      };

      const noticeBody = (screen, withLink) => [
        (screen.lines || []).map((line) => el('p', null, line)),
        screen.bullets && el('ul', null, screen.bullets.map((bullet) => el('li', null, bullet))),
        withLink && screen.link && el('p', null, el('a', { href: screen.link.url, target: '_blank', rel: 'noopener' }, screen.link.label)),
      ];

      function drawRow(entry) {
        const screen = entry.screen;
        if (isQuestion(screen)) {
          const asked = lead(screen.message)[0];
          if (entry.state === 'held') return [node('num', screens.indexOf(screen) + 1), el('div', { class: 'line' }, el('span', { class: 'what' }, asked))];
          return [node('tick'), el('div', { class: 'line' },
            el('span', { class: 'what' }, asked),
            el('span', { class: 'answer' }, answerOf(screen)),
            el('button', { class: 'change', type: 'button', 'aria-label': `Change: ${asked}`, onclick: () => reopen(entry) }, 'Change'))];
        }
        if (screen.kind === 'problem') {
          return [node('warn'), el('div', { class: 'line' },
            el('span', { class: 'what' }, screen.text),
            el('span', { class: 'answer' }, screen.options.find((option) => option.value === entry.result.value).label))];
        }
        if (screen.kind === 'notice' || screen.kind === 'waitForDone') {
          const toggle = el('button', {
            class: 'toggle', type: 'button', 'aria-expanded': String(!!entry.expanded),
            onclick: () => {
              entry.expanded = !entry.expanded;
              paint(entry);
              entry.li.querySelector('.toggle').focus({ preventScroll: true });
            },
          }, el('span', null, screen.title), el('span', { class: 'chevron', html: SVG.chevron }));
          return [node('tick'),
            el('div', { class: 'line' }, toggle, screen.kind === 'waitForDone' && el('span', { class: 'answer' }, 'Done')),
            entry.expanded && el('div', { class: 'more prose' }, noticeBody(screen, true))];
        }
        return [node('tick'), el('div', { class: 'line' }, el('span', { class: 'outcome' }, rich(entry.result.text)))];
      }

      // ---- The open panel ----

      const panel = ({ id, cls, before, title, right, sub, body, submit, label, extra, aside, focusPrimary }) => {
        primary = submit || null;
        return el('div', {
          class: `panel ${cls || ''}`,
          onkeydown: (event) => {
            if (event.key !== 'Enter' || event.repeat || !submit || event.target.closest('a, button')) return;
            event.preventDefault();
            submit();
          },
        },
          el('div', { class: 'p-head' },
            before,
            el('div', { class: 'p-title' }, el('h2', { class: 'q', id }, title), right && el('span', { class: 'meta' }, right)),
            sub && el('p', { class: 'sub' }, sub)),
          body,
          submit && el('div', { class: 'p-foot' },
            extra,
            el('button', { class: 'primary', type: 'button', 'data-autofocus': !!focusPrimary, onclick: submit }, label),
            aside ?? el('span', { class: 'key-hint' }, 'or press Enter')));
      };

      const optionText = (option) => el('span', { class: 'opt-text' },
        el('span', { class: 'opt-label' }, rich(option.label)),
        option.hint && el('span', { class: 'opt-hint' }, option.hint));

      const radios = (options, value, onChange, labelledby, inline) => {
        const select = (n) => {
          items.forEach((item, k) => {
            item.setAttribute('aria-checked', String(k === n));
            item.tabIndex = k === n ? 0 : -1;
          });
          items[n].focus({ preventScroll: true });
          onChange(options[n].value);
        };
        const items = options.map((option, n) => el('div', {
          class: 'opt', role: 'radio', 'aria-checked': String(option.value === value),
          tabindex: option.value === value ? '0' : '-1', 'data-autofocus': option.value === value,
          onclick: () => select(n),
        }, el('span', { class: 'dot' }), optionText(option)));
        return el('div', {
          class: `opts${inline ? ' inline' : ''}`, role: 'radiogroup', 'aria-labelledby': labelledby,
          onkeydown: (event) => {
            const at = items.indexOf(document.activeElement);
            if (at < 0) return;
            const to = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: items.length - 1, ' ': at }[event.key];
            if (to == null) return;
            event.preventDefault();
            event.stopPropagation();
            select((to + items.length) % items.length);
          },
        }, items);
      };

      const checks = (options, values, onChange, labelledby) => {
        const chosen = new Set(values);
        const move = (n) => {
          items.forEach((item, k) => { item.tabIndex = k === n ? 0 : -1; });
          items[n].focus({ preventScroll: true });
        };
        const toggle = (n) => {
          const value = options[n].value;
          if (chosen.has(value)) chosen.delete(value); else chosen.add(value);
          items[n].setAttribute('aria-checked', String(chosen.has(value)));
          move(n);
          onChange(options.filter((option) => chosen.has(option.value)).map((option) => option.value));
        };
        const items = options.map((option, n) => el('div', {
          class: 'opt check', role: 'checkbox', 'aria-checked': String(chosen.has(option.value)),
          tabindex: n === 0 ? '0' : '-1', 'data-autofocus': n === 0,
          onclick: () => toggle(n),
        }, el('span', { class: 'box', html: SVG.tick }), optionText(option)));
        return el('div', {
          class: 'opts', role: 'group', 'aria-labelledby': labelledby,
          onkeydown: (event) => {
            const at = items.indexOf(document.activeElement);
            if (at < 0) return;
            const to = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: items.length - 1 }[event.key];
            if (to == null && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === ' ') toggle(at); else move((to + items.length) % items.length);
          },
        }, items);
      };

      function drawQuestion(entry) {
        const screen = entry.screen;
        const i = screens.indexOf(screen);
        const id = `b-${screen.id}`;
        const [asked, sub] = lead(screen.message);
        let value = entry.draft ?? answers[screen.id] ?? screen.initial;
        let valid = () => true;
        const keep = (next) => { value = next; entry.draft = next; };
        let body;
        if (screen.kind === 'choose') body = radios(screen.options, value, keep, id);
        if (screen.kind === 'confirm') body = radios([{ value: true, label: 'Yes' }, { value: false, label: 'No' }], value, keep, id, true);
        if (screen.kind === 'pick') body = checks(screen.options, value, keep, id);
        if (screen.kind === 'folder') {
          const error = el('p', { class: 'error', role: 'alert', hidden: true }, screen.invalid);
          const input = el('input', {
            class: 'text', type: 'text', value, placeholder: screen.placeholder, spellcheck: 'false', autocomplete: 'off',
            'aria-labelledby': id, 'data-autofocus': true,
            oninput: () => {
              keep(input.value);
              error.hidden = true;
              input.removeAttribute('aria-invalid');
            },
          });
          valid = () => {
            if (/^[A-Za-z]:\\/.test(value.trim())) { value = value.trim(); return true; }
            error.hidden = false;
            input.setAttribute('aria-invalid', 'true');
            input.focus({ preventScroll: true });
            return false;
          };
          body = el('div', { class: 'field' }, input, error);
        }
        const submit = () => {
          if (!valid()) return;
          answers[screen.id] = value;
          delete entry.draft;
          if (entry !== editing) return finish(entry);
          editing = null;
          entry.state = 'done';
          paint(entry, true);
          frontier.state = 'open';
          paint(frontier, true);
          onScreen(frontier.screen.id);
          show(frontier);
        };
        // The last question is the last moment an answer can be changed, so its button says what it starts.
        const label = i === lastQuestion && entry !== editing ? 'Start installing' : 'Continue';
        return [node('num', i + 1), panel({ id, title: asked, sub, body, submit, label })];
      }

      function drawBusy(entry) {
        const screen = entry.screen;
        const [first, rest] = lead(screen.message);
        primary = null;
        return [node('spin'), el('div', { class: 'panel busy', role: 'status' }, el('div', { class: 'p-head' },
          screen.totalMB
            ? [el('p', { class: 'status pct' }, `${screen.message}: 0% of ${screen.totalMB} MB`),
              el('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': screen.message }, el('i'))]
            : [el('p', { class: 'status' }, first), rest && el('p', { class: 'sub' }, rest)]))];
      }

      function runBusy(entry) {
        const screen = entry.screen;
        const began = performance.now();
        const text = entry.li.querySelector('.pct');
        const bar = entry.li.querySelector('.bar');
        const timer = setInterval(() => {
          const done = Math.min(1, (performance.now() - began) / (screen.seconds * 1000));
          if (text) {
            const percent = Math.round(done * 100);
            text.textContent = `${screen.message}: ${percent}% of ${screen.totalMB} MB`;
            bar.setAttribute('aria-valuenow', String(percent));
            bar.firstChild.style.width = `${percent}%`;
          }
          if (done < 1) return;
          clearInterval(timer);
          finish(entry, { text: screen.done.text });
        }, 50);
      }

      function drawSignIn(entry) {
        const screen = entry.screen;
        const i = screens.indexOf(screen);
        const hasProblem = screens[i + 1] && screens[i + 1].kind === 'problem';
        const input = el('input', {
          class: 'text', type: 'text', id: 'b-code', spellcheck: 'false', autocomplete: 'off', 'data-autofocus': true,
          oninput: () => { button.disabled = !input.value.trim(); },
        });
        const submit = () => {
          if (entry.checking) return;
          if (!input.value.trim()) return input.focus({ preventScroll: true });
          entry.checking = true;
          input.disabled = true;
          button.disabled = true;
          // The prototype's rule: the first code pasted is rejected, the next is accepted.
          later(1100, () => {
            if (tries === 0 && hasProblem) {
              tries = 1;
              drop(entry);
              start(i + 1);
            } else finish(entry, { text: screen.done.text }, hasProblem ? i + 2 : i + 1);
          });
        };
        const button = el('button', { class: 'primary', type: 'button', disabled: true, onclick: submit }, 'Continue');
        primary = submit;
        return [node('spin'), el('div', {
          class: 'panel signin',
          onkeydown: (event) => {
            if (event.key !== 'Enter' || event.repeat || event.target.closest('a, button')) return;
            event.preventDefault();
            submit();
          },
        },
          el('div', { class: 'p-head' }, el('div', { class: 'p-title' }, el('h2', { class: 'q' }, screen.waiting), el('span', { class: 'meta' }, screen.name))),
          el('a', { class: 'linkbox', href: screen.link, target: '_blank', rel: 'noopener noreferrer' },
            el('span', { class: 'url' }, screen.link), el('span', { class: 'ext', html: SVG.out })),
          el('div', { class: 'field' },
            el('label', { class: 'label', for: 'b-code' }, screen.codeLabel),
            el('div', { class: 'code-row' }, input, button)))];
      }

      function drawProblem(entry) {
        const screen = entry.screen;
        const i = screens.indexOf(screen);
        const id = `b-${screen.id}`;
        let value = screen.initial;
        const submit = () => {
          const again = value === 'again';
          if (!again) skipped = true;
          finish(entry, { value }, again ? i - 1 : i + 1);
        };
        return [node('warn'), panel({
          id, cls: 'problem', before: el('p', { class: 'said' }, screen.text), title: screen.message,
          body: radios(screen.options, value, (next) => { value = next; }, id), submit, label: 'Continue',
        })];
      }

      function drawEnding(entry) {
        const screen = entry.screen;
        const other = screen.ifSignInSkipped;
        const rows = screen.checklist.map((row) => (skipped && row[0] === other.row[0] ? [...other.row, true] : row));
        primary = null;
        return [node(skipped ? 'warn' : 'tick final'), el('div', { class: 'end' },
          el('h2', { class: 'closing', tabindex: '-1', 'data-autofocus': true }, skipped ? other.closing : screen.closing),
          skipped && el('p', { class: 'fail' }, other.problem),
          el('h3', { class: 'next-title' }, screen.next.title),
          el('p', { class: 'next-text' }, rich(skipped ? other.next : screen.next.text)),
          el('dl', { class: 'panel checklist' }, rows.map(([label, value, bad]) => {
            const failed = bad || /^Not/.test(value);
            return el('div', { class: `item${failed ? ' failed' : ''}` },
              el('dt', null, el('span', { class: 'mini', 'aria-hidden': 'true', html: failed ? SVG.bang : SVG.tick }), label),
              el('dd', null, value));
          })),
          el('p', { class: 'log' }, el('span', { class: 'log-label' }, 'Log file'), el('span', { class: 'path' }, screen.log)))];
      }

      function drawOpen(entry) {
        const screen = entry.screen;
        if (isQuestion(screen)) return drawQuestion(entry);
        if (screen.kind === 'busy') return drawBusy(entry);
        if (screen.kind === 'signIn') return drawSignIn(entry);
        if (screen.kind === 'problem') return drawProblem(entry);
        if (screen.kind === 'ending') return drawEnding(entry);
        if (screen.kind === 'notice') {
          return [node('dot'), panel({
            title: screen.title, body: el('div', { class: 'prose' }, noticeBody(screen)),
            submit: () => finish(entry), label: 'Continue', focusPrimary: true,
          })];
        }
        // waitForDone: the thing to do elsewhere comes first, then saying it's done.
        return [node('dot'), panel({
          title: screen.title, body: el('div', { class: 'prose' }, noticeBody(screen)),
          extra: el('a', { class: 'secondary', href: screen.link.url, target: '_blank', rel: 'noopener', 'data-autofocus': true },
            screen.link.label, el('span', { class: 'ext', html: SVG.out })),
          submit: () => finish(entry, { value: 'Done' }), label: 'Done',
          aside: el('span', { class: 'key-hint' }, `once ${screen.what}`),
        })];
      }

      // ---- Moving through the run ----

      // Keeps the current thing in view: its top no lower than a third of the way down the window,
      // and its last control clear of the bottom. The record scrolls up behind it.
      const keepInView = (entry, instant) => {
        const target = entry.li.querySelector('.panel, .end') || entry.li;
        const box = target.getBoundingClientRect();
        const cap = Math.max(16, Math.min(innerHeight * 0.34, innerHeight - 110 - box.height));
        const to = instant || box.top > cap || box.top < 16 ? Math.max(0, scrollY + box.top - cap) : scrollY;
        const content = page.offsetHeight - spacer.offsetHeight;
        spacer.style.height = `${Math.max(110, to + innerHeight - content)}px`;
        if (Math.abs(to - scrollY) > 1) scrollTo({ top: to, behavior: instant || reduce.matches ? 'auto' : 'smooth' });
      };

      const show = (entry, instant) => {
        const target = entry.li.querySelector('[data-autofocus]');
        if (target) {
          target.focus({ preventScroll: true });
          if (target.select) target.select();
        } else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        meta.textContent = screens.indexOf(frontier.screen) <= lastQuestion ? `${screens.indexOf(frontier.screen) + 1} of ${total}` : '';
        keepInView(entry, instant);
      };

      function start(i, instant) {
        const screen = screens[i];
        primary = null;
        sectionFor(i);
        onScreen(screen.id);
        list.classList.toggle('locked', i > lastQuestion);
        if (screen.kind === 'problem') tries = 1;
        live.textContent = screen.message || screen.title || screen.waiting || screen.text || '';
        if (screen.kind === 'step') {
          // A plain line: noted in the record, nothing to wait for.
          frontier = push(screen, 'done', { text: screen.text }, !instant);
          show(frontier, instant);
          later(900, () => start(i + 1));
          return;
        }
        frontier = push(screen, 'open', {}, !instant);
        // A notice stays open above the thing it's about, and folds away once that's over.
        for (const entry of entries) {
          if (entry.screen.kind !== 'notice' || entry.state !== 'done') continue;
          const open = screens.indexOf(entry.screen) + 1 === i;
          if (open !== !!entry.expanded) {
            entry.expanded = open;
            paint(entry);
          }
        }
        show(frontier, instant);
        if (screen.kind === 'busy') runBusy(frontier);
      }

      function finish(entry, result = {}, next) {
        entry.state = 'done';
        entry.result = result;
        paint(entry, true);
        start(next ?? screens.indexOf(entry.screen) + 1);
      }

      // While the questions are still being asked, an answered row can be opened again in its place.
      function reopen(entry) {
        if (editing) {
          delete editing.draft;
          editing.state = 'done';
          paint(editing);
        }
        frontier.state = 'held';
        paint(frontier);
        editing = entry;
        entry.state = 'open';
        paint(entry, true);
        onScreen(entry.screen.id);
        show(entry);
      }

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.repeat && event.target === document.body && primary) {
          event.preventDefault();
          primary();
        }
        if (event.key === 'Escape' && editing) {
          delete editing.draft;
          editing.state = 'done';
          paint(editing);
          editing = null;
          frontier.state = 'open';
          paint(frontier);
          onScreen(frontier.screen.id);
          show(frontier);
        }
      });

      // ---- Start: everything before `startAt` is already in the record ----

      const from = Math.max(0, screens.findIndex((screen) => screen.id === startAt));
      if (isQuestion(screens[0])) section('Questions', meta);
      for (let i = 0; i < from; i++) {
        const screen = screens[i];
        sectionFor(i);
        if (isQuestion(screen)) {
          answers[screen.id] = Array.isArray(screen.initial) ? [...screen.initial] : screen.initial;
          push(screen, 'done');
        } else if (screen.kind === 'problem') continue; // it didn't happen
        else if (screen.kind === 'signIn' && i === from - 1 && screens[from].kind === 'problem') continue; // it became the problem
        else if (screen.kind === 'waitForDone') push(screen, 'done', { value: 'Done' });
        else push(screen, 'done', { text: screen.text ?? (screen.done && screen.done.text) });
      }
      start(from, true);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => keepInView(editing || frontier, true));
    },
  });
})();
