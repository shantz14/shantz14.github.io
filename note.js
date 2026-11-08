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
      const REPEL = 3000, SPRING = 0.04, LENGTH = 80, GRAVITY = 0.006, DAMPING = 0.82, DRIFT = 0.05;
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
        n.heading += (Math.random() - 0.5) * 0.15;
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
      for (const key in target) view[key] += (target[key] - view[key]) * 0.02;
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
