# Live-play footage — the ads re-cut pipeline

The staged ad scenes filmed "really bad" (8/8) — the re-cut wants REAL
play. This rig records Wyatt actually playing, on the Mac (no phone heat,
no phone storage), and feeds chosen moments back into the ad builder.

## Wyatt's routine

**Double-click "Record GVT" on the Desktop** (pin it to the Dock). One
Chrome window opens with the game fullscreen and a red **⏺ REC** pill in
the bottom-right corner — the only UI there is.

1. Hit **⏺ REC**. The pill hides itself, THEN capture starts 450 ms
   later — the button is never in a single frame. Play.
2. Something cool happened? Tap **` (backtick)** — bookmarks the moment.
3. To stop: glide the mouse to the **bottom-right corner**, dwell a
   beat — **⏹ STOP** + timer/GB fade in. (Those reach-for-stop frames
   are discard-tail, never ad material.)
4. Each take stitches `sessions/<stamp>/session.mp4`, auto-mines your
   bookmarks + the highest-motion stretches into `candidates/*.mp4`
   preview clips (Finder opens them), beside `sheet.png` (the whole take
   as timestamped thumbnails) and `notes.md`.

Safety: nothing records until ⏺; a take auto-stops at 90 min
(`REC_MAX_MIN`) or under 8 GB free disk; ~75 MB per minute recorded;
takes are plain folders — delete any time, they're gitignored.

## From candidate to ad

```
node tools/export-shot.mjs sessions/<stamp> <start s|mm:ss> <len> <shotname>
```

writes builder-native 1920×1080 full-range frames + frames.txt into
`marketing/applovin/frames/<shotname>/` → add a `key|scene|len|music_in|
treatment` row in the ad build table and run it. Off-size captures are
scale-and-center-cropped so pan windows always mean the same thing.
(For GVT's builder the exported frames get adapted into its shot_*.txt
grammar at cut time.)

## Notes

- Terminal door: `node tools/record-session.mjs` (FAVOR) ·
  `SHOT_URL=https://playgvt.net/ node tools/record-session.mjs` (GVT) —
  the Desktop app runs the GVT form and logs to `recorder.log` here.
- Re-mine: `node tools/mine-session.mjs sessions/<stamp> --top 20 --len 10`.
- Capture laws: CDP screencast (no OS cursor ever), Steam UA (Mint + TV
  hidden), coach pre-seen, telemetry off, occlusion throttling disabled
  (an unfocused window otherwise captures NOTHING — the empty-take
  lesson), crash-restored stray tabs closed at boot.
- Play profile `.chrome-play/` persists progression (uid `wyattfootage01`).
- `--test N` smoke-tests the whole chain headless.
