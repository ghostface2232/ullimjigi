# Generates the ornament SVGs used by src/styles-fantasy.css as CSS custom properties.
# Run: python3 scripts/ornaments.py  -> paste the printed :root block over the first one in
# src/styles-fantasy.css. '#' must stay percent-encoded inside the data URIs.
import math, random, urllib.parse
G = '#f1d48a'
def uri(svg): return 'url("data:image/svg+xml,' + urllib.parse.quote(svg, safe=" =:/,.'-()") + '")'

# Motif system (see docs/ART_DIRECTION.md "Interface"): resonance rings, a bell crest, sound-wave
# filigree, staff-crystal facets and staff lines. Everything is gilt line work, mirrored so that
# focus and importance are always marked on both sides, never by a bar down one edge.

def wave(x0, x1, y, amp, period, decay, step=1.0):
    """A sound wave leaving x0 toward x1 (either direction), its amplitude dying away."""
    pts, n = [], int(abs(x1 - x0) / step)
    for i in range(n + 1):
        t = i / n
        x = x0 + (x1 - x0) * t
        d = abs(x - x0)
        pts.append(f"{x:.1f} {y + amp * math.exp(-decay * t) * math.sin(2 * math.pi * d / period):.2f}")
    return 'M' + ' L'.join(pts)

def facet(cx, cy, r, inner=True, fill=G):
    """The staff crystal: a lozenge outline with a bright core."""
    s = f"<path d='M{cx} {cy - r} L{cx + r * 0.72} {cy} L{cx} {cy + r} L{cx - r * 0.72} {cy}Z' fill='none' stroke='{fill}' stroke-width='1.1' stroke-linejoin='round'/>"
    if inner:
        k = r * 0.48
        s += f"<path d='M{cx} {cy - k} L{cx + k * 0.72} {cy} L{cx} {cy + k} L{cx - k * 0.72} {cy}Z' fill='#fff6d6'/>"
    return s

def fade(gid, w, mid=0.5, lo=0.0, hi=0.95, span=0.32):
    return (f"<linearGradient id='{gid}' gradientUnits='userSpaceOnUse' x1='0' y1='0' x2='{w}' y2='0'>"
            f"<stop offset='0' stop-color='{G}' stop-opacity='{lo}'/><stop offset='{mid - span:.2f}' stop-color='{G}' stop-opacity='{hi}'/>"
            f"<stop offset='{mid + span:.2f}' stop-color='{G}' stop-opacity='{hi}'/><stop offset='1' stop-color='{G}' stop-opacity='{lo}'/></linearGradient>")

# corner: a rounded gilt angle, two resonance arcs spreading from the corner crystal, and a
# short sound wave running out along each edge
corner_body = (
  f"<g fill='none' stroke='{G}' stroke-linecap='round' stroke-linejoin='round'>"
  "<path d='M3 46 V13 Q3 3 13 3 H46' stroke-width='1.4'/>"
  "<path d='M21 8 A13 13 0 0 1 8 21' stroke-width='1'/>"
  "<path d='M28 8.5 A20 20 0 0 1 8.5 28' stroke-width='.8' opacity='.55'/>"
  f"<path d='{wave(30, 58, 3, 2.2, 9, 2.6, 0.7)}' stroke-width='.9' opacity='.75'/>"
  "</g>"
  # the same wave down the side edge (x and y swapped)
  f"<g fill='none' stroke='{G}' stroke-linecap='round' stroke-width='.9' opacity='.75' transform='matrix(0 1 1 0 0 0)'><path d='{wave(30, 58, 3, 2.2, 9, 2.6, 0.7)}'/></g>"
  f"<path d='M6.5 0.8 L10.6 6.5 L6.5 12.2 L2.4 6.5Z' fill='{G}'/>"
  "<path d='M6.5 4 L8.3 6.5 L6.5 9 L4.7 6.5Z' fill='#fff6d6'/>"
  f"<circle cx='46' cy='3' r='1.2' fill='{G}'/><circle cx='3' cy='46' r='1.2' fill='{G}'/>"
)
def corner(tf): return uri(f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'><g transform='{tf}'>{corner_body}</g></svg>")

# rule: the crystal in the middle, a sound wave dying away on each side over a faint string
rule = uri(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 16'>"
  f"<defs>{fade('g', 320, span=0.22)}</defs>"
  "<path d='M8 8 H146 M174 8 H312' stroke='url(#g)' stroke-width='.7' opacity='.7'/>"
  f"<path d='{wave(150, 8, 8, 4.2, 15, 2.4)} M{wave(170, 312, 8, 4.2, 15, 2.4)[1:]}' fill='none' stroke='url(#g)' stroke-width='1.2' stroke-linecap='round'/>"
  + facet(160, 8, 7) +
  "</svg>")

# crest on the top edge of every framed sheet: a small bell sounding, rings on either side,
# then the wave running out
bell = (f"<path d='M60 4.2 C56 4.2 54 8 53.6 13.2 L52.4 17.6 Q52 18.8 53.4 18.8 H66.6 Q68 18.8 67.6 17.6 L66.4 13.2 C66 8 64 4.2 60 4.2Z' fill='url(#b)' stroke='#2a1e0c' stroke-width='.7'/>"
        f"<circle cx='60' cy='3.2' r='1.5' fill='{G}'/><circle cx='60' cy='20.6' r='1.6' fill='#fff6d6'/>"
        "<path d='M56 8.6 Q57 7 58.6 6.6' stroke='#fff6d6' stroke-width='.8' fill='none' stroke-linecap='round' opacity='.8'/>")
arcs = ''.join(f"<path d='M{60 + s * dx} {12 - h} Q{60 + s * (dx + h * 0.55)} 12 {60 + s * dx} {12 + h}' />" for s in (1, -1) for dx, h in ((11, 4.5), (15.5, 7)))
crest = uri(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 24'>"
  f"<defs><linearGradient id='b' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fff4cf'/><stop offset='.6' stop-color='{G}'/><stop offset='1' stop-color='#b58a3c'/></linearGradient>"
  f"{fade('g', 120, span=0.3)}</defs>"
  f"<g fill='none' stroke='{G}' stroke-width='1' stroke-linecap='round'>{arcs}</g>"
  f"<path d='{wave(22, 0, 12, 2.6, 8, 2.2, 0.6)} M{wave(98, 120, 12, 2.6, 8, 2.2, 0.6)[1:]}' fill='none' stroke='url(#g)' stroke-width='1' stroke-linecap='round'/>"
  + bell + "</svg>")

# row caps: a crystal with a short tail pointing inward, one at each end of whatever is focused
def cap(flip):
    tf = "translate(24 0) scale(-1 1)" if flip else ""
    return uri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 16'>"
               f"<g transform='{tf}'><path d='M12 8 H23' stroke='{G}' stroke-width='1' stroke-linecap='round' opacity='.8'/>"
               + facet(7, 8, 6.4) + "</g></svg>")

# minimap bezel: a gilt ring with tick marks and four crystals on the diagonals
bt = []
for i in range(72):
    a = i / 72 * 2 * math.pi
    if i % 9 == 0 and i % 18 != 0: continue  # leave the diagonals to the crystals
    r0, r1 = (91, 96) if i % 18 == 0 else (93.5, 96)
    bt.append(f"M{100 + math.cos(a) * r0:.1f} {100 + math.sin(a) * r0:.1f} L{100 + math.cos(a) * r1:.1f} {100 + math.sin(a) * r1:.1f}")
bezel = uri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>"
  f"<g fill='none' stroke='{G}'><circle cx='100' cy='100' r='98' stroke-width='1.2' opacity='.7'/><circle cx='100' cy='100' r='90' stroke-width='.6' opacity='.35'/>"
  f"<path d='{' '.join(bt)}' stroke-width='.8' opacity='.6'/></g>"
  + ''.join(facet(round(100 + math.cos(a) * 94, 1), round(100 + math.sin(a) * 94, 1), 5.2) for a in (math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4))
  + "</svg>")

random.seed(7)
dots = []
for i in range(26):
    x, y = random.uniform(0, 160), random.uniform(0, 160)
    r = random.choice([0.5, 0.6, 0.7, 0.9, 1.1])
    o = random.uniform(0.06, 0.22)
    dots.append(f"<circle cx='{x:.1f}' cy='{y:.1f}' r='{r}' fill='#dfe8ff' fill-opacity='{o:.2f}'/>")
spark = lambda x, y, s, o: f"<path d='M{x} {y-s} L{x+s*0.22} {y-s*0.22} L{x+s} {y} L{x+s*0.22} {y+s*0.22} L{x} {y+s} L{x-s*0.22} {y+s*0.22} L{x-s} {y} L{x-s*0.22} {y-s*0.22}Z' fill='#f6e6b8' fill-opacity='{o}'/>"
stars = uri("<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>" + ''.join(dots)
  + spark(38, 52, 3.2, .16) + spark(118, 124, 2.6, .12)
  + "</svg>")  # no constellation line: repeated every tile it read as a grid of chevrons

# rune circle watermark
ticks = []
for i in range(72):
    a = i / 72 * 2 * math.pi
    r0, r1 = (176, 186) if i % 6 == 0 else (179, 183)
    ticks.append(f"M{200+math.cos(a)*r0:.1f} {200+math.sin(a)*r0:.1f} L{200+math.cos(a)*r1:.1f} {200+math.sin(a)*r1:.1f}")
def poly(n, r, rot=0, step=1):
    pts = [(200 + math.cos(rot + (i*step % n) / n * 2*math.pi) * r, 200 + math.sin(rot + (i*step % n) / n * 2*math.pi) * r) for i in range(n)]
    return 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in pts) + 'Z'
glyphs = []
for i in range(12):
    a = i / 12 * 2 * math.pi - math.pi / 2
    cx, cy = 200 + math.cos(a) * 158, 200 + math.sin(a) * 158
    glyphs.append(f"<g transform='translate({cx:.1f} {cy:.1f}) rotate({math.degrees(a)+90:.0f})'><path d='M-3 -5 L0 5 L3 -5 M-4 0 H4' /></g>")
rune = uri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'>"
  f"<g fill='none' stroke='{G}' stroke-width='1' stroke-opacity='.16'>"
  "<circle cx='200' cy='200' r='194'/><circle cx='200' cy='200' r='170'/><circle cx='200' cy='200' r='146'/>"
  f"<path d='{' '.join(ticks)}'/>"
  f"<path d='{poly(8, 146, -math.pi/2, 3)}' stroke-opacity='.35'/>"
  f"<path d='{poly(4, 146, -math.pi/2)}'/><path d='{poly(4, 146, -math.pi/4)}'/>"
  "<circle cx='200' cy='200' r='60'/><circle cx='200' cy='200' r='52' stroke-dasharray='2 5'/>"
  + ''.join(glyphs) + "</g></svg>")

# a quieter circle for busy panels (skill tree): rings, ticks and glyphs, no star lines
soft = uri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'>"
  f"<g fill='none' stroke='{G}' stroke-width='1' stroke-opacity='.09'>"
  "<circle cx='200' cy='200' r='194'/><circle cx='200' cy='200' r='170'/>"
  f"<path d='{' '.join(ticks)}'/>" + ''.join(glyphs) + "</g></svg>")

# the loading screen: a brighter rune circle, an eight-pointed star and a small sparkle
bright = rune.replace('stroke-opacity%3D%27.16%27', 'stroke-opacity%3D%27.6%27').replace("stroke-opacity='.16'", "stroke-opacity='.6'")
def star_path(cx, cy, r1, r2, rs, n=8):
    pts = []
    for i in range(n * 2):
        a = i / (n * 2) * 2 * math.pi - math.pi / 2
        r = (r1 if i % 4 == 0 else r2) if i % 2 == 0 else rs
        pts.append(f"{cx + math.cos(a) * r:.2f} {cy + math.sin(a) * r:.2f}")
    return 'M' + ' L'.join(pts) + 'Z'
star = uri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>"
  "<defs><radialGradient id='s' cx='50' cy='50' r='46' gradientUnits='userSpaceOnUse'>"
  "<stop offset='0' stop-color='#ffffff'/><stop offset='.28' stop-color='#fff4cf'/><stop offset='.7' stop-color='#f1d48a'/><stop offset='1' stop-color='#c9a24e'/></radialGradient>"
  "<radialGradient id='h' cx='50' cy='50' r='50' gradientUnits='userSpaceOnUse'><stop offset='0' stop-color='#bfe6ff' stop-opacity='.55'/><stop offset='1' stop-color='#bfe6ff' stop-opacity='0'/></radialGradient></defs>"
  "<circle cx='50' cy='50' r='50' fill='url(#h)'/>"
  f"<path d='{star_path(50, 50, 46, 26, 7)}' fill='url(#s)'/>"
  f"<path d='{star_path(50, 50, 30, 16, 4.5)}' fill='#ffffff' fill-opacity='.55'/>"
  "</svg>")
spark = uri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'>"
  f"<path d='{star_path(10, 10, 10, 5, 1.6, 4)}' fill='#fff6d6'/></svg>")

# five staff lines with diamond note heads: the valley's songs as a quiet rule under headers
def staff(w=720, notes=((78, 3), (150, 1), (236, 4), (318, 2), (402, 5), (486, 3), (566, 1), (642, 4))):
    y = lambda l: 30 - l * 5
    lines = ''.join(f"<path d='M0 {y(i)} H{w}' stroke='url(#g)' stroke-width='.8'/>" for i in range(1, 6))
    heads = ''.join(
        f"<path d='M{x} {y(l) - 3.4} l3.4 3.4 -3.4 3.4 -3.4 -3.4Z' fill='{G}' fill-opacity='.9'/>"
        f"<path d='M{x + 3} {y(l)} v-12' stroke='{G}' stroke-width='.9' stroke-opacity='.75'/>" for x, l in notes)
    return uri(f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {w} 36'>"
      f"<defs><linearGradient id='g' gradientUnits='userSpaceOnUse' x1='0' y1='0' x2='{w}' y2='0'><stop offset='0' stop-color='{G}' stop-opacity='0'/>"
      f"<stop offset='.2' stop-color='{G}' stop-opacity='.38'/><stop offset='.8' stop-color='{G}' stop-opacity='.38'/>"
      f"<stop offset='1' stop-color='{G}' stop-opacity='0'/></linearGradient></defs>{lines}{heads}</svg>")

# resonance: rings spreading from a point, a watermark for wide dark surfaces
ripple = uri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'><g fill='none' stroke='#f1d48a'>"
  + ''.join(f"<circle cx='300' cy='300' r='{r}' stroke-opacity='{0.16 * (1 - r / 320):.3f}' stroke-width='{1.4 if i % 3 == 0 else 0.8}'/>" for i, r in enumerate(range(40, 300, 26)))
  + "</g></svg>")

VARS = {
  'orn-tl': corner(''), 'orn-tr': corner('translate(60 0) scale(-1 1)'),
  'orn-bl': corner('translate(0 60) scale(1 -1)'), 'orn-br': corner('translate(60 60) scale(-1 -1)'),
  'orn-rule': rule, 'pat-stars': stars, 'orn-rune': rune, 'orn-rune-soft': soft,
  'orn-rune-bright': bright, 'orn-star': star, 'orn-spark': spark,
  'orn-staff': staff(), 'orn-ripple': ripple,
  'orn-crest': crest, 'orn-cap-l': cap(False), 'orn-cap-r': cap(True), 'orn-bezel': bezel,
}
print(":root {")
for k, v in VARS.items(): print(f"  --{k}: {v};")
print("}")
