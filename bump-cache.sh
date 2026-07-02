#!/bin/bash
# Cache-bust: stamp a fresh version onto the ?v= asset URLs in index.html so
# browsers (esp. phones) fetch the latest CSS/JS after each deploy instead of
# serving stale cached copies. Run this before committing/pushing a deploy.
#
#   ./bump-cache.sh
#
set -e
cd "$(dirname "$0")"
V=$(date +%Y%m%d%H%M%S)
# Replace every ?v=<digits> in index.html (only the versioned asset links use it).
sed -i '' -E "s/\?v=[0-9]+/?v=$V/g" index.html
echo "Cache version stamped: $V"
grep -oE '(style\.css|ui\.js|cards\.js)\?v=[0-9]+' index.html
