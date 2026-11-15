// Sculpted, skinned humanoid bodies: skeleton layout, anatomy (torso, raglan
// shoulders, fingered hands, sculpted head), hair built from tapered locks,
// layered clothing with trims and fastenings, hats and props. Geometry is built
// once per character type (CHAR entry) and shared by all instances; see
// characters.js for the animation rig.
import * as THREE from 'three';
import { SkelDef, Sculpt, tube, blob, sheet, prof, sstep, mix, TAU, vnoise3 } from './charkit.js';

const V3 = THREE.Vector3;
const v = (x, y, z) => new V3(x, y, z);
const sat01 = (x) => Math.min(1, Math.max(0, x));
const bump = (x, c, w) => Math.exp(-((x - c) * (x - c)) / (w * w));
const _t = new V3();

// ---------------------------------------------------------------------------
// Layout: joint positions (body space, unscaled; character faces +Z, its left is +X)
export function layout(c) {
  const bw = c.bodyW ?? 1, legLen = c.legLen ?? 0.84, H = legLen + 0.06;
  const tl = c.torsoLen ?? 1, hr = c.headR ?? 0.158, al = c.armLen ?? 1.04;
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
// Torso
const supEll = (a, n) => { const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)); return 1 / Math.pow(Math.pow(c, n) + Math.pow(s, n), 1 / n); };

// half widths (rx), half depths (rz) and forward offset (oz) along the torso, u = 0 (crotch) .. 1 (neck)
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
const TR = (L, c) => L._T || (L._T = torsoR(L, c));

// cross-section shape at garment angle g (0 = front, + towards the character's left)
function tK(L, u, g) {
  let m = supEll(g, mix(2.1, 2.6, sstep(0.45, 0.8, u)));
  const cz = Math.cos(g);
  if (cz < 0) m *= 1 - 0.05 * sstep(0.5, 0.8, u);                    // flatter back
  else if (L.fem) m *= 1 + L.fem * 0.07 * cz * cz * bump(u, 0.7, 0.085);   // bust
  return m;
}
// point on the torso surface, `m` metres off it
export function torsoPt(L, c, u, g, m = 0, out = new V3()) {
  const T = TR(L, c), [y0, y1] = torsoSpan(L);
  const k = tK(L, u, g);
  return out.set(Math.sin(g) * (T.rx(u) + m) * k, mix(y0, y1, u), Math.cos(g) * (T.rz(u) + m) * k + T.oz(u));
}
// closed loop around the torso; dy(g) shifts u per angle (dipping belts, V lines)
function girdle(L, c, u, m, n = 28, dy = null) {
  const pts = [];
  for (let k = 0; k < n; k++) { const g = (k / n) * TAU; pts.push(torsoPt(L, c, u + (dy ? dy(g) : 0), g, m)); }
  return pts;
}
// flat band along a path: t = thickness off the surface, w = half width along `ref`
function band(S, mat, W, pts, o = {}) {
  return tube(S, mat, W, { pts, closed: o.closed ?? true, seg: o.seg ?? 4, steps: o.steps ?? Math.max(8, pts.length), r: [o.t ?? 0.004, o.w ?? 0.012], ref: o.ref ?? v(0, 1, 0), flat0: o.closed === false, flat1: o.closed === false, ol: o.ol, shade: o.shade, shape: o.shape });
}
// small domed stud (button, rivet, gem) sitting on a surface with outward normal n
function stud(S, mat, W, p, n, r, o = {}) {
  const q = new THREE.Quaternion().setFromUnitVectors(v(0, 0, 1), _t.copy(n).normalize());
  const k = o.flat ?? 0.5;
  return blob(S, mat, W, { c: p, r: [r, r, r], ws: o.ws ?? 8, hs: o.hs ?? 6, ol: o.ol ?? 0.3, fn: (d, pp) => { pp.set(d.x * r, d.y * r, d.z * r * k).applyQuaternion(q); }, inside: () => p });
}
// a sub-curve helper: Catmull-Rom through pts restricted to [a, b]
function sub(pts, a, b) {
  const full = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const out = [];
  for (let k = 0; k <= 8; k++) out.push(full.getPointAt(mix(a, b, k / 8)));
  return new THREE.CatmullRomCurve3(out, false, 'centripetal');
}

export function body(S, L, c, M = {}) {
  const [y0, y1] = torsoSpan(L);
  const T = TR(L, c);
  const TW = ['hips', 'spine', 'chest', 'neck', ['armL', 2.2], ['armR', 2.2]];
  const pts = [v(0, y0, 0), v(0, (y0 + y1) / 2, 0.004), v(0, y1, -0.004)];
  const lower = c.lower ?? 'pants';
  const HPI = Math.PI / 2;
  // pelvis (trousers / skirt base)
  tube(S, M.pelvis ?? lower, TW, { curve: sub(pts, 0, 0.42), seg: 24, steps: 7, ref: v(0, 0, 1), r: (u) => [T.rx(u * 0.42) + 0.002, T.rz(u * 0.42) + 0.002], off: (u) => [0, T.oz(u * 0.42)], shape: (u, a) => tK(L, u * 0.42, HPI - a), cap0: 0.9 });
  // torso (shirt): drape wrinkles gather towards the waist
  const fold = c.topFolds ?? 0.012;
  const wk = (u, a) => (Math.sin(a * 6 + u * 9) + 0.5 * Math.sin(a * 11 - u * 5)) * sstep(0.5, 0.08, u);
  tube(S, M.top ?? 'top', TW, {
    seg: 28, steps: 16, ref: v(0, 0, 1), curve: sub(pts, 0.3, 1),
    r: (u) => { const uu = mix(0.3, 1, u); return [T.rx(uu) + 0.006 * (1 - u), T.rz(uu) + 0.006 * (1 - u)]; },
    off: (u) => [0, T.oz(mix(0.3, 1, u))], shape: (u, a) => tK(L, mix(0.3, 1, u), HPI - a) * (1 + fold * wk(u, a)),
    shade: (u, a) => 1 - 3.5 * fold * Math.max(0, -wk(u, a)),
  });
  // neck: flares into the trapezius, slips up inside the skull
  const nw = 0.047 * (c.neckW ?? 1) * mix(1, L.hr / 0.158, 0.5);
  tube(S, 'skin', ['chest', 'neck', ['head', 1.4]], { pts: [v(0, L.NY - 0.05, -0.008), v(0, L.NY + 0.005, -0.004), v(0, L.HY + 0.02, 0.004), v(0, L.HC.y - L.hr * 0.42, L.HC.z * 0.5)], seg: 16, steps: 8, r: (u) => [nw * (1 + 0.32 * sstep(0.35, 0, u)), nw * (0.94 + 0.12 * sstep(0.35, 0, u))] });
  for (const sd of [1, -1]) arm(S, L, c, sd);
  for (const sd of [1, -1]) leg(S, L, c, sd);
}

// ---------------------------------------------------------------------------
// Arms: one tube from the base of the neck over the shoulder to the wrist, so the
// trapezius, deltoid and sleeve are a single surface (a raglan sleeve)
const ARM_R = prof([[0, 0.028], [0.1, 0.038], [0.2, 0.046], [0.32, 0.044], [0.48, 0.039], [0.6, 0.034], [0.7, 0.037], [0.88, 0.029], [1, 0.0255]]);
export function arm(S, L, c, sd) {
  const n = sd > 0 ? 'L' : 'R';
  const sh = S.skel.pos('arm' + n), el = S.skel.pos('fore' + n), wr = S.skel.pos('hand' + n);
  const lg = L.limb * (c.armGirth ?? 1);
  const bare = !!c.bareArms;
  const mat = c.sleeveMat ?? (c.sleeve ? 'sleeve' : bare ? 'skin' : 'top');
  const pts = [v(sd * L.SX * 0.36, sh.y + 0.04, sh.z - 0.004), v(sh.x - sd * 0.024, sh.y + 0.014, sh.z), v(sh.x + sd * 0.012, sh.y - 0.07, sh.z + 0.002), el, wr];
  const w = ['chest', ['clav' + n, 1.4], 'arm' + n, 'fore' + n, 'hand' + n];
  const f = bare ? 0 : (c.sleeveFolds ?? 0.05), puff = c.sleevePuff ?? 0;
  // creases at the elbow and where the sleeve bunches above the cuff
  const wk = (u, a) => Math.sin(a * 2 + u * 46) * bump(u, 0.6, 0.07) + 0.7 * Math.sin(a * 3 - u * 62) * sstep(0.76, 0.9, u);
  const R = (u) => ARM_R(u) * lg * (1 + puff * bump(u, 0.3, 0.13)) + (bare ? 0 : 0.003 * sstep(0.3, 0.6, u));
  tube(S, mat, w, { pts, seg: 16, steps: 24, cap0: 0.8, ref: v(0, 0, 1), r: (u) => { const r = R(u); return [r, r * 0.95]; }, shape: f ? (u, a) => 1 + f * wk(u, a) : null, shade: f ? (u, a) => 1 - 2.4 * f * Math.max(0, -wk(u, a)) : null });
  const fw = ['fore' + n, ['hand' + n, 1.5]];
  const along = (k) => wr.clone().lerp(el, k);
  if (bare && c.sleeveShort) {
    // short sleeve over the shoulder with a turned hem
    const e = el.clone().lerp(sh, 0.5);
    tube(S, c.sleeveShort, w, { pts: [pts[0], pts[1], pts[2], e], seg: 16, steps: 10, cap0: 0.8, ref: v(0, 0, 1), r: (u) => { const r = ARM_R(u * 0.44) * lg * 1.12 + 0.005 + 0.004 * sstep(0.7, 1, u); return [r, r * 0.97]; } });
    band(S, c.sleeveHem ?? c.sleeveShort, ['arm' + n], [e.clone().add(v(0, 0.012, 0)), e.clone().add(v(0, -0.012, 0))], { closed: false, seg: 16, steps: 2, t: ARM_R(0.44) * lg * 1.12 + 0.013, w: ARM_R(0.44) * lg * 1.1 + 0.013, ref: v(0, 0, 1), shade: () => 0.86 });
  }
  if (c.sleeveFlare) {
    // bell sleeve with a lining, hanging open below the wrist
    const sp = [along(0.8), along(0.3), along(-0.25)];
    const rr = (u) => mix(0.045, 0.095, u * u) * lg, sf = (u, a) => 1 + 0.07 * Math.sin(a * 5 + 1) * u;
    tube(S, 'sleeve', fw, { pts: sp, seg: 20, steps: 8, r: (u) => [rr(u), rr(u) * 0.92], shape: sf, off: (u) => [0, -0.02 * u * u], shade: (u, a) => 1 - 0.12 * u * Math.max(0, -Math.sin(a * 5 + 1)) });
    tube(S, 'sleeveIn', fw, { pts: sp, seg: 20, steps: 8, r: (u) => [rr(u) - 0.005, rr(u) * 0.92 - 0.005], shape: sf, off: (u) => [0, -0.02 * u * u], inward: true, ol: 0 });
    band(S, c.sleeveTrim ?? 'trim', fw, ringAt(sp[2], v(0, -1, 0), 0.094 * lg, 0.094 * lg * 0.92, 20, (a) => 1 + 0.07 * Math.sin(a * 5 + 1), v(0, 0, -0.02)), { t: 0.004, w: 0.008, ref: v(0, 1, 0) });
  } else if (!bare && !c.noCuff) {
    const kind = c.cuff ?? 'band';
    const r0 = R(1) + 0.006;
    if (kind === 'fold') {
      // turned-back cuff, wider at its open edge, with a button
      tube(S, c.cuffMat ?? 'cuff', fw, { pts: [along(0.3), along(0.0)], seg: 16, steps: 3, r: (u) => [r0 + 0.012 * (1 - u), (r0 + 0.012 * (1 - u)) * 0.95], flat0: true, ref: v(0, 0, 1) });
      stud(S, 'button', fw, along(0.14).add(v(sd * (r0 + 0.007), 0, 0)), v(sd, 0, 0), 0.007);
    } else if (kind === 'frill') {
      tube(S, c.cuffMat ?? 'cuff', fw, { pts: [along(0.16), along(-0.1)], seg: 24, steps: 3, r: (u) => [r0 + 0.02 * u, r0 + 0.02 * u], shape: (u, a) => 1 + 0.14 * u * Math.sin(a * 9), ref: v(0, 0, 1) });
      band(S, c.cuffMat ?? 'cuff', fw, [along(0.2), along(0.13)], { closed: false, seg: 16, steps: 1, t: r0 + 0.003, w: r0 + 0.002, ref: v(0, 0, 1) });
    } else band(S, c.cuffMat ?? 'cuff', fw, [along(0.16), along(-0.01)], { closed: false, seg: 16, steps: 2, t: r0, w: r0 * 0.95, ref: v(0, 0, 1) });
  }
  if (c.bracer) {
    // leather forearm guard, strapped on
    tube(S, 'bracer', ['fore' + n], { pts: [along(0.78), along(0.5), along(0.2)], seg: 16, steps: 6, ref: v(0, 0, 1), r: (u) => { const r = ARM_R(mix(0.69, 0.92, u)) * lg + 0.009 + 0.004 * bump(u, 0, 0.2); return [r, r * 0.97]; }, flat0: true, flat1: true });
    for (const k of [0.66, 0.32]) {
      const r = ARM_R(mix(0.69, 0.92, 1 - (k - 0.2) / 0.58)) * lg + 0.011;
      band(S, 'strap', ['fore' + n], [along(k + 0.02), along(k - 0.02)], { closed: false, seg: 14, steps: 1, t: r + 0.002, w: r, ref: v(0, 0, 1) });
      stud(S, 'buckle', ['fore' + n], along(k).add(v(sd * (r + 0.004), 0, 0)), v(sd, 0, 0), 0.008, { flat: 0.4 });
    }
  }
  if (c.armWrap) {
    // cloth wrapped round the bare forearm
    tube(S, 'wrap', ['fore' + n], { pts: [along(0.62), along(0.05)], seg: 14, steps: 12, ref: v(0, 0, 1), r: (u) => { const r = ARM_R(mix(0.74, 0.98, u)) * lg + 0.004 + 0.002 * Math.abs(Math.sin(u * 19)); return [r, r * 0.96]; }, shade: (u) => 1 - 0.16 * Math.pow(Math.abs(Math.cos(u * 19)), 6) });
  }
  if (!c.noHand) hand(S, L, c, sd);
}
// ring of points around `c` in the plane normal to `ax` (rx across, rz towards +Z)
function ringAt(c, ax, rx, rz, n = 16, sh = null, off = null) {
  const F = v(0, 0, 1).addScaledVector(ax, -ax.z).normalize(), Sd = new V3().crossVectors(ax, F).normalize();
  const pts = [];
  for (let k = 0; k < n; k++) { const a = (k / n) * TAU, m = sh ? sh(a) : 1; const p = c.clone().addScaledVector(Sd, Math.cos(a) * rx * m).addScaledVector(F, Math.sin(a) * rz * m); if (off) p.add(off); pts.push(p); }
  return pts;
}

// Hand: palm, four fingers with knuckles, opposed thumb. Rest pose: arm down, palm
// towards the body, thumb forward (+Z); fingers curl about Z (fing / fingB bones).
export function hand(S, L, c, sd) {
  const n = sd > 0 ? 'L' : 'R';
  if (c.claws) return claw(S, L, c, sd);
  const wr = S.skel.pos('hand' + n);
  const hl = L.hand, k = (hl / 0.166) * (c.handGirth ?? 1);
  const mat = c.gloves ? 'glove' : 'skin';
  // x: + = back of the hand, y: fraction of the hand length (down = -), z: metres at unit size
  const P = (x, y, z) => v(wr.x + sd * x * k, wr.y + y * hl, wr.z + z * k);
  tube(S, mat, ['fore' + n, 'hand' + n, ['fing' + n, 1.3], ['thumb' + n, 1.6]], {
    pts: [P(0, 0.1, 0), P(0, 0, 0), P(0.001, -0.27, 0.002), P(0, -0.53, 0.002)], seg: 14, steps: 8, ref: v(0, 0, 1), ol: 0.5, cap1: 0.55, capN: 3,
    r: (u) => [mix(0.0135, 0.0105, u) * k * (1 + 0.5 * sstep(0.3, 0, u)), mix(0.0235, 0.037, sstep(0.1, 0.75, u)) * k],
    shape: (u, a) => supEll(a, 2.5) * (1 + 0.07 * Math.cos(a) * sd),   // fleshy palm, flatter back
  });
  const fw = ['hand' + n, 'fing' + n, 'fingB' + n];
  const FZ = [0.027, 0.0092, -0.0086, -0.0252], FL = [0.43, 0.475, 0.44, 0.35], FY = [-0.5, -0.525, -0.505, -0.465], FR = [0.0087, 0.0089, 0.0084, 0.0074];
  for (let i = 0; i < 4; i++) {
    const z = FZ[i], y = FY[i], len = FL[i], r0 = FR[i] * k * (c.gloves ? 1.08 : 1);
    tube(S, mat, fw, {
      pts: [P(0, y + 0.12, z * 0.95), P(0, y, z), P(-0.003, y - len * 0.4, z * 1.05), P(-0.009, y - len * 0.74, z * 1.09), P(-0.017, y - len, z * 1.11)],
      seg: 6, steps: 7, capN: 2, cap1: 1, ol: 0.3, ref: v(0, 0, 1),
      r: (u) => { const t = r0 * (1 - 0.24 * u) * (1 + 0.08 * bump(u, 0.5, 0.05) + 0.07 * bump(u, 0.77, 0.045)); return [t * 0.9, t]; },
    });
  }
  tube(S, mat, ['hand' + n, 'thumb' + n], {
    pts: [P(0.002, -0.03, 0.006), P(-0.002, -0.15, 0.024), P(-0.008, -0.3, 0.04), P(-0.013, -0.44, 0.049), P(-0.018, -0.56, 0.053)],
    seg: 6, steps: 7, capN: 2, cap1: 1, ol: 0.3, ref: v(0, 0, 1),
    r: (u) => { const t = 0.0106 * k * (c.gloves ? 1.08 : 1) * (1 - 0.26 * u) * (1 + 0.3 * bump(u, 0.12, 0.2) + 0.07 * bump(u, 0.7, 0.05)); return [t * 0.92, t]; },
  });
  if (c.gloves && !c.bracer) {
    // flared gauntlet cuff with a stitched rim
    const lg = L.limb * (c.armGirth ?? 1), el = S.skel.pos('fore' + n);
    const a = wr.clone().lerp(el, 0.3), b = wr.clone().lerp(el, 0.02);
    tube(S, 'gloveCuff', ['fore' + n, ['hand' + n, 1.5]], { pts: [a, b], seg: 16, steps: 3, ref: v(0, 0, 1), flat0: true, r: (u) => { const r = (0.034 + 0.012 * (1 - u) * (1 - u)) * lg; return [r, r * 0.95]; } });
    band(S, 'trim', ['fore' + n], [a.clone().add(v(0, 0.004, 0)), a.clone().add(v(0, -0.006, 0))], { closed: false, seg: 16, steps: 1, t: 0.0475 * lg, w: 0.0455 * lg, ref: v(0, 0, 1) });
  }
}

function claw(S, L, c, sd) {
  const n = sd > 0 ? 'L' : 'R';
  const wr = S.skel.pos('hand' + n);
  const hl = L.hand;
  blob(S, 'skin', ['fore' + n, 'hand' + n, ['fing' + n, 1.3]], { c: wr.clone().add(v(0, -hl * 0.25, 0)), r: [0.028, hl * 0.3, 0.04], ws: 12, hs: 9 });
  const fw = ['hand' + n, 'fing' + n, 'fingB' + n];
  for (let k = 0; k < 3; k++) {
    const z = 0.026 - k * 0.026;
    const base = wr.clone().add(v(0, -hl * 0.45, z));
    const len = hl * (c.clawLen ?? 0.95);
    tube(S, c.clawMat ?? 'dark', fw, { pts: [base.clone().add(v(0, hl * 0.1, 0)), base, base.clone().add(v(-sd * 0.012, -len * 0.5, z * 0.2 + 0.012)), base.clone().add(v(-sd * 0.045, -len * 0.85, z * 0.3 + 0.035)), base.clone().add(v(-sd * 0.075, -len, z * 0.3 + 0.05))], seg: 8, steps: 10, r: (u) => 0.016 * (1 - u * 0.92), cap0: 0.6 });
  }
  const tb = wr.clone().add(v(-sd * 0.015, -hl * 0.2, 0.03));
  tube(S, c.clawMat ?? 'dark', ['hand' + n, 'thumb' + n], { pts: [tb, tb.clone().add(v(-sd * 0.01, -hl * 0.3, 0.03)), tb.clone().add(v(-sd * 0.03, -hl * 0.6, 0.05))], seg: 8, steps: 5, r: (u) => 0.013 * (1 - u * 0.9), cap0: 0.6 });
}

// ---------------------------------------------------------------------------
// Legs and footwear
const LEG_R = prof([[0, 0.078], [0.12, 0.084], [0.3, 0.075], [0.47, 0.056], [0.52, 0.053], [0.64, 0.058], [0.8, 0.047], [0.95, 0.038], [1, 0.036]]);
export function leg(S, L, c, sd) {
  const n = sd > 0 ? 'L' : 'R';
  const hp = S.skel.pos('thigh' + n), kn = S.skel.pos('shin' + n), an = S.skel.pos('foot' + n);
  const lg = L.limb * (c.legGirth ?? 1) * (0.75 + 0.25 * L.bw);
  const loose = c.pantsLoose ?? 0.004, lf = c.legFolds ?? 0.03;
  const pts = [hp.clone().add(v(-sd * 0.03, 0.07, 0)), hp.clone().add(v(sd * 0.004, -0.06, 0.004)), kn, an];
  const W = [['hips', 1.25], 'thigh' + n, 'shin' + n, ['foot' + n, 1.3]];
  const sh = c.shorts ?? 0;                           // fraction of the thigh the shorts cover
  const ub = 0.95 - 0.47 * (c.bootH ?? 0.55);         // where trousers bunch above the boot
  const wk = (u, a) => Math.sin(a * 3 + u * 31) * bump(u, 0.5, 0.06) + 0.8 * Math.sin(a * 4 - u * 44) * bump(u, ub, 0.06);
  const R = (u) => LEG_R(u) * lg;
  const calf = (u) => [0, -0.012 * sstep(0.5, 0.65, u) * sstep(0.9, 0.7, u) * lg];
  if (sh) {
    tube(S, c.legSkin ?? 'skin', W, { pts, seg: 16, steps: 20, cap0: 0.8, r: (u) => [R(u), R(u) * 1.02], off: calf });
    const e = hp.clone().lerp(kn, sh);
    tube(S, c.legMat ?? 'pants', [['hips', 1.25], 'thigh' + n], { pts: [pts[0], pts[1], e], seg: 18, steps: 9, cap0: 0.8, r: (u) => { const r = R(u * 0.5 * sh) + 0.008 + loose * 2 * u; return [r, r * 1.03]; }, shape: (u, a) => 1 + lf * Math.sin(a * 4 + u * 9) * u, shade: (u) => 1 - 0.1 * sstep(0.9, 1, u) });
    band(S, c.shortsHem ?? c.legMat ?? 'pants', ['thigh' + n], [e.clone().add(v(0, 0.022, 0)), e.clone().add(v(0, -0.004, 0))], { closed: false, seg: 18, steps: 1, t: R(0.5 * sh) + 0.013 + loose * 2, w: (R(0.5 * sh) + 0.013 + loose * 2) * 1.03, ref: v(0, 0, 1), shade: () => 0.84 });
    if (c.socks) {
      const top = an.clone().lerp(kn, c.socks);
      tube(S, 'sock', ['shin' + n, ['foot' + n, 1.3]], { pts: [top, an.clone().lerp(top, 0.5), an], seg: 16, steps: 6, r: (u) => { const r = R(mix(1 - c.socks * 0.47, 1, u)) + 0.004 + 0.003 * bump(u, 0.04, 0.06); return [r, r * 1.02]; }, off: (u) => calf(mix(1 - c.socks * 0.47, 1, u)), shade: (u) => (u < 0.12 ? 0.86 : 1) });
    }
  } else {
    tube(S, c.legMat ?? 'pants', W, {
      pts, seg: 16, steps: 22, cap0: 0.8,
      r: (u) => { const r = R(u) + loose * sstep(0.4, 1, u); return [r, r * 1.02]; },
      off: calf, shape: (u, a) => 1 + lf * wk(u, a), shade: (u, a) => 1 - 3 * lf * Math.max(0, -wk(u, a)),
    });
    if (c.kneePatch) stud(S, c.kneePatch, ['shin' + n, 'thigh' + n], kn.clone().add(v(0, 0.012, R(0.52) + 0.004)), v(0, 0, 1), 0.034, { flat: 0.16, ws: 10 });
  }
  boot(S, L, c, sd);
}

function boot(S, L, c, sd) {
  const n = sd > 0 ? 'L' : 'R';
  const kn = S.skel.pos('shin' + n), an = S.skel.pos('foot' + n), toe = S.skel.pos('toe' + n);
  const lg = L.limb * (c.legGirth ?? 1) * (0.75 + 0.25 * L.bw);
  const mat = c.bootMat ?? 'boots';
  const bh = c.bootH ?? 0.55;       // boot shaft height as a fraction of the shin
  const SW = ['shin' + n, ['foot' + n, 1.2]];
  if (bh > 0.05) {
    const top = an.clone().lerp(kn, bh);
    const rs = (u) => mix(0.058, 0.045, u) * lg;
    tube(S, mat, SW, {
      pts: [top.clone().add(v(0, 0.012, 0)), top, an.clone().lerp(top, 0.4), an.clone().add(v(0, -0.02, -0.004))], seg: 16, steps: 9,
      r: (u) => { const r = rs(u) + 0.004 * sstep(0.15, 0, u); return [r, r * 1.05]; },
      shape: (u, a) => 1 + 0.03 * Math.sin(a * 3 + u * 26) * sstep(0.5, 0.85, u), shade: (u, a) => 1 - 0.1 * Math.max(0, -Math.sin(a * 3 + u * 26)) * sstep(0.5, 0.85, u),
    });
    if (c.bootCuff !== 0) {
      // turned-down cuff
      const ch = 0.05 * Math.min(1, bh / 0.5);
      tube(S, 'bootCuff', ['shin' + n], { pts: [top.clone().add(v(0, 0.016, 0)), top.clone().add(v(0, -ch, 0))], seg: 16, steps: 3, flat0: true, r: (u) => { const r = rs(0) + 0.011 - 0.003 * u; return [r, r * 1.05]; } });
    }
    if (c.laces ?? bh > 0.3) {
      // crossed laces up the front of the shaft
      const m = Math.max(2, Math.round(bh * 7)), pt = (t, s) => { const q = top.clone().lerp(an, t); const r = rs(t) * 1.05; q.x += s * 0.36 * r; q.z += r * 0.94 + 0.0035; return q; };
      for (let k = 0; k < m; k++) {
        const t0 = mix(0.3, 0.86, k / m), t1 = mix(0.3, 0.86, (k + 1) / m);
        for (const s of [1, -1]) tube(S, 'lace', ['shin' + n], { pts: [pt(t0, s), pt(t1, -s)], seg: 4, steps: 1, r: 0.0026, ol: 0, ref: v(0, 0, 1) });
      }
    }
    if (c.bootStrap) {
      const t = 0.8, q = top.clone().lerp(an, t), r = rs(t) + 0.004;
      band(S, 'strap', ['shin' + n, 'foot' + n], [q.clone().add(v(0, 0.011, 0)), q.clone().add(v(0, -0.011, 0))], { closed: false, seg: 16, steps: 1, t: r, w: r * 1.05, ref: v(0, 0, 1) });
      stud(S, 'buckle', ['shin' + n, 'foot' + n], q.clone().add(v(sd * r * 0.8, 0, r * 0.66)), v(sd * 0.8, 0, 0.6), 0.009, { flat: 0.4 });
    }
  }
  // foot: heel -> toe, flat underneath; a darker toe cap
  const heel = v(an.x, 0.05, an.z - 0.052), tip = v(toe.x, 0.035, toe.z + 0.06);
  const fr = prof([[0, 0.032], [0.15, 0.041], [0.5, 0.04], [0.78, 0.044], [1, 0.03]]);
  const fh = prof([[0, 0.05], [0.2, 0.058], [0.5, 0.045], [0.8, 0.032], [1, 0.026]]);
  const fs = c.footS ?? 1;
  const FW = [['shin' + n, 1.4], 'foot' + n, 'toe' + n];
  tube(S, c.shoeMat ?? mat, FW, {
    pts: [heel, v(an.x, 0.058, an.z + 0.02), v((an.x + toe.x) / 2, 0.045, toe.z - 0.02), tip], seg: 16, steps: 12, ref: v(0, 1, 0),
    r: (u) => [fr(u) * fs * lg * 1.08, fh(u) * fs],
    shape: (u, a) => { const s = Math.sin(a); return s < 0 ? mix(1, 0.7, s * s) : 1; },
    shade: (u) => (c.toeCap !== false && u > 0.7 ? 0.78 : 1), cap0: 0.9, cap1: 0.9,
  });
  // welted sole with a raised heel
  const hs = (u) => mix(0.017, 0.0095, sstep(0.3, 0.42, u));
  tube(S, c.soleMat ?? 'sole', ['foot' + n, 'toe' + n], {
    pts: [v(heel.x, 0.014, heel.z - 0.008), v(an.x, 0.014, an.z + 0.02), v(toe.x, 0.014, toe.z), v(tip.x, 0.014, tip.z + 0.006)], seg: 14, steps: 10, capN: 2, ref: v(0, 1, 0),
    r: (u) => [fr(u) * fs * lg * 1.17, hs(u)], off: (u) => [0, hs(u) - 0.014], shape: (u, a) => supEll(a, 4), cap0: 0.5, cap1: 0.5,
  });
}

// ---------------------------------------------------------------------------
// Head: sculpted skull with jaw, chin and cheeks, nose and ears (the painted face
// lives in the skin material). Units inside the sculpt are head radii.
export function head(S, L, c) {
  const hr = L.hr, HC = L.HC;
  const age = c.age ?? 0, kid = c.kid ?? 0, round = (c.faceRound ?? 0) + kid * 0.5, jaw = c.jaw ?? 0;
  const W = ['head', ['neck', 1.7], ['jaw', 2.5]];
  // even out the shading across the face: lean the normals towards a simple egg
  const faceN = (k0) => (p, n) => {
    const k = k0 * sstep(0.15, 0.7, (p.z - HC.z) / hr);
    if (k > 0) n.lerp(_t.set(p.x - HC.x, (p.y - HC.y) * 0.55, p.z - HC.z + hr * 0.5).normalize(), k);
  };
  blob(S, 'skin', W, {
    c: HC, r: [hr, hr, hr], ws: 40, hs: 30, lonWarp: 0.45, nfn: faceN(0.5),
    fn: (d, p) => {
      let x = d.x * 0.9, y = d.y * (d.y > 0 ? 1.02 : 1), z = d.z * (d.z < 0 ? 1.05 : 1);
      const low = sstep(0, -1, d.y);                 // 0 at the eye line .. 1 under the chin
      const fr = sstep(-0.6, 0.3, d.z);              // 0 at the back .. 1 on the face
      const l3 = low * low * low;
      // the lower face narrows to the chin, which swings forward of the throat
      x *= 1 - (0.22 - round * 0.07 - jaw * 0.05) * low - (0.2 - round * 0.1 - jaw * 0.08) * l3 * fr;
      z += 0.38 * l3 * fr;
      if (z > 0.55) z = 0.55 + (z - 0.55) * 0.85;    // flatter face plane
      const ch = Math.exp(-(d.x * d.x * 2 + (d.y + 0.9) ** 2 + (d.z - 0.44) ** 2) / 0.09);
      y -= (0.08 - round * 0.04 + jaw * 0.02) * ch; z += 0.03 * ch;
      y += 0.3 * low * sstep(0.2, -0.6, d.z);        // the skull base rises behind the jaw
      const ck = Math.exp(-((Math.abs(d.x) - 0.55) ** 2 + (d.y + 0.42) ** 2 + (d.z - 0.68) ** 2) / 0.07) * (0.035 + round * 0.05 - age * 0.02);
      x *= 1 + ck; z *= 1 + ck;
      if (d.z > 0.4) {
        z -= 0.03 * Math.exp(-((Math.abs(d.x) - 0.37) ** 2 + (d.y + 0.07) ** 2) / 0.03);     // eye sockets
        z += 0.022 * Math.exp(-(d.x * d.x / 0.05 + (d.y + 0.62) ** 2 / 0.03));               // mouth
      }
      p.set(x * hr, y * hr, z * hr);
    },
  });
  // nose: a small wedge whose normals melt into the face
  const ns = (c.nose ?? 1) * hr, ny = HC.y - hr * 0.35, nz = HC.z + hr * 0.865;
  tube(S, 'skin', ['head'], { pts: [v(0, ny + 0.34 * hr, nz - 0.03 * hr), v(0, ny + 0.14 * hr, nz + 0.035 * ns), v(0, ny, nz + 0.115 * ns)], seg: 10, steps: 6, capN: 3, ol: 0.12, r: (u) => [mix(0.045, 0.085, u * u) * ns, mix(0.03, 0.075, u) * ns], cap1: 1, ref: v(0, 0, 1), nfn: faceN(0.72) });
  if (!c.noEars) for (const sd of [1, -1]) {
    const es = c.earS ?? 1;
    blob(S, 'skin', ['head'], {
      c: v(sd * hr * 0.86, HC.y - hr * 0.16, HC.z - hr * 0.1), r: [hr * 0.09, hr * 0.27 * es, hr * 0.16 * es], ws: 12, hs: 9, ol: 0.4,
      fn: (d, p) => { if (d.x * sd < 0) p.x *= 0.4; if (d.y > 0.4 && c.pointyEars) p.y += (d.y - 0.4) * hr * 0.4; p.z -= d.y * hr * 0.05 + Math.max(0, d.x * sd) * hr * 0.05; if (d.y < -0.3) p.z *= 0.75; },
      shade: (d) => 1 - 0.2 * sstep(0.5, 1, d.x * sd) * sstep(0.7, 0.2, Math.abs(d.y)),
    });
  }
}

// face parameters for the painted-face shader (per type)
export function faceParams(c, L) {
  const kid = c.kid ?? 0, age = c.age ?? 0, fem = c.fem ?? 0;
  const fringe = { fringe: 0.4, bob: 0.36, spiky: 0.46, short: 0.5, long: 0.5 }[c.hairStyle ?? 'short'];
  return {
    center: L.HC.clone(), R: L.hr,
    eye: [0.37 + kid * 0.02, -0.07 - kid * 0.02, (0.215 + kid * 0.02 - age * 0.03) * (c.eyeW ?? 1), (0.235 + kid * 0.03) * (c.eyeH ?? 1) * (1 - age * 0.3) * (1 - (c.jaw ?? 0) * 0.2)],
    iris: c.eyeColor ?? 0x3a2a22, lash: c.lashColor ?? 0x1e1410,
    browP: [0.38, 0.31 - kid * 0.03 - age * 0.03, 0.19, c.browArch ?? 0.5], browT: c.browT ?? (0.028 + age * 0.012), browC: c.browColor ?? c.beard ?? c.hair ?? 0x3a2418,
    mouthY: -0.6 - kid * 0.02, mouthW: c.mouthW ?? 0.17, lipDark: c.lipDark ?? 0,
    blush: c.blush ? 0.8 : 0.15, wrinkles: age, freckles: c.freckles ?? 0, lashT: c.lashT ?? (0.2 + fem * 0.05),
    irisR: c.irisR ?? (0.84 + kid * 0.06), pupil: c.pupil ?? 0.4,
    fringeY: c.fringeY ?? fringe ?? 9, noseY: -0.35, lip: c.lip ?? fem * 0.45 * (1 - kid), lowLash: fem * (1 - age),
  };
}

// ---------------------------------------------------------------------------
// Hair: a dark cap on the scalp under many overlapping tapered locks. Each lock is
// a crescent-section ribbon; its normals lean towards the head's sphere so the mass
// shades as one volume and the highlight ring (clothMat) runs unbroken across it.
function hairDir(th, az, out = new V3()) {
  // polar angle from a crown tilted back by 0.3 rad, azimuth 0 = front, + = left
  const y = Math.cos(th), z = Math.sin(th) * Math.cos(az);
  return out.set(Math.sin(th) * Math.sin(az), y * 0.955 + z * 0.296, z * 0.955 - y * 0.296);
}
function scalpPt(L, d, lift, out = new V3()) {
  const hr = L.hr * lift;
  return out.set(L.HC.x + d.x * hr * 0.94, L.HC.y + d.y * hr * 1.04, L.HC.z + d.z * hr * (1 + 0.07 * sstep(0.2, -0.6, d.z)));
}
function hairN(L) {
  const C = L.HC, hr = L.hr;
  return (p, n) => { const dl = _t.subVectors(p, C).length() / hr; const k = 0.6 * sstep(1.9, 1.15, dl); if (k > 0) n.lerp(_t.multiplyScalar(1 / (dl * hr)), k); };
}
// lock along a path; outs[k] = outward direction at pts[k] (the ribbon faces it)
function lockTube(S, L, mat, W, pts, outs, o) {
  const w = o.w ?? L.hr * 0.22, th = o.t ?? L.hr * 0.075, tp = o.taper ?? 2.2, root = o.root ?? 0.55;
  const m = outs.length - 1;
  return tube(S, mat, W, {
    pts, seg: o.seg ?? 6, steps: o.steps ?? pts.length + 3, capN: 2, cap0: 0.5, ol: o.ol ?? 0.8,
    ref: (u) => outs[Math.min(m, Math.round(u * m))],
    r: (u) => { const s = mix(root, 1, sstep(0, 0.3, u)) * Math.pow(Math.max(0, 1 - Math.pow(u, tp)), 0.85); return [w * s + 0.0008, th * (0.45 + 0.55 * s) + 0.0006]; },
    shape: (u, a) => { const s = Math.sin(a); return (s < 0 ? 1 + 0.62 * s : 1) * (1 + 0.05 * Math.cos(a * 3)); },   // flat underside
    shade: (u, a) => (o.sh ?? 1) * mix(0.8, 1, sstep(0, 0.22, u)) * mix(1, o.tip ?? 1.1, sstep(0.55, 1, u)) * (Math.sin(a) < -0.25 ? 0.7 : 1),
    nfn: o.nfn === undefined ? hairN(L) : o.nfn,
  });
}
// lock over the scalp from (th0, az) to (th1, az + daz), then hanging free for `len`:
// droop = gravity, flare = flick away from the head, sw / fw = sideways / forward drift
function strand(S, L, mat, W, o) {
  const pts = [], outs = [], d = new V3(), n0 = o.n0 ?? 4;
  for (let k = 0; k < n0; k++) {
    const t = k / (n0 - 1);
    hairDir(mix(o.th0, o.th1, t), o.az + (o.daz ?? 0) * t * t, d);
    pts.push(scalpPt(L, d, 1.03 + (o.lift ?? 0.05) * Math.sin(t * Math.PI * 0.85)));
    outs.push(d.clone());
  }
  if (o.len > 0) {
    const m = o.free ?? 3, dir = pts[n0 - 1].clone().sub(pts[n0 - 2]).normalize(), p = pts[n0 - 1].clone(), od = outs[n0 - 1];
    for (let k = 1; k <= m; k++) {
      dir.y -= (o.droop ?? 0.9) / m; dir.addScaledVector(od, (o.flare ?? 0) / m); dir.x += (o.sw ?? 0) / m; dir.z += (o.fw ?? 0) / m; dir.normalize();
      p.addScaledVector(dir, o.len / m); pts.push(p.clone()); outs.push(od);
    }
  }
  return lockTube(S, L, mat, W, pts, outs, o);
}
// free lock from `root` along `dir` (beards, tufts, tails)
function tuft(S, L, mat, W, root, dir, len, o = {}) {
  const pts = [root.clone()], outs = [], d = dir.clone().normalize(), p = root.clone(), m = o.free ?? 4;
  const od = o.out ?? v(0, 0, 1);
  outs.push(od);
  for (let k = 1; k <= m; k++) {
    d.y -= (o.droop ?? 0.6) / m; d.x += (o.sw ?? 0) / m; d.z += (o.fw ?? 0) / m; d.normalize();
    p.addScaledVector(d, len / m); pts.push(p.clone()); outs.push(od);
  }
  return lockTube(S, L, mat, W, pts, outs, { root: 0.8, ...o });
}
const hrand = (k) => { const s = Math.sin(k * 127.1 + 31.7) * 43758.5453; return s - Math.floor(s); };

export function hair(S, L, c) {
  const st = c.hairStyle ?? 'short';
  const hr = L.hr, HC = L.HC;
  const W = ['head'], WB = S.skel.has('hairB') ? ['hairB'] : W;
  const hat = c.hat, capped = hat === 'cap' || hat === 'scarf' || hat === 'witch';
  const vol = c.hairVol ?? 1;
  const lk = (o) => strand(S, L, o.mat ?? 'hair', o.back ? WB : W, { ...o, w: (o.w ?? 0.22) * hr * vol, len: (o.len ?? 0) * hr, sh: o.sh ?? (0.94 + 0.12 * hrand(o.az * 7 + o.th1)) });
  // scalp cap (the shadowed under-layer seen between locks), cut along the hairline
  const hl = st === 'bald' ? -0.2 : { bun: 0.62, long: 0.6 }[st] ?? 0.56;
  const nape = st === 'long' || st === 'bob' ? -0.85 : st === 'bun' ? -0.5 : -0.6;
  blob(S, 'hairIn', W, {
    c: HC, r: [hr * 0.955, hr * 1.055, hr * 1.02], ws: 28, hs: 18, ol: 0.6, nfn: hairN(L),
    fn: (d, p) => {
      if (d.z < 0) p.z *= 1 + 0.07 * sstep(0.2, -0.6, d.z) + 0.03;
      const face = sstep(0.05, 0.4, d.z) * sstep(hl + 0.08, hl - 0.1, d.y + Math.abs(d.x) * 0.22);
      const ears = sstep(0.5, 0.78, Math.abs(d.x)) * sstep(0.08, -0.16, d.y) * sstep(-0.55, 0.15, d.z);
      const back = sstep(nape + 0.15, nape - 0.05, d.y);
      const top = st === 'bald' ? sstep(0.0, 0.3, d.y) : 0;
      p.multiplyScalar(1 - Math.max(face, ears * (st === 'long' || st === 'bob' ? 0.2 : 1), back, top) * 0.16);
    },
  });
  if (st === 'bald') {
    // horseshoe of soft tufts round the back
    for (let k = 0; k < 15; k++) { const az = mix(1.2, TAU - 1.2, k / 14); lk({ az, th0: 1.2, th1: 1.75 + 0.1 * hrand(k), len: 0.2 + 0.1 * hrand(k + 9), w: 0.3, lift: 0.07, droop: 0.5, flare: 0.5, taper: 1.6, n0: 3 }); }
    return;
  }
  const sweep = c.hairSweep ?? (st === 'short' ? 0.5 : 0);   // fringe combed to one side
  const fr = (n, span, th1, len, o = {}) => {
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1) - 0.5, h = hrand(k * 3.1 + n);
      lk({ az: t * span, daz: sweep * 0.35, th0: 0.34 + 0.06 * h, th1: th1 + 0.1 * Math.abs(t) + 0.05 * h, len: len * (0.75 + 0.5 * h) * (1 - 0.3 * Math.abs(t)), w: 0.19 + 0.05 * h, lift: 0.06 + 0.03 * h, droop: 1.5, flare: 0.3, sw: sweep * 0.8 - t * 0.5, taper: 1.8, ...o });
    }
  };
  const ring = (n, a0, a1, fn) => { for (let k = 0; k < n; k++) { const az = mix(a0, a1, n > 1 ? k / (n - 1) : 0.5); lk({ az, back: Math.abs(az > Math.PI ? az - TAU : az) > 1.1, ...fn(az, hrand(k * 1.7 + a0), k) }); } };
  const crown = (n, len, o = {}) => ring(n, 0.35, TAU - 0.2, (az, h) => ({ th0: 0.04, th1: 0.82 + 0.25 * h, len: len * (0.7 + 0.6 * h), w: 0.26, lift: 0.1 + 0.03 * h, droop: 0.7, flare: 0.25, taper: 1.9, sh: 1.03 + 0.05 * h, ...o }));
  if (st === 'fringe') {
    fr(11, 1.9, 1.2, 0.36);
    for (const sd of [1, -1]) {
      lk({ az: sd * 1.14, th0: 0.36, th1: 1.45, len: 0.95, w: 0.17, droop: 1.0, flare: 0.12, sw: -sd * 0.12, fw: 0.15 });
      lk({ az: sd * 1.42, th0: 0.3, th1: 1.5, len: 0.55, w: 0.2, droop: 0.9, flare: 0.25, lift: 0.07 });
    }
    ring(11, 1.72, TAU - 1.72, (az, h) => ({ th0: 0.25, th1: 1.72 + 0.12 * h, len: 0.38 + 0.25 * h, w: 0.27, lift: 0.07, droop: 0.5, flare: 0.55, taper: 1.7 }));
    crown(10, 0.3);
    // ahoge
    tuft(S, L, 'hair', WB, scalpPt(L, hairDir(0.1, 0, _t.clone()), 1.03), v(0.1, 1, 0.25), hr * 0.62, { w: hr * 0.07, t: hr * 0.04, droop: 1.5, fw: 0.9, out: v(0, 0.3, 1), taper: 1.2, free: 5 });
  } else if (st === 'short') {
    fr(7, 1.7, 1.12, 0.3);
    ring(4, 1.15, 1.6, (az, h) => ({ th0: 0.3, th1: 1.45, len: 0.22 + 0.1 * h, w: 0.2, droop: 1.0, flare: 0.2 }));
    ring(4, TAU - 1.6, TAU - 1.15, (az, h) => ({ th0: 0.3, th1: 1.45, len: 0.22 + 0.1 * h, w: 0.2, droop: 1.0, flare: 0.2 }));
    ring(10, 1.75, TAU - 1.75, (az, h) => ({ th0: 0.25, th1: 1.75 + 0.1 * h, len: 0.18 + 0.12 * h, w: 0.28, lift: 0.06, droop: 0.5, flare: 0.4, taper: 1.7 }));
    if (!capped) crown(9, 0.22);
  } else if (st === 'spiky') {
    // tousled spikes; under a cap only the rim of hair below it shows
    const t0 = capped ? 1.0 : 0.3;
    for (let k = 0; k < 7; k++) { const t = k / 6 - 0.5, h = hrand(k + 2); lk({ az: t * 1.7, th0: capped ? 0.95 : 0.35, th1: 1.2 + 0.1 * Math.abs(t), len: 0.42 + 0.2 * h, w: 0.2, lift: 0.08, droop: 1.3, flare: 0.5, sw: (h - 0.5) * 0.9, taper: 1.3 }); }
    ring(16, 1.05, TAU - 1.05, (az, h, k) => ({ th0: t0, th1: 1.5 + 0.25 * h, len: 0.3 + 0.25 * h, w: 0.24, lift: 0.09, droop: 0.2, flare: 1.0 + 0.5 * h, sw: (k % 2 ? 0.3 : -0.3), taper: 1.2 }));
    if (!capped) { crown(10, 0.42, { flare: 1.1, droop: 0.1, taper: 1.2 }); ring(7, 0.5, TAU - 0.5, (az, h) => ({ th0: 0.02, th1: 0.4, len: 0.4 + 0.2 * h, w: 0.2, lift: 0.14, droop: 0, flare: 1.2, taper: 1.2 })); }
  } else if (st === 'bob') {
    fr(9, 1.75, 1.2, 0.46, { flare: 0.22, taper: 3, sw: 0 });
    for (const sd of [1, -1]) for (let k = 0; k < 4; k++) { const h = hrand(k + sd); lk({ az: sd * (1.08 + k * 0.22), th0: 0.3, th1: 1.42, len: 0.95 - 0.05 * k + 0.06 * h, w: 0.24, lift: 0.08, droop: 1.1, flare: -0.02, sw: -sd * 0.22, taper: 3.2, back: k > 1 }); }
    ring(9, 1.95, TAU - 1.95, (az, h) => ({ th0: 0.25, th1: 1.6, len: 0.72 + 0.06 * h, w: 0.3, lift: 0.08, droop: 0.9, flare: -0.25, taper: 3.2 }));
    crown(9, 0.3, { th1: 0.95 });
  } else if (st === 'long') {
    // centre parting: the fringe sweeps away to both sides, long locks frame the face
    for (const sd of [1, -1]) {
      for (let k = 0; k < 4; k++) { const h = hrand(k * 2 + sd); lk({ az: sd * (0.12 + k * 0.24), daz: sd * 0.55, th0: 0.3, th1: 1.3 + 0.06 * k, len: 0.5 + 0.2 * k + 0.1 * h, w: 0.21, lift: 0.07, droop: 1.3, flare: 0.25, sw: sd * 0.5, taper: 2 }); }
      lk({ az: sd * 1.15, th0: 0.3, th1: 1.45, len: 1.9, w: 0.2, droop: 1.0, flare: 0.06, sw: -sd * 0.1, fw: 0.22, free: 6, taper: 2.6 });
      lk({ az: sd * 1.4, th0: 0.3, th1: 1.5, len: 1.4, w: 0.22, droop: 1.0, flare: 0.1, free: 5, taper: 2.4 });
    }
    crown(9, 0.3, { th1: 1.0 });
  } else if (st === 'bun') {
    // combed back from the hairline into a low chignon
    const bun = hairDir(1.85, Math.PI);
    for (let k = 0; k < 15; k++) {
      const az = mix(-2.2, 2.2, k / 14), d0 = hairDir(1.28 + 0.12 * Math.cos(az), az), pts = [], outs = [];
      for (let j = 0; j < 6; j++) { const d = d0.clone().lerp(bun, j / 5); d.y += 0.5 * Math.sin((j / 5) * Math.PI) * Math.max(0, Math.cos(az * 0.7)); d.normalize(); pts.push(scalpPt(L, d, 1.035 + 0.03 * Math.sin((j / 5) * Math.PI))); outs.push(d); }
      lockTube(S, L, 'hair', W, pts, outs, { w: hr * 0.2, t: hr * 0.05, root: 0.9, taper: 3, sh: 0.95 + 0.1 * hrand(k), tip: 0.9 });
    }
    const bc = scalpPt(L, bun, 1.26);
    blob(S, 'hair', W, { c: bc, r: [hr * 0.4, hr * 0.34, hr * 0.34], ws: 20, hs: 14, fn: (d, p) => { p.multiplyScalar(1 + Math.sin(Math.atan2(d.x, d.y) * 2 + d.z * 5) * 0.05); }, shade: (d) => 0.92 + 0.12 * Math.sin(Math.atan2(d.x, d.y) * 2 + d.z * 5) });
    // binyeo (hairpin) with a jade head
    tube(S, 'pin', W, { pts: [bc.clone().add(v(-hr * 0.66, hr * 0.04, 0.01)), bc.clone().add(v(hr * 0.72, -hr * 0.05, -0.01))], seg: 8, steps: 3, r: hr * 0.03, cap0: 1, cap1: 1, ref: v(0, 1, 0) });
    blob(S, 'gem', W, { c: bc.clone().add(v(hr * 0.78, -hr * 0.055, -0.01)), r: [hr * 0.085, hr * 0.085, hr * 0.085], ws: 10, hs: 8 });
    for (const sd of [1, -1]) lk({ az: sd * 1.18, th0: 1.0, th1: 1.42, len: 0.6, w: 0.09, droop: 1.0, flare: 0.1, fw: 0.2, taper: 1.6 });
  }
}
// long back hair on the chain bones
export function hairBack(S, L, c, chainNames) {
  const hr = L.hr, len = ((c.hairLen ?? 0.42) + hr * 0.5) / hr;
  const W = ['head', ...chainNames.flat()];
  for (let k = 0; k < 11; k++) {
    // kept behind the shoulders so the fall does not run through them
    const az = mix(2.1, TAU - 2.1, k / 10), h = hrand(k + 4), mid = 1 - Math.abs(k / 10 - 0.5) * 0.5;
    strand(S, L, 'hair', W, { az, th0: 0.25, th1: 1.6, len: len * hr * mid * (0.9 + 0.2 * h), w: hr * 0.3, t: hr * 0.08, lift: 0.07, droop: 1.0, flare: 0.02, sw: (Math.PI - az) * 0.1, fw: -0.12, free: 7, taper: 2.6, sh: 0.92 + 0.12 * h, tip: 1.14 });
  }
}

// ---------------------------------------------------------------------------
// Facial hair
export function beard(S, L, c) {
  const hr = L.hr, HC = L.HC, bl = c.beardLen ?? 1;
  const W = [['head', 1], ['jaw', 0.7]];
  // locks rooted along the jaw from ear to ear, longest under the chin; two layers
  for (let layer = 0; layer < 2; layer++) for (let k = 0; k < 13; k++) {
    const ph = mix(-1.5, 1.5, k / 12) + layer * 0.1, cf = Math.cos(ph), h = hrand(k + layer * 20);
    const root = HC.clone().add(v(Math.sin(ph) * hr * 0.6, -hr * (0.42 + 0.42 * cf * cf) + layer * hr * 0.12, hr * (0.12 + 0.62 * cf) - layer * hr * 0.04));
    tuft(S, L, 'beard', W, root, v(Math.sin(ph) * 0.5, -0.5, 0.45 * cf + 0.1), hr * (0.42 + 0.55 * cf * cf) * bl * (0.85 + 0.3 * h) * (layer ? 0.7 : 1), { w: hr * 0.2, t: hr * 0.09, droop: 0.9, sw: -Math.sin(ph) * 0.35, out: v(Math.sin(ph), 0.2, cf + 0.2).normalize(), taper: 1.6, sh: 0.9 + 0.14 * h, nfn: null });
  }
}
export function mustache(S, L, c) {
  const hr = L.hr, HC = L.HC;
  for (const sd of [1, -1]) for (let k = 0; k < 2; k++) {
    tuft(S, L, 'beard', ['head'], HC.clone().add(v(sd * hr * 0.03, -hr * (0.47 + k * 0.03), hr * 0.93)), v(sd, -0.25 - k * 0.3, -0.12), hr * (0.5 - k * 0.12), { w: hr * 0.1, t: hr * 0.07, droop: 0.7, fw: -0.5, out: v(0, 0.3, 1), taper: 1.5, sh: 0.95 + k * 0.08, nfn: null });
  }
}
export function bushyBrows(S, L, c) {
  const hr = L.hr, HC = L.HC;
  for (const sd of [1, -1]) tuft(S, L, 'beard', ['head'], HC.clone().add(v(sd * hr * 0.12, hr * 0.27, hr * 0.9)), v(sd, 0.22, -0.1), hr * 0.42, { w: hr * 0.05, t: hr * 0.045, droop: 0.5, fw: -0.55, out: v(0, 0.2, 1), taper: 1.6, nfn: null });
}

// glasses (round frames with a soft tint in the lenses' rim)
export function glasses(S, L, c) {
  const hr = L.hr, HC = L.HC;
  for (const sd of [1, -1]) {
    const cc = HC.clone().add(v(sd * hr * 0.37, -hr * 0.07, hr * 0.98));
    const pts = [];
    for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; pts.push(cc.clone().add(v(Math.cos(a) * hr * 0.25, Math.sin(a) * hr * 0.24, -Math.abs(Math.cos(a)) * hr * 0.03 * (Math.cos(a) * sd > 0 ? 2.2 : 0.3)))); }
    tube(S, 'frame', ['head'], { pts, closed: true, seg: 6, steps: 32, r: hr * 0.02, ref: v(0, 0, 1), ol: 0.1 });
    tube(S, 'frame', ['head'], { pts: [cc.clone().add(v(sd * hr * 0.25, 0, -hr * 0.06)), v(sd * hr * 0.9, HC.y - hr * 0.02, HC.z + hr * 0.25), v(sd * hr * 0.93, HC.y - hr * 0.1, HC.z - hr * 0.25)], seg: 5, steps: 6, r: hr * 0.014, ol: 0.1 });
  }
  tube(S, 'frame', ['head'], { pts: [HC.clone().add(v(-hr * 0.12, -hr * 0.04, hr * 1.0)), HC.clone().add(v(0, hr * 0.0, hr * 1.04)), HC.clone().add(v(hr * 0.12, -hr * 0.04, hr * 1.0))], seg: 5, steps: 5, r: hr * 0.015, ol: 0.1 });
}

// ---------------------------------------------------------------------------
// Clothing. Garments sit on the torso surface (torsoPt) with a margin, have
// thickness (sheet), fold shading baked into vertex colours, and trims, studs and
// fastenings as separate raised pieces.

// ribbon bow at p facing n: two loops, a knot and two tails
function bow(S, mat, W, p, n, s) {
  const t = v(n.z, 0, -n.x).normalize(), q = new THREE.Quaternion().setFromUnitVectors(v(0, 0, 1), n);
  for (const sd of [1, -1]) {
    const c0 = p.clone().addScaledVector(t, sd * s * 0.5).add(v(0, s * 0.1, 0));
    blob(S, mat, W, { c: c0, r: [1, 1, 1], ws: 10, hs: 8, ol: 0.6, inside: () => c0,
      fn: (d, pp) => { const al = (d.x * sd + 1) / 2; pp.set(d.x * s * 0.5, d.y * s * 0.34 * (0.3 + 0.7 * al), d.z * s * 0.12 * (0.5 + al)).applyQuaternion(q); },
      shade: (d) => 0.74 + 0.26 * sstep(-0.6, 0.3, d.x * sd) });
    tube(S, mat, W, { pts: [p.clone(), p.clone().addScaledVector(t, sd * s * 0.3).add(v(0, -s * 0.5, 0)).addScaledVector(n, s * 0.05), p.clone().addScaledVector(t, sd * s * 0.42).add(v(0, -s * 1.0, 0))], seg: 6, steps: 5, r: (u) => [s * (0.1 + 0.1 * u), s * 0.025], ref: n, flat1: true, shade: (u) => 1 - 0.2 * (1 - u) });
  }
  stud(S, mat, W, p.clone().addScaledVector(n, s * 0.06), n, s * 0.15, { flat: 0.8 });
}
// gem in a metal setting
function brooch(S, W, p, n, r, gem = 'gem') {
  stud(S, 'gold', W, p, n, r, { flat: 0.35, ws: 12 });
  stud(S, gem, W, p.clone().addScaledVector(n, r * 0.25), n, r * 0.62, { flat: 0.8, ws: 10 });
}

// collar round the neck, open at the front: 'stand' | 'fold' (points) | 'frill'
export function collar(S, L, c, mat, kind = 'fold') {
  const nw = 0.047 * (c.neckW ?? 1) * mix(1, L.hr / 0.158, 0.5) + 0.006;
  const W = ['chest', 'neck'], gap = kind === 'stand' ? 0.16 : 0.3;
  sheet(S, mat, W, {
    nu: 44, nv: 4, thick: 0.007, top: true,
    fn: (u, vv, out) => {
      const a = mix(gap, TAU - gap, u), fr = Math.pow(Math.max(0, Math.cos(a)), 2);
      if (kind === 'stand') { const r = nw + 0.004 + 0.006 * vv; out.set(Math.sin(a) * r, L.NY - 0.012 + 0.04 * vv + 0.006 * Math.cos(a), Math.cos(a) * r * 0.96 - 0.004 + 0.012 * vv); return; }
      // folds down and outwards; longer points beside the opening
      const len = (0.04 + 0.03 * fr) * (kind === 'frill' ? 0.8 : 1), r = nw + 0.008 + len * 0.75 * Math.pow(vv, 0.8);
      const ruf = kind === 'frill' ? 1 + 0.09 * vv * Math.sin(a * 10) : 1;
      out.set(Math.sin(a) * r * ruf, L.NY + 0.03 - len * 0.9 * vv * vv - 0.012 * fr * vv + (kind === 'frill' ? 0.006 * vv * Math.sin(a * 10 + 1) : 0), Math.cos(a) * r * 0.97 * ruf + 0.004 + 0.014 * vv * Math.max(0, Math.cos(a)));
    },
    inside: (p) => v(0, p.y - 0.03, 0), shade: (u, vv) => 1 - 0.08 * (1 - vv),
  });
}
// buttoned placket down the chest
export function placket(S, L, c, mat, n = 4, u0 = 0.9, u1 = 0.44) {
  const W = ['spine', 'chest', 'hips'], pts = [];
  for (let k = 0; k <= 8; k++) pts.push(torsoPt(L, c, mix(u0, u1, k / 8), 0, 0.009));
  band(S, mat, W, pts, { closed: false, t: 0.013, w: 0.003, ref: v(0, 0, 1), steps: 16, shade: () => 0.93 });
  for (let k = 0; k < n; k++) stud(S, 'button', W, torsoPt(L, c, mix(u0 - 0.04, u1 + 0.04, n > 1 ? k / (n - 1) : 0.5), 0, 0.013), v(0, 0, 1), 0.0075);
}

// wrap skirt / tunic / robe (from the waist down). o: bottom, flare, folds, uTop, nu, nv,
// vent (hem cut up at the sides), open (front opening half-angle), trim / trim2 (hem bands)
export function skirt(S, L, c, mat, o) {
  const [y0, y1] = torsoSpan(L);
  const T = TR(L, c);
  const uTop = o.uTop ?? 0.36;
  const ya = mix(y0, y1, uTop), yb = o.bottom;
  const flare = o.flare ?? 1, n = o.folds ?? 9, vent = o.vent ?? 0, amp = o.foldAmp ?? 0.06;
  const W = [['hips', o.hipBias ?? 0.55], ['thighL', 1], ['thighR', 1], ['shinL', 1.6], ['shinR', 1.6]];
  const rx0 = T.rx(uTop) + 0.012, rz0 = T.rz(uTop) + 0.012;
  const thigh = L.hipX + 0.086 * L.limb * (c.legGirth ?? 1) * (0.75 + 0.25 * L.bw) + 0.022;
  const fw = (a, vv) => vv * (Math.sin(a * n + vv * 2.5) + 0.4 * Math.sin(a * n * 2.3 + 1.7));
  const P = (a, vv, out, m = 0) => {
    const e = Math.pow(vv, 0.75);
    const rx = Math.max(mix(rx0, rx0 * 1.05 + 0.1 * flare, e), mix(rx0, thigh, sstep(0, 0.45, vv))) + m, rz = mix(rz0, rz0 * 1.1 + 0.1 * flare, e) + m;
    const k = (1 + amp * fw(a, vv)) * mix(tK(L, uTop, a), 1, sstep(0, 0.4, vv));
    return out.set(Math.sin(a) * rx * k, mix(ya, yb + vent * (ya - yb) * Math.pow(Math.abs(Math.sin(a)), 8), vv), Math.cos(a) * rz * k + T.oz(uTop) * (1 - vv));
  };
  const a0 = (vv) => (o.open ? 0.03 + o.open * sstep(0.05, 0.7, vv) : 0);
  const ang = (u, vv) => (o.open ? mix(a0(vv), TAU - a0(vv), u) : u * TAU);
  sheet(S, mat, W, {
    nu: o.nu ?? 40, nv: o.nv ?? 7, wrap: !o.open, thick: o.thick ?? 0.012,
    fn: (u, vv, out) => P(ang(u, vv), vv, out),
    inside: (p) => v(0, p.y, 0), innerMat: o.innerMat, innerShade: 0.8,
    shade: (u, vv) => (1 - 2.2 * amp * Math.max(0, -fw(ang(u, vv), vv))) * (1 - 0.1 * sstep(0.18, 0, vv)),
  });
  const hem = (key, vv, w) => {
    const pts = [], m = o.open ? 30 : 36;
    for (let k = 0; k < (o.open ? m + 1 : m); k++) pts.push(P(ang(k / m, vv), vv, new V3(), 0.004));
    band(S, key, W, pts, { closed: !o.open, t: 0.004, w, steps: m * 1.5 });
  };
  if (o.trim) hem(o.trim, 0.94, o.trimW ?? 0.013);
  if (o.trim2) hem(o.trim2, 0.8, 0.004);
  // front surface depth at height y (for layering an apron over the skirt)
  return (y) => {
    const vv = sat01((y - ya) / (yb - ya));
    if (y > ya) return -1;
    const e = Math.pow(vv, 0.75);
    return mix(rz0, rz0 * 1.1 + 0.1 * flare, e) * (1 + amp * 1.4 * vv) + T.oz(uTop) * (1 - vv);
  };
}

// belt with a framed buckle, keeper, hanging end, optional pouch and bell charm
export function belt(S, L, c, mat, uAt = 0.39) {
  const [y0, y1] = torsoSpan(L);
  const m = 0.019 + (c.skirtOver ? 0.004 : 0), bw = c.beltW ?? 0.02;
  const W = ['hips', 'spine'];
  const dip = (g) => (-0.012 * Math.cos(g)) / (y1 - y0);          // rides lower at the front
  band(S, mat, W, girdle(L, c, uAt, m, 32, dip), { t: 0.006, w: bw });
  const f = torsoPt(L, c, uAt + dip(0), 0, m + 0.007);
  const pts = [];
  for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU, e = supEll(a, 4); pts.push(v(f.x + Math.cos(a) * e * bw * 1.35, f.y + Math.sin(a) * e * bw * 1.3, f.z + 0.002)); }
  tube(S, 'buckle', W, { pts, closed: true, seg: 6, steps: 24, r: 0.0042, ref: v(0, 0, 1) });
  tube(S, 'buckle', W, { pts: [v(f.x - bw * 1.3, f.y, f.z + 0.003), v(f.x + bw * 0.9, f.y, f.z + 0.006)], seg: 5, steps: 2, r: 0.0028, ref: v(0, 0, 1), cap1: 1 });
  // keeper and the free end hanging from it
  const kp = [0.32, 0.4, 0.48].map((g) => torsoPt(L, c, uAt + dip(g), g, m + 0.004));
  band(S, mat, W, kp, { closed: false, t: 0.006, w: bw + 0.004, steps: 3, shade: () => 0.78 });
  const e0 = torsoPt(L, c, uAt + dip(0.5), 0.5, m + 0.008);
  tube(S, mat, [['hips', 1], ['thighL', 2.4]], { pts: [e0, e0.clone().add(v(0.012, -0.05, 0.008)), e0.clone().add(v(0.02, -0.13, 0.004))], seg: 6, steps: 5, r: (u) => [bw * (0.75 - 0.3 * u * u), 0.004], ref: v(0.45, 0, 0.9), cap1: 0.6 });
  if (c.pouch) {
    // hip pouch: boxy body, darker flap, button, two belt loops
    const g = -1.0, y = uAt - 0.085, p = torsoPt(L, c, y, g, m + 0.02), nr = v(Math.sin(g), 0, Math.cos(g)), tg = v(nr.z, 0, -nr.x);
    const sq = (x) => Math.sign(x) * Math.pow(Math.abs(x), 0.6);
    blob(S, c.pouchMat ?? 'pouch', ['hips', ['thighR', 1.8]], { c: p, r: [1, 1, 1], ws: 14, hs: 10, inside: () => p,
      fn: (d, pp) => { pp.set(0, sq(d.y) * 0.042, 0).addScaledVector(tg, sq(d.x) * 0.036).addScaledVector(nr, sq(d.z) * 0.024 * (d.y < 0 ? 1.12 : 0.9)); },
      shade: (d) => (d.y > 0.12 && d.z > -0.2 ? 0.76 : 1) });
    stud(S, 'button', ['hips', ['thighR', 1.8]], p.clone().addScaledVector(nr, 0.025).add(v(0, 0.002, 0)), nr, 0.0075);
    for (const s of [1, -1]) band(S, mat, ['hips'], [p.clone().addScaledVector(tg, s * 0.02).add(v(0, 0.075, 0)).addScaledVector(nr, -0.012), p.clone().addScaledVector(tg, s * 0.02).add(v(0, 0.03, 0)).addScaledVector(nr, 0.012)], { closed: false, t: 0.006, w: 0.003, ref: nr, steps: 2 });
  }
  if (c.charm) {
    // small bell on a cord
    const g = 1.25, p = torsoPt(L, c, uAt + dip(g), g, m + 0.006);
    const b = p.clone().add(v(0.004, -0.085, 0.004));
    tube(S, 'cord', [['hips', 1], ['thighL', 2.4]], { pts: [p, p.clone().add(v(0.002, -0.04, 0.004)), b.clone().add(v(0, 0.016, 0))], seg: 4, steps: 4, r: 0.0022, ol: 0.3 });
    blob(S, 'gold', [['hips', 1], ['thighL', 2.4]], { c: b, r: [0.017, 0.019, 0.017], ws: 12, hs: 10, ol: 0.6, fn: (d, pp) => { if (d.y < -0.2) { pp.x *= 1.12; pp.z *= 1.12; } if (d.y < -0.75) pp.y *= 0.7; }, shade: (d) => (d.y < -0.82 ? 0.3 : 1) });
  }
}
// wide cloth sash knotted at the hip with two hanging ends
export function sash(S, L, c, mat, uAt = 0.4) {
  const W = ['hips', 'spine'], m = 0.02, g = c.sashSide ?? -0.9;
  band(S, mat, W, girdle(L, c, uAt, m, 32), { t: 0.007, w: 0.034, shape: (u, a) => 1 + 0.12 * Math.sin(a * 3 + u * 40), shade: (u, a) => 1 - 0.14 * Math.max(0, Math.sin(a * 3 + u * 40 + 2)) });
  const p = torsoPt(L, c, uAt, g, m + 0.012), nr = v(Math.sin(g), 0, Math.cos(g)), tg = v(nr.z, 0, -nr.x);
  stud(S, mat, W, p, nr, 0.026, { flat: 0.7, ws: 10 });
  for (const s of [0, 1]) tube(S, mat, [['hips', 1], [g < 0 ? 'thighR' : 'thighL', 2]], { pts: [p, p.clone().addScaledVector(tg, (s - 0.5) * 0.03).add(v(0, -0.09, 0)).addScaledVector(nr, 0.012), p.clone().addScaledVector(tg, (s - 0.5) * 0.07).add(v(0, -0.2 - s * 0.05, 0)).addScaledVector(nr, 0.006)], seg: 6, steps: 6, r: (u) => [0.016 + 0.014 * u, 0.004], ref: nr, flat1: true, shade: (u) => (u > 0.86 ? 0.75 : 1) });
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
      const p = capeP(L, c, a, k / n, len, sy);
      const nm = `cape${ci}_${k}`;
      S.add(nm, parent, p.x, p.y, p.z); names.push(nm); parent = nm;
    }
    chains.push({ names, tail: capeP(L, c, a, 1, len, sy) });
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
  const fw = (u, vv) => vv * (Math.sin(u * 26 + vv * 3) + 0.5 * Math.sin(u * 47 + 1));
  const P = (u, vv, out) => {
    out.copy(capeP(L, c, mix(-1.22, 1.22, u), vv, len, sy));
    out.z -= 0.013 * fw(u, vv);
    if (c.capeRag) out.y += (Math.sin(u * 37) * 0.5 + 0.5) * 0.08 * sstep(0.85, 1, vv);
    else out.y -= 0.035 * vv * Math.pow(Math.abs(u - 0.5) * 2, 3);   // corners hang lower
    return out;
  };
  sheet(S, mat, W, { nu: 22, nv: 12, thick: 0.014, top: true, fn: P, inside: (p) => v(0, p.y, 0.05), innerMat: inner, shade: (u, vv) => 1 - 0.13 * Math.max(0, fw(u, vv)) - 0.08 * sstep(0.2, 0, vv) });
  if (c.capeTrim !== false && !c.capeRag) {
    const pts = [];
    for (let k = 0; k <= 22; k++) { const p = P(k / 22, 0.95, new V3()); p.z -= 0.004; pts.push(p); }
    band(S, 'trim', W, pts, { closed: false, t: 0.004, w: 0.011, steps: 33 });
  }
}

// mantle/capelet over the shoulders: pointed front and back, trimmed hem, clasp
export function mantle(S, L, c, mat, inner) {
  const [y0, y1] = torsoSpan(L);
  const T = TR(L, c);
  const W = ['chest', 'neck', ['clavL', 1.2], ['clavR', 1.2], ['armL', 1.6], ['armR', 1.6]];
  const len = c.mantleLen ?? 1;
  const P = (a, vv, out, mm = 0) => {
    const pt = Math.pow(Math.abs(Math.cos(a)), 3);
    const y = mix(L.NY + 0.026, L.SY - 0.13 * len, Math.pow(vv, 1.7));
    const uu = sat01((y - y0) / (y1 - y0));
    const se = supEll(a, 2.6), m = mix(0.02, 0.034, vv) + mm;
    const rx = Math.max((T.rx(uu) + m) * se, mix(0.072, L.SX + 0.085, Math.pow(vv, 0.5)) + mm);
    const rz = Math.max((T.rz(uu) + m) * se + T.oz(uu), mix(0.068, 0.172 * (0.7 + 0.3 * L.bw), Math.pow(vv, 0.55)) + mm);
    const f = 1 + 0.03 * vv * Math.sin(a * 9 + 1);
    return out.set(Math.sin(a) * rx * f, y - 0.03 * vv * Math.abs(Math.cos(a)) - 0.07 * len * vv * vv * pt, Math.cos(a) * rz * f - 0.008);
  };
  sheet(S, mat, W, { nu: 40, nv: 7, wrap: true, thick: 0.012, fn: (u, vv, out) => P(u * TAU, vv, out), inside: (p) => v(0, p.y + 0.05, -0.01), innerMat: inner, shade: (u, vv) => 1 - 0.1 * vv * Math.max(0, -Math.sin(u * TAU * 9 + 1)) - 0.08 * sstep(0.25, 0, vv) });
  if (c.mantleTrim !== false) {
    const pts = [];
    for (let k = 0; k < 40; k++) pts.push(P((k / 40) * TAU, 0.93, new V3(), 0.004));
    band(S, c.mantleTrimMat ?? 'trim', W, pts, { t: 0.004, w: 0.009, steps: 60 });
  }
  if (c.clasp !== false) brooch(S, ['chest'], P(0, 0.42, new V3(), 0.006), v(0, 0.25, 1).normalize(), 0.02, c.claspGem ?? 'gem');
}

// hood shell (up) around the head with a point at the back
export function hood(S, L, c, mat, inner, W = [['head', 1], ['neck', 1.5], ['chest', 2.2]]) {
  const hr = L.hr, HC = L.HC;
  sheet(S, mat, W, {
    nu: 26, nv: 14, thick: 0.014, top: false, sides: true,
    fn: (u, vv, out) => {
      // u: from front-left edge over the back to front-right edge; v: crown -> shoulders
      const open = mix(0.55, 1.05, sstep(0.05, 0.6, vv)) * sstep(1.02, 0.7, vv) + 0.35 * sstep(0.75, 1, vv);
      const phi = mix(open, TAU - open, u);
      const th = mix(0.05, 2.35, vv);
      const r = hr * mix(1.25, 1.36, vv);
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
    innerMat: inner, shade: (u, vv) => 1 - 0.08 * vv * Math.max(0, Math.sin(u * 30)),
  });
}
// hood lowered, bunched behind the neck
export function hoodDown(S, L, c, mat, inner, W = ['neck', 'chest']) {
  sheet(S, mat, W, {
    nu: 22, nv: 8, thick: 0.014,
    fn: (u, vv, out) => { const a = mix(-1.9, 1.9, u) + Math.PI; const r = mix(0.085, 0.16, vv) + 0.02 * Math.sin(u * 25) * vv; out.set(Math.sin(a) * r * 1.1, L.NY + 0.04 - vv * 0.2 - 0.03 * Math.cos(u * Math.PI * 2), Math.cos(a) * r - 0.02 - vv * 0.03); },
    inside: (p) => v(0, p.y, 0.02), innerMat: inner, shade: (u, vv) => 1 - 0.12 * vv * Math.max(0, -Math.sin(u * 25)),
  });
}

// scarf: two soft turns around the neck, a knot, two hanging tails on chains
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
  const y = L.NY - 0.002, sw = c.scarfW ?? 1;
  for (const [dy, k, ph] of [[-0.014, 1.06, 0], [0.02, 0.9, 2]]) {
    const pts = [];
    for (let j = 0; j < 14; j++) { const a = (j / 14) * TAU; pts.push(v(Math.sin(a) * 0.078 * sw * k, y + dy + 0.012 * Math.sin(a * 2 + ph) + 0.01 * Math.cos(a), Math.cos(a) * 0.072 * k + 0.004)); }
    tube(S, 'scarf', ['chest', 'neck'], { pts, closed: true, seg: 10, steps: 28, r: [0.026, 0.034], ref: v(0, 1, 0), shape: (u, a) => 1 + 0.1 * Math.sin(u * 44 + a * 2 + ph), shade: (u, a) => 1 - 0.14 * Math.max(0, -Math.sin(u * 44 + a * 2 + ph)) });
  }
  chains.forEach((ch, i) => {
    const P = [...ch.names.map((n) => S.skel.pos(n)), ch.tail];
    const curve = new THREE.CatmullRomCurve3(P);
    // stripes and a darker fringe at the ends
    sheet(S, 'scarf', ['chest', ...ch.names], {
      nu: 4, nv: 12, thick: 0.012, top: true,
      fn: (u, vv, out) => { curve.getPointAt(vv, out); out.x += (u - 0.5) * (0.082 - vv * 0.01); out.z += (i ? 0.004 : -0.004) - 0.01 * Math.sin(u * Math.PI); },
      inside: (p) => v(p.x, p.y, 0), shade: (u, vv) => (vv > 0.96 ? 0.6 : vv > 0.8 && vv < 0.88 ? 0.72 : 1),
    });
  });
  stud(S, 'scarf', ['chest', 'neck'], v(0.02 * sw, y - 0.012, -0.082), v(0.1, -0.2, -1).normalize(), 0.03, { flat: 0.8, ws: 10 });
}
// neckerchief: a band round the neck with a triangle of cloth at the front
export function neckerchief(S, L, c, mat) {
  const W = ['chest', 'neck'], y = L.NY + 0.006, pts = [];
  for (let j = 0; j < 12; j++) { const a = (j / 12) * TAU; pts.push(v(Math.sin(a) * 0.064, y + 0.012 * Math.cos(a) - 0.01, Math.cos(a) * 0.06 + 0.002)); }
  tube(S, mat, W, { pts, closed: true, seg: 8, steps: 24, r: [0.012, 0.017], ref: v(0, 1, 0), shape: (u, a) => 1 + 0.08 * Math.sin(u * 50 + a) });
  sheet(S, mat, W, { nu: 14, nv: 8, thick: 0.006, top: true, fn: (u, vv, out) => { const x = (u - 0.5) * 0.15 * (1 - vv * 0.92); const T2 = torsoPt(L, c, 0.93 - vv * 0.17, x / 0.11, 0.012); out.set(x, Math.min(T2.y, y - 0.004) - 0.004 * Math.sin(u * 9) * vv, Math.max(T2.z, 0.06) + 0.01 * (1 - vv)); }, inside: () => v(0, y - 0.1, -0.1), shade: (u, vv) => 1 - 0.1 * Math.abs(Math.sin(u * 9)) * vv });
  stud(S, mat, W, v(0, y - 0.016, 0.07), v(0, 0, 1), 0.016, { flat: 0.8 });
}

// apron: bib and skirt panel with a pocket, waist ties and a bow at the back
export function apron(S, L, c, mat, under = null) {
  const [y0, y1] = torsoSpan(L);
  const T = TR(L, c);
  const W = [['hips', 0.8], 'spine', 'chest', ['thighL', 1.2], ['thighR', 1.2]];
  const yT = mix(y0, y1, 0.74), yB = L.H - 0.42;
  const P = (u, vv, out, m = 0) => {
    const y = mix(yT, yB, vv);
    const uu = sat01((y - y0) / (y1 - y0));
    const wz = y > y0 ? T.rz(uu) * tK(L, uu, 0) + T.oz(uu) : 0.12;
    const hw = mix(0.085, 0.175, sstep(0.24, 0.36, vv)) * L.bw;
    const uz = under ? under(y) : -1;
    const fz = Math.max(wz + 0.017, 0.1 * L.bw + 0.02 * vv, uz + 0.015) + 0.004 + m;
    const x = (u - 0.5) * 2 * hw;
    return out.set(x, y + 0.006 * Math.sin(u * 44) * sstep(0.9, 1, vv), fz - (x * x) / (2 * Math.max(0.13, fz * 0.9)) + 0.012 * vv * vv + 0.006 * Math.sin(u * 44) * sstep(0.8, 1, vv));
  };
  sheet(S, mat, W, { nu: 22, nv: 14, thick: 0.008, fn: P, inside: () => v(0, L.H, -0.1), shade: (u, vv) => (vv > 0.9 ? 0.9 : 1) * (1 - 0.06 * Math.abs(Math.sin(u * 13)) * sstep(0.4, 1, vv)) });
  // pocket
  sheet(S, mat, W, { nu: 6, nv: 4, thick: 0.004, top: true, fn: (u, vv, out) => P(mix(0.56, 0.84, u), mix(0.52, 0.68, vv), out, 0.006), inside: () => v(0, L.H, -0.1), shade: (u, vv) => (vv < 0.2 ? 0.86 : 0.95) });
  // waist ties, bow at the back, neck strap
  const uW = 0.4;
  band(S, c.apronTie ?? mat, ['hips', 'spine'], girdle(L, c, uW, 0.017, 30), { t: 0.004, w: 0.012 });
  bow(S, c.apronTie ?? mat, ['hips', 'spine'], torsoPt(L, c, uW, Math.PI, 0.028), v(0, 0, -1), 0.085);
  for (const sd of [1, -1]) {
    const pts = [P(0.5 + sd * 0.42, 0.01, new V3(), 0.002)];
    for (const [u, g, m] of [[0.9, 0.5, 0.012], [0.985, 0.85, 0.03]]) pts.push(torsoPt(L, c, u, sd * g, m));
    pts.push(v(sd * 0.03, L.NY + 0.012, -0.07));
    band(S, c.apronTie ?? mat, ['chest', 'neck'], pts, { closed: false, t: 0.011, w: 0.003, ref: v(0, 0.3, 1), steps: 10 });
  }
}

// vest (open front) over the torso: piped edges, toggles down one side
export function vest(S, L, c, mat) {
  const W = ['hips', 'spine', 'chest', ['armL', 2], ['armR', 2]];
  const op = (vv) => 0.34 - 0.14 * sstep(0.2, 0.9, vv);
  const P = (u, vv, out, m = 0) => torsoPt(L, c, mix(0.9, 0.37, vv), mix(op(vv), TAU - op(vv), u), 0.013 + m, out);
  sheet(S, mat, W, { nu: 32, nv: 10, thick: 0.011, sides: true, top: true, fn: P, inside: (p) => v(0, p.y, 0), shade: (u, vv) => 1 - 0.07 * sstep(0.85, 1, vv) });
  // piping along the front edges and hem
  const pts = [];
  for (let k = 0; k <= 10; k++) pts.push(P(0, k / 10, new V3(), 0.003));
  for (let k = 1; k <= 24; k++) pts.push(P(k / 24, 1, new V3(), 0.003));
  for (let k = 9; k >= 0; k--) pts.push(P(1, k / 10, new V3(), 0.003));
  tube(S, c.vestTrim ?? 'trim', W, { pts, seg: 5, steps: 88, r: 0.0045, ol: 0.5 });
  for (let k = 0; k < 3; k++) {
    // toggle and loop
    const vv = 0.3 + k * 0.2, a = P(0, vv, new V3(), 0.008), b = P(1, vv, new V3(), 0.008);
    stud(S, 'button', W, a.clone().add(v(0.016, 0, 0.002)), v(0.2, 0, 1), 0.009);
    tube(S, 'cord', W, { pts: [b.clone().add(v(-0.02, 0, 0.002)), b.clone().add(v(0.014, 0.004, 0.006)), a.clone().add(v(0.004, 0, 0.006))], seg: 4, steps: 4, r: 0.0026, ol: 0.3 });
  }
}
// braces from the waistband over the shoulders, crossed at the back
export function suspenders(S, L, c, mat) {
  const W = ['hips', 'spine', 'chest'];
  for (const sd of [1, -1]) {
    const pts = [], refs = [];
    const add = (u, g, m) => { pts.push(torsoPt(L, c, u, g, m)); refs.push(v(Math.sin(g), 0.25, Math.cos(g)).normalize()); };
    for (let k = 0; k <= 5; k++) { const t = k / 5; add(mix(0.42, 0.93, t), sd * mix(0.42, 0.62, t), 0.011 + 0.012 * sstep(0.7, 1, t)); }
    pts.push(v(sd * L.SX * 0.52, L.SY + 0.085, -0.01)); refs.push(v(0, 1, 0));
    for (let k = 5; k >= 0; k--) { const t = k / 5; add(mix(0.42, 0.93, t), Math.PI - sd * mix(-0.3, 0.6, t), 0.011 + 0.012 * sstep(0.7, 1, t)); }
    const m = refs.length - 1;
    tube(S, mat, W, { pts, seg: 6, steps: 30, r: [0.013, 0.003], ref: (u) => refs[Math.min(m, Math.round(u * m))], flat0: true, flat1: true });
    stud(S, 'button', W, torsoPt(L, c, 0.445, sd * 0.42, 0.016), v(sd * 0.4, 0, 1).normalize(), 0.008);
  }
}

// satchel on the hip with a strap across the chest: flap, buckle strap, side gussets
export function satchel(S, L, c) {
  const [y0, y1] = torsoSpan(L);
  const T = TR(L, c);
  const x = -0.17 * L.bw, y = L.H + 0.01, W = ['hips', ['thighR', 1.6]];
  const p = v(x - 0.03, y, 0.02);
  const sq = (t) => Math.sign(t) * Math.pow(Math.abs(t), 0.55);
  blob(S, 'satchel', W, { c: p, r: [1, 1, 1], ws: 16, hs: 12, fn: (d, pp) => { pp.set(sq(d.x) * 0.036, sq(d.y) * 0.075, sq(d.z) * 0.1); }, shade: (d) => (d.x < -0.3 && d.y > -0.15 ? 0.8 : 1) });
  band(S, 'strap', W, [p.clone().add(v(-0.038, 0.07, 0.03)), p.clone().add(v(-0.04, 0, 0.03)), p.clone().add(v(-0.04, -0.05, 0.03))], { closed: false, t: 0.003, w: 0.011, ref: v(0, 0, 1), steps: 4 });
  stud(S, 'buckle', W, p.clone().add(v(-0.043, -0.03, 0.03)), v(-1, 0, 0), 0.011, { flat: 0.4 });
  // rolled scroll tucked under the flap
  tube(S, 'paper', W, { pts: [p.clone().add(v(0, 0.082, -0.11)), p.clone().add(v(0, 0.086, 0.11))], seg: 8, steps: 2, r: 0.016, cap0: 0.3, cap1: 0.3, ref: v(0, 1, 0) });
  const pts = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    const a = mix(-1.1, 2.3, t);
    const yy = mix(y + 0.06, L.NY - 0.02, Math.sin(t * Math.PI * 0.5));
    const uu = sat01((yy - y0) / (y1 - y0));
    pts.push(v(Math.sin(a) * (T.rx(uu) + 0.016), yy, Math.cos(a) * (T.rz(uu) + 0.018) + T.oz(uu)));
  }
  tube(S, 'strap', ['hips', 'spine', 'chest'], { pts, seg: 6, steps: 24, r: [0.004, 0.016], ref: () => v(0, 1, 0) });
}

// ---------------------------------------------------------------------------
// Hats (bound to the head)
export function hat(S, L, c, kind) {
  const hr = L.hr, HC = L.HC;
  const W = ['head'];
  if (kind === 'witch') {
    const by = HC.y + hr * 0.62, cz = HC.z - 0.01;
    // wavy drooping brim with a turned rim
    const B = (a, vv, out) => { const r = mix(hr * 1.0, hr * 2.4, vv); const droop = vv * vv * hr * 0.28 * (0.6 + 0.4 * Math.sin(a * 3 + 1)); return out.set(Math.sin(a) * r, by - droop - Math.cos(a) * vv * hr * 0.14 + 0.02 * hr * Math.sin(a * 7) * vv, cz + Math.cos(a) * r); };
    sheet(S, 'hat', W, { nu: 48, nv: 5, wrap: true, thick: 0.012, fn: (u, vv, out) => B(u * TAU, vv, out), inside: (p) => v(p.x, p.y - 1, p.z), innerShade: 0.7, shade: (u, vv) => 1 - 0.1 * sstep(0.25, 0, vv) });
    const rim = [];
    for (let k = 0; k < 40; k++) rim.push(B((k / 40) * TAU, 1.0, new V3()));
    tube(S, 'hatBand', W, { pts: rim, closed: true, seg: 5, steps: 80, r: 0.006 });
    // bent, crumpled cone
    const pts = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push(v(0.12 * hr * t * t, by + t * hr * 3.5 - t * t * hr * 0.6, cz - t * t * hr * 1.6)); }
    const cr = (u, a) => Math.sin(a * 2 + u * 21) * bump(u, 0.45, 0.14) + 0.6 * Math.sin(a * 3 - u * 30) * bump(u, 0.72, 0.1);
    tube(S, 'hat', W, { pts, seg: 22, steps: 22, r: (u) => { const r = hr * 1.03 * Math.pow(1 - u, 0.85) + 0.004; return [r, r]; }, shape: (u, a) => 1 + 0.07 * cr(u, a), shade: (u, a) => 1 - 0.14 * Math.max(0, -cr(u, a)), flat0: true, cap1: 0.5, ref: v(0, 0, 1) });
    const bp = [];
    for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; bp.push(v(Math.sin(a) * hr * 0.99, by + hr * 0.15, cz + Math.cos(a) * hr * 0.99)); }
    band(S, 'hatBand', W, bp, { t: 0.006, w: hr * 0.13, steps: 32 });
    // buckle on the band, a star charm dangling from the tip
    const f = v(Math.sin(0.5) * hr * 1.03, by + hr * 0.15, cz + Math.cos(0.5) * hr * 1.03), fn = v(Math.sin(0.5), 0, Math.cos(0.5)), ft = v(fn.z, 0, -fn.x);
    const fp = [];
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU, e = supEll(a, 4); fp.push(f.clone().addScaledVector(ft, Math.cos(a) * e * hr * 0.17).add(v(0, Math.sin(a) * e * hr * 0.17, 0))); }
    tube(S, 'gold', W, { pts: fp, closed: true, seg: 5, steps: 16, r: 0.005, ref: fn });
    const tip = pts[8];
    tube(S, 'cord', W, { pts: [tip, tip.clone().add(v(0, -hr * 0.3, -hr * 0.05))], seg: 4, steps: 2, r: 0.002, ol: 0.3 });
    stud(S, 'gold', W, tip.clone().add(v(0, -hr * 0.36, -hr * 0.05)), v(1, 0, 0), hr * 0.1, { flat: 0.5, ws: 5, hs: 4 });
  } else if (kind === 'cap') {
    // six-panel cap with a button, sweatband and stiff peak
    const cc = HC.clone().add(v(0, hr * 0.5, -hr * 0.06));
    blob(S, 'hat', W, { c: cc, r: [hr * 1.1, hr * 0.74, hr * 1.14], ws: 30, hs: 14, skip: (d) => d.y < -0.08, fn: (d, p) => { const lon = Math.atan2(d.x, d.z); p.multiplyScalar(1 - 0.025 * Math.pow(Math.abs(Math.cos(lon * 3)), 12) * sstep(1, 0.6, d.y)); }, shade: (d) => 1 - 0.2 * Math.pow(Math.abs(Math.cos(Math.atan2(d.x, d.z) * 3)), 12) * sstep(1, 0.7, d.y) });
    const bp = [];
    for (let k = 0; k < 20; k++) { const a = (k / 20) * TAU; bp.push(cc.clone().add(v(Math.sin(a) * hr * 1.105, -hr * 0.04, Math.cos(a) * hr * 1.145))); }
    band(S, 'hatBand', W, bp, { t: 0.005, w: hr * 0.075, steps: 40 });
    sheet(S, 'hatBand', W, { nu: 16, nv: 4, thick: 0.01, fn: (u, vv, out) => { const a = mix(-1.05, 1.05, u); const r = mix(hr * 1.08, hr * 1.8, vv) * (1 - 0.12 * vv * Math.pow(Math.abs(u - 0.5) * 2, 2)); out.set(Math.sin(a) * r, cc.y - hr * 0.03 - vv * hr * 0.08 - hr * 0.1 * vv * Math.pow(Math.abs(u - 0.5) * 2, 2), cc.z + Math.cos(a) * r * 0.96); }, inside: (p) => v(p.x, p.y - 1, p.z), innerShade: 0.7 });
    stud(S, 'hatBand', W, cc.clone().add(v(0, hr * 0.745, 0)), v(0, 1, 0), hr * 0.11, { flat: 0.6 });
  } else if (kind === 'scarf') {
    // kerchief tied at the nape: rolled edge round the face, knot and two tails
    blob(S, 'hat', W, { c: HC.clone().add(v(0, hr * 0.14, -hr * 0.06)), r: [hr * 1.15, hr * 1.12, hr * 1.16], ws: 30, hs: 20, skip: (d) => d.z > 0.3 && d.y < 0.5 - Math.abs(d.x) * 0.3, fn: (d, p) => { const lon = Math.atan2(d.x, d.z); p.multiplyScalar(1 + 0.022 * Math.sin(lon * 7 + d.y * 5)); if (d.y < -0.3) p.multiplyScalar(0.94); }, shade: (d) => 1 - 0.1 * Math.max(0, -Math.sin(Math.atan2(d.x, d.z) * 7 + d.y * 5)) });
    const pts = [];
    for (let k = 0; k < 14; k++) { const a = mix(-1.35, 1.35, k / 13); pts.push(HC.clone().add(v(Math.sin(a) * hr * 1.06, hr * 0.5 * Math.cos(a) - hr * 0.08 + (Math.abs(a) > 1 ? -hr * 0.4 * (Math.abs(a) - 1) : 0), hr * 0.32 + Math.cos(a) * hr * 0.5))); }
    tube(S, 'hatBand', W, { pts, seg: 8, steps: 28, r: hr * 0.085, cap0: 1, cap1: 1 });
    const kn = HC.clone().add(v(0, -hr * 0.2, -hr * 1.14));
    blob(S, 'hat', W, { c: kn, r: [hr * 0.28, hr * 0.2, hr * 0.18], ws: 12, hs: 8 });
    for (const sd of [1, -1]) tuft(S, L, 'hat', W, kn.clone().add(v(sd * hr * 0.1, 0, 0)), v(sd * 0.5, -1, -0.35), hr * 0.85, { w: hr * 0.17, t: hr * 0.03, droop: 0.3, sw: sd * 0.2, out: v(0, 0, -1), taper: 5, root: 0.4, nfn: null, tip: 0.85 });
  } else if (kind === 'helmet') {
    const cc = HC.clone().add(v(0, hr * 0.12, -hr * 0.02));
    blob(S, 'metal', W, {
      c: cc, r: [hr * 1.14, hr * 1.18, hr * 1.2], ws: 32, hs: 22,
      fn: (d, p) => {
        // crest ridge, flared neck guard, cheek plates
        p.multiplyScalar(1 + 0.06 * Math.exp(-(d.x * d.x) / 0.01) * sstep(-0.2, 0.5, d.y));
        if (d.y < -0.2) { p.x *= 1 + 0.12 * sstep(-0.2, -0.9, d.y); p.z *= 1 + 0.12 * sstep(-0.2, -0.9, d.y) * (d.z < 0 ? 1 : 0.4); }
        if (d.z > 0.4) p.z -= hr * 0.08 * Math.exp(-((d.y - 0.02) ** 2) / 0.004);   // visor slit
      },
    });
    tube(S, 'visor', W, { pts: [HC.clone().add(v(-hr * 0.62, hr * 0.12, hr * 0.95)), HC.clone().add(v(0, hr * 0.14, hr * 1.14)), HC.clone().add(v(hr * 0.62, hr * 0.12, hr * 0.95))], seg: 6, steps: 12, r: [hr * 0.035, hr * 0.02], ref: v(0, 0, 1) });
    const pts = [], brow = [];
    for (let k = 0; k < 20; k++) { const a = (k / 20) * TAU; pts.push(HC.clone().add(v(Math.sin(a) * hr * 1.22, -hr * 0.5 - hr * 0.1 * Math.cos(a), Math.cos(a) * hr * 1.24 - hr * 0.02))); }
    tube(S, 'trim', W, { pts, closed: true, seg: 6, steps: 40, r: hr * 0.05, ref: v(0, 1, 0) });
    for (let k = 0; k <= 10; k++) { const a = mix(-1.3, 1.3, k / 10); brow.push(cc.clone().add(v(Math.sin(a) * hr * 1.16, hr * 0.3, Math.cos(a) * hr * 1.2))); }
    tube(S, 'trim', W, { pts: brow, seg: 6, steps: 20, r: hr * 0.035, cap0: 1, cap1: 1 });
    for (const sd of [1, -1]) stud(S, 'trim', W, cc.clone().add(v(sd * hr * 1.13, hr * 0.02, hr * 0.2)), v(sd, 0, 0.15), hr * 0.09);
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
  tube(S, 'plume', ['head', ...ch.names], { pts: P, seg: 14, steps: 22, r: (u) => [hr * (0.12 + 0.25 * Math.sin(Math.min(1, u * 1.3) * Math.PI) * (1 - u * 0.4)) + 0.004, hr * 0.12 * (1 - u * 0.5) + 0.004], ref: v(1, 0, 0), shape: (u, a) => 1 + 0.12 * Math.sin(a * 2) + 0.1 * Math.sin(u * 60 + a * 3), shade: (u, a) => 1 - 0.16 * Math.max(0, -Math.sin(u * 60 + a * 3)), cap0: 1, cap1: 1 });
}

// ---------------------------------------------------------------------------
// Armor: plates on the bones with rolled trims and rivets
export function armor(S, L, c) {
  const [y0, y1] = torsoSpan(L);
  const T = TR(L, c);
  const TW = ['spine', 'chest', ['hips', 1.6]];
  // breastplate with a keel, trimmed at the neck and waist
  tube(S, 'metal', TW, {
    curve: new THREE.CatmullRomCurve3([v(0, mix(y0, y1, 0.34), 0.004), v(0, mix(y0, y1, 0.62), 0.01), v(0, mix(y0, y1, 0.9), 0.0)]), seg: 30, steps: 12,
    r: (u) => { const uu = mix(0.34, 0.9, u); return [T.rx(uu) + 0.022, T.rz(uu) + 0.026]; }, off: (u) => [0, T.oz(mix(0.34, 0.9, u))],
    shape: (u, a) => supEll(a, 2.4) * (1 + 0.07 * Math.exp(-((a - Math.PI / 2) ** 2) / 0.03) * Math.sin(u * Math.PI)),
  });
  band(S, 'trim', TW, girdle(L, c, 0.36, 0.03, 28), { t: 0.007, w: 0.014 });
  band(S, 'trim', ['chest', 'neck'], girdle(L, c, 0.9, 0.03, 28, (g) => -0.05 * Math.pow(Math.max(0, Math.cos(g)), 2)), { t: 0.006, w: 0.01 });
  for (const g of [-0.55, 0.55]) stud(S, 'trim', TW, torsoPt(L, c, 0.72, g, 0.03), v(Math.sin(g), 0, Math.cos(g)), 0.011);
  // gorget
  tube(S, 'metal', ['chest', 'neck'], { pts: [v(0, L.NY - 0.03, -0.004), v(0, L.NY + 0.045, 0)], seg: 20, steps: 3, r: (u) => [mix(0.085, 0.062, u), mix(0.08, 0.06, u)] });
  // tassets: overlapping hip plates
  for (let k = 0; k < 7; k++) {
    const g = (k / 7) * TAU + 0.45;
    sheet(S, 'metal', ['hips', ['thighL', 1.3], ['thighR', 1.3]], {
      nu: 5, nv: 4, thick: 0.012, top: true,
      fn: (u, vv, out) => { torsoPt(L, c, 0.34 - vv * 0.02, g + (u - 0.5) * 0.95, 0.03 + vv * 0.05 + (k % 2) * 0.008, out); out.y -= vv * 0.17 * (1 - 0.25 * Math.pow(Math.abs(u - 0.5) * 2, 2)); },
      inside: (p) => v(0, p.y, 0), shade: (u, vv) => (vv > 0.86 ? 0.75 : 1),
    });
  }
  for (const sd of [1, -1]) {
    const n = sd > 0 ? 'L' : 'R';
    const sp = S.skel.pos('arm' + n);
    // layered pauldrons, each lame rimmed
    for (let k = 0; k < 3; k++) {
      const cc = sp.clone().add(v(sd * (0.02 + k * 0.012), 0.028 - k * 0.045, 0));
      blob(S, 'metal', ['arm' + n, ['clav' + n, 1.3]], { c: cc, r: [0.088 + k * 0.005, 0.062, 0.088], ws: 18, hs: 10, skip: (d) => d.y < -0.35 || d.x * sd < -0.55, shade: (d) => (d.y < -0.22 ? 0.72 : 1) });
    }
    const el = S.skel.pos('fore' + n), wr = S.skel.pos('hand' + n);
    tube(S, 'metal', ['fore' + n], { pts: [el.clone().lerp(wr, 0.2), wr.clone().lerp(el, -0.05)], seg: 16, steps: 4, r: (u) => [mix(0.05, 0.06, u * u), mix(0.05, 0.058, u * u)], cap0: 0.3, cap1: 0.3 });
    band(S, 'trim', ['fore' + n], [el.clone().lerp(wr, 0.22), el.clone().lerp(wr, 0.28)], { closed: false, seg: 16, steps: 1, t: 0.054, w: 0.054, ref: v(0, 0, 1) });
    stud(S, 'metal', ['fore' + n, 'arm' + n], el.clone().add(v(0, 0, -0.045)), v(0, 0, -1), 0.04, { flat: 0.7, ws: 10 });
    const kn = S.skel.pos('shin' + n), an = S.skel.pos('foot' + n);
    tube(S, 'metal', ['shin' + n], { pts: [kn.clone().add(v(0, 0.02, 0.01)), an.clone().lerp(kn, 0.35)], seg: 16, steps: 5, r: (u) => [mix(0.068, 0.058, u), mix(0.07, 0.06, u)], off: () => [0, 0.006], cap0: 0.4 });
    blob(S, 'metal', ['shin' + n, ['thigh' + n, 1.3]], { c: kn.clone().add(v(0, 0.01, 0.045)), r: [0.052, 0.055, 0.038], ws: 14, hs: 10, fn: (d, p) => { p.z += 0.012 * Math.exp(-(d.x * d.x) / 0.05); } });
    band(S, 'trim', ['shin' + n], [an.clone().lerp(kn, 0.4), an.clone().lerp(kn, 0.34)], { closed: false, seg: 16, steps: 1, t: 0.062, w: 0.064, ref: v(0, 0, 1) });
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
    tube(S, 'wood', 'r', { pts: [v(0, 0, z0), v(0.004, 0.003, (z0 + z1) / 2), v(0, 0, z1 - 0.1)], seg: 12, steps: 26, ref: v(0, 1, 0), r: (u) => { const r = mix(0.019, 0.025, u) * (1 + 0.1 * Math.sin(u * 70) * sstep(0.2, 0.3, u) * sstep(0.44, 0.34, u)); return [r, r]; }, shape: (u, a) => 1 + 0.05 * vnoise3(u * 30, Math.cos(a) * 2, Math.sin(a) * 2), cap0: 0.6 });
    // ferrule, grip wrap with a turk's-head at each end
    tube(S, 'band', 'r', { pts: [v(0, 0, z0 - 0.004), v(0, 0, z0 + 0.05)], seg: 12, steps: 2, ref: v(0, 1, 0), r: 0.023, cap0: 0.7 });
    tube(S, 'wrap', 'r', { pts: [v(0, 0, -0.1), v(0, 0, 0.12)], seg: 12, steps: 12, ref: v(0, 1, 0), r: 0.027, shape: (u, a) => 1 + 0.1 * Math.abs(Math.sin(u * 25 + a * 0.5)), shade: (u, a) => 1 - 0.2 * Math.pow(Math.abs(Math.cos(u * 25 + a * 0.5)), 4) });
    for (const z of [-0.105, 0.125]) tube(S, 'band', 'r', { pts: [v(0, 0, z - 0.008), v(0, 0, z + 0.008)], seg: 12, steps: 1, ref: v(0, 1, 0), r: 0.03 });
    // spiral crook around the gem
    const pts = [];
    const cz = z1 + 0.02;
    for (let k = 0; k <= 16; k++) { const t = k / 16; const a = t * Math.PI * 1.75 - 0.4; const r = mix(0.11, 0.06, t); pts.push(v(Math.sin(a) * r * 0.55, Math.cos(a) * r, cz + (1 - Math.cos(a)) * 0.05 + t * 0.02 - 0.1 * (1 - t) * (1 - t))); }
    pts.unshift(v(0, 0, z1 - 0.14));
    tube(S, 'wood', 'r', { pts, seg: 10, steps: 40, ref: v(1, 0, 0), r: (u) => { const r = mix(0.026, 0.011, u); return [r, r * 0.9]; }, cap1: 1 });
    // carved leaves at the collar
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU;
      tube(S, 'leaf', 'r', { pts: [v(Math.cos(a) * 0.02, Math.sin(a) * 0.02, z1 - 0.14), v(Math.cos(a) * 0.047, Math.sin(a) * 0.047, z1 - 0.06), v(Math.cos(a) * 0.036, Math.sin(a) * 0.036, z1 + 0.005)], seg: 6, steps: 8, r: (u) => [0.016 * Math.sin(u * Math.PI) + 0.002, 0.004], ref: v(Math.cos(a), Math.sin(a), 0) });
    }
    tube(S, 'band', 'r', { pts: [v(0, 0, z1 - 0.19), v(0, 0, z1 - 0.15)], seg: 12, steps: 2, ref: v(0, 1, 0), r: 0.03 });
  }, { wood: 0x7a5436, wrap: 0x8a3a30, leaf: 0xc8a050, band: 0xc8a050 });
}
export function gemGeo() {
  // elongated faceted crystal
  const g = new THREE.OctahedronGeometry(0.06, 0);
  g.scale(0.85, 1.5, 0.85);   // long axis along Y (the rig tilts it onto the staff; player spins it about Y)
  return g.index ? g.toNonIndexed() : g;
}
