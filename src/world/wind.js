// Shared world-space wind. CPU and shaders read the same advected gust tile
// and stationary pass exposure, with altitude adding ridge exposure.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { clamp, mulberry32, smoothstep } from '../core/util.js';
import { Env } from './env.js';
import { PASSES, WORLD } from './layout.js';

const SIZE = 64, PERIOD = 384;
const PREVAILING = new THREE.Vector2(Math.cos(0.49), Math.sin(0.49));
const BODY_COUNT = 6, TRAIL_COUNT = 6, IMPACT_COUNT = 8;
const BODY_RANGE_SQ = 32 ** 2, TRAIL_LIFE = 1.2, IMPACT_LIFE = 1.05;
const tile = new Uint8Array(SIZE * SIZE * 4);
const grain = new Float32Array(64);
const random = mulberry32(4211);
for (let i = 0; i < grain.length; i++) grain[i] = random();
const passes = PASSES.flatMap(({ pts, w }) => pts.slice(1).map(([x, z], i) => {
  const [ax, az] = pts[i];
  const dx = x - ax, dz = z - az;
  return { ax, az, dx, dz, inv: 1 / (dx * dx + dz * dz), width: w };
}));
function readTile(x, z, size, data, stride, channel, smooth = false) {
  const tx = x * size - 0.5, tz = z * size - 0.5;
  const ix = Math.floor(tx), iz = Math.floor(tz), s = size - 1;
  let u = tx - ix, v = tz - iz;
  if (smooth) { u = smoothstep(0, 1, u); v = smoothstep(0, 1, v); }
  const x0 = (ix & s) * stride + channel, x1 = ((ix + 1) & s) * stride + channel;
  const z0 = (iz & s) * size * stride, z1 = ((iz + 1) & s) * size * stride;
  const a = data[z0 + x0], b = data[z0 + x1], c = data[z1 + x0], d = data[z1 + x1];
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
  const idx = (j * SIZE + i) * 4;
  const x = (i + 0.5) / SIZE, z = (j + 0.5) / SIZE;
  tile[idx] = Math.round(readTile(x, z, 8, grain, 1, 0, true) * 255);
  const wx = x * WORLD.size - WORLD.half, wz = z * WORLD.size - WORLD.half;
  let exposure = 0;
  for (const p of passes) {
    const dx = wx - p.ax, dz = wz - p.az;
    const t = clamp((dx * p.dx + dz * p.dz) * p.inv, 0, 1);
    exposure = Math.max(exposure, 1 - smoothstep(p.width * 0.7, p.width * 3, Math.hypot(dx - t * p.dx, dz - t * p.dz)));
  }
  tile[idx + 1] = Math.round(exposure * 255);
}
const windMap = new THREE.DataTexture(tile, SIZE, SIZE);
windMap.wrapS = windMap.wrapT = THREE.RepeatWrapping;
windMap.minFilter = windMap.magFilter = THREE.LinearFilter;
windMap.needsUpdate = true;

const vectors = (n) => Array.from({ length: n }, () => new THREE.Vector4());
const flow = new THREE.Vector4(PREVAILING.x, PREVAILING.y, 0.85, 0);
const travel = new THREE.Vector2();
const bodies = vectors(BODY_COUNT + TRAIL_COUNT);
const impacts = vectors(IMPACT_COUNT);
const impactDetails = Array.from({ length: IMPACT_COUNT }, () => new THREE.Vector2());
const contactOrigin = new THREE.Vector2();
export const windUniforms = {
  uWindMap: { value: windMap },
  uWindFlow: { value: flow }, // direction XZ, base strength, elapsed sim time
  uWindTravel: { value: travel }, // integrated transport, in metres
};
export const windContactUniforms = {
  uWindBodies: { value: bodies },
  uWindImpacts: { value: impacts },
  uWindImpactDetails: { value: impactDetails },
  uWindHasImpacts: { value: false },
  uWindContactOrigin: { value: contactOrigin },
};

export const WIND_GLSL = /* glsl */ `
uniform sampler2D uWindMap;
uniform vec4 uWindFlow;
uniform vec2 uWindTravel;

vec2 windStrength(vec3 p, float time) {
  // Standalone asset viewers supply their own clock before there is a World.
  vec2 q = p.xz - uWindTravel - uWindFlow.xy * (uWindFlow.w == 0.0 ? time * 5.0 : 0.0);
  float noise = texture2D(uWindMap, q / ${PERIOD}.0).r;
  float phase = dot(q, vec2(${PREVAILING.x}, ${PREVAILING.y})) * 0.18 + (noise - 0.5) * 5.0;
  float front = smoothstep(0.18, 0.93, sin(phase) * 0.5 + 0.5) * mix(0.45, 1.0, noise);
  float pass = texture2D(uWindMap, p.xz / ${WORLD.size}.0 + 0.5).g;
  float exposure = 1.0 + 0.42 * pass + 0.42 * smoothstep(16.0, 78.0, p.y);
  float base = uWindFlow.z * exposure;
  return vec2(base * (0.28 + 1.35 * front), base * front);
}

vec3 windLocalOffset(mat3 basis, vec3 offset) {
  return vec3(dot(basis[0], offset) / dot(basis[0], basis[0]),
              dot(basis[1], offset) / dot(basis[1], basis[1]),
              dot(basis[2], offset) / dot(basis[2], basis[2]));
}
`;

export const WIND_CONTACT_GLSL = /* glsl */ `
uniform vec4 uWindBodies[${BODY_COUNT + TRAIL_COUNT}]; // feet XYZ, pressure
uniform vec4 uWindImpacts[${IMPACT_COUNT}]; // centre XZ, birth time, radius
uniform vec2 uWindImpactDetails[${IMPACT_COUNT}]; // elevation, force
uniform vec2 uWindContactOrigin;
uniform bool uWindHasImpacts;

vec2 windContact(vec3 p) {
  vec2 push = vec2(0.0);
  vec2 near = p.xz - uWindContactOrigin;
  if (dot(near, near) < ${BODY_RANGE_SQ}.0) {
    float strongest = 0.0;
    for (int i = 0; i < ${BODY_COUNT + TRAIL_COUNT}; i++) {
      vec4 b = uWindBodies[i];
      vec2 d = p.xz - b.xz;
      float r2 = dot(d, d);
      float dy = abs(p.y - b.y);
      if (r2 >= 2.25 || dy >= 1.65 || b.w <= strongest) continue;
      float k = (1.0 - smoothstep(0.04, 2.25, r2)) * (1.0 - smoothstep(0.7, 1.65, dy)) * b.w;
      if (k > strongest) {
        push = d * (k * inversesqrt(max(r2, 0.015)));
        strongest = k;
      }
    }
  }
  if (uWindHasImpacts) for (int i = 0; i < ${IMPACT_COUNT}; i++) {
    vec4 b = uWindImpacts[i];
    if (b.w == 0.0) continue;
    vec2 d = p.xz - b.xy;
    float age = clamp((uWindFlow.w - b.z) / ${IMPACT_LIFE}, 0.0, 1.0);
    float r2 = dot(d, d), reach = b.w;
    if (r2 > reach * reach) continue;
    vec2 info = uWindImpactDetails[i];
    float grade = 1.0 - smoothstep(2.0, 4.0 + reach * 0.35, abs(p.y - info.x));
    float r = sqrt(r2);
    float edge = min((age * 2.5 + 0.08) * reach, reach);
    float width = 0.5 + reach * 0.16;
    float ring = 1.0 - smoothstep(0.0, width, abs(r - edge));
    float wake = 0.36 * (1.0 - smoothstep(edge - width, edge + width * 0.3, r));
    float rim = 1.0 - smoothstep(reach * 0.8, reach, r);
    push += d / max(r, 0.15) * max(ring, wake) * (1.0 - age) * info.y * grade * rim;
  }
  return push / max(1.0, length(push) * 0.46);
}
`;

// These pools already upload position and normalized age. Advect light sprites
// in their vertex pass so smoke and snow pick up a gust without new CPU work.
function attachParticles(pool) {
  const mat = pool.mat;
  if (mat.uniforms.uWindFlow) return;
  Object.assign(mat.uniforms, windUniforms);
  mat.vertexShader = WIND_GLSL + mat.vertexShader
    .replace('void main(){', `void main(){
      vec3 drifted = position;
      if (aShape == 3.0 || aShape == 8.0 || aShape == 10.0 || aShape == 11.0 ||
          (aShape == 0.0 && uAdditive < 0.5)) {
        float air = windStrength(position, uWindFlow.w).x;
        float drag = aShape == 3.0 || aShape == 8.0 ? 2.2 : 1.15;
        drifted.xz += uWindFlow.xy * air * drag * aMisc.y * aMisc.y;
      }`)
    .replaceAll('vec4(position', 'vec4(drifted');
  mat.needsUpdate = true;
}

// The environment entry point receives enemy and non-wind spell impacts too.
export class WindEnv extends Env {
  onSpell(impact) {
    const p = impact?.pos;
    if (p && impact.kind !== 'field' && Math.abs(p.y - this.W.h(p.x, p.z)) < 3.5) {
      G.wind?.impact(p.x, p.y, p.z, clamp(impact.r ?? 2, 0.9, 12), impact.el === 'wind' ? 2.5 : 1.15);
    }
    super.onSpell(impact);
  }
}

export class Wind {
  constructor() {
    travel.set(0, 0);
    flow.set(PREVAILING.x, PREVAILING.y, 0.85, 0);
    for (const b of bodies) b.set(0, 0, 0, 0);
    for (const b of impacts) b.set(0, 0, 0, 0);
    windContactUniforms.uWindHasImpacts.value = false;
    this.trailAt = new Float32Array(TRAIL_COUNT);
    this.trailIndex = 0;
    this.trailT = 0;
    this.trailBody = 0;
    this.trailPos = vectors(BODY_COUNT);
    this.impactIndex = 0;
    this.bodyDistance = new Float32Array(BODY_COUNT);
    this.cloudOffset = new THREE.Vector2();
    this.direction = new THREE.Vector2();
    this.flow = flow;
    this.travel = travel;
    if (G.vfx) {
      attachParticles(G.vfx.add);
      attachParticles(G.vfx.norm);
    }
  }

  // Fill a caller-owned vector with the local wind in metres per second.
  sample(pos, out) {
    const x = pos.x - travel.x, z = pos.z - travel.y;
    const noise = readTile(x / PERIOD, z / PERIOD, SIZE, tile, 4, 0) / 255;
    const phase = (x * PREVAILING.x + z * PREVAILING.y) * 0.18 + (noise - 0.5) * 5;
    const front = smoothstep(0.18, 0.93, Math.sin(phase) * 0.5 + 0.5) * (0.45 + noise * 0.55);
    const pass = readTile(pos.x / WORLD.size + 0.5, pos.z / WORLD.size + 0.5, SIZE, tile, 4, 1) / 255;
    const exposure = 1 + 0.42 * pass + 0.42 * smoothstep(16, 78, pos.y);
    const speed = flow.z * exposure * (0.28 + 1.35 * front) * 4;
    return out.set(flow.x * speed, 0, flow.y * speed);
  }

  impact(x, y, z, radius, force) {
    for (let i = 0; i < IMPACT_COUNT; i++) {
      const b = impacts[i];
      if (!b.w || flow.w - b.z > 0.09 || (x - b.x) ** 2 + (z - b.y) ** 2 > 1) continue;
      b.w = Math.max(radius, b.w);
      impactDetails[i].y = Math.max(impactDetails[i].y, force);
      return;
    }
    const i = this.impactIndex++ % IMPACT_COUNT;
    impacts[i].set(x, z, flow.w, radius);
    impactDetails[i].set(y, force);
    windContactUniforms.uWindHasImpacts.value = true;
  }

  update(dt, hour, weather, playerPos) {
    if (dt <= 0) return;
    flow.w += dt;
    const angle = 0.49 + 0.23 * Math.sin(flow.w * 0.022) + 0.12 * Math.sin(flow.w * 0.009);
    const dawn = 1 - smoothstep(0.4, 3.6, Math.abs(hour - 6));
    flow.set(Math.cos(angle), Math.sin(angle), (0.85 - 0.47 * dawn) + weather * 1.3, flow.w);
    this.direction.set(flow.x, flow.y);
    travel.addScaledVector(this.direction, (3.8 + flow.z * 2.8) * dt);
    // Cloud shaders sample upwind (p + offset). Their layout wraps at 80 km.
    this.cloudOffset.addScaledVector(this.direction, -(3 + flow.z * 5.5) * dt);
    this.cloudOffset.x %= 80000;
    this.cloudOffset.y %= 80000;
    let active = false;
    for (const b of impacts) {
      if (flow.w - b.z >= IMPACT_LIFE) b.w = 0;
      if (b.w) active = true;
    }
    windContactUniforms.uWindHasImpacts.value = active;
    this.updateBodies(dt, playerPos);
  }

  updateBodies(dt, playerPos) {
    const player = G.player, companion = G.companion;
    contactOrigin.set(playerPos.x, playerPos.z);
    bodies[0].set(playerPos.x, playerPos.y, playerPos.z, G.state === 'play' && !player?.swimming && !player?.dead ? 1 : 0);
    const cp = companion?.pos;
    if (companion?.active) bodies[1].set(cp.x, cp.y, cp.z, 0.58);
    else bodies[1].w = 0;
    for (let i = 2; i < BODY_COUNT; i++) {
      bodies[i].w = 0;
      this.bodyDistance[i] = BODY_RANGE_SQ;
    }
    const enemies = G.enemies?.list;
    if (enemies) for (const e of enemies) {
      if (!e.alive || !e.root?.visible || e.def.flying) continue;
      const p = e.pos;
      const d = (p.x - playerPos.x) ** 2 + (p.z - playerPos.z) ** 2;
      for (let i = 2; i < BODY_COUNT; i++) {
        if (d >= this.bodyDistance[i]) continue;
        for (let j = BODY_COUNT - 1; j > i; j--) {
          this.bodyDistance[j] = this.bodyDistance[j - 1];
          bodies[j].copy(bodies[j - 1]);
        }
        this.bodyDistance[i] = d;
        bodies[i].set(p.x, p.y, p.z, 0.85);
        break;
      }
    }
    this.trailT -= dt;
    if (this.trailT <= 0) {
      this.trailT = 0.13;
      for (let i = 0; i < BODY_COUNT; i++) {
        const ix = (this.trailBody + i) % BODY_COUNT, b = bodies[ix], p = this.trailPos[ix];
        const moved = (b.x - p.x) ** 2 + (b.z - p.z) ** 2;
        if (!b.w || moved < 0.12) continue;
        p.copy(b);
        const t = this.trailIndex++ % TRAIL_COUNT;
        bodies[BODY_COUNT + t].copy(b);
        this.trailAt[t] = flow.w;
        this.trailBody = (ix + 1) % BODY_COUNT;
        break;
      }
    }
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const b = bodies[BODY_COUNT + i];
      if (b.w > 0) b.w = (1 - smoothstep(0, TRAIL_LIFE, flow.w - this.trailAt[i])) * 0.63;
    }
  }
}

