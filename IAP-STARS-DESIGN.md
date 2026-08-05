# FAVOR — Apple Star Purchases (iOS StoreKit rail)

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
