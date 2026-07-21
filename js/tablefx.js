// ═══ TABLE FX — animated life for RARE table skins ═══════════════════════
// REMOVABILITY CONTRACT (same as ambient.js): to remove ALL table fx,
// delete this file, its <script> tag, and the TABLEFX.apply() call in
// applyTableSkin — nothing else references it. ?fx=off disables at runtime.
// Per-effect flags below. prefers-reduced-motion renders everything inert.
//
// Design rules (learned on menu-ambient):
//  - STATELESS: every frame is f(Date.now()) + hash01 — no per-frame spawn
//    accumulation, so captures and low-FPS devices both stay correct.
//  - The fx layer is the FIRST CHILD of #game-screen: above its background,
//    under every positioned sibling (all gameplay UI). pointer-events: none.
//  - Canvas runs only while a rare skin is equipped AND the tab is visible.

(function () {
    'use strict';

    var FX = {                       // per-effect kill switches
        sheen: true,                 // foil sweep (all rare skins)
        embers: true,                // Ember Throne breathing veins + sparks
        stars: true,                 // Astronomer Royal twinkle + meteor
        caustics: true,              // Drowned Vault light ripple + glints
    };

    var off = false;
    try {
        var q = new URLSearchParams(location.search).get('fx');
        if (q === 'off') off = true;
        if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) off = true;
    } catch (e) {}

    // Asset paths resolve against THIS SCRIPT's location, not the page's —
    // the harness lives in tools/ and page-relative urls 404 there (the
    // ambient-preview <base> lesson, solved at the source this time).
    var ROOT = (function () {
        try { return document.currentScript.src.replace(/js\/tablefx\.js.*$/, ''); }
        catch (e) { return ''; }
    })();

    // ── deterministic hash noise (menu-ambient pattern) ──
    function hash01(n) {
        var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }

    // Per-skin recipe. tile = the css tile size the skin paints at (keep in
    // sync with style.css); glow = pre-extracted bright-layer png; pts = baked
    // motif positions IN TILE COORDS (0..1) for aligned glints/twinkles.
    var SKINS = {
        'rare-ember': {
            tile: 520, sheen: true,
            glow: 'assets/ui/fx-ember-glow.png', glowAnim: 'tfxBreathe 9s ease-in-out infinite',
            sparks: true,
        },
        'rare-astronomer': {
            tile: 560, sheen: true,
            twinkle: true, pts: [],        // filled from fx-astronomer-pts.js.json baked below
            meteor: true,
        },
        'rare-vault': {
            tile: 560, sheen: true,
            caustics: ['assets/ui/fx-caustic-a.png', 'assets/ui/fx-caustic-b.png'],
            glint: true, pts: [],
        },
    };
    // Baked motif positions (tile-relative 0..1) — written by tools/bake-fx-points.py
    var PTS = window.TABLEFX_PTS || {};

    var layer = null, canvas = null, ctx = null, raf = 0, active = null;

    function mount() {
        var host = document.getElementById('game-screen');
        if (!host || layer) return;
        layer = document.createElement('div');
        layer.id = 'tableFx';
        host.insertBefore(layer, host.firstChild);
        canvas = document.createElement('canvas');
        canvas.id = 'tableFxCanvas';
        layer.appendChild(canvas);
        ctx = canvas.getContext('2d');
    }

    function resize() {
        if (!canvas) return;
        var w = innerWidth, h = innerHeight;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }

    // tile a set of relative points across the viewport → screen positions
    function tiledPoints(pts, tile) {
        var out = [], w = innerWidth, h = innerHeight;
        for (var ty = 0; ty * tile < h + tile; ty++)
            for (var tx = 0; tx * tile < w + tile; tx++)
                for (var i = 0; i < pts.length; i++)
                    out.push([tx * tile + pts[i][0] * tile, ty * tile + pts[i][1] * tile, i + tx * 31 + ty * 57]);
        return out;
    }

    // ── frame painters (all stateless in t = Date.now()) ──
    function paintSparks(t, cfg) {
        // one ember pop at a time, every 7-14s, 700ms life, hash position
        var slot = Math.floor(t / 9000);
        var born = slot * 9000 + hash01(slot) * 5000;
        var age = (t - born) / 700;
        if (age < 0 || age > 1) return;
        var x = hash01(slot * 3 + 1) * canvas.width;
        var y = hash01(slot * 3 + 2) * canvas.height;
        var r = 1.5 + 6 * age, a = 0.5 * (1 - age);
        var g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
        g.addColorStop(0, 'rgba(255,190,90,' + a + ')');
        g.addColorStop(1, 'rgba(255,120,20,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    }

    function star4(x, y, r, a, col) {
        ctx.save();
        ctx.translate(x, y);
        ctx.globalAlpha = a;
        ctx.fillStyle = col;
        ctx.beginPath();
        for (var i = 0; i < 4; i++) {
            ctx.rotate(Math.PI / 2);
            ctx.moveTo(0, 0); ctx.lineTo(r * 0.18, r * 0.18);
            ctx.lineTo(0, r); ctx.lineTo(-r * 0.18, r * 0.18);
        }
        ctx.fill();
        ctx.restore();
    }

    function paintTwinkles(t, cfg, col) {
        var pts = tiledPoints(PTS[active] || [], cfg.tile);
        if (!pts.length) return;
        // ~4 concurrent twinkles, staggered 1.8s slots, 1.4s life each
        for (var k = 0; k < 4; k++) {
            var slot = Math.floor(t / 1800) - k;
            var idx = Math.floor(hash01(slot * 7 + k * 13) * pts.length);
            var p = pts[idx]; if (!p) continue;
            var age = (t - slot * 1800) / 1400;
            if (age < 0 || age > 1) continue;
            var a = Math.sin(age * Math.PI);
            star4(p[0], p[1], 3.5 + 2.5 * a, 0.55 * a, col);
        }
    }

    function paintMeteor(t) {
        // one streak every 60-90s, 900ms life, upper third, never center
        var slot = Math.floor(t / 75000);
        var born = slot * 75000 + hash01(slot * 5) * 15000;
        var age = (t - born) / 900;
        if (age < 0 || age > 1) return;
        var w = canvas.width, side = hash01(slot * 5 + 1) < 0.5;
        var y0 = (0.06 + 0.18 * hash01(slot * 5 + 2)) * canvas.height;
        var x0 = side ? -40 : w + 40;
        var dx = (side ? 1 : -1) * (w * 0.5) * age;
        var x = x0 + dx, y = y0 + 60 * age;
        var lg = ctx.createLinearGradient(x, y, x - (side ? 1 : -1) * 90, y - 26);
        var a = Math.sin(age * Math.PI) * 0.7;
        lg.addColorStop(0, 'rgba(255,244,210,' + a + ')');
        lg.addColorStop(1, 'rgba(255,244,210,0)');
        ctx.strokeStyle = lg; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.lineTo(x - (side ? 1 : -1) * 90, y - 26); ctx.stroke();
    }

    function frame() {
        raf = 0;
        if (!active || off) return;
        var cfg = SKINS[active];
        resize();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        var t = Date.now();
        if (cfg.sparks && FX.embers) paintSparks(t, cfg);
        if (cfg.twinkle && FX.stars) paintTwinkles(t, cfg, '#ffe9b0');
        if (cfg.meteor && FX.stars) paintMeteor(t);
        if (cfg.glint && FX.caustics) paintTwinkles(t, cfg, '#d8f4e8');
        schedule();
    }
    function schedule() {
        if (raf || !active || off || document.hidden) return;
        raf = setTimeout(function () { requestAnimationFrame(frame); }, 33); // ~30fps cap
    }
    document.addEventListener('visibilitychange', schedule);

    function apply(skinId) {
        if (off) return;
        mount();
        if (!layer) return;
        var cfg = SKINS[skinId];
        active = cfg ? skinId : null;
        // CSS-driven layers (sheen band, glow breathe, caustic drift)
        layer.className = active ? 'tfx-on tfx-' + skinId : '';
        layer.querySelectorAll('.tfx-img').forEach(function (el) { el.remove(); });
        if (cfg) {
            if (cfg.glow && FX.embers) {
                var g = document.createElement('div');
                g.className = 'tfx-img tfx-glow';
                g.style.backgroundImage = 'url(' + ROOT + cfg.glow + ')';
                g.style.backgroundSize = cfg.tile + 'px';
                g.style.animation = cfg.glowAnim;
                layer.appendChild(g);
            }
            if (cfg.caustics && FX.caustics) {
                cfg.caustics.forEach(function (src, i) {
                    var c = document.createElement('div');
                    c.className = 'tfx-img tfx-caustic tfx-caustic-' + i;
                    c.style.backgroundImage = 'url(' + ROOT + src + ')';
                    layer.appendChild(c);
                });
            }
            if (cfg.sheen && FX.sheen) {
                var s = document.createElement('div');
                s.className = 'tfx-img tfx-sheen';
                layer.appendChild(s);
            }
        }
        if (canvas) { ctx.clearRect(0, 0, canvas.width, canvas.height); }
        schedule();
    }

    window.TABLEFX = { apply: apply, FX: FX };

    // ui.js applies the persisted skin before this file loads (defer order) —
    // self-apply once so a rare skin equipped last session animates on boot.
    try {
        var cur = localStorage.getItem('favor_table_skin');
        if (cur && SKINS[cur]) apply(cur);
    } catch (e) {}
})();
