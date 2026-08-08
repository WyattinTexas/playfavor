# Live-play footage — the ads re-cut pipeline

The 8/8 staged five filmed "really bad" — the re-cut wants REAL play. This
rig records Wyatt actually playing, on the Mac (no phone heat, no phone
storage), and feeds chosen moments straight back into the existing ad
builder. Sessions land in `sessions/<stamp>/` (gitignored — gigabytes).

## The routine

```
cd ~/playfavor && node tools/record-session.mjs
```

1. A fullscreen Chrome window opens on the game (local server, Steam UA —
   Mint + TV hidden, coach off, telemetry off, no cursor in the capture).
   Play anything: solo, daily rival, online. Sound stays on for you.
2. **Saw something cool? Tap ` (backtick).** It bookmarks the moment
   (small "◉ marked" blip, bottom-right, after the moment — never in the
   cut window).
3. Done? Close the Chrome window (or Ctrl+C in the terminal). The rig
   stitches `session.mp4` (~4–5 GB/hour, true VFR timeline), then
   auto-mines: your bookmarks + the highest-motion stretches become
   preview clips in `candidates/` (opens in Finder), beside `sheet.png`
   (whole session as timestamped thumbnails) and `notes.md`.

## From candidate to ad

```
node tools/export-shot.mjs sessions/<stamp> <start s|mm:ss> <len> <shotname>
```

writes builder-native 1920×1080 frames + frames.txt into
`marketing/applovin/frames/<shotname>/` — then add a table row in
`marketing/applovin/build_ads.sh` (same `key|scene|len|music_in|treatment`
grammar) and run it. Off-size captures are scale-and-center-cropped to
1920×1080 at export, so pan windows always mean the same thing.

## Notes

- Re-mine anytime: `node tools/mine-session.mjs sessions/<stamp> --top 20 --len 10`.
- The capture profile lives in `.chrome-play/` (gitignored) — progression
  persists between sessions. Identity: `wyattfootage01` / "Wyatt". To scrub
  it from the live board later: the capture-ads.mjs tail has the firebase
  remove line — swap in this uid.
- Works for any of our web games: `SHOT_URL=http://localhost:PORT/ node
  tools/record-session.mjs` (GVT, trainset…).
- Sessions are big. Once an ad ships, delete the session dir — exported
  frames under marketing/applovin/frames/ are what the build needs.
- `--test N` records N headless seconds of the title screen and runs the
  whole chain — the rig's smoke test.
