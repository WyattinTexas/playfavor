# FAVOR Android shell

A WebView over https://playfavor.net/ — the Google Play twin of `shell/ios`
(same one-codebase pattern: every web ship updates the app instantly).
`com.corkscrewgames.favor`, versionName 1.0, versionCode 1.

## Build

```
export ANDROID_HOME=$HOME/Library/Android/sdk   # local.properties also pins it
./gradlew assembleDebug     # debuggable APK (WebView CDP enabled)
./gradlew bundleRelease     # the Play upload artifact (signed AAB)
./gradlew assembleRelease   # release APK, same signature, for device installs
```

JDK 17 (`/opt/homebrew/opt/openjdk@17`). AGP 8.7.3 / Gradle 8.9.

## Signing

Release signing reads `~/.playconsole/private/favor-upload.properties`
(storeFile / storePassword / keyAlias / keyPassword). The keystore
`favor-upload.jks` lives in the same directory. **Neither ever enters this
repo** — without the properties file the release build is unsigned, which is
the correct failure.

## ⚠ The Mint gate — the one thing that gets FAVOR rejected if it narrows

playfavor.net hides the PayPal Royal Mint for shell user agents:
`meta.js` `IOS_SHELL = /FavorShell-(iOS|Steam|Android)/` + the `.ios-shell`
body class. This shell's UA carries `FavorShell-Android/1.0`. If either side
ever stops matching the other, a Play build starts selling Stars through
PayPal — a Google Play payments-policy rejection (the same teeth as Apple
3.1.1). tools/ui-audit.mjs carries an "Android shell gate" section that
asserts the gate under this exact UA; run it before shipping either side.

## Star Shipments (Google Play Billing)

`FavorBilling.java` — the Android twin of `shell/ios/Favor/FavorIAPBridge.swift`,
on `com.android.billingclient:billing:8.3.0` (Play requires Billing 8+ from
Aug 2026).

**The handler name is the gate, and it is `favorPlay` — never `favorIAP`.**
The page lights `APPLE_IAP` off the literal string `favorIAP` (`js/meta.js`);
reusing it on Android would route Play purchases through the Apple SKU table
and the `apple_<txid>` ledger namespace. `MainActivity.installBootScript()`
declares `favorPlay` beside `favorSign` in the one `webkit.messageHandlers`
literal; billing rides its own JS interface (`FavorPlayAndroid`) so the two
rails can never cross. A build with no BillingClient must never declare the
handler — plain web, Steam and iOS stay byte-identical.

Vocabulary, both directions, complete:

| page → native | native → page (`window.FLB`) |
| --- | --- |
| `{cmd:'products'}` (also the page-ready signal) | `FLB._playProducts([{sku, price}])` |
| `{cmd:'buy', sku}` | `FLB._playTx({tx, sku})` |
| `{cmd:'ack', tx}` | `FLB._playResult({sku, state, err})` — `pending`/`cancel`/`fail` |

Four SKUs (`com.corkscrewgames.favor.stars.s|m|l|xl`). The shell knows the SKU
ids and nothing else: quantities are the page's, prices are the storefront's
(`getFormattedPrice()`).

Traps this file already pays for — read before touching it:

1. **`tx` is `getOrderId()`, never the purchaseToken.** Tokens are hundreds of
   chars with shared prefixes and page ledgers truncate; a truncation collision
   reads a fresh purchase as already-credited — an ack with no stars. Test and
   pending purchases can have no order id, so the fallback is
   `"pt_" + sha256(token)[:48]`. `unacked` keeps `tx → Purchase` so the ack
   consumes the right one.
2. **Consume only on the page's ack.** `consumeAsync` runs in `ack()` and
   nowhere else — the page acks only after the stars are confirmed on the
   Firebase wire, which is what stops a failed save from orphaning a purchase.
3. **Play auto-refunds anything unconsumed after 3 days** — unlike StoreKit,
   an unfinished purchase does not wait forever. Hence replay on every connect,
   every page-ready and every `onResume`. Re-delivery is the mechanism; the
   page ledger dedupes on `tx`.
4. **`@JavascriptInterface` runs on a binder thread.** `launchBillingFlow` hops
   to the UI thread with a live Activity; every push to JS goes through
   `webView.post(...evaluateJavascript)` with `org.json`-built payloads (a
   storefront price string is untrusted input). `onDestroy` calls
   `billing.detach()` so a late callback can't touch a dead view.
5. `ITEM_ALREADY_OWNED` is a **replay**, not a failure — telling the player it
   failed while holding their money is the worst outcome on this rail.
6. The AAR merges `com.android.vending.BILLING`, `ACCESS_NETWORK_STATE` and the
   two `ProxyBillingActivity` entries into the hand-written manifest — which is
   why that manifest still lists only INTERNET. Verify the merged manifest
   (`app/build/intermediates/merged_manifests/...`), never assume.
7. `minifyEnabled false` on release. If that ever flips, `@JavascriptInterface`
   methods need explicit keep rules or the bridge silently disappears.

## The four load-bearing WebView settings

Each of these is a silent total failure if missed (see MainActivity):

1. `setMediaPlaybackRequiresUserGesture(false)` — the score and stingers
   would ship a silent table under default WebView policy.
2. `setDomStorageEnabled(true)` — localStorage IS the save.
3. `setJavaScriptEnabled(true)` — the whole game is JS.
4. Hardware acceleration (manifest `android:hardwareAccelerated="true"`) — or
   the animations crawl.

Plus `setTextZoom(100)` — the system font scale multiplies WebView text
(WKWebView never does); a 130% accessibility setting must not break the table.

## Account persistence (the Keychain heal, Android edition)

The page's own `shellPersistUid()` posts `{cmd:'keychain_uid', uid}` through
`webkit.messageHandlers.favorSign` — this shell shims that handler into a JS
bridge (`FavorShellAndroid`) and stores the uid in SharedPreferences
(`allowBackup=true`, so Auto Backup restores it across reinstalls). A
documentStart script (origin-locked to playfavor.net) heals
`localStorage.favorUid` from prefs BEFORE page JS runs. `__FAVORSHELL`
{platform:'android'} is injected so the page's bridge check passes; the
sign-in door stays the honest Android stub note (it is UA-routed, not
bridge-routed).

## Icon

`store/icon512.png` is the Play Console master. The adaptive icon layers are
generated from the iOS asset (`shell/ios/.../icon1024.png`) by
`tools/make_icons.py` — rerun it if the iOS art ever changes.
