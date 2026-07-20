#!/usr/bin/env python3
"""
FAVOR — horizon occluder tracer.

Regenerates HORIZON_POLY for js/ambient.js by tracing the menu painting's
own pixels: for each column, the topmost run of non-sky pixels is the
silhouette (dark roof / trees against bright sky), smoothed with an upper
envelope so it rides the treetops, then Douglas-Peucker simplified.

FULL-WIDTH horizon (Wyatt's red-line spec 2026-07-20): all near
vegetation + the cottage occlude birds. The DISTANT castle must NOT —
within CASTLE's x-span the scan starts below the spires so the trace
dips to the village roofs and birds cross in front of the towers.

Run whenever assets/ui/menu-meadow.jpg or the .ts-bg crop changes:

    python3 tools/trace-occluder.py

Prints the polygon rows to paste into ambient.js and writes a visual
check to tools/occluder-check.png — LOOK AT IT before pasting. If the
background image itself changes, retune X0/X1 (the horizontal span) and
eyeball the is_sky() thresholds against the new sky.
"""
from PIL import Image, ImageDraw
import math

IMG = 'assets/ui/menu-meadow.jpg'
X0, X1 = 0, 2398          # full painting width
CASTLE = (1548, 1900, 606)  # x0, x1, scan floor — keeps the distant castle out
Y_TOP, Y_BOT, Y_CLOSE = 0, 900, 940


def is_sky(r, g, b):
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    return lum > 150 and b > 120 and b >= r - 30


def dp(points, eps):
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dmax, idx = 0, 0
    for i in range(1, len(points) - 1):
        x0, y0 = points[i]
        num = abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1)
        den = math.hypot(y2 - y1, x2 - x1) or 1
        if num / den > dmax:
            dmax, idx = num / den, i
    if dmax > eps:
        return dp(points[:idx + 1], eps)[:-1] + dp(points[idx:], eps)
    return [points[0], points[-1]]


im = Image.open(IMG).convert('RGB')
px = im.load()
xs = list(range(X0, X1 + 1, 2))
ys = []
for x in xs:
    y_start = CASTLE[2] if CASTLE[0] <= x <= CASTLE[1] else Y_TOP
    for y in range(y_start, Y_BOT):
        if not is_sky(*px[x, y]) and all(not is_sky(*px[x, yy]) for yy in (y + 1, y + 2, y + 3)):
            ys.append(y)
            break
    else:
        ys.append(Y_BOT)

env = [min(ys[max(0, i - 4):i + 5]) for i in range(len(ys))]   # hug the treetops
simp = dp(list(zip(xs, env)), 3.5)
poly = simp + [(X1, Y_CLOSE), (X0, Y_CLOSE)]

print(f'// {len(poly)} points — paste into HORIZON_POLY in js/ambient.js:')
for i in range(0, len(poly), 6):
    print('        ' + ' '.join(f'[{p[0]},{p[1]}],' for p in poly[i:i + 6]))

d = ImageDraw.Draw(im)
d.line(poly + [poly[0]], fill=(255, 0, 0), width=3)
im.crop((X0 - 80, Y_TOP - 20, X1 + 80, Y_CLOSE + 60)).save('tools/occluder-check.png')
print('\nWrote tools/occluder-check.png — verify the red line hugs the silhouette.')
