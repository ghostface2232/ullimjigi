// Procedural foliage & rocks, instanced per spatial cell for culling.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon } from '../render/materials.js';
import { mulberry32, fbm, smoothstep, lerp } from '../core/util.js';
import { POI } from './layout.js';

const V = new THREE.Vector3();
const ni = (g) => (g.index ? g.toNonIndexed() : g);

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
const hc = (h) => new THREE.Color(h);

// ---------------- tree builders ----------------
function broadleaf(rnd, opts = {}) {
  const parts = [];
  const trunkH = opts.trunkH ?? 3.0;
  const bark = hc(0x6e5238), barkDark = hc(0x4f3a28);
  const tr = new THREE.CylinderGeometry(0.2, 0.36, trunkH, 7, 3);
  tr.translate(0, trunkH / 2, 0);
  jitter(tr, 0.08, rnd);
  parts.push(prep(tr, (v, c) => c.copy(barkDark).lerp(bark, v.y / trunkH)));
  for (let b = 0; b < 2; b++) {
    const br = new THREE.CylinderGeometry(0.06, 0.12, 1.4, 5);
    br.translate(0, 0.7, 0);
    br.rotateZ((b ? 1 : -1) * 0.8); br.rotateY(rnd() * 6);
    br.translate(0, trunkH * 0.7, 0);
    parts.push(prep(br, (v, c) => c.copy(bark)));
  }
  const center = new THREE.Vector3(0, trunkH + 1.3, 0);
  const light = hc(opts.light ?? 0x9fd05a), dark = hc(opts.dark ?? 0x3f7f36);
  const blobs = opts.blobs ?? 5;
  const leaves = [];
  for (let i = 0; i < blobs; i++) {
    const r = (opts.size ?? 1.7) * (0.7 + rnd() * 0.45);
    const g = new THREE.IcosahedronGeometry(r, 1);
    jitter(g, r * 0.25, rnd);
    const a = (i / blobs) * Math.PI * 2 + rnd();
    const rr = i === 0 ? 0 : 1.1 + rnd() * 0.5;
    g.scale(1, opts.squash ?? 0.85, 1);
    g.translate(Math.cos(a) * rr, center.y + (i === 0 ? 0.9 : rnd() * 1.2 - 0.3), Math.sin(a) * rr);
    leaves.push(g);
  }
  const lg = mergeGeometries(leaves.map(ni));
  lg.computeVertexNormals();
  const top = center.y + 3, bot = center.y - 2;
  parts.push(prep(lg, (v, c) => {
    const t = smoothstep(bot, top, v.y);
    c.copy(dark).lerp(light, t * t * 0.9 + 0.1);
  }, center, 0.75));
  return mergeGeometries(parts);
}

function poplar(rnd) {
  return broadleaf(rnd, { trunkH: 2.2, blobs: 4, size: 1.2, squash: 1.9, light: 0xb5d86a, dark: 0x4a8a3a });
}

function pine(rnd, snowy = false) {
  const parts = [];
  const tr = new THREE.CylinderGeometry(0.14, 0.3, 2.2, 6);
  tr.translate(0, 1.1, 0);
  parts.push(prep(tr, (v, c) => c.set(0x5a4030)));
  const dark = hc(0x2c5a43), light = hc(0x4e8a5c), snow = hc(0xf2f6fa);
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const r = 2.2 - i * 0.45, h = 2.4 - i * 0.25;
    const g = new THREE.ConeGeometry(r, h, 8, 1);
    jitter(g, 0.18, rnd);
    const y0 = 1.6 + i * 1.25;
    g.translate(0, y0 + h / 2, 0);
    parts.push(prep(g, (v, c) => {
      const t = (v.y - y0) / h;
      c.copy(dark).lerp(light, 0.3 + t * 0.5);
      if (snowy && t > 0.35) c.lerp(snow, smoothstep(0.35, 0.8, t) * 0.9);
    }, new THREE.Vector3(0, y0 + h * 0.3, 0), 0.5));
  }
  return mergeGeometries(parts);
}

function deadTree(rnd) {
  const parts = [];
  const col = hc(0x4a4250), col2 = hc(0x6a6072);
  const tr = new THREE.CylinderGeometry(0.12, 0.35, 4.5, 6, 4);
  tr.translate(0, 2.25, 0);
  const p = tr.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.sin(y * 0.9) * 0.3); }
  parts.push(prep(tr, (v, c) => c.copy(col).lerp(col2, v.y / 4.5)));
  for (let b = 0; b < 4; b++) {
    const br = new THREE.CylinderGeometry(0.03, 0.09, 1.6 + rnd(), 4);
    br.translate(0, 0.8, 0);
    br.rotateZ((rnd() - 0.5) * 2.2); br.rotateY(rnd() * 6);
    br.translate(Math.sin(2.5) * 0.3, 2.2 + b * 0.6, 0);
    parts.push(prep(br, (v, c) => c.copy(col2)));
  }
  return mergeGeometries(parts);
}

function bush(rnd, flowers = false) {
  const blobs = [];
  for (let i = 0; i < 3; i++) {
    const r = 0.55 + rnd() * 0.35;
    const g = new THREE.IcosahedronGeometry(r, 1);
    jitter(g, 0.15, rnd);
    g.translate((rnd() - 0.5) * 0.9, r * 0.7, (rnd() - 0.5) * 0.9);
    blobs.push(ni(g));
  }
  const g = mergeGeometries(blobs); g.computeVertexNormals();
  const dark = hc(0x3f7a34), light = hc(0x8cc653), fl = [hc(0xff9ab8), hc(0xfff0a0), hc(0xffffff)][Math.floor(rnd() * 3)];
  return prep(g, (v, c) => {
    c.copy(dark).lerp(light, smoothstep(0, 1.3, v.y));
    if (flowers && rnd() < 0.08 && v.y > 0.5) c.copy(fl).multiplyScalar(1.2);
  }, new THREE.Vector3(0, 0.3, 0), 0.7);
}

function rock(rnd, mossy = true) {
  const g = new THREE.DodecahedronGeometry(1, 1);
  jitter(g, 0.45, rnd);
  g.scale(1, 0.7 + rnd() * 0.3, 0.9 + rnd() * 0.3);
  const ng = ni(g); ng.computeVertexNormals();
  const base = hc(0x958d82), dark = hc(0x6d675f), moss = hc(0x6e9a44);
  return prep(ng, (v, c) => {
    c.copy(dark).lerp(base, smoothstep(-0.8, 0.6, v.y));
    if (mossy && v.y > 0.35) c.lerp(moss, smoothstep(0.35, 0.8, v.y) * 0.8);
  });
}

// ---------------- scatter ----------------
export class Props {
  constructor(scene, terrain, colliders, quality = 'high') {
    this.scene = scene; this.T = terrain; this.col = colliders;
    const rnd = mulberry32(4242);
    const mat = toon(0xffffff, { vertexColors: true, sway: 0.028, swayBase: 2.4, rim: 0.35 });
    const rockMat = toon(0xffffff, { vertexColors: true, flat: true, rim: 0.15 });
    this.types = {
      oak: { geos: [broadleaf(rnd), broadleaf(rnd), broadleaf(rnd, { light: 0xc9d45a, dark: 0x6b8a38 })], mat, list: [] },
      poplar: { geos: [poplar(rnd), poplar(rnd)], mat, list: [] },
      pine: { geos: [pine(rnd), pine(rnd)], mat, list: [] },
      pineSnow: { geos: [pine(rnd, true), pine(rnd, true)], mat, list: [] },
      dead: { geos: [deadTree(rnd), deadTree(rnd)], mat: toon(0xffffff, { vertexColors: true, rim: 0.3 }), list: [] },
      bush: { geos: [bush(rnd), bush(rnd, true), bush(rnd, true)], mat: toon(0xffffff, { vertexColors: true, sway: 0.05, swayBase: 0, rim: 0.3 }), list: [] },
      rock: { geos: [rock(rnd), rock(rnd), rock(rnd, false)], mat: rockMat, list: [], shadow: true },
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
    if (Math.hypot(x, z) > 226) return true;
    if (this.T.pathInfo(x, z).d < 4.5 + r) return true;
    return false;
  }

  scatter(rnd, quality) {
    const T = this.T;
    const q = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;
    const nv = T.noise;
    const place = (type, x, z, s, colR) => {
      const y = T.height(x, z);
      this.types[type].list.push({ x, y, z, s, r: rnd() * Math.PI * 2, v: Math.floor(rnd() * this.types[type].geos.length) });
      if (colR) this.col.addCircle(x, z, colR * s, y - 1, y + 6 * s);
    };
    // trees
    for (let i = 0; i < 6500 * q; i++) {
      const x = (rnd() - 0.5) * 460, z = (rnd() - 0.5) * 460;
      const h = T.height(x, z);
      if (h < 0.8) continue;
      const n = T.normal(x, z);
      if (n.y < 0.8) continue;
      const dRift = Math.hypot(x - POI.rift.x, z - POI.rift.z);
      let dens = smoothstep(0.0, 0.5, fbm(nv, x * 0.012 + 50, z * 0.012, 2)) * 0.8 + 0.04;
      const dW = Math.hypot(x + 92, z - 128);
      dens += (1 - smoothstep(20, 55, dW)) * 0.7;
      if (z < -70) dens += 0.15;
      if (dRift < 60) dens = 0.25;
      if (rnd() > dens) continue;
      if (this.excluded(x, z, 2)) continue;
      if (dRift < 60) { place('dead', x, z, 0.8 + rnd() * 0.5, 0.35); continue; }
      const s = 0.8 + rnd() * 0.55;
      if (h > 30 || z < -80) place(h > 38 ? 'pineSnow' : 'pine', x, z, s, 0.45);
      else {
        const r = rnd();
        place(r < 0.72 ? 'oak' : r < 0.87 ? 'poplar' : 'pine', x, z, s, 0.45);
      }
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
    // rocks
    for (let i = 0; i < 2600 * q; i++) {
      const x = (rnd() - 0.5) * 470, z = (rnd() - 0.5) * 470;
      const h = T.height(x, z);
      const n = T.normal(x, z);
      const steep = 1 - n.y;
      if (rnd() > 0.25 + steep * 3 + (h > 30 ? 0.3 : 0)) continue;
      if (this.excluded(x, z, -2) && rnd() < 0.9) continue;
      const big = rnd() < 0.08;
      const s = big ? 2.2 + rnd() * 2.5 : 0.4 + rnd() * 1.2;
      place('rock', x, z, s, s > 0.9 ? 0.85 : 0);
    }
  }

  buildMeshes() {
    const CELL = 96, dummy = new THREE.Object3D();
    this.meshes = [];
    for (const [name, t] of Object.entries(this.types)) {
      const buckets = new Map();
      for (const it of t.list) {
        const k = `${Math.floor((it.x + 240) / CELL)},${Math.floor((it.z + 240) / CELL)},${it.v}`;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(it);
      }
      for (const [k, items] of buckets) {
        const v = +k.split(',')[2];
        const im = new THREE.InstancedMesh(t.geos[v], t.mat, items.length);
        items.forEach((it, i) => {
          dummy.position.set(it.x, it.y - (name === 'rock' ? it.s * 0.35 : 0.1), it.z);
          dummy.rotation.set(0, it.r, 0);
          dummy.scale.set(it.s, it.s * (name === 'rock' ? 1 : 0.9 + (i % 5) * 0.05), it.s);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = name !== 'bush';
        im.receiveShadow = true;
        this.scene.add(im);
        this.meshes.push(im);
      }
    }
  }
}

// Single unique tree (landmarks)
export function makeTree(kind = 'oak', seed = 1, opts = {}) {
  const rnd = mulberry32(seed);
  const geo = kind === 'pine' ? pine(rnd, opts.snowy) : kind === 'dead' ? deadTree(rnd) : broadleaf(rnd, opts);
  const m = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true, sway: 0.02, swayBase: 2.4, rim: 0.35 }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
export { rock as rockGeometry, bush as bushGeometry };
