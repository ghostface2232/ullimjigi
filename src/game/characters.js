// Procedural characters with hierarchical rigs and procedural animation.
import * as THREE from 'three';
import { toon, addOutline, glowMat, ghostMat, fresnelMat } from '../render/materials.js';
import { damp, clamp, lerp, rand } from '../core/util.js';

const cap = (r, l, seg = 8) => new THREE.CapsuleGeometry(r, l, 4, seg);
const sph = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);

function M(color, o = {}) { return toon(color, { rim: o.rim ?? 0.35, ...o }); }
function part(geo, mat, parent, x = 0, y = 0, z = 0, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (o.sx || o.sy || o.sz) m.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  if (o.rx) m.rotation.x = o.rx; if (o.ry) m.rotation.y = o.ry; if (o.rz) m.rotation.z = o.rz;
  m.castShadow = o.cast ?? true; m.receiveShadow = false;
  parent.add(m);
  if (o.outline) addOutline(m, o.outline);
  return m;
}

// ------------------------------------------------------------------
// Rig: shared animation for humanoids
// ------------------------------------------------------------------
export class Rig {
  constructor() {
    this.root = new THREE.Group();
    this.phase = 0; this.t = rand() * 10;
    this.blinkT = 2 + rand() * 3; this.blink = 0;
    this.w = { cast: 0, air: 0, glide: 0, talk: 0, swim: 0, sit: 0, kneel: 0, hurt: 0, wave: 0, spread: 0, down: 0, stagger: 0, shock: 0, panic: 0, dead: 0 };
    this.castFlick = 0;
    this.scarfSeg = [];
    this.lookYaw = 0; this.lookPitch = 0;
  }
  update(dt, s = {}) {
    this.t += dt;
    const P = this.p;
    if (!P) return;
    const speed = s.speed ?? 0;
    const W = this.w;
    W.cast = damp(W.cast, s.cast ? 1 : 0, s.cast ? 18 : 6, dt);
    W.air = damp(W.air, s.grounded === false && !s.glide && !s.swim ? 1 : 0, 10, dt);
    W.glide = damp(W.glide, s.glide ? 1 : 0, 8, dt);
    W.swim = damp(W.swim, s.swim ? 1 : 0, 6, dt);
    W.talk = damp(W.talk, s.talk ? 1 : 0, 8, dt);
    W.sit = damp(W.sit, s.sit ? 1 : 0, 4, dt);
    W.kneel = damp(W.kneel, s.kneel ? 1 : 0, 4, dt);
    W.hurt = Math.max(0, W.hurt - dt * 4);
    W.wave = damp(W.wave, s.wave ? 1 : 0, 6, dt);
    W.spread = damp(W.spread, s.spread ? 1 : 0, 6, dt);
    // hit-reaction weights (enemies): knocked down, staggered, shocked, burning panic, dead
    W.down = damp(W.down, s.down ? 1 : 0, s.down ? 14 : 5, dt);
    W.stagger = damp(W.stagger, s.stagger ? 1 : 0, 8, dt);
    W.shock = damp(W.shock, s.shock ? 1 : 0, 20, dt);
    W.panic = damp(W.panic, s.panic ? 1 : 0, 10, dt);
    W.dead = damp(W.dead, s.dead ? 1 : 0, 7, dt);
    this.castFlick = Math.max(0, this.castFlick - dt * 7);

    const stride = this.stride ?? 1.7;
    this.phase += dt * speed * stride * (W.swim > 0.5 ? 0.5 : 1);
    const run = clamp(speed / 6, 0, 1.3);
    const amp = clamp(speed / 4, 0, 1) * (0.65 + run * 0.35) * (1 - W.air) * (1 - W.glide) * (1 - W.sit);
    const sw = Math.sin(this.phase);
    const idle = 1 - clamp(speed / 1.5, 0, 1);
    const breathe = Math.sin(this.t * 2.2) * 0.012 * idle;

    // legs
    let lL = sw * amp * 0.9, lR = -sw * amp * 0.9;
    lL = lerp(lL, -0.55, W.air); lR = lerp(lR, 0.35, W.air);
    lL = lerp(lL, 0.25, W.glide); lR = lerp(lR, 0.45, W.glide);
    const kick = Math.sin(this.t * 7) * 0.4;
    lL = lerp(lL, kick, W.swim); lR = lerp(lR, -kick, W.swim);
    lL = lerp(lL, -1.5, W.sit); lR = lerp(lR, -1.5, W.sit);
    lL = lerp(lL, -1.4, W.kneel); lR = lerp(lR, 0.1, W.kneel);
    const lie = Math.max(W.down, W.dead);
    lL = lerp(lL, -0.25 + Math.sin(this.t * 3) * 0.05 * W.down, lie); lR = lerp(lR, 0.15, lie);
    const sk = W.shock * 0.35;
    if (sk > 0.01) { lL += (rand() - 0.5) * sk; lR += (rand() - 0.5) * sk; }
    P.legL.rotation.x = lL; P.legR.rotation.x = lR;
    if (P.shinL) {
      P.shinL.rotation.x = (Math.max(0, -Math.cos(this.phase) * amp * 0.9) + W.air * 0.9 + W.sit * 1.5 + W.kneel * 1.5) * (1 - lie) + lie * 0.5;
      P.shinR.rotation.x = (Math.max(0, Math.cos(this.phase) * amp * 0.9) + W.air * 0.4 + W.sit * 1.5 + W.kneel * 0.2) * (1 - lie) + lie * 0.15;
    }
    // hips bob & lean
    const bob = Math.abs(Math.cos(this.phase)) * 0.05 * amp;
    P.hips.position.y = this.hipY + bob - amp * 0.03 - W.sit * (this.hipY * 0.45) - W.kneel * this.hipY * 0.35 + breathe * 0.5;
    P.hips.rotation.y = sw * amp * 0.12;
    let lean = amp * 0.12 + (this.hunch ?? 0) + W.glide * 0.5 + W.swim * 1.1 - W.cast * 0.08 + W.kneel * 0.25;
    lean += W.stagger * (0.35 + Math.sin(this.t * 4.3) * 0.12) - W.panic * 0.2 - lie * (this.hunch ?? 0) * 0.8;
    P.torso.rotation.x = damp(P.torso.rotation.x, lean, 10, dt) - W.hurt * 0.35;
    P.torso.rotation.y = -sw * amp * 0.18 + W.cast * 0.35 + (s.twist ?? 0) + Math.sin(this.t * 11) * 0.25 * W.panic;
    P.torso.rotation.z = Math.sin(this.t * 2.6) * 0.12 * W.stagger + (W.shock > 0.01 ? (rand() - 0.5) * 0.25 * W.shock : 0);
    P.torso.scale.y = 1 + breathe;

    // arms
    let aL = -sw * amp * 0.8, aR = sw * amp * 0.8;
    let zL = 0.08, zR = -0.08;
    aL = lerp(aL, -0.3, W.air); aR = lerp(aR, -0.3, W.air); zL = lerp(zL, 0.5, W.air); zR = lerp(zR, -0.5, W.air);
    aL = lerp(aL, 0, W.glide); aR = lerp(aR, 0, W.glide); zL = lerp(zL, 1.35, W.glide); zR = lerp(zR, -1.35, W.glide);
    zL = lerp(zL, 1.2, W.spread); zR = lerp(zR, -1.2, W.spread); aL = lerp(aL, -0.4, W.spread); aR = lerp(aR, -0.4, W.spread);
    const stroke = Math.sin(this.t * 5);
    aL = lerp(aL, -1.5 + stroke * 0.8, W.swim); aR = lerp(aR, -1.5 - stroke * 0.8, W.swim);
    aL = lerp(aL, -0.6, W.sit); aR = lerp(aR, -0.6, W.sit);
    // talk gesture
    const gest = Math.sin(this.t * 3.1) * 0.25 * W.talk;
    aR += -0.35 * W.talk + gest; zR -= 0.15 * W.talk;
    // wave
    aL = lerp(aL, -2.6, W.wave); zL = lerp(zL, 0.3 + Math.sin(this.t * 9) * 0.35 * W.wave, W.wave);
    // cast pose (right arm forward, pointing)
    const pitch = s.aimPitch ?? 0;
    aR = lerp(aR, -1.35 - pitch - this.castFlick * 0.35, W.cast); zR = lerp(zR, -0.1, W.cast);
    aL = lerp(aL, -0.5 - this.castFlick * 0.3, W.cast * 0.6); zL = lerp(zL, 0.35, W.cast * 0.6);
    // reactions
    aL = lerp(aL, -2.7 + Math.sin(this.t * 17) * 0.7, W.panic); aR = lerp(aR, -2.7 + Math.sin(this.t * 17 + 2.1) * 0.7, W.panic);
    zL = lerp(zL, -0.45 - Math.sin(this.t * 13) * 0.35, W.panic); zR = lerp(zR, 0.45 + Math.sin(this.t * 13 + 1) * 0.35, W.panic);
    aL = lerp(aL, 0.25 + Math.sin(this.t * 3.1) * 0.15, W.stagger); aR = lerp(aR, 0.2 + Math.sin(this.t * 3.4 + 1) * 0.15, W.stagger);
    aL = lerp(aL, -2.4, lie); aR = lerp(aR, -2.2, lie); zL = lerp(zL, -0.6, lie); zR = lerp(zR, 0.6, lie);
    if (W.shock > 0.01) { aL += (rand() - 0.5) * 0.9 * W.shock; aR += (rand() - 0.5) * 0.9 * W.shock; zL = lerp(zL, -0.9, W.shock); zR = lerp(zR, 0.9, W.shock); }
    const hurt = W.hurt;
    P.armL.rotation.set(aL - hurt * 0.4, 0, zL + hurt * 0.5);
    P.armR.rotation.set(aR - hurt * 0.4, 0, zR - hurt * 0.5);
    if (P.foreL) { P.foreL.rotation.x = -0.25 - amp * 0.3 - W.swim * 0.5 - W.wave * 0.4; P.foreR.rotation.x = lerp(-0.25 - amp * 0.3, -0.15, W.cast); }
    if (P.staff) P.staff.rotation.x = lerp(0.15, 2.55 + pitch * 0.2, W.cast);

    // head
    const hy = clamp(this.lookYaw, -1.1, 1.1), hp = clamp(this.lookPitch, -0.5, 0.5);
    P.head.rotation.y = damp(P.head.rotation.y, hy, 8, dt);
    P.head.rotation.x = damp(P.head.rotation.x, hp + Math.sin(this.t * 4.5) * 0.06 * W.talk - W.swim * 0.9 - (this.hunch ?? 0) * 0.6 + W.stagger * 0.5 - W.panic * 0.4, 8, dt);
    if (W.panic > 0.01) P.head.rotation.y += Math.sin(this.t * 15) * 0.5 * W.panic;
    P.head.rotation.z = Math.sin(this.t * 1.7) * 0.03 * W.talk;
    // blink
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 0.14; this.blinkT = 2.5 + rand() * 3.5; }
    if (this.blink > 0) this.blink -= dt;
    const ey = this.blink > 0 ? 0.12 : 1;
    if (P.eyes) for (const e of P.eyes) e.scale.y = e.userData.sy * ey;
    if (P.mouth) P.mouth.scale.y = W.talk > 0.1 ? 0.5 + Math.abs(Math.sin(this.t * 14)) * 2 * W.talk : 0.5;

    // cape & scarf secondary motion
    const vy = s.vy ?? 0;
    if (P.cape) {
      const target = clamp(0.12 + speed * 0.07 + Math.max(0, -vy) * 0.04 + W.glide * 0.9, 0, 1.35);
      P.cape.rotation.x = damp(P.cape.rotation.x, target + Math.sin(this.t * 6 + speed) * 0.05 * (0.3 + run), 8, dt);
    }
    if (this.scarfSeg.length) {
      for (let i = 0; i < this.scarfSeg.length; i++) {
        const seg = this.scarfSeg[i];
        const tgt = (0.3 + speed * 0.1 + W.glide * 0.6) * (i === 0 ? 1 : 0.35) + Math.sin(this.t * 8 - i * 0.9) * 0.12 * (0.4 + run);
        seg.rotation.x = damp(seg.rotation.x, tgt, 10 - i, dt);
        seg.rotation.z = Math.sin(this.t * 5.3 - i * 1.1) * 0.12 * (0.3 + run);
      }
    }
    if (P.skirt) P.skirt.rotation.x = damp(P.skirt.rotation.x, -amp * 0.1, 8, dt);
  }
  hurt() { this.w.hurt = 1; }
  flick() { this.castFlick = 1; }
}

// ------------------------------------------------------------------
// Humanoid builder
// ------------------------------------------------------------------
export function makeHumanoid(c = {}) {
  const rig = new Rig();
  const s = c.scale ?? 1;
  const ol = c.outline ? 0.012 : 0;
  const body = new THREE.Group(); body.scale.setScalar(s); rig.root.add(body);
  const P = (rig.p = {});
  const skin = M(c.skin ?? 0xf2cfae, { rim: 0.4 });
  const top = M(c.top ?? 0xe8dcc0);
  const pants = M(c.pants ?? 0x5a4a3a);
  const boots = M(c.boots ?? 0x5a3e2a);
  const legLen = c.legLen ?? 0.78;
  rig.hipY = legLen + 0.06; rig.hunch = c.hunch ?? 0;
  rig.stride = c.stride ?? 1.7 / s;
  const hips = (P.hips = new THREE.Group()); hips.position.y = rig.hipY; body.add(hips);
  const bw = c.bodyW ?? 1;
  // legs
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(side * 0.1 * bw, -0.02, 0); hips.add(leg);
    part(cap(0.075 * bw, legLen * 0.42), pants, leg, 0, -legLen * 0.25, 0, { outline: ol });
    const shin = new THREE.Group(); shin.position.y = -legLen * 0.5; leg.add(shin);
    part(cap(0.065 * bw, legLen * 0.38), pants, shin, 0, -legLen * 0.22, 0);
    part(new THREE.BoxGeometry(0.14 * bw, 0.12, 0.25), boots, shin, 0, -legLen * 0.46, 0.04, { outline: ol });
    if (side < 0) { P.legL = leg; P.shinL = shin; } else { P.legR = leg; P.shinR = shin; }
  }
  // skirt / robe
  if (c.robe) {
    const len = c.robeLen ?? legLen * 0.8;
    const pts = [[0.18, 0.12], [0.21, 0], [0.27 * (c.robeFlare ?? 1), -len * 0.6], [0.32 * (c.robeFlare ?? 1), -len]].map(([x, y]) => new THREE.Vector2(x * bw, y));
    const sk = part(new THREE.LatheGeometry(pts, 14), M(c.robe, { side: THREE.DoubleSide }), hips, 0, 0.02, 0, { outline: ol });
    P.skirt = sk;
  }
  // torso
  const torso = (P.torso = new THREE.Group()); torso.position.y = 0.02; hips.add(torso);
  const chest = part(cap(0.165 * bw, 0.26, 10), top, torso, 0, 0.27, 0, { sz: 0.78, outline: ol });
  void chest;
  if (c.belly) part(sph(0.2 * bw), top, torso, 0, 0.16, 0.04, { sy: 0.9 });
  part(new THREE.TorusGeometry(0.155 * bw, 0.03, 6, 16), M(c.belt ?? 0x6a4a2a), torso, 0, 0.08, 0, { rx: Math.PI / 2, sz: 0.8, sx: 1, cast: false });
  if (c.vest) part(cap(0.172 * bw, 0.2, 10), M(c.vest), torso, 0, 0.3, 0, { sz: 0.8, sx: 1.02 });
  if (c.apron) part(new THREE.BoxGeometry(0.28, 0.5, 0.02), M(c.apron), torso, 0, 0.0, 0.15, { rx: 0.1 });
  // cape
  if (c.cape) {
    const capeG = new THREE.Group(); capeG.position.set(0, 0.5, -0.13); torso.add(capeG);
    const cl = c.capeLen ?? 0.75, th = Math.PI * 0.75;
    const g = new THREE.CylinderGeometry(0.19 * bw, 0.27 * bw, cl, 12, 3, true, Math.PI - th / 2, th);
    g.translate(0, -cl / 2, 0.12);
    const cm = part(g, M(c.cape, { side: THREE.DoubleSide }), capeG, 0, 0, 0, { outline: 0 });
    void cm;
    P.cape = capeG;
  }
  // neck & head
  const neck = new THREE.Group(); neck.position.y = 0.52; torso.add(neck);
  part(cap(0.05, 0.06), skin, neck, 0, 0.02, 0);
  const head = (P.head = new THREE.Group()); head.position.y = 0.18; neck.add(head);
  const hr = c.headR ?? 0.165;
  part(sph(hr, 18, 14), skin, head, 0, 0, 0, { sy: 1.04, outline: ol });
  // face
  P.eyes = [];
  const eyeM = M(c.eyeColor ?? 0x2a1e1a, { rim: 0 });
  for (const side of [-1, 1]) {
    const e = part(sph(1, 8, 6), eyeM, head, side * hr * 0.36, hr * 0.08, hr * 0.9, { sx: 0.024, sy: 0.036, sz: 0.012, cast: false });
    e.userData.sy = 0.036; P.eyes.push(e);
    const hl = part(sph(1, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), e, 0.3, 0.35, 0.6, { sx: 0.35, sy: 0.3, sz: 0.3, cast: false });
    void hl;
    if (c.brows) part(new THREE.BoxGeometry(0.05, 0.012, 0.01), M(c.hair ?? 0x5a3a24), head, side * hr * 0.37, hr * 0.33, hr * 0.93, { rz: side * -0.15, cast: false });
    if (c.blush) part(sph(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xf4a09a, transparent: true, opacity: 0.55 }), head, side * hr * 0.55, -hr * 0.15, hr * 0.8, { sx: 0.035, sy: 0.02, sz: 0.01, cast: false });
  }
  part(sph(hr * 0.13, 8, 6), skin, head, 0, -hr * 0.12, hr * 0.98, { cast: false });
  P.mouth = part(new THREE.BoxGeometry(0.045, 0.01, 0.01), M(0x5a2a2a, { rim: 0 }), head, 0, -hr * 0.42, hr * 0.92, { cast: false });
  if (c.glasses) {
    for (const side of [-1, 1]) part(new THREE.TorusGeometry(0.038, 0.007, 6, 14), M(0x3a3028), head, side * hr * 0.37, hr * 0.08, hr * 0.98, { cast: false });
    part(new THREE.BoxGeometry(0.035, 0.007, 0.007), M(0x3a3028), head, 0, hr * 0.1, hr * 1.0, { cast: false });
  }
  // hair
  const hairM = M(c.hair ?? 0x5a3a24, { rim: 0.5 });
  const hs = c.hairStyle ?? 'short';
  if (hs !== 'bald') part(sph(hr * 1.06, 16, 12, 0), hairM, head, 0, hr * 0.12, -hr * 0.1, { sy: 0.95, outline: ol });
  if (hs === 'bun') part(sph(hr * 0.5), hairM, head, 0, hr * 0.75, -hr * 0.55);
  if (hs === 'bob') { part(sph(hr * 1.12), hairM, head, 0, -hr * 0.1, -hr * 0.12, { sy: 1.05, outline: ol }); part(new THREE.BoxGeometry(hr * 1.6, hr * 0.35, hr * 0.4), hairM, head, 0, hr * 0.62, hr * 0.62, { rx: 0.4 }); }
  if (hs === 'long') { part(cap(hr * 0.75, hr * 2.2), hairM, head, 0, -hr * 1.3, -hr * 0.55, { sz: 0.6 }); }
  if (hs === 'fringe' || hs === 'short') part(new THREE.BoxGeometry(hr * 1.5, hr * 0.35, hr * 0.5), hairM, head, 0, hr * 0.6, hr * 0.6, { rx: 0.5 });
  if (hs === 'spiky') for (let i = 0; i < 5; i++) part(new THREE.ConeGeometry(hr * 0.3, hr * 0.8, 5), hairM, head, (i - 2) * hr * 0.35, hr * 0.8, 0, { rz: (i - 2) * -0.3, rx: -0.2 });
  if (c.beard) part(new THREE.ConeGeometry(hr * 0.8, hr * 2.4, 8), M(c.beard), head, 0, -hr * 1.1, hr * 0.45, { rx: Math.PI + 0.35, outline: ol });
  if (c.mustache) part(new THREE.BoxGeometry(hr * 1.1, hr * 0.2, hr * 0.25), M(c.beard ?? c.hair), head, 0, -hr * 0.3, hr * 0.92);
  // hats
  if (c.hat === 'witch') {
    const hm = M(c.hatColor ?? 0x5a3a8a, { rim: 0.5 });
    part(new THREE.CylinderGeometry(hr * 2.3, hr * 2.3, 0.025, 20), hm, head, 0, hr * 0.62, -0.01, { rx: -0.1, outline: ol });
    const cg = new THREE.ConeGeometry(hr * 1.05, hr * 3.8, 12, 6);
    const p = cg.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) + hr * 1.9, t = y / (hr * 3.8); p.setZ(i, p.getZ(i) - t * t * hr * 1.6); p.setY(i, p.getY(i) - t * t * hr * 0.4); }
    cg.computeVertexNormals();
    part(cg, hm, head, 0, hr * 0.62 + hr * 1.9, -0.02, { rx: -0.1, outline: ol });
    part(new THREE.TorusGeometry(hr * 1.02, 0.018, 6, 16), M(c.hatBand ?? 0xd8b060), head, 0, hr * 0.7, -0.01, { rx: Math.PI / 2 - 0.1 });
  } else if (c.hat === 'hood') {
    const hm = M(c.hatColor ?? 0x2f4a7a, { rim: 0.5, side: THREE.DoubleSide });
    part(new THREE.SphereGeometry(hr * 1.25, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hm, head, 0, hr * 0.05, -hr * 0.12, { rx: -0.35, outline: ol });
    part(new THREE.ConeGeometry(hr * 0.55, hr * 1.6, 8), hm, head, 0, hr * 0.2, -hr * 1.35, { rx: -2.0 });
  } else if (c.hat === 'cap') {
    const hm = M(c.hatColor ?? 0xe07a3a);
    part(new THREE.SphereGeometry(hr * 1.1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), hm, head, 0, hr * 0.2, 0, { outline: ol });
    part(new THREE.BoxGeometry(hr * 1.4, 0.02, hr * 0.9), hm, head, 0, hr * 0.25, hr * 1.0, { rx: -0.1 });
  } else if (c.hat === 'scarf') {
    const hm = M(c.hatColor ?? 0xd06050);
    part(new THREE.SphereGeometry(hr * 1.12, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hm, head, 0, hr * 0.12, -hr * 0.05, { rx: -0.25, outline: ol });
    part(new THREE.SphereGeometry(hr * 0.35, 8, 6), hm, head, 0, hr * 0.1, -hr * 1.1);
  } else if (c.hat === 'helmet') {
    const hm = M(c.hatColor ?? 0x8a8a92, { rim: 0.7 });
    part(sph(hr * 1.2), hm, head, 0, hr * 0.12, 0, { sy: 1.1, outline: ol });
    part(new THREE.BoxGeometry(hr * 1.6, hr * 0.18, hr * 0.2), M(0x1a1a20), head, 0, hr * 0.05, hr * 1.12);
    part(new THREE.BoxGeometry(hr * 0.2, hr * 1.2, hr * 2.2), M(c.plume ?? 0xc03a3a), head, 0, hr * 1.25, -hr * 0.2);
  }
  // arms
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * 0.23 * bw, 0.44, 0); torso.add(arm);
    part(cap(0.055 * bw, 0.2), c.sleeve ? M(c.sleeve) : top, arm, 0, -0.14, 0, { outline: ol });
    const fore = new THREE.Group(); fore.position.y = -0.29; arm.add(fore);
    part(cap(0.05 * bw, 0.18), c.sleeve ? M(c.sleeve) : top, fore, 0, -0.12, 0);
    if (c.sleeveFlare) part(new THREE.ConeGeometry(0.1, 0.18, 10, 1, true), M(c.sleeve ?? c.top, { side: THREE.DoubleSide }), fore, 0, -0.2, 0, { rx: Math.PI });
    const hand = part(sph(0.048 * bw, 10, 8), skin, fore, 0, -0.27, 0);
    if (side < 0) { P.armL = arm; P.foreL = fore; P.handL = hand; } else { P.armR = arm; P.foreR = fore; P.handR = hand; }
  }
  // scarf
  if (c.scarf) {
    const sm = M(c.scarf, { side: THREE.DoubleSide });
    part(new THREE.TorusGeometry(0.1, 0.045, 8, 16), sm, neck, 0, 0.0, 0, { rx: Math.PI / 2 + 0.2, outline: ol });
    let parent = new THREE.Group(); parent.position.set(0.05, -0.02, -0.1); neck.add(parent);
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group(); parent.add(seg);
      part(new THREE.BoxGeometry(0.09, 0.14, 0.02), sm, seg, 0, -0.07, 0);
      rig.scarfSeg.push(seg);
      const next = new THREE.Group(); next.position.y = -0.14; seg.add(next); parent = next;
    }
  }
  // staff
  if (c.staff) {
    const st = (P.staff = new THREE.Group()); st.position.set(0, -0.27, 0.05); P.foreR.add(st);
    const wood = M(c.staff.wood ?? 0x7a5436);
    part(new THREE.CylinderGeometry(0.022, 0.028, 1.5, 6), wood, st, 0, 0.3, 0, { outline: ol * 0.6 });
    const curl = part(new THREE.TorusGeometry(0.1, 0.022, 6, 12, Math.PI * 1.4), wood, st, 0.05, 1.12, 0, { rz: -0.4 });
    void curl;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.6, 3) }));
    gem.position.set(0, 1.12, 0); st.add(gem);
    P.gem = gem;
    const tip = new THREE.Object3D(); tip.position.set(0, 1.15, 0); st.add(tip); P.tip = tip;
  }
  if (c.cane) {
    const st = new THREE.Group(); st.position.set(0, -0.27, 0.05); P.foreR.add(st);
    part(new THREE.CylinderGeometry(0.02, 0.022, 1.1, 6), M(0x6a4a30), st, 0, 0.0, 0);
    const lan = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), glowMat(0xffc060, 2.5)); lan.position.set(0, 0.6, 0); st.add(lan);
    P.staff = null;
  }
  if (c.spear) {
    const st = new THREE.Group(); st.position.set(0, -0.27, 0.03); P.foreR.add(st);
    part(new THREE.CylinderGeometry(0.02, 0.022, 2.1, 6), M(0x7a5a3a), st, 0, 0.5, 0);
    part(new THREE.ConeGeometry(0.05, 0.25, 4), M(0xc0c0c8, { rim: 0.8 }), st, 0, 1.65, 0);
  }
  if (c.book) {
    const bk = part(new THREE.BoxGeometry(0.16, 0.2, 0.04), M(0x8a3a3a), P.foreL, 0, -0.28, 0.06, { rx: -0.6 });
    void bk;
  }
  if (c.satchel) part(new THREE.BoxGeometry(0.2, 0.18, 0.08), M(0x8a6a44), hips, 0.2, 0.05, 0.02, { rz: 0.2 });
  rig.body = body;
  rig.height = (rig.hipY + 0.9) * s;
  return rig;
}

// ------------------------------------------------------------------
// Preset characters
// ------------------------------------------------------------------
export const CHAR = {
  player: { skin: 0xf3d2b2, top: 0xeee2c4, pants: 0x3e4a5e, boots: 0x6a4a30, hair: 0x5a3a26, hairStyle: 'fringe', hat: 'hood', hatColor: 0x2f5a8a, cape: 0x2f5a8a, capeLen: 0.58, scarf: 0xc8463c, staff: {}, belt: 0x7a5a38, sleeve: 0xeee2c4, outline: true, brows: true },
  mora: { scale: 0.86, skin: 0xefcdb4, top: 0x6a4a8a, robe: 0x5a3a7a, robeLen: 0.72, robeFlare: 1.3, pants: 0x3a2a4a, hair: 0xe8e4e0, hairStyle: 'bun', hat: 'witch', hatColor: 0x4a3070, hatBand: 0xd8a860, hunch: 0.28, glasses: true, cane: true, sleeve: 0x6a4a8a, sleeveFlare: true, blush: true, outline: true, cape: 0x8a6a5a, capeLen: 0.5 },
  bau: { scale: 1.08, bodyW: 1.35, belly: true, skin: 0xe6b894, top: 0x8a6a4a, vest: 0x5a4030, pants: 0x4a3a2a, hairStyle: 'bald', beard: 0xf0f0f0, mustache: true, spear: true, brows: true, outline: true },
  dodam: { scale: 0.68, skin: 0xf6d6b8, top: 0x6aa0d8, pants: 0x7a5a3a, hair: 0x3a2a1a, hairStyle: 'spiky', hat: 'cap', hatColor: 0xe07a3a, blush: true, outline: true, stride: 2.6, headR: 0.19 },
  isol: { scale: 1.02, skin: 0xf0d0b4, top: 0x3f7a5a, sleeve: 0x3f7a5a, pants: 0x3a3a44, hair: 0x2a2030, hairStyle: 'bob', glasses: true, book: true, satchel: true, scarf: 0xd8c070, outline: true },
  danbi: { scale: 0.96, bodyW: 1.25, belly: true, skin: 0xf0c8a4, top: 0xd87a5a, robe: 0xc06a4a, robeLen: 0.7, apron: 0xf4ecd8, hair: 0x6a3a24, hat: 'scarf', hatColor: 0xe8c050, blush: true, outline: true },
  villagerA: { scale: 1.0, skin: 0xe8c0a0, top: 0x9a7a4a, pants: 0x4a4a3a, hair: 0x2a2a2a, hairStyle: 'short', outline: true },
  villagerB: { scale: 0.95, skin: 0xf2d0b0, top: 0x7a9a6a, robe: 0x5a7a5a, pants: 0x3a3a2a, hair: 0x8a5a2a, hairStyle: 'long', outline: true },
  villagerC: { scale: 0.9, skin: 0xe0b890, top: 0xa05a4a, pants: 0x4a3a3a, hair: 0xd0d0d0, hairStyle: 'short', beard: 0xd0d0d0, hunch: 0.2, cane: true, outline: true },
  seha: { scale: 0.98, skin: 0xf2d4b8, top: 0xdde8f4, robe: 0x9ac0e0, robeLen: 0.78, hair: 0x5a3a26, hairStyle: 'long', scarf: 0xc8463c, outline: false },
  kael: { scale: 1.18, bodyW: 1.2, skin: 0xe0c0a0, top: 0x7a7a88, pants: 0x4a4a54, hat: 'helmet', hatColor: 0x9a9aa8, plume: 0x3a6ad0, cape: 0x2a4a9a, capeLen: 0.95, outline: false },
};

export function makeGhost(rig, color = 0xbfe8ff, alpha = 0.6) {
  const gm = ghostMat(color, alpha);
  rig.root.traverse((o) => { if (o.isMesh) { o.material = gm; o.castShadow = false; } });
  rig.ghostMat = gm;
  return rig;
}

// ------------------------------------------------------------------
// Boreum — fox spirit of the west wind
// ------------------------------------------------------------------
export function makeFox() {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const fur = toon(0xf4fbff, { emissive: 0x3a8a9a, emissiveIntensity: 0.6, rim: 1.2 });
  const inner = toon(0xbff4ff, { emissive: 0x6ad8e8, emissiveIntensity: 0.8, rim: 1 });
  part(sph(0.22, 14, 10), fur, body, 0, 0, 0, { sx: 0.85, sy: 0.8, sz: 1.3 });
  const head = new THREE.Group(); head.position.set(0, 0.16, 0.26); body.add(head);
  part(sph(0.16, 14, 10), fur, head, 0, 0, 0, { sx: 1.05 });
  part(new THREE.ConeGeometry(0.07, 0.18, 8), fur, head, 0, -0.03, 0.17, { rx: Math.PI / 2 });
  part(sph(0.025, 6, 4), new THREE.MeshBasicMaterial({ color: 0x1a2a3a }), head, 0, -0.02, 0.26);
  for (const sx of [-1, 1]) {
    part(new THREE.ConeGeometry(0.06, 0.18, 6), fur, head, sx * 0.09, 0.15, -0.02, { rz: -sx * 0.25 });
    part(new THREE.ConeGeometry(0.035, 0.1, 6), inner, head, sx * 0.09, 0.14, 0.01, { rz: -sx * 0.25 });
    const e = part(sph(1, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.2, 1.6) }), head, sx * 0.065, 0.03, 0.13, { sx: 0.022, sy: 0.03, sz: 0.01 });
    void e;
  }
  for (const [x, z] of [[-0.09, 0.14], [0.09, 0.14], [-0.09, -0.14], [0.09, -0.14]]) part(cap(0.035, 0.12), fur, body, x, -0.18, z);
  const tails = [];
  for (let i = 0; i < 3; i++) {
    const tg = new THREE.Group(); tg.position.set(0, 0.05, -0.26); tg.rotation.y = (i - 1) * 0.5; body.add(tg);
    let par = tg; const segs = [];
    for (let k = 0; k < 4; k++) {
      const sg = new THREE.Group(); sg.position.z = k === 0 ? 0 : -0.12; par.add(sg);
      part(sph(0.075 - k * 0.008, 10, 8), k === 3 ? inner : fur, sg, 0, 0, -0.06, { sz: 1.6 });
      segs.push(sg); par = sg;
    }
    const tip = new THREE.Mesh(sph(0.06, 8, 6), glowMat(0x9ff4ff, 2.5)); tip.position.z = -0.14; par.add(tip);
    tails.push(segs);
  }
  const aura = new THREE.Mesh(sph(0.42, 16, 12), fresnelMat(0x000000, 0x7ae8ff, { intensity: 0.28, power: 3 }));
  body.add(aura);
  const rig = { root, body, head, tails, t: 0 };
  rig.update = (dt, s = {}) => {
    rig.t += dt;
    body.position.y = Math.sin(rig.t * 2.2) * 0.08;
    body.rotation.z = Math.sin(rig.t * 1.3) * 0.05;
    head.rotation.y = damp(head.rotation.y, s.lookYaw ?? 0, 5, dt);
    head.rotation.x = Math.sin(rig.t * 1.7) * 0.08 + (s.talk ? Math.sin(rig.t * 12) * 0.08 : 0);
    tails.forEach((segs, i) => segs.forEach((sg, k) => {
      sg.rotation.x = Math.sin(rig.t * 3 + i + k * 0.7) * 0.25 + 0.2;
      sg.rotation.y = Math.sin(rig.t * 2.3 + i * 2 + k * 0.9) * 0.3;
    }));
  };
  return rig;
}

export function makeCat() {
  const root = new THREE.Group();
  const orange = toon(0xe8913a, { rim: 0.5 }), cream = toon(0xfff0d8);
  part(cap(0.1, 0.22), orange, root, 0, 0.16, 0, { rx: Math.PI / 2 });
  const head = new THREE.Group(); head.position.set(0, 0.28, 0.2); root.add(head);
  part(sph(0.1, 12, 10), orange, head);
  part(sph(0.06, 8, 6), cream, head, 0, -0.03, 0.06);
  for (const sx of [-1, 1]) {
    part(new THREE.ConeGeometry(0.04, 0.08, 4), orange, head, sx * 0.055, 0.09, 0, { rz: -sx * 0.2 });
    part(sph(1, 6, 4), new THREE.MeshBasicMaterial({ color: 0x1a2a1a }), head, sx * 0.04, 0.02, 0.09, { sx: 0.015, sy: 0.022, sz: 0.01 });
  }
  for (const [x, z] of [[-0.06, 0.12], [0.06, 0.12], [-0.06, -0.12], [0.06, -0.12]]) part(cap(0.028, 0.1), orange, root, x, 0.05, z);
  const tail = new THREE.Group(); tail.position.set(0, 0.2, -0.2); root.add(tail);
  part(cap(0.022, 0.25), orange, tail, 0, 0.12, -0.04, { rx: -0.5 });
  const rig = { root, head, tail, t: 0 };
  rig.update = (dt) => { rig.t += dt; tail.rotation.z = Math.sin(rig.t * 3) * 0.4; head.rotation.y = Math.sin(rig.t * 0.7) * 0.4; };
  return rig;
}

// ------------------------------------------------------------------
// Enemy bodies (materials are per-instance for hit flashes)
// ------------------------------------------------------------------
function EM(color, o = {}) { return toon(color, { nocache: true, rim: o.rim ?? 0.6, ...o }); }

export function makeAshling(variant = 'normal') {
  const rig = new Rig();
  const P = (rig.p = {});
  const frost = variant === 'frost';
  const bodyC = frost ? 0x4a5a70 : 0x3a3444, glowC = frost ? 0x8fe3ff : 0xc9a0ff;
  const mats = [];
  const bm = EM(bodyC, { rim: 0.8 }); mats.push(bm);
  const dm = EM(frost ? 0x2a3a50 : 0x241f2c, { rim: 0.6 }); mats.push(dm);
  const eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(glowC).multiplyScalar(3) });
  rig.hipY = 0.72; rig.hunch = 0.55; rig.stride = 2.0;
  const hips = (P.hips = new THREE.Group()); hips.position.y = rig.hipY; rig.root.add(hips);
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(side * 0.13, 0, 0); hips.add(leg);
    part(cap(0.07, 0.3), dm, leg, 0, -0.2, 0);
    const shin = new THREE.Group(); shin.position.y = -0.38; leg.add(shin);
    part(cap(0.055, 0.28), dm, shin, 0, -0.16, 0.02, { rx: -0.2 });
    part(new THREE.ConeGeometry(0.06, 0.18, 4), bm, shin, 0, -0.34, 0.1, { rx: Math.PI / 2 });
    if (side < 0) { P.legL = leg; P.shinL = shin; } else { P.legR = leg; P.shinR = shin; }
  }
  const torso = (P.torso = new THREE.Group()); hips.add(torso);
  part(sph(0.26, 12, 10), bm, torso, 0, 0.28, 0, { sy: 1.2, sz: 0.85 });
  for (let i = 0; i < 5; i++) part(new THREE.ConeGeometry(0.06, 0.32 - i * 0.03, 4), dm, torso, (i % 2 ? 0.08 : -0.08), 0.52 - i * 0.07, -0.2, { rx: -1.0 - i * 0.1 });
  const core = part(new THREE.OctahedronGeometry(0.07, 0), eye, torso, 0, 0.3, 0.22, { cast: false });
  P.core = core;
  const head = (P.head = new THREE.Group()); head.position.set(0, 0.62, 0.08); torso.add(head);
  part(sph(0.17, 12, 10), bm, head, 0, 0, 0, { sy: 0.9, sz: 1.1 });
  part(new THREE.ConeGeometry(0.05, 0.22, 4), dm, head, -0.1, 0.14, -0.05, { rz: 0.5, rx: -0.4 });
  part(new THREE.ConeGeometry(0.05, 0.22, 4), dm, head, 0.1, 0.14, -0.05, { rz: -0.5, rx: -0.4 });
  P.eyes = [];
  for (const sx of [-1, 1]) {
    const e = part(sph(1, 8, 6), eye, head, sx * 0.065, 0.02, 0.16, { sx: 0.035, sy: 0.022, sz: 0.01, cast: false, rz: sx * 0.3 });
    e.userData.sy = 0.022; P.eyes.push(e);
  }
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * 0.28, 0.42, 0); torso.add(arm);
    part(cap(0.06, 0.32), bm, arm, 0, -0.22, 0);
    const fore = new THREE.Group(); fore.position.y = -0.44; arm.add(fore);
    part(cap(0.05, 0.3), dm, fore, 0, -0.18, 0);
    for (let k = 0; k < 3; k++) part(new THREE.ConeGeometry(0.02, 0.18, 4), bm, fore, (k - 1) * 0.035, -0.42, 0.02, { rx: Math.PI + 0.3 });
    if (side < 0) { P.armL = arm; P.foreL = fore; } else { P.armR = arm; P.foreR = fore; }
  }
  rig.mats = mats; rig.eyeMat = eye; rig.glowMats = [eye]; rig.height = 1.5;
  return rig;
}

export function makeWailer() {
  const root = new THREE.Group();
  const mats = [];
  const mask = EM(0xe8e0d0, { rim: 0.9 }); mats.push(mask);
  const cloth = EM(0x2e2838, { rim: 0.5, side: THREE.DoubleSide }); mats.push(cloth);
  const body = new THREE.Group(); root.add(body);
  const m = part(new THREE.SphereGeometry(0.42, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), mask, body, 0, 0, 0, { rx: -0.2 });
  void m;
  const eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.2, 3.2) });
  const eyes = [];
  for (const sx of [-1, 1]) {
    part(sph(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0x0a0610 }), body, sx * 0.15, 0.12, 0.36, { sx: 0.09, sy: 0.12, sz: 0.04, cast: false });
    eyes.push(part(sph(1, 8, 6), eye, body, sx * 0.15, 0.1, 0.39, { sx: 0.035, sy: 0.04, sz: 0.02, cast: false }));
  }
  part(sph(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0x0a0610 }), body, 0, -0.08, 0.38, { sx: 0.1, sy: 0.05, sz: 0.03, cast: false });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI - Math.PI / 2;
    part(new THREE.ConeGeometry(0.05, 0.35, 4), cloth, body, Math.sin(a) * 0.32, 0.32 + Math.cos(a) * 0.1, -0.05, { rz: -Math.sin(a) * 0.8 });
  }
  const strips = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const g = new THREE.Group(); g.position.set(Math.cos(a) * 0.28, -0.05, Math.sin(a) * 0.22); body.add(g);
    const pg = new THREE.PlaneGeometry(0.16, 1.1, 1, 4); pg.translate(0, -0.55, 0);
    part(pg, cloth, g, 0, 0, 0, { ry: -a + Math.PI / 2 });
    strips.push(g);
  }
  const core = new THREE.Mesh(sph(0.12, 10, 8), glowMat(0xb070ff, 2.5, { nocache: true }));
  core.position.y = -0.2; body.add(core);
  const rig = { root, body, strips, core, eyes, mats, t: rand() * 5, height: 1.2, glowMats: [eye, core.material] };
  rig.update = (dt, s = {}) => {
    rig.t += dt;
    body.position.y = Math.sin(rig.t * 2) * 0.12;
    body.rotation.z = Math.sin(rig.t * 1.4) * 0.08;
    body.rotation.x = -0.1 + (s.charge ?? 0) * -0.3;
    strips.forEach((g, i) => { g.rotation.x = Math.sin(rig.t * 3 + i) * 0.3 + (s.speed ?? 0) * 0.08; g.rotation.z = Math.sin(rig.t * 2.4 + i * 1.3) * 0.2; });
    const c = s.charge ?? 0;
    core.scale.setScalar(1 + c * 1.2 + Math.sin(rig.t * 8) * 0.08);
  };
  return rig;
}

export function makeBrute(variant = 'normal') {
  const rig = new Rig();
  const P = (rig.p = {});
  const frost = variant === 'frost';
  const mats = [];
  const bm = EM(frost ? 0x5a6a80 : 0x4a4250, { rim: 0.7 }); mats.push(bm);
  const rock = EM(frost ? 0xbfe8ff : 0x7a7068, { rim: 0.5, flat: true, emissive: frost ? 0x2a5a7a : 0x000000 }); mats.push(rock);
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(frost ? 0x8fe3ff : 0xc080ff).multiplyScalar(2.5) });
  rig.hipY = 1.1; rig.hunch = 0.35; rig.stride = 1.1;
  const hips = (P.hips = new THREE.Group()); hips.position.y = rig.hipY; rig.root.add(hips);
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(side * 0.35, 0, 0); hips.add(leg);
    part(cap(0.2, 0.4), bm, leg, 0, -0.3, 0);
    const shin = new THREE.Group(); shin.position.y = -0.6; leg.add(shin);
    part(cap(0.18, 0.3), bm, shin, 0, -0.2, 0);
    part(new THREE.DodecahedronGeometry(0.24, 0), rock, shin, 0, -0.42, 0.05, { sy: 0.6 });
    if (side < 0) { P.legL = leg; P.shinL = shin; } else { P.legR = leg; P.shinR = shin; }
  }
  const torso = (P.torso = new THREE.Group()); hips.add(torso);
  part(sph(0.7, 14, 12), bm, torso, 0, 0.6, 0, { sx: 1.15, sy: 1.0, sz: 0.85 });
  const armor = [];
  for (const [x, y, z, s] of [[0, 1.0, -0.4, 0.55], [-0.6, 1.1, -0.1, 0.45], [0.6, 1.1, -0.1, 0.45], [-0.3, 0.6, -0.55, 0.4], [0.35, 0.55, -0.55, 0.38], [0, 0.4, 0.5, 0.35]]) {
    armor.push(part(new THREE.DodecahedronGeometry(s, 0), rock, torso, x, y, z, { rx: x, ry: y }));
  }
  if (frost) for (let i = 0; i < 5; i++) part(new THREE.OctahedronGeometry(0.25, 0), rock, torso, (i - 2) * 0.22, 1.35 + (i % 2) * 0.2, -0.35, { sy: 2.2, rz: (i - 2) * 0.2 });
  for (let i = 0; i < 4; i++) part(new THREE.BoxGeometry(0.04, 0.5, 0.04), glow, torso, -0.3 + i * 0.2, 0.55 + (i % 2) * 0.2, 0.6, { rz: (i - 1.5) * 0.4, cast: false });
  P.core = part(new THREE.OctahedronGeometry(0.14, 0), glow, torso, 0, 0.75, 0.62, { cast: false });
  const head = (P.head = new THREE.Group()); head.position.set(0, 1.3, 0.35); torso.add(head);
  part(sph(0.26, 12, 10), bm, head, 0, 0, 0, { sy: 0.8 });
  P.eyes = [];
  for (const sx of [-1, 1]) {
    const e = part(sph(1, 8, 6), glow, head, sx * 0.1, 0.02, 0.22, { sx: 0.05, sy: 0.025, sz: 0.01, cast: false });
    e.userData.sy = 0.025; P.eyes.push(e);
  }
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * 0.85, 1.0, 0); torso.add(arm);
    part(cap(0.2, 0.5), bm, arm, 0, -0.35, 0);
    const fore = new THREE.Group(); fore.position.y = -0.7; arm.add(fore);
    part(cap(0.22, 0.45), bm, fore, 0, -0.3, 0);
    part(new THREE.DodecahedronGeometry(0.38, 0), rock, fore, 0, -0.75, 0.05);
    if (side < 0) { P.armL = arm; P.foreL = fore; } else { P.armR = arm; P.foreR = fore; }
  }
  rig.mats = mats; rig.armor = armor; rig.glowMat = glow; rig.glowMats = [glow]; rig.height = 2.9;
  return rig;
}

export function makeKnight(spectral = false) {
  const rig = makeHumanoid({ ...CHAR.kael, scale: 1.4, outline: false });
  const P = rig.p;
  const mats = [];
  // ashen recolor with per-instance materials
  rig.root.traverse((o) => {
    if (o.isMesh && o.material && o.material.isMeshToonMaterial) {
      const c = o.material.color.clone();
      if (!spectral) c.lerp(new THREE.Color(0x3a3444), 0.55);
      o.material = toon(c.getHex(), { nocache: true, rim: 0.8 });
      mats.push(o.material);
    }
  });
  // pauldrons & breastplate
  const armor = EM(spectral ? 0xa0c0ff : 0x5a5664, { rim: 0.9 }); mats.push(armor);
  for (const sx of [-1, 1]) part(sph(0.13, 10, 8), armor, P.torso, sx * 0.25, 0.46, 0, { sy: 0.8 });
  part(cap(0.18, 0.2, 10), armor, P.torso, 0, 0.3, 0.02, { sz: 0.8 });
  // greatsword in right hand
  const sword = new THREE.Group(); sword.position.set(0, -0.28, 0.05); P.foreR.add(sword);
  const blade = EM(spectral ? 0xd0e8ff : 0x8a8a9a, { rim: 1.2 }); mats.push(blade);
  part(new THREE.BoxGeometry(0.07, 1.25, 0.018), blade, sword, 0, 0.75, 0);
  part(new THREE.BoxGeometry(0.34, 0.05, 0.06), armor, sword, 0, 0.12, 0);
  part(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6), EM(0x3a2a2a), sword, 0, 0.0, 0);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.2, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(spectral ? 0x9ad0ff : 0xffd84a).multiplyScalar(2.5) }));
  edge.position.set(0.04, 0.78, 0); sword.add(edge);
  P.sword = sword; P.swordEdge = edge;
  // glowing cracks
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(spectral ? 0x9ad0ff : 0xb080ff).multiplyScalar(2.5) });
  for (let i = 0; i < 3; i++) part(new THREE.BoxGeometry(0.02, 0.2, 0.02), glow, P.torso, -0.08 + i * 0.08, 0.3 + i * 0.05, 0.16, { rz: (i - 1) * 0.5, cast: false });
  P.eyes.forEach((e) => { e.material = glow; });
  rig.mats = mats; rig.glowMat = glow; rig.glowMats = spectral ? [] : [glow]; rig.height = 2.4;
  if (spectral) makeGhost(rig, 0x9ad0ff, 0.7);
  return rig;
}

// ------------------------------------------------------------------
// 잿물 — ash ooze (slime). variant: ash | fire | frost
// ------------------------------------------------------------------
const OOZE = {
  ash: { body: 0x4a3a66, glow: 0xd8b0ff, emi: 0x1c1030 },
  fire: { body: 0xd8502a, glow: 0xffc040, emi: 0x6a1a04 },
  frost: { body: 0x7ec8f0, glow: 0xe0fbff, emi: 0x1a5a80 },
  water: { body: 0x2f7ae0, glow: 0xa8e4ff, emi: 0x08285e },
};
export function makeOoze(variant = 'ash', size = 1) {
  const C = OOZE[variant];
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const geo = new THREE.IcosahedronGeometry(0.62, 3);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + Math.sin(x * 7) * 0.05 + Math.cos(z * 6 + y * 3) * 0.05;
    p.setXYZ(i, x * n, (y < 0 ? y * 0.55 : y) * n, z * n);
  }
  geo.computeVertexNormals();
  const mat = EM(C.body, { rim: 1.6, emissive: C.emi, transparent: true, opacity: 0.8 });
  const blob = new THREE.Mesh(geo, mat); blob.position.y = 0.36; blob.castShadow = true; body.add(blob);
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(C.glow).multiplyScalar(2.4) });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), glow); core.position.y = 0.34; body.add(core);
  const eyes = [];
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(sph(1, 8, 6), glow); e.scale.set(0.07, 0.1, 0.04); e.position.set(sx * 0.19, 0.52, 0.54); e.rotation.z = sx * 0.4; body.add(e); eyes.push(e); }
  const mouth = new THREE.Mesh(sph(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0x10060a })); mouth.scale.set(0.16, 0.05, 0.04); mouth.position.set(0, 0.34, 0.58); body.add(mouth);
  // drips
  const drips = [];
  for (let i = 0; i < 5; i++) {
    const d = new THREE.Mesh(sph(0.1, 8, 6), mat);
    const a = (i / 5) * Math.PI * 2;
    d.position.set(Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.55); body.add(d); drips.push(d);
  }
  root.scale.setScalar(size);
  const rig = { root, body, blob, core, mats: [mat], glowMats: [glow], t: rand() * 5, height: 0.9 * size, squash: 0 };
  rig.update = (dt, s = {}) => {
    rig.t += dt;
    rig.squash = damp(rig.squash, s.squash ?? 0, 12, dt);
    const q = rig.squash + Math.sin(rig.t * 4) * 0.04;
    body.scale.set(1 - q * 0.35, 1 + q, 1 - q * 0.35);
    core.rotation.y += dt * 2; core.position.y = 0.34 + Math.sin(rig.t * 3) * 0.04;
    drips.forEach((d, i) => { d.scale.setScalar(0.8 + Math.sin(rig.t * 3 + i) * 0.25); });
  };
  return rig;
}

// ------------------------------------------------------------------
// 재나방 — ash moth
// ------------------------------------------------------------------
export function makeMoth() {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const bm = EM(0x3a3240, { rim: 0.9 });
  const wm = EM(0x6a6072, { rim: 0.6, side: THREE.DoubleSide, emissive: 0x100818 });
  part(cap(0.07, 0.3), bm, body, 0, 0, 0, { rx: Math.PI / 2 });
  part(sph(0.08, 8, 6), bm, body, 0, 0.02, 0.2);
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc9a0ff).multiplyScalar(2.6) });
  for (const sx of [-1, 1]) part(sph(0.025, 6, 4), glow, body, sx * 0.04, 0.05, 0.26, { cast: false });
  for (const sx of [-1, 1]) part(new THREE.ConeGeometry(0.01, 0.2, 3), bm, body, sx * 0.04, 0.12, 0.28, { rx: -0.6, rz: -sx * 0.4 });
  const wings = [];
  for (const sx of [-1, 1]) for (const back of [0, 1]) {
    const piv = new THREE.Group(); piv.position.set(sx * 0.05, 0.03, back ? -0.06 : 0.06); body.add(piv);
    const g = new THREE.CircleGeometry(back ? 0.22 : 0.3, 7); g.scale(1, 0.7, 1); g.translate(sx * (back ? 0.2 : 0.27), 0, 0); g.rotateX(-Math.PI / 2);
    const w = new THREE.Mesh(g, wm); w.castShadow = true; piv.add(w);
    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.05, 8), glow); spot.rotation.x = -Math.PI / 2; spot.position.set(sx * (back ? 0.2 : 0.28), 0.005, 0); piv.add(spot);
    wings.push({ piv, sx, back });
  }
  const rig = { root, body, wings, mats: [bm, wm], glowMats: [glow], t: rand() * 5, height: 0.4 };
  rig.update = (dt, s = {}) => {
    rig.t += dt;
    if (s.dead) {
      // wings fold and twitch as it drops
      wings.forEach((w) => { w.piv.rotation.z = damp(w.piv.rotation.z, w.sx * -0.9 + Math.sin(rig.t * 30) * 0.05, 6, dt); });
      body.rotation.x = damp(body.rotation.x, 1.1, 4, dt);
      return;
    }
    const f = s.dive ? 38 : s.shock ? 60 : 22;
    wings.forEach((w) => { w.piv.rotation.z = w.sx * (Math.sin(rig.t * f + (w.back ? 0.6 : 0)) * 0.9 + 0.1); });
    body.rotation.x = s.dive ? 0.5 : Math.sin(rig.t * 2) * 0.15;
    body.position.y = Math.sin(rig.t * 5) * 0.05;
  };
  return rig;
}

// ------------------------------------------------------------------
// 방패지기 — a forgotten gate guard that still hides behind its tower shield
// ------------------------------------------------------------------
export function makeShieldBearer() {
  const rig = new Rig();
  const P = (rig.p = {});
  const mats = [];
  const bodyM = EM(0x3b3546, { rim: 0.7 }); mats.push(bodyM);
  const dark = EM(0x26212e, { rim: 0.5 }); mats.push(dark);
  const metal = EM(0x6a6670, { rim: 1.0 }); mats.push(metal);
  const bronze = EM(0x7a6044, { rim: 0.9 }); mats.push(bronze);
  const cloth = EM(0x4f3040, { rim: 0.4, side: THREE.DoubleSide }); mats.push(cloth);
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc9a0ff).multiplyScalar(2.6) });
  rig.hipY = 0.92; rig.hunch = 0.12; rig.stride = 1.45;
  const hips = (P.hips = new THREE.Group()); hips.position.y = rig.hipY; rig.root.add(hips);
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(side * 0.17, -0.02, 0); hips.add(leg);
    part(cap(0.1, 0.34), dark, leg, 0, -0.22, 0);
    const shin = new THREE.Group(); shin.position.y = -0.46; leg.add(shin);
    part(cap(0.085, 0.3), dark, shin, 0, -0.2, 0);
    part(new THREE.BoxGeometry(0.2, 0.14, 0.3), metal, shin, 0, -0.4, 0.05);
    part(sph(0.1, 8, 6), metal, shin, 0, 0.02, 0.07, { sz: 0.6 });
    if (side < 0) { P.legL = leg; P.shinL = shin; } else { P.legR = leg; P.shinR = shin; }
  }
  part(new THREE.CylinderGeometry(0.27, 0.38, 0.52, 10, 1, true), cloth, hips, 0, -0.17, 0);
  const torso = (P.torso = new THREE.Group()); torso.position.y = 0.02; hips.add(torso);
  part(sph(0.34, 14, 10), bodyM, torso, 0, 0.36, 0, { sx: 1.05, sy: 1.1, sz: 0.78 });
  part(cap(0.3, 0.2, 12), metal, torso, 0, 0.42, 0.05, { sz: 0.7, sx: 1.08 });
  for (const sx of [-1, 1]) part(sph(0.18, 10, 8), metal, torso, sx * 0.37, 0.64, 0, { sy: 0.72 });
  for (let i = 0; i < 3; i++) part(new THREE.BoxGeometry(0.02, 0.16, 0.02), glow, torso, -0.07 + i * 0.07, 0.4 + (i % 2) * 0.06, 0.28, { rz: (i - 1) * 0.6, cast: false });
  // helm with a glowing visor slit
  const head = (P.head = new THREE.Group()); head.position.set(0, 0.82, 0.02); torso.add(head);
  part(sph(0.2, 14, 10), metal, head, 0, 0.02, 0, { sy: 1.2 });
  part(new THREE.CylinderGeometry(0.22, 0.24, 0.06, 12), metal, head, 0, -0.13, 0);
  part(new THREE.BoxGeometry(0.3, 0.04, 0.06), dark, head, 0, 0.03, 0.17, { cast: false });
  P.eyes = [];
  for (const sx of [-1, 1]) {
    const e = part(sph(1, 8, 6), glow, head, sx * 0.065, 0.03, 0.2, { sx: 0.05, sy: 0.016, sz: 0.012, cast: false });
    e.userData.sy = 0.016; P.eyes.push(e);
  }
  part(new THREE.BoxGeometry(0.04, 0.16, 0.34), cloth, head, 0, 0.27, -0.04);
  // arms
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * 0.42, 0.58, 0); torso.add(arm);
    part(cap(0.085, 0.28), bodyM, arm, 0, -0.2, 0);
    const fore = new THREE.Group(); fore.position.y = -0.4; arm.add(fore);
    part(cap(0.075, 0.26), dark, fore, 0, -0.16, 0);
    part(sph(0.1, 8, 6), metal, fore, 0, -0.36, 0);
    if (side < 0) { P.armL = arm; P.foreL = fore; } else { P.armR = arm; P.foreR = fore; }
  }
  // rusted mace in the free hand
  const mace = new THREE.Group(); mace.position.set(0, -0.36, 0.04); mace.rotation.x = 1.35; P.foreR.add(mace);
  part(new THREE.CylinderGeometry(0.03, 0.035, 0.75, 6), dark, mace, 0, 0.2, 0);
  part(new THREE.DodecahedronGeometry(0.13, 0), metal, mace, 0, 0.58, 0);
  // tower shield on its own pivot so the pose can swing it in front of the body
  const pivot = new THREE.Group(); torso.add(pivot);
  const shield = new THREE.Group(); pivot.add(shield);
  part(new THREE.BoxGeometry(0.86, 1.34, 0.07), bronze, shield, 0, -0.12, 0);
  for (const [w, h, x, y] of [[0.94, 0.07, 0, 0.55], [0.94, 0.07, 0, -0.79], [0.07, 1.4, -0.44, -0.12], [0.07, 1.4, 0.44, -0.12], [0.07, 1.34, 0, -0.12]]) part(new THREE.BoxGeometry(w, h, 0.1), metal, shield, x, y, 0.01);
  part(sph(0.13, 10, 8), metal, shield, 0, 0.05, 0.05, { sz: 0.6 });
  const rune = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.21, 20), glow); rune.position.set(0, 0.05, 0.06); shield.add(rune);
  for (let i = 0; i < 2; i++) part(new THREE.BoxGeometry(0.02, 0.28, 0.02), glow, shield, i ? 0.2 : -0.2, -0.45, 0.05, { rz: i ? 0.4 : -0.4, cast: false });
  rig.shield = shield; rig.shieldPivot = pivot;
  rig.g = 1; rig.bashW = 0; rig.brk = 0;
  const baseUpdate = rig.update.bind(rig);
  rig.update = (dt, s = {}) => {
    baseUpdate(dt, s);
    rig.g = damp(rig.g, s.guard ? 1 : 0, 8, dt);
    rig.bashW = damp(rig.bashW, s.bash ? 1 : 0, s.bash ? 24 : 6, dt);
    rig.brk = damp(rig.brk, s.broken ? 1 : 0, s.broken ? 10 : 3, dt);
    const g = rig.g * (1 - rig.brk), b = rig.bashW, k = rig.brk;
    pivot.position.set(lerp(-0.52, -0.04, g) - k * 0.1, lerp(0.2, 0.3, g) - k * 0.42, lerp(0.14, 0.48, g) + b * 0.45);
    pivot.rotation.set(k * 0.55 - b * 0.15, lerp(-1.3, 0.04, g) + k * 0.3, -k * 0.6 + Math.sin(rig.t * 2) * 0.02);
    P.armL.rotation.x = lerp(P.armL.rotation.x, -1.1 - b * 0.4, g);
    P.armL.rotation.z = lerp(P.armL.rotation.z, -0.35, g);
    P.foreL.rotation.x = lerp(P.foreL.rotation.x, -0.5, g);
  };
  rig.mats = mats; rig.glowMats = [glow]; rig.height = 2.0;
  return rig;
}

// ------------------------------------------------------------------
// 메아리 사수 — a hooded echo that still draws a bow it no longer remembers
// ------------------------------------------------------------------
export function makeArcher() {
  const rig = new Rig();
  const P = (rig.p = {});
  const mats = [];
  const bodyM = EM(0x2c2833, { rim: 0.7 }); mats.push(bodyM);
  const cloak = EM(0x3a4452, { rim: 0.6, side: THREE.DoubleSide }); mats.push(cloak);
  const mask = EM(0xd8d0bf, { rim: 0.9 }); mats.push(mask);
  const wood = EM(0x5a4230, { rim: 0.5 }); mats.push(wood);
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9aeaff).multiplyScalar(2.6) });
  const str = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9aeaff).multiplyScalar(1.6) });
  rig.hipY = 0.86; rig.hunch = 0.2; rig.stride = 1.9;
  const hips = (P.hips = new THREE.Group()); hips.position.y = rig.hipY; rig.root.add(hips);
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(side * 0.11, -0.02, 0); hips.add(leg);
    part(cap(0.065, 0.34), bodyM, leg, 0, -0.22, 0);
    const shin = new THREE.Group(); shin.position.y = -0.43; leg.add(shin);
    part(cap(0.055, 0.32), bodyM, shin, 0, -0.2, 0);
    part(new THREE.ConeGeometry(0.07, 0.2, 5), cloak, shin, 0, -0.38, 0.06, { rx: Math.PI / 2 });
    if (side < 0) { P.legL = leg; P.shinL = shin; } else { P.legR = leg; P.shinR = shin; }
  }
  const torso = (P.torso = new THREE.Group()); torso.position.y = 0.02; hips.add(torso);
  part(sph(0.22, 12, 10), bodyM, torso, 0, 0.3, 0, { sy: 1.35, sz: 0.72 });
  part(new THREE.TorusGeometry(0.2, 0.05, 6, 14), cloak, torso, 0, 0.56, 0, { rx: Math.PI / 2 });
  // ragged cloak
  const capeG = new THREE.Group(); capeG.position.set(0, 0.56, -0.08); torso.add(capeG);
  {
    const cl = 1.05, th = Math.PI * 0.9;
    const g = new THREE.CylinderGeometry(0.2, 0.36, cl, 12, 3, true, Math.PI - th / 2, th);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < -cl / 2 + 0.01) p.setY(i, p.getY(i) + ((i * 7) % 3) * 0.08);
    g.translate(0, -cl / 2, 0.1); g.computeVertexNormals();
    part(g, cloak, capeG, 0, 0, 0);
  }
  P.cape = capeG;
  // quiver with glowing arrow nocks
  const quiver = new THREE.Group(); quiver.position.set(0.12, 0.38, -0.2); quiver.rotation.z = -0.4; torso.add(quiver);
  part(new THREE.CylinderGeometry(0.07, 0.06, 0.5, 8), wood, quiver, 0, 0, 0);
  for (let i = 0; i < 3; i++) part(new THREE.ConeGeometry(0.025, 0.09, 4), glow, quiver, (i - 1) * 0.035, 0.3, (i % 2) * 0.02, { cast: false });
  // hooded head with a bone mask
  const head = (P.head = new THREE.Group()); head.position.set(0, 0.7, 0.04); torso.add(head);
  part(sph(0.15, 12, 10), bodyM, head, 0, 0, 0);
  part(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), cloak, head, 0, 0.02, -0.03, { rx: -0.32 });
  part(new THREE.ConeGeometry(0.1, 0.3, 8), cloak, head, 0, 0.05, -0.22, { rx: -2.0 });
  part(sph(0.13, 12, 8), mask, head, 0, -0.01, 0.07, { sz: 0.6, sy: 1.1 });
  P.eyes = [];
  for (const sx of [-1, 1]) {
    const e = part(sph(1, 8, 6), glow, head, sx * 0.05, 0.02, 0.15, { sx: 0.025, sy: 0.032, sz: 0.01, cast: false });
    e.userData.sy = 0.032; P.eyes.push(e);
  }
  // arms
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * 0.24, 0.5, 0); torso.add(arm);
    part(cap(0.05, 0.24), bodyM, arm, 0, -0.16, 0);
    const fore = new THREE.Group(); fore.position.y = -0.33; arm.add(fore);
    part(cap(0.045, 0.22), cloak, fore, 0, -0.14, 0);
    part(sph(0.05, 8, 6), mask, fore, 0, -0.3, 0);
    if (side < 0) { P.armL = arm; P.foreL = fore; } else { P.armR = arm; P.foreR = fore; }
  }
  // bow in the left hand (grip at origin, limbs curve back toward the string)
  const bow = new THREE.Group(); bow.position.set(0, -0.3, 0); bow.rotation.x = Math.PI / 2; P.foreL.add(bow);
  const R = 0.6;
  const bg = new THREE.TorusGeometry(R, 0.024, 5, 18, Math.PI * 0.8); bg.rotateZ(-Math.PI * 0.4); bg.rotateY(-Math.PI / 2); bg.translate(0, 0, -R);
  part(bg, wood, bow, 0, 0, 0);
  const tipY = R * Math.sin(Math.PI * 0.4), tipZ = -R + R * Math.cos(Math.PI * 0.4);
  for (const sy of [-1, 1]) part(new THREE.ConeGeometry(0.03, 0.12, 4), glow, bow, 0, sy * tipY, tipZ, { rx: sy > 0 ? -0.6 : Math.PI + 0.6, cast: false });
  const segGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 3); segGeo.translate(0, 0.5, 0);
  const strA = new THREE.Mesh(segGeo, str), strB = new THREE.Mesh(segGeo, str);
  bow.add(strA, strB);
  const arrow = new THREE.Group(); bow.add(arrow);
  { const ag = new THREE.CylinderGeometry(0.012, 0.012, 0.85, 4); ag.rotateX(Math.PI / 2); ag.translate(0, 0, 0.42); arrow.add(new THREE.Mesh(ag, str)); }
  { const hg = new THREE.ConeGeometry(0.035, 0.12, 4); hg.rotateX(Math.PI / 2); hg.translate(0, 0, 0.88); arrow.add(new THREE.Mesh(hg, glow)); }
  const up = new THREE.Vector3(0, 1, 0), tv = new THREE.Vector3(), nock = new THREE.Vector3();
  const setSeg = (m, ay, az) => {
    tv.set(0, ay, az).sub(nock);
    const len = tv.length();
    m.position.copy(nock); m.scale.set(1, len, 1);
    m.quaternion.setFromUnitVectors(up, tv.normalize());
  };
  rig.aimW = 0; rig.drawW = 0;
  const baseUpdate = rig.update.bind(rig);
  rig.update = (dt, s = {}) => {
    baseUpdate(dt, s);
    rig.aimW = damp(rig.aimW, s.aim ? 1 : 0, s.aim ? 12 : 5, dt);
    rig.drawW = damp(rig.drawW, s.draw ?? 0, s.draw ? 6 : 30, dt);
    const a = rig.aimW, d = rig.drawW, pitch = s.aimPitch ?? 0;
    P.torso.rotation.y += a * 0.45;
    P.armL.rotation.x = lerp(P.armL.rotation.x, -1.5 - pitch, a); P.armL.rotation.z = lerp(P.armL.rotation.z, -0.35, a);
    P.foreL.rotation.x = lerp(P.foreL.rotation.x, 0, a);
    P.armR.rotation.x = lerp(P.armR.rotation.x, -1.35 - pitch, a); P.armR.rotation.z = lerp(P.armR.rotation.z, 0.55 + d * 0.3, a);
    P.foreR.rotation.x = lerp(P.foreR.rotation.x, -0.3 - d * 1.2, a);
    nock.set(0, 0, tipZ - d * 0.42);
    setSeg(strA, tipY, tipZ); setSeg(strB, -tipY, tipZ);
    arrow.visible = d > 0.08;
    arrow.position.z = nock.z;
  };
  rig.mats = mats; rig.glowMats = [glow, str]; rig.height = 1.75;
  return rig;
}

// ------------------------------------------------------------------
// 뿌리손 — a grasping root-hand that swims through the soil
// ------------------------------------------------------------------
export function makeRootHand() {
  const root = new THREE.Group();
  const mats = [];
  const bark = EM(0x4b3a2c, { rim: 0.5, flat: true }); mats.push(bark);
  const barkD = EM(0x2e241c, { rim: 0.4 }); mats.push(barkD);
  const dirt = EM(0x5a4936, { rim: 0.2, flat: true }); mats.push(dirt);
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc9a0ff).multiplyScalar(2.6) });
  // disturbed earth mound (stays at ground level)
  const mound = new THREE.Group(); root.add(mound);
  part(new THREE.DodecahedronGeometry(0.85, 1), dirt, mound, 0, -0.38, 0, { sy: 0.5 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    part(new THREE.DodecahedronGeometry(0.14 + (i % 3) * 0.05, 0), dirt, mound, Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95, { ry: a });
  }
  const tips = new THREE.Group(); mound.add(tips);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    part(new THREE.ConeGeometry(0.05, 0.4, 5), bark, tips, Math.cos(a) * 0.4, 0.12, Math.sin(a) * 0.4, { rz: Math.cos(a) * 0.5, rx: -Math.sin(a) * 0.5 });
  }
  // the hand
  const body = new THREE.Group(); root.add(body);
  const wg = new THREE.CylinderGeometry(0.34, 0.52, 1.4, 9, 4);
  { const p = wg.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const n = 1 + Math.sin(y * 7 + x * 5) * 0.08 + Math.cos(z * 9) * 0.05; p.setXYZ(i, x * n, y, z * n); } wg.computeVertexNormals(); }
  part(wg, bark, body, 0, 0.6, 0);
  part(sph(0.46, 12, 8), bark, body, 0, 1.36, 0.02, { sx: 1.1, sy: 0.62, sz: 0.82 });
  for (const [x, y, z, r] of [[0.28, 0.4, 0.32, 0.07], [-0.22, 0.85, 0.3, 0.06], [0.05, 0.2, -0.45, 0.07]]) part(sph(r, 8, 6), glow, body, x, y, z, { cast: false });
  part(sph(1, 10, 8), barkD, body, 0, 1.32, 0.36, { sx: 0.2, sy: 0.14, sz: 0.06, cast: false });
  const eye = part(sph(1, 10, 8), glow, body, 0, 1.32, 0.39, { sx: 0.1, sy: 0.075, sz: 0.04, cast: false });
  // fingers: 4 + thumb, 3 segments each, thorny tips
  const fingers = [];
  const segG = [0.36, 0.3, 0.24].map((l, k) => { const g = new THREE.CylinderGeometry(0.075 - k * 0.012, 0.09 - k * 0.012, l, 6); g.translate(0, l / 2, 0); return g; });
  const fdef = [[-0.3, 1.52, 0.06, 0.32], [-0.1, 1.62, 0.1, 0.1], [0.12, 1.62, 0.1, -0.1], [0.32, 1.52, 0.06, -0.32], [0.46, 1.2, 0.2, -1.1]];
  for (const [x, y, z, rz] of fdef) {
    const segs = [];
    let par = new THREE.Group(); par.position.set(x, y, z); par.rotation.z = rz; body.add(par);
    const baseG = par;
    for (let k = 0; k < 3; k++) {
      const sg = new THREE.Group(); if (k > 0) sg.position.y = [0.36, 0.3][k - 1]; par.add(sg);
      part(segG[k], k === 2 ? barkD : bark, sg, 0, 0, 0);
      segs.push(sg); par = sg;
    }
    part(new THREE.ConeGeometry(0.05, 0.22, 5), barkD, par, 0, 0.32, 0.02, { rx: 0.25 });
    fingers.push({ base: baseG, segs });
  }
  const rig = { root, body, mound, tips, fingers, eye, mats, glowMats: [glow], t: rand() * 5, height: 2.2, emerge: 0, grip: 0.3, droop: 0 };
  rig.update = (dt, s = {}) => {
    rig.t += dt;
    const e = s.emerge ?? 1;
    rig.emerge = e;
    body.position.y = -2.5 * (1 - e) + (s.strike ? 0.25 : 0);
    body.visible = e > 0.02;
    tips.visible = e < 0.6;
    mound.scale.setScalar(0.75 + 0.45 * e);
    const want = s.dead ? 1.2 : s.strike ? -0.35 : s.grip ?? 0.35;
    rig.grip = damp(rig.grip, want, s.strike ? 20 : 8, dt);
    fingers.forEach((f, i) => f.segs.forEach((sg, k) => { sg.rotation.x = rig.grip * (0.45 + k * 0.25) + Math.sin(rig.t * 3.2 + i * 1.3 + k) * 0.1 * (s.dead ? 0 : 1); }));
    rig.droop = damp(rig.droop, s.dead ? 1 : s.stagger ? 0.4 : 0, 4, dt);
    body.rotation.z = Math.sin(rig.t * 1.3) * 0.07 * (1 - rig.droop) + (s.shock ? (rand() - 0.5) * 0.15 : 0);
    body.rotation.x = Math.sin(rig.t * 1.1) * 0.05 + rig.droop * 0.9 + (s.strike ? -0.15 : 0);
    const sc = s.strike ? 1.12 : 1;
    body.scale.y = damp(body.scale.y, sc, 14, dt);
    eye.scale.y = 0.075 * (s.dead ? 0.2 : 1);
  };
  return rig;
}

// ------------------------------------------------------------------
// 망루지기 — a forgotten watchtower construct with a single sweeping eye
// ------------------------------------------------------------------
export function makeWatcher() {
  const root = new THREE.Group();
  const mats = [];
  const stone = EM(0x6a6470, { rim: 0.6, flat: true }); mats.push(stone);
  const stoneD = EM(0x3e3946, { rim: 0.5, flat: true }); mats.push(stoneD);
  const moss = EM(0x4a5a3a, { rim: 0.3 }); mats.push(moss);
  const brass = EM(0x8a7048, { rim: 1.0 }); mats.push(brass);
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc9a0ff).multiplyScalar(2.6) });
  const eyeM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc070).multiplyScalar(2.2) });
  const body = new THREE.Group(); body.position.y = 2.2; root.add(body);
  // legs (three, spider-like)
  const legs = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 3;
    const hip = new THREE.Group(); hip.position.set(Math.sin(a) * 0.7, -0.2, Math.cos(a) * 0.7); hip.rotation.y = a; body.add(hip);
    const thigh = new THREE.Group(); thigh.rotation.x = 0.9; hip.add(thigh);
    part(new THREE.BoxGeometry(0.3, 0.3, 1.2), stone, thigh, 0, 0, 0.55);
    const knee = new THREE.Group(); knee.position.z = 1.15; thigh.add(knee);
    part(sph(0.2, 8, 6), brass, knee, 0, 0, 0);
    const shin = new THREE.Group(); shin.rotation.x = 0.6; knee.add(shin);
    part(new THREE.CylinderGeometry(0.2, 0.12, 1.1, 6), stoneD, shin, 0, 0, 0.55, { rx: Math.PI / 2 });
    part(new THREE.CylinderGeometry(0.28, 0.32, 0.14, 7), stoneD, shin, 0, 0, 1.1, { rx: Math.PI / 2 });
    legs.push({ hip, thigh, knee, shin, a });
  }
  // base drum
  part(new THREE.CylinderGeometry(0.85, 1.0, 0.7, 10), stoneD, body, 0, 0, 0);
  part(new THREE.TorusGeometry(0.92, 0.07, 6, 20), brass, body, 0, 0.34, 0, { rx: Math.PI / 2 });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; part(new THREE.BoxGeometry(0.1, 0.4, 0.05), glow, body, Math.sin(a) * 0.98, -0.05, Math.cos(a) * 0.98, { ry: a, cast: false }); }
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.3; part(sph(0.25, 6, 5), moss, body, Math.sin(a) * 0.75, 0.3, Math.cos(a) * 0.75, { sy: 0.4 }); }
  // head: lantern dome that rotates independently
  const head = new THREE.Group(); head.position.y = 0.45; body.add(head);
  part(new THREE.CylinderGeometry(0.75, 0.85, 0.5, 10), stone, head, 0, 0.25, 0);
  part(new THREE.SphereGeometry(0.8, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), stone, head, 0, 0.5, 0);
  part(new THREE.ConeGeometry(0.2, 0.5, 6), brass, head, 0, 1.45, 0);
  part(new THREE.TorusGeometry(0.8, 0.06, 6, 20), brass, head, 0, 0.5, 0, { rx: Math.PI / 2 });
  // eye socket + eye
  part(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 14), stoneD, head, 0, 0.52, 0.72, { rx: Math.PI / 2 });
  const eye = new THREE.Mesh(sph(0.25, 14, 10), eyeM); eye.position.set(0, 0.52, 0.8); eye.scale.z = 0.5; head.add(eye);
  const pupil = new THREE.Mesh(sph(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0x120a18 })); pupil.position.set(0, 0.52, 0.93); pupil.scale.z = 0.4; head.add(pupil);
  const eyeTip = new THREE.Object3D(); eyeTip.position.set(0, 0.52, 1.0); head.add(eyeTip);
  const rig = { root, body, head, legs, eye, eyeTip, mats, glowMats: [glow], eyeMat: eyeM, t: rand() * 5, height: 3.9, walk: 0 };
  rig.update = (dt, s = {}) => {
    rig.t += dt;
    const sp = s.speed ?? 0;
    rig.walk += dt * sp * 2.2;
    legs.forEach((L, i) => {
      const ph = rig.walk + i * 2.1;
      const lift = Math.max(0, Math.sin(ph)) * Math.min(1, sp / 2);
      L.thigh.rotation.x = 0.9 - lift * 0.35 + (s.dead ? 0.5 : 0) - (s.stomp ?? 0) * 0.3;
      L.hip.rotation.y = L.a + Math.cos(ph) * 0.2 * Math.min(1, sp / 2);
    });
    rig.sink = damp(rig.sink || 0, s.dead ? 1 : 0, 3, dt);
    body.position.y = 2.2 + Math.sin(rig.t * 2) * 0.04 + Math.abs(Math.sin(rig.walk)) * 0.06 - rig.sink * 1.1 + (s.stomp ?? 0) * 0.5;
    head.rotation.y = damp(head.rotation.y, s.headYaw ?? 0, s.headK ?? 6, dt);
    head.rotation.x = damp(head.rotation.x, s.headPitch ?? 0, 6, dt);
    const c = s.charge ?? 0;
    eye.scale.set(1 + c * 0.35, 1 + c * 0.35, 0.5);
    body.rotation.z = s.stagger ? Math.sin(rig.t * 5) * 0.08 : damp(body.rotation.z, 0, 5, dt);
  };
  return rig;
}
