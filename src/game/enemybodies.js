// Enemy bodies on the shared humanoid rig (ashlings, brutes, the ashen knight,
// shield bearers, archers). Only the skeleton and the animation come from the
// humanoid: every body here is its own sculpt (signed-distance masses for the
// seamless forms, lofted parts for the crisp ones). Per-instance toon materials
// go in rig.mats (hit flash via emissive, world-space dissolve); tier-colored
// glow materials in rig.glowMats (enemies.js sets color * 2.6). Fissures are
// real geometry: grooves cut down to a glowing inner mass.
import * as THREE from 'three';
import { damp, clamp, lerp, rand } from '../core/util.js';
import { tube, blob, sheet, sstep, mix, TAU, bodyMat, vnoise3, rotateTowards, ik2, setWorldQuat, Spring } from './charkit.js';
import { CHAR, HumanRig, humanType, makeGhost } from './humanrig.js';
import { glowBasic, glowTwin, Field, shard, shade, sheen, rigidType, spike, tatter, prism, megalith, builtFromModel, dress, rigids } from './creatures.js';
import { model } from '../render/models.js';
import { WardenShell } from './warden.js';

const V3 = THREE.Vector3;
const v = (x, y, z) => new V3(x, y, z);
const _v1 = new V3(), _v2 = new V3(), _v3 = new V3(), _v4 = new V3(), _v5 = new V3(), _q1 = new THREE.Quaternion();

function rigid(parentBone, geo, mat, pos, scl = 1, rotn = null, shadow = true) {
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

// Custom-bodied type on the humanoid skeleton. c.build(S, L, j) sculpts everything
// (j(name) = joint position) and returns shade() options, applied once per type.
const GLOW = (k) => (k.startsWith('glow') ? 'glow' : k.startsWith('metal') ? 'metal' : k === 'ice' ? 'ice' : 'main');
function enemyType(c) {
  if (!c.sculpt) {
    Object.assign(c, { body: false, head: false, face: false, hairStyle: 'none', outline: true });
    c.group = c.group || GLOW;
    c.sculpt = (S, L, def) => { if (model('mn_' + (c.model?.file || c.key))) return; c._S = S; c._post = c.build(S, L, (n) => def.pos(n), def); };
  }
  const T = humanType(c);
  if (!T.shaded) {
    T.shaded = true;
    const authored = builtFromModel(c.key, T.def, c.model);   // authored in Blender (ref/blender/mn2)
    if (authored) T.built = authored; else if (c._post) shade(c._S, T.built.geo, c.group, c._post);
    c._S = c._post = null;
  }
  return T;
}

const stoneNoise = (f, a) => (x, y, z) => (vnoise3(x * f + 3.1, y * f, z * f - 1.7) - 0.5) * a + (vnoise3(x * f * 2.7, y * f * 2.7 + 5, z * f * 2.7) - 0.5) * a * 0.35;

// ===========================================================================
// 허깨비 — ash phantom: a gaunt, hunched husk of ash under a horned bone skull.
// Hollow chest with a floating core shard caged by rib prongs, glowing
// fissures, long forearms ending in hooked claws, a torn shroud at neck and waist.
function ashlingCfg(frost) {
  const ash = frost ? 0x6f86a6 : 0x6c627c, soot = frost ? 0x2c3d58 : 0x2b2536;
  return {
    key: frost ? 'ashlingFrost' : 'ashling', model: { file: 'ashling', skip: frost ? [] : ['ice'] }, scale: 1.0, legLen: 0.62, torsoLen: 0.95, headR: 0.125, armLen: 1.45, bodyW: 0.82, shoulderW: 1.08, neckLen: 0.7, hunch: 0.5, stride: 2.2, frost,
    colors: { ash, soot, bone: 0xd8cfbb, horn: frost ? 0x8fb4d0 : 0x2a2230, cloth: frost ? 0x35485f : 0x2b2434, clothIn: 0x17131d, glow: 0xffffff, glowD: 0x8a8a8a, ice: 0xcdeeff },
    build(S, L, j) {
      const HC = L.HC, hr = L.hr;
      const F = new Field(S);
      // trunk: narrow pelvis, starved waist, barrel ribcage, knobbed shoulders
      F.bind(['hips'], 0.03).ell(j('hips').clone().add(v(0, 0.01, 0)), [0.1, 0.075, 0.078]);
      F.bind(['hips', 'spine'], 0.04).cone(j('hips'), j('spine').clone().add(v(0, 0.06, 0)), 0.062, 0.056);
      F.bind(['chest', ['spine', 1.5]], 0.045).ell(v(0, L.SY - 0.1, -0.005), [0.135, 0.15, 0.11], { rot: [0.12, 0, 0] });
      F.bind(['chest', 'neck'], 0.035).cone(v(0, L.SY, -0.02), j('head').clone().add(v(0, 0, 0.0)), 0.05, 0.036);
      // spine ridge
      F.bind(['spine', 'chest'], 0.02).limb([v(0, L.H + 0.02, -0.07), v(0, L.SY - 0.2, -0.105), v(0, L.SY - 0.02, -0.11), v(0, L.SY + 0.06, -0.06)], [0.025, 0.03, 0.034, 0.025]);
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R';
        const sh = j('arm' + n), el = j('fore' + n), wr = j('hand' + n), th = j('thigh' + n), kn = j('shin' + n), an = j('foot' + n), toe = j('toe' + n);
        F.bind([['arm' + n, 1], ['chest', 1.6]], 0.04).ell(sh.clone().add(v(sd * 0.012, 0.012, 0)), [0.062, 0.055, 0.058]);
        F.bind(['arm' + n, 'fore' + n], 0.03).cone(sh, el, 0.04, 0.03);
        F.bind(['fore' + n, ['arm' + n, 1.5]], 0.02).ell(el.clone().add(v(0, 0, -0.012)), [0.04, 0.046, 0.044]);
        F.bind(['fore' + n, ['hand' + n, 1.4]], 0.025).cone(el, wr.clone().lerp(el, 0.08), 0.03, 0.05, { flat: [v(1, 0, 0), 0.8] });
        F.bind(['hand' + n, ['fing' + n, 1.5]], 0.025).ell(wr.clone().add(v(0, -L.hand * 0.22, 0.004)), [0.034, L.hand * 0.3, 0.052]);
        F.bind([['hips', 1.3], 'thigh' + n], 0.04).cone(th.clone().add(v(0, 0.01, 0)), kn, 0.062, 0.042);
        F.bind(['shin' + n, ['thigh' + n, 1.5]], 0.02).ell(kn.clone().add(v(0, 0, 0.014)), [0.046, 0.05, 0.05]);
        F.bind(['shin' + n, ['foot' + n, 1.4]], 0.025).cone(kn, an.clone().add(v(0, 0.02, 0)), 0.04, 0.03);
        F.bind(['foot' + n, ['toe' + n, 1.1]], 0.03).cone(v(an.x, 0.045, an.z - 0.03), v(toe.x, 0.034, toe.z + 0.01), 0.04, 0.036, { flat: [v(1, 0, 0), 1.25] });
      }
      // glowing inner mass, seen through the hollow chest and the fissures
      const G = new Field(S);
      G.bind(['chest', ['spine', 1.5]], 0.03).ell(v(0, L.SY - 0.1, -0.005), [0.108, 0.122, 0.082], { rot: [0.12, 0, 0] });
      G.bind(['hips', 'spine']).cone(j('hips'), j('spine').clone().add(v(0, 0.06, 0)), 0.04, 0.036);
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R', el = j('fore' + n), wr = j('hand' + n), th = j('thigh' + n), kn = j('shin' + n);
        G.bind(['fore' + n]).cone(el.clone().lerp(wr, 0.25), wr.clone().lerp(el, 0.12), 0.019, 0.03);
        G.bind(['thigh' + n]).cone(th.clone().lerp(kn, 0.15), kn.clone().lerp(th, 0.15), 0.036, 0.024);
      }
      // hollow chest and fissures down to the glow
      const cav = v(0, L.SY - 0.13, 0.085);
      F.ell(cav, [0.074, 0.1, 0.07], { sub: true, k: 0.02 });
      F.groove([v(-0.11, L.SY - 0.02, 0.12), v(-0.1, L.SY - 0.12, 0.13), v(-0.06, L.SY - 0.2, 0.12), v(-0.07, L.SY - 0.3, 0.1)], 0.02, 0.014);
      F.groove([v(0.06, L.SY - 0.02, -0.14), v(0.02, L.SY - 0.14, -0.15), v(0.07, L.SY - 0.24, -0.13), v(0.03, L.H + 0.08, -0.1)], 0.02, 0.014);
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R', el = j('fore' + n), wr = j('hand' + n), th = j('thigh' + n), kn = j('shin' + n);
        F.groove([el.clone().lerp(wr, 0.3).add(v(sd * 0.06, 0, 0)), el.clone().lerp(wr, 0.55).add(v(sd * 0.06, 0, 0.02)), el.clone().lerp(wr, 0.85).add(v(sd * 0.07, 0, 0))], 0.018, 0.012);
        F.groove([th.clone().lerp(kn, 0.25).add(v(sd * 0.03, 0, 0.08)), th.clone().lerp(kn, 0.5).add(v(sd * 0.05, 0, 0.07)), th.clone().lerp(kn, 0.8).add(v(sd * 0.02, 0, 0.07))], 0.018, 0.012);
      }
      F.mesh('ash', { cell: 0.0175 });
      G.mesh('glowD', { cell: 0.022, ol: 0 });
      // core shard floating in the chest, caged by rib prongs
      shard(S, 'glow', ['chest'], cav.clone().add(v(0, -0.075, -0.012)), cav.clone().add(v(0, 0.08, -0.006)), 0.036, { sides: 5, waist: 0.45, ol: 0 });
      for (const sd of [1, -1]) for (let k = 0; k < 3; k++) {
        const p0 = F.on(cav.clone().add(v(sd * 0.09, 0.075 - k * 0.07, 0.02)), -0.004);
        spike(S, 'bone', ['chest'], p0, v(-sd * 0.55, -0.1, 0.8), 0.08 - k * 0.008, 0.011, { bend: v(-sd * 0.5, 0, -0.5), seg: 6, ol: 0.35 });
      }
      // skull: long-jawed bone mask with deep sockets
      const K = new Field(S);
      const sk = HC.clone().add(v(0, 0, 0.02));
      K.bind(['head'], 0.03).ell(sk, [hr * 0.8, hr * 0.86, hr * 0.98]);
      K.cone(sk.clone().add(v(0, -hr * 0.2, hr * 0.5)), sk.clone().add(v(0, -hr * 0.5, hr * 1.32)), hr * 0.5, hr * 0.26, { flat: [v(0, 1, 0), 0.82] });
      K.ell(sk.clone().add(v(0, hr * 0.3, hr * 0.74)), [hr * 0.72, hr * 0.2, hr * 0.3], { k: 0.02, rot: [0.3, 0, 0] });
      for (const sd of [1, -1]) {
        K.ell(sk.clone().add(v(sd * hr * 0.62, -hr * 0.22, hr * 0.42)), [hr * 0.2, hr * 0.26, hr * 0.42], { k: 0.025 });
        K.ell(sk.clone().add(v(sd * hr * 0.4, hr * 0.02, hr * 0.86)), [hr * 0.33, hr * 0.22, hr * 0.32], { sub: true, k: 0.012, rot: [0, 0, sd * 0.5] });
        K.ell(sk.clone().add(v(sd * hr * 0.1, -hr * 0.38, hr * 1.5)), [hr * 0.06, hr * 0.1, hr * 0.12], { sub: true, k: 0.01, rot: [0, 0, -sd * 0.3] });
      }
      K.groove([sk.clone().add(v(hr * 0.2, hr * 0.9, hr * 0.3)), sk.clone().add(v(hr * 0.08, hr * 0.6, hr * 0.8)), sk.clone().add(v(hr * 0.22, hr * 0.35, hr * 1.0))], 0.007, 0.003);
      K.bind(['jaw'], 0.02).cone(sk.clone().add(v(0, -hr * 0.78, hr * 0.3)), sk.clone().add(v(0, -hr * 0.86, hr * 1.2)), hr * 0.36, hr * 0.2, { flat: [v(0, 1, 0), 0.5] });
      // bone plates grown over the husk: shoulder caps, forearm blades, kneecaps
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R', sh = j('arm' + n), el = j('fore' + n), wr = j('hand' + n), kn = j('shin' + n);
        K.bind([['arm' + n, 1], ['chest', 1.8]], 0.02).ell(sh.clone().add(v(sd * 0.034, 0.04, -0.004)), [0.075, 0.034, 0.068], { rot: [0, 0, -sd * 0.55] });
        K.bind(['fore' + n], 0.015).cone(el.clone().lerp(wr, 0.12).add(v(sd * 0.026, 0, -0.012)), el.clone().lerp(wr, 0.72).add(v(sd * 0.04, 0, -0.004)), 0.02, 0.03, { flat: [v(1, 0, 0), 0.5] });
        K.bind(['shin' + n], 0.015).ell(kn.clone().add(v(0, 0.004, 0.046)), [0.036, 0.052, 0.024]);
      }
      K.mesh('bone', { cell: 0.0118, ol: 0.45 });
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R';
        // ember eyes deep in the sockets
        blob(S, 'glow', ['head'], { c: sk.clone().add(v(sd * hr * 0.39, hr * 0.01, hr * 0.68)), r: [hr * 0.2, hr * 0.12, hr * 0.1], ws: 10, hs: 8, ol: 0, fn: (d, p) => { p.y += p.x * sd * 0.45; } });
        // swept horns (the right one snapped short)
        const h0 = K.on(sk.clone().add(v(sd * hr * 0.55, hr * 0.7, -hr * 0.1)), -0.006);
        spike(S, 'horn', ['head'], h0, v(sd * 0.75, 0.75, -0.35), sd > 0 ? hr * 2.5 : hr * 1.15, hr * 0.24, { bend: v(-sd * 0.25, 0.25, -0.75), ridge: 0.07, rings: sd > 0 ? 44 : 20, seg: 10, steps: sd > 0 ? 18 : 8, taper: sd > 0 ? 0.8 : 0.3 });
        // teeth along the snout and jaw
        for (let k = 0; k < 4; k++) {
          const t = k / 3, up = K.on(sk.clone().add(v(sd * hr * (0.44 - t * 0.26), -hr * 0.6, hr * (0.72 + t * 0.55))), -0.003);
          spike(S, 'bone', ['head'], up, v(sd * 0.1, -1, 0.1), hr * (k === 1 ? 0.3 : 0.16), hr * 0.055, { seg: 5, steps: 3, ol: 0.4 });
          if (k < 3) { const lo = K.on(sk.clone().add(v(sd * hr * (0.34 - t * 0.2), -hr * 0.7, hr * (0.8 + t * 0.45))), -0.003); spike(S, 'bone', ['jaw'], lo, v(sd * 0.1, 1, 0.1), hr * 0.14, hr * 0.05, { seg: 5, steps: 3, ol: 0.4 }); }
        }
        // hooked claws: three fingers and a thumb
        const wr = j('hand' + n), hl = L.hand, fw = ['hand' + n, 'fing' + n, 'fingB' + n];
        for (let k = 0; k < 3; k++) {
          const z = 0.036 - k * 0.034, base = wr.clone().add(v(sd * 0.004, -hl * 0.42, z));
          tube(S, 'soot', fw, { pts: [base.clone().add(v(0, hl * 0.12, 0)), base, base.clone().add(v(-sd * 0.012, -hl * 0.3, z * 0.25 + 0.012)), base.clone().add(v(-sd * 0.05, -hl * 0.56, z * 0.4 + 0.03)), base.clone().add(v(-sd * 0.1, -hl * 0.68, z * 0.4 + 0.04))], seg: 8, steps: 12, capN: 2, cap1: 1, r: (u) => 0.0185 * Math.pow(1 - u, 0.7) * (1 + 0.1 * Math.sin(u * 16)) + 0.001 });
        }
        const tb = wr.clone().add(v(-sd * 0.02, -hl * 0.14, 0.045));
        tube(S, 'soot', ['hand' + n, 'thumb' + n], { pts: [tb.clone().add(v(sd * 0.012, 0.02, -0.02)), tb, tb.clone().add(v(-sd * 0.02, -hl * 0.2, 0.03)), tb.clone().add(v(-sd * 0.05, -hl * 0.36, 0.04))], seg: 7, steps: 8, capN: 2, cap1: 1, r: (u) => 0.016 * Math.pow(1 - u, 0.7) + 0.001 });
        // elbow spur, toe talons, heel spur
        const el = j('fore' + n), toe = j('toe' + n), an = j('foot' + n);
        spike(S, 'soot', ['fore' + n], el.clone().add(v(0, 0.01, -0.035)), v(sd * 0.15, 0.55, -1), 0.11, 0.02, { bend: v(0, 0.5, 0.2), seg: 7 });
        for (let k = -1; k <= 1; k++) spike(S, 'soot', ['toe' + n], v(toe.x + k * 0.03, 0.036, toe.z + 0.02 - Math.abs(k) * 0.012), v(k * 0.25, 0.12, 1), 0.085, 0.017, { bend: v(0, -0.5, 0), seg: 7 });
        spike(S, 'soot', ['foot' + n], v(an.x, 0.05, an.z - 0.06), v(0, 0.3, -1), 0.055, 0.014, { bend: v(0, -0.4, 0), seg: 6 });
        // shoulder shroud scraps and waist tatters
        const sh = j('arm' + n);
        tatter(S, 'cloth', [['arm' + n, 1], ['chest', 1.3]], sh.clone().add(v(sd * 0.075, 0.035, 0.045)), sh.clone().add(v(sd * 0.06, 0.04, -0.07)), 0.2, { out: v(sd, 0, 0), seed: sd + 2, flare: 0.02, inner: 'clothIn', rags: 2 });
        if (frost) for (let k = 0; k < 3; k++) { const b0 = F.on(sh.clone().add(v(sd * 0.03, 0.06, -0.03 + k * 0.035)), -0.01); shard(S, 'ice', ['arm' + n, ['chest', 1.6]], b0, b0.clone().add(v(sd * (0.05 + k * 0.03), 0.16 - k * 0.04, -0.05 + k * 0.03)), 0.022, { sides: 5 }); }
      }
      // dorsal spines down the hunched back
      for (let k = 0; k < 6; k++) {
        const t = k / 5, p0 = F.on(v(0, mix(L.SY + 0.03, L.H + 0.06, t), -0.2), -0.008);
        spike(S, frost ? 'ice' : 'soot', [t < 0.6 ? 'chest' : 'spine'], p0, v(0, 0.5 - t * 0.3, -1), 0.17 - Math.abs(t - 0.25) * 0.12, 0.024, { bend: v(0, -0.4, -0.1), seg: 6, flat: 0.55, ref: v(1, 0, 0) });
      }
      // ragged collar and loincloth strips
      sheet(S, 'cloth', ['chest', ['neck', 1.4], ['armL', 1.6], ['armR', 1.6]], {
        nu: 28, nv: 5, wrap: true, thick: 0.01, innerMat: 'clothIn',
        fn: (u, vv, q) => { const a = u * TAU, tri = Math.abs(((u * 9) % 1) - 0.5) * 2; const r = mix(0.06, 0.15, Math.pow(vv, 0.7)) * (1 + 0.05 * Math.sin(a * 5)); q.set(Math.sin(a) * r * 1.25, L.SY + 0.085 - vv * (0.1 + 0.07 * tri) - 0.02 * Math.cos(a), Math.cos(a) * r * 0.95 - 0.025); },
        inside: (p) => v(0, p.y + 0.04, -0.02),
      });
      const wy = L.H + 0.04;
      tatter(S, 'cloth', [['hips', 0.8], ['thighL', 1.3], ['thighR', 1.3]], v(-0.085, wy, 0.085), v(0.085, wy, 0.085), 0.34, { out: v(0, 0, 1), seed: 3, inner: 'clothIn', flare: 0.05 });
      tatter(S, 'cloth', [['hips', 0.8], ['thighL', 1.3], ['thighR', 1.3]], v(0.09, wy, -0.08), v(-0.09, wy, -0.08), 0.42, { out: v(0, 0, -1), seed: 5, inner: 'clothIn', flare: 0.06, rags: 4 });
      const belt = []; for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; belt.push(v(Math.sin(a) * 0.105, wy + 0.012 * Math.sin(a * 2), Math.cos(a) * 0.085)); }
      tube(S, 'soot', ['hips'], { pts: belt, closed: true, seg: 6, steps: 28, r: [0.012, 0.018], ref: v(0, 1, 0) });
      const tone = new THREE.Color(soot);
      return {
        fields: [F, K], aoR: 0.045, ao: 0.55,
        fn: (key, p, n, c) => {
          if (key === 'ash') { c.lerp(tone, 0.75 * sstep(0.5, 0.05, p.y) * (Math.abs(p.x) > 0.12 ? 1 : 0.6) + 0.5 * sstep(0.0, 0.25, Math.abs(p.x) - 0.17) * sstep(0.75, 0.35, p.y)); c.multiplyScalar(0.86 + 0.26 * Math.max(0, n.y) + 0.12 * (vnoise3(p.x * 9, p.y * 9, p.z * 9) - 0.5)); }
          if (key === 'bone') c.multiplyScalar(0.8 + 0.22 * Math.max(0, n.y) - 0.3 * sstep(HC.y + hr * 0.2, HC.y + hr, p.y) * sstep(0.02, -0.08, p.z));
          if (key === 'cloth') c.multiplyScalar(0.8 + 0.5 * sstep(L.H - 0.3, L.SY, p.y));
        },
      };
    },
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

// frozen parts: pale, glossy, faintly lit from within
const iceMat = () => sheen(bodyMat(0xffffff, { vertexColors: true, rim: 1.3, emissive: 0x1c4466 }), { color: 0xdff6ff, size: 0.1, k: 0.9, fres: 0.5 });
// body material of an authored model: its colour comes from the baked albedo
const skinMat = (rim = 0.45) => bodyMat(0xffffff, { vertexColors: true, rim });

export function makeAshling(variant = 'normal') {
  const frost = variant === 'frost';
  const T = enemyType(ASH[frost ? 'frost' : 'normal']);
  const glow = glowBasic(frost ? 0x8fe3ff : 0xc9a0ff, 2.6);
  const M = { main: skinMat(), glow };
  if (frost) M.ice = iceMat();
  const rig = new HumanRig(T, { mats: M, castPose: false, outline: 0.0045, rim: 0.7, style: { armHang: 0.14, lift: 1.2 }, pose: (q, s, R, dt) => { twitch(q, s, R); clawPose(q, s, R, dt); } });
  dress(rig, { variant: frost ? 'frost' : null, mat: { main: { spec: 0.5 }, ice: { spec: 1.6 } } });
  rig.eyeMat = glow;
  rig.height = 1.5;
  return rig;
}

// ===========================================================================
// 돌무덤 — cairn brute: a walking burial mound of stacked slabs. Fissures glow
// between the stones, boulder fists hang to its knees, and a mantle of loose
// grave stones rides its back and shoulders (rig.armor, shed when the armor
// breaks; the rune tablet on its chest stays). Frost variant: ice spires.
function bruteCfg(frost) {
  const stoneC = frost ? 0x7e92ae : 0x847c90;
  return {
    key: frost ? 'bruteFrost' : 'brute', model: { file: 'brute', skip: frost ? [] : ['ice'] }, scale: 2.0, legLen: 0.52, torsoLen: 1.22, headR: 0.105, neckLen: 0.15, bodyW: 1.6, shoulderW: 1.7, armLen: 1.22, hunch: 0.3, stride: 1.2, frost,
    colors: { stone: stoneC, stoneL: frost ? 0x9db0c8 : 0xa39bab, stoneD: frost ? 0x5f7390 : 0x676074, glow: 0xffffff, glowD: 0xa0a0a0, ice: 0xcdeeff, moss: frost ? 0xe6f2fa : 0x55633f },
    build(S, L, j) {
      const hy = L.HC.y, A = new Field(S);
      const st = (w, c, h, o = {}) => megalith(S, A, o.mat || 'stone', w, c, h, o);
      const sm = { ws: 12, hs: 9 };
      const core = (w, c, r) => blob(S, 'glowD', w, { c, r, ws: 14, hs: 10, ol: 0 });
      // the glowing heart of the cairn, seen in the gaps between its stones
      core(['chest', 'spine'], v(0, L.SY - 0.17, 0), [0.21, 0.3, 0.135]);
      core(['hips'], v(0, L.H + 0.04, 0), [0.16, 0.1, 0.11]);
      core(['head'], v(0, hy - 0.035, 0.085), [0.095, 0.06, 0.105]);
      // trunk: pelvis block and hip stones, belly stone, paired chest and back slabs, hump
      st(['hips'], v(0, L.H, 0), [0.2, 0.1, 0.155], { rot: [0.05, 0, 0], cuts: [[1, -1, 0.3, 1.02], [-1, -1, -0.2, 1.0]] });
      st(['spine'], v(0, L.H + 0.2, 0.03), [0.165, 0.085, 0.135], { rot: [0, 0.16, 0.04], n: 4, mat: 'stoneL' });
      st(['chest'], v(0, L.SY + 0.085, -0.12), [0.21, 0.085, 0.135], { rot: [-0.3, 0, 0], n: 4, mat: 'stoneD' });
      // skull block, brow slab, underbite jaw with tusks
      st([['head', 1], ['neck', 1.5]], v(0, hy - 0.035, 0.06), [0.118, 0.098, 0.125], { mat: 'stoneD' });
      st(['head'], v(0, hy + 0.05, 0.15), [0.148, 0.042, 0.088], { rot: [0.32, 0, 0.03], cuts: [[0.5, 1, 1, 1.12]], mat: 'stoneL' });
      st(['jaw'], v(0, hy - 0.128, 0.125), [0.12, 0.048, 0.098], { rot: [-0.08, 0, 0], cuts: [[0, -1, 1, 1.05]] });
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R';
        const sh = j('arm' + n), el = j('fore' + n), wr = j('hand' + n), th = j('thigh' + n), kn = j('shin' + n), an = j('foot' + n);
        st(['hips'], v(sd * 0.195, L.H + 0.075, -0.02), [0.085, 0.1, 0.125], { rot: [0, 0, -sd * 0.35], mat: 'stoneD' });
        st(['chest'], v(sd * 0.175, L.SY - 0.125, 0.085), [0.158, 0.172, 0.125], { rot: [-0.14, -sd * 0.14, sd * 0.07], cuts: [[sd, -1, 0.3, 1.08], [-sd, 1, 0.5, 1.2]] });
        st(['chest'], v(sd * 0.168, L.SY - 0.11, -0.115), [0.17, 0.2, 0.1], { rot: [0.1, sd * 0.12, -sd * 0.05], cuts: [[sd, -1, -0.4, 1.1]] });
        st(['chest'], v(sd * 0.2, L.SY + 0.08, 0.035), [0.125, 0.062, 0.11], { rot: [0.1, 0, -sd * 0.26], n: 4, mat: 'stoneL' });
        st(['jaw'], v(sd * 0.092, hy - 0.058, 0.208), [0.026, 0.055, 0.026], { taper: -0.55, n: 3, rot: [0.15, 0, -sd * 0.12], mat: 'stoneL', ...sm });
        st(['head'], v(sd * 0.112, hy - 0.05, 0.14), [0.03, 0.055, 0.06], { mat: 'stoneD', ...sm });
        blob(S, 'glow', ['head'], { c: v(sd * 0.058, hy - 0.022, 0.186), r: [0.036, 0.015, 0.014], ws: 12, hs: 6, ol: 0, fn: (d, p) => { p.y -= p.x * sd * 0.22; } });
        // boulder shoulder, upper arm, club forearm, fist with knuckle stones: joints of light between
        st([['arm' + n, 1], ['chest', 2]], sh.clone().add(v(sd * 0.05, 0.045, 0)), [0.172, 0.148, 0.172], { n: 3.2, rot: [0, 0, sd * 0.3], cuts: [[sd, 1, 0.4, 1.12]] });
        core(['arm' + n], sh.clone().add(v(sd * 0.025, -0.11, 0)), [0.075, 0.07, 0.075]);
        st(['arm' + n], sh.clone().lerp(el, 0.63).add(v(sd * 0.012, 0, 0)), [0.1, 0.105, 0.105], { rot: [0, sd * 0.3, 0], n: 4, mat: 'stoneD' });
        core(['fore' + n], el, [0.07, 0.06, 0.07]);
        st(['fore' + n], el.clone().lerp(wr, 0.52).add(v(sd * 0.012, 0, 0)), [0.118, 0.125, 0.125], { taper: -0.24, rot: [0, sd * 0.2, 0], cuts: [[sd, 1, 0.3, 1.15]] });
        core(['hand' + n], wr.clone().add(v(sd * 0.006, 0.005, 0.005)), [0.075, 0.05, 0.075]);
        st(['hand' + n], wr.clone().add(v(sd * 0.012, -0.125, 0.012)), [0.14, 0.115, 0.152], { rot: [0.1, 0, sd * 0.1], cuts: [[sd, -1, 0.2, 1.1]], mat: 'stoneD' });
        for (let k = -1; k <= 1; k++) st(['hand' + n], wr.clone().add(v(sd * 0.03, -0.232, 0.015 + k * 0.096)), [0.05, 0.042, 0.045], { n: 3, mat: 'stoneL', ...sm });
        st(['hand' + n], wr.clone().add(v(-sd * 0.105, -0.13, 0.115)), [0.05, 0.07, 0.055], { rot: [0.4, 0, 0], n: 3, mat: 'stoneL', ...sm });
        // pillar legs, kneecaps, slab feet with three toe stones
        core(['thigh' + n], th.clone().add(v(sd * 0.01, 0.01, 0)), [0.085, 0.08, 0.085]);
        st(['thigh' + n], th.clone().lerp(kn, 0.52).add(v(sd * 0.022, 0, 0)), [0.115, 0.105, 0.12], { rot: [0, sd * 0.15, 0], n: 4 });
        core(['shin' + n], kn.clone().add(v(sd * 0.012, 0, 0)), [0.07, 0.06, 0.07]);
        st(['shin' + n], kn.clone().add(v(sd * 0.012, 0.0, 0.1)), [0.068, 0.07, 0.04], { rot: [0.2, 0, 0], n: 4, mat: 'stoneL', ...sm });
        st(['shin' + n], v(an.x + sd * 0.012, 0.2, 0.004), [0.108, 0.092, 0.115], { taper: -0.2, mat: 'stoneD' });
        st(['foot' + n], v(an.x + sd * 0.012, 0.058, 0.035), [0.12, 0.058, 0.16], { cuts: [[0, 1, 1, 1.05]] });
        for (let k = -1; k <= 1; k++) st(['toe' + n], v(an.x + sd * 0.012 + k * 0.08, 0.042, 0.212 - Math.abs(k) * 0.02), [0.043, 0.04, 0.056], { n: 3, mat: 'stoneL', ...sm });
        // ash-moss (or rime) cap on the shoulder
        blob(S, 'moss', ['arm' + n, ['chest', 2]], { c: sh.clone().add(v(sd * 0.03, 0.185, -0.01)), r: [0.12, 0.035, 0.11], ws: 16, hs: 8, ol: 0.5, fn: (d, p) => { p.multiplyScalar(0.84 + 0.34 * vnoise3(d.x * 3 + sd * 4, d.y * 3, d.z * 3)); if (d.y < 0) p.y *= 0.3; } });
      }
      if (frost) for (let k = 0; k < 7; k++) {
        const x = (k - 3) * 0.085, h = 0.3 + (3 - Math.abs(k - 3)) * 0.085 + (k % 2) * 0.05;
        const b0 = v(x, L.SY + 0.06, -0.19 - (k % 2) * 0.03);
        shard(S, 'ice', ['chest'], b0, b0.clone().add(v(x * 0.5, h * 0.85, -h * 0.5)), 0.05 + (k % 2) * 0.012, { sides: 6, waist: 0.35, twist: k });
      }
      return { fields: [A], aoR: 0.05, ao: 0.6, fn: (key, p, n, c) => { if (key.startsWith('stone')) c.multiplyScalar(0.84 + 0.3 * Math.max(0, n.y) - 0.14 * sstep(0.35, 0, p.y)); } };
    },
  };
}
const BRUTE = { normal: bruteCfg(false), frost: bruteCfg(true), warden: { ...bruteCfg(true), key: 'warden', model: { file: 'warden' } } };


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

// loose grave stones (rigid, shared): standing stone, stacked cairn, bracer slab, rune tablet
const STONES = {};
function stoneGeo(kind) {
  return STONES[kind] || (STONES[kind] = rigidType((S) => {
    const F = new Field(S); F.bind('r', 0.01);
    F.disp = stoneNoise(12, 0.006); F.dispAmp = 0.005;
    if (kind === 'menhir') {
      F.box(v(0, 0.2, 0), [0.085, 0.22, 0.05], 0.028, { rot: [0, 0, 0.05] }).box(v(0.02, 0.415, 0), [0.065, 0.055, 0.045], 0.026, { rot: [0, 0, 0.55] });
      F.groove([v(-0.035, 0.33, 0.07), v(0.005, 0.22, 0.07), v(-0.025, 0.1, 0.07)], 0.011, 0.004).groove([v(0.03, 0.3, 0.07), v(0.04, 0.24, 0.07)], 0.011, 0.004);
    } else if (kind === 'cairn') {
      F.ell(v(0, 0.035, 0), [0.135, 0.046, 0.115]).ell(v(0.015, 0.108, 0.005), [0.098, 0.04, 0.088], { rot: [0.1, 0.6, 0.08] }).ell(v(-0.012, 0.172, 0), [0.064, 0.034, 0.058], { rot: [-0.1, 0, -0.12] }).ell(v(0.004, 0.226, 0.002), [0.036, 0.027, 0.036]);
    } else if (kind === 'slab') {
      F.box(v(0, 0, 0), [0.08, 0.125, 0.032], 0.022, { rot: [0, 0, 0.06] }).box(v(0, 0.025, 0.026), [0.052, 0.075, 0.022], 0.016).groove([v(-0.04, -0.09, 0.05), v(0.04, -0.09, 0.05)], 0.01, 0.004);
    } else {
      F.box(v(0, -0.03, 0), [0.105, 0.1, 0.032], 0.02).ell(v(0, 0.06, 0), [0.105, 0.075, 0.032], { k: 0.02 }).box(v(0, 0.0, 0.034), [0.07, 0.1, 0.014], 0.01, { sub: true, k: 0.004 });
    }
    F.mesh('stone', { cell: 0.0105 });
    return { fields: [F], aoR: 0.035, ao: 0.7, fn: (k, p, n, c) => c.multiplyScalar(0.8 + 0.32 * Math.max(0, n.y) + 0.1 * (vnoise3(p.x * 14, p.y * 14, p.z * 14) - 0.5)) };
  }, { stone: 0xffffff }));
}

export function makeBrute(variant = 'normal') {
  const warden = variant === 'warden' && !!model('mn_warden');
  const frost = variant === 'frost' || variant === 'warden';
  const T = enemyType(BRUTE[warden ? 'warden' : frost ? 'frost' : 'normal']);
  const glow = glowBasic(frost ? 0x8fe3ff : 0xc080ff, 2.6);
  const M = { main: skinMat(0.5), glow };
  if (frost) M.ice = warden ? skinMat(0.35) : iceMat();
  const rig = new HumanRig(T, { mats: M, castPose: false, outline: 0.006, rim: 0.55, style: { armHang: 0.25, lift: 0.7, sway: 1.6 }, pose: (q, s, R) => {
    q.armLx -= 0.15; q.armRx -= 0.15; q.foreLx -= 0.25; q.foreRx -= 0.25;
    if (warden) { q.spinex += 0.14; q.chestx += 0.18; q.headx -= 0.16; }
    slamPose(q, s, R);
  } });
  dress(rig, { variant: frost && !warden ? 'frost' : null, mat: { main: { spec: 0.45 }, ice: { spec: warden ? 0.65 : 1.6 } } });
  if (warden) {
    rig.wardenShell = new WardenShell(rig, rigids(rig, M));
    rig.glowMat = glow; rig.eyeMat = glow; rig.height = 2.9;
    return rig;
  }
  const B = rig.B, L = rig.L;
  const P = (b, x, y, z) => local(rig, b, v(x, y, z));
  // armor stones: [back menhir, back L, back R (kept), shoulder cairn L, R, chest tablet (kept), bracer L, R]
  const loose = rigids(rig, M);
  if (loose.armor0) { rig.armor = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => loose['armor' + i]); rig.glowMat = glow; rig.eyeMat = glow; rig.height = 2.9; return rig; }
  // code-built stones (no authored model)
  const rock = bodyMat(frost ? 0xb9d2e6 : 0x8d8378, { vertexColors: true, rim: 0.5, emissive: frost ? 0x14304a : 0x000000 });
  rig.mats.push(rock);
  const armor = [];
  const add = (bone, kind, x, y, z, s, r) => { const m = rigid(B[bone], stoneGeo(kind), rock, P(bone, x, y, z), s, r); armor.push(m); return m; };
  add('chest', 'menhir', 0.02, L.SY - 0.02, -0.2, 1.15, [-0.5, 0.1, 0.06]);
  add('chest', 'menhir', 0.2, L.SY - 0.1, -0.17, 0.8, [-0.62, -0.5, -0.3]);
  add('spine', 'menhir', -0.19, L.SY - 0.16, -0.16, 0.72, [-0.7, 0.5, 0.35]);
  for (const sd of [1, -1]) { const sp = T.def.pos('arm' + (sd > 0 ? 'L' : 'R')); add('arm' + (sd > 0 ? 'L' : 'R'), 'cairn', sp.x + sd * 0.05, sp.y + 0.13, sp.z - 0.01, sd > 0 ? 1.0 : 0.85, [0, sd * 0.8, -sd * 0.22]); }
  const tab = add('chest', 'tablet', 0, L.SY - 0.16, 0.232, 1.0, [-0.14, 0, 0]);
  for (const sd of [1, -1]) { const n = sd > 0 ? 'L' : 'R', e = T.def.pos('fore' + n), w = T.def.pos('hand' + n), m = e.clone().lerp(w, 0.5); add('fore' + n, 'slab', m.x + sd * 0.135, m.y, m.z, 1.0, [0, sd * Math.PI / 2, 0]); }
  // glowing grave rune on the tablet
  const g2 = glowTwin(glow);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.007, 6, 28), g2); ring.position.set(0, 0.03, 0.024); tab.add(ring);
  for (const [x, y, h, a] of [[0, 0.03, 0.11, 0], [0, -0.055, 0.07, Math.PI / 2], [-0.03, -0.02, 0.05, 0.7], [0.03, -0.02, 0.05, -0.7]]) { const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.0065, h, 3, 8), g2); bar.position.set(x, y, 0.024); bar.rotation.z = a; tab.add(bar); }
  rig.armor = armor;
  rig.glowMat = glow; rig.eyeMat = glow;
  rig.height = 2.9;
  return rig;
}


// ---------------------------------------------------------------------------
// Armor kit (knight, shield bearer, archer): a seamless under-body, thick plates
// with rolled trims, limb cuffs, domed lames, gauntlets, capes.
// seamless under-body (padding, mail, husk) on the humanoid joints; g = girth
function husk(S, L, j, g = 1) {
  const F = new Field(S), bw = 0.6 + 0.4 * L.bw;
  F.bind(['hips'], 0.04).ell(j('hips').clone().add(v(0, -0.01, 0)), [0.15 * bw * g, 0.1, 0.105 * g]);
  F.bind(['spine', 'hips', 'chest'], 0.05).cone(j('hips'), j('chest'), 0.1 * bw * g, 0.11 * bw * g, { flat: [v(1, 0, 0), 1.3] });
  F.bind(['chest', ['spine', 1.6]], 0.05).ell(v(0, L.SY - 0.1, 0), [0.17 * bw * g, 0.15, 0.115 * g]);
  F.bind(['chest', 'neck', ['head', 1.4]], 0.03).cone(v(0, L.SY, -0.01), L.HC.clone().add(v(0, -L.hr * 0.5, 0)), 0.055 * g, 0.045 * g);
  for (const sd of [1, -1]) {
    const n = sd > 0 ? 'L' : 'R', sh = j('arm' + n), el = j('fore' + n), wr = j('hand' + n), th = j('thigh' + n), kn = j('shin' + n), an = j('foot' + n);
    F.bind([['clav' + n, 1.2], 'arm' + n, ['chest', 1.8]], 0.04).ell(sh, [0.06 * g, 0.058 * g, 0.06 * g]);
    F.bind(['arm' + n, 'fore' + n], 0.03).cone(sh, el, 0.05 * g, 0.042 * g);
    F.bind(['fore' + n, ['hand' + n, 1.4]], 0.025).cone(el, wr, 0.043 * g, 0.034 * g);
    F.bind([['hips', 1.25], 'thigh' + n], 0.045).cone(th.clone().add(v(0, 0.02, 0)), kn, 0.085 * g * bw, 0.058 * g);
    F.bind(['shin' + n, ['foot' + n, 1.3]], 0.03).cone(kn, an, 0.057 * g, 0.04 * g);
  }
  return F;
}
// thick plate from a surface fn(u, v, out). o.trim: { mat, r, hem, top, sides } rolled edges
function plate(S, mat, w, fn, o = {}) {
  const nu = o.nu ?? 10, nv = o.nv ?? 6, wrap = !!o.wrap;
  sheet(S, mat, w, { nu, nv, wrap, thick: o.thick ?? 0.014, top: true, fn, inside: o.inside, innerMat: o.inner, ol: o.ol });
  const t = o.trim;
  if (!t) return;
  const P = new V3();
  const line = (f, n, closed) => { const pts = []; for (let k = 0; k < (closed ? n : n + 1); k++) { f(k / n, P); pts.push(P.clone()); } tube(S, t.mat ?? 'trim', w, { pts, closed, seg: 5, steps: closed ? n : Math.max(6, n), r: t.r ?? 0.008, ol: 0.5, cap0: !closed, cap1: !closed, capN: 2 }); };
  if (t.hem !== false) line((u, q) => fn(u, 1, q), nu, wrap);
  if (t.top) line((u, q) => fn(u, 0, q), nu, wrap);
  if (t.sides && !wrap) { line((vv, q) => fn(0, vv, q), nv, false); line((vv, q) => fn(1, vv, q), nv, false); }
}
// plate wrapped around a limb segment a -> b. r(v, ang) radius; o.cover: fraction of the
// circumference, centred on o.face
function cuff(S, mat, w, a, b, r, o = {}) {
  const ax = b.clone().sub(a), len = ax.length(); ax.normalize();
  const f = (o.face || v(0, 0, 1)).clone(); f.addScaledVector(ax, -f.dot(ax)).normalize();
  const sv = new V3().crossVectors(ax, f), cov = o.cover ?? 1, wrap = cov >= 1;
  plate(S, mat, w, (u, vv, q) => { const ang = wrap ? u * TAU : (u - 0.5) * TAU * cov, rr = r(vv, ang); q.copy(a).addScaledVector(ax, len * vv).addScaledVector(f, Math.cos(ang) * rr).addScaledVector(sv, Math.sin(ang) * rr); },
    { nu: o.nu ?? (wrap ? 14 : 10), nv: o.nv ?? 4, wrap, thick: o.thick, trim: o.trim, inner: o.inner, inside: (p) => a.clone().addScaledVector(ax, p.clone().sub(a).dot(ax)) });
}
// cap of an ellipsoid (lames, knee cops, helm bowls): polar axis = local +Y turned by o.rot,
// polar angle th0..th1, azimuth ±o.ph (full turn when omitted); o.fn(q, u, v) reshapes
function dome(S, mat, w, c, r, o = {}) {
  const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.rot || [0, 0, 0])));
  const fn = (u, vv, q) => { const ph = o.ph !== undefined ? (u - 0.5) * 2 * o.ph : u * TAU, th = mix(o.th0 ?? 0.04, o.th1 ?? 1.4, vv); q.set(Math.sin(th) * Math.sin(ph) * r[0], Math.cos(th) * r[1], Math.sin(th) * Math.cos(ph) * r[2]); if (o.fn) o.fn(q, u, vv); q.applyQuaternion(q0).add(c); };
  plate(S, mat, w, fn,
    { nu: o.nu ?? 14, nv: o.nv ?? 6, wrap: o.ph === undefined, thick: o.thick ?? 0.014, trim: o.trim, inner: o.inner, inside: () => c });
  return fn;
}
// point of a plate surface nearest to (x, y) on its +Z side, lifted outwards from c
function seat(fn, x, y, c, lift = 0) {
  const q = new V3(), best = new V3(); let bd = 1e9, bu = 0, bv = 0;
  const scan = (u0, u1, v0, v1, n) => { for (let i = 0; i <= n; i++) for (let k = 0; k <= n; k++) { const u = mix(u0, u1, i / n), vv = mix(v0, v1, k / n); fn(((u % 1) + 1) % 1, Math.min(1, Math.max(0, vv)), q); if (q.z < c.z) continue; const d = (q.x - x) ** 2 + (q.y - y) ** 2; if (d < bd) { bd = d; best.copy(q); bu = u; bv = vv; } } };
  scan(0, 1, 0, 1, 36); scan(bu - 0.03, bu + 0.03, bv - 0.03, bv + 0.03, 12);
  return best.add(q.copy(best).sub(c).normalize().multiplyScalar(lift));
}
// articulated plate gauntlet (same joints as the humanoid hand, so grips line up)
function gauntlet(S, L, j, sd, mat, g = 1.25) {
  const n = sd > 0 ? 'L' : 'R', wr = j('hand' + n), hl = L.hand;
  blob(S, mat, ['fore' + n, 'hand' + n, ['fing' + n, 1.3], ['thumb' + n, 1.6]], { c: wr.clone().add(v(sd * 0.004, -hl * 0.3, 0.002)), r: [0.025 * g, hl * 0.34, 0.04 * g], ws: 12, hs: 8, ol: 0.6 });
  const fw = ['hand' + n, 'fing' + n, 'fingB' + n];
  for (let k = 0; k < 4; k++) {
    const z = (0.027 - k * 0.018) * g, len = hl * [0.46, 0.5, 0.48, 0.4][k], base = wr.clone().add(v(sd * 0.004, -hl * 0.52, z)), r0 = 0.0115 * g;
    tube(S, mat, fw, { pts: [base.clone().add(v(0, hl * 0.1, 0)), base, base.clone().add(v(-sd * 0.004, -len * 0.55, z * 0.08)), base.clone().add(v(-sd * 0.01, -len, z * 0.12))], seg: 6, steps: 7, capN: 2, ol: 0.4, r: (u) => r0 * (1 - u * 0.25) * (1 + 0.16 * Math.pow(Math.abs(Math.sin(u * 9.5)), 6)), cap1: 1 });
  }
  const tb = wr.clone().add(v(-sd * 0.012, -hl * 0.14, 0.03 * g));
  tube(S, mat, ['hand' + n, 'thumb' + n], { pts: [tb.clone().add(v(sd * 0.006, 0.02, -0.01)), tb, tb.clone().add(v(-sd * 0.008, -hl * 0.22, 0.02)), tb.clone().add(v(-sd * 0.012, -hl * 0.38, 0.034))], seg: 6, steps: 4, capN: 2, ol: 0.4, r: 0.0135 * g, cap1: 1 });
}
// cape / cloak on three verlet chains hanging from the shoulders
function capeAt(L, a, vv, len, o) {
  const r = mix(o.r0 ?? 0.2, o.r1 ?? 0.3, Math.pow(vv, 0.8)) * (0.6 + 0.4 * L.bw), ang = a * mix(1.05, 1.22, vv) + Math.PI;
  return v(Math.sin(ang) * r * 1.08, L.SY + (o.dy ?? 0.06) - vv * len, Math.cos(ang) * r * mix(0.62, 0.95, vv) - 0.03 - vv * 0.04);
}
function capeChains(def, L, len, o = {}) {
  return [-0.95, 0, 0.95].map((a, ci) => {
    const names = []; let parent = 'chest';
    for (let k = 0; k < 4; k++) { const p = capeAt(L, a, k / 4, len, o), nm = `cape${ci}_${k}`; def.add(nm, parent, p.x, p.y, p.z); names.push(nm); parent = nm; }
    return { names, tail: capeAt(L, a, 1, len, o), kind: 'cape' };
  });
}
function capeCloth(S, L, chains, mat, inner, len, o = {}) {
  sheet(S, mat, ['chest', ...chains.flatMap((ch) => ch.names.map((nm) => [nm, 0.9]))], {
    nu: 16, nv: 10, thick: 0.012, top: true, innerMat: inner,
    fn: (u, vv, q) => {
      const tri = Math.abs(((u * (o.rags ?? 5) + 0.3) % 1) - 0.5) * 2, rag = (o.rag ?? 0.16) * (tri * tri + 0.35 * Math.sin(u * 23));
      q.copy(capeAt(L, mix(-1.2, 1.2, u), vv * (1 - rag * sstep(0.5, 1, vv)), len, o));
      q.z -= 0.014 * Math.sin(u * 19 + vv * 3) * vv;
    },
    inside: (p) => v(0, p.y, 0.05),
  });
}
// ===========================================================================
// 무명의 기사 — the Ashen Knight: Kael's forgotten shadow. Ash-greyed plate with
// tarnished trims over a body that burns from within (light in every joint), a
// horned great helm with glowing eye slits, a torn cape and crest streamer, and
// a greatsword with a burning edge.
function ashen(hex, k = 0.5) { return new THREE.Color(hex).lerp(new THREE.Color(0x3a3444), k).getHex(); }
const METAL = (k) => (k.startsWith('glow') ? 'glow' : k.startsWith('metal') || k === 'trim' ? 'metal' : 'main');
const metalMat = (rim = 0.9) => sheen(bodyMat(0xffffff, { vertexColors: true, rim }), { color: 0xe8ecff, size: 0.09, soft: 0.03, k: 0.42, fres: 0.25 });
function knightCfg(spectral) {
  const col = (x, k) => (spectral ? x : ashen(x, k));
  const c = {
    key: 'knight', scale: 1.4, bodyW: 1.6, shoulderW: 1.2, legLen: 0.90, torsoLen: 1.1, headR: 0.14, armLen: 1.1, spectral, group: METAL,
    colors: { metal: col(0xb4b4c6), metalD: col(0x74748a), trim: col(0xd2b064, 0.28), under: col(0x30303a, 0.3), cape: col(0x2a4a9a, 0.6), lining: col(0x162452, 0.55), cloth: col(0x3558b0, 0.6), glow: 0xffffff, glowD: 0xa0a0a0 },
    bones(def, L) {
      const ch = capeChains(def, L, 1.02, { r1: 0.33 });
      const hr = L.hr, p0 = L.HC.clone().add(v(0, hr * 0.86, -hr * 0.34)), names = []; let parent = 'head';
      for (let k = 0; k < 4; k++) { const p = p0.clone().add(v(0, -k * k * hr * 0.07, -k * hr * 0.55)), nm = 'crest' + k; def.add(nm, parent, p.x, p.y, p.z); names.push(nm); parent = nm; }
      ch.push({ names, tail: p0.clone().add(v(0, -hr * 1.4, -hr * 2.3)), kind: 'plume' });
      return (c._ch = ch);
    },
    build(S, L, j) {
      const HC = L.HC, hr = L.hr, H = L.H, SY = L.SY, ch = c._ch;
      const T = { mat: 'trim', r: 0.0075 }, ax = (p) => v(0, p.y, 0);
      // under-armor husk and the light burning in its joints
      const F = husk(S, L, j, 0.96);
      F.mesh('under', { cell: 0.022 });
      const lit = (w, p, r) => blob(S, 'glowD', w, { c: p, r, ws: 12, hs: 8, ol: 0 });
      lit(['neck', 'chest'], v(0, L.NY + 0.02, 0), [0.066, 0.05, 0.066]);
      lit(['spine'], v(0, H + 0.17, 0), [0.148, 0.045, 0.118]);
      // cuirass: deep breastplate with a medial ridge, pointed at the waist
      const cuir = (u, vv, q) => {
        const a = u * TAU, ca = Math.cos(a), sa = Math.sin(a), af = a > Math.PI ? a - TAU : a, front = Math.exp(-(af * af) / 0.05);
        const yT = SY - 0.03 + 0.075 * ca * ca, yB = H + 0.2 - 0.05 * front, bulge = Math.sin(Math.min(1, vv * 1.5) * Math.PI);
        const rx = mix(0.172, 0.158, vv) + 0.045 * bulge, rz = mix(0.126, 0.128, vv) + 0.036 * bulge * (ca > 0 ? 1 : 0.6);
        const se = 1 / Math.pow(Math.pow(Math.abs(ca), 2.5) + Math.pow(Math.abs(sa), 2.5), 0.4);
        q.set(sa * rx * se, mix(yT, yB, vv), ca * rz * se * (1 + 0.07 * front * bulge) + 0.008);
      };
      plate(S, 'metal', ['chest', ['spine', 1.3]], cuir, { nu: 36, nv: 9, wrap: true, thick: 0.016, inside: ax, trim: { ...T, top: true } });
      const cc = v(0, SY - 0.1, 0);
      // the wound at its heart: a shard of light in a tarnished ring, cracks spreading from it
      const hp = seat(cuir, 0, SY - 0.085, cc, -0.004);
      shard(S, 'glow', ['chest'], hp.clone().add(v(0, -0.05, 0)), hp.clone().add(v(0, 0.06, 0.004)), 0.026, { sides: 4, waist: 0.42, ol: 0, twist: Math.PI / 4 });
      const ringP = []; for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; ringP.push(seat(cuir, Math.sin(a) * 0.05, SY - 0.08 + Math.cos(a) * 0.066, cc, 0.002)); }
      tube(S, 'trim', ['chest'], { pts: ringP, closed: true, seg: 6, steps: 28, r: 0.0075, ol: 0.4 });
      for (const [pts] of [[[[0.03, -0.14], [0.075, -0.19], [0.06, -0.24], [0.11, -0.29]]], [[[-0.035, -0.02], [-0.09, 0.0], [-0.11, 0.03]]], [[[-0.03, -0.15], [-0.07, -0.2], [-0.05, -0.27]]]]) {
        tube(S, 'glowD', ['chest'], { pts: pts.map(([x, y]) => seat(cuir, x, SY + y, cc, 0.0015)), seg: 5, steps: 10, ref: v(0, 0, 1), r: (u) => [0.007 * (1 - u * 0.7) + 0.0015, 0.003], ol: 0, cap1: 1, capN: 2 });
      }
      // gorget, fauld lames, tabard
      cuff(S, 'metalD', ['chest', ['neck', 1.3]], v(0, L.NY - 0.05, 0), v(0, L.NY + 0.085, 0.006), (vv) => mix(0.125, 0.076, Math.pow(vv, 0.6)), { trim: T, nu: 18, nv: 4 });
      for (let k = 0; k < 2; k++) plate(S, k ? 'metalD' : 'metal', [['hips', 1], ['spine', 1.3]], (u, vv, q) => { const a = u * TAU, af = a > Math.PI ? a - TAU : a, rr = 0.172 + k * 0.018 + vv * 0.03; q.set(Math.sin(a) * rr * 1.12, H + 0.205 - k * 0.07 - vv * 0.09 - 0.035 * Math.exp(-(af * af) / 0.08), Math.cos(a) * rr * 0.88 + 0.006); }, { nu: 30, nv: 2, wrap: true, inside: ax, trim: T });
      tatter(S, 'cloth', [['hips', 0.8], ['thighL', 1.3], ['thighR', 1.3]], v(-0.08, H + 0.06, 0.168), v(0.08, H + 0.06, 0.168), 0.52, { out: v(0, 0, 1), inner: 'lining', flare: 0.03, rags: 3, seed: 2, nv: 8 });
      tatter(S, 'cloth', [['hips', 0.8], ['thighL', 1.3], ['thighR', 1.3]], v(0.09, H + 0.06, -0.16), v(-0.09, H + 0.06, -0.16), 0.4, { out: v(0, 0, -1), inner: 'lining', flare: 0.04, rags: 4, seed: 4 });
      for (const sd of [1, -1]) {
        const n = sd > 0 ? 'L' : 'R', sh = j('arm' + n), el = j('fore' + n), wr = j('hand' + n), th = j('thigh' + n), kn = j('shin' + n), an = j('foot' + n), toe = j('toe' + n);
        lit(['fore' + n], el, [0.05, 0.05, 0.05]);
        lit(['shin' + n], kn.clone().add(v(0, 0, -0.012)), [0.062, 0.058, 0.062]);
        // pauldron: three lames and a blade crest
        for (let k = 2; k >= 0; k--) dome(S, k === 1 ? 'metalD' : 'metal', k === 0 ? [['clav' + n, 1], ['chest', 1.2], ['arm' + n, 1.5]] : ['arm' + n, ['clav' + n, 1.3]], sh.clone().add(v(sd * (0.028 + k * 0.02), 0.035 - k * 0.052, 0)), [0.125 + k * 0.01, 0.102 + k * 0.004, 0.138 + k * 0.01], { rot: [0, 0, -sd * (0.7 + k * 0.14)], th1: 1.22, nu: 18, nv: 6, trim: T });
        spike(S, 'trim', [['clav' + n, 1], ['arm' + n, 1.4]], sh.clone().add(v(sd * 0.06, 0.115, 0)), v(sd * 0.75, 1, -0.25), 0.17, 0.034, { bend: v(-sd * 0.4, 0.5, -0.3), flat: 0.32, ref: v(0, 0, 1), seg: 8 });
        // rerebrace, couter with a wing, vambrace, bell cuff, gauntlet
        cuff(S, 'metalD', ['arm' + n], sh.clone().lerp(el, 0.44), sh.clone().lerp(el, 0.9), (vv) => mix(0.065, 0.057, vv), { trim: T });
        dome(S, 'metal', ['fore' + n, ['arm' + n, 1.2]], el.clone().add(v(sd * 0.004, 0, -0.01)), [0.064, 0.072, 0.066], { rot: [-Math.PI / 2, 0, 0], th1: 1.4, nu: 14, nv: 5, trim: T });
        spike(S, 'metal', ['fore' + n], el.clone().add(v(sd * 0.05, 0, -0.03)), v(sd, 0.25, -0.7), 0.1, 0.03, { flat: 0.3, ref: v(0, 1, 0), seg: 8 });
        cuff(S, 'metal', ['fore' + n], el.clone().lerp(wr, 0.15), wr.clone().lerp(el, 0.3), (vv) => mix(0.061, 0.05, vv), { trim: T });
        cuff(S, 'metalD', ['fore' + n, ['hand' + n, 1.6]], wr.clone().lerp(el, 0.36), wr.clone().lerp(el, 0.02), (vv) => mix(0.052, 0.076, vv * vv), { trim: T, nv: 5 });
        gauntlet(S, L, j, sd, 'metalD');
        // tasset, cuisse, poleyn with a fin, greave, sabaton
        plate(S, 'metal', [['thigh' + n, 1], ['hips', 1.1]], (u, vv, q) => { const a = sd * 0.8 + (u - 0.5) * 0.95, rr = 0.196 + vv * 0.02; q.set(Math.sin(a) * rr * 1.1, H + 0.062 - vv * (0.2 + 0.055 * (1 - (2 * u - 1) ** 2)), Math.cos(a) * rr * 0.9 + 0.005); }, { nu: 8, nv: 4, inside: ax, trim: { ...T, sides: true } });
        cuff(S, 'metal', ['thigh' + n], th.clone().lerp(kn, 0.24), kn.clone().lerp(th, 0.1), (vv) => mix(0.106, 0.08, vv), { cover: 0.7, face: v(sd * 0.4, 0, 1), nu: 12, trim: { ...T, sides: true } });
        dome(S, 'metalD', ['shin' + n, ['thigh' + n, 1.25]], kn.clone().add(v(0, 0.004, 0.018)), [0.072, 0.082, 0.064], { rot: [Math.PI / 2, 0, 0], th1: 1.32, nu: 14, nv: 5, trim: T });
        spike(S, 'metal', ['shin' + n], kn.clone().add(v(sd * 0.055, 0.005, 0.02)), v(sd, 0.3, -0.1), 0.08, 0.032, { flat: 0.3, ref: v(0, 0, 1), seg: 8 });
        cuff(S, 'metal', ['shin' + n], kn.clone().lerp(an, 0.15), an.clone().lerp(kn, 0.03), (vv, ang) => (mix(0.071, 0.052, vv) + 0.016 * Math.sin(vv * Math.PI) * Math.max(0, -Math.cos(ang))) * (1 + 0.07 * Math.exp(-(ang * ang) / 0.07)), { trim: { ...T, top: true }, nv: 6 });
        const heel = v(an.x, 0.05, an.z - 0.062), tip = v(toe.x, 0.03, toe.z + 0.105);
        tube(S, 'metalD', [['shin' + n, 1.4], 'foot' + n, 'toe' + n], {
          pts: [heel, v(an.x, 0.062, an.z + 0.02), v((an.x + toe.x) / 2, 0.05, toe.z - 0.02), tip], seg: 14, steps: 14, ref: v(0, 1, 0), cap0: 0.9, cap1: 0.5,
          r: (u) => [0.052 * (u > 0.72 ? mix(1, 0.25, (u - 0.72) / 0.28) : 1), (u < 0.45 ? 0.06 : mix(0.06, 0.03, (u - 0.45) / 0.55)) * (1 + 0.08 * Math.pow(Math.abs(Math.sin(u * 13)), 10))],
          shape: (u, a) => { const s = Math.sin(a); return s < 0 ? mix(1, 0.68, s * s) : 1; },
        });
      }
      // great helm: combed bowl with a neck guard, pointed visor, glowing eye slits, swept horns
      const hc = HC.clone().add(v(0, 0.015, -0.005));
      blob(S, 'metal', ['head'], {
        c: hc, r: [hr * 1.04, hr * 1.1, hr * 1.14], ws: 30, hs: 20,
        fn: (d, p) => {
          p.multiplyScalar(1 + 0.085 * Math.exp(-(d.x * d.x) / 0.012) * sstep(-0.35, 0.3, d.y) * sstep(0.98, 0.5, d.z));
          if (d.y < -0.25) { const k = sstep(-0.25, -0.9, d.y); p.x *= 1 + 0.16 * k; p.z *= 1 + (d.z < 0 ? 0.32 : 0.04) * k; p.y *= 1 - 0.12 * k; }
        },
      });
      const vc = hc.clone().add(v(0, -hr * 0.16, hr * 0.1));
      const vis = dome(S, 'metalD', ['head'], vc, [hr * 0.99, hr * 1.42, hr * 0.98], { rot: [Math.PI / 2, 0, 0], th1: 1.42, nu: 24, nv: 9, trim: T, fn: (q, u, vv) => { const r = Math.exp(-(q.x * q.x) / (hr * hr * 0.05)); q.y *= 1 + 0.2 * r * (1 - vv * 0.7); q.z -= hr * 0.12 * (1 - vv) * (1 - r); } });
      spike(S, 'trim', ['head'], vc.clone().add(v(0, 0, hr * 1.5)), v(0, -0.15, 1), hr * 0.3, hr * 0.09, { seg: 6 });
      for (const sd of [1, -1]) {
        tube(S, 'glow', ['head'], { pts: [[0.16, 0.0], [0.38, 0.07], [0.62, 0.2]].map(([x, y]) => seat(vis, sd * hr * x, HC.y + hr * y, vc, 0.002)), seg: 6, steps: 10, ref: v(0, 0, 1), ol: 0, cap0: 1, cap1: 1, capN: 2, r: (u) => [0.004 + 0.011 * Math.sin(u * Math.PI), 0.004] });
        for (let k = 0; k < 3; k++) blob(S, 'glowD', ['head'], { c: seat(vis, sd * hr * (0.2 + k * 0.14), HC.y - hr * (0.32 + k * 0.05), vc, 0.001), r: [0.005, 0.012, 0.004], ws: 6, hs: 5, ol: 0 });
        spike(S, 'trim', ['head'], hc.clone().add(v(sd * hr * 0.92, hr * 0.3, -hr * 0.1)), v(sd * 0.9, 0.35, -0.35), hr * 2.1, hr * 0.2, { bend: v(-sd * 0.35, 0.85, -0.45), flat: 0.5, ref: v(0, 0, 1), ridge: 0.05, rings: 40, seg: 10, steps: 16 });
      }
      // crest streamer and cape
      const cr = ch[3], cp = [...cr.names.map((nm) => S.skel.pos(nm)), cr.tail];
      tube(S, 'cloth', ['head', ...cr.names], { pts: cp, seg: 8, steps: 18, ref: v(1, 0, 0), cap0: 1, cap1: 0.4, r: (u) => [hr * (0.16 + 0.42 * Math.sin(Math.min(1, u * 1.5) * Math.PI * 0.5)) * (1 - 0.55 * u) * (1 + (u > 0.6 ? 0.25 * Math.sin(u * 45) : 0)), 0.007] });
      blob(S, 'trim', ['head'], { c: cp[0], r: [hr * 0.14, hr * 0.14, hr * 0.2], ws: 10, hs: 8 });
      capeCloth(S, L, ch.slice(0, 3), 'cape', 'lining', 1.02, { r1: 0.33, rag: 0.2, rags: 5 });
      for (const sd of [1, -1]) blob(S, 'trim', ['chest'], { c: seat(cuir, sd * 0.125, SY + 0.0, cc, 0.004), r: [0.024, 0.024, 0.014], ws: 10, hs: 8 });
      return { fields: [F], aoR: 0.05, ao: 0.5, skip: (k) => k.startsWith('glow'), fn: (key, p, n, col2) => { if (key === 'metal' || key === 'metalD') col2.multiplyScalar(0.86 + 0.2 * Math.max(0, n.y)); if (key === 'cape' || key === 'cloth') col2.multiplyScalar(0.72 + 0.4 * sstep(0.2, SY, p.y)); } };
    },
  };
  return c;
}
const KNIGHT = { normal: knightCfg(false), spectral: knightCfg(true) };
let swordGeo = null, swordEdgeGeo = null;
const BLADE = [[0.17, 0.05, 0.017], [0.27, 0.046, 0.017], [0.31, 0.074, 0.016], [0.8, 0.066, 0.013], [1.2, 0.052, 0.01], [1.37, 0.032, 0.007], [1.46, 0.002, 0.002]];
function getSwordGeo() {
  if (swordGeo) return swordGeo;
  swordGeo = rigidType((S) => {
    // blade along +Z from the grip (origin): ricasso, long taper, diamond section, dark fuller
    prism(S, 'blade', 'r', BLADE.map(([z, w, t]) => [v(0, w, z), v(t, 0, z), v(0, -w, z), v(-t, 0, z)]));
    for (const sx of [1, -1]) prism(S, 'fuller', 'r', [[0.33, 0.02, 0.016], [0.7, 0.018, 0.0138], [1.08, 0.004, 0.011]].map(([z, w, t]) => [v(sx * (t * 0.72 + 0.0008), w, z), v(sx * (t + 0.0016), 0, z), v(sx * (t * 0.72 + 0.0008), -w, z), v(sx * t * 0.4, 0, z)]));
    // crossguard with flared, drooping quillons; ring boss; wrapped grip; faceted pommel
    tube(S, 'guard', 'r', { pts: [v(0, -0.24, 0.07), v(0, -0.15, 0.13), v(0, 0, 0.15), v(0, 0.15, 0.13), v(0, 0.24, 0.07)], seg: 10, steps: 18, ref: v(0, 0, 1), r: (u) => { const e = Math.abs(u - 0.5) * 2; return [0.02 + 0.014 * (1 - e) + 0.016 * sstep(0.75, 1, e), 0.022 + 0.01 * (1 - e)]; }, cap0: 1, cap1: 1 });
    blob(S, 'guard', 'r', { c: v(0, 0, 0.15), r: [0.034, 0.05, 0.036], ws: 12, hs: 8 });
    tube(S, 'grip', 'r', { pts: [v(0, 0, -0.2), v(0, 0, 0.13)], seg: 10, steps: 16, ref: v(0, 1, 0), r: 0.0235, shape: (u, a) => 1 + 0.11 * Math.pow(Math.abs(Math.sin(u * 26 + a)), 2) });
    tube(S, 'guard', 'r', { pts: [v(0, 0, -0.205), v(0, 0, -0.19)], seg: 10, steps: 1, ref: v(0, 1, 0), r: 0.03, flat0: true, flat1: true });
    shard(S, 'guard', 'r', v(0, 0, -0.2), v(0, 0, -0.3), 0.04, { sides: 6, waist: 0.4 });
  }, { blade: 0xa2a2b4, fuller: 0x3a3a46, guard: 0x8e7a52, grip: 0x3a2a2e });
  swordEdgeGeo = rigidType((S) => {
    for (const sy of [1, -1]) prism(S, 'e', 'r', BLADE.slice(2).map(([z, w]) => [v(0, sy * (w + 0.007), z), v(0.004, sy * (w - 0.002), z), v(0, sy * (w - 0.008), z), v(-0.004, sy * (w - 0.002), z)]));
  }, { e: 0xffffff });
  swordEdgeGeo.translate(0, 0, -0.76);
  return swordGeo;
}
function knightPose(q, s, R) {
  const a = R.w.cast;
  const t = R.t;
  // guard stance: greatsword low in the right hand, left hand loose
  const idle = 1 - a;
  q.armRx += -0.25 * idle; q.foreRx += -0.55 * idle; q.armRz += -0.1 * idle; q.fingR = 1.3; q.thumbR = 1.1;
  q.armLz += 0.08; q.spinex += 0.06; q.headx -= 0.04;
  const guard = idle * (1 - Math.max(R.w.kneel, R.w.down, R.w.dead));
  q.chesty += 0.27 * guard; q.spiney += 0.10 * guard; q.heady -= 0.22 * guard;
  q.thighLx -= 0.34 * guard; q.thighRx += 0.21 * guard; q.shinLx += 0.26 * guard;
  q.armRx += 0.22 * guard; q.foreRx += 0.37 * guard;
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
const knightPlates = [
  ['pauldron', 0.46, 0.27, -0.07],
  ['flank', 0.38, 0.04, -0.17],
  ['vambrace', 0.53, -0.02, -0.06],
  ['tasset', 0.31, -0.07, -0.13],
];

const forkAxis = v(1, 0, 0);

// Normalize one authored bolt along X. Stretch its length independently of the wire thickness.
function knightFork(template) {
  if (!template.stormFork) {
    const end = v(0.256, 0.075, 0.055);
    const length = end.length();
    template.stormFork = template.built.rigid.rootL.geo.clone()
      .applyQuaternion(_q1.setFromUnitVectors(end.normalize(), forkAxis)).scale(1 / length, 1, 1);
  }
  return template.stormFork;
}

function aimKnightFork(mesh, end, width) {
  const direction = _v2.subVectors(end, mesh.position);
  const length = direction.length();
  mesh.scale.set(length, width, width);
  mesh.quaternion.setFromUnitVectors(forkAxis, direction.multiplyScalar(1 / length));
}

function bindKnightArmour(rig, sword, steel, core, spectral) {
  const held = rig.T.built.rigid;
  if (!held?.crown) return;
  const parts = {};
  for (const [name, part] of Object.entries(held)) {
    if (name === 'sword' || name === 'hilt') continue;
    const blade = name === 'bladeArc';
    if (spectral && (blade || name === 'crown' || name === 'rootL' || name === 'rootR')) continue;
    const mesh = rigid(blade ? sword : rig.B[part.bone], part.geo, steel, blade ? _v1.set(0, 0, 0) : part.pos);
    mesh.name = name;
    parts[name] = mesh;
  }
  if (spectral) return;
  const wire = knightFork(rig.T);
  // Short discharges bridge the five breaks in the coronet.
  for (let i = 0; i < 5; i++) {
    const a = i * TAU / 5 + 0.46, b = (i + 1) * TAU / 5 - 0.46;
    const start = v(0.185 * Math.sin(a), 0.006 * Math.cos(2 * a), 0.155 * Math.cos(a));
    const end = v(0.185 * Math.sin(b), 0.006 * Math.cos(2 * b), 0.155 * Math.cos(b));
    const arc = rigid(parts.crown, wire, steel, start, 1, null, false);
    aimKnightFork(arc, end, 0.58);
  }
  const plates = [], chains = [], roots = [];
  for (const [i, side] of ['L', 'R'].entries()) {
    const sign = i ? -1 : 1;
    const root = parts['root' + side];
    roots.push(root);
    for (const [name, x, y, z] of knightPlates) {
      const mesh = parts[name + side];
      // Some pivots sit inside the hollow shell. Terminate at an actual metal vertex.
      const terminal = v(0, 0, 0), vertices = mesh.geometry.attributes.position;
      let nearest = Infinity;
      for (let j = 0; j < vertices.count; j++) {
        _v1.fromBufferAttribute(vertices, j);
        const d = _v1.lengthSq();
        if (d < nearest) { nearest = d; terminal.copy(_v1); }
      }
      const fork = rigid(mesh.parent, wire, steel, mesh.position, 1, null, false);
      fork.name = 'tether' + name + side;
      fork.visible = false;
      plates.push({ mesh, rest: mesh.position.clone(), offset: v(x * sign, y, z), fork, sign, terminal });
    }
    for (const [j, name] of ['bind', 'cross', 'fetter'].entries()) {
      const mesh = parts[name + side];
      chains.push({ mesh, rest: mesh.position.clone(), sign, delay: (2 * j + i) * 0.14 });
    }
  }
  parts.crown.visible = parts.bladeArc.visible = false;
  for (const root of roots) root.scale.setScalar(0.15);
  rig.p.stormArmour = { plates, chains, roots, core, crown: parts.crown, crownY: parts.crown.position.y,
    blade: parts.bladeArc, phase: 1, broken: 0, opened: 0 };
}

function animateKnightArmour(rig, phase, dt) {
  const armour = rig.p.stormArmour;
  if (!armour) return;
  armour.phase = phase ?? armour.phase;
  const tint = rig.glowMat.color;
  armour.core.setRGB(0.92, 1.53, 2.25).lerp(tint, 0.09);
  const charged = armour.phase >= 2, open = armour.phase === 3, t = rig.t;
  armour.blade.visible = charged;
  armour.broken = charged ? Math.min(1.3, armour.broken + dt) : 0;
  for (const { mesh, rest, sign, delay } of armour.chains) {
    const snap = Math.max(0, armour.broken - delay);
    mesh.visible = snap < 0.43;
    if (!mesh.visible) continue;
    mesh.position.copy(rest);
    mesh.position.x += sign * snap * 0.59;
    mesh.position.y += snap * (0.62 - 3.6 * snap);
    mesh.rotation.z = sign * snap * 2.8;
    mesh.scale.setScalar(1 - sstep(0.29, 0.43, snap));
  }
  for (let i = 0; i < armour.roots.length; i++) {
    const beat = Math.sin(21 * t + 5 * i) * Math.sin(7 * t + i);
    const scale = charged ? 0.88 + 0.17 * beat : 0.14 + 0.20 * Math.max(0, beat);
    armour.roots[i].scale.setScalar(scale);
  }
  armour.opened = open ? Math.min(1, armour.opened + dt * 1.5) : 0;
  const lift = sstep(0, 1, armour.opened);
  armour.crown.visible = open;
  armour.crown.position.y = armour.crownY - 0.18 * (1 - lift) + 0.018 * Math.sin(t * 2);
  armour.crown.rotation.y = t * 0.43;
  for (let i = 0; i < armour.plates.length; i++) {
    const { mesh, rest, offset, sign, fork, terminal } = armour.plates[i];
    mesh.position.copy(rest).addScaledVector(offset, lift);
    mesh.position.y += lift * (0.030 * Math.sin(t * 2.7 + i * 2) + 0.005 * Math.sin(18 * t + i));
    mesh.position.z += lift * 0.022 * Math.cos(t * 1.8 + i);
    mesh.rotation.z = sign * lift * (0.20 + 0.12 * Math.sin(2.1 * t + i));
    mesh.rotation.y = lift * 0.23 * Math.cos(t * 1.7 + i);
    fork.visible = lift > 0.01;
    if (fork.visible) {
      const end = _v1.copy(terminal).applyQuaternion(mesh.quaternion).add(mesh.position);
      aimKnightFork(fork, end, 0.82 + 0.12 * Math.sin(t * 16 + i));
    }
  }
}

function knightPost(s, R, dt) {
  // orient the fist so the blade points: low guard (idle), up/back (windup), forward-down (cut)
  const root = R.root;
  const re = root.matrixWorld.elements;
  const rs = root.scale.x || 1;
  const up = _v1.set(re[4], re[5], re[6]).multiplyScalar(1 / rs);
  const fw = _v2.set(re[8], re[9], re[10]).multiplyScalar(1 / rs);
  const a = R.w.cast * (1 - Math.max(R.w.dead, R.w.down));
  const raise = clamp((0.8 - (s.aimPitch ?? 0)) / 2.4, 0, 1);
  const ang = mix(-0.54, mix(-0.3, 2.6, raise), a) + R.w.kneel * -0.6;
  const guardSide = _v5.crossVectors(up, fw);
  const guardYaw = -2.25 * (1 - a);
  const want = _v3.copy(fw).multiplyScalar(Math.cos(ang) * Math.cos(guardYaw))
    .addScaledVector(guardSide, Math.cos(ang) * Math.sin(guardYaw)).addScaledVector(up, Math.sin(ang)).normalize();
  const hand = R.B.handR;
  hand.getWorldQuaternion(_q1);
  const cur = _v4.set(0, 0, 1).applyQuaternion(_q1);
  rotateTowards(hand, cur, want, 0.95 * (1 - R.w.shock));
  hand.updateMatrixWorld(true);
  animateKnightArmour(R, s.phase, dt);
}

export function makeKnight(spectral = false) {
  const T = enemyType(KNIGHT[spectral ? 'spectral' : 'normal']);
  const glow = glowBasic(spectral ? 0x9ad0ff : 0xb080ff, 2.5);
  const metal = metalMat();
  const main = skinMat(0.6);
  const rig = new HumanRig(T, { mats: { main, metal, glow }, castPose: false, hold: null, outline: 0.0032, rim: 0.6, style: { armHang: 0.1, stanceDepth: 0.19 }, pose: knightPose, post: knightPost });
  // Keep the rib light cold while retaining a little of the level tint.
  const cold = new THREE.Color(0.92, 1.53, 2.25);
  dress(rig, { glow: cold, mat: { main: { spec: 0.58, row: 2 } } });
  const sword = new THREE.Group(), held = T.built.rigid || {};
  if (!held.sword || !held.bladeArc) getSwordGeo();
  if (held.sword) for (const k of ['sword', 'hilt']) { const m = new THREE.Mesh(held[k].geo, main); m.castShadow = true; sword.add(m); }
  else { const blade = metalMat(); rig.mats.push(blade); const sm = new THREE.Mesh(swordGeo, blade); sm.castShadow = true; sword.add(sm); }
  const edge = held.bladeArc ? new THREE.Object3D() : new THREE.Mesh(swordEdgeGeo, glow);
  bindKnightArmour(rig, sword, main, cold, spectral);
  edge.position.set(0, 0, 0.76); sword.add(edge);
  sword.position.set(0, -rig.L.hand * 0.36, 0.004);
  rig.B.handR.add(sword);
  rig.p.sword = sword; rig.p.swordEdge = edge;
  rig.glowMat = glow; rig.glowMats = spectral ? [] : [glow];
  rig.height = 2.4;
  if (spectral) makeGhost(rig, 0x9ad0ff, 0.7);
  return rig;
}

// ===========================================================================
// 방패지기 — a forgotten gate guard: barrel cuirass over a faded tabard, a dented
// kettle helm and mail hood around a face that is only two lights in the dark,
// a bronze tower shield with a glowing ward rune, a flanged mace.
const SHIELD_CFG = {
  key: 'shield', scale: 1.15, bodyW: 1.35, limb: 1.15, shoulderW: 1.1, hunch: 0.08, stride: 1.45, group: METAL,
  colors: { metal: 0x7d7986, metalD: 0x55515f, trim: 0x8f744c, under: 0x2c2733, mail: 0x4a4656, tunic: 0x5b3345, tunicIn: 0x321c28, leather: 0x4a3429, void: 0x0b0910, glow: 0xffffff, glowD: 0xa0a0a0 },
  build(S, L, j) {
    const HC = L.HC, hr = L.hr, H = L.H, SY = L.SY;
    const T = { mat: 'trim', r: 0.0085 }, ax = (p) => v(0, p.y, 0);
    const F = husk(S, L, j, 1.1);
    F.mesh('under', { cell: 0.024 });
    // barrel cuirass with a keel, shoulder straps, gorget
    const cuir = (u, vv, q) => {
      const a = u * TAU, ca = Math.cos(a), sa = Math.sin(a), af = a > Math.PI ? a - TAU : a, front = Math.exp(-(af * af) / 0.06);
      const bulge = Math.sin(Math.min(1, 0.15 + vv * 0.95) * Math.PI);
      const rx = 0.2 + 0.045 * bulge, rz = 0.14 + 0.055 * bulge * (ca > 0 ? 1 : 0.6);
      const se = 1 / Math.pow(Math.pow(Math.abs(ca), 2.4) + Math.pow(Math.abs(sa), 2.4), 1 / 2.4);
      q.set(sa * rx * se, mix(SY - 0.035 + 0.07 * ca * ca, H + 0.17, vv), ca * rz * se * (1 + 0.05 * front) + 0.01);
    };
    plate(S, 'metal', ['chest', ['spine', 1.2]], cuir, { nu: 32, nv: 8, wrap: true, thick: 0.018, inside: ax, trim: { ...T, top: true } });
    const cc = v(0, SY - 0.12, 0);
    for (const [x, y] of [[-0.11, -0.02], [0.11, -0.02], [-0.13, -0.2], [0.13, -0.2], [0, -0.3]]) blob(S, 'trim', ['chest'], { c: seat(cuir, x, SY + y, cc, 0.002), r: [0.012, 0.012, 0.008], ws: 8, hs: 6, ol: 0.4 });
    cuff(S, 'metalD', ['chest', ['neck', 1.3]], v(0, L.NY - 0.05, 0), v(0, L.NY + 0.05, 0.004), (vv) => mix(0.135, 0.09, Math.pow(vv, 0.6)), { trim: T, nu: 18, nv: 3 });
    // tabard skirt under a belt, ragged at the hem
    sheet(S, 'tunic', [['hips', 0.6], ['thighL', 1], ['thighR', 1]], {
      nu: 30, nv: 6, wrap: true, thick: 0.012, innerMat: 'tunicIn',
      fn: (u, vv, q) => { const a = u * TAU, tri = Math.abs(((u * 7 + 0.2) % 1) - 0.5) * 2, rr = mix(0.2, 0.27, Math.pow(vv, 0.8)) * (1 + 0.05 * vv * Math.sin(a * 9)); q.set(Math.sin(a) * rr * 1.1, H + 0.2 - vv * (0.4 + 0.1 * tri * tri), Math.cos(a) * rr * 0.86 + 0.006); },
      inside: ax,
    });
    const bp = []; for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; bp.push(v(Math.sin(a) * 0.232, H + 0.165 - 0.012 * Math.cos(a), Math.cos(a) * 0.184 + 0.008)); }
    tube(S, 'leather', ['hips', 'spine'], { pts: bp, closed: true, seg: 6, steps: 32, r: [0.012, 0.034], ref: v(0, 1, 0) });
    prism(S, 'trim', ['hips', 'spine'], [0.2, 0.214].map((z) => [v(-0.04, H + 0.2, z), v(0.04, H + 0.2, z), v(0.04, H + 0.125, z), v(-0.04, H + 0.125, z)]), { ol: 0.5 });
    for (const sd of [1, -1]) {
      const n = sd > 0 ? 'L' : 'R', sh = j('arm' + n), el = j('fore' + n), wr = j('hand' + n), th = j('thigh' + n), kn = j('shin' + n), an = j('foot' + n), toe = j('toe' + n);
      // round pauldron (two lames), mail sleeve, vambrace, gauntlet
      for (let k = 1; k >= 0; k--) dome(S, k ? 'metalD' : 'metal', ['arm' + n, ['clav' + n, 1.3]], sh.clone().add(v(sd * (0.02 + k * 0.022), 0.03 - k * 0.055, 0)), [0.125 + k * 0.01, 0.105, 0.13 + k * 0.01], { rot: [0, 0, -sd * (0.75 + k * 0.15)], th1: 1.25, nu: 16, nv: 5, trim: T });
      cuff(S, 'mail', ['arm' + n], sh.clone().lerp(el, 0.4), sh.clone().lerp(el, 0.95), (vv) => 0.064 * (1 + 0.035 * Math.sin(vv * 40)), { nv: 8 });
      cuff(S, 'metal', ['fore' + n], el.clone().lerp(wr, 0.12), wr.clone().lerp(el, 0.06), (vv) => mix(0.066, 0.056, vv) + 0.012 * sstep(0.75, 1, vv), { trim: { ...T, top: true } });
      gauntlet(S, L, j, sd, 'metalD', 1.35);
      // kneecap, greave, heavy boot
      dome(S, 'metalD', ['shin' + n, ['thigh' + n, 1.25]], kn.clone().add(v(0, 0.004, 0.02)), [0.08, 0.085, 0.07], { rot: [Math.PI / 2, 0, 0], th1: 1.3, nu: 14, nv: 5, trim: T });
      cuff(S, 'metal', ['shin' + n], kn.clone().lerp(an, 0.16), an.clone().lerp(kn, 0.05), (vv, ang) => (mix(0.08, 0.062, vv) + 0.015 * Math.sin(vv * Math.PI) * Math.max(0, -Math.cos(ang))), { trim: { ...T, top: true }, nv: 5 });
      const heel = v(an.x, 0.052, an.z - 0.065), tip = v(toe.x, 0.04, toe.z + 0.075);
      tube(S, 'leather', [['shin' + n, 1.4], 'foot' + n, 'toe' + n], { pts: [heel, v(an.x, 0.066, an.z + 0.02), v((an.x + toe.x) / 2, 0.056, toe.z - 0.02), tip], seg: 14, steps: 10, ref: v(0, 1, 0), cap0: 0.9, cap1: 0.9, r: (u) => [0.062 * (u > 0.8 ? mix(1, 0.7, (u - 0.8) / 0.2) : 1), u < 0.45 ? 0.064 : mix(0.064, 0.044, (u - 0.45) / 0.55)], shape: (u, a) => { const s = Math.sin(a); return s < 0 ? mix(1, 0.68, s * s) : 1; } });
      tube(S, 'metalD', ['toe' + n], { pts: [v(toe.x - 0.05, 0.045, toe.z + 0.02), v(toe.x, 0.075, toe.z + 0.05), v(toe.x + 0.05, 0.045, toe.z + 0.02)], seg: 6, steps: 8, r: [0.012, 0.03], ref: v(0, 0, 1), cap0: 1, cap1: 1 });
    }
    // kettle helm: dented bowl, wide brim, mail hood, a void with two lights
    const hc = HC.clone().add(v(0, hr * 0.1, 0));
    blob(S, 'void', ['head'], { c: HC, r: [hr * 0.9, hr * 0.95, hr * 0.92], ws: 16, hs: 12, ol: 0 });
    for (const sd of [1, -1]) blob(S, 'glow', ['head'], { c: HC.clone().add(v(sd * hr * 0.33, hr * 0.02, hr * 0.9)), r: [hr * 0.15, hr * 0.18, hr * 0.06], ws: 10, hs: 8, ol: 0 });
    dome(S, 'metal', ['head'], hc, [hr * 1.14, hr * 1.2, hr * 1.18], { th1: 1.5, nu: 26, nv: 8, thick: 0.016, fn: (q) => { q.multiplyScalar(1 + 0.05 * Math.exp(-(q.x * q.x) / (hr * hr * 0.03)) - 0.07 * Math.exp(-((q.x - hr * 0.6) ** 2 + (q.z - hr * 0.5) ** 2) / (hr * hr * 0.1))); } });
    plate(S, 'metalD', ['head'], (u, vv, q) => { const a = u * TAU, rr = hr * mix(1.12, 1.95, vv); q.set(Math.sin(a) * rr, hc.y + hr * 0.1 - vv * vv * hr * 0.42 - hr * 0.05 * Math.cos(a) * vv, hc.z + Math.cos(a) * rr * 1.02); }, { nu: 30, nv: 4, wrap: true, thick: 0.014, inside: (p) => v(p.x * 0.5, p.y - 1, p.z * 0.5), trim: T });
    const band = []; for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; band.push(v(Math.sin(a) * hr * 1.16, hc.y + hr * 0.13, hc.z + Math.cos(a) * hr * 1.2)); }
    tube(S, 'trim', ['head'], { pts: band, closed: true, seg: 6, steps: 32, r: [0.008, 0.02], ref: v(0, 1, 0), ol: 0.5 });
    spike(S, 'trim', ['head'], hc.clone().add(v(0, hr * 1.18, 0)), v(0, 1, -0.1), hr * 0.42, hr * 0.12, { seg: 8, ridge: 0.2, rings: 14 });
    sheet(S, 'mail', [['head', 1], ['neck', 1.2], ['chest', 1.6]], {
      nu: 26, nv: 7, thick: 0.014, sides: true,
      fn: (u, vv, q) => { const a = mix(0.62, TAU - 0.62, u), tri = Math.abs(((u * 9) % 1) - 0.5) * 2, rr = hr * mix(1.02, 1.25, vv) + 0.07 * sstep(0.55, 1, vv); q.set(Math.sin(a) * rr * (1 + 0.25 * sstep(0.6, 1, vv)), HC.y + hr * 0.25 - vv * (hr * 1.75 + 0.03 * tri) + 0.004 * Math.sin(vv * 60), HC.z + Math.cos(a) * rr * 0.95 - 0.01); },
      inside: (p) => v(0, p.y, HC.z),
    });
    return { fields: [F], aoR: 0.05, ao: 0.5, fn: (key, p, n, c) => { if (key.startsWith('metal')) c.multiplyScalar(0.86 + 0.2 * Math.max(0, n.y)); if (key === 'tunic') c.multiplyScalar(0.72 + 0.5 * sstep(H - 0.3, H + 0.2, p.y)); } };
  },
};
let shieldGeo = null, maceGeo = null;
const SH_W = 0.66, SH_H = 1.08;
function getShieldGeo() {
  if (shieldGeo) return shieldGeo;
  shieldGeo = rigidType((S) => {
    // curved tower shield: bronze field, raised iron frame and keel, boss, rivets, a notched foot
    const bend = (x) => -0.075 * x * x * SH_W;
    const face = (u, vv, q) => { const x = (u - 0.5) * 2, top = 0.05 * (1 - x * x), foot = 0.11 * (1 - Math.abs(x)); q.set(x * SH_W / 2, mix(SH_H / 2 + top, -SH_H / 2 - foot, vv), bend(x) + 0.006 * Math.sin(u * 13 + vv * 9) * Math.sin(vv * 7)); };
    plate(S, 'bronze', 'r', face, { nu: 12, nv: 14, thick: 0.04, inside: (p) => v(p.x, p.y, p.z - 1), trim: { mat: 'iron', r: 0.02, top: true, sides: true } });
    plate(S, 'bronzeL', 'r', (u, vv, q) => { face(0.2 + u * 0.6, 0.14 + vv * 0.7, q); q.z += 0.012; }, { nu: 8, nv: 10, thick: 0.012, inside: (p) => v(p.x, p.y, p.z - 1), trim: { mat: 'iron', r: 0.009, top: true, sides: true } });
    tube(S, 'iron', 'r', { pts: [v(0, SH_H / 2 + 0.04, 0.02), v(0, 0, 0.026), v(0, -SH_H / 2 - 0.1, 0.02)], seg: 6, steps: 10, r: [0.022, 0.014], ref: v(0, 0, 1), cap0: 1, cap1: 1 });
    for (const y of [0.3, -0.3]) tube(S, 'iron', 'r', { pts: [-1, -0.5, 0, 0.5, 1].map((x) => v(x * SH_W / 2 * 0.96, y, bend(x) + 0.018)), seg: 6, steps: 10, r: [0.012, 0.018], ref: v(0, 0, 1) });
    blob(S, 'iron', 'r', { c: v(0, 0.02, 0.022), r: [0.115, 0.115, 0.075], ws: 18, hs: 10, skip: (d) => d.z < -0.2, fn: (d, p) => { p.z += 0.02 * Math.exp(-(d.x * d.x + d.y * d.y) / 0.05); } });
    for (const [x, y] of [[-0.29, 0.48], [0.29, 0.48], [-0.29, -0.48], [0.29, -0.48], [-0.29, 0.3], [0.29, 0.3], [-0.29, -0.3], [0.29, -0.3], [0, 0.44], [0, -0.44]]) blob(S, 'bronzeL', 'r', { c: v(x, y, bend(x / (SH_W / 2)) + 0.03), r: [0.018, 0.018, 0.013], ws: 8, hs: 6 });
    // grip and arm strap on the back
    tube(S, 'leather', 'r', { pts: [v(-0.06, 0.05, -0.02), v(0, 0.05, -0.075), v(0.06, 0.05, -0.02)], seg: 6, steps: 6, r: 0.016, ref: v(0, 1, 0) });
    tube(S, 'leather', 'r', { pts: [v(-0.12, 0.3, -0.02), v(0, 0.3, -0.08), v(0.12, 0.3, -0.02)], seg: 6, steps: 6, r: [0.03, 0.008], ref: v(0, 1, 0) });
  }, { bronze: 0x7d6245, bronzeL: 0x9a7b52, iron: 0x5c5864, leather: 0x3a2a22 });
  return shieldGeo;
}
function getMaceGeo() {
  if (maceGeo) return maceGeo;
  maceGeo = rigidType((S) => {
    tube(S, 'haft', 'r', { pts: [v(0, 0, -0.16), v(0, 0, 0.3), v(0, 0, 0.6)], seg: 10, steps: 10, ref: v(0, 1, 0), r: (u) => 0.021 + 0.004 * u, cap0: 0.6 });
    tube(S, 'wrap', 'r', { pts: [v(0, 0, -0.12), v(0, 0, 0.12)], seg: 10, steps: 12, ref: v(0, 1, 0), r: 0.026, shape: (u, a) => 1 + 0.1 * Math.pow(Math.abs(Math.sin(u * 20 + a)), 2) });
    for (const z of [-0.165, 0.14, 0.56]) tube(S, 'iron', 'r', { pts: [v(0, 0, z - 0.012), v(0, 0, z + 0.012)], seg: 10, steps: 1, ref: v(0, 1, 0), r: 0.031, flat0: true, flat1: true });
    blob(S, 'iron', 'r', { c: v(0, 0, 0.7), r: [0.05, 0.05, 0.11], ws: 12, hs: 10 });
    // six flanges
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU, cx = Math.cos(a), cy = Math.sin(a), tx = -cy * 0.011, ty = cx * 0.011; prism(S, 'ironL', 'r', [[0.6, 0.045], [0.66, 0.105], [0.74, 0.11], [0.8, 0.05]].map(([z, r]) => [v(cx * 0.03 + tx, cy * 0.03 + ty, z), v(cx * r, cy * r, z), v(cx * 0.03 - tx, cy * 0.03 - ty, z)])); }
    spike(S, 'iron', 'r', v(0, 0, 0.8), v(0, 0, 1), 0.1, 0.028, { seg: 8 });
  }, { haft: 0x3a2e28, wrap: 0x5a3a2a, iron: 0x5e5a66, ironL: 0x7c7884 });
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
  const T = enemyType(SHIELD_CFG);
  const glow = glowBasic(0xc9a0ff, 2.6);
  const main = skinMat(0.6), held = T.built.rigid || {};
  const gear = held.shield ? main : metalMat(0.8);
  const rig = new HumanRig(T, { mats: { main, metal: metalMat(0.8), glow }, castPose: false, hold: null, outline: 0.0036, rim: 0.6, pose: shieldPose, post: shieldPost });
  dress(rig, { mat: { main: { spec: 1.0 } } });
  const B = rig.B;
  if (!held.shield) rig.mats.push(gear);
  // shield pivot in body space (follows the chest)
  const anchor = new THREE.Group();
  anchor.position.copy(T.def.pos('chest')).negate();
  B.chest.add(anchor);
  const pivot = new THREE.Group(); anchor.add(pivot);
  const shield = new THREE.Mesh(held.shield ? held.shield.geo : getShieldGeo(), gear); shield.castShadow = true; pivot.add(shield);
  if (!held.shield) {   // the authored shield carries its ward rune in the glow mask
    const g2 = glowTwin(glow);
    const rune = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.011, 6, 32), g2); rune.position.set(0, 0.02, 0.03); pivot.add(rune);
    for (let i = 0; i < 2; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.22, 0.01), g2); bar.position.set(i ? 0.15 : -0.15, -0.34, 0.03); bar.rotation.z = i ? 0.4 : -0.4; pivot.add(bar); }
  }
  const grip = new THREE.Object3D(); grip.position.set(0, 0.05, -0.1); pivot.add(grip);
  rig._grip = grip;
  rig._handOff = T.def.pos('handL').clone().sub(T.def.pos('foreL'));
  // mace
  const mace = new THREE.Mesh(held.mace ? held.mace.geo : getMaceGeo(), gear); mace.castShadow = true;
  mace.position.set(0, -rig.L.hand * 0.36, 0.004); B.handR.add(mace);
  rig.shield = pivot; rig.shieldPivot = pivot;
  rig.glowMats = [glow]; rig.glowMat = glow;
  rig.height = 2.0;
  return rig;
}

// ===========================================================================
// 메아리 사수 — a hooded echo: a deep, peaked hood over a cracked bone mask, a
// torn mantle and cloak, wrapped forearms, a quiver of glowing arrows. It still
// draws a bow it no longer remembers (glowing string).
const ARCHER_CFG = {
  key: 'archer', scale: 1.0, bodyW: 0.84, limb: 0.82, legLen: 0.82, armLen: 1.05, headR: 0.15, hunch: 0.18, stride: 1.9,
  colors: { under: 0x2d2936, wrap: 0x8a8272, cloak: 0x44505f, cloakIn: 0x222834, mantle: 0x566373, leather: 0x4a3a30, leatherD: 0x2c2420, bone: 0xd8cfbb, void: 0x0a0810, wood: 0x5d4532, trim: 0x8a7a58, glow: 0xffffff, glowD: 0xa0a0a0 },
  bones(def, L) { return (ARCHER_CFG._ch = capeChains(def, L, 0.98, { r0: 0.17, r1: 0.3, dy: 0.04 })); },
  build(S, L, j) {
    const HC = L.HC, hr = L.hr, H = L.H, SY = L.SY, ax = (p) => v(0, p.y, 0);
    const F = husk(S, L, j, 0.86);
    F.mesh('under', { cell: 0.0185 });
    for (const sd of [1, -1]) {
      const n = sd > 0 ? 'L' : 'R', el = j('fore' + n), wr = j('hand' + n), kn = j('shin' + n), an = j('foot' + n), toe = j('toe' + n);
      // forearm wraps (a leather bracer on the bow arm), gloves
      if (sd > 0) cuff(S, 'leather', ['fore' + n], el.clone().lerp(wr, 0.18), wr.clone().lerp(el, 0.06), (vv) => mix(0.046, 0.038, vv) + 0.006 * sstep(0.8, 1, vv), { trim: { mat: 'trim', r: 0.005, top: true }, nv: 4 });
      else cuff(S, 'wrap', ['fore' + n], el.clone().lerp(wr, 0.25), wr.clone().lerp(el, 0.05), (vv) => mix(0.042, 0.035, vv) * (1 + 0.06 * Math.pow(Math.abs(Math.sin(vv * 20)), 3)), { nv: 14, thick: 0.006 });
      gauntlet(S, L, j, sd, 'leatherD', 1.0);
      // soft boots with turned cuffs, shin wraps
      cuff(S, 'wrap', ['shin' + n], kn.clone().lerp(an, 0.2), kn.clone().lerp(an, 0.62), (vv) => mix(0.052, 0.042, vv) * (1 + 0.06 * Math.pow(Math.abs(Math.sin(vv * 16)), 3)), { nv: 12, thick: 0.006 });
      cuff(S, 'leather', ['shin' + n, ['foot' + n, 1.3]], kn.clone().lerp(an, 0.58), an.clone().add(v(0, -0.02, 0)), (vv) => mix(0.05, 0.044, vv) + 0.01 * sstep(0.2, 0, vv), { nv: 5, trim: { mat: 'leatherD', r: 0.007, top: true, hem: false } });
      const heel = v(an.x, 0.045, an.z - 0.05), tip = v(toe.x, 0.034, toe.z + 0.07);
      tube(S, 'leather', [['shin' + n, 1.4], 'foot' + n, 'toe' + n], { pts: [heel, v(an.x, 0.056, an.z + 0.02), v((an.x + toe.x) / 2, 0.045, toe.z - 0.02), tip], seg: 12, steps: 9, ref: v(0, 1, 0), cap0: 0.9, cap1: 0.8, r: (u) => [0.045 * (u > 0.75 ? mix(1, 0.55, (u - 0.75) / 0.25) : 1), u < 0.45 ? 0.05 : mix(0.05, 0.03, (u - 0.45) / 0.55)], shape: (u, a) => { const s = Math.sin(a); return s < 0 ? mix(1, 0.7, s * s) : 1; } });
    }
    // belt, pouch, quiver strap
    const bp = []; for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; bp.push(v(Math.sin(a) * 0.128, H + 0.13 - 0.01 * Math.cos(a), Math.cos(a) * 0.1)); }
    tube(S, 'leather', ['hips', 'spine'], { pts: bp, closed: true, seg: 6, steps: 28, r: [0.008, 0.022], ref: v(0, 1, 0) });
    blob(S, 'leather', ['hips'], { c: v(0.11, H + 0.08, 0.06), r: [0.036, 0.045, 0.03], ws: 10, hs: 8 });
    blob(S, 'trim', ['hips', 'spine'], { c: v(0, H + 0.13, 0.105), r: [0.02, 0.024, 0.008], ws: 8, hs: 6 });
    const sp = []; for (let k = 0; k <= 10; k++) { const t = k / 10, a = mix(-2.2, 1.0, t); sp.push(v(Math.sin(a) * 0.135, mix(SY + 0.02, H + 0.2, t), Math.cos(a) * 0.105)); }
    tube(S, 'leather', ['chest', 'spine'], { pts: sp, seg: 5, steps: 20, r: [0.005, 0.016], ref: v(0, 1, 0) });
    // quiver with fletched, glowing arrows
    const q0 = v(-0.09, SY - 0.38, -0.135), q1 = v(0.11, SY + 0.07, -0.175), qd = q1.clone().sub(q0).normalize();
    tube(S, 'leather', ['chest', 'spine'], { pts: [q0, q0.clone().lerp(q1, 0.5), q1], seg: 12, steps: 6, r: (u) => mix(0.04, 0.052, u) * (1 + 0.08 * Math.pow(Math.abs(Math.sin(u * 9.5)), 8)), ref: v(0, 0, 1), cap0: 0.7 });
    for (let k = 0; k < 4; k++) {
      const b0 = q1.clone().add(v((k - 1.5) * 0.02, 0, ((k * 7) % 3 - 1) * 0.014)), tipA = b0.clone().addScaledVector(qd, 0.16 + (k % 2) * 0.03);
      tube(S, 'wood', ['chest'], { pts: [b0.clone().addScaledVector(qd, -0.05), tipA], seg: 5, steps: 2, r: 0.006, ol: 0.3 });
      for (let f = 0; f < 3; f++) { const a = (f / 3) * TAU + k, sdv = v(Math.cos(a), 0, Math.sin(a)); prism(S, 'glow', ['chest'], [0.08, 0.11, 0.15].map((t, i) => { const c = b0.clone().addScaledVector(qd, t + (k % 2) * 0.03), w = [0.004, 0.022, 0.006][i]; return [c.clone().addScaledVector(sdv, 0.004), c.clone().addScaledVector(sdv, 0.004 + w).addScaledVector(qd, -0.01), c.clone().addScaledVector(sdv, 0.004).add(v(0.002, 0, 0.002))]; }), { ol: 0 }); }
    }
    // bone mask: long oval, sorrowful sockets, a crack down one side, in the dark of the hood
    blob(S, 'void', ['head'], { c: HC.clone().add(v(0, 0, -hr * 0.05)), r: [hr * 0.86, hr * 0.98, hr * 0.9], ws: 16, hs: 12, ol: 0 });
    const K = new Field(S), mc = HC.clone().add(v(0, -hr * 0.12, hr * 0.5));
    K.bind(['head'], 0.02).ell(mc, [hr * 0.7, hr * 1.02, hr * 0.5]);
    K.ell(mc.clone().add(v(0, hr * 0.42, hr * 0.3)), [hr * 0.56, hr * 0.16, hr * 0.24], { k: 0.03 });
    K.cone(mc.clone().add(v(0, hr * 0.1, hr * 0.44)), mc.clone().add(v(0, -hr * 0.3, hr * 0.56)), hr * 0.1, hr * 0.13, { k: 0.03 });
    K.ell(mc.clone().add(v(0, 0, -hr * 0.2)), [hr * 0.66, hr * 1.0, hr * 0.5], { sub: true, k: 0.01 });
    for (const sd of [1, -1]) K.ell(mc.clone().add(v(sd * hr * 0.31, hr * 0.16, hr * 0.42)), [hr * 0.2, hr * 0.13, hr * 0.3], { sub: true, k: 0.01, rot: [0, 0, -sd * 0.38] });
    K.groove([mc.clone().add(v(hr * 0.3, hr * 0.9, hr * 0.3)), mc.clone().add(v(hr * 0.18, hr * 0.55, hr * 0.5)), mc.clone().add(v(hr * 0.38, hr * 0.38, hr * 0.5)), mc.clone().add(v(hr * 0.5, -hr * 0.1, hr * 0.4)), mc.clone().add(v(hr * 0.36, -hr * 0.5, hr * 0.4))], 0.0075, 0.002);
    for (let k = -1; k <= 1; k++) K.groove([mc.clone().add(v(k * hr * 0.13, -hr * 0.52, hr * 0.5)), mc.clone().add(v(k * hr * 0.12, -hr * 0.8, hr * 0.42))], 0.006, 0.001);
    K.mesh('bone', { cell: 0.0088, ol: 0.5 });
    for (const sd of [1, -1]) blob(S, 'glow', ['head'], { c: mc.clone().add(v(sd * hr * 0.3, hr * 0.14, hr * 0.2)), r: [hr * 0.1, hr * 0.1, hr * 0.06], ws: 10, hs: 8, ol: 0 });
    // hood: deep, peaked, drooping behind; spreads over the shoulders under the mantle
    sheet(S, 'cloak', [['head', 1], ['neck', 1.5], ['chest', 2.2]], {
      nu: 22, nv: 12, thick: 0.014, sides: true, innerMat: 'cloakIn',
      fn: (u, vv, q) => {
        const open = mix(0.5, 1.02, sstep(0.05, 0.55, vv)) * sstep(1.02, 0.72, vv) + 0.3 * sstep(0.75, 1, vv);
        const phi = mix(open, TAU - open, u), th = mix(0.06, 2.3, vv), r = hr * mix(1.22, 1.34, vv);
        const back = 1 - Math.abs(u - 0.5) * 2, peak = sstep(0.3, 0.9, back) * Math.exp(-((vv - 0.27) ** 2) / 0.02) * hr * 0.55;
        q.set(HC.x + Math.sin(th) * Math.sin(phi) * r, HC.y + hr * 0.12 + Math.cos(th) * r * 1.04 - sstep(0.7, 1, vv) * hr * 0.25, HC.z - hr * 0.04 + Math.sin(th) * Math.cos(phi) * r * 1.02);
        q.z -= peak; q.y += peak * 0.25 - sstep(0.5, 1, back) * sstep(0.3, 0.6, vv) * hr * 0.06;
        const sh = sstep(0.75, 1, vv); q.x *= 1 + sh * 0.35; q.z = mix(q.z, q.z * 1.1 - 0.02, sh);
        q.z -= 0.012 * Math.sin(u * 30) * vv;
        // the brim hangs forward over the mask
        q.z += hr * 0.22 * sstep(0.7, 1, Math.abs(u - 0.5) * 2) * sstep(0.5, 0.1, vv); q.y -= hr * 0.1 * sstep(0.8, 1, Math.abs(u - 0.5) * 2) * sstep(0.35, 0.05, vv);
      },
      inside: (p) => v(HC.x, p.y, HC.z - 0.01),
    });
    // torn mantle over the shoulders with a clasp, long cloak on chains
    sheet(S, 'mantle', ['chest', ['neck', 1.4], ['clavL', 1.2], ['clavR', 1.2], ['armL', 1.5], ['armR', 1.5]], {
      nu: 30, nv: 6, wrap: true, thick: 0.012, innerMat: 'cloakIn',
      fn: (u, vv, q) => { const a = u * TAU, tri = Math.abs(((u * 8 + 0.4) % 1) - 0.5) * 2, e = Math.pow(vv, 0.6); q.set(Math.sin(a) * mix(0.075, L.SX + 0.075, e) * (1 + 0.04 * vv * Math.sin(a * 9)), L.NY + 0.03 - vv * (0.2 + 0.07 * tri * tri) - 0.03 * vv * Math.abs(Math.cos(a)), Math.cos(a) * mix(0.07, 0.15, e) - 0.012); },
      inside: (p) => v(0, p.y + 0.05, -0.01),
    });
    prism(S, 'trim', ['chest'], [0.075, 0.09].map((z) => [v(0, L.NY - 0.01, z), v(0.022, L.NY - 0.035, z), v(0, L.NY - 0.06, z), v(-0.022, L.NY - 0.035, z)]), { ol: 0.5 });
    capeCloth(S, L, ARCHER_CFG._ch, 'cloak', 'cloakIn', 0.98, { r0: 0.17, r1: 0.3, dy: 0.04, rag: 0.24, rags: 6 });
    // loincloth strip
    tatter(S, 'mantle', [['hips', 0.8], ['thighL', 1.3], ['thighR', 1.3]], v(-0.06, H + 0.12, 0.1), v(0.06, H + 0.12, 0.1), 0.36, { out: v(0, 0, 1), inner: 'cloakIn', flare: 0.035, rags: 2, seed: 2 });
    return { fields: [F, K], aoR: 0.045, ao: 0.55, fn: (key, p, n, c) => { if (key === 'cloak' || key === 'mantle') c.multiplyScalar(0.74 + 0.4 * sstep(0.3, SY, p.y)); if (key === 'bone') c.multiplyScalar(0.84 + 0.2 * Math.max(0, n.y)); } };
  },
};
let bowGeo = null;
const BOW_R = 0.62, BOW_A = 0.4 * Math.PI;
const BOW_TIP_Y = BOW_R * Math.sin(BOW_A), BOW_TIP_Z = -BOW_R + BOW_R * Math.cos(BOW_A) + 0.07;
function getBowGeo() {
  if (bowGeo) return bowGeo;
  bowGeo = rigidType((S) => {
    // bow in its own space: grip at the origin, limbs arc up and down curving back to -Z, recurved tips
    const pts = [];
    for (let k = 0; k <= 20; k++) { const a = mix(-BOW_A, BOW_A, k / 20), e = Math.abs(a / BOW_A); pts.push(v(0, BOW_R * Math.sin(a), -BOW_R + BOW_R * Math.cos(a) + 0.07 * Math.pow(e, 4))); }
    tube(S, 'wood', 'r', { pts, seg: 8, steps: 44, ref: v(0, 0, 1), r: (u) => { const c = Math.abs(u - 0.5) * 2; return [0.013 + 0.012 * (1 - c), (0.02 + 0.014 * (1 - c)) * (1 - 0.3 * sstep(0.85, 1, c))]; }, cap0: 1, cap1: 1 });
    tube(S, 'wrap', 'r', { pts: [v(0, -0.09, 0.004), v(0, 0.09, 0.004)], seg: 8, steps: 10, ref: v(0, 0, 1), r: 0.031, shape: (u, a) => 1 + 0.1 * Math.pow(Math.abs(Math.sin(u * 22 + a)), 2) });
    for (const sy of [1, -1]) {
      tube(S, 'horn', 'r', { pts: [v(0, sy * 0.11, -0.008), v(0, sy * 0.125, -0.01)], seg: 8, steps: 1, ref: v(0, 0, 1), r: 0.03, flat0: true, flat1: true });
      for (const t of [0.62, 0.8]) { const a = sy * BOW_A * t, e = Math.abs(t); tube(S, 'horn', 'r', { pts: [v(0, BOW_R * Math.sin(a) - sy * 0.01, -BOW_R + BOW_R * Math.cos(a) + 0.07 * Math.pow(e, 4)), v(0, BOW_R * Math.sin(a) + sy * 0.01, -BOW_R + BOW_R * Math.cos(a) + 0.07 * Math.pow(e, 4) - 0.004)], seg: 8, steps: 1, ref: v(0, 0, 1), r: 0.024 - t * 0.008, flat0: true, flat1: true }); }
    }
  }, { wood: 0x5d4532, wrap: 0x3a2a24, horn: 0xcfc6b0 });
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
  const T = enemyType(ARCHER_CFG);
  const glow = glowBasic(0x9aeaff, 2.6);
  const main = skinMat(0.6), held = T.built.rigid || {};
  const rig = new HumanRig(T, { mats: { main, glow }, castPose: false, hold: null, outline: 0.0045, rim: 0.6, pose: archerPose, post: archerPost });
  dress(rig, { mat: { main: { spec: 0.6 } } });
  const B = rig.B;
  const gear = held.bow ? main : bodyMat(0xffffff, { vertexColors: true, rim: 0.6 });
  if (!held.bow) rig.mats.push(gear);
  const bow = new THREE.Group();
  const bm = new THREE.Mesh(held.bow ? held.bow.geo : getBowGeo(), gear); bm.castShadow = true; bow.add(bm);
  const g2 = glowTwin(glow);
  const tipG = new THREE.ConeGeometry(0.028, 0.1, 4);
  for (const sy of [-1, 1]) { const t = new THREE.Mesh(tipG, g2); t.position.set(0, sy * (BOW_TIP_Y + 0.04), BOW_TIP_Z + 0.012); t.rotation.x = sy > 0 ? -0.5 : Math.PI + 0.5; bow.add(t); }
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
