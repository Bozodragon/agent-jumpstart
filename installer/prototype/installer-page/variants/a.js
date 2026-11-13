// PROTOTYPE, throwaway. The Installer page, round two: variant A, "One thing at a time".
// The current thing (a question, the step being worked on, a notice, the sign-in, a problem) owns the
// whole screen and the page moves on when it's dealt with. Nothing that has happened stays on screen:
// the trace is the row of dashes in the header, which opens a panel of the answers given so far and
// what's set up on this laptop (round one's variant C's checklist, filling in as the run goes).
// The ending is the one screen laid out all at once.
(function () {
  'use strict';

  var QUESTION = { choose: 1, confirm: 1, pick: 1, folder: 1 };
  var STEP_HOLD = 2200; // how long a plain line stays up
  var DONE_HOLD = 1700; // how long a "done" line stays up before the page moves on
  var TERM_HOLD = 3400; // how long the finished terminal stays up, so it can be looked at

  var ICON = {
    mark: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>',
    tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path class="a-draw" d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    smallTick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    spin: '<svg viewBox="0 0 34 34" fill="none"><circle class="a-ring-track" cx="17" cy="17" r="15.5"/><circle class="a-ring-arc" cx="17" cy="17" r="15.5" pathLength="100"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/></svg>',
    chevron: '<svg class="a-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  };
  // What a checklist row's marker means, for someone who can't see it.
  var SAY = { empty: 'not started', planned: 'answered, not started', work: 'in progress', you: 'waiting for you', done: 'done', bad: "didn't work" };

  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // A Windows path at the end of a line is set in the mono face, as the setup page sets paths.
  function fmt(text) {
    var m = String(text).match(/^(.*?)([A-Z]:\\.*)$/);
    return m ? esc(m[1]) + '<span class="a-path">' + esc(m[2]).split('\\').map(function (part) { return '<span>' + part + '</span>'; }).join('\\<wbr>') + '</span>' : esc(text);
  }
  // "A question? And a sentence about it." The first sentence is the heading, the rest sits under it.
  function split(message) {
    var m = String(message).match(/^(.*?[?.])\s+(.+)$/);
    return m ? [m[1], m[2]] : [message, ''];
  }
  function inWords(items) {
    if (items.length === 0) return 'None';
    return items.length === 1 ? items[0] : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function badge(type, text) {
    var inner = type === 'spin' ? ICON.spin : type === 'tick' ? ICON.tick : type === 'warn' ? '!' : type === 'you' ? '<i></i>' : esc(text);
    return '<span class="a-badge is-' + type + '" aria-hidden="true">' + inner + '</span>';
  }
  function status(badgeHtml, note) {
    return '<div class="a-status">' + badgeHtml + (note ? '<span class="a-count">' + esc(note) + '</span>' : '') + '</div>';
  }
  function heading(parts) {
    return '<h1 class="a-title" tabindex="-1">' + fmt(parts[0]) + '</h1>' + (parts[1] ? '<p class="a-lede">' + esc(parts[1]) + '</p>' : '');
  }
  function options(name, list, chosen, many) {
    return '<div class="a-options' + (many ? ' is-pick' : '') + '" role="' + (many ? 'group' : 'radiogroup') + '">' + list.map(function (o) {
      var on = many ? chosen.indexOf(o.value) !== -1 : chosen === o.value;
      return '<label class="a-opt"><input type="' + (many ? 'checkbox' : 'radio') + '" name="' + name + '" value="' + esc(o.value) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="a-box" aria-hidden="true"></span><span class="a-opt-text"><span class="a-opt-label">' + fmt(o.label) + '</span>' +
        (o.hint ? '<span class="a-opt-hint">' + esc(o.hint) + '</span>' : '') + '</span></label>';
    }).join('') + '</div>';
  }
  function actions(label, back) {
    return '<div class="a-actions"><button class="a-primary" type="submit">' + label + '</button>' +
      '<span class="a-hint is-key">or press <kbd>Enter</kbd></span>' +
      (back ? '<button class="a-back" type="button">' + ICON.back + '<span>Back</span></button>' : '') + '</div>';
  }
  // One line of the skills installer's output, coloured as a terminal colours it.
  function termLine(text, kind, prompt) {
    if (kind === 'cmd') return '<span class="t-ps">' + esc(prompt) + ' </span><span class="t-cmd">' + esc(text) + '</span>';
    if (!text) return '&nbsp;';
    // The banner's blocks are drawn too, so they meet with no gaps whatever font is at hand.
    if (kind === 'banner') return text.replace(/█+/g, function (run) { return '<span class="t-blk" style="width:' + run.length + 'ch"></span>'; });
    return esc(text)
      .replace(/https:\/\/\S+/, '<span class="t-url">$&</span>')
      // The rails are drawn, not typed: the web font has no box-drawing glyphs, and a fallback's don't join up.
      .replace(/│/g, '<span class="t-rail t-v" aria-hidden="true"></span>')
      .replace(/┌/g, '<span class="t-rail t-top" aria-hidden="true"></span>')
      .replace(/└/g, '<span class="t-rail t-end" aria-hidden="true"></span>')
      .replace(/◇/g, '<span class="t-step">◇</span>')
      .replace(/●/g, '<span class="t-sel">●</span>')
      .replace(/✓/g, '<span class="t-ok">✓</span>');
  }

  window.PROTO.register({
    key: 'A',
    name: 'One thing at a time, round two',
    mount: function (root, ctx) {
      var flow = ctx.flow;
      var screens = flow.screens;
      var questions = screens.filter(function (s) { return QUESTION[s.kind]; });
      var lastQuestion = screens.indexOf(questions[questions.length - 1]);
      var ending = screens.filter(function (s) { return s.kind === 'ending'; })[0];
      var labels = ending.checklist.map(function (row) { return row[0]; });
      // The dashes: every screen but a problem, which is a detour from the one before it.
      var track = screens.filter(function (s) { return s.kind !== 'problem'; });
      var state = { answers: {}, tries: 0, skipped: false, rows: {}, live: null };
      labels.forEach(function (label) { state.rows[label] = { s: 'empty', v: '' }; });
      var timers = [];
      var current = 0;
      var open = false;

      // ---- What each screen means for the checklist (the order is installer/src/main.js's) ----
      // The row a screen is about, while it's on screen.
      var ROW_OF = { git: 'Git', skills: 'Skills', appsScriptSetting: 'Apps Script', checkClaude: 'Claude Code', downloadClaude: 'Claude Code', signIn: 'Claude Code', signInProblem: 'Claude Code', installT3: 'T3 Code' };
      // The rows that are done once a screen is behind us. Some real steps have no screen here, so
      // their rows fill in where main.js does them: GitHub straight after the tools, Memory and the
      // connectors straight after the skills, the workspaces once T3 Code is in.
      var DONE_AFTER = { git: ['Git', 'GitHub'], skills: ['Skills', 'Memory', 'Connectors'], appsScriptSetting: ['Apps Script'], signIn: ['Claude Code'], installT3: ['T3 Code', 'Workspaces'] };
      // Answers that decide a row, pencilled against it until the work is done.
      var PLANS = { topWorkspace: 'Workspaces', github: 'GitHub', connectors: 'Connectors' };

      // ---- The frame: a quiet header, the panel it opens, and the stage ----
      var runs = ['', '', ''];
      track.forEach(function (s) {
        runs[QUESTION[s.kind] ? 0 : s.kind === 'ending' ? 2 : 1] += '<i class="a-seg"></i>';
      });
      root.innerHTML =
        '<div class="a-shell">' +
          '<header class="a-head">' +
            '<div class="a-brand"><span class="a-mark" aria-hidden="true">' + ICON.mark + '</span><span>' + esc(flow.title) + '</span></div>' +
            '<a class="a-setup" href="' + esc(flow.setupPage) + '" target="_blank" rel="noopener">Setup page' + ICON.out + '<span class="a-vh"> (opens in a new tab)</span></a>' +
            '<button class="a-progress" type="button" aria-expanded="false" aria-controls="a-sheet">' +
              '<span class="a-dashes" aria-hidden="true">' + runs.map(function (r) { return '<span class="a-run">' + r + '</span>'; }).join('') + '</span>' +
              '<span class="a-progress-label">Details</span>' + ICON.chevron +
            '</button>' +
            '<div class="a-sheet" id="a-sheet" role="region" aria-label="Your answers, and what\'s set up on this laptop" hidden>' +
              '<section class="a-part"><div class="a-part-head"><h2>Your answers</h2></div><p class="a-part-note"></p><dl class="a-answers"></dl></section>' +
              '<section class="a-part"><div class="a-part-head"><h2>Set up on this laptop</h2><span class="a-part-count"></span></div><ol class="a-checks"></ol></section>' +
            '</div>' +
          '</header>' +
          '<div class="a-scrim" hidden></div>' +
          '<main class="a-stage"></main>' +
        '</div>';
      var shell = root.querySelector('.a-shell');
      var stage = root.querySelector('.a-stage');
      var toggle = root.querySelector('.a-progress');
      var sheet = root.querySelector('.a-sheet');
      var scrim = root.querySelector('.a-scrim');
      var segs = Array.prototype.slice.call(root.querySelectorAll('.a-seg'));

      function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
      function inQuestions() { return current <= lastQuestion; }

      // ---- The panel ----
      function setOpen(to, focusBack) {
        open = to;
        sheet.hidden = !to;
        scrim.hidden = !to;
        toggle.setAttribute('aria-expanded', String(to));
        shell.classList.toggle('is-open', to);
        if (to) paintPanel();
        if (!to && focusBack) toggle.focus();
      }
      toggle.addEventListener('click', function () { setOpen(!open); });
      scrim.addEventListener('click', function () { setOpen(false); });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false, true); }
      });
      // Changing an answer: only while nothing has acted on it, which is during the questions.
      sheet.addEventListener('click', function (event) {
        var button = event.target.closest('[data-change]');
        if (!button || !inQuestions()) return;
        setOpen(false);
        show(screens.indexOf(screens.filter(function (s) { return s.id === button.dataset.change; })[0]), 'back');
      });

      function answerText(s) {
        var v = state.answers[s.id];
        if (s.kind === 'pick') return inWords(v);
        if (s.kind === 'confirm') return v ? 'Yes' : 'No';
        if (s.kind === 'folder') return v;
        return s.options.filter(function (o) { return o.value === v; })[0].label;
      }
      function paintAnswers() {
        var changeable = inQuestions();
        sheet.querySelector('.a-part-note').textContent = changeable
          ? 'You can change these until the install starts.'
          : 'Fixed now the install has started.';
        sheet.querySelector('.a-answers').innerHTML = questions.map(function (s) {
          var now = screens[current] === s;
          var known = s.id in state.answers;
          var value = now ? '<span class="a-quiet">Answering now</span>' : known ? fmt(answerText(s)) : '<span class="a-quiet">Not asked yet</span>';
          var change = changeable && known && !now
            ? '<button class="a-change" type="button" data-change="' + s.id + '" aria-label="Change your answer: ' + esc(s.short) + '">Change</button>' : '';
          return '<div class="a-answer' + (now ? ' is-now' : '') + '"><dt>' + esc(s.short) + '</dt><dd>' + value + '</dd>' + change + '</div>';
        }).join('');
      }
      function marker(s) {
        return s === 'done' ? ICON.smallTick : s === 'bad' ? '!' : '';
      }
      function paintChecks() {
        var reached = labels.filter(function (label) { var r = state.rows[label]; return r.s === 'done' || (r.s === 'bad' && state.live !== label); }).length;
        sheet.querySelector('.a-part-count').textContent = reached + ' of ' + labels.length;
        sheet.querySelector('.a-checks').innerHTML = labels.map(function (label) {
          var r = state.rows[label];
          return '<li class="a-check' + (state.live === label ? ' is-live' : '') + '" data-s="' + r.s + '">' +
            '<span class="a-mk" aria-hidden="true">' + marker(r.s) + '</span>' +
            '<span class="a-check-label">' + esc(label) + '<span class="a-vh">, ' + SAY[r.s] + '</span></span>' +
            '<span class="a-check-value">' + (r.v ? fmt(r.v) : '') + '</span></li>';
        }).join('');
      }
      function paintPanel() {
        if (!open) return;
        paintAnswers();
        paintChecks();
      }

      // ---- The checklist's rows ----
      function finalValue(label) {
        if (label === 'Connectors' && state.answers.connectors) return inWords(state.answers.connectors);
        return ending.checklist.filter(function (row) { return row[0] === label; })[0][1];
      }
      function setRow(label, s, v) {
        state.rows[label].s = s;
        if (v !== undefined) state.rows[label].v = v;
      }
      function answer(s, value) {
        state.answers[s.id] = value;
        var label = PLANS[s.id];
        if (!label) return;
        var text = s.id === 'github' ? (value ? 'Yes, after the tools' : finalValue('GitHub')) : s.id === 'topWorkspace' ? (value === 'new' ? 'G:\\My Drive\\Claude' : 'In another folder') : finalValue(label);
        setRow(label, 'planned', text);
      }
      // The row the screen is about lights up, and says whether the laptop or the person is being waited on.
      function enter(s) {
        var label = ROW_OF[s.id];
        state.live = label || null;
        if (!label) return;
        setRow(label, s.kind === 'problem' ? 'bad' : s.kind === 'signIn' || s.kind === 'waitForDone' ? 'you' : 'work');
      }
      // The rows as they stand once this screen is behind us.
      function settle(s) {
        if (s.id === 'downloadClaude') setRow('Claude Code', 'work', ending.ifSignInSkipped.row[1]);
        if (s.kind === 'problem' && state.skipped) setRow('Claude Code', 'bad', ending.ifSignInSkipped.row[1]);
        (DONE_AFTER[s.id] || []).forEach(function (label) { setRow(label, 'done', finalValue(label)); });
      }

      function paint() {
        var s = screens[current];
        var problem = s.kind === 'problem';
        var at = track.indexOf(problem ? screens[current - 1] : s);
        segs.forEach(function (seg, k) {
          var warn = track[k].kind === 'signIn' && (problem || state.skipped);
          seg.className = 'a-seg' + (warn ? ' is-warn' : k < at || s.kind === 'ending' ? ' is-done' : k === at ? ' is-now' : '');
        });
        toggle.setAttribute('aria-label', 'Step ' + (at + 1) + ' of ' + track.length + '. Your answers, and what\'s set up');
      }

      // Puts a new thing on the stage and takes the old one off. mode: 'fwd', 'back' or 'soft' (a change in place).
      function swap(html, mode) {
        Array.prototype.forEach.call(stage.children, function (old) {
          old.classList.add('is-leaving');
          old.inert = true;
          setTimeout(function () { old.remove(); }, 180);
        });
        var el = document.createElement('section');
        el.className = 'a-screen is-' + (mode || 'fwd');
        el.innerHTML = html;
        stage.appendChild(el);
        return el;
      }

      function show(i, mode) {
        timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
        timers = [];
        current = i;
        var s = screens[i];
        shell.classList.toggle('is-ending', s.kind === 'ending');
        enter(s);
        paint();
        paintPanel();
        ctx.onScreen(s.id);
        draw[s.kind](s, i, mode);
        window.scrollTo(0, 0);
      }
      // The next screen in the run. A problem is only ever reached by something going wrong.
      function next(i) {
        settle(screens[i]);
        var j = i + 1;
        while (screens[j] && screens[j].kind === 'problem') j++;
        if (screens[j]) show(j);
      }

      // Enter continues from anywhere in a form; up and down move between tick boxes (radios do this by themselves).
      function wire(el, onSubmit, focusOn) {
        var form = el.querySelector('form');
        form.addEventListener('submit', function (event) { event.preventDefault(); onSubmit(form); });
        form.addEventListener('keydown', function (event) {
          var t = event.target;
          if (event.key === 'Enter' && t.tagName === 'INPUT') { event.preventDefault(); form.requestSubmit(); }
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && t.type === 'checkbox') {
            var boxes = Array.prototype.slice.call(form.querySelectorAll('input[type=checkbox]'));
            var to = boxes[boxes.indexOf(t) + (event.key === 'ArrowDown' ? 1 : -1)];
            if (to) { event.preventDefault(); to.focus(); }
          }
        });
        var target = el.querySelector(focusOn);
        if (target && !open) target.focus({ preventScroll: true });
        return form;
      }

      function question(s, i, mode, body, focusOn, read) {
        var back = i > 0 && QUESTION[screens[i - 1].kind];
        var el = swap(
          status(badge('num', questions.indexOf(s) + 1), 'of ' + questions.length) + heading(split(s.message)) +
          '<form class="a-body" novalidate>' + body + actions('Continue', back) + '</form>', mode);
        wire(el, function (form) {
          var value = read(form);
          if (value === undefined) return;
          answer(s, value);
          next(i);
        }, focusOn);
        if (back) el.querySelector('.a-back').addEventListener('click', function () { show(i - 1, 'back'); });
        return el;
      }
      function chosen(s) { return s.id in state.answers ? state.answers[s.id] : s.initial; }

      // A line with a tick, held for a moment, then the page moves on.
      function doneLine(text, ok, i, hold) {
        swap(status(badge(ok === false ? 'warn' : 'tick')) + '<h1 class="a-title" role="status">' + fmt(text) + '</h1>', 'soft');
        later(function () { next(i); }, hold);
      }

      var draw = {
        choose: function (s, i, mode) {
          question(s, i, mode, options(s.id, s.options, chosen(s)), 'input:checked', function (form) {
            return form.querySelector('input:checked').value;
          });
        },
        confirm: function (s, i, mode) {
          var list = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
          question(s, i, mode, options(s.id, list, chosen(s) ? 'yes' : 'no'), 'input:checked', function (form) {
            return form.querySelector('input:checked').value === 'yes';
          });
        },
        pick: function (s, i, mode) {
          question(s, i, mode, options(s.id, s.options, chosen(s), true), 'input', function (form) {
            return Array.prototype.map.call(form.querySelectorAll('input:checked'), function (box) { return box.value; });
          });
        },
        folder: function (s, i, mode) {
          var el = question(s, i, mode,
            '<input class="a-input" type="text" name="folder" value="' + esc(chosen(s)) + '" placeholder="' + esc(s.placeholder) + '" aria-label="' + esc(s.message) + '" spellcheck="false" autocomplete="off">' +
            '<p class="a-error" role="alert" hidden>' + esc(s.invalid) + '</p>',
            '.a-input', function (form) {
              var value = input.value.trim();
              // The prototype's stand-in for the Installer's own check.
              if (/^[A-Za-z]:\\/.test(value)) return value;
              error.hidden = false;
              input.setAttribute('aria-invalid', 'true');
              input.focus();
            });
          var input = el.querySelector('.a-input');
          var error = el.querySelector('.a-error');
          input.setSelectionRange(input.value.length, input.value.length);
          input.addEventListener('input', function () { error.hidden = true; input.removeAttribute('aria-invalid'); });
        },

        step: function (s, i, mode) {
          swap(status(badge('tick')) + '<h1 class="a-title" role="status">' + fmt(s.text) + '</h1>', mode);
          later(function () { next(i); }, STEP_HOLD);
        },
        busy: function (s, i, mode) {
          var el = swap(
            status(badge('spin')) + heading(split(s.message)) +
            (s.totalMB ? '<div class="a-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div><p class="a-readout"><b>0%</b> of ' + s.totalMB + ' MB</p>' : ''), mode);
          if (s.totalMB) {
            var bar = el.querySelector('.a-bar');
            var began = Date.now();
            var tick = function () {
              var percent = Math.min(100, Math.round((Date.now() - began) / (s.seconds * 10)));
              bar.firstChild.style.width = percent + '%';
              bar.setAttribute('aria-valuenow', percent);
              bar.setAttribute('aria-valuetext', s.message + ': ' + percent + '% of ' + s.totalMB + ' MB');
              el.querySelector('.a-readout b').textContent = percent + '%';
              setRow(ROW_OF[s.id], 'work', percent + '% of ' + s.totalMB + ' MB');
              if (open) paintChecks();
            };
            tick();
            timers.push(setInterval(tick, 50));
          }
          later(function () { doneLine(s.done.text, s.done.ok, i, DONE_HOLD); }, s.seconds * 1000);
        },
        // The skills installer's own output, streaming in. The terminal stays up once it's done, for a look.
        terminal: function (s, i, mode) {
          var el = swap(
            status(badge('spin')) + heading([s.message, s.lede]) +
            '<div class="a-term">' +
              '<div class="a-term-head"><span class="a-term-icon" aria-hidden="true">' + ICON.mark + '</span>' + esc(s.window) + '</div>' +
              '<div class="a-term-body" tabindex="0" aria-label="' + esc(s.window) + ' output"><div class="a-term-lines"><span class="t-caret" aria-hidden="true"></span></div></div>' +
            '</div>', mode);
          var view = el.querySelector('.a-term-body');
          var body = el.querySelector('.a-term-lines');
          var caret = body.querySelector('.t-caret');
          // The newest line stays in view, as in a terminal, and a resized window (and so a
          // rescaled page) keeps it there. Earlier lines can still be scrolled back to between lines.
          var pin = function () { view.scrollTop = view.scrollHeight; };
          if (window.ResizeObserver) new ResizeObserver(pin).observe(body);
          var at = 0;
          var banner = 0;
          s.output.forEach(function (line) {
            at += line[0];
            later(function () {
              var row = document.createElement('div');
              row.className = 't-line' + (line[2] ? ' t-' + line[2] : '') + (line[2] === 'banner' ? ' t-b' + banner++ : '');
              row.innerHTML = termLine(line[1], line[2], s.prompt);
              body.insertBefore(row, caret);
              pin();
            }, at);
          });
          later(function () {
            el.querySelector('.a-status').innerHTML = '<span class="a-badge is-tick" aria-hidden="true">' + ICON.smallTick + '</span>';
            var title = el.querySelector('.a-title');
            title.textContent = s.done.text;
            title.setAttribute('role', 'status');
            caret.remove();
            later(function () { next(i); }, TERM_HOLD);
          }, at + 500);
        },
        // Something only the person can do elsewhere, then they say they have.
        waitForDone: function (s, i, mode) {
          var el = swap(
            status(badge('you')) + '<h1 class="a-title" tabindex="-1">' + esc(s.title) + '</h1>' +
            '<p class="a-lede">' + esc(s.lines[0]) + '</p>' +
            '<p class="a-linkrow"><a class="a-secondary" href="' + esc(s.link.url) + '" target="_blank" rel="noopener">' + esc(s.link.label) + ICON.out + '</a></p>' +
            s.lines.slice(1).map(function (line) { return '<p class="a-lede">' + esc(line) + '</p>'; }).join('') +
            '<form><div class="a-actions"><button class="a-primary" type="submit">Done</button><span class="a-hint">once ' + esc(s.what) + '</span></div></form>', mode);
          wire(el, function () { next(i); }, '.a-secondary');
          // Once the settings page has been opened, Done is the thing to press.
          el.querySelector('.a-secondary').addEventListener('click', function () { el.querySelector('.a-primary').focus(); });
        },
        // One screen: what happens next, the link, the wait, and the box for a code.
        signIn: function (s, i, mode) {
          var el = swap(
            '<div class="a-status"><span class="a-badge is-you is-waiting" aria-hidden="true"><i></i></span><span class="a-count a-wait" role="status">' + esc(s.waiting) + '</span></div>' +
            '<h1 class="a-title" tabindex="-1">' + esc(s.title) + '</h1>' +
            s.lines.map(function (line) { return '<p class="a-lede">' + esc(line) + '</p>'; }).join('') +
            '<ul class="a-bullets">' + s.bullets.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' +
            '<div class="a-copybox"><div class="a-copybox-head">' + esc(s.linkLabel) + '</div>' +
            '<a class="a-copybox-body" href="' + esc(s.link) + '" target="_blank" rel="noopener">' + esc(s.link) + '</a></div>' +
            '<form class="a-signin-form" novalidate><label class="a-label" for="a-code">' + esc(s.codeLabel) + '</label>' +
            '<div class="a-coderow"><input class="a-input" id="a-code" type="text" spellcheck="false" autocomplete="off">' +
            '<button class="a-primary" type="submit" disabled>Continue</button></div></form>', mode);
          var input = el.querySelector('.a-input');
          var button = el.querySelector('.a-primary');
          input.addEventListener('input', function () { button.disabled = !input.value.trim(); });
          wire(el, function () {
            if (!input.value.trim() || input.disabled) return;
            input.disabled = button.disabled = true;
            el.querySelector('.a-status').innerHTML = badge('spin') + '<span class="a-count a-wait" role="status">' + esc(s.checking) + '</span>';
            // The first code pasted is rejected; the second is accepted.
            later(function () {
              state.tries++;
              if (state.tries === 1) show(i + 1);
              else doneLine(s.done.text, s.done.ok, i, DONE_HOLD);
            }, 900);
          }, '.a-input');
        },
        problem: function (s, i, mode) {
          var el = swap(
            status(badge('warn')) + '<h1 class="a-title" tabindex="-1">' + esc(s.message) + '</h1>' +
            '<p class="a-lede">' + esc(s.text) + '</p>' +
            '<form class="a-body">' + options(s.id, s.options, s.initial) + actions('Continue') + '</form>', mode);
          wire(el, function (form) {
            if (form.querySelector('input:checked').value === 'again') return show(i - 1);
            state.skipped = true;
            next(i);
          }, 'input:checked');
        },
        ending: function (s, i, mode) {
          var skipped = state.skipped ? s.ifSignInSkipped : null;
          var rows = labels.map(function (label, k) {
            var r = state.rows[label];
            var bad = r.s === 'bad' || /^Not/.test(r.v);
            return '<div class="a-row' + (bad ? ' is-bad' : '') + '" style="--k:' + k + '"><span class="a-tick" aria-hidden="true">' + (bad ? '!' : ICON.smallTick) + '</span>' +
              '<dt>' + esc(label) + '</dt><dd>' + esc(r.v) + '</dd></div>';
          }).join('');
          var nextText = skipped ? esc(skipped.next) : esc(s.next.text).replace(/(\/jumpstart)/, '<code>$1</code>');
          swap(
            '<div class="a-ending">' +
              '<div>' + status(badge(skipped ? 'warn' : 'tick')) +
                '<h1 class="a-title" tabindex="-1">' + esc(skipped ? skipped.closing : s.closing) + '</h1>' +
                (skipped ? '<p class="a-problem">' + esc(skipped.problem) + '</p>' : '') +
                '<div class="a-panel a-next"><h2>' + esc(s.next.title) + '</h2><p>' + nextText + '</p></div>' +
                '<p class="a-log">Log' + fmt(s.log) + '</p>' +
              '</div>' +
              '<div class="a-panel"><dl class="a-checklist">' + rows + '</dl></div>' +
            '</div>', mode);
        },
      };

      // ---- Start: every earlier question answered with its default, every earlier step done ----
      var start = Math.max(0, screens.findIndex(function (s) { return s.id === ctx.startAt; }));
      var atProblem = screens[start].kind === 'problem';
      screens.slice(0, start).forEach(function (s) {
        if (QUESTION[s.kind]) answer(s, s.initial);
        // Starting on the problem means the sign-in before it didn't work.
        else if (!(atProblem && s.kind === 'signIn')) settle(s);
      });
      // Starting on the problem means one code has already been turned down, so the next one works.
      if (atProblem) state.tries = 1;
      if (ctx.panelOpen) setOpen(true);
      show(start);
    },
  });
})();
