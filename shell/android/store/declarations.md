# FAVOR — Google Play console declarations (source of truth)

Every answer below is deliberately the SAME answer the shipped Apple listing gives (iOS 1.0
APPROVED and live), so the two stores cannot contradict each other. Apple's answers live in
`shell/store/favor_store.py` (age-rating axes, categories, FREE pricing, URLs) and the
privacy policy (https://playfavor.net/privacy.html) is the truth behind the data answers.
⚠ Apple's App Privacy label itself was set in the ASC web UI (not API-readable) — when the
Play console session runs, eyeball the published label once and confirm it matches the
"mirror check" line below before submitting.

**This document is STAGING, not a Console readout.** Nothing below has been entered or
confirmed in Play Console by the session that wrote it. Every ✚ NEW row is a change to make;
every unmarked row is the answer the pre-billing listing already carried. If a Console screen
disagrees with a line here, the Console wins and this file is what gets corrected.

## ✚ What the billing build changes (read this first)

The Android build now sells Stars through Google Play Billing (four consumable star packs,
$3.99–$39.99). That is a **new fact about the app**, so three separate Console surfaces have
to change — they are not derived from each other:

| Surface | Old answer | ✚ New answer |
|---|---|---|
| IARC content rating → digital purchases | none in the app | **YES — the app offers digital goods for real money** (re-take the questionnaire; it reissues the certificate) |
| Store listing → in-app purchases flag | no IAP | **Contains in-app purchases**, price range **$3.99 – $39.99 per item** |
| Data safety → Financial info | not collected | **Purchase history: collected, not shared** (the RTDB ledger, see below) |

Unchanged and deliberately so: the app is still **FREE to install**, still **no ads**, still
**no loot boxes / no randomised items** (every pack is a fixed quantity — this is the answer
that keeps the ESRB descriptor plain "In-App Purchases" rather than "Includes Random Items"),
still no gambling, still 13+, still no chat.

Gates that live outside this file, and were NOT verified by the session that wrote it:
- A **Play payments profile / merchant account must be active** before in-app products can be
  created at all. Confirm in Console before promising a date. (Apple's equivalent — the Paid
  Apps agreement — is the same open gate on the iOS side; see `IAP-STARS-DESIGN.md`.)
- The four products must exist and be **Active** in Console before the build can price
  anything. The page never hardcodes a price, so an inactive product renders a dead
  `UNAVAILABLE` card rather than a wrong number — visible, not silent.
- The billing AAB must carry **versionCode 2**. vc1 is burned on the live 1.0; Play rejects
  reuse outright.

## In-app products (four, all CONSUMABLE)

Ids and quantities mirror the Apple catalogue exactly — one brain for "what a pack IS"
(`js/meta.js` PLAY_PACKS is byte-identical to APPLE_PACKS). Prices live in Play Console
ONLY: the page renders the storefront's own formatted price string, because a hardcoded
dollar string is a lie in every other currency and Play shows local tax-inclusive prices the
page cannot compute.

| Product ID | Name | Stars | USD base price | Type |
|---|---|---|---|---|
| `com.corkscrewgames.favor.stars.s` | Pouch of Stars | 50 | $3.99 | Consumable |
| `com.corkscrewgames.favor.stars.m` | Purse of Stars | 100 | $5.99 | Consumable |
| `com.corkscrewgames.favor.stars.l` | Chest of Stars | 500 | $24.99 | Consumable |
| `com.corkscrewgames.favor.stars.xl` | Royal Treasury | 1000 | $39.99 | Consumable |

en-US localization only, matching the listing. All territories at Play's converted prices.

⚠ CONSUMABLE is the only correct type: Stars are spent. A managed/non-consumable product
cannot be re-bought, which would make the second purchase fail forever.

⚠ Stars bought on Android land on the SAME `favorUid` account as the web and iOS editions
(server truth in RTDB). The store listing must not imply Android-only currency.

## Data safety form

The truth behind every answer (the privacy policy's own list): the game stores a **random
player identifier** (favorUid — not tied to name/email/real identity), the **royal alias**,
**game results** (rating, stars, wins, power, daily scores), and the chosen **crest**.
No email, no contacts, no location, no advertising identifiers, no analytics SDK, no ads,
no tracking. Leaderboards are what make this "collection" at all (Firebase, US-hosted).
The ANDROID build has no sign-in door (the stub note ships until a native Google flow is
built), so no Apple/Google identity is collected on Android — do not declare it.

✚ What billing adds: on a successful purchase the page writes a **dedup ledger entry** to
`favor/players/{uid}/iap/play_<tx>` = `{sku, stars, at}` and a bookkeeping mirror to
`favor/purchases/play_<tx>` = `{uid, sku, stars, at, via:'play'}`. That is a record of a
transaction stored on our server, which is Google's own definition of **Purchase history**
under Financial info — so it gets declared. What is NOT collected, and must not be declared:
no payment card, no billing address, no Google account identity, no `purchaseToken`. Google
takes the money and tells us an order id; we never see an instrument.

| Question | Answer |
|---|---|
| Does the app collect or share user data? | **Collects: YES · Shares: NO** |
| Data types collected | **User IDs** (random favorUid + royal alias) · **App interactions** (Play's name for gameplay records: rating, stars, wins, power, daily scores, crest) · ✚ **Financial info → Purchase history** (sku + star quantity + timestamp + order id, keyed to the random favorUid) |
| Purpose, all types | **App functionality** only (purchase history's purpose is delivering the Stars and refusing to deliver them twice — nothing else reads it) |
| Collection required or optional? | **Required** for User IDs / App interactions (no account system on Android — a royal guest identity is created automatically; there is nothing to opt out of) · ✚ **Optional** for Purchase history — a player who never buys generates no record at all |
| Processed ephemerally? | No |
| Data encrypted in transit? | **YES** (https only) |
| Can users request deletion? | **YES** — deletion on request via support (https://playfavor.net/support.html), and the privacy policy says so |
| Used for tracking / advertising? | **NO** — no ads, no ad SDK, no analytics SDK, no third-party sharing |

⚠ Before submitting, confirm the **privacy policy actually mentions purchase records**. The
data-safety form is checked against the policy, and today's policy was written for a build
with no purchases. If it does not cover them, the policy gets updated first — a mismatch is
a rejection, and it is a five-minute fix made in the wrong order.

Mirror check against Apple's published label: expect `Identifiers → User ID` and
`Usage Data → Product Interaction`, App Functionality, not used for tracking. (FAVOR has no
device-ID collection — unlike GVT there is no separate device row; the uid IS the identity.)
✚ Apple's label needs the same Purchase-history addition on its next pass — the iOS build
took StoreKit in 1.0(21) and writes the identical ledger under `apple_<txid>`. Out of scope
for this file; noted so the two labels do not drift.

## Content rating (IARC questionnaire) — ✚ MUST BE RE-TAKEN

Changing the digital-purchases answer invalidates the existing certificate; IARC reissues.
Answer everything else exactly as before so only the purchase axis moves.

Apple's axes (favor_store.py `cmd_agerating`, the shipped answers):
- Violence: **cartoon/fantasy violence, mild/infrequent** (painted melees) + **mild weapon
  references** (bows/daggers in card art). Everything else: none.
- Blood/gore: none. Sexual content: none. Profanity: none. Drugs/alcohol/tobacco: none.
- Gambling (simulated or real): **none**.
- ✚ **Digital purchases: YES** — the app sells four consumable star packs for real money,
  $3.99–$39.99. Stars buy heroes, table skins and cosmetic entries from a fixed shelf; the
  player always sees exactly what they get before paying.
- ✚ **Loot boxes / randomised purchases: still NONE.** Every pack is a fixed star count and
  every shelf item has a fixed price. This is the answer that keeps the descriptor plain
  "In-App Purchases"; answering it wrong adds "Includes Random Items" and invites a
  gambling-adjacent review that FAVOR has no reason to attract.
- ✚ Purchased Stars are **not tradeable, not cashable, not transferable** between players —
  if the questionnaire asks whether purchased currency can be exchanged with other users or
  for real value, the answer is no.
- User interaction: **no chat, no free-text messaging**. Royal aliases appear on shared
  leaderboards — if the form asks about "users can interact online" because of shared
  leaderboards/multiplayer, answer that honestly per the form's own language; there is
  still no messaging of any kind.
- Location sharing: none. UGC: none (aliases are game-generated or picked from game rules).
- **Expected outcome: unchanged — ESRB E10+ / PEGI 7 or milder**, now carrying the ESRB
  interactive element **"In-App Purchases"**. IAP presence adds a descriptor, it does not
  raise an age band. If IARC comes back with a HIGHER age than the pre-billing certificate,
  an answer was entered wrong — most likely the loot-box or gambling axis. Redo it.

## Target audience — same call as GVT, recommended and NOTED, not silently picked

**Recommendation: 13+ (tick 13–15, 16–17, 18+; no under-13 band).** Declaring children puts
the app under Play's Families policy (stricter data/content rules + its own review); FAVOR
deliberately did not enter Apple's Kids Category either. Same call, same reason, both stores.
✚ This call matters more now, not less: Families-policy apps face extra scrutiny on paid
digital goods. The 13+ answer is the honest one and it is also the simple one.

## Everything else

| Field | Value |
|---|---|
| App name | **FAVOR: Royal Succession** (Apple's shipped name, 23/30) |
| Category | **Games → Card** (Apple: GAMES / CARD / BOARD — Play takes one category; Card is primary. If a "Board" tag is offered, add it.) |
| Price | ✚ **FREE to install, contains in-app purchases — $3.99–$39.99 per item.** Stars are still EARNED in normal play; the packs are a shortcut, never a wall. (Was: "FREE, no in-app purchases".) |
| Ads | **Contains no ads** |
| Privacy policy | **https://playfavor.net/privacy.html** (live, 200, covers "other app editions" explicitly) — ✚ see the purchase-records check in Data safety above |
| Website | https://playfavor.net |
| Support URL/email | https://playfavor.net/support.html · gablewyatt@gmail.com (Apple review contact) |
| App access | **Full access, no credentials needed** — no login exists on Android; a royal guest identity is created on first launch. ✚ Reviewers do NOT need a test account to reach the store: the ★ Purchase Stars door is on the Royal Emporium's own screen from first launch. |
| Application ID | com.corkscrewgames.favor · versionName 1.0 · ✚ **versionCode 2** (vc1 is burned on the live 1.0; Play rejects reuse) |
| AAB | `shell/android/app/build/outputs/bundle/release/app-release.aab` (opt INTO Play App Signing; ours is the UPLOAD key) |
| Upload key SHA-256 | `EC:56:99:BE:81:2D:17:CE:00:DA:94:19:95:79:FF:97:BF:69:1F:9A:25:01:DA:FF:37:B2:79:CF:11:E1:68:BB` (keystore `~/.playconsole/private/favor-upload.jks`, valid to 2051-07-20 — never enters the repo) |
| ⚠ Do not touch | FAVOR iOS 1.0 (APPROVED, live) and the Steam release — this listing only ADDS Android |

## Graphics inventory (this directory + Desktop)

- `icon512.png` — 512×512 32-bit RGBA PNG, from the iOS art (`tools/make_icons.py`).
- `feature1024x500.png` — 1024×500 feature graphic: the live title screen's own art
  (captured at 2048×1000, halved — the GVT method).
- Screenshots: `~/Desktop/favor-googleplay-1.0/store-shots/{phone,tablet7,tablet10}/` —
  7 shots each (Play caps at 8), phone 1920×1080 · 7" 2048×1152 · 10" 2560×1440, all 16:9,
  captured by `play_shots.mjs` under the FavorShell-Android UA + the shell's real
  document-start shim. No PayPal rail can reach a frame — the rig asserts it and throws.
- ✚ **Re-shoot for the billing build:** `PLAY_BILLING=1 node shell/android/store/play_shots.mjs`
  injects the `favorPlay` handler, so the Emporium frame shows the ★ Purchase Stars door the
  billing AAB really has. Shoot WITHOUT the flag if the AAB you are uploading has no billing
  bridge — a listing showing a purchase door the build lacks is a false listing.
  ⚠ No price string reaches any frame (the pack row lives inside the closed #mintPanel
  easel). Keep it that way: prices in a shot would be this rig's strings, and Play localises
  price per country.
