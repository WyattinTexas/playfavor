package com.corkscrewgames.favor;

// FAVOR — Android shell. The whole app: playfavor.net full-bleed in a WebView
// (same one-codebase pattern as shell/ios and shell/steam: every web ship
// updates the app instantly, no review needed).
//
// - UA carries "FavorShell-Android" — the site hides the PayPal Royal Mint
//   for shell UAs (meta.js IOS_SHELL gate, widened for Android the day this
//   shell was built). Google Play's payments policy forbids an external
//   purchase rail for digital goods exactly as Apple 3.1.1 does; the shell
//   MUST NOT ship without the live site matching this UA.
// - domStorageEnabled: localStorage IS the save — favorUid, alias, crest,
//   owned heroes, queue choice all live there.
// - mediaPlaybackRequiresUserGesture(false): the score and stingers play
//   through web audio; default WebView policy would ship a silent table.
// - Links leaving playfavor.net open in the system browser.
// - Network failure shows a native parchment-dark retry screen instead of
//   the WebView error page (same copy as the iOS shell).
// - __FAVORSHELL {platform:'android'} IS injected (unlike GVT's shell):
//   FAVOR's page only uses it to reach the favorSign bridge, and the
//   sign-in door is UA-routed (meta.js SIGN_PROVIDER), so the Android
//   shell shows its honest stub note while the page's own
//   shellPersistUid() posts keychain_uid through the shim below — that
//   is what makes the account survive a reinstall via Auto Backup.
// - Star Shipments ride webkit.messageHandlers.favorPlay (see FavorBilling).
//   The handler name IS the gate the page checks — deliberately NOT favorIAP,
//   which is Apple's. Nothing about billing may key off the UA. The rail is
//   wired only where the shim is guaranteed to beat the page's own scripts, and
//   the shim's allow-list must cover every host the shell keeps in the WebView
//   — both laws live in installBootScript() with the money reasoning spelled out.

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

public class MainActivity extends Activity {

    private static final String TAG = "FavorShell";
    private static final String GAME_URL = "https://playfavor.net/";
    private static final String GAME_HOST = "playfavor.net";
    private static final int BG = Color.rgb(0x1D, 0x11, 0x06);

    private WebView webView;
    private FrameLayout root;
    private View retryOverlay;
    private SharedPreferences prefs;
    private FavorBilling billing;
    private boolean loadFailed;
    // Fallback boot script for WebViews too old for DOCUMENT_START_SCRIPT.
    private String pendingBootScript;
    // True when the shim is GUARANTEED to run before any page script, which is
    // the only condition under which the Play rail may exist at all. See
    // installBootScript().
    private boolean playWired;
    // Cleared only if this WebView refuses the wildcard origin rule; isGameHost()
    // then narrows to the exact apex so the WebView can never hold an origin the
    // shim does not cover. That pairing is the whole point — see isGameHost().
    private boolean shimCoversSubdomains = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("favor_shell", MODE_PRIVATE);

        // A card table never sleeps mid-game (iOS: isIdleTimerDisabled).
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Full-bleed into the notch, matching the page's viewport-fit=cover.
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        getWindow().setAttributes(lp);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        setContentView(root);

        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        // The system font scale multiplies WebView text by default; WKWebView
        // never does. A 130% accessibility setting must not break the table.
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " FavorShell-Android/1.0");

        webView.setBackgroundColor(BG);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView.addJavascriptInterface(new ShellBridge(), "FavorShellAndroid");
        // ⚠ Money gate. The Play rail is wired ONLY when the shim is a promise
        // and not a race — i.e. when DOCUMENT_START_SCRIPT exists. Fail closed;
        // the reasoning is written out in full at installBootScript().
        playWired = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        if (playWired) {
            // Billing gets its own JS interface so the two rails can never
            // cross: FavorShellAndroid speaks {cmd:'keychain_uid'},
            // FavorPlayAndroid speaks {cmd:'products'|'buy'|'ack'}.
            billing = new FavorBilling(this, webView);
            webView.addJavascriptInterface(billing.pageBridge(), "FavorPlayAndroid");
        } else {
            // Loud in logcat because the alternative is a store that silently
            // never appears. No BillingClient is even constructed, so nothing
            // can be bought and nothing can be consumed uncredited.
            android.content.pm.PackageInfo wv = WebViewCompat.getCurrentWebViewPackage(this);
            Log.w(TAG, "DOCUMENT_START_SCRIPT unsupported — Star Shipments DISABLED "
                    + "(shim cannot be guaranteed ahead of page scripts). WebView="
                    + (wv == null ? "unknown" : wv.packageName + " " + wv.versionName));
        }
        installBootScript();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (request.isForMainFrame() && url != null && url.getHost() != null
                        && !isGameHost(url.getHost())) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, url));
                    } catch (Exception ignored) {
                    }
                    return true;
                }
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                loadFailed = false;
                // Fallback shim only (installBootScript). Unlike the
                // document-start path this injection carries NO origin
                // allow-list of its own, so gate it by hand on the same hosts:
                // the favorUid heal must never be written into a stranger's
                // origin, and http:// must never see it either.
                if (pendingBootScript != null && url != null) {
                    Uri u = Uri.parse(url);
                    if ("https".equalsIgnoreCase(u.getScheme())
                            && u.getHost() != null && isGameHost(u.getHost())) {
                        view.evaluateJavascript(pendingBootScript, null);
                    }
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                CharSequence d = error.getDescription();
                if (d != null && d.toString().contains("ERR_ABORTED")) return;
                loadFailed = true;
                showRetry();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!loadFailed && retryOverlay != null) {
                    root.removeView(retryOverlay);
                    retryOverlay = null;
                }
                // Belt and braces for the reinstall heal: whatever uid the
                // save holds right now is mirrored into prefs on every load
                // (the page's own boot() also posts it via shellPersistUid).
                view.evaluateJavascript(
                        "try{var u=localStorage.getItem('favorUid');"
                                + "if(u)FavorShellAndroid.post(JSON.stringify("
                                + "{cmd:'keychain_uid',uid:u}))}catch(e){}",
                        null);
            }
        });

        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        webView.loadUrl(GAME_URL);
    }

    // The table stays in the shell; playfavor.net and its subdomains are home.
    //
    // ⚠ INVARIANT: every origin this admits must be an origin the boot shim
    // covers (installBootScript's allow-list). A host that loads in place with
    // no shim is a page with no window.webkit — PLAY_IAP false, store shut, and
    // any purchase sitting in FavorBilling.unacked can never be credited or
    // acked, so it rides the 3-day clock into an auto-refund with the player
    // holding nothing. The two lists are widened together on purpose;
    // shimCoversSubdomains is the escape hatch if the allow-list ever comes back
    // narrower than this predicate (see installBootScript).
    private boolean isGameHost(String host) {
        if (host.equalsIgnoreCase(GAME_HOST)) return true;
        return shimCoversSubdomains && host.toLowerCase().endsWith("." + GAME_HOST);
    }

    // The page heals favorUid from the shell store BEFORE any page script runs
    // (the iOS Keychain heal, rebuilt on SharedPreferences + Auto Backup), and
    // its favorSign posts (written for WKWebView) land here through the shim.
    private void installBootScript() {
        String kc = prefs.getString("favorUid", "");
        if (!kc.matches("[A-Za-z0-9]{1,64}")) kc = "";
        // Both handlers live in ONE messageHandlers literal. The page gates on
        // the presence of a named handler and nothing else, so favorPlay must
        // exist here for the Play store rail to appear — and must never be
        // faked by a build that has no BillingClient behind it (hence playWired:
        // when the bridge is not wired, the handler is simply absent and the
        // page is plain web).
        String sign = "favorSign:{postMessage:function(m){"
                + "try{FavorShellAndroid.post(JSON.stringify(m||{}))}catch(e){}}}";
        String play = ",favorPlay:{postMessage:function(m){"
                + "try{FavorPlayAndroid.post(JSON.stringify(m||{}))}catch(e){}}}";
        String boot = "window.__FAVORSHELL={platform:'android',build:1};"
                + "window.webkit={messageHandlers:{"
                + sign
                + (playWired ? play : "")
                + "}};"
                + "try{if(!localStorage.getItem('favorUid')&&'" + kc + "'){"
                + "localStorage.setItem('favorUid','" + kc + "')}}catch(e){}";
        if (playWired) {
            // ⚠ The allow-list must cover EVERY origin shouldOverrideUrlLoading
            // keeps in the WebView (isGameHost = apex + any subdomain), or a
            // main-frame nav to https://www.playfavor.net loads in place with no
            // window.webkit at all: PLAY_IAP false, store shut, and a purchase
            // already sitting in FavorBilling.unacked can never be credited or
            // acked — it rides Play's 3-day clock to an auto-refund with the
            // player holding nothing. That is not hypothetical: www.playfavor.net
            // resolves today (301 → apex), and the day the Pages CNAME is flipped
            // to www the apex 301s the OTHER way, straight into a shimless shell.
            //
            // Widened rather than narrowing isGameHost to the apex, because
            // narrowing ejects the player to the system browser on that same
            // redirect — a blank shell and a purchase we still cannot ack. The
            // trust boundary is the registrable domain either way: both
            // JavascriptInterfaces are already attached to this WebView for any
            // page it loads, so withholding the shim from our own subdomains
            // withholds no capability, it only breaks the page's gate.
            //
            // What it means for the favorUid heal: localStorage is per-origin, so
            // the save on www.* is a DIFFERENT store from the apex. Covering the
            // subdomains means the uid is seeded on whichever origin the page
            // actually lands on, so the account reattaches from Firebase instead
            // of the page minting a stranger. The onPageFinished mirror only
            // posts when that origin already holds a uid, so an empty subdomain
            // cannot wipe prefs — though an origin holding a different uid will
            // overwrite it. The heal is best-effort; the account of record is
            // whatever Firebase answers for the uid.
            //
            // Both forms are listed on purpose: "https://*.host" is documented to
            // match subdomains, and whether it also matches the bare apex is not
            // worth betting a money path on.
            Set<String> allowed = new HashSet<>();
            allowed.add("https://" + GAME_HOST);
            allowed.add("https://*." + GAME_HOST);
            try {
                WebViewCompat.addDocumentStartJavaScript(webView, boot, allowed);
            } catch (IllegalArgumentException e) {
                // This WebView refused the wildcard rule. Apex only — and pull
                // isGameHost back to the apex with it, so the pair can never
                // disagree in the direction that loses money.
                shimCoversSubdomains = false;
                Log.w(TAG, "wildcard origin rule refused; shim + navigation "
                        + "narrowed to the apex: " + e.getMessage());
                WebViewCompat.addDocumentStartJavaScript(
                        webView, boot, Collections.singleton("https://" + GAME_HOST));
            }
        } else {
            // ⚠ No DOCUMENT_START_SCRIPT: the shim stops being a promise and
            // becomes a race. evaluateJavascript in onPageStarted can be dropped
            // outright (the new document may not exist yet) or land after the
            // page's deferred scripts — and meta.js reads PLAY_IAP ONCE at module
            // scope (js/meta.js:3053), so a late shim is inert forever: no store,
            // no {cmd:'products'} (which is also the page-ready signal), no
            // replay. A rail wired behind a shim that may never arrive is how a
            // player pays and sees nothing, and it fails silently.
            //
            // So fail closed, above: no FavorPlayAndroid interface, no favorPlay
            // handler in this shim, no BillingClient at all. The page then looks
            // exactly like plain web (FavorBilling's own law) and no purchase can
            // be started. Anything bought on an earlier run is deliberately left
            // UNCONSUMED — consuming it with no page to credit it would take the
            // money and give nothing, whereas the 3-day auto-refund hands it back.
            //
            // Needs WebView 88+ (Jan 2021) against minSdk 28, so this should be
            // unreachable in the field. If it ever is not, the fix is to make the
            // shim the first bytes of <head> via shouldInterceptRequest on the
            // main document, or to gate distribution on the WebView version —
            // NOT a reload: a reload re-runs the same race and fights the page.
            // The favorSign half is still injected best-effort (onPageStarted
            // gates it on host + https); a late uid heal is harmless because the
            // script only writes when the origin has no favorUid yet.
            pendingBootScript = boot;
        }
    }

    private class ShellBridge {
        @JavascriptInterface
        public void post(String json) {
            try {
                JSONObject m = new JSONObject(json);
                if ("keychain_uid".equals(m.optString("cmd"))) {
                    String u = m.optString("uid", "");
                    if (u.matches("[A-Za-z0-9]{1,64}")) {
                        prefs.edit().putString("favorUid", u).apply();
                    }
                }
                // apple_signin never arrives here: the sign-in door is
                // UA-routed and Android shows the stub note. Unknown cmds
                // are ignored on purpose.
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goImmersive();
    }

    @Override
    protected void onResume() {
        super.onResume();
        goImmersive();
        if (webView != null) webView.onResume();
        // A purchase that was PENDING when the player left (or one Play settled
        // while we were backgrounded) is only ever heard about through a query
        // — and Play auto-refunds anything unconsumed after 3 days.
        if (billing != null) billing.resume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        // A billing callback can land after the Activity is gone. detach()
        // drops the bridge's WebView reference and ends the Play connection, so
        // a late push is a no-op instead of a touch on a dead view.
        if (billing != null) {
            billing.detach();
            billing = null;
        }
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void goImmersive() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getDecorView().getWindowInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    private int dp(float v) {
        return (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    // "The Realm Is Unreachable" — same copy and colours as the iOS retry
    // overlay (gold on parchment dark, serif for the royal voice).
    private void showRetry() {
        if (retryOverlay != null) return;

        LinearLayout stack = new LinearLayout(this);
        stack.setOrientation(LinearLayout.VERTICAL);
        stack.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView title = new TextView(this);
        title.setText("The Realm Is Unreachable");
        title.setTextColor(Color.rgb(0xFF, 0xD9, 0x7A));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        title.setTypeface(Typeface.create("serif", Typeface.BOLD));

        TextView sub = new TextView(this);
        sub.setText("Check your connection, then try again.");
        sub.setTextColor(Color.argb(0xB3, 0xE6, 0xE6, 0xE6));
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        sub.setTypeface(Typeface.create("serif", Typeface.ITALIC));
        sub.setGravity(Gravity.CENTER);

        Button btn = new Button(this);
        btn.setText("Return to the Table");
        btn.setTextColor(Color.rgb(0x2B, 0x1A, 0x06));
        btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        btn.setTypeface(Typeface.create("serif", Typeface.BOLD));
        btn.setAllCaps(false);
        GradientDrawable pill = new GradientDrawable();
        pill.setColor(Color.rgb(0xE0, 0xB4, 0x5E));
        pill.setCornerRadius(dp(22));
        btn.setBackground(pill);
        btn.setPadding(dp(26), dp(10), dp(26), dp(10));
        btn.setOnClickListener(v -> webView.loadUrl(GAME_URL));

        LinearLayout.LayoutParams gap = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        gap.topMargin = dp(14);
        stack.addView(title);
        stack.addView(sub, gap);
        LinearLayout.LayoutParams gap2 = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        gap2.topMargin = dp(14);
        stack.addView(btn, gap2);

        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(BG);
        overlay.setClickable(true);
        FrameLayout.LayoutParams center = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER);
        int m = dp(24);
        center.setMargins(m, m, m, m);
        overlay.addView(stack, center);

        root.addView(overlay, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        retryOverlay = overlay;
    }
}
