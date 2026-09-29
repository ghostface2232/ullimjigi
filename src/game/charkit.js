// Character toolkit: procedural sculpting (lofted tubes, sculpted blobs, thick
// cloth sheets), automatic skin weights, per-type geometry merging into one
// SkinnedMesh, character materials (painted faces, glowing ash cracks, skinned
// outline hulls and ghosts), two-bone IK and verlet secondary-motion chains.
// Everything is generated in code; geometry is built once per character type
// and shared between instances (each instance gets its own bones/materials).
import * as THREE from 'three';
import { toon, outlineMat, U } from '../render/materials.js';

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
    bones.forEach((o) => { by[o.name] = o; });
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
    if (!this.buckets.has(mat)) { this.buckets.set(mat, { p: [], n: [], i: [], si: [], sw: [], ol: [] }); this.order.push(mat); }
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
    for (let k = 0; k < part.p.length; k++) { B.p.push(part.p[k]); B.n.push(nrm[k]); }
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
  // o.color(key) -> hex vertex color; o.group(key) -> material group name.
  // Parts sharing a group are drawn with one material (vertex colored).
  build(o = {}) {
    const g = new THREE.BufferGeometry();
    const groupOf = o.group || ((k) => k);
    const groups = [];
    const gmap = new Map();
    for (const m of this.order) { const gn = groupOf(m); if (!gmap.has(gn)) { gmap.set(gn, []); groups.push(gn); } gmap.get(gn).push(m); }
    let nv = 0, ni = 0;
    for (const m of this.order) { const B = this.buckets.get(m); nv += B.p.length / 3; ni += B.i.length; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), SI = new Uint16Array(nv * 4), SW = new Float32Array(nv * 4), C = new Float32Array(nv * 3), OL = new Float32Array(nv);
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    const col = new THREE.Color();
    groups.forEach((gn, gi) => {
      const i0 = io;
      for (const m of gmap.get(gn)) {
        const B = this.buckets.get(m);
        P.set(B.p, vo * 3); N.set(B.n, vo * 3); SI.set(B.si, vo * 4); SW.set(B.sw, vo * 4); OL.set(B.ol, vo);
        col.set(o.color ? o.color(m) : 0xffffff);
        for (let k = 0; k < B.p.length / 3; k++) { C[(vo + k) * 3] = col.r; C[(vo + k) * 3 + 1] = col.g; C[(vo + k) * 3 + 2] = col.b; }
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
  constructor(wfn) { this.p = []; this.i = []; this.w = []; this.wfn = wfn; }
  v(x, y, z, w) {
    const k = this.p.length / 3;
    this.p.push(x, y, z);
    this.w.push(w || this.wfn(_pv.set(x, y, z)));
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
//      flat0/flat1 (flat caps), a0/a1 (open angular range for partial tubes), twist(u) }
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
  part.ol = o.ol;
  S.addPart(mat, part);
  return part;
}
function fan(part, ringIdx, pole, rev) {
  const n = ringIdx.length;
  for (let j = 0; j < n; j++) { const j2 = (j + 1) % n; if (rev) part.tri(ringIdx[j2], ringIdx[j], pole); else part.tri(ringIdx[j], ringIdx[j2], pole); }
}

// Sculpted blob: lat-long sphere around c with radii r, fn(d, p) mutates p
// (d = unit direction on the sphere, p = ellipsoid point). skip(d) removes faces.
export function blob(S, mat, w, o) {
  const part = new Part(S.weigher(w));
  const ws = o.ws ?? 16, hs = o.hs ?? 12;
  const [rx, ry, rz] = o.r;
  const c = o.c;
  const d = new V3(), p = new V3();
  const idx = [];
  for (let i = 0; i <= hs; i++) {
    const th = (i / hs) * Math.PI;
    const row = [];
    const cnt = i === 0 || i === hs ? 1 : ws;
    for (let j = 0; j < cnt; j++) {
      const ph = (j / ws) * TAU;
      d.set(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph));
      p.set(d.x * rx, d.y * ry, d.z * rz);
      if (o.fn) o.fn(d, p);
      row.push(part.v(c.x + p.x, c.y + p.y, c.z + p.z));
    }
    idx.push(row);
  }
  const keep = (i, j) => { if (!o.skip) return true; const th = ((i + 0.5) / hs) * Math.PI, ph = ((j + 0.5) / ws) * TAU; d.set(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)); return !o.skip(d); };
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
  part.ol = o.ol;
  S.addPart(mat, part);
  return { part, idx };
}

// Thick cloth sheet: outer surface fn(u, v, out), inner surface offset by
// `thick` along -normal (normal oriented away from inside(p)). Closes the
// hem (v = 1), sides (u = 0/1, unless wrap) and optionally the top edge.
export function sheet(S, mat, w, o) {
  const nu = o.nu ?? 12, nv = o.nv ?? 8, wrap = !!o.wrap;
  const thick = o.thick ?? 0.012;
  const wf = S.weigher(w);
  const cu = wrap ? nu : nu + 1;
  const pos = [], nrm = [];
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
    pos.push(P.clone()); nrm.push(Nn.clone());
  }
  const id = (i, j) => j * cu + (wrap ? i % nu : i);
  const mk = (sign) => {
    const part = new Part(wf);
    const vi = [];
    for (let k = 0; k < pos.length; k++) {
      const q = pos[k].clone().addScaledVector(nrm[k], sign > 0 ? 0 : -thick);
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
float fLine(float d, float w, float aa) { return 1.0 - smoothstep(w - aa, w + aa, abs(d)); }
`;
const FACE_FRAG = `
#include <color_fragment>
{
  vec3 q3 = (vObj - uFaceC.xyz) / uFaceC.w;
  if (q3.z > 0.05 && q3.y > -1.25 && q3.y < 1.0 && abs(q3.x) < 1.05) {
    vec2 f = q3.xy;
    float aa = max(fwidth(f.x), fwidth(f.y)) * 1.1 + 0.002;
    vec3 col = diffuseColor.rgb;
    float front = smoothstep(0.05, 0.3, q3.z);
    // ---- blush, wrinkles, freckles
    {
      vec2 bc = vec2(abs(f.x) - 0.52, f.y + 0.3);
      float bl = exp(-dot(bc, bc) / 0.022) * uCheek.x;
      col = mix(col, uBlushC, bl * 0.45);
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
      sclera *= 1.0 - 0.25 * smoothstep(b * 0.55, 0.0, yTop - p.y);
      vec2 ic = vec2(uLook.x * a * 0.42, uLook.y * b * 0.35 - b * 0.05);
      float ir = b * uLook.z;
      float di = length((p - ic) * vec2(1.0, 0.92));
      vec3 iris = mix(uIris * 0.55, uIris * 1.15, smoothstep(-ir, ir, p.y - ic.y));
      iris = mix(iris, uIris * 0.4, smoothstep(ir * 0.75, ir, di));
      float pr = ir * uLook.w;
      vec3 e = mix(sclera, iris, 1.0 - smoothstep(ir - aa, ir + aa, di));
      e = mix(e, vec3(0.03, 0.02, 0.04), 1.0 - smoothstep(pr - aa, pr + aa, di));
      // highlights (same side on both eyes)
      float h1 = 1.0 - smoothstep(ir * 0.26 - aa, ir * 0.26 + aa, length(p - ic - vec2(ir * 0.38, ir * 0.36)));
      float h2 = 1.0 - smoothstep(ir * 0.12 - aa, ir * 0.12 + aa, length(p - ic - vec2(-ir * 0.3, -ir * 0.42)));
      e = mix(e, vec3(1.0), max(h1, h2 * 0.8));
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
  };
  m.userData.face = u;
  extend(m, 'face', (sh) => {
    Object.assign(sh.uniforms, u);
    OBJ_VERT(sh);
    sh.fragmentShader = FACE_PARS + sh.fragmentShader.replace('#include <color_fragment>', FACE_FRAG);
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
export function olMat(color = 0x1a1410, width = 0.012) {
  const key = color + '|' + width;
  if (olCache.has(key)) return olCache.get(key);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  const w = { value: width };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uOutline = w;
    sh.vertexShader = 'uniform float uOutline;\nattribute float olw;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normalize(normal) * uOutline * olw;');
  };
  m.customProgramCacheKey = () => 'olw';
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
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.4);
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
    mesh.name = k;
    parent.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(skeleton, mesh.matrixWorld);
    mesh.castShadow = o.shadow ?? true;
    mesh.boundingSphere = bs;
    meshes.push(mesh); byGroup[k] = mesh;
  });
  const mesh = byGroup[o.main] || meshes[0];
  let outline = null;
  if (o.outline) {
    // one hull for the whole body (full geometry), bound to the same skeleton
    const full = built.fullOl || (built.fullOl = built.geo);
    const ol = new THREE.SkinnedMesh(full, full.attributes.olw ? olMat(o.outlineColor ?? 0x1a1410, o.outline) : outlineMat(o.outlineColor ?? 0x1a1410, o.outline));
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
export function ik2(a, b, endLocal, target, pole, weight = 1) {
  if (weight <= 0.001) return;
  a.getWorldPosition(_a); b.getWorldPosition(_b); _c.copy(endLocal).applyMatrix4(b.matrixWorld);
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
  rotateTowards(a, _b.sub(_a).normalize(), _e.clone().sub(_a).normalize(), weight);
  a.updateMatrixWorld(true);
  b.getWorldPosition(_b); _c.copy(endLocal).applyMatrix4(b.matrixWorld);
  rotateTowards(b, _c.sub(_b).normalize(), _t.sub(_b).normalize(), weight);
  b.updateMatrixWorld(true);
}
// rotate `o` so that world direction `from` maps to `to` (blend by w)
export function rotateTowards(o, from, to, w = 1) {
  _q1.setFromUnitVectors(from, to);
  o.getWorldQuaternion(_q2);
  _q3.multiplyQuaternions(_q1, _q2);                 // desired world rotation
  o.parent.getWorldQuaternion(_q4).invert();
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
    this.colliders = o.colliders || [];    // [{ obj, off: V3, r }]
    this.init = false;
    this.base = bones.map(() => new THREE.Quaternion()); // animated local rotations (rest = identity)
  }
  targets() {
    const B = this.bones;
    for (let k = 0; k < B.length; k++) B[k].getWorldPosition(this.t[k]);
    this.t[this.n - 1].copy(this.tail).applyMatrix4(B[B.length - 1].matrixWorld);
  }
  reset() { this.targets(); for (let k = 0; k < this.n; k++) { this.p[k].copy(this.t[k]); this.q[k].copy(this.t[k]); } this.init = true; }
  // call after the skeleton's animated pose has been applied and matrixWorld updated
  step(dt, wind = null, sim = true) {
    const B = this.bones;
    for (let k = 0; k < B.length; k++) B[k].quaternion.copy(this.base[k]);
    B[0].updateMatrixWorld(true);
    this.targets();
    if (!this.init || !sim) { this.reset(); if (!sim) return; }
    if (this.p[0].distanceToSquared(this.t[0]) > 4) this.reset();
    for (let k = 0; k < this.n - 1; k++) this.len[k] = this.t[k].distanceTo(this.t[k + 1]);
    const h = Math.min(dt, 1 / 30);
    this.p[0].copy(this.t[0]); this.q[0].copy(this.t[0]);
    const tmp = _t;
    for (let k = 1; k < this.n; k++) {
      const P = this.p[k], Q = this.q[k];
      tmp.subVectors(P, Q).multiplyScalar(1 - this.damp);
      Q.copy(P);
      P.add(tmp);
      P.y -= this.grav * h * h;
      if (wind && this.drag > 0) P.addScaledVector(wind, this.drag * h * h * (k / (this.n - 1)));
      const s = mix(this.stiff, this.stiffTip, (k - 1) / Math.max(1, this.n - 2));
      P.lerp(this.t[k], s);
    }
    for (let it = 0; it < 2; it++) {
      for (let k = 1; k < this.n; k++) {
        const A = this.p[k - 1], P = this.p[k];
        tmp.subVectors(P, A);
        const d = tmp.length() || 1e-6;
        P.copy(A).addScaledVector(tmp, this.len[k - 1] / d);
        for (const c of this.colliders) {
          if (!c.w) c.w = new V3();
          c.w.copy(c.off).applyMatrix4(c.obj.matrixWorld);
          const r = c.r * (c.obj.matrixWorld.elements[0] ** 2 + c.obj.matrixWorld.elements[1] ** 2 + c.obj.matrixWorld.elements[2] ** 2) ** 0.5;
          tmp.subVectors(P, c.w);
          const dl = tmp.length();
          if (dl < r && dl > 1e-6) P.addScaledVector(tmp, (r - dl) / dl);
        }
      }
    }
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
  step(target, dt) { const h = Math.min(dt, 1 / 30); this.v += (this.k * (target - this.x) - this.c * this.v) * h; this.x += this.v * h; return this.x; }
}
