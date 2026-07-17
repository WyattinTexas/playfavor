/**
 * FAVOR — Ambient menu life (menu-ambient).
 *
 * Everything animated on the title screen lives HERE, drawing on the single
 * #tsAmbient canvas. Each element has its own switch below — flip one to
 * false to retire that element; delete this file + the canvas div + the
 * script tag to remove the whole layer with zero other edits.
 *
 * Systems (all clocked off Date.now() — rAF timestamps freeze under
 * virtual-time test renders, the melee lesson):
 *   birds       — a small flock crosses the upper sky every 25-55s
 *   pollen      — sparse sunlit motes drifting up through the meadow light
 *   butterflies — two or three fluttering low in the wildflower zones
 *
 * Guards: prefers-reduced-motion → layer stays inert; ?ambient=off kills it
 * for a session; drawing pauses while the tab is hidden or the title screen
 * is away. Butterflies keep to the flower bands (bottom corners) so nothing
 * flutters behind the menu cards.
 */
(function () {
    const AMBIENT = {
        birds: true,
        pollen: true,
        butterflies: true,
    };

    const canvas = document.getElementById('tsAmbient');
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try {
        if (new URLSearchParams(location.search).get('ambient') === 'off') return;
    } catch (e) {}

    const ctx = canvas.getContext('2d');

    function titleVisible() {
        const t = document.getElementById('title-screen');
        return t && !t.classList.contains('hidden') && t.style.display !== 'none';
    }

    function fit() {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr; canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        return { w, h };
    }

    // ══ BIRDS — a flock crosses the upper sky, then a long quiet ════════
    let flock = null, flockTimer = null;

    function makeFlock(w, h) {
        const dir = Math.random() < 0.7 ? 1 : -1;
        const n = 4 + Math.floor(Math.random() * 4);
        const birds = [];
        for (let i = 0; i < n; i++) {
            birds.push({
                ox: (i - n / 2) * (26 + Math.random() * 14) + (Math.random() - 0.5) * 18,
                oy: (Math.random() - 0.5) * 34 + Math.abs(i - n / 2) * 9,
                size: 5 + Math.random() * 3.5,
                flapSpeed: 5.5 + Math.random() * 2.5,
                flapPhase: Math.random() * Math.PI * 2,
                bobPhase: Math.random() * Math.PI * 2,
            });
        }
        return {
            t0: Date.now(), dir, birds,
            baseY: h * (0.07 + Math.random() * 0.22),      // upper sky band
            dur: 15000 + Math.random() * 6000,
            drift: (Math.random() - 0.5) * h * 0.12,
        };
    }

    function scheduleFlock(first) {
        clearTimeout(flockTimer);
        const delay = first ? 6000 + Math.random() * 4000 : 25000 + Math.random() * 30000;
        flockTimer = setTimeout(() => {
            if (AMBIENT.birds && titleVisible()) flock = makeFlock(fit().w, fit().h);
            else scheduleFlock(false);
        }, delay);
    }

    function drawBird(x, y, size, flap) {
        const lift = flap * size * 0.55;
        ctx.beginPath();
        ctx.moveTo(x - size, y - lift);
        ctx.quadraticCurveTo(x - size * 0.32, y + size * 0.14, x, y);
        ctx.quadraticCurveTo(x + size * 0.32, y + size * 0.14, x + size, y - lift);
        ctx.lineWidth = Math.max(1.1, size * 0.17);
        ctx.lineCap = 'round';
        ctx.stroke();
    }

    function stepBirds(now, w, h) {
        if (!flock) return;
        const p = (now - flock.t0) / flock.dur;
        if (p >= 1) { flock = null; scheduleFlock(false); return; }
        const margin = 120;
        const lx = flock.dir > 0 ? (-margin + p * (w + margin * 2))
                                 : (w + margin - p * (w + margin * 2));
        const ly = flock.baseY + flock.drift * p + Math.sin(p * Math.PI * 3) * 9;
        ctx.strokeStyle = 'rgba(44, 38, 52, 0.55)';       // soft against the blue
        const t = now / 1000;
        flock.birds.forEach(b => {
            const bob = Math.sin(t * 1.7 + b.bobPhase) * 3;
            drawBird(lx + b.ox * flock.dir, ly + b.oy + bob,
                     b.size, Math.sin(t * b.flapSpeed + b.flapPhase));
        });
    }

    // ══ POLLEN — sparse sunlit motes climbing the light ═════════════════
    const MOTES = 11;
    let motes = [];

    function makeMote(w, h, anywhere) {
        const life = 12000 + Math.random() * 9000;
        return {
            t0: Date.now() - (anywhere ? Math.random() * life : 0),
            life,
            x: Math.random() * w,
            y: h * (0.45 + Math.random() * 0.55),
            vy: -(4 + Math.random() * 7) / 1000,           // px per ms, upward
            vx: (2 + Math.random() * 5) / 1000,            // gentle rightward
            r: 1.1 + Math.random() * 1.6,
            wobblePhase: Math.random() * Math.PI * 2,
            wobbleAmp: 6 + Math.random() * 10,
        };
    }

    function stepPollen(now, w, h) {
        if (motes.length === 0) for (let i = 0; i < MOTES; i++) motes.push(makeMote(w, h, true));
        motes.forEach((m, i) => {
            const age = now - m.t0;
            if (age > m.life) { motes[i] = makeMote(w, h, false); return; }
            const p = age / m.life;
            const fade = Math.min(1, Math.min(p, 1 - p) * 6);   // ease in/out
            const x = m.x + m.vx * age + Math.sin(age / 1300 + m.wobblePhase) * m.wobbleAmp;
            const y = m.y + m.vy * age;
            if (y < -8 || x > w + 8) { motes[i] = makeMote(w, h, false); return; }
            const tw = 0.75 + Math.sin(age / 700 + m.wobblePhase) * 0.25;  // twinkle
            ctx.beginPath();
            ctx.arc(x, y, m.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 244, 214, ${(0.38 * fade * tw).toFixed(3)})`;
            ctx.fill();
        });
    }

    // ══ BUTTERFLIES — low in the wildflowers, never behind the menu ═════
    // Zones are the flower bands: bottom-left corner and the right meadow.
    const ZONES = [
        { x0: 0.42, x1: 0.62, y0: 0.84, y1: 0.96 },   // the sunlit path band
        { x0: 0.60, x1: 0.97, y0: 0.68, y1: 0.94 },   // the right meadow
    ];
    const BFLY_STYLES = [
        { wing: 'rgba(250, 246, 235, 0.92)', edge: 'rgba(120, 110, 100, 0.5)' },   // cabbage white
        { wing: 'rgba(235, 138, 52, 0.92)',  edge: 'rgba(70, 40, 20, 0.6)' },      // monarch orange
        { wing: 'rgba(250, 220, 120, 0.92)', edge: 'rgba(140, 100, 40, 0.55)' },   // brimstone yellow
    ];
    let bflies = [];

    function pointInZone(z, w, h) {
        return {
            x: (z.x0 + Math.random() * (z.x1 - z.x0)) * w,
            y: (z.y0 + Math.random() * (z.y1 - z.y0)) * h,
        };
    }

    function makeBfly(i, w, h) {
        const zone = ZONES[i % ZONES.length];
        const p = pointInZone(zone, w, h);
        return {
            zone, x: p.x, y: p.y,
            target: pointInZone(zone, w, h),
            style: BFLY_STYLES[i % BFLY_STYLES.length],
            size: 7 + Math.random() * 3,
            flapPhase: Math.random() * Math.PI * 2,
            flapHz: 7 + Math.random() * 3,
            bobPhase: Math.random() * Math.PI * 2,
            restUntil: 0,
        };
    }

    function stepButterflies(now, w, h, dt) {
        if (bflies.length === 0) for (let i = 0; i < 3; i++) bflies.push(makeBfly(i, w, h));
        const t = now / 1000;
        bflies.forEach(b => {
            // seek the target with a fluttery bob; rest on arrival, then pick anew
            const dx = b.target.x - b.x, dy = b.target.y - b.y;
            const dist = Math.hypot(dx, dy);
            const resting = now < b.restUntil;
            if (dist < 6 && !resting) {
                b.restUntil = now + 900 + Math.random() * 1800;
                b.target = pointInZone(b.zone, w, h);
            } else if (!resting) {
                const sp = 0.026 * dt;                       // unhurried
                b.x += (dx / dist) * sp + Math.sin(t * 2.3 + b.bobPhase) * 0.35;
                b.y += (dy / dist) * sp * 0.7 + Math.sin(t * 3.1 + b.bobPhase) * 0.55;
            }
            // draw: two wings flapping via horizontal squash, tiny body
            const flap = resting
                ? 0.25 + Math.abs(Math.sin(t * 2.2 + b.flapPhase)) * 0.2   // slow fan at rest
                : Math.abs(Math.sin(t * b.flapHz + b.flapPhase));
            const s = b.size, wingW = s * (0.35 + flap * 0.65);
            ctx.save();
            ctx.translate(b.x, b.y);
            if (!resting && dx < 0) ctx.scale(-1, 1);
            ctx.fillStyle = b.style.wing;
            ctx.strokeStyle = b.style.edge;
            ctx.lineWidth = 0.8;
            for (const side of [-1, 1]) {
                ctx.beginPath();
                ctx.ellipse(side * wingW * 0.52, -s * 0.12, wingW * 0.5, s * 0.62,
                            side * 0.5, 0, Math.PI * 2);
                ctx.fill(); ctx.stroke();
            }
            ctx.fillStyle = 'rgba(50, 40, 34, 0.85)';
            ctx.beginPath();
            ctx.ellipse(0, 0, s * 0.10, s * 0.42, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
    }

    // ══ The loop ════════════════════════════════════════════════════════
    let lastNow = Date.now();
    function frame() {
        const { w, h } = fit();
        const now = Date.now();
        const dt = Math.min(50, now - lastNow);
        lastNow = now;
        ctx.clearRect(0, 0, w, h);
        if (titleVisible() && !document.hidden) {
            if (AMBIENT.pollen) stepPollen(now, w, h);
            if (AMBIENT.butterflies) stepButterflies(now, w, h, dt);
            if (AMBIENT.birds) stepBirds(now, w, h);
        }
        requestAnimationFrame(frame);
    }

    scheduleFlock(true);
    requestAnimationFrame(frame);
})();
