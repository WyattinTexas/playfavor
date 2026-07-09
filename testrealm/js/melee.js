/**
 * FAVOR — Melee coronation cinematic.
 *
 * A self-contained, dependency-free reveal for the end-of-act Melee. The field
 * clashes in (portraits land, Power bars charge, numbers tick), then the three
 * heirs who earned Prestige ascend a rising podium and the champion is crowned.
 *
 * playMeleeCinematic(host, results, actNum, opts) → Promise (resolves on continue)
 *   host      : the full-screen overlay element to render into
 *   results   : [{ playerIndex, name, power, placement, prestige }]  (power-desc)
 *   actNum    : 1 | 2 | 3
 *   opts      : { speed, portraitFor(playerIndex)→url, powerIcon }
 *
 * Kept apart from ui.js on purpose: tools/melee-preview.html loads THIS file and
 * nothing else, so the reveal can be iterated on without touching the game.
 */
(function () {
  'use strict';

  const ACTS = ['I', 'II', 'III'];
  const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
  const POS = ['p-center', 'p-left', 'p-right'];

  // Heraldic crown that descends onto the champion.
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

  // A single laurel branch (mirrored via CSS for the other side).
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
    return new Promise((resolve) => {
      opts = opts || {};
      const speed = opts.speed || 1;
      const portraitFor = opts.portraitFor || (() => 'assets/ui/cover.jpg');
      const powerIcon = opts.powerIcon || 'assets/icons/power.png';
      const fallback = 'assets/ui/cover.jpg';
      const maxPower = Math.max(1, ...results.map(r => r.power || 0));

      // ── Group by placement (ties share a tier) ──────────────────────
      const tiers = [];
      results.forEach(r => {
        let t = tiers.find(x => x.placement === r.placement);
        if (!t) { t = { placement: r.placement, prestige: r.prestige || 0, members: [] }; tiers.push(t); }
        t.members.push(r);
      });
      const podium = tiers.slice(0, 3);            // up to three groups ascend
      const alsoRans = [];
      tiers.slice(3).forEach(t => t.members.forEach(m => alsoRans.push(m)));

      // ── Build the fighters on a tier ────────────────────────────────
      const fighterHTML = (r, champ) => `
        <div class="ms-fighter" data-power="${r.power || 0}">
          <div class="ms-portrait-wrap">
            ${champ ? CROWN_SVG + laurel('left') + laurel('right') : ''}
            <img class="ms-portrait" src="${portraitFor(r.playerIndex)}" alt="${r.name}"
                 onerror="this.onerror=null;this.src='${fallback}'">
          </div>
          <div class="ms-name">${r.name}</div>
          <div class="ms-power"><img src="${powerIcon}" alt="Power"><b>0</b></div>
          <div class="ms-bar"><div class="ms-bar-fill"></div></div>
        </div>`;

      const tierHTML = (t, podiumIdx) => {
        const champ = podiumIdx === 0;
        const numeral = t.members.length > 1 ? t.placement : t.placement; // ties keep their shared placement
        return `<div class="ms-tier ${POS[podiumIdx]}${champ ? ' champ' : ''}">
          <div class="ms-fighters">${t.members.map(m => fighterHTML(m, champ)).join('')}</div>
          ${t.prestige ? `<div class="ms-prestige">+${t.prestige} Prestige</div>` : `<div class="ms-prestige" style="visibility:hidden">·</div>`}
          <div class="ms-plinth"><span class="ms-numeral">${numeral}</span></div>
        </div>`;
      };

      // Visual arrangement: left, center, right (so the champion sits middle).
      const visual = [];
      if (podium[1]) visual.push(tierHTML(podium[1], 1));
      if (podium[0]) visual.push(tierHTML(podium[0], 0));
      if (podium[2]) visual.push(tierHTML(podium[2], 2));

      const alsoHTML = alsoRans.length ? `
        <div class="ms-alsoran">
          ${alsoRans.map(r => `
            <div class="ms-ar">
              <img src="${portraitFor(r.playerIndex)}" alt="${r.name}" onerror="this.onerror=null;this.src='${fallback}'">
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
          <div class="ms-podium">${visual.join('')}</div>
          ${alsoHTML}
          <div class="ms-flash"></div>
          <div class="ms-hint">Tap to continue</div>
        </div>`;
      host.classList.add('active');

      const stage = host.querySelector('.ms-stage');
      const titleEl = host.querySelector('.ms-title');
      const alsoEl = host.querySelector('.ms-alsoran');
      const flashEl = host.querySelector('.ms-flash');
      const hintEl = host.querySelector('.ms-hint');
      // Map podium index → its rendered .ms-tier element.
      const tierEls = [];
      const domTiers = Array.from(host.querySelectorAll('.ms-tier'));
      podium.forEach((t, idx) => {
        tierEls[idx] = domTiers.find(el => el.classList.contains(POS[idx]));
      });

      // ── Run state ───────────────────────────────────────────────────
      const timers = [];
      const run = { killed: false };
      let state = 'playing'; // playing → revealed → closed
      const after = (ms, fn) => timers.push(setTimeout(() => { if (!run.killed) fn(); }, ms * speed));

      const tickNumber = (b, target, dur) => {
        if (!b) return;
        // Ease off the wall clock (not the rAF timestamp) so a throttled or
        // paused rAF can never freeze the count at 0, and guarantee the final
        // value with a timer as a belt-and-suspenders backstop.
        const start = Date.now();
        const step = () => {
          if (run.killed) { b.textContent = target; return; }
          const k = Math.min(1, (Date.now() - start) / dur);
          b.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        timers.push(setTimeout(() => { if (!run.killed) b.textContent = target; }, dur + 60));
      };

      const sparkBurst = (el, n) => {
        const rect = el.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        const cx = rect.left - hostRect.left + rect.width / 2;
        const cy = rect.top - hostRect.top + rect.height * 0.35;
        for (let i = 0; i < n; i++) {
          const s = document.createElement('span');
          s.className = 'ms-spark';
          const ang = Math.random() * Math.PI * 2;
          const dist = 40 + Math.random() * 70;
          s.style.left = cx + 'px'; s.style.top = cy + 'px';
          s.style.setProperty('--sx', Math.cos(ang) * dist + 'px');
          s.style.setProperty('--sy', (Math.sin(ang) * dist - 30) + 'px');
          stage.appendChild(s);
          requestAnimationFrame(() => s.classList.add('go'));
          setTimeout(() => s.remove(), 700 * speed);
        }
      };

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
        }
        fillTier(el, false);
        sparkBurst(el, champ ? 14 : 6);
      };

      const markRevealed = () => {
        if (state !== 'playing') return;
        state = 'revealed';
        hintEl.classList.add('show');
      };

      const finalize = () => {           // tap-to-skip → jump to the result
        run.killed = true;
        timers.forEach(clearTimeout);
        timers.length = 0;
        titleEl.classList.add('perched');
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
        state = 'closed';
        run.killed = true;
        timers.forEach(clearTimeout);
        host.classList.remove('active');
        host.onclick = null;
        setTimeout(() => { host.innerHTML = ''; resolve(); }, 320 * speed);
      };

      host.onclick = () => {
        if (state === 'playing') finalize();
        else if (state === 'revealed') close();
      };

      // ── Timeline ────────────────────────────────────────────────────
      after(950, () => titleEl.classList.add('perched'));
      after(1180, () => { if (alsoEl) alsoEl.classList.add('show'); });
      after(1560, () => revealTier(2, false));   // 3rd  — right plinth
      after(2460, () => revealTier(1, false));   // 2nd  — left plinth
      after(3380, () => revealTier(0, true));    // 1st  — center, crowned
      after(4400, markRevealed);
      after(4400 + 3000, () => { if (state !== 'closed') close(); });  // auto-continue
    });
  }

  window.playMeleeCinematic = playMeleeCinematic;
})();
