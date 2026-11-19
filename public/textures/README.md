# Textures

Scanned cliff rock, copied into the surface layers at boot (`src/render/surfaces.js`, `SCANS`).
Only the relief is used; colour is painted by the terrain shader.

| Files | Source | Licence |
|---|---|---|
| `cliff_blocks_n.webp`, `cliff_blocks_h.webp` | Poly Haven, "Marble Cliff 03" by Amal Kumar, https://polyhaven.com/a/marble_cliff_03 | CC0 |
| `cliff_beds_n.webp`, `cliff_beds_h.webp` | Poly Haven, "Cliff Side", https://polyhaven.com/a/cliff_side | CC0 |

`_n`: R, G = tangent-space normal (OpenGL convention), B = ambient occlusion. `_h`: height,
stretched to the full range. Made from the 2k JPEG maps, resized to 1024.

`fire-density.png` is an original procedural fire atlas generated for this game.
Its 96 frames contain a rising plume, expanding gas and smaller grass-fire eddies.
Each 128 × 128 projection stores heat, emissive density, soot and coverage in RGBA.
The shaders interpolate consecutive frames in linear space before calculating HDR emission.
