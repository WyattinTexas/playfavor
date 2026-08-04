// ═══════════════════════════════════════════════════════════════════
// FAVOR — game modes beyond the queue (Wyatt's 7/16 batch).
//
//   SKIRMISH      pure vs-AI at the menu's table size; pick ANY owned
//                 hero (the 3-card queue offer is a matchmaking thing).
//   WANTED        one named rival a day (the mode formerly titled Daily
//                 Rival — Wyatt renamed it 7/16). Finish ahead of them
//                 and the crown pays the bounty, once per daily window
//                 (same 10 PM ET boundary as the champions board). The
//                 Bandit's head is 100 ★; the rest drift 25–75 by day.
//                 Same engine as Skirmish, but the rival rides with a
//                 second copy of their starting gold.
//   PRIVATE ROOM  host a table, hand friends the code, AI fills the
//                 empty seats. Lobby here; the record handshake and the
//                 pick/seal/live pipeline live in js/mp.js (FMP.rooms).
//   EMOTES        Nation's six reactions, streamed to every screen at
//                 the table (multiplayer only).
//
// ui.js owns the game itself; this file owns the doors into it.
// ═══════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    // ── Shared: every owned hero, as character defs ──────────────────
    function ownedChars() {
        const ids = (window.FLB && typeof FLB.ownedIds === 'function')
            ? FLB.ownedIds()
            : window.FAVOR_DATA.characters.slice(0, 5).map(c => c.id);
        return window.FAVOR_DATA.characters.filter(c => ids.includes(c.id));
    }

    // Leave the title screen the same way Play Now does.
    function titleToSelect(offer) {
        window._mpConsumed = false;
        $('title-screen').classList.add('hidden');
        setTimeout(() => {
            $('title-screen').style.display = 'none';
            showCharacterSelect(offer);
        }, 1200);
    }

    // ── SKIRMISH ─────────────────────────────────────────────────────
    // First question: how big a table? (Wyatt 7/16 — the size is part of
    // what kind of game a skirmish IS, not a menu-wide setting.)
    // The door's difficulty pick (Wyatt 7/24): Casual = the classic table
    // brains the community likes; Hard = EVERY bot runs the sharp brain
    // (js/ai.js) — an explicit choice, so no silent-difficulty rule here.
    let _skHard = false;

    function openSkirmish() {
        _skHard = false;
        renderSkirmishPick();
    }

    function renderSkirmishPick() {
        const ov = $('skirmishPick');
        ov.innerHTML = `
            <div class="ri-inner" onclick="event.stopPropagation()">
                <div class="ri-title">Skirmish</div>
                <div class="ri-stakes">${_skHard
                    ? 'The court sends its sharpest — every rival plays the hard game.'
                    : "A friendly clash against the court's own — play any hero you own."}</div>
                <div class="rm-size queue-seg sk-diff" title="How sharp the court plays">
                    <span class="queue-label">CPU</span>
                    <button type="button" class="${_skHard ? '' : 'on'}" onclick="FMODES.skirmishDiff(false)">Casual</button>
                    <button type="button" class="${_skHard ? 'on' : ''}" onclick="FMODES.skirmishDiff(true)">Hard</button>
                </div>
                <div class="sk-sizes">
                    ${[3, 4, 5].map(n => `
                        <button type="button" class="sk-size" onclick="FMODES.beginSkirmish(${n})">
                            <b>${n}</b><span>players</span>
                        </button>`).join('')}
                </div>
                <button type="button" class="menu-link rm-back" onclick="FMODES.closeSkirmishPick()">← Back</button>
            </div>`;
        ov.classList.add('active');
        ov.onclick = () => closeSkirmishPick();
    }

    function skirmishDiff(hard) {
        _skHard = !!hard;
        renderSkirmishPick();
    }

    function closeSkirmishPick() {
        $('skirmishPick').classList.remove('active');
    }

    function beginSkirmish(n) {
        closeSkirmishPick();
        window._gameMode = 'skirmish';
        window._skirmishSize = [3, 4, 5].includes(n) ? n : 3;
        window._skirmishHard = _skHard;
        titleToSelect(ownedChars());
    }

    // ── WANTED (the daily rival) ─────────────────────────────────────
    // TEN rivals — one for each character in the game, each with a name
    // worth facing (Wyatt 7/16). The day's pick is deterministic from the
    // daily key (10 PM ET boundary — the same day the champions live on):
    // every client, same rival. No repeat on consecutive days. Rivals are
    // NOT leaderboard citizens — they never post rows; they just play
    // sharp (persona brain) astride their own hero.
    const RIVALS = [
        { key: 'explorer',  hero: 'explorer',  name: 'Marco Nadal',             strong: ['survival', 'prospecting'] },
        { key: 'knight',    hero: 'knight',    name: 'Ser Thomas',              strong: ['power', 'survival'] },
        { key: 'bandit',    hero: 'bandit',    name: 'Vivienne Quickfingers',   strong: ['prospecting', 'power'] },
        { key: 'merchant',  hero: 'merchant',  name: 'Wim Goldweight',          strong: ['charisma', 'knowledge'] },
        { key: 'fisherman', hero: 'fisherman', name: 'Angler Pete',             strong: ['survival', 'knowledge'] },
        { key: 'duchess',   hero: 'duchess',   name: 'Elizabeth the Bold',      strong: ['charisma', 'knowledge'] },
        { key: 'scientist', hero: 'scientist', name: 'John Quicksilver',        strong: ['alchemy', 'knowledge'] },
        { key: 'doctor',    hero: 'doctor',    name: 'Doctor Black',            strong: ['alchemy', 'charisma'] },
        { key: 'fiddler',   hero: 'fiddler',   name: 'Fiddling Al Gable',       strong: ['charisma', 'power'] },
        { key: 'magician',  hero: 'magician',  name: 'Skylar Wondermaker',      strong: ['alchemy', 'prospecting'] },
    ];

    function hashKey(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
        return h;
    }

    // The bounty (Wyatt 7/16): the Bandit's head is always worth 100 ★;
    // every other head drifts day to day — 25..75 in steps of 5, hashed
    // from the daily key so every client shows and pays the same number.
    function rivalStars(rival, key) {
        if (!rival) return 25;
        if (rival.key === 'bandit') return 100;
        const k = key || FLB.currentDateKey();
        return 25 + (hashKey(k + '|' + rival.key) % 11) * 5;
    }

    function rivalOfDay(key) {
        const pool = RIVALS;
        const k = key || FLB.currentDateKey();
        let idx = hashKey(k) % pool.length;
        // Yesterday's pick (previous calendar day of the same key-space)
        // may not repeat — step once if the hash collides.
        const prev = new Date(k + 'T12:00:00Z');
        prev.setUTCDate(prev.getUTCDate() - 1);
        const prevIdx = hashKey(prev.toISOString().slice(0, 10)) % pool.length;
        if (idx === prevIdx) idx = (idx + 1) % pool.length;
        // A sharp table brain + a seat at the rated start, but NO
        // leaderboard identity (uid stays absent on purpose).
        return { ...pool[idx], strong: pool[idx].strong.slice(), rating: 1640 };
    }

    function rivalBeatenToday() {
        return !!(window.FLB && FLB.rivalDayClaimed && FLB.rivalDayClaimed() === FLB.currentDateKey());
    }

    // ── The menu plaque — the WANTED rival IS its own button, worn like
    // Nation's Challenger: portrait, name plate, the ★ stakes, a live
    // countdown to the next rival, and a red ! while today's is unbeaten.
    let _plaqueT = null;

    function fmtClock(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
    }

    function renderRivalPlaque() {
        const card = $('rivalPlaque');
        if (!card || !window.FLB || !window.FAVOR_DATA) return;
        const rival = rivalOfDay();
        const hero = window.FAVOR_DATA.characters.find(c => c.id === rival.hero);
        const beaten = rivalBeatenToday();
        card.classList.toggle('beaten', beaten);
        card.innerHTML = `
            ${beaten ? '' : '<span class="drp-badge">!</span>'}
            <div class="drp-head">Wanted</div>
            <div class="drp-frame">
                <img class="drp-art" src="assets/characters/${hero ? hero.filename : ''}" alt="">
                ${beaten ? '<div class="drp-stamp">CLAIMED</div>' : ''}
            </div>
            <div class="drp-name">${rival.name}</div>
            <div class="drp-stars">${beaten ? 'Next rival in' : `<b>★</b> +${rivalStars(rival)}`}</div>
            <div class="drp-clock" id="drpClock">${fmtClock(FLB.msUntilNextWindow())}</div>`;
        clearInterval(_plaqueT);
        _plaqueT = setInterval(() => {
            const el = $('drpClock');
            if (!el) { clearInterval(_plaqueT); _plaqueT = null; return; }
            const left = FLB.msUntilNextWindow();
            el.textContent = fmtClock(left);
            if (left < 1000) renderRivalPlaque();   // rollover — the next rival takes the plaque
        }, 1000);
    }

    function openDailyRival() {
        const rival = rivalOfDay();
        const hero = window.FAVOR_DATA.characters.find(c => c.id === rival.hero);
        const beaten = rivalBeatenToday();
        const ov = $('rivalIntro');
        ov.innerHTML = `
            <div class="ri-inner" onclick="event.stopPropagation()">
                <div class="ri-title">Wanted</div>
                <img class="ri-art${beaten ? ' beaten' : ''}" src="assets/characters/${hero ? hero.filename : ''}" alt="">
                ${beaten ? '<div class="ri-stamp">CLAIMED</div>' : ''}
                <div class="ri-name">${rival.name}</div>
                <div class="ri-sub">${hero ? 'The ' + hero.name : ''} · a table of three</div>
                <div class="ri-stakes">${beaten
                    ? 'Beaten today — the next rival arrives at 10 PM Eastern.'
                    : `Finish <b>ahead of them</b> and the crown pays <b>+${rivalStars(rival)} ★</b> — once a day.`}</div>
                <div class="ri-actions">
                    <button class="btn-royal" onclick="FMODES.closeRivalIntro()"><span>Not Today</span></button>
                    <button class="btn-royal primary" onclick="FMODES.beginRivalGame()"><span>${beaten ? 'Rematch' : 'Face Them'}</span></button>
                </div>
            </div>`;
        ov.classList.add('active');
        ov.onclick = () => closeRivalIntro();
    }

    function closeRivalIntro() {
        $('rivalIntro').classList.remove('active');
    }

    function beginRivalGame() {
        closeRivalIntro();
        window._gameMode = 'rival';
        const rival = rivalOfDay();
        window._rivalDef = rival;
        // You can't take the seat the rival already holds (Wyatt 7/17) — drop
        // their hero from your offer. Guard against a one-hero roster.
        const roster = ownedChars().filter(c => c.id !== rival.hero);
        titleToSelect(roster.length ? roster : ownedChars());
    }

    // Called by showScoring with the final placements. A daily win pays
    // once per window — the claim is an atomic whole-row transaction in
    // meta.js, so two tabs can't double-pay.
    async function rivalGameOver(scores) {
        if (window._gameMode !== 'rival' || !window._rivalDef) return;
        const rival = window._rivalDef;
        const myPlace = scores.findIndex(s => s.name === 'You');
        const rivalPlace = scores.findIndex(s => s.name === rival.name);
        if (myPlace < 0 || rivalPlace < 0 || myPlace > rivalPlace) return;
        try {
            const key = FLB.currentDateKey();
            const stars = rivalStars(rival, key);
            const fresh = await FLB.claimRivalWin(key, stars);
            if (fresh) {
                showNotification(`Rival bested — ${rival.name} yields! +${stars} ★`, 'act');
                addLogEntry(`Wanted rival defeated: ${rival.name} (+${stars} Stars)`);
                renderRivalPlaque();   // the plaque wears its BEATEN stamp now
            }
        } catch (e) { /* the win itself still stands */ }
    }

    // ── PRIVATE ROOMS — lobby UI over FMP.rooms ──────────────────────
    let room = null;   // { code, host } while in a lobby

    function openPrivateRoom() {
        if (!(window.FMP && FMP.available())) {
            showNotification('Private rooms need the realm connection — you appear offline.', 'error');
            return;
        }
        renderRoomDoor();
        $('roomOverlay').classList.add('active');
    }

    function closePrivateRoom() {
        if (room) { FMP.leaveRoom(); room = null; }
        $('roomOverlay').classList.remove('active');
    }

    function renderRoomDoor() {
        $('roomOverlay').innerHTML = `
            <div class="rm-inner" onclick="event.stopPropagation()">
                <div class="rm-title">Private Game</div>
                <div class="rm-sub">Host a game and share the code, or join a friend's.</div>
                <button class="btn-royal primary rm-host" onclick="FMODES.hostRoom()"><span>Host a Game</span></button>
                <div class="rm-or">or</div>
                <div class="rm-join">
                    <input id="rmCode" maxlength="5" placeholder="CODE" autocomplete="off"
                           oninput="this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '')">
                    <button class="btn-royal" onclick="FMODES.joinRoom()"><span>Join</span></button>
                </div>
                <button type="button" class="menu-link rm-back" onclick="FMODES.closePrivateRoom()">← Back</button>
            </div>`;
        $('roomOverlay').onclick = () => closePrivateRoom();
    }

    function hostRoom() {
        room = { host: true };
        FMP.hostRoom({
            size: (window.FLB && FLB.queueSize()) || 3,
            offer: rollStickyOffer().map(c => c.id),   // seal fallback, like the queue
            onState: roomEvent,
        });
    }

    function joinRoom() {
        const code = ($('rmCode') ? $('rmCode').value : '').trim().toUpperCase();
        if (code.length < 4) { showNotification('Enter the room code your host shared.', 'error'); return; }
        room = { host: false };
        FMP.joinRoom(code, {
            offer: rollStickyOffer().map(c => c.id),
            onState: roomEvent,
        });
    }

    function roomEvent(kind, d) {
        if (kind === 'room') { room && renderRoomLobby(d.code, d.rec); return; }
        if (kind === 'closed') {
            const why = {
                empty: 'No one joined — the room closed after two minutes.',
                gone: 'The room closed.',
                host_left: 'The host left — the room closed.',
                full: 'That room is already full.',
                missing: 'No room answers to that code.',
                version: 'That room runs a different build — refresh and retry.',
            }[d.reason] || 'The room closed.';
            showNotification(why, d.reason === 'missing' || d.reason === 'full' ? 'error' : 'info');
            room = null;
            renderRoomDoor();
            return;
        }
        if (kind === 'picking') {
            // The lobby's work is done — the queue-rework pick/seal/live
            // theater takes it from here (ui.js listens the same way).
            $('roomOverlay').classList.remove('active');
            roomEnterPick(d);
            return;
        }
        if (kind === 'live') {
            room = null;
            roomGoLive(d);
            return;
        }
    }

    function renderRoomLobby(code, rec) {
        const me = FLB.uid();
        const host = rec.hostUid === me;
        const seats = Object.entries(rec.seats || {})
            .sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
        const humans = seats.length;
        const fill = Math.max(0, (rec.size || 3) - humans);
        const sizeBtn = (n) => `
            <button type="button" class="${rec.size === n ? 'on' : ''}"
                    ${host ? `onclick="FMODES.roomSetSize(${n})"` : 'disabled'}>${n}</button>`;
        $('roomOverlay').innerHTML = `
            <div class="rm-inner rm-lobby" onclick="event.stopPropagation()">
                <div class="rm-title">Private Game</div>
                <div class="rm-code" title="Share this code">${code}</div>
                <div class="rm-sub">Share this code with your friends.</div>
                <div class="rm-size queue-seg">
                    <span class="queue-label">Players</span>
                    ${sizeBtn(3)}${sizeBtn(4)}${sizeBtn(5)}
                </div>
                <div class="rm-size queue-seg" title="How sharp the AI seats play — the host decides">
                    <span class="queue-label">CPU</span>
                    <button type="button" class="${rec.hard ? '' : 'on'}"
                            ${host ? 'onclick="FMODES.roomSetHard(false)"' : 'disabled'}>Casual</button>
                    <button type="button" class="${rec.hard ? 'on' : ''}"
                            ${host ? 'onclick="FMODES.roomSetHard(true)"' : 'disabled'}>Hard</button>
                </div>
                <div class="rm-list">
                    ${seats.map(([u, s]) => `
                        <div class="rm-row${u === rec.hostUid ? ' host' : ''}">
                            <span class="rm-crown">${u === rec.hostUid ? '♛' : ''}</span>
                            <span class="rm-name">${s.name || 'A Noble'}${u === me ? ' (you)' : ''}</span>
                        </div>`).join('')}
                    ${Array.from({ length: fill }, () => `
                        <div class="rm-row open"><span class="rm-crown"></span><span class="rm-name">Open seat</span></div>`).join('')}
                </div>
                <div class="rm-note">Open seats play as AI${rec.hard ? ' — the court’s sharpest' : ''}.</div>
                <div class="rm-note">Scores count here — rating, hero XP, and Daily Champions.</div>
                <div class="rm-note">Fellowship bonus: +${(window.FLB && FLB.fellowshipStars) || 5}★ for each fellow human at the table, win or lose.</div>
                <div class="rm-status">${host ? '' : 'Waiting for the host to start…'}</div>
                <div class="ri-actions rm-actions">
                    <button class="btn-royal" onclick="FMODES.closePrivateRoom()"><span>Leave</span></button>
                    ${host ? `<button class="btn-royal primary" onclick="FMODES.startRoomGame()"><span>Start Game</span></button>` : ''}
                </div>
            </div>`;
    }

    function roomSetSize(n) { FMP.roomSetSize(n); }
    function roomSetHard(v) { FMP.roomSetHard(v); }

    function startRoomGame() {
        if (!room || !room.host) return;
        FMP.roomStart();
    }

    // The pick phase + live handoff — same theater the queue uses.
    function roomEnterPick(d) {
        window._gameMode = null;
        if (typeof roomPickPhase === 'function') roomPickPhase(d);
    }
    function roomGoLive(d) {
        if (window._mpConsumed) return;
        window._mpConsumed = true;
        localStorage.removeItem('favorOffer');
        if (typeof leavePickPhase === 'function') leavePickPhase({ keepScreen: true });
        startMpGame(d);
    }

    // ── EMOTES — Nation's six, streamed table-wide ───────────────────
    const EMOTES = ['hearts', 'swordsandshield', 'crying', 'fuming', 'thumbsup', 'thumbsdown'];
    const EMOTE_COOLDOWN = 2500;
    let _lastEmote = 0;

    function attachEmotes() {
        if (!(window.FMP && FMP.active())) return;
        FMP.onBroadcast('emote', (m) => {
            if (!EMOTES.includes(m.e)) return;
            if (m.seat === FMP.mySeat()) return;   // own bubble already showed at the tap
            showEmoteBubble(FMP.localIdx(m.seat), m.e);
        });
        const btn = $('emoteBtn');
        if (btn) btn.classList.add('on');
    }

    function detachEmotes() {
        const btn = $('emoteBtn');
        if (btn) btn.classList.remove('on');
        const tray = $('emoteTray');
        if (tray) tray.classList.remove('active');
    }

    function toggleEmoteTray() {
        const tray = $('emoteTray');
        if (!tray) return;
        if (tray.classList.contains('active')) { tray.classList.remove('active'); return; }
        tray.innerHTML = EMOTES.map(e =>
            `<img src="assets/emotes/${e}.png" alt="${e}" onclick="event.stopPropagation(); FMODES.emote('${e}')">`).join('');
        tray.classList.add('active');
    }

    function emote(e) {
        const tray = $('emoteTray');
        if (tray) tray.classList.remove('active');
        const now = Date.now();
        if (now - _lastEmote < EMOTE_COOLDOWN) return;
        _lastEmote = now;
        if (window.FMP && FMP.active()) FMP.publish('emote', { e });
        // Your own bubble shows immediately — the stream echo is for the others.
        showEmoteBubble(0, e);
    }

    // The reaction lands in that player's bubble on every screen: over
    // their seat chip (phone) and their sidebar entry (desktop) — over
    // your own stats panel when it's yours.
    function showEmoteBubble(pi, e) {
        const anchors = pi === 0
            ? [document.querySelector('#tvSeats .pmat[data-pi="0"]'), $('statsPanel')]
            : [document.querySelector(`#tvSeats .pmat[data-pi="${pi}"]`),
               document.querySelector(`#gameSidebar .opp-entry[data-pi="${pi}"]`)];
        const host = anchors.find(el => el && el.getBoundingClientRect().width > 2);
        if (!host) return;
        const r = host.getBoundingClientRect();
        const b = document.createElement('div');
        b.className = 'emote-bubble';
        b.innerHTML = `<img src="assets/emotes/${e}.png" alt="">`;
        document.body.appendChild(b);
        const bw = 54;
        b.style.left = Math.max(4, Math.min(r.left + r.width / 2 - bw / 2, innerWidth - bw - 4)) + 'px';
        b.style.top = Math.max(4, r.top - bw - 6) + 'px';
        setTimeout(() => b.classList.add('out'), 2200);
        setTimeout(() => b.remove(), 2650);
    }

    // ── THE THRONE ROOM — the door, the hall, the ceremony (ship 2) ──
    // js/mp.js owns the machinery (presence, the 9:18 draw, the seal);
    // this owns the three door states on the menu, the full-hall view,
    // and the seated ceremony. The pick/seal/live pipeline from the
    // draw onward is the queue's own theater (roomPickPhase and
    // startMpGame), untouched.

    let _thDoorT = null;     // menu door ticker
    let _thHallT = null;     // hall countdown ticker
    let _thRows = {};        // last hall snapshot (the ceremony reads it)
    const _thSeen = new Set();   // uids already standing (arrivals animate)
    let _thPickPending = null;   // 'picking' payload held for the ceremony
    let _thrCeremonyUntil = 0;

    function thFmt(ms) {
        const s = Math.max(0, Math.ceil(ms / 1000));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
        return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
                 : `${m}:${String(ss).padStart(2, '0')}`;
    }

    // The door — closed (counting), open (glowing, 9:15–9:17:59 ET), or
    // sealed ("the court is in session"). Server-time truth via FMP.
    function renderThroneDoor() {
        const el = $('throneDoor');
        if (!el || !window.FMP) return;
        const ph = FMP.throne.phase();
        el.classList.toggle('open', ph.phase === 'open');
        el.classList.toggle('sealed', ph.phase === 'sealed');
        let line, clock = '';
        if (ph.phase === 'open') {
            line = 'The doors stand open — enter';
            clock = thFmt(ph.msToBar);
        } else if (ph.phase === 'sealed') {
            line = 'The court is in session.';
        } else {
            line = 'The court convenes at 9:15 PM';
            if (ph.msToOpen < 3600 * 1000) clock = thFmt(ph.msToOpen);
        }
        el.innerHTML = `
            <span class="tsx-fleur">⚜</span>
            <span class="tsx-name">The Throne Room</span>
            <span class="tsx-line">${line}</span>
            ${clock ? `<span class="tsx-clock">${clock}</span>` : ''}
            <span class="tsx-fleur">⚜</span>`;
        if (!_thDoorT) _thDoorT = setInterval(renderThroneDoor, 1000);
    }

    function openThroneDoor() {
        if (!window.FMP) return;
        const ph = FMP.throne.phase();
        if (ph.phase === 'open') { enterThroneHall(); return; }
        renderThroneInfo(ph);
    }

    // The modest panel behind a closed (or sealed) door: what the Throne
    // Room is, tonight's time, and the board it feeds.
    function renderThroneInfo(ph) {
        const ov = $('throneOv');
        const sealed = ph.phase === 'sealed';
        ov.innerHTML = `
            <div class="ri-inner thr-info" onclick="event.stopPropagation()">
                <div class="thr-info-fleur">⚜</div>
                <div class="ri-title">The Throne Room</div>
                <div class="ri-stakes">${sealed
                    ? 'The court is in session — tonight’s games are underway.'
                    : 'Once a night, the whole realm plays at once.'}</div>
                <div class="thr-info-body">
                    The doors open at <b>9:15 PM</b> Eastern and bar at
                    <b>9:18</b>, when everyone standing in the hall is drawn
                    into tables of 4 and 5. Finish your game and every Star it
                    pays is <b>tripled</b>; win your table and you take the
                    <b>+100★ purse</b>. Every result stands on the
                    <b>Throne board</b> — wins first, Favor breaks ties.
                </div>
                ${sealed ? '' : `<div class="thr-info-when">Tonight at 9:15 PM
                    ${ph.msToOpen < 3600 * 1000 ? `— <b>${thFmt(ph.msToOpen)}</b>` : ''}</div>`}
                <div class="ri-actions">
                    <button type="button" class="btn-royal" onclick="FMODES.closeThroneInfo()"><span>Back</span></button>
                    <button type="button" class="btn-royal primary"
                            onclick="FMODES.closeThroneInfo(); FLB.openLeaderboard('throne')">
                        <span>The Throne Board</span></button>
                </div>
            </div>`;
        ov.classList.add('active');
        ov.onclick = () => closeThroneInfo();
    }
    function closeThroneInfo() { $('throneOv').classList.remove('active'); }

    // ── The hall — everyone standing before the Throne ───────────────
    function enterThroneHall() {
        if (FMP.throne.active()) { $('throneHall').classList.add('active'); return; }
        _thRows = {};
        _thSeen.clear();
        _thPickPending = null;
        _thrCeremonyUntil = 0;
        $('throneHall').innerHTML = `
            <div class="thr-stage">
                <div class="thr-head">
                    <div class="thr-title"><span>⚜</span> The Throne Room <span>⚜</span></div>
                    <div class="thr-clockline" id="thrClockline"></div>
                    <div class="thr-count" id="thrCount"></div>
                </div>
                <div class="thr-floor" id="thrFloor"></div>
                <div class="thr-foot">
                    <button type="button" class="menu-link thr-leave" id="thrLeave"
                            onclick="FMODES.closeThroneHall()">← Leave the Hall</button>
                </div>
                <div class="thr-ceremony" id="thrCeremony"></div>
            </div>`;
        $('throneHall').classList.add('active');
        FMP.throne.join({
            offer: rollStickyOffer().map(c => c.id),
            onState: throneEvent,
        });
        thHallTick();
        clearInterval(_thHallT);
        _thHallT = setInterval(thHallTick, 1000);
    }

    // Countdown + the barred flip. The last minute runs hot; past the
    // bar the copy turns — "the games begin…" while the draw claims.
    function thHallTick() {
        const el = $('thrClockline');
        if (!el || !window.FMP) return;
        const ph = FMP.throne.phase();
        if (ph.phase === 'open') {
            el.classList.toggle('hot', ph.msToBar <= 60 * 1000);
            el.innerHTML = `The games begin in <b class="thr-clock">${thFmt(ph.msToBar)}</b>`;
        } else {
            el.classList.add('hot');
            el.innerHTML = `The doors are barred. <b>The games begin…</b>`;
            const leave = $('thrLeave');
            if (leave) leave.style.visibility = 'hidden';   // you are seated, period
        }
    }

    function renderThroneHall(rows) {
        _thRows = rows || {};
        const floor = $('thrFloor');
        if (!floor) return;
        const me = FLB.uid();
        const sNow = FMP.throne.srvReal();   // hb liveness — real clock, never the night seam
        const freshMs = ((FMP._T && FMP._T.fresh) || 15000) + 10000;   // display slack
        const standing = Object.entries(_thRows)
            .filter(([, r]) => r && (typeof r.hb !== 'number' || sNow - r.hb < freshMs))
            .sort((a, b) => ((a[1].at || 0) - (b[1].at || 0)) || (a[0] < b[0] ? -1 : 1));
        const count = $('thrCount');
        if (count) count.innerHTML =
            `<b>${standing.length}</b> ${standing.length === 1 ? 'stands' : 'stand'} before the Throne`;
        floor.innerHTML = standing.map(([u, r]) => `
            <div class="thr-row${u === me ? ' me' : ''}${_thSeen.has(u) ? '' : ' arrive'}">
                ${FLB.avatarDisc(r.crest, 'thr-crest')}
                <span class="thr-name">${r.name || 'A Noble'}${u === me ? '<i class="thr-you">you</i>' : ''}</span>
                ${FLB.ratingSpan(r.rating || 1000, 'thr-rating')}
            </div>`).join('');
        standing.forEach(([u]) => _thSeen.add(u));
    }

    function throneEvent(kind, d) {
        if (kind === 'hall') { renderThroneHall(d.rows); return; }
        if (kind === 'seated') { throneCeremony(d); return; }
        if (kind === 'picking') {
            // Hold the pick behind the ceremony's two seconds, then the
            // queue's own hero-pick theater takes it (server-anchored
            // clock — the moment eaten here is honest).
            _thPickPending = d;
            const wait = Math.max(0, _thrCeremonyUntil - Date.now());
            setTimeout(() => {
                if (!_thPickPending) return;
                const p = _thPickPending;
                _thPickPending = null;
                closeThroneUi();
                window._gameMode = null;
                if (typeof roomPickPhase === 'function') roomPickPhase(p);
            }, wait);
            return;
        }
        if (kind === 'live') {
            _thPickPending = null;
            closeThroneUi();
            if (window._mpConsumed) return;
            window._mpConsumed = true;
            localStorage.removeItem('favorOffer');
            if (typeof leavePickPhase === 'function') leavePickPhase({ keepScreen: true });
            startMpGame(d);
            return;
        }
        if (kind === 'missed') { renderThroneMissed(); return; }
        if (kind === 'closed') {
            const why = {
                sealed: 'The doors are barred — the court is in session.',
                closed: 'The doors stand closed — the court convenes at 9:15 PM.',
                gone: 'The court has adjourned — the table was lost.',
            }[d.reason] || 'The Throne Room is closed.';
            showNotification(why, 'info');
            closeThroneUi();
            return;
        }
    }

    // "You are seated. A table of N." — your tablemates' crests, two
    // seconds of court before the hero pick.
    function throneCeremony(d) {
        const cer = $('thrCeremony');
        if (!cer) return;
        _thrCeremonyUntil = Date.now() + 2200;
        const me = FLB.uid();
        const mates = (d.uids || []).filter(u => u !== me);
        const aiSeats = Math.max(0, (d.size || 4) - (d.uids || []).length);
        cer.innerHTML = `
            <div class="thr-cer-inner">
                <div class="thr-cer-fleur">⚜</div>
                <div class="thr-cer-title">You are seated.</div>
                <div class="thr-cer-sub">A table of ${d.size}</div>
                <div class="thr-cer-mates">
                    ${mates.map(u => {
                        const r = _thRows[u] || {};
                        return `<div class="thr-cer-mate">
                            ${FLB.avatarDisc(r.crest, 'thr-crest')}
                            <span>${r.name || 'A Noble'}</span>
                        </div>`;
                    }).join('')}
                    ${Array.from({ length: aiSeats }, () => `
                        <div class="thr-cer-mate ai">
                            <span class="av-disc av-empty thr-crest"><img src="assets/icons/prestige.png" alt=""></span>
                            <span>The court’s own</span>
                        </div>`).join('')}
                </div>
            </div>`;
        cer.classList.add('on');
    }

    function renderThroneMissed() {
        const floor = $('thrFloor');
        const count = $('thrCount');
        const line = $('thrClockline');
        if (line) { line.classList.remove('hot'); line.innerHTML = 'The court has moved on.'; }
        if (count) count.innerHTML = '';
        if (floor) floor.innerHTML = `
            <div class="thr-missed">
                <div class="thr-cer-fleur">⚜</div>
                <div>The games began without you — return tomorrow.</div>
                <button type="button" class="btn-royal" onclick="FMODES.closeThroneHall()"><span>Return</span></button>
            </div>`;
        const leave = $('thrLeave');
        if (leave) leave.style.visibility = 'hidden';
    }

    // Walking out (or the missed-night Return): the row goes with you.
    function closeThroneHall() {
        if (window.FMP && FMP.throne.active()) FMP.throne.leave();
        closeThroneUi();
    }

    function closeThroneUi() {
        clearInterval(_thHallT);
        _thHallT = null;
        const hall = $('throneHall');
        if (hall) { hall.classList.remove('active'); hall.innerHTML = ''; }
        closeThroneInfo();
    }

    // ── Public surface ───────────────────────────────────────────────
    window.FMODES = {
        openSkirmish, beginSkirmish, closeSkirmishPick,
        openDailyRival, closeRivalIntro, beginRivalGame,
        rivalOfDay, rivalStars, rivalGameOver, renderRivalPlaque,
        openPrivateRoom, closePrivateRoom, hostRoom, joinRoom,
        roomSetSize, roomSetHard, startRoomGame,
        skirmishDiff,
        openThroneDoor, closeThroneInfo, closeThroneHall, renderThroneDoor,
        attachEmotes, detachEmotes, toggleEmoteTray, emote,
        EMOTES,
    };

    // The plaque draws at load, over the inline preboot paint in index.html.
    // The BEATEN state reads _me, which only exists after meta.js's connect()
    // resolves -- and that races a 6s timeout, so the old 1600/4500ms retries
    // could BOTH fire before the row landed and the CLAIMED stamp would never
    // appear on a slow connection. renderProfileChip now calls back into this
    // the moment _me is assigned, however long that takes.
    renderRivalPlaque();
    // The Throne door too — its ticker owns it from the first paint.
    renderThroneDoor();
})();
