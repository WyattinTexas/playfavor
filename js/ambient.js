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
 *   smoke       — one thin lazy wisp curling up from the cottage chimney
 *   petals      — loose petals tumbling across the meadow on the breeze
 *   sparkle     — rare dew-glints blooming in the flower beds
 *   cloudShadows— vast soft shade patches sliding slowly over the meadow
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
        petals: true,
        sparkle: true,
        cloudShadows: true,
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

    // ══ CHIMNEY SMOKE — one thin lazy wisp from the cottage chimney ═════
    // Everything lives in IMAGE coordinates and rides coverTransform, so
    // the smoke stays glued to the chimney mouth at any window size (same
    // contract as COTTAGE_POLY — re-anchor SMOKE_EMIT if the bg changes).
    // Drawn BEFORE the occluder: the wisp's root is clipped by the
    // chimney's own pixels, so it appears to emerge from inside the flue.
    //
    // Render: NOT stacked discs (v1 — read as grey circles on the art).
    // The wisp is a metaball chain: ~30 tiny radial-gradient blobs sampled
    // along a curling path, dense enough to fuse into one soft ribbon with
    // no visible edges. Motion cues: the whole ribbon waves slowly, and a
    // dissolve wave TRAVELS UPWARD along it (lumps of density rising), so
    // it reads as climbing smoke rather than a static airbrush stroke.
    // Fully stateless — every frame is a pure function of Date.now().
    const SMOKE_EMIT = { x: 607, y: 133 };        // chimney mouth (image px)
    const SMOKE_RISE = 80;                        // wisp height (image px)

    function stepSmoke(now, w, h) {
        if (!bgImg.complete || !bgImg.naturalWidth) return;
        const { s, ox, oy } = coverTransform(w, h);
        const exC = ox + SMOKE_EMIT.x * s;
        if (exC < -40 || exC > w + 40) return;
        const t = now / 1000;
        const N = 30;
        // slow breathing of the wisp's overall strength — sometimes the
        // fire is drawing well, sometimes it's nearly out
        const breath = 0.82 + 0.18 * Math.sin(t * 0.23 + Math.sin(t * 0.061) * 2);
        for (let i = 0; i < N; i++) {
            const u = i / (N - 1);                 // 0 root → 1 tip
            // path: nearly vertical at the flue, bending right with height,
            // waving as one connected ribbon (phase runs along u so the
            // curl S-shapes rather than swinging like a stick)
            const bend = u * u * 10;               // breeze carries the top
            const wave = Math.sin(t * 0.6 - u * 3.2) * (1 + u * 3.5);
            const ix = SMOKE_EMIT.x + bend + wave;
            const iy = SMOKE_EMIT.y - u * SMOKE_RISE * (0.72 + 0.28 * breath);
            // density: solid near the root, dissolving toward the tip, with
            // lumps travelling UP the ribbon (the rising-motion cue)
            const travel = 0.62 + 0.38 * Math.sin(u * 9 - t * 2.1);
            const alpha = 0.36 * breath * Math.pow(1 - u, 1.2) * travel;
            if (alpha < 0.004) continue;
            const r = Math.max(1.6, (3.8 + u * 17) * s);
            const x = ox + ix * s, y = oy + iy * s;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, `rgba(150, 146, 158, ${alpha.toFixed(3)})`);
            g.addColorStop(1, 'rgba(150, 146, 158, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Deterministic per-slot randomness for the stateless systems below —
    // hash a slot/seed index into [0,1) so every frame agrees on it.
    function hash01(j, k) {
        const v = Math.sin(j * k) * 43758.5453;
        return v - Math.floor(v);
    }

    // ══ CLOUD SHADOWS — vast shade patches sliding over the meadow ══════
    // The clouds themselves stay painted; what moves is their SHADE on the
    // ground — how film fakes a living landscape. Two huge soft ellipses
    // drift left-to-right on long staggered periods, fading in from the
    // left edge and out at the right. Kept low over the meadow band; the
    // occluder repaints the cottage after us, so buildings stay sunlit
    // (subtle enough that this reads as terrain, not an error). Stateless.
    function stepCloudShadows(now, w, h) {
        const defs = [
            { period: 56000, y: 0.78, rx: 0.38, ry: 0.17, a: 0.42, off: 0.0 },
            { period: 83000, y: 0.66, rx: 0.30, ry: 0.13, a: 0.34, off: 0.47 },
        ];
        // multiply blend: darkens like real shade (flowers keep their hue)
        // instead of a grey wash sitting on top
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        defs.forEach((d, di) => {
            const p = ((now / d.period) + d.off) % 1;      // 0..1 across
            const cx = (p * 1.5 - 0.25) * w;               // enter/exit offscreen
            const cy = d.y * h;
            const edge = Math.min(1, Math.min(p, 1 - p) * 5);   // soft in/out
            if (edge <= 0.01) return;
            // three offset lobes so the shade reads as a cloud's footprint,
            // not a stamped circle
            const lobes = [
                { dx: 0, dy: 0, k: 1 },
                { dx: -0.55, dy: 0.25, k: 0.72 },
                { dx: 0.5, dy: -0.2, k: 0.66 },
            ];
            lobes.forEach(lb => {
                const rx = d.rx * w * lb.k, ry = d.ry * h * lb.k;
                const x = cx + lb.dx * d.rx * w, y = cy + lb.dy * d.ry * h;
                const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
                g.addColorStop(0, `rgba(148, 152, 172, ${(d.a * edge).toFixed(3)})`);
                g.addColorStop(0.65, `rgba(148, 152, 172, ${(d.a * 0.55 * edge).toFixed(3)})`);
                g.addColorStop(1, 'rgba(148, 152, 172, 0)');
                ctx.save();
                ctx.translate(x, y);
                ctx.scale(1, ry / rx);                      // squash: ground perspective
                ctx.translate(-x, -y);
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(x, y, rx, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });
        });
        ctx.restore();
    }

    // ══ PETALS — loose petals tumbling across the meadow breeze ═════════
    // Bigger, bolder cousins of the pollen: each petal crosses the lower
    // meadow left-to-right with a fluttery sink-and-lift, tumbling as it
    // goes (the ellipse squashes through the roll). Stateless slots.
    const PETAL_TINTS = [
        [246, 196, 208],   // wild rose
        [250, 240, 228],   // cream
        [238, 130, 142],   // deep pink
        [244, 214, 170],   // marigold
    ];

    function stepPetals(now, w, h) {
        const N = 7;
        for (let i = 0; i < N; i++) {
            const cyc = 9500 + hash01(i + 1, 91.3) * 7000;   // crossing time
            const raw = now / cyc + hash01(i + 1, 17.9);
            const k = Math.floor(raw);                       // journey index
            const p = raw - k;                               // 0..1 across
            const seed = (i + 1) * 131 + (k % 97);           // fresh path each journey
            const y0 = (0.52 + hash01(seed, 53.7) * 0.4) * h;
            const x = (p * 1.16 - 0.08) * w;
            const flut = 2 + hash01(seed, 29.1) * 2;
            const y = y0 + Math.sin(p * Math.PI * flut) * h * 0.05
                    + p * h * 0.07;                          // gentle net sink
            const fade = Math.min(1, Math.min(p, 1 - p) * 9);
            if (fade <= 0) continue;
            const tint = PETAL_TINTS[seed % PETAL_TINTS.length];
            const r = 2.6 + hash01(seed, 71.7) * 2.2;
            const t = now / 1000;
            const spin = t * (1.1 + hash01(seed, 13.3)) + hash01(seed, 41.9) * 6.3;
            const tumble = 0.3 + 0.7 * Math.abs(Math.sin(t * 1.7 + seed));
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(spin);
            ctx.fillStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${(0.78 * fade).toFixed(3)})`;
            ctx.beginPath();
            ctx.ellipse(0, 0, r, r * tumble * 0.62, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    // ══ SPARKLE — rare dew-glints blooming in the flower beds ═══════════
    // A tiny 4-point star blooms and dies in about a second, somewhere in
    // a flower zone; one or two alive at any moment. Stateless slots.
    const SPARK_ZONES = [
        { x0: 0.02, x1: 0.30, y0: 0.62, y1: 0.94 },   // left flower bank
        { x0: 0.55, x1: 0.97, y0: 0.66, y1: 0.94 },   // right meadow
        { x0: 0.30, x1: 0.55, y0: 0.82, y1: 0.97 },   // path-side blooms
    ];

    function stepSparkle(now, w, h) {
        const SLOTS = 3;
        for (let i = 0; i < SLOTS; i++) {
            const cyc = 2400 + hash01(i + 1, 67.3) * 2200;
            const raw = now / cyc + hash01(i + 1, 23.7);
            const k = Math.floor(raw);
            const p = raw - k;
            const DUTY = 0.38;                         // glint lives, then quiet
            if (p >= DUTY) continue;
            const q = p / DUTY;                        // 0..1 through the glint
            const seed = (i + 1) * 173 + (k % 89);
            const z = SPARK_ZONES[seed % SPARK_ZONES.length];
            const x = (z.x0 + hash01(seed, 37.1) * (z.x1 - z.x0)) * w;
            const y = (z.y0 + hash01(seed, 59.9) * (z.y1 - z.y0)) * h;
            const bloom = Math.sin(q * Math.PI);       // in and out
            const L = (3 + hash01(seed, 11.7) * 3.5) * bloom;
            const a = 0.85 * bloom;
            const rot = hash01(seed, 83.3) * Math.PI;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rot);
            ctx.strokeStyle = `rgba(255, 250, 218, ${a.toFixed(3)})`;
            ctx.lineWidth = 1.1;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(-L, 0); ctx.lineTo(L, 0);
            ctx.moveTo(0, -L); ctx.lineTo(0, L);
            ctx.stroke();
            ctx.fillStyle = `rgba(255, 253, 235, ${a.toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(0, 0, 1.2 * bloom, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
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
            // ground first (shade, glints), then the air above it
            if (AMBIENT.cloudShadows) stepCloudShadows(now, w, h);
            if (AMBIENT.sparkle) stepSparkle(now, w, h);
            if (AMBIENT.pollen) stepPollen(now, w, h);
            if (AMBIENT.petals) stepPetals(now, w, h);
            if (AMBIENT.butterflies) stepButterflies(now, w, h, dt);
            if (AMBIENT.birds) stepBirds(now, w, h);
            if (AMBIENT.smoke) stepSmoke(now, w, h);
            drawCottageOccluder(w, h);   // foreground wins — depth is real
        }
        requestAnimationFrame(frame);
    }

    scheduleFlock(true);
    requestAnimationFrame(frame);

    // Dev hooks (harmless in prod): tools/ambient-preview.html uses these —
    // spawn a flock on demand, and flip elements live for look-testing.
    window._ambientFlockNow = function (opts) {
        const { w, h } = fit();
        flock = Object.assign(makeFlock(w, h), opts || {});
    };
    window._ambientToggle = function (key) {
        if (key in AMBIENT) AMBIENT[key] = !AMBIENT[key];
        return AMBIENT[key];
    };
    window._ambientGet = function () {
        return Object.assign({}, AMBIENT);
    };
})();
