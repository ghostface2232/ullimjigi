// Weather: regional climates drive a slowly changing sky (clear → cloudy →
// rain → thunderstorm, or snow in the cold north). Weather is a system, not
// decoration: rain soaks everyone (wet enemies conduct lightning), damps and
// drowns wildfire and makes rock slick to climb; thunderstorms throw lightning
// at tall things and at anyone holding up a storm-attuned staff.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { U } from '../render/materials.js';
import { rand, randRange, damp, clamp, smoothstep, lerp } from '../core/util.js';
import { regionAt } from './layout.js';

// State targets: cloud cover, precipitation, storm (lightning), wind strength
const STATES = {
  clear: { cloud: 0, rain: 0, storm: 0, wind: 0.35, name: '맑음' },
  cloudy: { cloud: 0.55, rain: 0, storm: 0, wind: 0.55, name: '흐림' },
  rain: { cloud: 0.85, rain: 0.75, storm: 0, wind: 0.7, name: '비' },
  storm: { cloud: 1, rain: 1, storm: 1, wind: 1, name: '뇌우' },
};
// Region climate: weights for the next state
const CLIMATE = {
  default: { clear: 5, cloudy: 3, rain: 2, storm: 0.6 },
  village: { clear: 6, cloudy: 3, rain: 1.6, storm: 0.3 },
  frost: { clear: 3, cloudy: 3, rain: 3, storm: 0.5 },      // falls as snow up there
  frostpass: { clear: 3, cloudy: 3, rain: 3, storm: 0.5 },
  storm: { clear: 1.5, cloudy: 3, rain: 3, storm: 4 },      // the plateau earns its name
  rift: { clear: 1, cloudy: 5, rain: 0, storm: 0 },         // ash sky, no rain
};
const RAIN_BOX = 15, RAIN_H = 15;

const RAIN_VS = /* glsl */ `
attribute float aSeed;
uniform vec3 uCam;
uniform float uTime;
uniform float uSnow;
uniform vec2 uWind;
uniform float uAmount;
varying float vA;
varying float vSnow;
void main(){
  vec3 p = position; // base offset inside the box, y = 0 bottom / 1 top of the streak
  float speed = mix(19.0, 1.6, uSnow);
  float fall = mod(p.y * ${RAIN_H.toFixed(1)} - uTime * speed * (0.85 + aSeed * 0.3), ${RAIN_H.toFixed(1)});
  vec3 w;
  w.x = mod(p.x + uCam.x * -1.0 + uWind.x * uTime * mix(2.5, 1.2, uSnow), ${(RAIN_BOX * 2).toFixed(1)}) - ${RAIN_BOX.toFixed(1)} + uCam.x;
  w.z = mod(p.z + uCam.z * -1.0 + uWind.y * uTime * mix(2.5, 1.2, uSnow), ${(RAIN_BOX * 2).toFixed(1)}) - ${RAIN_BOX.toFixed(1)} + uCam.z;
  w.y = uCam.y - 5.0 + fall;
  // snow flutters, rain streaks along its velocity
  w.x += uSnow * sin(uTime * 1.3 + aSeed * 40.0) * 0.6;
  w.z += uSnow * cos(uTime * 1.1 + aSeed * 23.0) * 0.6;
  float tip = normal.y; // 0 = head, 1 = tail of the streak
  vec3 vel = normalize(vec3(uWind.x * 0.25, -1.0, uWind.y * 0.25));
  w -= vel * tip * mix(0.85, 0.07, uSnow);
  // width across the view (after wrapping, so a streak never straddles the box edge)
  vec3 side = normalize(cross(vel, w - cameraPosition));
  w += side * normal.x * mix(0.007, 0.035, uSnow);
  float keep = step(aSeed, uAmount);
  float d = length(w.xz - uCam.xz);
  // rain close to the lens fades out (the streaks nearest the camera are the ones that cover the view)
  vA = keep * (1.0 - smoothstep(${(RAIN_BOX * 0.6).toFixed(1)}, ${RAIN_BOX.toFixed(1)}, d)) * mix(smoothstep(1.5, 5.0, d), smoothstep(0.5, 3.0, d), uSnow) * (1.0 - tip * 0.7);
  vSnow = uSnow;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const RAIN_FS = /* glsl */ `
uniform vec3 uTint;
varying float vA;
varying float vSnow;
void main(){
  if (vA < 0.01) discard;
  gl_FragColor = vec4(mix(uTint, vec3(0.95, 0.97, 1.0), vSnow), vA * mix(0.3, 0.85, vSnow));
}`;

export class Weather {
  constructor(scene) {
    this.state = 'clear';
    this.next = 'clear';
    this.stateT = randRange(150, 260);     // seconds until the sky reconsiders
    this.cloud = 0; this.rain = 0; this.storm = 0; this.windS = 0.35;
    this.snow = 0;                          // 0 rain … 1 snow at the player's location
    this.wet = 0;                           // how soaked exposed surfaces are (lags rain)
    this.windAng = 0.49;
    this.windVec = { x: Math.cos(this.windAng), z: Math.sin(this.windAng), s: this.windS };
    this.locked = null;
    this.strikeT = randRange(6, 12);
    this.soakT = 0;
    this.pending = [];                      // delayed thunder
    this.charge = null;                     // lightning gathering on the player's staff
    // precipitation: camera-wrapped streaks, one draw call
    const COUNT = G.settings.quality === 'low' ? 3500 : 8000;
    const pos = new Float32Array(COUNT * 6 * 3), nrm = new Float32Array(COUNT * 6 * 3), seed = new Float32Array(COUNT * 6);
    for (let i = 0; i < COUNT; i++) {
      const x = rand() * RAIN_BOX * 2, y = rand(), z = rand() * RAIN_BOX * 2, s = rand();
      // two triangles forming a thin quad from head (tip 0) to tail (tip 1)
      const corners = [[-1, 0], [1, 0], [1, 1], [-1, 0], [1, 1], [-1, 1]];
      corners.forEach(([side, tip], k) => {
        const o = (i * 6 + k) * 3;
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
        nrm[o] = side; nrm[o + 1] = tip; nrm[o + 2] = 0;
        seed[i * 6 + k] = s;
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.uni = { uCam: { value: new THREE.Vector3() }, uTime: U.time, uSnow: { value: 0 }, uWind: { value: new THREE.Vector2() }, uAmount: { value: 0 }, uTint: { value: new THREE.Color(0.7, 0.78, 0.9) } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: RAIN_VS, fragmentShader: RAIN_FS, uniforms: this.uni, transparent: true, depthWrite: false }));
    this.mesh.frustumCulled = false;
    this.mesh.userData.noBake = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.loop = null;
  }

  // Story/cutscene control: force a state (null to release)
  lock(state) { this.locked = state; if (state) this.set(state); }
  set(state) { this.next = state; this.stateT = randRange(160, 300); }
  get name() { return (this.snow > 0.5 && this.rain > 0.2 ? (this.storm > 0.5 ? '눈보라' : '눈') : STATES[this.next].name); }

  pick(region) {
    const w = region.climate || CLIMATE[region.id] || CLIMATE.default;
    // a storm tends to break into rain, rain into clouds — weather has momentum
    const bias = { clear: 1, cloudy: 1, rain: 1, storm: 1 };
    if (this.next === 'storm') { bias.rain = 2.5; bias.storm = 0.4; }
    if (this.next === 'rain') { bias.cloudy = 1.8; bias.storm = 1.5; }
    if (this.next === 'clear') { bias.cloudy = 1.6; bias.storm = 0.3; }
    let tot = 0; for (const k in w) tot += w[k] * bias[k];
    let r = rand() * tot;
    for (const k in w) { r -= w[k] * bias[k]; if (r <= 0) return k; }
    return 'clear';
  }

  update(dt, camPos, playerPos) {
    if (!dt) return;
    const reg = regionAt(playerPos.x, playerPos.z);
    const story = G.story;
    const calm = G.mode !== 'free' || G.bossActive || !story || !story.flag || !story.flag('worldOpen');
    this.stateT -= dt;
    // a dialogue or boss fight clears the sky right away (over the usual ~40 s fade)
    // instead of waiting for the next scheduled roll
    if (calm && !this.locked && this.next !== 'clear') this.set('clear');
    else if (this.stateT <= 0 && !this.locked) this.set(calm ? 'clear' : this.pick(reg));
    if (reg.id === 'rift' && story && story.chapter !== 'post' && !this.locked && (this.next === 'rain' || this.next === 'storm')) this.next = 'cloudy';
    const T = STATES[this.next];
    // weather rolls in over ~25 s and clears over ~40 s
    const k = (a, b) => (b > a ? 0.045 : 0.028);
    this.cloud = damp(this.cloud, T.cloud, k(this.cloud, T.cloud) * 4, dt);
    this.rain = damp(this.rain, T.rain * smoothstep(0.5, 0.85, this.cloud), k(this.rain, T.rain) * 4, dt);
    this.storm = damp(this.storm, T.storm, 0.12, dt);
    this.windS = damp(this.windS, T.wind, 0.1, dt);
    this.windAng += dt * 0.004 * Math.sin(G.time * 0.013);
    this.windVec.x = Math.cos(this.windAng); this.windVec.z = Math.sin(this.windAng); this.windVec.s = this.windS;
    // in the vale: north and high up; beyond the ring, wherever snow lies on the ground
    const out = smoothstep(236, 300, Math.hypot(playerPos.x, playerPos.z));
    const cold = lerp(smoothstep(-80, -120, playerPos.z) * 0.6 + smoothstep(36, 46, playerPos.y) * 0.8, G.world.terrain.snowAt(playerPos.x, playerPos.z) * 1.2, out);
    this.snow = damp(this.snow, clamp(cold, 0, 1) > 0.5 ? 1 : 0, 0.5, dt);
    this.wet = damp(this.wet, this.rain * (1 - this.snow), this.rain > this.wet ? 0.15 : 0.02, dt);
    U.wet.value = this.wet;
    U.wind.value *= 1 + this.windS * 0.8; // grass and trees bend harder in rough weather

    // sky & light
    const sky = G.world.sky;
    sky.overcast = this.cloud;
    sky.storm = this.storm;

    // precipitation mesh
    const amt = this.rain;
    this.mesh.visible = amt > 0.02;
    if (this.mesh.visible) {
      this.uni.uCam.value.copy(camPos);
      this.uni.uAmount.value = amt * (G.settings.quality === 'low' ? 0.6 : 1);
      this.uni.uSnow.value = this.snow;
      this.uni.uWind.value.set(this.windVec.x * this.windS * 4, this.windVec.z * this.windS * 4);
      const n = sky.night || 0;
      this.uni.uTint.value.setRGB(0.62 - n * 0.35, 0.7 - n * 0.35, 0.82 - n * 0.3);
    }
    // rain bed
    const want = amt * (1 - this.snow * 0.8);
    if (want > 0.05 && !this.loop && G.audio.ready) this.loop = G.audio.loop('loop_rain', { v: 0.01, max: 3600, fadeIn: 2 });
    if (this.loop) {
      if (want < 0.03) { this.loop.stop(3); this.loop = null; }
      else if (this.loop.vol) this.loop.vol(want * 0.9);
    }

    // soak: rain wets everything standing in it, and damps the wildfire
    this.soakT -= dt;
    if (this.soakT <= 0) {
      this.soakT = 1;
      if (this.rain > 0.35 && this.snow < 0.5) {
        for (const e of G.enemies.list) if (e.alive && e.st && !(e.def.immune || []).includes('water')) e.st.wet = Math.max(e.st.wet, 6);
        if (G.world.fire && this.rain > 0.6) {
          // heavy rain slowly drowns open flames
          let n = 0; const tmp = new THREE.Vector3();
          for (const i of G.world.fire.burning) { if (rand() < this.rain * 0.25) { G.world.fire.cellPos(i, tmp); G.world.fire._scorch(i); if (++n > 40) break; } }
          if (n) G.world.fire.dirty = true;
        }
        if (G.story && G.story.once('rain1')) G.hud.hint('<b>비</b> — 비를 맞은 적은 <b>젖는다</b>. 번개를 치면 젖은 적 모두에게 감전이 번진다<br><small>불은 잘 붙지 않고, 젖은 바위는 오르다 미끄러진다</small>', 8);
      }
    }

    // thunder & lightning
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]; p.t -= dt;
      if (p.t <= 0) { this.pending.splice(i, 1); G.audio.play('thunder', { v: p.v, near: p.near }); }
    }
    // no lightning while the storm fades out of a boss fight
    if (this.storm > 0.6 && this.snow < 0.7 && G.mode === 'free' && !G.bossActive) {
      this.updateCharge(dt);
      this.strikeT -= dt;
      if (this.strikeT <= 0) {
        this.strikeT = randRange(5, 13) / this.storm;
        this.randomStrike(playerPos);
      }
    } else if (this.charge) this.clearCharge();
  }

  // Lightning looks for tall things: trees, towers, rocks… or a raised storm staff.
  randomStrike(playerPos) {
    const W = G.world;
    const a = rand() * Math.PI * 2, r = randRange(18, 70);
    let x = playerPos.x + Math.cos(a) * r, z = playerPos.z + Math.sin(a) * r;
    let top = W.h(x, z);
    // snap to the tallest collider nearby
    let best = null;
    W.col.query(x, z, 10, (c) => { if (c.h1 < 1e8 && c.h1 > top + 1 && (!best || c.h1 > best.h1)) best = c; });
    if (best) { x = best.x; z = best.z; top = best.h1; }
    this.strike(new THREE.Vector3(x, top, z));
  }
  strike(at, o = {}) {
    const from = at.clone().add(new THREE.Vector3(randRange(-8, 8), 70, randRange(-8, 8)));
    G.vfx.lightning(from, at, { width: 0.22, dur: 0.35, branches: 4, segs: 14, jag: 0.35 });
    G.vfx.flash(at, 0xcfe0ff, 90, 40, 0.35);
    G.vfx.burst(at, 'spark', 16, { el: 'storm', speed: 8 });
    const d = G.camera.position.distanceTo(at);
    this.pending.push({ t: d / 343, v: clamp(1.4 - d / 140, 0.25, 1), near: d < 30 });
    G.renderer.grade.uniforms.uImpact.value = Math.max(G.renderer.grade.uniforms.uImpact.value, clamp(0.35 - d / 300, 0, 0.3));
    // lightning is fire's oldest spark: dry grass catches
    if (G.world.fire && this.rain < 0.7) G.world.fire.ignite(at.x, at.z, 2, 0.7);
    for (const e of G.enemies.list) if (e.alive && e.pos.distanceTo(at) < 5) G.combat.hit(e, { dmg: 18 + G.player.power(), el: 'storm', pos: e.center(), source: 'env' });
    const P = G.player;
    if (P.pos.distanceTo(at) < 4 && !o.harmless) P.damage(8, { dir: new THREE.Vector3().subVectors(P.pos, at).setY(0).normalize(), knock: 10 });
  }

  // Holding the storm element in a thunderstorm draws the sky's attention.
  updateCharge(dt) {
    const P = G.player;
    const exposed = P.element === 'storm' && !P.swimming && this.rain > 0.5;
    if (!exposed) { if (this.charge) this.clearCharge(); return; }
    if (!this.charge) {
      this.charge = { t: 0, next: randRange(10, 20) };
      return;
    }
    const C = this.charge;
    C.t += dt;
    if (C.t > C.next - 2.2 && !C.warned) {
      C.warned = true;
      G.audio.play('staff_crackle', { pos: P.staffTip() });
      if (G.story && G.story.once('stormStaff')) G.hud.hint('<b>뇌우 속의 번개 지팡이</b> — 번개의 노래를 든 채 서 있으면 벼락이 지팡이를 노린다! 다른 속성으로 바꾸면 피할 수 있다', 7);
    }
    if (C.warned && rand() < dt * 18) G.vfx.burst(P.staffTip(), 'spark', 1, { el: 'storm', speed: 2 });
    if (C.t >= C.next) {
      this.charge = null;
      this.strike(P.pos.clone(), {});
    }
  }
  clearCharge() { this.charge = null; }
}
