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
 *   smoke       — soft puffs curling up from the cottage chimney
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
        smoke: true,
    };

    const canvas = document.getElementById('tsAmbient');
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try {
        if (new URLSearchParams(location.search).get('ambient') === 'off') return;
    } catch (e) {}

    const ctx = canvas.getContext('2d');

    // ── The cottage is FOREGROUND: birds (and anything else) pass BEHIND
    // it. We redraw the cottage's own pixels over the animation each frame,
    // clipped to its silhouette — identical pixels mean the patch is
    // invisible, and slack over sky costs nothing. Geometry mirrors the
    // .ts-bg CSS exactly (cover, background-position 68% 34%) — if that
    // CSS changes, change BG_POS here too.
    const BG_DIMS = { w: 2400, h: 1535 };
    const BG_POS = { x: 0.68, y: 0.34 };
    // Auto-traced from the painting's pixels (tools/trace-occluder.py) —
    // regenerate with that script if the menu bg or its crop ever changes.
    // Covers the cottage AND the tree line to its right, out to where the
    // treetops fall below the birds' flight band.
    const COTTAGE_POLY = [
        [216,505], [240,498], [242,491], [258,482], [282,481], [284,469],
        [296,463], [312,440], [316,409], [348,395], [370,332], [386,331],
        [426,269], [574,205], [578,146], [594,135], [636,142], [640,165],
        [662,159], [702,136], [710,120], [726,120], [754,190], [866,403],
        [888,404], [900,415], [908,415], [914,426], [916,455], [950,474],
        [966,499], [976,501], [980,513], [1008,517], [1010,500], [1044,499],
        [1046,488], [1082,485], [1084,475], [1118,477], [1136,489], [1138,502],
        [1152,502], [1162,524], [1186,523], [1192,540], [1220,546], [1222,538],
        [1242,539], [1268,570], [1290,560], [1292,550], [1310,550], [1320,561],
        [1320,840], [216,840],
    ];
    const bgImg = new Image();
    bgImg.src = 'assets/ui/menu-meadow.jpg';

    function coverTransform(w, h) {
        const s = Math.max(w / BG_DIMS.w, h / BG_DIMS.h);
        return {
            s,
            ox: (w - BG_DIMS.w * s) * BG_POS.x,
            oy: (h - BG_DIMS.h * s) * BG_POS.y,
        };
    }

    function drawCottageOccluder(w, h) {
        if (!bgImg.complete || !bgImg.naturalWidth) return;
        const { s, ox, oy } = coverTransform(w, h);
        ctx.save();
        ctx.beginPath();
        COTTAGE_POLY.forEach(([px, py], i) => {
            const x = ox + px * s, y = oy + py * s;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(bgImg, ox, oy, BG_DIMS.w * s, BG_DIMS.h * s);
        ctx.restore();
    }

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
            const size = 4 + Math.random() * 4.5;
            birds.push({
                ox: (i - n / 2) * (26 + Math.random() * 14) + (Math.random() - 0.5) * 18,
                oy: (Math.random() - 0.5) * 34 + Math.abs(i - n / 2) * 9,
                size,
                // smaller birds read as farther: fainter, and they lag the
                // flock a touch more so the formation breathes
                alpha: 0.34 + (size - 4) * 0.05,
                lag: (Math.random() - 0.5) * 0.06,
                flapHz: 2.4 + Math.random() * 0.9,             // quick wingbeats
                flapPhase: Math.random() * Math.PI * 2,
                bobPhase: Math.random() * Math.PI * 2,
                // flap-burst / glide cycle, each bird on its own clock
                cycleT0: Date.now() - Math.random() * 3000,
                flapFor: 900 + Math.random() * 1100,
                glideFor: 700 + Math.random() * 1300,
            });
        }
        return {
            t0: Date.now(), dir, birds,
            baseY: h * (0.07 + Math.random() * 0.22),      // upper sky band
            dur: 15000 + Math.random() * 6000,
            drift: (Math.random() - 0.5) * h * 0.12,
        };
    }

    // A bird's full flight state for this frame. The burst/glide alternation
    // is what sells "bird" — a constant sine reads as a metronome — and the
    // BOUNDING coupling is what sells "flight": climb through the flap burst,
    // sink through the glide, so the path undulates with the wing rhythm.
    //   pose  — wing raise in [-0.55, 1]; quick beats, then a held shallow V
    //   alt   — bounding offset in [-1 (top of climb), +1 (bottom of sink)]
    //   tilt  — body pitch (rad), nose up while climbing, down while sinking
    function flightState(now, b) {
        const cycle = b.flapFor + b.glideFor;
        const tc = (now - b.cycleT0) % cycle;
        const beat = Math.sin((now / 1000) * b.flapHz * Math.PI * 2 + b.flapPhase);
        const GLIDE = 0.38;                                // wings up, shallow V
        if (tc < b.flapFor) {
            const blend = Math.min(1, Math.min(tc, b.flapFor - tc) / 180);
            const q = tc / b.flapFor;                      // climbing leg
            return {
                pose: GLIDE + (beat * 0.78 - GLIDE + 0.22) * blend,
                alt: Math.cos(q * Math.PI),
                tilt: -Math.sin(q * Math.PI) * 0.14,
            };
        }
        const q = (tc - b.flapFor) / b.glideFor;           // sinking leg
        return {
            pose: GLIDE + Math.sin(now / 240 + b.bobPhase) * 0.05,
            alt: -Math.cos(q * Math.PI),
            tilt: Math.sin(q * Math.PI) * 0.10,
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

    // Filled tapered-wing silhouette — the soft dark dab a painter would
    // put in this sky, not a stroked glyph. `pose` raises/lowers the wings;
    // the tips trail slightly below the leading edge, which is what makes
    // the shape read as feathers instead of a check mark.
    function drawBird(x, y, size, pose, alpha, tilt) {
        const s = size, lift = pose * s * 0.72;
        ctx.save();
        ctx.translate(x, y);
        if (tilt) ctx.rotate(tilt);
        ctx.fillStyle = `rgba(42, 36, 46, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        for (const side of [-1, 1]) {
            const tipX = side * s, tipY = -lift;
            ctx.moveTo(0, -s * 0.10);
            // leading edge out to the wingtip
            ctx.quadraticCurveTo(side * s * 0.45, -lift * 0.62 - s * 0.10, tipX, tipY);
            // trailing edge back to the body, sagging behind the beat
            ctx.quadraticCurveTo(side * s * 0.42, -lift * 0.38 + s * 0.16, 0, s * 0.12);
            ctx.closePath();
        }
        ctx.fill();
        // body: a small teardrop with a hint of tail
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.30, s * 0.13, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function stepBirds(now, w, h) {
        if (!flock) return;
        const p = (now - flock.t0) / flock.dur;
        if (p >= 1) { flock = null; scheduleFlock(false); return; }
        const margin = 120;
        const t = now / 1000;
        flock.birds.forEach(b => {
            const bp = Math.max(0, Math.min(1, p + b.lag));   // stragglers trail
            const lx = flock.dir > 0 ? (-margin + bp * (w + margin * 2))
                                     : (w + margin - bp * (w + margin * 2));
            const ly = flock.baseY + flock.drift * bp + Math.sin(bp * Math.PI * 3) * 9;
            const f = flightState(now, b);
            // slow formation wander so the flock breathes instead of riding rails
            const wx = Math.sin(t * 0.25 + b.bobPhase * 1.7) * 7;
            const bound = f.alt * (2.5 + b.size * 0.9);       // bounding flight
            drawBird(lx + (b.ox + wx) * flock.dir, ly + b.oy + bound,
                     b.size, f.pose, b.alpha, f.tilt * flock.dir);
        });
    }

    // ══ POLLEN — sparse sunlit motes climbing the light ═════════════════
    const MOTES = 36;
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

    // ══ CHIMNEY SMOKE — soft puffs curling from the cottage chimney ═════
    // Everything lives in IMAGE coordinates and rides coverTransform, so
    // the smoke stays glued to the chimney mouth at any window size (same
    // contract as COTTAGE_POLY — re-anchor SMOKE_EMIT if the bg changes).
    // Drawn BEFORE the occluder: a fresh puff's base is clipped by the
    // chimney's own pixels, so it appears to emerge from inside the flue.
    const SMOKE_EMIT = { x: 607, y: 133 };        // chimney mouth (image px)
    const SMOKE_SPACING = 1150;                   // ms between puff births

    // STATELESS, like the birds: the set of live puffs is a pure function
    // of the clock — each SMOKE_SPACING time slot births one puff whose
    // character comes from hashing its slot index. No spawn state to
    // starve on low-FPS devices, after tab-hidden pauses, or under
    // virtual-time test renders; the column is always warm.
    function hash01(j, k) {
        const v = Math.sin(j * k) * 43758.5453;
        return v - Math.floor(v);
    }

    function stepSmoke(now, w, h) {
        if (!bgImg.complete || !bgImg.naturalWidth) return;
        const { s, ox, oy } = coverTransform(w, h);
        if (ox + SMOKE_EMIT.x * s < -40 || ox + SMOKE_EMIT.x * s > w + 40) return;
        const slot = Math.floor(now / SMOKE_SPACING);
        for (let j = slot - 6; j <= slot; j++) {
            const life = 4200 + hash01(j, 127.1) * 2400;
            const age = now - j * SMOKE_SPACING;
            if (age < 0 || age >= life) continue;
            const jx = (hash01(j, 311.7) - 0.5) * 5;       // spawn jitter (image px)
            const swayPhase = hash01(j, 74.7) * Math.PI * 2;
            const r0 = 4.5 + hash01(j, 311.7) * 3;         // birth radius (image px)
            const ageS = age / 1000;
            const q = age / life;                  // 0..1 through its life
            // rise decelerates as the puff thins; drift right on the same
            // breeze the pollen rides, with a widening lazy sway
            const ix = SMOKE_EMIT.x + jx + ageS * 5.5
                     + Math.sin(ageS * 0.9 + swayPhase) * (4 + q * 10);
            const iy = SMOKE_EMIT.y - ageS * 11 * (1 - q * 0.35);
            const r = (r0 + q * 16) * s;
            const fade = Math.min(1, q * 5) * Math.pow(1 - q, 0.9);
            const x = ox + ix * s, y = oy + iy * s;
            ctx.beginPath();
            ctx.arc(x, y, Math.max(1, r), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(138, 134, 148, ${(0.22 * fade).toFixed(3)})`;
            ctx.fill();
            ctx.beginPath();                        // soft halo
            ctx.arc(x, y, Math.max(1, r * 1.7), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(138, 134, 148, ${(0.10 * fade).toFixed(3)})`;
            ctx.fill();
        }
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
            if (AMBIENT.smoke) stepSmoke(now, w, h);
            drawCottageOccluder(w, h);   // foreground wins — depth is real
        }
        requestAnimationFrame(frame);
    }

    scheduleFlock(true);
    requestAnimationFrame(frame);

    // Dev hook (harmless in prod): tools/ambient-preview.html uses this to
    // spawn a flock on demand instead of waiting out the schedule.
    window._ambientFlockNow = function (opts) {
        const { w, h } = fit();
        flock = Object.assign(makeFlock(w, h), opts || {});
    };
})();
