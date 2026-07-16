# FAVOR Updates — Wyatt's Notes 7/16

Fresh-session prompt. Work in `~/playfavor/` (ROOT — testrealm/ and testrealm2/ are stale/retired).
**Read cold first:** memory `favor-testrealm-dev-workflow` (code map, rigs, TWELVE ?v= stamps), `feedback_favor-rules-fidelity` (never simplify rules), `favor-queue-rework`, `favor-guided-first-game`.
Reference screenshots: `~/playfavor/docs/jul16-refs/` (numbered 1–5, described below).

---

## 1. ★ MOST IMPORTANT — Card-play flow rework (throw first, decide later)

> Wyatt: "This is vital to the success of the game. It's the biggest disconnect in the game right now — you don't really feel the cards you play, because the variables come late. This is how the game works in real life."

**Current (wrong):** when you play a card, a popup immediately asks how you want to play it (play / discard / discard-to-slide — the standard "how do you want to play this card" option sheet).

**Important nuance: the choice set does NOT go away — it MOVES.** Nothing appears at throw time; the same play/discard/discard-to-slide (+ pay-to-slide) choice reappears for each player at resolution time. Don't delete the option UI — relocate it to the resolution phase.

**New flow:**
1. Player drags card up → card is thrown. **No options popup. Nothing appears.**
2. **Undo:** any player may undo their own thrown card — but only until every player has thrown. The moment the last card goes in, ALL cards lock instantly. No more undo.
3. Everyone waits until all players have thrown a card.
4. **Resolution starts with the Emblem holder** (they are first player). Their card is already face-in; NOW they choose: play it / discard it / discard-to-slide. They may also pay money on their character sheet to slide.
5. Once they decide, that card's variables/effects apply immediately.
6. Then the next player resolves their already-thrown card the same way (decide → variables apply), continuing until every player has resolved.
7. Next hand begins; repeat (drag in, nothing pops up).

Key point: decisions and variable application happen **at resolution time in turn order**, not at throw time. Each card's variables apply as its owner decides — sequentially, one player at a time — NOT all at once at the end.

Wyatt's notes don't pin down two details — match the physical FAVOR rules ([feedback_favor-rules-fidelity]); if the physical rules don't settle it, ask Wyatt rather than guessing:
- What opponents see of thrown-but-unresolved cards (face-down in the middle, presumably).
- Resolution order after the Emblem holder (presumably seating order clockwise).

## 2. Throw-gesture prompt (replaces current drag hint)

Replace the current "play a card" prompt UI (ref: `1-current-play-prompt.png`) with a **finger icon pushing and sliding vertically up**, showing the throwing motion of the card.

## 3. Reaction emojis in-game (multiplayer)

- Add reaction emojis during a game to portray emotion.
- When a player reacts, the emoji appears **in that player's bubble on opponents' screens**.
- Use the **emoji set from Nation** to start (ref: `2-nation-emojis.png`; Nation code: `~/wkspaces/Nation`).
- Must work in multiplayer.

## 4. Skirmish Mode (new menu entry)

- Accessible from the main menu. Pure vs-AI game.
- Player chooses **3, 4, or 5 players** total.
- Character select: player may pick **any character they own** (not limited to a random 3) at game start.

## 5. Daily Rival (next to Skirmish in menu)

- Just like Nation's Daily Rival (memory: `nation-daily-rival`, `nation-daily-rival-design`).
- Beat the rival → earn Stars. It's a computer game — same engine as Skirmish.
- Sits **right next to Skirmish** in the menu; goal is easing players into the PvE side.

## 6. Private Rooms (new menu entry)

Works like Nation's private rooms (refs: `3/4/5-nation-private-room-*.png`).
- A player can **host a room**; a **room code** is generated for friends to join.
- If no one joins within **2 minutes**, the room auto-closes.
- **Game size is still 3/4/5 players, chosen in the room.** AI fills any empty seats: e.g. 2 humans in the room can play a 3-player game (+1 computer), 4-player (+2 computers), or 5-player (+3 computers).
- Game itself plays as usual: players choose from just 3 of their available characters.
- **Precaution:** no two players in a room may pick the same character — enforce uniqueness.

## 7. AI / persona naming split

- **Skirmish AI names stay thematic:** The Lady Vespurine, Count Balthazar, Lord Ashcropt, Dame Rosalind — that style is fine in Skirmish.
- **Leaderboard personas get realistic names.** Replace the five persona names on the leaderboard with: **HotshotGG, Athene, Sneaky Penguin, Mable Stadango, Papa Johns**.
- ⚠ Persona rows are PATCH-only / never delete (memories: `favor-avatars-leaderboard`, `favor-emblem-personas-plan`).

---

## Suggested order
1. Flow rework (#1) — biggest, touches core engine + multiplayer lockstep; do first while context is fresh.
2. Throw gesture (#2) — small, pairs naturally with #1 since the popup is being removed.
3. Skirmish (#4) → Daily Rival (#5) — Rival builds on Skirmish.
4. Private rooms (#6) — builds on queue-rework multiplayer plumbing.
5. Emojis (#3) — port from Nation.
6. Persona renames (#7) — quick data patch.

Remember: bump MPV + all ?v= stamps on push; verify on prod (playfavor.net) after deploy.
