package com.corkscrewgames.favor;

// FAVOR — Google Play Star Shipments bridge. The Android twin of
// shell/ios/Favor/FavorIAPBridge.swift: same contract, worn Play's way. The
// page posts {cmd:...} on webkit.messageHandlers.favorPlay and everything
// returns through FLB._playProducts / _playTx / _playResult.
//
// ⚠ The handler is favorPlay, NOT favorIAP. The page lights APPLE_IAP off the
// literal name `favorIAP` (js/meta.js:3043); reusing it here would route
// Android through the Apple SKU table and the apple_<txid> ledger namespace.
// The handler name IS the gate — nothing here may key off the UA or
// __FAVORSHELL, and a shell without this bridge must look exactly like plain
// web.
//
// The shell knows the four SKUs and NOTHING about quantities or prices: packs
// are the page's business and money display is the storefront's.
//
// Threading law (this is where Android differs from WKWebView):
//   - @JavascriptInterface lands on a binder thread, never the UI thread, so
//     launchBillingFlow hops through act.runOnUiThread with a live Activity.
//   - Billing callbacks arrive on the library's own threads, so every push to
//     JS goes through webView.post(...evaluateJavascript). Nothing here
//     touches the WebView inline.
//   - detach() (MainActivity.onDestroy) nulls the WebView, so a billing
//     callback that lands after the Activity is gone hits a no-op.
//
// The credit contract (the part that matters): a PURCHASED purchase is pushed
// to the page and held in `unacked`; consumeAsync runs ONLY when the page
// answers {cmd:'ack'} — which it does only after the star credit is confirmed
// on the Firebase wire. Anything left unconsumed by an earlier run replays
// through queryPurchasesAsync on every connect, every page-ready and every
// resume. Re-delivery is the mechanism, not a bug: the page ledger dedupes
// on tx.
//
// ⚠ Play is not StoreKit. An unconsumed/unacknowledged purchase is
// AUTO-REFUNDED by Google after 3 days — an unfinished transaction does NOT
// sit forever waiting for the page to come back. Do not try to defeat that;
// just never lose the replay.

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import org.json.JSONArray;
import org.json.JSONObject;

import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

final class FavorBilling implements PurchasesUpdatedListener {

    // Prices live in Play and quantities live in the page. Never hardcode
    // either here — this list is the only product knowledge the shell has.
    private static final String[] SKUS = {
            "com.corkscrewgames.favor.stars.s",
            "com.corkscrewgames.favor.stars.m",
            "com.corkscrewgames.favor.stars.l",
            "com.corkscrewgames.favor.stars.xl",
    };

    private final Activity act;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final BillingClient client;

    private volatile WebView webView;                 // nulled by detach()
    private volatile boolean dead;                    // Activity gone
    private volatile boolean connecting;              // one startConnection at a time
    private volatile boolean pageAsked;               // page has asked for products at least once
    private volatile boolean buying;                  // one payment sheet at a time
    private volatile String buyingSku = "";           // the sku onPurchasesUpdated is answering
    // Reconnect backoff. Doubled on main, reset from a billing callback thread,
    // so volatile: a long is not atomic on 32-bit ABIs and Play still ships x86.
    private volatile long retryMs = 1000L;

    // sku → details, written on billing threads and read on the UI thread.
    private final Map<String, ProductDetails> products = new ConcurrentHashMap<>();
    // tx → purchase, delivered to the page and waiting for its ack. The key is
    // the SAME string the page acks with (see txId), and the value carries the
    // purchaseToken consumeAsync needs.
    private final Map<String, Purchase> unacked = new ConcurrentHashMap<>();

    FavorBilling(Activity act, WebView webView) {
        this.act = act;
        this.webView = webView;
        // enablePendingPurchases(PendingPurchasesParams) is mandatory since
        // Billing 7 — the old no-arg overload is gone. Pending one-time
        // products are real on Play (cash/carrier flows), so they must be
        // enabled and then handled, not wished away.
        this.client = BillingClient.newBuilder(act)
                .setListener(this)
                .enablePendingPurchases(
                        PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .build();
        connect();
    }

    // The JS side of the bridge. Registered under its own interface name so the
    // two rails can never cross: favorSign speaks {cmd:'keychain_uid'},
    // favorPlay speaks {cmd:'products'|'buy'|'ack'} — the complete vocabulary.
    final class PageBridge {
        @JavascriptInterface
        public void post(String json) {
            // Binder thread. Parse here, then hop wherever the work belongs.
            try {
                JSONObject m = new JSONObject(json);
                String cmd = m.optString("cmd");
                if ("products".equals(cmd)) {
                    // Asking for products doubles as the page's READY signal:
                    // a purchase delivered before the page could hear it goes
                    // again now.
                    pageAsked = true;
                    if (client.isReady()) {
                        queryProducts();
                        replayUnacked();
                        queryPurchases();
                    } else {
                        connect();   // products + replay fire when it lands
                    }
                } else if ("buy".equals(cmd)) {
                    startBuy(m.optString("sku"));
                } else if ("ack".equals(cmd)) {
                    ack(m.optString("tx"));
                }
                // Unknown cmds are ignored on purpose.
            } catch (Exception ignored) {
            }
        }
    }

    PageBridge pageBridge() {
        return new PageBridge();
    }

    // ---- connection -------------------------------------------------------

    private void connect() {
        if (dead || connecting || client.isReady()) return;
        connecting = true;
        try {
            client.startConnection(new BillingClientStateListener() {
                @Override
                public void onBillingSetupFinished(BillingResult r) {
                    connecting = false;
                    if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                        retryMs = 1000L;
                        if (pageAsked) queryProducts();
                        // The replay law: every connect re-offers whatever Play
                        // still says we own but never consumed.
                        queryPurchases();
                    } else {
                        // BILLING_UNAVAILABLE (no Play services, or a device
                        // Play won't sell to) is effectively permanent: the
                        // page just never receives products and keeps its store
                        // shut. Back off anyway rather than hammer the service.
                        scheduleReconnect();
                    }
                }

                @Override
                public void onBillingServiceDisconnected() {
                    connecting = false;
                    scheduleReconnect();
                }
            });
        } catch (Exception e) {
            connecting = false;
            scheduleReconnect();
        }
    }

    private void scheduleReconnect() {
        if (dead) return;
        main.post(() -> {
            if (dead) return;
            long wait = retryMs;
            retryMs = Math.min(retryMs * 2, 30000L);
            main.postDelayed(this::connect, wait);
        });
    }

    // MainActivity.onResume. A purchase that was PENDING when the user left
    // (or one Play settled while we were backgrounded) is only ever heard about
    // through a query — and the 3-day auto-refund clock is already running.
    void resume() {
        if (dead) return;
        // We are on top again, so no Play sheet is in front of us. If a flow
        // ever ends without onPurchasesUpdated (process trimmed behind the
        // sheet, ProxyBillingActivity torn down), a stuck guard would shut the
        // store for the rest of the session — the page busy-guards too, so
        // clearing here is the cheaper mistake.
        buying = false;
        if (client.isReady()) {
            replayUnacked();
            queryPurchases();
        } else {
            connect();
        }
    }

    void detach() {
        dead = true;
        webView = null;          // a late billing callback must not touch a dead view
        main.removeCallbacksAndMessages(null);
        try {
            client.endConnection();
        } catch (Exception ignored) {
        }
    }

    // ---- products ---------------------------------------------------------

    private void queryProducts() {
        List<QueryProductDetailsParams.Product> list = new ArrayList<>();
        for (String sku : SKUS) {
            list.add(QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(sku)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build());
        }
        client.queryProductDetailsAsync(
                QueryProductDetailsParams.newBuilder().setProductList(list).build(),
                (result, details) -> {
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK
                            || details == null) {
                        return;   // no push: the page keeps its store closed
                    }
                    JSONArray arr = new JSONArray();
                    for (ProductDetails p : details.getProductDetailsList()) {
                        ProductDetails.OneTimePurchaseOfferDetails offer = offerOf(p);
                        if (offer == null) continue;      // no price = not sellable here
                        products.put(p.getProductId(), p);
                        try {
                            JSONObject o = new JSONObject();
                            o.put("sku", p.getProductId());
                            // The storefront's OWN formatted string, currency
                            // and all. The page escapes and truncates it; we
                            // still never concatenate it into JS by hand — a
                            // price string is untrusted input.
                            o.put("price", offer.getFormattedPrice());
                            arr.put(o);
                        } catch (Exception ignored) {
                        }
                    }
                    send("_playProducts", arr.toString());
                    replayUnacked();
                });
    }

    // Billing 8 moved one-time products to a LIST of offers (purchase options).
    // Legacy products still answer the singular getter; products configured the
    // new way only appear in the list. Take whichever exists.
    private static ProductDetails.OneTimePurchaseOfferDetails offerOf(ProductDetails p) {
        ProductDetails.OneTimePurchaseOfferDetails one = p.getOneTimePurchaseOfferDetails();
        if (one != null) return one;
        List<ProductDetails.OneTimePurchaseOfferDetails> many =
                p.getOneTimePurchaseOfferDetailsList();
        return (many != null && !many.isEmpty()) ? many.get(0) : null;
    }

    // ---- buying -----------------------------------------------------------

    private void startBuy(String sku) {
        if (sku == null || sku.isEmpty()) return;
        if (buying) return;                                  // the page busy-guards too
        final ProductDetails details = products.get(sku);
        if (details == null || dead) {
            sendResult(sku, "fail", "no product");
            return;
        }
        buying = true;
        buyingSku = sku;
        // launchBillingFlow MUST be called on the UI thread with a live
        // Activity — we arrive here on a binder thread.
        act.runOnUiThread(() -> {
            if (dead || act.isFinishing() || act.isDestroyed()) {
                buying = false;
                return;
            }
            BillingFlowParams.ProductDetailsParams.Builder pdp =
                    BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(details);
            // Offer tokens are required for purchase-option products and empty
            // for legacy one-time products; sending an empty one is a
            // DEVELOPER_ERROR, so only set it when Play actually gave us one.
            ProductDetails.OneTimePurchaseOfferDetails offer = offerOf(details);
            String token = (offer == null) ? null : offer.getOfferToken();
            if (token != null && !token.isEmpty()) pdp.setOfferToken(token);

            BillingResult r;
            try {
                r = client.launchBillingFlow(act, BillingFlowParams.newBuilder()
                        .setProductDetailsParamsList(Collections.singletonList(pdp.build()))
                        .build());
            } catch (Exception e) {
                buying = false;
                sendResult(sku, "fail", String.valueOf(e.getMessage()));
                return;
            }
            if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                // The sheet never opened, so onPurchasesUpdated will not fire:
                // close the flow out here or the page waits forever.
                buying = false;
                if (r.getResponseCode() == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
                    queryPurchases();   // an unconsumed purchase — replay, don't fail
                } else {
                    sendResult(sku, "fail", errText(r));
                }
            }
        });
    }

    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        buying = false;
        String sku = buyingSku;
        int code = result.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase p : purchases) deliver(p);
        } else if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            sendResult(sku, "cancel", "");
        } else if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            // Bought earlier, never consumed (a save that failed, or a crash
            // between credit and ack). The replay credits it; a 'fail' here
            // would tell the player their money vanished.
            queryPurchases();
        } else {
            sendResult(sku, "fail", errText(result));
        }
    }

    // ---- delivery, replay, consumption ------------------------------------

    private void queryPurchases() {
        if (dead || !client.isReady()) return;
        client.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder()
                        .setProductType(BillingClient.ProductType.INAPP).build(),
                (result, purchases) -> {
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK
                            || purchases == null) return;
                    for (Purchase p : purchases) deliver(p);
                });
    }

    // Everything funnels through here — fresh purchase, replay, pending
    // settlement. The page ledger dedupes on tx, so double delivery is safe
    // and losing a delivery is not.
    private void deliver(Purchase p) {
        String sku = p.getProducts().isEmpty() ? "" : p.getProducts().get(0);
        if (p.getPurchaseState() == Purchase.PurchaseState.PENDING) {
            // Money not taken yet. Tell the page so it can say so, and credit
            // NOTHING. Play delivers the settled purchase later, through
            // onPurchasesUpdated or the next query.
            sendResult(sku, "pending", "");
            return;
        }
        if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) return;
        String tx = txId(p);
        if (tx == null) return;
        unacked.put(tx, p);
        sendTx(tx, sku);
    }

    // The page (re)loaded, or products came back — re-offer everything still
    // waiting for its ack.
    private void replayUnacked() {
        for (Map.Entry<String, Purchase> e : unacked.entrySet()) {
            Purchase p = e.getValue();
            sendTx(e.getKey(), p.getProducts().isEmpty() ? "" : p.getProducts().get(0));
        }
    }

    private void ack(String tx) {
        if (tx == null || tx.isEmpty()) return;
        // Double-ack is a no-op: the map only ever holds a purchase once.
        final Purchase p = unacked.remove(tx);
        if (p == null) return;
        // Consuming is the acknowledgement AND what makes the pack buyable
        // again. It happens ONLY here, after the page has confirmed the stars
        // landed on the wire — that is what stops a failed save from orphaning
        // a purchase.
        client.consumeAsync(
                ConsumeParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(),
                (result, token) -> {
                    int code = result.getResponseCode();
                    if (code == BillingClient.BillingResponseCode.OK) return;
                    // ⚠ ITEM_NOT_OWNED (8) is a SUCCESS in disguise: Play no
                    // longer holds this purchase. The consume landed and only
                    // its callback went astray, or a duplicate consume already
                    // took it, or the 3-day auto-refund reclaimed it. Either
                    // way the token is gone and no future consume can ever
                    // return OK — re-pinning it would re-offer it on every
                    // replay, so each resume would credit (page dedupes), ack,
                    // fail, re-pin: an endless ack/consume loop for a purchase
                    // that no longer exists. Terminal, so let it go.
                    if (code == BillingClient.BillingResponseCode.ITEM_NOT_OWNED) return;
                    // Everything else (NETWORK_ERROR, SERVICE_DISCONNECTED,
                    // ERROR) is retryable and it is still owned as far as Play
                    // is concerned. Put it back so the next replay re-offers
                    // it; the page dedupes the credit and acks again. (3-day
                    // auto-refund clock is ticking — a failed consume is not a
                    // place to rest.)
                    unacked.put(tx, p);
                });
    }

    // The tx identifier — the biggest landmine on this rail.
    //
    // Play purchaseTokens run to hundreds of characters with long shared
    // prefixes, and page ledgers truncate (GVT slices to 64). Truncated tokens
    // can COLLIDE, and a collision reads a fresh purchase as already-credited:
    // an ack with no stars, i.e. stolen money. So tx is the ORDER id
    // (GPA.3312-1234-5678-90123 — short, unique, and survives sanitizing to
    // FAVOR's play_<tx> ledger key). Test and pending purchases can have no
    // order id, so fall back to a stable hash of the token. The raw
    // purchaseToken is NEVER sent as tx; unacked keeps the mapping so ack
    // consumes the right purchase.
    private static String txId(Purchase p) {
        String order = p.getOrderId();
        if (order != null && !order.trim().isEmpty()) return order.trim();
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] h = md.digest(p.getPurchaseToken().getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder(h.length * 2);
            for (byte b : h) sb.append(Character.forDigit((b >> 4) & 0xF, 16))
                    .append(Character.forDigit(b & 0xF, 16));
            // 48 hex chars + "pt_" = 51, comfortably inside every page-side
            // truncation and still collision-proof.
            return "pt_" + sb.substring(0, 48);
        } catch (Exception e) {
            return null;    // no id we can trust = no delivery; the replay retries
        }
    }

    // ---- pushes to the page ----------------------------------------------

    private void sendTx(String tx, String sku) {
        try {
            JSONObject o = new JSONObject();
            o.put("tx", tx);
            o.put("sku", sku);
            send("_playTx", o.toString());
        } catch (Exception ignored) {
        }
    }

    private void sendResult(String sku, String state, String err) {
        try {
            JSONObject o = new JSONObject();
            o.put("sku", sku == null ? "" : sku);
            o.put("state", state);
            o.put("err", err == null ? "" : err);
            send("_playResult", o.toString());
        } catch (Exception ignored) {
        }
    }

    private static String errText(BillingResult r) {
        String d = r.getDebugMessage();
        String s = r.getResponseCode() + (d == null || d.isEmpty() ? "" : " " + d);
        return s.length() > 120 ? s.substring(0, 120) : s;
    }

    // Payloads are built by org.json and escaped — never string-concatenated
    // from storefront text.
    private void send(String fn, String payload) {
        if (dead) return;
        final WebView w = webView;
        if (w == null) return;
        final String js = "window.FLB && FLB." + fn + " && FLB." + fn + "(" + jsSafe(payload) + ");";
        // Billing callbacks arrive on their own threads; a WebView may only be
        // touched on the thread that made it.
        w.post(() -> {
            WebView live = webView;      // re-read: detach() may have run in between
            if (live == null) return;
            try {
                live.evaluateJavascript(js, null);
            } catch (Exception ignored) {
            }
        });
    }

    // org.json emits U+2028/U+2029 raw. They are legal JSON but were line
    // terminators in JS source before ES2019, and this string is going into
    // evaluateJavascript as source. A storefront price is untrusted input.
    private static String jsSafe(String json) {
        return json.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
    }
}
