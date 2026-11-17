# Benchmarks: what "AAA stylised" means for 울림지기

Concrete, checkable targets per area, derived from what Genshin Impact, Zenless Zone Zero (ZZZ), Wuthering Waves (WuWa), Honkai: Star Rail (HSR), Zelda BotW/TotK, Elden Ring, Hi-Fi Rush and Guilty Gear Xrd are publicly known to do. Companion to [ART_DIRECTION.md](ART_DIRECTION.md) (taste) and [../AGENTS.md](../AGENTS.md) (engine facts).

## How to read this document

**Evidence quality is mixed, and this matters.** HoYoverse and Kuro have published very little. Only a few primary sources exist (marked **P**). Most numbers elsewhere are community datamining, guides or my own synthesis (marked **C** community, **E** estimate). Where a figure is an **E**, it is a recommended target, not a measured reference value. Do not quote **C**/**E** values as fact.

Primary sources actually read while writing this:

| Id | Source | What it gave |
|---|---|---|
| P1 | [Genshin console rendering, Unity Dojo 2021 (Zhenzhong Yi, miHoYo)](https://www.docswell.com/s/UnityJapan/KWRPQ5-210617-unity-dojo20211mihoyozhenzhongyi) | Pipeline, shadows, AO, fog, SSR, grading, GPU ms |
| P2 | [Anime-style rendering, Unite Tokyo 2018 (Jack He, miHoYo)](https://www.docswell.com/s/UnityJapan/KWLQP5-unite-tokyo-20183rd) | Ramp layering, outline types, hair, bloom chain |
| P3 | [Hi-Fi Rush toon rendering, GDC 2024](https://gdcvault.com/play/1034330/3D-Toon-Rendering-in-Hi) | 60 fps native deferred toon; face shadow, GI |
| P4 | [Guilty Gear Xrd art talk, GDC 2015](https://www.arcsystemworks.com/guilty-gear-xrd-art-talk-at-game-developers-conference-2015/), [JP report](https://game.watch.impress.co.jp/docs/news/20150307_691725.html) | Limited animation; ~40k tris per character, no normal maps |
| P5 | [Ghost of Tsushima grass, GDC](https://gdcvault.com/play/1027214/contactUs), [wind](https://gamedeveloper.com/design/using-vorticles-to-simulate-wind-in-i-ghost-of-tsushima-i-) | GPU blades, far-LOD problem, vorticle wind |
| P6 | [BotW GDC 2017 report](https://zeldauniverse.net/2017/03/14/takizawa-explains-how-the-wind-waker-hd-inspired-the-visual-style-for-breath-of-the-wild/), [TotK GDC 2024 physics](https://www.zeldadungeon.net/?p=211936) | Art slogan, "easy to lie", all-physics objects |
| P7 | [WuWa on Unreal (Kuro interview)](https://www.unrealengine.com/en-US/developer-interviews/exploring-the-post-apocalyptic-charm-of-asg-open-worlds-in-wuthering-waves) (search snippet only; page returned 403) | Deferred shading chosen; gradients are the toon focus |

Not found despite searching: any official Genshin/ZZZ/WuWa polycount, texture-size, VFX-layer, hitstop or telegraph-frame figures; any Genshin tree-canopy breakdown; any Nintendo rendering talk (the TotK GDC talk was physics/sound). Those rows below are **C**/**E** and say so.

## Priority summary (top findings)

1. **Characters and creatures are the biggest visible gap.** Reference playables are an order of magnitude richer in shading control (multi-ramp, SDF face shadow, anisotropic hair, vertex-colour outline width) than in raw triangles. Triangles are not the lever; shading data and topology are.
2. **Combat feel is numbers, and they are small.** Hitstop of 2-12 frames, i-frame windows near 13-20 frames, telegraphs of 18-30 frames before the hit. Define a frame table and test against it.
3. **Perf headroom is the limiter, not ambition.** Genshin spends ~1.3-1.7 ms on shadows, ~1.5 ms on SSR and under 1 ms on volumetric fog on PS4 Pro class hardware with compute shaders (P1). WebGL2 has no compute. Every feature needs a fragment-only budget. Texture memory (~790 MB uncompressed, per AGENTS.md) is the likeliest crash/stall source; use GPU-compressed textures.
4. **Outline, face shadow and hair are the "anime read" triple.** Get these three right on one hero character first; everything else is secondary.
5. **Verification must be capture-based and repeatable.** Section 11 defines a fixed capture set so scores are comparable between sessions.

---

## 1. Characters

### What the references do

| Topic | Finding | Source / quality |
|---|---|---|
| Triangles | Genshin: one anecdotal 17,616 tris; a fan Hu Tao rebuild is 19,402 polys (not the game mesh) | [polycount thread](https://polycount.com/discussion/comment/2761389/) **C**, [TurboSquid](https://www.turbosquid.com/3d-models/hu-tao-genshin-impact-3d-model-2526313) **C** |
| | Guilty Gear Xrd: ~40k polygons per character, no normal maps | [JP report](https://game.watch.impress.co.jp/docs/news/20150307_691725.html) P4 |
| | Mobile hero range 5k-15k tris at LOD0, console/PC 15k-50k | [azurgames](https://azurgames.com/blog/optimizing-midcore-games-balancing-high-quality-graphics-and-performance-polygon-management), [hitem3d](https://www.hitem3d.ai/ai-faq/what-are-the-industry-thresholds-for-polygon-counts-in-mobile-games) **E** (generic, not HoYo data) |
| Textures | Typical: one or two texture sets per character; 2048 common, 4096 for hero/face | [futureverse guide](https://docs.futureverse.com/dev/build-an-asset/asset-creation/resource-creation/resource-creation-guidelines/modeling/polycount) **E** |
| Ramp | Multiple 2D ramps for diffuse and specular, stackable 1-3 layers; vertex colour masks diffuse strength and softens face shading | P2 slides 23-26 |
| "Cloud"/lightmap texture | RGBA: R and G shadow layers, B rim layer (miHoYo Honkai-era), alpha selects sub-material region so one mesh uses several ramps | P2; [MMDGenshin wiki snippet](https://github-three-lyart.vercel.app/Hoyotoon/MMDGenshin/wiki/3.)-Editing-the-material-values) **C** |
| Face shadow | Threshold/SDF texture holds left-light coverage for 0-180 degrees on the XZ plane; flipped for right light; compared with forward-dot-light. Needs high-quality uncompressed sampling (no sRGB, high compression quality). Self-shadow mapping on the face is hidden with a position offset, which breaks received shadows up close | [URPSimpleGenshinShaders](https://github.com/NoiRC256/URPSimpleGenshinShaders) **C**, [SDF workflow](https://sydianandrewchen.github.io/projects/3-stylized-facial-shadow-workflow) **C** |
| Outline | Three families: geometry (inverted hull) needing continuous vertex normals, width in vertex colour, perspective-corrected; enhanced geometry that detects crease edges; image-space (normal+depth, constant cost) | P2 slides 40-42 |
| Hair | Anisotropic highlight from tangent, up to three highlight layers, jitter map for strand variation | P2 slides 31-37 |
| Self-shadow | Characters often do not self-shadow; shading is light-direction driven | [Ben Ayers breakdown snippet](https://bjayers.artstation.com/blog/category/5) **C** |
| Animation style | Xrd removes "3D look": key-pose limited animation, custom lights per character, faces kept bright | P4 |

### Target for 울림지기 (all **E** unless a source row above applies)

| Item | Target | Check |
|---|---|---|
| Playable (LOD0) | 25k-40k tris (current: 6.5k-10k). Ceiling is set by skinning cost in WebGL2, see section 10 | `renderer.info` + glTF stats per file |
| Principal NPC / companion | 15k-25k | same |
| Background NPC | 6k-10k | same |
| LOD chain | LOD1 50%, LOD2 20%, imposter/cull beyond 60 m | visual pop test at 3 distances |
| Face | Own mesh/material, 4k-6k tris, quad topology with loops around eyes, mouth, nasolabial line; blend shapes for at least 12 visemes/expressions | wireframe capture; clay render |
| Hair | Layered clumps (8-20 cards/shells per hairstyle), 3 specular layers (anisotropic), tangent from strand direction; 2-4 chain segments per clump for secondary motion | hair-only capture under 3 light angles |
| Cloth | Cape/skirt on chains (already present), hems with real thickness; tris concentrated at hems and folds | motion capture, walk to stop |
| Maps | Per character: albedo 2048 (face 1024 own set), "ILM-style" mask 2048 (R spec/metal mask, G shadow-ramp row selector, B detail/AO, A emissive or material id), SDF face 512-1024 single channel pair (0-180, 180-360), normal only where it adds designed relief | texture list audit |
| Ramp | Per-material ramp row from a shared 256x16 ramp atlas, rows for day/dusk/night (time-of-day shifts the row) | shader inspection + capture at 3 hours |
| Outline | Inverted hull, width from vertex colour R, perspective-corrected: ~1.0-1.5 px at 1080p hero distance, thinner on face (0.6-1.0 px), thicker on silhouette-defining edges; colour = darkened albedo (multiply 0.35), not black | zoom capture at 3 m, 10 m, 30 m: outline never vanishes (<0.5 px) or exceeds 2.5 px |
| Eyes | Separate layers: iris, highlight, lash/lid; highlight pinned to light, not to eye rotation; blink 3-6 s with random double blink | close-up capture |
| Secondary motion | Hair, cape, accessories simulated with Verlet chains; wind drives them (already in `Chain`) | video: no jitter at rest, no stretching on teleport |

### Verify
- Clay render, front/3-quarter/side (the existing ART_DIRECTION gate) plus wireframe.
- Same character at hour 8, 12, 17.5 and in snow: face never fully black, ramp colour never grey.
- Silhouette test: black fill at 15 m reads as the character.
- Triangle and texture inventory table committed with the PR.

---

## 2. Creatures

### What the references do
| Topic | Finding | Source / quality |
|---|---|---|
| Form | Fighting-game and gacha bosses are single continuous skinned meshes with a clean silhouette; hit zones are painted in material, not separate parts | P4 principle ("avoid the 3D look") |
| Material breakup | Sub-material regions via lightmap alpha let one mesh carry skin, armour, glow with separate ramps | P2 |
| Emissive | Emissive areas double as readable weak points / phase indicators; bloom threshold must sit above diffuse | E, consistent with AGENTS.md bloom 1.35 |

Little else is public; the rest is **E**.

### Target
| Item | Target | Check |
|---|---|---|
| Small (<1 m) | 3k-6k tris | stats |
| Medium (humanoid) | 12k-25k | stats |
| Large (2-4 m) | 25k-50k | stats |
| Boss (4 m+) | 50k-100k LOD0, LOD1 at 40% | stats; frame time during boss test under budget |
| Construction | One continuous body per creature; armour/props separate rigid pieces that conform. No stacked primitives (already a rule) | clay render |
| Material breakup | 3-5 material regions via ILM alpha: body, hard shell, soft/fur, emissive seam, eyes | map audit |
| Emissive design | Exactly one phase colour per element; emissive = telegraph + weak point + hit flash; intensity at idle 1.4-2.0 (just over bloom), at windup ramps to 3.0 | capture idle vs windup |
| Silhouette | Distinct from player at 25 m; attack-limb silhouette (the part that hits) is the widest/most contrasty element | black-silhouette test, 25 m |
| Weak-point read | Glow visible at 30 m in daylight and snow | capture at hour 12, snow region |

---

## 3. Environment

### What the references do
| Topic | Finding | Source / quality |
|---|---|---|
| Art goal | BotW: "easy to lie" style balancing playability and realism, grown out of Wind Waker toon | [P6](https://zeldauniverse.net/2017/03/14/takizawa-explains-how-the-wind-waker-hd-inspired-the-visual-style-for-breath-of-the-wild/) |
| Grass | Ghost of Tsushima: GPU-generated blades, each procedurally varied; far-distance LOD is the hard part | P5; "~83,000 blades at ~2.5 ms" is [unverified](https://hashnode.com/posts/what-we-can-learn-from-grass-in-ghost-of-tsushima-renders/69e130b2ffbb787634eb9ef4) **C** |
| Grass shape | V-shaped blade model gives more coverage with fewer blades | [search snippet re GoT talk](https://godotengine.org/qa/76172/render-grass-like-horizon-zero-down-mean-grass-areas-where-hide) **C** |
| Tree canopy | **No primary source found for how Genshin builds canopies.** Common industry stylised approach: clustered alpha-card leaf clumps with normals blended toward a sphere (soft round shading), with painted leaf atlas | **E**; matches the current implementation (cards + clustered clumps) |
| Shadows | Cascaded, up to 8 cascades with caching (4 updated every frame, 4 interleaved); screen-space soft shadow only on penumbra pixels via a 1/4-res mask | P1 |
| AO | HBAO for detail, precomputed AO volumes for static objects, capsule AO for characters, half-res bilateral upsample | P1 |
| Reflection | Reflection probes baked as mini G-buffers; planar reflection at 1/3 res or lower for water | P1, P2 |

### Target (**E**)
| Item | Target | Check |
|---|---|---|
| Texel density | Hero props/buildings 512 px/m; general props 256 px/m; terrain/rock detail 128-256 px/m tiled; one density per frame within +/-25% | debug checker texture capture |
| Modular kits | Buildings from a kit of <=40 pieces on a 1 m / 2 m grid with 0.5 m trim; trim sheet of 8-12 trims at 2048 shared across all buildings | piece inventory; assemble 3 distinct houses |
| Vertex colour | R = AO, G = moss/dust mask, B = edge wear/painted highlight, A = foliage mask (already used) | vertex colour view capture |
| Paving close-up | At 1.5 m: individual stone silhouettes with bevel, tonal variation across stones (+/-8% value), grout recessed 1-2 cm via normal/POM, no repeat visible over 6 m | close-up capture at 1.5 m and 6 m, repeat check |
| Terrain transitions | Height-blended materials (grass to dirt to rock to snow), blend width 0.3-1.0 m, never a linear fade; paths with soft worn edge | 4 transition captures |
| Cliffs | Big sculpted volumes, one major + two secondary + tertiary forms per 30 m of face (already a rule); no repeating blocks | cliff capture at 3 distances |
| Grass | Near field (<=15 m): >=150 blades/m2 stylised V-clumps, clump width 8-14 cm; mid (15-60 m): density halved via thicker blades; far: terrain-colour only. Wind: two-scale (large travelling gust + small flutter), phase by world position; push-away from player/enemies within 1.5 m, recover in 1.0-1.5 s | video, 20 s, in wind |
| Trees | Canopy = 8-20 clumps, each clump with spherical-blended normal, light side/dark side, visible sky gaps; trunk with root flare and 2-3 major limbs; LOD0 8-25k tris, LOD1 2-5k, LOD2 imposter/billboard | wireframe + canopy backlit capture |
| Water | Layers: depth colour, shore foam line, flow-aligned ripple normals, soft depth fade at edges, planar reflection at 1/2 res on highest tier, caustics on shallow bed | capture at shore, deep, rain |
| Landmarks | Every vista: focal landmark + readable path + aerial perspective | 5 vista captures with value-only (greyscale) pass |

---

## 4. Lighting and rendering

### What the references do
| Topic | Finding | Source / quality |
|---|---|---|
| Model | Genshin is stylised PBR: lighting model altered per material, not energy conserving | P1 |
| Lights | Clustered deferred, up to 1024 lights in view (64x64 tiles x 16 depth slices), ~100 real-time shadow lights | P1 |
| Fog | Volumetric fog in camera froxels aligned to light clusters, ray-marched with temporal filter, under 1 ms; separate half-res god-ray pass (up to 5 cascades) because fog-based shafts got dirty | P1 |
| GI/ambient | Ambient SH from relit reflection probes (3-band SH), interior mask separates indoor/outdoor | P1 |
| SSR | ~1.5 ms on PS4 Pro with Hi-Z, previous-frame colour, temporal filter | P1 |
| Grading | Grade baked into a wide-gamut LUT (<0.05 ms); ACES RRT+ODT deliberately **not** used because it did not suit the style; hue shift simulated in shader | P1 |
| Bloom | Downsampled chain 1/4, 1/8, 1/16, 1/32 | P2 slide 8 |
| Resolution | PS4 1440p output 1080p; Pro native 4K | P1 |
| WuWa | Deferred chosen for materials/weather/day-night; "primary focus on gradients" for the toon look | P7 |
| Hi-Fi Rush | 60 fps native deferred toon, light-probe GI, static + dynamic shadow maps | P3 |
| Volume light | Blue-noise dither + TAA | P2 slide 45 |

### Target (**E**)
| Item | Target | Check |
|---|---|---|
| Shading | Characters: multi-ramp (section 1). World: 2-band soft ramp with coloured shadow (exists); add per-material ramp row to keep wood/stone/cloth distinct | material board capture |
| Rim | Fresnel x light-facing mask, warm in sun, cool in shade; width ~0.15 NdotV band; strength reduced in overcast | rim capture at 3 hours |
| Ambient | Hemisphere + 3-band SH from sky, tinted by region; shadow side colour is hue-shifted cooler by 15-30 degrees from lit side, never grey | sample pixel values: shadow-lit hue delta |
| Shadows | 2 cascades now (CSM); target 3 cascades, 4 k atlas total, texel at hero distance <= 3 cm, soft penumbra only on penumbra pixels (P1 trick) | shadow-edge zoom capture |
| Fog / aerial | Height fog + distance fog tinted by sky colour toward horizon; value at 400 m should be 25-40% lighter and cooler than at 20 m | greyscale vista test, measure luminance ratio |
| Sky/clouds | Existing volumetric cumulus dome is already above WebGL norm; add golden-hour rim on cloud edges | hour 17-18.5 capture |
| God rays | Half-res, 8-16 samples, blue-noise + temporal accumulation | capture with sun at 20 degrees |
| Bloom | Threshold stays 1.35; mip chain 5 levels; strength tied to hour | check no albedo bloom |
| Tonemapping | Custom filmic with controlled hue shift (not stock ACES), LUT-based grade per region and hour | LUT inspection |
| AA | MSAA 4x (present) plus optional TAA/SMAA on foliage; no shimmer on grass/leaf edges in motion | 5 s video crawl past a hedge |
| Golden hour | Sun 8-15 degrees elevation, colour ~ (1.0, 0.72, 0.45) linear, shadows violet-blue, long soft shadows, sky gradient orange to teal | capture hour 17.5 |
| Snow | Albedo <= 0.8; blue-white bounce in shadow, sparkle only in sun (specular noise); lantern amber accent; avoid overexposure | capture at 서리봉 at 12:00 and 17:30; histogram: no clipped >2% |

---

## 5. VFX

### What the references do
Public frame-level VFX breakdowns of Genshin/ZZZ/HSR do not exist (searched). Evidence is guide-level.

| Topic | Finding | Source / quality |
|---|---|---|
| Hitstop ranges | Light 2-4 frames, medium 5-8, heavy 8-12 (60 fps); heavy weapons 6-10 | [uhiyama-lab](https://uhiyama-lab.com/en/notes/unity/unity-game-feel-hit-feedback/) **C** |
| FFXVI | A fan analysis reports 4-frame hitstop plus a short glow before heavy hits | [fan breakdown via search](https://rpgsite.net/feature/12855-final-fantasy-xvi-battle-system-analysis-combat-mechanics-revealed-in-the-latest-gameplay-trailer) **C** |
| Genshin timing base | Community frame data counts at 60 fps; hitlag in seconds rounded up to frames | [KQM frames](https://library.keqingmains.com/combat-mechanics/frames) **C** |
| ZZZ | Ultimates animated so each frame differs (hits land on a body) | [Pocket Tactics](https://pockettactics.com/zenless-zone-zero/interview-2) |
| Bloom/refraction | Bloom chain + dynamic-res DOF (P2); refractive heat/shock distortion (AGENTS.md already) | P2 |

### Target (**E**; 60 fps frames)
| Beat | Frames | Notes |
|---|---|---|
| Anticipation (windup, charge glow at staff) | 6-12 (basic) to 12-24 (heavy), ult 24 | Existing `WINDUP` 0.1-0.2 s = 6-12 frames is on target |
| Release flash | 1-2 | cross glint, 0 frame |
| Travel | by speed | trail ribbon length >= 6 frames of motion |
| Impact layers | 0 f flash + glint; 2-3 f ring; 3 f spark burst; 4-8 f smoke/steam; 30-60 f decal/linger | stagger start times (0 / 3 / 6 frames) |
| Hitstop | light 3, medium 5, heavy 8, big finisher 10-12 | combined cap 0.15 s (exists) |
| Camera shake | light 0 (or 1 px), medium 3-4 px decays in 8 f, heavy 8 px in 14 f, ult 12 px in 20 f; 2D-directional along hit axis | video measure |
| Screen flash | max 2 frames at <= 25% white, reduced by day (exists) | no photosensitivity risk: <3 flashes/s |
| Shape language | Sharp crescents, glints, rings; element-specific silhouette | no round blobs only |
| Budget | <= 150 additive particles per spell at full size, <= 3 full-screen transparent layers, particle overdraw sum <= 4 layers average over the screen | overdraw debug view (additive heatmap) |
| Readability | Caster and target silhouette stay readable at peak | black-silhouette-of-VFX test |

### Verify
Frame-step capture (60 fps video, step 1 frame) of 3 spells per element: confirm beat timings against the table.

---

## 6. Animation

### What the references do
| Topic | Finding | Source / quality |
|---|---|---|
| Limited/keyed motion | Xrd: key-pose animation without in-betweens to preserve a 2D read | P4 |
| ZZZ | "Hit weight, smoothness of action, how good it feels" are the stated differentiators vs Honkai 3rd | [Siliconera](https://www.siliconera.com/how-zenless-zone-zero-combat-differs-from-honkai-impact-3rd/) |
| Genshin attacks | Normal attack = startup, hitmark (before or during hitlag), recovery; recovery set by next attack; inputs out of dash have longest N1 | [KQM](https://library.keqingmains.com/combat-mechanics/frames) **C** |
| Dash i-frames | ~300 ms starting 40 ms after input (unverified) | [bittopup](https://news.bittopup.com/news/ayaka-mona-sprint-guide-300ms-i-frames-combat-tips) **C** |

### Target (**E**)
| Item | Target | Check |
|---|---|---|
| Locomotion | Walk/run/sprint with speed-matched stride (foot never slides >2 cm/frame on flat), start 8-12 f lean, stop 6-10 f with plant, turn-in-place 90 degrees in 12 f, 180 in 18 f | slide measurement from recorded foot positions |
| Foot IK | Slopes and stairs (exists); pelvis drop smoothed 0.1 s | slope video |
| Root motion | Attacks/dodge move root by authored curves, not constant velocity; ease-out in last 30% | position graph |
| Cast timing | Windup 6-12 f, release pose hold 4 f, recovery 12-18 f cancelable by dodge from frame 6 of recovery | frame-step video |
| Hit reaction | Light flinch 8-12 f (upper body only), heavy stagger 20-30 f, knockdown 40-60 f + 20 f getup | enemy test |
| Camera (explore) | Spring follow lag 0.15-0.25 s, look-ahead on run, FOV 60-65, pitch clamp so horizon sits at upper third | video |
| Camera (combat) | Lock-on framing keeps target at screen centre-third; shake per section 5; no automatic yaw during dodge | video |
| Dialogue framing | Over-the-shoulder pair, 35-50 mm equivalent, eyes at upper third, 0.65 s blends (exists), subtle breathing push-in 1-2% over 5 s | stills |

---

## 7. Combat and AI

### What the references do
| Topic | Finding | Source / quality |
|---|---|---|
| Elden Ring roll | Disputed: some sources say light and medium rolls both have 13 i-frames and 8 recovery frames; i-frames start ~30% into the roll | [gamertagmythras](https://gamertagmythras.com/blog/elden-ring/elden-ring-equip-load-guide) **C**, [Steam thread](https://steamcommunity.com/app/1245620/discussions/0/3183488149022368269) **C** |
| Delayed attacks | Many bosses delay swings so early rolls miss i-frames | [wiki mirror](https://bestgamerst.netlify.app/host-https-eldenring.wiki.fextralife.com/Dodging) **C** |
| ZZZ perfect dodge | Guides: dodge ~3-5 frames before impact; invuln ~25-30 f perfect vs 10-15 regular (conflicting); yellow attacks parry, red attacks must be dodged; audio cue 5-10 frames before visual | [bahomu](https://www.bahomu.com/blogs/game-guides/advanced-guide-jane-doe-dodge-counters-iframes-zenless-zone), [GameSkinny](https://gameskinny.com/tips/how-to-parry-in-zenless-zone-zero) **C** |
| Genshin | No official i-frame/hitstop numbers found | n/a |

### Target (**E**)
| Item | Target | Check |
|---|---|---|
| Telegraph | Basic attack: 18-24 f visual+audio; heavy: 30-45 f; boss signature: 45-70 f with ground marker; last 6 f no tracking (commit) | frame-step timing sheet per attack |
| Perfect-dodge window | 8 f before hit; reward slowmo (exists) | log |
| Dodge i-frames | 14-18 f start at frame 3, recovery 10 f; cooldown/stamina costs | log |
| Colour code | One unblockable/dodge-only colour (red) and one parry/blockable colour (gold), identical across all enemies | audit |
| Tokens | Max 2 simultaneous attackers in melee range, 1 ranged; others circle/wait; token handed off every 1.5-3 s | AI log with 6 enemies |
| Knockback | Light: 0.3 m, heavy: 1.5-3 m with 20-30 f stagger; no chain-lock > 1.5 s on player | test |
| Boss | 3 phases (exists), phase transition <= 3 s invulnerable cinematic beat, fight length 3-6 min; each pattern seen at least 3x before a combo layers it | playtest timing |
| Fairness | Every damaging attack has distinct sound + glow telegraph; no off-screen unannounced damage | blind playtest |

---

## 8. Physics and world interaction

### What the references do
| Topic | Finding | Source / quality |
|---|---|---|
| TotK | Removed non-physics (animation-driven) objects so everything interacts with Ultrahand; layered in-house physics on top of Havok; "build a system that makes fun things happen" | [zeldadungeon](https://www.zeldadungeon.net/?p=211936), [digitaltrends](https://digitaltrends.com/computing/how-nintendo-designed-tears-of-the-kingdom-physics) |
| Wind | Ghost of Tsushima uses a GPU global wind field with "vorticles" prioritising volume over accuracy | P5 |
| Grass interaction | Typical: player position passed to shader, outward displacement, distance-limited | [general technique](https://www.alanzucconi.com/2018/07/28/shader-showcase-saturday-3/) **C** |

### Target (**E**)
| Item | Target | Check |
|---|---|---|
| Props | Barrels/crates/rocks (exists) plus: foliage bends from spells (blast pushes grass radially for 1 s), banners/lanterns sway in wind, hanging objects respond to impacts | per-effect video |
| Wind field | One low-res 2D wind texture (e.g. 64x64 around the camera) advected over time; grass, trees, cloth, banners, particles sample it; gusts visible as traveling ripple | wind debug view |
| Water | Player/enemy footfalls spawn ripples; spells make splash rings and steam; swimming wake; depth foam | video at lake |
| Elemental reactions | Fire burns grass (exists), frost freezes water surface (walkable ice sheet), storm electrifies puddles (exists), wind spreads fire, wet state conducts | reaction matrix table with video per cell |
| Debris | Fixed pool of 40 debris bodies, sleep after 2 s | profile |
| Determinism | Physics step fixed 60 Hz, independent of render rate | test at 30 and 144 fps |

---

## 9. UI/UX

### What the references do
| Topic | Finding | Source / quality |
|---|---|---|
| Exploration HUD | Genshin reduces on-screen elements while exploring; layered transparent menus, strong typography, readable on small screens | [pixune review](https://pixune.com/blog/best-examples-mobile-game-ui-design/) **C** |
| Combat text | Damage numbers coloured by element | [uxdesign.cc](https://uxdesign.cc/5-videogame-ui-staples-and-how-to-use-them-2646ab3f9d09) **C** |
| Metaphor | Menus framed as in-world objects (spellbook, star map) | [pocketgamer.biz](https://www.pocketgamer.biz/the-magic-that-makes-mobile-ui-look-good-and-feel-great) **C** |

### Target (**E**)
| Item | Target | Check |
|---|---|---|
| Exploration HUD | <= 6 persistent elements; fade to 30% after 4 s idle; hide minimap detail in cutscenes | capture exploring |
| Combat HUD | Health, mana, spell bar, target frame, enemy bars only; each element < 8% of screen width | capture |
| Frame vocabulary | One panel frame, one button state set (idle/hover/pressed/disabled/focus), 3 icon sizes (24/32/48) | style audit page |
| Text | Body >= 16 px at 1080p, UI labels >= 13 px; contrast >= 4.5:1 on dark and >= 3:1 over bright snow with rim; Korean glyph coverage in both display and text fonts | contrast tool + capture |
| Motion | Entrances 180-260 ms ease-out; exits 120-160 ms; no layout shift on number changes; reduced-motion honoured | recording |
| Notifications | Max 1 banner + 1 toast simultaneously, minor style default (exists); queue with minimum 2.5 s | test |
| Dialogue | 1-2 sentences, 18-30 chars/s typewriter, portrait/name plate stable, choice list with number keys | capture |
| 1080p/1440p | Layout validated at 1920x1080 and 2560x1440 plus 1600x900 (UI scale exists) | 3 captures |

---

## 10. Performance (WebGL2, 60 fps, mid-range GPU, 1440p)

### What the references say
| Topic | Finding | Source / quality |
|---|---|---|
| Genshin GPU costs (PS4 Pro class) | Shadows 1.3-1.7 ms, SSR ~1.5 ms, volumetric fog <1 ms, LUT grade <0.05 ms; over half the console features use compute shaders | P1 |
| Shadow memory | Baked shadow textures compressed ~20-30:1 | P1 |
| WebGL guidance | 16.67 ms frame; draw calls matter more than triangles; common ceilings 200-500 draw calls on mobile/desktop, <=1000 absolute on r3f; triangles ~500k mobile, ~2M desktop | [r3f docs](https://r3f.docs.pmnd.rs/advanced/scaling-performance), [3lens guide](https://3lens.vercel.app/guide/features/performance) **C** |
| Hi-Fi Rush | 60 fps native with a deferred toon pipeline | P3 |

### Budget proposal for 울림지기 (**E**)
Assume a GPU in the GTX 1660 / RX 6600 / integrated-high-end class at 1440p, using dynamic resolution (exists: `pace`).

| Resource | Budget |
|---|---|
| Frame | 16.6 ms total; CPU update+render submit <= 6 ms; GPU <= 14 ms |
| GPU split | Shadows 2.0, opaque scene 5.0, grass/foliage 1.5, water+reflect 1.0, post (bloom, fx, grade) 2.5, VFX 1.5, UI composite 0.5 |
| Draw calls | <= 900 main + shadow (current village 500-900 is at the ceiling; forest ~170) |
| Triangles | <= 1.5M visible incl. characters (current village ~1M) |
| Characters on screen | <= 12 at LOD0/1 total 400k tris |
| Texture memory | <= 600 MB GPU resident; use KTX2 (Basis ETC1S/UASTC) so ASTC/BC7/ETC2 stay compressed (~4-8x saving). Uncompressed monsters (430 MB) + characters (360 MB) estimates from AGENTS.md exceed this |
| Streaming | Terrain chunk jobs <= 3 ms/frame (exists), texture upload <= 2 MB/frame, no shader compile after boot (exists) |
| Programs | Stable `renderer.info.programs.length` (exists) |
| Heap | JS heap < 1.5 GB, no growth > 5 MB/min while idle (leak check) |

Implications for WebGL2 specifically:
- No compute shaders. Genshin's compute-based passes (froxel fog, SSR Hi-Z, culling) need fragment-shader variants at lower resolution, e.g. half-res froxel-free fog and screen-space god rays (already). Skip SSR; planar reflection on water only (already).
- No bindless/MultiDrawIndirect. Keep merging and instancing (exists).
- Skinned mesh cost scales with joints x vertices in vertex shader; keep joints <= 64 (playable) / <= 40 (creatures) and use shared skeleton instances.
- Texture compression (KTX2) is the single biggest memory lever; mip bias for characters.
- Target tier mapping: 낮음 targets 30 fps/1080p, 보통 60 fps/1080p, 높음 60 fps/1440p, 최상 60 fps/1440p with reflection.

### Verify
- 60 s scripted flythrough per region plus a combat scene; log p50/p95/p99 frame time, draw calls, tris, `renderer.info.memory`, JS heap. Pass: p95 <= 16.6 ms on the reference GPU, p99 <= 22 ms, no hitch > 50 ms outside loading.

---

## 11. Verification protocol

Capture set (fixed seeds, `?dev=` presets, hour pinned, same resolution 2560x1440, HUD on and off):

| Id | Shot | Areas covered |
|---|---|---|
| V1 | Hero character close-up 1.5 m, hours 8/12/17.5 | 1, 4 |
| V2 | Hero at 15 m silhouette | 1, 2 |
| V3 | Village plaza paving 1.5 m and 6 m | 3 |
| V4 | Forest canopy backlit, grass in wind video 20 s | 3, 8 |
| V5 | Cliff + terrain transitions at 3 distances | 3 |
| V6 | Lake shore, rain on/off | 3, 8 |
| V7 | Golden-hour vista and snow vista, greyscale pass | 4 |
| V8 | One spell per element, frame-step video | 5, 6 |
| V9 | Enemy attack set, frame-step | 7 |
| V10 | Boss phase transitions, timing log | 7 |
| V11 | HUD exploring + combat, 1080p and 1440p | 9 |
| V12 | Perf flythrough log | 10 |

Score each against the 1-10 rubric in ART_DIRECTION.md; append measured numbers to the PR.

---

## 12. Prioritised gap list vs current implementation (from AGENTS.md)

Priority: P0 = visibly below reference and blocking the "AAA" read; P1 = clear gap; P2 = polish.

| Area | P0 | P1 | P2 |
|---|---|---|---|
| 1 Characters | Tris 6.5-10k vs 25-40k target; no SDF face shadow / ILM mask / multi-ramp documented; outline width control by vertex colour not documented | Hair anisotropic multi-layer; face blend shapes; eye layers | Outline colour per material; cloth hem thickness pass |
| 2 Creatures | Uniform continuous-form audit (울음탈 is old quality); weak-point emissive language | Boss LOD chain; material breakup via mask alpha | Silhouette tests per creature |
| 3 Environment | Tree canopy and paving to reference level (clump normals, close-up stone read); texture density consistency | Modular kit + trim sheet formalised; grass density/interaction budget; terrain transition width rules | Outer-region tree coverage (none beyond r=226 m) |
| 4 Lighting | Shadow-side hue shift and golden-hour/snow colour scripts verified by numbers; per-material ramp rows | 3 cascades; custom filmic tone curve with hue shift (P1 notes ACES unsuitable); god-ray quality | TAA/SMAA option for foliage shimmer |
| 5 VFX | Frame-table compliance audit (anticipation/impact/linger stagger); overdraw budget measured | 11 weaves, 17 reactions, ult bodies still undesigned (AGENTS.md known limits) | Lighting dim by day (exists) |
| 6 Animation | Foot slide measurement; start/stop/turn frame budgets | Enemy getup animation (currently whole-body tilt); footstep timer mismatch | Dialogue push-in |
| 7 Combat/AI | Telegraph timing sheet and colour code (red/gold); attack tokens | Boss balance by humans (not done); knockback caps | No pathfinding for enemies (known limit) |
| 8 Physics | Unified wind field driving grass, trees, cloth, banners | Grass/foliage reaction to spells and bodies; ice sheet on water | Debris pool cap |
| 9 UI | Contrast audit on snow; exploring-HUD auto-fade | Per-skill icons (none yet); dialogue portraits (none yet) | Motion timings audit |
| 10 Performance | Texture memory: KTX2 compression (current estimate ~790 MB uncompressed vs 600 MB budget); p95 frame-time logging | Skinned-mesh joint budgets; bundle splitting (1.3 MB) | Tier mapping documented |

### Suggested first sprint (smallest path to visible gain)
1. KTX2 texture pipeline plus perf logging harness (unblocks everything else, section 10).
2. One hero character to full reference: topology, SDF face shadow, ILM mask, multi-ramp, outline width, hair (sections 1, 4).
3. Combat frame table applied to player dodge, one enemy and one boss (sections 5-7).
4. Wind field plus grass interaction (section 8).
5. Golden-hour and snow colour script with measured values (section 4).
