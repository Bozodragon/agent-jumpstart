// PROTOTYPE, throwaway. Loads the page's one design (variants/a.*) and draws the floating bar,
// which is not part of the design: a screen picker and Restart.
// ?at=<screen id> starts at that screen. ?panel=open starts with the panel of answers and
// what's set up open (for screenshots). ?variant= is ignored: round one's B and C are in git history.
(() => {
  const params = new URLSearchParams(location.search);
  const ids = window.FLOW.screens.map((screen) => screen.id);
  const at = ids.includes(params.get('at')) ? params.get('at') : ids[0];
  /** @type {{ key: string, name: string, mount: Function } | undefined} */
  let registered;

  const urlFor = (screen) => `?at=${screen}`;
  const go = (screen) => location.assign(urlFor(screen));

  window.PROTO = {
    /** The design's script calls this once: `{ key, name, mount(root, { flow, startAt, panelOpen, onScreen }) }`. */
    register(variant) {
      registered = variant;
    },
  };

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'variants/a.css';
  document.head.append(css);
  const script = document.createElement('script');
  script.src = 'variants/a.js';
  script.onload = () => {
    label.textContent = registered?.name ?? 'not built yet';
    registered?.mount(document.getElementById('stage'), {
      flow: window.FLOW,
      startAt: at,
      panelOpen: params.get('panel') === 'open',
      /** The design says which screen it's showing, each time that changes. */
      onScreen(id) {
        if (!ids.includes(id)) return;
        select.value = id;
        history.replaceState(null, '', urlFor(id));
      },
    });
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
      #proto-bar button { padding: 0 10px; }
      #proto-bar select { padding: 0 8px; max-width: 160px; }
      #proto-bar button:hover, #proto-bar select:hover { background: rgba(0,0,0,.2); }
      #proto-bar .label { padding: 0 6px; }
      #proto-bar .tag { font-weight: 500; opacity: .65; padding-left: 6px; }
    </style>
    <span class="tag">Prototype</span>
    <span class="label"></span>
    <select aria-label="Jump to a screen"></select>
    <button type="button" data-restart>Restart</button>`;
  document.body.append(bar);
  const label = bar.querySelector('.label');
  const select = bar.querySelector('select');
  for (const id of ids) select.add(new Option(id, id));
  select.value = at;
  select.addEventListener('change', () => go(select.value));
  bar.querySelector('[data-restart]').addEventListener('click', () => go(ids[0]));
})();
