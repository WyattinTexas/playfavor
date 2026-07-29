#!/usr/bin/env python3
"""Adaptive-icon layers + Play 512 master, generated from the iOS icon art.

The iOS 1024 (watercolor serpent, gold FAVOR wordmark) becomes:
  - background layer: the art's own corner tone (a colour resource)
  - foreground layer: the full art scaled to 72% on that canvas, so the
    wordmark sits inside every launcher mask and the corners blend into
    the background layer
  - store/icon512.png: the Play Console master (32-bit RGBA)

Rerun after any change to shell/ios/.../icon1024.png.
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(
    HERE, "../../ios/Favor/Assets.xcassets/AppIcon.appiconset/icon1024.png"))
RES = os.path.normpath(os.path.join(HERE, "../app/src/main/res"))
STORE = os.path.normpath(os.path.join(HERE, "../store"))

art = Image.open(SRC).convert("RGB")
assert art.size == (1024, 1024), art.size
bg = art.getpixel((8, 8))
print("background tone: #%02X%02X%02X" % bg)

# foreground master: bg-tone canvas, art scaled to the adaptive safe zone
SCALE = 0.72
fg = Image.new("RGB", (1024, 1024), bg)
inner = art.resize((int(1024 * SCALE),) * 2, Image.LANCZOS)
off = (1024 - inner.size[0]) // 2
fg.paste(inner, (off, off))

DENS = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
for name, px in DENS.items():
    d = os.path.join(RES, "mipmap-%s" % name)
    os.makedirs(d, exist_ok=True)
    fg.resize((px, px), Image.LANCZOS).save(os.path.join(d, "ic_launcher_foreground.png"))
    print("wrote mipmap-%s/ic_launcher_foreground.png (%d)" % (name, px))

vals = os.path.join(RES, "values")
os.makedirs(vals, exist_ok=True)
with open(os.path.join(vals, "ic_launcher_background.xml"), "w") as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
            '    <color name="ic_launcher_background">#%02X%02X%02X</color>\n'
            "</resources>\n" % bg)

os.makedirs(STORE, exist_ok=True)
art.convert("RGBA").resize((512, 512), Image.LANCZOS).save(os.path.join(STORE, "icon512.png"))
print("wrote store/icon512.png")
