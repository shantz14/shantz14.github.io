// Command palette. Ctrl-P (Cmd-P on Mac) opens a fuzzy-filtered list of site commands; Ctrl-O opens
// the same palette as a note finder over the digital garden. In the note finder, typing ">" first
// switches to commands.
(() => {
  const onHome = location.pathname === '/' || location.pathname === '/index.html';

  // Jump to a section on the home page: scroll if we're already there, otherwise navigate.
  const section = (id) => () => {
    const el = onHome && document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else location.href = '/#' + id;
  };
  const go = (url) => () => { location.href = url; };

  // The garden index (notes, tags, links) is fetched once, on first use, and shared with graph.js.
  let gardenPromise = null;
  window.loadGarden = () => {
    gardenPromise ??= fetch('/api/garden')
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch((err) => { gardenPromise = null; throw err; });
    return gardenPromise;
  };

  // graph.js is only downloaded when someone opens the graph.
  let graphScript = null;
  function openGraph() {
    graphScript ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/graph.js';
      s.onload = resolve;
      s.onerror = () => { graphScript = null; reject(); };
      document.head.append(s);
    });
    graphScript.then(() => window.GardenGraph.open());
  }

  const COMMANDS = [
    { name: 'Search Notes', run: () => open('notes') },
    { name: 'Open Graph View', run: openGraph },
    { name: 'Go to Home', run: go('/') },
    { name: 'Go to Notes', run: go('/notes/') },
    { name: 'Go to Books', run: go('/notes/#books') },
    { name: 'Go to Projects', run: section('projects') },
    { name: 'Go to Comments', run: section('comments') },
    { name: 'Open Resume', run: go('/resume.pdf') },
  ];

  const MODES = {
    commands: { placeholder: 'Type a command...', empty: 'No commands found.', recentKey: 'palette-recent' },
    notes: { placeholder: 'Find a note...', empty: 'No notes found.', recentKey: 'palette-recent-notes' },
  };

  function loadRecent(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
  }

  function saveRecent(key, id) {
    try {
      const recent = [id, ...loadRecent(key).filter((n) => n !== id)].slice(0, 10);
      localStorage.setItem(key, JSON.stringify(recent));
    } catch { /* storage unavailable */ }
  }

  // Returns { score, positions } if every query character appears in order in text, else null.
  function fuzzy(query, text) {
    const q = query.toLowerCase().replace(/\s+/g, '');
    const t = text.toLowerCase();
    const positions = [];
    let score = 0;
    let prev = -1;
    for (let i = 0; i < t.length && positions.length < q.length; i++) {
      if (t[i] !== q[positions.length]) continue;
      let pts = 1;
      if (prev >= 0 && i === prev + 1) pts += 5; // consecutive
      if (i === 0 || /[\s\-_/.]/.test(t[i - 1])) pts += 8; // start of a word
      pts -= prev >= 0 ? (i - prev - 1) * 0.1 : i * 0.05; // gaps
      score += pts;
      positions.push(i);
      prev = i;
    }
    return positions.length === q.length ? { score, positions } : null;
  }

  // Items for the current mode: { id, name, detail?, run }.
  function sourceItems() {
    if (mode === 'commands') return COMMANDS.map((c) => ({ ...c, id: c.name }));
    if (!garden) return [];
    return garden.notes.map((n) => ({
      id: n.slug,
      name: n.title,
      aliases: n.aliases,
      detail: n.tags.map((t) => '#' + t).join(' '),
      run: go('/notes/' + n.slug),
    }));
  }

  function results(query) {
    const all = sourceItems();
    if (!query.trim()) {
      const recent = loadRecent(MODES[mode].recentKey);
      const rank = (item) => { const i = recent.indexOf(item.id); return i < 0 ? Infinity : i; };
      // Array sort is stable, so non-recent items keep their list order.
      return [...all].sort((a, b) => rank(a) - rank(b)).map((item) => ({ item, positions: [] }));
    }
    return all
      .map((item) => {
        let m = fuzzy(query, item.name);
        let via = null;
        // A note also matches through its aliases, shown alongside the title.
        for (const alias of item.aliases || []) {
          const am = fuzzy(query, alias);
          if (am && (!m || am.score > m.score + 4)) { m = { score: am.score, positions: [] }; via = alias; }
        }
        // Failing that, a tag containing the query (e.g. "books") lists its notes below title matches.
        const q = query.trim().toLowerCase();
        if (!m && item.detail && item.detail.toLowerCase().includes(q)) m = { score: -1, positions: [] };
        return { item, m, via };
      })
      .filter((r) => r.m)
      .sort((a, b) => b.m.score - a.m.score)
      .map(({ item, m, via }) => ({ item, positions: m.positions, via }));
  }

  // ── DOM ──

  let backdrop, input, list, items = [], selected = 0, returnFocus = null;
  let mode = 'commands', garden = null, gardenError = false;

  function build() {
    backdrop = document.createElement('div');
    backdrop.className = 'cp-backdrop';
    backdrop.hidden = true;
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });

    const panel = document.createElement('div');
    panel.className = 'cp-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Command palette');

    input = document.createElement('input');
    input.className = 'cp-input';
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'cp-list');
    input.addEventListener('input', () => {
      if (mode === 'notes' && input.value.startsWith('>')) {
        input.value = input.value.slice(1);
        setMode('commands');
      }
      selected = 0;
      render();
    });
    input.addEventListener('keydown', onKey);

    list = document.createElement('ul');
    list.className = 'cp-list';
    list.id = 'cp-list';
    list.setAttribute('role', 'listbox');

    const footer = document.createElement('div');
    footer.className = 'cp-footer';
    for (const [keys, label] of [[['↑↓', '^J', '^K'], 'navigate'], [['↵', '^Y'], 'use'], [['esc'], 'dismiss']]) {
      const hint = document.createElement('span');
      for (const k of keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        hint.append(kbd);
      }
      hint.append(' ' + label);
      footer.append(hint);
    }

    panel.append(input, list, footer);
    backdrop.append(panel);
    document.body.append(backdrop);
  }

  function setMode(m) {
    mode = m;
    input.placeholder = MODES[m].placeholder;
    if (m === 'notes' && !garden) {
      window.loadGarden()
        .then((g) => { garden = g; gardenError = false; })
        .catch(() => { gardenError = true; })
        .finally(() => { if (!backdrop.hidden && mode === 'notes') render(); });
    }
  }

  function message(text) {
    const li = document.createElement('li');
    li.className = 'cp-empty';
    li.textContent = text;
    list.append(li);
    input.removeAttribute('aria-activedescendant');
  }

  // Appends text to el, wrapping the characters at `positions` in highlight spans.
  function highlighted(el, text, positions) {
    const hits = new Set(positions);
    let run = '', runIsMatch = false;
    const flush = () => {
      if (!run) return;
      if (runIsMatch) {
        const mark = document.createElement('span');
        mark.className = 'cp-match';
        mark.textContent = run;
        el.append(mark);
      } else {
        el.append(run);
      }
      run = '';
    };
    [...text].forEach((ch, j) => {
      if (hits.has(j) !== runIsMatch) { flush(); runIsMatch = hits.has(j); }
      run += ch;
    });
    flush();
  }

  function render() {
    list.replaceChildren();
    if (mode === 'notes' && !garden) {
      message(gardenError ? 'Could not load notes.' : 'Loading notes...');
      items = [];
      return;
    }
    items = results(input.value);
    if (!items.length) {
      message(MODES[mode].empty);
      return;
    }

    items.forEach(({ item, positions, via }, i) => {
      const li = document.createElement('li');
      li.className = 'cp-item';
      li.id = 'cp-item-' + i;
      li.setAttribute('role', 'option');
      const name = document.createElement('span');
      name.className = 'cp-name';
      highlighted(name, item.name, positions);
      if (via) {
        const alias = document.createElement('span');
        alias.className = 'cp-alias';
        alias.textContent = ' ← ' + via;
        name.append(alias);
      }
      li.append(name);
      if (item.detail) {
        const detail = document.createElement('span');
        detail.className = 'cp-detail';
        detail.textContent = item.detail;
        li.append(detail);
      }
      li.addEventListener('mousemove', () => { if (selected !== i) select(i); });
      li.addEventListener('click', () => { select(i); runSelected(); });
      list.append(li);
    });
    select(Math.min(selected, items.length - 1));
  }

  function select(i) {
    selected = i;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    const li = list.children[i];
    if (li) {
      input.setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    }
  }

  function move(delta) {
    if (!items.length) return;
    select((selected + delta + items.length) % items.length);
  }

  function runSelected() {
    const entry = items[selected];
    if (!entry) return;
    saveRecent(MODES[mode].recentKey, entry.item.id);
    close(false);
    entry.item.run();
  }

  function onKey(e) {
    const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
    let handled = true;
    if (e.key === 'ArrowDown' || (ctrl && e.key === 'j')) move(1);
    else if (e.key === 'ArrowUp' || (ctrl && e.key === 'k')) move(-1);
    else if (e.key === 'Enter' || (ctrl && e.key === 'y')) runSelected();
    else if (e.key === 'Escape') close();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function open(m = 'commands') {
    if (!backdrop) build();
    if (!backdrop.contains(document.activeElement)) returnFocus = document.activeElement;
    input.value = '';
    selected = 0;
    setMode(m);
    render();
    backdrop.hidden = false;
    input.focus();
  }

  function close(restoreFocus = true) {
    backdrop.hidden = true;
    if (restoreFocus && returnFocus?.focus) returnFocus.focus();
    returnFocus = null;
  }

  // Capture phase, so Ctrl-P/Ctrl-O win over the browser's print/open dialogs and any focused widget.
  // Pressing a palette's shortcut again closes it; pressing the other one switches mode.
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const key = e.key.toLowerCase();
    const want = key === 'p' ? 'commands' : key === 'o' ? 'notes' : null;
    if (!want) return;
    e.preventDefault();
    e.stopPropagation();
    if (backdrop && !backdrop.hidden && mode === want) close();
    else open(want);
  }, true);

  // Any element with data-open-graph (e.g. on the notes index) opens the graph.
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-open-graph]')) { e.preventDefault(); openGraph(); }
  });
})();
