# Generates the ornament SVGs used by src/styles-fantasy.css as CSS custom properties.
# Run: python3 scripts/ornaments.py  -> paste the printed :root blocks over the ones at the top
# of src/styles-fantasy.css. '#' must stay percent-encoded inside the data URIs.
import math, random, urllib.parse
G = '#f1d48a'
def uri(svg): return 'url("data:image/svg+xml,' + urllib.parse.quote(svg, safe=" =:/,.'-()") + '")'

corner_body = (
  f"<g fill='none' stroke='{G}' stroke-linecap='round' stroke-linejoin='round'>"
  "<path d='M3 40 V11 Q3 3 11 3 H40' stroke-width='1.5'/>"
  "<path d='M9 30 V15 Q9 9 15 9 H30' stroke-width='0.9' opacity='.65'/>"
  "<path d='M40 3 H58' stroke-width='1' opacity='.45'/><path d='M3 40 V58' stroke-width='1' opacity='.45'/>"
  "<path d='M15 9 C21 9 23 14 20 17 C18 19 15 17 16 15' stroke-width='1'/>"
  "<path d='M9 15 C9 21 14 23 17 20' stroke-width='1' opacity='.8'/>"
  "<path d='M22 3 q4 -3 8 0' stroke-width='.9' opacity='.7'/><path d='M3 22 q-3 4 0 8' stroke-width='.9' opacity='.7'/>"
  "</g>"
  f"<path d='M6 0.8 L11.2 6 L6 11.2 L0.8 6Z' fill='{G}'/>"
  "<path d='M6 3.8 L8.2 6 L6 8.2 L3.8 6Z' fill='#fff6d6'/>"
  f"<circle cx='40' cy='3' r='1.3' fill='{G}'/><circle cx='3' cy='40' r='1.3' fill='{G}'/>"
)
def corner(tf): return uri(f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'><g transform='{tf}'>{corner_body}</g></svg>")

rule = uri(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 16'>"
  "<defs><linearGradient id='g' gradientUnits='userSpaceOnUse' x1='0' y1='0' x2='320' y2='0'><stop offset='0' stop-color='#f1d48a' stop-opacity='0'/>"
  "<stop offset='.4' stop-color='#f1d48a' stop-opacity='.9'/><stop offset='.6' stop-color='#f1d48a' stop-opacity='.9'/>"
  "<stop offset='1' stop-color='#f1d48a' stop-opacity='0'/></linearGradient></defs>"
  "<path d='M6 8 H138 M182 8 H314' stroke='url(#g)' stroke-width='1.5'/>"
  f"<g fill='none' stroke='{G}' stroke-width='1.1' stroke-linecap='round'>"
  "<path d='M138 8 q6 -6 12 -2'/><path d='M138 8 q6 6 12 2'/><path d='M182 8 q-6 -6 -12 -2'/><path d='M182 8 q-6 6 -12 2'/>"
  "<path d='M160 1 L167 8 L160 15 L153 8Z'/></g>"
  f"<path d='M160 4.5 L163.5 8 L160 11.5 L156.5 8Z' fill='{G}'/>"
  f"<circle cx='148' cy='8' r='1.3' fill='{G}'/><circle cx='172' cy='8' r='1.3' fill='{G}'/>"
  "</svg>")

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
  + "<path d='M38 52 L71 30 L96 44' stroke='#f1d48a' stroke-opacity='.05' fill='none'/></svg>")

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

VARS = {
  'orn-tl': corner(''), 'orn-tr': corner('translate(60 0) scale(-1 1)'),
  'orn-bl': corner('translate(0 60) scale(1 -1)'), 'orn-br': corner('translate(60 60) scale(-1 -1)'),
  'orn-rule': rule, 'pat-stars': stars, 'orn-rune': rune, 'orn-rune-soft': soft,
  'orn-rune-bright': bright, 'orn-star': star, 'orn-spark': spark,
}
print(":root {")
for k, v in VARS.items(): print(f"  --{k}: {v};")
print("}")
