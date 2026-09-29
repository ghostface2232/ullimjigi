// Enemy bodies: sculpted skinned meshes on the shared humanoid rig (ashlings,
// brutes, the ashen knight, shield bearers, archers) and creature rigs
// (wailer, ooze, moth, root hand, watcher). Per-instance toon materials go in
// rig.mats (hit flash via emissive, world-space dissolve); tier-colored glow
// materials in rig.glowMats (enemies.js sets color * 2.6). Ash-crack bodies
// share their glow Color with the glow material, so cracks follow the tier.
import * as THREE from 'three';
import { damp, clamp, lerp, rand } from '../core/util.js';
import { tube, blob, sheet, addGeo, sstep, mix, TAU, bodyMat, crackMat, vnoise3, rotateTowards, ik2, setWorldQuat, Spring } from './charkit.js';
import { CHAR, HumanRig, humanType, makeGhost } from './humanrig.js';
import * as HB from './humanoid.js';
import { glowBasic, glowTwin } from './creatures.js';

const V3 = THREE.Vector3;
const v = (x, y, z) => new V3(x, y, z);
const _v1 = new V3(), _v2 = new V3(), _v3 = new V3(), _v4 = new V3(), _v5 = new V3(), _q1 = new THREE.Quaternion();

// faceted rock geometry (flat shaded), unit size
const ROCKS = new Map();
function rockGeo(seed = 1, detail = 1) {
  const key = seed + '|' + detail;
  if (ROCKS.has(key)) return ROCKS.get(key);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 0.78 + 0.32 * vnoise3(x * 1.7 + seed * 3.1, y * 1.7 + seed, z * 1.7 - seed * 2);
    p.setXYZ(i, x * n, y * n * 0.9, z * n);
  }
  const f = g.toNonIndexed(); f.computeVertexNormals();
  ROCKS.set(key, f);
  return f;
}
function rigid(parentBone, geo, mat, pos, scl, rotn = null, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(pos);
  if (typeof scl === 'number') m.scale.setScalar(scl); else m.scale.copy(scl);
  if (rotn) m.rotation.set(rotn[0], rotn[1], rotn[2]);
  m.castShadow = shadow;
  parentBone.add(m);
  return m;
}
// bone-local position from a body-space point
function local(rig, bone, p) { return p.clone().sub(rig.T.def.pos(bone)); }

// ===========================================================================
// 허깨비 — ash phantom: hunched, long-armed, clawed, horned skull with ember
// eye slits, spined back, glowing core and cracks.
function ashlingCfg(frost) {
  const bodyC = frost ? 0x4e6078 : 0x3c3548, darkC = frost ? 0x2a3a52 : 0x231e2b;
  return {
    scale: 1.0, legLen: 0.62, torsoLen: 0.95, headR: 0.125, armLen: 1.45, bodyW: 0.82, limb: 0.78, shoulderW: 1.08, neckLen: 0.7,
    claws: true, bootH: 0, footS: 0.95, lower: 'skin', sleeveMat: 'skin', legMat: 'skin', bootMat: 'skin', shoeMat: 'skin', soleMat: 'dark', noCuff: true,
    topFolds: 0, legFolds: 0.01, face: false, head: false, hairStyle: 'none', outline: true, hunch: 0.5, stride: 2.2,
    group: (k) => (k === 'glow' ? 'glow' : k === 'dark' || k === 'horn' || k === 'tooth' || k === 'ice' ? 'main' : 'skin'),
    colors: { top: bodyC, skin: bodyC, pants: bodyC, dark: darkC, horn: darkC, tooth: 0xd8d0c0, glow: 0xffffff, ice: 0xbfe8ff },
    sculpt(S, L) {
      const hr = L.hr, HC = L.HC;
      const [y0, y1] = HB.torsoSpan(L);
      const T = HB.torsoR(L, this);
      // skull: long jutting jaw, heavy brow
      blob(S, 'skin', ['head', ['neck', 2], ['jaw', 1.4]], {
        c: HC.clone().add(v(0, -hr * 0.05, hr * 0.05)), r: [hr * 0.8, hr * 0.88, hr * 1.05], ws: 20, hs: 14,
        fn: (d, p) => {
          const low = sstep(0.1, -0.9, d.y), fr = sstep(-0.1, 0.8, d.z);
          p.z += low * fr * hr * 0.35; p.x *= 1 - 0.3 * low;
          const br = Math.exp(-((d.y - 0.25) ** 2) / 0.02) * sstep(0.3, 0.9, d.z);
          p.z += br * hr * 0.12; p.y += br * hr * 0.03;
          if (d.y > 0.5) p.z -= (d.y - 0.5) * hr * 0.3;
          p.multiplyScalar(1 + 0.04 * vnoise3(d.x * 5, d.y * 5, d.z * 5));
        },
      });
      for (const sd of [1, -1]) {
        // ember eye slits (outer corners raised)
        blob(S, 'glow', ['head'], { c: HC.clone().add(v(sd * hr * 0.33, hr * 0.06, hr * 1.02)), r: [hr * 0.22, hr * 0.075, hr * 0.12], ws: 10, hs: 6, fn: (d, p) => { p.y += p.x * sd * 0.5; } });
        // swept horns
        const h0 = HC.clone().add(v(sd * hr * 0.42, hr * 0.62, -hr * 0.05));
        tube(S, 'horn', ['head'], { pts: [h0, h0.clone().add(v(sd * hr * 0.45, hr * 0.55, -hr * 0.35)), h0.clone().add(v(sd * hr * 0.6, hr * 0.85, -hr * 1.1)), h0.clone().add(v(sd * hr * 0.45, hr * 0.7, -hr * 1.9))], seg: 8, steps: 12, r: (u) => hr * 0.24 * Math.pow(1 - u, 0.9) + 0.002, shape: (u, a) => 1 + 0.08 * Math.sin(u * 40), cap1: 1, cap0: 0.6 });
        // fangs
        for (let k = 0; k < 2; k++) {
          const f0 = HC.clone().add(v(sd * hr * (0.18 + k * 0.2), -hr * 0.52, hr * 1.18 - k * hr * 0.12));
          tube(S, 'tooth', ['jaw', ['head', 1.2]], { pts: [f0.clone().add(v(0, hr * 0.06, 0)), f0.clone().add(v(0, -hr * 0.18, hr * 0.02))], seg: 5, steps: 3, r: (u) => hr * 0.05 * (1 - u) + 0.001, cap1: 1 });
        }
      }
      // mouth slit
      tube(S, 'dark', ['jaw', ['head', 1.3]], { pts: [HC.clone().add(v(-hr * 0.5, -hr * 0.42, hr * 0.95)), HC.clone().add(v(0, -hr * 0.5, hr * 1.25)), HC.clone().add(v(hr * 0.5, -hr * 0.42, hr * 0.95))], seg: 6, steps: 8, r: [hr * 0.06, hr * 0.03], ref: v(0, 1, 0), cap0: 1, cap1: 1 });
      // back spines
      for (let k = 0; k < 6; k++) {
        const u = mix(0.88, 0.35, k / 5);
        const y = mix(y0, y1, u);
        const bz = T.oz(u) - T.rz(u) * 0.92;
        const sd = k % 2 ? 1 : -1;
        const b0 = v(sd * 0.035, y, bz);
        const len = 0.2 - k * 0.018;
        tube(S, 'dark', [u > 0.6 ? 'chest' : 'spine'], { pts: [b0.clone().add(v(0, 0, 0.03)), b0.clone().add(v(sd * 0.02, len * 0.5, -len * 0.45)), b0.clone().add(v(sd * 0.03, len * 0.8, -len * 1.0))], seg: 6, steps: 6, r: (uu) => 0.028 * (1 - uu) + 0.002, cap1: 1 });
      }
      // toe claws
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R';
        const tp = S.skel.pos('toe' + n);
        for (let k = -1; k <= 1; k++) {
          const b0 = v(tp.x + k * 0.028, 0.03, tp.z + 0.05 - Math.abs(k) * 0.012);
          tube(S, 'dark', ['toe' + n], { pts: [b0, b0.clone().add(v(k * 0.012, 0.004, 0.05)), b0.clone().add(v(k * 0.018, -0.02, 0.08))], seg: 5, steps: 4, r: (u) => 0.013 * (1 - u) + 0.001, cap1: 1 });
        }
      }
      // chest core crystal
      const cz = T.rz(0.72) + T.oz(0.72) + 0.005;
      const g = new THREE.OctahedronGeometry(0.055, 0); g.scale(0.8, 1.2, 0.7);
      addGeo(S, 'glow', ['chest'], g, new THREE.Matrix4().makeTranslation(0, mix(y0, y1, 0.66), cz));
      if (this.frost) for (const sd of [1, -1]) for (let k = 0; k < 3; k++) {
        const sp = v(sd * (L.SX + 0.02), L.SY + 0.03, -0.02 + k * 0.03);
        tube(S, 'ice', ['arm' + (sd > 0 ? 'L' : 'R'), ['chest', 1.5]], { pts: [sp, sp.clone().add(v(sd * 0.05, 0.13 - k * 0.03, -0.03 + k * 0.02))], seg: 5, steps: 3, r: (u) => 0.028 * (1 - u) + 0.002, cap1: 1 });
      }
    },
    frost,
  };
}
const ASH = { normal: ashlingCfg(false), frost: ashlingCfg(true) };

// a claw swipe: windup (arm cocked back, torso twisted) → swipe across on flick
function clawPose(q, s, R) {
  const a = R.w.cast;
  if (a < 0.01) return;
  const ft = R.flickT;
  const sw = sstep(0, 0.08, ft) * (1 - sstep(0.35, 0.7, ft));
  const wu = 1 - sw;
  const L = (x, y) => lerp(x, y, a);
  q.armRx = L(q.armRx, wu * -1.9 + sw * -0.9); q.armRz = L(q.armRz, wu * -0.5 + sw * 0.9); q.armRy = L(q.armRy, wu * -0.4 + sw * 0.6);
  q.foreRx = L(q.foreRx, wu * -1.3 + sw * -0.2); q.handRx = L(q.handRx, wu * -0.4 + sw * 0.4); q.fingR = L(q.fingR, wu * -0.3 + sw * 0.9);
  q.armLx = L(q.armLx, -0.5 - sw * 0.3); q.armLz = L(q.armLz, 0.5); q.foreLx = L(q.foreLx, -0.9);
  q.chesty += a * (wu * -0.45 + sw * 0.55); q.spiney += a * (wu * -0.2 + sw * 0.3);
  q.spinex += a * (wu * -0.1 + sw * 0.35); q.headx += a * (-0.25 * wu); q.jawx += a * 0.25;
  q.hipsPY -= a * 0.03;
}
function twitch(q, s, R) {
  // ashlings: deep hunch, restless head twitches and dangling, swaying arms
  const t = R.t;
  const up = 1 - Math.max(R.w.down, R.w.dead);
  q.spinex += 0.42 * up; q.chestx += 0.3 * up; q.neckx -= 0.25 * up; q.headx -= 0.42 * up;
  q.headz += Math.sin(t * 7.3) * Math.sin(t * 1.9) * 0.08;
  q.heady += Math.sin(t * 5.1) * Math.max(0, Math.sin(t * 0.7)) * 0.2;
  q.armLx -= 0.25; q.armRx -= 0.25; q.foreLx -= 0.3; q.foreRx -= 0.3;
  q.fingL += 0.3; q.fingR += 0.3;
  q.jawx += 0.08 + Math.max(0, Math.sin(t * 3.3)) * 0.12;
}

export function makeAshling(variant = 'normal') {
  const frost = variant === 'frost';
  const c = ASH[frost ? 'frost' : 'normal'];
  const T = humanType(c);
  const glow = glowBasic(frost ? 0x8fe3ff : 0xc9a0ff, 2.6);
  const M = {
    skin: crackMat(0xffffff, glow.color, { vertexColors: true, freq: 8, glow: 0.45, width: 0.035, rim: 0.75 }),
    glow,
  };
  const rig = new HumanRig(T, { mats: M, castPose: false, outline: 0.012, rim: 0.6, style: { armHang: 0.14, lift: 1.2 }, pose: (q, s, R, dt) => { twitch(q, s, R); clawPose(q, s, R, dt); } });
  rig.eyeMat = glow;
  rig.height = 1.5;
  return rig;
}

// ===========================================================================
// 돌무덤 — cairn brute: a hulking stone giant with cracked, glowing seams,
// boulder fists and a mantle of loose armor rocks (rig.armor, knocked off
// when the armor breaks). Frost variant grows ice crystals on its back.
function bruteCfg(frost) {
  const bodyC = frost ? 0x5a6a82 : 0x4a4452, darkC = frost ? 0x3a4a62 : 0x2c2833;
  return {
    scale: 2.0, legLen: 0.52, torsoLen: 1.22, headR: 0.105, neckLen: 0.15, bodyW: 1.6, chestK: 1.35, hipK: 0.85, shoulderW: 1.7, armLen: 1.22, limb: 1.55, armGirth: 1.45, legGirth: 1.0,
    noHand: true, bootH: 0, footS: 1.25, lower: 'skin', sleeveMat: 'skin', legMat: 'skin', bootMat: 'skin', shoeMat: 'skin', soleMat: 'dark', noCuff: true,
    topFolds: 0, legFolds: 0.02, face: false, head: false, hairStyle: 'none', outline: true, hunch: 0.3, stride: 1.2,
    group: (k) => (k === 'glow' ? 'glow' : k === 'dark' || k === 'ice' ? 'main' : 'skin'),
    colors: { top: bodyC, skin: bodyC, pants: bodyC, dark: darkC, glow: 0xffffff, ice: 0xbfe8ff },
    sculpt(S, L) {
      const hr = L.hr, HC = L.HC;
      const [y0, y1] = HB.torsoSpan(L);
      const T = HB.torsoR(L, this);
      // small brutish head sunk between the shoulders
      blob(S, 'skin', ['head', ['neck', 1.5], ['jaw', 1.2]], {
        c: HC.clone().add(v(0, -hr * 0.2, hr * 0.15)), r: [hr * 1.05, hr * 0.9, hr * 1.0], ws: 18, hs: 12,
        fn: (d, p) => {
          const low = sstep(0, -0.9, d.y);
          p.x *= 1 + 0.25 * low; p.z += low * sstep(0, 0.8, d.z) * hr * 0.35;
          const br = Math.exp(-((d.y - 0.3) ** 2) / 0.03) * sstep(0.2, 0.9, d.z);
          p.z += br * hr * 0.25; p.y += br * hr * 0.05;
          p.multiplyScalar(1 + 0.06 * vnoise3(d.x * 4, d.y * 4, d.z * 4));
        },
      });
      for (const sd of [1, -1]) blob(S, 'glow', ['head'], { c: HC.clone().add(v(sd * hr * 0.4, -hr * 0.02, hr * 1.1)), r: [hr * 0.2, hr * 0.09, hr * 0.1], ws: 8, hs: 6, fn: (d, p) => { p.y -= p.x * sd * 0.3; } });
      tube(S, 'dark', ['jaw', ['head', 1.2]], { pts: [HC.clone().add(v(-hr * 0.55, -hr * 0.62, hr * 1.02)), HC.clone().add(v(0, -hr * 0.7, hr * 1.28)), HC.clone().add(v(hr * 0.55, -hr * 0.62, hr * 1.02))], seg: 6, steps: 8, r: [hr * 0.08, hr * 0.04], ref: v(0, 1, 0), cap0: 1, cap1: 1 });
      // chest core and glowing seams
      const u = 0.66, cz = T.rz(u) + T.oz(u);
      const g = new THREE.OctahedronGeometry(0.07, 0); g.scale(1, 1.3, 0.7);
      addGeo(S, 'glow', ['chest'], g, new THREE.Matrix4().makeTranslation(0, mix(y0, y1, u), cz + 0.01));
      // stubby forearm stumps closed off (boulder fists are rigid)
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R';
        blob(S, 'skin', ['hand' + n, ['fore' + n, 1.5]], { c: S.skel.pos('hand' + n).clone().add(v(0, -0.02, 0)), r: [0.075, 0.07, 0.08], ws: 12, hs: 8 });
      }
      if (this.frost) for (let k = 0; k < 7; k++) {
        const x = (k - 3) * 0.075, uu = 0.78 + (k % 2) * 0.08;
        const b0 = v(x, mix(y0, y1, uu), T.oz(uu) - T.rz(uu) * 0.8);
        const h = 0.22 + (3 - Math.abs(k - 3)) * 0.07;
        tube(S, 'ice', ['chest'], { pts: [b0.clone().add(v(0, -0.03, 0.05)), b0.clone().add(v(x * 0.3, h * 0.8, -h * 0.28)), b0.clone().add(v(x * 0.35, h, -h * 0.35))], seg: 6, steps: 3, r: (t) => 0.075 * (1 - t * t) + 0.003, cap1: 0.3, ol: 0.5 });
      }
    },
    frost,
  };
}
const BRUTE = { normal: bruteCfg(false), frost: bruteCfg(true) };

// overhead two-handed slam: raise with aimPitch < 0, smash down with aimPitch > 0
function slamPose(q, s, R) {
  const a = R.w.cast;
  const ch = R.chargeW = damp(R.chargeW ?? 0, s.charge ?? 0, 6, 1 / 60);
  if (ch > 0.01) {
    // shoulder-first bull rush
    q.spinex += 0.45 * ch; q.chestx += 0.2 * ch; q.headx -= 0.25 * ch; q.chesty += 0.25 * ch;
    q.armLx = lerp(q.armLx, 0.5, ch * 0.6); q.armRx = lerp(q.armRx, -0.6, ch * 0.6); q.armLz = lerp(q.armLz, 0.4, ch); q.armRz = lerp(q.armRz, -0.3, ch);
  }
  if (a < 0.01) return;
  const pitch = s.aimPitch ?? 0;
  const raise = clamp((0.6 - pitch) / 1.9, 0, 1);
  const L = (x, y) => lerp(x, y, a);
  const ax = mix(-0.75, -2.85, raise);
  q.armLx = L(q.armLx, ax); q.armRx = L(q.armRx, ax);
  q.armLz = L(q.armLz, mix(-0.15, 0.25, raise)); q.armRz = L(q.armRz, mix(0.15, -0.25, raise));
  q.foreLx = L(q.foreLx, mix(-0.2, -0.9, raise)); q.foreRx = L(q.foreRx, mix(-0.2, -0.9, raise));
  q.foreLy = L(q.foreLy, -0.5 * raise); q.foreRy = L(q.foreRy, 0.5 * raise);
  q.spinex += a * mix(0.5, -0.3, raise); q.chestx += a * mix(0.3, -0.2, raise); q.headx += a * mix(-0.3, 0.2, raise);
  q.hipsPY -= a * mix(0.08, 0.02, raise);
  q.thighLx += a * mix(-0.3, 0, raise); q.shinLx += a * mix(0.4, 0, raise);
}

export function makeBrute(variant = 'normal') {
  const frost = variant === 'frost';
  const c = BRUTE[frost ? 'frost' : 'normal'];
  const T = humanType(c);
  const glow = glowBasic(frost ? 0x8fe3ff : 0xc080ff, 2.6);
  const rock = bodyMat(frost ? 0xbfe0f4 : 0x7a7068, { rim: 0.5, emissive: frost ? 0x1a3a5a : 0x000000 });
  const M = { skin: crackMat(0xffffff, glow.color, { vertexColors: true, freq: 5, glow: 0.5, width: 0.04, rim: 0.7, mott: 0.3 }), glow };
  const rig = new HumanRig(T, { mats: M, castPose: false, outline: 0.012, rim: 0.6, style: { armHang: 0.25, lift: 0.7, sway: 1.6 }, pose: (q, s, R) => { q.armLx -= 0.15; q.armRx -= 0.15; q.foreLx -= 0.25; q.foreRx -= 0.25; slamPose(q, s, R); } });
  rig.mats.push(rock);
  const B = rig.B;
  const P = (b, x, y, z) => local(rig, b, v(x, y, z));
  const L = rig.L;
  const [y0, y1] = HB.torsoSpan(L);
  // boulder fists
  for (const sd of [1, -1]) {
    const n = sd > 0 ? 'L' : 'R';
    const hp = T.def.pos('hand' + n);
    rigid(B['hand' + n], rockGeo(sd > 0 ? 3 : 4, 1), rock, P('hand' + n, hp.x + sd * 0.01, hp.y - 0.11, hp.z + 0.01), v(0.15, 0.14, 0.16), [0.3, sd, 0.2]);
  }
  // armor rocks: [back-high, back-low L, back-low R(kept), shoulder L, shoulder R, chest(kept), forearm L, forearm R]
  const armor = [];
  const add = (bone, x, y, z, s3, seed) => armor.push(rigid(B[bone], rockGeo(seed, 1), rock, P(bone, x, y, z), s3, [seed, seed * 2, seed * 0.5]));
  add('chest', 0, mix(y0, y1, 0.86), -0.17, v(0.2, 0.14, 0.12), 1);
  add('spine', 0.1, mix(y0, y1, 0.5), -0.18, v(0.13, 0.12, 0.09), 2);
  add('spine', -0.1, mix(y0, y1, 0.46), -0.17, v(0.12, 0.11, 0.09), 5);
  for (const sd of [1, -1]) { const n = sd > 0 ? 'L' : 'R'; const sp = T.def.pos('arm' + n); add('arm' + n, sp.x + sd * 0.03, sp.y + 0.06, sp.z, v(0.14, 0.1, 0.13), sd > 0 ? 6 : 7); }
  add('chest', 0.05, mix(y0, y1, 0.8), 0.13, v(0.12, 0.09, 0.07), 8);
  for (const sd of [1, -1]) { const n = sd > 0 ? 'L' : 'R'; const e = T.def.pos('fore' + n), w = T.def.pos('hand' + n); const m = e.clone().lerp(w, 0.45); add('fore' + n, m.x + sd * 0.04, m.y, m.z - 0.02, v(0.1, 0.12, 0.09), sd > 0 ? 9 : 10); }
  rig.armor = armor;
  rig.glowMat = glow; rig.eyeMat = glow;
  rig.height = 2.9;
  return rig;
}

// ===========================================================================
// 무명의 기사 — the Ashen Knight: Kael's forgotten shadow in ash-greyed plate,
// glowing visor and seams, a torn cape, and a greatsword with a burning edge.
function ashen(hex, k = 0.55) { return new THREE.Color(hex).lerp(new THREE.Color(0x3a3444), k).getHex(); }
function knightCfg(spectral) {
  const K = CHAR.kael;
  const col = (x) => (spectral ? x : ashen(x));
  return {
    ...K, scale: 1.4, outline: true, face: false, capeRag: true, capeLen: 1.0,
    group: (k) => (k === 'visor' ? 'glow' : 'skin'),
    colors: { metal: col(0x9a9aa8), hat: col(0x9a9aa8), cape: col(0x2a4a9a), lining: col(0x1a2a5a), plume: col(0x3a6ad0), trim: col(0xb89a58), glove: col(0x5a5a66), boots: col(0x5a5a66), pants: col(0x4a4a54), top: col(0x7a7a88), skin: col(0xe0c0a0), belt: col(0x6a4a2a), sole: 0x1a1820, visor: 0xffffff },
    spectral,
    sculpt(S, L) {
      const hr = L.hr, HC = L.HC;
      for (const sd of [1, -1]) blob(S, 'visor', ['head'], { c: HC.clone().add(v(sd * hr * 0.3, hr * 0.14, hr * 1.12)), r: [hr * 0.13, hr * 0.05, hr * 0.05], ws: 8, hs: 6 });
    },
  };
}
const KNIGHT = { normal: knightCfg(false), spectral: knightCfg(true) };
let swordGeo = null;
function getSwordGeo() {
  if (swordGeo) return swordGeo;
  swordGeo = HB.rigidGeo((S) => {
    // blade along +Z from the grip (origin): diamond section with a fuller
    tube(S, 'blade', 'r', { pts: [v(0, 0, 0.16), v(0, 0, 0.7), v(0, 0, 1.3), v(0, 0, 1.42)], seg: 4, steps: 10, ref: v(0, 1, 0), r: (u) => [0.012 + 0.004 * (1 - u), (0.062 - 0.012 * u) * (u > 0.88 ? (1 - u) / 0.12 : 1) + 0.002], cap1: 0.2 });
    tube(S, 'fuller', 'r', { pts: [v(0, 0, 0.18), v(0, 0, 1.0)], seg: 4, steps: 3, ref: v(0, 1, 0), r: [0.0135, 0.012], cap1: 1 });
    // crossguard with drooping quillons, wrapped grip, pommel
    tube(S, 'guard', 'r', { pts: [v(0, -0.2, 0.1), v(0, -0.12, 0.14), v(0, 0, 0.15), v(0, 0.12, 0.14), v(0, 0.2, 0.1)], seg: 8, steps: 12, ref: v(0, 0, 1), r: (u) => 0.022 + 0.012 * Math.sin(u * Math.PI), cap0: 1, cap1: 1 });
    tube(S, 'grip', 'r', { pts: [v(0, 0, -0.2), v(0, 0, 0.14)], seg: 8, steps: 8, ref: v(0, 1, 0), r: 0.024, shape: (u, a) => 1 + 0.1 * Math.abs(Math.sin(u * 30 + a * 0.5)) });
    blob(S, 'guard', 'r', { c: v(0, 0, -0.23), r: [0.04, 0.04, 0.04], ws: 10, hs: 8 });
  }, { blade: 0x8a8a9a, fuller: 0x4a4a58, guard: 0x6a6070, grip: 0x3a2a2a });
  return swordGeo;
}
function knightPose(q, s, R) {
  const a = R.w.cast;
  const t = R.t;
  // guard stance: greatsword low in the right hand, left hand loose
  const idle = 1 - a;
  q.armRx += -0.25 * idle; q.foreRx += -0.55 * idle; q.armRz += -0.1 * idle; q.fingR = 1.3; q.thumbR = 1.1;
  q.armLz += 0.08; q.spinex += 0.06; q.headx -= 0.04;
  if (a < 0.01) return;
  const pitch = s.aimPitch ?? 0;
  const raise = clamp((0.8 - pitch) / 2.4, 0, 1);
  const L = (x, y) => lerp(x, y, a);
  q.armRx = L(q.armRx, mix(-0.7, -2.9, raise)); q.armRz = L(q.armRz, mix(0.55, -0.25, raise)); q.armRy = L(q.armRy, mix(0.5, -0.2, raise));
  q.foreRx = L(q.foreRx, mix(-0.15, -1.2, raise));
  // left hand joins the grip up high, swings wide on the cut
  q.armLx = L(q.armLx, mix(-0.3, -2.5, raise)); q.armLz = L(q.armLz, mix(0.5, -0.35, raise)); q.foreLx = L(q.foreLx, mix(-0.4, -1.3, raise));
  q.chesty += a * mix(0.55, -0.35, raise); q.spiney += a * mix(0.25, -0.15, raise);
  q.spinex += a * mix(0.35, -0.12, raise); q.chestx += a * mix(0.2, -0.1, raise);
  q.headx += a * mix(-0.25, 0.1, raise);
  q.hipsPY -= a * 0.05;
  q.thighLx += a * -0.35; q.shinLx += a * 0.45; q.thighRx += a * 0.25; q.shinRx += a * 0.2;
  void t;
}
function knightPost(s, R) {
  // orient the fist so the blade points: low guard (idle), up/back (windup), forward-down (cut)
  const root = R.root;
  const re = root.matrixWorld.elements;
  const rs = root.scale.x || 1;
  const up = _v1.set(re[4], re[5], re[6]).multiplyScalar(1 / rs);
  const fw = _v2.set(re[8], re[9], re[10]).multiplyScalar(1 / rs);
  const a = R.w.cast * (1 - Math.max(R.w.dead, R.w.down));
  const raise = clamp((0.8 - (s.aimPitch ?? 0)) / 2.4, 0, 1);
  const ang = mix(-0.32, mix(-0.3, 2.6, raise), a) + R.w.kneel * -0.75;
  const want = _v3.copy(fw).multiplyScalar(Math.cos(ang)).addScaledVector(up, Math.sin(ang)).normalize();
  const hand = R.B.handR;
  hand.getWorldQuaternion(_q1);
  const cur = _v4.set(0, 0, 1).applyQuaternion(_q1);
  rotateTowards(hand, cur, want, 0.95 * (1 - R.w.shock));
  hand.updateMatrixWorld(true);
}

export function makeKnight(spectral = false) {
  const c = KNIGHT[spectral ? 'spectral' : 'normal'];
  const T = humanType(c);
  const glow = glowBasic(spectral ? 0x9ad0ff : 0xb080ff, 2.5);
  const M = { skin: crackMat(0xffffff, glow.color, { vertexColors: true, freq: 5.5, glow: 0.55, width: 0.03, rim: 0.8, mott: 0.15 }), glow };
  const rig = new HumanRig(T, { mats: M, castPose: false, hold: null, outline: 0.011, rim: 0.8, style: { armHang: 0.1 }, pose: knightPose, post: knightPost });
  const sword = new THREE.Group();
  const blade = bodyMat(0xffffff, { vertexColors: true, rim: 1.1 });
  const sm = new THREE.Mesh(getSwordGeo(), blade); sm.castShadow = true; sword.add(sm);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 1.18), new THREE.MeshBasicMaterial({ color: new THREE.Color(spectral ? 0x9ad0ff : 0xffd84a).multiplyScalar(2.5) }));
  edge.position.set(0, 0.066, 0.76); sword.add(edge);
  const edge2 = edge.clone(); edge2.position.y = -0.066; sword.add(edge2);
  sword.position.set(0, -rig.L.hand * 0.36, 0.004);
  rig.B.handR.add(sword);
  rig.mats.push(blade);
  rig.p.sword = sword; rig.p.swordEdge = edge;
  rig.glowMat = glow; rig.glowMats = spectral ? [] : [glow];
  rig.height = 2.4;
  if (spectral) makeGhost(rig, 0x9ad0ff, 0.7);
  return rig;
}

// ===========================================================================
// 방패지기 — a forgotten gate guard in dented plate and a faded tabard, still
// hiding behind its bronze tower shield (glowing rune), rusted mace in hand.
const SHIELD_CFG = {
  scale: 1.15, bodyW: 1.35, limb: 1.15, shoulderW: 1.1, armor: true, hat: 'helmet', plume: 1, tunic: 1, tunicLen: 0.42, belt: 1, gloves: 1, bootH: 0.6,
  face: false, noEars: true, hairStyle: 'none', outline: true, hunch: 0.08, stride: 1.45,
  group: (k) => (k === 'visor' ? 'glow' : 'skin'),
  colors: { metal: 0x6a6670, hat: 0x6a6670, trim: 0x7a6044, visor: 0xffffff, top: 0x3b3546, sleeve: 0x3b3546, pants: 0x26212e, tunic: 0x4f3040, plume: 0x4f3040, belt: 0x3a2a24, buckle: 0x7a6044, glove: 0x4a4650, boots: 0x4a4650, sole: 0x1a161e, skin: 0x3b3546 },
  sculpt(S, L) {
    const hr = L.hr, HC = L.HC;
    for (const sd of [1, -1]) blob(S, 'visor', ['head'], { c: HC.clone().add(v(sd * hr * 0.3, hr * 0.14, hr * 1.12)), r: [hr * 0.12, hr * 0.045, hr * 0.05], ws: 8, hs: 6 });
  },
};
let shieldGeo = null, maceGeo = null;
const SH_W = 0.66, SH_H = 1.08;
function getShieldGeo() {
  if (shieldGeo) return shieldGeo;
  shieldGeo = HB.rigidGeo((S) => {
    const curve = (x) => -0.07 * x * x;
    sheet(S, 'bronze', 'r', { nu: 8, nv: 10, thick: 0.045, top: true, fn: (u, vv, out) => { const x = (u - 0.5) * 2; out.set(x * SH_W / 2, (0.5 - vv) * SH_H - Math.pow(Math.abs(x), 3) * 0.04 * (vv > 0.5 ? 1 : -1), curve(x) * SH_W); }, inside: (p) => v(p.x, p.y, p.z - 1) });
    // iron rim, center rib, boss, rivets
    const rim = [];
    for (let k = 0; k <= 24; k++) { const t = k / 24, a = t * TAU; const x = Math.max(-1, Math.min(1, Math.cos(a) * 1.35)), y = Math.max(-1, Math.min(1, Math.sin(a) * 1.35)); rim.push(v(x * SH_W / 2, y * SH_H / 2, curve(x) * SH_W + 0.012)); }
    tube(S, 'iron', 'r', { pts: rim, closed: true, seg: 6, steps: 48, r: 0.022, ref: v(0, 0, 1) });
    tube(S, 'iron', 'r', { pts: [v(0, SH_H / 2, 0.014), v(0, -SH_H / 2, 0.014)], seg: 6, steps: 4, r: [0.02, 0.012], ref: v(0, 0, 1) });
    tube(S, 'iron', 'r', { pts: [v(-SH_W / 2, 0.02, curve(1) * SH_W + 0.014), v(0, 0.02, 0.016), v(SH_W / 2, 0.02, curve(1) * SH_W + 0.014)], seg: 6, steps: 8, r: [0.012, 0.018], ref: v(0, 0, 1) });
    blob(S, 'iron', 'r', { c: v(0, 0.02, 0.02), r: [0.1, 0.1, 0.06], ws: 14, hs: 8, skip: (d) => d.z < -0.2 });
    for (const [x, y] of [[-0.27, 0.46], [0.27, 0.46], [-0.27, -0.46], [0.27, -0.46], [-0.27, 0], [0.27, 0]]) blob(S, 'iron', 'r', { c: v(x, y, curve(x / (SH_W / 2)) * SH_W + 0.028), r: [0.016, 0.016, 0.012], ws: 6, hs: 4 });
    // grip + arm strap on the back
    tube(S, 'leather', 'r', { pts: [v(-0.06, 0.05, -0.02), v(0, 0.05, -0.075), v(0.06, 0.05, -0.02)], seg: 5, steps: 6, r: 0.016, ref: v(0, 1, 0) });
    tube(S, 'leather', 'r', { pts: [v(-0.12, 0.3, -0.02), v(0, 0.3, -0.08), v(0.12, 0.3, -0.02)], seg: 5, steps: 6, r: [0.03, 0.008], ref: v(0, 1, 0) });
  }, { bronze: 0x7a6044, iron: 0x5a5660, leather: 0x3a2a22 });
  return shieldGeo;
}
function getMaceGeo() {
  if (maceGeo) return maceGeo;
  maceGeo = HB.rigidGeo((S) => {
    tube(S, 'haft', 'r', { pts: [v(0, 0, -0.14), v(0, 0, 0.3), v(0, 0, 0.62)], seg: 7, steps: 8, ref: v(0, 1, 0), r: (u) => 0.022 + 0.005 * u, cap0: 0.6 });
    tube(S, 'wrap', 'r', { pts: [v(0, 0, -0.1), v(0, 0, 0.12)], seg: 7, steps: 6, ref: v(0, 1, 0), r: 0.027 });
    blob(S, 'iron', 'r', { c: v(0, 0, 0.7), r: [0.085, 0.085, 0.11], ws: 12, hs: 8, fn: (d, p) => { const lon = Math.atan2(d.x, d.y); p.multiplyScalar(1 + 0.3 * Math.pow(Math.max(0, Math.cos(lon * 3)), 6) * (1 - Math.abs(d.z))); } });
    tube(S, 'iron', 'r', { pts: [v(0, 0, 0.78), v(0, 0, 0.86)], seg: 6, steps: 2, ref: v(0, 1, 0), r: (u) => 0.03 * (1 - u) + 0.004, cap1: 1 });
  }, { haft: 0x3a2e28, wrap: 0x5a3a2a, iron: 0x5e5a62 });
  return maceGeo;
}
function shieldPose(q, s, R, dt) {
  R.g = damp(R.g ?? 0, s.guard ? 1 : 0, 8, dt);
  R.bashW = damp(R.bashW ?? 0, s.bash ? 1 : 0, s.bash ? 22 : 6, dt);
  R.brk = damp(R.brk ?? 0, s.broken ? 1 : 0, s.broken ? 10 : 3, dt);
  const g = R.g * (1 - R.brk), b = R.bashW;
  // braced stance behind the shield, shove with the shoulder on a bash
  q.spinex += 0.1 * g + 0.25 * b; q.chesty -= 0.2 * g + 0.25 * b; q.hipsy -= 0.1 * g; q.headx -= 0.1 * g;
  q.thighLx -= 0.3 * g + 0.3 * b; q.shinLx += 0.35 * g + 0.2 * b; q.thighRx += 0.15 * g; q.shinRx += 0.15 * g; q.hipsPY -= 0.05 * g;
  // mace arm: cocked when guarding, raised on the bash
  q.armRx += -0.25 - 0.3 * g - 0.9 * b; q.armRz -= 0.15 * g; q.foreRx += -0.6 - 0.5 * b; q.fingR = 1.3; q.thumbR = 1.1;
  q.fingL = 1.2; q.thumbL = 1.0;
  // staggered off balance when the guard breaks
  q.spinex -= 0.25 * R.brk; q.chesty += 0.3 * R.brk; q.headx += 0.2 * R.brk;
}
const SH_POSE = {
  carry: { p: v(0.43, 0.8, 0.1), r: [0, 1.4, 0.05] },
  guard: { p: v(0.03, 0.98, 0.44), r: [-0.05, -0.08, 0] },
};
function shieldPost(s, R) {
  const g = (R.g ?? 0) * (1 - (R.brk ?? 0)), b = R.bashW ?? 0, k = R.brk ?? 0;
  const pv = R.shieldPivot;
  const A = SH_POSE.carry, Bp = SH_POSE.guard;
  pv.position.lerpVectors(A.p, Bp.p, g);
  pv.position.z += b * 0.32; pv.position.y += b * 0.05 - k * 0.3; pv.position.x += k * 0.12;
  pv.rotation.set(mix(A.r[0], Bp.r[0], g) + k * 0.6 - b * 0.12, mix(A.r[1], Bp.r[1], g) + k * 0.5, mix(A.r[2], Bp.r[2], g) + k * 0.7 + Math.sin(R.t * 2) * 0.015);
  pv.updateMatrixWorld(true);
  // left hand grips the shield (IK), fist oriented along the grip
  const B = R.B;
  const target = R._grip.getWorldPosition(_v1);
  const pole = _v2.set(0.9, 0.6, -0.8).applyMatrix4(R.body.matrixWorld);
  ik2(B.armL, B.foreL, R._handOff, target, pole, 1 - Math.max(R.w.dead, R.w.down) * 0.7);
  // mace orientation: forward-down, raised on the bash
  const re = R.root.matrixWorld.elements, rs = R.root.scale.x || 1;
  const up = _v1.set(re[4], re[5], re[6]).multiplyScalar(1 / rs), fw = _v2.set(re[8], re[9], re[10]).multiplyScalar(1 / rs);
  const ang = mix(-0.35, 1.3, b) + g * 0.4;
  const want = _v3.copy(fw).multiplyScalar(Math.cos(ang)).addScaledVector(up, Math.sin(ang)).normalize();
  B.handR.getWorldQuaternion(_q1);
  rotateTowards(B.handR, _v4.set(0, 0, 1).applyQuaternion(_q1), want, 0.9 * (1 - R.w.shock) * (1 - R.w.dead));
  B.handR.updateMatrixWorld(true);
}

export function makeShieldBearer() {
  const T = humanType(SHIELD_CFG);
  const glow = glowBasic(0xc9a0ff, 2.6);
  const M = { skin: crackMat(0xffffff, glow.color, { vertexColors: true, freq: 6, glow: 0.5, width: 0.03, rim: 0.75, mott: 0.15 }), glow };
  const rig = new HumanRig(T, { mats: M, castPose: false, hold: null, outline: 0.011, rim: 0.7, pose: shieldPose, post: shieldPost });
  const B = rig.B;
  const gear = bodyMat(0xffffff, { vertexColors: true, rim: 0.9 });
  rig.mats.push(gear);
  // shield pivot in body space (follows the chest)
  const anchor = new THREE.Group();
  anchor.position.copy(T.def.pos('chest')).negate();
  B.chest.add(anchor);
  const pivot = new THREE.Group(); anchor.add(pivot);
  const shield = new THREE.Mesh(getShieldGeo(), gear); shield.castShadow = true; pivot.add(shield);
  const g2 = glowTwin(glow);
  const rune = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.165, 24), g2); rune.position.set(0, 0.02, 0.07); pivot.add(rune);
  for (let i = 0; i < 2; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.22, 0.01), g2); bar.position.set(i ? 0.15 : -0.15, -0.34, 0.03); bar.rotation.z = i ? 0.4 : -0.4; pivot.add(bar); }
  const grip = new THREE.Object3D(); grip.position.set(0, 0.05, -0.1); pivot.add(grip);
  rig._grip = grip;
  rig._handOff = T.def.pos('handL').clone().sub(T.def.pos('foreL'));
  // mace
  const mace = new THREE.Mesh(getMaceGeo(), gear); mace.castShadow = true;
  mace.position.set(0, -rig.L.hand * 0.36, 0.004); B.handR.add(mace);
  rig.shield = pivot; rig.shieldPivot = pivot;
  rig.glowMats = [glow]; rig.glowMat = glow;
  rig.height = 2.0;
  return rig;
}

// ===========================================================================
// 메아리 사수 — a hooded echo in a tattered cloak and cracked bone mask that
// still draws a bow it no longer remembers (glowing string, quivered arrows).
const ARCHER_CFG = {
  scale: 1.0, bodyW: 0.84, limb: 0.82, legLen: 0.82, armLen: 1.05, headR: 0.15, cape: 1, capeLen: 0.95, capeRag: true, capeFlare: 1.2,
  bootH: 0.7, gloves: 1, belt: 1, face: false, head: true, noEars: true, hairStyle: 'none', outline: true, hunch: 0.18, stride: 1.9, legFolds: 0.05,
  group: (k) => (k === 'glow' ? 'glow' : 'skin'),
  colors: { skin: 0x2c2833, top: 0x2c2833, sleeve: 0x2c2833, pants: 0x25222c, cape: 0x3a4452, lining: 0x262c38, cloak: 0x3a4452, cloakIn: 0x262c38, mask: 0xd8d0bf, glove: 0x3a3440, boots: 0x3a3440, sole: 0x18161c, belt: 0x4a3a2c, buckle: 0x6a5a44, wood: 0x5a4230, glow: 0xffffff, dark: 0x0e0c12 },
  sculpt(S, L) {
    const hr = L.hr, HC = L.HC;
    HB.hood(S, L, this, 'cloak', 'cloakIn');
    // bone mask with dark eye holes and ember eyes
    blob(S, 'mask', ['head'], {
      c: HC.clone().add(v(0, -hr * 0.1, hr * 0.62)), r: [hr * 0.78, hr * 0.95, hr * 0.5], ws: 18, hs: 12, skip: (d) => d.z < -0.1,
      fn: (d, p) => { p.z += hr * 0.18 * (1 - d.x * d.x) * sstep(-0.9, 0.3, d.y); if (d.y < -0.4) { p.x *= 1 - 0.35 * (-d.y - 0.4); p.z += hr * 0.1; } },
    });
    for (const sd of [1, -1]) {
      blob(S, 'dark', ['head'], { c: HC.clone().add(v(sd * hr * 0.3, hr * 0.02, hr * 1.21)), r: [hr * 0.17, hr * 0.13, hr * 0.05], ws: 10, hs: 6, fn: (d, p) => { p.y += p.x * sd * 0.3; } });
      blob(S, 'glow', ['head'], { c: HC.clone().add(v(sd * hr * 0.3, hr * 0.01, hr * 1.25)), r: [hr * 0.065, hr * 0.08, hr * 0.025], ws: 8, hs: 6 });
    }
    // quiver on the back with glowing nocks
    const q0 = v(-0.08, L.SY - 0.36, -0.13), q1 = v(0.1, L.SY + 0.08, -0.17);
    tube(S, 'wood', ['chest', 'spine'], { pts: [q0, q1], seg: 10, steps: 4, r: (u) => mix(0.045, 0.055, u), ref: v(0, 0, 1), cap0: 0.6 });
    for (let k = 0; k < 3; k++) {
      const b0 = q1.clone().add(v((k - 1) * 0.025, 0.01, (k % 2) * 0.02 - 0.01));
      tube(S, 'glow', ['chest'], { pts: [b0, b0.clone().add(v(0.02, 0.11, -0.01))], seg: 4, steps: 2, r: (u) => 0.018 * (1 - u * 0.6), cap1: 1 });
    }
  },
};
let bowGeo = null;
const BOW_R = 0.62, BOW_A = 0.4 * Math.PI;
const BOW_TIP_Y = BOW_R * Math.sin(BOW_A), BOW_TIP_Z = -BOW_R + BOW_R * Math.cos(BOW_A);
function getBowGeo() {
  if (bowGeo) return bowGeo;
  bowGeo = HB.rigidGeo((S) => {
    // bow in its own space: grip at origin, limbs arc up/down curving back to -Z
    const pts = [];
    for (let k = 0; k <= 16; k++) { const a = mix(-BOW_A, BOW_A, k / 16); pts.push(v(0, BOW_R * Math.sin(a), -BOW_R + BOW_R * Math.cos(a) + 0.05 * Math.pow(Math.abs(a / BOW_A), 3))); }
    tube(S, 'wood', 'r', { pts, seg: 6, steps: 32, ref: v(0, 0, 1), r: (u) => { const c = Math.abs(u - 0.5) * 2; return [0.016 + 0.01 * (1 - c), 0.022 + 0.012 * (1 - c)]; }, cap0: 1, cap1: 1 });
    tube(S, 'wrap', 'r', { pts: [v(0, -0.08, 0.004), v(0, 0.08, 0.004)], seg: 7, steps: 4, ref: v(0, 0, 1), r: 0.032 });
  }, { wood: 0x5a4230, wrap: 0x3a2a24 });
  return bowGeo;
}
function archerPose(q, s, R, dt) {
  R.aimW = damp(R.aimW ?? 0, s.aim ? 1 : 0, s.aim ? 10 : 5, dt);
  const a = R.aimW;
  if (a < 0.01) return;
  // side-on stance: left shoulder to the target, head turned back to aim
  q.chesty -= 1.0 * a; q.spiney -= 0.35 * a; q.hipsy -= 0.3 * a;
  q.heady += 1.15 * a; q.necky += 0.2 * a; q.headx += -(s.aimPitch ?? 0) * 0.5 * a;
  q.spinex -= 0.08 * a; q.chestx += (s.aimPitch ?? 0) * 0.3 * a;
  q.thighLz += 0.12 * a; q.thighRz -= 0.12 * a; q.thighLy -= 0.4 * a;
  q.fingL = 1.4; q.thumbL = 1.2; q.fingR = lerp(q.fingR, 0.7, a);
}
function archerPost(s, R, dt) {
  const B = R.B;
  const a = R.aimW ?? 0;
  const lie = Math.max(R.w.dead, R.w.down);
  R.drawW = damp(R.drawW ?? 0, s.draw ?? 0, s.draw ? 8 : 30, dt);
  const d = R.drawW * a;
  const re = R.root.matrixWorld.elements, rs = R.root.scale.x || 1;
  const up = _v1.set(re[4], re[5], re[6]).multiplyScalar(1 / rs), fw = _v2.set(re[8], re[9], re[10]).multiplyScalar(1 / rs);
  const pitch = s.aimPitch ?? 0;
  const aim = R._aim.copy(fw).multiplyScalar(Math.cos(pitch)).addScaledVector(up, -Math.sin(pitch)).normalize();
  const W = 1 - lie;
  if (a > 0.01 && W > 0.01) {
    // bow arm straight at the target, draw hand pulls the string to the cheek
    B.armL.getWorldPosition(_v3);
    const reach = R._reach;
    const tL = R._tL.copy(_v3).addScaledVector(aim, reach * 0.97);
    ik2(B.armL, B.foreL, R._hOffL, tL, _v4.copy(_v3).addScaledVector(up, -1).addScaledVector(fw, -0.3), a * W);
    const bowP = B.handL.getWorldPosition(R._bp);
    const tR = R._tR.copy(bowP).addScaledVector(aim, -mix(0.16, reach * 0.95, d)).addScaledVector(up, 0.02);
    B.armR.getWorldPosition(_v3);
    ik2(B.armR, B.foreR, R._hOffR, tR, _v4.copy(_v3).addScaledVector(up, 0.2).addScaledVector(aim, -1), a * W);
  }
  // bow: vertical, facing the aim (held low at the side when idle)
  const bow = R._bow;
  const idleDir = _v3.copy(fw).multiplyScalar(0.8).addScaledVector(up, -0.6).normalize();
  const dir = R._dir.copy(idleDir).lerp(aim, a).normalize();
  const bu = R._bu.copy(up).addScaledVector(dir, -up.dot(dir)).normalize();
  const bx = _v1.crossVectors(bu, dir).normalize();
  R._m.makeBasis(bx, bu, dir);
  _q1.setFromRotationMatrix(R._m);
  setWorldQuat(bow, _q1, 1);
  bow.updateMatrixWorld(true);
  // string: tips to the nock (right hand while drawing)
  const nock = R._nock.set(0, 0, BOW_TIP_Z);
  if (d > 0.01) { B.handR.getWorldPosition(_v2); R._inv.copy(bow.matrixWorld).invert(); _v2.applyMatrix4(R._inv); nock.lerp(_v2, sstep(0, 0.25, d)); nock.x *= 0.3; }
  const seg = (m, ty) => { _v3.set(0, ty, BOW_TIP_Z).sub(nock); const L = _v3.length(); m.position.copy(nock); m.scale.set(1, L, 1); m.quaternion.setFromUnitVectors(R._up, _v3.normalize()); };
  seg(R._strA, BOW_TIP_Y); seg(R._strB, -BOW_TIP_Y);
  R._arrow.visible = d > 0.08;
  R._arrow.position.copy(nock);
}

export function makeArcher() {
  const T = humanType(ARCHER_CFG);
  const glow = glowBasic(0x9aeaff, 2.6);
  const M = { skin: crackMat(0xffffff, glow.color, { vertexColors: true, freq: 7, glow: 0.45, width: 0.03, rim: 0.6, mott: 0.12 }), glow };
  const rig = new HumanRig(T, { mats: M, castPose: false, hold: null, outline: 0.011, rim: 0.6, pose: archerPose, post: archerPost });
  const B = rig.B;
  const gear = bodyMat(0xffffff, { vertexColors: true, rim: 0.6 });
  rig.mats.push(gear);
  const bow = new THREE.Group();
  const bm = new THREE.Mesh(getBowGeo(), gear); bm.castShadow = true; bow.add(bm);
  const g2 = glowTwin(glow);
  const tipG = new THREE.ConeGeometry(0.028, 0.1, 4);
  for (const sy of [-1, 1]) { const t = new THREE.Mesh(tipG, g2); t.position.set(0, sy * (BOW_TIP_Y + 0.03), BOW_TIP_Z + 0.03); t.rotation.x = sy > 0 ? -0.5 : Math.PI + 0.5; bow.add(t); }
  const segGeo = new THREE.CylinderGeometry(0.005, 0.005, 1, 3); segGeo.translate(0, 0.5, 0);
  rig._strA = new THREE.Mesh(segGeo, g2); rig._strB = new THREE.Mesh(segGeo, g2);
  bow.add(rig._strA, rig._strB);
  const arrow = new THREE.Group();
  { const ag = new THREE.CylinderGeometry(0.01, 0.01, 0.82, 4); ag.rotateX(Math.PI / 2); ag.translate(0, 0, 0.41); arrow.add(new THREE.Mesh(ag, g2)); }
  { const hg = new THREE.ConeGeometry(0.03, 0.11, 4); hg.rotateX(Math.PI / 2); hg.translate(0, 0, 0.86); arrow.add(new THREE.Mesh(hg, g2)); }
  bow.add(arrow);
  bow.position.set(0, -rig.L.hand * 0.36, 0.01);
  B.handL.add(bow);
  Object.assign(rig, {
    _bow: bow, _arrow: arrow, _aim: new V3(), _tL: new V3(), _tR: new V3(), _bp: new V3(), _dir: new V3(), _bu: new V3(), _nock: new V3(), _up: new V3(0, 1, 0),
    _m: new THREE.Matrix4(), _inv: new THREE.Matrix4(),
    _hOffL: T.def.pos('handL').clone().sub(T.def.pos('foreL')), _hOffR: T.def.pos('handR').clone().sub(T.def.pos('foreR')),
    _reach: (rig.L.upper + rig.L.fore) * (T.c.scale ?? 1),
  });
  rig.p.bow = bow;
  rig.glowMats = [glow]; rig.glowMat = glow;
  rig.height = 1.75;
  return rig;
}

export { makeGhost, CHAR };
