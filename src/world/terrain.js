// Heightfield terrain: hand-shaped noise with carved roads and flattened
// landmarks, vertex-painted in a BotW-like palette.
import * as THREE from 'three';
import { createNoise2D, fbm, ridged, smoothstep, lerp, clamp } from '../core/util.js';
import { toon, U } from '../render/materials.js';
import { PATHS, POI, PADS, PASSES, WORLD } from './layout.js';
import { OUTER, outerWeights } from './regions/index.js';

// Chunked level of detail: CH grid cells (CH·step metres) per chunk side; LOD k draws every
// 2^k-th vertex. A chunk picks its LOD from the camera's distance to its bounds.
const CH = 128;
const LOD_R = [150, 420, 800];
const LOD_KEEP = [450, 900];      // built LOD 0 / 1 geometry is freed beyond these distances
const SKIRT = [3, 6, 12, 24];     // skirt depth per LOD: hides cracks between neighbouring LODs
// shared noise fields handed to the region height / paint functions (regions/README.md)
const F = { b: 0, d: 0, rg: 0, dry: 0, n: null, n2: null, n3: null };
const segT = (x, z, s) => {
  const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz;
  return l2 > 0 ? clamp(((x - s.ax) * dx + (z - s.az) * dz) / l2, 0, 1) : 0;
};

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

// Area-weighted vertex normals of a heightfield grid (what computeVertexNormals gives the mesh).
function gridNormals(H, N, st) {
  const nrm = new Float32Array(N * N * 3), seg = N - 1;
  const add = (i, x, y, z) => { nrm[i * 3] += x; nrm[i * 3 + 1] += y; nrm[i * 3 + 2] += z; };
  for (let iz = 0; iz < seg; iz++) for (let ix = 0; ix < seg; ix++) {
    const a = iz * N + ix, b = a + 1, c = a + N, d = c + 1;
    const h00 = H[a], h10 = H[b], h01 = H[c], h11 = H[d], fy = st * st;
    let fx = st * (h00 - h10), fz = st * (h00 - h01);   // triangle (a, c, b)
    add(a, fx, fy, fz); add(c, fx, fy, fz); add(b, fx, fy, fz);
    fx = st * (h01 - h11); fz = st * (h10 - h11);        // triangle (b, c, d)
    add(b, fx, fy, fz); add(c, fx, fy, fz); add(d, fx, fy, fz);
  }
  for (let i = 0; i < N * N; i++) {
    const x = nrm[i * 3], y = nrm[i * 3 + 1], z = nrm[i * 3 + 2], l = 1 / Math.hypot(x, y, z);
    nrm[i * 3] = x * l; nrm[i * 3 + 1] = y * l; nrm[i * 3 + 2] = z * l;
  }
  return nrm;
}

export class Terrain {
  constructor(seed = 1337) {
    this.noise = createNoise2D(seed);
    this.noise2 = createNoise2D(seed + 11);
    this.noise3 = createNoise2D(seed + 23);
    this.size = WORLD.size; this.half = WORLD.half; this.step = 2; this.seg = this.size / this.step; this.N = this.seg + 1;
    this.bound = WORLD.bound;
    // Precompute path segment data
    const lines = (list, hOf) => list.map((p) => {
      const segs = []; let total = 0;
      for (let i = 0; i < p.pts.length - 1; i++) {
        const [ax, az] = p.pts[i], [bx, bz] = p.pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        segs.push({ ax, az, bx, bz, len, start: total, h0: hOf(p, i), h1: hOf(p, i + 1) }); total += len;
      }
      const xs = p.pts.map((q) => q[0]), zs = p.pts.map((q) => q[1]);
      return { ...p, segs, total, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    });
    this.paths = lines(PATHS, () => 0);
    this.passes = lines(PASSES, (p, i) => p.pts[i][2]);
    // everything farther than this from a road's bounding box is unaffected by it
    this.pathBox = this.paths.reduce((b, p) => ({ x0: Math.min(b.x0, p.x0), x1: Math.max(b.x1, p.x1), z0: Math.min(b.z0, p.z0), z1: Math.max(b.z1, p.z1) }), { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 });
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

  inWorld(x, z) { return Math.abs(x) < this.half && Math.abs(z) < this.half; }

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

  // Nearest road: distance and the road bed height there. Past 30 m from every road the
  // answer no longer matters to anyone (road beds fade out by 15 m).
  pathInfo(x, z) {
    const B = this.pathBox;
    if (x < B.x0 - 30 || x > B.x1 + 30 || z < B.z0 - 30 || z > B.z1 + 30) return { d: 1e9, h: 0 };
    let bd = 1e9, bh = 0;
    for (const p of this.paths) {
      if (x < p.x0 - 30 || x > p.x1 + 30 || z < p.z0 - 30 || z > p.z1 + 30) continue;
      for (const s of p.segs) {
        const t = segT(x, z, s), cx = s.ax + (s.bx - s.ax) * t, cz = s.az + (s.bz - s.az) * t;
        const d = Math.hypot(x - cx, z - cz);
        if (d < bd) { bd = d; bh = lerp(p.h0, p.h1, (s.start + t * s.len) / p.total); }
      }
    }
    return { d: bd, h: bh };
  }

  // Passes through the ring mountains: carve down towards the pass floor; fill up only outside the vale.
  carvePasses(x, z, h) {
    for (const p of this.passes) {
      const m = p.w * 2.6;
      if (x < p.x0 - m || x > p.x1 + m || z < p.z0 - m || z > p.z1 + m) continue;
      let bd = 1e9, bh = 0;
      for (const s of p.segs) {
        const t = segT(x, z, s), cx = s.ax + (s.bx - s.ax) * t, cz = s.az + (s.bz - s.az) * t;
        const d = Math.hypot(x - cx, z - cz);
        if (d < bd) { bd = d; bh = lerp(s.h0, s.h1, t); }
      }
      const k = 1 - smoothstep(p.w, m, bd + fbm(this.noise3, x * 0.03, z * 0.03, 2) * 5);
      if (k <= 0) continue;
      const floor = bh + fbm(this.noise2, x * 0.02 + 5, z * 0.02, 2) * 2.5;
      h = lerp(h, floor, h > floor ? k : k * smoothstep(232, 252, Math.hypot(x, z)));
    }
    return h;
  }

  // The lands beyond the ring: each outer region (regions/*.js) gives a height, blended by
  // direction; the sea and the mountains along the map edge go on top.
  outerHeight(x, z) {
    const n = this.noise, n2 = this.noise2, n3 = this.noise3;
    const b = (F.b = fbm(n, x * 0.0032 + 11, z * 0.0032 - 5, 5));
    const d = (F.d = fbm(n3, x * 0.011 - 7, z * 0.011 + 3, 3));
    const rg = (F.rg = ridged(n2, x * 0.0085 + 3, z * 0.0085 - 9, 4));
    F.n = n; F.n2 = n2; F.n3 = n3;
    const w = outerWeights(x, z);
    let h = 0;
    for (let i = 0; i < OUTER.length; i++) h += w[i] * OUTER[i].height(x, z, F);
    // the sea to the south, with a ragged coastline
    const coast = 548 + fbm(n3, x * 0.005 + 2, 7.7, 3) * 40;
    h = lerp(h, -10 + d * 2, smoothstep(coast - 90, coast + 10, z));
    // mountains along the other map edges
    const e = Math.max(Math.abs(x), -z);
    h += smoothstep(566, 630, e) * (60 + rg * 40);
    return h;
  }

  // The vale and its ring mountains (unchanged from the original 480 m map inside r ≈ 236).
  valleyHeight(x, z, r) {
    const n = this.noise, n2 = this.noise2;
    let h = 5 + fbm(n, x * 0.0045, z * 0.0045, 5) * 13;
    h += Math.max(0, fbm(n2, x * 0.011 + 31, z * 0.011 - 17, 3)) * 9;
    const rg = ridged(n2, x * 0.013, z * 0.013, 4);
    const north = smoothstep(-50, -190, z);
    h += north * (16 + rg * 22);
    const edge = smoothstep(172, 232, r);
    h += edge * (36 + rg * 26);
    h += smoothstep(118, 178, x) * (1 - edge) * 14 * (0.5 + 0.5 * rg);
    return h;
  }

  // legacy: the original 480 m map, without the outer lands and the passes
  rawHeight(x, z, legacy = false) {
    const r = Math.hypot(x, z);
    const out = legacy ? 0 : smoothstep(236, 340, r);
    let h = out < 1 ? this.valleyHeight(x, z, r) : 0;
    if (out > 0) h = lerp(h, this.outerHeight(x, z), out);
    if (!legacy) h = this.carvePasses(x, z, h);
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
    if (pi.d < 20) {
      const roadBed = 1 - smoothstep(3.5, 15, pi.d);
      h = lerp(h, pi.h, roadBed * 0.94);
      this._lastPF = 1 - smoothstep(1.6, 3.3, pi.d + fbm(this.noise3, x * 0.2, z * 0.2, 2) * 0.8);
    } else this._lastPF = 0;
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
  height(x, z, g = this) {
    const N = g.N, H = g.h;
    let fx = (x + g.half) / g.step, fz = (z + g.half) / g.step;
    fx = clamp(fx, 0, g.seg - 0.0001); fz = clamp(fz, 0, g.seg - 0.0001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz;
    const h00 = H[iz * N + ix], h10 = H[iz * N + ix + 1], h01 = H[(iz + 1) * N + ix], h11 = H[(iz + 1) * N + ix + 1];
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  normal(x, z, out = new THREE.Vector3(), g = this) {
    const e = 1.0;
    const hl = this.height(x - e, z, g), hr = this.height(x + e, z, g), hd = this.height(x, z - e, g), hu = this.height(x, z + e, g);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  sampleGrid(arr, x, z, g = this) {
    const N = g.N;
    let fx = clamp((x + g.half) / g.step, 0, g.seg - 0.0001), fz = clamp((z + g.half) / g.step, 0, g.seg - 0.0001);
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

  paint(x, z, h, ny, pf, out, legacy = false) {
    const n = this.noise3;
    const outer = legacy ? 0 : smoothstep(236, 340, Math.hypot(x, z));
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
    if (outer > 0) {
      const w = outerWeights(x, z);
      F.dry = dry;
      for (let i = 0; i < OUTER.length; i++) if (OUTER[i].paint) OUTER[i].paint(out, outer * w[i], F, P);
    }
    out.lerp(P.grassTeal, smoothstep(22, 40, h) * 0.5 * (1 - outer * 0.6));
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
    // snow line: 38 m in the vale (unchanged inside r 226); higher outside, most of all out
    // west, where the cliffs are tall but not alpine
    const sl = legacy ? 38 : 38 + outer * 22 + smoothstep(226, 262, Math.hypot(x, z)) * 40 * smoothstep(-100, -260, x);
    let sn = smoothstep(sl, sl + 10, h + n(x * 0.03, z * 0.03) * 6) * smoothstep(-40, -90, z);
    sn *= 1 - rk * 0.55;
    // wide snowfields out north get drifts of shade so they don't burn out to white
    out.lerp(P.snow.clone().lerp(P.snowShade, Math.min(1, rk + outer * (0.6 + 0.3 * smoothstep(-0.3, 0.5, n(x * 0.011 + 3, z * 0.011))))), sn);
    const dr = Math.hypot(x - POI.rift.x, z - POI.rift.z);
    const ash = dr > 80 ? 0 : 1 - smoothstep(40, 66, dr + n(x * 0.05, z * 0.05) * 8);
    if (ash > 0) out.lerp(P.ash.clone().lerp(P.ashLight, gN), ash);
    const dp = Math.hypot(x - POI.bellTower.x, z - POI.bellTower.z);
    const plaza = dp > 20 ? 0 : 1 - smoothstep(10, 14, dp + n(x * 0.1, z * 0.1) * 1.5);
    out.lerp(P.plaza, plaza * 0.9);
    let pad = 0;
    for (const q of PADS) { const dq = Math.hypot(x - q.x, z - q.z); if (dq < q.r + 5) pad = Math.max(pad, 1 - smoothstep(q.r - 2, q.r + 0.5, dq + n(x * 0.12, z * 0.12) * 1.5)); }
    if (pad > 0) out.lerp(P.plaza.clone().lerp(P.rock, 0.35), pad * 0.85);
    const gf = (1 - rk) * (1 - sd) * (1 - pf) * (1 - sn) * (1 - ash) * (1 - plaza) * (1 - pad) * (h > 0.4 ? 1 : 0);
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
    const N = this.N, cnt = N * N, H = this.h, st = this.step;
    const col = (this.col = new Float32Array(cnt * 3));
    this.gf = new Float32Array(cnt);
    this.sn = new Float32Array(cnt);
    const nrm = (this.nrm = gridNormals(H, N, st));
    const c = new THREE.Color();
    for (let i = 0; i < cnt; i++) {
      const x = -this.half + (i % N) * st, z = -this.half + Math.floor(i / N) * st;
      const r = this.paint(x, z, H[i], nrm[i * 3 + 1], this.pf[i], c);
      this.gf[i] = r.gf; this.sn[i] = r.sn;
      const curv = this.ambientOcclusion(i, i % N, Math.floor(i / N));
      const ao = 1 - 0.34 * smoothstep(0.0, 0.6, curv) + 0.05 * smoothstep(0.0, -0.5, curv);
      col[i * 3] = c.r * ao * (ao < 1 ? 0.97 + 0.03 * ao : 1); col[i * 3 + 1] = c.g * ao; col[i * 3 + 2] = c.b * (ao < 1 ? 0.5 + 0.5 * ao + 0.04 : ao);
    }
    this.buildChunks();
  }

  // The original 480 m map's grid (heights, road and grass factors), for scattering props and
  // loose objects exactly where they were before the map grew. Built on first use; World drops
  // it once the vale is populated (`dropLegacy`).
  legacy() {
    if (this._legacy) return this._legacy;
    const N = 241, half = 240, st = 2, h = new Float32Array(N * N), pf = new Float32Array(N * N), gf = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) { h[i] = this.rawHeight(-half + (i % N) * st, -half + Math.floor(i / N) * st, true); pf[i] = this._lastPF; }
    const nrm = gridNormals(h, N, st), c = new THREE.Color();
    for (let i = 0; i < N * N; i++) gf[i] = this.paint(-half + (i % N) * st, -half + Math.floor(i / N) * st, h[i], nrm[i * 3 + 1], pf[i], c, true).gf;
    const L = { N, half, step: st, seg: N - 1, h, pf, gf };
    L.height = (x, z) => this.height(x, z, L);
    L.normal = (x, z, out) => this.normal(x, z, out, L);
    L.grassAt = (x, z) => this.sampleGrid(gf, x, z, L);
    L.pathAt = (x, z) => this.sampleGrid(pf, x, z, L);
    return (this._legacy = L);
  }
  dropLegacy() { this._legacy = null; }

  // ---- chunked mesh -------------------------------------------------------
  // One Mesh per chunk; its geometry is swapped between LODs. LOD 2-3 are built up front,
  // LOD 0-1 when first needed and freed again when the camera is far away.
  buildChunks() {
    const N = this.N, NC = (this.NC = this.seg / CH);
    this.mat = toon(0xffffff, { vertexColors: true, terrain: true, rim: 0.05 });
    this.mesh = new THREE.Group();
    this.mesh.name = 'terrain';
    this.mesh.userData.noBake = true;
    this.lodIndex = [0, 1, 2, 3].map((k) => this.chunkIndex(CH >> k));
    this.chunks = [];
    for (let cz = 0; cz < NC; cz++) for (let cx = 0; cx < NC; cx++) {
      let lo = 1e9, hi = -1e9;
      for (let iz = cz * CH; iz <= (cz + 1) * CH; iz++) for (let ix = cx * CH; ix <= (cx + 1) * CH; ix++) {
        const v = this.h[iz * N + ix]; if (v < lo) lo = v; if (v > hi) hi = v;
      }
      const x0 = -this.half + cx * CH * this.step, z0 = -this.half + cz * CH * this.step, sz = CH * this.step;
      const box = new THREE.Box3(new THREE.Vector3(x0, lo - SKIRT[3], z0), new THREE.Vector3(x0 + sz, hi, z0 + sz));
      const ch = { cx, cz, x0, z0, x1: x0 + sz, z1: z0 + sz, lo, hi, box, sphere: box.getBoundingSphere(new THREE.Sphere()), geos: [null, null, null, null], lod: -1 };
      ch.geos[3] = this.chunkGeometry(ch, 3);
      ch.geos[2] = this.chunkGeometry(ch, 2);
      ch.mesh = new THREE.Mesh(ch.geos[3], this.mat);
      ch.mesh.receiveShadow = true; ch.mesh.castShadow = false;
      ch.mesh.matrixAutoUpdate = false;
      ch.lod = 3;
      this.mesh.add(ch.mesh);
      this.chunks.push(ch);
    }
  }

  // Shared index buffer for an n×n-cell chunk: the grid, then a skirt hanging from its rim
  // (drawn both ways round so it never shows a back face).
  chunkIndex(n) {
    const V = n + 1, G = V * V, idx = [];
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const a = iz * V + ix, b = a + 1, c = a + V, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const rim = this.rimOrder(n);
    for (let j = 0; j < rim.length; j++) {
      const a = rim[j], b = rim[(j + 1) % rim.length], sa = G + j, sb = G + ((j + 1) % rim.length);
      idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
    }
    return new THREE.BufferAttribute(new Uint16Array(idx), 1);
  }

  rimOrder(n) {
    const V = n + 1, r = [];
    for (let i = 0; i < n; i++) r.push(i);                    // top row, west → east
    for (let i = 0; i < n; i++) r.push(i * V + n);            // east column, north → south
    for (let i = n; i > 0; i--) r.push(n * V + i);            // bottom row, east → west
    for (let i = n; i > 0; i--) r.push(i * V);                // west column, south → north
    return r;
  }

  chunkGeometry(ch, k) {
    const N = this.N, s = 1 << k, n = CH / s, V = n + 1, G = V * V;
    const rim = this.rimOrder(n), cnt = G + rim.length;
    const pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3), col = new Float32Array(cnt * 3);
    const gx0 = ch.cx * CH, gz0 = ch.cz * CH;
    for (let iz = 0; iz < V; iz++) for (let ix = 0; ix < V; ix++) {
      const gx = gx0 + ix * s, gz = gz0 + iz * s, gi = gz * N + gx, o = (iz * V + ix) * 3;
      pos[o] = -this.half + gx * this.step; pos[o + 1] = this.h[gi]; pos[o + 2] = -this.half + gz * this.step;
      nor[o] = this.nrm[gi * 3]; nor[o + 1] = this.nrm[gi * 3 + 1]; nor[o + 2] = this.nrm[gi * 3 + 2];
      col[o] = this.col[gi * 3]; col[o + 1] = this.col[gi * 3 + 1]; col[o + 2] = this.col[gi * 3 + 2];
    }
    for (let j = 0; j < rim.length; j++) {
      const src = rim[j] * 3, o = (G + j) * 3;
      pos[o] = pos[src]; pos[o + 1] = pos[src + 1] - SKIRT[k]; pos[o + 2] = pos[src + 2];
      nor[o] = nor[src]; nor[o + 1] = nor[src + 1]; nor[o + 2] = nor[src + 2];
      col[o] = col[src]; col[o + 1] = col[src + 1]; col[o + 2] = col[src + 2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(this.lodIndex[k]);
    g.boundingBox = ch.box; g.boundingSphere = ch.sphere;
    return g;
  }

  // Pick each chunk's LOD for this camera. Chunks close to the camera get their fine mesh
  // at once (after a teleport too); others build at most `budget` meshes per call.
  update(camera, budget = 2) {
    const p = camera.position;
    for (const ch of this.chunks) {
      const dx = Math.max(ch.x0 - p.x, 0, p.x - ch.x1), dz = Math.max(ch.z0 - p.z, 0, p.z - ch.z1);
      const dy = Math.max(ch.lo - p.y, 0, p.y - ch.hi);
      const d = Math.hypot(dx, dz, dy * 0.5);
      // hysteresis: keep a finer LOD a little past its switch distance
      const hy = (k) => LOD_R[k] * (ch.lod <= k ? 1.08 : 1);
      let want = d < hy(0) ? 0 : d < hy(1) ? 1 : d < hy(2) ? 2 : 3;
      if (!ch.geos[want]) {
        if (d < 90 || budget > 0) { ch.geos[want] = this.chunkGeometry(ch, want); budget--; }
        else while (!ch.geos[want]) want++;
      }
      if (want !== ch.lod) { ch.mesh.geometry = ch.geos[want]; ch.lod = want; }
      for (let k = 0; k < 2; k++) if (ch.geos[k] && ch.lod !== k && d > LOD_KEEP[k]) { const g = ch.geos[k]; g.index = null; g.dispose(); ch.geos[k] = null; }
    }
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
