# FAVOR — Google Play console declarations (source of truth)

Every answer below is deliberately the SAME answer the shipped Apple listing gives (iOS 1.0
APPROVED and live), so the two stores cannot contradict each other. Apple's answers live in
`shell/store/favor_store.py` (age-rating axes, categories, FREE pricing, URLs) and the
privacy policy (https://playfavor.net/privacy.html) is the truth behind the data answers.
⚠ Apple's App Privacy label itself was set in the ASC web UI (not API-readable) — when the
Play console session runs, eyeball the published label once and confirm it matches the
"mirror check" line below before submitting.

## Data safety form

The truth behind every answer (the privacy policy's own list): the game stores a **random
player identifier** (favorUid — not tied to name/email/real identity), the **royal alias**,
**game results** (rating, stars, wins, power, daily scores), and the chosen **crest**.
No email, no contacts, no location, no advertising identifiers, no analytics SDK, no ads,
no tracking. Leaderboards are what make this "collection" at all (Firebase, US-hosted).
The ANDROID build has no sign-in door (the stub note ships until a native Google flow is
built), so no Apple/Google identity is collected on Android — do not declare it.

| Question | Answer |
|---|---|
| Does the app collect or share user data? | **Collects: YES · Shares: NO** |
| Data types collected | **User IDs** (random favorUid + royal alias) · **App interactions** (Play's name for gameplay records: rating, stars, wins, power, daily scores, crest) |
| Purpose, both types | **App functionality** only |
| Collection required or optional? | **Required** (no account system on Android — a royal guest identity is created automatically; there is nothing to opt out of) |
| Processed ephemerally? | No |
| Data encrypted in transit? | **YES** (https only) |
| Can users request deletion? | **YES** — deletion on request via support (https://playfavor.net/support.html), and the privacy policy says so |
| Used for tracking / advertising? | **NO** — no ads, no ad SDK, no analytics SDK, no third-party sharing |

Mirror check against Apple's published label: expect `Identifiers → User ID` and
`Usage Data → Product Interaction`, App Functionality, not used for tracking. (FAVOR has no
device-ID collection — unlike GVT there is no separate device row; the uid IS the identity.)

## Content rating (IARC questionnaire)

Apple's axes (favor_store.py `cmd_agerating`, the shipped answers):
- Violence: **cartoon/fantasy violence, mild/infrequent** (painted melees) + **mild weapon
  references** (bows/daggers in card art). Everything else: none.
- Blood/gore: none. Sexual content: none. Profanity: none. Drugs/alcohol/tobacco: none.
- Gambling (simulated or real): **none**. Loot boxes: **none**.
- Digital purchases: **none in the app** (FREE, no IAP — the PayPal Mint exists only on the
  web edition and is hidden for the FavorShell-Android UA; see the README's Mint-gate note).
- User interaction: **no chat, no free-text messaging**. Royal aliases appear on shared
  leaderboards — if the form asks about "users can interact online" because of shared
  leaderboards/multiplayer, answer that honestly per the form's own language; there is
  still no messaging of any kind.
- Location sharing: none. UGC: none (aliases are game-generated or picked from game rules).
- **Expected outcome: ESRB E10+ / PEGI 7 or milder** (Apple computes 9+ from the identical
  axes). If IARC comes back stricter, an answer was entered wrong — redo the questionnaire.

## Target audience — same call as GVT, recommended and NOTED, not silently picked

**Recommendation: 13+ (tick 13–15, 16–17, 18+; no under-13 band).** Declaring children puts
the app under Play's Families policy (stricter data/content rules + its own review); FAVOR
deliberately did not enter Apple's Kids Category either. Same call, same reason, both stores.

## Everything else

| Field | Value |
|---|---|
| App name | **FAVOR: Royal Succession** (Apple's shipped name, 23/30) |
| Category | **Games → Card** (Apple: GAMES / CARD / BOARD — Play takes one category; Card is primary. If a "Board" tag is offered, add it.) |
| Price | **FREE**, no in-app purchases (the Stars economy is EARNED in-app; Stars are purchasable only on the web edition, never in this app — the Mint is UA-hidden) |
| Ads | **Contains no ads** |
| Privacy policy | **https://playfavor.net/privacy.html** (live, 200, covers "other app editions" explicitly) |
| Website | https://playfavor.net |
| Support URL/email | https://playfavor.net/support.html · gablewyatt@gmail.com (Apple review contact) |
| App access | **Full access, no credentials needed** — no login exists on Android; a royal guest identity is created on first launch |
| Application ID | com.corkscrewgames.favor · versionName 1.0 · versionCode 1 (any rebuild = versionCode 2; Play rejects reuse) |
| AAB | `shell/android/app/build/outputs/bundle/release/app-release.aab` (opt INTO Play App Signing; ours is the UPLOAD key) |
| Upload key SHA-256 | `EC:56:99:BE:81:2D:17:CE:00:DA:94:19:95:79:FF:97:BF:69:1F:9A:25:01:DA:FF:37:B2:79:CF:11:E1:68:BB` (keystore `~/.playconsole/private/favor-upload.jks`, valid to 2051-07-20 — never enters the repo) |
| ⚠ Do not touch | FAVOR iOS 1.0 (APPROVED, live) and the Steam release (Aug 12) — this listing only ADDS Android |

## Graphics inventory (this directory + Desktop)

- `icon512.png` — 512×512 32-bit RGBA PNG, from the iOS art (`tools/make_icons.py`).
- `feature1024x500.png` — 1024×500 feature graphic: the live title screen's own art
  (captured at 2048×1000, halved — the GVT method).
- Screenshots: `~/Desktop/favor-googleplay-1.0/store-shots/{phone,tablet7,tablet10}/` —
  7 shots each (Play caps at 8), phone 1920×1080 · 7" 2048×1152 · 10" 2560×1440, all 16:9,
  captured by `play_shots.mjs` under the FavorShell-Android UA (Mint hidden in every frame).
