// Heightfield terrain: hand-shaped noise with carved roads and flattened
// landmarks, vertex-painted in a BotW-like palette.
import * as THREE from 'three';
import { createNoise2D, fbm, ridged, smoothstep, lerp, clamp } from '../core/util.js';
import { toon, U } from '../render/materials.js';
import { PATHS, POI, PADS, PASSES, WORLD } from './layout.js';
import { OUTER, outerWeights } from './regions/index.js';
import { tier } from '../render/quality.js';

// Chunked level of detail: CH grid cells (CH·step metres) per chunk side; LOD k draws every
// 2^k-th vertex. A chunk picks its LOD from the camera's distance to its bounds.
const CH = 128;
const LOD_R = [150, 420, 800];
const LOD_KEEP = [450, 900];      // built LOD 0 / 1 geometry is freed beyond these distances
const SKIRT = [3, 6, 12, 24];     // skirt depth per LOD: hides cracks between neighbouring LODs
// Cliffs (Terrain.initCliffs): plan size (m) of a rock mass and of the facets cut into it,
// and the half-width of the chamfer where two masses (at least) / two facets meet.
const CL0 = 19, CL1 = 6.5, BEV0 = 0.7, BEV1 = 0.45;
const hsh = (a, b, k) => { let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(k, 2246822519); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const _c = new THREE.Color();
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
  rock: hex(0xb6b9c0), rockDark: hex(0x8c909b), rockWarm: hex(0xc4b8a6), rockCool: hex(0xa3aec2),
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
    this.initCliffs();
    this.buildMesh();
    this.buildHeightTexture();
  }

  // Steep ground is rebuilt as rock. The smooth slope is replaced by masses (cells in plan,
  // each a tilted plane through the old surface: some nearly level benches, some leaning
  // faces, each standing a little proud of or behind the slope) with smaller facets cut
  // into them, all meeting in straight chamfered edges. It is still one height per (x, z),
  // so walking, climbing, cameras and everything placed by height follow the same surface
  // the eye sees. `base` keeps the smooth ground (the far LODs draw it), `cw` says how
  // much of the rock form applies (0 on gentle ground and roads), and `h` is the final
  // height at the grid points for whoever reads the grid directly.
  initCliffs() {
    const N = this.N, cnt = N * N, st = this.step, H = this.h;
    this.base = H.slice();
    const nrm = gridNormals(H, N, st);
    let w = new Float32Array(cnt);
    for (let i = 0; i < cnt; i++) w[i] = smoothstep(0.8, 0.64, nrm[i * 3 + 1]) * (1 - smoothstep(0.1, 0.5, this.pf[i])) * smoothstep(0.6, 2.5, H[i]);
    // spread the weight so a face is rebuilt as a whole, not in speckles
    for (let pass = 0; pass < 2; pass++) {
      const b = new Float32Array(cnt);
      for (let iz = 1; iz < N - 1; iz++) for (let ix = 1; ix < N - 1; ix++) {
        const i = iz * N + ix;
        b[i] = (w[i] * 2 + w[i - 1] + w[i + 1] + w[i - N] + w[i + N]) / 6;
      }
      w = b;
    }
    // ...and make it a clear either/or with a narrow blend, so planes stay planes
    for (let i = 0; i < cnt; i++) w[i] = smoothstep(0.08, 0.5, w[i]);
    this.cw = w;
    this.sites = new Map();
    this._edge = 0;
    for (let i = 0; i < cnt; i++) if (w[i] > 0) H[i] = this.cliffAt(-this.half + (i % N) * st, -this.half + Math.floor(i / N) * st, this.base[i], w[i]);
    // 4 m blocks touched by rock are drawn by the cliff mesh instead of the grid
    const NB = (this.NB = this.seg / 2), bs = (this.blockSteep = new Uint8Array(NB * NB));
    for (let bz = 0; bz < NB; bz++) for (let bx = 0; bx < NB; bx++) {
      let any = 0;
      for (let j = 0; j <= 2 && !any; j++) for (let k = 0; k <= 2; k++) if (w[(bz * 2 + j) * N + bx * 2 + k] > 0) { any = 1; break; }
      bs[bz * NB + bx] = any;
    }
  }

  // one rock mass: where it stands, and the plane of its top
  site(cx, cz) {
    const key = (cx + 2048) * 4096 + cz + 2048;
    let s = this.sites.get(key);
    if (!s) {
      const x = (cx + 0.1 + 0.8 * hsh(cx, cz, 1)) * CL0, z = (cz + 0.1 + 0.8 * hsh(cx, cz, 2)) * CL0, e = 3, B = this.base;
      let gx = (this.gridHeight(B, x + e, z) - this.gridHeight(B, x - e, z)) / (2 * e), gz = (this.gridHeight(B, x, z + e) - this.gridHeight(B, x, z - e)) / (2 * e);
      const sl = Math.hypot(gx, gz);
      // half are benches with nearly level tops (where grass grows), half lean at an easy
      // angle; each also turns a little off the fall line, so no two tops are parallel
      const r = hsh(cx, cz, 5), g = hsh(cx, cz, 3) < 0.5 ? 0.03 + 0.17 * r : 0.3 + 0.5 * r;
      const a = (hsh(cx, cz, 6) - 0.5) * 0.9, ca = Math.cos(a), sa = Math.sin(a), k = sl > 1e-4 ? g / sl : 0;
      s = { x, z, id: key, h: this.gridHeight(B, x, z) + (hsh(cx, cz, 4) - 0.5) * (1.5 + 2 * Math.min(sl, 1.6)), gx: (gx * ca - gz * sa) * k, gz: (gx * sa + gz * ca) * k };
      this.sites.set(key, s);
    }
    return s;
  }

  // The masses alone, at (x, z): the nearer one's plane, chamfered into its neighbour's.
  // Leaves in `_e` how strongly the point sits on a rim (> 0) or in a crease (< 0).
  mass(x, z) {
    const gx = Math.floor(x / CL0), gz = Math.floor(z / CL0);
    let d1 = 1e18, d2 = 1e18, s1 = null, s2 = null;
    for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const s = this.site(gx + k, gz + j), dx = s.x - x, dz = s.z - z, d = dx * dx + dz * dz;
      if (d < d1) { d2 = d1; s2 = s1; d1 = d; s1 = s; } else if (d < d2) { d2 = d; s2 = s; }
    }
    const p1 = s1.h + s1.gx * (x - s1.x) + s1.gz * (z - s1.z), p2 = s2.h + s2.gx * (x - s2.x) + s2.gz * (z - s2.z);
    // distance to the line halfway between the two masses: a straight chamfer across it
    const sd = Math.hypot(s2.x - s1.x, s2.z - s1.z), bd = (d2 - d1) / (2 * sd);
    // the face between two masses stands at its own angle, from a lean of about 58 degrees
    // to nearly sheer: the chamfer is as wide as that angle needs for the step it spans
    const bev = Math.min(Math.max(0.5 * Math.abs(p1 - p2) * (0.1 + 0.52 * hsh(s1.id + s2.id, s1.id ^ s2.id, 7)), BEV0), 7);
    this._bd = bd; this._bev = bev; this._nx = (s1.x - s2.x) / sd; this._nz = (s1.z - s2.z) / sd;
    this._e = Math.sign(p1 - p2) * Math.min(Math.abs(p1 - p2) / 3, 1) * Math.max(0, 1 - Math.abs(bd - bev) / 1.2) * (bd < bev ? 0.6 : 1);
    return p1 + (p2 - p1) * 0.5 * Math.max(0, 1 - bd / bev);
  }

  // Where a mesh vertex at (x, z) should sit so that the creases of the rock run along rows
  // of vertices instead of zig-zagging between them: a vertex within `r` of the upper or
  // lower edge of a chamfer (between masses, or between facet cells) moves onto that edge.
  // Returns the moved position in `_sx`, `_sz`.
  cliffSnap(x, z, r) {
    const fx = Math.floor(x / CL1), fz = Math.floor(z / CL1);
    let d1 = 1e18, d2 = 1e18, ax = 0, az = 0, bx = 0, bz = 0, ac = 0, aj = 0;
    for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const cx = fx + k, cz = fz + j, sx = (cx + hsh(cx, cz, 11)) * CL1, sz = (cz + hsh(cx, cz, 12)) * CL1;
      const dx = x - sx, dz = z - sz, d = dx * dx + dz * dz;
      if (d < d1) { d2 = d1; bx = ax; bz = az; d1 = d; ax = sx; az = sz; ac = cx; aj = cz; }
      else if (d < d2) { d2 = d; bx = sx; bz = sz; }
    }
    this._sx = x; this._sz = z;
    const fd = Math.hypot(bx - ax, bz - az) + 1e-6, bf = (d2 - d1) / (2 * fd);
    this.mass(x + (hsh(ac, aj, 13) - 0.5) * 2.4, z + (hsh(ac, aj, 14) - 0.5) * 2.4);
    // the nearer crease wins
    const em = this._bd - this._bev, ef = bf - BEV1;
    if (Math.abs(em) < r && Math.abs(em) <= Math.abs(ef)) { this._sx = x - em * this._nx; this._sz = z - em * this._nz; }
    else if (Math.abs(ef) < r) { this._sx = x - ef * (ax - bx) / fd; this._sz = z - ef * (az - bz) / fd; }
  }

  // The rock surface at (x, z), given the smooth ground hb and the cliff weight w there.
  // Each facet cell reads the masses from a slightly shifted place, which steps the outline
  // of every mass in plan: a wall becomes a row of upright faces at different depths, like
  // jointed rock, and a leaning top a few broad steps. Leaves the rim / crease value in `_edge`.
  cliffAt(x, z, hb, w) {
    const fx = Math.floor(x / CL1), fz = Math.floor(z / CL1);
    let d1 = 1e18, d2 = 1e18, ax = 0, az = 0, bx = 0, bz = 0, ac = 0, aj = 0, bc = 0, bj = 0;
    for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const cx = fx + k, cz = fz + j, sx = (cx + hsh(cx, cz, 11)) * CL1, sz = (cz + hsh(cx, cz, 12)) * CL1;
      const dx = x - sx, dz = z - sz, d = dx * dx + dz * dz;
      if (d < d1) { d2 = d1; bx = ax; bz = az; bc = ac; bj = aj; d1 = d; ax = sx; az = sz; ac = cx; aj = cz; }
      else if (d < d2) { d2 = d; bx = sx; bz = sz; bc = cx; bj = cz; }
    }
    let t = this.mass(x + (hsh(ac, aj, 13) - 0.5) * 2.4, z + (hsh(ac, aj, 14) - 0.5) * 2.4), e = this._e;
    const bf = (d2 - d1) / (2 * Math.hypot(bx - ax, bz - az) + 1e-6);
    if (bf < 0.9) {
      const t2 = this.mass(x + (hsh(bc, bj, 13) - 0.5) * 2.4, z + (hsh(bc, bj, 14) - 0.5) * 2.4);
      e += 0.6 * Math.sign(t - t2) * Math.min(Math.abs(t - t2) / 1.5, 1) * (1 - bf / 0.9);
      if (bf < BEV1) t += (t2 - t) * 0.5 * (1 - bf / BEV1);
    }
    this._edge = Math.max(-1, Math.min(1, e)) * w;
    return hb + (t - hb) * w;
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

  height(x, z, g = this) {
    if (g !== this || !this.base) return this.gridHeight(g.h, x, z, g);
    const hb = this.gridHeight(this.base, x, z), w = this.sampleGrid(this.cw, x, z);
    return w > 0 ? this.cliffAt(x, z, hb, w) : hb;
  }

  // exact triangle interpolation matching the grid mesh
  gridHeight(H, x, z, g = this) {
    const N = g.N;
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
    // ground layers for the surface shader: bare earth (roads, ash) and sand, next to gf and sn
    const hard = (1 - sn) * (1 - plaza) * (1 - pad);
    return { gf, sn, dirt: Math.max(smoothstep(0.3, 0.8, pf) * (1 - sd), ash * (1 - rk)) * hard, sand: sd * hard };
  }

  // Curvature-based ambient occlusion: concave cells (valleys, cliff feet)
  // darken and cool slightly, convex ridges brighten a touch.
  ambientOcclusion(i, ix, iz) {
    const N = this.N, H = this.base;
    let occ = 0, wsum = 0;
    for (const r of [1, 3, 6]) {
      const x0 = Math.max(0, ix - r), x1 = Math.min(this.seg, ix + r), z0 = Math.max(0, iz - r), z1 = Math.min(this.seg, iz + r);
      const avg = (H[iz * N + x0] + H[iz * N + x1] + H[z0 * N + ix] + H[z1 * N + ix]) * 0.25;
      occ += (avg - H[i]) / (r * this.step) * (1 / r); wsum += 1 / r;
    }
    return occ / wsum;
  }

  buildMesh() {
    const N = this.N, cnt = N * N, H = this.base, st = this.step;
    const col = (this.col = new Float32Array(cnt * 3));
    // ground and rock colours for the cliff mesh, painted on demand (cliffPaint)
    this.colG = new Float32Array(cnt * 3); this.colR = new Float32Array(cnt * 3); this.cpDone = new Uint8Array(cnt);
    this.gf = new Float32Array(cnt);
    this.sn = new Float32Array(cnt);
    const nrm = (this.nrm = gridNormals(H, N, st));
    const c = new THREE.Color();
    const splat = new Uint8Array(cnt * 4);
    for (let i = 0; i < cnt; i++) {
      const x = -this.half + (i % N) * st, z = -this.half + Math.floor(i / N) * st;
      const r = this.paint(x, z, H[i], nrm[i * 3 + 1], this.pf[i], c);
      this.gf[i] = r.gf; this.sn[i] = r.sn;
      if (this.cw[i] > 0) {
        // on rock, grass grows by the slope of the facet it stands on, not of the old hillside
        const e = 0.6, hl = this.height(x - e, z), hr = this.height(x + e, z), hd = this.height(x, z - e), hu = this.height(x, z + e);
        const r2 = this.paint(x, z, this.h[i], (2 * e) / Math.hypot(hl - hr, 2 * e, hd - hu), this.pf[i], _c);
        this.gf[i] = r2.gf; this.sn[i] = r2.sn;
      }
      splat[i * 4] = r.gf * 255; splat[i * 4 + 1] = r.dirt * 255; splat[i * 4 + 2] = r.sand * 255; splat[i * 4 + 3] = r.sn * 255;
      const curv = this.ambientOcclusion(i, i % N, Math.floor(i / N));
      // (rock catches light along its convex edges: the rims of ledges and blocks)
      const ao = 1 - 0.34 * smoothstep(0.0, 0.6, curv) + (0.05 + 0.2 * smoothstep(0.8, 0.6, nrm[i * 3 + 1])) * smoothstep(0.0, -0.5, curv);
      col[i * 3] = c.r * ao * (ao < 1 ? 0.97 + 0.03 * ao : 1); col[i * 3 + 1] = c.g * ao; col[i * 3 + 2] = c.b * (ao < 1 ? 0.5 + 0.5 * ao + 0.04 : ao);
    }
    // ground-layer weights for the terrain shader (same grid and uv as the heightmap)
    const sp = new THREE.DataTexture(splat, N, N, THREE.RGBAFormat);
    sp.minFilter = sp.magFilter = THREE.LinearFilter;
    sp.wrapS = sp.wrapT = THREE.ClampToEdgeWrapping;
    sp.needsUpdate = true;
    U.splatTex.value = sp;
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
    this.cliffMat = toon(0xffffff, { vertexColors: true, terrain: true, cliff: true, rim: 0.05 });
    this.skinK = tier().cliff;
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
      let cliff = false;
      for (let bz = cz * CH / 2; bz < (cz + 1) * CH / 2 && !cliff; bz++) for (let bx = cx * CH / 2; bx < (cx + 1) * CH / 2; bx++) if (this.blockSteep[bz * this.NB + bx]) { cliff = true; break; }
      const ch = { cx, cz, x0, z0, x1: x0 + sz, z1: z0 + sz, lo, hi, box, sphere: box.getBoundingSphere(new THREE.Sphere()), geos: [null, null, null, null], skins: [null, null], cliff, lod: -1 };
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

  // Index buffer of one chunk at LOD 0 or 1 with the rock blocks left out (the cliff mesh
  // draws those): same vertex layout as chunkIndex.
  chunkIndexFor(ch, k) {
    const n = CH >> k, V = n + 1, G = V * V, idx = [], NB = this.NB, sh = 1 - k;
    const b0x = ch.cx * CH / 2, b0z = ch.cz * CH / 2;
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      if (this.blockSteep[(b0z + (iz >> sh)) * NB + b0x + (ix >> sh)]) continue;
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

  cliffPaint(i) {
    if (this.cpDone[i]) return;
    this.cpDone[i] = 1;
    const N = this.N, x = -this.half + (i % N) * this.step, z = -this.half + Math.floor(i / N) * this.step, o = i * 3;
    this.paint(x, z, this.base[i], 1, this.pf[i], _c);
    this.colG[o] = _c.r; this.colG[o + 1] = _c.g; this.colG[o + 2] = _c.b;
    this.paint(x, z, this.base[i], 0.2, this.pf[i], _c);
    this.colR[o] = _c.r; this.colR[o + 1] = _c.g; this.colR[o + 2] = _c.b;
  }

  // The rock of one chunk: every 2 m cell of its rock blocks, K×K quads each, on the cliff
  // surface. Vertices are shared, so the normals average across creases and edges turn
  // softly, as worn rock does. `color` is the ground colour and `aRock` the rock colour (the
  // shader picks by slope); `aEdge` marks rims and creases.
  skinMesh(ch, k) {
    const K = this.skinK[k], N = this.N, st = this.step, B = this.base, W = this.cw, NB = this.NB;
    const b0x = ch.cx * CH / 2, b0z = ch.cz * CH / 2, cells = [];
    for (let bz = 0; bz < CH / 2; bz++) for (let bx = 0; bx < CH / 2; bx++) {
      if (!this.blockSteep[(b0z + bz) * NB + b0x + bx]) continue;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) cells.push((b0x + bx) * 2 + i, (b0z + bz) * 2 + j);
    }
    const nc = cells.length / 2, LW = this.seg * K + 1, snapR = (st / K) * 0.62;
    const pos = [], col = [], rock = [], edge = [], idx = new Uint32Array(nc * K * K * 6), ids = new Map(), G = this.colG, R = this.colR;
    const q = new Uint32Array((K + 1) * (K + 1));
    let io = 0;
    for (let c = 0; c < nc; c++) {
      const gx = cells[c * 2], gz = cells[c * 2 + 1], i00 = gz * N + gx, i10 = i00 + 1, i01 = i00 + N, i11 = i01 + 1;
      this.cliffPaint(i00); this.cliffPaint(i10); this.cliffPaint(i01); this.cliffPaint(i11);
      const h00 = B[i00], h10 = B[i10], h01 = B[i01], h11 = B[i11], w00 = W[i00], w10 = W[i10], w01 = W[i01], w11 = W[i11];
      const x0 = -this.half + gx * st, z0 = -this.half + gz * st;
      for (let j = 0; j <= K; j++) for (let i = 0; i <= K; i++) {
        const key = (gz * K + j) * LW + gx * K + i;
        let v = ids.get(key);
        if (v === undefined) {
          v = pos.length / 3; ids.set(key, v);
          const u = i / K, t = j / K, x = x0 + u * st, z = z0 + t * st;
          // the smooth ground inside the cell, split like the grid's two triangles
          const hb = u + t <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * t : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - t);
          const w = lerp(lerp(w00, w10, u), lerp(w01, w11, u), t);
          if (w > 0) {
            // creases get a row of vertices (only well inside the rock: its outline must meet
            // the grid mesh exactly)
            let sx = x, sz = z;
            if (w > 0.999) { this.cliffSnap(x, z, snapR); sx = this._sx; sz = this._sz; }
            const moved = sx !== x || sz !== z;
            pos.push(sx, moved ? this.cliffAt(sx, sz, this.gridHeight(B, sx, sz), this.sampleGrid(W, sx, sz)) : this.cliffAt(x, z, hb, w), sz);
            edge.push(this._edge);
          } else { pos.push(x, hb, z); edge.push(0); }
          const a = (1 - u) * (1 - t), b = u * (1 - t), cc = (1 - u) * t, d = u * t;
          for (let n = 0; n < 3; n++) {
            col.push(G[i00 * 3 + n] * a + G[i10 * 3 + n] * b + G[i01 * 3 + n] * cc + G[i11 * 3 + n] * d);
            rock.push(R[i00 * 3 + n] * a + R[i10 * 3 + n] * b + R[i01 * 3 + n] * cc + R[i11 * 3 + n] * d);
          }
        }
        q[j * (K + 1) + i] = v;
      }
      for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
        const a = q[j * (K + 1) + i], b = q[j * (K + 1) + i + 1], cc = q[(j + 1) * (K + 1) + i], d = q[(j + 1) * (K + 1) + i + 1];
        // split each quad along its flatter diagonal, so creases stay straight
        if (Math.abs(pos[a * 3 + 1] - pos[d * 3 + 1]) <= Math.abs(pos[b * 3 + 1] - pos[cc * 3 + 1])) { idx[io++] = a; idx[io++] = cc; idx[io++] = d; idx[io++] = a; idx[io++] = d; idx[io++] = b; }
        else { idx[io++] = a; idx[io++] = cc; idx[io++] = b; idx[io++] = b; idx[io++] = cc; idx[io++] = d; }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aRock', new THREE.Float32BufferAttribute(rock, 3));
    g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.cliffMat);
    m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; m.visible = false;
    this.mesh.add(m);
    return m;
  }

  // a quality change alters how finely the rock is meshed
  applyQuality() {
    const K = tier().cliff;
    if (K[0] === this.skinK[0] && K[1] === this.skinK[1]) return;
    this.skinK = K;
    for (const ch of this.chunks) for (let k = 0; k < 2; k++) {
      const m = ch.skins[k];
      if (!m) continue;
      this.mesh.remove(m); m.geometry.dispose(); ch.skins[k] = null;
      if (ch.lod === k) ch.lod = -1; // rebuilt and shown again on the next update
    }
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
      pos[o] = -this.half + gx * this.step; pos[o + 1] = this.base[gi]; pos[o + 2] = -this.half + gz * this.step;
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
    g.setIndex(k < 2 && ch.cliff ? this.chunkIndexFor(ch, k) : this.lodIndex[k]);
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
      // a fine LOD of a chunk with rock is its grid and its cliff mesh together
      const has = (k) => ch.geos[k] && (k >= 2 || !ch.cliff || ch.skins[k]);
      if (!has(want)) {
        if (d < 90 || budget > 0) {
          if (!ch.geos[want]) ch.geos[want] = this.chunkGeometry(ch, want);
          if (want < 2 && ch.cliff && !ch.skins[want]) ch.skins[want] = this.skinMesh(ch, want);
          budget--;
        } else while (!has(want)) want++;
      }
      if (want !== ch.lod) {
        ch.mesh.geometry = ch.geos[want]; ch.lod = want;
        for (let k = 0; k < 2; k++) if (ch.skins[k]) ch.skins[k].visible = k === want;
      }
      for (let k = 0; k < 2; k++) if (ch.lod !== k && d > LOD_KEEP[k]) {
        const g = ch.geos[k], m = ch.skins[k];
        if (g) { if (g.index === this.lodIndex[k]) g.index = null; g.dispose(); ch.geos[k] = null; }
        if (m) { this.mesh.remove(m); m.geometry.dispose(); ch.skins[k] = null; }
      }
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
