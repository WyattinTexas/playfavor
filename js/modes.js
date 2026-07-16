// ═══════════════════════════════════════════════════════════════════
// FAVOR — game modes beyond the queue (Wyatt's 7/16 batch).
//
//   SKIRMISH      pure vs-AI at the menu's table size; pick ANY owned
//                 hero (the 3-card queue offer is a matchmaking thing).
//   DAILY RIVAL   one named rival a day — a real leaderboard citizen.
//                 Finish ahead of them and the crown pays Stars, once
//                 per daily window (same 10 PM ET boundary as the
//                 champions board). Same engine as Skirmish.
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
    function openSkirmish() {
        const ov = $('skirmishPick');
        ov.innerHTML = `
            <div class="ri-inner" onclick="event.stopPropagation()">
                <div class="ri-title">Skirmish</div>
                <div class="ri-stakes">A friendly clash against the court's own — play any hero you own.</div>
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

    function closeSkirmishPick() {
        $('skirmishPick').classList.remove('active');
    }

    function beginSkirmish(n) {
        closeSkirmishPick();
        window._gameMode = 'skirmish';
        window._skirmishSize = [3, 4, 5].includes(n) ? n : 3;
        titleToSelect(ownedChars());
    }

    // ── DAILY RIVAL ──────────────────────────────────────────────────
    // TEN rivals — one for each character in the game, each with a name
    // worth facing (Wyatt 7/16). The day's pick is deterministic from the
    // daily key (10 PM ET boundary — the same day the champions live on):
    // every client, same rival. No repeat on consecutive days. Rivals are
    // NOT leaderboard citizens — they never post rows; they just play
    // sharp (persona brain) astride their own hero.
    const RIVAL_STARS = 25;
    const RIVALS = [
        { key: 'explorer',  hero: 'explorer',  name: 'Cassian the Far-Strider',      strong: ['survival', 'prospecting'] },
        { key: 'knight',    hero: 'knight',    name: 'Ser Aldemar the Unbowed',      strong: ['power', 'survival'] },
        { key: 'bandit',    hero: 'bandit',    name: 'Vesper Quickfingers',          strong: ['prospecting', 'power'] },
        { key: 'merchant',  hero: 'merchant',  name: 'Barnaby Goldweight',           strong: ['charisma', 'knowledge'] },
        { key: 'fisherman', hero: 'fisherman', name: 'Old Pike Whitmore',            strong: ['survival', 'knowledge'] },
        { key: 'duchess',   hero: 'duchess',   name: 'Duchess Vivienne the Radiant', strong: ['charisma', 'knowledge'] },
        { key: 'scientist', hero: 'scientist', name: 'Doctor Ambrose Quicksilver',   strong: ['alchemy', 'knowledge'] },
        { key: 'doctor',    hero: 'doctor',    name: 'Rosamund the Mender',          strong: ['alchemy', 'charisma'] },
        { key: 'fiddler',   hero: 'fiddler',   name: 'Fiddling Jack Merriweather',   strong: ['charisma', 'power'] },
        { key: 'magician',  hero: 'magician',  name: 'Prospero the Wondermaker',     strong: ['alchemy', 'prospecting'] },
    ];

    function hashKey(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
        return h;
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
        return { ...pool[idx], strong: pool[idx].strong.slice(), rating: 160 };
    }

    function rivalBeatenToday() {
        return !!(window.FLB && FLB.rivalDayClaimed && FLB.rivalDayClaimed() === FLB.currentDateKey());
    }

    // ── The menu plaque — the Daily Rival IS its own button, worn like
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
            <div class="drp-head">Daily Rival</div>
            <div class="drp-frame">
                <img class="drp-art" src="assets/characters/${hero ? hero.filename : ''}" alt="">
                ${beaten ? '<div class="drp-stamp">BEATEN</div>' : ''}
            </div>
            <div class="drp-name">${rival.name}</div>
            <div class="drp-stars">${beaten ? 'Next rival in' : `<b>★</b> +${RIVAL_STARS}`}</div>
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
                <div class="ri-title">Rival of the Day</div>
                <img class="ri-art${beaten ? ' beaten' : ''}" src="assets/characters/${hero ? hero.filename : ''}" alt="">
                ${beaten ? '<div class="ri-stamp">BEATEN</div>' : ''}
                <div class="ri-name">${rival.name}</div>
                <div class="ri-sub">${hero ? 'The ' + hero.name : ''} · a table of three</div>
                <div class="ri-stakes">${beaten
                    ? 'Beaten today — the next rival arrives at 10 PM Eastern.'
                    : `Finish <b>ahead of them</b> and the crown pays <b>+${RIVAL_STARS} ★</b> — once a day.`}</div>
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
        window._rivalDef = rivalOfDay();
        titleToSelect(ownedChars());
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
            const fresh = await FLB.claimRivalWin(key, RIVAL_STARS);
            if (fresh) {
                showNotification(`Rival bested — ${rival.name} yields! +${RIVAL_STARS} ★`, 'act');
                addLogEntry(`Daily Rival defeated: ${rival.name} (+${RIVAL_STARS} Stars)`);
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
                <div class="rm-list">
                    ${seats.map(([u, s]) => `
                        <div class="rm-row${u === rec.hostUid ? ' host' : ''}">
                            <span class="rm-crown">${u === rec.hostUid ? '♛' : ''}</span>
                            <span class="rm-name">${s.name || 'A Noble'}${u === me ? ' (you)' : ''}</span>
                        </div>`).join('')}
                    ${Array.from({ length: fill }, () => `
                        <div class="rm-row open"><span class="rm-crown"></span><span class="rm-name">Open seat</span></div>`).join('')}
                </div>
                <div class="rm-note">Open seats play as AI.</div>
                <div class="rm-status">${host ? '' : 'Waiting for the host to start…'}</div>
                <div class="ri-actions rm-actions">
                    <button class="btn-royal" onclick="FMODES.closePrivateRoom()"><span>Leave</span></button>
                    ${host ? `<button class="btn-royal primary" onclick="FMODES.startRoomGame()"><span>Start Game</span></button>` : ''}
                </div>
            </div>`;
    }

    function roomSetSize(n) { FMP.roomSetSize(n); }

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

    // ── Public surface ───────────────────────────────────────────────
    window.FMODES = {
        openSkirmish, beginSkirmish, closeSkirmishPick,
        openDailyRival, closeRivalIntro, beginRivalGame,
        rivalOfDay, rivalGameOver, renderRivalPlaque,
        openPrivateRoom, closePrivateRoom, hostRoom, joinRoom,
        roomSetSize, startRoomGame,
        attachEmotes, detachEmotes, toggleEmoteTray, emote,
        EMOTES,
    };

    // The plaque draws at load and again once the profile row lands (the
    // BEATEN state reads the cached row, which arrives a beat later).
    renderRivalPlaque();
    setTimeout(renderRivalPlaque, 1600);
    setTimeout(renderRivalPlaque, 4500);
})();
