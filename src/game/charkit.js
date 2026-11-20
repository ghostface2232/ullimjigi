// Character toolkit: procedural sculpting (lofted tubes, sculpted blobs, thick
// cloth sheets), automatic skin weights, per-type geometry merging into one
// SkinnedMesh, character materials (painted faces, glowing ash cracks, skinned
// outline hulls and ghosts), two-bone IK and verlet secondary-motion chains.
// Everything is generated in code; geometry is built once per character type
// and shared between instances (each instance gets its own bones/materials).
import * as THREE from 'three';
import { G } from '../core/context.js';
import { toon, outlineMat, useCasterDepth, U } from '../render/materials.js';

const V3 = THREE.Vector3;
export const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const mix = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;

// Smooth 1D profile through keys [[u, v], ...] (Catmull-Rom, clamped ends).
export function prof(keys) {
  const n = keys.length;
  return (u) => {
    if (u <= keys[0][0]) return keys[0][1];
    if (u >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0;
    while (i < n - 2 && u > keys[i + 1][0]) i++;
    const u0 = keys[i][0], u1 = keys[i + 1][0];
    const t = (u - u0) / (u1 - u0);
    const p0 = keys[Math.max(0, i - 1)][1], p1 = keys[i][1], p2 = keys[i + 1][1], p3 = keys[Math.min(n - 1, i + 2)][1];
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
}
// deterministic hash noise (build-time sculpt detail)
export function hash3(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
export function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  let r = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    r += hash3(ix + dx, iy + dy, iz + dz) * (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Skeleton definition (rest pose in body space, all rest rotations identity)
// A bone-only branch supplies matrices but never submits draws. Attachments
// (including equipment reparented later) open their path for all render passes.
function showAttachmentPath({ child }) {
  if (child.isBone && !child.visible) return;
  for (let b = this; b?.isBone && !b.visible; b = b.parent) b.visible = true;
}

export class SkelDef {
  constructor() { this.b = []; this.map = {}; }
  add(name, parent, x, y, z, tail = null) {
    const i = this.b.length;
    this.b.push({ name, parent: parent == null ? -1 : this.map[parent], pos: new V3(x, y, z), tail: tail ? new V3(...tail) : null });
    this.map[name] = i;
    return i;
  }
  has(n) { return n in this.map; }
  i(n) { const r = this.map[n]; if (r === undefined) throw new Error('no bone ' + n); return r; }
  pos(n) { return this.b[this.i(n)].pos; }
  finalize() {
    for (let i = 0; i < this.b.length; i++) {
      const B = this.b[i];
      if (B.tail) continue;
      const kid = this.b.find((c) => c.parent === i);
      B.tail = kid ? kid.pos.clone() : B.pos.clone().add(new V3(0, 0.04, 0));
    }
    return this;
  }
  instance() {
    const bones = this.b.map((B) => { const o = new THREE.Bone(); o.name = B.name; return o; });
    this.b.forEach((B, i) => {
      const o = bones[i];
      if (B.parent >= 0) { o.position.copy(B.pos).sub(this.b[B.parent].pos); bones[B.parent].add(o); } else o.position.copy(B.pos);
    });
    const by = {};
    bones.forEach((o) => {
      by[o.name] = o;
      o.visible = false;
      o.addEventListener('childadded', showAttachmentPath);
    });
    return { bones, by, root: bones[0] };
  }
}

// distance from p to segment ab
const _s1 = new V3(), _s2 = new V3();
function segDist(p, a, b) {
  _s1.subVectors(b, a); _s2.subVectors(p, a);
  const l2 = _s1.lengthSq();
  const t = l2 > 1e-9 ? sat(_s2.dot(_s1) / l2) : 0;
  return _s2.addScaledVector(_s1, -t).length();
}

// ---------------------------------------------------------------------------
// Geometry builder: parts accumulate into per-material buckets.
export class Sculpt {
  constructor(skel) { this.skel = skel; this.buckets = new Map(); this.order = []; this.stats = {}; }
  bucket(mat) {
    if (!this.buckets.has(mat)) { this.buckets.set(mat, { p: [], n: [], i: [], si: [], sw: [], ol: [], c: [] }); this.order.push(mat); }
    return this.buckets.get(mat);
  }
  // weights: array of bone names (auto, inverse-distance to bone segments),
  // [[name, bias], ...], a single bone name, or fn(p) -> [[idx, w], ...]
  weigher(w) {
    const S = this.skel;
    if (typeof w === 'function') return w;
    if (typeof w === 'string') { const i = S.i(w); const r = [[i, 1]]; return () => r; }
    const c = w.map((x) => (Array.isArray(x) ? [S.i(x[0]), x[1]] : [S.i(x), 1]));
    if (c.length === 1) { const r = [[c[0][0], 1]]; return () => r; }
    return (p) => {
      const out = [];
      for (const [i, bias] of c) {
        const B = S.b[i];
        const d = segDist(p, B.pos, B.tail) * bias + 0.004;
        out.push([i, 1 / (d * d * d * d)]);
      }
      return out;
    };
  }
  // add a finished part {p: flat positions, i: indices, w: per-vertex weight lists}
  addPart(mat, part, smooth = true) {
    const B = this.bucket(mat);
    this.stats[mat] = (this.stats[mat] || 0) + part.i.length / 3;
    const base = B.p.length / 3;
    const nrm = computeNormals(part.p, part.i);
    if (part.nfn) for (let k = 0; k < nrm.length; k += 3) {
      _pv.set(part.p[k], part.p[k + 1], part.p[k + 2]); _o1.set(nrm[k], nrm[k + 1], nrm[k + 2]);
      part.nfn(_pv, _o1); _o1.normalize();
      nrm[k] = _o1.x; nrm[k + 1] = _o1.y; nrm[k + 2] = _o1.z;
    }
    for (let k = 0; k < part.p.length; k++) { B.p.push(part.p[k]); B.n.push(nrm[k]); }
    for (let k = 0; k < part.p.length / 3; k++) B.c.push(part.c[k] ?? 1);
    const ol = part.ol ?? 1;
    for (let k = 0; k < part.p.length / 3; k++) B.ol.push(ol);
    for (const x of part.i) B.i.push(x + base);
    for (const wl of part.w) {
      const s = wl.slice().sort((a, b) => b[1] - a[1]).slice(0, 4);
      let t = 0; for (const e of s) t += e[1];
      for (let k = 0; k < 4; k++) { B.si.push(s[k] ? s[k][0] : 0); B.sw.push(s[k] ? s[k][1] / t : 0); }
    }
    void smooth;
  }
  // o.color(key) -> hex vertex color; o.group(key) -> material group name;
  // o.surf(key) -> surface kind for clothMat (attribute `surf`).
  // Parts sharing a group are drawn with one material (vertex colored).
  build(o = {}) {
    const g = new THREE.BufferGeometry();
    const groupOf = o.group || ((k) => k);
    const groups = [];
    const gmap = new Map();
    for (const m of this.order) { const gn = groupOf(m); if (!gmap.has(gn)) { gmap.set(gn, []); groups.push(gn); } gmap.get(gn).push(m); }
    let nv = 0, ni = 0;
    for (const m of this.order) { const B = this.buckets.get(m); nv += B.p.length / 3; ni += B.i.length; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), SI = new Uint16Array(nv * 4), SW = new Float32Array(nv * 4), C = new Float32Array(nv * 3), OL = new Float32Array(nv), SF = new Float32Array(nv);
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    const col = new THREE.Color();
    groups.forEach((gn, gi) => {
      const i0 = io;
      for (const m of gmap.get(gn)) {
        const B = this.buckets.get(m);
        P.set(B.p, vo * 3); N.set(B.n, vo * 3); SI.set(B.si, vo * 4); SW.set(B.sw, vo * 4); OL.set(B.ol, vo);
        col.set(o.color ? o.color(m) : 0xffffff);
        const sf = o.surf ? o.surf(m) : 0;
        for (let k = 0; k < B.p.length / 3; k++) { const sh = B.c[k]; C[(vo + k) * 3] = col.r * sh; C[(vo + k) * 3 + 1] = col.g * sh; C[(vo + k) * 3 + 2] = col.b * sh; SF[vo + k] = sf; }
        for (let k = 0; k < B.i.length; k++) I[io + k] = B.i[k] + vo;
        vo += B.p.length / 3; io += B.i.length;
      }
      g.addGroup(i0, io - i0, gi);
    });
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setAttribute('olw', new THREE.BufferAttribute(OL, 1));
    g.setAttribute('surf', new THREE.BufferAttribute(SF, 1));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    g.computeBoundingSphere();
    return { geo: g, mats: groups, tris: ni / 3, stats: this.stats };
  }
}

export function computeNormals(p, idx) {
  const n = new Float32Array(p.length);
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const q of [a, b, c]) { n[q] += nx; n[q + 1] += ny; n[q + 2] += nz; }
  }
  for (let k = 0; k < n.length; k += 3) {
    const l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1;
    n[k] /= l; n[k + 1] /= l; n[k + 2] /= l;
  }
  return n;
}

// Part helper: positions + weights + indices
export class Part {
  constructor(wfn) { this.p = []; this.i = []; this.w = []; this.c = []; this.sh = 1; this.wfn = wfn; }
  v(x, y, z, w) {
    const k = this.p.length / 3;
    this.p.push(x, y, z);
    this.w.push(w || this.wfn(_pv.set(x, y, z)));
    this.c.push(this.sh);
    return k;
  }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  tri(a, b, c) { this.i.push(a, b, c); }
  flip() { for (let k = 0; k < this.i.length; k += 3) { const t = this.i[k + 1]; this.i[k + 1] = this.i[k + 2]; this.i[k + 2] = t; } }
  // orient triangles so the normal of a sample face points away from `inside(p)`
  orient(inside) {
    let score = 0;
    const P = this.p;
    const step = Math.max(3, Math.floor(this.i.length / 3 / 24) * 3);
    for (let k = 0; k < this.i.length; k += step) {
      const a = this.i[k] * 3, b = this.i[k + 1] * 3, c = this.i[k + 2] * 3;
      _o1.set(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]);
      _o2.set(P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]);
      _o1.cross(_o2);
      if (_o1.lengthSq() < 1e-14) continue;
      _o3.set((P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3);
      const ins = inside(_o3);
      score += Math.sign(_o1.dot(_o3.sub(ins)));
    }
    if (score < 0) this.flip();
    return this;
  }
  transform(fn) { for (let k = 0; k < this.p.length; k += 3) { _pv.set(this.p[k], this.p[k + 1], this.p[k + 2]); fn(_pv); this.p[k] = _pv.x; this.p[k + 1] = _pv.y; this.p[k + 2] = _pv.z; } return this; }
}
const _pv = new V3(), _o1 = new V3(), _o2 = new V3(), _o3 = new V3();

// ---------------------------------------------------------------------------
// Tube lofted along a smooth curve through `pts`.
// o: { pts, closed, seg, steps, r(u) -> number | [rx, rz], shape(u, a) -> mult,
//      off(u) -> [side, front], ref: V3 (front reference), cap0, cap1 (round caps; number = cap length factor),
//      flat0/flat1 (flat caps), a0/a1 (open angular range for partial tubes), twist(u),
//      shade(u, a) -> vertex colour multiplier, nfn(p, n) edits the smooth normal in place }
export function tube(S, mat, w, o) {
  const part = new Part(S.weigher(w));
  const curve = o.curve || new THREE.CatmullRomCurve3(o.pts, !!o.closed, 'centripetal', 0.5);
  const seg = o.seg ?? 12, steps = o.steps ?? 12;
  const closed = !!o.closed;
  const ref = o.ref || new V3(0, 0, 1);
  const R = typeof o.r === 'function' ? o.r : () => o.r;
  const rings = [];
  const C = new V3(), T = new V3(), F = new V3(), Sd = new V3();
  const nR = closed ? steps : steps + 1;
  const frameAt = (u) => {
    curve.getPointAt(Math.min(1, Math.max(0, u)), C);
    curve.getTangentAt(Math.min(1, Math.max(0, u)), T);
    const rf = typeof ref === 'function' ? ref(u) : ref;
    F.copy(rf).addScaledVector(T, -rf.dot(T));
    if (F.lengthSq() < 1e-6) F.set(0, 1, 0).addScaledVector(T, -T.y);
    if (F.lengthSq() < 1e-6) F.set(1, 0, 0);
    F.normalize(); Sd.crossVectors(T, F).normalize();
  };
  const ring = (u, rs = 1, shift = 0) => {
    frameAt(u);
    const r = R(u); const rx = (Array.isArray(r) ? r[0] : r) * rs, rz = (Array.isArray(r) ? r[1] : r) * rs;
    const of = o.off ? o.off(u) : null;
    const tw = o.twist ? o.twist(u) : 0;
    const out = [];
    for (let j = 0; j < seg; j++) {
      const a = (o.a0 !== undefined ? o.a0 + (o.a1 - o.a0) * (j / (seg - 1)) : (j / seg) * TAU) + tw;
      const m = o.shape ? o.shape(u, a) : 1;
      if (o.shade) part.sh = o.shade(u, a);
      const x = Math.cos(a) * rx * m + (of ? of[0] : 0), z = Math.sin(a) * rz * m + (of ? of[1] : 0);
      out.push(part.v(C.x + Sd.x * x + F.x * z + T.x * shift, C.y + Sd.y * x + F.y * z + T.y * shift, C.z + Sd.z * x + F.z * z + T.z * shift));
    }
    return out;
  };
  const open = o.a0 !== undefined;
  const link = (A, B) => { const n = A.length; for (let j = 0; j < (open ? n - 1 : n); j++) { const j2 = (j + 1) % n; part.quad(A[j], A[j2], B[j2], B[j]); } };
  const capRings = (u, dir, len) => {
    const n = o.capN ?? 3, list = [];
    const r = R(u); const rm = Math.min(Array.isArray(r) ? r[0] : r, Array.isArray(r) ? r[1] : r);
    for (let k = 1; k < n; k++) { const ph = (k / n) * Math.PI / 2; list.push(ring(u, Math.cos(ph), dir * Math.sin(ph) * rm * len)); }
    frameAt(u);
    const of = o.off ? o.off(u) : null;
    const px = C.x + T.x * dir * rm * len + (of ? Sd.x * of[0] + F.x * of[1] : 0), py = C.y + T.y * dir * rm * len + (of ? Sd.y * of[0] + F.y * of[1] : 0), pz = C.z + T.z * dir * rm * len + (of ? Sd.z * of[0] + F.z * of[1] : 0);
    return { list, pole: part.v(px, py, pz) };
  };
  for (let s = 0; s < nR; s++) rings.push(ring(s / steps));
  for (let s = 0; s < rings.length - 1; s++) link(rings[s], rings[s + 1]);
  if (closed) link(rings[rings.length - 1], rings[0]);
  else {
    if (o.cap0) { const c = capRings(0, -1, o.cap0 === true ? 1 : o.cap0); let prev = rings[0]; for (const r of c.list) { link(r, prev); prev = r; } fan(part, prev, c.pole, true); }
    else if (o.flat0) { frameAt(0); const pc = part.v(C.x, C.y, C.z); fan(part, rings[0], pc, true); }
    if (o.cap1) { const c = capRings(1, 1, o.cap1 === true ? 1 : o.cap1); let prev = rings[rings.length - 1]; for (const r of c.list) { link(prev, r); prev = r; } fan(part, prev, c.pole, false); }
    else if (o.flat1) { frameAt(1); const pc = part.v(C.x, C.y, C.z); fan(part, rings[rings.length - 1], pc, false); }
  }
  // orient outward from the curve
  const tmpC = new V3();
  part.orient((p) => {
    // nearest curve sample (coarse)
    let best = 1e9;
    for (let s = 0; s <= 8; s++) { curve.getPointAt(s / 8, _o2); const d = _o2.distanceToSquared(p); if (d < best) { best = d; tmpC.copy(_o2); } }
    return tmpC;
  });
  if (o.inward) part.flip();
  part.ol = o.ol; part.nfn = o.nfn;
  S.addPart(mat, part);
  return part;
}
function fan(part, ringIdx, pole, rev) {
  const n = ringIdx.length;
  for (let j = 0; j < n; j++) { const j2 = (j + 1) % n; if (rev) part.tri(ringIdx[j2], ringIdx[j], pole); else part.tri(ringIdx[j], ringIdx[j2], pole); }
}

// Sculpted blob: lat-long sphere around c with radii r, fn(d, p) mutates p
// (d = unit direction on the sphere, p = ellipsoid point). skip(d) removes faces.
// lonWarp (0..0.8) packs the meridians towards +Z; shade(d, p), nfn(p, n) as in tube.
export function blob(S, mat, w, o) {
  const part = new Part(S.weigher(w));
  const ws = o.ws ?? 16, hs = o.hs ?? 12;
  const [rx, ry, rz] = o.r;
  const c = o.c;
  const d = new V3(), p = new V3();
  const idx = [];
  const lw = o.lonWarp ?? 0;
  const lon = (t) => t * TAU - lw * Math.sin(t * TAU);
  for (let i = 0; i <= hs; i++) {
    const th = (i / hs) * Math.PI;
    const row = [];
    const cnt = i === 0 || i === hs ? 1 : ws;
    for (let j = 0; j < cnt; j++) {
      const ph = lon(j / ws);
      d.set(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph));
      p.set(d.x * rx, d.y * ry, d.z * rz);
      if (o.fn) o.fn(d, p);
      if (o.shade) part.sh = o.shade(d, p);
      row.push(part.v(c.x + p.x, c.y + p.y, c.z + p.z));
    }
    idx.push(row);
  }
  const keep = (i, j) => { if (!o.skip) return true; const th = ((i + 0.5) / hs) * Math.PI, ph = lon((j + 0.5) / ws); d.set(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)); return !o.skip(d); };
  for (let i = 0; i < hs; i++) {
    for (let j = 0; j < ws; j++) {
      if (!keep(i, j)) continue;
      const j2 = (j + 1) % ws;
      if (i === 0) part.tri(idx[0][0], idx[1][j], idx[1][j2]);
      else if (i === hs - 1) part.tri(idx[i][j], idx[hs][0], idx[i][j2]);
      else part.quad(idx[i][j], idx[i + 1][j], idx[i + 1][j2], idx[i][j2]);
    }
  }
  part.orient(o.inside || (() => c));
  if (o.inward) part.flip();
  part.ol = o.ol; part.nfn = o.nfn;
  S.addPart(mat, part);
  return { part, idx };
}

// Front surface depth of a sculpted part at (x, y): inverse-distance blend of
// the nearest front-half vertices (for seating features on curved surfaces).
export function zAt(part, x, y) {
  const P = part.p;
  let zc = 0;
  for (let k = 2; k < P.length; k += 3) zc += P[k];
  zc /= P.length / 3;
  const near = [[1e9, 0], [1e9, 0], [1e9, 0], [1e9, 0]];
  for (let k = 0; k < P.length; k += 3) {
    if (P[k + 2] < zc) continue;
    const d = (P[k] - x) ** 2 + (P[k + 1] - y) ** 2;
    if (d < near[3][0]) { near[3] = [d, P[k + 2]]; near.sort((a, b) => a[0] - b[0]); }
  }
  let ws = 0, z = 0;
  for (const [d, zz] of near) { const w = 1 / (Math.sqrt(d) + 1e-4); ws += w; z += w * zz; }
  return z / ws;
}

// Thick cloth sheet: outer surface fn(u, v, out), inner surface offset by
// `thick` along -normal (normal oriented away from inside(p)). Closes the
// hem (v = 1), sides (u = 0/1, unless wrap) and optionally the top edge.
// shade(u, v) -> vertex colour multiplier (innerShade scales it on the lining).
export function sheet(S, mat, w, o) {
  const nu = o.nu ?? 12, nv = o.nv ?? 8, wrap = !!o.wrap;
  const thick = o.thick ?? 0.012;
  const wf = S.weigher(w);
  const cu = wrap ? nu : nu + 1;
  const pos = [], nrm = [], shd = [];
  const P = new V3(), A = new V3(), B = new V3(), Nn = new V3();
  const eps = 1e-3;
  for (let j = 0; j <= nv; j++) for (let i = 0; i < cu; i++) {
    const u = i / nu, v = j / nv;
    o.fn(u, v, P);
    o.fn(Math.min(1, u + eps), v, A); o.fn(Math.max(0, u - eps), v, B); A.sub(B);
    const tu = A.clone();
    o.fn(u, Math.min(1, v + eps), A); o.fn(u, Math.max(0, v - eps), B); A.sub(B);
    Nn.crossVectors(tu, A).normalize();
    const ins = o.inside ? o.inside(P) : new V3(0, P.y, 0);
    if (Nn.dot(_o1.subVectors(P, ins)) < 0) Nn.negate();
    pos.push(P.clone()); nrm.push(Nn.clone()); shd.push(o.shade ? o.shade(u, v) : 1);
  }
  const id = (i, j) => j * cu + (wrap ? i % nu : i);
  const mk = (sign) => {
    const part = new Part(wf);
    const vi = [];
    for (let k = 0; k < pos.length; k++) {
      const q = pos[k].clone().addScaledVector(nrm[k], sign > 0 ? 0 : -thick);
      part.sh = sign > 0 ? shd[k] : shd[k] * (o.innerShade ?? 1);
      vi.push(part.v(q.x, q.y, q.z, wf(pos[k])));
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      if (o.skip && o.skip((i + 0.5) / nu, (j + 0.5) / nv)) continue;
      part.quad(vi[id(i, j)], vi[id(i + 1, j)], vi[id(i + 1, j + 1)], vi[id(i, j + 1)]);
    }
    // orient: outer faces away from inside, inner faces toward it
    part.orient((p) => { const ins = o.inside ? o.inside(p) : new V3(0, p.y, 0); return sign > 0 ? ins : _o3.copy(p).multiplyScalar(2).sub(ins); });
    part.ol = o.ol;
    return part;
  };
  S.addPart(mat, mk(1));
  S.addPart(o.innerMat || mat, mk(-1));
  // edge strips
  const edge = (list) => {
    const part = new Part(wf);
    const a = [], b = [];
    for (const k of list) {
      const q0 = pos[k], q1 = pos[k].clone().addScaledVector(nrm[k], -thick);
      part.sh = shd[k];
      a.push(part.v(q0.x, q0.y, q0.z, wf(q0))); b.push(part.v(q1.x, q1.y, q1.z, wf(q0)));
    }
    for (let k = 0; k < a.length - 1; k++) part.quad(a[k], a[k + 1], b[k + 1], b[k]);
    // orient away from the sheet's interior (towards the edge direction)
    const cen = new V3(); for (const k of list) cen.add(pos[k]); cen.multiplyScalar(1 / list.length);
    const mid = new V3(); o.fn(0.5, 0.5, mid);
    part.orient(() => mid);
    part.ol = o.ol;
    S.addPart(o.edgeMat || mat, part);
  };
  const row = (j) => { const r = []; for (let i = 0; i <= nu; i++) r.push(id(i, j)); return r; };
  const col = (i) => { const r = []; for (let j = 0; j <= nv; j++) r.push(id(i, j)); return r; };
  if (o.hem !== false) edge(row(nv));
  if (o.top) edge(row(0));
  if (!wrap && o.sides !== false) { edge(col(0)); edge(col(nu)); }
}

// merge a plain THREE geometry (non-indexed or indexed) into the sculpt, rigidly bound
export function addGeo(S, mat, w, geo, matrix = null) {
  const g = geo.index ? geo : geo;
  const part = new Part(S.weigher(w));
  const pa = g.attributes.position;
  const v = new V3();
  for (let k = 0; k < pa.count; k++) { v.fromBufferAttribute(pa, k); if (matrix) v.applyMatrix4(matrix); part.v(v.x, v.y, v.z); }
  if (g.index) for (let k = 0; k < g.index.count; k++) part.i.push(g.index.getX(k));
  else for (let k = 0; k < pa.count; k++) part.i.push(k);
  S.addPart(mat, part);
  return part;
}

// ---------------------------------------------------------------------------
// Materials
// Per-instance toon material for a body part (hit flash via emissive, dissolve).
export function bodyMat(color, o = {}) { return toon(color, { nocache: true, rim: o.rim ?? 0.32, ...o }); }

// Chain an extra shader edit after the toon patch.
function extend(m, key, fn) {
  const base = m.onBeforeCompile;
  const bkey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => { base.call(m, sh, r); fn(sh); };
  m.customProgramCacheKey = () => bkey.call(m) + '|' + key;
  return m;
}
const OBJ_VERT = (sh) => {
  sh.vertexShader = 'varying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
};

// Painted face: eyes (sclera, iris, pupil, highlight, lash line, lids),
// brows, mouth (closed line / open with teeth and tongue), blush, wrinkles and
// freckles, drawn procedurally on the head surface in bind-pose object space.
const FACE_PARS = `
varying vec3 vObj;
uniform vec4 uFaceC;   // head center (bind space), radius
uniform vec4 uEyeP;    // eye x, y, half width, half height (units of R)
uniform vec4 uEyeS;    // open, lid tilt (+ = inner corner down), lower lid raise, happy (^ arcs)
uniform vec4 uLook;    // iris offset x, y (-1..1), iris radius (rel. to eye height), pupil size
uniform vec3 uIris;
uniform vec3 uLash;
uniform vec4 uBrow;    // raise, tilt (+ = inner end up), furrow, thickness
uniform vec4 uBrowP;   // x, y, half length, arch
uniform vec3 uBrowC;
uniform vec4 uMouth;   // open, smile (+) / frown (-), width, round (o-shape)
uniform vec4 uMouthP;  // y, lip darkness, teeth, jaw drop scale
uniform vec4 uCheek;   // blush, wrinkles, freckles, lash thickness
uniform vec3 uBlushC;
uniform vec4 uFaceX;   // fringe shadow line y (9 = none), nose tip y, lip tint, lower lashes
float fLine(float d, float w, float aa) { return 1.0 - smoothstep(w - aa, w + aa, abs(d)); }
`;
const FACE_FRAG = `
#include <color_fragment>
{
  vec3 q3 = (vObj - uFaceC.xyz) / uFaceC.w;
  // the jaw's shadow on the throat (a fixed cel shape, as in drawn animation)
  if (q3.y < -0.8 && q3.y > -2.4 && abs(q3.x) < 0.7 && q3.z < 0.5) {
    float ns = smoothstep(-1.27 - 0.16 * cos(q3.x * 4.0), -1.22 - 0.16 * cos(q3.x * 4.0), q3.y);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.86, 0.68, 0.68), ns);
  }
  if (q3.z > 0.05 && q3.y > -1.25 && q3.y < 1.0 && abs(q3.x) < 1.05) {
    vec2 f = q3.xy;
    float aa = max(fwidth(f.x), fwidth(f.y)) * 1.1 + 0.002;
    vec3 col = diffuseColor.rgb;
    float front = smoothstep(0.05, 0.3, q3.z);
    // ---- fringe shadow on the forehead, nose shadow
    {
      float hy = uFaceX.x - 0.05 * cos(f.x * 7.0) - 0.035 * cos(f.x * 19.0 + 1.0);
      col *= mix(vec3(1.0), vec3(0.88, 0.72, 0.72), smoothstep(hy - aa, hy + aa, f.y) * front);
      vec2 np = (f - vec2(0.05, uFaceX.y - 0.045)) * vec2(1.0, 1.7);
      col *= mix(vec3(1.0), vec3(0.84, 0.62, 0.6), (1.0 - smoothstep(0.035 - aa, 0.035 + aa, length(np))) * 0.8);
    }
    // ---- blush, wrinkles, freckles
    {
      vec2 bc = vec2(abs(f.x) - 0.52, f.y + 0.3);
      float bl = exp(-dot(bc, bc) / 0.022) * uCheek.x;
      col = mix(col, uBlushC, bl * 0.45);
      // a few hatch strokes across the blush
      float hat = fLine(fract((bc.x * 0.6 + bc.y) * 14.0) - 0.5, 0.11, aa * 14.0) * step(abs(bc.x), 0.13) * step(abs(bc.y - bc.x * 0.2), 0.045);
      col = mix(col, uBlushC * 0.9, hat * uCheek.x * 0.35);
      if (uCheek.z > 0.0) {
        vec2 fp = f * 26.0; vec2 cell = floor(fp); vec2 fr = fract(fp) - 0.5;
        float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
        float zone = exp(-pow((abs(f.x) - 0.32) / 0.22, 2.0) - pow((f.y + 0.2) / 0.12, 2.0));
        float dot1 = 1.0 - smoothstep(0.12, 0.2, length(fr - (h - 0.5) * 0.4));
        col = mix(col, col * vec3(0.78, 0.6, 0.5), dot1 * step(0.55, h) * zone * uCheek.z);
      }
    }
    // ---- eyes
    float sx = f.x < 0.0 ? -1.0 : 1.0;
    vec2 ec = vec2(sx * uEyeP.x, uEyeP.y);
    vec2 p = f - ec;
    float xo = p.x * sx;                 // + towards the outer corner
    float a = uEyeP.z, b = uEyeP.w;
    float xn = clamp(xo / a, -1.0, 1.0);
    float bowl = sqrt(max(0.0, 1.0 - xn * xn));
    float open = uEyeS.x;
    float tilt = uEyeS.y;
    float closedY = -b * 0.15 + b * 0.08 * xn;
    float topO = b * bowl * 1.02 + tilt * (-xn) * b * 0.45 * bowl - b * 0.06 * xn;
    float yTop = mix(closedY, topO, clamp(open, 0.0, 1.3));
    float yBot = -b * bowl * (1.0 - uEyeS.z * 0.75) * 0.92 - b * 0.05;
    yBot = min(yBot, yTop - 0.0005);
    float inEye = step(abs(xo), a) * smoothstep(yBot - aa, yBot + aa, p.y) * (1.0 - smoothstep(yTop - aa, yTop + aa, p.y));
    float happy = uEyeS.w;
    if (inEye > 0.0 && open > 0.08) {
      vec3 sclera = vec3(0.96, 0.95, 0.93);
      // lid shadow on the sclera
      sclera *= mix(vec3(1.0), vec3(0.62, 0.66, 0.78), smoothstep(b * 0.6, 0.0, yTop - p.y));
      vec2 ic = vec2(uLook.x * a * 0.36, uLook.y * b * 0.3 - b * 0.03);
      float ir = b * uLook.z;
      vec2 dq = (p - ic) * vec2(1.08, 0.94);
      float di = length(dq);
      // iris painted like an animation cel: deep under the lid, a glowing crescent below,
      // fine fibres, a dark limbal ring
      float up = smoothstep(-ir, ir, p.y - ic.y);
      vec3 iris = mix(uIris * 1.5 + vec3(0.07), uIris * 0.4, smoothstep(0.12, 0.82, up));
      iris *= 0.93 + 0.07 * sin(atan(dq.y, dq.x) * 22.0);
      iris = mix(iris, uIris * 0.2, smoothstep(ir * 0.78, ir * 0.98, di));
      float pr = ir * uLook.w;
      vec3 e = mix(sclera, iris, 1.0 - smoothstep(ir - aa, ir + aa, di));
      e = mix(e, vec3(0.03, 0.02, 0.05), 1.0 - smoothstep(pr - aa, pr + aa * 2.0, di));
      // catchlights (same side on both eyes): a large one high up, a small one opposite
      float h1 = 1.0 - smoothstep(ir * 0.3 - aa, ir * 0.3 + aa, length((p - ic - vec2(ir * 0.36, ir * 0.42)) * vec2(1.0, 1.25)));
      float h2 = 1.0 - smoothstep(ir * 0.13 - aa, ir * 0.13 + aa, length(p - ic - vec2(-ir * 0.34, -ir * 0.4)));
      e = mix(e, vec3(1.0), max(h1, h2 * 0.85));
      col = mix(col, e, inEye * front);
    }
    // lash line along the upper lid, thicker at the outer corner, with a flick
    float lt = b * uCheek.w * (0.55 + 0.45 * smoothstep(-0.6, 1.0, xn));
    float lashIn = step(abs(xo), a * 1.08);
    float lash = fLine(p.y - yTop - lt * 0.45, lt * 0.6, aa) * lashIn;
    lash = max(lash, fLine(p.y - (yTop + (xn - 0.75) * b * 0.9), lt * 0.45, aa) * step(0.75, xn) * step(xo, a * 1.28));
    // closed / happy lids
    float cl = 1.0 - smoothstep(0.05, 0.14, open);
    float arcY = mix(closedY, b * 0.25 * bowl - b * 0.1, happy);
    float closedLine = fLine(p.y - arcY, lt * 0.55, aa) * step(abs(xo), a * 1.02) * max(cl, happy);
    // lower lid line (thin, soft)
    float low = fLine(p.y - yBot, b * 0.05, aa) * step(abs(xo), a * 0.85) * smoothstep(0.1, 0.4, open) * 0.45;
    // lower lashes at the outer third; the fold of the upper lid
    low = max(low, fLine(p.y - yBot + b * 0.03, b * 0.075, aa) * step(a * 0.35, xo) * step(xo, a * 0.98) * smoothstep(0.3, 0.6, open) * uFaceX.w);
    float fold = fLine(p.y - yTop - b * (0.3 + 0.1 * bowl), b * 0.028, aa) * step(abs(xo - a * 0.1), a * 0.72) * smoothstep(0.5, 0.8, open) * (1.0 - happy);
    col = mix(col, col * vec3(0.72, 0.5, 0.48), fold * 0.7 * front);
    col = mix(col, uLash, max(max(lash * smoothstep(0.08, 0.2, open) * (1.0 - happy), closedLine), low) * front);
    // ---- brows
    {
      vec2 bq = vec2(xo, p.y) + vec2(ec.x * sx - uBrowP.x, ec.y - uBrowP.y);
      float L = uBrowP.z;
      float bxn = clamp((bq.x + uBrow.z * L * 0.18) / L, -1.0, 1.0);
      float by = uBrow.x * 0.12 + uBrowP.w * (1.0 - bxn * bxn) * 0.06 - uBrow.y * bxn * 0.07 - uBrow.z * (1.0 - bxn) * 0.03;
      float bth = uBrow.w * (1.0 - 0.45 * (bxn * 0.5 + 0.5));
      float inb = smoothstep(L + aa, L - aa, abs(bq.x + uBrow.z * L * 0.18));
      float brow = fLine(bq.y - by, bth, aa) * inb;
      col = mix(col, uBrowC, brow * front);
      // wrinkles: under-eye and smile lines (elderly)
      if (uCheek.y > 0.0) {
        float w1 = fLine(p.y + b * 1.45 + 0.08 * xn * xn, 0.007, aa) * step(abs(xo), a * 0.8);
        vec2 nl = vec2(abs(f.x) - 0.2 - (f.y + 0.3) * 0.25, f.y + 0.38);
        float w2 = fLine(nl.x, 0.008, aa) * step(abs(nl.y), 0.14);
        float w3 = fLine(length(vec2(xo - a * 1.25, p.y)) - 0.06, 0.006, aa) * step(0.0, xo - a * 1.2);
        float w4 = fLine(bq.y - by - 0.12, 0.006, aa) * step(abs(bq.x), L * 0.7);
        col = mix(col, col * 0.72, max(max(w1, w2), max(w3, w4)) * uCheek.y * front);
      }
    }
    // ---- mouth
    {
      vec2 m = f - vec2(0.0, uMouthP.x);
      float W = uMouth.z * (1.0 - uMouth.w * 0.45);
      float xm = m.x / W;
      float inx = step(abs(xm), 1.0);
      float bw = sqrt(max(0.0, 1.0 - xm * xm));
      float cy = uMouth.y * 0.09 * xm * xm - uMouth.y * 0.02;
      float o = uMouth.x;
      // lip tint and the soft shadow under the lower lip
      col = mix(col, uBlushC * 0.92, exp(-(xm * xm) * 1.6 - pow((m.y - cy + 0.012) / 0.05, 2.0)) * uFaceX.z * 0.7 * front);
      col *= mix(vec3(1.0), vec3(0.86, 0.68, 0.66), fLine(m.y - cy + 0.085, 0.014, aa) * step(abs(xm), 0.42) * 0.55 * front);
      float H = 0.2 * (0.55 + uMouth.w * 0.6);
      float yU = cy + o * H * 0.35 * mix(bw, sqrt(bw), uMouth.w) + 0.002;
      float yL = cy - o * H * mix(bw, sqrt(bw), uMouth.w) * (0.8 + 0.2 * uMouthP.w);
      float inside = inx * smoothstep(yL - aa, yL + aa, m.y) * (1.0 - smoothstep(yU - aa, yU + aa, m.y)) * step(0.02, o);
      vec3 mc = vec3(0.32, 0.08, 0.1);
      float tongue = smoothstep(yL + (yU - yL) * 0.45, yL, m.y);
      mc = mix(mc, vec3(0.75, 0.3, 0.32), tongue * 0.8);
      float teeth = step(yU - (yU - yL) * 0.22, m.y) * uMouthP.z * step(0.25, o);
      mc = mix(mc, vec3(0.97, 0.95, 0.9), teeth);
      col = mix(col, mc, inside * front);
      float lw = 0.02 * (1.0 + uMouthP.y * 0.3);
      float line = fLine(m.y - cy, lw * (0.35 + 0.65 * bw), aa) * step(abs(xm), 1.05) * (1.0 - smoothstep(0.02, 0.12, o));
      float rim = (fLine(m.y - yU, lw * 0.6, aa) + fLine(m.y - yL, lw * 0.45, aa)) * inx * smoothstep(0.02, 0.1, o);
      // corner dimples when smiling
      float dim = fLine(length(vec2(abs(m.x) - W * 1.05, m.y - cy - 0.01)) - 0.018, 0.005, aa) * smoothstep(0.35, 0.8, uMouth.y) * step(m.y, cy + 0.03);
      col = mix(col, uLash * 0.5 + col * 0.35, clamp(line + rim + dim * 0.6, 0.0, 1.0) * front);
    }
    diffuseColor.rgb = col;
  }
}
`;
export function faceMat(color, o = {}) {
  const m = bodyMat(color, { rim: o.rim ?? 0.36 });
  const u = {
    uFaceC: { value: new THREE.Vector4(0, 1.6, 0, 0.16) },
    uEyeP: { value: new THREE.Vector4(0.36, 0.02, 0.22, 0.2) },
    uEyeS: { value: new THREE.Vector4(1, 0, 0, 0) },
    uLook: { value: new THREE.Vector4(0, 0, 0.72, 0.42) },
    uIris: { value: new THREE.Color(0x3a5a7a) },
    uLash: { value: new THREE.Color(0x221612) },
    uBrow: { value: new THREE.Vector4(0, 0, 0, 0.028) },
    uBrowP: { value: new THREE.Vector4(0.38, 0.33, 0.2, 0.5) },
    uBrowC: { value: new THREE.Color(0x3a2418) },
    uMouth: { value: new THREE.Vector4(0, 0.1, 0.16, 0) },
    uMouthP: { value: new THREE.Vector4(-0.5, 0, 1, 1) },
    uCheek: { value: new THREE.Vector4(0, 0, 0, 0.16) },
    uBlushC: { value: new THREE.Color(0xf09088) },
    uFaceX: { value: new THREE.Vector4(9, -0.36, 0, 0) },
  };
  m.userData.face = u;
  extend(m, 'face', (sh) => {
    Object.assign(sh.uniforms, u);
    OBJ_VERT(sh);
    sh.fragmentShader = FACE_PARS + sh.fragmentShader.replace('#include <color_fragment>', FACE_FRAG);
  });
  return m;
}

// Skin of an authored, sculpted head (ref/blender/ch_face.py). The mesh carries the forms and the
// expressions (shape keys); this shader adds what is drawn on them, in the face coordinates
// stored in the UV map (head radii about the head centre, so it follows the moving lids and
// lips): lash lines on the lid margins, the lip tint and line, nostrils, blush. `surf` tells
// the parts apart: 0 plain skin, 1 face skin, 2 eyeball (iris, pupil, catchlights painted on
// the ball around the gaze direction), 3 lid rim, 4 mouth interior, 5 brow hair.
// Skin is lit softly instead of with the hard toon band: a wide terminator, a warm lifted
// shadow and a little blood colour along it, so the sculpted forms read.
const FACE2_PARS = `
varying vec3 vObj;
varying vec2 vFace;
varying float vSurfF;
uniform vec4 uFaceC;   // head centre (bind space), radius
uniform vec4 uEyeA;    // eye x, y, half width, tilt
uniform vec4 uEyeB;    // upper height, lower height, eyeball radius, eyeball centre z
uniform vec4 uLook;    // gaze x, y (-1..1), iris angular radius, pupil size (rel.)
uniform vec3 uIris;
uniform vec3 uLash;
uniform vec4 uMouthP;  // mouth y, half width, upper lip height, lower lip height
uniform vec4 uCheek;   // blush, wrinkles, freckles, lash thickness
uniform vec3 uBlushC;
uniform vec4 uFaceX;   // fringe shadow line y (9 = none), nose tip y, lip tint, lower lash
float fLine(float d, float w, float aa) { return 1.0 - smoothstep(w - aa, w + aa, abs(d)); }
float eyeU(float t) { return uEyeA.y + uEyeB.x * pow(max(0.0, 1.0 - pow(abs(t), 2.3)), 0.75) * (1.0 - 0.1 * t) + uEyeA.w * uEyeA.z * t; }
float eyeL(float t) { return uEyeA.y - uEyeB.y * pow(max(0.0, 1.0 - t * t), 0.8) * (1.0 - 0.3 * t) + uEyeA.w * uEyeA.z * t; }
float lipT(float x) { float q = min(1.0, abs(x) / uMouthP.y); return uMouthP.x + uMouthP.z * pow(max(0.0, 1.0 - pow(q, 2.2)), 0.7) * (1.0 + 0.28 * exp(-pow((q - 0.33) / 0.2, 2.0)) - 0.16 * exp(-pow(q / 0.14, 2.0))); }
float lipB(float x) { float q = min(1.0, abs(x) / uMouthP.y); return uMouthP.x - uMouthP.w * pow(max(0.0, 1.0 - q * q), 0.75); }
`;
const FACE2_FRAG = `
#include <color_fragment>
float _eyeball = 0.0;
{
  vec2 f = vFace;
  vec3 q3 = (vObj - uFaceC.xyz) / uFaceC.w;
  float aa = max(fwidth(f.x), fwidth(f.y)) + 0.0012;
  float sx = f.x < 0.0 ? -1.0 : 1.0;
  float t = (abs(f.x) - uEyeA.x) / uEyeA.z, tc = clamp(t, -1.0, 1.0);
  float yU = eyeU(tc), yL = eyeL(tc);
  if (vSurfF < 0.5) {
    // the jaw's shadow on the throat
    if (q3.y < -0.8 && q3.y > -2.4 && abs(q3.x) < 0.7 && q3.z < 0.5) {
      float ns = smoothstep(-1.3 - 0.16 * cos(q3.x * 4.0), -1.16 - 0.16 * cos(q3.x * 4.0), q3.y);
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.84, 0.68, 0.66), ns);
    }
  } else if (vSurfF < 1.5) {
    vec3 col = diffuseColor.rgb;
    // fringe shadow, blush, freckles
    float hy = uFaceX.x - 0.05 * cos(f.x * 7.0) - 0.035 * cos(f.x * 19.0 + 1.0);
    col *= mix(vec3(1.0), vec3(0.86, 0.72, 0.7), smoothstep(hy - 0.02, hy + 0.02, f.y));
    vec2 bc = vec2(abs(f.x) - 0.44, f.y + 0.3);
    col = mix(col, uBlushC, exp(-dot(bc, bc) / 0.03) * uCheek.x * 0.4);
    col = mix(col, col * vec3(1.06, 0.86, 0.8), exp(-pow(f.x / 0.08, 2.0) - pow((f.y - uFaceX.y) / 0.06, 2.0)) * 0.5);      // warmth at the nose tip
    if (uCheek.z > 0.0) {
      vec2 fp = f * 30.0; vec2 cell = floor(fp); vec2 fr = fract(fp) - 0.5;
      float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
      float zone = exp(-pow((abs(f.x) - 0.26) / 0.24, 2.0) - pow((f.y + 0.2) / 0.12, 2.0));
      col = mix(col, col * vec3(0.76, 0.58, 0.48), (1.0 - smoothstep(0.1, 0.2, length(fr - (h - 0.5) * 0.4))) * step(0.5, h) * zone * uCheek.z);
    }
    // nostrils
    vec2 nq = (vec2(abs(f.x) - 0.045, f.y - uFaceX.y + 0.034)) / vec2(0.02, 0.011);
    col = mix(col, col * vec3(0.38, 0.22, 0.2), (1.0 - smoothstep(0.6, 1.1, length(nq))) * 0.85);
    // lids: lash line along the upper margin, thickening outwards into a short flick;
    // a finer line under the lower margin; the fold of the upper lid
    float lt = uEyeB.x * uCheek.w * (0.6 + 0.55 * smoothstep(-0.7, 1.0, t));
    float lash = (1.0 - smoothstep(lt - aa, lt + aa, f.y - yU)) * step(yU - 0.01, f.y) * (1.0 - smoothstep(1.0, 1.04, abs(t)));
    float fy = yU + (t - 1.0) * uEyeA.z * 0.55;
    lash = max(lash, fLine(f.y - fy - lt * 0.3, lt * 0.55 * clamp((1.4 - t) / 0.4, 0.0, 1.0), aa) * step(0.96, t) * step(t, 1.4));
    float low = (1.0 - smoothstep(0.004, 0.004 + aa * 2.0, yL - f.y)) * step(f.y, yL + 0.01) * step(abs(t), 1.0) * (0.25 + 0.75 * uFaceX.w) * smoothstep(-0.2, 0.6, t) * 0.7;
    float fold = fLine(f.y - yU - uEyeB.x * (0.42 + 0.2 * (1.0 - tc * tc)), 0.006, aa) * step(abs(t - 0.05), 0.9);
    col = mix(col, col * vec3(0.7, 0.5, 0.46), fold * 0.6);
    col = mix(col, uLash, max(lash, low));
    // lips: vermilion tint between the borders, the line of the mouth
    float xm = abs(f.x) / uMouthP.y;
    float lipm = smoothstep(lipB(f.x) - 0.006, lipB(f.x) + 0.012, f.y) * (1.0 - smoothstep(lipT(f.x) - 0.012, lipT(f.x) + 0.006, f.y)) * (1.0 - smoothstep(0.92, 1.03, xm));
    col = mix(col, col * vec3(1.0, 0.72, 0.7) * 0.94 + vec3(0.03, 0.0, 0.0), lipm * (0.35 + 0.55 * uFaceX.z));
    col = mix(col, col * vec3(0.5, 0.28, 0.28), fLine(f.y - uMouthP.x, 0.0055, aa) * (1.0 - smoothstep(0.98, 1.06, xm)) * 0.9);
    // age lines
    if (uCheek.y > 0.0) {
      float w1 = fLine(f.y - yL + uEyeB.y * 0.9 + 0.05 * tc * tc, 0.005, aa) * step(abs(t), 0.85);
      float w3 = fLine(length(vec2(t - 1.25, (f.y - uEyeA.y) / uEyeA.z)) - 0.3, 0.02, aa * 4.0) * step(1.25, t);
      col = mix(col, col * 0.74, max(w1, w3) * uCheek.y);
    }
    diffuseColor.rgb = col;
  } else if (vSurfF < 2.5) {
    // eyeball: iris, limbal ring, pupil and catchlights around the gaze direction
    _eyeball = 1.0;
    vec3 ec = vec3(sx * uEyeA.x, uEyeA.y, uEyeB.w);
    vec3 d = normalize(q3 - ec);
    vec3 fw = normalize(vec3(uLook.x * 0.42, uLook.y * 0.3, 1.0));
    vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw)), up = cross(fw, rt);
    vec2 ip = vec2(dot(d, rt), dot(d, up)) / max(dot(d, fw), 0.2);       // gnomonic coords about the gaze
    float ir = uLook.z, di = length(ip);
    vec3 col = vec3(0.95, 0.94, 0.92);
    col *= mix(vec3(0.62, 0.64, 0.74), vec3(1.0), smoothstep(0.0, uEyeB.x * 0.9, yU - f.y));        // the upper lid's shadow
    col *= 1.0 - 0.25 * smoothstep(0.55, 1.0, abs(t));
    float upk = smoothstep(-ir, ir, ip.y);
    vec3 iris = mix(uIris * 1.6 + vec3(0.06), uIris * 0.45, smoothstep(0.1, 0.9, upk));
    float ang = atan(ip.y, ip.x);
    iris *= 0.86 + 0.14 * sin(ang * 26.0 + sin(ang * 7.0) * 2.0) * smoothstep(0.2, 0.7, di / ir);
    iris = mix(iris, uIris * 0.16, smoothstep(ir * 0.8, ir, di));
    iris = mix(iris, uIris * 2.0 + vec3(0.12), (1.0 - smoothstep(ir * 0.3, ir * 0.62, length(ip - vec2(0.0, -ir * 0.3)))) * 0.45);
    col = mix(col, iris, 1.0 - smoothstep(ir - aa * 3.0, ir + aa * 3.0, di));
    float pr = ir * uLook.w;
    col = mix(col, vec3(0.02, 0.015, 0.03), 1.0 - smoothstep(pr - aa * 3.0, pr + aa * 3.0, di));
    float h1 = 1.0 - smoothstep(ir * 0.22, ir * 0.3, length((ip - vec2(ir * 0.38, ir * 0.42)) * vec2(1.0, 1.2)));
    float h2 = 1.0 - smoothstep(ir * 0.08, ir * 0.13, length(ip - vec2(-ir * 0.36, -ir * 0.4)));
    col = mix(col, vec3(1.0), max(h1, h2 * 0.8));
    diffuseColor.rgb = col;
  } else if (vSurfF < 3.5) {
    diffuseColor.rgb = f.y > (yU + yL) * 0.5 ? uLash : diffuseColor.rgb * vec3(0.72, 0.5, 0.48);
  }
}
`;
const SKIN_SOFT = `
#if NUM_SUN_LIGHTS > 0
if (vSurfF < 1.5) {
  float _ndl = dot(normal, sunLights[0].direction);
  float _g = texture2D(gradientMap, vec2(clamp(_ndl * 0.5 + 0.5, 0.0, 1.0), 0.5)).r;
  float _sh = _dirShadow * _cloudSh;
  vec3 _base = reflectedLight.directDiffuse / mix(uShadeTint, vec3(1.0), _g * _sh);
  float _soft = smoothstep(-0.34, 0.52, _ndl) * mix(0.2, 1.0, _sh);
  vec3 _shade = uShadeTint * vec3(1.55, 1.1, 0.96) + vec3(0.11, 0.035, 0.02);
  vec3 _sss = vec3(0.34, 0.08, 0.03) * exp(-pow((_ndl - 0.04) / 0.3, 2.0)) * (0.3 + 0.7 * _sh);
  outgoingLight = _base * (mix(_shade, vec3(1.0), _soft) + _sss) + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
} else if (_eyeball > 0.5) {
  outgoingLight = max(outgoingLight, diffuseColor.rgb * 0.34);       // eyes never go dead in shade
}
#endif
`;
export function faceMat2(color, o = {}) {
  const m = bodyMat(color, { rim: o.rim ?? 0.3, vertexColors: true });
  const u = {
    uFaceC: { value: new THREE.Vector4(0, 1.6, 0, 0.13) }, uEyeA: { value: new THREE.Vector4(0.34, -0.05, 0.17, 0.08) }, uEyeB: { value: new THREE.Vector4(0.09, 0.05, 0.2, 0.6) },
    uLook: { value: new THREE.Vector4(0, 0, 0.5, 0.42) }, uIris: { value: new THREE.Color(0x3a5a7a) }, uLash: { value: new THREE.Color(0x221612) },
    uMouthP: { value: new THREE.Vector4(-0.64, 0.15, 0.06, 0.08) }, uCheek: { value: new THREE.Vector4(0, 0, 0, 0.2) }, uBlushC: { value: new THREE.Color(0xf09088) },
    uFaceX: { value: new THREE.Vector4(9, -0.4, 0, 0) },
  };
  m.userData.face = u;
  extend(m, 'face2', (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float surf;\nvarying float vSurfF;\nvarying vec2 vFace;\nvarying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vSurfF = surf; vFace = vec2(uv.x, 1.0 - uv.y);');
    let fs = FACE2_PARS + sh.fragmentShader.replace('#include <color_fragment>', FACE2_FRAG).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (_eyeball > 0.5) { _specK = 9.0; _rough = 0.16; }');
    const at = fs.indexOf('if (uDissolve > 0.0) outgoingLight +=');
    if (at > 0) fs = fs.slice(0, at) + SKIN_SOFT + fs.slice(at);
    sh.fragmentShader = fs;
  });
  return m;
}

// Skin of a modelled character (ref/blender/c2_*.py): the albedo is painted per vertex and the
// forms are in the mesh, so the shader only lights it. `surf`: 0 skin (wide terminator, warm
// lifted shade, a little blood colour along it, soft sheen), 4 mouth interior (wet),
// 5 brows and lashes (matte).
const SKIN2_LIGHT = `
#if NUM_SUN_LIGHTS > 0
if (vSurfF < 0.5) {
  float _ndl = dot(normal, sunLights[0].direction);
  float _g = texture2D(gradientMap, vec2(clamp(_ndl * 0.5 + 0.5, 0.0, 1.0), 0.5)).r;
  float _sh = _dirShadow * _cloudSh;
  vec3 _base = reflectedLight.directDiffuse / mix(uShadeTint, vec3(1.0), _g * _sh);
  float _soft = smoothstep(-0.3, 0.62, _ndl) * mix(0.16, 1.0, _sh);
  vec3 _shade = uShadeTint * vec3(1.5, 1.08, 0.96) + vec3(0.1, 0.03, 0.02);
  vec3 _sss = vec3(0.3, 0.07, 0.03) * exp(-pow((_ndl - 0.02) / 0.3, 2.0)) * (0.25 + 0.75 * _sh);
  vec3 _vd = normalize(vViewPosition);
  vec3 _hv = normalize(sunLights[0].direction + _vd);
  float _spec = pow(max(dot(normal, _hv), 0.0), 26.0) * 0.07 * _sh * max(_ndl, 0.0);
  outgoingLight = _base * (mix(_shade, vec3(1.0), _soft) + _sss) + sunLights[0].color * _spec + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
}
#endif
// teeth and tongue keep some light of their own: an open mouth must not read as a black hole or grey teeth
if (_mouthLit > 0.0) outgoingLight = max(outgoingLight, diffuseColor.rgb * _mouthLit);
`;
// Baked maps of a modelled character on a toon material (tex: { map, normalMap, orm }): the
// albedo replaces the vertex colours, the normal map is read in the frame of the uv derivatives.
function mapped(m, tex) {
  m.map = tex.map; m.normalMap = tex.normalMap || null;
  m.defines = { ...(m.defines || {}), CH_TEX: 1 };
  return { uOrm: { value: tex.orm || null } };
}
export function skinMat(o = {}) {
  const m = bodyMat(0xffffff, { rim: o.rim ?? 0.16, vertexColors: !o.tex });
  if (o.tex) mapped(m, o.tex);
  // uBlush: the cheeks' place in bind space (|x|, y, z, radius); uBlushK: how flushed they are (HumanRig.facePerson)
  const u = { uBlush: { value: new THREE.Vector4(0.07, 1.5, 0.1, 0.04) }, uBlushK: { value: 0 } };
  m.userData.skin = u;
  extend(m, 'skin2', (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float surf;\nvarying float vSurfF;\nvarying vec3 vBindP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurfF = surf; vBindP = position;');
    let fs = 'varying float vSurfF;\nvarying vec3 vBindP;\nuniform vec4 uBlush;\nuniform float uBlushK;\nfloat _mouthLit = 0.0;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (vSurfF > 3.5 && vSurfF < 4.5) {
  // inside the mouth: teeth a clean warm white, everything else one soft dark rose (no black gaps)
  float _tooth = smoothstep(0.35, 0.6, diffuseColor.g);
  diffuseColor.rgb = mix(max(diffuseColor.rgb, vec3(0.3, 0.1, 0.11)), vec3(0.97, 0.94, 0.88), _tooth);
  _specK = 5.0 * (1.0 - _tooth); _rough = 0.25; _mouthLit = mix(0.42, 0.72, _tooth);
}
if (uBlushK > 0.0 && vSurfF < 0.5) { vec3 _bp = vec3(abs(vBindP.x), vBindP.yz) - uBlush.xyz; _bp.y *= 1.25; diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.74, 0.72), exp(-dot(_bp, _bp) / (uBlush.w * uBlush.w)) * uBlushK); }`);
    const at = fs.indexOf('if (uDissolve > 0.0) outgoingLight +=');
    if (at > 0) fs = fs.slice(0, at) + SKIN2_LIGHT + fs.slice(at);
    sh.fragmentShader = fs;
  });
  return m;
}

// Eyeball of a modelled character. uv holds the position on the ball about its forward axis
// (0.5 = the pole; radius 0.5 = the equator, beyond it the back half), so iris, pupil and
// catchlights are drawn there and turn with the eye bone.
const EYE_FRAG = `
#include <color_fragment>
{
  vec2 e = (vEyeUv - 0.5) * vec2(2.0, -2.0);          // +y up (the model's v runs down the ball)
  float r = length(e), ir = uEye.x, aa = fwidth(r) + 0.004;
  vec3 col = mix(vec3(0.95, 0.935, 0.91), vec3(0.8, 0.62, 0.6), smoothstep(0.62, 1.05, r));          // sclera, pinker towards the corners
  float ang = atan(e.y, e.x), q = r / ir, soft = uEye.w;
  // a very dark iris would read as one black disc with the pupil: its lit lower half is lifted
  // towards the colour it has in light (blue and green eyes are bright enough and stay as painted)
  float dark = smoothstep(0.1, 0.02, dot(uIrisC, vec3(0.3, 0.55, 0.15)));
  vec3 lit = mix(uIrisC * 2.1 + 0.1, pow(uIrisC, vec3(0.62)) * 0.9 + 0.05, max(dark * 0.8, soft * 0.5));
  vec3 iris = uIrisC * mix(1.25, 0.62, smoothstep(0.25, 1.0, q));
  iris *= 0.88 + 0.12 * sin(ang * 31.0 + sin(ang * 9.0) * 2.5) * smoothstep(0.3, 0.8, q);              // fibres
  iris = mix(iris, lit, (1.0 - smoothstep(0.2, mix(0.75, 0.95, max(dark, soft)), length(e / ir - vec2(0.0, -0.42)))) * mix(0.55, 0.8, max(dark, soft)));   // light pooling at the bottom
  iris = mix(iris, uIrisC * 0.38, smoothstep(0.0, 1.0, e.y / ir) * mix(0.55, 0.3, soft));              // the upper lid's shade
  iris = mix(iris, uIrisC * 0.14, smoothstep(0.8, 0.98, q) * (1.0 - 0.3 * soft));                      // limbal ring
  col = mix(col, iris, 1.0 - smoothstep(ir - aa, ir + aa, r));
  float pr = ir * uEye.y;
  col = mix(col, vec3(0.012, 0.01, 0.018), 1.0 - smoothstep(pr - aa, pr + aa, r));
  // the lids' shadow lies on the ball in the head's frame, so it stays put when the eye turns:
  // deep under the upper lid, a soft rim all round where the lids meet the ball
  vec3 dh = uEyeR * vec3(e, sqrt(max(1.0 - r * r, 0.0)));
  col *= mix(1.0, mix(0.52, 0.7, soft), smoothstep(0.02, 0.62, dh.y)) * mix(1.0, 0.8, smoothstep(0.35, 0.95, length(dh.xy)));
  // catchlights (soft: a larger main one, a child's or any face that should read as gentle)
  float hs = 1.0 + 0.35 * soft;
  float h1 = 1.0 - smoothstep(0.1 * hs, 0.27 * hs, length((e / ir - vec2(-0.34, 0.36)) * vec2(1.0, 1.15)));
  float h2 = 1.0 - smoothstep(0.03 * hs, 0.13 * hs, length(e / ir - vec2(0.36, -0.38)));
  _eyeHi = max(h1 * 0.78, h2 * 0.45) * uEye.z * (1.0 - mix(0.6, 0.3, soft) * smoothstep(0.1, 0.6, dh.y));
  diffuseColor.rgb = col;
}
`;
export function eyeMat(iris = 0x3a5a7a, o = {}) {
  const m = bodyMat(0xffffff, { rim: 0 });
  // uEyeR: the eye bones' turn out of their rest direction (HumanRig.updateFace)
  const u = { uIrisC: { value: new THREE.Color(iris) }, uEye: { value: new THREE.Vector4(o.iris ?? 0.56, o.pupil ?? 0.4, 1, o.soft ?? 0) }, uEyeR: { value: new THREE.Matrix3() } };
  m.userData.eye = u;
  extend(m, 'eye2', (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec2 vEyeUv;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeUv = uv;');
    let fs = 'varying vec2 vEyeUv;\nuniform vec3 uIrisC;\nuniform vec4 uEye;\nuniform mat3 uEyeR;\nfloat _eyeHi = 0.0;\n' + sh.fragmentShader.replace('#include <color_fragment>', EYE_FRAG)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n_specK = 7.0; _rough = 0.14;');
    const at = fs.indexOf('if (uDissolve > 0.0) outgoingLight +=');
    // eyes never go dead in shade; the painted catchlights sit on top of the lighting
    if (at > 0) fs = fs.slice(0, at) + 'outgoingLight = max(outgoingLight, diffuseColor.rgb * 0.3) + vec3(_eyeHi) * (0.5 + 0.5 * _dirShadow * _cloudSh);\n' + fs.slice(at);
    sh.fragmentShader = fs;
  });
  return m;
}

// Clothing and hair: one vertex-coloured material whose response follows the per-vertex
// `surf` kind (Sculpt.build o.surf): 0 woven cloth, 1 leather, 2 polished metal, 3 hair
// (strand streaks, a highlight ring around the crown in bind space), 4 matte, 5 gem.
export const SURF = { cloth: 0, leather: 1, metal: 2, hair: 3, matte: 4, gem: 5 };
const CLOTH_PARS = `
varying vec3 vObj;
varying float vSurf;
uniform vec4 uHairC;   // head centre (bind space), radius
`;
const CLOTH_FRAG = `
#include <emissivemap_fragment>
{
  float _nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  float _px = length(fwidth(vObj));
  if (vSurf < 0.5) {
    // warp and weft, faded out before the threads alias; soft dye mottling; a nap that
    // catches light at grazing angles
    vec3 q = vObj * 1500.0;
    diffuseColor.rgb *= 1.0 + 0.085 * sin(q.y) * sin(q.x + q.z) * (1.0 - smoothstep(0.0009, 0.0026, _px));
    diffuseColor.rgb *= 0.95 + 0.1 * _dn(vObj * 11.0);
    diffuseColor.rgb *= 1.0 + 0.16 * pow(1.0 - _nv, 3.0);
  } else if (vSurf < 1.5) {
    float g = _dn(vObj * 210.0) * (1.0 - smoothstep(0.002, 0.006, _px));
    diffuseColor.rgb *= (0.93 + 0.14 * g) * (0.9 + 0.2 * _dn(vObj * 17.0));
    _specK = 2.6; _rough = 0.4;
  } else if (vSurf < 2.5) {
    // the sky above and the ground below, mirrored in a few hard bands
    float e = reflect(-normalize(vViewPosition), normal).y;
    diffuseColor.rgb *= 0.62 + 0.42 * smoothstep(-0.25, -0.1, e) + 0.3 * smoothstep(0.42, 0.5, e);
    _specK = 7.0; _rough = 0.26;
  } else if (vSurf < 3.5) {
    vec3 hd = vObj - uHairC.xyz;
    float hl = length(hd) / uHairC.w;
    hd = normalize(hd);
    float lon = atan(hd.x, hd.z);
    float st = _dn(vec3(lon * 13.0, hd.y * 1.2, hl * 0.7));
    float fine = _dn(vec3(lon * 46.0, hd.y * 2.0, hl * 1.4));
    diffuseColor.rgb *= 0.9 + 0.12 * st + 0.08 * fine;
    // highlight ring, toothed along the strands, on the side that faces the viewer
    float ring = abs(hd.y - 0.5 - (st - 0.5) * 0.3 - (fine - 0.5) * 0.12);
    float band = (1.0 - smoothstep(0.035, 0.075, ring)) * smoothstep(1.55, 1.2, hl) * smoothstep(0.25, 0.6, _nv);
    diffuseColor.rgb += (diffuseColor.rgb * 0.7 + 0.16) * band * 0.75;
    _specK = 1.2; _rough = 0.5;
  } else if (vSurf > 4.5) {
    float e = reflect(-normalize(vViewPosition), normal).y;
    diffuseColor.rgb *= 0.75 + 0.6 * smoothstep(0.1, 0.3, e);
    totalEmissiveRadiance += diffuseColor.rgb * 0.3;
    _specK = 9.0; _rough = 0.18;
  }
}
`;
// With baked maps (o.tex) the ORM texture sets occlusion and roughness per texel and `surf` only
// picks the kind of response.
const CLOTH_TEX_FRAG = `
#include <emissivemap_fragment>
{
  vec4 _mo = texture2D( uOrm, vMapUv );
  float _nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  float _px = length(fwidth(vObj));
  _rough = clamp(_mo.g, 0.08, 1.0); _cav = mix(1.0, _mo.r, 0.75);
  if (vSurf < 0.5) {
    // threads below the texel size of the maps; the nap catches light at grazing angles
    vec3 q = vObj * 1500.0;
    diffuseColor.rgb *= 1.0 + 0.06 * sin(q.y) * sin(q.x + q.z) * (1.0 - smoothstep(0.0009, 0.0026, _px));
    diffuseColor.rgb *= 1.0 + 0.2 * pow(1.0 - _nv, 3.0) * _mo.g;
    _specK = 0.35;
  } else if (vSurf < 1.5) {
    _specK = 1.1;
  } else if (vSurf < 2.5) {
    float e = reflect(-normalize(vViewPosition), normal).y;
    diffuseColor.rgb *= 0.7 + 0.3 * smoothstep(-0.3, 0.1, e) + 0.22 * smoothstep(0.3, 0.6, e);
    _specK = 5.0;
  } else if (vSurf < 3.5) {
    // hair: the strands run along v of their uv strips (never turned in the atlas). The locks are
    // lit as one mass: their normals lean towards the head's own, so no lock has a dark side
    _hairT = normalize(tbn[1] + vec3(1e-5)); _specK = 0.0; _shK = 0.3;      // and locks barely shadow each other
    vec3 _hn = normalize(vHairN);
    normal = normalize(mix(normal, _hn, 0.6)); nonPerturbedNormal = normalize(mix(nonPerturbedNormal, _hn, 0.6));
  } else if (vSurf > 4.5) {
    float e = reflect(-normalize(vViewPosition), normal).y;
    diffuseColor.rgb *= 0.75 + 0.6 * smoothstep(0.1, 0.3, e);
    totalEmissiveRadiance += diffuseColor.rgb * 0.3;
    _specK = 9.0; _rough = 0.18;
  } else {
    _specK = 0.15;
  }
}
`;
// hair highlight (Kajiya-Kay about the strand direction, widened and softened), added to the lit result
const CLOTH_TEX_OUT = `
#if NUM_SUN_LIGHTS > 0
{
  // relief: the toon ramp is flat in the light and in the shade, so the baked forms are lit on
  // their own: by the sun where it reaches, by the sky elsewhere
  vec3 _dn = normal - nonPerturbedNormal;
  float _sl = _dirShadow * _cloudSh * smoothstep(-0.1, 0.25, dot(nonPerturbedNormal, sunLights[0].direction));
  float _rl = dot(_dn, sunLights[0].direction) * _sl + dot(_dn, normalize((viewMatrix * vec4(0.25, 1.0, 0.1, 0.0)).xyz)) * (0.55 - 0.3 * _sl);
  outgoingLight *= 1.0 + clamp(_rl * uRelief, -0.5, 0.4);
}
if (vSurf > 2.5 && vSurf < 3.5) {
  // a broad soft band across the strands (Kajiya-Kay), ruffled by the grooves of the normal map
  vec3 _vd = normalize(vViewPosition), _l = sunLights[0].direction;
  vec3 _t = normalize(_hairT + (normal - nonPerturbedNormal) * 0.55 + nonPerturbedNormal * 0.14);
  vec3 _hv = normalize(_l + _vd);
  float _th = dot(_t, _hv), _s1 = sqrt(max(1.0 - _th * _th, 0.0));
  float _sh = 0.3 + 0.7 * _dirShadow * _cloudSh;
  float _wrap = smoothstep(-0.2, 0.6, dot(nonPerturbedNormal, _l)) * smoothstep(0.0, 0.5, dot(nonPerturbedNormal, _vd));
  // (dark hair needs a strong band to show at all; white hair must not burn out)
  vec3 _hc = diffuseColor.rgb * mix(3.2, 0.45, smoothstep(0.08, 0.6, dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1)))) + vec3(0.05, 0.042, 0.035);
  outgoingLight += sunLights[0].color * _hc * (pow(_s1, 9.0) * 0.2 + pow(_s1, 40.0) * 0.14) * _wrap * _sh * _cav;
}
#endif
`;
export function clothMat(o = {}) {
  const m = bodyMat(0xffffff, { vertexColors: !o.tex, rim: o.rim ?? 0.34 });
  const u = { uHairC: { value: new THREE.Vector4(0, 1.6, 0, 0.13) } };
  if (o.tex) Object.assign(u, mapped(m, o.tex), { uRelief: { value: o.relief ?? 1.1 } });
  m.userData.cloth = u;
  extend(m, o.tex ? 'clothT' : 'cloth', (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float surf;\nvarying float vSurf;\nvarying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vSurf = surf;');
    if (!o.tex) { sh.fragmentShader = CLOTH_PARS + sh.fragmentShader.replace('#include <emissivemap_fragment>', CLOTH_FRAG); return; }
    // direction out of the head through the vertex, carried with the skin (hair shading)
    sh.vertexShader = 'uniform vec4 uHairC;\nvarying vec3 vHairN;\n' + sh.vertexShader.replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
  vec3 _hn = position - uHairC.xyz;
  #ifdef USE_SKINNING
    _hn = ( skinMatrix * vec4( _hn, 0.0 ) ).xyz;
  #endif
  vHairN = normalMatrix * _hn;`);
    let fs = CLOTH_PARS + 'varying vec3 vHairN;\nuniform sampler2D uOrm;\nuniform float uRelief;\nvec3 _hairT = vec3(0.0, 1.0, 0.0);\nfloat _shK = 1.0;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', CLOTH_TEX_FRAG)
      .replace('float lit = g * _dirShadow * _cloudSh;', 'float lit = g * mix( 1.0, _dirShadow, _shK ) * _cloudSh;')
      // the sculpted forms read in the light as well as along the terminator
      .replace('float g = texture2D( gradientMap, vec2( clamp( ndl * 0.5 + 0.5, 0.0, 1.0 ), 0.5 ) ).r;', 'float g = 0.6 * smoothstep( -0.14, 0.1, ndl ) + 0.4 * smoothstep( -0.1, 0.85, ndl );');
    const at = fs.indexOf('if (uDissolve > 0.0) outgoingLight +=');
    if (at > 0) fs = fs.slice(0, at) + CLOTH_TEX_OUT + fs.slice(at);
    sh.fragmentShader = fs;
  });
  return m;
}

// Ash-crack body: mottled ash with glowing cracks whose color follows `glowColor`
// (a THREE.Color shared with the enemy's tier-colored glow material).
const CRACK_PARS = `
varying vec3 vObj;
uniform vec3 uCrackC;
uniform vec4 uCrackP; // frequency, glow strength, mottling, crack width
vec3 _ch3(vec3 p){ p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return fract(sin(p) * 43758.5453); }
float crackEdge(vec3 x){
  vec3 n = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 g = vec3(float(i), float(j), float(k));
    vec3 r = g + _ch3(n + g) * 0.8 + 0.1 - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return sqrt(f2) - sqrt(f1);
}
`;
const CRACK_COLOR = `
#include <color_fragment>
float _crk = 0.0;
{
  vec3 cp = vObj * uCrackP.x;
  float e = crackEdge(cp + vec3(_dn(vObj * 3.1) * 0.6));
  float gate = smoothstep(0.42, 0.6, _dn(vObj * 2.3 + 11.0));
  float aa = fwidth(e) + 0.01;
  _crk = (1.0 - smoothstep(uCrackP.w - aa, uCrackP.w + aa, e)) * gate;
  float mott = _dn(vObj * 9.0) * 0.6 + _dn(vObj * 23.0) * 0.4;
  diffuseColor.rgb *= 1.0 - uCrackP.z + uCrackP.z * 1.6 * mott;
  diffuseColor.rgb *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, uCrackP.w * 3.0, e)) * gate;
}
`;
const CRACK_EMIT = `
#include <emissivemap_fragment>
totalEmissiveRadiance += uCrackC * _crk * uCrackP.y;
`;
export function crackMat(color, glowColor, o = {}) {
  const m = bodyMat(color, { rim: o.rim ?? 0.6, emissive: o.emissive ?? 0x000000, vertexColors: !!o.vertexColors });
  const u = { uCrackC: { value: glowColor }, uCrackP: { value: new THREE.Vector4(o.freq ?? 7, o.glow ?? 0.32, o.mott ?? 0.22, o.width ?? 0.05) } };
  m.userData.crack = u;
  extend(m, 'crack', (sh) => {
    Object.assign(sh.uniforms, u);
    OBJ_VERT(sh);
    sh.fragmentShader = CRACK_PARS + sh.fragmentShader.replace('#include <color_fragment>', CRACK_COLOR).replace('#include <emissivemap_fragment>', CRACK_EMIT);
  });
  return m;
}

// Tabby fur: noisy darker bands in bind-pose object space (rings around the
// body along `axis`, arcs on the head), plus a soft lighter belly toward -y.
export function stripeMat(color, stripe, o = {}) {
  const m = bodyMat(color, { rim: o.rim ?? 0.5 });
  const u = { uStripeC: { value: new THREE.Color(stripe) }, uStripeP: { value: new THREE.Vector4(o.freq ?? 34, o.width ?? 0.3, o.warp ?? 1.4, o.amt ?? 0.85) } };
  m.userData.stripe = u;
  extend(m, 'stripe', (sh) => {
    Object.assign(sh.uniforms, u);
    OBJ_VERT(sh);
    sh.fragmentShader = 'varying vec3 vObj;\nuniform vec3 uStripeC;\nuniform vec4 uStripeP;\n' + sh.fragmentShader.replace('#include <color_fragment>', `
#include <color_fragment>
{
  vec3 q = vObj;
  float w = _dn(q * 14.0) * uStripeP.z + _dn(q * 31.0) * 0.4;
  float c = (q.y * 1.0 + length(q.xz) * 0.55) * uStripeP.x + w * 2.2;
  float band = 1.0 - smoothstep(uStripeP.y, uStripeP.y + 0.18, abs(fract(c) - 0.5) * 2.0);
  float gate = smoothstep(0.3, 0.6, _dn(q * 5.0 + 3.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, uStripeC, band * gate * uStripeP.w);
}`);
  });
  return m;
}

// Outline hull material with a per-vertex width (attribute olw; 0 = no outline)
const olCache = new Map();
// tint: the line takes a darkened version of the surface's own vertex colour
// smooth: the hull grows along `onrm` (normals welded across split vertices), so it stays closed
export function olMat(color = 0x1a1410, width = 0.012, tint = false, smooth = false) {
  const key = color + '|' + width + '|' + tint + '|' + smooth;
  if (olCache.has(key)) return olCache.get(key);
  const m = new THREE.MeshBasicMaterial({ color: tint ? 0x6c5258 : color, side: THREE.BackSide, vertexColors: tint });
  const w = { value: width };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uOutline = w;
    sh.vertexShader = 'uniform float uOutline;\nattribute float olw;\n' + (smooth ? 'attribute vec3 onrm;\n' : '') + sh.vertexShader
      .replace('#include <begin_vertex>', `vec3 transformed = position + normalize(${smooth ? 'onrm' : 'normal'}) * uOutline * olw;`)
      // pushed back along the view ray: the line survives across real depth gaps (silhouettes,
      // an arm in front of the chest) but not where two parts of one surface meet
      .replace('#include <project_vertex>', '#include <project_vertex>\nmvPosition.xyz += normalize(mvPosition.xyz) * (0.022 * olw);\ngl_Position = projectionMatrix * mvPosition;');
  };
  m.customProgramCacheKey = () => 'olw2' + smooth;
  olCache.set(key, m);
  return m;
}
// Skinned outline hull sharing the body's skeleton and geometry.
export function skinOutline(mesh, width = 0.012, color = 0x1a1410) {
  const o = new THREE.SkinnedMesh(mesh.geometry, mesh.geometry.attributes.olw ? olMat(color, width) : outlineMat(color, width));
  o.bind(mesh.skeleton, mesh.bindMatrix);
  o.castShadow = false; o.receiveShadow = false;
  o.userData.isOutline = true;
  o.boundingSphere = mesh.boundingSphere;
  mesh.parent.add(o);
  return o;
}

// Ghost material that follows skinning (translucent memory echoes).
export function ghostSkinMat(color = 0xbfe8ff, alpha = 0.55) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha }, uTime: U.time },
    vertexShader: `
      #include <common>
      #include <skinning_pars_vertex>
      varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){
        #include <skinbase_vertex>
        vec3 objectNormal = vec3(normal);
        #include <skinnormal_vertex>
        vec3 transformed = vec3(position);
        #include <skinning_vertex>
        vec4 wp = modelMatrix * vec4(transformed, 1.0); vY = wp.y;
        vec4 mv = viewMatrix * wp;
        vN = normalize(normalMatrix * objectNormal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uAlpha, uTime; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){
        float f = pow(1.0 - min(abs(dot(normalize(vN), normalize(vV))), 1.0), 1.4);
        float scan = 0.75 + 0.25 * sin(vY * 22.0 - uTime * 4.0);
        float a = (0.18 + f * 0.9) * uAlpha * scan;
        gl_FragColor = vec4(uColor * (1.4 + f * 1.6) * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------------------
// Instance a built type: bones + SkinnedMesh (+ outline) under `parent`.
// One SkinnedMesh per material group (sharing attributes, index and skeleton),
// so every mesh has a single material: callers flash `emissive`, dissolve via
// `userData.dissolve` and hide glow meshes per material.
function groupGeos(built) {
  if (built.parts) return built.parts;
  const g = built.geo;
  built.parts = g.groups.map((gr) => {
    const p = new THREE.BufferGeometry();
    for (const k in g.attributes) p.setAttribute(k, g.attributes[k]);
    p.setIndex(g.index);
    p.setDrawRange(gr.start, gr.count);
    p.boundingSphere = g.boundingSphere;
    return p;
  });
  return built.parts;
}
export function instance(parent, def, built, mats, o = {}) {
  const inst = def.instance();
  parent.add(inst.root);
  parent.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(inst.bones);
  const parts = groupGeos(built);
  const bs = new THREE.Sphere(built.geo.boundingSphere.center.clone(), built.geo.boundingSphere.radius * 1.5 + (o.bsPad ?? 0.3));
  const meshes = [];
  const byGroup = {};
  built.mats.forEach((k, i) => {
    if (!mats[k]) return;
    const mesh = new THREE.SkinnedMesh(parts[i], mats[k]);
    useCasterDepth(mesh);
    mesh.name = k;
    parent.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(skeleton, mesh.matrixWorld);
    // eyes and the mouth's inside sit within the head: their shadow is the head's
    mesh.castShadow = (o.shadow ?? true) && k !== 'eye' && k !== 'in';
    mesh.boundingSphere = bs;
    meshes.push(mesh); byGroup[k] = mesh;
  });
  const mesh = byGroup[o.main] || meshes[0];
  let outline = null;
  if (o.outline) {
    // one hull for the whole body (full geometry), bound to the same skeleton
    const full = built.fullOl || (built.fullOl = built.geo);
    const ol = new THREE.SkinnedMesh(full, full.attributes.olw ? olMat(o.outlineColor ?? 0x1a1410, o.outline, !!o.outlineTint, !!full.attributes.onrm) : outlineMat(o.outlineColor ?? 0x1a1410, o.outline));
    ol.bind(skeleton, mesh.bindMatrix);
    ol.castShadow = false; ol.receiveShadow = false;
    ol.userData.isOutline = true;
    ol.boundingSphere = bs;
    parent.add(ol);
    outline = ol;
  }
  return { ...inst, skeleton, mesh, meshes, byGroup, outline };
}

// ---------------------------------------------------------------------------
// Two-bone IK in world space (a: upper bone, b: lower bone, endLocal: end
// point in b's space). pole: world point the middle joint bends towards.
const _a = new V3(), _b = new V3(), _c = new V3(), _n = new V3(), _m = new V3(), _e = new V3(), _t = new V3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const _rotPos = new V3(), _rotScale = new V3();
export function ik2(a, b, endLocal, target, pole, weight = 1) {
  if (weight <= 0.001) return;
  b.updateWorldMatrix(true, false);
  _a.setFromMatrixPosition(a.matrixWorld); _b.setFromMatrixPosition(b.matrixWorld); _c.copy(endLocal).applyMatrix4(b.matrixWorld);
  const L1 = _a.distanceTo(_b), L2 = _b.distanceTo(_c);
  _t.copy(target);
  let D = _t.distanceTo(_a);
  const maxD = (L1 + L2) * 0.999, minD = Math.abs(L1 - L2) * 1.02 + 1e-4;
  _n.subVectors(_t, _a); if (D < 1e-5) _n.set(0, -1, 0); else _n.multiplyScalar(1 / D);
  D = Math.min(maxD, Math.max(minD, D));
  const x = (L1 * L1 - L2 * L2 + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
  _m.subVectors(pole, _a); _m.addScaledVector(_n, -_m.dot(_n));
  if (_m.lengthSq() < 1e-8) _m.set(0, 0, 1).addScaledVector(_n, -_n.z);
  _m.normalize();
  _e.copy(_a).addScaledVector(_n, x).addScaledVector(_m, h);
  _t.copy(_a).addScaledVector(_n, D);
  // upper bone
  rotateWithMatrices(a, _b.sub(_a).normalize(), _e.sub(_a).normalize(), weight);
  a.updateMatrixWorld(true);
  _b.setFromMatrixPosition(b.matrixWorld); _c.copy(endLocal).applyMatrix4(b.matrixWorld);
  rotateWithMatrices(b, _c.sub(_b).normalize(), _t.sub(_b).normalize(), weight);
  b.updateMatrixWorld(true);
}
// rotate `o` so that world direction `from` maps to `to` (blend by w)
export function rotateTowards(o, from, to, w = 1) {
  o.updateWorldMatrix(true, false);
  rotateWithMatrices(o, from, to, w);
}
// The solver has already propagated these two matrices for this pose.
function rotateWithMatrices(o, from, to, w) {
  _q1.setFromUnitVectors(from, to);
  o.matrixWorld.decompose(_rotPos, _q2, _rotScale);
  _q3.multiplyQuaternions(_q1, _q2);                 // desired world rotation
  o.parent.matrixWorld.decompose(_rotPos, _q4, _rotScale);
  _q4.invert();
  _q3.premultiply(_q4);                              // to local
  if (w >= 0.999) o.quaternion.copy(_q3); else o.quaternion.slerp(_q3, w);
}
// set an object's world orientation (blend by w)
export function setWorldQuat(o, q, w = 1) {
  o.parent.getWorldQuaternion(_q4).invert();
  _q3.multiplyQuaternions(_q4, q);
  if (w >= 0.999) o.quaternion.copy(_q3); else o.quaternion.slerp(_q3, w);
}

// ---------------------------------------------------------------------------
// Verlet chain for cloth tails, hair, capes, feathers and fox tails.
// bones: consecutive bones (bones[k+1] child of bones[k]); tail: end offset in
// the last bone's space. Rest shape comes from the bones' animated rotations
// at the time of step() (shape memory `stiff`).
const chainWind = new V3();
export class Chain {
  constructor(bones, tail, o = {}) {
    this.bones = bones;
    this.tail = tail.clone();
    this.n = bones.length + 1;
    this.p = []; this.q = []; this.t = [];
    for (let k = 0; k < this.n; k++) { this.p.push(new V3()); this.q.push(new V3()); this.t.push(new V3()); }
    this.len = [];
    this.stiff = o.stiff ?? 0.08;          // pull towards animated pose (0..1 per step)
    this.stiffTip = o.stiffTip ?? this.stiff * 0.4;
    this.damp = o.damp ?? 0.08;
    this.grav = o.grav ?? 9.8;
    this.drag = o.drag ?? 0;               // pull with wind / air
    this.colliders = o.colliders || [];    // [{ obj, off: V3, r }] spheres, or [{ obj, a: V3, b: V3, r }] capsules (r in world units)
    this.init = false;
    this.base = bones.map(() => new THREE.Quaternion()); // animated local rotations (rest = identity)
  }
  targets() {
    const B = this.bones;
    B[0].parent?.updateWorldMatrix(true, false);
    B[0].updateMatrixWorld(true);
    for (let k = 0; k < B.length; k++) this.t[k].setFromMatrixPosition(B[k].matrixWorld);
    this.t[this.n - 1].copy(this.tail).applyMatrix4(B[B.length - 1].matrixWorld);
  }
  reset(refresh = true) { if (refresh) this.targets(); for (let k = 0; k < this.n; k++) { this.p[k].copy(this.t[k]); this.q[k].copy(this.t[k]); } this.init = true; }
  // an impulse along dir (world), growing towards the free end: d metres per step at the tip
  kick(dir, d) { if (this.init) for (let k = 1; k < this.n; k++) this.q[k].addScaledVector(dir, -d * k / (this.n - 1)); }
  // call after the skeleton's animated pose has been applied and matrixWorld updated
  // defer: stop before the bones are turned (the caller evens out neighbouring chains, then calls orient())
  step(dt, wind = null, sim = true, defer = false) {
    const B = this.bones;
    for (let k = 0; k < B.length; k++) B[k].quaternion.copy(this.base[k]);
    this.targets();
    if (!this.init || !sim) { this.reset(false); if (!sim) return; }
    if (this.p[0].distanceToSquared(this.t[0]) > 4) this.reset(false);
    for (let k = 0; k < this.n - 1; k++) this.len[k] = this.t[k].distanceTo(this.t[k + 1]);
    const tmp = _t;
    const air = this.drag > 0 && dt > 0 ? G.wind?.sample(this.t[0], chainWind) : null;
    const span = Math.min(Math.max(dt, 0), 0.1);
    const steps = Math.ceil(span * 120), h = span / (steps || 1);
    for (let i = 0; i < steps; i++) {
      const ratio = this.prevH ? Math.min(2, h / this.prevH) : 1;
      this.p[0].copy(this.t[0]); this.q[0].copy(this.t[0]);
      for (let k = 1; k < this.n; k++) {
        const P = this.p[k], Q = this.q[k];
        tmp.subVectors(P, Q).multiplyScalar(ratio * Math.pow(1 - this.damp, h * 60));
        Q.copy(P);
        P.add(tmp);
        P.y -= this.grav * h * h;
        const drag = this.drag * h * h * (k / (this.n - 1));
        if (wind && drag > 0) P.addScaledVector(wind, drag);
        if (air) P.addScaledVector(air, drag * 1.8);
        const s = mix(this.stiff, this.stiffTip, (k - 1) / Math.max(1, this.n - 2));
        P.lerp(this.t[k], 1 - Math.pow(1 - s, (h * 60) ** 2));
      }
      for (let it = 0; it < 2; it++) {
        for (let k = 1; k < this.n; k++) {
          const A = this.p[k - 1], P = this.p[k];
          tmp.subVectors(P, A);
          const d = tmp.length() || 1e-6;
          P.copy(A).addScaledVector(tmp, this.len[k - 1] / d);
          for (const c of this.colliders) {
            if (c.b) {
              // capsule (a limb): pushed straight out from its axis, so cloth lies along it
              if (!c.wa) { c.wa = new V3(); c.wb = new V3(); }
              if (it === 0 && k === 1) { c.wa.copy(c.a).applyMatrix4(c.obj.matrixWorld); c.wb.copy(c.b).applyMatrix4(c.obj.matrixWorld); }
              _n.subVectors(c.wb, c.wa);
              const u = Math.min(1, Math.max(0, tmp.subVectors(P, c.wa).dot(_n) / _n.lengthSq()));
              tmp.addScaledVector(_n, -u);
              const dl = tmp.length();
              if (dl < c.r && dl > 1e-6) P.addScaledVector(tmp, (c.r - dl) / dl);
              continue;
            }
            if (!c.w) c.w = new V3();
            c.w.copy(c.off).applyMatrix4(c.obj.matrixWorld);
            const r = c.r * (c.obj.matrixWorld.elements[0] ** 2 + c.obj.matrixWorld.elements[1] ** 2 + c.obj.matrixWorld.elements[2] ** 2) ** 0.5;
            tmp.subVectors(P, c.w);
            const dl = tmp.length();
            if (dl < r && dl > 1e-6) P.addScaledVector(tmp, (r - dl) / dl);
          }
        }
      }
      this.prevH = h;
    }
    if (!defer) this.orient();
  }
  orient() {
    const B = this.bones;
    // orient bones along the simulated points (keep animated twist)
    for (let k = 0; k < B.length; k++) {
      const b = B[k];
      b.updateMatrixWorld(true);
      const from = (k + 1 < B.length ? B[k + 1].getWorldPosition(_e) : _e.copy(this.tail).applyMatrix4(b.matrixWorld)).sub(b.getWorldPosition(_c)).normalize();
      const to = _m.subVectors(this.p[k + 1], this.p[k]).normalize();
      rotateTowards(b, from, to, 1);
    }
    B[0].updateMatrixWorld(true);
  }
}

// critically-damped-ish spring on a scalar
export class Spring {
  constructor(k = 120, c = 14, x = 0) { this.k = k; this.c = c; this.x = x; this.v = 0; }
  step(target, dt) {
    // Integrate all elapsed time; a long frame must not slow the recovery down.
    for (let t = Math.min(Math.max(dt, 0), 0.1); t > 1e-6;) {
      const h = Math.min(t, 1 / 120);
      this.v += (this.k * (target - this.x) - this.c * this.v) * h;
      this.x += this.v * h; t -= h;
    }
    return this.x;
  }
}
