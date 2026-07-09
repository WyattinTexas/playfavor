/**
 * FAVOR — Melee battle & coronation cinematic.
 *
 * Four acts:
 *   1. ARENA  — every heir strides into the ring, facing center (VS).
 *   2. FORGE  — each fighter's Power assembles from their played cards, with
 *               modifiers firing as combat hits (×2 surges, −3 saps, coin +4).
 *   3. CLASH  — all charge the center; one collision resolves the field.
 *   4. PODIUM — the three who earned Prestige ascend; the champion is crowned
 *               (rays + laurels + synthesised fanfare). The rest remain as the
 *               defeated court.
 *
 * playMeleeCinematic(host, results, actNum, opts) → Promise (resolves on continue)
 *   results : [{ playerIndex, name, power, placement, prestige }]  (power-desc)
 *   opts    : { speed, portraitFor(pi)→url, powerIcon, sound,
 *               breakdownFor(pi)→{ base, baseCards, steps:[{kind,label,amount}] } }
 *
 * Self-contained (no ui.js deps) so tools/melee-preview.html can drive it.
 * The Forge meters LOCK to results.power (authoritative) — breakdown steps only
 * pace the fill and add flourish, so a rare drift never shows a wrong total.
 */
(function () {
  'use strict';

  const ACTS = ['I', 'II', 'III'];
  const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
  const POS = ['p-center', 'p-left', 'p-right'];

  // ── Heraldry ──────────────────────────────────────────────────────────
  const CROWN_SVG = `
    <svg class="ms-crown" viewBox="0 0 120 92" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="mcG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff4d2"/><stop offset="0.45" stop-color="#e8d48b"/>
        <stop offset="0.75" stop-color="#c9a84c"/><stop offset="1" stop-color="#8b6914"/>
      </linearGradient></defs>
      <path d="M8 76 L14 30 L40 58 L60 16 L80 58 L106 30 L112 76 Z" fill="url(#mcG)" stroke="#6b4a1e" stroke-width="2" stroke-linejoin="round"/>
      <rect x="8" y="72" width="104" height="16" rx="4" fill="url(#mcG)" stroke="#6b4a1e" stroke-width="2"/>
      <circle cx="60" cy="14" r="7" fill="#ffe9ad" stroke="#8b1a1a" stroke-width="1.5"/>
      <circle cx="14" cy="30" r="5" fill="#ffe9ad"/><circle cx="106" cy="30" r="5" fill="#ffe9ad"/>
      <circle cx="34" cy="80" r="3.5" fill="#8b1a1a"/><circle cx="60" cy="80" r="3.5" fill="#1e3a5f"/><circle cx="86" cy="80" r="3.5" fill="#8b1a1a"/>
    </svg>`;
  const laurel = (side) => `
    <svg class="ms-laurel ${side}" viewBox="0 0 40 90" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M30 88 C10 70 6 44 16 8" fill="none" stroke="#c9a84c" stroke-width="3" stroke-linecap="round"/>
      <g fill="#c9a84c">
        <ellipse cx="14" cy="20" rx="9" ry="4.5" transform="rotate(-42 14 20)"/>
        <ellipse cx="11" cy="36" rx="10" ry="5" transform="rotate(-30 11 36)"/>
        <ellipse cx="12" cy="53" rx="10" ry="5" transform="rotate(-14 12 53)"/>
        <ellipse cx="17" cy="69" rx="9" ry="4.5" transform="rotate(2 17 69)"/>
        <ellipse cx="24" cy="82" rx="7" ry="4" transform="rotate(20 24 82)"/>
      </g>
    </svg>`;

  // ── Synthesised coronation fanfare (Web Audio — no asset, offline) ─────
  let _actx = null;
  function audioCtx() {
    if (_actx) { if (_actx.state === 'suspended') _actx.resume().catch(() => {}); return _actx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { _actx = new AC(); } catch (e) { return null; }
    if (_actx.state === 'suspended') _actx.resume().catch(() => {});
    return _actx;
  }
  function playFanfare() {
    const ctx = audioCtx();
    if (!ctx) return;
    const now = ctx.currentTime + 0.03;
    const comp = ctx.createDynamicsCompressor();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp); comp.connect(ctx.destination);
    const note = (freq, start, dur, peak, detune) => {
      const t = now + start;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = freq;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = freq; o2.detune.value = detune || -7;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(7000, freq * 6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.025);
      g.gain.exponentialRampToValueAtTime(peak * 0.7, t + dur * 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master);
      o1.start(t); o2.start(t); o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
    };
    const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;
    const C4 = 261.63, E4 = 329.63, G4 = 392.00, C3 = 130.81;
    note(C5, 0.00, 0.13, 0.42); note(E5, 0.13, 0.13, 0.42); note(G5, 0.26, 0.15, 0.46);
    [C4, E4, G4, C5, E5, G5, C6].forEach(f => note(f, 0.42, 1.5, 0.12));
    note(C3, 0.42, 1.6, 0.34);
  }
  // Short metallic tick for a Forge combat hit.
  function playHit(kind) {
    const ctx = audioCtx();
    if (!ctx) return;
    const now = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = kind === 'debuff' ? 'triangle' : 'square';
    const f = kind === 'mult' ? 880 : kind === 'debuff' ? 180 : 620;
    o.frequency.setValueAtTime(f, now);
    o.frequency.exponentialRampToValueAtTime(f * (kind === 'debuff' ? 0.6 : 1.6), now + 0.12);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    o.connect(g); g.connect(ctx.destination);
    o.start(now); o.stop(now + 0.2);
  }

  function playMeleeCinematic(host, results, actNum, opts) {
    // Cancel any prior run still animating on this host — otherwise its timers
    // (auto-close wiping the DOM, scheduled hit/fanfare sounds) keep firing and
    // clobber the fresh run. This is what let a speed change blank the cards
    // while the old run's noises played on.
    if (host && host._meleeCancel) { try { host._meleeCancel(); } catch (e) {} }
    return new Promise((resolve) => {
      opts = opts || {};
      const speed = opts.speed || 1;
      const portraitFor = opts.portraitFor || (() => 'assets/ui/cover.jpg');
      const powerIcon = opts.powerIcon || 'assets/icons/power.png';
      const breakdownFor = opts.breakdownFor || null;
      const fallback = 'assets/ui/cover.jpg';
      const soundOn = opts.sound !== false;
      const maxPower = Math.max(1, ...results.map(r => r.power || 0));

      // ── Podium grouping (ties share a tier) ─────────────────────────
      const tiers = [];
      results.forEach(r => {
        let t = tiers.find(x => x.placement === r.placement);
        if (!t) { t = { placement: r.placement, prestige: r.prestige || 0, members: [] }; tiers.push(t); }
        t.members.push(r);
      });
      const podium = tiers.slice(0, 3);
      const alsoRans = [];
      tiers.slice(3).forEach(t => t.members.forEach(m => alsoRans.push(m)));

      // Arena combatants in seating order (so the Forge, not the layout,
      // reveals who is strongest).
      const combatants = results.slice().sort((a, b) => a.playerIndex - b.playerIndex);

      // ── Markup ──────────────────────────────────────────────────────
      const img = (pi, cls, name) =>
        `<img class="${cls}" src="${portraitFor(pi)}" alt="${name}" onerror="this.onerror=null;this.src='${fallback}'">`;

      const combatantHTML = (c) => `
        <div class="ms-combatant" data-pi="${c.playerIndex}" data-power="${c.power || 0}">
          <div class="ms-cb-callout"></div>
          <div class="ms-cb-portrait-wrap">${img(c.playerIndex, 'ms-cb-portrait', c.name)}</div>
          <div class="ms-cb-name">${c.name}</div>
          <div class="ms-cb-power"><img src="${powerIcon}" alt="Power"><b>0</b></div>
          <div class="ms-cb-meter"><div class="ms-cb-fill"></div></div>
        </div>`;

      const fighterHTML = (r, champ) => `
        <div class="ms-fighter" data-power="${r.power || 0}">
          <div class="ms-portrait-wrap">
            ${champ ? '<div class="ms-rays"></div>' + CROWN_SVG + laurel('left') + laurel('right') : ''}
            ${img(r.playerIndex, 'ms-portrait', r.name)}
          </div>
          <div class="ms-name">${r.name}</div>
          ${champ ? '<div class="ms-champ-label">✦ Champion ✦</div>' : ''}
          <div class="ms-power"><img src="${powerIcon}" alt="Power"><b>0</b></div>
          <div class="ms-bar"><div class="ms-bar-fill"></div></div>
        </div>`;

      const tierHTML = (t, podiumIdx) => {
        const champ = podiumIdx === 0;
        return `<div class="ms-tier ${POS[podiumIdx]}${champ ? ' champ' : ''}">
          <div class="ms-fighters">${t.members.map(m => fighterHTML(m, champ)).join('')}</div>
          ${t.prestige ? `<div class="ms-prestige">+${t.prestige} Prestige</div>` : `<div class="ms-prestige" style="visibility:hidden">·</div>`}
          <div class="ms-plinth"><span class="ms-numeral">${t.placement}</span></div>
        </div>`;
      };

      const visual = [];
      if (podium[1]) visual.push(tierHTML(podium[1], 1));
      if (podium[0]) visual.push(tierHTML(podium[0], 0));
      if (podium[2]) visual.push(tierHTML(podium[2], 2));

      const alsoHTML = alsoRans.length ? `
        <div class="ms-alsoran">
          ${alsoRans.map(r => `
            <div class="ms-ar">
              ${img(r.playerIndex, '', r.name)}
              <div class="ms-ar-place">${ORD[r.placement - 1] || r.placement + 'th'}</div>
              <div class="ms-ar-name">${r.name}</div>
              <div class="ms-ar-power"><img src="${powerIcon}" alt=""><b>${r.power || 0}</b></div>
            </div>`).join('')}
        </div>` : '';

      const embers = Array.from({ length: 16 }, () => {
        const left = Math.round(Math.random() * 100);
        const dur = (3 + Math.random() * 3.4).toFixed(2);
        const delay = (Math.random() * 4).toFixed(2);
        const drift = Math.round((Math.random() - 0.5) * 60);
        const size = (3 + Math.random() * 3).toFixed(1);
        return `<span class="ms-ember" style="left:${left}%;width:${size}px;height:${size}px;
                --drift:${drift}px;animation-duration:${dur}s;animation-delay:${delay}s"></span>`;
      }).join('');

      host.innerHTML = `
        <div class="ms-stage">
          <div class="ms-embers">${embers}</div>
          <div class="ms-shockwave"></div>
          <div class="ms-title">
            <div class="ms-title-main"><span class="ms-sword">⚔</span>Melee<span class="ms-sword">⚔</span></div>
            <div class="ms-title-act">Act ${ACTS[actNum - 1] || actNum}</div>
          </div>
          <div class="ms-arena">${combatants.map(combatantHTML).join('')}</div>
          <div class="ms-podium">${visual.join('')}</div>
          ${alsoHTML}
          <div class="ms-flash"></div>
          <div class="ms-hint">Tap to continue</div>
        </div>`;
      host.classList.add('active');

      const stage = host.querySelector('.ms-stage');
      const titleEl = host.querySelector('.ms-title');
      const arenaEl = host.querySelector('.ms-arena');
      const alsoEl = host.querySelector('.ms-alsoran');
      const flashEl = host.querySelector('.ms-flash');
      const hintEl = host.querySelector('.ms-hint');
      const combatantEls = Array.from(host.querySelectorAll('.ms-combatant'));
      const domTiers = Array.from(host.querySelectorAll('.ms-tier'));
      const tierEls = [];
      podium.forEach((t, idx) => { tierEls[idx] = domTiers.find(el => el.classList.contains(POS[idx])); });

      // ── Run state ───────────────────────────────────────────────────
      const timers = [];
      const run = { killed: false };
      let state = 'playing';
      const after = (ms, fn) => timers.push(setTimeout(() => { if (!run.killed) fn(); }, ms * speed));

      // Let a later run (e.g. a speed re-trigger) stop this one cleanly:
      // kill its guard, clear its pending timers, and settle its promise.
      host._meleeCancel = () => {
        run.killed = true;
        timers.forEach(clearTimeout); timers.length = 0;
        resolve();
      };

      const tickNumber = (b, target, dur) => {
        if (!b) return;
        const startVal = parseInt(b.textContent, 10) || 0;
        const start = Date.now();
        const step = () => {
          if (run.killed) { b.textContent = target; return; }
          const k = Math.min(1, (Date.now() - start) / dur);
          b.textContent = Math.round(startVal + (target - startVal) * (1 - Math.pow(1 - k, 3)));
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        timers.push(setTimeout(() => { if (!run.killed) b.textContent = target; }, dur + 60));
      };

      const sparkBurst = (el, n, up) => {
        const rect = el.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        const cx = rect.left - hostRect.left + rect.width / 2;
        const cy = rect.top - hostRect.top + rect.height * (up == null ? 0.35 : up);
        for (let i = 0; i < n; i++) {
          const s = document.createElement('span');
          s.className = 'ms-spark';
          const ang = Math.random() * Math.PI * 2;
          const dist = 40 + Math.random() * 80;
          s.style.left = cx + 'px'; s.style.top = cy + 'px';
          s.style.setProperty('--sx', Math.cos(ang) * dist + 'px');
          s.style.setProperty('--sy', (Math.sin(ang) * dist - 24) + 'px');
          stage.appendChild(s);
          void s.offsetWidth;
          s.classList.add('go');
          setTimeout(() => s.remove(), 700 * speed);
        }
      };

      // ── FORGE: assemble one fighter's Power, return its end time ─────
      const showCallout = (hostEl, step) => {
        const badge = document.createElement('div');
        badge.className = 'ms-callout ' + step.kind;
        const big = step.kind === 'mult' ? '×' + step.amount
                  : (step.amount > 0 ? '+' + step.amount : '' + step.amount);
        badge.innerHTML = `<b>${big}</b><span>${step.label || ''}</span>`;
        hostEl.appendChild(badge);
        void badge.offsetWidth;            // paint the from-state, then animate
        badge.classList.add('go');
        setTimeout(() => badge.remove(), 1150 * speed);
      };

      const scheduleForge = (el, c, start) => {
        const fill = el.querySelector('.ms-cb-fill');
        const b = el.querySelector('.ms-cb-power b');
        const calloutHost = el.querySelector('.ms-cb-callout');
        const bd = (breakdownFor && breakdownFor(c.playerIndex)) || { base: c.power || 0, steps: [] };
        const setFill = (v) => { if (fill) fill.style.width = Math.round(Math.max(0, v) / maxPower * 100) + '%'; };
        let running = bd.base || 0;
        let t = start;

        after(t, () => { el.classList.add('forging'); setFill(bd.base || 0); tickNumber(b, bd.base || 0, 360); });
        t += 470;

        (bd.steps || []).forEach(step => {
          after(t, () => {
            showCallout(calloutHost, step);
            if (soundOn) playHit(step.kind);
            running = step.kind === 'mult' ? running * step.amount : running + step.amount;
            running = Math.max(0, running);
            setFill(running);
            tickNumber(b, running, 300);
            el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
            if (step.kind === 'mult') sparkBurst(el, 8, 0.3);
          });
          t += 400;
        });

        // Lock to the authoritative total.
        after(t, () => {
          setFill(c.power || 0);
          if (b) b.textContent = c.power || 0;
          el.classList.add('locked'); el.classList.remove('forging');
        });
        return t + 140;
      };

      // ── CLASH: everyone converges on the center ─────────────────────
      const doClash = () => {
        const arect = arenaEl.getBoundingClientRect();
        const cx = arect.left + arect.width / 2;
        combatantEls.forEach(el => {
          const r = el.getBoundingClientRect();
          const dx = cx - (r.left + r.width / 2);
          el.style.setProperty('--chx', (dx * 0.6) + 'px');
          el.classList.add('charge');
        });
        flashEl.classList.add('go');
        stage.classList.add('shake');
        setTimeout(() => stage.classList.remove('shake'), 460 * speed);
        sparkBurst(arenaEl, 26, 0.5);
      };

      // ── PODIUM ──────────────────────────────────────────────────────
      const fillTier = (el, instant) => {
        el.querySelectorAll('.ms-fighter').forEach(f => {
          const pw = +f.dataset.power;
          const fill = f.querySelector('.ms-bar-fill');
          const b = f.querySelector('.ms-power b');
          if (fill) fill.style.width = Math.round((pw / maxPower) * 100) + '%';
          if (instant) { if (b) b.textContent = pw; } else { tickNumber(b, pw, 720); }
        });
      };
      const revealTier = (idx, champ) => {
        const el = tierEls[idx];
        if (!el) return;
        el.classList.add('show');
        if (champ) {
          el.classList.add('lit');
          flashEl.classList.add('go');
          stage.classList.add('shake');
          setTimeout(() => stage.classList.remove('shake'), 450 * speed);
          if (soundOn) playFanfare();
        }
        fillTier(el, false);
        sparkBurst(el, champ ? 22 : 6);
      };
      const showResults = () => {
        arenaEl.classList.add('gone');
        if (alsoEl) alsoEl.classList.add('show');
      };

      const markRevealed = () => {
        if (state !== 'playing') return;
        state = 'revealed';
        hintEl.classList.add('show');
      };
      const finalize = () => {                 // tap-to-skip → jump to result
        run.killed = true;
        timers.forEach(clearTimeout); timers.length = 0;
        titleEl.classList.add('perched');
        arenaEl.classList.add('gone');
        if (alsoEl) alsoEl.classList.add('show');
        podium.forEach((t, idx) => {
          const el = tierEls[idx];
          if (!el) return;
          el.classList.add('show');
          if (idx === 0) el.classList.add('lit');
          fillTier(el, true);
        });
        hintEl.classList.add('show');
        state = 'revealed';
      };
      const close = () => {
        if (state === 'closed') return;
        state = 'closed'; run.killed = true;
        timers.forEach(clearTimeout);
        if (host._meleeCancel) host._meleeCancel = null;   // this run is done
        host.classList.remove('active'); host.onclick = null;
        setTimeout(() => { host.innerHTML = ''; resolve(); }, 320 * speed);
      };
      host.onclick = () => {
        if (state === 'playing') finalize();
        else if (state === 'revealed') close();
      };

      // ── Timeline ────────────────────────────────────────────────────
      after(950, () => titleEl.classList.add('perched'));

      // Arena roll-call
      const rollStart = 1080;
      combatantEls.forEach((el, i) => after(rollStart + i * 140, () => el.classList.add('in')));

      // Forge (staggered per fighter)
      const forgeStart = rollStart + combatants.length * 140 + 320;
      let forgeEnd = forgeStart;
      combatantEls.forEach((el, i) => {
        const c = combatants[i];
        forgeEnd = Math.max(forgeEnd, scheduleForge(el, c, forgeStart + i * 300));
      });

      // Clash → resolve
      const clashAt = forgeEnd + 240;
      after(clashAt, doClash);

      // Podium coronation (rises out of the settling dust)
      const podiumStart = clashAt + 540;
      after(podiumStart, showResults);
      after(podiumStart + 260, () => revealTier(2, false));
      after(podiumStart + 1060, () => revealTier(1, false));
      after(podiumStart + 1880, () => revealTier(0, true));
      after(podiumStart + 2780, markRevealed);
      after(podiumStart + 2780 + 3200, () => { if (state !== 'closed') close(); });
    });
  }

  window.playMeleeCinematic = playMeleeCinematic;
})();
