# shell/android/store — the Google Play listing, source of truth

Everything the Play Console asks for. Built 2026-07-26 against the live game
(v20260724190657 era) + the shipped Apple 1.0 copy. There is no Play developer
account yet (the Wyatt-only blocker recorded in `gvt-googleplay-launch` /
`favor-googleplay-launch`); when it lands, this directory is what gets
pasted/uploaded.

## What's here

| File | What it is |
|---|---|
| `listing/en-US.md` | Title, short description, full description, release notes, with live char counts. **English only** — Apple's FAVOR listing is en-US only, and Play must not invent languages Apple doesn't speak. Strings are VERBATIM from `shell/store/favor_store.py`. |
| `check_listing.py` | Asserts the .md carries the Apple copy verbatim + Play's caps (title 30 · short 80 · full 4000 · notes 500). Run after any edit to favor_store.py. |
| `play_shots.mjs` | The screenshot rig — `shell/store/capture-shots.mjs` ported to Play's three 16:9 profiles under the FavorShell-Android UA (Mint hidden in every frame; the rig REFUSES to shoot if the gate fails). Also renders the feature-graphic master. |
| `icon512.png` | 512×512 32-bit RGBA PNG, from the iOS art (`../tools/make_icons.py`). |
| `feature1024x500.png` | The feature graphic (Play-only asset): the live royal menu's own art. |
| `declarations.md` | Data safety, IARC content rating, target audience (⚠ 13+ recommended — the Families-policy call), category, price, URLs, upload-key fingerprint — every answer mirroring Apple's. |

Screenshots land OUTSIDE the repo (like the iOS sets):
`~/Desktop/favor-googleplay-1.0/store-shots/{phone,tablet7,tablet10}/` — 7 shots
per set (Play caps at 8): menu · hero select · the table · card sheet ·
character board · leaderboard · Royal Emporium. Same seven scenes as the
approved Apple listing.

## Field mapping, Apple → Play (the GVT law)

- Apple **name** → Play **title**: `FAVOR: Royal Succession`.
- Apple **subtitle** (≤30) → Play **short description** (≤80), verbatim.
- Apple **promo + description** → Play **full description**: promo paragraph
  first, blank line, then the description — the stack an Apple shopper reads.
- Apple **keywords** → nothing; Play has no keyword field.
- Release notes: the ONE derived string (a first release has no Apple
  What's New to import) — factual, from the description's own claims.

## Screenshots

```
cd ~/playfavor && python3 -m http.server 8891 &
node shell/android/store/play_shots.mjs
sips -z 500 1024 ~/Desktop/favor-googleplay-1.0/feature-raw-2048x1000.png \
     --out shell/android/store/feature1024x500.png
```

⚠ Don't run while ui-audit runs (both sweep uaudit* rows), and never in the
21:45–22:15 ET daily-settle window.
