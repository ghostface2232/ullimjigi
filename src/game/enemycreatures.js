// Non-humanoid enemy bodies on the creature rig: 울음탈 (wailer), 잿물 (ooze),
// 재나방 (moth), 뿌리손 (root hand) and 망루지기 (watcher). Sculpted, skinned,
// with procedural animation and verlet secondary motion.
import * as THREE from 'three';
import { damp, clamp, rand } from '../core/util.js';
import { SkelDef, tube, blob, sheet, addGeo, sstep, mix, TAU, bodyMat, vnoise3, zAt, Spring } from './charkit.js';
import { CreatureRig, creatureType, bakeType, glowBasic, glowTwin, rot } from './creatures.js';

const V3 = THREE.Vector3;
const v = (x, y, z) => new V3(x, y, z);
const _e = new THREE.Euler();
const _w = new V3();

// ===========================================================================
// 울음탈 — the wailing mask: a cracked, weeping bone mask over a hooded void,
// a torn crown of cloth and six long streamers that trail as it drifts.
const WAIL_STRIPS = 6, WAIL_SEG = 4;
function wailerType() {
  return creatureType('wailer', () => {
    const d = new SkelDef();
    d.add('body', null, 0, 0, 0, [0, 0.1, 0]);
    d.add('mask', 'body', 0, 0.05, 0.1, [0, 0.3, 0.12]);
    d.add('jaw', 'mask', 0, -0.12, 0.28, [0, -0.3, 0.3]);
    d.add('core', 'body', 0, -0.2, 0, [0, -0.1, 0]);
    const chains = [];
    const strips = [];
    for (let i = 0; i < WAIL_STRIPS; i++) {
      const a = (i / WAIL_STRIPS) * TAU + 0.26;
      const x = Math.sin(a) * 0.26, z = Math.cos(a) * 0.2 - 0.06;
      const names = []; let parent = 'body';
      const len = 1.0 + (i % 3) * 0.14;
      for (let k = 0; k < WAIL_SEG; k++) { const nm = `st${i}_${k}`; d.add(nm, parent, x * (1 + k * 0.12), -0.12 - (k * len) / WAIL_SEG, z * (1 + k * 0.12)); names.push(nm); parent = nm; }
      const tail = v(x * (1 + WAIL_SEG * 0.12), -0.12 - len, z * (1 + WAIL_SEG * 0.12));
      chains.push({ names, tail, kind: 'strip', opts: { stiff: 0.07, stiffTip: 0.02, damp: 0.08, grav: 3, drag: 1.1 } });
      strips.push({ a, names, tail, len });
    }
    const color = { mask: 0xe8e0d0, crack: 0x8a8070, hole: 0x0a0610, cloth: 0x2e2838, clothD: 0x1e1a26, glow: 0xffffff };
    const group = { mask: 'mask', crack: 'mask', hole: 'mask', cloth: 'cloth', clothD: 'cloth', glow: 'glow' };
    const built = bakeType(d, (S) => {
      // hooded void behind the mask
      blob(S, 'clothD', ['body', ['mask', 1.4]], { c: v(0, 0.0, -0.06), r: [0.38, 0.42, 0.32], ws: 18, hs: 12, fn: (dd, p) => { if (dd.y < -0.3) { p.x *= 0.85; p.z *= 0.85; } p.multiplyScalar(1 + 0.05 * Math.sin(Math.atan2(dd.x, dd.z) * 7 + dd.y * 4)); } });
      // ragged shroud under the hood
      sheet(S, 'cloth', ['body', ...strips.map((st) => [st.names[0], 1.6])], {
        nu: 30, nv: 4, wrap: true, thick: 0.012,
        fn: (u, vv, out) => { const a = u * TAU; const rag = 0.12 * Math.abs(Math.sin(u * 23)) + 0.08 * Math.abs(Math.sin(u * 9 + 1)); const y = mix(-0.08, -0.52 + rag, vv); const r = mix(0.27, 0.36, vv) * (1 + 0.05 * Math.sin(a * 7)); out.set(Math.sin(a) * r, y, Math.cos(a) * r * 0.85 - 0.04); },
        inside: (p) => v(0, p.y, -0.04),
      });
      // torn cloth crown fanning behind the mask
      for (let k = 0; k < 9; k++) {
        const a = mix(-1.35, 1.35, k / 8);
        const b0 = v(Math.sin(a) * 0.26, 0.2 + Math.cos(a) * 0.1, -0.02 + Math.cos(a) * 0.02);
        const len = 0.3 + 0.12 * Math.cos(a * 2) + ((k * 7) % 3) * 0.04;
        const dir = v(Math.sin(a) * 1.1, Math.cos(a) * 0.9 + 0.2, -0.45).normalize();
        tube(S, 'cloth', ['body'], { pts: [b0, b0.clone().addScaledVector(dir, len * 0.5).add(v(0, 0.02, 0)), b0.clone().addScaledVector(dir, len)], seg: 5, steps: 5, ref: v(0, 0, 1), r: (u) => [0.06 * (1 - u) + 0.004, 0.012 * (1 - u) + 0.002], cap1: 0.5 });
      }
      // the mask: thick oval shell, sad carved features
      const mk = blob(S, 'mask', ['mask'], {
        c: v(0, 0.05, 0.12), r: [0.3, 0.38, 0.22], ws: 24, hs: 16, skip: (dd) => dd.z < -0.05,
        fn: (dd, p) => {
          p.z += 0.06 * (1 - dd.x * dd.x) * sstep(-1, 0.2, dd.y);
          const cheek = Math.exp(-((Math.abs(dd.x) - 0.55) ** 2 / 0.03 + (dd.y + 0.15) ** 2 / 0.03));
          p.z += cheek * 0.025;
          const brow = Math.exp(-((dd.y - 0.35) ** 2) / 0.01) * sstep(0.7, 0.1, Math.abs(dd.x));
          p.z += brow * 0.02;
          if (dd.y < -0.5) p.x *= 1 - 0.25 * (-dd.y - 0.5);
        },
      }).part;
      const on = (x, y, dz = 0) => v(x, y, zAt(mk, x, y) + dz);
      // eye holes (inner corners raised: grief), glowing pupils, tear streaks, down-turned mouth
      for (const sd of [1, -1]) {
        blob(S, 'hole', ['mask'], { c: on(sd * 0.11, 0.1, -0.012), r: [0.075, 0.1, 0.02], ws: 12, hs: 8, fn: (dd, p) => { p.y -= p.x * sd * 0.5; } });
        blob(S, 'glow', ['mask'], { c: on(sd * 0.105, 0.085, 0.004), r: [0.028, 0.034, 0.01], ws: 8, hs: 6 });
        tube(S, 'crack', ['mask'], { pts: [on(sd * 0.12, 0.0, 0.002), on(sd * 0.125, -0.1, 0.002), on(sd * 0.115, -0.2, 0.002), on(sd * 0.12, -0.28, 0.0)], seg: 5, steps: 8, ref: v(0, 0, 1), r: (u) => [0.013 * (1 - u * 0.5), 0.004], cap1: 1 });
      }
      tube(S, 'hole', ['jaw', ['mask', 1.2]], { pts: [on(-0.1, -0.2, -0.006), on(-0.05, -0.15, -0.006), on(0, -0.14, -0.006), on(0.05, -0.15, -0.006), on(0.1, -0.2, -0.006)], seg: 8, steps: 12, ref: v(0, 1, 0), r: (u) => [0.012 + 0.03 * Math.sin(u * Math.PI), 0.018], cap0: 1, cap1: 1 });
      // hairline cracks across the mask
      tube(S, 'crack', ['mask'], { pts: [on(0.06, 0.4, 0), on(0.03, 0.32, 0.002), on(0.07, 0.25, 0.002), on(0.04, 0.2, 0.002)], seg: 4, steps: 6, ref: v(0, 0, 1), r: [0.005, 0.003] });
      // glowing core beneath
      blob(S, 'glow', ['core'], { c: v(0, -0.2, 0), r: [0.11, 0.11, 0.11], ws: 12, hs: 8 });
      // streamers
      for (const st of strips) {
        const P = [...st.names.map((n) => d.pos(n)), st.tail];
        const curve = new THREE.CatmullRomCurve3(P);
        const nrm = v(Math.sin(st.a), 0, Math.cos(st.a));
        tube(S, 'cloth', ['body', ...st.names], { curve, seg: 5, steps: 12, ref: nrm, r: (u) => [0.1 * (1 - u * 0.45) + 0.012 * Math.sin(u * 23), 0.009], shape: (u, a) => 1 + (u > 0.85 ? 0.3 * Math.sin(a * 3 + u * 40) : 0), cap1: 0.4 });
      }
    }, color, group);
    return { def: d, built, chains };
  });
}
class WailerRig extends CreatureRig {
  constructor() {
    const glow = glowBasic(0xb070ff, 2.6);
    const M = {
      mask: bodyMat(0xffffff, { vertexColors: true, rim: 0.9 }),
      cloth: bodyMat(0xffffff, { vertexColors: true, rim: 0.5 }),
      glow,
    };
    super(wailerType(), M, { main: 'mask', outline: 0.01 });
    this.t = rand() * 5;
    this.height = 1.2;
    this.eyeMat = glow;
    this.p = { head: this.B.mask, torso: this.B.body, hips: this.B.body };
    this.ch = 0; this.wind = new V3();
  }
  update(dt, s = {}) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.t += dt;
    const t = this.t, B = this.B;
    this.motion(dt);
    this.ch = damp(this.ch, s.charge ?? 0, 10, dt);
    const c = this.ch;
    this.body.position.y = Math.sin(t * 2) * 0.12;
    const vl = this.velL;
    rot(B.body, -0.08 - c * 0.3 + clamp(vl.z * 0.05, -0.3, 0.3) + Math.sin(t * 1.7) * 0.04 - this.hurtSp.x * 0.08, 0, Math.sin(t * 1.4) * 0.08 + clamp(-this.yawRate * 0.1, -0.3, 0.3));
    rot(B.mask, Math.sin(t * 2.3) * 0.05 - c * 0.2, Math.sin(t * 0.9) * 0.15 * (1 - c), Math.sin(t * 1.3) * 0.06);
    // wail: the jaw drops and shudders while charging
    rot(B.jaw, c * (0.35 + Math.sin(t * 30) * 0.05) + (s.dead ? 0.4 : 0), 0, 0);
    const k = 1 + c * 1.3 + Math.sin(t * 8) * 0.08;
    B.core.scale.setScalar(k);
    for (let i = 0; i < this.chains.length; i++) {
      const ch = this.chains[i];
      for (let j = 0; j < ch.base.length; j++) { _e.set(Math.sin(t * 2.2 + i + j * 0.8) * 0.12, 0, Math.sin(t * 1.7 + i * 1.3 + j) * 0.1); ch.base[j].setFromEuler(_e); }
    }
    this.root.updateMatrixWorld(true);
    this.stepChains(dt, null, (i) => this.wind.set(-this.vel.x + Math.sin(t * 3 + i) * 1.2, -this.vel.y + 1.5 + c * 3, -this.vel.z + Math.cos(t * 2.6 + i * 2) * 1.2));
  }
}
export function makeWailer() { return new WailerRig(); }

// ===========================================================================
// 잿물 — ash ooze: a translucent, jiggling blob with a glowing core, a cheeky
// scowl and drips. Variants: ash, fire (flame licks), frost (ice crown), water.
const OOZE = {
  ash: { body: 0x4a3a66, glow: 0xd8b0ff, emi: 0x1c1030, deco: 0x2a2038 },
  fire: { body: 0xd8502a, glow: 0xffc040, emi: 0x6a1a04, deco: 0xffb040 },
  frost: { body: 0x7ec8f0, glow: 0xe0fbff, emi: 0x1a5a80, deco: 0xd8f4ff },
  water: { body: 0x2f7ae0, glow: 0xa8e4ff, emi: 0x08285e, deco: 0xa8e4ff },
};
function oozeType(variant) {
  return creatureType('ooze_' + variant, () => {
    const d = new SkelDef();
    d.add('base', null, 0, 0, 0, [0, 0.3, 0]);
    d.add('body', 'base', 0, 0.3, 0, [0, 0.62, 0]);
    d.add('top', 'body', 0, 0.62, 0, [0, 0.9, 0]);
    d.add('face', 'body', 0, 0.45, 0.45, [0, 0.45, 0.6]);
    d.add('core', 'body', 0, 0.34, 0, [0, 0.44, 0]);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.3; d.add('drip' + i, 'base', Math.sin(a) * 0.56, 0.06, Math.cos(a) * 0.56, [Math.sin(a) * 0.62, 0.02, Math.cos(a) * 0.62]); }
    const color = { skin: 0xffffff, eye: 0xffffff, mouth: 0x10060a, core: 0xffffff, deco: OOZE[variant].deco };
    const group = { skin: 'skin', eye: 'glow', core: 'glow', mouth: 'mouth', deco: variant === 'ash' ? 'mouth' : 'glow' };
    const built = bakeType(d, (S) => {
      // dome: flat bottom, bulging sides, soft peak
      blob(S, 'skin', [['base', 1], ['body', 1], ['top', 0.9]], {
        c: v(0, 0.34, 0), r: [0.62, 0.42, 0.6], ws: 28, hs: 18,
        fn: (dd, p) => {
          if (dd.y < 0) { p.y *= 0.62; const k = sstep(0, -0.6, dd.y); p.x *= 1 + 0.08 * k; p.z *= 1 + 0.08 * k; }
          else { p.y *= 1 + 0.25 * Math.pow(dd.y, 3); }
          p.multiplyScalar(1 + 0.035 * Math.sin(dd.x * 7) + 0.03 * Math.cos(dd.z * 6 + dd.y * 3));
        },
      });
      // face: angry-cute glowing eyes, wide grin
      for (const sd of [1, -1]) blob(S, 'eye', ['face'], { c: v(sd * 0.19, 0.5, 0.52), r: [0.07, 0.095, 0.04], ws: 10, hs: 8, fn: (dd, p) => { if (dd.y > 0.3) p.y -= (dd.y - 0.3) * 0.02 + p.x * sd * 0.25; } });
      tube(S, 'mouth', ['face'], { pts: [v(-0.17, 0.33, 0.54), v(-0.08, 0.28, 0.585), v(0, 0.27, 0.595), v(0.08, 0.28, 0.585), v(0.17, 0.33, 0.54)], seg: 8, steps: 12, ref: v(0, 1, 0), r: (u) => [0.012 + 0.045 * Math.sin(u * Math.PI), 0.02], cap0: 1, cap1: 1 });
      // core
      const g = new THREE.IcosahedronGeometry(0.19, 1);
      addGeo(S, 'core', ['core'], g, new THREE.Matrix4().makeTranslation(0, 0.34, 0));
      // drips around the base
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.3; blob(S, 'skin', ['drip' + i], { c: v(Math.sin(a) * 0.56, 0.06, Math.cos(a) * 0.56), r: [0.1, 0.07, 0.1], ws: 10, hs: 6 }); }
      // variant dressing
      if (variant === 'fire') for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        const b0 = v(Math.sin(a) * 0.14, 0.72, Math.cos(a) * 0.12 - 0.05);
        tube(S, 'deco', ['top'], { pts: [b0, b0.clone().add(v(Math.sin(a) * 0.06, 0.14, Math.cos(a) * 0.04)), b0.clone().add(v(Math.sin(a) * 0.03, 0.28 + (k % 2) * 0.08, 0))], seg: 6, steps: 5, r: (u) => 0.06 * (1 - u) + 0.003, cap1: 1 });
      }
      if (variant === 'frost') for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU + 0.2;
        const b0 = v(Math.sin(a) * 0.22, 0.68, Math.cos(a) * 0.2 - 0.04);
        tube(S, 'deco', ['top', ['body', 1.5]], { pts: [b0, b0.clone().add(v(Math.sin(a) * 0.1, 0.22 + (k % 2) * 0.08, Math.cos(a) * 0.08))], seg: 6, steps: 2, r: (u) => 0.055 * (1 - u) + 0.003, cap1: 1 });
      }
      if (variant === 'water') for (let k = 0; k < 7; k++) blob(S, 'deco', ['body'], { c: v(Math.sin(k * 2.3) * 0.3, 0.2 + ((k * 3) % 5) * 0.08, Math.cos(k * 2.3) * 0.25), r: [0.035, 0.035, 0.035], ws: 6, hs: 4 });
      if (variant === 'ash') for (let k = 0; k < 6; k++) { const a = k * 1.9; blob(S, 'deco', ['top', ['body', 1.2]], { c: v(Math.sin(a) * 0.3, 0.62 - (k % 3) * 0.06, Math.cos(a) * 0.28), r: [0.07, 0.04, 0.07], ws: 8, hs: 5, fn: (dd, p) => p.multiplyScalar(0.8 + 0.4 * vnoise3(dd.x * 3 + k, dd.y * 3, dd.z * 3)) }); }
    }, color, group);
    return { def: d, built, chains: [] };
  });
}
class OozeRig extends CreatureRig {
  constructor(variant, size) {
    const C = OOZE[variant];
    const glow = glowBasic(C.glow, 2.4);
    const M = {
      skin: bodyMat(C.body, { rim: 1.6, emissive: C.emi, transparent: true, opacity: 0.82, vertexColors: true }),
      mouth: bodyMat(0xffffff, { vertexColors: true, rim: 0.3 }),
      glow,
    };
    super(oozeType(variant), M, { main: 'skin', outline: 0 });
    this.root.scale.setScalar(size);
    M.skin.depthWrite = true;
    this.meshes.forEach((m) => { if (m.material === M.skin) m.renderOrder = 1; });
    this.t = rand() * 5;
    this.height = 0.9 * size;
    this.squash = 0;
    this.jx = new Spring(90, 7); this.jz = new Spring(90, 7); this.jy = new Spring(120, 8);
    this.p = { head: this.B.face, torso: this.B.body, hips: this.B.base };
  }
  hurt() { super.hurt(); this.jy.v -= 6; this.jx.v += (rand() - 0.5) * 8; }
  update(dt, s = {}) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.t += dt;
    const t = this.t, B = this.B;
    this.motion(dt);
    this.squash = damp(this.squash, s.squash ?? 0, 12, dt);
    const q = this.squash + Math.sin(t * 4) * 0.04;
    // jelly: the top lags behind motion and rebounds
    const al = this.acc;
    const x = this.jx.step(clamp(-al.x * 0.02, -0.3, 0.3), dt), z = this.jz.step(clamp(-al.z * 0.02, -0.3, 0.3), dt);
    const y = this.jy.step(q, dt);
    const cy = Math.cos(this.prevYaw), sy = Math.sin(this.prevYaw);
    const lx = x * cy - z * sy, lz = x * sy + z * cy;
    B.body.scale.set(1 - y * 0.3, 1 + y, 1 - y * 0.3);
    rot(B.body, lz * 0.8, 0, -lx * 0.8);
    B.top.position.set(this.rest.top.x + lx * 0.2, this.rest.top.y + y * 0.1, this.rest.top.z + lz * 0.2);
    rot(B.top, lz * 1.2 + Math.sin(t * 3.1) * 0.05, 0, -lx * 1.2 + Math.sin(t * 2.3) * 0.05);
    B.core.rotation.y += dt * 2;
    B.core.position.y = this.rest.core.y + Math.sin(t * 3) * 0.04;
    for (let i = 0; i < 5; i++) B['drip' + i].scale.setScalar(0.8 + Math.sin(t * 3 + i) * 0.25);
    B.face.scale.setScalar(1 - this.hurtW * 0.15);
    this.root.updateMatrixWorld(true);
  }
}
export function makeOoze(variant = 'ash', size = 1) { return new OozeRig(OOZE[variant] ? variant : 'ash', size); }

// ===========================================================================
// 재나방 — ash moth: furry thorax, segmented abdomen, feathered antennae and
// two pairs of veined wings with glowing eye-spots.
function mothType() {
  return creatureType('moth', () => {
    const d = new SkelDef();
    d.add('body', null, 0, 0, 0, [0, 0, 0.12]);
    d.add('head', 'body', 0, 0.02, 0.15, [0, 0.03, 0.24]);
    d.add('abd', 'body', 0, -0.005, -0.06, [0, -0.02, -0.2]);
    d.add('abd2', 'abd', 0, -0.02, -0.19, [0, -0.04, -0.3]);
    for (const sd of [1, -1]) {
      const n = sd > 0 ? 'L' : 'R';
      d.add('wF' + n, 'body', sd * 0.045, 0.035, 0.05, [sd * 0.3, 0.035, 0.05]);
      d.add('wH' + n, 'body', sd * 0.04, 0.03, -0.04, [sd * 0.25, 0.03, -0.04]);
      d.add('ant' + n, 'head', sd * 0.025, 0.06, 0.22, [sd * 0.08, 0.16, 0.34]);
    }
    const color = { fur: 0x4a4050, furL: 0x7a7080, dark: 0x201a24, wing: 0x6a6072, wingD: 0x3a3244, vein: 0x2a2230, eye: 0xffffff, spot: 0xffffff };
    const group = { fur: 'body', furL: 'body', dark: 'body', wing: 'wing', wingD: 'wing', vein: 'wing', eye: 'glow', spot: 'glow' };
    const built = bakeType(d, (S) => {
      // fuzzy thorax
      blob(S, 'fur', ['body'], { c: v(0, 0.01, 0.05), r: [0.07, 0.065, 0.09], ws: 14, hs: 10, fn: (dd, p) => { p.multiplyScalar(1 + 0.12 * Math.pow(Math.abs(Math.sin(dd.x * 13 + dd.y * 9 + dd.z * 11)), 4)); } });
      blob(S, 'furL', ['body', ['head', 1.4]], { c: v(0, 0.015, 0.13), r: [0.065, 0.06, 0.05], ws: 12, hs: 8, fn: (dd, p) => { p.multiplyScalar(1 + 0.15 * Math.pow(Math.abs(Math.sin(dd.x * 15 + dd.y * 11)), 4)); } });
      // segmented abdomen
      tube(S, 'fur', ['abd', 'abd2'], { pts: [v(0, 0.0, -0.02), v(0, -0.015, -0.14), v(0, -0.035, -0.28), v(0, -0.05, -0.34)], seg: 10, steps: 14, ref: v(0, 1, 0), r: (u) => { const r = 0.058 * Math.sin(Math.min(1, 0.25 + u) * Math.PI * 0.85) + 0.006; return [r * (1 + 0.1 * Math.cos(u * 40)), r * 0.9 * (1 + 0.1 * Math.cos(u * 40))]; }, cap1: 1, cap0: 0.6 });
      // head with big glowing compound eyes
      blob(S, 'dark', ['head'], { c: v(0, 0.02, 0.2), r: [0.045, 0.042, 0.04], ws: 10, hs: 8 });
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R';
        blob(S, 'eye', ['head'], { c: v(sd * 0.034, 0.03, 0.222), r: [0.02, 0.024, 0.02], ws: 10, hs: 8 });
        // feathered antennae
        const a0 = v(sd * 0.022, 0.055, 0.225), a1 = v(sd * 0.06, 0.13, 0.3), a2 = v(sd * 0.1, 0.17, 0.35);
        tube(S, 'dark', ['ant' + n], { pts: [a0, a1, a2], seg: 4, steps: 6, r: 0.004, cap1: 1 });
        for (let k = 1; k <= 5; k++) { const p = a0.clone().lerp(a2, k / 6); tube(S, 'furL', ['ant' + n], { pts: [p, p.clone().add(v(sd * 0.025 * (1 - k / 7), 0.012, -0.012))], seg: 3, steps: 1, r: 0.0035, ol: 0 }); tube(S, 'furL', ['ant' + n], { pts: [p, p.clone().add(v(-sd * 0.02 * (1 - k / 7), 0.014, 0.006))], seg: 3, steps: 1, r: 0.0035, ol: 0 }); }
        // legs tucked under
        for (let k = 0; k < 3; k++) { const l0 = v(sd * 0.04, -0.035, 0.1 - k * 0.05); tube(S, 'dark', ['body'], { pts: [l0, l0.clone().add(v(sd * 0.04, -0.03, 0.01)), l0.clone().add(v(sd * 0.05, -0.08, 0.03 - k * 0.02))], seg: 4, steps: 4, r: 0.006, ol: 0.3 }); }
        // wings: forewing (pointed) and hindwing (rounded), thin sheets with veins and eye-spots
        const wing = (bone, root, span, chord, sweep, round, spotAt, back) => {
          const shape = (u, vv, out) => {
            // u: root -> tip along span, vv: leading -> trailing edge
            const x = u * span;
            const c = chord * (round ? Math.sqrt(Math.max(0, 1 - Math.pow(u, 2.2))) * (0.7 + 0.3 * Math.sin(u * Math.PI)) : (0.55 + 0.6 * Math.sin(Math.min(1, u * 1.2) * Math.PI * 0.7)) * (1 - Math.pow(u, 6)));
            const lead = sweep * u * u;
            out.set(root.x + sd * x, root.y + 0.012 * Math.sin(u * Math.PI) - 0.008 * vv, root.z + lead + (back ? -c * vv * 0.95 : c * (0.45 - vv)) + 0.006 * Math.sin(vv * 20 + u * 9) * u);
          };
          sheet(S, 'wing', [bone], { nu: 10, nv: 6, thick: 0.005, top: true, fn: shape, inside: (p) => v(p.x, p.y - 1, p.z), innerMat: 'wingD' });
          // veins
          for (let k = 0; k < 4; k++) { const vv = 0.1 + k * 0.25; const pts = []; for (let j = 0; j <= 5; j++) { const o = new V3(); shape(j / 5 * 0.92, vv * (j / 5), o); o.y += 0.005; pts.push(o); } tube(S, 'vein', [bone], { pts, seg: 3, steps: 6, r: 0.003, ol: 0 }); }
          const sp = new V3(); shape(spotAt[0], spotAt[1], sp); sp.y += 0.006;
          blob(S, 'spot', [bone], { c: sp, r: [0.035, 0.005, 0.03], ws: 10, hs: 4 });
          blob(S, 'vein', [bone], { c: sp.clone().add(v(0, -0.001, 0)), r: [0.05, 0.004, 0.044], ws: 10, hs: 4 });
        };
        wing('wF' + n, v(sd * 0.04, 0.035, 0.06), 0.36, 0.22, -0.1, false, [0.62, 0.5], false);
        wing('wH' + n, v(sd * 0.04, 0.03, -0.01), 0.27, 0.22, -0.02, true, [0.5, 0.45], true);
      }
    }, color, group);
    return { def: d, built, chains: [] };
  });
}
class MothRig extends CreatureRig {
  constructor() {
    const glow = glowBasic(0xc9a0ff, 2.6);
    const M = {
      body: bodyMat(0xffffff, { vertexColors: true, rim: 0.9 }),
      wing: bodyMat(0xffffff, { vertexColors: true, rim: 0.6, emissive: 0x100818 }),
      glow,
    };
    super(mothType(), M, { main: 'body', outline: 0.006 });
    this.t = rand() * 5;
    this.height = 0.4;
    this.p = { head: this.B.head, torso: this.B.body, hips: this.B.body };
    this.fold = 0;
  }
  update(dt, s = {}) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.t += dt;
    const t = this.t, B = this.B;
    this.motion(dt);
    if (s.dead) {
      // wings fold and twitch as it drops
      this.fold = damp(this.fold, 1, 6, dt);
      for (const n of ['L', 'R']) { const sd = n === 'L' ? 1 : -1; rot(B['wF' + n], 0, 0, sd * (1.2 * this.fold + Math.sin(t * 30) * 0.05)); rot(B['wH' + n], 0, 0, sd * (1.0 * this.fold + Math.sin(t * 27) * 0.05)); }
      B.body.rotation.x = damp(B.body.rotation.x, 1.1, 4, dt);
      this.root.updateMatrixWorld(true);
      return;
    }
    const f = s.dive ? 38 : s.shock ? 60 : 22;
    const ph = t * f;
    for (const n of ['L', 'R']) {
      const sd = n === 'L' ? 1 : -1;
      const fw = Math.sin(ph) * 0.9 + 0.15, hw = Math.sin(ph - 0.6) * 0.8 + 0.1;
      rot(B['wF' + n], Math.cos(ph) * 0.12, sd * Math.sin(ph) * 0.1, sd * (s.dive ? 0.9 + Math.sin(ph) * 0.3 : fw));
      rot(B['wH' + n], Math.cos(ph - 0.6) * 0.1, 0, sd * (s.dive ? 0.8 + Math.sin(ph) * 0.25 : hw));
      rot(B['ant' + n], Math.sin(t * 5 + sd) * 0.15 - (s.dive ? 0.4 : 0), 0, sd * Math.sin(t * 3.3) * 0.1);
    }
    const lift = Math.sin(ph) * 0.02;
    this.body.position.y = Math.sin(t * 5) * 0.05 + lift;
    rot(B.body, s.dive ? 0.5 : Math.sin(t * 2) * 0.15 + clamp(this.velL.z * 0.04, -0.3, 0.3), 0, clamp(-this.yawRate * 0.12, -0.5, 0.5));
    rot(B.abd, Math.sin(t * 3.1) * 0.12 - 0.05, Math.sin(t * 2.2) * 0.1, 0);
    rot(B.abd2, Math.sin(t * 3.1 - 0.7) * 0.15, Math.sin(t * 2.2 - 0.5) * 0.12, 0);
    rot(B.head, Math.sin(t * 1.7) * 0.1, Math.sin(t * 1.1) * 0.2, 0);
    this.root.updateMatrixWorld(true);
  }
}
export function makeMoth() { return new MothRig(); }
