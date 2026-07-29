# Tutorial test harnesses (tools/)

Local-only. `howto.html` is the real How-to-Play page; the rest are probes and
must never be copied into the preview repo or linked from the game.

- **howto-syntax.html** — loads `js/tutorial.js` against the card/mission data
  only and reports parse errors plus a step-table audit (duplicate ids, steps
  with no way to advance, missing `why`). Seconds to run; use it after every
  edit to the STEPS array.
- **howto-determinism.html** — boots the tutorial's exact setup twice and
  compares the whole three-act deal (hands, deck order, mission pools) card for
  card. Prints `identical=true` when the seeded shuffle is intact. Run this
  whenever anything touches `setSeed`, `loadDecks` or the RNG.
- **howto-audit.html** — lays out every step via `TUT.goto(id, true)` (force-show,
  ignoring the ready gate) and measures each prompt against the spotlight and the
  viewport, flagging `COVERS_TARGET` / `OFF_SCREEN_*` / `TALLER_THAN_SCREEN`.
  Run at BOTH `--window-size=1440,900` and `--window-size=844,533` (the latter
  gives innerHeight≈390, real iPhone 12 Pro landscape — Chrome subtracts ~143px
  even headless). Both sizes should report `flagged=0`.
  ⚠ It injects `transition:none` before measuring, and must: **CSS transitions do
  not advance under `--virtual-time-budget`**, so `getComputedStyle` otherwise
  returns pre-transition positions and every reading is a lie.

Run either with:

    python3 -m http.server 8747          # from ~/playfavor
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      --headless=new --disable-gpu --virtual-time-budget=8000 --dump-dom \
      http://localhost:8747/tools/howto-syntax.html

The full auto-driver (plays all three acts headless and dumps a step trail) is
deliberately NOT kept in the repo — it is regenerated from `howto.html` when
needed. Its hard-won rules, all of which cost a debugging cycle to find:

- `offsetParent` is null for `position:fixed`, so it cannot be used as a
  visibility test — it hides every overlay in this game.
- The driver must DWELL. The tutorial polls its gates at 250/300ms; a bot that
  acts instantly races them in ways no human can.
- Never throw a card except on a step that asks for one — the hand is live
  during watch beats by design.
- In the lender chooser, click a `.bw-row`, never `#bwCancel` (that bounces
  back to the panel and loops forever).
- Under `--virtual-time-budget` the DOM dump lands whenever the budget expires,
  so the driver must publish its state every tick, not only at the end.
