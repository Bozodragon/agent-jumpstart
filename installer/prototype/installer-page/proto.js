// PROTOTYPE, throwaway. Loads one variant (?variant=A|B|C) and draws the floating bar that
// switches between them. The bar is not part of any design. ?at=<screen id> starts a variant at
// that screen, and the bar keeps it across a switch, so the same screen can be compared.
(() => {
  const variants = ['A', 'B', 'C'];
  const params = new URLSearchParams(location.search);
  const current = variants.includes((params.get('variant') ?? '').toUpperCase()) ? params.get('variant').toUpperCase() : 'A';
  const ids = window.FLOW.screens.map((screen) => screen.id);
  let at = ids.includes(params.get('at')) ? params.get('at') : ids[0];
  /** @type {{ key: string, name: string, mount: Function } | undefined} */
  let registered;

  const urlFor = (variant, screen) => `?variant=${variant}&at=${screen}`;
  const go = (variant, screen) => location.assign(urlFor(variant, screen));
  const cycle = (by) => go(variants[(variants.indexOf(current) + by + variants.length) % variants.length], at);

  window.PROTO = {
    /** A variant's script calls this once: `{ key, name, mount(root, { flow, startAt, onScreen }) }`. */
    register(variant) {
      registered = variant;
    },
  };

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = `variants/${current.toLowerCase()}.css`;
  document.head.append(css);
  const script = document.createElement('script');
  script.src = `variants/${current.toLowerCase()}.js`;
  script.onload = () => {
    label.textContent = `${current} · ${registered?.name ?? 'not built yet'}`;
    registered?.mount(document.getElementById('stage'), {
      flow: window.FLOW,
      startAt: at,
      /** The variant says which screen it's showing, each time that changes. */
      onScreen(id) {
        if (!ids.includes(id)) return;
        at = id;
        select.value = id;
        history.replaceState(null, '', urlFor(current, id));
      },
    });
  };
  script.onerror = () => {
    label.textContent = `${current} · not built yet`;
  };
  document.body.append(script);

  // The bar.
  const bar = document.createElement('div');
  bar.id = 'proto-bar';
  bar.innerHTML = `
    <style>
      #proto-bar { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 9999;
        display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 999px;
        background: #f5d90a; color: #111; font: 600 12.5px/1 system-ui, sans-serif;
        box-shadow: 0 8px 28px rgba(0,0,0,.6), 0 0 0 1px rgba(0,0,0,.4); white-space: nowrap; }
      #proto-bar button, #proto-bar select { font: inherit; color: inherit; background: rgba(0,0,0,.1); border: 0; border-radius: 999px; height: 26px; cursor: pointer; }
      #proto-bar button { width: 26px; }
      #proto-bar button.wide { width: auto; padding: 0 10px; }
      #proto-bar select { padding: 0 8px; max-width: 150px; }
      #proto-bar button:hover, #proto-bar select:hover { background: rgba(0,0,0,.2); }
      #proto-bar .label { padding: 0 8px; min-width: 150px; text-align: center; }
      #proto-bar .tag { font-weight: 500; opacity: .65; padding-left: 6px; }
    </style>
    <span class="tag">Prototype</span>
    <button type="button" data-by="-1" aria-label="Previous variant">←</button>
    <span class="label"></span>
    <button type="button" data-by="1" aria-label="Next variant">→</button>
    <select aria-label="Jump to a screen"></select>
    <button type="button" class="wide" data-restart>Restart</button>`;
  document.body.append(bar);
  const label = bar.querySelector('.label');
  label.textContent = current;
  const select = bar.querySelector('select');
  for (const id of ids) select.add(new Option(id, id));
  select.value = at;
  select.addEventListener('change', () => go(current, select.value));
  bar.querySelector('[data-restart]').addEventListener('click', () => go(current, ids[0]));
  for (const button of bar.querySelectorAll('[data-by]')) button.addEventListener('click', () => cycle(Number(button.dataset.by)));
  addEventListener('keydown', (event) => {
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], [role="radio"], [role="radiogroup"], [role="listbox"]')) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft') cycle(-1);
    if (event.key === 'ArrowRight') cycle(1);
  });
})();
