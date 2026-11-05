// Command palette: Ctrl-P (Cmd-P on Mac) opens a fuzzy-filtered list of site commands.
(() => {
  const onHome = location.pathname === '/' || location.pathname === '/index.html';

  // Jump to a section on the home page: scroll if we're already there, otherwise navigate.
  const section = (id) => () => {
    const el = onHome && document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else location.href = '/#' + id;
  };
  const go = (url) => () => { location.href = url; };

  const COMMANDS = [
    { name: 'Go to Home', run: go('/') },
    { name: 'Go to Projects', run: section('projects') },
    { name: 'Go to Comments', run: section('comments') },
    { name: 'Go to Books', run: go('/books.html') },
    { name: 'Open Resume', run: go('/resume.pdf') },
  ];

  const RECENT_KEY = 'palette-recent';

  function loadRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
  }

  function saveRecent(name) {
    try {
      const recent = [name, ...loadRecent().filter((n) => n !== name)].slice(0, 10);
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
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

  function results(query) {
    if (!query.trim()) {
      const recent = loadRecent();
      const rank = (c) => { const i = recent.indexOf(c.name); return i < 0 ? Infinity : i; };
      // Array sort is stable, so non-recent commands keep their list order.
      return [...COMMANDS].sort((a, b) => rank(a) - rank(b)).map((cmd) => ({ cmd, positions: [] }));
    }
    return COMMANDS
      .map((cmd) => ({ cmd, m: fuzzy(query, cmd.name) }))
      .filter((r) => r.m)
      .sort((a, b) => b.m.score - a.m.score)
      .map(({ cmd, m }) => ({ cmd, positions: m.positions }));
  }

  // ── DOM ──

  let backdrop, input, list, items = [], selected = 0, returnFocus = null;

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
    input.placeholder = 'Type a command...';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'cp-list');
    input.addEventListener('input', () => { selected = 0; render(); });
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

  function render() {
    items = results(input.value);
    list.replaceChildren();

    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'cp-empty';
      empty.textContent = 'No commands found.';
      list.append(empty);
      input.removeAttribute('aria-activedescendant');
      return;
    }

    items.forEach(({ cmd, positions }, i) => {
      const li = document.createElement('li');
      li.className = 'cp-item';
      li.id = 'cp-item-' + i;
      li.setAttribute('role', 'option');
      // Highlight matched characters, grouping consecutive ones into a single span.
      const hits = new Set(positions);
      let run = '', runIsMatch = false;
      const flush = () => {
        if (!run) return;
        if (runIsMatch) {
          const mark = document.createElement('span');
          mark.className = 'cp-match';
          mark.textContent = run;
          li.append(mark);
        } else {
          li.append(run);
        }
        run = '';
      };
      [...cmd.name].forEach((ch, j) => {
        if (hits.has(j) !== runIsMatch) { flush(); runIsMatch = hits.has(j); }
        run += ch;
      });
      flush();
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
    const item = items[selected];
    if (!item) return;
    saveRecent(item.cmd.name);
    close(false);
    item.cmd.run();
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

  function open() {
    if (!backdrop) build();
    returnFocus = document.activeElement;
    input.value = '';
    selected = 0;
    render();
    backdrop.hidden = false;
    input.focus();
  }

  function close(restoreFocus = true) {
    backdrop.hidden = true;
    if (restoreFocus && returnFocus?.focus) returnFocus.focus();
    returnFocus = null;
  }

  // Capture phase, so Ctrl-P wins over the browser's print dialog and any focused widget.
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      e.stopPropagation();
      if (backdrop && !backdrop.hidden) close();
      else open();
    }
  }, true);
})();
