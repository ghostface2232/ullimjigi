// Non-humanoid sculpted creatures: shared rig base (skinned instance, root
// motion, LOD, springs, secondary chains) plus Boreum the wind fox and the cat.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { fresnelMat } from '../render/materials.js';
import { damp, clamp, rand } from '../core/util.js';
import { SkelDef, Sculpt, Part, tube, blob, sheet, sstep, mix, TAU, instance, bodyMat, Chain, Spring } from './charkit.js';
import { Rig } from './humanrig.js';
import { model } from '../render/models.js';

const V3 = THREE.Vector3;
const v = (x, y, z) => new V3(x, y, z);
const _v1 = new V3(), _v2 = new V3(), _v3 = new V3();
const wrapA = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

// ---------------------------------------------------------------------------
// Type cache: build(key) -> { def, built, chains?, extra? } once per key.
const TYPES = new Map();
let curKey = null;
export function creatureType(key, build) {
  let T = TYPES.get(key);
  if (!T) { const t0 = performance.now(); curKey = key; T = build(); curKey = null; T.ms = performance.now() - t0; TYPES.set(key, T); }
  return T;
}
// Authored model of a type: public/models/mn_<key>.glb, modelled, sculpted and baked in Blender
// on this skeleton (ref/blender/README.md), in the shape Sculpt.build() returns. Its skin is
// rebound to `def` by bone name. `tex`: albedo (alpha = 1 - glow mask), tangent-space normal
// map and ORM (occlusion, roughness, metal). `rigid[name]`: unskinned pieces (weapons, loose
// stones) as { geo, bone, pos (offset from that bone), group }. o.skip: material groups to
// leave out (variant-only parts); o.file: model shared with another type.
export function builtFromModel(key, def, o = {}) {
  const g = model('mn_' + (o.file || key)), meshes = [], loose = [];
  if (g) g.scene.traverse((m) => { if (m.isMesh) (m.userData.bone !== undefined ? loose : meshes).push(m); });
  if (!meshes.length || !g.scene.userData.quant) return null;
  const Q = g.scene.userData.quant, skip = o.skip || [];
  const groupOf = (m) => m.material.name.split('_').pop();
  const read = (m, org) => {
    const a = m.geometry.attributes, n = a.position.count, ix = m.geometry.index;
    const d = { n, C: null, P: new Float32Array(n * 3), N: new Float32Array(n * 3), UV: new Float32Array(n * 2), TG: new Float32Array(n * 4), OL: new Float32Array(n), I: ix.array, SI: null, SW: null };
    const jm = m.skeleton ? m.skeleton.bones.map((b) => def.map[b.name] ?? 0) : null;
    if (jm) { d.SI = new Uint16Array(n * 4); d.SW = new Float32Array(n * 4); }
    for (let k = 0; k < n; k++) {
      d.P[k * 3] = a.position.getX(k) * Q.scale + Q.offset[0] - org.x; d.P[k * 3 + 1] = a.position.getY(k) * Q.scale + Q.offset[1] - org.y; d.P[k * 3 + 2] = a.position.getZ(k) * Q.scale + Q.offset[2] - org.z;
      _v1.set(a.normal.getX(k), a.normal.getY(k), a.normal.getZ(k));
      if (_v1.lengthSq() < 0.25) _v1.set(0, 1, 0);
      _v1.normalize().toArray(d.N, k * 3);
      d.UV[k * 2] = a.uv.getX(k); d.UV[k * 2 + 1] = a.uv.getY(k);
      if (a.tangent) {
        // a degenerate UV triangle has no tangent: any vector across the normal will do (a zero one turns into NaN pixels)
        _v2.set(a.tangent.getX(k), a.tangent.getY(k), a.tangent.getZ(k));
        if (_v2.lengthSq() < 0.25) _v2.set(Math.abs(_v1.y) < 0.9 ? 0 : 1, Math.abs(_v1.y) < 0.9 ? 1 : 0, 0).cross(_v1);
        _v2.normalize().toArray(d.TG, k * 4); d.TG[k * 4 + 3] = a.tangent.getW(k) < 0 ? -1 : 1;
      }
      d.OL[k] = a.color ? a.color.getW(k) : 1;
      if (a.color) { if (!d.C) d.C = new Float32Array(n * 3).fill(1); d.C[k * 3] = a.color.getX(k); d.C[k * 3 + 1] = a.color.getY(k); d.C[k * 3 + 2] = a.color.getZ(k); }
      if (jm) { let ws = 0; for (let c = 0; c < 4; c++) { d.SI[k * 4 + c] = jm[a.skinIndex.getComponent(k, c)]; ws += d.SW[k * 4 + c] = a.skinWeight.getComponent(k, c); } for (let c = 0; c < 4; c++) d.SW[k * 4 + c] /= ws || 1; }
    }
    return d;
  };
  const toGeo = (parts, skinned) => {
    let nv = 0, ni = 0;
    for (const d of parts) { nv += d.n; ni += d.I.length; }
    const geo = new THREE.BufferGeometry(), I = new Uint32Array(ni), cat = (k, C, sz) => { const A = new C(nv * sz); let o2 = 0; for (const d of parts) { A.set(d[k], o2); o2 += d.n * sz; } return A; };
    let vo = 0, io = 0;
    parts.forEach((d, i) => { for (let k = 0; k < d.I.length; k++) I[io + k] = d.I[k] + vo; geo.addGroup(io, d.I.length, i); vo += d.n; io += d.I.length; });
    geo.setAttribute('position', new THREE.BufferAttribute(cat('P', Float32Array, 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(cat('N', Float32Array, 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(cat('UV', Float32Array, 2), 2));
    geo.setAttribute('tangent', new THREE.BufferAttribute(cat('TG', Float32Array, 4), 4));
    const C = new Float32Array(nv * 3).fill(1); { let o2 = 0; for (const d of parts) { if (d.C) C.set(d.C, o2); o2 += d.n * 3; } }
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
    geo.setAttribute('olw', new THREE.BufferAttribute(cat('OL', Float32Array, 1), 1));
    if (skinned) { geo.setAttribute('skinIndex', new THREE.BufferAttribute(cat('SI', Uint16Array, 4), 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(cat('SW', Float32Array, 4), 4)); }
    geo.setIndex(new THREE.BufferAttribute(I, 1));
    geo.computeBoundingSphere();
    return geo;
  };
  const used = meshes.filter((m) => !skip.includes(groupOf(m))), m0 = meshes[0].material, zero = new V3();
  const geo = toGeo(used.map((m) => read(m, zero)), true);
  const tex = { map: m0.map, normalMap: m0.normalMap, orm: m0.roughnessMap, key: o.file || key };
  const rigid = {};
  for (const m of loose) {
    const grp = m.userData.group || groupOf(m);
    if (skip.includes(grp)) continue;
    const gg = toGeo([read(m, m.position)], false); gg.clearGroups();
    rigid[m.userData.id || m.name] = { geo: gg, bone: m.userData.bone, pos: m.position.clone().sub(def.pos(m.userData.bone)), group: grp };
  }
  return { geo, mats: used.map(groupOf), tris: geo.index.count / 3, stats: {}, tex, rigid };
}
// Variant albedo of an authored model (public/models/mn_<key>_<variant>.webp): same mesh,
// normal map and ORM, repainted colours. Fetched once, when the variant is first dressed.
const ALT = new Map();
function altMap(key, variant) {
  const id = key + '_' + variant;
  if (!ALT.has(id)) { const t = new THREE.TextureLoader().load(`./models/mn_${id}.webp`); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; ALT.set(id, t); }
  return ALT.get(id);
}
// Surface response of an authored model on a toon material: the baked maps drive the detail
// layer hooks of the toon shader (_rough / _specK / _cav), the light ramp becomes a soft
// half-lambert so the sculpt reads, smooth and metallic texels mirror the sky, and the
// albedo's alpha is a glow mask lit with `glow` (a Color shared with the tier-coloured glow
// material). o: { spec (highlight strength), metal (extra on metallic texels), ao, glowK, bump }
export function surfaced(m, tex, o = {}) {
  m.map = tex.map; m.normalMap = tex.normalMap;
  m.normalScale.set(o.bump ?? 1, o.bump ?? 1);
  for (const t of [tex.map, tex.normalMap, tex.orm]) if (t) t.anisotropy = 4;
  const u = { uOrm: { value: tex.orm }, uSurfP: { value: new THREE.Vector4(o.spec ?? 0.6, o.metal ?? 3, o.ao ?? 0.4, o.glowK ?? 1) }, uGlowC: { value: o.glow || new THREE.Color(0, 0, 0) } };
  m.userData.surf = u;
  return extendMat(m, 'surfaced', u, (sh) => {
    sh.fragmentShader = 'uniform sampler2D uOrm;\nuniform vec4 uSurfP;\nuniform vec3 uGlowC;\n' + sh.fragmentShader
      .replace('float g = texture2D( gradientMap, vec2( clamp( ndl * 0.5 + 0.5, 0.0, 1.0 ), 0.5 ) ).r;', 'float g = smoothstep( -0.3, 0.7, ndl );')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  vec4 _mo = texture2D( uOrm, vMapUv );
  float _mGlow = 1.0 - texture2D( map, vMapUv ).a;
  _rough = clamp( _mo.g, 0.06, 1.0 ); _cav = mix( 1.0, _mo.r, uSurfP.z ); _specK = uSurfP.x * ( 1.0 + _mo.b * uSurfP.y );
  diffuseColor.rgb *= 1.0 - 0.5 * _mo.b;`)
      .replace('#include <opaque_fragment>', `{
  vec3 _sv = normalize( vViewPosition );
  float _fr = pow( 1.0 - clamp( dot( normal, _sv ), 0.0, 1.0 ), 5.0 ), _gl = 1.0 - _rough;
  outgoingLight += uSkyRefl * ( ( 0.04 + 0.96 * _fr ) * _gl * _gl * _cav * _specK * ( 0.4 + 1.1 * _mo.b ) );
  outgoingLight = mix( outgoingLight, uGlowC * uSurfP.w, _mGlow );
}
#include <opaque_fragment>`);
  });
}
// give a rig's toon materials the baked maps of its authored model (if it has one).
// o: { variant (albedo of that name), glow (Color for the glow mask), mat: { group: surfaced() options } }
export function dress(rig, o = {}) {
  const tx = rig.T.built.tex;
  if (!tx) return rig;
  const tex = o.variant ? { ...tx, map: altMap(tx.key, o.variant) } : tx;
  const glow = o.glow || (rig.glowMats && rig.glowMats[0] && rig.glowMats[0].color);
  for (const k in rig.M) { const m = rig.M[k]; if (m && m.isMeshToonMaterial && !m.userData.surf) surfaced(m, tex, { glow, ...(o.mat && o.mat[k]) }); }
  return rig;
}
// meshes of the model's unskinned pieces, parented to their bones: rigids(rig, { group: material })
export function rigids(rig, mats) {
  const out = {}, R = rig.T.built.rigid || {};
  for (const name in R) {
    const r = R[name], m = new THREE.Mesh(r.geo, mats[r.group] || mats.main);
    m.position.copy(r.pos); m.castShadow = true; m.name = name;
    rig.B[r.bone].add(m); out[name] = m;
  }
  return out;
}
// Sculpt helper: build a skeleton + parts, then bake per-group geometry.
// parts(S, def) adds sculpt parts; color: key -> hex; group: key -> group name.
// parts may return shade() options ({ fields, fn, ao, aoR }) to paint the baked vertex colors.
// mo: builtFromModel() options (a model shared between types, groups to leave out).
export function bakeType(def, parts, color, group, mo) {
  def.finalize();
  const key = curKey; curKey = null;
  const authored = key && builtFromModel(key, def, mo);
  if (authored) return authored;
  const S = new Sculpt(def);
  const post = parts(S, def);
  const groupOf = (k) => group[k] ?? 'main';
  const built = S.build({ color: (k) => color[k] ?? 0xff00ff, group: groupOf });
  if (post) shade(S, built.geo, groupOf, post);
  return built;
}
// Vertex-colored rigid geometry (no skinning): props, armor stones, weapons.
// build(S) adds parts bound to 'r' and may return shade() options.
export function rigidType(build, colors) {
  const d0 = new SkelDef(); d0.add('r', null, 0, 0, 0, [0, 1, 0]);
  const g = bakeType(d0, build, colors, {}).geo;
  g.deleteAttribute('skinIndex'); g.deleteAttribute('skinWeight'); g.clearGroups();
  return g;
}
// Vertex-colored basic glow material (tier color multiplies the vertex colors).
export function glowBasic(color, k = 2.6, o = {}) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), vertexColors: o.vertexColors ?? true, transparent: !!o.transparent, opacity: o.opacity ?? 1, depthWrite: o.depthWrite ?? true, side: o.side ?? THREE.FrontSide });
  m.userData.dissolve = { value: 0 };   // marker: hidden mid-dissolve by enemies.js
  return m;
}

// Same color object as `glow` (follows tier recolors) for meshes without vertex colors.
export function glowTwin(glow) {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff });
  m.color = glow.color;
  m.userData.dissolve = { value: 0 };
  return m;
}

// ---------------------------------------------------------------------------
// Signed-distance sculpting. Primitives (round cones, ellipsoids, rounded boxes)
// blend into one continuous surface, so trunks, limbs and heads have no seams;
// `sub` primitives carve sockets and fissures. Meshed with surface nets and
// skinned from the bones of the nearest primitives.
const BS = 4;
function primD(P, x, y, z) {
  if (P.t === 0) {
    let px = x - P.ax, py = y - P.ay, pz = z - P.az;
    if (P.f) { const s = (px * P.nx + py * P.ny + pz * P.nz) * P.f; px += P.nx * s; py += P.ny * s; pz += P.nz * s; }
    const yy = px * P.bx + py * P.by + pz * P.bz, zz = yy - P.l2;
    const qx = px * P.l2 - P.bx * yy, qy = py * P.l2 - P.by * yy, qz = pz * P.l2 - P.bz * yy;
    const x2 = qx * qx + qy * qy + qz * qz, y2 = yy * yy * P.l2, z2 = zz * zz * P.l2;
    const k = Math.sign(P.rr) * P.rr * P.rr * x2;
    if (Math.sign(zz) * P.a2 * z2 > k) return (Math.sqrt(x2 + z2) * P.il2 - P.r2) * P.s;
    if (Math.sign(yy) * P.a2 * y2 < k) return (Math.sqrt(x2 + y2) * P.il2 - P.r1) * P.s;
    return ((Math.sqrt(x2 * P.a2 * P.il2) + yy * P.rr) * P.il2 - P.r1) * P.s;
  }
  let qx = x - P.cx, qy = y - P.cy, qz = z - P.cz;
  const m = P.m;
  if (m) { const X = qx * m[0] + qy * m[1] + qz * m[2], Y = qx * m[3] + qy * m[4] + qz * m[5]; qz = qx * m[6] + qy * m[7] + qz * m[8]; qx = X; qy = Y; }
  if (P.t === 1) {
    const k0 = Math.hypot(qx / P.rx, qy / P.ry, qz / P.rz), k1 = Math.hypot(qx / (P.rx * P.rx), qy / (P.ry * P.ry), qz / (P.rz * P.rz));
    return k1 < 1e-9 ? -P.rmin : (k0 * (k0 - 1)) / k1;
  }
  const dx = Math.abs(qx) - P.rx, dy = Math.abs(qy) - P.ry, dz = Math.abs(qz) - P.rz;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dy, dz), 0) - P.rd;
}
const _fm = new THREE.Matrix4(), _fq = new THREE.Quaternion(), _fe = new THREE.Euler(), _fy = new V3(0, 1, 0), _fp = new V3();
// o.rot: [x, y, z] euler, or o.y: V3 the local +Y axis points along
function frameOf(o) {
  if (!o.rot && !o.y) return null;
  if (o.rot) _fq.setFromEuler(_fe.set(o.rot[0], o.rot[1], o.rot[2])); else _fq.setFromUnitVectors(_fy, _fp.copy(o.y).normalize());
  const e = _fm.makeRotationFromQuaternion(_fq).elements;
  return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]];
}
export class Field {
  constructor(S) { this.S = S; this.prims = []; this.kMax = 0; this.disp = null; this.dispAmp = 0; this.iso = 0; this.w = null; this.k = 0.03; this.g = null; }
  // defaults for the primitives that follow: skin weights (Sculpt.weigher spec) and blend radius
  bind(w, k) { this.w = this.S.weigher(w); if (k !== undefined) this.k = k; return this; }
  _add(P, o, r) {
    P.k = Math.max(o.k ?? this.k, 1e-4); P.sub = !!o.sub; P.w = o.w ? this.S.weigher(o.w) : this.w;
    P.bb = [P.cx - r, P.cy - r, P.cz - r, P.cx + r, P.cy + r, P.cz + r];
    this.kMax = Math.max(this.kMax, P.k); this.prims.push(P); return this;
  }
  // round cone a -> b (radii r1, r2). o: { w, k, sub, flat: [axis V3, factor] (squash < 1 / widen > 1 along axis) }
  cone(a, b, r1, r2 = r1, o = {}) {
    let bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z;
    if (bx * bx + by * by + bz * bz < 1e-8) by = 1e-3;
    const l2 = bx * bx + by * by + bz * bz, L = Math.sqrt(l2);
    let rr = r1 - r2; if (Math.abs(rr) > L * 0.98) { r2 = r1 - Math.sign(rr) * L * 0.98; rr = r1 - r2; }
    const P = { t: 0, ax: a.x, ay: a.y, az: a.z, bx, by, bz, l2, rr, a2: l2 - rr * rr, il2: 1 / l2, r1, r2, s: 1, f: 0, cx: a.x + bx / 2, cy: a.y + by / 2, cz: a.z + bz / 2 };
    let pad = 1;
    if (o.flat) { const n = _fp.copy(o.flat[0]).normalize(), f = o.flat[1]; P.nx = n.x; P.ny = n.y; P.nz = n.z; P.f = 1 / f - 1; P.s = Math.min(1, f); pad = Math.max(1, f); }
    this._add(P, o, 0);
    const R = Math.max(r1, r2) * pad;
    P.bb = [Math.min(a.x, b.x) - R, Math.min(a.y, b.y) - R, Math.min(a.z, b.z) - R, Math.max(a.x, b.x) + R, Math.max(a.y, b.y) + R, Math.max(a.z, b.z) + R];
    return this;
  }
  limb(pts, rad, o = {}) { for (let i = 0; i < pts.length - 1; i++) this.cone(pts[i], pts[i + 1], rad[i], rad[i + 1], o); return this; }
  ell(c, r, o = {}) { return this._add({ t: 1, cx: c.x, cy: c.y, cz: c.z, rx: r[0], ry: r[1], rz: r[2], rmin: Math.min(r[0], r[1], r[2]), m: frameOf(o) }, o, Math.max(r[0], r[1], r[2])); }
  box(c, hsz, round, o = {}) { return this._add({ t: 2, cx: c.x, cy: c.y, cz: c.z, rx: hsz[0] - round, ry: hsz[1] - round, rz: hsz[2] - round, rd: round, m: frameOf(o) }, o, Math.hypot(hsz[0], hsz[1], hsz[2])); }
  evalL(list, x, y, z) {
    let d = 1e9;
    for (let i = 0; i < list.length; i++) {
      const P = list[i], di = primD(P, x, y, z), k = P.k;
      if (P.sub) { const h = Math.max(k - Math.abs(d + di), 0) / k; d = Math.max(d, -di) + h * h * k * 0.25; }
      else { const h = Math.max(k - Math.abs(d - di), 0) / k; d = Math.min(d, di) - h * h * k * 0.25; }
    }
    if (this.disp && d < this.dispAmp * 3 + 0.02 && d > -this.dispAmp * 3 - 0.02) d += this.disp(x, y, z);
    return d - this.iso;
  }
  // field value anywhere inside the last meshed grid (±1e9 away from the surface)
  at(x, y, z) {
    const g = this.g; if (!g) return this.evalL(this.prims, x, y, z);
    const bx = Math.floor((x - g.lo[0]) / g.bs), by = Math.floor((y - g.lo[1]) / g.bs), bz = Math.floor((z - g.lo[2]) / g.bs);
    if (bx < 0 || by < 0 || bz < 0 || bx >= g.bn[0] || by >= g.bn[1] || bz >= g.bn[2]) return 1e9;
    const b = g.blocks[bx + (by + bz * g.bn[1]) * g.bn[0]];
    return b === 1 || b === undefined ? 1e9 : b === -1 ? -1e9 : this.evalL(b, x, y, z);
  }
  // ambient occlusion at p along n (0 open .. 1 buried), probe radius r
  occl(p, n, r = 0.06) {
    let o = 0;
    for (let i = 0; i < 3; i++) { const s = r * OCC[i][0]; o += OCC[i][1] * Math.min(1, Math.max(0, (s - this.at(p.x + n.x * s, p.y + n.y * s, p.z + n.z * s)) / s)); }
    return o;
  }
  // skin weights at a point: bones of the nearby primitives, blended by closeness
  weights(list, x, y, z) {
    const acc = this._acc || (this._acc = new Float32Array(this.S.skel.b.length)), ds = this._ds || (this._ds = []);
    let dmin = 1e9, n = 0;
    for (const P of list) if (!P.sub && P.w) { const d = primD(P, x, y, z); ds[n++] = d; if (d < dmin) dmin = d; }
    acc.fill(0); n = 0; _fp.set(x, y, z);
    for (const P of list) if (!P.sub && P.w) {
      const g = Math.exp(-(ds[n++] - dmin) / Math.max(0.006, P.k * 0.4));
      if (g < 0.02) continue;
      const wl = P.w(_fp); let t = 0;
      for (const e of wl) t += e[1];
      for (const e of wl) acc[e[0]] += (g * e[1]) / t;
    }
    const out = [];
    for (let b = 0; b < acc.length; b++) if (acc[b] > 1e-4) out.push([b, acc[b]]);
    if (!out.length) out.push([0, 1]);
    return out;
  }
  // nearest surface point from p (all primitives; for seating a few details), lifted along the
  // normal; the result carries the unit normal as .n
  on(p, lift = 0) {
    const q = p.clone(), L = this.prims, e = 0.004, n = new V3(0, 1, 0);
    for (let it = 0; it < 8; it++) {
      const d = this.evalL(L, q.x, q.y, q.z);
      n.set(this.evalL(L, q.x + e, q.y, q.z) - this.evalL(L, q.x - e, q.y, q.z), this.evalL(L, q.x, q.y + e, q.z) - this.evalL(L, q.x, q.y - e, q.z), this.evalL(L, q.x, q.y, q.z + e) - this.evalL(L, q.x, q.y, q.z - e)).multiplyScalar(0.5 / e);
      const g2 = n.lengthSq(); if (g2 < 1e-8) break;
      q.addScaledVector(n, -d / g2);
    }
    n.normalize(); q.addScaledVector(n, lift); q.n = n;
    return q;
  }
  // carve a groove along surface points (pts are snapped to the surface first)
  groove(pts, r, depth, o = {}) {
    const P = pts.map((p) => this.on(p, -depth));
    for (let i = 0; i < P.length - 1; i++) this.cone(P[i], P[i + 1], Array.isArray(r) ? r[i] : r, Array.isArray(r) ? r[i + 1] : r, { k: 0.008, ...o, sub: true });
    return this;
  }
  // a second field of the same solid (no carving), shrunk by `inset`: the glowing mass seen through fissures
  core(inset) { const G = new Field(this.S); G.prims = this.prims.filter((P) => !P.sub); G.kMax = this.kMax; G.iso = -inset; return G; }
  // o: { cell (m), ol (outline weight), w (one weight spec for every vertex: rigid pieces) }
  mesh(mat, o = {}) {
    const S = this.S, h = (o.cell ?? 0.016) * (globalThis.__MN_CELL || 1), prims = this.prims;   // __MN_CELL: finer source for the offline bake
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], n = [0, 0, 0], bn = [0, 0, 0];
    for (const P of prims) if (!P.sub) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P.bb[a]); hi[a] = Math.max(hi[a], P.bb[a + 3]); }
    const pad = h * 2.5 + this.dispAmp, bs = BS * h;
    for (let a = 0; a < 3; a++) { lo[a] -= pad; bn[a] = Math.ceil((hi[a] + pad - lo[a]) / bs); n[a] = bn[a] * BS; }
    const NX = n[0] + 1, NY = n[1] + 1, NXY = NX * NY;
    const D = new Float32Array(NXY * (n[2] + 1)).fill(NaN);
    const blocks = new Array(bn[0] * bn[1] * bn[2]), act = [];
    const reach = bs * 0.866 * 1.2 + this.kMax * 0.25 + this.dispAmp + h;
    for (let bz = 0; bz < bn[2]; bz++) for (let by = 0; by < bn[1]; by++) for (let bx = 0; bx < bn[0]; bx++) {
      const x0 = lo[0] + bx * bs, y0 = lo[1] + by * bs, z0 = lo[2] + bz * bs, bi = bx + (by + bz * bn[1]) * bn[0];
      const list = []; let solid = false;
      for (const P of prims) { const m = P.k + h, b = P.bb; if (b[0] - m > x0 + bs || b[3] + m < x0 || b[1] - m > y0 + bs || b[4] + m < y0 || b[2] - m > z0 + bs || b[5] + m < z0) continue; list.push(P); if (!P.sub) solid = true; }
      if (!solid) { blocks[bi] = 1; continue; }
      const dc = this.evalL(list, x0 + bs / 2, y0 + bs / 2, z0 + bs / 2);
      if (Math.abs(dc) > reach) { blocks[bi] = dc < 0 ? -1 : 1; continue; }
      blocks[bi] = list; act.push(bx, by, bz);
      for (let k = bz * BS; k <= bz * BS + BS; k++) for (let j = by * BS; j <= by * BS + BS; j++) for (let i = bx * BS; i <= bx * BS + BS; i++) {
        const q = i + j * NX + k * NXY;
        if (D[q] !== D[q]) D[q] = this.evalL(list, lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
      }
    }
    this.g = { lo, bs, bn, blocks };
    // one vertex per surface cell
    const cellV = new Int32Array(n[0] * n[1] * n[2]).fill(-1), part = new Part(null), cells = [], dd = [0, 0, 0, 0, 0, 0, 0, 0];
    const wAll = o.w ? S.weigher(o.w) : null;
    for (let a = 0; a < act.length; a += 3) {
      const list = blocks[act[a] + (act[a + 1] + act[a + 2] * bn[1]) * bn[0]];
      for (let k = act[a + 2] * BS; k < act[a + 2] * BS + BS; k++) for (let j = act[a + 1] * BS; j < act[a + 1] * BS + BS; j++) for (let i = act[a] * BS; i < act[a] * BS + BS; i++) {
        let neg = 0;
        for (let c = 0; c < 8; c++) { const d = D[i + (c & 1) + (j + ((c >> 1) & 1)) * NX + (k + (c >> 2)) * NXY]; dd[c] = d; if (d < 0) neg++; }
        if (neg === 0 || neg === 8) continue;
        let px = 0, py = 0, pz = 0, cnt = 0;
        for (let e = 0; e < 24; e += 2) {
          const c0 = EDGE[e], c1 = EDGE[e + 1], d0 = dd[c0], d1 = dd[c1];
          if ((d0 < 0) === (d1 < 0)) continue;
          const t = d0 / (d0 - d1);
          px += (c0 & 1) + ((c1 & 1) - (c0 & 1)) * t; py += ((c0 >> 1) & 1) + (((c1 >> 1) & 1) - ((c0 >> 1) & 1)) * t; pz += (c0 >> 2) + ((c1 >> 2) - (c0 >> 2)) * t; cnt++;
        }
        let x = lo[0] + (i + px / cnt) * h, y = lo[1] + (j + py / cnt) * h, z = lo[2] + (k + pz / cnt) * h;
        // settle onto the surface (one Newton step along the lattice gradient)
        const gx = dd[1] - dd[0] + dd[3] - dd[2] + dd[5] - dd[4] + dd[7] - dd[6], gy = dd[2] - dd[0] + dd[3] - dd[1] + dd[6] - dd[4] + dd[7] - dd[5], gz = dd[4] - dd[0] + dd[5] - dd[1] + dd[6] - dd[2] + dd[7] - dd[3];
        const g2 = (gx * gx + gy * gy + gz * gz) / (16 * h * h);
        if (g2 > 1e-6) {
          let st = -this.evalL(list, x, y, z) / g2 / (4 * h); const sl = Math.abs(st) * Math.sqrt(g2) * 4 * h;
          if (sl > h * 0.7) st *= (h * 0.7) / sl;
          x += gx * st; y += gy * st; z += gz * st;
        }
        cellV[i + (j + k * n[1]) * n[0]] = part.v(x, y, z, wAll ? wAll(_fp.set(x, y, z)) : this.weights(list, x, y, z));
        cells.push(i, j, k);
      }
    }
    const P = part.p, cv = (i, j, k) => cellV[i + (j + k * n[1]) * n[0]];
    const quad = (a, b, c, d, axis, out) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[d * 3] - P[a * 3], vy = P[d * 3 + 1] - P[a * 3 + 1], vz = P[d * 3 + 2] - P[a * 3 + 2];
      const nn = axis === 0 ? uy * vz - uz * vy : axis === 1 ? uz * vx - ux * vz : ux * vy - uy * vx;
      if (nn > 0 === out) part.quad(a, b, c, d); else part.quad(a, d, c, b);
    };
    for (let q = 0; q < cells.length; q += 3) {
      const i = cells[q], j = cells[q + 1], k = cells[q + 2], d0 = D[i + j * NX + k * NXY] < 0;
      if (j > 0 && k > 0 && d0 !== D[i + 1 + j * NX + k * NXY] < 0) quad(cv(i, j, k), cv(i, j - 1, k), cv(i, j - 1, k - 1), cv(i, j, k - 1), 0, d0);
      if (i > 0 && k > 0 && d0 !== D[i + (j + 1) * NX + k * NXY] < 0) quad(cv(i, j, k), cv(i - 1, j, k), cv(i - 1, j, k - 1), cv(i, j, k - 1), 1, d0);
      if (i > 0 && j > 0 && d0 !== D[i + j * NX + (k + 1) * NXY] < 0) quad(cv(i, j, k), cv(i - 1, j, k), cv(i - 1, j - 1, k), cv(i, j - 1, k), 2, d0);
    }
    part.ol = o.ol;
    S.addPart(mat, part);
    return part;
  }
}
const OCC = [[0.4, 0.5], [1, 0.3], [2.2, 0.2]];
const EDGE = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];

// Flat-faced crystal / shard (deliberate hard edges): prism from `base` tapering to `tip`.
// o: { sides, waist (0..1 along the axis where it is widest), twist }
export function shard(S, mat, w, base, tip, r, o = {}) {
  const part = new Part(S.weigher(w)), n = o.sides ?? 6, wy = o.waist ?? 0.3;
  const ax = tip.clone().sub(base), L = ax.length(); ax.normalize();
  const u = new V3(1, 0, 0).addScaledVector(ax, -ax.x); if (u.lengthSq() < 0.01) u.set(0, 0, 1).addScaledVector(ax, -ax.z); u.normalize();
  const vv = new V3().crossVectors(ax, u), mid = base.clone().addScaledVector(ax, L * wy);
  const ring = (c, rr, k) => { const a = (k / n) * TAU + (o.twist ?? 0); return [c.x + (u.x * Math.cos(a) + vv.x * Math.sin(a)) * rr, c.y + (u.y * Math.cos(a) + vv.y * Math.sin(a)) * rr, c.z + (u.z * Math.cos(a) + vv.z * Math.sin(a)) * rr]; };
  for (let k = 0; k < n; k++) {
    const b0 = ring(base, r * 0.7, k), b1 = ring(base, r * 0.7, k + 1), m0 = ring(mid, r * (1 + 0.25 * ((k * 7) % 3 - 1) * (o.rough ?? 0.4)), k), m1 = ring(mid, r * (1 + 0.25 * (((k + 1) % n * 7) % 3 - 1) * (o.rough ?? 0.4)), k + 1);
    part.quad(part.v(...b0), part.v(...b1), part.v(...m1), part.v(...m0));
    part.tri(part.v(...m0), part.v(...m1), part.v(tip.x, tip.y, tip.z));
  }
  part.orient(() => mid);
  part.ol = o.ol;
  S.addPart(mat, part);
}

// curved spike (horn, claw, thorn, tooth) from p0 along dir, hooking towards o.bend
export function spike(S, mat, w, p0, dir, len, r, o = {}) {
  const d = dir.clone().normalize(), b = o.bend || v(0, 0, 0);
  const pts = [p0.clone().addScaledVector(d, -r * 0.7), p0.clone().addScaledVector(d, len * 0.33).addScaledVector(b, len * 0.08), p0.clone().addScaledVector(d, len * 0.68).addScaledVector(b, len * 0.38), p0.clone().addScaledVector(d, len).addScaledVector(b, len)];
  tube(S, mat, w, { pts, seg: o.seg ?? 8, steps: o.steps ?? 9, ref: o.ref, ol: o.ol, cap1: 1, capN: 2, r: (u) => { const rr = r * Math.pow(1 - u, o.taper ?? 0.75) * (1 + (o.ridge ?? 0) * Math.sin(u * (o.rings ?? 34))) + 0.0012; return [rr, rr * (o.flat ?? 1)]; } });
  return pts[3];
}
// hanging strip of torn cloth between a and b (top edge), `len` long, with a ragged hem
export function tatter(S, mat, w, a, b, len, o = {}) {
  const out = o.out || v(0, 0, 1), sd = o.seed ?? 1, n = o.rags ?? 3;
  sheet(S, mat, w, {
    nu: o.nu ?? 8, nv: o.nv ?? 6, thick: 0.009, top: true, innerMat: o.inner, ol: o.ol,
    fn: (u, vv, q) => {
      const tri = Math.abs(((u * n + sd * 0.37) % 1) - 0.5) * 2, l = len * (1 - (o.rag ?? 0.4) * tri * tri);
      const pinch = 1 - (o.taper ?? 0.25) * vv;
      q.lerpVectors(a, b, 0.5 + (u - 0.5) * pinch);
      q.y -= vv * l;
      q.addScaledVector(out, vv * (o.flare ?? 0.03) + Math.sin(u * 8 + vv * 4 + sd) * 0.012 * vv);
    },
    inside: (p) => p.clone().addScaledVector(out, -1),
  });
}
// flat-sided loft through rings of points (blades, flanges, gems): smooth along its length,
// crisp across its edges
export function prism(S, mat, w, rings, o = {}) {
  const wf = S.weigher(w), n = rings[0].length, mid = new V3();
  for (const R of rings) for (const p of R) mid.add(p);
  mid.multiplyScalar(1 / (n * rings.length));
  const done = (part) => { part.orient(() => mid); part.ol = o.ol; S.addPart(mat, part); };
  const side = new Part(wf);
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n; let pa = null, pb = null;
    for (const R of rings) { const a = side.v(R[k].x, R[k].y, R[k].z), b = side.v(R[k2].x, R[k2].y, R[k2].z); if (pa !== null) side.quad(pa, pb, b, a); pa = a; pb = b; }
  }
  done(side);
  for (const R of [rings[0], rings[rings.length - 1]]) {
    const cap = new Part(wf), c = new V3(); for (const p of R) c.add(p); c.multiplyScalar(1 / n);
    const ci = cap.v(c.x, c.y, c.z), vi = R.map((p) => cap.v(p.x, p.y, p.z));
    for (let k = 0; k < n; k++) cap.tri(ci, vi[k], vi[(k + 1) % n]);
    done(cap);
  }
}

// One megalith: a superellipsoid block (flat faces, soft edges; n = squareness), optionally
// tapered along Y and with chipped corners (cuts: [nx, ny, nz, d] planes in unit-cube space).
// The same block goes into field A, which only shades the contacts between stones.
export function megalith(S, A, mat, w, c, h, o = {}) {
  const n = o.n ?? 5, q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.rot || [0, 0, 0])));
  const cuts = (o.cuts || []).map(([x, y, z, d]) => ({ m: v(x, y, z).normalize(), d }));
  blob(S, mat, w, {
    c, r: [1, 1, 1], ws: o.ws ?? 20, hs: o.hs ?? 14, ol: o.ol,
    fn: (d, p) => {
      const t = Math.pow(Math.pow(Math.abs(d.x), n) + Math.pow(Math.abs(d.y), n) + Math.pow(Math.abs(d.z), n), -1 / n);
      p.set(d.x * t, d.y * t, d.z * t);
      for (const cu of cuts) { const e = p.dot(cu.m) - cu.d; if (e > 0) p.addScaledVector(cu.m, -e); }
      const tp = 1 + (o.taper ?? 0) * p.y;
      p.set(p.x * h[0] * tp, p.y * h[1], p.z * h[2] * tp).applyQuaternion(q);
    },
  });
  if (A) A.box(c, h, Math.min(h[0], h[1], h[2]) * 0.45, { rot: o.rot, w });
}

// Vertex painting after a bake: ambient occlusion from the sculpt fields (parts
// are darker where they meet the body) plus fn(key, p, n, color, occ) for
// gradients and markings. Glow groups keep their flat colors.
export function shade(S, geo, groupOf, o = {}) {
  const groups = [], gm = new Map();
  for (const m of S.order) { const g = groupOf(m); if (!gm.has(g)) { gm.set(g, []); groups.push(g); } gm.get(g).push(m); }
  const P = geo.attributes.position, N = geo.attributes.normal, C = geo.attributes.color;
  const p = new V3(), n = new V3(), c = new THREE.Color(), ao = globalThis.__MN_CELL ? 0 : o.ao ?? 0.6;   // the offline bake paints its own occlusion
  let v0 = 0;
  for (const g of groups) for (const m of gm.get(g)) {
    const cnt = S.buckets.get(m).p.length / 3;
    if (!(o.skip ? o.skip(m, g) : g === 'glow')) for (let i = v0; i < v0 + cnt; i++) {
      p.fromBufferAttribute(P, i); n.fromBufferAttribute(N, i); c.fromBufferAttribute(C, i);
      let occ = 0;
      for (const F of o.fields || []) occ = Math.max(occ, F.occl(p, n, o.aoR));
      if (o.fn) o.fn(m, p, n, c, occ);
      const k = occ * ao;
      C.setXYZ(i, c.r * (1 - 0.62 * k), c.g * (1 - 0.66 * k), c.b * (1 - 0.5 * k));
    }
    v0 += cnt;
  }
  C.needsUpdate = true;
}

// Chain a shader edit after a toon material's own patch.
export function extendMat(m, key, uniforms, fn) {
  const base = m.onBeforeCompile, bkey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r);
    Object.assign(sh.uniforms, uniforms);
    if (!sh.vertexShader.includes('varying vec3 vObj')) {
      sh.vertexShader = 'varying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
      sh.fragmentShader = 'varying vec3 vObj;\n' + sh.fragmentShader;
    }
    fn(sh);
  };
  m.customProgramCacheKey = () => bkey.call(m) + '|' + key;
  return m;
}
// Cel highlight towards the key light (polished metal, wet slime, chitin, eyes).
// o: { color, size (0..1, larger = broader), soft, fres (sky tint at grazing angles) }
export function sheen(m, o = {}) {
  const u = { uSheenC: { value: new THREE.Color(o.color ?? 0xffffff).multiplyScalar(o.k ?? 0.5) }, uSheenP: { value: new THREE.Vector3(1 - (o.size ?? 0.08), o.soft ?? 0.02, o.fres ?? 0) } };
  m.userData.sheen = u;
  return extendMat(m, 'sheen', u, (sh) => {
    sh.fragmentShader = 'uniform vec3 uSheenC;\nuniform vec3 uSheenP;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `{
  vec3 _sv = normalize(vViewPosition), _sl = normalize((viewMatrix * vec4(uSunW, 0.0)).xyz);
  float _nh = dot(normal, normalize(_sl + _sv));
  outgoingLight += uSheenC * smoothstep(uSheenP.x, uSheenP.x + uSheenP.y, _nh) * (0.25 + 0.75 * _dirShadow * _cloudSh);
  outgoingLight += uSheenC * uSheenP.z * pow(1.0 - clamp(dot(normal, _sv), 0.0, 1.0), 3.0) * step(0.0, normal.y * 0.5 + 0.5);
}
#include <opaque_fragment>`);
  });
}

// Jelly: see-through where it faces the viewer, dense at the silhouette, lit from within.
export function jelly(m, o = {}) {
  const u = { uJelly: { value: new THREE.Vector4(o.clear ?? 0.35, o.dense ?? 0.95, o.glow ?? 0.6, o.h ?? 0.8) }, uJellyC: { value: new THREE.Color(o.color ?? 0xffffff) } };
  m.userData.jelly = u;
  return extendMat(m, 'jelly', u, (sh) => {
    sh.fragmentShader = 'uniform vec4 uJelly;\nuniform vec3 uJellyC;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `{
  float _jf = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  float _jd = smoothstep(0.1, 0.95, _jf);
  diffuseColor.a = mix(uJelly.x, uJelly.y, _jd);
  outgoingLight += uJellyC * uJelly.z * (1.0 - _jd) * smoothstep(uJelly.w, 0.0, vObj.y);
}
#include <opaque_fragment>`);
  });
}

// Tabby stripes over vertex-painted fur (bind-pose space): darker bands where the coat is
// orange, none on the cream and white patches. `stripe` multiplies the coat color.
function tabby(m, stripe, o = {}) {
  const u = { uStripeC: { value: new THREE.Color(stripe) }, uStripeP: { value: new THREE.Vector4(o.freq ?? 34, o.width ?? 0.3, o.warp ?? 1.4, o.amt ?? 0.85) } };
  return extendMat(m, 'tabby', u, (sh) => {
    sh.fragmentShader = 'uniform vec3 uStripeC;\nuniform vec4 uStripeP;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 q = vObj;
  float w = _dn(q * 14.0) * uStripeP.z + _dn(q * 31.0) * 0.4;
  float c = (q.y + length(q.xz) * 0.55) * uStripeP.x + w * 2.2;
  float band = 1.0 - smoothstep(uStripeP.y, uStripeP.y + 0.18, abs(fract(c) - 0.5) * 2.0);
  float gate = smoothstep(0.3, 0.6, _dn(q * 5.0 + 3.0)) * smoothstep(0.4, 0.62, vColor.r - vColor.b);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uStripeC, band * gate * uStripeP.w);
}`);
  });
}

export class CreatureRig extends Rig {
  // T: { def, built, chains: [{ names, tail, opts, cols? }] }, M: group -> material
  constructor(T, M, o = {}) {
    super();
    this.T = T;
    this.s = o.scale ?? 1;
    const body = (this.body = new THREE.Group());
    body.scale.setScalar(this.s);
    this.root.add(body);
    this.M = M;
    const I = instance(body, T.def, T.built, M, { outline: o.outline ?? 0, main: o.main, shadow: o.shadow, bsPad: o.bsPad });
    this.B = I.by; this.mesh = I.mesh; this.meshes = I.meshes; this.skeleton = I.skeleton; this.outline = I.outline;
    this.mats = [...new Set(Object.values(M))].filter((m) => m && m.isMeshToonMaterial);
    this.glowMats = [...new Set(Object.values(M))].filter((m) => m && m.isMeshBasicMaterial);
    this.rest = {};
    for (const b of I.bones) this.rest[b.name] = b.position.clone();
    this.chains = (T.chains || []).map((ch) => {
      const bones = ch.names.map((n) => this.B[n]);
      const tail = ch.tail.clone().sub(T.def.pos(ch.names[ch.names.length - 1]));
      const cols = (ch.cols || []).map((c) => ({ obj: this.B[c.bone], off: c.off.clone().sub(T.def.pos(c.bone)), r: c.r }));
      const chn = new Chain(bones, tail, { ...(ch.opts || {}), colliders: cols });
      chn.kind = ch.kind;
      return chn;
    });
    dress(this, o.dress);
    this.vel = new V3(); this.velL = new V3(); this.acc = new V3(); this.prevPos = null; this.prevYaw = 0; this.yawRate = 0;
    this.hurtSp = new Spring(180, 12);
    this.hurtW = 0;
    this.lod = 0;
    this.p = {};
  }
  hurt() { this.hurtW = 1; this.hurtSp.v += 8; }
  // root motion: world velocity (smoothed), local velocity, yaw rate, LOD
  motion(dt) {
    const root = this.root;
    root.updateMatrixWorld();
    const e = root.matrixWorld.elements;
    _v1.set(e[12], e[13], e[14]);
    const yaw = Math.atan2(e[8], e[10]);
    if (!this.prevPos) this.prevPos = _v1.clone();
    if (_v1.distanceToSquared(this.prevPos) > 4) { this.prevPos.copy(_v1); for (const c of this.chains) c.init = false; }
    if (dt > 0) {
      _v2.subVectors(_v1, this.prevPos).multiplyScalar(1 / dt);
      if (_v2.lengthSq() > 3600) _v2.set(0, 0, 0);
      _v3.copy(this.vel);
      this.vel.lerp(_v2, 1 - Math.exp(-dt * 10));
      this.acc.lerp(_v3.subVectors(this.vel, _v3).multiplyScalar(1 / dt), 1 - Math.exp(-dt * 5));
      this.yawRate = damp(this.yawRate, wrapA(yaw - this.prevYaw) / dt, 8, dt);
    }
    this.prevPos.copy(_v1); this.prevYaw = yaw;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    this.velL.set(this.vel.x * cy - this.vel.z * sy, this.vel.y, this.vel.x * sy + this.vel.z * cy);
    const c = G.camera;
    const dist = c ? Math.hypot(c.position.x - e[12], c.position.y - e[13], c.position.z - e[14]) : 0;
    this.lod = dist < 28 ? 0 : dist < 70 ? 1 : 2;
    this.hurtSp.step(0, dt);
    this.hurtW = Math.max(0, this.hurtW - dt * 3);
  }
  // secondary chains (call after posing bones and updating matrices)
  stepChains(dt, wind, windFn) {
    const sim = this.lod === 0 && this.root.visible;
    for (let i = 0; i < this.chains.length; i++) {
      const ch = this.chains[i];
      const w = windFn ? windFn(i, ch) : wind;
      ch.step(dt, w, sim);
    }
  }
}
export const rot = (b, x, y, z) => b.rotation.set(x, y, z);

// ---------------------------------------------------------------------------
// 보름 — the west wind's fox spirit: slender, long-legged, three flowing tails
// with glowing wisps, cheek ruffs and a chest mane. Floats beside the player.
const FOX_TAILS = 3, FOX_SEG = 5;
function foxType() {
  return creatureType('fox', () => {
    const d = new SkelDef();
    d.add('hips', null, 0, 0, -0.11, [0, 0.01, 0]);
    d.add('spine', 'hips', 0, 0.01, 0, [0, 0.025, 0.12]);
    d.add('chest', 'spine', 0, 0.025, 0.12, [0, 0.07, 0.19]);
    d.add('neck', 'chest', 0, 0.07, 0.19, [0, 0.15, 0.26]);
    d.add('head', 'neck', 0, 0.15, 0.26, [0, 0.165, 0.36]);
    d.add('jaw', 'head', 0, 0.128, 0.3, [0, 0.112, 0.4]);
    for (const sd of [1, -1]) {
      const n = sd > 0 ? 'L' : 'R';
      d.add('ear' + n, 'head', sd * 0.048, 0.22, 0.255, [sd * 0.08, 0.35, 0.235]);
      d.add('eye' + n, 'head', sd * 0.037, 0.182, 0.345, [sd * 0.037, 0.2, 0.345]);
      d.add('fArm' + n, 'chest', sd * 0.055, 0.0, 0.15);
      d.add('fFore' + n, 'fArm' + n, sd * 0.058, -0.095, 0.165);
      d.add('fPaw' + n, 'fFore' + n, sd * 0.058, -0.19, 0.16, [sd * 0.058, -0.205, 0.2]);
      d.add('hThigh' + n, 'hips', sd * 0.06, 0.0, -0.13);
      d.add('hShin' + n, 'hThigh' + n, sd * 0.066, -0.085, -0.075);
      d.add('hFoot' + n, 'hShin' + n, sd * 0.066, -0.145, -0.155);
      d.add('hPaw' + n, 'hFoot' + n, sd * 0.066, -0.21, -0.135, [sd * 0.066, -0.22, -0.095]);
    }
    // tails fan out behind the hips, arcing up then back
    const chains = [];
    const tailPts = [];
    for (let i = 0; i < FOX_TAILS; i++) {
      const yaw = (i - 1) * 0.42;
      const names = [];
      let parent = 'hips';
      const pts = [];
      let p = v(0, 0.04, -0.2);
      for (let k = 0; k <= FOX_SEG; k++) {
        pts.push(p.clone());
        if (k < FOX_SEG) { const nm = `tail${i}_${k}`; d.add(nm, parent, p.x, p.y, p.z); names.push(nm); parent = nm; }
        const pitch = mix(0.95, -0.35, k / FOX_SEG) + (i === 1 ? 0.18 : 0);
        const yw = yaw * (1 + k * 0.25);
        const dir = v(Math.sin(yw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yw) * Math.cos(pitch));
        p = p.clone().addScaledVector(dir, 0.12 - k * 0.006);
      }
      tailPts.push(pts);
      chains.push({ names, tail: pts[FOX_SEG], kind: 'tail', opts: { stiff: 0.12, stiffTip: 0.05, damp: 0.1, grav: 1.0, drag: 0.7 } });
    }
    const color = { fur: 0xf4fbff, inner: 0xbff4ff, dark: 0x1a2a3a, eye: 0x40e0ff, pupil: 0x0a1626, tip: 0x9ff4ff, mark: 0x8af0ff, white: 0xffffff };
    const group = { fur: 'fur', inner: 'inner', dark: 'dark', pupil: 'dark', eye: 'glow', tip: 'glow', mark: 'glow', white: 'glow' };
    const built = bakeType(d, (S) => {
      const F = new Field(S);
      // one seamless body: deep chest, tucked waist, round haunches, long neck, fine muzzle
      F.bind(['hips', 'spine', 'chest'], 0.03).limb([v(0, 0.018, -0.2), v(0, 0.012, -0.1), v(0, 0.012, 0.03), v(0, 0.032, 0.135), v(0, 0.058, 0.195)], [0.058, 0.06, 0.054, 0.07, 0.056], { flat: [v(1, 0, 0), 0.9] });
      F.bind(['chest', ['neck', 1.3]], 0.03).ell(v(0, 0.022, 0.19), [0.056, 0.07, 0.052]);
      F.bind(['chest', 'neck', ['head', 1.4]], 0.025).cone(v(0, 0.045, 0.15), v(0, 0.15, 0.262), 0.056, 0.044);
      F.bind(['head'], 0.022).ell(v(0, 0.17, 0.282), [0.064, 0.058, 0.068]);
      F.cone(v(0, 0.166, 0.31), v(0, 0.146, 0.412), 0.036, 0.0135, { k: 0.02, flat: [v(0, 1, 0), 0.86] });
      F.ell(v(0, 0.186, 0.31), [0.045, 0.02, 0.03], { k: 0.02 });
      F.bind(['jaw'], 0.006).cone(v(0, 0.132, 0.3), v(0, 0.128, 0.394), 0.021, 0.009, { flat: [v(0, 1, 0), 0.75] });
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R';
        F.bind(['head'], 0.025).ell(v(sd * 0.046, 0.15, 0.28), [0.034, 0.03, 0.04]);
        const fa = v(sd * 0.054, 0.03, 0.15), fe = v(sd * 0.058, -0.095, 0.165), fp = v(sd * 0.058, -0.19, 0.16);
        F.bind(['chest', 'fArm' + n, 'fFore' + n], 0.025).cone(fa, fe, 0.036, 0.02, { flat: [v(1, 0, 0), 0.85] });
        F.bind(['fFore' + n, 'fPaw' + n], 0.012).cone(fe, fp, 0.019, 0.0145);
        F.bind(['fPaw' + n], 0.012).ell(fp.clone().add(v(0, -0.01, 0.016)), [0.02, 0.0135, 0.029]);
        const ht = v(sd * 0.058, 0.02, -0.125), hk = v(sd * 0.066, -0.085, -0.075), hh = v(sd * 0.066, -0.145, -0.155), hp = v(sd * 0.066, -0.21, -0.135);
        F.bind([['hips', 1.2], 'hThigh' + n, 'hShin' + n], 0.03).cone(ht, hk, 0.052, 0.024, { flat: [v(1, 0, 0), 0.8] });
        F.bind(['hShin' + n, 'hFoot' + n], 0.012).cone(hk, hh, 0.022, 0.0155);
        F.bind(['hFoot' + n, 'hPaw' + n], 0.012).cone(hh, hp, 0.0155, 0.0145);
        F.bind(['hPaw' + n], 0.012).ell(hp.clone().add(v(0, -0.008, 0.018)), [0.02, 0.0135, 0.028]);
      }
      // tails: full brushes, joined to the rump
      const R = (u) => 0.012 + 0.066 * Math.sin(Math.pow(Math.min(1, u), 0.72) * Math.PI), cut = 0.66;
      tailPts.forEach((pts, i) => {
        const curve = new THREE.CatmullRomCurve3(pts), P = [], rad = [];
        for (let k = 0; k <= 9; k++) { const u = (k / 9) * (cut + 0.03); P.push(curve.getPointAt(u)); rad.push(R(u) * 0.95); }
        F.bind(['hips', ...chains[i].names], 0.014).limb(P, rad);
      });
      F.mesh('fur', { cell: 0.0118 });
      tailPts.forEach((pts, i) => {
        // glowing wisp at the end of each tail, licking like a flame
        const curve = new THREE.CatmullRomCurve3(pts), o = [];
        for (let k = 0; k <= 8; k++) o.push(curve.getPointAt(mix(cut - 0.03, 1, k / 8)));
        o.push(pts[FOX_SEG].clone().add(curve.getTangentAt(1).multiplyScalar(0.085)));
        tube(S, 'tip', chains[i].names.slice(-3), { curve: new THREE.CatmullRomCurve3(o), seg: 14, steps: 14, ref: v(0, 1, 0), cap1: 1, ol: 0, r: (u) => { const uu = mix(cut - 0.03, 1.1, u), r = (R(Math.min(1, uu)) + 0.003) * (uu > 1 ? 0 : 1) + 0.002; return [r * 1.02, r * 0.9]; }, shape: (u, a) => 1 + 0.16 * Math.sin(a * 5 + u * 17) * u });
        // fur locks along the brush
        for (let k = 0; k < 5; k++) { const u = 0.2 + k * 0.1, c = curve.getPointAt(u), t = curve.getTangentAt(u), up = v(0, 1, 0).addScaledVector(t, -t.y).normalize(), a = k * 2.4 + i, side = new V3().crossVectors(t, up), o2 = up.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)); spike(S, 'fur', [chains[i].names[Math.min(FOX_SEG - 1, Math.floor(u * FOX_SEG))]], c.clone().addScaledVector(o2, R(u) * 0.8), o2.clone().addScaledVector(t, 1.6), 0.055, 0.016, { flat: 0.6, seg: 6, steps: 5, ol: 0.5 }); }
      });
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R';
        // eyes: glowing almonds, deep pupils, a catchlight, dark lash line (eye bones blink)
        blob(S, 'eye', ['eye' + n], { c: v(sd * 0.036, 0.181, 0.336), r: [0.022, 0.0135, 0.012], ws: 14, hs: 10, ol: 0, fn: (dd, p) => { p.y += p.x * sd * 0.24; if (dd.y > 0) p.y *= 1.12; } });
        blob(S, 'pupil', ['eye' + n], { c: v(sd * 0.0345, 0.181, 0.3455), r: [0.0068, 0.0108, 0.0035], ws: 10, hs: 8, ol: 0 });
        blob(S, 'white', ['eye' + n], { c: v(sd * 0.0345 + 0.006, 0.1865, 0.348), r: [0.0032, 0.0032, 0.0015], ws: 6, hs: 5, ol: 0 });
        tube(S, 'dark', ['eye' + n], { pts: [v(sd * 0.015, 0.183, 0.347), v(sd * 0.028, 0.1945, 0.349), v(sd * 0.045, 0.198, 0.345), v(sd * 0.063, 0.194, 0.334)], seg: 5, steps: 8, ref: v(0, 0, 1), ol: 0, cap0: 1, cap1: 1, capN: 2, r: (u) => [0.0022 * (0.4 + u), 0.002] });
        // tall ears: fur outside, glowing inside, a tuft at the base
        const b0 = v(sd * 0.047, 0.212, 0.258), tip = v(sd * 0.087, 0.36, 0.23);
        tube(S, 'fur', ['ear' + n, ['head', 2]], { pts: [b0, b0.clone().lerp(tip, 0.5).add(v(sd * 0.008, 0, -0.005)), tip], seg: 14, steps: 10, ref: v(0, 0, 1), cap1: 0.4, capN: 2, r: (u) => [0.037 * Math.pow(1 - u, 0.8) + 0.001, 0.014 * (1 - u) + 0.001], shape: (u, a) => (Math.sin(a) > 0 ? 0.5 : 1) });
        tube(S, 'inner', ['ear' + n], { pts: [b0.clone().add(v(0, 0.014, 0.008)), b0.clone().lerp(tip, 0.5).add(v(sd * 0.008, 0, 0.002)), tip.clone().lerp(b0, 0.16).add(v(0, 0, 0.004))], seg: 10, steps: 8, ref: v(0, 0, 1), cap1: 0.4, capN: 2, ol: 0, r: (u) => [0.025 * Math.pow(1 - u, 0.85) + 0.001, 0.004] });
        for (let k = 0; k < 2; k++) spike(S, 'fur', ['ear' + n, ['head', 1.5]], b0.clone().add(v(sd * (0.012 - k * 0.02), 0.004, 0.012)), v(sd * (0.2 - k * 0.5), 1, 0.25), 0.045 - k * 0.012, 0.009, { flat: 0.5, seg: 5, steps: 4, ol: 0.3 });
        // cheek ruff: three swept locks
        for (let k = 0; k < 3; k++) spike(S, 'fur', ['head'], F.on(v(sd * 0.075, 0.158 - k * 0.018, 0.275 - k * 0.012), -0.008), v(sd * 1, -0.35 - k * 0.3, -0.75), 0.06 - k * 0.008, 0.016, { flat: 0.5, bend: v(0, 0.3, -0.3), seg: 6, steps: 6, ol: 0.5, ref: v(0, 1, 0) });
        // elbow and hock feathers
        spike(S, 'fur', ['fArm' + n], v(sd * 0.058, -0.06, 0.135), v(0, -0.6, -1), 0.05, 0.012, { flat: 0.5, seg: 5, steps: 5, ol: 0.4, ref: v(1, 0, 0) });
        spike(S, 'fur', ['hShin' + n], v(sd * 0.066, -0.1, -0.1), v(0, -0.5, -1), 0.045, 0.011, { flat: 0.5, seg: 5, steps: 5, ol: 0.4, ref: v(1, 0, 0) });
        // wind marks on the brow and flank
        tube(S, 'mark', ['head'], { pts: [[0.012, 0.222, 0.34], [0.026, 0.226, 0.33], [0.04, 0.222, 0.318]].map(([x, y, z]) => F.on(v(sd * x, y, z), 0.0008)), seg: 5, steps: 8, ref: v(0, 1, 0), ol: 0, cap0: 1, cap1: 1, capN: 2, r: (u) => [0.0015 + 0.004 * Math.sin(u * Math.PI), 0.0015] });
        tube(S, 'mark', ['spine', 'hips'], { pts: [[0.09, 0.03, -0.02], [0.09, 0.045, -0.06], [0.09, 0.04, -0.1], [0.09, 0.02, -0.125], [0.09, 0.008, -0.11]].map(([x, y, z]) => F.on(v(sd * x, y, z), 0.0008)), seg: 5, steps: 14, ref: v(sd, 0, 0), ol: 0, cap0: 1, cap1: 1, capN: 2, r: (u) => [0.0015 + 0.005 * Math.sin(u * Math.PI), 0.0015] });
      }
      blob(S, 'dark', ['head'], { c: v(0, 0.1445, 0.4185), r: [0.012, 0.0095, 0.009], ws: 10, hs: 8, ol: 0 });
      shard(S, 'mark', ['head'], F.on(v(0, 0.24, 0.325), -0.004), F.on(v(0, 0.24, 0.29), 0.012).add(v(0, 0.012, 0)), 0.008, { sides: 4, waist: 0.5, ol: 0 });
      // chest mane: layered hanging locks
      for (let k = 0; k < 7; k++) { const a = (k - 3) * 0.42, b = F.on(v(Math.sin(a) * 0.06, 0.03 - Math.abs(k - 3) * 0.004, 0.19 + Math.cos(a) * 0.06), -0.008); spike(S, 'fur', ['chest', ['neck', 1.3]], b, v(Math.sin(a) * 0.5, -1, 0.35 * Math.cos(a)), 0.07 - Math.abs(k - 3) * 0.008, 0.02, { flat: 0.5, bend: v(0, 0, 0.3), seg: 6, steps: 6, ol: 0.5, ref: v(Math.cos(a), 0, -Math.sin(a)) }); }
      const sock = new THREE.Color(0x8fd6ee), tailC = new THREE.Color(0x9fe8f8), base = v(0, 0.04, -0.2);
      return {
        fields: [F], aoR: 0.03, ao: 0.4,
        fn: (key, p, n, c) => {
          if (key !== 'fur') return;
          c.lerp(sock, 0.85 * sstep(-0.07, -0.15, p.y) + 0.5 * sstep(0.27, 0.36, p.y) * sstep(0.3, 0.2, p.z));
          if (p.z < -0.2) c.lerp(tailC, 0.8 * sstep(0.16, 0.42, p.distanceTo(base)));
          c.multiplyScalar(0.9 + 0.12 * Math.max(0, n.y));
        },
      };
    }, color, group);
    return { def: d, built, chains };
  });
}

class FoxRig extends CreatureRig {
  constructor() {
    const T = foxType();
    const M = {
      fur: bodyMat(0xffffff, { vertexColors: true, emissive: 0x2a7a8c, emissiveIntensity: 0.55, rim: 1.1 }),
      inner: bodyMat(0xbff4ff, { emissive: 0x6ad8e8, emissiveIntensity: 0.9, rim: 1 }),
      dark: bodyMat(0x1a2a3a, { rim: 0.4 }),
      glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2), vertexColors: true }),
    };
    super(T, M, { main: 'fur', dress: { mat: { fur: { spec: 0.4, ao: 0.3 } } } });
    const B = this.B;
    this.p = { head: B.head, torso: B.chest, hips: B.hips };
    const aura = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), fresnelMat(0x000000, 0x7ae8ff, { intensity: 0.28, power: 3 }));
    aura.position.set(0, 0.03, 0);
    this.body.add(aura); this.aura = aura;
    this.blinkT = 2; this.blink = 0;
    this.earSp = [new Spring(140, 9), new Spring(140, 9)]; this.earT = 2;
    this.jaw = 0; this.talkN = 0; this.talkTo = 0;
    this.tilt = 0; this.tiltT = 0; this.tiltTo = 0;
    this.glanceT = 3; this.glance = 0; this.glanceTo = 0;
    this.lean = new V3();
    this.wind = new V3();
    this.t = rand() * 10;
  }
  update(dt, s = {}) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.t += dt;
    const t = this.t, B = this.B;
    this.motion(dt);
    const vl = this.velL;
    const spd = Math.hypot(vl.x, vl.z);
    const fly = sstep(0.4, 5, spd);          // 0 hover .. 1 dashing through the air
    // body attitude: nose into motion, bank into turns, rise/fall pitch
    this.lean.x = damp(this.lean.x, clamp(vl.z * 0.05 - vl.y * 0.06, -0.35, 0.35), 4, dt);
    this.lean.z = damp(this.lean.z, clamp(-this.yawRate * 0.12 - vl.x * 0.04, -0.4, 0.4), 4, dt);
    const bob = Math.sin(t * 2.2);
    this.body.position.y = bob * 0.06;
    rot(B.hips, this.lean.x * 0.6 + Math.sin(t * 2.2 - 0.6) * 0.04, 0, this.lean.z + Math.sin(t * 1.3) * 0.05);
    rot(B.spine, Math.sin(t * 2.2 - 1.2) * 0.05 + fly * 0.08, Math.sin(t * 1.1) * 0.04, 0);
    rot(B.chest, -Math.sin(t * 2.2 - 1.8) * 0.05 + this.lean.x * 0.3, -Math.sin(t * 1.1) * 0.04, 0);
    // head: look target, idle glances and curious tilts, talk nods
    this.glanceT -= dt;
    if (this.glanceT <= 0) { this.glanceT = 2.5 + rand() * 4; this.glanceTo = rand() < 0.5 ? (rand() - 0.5) * 1.2 : 0; this.tiltTo = rand() < 0.35 ? (rand() - 0.5) * 0.7 : 0; }
    this.glance = damp(this.glance, this.glanceTo, 3, dt);
    this.tilt = damp(this.tilt, this.tiltTo, 4, dt);
    const look = clamp((s.lookYaw ?? 0) + this.glance * (s.talk ? 0.2 : 1), -1.2, 1.2);
    // jaw: syllable flaps while talking
    if (s.talk) { this.talkN -= dt; if (this.talkN <= 0) { this.talkN = 0.08 + rand() * 0.1; this.talkTo = rand() < 0.25 ? 0 : 0.15 + rand() * 0.3; } }
    else this.talkTo = 0;
    this.jaw = damp(this.jaw, this.talkTo, 20, dt);
    const nod = s.talk ? Math.sin(t * 5.2) * 0.06 : 0;
    rot(B.neck, -0.12 - this.lean.x * 0.5 + Math.sin(t * 2.2 - 2.2) * 0.04 - fly * 0.12, look * 0.45, this.tilt * 0.3);
    rot(B.head, 0.05 + nod + Math.sin(t * 1.7) * 0.04 - fly * 0.1, look * 0.55, this.tilt * 0.7 - this.lean.z * 0.3);
    rot(B.jaw, this.jaw, 0, 0);
    // ears: back in fast flight, perk while talking, random twitches
    this.earT -= dt;
    if (this.earT <= 0) { this.earT = 1.5 + rand() * 3.5; this.earSp[rand() < 0.5 ? 0 : 1].v += 14 + rand() * 10; }
    for (let k = 0; k < 2; k++) {
      const sd = k ? -1 : 1, ear = k ? B.earR : B.earL;
      const tw = this.earSp[k].step(0, dt);
      rot(ear, -fly * 0.7 + (s.talk ? 0.15 : 0) + tw * 0.04 + Math.sin(t * 3 + k) * 0.03, sd * (tw * 0.05), sd * (-0.1 - fly * 0.3 + this.hurtSp.x * 0.05));
    }
    // blink
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 1; this.blinkT = 2 + rand() * 4; }
    this.blink = Math.max(0, this.blink - dt / 0.15);
    const bl = this.blink > 0 ? 1 - Math.sin(this.blink * Math.PI) * 0.9 : 1;
    B.eyeL.scale.set(1, bl, 1); B.eyeR.scale.set(1, bl, 1);
    // legs: idle air-treading, stretched leap pose when flying fast
    const tr = t * 2.6;
    for (let k = 0; k < 2; k++) {
      const n = k ? 'R' : 'L', ph = k ? Math.PI : 0;
      const a = Math.sin(tr + ph), b = Math.cos(tr + ph);
      rot(B['fArm' + n], mix(0.25 + a * 0.22, -0.9, fly), 0, 0);
      rot(B['fFore' + n], mix(-0.35 - Math.max(0, b) * 0.5, -0.3, fly), 0, 0);
      rot(B['fPaw' + n], mix(0.5 + Math.max(0, -b) * 0.3, 0.9, fly), 0, 0);
      rot(B['hThigh' + n], mix(0.1 - a * 0.2, 0.9, fly), 0, 0);
      rot(B['hShin' + n], mix(0.25 + Math.max(0, b) * 0.3, 0.2, fly), 0, 0);
      rot(B['hFoot' + n], mix(-0.2, 0.5, fly), 0, 0);
      rot(B['hPaw' + n], mix(0.45, 0.8, fly), 0, 0);
    }
    // hit flinch
    const hk = this.hurtSp.x * 0.06;
    B.spine.rotation.x -= hk; B.neck.rotation.x -= hk * 2;
    // tails: swaying base pose + verlet lag against flight / flowing breeze
    for (let i = 0; i < this.chains.length; i++) {
      const ch = this.chains[i];
      for (let k = 0; k < ch.base.length; k++) {
        const w = Math.sin(t * 1.9 - k * 0.7 + i * 2.1) * 0.16 * (0.4 + k * 0.3) * (1 - fly * 0.6);
        _e.set(Math.sin(t * 1.4 - k * 0.6 + i) * 0.08 + fly * 0.12, w, 0);
        ch.base[k].setFromEuler(_e);
      }
    }
    this.root.updateMatrixWorld(true);
    this.stepChains(dt, null, (i) => this.wind.set(-this.vel.x + Math.sin(t * 2.3 + i * 2) * 1.5, -this.vel.y * 0.5 + 0.8, -this.vel.z + Math.cos(t * 1.7 + i) * 1.5));
    this.aura.scale.setScalar(1 + Math.sin(t * 3.1) * 0.03);
  }
}
const _e = new THREE.Euler();
export function makeFox() { return new FoxRig(); }

// ---------------------------------------------------------------------------
// 누룽지 — Dodam's orange tabby. Sculpted sitting (it only ever sits: on the
// island, by the house, on the player's shoulder); idles with breathing, ear
// flicks, a swishing tail, look-arounds, slow blinks, grooming and meows.
const CAT_SEG = 5;
function catType() {
  return creatureType('cat', () => {
    const d = new SkelDef();
    d.add('hips', null, 0, 0.07, -0.04, [0, 0.16, -0.01]);
    d.add('chest', 'hips', 0, 0.16, -0.01, [0, 0.24, 0.03]);
    d.add('neck', 'chest', 0, 0.235, 0.03, [0, 0.285, 0.05]);
    d.add('head', 'neck', 0, 0.285, 0.05, [0, 0.37, 0.06]);
    d.add('jaw', 'head', 0, 0.272, 0.1, [0, 0.262, 0.125]);
    for (const sd of [1, -1]) {
      const n = sd > 0 ? 'L' : 'R';
      d.add('ear' + n, 'head', sd * 0.042, 0.345, 0.05, [sd * 0.058, 0.395, 0.045]);
      d.add('eye' + n, 'head', sd * 0.03, 0.306, 0.114, [sd * 0.03, 0.32, 0.114]);
      d.add('fLeg' + n, 'chest', sd * 0.036, 0.17, 0.055);
      d.add('fPaw' + n, 'fLeg' + n, sd * 0.036, 0.03, 0.07, [sd * 0.036, 0.012, 0.1]);
      d.add('hLeg' + n, 'hips', sd * 0.058, 0.07, -0.04, [sd * 0.055, 0.02, 0.04]);
    }
    const names = []; let parent = 'hips';
    const TP = [v(0, 0.035, -0.11), v(0.035, 0.022, -0.19), v(0.11, 0.018, -0.2), v(0.165, 0.018, -0.13), v(0.185, 0.02, -0.04), v(0.165, 0.028, 0.045)];
    for (let k = 0; k < CAT_SEG; k++) { const nm = 'tail' + k; d.add(nm, parent, TP[k].x, TP[k].y, TP[k].z); names.push(nm); parent = nm; }
    const chains = [{ names, tail: TP[CAT_SEG], kind: 'tail', opts: { stiff: 0.2, stiffTip: 0.1, damp: 0.12, grav: 0.5, drag: 0.2 } }];
    const color = { fur: 0xe8913a, pink: 0xf09a9a, eye: 0xb8e060, pupil: 0x141008, white: 0xffffff, whisker: 0xf8f4ec, dark: 0x5a2c12 };
    const group = { fur: 'fur' };
    const built = bakeType(d, (S) => {
      const F = new Field(S);
      // sitting body in one piece: wide haunches, upright chest, round head with full cheeks
      F.bind([['hips', 1], ['chest', 1]], 0.03).ell(v(0, 0.092, -0.035), [0.092, 0.088, 0.098]);
      F.bind(['chest', ['hips', 1.4]], 0.035).ell(v(0, 0.175, 0.005), [0.064, 0.085, 0.066], { rot: [0.25, 0, 0] });
      F.bind(['chest', 'neck', ['head', 1.4]], 0.025).cone(v(0, 0.215, 0.018), v(0, 0.285, 0.05), 0.054, 0.05);
      F.bind(['head'], 0.02).ell(v(0, 0.302, 0.06), [0.07, 0.06, 0.064]);
      F.ell(v(0, 0.284, 0.1), [0.036, 0.024, 0.03], { k: 0.012 });
      F.bind(['jaw'], 0.006).ell(v(0, 0.266, 0.104), [0.02, 0.012, 0.016]);
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R';
        F.bind(['head'], 0.02).ell(v(sd * 0.046, 0.287, 0.07), [0.034, 0.032, 0.04]);
        F.bind(['head'], 0.006).ell(v(sd * 0.0155, 0.2795, 0.115), [0.019, 0.0155, 0.014]);
        F.bind([['hLeg' + n, 1], ['hips', 1.3]], 0.025).ell(v(sd * 0.066, 0.068, -0.015), [0.044, 0.062, 0.074]);
        F.bind(['hLeg' + n], 0.012).ell(v(sd * 0.06, 0.014, 0.058), [0.022, 0.014, 0.037]);
        const top = v(sd * 0.036, 0.17, 0.05), pw = v(sd * 0.036, 0.03, 0.072);
        F.bind(['chest', 'fLeg' + n, ['fPaw' + n, 1.4]], 0.018).cone(top, pw, 0.027, 0.0185);
        F.bind(['fPaw' + n], 0.01).ell(pw.clone().add(v(0, -0.014, 0.012)), [0.02, 0.014, 0.026]);
      }
      const tc = new THREE.CatmullRomCurve3(TP), tp = [], tr = [];
      for (let k = 0; k <= 10; k++) { tp.push(tc.getPointAt(k / 10)); tr.push(mix(0.022, 0.0175, k / 10)); }
      F.bind(['hips', ...names], 0.012).limb(tp, tr);
      F.mesh('fur', { cell: 0.0088 });
      blob(S, 'pink', ['head'], { c: v(0, 0.2915, 0.1275), r: [0.0095, 0.0065, 0.006], ws: 10, hs: 8, ol: 0.3, fn: (dd, p) => { if (dd.y < 0) p.x *= 1 + dd.y * 0.6; } });
      tube(S, 'dark', ['head', ['jaw', 1.5]], { pts: [v(-0.017, 0.2725, 0.1255), v(-0.008, 0.2695, 0.13), v(0, 0.2745, 0.131), v(0.008, 0.2695, 0.13), v(0.017, 0.2725, 0.1255)], seg: 4, steps: 12, r: 0.0013, ol: 0, cap0: 1, cap1: 1, capN: 2 });
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R';
        // eyes: green almonds, slit pupils, a catchlight, dark rims
        blob(S, 'eye', ['eye' + n], { c: v(sd * 0.03, 0.306, 0.1115), r: [0.0175, 0.014, 0.01], ws: 14, hs: 10, ol: 0, fn: (dd, p) => { p.y += p.x * sd * 0.2; } });
        blob(S, 'pupil', ['eye' + n], { c: v(sd * 0.03, 0.306, 0.1195), r: [0.0046, 0.0118, 0.0028], ws: 10, hs: 8, ol: 0 });
        blob(S, 'white', ['eye' + n], { c: v(sd * 0.03 + 0.005, 0.3115, 0.1212), r: [0.003, 0.003, 0.0015], ws: 6, hs: 5, ol: 0 });
        tube(S, 'dark', ['eye' + n], { pts: [v(sd * 0.013, 0.305, 0.1195), v(sd * 0.024, 0.3185, 0.1205), v(sd * 0.038, 0.3225, 0.117), v(sd * 0.049, 0.316, 0.108)], seg: 4, steps: 8, r: (u) => 0.0011 + 0.0006 * u, ol: 0, cap0: 1, cap1: 1, capN: 2 });
        // ears: wide triangles with pink insides and pale tufts
        const b0 = v(sd * 0.04, 0.338, 0.052), tip = v(sd * 0.063, 0.402, 0.042);
        tube(S, 'fur', ['ear' + n, ['head', 2]], { pts: [b0, b0.clone().lerp(tip, 0.5), tip], seg: 12, steps: 8, ref: v(0, 0, 1), cap1: 0.4, capN: 2, r: (u) => [0.031 * Math.pow(1 - u, 0.85) + 0.001, 0.011 * (1 - u) + 0.001], shape: (u, a) => (Math.sin(a) > 0 ? 0.5 : 1) });
        tube(S, 'pink', ['ear' + n], { pts: [b0.clone().add(v(0, 0.011, 0.0065)), tip.clone().lerp(b0, 0.2).add(v(0, 0, 0.004))], seg: 8, steps: 6, ref: v(0, 0, 1), cap1: 0.4, capN: 2, ol: 0, r: (u) => [0.019 * Math.pow(1 - u, 0.9) + 0.001, 0.003] });
        for (let k = 0; k < 2; k++) spike(S, 'whisker', ['ear' + n, ['head', 1.6]], b0.clone().add(v(sd * (0.008 - k * 0.014), 0.006, 0.011)), v(sd * (0.15 - k * 0.4), 1, 0.2), 0.022, 0.0045, { flat: 0.5, seg: 4, steps: 3, ol: 0 });
        // whiskers and brow hairs
        for (let k = 0; k < 3; k++) {
          const r0 = v(sd * 0.03, 0.281 - k * 0.005, 0.12);
          tube(S, 'whisker', ['head'], { pts: [r0, r0.clone().add(v(sd * 0.04, 0.005 - k * 0.008, -0.004)), r0.clone().add(v(sd * 0.078, 0.003 - k * 0.019, -0.016))], seg: 3, steps: 5, ref: v(0, 1, 0), r: (u) => 0.0012 * (1 - u * 0.7), ol: 0 });
        }
        tube(S, 'whisker', ['head'], { pts: [v(sd * 0.022, 0.326, 0.114), v(sd * 0.032, 0.345, 0.118), v(sd * 0.046, 0.356, 0.112)], seg: 3, steps: 4, r: (u) => 0.001 * (1 - u * 0.7), ol: 0 });
        // toes
        for (const [x, y, z, w] of [[0.036, 0.016, 0.097, 'fPaw'], [0.06, 0.014, 0.092, 'hLeg']]) for (const k of [-1, 1]) tube(S, 'dark', [w + n], { pts: [v(sd * x + k * 0.0065, y + 0.008, z - 0.004), v(sd * x + k * 0.0065, y - 0.001, z + 0.0035), v(sd * x + k * 0.0065, y - 0.009, z - 0.002)], seg: 3, steps: 4, r: 0.0009, ol: 0 });
      }
      const cream = new THREE.Color(0xfff0d8), white = new THREE.Color(0xfffaf0);
      return {
        fields: [F], aoR: 0.02, ao: 0.4,
        fn: (key, p, n, c) => {
          if (key !== 'fur') return;
          // cream muzzle, chin, bib and belly, white socks and tail tip
          const bib = sstep(0.045, 0.02, Math.abs(p.x)) * sstep(0.02, 0.045, p.z - (p.y - 0.1) * 0.25) * sstep(0.26, 0.2, p.y) * sstep(0.06, 0.1, p.y);
          const muz = sstep(0.04, 0.026, Math.hypot(p.x, (p.y - 0.277) * 1.4)) * sstep(0.092, 0.106, p.z);
          c.lerp(cream, Math.min(1, bib + muz));
          c.lerp(white, Math.max(sstep(0.036, 0.022, p.y) * sstep(0.03, 0.05, p.z), sstep(0.0, 0.03, p.x - 0.15) * sstep(-0.02, 0.02, p.z)));
        },
      };
    }, color, group);
    return { def: d, built, chains };
  });
}

class CatRig extends CreatureRig {
  constructor() {
    const T = catType();
    const M = {
      fur: model('mn_cat') ? bodyMat(0xffffff, { vertexColors: true, rim: 0.5 }) : tabby(bodyMat(0xffffff, { vertexColors: true, rim: 0.5 }), 0xb47a62, { freq: 38, width: 0.34 }),   // the authored coat has its stripes painted
      main: bodyMat(0xffffff, { vertexColors: true, rim: 0.4 }),
    };
    super(T, M, { main: 'fur', outline: 0.004, dress: { mat: { fur: { spec: 0.35 }, main: { spec: 1.4 } } } });
    const B = this.B;
    this.p = { head: B.head, torso: B.chest, hips: B.hips };
    this.t = rand() * 10;
    this.look = { y: 0, x: 0, ty: 0, tx: 0, T: 1 };
    this.blinkT = 2; this.blink = 0; this.slow = false;
    this.earSp = [new Spring(160, 10), new Spring(160, 10)]; this.earT = 1.5;
    this.act = null; this.actT = 0; this.nextAct = 4 + rand() * 4;
  }
  update(dt, s = {}) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.t += dt;
    const t = this.t, B = this.B;
    this.motion(dt);
    // idle actions: meow / groom / look
    this.nextAct -= dt;
    if (!this.act && this.nextAct <= 0) { this.act = rand() < 0.45 ? 'meow' : rand() < 0.6 ? 'groom' : 'stretch'; this.actT = 0; }
    let meow = 0, groom = 0, stretch = 0;
    if (this.act) {
      this.actT += dt;
      const a = this.actT;
      if (this.act === 'meow') { meow = sstep(0, 0.2, a) * sstep(1.0, 0.7, a); if (a > 1.1) this.act = null; }
      else if (this.act === 'groom') { groom = sstep(0, 0.5, a) * sstep(3.2, 2.7, a); if (a > 3.3) this.act = null; }
      else { stretch = Math.sin(Math.min(1, a / 1.8) * Math.PI); if (a > 1.8) this.act = null; }
      if (!this.act) this.nextAct = 5 + rand() * 7;
    }
    // looking around
    const L = this.look;
    L.T -= dt;
    if (L.T <= 0) { L.T = 1.5 + rand() * 3; L.ty = (rand() - 0.5) * 1.4; L.tx = (rand() - 0.5) * 0.4; }
    L.y = damp(L.y, L.ty * (1 - groom), 5, dt); L.x = damp(L.x, L.tx, 5, dt);
    const br = Math.sin(t * 2.4);
    rot(B.hips, 0, Math.sin(t * 0.4) * 0.03, 0);
    rot(B.chest, br * 0.02 - stretch * 0.25 + groom * 0.1, L.y * 0.15, groom * 0.08);
    B.chest.scale.set(1 + br * 0.012, 1, 1 + br * 0.015);
    rot(B.neck, -meow * 0.3 + groom * 0.35 + stretch * 0.2, L.y * 0.35 - groom * 0.25, 0);
    rot(B.head, L.x - meow * 0.25 + groom * 0.5 + stretch * 0.15 + Math.sin(t * 1.3) * 0.03, L.y * 0.5 - groom * 0.35, Math.sin(t * 0.7) * 0.06 + groom * 0.25);
    const lick = groom * (0.1 + 0.1 * Math.max(0, Math.sin(t * 9)));
    rot(B.jaw, meow * 0.4 + lick, 0, 0);
    // groom: right paw raised to the mouth; stretch: both paws knead forward
    rot(B.fLegR, -groom * 1.7 - stretch * 0.5, groom * 0.2, groom * 0.35);
    rot(B.fPawR, groom * (1.6 + Math.sin(t * 9) * 0.15), 0, 0);
    rot(B.fLegL, -stretch * 0.5, 0, 0);
    rot(B.fPawL, stretch * 0.4, 0, 0);
    // ears
    this.earT -= dt;
    if (this.earT <= 0) { this.earT = 1 + rand() * 3; this.earSp[rand() < 0.5 ? 0 : 1].v += 16 + rand() * 12; }
    for (let k = 0; k < 2; k++) {
      const sd = k ? -1 : 1, ear = k ? B.earR : B.earL;
      const tw = this.earSp[k].step(0, dt);
      rot(ear, meow * 0.2 + tw * 0.03, sd * tw * 0.06, -sd * (groom * 0.3 + tw * 0.02));
    }
    // blink (sometimes a slow, content blink)
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.slow = rand() < 0.3; this.blink = 1; this.blinkT = 2 + rand() * 4; }
    this.blink = Math.max(0, this.blink - dt / (this.slow ? 0.9 : 0.14));
    const eyeK = this.blink > 0 ? 1 - Math.sin(this.blink * Math.PI) * 0.92 : 1;
    const half = groom > 0.5 ? 0.35 : 1;
    B.eyeL.scale.set(1, eyeK * half, 1); B.eyeR.scale.set(1, eyeK * half, 1);
    // tail: slow swish with a flicking tip
    const ch = this.chains[0];
    if (ch) {
      for (let k = 0; k < ch.base.length; k++) {
        const w = Math.sin(t * 1.3 - k * 0.8) * 0.12 * (0.3 + k * 0.35) + (k === ch.base.length - 1 ? Math.sin(t * 4.1) * 0.25 : 0);
        _e.set(k > 1 ? Math.max(0, Math.sin(t * 0.9 - k)) * -0.15 : 0, w, 0);
        ch.base[k].setFromEuler(_e);
      }
    }
    this.root.updateMatrixWorld(true);
    this.stepChains(dt, null);
  }
}
export function makeCat() { return new CatRig(); }
