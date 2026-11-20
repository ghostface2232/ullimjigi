// Wildfire: grass burns on the terrain grid (2 m cells, same grid as the
// heightmap). Fire spreads cell to cell by fuel and wind, is damped by rain,
// drowned by water/frost, lifts gliders above it, hurts whatever stands in
// it, and leaves scorched ground that grows back after a few minutes.
// The burn map (R scorched, G burning) is shared with terrain and grass shaders.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { BRAZIER_GLSL, FIRE_RAMP, GRASS_FLAME_GLSL } from '../render/flame.js';
import { windUniforms } from './wind.js';
import { U } from '../render/materials.js';
import { rand, randRange, clamp, lerp, smoothstep } from '../core/util.js';
import { POI } from './layout.js';

const TICK = 0.12;            // spread step (s)
const BURN_TIME = [1.5, 2.4]; // seconds a cell stays alight
const REGROW = [150, 240];    // seconds until scorched grass is back
const MAX_BURNING = 360;
// Each ignition carries a vigor (1 at the source) that fades as flames pass from
// cell to cell, so one spark scorches a patch of meadow, not the whole forest.
const VIGOR_DECAY = 0.72, VIGOR_DECAY_DOWNWIND = 0.8, VIGOR_MIN = 0.32;
const EDGE_X = [1, 0, -1, 0], EDGE_Z = [0, 1, 0, -1];
const TMP = new THREE.Vector3();
const FLAMES = 180;           // flame cards drawn around the camera
// Looks only: a cell's flames wane to this as its fuel runs out, then linger on the ash as
// low flamelets for a few seconds (no heat, no spread) instead of vanishing with the cell.
const WANE = 0.62, LINGER = [1.5, 3.2];
const FIELD_FLAMES = 72;      // most cards the spells' burning fields may take from the pool

// Each instance is a card of flame. A brazier's is a short-lived tongue reborn on its own clock.
// Grass fire stands where it is rooted: its motion comes from the noise rising through the
// card and its size from the cell's burn, so no two flames keep time with each other.
const FLAME_VS = /* glsl */ `
attribute vec4 iFuel;   // foot XYZ, width
attribute vec4 iCycle;  // phase, aspect (negative: ground fire), its heat, glow (negative: -1 - glow, rooted at the foot's own height)
uniform float uTime;
uniform vec4 uWindFlow, uHeightP;
uniform sampler2D uHeightTex;
varying vec2 vUv;
varying vec4 vFire;
varying vec3 vWP;
varying float vGlow;
void main() {
  vUv = uv; vGlow = 0.0;
  float seed = iCycle.x;
  vec3 right = normalize(vec3(viewMatrix[0].x, 0.0, viewMatrix[2].x));
  float draft = min(1.2, 0.30 + uWindFlow.z * 0.16);
  vec3 wp;
  if (iCycle.y < 0.0) {
    float heat = iCycle.z, vigor = min(heat, 1.0);
    // an uneven draught: each flame stands taller and sinks back on its own slow beat
    float gust = 1.0 + 0.17 * sin(uTime * (1.9 + 1.7 * seed) + seed * 40.0) * sin(uTime * (0.83 + 0.9 * seed) + seed * 17.0);
    float width = iFuel.w * mix(0.58, 1.0, vigor);
    float height = iFuel.w * -iCycle.y * mix(0.34, 1.0, vigor) * max(1.0, heat) * gust;
    // a glowing flame's quad reaches past the flame itself, for the light around it
    vGlow = iCycle.w < 0.0 ? -1.0 - iCycle.w : iCycle.w;
    if (vGlow > 0.0) vUv = vec2((uv.x - 0.5) * 1.4 + 0.5, uv.y * 1.45);
    wp = iFuel.xyz + right * (vUv.x - 0.5) * width;
    wp.y = (iCycle.w < 0.0 ? iFuel.y : texture2D(uHeightTex, (iFuel.xz + uHeightP.x) * uHeightP.y + uHeightP.z).r) - 0.04 + height * vUv.y;
    wp.xz += uWindFlow.xy * height * vUv.y * 0.36 * draft;
    // (a flame the camera stands in thins out instead of filling the screen)
    float fade = smoothstep(0.0, 0.09, heat) * smoothstep(1.1, 3.4, distance(cameraPosition, iFuel.xyz));
    vFire = vec4(-seed - 0.01, heat, fade, dot(right.xz, uWindFlow.xy) * 0.30 * draft);
  } else {
    float clock = uTime * (1.54 + 1.31 * seed) + seed * 91.0;
    float age = fract(clock);
    float birth = fract(sin(floor(clock) * 13.21 + seed * 493.0) * 3914.76);
    float growth = smoothstep(0.0, 0.18, age);
    float width = iFuel.w * (0.70 + 0.30 * growth) * (1.0 - 0.43 * age);
    float height = iFuel.w * iCycle.y * (0.76 + 0.27 * birth) * (1.0 - 0.16 * age);
    wp = iFuel.xyz + right * (uv.x - 0.5) * width;
    wp.y += height * (uv.y - 0.10 + 0.38 * age);
    float pull = age * age * 0.35 + uv.y * uv.y * 0.19;
    wp.xz += uWindFlow.xy * height * pull * draft;
    wp.xz += right.xz * (birth - 0.5) * iFuel.w * 0.23;
    vFire = vec4(seed + birth * 0.38, age, growth * (1.0 - smoothstep(0.61, 1.0, age)), dot(right.xz, uWindFlow.xy) * 0.19);
  }
  vWP = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const FLAME_FS = /* glsl */ `
uniform sampler2D uNoise,uHeightTex;
uniform vec4 uHeightP;
uniform float uTime;
varying vec2 vUv;
varying vec4 vFire;
varying vec3 vWP;
varying float vGlow;
${FIRE_RAMP}
${BRAZIER_GLSL}
${GRASS_FLAME_GLSL}
void main() {
  float halo = 0.0;
  vec4 flame = vFire.x < 0.0 ? grassFlame(vUv, -vFire.x, uTime, vFire.w, vFire.y, halo)
    : brazierCombustion(vUv, vFire.x, vFire.y, uTime, vFire.w);
  float alpha = flame.a * vFire.z;
  halo *= vGlow * vFire.z;
  if (alpha < 0.004 && halo < 0.004) discard;
  float ground = texture2D(uHeightTex, (vWP.xz + uHeightP.x) * uHeightP.y + uHeightP.z).r;
  float above = smoothstep(-0.035, 0.13, vWP.y - ground);
  alpha *= above;
  // the glow is added light: it covers nothing (premultiplied, no alpha of its own)
  gl_FragColor = vec4(flame.rgb * alpha + vec3(0.30, 0.118, 0.022) * halo * above, alpha * (vFire.x < 0.0 ? 0.96 : 0.85));
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
    this.span = new Float32Array(N * N);  // burn time the cell was lit with
    this.cardHeat = new Float32Array(N * N); // this frame's flame size of the cells that show flame
    this.dying = new Map();               // burnt-out cells whose last flamelets still stand, by the time they burnt out
    this.burning = new Set();
    this.airT = 0; this.airBeat = 0;
    this.heatSince = new Map(); // visual age, including the brief afterglow on cooling ash
    this.scorched = new Set();
    this.tex = new THREE.DataTexture(new Uint8Array(N * N * 4), N, N, THREE.RGBAFormat);
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.stage = new THREE.DataTexture(this.tex.image.data, N, N, THREE.RGBAFormat);
    this.texBox = new THREE.Box2(); this.texAt = new THREE.Vector2();
    this.texCells = []; this.texZ0 = N; this.texZ1 = -1;
    U.burnTex.value = this.tex;
    this.acc = 0; this.hurtT = 0; this.fxT = 0;
    this.dirty = false;
    // flames
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    g.setIndex(quad.index);
    this.particles = new THREE.InstancedBufferAttribute(new Float32Array(FLAMES * 4), 4).setUsage(THREE.DynamicDrawUsage);
    // Key phases to cells so culling, distance sorting and regrowth cannot pop the tongues.
    this.flamePhases = Float32Array.from({ length: FLAMES }, () => rand() * 10);
    this.candBuf = []; this.orderBuf = []; this.edgeBuf = []; this.innerBuf = [];
    this.cycles = new THREE.InstancedBufferAttribute(new Float32Array(FLAMES * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iFuel', this.particles); g.setAttribute('iCycle', this.cycles);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: FLAME_VS, fragmentShader: FLAME_FS,
      uniforms: { uTime: U.time, uNoise: U.noise, uWindFlow: windUniforms.uWindFlow, uHeightTex: U.heightTex, uHeightP: U.heightP },
      transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.flames = new THREE.Mesh(g, mat);
    this.flames.frustumCulled = false; this.flames.renderOrder = 9;
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
    this.state[i] = 1; this.vigor[i] = vigor; this.timer[i] = this.span[i] = randRange(BURN_TIME[0], BURN_TIME[1]) * (0.7 + 0.5 * this.fuel[i]);
    this.burning.add(i); this.dying.delete(i); this.heatSince.set(i, G.time); this.dirty = true;
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
    for (const i of this.dying.keys()) { this.cellPos(i, tmp); if ((tmp.x - x) ** 2 + (tmp.z - z) ** 2 <= r * r) this.dying.delete(i); }
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

  writeBraziers(sources, camera, limit) {
    let n = 0;
    for (const f of sources) {
      if (!f.brazier || !f.lit || f.pos.distanceToSquared(camera) > 60 * 60) continue;
      const count = limit === FLAMES ? 17 : 9;
      for (let j = 0; j < count && n < limit; j++) {
        const seed = this.flamePhases[(j * 13 + 9) % FLAMES] * 0.1;
        const chimney = j < 2, body = j < Math.ceil(count * 0.55);
        const angle = 2.4 * j + seed * 0.88;
        const r = (chimney ? 0.07 : body ? 0.24 : 0.40) * f.scale;
        const width = chimney ? 1.12 + seed * 0.24 : body ? 0.99 + seed * 0.29 : 0.79 + seed * 0.22;
        const aspect = chimney ? 1.51 + seed * 0.36 : body ? 1.21 + seed * 0.52 : 0.59 + seed * 0.37;
        this.particles.setXYZW(n, f.pos.x + Math.cos(angle) * r, f.pos.y - 0.08 * f.scale,
          f.pos.z + Math.sin(angle) * r, width * f.scale);
        this.cycles.setXYZW(n++, seed, aspect, 1, 0);
      }
    }
    return n;
  }

  // Burning ground left by spells: the fields own the spots and their heat (`Fields.flameSpots`).
  writeFields(fields, camera, n, limit) {
    for (const list of [fields.list, fields.embers]) for (const f of list) {
      if (!f.flames || f.ended || !(f.heat > 0.03) || f.pos.distanceToSquared(camera) > 70 * 70) continue;
      for (const c of f.flames) {
        const gate = 0.04 + 0.24 * c.phase, stands = f.heat * smoothstep(gate, gate + 0.14, f.heat);
        if (stands < 0.03) continue;
        if (n >= limit) return n;
        this.particles.setXYZW(n, c.x, c.y, c.z, c.width);
        this.cycles.setXYZW(n++, c.phase, -c.aspect, stands, -1 - (c.glow ? smoothstep(0.72, 1.05, f.heat) : 0));
      }
    }
    return n;
  }

  // How tall a cell's flames stand, for the cards only: a surge as the grass catches, an uneven
  // burn, waning as the fuel runs out, then the flamelets left on the ash. 0 once they are out.
  flameHeat(i, rate) {
    const now = G.time, a = this.flamePhases[i % FLAMES] * 0.1, b = this.flamePhases[(i * 7 + 3) % FLAMES] * 0.1;
    const uneven = (0.66 + 0.34 * Math.min(1, this.vigor[i]))
      * (1 + 0.13 * Math.sin(now * (2.0 + 1.4 * a) + b * 40) * Math.sin(now * (0.8 + 0.7 * b) + a * 40));
    if (this.state[i] === 1) {
      const age = now - this.heatSince.get(i), left = (this.timer[i] - this.acc * rate) / this.span[i];
      return smoothstep(0, 0.34, age) * (1 + 0.24 * Math.sin(Math.PI * Math.min(1, age / 0.8))) * lerp(WANE, 1, smoothstep(0, 0.5, left)) * uneven;
    }
    const gone = (now - this.dying.get(i)) * rate / lerp(LINGER[0], LINGER[1], b);
    return gone >= 1 ? 0 : WANE * (1 - gone) ** 1.5 * uneven;
  }

  // Each pocket spans several neighboring emitters on the advancing edge.
  // Low flames fill the gaps and taller ones stand in the pockets.
  writeEdge(cell, side, layer, n, force = false) {
    const phase = this.flamePhases[(cell + side * 13 + layer * 37) % FLAMES] * 0.1;
    // The flames higher up the front need a hot cell. The lowest go out one by one as it cools.
    const heat = this.cardHeat[cell], gate = layer ? 0.30 + 0.055 * layer : 0.04 + 0.24 * phase;
    const stands = heat * smoothstep(gate, gate + 0.14, heat);
    if (stands < 0.03) return n;
    const nx = EDGE_X[side], nz = EDGE_Z[side], ix = cell % this.N, iz = Math.floor(cell / this.N);
    const along = ((layer * 0.618034 + phase * 0.27 + cell * 0.271) % 1 - 0.5) * 0.95;
    const depth = 0.31 + phase * 0.18 - (layer % 3) * 0.15;
    const x = (ix + nx * depth - nz * along) * this.step - this.half;
    const z = (iz + nz * depth + nx * along) * this.step - this.half;
    const pocket = smoothstep(-0.79, 0.82, Math.sin(x * 0.65 + 1.46 * Math.cos(z * 0.41)) + 0.61 * Math.sin(z * 0.69 - x * 0.24));
    if (!force && pocket < 0.14 + 0.14 * phase && (layer > 0 || phase < 0.70)) return n;
    const width = (1.20 + phase * 1.04) * (0.44 + 0.77 * pocket);
    this.particles.setXYZW(n, x, this.T.h[cell], z, width);
    // only a strong flame glows, and one card of a cell carries it: the light of every layer would add up
    this.cycles.setXYZW(n, phase, -(0.60 + pocket * (0.13 + phase * 0.45)), stands, layer ? 0 : smoothstep(0.72, 1.05, heat));
    return n + 1;
  }


  update(dt, camPos, playerPos) {
    const W = G.world;
    const rain = W.weather ? W.weather.rain : 0;
    const wind = G.wind;
    this.acc += dt;
    const tmp = TMP;
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
        fresh.forEach((j, k) => { if (j < 0) { this._scorch(-1 - j); this.dying.set(-1 - j, G.time); } else this._light(j, fv[k]); });
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
    let n = this.writeBraziers(W.flames || [], camPos, FLAMES * q);
    if (G.spells) n = this.writeFields(G.spells.fields, camPos, n, Math.min(FLAMES * q, n + FIELD_FLAMES * q));
    let lx = 0, lz = 0, ly = 0, ln = 0;
    if (this.burning.size || this.dying.size) {
      const cand = this.candBuf; cand.length = 0;
      const rate = 1 + rain * 3;
      const show = (i, heat) => {
        this.cellPos(i, tmp);
        const d = (tmp.x - camPos.x) ** 2 + (tmp.z - camPos.z) ** 2;
        if (d < 110 * 110) { cand.push(d, i); this.cardHeat[i] = heat; }
      };
      for (const i of this.burning) show(i, this.flameHeat(i, rate));
      for (const i of this.dying.keys()) { const heat = this.flameHeat(i, rate); if (heat > 0) show(i, heat); else this.dying.delete(i); }
      // keep the nearest cells (pairs of [dist, idx])
      const order = this.orderBuf; order.length = 0;
      for (let k = 0; k < cand.length; k += 2) order.push(k);
      if (order.length > FLAMES * q / 2) order.sort((a, b) => cand[a] - cand[b]);
      const limit = FLAMES * q;
      for (const k of order) {
        if (cand[k] >= 40 * 40) continue;
        // the glow sinks with the last flames instead of cutting out with the last cell
        const glow = Math.min(1, this.cardHeat[cand[k + 1]]);
        this.cellPos(cand[k + 1], tmp); lx += tmp.x * glow; ly += tmp.y * glow; lz += tmp.z * glow; ln += glow;
      }
      const edges = this.edgeBuf, inner = this.innerBuf;
      edges.length = 0; inner.length = 0;
      for (const k of order) {
        const id = cand[k + 1], ix = id % this.N, iz = Math.floor(id / this.N), before = edges.length;
        for (let face = 0; face < 4; face++) {
          const x = ix + EDGE_X[face], z = iz + EDGE_Z[face], neighbor = z * this.N + x;
          if (x >= 0 && x < this.N && z >= 0 && z < this.N && this.state[neighbor] === 0 && this.fuel[neighbor] >= 0.12) {
            edges.push(id * 4 + face);
          }
        }
        // A cell with no unburned neighbour (isolated, or ringed by fire or ash) still burns and hurts.
        if (edges.length === before) inner.push(id);
      }
      // The front's first layer comes first, then one flame per inner cell, then the remaining layers.
      for (let layer = 0; layer < 12 && n < limit; layer++) {
        for (const edge of edges) {
          n = this.writeEdge(Math.floor(edge / 4), edge % 4, layer, n);
          if (n === limit) break;
        }
        if (layer === 0) for (const id of inner) {
          if (n === limit) break;
          n = this.writeEdge(id, id % 4, 0, n, true);
        }
      }
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
    this.airT -= dt;
    if (this.airT <= 0 && this.heatSince.size) {
      this.airT = 0.095 / q;
      const beat = ++this.airBeat;
      // Walk the small set of hot cells once, with a rotating start, including
      // still-warm ash after the last cell has gone out.
      const count = this.heatSince.size, start = (beat * 71) % count;
      let index = 0, emitted = 0;
      for (const [id, since] of this.heatSince) {
        const slot = (index++ - start + count) % count;
        if (slot >= 9 || G.time - since > (this.state[id] === 2 ? 7 : 4) || (this.state[id] === 2 && (beat + id) % 5 !== 0)) continue;
        this.cellPos(id, tmp);
        if (tmp.distanceToSquared(camPos) > 38 * 38) continue;
        G.vfx.fireAir?.(tmp, beat * 47 + id, this.state[id] === 1 ? 1 : 0.63, (beat + id) % (this.state[id] === 2 ? 2 : 6) === 0);
        if (++emitted === 7) break;
      }
    }
    if (n) this.particles.needsUpdate = this.cycles.needsUpdate = true;
    this.flames.geometry.instanceCount = n;
    this.flames.visible = n > 0;
    if (ln > 0.01) {
      this.light.position.set(lx / ln, ly / ln + 2, lz / ln);
      // sized for the dark; by day the same light only bleaches the grass (see VFX.lightK)
      this.light.intensity = Math.min(1, ln / 12) * (22 + Math.sin(G.time * 17) * 4) * (G.vfx ? G.vfx.lightK() : 1);
      if (ln >= 9 && this.light.position.distanceToSquared(camPos) < 24 * 24) {
        G.vfx.distort?.fireHaze(this.light.position, 3.2);
      }
    } else this.light.intensity = 0;
    // crackle bed at the fire nearest the player
    const near = ln > 0.01;
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
        const cooling = 4.2 + this.flamePhases[i % FLAMES] * 0.36;
        d[i * 4 + 2] = Math.round(225 * (1 - smoothstep(0, cooling, age)));
        if (age >= cooling) this.heatSince.delete(i);
      }
      mark(i);
    }
    this.texZ0 = n0; this.texZ1 = n1;
    z0 = Math.min(z0, n0); z1 = Math.max(z1, n1);
    const R = G.renderer && G.renderer.renderer;
    if (z1 < z0) return;
    if (!R) { this.tex.needsUpdate = true; return; }
    if (!this.unpackKnown) {
      // copyTextureToTexture saves and restores five unpack settings; three asks the driver for
      // any it has not set itself, a GPU sync that stalled the first fire for ~180 ms. These
      // are the GL defaults, so telling three's state cache about them changes nothing else.
      this.unpackKnown = true;
      const gl = R.getContext();
      for (const p of [gl.UNPACK_ROW_LENGTH, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES]) R.state.pixelStorei(p, 0);
    }
    this.texBox.min.set(0, z0); this.texBox.max.set(N, z1 + 1);
    this.texAt.set(0, z0);
    R.copyTextureToTexture(this.stage, this.tex, this.texBox, this.texAt);
  }
}
