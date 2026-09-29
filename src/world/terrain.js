// Heightfield terrain: hand-shaped noise with carved roads and flattened
// landmarks, vertex-painted in a BotW-like palette.
import * as THREE from 'three';
import { createNoise2D, fbm, ridged, smoothstep, lerp, segDist, clamp } from '../core/util.js';
import { toon, U } from '../render/materials.js';
import { PATHS, POI } from './layout.js';

const hex = (h) => new THREE.Color(h);
const P = {
  grassLight: hex(0x9fc85a), grassMid: hex(0x6fa843), grassDark: hex(0x4a8238), grassTeal: hex(0x4e9468),
  grassWarm: hex(0xb3c052), grassCool: hex(0x5f9e5a),
  dry: hex(0xbfb466), dirt: hex(0xb89468), dirtDark: hex(0x86694b), dirtLight: hex(0xcdb088), worn: hex(0x7d8a4a),
  rock: hex(0x928a7e), rockDark: hex(0x6b655e), rockWarm: hex(0xa8957c), rockCool: hex(0x7f8590),
  sand: hex(0xe0cf9c), wetSand: hex(0xa8986e),
  snow: hex(0xc9d4e2), snowShade: hex(0x9fb0c6),
  ash: hex(0x564d60), ashLight: hex(0x7a6f86),
  plaza: hex(0xc0b29a),
};

export class Terrain {
  constructor(seed = 1337) {
    this.noise = createNoise2D(seed);
    this.noise2 = createNoise2D(seed + 11);
    this.noise3 = createNoise2D(seed + 23);
    this.size = 480; this.half = 240; this.seg = 240; this.step = this.size / this.seg; this.N = this.seg + 1;
    // Precompute path segment data
    this.paths = PATHS.map((p) => {
      const segs = []; let total = 0;
      for (let i = 0; i < p.pts.length - 1; i++) {
        const [ax, az] = p.pts[i], [bx, bz] = p.pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        segs.push({ ax, az, bx, bz, len, start: total }); total += len;
      }
      return { ...p, segs, total };
    });
    const N = this.N;
    this.h = new Float32Array(N * N);
    this.pf = new Float32Array(N * N);
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const x = -this.half + ix * this.step, z = -this.half + iz * this.step;
        this.h[iz * N + ix] = this.rawHeight(x, z);
        this.pf[iz * N + ix] = this._lastPF;
      }
    }
    this.buildMesh();
    this.buildHeightTexture();
  }

  // Heightmap for shaders (ground-contact AO, grime, soft particles).
  buildHeightTexture() {
    const N = this.N, data = new Uint16Array(N * N);
    for (let i = 0; i < N * N; i++) data[i] = THREE.DataUtils.toHalfFloat(this.h[i]);
    const t = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.HalfFloatType);
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    this.heightTex = t;
    U.heightTex.value = t;
    // uv = (xz + half) * (N-1)/(N*size) + 0.5/N  (texel centres on grid vertices)
    U.heightP.value.set(this.half, (N - 1) / (N * this.size), 0.5 / N, 0);
  }

  pathInfo(x, z) {
    let bd = 1e9, bh = 0;
    for (const p of this.paths) {
      for (const s of p.segs) {
        const r = segDist(x, z, s.ax, s.az, s.bx, s.bz);
        if (r.d < bd) { bd = r.d; bh = lerp(p.h0, p.h1, (s.start + r.t * s.len) / p.total); }
      }
    }
    return { d: bd, h: bh };
  }

  rawHeight(x, z) {
    const n = this.noise, n2 = this.noise2;
    let h = 5 + fbm(n, x * 0.0045, z * 0.0045, 5) * 13;
    h += Math.max(0, fbm(n2, x * 0.011 + 31, z * 0.011 - 17, 3)) * 9;
    const r = Math.hypot(x, z);
    const rg = ridged(n2, x * 0.013, z * 0.013, 4);
    const north = smoothstep(-50, -190, z);
    h += north * (16 + rg * 22);
    const edge = smoothstep(172, 232, r);
    h += edge * (36 + rg * 26);
    h += smoothstep(118, 178, x) * (1 - edge) * 14 * (0.5 + 0.5 * rg);
    // west woods: gentle hollows
    // rift crater
    const dr = Math.hypot(x - POI.rift.x, z - POI.rift.z);
    h = lerp(h, 3 + dr * 0.03, 1 - smoothstep(24, 46, dr));
    h += 7 * Math.exp(-((dr - 49) * (dr - 49)) / 60);
    // meadow knoll
    const dm = Math.hypot(x - POI.meadow.x, z - POI.meadow.z);
    h = lerp(h, 13, 1 - smoothstep(5, 20, dm));
    // roads
    const pi = this.pathInfo(x, z);
    const roadBed = 1 - smoothstep(3.5, 15, pi.d);
    h = lerp(h, pi.h, roadBed * 0.94);
    this._lastPF = 1 - smoothstep(1.6, 3.3, pi.d + fbm(this.noise3, x * 0.2, z * 0.2, 2) * 0.8);
    // flattened landmarks
    const fl = (cx, cz, r0, r1, th) => { const d = Math.hypot(x - cx, z - cz); h = lerp(h, th, 1 - smoothstep(r0, r1, d)); };
    fl(POI.village.x, POI.village.z, 40, 64, 8);
    fl(POI.towerYard.x, POI.towerYard.z, 22, 40, 24);
    fl(POI.frost.x, POI.frost.z, 16, 34, 56);
    fl(POI.storm.x, POI.storm.z, 22, 40, 34);
    // lake basin
    const dl = Math.hypot(x - POI.lake.x, z - POI.lake.z) / POI.lake.r;
    h = lerp(h, -7 + dl * dl * 6.5, 1 - smoothstep(0.7, 1.28, dl));
    const di = Math.hypot(x - POI.island.x, z - POI.island.z);
    h = lerp(h, 1.9 + (1 - di / 7) * 0.8, 1 - smoothstep(3, 7, di));
    return h;
  }

  // exact triangle interpolation matching the mesh
  height(x, z) {
    const N = this.N;
    let fx = (x + this.half) / this.step, fz = (z + this.half) / this.step;
    fx = clamp(fx, 0, this.seg - 0.0001); fz = clamp(fz, 0, this.seg - 0.0001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz;
    const h00 = this.h[iz * N + ix], h10 = this.h[iz * N + ix + 1], h01 = this.h[(iz + 1) * N + ix], h11 = this.h[(iz + 1) * N + ix + 1];
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  normal(x, z, out = new THREE.Vector3()) {
    const e = 1.0;
    const hl = this.height(x - e, z), hr = this.height(x + e, z), hd = this.height(x, z - e), hu = this.height(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  sampleGrid(arr, x, z) {
    const N = this.N;
    let fx = clamp((x + this.half) / this.step, 0, this.seg - 0.0001), fz = clamp((z + this.half) / this.step, 0, this.seg - 0.0001);
    const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
    const a = arr[iz * N + ix], b = arr[iz * N + ix + 1], c = arr[(iz + 1) * N + ix], d = arr[(iz + 1) * N + ix + 1];
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  grassAt(x, z) { return this.sampleGrid(this.gf, x, z); }
  pathAt(x, z) { return this.sampleGrid(this.pf, x, z); }
  colorAt(x, z, out = new THREE.Color()) {
    const N = this.N;
    const ix = clamp(Math.round((x + this.half) / this.step), 0, this.seg), iz = clamp(Math.round((z + this.half) / this.step), 0, this.seg);
    const i = (iz * N + ix) * 3;
    return out.setRGB(this.col[i], this.col[i + 1], this.col[i + 2]);
  }
  surfaceAt(x, z) {
    const h = this.height(x, z);
    if (h < -0.2) return 'water';
    const i = this.snowAt(x, z);
    if (i > 0.5) return 'snow';
    if (this.pathAt(x, z) > 0.5 || Math.hypot(x - POI.village.x, z - POI.village.z) < 14) return 'stone';
    return 'grass';
  }
  snowAt(x, z) { return this.sampleGrid(this.sn, x, z); }

  paint(x, z, h, ny, pf, out) {
    const n = this.noise3;
    const gN = fbm(n, x * 0.018, z * 0.018, 2) * 0.5 + 0.5;
    const forest = smoothstep(0.1, 0.6, fbm(this.noise, x * 0.012 + 50, z * 0.012, 2));
    const dry = smoothstep(0.2, 0.7, fbm(n, x * 0.008 - 40, z * 0.008 + 12, 2));
    // broad hue patches: warm yellow-green meadows vs. cool blue-green hollows
    const hue = fbm(this.noise2, x * 0.0065 + 7, z * 0.0065 - 3, 3);
    out.copy(P.grassMid).lerp(P.grassLight, gN);
    out.lerp(P.grassWarm, smoothstep(0.05, 0.5, hue) * 0.45);
    out.lerp(P.grassCool, smoothstep(-0.05, -0.5, hue) * 0.4);
    out.lerp(P.grassDark, forest * 0.65);
    out.lerp(P.dry, dry * 0.4);
    out.lerp(P.grassTeal, smoothstep(22, 40, h) * 0.5);
    const rk = smoothstep(0.82, 0.68, ny);
    const rockC = P.rock.clone().lerp(P.rockDark, smoothstep(-0.3, 0.5, n(x * 0.05, z * 0.05)))
      .lerp(P.rockWarm, smoothstep(0.2, 0.8, n(x * 0.02 + 9, z * 0.02)) * 0.5)
      .lerp(P.rockCool, smoothstep(0.1, 0.7, n(x * 0.013 - 21, z * 0.013 + 4)) * 0.45);
    // grassy ledges keep a mossy tint where the slope eases off
    out.lerp(rockC, rk);
    out.lerp(P.grassDark, rk * (1 - rk) * 0.5);
    const sd = smoothstep(1.7, 0.5, h);
    out.lerp(h < -0.3 ? P.wetSand : P.sand, sd);
    // paths: trampled, darker grass at the edge, lighter packed dirt in the middle
    const edge = smoothstep(0.05, 0.4, pf) * (1 - smoothstep(0.45, 0.85, pf));
    out.lerp(P.worn, edge * 0.45 * (1 - sd));
    const dirtC = P.dirt.clone().lerp(P.dirtDark, gN * 0.45).lerp(P.dirtLight, smoothstep(0.75, 1, pf) * smoothstep(-0.2, 0.6, n(x * 0.3, z * 0.3)) * 0.5);
    out.lerp(dirtC, smoothstep(0.3, 0.8, pf) * 0.94);
    let sn = smoothstep(38, 48, h + n(x * 0.03, z * 0.03) * 6) * smoothstep(-40, -90, z);
    sn *= 1 - rk * 0.55;
    out.lerp(P.snow.clone().lerp(P.snowShade, rk), sn);
    const dr = Math.hypot(x - POI.rift.x, z - POI.rift.z);
    const ash = 1 - smoothstep(40, 66, dr + n(x * 0.05, z * 0.05) * 8);
    out.lerp(P.ash.clone().lerp(P.ashLight, gN), ash);
    const dp = Math.hypot(x - POI.bellTower.x, z - POI.bellTower.z);
    const plaza = 1 - smoothstep(10, 14, dp + n(x * 0.1, z * 0.1) * 1.5);
    out.lerp(P.plaza, plaza * 0.9);
    const gf = (1 - rk) * (1 - sd) * (1 - pf) * (1 - sn) * (1 - ash) * (1 - plaza) * (h > 0.4 ? 1 : 0);
    return { gf, sn };
  }

  // Curvature-based ambient occlusion: concave cells (valleys, cliff feet)
  // darken and cool slightly, convex ridges brighten a touch.
  ambientOcclusion(i, ix, iz) {
    const N = this.N, H = this.h;
    let occ = 0, wsum = 0;
    for (const r of [1, 3, 6]) {
      const x0 = Math.max(0, ix - r), x1 = Math.min(this.seg, ix + r), z0 = Math.max(0, iz - r), z1 = Math.min(this.seg, iz + r);
      const avg = (H[iz * N + x0] + H[iz * N + x1] + H[z0 * N + ix] + H[z1 * N + ix]) * 0.25;
      occ += (avg - H[i]) / (r * this.step) * (1 / r); wsum += 1 / r;
    }
    return occ / wsum;
  }

  buildMesh() {
    const N = this.N, cnt = N * N;
    const pos = new Float32Array(cnt * 3);
    const col = (this.col = new Float32Array(cnt * 3));
    this.gf = new Float32Array(cnt);
    this.sn = new Float32Array(cnt);
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const i = iz * N + ix;
      pos[i * 3] = -this.half + ix * this.step;
      pos[i * 3 + 1] = this.h[i];
      pos[i * 3 + 2] = -this.half + iz * this.step;
    }
    const idx = new Uint32Array(this.seg * this.seg * 6);
    let k = 0;
    for (let iz = 0; iz < this.seg; iz++) for (let ix = 0; ix < this.seg; ix++) {
      const a = iz * N + ix, b = a + 1, c = a + N, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal.array;
    const c = new THREE.Color();
    for (let i = 0; i < cnt; i++) {
      const x = pos[i * 3], z = pos[i * 3 + 2];
      const r = this.paint(x, z, this.h[i], nrm[i * 3 + 1], this.pf[i], c);
      this.gf[i] = r.gf; this.sn[i] = r.sn;
      const curv = this.ambientOcclusion(i, i % N, Math.floor(i / N));
      const ao = 1 - 0.34 * smoothstep(0.0, 0.6, curv) + 0.05 * smoothstep(0.0, -0.5, curv);
      col[i * 3] = c.r * ao * (ao < 1 ? 0.97 + 0.03 * ao : 1); col[i * 3 + 1] = c.g * ao; col[i * 3 + 2] = c.b * (ao < 1 ? 0.5 + 0.5 * ao + 0.04 : ao);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true, terrain: true, rim: 0.05 }));
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
  }

  // Depth texture for the water shader: 0 = land >= 2m, 1 = 10m deep
  depthTexture() {
    const N = this.N, data = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) data[i] = Math.round(clamp((2 - this.h[i]) / 12, 0, 1) * 255);
    const t = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }

  // Ray march against the heightfield
  raycast(origin, dir, maxDist = 200) {
    let t = 0, step = 0.8;
    let prevAbove = origin.y - this.height(origin.x, origin.z);
    if (prevAbove < 0) return null;
    while (t < maxDist) {
      t += step;
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      const above = y - this.height(x, z);
      if (above < 0) {
        // refine
        let lo = t - step, hi = t;
        for (let i = 0; i < 6; i++) {
          const m = (lo + hi) / 2;
          const a = origin.y + dir.y * m - this.height(origin.x + dir.x * m, origin.z + dir.z * m);
          if (a < 0) hi = m; else lo = m;
        }
        return hi;
      }
      step = Math.min(3, 0.5 + t * 0.02);
      prevAbove = above;
    }
    return null;
  }
}
