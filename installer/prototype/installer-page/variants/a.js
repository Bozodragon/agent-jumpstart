// PROTOTYPE, throwaway. Variant A, "One thing at a time".
// The current thing (a question, the step being worked on, a notice, the sign-in, a problem) owns the
// whole screen and the page moves on when it's dealt with. Nothing that has happened stays on screen:
// the only trace is the row of dashes in the header. The ending is the one screen laid out all at once.
(function () {
  'use strict';

  var QUESTION = { choose: 1, confirm: 1, pick: 1, folder: 1 };
  var STEP_HOLD = 2200; // how long a plain line stays up
  var DONE_HOLD = 1700; // how long a "done" line stays up before the page moves on

  var ICON = {
    mark: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>',
    tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path class="a-draw" d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    smallTick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    spin: '<svg viewBox="0 0 34 34" fill="none"><circle class="a-ring-track" cx="17" cy="17" r="15.5"/><circle class="a-ring-arc" cx="17" cy="17" r="15.5" pathLength="100"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/></svg>',
  };

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
      (back ? '<button class="a-back" type="button">Back</button>' : '') + '</div>';
  }

  window.PROTO.register({
    key: 'A',
    name: 'One thing at a time',
    mount: function (root, ctx) {
      var flow = ctx.flow;
      var screens = flow.screens;
      var questions = screens.filter(function (s) { return QUESTION[s.kind]; });
      // The dashes: every screen but a problem, which is a detour from the one before it.
      var track = screens.filter(function (s) { return s.kind !== 'problem'; });
      var state = { answers: {}, tries: 0, skipped: false };
      var timers = [];
      var current = 0;

      // ---- The frame: a quiet header, and the stage ----
      var runs = ['', '', ''];
      track.forEach(function (s) {
        runs[QUESTION[s.kind] ? 0 : s.kind === 'ending' ? 2 : 1] += '<i class="a-seg"></i>';
      });
      root.innerHTML =
        '<div class="a-shell">' +
          '<header class="a-head">' +
            '<div class="a-brand"><span class="a-mark" aria-hidden="true">' + ICON.mark + '</span><span>' + esc(flow.title) + '</span></div>' +
            '<div class="a-progress" role="img">' + runs.map(function (r) { return '<span class="a-run">' + r + '</span>'; }).join('') + '</div>' +
          '</header>' +
          '<main class="a-stage"></main>' +
        '</div>';
      var shell = root.querySelector('.a-shell');
      var stage = root.querySelector('.a-stage');
      var progress = root.querySelector('.a-progress');
      var segs = Array.prototype.slice.call(root.querySelectorAll('.a-seg'));

      function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

      function paint() {
        var s = screens[current];
        var problem = s.kind === 'problem';
        var at = track.indexOf(problem ? screens[current - 1] : s);
        segs.forEach(function (seg, k) {
          var warn = track[k].kind === 'signIn' && (problem || state.skipped);
          seg.className = 'a-seg' + (warn ? ' is-warn' : k < at || s.kind === 'ending' ? ' is-done' : k === at ? ' is-now' : '');
        });
        progress.setAttribute('aria-label', 'Step ' + (at + 1) + ' of ' + track.length);
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
        paint();
        ctx.onScreen(s.id);
        draw[s.kind](s, i, mode);
        window.scrollTo(0, 0);
      }
      // The next screen in the run. A problem is only ever reached by something going wrong.
      function next(i) {
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
        if (target) target.focus({ preventScroll: true });
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
          state.answers[s.id] = value;
          next(i);
        }, focusOn);
        if (back) el.querySelector('.a-back').addEventListener('click', function () { show(i - 1, 'back'); });
        return el;
      }
      function answer(s) { return s.id in state.answers ? state.answers[s.id] : s.initial; }

      // A line with a tick, held for a moment, then the page moves on.
      function doneLine(text, ok, i, hold) {
        swap(status(badge(ok === false ? 'warn' : 'tick')) + '<h1 class="a-title" role="status">' + fmt(text) + '</h1>', 'soft');
        later(function () { next(i); }, hold);
      }

      var draw = {
        choose: function (s, i, mode) {
          question(s, i, mode, options(s.id, s.options, answer(s)), 'input:checked', function (form) {
            return form.querySelector('input:checked').value;
          });
        },
        confirm: function (s, i, mode) {
          var list = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
          question(s, i, mode, options(s.id, list, answer(s) ? 'yes' : 'no'), 'input:checked', function (form) {
            return form.querySelector('input:checked').value === 'yes';
          });
        },
        pick: function (s, i, mode) {
          question(s, i, mode, options(s.id, s.options, answer(s), true), 'input', function (form) {
            return Array.prototype.map.call(form.querySelectorAll('input:checked'), function (box) { return box.value; });
          });
        },
        folder: function (s, i, mode) {
          var el = question(s, i, mode,
            '<input class="a-input" type="text" name="folder" value="' + esc(answer(s)) + '" placeholder="' + esc(s.placeholder) + '" aria-label="' + esc(s.message) + '" spellcheck="false" autocomplete="off">' +
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
            };
            timers.push(setInterval(tick, 50));
          }
          later(function () { doneLine(s.done.text, s.done.ok, i, DONE_HOLD); }, s.seconds * 1000);
        },
        notice: function (s, i, mode) {
          var el = swap(
            status(badge('you')) + '<h1 class="a-title" tabindex="-1">' + esc(s.title) + '</h1>' +
            s.lines.map(function (line) { return '<p class="a-lede">' + esc(line) + '</p>'; }).join('') +
            '<ul class="a-bullets">' + s.bullets.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' +
            '<form>' + actions('Continue') + '</form>', mode);
          wire(el, function () { next(i); }, '.a-primary');
        },
        signIn: function (s, i, mode) {
          var el = swap(
            status(badge('spin')) + '<h1 class="a-title" tabindex="-1">' + esc(s.waiting) + '</h1>' +
            '<div class="a-copybox"><div class="a-copybox-head">' + esc(s.name) + '</div>' +
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
        ending: function (s, i, mode) {
          var skipped = state.skipped ? s.ifSignInSkipped : null;
          var rows = s.checklist.map(function (row, k) {
            var bad = /^Not/.test(row[1]);
            if (skipped && skipped.row[0] === row[0]) { row = skipped.row; bad = true; }
            return '<div class="a-row' + (bad ? ' is-bad' : '') + '" style="--k:' + k + '"><span class="a-tick" aria-hidden="true">' + (bad ? '!' : ICON.smallTick) + '</span>' +
              '<dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd></div>';
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
      screens.slice(0, start).forEach(function (s) {
        if (QUESTION[s.kind]) state.answers[s.id] = s.initial;
      });
      // Starting on the problem means one code has already been turned down, so the next one works.
      if (screens[start].kind === 'problem') state.tries = 1;
      show(start);
    },
  });
})();
