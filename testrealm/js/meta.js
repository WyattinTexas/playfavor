// ═══════════════════════════════════════════════════════════════════
// FAVOR meta layer — menu identity, leaderboard, Daily Champions.
//
// Backend: Firebase RTDB (project testroom-75200), EVERYTHING namespaced
// under favor/*:
//   favor/players/{uid}   { name, rating, stars, champs{gold,silver,bronze},
//                           msgQueue{pushId:{type,dateKey,place,stars}},
//                           created, lastSeen }
//   favor/daily/{dateKey}/scores/{uid}   { name, best, at }
//   favor/settled/{dateKey}              { at, by, podium[] }
//
// Daily windows roll at 10:00 PM America/New_York: a moment's dateKey is
// its ET calendar date, bumped to tomorrow once the clock passes 22:00 —
// so "today's board" always pays out at 10 PM tonight. Settlement is
// LAZY and IDEMPOTENT: the first client to load after a boundary claims
// each unsettled past key via a transaction on favor/settled/{key} and
// only the claimant writes stars/champs/msgQueue (exactly once; ties
// break by earliest score). A scheduled job (GitHub Actions cron) is the
// hardening step so 10 PM pays out even if nobody is online.
//
// If Firebase is unreachable (offline, blocked referrer) the SAME UI
// runs on a localStorage adapter — solo standings, loudly labeled
// "LOCAL STANDINGS" in the leaderboard header so it never masquerades
// as the real board. Scores are client-authoritative (same posture as
// Nation).
// ═══════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    const FB_CONFIG = {
        apiKey: "AIzaSyDzYoQqXoOu4uj2wzTwSn6d_gAlo6e8WSI",
        authDomain: "testroom-75200.firebaseapp.com",
        databaseURL: "https://testroom-75200-default-rtdb.firebaseio.com",
        projectId: "testroom-75200",
        storageBucket: "testroom-75200.firebasestorage.app",
        messagingSenderId: "711812846396",
        appId: "1:711812846396:web:08e2375f257205483f8439"
    };
    const NS = 'favor';
    const STAR_AWARDS = [50, 25, 10];
    const PLACE_WORD = ['1st', '2nd', '3rd'];
    const CHAMP_KEYS = ['gold', 'silver', 'bronze'];

    // ── Store economy (defaults for Wyatt to veto) ───────────────────
    // Every finished game pays Stars by finish position; Daily Champions
    // (50/25/10 above) stays the nightly jackpot on top of these.
    const STORE_PRICE = 100;
    const FREE_CHAR_COUNT = 5;   // data/characters.js order: first five are free

    function gameStars(place, count) {
        if (place === 0) return 10;
        if (place === 1) return 6;
        if (place === 2) return 4;
        return 2;
    }

    // Small gold crown — inline SVG so the champion mark is OURS (royal,
    // never an emoji from somebody else's set).
    const CROWN_SVG = '<svg class="crown-ico" viewBox="0 0 24 16" aria-hidden="true">'
        + '<path d="M2 14 L1 4 L7 8 L12 1 L17 8 L23 4 L22 14 Z" fill="#e8c34b" stroke="#8a6a1f" stroke-width="1"/>'
        + '<rect x="2" y="14" width="20" height="2" fill="#c9a84c"/></svg>';

    // ── Identity ─────────────────────────────────────────────────────

    function uid() {
        let u = localStorage.getItem('favorUid');
        if (!u) {
            u = 'u' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
            localStorage.setItem('favorUid', u);
        }
        return u;
    }

    const NAME_TITLES = ['Duke', 'Duchess', 'Baron', 'Baroness', 'Count', 'Countess',
        'Sir', 'Dame', 'Lord', 'Lady', 'Squire', 'Marquis', 'Viscount', 'Earl'];
    const NAME_NOUNS = ['Marmalade', 'Pickle', 'Turnip', 'Biscuit', 'Waffles', 'Plum',
        'Custard', 'Radish', 'Crumpet', 'Parsnip', 'Gooseberry', 'Snapdragon',
        'Marzipan', 'Pumpernickel', 'Quince', 'Butterscotch', 'Trifle', 'Fig',
        'Clementine', 'Bramble', 'Chestnut', 'Damson'];

    function generateName() {
        const t = NAME_TITLES[Math.floor(Math.random() * NAME_TITLES.length)];
        const n = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)];
        return `${t} ${n}`;
    }

    function myName() {
        let n = localStorage.getItem('favorName');
        if (!n) { n = generateName(); localStorage.setItem('favorName', n); }
        return n;
    }

    // ── Daily windows (10 PM America/New_York) ───────────────────────

    function etParts(d = new Date()) {
        const fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/New_York', hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit'
        });
        const p = {};
        fmt.formatToParts(d).forEach(x => { p[x.type] = x.value; });
        return { y: p.year, m: p.month, d: p.day, h: parseInt(p.hour, 10) % 24 };
    }

    function currentDateKey(now = new Date()) {
        const p = etParts(now);
        if (p.h >= 22) {
            // Past tonight's boundary — we're playing on tomorrow's board.
            const dt = new Date(Date.UTC(+p.y, +p.m - 1, +p.d));
            dt.setUTCDate(dt.getUTCDate() + 1);
            return dt.toISOString().slice(0, 10);
        }
        return `${p.y}-${p.m}-${p.d}`;
    }

    // ── Rating points (deterministic, per finished game vs the table) ──

    function ratingDelta(place, count) {
        if (place === 0) return 25;          // the throne
        if (place === 1) return 10;          // runner-up
        if (place === count - 1) return -10; // last
        return 0;
    }

    // ═══ Backends — one interface, Firebase or localStorage ══════════

    let fdb = null;          // firebase database handle when live
    let mode = 'connecting'; // 'firebase' | 'local' | 'connecting'

    // ---- localStorage adapter (same shapes as the RTDB tree) ----
    const LOCAL_KEY = 'favorLB';
    function localTree() {
        try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; }
        catch (e) { return {}; }
    }
    function localSave(t) { localStorage.setItem(LOCAL_KEY, JSON.stringify(t)); }
    function localGet(path) {
        let n = localTree();
        for (const part of path.split('/')) { if (n == null) return null; n = n[part]; }
        return n == null ? null : n;
    }
    function localSet(path, val) {
        const t = localTree();
        const parts = path.split('/');
        let n = t;
        for (let i = 0; i < parts.length - 1; i++) {
            if (typeof n[parts[i]] !== 'object' || n[parts[i]] == null) n[parts[i]] = {};
            n = n[parts[i]];
        }
        if (val == null) delete n[parts[parts.length - 1]];
        else n[parts[parts.length - 1]] = val;
        localSave(t);
    }

    async function dbGet(path) {
        if (mode === 'firebase') {
            const s = await fdb.ref(`${NS}/${path}`).get();
            return s.exists() ? s.val() : null;
        }
        return localGet(path);
    }
    async function dbSet(path, val) {
        if (mode === 'firebase') return fdb.ref(`${NS}/${path}`).set(val);
        localSet(path, val);
    }
    async function dbUpdate(path, val) {
        if (mode === 'firebase') return fdb.ref(`${NS}/${path}`).update(val);
        Object.entries(val).forEach(([k, v]) => localSet(`${path}/${k}`, v));
    }
    async function dbPush(path, val) {
        if (mode === 'firebase') return fdb.ref(`${NS}/${path}`).push(val);
        localSet(`${path}/m${Date.now()}${Math.floor(Math.random() * 1e4)}`, val);
    }
    // Transaction: firebase native; local = read-modify-write (single client).
    async function dbTxn(path, fn) {
        if (mode === 'firebase') {
            const res = await fdb.ref(`${NS}/${path}`).transaction(fn);
            return { committed: res.committed, value: res.snapshot ? res.snapshot.val() : null };
        }
        const next = fn(localGet(path));
        if (next === undefined) return { committed: false, value: localGet(path) };
        localSet(path, next);
        return { committed: true, value: next };
    }

    async function connect() {
        try {
            if (!window.firebase || !firebase.initializeApp) throw new Error('firebase sdk absent');
            if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(FB_CONFIG);
            fdb = firebase.database();
            // Prove we can actually read through the wire before trusting it.
            mode = 'firebase';
            await Promise.race([
                dbGet(`players/${uid()}/name`),
                new Promise((_, rej) => setTimeout(() => rej(new Error('fb timeout')), 6000)),
            ]);
        } catch (e) {
            mode = 'local';
            console.warn('[FAVOR meta] Firebase unreachable — LOCAL standings only:', e.message);
        }
        return mode;
    }

    // ═══ Player record ═══════════════════════════════════════════════
    // LAZY: nobody joins the board just by loading the page — the record
    // materializes on the first posted result (or an explicit rename).
    // Until then the chip runs on the local name with rating 0.

    async function readPlayer() {
        const me = await dbGet(`players/${uid()}`);
        if (me && me.name) localStorage.setItem('favorName', me.name);
        if (me && me.owned) mirrorOwned(me.owned);
        return me;
    }

    async function rename(newName) {
        newName = (newName || '').trim().slice(0, 24);
        if (newName.length < 3) return false;
        localStorage.setItem('favorName', newName);
        await dbUpdate(`players/${uid()}`, { name: newName });
        return true;
    }

    // ═══ Posting a finished game ═════════════════════════════════════
    // Called from showScoring() with the sorted score rows. Only YOUR
    // result posts — the bots present as people but stay off the board.

    async function postGameResult(scores) {
        try {
            const place = scores.findIndex(s => s.name === 'You');
            if (place < 0) return;
            const mine = scores[place];
            const delta = ratingDelta(place, scores.length);

            await dbTxn(`players/${uid()}/rating`, r => Math.max(0, (r || 0) + delta));
            // Per-game Stars — every game pays something (store economy).
            const starsWon = gameStars(place, scores.length);
            await dbTxn(`players/${uid()}/stars`, s => (s || 0) + starsWon);
            // First result materializes the record (lazy join — see above).
            // AWAITED: a trailing fire-and-forget here can land after a
            // caller's subsequent reads/cleanup and resurrect the row.
            await dbUpdate(`players/${uid()}`, { name: myName(), lastSeen: Date.now() });

            // Daily board: best single-game Favor score in this window.
            const key = currentDateKey();
            await dbTxn(`daily/${key}/scores/${uid()}`, cur => {
                if (cur && cur.best >= mine.finalScore) return cur;
                return { name: myName(), best: mine.finalScore, at: Date.now() };
            });
            renderProfileChip();
        } catch (e) {
            console.warn('[FAVOR meta] post failed:', e.message);
        }
    }

    // ═══ Daily Champions — lazy idempotent settlement ════════════════

    function podiumSort(scores) {
        return Object.entries(scores || {})
            .map(([u, s]) => ({ uid: u, name: s.name, best: s.best, at: s.at || 0 }))
            .sort((a, b) => (b.best - a.best) || (a.at - b.at));   // ties → earliest
    }

    async function settleDue() {
        try {
            const cur = currentDateKey();
            const days = await dbGet('daily');
            if (!days) return;
            for (const key of Object.keys(days).sort()) {
                if (key >= cur) continue;   // window still open
                const claim = await dbTxn(`settled/${key}`, existing => {
                    if (existing) return;                       // already settled — abort
                    return { at: Date.now(), by: uid() };       // claim it
                });
                if (!claim.committed || !claim.value || claim.value.by !== uid()) continue;

                const podium = podiumSort((days[key] || {}).scores).slice(0, 3);
                for (let i = 0; i < podium.length; i++) {
                    const p = podium[i];
                    await dbTxn(`players/${p.uid}/stars`, s => (s || 0) + STAR_AWARDS[i]);
                    await dbTxn(`players/${p.uid}/champs/${CHAMP_KEYS[i]}`, c => (c || 0) + 1);
                    await dbPush(`players/${p.uid}/msgQueue`, {
                        type: 'daily_champion', dateKey: key, place: i + 1, stars: STAR_AWARDS[i],
                    });
                }
                await dbUpdate(`settled/${key}`, {
                    podium: podium.map((p, i) => ({ uid: p.uid, name: p.name, best: p.best, stars: STAR_AWARDS[i] })),
                });
            }
        } catch (e) {
            console.warn('[FAVOR meta] settle failed:', e.message);
        }
    }

    // Congratulations queued for this player — royal overlay on arrival.
    async function drainMsgs() {
        try {
            const msgs = await dbGet(`players/${uid()}/msgQueue`);
            if (!msgs) return;
            const entries = Object.entries(msgs);
            for (const [k, m] of entries) {
                if (m && m.type === 'daily_champion') await showChampOverlay(m);
                await dbSet(`players/${uid()}/msgQueue/${k}`, null);
            }
            renderProfileChip();
        } catch (e) { /* non-fatal */ }
    }

    function showChampOverlay(m) {
        return new Promise(resolve => {
            const ov = document.getElementById('champOverlay');
            const first = m.place === 1;
            document.getElementById('champTitle').textContent = first
                ? 'You Placed 1st — You are the Daily Champion!'
                : `You Placed ${PLACE_WORD[m.place - 1]} on the Daily Board`;
            document.getElementById('champSub').innerHTML =
                `${first ? CROWN_SVG + ' ' : ''}${m.stars} Stars earned · ${m.dateKey}`;
            ov.classList.add('active');
            const done = () => { ov.classList.remove('active'); resolve(); };
            ov.onclick = done;
            document.getElementById('champBtn').onclick = (e) => { e.stopPropagation(); done(); };
        });
    }

    // ═══ Menu UI — profile chip, profile panel, leaderboard ══════════

    let _me = null;

    // Synchronous view of the last-read player record — the victory screen
    // snapshots this BEFORE posting so its deltas measure THIS game.
    function snapshot() {
        const p = _me || {};
        return { rating: p.rating || 0, stars: p.stars || 0 };
    }

    async function renderProfileChip() {
        const chip = document.getElementById('profileChip');
        if (!chip) return;
        _me = await dbGet(`players/${uid()}`) || _me;
        const gold = (_me && _me.champs && _me.champs.gold) || 0;
        chip.innerHTML = `
            <span class="pc-name">${myName()}</span>
            <span class="pc-rating" title="Rating">${(_me && _me.rating) || 0}</span>
            ${gold > 0 ? `<span class="pc-crowns" title="Daily Championships">${CROWN_SVG}${gold}</span>` : ''}
        `;
    }

    function openProfile() {
        const p = _me || { rating: 0, stars: 0, champs: {} };
        const ch = p.champs || {};
        document.getElementById('profileBody').innerHTML = `
            <div class="pf-row pf-namerow">
                <input id="pfName" maxlength="24" value="${myName().replace(/"/g, '&quot;')}">
                <button class="btn-royal" id="pfSave"><span>Save</span></button>
            </div>
            <div class="pf-row"><span class="pf-label">Rating</span><b>${p.rating || 0}</b></div>
            <div class="pf-row"><span class="pf-label">Stars</span><b>★ ${p.stars || 0}</b></div>
            <div class="pf-row"><span class="pf-label">Daily Championships</span>
                <b class="pf-champs">${CROWN_SVG} ${ch.gold || 0} · 2nd ${ch.silver || 0} · 3rd ${ch.bronze || 0}</b></div>
            <div class="pf-note">Champions are crowned nightly at 10 PM Eastern.${mode === 'local' ? '<br><b class="pf-local">LOCAL PROFILE — leaderboard offline</b>' : ''}</div>
        `;
        document.getElementById('pfSave').onclick = async () => {
            const okd = await rename(document.getElementById('pfName').value);
            if (okd) { renderProfileChip(); closeProfile(); }
            else document.getElementById('pfName').classList.add('bad');
        };
        document.getElementById('profilePanel').classList.add('active');
    }
    function closeProfile() { document.getElementById('profilePanel').classList.remove('active'); }

    async function openLeaderboard(tab = 'alltime') {
        const panel = document.getElementById('lbPanel');
        panel.classList.add('active');
        document.querySelectorAll('.lb-tab').forEach(t =>
            t.classList.toggle('on', t.dataset.tab === tab));
        const body = document.getElementById('lbBody');
        body.innerHTML = '<div class="lb-loading">Consulting the heralds…</div>';
        document.getElementById('lbLocal').style.display = mode === 'local' ? 'block' : 'none';

        try {
            let rows = [];
            if (tab === 'alltime') {
                const players = await dbGet('players') || {};
                rows = Object.entries(players)
                    .filter(([, p]) => p && p.name)   // nameless stubs stay off the board
                    .map(([u, p]) => ({ uid: u, name: p.name, score: p.rating || 0,
                                        gold: (p.champs && p.champs.gold) || 0 }))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 50);
            } else {
                const key = currentDateKey();
                const day = await dbGet(`daily/${key}/scores`) || {};
                rows = podiumSort(day).map(p => ({ uid: p.uid, name: p.name, score: p.best, gold: 0 }))
                    .slice(0, 50);
            }
            if (!rows.length) {
                body.innerHTML = `<div class="lb-loading">No champions yet — the ${tab === 'alltime' ? 'realm' : 'day'} awaits its first.</div>`;
                return;
            }
            body.innerHTML = rows.map((r, i) => `
                <div class="lb-row${r.uid === uid() ? ' me' : ''}">
                    <span class="lb-rank">${i + 1}</span>
                    <span class="lb-name">${r.name || 'Unknown Noble'}
                        ${tab === 'alltime' && r.gold > 0 ? `<span class="lb-crowns">${CROWN_SVG}${r.gold}</span>` : ''}
                    </span>
                    <b class="lb-score">${r.score}</b>
                </div>`).join('');
        } catch (e) {
            body.innerHTML = '<div class="lb-loading">The heralds are unreachable.</div>';
        }
    }
    function closeLeaderboard() { document.getElementById('lbPanel').classList.remove('active'); }

    // ═══ Character store — buy heroes with Stars ═════════════════════
    // Ownership lives at favor/players/{uid}/owned/{charId}: true, with a
    // localStorage mirror (favorOwned) so hero select works synchronously
    // and offline. The first five characters are everyone's.

    function freeIds() {
        return ((window.FAVOR_DATA || {}).characters || [])
            .slice(0, FREE_CHAR_COUNT).map(c => c.id);
    }

    function ownedIds() {
        let bought = [];
        try { bought = JSON.parse(localStorage.getItem('favorOwned')) || []; }
        catch (e) { /* fresh mirror */ }
        return [...new Set([...freeIds(), ...bought])];
    }

    function mirrorOwned(ownedMap) {
        const bought = Object.keys(ownedMap || {}).filter(k => ownedMap[k]);
        localStorage.setItem('favorOwned', JSON.stringify(bought));
    }

    // Purchase — ONE transaction on the whole player record: the balance
    // check and the ownership write commit together or not at all. The
    // client's displayed balance is never trusted for the write, and a
    // missing record materializes here (lazy join, same as rename).
    async function buyCharacter(charId) {
        const char = ((window.FAVOR_DATA || {}).characters || []).find(c => c.id === charId);
        if (!char) return { ok: false, why: 'unknown' };
        if (ownedIds().includes(charId)) return { ok: false, why: 'owned' };
        // Offline the store is browse-only: a local-ledger purchase would
        // evaporate when the next online session re-mirrors remote owned
        // (stars spent, hero gone) — refuse honestly instead.
        if (mode !== 'firebase') return { ok: false, why: 'offline' };
        // Server-side pre-read: a player who can't afford it never reaches
        // the transaction — otherwise the null-guess stub below would
        // materialize nameless rows that pollute the all-time board. The
        // txn stays the sole authority for the actual purchase.
        try {
            const current = await dbGet(`players/${uid()}`);
            if (((current && current.stars) || 0) < STORE_PRICE) return { ok: false, why: 'stars' };
            if (current && current.owned && current.owned[charId]) return { ok: false, why: 'owned' };
        } catch (e) {
            return { ok: false, why: 'offline' };
        }
        const res = await dbTxn(`players/${uid()}`, p => {
            if (p == null) {
                // Firebase hands the update fn its LOCAL guess first — null
                // when nothing is cached. Returning undefined here would
                // CANCEL the transaction before the server's real record is
                // consulted, so return a provisional stub instead: the
                // server compare rejects it and re-runs us with the truth.
                // A genuinely-new player commits the stub (lazy join) and
                // is still refused below — no stars, no ownership.
                return { stars: 0 };
            }
            const stars = p.stars || 0;
            if (stars < STORE_PRICE) return;            // abort — can't afford
            if (p.owned && p.owned[charId]) return;     // abort — exactly once
            return { ...p, stars: stars - STORE_PRICE,
                     owned: { ...(p.owned || {}), [charId]: true } };
        });
        if (!res.committed || !res.value || !res.value.owned || !res.value.owned[charId]) {
            return { ok: false, why: 'stars' };
        }
        dbUpdate(`players/${uid()}`, { name: myName(), lastSeen: Date.now() });
        _me = res.value;
        mirrorOwned(res.value.owned);
        renderProfileChip();
        return { ok: true };
    }

    // ── Store panel (lb-panel pattern: art IS the UI) ────────────────

    let _confirmingBuy = null;

    async function openStore() {
        const panel = document.getElementById('storePanel');
        if (!panel) return;
        _confirmingBuy = null;
        panel.classList.add('active');
        renderStore();
        // Freshen the record so the balance is honest, then re-render.
        // A one-shot get() REJECTS when the wire hiccups — the stale
        // shelf already painted above is the graceful fallback.
        try {
            _me = await dbGet(`players/${uid()}`) || _me;
            if (_me && _me.owned) mirrorOwned(_me.owned);
            renderStore();
        } catch (e) { /* keep the already-rendered shelf */ }
    }

    function closeStore() {
        const panel = document.getElementById('storePanel');
        if (panel) panel.classList.remove('active');
        _confirmingBuy = null;
    }

    function renderStore() {
        const body = document.getElementById('storeBody');
        if (!body) return;
        const chars = ((window.FAVOR_DATA || {}).characters || []);
        const owned = ownedIds();
        const stars = (_me && _me.stars) || 0;
        document.getElementById('storeStars').innerHTML =
            `★ ${stars}${mode !== 'firebase' ? ' <span class="st-local">OFFLINE — BROWSE ONLY</span>' : ''}`;
        body.innerHTML = chars.map(c => {
            const isOwned = owned.includes(c.id);
            let action;
            if (isOwned) {
                action = '<span class="st-owned">Owned</span>';
            } else if (mode !== 'firebase') {
                // Browse-only offline — see buyCharacter's offline guard.
                action = `<button class="st-buy poor" disabled>★ ${STORE_PRICE}</button>`;
            } else if (_confirmingBuy === c.id) {
                action = `<button class="st-buy confirm" onclick="event.stopPropagation(); FLB.confirmBuy('${c.id}')">Buy — ★ ${STORE_PRICE}?</button>`;
            } else if (stars < STORE_PRICE) {
                action = `<button class="st-buy poor" onclick="event.stopPropagation(); FLB.askBuy('${c.id}')">★ ${STORE_PRICE}</button>`;
            } else {
                action = `<button class="st-buy" onclick="event.stopPropagation(); FLB.askBuy('${c.id}')">★ ${STORE_PRICE}</button>`;
            }
            return `<div class="st-card${isOwned ? ' owned' : ''}" data-char="${c.id}">
                <img src="assets/characters/${c.filename}" alt="${c.name}">
                <div class="st-plate">
                    <span class="st-name">${c.name}</span>
                    ${action}
                </div>
            </div>`;
        }).join('');
    }

    function askBuy(charId) {
        const stars = (_me && _me.stars) || 0;
        if (stars < STORE_PRICE) {
            // Can't afford — the button says so for a beat.
            const btn = document.querySelector(`.st-card[data-char="${charId}"] .st-buy`);
            if (btn) { btn.textContent = 'Not enough ★'; setTimeout(renderStore, 1200); }
            return;
        }
        _confirmingBuy = charId;
        renderStore();
    }

    async function confirmBuy(charId) {
        _confirmingBuy = null;
        const res = await buyCharacter(charId);
        renderStore();
        if (res.ok) {
            const char = window.FAVOR_DATA.characters.find(c => c.id === charId);
            await showPurchaseCelebration(char);
        } else if (res.why === 'stars' || res.why === 'offline') {
            // Every refusal says WHY for a beat — a silently reverting
            // confirm button reads as dead (e.g. the wire dropped after
            // boot and the pre-read refused).
            const btn = document.querySelector(`.st-card[data-char="${charId}"] .st-buy`);
            if (btn) {
                btn.textContent = res.why === 'offline' ? 'Offline — try again' : 'Not enough ★';
                setTimeout(renderStore, 1200);
            }
        }
    }

    // Short royal celebration — the champ overlay dressed for a purchase.
    function showPurchaseCelebration(char) {
        return new Promise(resolve => {
            const ov = document.getElementById('champOverlay');
            if (!ov || !char) { resolve(); return; }
            document.getElementById('champTitle').textContent = `${char.name} Joins Your Court!`;
            document.getElementById('champSub').innerHTML =
                `${CROWN_SVG} A new hero enters your select pool`;
            ov.classList.add('active');
            const done = () => { ov.classList.remove('active'); resolve(); };
            ov.onclick = done;
            document.getElementById('champBtn').onclick = (e) => { e.stopPropagation(); done(); };
        });
    }

    // ── Queue picker persistence (3/4/5-player queues) ───────────────

    function queueSize() {
        const v = parseInt(localStorage.getItem('favorQueue'), 10);
        return (v >= 3 && v <= 5) ? v : 3;
    }
    function bindQueuePicker() {
        const sel = document.getElementById('queueSelect');
        if (!sel) return;
        sel.value = String(queueSize());
        sel.onchange = () => localStorage.setItem('favorQueue', sel.value);
    }

    // ── Boot ─────────────────────────────────────────────────────────

    async function boot() {
        bindQueuePicker();
        await connect();
        await readPlayer();
        renderProfileChip();
        // A store opened during the 'connecting' window painted browse-only
        // — repaint now that the backend verdict is in.
        renderStore();
        await settleDue();     // pay out any boundary that passed while we were away
        await drainMsgs();     // then deliver congratulations
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    // Public surface
    window.FLB = {
        postGameResult, openLeaderboard, closeLeaderboard, openProfile, closeProfile,
        queueSize, rename, renderProfileChip, snapshot,
        settleDue, drainMsgs, currentDateKey, ratingDelta, generateName,
        gameStars, ownedIds, buyCharacter, openStore, closeStore, askBuy, confirmBuy,
        get mode() { return mode; }, uid,
    };
})();
