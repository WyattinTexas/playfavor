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
