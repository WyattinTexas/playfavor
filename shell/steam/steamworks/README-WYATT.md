# FAVOR on Steam — status & what's left

**FAVOR is on Steam and installable.** App **4959630**, build **24172492**
is LIVE on the `default` branch (win + mac). Everything technical is done;
what remains is the store-presence + review phase, which is your content
and business calls.

## Done (2026-07-12)
- App created (paid Direct Fee → app credit redeemed → AppID **4959630**).
- Electron shell (win32-x64 + darwin-universal) built from `shell/steam/`,
  boot-verified against live playfavor.net. Loads the always-current web
  game; FavorShell-Steam UA hides the PayPal Mint (Valve wallet rules).
- Build **24172492** uploaded to depot **4959631** and **set live on the
  `default` branch**. Launch options published: Windows →
  `FAVOR-win32-x64\FAVOR.exe`, macOS → `FAVOR-darwin-universal/FAVOR.app`
  (both OS-restricted so each platform gets its own launcher).
- You can install FAVOR now from your Steam client (it's a dev build; the
  app isn't on the public store yet).

## What's left — your calls (the store launch)
1. **Store page** — description, capsule/header art, screenshots, trailer,
   tags, short blurb. (I can draft copy + generate capsule art from the box
   cover if you want — just say so.)
2. **Pricing** — set $4.99 (per the plan) in Steamworks → Store → Pricing.
3. **Age rating** questionnaire.
4. **"Coming Soon" / release review** — submit for Valve review (3–5
   business days, same as Nation). Then pick a release date and hit release.

## Re-uploading a new build later
steamcmd login is cached (no Steam Guard). From `shell/steam/`:
`npx electron-packager` (win + mac) → `steamworks/upload_build.sh` →
set the new build live on `default` in Steamworks → Builds.
