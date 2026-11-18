// Wildfire: grass burns on the terrain grid (2 m cells, same grid as the
// heightmap). Fire spreads cell to cell by fuel and wind, is damped by rain,
// drowned by water/frost, lifts gliders above it, hurts whatever stands in
// it, and leaves scorched ground that grows back after a few minutes.
// The burn map (R scorched, G burning) is shared with terrain and grass shaders.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { FIRE_RAMP } from '../render/flame.js';
import { windUniforms } from './wind.js';
import { U } from '../render/materials.js';
import { rand, randRange, clamp, smoothstep } from '../core/util.js';
import { POI } from './layout.js';

const TICK = 0.12;            // spread step (s)
const BURN_TIME = [1.5, 2.4]; // seconds a cell stays alight
const REGROW = [150, 240];    // seconds until scorched grass is back
const MAX_BURNING = 360;
// Each ignition carries a vigor (1 at the source) that fades as flames pass from
// cell to cell, so one spark scorches a patch of meadow, not the whole forest.
const VIGOR_DECAY = 0.72, VIGOR_DECAY_DOWNWIND = 0.8, VIGOR_MIN = 0.32;
const FLAMES = 180;           // flame cards drawn around the camera

// A strip joins two crossings of the burning perimeter. Neighbouring segments
// share ground endpoints even on slopes and when viewed from the side.
const FLAME_VS = /* glsl */ `
attribute vec4 iEnds; // start xz, end xz
attribute vec2 iHeat; // height at each end
uniform vec4 uWindFlow, uHeightP;
uniform sampler2D uHeightTex;
varying float vH, vHeat, vAlong, vPhase;
void main(){
  vec2 foot = mix(iEnds.xy, iEnds.zw, uv.x);
  vec2 axis = iEnds.zw - iEnds.xy;
  foot += vec2(-axis.y, axis.x) * sin(uv.x * 3.14159) * 0.13;
  vPhase = fract(sin(dot(iEnds.xy + iEnds.zw, vec2(2.37, 8.19))) * 7163.4);
  vAlong = uv.x * length(axis) * (2.05 + 1.0 * vPhase) + vPhase * 7.0;
  vHeat = mix(iHeat.x, iHeat.y, uv.x);
  float h = uv.y * min(1.2, vHeat);
  vH = uv.y;
  float ground = texture2D(uHeightTex, (foot + uHeightP.x) * uHeightP.y + uHeightP.z).r;
  vec2 bend = uWindFlow.xy * h * mix(0.18, 0.56, clamp(uWindFlow.z * 0.16, 0.0, 1.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(foot.x + bend.x, ground + h - 0.035, foot.y + bend.y, 1.0);
}`;
const FLAME_FS = /* glsl */ `
uniform float uTime;
varying float vH, vHeat, vAlong, vPhase;
${FIRE_RAMP}
void main(){
  // Measure across the strip in metres even when it lies along a view ray.
  // Adjacent tongues share a rough root, but have separate crests and lifetimes.
  float x = vAlong;
  float beat = uTime * 4.0 + vPhase * 17.0;
  x += 0.16 * sin(x * 1.8 + vPhase * 12.0);
  x -= vH * (0.23 + 0.29 * sin(beat - vH * 4.1 + x * 1.7));
  float lane = floor(x), q = fract(x) - 0.5;
  float seed = fract(sin(lane * 19.7 + vPhase * 9.1) * 1739.4);
  float pulse = 0.5 + 0.5 * sin(beat * (0.84 + 0.25 * seed) + lane * 2.1);
  float height = 0.29 + 0.42 * seed + 0.34 * pulse;
  float y = vH / height;
  float split = smoothstep(0.21, 0.90, y);
  float width = (0.52 + 0.17 * sin(5.0 * y + seed * 2.0)) * (1.0 - y);
  float stem = width - abs(q - 0.24 * split + 0.20 * y * sin(beat + lane - y * 5.2));
  float side = (0.45 - 0.10 * y) * (0.70 + 0.16 * pulse - y) - abs(q + 0.40 * split);
  float bed = 0.083 + 0.045 * sin(x * 3.0 + beat) + 0.034 * sin(x * 6.1 - beat * 0.7);
  float shape = max(bed - vH, max(stem, side));
  float aa = max(0.55 * fwidth(shape), 0.007);
  float alpha = smoothstep(-aa, aa, shape);
  if (alpha < 0.01) discard;
  float heat = shape + 0.075 * pulse - 0.085 * y + 0.035 * sin(x * 5.1 + y * 3.0);
  vec3 col = mix(fireTip, fireBody, smoothstep(-0.015, 0.15, heat));
  col = mix(col, fireCore, smoothstep(0.17, 0.43, heat) * smoothstep(0.14, 0.70, vHeat));
  gl_FragColor = vec4(col, alpha);
}`;

// Cell corners run clockwise. Offset coordinates are fractions of a grid cell.
const CORNER_X = [0, 1, 1, 0], CORNER_Z = [0, 0, 1, 1];

export class Wildfire {
  constructor(scene, terrain) {
    this.T = terrain;
    const N = (this.N = terrain.N);
    this.step = terrain.step; this.half = terrain.half;
    this.fuel = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const h = terrain.h[i];
      // grass factor from the terrain paint: paths, rock, sand, snow and ash don't burn
      const x = -this.half + (i % N) * this.step, z = -this.half + Math.floor(i / N) * this.step;
      // the village green is watered and trampled: it won't carry a fire into people's homes
      const vill = smoothstep(30, 44, Math.hypot(x - POI.village.x, z - POI.village.z));
      this.fuel[i] = h > 0.5 ? clamp(terrain.gf[i] * 1.15, 0, 1) * vill : 0;
    }
    this.state = new Uint8Array(N * N);   // 0 grass, 1 burning, 2 scorched
    this.timer = new Float32Array(N * N); // burn / regrow countdown
    this.vigor = new Float32Array(N * N); // how much further this flame can travel
    this.burning = new Set();
    this.front = { corners: [], fill: [], edges: [], xs: [], zs: [], heights: [] };
    this.heatSince = new Map(); // visual age, including the brief afterglow on cooling ash
    this.scorched = new Set();
    this.tex = new THREE.DataTexture(new Uint8Array(N * N * 4), N, N, THREE.RGBAFormat);
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.stage = new THREE.DataTexture(this.tex.image.data, N, N, THREE.RGBAFormat);
    this.texBox = new THREE.Box2(); this.texAt = new THREE.Vector2();
    this.texCells = []; this.texZ0 = N; this.texZ1 = -1;
    U.burnTex.value = this.tex;
    this.acc = 0; this.hurtT = 0; this.fxT = 0; this.flameT = 0;
    this.dirty = false;
    // flames
    const strip = new THREE.PlaneGeometry(1, 1, 8, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', strip.attributes.position);
    g.setAttribute('uv', strip.attributes.uv);
    g.setIndex(strip.index);
    this.ends = new THREE.InstancedBufferAttribute(new Float32Array(FLAMES * 4), 4).setUsage(THREE.DynamicDrawUsage);
    // Key phases to cells so culling, distance sorting and regrowth cannot pop the tongues.
    this.flamePhases = Float32Array.from({ length: FLAMES }, () => rand() * 10);
    this.heat = new THREE.InstancedBufferAttribute(new Float32Array(FLAMES * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iEnds', this.ends); g.setAttribute('iHeat', this.heat);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: FLAME_VS, fragmentShader: FLAME_FS,
      uniforms: { uTime: U.time, uWindFlow: windUniforms.uWindFlow, uHeightTex: U.heightTex, uHeightP: U.heightP },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      forceSinglePass: true,
    });
    this.flames = new THREE.Mesh(g, mat);
    this.flames.frustumCulled = false;
    this.flames.userData.noBake = true;
    scene.add(this.flames);
    this.light = new THREE.PointLight(0xff7a2a, 0, 26, 1.6);
    scene.add(this.light);
    this.loop = null;
  }

  idx(x, z) {
    const ix = Math.round((x + this.half) / this.step), iz = Math.round((z + this.half) / this.step);
    if (ix < 0 || iz < 0 || ix >= this.N || iz >= this.N) return -1;
    return iz * this.N + ix;
  }
  cellPos(i, out) { const N = this.N; return out.set(-this.half + (i % N) * this.step, this.T.h[i], -this.half + Math.floor(i / N) * this.step); }
  isBurning(x, z) { const i = this.idx(x, z); return i >= 0 && this.state[i] === 1; }
  count() { return this.burning.size; }

  _light(i, vigor = 1) {
    if (this.state[i] !== 0 || this.fuel[i] < 0.12 || this.burning.size >= MAX_BURNING) return false;
    this.state[i] = 1; this.vigor[i] = vigor; this.timer[i] = randRange(BURN_TIME[0], BURN_TIME[1]) * (0.7 + 0.5 * this.fuel[i]);
    this.burning.add(i); this.heatSince.set(i, G.time); this.dirty = true;
    return true;
  }
  // Set grass alight in a radius. Returns the number of cells that caught.
  ignite(x, z, r = 1.5, vigor = 1) {
    const wet = G.world.weather ? G.world.weather.rain : 0;
    if (wet > 0.75) return 0;
    let n = 0;
    const s = this.step, R = Math.ceil(r / s);
    const c = this.idx(x, z); if (c < 0) return 0;
    const cx = c % this.N, cz = Math.floor(c / this.N);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > R * R + 0.5) continue;
      const ix = cx + dx, iz = cz + dz; if (ix < 0 || iz < 0 || ix >= this.N || iz >= this.N) continue;
      if (rand() < 1 - wet) n += this._light(iz * this.N + ix, vigor) ? 1 : 0;
    }
    if (n && G.audio.ready) G.audio.play('fire_catch', { pos: new THREE.Vector3(x, this.T.height(x, z), z), gap: 0.25 });
    if (n && G.story && G.story.once('wildfire1')) G.hud.hint('<b>들불</b> — 마른 풀은 불에 타 번진다. 바람을 타고 더 빨리 퍼지고, 불길 위에서는 <b>뜨거운 바람</b>이 솟아 활공으로 높이 오를 수 있다<br><small>물·서리로 끌 수 있고, 비가 오면 잘 붙지 않는다</small>', 9);
    return n;
  }
  // Put fires out (water, frost, rain). Steam where it was burning.
  extinguish(x, z, r = 3) {
    let n = 0;
    const tmp = new THREE.Vector3();
    for (const i of this.burning) {
      this.cellPos(i, tmp);
      if ((tmp.x - x) ** 2 + (tmp.z - z) ** 2 > r * r) continue;
      this._scorch(i); n++;
      if (n < 10) G.vfx.burst(tmp.setY(tmp.y + 0.3), 'smoke', 1, { size: 1.2, alpha: 0.35, color: new THREE.Color(0.9, 0.92, 0.95), color1: new THREE.Color(1, 1, 1) });
    }
    if (n && G.audio.ready) G.audio.play('fizzle', { pos: new THREE.Vector3(x, this.T.height(x, z), z), gap: 0.2 });
    return n;
  }
  // Wind blowing across flames: nearby fire leaps ahead in that direction.
  fan(x, z, dirX, dirZ, r = 6) {
    const tmp = new THREE.Vector3();
    const list = [];
    for (const i of this.burning) { this.cellPos(i, tmp); if ((tmp.x - x) ** 2 + (tmp.z - z) ** 2 < r * r) list.push(i); }
    for (const i of list.slice(0, 60)) {
      this.cellPos(i, tmp);
      for (let k = 1; k <= 3; k++) { const j = this.idx(tmp.x + dirX * this.step * k, tmp.z + dirZ * this.step * k); if (j >= 0 && rand() < 0.6) this._light(j, Math.max(this.vigor[i] * 0.9, 0.5)); }
    }
    return list.length;
  }
  _scorch(i) {
    this.burning.delete(i);
    this.heatSince.set(i, G.time); // ash holds embers briefly after the flame expires
    this.state[i] = 2; this.timer[i] = randRange(REGROW[0], REGROW[1]);
    this.scorched.add(i); this.dirty = true;
  }

  // Upward wind above burning grass (m/s), for gliding. 0 when none.
  liftAt(x, y, z) {
    if (!this.burning.size) return 0;
    const i0 = this.idx(x, z); if (i0 < 0) return 0;
    const N = this.N, cx = i0 % N, cz = Math.floor(i0 / N);
    let heat = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const ix = cx + dx, iz = cz + dz; if (ix < 0 || iz < 0 || ix >= N || iz >= N) continue;
      if (this.state[iz * N + ix] === 1) heat += 1 / (1 + dx * dx + dz * dz);
    }
    if (heat <= 0) return 0;
    const above = y - this.T.h[i0];
    // a modest column: strong near the flames, gone by ~12 m
    if (above > 12) return 0;
    return Math.min(1, heat / 2.6) * (1 - Math.max(0, above - 6) / 6);
  }

  // Interpolate the perimeter on a terrain quad, including both disjoint
  // contours in the diagonal case. Return the next free strip instance.
  writeFrontSegment(x, z, i, n, limit) {
    const N = this.N, { corners, fill, edges, xs, zs, heights } = this.front;
    corners[0] = i; corners[1] = i + 1; corners[2] = i + N + 1; corners[3] = i + N;
    for (let c = 0; c < 4; c++) {
      const id = corners[c];
      fill[c] = this.state[id] === 2 ? 1 : 0;
      if (this.state[id] === 1) fill[c] = 0.44 + 0.56 * smoothstep(0, 0.25, G.time - this.heatSince.get(id));
    }
    edges.length = 0;
    for (let e = 0; e < 4; e++) {
      const next = (e + 1) % 4;
      if ((fill[e] > 0.48) === (fill[next] > 0.48)) continue;
      const t = (0.48 - fill[e]) / (fill[next] - fill[e]);
      xs[e] = (x + CORNER_X[e] + t * (CORNER_X[next] - CORNER_X[e])) * this.step - this.half;
      zs[e] = (z + CORNER_Z[e] + t * (CORNER_Z[next] - CORNER_Z[e])) * this.step - this.half;
      const id = corners[fill[e] > fill[next] ? e : next];
      const phase = this.flamePhases[id % FLAMES] * 0.1;
      const age = G.time - (this.heatSince.get(id) ?? -10);
      heights[e] = this.state[id] === 1 ? (0.63 + 0.78 * phase) * (1 - smoothstep(0.55, 1.70, age)) : 0;
      edges.push(e);
    }
    // Disjoint diagonal islands each keep their own two-edge contour.
    if (edges.length === 4 && fill[0] > 0.48) edges.push(edges.shift());
    for (let e = 0; e < edges.length && n < limit; e += 2) {
      const a = edges[e], b = edges[e + 1];
      if (Math.max(heights[a], heights[b]) < 0.11) continue;
      this.ends.setXYZW(n, xs[a], zs[a], xs[b], zs[b]);
      this.heat.setXY(n++, heights[a], heights[b]);
      // A few shorter clumps just inside a vigorous front give it depth.
      // Pull toward burning corners, keeping the older interior open.
      if (n < limit && Math.max(heights[a], heights[b]) > 0.65 && (i % 5 < 2)) {
        let ix = 0, iz = 0, weight = 0;
        for (let c = 0; c < 4; c++) {
          ix += fill[c] * CORNER_X[c]; iz += fill[c] * CORNER_Z[c]; weight += fill[c];
        }
        const innerX = (x + ix / weight) * this.step - this.half;
        const innerZ = (z + iz / weight) * this.step - this.half;
        const backX = (innerX - (xs[a] + xs[b]) * 0.5) * 0.74;
        const backZ = (innerZ - (zs[a] + zs[b]) * 0.5) * 0.74;
        this.ends.setXYZW(n, xs[a] + backX, zs[a] + backZ, xs[b] + backX, zs[b] + backZ);
        this.heat.setXY(n++, heights[a] * 0.75, heights[b] * 0.63);
      }
    }
    return n;
  }

  update(dt, camPos, playerPos) {
    const W = G.world;
    const rain = W.weather ? W.weather.rain : 0;
    const wind = G.wind;
    this.acc += dt;
    const tmp = new THREE.Vector3();
    while (this.acc >= TICK) {
      this.acc -= TICK;
      if (this.burning.size) {
        const N = this.N, fresh = [], fv = [];
        for (const i of this.burning) {
          this.timer[i] -= TICK * (1 + rain * 3);
          if (this.timer[i] <= 0) { fresh.push(-1 - i); fv.push(0); continue; }
          if (this.vigor[i] < VIGOR_MIN) continue; // a dying flame burns out where it is
          const cx = i % N, cz = Math.floor(i / N);
          this.cellPos(i, tmp);
          wind.sample(tmp, tmp);
          const strength = Math.min(1, Math.hypot(tmp.x, tmp.z) * 0.15);
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            const ix = cx + dx, iz = cz + dz; if (ix < 0 || iz < 0 || ix >= N || iz >= N) continue;
            const j = iz * N + ix;
            if (this.state[j] !== 0) continue;
            const f = this.fuel[j]; if (f < 0.12) continue;
            const dl = Math.hypot(dx, dz);
            const down = (dx * wind.flow.x + dz * wind.flow.y) / dl; // -1 upwind … 1 downwind
            const bias = Math.max(0.15, 1 + down * (0.6 + 1.6 * strength));
            // uphill spreads faster (flames lean into the slope)
            const up = clamp((this.T.h[j] - this.T.h[i]) * 0.4, -0.4, 0.8);
            const p = 0.04 * f * bias * (1 + up) * (1 - rain) / dl;
            if (rand() < p) { fresh.push(j); fv.push(this.vigor[i] * (down > 0.5 ? VIGOR_DECAY_DOWNWIND : VIGOR_DECAY) * (0.85 + 0.15 * f)); }
          }
        }
        fresh.forEach((j, k) => { if (j < 0) this._scorch(-1 - j); else this._light(j, fv[k]); });
      }
      // regrowth
      if (this.scorched.size) {
        for (const i of this.scorched) {
          this.timer[i] -= TICK;
          if (this.timer[i] <= 0) { this.scorched.delete(i); this.state[i] = 0; this.dirty = true; }
          else if (this.timer[i] < 40) this.dirty = true; // fading back to green
        }
      }
      if (this.dirty || this.heatSince.size > this.burning.size) this.writeTex();
    }

    // --- visuals: flames on burning cells near the camera, one warm light, smoke and embers
    const q = G.settings.quality === 'low' ? 0.5 : 1;
    let n = 0, lx = 0, lz = 0, ly = 0, ln = 0;
    if (this.burning.size) {
      const cand = [];
      for (const i of this.burning) {
        this.cellPos(i, tmp);
        const d = (tmp.x - camPos.x) ** 2 + (tmp.z - camPos.z) ** 2;
        if (d < 110 * 110) cand.push(d, i);
      }
      // keep the nearest cells (pairs of [dist, idx])
      const order = [];
      for (let k = 0; k < cand.length; k += 2) order.push(k);
      if (order.length > FLAMES * q / 2) order.sort((a, b) => cand[a] - cand[b]);
      const visited = new Set();
      const N = this.N, limit = FLAMES * q;
      for (const k of order) {
        const cell = cand[k + 1], cx = cell % N, cz = Math.floor(cell / N);
        if (cand[k] < 40 * 40) { this.cellPos(cell, tmp); lx += tmp.x; ly += tmp.y; lz += tmp.z; ln++; }
        if (n >= limit) continue;
        for (let j = 0; j < 4 && n < limit; j++) {
          const x = cx - CORNER_X[j], z = cz - CORNER_Z[j], i = z * N + x;
          if (x < 0 || z < 0 || x >= N - 1 || z >= N - 1 || visited.has(i)) continue;
          visited.add(i);
          n = this.writeFrontSegment(x, z, i, n, limit);
        }
      }
      // Newly caught grass still burns just behind the advancing line. Add
      // short, wind-swept pockets only after the actual perimeter has its slots.
      for (const k of order) {
        if (n >= limit) break;
        const id = cand[k + 1], age = G.time - this.heatSince.get(id);
        if (age <= 0.10 || age >= 0.90) continue;
        const h = Math.imul(id ^ (id >>> 9), 1597334677) >>> 0;
        const seed = (h & 65535) / 65535;
        if (seed < 0.28) continue;
        const angle = (h >>> 16) * (6.2831853 / 65536);
        const dx = Math.cos(angle) * (0.48 + seed * 0.51);
        const dz = Math.sin(angle) * (0.48 + seed * 0.51);
        this.cellPos(id, tmp);
        this.ends.setXYZW(n, tmp.x - dx, tmp.z - dz, tmp.x + dx, tmp.z + dz);
        const heat = (0.45 + seed * 0.64) * smoothstep(0.10, 0.29, age) * (1 - smoothstep(0.39, 0.90, age));
        this.heat.setXY(n++, heat, heat * (0.37 + seed * 0.47));
      }
      this.ends.needsUpdate = this.heat.needsUpdate = true;
      this.fxT -= dt;
      if (this.fxT <= 0 && order.length) {
        this.fxT = 0.18 / q;
        const k = order[Math.floor(rand() * Math.min(order.length, FLAMES * q))];
        this.cellPos(cand[k + 1], tmp);
        tmp.y += 0.55;
        G.vfx.burst(tmp, 'smoke', 1, { size: 0.78, alpha: 0.22, spread: 0.45, life: 0.55, color: new THREE.Color(0.22, 0.2, 0.2), color1: new THREE.Color(0.5, 0.48, 0.5) });
        if (rand() < 0.6) G.vfx.burst(tmp, 'ember', 2, { speed: 3 });
      }
    }
    this.flames.geometry.instanceCount = n;
    this.flames.visible = n > 0;
    if (ln) {
      this.light.position.set(lx / ln, ly / ln + 2, lz / ln);
      // sized for the dark; by day the same light only bleaches the grass (see VFX.lightK)
      this.light.intensity = Math.min(1, ln / 12) * (22 + Math.sin(G.time * 17) * 4) * (G.vfx ? G.vfx.lightK() : 1);
    } else this.light.intensity = 0;
    // crackle bed at the fire nearest the player
    const near = ln > 0;
    if (near && !this.loop && G.audio.ready) this.loop = G.audio.loop('loop_fire', { pos: this.light.position, v: 0.9, max: 600 });
    if (this.loop) {
      if (!near) { this.loop.stop(1.2); this.loop = null; }
      else this.loop.set(this.light.position);
    }

    // --- harm: standing in flames
    this.hurtT -= dt;
    if (this.hurtT <= 0 && this.burning.size) {
      this.hurtT = 0.35;
      const P = G.player;
      const i = this.idx(P.pos.x, P.pos.z);
      if (i >= 0 && this.state[i] === 1 && P.pos.y - this.T.h[i] < 1.2 && !P.climbing) {
        P.damage(2, { fire: true, dir: null });
        if (G.hud.floatText && G.story && G.story.once('fireHurt')) G.hud.floatText(P.center(), '앗, 뜨거워!', '#ffb070');
      }
      for (const e of G.enemies.list) {
        if (!e.alive || e.def.flying) continue;
        const j = this.idx(e.pos.x, e.pos.z);
        if (j >= 0 && this.state[j] === 1 && e.pos.y - this.T.h[j] < 1.2) G.combat.hit(e, { dmg: 2 + G.player.power() * 0.15, el: 'fire', pos: e.center(), source: 'env', noReact: true });
      }
    }
  }

  // Only the rows that changed go to the GPU: the previous write's cells are cleared, the
  // current ones set, and the band of rows spanning both is uploaded from `stage` (a view of
  // the same pixels that is never uploaded on its own).
  writeTex() {
    this.dirty = false;
    const d = this.tex.image.data, N = this.N, prev = this.texCells;
    let z0 = this.texZ0, z1 = this.texZ1;
    for (let j = 0; j < prev.length; j++) { const i = prev[j] * 4; d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; }
    const cells = (this.texCells = []);
    let n0 = N, n1 = -1;
    const mark = (i) => { cells.push(i); const r = (i / N) | 0; if (r < n0) n0 = r; if (r > n1) n1 = r; };
    for (const i of this.burning) { d[i * 4] = 110; d[i * 4 + 1] = 255; d[i * 4 + 2] = 225; mark(i); }
    for (const i of this.scorched) {
      d[i * 4] = Math.round(255 * clamp(this.timer[i] / 40, 0, 1));
      if (this.heatSince.has(i)) {
        const age = G.time - this.heatSince.get(i);
        d[i * 4 + 2] = Math.round(225 * (1 - smoothstep(0, 3.2, age)));
        if (age >= 3.2) this.heatSince.delete(i);
      }
      mark(i);
    }
    this.texZ0 = n0; this.texZ1 = n1;
    z0 = Math.min(z0, n0); z1 = Math.max(z1, n1);
    const R = G.renderer && G.renderer.renderer;
    if (z1 < z0) return;
    if (!R) { this.tex.needsUpdate = true; return; }
    this.texBox.min.set(0, z0); this.texBox.max.set(N, z1 + 1);
    this.texAt.set(0, z0);
    R.copyTextureToTexture(this.stage, this.tex, this.texBox, this.texAt);
  }
}
