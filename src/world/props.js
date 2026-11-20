// Procedural vegetation, ground cover & rocks.
//
// Every species is grown from a seeded structure (trunk path with root flare,
// limbs, branches carrying sub-crowns of leaf clumps; whorls of boughs on the
// conifers) and emitted twice: a near model and a cheap far model built from
// the same structure, so the LOD swap keeps the silhouette. The near model's
// foliage is nothing but textured cards, sheets and strands (see Mesher): a
// crown can be looked into from below. The far model keeps solid cores, and is
// what casts the shadows. Vertex colours are RGBA: alpha is a foliage mask the
// toon shader uses for leaf translucency / ragged crown edges (so autumn and
// blossom crowns work, and trunks are never cut away).
//
// Instances live in one near + one far InstancedMesh per species variant.
// They are re-sorted on the CPU whenever the camera moves (distance LOD, view
// frustum, and a ring around the camera kept for shadow casters).
//
// Species vary by region: oaks/poplars on the plains, birch + fern + fungus in
// the west woods, willows and reeds around the lake, autumn maples on the
// sunset meadow, tiered firs (snowy higher up) in the north, ashen dead trees
// around the rift, blossom trees in village gardens.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, useCasterDepth } from '../render/materials.js';
import { tier } from '../render/quality.js';
import { SHADOW_LAYER } from '../render/renderer.js';
import { mulberry32, fbm, smoothstep, lerp, clamp } from '../core/util.js';
import { POI } from './layout.js';
import { authoredParts, authoredTex } from './buildings.js';

const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FADE = 5; // metres either side of a type's near/far switch over which the two models dither into each other
const hc = (h) => new THREE.Color(h);
const TAU = Math.PI * 2;
// cheap deterministic hash in [0,1)
const hash3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

// ---------------------------------------------------------------------------
// Indexed geometry accumulator: position, normal, RGBA colour.
// Foliage is textured from the atlas of materials.js (leafTexture, 4x4 tiles) in one of three
// ways, told apart in the shader (LEAF_CARDS) by aCard.z: cards, sheets and strands.
const TILE = { leaf: [0, 2], birch: [2, 1], maple: [3, 1], spray: [4, 2], tuft: [6, 2], strand: [12, 2], blossom: [14, 2] }, SNOW = 4;
class Mesher {
  // ci: foliage triangles, the outer ones first and the deep ones (inside a crown) last
  constructor() { this.p = []; this.n = []; this.c = []; this.k = []; this.i = []; this.ci = [[], []]; }
  get count() { return this.p.length / 3; }
  vert(p, n, c, a = 0) {
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.c.push(c.r, c.g, c.b, a);
    this.k.push(0, 0, 0, 0);
    return this.count - 1;
  }
  // Foliage card: four vertices at one point that the shader spreads out facing the viewer.
  // size: half-width (m); seed 0..1 picks the tile (of the range [first, count]) and the turn.
  card(p, n, c, size, seed, tiles = TILE.leaf, deep = 0) {
    const b = this.count, w = tiles[0] + Math.min(seed * tiles[1], tiles[1] - 0.02);
    for (let q = 0; q < 4; q++) {
      this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.c.push(c.r, c.g, c.b, 1);
      this.k.push(q === 0 || q === 3 ? -1 : 1, q < 2 ? -1 : 1, size, w);
    }
    this.ci[deep].push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  // Sheet vertex: stays where it is put and shows tile `tile` at (u, v)
  sheet(p, n, c, u, v, tile) {
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.c.push(c.r, c.g, c.b, 1);
    this.k.push(u * 2 - 1, v * 2 - 1, -1, tile + 0.5);
    return this.count - 1;
  }
  ftri(a, b, c, deep = 0) { this.ci[deep].push(a, b, c); }
  // Hanging strand: a strip from p down by len (three rows, so that it bends as it swings)
  // that turns about the vertical to face the viewer. hw: half-width; c0 / c1: colour at the
  // top and at the lower end.
  strand(p, len, hw, n, c0, c1, seed, tiles = TILE.strand) {
    const b = this.count, w = tiles[0] + Math.min(seed * tiles[1], tiles[1] - 0.02);
    for (let r = 0; r < 3; r++) for (const x of [-1, 1]) {
      const f = r / 2;
      this.p.push(p.x, p.y - len * f, p.z); this.n.push(n.x, n.y, n.z);
      this.c.push(c0.r + (c1.r - c0.r) * f, c0.g + (c1.g - c0.g) * f, c0.b + (c1.b - c0.b) * f, 1);
      this.k.push(x, r - 1, 100 + hw, w);
    }
    for (let r = 0; r < 2; r++) { const a = b + r * 2; this.ci[0].push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 4));
    g.setAttribute('aCard', new THREE.Float32BufferAttribute(this.k, 4));
    g.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(1), 1));
    // solid parts first: they fill the depth buffer before the alpha-edged foliage is shaded
    g.setIndex(this.i.concat(this.ci[0], this.ci[1]));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// unit icospheres (unique vertices + index) per subdivision level
const ICO = [0, 1, 2].map((d) => {
  const g = new THREE.IcosahedronGeometry(1, d);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const m = mergeVertices(g);
  return { pos: m.attributes.position.array, idx: m.index.array };
});

// Shading of a point of a leaf clump: its colour, and in _n a normal that leans towards the
// crown envelope only slightly: each branch mass keeps its own soft lighting volume.
// o.crown = { c, rx, ry } ellipsoid; o.color(out, p, own, crownDir) -> alpha.
const _cd = new THREE.Vector3(), _n = new THREE.Vector3();
function clumpShade(o, col, p, own, bnd) {
  const cr = o.crown;
  _cd.set((p.x - cr.c.x) / cr.rx, (p.y - cr.c.y) / cr.ry, (p.z - cr.c.z) / cr.rx).normalize();
  _n.copy(own).multiplyScalar(1 - bnd).addScaledVector(_cd, bnd).addScaledVector(UP, 0.12).normalize();
  return o.color(col, p, own, _cd);
}

// Soft jittered sphere shaded as part of a crown: the core of a far model's leaf clump
// (o.dim darkens it), berries, fungus.
function puff(M, c, r, detail, seed, o) {
  const jr = mulberry32(seed);
  const { pos, idx } = ICO[detail];
  const flat = o.flat ?? 0.88, jit = o.jit ?? 0.3, bend = o.bend ?? 0.58;
  const base = M.count, col = new THREE.Color();
  const sx = o.sx ?? 1, sz = o.sz ?? 1;
  for (let k = 0; k < pos.length; k += 3) {
    const d = V.set(pos[k], pos[k + 1], pos[k + 2]);
    const kk = 1 + (jr() - 0.5) * jit * (detail ? 1 : 0.7);
    const p = V2.set(c.x + d.x * r * kk * sx, c.y + d.y * r * kk * flat, c.z + d.z * r * kk * sz);
    const own = V3.set(d.x / sx, d.y / flat, d.z / sz).normalize();
    const a = clumpShade(o, col, p, own, bend);
    if (o.dim) col.multiplyScalar(o.dim);
    M.vert(p, _n, col, a);
  }
  for (let k = 0; k < idx.length; k++) M.i.push(base + idx[k]);
}

// The foliage of a crown. Leaf clumps (centre, radius, squash) are gathered first and written
// out together, so that no card is made where it would be buried in a neighbouring clump.
//   near model: nothing solid. Every clump is an outer shell of leaf cards all the way round,
//     a second shell a little deeper and a few big dark cards at its heart, on a branch with
//     twigs. From below or from inside, a crown is leaves on wood with sky between them.
//   far model: a dark core under a few large cards. It is also what casts the shadow (cards
//     do not spread in the shadow pass), so the core keeps the clump's bulk.
const NEAR_CARDS = { n: 64, size: 0.34, heart: 5 }, FAR_CARDS = { n: 18, size: 0.7 };
const BLOSSOM_CARDS = [{ ...NEAR_CARDS, tiles: TILE.blossom }, { ...FAR_CARDS, tiles: TILE.blossom }];
const MAPLE_CARDS = [{ ...NEAR_CARDS, tiles: TILE.maple }, { ...FAR_CARDS, tiles: TILE.maple }];
class Foliage {
  // bark: colour function for the branches and twigs of the near model (none: no wood)
  // floor: no cards below this height (a bush sits on the ground)
  constructor(lod, bark = null) { this.lod = lod; this.bark = bark; this.list = []; this.floor = -1e9; }
  // o: { crown, color, flat, sx, sz, bend, jit, cards: { n, size, shell, heart, tiles }, twig (radius) };
  // from: where the branch that carries the clump leaves its limb (none: the clump sits on the
  // limb's end, which comes in from `entry`)
  add(c, r, seed, o, from = null, entry = null) {
    const q = { c: c.clone(), r, seed, o, from: from && from.distanceToSquared(c) > 0.05 ? from.clone() : null, mouth: null };
    // the side the wood comes in from is left open: looking up into a crown, branches are seen
    // going into the leaves
    const e = q.from || entry;
    if (e && e.distanceToSquared(c) > 1e-4) q.mouth = e.clone().sub(c).normalize();
    this.list.push(q);
  }
  buried(p, self) {
    for (const q of this.list) {
      if (q === self) continue;
      const o = q.o, dx = (p.x - q.c.x) / (o.sx ?? 1), dy = (p.y - q.c.y) / (o.flat ?? 0.88), dz = (p.z - q.c.z) / (o.sz ?? 1);
      if (dx * dx + dy * dy + dz * dz < q.r * q.r * 0.56) return true;
    }
    return false;
  }
  emit(M) {
    for (const q of this.list) {
      if (this.lod) puff(M, q.c, q.r * 0.7, 0, q.seed, { ...q.o, dim: 0.5 });
      this.cards(M, q, q.o.cards || (this.lod ? FAR_CARDS : NEAR_CARDS));
      if (!this.lod && this.bark) this.wood(M, q);
    }
  }
  cards(M, q, K) {
    const { c, r, o } = q;
    const kr = mulberry32((q.seed ^ 0x5bd1e995) >>> 0);
    const flat = o.flat ?? 0.88, bend = Math.min(0.3, o.bend ?? 0.2), sx = o.sx ?? 1, sz = o.sz ?? 1;
    const ks = Math.max(0.55, Math.min(1, (sx + sz) * 0.5 + 0.2));
    const col = new THREE.Color(), d = V, p = V2, own = V3;
    const at = (i, n, kk) => {
      // even spread over the whole sphere (Fibonacci spiral): the underside is seen from the ground
      const y = 1 - ((i + 0.5) / n) * 2, rad = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.3999632 + kr() * 0.9;
      d.set(Math.cos(th) * rad, y, Math.sin(th) * rad);
      // Gentle lobes keep a branch mass from becoming a perfectly round topiary ball.
      const phase = (q.seed % 997) * 0.0063;
      const lobe = 1 + (Math.sin(th * 3 + phase) * 0.1 + Math.cos(th * 5 - phase) * 0.045) * rad;
      p.set(c.x + d.x * r * kk * sx * lobe, c.y + d.y * r * kk * flat * (1 + Math.sin(th * 2 + phase) * 0.05), c.z + d.z * r * kk * sz * lobe);
      own.set(d.x / sx, d.y / flat, d.z / sz).normalize();
    };
    for (let i = 0; i < K.n; i++) {
      // two shells: every third card sits deeper, so gaps in the outer layer show leaves
      const deep = i % 3 === 2, k0 = kr(), k1 = kr(), k2 = kr(), k3 = kr();
      // Larger far cards sit farther inside the clump to preserve its silhouette.
      at(i, K.n, ((deep ? 0.74 : 0.92) + k0 * 0.2) * (K.shell ?? 1));
      if (p.y < this.floor || this.buried(p, q)) continue;
      if (!this.lod && q.mouth && d.dot(q.mouth) > 0.62) continue;
      clumpShade(o, col, p, own, bend);
      // Broad value groups, rather than an unrelated bright/dark speckle on every card.
      col.multiplyScalar((deep ? 0.8 : 0.97) + k1 * 0.08);
      if (deep) { col.r *= 0.88; col.g *= 0.97; col.b *= 1.08; }
      M.card(p, _n, col, r * K.size * (0.68 + k2 * 0.64) * ks, k3, K.tiles, 0);
    }
    // the heart: what the gaps of both shells open on, from outside and from underneath
    for (let i = 0; i < (K.heart || 0); i++) {
      const k0 = kr(), k1 = kr(), k2 = kr();
      at(i, K.heart, 0.2 + k0 * 0.28);
      clumpShade(o, col, p, own, bend);
      col.multiplyScalar(0.52 + k1 * 0.08);
      col.r *= 0.88; col.b *= 1.12;
      M.card(p, _n, col, r * K.size * 1.15 * ks, k2, K.tiles, 1);
    }
  }
  wood(M, q) {
    const { c, r, o } = q, wr = mulberry32((q.seed ^ 0x2c1b3c6d) >>> 0);
    const flat = o.flat ?? 0.88, sx = o.sx ?? 1, sz = o.sz ?? 1;
    const tw = (o.twig ?? 0.03) * (0.6 + 0.4 * Math.min(r, 1.6));
    const bark = (col, t, ang, p) => { this.bark(col, 0.45 + t * 0.3, ang, p); col.multiplyScalar(0.9); return 0; };
    if (q.from) {
      // the branch: out from the limb, then up into the clump
      const L = q.from.distanceTo(c), m = q.from.clone().lerp(c, 0.5);
      m.y += L * 0.06;
      tube(M, [q.from, m, c], [tw * 2.1, tw * 1.3, tw * 0.7], 5, bark, { tip: false });
    }
    // twigs spreading through the clump: bent, and short enough to end among its leaves
    for (let i = 0; i < 3; i++) {
      const a = wr() * TAU, el = wr() * 1.3 - 0.2, L = r * (0.32 + wr() * 0.24);
      const e = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
      if (q.mouth && e.dot(q.mouth) > 0.2) e.addScaledVector(q.mouth, -2 * e.dot(q.mouth));   // (not back out of the open side)
      const m = new THREE.Vector3(c.x + e.x * L * 0.5 * sx, c.y + (e.y * 0.5 - 0.12) * L * flat, c.z + e.z * L * 0.5 * sz);
      e.set(c.x + e.x * L * sx, c.y + (e.y + 0.1) * L * flat, c.z + e.z * L * sz);
      tube(M, [c.clone(), m, e], [tw * 0.8, tw * 0.5, tw * 0.22], 3, bark, {});
    }
  }
}

// Tube along a polyline with per-point radius. Parallel-transport frames,
// optional root flare (buttress lobes) and a closing tip.
function tube(M, pts, rad, seg, colorFn, o = {}) {
  const n = pts.length;
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  T.subVectors(pts[1], pts[0]).normalize();
  N.set(1, 0, 0); if (Math.abs(T.x) > 0.9) N.set(0, 0, 1);
  N.addScaledVector(T, -N.dot(T)).normalize();
  const col = new THREE.Color();
  const rings = [];
  let len = 0;
  const total = pts.slice(1).reduce((sum, p, i) => sum + p.distanceTo(pts[i]), 0);
  for (let i = 0; i < n; i++) {
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    T.subVectors(b, a).normalize();
    N.addScaledVector(T, -N.dot(T)).normalize();
    B.crossVectors(T, N);
    const t = i / (n - 1);
    const ring = [];
    for (let k = 0; k < seg; k++) {
      const ang = (k / seg) * TAU;
      const dir = new THREE.Vector3().copy(N).multiplyScalar(Math.cos(ang)).addScaledVector(B, Math.sin(ang));
      let r = rad[i];
      // Root flare is measured along the stem, not by ring index. Close-set basal rings
      // must carry the buttresses above the ground, rather than burying them in the skirt.
      const along = len / Math.max(total, 1e-4);
      if (o.flare && along < o.flareT) {
        const f = 1 - along / o.flareT;
        r *= 1 + o.flare * f * f * (0.5 + 0.5 * Math.cos(ang * (o.lobes ?? 5) + (o.ph ?? 0)));
      }
      if (o.bump) r *= 1 + (hash3(pts[i].x * 3 + k, pts[i].y * 5, pts[i].z * 3) - 0.5) * o.bump;
      const p = new THREE.Vector3().copy(pts[i]).addScaledVector(dir, r);
      const a2 = colorFn(col, t, ang, p, len);
      // A taper's normal leans along the stem; radial normals make branch joins look
      // like pipes cut through one another, especially on the pale birch trunks.
      const span = Math.max(a.distanceTo(b), 1e-4);
      const slope = (rad[Math.max(0, i - 1)] - rad[Math.min(n - 1, i + 1)]) / span;
      dir.addScaledVector(T, slope).normalize();
      ring.push(M.vert(p, dir, col, a2 ?? 0));
    }
    rings.push(ring);
  }
  for (let i = 0; i < n - 1; i++) {
    const r0 = rings[i], r1 = rings[i + 1];
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      M.quad(r0[k], r0[k1], r1[k1], r1[k]);
    }
  }
  if (o.tip !== false) {
    T.subVectors(pts[n - 1], pts[n - 2]).normalize();
    const tp = new THREE.Vector3().copy(pts[n - 1]).addScaledVector(T, rad[n - 1] * 2.2);
    colorFn(col, 1, 0, tp, len);
    const ti = M.vert(tp, T, col, 0);
    const r = rings[n - 1];
    for (let k = 0; k < seg; k++) M.tri(r[k], r[(k + 1) % seg], ti);
  }
}

// Smooth curved path: start, direction, length, gravity/upward bend and wobble.
function limbPath(rnd, from, dir, L, steps, bend, wob) {
  const pts = [from.clone()];
  const d = dir.clone().normalize();
  const p = from.clone();
  const ph = rnd() * TAU, ph2 = rnd() * TAU;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    d.y += bend / steps;
    d.x += Math.sin(t * 4 + ph) * wob / steps; d.z += Math.cos(t * 3.4 + ph2) * wob / steps;
    d.normalize();
    p.addScaledVector(d, L / steps);
    pts.push(p.clone());
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Bark palettes: [dark (base), light (upper)]
const BARK = {
  oak: [0x3f2e22, 0x7a5c42], dark: [0x3a2c24, 0x5e4838], willow: [0x3c3228, 0x6e5a46],
  pine: [0x3a2620, 0x7a4c34], ash: [0x2a2530, 0x6a6072], blossom: [0x4a3430, 0x7e5c52],
};
function barkColor(pal, mossy = 0) {
  const a = hc(pal[0]), b = hc(pal[1]), moss = hc(0x5a7a34);
  return (c, t, ang, p) => {
    // Long, quiet planes following the branch; no salt-and-pepper vertex noise.
    const grain = Math.sin(ang * 3 + p.y * 0.34) * 0.07 + Math.sin(ang * 5 - p.y * 0.18) * 0.035;
    c.copy(a).lerp(b, clamp(0.14 + t * 0.8 + grain, 0, 1));
    // moss on the shaded (north, -z) side near the ground
    if (mossy) c.lerp(moss, mossy * smoothstep(0.35, 0.0, t) * smoothstep(0.1, -0.9, Math.sin(ang)) * 0.8);
    return 0;
  };
}

// Leaf colour: interior & underside dark, sunny tops light, per-puff hue.
function leafColor(o) {
  const light = hc(o.light), dark = hc(o.dark), deep = hc(o.deep ?? o.dark).multiplyScalar(0.84);
  deep.r *= 0.86; deep.b *= 1.12;
  const tip = o.tip != null ? hc(o.tip) : null;
  return (crown, hue, lum) => (col, p, own, cd) => {
    const hgt = clamp((p.y - (crown.c.y - crown.ry)) / (2 * crown.ry), 0, 1);
    const out = clamp(own.dot(cd), 0, 1);
    let t = 0.1 + 0.28 * hgt + 0.4 * (own.y * 0.5 + 0.5) + 0.16 * out;
    t = clamp(t, 0, 1);
    col.copy(deep).lerp(dark, smoothstep(0.0, 0.35, t)).lerp(light, smoothstep(0.3, 1.0, t));
    if (tip && own.y > 0.35) col.lerp(tip, smoothstep(0.35, 0.95, own.y) * smoothstep(0.55, 1, t) * 0.45);
    col.offsetHSL(hue, 0, 0).multiplyScalar(lum);
    return 1;
  };
}

// Sub-crown: a cluster of leaf clumps around an anchor (the end of a limb), mostly on its
// upper/outer side. F: the tree's Foliage.
function subCrown(F, rnd, anchor, R, count, crown, colorer, o = {}) {
  const hue = (rnd() - 0.5) * (o.hueJit ?? 0.05), lum = 0.92 + rnd() * 0.14;
  const colorFn = colorer(crown, hue, lum);
  const out = V.copy(anchor).sub(crown.c); out.y = 0;
  const outA = out.lengthSq() > 1e-4 ? Math.atan2(out.z, out.x) : rnd() * TAU;
  for (let i = 0; i < count; i++) {
    const center = i === 0;
    const a = outA + (rnd() - 0.5) * 3.6;
    const el = center ? 0.2 : (rnd() * 1.25 - 0.25);
    const dist = center ? 0 : R * (0.55 + rnd() * 0.35);
    const pc = new THREE.Vector3(anchor.x + Math.cos(a) * Math.cos(el) * dist, anchor.y + Math.sin(el) * dist * (o.vs ?? 0.8), anchor.z + Math.sin(a) * Math.cos(el) * dist);
    const r = R * (center ? 0.72 : 0.42 + rnd() * 0.22) * (o.rs ?? 1);
    const seed = Math.floor(rnd() * 1e9);
    if (o.skip && o.skip(i, r)) continue;
    // o.limb (the polyline ending at the anchor): the clumps round the middle one hang on
    // branches that fork off along it; o.from: every clump on a branch from that one point
    let from = o.from ?? anchor, entry = null;
    if (o.limb) {
      const f = (0.4 + ((i * 0.618) % 1) * 0.42) * (o.limb.length - 1), k = Math.min(o.limb.length - 2, Math.floor(f));
      entry = o.limb[o.limb.length - 2];
      from = center ? null : o.limb[k].clone().lerp(o.limb[k + 1], f - k);
    }
    F.add(pc, r, seed, { crown, color: colorFn, flat: o.flat ?? 0.86, bend: o.bend ?? 0.58, jit: o.jit ?? 0.34, cards: o.cards, twig: o.twig }, from, entry);
  }
}

// ---------------- broadleaf (oak / maple / blossom) ----------------
// opts: trunkH, size, light, dark, deep, tip, limbs (small oak variant), bark, cards
const OAK_PAL = { light: 0xa8d05c, dark: 0x3f7a34, deep: 0x2a5a2c, tip: 0xcce27c };
function broadleaf(seed, lod, opts = {}) {
  opts = { ...OAK_PAL, ...opts };
  const rnd = mulberry32(seed), M = new Mesher();
  const blossom = opts.bark === 'blossom', maple = opts.cards === MAPLE_CARDS;
  const size = opts.size ?? 1.8;
  const H = ((opts.trunkH ?? 3.0) + (blossom ? 0.8 : 1.05)) * (0.94 + rnd() * 0.12);
  const lean = new THREE.Vector3((rnd() - 0.5) * 1.15, 0, (rnd() - 0.5) * 1.15);
  const r0 = (opts.r0 ?? 0.34) * (0.85 + size * 0.1), ph = rnd() * TAU;
  const ts = [0, 0.04, 0.1, 0.2, 0.36, 0.55, 0.75, 1];
  const tp = ts.map((t) => new THREE.Vector3(lean.x * t * t + Math.sin(t * 3 + ph) * 0.18 * t,
    t * H - (t === 0 ? 0.35 : 0), lean.z * t * t + Math.cos(t * 2.6 + ph) * 0.15 * t));
  const bark = barkColor(BARK[opts.bark ?? 'oak'], opts.mossy ?? 0.35);
  tube(M, tp, ts.map((t) => lerp(r0, r0 * 0.46, t)), lod ? 6 : 9, bark,
    { flare: 1.0, flareT: 0.23, lobes: 5, ph, tip: false, bump: lod ? 0 : 0.12 });
  const top = tp[tp.length - 1];
  const crown = { c: new THREE.Vector3(top.x, H + size * 0.8, top.z), rx: size * 2.15, ry: size * 1.55 };
  // Five main branch masses, with deliberate valleys between their shoulders. The layouts
  // describe branch growth, not stacked solid volumes: every near crown remains leaf cards.
  const layout = blossom ? [
    [-1.4, 0.48, 0.25, 0.72, 0.63, 1.15], [1.2, 0.95, 0.15, 0.66, 0.68, 1.1],
    [-0.3, 1.4, -0.9, 0.74, 0.7, 1], [0.28, 0.15, 1.15, 0.52, 0.6, 1.05],
  ] : maple ? [
    [-1.03, 0.64, 0.2, 0.8, 0.8, 1], [1, 0.77, 0.1, 0.79, 0.8, 1],
    [0.06, 0.62, 1.08, 0.75, 0.77, 1], [-0.13, 0.9, -0.92, 0.8, 0.76, 1],
    [0.12, 1.58, 0, 0.79, 0.83, 1],
  ] : [
    [-1.4, 0.35, 0.3, 0.9, 0.66, 1.2], [1.24, 0.75, 0.3, 0.92, 0.68, 1.12],
    [-0.3, 1.18, -1.05, 0.82, 0.68, 1.1], [0.2, 0.08, 1.15, 0.67, 0.6, 1.15],
    [-0.12, 1.4, -0.08, 0.86, 0.66, 1.15],
  ];
  const F = new Foliage(lod, bark), colorer = leafColor(opts), angle = rnd() * TAU;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const atlas = opts.cards?.[lod ? 1 : 0] || (lod ? FAR_CARDS : NEAR_CARDS);
  const cards = { ...atlas, n: lod ? 28 : 136, size: lod ? 0.54 : 0.29, shell: lod ? 0.82 : 1, heart: lod ? 0 : 8 };
  for (let i = 0; i < layout.length; i++) {
    if (opts.limbs === 3 && i === 3) continue;
    const [x, y, z, radius, flat, sx] = layout[i];
    const c = new THREE.Vector3(top.x + (x * ca - z * sa + (rnd() - 0.5) * 0.12) * size,
      H + (y + (rnd() - 0.5) * 0.1) * size, top.z + (x * sa + z * ca + (rnd() - 0.5) * 0.12) * size);
    const leader = i === layout.length - 1;
    const from = leader ? top.clone() : tp[4 + i % 3].clone();
    const pts = [from, from.clone().lerp(c, 0.38).addScaledVector(UP, -size * 0.12),
      from.clone().lerp(c, 0.76).addScaledVector(UP, size * 0.06), c];
    const lr = r0 * (leader ? 0.46 : 0.58 - i * 0.035);
    tube(M, lod ? [pts[0], pts[2], c] : pts,
      lod ? [lr, lr * 0.5, lr * 0.23] : [lr, lr * 0.8, lr * 0.48, lr * 0.23], lod ? 4 : 6, bark, { tip: false });
    const color = colorer(crown, (rnd() - 0.5) * 0.025, 0.96 + rnd() * 0.07);
    F.add(c, size * radius, Math.floor(rnd() * 1e9),
      { crown, color, flat, sx, sz: 1, bend: 0.18, cards, twig: lr * 0.22 }, null, pts[2]);
  }
  F.emit(M);
  return M.geometry();
}

// ---------------- birch: slender white trunk(s), airy crown ----------------
function birch(seed, lod) {
  const rnd = mulberry32(seed);
  const M = new Mesher();
  const twin = rnd() < 0.3;
  const white = hc(0xe2ddd0), mark = hc(0x3a3632), warm = hc(0xc8bca8);
  // dark lenticel dashes: thin bands bounded by ring pairs so their edges stay crisp
  let bands = [];
  const bark = (c, t, ang, p) => {
    c.copy(white).lerp(warm, hash3(Math.floor(p.y * 2), 1, 2) * 0.3);
    for (const b of bands) if (t > b.t0 + 1e-4 && t < b.t1 - 1e-4) {
      const seg = Math.floor(((ang / TAU) * b.n + b.ph) % b.n);
      if (hash3(b.id, seg, 0.5) > 0.35) c.lerp(mark, 0.88);
    }
    if (p.y < 0.6) c.lerp(mark, smoothstep(0.6, 0.0, p.y) * 0.7);
    return 0;
  };
  const colorer = leafColor({ light: 0xd6e37a, dark: 0x74a444, deep: 0x4a7a38, tip: 0xeaf0a0 });
  const stems = twin ? 2 : 1;
  const crownPts = [];
  for (let s = 0; s < stems; s++) {
    const h = (s ? 0.78 : 1) * (5.2 + rnd() * 1.4);
    const a = rnd() * TAU, lean = s ? 0.22 + rnd() * 0.1 : (rnd() - 0.5) * 0.12;
    let ts = [0, 0.05, 0.15, 0.3, 0.5, 0.7, 0.85, 1];
    bands = [];
    for (let k = 0; k < 7; k++) {
      const t0 = 0.12 + k * 0.11 + rnd() * 0.05, t1 = t0 + (0.012 + rnd() * 0.012);
      bands.push({ t0, t1, id: k + s * 10, n: 3 + Math.floor(rnd() * 3), ph: rnd() * 3 });
    }
    if (!lod) {
      for (const b of bands) ts.push(b.t0, b.t0 + 0.002, b.t1 - 0.002, b.t1);
      ts = ts.filter((t) => t <= 1).sort((x, y) => x - y);
    }
    const pts = ts.map((t) => new THREE.Vector3(Math.cos(a) * lean * t * h + Math.sin(t * 5 + a) * 0.05, t * h - (t === 0 ? 0.3 : 0), Math.sin(a) * lean * t * h));
    tube(M, pts, ts.map((t) => lerp(s ? 0.13 : 0.17, 0.05, t)), lod ? 5 : 7, (c, t, ang, p) => bark(c, ts[Math.round(t * (ts.length - 1))], ang, p), { flare: 0.5, flareT: 0.12, lobes: 4 });
    // up-reaching twigs
    for (let b = 0; b < 4; b++) {
      const k = Math.floor((0.55 + rnd() * 0.3) * (pts.length - 1)), ba = rnd() * TAU;
      const tw = limbPath(rnd, pts[k], new THREE.Vector3(Math.cos(ba), 0.9, Math.sin(ba)), 0.9 + rnd() * 0.5, 2, 0.3, 0.2);
      if (!lod) tube(M, tw, [0.04, 0.025, 0.015], 4, (c) => { c.copy(white).lerp(warm, 0.3); return 0; }, {});
    }
    crownPts.push({ top: pts[pts.length - 1], h, pts });
  }
  const F = new Foliage(lod, (c) => { c.copy(white).lerp(mark, 0.45); return 0; });
  for (const { top, h, pts } of crownPts) {
    const crown = { c: new THREE.Vector3(top.x, top.y - h * 0.18, top.z), rx: 1.35, ry: h * 0.3 };
    const nA = 3;
    for (let i = 0; i < nA; i++) {
      const t = i / (nA - 1);
      const a = rnd() * TAU, rr = 0.2 + rnd() * 0.3;
      const an = new THREE.Vector3(top.x + Math.cos(a) * rr * (1 - t * 0.6), top.y - h * 0.3 + t * h * 0.32, top.z + Math.sin(a) * rr * (1 - t * 0.6));
      // the clumps' branches leave the stem a little below them
      const from = pathAt(pts, an.y - 0.35);
      subCrown(F, rnd, an, (1.1 - t * 0.35) * (0.9 + rnd() * 0.2), 4, crown, colorer, { hueJit: 0.025, flat: 0.85, vs: 1.0, rs: 1.2, twig: 0.022, from, cards: { ...(lod ? FAR_CARDS : NEAR_CARDS), tiles: TILE.birch }, skip: lod ? (k) => k > 1 : null });
    }
  }
  F.emit(M);
  return M.geometry();
}

// ---------------- poplar: columnar spindle crown ----------------
function poplar(seed, lod) {
  const rnd = mulberry32(seed);
  const M = new Mesher();
  const H = 7.6 + rnd() * 1.6;
  // the stem runs on up through the crown, which hangs on short branches all the way
  const ts = [0, 0.04, 0.12, 0.3, 0.6, 1, 1.36, 1.7], tr = [0.26, 0.254, 0.243, 0.218, 0.176, 0.12, 0.07, 0.025];
  const pts = ts.map((t) => new THREE.Vector3(Math.sin(t * 3) * 0.08 * Math.min(1, 2 - t), t * H * 0.55 - (t === 0 ? 0.3 : 0), 0));
  tube(M, pts, tr, lod ? 5 : 7, barkColor(BARK.oak, 0.3), { flare: 0.6, flareT: 0.1, tip: true });
  const crown = { c: new THREE.Vector3(0, H * 0.62, 0), rx: 1.4, ry: H * 0.42 };
  const colorer = leafColor({ light: 0xbcd96a, dark: 0x4f8a3a, deep: 0x356a30, tip: 0xd6e890 });
  const F = new Foliage(lod, barkColor(BARK.oak));
  const n = 6;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = H * (0.3 + t * 0.64);
    const w = Math.pow(Math.sin(Math.PI * (0.12 + t * 0.8)), 0.8) * 1.05 + 0.2;
    const a = rnd() * TAU;
    subCrown(F, rnd, new THREE.Vector3(Math.cos(a) * 0.12, y, Math.sin(a) * 0.12), w * 0.85, 3, crown, colorer, { flat: 1.15, vs: 0.7, rs: 1.4, hueJit: 0.025, bend: 0.7, twig: 0.024, from: pathAt(pts, y - 0.5), cards: { ...(lod ? FAR_CARDS : NEAR_CARDS), tiles: TILE.birch }, skip: lod ? (k) => k > 1 : null });
  }
  F.emit(M);
  return M.geometry();
}

// ---------------- willow: broad dome + hanging curtains ----------------
function willow(seed, lod, opts = {}) {
  const rnd = mulberry32(seed);
  const M = new Mesher();
  const H = (opts.trunkH ?? 2.6) * (0.95 + rnd() * 0.1), size = opts.size ?? 2.1;
  const ts = [0, 0.05, 0.14, 0.3, 0.5, 0.75, 1];
  const ph = rnd() * TAU;
  const pts = ts.map((t) => new THREE.Vector3(Math.sin(t * 2.5 + ph) * 0.35 * t, t * H - (t === 0 ? 0.35 : 0), Math.cos(t * 2 + ph) * 0.25 * t));
  tube(M, pts, ts.map((t) => lerp(0.46, 0.3, t)), lod ? 6 : 9, barkColor(BARK.willow, 0.8), { flare: 1.1, flareT: 0.25, lobes: 6, ph, tip: false, bump: lod ? 0 : 0.15 });
  const top = pts[pts.length - 1];
  const R = size * 1.3, cy = H + 1.1;
  const crown = { c: new THREE.Vector3(top.x, cy, top.z), rx: R * 1.1, ry: 1.5 };
  const colorer = leafColor({ light: opts.light ?? 0xbcd872, dark: opts.dark ?? 0x4f8a42, deep: 0x3a6a36, tip: 0xd8eca0 });
  const F = new Foliage(lod, barkColor(BARK.willow));
  const nL = 5;
  for (let i = 0; i < nL; i++) {
    const a = (i / nL) * TAU + rnd() * 0.5;
    const dir = new THREE.Vector3(Math.cos(a), 0.55, Math.sin(a));
    const lp = limbPath(rnd, top, dir, R * 0.75, 3, -0.3, 0.3);
    if (!lod) tube(M, lp, [0.18, 0.12, 0.08, 0.05], 5, barkColor(BARK.willow), {});
    subCrown(F, rnd, lp[3], R * 0.55, 3, crown, colorer, { flat: 0.7, hueJit: 0.04, rs: 1.15, twig: 0.04, limb: lp, skip: lod ? (k) => k > 1 : null });
  }
  // the middle limb closes the trunk's open top
  const mid = new THREE.Vector3(top.x, cy + 0.5, top.z), mp = [top, top.clone().lerp(mid, 0.5), mid];
  tube(M, mp, [0.3, 0.2, 0.08], lod ? 6 : 9, barkColor(BARK.willow), {});
  subCrown(F, rnd, mid, R * 0.6, 5, crown, colorer, { flat: 0.72, twig: 0.04, limb: mp, skip: lod ? (k) => k > 2 : null });
  F.emit(M);
  // curtains: strands of narrow leaves hanging from under the dome, most of them at the rim
  const sLight = hc(0xd2e68e), sDark = hc(opts.dark ?? 0x4f8a42).multiplyScalar(0.8), sn = new THREE.Vector3();
  const c0 = new THREE.Color(), c1 = new THREE.Color();
  // They start on the dome's own surface (two in three out at the rim, the rest further in)
  // and reach most of the way to the ground, so the tree's outline is the curtain.
  const nS = 54;
  for (let i = 0; i < nS; i++) {
    const a = (i / nS) * TAU * 3 + rnd() * 0.5, rr = R * (i % 3 === 2 ? 0.5 + rnd() * 0.3 : 0.82 + rnd() * 0.3);
    const k = Math.min(1, rr / (R * 1.12)), y = cy - 0.2 + Math.sqrt(1 - k * k) * 1.1 * rnd();
    const L = Math.max(1.2, y - (0.35 + rnd() * 1.1)), lum = 0.84 + rnd() * 0.26, sd = rnd();
    if (lod && i % 3) continue;
    c0.copy(sDark).lerp(sLight, 0.25).multiplyScalar(lum); c1.copy(sLight).multiplyScalar(lum);
    sn.set(Math.cos(a) * 0.7, 0.55, Math.sin(a) * 0.7).normalize();
    M.strand(V.set(top.x + Math.cos(a) * rr, y, top.z + Math.sin(a) * rr), L, lod ? 0.6 : 0.36, sn, c0, c1, sd);
  }
  return M.geometry();
}

// Point of a (rising) polyline at height y
function pathAt(pts, y) {
  for (let i = 1; i < pts.length; i++) if (pts[i].y >= y) return pts[i - 1].clone().lerp(pts[i], clamp((y - pts[i - 1].y) / Math.max(1e-4, pts[i].y - pts[i - 1].y), 0, 1));
  return pts[pts.length - 1].clone();
}

// ---------------- conifer (fir / spruce) ----------------
// A tapered stem carries overlapping, drooping branch fans. Curved sheets have a lit
// upper surface and cool underside; both detail levels use the same roots, shoulders
// and tips. Snow caps follow only the upper sheets, leaving a needle fringe.
// o: { pal (index into FIR_PAL), snowy }
const FIR_PAL = [
  { dark: 0x1a4a2e, mid: 0x2f7a42, tip: 0x7cba56, under: 0x12301f },   // fir
  { dark: 0x274e42, mid: 0x49816b, tip: 0x9ebc86, under: 0x20382f },   // blue spruce
  { dark: 0x2a5226, mid: 0x4c8632, tip: 0xa0c452, under: 0x1a321a },   // yellow-green
];
// A branch carries a terminal spray and shorter laterals. Each spray has two
// textured faces meeting at the rim, so even a side view shows its thickness.
function firFan(M, lod, start, angle, length, width, fall, curl, roll, tile, tones, snowy) {
  const along = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const across = new THREE.Vector3(-along.z, 0, along.x);
  // Low skirts turn out above the ground, including the sunk base of an instance.
  fall = Math.min(fall, (start.y - 0.35 - width * 0.16) / length);
  const { dark, mid, tip, under, snow, lum } = tones;
  const n = new THREE.Vector3(), c = new THREE.Color();
  const surface = (bottom, cap) => {
    const row = (u, breadth) => {
      const arch = Math.sin(Math.PI * u), sag = u * u * (2.2 - 1.2 * u);
      const p = start.clone().addScaledVector(along, length * u)
        .addScaledVector(across, length * curl * u * u)
        .addScaledVector(UP, length * (0.10 * arch - fall * sag));
      const indices = [];
      for (const side of breadth ? [-1, 0, 1] : [0]) {
        const crest = !side && breadth > 0;
        const q = p.clone().addScaledVector(across, side * width * breadth);
        q.y += width * breadth * (side * roll + (crest ? (bottom ? -0.09 : 0.16) : -0.30));
        if (cap) q.y += 0.012 + width * 0.055 * arch;
        n.copy(along).multiplyScalar((fall * u * (4.4 - 3.6 * u) - 0.10 * Math.PI * Math.cos(Math.PI * u)) * (bottom ? -1 : 1));
        n.addScaledVector(across, side * 1.08 - roll); n.y = bottom ? -0.82 : 1; n.normalize();
        if (cap) c.copy(snow).multiplyScalar(crest ? 1 : 0.85);
        else if (bottom) c.copy(under).lerp(mid, 0.22 + u * 0.22);
        else c.copy(dark).lerp(mid, 0.42 + 0.48 * u).lerp(tip, (crest ? 0.24 : 0.07) + 0.16 * u);
        c.multiplyScalar(lum);
        indices.push(M.sheet(q, n, c, u, 0.5 + side * breadth * 0.68, tile + (cap ? SNOW : 0)));
      }
      return indices;
    };
    const tri = (a, b, c) => bottom ? M.ftri(a, c, b) : M.ftri(a, b, c);
    const [root] = row(0, 0), shoulder = row(0.48, 1);
    tri(root, shoulder[1], shoulder[0]); tri(root, shoulder[2], shoulder[1]);
    let outer = shoulder;
    if (!lod) {
      outer = row(0.76, 0.73);
      for (let i = 0; i < 2; i++) {
        tri(shoulder[i], shoulder[i + 1], outer[i + 1]);
        tri(shoulder[i], outer[i + 1], outer[i]);
      }
    }
    const [end] = row(1, 0);
    tri(outer[0], outer[1], end); tri(outer[1], outer[2], end);
  };
  surface(false, false); surface(true, false);
  if (snowy) surface(false, true);
}

function conifer(seed, lod, o = {}) {
  const rnd = mulberry32(seed), M = new Mesher();
  const pal = FIR_PAL[(o.pal ?? 0) % FIR_PAL.length];
  const tones = { dark: hc(pal.dark), mid: hc(pal.mid), tip: hc(pal.tip), under: hc(pal.under), snow: hc(0xc8d3d9), lum: 1 };
  const H = 7.6 + rnd() * 2, ph = rnd() * TAU, lean = (rnd() - 0.5) * 1.14, r0 = 0.255 + rnd() * 0.055;
  const stem = (t) => new THREE.Vector3(Math.sin(t * 3.2 + ph) * 0.32 * t + lean * t * t, t * H, Math.cos(t * 2.7 + ph) * 0.32 * t);
  const bark = barkColor(BARK.pine, 0.25), ts = [0, 0.04, 0.1, 0.22, 0.4, 0.58, 0.75, 0.88, 1];
  tube(M, ts.map((t) => { const p = stem(t); if (!t) p.y = -0.3; return p; }),
    ts.map((t) => lerp(r0, 0.009, Math.pow(t, 0.8))), lod ? 5 : 8, bark,
    { flare: 0.7, flareT: 0.1, lobes: 5, ph, bump: lod ? 0 : 0.14 });

  const base = 0.19 + rnd() * 0.075, girth = 3.05 + rnd() * 0.47, tiers = 7 + Math.floor(rnd() * 2);
  const exposure = rnd() * TAU;
  const fill = mulberry32(seed + 107), needle = new THREE.Color(), normal = new THREE.Vector3();
  let phase = ph;
  for (let i = 0; i < tiers; i++) {
    const fraction = (i + (i > 0 && i < tiers - 1 ? (rnd() - 0.5) * 0.40 : 0)) / (tiers - 1);
    const t = 1 - Math.pow(1 - fraction, 1.38);
    const h = lerp(base, 0.925, t), envelope = 0.44 + girth * Math.pow(1 - t, 0.74);
    const radius = envelope * (0.87 + rnd() * 0.28), branches = (t > 0.87 ? 3 : 5) + Math.floor(rnd() * 2);
    phase += 1.7 + rnd() * 1.4;
    for (let b = 0; b < branches; b++) {
      const a = phase + (b + (rnd() - 0.5) * 0.55) * TAU / branches;
      const reach = radius * (0.72 + rnd() * 0.44 + 0.14 * Math.cos(a - exposure));
      const L = Math.min(reach, envelope * 1.14);
      const origin = stem(h + (0.048 * Math.cos(a - phase + i) + (rnd() - 0.5) * 0.060) * (1 - t));
      const slope = 0.22 + rnd() * 0.22 - 0.46 * t * t, bend = (rnd() - 0.5) * 0.24;
      const along = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), across = new THREE.Vector3(-along.z, 0, along.x);
      const onBranch = (u) => origin.clone().addScaledVector(along, L * u).addScaledVector(across, L * bend * u * u)
        .addScaledVector(UP, L * (0.10 * Math.sin(Math.PI * u) - (slope + 0.12) * u * u * (2.2 - 1.2 * u)));
      if (!lod) tube(M, [origin, onBranch(0.22), onBranch(0.48)], [0.024 * L, 0.016 * L, 0.006 * L], 3, bark, { tip: false });
      const pattern = Math.floor(rnd() * 2), tile = TILE.spray[0] + pattern;
      const snowLoad = rnd(), roll = (rnd() - 0.5) * 0.38;
      tones.lum = 0.87 + rnd() * 0.23;
      const collar = 0.015 + rnd() * 0.085, W = L * (0.36 + rnd() * 0.14);
      firFan(M, lod, onBranch(collar), a + bend * collar, L * (1 - collar), W, slope + 0.12, bend, roll, tile, tones, o.snowy && snowLoad > 0.08);
      // Recess a needle tuft under selected forks. It overlaps the existing fans
      // from the side while the edge of the crown keeps the branch silhouette.
      if (i < tiers - 1 && (i + b) % 3 !== 0) {
        const u = 0.24 + fill() * 0.24, p = onBranch(u);
        const size = L * (0.246 + 0.074 * fill());
        p.y -= size * (0.19 + fill() * 0.23);
        normal.copy(along).addScaledVector(UP, 0.45).normalize();
        needle.copy(tones.dark).lerp(tones.mid, 0.61 + fill() * 0.16).multiplyScalar(tones.lum);
        // Point the atlas shoot toward the underside of its bough.
        const turn = 0.58 + 0.34 * fill();
        M.card(p, normal, needle, size, (pattern + turn) * 0.5, TILE.spray, 1);
      }
      // An isolated shoot occupies one side of the larger spaces between whorls.
      if (i > 0 && t < 0.91 && (b === 0 || b === 3)) {
        const root = stem(h - (0.036 + 0.026 * (1 - t)));
        firFan(M, lod, root, a + 0.64, L * 0.75, W * 0.85, slope + 0.12,
          -bend, -roll, tile, tones, o.snowy && snowLoad > 0.34);
      }
      if (i === tiers - 1) continue;
      // Forks spring from different points; their tips pull down with their own weight.
      for (const side of [-1, 1]) {
        const u = 0.13 + rnd() * 0.31, wing = 0.54 + rnd() * 0.28;
        const fork = a + side * (0.49 + rnd() * 0.43), sag = slope + 0.18 + rnd() * 0.26;
        // Allow for the sideways bend of both the stem and the fork at its tip.
        const wingLength = Math.min(L * wing, (envelope * 1.15 - L * u * Math.hypot(1, bend * u)) / Math.hypot(1, 0.14));
        firFan(M, lod, onBranch(u), fork, wingLength, W * (0.62 + rnd() * 0.26), sag, -side * 0.14,
          roll + side * 0.19, TILE.spray[0] + 1 - pattern, tones, o.snowy && snowLoad > 0.28);
      }
    }
  }
  // Upright buds hug the last stretch of wood to give the leader a green taper.
  for (let k = 0; k < 7; k++) {
    const t = k / 6, length = 0.41 - 0.29 * t;
    firFan(M, lod, stem(0.889 + 0.097 * t), phase + k * 2.4, length, length * 0.70,
      -(0.77 + t * 0.77), 0.12, 0.08, TILE.spray[0] + (k & 1), tones, false);
  }
  return M.geometry();
}

// ---------------- dead tree: gnarled, forking, ash-grey ----------------
function deadTree(seed, lod) {
  const rnd = mulberry32(seed);
  const M = new Mesher();
  const H = 4.4 + rnd() * 1.4;
  const ts = [0, 0.05, 0.14, 0.3, 0.5, 0.72, 1];
  const ph = rnd() * TAU;
  const pts = ts.map((t) => new THREE.Vector3(Math.sin(t * 4 + ph) * 0.4 * t, t * H - (t === 0 ? 0.3 : 0), Math.cos(t * 3 + ph) * 0.3 * t));
  const bc = barkColor(BARK.ash);
  tube(M, pts, ts.map((t) => lerp(0.36, 0.08, t)), lod ? 5 : 7, bc, { flare: 1.4, flareT: 0.2, lobes: 4, ph, bump: lod ? 0 : 0.2 });
  const grow = (from, dir, L, r, depth) => {
    // (the far model keeps the ends of the same curved limb, so its forks sit where the near one's do)
    const bend = 0.25 + rnd() * 0.3, full = limbPath(rnd, from, dir, L, 3, bend, 0.7), lp = lod ? [full[0], full[3]] : full;
    tube(M, lp, lp.map((_, k) => lerp(r, r * 0.4, k / (lp.length - 1))), lod ? 3 : 5, bc, {});
    if (depth > 0) for (let f = 0; f < 2; f++) {
      const d2 = dir.clone().add(new THREE.Vector3((rnd() - 0.5) * 1.4, 0.3 + rnd() * 0.4, (rnd() - 0.5) * 1.4));
      grow(lp[lp.length - 1], d2, L * 0.55, r * 0.45, depth - 1);
    }
  };
  for (let b = 0; b < 4; b++) {
    const a = b * 1.7 + rnd() * 0.8;
    const k = 3 + Math.floor(rnd() * 3);
    grow(pts[k], new THREE.Vector3(Math.cos(a), 0.55 + rnd() * 0.5, Math.sin(a)), 1.3 + rnd() * 0.9, 0.12, 2);
  }
  return M.geometry();
}

// ---------------------------------------------------------------------------
// shrubs & ground cover
function bush(seed, lod, kind = 0) {
  const rnd = mulberry32(seed);
  const M = new Mesher();
  const pal = [
    { light: 0x9ccc5a, dark: 0x3f7a34, deep: 0x2c5a2a, tip: 0xc6e07a },
    { light: 0x8ec45e, dark: 0x3a7038, deep: 0x285228 },
    { light: 0xa8c858, dark: 0x4a7a30, deep: 0x30562a, tip: 0xd0dc80 },
  ][kind % 3];
  const crown = { c: new THREE.Vector3(0, 0.35, 0), rx: 0.95, ry: 0.65 };
  const colorer = leafColor(pal);
  // stems come up from the ground into every clump; no leaves are made below it
  const F = new Foliage(lod, barkColor(BARK.dark));
  F.floor = 0.02;
  const cards = { ...(lod ? FAR_CARDS : NEAR_CARDS), n: lod ? 20 : 100, size: lod ? 0.62 : 0.3, heart: lod ? 0 : 5 };
  for (const [x, y, z, r] of [[-0.45, 0.38, 0.1, 0.55], [0.35, 0.52, 0, 0.63], [0, 0.32, 0.48, 0.45]]) {
    F.add(new THREE.Vector3(x, y, z), r, Math.floor(rnd() * 1e9),
      { crown, color: colorer(crown, 0, 0.98 + rnd() * 0.04), flat: 0.76, bend: 0.18, cards, twig: 0.02 }, new THREE.Vector3(0, 0.04, 0));
  }
  F.emit(M);
  if (kind > 0 && !lod) {
    // blossoms / berries dotted over the upper surface of the clumps
    const fl = kind === 1 ? [hc(0xf4a0bc), hc(0xfff0b0), hc(0xf0f0ec), hc(0xc2a8f4)][Math.floor(rnd() * 4)] : hc(0xc8323a);
    const n = kind === 1 ? 16 : 12;
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, el = 0.25 + rnd() * 1.1, q = F.list[Math.floor(rnd() * F.list.length)];
      const p = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el) * 0.78, Math.sin(a) * Math.cos(el)).multiplyScalar(q.r).add(q.c);
      // (not one sunk in a neighbouring clump)
      if (F.buried(p, q)) continue;
      puff(M, p, kind === 1 ? 0.07 : 0.055, 0, Math.floor(rnd() * 1e6), { crown, color: (c) => { c.copy(fl).multiplyScalar(0.85 + rnd() * 0.15); return 0.3; }, flat: kind === 1 ? 0.5 : 1, bend: 0.2, jit: 0.2 });
    }
  }
  return M.geometry();
}

// The variants of every scattered tree and bush: kind -> [(far) => geometry, ...]. The order
// is the variant index of the placed instances.
const oakOf = (s, o) => (l) => broadleaf(s, l, o);
export const TREES = {
  oak: [oakOf(11, {}), oakOf(12, { size: 2.0, trunkH: 3.2 }), oakOf(13, { light: 0xc4d65c, dark: 0x5f8a36, deep: 0x3c6a2c, tip: 0xdce888 }), oakOf(14, { size: 1.6, limbs: 3 })],
  maple: [oakOf(21, { light: 0xf2b04a, dark: 0xc0602e, deep: 0x8a3a24, tip: 0xf8d070, size: 1.8, cards: MAPLE_CARDS }), oakOf(22, { light: 0xf0cf5a, dark: 0xb88a2e, deep: 0x7a5a22, tip: 0xf8e490, size: 1.7, cards: MAPLE_CARDS }), oakOf(23, { light: 0xe8864a, dark: 0xa8402e, deep: 0x742a22, tip: 0xf4b870, size: 1.6, cards: MAPLE_CARDS })],
  blossom: [oakOf(31, { light: 0xf4cad8, dark: 0xd08aa8, deep: 0x9a5a78, tip: 0xf6e0e8, size: 1.3, trunkH: 2.2, bark: 'blossom', r0: 0.24, hueJit: 0.03, cards: BLOSSOM_CARDS }), oakOf(32, { light: 0xf0e2e6, dark: 0xc8a0b4, deep: 0x8a6a80, size: 1.2, trunkH: 2.0, bark: 'blossom', r0: 0.22, cards: BLOSSOM_CARDS })],
  poplar: [(l) => poplar(41, l), (l) => poplar(42, l)],
  birch: [(l) => birch(51, l), (l) => birch(52, l), (l) => birch(53, l)],
  willow: [(l) => willow(61, l), (l) => willow(62, l, { size: 1.8 })],
  pine: [(l) => conifer(71, l, { pal: 0 }), (l) => conifer(72, l, { pal: 1 }), (l) => conifer(73, l, { pal: 2 })],
  pineSnow: [(l) => conifer(81, l, { pal: 0, snowy: true }), (l) => conifer(82, l, { pal: 1, snowy: true })],
  dead: [(l) => deadTree(91, l), (l) => deadTree(92, l)],
  bush: [(l) => bush(101, l, 0), (l) => bush(102, l, 1), (l) => bush(103, l, 2), (l) => bush(104, l, 1)],
};

// Fern: arching fronds with separated leaflets on a fine rachis (252 triangles).
function fern(seed) {
  const rnd = mulberry32(seed);
  const M = new Mesher();
  const base = hc(0x2a5628), tip = hc(0x86be5c), mid = hc(0x4f8a3a);
  const F = 7;
  const col = new THREE.Color();
  for (let f = 0; f < F; f++) {
    const a = (f / F) * TAU + rnd() * 0.5;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const L = 0.7 + rnd() * 0.5, lift = 0.38 + rnd() * 0.3;
    const S = 6;
    let prevL = -1, prevR = -1;
    for (let s = 0; s <= S; s++) {
      const t = s / S;
      const w = 0.009 * (1 - t * 0.8);
      const cx = dx * L * t, cz = dz * L * t, cy = Math.sin(t * Math.PI * 0.75) * lift - t * t * 0.14;
      col.copy(base).lerp(mid, smoothstep(0, 0.4, t)).lerp(tip, smoothstep(0.4, 1, t) * 0.8);
      const n = V.set(dx * 0.25, 0.95, dz * 0.25).normalize();
      const l = M.vert(V2.set(cx + px * w, cy + 0.015, cz + pz * w), n, col, 1);
      const r = M.vert(V2.set(cx - px * w, cy + 0.015, cz - pz * w), n, col, 1);
      if (prevL >= 0) M.quad(prevL, prevR, r, l);
      prevL = l; prevR = r;
      if (!s) continue;
      const reach = 0.28 * Math.pow(Math.sin(Math.PI * (0.1 + t * 0.85)), 0.8);
      for (const side of [-1, 1]) {
        const rx = cx - dx * 0.035, rz = cz - dz * 0.035;
        const ex = rx + px * side * reach + dx * 0.08, ez = rz + pz * side * reach + dz * 0.08;
        const mx = lerp(rx, ex, 0.46), mz = lerp(rz, ez, 0.46), width = reach * 0.38;
        const b = M.vert(V2.set(rx, cy, rz), n, col, 1);
        const a = M.vert(V2.set(mx - dx * width, cy + 0.025, mz - dz * width), n, col.clone().multiplyScalar(0.87), 1);
        const e = M.vert(V2.set(ex, cy - reach * 0.16, ez), n, col.clone().lerp(tip, 0.25), 1);
        const d = M.vert(V2.set(mx + dx * width, cy + 0.025, mz + dz * width), n, col, 1);
        M.quad(b, a, e, d);
      }
    }
  }
  return M.geometry();
}

// Blade helper (double-sided material): tapered strip from base to tip
function blade(M, x, z, h, w, lx, lz, c0, c1, rnd, a = 1) {
  const ang = rnd() * Math.PI, ca = Math.cos(ang), sa = Math.sin(ang);
  const rows = [[0, w], [0.5, w * 0.75], [0.85, w * 0.35], [1, 0]];
  const n = V3.set(-sa, 0.5, ca).normalize().clone();
  const col = new THREE.Color();
  let prev = null;
  for (const [t, ww] of rows) {
    const bx = x + lx * t * t, bz = z + lz * t * t, by = h * t;
    col.copy(c0).lerp(c1, t);
    const L = M.vert(V.set(bx - ca * ww, by, bz - sa * ww), n, col.clone().multiplyScalar(0.9), a);
    const R = ww > 0 ? M.vert(V.set(bx + ca * ww, by + ww * 0.22, bz + sa * ww), n, col, a) : L;
    if (prev) { if (R === L) M.tri(prev[0], prev[1], L); else M.quad(prev[0], prev[1], R, L); }
    prev = [L, R];
  }
}

function reeds(seed) {
  const rnd = mulberry32(seed);
  const M = new Mesher();
  const base = hc(0x3e5e2a), tip = hc(0xbcc46e), brown = hc(0x5a3624), dry = hc(0xc2b27a);
  for (let i = 0; i < 16; i++) {
    const r = rnd() * 0.4, a = rnd() * TAU;
    blade(M, Math.cos(a) * r, Math.sin(a) * r, 1.1 + rnd() * 0.9, 0.035, Math.cos(a) * 0.3, Math.sin(a) * 0.3, base, rnd() < 0.2 ? dry : tip, rnd);
  }
  // cattails: stem + brown head
  for (let i = 0; i < 4; i++) {
    const x = (rnd() - 0.5) * 0.45, z = (rnd() - 0.5) * 0.45, h = 1.5 + rnd() * 0.6;
    blade(M, x, z, h, 0.012, 0, 0, base, tip, rnd);
    const pts = [new THREE.Vector3(x, h - 0.42, z), new THREE.Vector3(x, h - 0.3, z), new THREE.Vector3(x, h - 0.12, z)];
    tube(M, pts, [0.02, 0.036, 0.018], 5, (c, t) => { c.copy(brown).lerp(dry, 0.12 + t * 0.18); return 0; }, {});
  }
  return M.geometry();
}

// Wildflower clump: leafy base, thin stems, five-petal heads facing up
const FLOWER_PAL = [
  [0xf4f0e6, 0xf4c83a], [0xf6d24a, 0xd88a2a], [0xe890b4, 0xf8e0a0], [0x9a8cf0, 0xf6e6a0], [0xf07850, 0xf8d060], [0x7ab0f0, 0xf8f0d0],
];
function flowers(seed, palIdx) {
  const rnd = mulberry32(seed);
  const M = new Mesher();
  const leaf0 = hc(0x3a6a2c), leaf1 = hc(0x86b858);
  for (let i = 0; i < 6; i++) {
    const a = rnd() * TAU, r = rnd() * 0.25;
    blade(M, Math.cos(a) * r, Math.sin(a) * r, 0.25 + rnd() * 0.15, 0.05, Math.cos(a) * 0.2, Math.sin(a) * 0.2, leaf0, leaf1, rnd);
  }
  const n = 8 + Math.floor(rnd() * 5);
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const pal = FLOWER_PAL[(palIdx + (rnd() < 0.2 ? 1 : 0)) % FLOWER_PAL.length];
    const pet = hc(pal[0]), ctr = hc(pal[1]);
    const a = rnd() * TAU, r = 0.05 + rnd() * 0.35;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.38 + rnd() * 0.34;
    blade(M, x, z, h, 0.012, Math.cos(a) * 0.08, Math.sin(a) * 0.08, leaf0, leaf1, rnd);
    const hx = x + Math.cos(a) * 0.08, hz = z + Math.sin(a) * 0.08;
    const fr = 0.09 + rnd() * 0.05;
    const tilt = new THREE.Vector3(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3).normalize();
    const ci = M.vert(V.set(hx, h + 0.015, hz), tilt, col.copy(ctr), 0.5);
    const rot = rnd() * TAU;
    const ring = [];
    for (let k = 0; k < 15; k++) {
      const pa = rot + (k / 15) * TAU, valley = k % 3 === 0, rr = fr * (valley ? 0.32 : 1);
      col.copy(pet).multiplyScalar(valley ? 0.86 : 1);
      ring.push(M.vert(V.set(hx + Math.cos(pa) * rr, h + (valley ? -0.015 : 0.025) + Math.cos(pa - a) * fr * 0.25, hz + Math.sin(pa) * rr), tilt, col, 0.5));
    }
    for (let k = 0; k < 15; k++) M.tri(ci, ring[(k + 1) % 15], ring[k]);
  }
  return M.geometry();
}

function mushrooms(seed) {
  const rnd = mulberry32(seed);
  const parts = [];
  const capU = hc(0xe8dcc0), stem = hc(0xeee4cc), dot = hc(0xf6f0e4);
  const n = 3 + Math.floor(rnd() * 3);
  const paint = (g, fn) => {
    g = g.index ? g.toNonIndexed() : g;
    g.deleteAttribute('uv');
    const p = g.attributes.position, col = new Float32Array(p.count * 4), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) { V.fromBufferAttribute(p, i); fn(V, c); col[i * 4] = c.r; col[i * 4 + 1] = c.g; col[i * 4 + 2] = c.b; col[i * 4 + 3] = 0; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    return g;
  };
  for (let i = 0; i < n; i++) {
    const red = i === 0 || rnd() < 0.35;
    const capC = red ? hc(0xc4402c) : hc(0xc8a070);
    const x = (rnd() - 0.5) * 0.55, z = (rnd() - 0.5) * 0.55, s = 0.6 + rnd() * 0.7;
    const sh = 0.24 * s, cr = 0.14 * s;
    const st = new THREE.CylinderGeometry(0.03 * s, 0.05 * s, sh, 6, 1, true);
    st.translate(x, sh / 2, z);
    parts.push(paint(st, (v, c) => c.copy(stem).multiplyScalar(0.72 + 0.28 * smoothstep(0, sh, v.y))));
    const cap = new THREE.SphereGeometry(cr, 8, 3, 0, TAU, 0, Math.PI / 2);
    cap.scale(1, 0.62, 1); cap.translate(x, sh - 0.01, z);
    parts.push(paint(cap, (v, c) => {
      const rise = clamp((v.y - sh + 0.01) / (cr * 0.62), 0, 1);
      c.copy(capC).multiplyScalar(0.76 + rise * 0.24).lerp(dot, smoothstep(0.78, 1, rise) * 0.12);
      // Broad cream flecks in cap-local coordinates, not random triangular speckle.
      const angle = Math.atan2(v.z - z, v.x - x);
      if (red && rise > 0.3 && rise < 0.85 && Math.cos(angle * 3 + i) > 0.82) c.lerp(dot, 0.88);
    }));
    const und = new THREE.CircleGeometry(cr * 0.98, 8);
    und.rotateX(Math.PI / 2); und.translate(x, sh - 0.01, z);
    parts.push(paint(und, (v, c) => c.copy(capU)));
  }
  const g = mergeGeometries(parts);
  g.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(1), 1));
  return g;
}

// End grain: a few quiet growth bands and a bevel at the bark rim. Shared by the log and
// stump, in the same geometry/material as the bark (no extra draw calls).
function growthDisc(M, center, normal, axis, r, seg = 9) {
  const across = new THREE.Vector3().crossVectors(normal, axis), col = new THREE.Color();
  const ci = M.vert(center.clone().addScaledVector(normal, -r * 0.025), normal, col.set(0x9b774e), 0);
  let prev = null;
  for (const [f, tone] of [[0.32, 0xc1a06e], [0.4, 0x9e7e52], [0.77, 0xd0b381], [1, 0x98744c]]) {
    const ring = [];
    for (let k = 0; k < seg; k++) {
      const a = k / seg * TAU, rr = r * f * (1 + Math.sin(a * 3 + 0.6) * 0.025 * (1 - f));
      const p = center.clone().addScaledVector(axis, Math.cos(a) * rr).addScaledVector(across, Math.sin(a) * rr);
      p.addScaledVector(normal, f === 1 ? -r * 0.04 : r * 0.018);
      ring.push(M.vert(p, normal, col.set(tone), 0));
    }
    for (let k = 0; k < seg; k++) {
      const next = (k + 1) % seg;
      if (prev) M.quad(prev[k], ring[k], ring[next], prev[next]);
      else M.tri(ci, ring[k], ring[next]);
    }
    prev = ring;
  }
}

function fallenLog(seed) {
  const rnd = mulberry32(seed);
  const M = new Mesher();
  const L = 2.8 + rnd() * 1.2, r = 0.28 + rnd() * 0.1;
  const bark = hc(0x4a3828), barkL = hc(0x76583e), moss = hc(0x5f8a38);
  const pts = [0, 0.33, 0.66, 1].map((t) => new THREE.Vector3(-L / 2 + t * L, r * 0.85 + Math.sin(t * 3) * 0.04, Math.sin(t * 2.2) * 0.12));
  tube(M, pts, [r, r * 0.97, r * 0.93, r * 0.88], 9, (c, t, ang, p) => {
    c.copy(bark).lerp(barkL, clamp((p.y - pts[0].y) / (r * 2) + 0.5, 0, 1) * 0.6);
    c.lerp(moss, smoothstep(r * 1.25, r * 1.8, p.y) * (0.35 + 0.2 * Math.sin(p.x * 2.1)));
    return 0;
  }, { tip: false, bump: 0.1 });
  // cut end caps with growth rings
  for (const e of [0, 3]) {
    const cN = new THREE.Vector3(e ? 1 : -1, 0, 0);
    const rr = e ? r * 0.88 : r;
    growthDisc(M, pts[e], cN, UP, rr);
  }
  // broken branch stub + shelf fungus
  const stub = limbPath(rnd, pts[1].clone().add(new THREE.Vector3(0, r * 0.7, 0)), new THREE.Vector3(0.4, 1, 0.5), 0.6, 2, 0, 0.2);
  tube(M, stub, [0.08, 0.06, 0.04], 5, (c) => { c.copy(bark); return 0; }, {});
  for (let i = 0; i < 3; i++) {
    const x = -L * 0.25 + i * 0.18;
    puff(M, new THREE.Vector3(x, r * (0.8 + i * 0.12), r * 0.95), 0.13 - i * 0.02, 0, 77 + i, { crown: { c: new THREE.Vector3(x, r, 0), rx: 1, ry: 1 }, color: (c) => { c.set(0xe2c898); return 0; }, flat: 0.3, bend: 0.3 });
  }
  return M.geometry();
}

function stump(seed) {
  const rnd = mulberry32(seed);
  const M = new Mesher();
  const r = 0.38 + rnd() * 0.12, h = 0.55 + rnd() * 0.3;
  const pts = [new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(0.02, h * 0.6, 0), new THREE.Vector3(0.03, h, 0)];
  tube(M, pts, [r, r * 0.92, r * 0.86, r * 0.84], 9, barkColor(BARK.oak, 0.9), { flare: 1.1, flareT: 0.45, lobes: 5, tip: false, bump: 0.12 });
  growthDisc(M, pts[3], UP, new THREE.Vector3(1, 0, 0), r * 0.84);
  return M.geometry();
}

// The viewer and the world use the same small-plant variants.
export const COVER = {
  fern: [111, 112].map((s) => () => fern(s)),
  flowers: [0, 1, 2, 3, 4, 5].map((k) => () => flowers(121 + k, k)),
  reeds: [131, 132].map((s) => () => reeds(s)),
  mushroom: [() => mushrooms(141)],
  log: [151, 152].map((s) => () => fallenLog(s)),
  stump: [161, 162].map((s) => () => stump(s)),
};

function pebbles(seed) {
  const rnd = mulberry32(seed);
  const parts = [];
  const n = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const s = 0.06 + rnd() * 0.16;
    const a = rnd() * TAU, r = rnd() * 0.8;
    parts.push(rockShape(Math.floor(rnd() * 1e6), 0, { scale: [s * (1 + rnd() * 0.3), s * (0.5 + rnd() * 0.3), s], at: [Math.cos(a) * r, s * 0.15, Math.sin(a) * r], cuts: 2, moss: 0, tone: rnd() < 0.5 ? 0x9a9286 : 0x8a8a92 }));
  }
  return mergeGeometries(parts);
}

// ---------------------------------------------------------------------------
// Rocks: jittered icosphere pressed against a few random cut planes, which
// gives chunky flat facets and sharp edges; per-face tone jitter, mossy tops.
function rockShape(seed, detail, o = {}) {
  const rnd = mulberry32(seed);
  const { pos, idx } = ICO[detail];
  const [sx, sy, sz] = o.scale ?? [1, 0.75, 0.9];
  const pts = [];
  const jseed = rnd() * 50;
  for (let k = 0; k < pos.length; k += 3) {
    const d = new THREE.Vector3(pos[k], pos[k + 1], pos[k + 2]);
    const j = 1 + (hash3(d.x * 3.1 + jseed, d.y * 3.1, d.z * 3.1) - 0.5) * (o.jit ?? 0.28);
    pts.push(d.multiplyScalar(j));
  }
  const nCut = o.cuts ?? 5;
  for (let c = 0; c < nCut; c++) {
    const a = rnd() * TAU, el = c === 0 ? 1.2 + rnd() * 0.35 : (rnd() - 0.3) * 0.9;
    const n = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
    const off = 0.55 + rnd() * 0.25;
    for (const p of pts) { const dd = p.dot(n); if (dd > off) p.addScaledVector(n, off - dd); }
  }
  for (const p of pts) {
    if (p.y < -0.35) p.y = -0.35 + (p.y + 0.35) * 0.3;
    p.x *= sx; p.y *= sy; p.z *= sz;
    if (o.at) { p.x += o.at[0]; p.y += o.at[1]; p.z += o.at[2]; }
  }
  // flat-shaded soup with per-face colour
  const P = [], C = [];
  const base = hc(o.tone ?? 0xa39a8e), dark = hc(o.dark ?? 0x625c55), moss = hc(0x6a9442), mossD = hc(0x4e7a34);
  const c = new THREE.Color(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
  const band = o.bands ?? 0;
  for (let f = 0; f < idx.length; f += 3) {
    const a = pts[idx[f]], b = pts[idx[f + 1]], d = pts[idx[f + 2]];
    e1.subVectors(b, a); e2.subVectors(d, a); fn.crossVectors(e1, e2).normalize();
    const cy = (a.y + b.y + d.y) / 3 - (o.at ? o.at[1] : 0);
    c.copy(dark).lerp(base, smoothstep(-0.3 * sy, 0.5 * sy, cy)).multiplyScalar(0.86 + rnd() * 0.24);
    if (band) c.multiplyScalar(0.9 + 0.14 * Math.sin(cy * band));
    const mo = (o.moss ?? 0.6) * smoothstep(0.62, 0.92, fn.y + (rnd() - 0.5) * 0.3);
    if (mo > 0) c.lerp(rnd() < 0.5 ? moss : mossD, mo);
    if (o.snow) c.lerp(hc(0xc6d0de), smoothstep(0.45, 0.8, fn.y) * o.snow);
    for (const v of [a, b, d]) { P.push(v.x, v.y, v.z); C.push(c.r, c.g, c.b, 0); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 4));
  g.computeVertexNormals();
  return g;
}
// Layered boulder: two or three stacked slabs, slightly offset (sedimentary)
function layeredRock(seed, detail, o = {}) {
  const rnd = mulberry32(seed);
  const n = 2 + Math.floor(rnd() * 2);
  const parts = [];
  let y = -0.1;
  for (let i = 0; i < n; i++) {
    const w = 1.05 - i * 0.22 + rnd() * 0.1, th = 0.34 + rnd() * 0.12;
    const tone = [0xa69c8c, 0x948c80, 0xb0a594][i % 3];
    const g = rockShape(Math.floor(rnd() * 1e6), detail, { scale: [w, th, w * (0.75 + rnd() * 0.2)], at: [(rnd() - 0.5) * 0.3, y + th * 0.35, (rnd() - 0.5) * 0.3], cuts: 4, moss: i === n - 1 ? 0.6 : 0.2, tone, ...o });
    g.rotateY(rnd() * 0.8);
    parts.push(g);
    y += th * 0.85;
  }
  return mergeGeometries(parts);
}
// Sculpted rock from public/models/pr_rocks.glb (restyled scans, see public/models/README.md): near
// or far model of the named rock, or null when the file is missing. Cloned: the scatter adds `aFade` to it.
export function rockModel(name, lod) {
  const P = authoredParts('rocks'), part = P && P[name + (lod ? '_f' : '_n')];
  if (!part) return null;
  const g = part[0].geo.clone();
  // [x, z, r, top] per mass of the sculpt, in model space: the colliders (Props.add)
  const m = part[0].extras && part[0].extras.masses;
  if (m) { g.userData.masses = Array.from(m); for (let i = 1; i < m.length; i += 4) g.userData.masses[i] = -m[i]; }
  return g;
}
// Material of the scattered rocks. The sculpted ones are painted in an atlas (albedo, moss
// included, and a normal map with the designed planes and the scan's fine relief:
// public/models/pr_rocktex.glb). The world-space rock layer of the toon shader adds the grain.
export function rockMaterial(o = {}) {
  const tex = authoredParts('rocks') && authoredTex('rocktex');
  if (!tex) return toon(0xffffff, { vertexColors: true, flat: true, rim: 0.15, tex: 'rock', ...o });
  const m = toon(0xffffff, { vertexColors: true, rim: 0.15, tex: 'rock', noMoss: true, nocache: true, ...o });
  m.map = tex.map;
  if (tex.normalMap) { m.normalMap = tex.normalMap; m.normalScale.set(1, -1); }
  return m;
}
// the authored rock standing in for each code-built variant (kind + seed)
const ROCK_MODEL = { round181: 'roundA', round184: 'roundB', layer182: 'layerA', flat183: 'flatA', spire191: 'spireA', layer192: 'layerB', round193: 'cragA', crag194: 'cragB', round201: 'snowRound', spire202: 'snowSpire' };
function rockVariant(kind, seed, lod, o = {}) {
  const authored = ROCK_MODEL[kind + seed] && rockModel(ROCK_MODEL[kind + seed], lod);
  if (authored) return authored;
  if (kind === 'crag') kind = 'round';
  const d = lod ? 0 : 1;
  if (kind === 'layer') return layeredRock(seed, d, o);
  if (kind === 'spire') return rockShape(seed, d, { scale: [0.7, 1.7, 0.65], cuts: 6, jit: 0.22, bands: 7, ...o });
  if (kind === 'flat') return rockShape(seed, d, { scale: [1.2, 0.45, 1.0], cuts: 4, ...o });
  return rockShape(seed, d, { scale: [1, 0.72 + (seed % 7) * 0.04, 0.88], cuts: 5, ...o });
}

// ---------------------------------------------------------------------------
// Instanced scatter with per-instance LOD + culling
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Color();
const frustum = new THREE.Frustum(), projM = new THREE.Matrix4(), sph = new THREE.Sphere();
export { SHADOW_LAYER };

// Cut timber keeps bark on the sides and painted end grain on its horizontal faces.
// This material owns its hook; cached toon materials and the shared bark shader stay untouched.
export function cutWoodMaterial(opts = {}) {
  const mat = toon(0xffffff, { vertexColors: true, rim: 0.3, tex: 'bark', ...opts, nocache: true });
  const compile = mat.onBeforeCompile, key = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    compile.call(mat, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('bw /= max(bw.x + bw.y + bw.z, 1e-4);',
      'mixK *= smoothstep(0.0, 0.015, bw.x + bw.z);\n        bw /= max(bw.x + bw.y + bw.z, 1e-4);');
  };
  mat.customProgramCacheKey = () => key + '|cutWood';
  return mat;
}

export class Props {
  constructor(scene, terrain, colliders, quality = 'high') {
    this.scene = scene; this.T = terrain; this.col = colliders;
    this.quality = quality;
    // lodFade: near and far models cross-fade with a dither across the LOD band (update())
    const tree = toon(0xffffff, { vertexColors: true, sway: 0.045, swayBase: 0.18, rim: 0.35, tex: 'bark', leafy: true, lodFade: true, cards: true });
    const fir = toon(0xffffff, { vertexColors: true, sway: 0.034, swayBase: 0.18, rim: 0.3, tex: 'bark', leafy: true, lodFade: true, cards: true });
    const shrub = toon(0xffffff, { vertexColors: true, sway: 0.21, swayBase: 0, rim: 0.3, tex: 'bark', leafy: true, lodFade: true, cards: true });
    const ground = toon(0xffffff, { vertexColors: true, sway: 0.18, swayBase: 0.05, rim: 0.25, side: THREE.DoubleSide, lodFade: true });
    const solid = toon(0xffffff, { vertexColors: true, rim: 0.3, tex: 'bark', lodFade: true });
    const rockMat = rockMaterial({ lodFade: true });
    const small = toon(0xffffff, { vertexColors: true, rim: 0.3, lodFade: true });
    const cutWood = cutWoodMaterial({ lodFade: true });
    this.mats = { tree, fir, shrub, ground, solid, rockMat, small, cutWood };
    // variants: [nearGeo, farGeo|null]; near: LOD switch distance; max: draw distance
    const pair = (fn) => [fn(false), fn(true)];
    // the sculpted rocks stand on the ground line with a skirt below it; the code-built ones were half buried
    const rockSunk = authoredParts('rocks') ? 0.15 : 0.4;
    const T = (variants, mat, o = {}) => ({ variants, mat, items: [], shadow: o.shadow ?? true, near: o.near ?? 42, max: o.max ?? 1e9, tint: o.tint ?? 0.06, sunk: o.sunk ?? 0.15, keep: o.keep ?? 52 });
    const grown = (kind) => TREES[kind].map(pair);
    const cover = (kind) => COVER[kind].map((fn) => [fn(), null]);
    this.types = {
      oak: T(grown('oak'), tree),
      maple: T(grown('maple'), tree),
      blossom: T(grown('blossom'), tree),
      poplar: T(grown('poplar'), tree),
      birch: T(grown('birch'), tree),
      willow: T(grown('willow'), tree),
      pine: T(grown('pine'), fir, { tint: 0.1 }),
      pineSnow: T(grown('pineSnow'), fir),
      dead: T(grown('dead'), solid),
      bush: T(grown('bush'), shrub, { shadow: false, near: 45, max: 190, keep: 30 }),
      fern: T(cover('fern'), ground, { shadow: false, max: 70, tint: 0.1, keep: 0 }),
      flowers: T(cover('flowers'), ground, { shadow: false, max: 65, tint: 0.05, sunk: 0.02, keep: 0 }),
      reeds: T(cover('reeds'), ground, { shadow: false, max: 110, tint: 0.08, keep: 0 }),
      mushroom: T(cover('mushroom'), small, { shadow: false, max: 55, tint: 0.05, sunk: 0.02, keep: 0 }),
      log: T(cover('log'), cutWood, { shadow: true, max: 140, near: 1e9, keep: 30 }),
      stump: T(cover('stump'), cutWood, { shadow: true, max: 120, near: 1e9, keep: 30 }),
      pebbles: T([[rockModel('pebblesA', 0) || pebbles(171), null], [rockModel('pebblesB', 0) || pebbles(172), null]], rockMat, { shadow: false, max: 75, tint: 0.12, sunk: 0.02, keep: 0 }),
      rock: T([pair((l) => rockVariant('round', 181, l)), pair((l) => rockVariant('round', 184, l)), pair((l) => rockVariant('layer', 182, l)), pair((l) => rockVariant('flat', 183, l, { moss: 0.5 }))], rockMat, { tint: 0.1, near: 70, sunk: rockSunk }),
      rockBig: T([pair((l) => rockVariant('spire', 191, l)), pair((l) => rockVariant('layer', 192, l)), pair((l) => rockVariant('round', 193, l, { cuts: 7 })), pair((l) => rockVariant('crag', 194, l, { cuts: 7 }))], rockMat, { tint: 0.1, near: 110, sunk: rockSunk }),
      rockSnow: T([pair((l) => rockVariant('round', 201, l, { snow: 0.85, moss: 0, tone: 0x8e929a })), pair((l) => rockVariant('spire', 202, l, { snow: 0.8, moss: 0, tone: 0x8a8e98 }))], rockMat, { tint: 0.08, near: 80, sunk: rockSunk }),
    };
    for (const t of Object.values(this.types)) {
      t.bounds = t.variants.map(([g]) => { g.computeBoundingBox(); g.computeBoundingSphere(); return { top: g.boundingBox.max.y, r: g.boundingSphere.radius, cy: g.boundingSphere.center.y, rxz: Math.max(-g.boundingBox.min.x, g.boundingBox.max.x, -g.boundingBox.min.z, g.boundingBox.max.z) }; });
    }
    this.rnd = mulberry32(4242);
    this.scatter(this.rnd, quality);
    this.dirty = true;
    this.meshes = [];
    this.last = { p: new THREE.Vector3(1e9, 0, 0), d: new THREE.Vector3(), t: 0 };
  }

  excluded(x, z, r = 0) {
    const d = (p) => Math.hypot(x - p.x, z - p.z);
    if (d(POI.village) < 36 + r) return true;
    if (d(POI.towerYard) < 26 + r) return true;
    if (d(POI.frost) < 26 + r) return true;
    if (d(POI.storm) < 30 + r) return true;
    if (d(POI.meadow) < 10 + r) return true;
    if (d(POI.rift) < 38 + r) return true;
    if (Math.hypot(x, z) > 226) return true;
    if (this.T.pathInfo(x, z).d < 4.5 + r) return true;
    return false;
  }

  // Place one instance. o: { v (variant), vy (extra vertical-only scale), ry, dy, col (collider radius factor), tall (trunk collider height) }
  add(type, x, z, s = 1, o = {}) {
    const t = this.types[type], rnd = this.rnd;
    const v = o.v ?? Math.floor(rnd() * t.variants.length);
    const ground = this.T.height(x, z);
    const sunk = t.sunk * s;
    const sy = s * (o.sy ?? (type.startsWith('rock') || type === 'pebbles' ? 1 : 0.92 + rnd() * 0.16)) * (o.vy ?? 1);
    const it = { x, y: ground - sunk + (o.dy ?? 0), z, s, sy, r: o.ry ?? rnd() * TAU, v };
    if (this.tintRandom) {
      if (!this.supported(type, it)) return null;
      it.tint = this.itemTint(t);
    }
    t.items.push(it);
    this.dirty = true;
    const b = t.bounds[v];
    if (o.col) {
      const isRock = type.startsWith('rock');
      const top = it.y + b.top * sy;
      const ms = isRock && t.variants[v][0].userData.masses;
      if (ms && ms.length) {
        // one flat-topped cylinder per mass of the sculpt, so a stepped crag is climbed step by step
        const cr = Math.cos(it.r), sr = Math.sin(it.r), k = o.col / 0.8;
        it.cols = [];
        for (let i = 0; i < ms.length; i += 4) {
          if (i && ms[i + 2] * s < 0.3) continue;
          const c = this.col.addCircle(x + (ms[i] * cr + ms[i + 1] * sr) * s, z + (-ms[i] * sr + ms[i + 1] * cr) * s, ms[i + 2] * s * k, ground - 1, it.y + ms[i + 3] * sy);
          c.rock = true;
          it.cols.push(c);
        }
        it.col = it.cols[0];
      } else if (isRock) {
        // climbable, standable lump whose top matches the mesh
        const c = this.col.addCircle(x, z, b.rxz * s * o.col, ground - 1, top);
        c.rock = true;
        it.col = c;
      } else {
        const c = this.col.addCircle(x, z, o.col * s, ground - 1, ground + (o.tall ?? 6) * s);
        c.climb = false; c.noTop = true;
        it.col = c;
      }
    }
    return it;
  }

  supported(name, it) {
    const { x, z, s, v } = it, t = this.types[name];
    const rock = name.startsWith('rock') || name === 'pebbles';
    if (Math.hypot(x - POI.lake.x, z - POI.lake.z) < POI.lake.r * 1.8) {
      const h = this.T.height(x, z);
      if (name === 'reeds' && (h < -0.75 || h > 1.1 || this.T.pathInfo(x, z).d < 3)) return false;
      if (name !== 'reeds' && !rock && h < 0.15) return false;
    }
    const tree = name in TREES && name !== 'bush';
    const radius = (tree ? 0.85 : t.bounds[v].rxz) * s;
    if (this.T.pathInfo(x, z, this.T.lanes).d < 1.55 + radius) return false;
    return this.T.supportsFootprint(x, z, radius, (tree ? 0.36 : 0.24) * s + 0.06);
  }

  itemTint(t) {
    const rnd = this.tintRandom, j = t.tint;
    return new THREE.Color(1 - j * 0.5 + rnd() * j, 1 - j * 0.5 + rnd() * j, 1 - j * 0.5 + rnd() * j * 0.8);
  }

  // Finish after every landmark clearing and camp has picked its site. Consume
  // the original per-variant tint stream before pruning so distant rocks keep their paint.
  finishPlacement() {
    this.tintRandom = mulberry32(99);
    for (const [name, t] of Object.entries(this.types)) {
      for (let v = 0; v < t.variants.length; v++) for (const it of t.items) if (it.v === v) it.tint = this.itemTint(t);
      t.items = t.items.filter((it) => {
        if (this.supported(name, it)) return true;
        this.removeColliders(it);
        return false;
      });
    }
    this.dirty = true;
  }

  removeColliders(it) {
    for (const c of it.cols || (it.col ? [it.col] : [])) this.col.remove(c);
  }

  // Remove scattered instances (and their colliders) within r of (x, z),
  // e.g. to keep a landmark's surroundings clear. types: optional name list.
  clear(x, z, r, types = null) {
    for (const [name, t] of Object.entries(this.types)) {
      if (types && !types.includes(name)) continue;
      t.items = t.items.filter((it) => {
        if (Math.hypot(it.x - x, it.z - z) >= r) return true;
        this.removeColliders(it);
        return false;
      });
    }
    this.dirty = true;
  }

  // Scattered against the original 480 m map's grid (Terrain.legacy) so the vale keeps
  // exactly the layout it had; instances still sit on the live terrain (add()).
  scatter(rnd, quality) {
    const T = this.T, L = T.legacy();
    const q = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;
    const nv = T.noise;
    const forestAt = (x, z) => smoothstep(0.0, 0.5, fbm(nv, x * 0.012 + 50, z * 0.012, 2));
    const lakeD = (x, z) => Math.hypot(x - POI.lake.x, z - POI.lake.z) / POI.lake.r;
    const woodsD = (x, z) => Math.hypot(x + 92, z - 128);
    const meadowD = (x, z) => Math.hypot(x - POI.meadow.x, z - POI.meadow.z);
    // trees
    for (let i = 0; i < 8000 * q; i++) {
      const x = (rnd() - 0.5) * 460, z = (rnd() - 0.5) * 460;
      const h = L.height(x, z);
      if (h < 0.8) continue;
      const n = L.normal(x, z);
      if (n.y < 0.8) continue;
      const dRift = Math.hypot(x - POI.rift.x, z - POI.rift.z);
      let dens = forestAt(x, z) * 0.8 + 0.04;
      const dW = woodsD(x, z);
      dens += (1 - smoothstep(20, 58, dW)) * 0.75;
      if (z < -70) dens += 0.15;
      const dl = lakeD(x, z);
      const shore = dl > 0.92 && dl < 1.5 && h < 9;
      if (shore) dens += 0.25;
      const dm = meadowD(x, z);
      if (dm < 50) dens = dens * 0.4 + 0.06;
      if (dRift < 60) dens = 0.25;
      if (rnd() > dens) continue;
      if (this.excluded(x, z, 2)) continue;
      if (dRift < 60) { this.add('dead', x, z, 0.8 + rnd() * 0.5, { col: 0.35 }); continue; }
      const s = 0.8 + rnd() * 0.5;
      const tv = { vy: 1.18 }; // taller only (not wider): keeps the view open under the crown
      const r = rnd();
      if (h > 30 || z < -80) this.add(h > 38 ? 'pineSnow' : 'pine', x, z, s, { col: 0.4, ...tv });
      else if (dm < 50) this.add(r < 0.6 ? 'maple' : r < 0.85 ? 'oak' : 'poplar', x, z, s, { col: 0.45, ...tv });
      else if (shore) this.add(r < 0.4 ? 'willow' : r < 0.72 ? 'birch' : 'oak', x, z, s, { col: 0.45, ...tv });
      else if (dW < 62) this.add(r < 0.45 ? 'oak' : r < 0.78 ? 'birch' : r < 0.9 ? 'pine' : 'poplar', x, z, s, { col: 0.4, ...tv });
      else this.add(r < 0.62 ? 'oak' : r < 0.8 ? 'poplar' : r < 0.9 ? 'birch' : r < 0.95 ? 'maple' : 'pine', x, z, s, { col: 0.42, ...tv });
    }
    // bushes
    for (let i = 0; i < 3600 * q; i++) {
      const x = (rnd() - 0.5) * 460, z = (rnd() - 0.5) * 460;
      if (L.grassAt(x, z) < 0.6) continue;
      if (this.excluded(x, z, -1)) continue;
      const dens = smoothstep(-0.2, 0.5, fbm(nv, x * 0.012 + 50, z * 0.012, 2)) * 0.7 + 0.1;
      if (rnd() > dens) continue;
      this.add('bush', x, z, 0.7 + rnd() * 0.6);
    }
    // ferns, mushrooms, stumps and fallen logs under the canopy
    for (let i = 0; i < 6000 * q; i++) {
      const x = (rnd() - 0.5) * 460, z = (rnd() - 0.5) * 460;
      if (L.grassAt(x, z) < 0.45 || this.excluded(x, z, -1.5)) continue;
      const f = forestAt(x, z) + (1 - smoothstep(20, 60, woodsD(x, z))) * 0.8;
      if (rnd() > f * 0.8) continue;
      const k = rnd();
      if (k < 0.78) this.add('fern', x, z, 0.7 + rnd() * 0.6);
      else if (k < 0.93) this.add('mushroom', x, z, 0.8 + rnd() * 0.6);
      else if (k < 0.97) this.add('stump', x, z, 0.8 + rnd() * 0.4);
      else if (L.normal(x, z).y > 0.93) this.add('log', x, z, 0.85 + rnd() * 0.3, { dy: 0.1 });
    }
    // wildflower patches: clumped by noise, rich on the sunset meadow
    for (let i = 0; i < 9000 * q; i++) {
      const meadowBias = i % 3 === 0;
      const a = rnd() * TAU, rr = Math.sqrt(rnd()) * 55;
      const x = meadowBias ? POI.meadow.x + Math.cos(a) * rr : (rnd() - 0.5) * 460, z = meadowBias ? POI.meadow.z + Math.sin(a) * rr : (rnd() - 0.5) * 460;
      if (L.grassAt(x, z) < 0.55 || this.excluded(x, z, -9)) continue;
      const dm = meadowD(x, z);
      const patch = smoothstep(-0.15, 0.3, fbm(nv, x * 0.05 - 13, z * 0.05 + 7, 2));
      const p = patch * (0.35 + (1 - smoothstep(20, 55, dm)) * 0.9) * (1 - forestAt(x, z) * 0.6);
      if (rnd() > p) continue;
      const pal = Math.floor((fbm(nv, x * 0.02 + 90, z * 0.02, 1) * 0.5 + 0.5) * 6) % 6;
      this.add('flowers', x, z, 0.8 + rnd() * 0.5, { v: clamp(pal, 0, 5) });
    }
    // reeds along the lake shore and in the shallows
    for (let i = 0; i < 2400 * q; i++) {
      const a = rnd() * TAU, rr = POI.lake.r * (0.7 + rnd() * 0.55);
      const x = POI.lake.x + Math.cos(a) * rr, z = POI.lake.z + Math.sin(a) * rr;
      const h = L.height(x, z);
      if (h < -0.75 || h > 1.1) continue;
      if (T.pathInfo(x, z).d < 3) continue;
      if (fbm(nv, x * 0.08, z * 0.08, 2) < -0.15) continue;
      // Carry the old reed's water depth onto the new bank along the same bearing.
      // Preserve its exact spot when it already stands in the shallows.
      let radius = rr, y = T.height(x, z);
      if (y < -0.75 || y > 1.1) {
        const dir = y < h ? 1 : -1, dx = Math.cos(a), dz = Math.sin(a);
        for (let k = 0; k < 24; k++) {
          const next = T.height(POI.lake.x + (radius + dir) * dx, POI.lake.z + (radius + dir) * dz);
          if ((next - h) * dir >= 0) { radius += dir * (h - y) / (next - y); break; }
          radius += dir; y = next;
        }
      }
      this.add('reeds', POI.lake.x + Math.cos(a) * radius, POI.lake.z + Math.sin(a) * radius, 0.8 + rnd() * 0.5);
    }
    // shore stones where the water meets the sand
    for (let i = 0; i < 260 * q; i++) {
      const a = rnd() * TAU, rr = POI.lake.r * (0.95 + rnd() * 0.3);
      const x = POI.lake.x + Math.cos(a) * rr, z = POI.lake.z + Math.sin(a) * rr;
      const h = L.height(x, z);
      if (h < -0.6 || h > 1.6 || T.pathInfo(x, z).d < 3) continue;
      if (rnd() < 0.55) this.add('pebbles', x, z, 0.9 + rnd() * 0.6);
      else { const s = 0.35 + rnd() * 0.55; this.add('rock', x, z, s, { col: s > 0.7 ? 0.8 : 0, v: rnd() < 0.5 ? 3 : 0 }); }
    }
    // rocks + pebble scatter; big outcrops on steep ground and in the north
    for (let i = 0; i < 2800 * q; i++) {
      const x = (rnd() - 0.5) * 470, z = (rnd() - 0.5) * 470;
      const h = L.height(x, z);
      const n = L.normal(x, z);
      const steep = 1 - n.y;
      if (n.y < 0.66) continue;
      if (rnd() > 0.25 + steep * 3 + (h > 30 ? 0.3 : 0)) continue;
      if (this.excluded(x, z, -2) && rnd() < 0.9) continue;
      const snowy = h > 40 && z < -60;
      const big = rnd() < 0.09;
      const s = big ? 1.8 + rnd() * 2.2 : 0.4 + rnd() * 1.1;
      const type = snowy ? 'rockSnow' : big ? 'rockBig' : 'rock';
      this.add(type, x, z, s, { col: s > 0.8 ? 0.8 : 0 });
      if (rnd() < 0.45) this.add('pebbles', x + (rnd() - 0.5) * s * 3, z + (rnd() - 0.5) * s * 3, 0.8 + rnd() * 0.6);
    }
    for (let i = 0; i < 1600 * q; i++) {
      const x = (rnd() - 0.5) * 460, z = (rnd() - 0.5) * 460;
      const pf = L.pathAt(x, z);
      if (!(pf > 0.15 && pf < 0.7) && rnd() > 0.15) continue;
      if (L.height(x, z) < 0.3) continue;
      this.add('pebbles', x, z, 0.7 + rnd() * 0.6);
    }
  }

  buildMeshes() {
    for (const m of this.meshes) { this.scene.remove(m); m.dispose(); }
    this.meshes = [];
    this.batches = [];
    const ashC = new THREE.Color(0.62, 0.56, 0.7);
    for (const [name, t] of Object.entries(this.types)) {
      t.variants.forEach(([geoN, geoF], v) => {
        const items = t.items.filter((it) => it.v === v);
        if (!items.length) return;
        const n = items.length;
        const mats = new Float32Array(n * 16), cols = new Float32Array(n * 3), sphs = new Float32Array(n * 4);
        const b = t.bounds[v];
        items.forEach((it, i) => {
          tmpP.set(it.x, it.y, it.z);
          tmpQ.setFromAxisAngle(UP, it.r);
          tmpS.set(it.s, it.sy, it.s);
          tmpM.compose(tmpP, tmpQ, tmpS).toArray(mats, i * 16);
          tmpC.copy(it.tint);
          if (name.startsWith('rock') || name === 'pebbles') { if (Math.hypot(it.x - POI.rift.x, it.z - POI.rift.z) < 70) tmpC.multiply(ashC); }
          cols[i * 3] = tmpC.r; cols[i * 3 + 1] = tmpC.g; cols[i * 3 + 2] = tmpC.b;
          sphs[i * 4] = it.x; sphs[i * 4 + 1] = it.y + b.cy * it.sy; sphs[i * 4 + 2] = it.z; sphs[i * 4 + 3] = b.r * Math.max(it.s, it.sy) + 1;
        });
        // Shadows come from a proxy on SHADOW_LAYER (drawn only in the shadow pass, see
        // Renderer) using the cheap far model, so near detail isn't drawn twice.
        const mk = (geo, kind) => {
          // every props geometry carries the fade attribute (zeros where it never fades), so the
          // shader never reads an unbound attribute slot
          if (!geo.attributes.aFade || geo.attributes.aFade.count < n) geo.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
          const im = new THREE.InstancedMesh(geo, t.mat, n);
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          if (kind !== 'shadow') { im.setColorAt(0, tmpC); im.instanceColor.setUsage(THREE.DynamicDrawUsage); }
          im.count = 0;
          // The source transforms and colours never change after placement.
          // Remember which source already occupies each GPU instance slot.
          im.userData.sourceIds = new Uint32Array(n);
          im.matrixAutoUpdate = false;
          im.frustumCulled = false;
          im.castShadow = t.shadow && (kind === 'shadow' || (kind === 'near' && !geoF));
          if (im.castShadow) useCasterDepth(im);
          im.receiveShadow = kind !== 'shadow';
          if (kind === 'shadow') im.layers.set(SHADOW_LAYER);
          im.name = name + (kind === 'near' ? '' : ':' + kind);
          im.userData.noBake = true;
          this.scene.add(im);
          this.meshes.push(im);
          return im;
        };
        this.batches.push({ t, name, mats, cols, sphs, n, near: mk(geoN, 'near'), far: geoF ? mk(geoF, 'far') : null, shadow: geoF && t.shadow ? mk(geoF, 'shadow') : null });
      });
    }
    this.dirty = false;
  }

  // Re-sort instances into near/far meshes for the current camera. mirror: a second frustum
  // (the water's reflected view) whose contents are kept as well.
  update(camera, mirror = null) {
    if (this.dirty) this.buildMeshes();
    const L = this.last;
    camera.getWorldDirection(V);
    const moved = camera.position.distanceToSquared(L.p) > 1.2 * 1.2 || V.dot(L.d) < 0.9975;
    L.t++;
    if (!moved && L.t < 30) return;
    L.p.copy(camera.position); L.d.copy(V); L.t = 0;
    projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projM);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    // shadow proxies: everything the sun's cascades can reach (casters behind the camera included)
    const shR = tier().shadowDist * 1.1 + 12, sh2 = shR * shR;
    for (const b of this.batches) {
      const { t, mats, cols, sphs, n } = b;
      const nA = b.near.instanceMatrix.array, nC = b.near.instanceColor.array;
      const fA = b.far ? b.far.instanceMatrix.array : null, fC = b.far ? b.far.instanceColor.array : null;
      const sA = b.shadow ? b.shadow.instanceMatrix.array : null;
      const nFd = b.near.geometry.attributes.aFade.array, fFd = b.far ? b.far.geometry.attributes.aFade.array : null;
      const max2 = t.max * t.max, keep2 = t.keep * t.keep;
      // LOD band: inside it an item is in both meshes, dithered from near to far
      const b0 = fA ? t.near - FADE : 1e9, b1 = t.near + FADE, b02 = b0 * b0, b12 = b1 * b1;
      let nn = 0, nf = 0, ns = 0;
      let nearEnd = 0, farEnd = 0, shadowEnd = 0, nearFadeEnd = 0, farFadeEnd = 0;
      const ni = b.near.userData.sourceIds, fi = b.far?.userData.sourceIds, si = b.shadow?.userData.sourceIds;
      for (let i = 0; i < n; i++) {
        const dx = sphs[i * 4] - cx, dy = sphs[i * 4 + 1] - cy, dz = sphs[i * 4 + 2] - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > max2) continue;
        if (sA && d2 < sh2) {
          if (si[ns] !== i + 1) {
            si[ns] = i + 1;
            for (let k = 0; k < 16; k++) sA[ns * 16 + k] = mats[i * 16 + k];
            shadowEnd = ns + 1;
          }
          ns++;
        }
        if (d2 > keep2) {
          sph.center.set(sphs[i * 4], sphs[i * 4 + 1], sphs[i * 4 + 2]); sph.radius = sphs[i * 4 + 3];
          if (!frustum.intersectsSphere(sph) && !(mirror && mirror.intersectsSphere(sph))) continue;
        }
        const fade = d2 <= b02 ? 0 : d2 >= b12 ? 1 : (Math.sqrt(d2) - b0) / (b1 - b0);
        if (fade < 1) {
          if (ni[nn] !== i + 1) {
            ni[nn] = i + 1;
            for (let k = 0; k < 16; k++) nA[nn * 16 + k] = mats[i * 16 + k];
            nC[nn * 3] = cols[i * 3]; nC[nn * 3 + 1] = cols[i * 3 + 1]; nC[nn * 3 + 2] = cols[i * 3 + 2];
            nearEnd = nn + 1;
          }
          if (nFd[nn] !== Math.fround(fade)) { nFd[nn] = fade; nearFadeEnd = nn + 1; }
          nn++;
        }
        if (fade > 0) {
          if (fi[nf] !== i + 1) {
            fi[nf] = i + 1;
            for (let k = 0; k < 16; k++) fA[nf * 16 + k] = mats[i * 16 + k];
            fC[nf * 3] = cols[i * 3]; fC[nf * 3 + 1] = cols[i * 3 + 1]; fC[nf * 3 + 2] = cols[i * 3 + 2];
            farEnd = nf + 1;
          }
          if (fFd[nf] !== Math.fround(-fade)) { fFd[nf] = -fade; farFadeEnd = nf + 1; }
          nf++;
        }
      }
      finishInstances(b.near, nn, nearEnd, nearFadeEnd);
      if (b.far) finishInstances(b.far, nf, farEnd, farFadeEnd);
      if (b.shadow) finishInstances(b.shadow, ns, shadowEnd, 0);
    }
  }
}

function finishInstances(mesh, count, changedEnd, fadeEnd) {
  mesh.count = count;
  mesh.visible = count > 0;
  if (changedEnd) {
    uploadPrefix(mesh.instanceMatrix, changedEnd * 16);
    if (mesh.instanceColor) uploadPrefix(mesh.instanceColor, changedEnd * 3);
  }
  if (fadeEnd) uploadPrefix(mesh.geometry.attributes.aFade, fadeEnd);
}

function uploadPrefix(attribute, count) {
  // A hidden shadow batch may still have an upload pending from a prior sort.
  const pending = attribute.updateRanges[0];
  if (pending) pending.count = Math.max(pending.count, count);
  else attribute.addUpdateRange(0, count);
  attribute.needsUpdate = true;
}

// Geometry of one tree. kind: oak | maple | blossom | willow | birch | poplar | pine | dead; far: the far model
function treeGeometry(kind, seed, far = false, opts = {}) {
  if (kind === 'pine') return conifer(seed, far, opts);
  if (kind === 'dead') return deadTree(seed, far);
  if (kind === 'willow') return willow(seed, far, opts);
  if (kind === 'birch') return birch(seed, far);
  if (kind === 'poplar') return poplar(seed, far);
  return broadleaf(seed, far, opts);
}
// Single unique tree (landmarks): same generators, near model only. Its shadow comes from the
// far model on SHADOW_LAYER, like the scattered trees' (the near model's foliage is all cards,
// which cast nothing).
export function makeTree(kind = 'oak', seed = 1, opts = {}) {
  const mat = toon(0xffffff, { vertexColors: true, sway: opts.sway ?? 0.036, swayBase: opts.swayBase ?? 0.18, rim: 0.35, tex: 'bark', leafy: true, cards: true });
  const m = new THREE.Mesh(treeGeometry(kind, seed, false, opts), mat);
  m.receiveShadow = true;
  const sh = new THREE.Mesh(treeGeometry(kind, seed, true, opts), mat);
  sh.castShadow = true; sh.layers.set(SHADOW_LAYER);
  m.add(sh);
  return m;
}
export { rockShape as rockGeometry, bush as bushGeometry, broadleaf as broadleafGeometry };
