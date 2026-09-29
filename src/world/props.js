// Procedural vegetation, ground cover & rocks, instanced per spatial cell.
// Species vary by region: oaks/poplars on the plains, birch + fern + fungus
// in the west woods, willows and reeds around the lake, tiered firs (snowy
// higher up) in the north, ashen dead trees around the rift.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon } from '../render/materials.js';
import { mulberry32, fbm, smoothstep, lerp, clamp } from '../core/util.js';
import { POI } from './layout.js';

const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();
const ni = (g) => (g.index ? g.toNonIndexed() : g);
const hc = (h) => new THREE.Color(h);

function prep(geo, colorFn, normalCenter = null, normalBlend = 0.7) {
  let g = ni(geo);
  g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    V.fromBufferAttribute(p, i);
    colorFn(V, c, i);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    if (normalCenter) {
      const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
      V.sub(normalCenter).normalize();
      V.set(lerp(nx, V.x, normalBlend), lerp(ny, V.y, normalBlend) + 0.15, lerp(nz, V.z, normalBlend)).normalize();
      n.setXYZ(i, V.x, V.y, V.z);
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function jitter(geo, amt, rnd) {
  const p = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let o = map.get(k);
    if (!o) { o = [(rnd() - 0.5) * amt, (rnd() - 0.5) * amt, (rnd() - 0.5) * amt]; map.set(k, o); }
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  return geo;
}
// Build a geometry from raw triangle soup + per-vertex colors and normals.
function soup(pos, col, nrm) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (nrm) g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  else g.computeVertexNormals();
  return g;
}

// ---------------- canopy: many noisy leaf clusters ----------------
// Clusters sit on an ellipsoid shell (biased upward) with a few inner fillers.
// Normals blend the cluster's own roundness with the whole crown's, so each
// clump gets its own lit cap while the tree still shades as one volume.
function canopy(rnd, o) {
  const { center, rx, ry, count, rMin, rMax } = o;
  const light = hc(o.light), dark = hc(o.dark);
  const tint = new THREE.Color();
  const parts = [];
  for (let i = 0; i < count; i++) {
    const inner = i < Math.max(1, Math.round(count * 0.18));
    const th = rnd() * Math.PI * 2;
    const cy = 1 - rnd() * (o.lowBias ?? 1.5);
    const sy = Math.sqrt(Math.max(0, 1 - cy * cy));
    const shell = inner ? 0.3 + rnd() * 0.2 : 0.78 + rnd() * 0.22;
    const c = new THREE.Vector3(Math.cos(th) * sy * rx * shell, cy * ry * shell, Math.sin(th) * sy * rx * shell).add(center);
    const r = (rMin + rnd() * (rMax - rMin)) * (inner ? 1.25 : 1);
    const g = ni(jitter(new THREE.IcosahedronGeometry(r, o.detail ?? 0), r * 0.32, rnd));
    g.scale(1, o.flat ?? 0.85, 1);
    g.translate(c.x, c.y, c.z);
    g.deleteAttribute('uv');
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3), nrm = new Float32Array(p.count * 3);
    const hue = (rnd() - 0.5) * (o.hueJit ?? 0.05), lum = 0.92 + rnd() * 0.16;
    const cOut = clamp((c.y - center.y) / ry * 0.5 + 0.5, 0, 1);
    g.computeVertexNormals();
    const fn = g.attributes.normal;
    for (let k = 0; k < p.count; k++) {
      V.fromBufferAttribute(p, k);
      const hgt = clamp((V.y - (center.y - ry)) / (2 * ry), 0, 1);
      V2.copy(V).sub(center).normalize();
      V3.copy(V).sub(c).normalize();
      let t = clamp(0.06 + 0.5 * hgt + 0.22 * cOut + 0.22 * (V2.y * 0.5 + 0.5), 0, 1);
      if (inner) t *= 0.5;
      tint.copy(dark).lerp(light, t * t * 0.9 + 0.08).offsetHSL(hue, 0, 0).multiplyScalar(lum);
      col[k * 3] = tint.r; col[k * 3 + 1] = tint.g; col[k * 3 + 2] = tint.b;
      V.set(fn.getX(k) * 0.12 + V3.x * 0.33 + V2.x * 0.75, fn.getY(k) * 0.12 + V3.y * 0.33 + V2.y * 0.75 + 0.1, fn.getZ(k) * 0.12 + V3.z * 0.33 + V2.z * 0.75).normalize();
      nrm[k * 3] = V.x; nrm[k * 3 + 1] = V.y; nrm[k * 3 + 2] = V.z;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    parts.push(g);
  }
  return mergeGeometries(parts);
}

function trunkGeo(rnd, { h, r0, r1, seg = 7, hseg = 4, lean = 0, bend = 0.15, col0, col1, flare = 1.35 }) {
  const tr = new THREE.CylinderGeometry(r1, r0, h, seg, hseg);
  tr.translate(0, h / 2, 0);
  const p = tr.attributes.position;
  const ph = rnd() * 6;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = y / h;
    const f = t < 0.15 ? lerp(flare, 1, t / 0.15) : 1;
    p.setX(i, p.getX(i) * f + Math.sin(t * 2.5 + ph) * bend * t + lean * t * t * h);
    p.setZ(i, p.getZ(i) * f + Math.cos(t * 2.1 + ph) * bend * t);
  }
  jitter(tr, r0 * 0.25, rnd);
  const a = hc(col0), b = hc(col1);
  return prep(tr, (v, c) => c.copy(a).lerp(b, clamp(v.y / h, 0, 1)));
}
function branch(rnd, from, to, r0, r1, col) {
  const d = V.copy(to).sub(from), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, 5, 1);
  g.translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyQuaternion(q); g.translate(from.x, from.y, from.z);
  const cc = hc(col);
  return prep(g, (v, c) => c.copy(cc));
}

// ---------------- tree species ----------------
function broadleaf(rnd, opts = {}) {
  const parts = [];
  const trunkH = (opts.trunkH ?? 2.9) * (0.9 + rnd() * 0.2);
  parts.push(trunkGeo(rnd, { h: trunkH + 0.8, r0: 0.34, r1: 0.18, col0: 0x4a3626, col1: 0x7a5a3e }));
  const size = opts.size ?? 1.7;
  const center = new THREE.Vector3((rnd() - 0.5) * 0.4, trunkH + size * 0.95, (rnd() - 0.5) * 0.4);
  for (let b = 0; b < 3; b++) {
    const a = b * 2.1 + rnd();
    const to = new THREE.Vector3(Math.cos(a) * size * 0.9, trunkH + size * (0.55 + rnd() * 0.4), Math.sin(a) * size * 0.9);
    parts.push(branch(rnd, new THREE.Vector3(0, trunkH * (0.62 + b * 0.1), 0), to, 0.12, 0.05, 0x6a4c34));
  }
  const sq = opts.squash ?? 0.85;
  parts.push(canopy(rnd, {
    center, rx: size * 1.3, ry: size * sq * 1.15, count: opts.clusters ?? 19, rMin: size * 0.34, rMax: size * 0.52,
    light: opts.light ?? 0xa6cf5a, dark: opts.dark ?? 0x3a7233, flat: 0.86, hueJit: 0.05,
  }));
  return mergeGeometries(parts);
}
function poplar(rnd) {
  const parts = [];
  parts.push(trunkGeo(rnd, { h: 3.2, r0: 0.24, r1: 0.12, col0: 0x4a3626, col1: 0x7a5a3e }));
  parts.push(canopy(rnd, {
    center: new THREE.Vector3(0, 4.9, 0), rx: 1.25, ry: 2.9, count: 15, rMin: 0.45, rMax: 0.68,
    light: 0xb5d86a, dark: 0x467f38, flat: 1.0, lowBias: 1.9,
  }));
  return mergeGeometries(parts);
}
function birch(rnd) {
  const parts = [];
  const h = 4.6 + rnd() * 1.2, lean = (rnd() - 0.5) * 0.08;
  const tr = new THREE.CylinderGeometry(0.1, 0.19, h, 7, 8);
  tr.translate(0, h / 2, 0);
  const p = tr.attributes.position;
  for (let i = 0; i < p.count; i++) { const t = p.getY(i) / h; p.setX(i, p.getX(i) + lean * t * h + Math.sin(t * 5) * 0.05); }
  const marks = [];
  for (let i = 0; i < 9; i++) marks.push(rnd());
  const white = hc(0xe6e2d6), mark = hc(0x3e3a36);
  parts.push(prep(tr, (v, c) => {
    const row = clamp(Math.round((v.y / h) * 8), 0, 8);
    c.copy(white).lerp(mark, marks[row] > 0.72 ? 0.85 : 0);
    if (v.y < 0.35) c.lerp(mark, 0.5);
  }));
  for (let b = 0; b < 3; b++) {
    const a = rnd() * 6.28;
    parts.push(branch(rnd, new THREE.Vector3(lean * 0.6 * h, h * (0.55 + b * 0.1), 0), new THREE.Vector3(Math.cos(a) * 1.0, h * 0.8 + b * 0.25, Math.sin(a) * 1.0), 0.05, 0.02, 0xd0cabc));
  }
  parts.push(canopy(rnd, {
    center: new THREE.Vector3(lean * h, h * 0.86, 0), rx: 1.45, ry: 1.9, count: 14, rMin: 0.38, rMax: 0.6,
    light: 0xcfe070, dark: 0x5f9a3c, flat: 0.8, hueJit: 0.07,
  }));
  return mergeGeometries(parts);
}
function willow(rnd, opts = {}) {
  const parts = [];
  const th = opts.trunkH ?? 2.6;
  parts.push(trunkGeo(rnd, { h: th + 0.6, r0: 0.42, r1: 0.26, col0: 0x3e3226, col1: 0x6a5642, bend: 0.3, flare: 1.5 }));
  const cy = th + 1.2, R = (opts.size ?? 2.1) * 1.25;
  parts.push(canopy(rnd, {
    center: new THREE.Vector3(0, cy, 0), rx: R, ry: 1.3, count: 13, rMin: 0.62, rMax: 0.95,
    light: opts.light ?? 0xb4d66a, dark: opts.dark ?? 0x4a8440, flat: 0.72, lowBias: 1.1,
  }));
  // drooping curtain: long narrow leaf clumps hanging from the rim
  const top = hc(opts.dark ?? 0x4a8440), tip = hc(0xc2de78);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rnd() * 0.35, rr = R * (0.78 + rnd() * 0.25);
    const L = 1.5 + rnd() * 1.1;
    const g = ni(jitter(new THREE.IcosahedronGeometry(0.5, 0), 0.18, rnd));
    g.scale(0.62, L / 1.0, 0.62);
    g.translate(Math.cos(a) * rr, cy - L * 0.55, Math.sin(a) * rr);
    const y0 = cy + 0.2, y1 = cy - L * 1.05;
    parts.push(prep(g, (v, c) => c.copy(top).lerp(tip, clamp((y0 - v.y) / (y0 - y1), 0, 1) * 0.85), new THREE.Vector3(0, cy + 1.5, 0), 0.75));
  }
  return mergeGeometries(parts);
}
// Tiered fir: star-shaped drooping tiers with dark undersides.
function pine(rnd, snowy = false) {
  const parts = [];
  const H = 6.4 + rnd() * 1.2;
  parts.push(trunkGeo(rnd, { h: H * 0.7, r0: 0.3, r1: 0.1, seg: 6, hseg: 2, col0: 0x3e2c22, col1: 0x5a4030, bend: 0.05 }));
  const dark = hc(0x1f4636), mid = hc(0x356a4e), tipC = hc(0x5b9468), under = hc(0x16322a), snow = hc(0xd8e2ee);
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = lerp(2.3, 0.75, t) * (0.9 + rnd() * 0.2), h = lerp(2.0, 1.5, t);
    const y0 = 1.2 + i * (H - 2.6) / (tiers - 1);
    const seg = 10;
    const g = new THREE.ConeGeometry(r, h, seg, 1, true);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      if (p.getY(k) < 0) {
        const odd = Math.round(Math.atan2(p.getZ(k), p.getX(k)) / (Math.PI * 2 / seg)) % 2 !== 0;
        const s = odd ? 0.7 : 1.08;
        p.setX(k, p.getX(k) * s); p.setZ(k, p.getZ(k) * s);
        p.setY(k, p.getY(k) - (odd ? 0.05 : 0.28));
      }
    }
    jitter(g, 0.14, rnd);
    g.translate(0, y0 + h / 2, 0);
    const top = y0 + h;
    parts.push(prep(g, (v, c) => {
      const f = clamp((top - v.y) / h, 0, 1);
      const rr = Math.hypot(v.x, v.z) / r;
      c.copy(dark).lerp(mid, 0.35 + 0.4 * (1 - f)).lerp(tipC, smoothstep(0.75, 1.05, rr) * 0.55);
      if (snowy && f < 0.75) c.lerp(snow, smoothstep(0.75, 0.2, f) * 0.85);
    }, new THREE.Vector3(0, y0 + h * 0.2, 0), 0.45));
    // underside skirt
    const u = new THREE.ConeGeometry(r * 0.9, h * 0.28, seg, 1, true);
    u.rotateX(Math.PI); u.translate(0, y0 - 0.05, 0);
    parts.push(prep(u, (v, c) => c.copy(under)));
  }
  const tipG = new THREE.ConeGeometry(0.3, 1.2, 6, 1);
  tipG.translate(0, H + 0.4, 0);
  parts.push(prep(tipG, (v, c) => c.copy(snowy ? snow : mid)));
  return mergeGeometries(parts);
}
function deadTree(rnd) {
  const parts = [];
  const c0 = 0x2e2830, c1 = 0x6a6072, cb = 0x5a5262;
  const h = 4.2 + rnd() * 1.2;
  parts.push(trunkGeo(rnd, { h, r0: 0.34, r1: 0.1, seg: 6, hseg: 5, col0: c0, col1: c1, bend: 0.4, flare: 1.6 }));
  for (let b = 0; b < 5; b++) {
    const a = b * 1.3 + rnd() * 0.8, y = h * (0.45 + b * 0.11);
    const from = new THREE.Vector3(Math.sin(y * 0.6) * 0.3, y, 0);
    const to = new THREE.Vector3(Math.cos(a) * (1.2 + rnd()), y + 0.6 + rnd() * 1.1, Math.sin(a) * (1.2 + rnd()));
    parts.push(branch(rnd, from, to, 0.09, 0.03, cb));
    const tw = to.clone().add(new THREE.Vector3((rnd() - 0.5) * 1.2, 0.5 + rnd() * 0.6, (rnd() - 0.5) * 1.2));
    parts.push(branch(rnd, to, tw, 0.03, 0.012, cb));
  }
  return mergeGeometries(parts);
}

// ---------------- shrubs & ground cover ----------------
function bush(rnd, flowers = false) {
  const parts = [canopy(rnd, {
    center: new THREE.Vector3(0, 0.45, 0), rx: 0.75, ry: 0.5, count: 7, rMin: 0.3, rMax: 0.48,
    light: 0x8cc653, dark: 0x356a2e, flat: 0.8, lowBias: 1.2,
  })];
  if (flowers) {
    const fl = [hc(0xff9ab8), hc(0xfff0a0), hc(0xffffff), hc(0xb9a0ff)][Math.floor(rnd() * 4)];
    for (let i = 0; i < 10; i++) {
      const a = rnd() * Math.PI * 2, r = rnd() * 0.65;
      const g = new THREE.OctahedronGeometry(0.075, 0);
      g.translate(Math.cos(a) * r, 0.62 + (0.65 - r) * 0.4 + rnd() * 0.08, Math.sin(a) * r * 0.9);
      parts.push(prep(g, (v, c) => c.copy(fl).multiplyScalar(0.95)));
    }
  }
  return mergeGeometries(parts);
}
function fern(rnd) {
  const pos = [], col = [], nrm = [];
  const base = hc(0x2c5a2a), tip = hc(0x7fb858);
  const F = 8;
  for (let f = 0; f < F; f++) {
    const a = (f / F) * Math.PI * 2 + rnd() * 0.5;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const L = 0.75 + rnd() * 0.45, lift = 0.4 + rnd() * 0.25;
    const rows = [];
    for (let s = 0; s <= 4; s++) {
      const t = s / 4;
      const w = 0.17 * Math.pow(Math.sin(Math.PI * Math.min(0.97, t * 0.92 + 0.08)), 0.8);
      const cx = dx * L * t, cz = dz * L * t, cy = Math.sin(t * Math.PI * 0.8) * lift - t * t * 0.12;
      rows.push([[cx + px * w, cy - w * 0.25, cz + pz * w], [cx - px * w, cy - w * 0.25, cz - pz * w], t]);
    }
    for (let s = 0; s < 4; s++) {
      const [a0, b0, t0] = rows[s], [a1, b1, t1] = rows[s + 1];
      const quad = [a0, b0, a1, b0, b1, a1];
      const ts = [t0, t0, t1, t0, t1, t1];
      for (let k = 0; k < 6; k++) {
        pos.push(...quad[k]);
        const c = base.clone().lerp(tip, ts[k] * 0.9);
        col.push(c.r, c.g, c.b);
        nrm.push(dx * 0.25, 0.95, dz * 0.25);
      }
    }
  }
  return soup(pos, col, nrm);
}
function reeds(rnd) {
  const pos = [], col = [], nrm = [];
  const base = hc(0x46652e), tip = hc(0xb8c46a), brown = hc(0x4e3222);
  const blade = (x, z, h, w, lx, lz, c0, c1) => {
    const rows = [[0, w], [0.55, w * 0.7], [1, 0]];
    const a = rnd() * Math.PI;
    const ca = Math.cos(a), sa = Math.sin(a);
    const P = rows.map(([t, ww]) => [[x + lx * t * t - ca * ww, h * t, z + lz * t * t - sa * ww], [x + lx * t * t + ca * ww, h * t, z + lz * t * t + sa * ww], t]);
    const tri = (p, q, r) => { for (const [pp, t] of [p, q, r]) { pos.push(...pp); const c = c0.clone().lerp(c1, t); col.push(c.r, c.g, c.b); nrm.push(-sa, 0.5, ca); } };
    tri([P[0][0], 0], [P[0][1], 0], [P[1][0], 0.55]);
    tri([P[0][1], 0], [P[1][1], 0.55], [P[1][0], 0.55]);
    tri([P[1][0], 0.55], [P[1][1], 0.55], [P[2][0], 1]);
  };
  for (let i = 0; i < 11; i++) {
    const r = rnd() * 0.35, a = rnd() * Math.PI * 2;
    blade(Math.cos(a) * r, Math.sin(a) * r, 1.2 + rnd() * 0.8, 0.035, Math.cos(a) * 0.25, Math.sin(a) * 0.25, base, tip);
  }
  // cattails
  for (let i = 0; i < 3; i++) {
    const x = (rnd() - 0.5) * 0.4, z = (rnd() - 0.5) * 0.4, h = 1.5 + rnd() * 0.5;
    blade(x, z, h, 0.012, 0, 0, base, tip);
    const g = ni(new THREE.CylinderGeometry(0.028, 0.032, 0.24, 6, 1));
    g.translate(x, h - 0.25, z);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let k = 0; k < p.count; k++) { pos.push(p.getX(k), p.getY(k), p.getZ(k)); col.push(brown.r, brown.g, brown.b); nrm.push(n.getX(k), n.getY(k), n.getZ(k)); }
  }
  return soup(pos, col, nrm);
}
function mushrooms(rnd) {
  const parts = [];
  const capU = hc(0xe8dcc0), stem = hc(0xeee4cc), dot = hc(0xfaf4e8);
  const n = 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const red = i === 0 || rnd() < 0.35;
    const capC = red ? hc(0xc4402c) : hc(0xc8a070);
    const x = (rnd() - 0.5) * 0.5, z = (rnd() - 0.5) * 0.5, s = 0.6 + rnd() * 0.7;
    const sh = 0.22 * s, cr = 0.13 * s;
    const st = new THREE.CylinderGeometry(0.03 * s, 0.045 * s, sh, 6, 1, true);
    st.translate(x, sh / 2, z);
    parts.push(prep(st, (v, c) => c.copy(stem)));
    const cap = new THREE.SphereGeometry(cr, 7, 2, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.65, 1); cap.translate(x, sh - 0.01, z);
    parts.push(prep(cap, (v, c) => { c.copy(capC); if (red && rnd() < 0.18) c.copy(dot); }));
    const und = new THREE.CircleGeometry(cr * 0.98, 7);
    und.rotateX(Math.PI / 2); und.translate(x, sh - 0.01, z);
    parts.push(prep(und, (v, c) => c.copy(capU)));
  }
  return mergeGeometries(parts);
}
function fallenLog(rnd) {
  const parts = [];
  const L = 2.6 + rnd() * 1.2, r = 0.26 + rnd() * 0.1;
  const g = new THREE.CylinderGeometry(r * 0.9, r, L, 8, 3, true);
  jitter(g, 0.05, rnd);
  g.rotateZ(Math.PI / 2); g.translate(0, r * 0.85, 0);
  const bark = hc(0x4e3a2a), barkL = hc(0x76583e), moss = hc(0x5f8a38);
  parts.push(prep(g, (v, c) => {
    c.copy(bark).lerp(barkL, clamp(v.y / (r * 2), 0, 1) * 0.6);
    if (v.y > r * 1.35 && Math.sin(v.x * 3.1) > -0.3) c.lerp(moss, 0.75);
  }));
  for (const s of [-1, 1]) {
    const cap = new THREE.CircleGeometry(s < 0 ? r * 0.9 : r, 8);
    cap.rotateY(s * Math.PI / 2); cap.translate(s * L / 2, r * 0.85, 0);
    const ring = hc(0xc9a676), core = hc(0x8a6a44);
    parts.push(prep(cap, (v, c) => c.copy(ring).lerp(core, Math.hypot(v.y - r * 0.85, v.z) < r * 0.3 ? 0.7 : 0)));
  }
  parts.push(branch(rnd, new THREE.Vector3(L * 0.15, r * 1.5, 0), new THREE.Vector3(L * 0.25, r * 1.5 + 0.5, 0.35), 0.06, 0.03, 0x5a4230));
  // shelf fungus
  const sf = new THREE.CylinderGeometry(0.16, 0.16, 0.04, 7, 1, false, 0, Math.PI);
  sf.translate(-L * 0.2, r * 0.9, r * 0.95);
  parts.push(prep(sf, (v, c) => c.set(0xe0c89a)));
  return mergeGeometries(parts);
}
function pebbles(rnd) {
  const parts = [];
  const n = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const s = 0.06 + rnd() * 0.16;
    const g = ni(jitter(new THREE.IcosahedronGeometry(s, 0), s * 0.5, rnd));
    g.scale(1, 0.55 + rnd() * 0.3, 1);
    const a = rnd() * 6.28, r = rnd() * 0.8;
    g.translate(Math.cos(a) * r, s * 0.2, Math.sin(a) * r);
    g.computeVertexNormals();
    const tone = 0.75 + rnd() * 0.35;
    const base = hc(rnd() < 0.5 ? 0x9a9286 : 0x8a8a90).multiplyScalar(tone);
    parts.push(prep(g, (v, c) => c.copy(base)));
  }
  return mergeGeometries(parts);
}
// Faceted rock: flat-shaded, per-facet tone jitter, noisy moss cap, dark base.
function rock(rnd, mossy = true, ash = false) {
  const g = ni(jitter(new THREE.IcosahedronGeometry(1, 1), 0.42, rnd));
  const sy = 0.6 + rnd() * 0.35;
  g.scale(1 + rnd() * 0.25, sy, 0.85 + rnd() * 0.35);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.25) p.setY(i, -0.25 + (p.getY(i) + 0.25) * 0.35);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const base = ash ? hc(0x5a5264) : hc(0x968e84), dark = ash ? hc(0x2e2a36) : hc(0x5e5952), moss = hc(0x62903e), mossD = hc(0x44702e);
  const col = new Float32Array(p.count * 3), c = new THREE.Color();
  const n = g.attributes.normal;
  for (let f = 0; f < p.count; f += 3) {
    const cy = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3, ny = n.getY(f);
    c.copy(dark).lerp(base, smoothstep(-0.3, 0.45, cy)).multiplyScalar(0.86 + rnd() * 0.26);
    if (mossy && !ash) c.lerp(rnd() < 0.5 ? moss : mossD, smoothstep(0.45, 0.8, ny + (rnd() - 0.5) * 0.35) * 0.9);
    for (let k = 0; k < 3; k++) { col[(f + k) * 3] = c.r; col[(f + k) * 3 + 1] = c.g; col[(f + k) * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ---------------- scatter ----------------
export class Props {
  constructor(scene, terrain, colliders, quality = 'high') {
    this.scene = scene; this.T = terrain; this.col = colliders;
    const rnd = mulberry32(4242);
    const tree = toon(0xffffff, { vertexColors: true, sway: 0.028, swayBase: 2.4, rim: 0.35, tex: 'bark', leafy: true });
    const fir = toon(0xffffff, { vertexColors: true, sway: 0.02, swayBase: 1.6, rim: 0.3, tex: 'bark', leafy: true });
    const shrub = toon(0xffffff, { vertexColors: true, sway: 0.05, swayBase: 0, rim: 0.3, tex: 'bark', leafy: true });
    const ground = toon(0xffffff, { vertexColors: true, sway: 0.09, swayBase: 0.05, rim: 0.25, side: THREE.DoubleSide });
    const solid = toon(0xffffff, { vertexColors: true, rim: 0.3, tex: 'bark' });
    const rockMat = toon(0xffffff, { vertexColors: true, flat: true, rim: 0.15, tex: 'rock' });
    const small = toon(0xffffff, { vertexColors: true, rim: 0.3 });
    const T = (geos, mat, o = {}) => ({ geos, mat, list: [], shadow: o.shadow ?? true, cell: o.cell ?? 160, tint: o.tint ?? 0.06 });
    this.types = {
      oak: T([broadleaf(rnd), broadleaf(rnd, { clusters: 21, size: 1.85 }), broadleaf(rnd, { light: 0xcad65a, dark: 0x6b8a38 })], tree),
      poplar: T([poplar(rnd), poplar(rnd)], tree),
      birch: T([birch(rnd), birch(rnd)], tree),
      willow: T([willow(rnd), willow(rnd, { size: 1.8 })], tree),
      pine: T([pine(rnd), pine(rnd)], fir),
      pineSnow: T([pine(rnd, true), pine(rnd, true)], fir),
      dead: T([deadTree(rnd), deadTree(rnd)], solid),
      bush: T([bush(rnd), bush(rnd, true), bush(rnd, true)], shrub, { shadow: false }),
      fern: T([fern(rnd)], ground, { shadow: false, cell: 240, tint: 0.1 }),
      reeds: T([reeds(rnd)], ground, { shadow: false, cell: 240, tint: 0.08 }),
      mushroom: T([mushrooms(rnd)], small, { shadow: false, cell: 240, tint: 0.05 }),
      log: T([fallenLog(rnd)], solid, { cell: 240, shadow: false }),
      pebbles: T([pebbles(rnd)], small, { shadow: false, cell: 240, tint: 0.12 }),
      rock: T([rock(rnd), rock(rnd), rock(rnd, false)], rockMat, { tint: 0.1 }),
    };
    this.scatter(rnd, quality);
    this.buildMeshes();
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

  scatter(rnd, quality) {
    const T = this.T;
    const q = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;
    const nv = T.noise;
    const place = (type, x, z, s, colR, dy = 0) => {
      const y = T.height(x, z) + dy;
      this.types[type].list.push({ x, y, z, s, r: rnd() * Math.PI * 2, v: Math.floor(rnd() * this.types[type].geos.length) });
      if (colR) this.col.addCircle(x, z, colR * s, y - 1, y + 6 * s);
    };
    const forestAt = (x, z) => smoothstep(0.0, 0.5, fbm(nv, x * 0.012 + 50, z * 0.012, 2));
    const lakeD = (x, z) => Math.hypot(x - POI.lake.x, z - POI.lake.z) / POI.lake.r;
    const woodsD = (x, z) => Math.hypot(x + 92, z - 128);
    // trees
    for (let i = 0; i < 6500 * q; i++) {
      const x = (rnd() - 0.5) * 460, z = (rnd() - 0.5) * 460;
      const h = T.height(x, z);
      if (h < 0.8) continue;
      const n = T.normal(x, z);
      if (n.y < 0.8) continue;
      const dRift = Math.hypot(x - POI.rift.x, z - POI.rift.z);
      let dens = forestAt(x, z) * 0.8 + 0.04;
      const dW = woodsD(x, z);
      dens += (1 - smoothstep(20, 55, dW)) * 0.7;
      if (z < -70) dens += 0.15;
      const dl = lakeD(x, z);
      const shore = dl > 0.92 && dl < 1.5 && h < 9;
      if (shore) dens += 0.25;
      if (dRift < 60) dens = 0.25;
      if (rnd() > dens) continue;
      if (this.excluded(x, z, 2)) continue;
      if (dRift < 60) { place('dead', x, z, 0.8 + rnd() * 0.5, 0.35); continue; }
      const s = 0.8 + rnd() * 0.55;
      const r = rnd();
      if (h > 30 || z < -80) place(h > 38 ? 'pineSnow' : 'pine', x, z, s, 0.45);
      else if (shore) place(r < 0.4 ? 'willow' : r < 0.7 ? 'birch' : 'oak', x, z, s, 0.5);
      else if (dW < 60) place(r < 0.5 ? 'oak' : r < 0.78 ? 'birch' : r < 0.9 ? 'pine' : 'poplar', x, z, s, 0.45);
      else place(r < 0.66 ? 'oak' : r < 0.82 ? 'poplar' : r < 0.92 ? 'birch' : 'pine', x, z, s, 0.45);
    }
    // bushes
    for (let i = 0; i < 3200 * q; i++) {
      const x = (rnd() - 0.5) * 460, z = (rnd() - 0.5) * 460;
      if (T.grassAt(x, z) < 0.6) continue;
      if (this.excluded(x, z, -1)) continue;
      const dens = smoothstep(-0.2, 0.5, fbm(nv, x * 0.012 + 50, z * 0.012, 2)) * 0.7 + 0.1;
      if (rnd() > dens) continue;
      place('bush', x, z, 0.7 + rnd() * 0.6, 0);
    }
    // ferns & mushrooms under the canopy, fallen logs in the woods
    for (let i = 0; i < 3000 * q; i++) {
      const x = (rnd() - 0.5) * 460, z = (rnd() - 0.5) * 460;
      if (T.grassAt(x, z) < 0.45 || this.excluded(x, z, -1.5)) continue;
      const f = forestAt(x, z) + (1 - smoothstep(20, 60, woodsD(x, z))) * 0.8;
      if (rnd() > f * 0.75) continue;
      const k = rnd();
      if (k < 0.8) place('fern', x, z, 0.7 + rnd() * 0.6, 0);
      else if (k < 0.97) place('mushroom', x, z, 0.8 + rnd() * 0.6, 0);
      else if (T.normal(x, z).y > 0.93) place('log', x, z, 0.85 + rnd() * 0.3, 0, -0.05);
    }
    // reeds along the lake shore and in the shallows
    for (let i = 0; i < 1800 * q; i++) {
      const a = rnd() * Math.PI * 2, rr = POI.lake.r * (0.7 + rnd() * 0.55);
      const x = POI.lake.x + Math.cos(a) * rr, z = POI.lake.z + Math.sin(a) * rr;
      const h = T.height(x, z);
      if (h < -0.75 || h > 1.1) continue;
      if (T.pathInfo(x, z).d < 3) continue;
      if (fbm(nv, x * 0.08, z * 0.08, 2) < -0.1) continue;
      place('reeds', x, z, 0.8 + rnd() * 0.5, 0);
    }
    // rocks + pebble scatter
    for (let i = 0; i < 2600 * q; i++) {
      const x = (rnd() - 0.5) * 470, z = (rnd() - 0.5) * 470;
      const h = T.height(x, z);
      const n = T.normal(x, z);
      const steep = 1 - n.y;
      if (n.y < 0.66) continue;
      if (rnd() > 0.25 + steep * 3 + (h > 30 ? 0.3 : 0)) continue;
      if (this.excluded(x, z, -2) && rnd() < 0.9) continue;
      const big = rnd() < 0.08;
      const s = big ? 2.2 + rnd() * 2.5 : 0.4 + rnd() * 1.2;
      place('rock', x, z, s, s > 0.9 ? 0.85 : 0);
      if (rnd() < 0.45) place('pebbles', x + (rnd() - 0.5) * s * 3, z + (rnd() - 0.5) * s * 3, 0.8 + rnd() * 0.6, 0);
    }
    for (let i = 0; i < 1600 * q; i++) {
      const x = (rnd() - 0.5) * 460, z = (rnd() - 0.5) * 460;
      const pf = T.pathAt(x, z);
      if (!(pf > 0.15 && pf < 0.7) && rnd() > 0.15) continue;
      if (T.height(x, z) < 0.3) continue;
      place('pebbles', x, z, 0.7 + rnd() * 0.6, 0);
    }
  }

  buildMeshes() {
    const dummy = new THREE.Object3D();
    this.meshes = [];
    const sunk = { rock: 0.45 };
    const rnd = mulberry32(99);
    const tc = new THREE.Color(), ashC = new THREE.Color(0.62, 0.56, 0.7);
    for (const [name, t] of Object.entries(this.types)) {
      const buckets = new Map();
      const CELL = t.cell;
      for (const it of t.list) {
        const k = `${Math.floor((it.x + 240) / CELL)},${Math.floor((it.z + 240) / CELL)},${it.v}`;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(it);
      }
      for (const [k, items] of buckets) {
        const v = +k.split(',')[2];
        const im = new THREE.InstancedMesh(t.geos[v], t.mat, items.length);
        items.forEach((it, i) => {
          dummy.position.set(it.x, it.y - (sunk[name] ? it.s * sunk[name] : name === 'pebbles' || name === 'mushroom' ? 0.02 : 0.15), it.z);
          dummy.rotation.set(0, it.r, 0);
          const rockLike = sunk[name] || name === 'pebbles';
          dummy.scale.set(it.s, it.s * (rockLike ? 1 : 0.9 + (i % 5) * 0.05), it.s);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
          const j = t.tint;
          tc.setRGB(1 - j * 0.5 + rnd() * j, 1 - j * 0.5 + rnd() * j, 1 - j * 0.5 + rnd() * j * 0.8);
          if ((name === 'rock' || name === 'pebbles') && Math.hypot(it.x - POI.rift.x, it.z - POI.rift.z) < 70) tc.multiply(ashC);
          im.setColorAt(i, tc);
        });
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = t.shadow;
        im.receiveShadow = true;
        im.name = name;
        this.scene.add(im);
        this.meshes.push(im);
      }
    }
  }
}

// Single unique tree (landmarks)
export function makeTree(kind = 'oak', seed = 1, opts = {}) {
  const rnd = mulberry32(seed);
  const geo = kind === 'pine' ? pine(rnd, opts.snowy) : kind === 'dead' ? deadTree(rnd) : kind === 'willow' ? willow(rnd, opts) : kind === 'birch' ? birch(rnd) : broadleaf(rnd, opts);
  const m = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true, sway: 0.02, swayBase: 2.4, rim: 0.35, tex: 'bark' }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
export { rock as rockGeometry, bush as bushGeometry };
