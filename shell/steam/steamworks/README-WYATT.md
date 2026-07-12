# FAVOR → Steam: what's ready and the ONE thing only you can do

Everything is built and tested. The blocker is money: creating a new app
on Steam costs the **$100 Steam Direct Fee**, and only you can pay it.

## Your 3 steps (~10 minutes)

1. **Pay the fee** — you're already logged into Steamworks in Chrome:
   https://partner.steamgames.com/apps/ → green **"Pay Steam Direct Fee"**
   button (right side). Steam names the new app placeholder-style; call it
   **FAVOR** when asked. When it's done you'll have a new **App ID**
   (Nation's is 3727980 — yours will be a similar 7-digit number).

2. **Tell Claude the App ID** (or edit yourself): in
   `shell/steam/steamworks/app_build_FAVOR.vdf`, replace
   - `FAVOR_APPID` → the new app id
   - `FAVOR_DEPOT_WIN` / `FAVOR_DEPOT_MAC` → the two depot ids Steam
     auto-creates (Steamworks → FAVOR → SteamPipe → Depots; usually
     appid+1 and appid+2)

3. **Run the upload** (no Steam Guard needed — login is cached):
   `~/playfavor/shell/steam/steamworks/upload_build.sh`

Then in Steamworks: Builds → set live on **beta** branch → install via
Steam client to sanity-check → fill the store page ($4.99 per the plan)
→ submit for Valve review (3-5 business days, same as Nation).

## What's already done

- **Electron shell** (`shell/steam/`): loads playfavor.net (always the
  latest game), FavorShell-Steam UA → the site hides the PayPal Mint
  (Valve MTX rules; same posture as Nation's Steam build), external links
  open in the system browser, offline retry screen, F11 fullscreen,
  persistent profile (your favorUid/crests survive updates).
- **Packaged builds** in `shell/steam/dist/`: `FAVOR-win32-x64/` and
  `FAVOR-darwin-universal/` (Intel+Apple Silicon).
- **Boot-verified** on this Mac: shell → live playfavor.net → menu loads,
  identity minted, correct UA.
- steamcmd login cached (the Nation Key Ceremony sentry survives).
