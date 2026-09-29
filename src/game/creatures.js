// Non-humanoid sculpted creatures: shared rig base (skinned instance, root
// motion, LOD, springs, secondary chains) plus Boreum the wind fox and the cat.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { fresnelMat } from '../render/materials.js';
import { damp, clamp, rand } from '../core/util.js';
import { SkelDef, Sculpt, tube, blob, sstep, mix, TAU, instance, bodyMat, stripeMat, Chain, Spring } from './charkit.js';
import { Rig } from './humanrig.js';

const V3 = THREE.Vector3;
const v = (x, y, z) => new V3(x, y, z);
const _v1 = new V3(), _v2 = new V3(), _v3 = new V3();
const wrapA = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

// ---------------------------------------------------------------------------
// Type cache: build(key) -> { def, built, chains?, extra? } once per key.
const TYPES = new Map();
export function creatureType(key, build) {
  let T = TYPES.get(key);
  if (!T) { const t0 = performance.now(); T = build(); T.ms = performance.now() - t0; TYPES.set(key, T); }
  return T;
}
// Sculpt helper: build a skeleton + parts, then bake per-group geometry.
// parts(S, def) adds sculpt parts; color: key -> hex; group: key -> group name.
export function bakeType(def, parts, color, group) {
  def.finalize();
  const S = new Sculpt(def);
  parts(S, def);
  return S.build({ color: (k) => color[k] ?? 0xff00ff, group: (k) => group[k] ?? 'main' });
}
// Vertex-colored basic glow material (tier color multiplies the vertex colors).
export function glowBasic(color, k = 2.6, o = {}) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), vertexColors: o.vertexColors ?? true, transparent: !!o.transparent, opacity: o.opacity ?? 1, depthWrite: o.depthWrite ?? true, side: o.side ?? THREE.FrontSide });
  m.userData.dissolve = { value: 0 };   // marker: hidden mid-dissolve by enemies.js
  return m;
}

export class CreatureRig extends Rig {
  // T: { def, built, chains: [{ names, tail, opts, cols? }] }, M: group -> material
  constructor(T, M, o = {}) {
    super();
    this.T = T;
    this.s = o.scale ?? 1;
    const body = (this.body = new THREE.Group());
    body.scale.setScalar(this.s);
    this.root.add(body);
    this.M = M;
    const I = instance(body, T.def, T.built, M, { outline: o.outline ?? 0, main: o.main, shadow: o.shadow, bsPad: o.bsPad });
    this.B = I.by; this.mesh = I.mesh; this.meshes = I.meshes; this.skeleton = I.skeleton; this.outline = I.outline;
    this.mats = Object.values(M).filter((m) => m && m.isMeshToonMaterial);
    this.glowMats = Object.values(M).filter((m) => m && m.isMeshBasicMaterial);
    this.rest = {};
    for (const b of I.bones) this.rest[b.name] = b.position.clone();
    this.chains = (T.chains || []).map((ch) => {
      const bones = ch.names.map((n) => this.B[n]);
      const tail = ch.tail.clone().sub(T.def.pos(ch.names[ch.names.length - 1]));
      const cols = (ch.cols || []).map((c) => ({ obj: this.B[c.bone], off: c.off.clone().sub(T.def.pos(c.bone)), r: c.r }));
      const chn = new Chain(bones, tail, { ...(ch.opts || {}), colliders: cols });
      chn.kind = ch.kind;
      return chn;
    });
    this.vel = new V3(); this.velL = new V3(); this.acc = new V3(); this.prevPos = null; this.prevYaw = 0; this.yawRate = 0;
    this.hurtSp = new Spring(180, 12);
    this.hurtW = 0;
    this.lod = 0;
    this.p = {};
  }
  hurt() { this.hurtW = 1; this.hurtSp.v += 8; }
  // root motion: world velocity (smoothed), local velocity, yaw rate, LOD
  motion(dt) {
    const root = this.root;
    root.updateMatrixWorld();
    const e = root.matrixWorld.elements;
    _v1.set(e[12], e[13], e[14]);
    const yaw = Math.atan2(e[8], e[10]);
    if (!this.prevPos) this.prevPos = _v1.clone();
    if (_v1.distanceToSquared(this.prevPos) > 4) { this.prevPos.copy(_v1); for (const c of this.chains) c.init = false; }
    if (dt > 0) {
      _v2.subVectors(_v1, this.prevPos).multiplyScalar(1 / dt);
      if (_v2.lengthSq() > 3600) _v2.set(0, 0, 0);
      _v3.copy(this.vel);
      this.vel.lerp(_v2, 1 - Math.exp(-dt * 10));
      this.acc.lerp(_v3.subVectors(this.vel, _v3).multiplyScalar(1 / dt), 1 - Math.exp(-dt * 5));
      this.yawRate = damp(this.yawRate, wrapA(yaw - this.prevYaw) / dt, 8, dt);
    }
    this.prevPos.copy(_v1); this.prevYaw = yaw;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    this.velL.set(this.vel.x * cy - this.vel.z * sy, this.vel.y, this.vel.x * sy + this.vel.z * cy);
    const c = G.camera;
    const dist = c ? Math.hypot(c.position.x - e[12], c.position.y - e[13], c.position.z - e[14]) : 0;
    this.lod = dist < 28 ? 0 : dist < 70 ? 1 : 2;
    this.hurtSp.step(0, dt);
    this.hurtW = Math.max(0, this.hurtW - dt * 3);
  }
  // secondary chains (call after posing bones and updating matrices)
  stepChains(dt, wind, windFn) {
    const sim = this.lod === 0 && this.root.visible;
    for (let i = 0; i < this.chains.length; i++) {
      const ch = this.chains[i];
      const w = windFn ? windFn(i, ch) : wind;
      ch.step(dt, w, sim);
    }
  }
}
export const rot = (b, x, y, z) => b.rotation.set(x, y, z);

// ---------------------------------------------------------------------------
// 보름 — the west wind's fox spirit: slender, long-legged, three flowing tails
// with glowing wisps, cheek ruffs and a chest mane. Floats beside the player.
const FOX_TAILS = 3, FOX_SEG = 5;
function foxType() {
  return creatureType('fox', () => {
    const d = new SkelDef();
    d.add('hips', null, 0, 0, -0.11, [0, 0.01, 0]);
    d.add('spine', 'hips', 0, 0.01, 0, [0, 0.025, 0.12]);
    d.add('chest', 'spine', 0, 0.025, 0.12, [0, 0.07, 0.19]);
    d.add('neck', 'chest', 0, 0.07, 0.19, [0, 0.15, 0.26]);
    d.add('head', 'neck', 0, 0.15, 0.26, [0, 0.165, 0.36]);
    d.add('jaw', 'head', 0, 0.128, 0.3, [0, 0.112, 0.4]);
    for (const sd of [1, -1]) {
      const n = sd > 0 ? 'L' : 'R';
      d.add('ear' + n, 'head', sd * 0.048, 0.22, 0.255, [sd * 0.08, 0.35, 0.235]);
      d.add('eye' + n, 'head', sd * 0.037, 0.182, 0.345, [sd * 0.037, 0.2, 0.345]);
      d.add('fArm' + n, 'chest', sd * 0.055, 0.0, 0.15);
      d.add('fFore' + n, 'fArm' + n, sd * 0.058, -0.095, 0.165);
      d.add('fPaw' + n, 'fFore' + n, sd * 0.058, -0.19, 0.16, [sd * 0.058, -0.205, 0.2]);
      d.add('hThigh' + n, 'hips', sd * 0.06, 0.0, -0.13);
      d.add('hShin' + n, 'hThigh' + n, sd * 0.066, -0.085, -0.075);
      d.add('hFoot' + n, 'hShin' + n, sd * 0.066, -0.145, -0.155);
      d.add('hPaw' + n, 'hFoot' + n, sd * 0.066, -0.21, -0.135, [sd * 0.066, -0.22, -0.095]);
    }
    // tails fan out behind the hips, arcing up then back
    const chains = [];
    const tailPts = [];
    for (let i = 0; i < FOX_TAILS; i++) {
      const yaw = (i - 1) * 0.42;
      const names = [];
      let parent = 'hips';
      const pts = [];
      let p = v(0, 0.04, -0.2);
      for (let k = 0; k <= FOX_SEG; k++) {
        pts.push(p.clone());
        if (k < FOX_SEG) { const nm = `tail${i}_${k}`; d.add(nm, parent, p.x, p.y, p.z); names.push(nm); parent = nm; }
        const pitch = mix(0.95, -0.35, k / FOX_SEG) + (i === 1 ? 0.18 : 0);
        const yw = yaw * (1 + k * 0.25);
        const dir = v(Math.sin(yw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yw) * Math.cos(pitch));
        p = p.clone().addScaledVector(dir, 0.12 - k * 0.006);
      }
      tailPts.push(pts);
      chains.push({ names, tail: pts[FOX_SEG], kind: 'tail', opts: { stiff: 0.12, stiffTip: 0.05, damp: 0.1, grav: 1.0, drag: 0.7 } });
    }
    const color = { fur: 0xf2faff, cream: 0xffffff, sock: 0xa8dcee, inner: 0xbff4ff, dark: 0x1a2a3a, eye: 0x40e0ff, tip: 0x9ff4ff, lash: 0x1a2a3a };
    const group = { fur: 'fur', cream: 'fur', sock: 'fur', inner: 'inner', dark: 'dark', lash: 'dark', eye: 'glow', tip: 'glow' };
    const built = bakeType(d, (S) => {
      const BODY = ['hips', 'spine', 'chest', ['hThighL', 1.6], ['hThighR', 1.6], ['fArmL', 1.8], ['fArmR', 1.8]];
      // torso: deep chest, tucked waist, rounded haunches
      const rx = (u) => sstep(0, 0.2, u) * 0.018 + mix(0.062, 0.068, u) + 0.014 * Math.exp(-((u - 0.2) ** 2) / 0.02) + 0.01 * Math.exp(-((u - 0.78) ** 2) / 0.02);
      const rz = (u) => 0.066 + 0.022 * Math.exp(-((u - 0.78) ** 2) / 0.03) + 0.016 * Math.exp(-((u - 0.18) ** 2) / 0.02) - 0.012 * Math.exp(-((u - 0.5) ** 2) / 0.03);
      tube(S, 'fur', BODY, {
        pts: [v(0, 0.016, -0.215), v(0, 0.012, -0.11), v(0, 0.012, 0.02), v(0, 0.03, 0.13), v(0, 0.06, 0.2)], seg: 14, steps: 12, ref: v(0, 1, 0),
        r: (u) => [rx(u), rz(u)],
        off: (u) => [0, -0.01 * Math.exp(-((u - 0.78) ** 2) / 0.02)],
        shape: (u, a) => { const s = Math.sin(a); return 1 - (s < 0 ? 0.16 * s * s * Math.exp(-((u - 0.5) ** 2) / 0.04) : 0) + 0.035 * Math.pow(Math.abs(Math.sin(a * 5 + u * 30)), 3) * (s < 0 ? 1.6 : 0.6); },
        cap0: 0.9, cap1: 0.6,
      });
      // chest mane: tufted, hanging fur
      blob(S, 'cream', ['chest', ['neck', 1.3]], {
        c: v(0, 0.035, 0.2), r: [0.062, 0.078, 0.062], ws: 18, hs: 12,
        fn: (dd, p) => {
          const lon = Math.atan2(dd.x, dd.z);
          const tuft = Math.pow(Math.max(0, Math.sin(lon * 7 + dd.y * 3)), 3) * sstep(0.2, -0.6, dd.y);
          p.multiplyScalar(1 + tuft * 0.35);
          if (dd.y < 0) p.y *= 1.25;
          if (dd.z < -0.3) p.multiplyScalar(0.8);
          p.y -= tuft * 0.02;
        },
      });
      // neck
      tube(S, 'fur', ['chest', 'neck', ['head', 1.4]], { pts: [v(0, 0.04, 0.14), v(0, 0.1, 0.215), v(0, 0.155, 0.268)], seg: 12, steps: 5, ref: v(0, 0, 1), r: (u) => [mix(0.064, 0.05, u), mix(0.07, 0.056, u)], shape: (u, a) => 1 + 0.06 * Math.pow(Math.abs(Math.sin(a * 4 + u * 9)), 3) });
      // skull with cheek ruffs
      blob(S, 'fur', ['head'], {
        c: v(0, 0.168, 0.283), r: [0.07, 0.064, 0.072], ws: 20, hs: 14,
        fn: (dd, p) => {
          const ch = Math.exp(-((Math.abs(dd.x) - 0.8) ** 2 / 0.05 + (dd.y + 0.35) ** 2 / 0.06)) * sstep(-0.6, 0.2, dd.z);
          p.x *= 1 + ch * 0.55; p.y -= ch * 0.012; p.z -= ch * 0.02;
          if (dd.y > 0.3) p.y *= 0.92;
          if (dd.z > 0.5) p.z *= 0.95;
        },
      });
      // cream cheeks / throat
      blob(S, 'cream', ['head', ['jaw', 0.7]], { c: v(0, 0.14, 0.3), r: [0.06, 0.035, 0.05], ws: 14, hs: 8, fn: (dd, p) => { if (dd.y > 0.2) p.y *= 0.6; } });
      // muzzle (upper), long and fine
      tube(S, 'fur', ['head'], { pts: [v(0, 0.168, 0.3), v(0, 0.158, 0.35), v(0, 0.146, 0.4), v(0, 0.14, 0.418)], seg: 12, steps: 7, ref: v(0, 1, 0), r: (u) => [mix(0.042, 0.015, Math.pow(u, 0.9)), mix(0.036, 0.013, Math.pow(u, 0.9))], shape: (u, a) => (Math.sin(a) > 0 ? 1 - 0.12 * Math.sin(a) : 1), cap1: 0.8 });
      // lower jaw
      tube(S, 'cream', ['jaw'], { pts: [v(0, 0.13, 0.3), v(0, 0.124, 0.35), v(0, 0.13, 0.4)], seg: 10, steps: 5, ref: v(0, 1, 0), r: (u) => [mix(0.032, 0.011, u), mix(0.018, 0.008, u)], cap1: 0.8 });
      blob(S, 'dark', ['head'], { c: v(0, 0.142, 0.419), r: [0.014, 0.011, 0.01], ws: 10, hs: 6 });
      // eyes: glowing almonds with dark lash lines (eye bones blink)
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R';
        blob(S, 'eye', ['eye' + n], { c: v(sd * 0.037, 0.182, 0.343), r: [0.021, 0.013, 0.01], ws: 12, hs: 8, fn: (dd, p) => { p.y += p.x * sd * 0.22; if (dd.y > 0) p.y *= 1.15; } });
        blob(S, 'dark', ['eye' + n], { c: v(sd * 0.035, 0.182, 0.351), r: [0.0065, 0.0105, 0.004], ws: 8, hs: 6 });
        tube(S, 'lash', ['eye' + n], { pts: [v(sd * 0.017, 0.184, 0.35), v(sd * 0.029, 0.1945, 0.352), v(sd * 0.045, 0.1975, 0.35), v(sd * 0.061, 0.193, 0.342)], seg: 5, steps: 6, ref: v(0, 0, 1), r: (u) => [0.0018 * (0.4 + u), 0.0018], cap0: 1, cap1: 1 });
        // tall ears (outer + glowing inner)
        const b0 = v(sd * 0.048, 0.215, 0.258), tip = v(sd * 0.085, 0.355, 0.232);
        tube(S, 'fur', ['ear' + n, ['head', 2]], { pts: [b0, b0.clone().lerp(tip, 0.5).add(v(sd * 0.006, 0, -0.004)), tip], seg: 10, steps: 6, ref: v(0, 0, 1), r: (u) => [0.036 * Math.pow(1 - u, 0.85) + 0.001, 0.014 * (1 - u) + 0.001], shape: (u, a) => (Math.sin(a) > 0 ? 0.55 : 1), cap1: 0.4 });
        tube(S, 'inner', ['ear' + n], { pts: [b0.clone().add(v(0, 0.012, 0.009)), tip.clone().lerp(b0, 0.18).add(v(0, 0, 0.004))], seg: 8, steps: 5, ref: v(0, 0, 1), r: (u) => [0.024 * Math.pow(1 - u, 0.9) + 0.001, 0.004], cap1: 0.4 });
        // front leg: upper (fur) + lower (sock) + paw
        const fa = v(sd * 0.056, 0.03, 0.15), fe = v(sd * 0.058, -0.095, 0.165), fp = v(sd * 0.058, -0.19, 0.16);
        tube(S, 'fur', ['chest', 'fArm' + n, 'fFore' + n], { pts: [fa, fa.clone().lerp(fe, 0.5).add(v(0, 0, 0.01)), fe], seg: 10, steps: 6, ref: v(0, 0, 1), r: (u) => [mix(0.04, 0.022, u), mix(0.05, 0.025, u)], cap0: 0.8 });
        tube(S, 'sock', ['fFore' + n, 'fPaw' + n], { pts: [fe.clone().add(v(0, 0.015, 0)), fe.clone().lerp(fp, 0.5), fp], seg: 8, steps: 5, ref: v(0, 0, 1), r: (u) => [mix(0.021, 0.017, u), mix(0.023, 0.018, u)] });
        blob(S, 'sock', ['fPaw' + n], { c: fp.clone().add(v(0, -0.01, 0.018)), r: [0.021, 0.014, 0.03], ws: 10, hs: 6 });
        // hind leg: haunch -> hock -> paw
        const ht = v(sd * 0.06, 0.02, -0.12), hk = v(sd * 0.066, -0.085, -0.075), hh = v(sd * 0.066, -0.145, -0.155), hp = v(sd * 0.066, -0.21, -0.135);
        tube(S, 'fur', [['hips', 1.2], 'hThigh' + n, 'hShin' + n], { pts: [ht.clone().add(v(0, 0.03, -0.02)), ht, ht.clone().lerp(hk, 0.6), hk], seg: 10, steps: 7, ref: v(0, 0, 1), r: (u) => [mix(0.055, 0.026, sstep(0.1, 1, u)), mix(0.068, 0.03, sstep(0.1, 1, u))], cap0: 0.9 });
        tube(S, 'sock', ['hShin' + n, 'hFoot' + n, 'hPaw' + n], { pts: [hk, hk.clone().lerp(hh, 0.5), hh, hp], seg: 8, steps: 7, ref: v(0, 0, 1), r: (u) => [mix(0.024, 0.017, u), mix(0.026, 0.018, u)] });
        blob(S, 'sock', ['hPaw' + n], { c: hp.clone().add(v(0, -0.008, 0.02)), r: [0.021, 0.014, 0.029], ws: 10, hs: 6 });
      }
      // tails: bushy brushes with glowing wisp tips
      tailPts.forEach((pts, i) => {
        const W = ['hips', ...chains[i].names];
        const curve = new THREE.CatmullRomCurve3(pts);
        const R = (u) => 0.012 + 0.07 * Math.sin(Math.pow(Math.min(1, u), 0.72) * Math.PI);
        const fur = (u, a) => 1 + 0.1 * Math.pow(Math.abs(Math.sin(a * 4 + u * 21)), 2) * sstep(0.1, 0.35, u) - 0.05;
        const cut = 0.64;
        const sub = (a0, a1, n) => { const o = []; for (let k = 0; k <= n; k++) o.push(curve.getPointAt(mix(a0, a1, k / n))); return new THREE.CatmullRomCurve3(o); };
        tube(S, 'fur', W, { curve: sub(0, cut + 0.02, 12), seg: 12, steps: 14, ref: v(0, 1, 0), r: (u) => { const r = R(u * (cut + 0.02)); return [r, r * 0.88]; }, shape: (u, a) => fur(u * cut, a), cap0: 0.8 });
        const end = pts[FOX_SEG].clone().add(curve.getTangentAt(1).multiplyScalar(0.07));
        const tc = sub(cut, 1, 8); const tp = tc.points; tp.push(end);
        tube(S, 'tip', chains[i].names.slice(-3), { curve: new THREE.CatmullRomCurve3(tp), seg: 12, steps: 10, ref: v(0, 1, 0), r: (u) => { const uu = mix(cut, 1.08, u); const r = (R(Math.min(1, uu)) + 0.004) * (uu > 1 ? 0 : 1) + 0.002; return [r * 1.02, r * 0.9]; }, shape: (u, a) => 1 + 0.14 * Math.sin(a * 5 + u * 17) * u, cap1: 1 });
      });
    }, color, group);
    return { def: d, built, chains };
  });
}

class FoxRig extends CreatureRig {
  constructor() {
    const T = foxType();
    const M = {
      fur: bodyMat(0xffffff, { vertexColors: true, emissive: 0x2a7a8c, emissiveIntensity: 0.55, rim: 1.1 }),
      inner: bodyMat(0xbff4ff, { emissive: 0x6ad8e8, emissiveIntensity: 0.9, rim: 1 }),
      dark: bodyMat(0x1a2a3a, { rim: 0.4 }),
      glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2), vertexColors: true }),
    };
    super(T, M, { main: 'fur' });
    const B = this.B;
    this.p = { head: B.head, torso: B.chest, hips: B.hips };
    const aura = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), fresnelMat(0x000000, 0x7ae8ff, { intensity: 0.28, power: 3 }));
    aura.position.set(0, 0.03, 0);
    this.body.add(aura); this.aura = aura;
    this.blinkT = 2; this.blink = 0;
    this.earSp = [new Spring(140, 9), new Spring(140, 9)]; this.earT = 2;
    this.jaw = 0; this.talkN = 0; this.talkTo = 0;
    this.tilt = 0; this.tiltT = 0; this.tiltTo = 0;
    this.glanceT = 3; this.glance = 0; this.glanceTo = 0;
    this.lean = new V3();
    this.wind = new V3();
    this.t = rand() * 10;
  }
  update(dt, s = {}) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.t += dt;
    const t = this.t, B = this.B;
    this.motion(dt);
    const vl = this.velL;
    const spd = Math.hypot(vl.x, vl.z);
    const fly = sstep(0.4, 5, spd);          // 0 hover .. 1 dashing through the air
    // body attitude: nose into motion, bank into turns, rise/fall pitch
    this.lean.x = damp(this.lean.x, clamp(vl.z * 0.05 - vl.y * 0.06, -0.35, 0.35), 4, dt);
    this.lean.z = damp(this.lean.z, clamp(-this.yawRate * 0.12 - vl.x * 0.04, -0.4, 0.4), 4, dt);
    const bob = Math.sin(t * 2.2);
    this.body.position.y = bob * 0.06;
    rot(B.hips, this.lean.x * 0.6 + Math.sin(t * 2.2 - 0.6) * 0.04, 0, this.lean.z + Math.sin(t * 1.3) * 0.05);
    rot(B.spine, Math.sin(t * 2.2 - 1.2) * 0.05 + fly * 0.08, Math.sin(t * 1.1) * 0.04, 0);
    rot(B.chest, -Math.sin(t * 2.2 - 1.8) * 0.05 + this.lean.x * 0.3, -Math.sin(t * 1.1) * 0.04, 0);
    // head: look target, idle glances and curious tilts, talk nods
    this.glanceT -= dt;
    if (this.glanceT <= 0) { this.glanceT = 2.5 + rand() * 4; this.glanceTo = rand() < 0.5 ? (rand() - 0.5) * 1.2 : 0; this.tiltTo = rand() < 0.35 ? (rand() - 0.5) * 0.7 : 0; }
    this.glance = damp(this.glance, this.glanceTo, 3, dt);
    this.tilt = damp(this.tilt, this.tiltTo, 4, dt);
    const look = clamp((s.lookYaw ?? 0) + this.glance * (s.talk ? 0.2 : 1), -1.2, 1.2);
    // jaw: syllable flaps while talking
    if (s.talk) { this.talkN -= dt; if (this.talkN <= 0) { this.talkN = 0.08 + rand() * 0.1; this.talkTo = rand() < 0.25 ? 0 : 0.15 + rand() * 0.3; } }
    else this.talkTo = 0;
    this.jaw = damp(this.jaw, this.talkTo, 20, dt);
    const nod = s.talk ? Math.sin(t * 5.2) * 0.06 : 0;
    rot(B.neck, -0.12 - this.lean.x * 0.5 + Math.sin(t * 2.2 - 2.2) * 0.04 - fly * 0.12, look * 0.45, this.tilt * 0.3);
    rot(B.head, 0.05 + nod + Math.sin(t * 1.7) * 0.04 - fly * 0.1, look * 0.55, this.tilt * 0.7 - this.lean.z * 0.3);
    rot(B.jaw, this.jaw, 0, 0);
    // ears: back in fast flight, perk while talking, random twitches
    this.earT -= dt;
    if (this.earT <= 0) { this.earT = 1.5 + rand() * 3.5; this.earSp[rand() < 0.5 ? 0 : 1].v += 14 + rand() * 10; }
    for (let k = 0; k < 2; k++) {
      const sd = k ? -1 : 1, ear = k ? B.earR : B.earL;
      const tw = this.earSp[k].step(0, dt);
      rot(ear, -fly * 0.7 + (s.talk ? 0.15 : 0) + tw * 0.04 + Math.sin(t * 3 + k) * 0.03, sd * (tw * 0.05), sd * (-0.1 - fly * 0.3 + this.hurtSp.x * 0.05));
    }
    // blink
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 1; this.blinkT = 2 + rand() * 4; }
    this.blink = Math.max(0, this.blink - dt / 0.15);
    const bl = this.blink > 0 ? 1 - Math.sin(this.blink * Math.PI) * 0.9 : 1;
    B.eyeL.scale.set(1, bl, 1); B.eyeR.scale.set(1, bl, 1);
    // legs: idle air-treading, stretched leap pose when flying fast
    const tr = t * 2.6;
    for (let k = 0; k < 2; k++) {
      const n = k ? 'R' : 'L', ph = k ? Math.PI : 0;
      const a = Math.sin(tr + ph), b = Math.cos(tr + ph);
      rot(B['fArm' + n], mix(0.25 + a * 0.22, -0.9, fly), 0, 0);
      rot(B['fFore' + n], mix(-0.35 - Math.max(0, b) * 0.5, -0.3, fly), 0, 0);
      rot(B['fPaw' + n], mix(0.5 + Math.max(0, -b) * 0.3, 0.9, fly), 0, 0);
      rot(B['hThigh' + n], mix(0.1 - a * 0.2, 0.9, fly), 0, 0);
      rot(B['hShin' + n], mix(0.25 + Math.max(0, b) * 0.3, 0.2, fly), 0, 0);
      rot(B['hFoot' + n], mix(-0.2, 0.5, fly), 0, 0);
      rot(B['hPaw' + n], mix(0.45, 0.8, fly), 0, 0);
    }
    // hit flinch
    const hk = this.hurtSp.x * 0.06;
    B.spine.rotation.x -= hk; B.neck.rotation.x -= hk * 2;
    // tails: swaying base pose + verlet lag against flight / flowing breeze
    for (let i = 0; i < this.chains.length; i++) {
      const ch = this.chains[i];
      for (let k = 0; k < ch.base.length; k++) {
        const w = Math.sin(t * 1.9 - k * 0.7 + i * 2.1) * 0.16 * (0.4 + k * 0.3) * (1 - fly * 0.6);
        _e.set(Math.sin(t * 1.4 - k * 0.6 + i) * 0.08 + fly * 0.12, w, 0);
        ch.base[k].setFromEuler(_e);
      }
    }
    this.root.updateMatrixWorld(true);
    this.stepChains(dt, null, (i) => this.wind.set(-this.vel.x + Math.sin(t * 2.3 + i * 2) * 1.5, -this.vel.y * 0.5 + 0.8, -this.vel.z + Math.cos(t * 1.7 + i) * 1.5));
    this.aura.scale.setScalar(1 + Math.sin(t * 3.1) * 0.03);
  }
}
const _e = new THREE.Euler();
export function makeFox() { return new FoxRig(); }

// ---------------------------------------------------------------------------
// 누룽지 — Dodam's orange tabby. Sculpted sitting (it only ever sits: on the
// island, by the house, on the player's shoulder); idles with breathing, ear
// flicks, a swishing tail, look-arounds, slow blinks, grooming and meows.
const CAT_SEG = 5;
function catType() {
  return creatureType('cat', () => {
    const d = new SkelDef();
    d.add('hips', null, 0, 0.07, -0.04, [0, 0.16, -0.01]);
    d.add('chest', 'hips', 0, 0.16, -0.01, [0, 0.24, 0.03]);
    d.add('neck', 'chest', 0, 0.235, 0.03, [0, 0.285, 0.05]);
    d.add('head', 'neck', 0, 0.285, 0.05, [0, 0.37, 0.06]);
    d.add('jaw', 'head', 0, 0.272, 0.1, [0, 0.262, 0.125]);
    for (const sd of [1, -1]) {
      const n = sd > 0 ? 'L' : 'R';
      d.add('ear' + n, 'head', sd * 0.042, 0.345, 0.05, [sd * 0.058, 0.395, 0.045]);
      d.add('eye' + n, 'head', sd * 0.03, 0.306, 0.114, [sd * 0.03, 0.32, 0.114]);
      d.add('fLeg' + n, 'chest', sd * 0.036, 0.17, 0.055);
      d.add('fPaw' + n, 'fLeg' + n, sd * 0.036, 0.03, 0.07, [sd * 0.036, 0.012, 0.1]);
      d.add('hLeg' + n, 'hips', sd * 0.058, 0.07, -0.04, [sd * 0.055, 0.02, 0.04]);
    }
    const names = []; let parent = 'hips';
    const TP = [v(0, 0.035, -0.11), v(0.035, 0.022, -0.19), v(0.11, 0.018, -0.2), v(0.165, 0.018, -0.13), v(0.185, 0.02, -0.04), v(0.165, 0.028, 0.045)];
    for (let k = 0; k < CAT_SEG; k++) { const nm = 'tail' + k; d.add(nm, parent, TP[k].x, TP[k].y, TP[k].z); names.push(nm); parent = nm; }
    const chains = [{ names, tail: TP[CAT_SEG], kind: 'tail', opts: { stiff: 0.2, stiffTip: 0.1, damp: 0.12, grav: 0.5, drag: 0.2 } }];
    const color = { fur: 0xffffff, cream: 0xfff0d8, pink: 0xf09a9a, eye: 0xb8e060, pupil: 0x141008, white: 0xffffff, whisker: 0xf8f4ec };
    const group = { fur: 'fur', cream: 'main', pink: 'main', eye: 'main', pupil: 'main', white: 'main', whisker: 'main' };
    const built = bakeType(d, (S) => {
      // pear-shaped sitting body: wide haunches, upright chest
      blob(S, 'fur', [['hips', 1], ['chest', 1], ['hLegL', 1.6], ['hLegR', 1.6]], {
        c: v(0, 0.125, -0.025), r: [0.078, 0.118, 0.085], ws: 20, hs: 14,
        fn: (dd, p) => {
          if (dd.y < 0.1) { const k = sstep(0.1, -0.8, dd.y); p.x *= 1 + 0.3 * k; p.z *= 1 + 0.18 * k; }
          if (dd.y > 0.3) { p.z += (dd.y - 0.3) * 0.04; p.x *= 1 - 0.18 * (dd.y - 0.3); }
          if (dd.y < -0.85) p.y *= 0.9;
          if (dd.z > 0.3) p.z *= 1 + 0.08 * sstep(0.6, -0.2, dd.y);
        },
      });
      // chest bib
      blob(S, 'cream', ['chest', ['neck', 1.4]], { c: v(0, 0.19, 0.045), r: [0.046, 0.062, 0.03], ws: 14, hs: 10, fn: (dd, p) => { const lon = Math.atan2(dd.x, dd.z); p.multiplyScalar(1 + 0.12 * Math.pow(Math.max(0, Math.sin(lon * 6 + dd.y * 4)), 3) * sstep(0, -0.8, dd.y)); } });
      // neck ruff
      tube(S, 'fur', ['chest', 'neck', ['head', 1.4]], { pts: [v(0, 0.2, 0.0), v(0, 0.25, 0.035), v(0, 0.29, 0.055)], seg: 12, steps: 4, ref: v(0, 0, 1), r: (u) => [mix(0.058, 0.05, u), mix(0.056, 0.05, u)] });
      // head: round skull, broad cheeks
      blob(S, 'fur', ['head'], {
        c: v(0, 0.3, 0.06), r: [0.07, 0.061, 0.064], ws: 20, hs: 14,
        fn: (dd, p) => {
          const ch = sstep(0.1, -0.5, dd.y) * sstep(0.3, 0.9, Math.abs(dd.x));
          p.x *= 1 + 0.16 * ch; p.y -= ch * 0.006;
          if (dd.z > 0.4) p.z *= 1 - 0.1 * (dd.z - 0.4);
          if (dd.y > 0.5) p.y *= 0.95;
        },
      });
      // muzzle pads, chin, nose
      for (const sd of [1, -1]) blob(S, 'cream', ['head'], { c: v(sd * 0.016, 0.279, 0.113), r: [0.02, 0.016, 0.015], ws: 10, hs: 8 });
      blob(S, 'cream', ['jaw'], { c: v(0, 0.265, 0.108), r: [0.017, 0.011, 0.013], ws: 10, hs: 6 });
      blob(S, 'pink', ['head'], { c: v(0, 0.291, 0.126), r: [0.0095, 0.0065, 0.006], ws: 8, hs: 6, fn: (dd, p) => { if (dd.y < 0) p.x *= 1 + dd.y * 0.6; } });
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R';
        // eyes: green almonds, slit pupils, highlight
        blob(S, 'eye', ['eye' + n], { c: v(sd * 0.03, 0.306, 0.114), r: [0.017, 0.0135, 0.009], ws: 12, hs: 8, fn: (dd, p) => { p.y += p.x * sd * 0.18; } });
        blob(S, 'pupil', ['eye' + n], { c: v(sd * 0.03, 0.306, 0.1225), r: [0.0045, 0.0115, 0.0025], ws: 8, hs: 6 });
        blob(S, 'white', ['eye' + n], { c: v(sd * 0.034, 0.311, 0.1236), r: [0.0028, 0.0028, 0.0015], ws: 6, hs: 4 });
        // ears: wide triangles with pink insides
        const b0 = v(sd * 0.04, 0.338, 0.052), tip = v(sd * 0.062, 0.4, 0.042);
        tube(S, 'fur', ['ear' + n, ['head', 2]], { pts: [b0, b0.clone().lerp(tip, 0.5), tip], seg: 10, steps: 5, ref: v(0, 0, 1), r: (u) => [0.03 * Math.pow(1 - u, 0.9) + 0.001, 0.011 * (1 - u) + 0.001], shape: (u, a) => (Math.sin(a) > 0 ? 0.55 : 1), cap1: 0.4 });
        tube(S, 'pink', ['ear' + n], { pts: [b0.clone().add(v(0, 0.01, 0.007)), tip.clone().lerp(b0, 0.2).add(v(0, 0, 0.004))], seg: 8, steps: 4, ref: v(0, 0, 1), r: (u) => [0.019 * Math.pow(1 - u, 0.9) + 0.001, 0.003], cap1: 0.4 });
        // whiskers
        for (let k = 0; k < 3; k++) {
          const r0 = v(sd * 0.03, 0.28 - k * 0.005, 0.118);
          tube(S, 'whisker', ['head'], { pts: [r0, r0.clone().add(v(sd * 0.04, 0.004 - k * 0.008, -0.004)), r0.clone().add(v(sd * 0.075, 0.002 - k * 0.018, -0.014))], seg: 3, steps: 3, ref: v(0, 1, 0), r: (u) => 0.0012 * (1 - u * 0.7), ol: 0 });
        }
        // front legs (orange with cream socks) and paws
        const top = v(sd * 0.036, 0.17, 0.05), pw = v(sd * 0.036, 0.028, 0.072);
        tube(S, 'fur', ['chest', 'fLeg' + n], { pts: [top, top.clone().lerp(pw, 0.5), pw.clone().lerp(top, 0.3)], seg: 10, steps: 5, ref: v(0, 0, 1), r: (u) => [mix(0.026, 0.017, u), mix(0.03, 0.018, u)], cap0: 0.8 });
        tube(S, 'cream', ['fLeg' + n, ['fPaw' + n, 1.4]], { pts: [pw.clone().lerp(top, 0.34), pw.clone().lerp(top, 0.15), pw], seg: 10, steps: 3, ref: v(0, 0, 1), r: (u) => [0.0178, 0.0188] });
        blob(S, 'cream', ['fPaw' + n], { c: pw.clone().add(v(0, -0.013, 0.012)), r: [0.019, 0.013, 0.025], ws: 10, hs: 6 });
        // haunches + hind paws
        blob(S, 'fur', ['hLeg' + n, ['hips', 1.3]], { c: v(sd * 0.064, 0.068, -0.02), r: [0.045, 0.06, 0.072], ws: 14, hs: 10, fn: (dd, p) => { if (dd.y < -0.5) p.y *= 0.8; } });
        blob(S, 'cream', ['hLeg' + n], { c: v(sd * 0.058, 0.013, 0.055), r: [0.021, 0.013, 0.036], ws: 10, hs: 6 });
      }
      // tail
      const curve = new THREE.CatmullRomCurve3(TP);
      tube(S, 'fur', ['hips', ...names], { curve, seg: 10, steps: 16, ref: v(0, 1, 0), r: (u) => { const r = mix(0.021, 0.017, u); return [r, r]; }, cap1: 1, cap0: 0.6 });
    }, color, group);
    return { def: d, built, chains };
  });
}

class CatRig extends CreatureRig {
  constructor() {
    const T = catType();
    const M = {
      fur: stripeMat(0xe8913a, 0xa8521c, { freq: 38, width: 0.34 }),
      main: bodyMat(0xffffff, { vertexColors: true, rim: 0.4 }),
    };
    super(T, M, { main: 'fur', outline: 0.006 });
    const B = this.B;
    this.p = { head: B.head, torso: B.chest, hips: B.hips };
    this.t = rand() * 10;
    this.look = { y: 0, x: 0, ty: 0, tx: 0, T: 1 };
    this.blinkT = 2; this.blink = 0; this.slow = false;
    this.earSp = [new Spring(160, 10), new Spring(160, 10)]; this.earT = 1.5;
    this.act = null; this.actT = 0; this.nextAct = 4 + rand() * 4;
  }
  update(dt, s = {}) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.t += dt;
    const t = this.t, B = this.B;
    this.motion(dt);
    // idle actions: meow / groom / look
    this.nextAct -= dt;
    if (!this.act && this.nextAct <= 0) { this.act = rand() < 0.45 ? 'meow' : rand() < 0.6 ? 'groom' : 'stretch'; this.actT = 0; }
    let meow = 0, groom = 0, stretch = 0;
    if (this.act) {
      this.actT += dt;
      const a = this.actT;
      if (this.act === 'meow') { meow = sstep(0, 0.2, a) * sstep(1.0, 0.7, a); if (a > 1.1) this.act = null; }
      else if (this.act === 'groom') { groom = sstep(0, 0.5, a) * sstep(3.2, 2.7, a); if (a > 3.3) this.act = null; }
      else { stretch = Math.sin(Math.min(1, a / 1.8) * Math.PI); if (a > 1.8) this.act = null; }
      if (!this.act) this.nextAct = 5 + rand() * 7;
    }
    // looking around
    const L = this.look;
    L.T -= dt;
    if (L.T <= 0) { L.T = 1.5 + rand() * 3; L.ty = (rand() - 0.5) * 1.4; L.tx = (rand() - 0.5) * 0.4; }
    L.y = damp(L.y, L.ty * (1 - groom), 5, dt); L.x = damp(L.x, L.tx, 5, dt);
    const br = Math.sin(t * 2.4);
    rot(B.hips, 0, Math.sin(t * 0.4) * 0.03, 0);
    rot(B.chest, br * 0.02 - stretch * 0.25 + groom * 0.1, L.y * 0.15, groom * 0.08);
    B.chest.scale.set(1 + br * 0.012, 1, 1 + br * 0.015);
    rot(B.neck, -meow * 0.3 + groom * 0.35 + stretch * 0.2, L.y * 0.35 - groom * 0.25, 0);
    rot(B.head, L.x - meow * 0.25 + groom * 0.5 + stretch * 0.15 + Math.sin(t * 1.3) * 0.03, L.y * 0.5 - groom * 0.35, Math.sin(t * 0.7) * 0.06 + groom * 0.25);
    const lick = groom * (0.1 + 0.1 * Math.max(0, Math.sin(t * 9)));
    rot(B.jaw, meow * 0.4 + lick, 0, 0);
    // groom: right paw raised to the mouth; stretch: both paws knead forward
    rot(B.fLegR, -groom * 1.7 - stretch * 0.5, groom * 0.2, groom * 0.35);
    rot(B.fPawR, groom * (1.6 + Math.sin(t * 9) * 0.15), 0, 0);
    rot(B.fLegL, -stretch * 0.5, 0, 0);
    rot(B.fPawL, stretch * 0.4, 0, 0);
    // ears
    this.earT -= dt;
    if (this.earT <= 0) { this.earT = 1 + rand() * 3; this.earSp[rand() < 0.5 ? 0 : 1].v += 16 + rand() * 12; }
    for (let k = 0; k < 2; k++) {
      const sd = k ? -1 : 1, ear = k ? B.earR : B.earL;
      const tw = this.earSp[k].step(0, dt);
      rot(ear, meow * 0.2 + tw * 0.03, sd * tw * 0.06, -sd * (groom * 0.3 + tw * 0.02));
    }
    // blink (sometimes a slow, content blink)
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.slow = rand() < 0.3; this.blink = 1; this.blinkT = 2 + rand() * 4; }
    this.blink = Math.max(0, this.blink - dt / (this.slow ? 0.9 : 0.14));
    const eyeK = this.blink > 0 ? 1 - Math.sin(this.blink * Math.PI) * 0.92 : 1;
    const half = groom > 0.5 ? 0.35 : 1;
    B.eyeL.scale.set(1, eyeK * half, 1); B.eyeR.scale.set(1, eyeK * half, 1);
    // tail: slow swish with a flicking tip
    const ch = this.chains[0];
    if (ch) {
      for (let k = 0; k < ch.base.length; k++) {
        const w = Math.sin(t * 1.3 - k * 0.8) * 0.12 * (0.3 + k * 0.35) + (k === ch.base.length - 1 ? Math.sin(t * 4.1) * 0.25 : 0);
        _e.set(k > 1 ? Math.max(0, Math.sin(t * 0.9 - k)) * -0.15 : 0, w, 0);
        ch.base[k].setFromEuler(_e);
      }
    }
    this.root.updateMatrixWorld(true);
    this.stepChains(dt, null);
  }
}
export function makeCat() { return new CatRig(); }
