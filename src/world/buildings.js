// Procedural architecture & set dressing.
//
// Everything is built from a small kit (chamfered boxes, tubes, lathes,
// slab roofs) with world-space surface detail from the toon materials.
// Static meshes are merged per material by World.bakeStatics, so detail here
// costs triangles, not draw calls; small multi-coloured pieces (flowers,
// produce, cloth trims, painted wood) use the vertex-colour `paint` materials
// so they all bake into one draw per cell.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, fresnelMat, glowMat, U } from '../render/materials.js';
import { mulberry32 } from '../core/util.js';
import { crystalMaterial, crystalGeometry, crystalGlowSprite } from '../render/crystal.js';

export const MAT = {
  stone: toon(0xb8ad9a, { flat: true, rim: 0.2, tex: 'stone' }),
  stoneDark: toon(0x8b8377, { flat: true, rim: 0.2, tex: 'stone' }),
  stoneBlue: toon(0x9aa3ad, { flat: true, rim: 0.25, tex: 'stone' }),
  plaster: toon(0xf2e4c6, { rim: 0.2, tex: 'plaster' }),
  plasterWarm: toon(0xecd3a6, { rim: 0.2, tex: 'plaster' }),
  plasterRose: toon(0xeccfc0, { rim: 0.2, tex: 'plaster' }),
  plasterSage: toon(0xdde0c4, { rim: 0.2, tex: 'plaster' }),
  timber: toon(0x6a4a34, { rim: 0.15, tex: 'wood' }),
  wood: toon(0x9c7250, { rim: 0.2, tex: 'planks' }),
  woodLight: toon(0xc49a6c, { rim: 0.2, tex: 'planks' }),
  roofRed: toon(0xb85a3e, { flat: true, rim: 0.25, side: THREE.DoubleSide, tex: 'roof' }),
  roofTeal: toon(0x3f8088, { flat: true, rim: 0.25, side: THREE.DoubleSide, tex: 'roof' }),
  roofBlue: toon(0x4f68a8, { flat: true, rim: 0.25, side: THREE.DoubleSide, tex: 'roof' }),
  roofPlum: toon(0x7d5690, { flat: true, rim: 0.25, side: THREE.DoubleSide, tex: 'roof' }),
  roofMora: toon(0x3a3f86, { flat: true, rim: 0.45, side: THREE.DoubleSide, tex: 'roof' }),
  bronze: toon(0xc79a4c, { rim: 0.9, emissive: 0x2a1a04 }),
  gold: toon(0xf0c860, { rim: 1, emissive: 0x5a3a08 }),
  cloth: toon(0xd8c8a8, { side: THREE.DoubleSide }),
  clothRed: toon(0xc0473a, { side: THREE.DoubleSide }),
  clothBlue: toon(0x4a6fb0, { side: THREE.DoubleSide }),
  straw: toon(0xd9b86a, { rim: 0.2 }),
  dark: toon(0x2a2420),
  iron: toon(0x4a4a50, { rim: 0.5 }),
  ruin: toon(0xa8a092, { flat: true, rim: 0.2, tex: 'stone' }),
  ruinMoss: toon(0x7f9a6a, { flat: true, rim: 0.2, tex: 'stone' }),
  hushRock: toon(0x3a3444, { flat: true, rim: 0.6, tex: 'rock', noMoss: true }),
  door: toon(0x6e4a30, { rim: 0.15, tex: 'planks' }),
  shutter: toon(0x3f8088, { rim: 0.2, tex: 'planks' }),
  thatch: toon(0xc4a060, { rim: 0.25, tex: 'bark' }),
  thatchDark: toon(0x9c7c44, { rim: 0.2, tex: 'bark' }),
  // vertex-coloured kits (one draw per baked cell for any number of colours)
  paint: toon(0xffffff, { vertexColors: true, rim: 0.2 }),
  paintDS: toon(0xffffff, { vertexColors: true, rim: 0.15, side: THREE.DoubleSide }),
  paintWood: toon(0xffffff, { vertexColors: true, rim: 0.2, tex: 'planks' }),
  paintStone: toon(0xffffff, { vertexColors: true, flat: true, rim: 0.2, tex: 'stone' }),
  // untextured variants for moving parts (world-space detail would swim)
  timberMoving: toon(0x6a4a34, { rim: 0.15 }),
  clothMoving: toon(0xd8c8a8, { side: THREE.DoubleSide, noAO: true }),
};
export const windowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.1, 0.5) });
windowMat.userData.bake = true; // shared & opaque: World.bakeStatics may merge it
export const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

const TAU = Math.PI * 2;
const hc = (h) => new THREE.Color(h);

function mesh(geo, mat, x = 0, y = 0, z = 0, parent, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (o.rx) m.rotation.x = o.rx; if (o.ry) m.rotation.y = o.ry; if (o.rz) m.rotation.z = o.rz;
  if (o.order) m.rotation.order = o.order;
  m.castShadow = o.cast ?? true; m.receiveShadow = o.recv ?? true;
  if (parent) parent.add(m);
  return m;
}

// Chamfered box: bevelled edges catch the rim/key light so blocks stop
// reading as raw primitives. Flat normals, cached per size.
const chamferCache = new Map();
export function chamferBox(w, h, d, bevel) {
  const b = bevel ?? Math.min(0.06, Math.min(w, h, d) * 0.18);
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${b.toFixed(3)}`;
  let g = chamferCache.get(key);
  if (g) return g;
  const x = w / 2, y = h / 2, z = d / 2;
  const pos = [];
  // corner vertex on the face perpendicular to axis ax, inset by b along the other two axes
  const V = (sx, sy, sz, ax) => [sx * (x - (ax === 0 ? 0 : b)), sy * (y - (ax === 1 ? 0 : b)), sz * (z - (ax === 2 ? 0 : b))];
  const tri = (a, c, e) => { pos.push(...a, ...c, ...e); };
  const quad = (a, c, e, f) => { tri(a, c, e); tri(a, e, f); };
  const S = [-1, 1];
  for (const s of S) {
    quad(V(s, -1, -1, 0), V(s, 1, -1, 0), V(s, 1, 1, 0), V(s, -1, 1, 0));
    quad(V(-1, s, -1, 1), V(-1, s, 1, 1), V(1, s, 1, 1), V(1, s, -1, 1));
    quad(V(-1, -1, s, 2), V(1, -1, s, 2), V(1, 1, s, 2), V(-1, 1, s, 2));
  }
  for (const sy of S) for (const sz of S) quad(V(-1, sy, sz, 1), V(1, sy, sz, 1), V(1, sy, sz, 2), V(-1, sy, sz, 2));
  for (const sx of S) for (const sz of S) quad(V(sx, -1, sz, 0), V(sx, 1, sz, 0), V(sx, 1, sz, 2), V(sx, -1, sz, 2));
  for (const sx of S) for (const sy of S) quad(V(sx, sy, -1, 0), V(sx, sy, 1, 0), V(sx, sy, 1, 1), V(sx, sy, -1, 1));
  for (const sx of S) for (const sy of S) for (const sz of S) tri(V(sx, sy, sz, 0), V(sx, sy, sz, 1), V(sx, sy, sz, 2));
  // orient every triangle outward (the solid is convex and centred)
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const e1 = [pos[i + 3] - ax, pos[i + 4] - ay, pos[i + 5] - az], e2 = [pos[i + 6] - ax, pos[i + 7] - ay, pos[i + 8] - az];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const cx = (ax + pos[i + 3] + pos[i + 6]) / 3, cy = (ay + pos[i + 4] + pos[i + 7]) / 3, cz = (az + pos[i + 5] + pos[i + 8]) / 3;
    if (n[0] * cx + n[1] * cy + n[2] * cz < 0) {
      for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
    }
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  chamferCache.set(key, g);
  return g;
}
export const box = (w, h, d, mat, x, y, z, p, o) => mesh(chamferBox(w, h, d), mat, x, y, z, p, o);
const cylCache = new Map();
function cylGeo(rt, rb, h, seg, open = false) {
  const k = `${rt}|${rb}|${h}|${seg}|${open}`;
  let g = cylCache.get(k);
  if (!g) cylCache.set(k, (g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)));
  return g;
}
export const cyl = (rt, rb, h, seg, mat, x, y, z, p, o) => mesh(cylGeo(rt, rb, h, seg), mat, x, y, z, p, o);

// Vertex-coloured copy of a geometry (for the paint materials). a = foliage mask.
function tinted(geo, color, a = 0, jitter = 0, rnd = Math.random) {
  const g = (geo.index ? geo.toNonIndexed() : geo.clone());
  const n = g.attributes.position.count, c = hc(color), col = new Float32Array(n * 4);
  const tone = 1 - jitter / 2 + rnd() * jitter;
  for (let i = 0; i < n; i++) { col[i * 4] = c.r * tone; col[i * 4 + 1] = c.g * tone; col[i * 4 + 2] = c.b * tone; col[i * 4 + 3] = a; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return g;
}
const pbox = (w, h, d, color, x, y, z, p, o = {}) => mesh(tinted(chamferBox(w, h, d), color), o.mat ?? MAT.paint, x, y, z, p, o);
const pcyl = (rt, rb, h, seg, color, x, y, z, p, o = {}) => mesh(tinted(cylGeo(rt, rb, h, seg, o.open), color), o.mat ?? MAT.paint, x, y, z, p, o);
const icoCache = [0, 1].map((d) => new THREE.IcosahedronGeometry(1, d));
function pball(r, color, x, y, z, p, o = {}) {
  const m = mesh(tinted(icoCache[o.detail ?? 0], color, o.a ?? 0), o.mat ?? MAT.paint, x, y, z, p, o);
  m.scale.set(r * (o.sx ?? 1), r * (o.sy ?? 1), r * (o.sz ?? 1));
  return m;
}
// Merge a group's static meshes per material (for objects World.bakeStatics
// leaves alone, e.g. interactive targets). `keep` subtrees stay untouched.
export function consolidate(g, keep = []) {
  g.updateMatrixWorld(true);
  const skip = new Set();
  for (const k of keep) if (k) k.traverse((c) => skip.add(c));
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const buckets = new Map();
  g.traverse((m) => {
    if (!m.isMesh || skip.has(m) || m.children.length || !m.material || m.material.transparent) return;
    const k = m.material.uuid + (m.castShadow ? 'c' : '');
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(m);
  });
  const M = new THREE.Matrix4();
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const mat = list[0].material;
    const geos = list.map((m) => {
      const gg = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const a of Object.keys(gg.attributes)) if (a !== 'position' && a !== 'normal' && !(a === 'color' && mat.vertexColors)) gg.deleteAttribute(a);
      if (!gg.attributes.normal) gg.computeVertexNormals();
      gg.applyMatrix4(M.multiplyMatrices(inv, m.matrixWorld));
      return gg;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mm = new THREE.Mesh(merged, mat);
    mm.castShadow = list[0].castShadow; mm.receiveShadow = true;
    g.add(mm);
    for (const m of list) m.parent.remove(m);
  }
  return g;
}

// Paving stone (vertex-coloured, stone surface), rotated about y
export function pstone(p, w, h, d, color, x, y, z, ry = 0) { return pbox(w, h, d, color, x, y, z, p, { mat: MAT.paintStone, ry, cast: false }); }
function lathe(profile, seg, mat, x, y, z, p, o) { return mesh(new THREE.LatheGeometry(profile.map(([a, b]) => new THREE.Vector2(a, b)), seg), mat, x, y, z, p, o); }

// Beam between two points on a wall. axis 'z': wall facing ±z (beam in XY at z=off); 'x': wall facing ±x (beam in ZY at x=off)
function beam(a0, y0, a1, y1, t, depth, mat, off, axis, parent) {
  const da = a1 - a0, dy = y1 - y0, L = Math.hypot(da, dy);
  if (axis === 'z') return box(L, t, depth, mat, (a0 + a1) / 2, (y0 + y1) / 2, off, parent, { rz: Math.atan2(dy, da) });
  return box(depth, t, L, mat, off, (y0 + y1) / 2, (a0 + a1) / 2, parent, { rx: Math.atan2(-dy, da) });
}
// Stick between two 3D points (rounded timber / iron rod)
function stick(a, b, r, mat, parent, seg = 6, color) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const geo = color != null ? tinted(cylGeo(r, r, L, seg), color) : cylGeo(r, r, L, seg);
  const m = new THREE.Mesh(geo, color != null ? MAT.paint : mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
// Flat triangle (both sides) in a plane, for gable infills and pennants
function triGeo(a, b, c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------
// Gable roof over a w×d footprint (ridge along z) resting on the wall top.
// Slab upper surface: y = eave + rh * (1 - |x| / (w/2)), continuing past the
// walls as an overhang. Returns { eave, a, t }.
function gableRoof(g, w, d, rh, yTop, mat, o = {}) {
  const t = o.t ?? 0.22, overX = o.overX ?? 0.6, overZ = o.overZ ?? 0.45;
  const half = w / 2, a = Math.atan2(rh, half);
  const run = half + overX, L = run / Math.cos(a), D = d + overZ * 2;
  const trim = o.trim ?? MAT.timber;
  if (o.thatch) {
    // thick, soft-edged straw roof: rounded slabs, a rolled eave and a fat ridge
    for (const sx of [-1, 1]) {
      const cxm = sx * run / 2, cym = yTop + rh - (run / 2) * Math.tan(a);
      const nx = sx * Math.sin(a), ny = Math.cos(a);
      mesh(chamferBox(L + 0.2, t, D + 0.2, Math.min(0.2, t * 0.4)), mat, cxm + nx * t / 2, cym + ny * t / 2, 0, g, { rz: -sx * a });
      const ex = sx * run, ey = yTop + rh - run * Math.tan(a);
      const lip = mesh(cylGeo(t * 0.6, t * 0.6, D + 0.24, 10), mat, ex + nx * t * 0.3, ey + ny * t * 0.3, 0, g, { rx: Math.PI / 2 });
      lip.rotation.set(Math.PI / 2, 0, 0); lip.scale.set(1, 1, 0.7);
    }
    const ry = yTop + rh + t / Math.cos(a);
    mesh(cylGeo(0.3, 0.3, D + 0.3, 10), o.cap ?? mat, 0, ry - 0.14, 0, g, { rx: Math.PI / 2 }).scale.set(1, 1, 0.8);
    for (const sz of [-1, 1]) {
      const z = sz * (d / 2 + 0.005);
      const tri = sz > 0 ? triGeo([-half, 0, 0], [half, 0, 0], [0, rh, 0]) : triGeo([half, 0, 0], [-half, 0, 0], [0, rh, 0]);
      mesh(tri, o.wall ?? MAT.plaster, 0, yTop, z, g);
    }
    return { eave: yTop + t / Math.cos(a), a, t, run, D, ridgeY: ry + 0.24 };
  }
  for (const sx of [-1, 1]) {
    const cxm = sx * run / 2, cym = yTop + rh - (run / 2) * Math.tan(a);
    const nx = sx * Math.sin(a), ny = Math.cos(a);
    box(L + 0.06, t, D, mat, cxm + nx * t / 2, cym + ny * t / 2, 0, g, { rz: -sx * a });
    // barge boards on the gable ends
    for (const sz of [-1, 1]) box(L + 0.1, 0.24, 0.1, trim, cxm + nx * 0.02, cym + ny * 0.02, sz * (D / 2 + 0.03), g, { rz: -sx * a });
    // fascia along the eave
    const ex = sx * run, ey = yTop + rh - run * Math.tan(a);
    box(0.1, 0.26, D + 0.06, trim, ex + sx * 0.02, ey + 0.05, 0, g);
  }
  // ridge cap
  const ry = yTop + rh + t / Math.cos(a);
  box(0.32, 0.32, D + 0.12, o.cap ?? trim, 0, ry - 0.06, 0, g, { rz: Math.PI / 4 });
  // gable infill triangles
  for (const sz of [-1, 1]) {
    const z = sz * (d / 2 + 0.005);
    const tri = sz > 0 ? triGeo([-half, 0, 0], [half, 0, 0], [0, rh, 0]) : triGeo([half, 0, 0], [-half, 0, 0], [0, rh, 0]);
    mesh(tri, o.wall ?? MAT.plaster, 0, yTop, z, g);
  }
  return { eave: yTop + t / Math.cos(a), a, t, run, D, ridgeY: ry };
}

// Window unit facing local +z: glass, frame, cross mullions, lintel, sill,
// shutters, optional flower box. Built into group `wg`.
const FLOWER_COLS = [0xf07a96, 0xf6d05a, 0xf4f0e8, 0xb48cf0, 0xf08a4a];
function windowUnit(wg, rnd, o = {}) {
  const W = o.w ?? 0.9, H = o.h ?? 1.0;
  box(W, H, 0.06, windowMat, 0, 0, -0.02, wg, { cast: false });
  box(W + 0.18, 0.1, 0.14, MAT.timber, 0, H / 2 + 0.05, 0.04, wg);
  box(W + 0.18, 0.1, 0.14, MAT.timber, 0, -H / 2 - 0.05, 0.04, wg);
  for (const sx of [-1, 1]) box(0.1, H + 0.1, 0.14, MAT.timber, sx * (W / 2 + 0.04), 0, 0.04, wg);
  box(0.06, H, 0.08, MAT.timber, 0, 0, 0.03, wg);
  box(W, 0.06, 0.08, MAT.timber, 0, H * 0.08, 0.03, wg);
  // arched or straight lintel
  if (o.arch) {
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.12 + i * 0.19);
      box(0.28, 0.22, 0.16, MAT.stoneDark, Math.cos(a) * (W * 0.62), H / 2 + 0.06 + Math.sin(a) * 0.22, 0.06, wg, { rz: a - Math.PI / 2 });
    }
  } else box(W + 0.4, 0.16, 0.2, MAT.timber, 0, H / 2 + 0.14, 0.08, wg);
  box(W + 0.3, 0.1, 0.26, MAT.stoneDark, 0, -H / 2 - 0.12, 0.1, wg);
  if (o.shutters !== false) {
    const sc = o.shutterCol ?? 0x3f8088;
    const sw = W * 0.42, sxo = W / 2 + 0.07 + sw / 2;
    for (const sx of [-1, 1]) {
      pbox(sw, H + 0.04, 0.05, sc, sx * sxo, 0, 0.14, wg, { mat: MAT.paintWood, ry: -sx * 0.35 });
      // cut-out slot and a cross batten
      pbox(0.07, 0.13, 0.02, 0x2a2018, sx * sxo, H * 0.25, 0.175, wg, { ry: -sx * 0.35, cast: false });
      pbox(sw * 0.9, 0.06, 0.03, 0x2a2018, sx * sxo, -H * 0.25, 0.17, wg, { ry: -sx * 0.35, cast: false });
    }
  }
  if (o.box ?? rnd() < 0.65) {
    pbox(W + 0.1, 0.24, 0.3, o.boxCol ?? 0x8a5a38, 0, -H / 2 - 0.3, 0.24, wg, { mat: MAT.paintWood });
    const fc = FLOWER_COLS[Math.floor(rnd() * FLOWER_COLS.length)], fc2 = FLOWER_COLS[Math.floor(rnd() * FLOWER_COLS.length)];
    for (let i = 0; i < 7; i++) {
      const x = -W / 2 + 0.08 + i * (W - 0.16) / 6;
      pball(0.13, i % 2 ? 0x4f8a3a : 0x5c9a42, x, -H / 2 - 0.12, 0.24 + (i % 2) * 0.05, wg, { sy: 0.8 });
      if (i % 2 === 0 || rnd() < 0.5) pball(0.075, rnd() < 0.5 ? fc : fc2, x + (rnd() - 0.5) * 0.05, -H / 2 - 0.02 + rnd() * 0.05, 0.3 + rnd() * 0.06, wg);
    }
    // trailing ivy
    for (let i = 0; i < 3; i++) pball(0.08, 0x4a8036, -W / 2 + 0.15 + rnd() * (W - 0.3), -H / 2 - 0.5 - rnd() * 0.15, 0.37, wg, { sy: 1.6 });
  }
}

// Small wall lantern with a lit glass box (brightens at night with windowMat)
function wallLantern(p, x, y, z, ry = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; p.add(g);
  box(0.06, 0.06, 0.4, MAT.iron, 0, 0.3, 0.2, g);
  box(0.24, 0.3, 0.24, windowMat, 0, 0, 0.36, g, { cast: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.035, 0.34, 0.035, MAT.iron, sx * 0.12, 0, 0.36 + sz * 0.12, g);
  mesh(new THREE.ConeGeometry(0.22, 0.18, 4), MAT.iron, 0, 0.24, 0.36, g, { ry: Math.PI / 4 });
  box(0.3, 0.04, 0.3, MAT.iron, 0, -0.16, 0.36, g);
  return g;
}

// One wall face (timber-framed plaster or stone) built in its own group:
// local x along the wall, y up from the floor line, +z outward.
function wallFace(fg, L, h, rnd, spec) {
  const nb = Math.max(2, Math.round(L / 1.55));
  const bw = L / nb;
  const bays = new Array(nb).fill('brace');
  if (spec.door != null) bays[spec.door] = 'door';
  const want = spec.windows ?? Math.max(1, Math.floor(nb / 2));
  const free = bays.map((b, i) => i).filter((i) => bays[i] === 'brace' && !(spec.door != null && Math.abs(i - spec.door) === 0));
  // prefer bays away from the ends for windows
  free.sort((a, b) => Math.abs(a - (nb - 1) / 2) - Math.abs(b - (nb - 1) / 2) + (rnd() - 0.5) * 0.8);
  for (let i = 0; i < Math.min(want, free.length); i++) bays[free[i]] = 'win';
  const stone = spec.stone;
  const winY = h * (spec.winY ?? 0.58);
  if (!stone) {
    box(L + 0.16, 0.2, 0.14, MAT.timber, 0, 0.1, 0.03, fg);
    box(L + 0.16, 0.2, 0.14, MAT.timber, 0, h - 0.1, 0.03, fg);
    for (let i = 0; i <= nb; i++) {
      const x = -L / 2 + i * bw, corner = i === 0 || i === nb;
      box(corner ? 0.22 : 0.16, h, corner ? 0.18 : 0.13, MAT.timber, x, h / 2, 0.03, fg);
    }
  }
  const railY = h * 0.3;
  bays.forEach((b, i) => {
    const cx = -L / 2 + (i + 0.5) * bw;
    const x0 = cx - bw / 2 + 0.08, x1 = cx + bw / 2 - 0.08;
    if (b !== 'door' && !stone) box(bw - 0.1, 0.14, 0.11, MAT.timber, cx, railY, 0.03, fg);
    if (b === 'win') {
      const wg = new THREE.Group(); wg.position.set(cx, winY, 0.02); fg.add(wg);
      windowUnit(wg, rnd, { w: Math.min(0.85, bw - 0.72), h: Math.min(1.0, h * 0.36), shutterCol: spec.shutterCol, arch: stone, box: spec.boxes });
      if (!stone) { beam(x0, 0.2, cx, railY - 0.06, 0.11, 0.09, MAT.timber, 0.035, 'z', fg); beam(x1, 0.2, cx, railY - 0.06, 0.11, 0.09, MAT.timber, 0.035, 'z', fg); }
    } else if (b === 'brace' && !stone) {
      // lower chevron + upper diagonal leaning toward the wall centre
      beam(x0, 0.2, cx, railY - 0.06, 0.11, 0.09, MAT.timber, 0.035, 'z', fg);
      beam(x1, 0.2, cx, railY - 0.06, 0.11, 0.09, MAT.timber, 0.035, 'z', fg);
      const lean = cx < 0 ? 1 : -1;
      beam(lean > 0 ? x0 : x1, railY + 0.08, lean > 0 ? x1 : x0, h - 0.22, 0.12, 0.09, MAT.timber, 0.035, 'z', fg);
      if (bw > 1.3 && rnd() < 0.5) box(0.11, h - railY - 0.3, 0.09, MAT.timber, cx, (railY + h - 0.2) / 2, 0.035, fg);
    }
  });
  if (stone) {
    // corner quoins
    for (const sx of [-1, 1]) for (let k = 0; k < Math.floor(h / 0.42); k++) {
      const long = k % 2 === 0;
      box(long ? 0.62 : 0.4, 0.36, 0.14, MAT.stoneDark, sx * (L / 2 - (long ? 0.25 : 0.14)), 0.2 + k * 0.42, 0.05, fg);
    }
    box(L + 0.2, 0.2, 0.22, MAT.stoneDark, 0, h - 0.08, 0.06, fg);
  }
  return { bays, bw };
}

// ------------------------------------------------------------------
// House: stone plinth, one or two floors (the upper one jettied, timber
// framed), slab gable roof with barge boards and ridge cap, optional dormers,
// porch, side lean-to and trade sign. Door on the +z gable end.
// userData: w, d (outer footprint incl. margin), height, chimney (local),
// eave/roofH/roofHW (roof top = eave + roofH * max(0, 1 - |lx| / roofHW)),
// roofTop(lx, lz) (same, as a function; local height above the origin).
const WALLS = () => [MAT.plaster, MAT.plasterWarm, MAT.plasterRose, MAT.plasterSage];
const SHUTTERS = [0x3f8088, 0x4f68a8, 0x8a4a3a, 0x5a7a3a, 0x7a5a8a];
export function house(opts = {}) {
  const rnd = mulberry32(opts.seed ?? 1);
  const g = new THREE.Group();
  const w = opts.w ?? 6, d = opts.d ?? 5, wallH = opts.h ?? 3.2;
  const floors = opts.floors ?? 1;
  const roofMat = opts.roof ?? [MAT.roofRed, MAT.roofTeal, MAT.roofBlue, MAT.roofPlum][Math.floor(rnd() * 4)];
  const wallMat = opts.wall ?? WALLS()[Math.floor(rnd() * 4)];
  const shutterCol = opts.shutterCol ?? SHUTTERS[Math.floor(rnd() * SHUTTERS.length)];
  const thatch = !!opts.thatch;
  const hoodMat = thatch ? MAT.thatch : roofMat;
  const B0 = 0.6;
  // stone plinth with irregular corner quoins and a darker base course
  box(w + 0.34, 0.85, d + 0.34, MAT.stone, 0, 0.2, 0, g);
  box(w + 0.5, 0.3, d + 0.5, MAT.stoneDark, 0, -0.05, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const qw = 0.5 + rnd() * 0.2, qd = 0.45 + rnd() * 0.2;
      box(k ? qd : qw, 0.34 + rnd() * 0.06, k ? qw : qd, MAT.stoneDark, sx * (w / 2 + 0.12) - sx * (k ? 0.05 : 0.1), 0.05 + k * 0.36, sz * (d / 2 + 0.12) - sz * (k ? 0.1 : 0.05), g, { ry: (rnd() - 0.5) * 0.12 });
    }
  }
  // floors
  const doorBayFront = (nb) => Math.max(0, Math.min(nb - 1, Math.floor(nb / 2) + (rnd() < 0.5 ? 0 : (rnd() < 0.5 ? -1 : 1)) * (nb > 2 ? 1 : 0)));
  const jet = floors > 1 ? 0.28 : 0;
  let y = B0, W = w, D = d, doorX = 0;
  for (let f = 0; f < floors; f++) {
    const stone = floors > 1 && f === 0 && opts.stoneBase !== false;
    if (f > 0) {
      W = w + jet * 2; D = d + jet * 2;
      // jetty joist ends under the overhang
      for (const sz of [-1, 1]) for (let i = 0; i < Math.round(w / 0.55); i++) box(0.14, 0.16, jet + 0.12, MAT.timber, -w / 2 + 0.25 + i * 0.55, y - 0.12, sz * (d / 2 + jet / 2), g);
      box(W, 0.22, D, MAT.timber, 0, y + 0.02, 0, g);
      y += 0.1;
    }
    const h = wallH * (f === 0 && floors > 1 ? 0.95 : 1);
    box(W, h, D, stone ? MAT.stone : wallMat, 0, y + h / 2, 0, g);
    const faces = [
      { L: W, x: 0, z: D / 2, ry: 0, front: true },
      { L: W, x: 0, z: -D / 2, ry: Math.PI },
      { L: D, x: W / 2, z: 0, ry: Math.PI / 2 },
      { L: D, x: -W / 2, z: 0, ry: -Math.PI / 2 },
    ];
    for (const fc of faces) {
      const fg = new THREE.Group(); fg.position.set(fc.x, y, fc.z); fg.rotation.y = fc.ry; g.add(fg);
      const nb = Math.max(2, Math.round(fc.L / 1.55));
      const spec = { stone, shutterCol, windows: fc.front ? (f === 0 ? Math.max(1, Math.floor((nb - 1) / 2)) : Math.ceil(nb / 2)) : fc.L > 5.5 ? 2 : 1, boxes: f === 0 ? undefined : rnd() < 0.75 };
      if (fc.front && f === 0) spec.door = doorBayFront(nb);
      const res = wallFace(fg, fc.L, h, rnd, spec);
      if (fc.front && f === 0) doorX = -fc.L / 2 + (spec.door + 0.5) * res.bw;
    }
    y += h;
  }
  const yTop = y;
  // door with plank leaf, frame, iron straps, arched head, step and lantern
  const dz = d / 2 + 0.05;
  box(1.08, 2.0, 0.1, MAT.door, doorX, B0 + 1.0, dz, g);
  for (const k of [0.45, 1.55]) box(1.0, 0.07, 0.04, MAT.iron, doorX, B0 + k, dz + 0.07, g);
  for (const sx of [-1, 1]) box(0.16, 2.2, 0.18, MAT.timber, doorX + sx * 0.62, B0 + 1.08, dz + 0.02, g);
  box(1.5, 0.22, 0.22, MAT.timber, doorX, B0 + 2.2, dz + 0.04, g);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), MAT.bronze); knob.position.set(doorX + 0.36, B0 + 1.0, dz + 0.1); g.add(knob);
  box(1.7, 0.2, 0.7, MAT.stoneDark, doorX, 0.36, d / 2 + 0.52, g);
  box(1.9, 0.22, 0.6, MAT.stone, doorX, 0.14, d / 2 + 1.0, g);
  wallLantern(g, doorX + 0.95, B0 + 1.95, dz - 0.02);
  // porch roof over the door (a little lean-to on two posts) or a hood
  if (opts.porch ?? rnd() < 0.45) {
    const pz = d / 2 + 1.25, ph = B0 + 2.45;
    for (const sx of [-1, 1]) { cyl(0.08, 0.1, ph, 8, MAT.timber, doorX + sx * 0.95, ph / 2, pz, g); box(0.3, 0.12, 0.3, MAT.stoneDark, doorX + sx * 0.95, 0.06, pz, g); }
    box(2.2, 0.16, 0.16, MAT.timber, doorX, ph, pz, g);
    box(0.14, 0.14, 1.25, MAT.timber, doorX - 0.95, ph + 0.1, pz - 0.6, g);
    box(0.14, 0.14, 1.25, MAT.timber, doorX + 0.95, ph + 0.1, pz - 0.6, g);
    box(2.5, thatch ? 0.3 : 0.12, 1.7, hoodMat, doorX, ph + 0.34, d / 2 + 0.7, g, { rx: 0.32 });
  } else {
    box(1.7, thatch ? 0.26 : 0.1, 0.75, hoodMat, doorX, B0 + 2.5, d / 2 + 0.42, g, { rx: 0.3 });
    for (const sx of [-1, 1]) beam(0, B0 + 2.1, 0.55, B0 + 2.45, 0.08, 0.08, MAT.timber, doorX + sx * 0.7, 'x', g);
  }
  // roof
  const rh = opts.roofH ?? W * 0.46;
  const gableStyle = opts.gable ?? (rnd() < 0.5 ? 'boards' : 'timber');
  const roof = gableRoof(g, W, D, rh, yTop, thatch ? MAT.thatch : roofMat, thatch ? { wall: gableStyle === 'boards' ? MAT.wood : wallMat, overX: 0.7, overZ: 0.55, thatch: true, t: 0.5, cap: MAT.thatchDark } : { wall: gableStyle === 'boards' ? MAT.wood : wallMat, overX: 0.6, overZ: 0.5 });
  // gable-end detail: boarded or half-timbered, with an attic window
  for (const sz of [-1, 1]) {
    const z = sz * (D / 2 + 0.03);
    box(W + 0.1, 0.2, 0.14, MAT.timber, 0, yTop + 0.02, z, g);
    if (gableStyle === 'timber') {
      box(0.16, rh * 0.35, 0.09, MAT.timber, 0, yTop + rh * 0.175, z, g);
      box(W * 0.62, 0.13, 0.09, MAT.timber, 0, yTop + rh * 0.35, z, g);
      for (const sx of [-1, 1]) {
        beam(sx * W * 0.3, yTop + 0.1, sx * 0.08, yTop + rh * 0.3, 0.1, 0.08, MAT.timber, z, 'z', g);
        box(0.12, rh * 0.24, 0.08, MAT.timber, sx * W * 0.2, yTop + rh * 0.47, z, g);
      }
    } else {
      // scalloped board ends along the base of the boarding
      for (let i = 0; i < Math.floor(W / 0.24); i++) pbox(0.2, 0.12, 0.05, 0x7a5638, -W / 2 + 0.14 + i * 0.24, yTop + 0.16, z + sz * 0.02, g, { mat: MAT.paintWood, cast: false });
    }
    const wg = new THREE.Group(); wg.position.set(0, yTop + rh * (gableStyle === 'timber' ? 0.62 : 0.45), z + sz * 0.02); wg.rotation.y = sz > 0 ? 0 : Math.PI; g.add(wg);
    windowUnit(wg, rnd, { w: 0.55, h: 0.62, shutterCol, box: false, shutters: gableStyle === 'boards' });
    // crossed barge-board horns at the ridge ends
    if (!thatch) for (const sx of [-1, 1]) box(0.9, 0.16, 0.08, MAT.timber, sx * 0.28, roof.ridgeY + 0.22, sz * (roof.D / 2 + 0.05), g, { rz: sx * 0.75 });
  }
  // dormer on a long roof
  if (opts.dormer ?? (D > 5.5 && rnd() < 0.7)) {
    const sx = rnd() < 0.5 ? -1 : 1, zc = (rnd() - 0.5) * D * 0.3;
    const xo = sx * W * 0.2, yb = yTop + rh * (1 - Math.abs(xo) / (W / 2)) - 0.1;
    const dg = new THREE.Group(); dg.position.set(xo, yb, zc); dg.rotation.y = sx * Math.PI / 2; g.add(dg);
    box(1.4, 1.8, 1.5, wallMat, 0, 0.2, -0.2, dg);
    const wg = new THREE.Group(); wg.position.set(0, 0.55, 0.56); dg.add(wg);
    windowUnit(wg, rnd, { w: 0.6, h: 0.65, shutters: false, box: false });
    for (const s of [-1, 1]) box(1.05, 0.12, 1.9, roofMat, s * 0.42, 1.38, -0.15, dg, { rz: -s * 0.62 });
    box(0.2, 0.2, 1.95, MAT.timber, 0, 1.68, -0.15, dg, { rz: Math.PI / 4 });
  }
  // chimney: stone stack with a cap and pot
  let chimney = null;
  if (opts.chimney !== false) {
    const cx = W * 0.26 * (rnd() < 0.5 ? -1 : 1), cz = -D * 0.22;
    const yr = roof.eave + rh * (1 - Math.abs(cx) / (W / 2));
    const y0 = yr - 0.8, y1 = Math.max(roof.ridgeY + 0.7, yr + 1.3);
    box(0.78, y1 - y0, 0.78, MAT.stoneDark, cx, (y0 + y1) / 2, cz, g);
    box(0.98, 0.16, 0.98, MAT.stone, cx, y1 + 0.02, cz, g);
    box(0.84, 0.12, 0.84, MAT.stoneDark, cx, y0 + 0.9, cz, g);
    cyl(0.14, 0.17, 0.35, 8, MAT.stoneDark, cx, y1 + 0.27, cz, g);
    chimney = new THREE.Vector3(cx, y1 + 0.5, cz);
  }
  // trade sign on a bracket
  if (opts.sign) {
    const sgx = doorX - 1.15, sgy = B0 + 2.6, sgz = d / 2 + 0.2;
    box(0.08, 0.08, 1.0, MAT.iron, sgx, sgy + 0.45, sgz + 0.45, g);
    const sg = new THREE.Group(); sg.position.set(sgx, sgy, sgz + 0.75); sg.rotation.y = Math.PI / 2; g.add(sg);
    pbox(0.9, 0.6, 0.06, 0x7a5236, 0, 0, 0, sg, { mat: MAT.paintWood });
    for (const s of [-1, 1]) box(0.03, 0.4, 0.03, MAT.iron, s * 0.35, 0.45, 0, sg);
    if (opts.sign === 'bread') {
      for (const s of [-1, 1]) { const b = pball(0.2, 0xd8a052, s * 0.18, 0.0, s * 0.05, sg, { sx: 1.4, sy: 0.7, sz: 0.55 }); b.rotation.z = s * 0.3; }
    } else if (opts.sign === 'inn') {
      pcyl(0.14, 0.12, 0.3, 8, 0xd8b068, 0, -0.02, 0.06, sg);
      pcyl(0.02, 0.02, 0.18, 6, 0xf4ecd8, 0, 0.16, 0.06, sg);
      for (const s of [-1, 1]) pbox(0.04, 0.3, 0.1, 0x6a4a34, s * 0.34, 0, 0.04, sg);
    }
  }
  // flower planter by the door
  if (opts.planter ?? rnd() < 0.7) planter(g, doorX - 1.25 * (rnd() < 0.5 ? -1 : 1) - 0.1, d / 2 + 0.55, rnd);
  // porch clutter: barrel, crate, woodpile against a side wall
  if (rnd() < 0.7) barrel(g, W / 2 + 0.55, 0, d / 2 - 0.5, rnd);
  if (rnd() < 0.5) crate(g, -W / 2 - 0.55, 0.36, d / 2 - 0.6, 0.7, rnd() * 0.5, rnd);
  if (opts.woodpile ?? rnd() < 0.55) woodpile(g, -W / 2 - 0.5, -d / 2 + 1.3, 2.2, Math.PI / 2, rnd);
  const eave = roof.eave;
  g.userData = {
    w: W + 0.4, d: D + 0.4, height: roof.ridgeY + 0.2, chimney, eave, roofH: rh, roofHW: W / 2,
    roofTop: (lx) => eave + rh * Math.max(0, 1 - Math.abs(lx) / (W / 2)),
  };
  return g;
}

// ------------------------------------------------------------------
// Set dressing pieces (added into a parent group at local x, y, z)
export function barrel(p, x, y, z, rnd = Math.random, o = {}) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rnd() * TAU; p.add(g);
  lathe([[0, 0], [0.3, 0], [0.36, 0.2], [0.38, 0.42], [0.36, 0.64], [0.3, 0.84], [0, 0.84]], 12, MAT.wood, 0, 0, 0, g);
  for (const hy of [0.12, 0.72]) mesh(new THREE.TorusGeometry(0.345, 0.025, 4, 14), MAT.iron, 0, hy, 0, g, { rx: Math.PI / 2 });
  mesh(new THREE.TorusGeometry(0.38, 0.025, 4, 14), MAT.iron, 0, 0.42, 0, g, { rx: Math.PI / 2 });
  if (o.apples ?? rnd() < 0.35) for (let i = 0; i < 6; i++) pball(0.08, [0xd8402c, 0xe8c040, 0x8ab848][i % 3], (rnd() - 0.5) * 0.36, 0.86, (rnd() - 0.5) * 0.36, g);
  return g;
}
export function crate(p, x, y, z, s = 0.7, ry = 0, rnd = Math.random) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; p.add(g);
  box(s, s, s, MAT.woodLight, 0, 0, 0, g);
  for (const sz of [-1, 1]) {
    box(s + 0.02, 0.08, 0.05, MAT.timber, 0, s / 2 - 0.05, sz * s / 2, g); box(s + 0.02, 0.08, 0.05, MAT.timber, 0, -s / 2 + 0.05, sz * s / 2, g);
    beam(-s / 2 + 0.06, -s / 2 + 0.06, s / 2 - 0.06, s / 2 - 0.06, 0.07, 0.05, MAT.timber, sz * s / 2, 'z', g);
  }
  if (rnd() < 0.4) for (let i = 0; i < 5; i++) pball(0.09, [0xe06a2a, 0x8ab848, 0xd83a3a][Math.floor(rnd() * 3)], (rnd() - 0.5) * s * 0.6, s / 2 + 0.05, (rnd() - 0.5) * s * 0.6, g);
  return g;
}
function sack(p, x, y, z, rnd, col = 0xcbb08a) {
  const s = pball(0.3, col, x, y + 0.26, z, p, { detail: 1, sx: 0.9, sy: 0.95, sz: 0.75 });
  s.rotation.set((rnd() - 0.5) * 0.3, rnd() * TAU, (rnd() - 0.5) * 0.3);
  pcyl(0.07, 0.12, 0.14, 6, col, x, y + 0.56, z, p);
  pcyl(0.075, 0.075, 0.03, 6, 0x6a4a34, x, y + 0.52, z, p);
}
export function woodpile(p, x, z, len = 2.2, ry = 0, rnd = Math.random) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; p.add(g);
  const r = 0.12, rows = 4;
  for (let row = 0; row < rows; row++) {
    const n = Math.floor(len / (r * 2.05)) - row;
    for (let i = 0; i < n; i++) {
      const lx = -len / 2 + r + row * r + i * r * 2.05;
      const lg = mesh(tinted(cylGeo(r, r, 0.9, 7), [0x6a4a34, 0x7a5638, 0x5e4230][(i + row) % 3]), MAT.paint, lx, r + row * r * 1.75, 0, g, { rx: Math.PI / 2 });
      void lg;
      mesh(tinted(new THREE.CircleGeometry(r * 0.92, 7), 0xcaa472), MAT.paint, lx, r + row * r * 1.75, 0.451, g);
    }
  }
  // little shingle roof over the pile
  for (const sx of [-1, 1]) box(0.1, 1.05, 0.1, MAT.timber, sx * (len / 2 + 0.05), 0.52, -0.35, g);
  box(len + 0.5, 0.08, 1.1, MAT.wood, 0, 1.1, 0, g, { rx: -0.25 });
  return g;
}
export function planter(p, x, z, rnd = Math.random, o = {}) {
  const g = new THREE.Group(); g.position.set(x, 0, z); p.add(g);
  const L = o.len ?? 0.9, Wd = o.wid ?? 0.55;
  if (o.stone) box(L, 0.45, Wd, MAT.stoneDark, 0, 0.22, 0, g);
  else pbox(L, 0.45, Wd, 0x7a5236, 0, 0.22, 0, g, { mat: MAT.paintWood });
  pbox(L - 0.1, 0.06, Wd - 0.1, 0x4a3424, 0, 0.44, 0, g);
  const fc = FLOWER_COLS[Math.floor(rnd() * FLOWER_COLS.length)];
  const n = Math.round(L * 7);
  for (let i = 0; i < n; i++) {
    const lx = (rnd() - 0.5) * (L - 0.2), lz = (rnd() - 0.5) * (Wd - 0.2);
    pball(0.13 + rnd() * 0.05, [0x4f8a3a, 0x5c9a42, 0x3f7a34][i % 3], lx, 0.56, lz, g, { sy: 0.85 });
    if (rnd() < 0.7) pball(0.07, rnd() < 0.8 ? fc : 0xf4f0e8, lx + (rnd() - 0.5) * 0.08, 0.68 + rnd() * 0.08, lz, g);
  }
  return g;
}
// Street lamp: stone foot, timber post with a curled bracket and a hanging lantern
export function lampPost(rnd = Math.random) {
  const g = new THREE.Group();
  box(0.5, 0.3, 0.5, MAT.stoneDark, 0, 0.12, 0, g);
  cyl(0.08, 0.11, 3.1, 8, MAT.timber, 0, 1.7, 0, g);
  box(0.16, 0.12, 1.0, MAT.timber, 0, 3.05, 0.4, g);
  beam(0, 2.55, 0.5, 2.98, 0.07, 0.07, MAT.timber, 0, 'x', g);
  const lg = new THREE.Group(); lg.position.set(0, 2.62, 0.78); g.add(lg);
  box(0.03, 0.3, 0.03, MAT.iron, 0, 0.3, 0, lg);
  box(0.28, 0.34, 0.28, windowMat, 0, 0, 0, lg, { cast: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.035, 0.38, 0.035, MAT.iron, sx * 0.14, 0, sz * 0.14, lg);
  mesh(new THREE.ConeGeometry(0.26, 0.2, 4), MAT.iron, 0, 0.27, 0, lg, { ry: Math.PI / 4 });
  box(0.32, 0.04, 0.32, MAT.iron, 0, -0.18, 0, lg);
  void rnd;
  return g;
}
// Bunting between points (world or local): sagging cord with pennants, one mesh.
export function bunting(points, rnd = Math.random, o = {}) {
  const g = new THREE.Group(); g.userData.noShadow = true;
  const cols = o.cols ?? [0xd8503e, 0xf0c050, 0x4f7ab8, 0xf2ece0, 0x5a9a4a];
  const pos = [], col = [];
  const push = (p, c) => { pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b, 0.4); };
  const c = new THREE.Color(), cord = hc(0x4a3a2a);
  for (let s = 0; s < points.length - 1; s++) {
    const a = points[s], b = points[s + 1];
    const L = a.distanceTo(b), n = Math.max(2, Math.floor(L / 0.55));
    const sag = o.sag ?? L * 0.08;
    const at = (t) => new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -Math.sin(Math.PI * t) * sag, 0));
    const side = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
    for (let i = 0; i < n; i++) {
      const t0 = (i + 0.15) / n, t1 = (i + 0.85) / n;
      const p0 = at(t0), p1 = at(t1), pm = at((t0 + t1) / 2).add(new THREE.Vector3(0, -0.42, 0)).addScaledVector(side, (rnd() - 0.5) * 0.05);
      c.set(cols[(i + s) % cols.length]);
      push(p0, c); push(p1, c); push(pm, c);
      // cord segment as a thin quad
      const q0 = at(i / n), q1 = at((i + 1) / n);
      push(q0, cord); push(q1, cord); push(q1.clone().add(new THREE.Vector3(0, -0.03, 0)), cord);
      push(q0, cord); push(q1.clone().add(new THREE.Vector3(0, -0.03, 0)), cord); push(q0.clone().add(new THREE.Vector3(0, -0.03, 0)), cord);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, MAT.paintDS); m.castShadow = false; m.receiveShadow = true;
  g.add(m);
  return g;
}
// Washing line between two T-posts with a few hanging cloths
export function washingLine(len = 4.5, rnd = Math.random) {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    cyl(0.06, 0.07, 2.2, 6, MAT.timber, sx * len / 2, 1.1, 0, g);
    box(0.1, 0.08, 0.7, MAT.timber, sx * len / 2, 2.12, 0, g);
  }
  for (const sz of [-0.25, 0.25]) stick(new THREE.Vector3(-len / 2, 2.1, sz), new THREE.Vector3(len / 2, 2.1, sz), 0.012, null, g, 4, 0xe8e0d0);
  const cols = [0xf2ece0, 0x8ab0d8, 0xd87a6a, 0xe8d08a, 0xa8c890];
  let x = -len / 2 + 0.4;
  while (x < len / 2 - 0.5) {
    const cw = 0.4 + rnd() * 0.5, ch = 0.5 + rnd() * 0.45, sz = rnd() < 0.5 ? -0.25 : 0.25;
    const cg = tinted(new THREE.PlaneGeometry(cw, ch, 2, 2), cols[Math.floor(rnd() * cols.length)]);
    const pp = cg.attributes.position;
    for (let i = 0; i < pp.count; i++) pp.setZ(i, Math.sin((pp.getX(i) / cw + 0.5) * Math.PI) * 0.04 + (pp.getY(i) < 0 ? 0.03 : 0));
    cg.computeVertexNormals();
    mesh(cg, MAT.paintDS, x + cw / 2, 2.08 - ch / 2, sz, g, { ry: (rnd() - 0.5) * 0.2 });
    x += cw + 0.15 + rnd() * 0.3;
  }
  return g;
}
// Handcart with spoked wheels and shafts resting on the ground
export function cart(rnd = Math.random, o = {}) {
  const g = new THREE.Group();
  const L = 2.0, Wd = 1.2;
  const bed = new THREE.Group(); bed.position.y = 0.72; bed.rotation.z = 0.08; g.add(bed);
  box(L, 0.1, Wd, MAT.wood, 0, 0, 0, bed);
  for (const sz of [-1, 1]) box(L, 0.36, 0.08, MAT.wood, 0, 0.2, sz * (Wd / 2 - 0.04), bed);
  box(0.08, 0.36, Wd, MAT.wood, -L / 2 + 0.04, 0.2, 0, bed);
  for (const sz of [-1, 1]) stick(new THREE.Vector3(L / 2 - 0.1, -0.05, sz * 0.45), new THREE.Vector3(L / 2 + 1.3, -0.62, sz * 0.4), 0.045, MAT.timber, bed);
  for (const sz of [-1, 1]) {
    const wg = new THREE.Group(); wg.position.set(-0.1, 0.5, sz * (Wd / 2 + 0.08)); g.add(wg);
    mesh(new THREE.TorusGeometry(0.46, 0.05, 5, 16), MAT.timber, 0, 0, 0, wg);
    cyl(0.09, 0.09, 0.14, 8, MAT.timber, 0, 0, 0, wg, { rx: Math.PI / 2 });
    for (let k = 0; k < 6; k++) box(0.05, 0.86, 0.04, MAT.timber, 0, 0, 0, wg, { rz: (k / 6) * Math.PI });
  }
  // load
  const load = o.load ?? Math.floor(rnd() * 3);
  if (load === 0) for (let i = 0; i < 3; i++) sack(bed, -0.5 + i * 0.5, 0.05, (rnd() - 0.5) * 0.3, rnd);
  else if (load === 1) for (let i = 0; i < 14; i++) pball(0.14, [0xe06a2a, 0xd8402c, 0x8ab848, 0xe8c040][i % 4], -0.7 + (i % 7) * 0.22, 0.14 + Math.floor(i / 7) * 0.12, (Math.floor(i / 7) - 0.5) * 0.3 + (rnd() - 0.5) * 0.1, bed);
  else { hayBale(bed, 0, 0.3, 0, 0.8, 0); }
  return g;
}
export function hayBale(p, x, y, z, s = 1, ry = 0) {
  const b = box(1.1 * s, 0.55 * s, 0.6 * s, MAT.straw, x, y, z, p, { ry });
  for (const k of [-0.25, 0.25]) box(0.04, 0.57 * s, 0.62 * s, MAT.timber, x + Math.cos(ry) * k * s, y, z - Math.sin(ry) * k * s, p, { ry });
  return b;
}
// Garden plot: raised soil bed with vegetable rows and a wicker edge
export function gardenPlot(w = 3, d = 2, rnd = Math.random) {
  const g = new THREE.Group();
  box(w, 0.28, d, MAT.timber, 0, 0.1, 0, g);
  pbox(w - 0.12, 0.08, d - 0.12, 0x5a4030, 0, 0.26, 0, g);
  const rows = Math.max(2, Math.floor(d / 0.5));
  for (let r = 0; r < rows; r++) {
    const z = -d / 2 + 0.3 + r * (d - 0.6) / Math.max(1, rows - 1);
    pbox(w - 0.3, 0.1, 0.22, 0x6a4a34, 0, 0.32, z, g);
    const kind = r % 3;
    const n = Math.floor((w - 0.4) / 0.32);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.35 + i * 0.32 + (rnd() - 0.5) * 0.05;
      if (kind === 0) { pball(0.14, 0x7ab85a, x, 0.45, z, g, { sy: 0.8 }); pball(0.09, 0xc6e08a, x, 0.5, z, g); }
      else if (kind === 1) { for (let k = 0; k < 3; k++) { const b = pball(0.05, 0x5c9a42, x + (k - 1) * 0.04, 0.52, z, g, { sy: 3 }); b.rotation.z = (k - 1) * 0.4; } pball(0.04, 0xe07a2a, x, 0.38, z, g); }
      else { pball(0.12, 0x4f8a3a, x, 0.44, z, g, { sy: 1.1 }); if (rnd() < 0.5) pball(0.05, 0xd8402c, x + 0.06, 0.48, z + 0.06, g); }
    }
  }
  // stakes & a little scarecrow-ish marker
  for (const sx of [-1, 1]) stick(new THREE.Vector3(sx * (w / 2 - 0.1), 0.2, d / 2 - 0.05), new THREE.Vector3(sx * (w / 2 - 0.1), 0.9, d / 2 - 0.05), 0.03, MAT.timber, g);
  return g;
}
// Dry-stone wall segment (stacked, jittered stones) along local x
export function stoneWall(len = 4, rnd = Math.random, o = {}) {
  const g = new THREE.Group();
  const h = o.h ?? 0.9, rows = Math.round(h / 0.3);
  for (let r = 0; r < rows; r++) {
    let x = -len / 2 + (r % 2 ? 0.25 : 0);
    while (x < len / 2 - 0.1) {
      const sw = Math.min(len / 2 - x, 0.45 + rnd() * 0.4);
      const col = [0xa89c8a, 0x968c7e, 0xb4a894, 0x8c8478][Math.floor(rnd() * 4)];
      pbox(sw - 0.04, 0.28 + rnd() * 0.05, 0.55 - r * 0.05, col, x + sw / 2, 0.15 + r * 0.29, (rnd() - 0.5) * 0.06, g, { mat: MAT.paintStone, ry: (rnd() - 0.5) * 0.08 });
      x += sw;
    }
  }
  // capstones with moss tufts
  for (let x = -len / 2 + 0.3; x < len / 2; x += 0.6) {
    pbox(0.56, 0.16, 0.6, 0x9a9282, x, rows * 0.29 + 0.08, 0, g, { mat: MAT.paintStone, rz: (rnd() - 0.5) * 0.1 });
    if (rnd() < 0.4) pball(0.12, 0x5f8a3c, x + (rnd() - 0.5) * 0.3, rows * 0.29 + 0.2, (rnd() - 0.5) * 0.2, g, { sy: 0.5, a: 1 });
  }
  g.userData.top = rows * 0.29 + 0.16;
  return g;
}

// ------------------------------------------------------------------
export function moraTower() {
  const g = new THREE.Group();
  const rnd = mulberry32(99);
  const H = 15;
  // slightly bulging, leaning stone shaft
  const tg = new THREE.CylinderGeometry(3.5, 4.3, H, 18, 10);
  const p = tg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + Math.sin(y * 0.3) * 0.15 + (rnd() - 0.5) * 0.08);
    p.setZ(i, p.getZ(i) + (rnd() - 0.5) * 0.08);
  }
  tg.computeVertexNormals();
  mesh(tg, MAT.stone, 0, H / 2, 0, g);
  // footing, string courses, buttresses
  cyl(4.6, 4.9, 1.2, 18, MAT.stoneDark, 0, 0.5, 0, g);
  cyl(4.75, 5.05, 0.4, 18, MAT.stoneDark, 0, 0.1, 0, g);
  for (const y of [6, 10.6]) cyl(4.3 - (y / H) * 0.8 + 0.18, 4.3 - (y / H) * 0.8 + 0.22, 0.4, 18, MAT.stoneDark, 0, y, 0, g);
  for (let i = 0; i < 4; i++) {
    const a = i * (TAU / 4) + 0.9;
    const bg = new THREE.Group(); bg.position.set(Math.cos(a) * 4.1, 0, Math.sin(a) * 4.1); bg.rotation.y = -a; g.add(bg);
    box(1.2, 3.4, 0.9, MAT.stoneDark, 0.3, 1.7, 0, bg);
    box(0.9, 2.4, 0.8, MAT.stoneDark, 0.1, 4.2, 0, bg, { rz: 0.28 });
  }
  // ivy climbing one side
  for (let i = 0; i < 26; i++) {
    const a = -1.9 + (rnd() - 0.5) * 1.1, y = 1 + rnd() * rnd() * 10;
    const r = 4.3 - (y / H) * 0.8 + 0.1;
    pball(0.35 + rnd() * 0.3, [0x4a7a34, 0x5c8e3c, 0x3e6a30][i % 3], Math.cos(a) * r, y, Math.sin(a) * r, g, { detail: 1, sx: 1, sy: 1.1, sz: 0.5, a: 1 });
  }
  // balcony: timber deck on corbels with a railing
  cyl(4.75, 4.75, 0.3, 24, MAT.wood, 0, H, 0, g);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const cg = new THREE.Group(); cg.position.set(Math.cos(a) * 3.7, H - 0.5, Math.sin(a) * 3.7); cg.rotation.y = -a; g.add(cg);
    box(1.0, 0.25, 0.25, MAT.timber, 0.4, 0.2, 0, cg);
    beam(-0.1, -0.4, 0.8, 0.15, 0.16, 0.2, MAT.timber, 0, 'z', cg);
  }
  const bal = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.09, 6, 36), MAT.timber);
  bal.rotation.x = Math.PI / 2; bal.position.y = H + 0.95; g.add(bal);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    cyl(0.05, 0.06, 0.85, 5, MAT.timber, Math.cos(a) * 4.6, H + 0.55, Math.sin(a) * 4.6, g);
  }
  // crooked witch-hat roof with an upturned brim and dormer
  const rg = new THREE.ConeGeometry(5.6, 8, 20, 10, true);
  const rp = rg.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const y = rp.getY(i) + 4, t = y / 8;
    const k = 1 + (1 - t) * (1 - t) * 0.08;
    rp.setX(i, rp.getX(i) * k + t * t * t * 2.4);
    rp.setZ(i, rp.getZ(i) * k);
    rp.setY(i, rp.getY(i) - Math.sin(t * Math.PI) * 0.4 + (1 - t) * (1 - t) * (1 - t) * 0.5);
  }
  rg.computeVertexNormals();
  mesh(rg, MAT.roofMora, 0, H + 1 + 4, 0, g);
  const brim = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.18, 6, 36), MAT.gold);
  brim.rotation.x = Math.PI / 2; brim.position.y = H + 1.05; g.add(brim);
  // gold bands up the hat
  for (const [t, r] of [[0.28, 4.1], [0.52, 2.75]]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 5, 28), MAT.gold);
    band.rotation.x = Math.PI / 2; band.position.set(t * t * t * 2.4, H + 1 + t * 8 - Math.sin(t * Math.PI) * 0.4 + 0.05, 0); g.add(band);
  }
  const dmg = new THREE.Group(); dmg.position.set(0, H + 3.0, 3.75); g.add(dmg);
  box(1.2, 1.1, 1.2, MAT.plaster, 0, 0, 0, dmg);
  const dwg = new THREE.Group(); dwg.position.set(0, 0, 0.62); dmg.add(dwg);
  windowUnit(dwg, rnd, { w: 0.55, h: 0.6, shutters: false, box: false });
  for (const s of [-1, 1]) box(0.9, 0.1, 1.5, MAT.roofMora, s * 0.36, 0.78, 0, dmg, { rz: -s * 0.72 });
  const star = new THREE.Mesh(crystalGeometry('prism', { double: true, sides: 5, radius: 0.5, seed: 41 }), crystalMaterial({ color: 0xffe2a0, glow: 0xffc860, intensity: 1.5 }));
  star.scale.setScalar(0.5); star.position.set(2.4, H + 1 + 8.3, 0); g.add(star);
  star.add(crystalGlowSprite(0xffc860, 5, { intensity: 0.35 }));
  // windows: deep-set round-headed windows spiralling up the shaft
  for (let i = 0; i < 5; i++) {
    const a = i * 1.45 + 0.4, y = 3.2 + i * 2.35;
    const r = 4.3 - (y / H) * 0.8;
    const wg = new THREE.Group(); wg.position.set(Math.cos(a) * r, y, Math.sin(a) * r); wg.rotation.y = Math.PI / 2 - a; g.add(wg);
    windowUnit(wg, rnd, { w: 0.7, h: 0.95, arch: true, shutterCol: 0x3a3f86, box: i < 3 });
  }
  // door facing +x (towards training yard): arched stone surround, plank door, steps, lanterns
  const dg = new THREE.Group(); dg.position.set(4.2, 0, 0); dg.rotation.y = Math.PI / 2; g.add(dg);
  box(1.6, 2.5, 0.3, MAT.door, 0, 1.95, 0.05, dg);
  for (const k of [1.2, 2.4]) box(1.5, 0.08, 0.05, MAT.iron, 0, k, 0.22, dg);
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (i / 6);
    box(0.42, 0.34, 0.4, MAT.stoneDark, Math.cos(a) * 1.0, 3.2 + Math.sin(a) * 0.55, 0.12, dg, { rz: a - Math.PI / 2 });
  }
  for (const s of [-1, 1]) box(0.42, 2.6, 0.42, MAT.stoneDark, s * 1.02, 1.9, 0.12, dg);
  for (let k = 0; k < 3; k++) box(2.6 - k * 0.3, 0.2, 0.6, MAT.stoneDark, 0, 0.1 + k * 0.2, 1.3 - k * 0.45, dg);
  wallLantern(dg, 1.55, 2.6, 0.2); wallLantern(dg, -1.55, 2.6, 0.2);
  // telescope on a tripod on the balcony
  const tel = new THREE.Group(); tel.position.set(-3, H + 0.15, 1.5); g.add(tel);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; stick(new THREE.Vector3(0, 1.1, 0), new THREE.Vector3(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5), 0.035, MAT.timber, tel); }
  cyl(0.16, 0.26, 2.4, 10, MAT.bronze, 0, 1.6, 0, tel, { rz: 0.9, rx: 0.3 });
  // annex cottage
  const an = house({ w: 5, d: 4.2, h: 2.8, roof: MAT.roofMora, wall: MAT.plaster, seed: 5, chimney: true, porch: false, woodpile: true, dormer: false, shutterCol: 0x3a3f86 });
  an.position.set(-2, 0, -6.2); an.rotation.y = Math.PI; g.add(an);
  // banners
  const ban = new THREE.Mesh(new THREE.PlaneGeometry(1, 3, 1, 6), MAT.clothBlue);
  ban.position.set(3.7, 10, 2.2); ban.rotation.y = 1.0; g.add(ban);
  // hanging crystal chimes
  const chimes = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.25;
    const col = [0xb894ff, 0xff8a3a, 0x7dffc3, 0x8fe3ff, 0xffd84a][i];
    const c = new THREE.Mesh(crystalGeometry('prism', { double: true, seed: 20 + i }), crystalMaterial({ color: col, intensity: 1.3 }));
    c.scale.setScalar(0.2);
    c.add(crystalGlowSprite(col, 6, { intensity: 0.35 }));
    c.position.set(Math.cos(a) * 5.2, H + 0.4 - (i % 2) * 0.4, Math.sin(a) * 5.2);
    g.add(c); chimes.push(c);
  }
  g.userData = { chimes, chimney: an.userData.chimney ? an.userData.chimney.clone().applyEuler(an.rotation).add(an.position) : null };
  return g;
}

// ------------------------------------------------------------------
export function bellTower() {
  const g = new THREE.Group();
  const rnd = mulberry32(7);
  // stepped base
  box(6.2, 0.35, 6.2, MAT.stoneDark, 0, 0.1, 0, g);
  box(5.4, 1.0, 5.4, MAT.stoneDark, 0, 0.7, 0, g);
  // tapering shaft with corner pilasters and string courses
  box(4.4, 8.8, 4.4, MAT.stone, 0, 5.4, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.7, 8.8, 0.7, MAT.stoneDark, sx * 2.1, 5.4, sz * 2.1, g);
  for (const y of [3.5, 7]) box(4.8, 0.3, 4.8, MAT.stoneDark, 0, y, 0, g);
  // arched door with plank leaf and step
  const dg = new THREE.Group(); dg.position.set(0, 1.2, 2.21); g.add(dg);
  box(1.4, 2.3, 0.14, MAT.door, 0, 1.05, 0, dg);
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (i / 6);
    box(0.36, 0.3, 0.26, MAT.stoneDark, Math.cos(a) * 0.86, 2.2 + Math.sin(a) * 0.45, 0.05, dg, { rz: a - Math.PI / 2 });
  }
  for (const k of [0.5, 1.6]) box(1.3, 0.07, 0.05, MAT.iron, 0, k, 0.09, dg);
  box(2.0, 0.25, 1.0, MAT.stoneDark, 0, 0.35, 2.9, g);
  // narrow slit windows
  for (let f = 0; f < 4; f++) {
    const a = (f / 4) * TAU;
    const wg = new THREE.Group(); wg.position.set(Math.sin(a) * 2.22, 5.3, Math.cos(a) * 2.22); wg.rotation.y = a; g.add(wg);
    box(0.3, 1.0, 0.06, windowMat, 0, 0, 0, wg, { cast: false });
    box(0.5, 0.14, 0.14, MAT.stoneDark, 0, 0.58, 0.04, wg); box(0.5, 0.14, 0.18, MAT.stoneDark, 0, -0.56, 0.05, wg);
  }
  // clock-like rune disc on the front
  mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.12, 20), MAT.stoneDark, 0, 8.1, 2.2, g, { rx: Math.PI / 2 });
  mesh(new THREE.TorusGeometry(0.62, 0.05, 5, 24), MAT.gold, 0, 8.1, 2.28, g);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; box(0.06, 0.2, 0.04, MAT.gold, Math.cos(a) * 0.45, 8.1 + Math.sin(a) * 0.45, 2.29, g, { rz: a + Math.PI / 2 }); }
  // belfry: floor, corner posts, arched openings, railing
  box(5.0, 0.4, 5.0, MAT.wood, 0, 9.8, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.62, 4.0, 0.62, MAT.timber, sx * 1.95, 11.9, sz * 1.95, g);
  for (let f = 0; f < 4; f++) {
    const fg = new THREE.Group(); fg.rotation.y = (f / 4) * TAU; g.add(fg);
    // arch brackets
    for (const s of [-1, 1]) beam(s * 1.65, 12.9, s * 0.6, 13.7, 0.16, 0.2, MAT.timber, 1.95, 'z', fg);
    box(3.6, 0.1, 0.1, MAT.timber, 0, 10.9, 2.0, fg);
    for (let i = 0; i < 7; i++) box(0.07, 0.8, 0.07, MAT.timber, -1.5 + i * 0.5, 10.45, 2.0, fg);
  }
  box(5.0, 0.4, 5.0, MAT.timber, 0, 13.9, 0, g);
  // flared pyramid roof with eaves and finial
  const roofG = new THREE.ConeGeometry(4.3, 4.2, 4, 4, true);
  const rp = roofG.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const t = (rp.getY(i) + 2.1) / 4.2;
    const k = 1 + (1 - t) * (1 - t) * 0.12;
    rp.setX(i, rp.getX(i) * k); rp.setZ(i, rp.getZ(i) * k);
    rp.setY(i, rp.getY(i) - (1 - t) * (1 - t) * 0.5);
  }
  roofG.computeVertexNormals();
  const roof = mesh(roofG, MAT.roofTeal, 0, 16.2, 0, g, { ry: Math.PI / 4 });
  void roof;
  box(5.4, 0.18, 5.4, MAT.timber, 0, 14.15, 0, g);
  cyl(0.12, 0.2, 0.9, 8, MAT.gold, 0, 18.5, 0, g);
  const fin = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), MAT.gold); fin.position.y = 19.1; g.add(fin);
  // little weather-vane arrow
  box(0.9, 0.05, 0.05, MAT.iron, 0, 19.6, 0, g);
  mesh(new THREE.ConeGeometry(0.12, 0.3, 4), MAT.iron, 0.5, 19.6, 0, g, { rz: -Math.PI / 2 });
  // bell (lathe) with yoke
  const pts = [];
  const prof = [[0, 0], [0.25, 0], [0.4, -0.2], [0.55, -0.9], [0.7, -1.5], [1.05, -2.0], [1.1, -2.15], [0.95, -2.15]];
  for (const [x, y] of prof) pts.push(new THREE.Vector2(x, y));
  const bellGeo = new THREE.LatheGeometry(pts, 24);
  const pivot = new THREE.Group(); pivot.position.y = 13.4; g.add(pivot);
  const bell = new THREE.Mesh(bellGeo, MAT.bronze); bell.castShadow = true; pivot.add(bell);
  const yoke = new THREE.Mesh(chamferBox(1.6, 0.3, 0.3), MAT.timberMoving); yoke.position.y = 0.15; pivot.add(yoke);
  const clap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), MAT.iron); clap.position.y = -1.9; pivot.add(clap);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), fresnelMat(0xfff0c0, 0xffc860, { intensity: 1.5, alpha: 0 }));
  glow.position.y = -1.2; pivot.add(glow);
  box(4.2, 0.26, 0.26, MAT.timber, 0, 13.7, 0, g);
  // flower tubs at the base
  for (const s of [-1, 1]) planter(g, s * 1.9, 3.35, rnd, { len: 1.0, wid: 0.6, stone: true });
  g.userData = { bell: pivot, glow };
  return g;
}

// ------------------------------------------------------------------
// Element shrine: stepped round dais, ring of fluted pillars with capitals
// (element crystals on top), lintel fragments, carved altar and a bell arch.
// Collider contract (world.js): discs r10.6 top +0.35 & r9.3 top +0.8,
// altar box 1.3, pillars r0.7 at radius 8.2, bell posts at (±2, -5).
const EL_HEX = { fire: 0xff7a2a, frost: 0x6cd0ff, storm: 0xffd84a, wind: 0x6effc0, arcane: 0xa070ff };
export function shrine(el, runeTex, opts = {}) {
  const g = new THREE.Group();
  const rnd = mulberry32(el.length * 31);
  const frost = el === 'frost';
  const stone = frost ? MAT.stoneBlue : MAT.ruin;
  const bodyCol = new THREE.Color(EL_HEX[el]).lerp(new THREE.Color(0xffffff), 0.25);
  const orbMat = crystalMaterial({ color: bodyCol, glow: EL_HEX[el], intensity: 1.1 });
  const snow = (x, y, z, sx, sz, p = g) => { if (frost) pball(1, 0xd2dbe8, x, y, z, p, { detail: 1, sx, sy: 0.18, sz, cast: false }); };
  // dais: outer step ring of blocks, inner platform with a carved border
  cyl(10.5, 11, 0.5, 40, MAT.stoneDark, 0, 0.1, 0, g);
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * TAU;
    box(1.55, 0.14, 0.9, MAT.stoneDark, Math.cos(a) * 10.35, 0.36, Math.sin(a) * 10.35, g, { ry: -a + Math.PI / 2 });
  }
  cyl(9.2, 9.5, 0.6, 40, stone, 0, 0.55, 0, g);
  mesh(new THREE.TorusGeometry(9.25, 0.12, 4, 48), MAT.stoneDark, 0, 0.84, 0, g, { rx: Math.PI / 2 });
  // stairs on four sides
  for (let s = 0; s < 4; s++) {
    const a = (s / 4) * TAU + Math.PI / 4;
    const sg = new THREE.Group(); sg.rotation.y = -a; g.add(sg);
    for (let k = 0; k < 3; k++) box(3.2, 0.28, 0.6, stone, 0, 0.14 + k * 0.24, 11.0 - k * 0.5, sg);
    for (const sx of [-1, 1]) { box(0.5, 0.8, 1.8, MAT.stoneDark, sx * 1.85, 0.4, 10.5, sg); snow(sx * 1.85, 0.82, 10.5, 0.35, 0.95, sg); }
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ map: runeTex, color: new THREE.Color(EL_HEX[el]).multiplyScalar(0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.87; g.add(floor);
  // pillars: square base, drum-segmented fluted shaft, capital
  const N = 8;
  const fluted = new THREE.CylinderGeometry(0.55, 0.62, 1, 16, 1);
  { const fp = fluted.attributes.position; for (let i = 0; i < fp.count; i++) { const a = Math.atan2(fp.getZ(i), fp.getX(i)); const k = 1 - 0.07 * (0.5 + 0.5 * Math.cos(a * 8)); fp.setX(i, fp.getX(i) * k); fp.setZ(i, fp.getZ(i) * k); } fluted.computeVertexNormals(); }
  const tops = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU + Math.PI / N;
    const broken = opts.ruined ? rnd() < 0.5 : rnd() < 0.15;
    const h = broken ? 1.5 + rnd() * 2.5 : 6;
    const x = Math.cos(a) * 8.2, z = Math.sin(a) * 8.2;
    box(1.5, 0.4, 1.5, MAT.stoneDark, x, 1.0, z, g);
    box(1.25, 0.22, 1.25, stone, x, 1.3, z, g);
    const hs = broken ? h : h - 0.6;
    const drums = Math.ceil(hs / 1.3);
    for (let k = 0; k < drums; k++) {
      const dh = Math.min(1.3, hs - k * 1.3) - 0.04;
      if (dh <= 0.05) break;
      const m = mesh(fluted, stone, x, 1.4 + k * 1.3 + dh / 2, z, g, { ry: rnd() * 0.3 });
      m.scale.set(1, dh, 1);
    }
    if (!broken) {
      const ty = 0.85 + h;
      cyl(0.62, 0.52, 0.3, 16, stone, x, ty - 0.05, z, g);
      box(1.5, 0.45, 1.5, MAT.stoneDark, x, ty + 0.2, z, g);
      snow(x, ty + 0.45, z, 0.8, 0.8);
      tops.push({ a, y: ty + 0.42 });
      const orb = new THREE.Mesh(crystalGeometry('prism', { double: true, seed: 60 + i }), orbMat);
      orb.scale.setScalar(0.3); orb.rotation.y = rnd() * 3;
      orb.position.set(x, ty + 0.95, z); g.add(orb);
      orb.add(crystalGlowSprite(EL_HEX[el], 7, { intensity: 0.28 }));
    } else {
      // jagged broken top and a fallen drum nearby
      const jag = mesh(new THREE.DodecahedronGeometry(0.5, 0), stone, x, 1.4 + h - 0.1, z, g);
      jag.scale.set(1, 0.5, 1); jag.rotation.set(rnd(), rnd() * 3, rnd() * 0.5);
      const fa = a + (rnd() - 0.5) * 0.4, fr = 8.2 + (rnd() < 0.5 ? 1.8 : -1.8);
      const fd = mesh(fluted, stone, Math.cos(fa) * fr, 1.25, Math.sin(fa) * fr, g, { rz: Math.PI / 2, ry: rnd() * 3 });
      fd.scale.set(1, 1.2, 1);
      const chunk = mesh(new THREE.DodecahedronGeometry(0.45, 0), stone, x + rnd() * 2 - 1, 1.1, z + rnd() * 2 - 1, g);
      chunk.rotation.set(rnd() * 3, rnd() * 3, 0);
      if (!frost) pball(0.4, 0x6a8a48, x, 1.35, z + 0.6, g, { detail: 1, sy: 0.35, a: 1 });
    }
  }
  // lintel fragments between neighbouring intact pillars
  for (let i = 0; i < tops.length; i++) {
    const A = tops[i], Bp = tops[(i + 1) % tops.length];
    let da = Bp.a - A.a; if (da < 0) da += TAU;
    if (Math.abs(da - TAU / N) > 0.01 || (opts.ruined && rnd() < 0.5)) continue;
    const am = A.a + da / 2, L = 2 * 8.2 * Math.sin(da / 2);
    const lx = Math.cos(am) * 8.2 * Math.cos(da / 2), lz = Math.sin(am) * 8.2 * Math.cos(da / 2);
    box(L + 0.8, 0.5, 0.9, MAT.stoneDark, lx, A.y + 0.2, lz, g, { ry: -am + Math.PI / 2 });
    snow(Math.cos(am) * 7.8, A.y + 0.5, Math.sin(am) * 7.8, 1.3, 0.4);
    if (frost) for (let k = 0; k < 7; k++) {
      // icicles hanging from the lintel's outer edge
      const t = (k / 6 - 0.5) * (L - 0.4), len = 0.25 + rnd() * 0.5;
      const ox = lx - Math.sin(am) * t + Math.cos(am) * 0.4, oz = lz + Math.cos(am) * t + Math.sin(am) * 0.4;
      const ic = mesh(tinted(new THREE.ConeGeometry(0.06 + rnd() * 0.04, len, 5), 0xcfe6f4), MAT.paint, ox, A.y - 0.05 - len / 2, oz, g, { cast: false });
      ic.rotation.x = Math.PI;
    }
  }
  // altar: stepped plinth, carved body with element inlay, offering bowl rim
  box(2.6, 0.6, 2.6, MAT.stoneDark, 0, 1.15, 0, g);
  box(1.6, 1.0, 1.6, stone, 0, 1.95, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.34, 1.0, 0.34, MAT.stoneDark, sx * 0.76, 1.95, sz * 0.76, g);
  box(2.0, 0.25, 2.0, MAT.stoneDark, 0, 2.55, 0, g);
  mesh(new THREE.TorusGeometry(0.6, 0.08, 5, 20), MAT.gold, 0, 2.7, 0, g, { rx: Math.PI / 2 });
  for (let f = 0; f < 4; f++) { const a = (f / 4) * TAU; const ig = new THREE.Group(); ig.rotation.y = a; g.add(ig); mesh(new THREE.OctahedronGeometry(0.2, 0), MAT.gold, 0, 1.95, 0.82, ig); }
  // element crystal: a group so the orbiting shards and halo follow it (story.js moves / scales / hides it)
  const crystal = new THREE.Group();
  crystal.position.y = 4.2; g.add(crystal);
  const cMat = crystalMaterial({ color: bodyCol, glow: EL_HEX[el], intensity: 1.35, seed: el.length });
  const core = new THREE.Mesh(crystalGeometry('prism', { double: true, seed: 5, radius: 0.46 }), cMat);
  core.scale.setScalar(1.05); crystal.add(core);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const sh = new THREE.Mesh(crystalGeometry('prism', { double: true, seed: 80 + i, radius: 0.34 }), cMat);
    sh.scale.setScalar(0.2 + (i % 2) * 0.06);
    sh.position.set(Math.cos(a) * 1.25, (i % 2 ? 0.35 : -0.3), Math.sin(a) * 1.25);
    sh.rotation.set((i % 2 ? 0.3 : -0.25), a, (i % 2 ? -0.2 : 0.25));
    crystal.add(sh);
  }
  crystal.add(crystalGlowSprite(EL_HEX[el], 5.5, { intensity: 0.32 }));
  // bell arch (behind altar, -z): two pillars, a carved beam with upturned ends
  for (const sx of [-1, 1]) {
    box(1.1, 0.5, 1.1, MAT.stoneDark, sx * 2, 1.1, -5, g);
    const m = mesh(fluted, stone, sx * 2, 0.85 + 2.95, -5, g); m.scale.set(0.75, 5.1, 0.75);
    cyl(0.5, 0.4, 0.3, 12, MAT.stoneDark, sx * 2, 6.35, -5, g);
  }
  box(5.6, 0.6, 1.0, MAT.stoneDark, 0, 6.6, -5, g);
  for (const sx of [-1, 1]) box(0.9, 0.35, 1.05, MAT.stoneDark, sx * 2.9, 6.95, -5, g, { rz: -sx * 0.35 });
  box(4.4, 0.3, 0.8, stone, 0, 7.05, -5, g);
  snow(0, 7.25, -5, 2.4, 0.5);
  const pts = [[0, 0], [0.18, 0], [0.3, -0.15], [0.38, -0.6], [0.5, -1.0], [0.72, -1.35], [0.76, -1.45], [0.6, -1.45]].map(([x, y]) => new THREE.Vector2(x, y));
  const pivot = new THREE.Group(); pivot.position.set(0, 6.2, -5); g.add(pivot);
  const bell = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), MAT.bronze); bell.castShadow = true; pivot.add(bell);
  // frost: snow drifts on the dais edge; storm: moss and cracked slabs
  if (frost) for (let i = 0; i < 14; i++) { const a = rnd() * TAU; snow(Math.cos(a) * (9.6 + rnd() * 0.8), 0.45, Math.sin(a) * (9.6 + rnd() * 0.8), 0.9 + rnd(), 0.6 + rnd() * 0.5); }
  else for (let i = 0; i < 16; i++) { const a = rnd() * TAU, r = 3 + rnd() * 5.5; pball(0.35 + rnd() * 0.3, [0x6a8a48, 0x5a7a3e][i % 2], Math.cos(a) * r, 0.86, Math.sin(a) * r, g, { detail: 1, sy: 0.18, a: 1, cast: false }); }
  // seal dome
  const seal = new THREE.Mesh(new THREE.SphereGeometry(11, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), fresnelMat(0x2a1640, 0x9a6aff, { intensity: 1.1, power: 2.2, side: THREE.DoubleSide }));
  seal.position.y = 0.2; g.add(seal);
  g.userData = { crystal, bell: pivot, seal, floor };
  return g;
}

// ------------------------------------------------------------------
// Lantern stone (등석): stepped base, octagonal shaft with a lotus collar,
// open firebox between four posts, wide roof with upturned corners, finial.
export function lanternStone() {
  const g = new THREE.Group();
  box(1.25, 0.28, 1.25, MAT.stoneDark, 0, 0.12, 0, g);
  cyl(0.5, 0.58, 0.22, 8, MAT.stone, 0, 0.36, 0, g);
  cyl(0.24, 0.3, 1.1, 8, MAT.stone, 0, 1.0, 0, g);
  // lotus collar
  lathe([[0.24, 0], [0.42, 0.06], [0.56, 0.18], [0.5, 0.24], [0.3, 0.2], [0, 0.22]], 8, MAT.stone, 0, 1.5, 0, g);
  box(0.95, 0.16, 0.95, MAT.stoneDark, 0, 1.8, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.16, 0.72, 0.16, MAT.stone, sx * 0.34, 2.24, sz * 0.34, g);
  const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), flameMat.clone());
  flame.position.y = 2.2; flame.visible = false; g.add(flame);
  flame.add(crystalGlowSprite(0xffa040, 2.6, { intensity: 0.4 }));
  const cage = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.0, 0.4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  cage.position.y = 2.25; g.add(cage);
  box(0.92, 0.12, 0.92, MAT.stoneDark, 0, 2.63, 0, g);
  // roof: flat-ish pyramid with swept-up corners
  const rg = new THREE.ConeGeometry(0.95, 0.55, 16, 3);
  const rp = rg.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const t = (rp.getY(i) + 0.275) / 0.55, th = Math.atan2(rp.getZ(i), rp.getX(i));
    const sq = 1 / Math.max(Math.abs(Math.cos(th)), Math.abs(Math.sin(th)));
    const k = 0.78 * (1 + (sq - 1) * (1 - t));
    rp.setX(i, rp.getX(i) * k); rp.setZ(i, rp.getZ(i) * k);
    rp.setY(i, rp.getY(i) + (1 - t) * (1 - t) * (sq - 1) * 0.42 - (1 - t) * 0.06);
  }
  rg.computeVertexNormals();
  mesh(rg, MAT.stoneDark, 0, 2.95, 0, g);
  cyl(0.12, 0.16, 0.16, 8, MAT.stone, 0, 3.27, 0, g);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), MAT.stone); knob.position.y = 3.45; g.add(knob);
  mesh(new THREE.ConeGeometry(0.08, 0.2, 6), MAT.stone, 0, 3.62, 0, g);
  // moss at the foot
  for (let i = 0; i < 4; i++) { const a = i * 1.7; pball(0.18, 0x5a8a3a, Math.cos(a) * 0.55, 0.3, Math.sin(a) * 0.55, g, { sy: 0.45, a: 1, cast: false }); }
  g.userData = { flame, cage, flameY: 2.25 };
  return g;
}

// Brazier: iron bowl with a rolled rim and studs on three curved legs over a stone slab
export function brazier() {
  const g = new THREE.Group();
  cyl(0.72, 0.8, 0.2, 8, MAT.stoneDark, 0, 0.08, 0, g);
  const bowlMat = toon(0x4a4a50, { rim: 0.5, side: THREE.DoubleSide });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const lg = new THREE.Group(); lg.rotation.y = -a; g.add(lg);
    stick(new THREE.Vector3(0.52, 0.18, 0), new THREE.Vector3(0.44, 0.75, 0), 0.06, MAT.iron, lg);
    stick(new THREE.Vector3(0.44, 0.75, 0), new THREE.Vector3(0.3, 1.25, 0), 0.06, MAT.iron, lg);
    mesh(new THREE.SphereGeometry(0.09, 6, 4), MAT.iron, 0.52, 0.2, 0, lg);
  }
  mesh(new THREE.TorusGeometry(0.34, 0.04, 5, 12), MAT.iron, 0, 0.78, 0, g, { rx: Math.PI / 2 });
  const bowl = lathe([[0.18, 0], [0.42, 0.1], [0.66, 0.3], [0.76, 0.5], [0.72, 0.52], [0.62, 0.34], [0.4, 0.16], [0.16, 0.08]], 14, bowlMat, 0, 1.2, 0, g);
  bowl.castShadow = true;
  mesh(new THREE.TorusGeometry(0.76, 0.05, 5, 18), MAT.iron, 0, 1.71, 0, g, { rx: Math.PI / 2 });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; mesh(new THREE.SphereGeometry(0.05, 5, 4), MAT.bronze, Math.cos(a) * 0.62, 1.48, Math.sin(a) * 0.62, g); }
  cyl(0.5, 0.5, 0.05, 12, MAT.dark, 0, 1.35, 0, g);
  const coal = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.1, 0.1) }));
  coal.position.y = 1.45; coal.scale.y = 0.5; g.add(coal);
  consolidate(g, [coal]);
  g.userData = { coal, fireY: 1.6 };
  return g;
}

// Wind wheel: stone footing, braced mast, cloth-sailed rotor with a bronze hub
export function windWheel() {
  const g = new THREE.Group();
  box(0.9, 0.35, 0.9, MAT.stoneDark, 0, 0.15, 0, g);
  box(0.6, 0.3, 0.6, MAT.stone, 0, 0.45, 0, g);
  cyl(0.11, 0.15, 3.3, 8, MAT.timber, 0, 1.9, 0, g);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + 0.5; stick(new THREE.Vector3(Math.cos(a) * 0.4, 0.55, Math.sin(a) * 0.4), new THREE.Vector3(0, 1.5, 0), 0.04, MAT.timber, g); }
  box(0.3, 0.3, 0.55, MAT.timber, 0, 3.3, 0.02, g);
  // tail vane
  box(0.05, 0.5, 0.8, MAT.wood, 0, 3.35, -0.6, g);
  const rotor = new THREE.Group(); rotor.position.set(0, 3.3, 0.35); g.add(rotor);
  cyl(0.18, 0.18, 0.3, 8, MAT.bronze, 0, 0, 0, rotor, { rx: Math.PI / 2 });
  mesh(new THREE.ConeGeometry(0.15, 0.25, 8), MAT.bronze, 0, 0, 0.26, rotor, { rx: Math.PI / 2 });
  const cols = [MAT.clothRed, MAT.cloth, MAT.clothBlue, MAT.cloth];
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group(); arm.rotation.z = (i / 4) * Math.PI * 2; rotor.add(arm);
    box(0.08, 1.45, 0.06, MAT.timberMoving, 0, 0.78, 0, arm);
    box(0.5, 0.05, 0.05, MAT.timberMoving, 0.24, 1.42, 0.02, arm);
    const sail = box(0.5, 1.1, 0.03, cols[i], 0.28, 0.86, 0.02, arm);
    sail.rotation.y = 0.3;
  }
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), glowMat(0x6effc0, 2, { nocache: true, opacity: 0 }));
  rotor.add(glow);
  consolidate(g, [rotor]);
  for (const arm of rotor.children) if (arm.isGroup) consolidate(arm);
  g.userData = { rotor, glow };
  return g;
}

// Windmill: tapered octagonal plaster tower with timber bands, gallery,
// boat-shaped cap; lattice sails on the rotor.
export function windmill() {
  const g = new THREE.Group();
  const rnd = mulberry32(3);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 9, 8), MAT.plaster);
  body.position.y = 4.5; body.castShadow = true; body.receiveShadow = true; g.add(body);
  cyl(3.35, 3.5, 1.1, 8, MAT.stone, 0, 0.35, 0, g);
  for (const y of [3.0, 6.2]) { const r = 3.2 - (y / 9) * 1.0; cyl(r + 0.08, r + 0.1, 0.2, 8, MAT.timber, 0, y, 0, g); }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    stick(new THREE.Vector3(Math.cos(a) * 3.22, 0.9, Math.sin(a) * 3.22), new THREE.Vector3(Math.cos(a) * 2.22, 9, Math.sin(a) * 2.22), 0.09, MAT.timber, g);
  }
  // gallery around the cap
  cyl(3.0, 3.0, 0.18, 16, MAT.wood, 0, 8.3, 0, g);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; cyl(0.04, 0.04, 0.8, 4, MAT.timber, Math.cos(a) * 2.95, 8.7, Math.sin(a) * 2.95, g); }
  mesh(new THREE.TorusGeometry(2.95, 0.05, 4, 24), MAT.timber, 0, 9.1, 0, g, { rx: Math.PI / 2 });
  cyl(2.35, 2.35, 0.25, 8, MAT.timber, 0, 9.0, 0, g);
  // cap: pointed roof with a ridge toward the sails
  const rg = new THREE.ConeGeometry(2.8, 3.2, 12, 3);
  const rp = rg.attributes.position;
  for (let i = 0; i < rp.count; i++) { if (rp.getZ(i) > 0) rp.setZ(i, rp.getZ(i) * 1.15); }
  rg.computeVertexNormals();
  mesh(rg, MAT.roofRed, 0, 10.7, 0, g);
  box(0.5, 0.5, 1.0, MAT.timber, 0, 8.3, 2.6, g);
  // door, windows, flour sacks
  box(1.1, 2.1, 0.2, MAT.door, 0, 1.55, 3.0, g, { rx: -0.11 });
  box(1.4, 0.22, 0.3, MAT.timber, 0, 2.7, 2.93, g, { rx: -0.11 });
  box(1.8, 0.25, 0.9, MAT.stoneDark, 0, 0.35, 3.5, g);
  for (const [a, y] of [[0.7, 4.5], [2.6, 6.8], [-2.2, 5.2]]) {
    const r = 3.2 - (y / 9) * 1.0 - 0.02;
    const wg = new THREE.Group(); wg.position.set(Math.sin(a) * r, y, Math.cos(a) * r); wg.rotation.y = a; g.add(wg);
    windowUnit(wg, rnd, { w: 0.55, h: 0.7, shutters: true, shutterCol: 0x8a4a3a, box: false });
  }
  for (let i = 0; i < 3; i++) sack(g, 1.4 + i * 0.35, 0, 3.4 - i * 0.2, rnd);
  const rotor = new THREE.Group(); rotor.position.set(0, 8.2, 3.0); g.add(rotor);
  cyl(0.3, 0.3, 0.6, 8, MAT.timberMoving, 0, 0, 0, rotor, { rx: Math.PI / 2 });
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group(); arm.rotation.z = (i / 4) * Math.PI * 2; rotor.add(arm);
    box(0.2, 6, 0.15, MAT.timberMoving, 0, 3, 0.3, arm);
    box(1.4, 4.6, 0.05, MAT.clothMoving, 0.8, 3.6, 0.35, arm);
    for (let k = 0; k < 5; k++) box(1.5, 0.06, 0.08, MAT.timberMoving, 0.8, 1.4 + k * 1.1, 0.38, arm);
    box(0.06, 4.7, 0.08, MAT.timberMoving, 1.52, 3.6, 0.38, arm);
  }
  g.userData = { rotor };
  return g;
}

// Well: fitted stone ring with a coping, timber frame, shingled roof, crank, rope & bucket
export function well() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 1.1, 16, 1, true), toon(0xb8ad9a, { flat: true, side: THREE.DoubleSide, tex: 'stone' }));
  ring.position.y = 0.55; ring.castShadow = true; g.add(ring);
  mesh(new THREE.TorusGeometry(1.33, 0.14, 5, 16), MAT.stoneDark, 0, 1.12, 0, g, { rx: Math.PI / 2 });
  cyl(1.5, 1.6, 0.25, 16, MAT.stoneDark, 0, 0.1, 0, g);
  cyl(1.1, 1.1, 0.05, 14, new THREE.MeshBasicMaterial({ color: 0x1a3a4a }), 0, 0.7, 0, g);
  for (const sx of [-1, 1]) {
    box(0.2, 2.5, 0.2, MAT.timber, sx * 1.25, 1.65, 0, g);
    beam(sx * 1.25, 2.3, sx * 0.7, 2.85, 0.1, 0.1, MAT.timber, 0, 'z', g);
  }
  box(2.9, 0.18, 0.2, MAT.timber, 0, 2.95, 0, g);
  for (const s of [-1, 1]) box(1.75, 0.1, 2.6, MAT.roofRed, s * 0.72, 3.35, 0, g, { rz: -s * 0.6 });
  box(0.22, 0.22, 2.7, MAT.timber, 0, 3.86, 0, g, { rz: Math.PI / 4 });
  cyl(0.12, 0.12, 2.4, 8, MAT.wood, 0, 2.4, 0, g, { rz: Math.PI / 2 });
  // crank handle
  box(0.06, 0.4, 0.06, MAT.iron, 1.42, 2.25, 0, g);
  box(0.25, 0.05, 0.05, MAT.iron, 1.52, 2.05, 0, g);
  // rope + bucket
  cyl(0.015, 0.015, 0.9, 4, MAT.timber, 0, 1.95, 0, g);
  const bk = lathe([[0, 0], [0.18, 0], [0.22, 0.32], [0.2, 0.32], [0.16, 0.03], [0, 0.03]], 10, MAT.wood, 0.0, 1.2, 0, g);
  void bk;
  mesh(new THREE.TorusGeometry(0.2, 0.02, 4, 10), MAT.iron, 0, 1.44, 0, g, { rx: Math.PI / 2 });
  // bucket left on the coping
  lathe([[0, 0], [0.16, 0], [0.2, 0.3], [0.18, 0.3], [0.14, 0.03], [0, 0.03]], 10, MAT.wood, 0.95, 1.22, 0.6, g);
  return g;
}

// Market stall: counter with baskets of produce, striped scalloped awning
export function stall(color = MAT.clothRed) {
  const g = new THREE.Group();
  const rnd = mulberry32(color === MAT.clothRed ? 5 : 9);
  const stripeA = color === MAT.clothRed ? 0xc0473a : 0x4a6fb0, stripeB = 0xf0e6d2;
  // counter
  box(3, 0.95, 1.3, MAT.woodLight, 0, 0.48, 0, g);
  box(3.2, 0.1, 1.45, MAT.wood, 0, 0.98, 0.02, g);
  for (let i = 0; i < 5; i++) box(0.05, 0.85, 0.05, MAT.timber, -1.2 + i * 0.6, 0.45, 0.66, g);
  // posts and a back shelf
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.12, 2.7, 0.12, MAT.timber, sx * 1.45, 1.35, sz * 0.65, g);
  box(2.8, 0.08, 0.4, MAT.wood, 0, 1.55, -0.55, g);
  // striped awning: sloped panel of alternating strips + scalloped valance
  const n = 8, aw = 3.5 / n;
  const aG = new THREE.Group(); aG.position.set(0, 2.72, 0.25); aG.rotation.x = 0.26; g.add(aG);
  for (let i = 0; i < n; i++) pbox(aw + 0.005, 0.05, 2.1, i % 2 ? stripeB : stripeA, -1.75 + aw / 2 + i * aw, 0, 0, aG, { mat: MAT.paintDS });
  // scalloped valance hanging from the front edge (in awning space, unrotated back to vertical)
  const val = new THREE.Group(); val.position.set(0, -0.02, 1.05); val.rotation.x = -0.26; aG.add(val);
  for (let i = 0; i < n * 2; i++) {
    const x = -1.75 + (i + 0.5) * (aw / 2), c = Math.floor(i / 2) % 2 ? stripeB : stripeA;
    mesh(tinted(new THREE.PlaneGeometry(aw / 2, 0.2), c), MAT.paintDS, x, -0.1, 0, val, { cast: false });
    mesh(tinted(new THREE.CircleGeometry(aw / 4, 8, Math.PI, Math.PI), c), MAT.paintDS, x, -0.2, 0, val, { cast: false });
  }
  // baskets with produce on the counter
  const fruitCols = [[0xe0503a, 0xd83a2a], [0xf0c040, 0xe8b030], [0x7ab84a, 0x5a9a3a], [0xff8a3a, 0xe87028]];
  for (let b = 0; b < 3; b++) {
    const bx = -1.0 + b * 1.0;
    lathe([[0, 0], [0.34, 0], [0.42, 0.22], [0.38, 0.22], [0.3, 0.04], [0, 0.04]], 10, MAT.straw, bx, 1.03, 0.05, g);
    const fc = fruitCols[(b + (color === MAT.clothRed ? 0 : 2)) % 4];
    for (let i = 0; i < 9; i++) pball(0.1, fc[i % 2], bx + (rnd() - 0.5) * 0.45, 1.2 + (i > 5 ? 0.08 : 0), 0.05 + (rnd() - 0.5) * 0.45, g, { detail: 1 });
  }
  // jars and a sack on the shelf / ground
  for (let i = 0; i < 4; i++) pcyl(0.09, 0.11, 0.25, 8, [0x6a8ab0, 0xc8b890, 0xa86a4a][i % 3], -1.0 + i * 0.6, 1.72, -0.55, g);
  sack(g, 1.9, 0, 0.4, rnd);
  crate(g, -1.95, 0.3, 0.3, 0.6, 0.3, rnd);
  return g;
}

export function fence(len = 4) {
  const g = new THREE.Group();
  const rnd = mulberry32(Math.round(len * 100));
  const n = Math.max(2, Math.round(len / 1.6));
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + (i / n) * len;
    box(0.15, 1.15 + (rnd() - 0.5) * 0.1, 0.15, MAT.timber, x, 0.55, 0, g, { rz: (rnd() - 0.5) * 0.06 });
    mesh(new THREE.ConeGeometry(0.11, 0.14, 4), MAT.timber, x, 1.18, 0, g, { ry: Math.PI / 4 });
  }
  for (let i = 0; i < n; i++) {
    const x0 = -len / 2 + (i / n) * len, x1 = -len / 2 + ((i + 1) / n) * len;
    beam(x0, 0.86 + (rnd() - 0.5) * 0.05, x1, 0.86 + (rnd() - 0.5) * 0.05, 0.1, 0.07, MAT.wood, 0.08, 'z', g);
    beam(x0, 0.46 + (rnd() - 0.5) * 0.05, x1, 0.46 + (rnd() - 0.5) * 0.05, 0.1, 0.07, MAT.wood, 0.08, 'z', g);
  }
  return g;
}

// Bench: plank seat on turned legs with a slatted back; seat height ~0.5 (NPCs sit on it)
export function bench() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) box(2, 0.07, 0.17, MAT.wood, 0, 0.5, -0.19 + i * 0.19, g);
  for (let i = 0; i < 2; i++) box(2, 0.12, 0.05, MAT.wood, 0, 0.78 + i * 0.2, -0.3, g, { rx: -0.15 });
  for (const sx of [-1, 1]) {
    box(0.1, 0.5, 0.1, MAT.timber, sx * 0.85, 0.25, 0.2, g);
    box(0.1, 1.05, 0.1, MAT.timber, sx * 0.85, 0.52, -0.28, g, { rx: -0.12 });
    box(0.1, 0.08, 0.6, MAT.timber, sx * 0.85, 0.43, -0.03, g);
    box(0.1, 0.06, 0.5, MAT.timber, sx * 0.85, 0.72, 0.0, g);
  }
  return g;
}

// Signpost: rounded post with a cap and arrow-shaped boards (ry per board)
export function signpost(texts = []) {
  const g = new THREE.Group();
  box(0.4, 0.2, 0.4, MAT.stoneDark, 0, 0.08, 0, g);
  cyl(0.08, 0.1, 2.5, 8, MAT.timber, 0, 1.25, 0, g);
  mesh(new THREE.ConeGeometry(0.14, 0.2, 8), MAT.timber, 0, 2.58, 0, g);
  texts.forEach((t, i) => {
    const bg = new THREE.Group(); bg.position.y = 2.05 - i * 0.42; bg.rotation.y = t.ry || 0; g.add(bg);
    pbox(1.1, 0.28, 0.06, i % 2 ? 0xc49a6c : 0xb08a60, 0.62, 0, 0, bg, { mat: MAT.paintWood });
    const tip = mesh(tinted(triGeo([0, 0.14, 0], [0, -0.14, 0], [0.22, 0, 0]), i % 2 ? 0xc49a6c : 0xb08a60), MAT.paintDS, 1.17, 0, 0, bg);
    void tip;
    // painted lettering suggestion
    for (let k = 0; k < 3; k++) pbox(0.14 + (k % 2) * 0.06, 0.05, 0.02, 0x3a2a1e, 0.35 + k * 0.24, 0.02, 0.035, bg, { cast: false });
  });
  return g;
}

// Roadside milestone: rounded stone slab with a carved band
export function milestone(rnd = Math.random) {
  const g = new THREE.Group();
  box(0.6, 0.9, 0.3, MAT.stone, 0, 0.4, 0, g, { rz: (rnd() - 0.5) * 0.08 });
  const top = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 10, 1, false, 0, Math.PI), MAT.stone, 0, 0.85, 0, g);
  top.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  box(0.5, 0.07, 0.04, MAT.stoneDark, 0, 0.6, 0.15, g);
  pball(0.2, 0x5f8a3c, 0.1, 0.05, 0.1, g, { sy: 0.5, a: 1, cast: false });
  return g;
}
// Stone cairn (돌탑): stacked flat stones, a prayer ribbon on the top
export function cairn(rnd = Math.random, h = 1.4) {
  const g = new THREE.Group();
  let y = 0, r = 0.55;
  while (y < h) {
    const s = pball(r, [0x9a9282, 0x8a8478, 0xa8a090][Math.floor(rnd() * 3)], (rnd() - 0.5) * 0.06, y + r * 0.35, (rnd() - 0.5) * 0.06, g, { mat: MAT.paintStone, sy: 0.42, sx: 1 + (rnd() - 0.5) * 0.2 });
    s.rotation.y = rnd() * 3;
    y += r * 0.62; r *= 0.82;
  }
  return g;
}
// Lakeside dock: plank deck on posts stepping out over the water (local +z = out)
export function dock(len = 9, width = 2.2, rnd = Math.random) {
  const g = new THREE.Group();
  const n = Math.round(len / 0.3);
  for (let i = 0; i < n; i++) {
    const z = 0.15 + i * 0.3;
    pbox(width + (rnd() - 0.5) * 0.12, 0.08, 0.27, [0x9c7250, 0x8a6446, 0xa87c58][Math.floor(rnd() * 3)], (rnd() - 0.5) * 0.05, 0.0, z, g, { mat: MAT.paintWood, ry: (rnd() - 0.5) * 0.03 });
  }
  for (const sx of [-1, 1]) box(0.12, 0.14, len, MAT.timber, sx * (width / 2 - 0.1), -0.1, len / 2, g);
  for (let k = 0; k <= Math.floor(len / 2.2); k++) {
    const z = Math.min(len - 0.15, 0.2 + k * 2.2);
    for (const sx of [-1, 1]) cyl(0.12, 0.14, 3.2, 7, MAT.timber, sx * (width / 2 - 0.05), -1.35, z, g);
  }
  // mooring posts at the end with rope coils, a little rowboat tied alongside
  for (const sx of [-1, 1]) {
    cyl(0.13, 0.14, 1.0, 7, MAT.timber, sx * (width / 2 - 0.05), 0.4, len - 0.15, g);
    mesh(new THREE.TorusGeometry(0.16, 0.04, 4, 10), MAT.straw, sx * (width / 2 - 0.05), 0.55, len - 0.15, g, { rx: Math.PI / 2 });
  }
  const boat = new THREE.Group(); boat.position.set(width / 2 + 0.9, -0.28, len * 0.62); boat.rotation.y = 0.08; g.add(boat);
  const hull = new THREE.LatheGeometry([[0, -0.3], [0.5, -0.25], [0.62, 0.05], [0.6, 0.12]].map(([a, b]) => new THREE.Vector2(a, b)), 12);
  hull.scale(1, 1, 2.8);
  mesh(tinted(hull, 0x8a6446), MAT.paintDS, 0, 0, 0, boat);
  mesh(new THREE.TorusGeometry(0.6, 0.04, 4, 16), MAT.timber, 0, 0.12, 0, boat, { rx: Math.PI / 2 }).scale.set(1, 2.8, 1);
  box(1.1, 0.06, 0.25, MAT.timber, 0, 0.0, 0.3, boat);
  box(0.9, 0.06, 0.25, MAT.timber, 0, 0.0, -0.6, boat);
  stick(new THREE.Vector3(-0.3, 0.05, -0.2), new THREE.Vector3(0.9, 0.2, 0.9), 0.03, MAT.timber, boat);
  return g;
}

// Grave: carved headstone with a rounded top, small stone kerb, flowers, a candle
export function grave() {
  const g = new THREE.Group();
  const rnd = mulberry32(17);
  box(1.4, 0.2, 0.7, MAT.stoneDark, 0, 0.05, 0.05, g);
  const s = box(0.9, 1.3, 0.25, MAT.stoneBlue, 0, 0.6, 0, g, { rx: -0.06 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.25, 16, 1, false, 0, Math.PI), MAT.stoneBlue);
  top.rotation.x = Math.PI / 2; top.rotation.z = Math.PI / 2; top.position.set(0, 1.25, 0); g.add(top);
  void s;
  // carved circle (a bell) on the face
  mesh(new THREE.TorusGeometry(0.2, 0.035, 4, 16), MAT.stoneDark, 0, 0.95, 0.15, g, { rx: -0.06 });
  // kerb outlining a small plot in front
  for (const sx of [-1, 1]) box(0.14, 0.18, 1.3, MAT.stoneDark, sx * 0.6, 0.06, 0.8, g);
  box(1.34, 0.18, 0.14, MAT.stoneDark, 0, 0.06, 1.45, g);
  // flowers inside the plot
  for (let i = 0; i < 14; i++) {
    const x = (rnd() - 0.5) * 0.95, z = 0.4 + rnd() * 0.95;
    pball(0.1, [0x5c9a42, 0x4f8a3a][i % 2], x, 0.1, z, g, { sy: 0.7, a: 1, cast: false });
    pball(0.06, [0xf4f0e8, 0x9ad0f4, 0xf6e6a0][i % 3], x + 0.03, 0.2, z, g, { cast: false });
  }
  // a candle in a little jar
  pcyl(0.08, 0.09, 0.16, 8, 0xc8d8e0, 0.32, 0.22, 0.25, g);
  pcyl(0.03, 0.03, 0.1, 6, 0xf4ecd8, 0.32, 0.33, 0.25, g);
  return g;
}

export function dummy() {
  const g = new THREE.Group();
  const pivot = new THREE.Group(); g.add(pivot);
  cyl(0.08, 0.1, 2.2, 6, MAT.timber, 0, 1.1, 0, pivot);
  cyl(0.06, 0.06, 1.6, 6, MAT.timber, 0, 1.6, 0, pivot, { rz: Math.PI / 2 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), MAT.straw); head.position.y = 2.3; head.castShadow = true; pivot.add(head);
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.2, 8, 1, true), toon(0x8a6a9a, { side: THREE.DoubleSide })); body.position.y = 1.2; body.rotation.x = Math.PI; body.castShadow = true; pivot.add(body);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.7, 8), MAT.roofMora); hat.position.y = 2.75; hat.rotation.z = 0.3; pivot.add(hat);
  // straw tufts at the wrists and a rope belt
  for (const sx of [-1, 1]) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 6), MAT.straw); t.position.set(sx * 0.85, 1.6, 0); t.rotation.z = sx * Math.PI / 2; pivot.add(t); }
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 4, 12), MAT.straw); belt.position.y = 1.5; belt.rotation.x = Math.PI / 2; pivot.add(belt);
  consolidate(pivot);
  g.userData = { pivot };
  return g;
}

export function targetCrystal(color = 0xb894ff) {
  const g = new THREE.Group();
  const mat = crystalMaterial({ color, intensity: 1.15, seed: 3 });
  const c = new THREE.Mesh(crystalGeometry('prism', { double: true, seed: 11, radius: 0.48 }), mat);
  c.scale.setScalar(0.62); g.add(c);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.022, 6, 48), glowMat(color, 0.9));
  ring.rotation.x = Math.PI / 2; g.add(ring);
  // mini shards ride the ring (ring spins about world Y in world.js); ring-local
  // orientation = inverse(ring tilt) * (upright, slightly leaning, facing outward)
  const qInv = new THREE.Quaternion().setFromEuler(ring.rotation).invert();
  const qW = new THREE.Quaternion(), eW = new THREE.Euler();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const s = new THREE.Mesh(crystalGeometry('prism', { double: true, seed: 90 + i, radius: 0.36 }), mat);
    s.scale.setScalar(0.13);
    s.position.set(Math.cos(a) * 0.9, Math.sin(a) * 0.9, (i - 1) * 0.12);
    qW.setFromEuler(eW.set(0, -a, 0.28 * (i % 2 ? 1 : -1), 'YXZ'));
    s.quaternion.copy(qInv).multiply(qW);
    ring.add(s);
  }
  g.add(crystalGlowSprite(color, 3.2, { intensity: 0.3 }));
  g.userData = { c, ring };
  return g;
}

// Training yard furniture: straw target on an easel, weapon rack
export function strawTarget() {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) stick(new THREE.Vector3(sx * 0.55, 0, 0.3), new THREE.Vector3(sx * 0.2, 2.0, -0.05), 0.05, MAT.timber, g);
  stick(new THREE.Vector3(0, 0, -0.7), new THREE.Vector3(0, 1.8, -0.1), 0.05, MAT.timber, g);
  const tg = new THREE.Group(); tg.position.set(0, 1.35, 0.06); tg.rotation.x = -0.12; g.add(tg);
  mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.22, 16), MAT.straw, 0, 0, 0, tg, { rx: Math.PI / 2 });
  for (const [r, c] of [[0.5, 0xc0473a], [0.34, 0xf0e6d2], [0.18, 0xc0473a]]) mesh(tinted(new THREE.RingGeometry(r - 0.07, r, 16), c), MAT.paintDS, 0, 0, 0.115, tg);
  return g;
}
export function weaponRack(rnd = Math.random) {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) box(0.12, 1.4, 0.12, MAT.timber, sx * 0.9, 0.7, 0, g);
  box(2.0, 0.1, 0.14, MAT.timber, 0, 1.25, 0, g);
  box(2.0, 0.1, 0.3, MAT.timber, 0, 0.12, 0.05, g);
  for (let i = 0; i < 5; i++) {
    const x = -0.7 + i * 0.35;
    stick(new THREE.Vector3(x, 0.15, 0.12), new THREE.Vector3(x + (rnd() - 0.5) * 0.1, 1.75, -0.02), 0.03, MAT.timber, g);
    if (i % 2 === 0) pball(0.07, 0xb894ff, x, 1.8, -0.02, g, { detail: 0 });
  }
  return g;
}

// Ruined arch: segmented columns with bases, a lintel (sometimes fallen), moss
export function ruinArch(rnd = Math.random) {
  const g = new THREE.Group();
  const mat = rnd() < 0.5 ? MAT.ruin : MAT.ruinMoss;
  let minH = 99;
  const pillars = [];
  for (const sx of [-1, 1]) {
    const h = 5 + rnd() * 2;
    minH = Math.min(minH, h);
    pillars.push([sx * 2.2, h + 0.45]);
    box(1.35, 0.45, 1.35, MAT.stoneDark, sx * 2.2, 0.2, 0, g);
    const drums = Math.ceil(h / 1.2);
    for (let k = 0; k < drums; k++) {
      const dh = Math.min(1.2, h - k * 1.2) - 0.05;
      if (dh < 0.1) break;
      cyl(0.5 - k * 0.01, 0.56 - k * 0.01, dh, 8, k % 3 === 2 ? MAT.ruinMoss : mat, sx * 2.2 + (rnd() - 0.5) * 0.05, 0.45 + k * 1.2 + dh / 2, 0, g, { ry: rnd() });
    }
    pball(0.45, 0x5f8a3c, sx * 2.2, 0.5, 0.45, g, { detail: 1, sy: 0.5, a: 1, cast: false });
  }
  if (rnd() < 0.6) {
    box(5.8, 0.7, 1.15, MAT.ruinMoss, 0, minH + 0.35 + 0.45, 0, g, { rz: (rnd() - 0.5) * 0.12 });
    for (let i = 0; i < 3; i++) pball(0.3, 0x5a8238, -1.8 + i * 1.8, minH + 1.25, 0, g, { sy: 0.35, a: 1, cast: false });
  } else {
    // fallen lintel beside the columns
    const fl = box(5.4, 0.7, 1.1, MAT.ruinMoss, 0.6, 0.35, 1.6, g, { ry: 0.3 });
    fl.rotation.z = 0.12;
  }
  g.userData.pillars = pillars;
  return g;
}

export function pillarBroken(h = 3, rnd = Math.random) {
  const g = new THREE.Group();
  box(1.45, 0.45, 1.45, MAT.stoneDark, 0, 0.2, 0, g);
  const tilt = (rnd() - 0.5) * 0.1;
  const pg = new THREE.Group(); pg.position.y = 0.42; pg.rotation.z = tilt; g.add(pg);
  const drums = Math.ceil(h / 1.2);
  for (let k = 0; k < drums; k++) {
    const dh = Math.min(1.2, h - k * 1.2) - 0.05;
    if (dh < 0.1) break;
    cyl(0.52, 0.58, dh, 8, rnd() < 0.5 ? MAT.ruin : MAT.ruinMoss, 0, k * 1.2 + dh / 2, 0, pg, { ry: rnd() });
  }
  const jag = mesh(new THREE.DodecahedronGeometry(0.45, 0), MAT.ruin, 0, h - 0.05, 0, pg);
  jag.scale.set(1.1, 0.45, 1.1); jag.rotation.set(rnd(), rnd() * 3, rnd() * 0.4);
  const ch = mesh(new THREE.DodecahedronGeometry(0.4, 0), MAT.ruin, 0.9 + rnd() * 0.5, 0.25, (rnd() - 0.5) * 1.2, g);
  ch.rotation.set(rnd() * 3, rnd() * 3, 0);
  pball(0.4, 0x5f8a3c, 0.4, 0.45, 0.3, g, { detail: 1, sy: 0.4, a: 1, cast: false });
  return g;
}

// ------------------------------------------------------------------
// The Hush Rift gate: a ring of leaning monoliths veined with crystal, and a
// massive broken stone arch framing an elliptical portal. The portal is a
// shader disc (soft elliptical edge) inside a carved rim.
export function riftGate() {
  const g = new THREE.Group();
  const rnd = mulberry32(777);
  const veinMat = crystalMaterial({ color: 0x6a4a9a, glow: 0xa070ff, intensity: 1.4, seed: 9 });
  const shard = (h, w) => {
    const geo = new THREE.CylinderGeometry(0.15, 1, 1, 5, 3);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + 0.5;
      const k = 1 + Math.sin(y * 9 + p.getX(i) * 3) * 0.06;
      p.setX(i, p.getX(i) * k + y * y * 0.18); p.setZ(i, p.getZ(i) * k);
    }
    geo.computeVertexNormals();
    geo.scale(w, h, w * 0.8);
    geo.translate(0, h / 2, 0);
    return geo;
  };
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const h = 7 + rnd() * 9, w = 1.2 + rnd() * 0.9;
    const c = new THREE.Mesh(shard(h * 1.9, w), MAT.hushRock);
    // keep the historical Octahedron-like footprint: collider is added in world.js from these
    c.userData.monolith = true;
    c.position.set(Math.cos(a) * (26 + rnd() * 4), -h * 0.9 + h * 0.5, Math.sin(a) * (26 + rnd() * 4));
    c.position.y = -1;
    c.rotation.set((rnd() - 0.5) * 0.35, rnd() * 3, (rnd() - 0.5) * 0.35);
    c.castShadow = true; c.receiveShadow = true; g.add(c);
    const vein = new THREE.Mesh(crystalGeometry('cluster', { seed: 300 + i, count: 5 }), veinMat);
    vein.scale.setScalar(0.55); vein.rotation.set(Math.PI + (rnd() - 0.5) * 0.6, rnd() * 3, 0);
    vein.position.copy(c.position); vein.position.y = h * 0.8; g.add(vein);
    // rubble at the foot
    for (let k = 0; k < 3; k++) {
      const r = mesh(new THREE.DodecahedronGeometry(0.5 + rnd() * 0.6, 0), MAT.hushRock, c.position.x + (rnd() - 0.5) * 3, 0.1, c.position.z + (rnd() - 0.5) * 3, g);
      r.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    }
  }
  // gate arch: two massive leaning monoliths carrying a lintel broken in the middle
  const gz = -14;
  const block = (hgt, rb, rt, seed) => {
    const geo = new THREE.CylinderGeometry(rt, rb, hgt, 6, 6);
    const p = geo.attributes.position, r2 = mulberry32(seed);
    const off = [];
    for (let k = 0; k <= 6; k++) off.push([(r2() - 0.5) * 0.25, (r2() - 0.5) * 0.25, 1 + (r2() - 0.5) * 0.12]);
    for (let i = 0; i < p.count; i++) {
      const k = Math.round((p.getY(i) / hgt + 0.5) * 6);
      p.setX(i, p.getX(i) * off[k][2] + off[k][0]); p.setZ(i, p.getZ(i) * off[k][2] + off[k][1]);
    }
    geo.computeVertexNormals();
    geo.translate(0, hgt / 2, 0);
    return geo;
  };
  const PH = 16.5;
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(block(PH, 1.9, 1.3, 50 + sx), MAT.hushRock);
    p.userData.monolith = true;
    p.position.set(sx * 6.8, -0.6, gz); p.rotation.set(0, sx * 0.4, sx * 0.07); p.castShadow = true; p.receiveShadow = true; g.add(p);
    // stepped plinth
    box(4.6, 1.2, 4.6, MAT.hushRock, sx * 6.8, 0.2, gz, g, { ry: 0.2 * sx });
    box(3.6, 0.8, 3.6, MAT.stoneDark, sx * 6.8, 1.0, gz, g, { ry: -0.15 * sx });
    // capital block
    box(3.4, 1.0, 3.0, MAT.hushRock, sx * 5.75, PH - 0.3, gz, g, { rz: sx * 0.07 });
    // crystal growth climbing the pillar
    const v = new THREE.Mesh(crystalGeometry('cluster', { seed: 400 + sx, count: 6 }), veinMat);
    v.scale.setScalar(0.75); v.position.set(sx * 5.4, 4 + (sx > 0 ? 3 : 0), gz + 1.2); v.rotation.set(0.3, 0, sx * 0.8); g.add(v);
    const v2 = new THREE.Mesh(crystalGeometry('cluster', { seed: 410 + sx, count: 4 }), veinMat);
    v2.scale.setScalar(0.5); v2.position.set(sx * 7.6, 1.6, gz - 1.6); v2.rotation.set(-0.4, 1, -sx * 0.5); g.add(v2);
  }
  // lintel halves resting on the capitals, inner ends sagging into the break
  for (const sx of [-1, 1]) box(7.0, 1.7, 2.6, MAT.hushRock, sx * 3.9, PH + 0.9 - (sx > 0 ? 0.3 : 0), gz, g, { rz: sx * 0.12 });
  // stones hanging silently in the gap above the portal
  for (let i = 0; i < 6; i++) {
    const f = mesh(new THREE.DodecahedronGeometry(0.35 + rnd() * 0.4, 0), MAT.hushRock, (rnd() - 0.5) * 2.2, PH - 0.4 - i * 0.55 + rnd() * 0.3, gz + (rnd() - 0.5) * 1.2, g);
    f.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
  }
  // portal rim: wedge-shaped voussoirs around the ellipse
  const RX = 4.2, RY = 6.4, cy = 7.6;
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * TAU;
    const x = Math.cos(a) * (RX + 0.55), y = cy + Math.sin(a) * (RY + 0.55);
    if (y < 0.6) continue;
    const tang = Math.atan2(Math.cos(a) * RY, -Math.sin(a) * RX);
    box(1.05, 1.1, 1.5, i % 3 ? MAT.hushRock : MAT.stoneDark, x, y, gz, g, { rz: tang });
  }
  const portalMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uAlpha: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; uniform float uAlpha; varying vec2 vUv;
      void main(){ vec2 p = vUv * 2.0 - 1.0; float r = length(p); float a = atan(p.y, p.x);
        float sw = sin(a * 5.0 + r * 12.0 - uTime * 2.5) * 0.5 + 0.5;
        float sw2 = sin(a * 3.0 - r * 7.0 + uTime * 1.3) * 0.5 + 0.5;
        float m = smoothstep(1.0, 0.9, r);
        vec3 col = mix(vec3(0.04, 0.02, 0.09), vec3(0.8, 0.5, 1.6), sw * smoothstep(0.05, 0.95, r));
        col += vec3(0.5, 0.3, 1.0) * sw2 * smoothstep(0.5, 0.0, r) * 0.35;
        col += vec3(1.2, 0.9, 2.0) * smoothstep(0.99, 0.9, r) * smoothstep(0.78, 0.92, r);
        gl_FragColor = vec4(col, m * uAlpha); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RY * 2), portalMat);
  portal.position.set(0, cy, gz); g.add(portal);
  // a few broken stones drifting around the gate
  for (let i = 0; i < 5; i++) {
    const a = rnd() * TAU, r = 9 + rnd() * 4;
    const f = mesh(new THREE.DodecahedronGeometry(0.5 + rnd() * 0.8, 0), MAT.hushRock, Math.cos(a) * r, 5 + rnd() * 10, gz + Math.sin(a) * 3, g);
    f.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
  }
  // cracked flagstones leading up to the gate
  for (let i = 0; i < 12; i++) {
    const z = gz + 4 + i * 1.3, x = (rnd() - 0.5) * 1.5;
    const s = box(1.4 + rnd() * 0.6, 0.24, 1.1, MAT.hushRock, x, 0.42 + Math.abs(z) * 0.03, z, g, { ry: (rnd() - 0.5) * 0.4 });
    s.rotation.z = (rnd() - 0.5) * 0.1;
  }
  const heartAnchor = new THREE.Object3D(); heartAnchor.position.set(0, 7, 0); g.add(heartAnchor);
  g.userData = { portal, heartAnchor };
  return g;
}

// ------------------------------------------------------------------
// The village's great tree: a thick twisted trunk on buttress roots, big
// limbs carrying a broad layered crown of soft puffs, paper lanterns on
// cords, ribbons and a low stone ring around the roots.
export function resonanceTree(makeCrown) {
  const g = new THREE.Group();
  const rnd = mulberry32(31337);
  // crown + trunk geometry comes from the vegetation generator (soft puffs)
  if (makeCrown) {
    const t = makeCrown();
    g.add(t);
  }
  // stone ring & bench seat around the roots
  const R = 3.3;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    box(1.2, 0.5, 0.55, MAT.stone, Math.cos(a) * R, 0.2, Math.sin(a) * R, g, { ry: -a + Math.PI / 2 });
  }
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + 0.2;
    pball(0.3, [0x5c9a42, 0x4f8a3a][i % 2], Math.cos(a) * (R - 0.7), 0.1, Math.sin(a) * (R - 0.7), g, { sy: 0.6, a: 1, cast: false });
    pball(0.07, 0xf4f0e8, Math.cos(a) * (R - 0.7), 0.3, Math.sin(a) * (R - 0.7), g, { cast: false });
  }
  // hanging lanterns: cord from a limb + paper lantern body (glow)
  const lanterns = [];
  const cordMat = MAT.timber;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + rnd() * 0.4, r = 2.6 + rnd() * 3.2;
    const y = 5.0 + rnd() * 1.6;
    const top = 7.4 + rnd() * 1.2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), glowMat(0xffc870, 2.5, { nocache: true }));
    l.scale.set(1, 1.2, 1);
    l.position.set(Math.cos(a) * r, y, Math.sin(a) * r); g.add(l); lanterns.push(l);
    cyl(0.012, 0.012, top - y, 3, cordMat, l.position.x, (top + y) / 2 + 0.15, l.position.z, g, { cast: false });
  }
  // ribbons tied to low limbs
  const ribbonCols = [0xd8503e, 0xf0c050, 0x4f7ab8, 0xf2ece0];
  for (let i = 0; i < 8; i++) {
    const a = rnd() * TAU, r = 1.8 + rnd() * 1.5;
    const rg = tinted(new THREE.PlaneGeometry(0.1, 1.0 + rnd() * 0.6), ribbonCols[i % 4]);
    mesh(rg, MAT.paintDS, Math.cos(a) * r, 5.2 + rnd() * 0.5, Math.sin(a) * r, g, { ry: rnd() * 3, cast: false });
  }
  g.userData = { lanterns };
  return g;
}
