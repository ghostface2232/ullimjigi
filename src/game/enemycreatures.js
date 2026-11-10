// Non-humanoid enemy bodies on the creature rig: 울음탈 (wailer), 잿물 (ooze),
// 재나방 (moth), 뿌리손 (root hand) and 망루지기 (watcher). Signed-distance
// sculpts for the seamless masses, lofted parts for the crisp ones, procedural
// animation and verlet secondary motion.
import * as THREE from 'three';
import { damp, clamp, rand } from '../core/util.js';
import { SkelDef, tube, blob, sheet, sstep, mix, TAU, bodyMat, vnoise3, Spring } from './charkit.js';
import { CreatureRig, creatureType, bakeType, rigidType, glowBasic, rot, Field, shard, spike, tatter, prism, sheen, jelly, extendMat, megalith as megalithBlock } from './creatures.js';

const V3 = THREE.Vector3;
const v = (x, y, z) => new V3(x, y, z);
const _e = new THREE.Euler();
const _w = new V3();
const ring = (n, f) => Array.from({ length: n }, (_, k) => f((k / n) * TAU, k));

// ===========================================================================
// 울음탈 — the wailing mask: a broken, weeping bone mask in a ragged cowl, a
// halo of bone spines, skeletal hands that rise to its face when it wails, a
// caged core under an open shroud and six long streamers.
const WAIL_STRIPS = 6, WAIL_SEG = 4;
function wailerType() {
  return creatureType('wailer', () => {
    const d = new SkelDef();
    d.add('body', null, 0, 0, 0, [0, 0.1, 0]);
    d.add('mask', 'body', 0, 0.05, 0.1, [0, 0.3, 0.12]);
    d.add('jaw', 'mask', 0, -0.1, 0.2, [0, -0.3, 0.3]);
    d.add('core', 'body', 0, -0.3, 0.03, [0, -0.2, 0.03]);
    for (const sd of [1, -1]) d.add('hand' + (sd > 0 ? 'L' : 'R'), 'body', sd * 0.43, -0.22, 0.2, [sd * 0.43, -0.05, 0.24]);
    const chains = [], strips = [];
    for (let i = 0; i < WAIL_STRIPS; i++) {
      const a = (i / WAIL_STRIPS) * TAU + 0.52;
      const x = Math.sin(a) * 0.27, z = Math.cos(a) * 0.21 - 0.06;
      const names = []; let parent = 'body';
      const len = 0.95 + (i % 3) * 0.16;
      for (let k = 0; k < WAIL_SEG; k++) { const nm = `st${i}_${k}`; d.add(nm, parent, x * (1 + k * 0.12), -0.2 - (k * len) / WAIL_SEG, z * (1 + k * 0.12)); names.push(nm); parent = nm; }
      const tail = v(x * (1 + WAIL_SEG * 0.12), -0.2 - len, z * (1 + WAIL_SEG * 0.12));
      chains.push({ names, tail, kind: 'strip', opts: { stiff: 0.07, stiffTip: 0.02, damp: 0.08, grav: 3, drag: 1.1 } });
      strips.push({ a, names, tail, len });
    }
    const color = { bone: 0xe4dcc8, boneD: 0xb9b09c, cloth: 0x41384f, clothD: 0x1d1927, void: 0x08060c, glow: 0xffffff, glowD: 0x9c9c9c };
    const group = { bone: 'mask', boneD: 'mask', cloth: 'cloth', clothD: 'cloth', void: 'cloth', glow: 'glow', glowD: 'glow' };
    const built = bakeType(d, (S) => {
      const mc = v(0, 0.07, 0.13), at = (x, y, z) => mc.clone().add(v(x, y, z));
      blob(S, 'void', ['body', ['mask', 1.4]], { c: v(0, 0.05, -0.03), r: [0.29, 0.36, 0.25], ws: 16, hs: 12, ol: 0 });
      // the mask: brow, nose and cheekbones, grieving sockets, upper lip; one corner broken away
      const K = new Field(S);
      K.bind(['mask'], 0.035).ell(mc, [0.265, 0.35, 0.2]);
      K.ell(at(0, 0.15, 0.13), [0.2, 0.05, 0.075], { k: 0.045, rot: [0.2, 0, 0] });
      K.cone(at(0, 0.11, 0.17), at(0, -0.035, 0.215), 0.026, 0.04, { k: 0.03 });
      for (const sd of [1, -1]) K.ell(at(sd * 0.145, -0.05, 0.11), [0.06, 0.05, 0.06], { k: 0.045 });
      K.ell(at(0, 0, -0.085), [0.255, 0.35, 0.2], { sub: true, k: 0.01 });
      K.box(at(0, -0.43, 0.1), [0.4, 0.26, 0.3], 0.01, { sub: true, k: 0.012 });
      K.ell(at(0, -0.17, 0.17), [0.085, 0.075, 0.1], { sub: true, k: 0.015 });
      for (const sd of [1, -1]) K.ell(at(sd * 0.115, 0.065, 0.15), [0.075, 0.046, 0.1], { sub: true, k: 0.012, rot: [0, 0, -sd * 0.5] });
      K.box(at(0.25, 0.3, 0.05), [0.12, 0.09, 0.2], 0.01, { sub: true, k: 0.006, rot: [0, 0, 0.75] });
      K.groove([at(0.06, 0.4, 0.1), at(0.035, 0.27, 0.2), at(0.085, 0.2, 0.2), at(0.05, 0.13, 0.2)], 0.007, 0.002);
      K.groove([at(-0.2, -0.02, 0.12), at(-0.17, -0.1, 0.12), at(-0.2, -0.16, 0.1)], 0.006, 0.002);
      // lower jaw: a crescent that drops and shudders
      K.bind(['jaw'], 0.02).ell(at(0, -0.27, 0.08), [0.13, 0.07, 0.11]);
      K.ell(at(0, -0.215, 0.03), [0.105, 0.07, 0.115], { sub: true, k: 0.012 });
      K.mesh('bone', { cell: 0.0135, ol: 0.5 });
      for (const sd of [1, -1]) {
        blob(S, 'glow', ['mask'], { c: at(sd * 0.112, 0.06, 0.055), r: [0.05, 0.034, 0.02], ws: 10, hs: 8, ol: 0, fn: (dd, p) => { p.y -= p.x * sd * 0.5; } });
        // tears of light down the cheeks
        const tp = [[0.115, 0.01], [0.122, -0.06], [0.112, -0.13], [0.118, -0.17]].map(([x, y]) => K.on(at(sd * x, y, 0.3), 0.0015));
        tube(S, 'glowD', ['mask'], { pts: tp, seg: 6, steps: 12, ref: v(0, 0, 1), ol: 0, cap1: 1, capN: 2, r: (u) => [0.011 * (1 - u * 0.55) * (1 + 0.5 * sstep(0.75, 0.95, u)), 0.004] });
        // teeth
        for (let k = 0; k < 3; k++) {
          spike(S, 'boneD', ['mask'], K.on(at(sd * (0.022 + k * 0.03), -0.165, 0.3), -0.002), v(0, -1, 0.05), 0.04 - k * 0.006, 0.011, { seg: 5, steps: 3, ol: 0.3 });
          spike(S, 'boneD', ['jaw'], K.on(at(sd * (0.03 + k * 0.03), -0.21, 0.3), -0.002), v(0, 1, 0.1), 0.034 - k * 0.006, 0.01, { seg: 5, steps: 3, ol: 0.3 });
        }
      }
      blob(S, 'glowD', ['mask'], { c: at(0, -0.2, -0.04), r: [0.06, 0.07, 0.03], ws: 10, hs: 8, ol: 0 });
      // cowl: peaked, ragged, drawn close around the mask
      sheet(S, 'cloth', [['body', 1], ['mask', 1.3]], {
        nu: 24, nv: 10, thick: 0.014, sides: true, innerMat: 'clothD',
        fn: (u, vv, q) => {
          const open = mix(0.75, 1.15, sstep(0, 0.5, vv)) * sstep(1.05, 0.7, vv) + 0.5 * sstep(0.7, 1, vv), phi = mix(open, TAU - open, u), th = mix(0.08, 2.25, vv);
          const back = 1 - Math.abs(u - 0.5) * 2, peak = sstep(0.4, 0.95, back) * Math.exp(-((vv - 0.22) ** 2) / 0.02) * 0.16;
          const tri = Math.abs(((u * 9 + 0.3) % 1) - 0.5) * 2, r = 0.36 + 0.04 * vv;
          q.set(Math.sin(th) * Math.sin(phi) * r * 0.95, 0.09 + Math.cos(th) * r * 1.12 + peak * 0.9 + 0.05 * tri * sstep(0.8, 1, vv), -0.02 + Math.sin(th) * Math.cos(phi) * r * 0.9 - peak);
          q.x *= 1 + 0.25 * sstep(0.75, 1, vv); q.z -= 0.012 * Math.sin(u * 34) * vv;
        },
        inside: (p) => v(0, p.y, -0.03),
      });
      // halo of bone spines behind the head
      for (let k = 0; k < 7; k++) {
        const a = mix(-1.25, 1.25, k / 6), len = 0.3 + 0.13 * Math.cos(a * 1.4) + (k % 2) * 0.05;
        spike(S, k % 2 ? 'boneD' : 'bone', ['body'], v(Math.sin(a) * 0.29, 0.15 + Math.cos(a) * 0.31, -0.13), v(Math.sin(a), Math.cos(a) * 0.9 + 0.15, -0.3), len, 0.034, { flat: 0.4, ref: v(0, 0, 1), bend: v(0, 0, -0.25), seg: 8, steps: 8 });
      }
      // shroud, open at the front over a caged core
      sheet(S, 'cloth', ['body', ...strips.map((st) => [st.names[0], 1.6])], {
        nu: 28, nv: 6, thick: 0.012, sides: true, innerMat: 'clothD',
        fn: (u, vv, q) => { const a = mix(0.62, TAU - 0.62, u), tri = Math.abs(((u * 8 + 0.1) % 1) - 0.5) * 2, r = mix(0.25, 0.4, Math.pow(vv, 0.8)) * (1 + 0.06 * vv * Math.sin(a * 7)); q.set(Math.sin(a) * r, mix(-0.12, -0.6 + 0.2 * tri * tri, vv), Math.cos(a) * r * 0.85 - 0.04); },
        inside: (p) => v(0, p.y, -0.04),
      });
      shard(S, 'glow', ['core'], v(0, -0.43, 0.03), v(0, -0.17, 0.03), 0.06, { sides: 5, waist: 0.52, ol: 0 });
      for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + 0.5, c = v(Math.sin(a) * 0.12, -0.3 + (k - 1) * 0.06, 0.03 + Math.cos(a) * 0.12); shard(S, 'glowD', ['core'], c.clone().add(v(0, -0.04, 0)), c.clone().add(v(0, 0.05, 0)), 0.016, { sides: 4, waist: 0.5, ol: 0 }); }
      for (const sd of [1, -1]) {
        for (let k = 0; k < 3; k++) spike(S, 'boneD', ['body'], v(sd * 0.2, -0.17 - k * 0.085, -0.1), v(sd * 0.5, -0.1, 1), 0.3 - k * 0.035, 0.017, { bend: v(-sd * 0.85, 0, 0.15), seg: 6, steps: 10 });
        // skeletal hand with a torn cuff
        const n = 'hand' + (sd > 0 ? 'L' : 'R'), hp = d.pos(n);
        blob(S, 'bone', [n], { c: hp.clone().add(v(0, 0.02, 0)), r: [0.05, 0.062, 0.026], ws: 12, hs: 8, ol: 0.6 });
        for (let k = 0; k < 4; k++) { const x = (k - 1.5) * 0.026; spike(S, 'bone', [n], hp.clone().add(v(x, 0.065, 0.004)), v(x * 4 - sd * 0.1, 1, 0.25), 0.15 - Math.abs(k - 1.5) * 0.018, 0.0135, { bend: v(0, -0.2, 0.55), ridge: 0.14, rings: 19, seg: 6, steps: 9, ol: 0.5 }); }
        spike(S, 'bone', [n], hp.clone().add(v(-sd * 0.045, 0.01, 0.006)), v(-sd, 0.55, 0.3), 0.1, 0.014, { bend: v(0, 0.2, 0.4), seg: 6, ol: 0.5 });
        tatter(S, 'cloth', [n], hp.clone().add(v(-0.055, -0.035, 0.01)), hp.clone().add(v(0.055, -0.035, 0.01)), 0.26, { out: v(0, 0, 1), inner: 'clothD', flare: 0.0, rags: 3, seed: sd + 3, taper: 0.5 });
        tatter(S, 'cloth', [n], hp.clone().add(v(0.055, -0.035, -0.012)), hp.clone().add(v(-0.055, -0.035, -0.012)), 0.3, { out: v(0, 0, -1), inner: 'clothD', flare: 0.0, rags: 2, seed: sd + 6, taper: 0.5 });
      }
      // streamers: long ribbons with frayed ends
      for (const st of strips) {
        const curve = new THREE.CatmullRomCurve3([...st.names.map((n) => d.pos(n)), st.tail]);
        tube(S, 'cloth', ['body', ...st.names], { curve, seg: 6, steps: 16, ref: v(Math.sin(st.a), 0, Math.cos(st.a)), cap1: 0.3, capN: 2, r: (u) => [0.1 * (1 - u * 0.5) * (1 + 0.1 * Math.sin(u * 19)), 0.008], shape: (u, a) => 1 + (u > 0.78 ? 0.45 * Math.sin(a * 3 + u * 40) * (u - 0.78) * 4 : 0) });
      }
      const dk = new THREE.Color(0x15121d);
      return { fields: [K], aoR: 0.04, ao: 0.6, fn: (key, p, n, c) => { if (key === 'cloth') c.lerp(dk, 0.75 * sstep(-0.1, -1.1, p.y)).multiplyScalar(0.85 + 0.25 * Math.max(0, n.y)); if (key === 'bone') c.multiplyScalar(0.86 + 0.18 * Math.max(0, n.y)); } };
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
    this.p = { head: this.B.mask, torso: this.B.body, hips: this.B.body, foreR: this.B.handR };
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
    // hands hover at its sides and rise to the face while it wails
    for (const sd of [1, -1]) {
      const hb = sd > 0 ? B.handL : B.handR, r0 = this.rest[hb.name];
      hb.position.set(r0.x - sd * 0.17 * c, r0.y + 0.34 * c + Math.sin(t * 1.6 + sd) * 0.04, r0.z + 0.05 * c);
      rot(hb, -0.3 + c * 0.55 + Math.sin(t * 2.1 + sd) * 0.12 + (s.dead ? 1.2 : 0), sd * (0.5 - c * 0.3), sd * (0.25 + Math.sin(t * 1.3) * 0.1 - c * 0.5));
    }
    const k = 1 + c * 1.3 + Math.sin(t * 8) * 0.08;
    B.core.scale.setScalar(k);
    B.core.rotation.y += dt * (1.2 + c * 6);
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
// 잿물 — ash ooze: a translucent, wobbling body of jelly with lobes that creep
// along the ground. Inside it: a crystal core in a slow swirl of sediment,
// bubbles, two scowling lights. Variants: ash (crust plates), fire (flame
// crown), frost (ice crown), water (ring of droplets).
const OOZE = {
  ash: { body: 0x7a66a8, glow: 0xd8b0ff, emi: 0x1c1030, deco: 0x2a2233, sed: 0x1d1826 },
  fire: { body: 0xe8643a, glow: 0xffc040, emi: 0x6a1a04, deco: 0xffffff, sed: 0x4a1408 },
  frost: { body: 0x8fd2f4, glow: 0xe0fbff, emi: 0x1a5a80, deco: 0xd8f4ff, sed: 0x2c5a7c },
  water: { body: 0x3f8cf0, glow: 0xa8e4ff, emi: 0x08285e, deco: 0xffffff, sed: 0x12356e },
};
function oozeType(variant) {
  return creatureType('ooze_' + variant, () => {
    const d = new SkelDef();
    d.add('base', null, 0, 0, 0, [0, 0.3, 0]);
    d.add('body', 'base', 0, 0.3, 0, [0, 0.62, 0]);
    d.add('top', 'body', 0, 0.62, 0, [0, 0.9, 0]);
    d.add('face', 'body', 0, 0.45, 0.4, [0, 0.45, 0.6]);
    d.add('core', 'body', 0, 0.36, 0, [0, 0.46, 0]);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.3; d.add('drip' + i, 'base', Math.sin(a) * 0.56, 0.06, Math.cos(a) * 0.56, [Math.sin(a) * 0.62, 0.02, Math.cos(a) * 0.62]); }
    const C = OOZE[variant];
    const color = { skin: 0xffffff, sed: C.sed, dark: 0x0c0610, glow: 0xffffff, glowD: 0xa8a8a8, deco: C.deco };
    const group = { skin: 'skin', sed: 'in', dark: 'in', glow: 'glow', glowD: 'glow', deco: variant === 'ash' ? 'in' : variant === 'frost' ? 'ice' : 'glow' };
    const built = bakeType(d, (S) => {
      // one seamless body: dome, sagging skirt, crown bulge, creeping lobes; flat underneath
      const F = new Field(S);
      F.bind([['base', 1], ['body', 1], ['top', 0.9]], 0.12).ell(v(0, 0.37, 0), [0.55, 0.4, 0.53]);
      F.ell(v(0, 0.13, 0), [0.64, 0.16, 0.62], { k: 0.1 });
      F.bind(['top', ['body', 1.3]], 0.1).ell(v(0.04, 0.72, -0.03), [0.25, 0.19, 0.24]);
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.3, s = 1 + ((i * 7) % 3) * 0.14; F.bind(['drip' + i, ['base', 1.6]], 0.08).ell(v(Math.sin(a) * 0.62, 0.065, Math.cos(a) * 0.62), [0.15 * s, 0.085, 0.15 * s]); }
      F.box(v(0, -0.3, 0), [1.2, 0.3, 1.2], 0.001, { sub: true, k: 0.035 });
      F.mesh('skin', { cell: 0.036 });
      // core: a crystal cluster in a swirl of sediment
      shard(S, 'glow', ['core'], v(0, 0.2, 0), v(0.01, 0.56, 0), 0.085, { sides: 6, waist: 0.5, ol: 0 });
      for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4, b = v(Math.sin(a) * 0.05, 0.3, Math.cos(a) * 0.05); shard(S, 'glowD', ['core'], b, b.clone().add(v(Math.sin(a) * 0.14, 0.1 + (k % 2) * 0.07, Math.cos(a) * 0.14)), 0.04, { sides: 5, waist: 0.4, ol: 0 }); }
      for (let k = 0; k < 5; k++) { const a = k * 2.4, r = 0.2 + (k % 3) * 0.05, y = 0.2 + ((k * 5) % 7) * 0.05; blob(S, 'sed', ['core'], { c: v(Math.sin(a) * r, y, Math.cos(a) * r), r: [0.055 - (k % 3) * 0.012, 0.022, 0.04], ws: 8, hs: 5, ol: 0, fn: (dd, p) => p.applyAxisAngle(_w.set(0, 1, 0), a + 0.8) }); }
      // bubbles rising under the skin
      for (let k = 0; k < 8; k++) { const a = k * 1.9 + 0.7, r = 0.18 + (k % 4) * 0.07, s = 0.018 + (k % 3) * 0.009; blob(S, 'glowD', [k % 2 ? 'top' : 'body'], { c: v(Math.sin(a) * r, 0.32 + ((k * 3) % 5) * 0.09, Math.cos(a) * r * 0.9), r: [s, s, s], ws: 6, hs: 5, ol: 0 }); }
      // scowling lights and a crooked mouth, just under the surface
      for (const sd of [1, -1]) blob(S, 'glow', ['face'], { c: F.on(v(sd * 0.18, 0.5, 0.6), -0.035), r: [0.085, 0.105, 0.03], ws: 12, hs: 8, ol: 0, skip: (dd) => dd.z < 0, fn: (dd, p) => { if (dd.y > 0.1) p.y -= (dd.y - 0.1) * 0.03 + Math.max(0, -p.x * sd) * 0.9; } });
      tube(S, 'dark', ['face'], { pts: [[-0.15, 0.345], [-0.07, 0.3], [0.01, 0.31], [0.08, 0.285], [0.15, 0.33]].map(([x, y]) => F.on(v(x, y, 0.7), -0.03)), seg: 6, steps: 12, ref: v(0, 1, 0), ol: 0, cap0: 1, cap1: 1, capN: 2, r: (u) => [0.008 + 0.022 * Math.sin(u * Math.PI), 0.012] });
      // variant dressing
      if (variant === 'fire') for (let k = 0; k < 7; k++) {
        const a = (k / 7) * TAU, b0 = F.on(v(Math.sin(a) * 0.17 + 0.04, 1.0, Math.cos(a) * 0.15 - 0.03), -0.03), h = 0.26 + (k % 3) * 0.1;
        tube(S, 'deco', ['top'], { pts: [b0, b0.clone().add(v(Math.sin(a) * 0.07, h * 0.45, Math.cos(a) * 0.05)), b0.clone().add(v(Math.sin(a + 1) * 0.05, h * 0.8, Math.cos(a + 1) * 0.03)), b0.clone().add(v(Math.sin(a) * 0.01, h, 0))], seg: 8, steps: 10, ol: 0, cap1: 1, capN: 2, r: (u) => 0.07 * Math.pow(1 - u, 0.8) * (1 + 0.15 * Math.sin(u * 9 + k)) + 0.002 });
      }
      if (variant === 'frost') for (let k = 0; k < 7; k++) {
        const a = (k / 7) * TAU + 0.2, b0 = F.on(v(Math.sin(a) * 0.2 + 0.04, 1.0, Math.cos(a) * 0.18 - 0.03), -0.04);
        shard(S, 'deco', ['top', ['body', 1.5]], b0, b0.clone().add(v(Math.sin(a) * 0.13, 0.26 + (k % 2) * 0.12, Math.cos(a) * 0.11)), 0.05, { sides: 6, waist: 0.35, twist: k });
      }
      if (variant === 'water') for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU, s = 0.03 + (k % 3) * 0.012; blob(S, 'deco', ['top'], { c: v(Math.sin(a) * 0.38 + 0.04, 0.98 + (k % 2) * 0.07, Math.cos(a) * 0.36 - 0.03), r: [s, s * 1.35, s], ws: 8, hs: 8, ol: 0, fn: (dd, p) => { if (dd.y > 0) p.multiplyScalar(1 - 0.45 * dd.y * dd.y); } }); }
      if (variant === 'ash') for (let k = 0; k < 7; k++) {
        const a = k * 1.9, c = F.on(v(Math.sin(a) * 0.22 + 0.03, 0.95 - (k % 3) * 0.08, Math.cos(a) * 0.2), 0.004);
        blob(S, 'deco', ['top', ['body', 1.2]], { c, r: [0.1 - (k % 3) * 0.018, 0.02, 0.085], ws: 10, hs: 5, fn: (dd, p) => { p.multiplyScalar(0.8 + 0.45 * vnoise3(dd.x * 2 + k, dd.y * 2, dd.z * 2)); if (c.n.y < 0.995) p.applyAxisAngle(_w.set(c.n.z, 0, -c.n.x).normalize(), Math.acos(c.n.y)); } });
      }
      return { ao: 0, fn: (key, p, n, c) => { if (key === 'skin') c.multiplyScalar(0.62 + 0.6 * sstep(0, 0.9, p.y)); }, skip: (k) => k !== 'skin' };
    }, color, group);
    return { def: d, built, chains: [] };
  });
}
class OozeRig extends CreatureRig {
  constructor(variant, size) {
    const C = OOZE[variant];
    const glow = glowBasic(C.glow, 2.4);
    const M = {
      skin: jelly(sheen(bodyMat(C.body, { rim: 1.5, emissive: C.emi, transparent: true, vertexColors: true }), { size: 0.045, soft: 0.02, k: 0.9, fres: 0.45 }), { clear: 0.52, dense: 0.97, glow: 0.35, color: C.glow, h: 0.75 }),
      in: bodyMat(0xffffff, { vertexColors: true, rim: 0.4 }),
      glow,
    };
    if (variant === 'frost') M.ice = sheen(bodyMat(0xffffff, { vertexColors: true, rim: 1.3, emissive: 0x1c4466 }), { color: 0xdff6ff, size: 0.1, k: 0.9, fres: 0.5 });
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
// 재나방 — ash moth: a furred thorax with a pale ruff, banded abdomen, great
// glowing eyes, combed antennae, and two pairs of scalloped wings whose veins
// and glowing eye-spots are painted in the wing shader.
const WING = { fore: [0.4, 0.2], hind: [0.29, 0.21] };
// wing outline: u root -> tip, vv leading -> trailing edge
function wingAt(kind, sd, u, vv, out) {
  if (kind === 'fore') {
    const span = 0.4 * u, lead = 0.065 + 0.03 * Math.sin(u * 2.6) - 0.1 * u * u * u;
    const chord = 0.2 * (0.42 + 0.58 * Math.sin(Math.min(1, u * 1.08) * Math.PI * 0.62)) * (1 - Math.pow(u, 7)) * (1 + 0.07 * Math.cos(u * 21) * sstep(0.25, 0.5, u));
    out.set(sd * (0.035 + span), 0.036 + 0.014 * Math.sin(u * Math.PI) - 0.006 * vv, 0.03 + lead - chord * vv);
  } else {
    const span = 0.29 * u, lead = -0.03 - 0.05 * u;
    const chord = 0.21 * Math.sqrt(Math.max(0, 1 - Math.pow(u, 2.4))) * (0.62 + 0.38 * Math.sin(u * Math.PI)) * (1 + 0.1 * Math.cos(u * 16) * sstep(0.2, 0.5, u)) + 0.07 * Math.exp(-((u - 0.55) ** 2) / 0.012);
    out.set(sd * (0.03 + span), 0.03 + 0.01 * Math.sin(u * Math.PI) - 0.008 * vv, lead - chord * vv);
  }
  return out;
}
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
    const color = { fur: 0x5c5266, furL: 0xb4a9bc, dark: 0x1e1924, wing: 0xffffff, wingH: 0xffff00, eye: 0xffffff, glowD: 0x9a9a9a };
    const group = { fur: 'body', furL: 'body', dark: 'body', wing: 'wing', wingH: 'wing', eye: 'glow', glowD: 'glow' };
    const built = bakeType(d, (S) => {
      const fuzz = (f, a) => (dd, p) => { p.multiplyScalar(1 + a * Math.pow(Math.abs(Math.sin(dd.x * f + dd.y * f * 0.7 + dd.z * f * 0.85)), 3)); };
      // thorax, pale ruff, head
      blob(S, 'fur', ['body'], { c: v(0, 0.012, 0.045), r: [0.072, 0.068, 0.095], ws: 20, hs: 14, fn: fuzz(17, 0.1) });
      blob(S, 'furL', ['body', ['head', 1.4]], { c: v(0, 0.02, 0.125), r: [0.07, 0.064, 0.05], ws: 20, hs: 12, fn: (dd, p) => { const lon = Math.atan2(dd.x, dd.y); p.multiplyScalar(1 + 0.2 * Math.pow(Math.abs(Math.sin(lon * 7)), 2) * sstep(0.6, -0.2, dd.z)); } });
      blob(S, 'dark', ['head'], { c: v(0, 0.02, 0.19), r: [0.046, 0.043, 0.045], ws: 14, hs: 10 });
      // abdomen: fat rings, alternating bands, a glowing tip
      const ab = [v(0, 0.0, -0.01), v(0, -0.012, -0.12), v(0, -0.032, -0.25), v(0, -0.05, -0.345)];
      const abR = (u) => 0.062 * Math.sin(Math.min(1, 0.22 + u) * Math.PI * 0.84) + 0.006;
      tube(S, 'fur', ['abd', 'abd2'], { pts: ab, seg: 16, steps: 30, ref: v(0, 1, 0), cap0: 0.6, cap1: 1, r: (u) => { const r = abR(u) * (1 + 0.1 * Math.pow(Math.abs(Math.cos(u * 6.5 * Math.PI)), 0.6)); return [r, r * 0.92]; } });
      const abC = new THREE.CatmullRomCurve3(ab);
      for (let k = 1; k < 6; k++) { const u = k / 6.5, c = abC.getPointAt(u), t = abC.getTangentAt(u), r = abR(u) * 1.02; tube(S, k === 5 ? 'glowD' : 'furL', [u < 0.5 ? 'abd' : 'abd2'], { pts: [c.clone().addScaledVector(t, -0.008), c.clone().addScaledVector(t, 0.008)], seg: 16, steps: 1, ref: v(0, 1, 0), r: [r, r * 0.92], ol: 0.3 }); }
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R';
        // compound eyes with a dark glint ring
        blob(S, 'eye', ['head'], { c: v(sd * 0.036, 0.03, 0.212), r: [0.024, 0.028, 0.024], ws: 14, hs: 10, ol: 0 });
        // combed antennae
        const a0 = v(sd * 0.02, 0.055, 0.218), a1 = v(sd * 0.06, 0.135, 0.3), a2 = v(sd * 0.115, 0.165, 0.37);
        const ac = new THREE.CatmullRomCurve3([a0, a1, a2]);
        tube(S, 'dark', ['ant' + n], { curve: ac, seg: 5, steps: 10, r: (u) => 0.0048 * (1 - u * 0.5), cap1: 1, capN: 2, ol: 0.5 });
        for (let k = 1; k <= 9; k++) { const u = k / 10, p = ac.getPointAt(u), L = 0.036 * Math.sin(u * Math.PI * 0.85 + 0.25); for (const s2 of [1, -1]) tube(S, 'furL', ['ant' + n], { pts: [p, p.clone().add(v(s2 * L * 0.8, L * 0.25, -L * 0.45))], seg: 3, steps: 1, r: (uu) => 0.0032 * (1 - uu * 0.6), ol: 0 }); }
        // six legs tucked under
        for (let k = 0; k < 3; k++) { const l0 = v(sd * 0.04, -0.035, 0.1 - k * 0.05); tube(S, 'dark', ['body'], { pts: [l0, l0.clone().add(v(sd * 0.045, -0.03, 0.012)), l0.clone().add(v(sd * 0.05, -0.085, 0.03 - k * 0.022)), l0.clone().add(v(sd * 0.04, -0.11, 0.045 - k * 0.03))], seg: 5, steps: 8, r: (u) => 0.0065 * (1 - u * 0.5), cap1: 1, capN: 2, ol: 0.3 }); }
        // wings (thin, two-sided; the pattern is in the material)
        for (const kind of ['hind', 'fore']) sheet(S, kind === 'fore' ? 'wing' : 'wingH', ['w' + (kind === 'fore' ? 'F' : 'H') + n], { nu: 22, nv: 9, thick: 0.004, top: true, ol: 0.5, fn: (u, vv, out) => wingAt(kind, sd, u, vv, out), inside: (p) => v(p.x, p.y - 1, p.z) });
      }
    }, color, group);
    return { def: d, built, chains: [] };
  });
}
// wing pattern in bind-pose space: dusky gradient, veins fanning from the root, pale bands,
// eye-spots whose pupils glow with `glowColor` (shared with the tier-colored glow material)
function wingMat(glowColor) {
  const m = bodyMat(0xffffff, { vertexColors: true, rim: 0.7 });
  return extendMat(m, 'wing', { uWingG: { value: glowColor } }, (sh) => {
    sh.fragmentShader = 'uniform vec3 uWingG;\nfloat _wglow = 0.0;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 w = vec2(abs(vObj.x), vObj.z);
  bool fore = vColor.b > 0.5;
  vec2 dv = w - vec2(0.03, fore ? 0.07 : -0.04);
  float r = length(dv), th = atan(dv.y, dv.x);
  float n1 = _dn(vec3(w * 38.0, 1.0)), n2 = _dn(vec3(w * 9.0, 4.0));
  vec3 base = mix(vec3(0.2, 0.17, 0.24), vec3(0.47, 0.42, 0.52), smoothstep(0.02, 0.3, r + (n2 - 0.5) * 0.08));
  base = mix(base, vec3(0.7, 0.64, 0.6), smoothstep(0.035, 0.0, abs(r - (fore ? 0.2 : 0.15) + (n2 - 0.5) * 0.05) - 0.012) * 0.7);
  base = mix(base, vec3(0.12, 0.1, 0.15), smoothstep(0.03, 0.0, abs(r - (fore ? 0.31 : 0.235) + (n2 - 0.5) * 0.04) - 0.008) * 0.8);
  float aa = fwidth(th) * r + 0.0008;
  float vein = 1.0 - smoothstep(0.0012, 0.0012 + aa * 1.5, abs(fract(th * 2.9 + 0.5) - 0.5) / 2.9 * r);
  base = mix(base, vec3(0.1, 0.085, 0.13), vein * smoothstep(0.02, 0.06, r) * 0.85);
  vec2 e = w - (fore ? vec2(0.265, 0.03) : vec2(0.17, -0.15));
  float de = length(e * vec2(1.0, fore ? 1.15 : 1.0)) / (fore ? 0.05 : 0.042);
  base = mix(base, vec3(0.86, 0.8, 0.7), 1.0 - smoothstep(0.92, 1.0, de));
  base = mix(base, vec3(0.07, 0.05, 0.1), 1.0 - smoothstep(0.7, 0.76, de));
  _wglow = 1.0 - smoothstep(0.38, 0.44, de);
  base = mix(base, vec3(0.9), (1.0 - smoothstep(0.1, 0.14, length(e / (fore ? 0.05 : 0.042) - vec2(0.12, 0.14)))) * _wglow);
  diffuseColor.rgb = diffuse * base * (0.9 + 0.2 * n1);
}`).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uWingG * _wglow * 0.55;');
  });
}
class MothRig extends CreatureRig {
  constructor() {
    const glow = glowBasic(0xc9a0ff, 2.6);
    const M = {
      body: bodyMat(0xffffff, { vertexColors: true, rim: 0.9 }),
      wing: wingMat(glow.color),
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
    rot(B.body, (s.dive ? 0.5 : Math.sin(t * 2) * 0.15 + clamp(this.velL.z * 0.04, -0.3, 0.3)) - this.hurtSp.x * 0.1, 0, clamp(-this.yawRate * 0.12, -0.5, 0.5) + this.hurtSp.x * 0.06);
    rot(B.abd, Math.sin(t * 3.1) * 0.12 - 0.05, Math.sin(t * 2.2) * 0.1, 0);
    rot(B.abd2, Math.sin(t * 3.1 - 0.7) * 0.15, Math.sin(t * 2.2 - 0.5) * 0.12, 0);
    rot(B.head, Math.sin(t * 1.7) * 0.1, Math.sin(t * 1.1) * 0.2, 0);
    this.root.updateMatrixWorld(true);
  }
}
export function makeMoth() { return new MothRig(); }


// ===========================================================================
// 뿌리손 — a hand of twisted roots that swims through the soil: braided root
// forearm with glowing sap veins, a knotted palm with one lidded eye, five
// root fingers ending in thorn talons, shelf fungus and dead twigs.
const RH_FING = [[-0.3, 1.52, 0.06, 0.32, 1], [-0.1, 1.62, 0.1, 0.1, 1.05], [0.12, 1.62, 0.1, -0.1, 1], [0.32, 1.52, 0.06, -0.32, 0.9], [0.46, 1.2, 0.2, -1.1, 0.8]];
const RH_LEN = [0.36, 0.3, 0.24];
function rootHandType() {
  return creatureType('rootHand', () => {
    const d = new SkelDef();
    d.add('arm0', null, 0, -0.3, 0, [0, 0.45, 0.02]);
    d.add('arm1', 'arm0', 0, 0.45, 0.02, [0, 1.15, 0.04]);
    d.add('palm', 'arm1', 0, 1.15, 0.04, [0, 1.5, 0.06]);
    d.add('eye', 'palm', 0, 1.32, 0.36, [0, 1.4, 0.36]);
    const fingers = [];
    RH_FING.forEach(([x, y, z, rz, s], i) => {
      const dir = v(-Math.sin(rz), Math.cos(rz), 0.08).normalize();
      let p = v(x, y, z), parent = 'palm';
      const pts = [p.clone()], names = [];
      for (let k = 0; k < 3; k++) {
        const nm = `f${i}_${k}`;
        d.add(nm, parent, p.x, p.y, p.z);
        names.push(nm); parent = nm;
        const dd = dir.clone().applyAxisAngle(v(Math.cos(rz), Math.sin(rz), 0), 0.15 * k);
        p = p.clone().addScaledVector(dd, RH_LEN[k] * s);
        pts.push(p.clone());
      }
      fingers.push({ names, pts, axis: v(Math.cos(rz), Math.sin(rz), 0), s });
    });
    const color = { bark: 0x6b5340, barkD: 0x3a2c22, thorn: 0x1e1712, moss: 0x5f7038, fungus: 0xc9a878, fungusD: 0x8a6a48, lid: 0x2c2119, pupil: 0x0c0810, glow: 0xffffff, glowD: 0xa0a0a0 };
    const group = { glow: 'glow', glowD: 'glow' };
    const built = bakeType(d, (S) => {
      const F = new Field(S), G = new Field(S);
      // bark: long ridges that wander with the grain
      F.disp = (x, y, z) => { const a = Math.atan2(x, z), w = Math.sin(y * 2.3 + x * 3.1) * 1.6 + Math.sin(z * 4.1 - y * 1.7) * 1.2; return 0.014 * Math.sin(a * 11 + y * 1.6 + w) + 0.008 * Math.sin(a * 23 - y * 2.3 + w * 1.7); };
      F.dispAmp = 0.022;
      // forearm: a braid of thick roots around a heartwood, swelling at the wrist
      F.bind([['arm0', 1], ['arm1', 1], ['palm', 1.3]], 0.05).limb([v(0, -0.4, 0), v(0.01, 0.3, 0.01), v(-0.01, 0.8, 0.03), v(0, 1.15, 0.045)], [0.36, 0.3, 0.25, 0.27]);
      G.bind([['arm0', 1], ['arm1', 1], ['palm', 1.3]], 0.05).limb([v(0, -0.4, 0), v(0.01, 0.3, 0.01), v(-0.01, 0.8, 0.03), v(0, 1.2, 0.045)], [0.33, 0.27, 0.22, 0.24]);
      for (let k = 0; k < 5; k++) {
        const pts = [], rad = [];
        for (let q = 0; q <= 7; q++) { const u = q / 7, a = k * 1.257 + u * 2.6 * (k % 2 ? 1 : -0.8), r = mix(0.42, 0.25, Math.pow(u, 0.8)); pts.push(v(Math.sin(a) * r, mix(-0.35, 1.2, u), Math.cos(a) * r * 0.92 + 0.02 * u)); rad.push(mix(0.14, 0.085, u) * (1 + 0.15 * Math.sin(k + q * 1.7))); }
        F.bind([['arm0', 1], ['arm1', 1], ['palm', 1.3]], 0.035).limb(pts, rad);
      }
      // palm: knotted mass with knuckle burls
      F.bind(['palm', ['arm1', 1.7]], 0.08).ell(v(0, 1.34, 0.05), [0.44, 0.3, 0.27]);
      for (const [x, y, z, r] of [[-0.3, 1.5, 0.08, 0.1], [-0.1, 1.6, 0.12, 0.105], [0.12, 1.6, 0.12, 0.1], [0.32, 1.5, 0.08, 0.09], [0.42, 1.22, 0.18, 0.1], [-0.36, 1.2, 0.1, 0.11]]) F.ell(v(x, y, z), [r, r * 0.9, r], { k: 0.05 });
      G.bind(['palm'], 0.05).ell(v(0, 1.34, 0.05), [0.4, 0.262, 0.232]);
      // fingers: tapering roots with swollen joints
      fingers.forEach((f) => {
        F.bind(['palm', ...f.names], 0.035).limb(f.pts, [0.098 * f.s, 0.08 * f.s, 0.064 * f.s, 0.04 * f.s]);
        for (let k = 1; k < 3; k++) F.bind([f.names[k]], 0.03).ell(f.pts[k], [0.088 * f.s * (1 - k * 0.12), 0.07 * f.s, 0.088 * f.s * (1 - k * 0.12)], { y: f.pts[k + 1].clone().sub(f.pts[k - 1]) });
      });
      // eye socket in the palm and sap fissures spiralling up the arm
      F.bind(['palm'], 0.03).ell(v(0, 1.32, 0.3), [0.21, 0.16, 0.09], { k: 0.05 });
      F.ell(v(0, 1.32, 0.36), [0.155, 0.11, 0.12], { sub: true, k: 0.02 });
      F.groove([v(-0.25, 1.2, 0.5), v(-0.3, 1.36, 0.5), v(-0.22, 1.5, 0.5)], 0.035, 0.016);
      F.groove([v(0.3, 1.12, 0.5), v(0.33, 1.3, 0.5), v(0.26, 1.46, 0.5)], 0.035, 0.016);
      F.mesh('bark', { cell: 0.038 });
      G.mesh('glowD', { cell: 0.07, ol: 0 });
      // sap knots glowing in the folds of the braid
      for (const [a, y, r] of [[0.5, 0.42, 0.075], [-0.9, 0.86, 0.06], [3.0, 0.25, 0.075], [-2.2, 0.38, 0.055], [1.7, 0.98, 0.05], [2.4, 0.72, 0.045]]) blob(S, 'glow', [y < 0.5 ? 'arm0' : 'arm1'], { c: F.on(v(Math.sin(a) * 0.7, y, Math.cos(a) * 0.7), -r * 0.45), r: [r, r, r], ws: 10, hs: 8, ol: 0 });
      // the eye: glowing orb, slit pupil, a glint, heavy lids
      blob(S, 'glow', ['eye'], { c: v(0, 1.32, 0.33), r: [0.135, 0.1, 0.07], ws: 18, hs: 12, ol: 0 });
      blob(S, 'pupil', ['eye'], { c: v(0, 1.32, 0.392), r: [0.026, 0.078, 0.014], ws: 10, hs: 8, ol: 0 });
      blob(S, 'glow', ['eye'], { c: v(0.045, 1.355, 0.395), r: [0.016, 0.016, 0.006], ws: 6, hs: 5, ol: 0 });
      for (const sy of [1, -1]) tube(S, 'lid', ['palm'], { pts: [-1, -0.5, 0, 0.5, 1].map((t) => v(t * 0.175, 1.32 + sy * 0.1 * (1 - t * t), 0.37 - 0.05 * t * t)), seg: 8, steps: 14, ref: v(0, 0, 1), cap0: 1, cap1: 1, r: (u) => [0.012 + 0.024 * Math.sin(u * Math.PI), 0.02 + 0.014 * Math.sin(u * Math.PI)] });
      // thorn talons, dead twigs at the knuckles, thorns on the wrist
      fingers.forEach((f, i) => {
        const tip = f.pts[3], dir = tip.clone().sub(f.pts[2]).normalize();
        spike(S, 'thorn', [f.names[2]], tip.clone().addScaledVector(dir, -0.04), dir, 0.3 * f.s, 0.05 * f.s, { bend: v(0, 0, 0.55), ridge: 0.06, rings: 22, seg: 10, steps: 12 });
        if (i < 4) { const b = F.on(f.pts[1].clone().add(v(0, 0, -0.2)), -0.01); spike(S, 'barkD', [f.names[0]], b, v((i - 1.5) * 0.3, 0.6, -1), 0.2, 0.018, { bend: v(0, 0.6, 0), seg: 6, taper: 0.6 }); }
      });
      for (let k = 0; k < 7; k++) { const a = k * 0.9 + 0.3, b = F.on(v(Math.sin(a) * 0.6, 0.75 + (k % 3) * 0.13, Math.cos(a) * 0.6), -0.015); spike(S, 'thorn', ['arm1'], b, v(Math.sin(a), 0.5, Math.cos(a)), 0.13 + (k % 2) * 0.05, 0.03, { bend: v(0, 0.5, 0), seg: 7 }); }
      // shelf fungus and moss
      for (const [a, y, s] of [[2.3, 0.5, 1], [2.6, 0.68, 0.75], [-1.2, 0.35, 0.85], [-1.0, 0.9, 0.6]]) {
        const c = F.on(v(Math.sin(a) * 0.7, y, Math.cos(a) * 0.7), -0.03), o = v(c.n.x, 0, c.n.z).normalize();
        blob(S, 'fungus', [y < 0.45 ? 'arm0' : 'arm1'], { c: c.clone().addScaledVector(o, 0.07 * s), r: [0.15 * s, 0.035 * s, 0.15 * s], ws: 16, hs: 8, fn: (dd, p) => { if (dd.y < 0) p.y *= 0.4; p.multiplyScalar(1 + 0.06 * Math.sin(Math.atan2(dd.x, dd.z) * 9)); } });
        blob(S, 'fungusD', [y < 0.45 ? 'arm0' : 'arm1'], { c: c.clone().addScaledVector(o, 0.07 * s).add(v(0, -0.012 * s, 0)), r: [0.135 * s, 0.022 * s, 0.135 * s], ws: 14, hs: 6, ol: 0 });
      }
      for (const [x, y, z] of [[-0.34, 1.52, -0.12], [0.3, 1.0, -0.2], [0.05, 1.56, -0.2], [-0.25, 0.6, 0.3]]) { const c = F.on(v(x, y, z), -0.02); blob(S, 'moss', [y > 1.15 ? 'palm' : 'arm1'], { c, r: [0.15, 0.06, 0.13], ws: 12, hs: 8, ol: 0.4, fn: (dd, p) => p.multiplyScalar(0.8 + 0.4 * vnoise3(dd.x * 4 + x * 7, dd.y * 4, dd.z * 4)) }); }
      const lt = new THREE.Color(0x8a6e52);
      return { fields: [F], aoR: 0.09, ao: 0.7, fn: (key, p, n, c) => { if (key === 'bark') { const a = Math.atan2(p.x, p.z); c.lerp(lt, 0.5 * sstep(0.2, 0.8, 0.5 + 0.5 * Math.sin(a * 11 + p.y * 1.6 + Math.sin(p.y * 2.3 + p.x * 3.1) * 1.6 + Math.sin(p.z * 4.1 - p.y * 1.7) * 1.2))).multiplyScalar(0.8 + 0.3 * sstep(-0.2, 1.9, p.y)); } } };
    }, color, group);
    // dirt mound (rigid, stays at ground level) and the root tips that show while it swims
    const mound = rigidType((S) => {
      const F = new Field(S); F.bind('r', 0.1);
      F.disp = (x, y, z) => (vnoise3(x * 5, y * 5, z * 5) - 0.5) * 0.05; F.dispAmp = 0.03;
      F.ell(v(0, -0.36, 0), [0.98, 0.5, 0.98]);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.4, r = 0.95 + (i % 3) * 0.08; F.ell(v(Math.cos(a) * r, -0.02, Math.sin(a) * r), [0.2 + (i % 3) * 0.06, 0.11 + (i % 2) * 0.04, 0.17], { k: 0.06, rot: [0, a, 0] }); }
      F.ell(v(0, 0.15, 0), [0.58, 0.3, 0.58], { sub: true, k: 0.12 });
      F.mesh('dirt', { cell: 0.05 });
      for (let i = 0; i < 6; i++) { const a = i * 1.1 + 0.2, r = 0.8 + (i % 2) * 0.22, s = 0.07 + (i % 3) * 0.025; blob(S, 'rock', 'r', { c: v(Math.cos(a) * r, 0.05, Math.sin(a) * r), r: [s * 1.3, s, s * 1.1], ws: 12, hs: 8, fn: (dd, p) => p.multiplyScalar(0.85 + 0.3 * vnoise3(dd.x * 1.5 + i, dd.y * 1.5, dd.z * 1.5)) }); }
      const dk = new THREE.Color(0x2f251c);
      return { fields: [F], aoR: 0.12, ao: 0.6, fn: (key, p, n, c) => { if (key === 'dirt') c.lerp(dk, 0.6 * sstep(0.75, 0.4, Math.hypot(p.x, p.z))).multiplyScalar(0.85 + 0.25 * vnoise3(p.x * 6, p.y * 6, p.z * 6)); } };
    }, { dirt: 0x64513c, rock: 0x77726c });
    const tips = rigidType((S) => {
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; spike(S, 'bark', 'r', v(Math.cos(a) * 0.4, -0.05, Math.sin(a) * 0.4), v(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3), 0.42, 0.07, { bend: v(-Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4), ridge: 0.08, rings: 18, seg: 8 }); }
    }, { bark: 0x6b5340 });
    return { def: d, built, chains: [], fingers, mound, tips };
  });
}
const _qa = new THREE.Quaternion();
class RootHandRig extends CreatureRig {
  constructor() {
    const T = rootHandType();
    const glow = glowBasic(0xc9a0ff, 2.6);
    const M = { main: bodyMat(0xffffff, { vertexColors: true, rim: 0.5 }), glow };
    super(T, M, { main: 'main', outline: 0.012, bsPad: 1 });
    const dirt = bodyMat(0xffffff, { vertexColors: true, rim: 0.2 });
    this.mats.push(dirt);
    const mound = (this.mound = new THREE.Group()); this.root.add(mound);
    const mm = new THREE.Mesh(T.mound, dirt); mm.castShadow = true; mm.receiveShadow = true; mound.add(mm);
    const tips = (this.tips = new THREE.Mesh(T.tips, dirt)); tips.castShadow = true; mound.add(tips);
    this.fingers = T.fingers.map((F) => ({ bones: F.names.map((n) => this.B[n]), axis: F.axis }));
    this.t = rand() * 5; this.height = 2.2; this.emerge = 0; this.grip = 0.3; this.droop = 0;
    this.p = { head: this.B.palm, torso: this.B.arm1, hips: this.B.arm0, foreR: this.B.palm };
  }
  update(dt, s = {}) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.t += dt;
    const t = this.t, B = this.B;
    this.motion(dt);
    const e = s.emerge ?? 1;
    this.emerge = e;
    this.body.position.y = -2.5 * (1 - e) + (s.strike ? 0.25 : 0);
    this.body.visible = e > 0.02;
    this.tips.visible = e < 0.6;
    this.mound.scale.setScalar(0.75 + 0.45 * e);
    const want = s.dead ? 1.2 : s.strike ? -0.35 : s.grip ?? 0.35;
    this.grip = damp(this.grip, want, s.strike ? 20 : 8, dt);
    this.fingers.forEach((f, i) => f.bones.forEach((b, k) => {
      const ang = this.grip * (0.45 + k * 0.25) + Math.sin(t * 3.2 + i * 1.3 + k) * 0.1 * (s.dead ? 0 : 1);
      b.quaternion.setFromAxisAngle(f.axis, ang);
    }));
    this.droop = damp(this.droop, s.dead ? 1 : s.stagger ? 0.4 : 0, 4, dt);
    const sh = s.shock ? (rand() - 0.5) * 0.15 : 0;
    rot(B.arm0, Math.sin(t * 1.1) * 0.04 + this.droop * 0.5 + (s.strike ? -0.1 : 0), Math.sin(t * 0.7) * 0.1, Math.sin(t * 1.3) * 0.05 * (1 - this.droop) + sh);
    rot(B.arm1, Math.sin(t * 1.1 - 0.6) * 0.05 + this.droop * 0.4 - this.hurtSp.x * 0.05, 0, Math.sin(t * 1.3 - 0.8) * 0.05);
    rot(B.palm, Math.sin(t * 1.4) * 0.06 + (s.strike ? -0.15 : 0), Math.sin(t * 0.9) * 0.1, 0);
    const sc = s.strike ? 1.12 : 1;
    B.arm0.scale.y = damp(B.arm0.scale.y, sc, 14, dt);
    B.eye.scale.set(1, s.dead ? 0.2 : 0.85 + Math.max(0, Math.sin(t * 0.6)) * 0.15, 1);
    this.root.updateMatrixWorld(true);
  }
}
export function makeRootHand() { return new RootHandRig(); }


// ===========================================================================
// 망루지기 — a forgotten watchtower that walks: a drum of dressed stone under a
// crown of battlements, glowing arrow-slits, brass bands; a turning lantern
// head with one great lidded eye under a tiled cap and spire; three jointed legs.
function watcherType() {
  return creatureType('watcher', () => {
    const d = new SkelDef();
    d.add('body', null, 0, 2.2, 0, [0, 2.6, 0]);
    d.add('head', 'body', 0, 2.65, 0, [0, 3.6, 0]);
    d.add('eye', 'head', 0, 3.17, 0.8, [0, 3.17, 1.0]);
    const legs = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + Math.PI / 3;
      const out = v(Math.sin(a), 0, Math.cos(a));
      const hip = v(out.x * 0.7, 2.0, out.z * 0.7);
      const knee = hip.clone().addScaledVector(out, 0.71).add(v(0, -0.9, 0));
      const foot = knee.clone().addScaledVector(out, 0.08).add(v(0, -1.1, 0));
      d.add('hip' + i, 'body', hip.x, hip.y, hip.z, knee.toArray());
      d.add('knee' + i, 'hip' + i, knee.x, knee.y, knee.z, foot.toArray());
      d.add('foot' + i, 'knee' + i, foot.x, foot.y, foot.z, foot.clone().add(v(0, -0.1, 0)).toArray());
      legs.push({ a, out, hip, knee, foot });
    }
    const color = { stone: 0x8a8492, stoneD: 0x5c5666, stoneL: 0xa49eaa, mortar: 0x3a3542, moss: 0x5a6a44, brass: 0xa08452, brassD: 0x6e5a3a, tile: 0x4a4e6a, glow: 0xffffff, glowD: 0xa0a0a0, eye: 0xffffff, pupil: 0x120a18, void: 0x0c0a12 };
    const group = { brass: 'metal', brassD: 'metal', glow: 'glow', glowD: 'glow', eye: 'eye' };
    const megalith = (S, A, mat, w, c, h, rotn, o = {}) => megalithBlock(S, A, mat, w, c, h, { ...o, rot: rotn });
    const built = bakeType(d, (S) => {
      const A = new Field(S);
      const circ = (r, y, n = 24, z = 0) => ring(n, (a) => v(Math.sin(a) * r, y, Math.cos(a) * r + z));
      // dressed-stone courses: a ring of blocks with open joints over a dark core
      const course = (w, y, h, r, n, off, mats, o = {}) => {
        for (let k = 0; k < n; k++) {
          const a = ((k + off) / n) * TAU, cw = (Math.PI * r / n) * 0.93, dp = o.depth ?? 0.13;
          const c = v(Math.sin(a) * (r - dp), y + h / 2, Math.cos(a) * (r - dp));
          megalith(S, A, mats[(k * 7 + Math.round(y * 3)) % mats.length], w, c, [cw, h / 2 * 0.95, dp], [0, a, 0], { n: 5, ws: 10, hs: 8 });
        }
      };
      tube(S, 'mortar', ['body'], { pts: [v(0, 1.72, 0), v(0, 2.2, 0), v(0, 2.62, 0)], seg: 24, steps: 6, ref: v(0, 0, 1), r: (u) => mix(0.62, 0.86, sstep(0, 0.4, u)), flat0: true, flat1: true, ol: 0 });
      course(['body'], 1.72, 0.2, 0.74, 9, 0, ['stoneD', 'stone']);
      course(['body'], 1.93, 0.22, 0.9, 10, 0.5, ['stone', 'stoneL', 'stone']);
      course(['body'], 2.16, 0.22, 0.98, 11, 0, ['stone', 'stoneD', 'stoneL']);
      course(['body'], 2.39, 0.2, 0.98, 11, 0.5, ['stoneL', 'stone']);
      // glowing arrow-slits between the blocks, brass bands, battlements
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.26, n = v(Math.sin(a), 0, Math.cos(a)); prism(S, 'glow', ['body'], [2.0, 2.36].map((y) => ring(4, (b) => n.clone().multiplyScalar(0.9 + 0.02 * Math.cos(b)).add(v(Math.cos(a) * 0.035 * Math.sin(b), y, -Math.sin(a) * 0.035 * Math.sin(b))))), { ol: 0 }); }
      tube(S, 'brass', ['body'], { pts: circ(1.0, 2.15), closed: true, seg: 6, steps: 48, r: [0.035, 0.05], ref: v(0, 1, 0) });
      tube(S, 'brass', ['body'], { pts: circ(1.03, 2.6), closed: true, seg: 8, steps: 48, r: [0.05, 0.07], ref: v(0, 1, 0) });
      tube(S, 'brassD', ['body'], { pts: circ(0.8, 1.72), closed: true, seg: 6, steps: 40, r: [0.05, 0.05], ref: v(0, 1, 0) });
      for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU; megalith(S, A, k % 2 ? 'stone' : 'stoneL', ['body'], v(Math.sin(a) * 0.95, 2.76, Math.cos(a) * 0.95), [0.19, 0.13, 0.1], [0, a, 0], { n: 6, ws: 12, hs: 8, cuts: k % 4 === 1 ? [[1, 1, 0, 1.15]] : null }); }
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.5; blob(S, 'moss', ['body'], { c: v(Math.sin(a) * 0.93, 2.9 - (i % 2) * 0.24, Math.cos(a) * 0.96), r: [0.2, 0.06, 0.13], ws: 12, hs: 6, ol: 0.4, fn: (dd, p) => { p.multiplyScalar(0.8 + 0.4 * vnoise3(dd.x * 4 + i, dd.y * 4, dd.z * 4)); p.applyAxisAngle(_w.set(0, 1, 0), a); } }); }
      // head: stone collar, lantern drum of pillars around a lit core, tiled cap, spire
      course(['head'], 2.66, 0.2, 0.8, 9, 0.3, ['stoneD', 'stone']);
      tube(S, 'mortar', ['head'], { pts: [v(0, 2.66, 0), v(0, 2.86, 0)], seg: 20, steps: 1, r: 0.64, flat1: true, ref: v(0, 0, 1), ol: 0 });
      blob(S, 'glowD', ['head'], { c: v(0, 3.17, -0.05), r: [0.5, 0.36, 0.5], ws: 16, hs: 10, ol: 0 });
      for (let k = 0; k < 8; k++) { const a = ((k + 0.5) / 8) * TAU; if (Math.abs(a - TAU) < 0.5 || a < 0.5) continue; megalith(S, A, k % 2 ? 'stone' : 'stoneL', ['head'], v(Math.sin(a) * 0.7, 3.17, Math.cos(a) * 0.7), [0.105, 0.33, 0.1], [0, a, 0], { n: 5, ws: 12, hs: 10 }); }
      tube(S, 'brass', ['head'], { pts: circ(0.8, 2.87), closed: true, seg: 6, steps: 40, r: [0.04, 0.06], ref: v(0, 1, 0) });
      tube(S, 'brass', ['head'], { pts: circ(0.82, 3.5), closed: true, seg: 6, steps: 40, r: [0.05, 0.07], ref: v(0, 1, 0) });
      sheet(S, 'tile', ['head'], { nu: 36, nv: 8, wrap: true, thick: 0.03, fn: (u, vv, q) => { const a = u * TAU, r = mix(0.06, 1.02, Math.pow(vv, 0.85)) * (1 + 0.035 * Math.pow(Math.abs(Math.sin(a * 6)), 0.5) * vv); q.set(Math.sin(a) * r, 4.08 - vv * 0.56 - 0.1 * vv * vv + 0.02 * Math.pow(Math.abs(Math.sin(vv * 5 * Math.PI)), 6), Math.cos(a) * r); }, inside: (p) => v(p.x * 0.8, p.y - 1, p.z * 0.8) });
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; tube(S, 'brassD', ['head'], { pts: [0, 0.3, 0.65, 1].map((vv) => { const r = mix(0.07, 1.04, Math.pow(vv, 0.85)); return v(Math.sin(a) * r, 4.1 - vv * 0.56 - 0.1 * vv * vv, Math.cos(a) * r); }), seg: 6, steps: 10, r: 0.028, cap1: 1 }); }
      spike(S, 'brass', ['head'], v(0, 4.02, 0), v(0, 1, 0), 0.5, 0.13, { ridge: 0.3, rings: 12, seg: 10, steps: 14 });
      blob(S, 'brass', ['head'], { c: v(0, 4.08, 0), r: [0.13, 0.07, 0.13], ws: 12, hs: 8 });
      // the eye: brass iris ring, stone lids, lens and slit pupil
      megalith(S, A, 'stoneD', ['head'], v(0, 3.17, 0.6), [0.5, 0.42, 0.13], [0, 0, 0], { n: 4, ws: 20, hs: 14 });
      blob(S, 'void', ['head'], { c: v(0, 3.17, 0.7), r: [0.35, 0.35, 0.08], ws: 16, hs: 8, ol: 0 });
      tube(S, 'brass', ['head'], { pts: ring(20, (a) => v(Math.sin(a) * 0.38, 3.17 + Math.cos(a) * 0.38, 0.74)), closed: true, seg: 8, steps: 40, r: [0.05, 0.06], ref: v(0, 0, 1) });
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + 0.39; blob(S, 'brassD', ['head'], { c: v(Math.sin(a) * 0.38, 3.17 + Math.cos(a) * 0.38, 0.8), r: [0.028, 0.028, 0.02], ws: 8, hs: 6 }); }
      for (const sy of [1, -1]) tube(S, 'stoneL', ['head'], { pts: [-1, -0.5, 0, 0.5, 1].map((t) => v(t * 0.36, 3.17 + sy * (0.3 - 0.14 * t * t), 0.8 - 0.06 * t * t)), seg: 10, steps: 14, ref: v(0, 0, 1), cap0: 1, cap1: 1, r: (u) => [0.03 + 0.07 * Math.sin(u * Math.PI), 0.05] });
      blob(S, 'eye', ['eye'], { c: v(0, 3.17, 0.8), r: [0.27, 0.27, 0.13], ws: 20, hs: 12, ol: 0 });
      blob(S, 'pupil', ['eye'], { c: v(0, 3.17, 0.925), r: [0.065, 0.14, 0.02], ws: 12, hs: 8, ol: 0 });
      // legs: stone thigh and shin beams in brass sockets, lit knee joints, three-toed feet
      legs.forEach((L, i) => {
        const w0 = ['hip' + i], w1 = ['knee' + i], w2 = ['foot' + i], lat = v(Math.cos(L.a), 0, -Math.sin(L.a));
        const beam = (w, a, b, r, mat) => { const c = a.clone().lerp(b, 0.5), dir = b.clone().sub(a), q = new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), dir.clone().normalize()), e = new THREE.Euler().setFromQuaternion(q); megalith(S, A, mat, w, c, [r, dir.length() / 2, r], [e.x, e.y, e.z], { n: 6, ws: 12, hs: 12, taper: -0.12 }); };
        blob(S, 'brass', w0, { c: L.hip, r: [0.25, 0.25, 0.25], ws: 14, hs: 10 });
        blob(S, 'glowD', w0, { c: L.hip.clone().addScaledVector(L.out, 0.06), r: [0.215, 0.215, 0.215], ws: 10, hs: 8, ol: 0 });
        beam(w0, L.hip.clone().lerp(L.knee, 0.14), L.hip.clone().lerp(L.knee, 0.86), 0.16, 'stone');
        tube(S, 'brassD', w0, { pts: [L.hip.clone().lerp(L.knee, 0.45), L.hip.clone().lerp(L.knee, 0.55)], seg: 4, steps: 1, r: 0.21, ref: lat, twist: () => Math.PI / 4, flat0: true, flat1: true });
        blob(S, 'glow', w1, { c: L.knee, r: [0.16, 0.16, 0.16], ws: 12, hs: 8, ol: 0 });
        for (const s2 of [1, -1]) tube(S, 'brass', w1, { pts: [L.knee.clone().addScaledVector(lat, s2 * 0.13), L.knee.clone().addScaledVector(lat, s2 * 0.22)], seg: 12, steps: 1, r: 0.2, flat0: true, flat1: true, ref: v(0, 1, 0) });
        beam(w1, L.knee.clone().lerp(L.foot, 0.12), L.foot.clone().add(v(0, 0.2, 0)), 0.135, 'stoneD');
        megalith(S, A, 'stone', w2, L.foot.clone().add(v(0, 0.1, 0)), [0.26, 0.1, 0.26], [0, L.a, 0], { n: 4, ws: 14, hs: 8, taper: -0.25 });
        for (let k = -1; k <= 1; k++) { const b = L.a + k * 0.85, o2 = v(Math.sin(b), 0, Math.cos(b)); spike(S, 'brass', w2, L.foot.clone().addScaledVector(o2, 0.2).add(v(0, 0.09, 0)), v(o2.x, -0.12, o2.z), 0.3, 0.085, { bend: v(0, -0.35, 0), seg: 8, flat: 0.75, ref: v(0, 1, 0) }); }
      });
      return { fields: [A], aoR: 0.12, ao: 0.6, skip: (k, g) => g === 'glow' || g === 'eye', fn: (key, p, n, c) => { if (key.startsWith('stone')) c.multiplyScalar(0.84 + 0.26 * Math.max(0, n.y) - 0.12 * sstep(1.0, 0, p.y)); if (key === 'tile') c.multiplyScalar(0.8 + 0.4 * sstep(3.5, 4.1, p.y)); } };
    }, color, group);
    return { def: d, built, chains: [], legs };
  });
}
class WatcherRig extends CreatureRig {
  constructor() {
    const T = watcherType();
    const glow = glowBasic(0xc9a0ff, 2.6);
    const eyeM = glowBasic(0xffc070, 2.2);
    const M = { main: bodyMat(0xffffff, { vertexColors: true, rim: 0.6 }), metal: sheen(bodyMat(0xffffff, { vertexColors: true, rim: 0.9 }), { color: 0xfff0d0, size: 0.09, soft: 0.03, k: 0.45, fres: 0.25 }), glow, eye: eyeM };
    super(T, M, { main: 'main', outline: 0.02, bsPad: 1 });
    this.glowMats = [glow];
    this.eyeMat = eyeM;
    const B = this.B;
    this.head = B.head; this.eye = B.eye;
    const tip = (this.eyeTip = new THREE.Object3D());
    tip.position.set(0, 3.17 - 2.65, 1.0);
    B.head.add(tip);
    this.legs = T.legs.map((L, i) => ({ ...L, hip: B['hip' + i], knee: B['knee' + i], foot: B['foot' + i], lat: v(Math.cos(L.a), 0, -Math.sin(L.a)) }));
    this.t = rand() * 5; this.height = 3.9; this.walk = 0; this.sink = 0;
    this.hy = 0; this.hp = 0;
    this.p = { head: B.head, torso: B.body, hips: B.body };
  }
  update(dt, s = {}) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.t += dt;
    const t = this.t, B = this.B;
    this.motion(dt);
    const sp = s.speed ?? 0;
    this.walk += dt * sp * 2.2;
    const stomp = s.stomp ?? 0;
    this.sink = damp(this.sink, s.dead ? 1 : 0, 3, dt);
    this.legs.forEach((L, i) => {
      const ph = this.walk + i * 2.1;
      const lift = Math.max(0, Math.sin(ph)) * Math.min(1, sp / 2);
      const swing = Math.cos(ph) * 0.2 * Math.min(1, sp / 2);
      // hip: yaw swing + raise; knee counter-bends to keep the foot under
      _qa.setFromAxisAngle(L.lat, -(lift * 0.35 + stomp * 0.3 - 0.3 * this.sink));
      L.hip.quaternion.setFromAxisAngle(_w.set(0, 1, 0), swing).multiply(_qa);
      L.knee.quaternion.setFromAxisAngle(L.lat, lift * 0.5 + stomp * 0.25 + this.sink * 0.6);
      L.foot.quaternion.setFromAxisAngle(L.lat, -lift * 0.2);
    });
    B.body.position.y = this.rest.body.y + Math.sin(t * 2) * 0.04 + Math.abs(Math.sin(this.walk)) * 0.06 - this.sink * 1.1 + stomp * 0.5;
    this.hy = damp(this.hy, s.headYaw ?? 0, s.headK ?? 6, dt);
    this.hp = damp(this.hp, s.headPitch ?? 0, 6, dt);
    rot(B.head, this.hp, this.hy, 0);
    const c = s.charge ?? 0;
    B.eye.scale.set(1 + c * 0.35, (1 + c * 0.35) * (s.dead ? 0.3 : 1), 1);
    rot(B.body, -this.hurtSp.x * 0.015, 0, (s.stagger ? Math.sin(t * 5) * 0.08 : 0) + this.hurtSp.x * 0.01);
    this.root.updateMatrixWorld(true);
  }
}
export function makeWatcher() { return new WatcherRig(); }
