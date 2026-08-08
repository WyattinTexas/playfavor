#!/usr/bin/env bash
# FAVOR — five 9:16 AppLovin UA ads from the capture rig's frames.
#
#   cd ~/playfavor && python3 -m http.server 8891 &     (once)
#   node tools/capture-ads.mjs                          (frames + endcard.png)
#   marketing/applovin/build_ads.sh                     (~1 min)
#
# Grammar (the GVT build's, simplified): one ad = one scene's continuous
# footage, trimmed to len−CARD_SECS, treated to 9:16, then the end card.
# Treatments:
#   pan X0 X1   crop a 607×1080 window from the 1920×1080 frame, left edge
#               drifting X0→X1 over the cut (X ∈ [0,1313]; X0=X1 = static),
#               scaled to full-bleed 1080×1920 — the GVT full-bleed law.
#   blur        sharp full frame centered on a blurred, darkened cover of
#               itself — for wide beats a crop would butcher (menu, sheet).
# Music = the title theme (assets/audio/favor_take_r2.mp3 — Wyatt's track),
# per-ad window, 2-pass loudnorm to −14.5 LUFS, fade in/out. Spec: 1080×1920
# H.264 High @30 yuv420p bt709/tv + AAC 48k stereo + faststart (AppLovin UA
# takes ≤60 s / ≤1 GB — never shrink to the oRTB 4 MB myth).
set -euo pipefail
cd "$(dirname "$0")"

MUSIC="../../assets/audio/favor_take_r2.mp3"
CARD="endcard.png"
CARD_SECS=3.0
OUT=out
TMP=.build
mkdir -p "$OUT" "$TMP"

[[ -f "$MUSIC" ]] || { echo "missing $MUSIC"; exit 1; }
[[ -f "$CARD"  ]] || { echo "missing $CARD — run tools/capture-ads.mjs"; exit 1; }

#        key          scene      len  music_in  treatment
ADS=$(cat <<'TABLE'
A_FirstHand |firstplay |30 |0.00  |pan 380 760
B_TheHerald |missions  |30 |24.00 |pan 460 660
C_TheMelee  |melee     |15 |45.00 |pan 656 656
D_Wanted    |wanted    |15 |58.00 |pan 300 700
E_TheCrown  |victory   |30 |64.30 |blur
TABLE
)

probe_dur() { ffprobe -v quiet -show_entries format=duration -of default=nw=1:nk=1 "$1"; }

while IFS='|' read -r KEY SCENE LEN MIN TREAT; do
  KEY=$(echo "$KEY" | xargs); SCENE=$(echo "$SCENE" | xargs)
  LEN=$(echo "$LEN" | xargs); MIN=$(echo "$MIN" | xargs); TREAT=$(echo "$TREAT" | xargs)
  FR="frames/$SCENE/frames.txt"
  [[ -f "$FR" ]] || { echo "✗ $KEY: missing $FR (run the capture)"; exit 1; }
  GLEN=$(python3 -c "print(f'{$LEN - $CARD_SECS:.3f}')")
  echo "── $KEY  ($SCENE ${LEN}s = ${GLEN}s + card; music in $MIN; $TREAT)"

  # Headroom gate: the scene must actually hold GLEN seconds of footage.
  SPAN=$(python3 - "$FR" <<'PY'
import sys
tot = 0.0
for line in open(sys.argv[1]):
    if line.startswith('duration'):
        tot += float(line.split()[1])
print(f'{tot:.2f}')
PY
)
  python3 -c "import sys; sys.exit(0 if $SPAN >= $GLEN else 1)" \
    || { echo "✗ $KEY: scene span ${SPAN}s < needed ${GLEN}s"; exit 1; }

  # The gameplay branch. Range-convert at the chain head (capture JPEGs are
  # full-range); trim+setpts INSIDE the graph so pan's t starts at 0.
  case "$TREAT" in
    pan*)
      read -r _ X0 X1 <<< "$TREAT"
      VG="[0:v]trim=0:${GLEN},setpts=PTS-STARTPTS,fps=30,scale=in_range=full:out_range=tv,\
crop=607:1080:'${X0}+(${X1}-${X0})*t/${GLEN}':0,scale=1080:1920:flags=lanczos[g]"
      ;;
    blur)
      VG="[0:v]trim=0:${GLEN},setpts=PTS-STARTPTS,fps=30,scale=in_range=full:out_range=tv,split[a][b];\
[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=26,eq=brightness=-0.08[bg];\
[b]scale=1080:-2:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[g]"
      ;;
    *) echo "✗ $KEY: unknown treatment '$TREAT'"; exit 1 ;;
  esac

  # Music window: 2-pass loudnorm to −14.5 LUFS on exactly this cut.
  M1=$(ffmpeg -hide_banner -nostats -ss "$MIN" -t "$LEN" -i "$MUSIC" \
        -af loudnorm=I=-14.5:TP=-1.0:LRA=11:print_format=json -f null - 2>&1 \
      | python3 -c "import sys,json,re; m=re.search(r'\{[^{}]+\}', sys.stdin.read(), re.S); d=json.loads(m.group(0)); print(':'.join([d['input_i'],d['input_tp'],d['input_lra'],d['input_thresh'],d['target_offset']]))")
  IFS=':' read -r II ITP ILRA ITH OFF <<< "$M1"
  FADE_AT=$(python3 -c "print(f'{$LEN - 1.2:.2f}')")

  ffmpeg -hide_banner -loglevel error -y \
    -f concat -safe 0 -i "$FR" \
    -loop 1 -t "$CARD_SECS" -i "$CARD" \
    -ss "$MIN" -t "$LEN" -i "$MUSIC" \
    -filter_complex "\
${VG};\
[1:v]fps=30,scale=in_range=full:out_range=tv,scale=1080:1920,setsar=1[c];\
[g][c]concat=n=2:v=1:a=0,format=yuv420p,setsar=1[v];\
[2:a]loudnorm=I=-14.5:TP=-1.0:LRA=11:measured_I=${II}:measured_TP=${ITP}:measured_LRA=${ILRA}:measured_thresh=${ITH}:offset=${OFF}:linear=true,\
afade=t=in:st=0:d=0.25,afade=t=out:st=${FADE_AT}:d=1.2,apad,atrim=0:${LEN},asetpts=PTS-STARTPTS[a]" \
    -map '[v]' -map '[a]' \
    -c:v libx264 -profile:v high -preset slow -crf 19 -r 30 \
    -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
    -c:a aac -ar 48000 -ac 2 -b:a 192k \
    -movflags +faststart \
    "$OUT/$KEY.mp4"

  # Gates: exact duration, sane size, H.264/AAC present.
  DUR=$(probe_dur "$OUT/$KEY.mp4")
  python3 -c "import sys; d=float('$DUR'); sys.exit(0 if abs(d - $LEN) <= 0.15 else 1)" \
    || { echo "✗ $KEY: duration $DUR ≠ $LEN"; exit 1; }
  SZ=$(stat -f%z "$OUT/$KEY.mp4")
  python3 -c "import sys; s=$SZ; sys.exit(0 if 1_000_000 < s < 200_000_000 else 1)" \
    || { echo "✗ $KEY: size $SZ out of range"; exit 1; }
  echo "  ✓ $OUT/$KEY.mp4  ${DUR%.*}s  $((SZ / 1024 / 1024))MB"
done <<< "$ADS"

rm -rf "$TMP"
echo
echo "✅ five ads in $OUT/ — frame-verify edges, then Wyatt uploads to AppLovin"
