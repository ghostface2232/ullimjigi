// Wildfire: grass burns on the terrain grid (2 m cells, same grid as the
// heightmap). Fire spreads cell to cell by fuel and wind, is damped by rain,
// drowned by water/frost, lifts gliders above it, hurts whatever stands in
// it, and leaves scorched ground that grows back after a few minutes.
// The burn map (R scorched, G burning) is shared with terrain and grass shaders.
import * as THREE from 'three';
import { G } from '../core/context.js';
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

// Flame card: two crossed quads, toon-banded flicker (dark red → orange → yellow core)
const FLAME_VS = /* glsl */ `
attribute vec4 iFlame; // xyz = base position, w = size
attribute float iSeed;
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
void main(){
  vUv = uv; vSeed = iSeed;
  vec3 p = position * iFlame.w;
  // lick sideways with height
  p.x += sin(uTime * 7.0 + iSeed * 13.0 + p.y * 3.0) * 0.12 * iFlame.w * uv.y;
  p.z += cos(uTime * 6.0 + iSeed * 7.0) * 0.08 * iFlame.w * uv.y;
  vec4 wp = vec4(iFlame.xyz + p, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FLAME_FS = /* glsl */ `
uniform float uTime;
uniform sampler2D uNoiseTex;
varying vec2 vUv;
varying float vSeed;
void main(){
  vec2 uv = vUv;
  float n = texture2D(uNoiseTex, vec2(uv.x * 0.35 + vSeed, uv.y * 0.45 - uTime * 0.9)).r;
  float n2 = texture2D(uNoiseTex, vec2(uv.x * 0.8 - vSeed, uv.y * 0.9 - uTime * 1.7)).b;
  // teardrop body that erodes upward
  float w = 1.0 - abs(uv.x - 0.5) * 2.0;
  float body = w * (1.0 - uv.y) * 1.35 + (n - 0.5) * 0.9 + (n2 - 0.5) * 0.45 - uv.y * 0.35;
  if (body < 0.18) discard;
  vec3 c = body > 0.62 ? vec3(3.2, 2.2, 0.9) : body > 0.4 ? vec3(2.6, 0.95, 0.18) : vec3(1.1, 0.22, 0.06);
  float a = smoothstep(0.18, 0.3, body);
  gl_FragColor = vec4(c * a, a);
}`;

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
    const quad = new THREE.PlaneGeometry(1, 1.6, 1, 1); quad.translate(0, 0.8, 0);
    const q2 = quad.clone().rotateY(Math.PI / 2);
    const g = new THREE.InstancedBufferGeometry();
    const merged = [quad, q2];
    const pos = [], uv = [], idx = [];
    let base = 0;
    for (const q of merged) {
      pos.push(...q.attributes.position.array); uv.push(...q.attributes.uv.array);
      idx.push(...Array.from(q.index.array, (v) => v + base)); base += q.attributes.position.count;
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.iFlame = new THREE.InstancedBufferAttribute(new Float32Array(FLAMES * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iSeed = new THREE.InstancedBufferAttribute(new Float32Array(FLAMES).map(() => rand() * 10), 1);
    g.setAttribute('iFlame', this.iFlame); g.setAttribute('iSeed', this.iSeed);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: FLAME_VS, fragmentShader: FLAME_FS,
      uniforms: { uTime: U.time, uNoiseTex: U.noise },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
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
    this.burning.add(i); this.dirty = true;
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

  update(dt, camPos, playerPos) {
    const W = G.world;
    const rain = W.weather ? W.weather.rain : 0;
    const wind = W.weather ? W.weather.windVec : { x: 0.88, z: 0.47, s: 0.5 };
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
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            const ix = cx + dx, iz = cz + dz; if (ix < 0 || iz < 0 || ix >= N || iz >= N) continue;
            const j = iz * N + ix;
            if (this.state[j] !== 0) continue;
            const f = this.fuel[j]; if (f < 0.12) continue;
            const dl = Math.hypot(dx, dz);
            const down = (dx * wind.x + dz * wind.z) / dl;           // -1 upwind … 1 downwind
            const bias = Math.max(0.15, 1 + down * (0.6 + 1.6 * wind.s));
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
      if (this.dirty) this.writeTex();
    }

    // --- visuals: flames on burning cells near the camera, one warm light, smoke and embers
    const q = G.settings.quality === 'low' ? 0.5 : 1;
    let n = 0, lx = 0, lz = 0, ly = 0, ln = 0;
    if (this.burning.size) {
      const arr = this.iFlame.array;
      const cand = [];
      for (const i of this.burning) {
        this.cellPos(i, tmp);
        const d = (tmp.x - camPos.x) ** 2 + (tmp.z - camPos.z) ** 2;
        if (d < 110 * 110) cand.push(d, i);
      }
      // keep the nearest cells (pairs of [dist, idx])
      const order = [];
      for (let k = 0; k < cand.length; k += 2) order.push(k);
      if (order.length > FLAMES) order.sort((a, b) => cand[a] - cand[b]);
      for (const k of order) {
        if (n >= FLAMES * q) break;
        const i = cand[k + 1];
        this.cellPos(i, tmp);
        const life = clamp(this.timer[i] / 1.2, 0.2, 1);
        const jx = ((i * 0.618) % 1 - 0.5) * 1.4, jz = ((i * 0.377) % 1 - 0.5) * 1.4;
        arr[n * 4] = tmp.x + jx; arr[n * 4 + 1] = this.T.height(tmp.x + jx, tmp.z + jz) - 0.1; arr[n * 4 + 2] = tmp.z + jz;
        arr[n * 4 + 3] = (0.9 + this.fuel[i] * 0.9) * life;
        if (cand[k] < 40 * 40) { lx += tmp.x; ly += tmp.y; lz += tmp.z; ln++; }
        n++;
      }
      this.iFlame.needsUpdate = true;
      this.fxT -= dt;
      if (this.fxT <= 0 && n) {
        this.fxT = 0.07 / q;
        const k = order[Math.floor(rand() * Math.min(order.length, n))];
        this.cellPos(cand[k + 1], tmp);
        tmp.y += 1.2;
        G.vfx.burst(tmp, 'smoke', 1, { size: 2.2, alpha: 0.3, spread: 0.8, color: new THREE.Color(0.22, 0.2, 0.2), color1: new THREE.Color(0.5, 0.48, 0.5) });
        if (rand() < 0.6) G.vfx.burst(tmp, 'ember', 2, { speed: 3 });
      }
    }
    this.flames.geometry.instanceCount = n;
    this.flames.visible = n > 0;
    if (ln) {
      this.light.position.set(lx / ln, ly / ln + 2, lz / ln);
      this.light.intensity = Math.min(1, ln / 12) * (22 + Math.sin(G.time * 17) * 4);
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
    for (let j = 0; j < prev.length; j++) { const i = prev[j] * 4; d[i] = 0; d[i + 1] = 0; }
    const cells = (this.texCells = []);
    let n0 = N, n1 = -1;
    const mark = (i) => { cells.push(i); const r = (i / N) | 0; if (r < n0) n0 = r; if (r > n1) n1 = r; };
    for (const i of this.burning) { d[i * 4] = 110; d[i * 4 + 1] = 255; mark(i); }
    for (const i of this.scorched) { d[i * 4] = Math.round(255 * clamp(this.timer[i] / 40, 0, 1)); mark(i); }
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
