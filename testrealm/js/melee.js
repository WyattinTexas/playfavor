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
 *               is crowned (rays + laurels + fanfare). Losers remain as the
 *               defeated court. A "Skip ▸▸" chip jumps to the result at any
 *               time; tap on the result continues.
 *
 * playMeleeCinematic(host, results, actNum, opts) → Promise (resolves on continue)
 *   results : [{ playerIndex, name, power, placement, prestige }]  (power-desc)
 *   opts    : { speed, portraitFor(pi), powerIcon, sound, sapFx, cardsFx,
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

  // ── Synthesised audio (no assets, offline) ─────────────────────────────
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

  function playMeleeCinematic(host, results, actNum, opts) {
    // Cancel any prior run still animating on this host — its timers would
    // clobber the fresh run (auto-close wiping DOM, scheduled sounds).
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
      // Sound is OFF unless explicitly enabled (Wyatt found the battle
      // ticks annoying). opts.sound === true re-enables the crown fanfare.
      const soundOn = opts.sound === true;
      const sapFx = opts.sapFx !== false;
      const cardsFx = opts.cardsFx !== false;
      const heraldOn = opts.herald !== false;
      const autoCloseMs = (opts.autoCloseMs == null) ? 9000 : opts.autoCloseMs;
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

      // ── Markup ──────────────────────────────────────────────────────
      const img = (pi, cls, name) =>
        `<img class="${cls}" src="${portraitFor(pi)}" alt="${name}" onerror="this.onerror=null;this.src='${fallback}'">`;

      const combatantHTML = (c) => `
        <div class="ms-combatant" data-pi="${c.playerIndex}" data-power="${c.power || 0}">
          <div class="ms-cb-callout"></div>
          <div class="ms-cb-portrait-wrap">${img(c.playerIndex, 'ms-cb-portrait', c.name)}</div>
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
          </div>
          <div class="ms-name">${r.name}</div>
          ${champ ? '<div class="ms-champ-label">✦ Champion ✦</div>' : ''}
          <div class="ms-power"><img src="${powerIcon}" alt="Power"><b>0</b></div>
        </div>`;

      const tierHTML = (t, podiumIdx) => {
        const champ = podiumIdx === 0;
        return `<div class="ms-tier ${POS[podiumIdx]}${champ ? ' champ' : ''}">
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
              ${img(r.playerIndex, '', r.name)}
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
      let advanceTap = null;   // pending "Continue" resolver during the forge

      host._meleeCancel = () => {
        run.killed = true;
        timers.forEach(clearTimeout); timers.length = 0;
        resolve();
      };

      const delay = (ms) => new Promise(res => timers.push(setTimeout(res, ms * speed)));
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
        coin.innerHTML = '<div class="ms-coin-face heads">★</div><div class="ms-coin-face tails">✕</div>';
        hostEl.appendChild(coin);
        void coin.offsetWidth;
        coin.classList.add(won ? 'flip-heads' : 'flip-tails');
        setTimeout(() => coin.remove(), 2200 * speed);
      };

      const sapStreak = (fromPi, toEl) => {
        const fromEl = combatantEls.find(e => +e.dataset.pi === fromPi);
        if (!fromEl || fromEl === toEl) return;
        const h = stage.getBoundingClientRect();
        const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
        const x1 = a.left - h.left + a.width / 2, y1 = a.top - h.top + a.height * 0.4;
        const x2 = b.left - h.left + b.width / 2, y2 = b.top - h.top + b.height * 0.4;
        const dx = x2 - x1, dy = y2 - y1;
        const streak = document.createElement('div');
        streak.className = 'ms-sap';
        streak.style.left = x1 + 'px'; streak.style.top = y1 + 'px';
        streak.style.width = Math.hypot(dx, dy) + 'px';
        streak.style.transform = 'rotate(' + (Math.atan2(dy, dx) * 180 / Math.PI) + 'deg)';
        stage.appendChild(streak);
        void streak.offsetWidth;
        streak.classList.add('go');
        setTimeout(() => streak.remove(), 640 * speed);
      };

      // ── FORGE: one fighter's full story, player-paced ────────────────
      const runFighter = async (i) => {
        const el = combatantEls[i], c = combatants[i];
        const b = el.querySelector('.ms-cb-power b');
        const calloutHost = el.querySelector('.ms-cb-callout');
        const bd = (breakdownFor && breakdownFor(c.playerIndex)) || { base: c.power || 0, steps: [] };

        // Only actual power contributors appear (cards AND missions, each
        // carrying its amount). Art-less contributors fold into the board
        // share so the number never lies.
        const visCards = [];
        if (cardsFx) {
          (bd.baseCards || []).slice(0, 4).forEach(cd => {
            const url = (cd && cd.amount > 0) ? cardImgFor(cd.filename, cd.mission) : null;
            if (url) visCards.push({ url, amount: cd.amount, mission: !!cd.mission });
          });
        }
        const baseStart = Math.max(0, (bd.base || 0) - visCards.reduce((a, x) => a + x.amount, 0));
        let running = 0;

        el.classList.add('forging', 'active');   // the stage lights this fighter
        await delay(650); if (run.killed) return;

        // EVERY point (and every modifier) gets a face in the row. Badges
        // spell the arithmetic: gold +N, red −N, grey 0 (a lost coin), ×2.
        const dealRowItem = (url, badgeText, cls, caption) => {
          const item = document.createElement('div');
          item.className = 'ms-rowitem' + (cls ? ' ' + cls : '');
          item.innerHTML =
            `<img src="${url}" alt="">` +
            `<span class="ms-rowamt${/^[−-]/.test(badgeText) ? ' neg' : badgeText === '0' ? ' zero' : ''}">${badgeText}</span>` +
            (caption ? `<span class="ms-rowcap">${caption}</span>` : '');
          const im = item.querySelector('img');
          im.onerror = () => item.remove();
          rowEl.appendChild(item);
          void item.offsetWidth;
          item.classList.add('go');
        };

        if (cardsFx && baseStart > 0) {
          dealRowItem(portraitFor(c.playerIndex), '+' + baseStart, 'board', 'Board');
          running = baseStart;
          tickNumber(b, running, 340);
          bump(el);
          await delay(950); if (run.killed) return;
        } else {
          // Cards off (or no board share): open the count at the board share.
          running = baseStart;
          tickNumber(b, running, 500);
          await delay(200); if (run.killed) return;
        }

        for (const vc of visCards) {
          dealRowItem(vc.url, '+' + vc.amount, vc.mission ? 'missioncard' : '');
          running = Math.max(0, running + vc.amount);
          tickNumber(b, running, 340);
          bump(el);
          await delay(950); if (run.killed) return;
        }

        // Modifiers land as combat hits — and their SOURCE CARD joins the
        // row too (a lost coin's card shows a grey 0; a sap shows red −N).
        const stepArt = (step) => (cardsFx && step.filename) ? cardImgFor(step.filename, !!step.missionCard) : null;
        for (const step of (bd.steps || [])) {
          if (step.kind === 'coinflip') {
            flipCoin(calloutHost, step.won);
            await delay(1750); if (run.killed) return;
            const cu = stepArt(step);
            if (step.won) {
              running = Math.max(0, running + step.amount);
              tickNumber(b, running, 380);
              showCallout(calloutHost, { kind: 'coin', label: step.label, amount: step.amount });
              if (cu) dealRowItem(cu, '+' + step.amount, 'mod');
              bump(el);
              sparkBurst(el, 6, 0.2);
            } else {
              showCallout(calloutHost, { kind: 'miss', label: step.label }, 'Tails');
              if (cu) dealRowItem(cu, '0', 'mod');
            }
            await delay(700); if (run.killed) return;
            continue;
          }
          const sapping = step.kind === 'debuff' && sapFx && step.from != null;
          if (sapping) { sapStreak(step.from, el); await delay(380); if (run.killed) return; }
          showCallout(calloutHost, step);
          running = step.kind === 'mult' ? running * step.amount : running + step.amount;
          running = Math.max(0, running);
          tickNumber(b, running, 380);
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

        // Lock to the authoritative total; the herald calls it.
        if (b) b.textContent = c.power || 0;
        el.classList.add('locked'); el.classList.remove('forging');
        heraldSay(`${c.name}: ${c.power || 0} Power!`);

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
          await waitContinue(15000);
          btn.remove();
          if (run.killed) return;
          // Dismissed cards TUCK beside the fighter (mini overlapped strip),
          // so everyone's evidence stays "kind of visible" through the battle.
          const tuck = document.createElement('div');
          tuck.className = 'ms-tuck';
          Array.from(rowEl.querySelectorAll('.ms-rowitem img')).forEach((im, k) => {
            const t = document.createElement('img');
            t.className = 'ms-tuckcard';
            t.src = im.src;
            t.style.transitionDelay = (k * 55) + 'ms';
            tuck.appendChild(t);
          });
          el.appendChild(tuck);
          void tuck.offsetWidth;
          tuck.querySelectorAll('.ms-tuckcard').forEach(t => t.classList.add('go'));
          rowEl.classList.add('out');
          await delay(300); if (run.killed) return;
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
          const pw = +f.dataset.power;
          const b = f.querySelector('.ms-power b');
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
          heraldSay(championLine());
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
        skipEl.style.display = 'none';
        hintEl.classList.add('show');
      };
      const finalize = () => {                 // Skip ▸▸ → jump to the result
        run.killed = true;
        timers.forEach(clearTimeout); timers.length = 0;
        advanceTap = null;
        titleEl.classList.add('perched');
        arenaEl.classList.add('gone');
        arenaEl.classList.remove('spot');
        rowEl.innerHTML = '';
        const pendingBtn = stage.querySelector('.ms-continue');
        if (pendingBtn) pendingBtn.remove();
        if (alsoEl) alsoEl.classList.add('show');
        podium.forEach((t, idx) => {
          const el = tierEls[idx];
          if (!el) return;
          el.classList.add('show');
          if (idx === 0) el.classList.add('lit');
          fillTier(el, true);
        });
        heraldSay(championLine());
        skipEl.style.display = 'none';
        hintEl.classList.add('show');
        state = 'revealed';
      };
      const close = () => {
        if (state === 'closed') return;
        state = 'closed'; run.killed = true;
        timers.forEach(clearTimeout);
        if (host._meleeCancel) host._meleeCancel = null;
        host.classList.remove('active'); host.onclick = null;
        setTimeout(() => { host.innerHTML = ''; resolve(); }, 320 * speed);
      };

      // Taps: ONLY the Continue button advances the battle (stray taps —
      // e.g. while scrolling the card row on a phone — must not skip a
      // fighter). A tap on the final result closes; Skip ▸▸ jumps to it.
      host.onclick = () => {
        if (state === 'revealed') close();
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
        await delay(1000); if (run.killed) return;
        revealTier(1, false);
        await delay(1050); if (run.killed) return;
        revealTier(0, true);
        await delay(1000); if (run.killed) return;
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
