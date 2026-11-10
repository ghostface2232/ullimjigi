// Surface detail library: tileable material layers baked on the GPU at boot into two
// texture arrays, sampled in world space by the toon materials (materials.js).
//   uSurfA: rgb = albedo multiplier (0.5 = unchanged), a = height
//   uSurfN: rg = tangent-space normal xy, b = roughness, a = cavity (1 = open, lower in grooves)
// Every layer is a height function made of periodic noise, so it tiles exactly; the normal
// comes from that height by finite differences. Mipmaps + anisotropy keep it stable far away,
// which per-pixel procedural patterns could not do.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// layer index and tile size in metres (how much world one repeat covers)
export const SURF = {
  grass: [0, 4], dirt: [1, 3], rock: [2, 6], sand: [3, 3], snow: [4, 4], stone: [5, 2.2],
  plaster: [6, 2.6], planks: [7, 1.5], roof: [8, 1.6], bark: [9, 1.1], paving: [10, 2.8], wood: [11, 1.0], boulder: [12, 3.2],
};
const LAYERS = 13;

const FS = /* glsl */ `
precision highp float;
uniform int uLayer;
uniform int uOut;      // 0: albedo + height, 1: normal + roughness + cavity
uniform float uPx;     // one texel in uv
varying vec2 vUv;
const float TAU = 6.2831853;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 h22(vec2 p){ float n = h21(p); return vec2(n, h21(p + n * 31.7 + 17.1)); }
// value noise on a lattice that wraps every 'per' cells
float vn(vec2 p, vec2 per){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h21(mod(i, per)), b = h21(mod(i + vec2(1.0, 0.0), per)), c = h21(mod(i + vec2(0.0, 1.0), per)), d = h21(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 uv, vec2 per, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 7; i++) { if (i >= oct) break; s += a * vn(uv * per + float(i) * 7.3, per); n += a; a *= 0.5; per *= 2.0; }
  return s / n;
}
// wrapping Voronoi: x = distance to the nearest site, y = to the second, z = site id
vec3 voro(vec2 p, vec2 per, float jit){
  vec2 n = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)), c = mod(n + g, per);
    vec2 r = g + (h22(c) - 0.5) * jit + 0.5 - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = h21(c + 7.7); } else if (d < f2) f2 = d;
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}

// Faceted relief: the upper envelope of tilted bowls, one per scattered site. Where two meet
// the crease is a straight line at whatever angle the two tilts give, so a face breaks into
// angular planes with no rows, columns or cells of one size.
// x = height, y = gap to the next bowl (0 on a crease), z = facet id
vec3 facets(vec2 p, vec2 per){
  vec2 n = floor(p), f = fract(p);
  float b1 = -1e3, b2 = -1e3, id = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = vec2(float(i), float(j)), c = mod(n + g, per);
    // a third of the sites are left out, so their neighbours spread: planes of mixed sizes
    if (h21(c + 3.3) < 0.34) continue;
    vec2 r = f - g - h22(c);
    float z = h21(c + 5.1) * 0.4 + dot(r, (h22(c + 13.7) - 0.5) * 1.4) - 0.5 * dot(r, r);
    if (z > b1) { b2 = b1; b1 = z; id = h21(c + 7.7); } else if (z > b2) b2 = z;
  }
  return vec3(b1, b1 - b2, id);
}

// One layer: height (0..1), albedo multiplier around 1, roughness. Normal strength in nk.
struct Surf { float h; vec3 c; float r; float nk; };
Surf surf(vec2 uv){
  Surf s; s.h = 0.5; s.c = vec3(1.0); s.r = 0.85; s.nk = 1.0;
  if (uLayer == 0) {
    // turf: short tufts lying every which way over soft mounds
    float m = fbm(uv, vec2(5.0), 3);
    float a = vn(uv * vec2(110.0, 26.0), vec2(110.0, 26.0)), b = vn(uv * vec2(26.0, 110.0) + 3.1, vec2(26.0, 110.0));
    float d = vn(uv * vec2(64.0) + 9.0, vec2(64.0));
    float tuft = max(a * (0.6 + 0.4 * d), b * (1.0 - 0.4 * d));
    float fine = fbm(uv, vec2(40.0), 3);
    s.h = 0.3 * m + 0.5 * tuft + 0.2 * fine;
    float patchy = fbm(uv + 0.37, vec2(3.0), 3);
    s.c = vec3(0.86 + 0.3 * tuft) * mix(vec3(1.05, 1.0, 0.86), vec3(0.93, 1.0, 1.06), patchy);
    s.c *= 0.92 + 0.16 * m;
    s.r = 0.9; s.nk = 0.9;
  } else if (uLayer == 1) {
    // packed earth: fine grit, half-buried pebbles, a few shallow ruts
    float m = fbm(uv, vec2(6.0), 5);
    vec3 v = voro(uv * 22.0, vec2(22.0), 0.9);
    float peb = smoothstep(0.3, 0.14, v.x) * step(0.72, v.z);
    vec3 v2 = voro(uv * 46.0 + 5.0, vec2(46.0), 0.95);
    float grit = smoothstep(0.3, 0.1, v2.x) * step(0.5, v2.z);
    float rut = smoothstep(0.42, 0.5, vn(uv * vec2(3.0, 9.0) + 2.0, vec2(3.0, 9.0)));
    s.h = 0.5 * m + 0.26 * peb + 0.12 * grit - 0.1 * rut + 0.08;
    s.c = vec3(0.84 + 0.3 * m) * mix(vec3(1.0), vec3(1.04, 1.0, 0.94), fbm(uv + 0.5, vec2(4.0), 2));
    s.c = mix(s.c, vec3(1.1, 1.09, 1.08) * (0.8 + 0.3 * v.z), peb * 0.6);
    s.c *= 1.0 - 0.14 * rut;
    s.r = mix(0.9, 0.62, peb); s.nk = 1.3;
  } else if (uLayer == 2) {
    // cliff face: tall angular planes meeting in valleys, smaller chips standing out as
    // ridges across them, the odd long fracture; light and shade do the drawing, not lines
    vec2 w = vec2(fbm(uv, vec2(3.0), 3), fbm(uv + 0.37, vec2(3.0), 3)) - 0.5;
    vec2 q = uv + w * 0.07;
    vec3 A = facets(vec2(q.x * 5.0 + q.y * 5.0, q.y * 3.0), vec2(5.0, 3.0));
    vec3 B = facets(vec2(q.x * 11.0 - q.y * 11.0, q.y * 6.0) + 3.3, vec2(11.0, 6.0));
    float cr = abs(vn(vec2(uv.x * 3.0 + uv.y * 3.0, uv.y * 2.0), vec2(3.0, 2.0)) - 0.5);
    float crack = (1.0 - smoothstep(0.0, 0.03, cr)) * smoothstep(0.42, 0.62, fbm(uv + 0.4, vec2(2.0), 2));
    float pit = fbm(uv, vec2(26.0), 4), brush = fbm(uv + 0.21, vec2(4.0, 3.0), 4);
    s.h = 0.5 + 0.45 * A.x - 0.14 * B.x + 0.008 * (pit - 0.5) - 0.012 * crack;
    float valley = 1.0 - smoothstep(0.0, 0.06, A.y), ridge = 1.0 - smoothstep(0.0, 0.04, B.y);
    s.c = vec3(0.92 + 0.3 * (A.z - 0.5) + 0.12 * (B.z - 0.5)) * mix(vec3(1.05, 1.0, 0.93), vec3(0.94, 0.99, 1.06), fract(A.z * 7.3));
    s.c *= (0.88 + 0.22 * brush) * (0.94 + 0.12 * pit) * (1.0 - 0.26 * valley) * (1.0 - 0.3 * crack);
    s.c += 0.1 * ridge;
    s.r = 0.8; s.nk = 34.0;
  } else if (uLayer == 3) {
    // sand: wind ripples that wander, grains
    float w = fbm(uv, vec2(4.0), 3);
    float rip = 0.5 + 0.5 * sin((uv.x * 26.0 + w * 3.0 + uv.y * 3.0) * TAU);
    float grain = vn(uv * 160.0, vec2(160.0));
    s.h = 0.3 * fbm(uv + 0.2, vec2(5.0), 3) + 0.5 * rip * rip + 0.2 * grain;
    s.c = vec3(0.92 + 0.12 * rip + 0.1 * (grain - 0.5));
    s.r = 0.82 - 0.2 * step(0.92, grain); s.nk = 0.8;
  } else if (uLayer == 4) {
    // snow: wind-smoothed drifts with a faint crust
    float m = fbm(uv, vec2(4.0), 4);
    float crust = fbm(uv + 0.6, vec2(28.0), 3);
    s.h = 0.75 * m + 0.25 * crust;
    s.c = vec3(0.96 + 0.07 * m);
    s.r = 0.5 - 0.22 * step(0.9, vn(uv * 220.0, vec2(220.0))); s.nk = 0.55;
  } else if (uLayer == 5) {
    // rubble masonry: uneven stones bedded in recessed mortar
    vec3 v = voro(uv * vec2(5.0, 7.0), vec2(5.0, 7.0), 0.82);
    float edge = v.y - v.x;
    float stone = smoothstep(0.03, 0.2, edge);
    float face = fbm(uv + v.z, vec2(16.0), 4);
    float chip = smoothstep(0.62, 0.8, fbm(uv + 0.3, vec2(9.0), 3));
    s.h = stone * (0.62 + 0.22 * v.z + 0.16 * face) * (1.0 - 0.25 * chip) + (1.0 - stone) * 0.12 * face;
    s.c = mix(vec3(0.62, 0.6, 0.57), vec3(0.8 + 0.42 * v.z) * mix(vec3(1.05, 1.0, 0.92), vec3(0.93, 0.98, 1.07), fract(v.z * 7.3)), stone);
    s.c *= 0.88 + 0.24 * face;
    s.r = mix(0.95, 0.74, stone); s.nk = 2.2;
  } else if (uLayer == 6) {
    // lime plaster: trowel sweeps, hairline cracks, a few flaked patches
    float sweep = fbm(uv, vec2(3.0, 11.0), 4);
    float mott = fbm(uv + 0.7, vec2(5.0), 4);
    vec3 v = voro(uv * 3.0 + 0.4, vec2(3.0), 0.95);
    float crack = 1.0 - smoothstep(0.0, 0.012, v.y - v.x);
    crack *= smoothstep(0.45, 0.6, fbm(uv + 0.11, vec2(4.0), 2));
    float flake = smoothstep(0.7, 0.76, fbm(uv + 0.23, vec2(6.0), 4));
    s.h = 0.62 + 0.2 * (sweep - 0.5) + 0.1 * (mott - 0.5) - 0.35 * crack - 0.22 * flake;
    s.c = vec3(0.95 + 0.12 * (mott - 0.5) + 0.06 * (sweep - 0.5)) * (1.0 - 0.45 * crack);
    s.c = mix(s.c, vec3(0.78, 0.74, 0.68) * (0.9 + 0.2 * mott), flake);
    s.r = 0.9; s.nk = 1.0;
  } else if (uLayer == 7 || uLayer == 11) {
    // timber: long grain with rings and the odd knot; layer 7 is cut into six planks
    float pid = uLayer == 7 ? floor(uv.x * 6.0) : 0.0;
    float off = h21(vec2(pid, 5.3));
    vec2 q = vec2(uv.x, uv.y + off);
    float warp = fbm(q, vec2(6.0, 2.0), 3);
    float ring = 0.5 + 0.5 * sin((q.x * 30.0 + warp * 5.0) * TAU);
    float fibre = vn(q * vec2(180.0, 6.0), vec2(180.0, 6.0));
    vec3 kv = voro(q * vec2(6.0, 2.0) + 0.5, vec2(6.0, 2.0), 0.9);
    float knot = smoothstep(0.16, 0.04, kv.x) * step(0.8, kv.z);
    s.h = 0.5 + 0.16 * ring + 0.14 * (fibre - 0.5) - 0.2 * knot;
    float tone = uLayer == 7 ? 0.86 + 0.3 * off : 1.0;
    s.c = vec3(tone) * (0.9 + 0.14 * ring + 0.1 * (fibre - 0.5)) * mix(vec3(1.0), vec3(0.62, 0.52, 0.45), knot);
    if (uLayer == 7) {
      float fx = fract(uv.x * 6.0);
      float seam = smoothstep(0.0, 0.07, min(fx, 1.0 - fx));
      s.h = mix(0.05, s.h, seam);
      s.c *= mix(0.5, 1.0, seam);
    }
    s.r = 0.66; s.nk = 1.2;
  } else if (uLayer == 8) {
    // roof tiles: eight overlapping courses, rounded lower edges, staggered joints
    float row = floor(uv.y * 8.0), fr = fract(uv.y * 8.0);
    float cu = uv.x * 5.0 + mod(row, 2.0) * 0.5;
    float fc = fract(cu), id = h21(vec2(mod(floor(cu), 5.0), mod(row, 8.0)));
    float across = min(fc, 1.0 - fc);
    // the butt of each tile sits proud and is slightly rounded at its corners
    float butt = smoothstep(0.0, 0.05, fr - 0.1 * (1.0 - smoothstep(0.0, 0.22, across)));
    float gap = smoothstep(0.0, 0.035, across);
    float slope = mix(1.0, 0.3, fr);
    float worn = fbm(uv + id, vec2(12.0), 3);
    s.h = butt * gap * (slope * (0.86 + 0.14 * id) + 0.08 * (worn - 0.5));
    s.c = vec3(0.84 + 0.34 * id) * (0.9 + 0.2 * worn) * mix(0.55, 1.0, gap) * mix(0.7, 1.0, smoothstep(0.0, 0.3, 1.0 - fr));
    s.r = 0.72; s.nk = 2.4;
  } else if (uLayer == 9) {
    // bark: deep furrows running up the trunk between corky plates
    float w = fbm(uv, vec2(5.0, 2.0), 3);
    float f = abs(vn(vec2(uv.x * 13.0 + w * 2.5, uv.y * 2.0), vec2(13.0, 2.0)) - 0.5) * 2.0;
    float plate = pow(clamp(f * 1.5, 0.0, 1.0), 0.7);
    float cross = smoothstep(0.42, 0.5, vn(uv * vec2(4.0, 14.0) + 6.0, vec2(4.0, 14.0)));
    float fine = fbm(uv + 0.4, vec2(30.0, 10.0), 3);
    s.h = plate * (0.8 - 0.25 * cross) + 0.2 * fine;
    s.c = vec3(mix(0.58, 1.12, plate)) * (0.9 + 0.2 * fine);
    s.r = 0.92; s.nk = 2.4;
  } else if (uLayer == 10) {
    // flagstones: broad worn slabs, earth in the joints
    vec3 v = voro(uv * 4.0, vec2(4.0), 0.75);
    float edge = v.y - v.x;
    float slab = smoothstep(0.035, 0.12, edge);
    float wear = fbm(uv + v.z, vec2(10.0), 4);
    s.h = slab * (0.7 + 0.14 * v.z + 0.1 * (wear - 0.5)) + (1.0 - slab) * 0.2 * wear;
    s.c = mix(vec3(0.6, 0.62, 0.52), vec3(0.86 + 0.3 * v.z) * mix(vec3(1.04, 1.0, 0.94), vec3(0.95, 0.99, 1.05), fract(v.z * 5.7)), slab);
    s.c *= 0.9 + 0.2 * wear;
    s.r = mix(0.92, 0.7, slab); s.nk = 1.8;
  } else if (uLayer == 12) {
    // weathered stone for boulders: broad mottling, pits, the odd fracture, spalled patches
    float brush = fbm(uv, vec2(3.0), 5), pit = fbm(uv + 0.3, vec2(22.0), 4);
    float cr = abs(vn(vec2(uv.x * 2.0 + uv.y * 2.0, uv.y * 3.0), vec2(2.0, 3.0)) - 0.5);
    float crack = (1.0 - smoothstep(0.0, 0.028, cr)) * smoothstep(0.4, 0.62, fbm(uv + 0.7, vec2(2.0), 2));
    float chip = smoothstep(0.55, 0.75, fbm(uv + 0.5, vec2(7.0), 3));
    s.h = 0.55 + 0.25 * (brush - 0.5) + 0.14 * (pit - 0.5) - 0.3 * crack - 0.12 * chip;
    s.c = vec3(0.92 + 0.2 * (brush - 0.5)) * mix(vec3(1.04, 1.0, 0.95), vec3(0.95, 0.99, 1.05), fbm(uv + 0.9, vec2(2.0), 2));
    s.c *= (0.95 + 0.1 * pit) * (1.0 - 0.4 * crack) * (1.0 + 0.07 * chip);
    s.r = 0.82; s.nk = 1.5;
  }
  return s;
}
void main(){
  Surf s = surf(vUv);
  if (uOut == 0) { gl_FragColor = vec4(clamp(s.c * 0.5, 0.0, 1.0), clamp(s.h, 0.0, 1.0)); return; }
  float e = uPx;
  float hx = surf(vUv + vec2(e, 0.0)).h - surf(vUv - vec2(e, 0.0)).h;
  float hy = surf(vUv + vec2(0.0, e)).h - surf(vUv - vec2(0.0, e)).h;
  // slope of a relief a few centimetres deep over a tile a few metres wide
  vec2 n = clamp(-vec2(hx, hy) / (2.0 * e) * 0.012 * s.nk, -1.0, 1.0);
  float cav = 0.55 + 0.45 * smoothstep(0.05, 0.5, s.h);
  gl_FragColor = vec4(n * 0.5 + 0.5, s.r, cav);
}`;

let lib = null;
// Bake the arrays once (needs the renderer). Returns { a, n } DataArrayTexture-like render textures.
export function bakeSurfaces(renderer, size = 1024) {
  if (lib) return lib;
  const mk = () => {
    const rt = new THREE.WebGLArrayRenderTarget(size, size, LAYERS, { depthBuffer: false });
    const t = rt.texture;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    t.colorSpace = THREE.NoColorSpace;
    return rt;
  };
  const A = mk(), N = mk();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uLayer: { value: 0 }, uOut: { value: 0 }, uPx: { value: 1 / size } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: FS, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new FullScreenQuad(mat);
  const prev = renderer.getRenderTarget();
  for (let o = 0; o < 2; o++) for (let l = 0; l < LAYERS; l++) {
    mat.uniforms.uLayer.value = l; mat.uniforms.uOut.value = o;
    renderer.setRenderTarget(o ? N : A, l);
    quad.render(renderer);
  }
  renderer.setRenderTarget(prev);
  quad.dispose(); mat.dispose();
  return (lib = { a: A.texture, n: N.texture });
}
