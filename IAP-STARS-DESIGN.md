# FAVOR — Star Purchases (iOS StoreKit rail · Google Play Billing rail)

Two storefronts, one star economy. The StoreKit rail is everything above
"Google Play Billing"; the Play rail is the section below it and reuses this document's
credit contract verbatim — only the handler name, the SKU table's home, the ledger prefix
and the consumption mechanics differ.

**Goal:** the iOS shell sells Stars through Apple's payment sheet. Today the shell hides
the PayPal Royal Mint entirely (3.1.1) and has no purchase rail at all. This ports GVT's
proven STAR SHIPMENTS pattern (0097, v1.88) onto FAVOR's server-backed star economy.

## Decisions (defaults shipped, Wyatt may veto any)

| Dial | Default | Why |
|---|---|---|
| Packs | 50 / 100 / 500 / 1000 Stars | mirror the web Mint exactly |
| Prices | $3.99 / $5.99 / $24.99 / $39.99 | nearest Apple tiers to web $4/$6/$25/$40 |
| SKUs | `com.corkscrewgames.favor.stars.s/.m/.l/.xl` | quantity-NEUTRAL (GVT R1: a quantity tweak is a display-name edit, never an id migration) |
| Names | Pouch / Purse / Chest / Royal Treasury | the Mint's own names |
| Localization | en-US only | matches the FAVOR listing |
| Type | CONSUMABLE ×4, StoreKit 2 | the only correct mechanism (PassKit = 3.1.1 rejection) |

## Architecture — what differs from GVT

GVT credits stars device-locally (META ledger). FAVOR's stars are SERVER truth
(`favor/players/{uid}/stars` in RTDB, same account as web). So the credit lands in RTDB,
with the same crash-safety law expressed differently:

**The credit contract:** one Firebase native transaction on `players/{uid}` does BOTH the
dedup-ledger check and the stars increment atomically:

```
txn(players/{uid}): p =>
  p.iap && p.iap[txKey]        → abort (already credited → RE-ACK path)
  else p.stars += pack.stars;
       p.iap[txKey] = {sku, stars, at};   // ledger capped at 100 keys, oldest dropped
       return p
```

- `txKey = apple_<StoreKit txid>`. Ledger + stars ride ONE write — no crash window can
  split them (GVT's law, RTDB shape).
- **Ack only after a fresh `dbGet(players/{uid}/iap/<txKey>)` re-reads the record off the
  wire — on BOTH paths** (fresh credit AND the already-credited re-ack).
- Offline (`mode !== 'firebase'`) at delivery time → do nothing; the bridge keeps the tx
  unacked and re-delivers on next page-ready / next launch (`Transaction.unfinished`).
- After ack (fire-and-forget, non-authoritative): mirror to `purchases/apple_<txid>`
  beside the PayPal box's records for one bookkeeping view of all money.
- Refund clawback: none (accepted GVT R4 design; Apple revokes → bridge finishes
  silently, never pushes).

## Bridge protocol (byte-compatible with GVT's, renamed)

- Page → shell: `webkit.messageHandlers.favorIAP.postMessage({cmd})` —
  `products` (also the page-ready signal) · `buy {sku}` · `ack {tx}`.
- Shell → page: `FLB._iapProducts([{sku,price}])` · `FLB._iapTx({tx,sku})` ·
  `FLB._iapResult({sku,state:cancel|pending|fail,err})`.
- **The gate is the handler, exactly:** `window.webkit?.messageHandlers?.favorIAP`.
  Builds ≤20 lack it → they keep the empty Mint row forever (no dead store on shipped
  apps — the web change is safe to deploy before the build exists). Steam/Android
  shells lack it too. Never gate on UA or `__FAVORSHELL.iap` (decoration only).

## UI

The existing `#storePacks` row renders Apple cards when the handler exists (instead of
today's `''`): same `st-pack` cards, price = storefront `displayPrice` (`···` until
products arrive, UNAVAILABLE never-arrived state disables the card — GVT R5; no
hardcoded $ strings). Tap → confirm state → `buy`. `pending` (Ask-to-Buy) shows a
"awaiting approval" note; approval arrives later via `_iapTx` like any delivery.
Celebration reuses `showStarsCelebration`; the seal nudge stays web-only (Keychain
already guards the shell). Mint/PayPal code path untouched for web.

## Shell changes (build 1.0(21))

1. `FavorIAPBridge.swift` — GVT's `IAPBridge.swift` ported: 4 SKUs, handler `favorIAP`,
   page globals `FLB.*`. Credit contract identical (unacked map, finish only on ack,
   `Transaction.unfinished` + `.updates` funnels).
2. `GameViewController.swift` — register handler, wire `webView` + `pageReady()` in
   `didFinish`, boot literal gains `iap:true` and **real** `CFBundleVersion` (today
   hardcodes `build: 18` — the GVT bug, fixed the GVT way).
3. `project.pbxproj` — add the new file beside `FavorSignBridge.swift`.
4. `Info.plist` — CFBundleVersion → 21.

## ASC

4 consumables under app 6790169069 via a repointed copy of GVT's `asc_iap.py`
(`shell/store/favor_iap.py`): create, en-US localization, USA base price (tier match),
all territories, review screenshot per IAP (sim capture at the store). Products ride the
NEXT app review with build 21 (`reviewSubmissionItems` with `inAppPurchaseV2`
relationships — GVT 0097 §8 pattern).

**Gates outside this build:** Paid Apps agreement must be Active before Apple approves
the IAPs (account-level; in progress). Sandbox works agreement-independent.

## Verification bar

- Browser battery (fake `favorIAP` handler): gate invisibility on web/Steam/Android UAs;
  cards render from pushed products; buy→tx→credit exactly once; replayed tx re-acks
  without double credit; offline delivery does NOT ack; ledger cap; hostile price string
  inert (escaped at stash).
- Sim battery (SKTestSession + `FavorStoreKit.storekit`): 4 packs credit exactly n through
  the real sheet; ack-swallowed relaunch credits ONCE (RTDB, not device, is the proof);
  interrupted → resolve → one credit; fail → clean retry; Ask-to-Buy pend → approve → one.
- Release archive: SKUs in binary, no test config inside.

---

# Google Play Billing rail (Android)

The same economy through Google Play. The credit contract above is **unchanged** — one RTDB
transaction does the dedup check and the star increment together, and the ack only fires
after the ledger entry is re-read off the wire. What follows is only what Play does
differently, and every difference below is a way to lose real money if it is guessed at.

## The handler: `favorPlay`, and why not `favorIAP`

```
window.webkit.messageHandlers.favorPlay        // the gate, exactly
```

- **The Android shell fakes `window.webkit`.** `MainActivity.installBootScript` injects
  `window.webkit={messageHandlers:{favorSign:…}}` at document start so the page's
  WKWebView-shaped posts land on an `@JavascriptInterface`. The billing handler joins that
  same object, so the address is identical on both platforms and the page's gate is one
  shape, not two.
- ⚠ **A `webkit.messageHandlers` object EXISTS on Android with no billing handler in it.**
  That is the trap GVT names at `index.html:12046`. Any gate looser than the named handler —
  `window.webkit`, the UA, `__FAVORSHELL`, a decoration flag — passes on the shipped vc1
  build and lights a store that cannot sell.
- ⚠ **Naming it `favorIAP` would be a silent disaster, not a syntax error.** It would light
  `APPLE_IAP` (`js/meta.js`), route Android through the Apple SKU table, and file every
  Android credit under the `apple_<txid>` ledger namespace in the SAME RTDB row the iOS
  build writes. The two rails must never share a namespace: order ids and StoreKit
  transaction ids come from different issuers and nothing guarantees they cannot collide.
- Builds without the handler (plain web, Steam, iOS, the shipped Android vc1) are
  byte-identical to today. The web change is safe to deploy before the billing AAB exists.

## Protocol

Page → native, complete vocabulary (identical to Apple's):
`{cmd:'products'}` (also the page-ready signal) · `{cmd:'buy', sku}` · `{cmd:'ack', tx}`.

Native → page, on `window.FLB`:

| Call | Meaning |
|---|---|
| `FLB._playProducts([{sku, price}])` | `price` is `ProductDetails.getOneTimePurchaseOfferDetails().getFormattedPrice()` — the storefront's own string, verbatim |
| `FLB._playTx({tx, sku})` | a delivered purchase → `creditPlayTx` |
| `FLB._playResult({sku, state, err})` | `state ∈ pending \| cancel \| fail` |

⚠ Native calls these three blind. A rename on the page side is not a crash — it is a
purchase that vanishes with the player's money already taken. `tools/ui-audit.mjs` asserts
all three exist under a shell UA with the handler injected.

⚠ A storefront price string is **untrusted input**. JSON pushed into `evaluateJavascript`
must be built with `org.json` and escaped, never string-concatenated from storefront text;
the page escapes again at the stash. Never hardcode a dollar string natively — it is a lie
in 174 storefronts, and Play shows local tax-inclusive prices the page cannot compute.

## The four Play SKUs

Ids and quantities mirror the Apple catalogue exactly (one brain for "what a pack IS" —
`PLAY_PACKS` in `js/meta.js` is byte-identical to `APPLE_PACKS`). Prices live in Play
Console only.

| Product ID | Name | Stars | USD base | Type |
|---|---|---|---|---|
| `com.corkscrewgames.favor.stars.s` | Pouch of Stars | 50 | $3.99 | Consumable |
| `com.corkscrewgames.favor.stars.m` | Purse of Stars | 100 | $5.99 | Consumable |
| `com.corkscrewgames.favor.stars.l` | Chest of Stars | 500 | $24.99 | Consumable |
| `com.corkscrewgames.favor.stars.xl` | Royal Treasury | 1000 | $39.99 | Consumable |

An unknown sku gets **no credit and no ack** — it stays unconsumed and Play refunds it
rather than the player being charged for nothing we can deliver.

## The `tx` identifier — the biggest landmine on this rail

**`tx` is `Purchase.getOrderId()`** (`GPA.3312-1234-5678-90123`: short, unique, issuer-owned).

- ⚠ **Never send the raw `purchaseToken` as `tx`.** Tokens are hundreds of characters with
  long shared prefixes. Anything that truncates one — and GVT's page does, at
  `String(d.tx).slice(0,64)` — can collide two purchases into one ledger key. A fresh
  purchase read as already-credited acks with no credit: money taken, nothing delivered.
- If `getOrderId()` is null or empty (pending and test purchases can be), derive a stable
  short id natively: `"pt_" + sha256(purchaseToken)` hex-truncated to 48 chars.
- Native keeps a `tx -> purchaseToken` map so `ack` can consume the right purchase.

## Ledger namespace: `play_<sanitized tx>`

```
favor/players/{uid}/iap/play_<tx>   = {sku, stars, at}     ← the authority, capped at 100 keys
favor/purchases/play_<tx>           = {uid, sku, stars, at, via:'play'}   ← bookkeeping mirror
```

- Sanitizer is the Apple path's, unchanged: `String(tx).replace(/[^A-Za-z0-9_]/g, '')` —
  Firebase keys cannot hold `. # $ [ ] /`. `GPA.3312-1234-…` sanitizes to `GPA33121234…`,
  still unique.
- The `play_` prefix is what keeps the two rails from ever meeting in one row. The Apple
  path stays byte-identical; do not refactor them into a shared helper that takes a prefix
  argument — the whole value here is that neither rail can accidentally become the other.
- Same cap, same eviction (oldest `at` dropped) as Apple's.

## The consumption law: `consumeAsync` ONLY on ack

```
_playTx → RTDB txn (dedup + increment, one write)
        → dbGet(players/{uid}/iap/play_<tx>)   ← must come back OVER THE WIRE
        → {cmd:'ack', tx}
        → consumeAsync(purchaseToken)          ← and not one instruction sooner
```

- **Never consume before the page acks.** An unconsumed purchase is the only thing that
  makes a failed save recoverable: it replays and the ledger answers.
- The ack fires on **both** paths — fresh credit AND already-credited re-ack. A replay that
  found the ledger entry present and stayed silent would leave the purchase unconsumed
  forever, which on Play means it gets refunded out from under a player who already has
  the Stars.
- Offline (`mode !== 'firebase'`) at delivery: do nothing. No credit, no ack. The purchase
  stays unconsumed and re-delivers.
- `PENDING` state → push `state:'pending'`, do **not** credit. Approval arrives later as a
  normal `_playTx` delivery.
- Replay is mandatory on **billing-client connect AND every page-ready**:
  `queryPurchasesAsync(INAPP)`, re-deliver every `PURCHASED` purchase that is not acked.
  Keep an in-memory `unacked` map keyed by the same `tx` string the page will ack with.

## ⚠ Play's 3-day auto-refund window — the difference that bites

**Play automatically refunds and voids any purchase not acknowledged within 3 days.**
StoreKit does not do this: an unfinished Apple transaction sits in `Transaction.unfinished`
forever and replays whenever the app next launches.

What that changes:

- The replay path is not a nicety, it is the thing standing between a player and a
  silently-cancelled purchase. A device that buys, fails to save, and does not reconnect
  within 3 days loses the purchase — Play gives the money back, so nobody is robbed, but
  the Stars never arrive and the player will not know why.
- **Do not try to defeat the window.** The only "fix" available is acking before the credit
  is confirmed on the wire, which trades a refunded purchase for a stolen one. The window
  is the correct failure mode: unconfirmed money goes back.
- Acknowledgement here means the `consumeAsync` call — for consumables, consuming
  acknowledges. There is no separate `acknowledgePurchase` step to forget.
- Practically: the page-ready replay means an app opened at any point inside 3 days
  recovers. Nothing to build beyond doing the replay honestly.

## Native shape (neither shell has async native→JS today)

`implementation 'com.android.billingclient:billing:8.3.0'` (Play's 8+ minimum for Aug 2026).
The AAR merges `com.android.vending.BILLING` into the manifest — **verify the merged
manifest** rather than assuming; both manifests are hand-written and minimal (INTERNET only).

- ⚠ `@JavascriptInterface` methods run on a **binder thread**, not the UI thread. Every
  `launchBillingFlow` must hop to the UI thread with a live Activity (`runOnUiThread`), and
  every push back to JS must go through `webView.post(() -> webView.evaluateJavascript(…))`.
- Guard `isFinishing()` / `isDestroyed()`, and null the WebView reference in `onDestroy` so
  a late billing callback cannot touch a dead view.
- Build the `BillingClient` with `enablePendingPurchases()`; reconnect on
  `onBillingServiceDisconnected` with backoff.

## UI — and the CSS bug this rail exposed

`#storePacks` renders the same `st-pack` cards as the Apple rail, priced by
`getFormattedPrice()` (`···` until products arrive, a dead `UNAVAILABLE` card if they never
do). The Mint/PayPal code path is untouched for web.

The shells hid the whole Mint with `!important` (`css/style.css` `.ios-shell` rules), which
made the shipped iOS build's star purchases unreachable. The fix is a **positive** class:
`iap-shell`, set beside `ios-shell` when `APPLE_IAP || PLAY_IAP`, with CSS that re-shows
`.st-stars-btn`, `.st-mint` and `#mintPanel.active` only under `body.ios-shell.iap-shell`.

- The `.ios-shell` rules are **not** removed or weakened. They are what keeps the PayPal
  Mint hidden inside shells, and un-hiding PayPal in a Play app is a payments-policy
  rejection with the same teeth as Apple 3.1.1.
- `.mint-link` (the menu ★ Get Stars door) stays hidden even under `iap-shell`. A shell's
  only door is the in-store ★ Purchase Stars button.
- The fix is inert on every build without a billing handler.

## Verification bar (Play rail)

- `tools/ui-audit.mjs` — the Android shell gate, both states: shell UA with **no** handler
  sells nothing (byte-identical to shipped vc1), shell UA **with** `favorPlay` restores the
  door, the easel and the row at their measured plain-web display values, renders the four
  Play SKUs, exposes all three `FLB._play*` calls, posts `{cmd:'products'}` on boot, and
  survives a hostile storefront price. The PayPal guard runs in **both** states.
- `shell/android/store/play_shots.mjs` — same two states behind `PLAY_BILLING=1`; throws
  rather than shooting a frame if a PayPal rail rendered or if the gate widened past the
  handler.
- Device battery (licence-tester account, internal track): 4 packs credit exactly n;
  ack-swallowed relaunch credits ONCE (RTDB, not the device, is the proof); killed mid-flow
  → replay on next launch → one credit; PENDING → approve → one credit; unknown sku →
  no credit, no ack.
- Store paperwork: `shell/android/store/declarations.md` (IARC digital-purchases answer,
  the in-app-purchases listing flag, Data safety → Purchase history).
