#!/usr/bin/env bash
# Upload FAVOR's Win+Mac builds to Steam. steamcmd login is CACHED for
# wyattgable (verified 2026-07-12 — no Steam Guard prompt), so this runs
# non-interactively once the vdf carries the real appid/depot ids.
set -euo pipefail

ACCOUNT="wyattgable"
VDF="/Users/drbango/playfavor/shell/steam/steamworks/app_build_FAVOR.vdf"

if grep -q 'FAVOR_APPID' "$VDF"; then
  echo "✗ The vdf still has placeholder ids — see README-WYATT.md (pay the"
  echo "  Steam Direct Fee, then fill in the appid + two depot ids)."
  exit 1
fi

echo "Uploading depots from shell/steam/dist/ …"
steamcmd \
  +login "$ACCOUNT" \
  +run_app_build "$VDF" \
  +quit

echo
echo "Done. Steamworks → FAVOR → Builds: set the new build live on 'beta',"
echo "then fill the store page and submit for Valve review (3-5 business days)."
