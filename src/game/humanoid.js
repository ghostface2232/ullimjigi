// Sculpted, skinned humanoid bodies: skeleton layout, body, clothing layers,
// hair, hats and props. Geometry is built once per character type (CHAR entry)
// and shared by all instances; see characters.js for the animation rig.
import * as THREE from 'three';
import { SkelDef, Sculpt, tube, blob, sheet, addGeo, prof, sstep, mix, TAU, vnoise3 } from './charkit.js';

const V3 = THREE.Vector3;
const v = (x, y, z) => new V3(x, y, z);

// ---------------------------------------------------------------------------
// Layout: joint positions (body space, unscaled; character faces +Z, its left is +X)
export function layout(c) {
  const bw = c.bodyW ?? 1, legLen = c.legLen ?? 0.78, H = legLen + 0.06;
  const tl = c.torsoLen ?? 1, hr = c.headR ?? 0.165, al = c.armLen ?? 1;
  const L = { bw, H, hr, tl, al, belly: c.belly ? (c.bellyAmt ?? 1) : 0, fem: c.fem ?? 0 };
  L.NY = H + 0.49 * tl;
  L.HY = L.NY + 0.07 * (c.neckLen ?? 1);
  L.HC = v(0, L.HY + hr * 0.9, 0.018);
  L.SY = H + 0.43 * tl;
  L.SX = 0.162 * (0.6 + 0.4 * bw) * (c.shoulderW ?? 1) * (1 - L.fem * 0.08);
  L.hipX = 0.09 * (0.62 + 0.38 * bw) * (1 + L.fem * 0.06);
  L.kneeY = H * 0.54; L.ankleY = 0.082;
  L.upper = 0.265 * al; L.fore = 0.24 * al; L.hand = 0.16 * al * (c.handS ?? 1);
  L.limb = c.limb ?? 1;       // limb girth multiplier
  return L;
}

export function skeleton(c, L) {
  const S = new SkelDef();
  const { H, tl, NY, HY, HC, SY, SX, hipX, kneeY, ankleY, hr } = L;
  S.add('hips', null, 0, H, 0, [0, H + 0.13 * tl, 0]);
  S.add('spine', 'hips', 0, H + 0.13 * tl, -0.004);
  S.add('chest', 'spine', 0, H + 0.3 * tl, -0.01, [0, NY, -0.005]);
  S.add('neck', 'chest', 0, NY, -0.004, [0, HY, 0.004]);
  S.add('head', 'neck', 0, HY, 0.004, [0, HC.y + hr, HC.z]);
  S.add('jaw', 'head', 0, HC.y - hr * 0.35, HC.z + hr * 0.25, [0, HC.y - hr * 1.0, HC.z + hr * 0.75]);
  for (const sd of [1, -1]) {
    const n = sd > 0 ? 'L' : 'R';
    S.add('clav' + n, 'chest', sd * 0.03, SY + 0.02, -0.012, [sd * SX, SY, -0.012]);
    S.add('arm' + n, 'clav' + n, sd * SX, SY, -0.012);
    const ex = sd * (SX + 0.028), ey = SY - L.upper;
    S.add('fore' + n, 'arm' + n, ex, ey, -0.03);
    const wx = sd * (SX + 0.042), wy = ey - L.fore;
    S.add('hand' + n, 'fore' + n, wx, wy, -0.005);
    const hl = L.hand;
    S.add('fing' + n, 'hand' + n, wx + sd * 0.003, wy - hl * 0.52, 0.002);
    S.add('fingB' + n, 'fing' + n, wx + sd * 0.004, wy - hl * 0.76, 0.002, [wx + sd * 0.004, wy - hl, 0.002]);
    S.add('thumb' + n, 'hand' + n, wx - sd * 0.01, wy - hl * 0.18, 0.026, [wx - sd * 0.016, wy - hl * 0.5, 0.05]);
    S.add('thigh' + n, 'hips', sd * hipX, H - 0.02, 0);
    S.add('shin' + n, 'thigh' + n, sd * (hipX + 0.004), kneeY, 0.012);
    S.add('foot' + n, 'shin' + n, sd * (hipX + 0.006), ankleY, -0.012);
    S.add('toe' + n, 'foot' + n, sd * (hipX + 0.01), 0.026, 0.1, [sd * (hipX + 0.012), 0.026, 0.155]);
  }
  return S;
}

// ---------------------------------------------------------------------------
// Body
const supEll = (a, n) => { const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)); return 1 / Math.pow(Math.pow(c, n) + Math.pow(s, n), 1 / n); };

export function torsoR(L, c) {
  const bw = L.bw, be = L.belly, fem = L.fem;
  const rx = prof([[0, 0.085], [0.14, 0.15 + fem * 0.012], [0.38, 0.132 - fem * 0.01 + be * 0.03], [0.62, 0.158 - fem * 0.006], [0.8, 0.168 - fem * 0.012], [0.9, 0.145], [0.97, 0.085], [1, 0.062]]);
  const rz = prof([[0, 0.07], [0.14, 0.112], [0.38, 0.1 + be * 0.075], [0.62, 0.118 + fem * 0.01 + be * 0.03], [0.8, 0.108], [0.9, 0.09], [0.97, 0.068], [1, 0.058]]);
  const oz = prof([[0, 0.0], [0.14, -0.012], [0.38, 0.004 + be * 0.05], [0.62, 0.014 + be * 0.012], [0.8, 0.006], [1, 0.002]]);
  const k = c.torsoK ?? 1, ck = (c.chestK ?? 1) - 1, hk = (c.hipK ?? 1) - 1;
  const band = (u) => 1 + ck * sstep(0.42, 0.78, u) * sstep(1.02, 0.9, u) + hk * sstep(0.5, 0.2, u);
  return { rx: (u) => rx(u) * (0.5 + 0.5 * bw) * k * band(u) * (u > 0.1 && u < 0.95 ? (0.82 + 0.18 * bw) : 1), rz: (u) => rz(u) * (0.7 + 0.3 * bw) * k * (1 + (band(u) - 1) * 0.6), oz };
}
export function torsoSpan(L) { return [L.H - 0.1, L.NY + 0.025]; }

export function body(S, L, c, M) {
  const [y0, y1] = torsoSpan(L);
  const T = torsoR(L, c);
  const TW = ['hips', 'spine', 'chest', 'neck', ['armL', 2.2], ['armR', 2.2]];
  const pts = [v(0, y0, 0), v(0, (y0 + y1) / 2, 0.004), v(0, y1, -0.004)];
  const shapeT = (u, a) => {
    // boxier chest, flatter back, collarbone/shoulder slope
    const n = mix(2.1, 2.6, sstep(0.45, 0.8, u));
    let m = supEll(a, n);
    if (Math.sin(a) < 0) m *= 1 - 0.05 * sstep(0.5, 0.8, u); // flatter back
    return m;
  };
  const lower = c.lower ?? 'pants';
  // pelvis (trousers / skirt base)
  tube(S, M.pelvis ?? lower, TW, { pts, seg: 16, steps: 6, ref: v(0, 0, 1), r: (u) => [T.rx(u * 0.42) + 0.002, T.rz(u * 0.42) + 0.002], off: (u) => [0, T.oz(u * 0.42)], shape: (u, a) => shapeT(u * 0.42, a), cap0: 0.9, curve: sub(pts, 0, 0.42) });
  // torso (shirt/tunic)
  tube(S, M.top ?? 'top', TW, {
    seg: 16, steps: 11, ref: v(0, 0, 1), curve: sub(pts, 0.3, 1),
    r: (u) => { const uu = mix(0.3, 1, u); return [T.rx(uu) + 0.006 * (1 - u), T.rz(uu) + 0.006 * (1 - u)]; },
    off: (u) => [0, T.oz(mix(0.3, 1, u))], shape: (u, a) => shapeT(mix(0.3, 1, u), a) * (1 + (c.topFolds ?? 0.012) * Math.sin(a * 7 + u * 3) * (1 - u)),
  });
  // neck
  tube(S, 'skin', ['chest', 'neck', ['head', 1.4]], { pts: [v(0, L.NY - 0.05, -0.006), v(0, L.HY + 0.02, 0.004), v(0, L.HC.y - L.hr * 0.4, L.HC.z * 0.5)], seg: 10, steps: 4, r: (u) => [0.047 * (c.neckW ?? 1) * mix(1.1, 0.95, u), 0.044 * (c.neckW ?? 1)] });
  // arms
  for (const sd of [1, -1]) arm(S, L, c, sd);
  for (const sd of [1, -1]) leg(S, L, c, sd);
}
// a sub-curve helper: Catmull-Rom through pts restricted to [a, b]
function sub(pts, a, b) {
  const full = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const out = [];
  for (let k = 0; k <= 8; k++) out.push(full.getPointAt(mix(a, b, k / 8)));
  return new THREE.CatmullRomCurve3(out, false, 'centripetal');
}

export function arm(S, L, c, sd) {
  const n = sd > 0 ? 'L' : 'R';
  const sh = S.skel.pos('arm' + n), el = S.skel.pos('fore' + n), wr = S.skel.pos('hand' + n);
  const lg = L.limb * (c.armGirth ?? 1);
  const up = prof([[0, 0.046], [0.07, 0.058], [0.3, 0.05], [0.5, 0.041], [0.56, 0.039], [0.68, 0.043], [0.85, 0.036], [1, 0.03]]);
  const pts = [sh.clone().add(v(-sd * 0.02, 0.035, 0)), sh.clone().add(v(sd * 0.006, -0.05, 0)), el, wr];
  const w = ['chest', ['clav' + n, 1.4], 'arm' + n, 'fore' + n, 'hand' + n];
  const mat = c.sleeveMat ?? (c.sleeve ? 'sleeve' : c.bareArms ? 'skin' : 'top');
  tube(S, mat, w, { pts, seg: 10, steps: 10, r: (u) => [up(u) * lg * (1 + (c.sleevePuff ?? 0) * sstep(0.2, 0.6, u) * sstep(1, 0.7, u)), up(u) * lg * 0.92], cap0: 0.8, ref: v(0, 0, 1) });
  if (c.bareArms && c.sleeveShort) {
    // short sleeve cuff over the upper arm
    tube(S, c.sleeveShort, w, { pts: [pts[0], pts[1], el.clone().lerp(sh, 0.45)], seg: 12, steps: 6, r: (u) => [up(u * 0.3) * lg * 1.18 + 0.004, up(u * 0.3) * lg * 1.12 + 0.004], cap0: 0.8, flat1: false });
  }
  // cuff ring
  if (!c.bareArms && !c.noCuff) tube(S, c.cuffMat ?? mat, ['fore' + n, 'hand' + n], { pts: [wr.clone().lerp(el, 0.12), wr.clone().lerp(el, -0.02)], seg: 10, steps: 1, r: [0.037 * lg, 0.034 * lg], closed: false, flat0: false });
  if (!c.noHand) hand(S, L, c, sd);
}

export function hand(S, L, c, sd) {
  const n = sd > 0 ? 'L' : 'R';
  const wr = S.skel.pos('hand' + n);
  const hl = L.hand, hs = hl / 0.16;
  const mat = c.gloves ? 'glove' : 'skin';
  const g = c.handGirth ?? 1;
  if (c.claws) return claw(S, L, c, sd);
  // palm (thin along x, wide along z)
  blob(S, mat, ['fore' + n, 'hand' + n, ['fing' + n, 1.3], ['thumb' + n, 1.6]], {
    c: wr.clone().add(v(sd * 0.004, -hl * 0.3, 0.002)), r: [0.019 * g * hs, hl * 0.3, 0.036 * g * hs], ws: 10, hs: 6, ol: 0.5,
    fn: (d, p) => { if (d.y < 0) p.z *= 1.05; if (d.x * sd < 0) p.x *= 0.85; },
  });
  // four fingers
  const fw = ['hand' + n, 'fing' + n, 'fingB' + n];
  for (let k = 0; k < 4; k++) {
    const z = (0.024 - k * 0.016) * g * hs;
    const len = hl * [0.46, 0.5, 0.48, 0.38][k];
    const base = wr.clone().add(v(sd * 0.003, -hl * 0.5, z));
    const r0 = 0.0095 * g * hs * (k === 3 ? 0.85 : 1);
    tube(S, mat, fw, { pts: [base.clone().add(v(0, hl * 0.08, 0)), base, base.clone().add(v(-sd * 0.004, -len * 0.55, z * 0.08)), base.clone().add(v(-sd * 0.01, -len, z * 0.12))], seg: 5, steps: 3, capN: 2, ol: 0.35, r: (u) => [r0 * (1 - u * 0.25), r0 * 0.92 * (1 - u * 0.2)], cap1: 1 });
  }
  // thumb
  const tb = wr.clone().add(v(-sd * 0.012, -hl * 0.14, 0.026 * g * hs));
  tube(S, mat, ['hand' + n, 'thumb' + n], { pts: [tb.clone().add(v(sd * 0.006, 0.02, -0.01)), tb, tb.clone().add(v(-sd * 0.008, -hl * 0.22, 0.02)), tb.clone().add(v(-sd * 0.012, -hl * 0.38, 0.034))], seg: 5, steps: 3, capN: 2, ol: 0.35, r: 0.0115 * g * hs, cap1: 1 });
}

function claw(S, L, c, sd) {
  const n = sd > 0 ? 'L' : 'R';
  const wr = S.skel.pos('hand' + n);
  const hl = L.hand;
  blob(S, 'skin', ['fore' + n, 'hand' + n, ['fing' + n, 1.3]], { c: wr.clone().add(v(0, -hl * 0.25, 0)), r: [0.028, hl * 0.3, 0.04], ws: 10, hs: 8 });
  const fw = ['hand' + n, 'fing' + n, 'fingB' + n];
  for (let k = 0; k < 3; k++) {
    const z = 0.026 - k * 0.026;
    const base = wr.clone().add(v(0, -hl * 0.45, z));
    const len = hl * (c.clawLen ?? 0.95);
    tube(S, c.clawMat ?? 'dark', fw, { pts: [base.clone().add(v(0, hl * 0.1, 0)), base, base.clone().add(v(-sd * 0.012, -len * 0.5, z * 0.2 + 0.012)), base.clone().add(v(-sd * 0.045, -len * 0.85, z * 0.3 + 0.035)), base.clone().add(v(-sd * 0.075, -len, z * 0.3 + 0.05))], seg: 6, steps: 8, r: (u) => 0.016 * (1 - u * 0.92), cap0: 0.6 });
  }
  const tb = wr.clone().add(v(-sd * 0.015, -hl * 0.2, 0.03));
  tube(S, c.clawMat ?? 'dark', ['hand' + n, 'thumb' + n], { pts: [tb, tb.clone().add(v(-sd * 0.01, -hl * 0.3, 0.03)), tb.clone().add(v(-sd * 0.03, -hl * 0.6, 0.05))], seg: 6, steps: 4, r: (u) => 0.013 * (1 - u * 0.9), cap0: 0.6 });
}

export function leg(S, L, c, sd) {
  const n = sd > 0 ? 'L' : 'R';
  const hp = S.skel.pos('thigh' + n), kn = S.skel.pos('shin' + n), an = S.skel.pos('foot' + n);
  const lg = L.limb * (c.legGirth ?? 1) * (0.75 + 0.25 * L.bw);
  const loose = c.pantsLoose ?? 0.004;
  const R = prof([[0, 0.078], [0.12, 0.084], [0.3, 0.075], [0.47, 0.056], [0.52, 0.053], [0.64, 0.058], [0.8, 0.047], [0.95, 0.038], [1, 0.036]]);
  const pts = [hp.clone().add(v(-sd * 0.03, 0.07, 0)), hp.clone().add(v(sd * 0.004, -0.06, 0.004)), kn, an];
  const mat = c.legMat ?? 'pants';
  tube(S, mat, [['hips', 1.25], 'thigh' + n, 'shin' + n, ['foot' + n, 1.3]], {
    pts, seg: 12, steps: 11, cap0: 0.8,
    r: (u) => { const r = R(u) * lg + loose * sstep(0.4, 1, u); return [r, r * 1.02]; },
    off: (u) => [0, -0.012 * sstep(0.5, 0.65, u) * sstep(0.9, 0.7, u) * lg],
    shape: (u, a) => 1 + (c.legFolds ?? 0.03) * Math.sin(a * 5 + u * 23) * sstep(0.35, 0.5, u) * sstep(0.62, 0.5, u) + (c.legFolds ?? 0.03) * 0.8 * Math.sin(a * 4 - u * 31) * sstep(0.75, 0.9, u),
  });
  boot(S, L, c, sd);
}

function boot(S, L, c, sd) {
  const n = sd > 0 ? 'L' : 'R';
  const kn = S.skel.pos('shin' + n), an = S.skel.pos('foot' + n), toe = S.skel.pos('toe' + n);
  const lg = L.limb * (c.legGirth ?? 1) * (0.75 + 0.25 * L.bw);
  const mat = c.bootMat ?? 'boots';
  const bh = c.bootH ?? 0.55;       // boot shaft height as a fraction of the shin
  if (bh > 0.05) {
    const top = an.clone().lerp(kn, bh);
    tube(S, mat, ['shin' + n, ['foot' + n, 1.2]], {
      pts: [top.clone().add(v(0, 0.02, 0)), top, an.clone().lerp(top, 0.4), an.clone().add(v(0, -0.02, -0.004))], seg: 12, steps: 5,
      r: (u) => { const r = mix(0.058, 0.046, u) * lg + (u < 0.14 ? 0.008 * (1 - u / 0.14) : 0) + (c.bootCuff ?? 0.004) * sstep(0.2, 0, u); return [r, r * 1.04]; },
      shape: (u, a) => 1 + 0.035 * Math.sin(a * 6 + u * 17) * sstep(0.3, 0.8, u),
    });
  }
  // foot: heel -> toe with a flat sole
  const heel = v(an.x, 0.05, an.z - 0.05), tip = v(toe.x, 0.035, toe.z + 0.06);
  const fr = prof([[0, 0.034], [0.15, 0.043], [0.5, 0.042], [0.78, 0.045], [1, 0.03]]);
  const fh = prof([[0, 0.05], [0.2, 0.058], [0.5, 0.045], [0.8, 0.032], [1, 0.026]]);
  const fs = c.footS ?? 1;
  tube(S, c.shoeMat ?? mat, [['shin' + n, 1.4], 'foot' + n, 'toe' + n], {
    pts: [heel, v(an.x, 0.058, an.z + 0.02), v((an.x + toe.x) / 2, 0.045, toe.z - 0.02), tip], seg: 12, steps: 7, ref: v(0, 1, 0),
    r: (u) => [fr(u) * fs * lg * 1.08, fh(u) * fs],
    off: (u) => [0, 0],
    shape: (u, a) => { const s = Math.sin(a); return s < 0 ? mix(1, 0.72, s * s) : 1; },
    cap0: 0.9, cap1: 0.9,
  });
  // sole
  tube(S, c.soleMat ?? 'sole', ['foot' + n, 'toe' + n], {
    pts: [v(heel.x, 0.012, heel.z - 0.006), v(an.x, 0.012, an.z + 0.02), v(toe.x, 0.012, toe.z), v(tip.x, 0.013, tip.z + 0.004)], seg: 8, steps: 5, capN: 2, ref: v(0, 1, 0),
    r: (u) => [fr(u) * fs * lg * 1.14, 0.013], cap0: 0.9, cap1: 0.9,
  });
}

// ---------------------------------------------------------------------------
// Head: sculpted skull + nose + ears (painted face lives in the skin material)
export function head(S, L, c) {
  const hr = L.hr, HC = L.HC;
  const age = c.age ?? 0, round = c.faceRound ?? 0;
  const W = ['head', ['neck', 1.7], ['jaw', 2.5]];
  blob(S, 'skin', W, {
    c: HC, r: [hr * 0.93 * (1 + round * 0.05), hr * 1.0, hr * 0.97], ws: 26, hs: 18,
    fn: (d, p) => {
      // jaw & chin taper, fuller cheeks, back of the skull, flatter face plane
      const low = sstep(-0.05, -0.95, d.y);
      const fr = sstep(-0.2, 0.8, d.z);
      p.x *= 1 - (0.26 - round * 0.12) * low * (0.6 + 0.4 * fr);
      p.z *= 1 - 0.12 * low * (1 - fr);
      if (d.z > 0) p.z += hr * 0.07 * low * fr * sstep(0.3, 0.9, Math.abs(d.y) < 2 ? 1 - Math.abs(d.x) * 1.3 : 0);
      const ch = Math.exp(-((Math.abs(d.x) - 0.6) ** 2 + (d.y + 0.25) ** 2 + (d.z - 0.7) ** 2) / 0.06);
      p.multiplyScalar(1 + ch * (0.035 + round * 0.04 - age * 0.02));
      const back = sstep(0.1, -0.7, d.z) * sstep(-0.5, 0.3, d.y);
      p.z -= back * hr * 0.1; p.y += back * hr * 0.03;
      if (d.z > 0.4) p.z -= (d.z - 0.4) * hr * 0.08;
      p.y *= d.y > 0 ? 1.02 : 1.0 - low * 0.02;
      // brow ridge
      const br = Math.exp(-((d.y - 0.2) ** 2) / 0.012) * sstep(0.5, 0.9, d.z) * sstep(0.75, 0.2, Math.abs(d.x));
      p.z += br * hr * 0.03;
      // eye sockets: slight flattening where the eyes are painted
      const es = Math.exp(-((Math.abs(d.x) - 0.36) ** 2 / 0.02 + (d.y + 0.0) ** 2 / 0.02)) * sstep(0.5, 0.9, d.z);
      p.z -= es * hr * 0.03;
    },
  });
  // nose
  const nz = HC.z + hr * 0.9, ny = HC.y - hr * 0.3;
  const ns = (c.nose ?? 1) * 0.85 * hr / 0.165;
  tube(S, 'skin', ['head'], { pts: [v(0, ny + 0.035 * ns, nz - 0.02 * ns), v(0, ny + 0.01 * ns, nz + 0.005 * ns), v(0, ny - 0.012 * ns, nz + 0.02 * ns)], seg: 8, steps: 3, capN: 2, ol: 0.15, r: (u) => [mix(0.014, 0.019, u) * ns, mix(0.01, 0.017, u) * ns], cap1: 1, cap0: 0.5, ref: v(0, 0, 1) });
  // ears
  if (!c.noEars) for (const sd of [1, -1]) {
    const ec = v(sd * hr * 0.9, HC.y - hr * 0.1, HC.z - hr * 0.1);
    blob(S, 'skin', ['head'], { c: ec, r: [hr * 0.09, hr * 0.26 * (c.earS ?? 1), hr * 0.17 * (c.earS ?? 1)], ws: 8, hs: 6, ol: 0.4, fn: (d, p) => { if (d.x * sd < 0) p.x *= 0.4; if (d.y > 0.4 && c.pointyEars) p.y += (d.y - 0.4) * hr * 0.4; p.z += -d.y * hr * 0.04; } });
  }
}

// face parameters for the painted-face shader (per type)
export function faceParams(c, L) {
  const kid = c.kid ?? 0, age = c.age ?? 0;
  return {
    center: L.HC.clone(), R: L.hr,
    eye: [0.37 + kid * 0.02, -0.04 - kid * 0.03, (0.18 + kid * 0.03) * (c.eyeW ?? 1), (0.17 + kid * 0.05) * (c.eyeH ?? 1) * (1 - age * 0.18)],
    iris: c.eyeColor ?? 0x3a2a22, lash: c.lashColor ?? 0x1e1410,
    browP: [0.38, 0.27 - kid * 0.03, 0.18, c.browArch ?? 0.5], browT: c.browT ?? (0.028 + age * 0.012), browC: c.browColor ?? c.beard ?? c.hair ?? 0x3a2418,
    mouthY: -0.6 - kid * 0.02, mouthW: c.mouthW ?? 0.17, lipDark: c.lipDark ?? 0,
    blush: c.blush ? 0.8 : 0.15, wrinkles: age, freckles: c.freckles ?? 0, lashT: c.lashT ?? 0.2,
    irisR: c.irisR ?? (0.72 + kid * 0.1), pupil: c.pupil ?? 0.42,
  };
}

// ---------------------------------------------------------------------------
// Hair
function lockPts(root, dir, len, droop, curl, n = 5) {
  const pts = [root.clone()];
  const d = dir.clone().normalize();
  const p = root.clone();
  for (let k = 1; k <= n; k++) {
    d.y -= droop * (1 / n); d.x += curl[0] / n; d.z += curl[1] / n; d.normalize();
    p.addScaledVector(d, len / n); pts.push(p.clone());
  }
  return pts;
}
function lock(S, mat, w, root, dir, len, r0, o = {}) {
  const pts = lockPts(root, dir, len, o.droop ?? 0.6, o.curl ?? [0, 0], 5);
  tube(S, mat, w, { pts, seg: o.seg ?? 5, steps: o.steps ?? 5, capN: 2, r: (u) => { const t = Math.pow(1 - u, o.taper ?? 0.8); return [r0 * t + 0.0015, r0 * t * (o.flat ?? 0.55) + 0.0012]; }, ref: o.ref ?? v(0, 0, 1), cap0: 0.6 });
}
// point on the scalp at direction d (unit, head frame), scaled
function scalp(L, d, k = 1) { const hr = L.hr; return L.HC.clone().add(v(d.x * hr * 0.95 * k, d.y * hr * 1.02 * k, d.z * hr * 0.98 * k)); }

export function hair(S, L, c) {
  const st = c.hairStyle ?? 'short';
  const hr = L.hr, HC = L.HC;
  const W = ['head'];
  if (st === 'bald') {
    // horseshoe fringe around the back
    const pts = [];
    for (let k = 0; k <= 10; k++) { const a = mix(-1.9, 1.9, k / 10) + Math.PI; pts.push(HC.clone().add(v(Math.sin(a) * hr * 0.97, -hr * 0.12 + Math.cos((k / 10) * Math.PI) * 0.0, Math.cos(a) * hr * 0.96))); }
    tube(S, 'hair', W, { pts, seg: 10, steps: 22, r: (u) => [hr * 0.13 * (0.6 + 0.4 * Math.sin(u * Math.PI)), hr * 0.2 * (0.6 + 0.4 * Math.sin(u * Math.PI))], ref: v(0, 1, 0), shape: (u, a) => 1 + 0.12 * Math.sin(a * 3 + u * 40), cap0: 1, cap1: 1 });
    return;
  }
  const hl = { short: 0.5, fringe: 0.55, bun: 0.62, bob: 0.52, long: 0.55, spiky: 0.5 }[st] ?? 0.5;
  const nape = st === 'long' || st === 'bob' ? -0.9 : st === 'bun' ? -0.45 : -0.55;
  const k0 = c.hairVol ?? 1;
  blob(S, 'hair', W, {
    c: HC.clone().add(v(0, hr * 0.02, -hr * 0.03)), r: [hr * 1.02 * k0, hr * 1.06 * k0, hr * 1.06 * k0], ws: 22, hs: 15,
    fn: (d, p) => {
      // hairline: pull inside the skull over the face, around the ears and at the nape
      const face = sstep(0.1, 0.45, d.z) * sstep(hl + 0.08, hl - 0.12, d.y + Math.abs(d.x) * 0.25);
      const ears = sstep(0.55, 0.8, Math.abs(d.x)) * sstep(0.05, -0.2, d.y) * sstep(-0.5, 0.2, d.z);
      const back = sstep(nape + 0.15, nape - 0.05, d.y);
      const hide = Math.max(face, ears * (st === 'long' || st === 'bob' ? 0.2 : 1), back);
      p.multiplyScalar(1 - hide * 0.14);
      // strand grooves radiating from the crown
      const lon = Math.atan2(d.x, d.z);
      const groove = Math.sin(lon * 11 + d.y * 2) * 0.018 + Math.sin(lon * 23 - d.y * 3) * 0.008;
      p.multiplyScalar(1 + groove * sstep(0.95, 0.3, d.y) * (1 - hide));
      if (st === 'bun') p.multiplyScalar(0.985);
      if (st === 'bob' || st === 'long') { p.x *= 1 + 0.08 * sstep(0.3, -0.4, d.y); }
      // center part for tidy styles
      if (st === 'bun' || st === 'long') p.multiplyScalar(1 - 0.03 * Math.exp(-(d.x * d.x) / 0.004) * sstep(0.3, 0.8, d.y) * sstep(-0.3, 0.3, d.z));
    },
  });
  const col = 'hair';
  if (st === 'fringe' || st === 'short' || st === 'spiky') {
    const n = st === 'fringe' ? 7 : 5;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1) - 0.5;
      const root = scalp(L, v(t * 0.9, 0.8, 0.45).normalize(), 1.02);
      const len = hr * (st === 'fringe' ? [0.62, 0.8, 0.7, 0.86, 0.72, 0.78, 0.6][k] : 0.6);
      const sweep = st === 'short' ? 0.35 : 0.12;
      lock(S, col, W, root, v(t * 0.6 + sweep, -0.25, 1), len, hr * 0.13, { droop: 1.5, curl: [t * 0.4, -0.2], flat: 0.5 });
    }
    // side locks by the ears
    for (const sd of [1, -1]) {
      const root = scalp(L, v(sd * 0.75, 0.35, 0.45).normalize(), 1.0);
      lock(S, col, W, root, v(sd * 0.25, -1, 0.35), hr * (st === 'fringe' ? 0.75 : 0.45), hr * 0.12, { droop: 0.3, curl: [sd * -0.1, 0.1] });
    }
    // back tufts
    for (let k = 0; k < 4; k++) {
      const t = k / 3 - 0.5;
      const root = scalp(L, v(t * 0.9, -0.1, -0.9).normalize(), 1.02);
      lock(S, col, W, root, v(t * 0.8, -0.8, -0.6), hr * (st === 'spiky' ? 0.35 : 0.42), hr * 0.14, { droop: -0.3, curl: [t * 0.3, -0.1] });
    }
    if (st === 'spiky') for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const root = scalp(L, v(Math.sin(a) * 0.6, 0.75, Math.cos(a) * 0.6 - 0.1).normalize(), 1.0);
      lock(S, col, W, root, v(Math.sin(a) * 0.7, 0.9, Math.cos(a) * 0.5 - 0.3), hr * 0.42, hr * 0.15, { droop: 0.5, taper: 1.3 });
    }
  }
  if (st === 'bun') {
    const bc = HC.clone().add(v(0, hr * 0.62, -hr * 0.72));
    blob(S, col, W, { c: bc, r: [hr * 0.42, hr * 0.38, hr * 0.4], ws: 16, hs: 12, fn: (d, p) => { const lon = Math.atan2(d.x, d.z); p.multiplyScalar(1 + Math.sin(lon * 3 + d.y * 6) * 0.06); } });
    // binyeo (hairpin)
    tube(S, 'pin', W, { pts: [bc.clone().add(v(-hr * 0.7, hr * 0.05, 0.01)), bc.clone().add(v(hr * 0.75, -hr * 0.06, -0.01))], seg: 6, steps: 3, r: hr * 0.035, cap0: 1, cap1: 1, ref: v(0, 1, 0) });
    blob(S, 'pin', W, { c: bc.clone().add(v(hr * 0.8, -hr * 0.07, -0.01)), r: [hr * 0.08, hr * 0.08, hr * 0.08], ws: 8, hs: 6 });
    // soft wisps at the temples
    for (const sd of [1, -1]) lock(S, col, W, scalp(L, v(sd * 0.8, 0.2, 0.45).normalize()), v(sd * 0.2, -1, 0.2), hr * 0.45, hr * 0.07, { droop: 0.2 });
  }
  if (st === 'bob') {
    sheet(S, col, W, {
      nu: 22, nv: 6, thick: 0.012, hem: true, sides: true,
      fn: (u, vv, out) => { const a = mix(-2.1, 2.1, u) + Math.PI; const y = mix(0.25, -0.95, vv); const r = hr * (1.08 + 0.1 * vv + 0.02 * Math.sin(u * 40)); out.set(HC.x + Math.sin(a) * r * 0.98, HC.y + y * hr, HC.z - hr * 0.02 + Math.cos(a) * r); },
      inside: (p) => v(HC.x, p.y, HC.z - hr * 0.05),
    });
    for (let k = 0; k < 7; k++) {
      const t = k / 6 - 0.5;
      lock(S, col, W, scalp(L, v(t * 0.95, 0.75, 0.5).normalize(), 1.02), v(t * 0.2, -0.6, 1), hr * 0.66, hr * 0.14, { droop: 1.4, flat: 0.45 });
    }
  }
  if (st === 'long') {
    for (let k = 0; k < 5; k++) {
      const t = k / 4 - 0.5;
      lock(S, col, W, scalp(L, v(t * 0.95 + 0.1, 0.8, 0.45).normalize(), 1.02), v(t * 0.4 + 0.25, -0.3, 1), hr * 0.62, hr * 0.12, { droop: 1.4, flat: 0.5 });
    }
    for (const sd of [1, -1]) lock(S, col, W, scalp(L, v(sd * 0.8, 0.3, 0.35).normalize()), v(sd * 0.25, -1, 0.3), hr * 1.3, hr * 0.13, { droop: 0.1, curl: [0, 0.1] });
  }
}
// long back hair panel on chain bones
export function hairBack(S, L, c, chainNames) {
  const hr = L.hr, HC = L.HC;
  const len = c.hairLen ?? 0.42;
  sheet(S, 'hair', ['head', ...chainNames.flat()], {
    nu: 10, nv: 8, thick: 0.016,
    fn: (u, vv, out) => { const a = mix(-1.2, 1.2, u); const y = HC.y + hr * 0.2 - vv * (len + hr * 0.5); const r = hr * (1.02 + 0.06 * vv) + 0.015 * Math.sin(u * 30) * vv; out.set(Math.sin(a) * r * (1 - 0.35 * vv), y, HC.z - hr * 0.1 + -Math.cos(a) * r * (1 - vv * 0.3) - vv * 0.03); },
    inside: (p) => v(0, p.y, HC.z + 0.05),
  });
}

// ---------------------------------------------------------------------------
// Clothing
// wrap skirt / tunic / robe (from the waist down)
export function skirt(S, L, c, mat, o) {
  const [y0, y1] = torsoSpan(L);
  const T = torsoR(L, c);
  const uTop = o.uTop ?? 0.36;
  const ya = mix(y0, y1, uTop), yb = o.bottom;
  const flare = o.flare ?? 1;
  const n = o.folds ?? 9;
  const W = [['hips', o.hipBias ?? 0.55], ['thighL', 1], ['thighR', 1], ['shinL', 1.6], ['shinR', 1.6]];
  sheet(S, mat, W, {
    nu: o.nu ?? 26, nv: o.nv ?? 5, wrap: true, thick: o.thick ?? 0.012,
    fn: (u, vv, out) => {
      const a = u * TAU;
      const y = mix(ya, yb, vv);
      const rx0 = T.rx(uTop) + 0.012, rz0 = T.rz(uTop) + 0.012;
      const e = Math.pow(vv, 0.75);
      const rx = mix(rx0, rx0 * 1.05 + 0.1 * flare, e), rz = mix(rz0, rz0 * 1.1 + 0.1 * flare, e);
      const fold = 1 + 0.06 * vv * Math.sin(a * n + vv * 2.5) + 0.025 * vv * Math.sin(a * n * 2.3 + 1.7);
      const slit = o.slit ? sstep(0.3, 1, vv) * Math.exp(-((a - 0) ** 2) / 0.03) * 0.0 : 0;
      out.set(Math.sin(a) * rx * fold, y, Math.cos(a) * rz * fold + T.oz(uTop) * (1 - vv) - slit);
    },
    inside: (p) => v(0, p.y, 0),
    innerMat: o.innerMat,
  });
  // front surface depth at height y (for layering an apron over the skirt)
  return (y) => {
    const vv = sat01((y - ya) / (yb - ya));
    if (y > ya) return -1;
    const rz0 = T.rz(uTop) + 0.012, e = Math.pow(vv, 0.75);
    return mix(rz0, rz0 * 1.1 + 0.1 * flare, e) * (1 + 0.06 * vv + 0.025 * vv) + T.oz(uTop) * (1 - vv);
  };
}

// belt with buckle and optional pouch
export function belt(S, L, c, mat, uAt = 0.39) {
  const [y0, y1] = torsoSpan(L);
  const T = torsoR(L, c);
  const y = mix(y0, y1, uAt);
  const pts = [];
  for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; pts.push(v(Math.sin(a) * (T.rx(uAt) + 0.018 + (c.skirtOver ? 0.004 : 0)) * supEll(a, 2.2), y - 0.006 * Math.cos(a), Math.cos(a) * (T.rz(uAt) + 0.018) * supEll(a, 2.2) + T.oz(uAt))); }
  tube(S, mat, ['hips', 'spine'], { pts, closed: true, seg: 6, steps: 22, r: [0.008, 0.024], ref: v(0, 1, 0) });
  // buckle
  const fz = T.rz(uAt) + 0.028 + T.oz(uAt);
  tube(S, 'buckle', ['hips', 'spine'], { pts: [v(-0.03, y, fz), v(0.03, y, fz)], seg: 8, steps: 2, r: [0.028, 0.008], ref: v(0, 0, 1), cap0: 0.4, cap1: 0.4 });
  if (c.pouch) blob(S, c.pouchMat ?? mat, ['hips'], { c: v(0.13 * L.bw, y - 0.05, 0.07), r: [0.04, 0.05, 0.03], ws: 10, hs: 8 });
}

// cape/cloak hanging from the shoulders on 3 chains; returns chain specs
export function capeBones(S, L, c) {
  const len = (c.capeLen ?? 0.7);
  const chains = [];
  const sy = L.SY + 0.06;
  const n = 4;
  for (const [ci, a] of [[0, -0.95], [1, 0], [2, 0.95]]) {
    const names = [];
    let parent = 'chest';
    for (let k = 0; k < n; k++) {
      const vv = k / n;
      const p = capeP(L, c, a, vv, len, sy);
      const nm = `cape${ci}_${k}`;
      S.add(nm, parent, p.x, p.y, p.z); names.push(nm); parent = nm;
    }
    const tail = capeP(L, c, a, 1, len, sy);
    chains.push({ names, tail });
  }
  return chains;
}
function capeP(L, c, a, vv, len, sy) {
  const r = mix(0.19 * (0.6 + 0.4 * L.bw), 0.27 * (0.6 + 0.4 * L.bw) * (c.capeFlare ?? 1), Math.pow(vv, 0.8));
  const ang = a * mix(1.05, 1.2, vv) + Math.PI;
  return v(Math.sin(ang) * r * 1.08, sy - vv * len, Math.cos(ang) * r * mix(0.62, 0.95, vv) - 0.03 - vv * 0.03);
}
export function cape(S, L, c, chains, mat, inner) {
  const len = c.capeLen ?? 0.7;
  const sy = L.SY + 0.06;
  const W = ['chest', ...chains.flatMap((ch) => ch.names.map((nm) => [nm, 0.9]))];
  sheet(S, mat, W, {
    nu: 12, nv: 8, thick: 0.014, top: true,
    fn: (u, vv, out) => {
      const a = mix(-1.25, 1.25, u);
      const p = capeP(L, c, a / 1.25 * 0.95 * 1.3, vv, len, sy);
      const fold = 0.012 * Math.sin(u * 20 + vv * 3) * vv;
      out.copy(p).add(v(0, 0, -fold));
      if (c.capeRag) out.y += (Math.sin(u * 37) * 0.5 + 0.5) * 0.08 * sstep(0.85, 1, vv);
    },
    inside: (p) => v(0, p.y, 0.05),
    innerMat: inner,
  });
}

// mantle/capelet over the shoulders
export function mantle(S, L, c, mat, inner) {
  const [y0, y1] = torsoSpan(L);
  const T = torsoR(L, c);
  sheet(S, mat, ['chest', 'neck', ['clavL', 1.2], ['clavR', 1.2], ['armL', 1.6], ['armR', 1.6]], {
    nu: 26, nv: 5, wrap: true, thick: 0.012,
    fn: (u, vv, out) => {
      const a = u * TAU;
      const y = mix(L.NY + 0.02, L.SY - 0.14, vv);
      const uu = sat01((y - y0) / (y1 - y0));
      const se = supEll(a, 2.6);
      const m = mix(0.018, 0.03, vv);
      const rx = Math.max((T.rx(uu) + m) * se, mix(0.07, L.SX + 0.08, Math.pow(vv, 0.5)));
      const rz = Math.max((T.rz(uu) + m) * se + T.oz(uu), mix(0.066, 0.17 * (0.7 + 0.3 * L.bw), Math.pow(vv, 0.55)));
      const f = 1 + 0.035 * vv * Math.sin(a * 9 + 1);
      out.set(Math.sin(a) * rx * f, y - 0.03 * vv * Math.abs(Math.cos(a)) + 0.05 * vv * Math.max(0, Math.cos(a)) ** 2, Math.cos(a) * rz * f - 0.008);
    },
    inside: (p) => v(0, p.y + 0.05, -0.01),
    innerMat: inner,
  });
}

// hood shell (up) around the head with a point at the back
export function hood(S, L, c, mat, inner, W = [['head', 1], ['neck', 1.5], ['chest', 2.2]]) {
  const hr = L.hr, HC = L.HC;
  sheet(S, mat, W, {
    nu: 18, nv: 10, thick: 0.014, top: false, sides: true,
    fn: (u, vv, out) => {
      // u: from front-left edge over the back to front-right edge; v: crown -> shoulders
      const open = mix(0.55, 1.05, sstep(0.05, 0.6, vv)) * sstep(1.02, 0.7, vv) + 0.35 * sstep(0.75, 1, vv);
      const phi = mix(open, TAU - open, u);
      const th = mix(0.05, 2.35, vv);
      let r = hr * mix(1.2, 1.32, vv);
      const tip = sstep(0.35, 0.6, 1 - Math.abs(u - 0.5) * 2) * Math.exp(-((vv - 0.3) ** 2) / 0.02) * hr * 0.35;
      const dx = Math.sin(th) * Math.sin(phi), dy = Math.cos(th), dz = Math.sin(th) * Math.cos(phi);
      out.set(HC.x + dx * r * 0.98, HC.y + hr * 0.1 + dy * r * 1.02 - sstep(0.7, 1, vv) * hr * 0.25, HC.z - hr * 0.06 + dz * r);
      out.z -= tip; out.y += tip * 0.4;
      // lower part widens over the shoulders
      const sh = sstep(0.75, 1, vv);
      out.x *= 1 + sh * 0.35; out.z = mix(out.z, out.z * 1.1 - 0.02, sh);
      out.addScaledVector(v(0, 0, -1), 0.012 * Math.sin(u * 30) * vv);
    },
    inside: (p) => v(HC.x, p.y, HC.z - 0.01),
    innerMat: inner,
  });
}
// hood lowered, bunched behind the neck
export function hoodDown(S, L, c, mat, inner, W = ['neck', 'chest']) {
  const hr = L.hr;
  sheet(S, mat, W, {
    nu: 16, nv: 6, thick: 0.014,
    fn: (u, vv, out) => { const a = mix(-1.9, 1.9, u) + Math.PI; const r = mix(0.085, 0.16, vv) + 0.02 * Math.sin(u * 25) * vv; out.set(Math.sin(a) * r * 1.1, L.NY + 0.04 - vv * 0.2 - 0.03 * Math.cos(u * Math.PI * 2), Math.cos(a) * r - 0.02 - vv * 0.03); },
    inside: (p) => v(0, p.y, 0.02), innerMat: inner,
  });
  void hr;
}

// scarf: thick wrap around the neck + two hanging tails on chains
export function scarfBones(S, L, c) {
  const out = [];
  for (const [ci, sx] of [[0, 0.05], [1, -0.02]]) {
    const names = []; let parent = 'chest';
    const p0 = v(sx, L.NY - 0.005, -0.075);
    for (let k = 0; k < 4; k++) { const nm = `scarf${ci}_${k}`; const p = p0.clone().add(v(ci ? -0.02 * k : 0.012 * k, -k * 0.1, -0.012 * k)); S.add(nm, parent, p.x, p.y, p.z); names.push(nm); parent = nm; }
    out.push({ names, tail: p0.clone().add(v(ci ? -0.08 : 0.05, -0.4, -0.05)) });
  }
  return out;
}
export function scarf(S, L, c, chains) {
  const pts = [];
  const y = L.NY - 0.005;
  for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; pts.push(v(Math.sin(a) * 0.082 * (c.scarfW ?? 1), y + 0.012 * Math.sin(a * 2), Math.cos(a) * 0.075 + 0.004)); }
  tube(S, 'scarf', ['chest', 'neck'], { pts, closed: true, seg: 8, steps: 24, r: [0.032, 0.045], ref: v(0, 1, 0), shape: (u, a) => 1 + 0.12 * Math.sin(u * 50 + a) });
  chains.forEach((ch, i) => {
    const S0 = S.skel;
    const P = [...ch.names.map((n) => S0.pos(n)), ch.tail];
    const curve = new THREE.CatmullRomCurve3(P);
    sheet(S, 'scarf', ['chest', ...ch.names], {
      nu: 2, nv: 7, thick: 0.014, top: true,
      fn: (u, vv, out) => { curve.getPointAt(vv, out); out.x += (u - 0.5) * (0.085 - vv * 0.012); out.z += (i ? 0.004 : -0.004); },
      inside: (p) => v(p.x, p.y, 0),
    });
  });
}

// apron over the front
export function apron(S, L, c, mat, under = null) {
  const [y0, y1] = torsoSpan(L);
  const T = torsoR(L, c);
  sheet(S, mat, [['hips', 0.8], 'spine', 'chest', ['thighL', 1.2], ['thighR', 1.2]], {
    nu: 10, nv: 10, thick: 0.01,
    fn: (u, vv, out) => {
      const y = mix(mix(y0, y1, 0.72), L.H - 0.42, vv);
      const uu = sat01((y - y0) / (y1 - y0));
      const wz = y > y0 ? T.rz(uu) + T.oz(uu) : 0.12;
      const hw = mix(0.1, 0.17, sstep(0.25, 0.4, vv)) * L.bw;
      const a = (u - 0.5) * 2;
      const uz = under ? under(y) : -1;
      const fz = Math.max(wz + 0.016, 0.1 * L.bw + 0.02 * vv, uz + 0.014) + 0.004;
      const x = a * hw;
      out.set(x, y, fz - (x * x) / (2 * Math.max(0.13, fz * 0.9)) + 0.012 * vv * vv);
    },
    inside: () => v(0, L.H, -0.1),
  });
}
const sat01 = (x) => Math.min(1, Math.max(0, x));

// vest (open front) over the torso
export function vest(S, L, c, mat) {
  const [y0, y1] = torsoSpan(L);
  const T = torsoR(L, c);
  sheet(S, mat, ['hips', 'spine', 'chest', ['armL', 2], ['armR', 2]], {
    nu: 26, nv: 8, thick: 0.012, sides: true,
    fn: (u, vv, out) => { const a = mix(0.35, TAU - 0.35, u); const uu = mix(0.9, 0.38, vv); const s = supEll(a, 2.4) * 1.0; out.set(Math.sin(a) * (T.rx(uu) + 0.012) * s, mix(y0, y1, uu), Math.cos(a) * (T.rz(uu) + 0.014) * s + T.oz(uu)); },
    inside: (p) => v(0, p.y, 0),
  });
}

// satchel on the hip with a strap across the chest
export function satchel(S, L, c) {
  const [y0, y1] = torsoSpan(L);
  const T = torsoR(L, c);
  const x = -0.17 * L.bw, y = L.H + 0.02;
  blob(S, 'satchel', ['hips', ['thighR', 1.6]], { c: v(x - 0.02, y, 0.02), r: [0.04, 0.08, 0.1], ws: 12, hs: 8, fn: (d, p) => { p.y *= d.y > 0 ? 0.9 : 1; p.x *= 1 + 0.2 * Math.max(0, d.x * -1); } });
  const pts = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    const a = mix(-1.1, 2.3, t);
    const yy = mix(y + 0.06, L.NY - 0.02, Math.sin(t * Math.PI * 0.5));
    const uu = sat01((yy - y0) / (y1 - y0));
    pts.push(v(Math.sin(a) * (T.rx(uu) + 0.016), yy, Math.cos(a) * (T.rz(uu) + 0.018) + T.oz(uu)));
  }
  tube(S, 'strap', ['hips', 'spine', 'chest'], { pts, seg: 6, steps: 20, r: [0.004, 0.016], ref: (u) => v(0, 1, 0) });
  void x;
}

// beard / mustache
export function beard(S, L, c) {
  const hr = L.hr, HC = L.HC;
  const bl = c.beardLen ?? 1;
  blob(S, 'beard', [['head', 1], ['jaw', 0.6]], {
    c: HC.clone().add(v(0, -hr * 0.78, hr * 0.42)), r: [hr * 0.66, hr * 0.62 * bl, hr * 0.5], ws: 16, hs: 12,
    fn: (d, p) => {
      if (d.y < 0) { p.y *= 1.4; p.x *= 1 - 0.45 * Math.min(1, -d.y); p.z += -d.y * hr * 0.25; }
      if (d.z < -0.2) p.z *= 0.6;
      const lon = Math.atan2(d.x, d.z);
      p.multiplyScalar(1 + 0.05 * Math.sin(lon * 9 + d.y * 4));
      if (d.y > 0.5 && d.z > 0) p.y -= hr * 0.12;   // leave room for the mouth
    },
  });
}
export function mustache(S, L, c) {
  const hr = L.hr, HC = L.HC;
  for (const sd of [1, -1]) {
    const r0 = HC.clone().add(v(0, -hr * 0.37, hr * 0.95));
    tube(S, 'beard', ['head'], { pts: [r0.clone().add(v(sd * 0.004, 0, 0)), r0.clone().add(v(sd * hr * 0.3, -hr * 0.06, -hr * 0.04)), r0.clone().add(v(sd * hr * 0.55, -hr * 0.22, -hr * 0.18))], seg: 8, steps: 7, r: (u) => [hr * 0.1 * (1 - u * 0.75), hr * 0.07 * (1 - u * 0.6)], ref: v(0, 1, 0), cap0: 0.8, cap1: 1 });
  }
}
export function bushyBrows(S, L, c) {
  const hr = L.hr, HC = L.HC;
  for (const sd of [1, -1]) {
    const r0 = HC.clone().add(v(sd * hr * 0.14, hr * 0.28, hr * 0.94));
    tube(S, 'beard', ['head'], { pts: [r0, r0.clone().add(v(sd * hr * 0.25, hr * 0.03, -hr * 0.06)), r0.clone().add(v(sd * hr * 0.46, -hr * 0.05, -hr * 0.2))], seg: 7, steps: 6, r: (u) => [hr * 0.06 * (1 - u * 0.4), hr * 0.045], ref: v(0, 1, 0), cap0: 1, cap1: 1, shape: (u, a) => 1 + 0.2 * Math.sin(a * 3 + u * 20) });
  }
}

// glasses (round frames)
export function glasses(S, L, c) {
  const hr = L.hr, HC = L.HC;
  for (const sd of [1, -1]) {
    const cc = HC.clone().add(v(sd * hr * 0.35, -hr * 0.0, hr * 1.02));
    const pts = [];
    for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; pts.push(cc.clone().add(v(Math.cos(a) * hr * 0.22, Math.sin(a) * hr * 0.2, -Math.abs(Math.cos(a)) * hr * 0.03 * (Math.cos(a) * sd > 0 ? 1.6 : 0.3)))); }
    tube(S, 'frame', ['head'], { pts, closed: true, seg: 5, steps: 24, r: hr * 0.024, ref: v(0, 0, 1), ol: 0.1 });
    // temple arm
    tube(S, 'frame', ['head'], { pts: [cc.clone().add(v(sd * hr * 0.22, 0, -hr * 0.03)), v(sd * hr * 0.93, HC.y + hr * 0.02, HC.z + hr * 0.2), v(sd * hr * 0.95, HC.y - hr * 0.05, HC.z - hr * 0.3)], seg: 4, steps: 6, r: hr * 0.017, ol: 0.1 });
  }
  tube(S, 'frame', ['head'], { pts: [HC.clone().add(v(-hr * 0.13, hr * 0.02, hr * 1.03)), HC.clone().add(v(0, hr * 0.06, hr * 1.06)), HC.clone().add(v(hr * 0.13, hr * 0.02, hr * 1.03))], seg: 4, steps: 5, r: hr * 0.018, ol: 0.1 });
}

// ---------------------------------------------------------------------------
// Hats (bound to the head)
export function hat(S, L, c, kind) {
  const hr = L.hr, HC = L.HC;
  const W = ['head'];
  if (kind === 'witch') {
    const by = HC.y + hr * 0.62;
    // wavy drooping brim
    sheet(S, 'hat', W, {
      nu: 40, nv: 4, wrap: true, thick: 0.012,
      fn: (u, vv, out) => { const a = u * TAU; const r = mix(hr * 0.98, hr * 2.25, vv); const droop = vv * vv * hr * 0.25 * (0.6 + 0.4 * Math.sin(a * 3 + 1)); out.set(Math.sin(a) * r, by - droop - Math.cos(a) * vv * hr * 0.12, HC.z - 0.01 + Math.cos(a) * r); },
      inside: (p) => v(p.x, p.y - 1, p.z),
    });
    // bent crumpled cone
    const pts = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push(v(0, by + t * hr * 3.4 - t * t * hr * 0.5, HC.z - 0.01 - t * t * hr * 1.5)); }
    tube(S, 'hat', W, { pts, seg: 16, steps: 16, r: (u) => { const r = hr * 1.02 * Math.pow(1 - u, 0.9) + 0.004; return [r, r]; }, shape: (u, a) => 1 + 0.06 * Math.sin(a * 5 + u * 9) * sstep(0.2, 0.7, u), flat0: true, cap1: 0.5, ref: v(0, 0, 1) });
    tube(S, 'hatBand', W, { pts: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const a = (k / 8) * TAU; return v(Math.sin(a) * hr * 1.0, by + hr * 0.14, HC.z - 0.01 + Math.cos(a) * hr * 1.0); }), closed: true, seg: 6, steps: 24, r: [0.006, hr * 0.12], ref: v(0, 1, 0) });
  } else if (kind === 'cap') {
    blob(S, 'hat', W, { c: HC.clone().add(v(0, hr * 0.28, -hr * 0.02)), r: [hr * 1.1, hr * 0.85, hr * 1.12], ws: 20, hs: 12, skip: (d) => d.y < -0.05, fn: (d, p) => { const lon = Math.atan2(d.x, d.z); p.multiplyScalar(1 + 0.015 * Math.sin(lon * 6) * (1 - d.y)); } });
    sheet(S, 'hat', W, { nu: 12, nv: 3, thick: 0.01, fn: (u, vv, out) => { const a = mix(-1.1, 1.1, u); const r = mix(hr * 1.08, hr * 1.75, vv); out.set(Math.sin(a) * r, HC.y + hr * 0.26 - vv * hr * 0.12, HC.z - hr * 0.02 + Math.cos(a) * r * 0.95); }, inside: (p) => v(p.x, p.y - 1, p.z) });
    blob(S, 'hat', W, { c: HC.clone().add(v(0, hr * 1.1, -hr * 0.02)), r: [hr * 0.12, hr * 0.08, hr * 0.12], ws: 8, hs: 6 });
  } else if (kind === 'scarf') {
    blob(S, 'hat', W, { c: HC.clone().add(v(0, hr * 0.14, -hr * 0.06)), r: [hr * 1.14, hr * 1.1, hr * 1.14], ws: 24, hs: 16, skip: (d) => d.z > 0.3 && d.y < 0.5 - Math.abs(d.x) * 0.3, fn: (d, p) => { const lon = Math.atan2(d.x, d.z); p.multiplyScalar(1 + 0.03 * Math.sin(lon * 7 + d.y * 5)); if (d.y < -0.3) p.multiplyScalar(0.94); } });
    // rim roll around the face opening
    const pts = [];
    for (let k = 0; k < 14; k++) { const a = mix(-1.35, 1.35, k / 13); pts.push(HC.clone().add(v(Math.sin(a) * hr * 1.05, hr * 0.5 * Math.cos(a) - hr * 0.08 + (Math.abs(a) > 1 ? -hr * 0.4 * (Math.abs(a) - 1) : 0), hr * 0.32 + Math.cos(a) * hr * 0.5))); }
    tube(S, 'hatBand', W, { pts, seg: 8, steps: 26, r: hr * 0.1, cap0: 1, cap1: 1 });
    // knot at the back
    blob(S, 'hat', W, { c: HC.clone().add(v(0, -hr * 0.15, -hr * 1.12)), r: [hr * 0.3, hr * 0.22, hr * 0.2], ws: 10, hs: 8 });
    for (const sd of [1, -1]) lock(S, 'hat', W, HC.clone().add(v(sd * hr * 0.1, -hr * 0.25, -hr * 1.15)), v(sd * 0.4, -1, -0.3), hr * 0.8, hr * 0.14, { flat: 0.3, droop: 0.2, taper: 0.4 });
  } else if (kind === 'helmet') {
    blob(S, 'metal', W, {
      c: HC.clone().add(v(0, hr * 0.12, -hr * 0.02)), r: [hr * 1.14, hr * 1.18, hr * 1.2], ws: 26, hs: 18,
      fn: (d, p) => {
        // crest ridge, flared neck guard, cheek plates
        p.multiplyScalar(1 + 0.06 * Math.exp(-(d.x * d.x) / 0.01) * sstep(-0.2, 0.5, d.y));
        if (d.y < -0.2) { p.x *= 1 + 0.12 * sstep(-0.2, -0.9, d.y); p.z *= 1 + 0.12 * sstep(-0.2, -0.9, d.y) * (d.z < 0 ? 1 : 0.4); }
        // visor slit indentation
        if (d.z > 0.4) p.z -= hr * 0.08 * Math.exp(-((d.y - 0.02) ** 2) / 0.004);
      },
    });
    // visor slit (dark) and a rim band
    tube(S, 'visor', W, { pts: [HC.clone().add(v(-hr * 0.62, hr * 0.12, hr * 0.95)), HC.clone().add(v(0, hr * 0.14, hr * 1.14)), HC.clone().add(v(hr * 0.62, hr * 0.12, hr * 0.95))], seg: 6, steps: 10, r: [hr * 0.035, hr * 0.02], ref: v(0, 0, 1) });
    const pts = [];
    for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; pts.push(HC.clone().add(v(Math.sin(a) * hr * 1.22, -hr * 0.5 - hr * 0.1 * Math.cos(a), Math.cos(a) * hr * 1.24 - hr * 0.02))); }
    tube(S, 'trim', W, { pts, closed: true, seg: 6, steps: 32, r: hr * 0.05, ref: v(0, 1, 0) });
  }
}
// plume chain (helmet feather)
export function plumeBones(S, L) {
  const hr = L.hr, HC = L.HC;
  const names = []; let parent = 'head';
  const p0 = HC.clone().add(v(0, hr * 1.25, -hr * 0.1));
  for (let k = 0; k < 4; k++) { const nm = 'plume' + k; const p = p0.clone().add(v(0, k * hr * 0.1 - k * k * hr * 0.03, -k * hr * 0.42)); S.add(nm, parent, p.x, p.y, p.z); names.push(nm); parent = nm; }
  return [{ names, tail: p0.clone().add(v(0, -hr * 0.9, -hr * 1.9)) }];
}
export function plume(S, L, ch) {
  const P = [...ch.names.map((n) => S.skel.pos(n)), ch.tail];
  const hr = L.hr;
  tube(S, 'plume', ['head', ...ch.names], { pts: P, seg: 10, steps: 16, r: (u) => [hr * (0.12 + 0.25 * Math.sin(Math.min(1, u * 1.3) * Math.PI) * (1 - u * 0.4)) + 0.004, hr * 0.12 * (1 - u * 0.5) + 0.004], ref: v(1, 0, 0), shape: (u, a) => 1 + 0.12 * Math.sin(a * 2) + 0.1 * Math.sin(u * 60 + a * 3), cap0: 1, cap1: 1 });
}

// ---------------------------------------------------------------------------
// Armor (rigid plates on bones)
export function armor(S, L, c) {
  const [y0, y1] = torsoSpan(L);
  const T = torsoR(L, c);
  // breastplate
  tube(S, 'metal', ['spine', 'chest', ['hips', 1.6]], {
    curve: new THREE.CatmullRomCurve3([v(0, mix(y0, y1, 0.34), 0.004), v(0, mix(y0, y1, 0.62), 0.01), v(0, mix(y0, y1, 0.9), 0.0)]), seg: 22, steps: 10,
    r: (u) => { const uu = mix(0.34, 0.9, u); return [T.rx(uu) + 0.022, T.rz(uu) + 0.026]; }, off: (u) => [0, T.oz(mix(0.34, 0.9, u))],
    shape: (u, a) => supEll(a, 2.4) * (1 + 0.06 * Math.exp(-((a - Math.PI / 2) ** 2) / 0.05) * Math.sin(u * Math.PI)),
  });
  // faulds (hip plates)
  sheet(S, 'metal', ['hips', ['thighL', 1.3], ['thighR', 1.3]], {
    nu: 28, nv: 3, wrap: true, thick: 0.014,
    fn: (u, vv, out) => { const a = u * TAU; const uu = 0.34; const rx = T.rx(uu) + 0.03 + vv * 0.05, rz = T.rz(uu) + 0.03 + vv * 0.05; out.set(Math.sin(a) * rx, mix(y0, y1, uu) - vv * 0.16 - (Math.floor(vv * 3) * 0.0), Math.cos(a) * rz + T.oz(uu)); },
    inside: (p) => v(0, p.y, 0),
  });
  // pauldrons
  for (const sd of [1, -1]) {
    const n = sd > 0 ? 'L' : 'R';
    const sp = S.skel.pos('arm' + n);
    for (let k = 0; k < 3; k++) {
      blob(S, 'metal', ['arm' + n, ['clav' + n, 1.3]], { c: sp.clone().add(v(sd * (0.02 + k * 0.012), 0.025 - k * 0.045, 0)), r: [0.085 + k * 0.005, 0.06, 0.085], ws: 14, hs: 8, skip: (d) => d.y < -0.35 || d.x * sd < -0.55, inward: false });
    }
  }
  // gauntlet cuffs & greaves
  for (const sd of [1, -1]) {
    const n = sd > 0 ? 'L' : 'R';
    const el = S.skel.pos('fore' + n), wr = S.skel.pos('hand' + n);
    tube(S, 'metal', ['fore' + n], { pts: [el.clone().lerp(wr, 0.25), wr.clone().lerp(el, -0.05)], seg: 12, steps: 3, r: (u) => [mix(0.05, 0.058, u), mix(0.05, 0.056, u)], cap0: 0.3, cap1: 0.3 });
    const kn = S.skel.pos('shin' + n), an = S.skel.pos('foot' + n);
    tube(S, 'metal', ['shin' + n], { pts: [kn.clone().add(v(0, 0.02, 0.01)), an.clone().lerp(kn, 0.35)], seg: 12, steps: 4, r: (u) => [mix(0.068, 0.058, u), mix(0.07, 0.06, u)], off: (u) => [0, 0.006], cap0: 0.4 });
    blob(S, 'metal', ['shin' + n, ['thigh' + n, 1.3]], { c: kn.clone().add(v(0, 0.01, 0.045)), r: [0.05, 0.05, 0.035], ws: 10, hs: 8 });
  }
}

// ---------------------------------------------------------------------------
// Rigid props (plain meshes attached to bones)
// one vertex-colored geometry (colors: key -> hex)
export function rigidGeo(build, colors = {}) {
  const S0 = new SkelDef(); S0.add('r', null, 0, 0, 0); S0.finalize();
  const S = new Sculpt(S0);
  build(S);
  const { geo } = S.build({ color: (k) => colors[k] ?? 0xffffff, group: () => 'm' });
  geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight');
  geo.clearGroups();
  return geo;
}
// staff along +Z of the hand (grip at origin): carved shaft, spiral crook cradling a gem
export const STAFF = { len: 1.72, below: 0.82 };
export function staffGeo(o = {}) {
  const len = o.len ?? STAFF.len, below = o.below ?? STAFF.below;
  return rigidGeo((S) => {
    const z0 = -below, z1 = len - below;
    tube(S, 'wood', 'r', { pts: [v(0, 0, z0), v(0.004, 0.003, (z0 + z1) / 2), v(0, 0, z1 - 0.1)], seg: 8, steps: 18, ref: v(0, 1, 0), r: (u) => { const r = mix(0.02, 0.026, u) * (1 + 0.1 * Math.sin(u * 70) * sstep(0.2, 0.3, u) * sstep(0.44, 0.34, u)); return [r, r]; }, shape: (u, a) => 1 + 0.06 * vnoise3(u * 30, Math.cos(a) * 2, Math.sin(a) * 2), cap0: 0.6 });
    // grip wrap
    tube(S, 'wrap', 'r', { pts: [v(0, 0, -0.1), v(0, 0, 0.12)], seg: 8, steps: 8, ref: v(0, 1, 0), r: 0.029, shape: (u, a) => 1 + 0.12 * Math.abs(Math.sin(u * 25 + a * 0.5)) });
    // spiral crook around the gem
    const pts = [];
    const cz = z1 + 0.02;
    for (let k = 0; k <= 16; k++) { const t = k / 16; const a = t * Math.PI * 1.75 - 0.4; const r = mix(0.11, 0.06, t); pts.push(v(Math.sin(a) * r * 0.55, Math.cos(a) * r, cz + (1 - Math.cos(a)) * 0.05 + t * 0.02 - 0.1 * (1 - t) * (1 - t))); }
    pts.unshift(v(0, 0, z1 - 0.14));
    tube(S, 'wood', 'r', { pts, seg: 8, steps: 30, ref: v(1, 0, 0), r: (u) => { const r = mix(0.026, 0.012, u); return [r, r * 0.9]; }, cap1: 1 });
    // carved leaves at the collar
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      tube(S, 'leaf', 'r', { pts: [v(Math.cos(a) * 0.02, Math.sin(a) * 0.02, z1 - 0.14), v(Math.cos(a) * 0.045, Math.sin(a) * 0.045, z1 - 0.06), v(Math.cos(a) * 0.035, Math.sin(a) * 0.035, z1 + 0.0)], seg: 5, steps: 5, r: (u) => [0.016 * Math.sin(u * Math.PI) + 0.002, 0.004], ref: v(Math.cos(a), Math.sin(a), 0) });
    }
    tube(S, 'band', 'r', { pts: [v(0, 0, z1 - 0.19), v(0, 0, z1 - 0.15)], seg: 10, steps: 2, ref: v(0, 1, 0), r: 0.031 });
  }, { wood: 0x7a5436, wrap: 0x8a3a30, leaf: 0xc8a050, band: 0xc8a050 });
}
export function gemGeo() {
  // elongated faceted crystal
  const g = new THREE.OctahedronGeometry(0.06, 0);
  g.scale(0.85, 1.5, 0.85);   // long axis along Y (the rig tilts it onto the staff; player spins it about Y)
  g.translate(0, 0, 0);
  return g.index ? g.toNonIndexed() : g;
}
