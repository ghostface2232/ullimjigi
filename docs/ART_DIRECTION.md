# Art direction

The bar for every asset, shader and effect in 울림지기. Reviewers judge work against this page, not
against personal taste. Gameplay facts live in [DESIGN.md](DESIGN.md); engine rules in
[../AGENTS.md](../AGENTS.md).

## The picture we are making

A hand-crafted storybook valley lit like a summer afternoon that is about to be forgotten. The world
was sung into being, so it should look *composed*: every silhouette deliberate, every colour chosen.
Benchmarks for finish are Genshin Impact and Zenless Zone Zero; for proportion and restraint,
Zelda: Tears of the Kingdom. We borrow their discipline, not their designs.

Three pillars, in priority order:

1. **Readable shape first.** A model, a building or a spell must read in a two-second glance at
   game distance as a flat silhouette. Detail lives *inside* a strong silhouette; it never replaces one.
2. **Clean craft, not grime.** Surfaces are tidy and well made: even dressed stone, clean plaster,
   crisp bevels, deliberate trim. No stains, cracks, rubble or random weathering unless a story beat
   needs it. Age is shown by soft wear on edges and warmth in colour, not dirt.
3. **Memory as colour.** Saturation is a story device (`satFor`: 0.80 → 1.12 as bells ring). Art must
   hold up desaturated (form and value carry it) and sing when saturated.

## Shape language

- Big → medium → small: roughly 60 / 30 / 10 of visual weight. Every asset has one primary mass, two
  or three secondary forms, and small detail clustered at focal points (faces, hands, doors, emblems),
  with deliberate rest areas between clusters. Even noise everywhere is a defect.
- Valley and villagers: soft, rounded, generous forms; slight lean and taper (nothing perfectly
  vertical or symmetric when it is hand-made).
- The Silence (고요) and its creatures: the same vocabulary *broken* — hollowed, chipped, ash-grey,
  with emissive seams where a remembered colour leaks through. Menacing by design, never gory.
- Bevel every hard edge that catches light. Real thickness on plates, tiles, boards, cloth hems.

## Colour script

Values first: foreground mid-dark, subject brightest-with-most-contrast, distance lighter and cooler.
Never let albedo near 1.0 (bloom threshold is 1.35 linear; bright snow and plaster go ≤ 0.8).

| Place | Key | Accent | Mood |
|---|---|---|---|
| 하늬 valley, village | warm grass greens, honey stone, terracotta roofs | cornflower blue, festival reds | lived-in, safe |
| 서리봉 (frost) | pale teal, blue-white, slate | warm lantern amber | hushed, crystalline |
| 천둥 고원 (storm) | ochre grass, violet-grey sky | electric cyan | wind, tension |
| Outer regions | each its own key (see `src/world/regions/*`) | one accent each | discovery |
| 고요의 틈 (rift) | ash grey, deep indigo | arcane magenta-gold seams | grief, awe |

Element colours are fixed by `EL_INFO` (arcane, fire, wind, frost, storm, water) and must stay
distinguishable from each other and from the region key behind them.

## Materials and shading

- Stylised PBR under toon response: soft two-band ramp with a coloured (not grey) shadow tint, a thin
  warm terminator, rim light on characters, GGX highlights restrained to metal, wet and glossy paint.
- Albedo carries hand-painted value: shadowed hollows slightly darker and cooler, lit crests slightly
  warmer. Do not bake directional lighting that fights the sun.
- Normal maps add *designed* relief (grain, weave, trim, engraving), never random grunge.
- Each material class reads distinctly at 10 m: wood ≠ stone ≠ iron ≠ cloth ≠ skin, by value,
  roughness and pattern scale, not by hue alone.

## Characters

Natural-leaning stylised proportions (TotK-like): eyes only slightly enlarged, normal skull volume,
defined nose, lips and jaw planes. Faces must look like believable, appealing people at game
distance; the child (도담) reads cute, never uncanny. Clothing has layered garments with seams, hems,
real thickness and secondary motion (cape, skirt, hair chains). Clay render first, then textures.

## Environment

- Terrain reads as large natural masses; cliffs are big sculpted volumes, never blocks, cells,
  bricks or grids (see AGENTS.md "암벽").
- Vegetation: canopies are clustered leaf masses with clear light/shadow sides and sky gaps, trunks
  with flare and taper; ground cover breaks up every hard line where ground meets objects.
- Every vista has a focal landmark, a readable path to it, and atmospheric perspective behind it.

## Effects

Each spell has a clear anticipation → release → impact → linger beat (DESIGN.md "마법의 모양과
박자"). Shapes are sharp and graphic (glints, crescents, shock rings), timed in layers, coloured by
element, and never hide the caster or the enemy silhouette. Daylight dims effect lights.

## Interface

One token set (`styles.css`), three type roles, one icon set. Night-blue panels with gold trim;
information over ornament; numbers never jitter. The world is the main screen — the HUD steps aside.

## Review rubric

Every review scores 1–10 on each line, names the single weakest thing, and shows a capture.
"Fine" is not a verdict.

| Line | 10 looks like |
|---|---|
| Silhouette | Reads instantly as a black shape at game distance |
| Form | Primary/secondary/tertiary hierarchy, bevels, real thickness, no lumps or melted edges |
| Surface | Distinct, designed materials; clean; maps sharp at close range, calm at distance |
| Colour & value | Fits the colour script; subject stands out; holds up at 0.80 saturation |
| Cohesion | Looks like it belongs next to its neighbours in the same frame |
| Motion | Weight, anticipation, follow-through; no sliding, popping or jitter |
| Cost | Within triangle, draw-call and frame budgets of AGENTS.md |

A piece ships when no line is below 7 and the weakest line has a concrete plan.
