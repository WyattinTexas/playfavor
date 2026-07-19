/**
 * FAVOR — Melee battle & coronation cinematic.
 *
 * Player-paced battle in four acts:
 *   1. ARENA  — every heir strides into the ring (VS roll-call).
 *   2. FORGE  — one fighter at a time under the spotlight: their power
 *               contributors (cards AND missions) deal into a persistent row
 *               at the bottom of the stage, the meter climbing by each card's
 *               exact amount as it lands. Modifiers fire as combat hits (live
 *               coin toss, ×2 surges, cross-fighter saps). The row STAYS on
 *               screen until dismissed (Continue button / tap), then the
 *               stage moves to the next fighter.
 *   3. CLASH  — all charge the center; one collision resolves the field.
 *   4. PODIUM — the three who earned Prestige ascend; placements pay in
 *               PRESTIGE TOKENS (the physical game's token art), the champion
 *               is crowned (rays + laurels). Losers remain as the
 *               defeated court. A "Skip ▸▸" chip jumps to the result at any
 *               time; tap on the result continues.
 *
 * playMeleeCinematic(host, results, actNum, opts) → Promise (resolves on continue)
 *   results : [{ playerIndex, name, power, placement, prestige }]  (power-desc)
 *   opts    : { speed, portraitFor(pi), powerIcon, sapFx, cardsFx,
 *               herald, autoCloseMs, breakdownFor(pi), cardImgFor(filename,
 *               mission)→url, prestigeTokenFor(denom)→url }
 *
 * Self-contained (no ui.js deps) so tools/melee-preview.html can drive it.
 * The meters LOCK to results.power (authoritative) — breakdowns only pace
 * the reveal, so a drifting step can never show a wrong total.
 */
(function () {
  'use strict';

  const ACTS = ['I', 'II', 'III'];
  const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
  const POS = ['p-center', 'p-left', 'p-right'];

  // Physical prestige token denominations, largest first.
  const TOKEN_DENOMS = [25, 10, 5, 1];
  const tokenSplit = (n) => {
    const out = [];
    TOKEN_DENOMS.forEach(d => { while (n >= d) { out.push(d); n -= d; } });
    return out;
  };

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

  function playMeleeCinematic(host, results, actNum, opts) {
    // Cancel any prior run still animating on this host — its timers would
    // clobber the fresh run (auto-close wiping DOM).
    if (host && host._meleeCancel) { try { host._meleeCancel(); } catch (e) {} }
    return new Promise((resolve) => {
      opts = opts || {};
      const speed = opts.speed || 1;
      const portraitFor = opts.portraitFor || (() => 'assets/ui/cover.jpg');
      const powerIcon = opts.powerIcon || 'assets/icons/power.png';
      const breakdownFor = opts.breakdownFor || null;
      const cardImgFor = opts.cardImgFor || (() => null);
      const prestigeTokenFor = opts.prestigeTokenFor || null;
      const fallback = 'assets/ui/cover.jpg';
      const sapFx = opts.sapFx !== false;
      const cardsFx = opts.cardsFx !== false;
      const heraldOn = opts.herald !== false;
      const autoCloseMs = (opts.autoCloseMs == null) ? 9000 : opts.autoCloseMs;
      // Once the champion is crowned the picture HOLDS — a stray tap-through
      // used to dismiss the coronation ~1.5s after the crown landed (Wyatt
      // 7/18: "hold the final melee phase picture another two seconds").
      // Taps are ignored and the continue hint stays hidden until this
      // window passes; autoClose still counts from the reveal as before.
      const revealHoldMs = ((opts.revealHoldMs == null) ? 2000 : opts.revealHoldMs) * speed;
      // Per-fighter forge hold: the whole melee should auto-play at a calm
      // pace, never waiting for a tap at each fighter (Wyatt 7/17). The
      // Continue button still lets an eager player skip ahead.
      const forgeHoldMs = (opts.forgeHoldMs == null) ? 15000 : opts.forgeHoldMs;
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

      // Arena combatants in seating order (the Forge, not the layout,
      // reveals who is strongest).
      const combatants = results.slice().sort((a, b) => a.playerIndex - b.playerIndex);

      // Breakdowns fetched up-front: the ring overlay needs each player's
      // slider slot at build time, and attacks need every fighter's numbers.
      const bdOf = {};
      combatants.forEach(c => {
        bdOf[c.playerIndex] = (breakdownFor && breakdownFor(c.playerIndex))
          || { base: c.power || 0, baseOther: c.power || 0, baseCards: [], steps: [], ownRawTotal: c.power || 0, rawTotal: c.power || 0 };
      });

      // The slider ring, on the game's own board track (BOARD_OV_TRACK).
      const RING_LEFTS = [17, 33.4, 50, 66.3, 82.9];
      const RING_TOP = 84.7;
      const ringSrc = opts.ringSrc || 'assets/ui/slider-ring.png';
      const ringHTML = (slot) => (slot == null || !RING_LEFTS[slot]) ? '' :
        `<img class="ms-ring" src="${ringSrc}" alt=""
              style="left:${RING_LEFTS[slot]}%; top:${RING_TOP}%">`;

      // ── Markup ──────────────────────────────────────────────────────
      const img = (pi, cls, name) =>
        `<img class="${cls}" src="${portraitFor(pi)}" alt="${name}" onerror="this.onerror=null;this.src='${fallback}'">`;

      // Full character board (never cropped) with the slider ring on the
      // player's current skill slot — you can SEE why the board pays power.
      const combatantHTML = (c) => `
        <div class="ms-combatant" data-pi="${c.playerIndex}" data-power="${c.power || 0}">
          <div class="ms-cb-callout"></div>
          <div class="ms-cb-portrait-wrap">
            ${img(c.playerIndex, 'ms-cb-portrait', c.name)}
            ${ringHTML(bdOf[c.playerIndex] && bdOf[c.playerIndex].sliderPosition)}
          </div>
          <div class="ms-cb-name">${c.name}</div>
          <div class="ms-cb-power"><img src="${powerIcon}" alt="Power"><b>0</b></div>
        </div>`;

      // Prestige paid in the physical game's tokens (greedy 25/10/5/1);
      // text pill fallback if no token art is wired.
      const prestigeHTML = (amount) => {
        if (!amount) return `<div class="ms-prestige" style="visibility:hidden">·</div>`;
        if (prestigeTokenFor) {
          const toks = tokenSplit(amount)
            .map(d => `<img class="ms-ptoken" src="${prestigeTokenFor(d)}" alt="${d} Prestige">`)
            .join('');
          return `<div class="ms-prestige tokens"><span class="ms-ptoken-plus">+</span>${toks}</div>`;
        }
        return `<div class="ms-prestige">+${amount} Prestige</div>`;
      };

      const fighterHTML = (r, champ) => `
        <div class="ms-fighter" data-power="${r.power || 0}">
          <div class="ms-portrait-wrap">
            ${champ ? '<div class="ms-rays"></div>' + CROWN_SVG + laurel('left') + laurel('right') : ''}
            ${img(r.playerIndex, 'ms-portrait', r.name)}
            ${ringHTML(bdOf[r.playerIndex] && bdOf[r.playerIndex].sliderPosition)}
          </div>
          <div class="ms-name">${r.name}</div>
          ${champ ? '<div class="ms-champ-label">✦ Champion ✦</div>' : ''}
          <div class="ms-power"><img src="${powerIcon}" alt="Power"><b>0</b></div>
        </div>`;

      const tierHTML = (t, podiumIdx) => {
        const champ = podiumIdx === 0;
        return `<div class="ms-tier ${POS[podiumIdx]}${champ ? ' champ' : ''}${t.members.length > 1 ? ' multi' : ''}">
          <div class="ms-fighters">${t.members.map(m => fighterHTML(m, champ)).join('')}</div>
          ${prestigeHTML(t.prestige)}
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
              <div class="ms-ar-wrap">
                ${img(r.playerIndex, '', r.name)}
                ${ringHTML(bdOf[r.playerIndex] && bdOf[r.playerIndex].sliderPosition)}
              </div>
              <div class="ms-ar-place">${ORD[r.placement - 1] || r.placement + 'th'}</div>
              <div class="ms-ar-name">${r.name}</div>
              <div class="ms-ar-power"><img src="${powerIcon}" alt=""><b>${r.power || 0}</b></div>
            </div>`).join('')}
        </div>` : '';

      const embers = Array.from({ length: 16 }, () => {
        const left = Math.round(Math.random() * 100);
        const dur = (3 + Math.random() * 3.4).toFixed(2);
        const del = (Math.random() * 4).toFixed(2);
        const drift = Math.round((Math.random() - 0.5) * 60);
        const size = (3 + Math.random() * 3).toFixed(1);
        return `<span class="ms-ember" style="left:${left}%;width:${size}px;height:${size}px;
                --drift:${drift}px;animation-duration:${dur}s;animation-delay:${del}s"></span>`;
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
          <div class="ms-cardrow"></div>
          <div class="ms-herald"></div>
          <div class="ms-skip">Skip ▸▸</div>
          <div class="ms-flash"></div>
          <div class="ms-hint">Tap to continue</div>
        </div>`;
      host.classList.add('active');

      const stage = host.querySelector('.ms-stage');
      const titleEl = host.querySelector('.ms-title');
      const arenaEl = host.querySelector('.ms-arena');
      const alsoEl = host.querySelector('.ms-alsoran');
      const rowEl = host.querySelector('.ms-cardrow');
      const skipEl = host.querySelector('.ms-skip');
      const flashEl = host.querySelector('.ms-flash');
      const hintEl = host.querySelector('.ms-hint');
      const heraldEl = host.querySelector('.ms-herald');
      const combatantEls = Array.from(host.querySelectorAll('.ms-combatant'));
      const domTiers = Array.from(host.querySelectorAll('.ms-tier'));
      const tierEls = [];
      podium.forEach((t, idx) => { tierEls[idx] = domTiers.find(el => el.classList.contains(POS[idx])); });

      // ── Run state ───────────────────────────────────────────────────
      const timers = [];
      const run = { killed: false };
      let state = 'playing';
      let revealedAt = 0;      // when the final result finished revealing
      let advanceTap = null;   // pending "Continue" resolver during the forge

      host._meleeCancel = () => {
        run.killed = true;
        timers.forEach(clearTimeout); timers.length = 0;
        resolve();
      };

      // ── Pacing: taps hurry the show, they never skip it ──────────────
      // Wyatt 7/19: "tapping anywhere on screen during melee advances /
      // expedites the phase", and "expedite should be SLIGHT — it speeds the
      // reveal along, it does not skip the whole phase. Keep the beats
      // readable."
      //
      // A speed multiplier alone can't deliver that: it only touches timers
      // that haven't started, so a tap two frames into a 2s coin-read would
      // do nothing visible for two seconds — responsive-feeling input is the
      // whole request. So expedite() cuts the IN-FLIGHT timeout short and
      // nudges `rate` for the beats after it.
      //
      // Every cut is FLOORED. melee.css keyframes are hardcoded (it reads no
      // --cinematic-speed), so a beat allowed to finish before its own
      // animation lands the verdict over a still-spinning coin. The floor is
      // the second argument to delay(), matched to the CSS duration.
      let rate = 1;
      let pending = null;
      const delay = (ms, floorMs = 0) => new Promise(res => {
        const total = ms * speed * rate;
        const startedAt = Date.now();
        const fire = () => { if (pending && pending.fire === fire) pending = null; res(); };
        const id = setTimeout(fire, total);
        timers.push(id);
        // floorMs is NOT scaled by speed: the CSS keyframe it protects is a
        // fixed duration (melee.css reads no --cinematic-speed). At a reduced
        // speed a beat can already be shorter than its own animation, and the
        // endsAt guard below then makes expedite a no-op on that beat rather
        // than stretching it past where it would have ended anyway.
        pending = { fire, id, startedAt, endsAt: startedAt + total, floorMs };
      });
      const expedite = () => {
        rate = Math.max(0.55, rate * 0.8);      // later beats, a little quicker
        if (!pending) return;
        const p = pending, now = Date.now();
        const remain = p.endsAt - now;
        if (remain <= 130) return;               // already landing
        // Never below the beat's own animation, and never an instant jump —
        // a beat that vanishes reads as a glitch, not a fast-forward.
        const target = Math.max(p.startedAt + p.floorMs, now + Math.max(120, remain * 0.35));
        if (target >= p.endsAt) return;
        clearTimeout(p.id);
        p.endsAt = target;
        p.id = setTimeout(p.fire, target - now);
        timers.push(p.id);
      };
      const waitContinue = (fallbackMs) => new Promise(res => {
        const done = () => { if (advanceTap === done) advanceTap = null; res(); };
        advanceTap = done;
        timers.push(setTimeout(done, fallbackMs * speed));   // never stall unattended
      });

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

      const sparkBurst = (el, n, up, cls) => {
        const rect = el.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        const cx = rect.left - hostRect.left + rect.width / 2;
        const cy = rect.top - hostRect.top + rect.height * (up == null ? 0.35 : up);
        for (let i = 0; i < n; i++) {
          const s = document.createElement('span');
          s.className = 'ms-spark' + (cls ? ' ' + cls : '');
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

      // ── Live score display: every fighter's number = own forge progress
      // plus WOUNDS from attacks (may be negative mid-battle; the final
      // tally floors at 0). Attacks can strike fighters before or after
      // their own turn — refresh handles both. ─────────────────────────
      const dispBase = {}, wound = {};
      combatants.forEach(c => { dispBase[c.playerIndex] = 0; wound[c.playerIndex] = 0; });
      const combatantOf = (pi) => combatantEls.find(e => +e.dataset.pi === pi);

      // Power tiers — RARITY COLORS, all the same size (Wyatt's spec):
      // ≤5 gray · 6-10 green · 11-15 blue · 16-20 purple · 21+ orange.
      // Purple and orange carry a little sparkle.
      const TIER_CLASSES = ['pw-gray', 'pw-green', 'pw-blue', 'pw-purple', 'pw-orange'];
      const tierFor = (v) =>
        v >= 21 ? 'pw-orange' : v >= 16 ? 'pw-purple' :
        v >= 11 ? 'pw-blue' : v >= 6 ? 'pw-green' : 'pw-gray';
      const applyTier = (pwEl, value, celebrate) => {
        if (!pwEl) return;
        const cls = tierFor(Math.max(0, value));   // tier reads the tally floor
        TIER_CLASSES.forEach(t => pwEl.classList.remove(t));
        pwEl.classList.add(cls);
        if (!celebrate) return;
        const fighter = pwEl.closest('.ms-combatant, .ms-fighter');
        if (cls === 'pw-orange') {
          stage.classList.add('shake');
          setTimeout(() => stage.classList.remove('shake'), 500 * speed);
          sparkBurst(pwEl, 14, 0.5, 'orange');
        } else if (cls === 'pw-purple') {
          if (fighter) {
            fighter.classList.remove('pw-rumbling'); void fighter.offsetWidth;
            fighter.classList.add('pw-rumbling');
          }
          sparkBurst(pwEl, 8, 0.5, 'purple');
        }
      };

      const refreshCount = (pi, dur, celebrate) => {
        const el = combatantOf(pi);
        if (!el) return;
        const pw = el.querySelector('.ms-cb-power');
        const b = pw && pw.querySelector('b');
        if (!b) return;
        const val = dispBase[pi] + wound[pi];
        tickNumber(b, val, dur || 340);
        pw.classList.toggle('neg', val < 0);
        // Locked fighters keep their tier honest if a later attack drops them.
        if (el.classList.contains('locked') || celebrate) applyTier(pw, val, celebrate);
      };

      // ── Herald / announcer ──────────────────────────────────────────
      const heraldSay = (text) => {
        if (!heraldOn || !heraldEl) return;
        heraldEl.classList.remove('show');
        void heraldEl.offsetWidth;
        heraldEl.textContent = text;
        heraldEl.classList.add('show');
      };
      const championLine = () => {
        const cn = (podium[0] && podium[0].members[0] && podium[0].members[0].name) || 'The champion';
        const verb = /^you$/i.test(cn) ? 'are' : 'is';
        return `${cn} ${verb} crowned champion of Act ${ACTS[actNum - 1] || actNum}!`;
      };

      // ── Combat FX ───────────────────────────────────────────────────
      const showCallout = (hostEl, step, textOverride) => {
        const badge = document.createElement('div');
        badge.className = 'ms-callout ' + step.kind;
        const big = textOverride != null ? textOverride
                  : step.kind === 'mult' ? '×' + step.amount
                  : (step.amount > 0 ? '+' + step.amount : '' + step.amount);
        badge.innerHTML = `<b>${big}</b><span>${step.label || ''}</span>`;
        hostEl.appendChild(badge);
        void badge.offsetWidth;
        badge.classList.add('go');
        setTimeout(() => badge.remove(), 1150 * speed);
      };

      const bump = (el) => { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); };

      const flipCoin = (hostEl, won) => {
        const coin = document.createElement('div');
        coin.className = 'ms-coin';
        coin.innerHTML = '<div class="ms-coin-face heads"></div><div class="ms-coin-face tails"></div>';
        hostEl.appendChild(coin);
        void coin.offsetWidth;
        coin.classList.add(won ? 'flip-heads' : 'flip-tails');
        // lands at ~1600ms, then HOLDS 2s so the result face can be read
        setTimeout(() => coin.remove(), 3900 * speed);
      };

      // The coin's verdict floats up from where it landed: power token +N on
      // heads, the token crossed out in red on tails.
      const coinResultFloat = (hostEl, won, amt) => {
        const fl = document.createElement('div');
        fl.className = 'ms-coinres';
        fl.innerHTML = won
          ? `<img src="${powerIcon}" alt=""><b>+${amt}</b>`
          : `<span class="ms-coinres-tok"><img src="${powerIcon}" alt=""><i>✕</i></span>`;
        hostEl.appendChild(fl);
        void fl.offsetWidth;
        fl.classList.add('go');
        setTimeout(() => fl.remove(), 2400 * speed);
      };

      // A red bolt from one fighter to another (Fuzzy Head's strike).
      // extraCls 'thick' = the heavy, SLOW bolts fired from a featured card.
      // labelHTML (e.g. power token + −3) rides the middle of the beam.
      const streakBetween = (fromEl, toEl, extraCls, labelHTML) => {
        if (!fromEl || !toEl || fromEl === toEl) return;
        const h = stage.getBoundingClientRect();
        const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
        const x1 = a.left - h.left + a.width / 2, y1 = a.top - h.top + a.height * 0.4;
        const x2 = b.left - h.left + b.width / 2, y2 = b.top - h.top + b.height * 0.4;
        const dx = x2 - x1, dy = y2 - y1;
        const life = (extraCls === 'thick' ? 1500 : 640) * speed;
        const streak = document.createElement('div');
        streak.className = 'ms-sap' + (extraCls ? ' ' + extraCls : '');
        streak.style.left = x1 + 'px'; streak.style.top = y1 + 'px';
        streak.style.width = Math.hypot(dx, dy) + 'px';
        streak.style.transform = 'rotate(' + (Math.atan2(dy, dx) * 180 / Math.PI) + 'deg)';
        stage.appendChild(streak);
        void streak.offsetWidth;
        streak.classList.add('go');
        setTimeout(() => streak.remove(), life);
        if (labelHTML) {
          const chip = document.createElement('div');
          chip.className = 'ms-sapamt';
          chip.innerHTML = labelHTML;
          chip.style.left = (x1 + dx / 2) + 'px';
          chip.style.top = (y1 + dy / 2) + 'px';
          stage.appendChild(chip);
          void chip.offsetWidth;
          chip.classList.add('go');
          setTimeout(() => chip.remove(), life + 200 * speed);
        }
      };

      // ── FEATURE: a card takes center stage over a darkened arena so
      // everyone can READ it before its effect fires (Fuzzy Head's strike,
      // Shot of Courage's coin). Returns the overlay element. ────────────
      const featureShow = (url, caption) => {
        const f = document.createElement('div');
        f.className = 'ms-feature';
        f.innerHTML =
          `<div class="ms-feature-veil"></div>
           <div class="ms-feature-inner">
             <img class="ms-feature-card" src="${url}" alt="">
             ${caption ? `<div class="ms-feature-cap">${caption}</div>` : ''}
             <div class="ms-feature-coinslot"></div>
           </div>`;
        stage.appendChild(f);
        void f.offsetWidth;
        f.classList.add('go');
        return f;
      };
      const featureHide = async (f) => {
        f.classList.remove('go'); f.classList.add('bye');
        await delay(380, 380);
        f.remove();
      };

      // ── FORGE: one fighter's full story, player-paced ────────────────
      const runFighter = async (i) => {
        const el = combatantEls[i], c = combatants[i];
        const pi = c.playerIndex;
        const calloutHost = el.querySelector('.ms-cb-callout');
        const bd = bdOf[pi];

        // Only actual power contributors appear (cards AND missions, each
        // carrying its amount). Art-less contributors fold into the board
        // share so the number never lies. (Cap 8 — Act 3 hands run long and
        // the row scrolls.)
        const visCards = [];
        if (cardsFx) {
          (bd.baseCards || []).slice(0, 8).forEach(cd => {
            const url = (cd && cd.amount > 0) ? cardImgFor(cd.filename, cd.mission) : null;
            if (url) visCards.push({ url, amount: cd.amount, mission: !!cd.mission });
          });
        }
        const baseStart = Math.max(0, (bd.base || 0) - visCards.reduce((a, x) => a + x.amount, 0));

        el.classList.add('forging', 'active');   // the stage lights this fighter
        await delay(650); if (run.killed) return;

        // EVERY point (and every modifier) gets a face in the row. Badges
        // spell the arithmetic: gold +N, red −N, grey 0 (a lost coin), ×2.
        const dealRowItem = (url, badgeText, cls, caption, ringSlot) => {
          const item = document.createElement('div');
          item.className = 'ms-rowitem' + (cls ? ' ' + cls : '');
          item.innerHTML =
            `<img src="${url}" alt="">` +
            (ringSlot != null ? ringHTML(ringSlot) : '') +
            `<span class="ms-rowamt${/^[−-]/.test(badgeText) ? ' neg' : badgeText === '0' ? ' zero' : ''}">${badgeText}</span>` +
            (caption ? `<span class="ms-rowcap">${caption}</span>` : '');
          const im = item.querySelector('img');
          im.onerror = () => item.remove();
          rowEl.appendChild(item);
          void item.offsetWidth;
          item.classList.add('go');
        };

        // The board leads the row FULL and un-cropped, wearing the slider
        // ring on the player's current skill slot — the visible reason the
        // board pays power.
        if (cardsFx && baseStart > 0) {
          dealRowItem(portraitFor(pi), '+' + baseStart, 'board', 'Board', bd.sliderPosition);
          dispBase[pi] = baseStart;
          refreshCount(pi, 340);
          bump(el);
          await delay(950, 550); if (run.killed) return;
        } else {
          dispBase[pi] = baseStart;
          refreshCount(pi, 500);
          await delay(200); if (run.killed) return;
        }

        for (const vc of visCards) {
          dealRowItem(vc.url, '+' + vc.amount, vc.mission ? 'missioncard' : '');
          dispBase[pi] += vc.amount;
          refreshCount(pi, 340);
          bump(el);
          await delay(950, 550); if (run.killed) return;
        }

        // Modifiers land as combat hits — and their SOURCE CARD joins the
        // row too (a lost coin's card shows a grey 0).
        const stepArt = (step) => (cardsFx && step.filename) ? cardImgFor(step.filename, !!step.missionCard) : null;
        for (const step of (bd.steps || [])) {
          if (step.kind === 'coinflip') {
            // SHOT OF COURAGE: the card takes CENTER STAGE over a darkened
            // arena so everyone can read it, THEN the coin flips — and the
            // card drops back into the queue with the others.
            const cu = stepArt(step);
            let feat = null;
            if (cu) {
              feat = featureShow(cu, `${c.name} ${/^you$/i.test(c.name) ? 'play' : 'plays'} ${step.label}!`);
              await delay(2000, 500); if (run.killed) { feat.remove(); return; }
              flipCoin(feat.querySelector('.ms-feature-coinslot'), step.won);
            } else {
              flipCoin(calloutHost, step.won);
            }
            // coin lands at ~1600ms; the verdict floats from it and the landed
            // face HOLDS 2s so the result is actually readable before the card
            // leaves the stage. The float replaces the old +4/Tails callouts.
            const coinHost = feat ? feat.querySelector('.ms-feature-coinslot') : calloutHost;
            await delay(1650, 1600); if (run.killed) { if (feat) feat.remove(); return; }
            coinResultFloat(coinHost, step.won, step.amount);
            await delay(2000, 700); if (run.killed) { if (feat) feat.remove(); return; }
            if (feat) { await featureHide(feat); if (run.killed) return; }
            if (step.won) {
              dispBase[pi] += step.amount;
              refreshCount(pi, 380);
              if (cu) dealRowItem(cu, '+' + step.amount, 'mod');
              bump(el);
              sparkBurst(el, 6, 0.2);
            } else {
              if (cu) dealRowItem(cu, '0', 'mod');
            }
            await delay(700); if (run.killed) return;
            continue;
          }
          if (step.kind === 'attack') {
            // FUZZY HEAD: the card takes CENTER STAGE so everyone can read
            // it — then HEAVY red bolts fire from the card itself at EVERY
            // other fighter at once. Wounds can drive scores negative; the
            // final tally floors at 0. The card then joins the queue.
            const au = stepArt(step);
            const feat = au ? featureShow(au, `${step.label} — strikes all rivals!`) : null;
            if (feat) { await delay(2000, 500); if (run.killed) { feat.remove(); return; } }
            // ALL beams fire at once — same slow, readable sweep, each with
            // its −3 (power token + amount) riding the beam — then every
            // victim's score wounds together.
            const boltFrom = feat ? feat.querySelector('.ms-feature-card') : el;
            const targets = (step.hits || [])
              .map(h => ({ h, victimEl: combatantOf(h.playerIndex) }))
              .filter(t => t.victimEl);
            targets.forEach(({ h, victimEl }) => {
              const chip = `<img src="${powerIcon}" alt="Power">−${Math.abs(h.delta)}`;
              if (sapFx) streakBetween(boltFrom, victimEl, feat ? 'thick' : '', chip);
            });
            await delay(700); if (run.killed) { if (feat) feat.remove(); return; }
            targets.forEach(({ h, victimEl }) => {
              wound[h.playerIndex] += h.delta;
              refreshCount(h.playerIndex, 380);
              bump(victimEl);
              victimEl.classList.remove('struck'); void victimEl.offsetWidth;
              victimEl.classList.add('struck');
            });
            await delay(1100); if (run.killed) { if (feat) feat.remove(); return; }
            if (feat) { await featureHide(feat); if (run.killed) return; }
            if (au) dealRowItem(au, '' + step.amount, 'mod', 'vs all');
            showCallout(calloutHost, { kind: 'debuff', label: step.label, amount: step.amount });
            await delay(600); if (run.killed) return;
            continue;
          }
          const sapping = step.kind === 'debuff' && sapFx && step.from != null;
          if (sapping) {
            streakBetween(combatantOf(step.from), el);
            await delay(380); if (run.killed) return;
          }
          showCallout(calloutHost, step);
          if (step.kind === 'mult') dispBase[pi] *= step.amount;
          else dispBase[pi] += step.amount;
          refreshCount(pi, 380);
          const su = stepArt(step);
          if (su) {
            dealRowItem(su,
              step.kind === 'mult' ? '×' + step.amount
                : (step.amount > 0 ? '+' + step.amount : '−' + Math.abs(step.amount)),
              'mod');
          }
          bump(el);
          if (step.kind === 'mult') sparkBurst(el, 8, 0.3);
          await delay(700); if (run.killed) return;
        }

        // Lock to the fighter's own authoritative total (wounds ride on top —
        // the displayed score may be negative mid-battle) and CELEBRATE the
        // tally at its weight class on the material ladder (ash → radiant).
        dispBase[pi] = (bd.ownRawTotal != null) ? bd.ownRawTotal : (c.power || 0);
        el.classList.add('locked'); el.classList.remove('forging');
        refreshCount(pi, 420, true);
        const lockVal = dispBase[pi] + wound[pi];
        heraldSay(`${c.name}: ${lockVal} Power!`);
        await delay(500); if (run.killed) return;

        // The row STAYS until dismissed via the Continue button (only the
        // button advances — the row itself is scrollable on phones).
        // Generous fallback so an unattended melee never stalls.
        if (rowEl.children.length) {
          const btn = document.createElement('button');
          btn.className = 'ms-continue';
          btn.textContent = 'Continue ▸';
          btn.onclick = (e) => { e.stopPropagation(); if (advanceTap) advanceTap(); };
          stage.appendChild(btn);              // outside the scroll strip
          void btn.offsetWidth;
          btn.classList.add('show');
          await waitContinue(forgeHoldMs);
          btn.remove();
          if (run.killed) return;
          // Dismissed cards TUCK beside the fighter (mini overlapped strip),
          // so everyone's evidence stays "kind of visible" through the battle.
          const tuck = document.createElement('div');
          tuck.className = 'ms-tuck';
          Array.from(rowEl.querySelectorAll('.ms-rowitem')).forEach((item, k) => {
            const im = item.querySelector('img');
            if (!im) return;
            const t = document.createElement('img');
            t.className = 'ms-tuckcard' + (item.classList.contains('board') ? ' board' : '');
            t.src = im.src;
            t.style.transitionDelay = (k * 55) + 'ms';
            tuck.appendChild(t);
          });
          el.appendChild(tuck);
          void tuck.offsetWidth;
          // A big row must not invade the neighbors: if the fan is wider than
          // the fighter's column, tuck the cards closer (uniformly deeper
          // overlap), floored so every card still peeks ~5px.
          const tucked = Array.from(tuck.querySelectorAll('.ms-tuckcard'));
          if (tucked.length > 1) {
            // cap the fan at the fighter's own board width (and never closer
            // than 18px to the nearest neighbor's column) — adjacent fans need
            // REAL daylight or five 9-card fans read as one continuous strip.
            // MEASURE WITH offsetWidth/offsetLeft: the cards still wear their
            // entrance transform (scale 0.55) and the fighter its active raise
            // (scale 1.12) here — getBoundingClientRect returns those phantom
            // sizes and the tighten math silently computes garbage.
            let maxW = el.offsetWidth;
            const pitches = combatantEls
              .filter(s => s !== el)
              .map(s => Math.abs(s.offsetLeft - el.offsetLeft));
            if (pitches.length) maxW = Math.min(maxW, Math.min(...pitches) - 18);
            const fanW = tuck.offsetWidth;
            if (fanW > maxW) {
              const shrink = (fanW - maxW) / (tucked.length - 1);
              tucked.slice(1).forEach(t => {
                t.style.marginLeft = Math.max(-(t.offsetWidth - 5), -9 - shrink) + 'px';
              });
            }
          }
          tucked.forEach(t => t.classList.add('go'));
          rowEl.classList.add('out');
          await delay(300, 300); if (run.killed) return;
          rowEl.innerHTML = '';
          rowEl.classList.remove('out');
        } else {
          await delay(650); if (run.killed) return;
        }
        el.classList.remove('active');            // stage light moves on
      };

      // ── CLASH ───────────────────────────────────────────────────────
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
          const pw = +f.dataset.power;         // final tally — already floored at 0
          const b = f.querySelector('.ms-power b');
          const pwEl = f.querySelector('.ms-power');
          applyTier(pwEl, pw, !instant);       // the tally wears its weight class
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
          heraldSay(championLine());
        }
        fillTier(el, false);
        sparkBurst(el, champ ? 22 : 6);
      };
      // Center the 4th/5th column in the gutter between the 3rd plinth and
      // the screen edge (equal distance to both, per Wyatt) — measured at
      // runtime since the podium's width varies with players/ties.
      // A tie widens its tier (co-champions share one grown plinth) — if the
      // podium row then outgrows the stage, shrink the WHOLE row uniformly.
      // scrollWidth is layout width (transform-independent), so this is
      // idempotent; placeAlsoRans measures rects AFTER the scale, so the
      // 4th/5th column still centers in the true visual gutter.
      const fitPodium = () => {
        const pod = host.querySelector('.ms-podium');
        if (!pod) return;
        const reserve = alsoRans.length ? Math.min(150, stage.clientWidth * 0.17) : 14;
        const avail = stage.clientWidth - 2 * reserve;
        if (pod.scrollWidth > avail) {
          pod.style.transform = 'scale(' + (avail / pod.scrollWidth).toFixed(3) + ')';
          pod.style.transformOrigin = '50% 100%';
        }
      };
      const placeAlsoRans = () => {
        if (!alsoEl) return;
        const pod = host.querySelector('.ms-podium');
        if (!pod) return;
        const sr = stage.getBoundingClientRect();
        const pr = pod.getBoundingClientRect();
        const gutter = sr.right - pr.right;
        alsoEl.style.right = Math.max(6, (gutter - alsoEl.offsetWidth) / 2) + 'px';
      };
      const showResults = () => {
        arenaEl.classList.add('gone');
        fitPodium();
        if (alsoEl) { placeAlsoRans(); alsoEl.classList.add('show'); }
      };

      const markRevealed = () => {
        if (state !== 'playing') return;
        state = 'revealed';
        revealedAt = Date.now();
        skipEl.style.display = 'none';
        timers.push(setTimeout(() => hintEl.classList.add('show'), revealHoldMs));
      };
      const finalize = () => {                 // Skip ▸▸ → jump to the result
        run.killed = true;
        timers.forEach(clearTimeout); timers.length = 0;
        advanceTap = null;
        titleEl.classList.add('perched');
        arenaEl.classList.add('gone');
        arenaEl.classList.remove('spot');
        rowEl.innerHTML = '';
        stage.querySelectorAll('.ms-feature').forEach(x => x.remove());
        const pendingBtn = stage.querySelector('.ms-continue');
        if (pendingBtn) pendingBtn.remove();
        fitPodium();
        if (alsoEl) { placeAlsoRans(); alsoEl.classList.add('show'); }
        podium.forEach((t, idx) => {
          const el = tierEls[idx];
          if (!el) return;
          el.classList.add('show');
          if (idx === 0) el.classList.add('lit');
          fillTier(el, true);
        });
        heraldSay(championLine());
        skipEl.style.display = 'none';
        state = 'revealed';
        revealedAt = Date.now();
        timers.push(setTimeout(() => hintEl.classList.add('show'), revealHoldMs));
      };
      const close = () => {
        if (state === 'closed') return;
        state = 'closed'; run.killed = true;
        timers.forEach(clearTimeout);
        if (host._meleeCancel) host._meleeCancel = null;
        host.classList.remove('active');
        // All three, or the next act's melee inherits this run's swipe state.
        host.onclick = null; host.onpointerdown = null; host.onpointerup = null;
        setTimeout(() => { host.innerHTML = ''; resolve(); }, 320 * speed);
      };

      // Taps: anywhere on the stage, at ANY moment, does something.
      //
      // It used to only look like that. advanceTap is non-null solely inside
      // waitContinue() — i.e. exactly while the Continue button is on screen
      // — so every tap outside that window was a silent no-op: ~58% of a
      // three-player melee, including 6.5 inert seconds at the top. And the
      // blanket .ms-cardrow exclusion below was a FULL-WIDTH 126px band
      // across the bottom of a phone that moved as the row filled and
      // emptied, so the same gesture worked or didn't 12px apart. Together
      // that is exactly what Wyatt reported on 7/19: "the Continue button is
      // clickable but the rest of the screen is not... inconsistent and feels
      // broken."
      //
      // Now: Continue live → advance. Otherwise → expedite the beat in
      // flight. The card row still swallows SWIPES (it is overflow-x:auto and
      // a drag emits a click on release) but no longer swallows presses.
      // .ms-continue and .ms-skip need no exclusion; both stopPropagation.
      // No debounce is needed: waitContinue's done() nulls advanceTap before
      // resolving, so a double-tap no-ops for free.
      let rowSwiped = false, downInRow = false, downX = 0, downY = 0;
      host.onpointerdown = (e) => {
        downInRow = !!(e.target.closest && e.target.closest('.ms-cardrow'));
        downX = e.clientX; downY = e.clientY; rowSwiped = false;
      };
      host.onpointerup = (e) => {
        rowSwiped = downInRow
          && (Math.abs(e.clientX - downX) > 8 || Math.abs(e.clientY - downY) > 8);
      };
      host.onclick = () => {
        if (state === 'closed') return;
        if (rowSwiped) { rowSwiped = false; return; }   // that was a scroll
        // The coronation hold is deliberate (Wyatt 7/18) — expedite must
        // never shorten it, so 'revealed' returns either way.
        if (state === 'revealed') {
          if (Date.now() - revealedAt >= revealHoldMs) close();
          return;
        }
        if (advanceTap) { advanceTap(); return; }
        expedite();
      };
      skipEl.onclick = (e) => { e.stopPropagation(); if (state === 'playing') finalize(); };

      // ── The show (async driver — forge beats are player-paced) ───────
      (async () => {
        await delay(950); if (run.killed) return;
        titleEl.classList.add('perched');

        // Roll-call
        heraldSay(`${combatants.length} heirs enter the arena — let the Melee begin!`);
        for (const el of combatantEls) {
          el.classList.add('in');
          await delay(260); if (run.killed) return;
        }
        await delay(400); if (run.killed) return;

        // Forge — strictly one fighter at a time under the spotlight.
        arenaEl.classList.add('spot');
        await delay(350); if (run.killed) return;
        for (let i = 0; i < combatantEls.length; i++) {
          await runFighter(i); if (run.killed) return;
        }
        arenaEl.classList.remove('spot');

        // Clash
        heraldSay('They clash for the crown!');
        await delay(750); if (run.killed) return;
        doClash();
        await delay(700); if (run.killed) return;

        // Coronation
        showResults();
        await delay(350); if (run.killed) return;
        revealTier(2, false);
        await delay(1000, 600); if (run.killed) return;
        revealTier(1, false);
        await delay(1050, 600); if (run.killed) return;
        revealTier(0, true);
        await delay(1000, 600); if (run.killed) return;
        markRevealed();
        if (autoCloseMs) {
          await delay(autoCloseMs);
          if (state !== 'closed' && !run.killed) close();
        }
      })();
    });
  }

  window.playMeleeCinematic = playMeleeCinematic;
})();
