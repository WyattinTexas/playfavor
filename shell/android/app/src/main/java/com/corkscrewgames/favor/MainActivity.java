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

public class MainActivity extends Activity {

    private static final String GAME_URL = "https://playfavor.net/";
    private static final String GAME_HOST = "playfavor.net";
    private static final int BG = Color.rgb(0x1D, 0x11, 0x06);

    private WebView webView;
    private FrameLayout root;
    private View retryOverlay;
    private SharedPreferences prefs;
    private boolean loadFailed;
    // Fallback boot script for WebViews too old for DOCUMENT_START_SCRIPT.
    private String pendingBootScript;

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
                if (pendingBootScript != null) {
                    view.evaluateJavascript(pendingBootScript, null);
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
    private boolean isGameHost(String host) {
        return host.equalsIgnoreCase(GAME_HOST)
                || host.toLowerCase().endsWith("." + GAME_HOST);
    }

    // The page heals favorUid from the shell store BEFORE any page script runs
    // (the iOS Keychain heal, rebuilt on SharedPreferences + Auto Backup), and
    // its favorSign posts (written for WKWebView) land here through the shim.
    private void installBootScript() {
        String kc = prefs.getString("favorUid", "");
        if (!kc.matches("[A-Za-z0-9]{1,64}")) kc = "";
        String boot = "window.__FAVORSHELL={platform:'android',build:1};"
                + "window.webkit={messageHandlers:{favorSign:{postMessage:function(m){"
                + "try{FavorShellAndroid.post(JSON.stringify(m||{}))}catch(e){}}}}};"
                + "try{if(!localStorage.getItem('favorUid')&&'" + kc + "'){"
                + "localStorage.setItem('favorUid','" + kc + "')}}catch(e){}";
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(
                    webView, boot, Collections.singleton("https://" + GAME_HOST));
        } else {
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
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
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
