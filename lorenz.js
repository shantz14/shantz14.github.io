/* Lorenz flow-field background drawn behind the garden pages. */
(function () {
    const canvas = document.getElementById('lorenz-bg');
    const ctx = canvas.getContext('2d');
    let W, H;

    function resize() {
        W = canvas.width  = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const σ = 10, ρ = 28, β = 8 / 3;
    const COLS = 72, ROWS = 45;
    const field = new Float32Array(COLS * ROWS);

    function buildField(t) {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const lx = (c / COLS) * 52 - 26;
                const lz = (r / ROWS) * 52;
                // multi-frequency y keeps fixed points shifting faster than particles can converge
                const ly = Math.sin(t * 0.0008 + c * 0.12) * 12
                         + Math.cos(t * 0.0005 + r * 0.09) * 7
                         + Math.sin(t * 0.0013 + (c + r) * 0.07) * 4;
                const dx = σ * (ly - lx);
                const dz = lx * ly - β * lz;
                // spatially-varying curl bias breaks residual convergence sinks
                const curl = 0.55 * Math.sin(lx * 0.18 + t * 0.0002)
                                   * Math.cos(lz * 0.12);
                field[r * COLS + c] = Math.atan2(dz, dx) + curl;
            }
        }
    }

    function sampleField(px, py) {
        const c = Math.max(0, Math.min(COLS - 1, Math.floor((px / W) * COLS)));
        const r = Math.max(0, Math.min(ROWS - 1, Math.floor((py / H) * ROWS)));
        return field[r * COLS + c];
    }

    const N = 220, TRAIL = 10, SPEED = 0.55;
    const C = '165,243,252';

    function spawn() {
        return {
            x: Math.random() * W,
            y: Math.random() * H,
            trail: [],
            life: 0,
            maxLife: 180 + Math.random() * 360,
            checkX: 0, checkY: 0,
        };
    }

    const particles = Array.from({ length: N }, spawn);

    let t = 0;

    function frame() {
        t++;
        if (t % 2 === 0) buildField(t);

        ctx.fillStyle = 'rgba(17,17,17,0.10)';
        ctx.fillRect(0, 0, W, H);

        for (const p of particles) {
            const angle = sampleField(p.x, p.y);
            p.x += Math.cos(angle) * SPEED;
            p.y += Math.sin(angle) * SPEED;
            p.life++;

            p.trail.push({ x: p.x, y: p.y });
            if (p.trail.length > TRAIL) p.trail.shift();

            if (p.trail.length > 1) {
                for (let i = 1; i < p.trail.length; i++) {
                    const a = ((i / TRAIL) * 0.22).toFixed(2);
                    ctx.strokeStyle = `rgba(${C},${a})`;
                    ctx.lineWidth = 0.65;
                    ctx.beginPath();
                    ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y);
                    ctx.lineTo(p.trail[i].x, p.trail[i].y);
                    ctx.stroke();
                }
            }

            ctx.fillStyle = `rgba(${C},0.38)`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.0, 0, Math.PI * 2);
            ctx.fill();

            // every 20 frames check if particle is stuck
            if (p.life % 20 === 0) {
                if (Math.hypot(p.x - p.checkX, p.y - p.checkY) < 4) {
                    Object.assign(p, spawn()); continue;
                }
                p.checkX = p.x; p.checkY = p.y;
            }

            if (p.x < -8 || p.x > W + 8 || p.y < -8 || p.y > H + 8 || p.life > p.maxLife) {
                Object.assign(p, spawn());
            }
        }

        requestAnimationFrame(frame);
    }

    buildField(0);
    requestAnimationFrame(frame);
})();
