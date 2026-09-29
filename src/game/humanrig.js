// Humanoid rig: type building (geometry + skeleton per CHAR entry), procedural
// animation, faces, expressions and gestures. See characters.js for the contract.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { toon, addOutline, glowMat, ghostMat, fresnelMat } from '../render/materials.js';
import { damp, clamp, lerp, rand } from '../core/util.js';
import { Sculpt, tube, blob, sheet, prof, sstep, mix, TAU, instance, bodyMat, faceMat, crackMat, ghostSkinMat, ik2, setWorldQuat, rotateTowards, Chain, Spring, SkelDef } from './charkit.js';
import * as HB from './humanoid.js';

const V3 = THREE.Vector3;
const _v1 = new V3(), _v2 = new V3(), _v3 = new V3(), _v4 = new V3(), _v5 = new V3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const _m1 = new THREE.Matrix4();
const wrapA = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const ease = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------------------
// Preset characters. Legacy fields (top, pants, robe, cape, hat, ...) are kept.
export const CHAR = {
  player: { skin: 0xf3d2b2, top: 0xeee2c4, pants: 0x3e4a5e, boots: 0x6a4a30, hair: 0x5a3a26, hairStyle: 'fringe', hat: 'hood', hatColor: 0x2f5a8a, cape: 0x2f5a8a, lining: 0x1e2c48, capeLen: 0.62, scarf: 0xc8463c, staff: {}, belt: 0x7a5a38, sleeve: 0xeee2c4, gloves: 0x6a4a30, outline: true, brows: true, eyeColor: 0x3e6a8a, tunic: 0xeee2c4, tunicLen: 0.3, mantle: true, pouch: true, bootH: 0.55 },
  mora: { scale: 0.86, skin: 0xefcdb4, top: 0x6a4a8a, robe: 0x5a3a7a, robeLen: 0.72, robeFlare: 1.3, pants: 0x3a2a4a, hair: 0xe8e4e0, hairStyle: 'bun', hat: 'witch', hatColor: 0x4a3070, hatBand: 0xd8a860, hunch: 0.28, glasses: true, cane: true, sleeve: 0x6a4a8a, sleeveFlare: true, blush: true, outline: true, cape: 0x8a6a5a, capeLen: 0.5, age: 1, eyeColor: 0x5a4a3a, shawl: 0x8a6a5a, fem: 1, browColor: 0xc8c4c0, bootH: 0 },
  bau: { scale: 1.08, bodyW: 1.35, belly: true, skin: 0xe6b894, top: 0x8a6a4a, vest: 0x5a4030, pants: 0x4a3a2a, hairStyle: 'bald', hair: 0xf0f0f0, beard: 0xf0f0f0, mustache: true, spear: true, brows: true, outline: true, age: 0.8, bushyBrows: true, nose: 1.4, eyeColor: 0x4a3a2a, bareArms: true, sleeveShort: 'top', limb: 1.15, bootH: 0.35 },
  dodam: { scale: 0.68, skin: 0xf6d6b8, top: 0x6aa0d8, pants: 0x7a5a3a, hair: 0x3a2a1a, hairStyle: 'spiky', hat: 'cap', hatColor: 0xe07a3a, blush: true, outline: true, stride: 2.6, headR: 0.19, kid: 1, freckles: 0.8, eyeColor: 0x3a2a1a, legLen: 0.72, torsoLen: 0.9, bootH: 0.3, pantsLoose: 0.012 },
  isol: { scale: 1.02, skin: 0xf0d0b4, top: 0x3f7a5a, sleeve: 0x3f7a5a, pants: 0x3a3a44, hair: 0x2a2030, hairStyle: 'bob', glasses: true, book: true, satchel: true, scarf: 0xd8c070, outline: true, eyeColor: 0x2a3a4a, bodyW: 0.9, legLen: 0.82, limb: 0.92, tunic: 0x3f7a5a, tunicLen: 0.38, belt: 0x4a3a2a },
  danbi: { scale: 0.96, bodyW: 1.25, belly: true, skin: 0xf0c8a4, top: 0xd87a5a, robe: 0xc06a4a, robeLen: 0.7, apron: 0xf4ecd8, hair: 0x6a3a24, hat: 'scarf', hatColor: 0xe8c050, hatBand: 0xd8a840, blush: true, outline: true, fem: 1, faceRound: 1, eyeColor: 0x4a2a1a, sleeve: 0xd87a5a, age: 0.3 },
  villagerA: { scale: 1.0, skin: 0xe8c0a0, top: 0x9a7a4a, pants: 0x4a4a3a, hair: 0x2a2a2a, hairStyle: 'short', outline: true, belt: 0x5a4028, eyeColor: 0x2a2018 },
  villagerB: { scale: 0.95, skin: 0xf2d0b0, top: 0x7a9a6a, robe: 0x5a7a5a, pants: 0x3a3a2a, hair: 0x8a5a2a, hairStyle: 'long', outline: true, fem: 1, eyeColor: 0x3a5a3a, belt: 0x6a5030 },
  villagerC: { scale: 0.9, skin: 0xe0b890, top: 0xa05a4a, pants: 0x4a3a3a, hair: 0xd0d0d0, hairStyle: 'short', beard: 0xd0d0d0, hunch: 0.2, cane: true, outline: true, age: 1, eyeColor: 0x3a3028, beardLen: 1.2, belt: 0x4a3024 },
  seha: { scale: 0.98, skin: 0xf2d4b8, top: 0xdde8f4, robe: 0x9ac0e0, robeLen: 0.78, hair: 0x5a3a26, hairStyle: 'long', scarf: 0xc8463c, outline: false, fem: 1, eyeColor: 0x3e6a8a, hairLen: 0.5 },
  kael: { scale: 1.18, bodyW: 1.2, skin: 0xe0c0a0, top: 0x7a7a88, pants: 0x4a4a54, hat: 'helmet', hatColor: 0x9a9aa8, plume: 0x3a6ad0, cape: 0x2a4a9a, lining: 0x1a2a5a, capeLen: 0.95, outline: false, armor: true, metal: 0x9a9aa8, gloves: 0x5a5a66, boots: 0x5a5a66, eyeColor: 0x3a4a6a, hairStyle: 'none', noEars: true },
};

// colors for material keys
function palette(c) {
  const dk = (x, k) => new THREE.Color(x).multiplyScalar(k).getHex();
  return {
    skin: c.skin ?? 0xf2cfae, top: c.top ?? 0xe8dcc0, sleeve: c.sleeve ?? c.top ?? 0xe8dcc0, pants: c.pants ?? 0x5a4a3a, boots: c.boots ?? 0x5a3e2a,
    sole: dk(c.boots ?? 0x5a3e2a, 0.45), hair: c.hair ?? 0x5a3a24, pin: 0xc89a48, hat: c.hatColor ?? 0x5a3a8a, hatBand: c.hatBand ?? 0xd8b060,
    scarf: c.scarf ?? 0xc8463c, cape: c.cape ?? 0x2f4a7a, lining: c.lining ?? dk(c.cape ?? 0x2f4a7a, 0.55), belt: c.belt ?? 0x6a4a2a, buckle: 0xc8a050,
    glove: c.gloves ?? 0x6a4a30, beard: c.beard ?? c.hair ?? 0xe0e0e0, frame: 0x3a3028, metal: c.metal ?? c.hatColor ?? 0x9a9aa8, trim: 0xb89a58, visor: 0x101014,
    plume: c.plume ?? 0x3a6ad0, satchel: 0x8a6a44, strap: 0x5a4028, apron: c.apron ?? 0xf4ecd8, vest: c.vest ?? 0x5a4030, robe: c.robe ?? c.top ?? 0x7a6a8a,
    tunic: c.tunic ?? c.top ?? 0xe8dcc0, dark: 0x201a24, shawl: c.shawl ?? 0x8a6a5a, pouch: 0x6a4a30,
  };
}

// ---------------------------------------------------------------------------
// Humanoid type (geometry + skeleton), cached per config object
const TYPES = new Map();
// Hooks for custom types (enemies): c.bones(def, L) -> chain specs added before
// finalize; c.sculpt(S, L, def, chains) adds parts; c.group(key) -> material group
// ('skin' | 'main' | custom); c.face === false skips the painted face.
export function humanType(c) {
  let T = TYPES.get(c);
  if (T) return T;
  const t0 = performance.now();
  const L = HB.layout(c);
  const def = HB.skeleton(c, L);
  const chains = [];
  const cc = { ...c };
  // garment chains
  let capeCh = null, scarfCh = null, plumeCh = null, hairCh = null;
  if (c.cape) capeCh = HB.capeBones(def, L, c);
  if (c.scarf) scarfCh = HB.scarfBones(def, L, c);
  if (c.plume) plumeCh = HB.plumeBones(def, L);
  if (c.hairStyle === 'long') {
    hairCh = [];
    for (const [ci, x] of [[0, 0.05], [1, -0.05]]) {
      const names = []; let parent = 'head';
      const p0 = L.HC.clone().add(new V3(x, -L.hr * 0.3, -L.hr * 0.95));
      const len = (c.hairLen ?? 0.42) + L.hr * 0.3;
      for (let k = 0; k < 3; k++) { const nm = `hair${ci}_${k}`; const p = p0.clone().add(new V3(0, -k * len / 3, -0.01 * k)); def.add(nm, parent, p.x, p.y, p.z); names.push(nm); parent = nm; }
      hairCh.push({ names, tail: p0.clone().add(new V3(0, -len, -0.04)) });
    }
  }
  if (c.hat === 'hood') {
    // collapsible bones so the hood can be lowered (outline hull included)
    const hp = def.pos('head'), np = def.pos('neck'), cp = def.pos('chest');
    def.add('hoodUp', 'head', hp.x, hp.y, hp.z, [L.HC.x, L.HC.y + L.hr, L.HC.z]);
    def.add('hoodUpN', 'neck', np.x, np.y, np.z, [hp.x, hp.y, hp.z]);
    def.add('hoodDn', 'chest', cp.x, L.NY - 0.05, cp.z - 0.05, [0, L.NY + 0.05, -0.08]);
  }
  let extraCh = null;
  if (c.bones) extraCh = c.bones(def, L);
  def.finalize();
  const S = new Sculpt(def);
  if (c.body !== false) HB.body(S, L, cc, {});
  if (c.head !== false) HB.head(S, L, cc);
  if (c.hairStyle !== 'none') HB.hair(S, L, cc);
  if (hairCh) HB.hairBack(S, L, cc, hairCh.map((h) => h.names));
  if (c.beard) HB.beard(S, L, cc);
  if (c.mustache) HB.mustache(S, L, cc);
  if (c.bushyBrows) HB.bushyBrows(S, L, cc);
  if (c.glasses) HB.glasses(S, L, cc);
  if (c.armor) HB.armor(S, L, cc);
  if (c.vest) HB.vest(S, L, cc, 'vest');
  if (c.tunic) HB.skirt(S, L, cc, 'tunic', { bottom: L.H - (c.tunicLen ?? 0.3), flare: 0.5, folds: 8, uTop: 0.4, hipBias: 0.7 });
  if (c.robe) HB.skirt(S, L, cc, 'robe', { bottom: Math.max(0.05, L.H - (c.robeLen ?? 0.7)), flare: (c.robeFlare ?? 1) * 0.9, folds: 11, uTop: 0.36, nv: 7, hipBias: 0.45 });
  if (c.apron) HB.apron(S, L, cc, 'apron');
  if (c.belt || c.tunic) HB.belt(S, L, cc, 'belt', c.tunic ? 0.41 : 0.39);
  if (c.satchel) HB.satchel(S, L, cc);
  if (c.shawl) HB.mantle(S, L, cc, 'shawl', 'shawl');
  else if (c.mantle) HB.mantle(S, L, cc, 'cape', 'lining');
  if (capeCh && !c.shawl) HB.cape(S, L, cc, capeCh, 'cape', 'lining');
  if (scarfCh) HB.scarf(S, L, cc, scarfCh);
  if (c.hat === 'hood') { HB.hood(S, L, cc, 'hood', 'hoodIn', [['hoodUp', 1], ['hoodUpN', 1.5]]); HB.hoodDown(S, L, cc, 'hoodDn', 'hoodDnIn', ['hoodDn']); }
  else if (c.hat && c.hat !== 'hood') HB.hat(S, L, cc, c.hat);
  if (plumeCh) HB.plume(S, L, plumeCh[0]);
  if (c.sleeveFlare) {
    for (const sd of [1, -1]) {
      const n = sd > 0 ? 'L' : 'R';
      const el = def.pos('fore' + n), wr = def.pos('hand' + n);
      tube(S, 'sleeve', ['fore' + n, ['hand' + n, 1.5]], { pts: [el.clone().lerp(wr, 0.2), el.clone().lerp(wr, 0.7), wr.clone().lerp(el, -0.25)], seg: 14, steps: 6, r: (u) => [mix(0.05, 0.085, u * u), mix(0.05, 0.08, u * u)], shape: (u, a) => 1 + 0.08 * Math.sin(a * 5) * u, flat0: false });
    }
  }
  if (c.sculpt) c.sculpt(S, L, def, extraCh);
  const pal = { ...palette(c), ...(c.colors || {}) };
  const colorOf = (k) => pal[k] ?? (k === 'hood' || k === 'hoodDn' ? pal.cape : k === 'hoodIn' || k === 'hoodDnIn' ? pal.lining : 0xff00ff);
  const built = S.build({ color: colorOf, group: c.group || ((k) => (k === 'skin' ? 'skin' : 'main')) });
  if (capeCh) chains.push(...capeCh.map((ch) => ({ ...ch, kind: 'cape' })));
  if (scarfCh) chains.push(...scarfCh.map((ch) => ({ ...ch, kind: 'scarf' })));
  if (plumeCh) chains.push(...plumeCh.map((ch) => ({ ...ch, kind: 'plume' })));
  if (hairCh) chains.push(...hairCh.map((ch) => ({ ...ch, kind: 'hair' })));
  if (extraCh) chains.push(...extraCh);
  T = { c, L, def, built, chains, face: c.face === false ? null : HB.faceParams(c, L), pal, ms: 0 };
  // rigid props
  if (c.staff) { T.staff = HB.staffGeo(); T.gem = HB.gemGeo(); }
  if (c.cane) T.cane = HB.rigidGeo((S2) => {
    tube(S2, 'wood', 'r', { pts: [new V3(0, 0, -0.62), new V3(0.005, 0, 0), new V3(0, 0, 0.35), new V3(0, 0.05, 0.42), new V3(0, 0.12, 0.4)], seg: 7, steps: 14, ref: new V3(0, 1, 0), r: (u) => 0.016 + 0.004 * Math.sin(u * 40), cap0: 0.5, cap1: 1 });
    tube(S2, 'band', 'r', { pts: [new V3(0, 0.12, 0.4), new V3(0, 0.1, 0.32)], seg: 6, steps: 3, r: 0.008, ref: new V3(0, 1, 0) });
  }, { wood: 0x6a4a30, band: 0xc8a050 });
  if (c.spear) T.spear = HB.rigidGeo((S2) => {
    tube(S2, 'wood', 'r', { pts: [new V3(0, 0, -0.6), new V3(0, 0, 0.6), new V3(0, 0, 1.55)], seg: 7, steps: 14, ref: new V3(0, 1, 0), r: (u) => 0.02 - u * 0.004, cap0: 0.5 });
    tube(S2, 'band', 'r', { pts: [new V3(0, 0, 1.5), new V3(0, 0, 1.6)], seg: 8, steps: 2, ref: new V3(0, 1, 0), r: 0.026 });
    tube(S2, 'steel', 'r', { pts: [new V3(0, 0, 1.58), new V3(0, 0, 1.72), new V3(0, 0, 1.86)], seg: 4, steps: 6, ref: new V3(0, 1, 0), r: (u) => [0.045 * Math.sin(Math.min(1, u * 1.6 + 0.2) * Math.PI) + 0.004, 0.012], cap1: 1 });
  }, { wood: 0x7a5a3a, band: 0x9a7a48, steel: 0xc0c0c8 });
  if (c.book) T.book = HB.rigidGeo((S2) => {
    tube(S2, 'cover', 'r', { pts: [new V3(0, -0.11, 0), new V3(0, 0.11, 0)], seg: 4, steps: 1, ref: new V3(0, 0, 1), r: [0.12, 0.028], shape: (u, a) => 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))), flat0: true, flat1: true, twist: () => Math.PI / 4 });
    tube(S2, 'pages', 'r', { pts: [new V3(0.004, -0.1, 0), new V3(0.004, 0.1, 0)], seg: 4, steps: 1, ref: new V3(0, 0, 1), r: [0.11, 0.022], shape: (u, a) => 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))), flat0: true, flat1: true, twist: () => Math.PI / 4 });
  }, { cover: 0x8a3a3a, pages: 0xf0e6cc });
  T.ms = performance.now() - t0;
  TYPES.set(c, T);
  return T;
}

// ---------------------------------------------------------------------------
// Expressions (face shader targets)
const EXPR = {
  neutral: { open: 1, tilt: 0, lower: 0, happy: 0, raise: 0, btilt: 0, furrow: 0, mOpen: 0, smile: 0.12, mW: 1, round: 0 },
  smile: { open: 0.92, tilt: 0, lower: 0.4, happy: 0, raise: 0.25, btilt: 0.1, furrow: 0, mOpen: 0.12, smile: 0.9, mW: 1.1, round: 0 },
  sad: { open: 0.72, tilt: -0.45, lower: 0.05, happy: 0, raise: 0.15, btilt: 0.9, furrow: 0.2, mOpen: 0, smile: -0.65, mW: 0.9, round: 0 },
  surprised: { open: 1.28, tilt: 0, lower: 0, happy: 0, raise: 1, btilt: 0.15, furrow: 0, mOpen: 0.55, smile: 0, mW: 0.62, round: 0.8 },
  angry: { open: 0.82, tilt: 0.65, lower: 0.15, happy: 0, raise: -0.3, btilt: -1, furrow: 1, mOpen: 0.06, smile: -0.55, mW: 0.95, round: 0 },
  worried: { open: 0.98, tilt: -0.3, lower: 0, happy: 0, raise: 0.45, btilt: 0.8, furrow: 0.45, mOpen: 0.04, smile: -0.3, mW: 0.8, round: 0.1 },
  tender: { open: 0.72, tilt: -0.1, lower: 0.3, happy: 0, raise: 0.12, btilt: 0.35, furrow: 0, mOpen: 0, smile: 0.5, mW: 0.95, round: 0 },
  laugh: { open: 0, tilt: 0, lower: 0.6, happy: 1, raise: 0.4, btilt: 0.2, furrow: 0, mOpen: 0.6, smile: 1, mW: 1.15, round: 0 },
  hurt: { open: 0.1, tilt: 0.4, lower: 0.5, happy: 0, raise: -0.2, btilt: 0.6, furrow: 1, mOpen: 0.3, smile: -0.8, mW: 1.05, round: 0 },
  sleepy: { open: 0.35, tilt: -0.1, lower: 0.1, happy: 0, raise: -0.1, btilt: 0.1, furrow: 0, mOpen: 0, smile: 0.05, mW: 0.9, round: 0 },
  determined: { open: 0.9, tilt: 0.3, lower: 0.2, happy: 0, raise: -0.1, btilt: -0.45, furrow: 0.5, mOpen: 0, smile: -0.1, mW: 0.95, round: 0 },
};
const EXPR_KEYS = Object.keys(EXPR.neutral);

// ---------------------------------------------------------------------------
// Gestures: fn(q, t, w, rig) adds to the pose; dur in seconds
const GEST = {
  nod: { dur: 0.9, fn: (q, t, w) => { q.headx += Math.sin(t * TAU * 2.2) * 0.22 * w * (t < 0.8 ? 1 : 0) + 0.08 * w; q.neckx += 0.06 * w; } },
  shake: { dur: 1.0, fn: (q, t, w) => { q.heady += Math.sin(t * TAU * 2.6) * 0.38 * w; q.headx += 0.08 * w; } },
  bow: { dur: 1.6, fn: (q, t, w) => { const k = Math.sin(Math.min(1, t / 1.4) * Math.PI) * w; q.spinex += 0.35 * k; q.chestx += 0.35 * k; q.headx += 0.25 * k; q.armLx -= 0.25 * k; q.armRx -= 0.25 * k; q.foreLx -= 0.4 * k; q.foreRx -= 0.4 * k; q.armLz -= 0.2 * k; q.armRz += 0.2 * k; q.hipsPY -= 0.02 * k; } },
  point: { dur: 1.8, fn: (q, t, w) => { q.armRx = lerp(q.armRx, -1.45, w); q.armRz = lerp(q.armRz, 0.1, w); q.foreRx = lerp(q.foreRx, -0.1, w); q.handRx = lerp(q.handRx, 0.1, w); q.fingR = lerp(q.fingR, 0.05, w); q.chesty -= 0.2 * w; q.heady -= 0.15 * w; } },
  laugh: { dur: 1.6, expr: 'laugh', fn: (q, t, w) => { const b = Math.abs(Math.sin(t * TAU * 3.2)) * w; q.chestx -= 0.12 * w - 0.08 * b; q.headx -= 0.25 * w + 0.06 * b; q.clavLz += 0.08 * b; q.clavRz -= 0.08 * b; q.armLx -= 0.3 * w; q.armRx -= 0.3 * w; q.foreLx -= 0.9 * w; q.foreRx -= 0.9 * w; q.armLz -= 0.15 * w; q.armRz += 0.15 * w; } },
  sigh: { dur: 1.8, fn: (q, t, w) => { const inh = Math.sin(Math.min(1, t / 0.7) * Math.PI * 0.5), exh = sstep(0.7, 1.5, t); const k = (inh * (1 - exh) * 0.6 - exh * 0.8) * w; q.chestx -= k * 0.12; q.clavLz += k * 0.14; q.clavRz -= k * 0.14; q.headx -= k * 0.2; q.hipsPY += k * 0.008; } },
  shrug: { dur: 1.3, fn: (q, t, w) => { const k = Math.sin(Math.min(1, t / 1.2) * Math.PI) * w; q.clavLz += 0.22 * k; q.clavRz -= 0.22 * k; q.armLz += 0.3 * k; q.armRz -= 0.3 * k; q.foreLx -= 1.2 * k; q.foreRx -= 1.2 * k; q.foreLy -= 1.0 * k; q.foreRy += 1.0 * k; q.headz += 0.15 * k; q.fingL -= 0.3 * k; q.fingR -= 0.3 * k; } },
  handToChest: { dur: 2.2, fn: (q, t, w) => { q.armRx = lerp(q.armRx, -0.55, w); q.armRz = lerp(q.armRz, 0.42, w); q.armRy = lerp(q.armRy, 0.3, w); q.foreRx = lerp(q.foreRx, -1.95, w); q.foreRy = lerp(q.foreRy, 0.5, w); q.handRz = lerp(q.handRz, 0.3, w); q.fingR = lerp(q.fingR, 0.1, w); q.headx += 0.12 * w; q.chestx += 0.05 * w; } },
  wave: { dur: 2.0, fn: (q, t, w) => { q.armLx = lerp(q.armLx, -0.4, w); q.armLz = lerp(q.armLz, 2.5 + Math.sin(t * 10) * 0.05, w); q.foreLx = lerp(q.foreLx, -0.2, w); q.foreLz = lerp(q.foreLz, Math.sin(t * 9) * 0.45, w); q.handLx = lerp(q.handLx, -0.3, w); q.fingL = lerp(q.fingL, 0, w); q.headz -= 0.08 * w; } },
  think: { dur: 2.6, fn: (q, t, w) => { q.armRx = lerp(q.armRx, -0.9, w); q.armRz = lerp(q.armRz, 0.3, w); q.foreRx = lerp(q.foreRx, -2.2, w); q.foreRy = lerp(q.foreRy, 0.4, w); q.handRx = lerp(q.handRx, 0.4, w); q.fingR = lerp(q.fingR, 0.9, w); q.armLx = lerp(q.armLx, -0.4, w); q.armLz = lerp(q.armLz, -0.35, w); q.foreLx = lerp(q.foreLx, -1.5, w); q.headx -= 0.08 * w; q.headz += 0.1 * w; q.heady += 0.15 * w; } },
  beckon: { dur: 1.6, fn: (q, t, w) => { q.armRx = lerp(q.armRx, -1.0, w); q.foreRx = lerp(q.foreRx, -1.2 - Math.max(0, Math.sin(t * 12)) * 0.6, w); q.handRx = lerp(q.handRx, -0.5, w); q.fingR = lerp(q.fingR, 0.6 + Math.sin(t * 12) * 0.5, w); q.heady -= 0.1 * w; } },
  lookAround: { dur: 2.6, fn: (q, t, w) => { q.heady += Math.sin(t * 2.4) * 0.6 * w; q.chesty += Math.sin(t * 2.4) * 0.15 * w; q.headx -= 0.05 * w; } },
  crossArms: { dur: Infinity, fn: (q, t, w) => { q.armLx = lerp(q.armLx, -0.55, w); q.armLz = lerp(q.armLz, -0.28, w); q.foreLx = lerp(q.foreLx, -1.65, w); q.foreLy = lerp(q.foreLy, -0.9, w); q.armRx = lerp(q.armRx, -0.6, w); q.armRz = lerp(q.armRz, 0.28, w); q.foreRx = lerp(q.foreRx, -1.6, w); q.foreRy = lerp(q.foreRy, 0.9, w); q.fingL = lerp(q.fingL, 0.6, w); q.fingR = lerp(q.fingR, 0.6, w); q.chestx -= 0.04 * w; } },
  // small talk beats (used automatically while speaking)
  beatR: { dur: 1.1, fn: (q, t, w) => { const k = Math.sin(Math.min(1, t / 1.0) * Math.PI) * w; q.armRx -= 0.35 * k; q.foreRx -= 0.8 * k; q.foreRy += 0.6 * k; q.fingR -= 0.25 * k; q.heady -= 0.06 * k; } },
  beatL: { dur: 1.1, fn: (q, t, w) => { const k = Math.sin(Math.min(1, t / 1.0) * Math.PI) * w; q.armLx -= 0.35 * k; q.foreLx -= 0.8 * k; q.foreLy -= 0.6 * k; q.fingL -= 0.25 * k; q.heady += 0.06 * k; } },
  beatBoth: { dur: 1.2, fn: (q, t, w) => { const k = Math.sin(Math.min(1, t / 1.1) * Math.PI) * w; q.armRx -= 0.3 * k; q.armLx -= 0.3 * k; q.foreRx -= 0.9 * k; q.foreLx -= 0.9 * k; q.foreRy += 0.7 * k; q.foreLy -= 0.7 * k; q.headx += 0.05 * k; } },
};

// pose channels
const POSE_KEYS = ['hipsx', 'hipsy', 'hipsz', 'hipsPX', 'hipsPY', 'hipsPZ', 'spinex', 'spiney', 'spinez', 'chestx', 'chesty', 'chestz', 'neckx', 'necky', 'neckz', 'headx', 'heady', 'headz', 'jawx',
  'clavLy', 'clavLz', 'clavRy', 'clavRz', 'armLx', 'armLy', 'armLz', 'armRx', 'armRy', 'armRz', 'foreLx', 'foreLy', 'foreLz', 'foreRx', 'foreRy', 'foreRz', 'handLx', 'handLy', 'handLz', 'handRx', 'handRy', 'handRz',
  'fingL', 'fingR', 'thumbL', 'thumbR', 'thighLx', 'thighLy', 'thighLz', 'thighRx', 'thighRy', 'thighRz', 'shinLx', 'shinRx', 'footLx', 'footRx', 'toeLx', 'toeRx'];
function newPose() { const q = {}; for (const k of POSE_KEYS) q[k] = 0; return q; }

// ---------------------------------------------------------------------------
// Base rig (shared API for every character)
export class Rig {
  constructor() {
    this.root = new THREE.Group();
    this.t = rand() * 10;
    this.lookYaw = 0; this.lookPitch = 0;
    this.mats = []; this.glowMats = [];
    this.expression = 'neutral'; this.gestureName = null;
  }
  update() {}
  hurt() {}
  flick() {}
  setExpression() {}
  gesture() { return 0; }
  lookAt() {}
}
// camera distance for LOD
function camDist(root) {
  const c = G.camera;
  if (!c) return 0;
  const e = root.matrixWorld.elements;
  return Math.hypot(c.position.x - e[12], c.position.y - e[13], c.position.z - e[14]);
}
function groundAt(x, z, y) {
  const W = G.world;
  if (W && W.ground) return W.ground(x, z, y + 0.6);
  return y;
}

// ---------------------------------------------------------------------------
// Humanoid rig
export class HumanRig extends Rig {
  constructor(T, o = {}) {
    super();
    const c = T.c;
    this.T = T; this.c = c;
    this.s = c.scale ?? 1;
    this.L = T.L;
    const body = (this.body = new THREE.Group()); body.scale.setScalar(this.s); this.root.add(body);
    // materials (per instance): 'skin' carries the painted face, 'main' is vertex colored.
    // Types may add groups (e.g. enemies: 'skin' = ash-crack body, 'glow' = tier glow).
    const pal = T.pal;
    const M = (this.M = {});
    if (T.face) {
      M.skin = faceMat(pal.skin);
      const F = T.face, u = M.skin.userData.face;
      u.uFaceC.value.set(F.center.x, F.center.y, F.center.z, F.R);
      u.uEyeP.value.set(...F.eye);
      u.uIris.value.set(F.iris); u.uLash.value.set(F.lash);
      u.uBrowP.value.set(...F.browP); u.uBrow.value.w = F.browT; u.uBrowC.value.set(F.browC);
      u.uMouthP.value.set(F.mouthY, F.lipDark, 1, 1); u.uMouth.value.z = F.mouthW;
      u.uCheek.value.set(F.blush, F.wrinkles, F.freckles, F.lashT);
      u.uLook.value.z = F.irisR; u.uLook.value.w = F.pupil;
      this.faceU = u;
    } else this.faceU = null;
    M.main = bodyMat(0xffffff, { vertexColors: true, rim: o.rim ?? 0.34 });
    if (o.mats) Object.assign(M, o.mats);
    this.mats = Object.values(M).filter((m) => m.isMeshToonMaterial);
    this.glowMats = Object.values(M).filter((m) => !m.isMeshToonMaterial);
    const I = instance(body, T.def, T.built, M, { outline: o.outline ?? (c.outline ? 0.011 : 0), main: 'main' });
    this.B = I.by; this.mesh = I.mesh; this.skeleton = I.skeleton; this.outline = I.outline;
    this.meshes = I.meshes;
    // rest data
    this.rest = {};
    for (const b of I.bones) this.rest[b.name] = b.position.clone();
    const B = this.B;
    const P = (this.p = {});
    P.hips = B.hips; P.legL = B.thighL; P.legR = B.thighR; P.shinL = B.shinL; P.shinR = B.shinR;
    P.armL = B.armL; P.armR = B.armR; P.foreL = B.foreL; P.foreR = B.foreR; P.handL = B.handL; P.handR = B.handR;
    // head anchor at the head center (hats, etc.)
    const ha = new THREE.Group(); ha.name = 'headAnchor';
    ha.position.copy(T.L.HC).sub(T.def.pos('head')); B.head.add(ha); P.head = ha; this.headAnchor = ha;
    // carry anchor following the chest; local frame == root frame at rest (unscaled)
    const ta = new THREE.Group(); ta.name = 'carryAnchor';
    const cp = T.def.pos('chest');
    ta.position.set(-cp.x, -cp.y + (T.L.SY + 0.05 - 1.62 / this.s) , -cp.z);
    ta.scale.setScalar(1 / this.s);
    B.chest.add(ta); P.torso = ta;
    // props
    this.props = [];
    if (T.staff) this.addStaff(T);
    if (T.cane) this.addHeld(T.cane, 'handR', (g) => {
      const lan = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), glowMat(0xffc060, 2.4)); lan.position.set(0, 0.12, 0.34); g.add(lan);
      const cageM = toon(0x3a3028, { rim: 0.5 });
      const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.1, 6, 1, true), cageM); cage.position.set(0, 0.12, 0.34); g.add(cage);
      P.lantern = lan;
    });
    if (T.spear) this.addHeld(T.spear, 'handR');
    if (T.book) this.addHeld(T.book, 'handL', (g) => { g.rotation.set(0.1, 0, 0.0); g.position.set(-0.03, -0.07, 0.02); });
    // chains
    this.chains = T.chains.map((ch) => {
      const bones = ch.names.map((n) => B[n]);
      const last = ch.names[ch.names.length - 1];
      const tail = ch.tail.clone().sub(T.def.pos(last));
      const cols = [];
      const L = T.L, bwf = 0.75 + 0.25 * L.bw;
      const cp = T.def.pos('chest'), hp = T.def.pos('hips');
      const col = (obj, base, x, y, z, r) => cols.push({ obj, off: new V3(x - base.x, y - base.y, z - base.z), r });
      if (ch.kind === 'cape') { col(B.chest, cp, 0, L.SY - 0.1, 0.03, 0.16 * bwf); col(B.hips, hp, 0, L.H - 0.02, 0, 0.15 * bwf); }
      if (ch.kind === 'scarf') col(B.chest, cp, 0, L.SY - 0.05, 0.06, 0.2 * bwf);
      if (ch.kind === 'hair') { col(B.head, T.def.pos('head'), L.HC.x, L.HC.y, L.HC.z, L.hr * 1.08); col(B.chest, cp, 0, L.SY - 0.1, 0.03, 0.15 * bwf); }
      if (ch.kind !== 'plume') { cols.push({ obj: B.thighL, off: new V3(0, -0.2, 0), r: 0.1 * bwf }); cols.push({ obj: B.thighR, off: new V3(0, -0.2, 0), r: 0.1 * bwf }); }
      const opts = ch.opts || { cape: { stiff: 0.06, stiffTip: 0.02, damp: 0.1, grav: 9, drag: 1 }, scarf: { stiff: 0.05, stiffTip: 0.01, damp: 0.06, grav: 7, drag: 1.4 }, plume: { stiff: 0.12, stiffTip: 0.05, damp: 0.12, grav: 2, drag: 0.8 }, hair: { stiff: 0.14, stiffTip: 0.06, damp: 0.12, grav: 6, drag: 0.5 } }[ch.kind];
      const chn = new Chain(bones, tail, { ...opts, colliders: cols });
      chn.kind = ch.kind;
      return chn;
    });
    // state
    this.w = { cast: 0, air: 0, glide: 0, talk: 0, swim: 0, sit: 0, kneel: 0, hurt: 0, wave: 0, spread: 0, down: 0, stagger: 0, shock: 0, panic: 0, dead: 0, dash: 0, gait: 0, run: 0 };
    this.q = newPose();
    this.phase = rand();
    this.style = { hunch: c.hunch ?? 0, cadence: c.stride ? c.stride / 1.7 : 1, lift: 1, armHang: 0.08, kneeBend: 0, sway: 1, ...(o.style || {}) };
    this.hipY = T.L.H;
    this.height = (T.L.HC.y + T.L.hr * 1.1) * this.s;
    this.vel = new V3(); this.velL = new V3(); this.prevPos = null; this.prevYaw = 0; this.yawRate = 0; this.acc = new V3();
    this.moveDir = new V3(0, 0, 1);
    this.feet = [0, 1].map((k) => ({ side: k ? -1 : 1, n: k ? 'R' : 'L', plant: new V3(), pos: new V3(), from: new V3(), to: new V3(), planted: false, stepping: 0, stepDur: 0.22, pitch: 0, init: false, lift: 0 }));
    this.pelvisDrop = 0;
    this.land = new Spring(160, 16); this.landImpulse = 0;
    this.prevGrounded = true; this.prevVy = 0; this.airT = 0;
    this.castK = 0; this.castKind = 'bolt'; this.castV = 0; this.castSp = new Spring(260, 18);
    this.hurtSp = new Spring(200, 14);
    // face
    this.fx = {}; this.ft = {};
    for (const k of EXPR_KEYS) { this.fx[k] = EXPR.neutral[k]; this.ft[k] = EXPR.neutral[k]; }
    this.expression = 'neutral'; this.exprHold = 0; this.exprPrev = 'neutral';
    this.blinkT = 1 + rand() * 3; this.blink = 0; this.dblBlink = false;
    this.eyeLook = new V3(); this.eyeT = 0; this.eyeTarget = new V3(); this.lookPoint = null;
    this.talkN = 0; this.talkV = 0; this.beatT = 2;
    this.gestures = [];
    this.idleT = 3 + rand() * 4; this.idleLook = 0; this.idleLookT = 0;
    this.lod = 0;
    this.hatChildren = -1;
    this.ikW = 1;
    this.flickT = 9;
    this.hold = o.hold !== undefined ? o.hold : c.staff ? 'staff' : c.cane ? 'cane' : c.spear ? 'spear' : null;
    this.poseHook = o.pose || null;   // (q, s, rig, dt): edit the pose before it is written to bones
    this.postHook = o.post || null;   // (s, rig, dt): after IK / secondary motion (props, glows)
  }
  addStaff(T) {
    const P = this.p;
    const g = new THREE.Group(); g.name = 'staff';
    const m = new THREE.Mesh(T.staff, toon(0xffffff, { vertexColors: true, rim: 0.45 })); m.castShadow = true; g.add(m);
    if (this.c.outline) addOutline(m, 0.006);
    const top = HB.STAFF.len - HB.STAFF.below;
    const gem = new THREE.Mesh(T.gem, new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.6, 3) }));
    gem.position.set(0, 0.0, top + 0.02); g.add(gem);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), fresnelMat(0x000000, 0xcfb8ff, { intensity: 0.5, power: 2.2 }));
    gem.add(halo);
    const tip = new THREE.Object3D(); tip.position.set(0, 0, top + 0.05); g.add(tip);
    // grip point in the right fist
    g.position.set(-0.004, -this.L.hand * 0.36, 0.004);
    this.B.handR.add(g);
    P.staff = g; P.gem = gem; P.tip = tip;
    this.props.push(g);
  }
  addHeld(geo, bone, extra) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true, rim: 0.5 })); m.castShadow = true; g.add(m);
    if (this.c.outline) addOutline(m, 0.006);
    g.position.set(0, -this.L.hand * 0.36, 0.004);
    if (extra) extra(g);
    this.B[bone].add(g);
    this.props.push(g);
    return g;
  }

  // ---------------------------------------------------------------- API
  hurt() { this.w.hurt = 1; this.hurtSp.v += 9; if (this.faceU) this.setExpression('hurt', 0.45); }
  flick(kind = 'bolt') { this.castKind = kind; this.flickT = 0; this.castSp.v -= kind === 'heavy' ? 14 : kind === 'ult' ? 10 : 11; }
  setExpression(name, hold = 0) {
    const e = EXPR[name] || EXPR.neutral;
    if (hold > 0) { if (!this.exprHold) this.exprPrev = this.expression; this.exprHold = hold; } else { this.exprHold = 0; this.exprPrev = name; }
    this.expression = name;
    for (const k of EXPR_KEYS) this.ft[k] = e[k];
  }
  gesture(name, o = {}) {
    if (name === null) { for (const g of this.gestures) g.out = true; this.gestureName = null; return 0; }
    const def = GEST[name];
    if (!def) return 0;
    // replace a running gesture on the same limbs
    for (const g of this.gestures) if (!g.def.small || def.small) g.out = true;
    const sp = o.speed ?? 1;
    this.gestures.push({ name, def, t: 0, w: 0, sp, amp: o.amp ?? 1, out: false });
    if (def.expr && this.faceU) this.setExpression(def.expr, def.dur / sp);
    if (!name.startsWith('beat')) this.gestureName = name;
    return def.dur / sp;
  }
  lookAt(p) { this.lookPoint = p ? (this.lookPoint || new V3()).copy(p) : null; }

  // ---------------------------------------------------------------- update
  update(dt, s = {}) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.t += dt;
    const W = this.w;
    const root = this.root;
    root.updateMatrixWorld();
    // --- root motion (world velocity, yaw rate)
    const e = root.matrixWorld.elements;
    _v1.set(e[12], e[13], e[14]);
    const yaw = Math.atan2(e[8], e[10]);
    if (this.prevPos && _v1.distanceToSquared(this.prevPos) > 1.5 * 1.5) {
      // teleported: re-seat feet and cloth
      this.prevPos.copy(_v1); this.vel.set(0, 0, 0); this.acc.set(0, 0, 0);
      for (const f of this.feet) f.init = false;
      for (const ch of this.chains) ch.init = false;
    }
    if (this.prevPos && dt > 0) {
      _v2.subVectors(_v1, this.prevPos).multiplyScalar(1 / dt);
      if (_v2.lengthSq() > 60 * 60) _v2.set(0, 0, 0);
      const pv = _v3.copy(this.vel);
      this.vel.lerp(_v2, 1 - Math.exp(-dt * 14));
      this.acc.lerp(_v4.subVectors(this.vel, pv).multiplyScalar(1 / dt), 1 - Math.exp(-dt * 6));
      this.yawRate = damp(this.yawRate, wrapA(yaw - this.prevYaw) / dt, 10, dt);
    } else this.prevPos = new V3();
    this.prevPos.copy(_v1); this.prevYaw = yaw;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    this.velL.set(this.vel.x * cy - this.vel.z * sy, this.vel.y, this.vel.x * sy + this.vel.z * cy);
    const accF = this.acc.x * sy + this.acc.z * cy;
    const dist = camDist(root);
    this.lod = dist < 26 ? 0 : dist < 60 ? 1 : 2;
    const vis = root.visible && this.lod < 2;

    // --- state weights
    const speed = Math.min(s.speed ?? 0, 60);
    const grounded = s.grounded !== false;
    const lie = Math.max(W.down, W.dead);
    W.cast = damp(W.cast, s.cast ? 1 : 0, s.cast ? 16 : 5, dt);
    W.air = damp(W.air, !grounded && !s.glide && !s.swim ? 1 : 0, 12, dt);
    W.glide = damp(W.glide, s.glide ? 1 : 0, 7, dt);
    W.swim = damp(W.swim, s.swim ? 1 : 0, 6, dt);
    W.talk = damp(W.talk, s.talk ? 1 : 0, 6, dt);
    W.sit = damp(W.sit, s.sit ? 1 : 0, 4, dt);
    W.kneel = damp(W.kneel, s.kneel ? 1 : 0, 4, dt);
    W.wave = damp(W.wave, s.wave ? 1 : 0, 6, dt);
    W.spread = damp(W.spread, s.spread ? 1 : 0, 6, dt);
    W.down = damp(W.down, s.down ? 1 : 0, s.down ? 12 : 4, dt);
    W.stagger = damp(W.stagger, s.stagger ? 1 : 0, 8, dt);
    W.shock = damp(W.shock, s.shock ? 1 : 0, 20, dt);
    W.panic = damp(W.panic, s.panic ? 1 : 0, 10, dt);
    W.dead = damp(W.dead, s.dead ? 1 : 0, 6, dt);
    W.dash = damp(W.dash, speed > 16 ? 1 : 0, speed > 16 ? 30 : 8, dt);
    W.hurt = Math.max(0, W.hurt - dt * 3);
    const spn = Math.min(speed, 12) / this.s;
    W.gait = damp(W.gait, spn > 0.35 && grounded ? 1 : 0, 8, dt);
    W.run = damp(W.run, sstep(2.6, 5.2, spn), 5, dt);
    const sprint = sstep(6.5, 9, spn);
    if (!grounded) this.airT += dt; else this.airT = 0;
    // landing impact
    if (grounded && !this.prevGrounded && !s.swim) {
      const imp = clamp(-this.prevVy / 14, 0.15, 1);
      this.land.v -= 6 * imp + 1.5; this.landImpulse = imp;
    }
    this.prevGrounded = grounded; this.prevVy = s.vy ?? 0;
    this.land.step(0, dt);
    this.castSp.step(0, dt); this.hurtSp.step(0, dt);
    this.flickT += dt;

    // --- pose
    const q = this.q;
    for (const k of POSE_KEYS) q[k] = 0;
    const st = this.style;
    const t = this.t;
    // gait phase
    const freq = (1.0 + 0.3 * spn) * st.cadence;
    const duty = mix(0.6, 0.34, sstep(1.5, 7, spn));
    if (W.gait > 0.01) this.phase = (this.phase + dt * freq) % 1;
    const ph = this.phase * TAU;
    const gw = W.gait * (1 - W.air) * (1 - W.glide) * (1 - W.swim) * (1 - W.sit) * (1 - lie);
    const run = W.run;
    // idle breathing & weight shift
    const idle = 1 - W.gait;
    const breath = Math.sin(t * 2.1);
    const shift = Math.sin(t * 0.45) * 0.6 + Math.sin(t * 0.21) * 0.4;
    q.hipsPX += shift * 0.012 * idle * st.sway;
    q.hipsz += shift * 0.025 * idle * st.sway;
    q.spinez -= shift * 0.02 * idle;
    q.chestx += breath * 0.012 * idle - st.hunch * 0.6;
    q.spinex += st.hunch * 0.5;
    q.neckx -= st.hunch * 0.2;
    q.headx -= st.hunch * 0.35;
    q.clavLz += breath * 0.015 * idle; q.clavRz -= breath * 0.015 * idle;
    // arms at rest
    q.armLz += st.armHang + 0.02 * breath * idle; q.armRz -= st.armHang + 0.02 * breath * idle;
    q.foreLx -= 0.14; q.foreRx -= 0.14;
    q.fingL += 0.35; q.fingR += 0.35; q.thumbL += 0.2; q.thumbR += 0.2;
    q.handLz -= 0.05; q.handRz += 0.05;
    // locomotion upper body. fwdL: 1 when the left foot is in front (contact at phase 0)
    const fwdL = Math.cos(ph);
    const aSw = (0.4 + 0.35 * run + 0.25 * sprint) * gw;
    q.armLx += fwdL * aSw;            // left arm back while the left leg is forward
    q.armRx -= fwdL * aSw;
    q.foreLx -= (0.2 + 1.15 * run + 0.2 * sprint) * gw + Math.max(0, -fwdL) * 0.25 * gw;
    q.foreRx -= (0.2 + 1.15 * run + 0.2 * sprint) * gw + Math.max(0, fwdL) * 0.25 * gw;
    q.armLz += 0.1 * run * gw; q.armRz -= 0.1 * run * gw;
    q.fingL += 0.8 * run * gw; q.fingR += 0.8 * run * gw;
    q.hipsy -= fwdL * (0.12 + 0.06 * run) * gw;
    q.chesty += fwdL * (0.14 + 0.1 * run) * gw;
    q.heady -= fwdL * 0.05 * gw;
    q.spinex += (0.03 + 0.1 * run + 0.12 * sprint) * gw + clamp(accF * 0.025, -0.15, 0.22) * gw;
    q.chestx += 0.04 * run * gw;
    q.headx -= (0.02 + 0.08 * run + 0.1 * sprint) * gw;
    // held props: staff / cane / spear upright in the right fist, book in the left
    const hold = this.hold;
    if (hold) {
      q.armRx = q.armRx * 0.35 + (hold === 'cane' ? -0.3 : -0.12);
      q.armRz += hold === 'staff' ? -0.16 : -0.1;
      q.foreRx = (hold === 'cane' ? -0.95 : -1.3) - 0.25 * run * gw;
      q.foreRy = -0.1; q.handRx = hold === 'cane' ? -0.3 : 0.1; q.handRz = -0.05;
      q.fingR = 1.4; q.thumbR = 1.1;
    }
    if (this.c.book) { q.armLx = q.armLx * 0.3 - 0.15; q.foreLx = -1.25; q.foreLy = -0.6; q.handLz = 0.25; q.handLx = 0.2; q.fingL = 0.7; }
    // lean into turns
    const turnLean = clamp(this.yawRate * speed * 0.018, -0.3, 0.3) * gw;
    q.spinez -= turnLean; q.heady += clamp(this.yawRate * 0.08, -0.3, 0.3);
    // bob, sway & roll: walking peaks at mid-stance, running dips at mid-stance
    const mid = ph - duty * Math.PI;
    const bob = Math.cos(mid * 2);
    q.hipsPY += (bob * (0.016 * (1 - run) - 0.028 * run) - 0.025 * run - 0.03 * sprint) * gw;
    q.hipsPX += Math.cos(mid) * 0.018 * gw * (1 - run * 0.7) * st.sway;
    q.hipsz += Math.cos(mid) * 0.05 * gw * (1 - run * 0.5);
    q.spinez -= Math.cos(mid) * 0.03 * gw;

    // --- air: takeoff stretch, tuck while rising, reach down while falling
    const vy = s.vy ?? 0;
    if (W.air > 0.01) {
      const a = W.air;
      const rising = sstep(-2, 3, vy), fall = 1 - rising;
      const fl = Math.sin(t * 7.5), fl2 = Math.sin(t * 6.1 + 1);
      q.armLx = lerp(q.armLx, -0.5 * rising - 0.3 * fall + fl * 0.25 * fall, a); q.armRx = lerp(q.armRx, -0.5 * rising - 0.3 * fall - fl2 * 0.25 * fall, a);
      q.armLz = lerp(q.armLz, 0.55 + 0.75 * fall, a); q.armRz = lerp(q.armRz, -0.55 - 0.75 * fall, a);
      q.foreLx = lerp(q.foreLx, -0.7 + 0.3 * fall, a); q.foreRx = lerp(q.foreRx, -0.7 + 0.3 * fall, a);
      q.thighLx = lerp(q.thighLx, -0.95 * rising - 0.5 * fall + fl * 0.12 * fall, a); q.shinLx = lerp(q.shinLx, 1.35 * rising + 0.75 * fall, a);
      q.thighRx = lerp(q.thighRx, 0.1 - 0.25 * rising - 0.1 * fall - fl * 0.12 * fall, a); q.shinRx = lerp(q.shinRx, 0.7 * rising + 0.9 * fall, a);
      q.thighLz = lerp(q.thighLz, 0.06 + 0.1 * fall, a); q.thighRz = lerp(q.thighRz, -0.06 - 0.1 * fall, a);
      q.footLx = lerp(q.footLx, 0.3, a); q.footRx = lerp(q.footRx, 0.45, a);
      q.spinex = lerp(q.spinex, 0.12 * rising + 0.06 * fall, a); q.headx = lerp(q.headx, -0.1 * rising + 0.15 * fall, a);
      q.fingL = lerp(q.fingL, 0.2, a); q.fingR = lerp(q.fingR, 0.2, a);
    }
    // --- dash (blink)
    if (W.dash > 0.01) {
      const a = W.dash;
      q.spinex = lerp(q.spinex, 0.55, a); q.chestx = lerp(q.chestx, 0.2, a); q.headx = lerp(q.headx, -0.5, a);
      q.armLx = lerp(q.armLx, 0.9, a); q.armRx = lerp(q.armRx, 0.9, a); q.armLz = lerp(q.armLz, 0.3, a); q.armRz = lerp(q.armRz, -0.3, a);
      q.thighLx = lerp(q.thighLx, -0.7, a); q.shinLx = lerp(q.shinLx, 1.4, a); q.thighRx = lerp(q.thighRx, 0.5, a); q.shinRx = lerp(q.shinRx, 1.0, a);
    }
    // --- glide: arms spread like wings, legs trailing
    if (W.glide > 0.01) {
      const a = W.glide;
      const fl = Math.sin(t * 5) * 0.05;
      q.spinex = lerp(q.spinex, 0.35, a); q.chestx = lerp(q.chestx, 0.1, a); q.headx = lerp(q.headx, -0.35, a);
      q.armLx = lerp(q.armLx, -0.15, a); q.armRx = lerp(q.armRx, -0.15, a); q.armLz = lerp(q.armLz, 1.35 + fl, a); q.armRz = lerp(q.armRz, -1.35 - fl, a);
      q.foreLx = lerp(q.foreLx, -0.15, a); q.foreRx = lerp(q.foreRx, -0.15, a); q.fingL = lerp(q.fingL, 0.1, a); q.fingR = lerp(q.fingR, 0.1, a);
      q.thighLx = lerp(q.thighLx, 0.35, a); q.thighRx = lerp(q.thighRx, 0.55, a); q.shinLx = lerp(q.shinLx, 0.5, a); q.shinRx = lerp(q.shinRx, 0.3, a);
      q.footLx = lerp(q.footLx, 0.7, a); q.footRx = lerp(q.footRx, 0.7, a);
      q.spinez = lerp(q.spinez, clamp(-this.yawRate * 0.25, -0.4, 0.4), a);
    }
    // --- swim: breaststroke
    if (W.swim > 0.01) {
      const a = W.swim;
      const sp = Math.min(1, speed / 2);
      const cyc = t * (2.2 + sp * 1.2);
      const st2 = Math.sin(cyc), ct = Math.cos(cyc);
      q.hipsx = lerp(q.hipsx, 0.35 + 0.95 * sp, a); q.spinex = lerp(q.spinex, 0.1, a); q.chestx = lerp(q.chestx, -0.1 * sp, a);
      q.neckx = lerp(q.neckx, -0.4 * sp, a); q.headx = lerp(q.headx, -0.6 * sp - 0.1, a);
      q.armLx = lerp(q.armLx, -1.6 + st2 * 0.4 * (0.4 + sp), a); q.armRx = lerp(q.armRx, -1.6 + st2 * 0.4 * (0.4 + sp), a);
      q.armLz = lerp(q.armLz, 0.3 + (0.5 + 0.5 * ct) * 0.9 * (0.3 + sp), a); q.armRz = lerp(q.armRz, -0.3 - (0.5 + 0.5 * ct) * 0.9 * (0.3 + sp), a);
      q.foreLx = lerp(q.foreLx, -0.3 - (0.5 - 0.5 * ct) * 1.0, a); q.foreRx = lerp(q.foreRx, -0.3 - (0.5 - 0.5 * ct) * 1.0, a);
      q.fingL = lerp(q.fingL, 0.05, a); q.fingR = lerp(q.fingR, 0.05, a);
      const kick = Math.sin(cyc + 1.2);
      q.thighLx = lerp(q.thighLx, 0.1 + kick * 0.35 * sp, a); q.thighRx = lerp(q.thighRx, 0.1 + kick * 0.35 * sp, a);
      q.thighLz = lerp(q.thighLz, 0.25 * (0.5 + 0.5 * kick), a); q.thighRz = lerp(q.thighRz, -0.25 * (0.5 + 0.5 * kick), a);
      q.shinLx = lerp(q.shinLx, 0.5 + 0.6 * (0.5 - 0.5 * kick), a); q.shinRx = lerp(q.shinRx, 0.5 + 0.6 * (0.5 - 0.5 * kick), a);
      q.footLx = lerp(q.footLx, 0.9, a); q.footRx = lerp(q.footRx, 0.9, a);
      q.hipsPY = lerp(q.hipsPY, Math.sin(cyc) * 0.02, a);
    }
    // --- sit (on a bench / ground edge)
    if (W.sit > 0.01) {
      const a = W.sit;
      q.hipsPY = lerp(q.hipsPY, -this.hipY * 0.46, a); q.hipsPZ = lerp(q.hipsPZ, -0.06, a);
      q.thighLx = lerp(q.thighLx, -1.45, a); q.thighRx = lerp(q.thighRx, -1.4, a); q.thighLz = lerp(q.thighLz, 0.08, a); q.thighRz = lerp(q.thighRz, -0.1, a);
      q.shinLx = lerp(q.shinLx, 1.45, a); q.shinRx = lerp(q.shinRx, 1.3, a);
      q.spinex = lerp(q.spinex, 0.12 + st.hunch * 0.5, a);
      q.armLx = lerp(q.armLx, -0.55, a); q.armRx = lerp(q.armRx, -0.5, a); q.foreLx = lerp(q.foreLx, -0.5, a); q.foreRx = lerp(q.foreRx, -0.55, a);
      q.armLz = lerp(q.armLz, 0.05, a); q.armRz = lerp(q.armRz, -0.05, a);
    }
    // --- kneel (one knee down)
    if (W.kneel > 0.01) {
      const a = W.kneel;
      q.hipsPY = lerp(q.hipsPY, -this.hipY * 0.42, a); q.hipsPZ = lerp(q.hipsPZ, -0.04, a);
      q.thighLx = lerp(q.thighLx, -1.45, a); q.shinLx = lerp(q.shinLx, 1.5, a); q.footLx = lerp(q.footLx, 0.0, a);
      q.thighRx = lerp(q.thighRx, 0.2, a); q.shinRx = lerp(q.shinRx, 1.75, a); q.footRx = lerp(q.footRx, 0.5, a); q.toeRx = lerp(q.toeRx, -0.9, a);
      q.spinex = lerp(q.spinex, 0.2, a); q.chestx = lerp(q.chestx, 0.1, a); q.headx = lerp(q.headx, 0.3, a);
      q.armLx = lerp(q.armLx, -0.7, a); q.foreLx = lerp(q.foreLx, -0.9, a); q.armLz = lerp(q.armLz, 0.1, a);
      q.armRx = lerp(q.armRx, -0.2, a); q.foreRx = lerp(q.foreRx, -0.3, a);
    }
    // --- knocked down / dead: limp body (the enemy tilts the root)
    if (lie > 0.01) {
      const a = lie;
      const tw = Math.sin(t * 3) * 0.05 * W.down;
      q.spinex = lerp(q.spinex, -0.1, a); q.chestx = lerp(q.chestx, -0.1, a); q.headx = lerp(q.headx, -0.3 + tw, a); q.heady = lerp(q.heady, 0.4, a);
      q.armLx = lerp(q.armLx, -2.3, a); q.armRx = lerp(q.armRx, -2.0, a); q.armLz = lerp(q.armLz, 0.7, a); q.armRz = lerp(q.armRz, -0.5, a);
      q.foreLx = lerp(q.foreLx, -0.4, a); q.foreRx = lerp(q.foreRx, -0.9, a);
      q.thighLx = lerp(q.thighLx, -0.3 + tw, a); q.thighRx = lerp(q.thighRx, 0.1, a); q.shinLx = lerp(q.shinLx, 0.6, a); q.shinRx = lerp(q.shinRx, 0.2, a);
      q.fingL = lerp(q.fingL, 0.5, a); q.fingR = lerp(q.fingR, 0.5, a); q.jawx = lerp(q.jawx, 0.2, a);
    }
    // --- stagger / panic / shock
    if (W.stagger > 0.01) {
      const a = W.stagger;
      q.spinex += (0.3 + Math.sin(t * 4.3) * 0.12) * a; q.spinez += Math.sin(t * 2.6) * 0.12 * a; q.headx += 0.4 * a; q.headz += Math.sin(t * 3.1) * 0.2 * a;
      q.armLx = lerp(q.armLx, 0.25 + Math.sin(t * 3.1) * 0.15, a); q.armRx = lerp(q.armRx, 0.2 + Math.sin(t * 3.4 + 1) * 0.15, a);
      q.shinLx += 0.3 * a; q.shinRx += 0.2 * a; q.hipsPY -= 0.05 * a;
    }
    if (W.panic > 0.01) {
      const a = W.panic;
      q.armLx = lerp(q.armLx, -2.7 + Math.sin(t * 17) * 0.7, a); q.armRx = lerp(q.armRx, -2.7 + Math.sin(t * 17 + 2.1) * 0.7, a);
      q.armLz = lerp(q.armLz, 0.45 + Math.sin(t * 13) * 0.35, a); q.armRz = lerp(q.armRz, -0.45 - Math.sin(t * 13 + 1) * 0.35, a);
      q.chesty += Math.sin(t * 11) * 0.25 * a; q.heady += Math.sin(t * 15) * 0.5 * a; q.headx -= 0.4 * a; q.spinex -= 0.2 * a;
      q.jawx += 0.35 * a;
    }
    if (W.shock > 0.01) {
      const a = W.shock;
      const j = () => (rand() - 0.5) * a;
      q.armLx += j() * 0.9; q.armRx += j() * 0.9; q.armLz = lerp(q.armLz, 0.9, a); q.armRz = lerp(q.armRz, -0.9, a);
      q.spinez += j() * 0.25; q.headx += j() * 0.3; q.thighLx += j() * 0.35; q.thighRx += j() * 0.35; q.fingL = lerp(q.fingL, -0.2, a); q.fingR = lerp(q.fingR, -0.2, a); q.jawx += 0.3 * a;
    }
    // --- cast (upper body): staff arm raised towards the aim, off-hand gesture, release kick
    const pitch = s.aimPitch ?? 0;
    const kick = -this.castSp.x;                    // 0 → ~1 on release, springs back
    const ft = this.flickT;
    if (W.cast > 0.01) {
      const a = W.cast;
      const kind = this.castKind;
      let ax = -0.72 - pitch * 0.5, az = 0.22, fx = -0.45, hx = 0, lx = -0.8, lz = 0.25, lfx = -0.9;
      if (kind === 'heavy') { ax = -1.0 - pitch * 0.5 - sstep(0.25, 0, ft) * 1.2; fx = -0.2; lx = -1.2; lfx = -0.4; lz = 0.1; }
      else if (kind === 'weave') { const sp = Math.max(0, 1 - ft / 0.7); az = 0.22 + Math.sin(ft * 14) * 0.4 * sp; lx = -0.6 - Math.sin(ft * 14 + 1) * 0.5 * sp; lz = 0.4; }
      else if (kind === 'ult') { const up = sstep(0.45, 0, ft); ax = mix(-0.8 - pitch * 0.5, -2.9, up); fx = mix(-0.4, -0.05, up); lx = mix(-0.9, -2.6, up); lz = mix(0.25, 0.3, up); lfx = mix(-0.8, -0.1, up); }
      q.armRx = lerp(q.armRx, ax - kick * 0.35, a); q.armRz = lerp(q.armRz, az, a); q.armRy = lerp(q.armRy, 0.1, a);
      q.foreRx = lerp(q.foreRx, fx + kick * 0.2, a); q.handRx = lerp(q.handRx, hx - pitch * 0.3 - kick * 0.4, a); q.fingR = lerp(q.fingR, 1.35, a);
      q.armLx = lerp(q.armLx, lx - kick * 0.25, a * 0.85); q.armLz = lerp(q.armLz, lz + kick * 0.25, a * 0.85); q.foreLx = lerp(q.foreLx, lfx, a * 0.85);
      q.handLx = lerp(q.handLx, -0.3, a); q.fingL = lerp(q.fingL, -0.15 + kick * 0.3, a); q.handLz = lerp(q.handLz, -0.25, a);
      q.chesty = lerp(q.chesty, 0.3 + kick * 0.25, a); q.spiney += 0.12 * a; q.chestx += (0.06 - pitch * 0.25 + kick * 0.1) * a;
      q.headx += pitch * 0.35 * a; q.heady -= 0.25 * a; q.hipsPY -= kick * 0.015;
    }
    // --- wave (state flag)
    if (W.wave > 0.01) GEST.wave.fn(q, t, W.wave, this);
    // --- talk: flapping mouth + beat gestures
    const typing = s.talk && (!G.dialogue || !G.dialogue.cur || !G.dialogue.cur.done);
    if (W.talk > 0.01) {
      q.headx += Math.sin(t * 4.3) * 0.035 * W.talk; q.headz += Math.sin(t * 1.7) * 0.04 * W.talk; q.heady += Math.sin(t * 0.9) * 0.06 * W.talk;
      if (typing && this.faceU) { this.beatT -= dt; if (this.beatT <= 0) { this.beatT = 1.6 + rand() * 2.4; if (!this.gestures.length && W.gait < 0.2 && W.sit < 0.5 && W.kneel < 0.5) this.gesture(['beatR', 'beatL', 'beatBoth', 'beatR'][Math.floor(rand() * 4)], { amp: 0.8 }); } }
    }
    // --- one-shot gestures
    for (let i = this.gestures.length - 1; i >= 0; i--) {
      const g = this.gestures[i];
      g.t += dt * g.sp;
      const dur = g.def.dur;
      const inW = Math.min(1, g.t / 0.2), outW = g.out ? g.w - dt * 4 : dur === Infinity ? 1 : Math.min(1, (dur - g.t) / 0.3);
      g.w = Math.max(0, Math.min(inW, outW));
      if ((dur !== Infinity && g.t >= dur) || (g.out && g.w <= 0)) { this.gestures.splice(i, 1); if (this.gestureName === g.name) this.gestureName = null; continue; }
      g.def.fn(q, g.t, g.w * g.amp * (1 - W.cast), this);
    }
    // --- idle life: occasional glances
    if (idle > 0.8 && !s.talk && W.cast < 0.1) {
      this.idleT -= dt;
      if (this.idleT <= 0) { this.idleT = 3 + rand() * 5; this.idleLookT = rand() < 0.5 ? (rand() - 0.5) * 1.1 : 0; }
      this.idleLook = damp(this.idleLook, this.idleLookT, 3, dt);
    } else this.idleLook = damp(this.idleLook, 0, 4, dt);
    // --- hurt flinch (additive)
    const hk = this.hurtSp.x * 0.1 + W.hurt * 0.3;
    q.spinex -= hk * 0.8; q.chestx -= hk * 0.5; q.headx -= hk * 0.9; q.armLx -= hk * 1.2; q.armRx -= hk * 1.2; q.armLz += hk * 0.6; q.armRz -= hk * 0.6; q.foreLx -= hk * 1.2; q.foreRx -= hk * 1.2;
    // --- landing squash
    const lk = this.land.x;
    q.hipsPY += lk * 0.03 * (0.6 + this.landImpulse);
    q.spinex -= lk * 0.08; q.headx += lk * 0.05; q.armLz -= lk * 0.08; q.armRz += lk * 0.08;
    // --- head look
    const lookY = clamp((s.lookYaw ?? this.lookYaw) + this.idleLook, -1.1, 1.1), lookP = clamp(this.lookPitch, -0.5, 0.5);
    this.headYaw = damp(this.headYaw ?? 0, lookY * (1 - lie), 7, dt);
    this.headPitch = damp(this.headPitch ?? 0, lookP, 7, dt);
    q.heady += this.headYaw * 0.7; q.necky += this.headYaw * 0.3; q.chesty += this.headYaw * 0.12;
    q.headx += this.headPitch * 0.8; q.neckx += this.headPitch * 0.2;
    q.headx -= W.swim * 0.2;
    q.jawx += (this.talkV ?? 0) * 0.12;

    if (this.poseHook) this.poseHook(q, s, this, dt);
    // --- write FK to bones
    const B = this.B;
    const hipsRest = this.rest.hips;
    B.hips.position.set(hipsRest.x + q.hipsPX, hipsRest.y + q.hipsPY, hipsRest.z + q.hipsPZ);
    B.hips.rotation.set(q.hipsx, q.hipsy, q.hipsz);
    B.spine.rotation.set(q.spinex, q.spiney, q.spinez);
    B.chest.rotation.set(q.chestx, q.chesty, q.chestz);
    B.neck.rotation.set(q.neckx, q.necky, q.neckz);
    B.head.rotation.set(q.headx, q.heady, q.headz);
    B.jaw.rotation.set(q.jawx, 0, 0);
    B.clavL.rotation.set(0, q.clavLy, q.clavLz); B.clavR.rotation.set(0, q.clavRy, q.clavRz);
    B.armL.rotation.set(q.armLx, q.armLy, q.armLz); B.armR.rotation.set(q.armRx, q.armRy, q.armRz);
    B.foreL.rotation.set(q.foreLx, q.foreLy, q.foreLz); B.foreR.rotation.set(q.foreRx, q.foreRy, q.foreRz);
    B.handL.rotation.set(q.handLx, q.handLy, q.handLz); B.handR.rotation.set(q.handRx, q.handRy, q.handRz);
    // fingers curl towards the palm (inward = -x for the left hand)
    B.fingL.rotation.set(0, 0, -q.fingL * 0.8); B.fingBL.rotation.set(0, 0, -q.fingL * 0.9); B.thumbL.rotation.set(-q.thumbL * 0.3, 0, -q.thumbL * 0.5);
    B.fingR.rotation.set(0, 0, q.fingR * 0.8); B.fingBR.rotation.set(0, 0, q.fingR * 0.9); B.thumbR.rotation.set(-q.thumbR * 0.3, 0, q.thumbR * 0.5);
    B.thighL.rotation.set(q.thighLx, q.thighLy, q.thighLz); B.thighR.rotation.set(q.thighRx, q.thighRy, q.thighRz);
    B.shinL.rotation.set(q.shinLx, 0, 0); B.shinR.rotation.set(q.shinRx, 0, 0);
    B.footL.rotation.set(q.footLx, 0, 0); B.footR.rotation.set(q.footRx, 0, 0);
    B.toeL.rotation.set(q.toeLx, 0, 0); B.toeR.rotation.set(q.toeRx, 0, 0);
    root.updateMatrixWorld(true);
    // --- held pole: orient the fist so the staff stands upright / points at the aim
    if (hold && W.swim < 0.9) {
      const re = root.matrixWorld.elements;
      const rs = root.scale.x || 1;
      _v3.set(re[4], re[5], re[6]).multiplyScalar(1 / rs);   // up
      _v4.set(re[8], re[9], re[10]).multiplyScalar(1 / rs);  // forward
      _v5.set(re[0], re[1], re[2]).multiplyScalar(1 / rs);   // left
      let tilt = hold === 'cane' ? 0.22 : 0.1;
      tilt += Math.cos(ph) * 0.12 * gw - run * gw * 0.9 - W.air * 0.5 + W.glide * 1.2;
      const ct = W.cast * (hold === 'staff' ? 1 : 0);
      tilt = mix(tilt, 0.5 + kick * 0.55 - pitch * 0.6 - (this.castKind === 'ult' ? sstep(0.45, 0, ft) * 0.5 : 0), ct);
      _v1.copy(_v3).multiplyScalar(Math.cos(tilt)).addScaledVector(_v4, Math.sin(tilt)).addScaledVector(_v5, -0.06 * (1 - ct)).normalize();
      B.handR.getWorldQuaternion(_q1);
      _v2.set(0, 0, 1).applyQuaternion(_q1);
      rotateTowards(B.handR, _v2, _v1, 0.9 * (1 - lie) * (1 - W.shock) * (1 - W.panic));
      B.handR.updateMatrixWorld(true);
    }

    // --- legs: planted-foot IK when standing / walking
    const upright = Math.abs(root.rotation.x) < 0.2 && Math.abs(root.rotation.z) < 0.2;
    const ikTarget = grounded && upright && W.swim < 0.5 && W.glide < 0.5 && lie < 0.2 && W.sit < 0.5 && W.kneel < 0.5 && W.dash < 0.5 && this.lod < 2 ? 1 : 0;
    this.ikW = damp(this.ikW, ikTarget, ikTarget ? 10 : 14, dt);
    if (this.ikW > 0.01 && vis) this.legIK(dt, speed, spn, freq, duty, gw, run);
    else { for (const f of this.feet) f.init = false; this.pelvisDrop = damp(this.pelvisDrop, 0, 8, dt); }

    // --- secondary motion
    if (vis && this.lod === 0) {
      _v5.copy(this.vel).multiplyScalar(-1);
      for (const ch of this.chains) ch.step(dt, _v5, true);
    } else if (this.chains.length) for (const ch of this.chains) ch.init = false;

    // --- face
    if (this.faceU && this.lod < 2) this.updateFace(dt, s, typing);
    // --- player's hat (from player.setHat): lower the hood, fit the hat
    if (this.B.hoodUp) this.hoodCheck();
    if (this.postHook) this.postHook(s, this, dt);
  }

  legIK(dt, speed, spn, freq, duty, gw, run) {
    const root = this.root;
    const s = this.s;
    const rs = root.scale.x;
    const B = this.B;
    const e = root.matrixWorld.elements;
    const ry = root.position.y;
    const fwdX = e[8] / rs, fwdZ = e[10] / rs, sideX = e[0] / rs, sideZ = e[2] / rs;
    // move direction in world (from measured velocity if moving)
    const vh = Math.hypot(this.vel.x, this.vel.z);
    if (vh > 0.3) this.moveDir.set(this.vel.x / vh, 0, this.vel.z / vh);
    else this.moveDir.set(fwdX, 0, fwdZ);
    const reach = speed * duty / (2 * freq);
    const lift = mix(0.07, 0.2, run) * s * rs * this.style.lift;
    const ankleH = this.L.ankleY * s * rs;
    const footW = this.L.hipX * 1.05 * s * rs;
    const moving = gw > 0.35 && speed > 0.25;
    const turning = Math.abs(this.yawRate) > 1.2;
    let stepping = this.feet.some((f) => f.stepping > 0);
    for (let k = 0; k < 2; k++) {
      const f = this.feet[k];
      const sd = f.side;
      // rest spot under the hip
      const rx = sd * footW, rz = (sd > 0 ? 0.03 : -0.02) * s * rs;
      const restX = e[12] + sideX * rx + fwdX * rz, restZ = e[14] + sideZ * rx + fwdZ * rz;
      if (!f.init) {
        const fw = B['foot' + f.n].getWorldPosition(_v1);
        f.pos.set(fw.x, groundAt(fw.x, fw.z, ry), fw.z); f.plant.copy(f.pos); f.planted = true; f.stepping = 0; f.init = true;
      }
      if (moving) {
        const pk = (this.phase + (sd > 0 ? 0 : 0.5)) % 1;
        if (pk < duty) {
          if (!f.planted) { f.plant.set(f.pos.x, groundAt(f.pos.x, f.pos.z, ry), f.pos.z); f.planted = true; }
          f.pos.copy(f.plant);
          const ss = pk / duty;
          f.pitch = -0.25 * (1 - sstep(0, 0.18, ss)) + (0.35 + 0.35 * run) * sstep(0.6, 1, ss);
        } else {
          if (f.planted) { f.from.copy(f.pos); f.planted = false; }
          const sg = (pk - duty) / (1 - duty);
          const remain = (1 - sg) * (1 - duty) / freq;
          const lx = restX + this.moveDir.x * reach + this.vel.x * remain, lz = restZ + this.moveDir.z * reach + this.vel.z * remain;
          const ly = groundAt(lx, lz, ry);
          const ee = ease(sg);
          f.pos.set(mix(f.from.x, lx, ee), mix(f.from.y, ly, ee) + lift * Math.pow(Math.sin(Math.PI * sg), 0.8), mix(f.from.z, lz, ee));
          f.pitch = mix(0.7 * (0.5 + run), -0.2, sstep(0, 0.6, sg)) * (1 - sstep(0.85, 1, sg)) - 0.2 * sstep(0.7, 1, sg);
        }
        f.stepping = 0;
      } else {
        // idle: step to the rest spot when too far off (turning, stopping, pushed)
        if (f.stepping > 0) {
          f.stepping = Math.max(0, f.stepping - dt / f.stepDur);
          const sg = 1 - f.stepping;
          const ee = ease(sg);
          f.to.set(restX, groundAt(restX, restZ, ry), restZ);
          f.pos.set(mix(f.from.x, f.to.x, ee), mix(f.from.y, f.to.y, ee) + 0.06 * s * rs * Math.sin(Math.PI * sg), mix(f.from.z, f.to.z, ee));
          f.pitch = Math.sin(Math.PI * sg) * 0.25;
          if (f.stepping === 0) { f.plant.copy(f.to); f.planted = true; }
        } else {
          if (!f.planted) { f.from.copy(f.pos); f.stepping = 1; f.stepDur = 0.16; stepping = true; }
          else {
            f.pos.copy(f.plant);
            f.pitch = damp(f.pitch, 0, 10, dt);
            const err = Math.hypot(f.plant.x - restX, f.plant.z - restZ);
            if (!stepping && (err > 0.17 * s * rs || (turning && err > 0.06 * s * rs))) { f.from.copy(f.plant); f.stepping = 1; f.stepDur = turning ? 0.18 : 0.24; f.planted = false; stepping = true; }
          }
        }
      }
    }
    // pelvis: lower so both ankles are reachable
    const hipsB = B.hips;
    let drop = 0;
    for (const f of this.feet) {
      const th = B['thigh' + f.n];
      th.getWorldPosition(_v1);
      const ax = f.pos.x, ay = f.pos.y + ankleH + Math.max(0, f.pitch) * 0.1 * s * rs, az = f.pos.z;
      const legL = (this.legLen ?? (this.legLen = this.rest['shin' + f.n].length() + this.rest['foot' + f.n].length())) * s * rs * 0.985;
      const h = Math.hypot(_v1.x - ax, _v1.z - az);
      const dy = _v1.y - ay;
      const need = h < legL ? dy - Math.sqrt(legL * legL - h * h) : dy;
      drop = Math.max(drop, need);
    }
    // world-space drop (negative), eased; applied on top of the FK pelvis height
    const tgt = -Math.max(0, Math.min(drop, 0.5 * s * rs));
    this.pelvisDrop = tgt < this.pelvisDrop ? damp(this.pelvisDrop, tgt, 30, dt) : damp(this.pelvisDrop, tgt, 10, dt);
    hipsB.position.y += (this.pelvisDrop * this.ikW) / (s * rs);
    hipsB.updateMatrixWorld(true);
    // IK per leg
    for (const f of this.feet) {
      const th = B['thigh' + f.n], sh = B['shin' + f.n], ft = B['foot' + f.n];
      th.getWorldPosition(_v1);
      _v2.set(f.pos.x, f.pos.y + ankleH + Math.max(0, f.pitch) * 0.1 * s * rs, f.pos.z);
      _v3.set(_v1.x + fwdX * 1 + sideX * f.side * 0.12, _v1.y - 0.2, _v1.z + fwdZ * 1 + sideZ * f.side * 0.12);
      ik2(th, sh, ft.position, _v2, _v3, this.ikW);
      // foot flat on the ground, pitched by the gait
      root.getWorldQuaternion(_q1);
      _e1.set(f.pitch, f.side * 0.08, 0);
      _q2.setFromEuler(_e1);
      _q1.multiply(_q2);
      setWorldQuat(ft, _q1, this.ikW);
      B['toe' + f.n].rotation.x = -Math.max(0, f.pitch) * 0.9 * this.ikW;
      ft.updateMatrixWorld(true);
    }
  }

  hoodCheck() {
    const ha = this.headAnchor;
    if (ha.children.length === this.hatChildren) return;
    this.hatChildren = ha.children.length;
    const hat = ha.children.find((o) => o.name === 'moraHat');
    const B = this.B;
    const up = !hat;
    const k = (x) => (x ? 1 : 1e-4);
    if (B.hoodUp) { B.hoodUp.scale.setScalar(k(up)); B.hoodUpN.scale.setScalar(k(up)); B.hoodDn.scale.setScalar(k(!up)); }
    if (hat) { hat.scale.setScalar(1.12); hat.position.set(0, 0.018, -0.008); }
  }

  updateFace(dt, s, typing) {
    const u = this.faceU;
    const fx = this.fx, ftg = this.ft;
    if (this.exprHold > 0) { this.exprHold -= dt; if (this.exprHold <= 0) { this.exprHold = 0; this.setExpression(this.exprPrev); } }
    const k = 1 - Math.exp(-dt / 0.08);
    for (const key of EXPR_KEYS) fx[key] += (ftg[key] - fx[key]) * k;
    // blink
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 1; this.blinkT = this.dblBlink ? 0.22 : 2 + rand() * 3.5; this.dblBlink = !this.dblBlink && rand() < 0.2; }
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt / 0.16);
    const bl = this.blink > 0 ? Math.sin(this.blink * Math.PI) : 0;
    // eyes: saccades + look target
    this.eyeT -= dt;
    if (this.eyeT <= 0) { this.eyeT = 0.6 + rand() * 2.2; this.eyeTarget.set((rand() - 0.5) * 0.5, (rand() - 0.5) * 0.3, 0); }
    let lx = this.eyeTarget.x + clamp(((s.lookYaw ?? this.lookYaw) - (this.headYaw ?? 0)) * 2.2, -1, 1);
    let ly = this.eyeTarget.y + clamp(this.lookPitch * 2, -1, 1);
    if (this.lookPoint) {
      this.B.head.getWorldPosition(_v1);
      _v2.subVectors(this.lookPoint, _v1);
      this.B.head.getWorldQuaternion(_q1).invert();
      _v2.applyQuaternion(_q1);
      lx = clamp(Math.atan2(_v2.x, _v2.z) * 2.5, -1, 1); ly = clamp(Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z)) * 2.5, -1, 1);
    }
    this.eyeLook.x = damp(this.eyeLook.x, lx, 25, dt); this.eyeLook.y = damp(this.eyeLook.y, ly, 25, dt);
    // talking mouth: syllable-like noise
    if (typing) {
      this.talkN -= dt;
      if (this.talkN <= 0) { this.talkN = 0.07 + rand() * 0.09; this.talkTo = rand() < 0.2 ? 0.05 : 0.2 + rand() * 0.5; }
      this.talkV = damp(this.talkV, this.talkTo, 22, dt);
    } else this.talkV = damp(this.talkV, 0, 14, dt);
    const open = fx.open * (1 - bl) * (1 - this.w.dead);
    u.uEyeS.value.set(open, fx.tilt, fx.lower, fx.happy);
    u.uLook.value.x = this.eyeLook.x; u.uLook.value.y = this.eyeLook.y;
    u.uBrow.value.x = fx.raise; u.uBrow.value.y = fx.btilt; u.uBrow.value.z = fx.furrow;
    u.uMouth.value.x = clamp(fx.mOpen + this.talkV * (1 - fx.mOpen * 0.6) + this.w.panic * 0.5, 0, 1.2);
    u.uMouth.value.y = fx.smile; u.uMouth.value.w = fx.round + this.talkV * 0.2;
    u.uMouth.value.z = this.T.face.mouthW * fx.mW;
  }
}

// ---------------------------------------------------------------------------
export function makeHumanoid(c = {}) {
  const T = humanType(c);
  return new HumanRig(T);
}

export function makeGhost(rig, color = 0xbfe8ff, alpha = 0.6) {
  const gm = ghostSkinMat(color, alpha);
  const drop = [];
  rig.root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.isOutline) { drop.push(o); return; }
    o.material = gm; o.castShadow = false;
  });
  for (const o of drop) o.parent.remove(o);
  rig.ghostMat = gm;
  rig.faceU = null;
  return rig;
}
