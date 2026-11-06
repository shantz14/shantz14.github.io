// Graph view of the digital garden, in the spirit of Obsidian's: a force-directed layout of the
// published notes and the links between them. Loaded on demand by palette.js, which also provides
// window.loadGarden(). Drag a node to move it, drag the background to pan, scroll to zoom, click a
// node to open it. "Local" limits the graph to the current note and its neighbours.
(() => {
  const currentSlug = (location.pathname.match(/^\/notes\/([^/]+)$/) || [])[1] || null;

  let backdrop, canvas, ctx, status, localBtn, globalBtn;
  let garden = null, scope = 'global';
  let nodes = [], edges = [], byId = new Map();
  let view = { x: 0, y: 0, k: 1 }; // screen = world * k + (x, y), in CSS pixels
  let W = 0, H = 0, dpr = 1;
  let alpha = 0, raf = 0;
  let hover = null, drag = null;
let autoFit = true; // keep the whole graph in view until the user pans or zooms
  let colors = {};

  function cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function build() {
    backdrop = document.createElement('div');
    backdrop.className = 'gg-backdrop';
    backdrop.hidden = true;
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });

    const panel = document.createElement('div');
    panel.className = 'gg-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Graph view');

    const header = document.createElement('div');
    header.className = 'gg-header';
    const title = document.createElement('span');
    title.className = 'gg-title';
    title.textContent = 'Graph';
    globalBtn = button('global', () => setScope('global'));
    localBtn = button('local', () => setScope('local'));
    if (!currentSlug) {
      localBtn.disabled = true;
      localBtn.title = 'Open a note to see its local graph';
    }
    const closeBtn = button('esc ✕', () => close());
    closeBtn.setAttribute('aria-label', 'Close graph');
    header.append(title, globalBtn, localBtn, closeBtn);

    canvas = document.createElement('canvas');
    canvas.className = 'gg-canvas';
    ctx = canvas.getContext('2d');

    status = document.createElement('div');
    status.className = 'gg-status';

    panel.append(header, canvas, status);
    backdrop.append(panel);
    document.body.append(backdrop);

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', () => { if (!drag) setHover(null); });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    new ResizeObserver(resize).observe(canvas);
  }

  function button(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  // ── Data ──

  function setScope(s) {
    if (s === 'local' && !currentSlug) return;
    scope = s;
    globalBtn.setAttribute('aria-pressed', String(s === 'global'));
    localBtn.setAttribute('aria-pressed', String(s === 'local'));
    layout();
  }

  function layout() {
    if (!garden) return;
    const old = byId;
    let ids = garden.notes.map((n) => n.slug);
    let links = garden.links;
    if (scope === 'local') {
      const near = new Set([currentSlug]);
      for (const [a, b] of garden.links) {
        if (a === currentSlug) near.add(b);
        if (b === currentSlug) near.add(a);
      }
      ids = ids.filter((id) => near.has(id));
      links = links.filter(([a, b]) => near.has(a) && near.has(b));
    }

    const titles = new Map(garden.notes.map((n) => [n.slug, n.title]));
    byId = new Map();
    nodes = ids.map((id, i) => {
      // Keep positions across scope changes; otherwise start on a jittered spiral.
      const prev = old.get(id);
      const a = i * 2.4, r = 30 + 14 * Math.sqrt(i);
      const n = {
        id, title: titles.get(id), deg: 0, vx: 0, vy: 0,
        x: prev ? prev.x : Math.cos(a) * r, y: prev ? prev.y : Math.sin(a) * r,
        neighbors: new Set(),
      };
      byId.set(id, n);
      return n;
    });
    edges = links.map(([a, b]) => [byId.get(a), byId.get(b)]).filter(([a, b]) => a && b);
    for (const [a, b] of edges) {
      a.deg++; b.deg++;
      a.neighbors.add(b); b.neighbors.add(a);
    }
    status.textContent = nodes.length ? '' : 'No notes to show.';
    view = { x: W / 2, y: H / 2, k: 1 };
    autoFit = true;
    hover = null;
    reheat(1);
  }

  const radius = (n) => 3.5 + Math.sqrt(n.deg) * 2.4;

  // ── Simulation ──

  function reheat(a = 0.6) {
    alpha = Math.max(alpha, a);
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function tick() {
    const REPEL = 3000, SPRING = 0.04, LENGTH = 80, GRAVITY = 0.006, DAMPING = 0.82;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
        const f = (REPEL / d2) * alpha;
        const d = Math.sqrt(d2);
        a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f; b.vy += (dy / d) * f;
      }
    }
    for (const [a, b] of edges) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - LENGTH) * SPRING * alpha;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      n.vx -= n.x * GRAVITY * alpha;
      n.vy -= n.y * GRAVITY * alpha;
      if (drag && drag.node === n) { n.vx = n.vy = 0; continue; }
      n.vx *= DAMPING; n.vy *= DAMPING;
      n.x += n.vx; n.y += n.vy;
    }
    alpha *= 0.985;
  }

  function frame() {
    raf = 0;
    if (backdrop.hidden) return;
    tick();
    if (autoFit) fitView();
    draw();
    if (alpha > 0.004 || drag) raf = requestAnimationFrame(frame);
  }

  // Zoom and centre so every node fits with a margin (never zooming in past 2x).
  function fitView() {
    if (!nodes.length || !W || !H) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    }
    const pad = 70;
    const k = Math.min(2, (W - pad * 2) / Math.max(maxX - minX, 1), (H - pad * 2) / Math.max(maxY - minY, 1));
    view.k = Math.max(0.2, k);
    view.x = W / 2 - ((minX + maxX) / 2) * view.k;
    view.y = H / 2 - ((minY + maxY) / 2) * view.k;
  }

  // ── Drawing ──

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);

    const focus = hover;
    const lit = (n) => !focus || n === focus || focus.neighbors.has(n);

    ctx.lineWidth = 1 / view.k;
    for (const [a, b] of edges) {
      const on = focus && (a === focus || b === focus);
      ctx.strokeStyle = on ? colors.accentLine : focus ? colors.faintLine : colors.line;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    const fontSize = 11 / Math.max(view.k, 0.6);
    ctx.font = `${fontSize}px 'IBM Plex Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const n of nodes) {
      const r = radius(n);
      const isCurrent = n.id === currentSlug;
      ctx.globalAlpha = lit(n) ? 1 : 0.25;
      ctx.fillStyle = n === focus || isCurrent ? colors.accent : colors.node;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (isCurrent) {
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1 / view.k;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Labels fade in as you zoom, and always show around the hovered node.
      const labelAlpha = focus ? (lit(n) ? 1 : 0.15) : Math.min(1, Math.max(0, (view.k - 0.55) * 2.5));
      if (labelAlpha > 0) {
        ctx.globalAlpha = labelAlpha;
        ctx.fillStyle = n === focus ? colors.text : colors.label;
        ctx.fillText(n.title, n.x, n.y + r + 4);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ── Interaction ──

  function toWorld(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    return { sx, sy, x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  }

  function nodeAt(p) {
    let best = null, bestD = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      const hit = radius(n) + 6 / view.k;
      if (d < hit && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  function setHover(n) {
    if (hover === n) return;
    hover = n;
    canvas.classList.toggle('gg-over-node', !!n);
    if (!raf) draw();
  }

  function onDown(e) {
    const p = toWorld(e);
    const node = nodeAt(p);
    drag = { node, startX: p.sx, startY: p.sy, viewX: view.x, viewY: view.y, moved: false };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('gg-dragging');
    if (node) { autoFit = false; reheat(0.3); }
  }

  function onMove(e) {
    const p = toWorld(e);
    if (!drag) { setHover(nodeAt(p)); return; }
    if (Math.hypot(p.sx - drag.startX, p.sy - drag.startY) > 4) drag.moved = true;
    if (drag.node) {
      drag.node.x = p.x;
      drag.node.y = p.y;
      reheat(0.3);
    } else {
      autoFit = false;
      view.x = drag.viewX + (p.sx - drag.startX);
      view.y = drag.viewY + (p.sy - drag.startY);
      if (!raf) draw();
    }
  }

  function onUp(e) {
    if (!drag) return;
    const { node, moved } = drag;
    drag = null;
    canvas.classList.remove('gg-dragging');
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (node && !moved && e.type === 'pointerup') location.href = '/notes/' + node.id;
  }

  function onWheel(e) {
    e.preventDefault();
    autoFit = false;
    const p = toWorld(e);
    const k = Math.min(4, Math.max(0.2, view.k * Math.exp(-e.deltaY * 0.0015)));
    view.x = p.sx - p.x * k;
    view.y = p.sy - p.y * k;
    view.k = k;
    if (!raf) draw();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    // Keep the graph centred where it was when the panel changes size.
    view.x += (rect.width - W) / 2;
    view.y += (rect.height - H) / 2;
    W = rect.width; H = rect.height;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    if (autoFit) fitView();
    draw();
  }

  function onKey(e) {
    if (e.key === 'Escape' && !backdrop.hidden && !document.querySelector('.cp-backdrop:not([hidden])')) {
      e.preventDefault();
      close();
    }
  }

  // ── Open / close ──

  let returnFocus = null;

  function open() {
    if (!backdrop) build();
    const accent = cssVar('--accent', '#a5f3fc');
    colors = {
      accent,
      text: cssVar('--name-color', '') || cssVar('--text', '#d4d4d4'),
      node: cssVar('--text-muted', '#aaaaaa'),
      label: cssVar('--text-muted', '#aaaaaa'),
      line: 'rgba(255, 255, 255, 0.28)',
      faintLine: 'rgba(255, 255, 255, 0.08)',
      accentLine: accent,
    };
    returnFocus = document.activeElement;
    backdrop.hidden = false;
    document.addEventListener('keydown', onKey);
    resize();
    if (garden) {
      setScope(scope);
      return;
    }
    status.textContent = 'Loading notes...';
    window.loadGarden()
      .then((g) => { garden = g; setScope('global'); })
      .catch(() => { status.textContent = 'Could not load notes.'; });
  }

  function close() {
    backdrop.hidden = true;
    document.removeEventListener('keydown', onKey);
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    returnFocus?.focus?.();
  }

  window.GardenGraph = { open, close };
})();
