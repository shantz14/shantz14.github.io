// Note pages: a quietly drifting graph of the garden behind the page, and a reading-progress
// rail on the left that surfaces the heading you are in.
(() => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const currentSlug = document.body.dataset.note || null;

  // ── Background graph ──
  // Same forces as the graph view (graph.js), but it never cools completely, and every node
  // wanders on a slow random heading, so the layout breathes while links keep it together.
  (function graphBackground() {
    const canvas = document.getElementById('note-graph-bg');
    if (!canvas || !window.loadGarden) return;
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    let nodes = [], edges = [];
    let view = null; // eased toward the fitted view each frame
    let alpha = 1;

    function resize() {
      W = innerWidth; H = innerHeight;
      dpr = devicePixelRatio || 1;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      if (reduceMotion) { fit(true); draw(); }
    }

    function setup(garden) {
      const byId = new Map();
      nodes = garden.notes.map((n, i) => {
        const a = i * 2.4, r = 30 + 14 * Math.sqrt(i);
        const node = {
          id: n.slug, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, deg: 0,
          heading: Math.random() * Math.PI * 2,
          shade: 215 + Math.floor(Math.random() * 40), // white to off-white
        };
        byId.set(n.slug, node);
        return node;
      });
      edges = garden.links.map(([a, b]) => [byId.get(a), byId.get(b)]).filter(([a, b]) => a && b);
      for (const [a, b] of edges) { a.deg++; b.deg++; }
    }

    function tick() {
      const REPEL = 3000, SPRING = 0.04, LENGTH = 80, GRAVITY = 0.006, DAMPING = 0.82, DRIFT = 0.025;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
          const f = (REPEL / d2) * alpha, d = Math.sqrt(d2);
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
        n.heading += (Math.random() - 0.5) * 0.08;
        n.vx += Math.cos(n.heading) * DRIFT - n.x * GRAVITY * alpha;
        n.vy += Math.sin(n.heading) * DRIFT - n.y * GRAVITY * alpha;
        n.vx *= DAMPING; n.vy *= DAMPING;
        n.x += n.vx; n.y += n.vy;
      }
      alpha = Math.max(0.35, alpha * 0.985);
    }

    // Fit the whole graph to the viewport. x and y scale separately (within a 2:1 ratio) so the
    // graph spreads into the margins either side of the page instead of hiding behind it.
    function fit(snap) {
      if (!nodes.length || !W) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
      }
      const pad = 70;
      let kx = Math.min(3, (W - pad * 2) / Math.max(maxX - minX, 1));
      let ky = Math.min(3, (H - pad * 2) / Math.max(maxY - minY, 1));
      kx = Math.min(kx, ky * 2); ky = Math.min(ky, kx * 2);
      const target = { kx, ky, x: W / 2 - ((minX + maxX) / 2) * kx, y: H / 2 - ((minY + maxY) / 2) * ky };
      if (snap || !view) { view = target; return; }
      for (const key in target) view[key] += (target[key] - view[key]) * 0.012;
    }

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!view) return;
      const sx = (n) => n.x * view.kx + view.x, sy = (n) => n.y * view.ky + view.y;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
      ctx.beginPath();
      for (const [a, b] of edges) { ctx.moveTo(sx(a), sy(a)); ctx.lineTo(sx(b), sy(b)); }
      ctx.stroke();
      for (const n of nodes) {
        const r = 2.5 + Math.sqrt(n.deg) * 1.6;
        const current = n.id === currentSlug;
        ctx.fillStyle = `rgba(${n.shade}, ${n.shade}, ${n.shade - 6}, ${current ? 0.95 : 0.55})`;
        ctx.beginPath();
        ctx.arc(sx(n), sy(n), r, 0, Math.PI * 2);
        ctx.fill();
        if (current) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.beginPath();
          ctx.arc(sx(n), sy(n), r + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    function frame() {
      tick();
      fit(false);
      draw();
      requestAnimationFrame(frame);
    }

    addEventListener('resize', resize);
    resize();
    window.loadGarden().then((g) => {
      setup(g);
      for (let i = 0; i < 300; i++) tick(); // settle before the first frame
      fit(true);
      if (reduceMotion) draw();
      else requestAnimationFrame(frame);
    }).catch(() => {});
  })();

  // ── Local graph ──
  // A small square above the reading rail showing just this note and the notes it links with.
  // Hover a node for its title, click to open it.
  (function localGraph() {
    if (!currentSlug || !window.loadGarden) return;
    const SIZE = 180, PAD = 22;

    window.loadGarden().then((garden) => {
      const near = new Set([currentSlug]);
      for (const [a, b] of garden.links) {
        if (a === currentSlug) near.add(b);
        if (b === currentSlug) near.add(a);
      }
      const titles = new Map(garden.notes.map((n) => [n.slug, n.title]));
      const slugs = [...near].filter((s) => titles.has(s));
      if (slugs.length < 2) return;

      const byId = new Map();
      const nodes = slugs.map((s, i) => {
        const a = i * 2.4, r = s === currentSlug ? 0 : 40;
        const node = { id: s, title: titles.get(s), x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, deg: 0 };
        byId.set(s, node);
        return node;
      });
      const edges = garden.links
        .filter(([a, b]) => byId.has(a) && byId.has(b))
        .map(([a, b]) => [byId.get(a), byId.get(b)]);
      for (const [a, b] of edges) { a.deg++; b.deg++; }

      // Settle once; the layout stays still so it reads as a map, not decoration.
      let alpha = 1;
      for (let step = 0; step < 300; step++) {
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
            if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
            const d = Math.sqrt(d2), f = (1500 / d2) * alpha;
            a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
            b.vx += (dx / d) * f; b.vy += (dy / d) * f;
          }
        }
        for (const [a, b] of edges) {
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (d - 50) * 0.05 * alpha;
          a.vx += (dx / d) * f; a.vy += (dy / d) * f;
          b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
        }
        for (const n of nodes) {
          n.vx = (n.vx - n.x * 0.01 * alpha) * 0.8;
          n.vy = (n.vy - n.y * 0.01 * alpha) * 0.8;
          n.x += n.vx; n.y += n.vy;
        }
        alpha *= 0.98;
      }

      // Fit into the square, centred on the bounding box.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
      }
      const k = Math.min(2.5, (SIZE - PAD * 2) / Math.max(maxX - minX, maxY - minY, 1));
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      for (const n of nodes) {
        n.sx = SIZE / 2 + (n.x - cx) * k;
        n.sy = SIZE / 2 + (n.y - cy) * k;
        n.r = n.id === currentSlug ? 5 : 3 + Math.sqrt(n.deg) * 0.8;
      }

      const box = document.createElement('nav');
      box.className = 'local-graph';
      box.setAttribute('aria-label', 'Local graph');
      const heading = document.createElement('p');
      heading.className = 'side-label';
      heading.textContent = 'Local graph';
      const canvas = document.createElement('canvas');
      const tip = document.createElement('div');
      tip.className = 'local-graph-tip';
      const frame = document.createElement('div');
      frame.className = 'local-graph-frame';
      frame.append(canvas, tip);
      box.append(heading, frame);
      document.body.append(box);

      const dpr = devicePixelRatio || 1;
      canvas.width = canvas.height = SIZE * dpr;
      const ctx = canvas.getContext('2d');
      let hover = null;

      function draw() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.lineWidth = 1;
        for (const [a, b] of edges) {
          const lit = hover && (a === hover || b === hover);
          ctx.strokeStyle = lit ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.16)';
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
        for (const n of nodes) {
          const current = n.id === currentSlug;
          ctx.fillStyle = current || n === hover ? 'rgba(255, 255, 255, 0.95)' : 'rgba(225, 225, 219, 0.55)';
          ctx.beginPath();
          ctx.arc(n.sx, n.sy, n.r, 0, Math.PI * 2);
          ctx.fill();
          if (current) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.beginPath();
            ctx.arc(n.sx, n.sy, n.r + 4, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }

      function nodeAt(e) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        let best = null, bestD = Infinity;
        for (const n of nodes) {
          const d = Math.hypot(n.sx - x, n.sy - y);
          if (d < n.r + 6 && d < bestD) { best = n; bestD = d; }
        }
        return best;
      }

      canvas.addEventListener('pointermove', (e) => {
        const n = nodeAt(e);
        if (n === hover) return;
        hover = n;
        canvas.style.cursor = n && n.id !== currentSlug ? 'pointer' : '';
        if (n) {
          tip.textContent = n.title;
          tip.style.left = n.sx + 'px';
          tip.style.top = n.sy - n.r - 6 + 'px';
          tip.hidden = false;
        } else tip.hidden = true;
        draw();
      });
      canvas.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; draw(); });
      canvas.addEventListener('click', (e) => {
        const n = nodeAt(e);
        if (n && n.id !== currentSlug) location.href = '/notes/' + n.id;
      });

      tip.hidden = true;
      draw();
    }).catch(() => {});
  })();

  // ── Reading rail ──
  // A thin vertical line with a marker that tracks scroll position. Each heading is a tick at the
  // point where it becomes the one being read, and the current heading's name rides beside the marker.
  (function readingRail() {
    const content = document.getElementById('content');
    if (!content || !currentSlug) return;
    const title = content.querySelector('h1');
    const headings = [...content.querySelectorAll('h1, h2, h3')].filter((h) => h !== title && h.id);

    const rail = document.createElement('nav');
    rail.className = 'note-rail';
    rail.setAttribute('aria-label', 'Sections');
    const line = document.createElement('div');
    line.className = 'rail-line';
    const fill = document.createElement('div');
    fill.className = 'rail-fill';
    const marker = document.createElement('div');
    marker.className = 'rail-marker';
    const label = document.createElement('div');
    label.className = 'rail-label';
    marker.append(label);
    line.append(fill);

    const sections = [{ el: null, text: title ? title.textContent : '', level: 0, at: 0 }];
    for (const h of headings) {
      const level = Number(h.tagName[1]);
      const tick = document.createElement('a');
      tick.className = 'rail-tick';
      tick.dataset.level = level;
      tick.href = '#' + h.id;
      tick.setAttribute('aria-label', h.textContent);
      const tip = document.createElement('span');
      tip.textContent = h.textContent;
      tick.append(tip);
      line.append(tick);
      sections.push({ el: h, tick, text: h.textContent, level, at: 0 });
    }
    line.append(marker);
    rail.append(line);
    document.body.append(rail);

    const READ_LINE = 0.3; // a heading is "being read" once it passes 30% down the viewport
    let current = null;

    function measure() {
      const max = document.documentElement.scrollHeight - innerHeight;
      for (const s of sections) {
        if (!s.el) continue;
        const top = s.el.getBoundingClientRect().top + scrollY;
        s.at = max > 0 ? Math.min(1, Math.max(0, (top - innerHeight * READ_LINE) / max)) : 0;
        s.tick.style.top = s.at * 100 + '%';
      }
      update();
    }

    function update() {
      const max = document.documentElement.scrollHeight - innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
      marker.style.top = p * 100 + '%';
      fill.style.height = p * 100 + '%';
      let s = sections[0];
      for (const c of sections) if (c.at <= p + 1e-4) s = c;
      for (const c of sections) c.tick?.classList.toggle('passed', c.at <= p + 1e-4);
      if (s !== current) {
        current = s;
        label.dataset.level = s.level;
        label.classList.remove('pop');
        label.textContent = s.text;
        void label.offsetWidth; // restart the animation
        label.classList.add('pop');
      }
    }

    addEventListener('scroll', update, { passive: true });
    addEventListener('resize', measure);
    addEventListener('load', measure); // images change heading positions
    measure();
  })();
})();
