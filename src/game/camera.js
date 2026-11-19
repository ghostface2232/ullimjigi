// Over-the-shoulder orbit camera with terrain collision, trauma shake,
// impulse kicks (directional recoil with rotation), FOV punches,
// lock-on assist and cinematic framing for dialogue.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { clamp, damp, angleDamp, lerp, wrapAngle } from '../core/util.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

// smooth 1D value noise in [-1, 1] (organic shake instead of pure sines)
const hash1 = (i, s) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
function noise1(t, s) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return (hash1(i, s) + (hash1(i + 1, s) - hash1(i, s)) * u) * 2 - 1;
}
// critically-ish damped spring, sub-stepped so it behaves the same at any frame rate
function springStep(st, dt, w, z) {
  let t = dt;
  while (t > 1e-6) {
    const h = Math.min(t, 1 / 240);
    for (let i = 0; i < st.x.length; i++) {
      st.v[i] += (-w * w * st.x[i] - 2 * z * w * st.v[i]) * h;
      st.x[i] += st.v[i] * h;
    }
    t -= h;
  }
}

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.yaw = 0; this.pitch = 0.22;
    this.dist = 5.2; this.distT = 5.2;
    this.shoulder = 0.75;
    this.target = new THREE.Vector3();
    this.smoothT = new THREE.Vector3();
    this.trauma = 0;
    this.fov = 58; this.fovT = 58;
    this.mode = 'follow';
    this.cine = { pos: new THREE.Vector3(), look: new THREE.Vector3(), k: 0 };
    this.cineOverride = null;
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.lookAtP = new THREE.Vector3();
    this.initialized = false;
    // impulse springs: position (right, up, forward) and rotation (pitch, yaw, roll)
    this.kp = { x: [0, 0, 0], v: [0, 0, 0] };
    this.kr = { x: [0, 0, 0], v: [0, 0, 0] };
    this.kf = { x: [0], v: [0] };
    this.slowPrev = false;
    this.pendAmt = 0; this.pendDir = new THREE.Vector3();
    this.basePos = new THREE.Vector3(); this.baseDir = new THREE.Vector3(0, 0, -1);
    this.push = null;
    this.lead = new THREE.Vector3(); this.mouseIdle = 0;
    this.boom = this.dist; this.obstructed = false;
    this.dialogueOffset = new THREE.Vector3();
  }

  // random trauma shake (0..1 accumulates, quadratic falloff)
  shake(a) { this.trauma = Math.min(1, this.trauma + a); }
  // FOV punch in degrees: + widens (blast), - narrows (focus); springs back
  punchFov(a) { this.kf.v[0] += a * 22; }
  // Directional impulse. dir: world-space direction of the force (e.g. hit direction), amt ~0..1
  // Kicks landing in the same frame don't stack: the strongest one wins.
  kick(dir, amt = 0.3) {
    if (!dir || amt <= 0) return;
    if (amt <= this.pendAmt) return;
    this.pendAmt = amt; this.pendDir.copy(dir);
  }
  _applyKick(dir, amt) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const lx = dir.x * this.right.x + dir.z * this.right.z;
    const lz = dir.x * fx + dir.z * fz;
    const ly = dir.y || 0;
    const a = Math.min(amt, 1.5);
    this.kp.v[0] += lx * a * 2.6; this.kp.v[1] += ly * a * 2.0 - a * 0.6; this.kp.v[2] += lz * a * 3.2;
    this.kr.v[0] += (-lz * 0.55 - ly * 0.3) * a; // forward push pitches the view down
    this.kr.v[1] += -lx * 0.2 * a;
    this.kr.v[2] += lx * 0.55 * a;
  }
  // Short authored lean-in (ultimates): over `dur` seconds the boom shortens by `dist`, the
  // lens narrows by `fov` degrees and the horizon tips by `roll`; it then lets go over `out`.
  // Additive and on real time (it carries through hit stop); the player keeps the stick.
  focus(dur = 0.45, o = {}) {
    this.push = { t: 0, dur, out: o.out ?? 0.4, dist: o.dist ?? -1.4, fov: o.fov ?? -7, roll: o.roll ?? 0 };
  }
  // one-call hit feel: kick + trauma + optional FOV punch
  impact(dir, amt = 0.3, fov = 0) {
    this.kick(dir, amt);
    this.shake(amt * 0.5);
    if (fov) this.punchFov(fov);
  }

  // Cinematic: frame a speaker (and player) from a pleasant angle
  frame(focus, other, opts = {}) {
    const mid = tmp.copy(focus).lerp(other || focus, other ? 0.3 : 0);
    const dir = tmp2.copy(focus).sub(other || new THREE.Vector3(focus.x + 1, focus.y, focus.z)).setY(0);
    if (dir.lengthSq() < 0.01) dir.set(1, 0, 0); else dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(opts.side ?? 1);
    const d = opts.dist ?? 3.4;
    const pos = mid.clone().add(dir.clone().multiplyScalar(-d * 0.4)).add(side.multiplyScalar(d)).add(new THREE.Vector3(0, opts.h ?? 1.6, 0));
    const look = mid.clone().add(new THREE.Vector3(0, opts.lookH ?? 1.43, 0));
    this.setCine(pos, look);
  }
  setCine(pos, look) {
    this.mode = 'cine';
    this.cine.pos.copy(pos); this.cine.look.copy(look);
  }
  release() { this.mode = 'follow'; }

  update(dt, player, input) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    const S = G.settings;
    const mouseMoved = input && (Math.abs(input.mouse.dx) + Math.abs(input.mouse.dy) > 0.1);
    this.mouseIdle = mouseMoved ? 0 : this.mouseIdle + dt;
    if (this.mode === 'follow' || this.mode === 'title') {
      if (this.mode === 'follow' && input && input.locked && G.mode === 'free') {
        const sens = 0.0022 * (S.sens / 100);
        this.yaw -= input.mouse.dx * sens;
        this.pitch += input.mouse.dy * sens * (S.invertY ? -1 : 1);
      }
      this.pitch = clamp(this.pitch, -0.55, 1.25);
      // lock-on assist
      const lock = player && player.lockTarget;
      if (lock && lock.alive) {
        const c = lock.center();
        const dx = c.x - player.pos.x, dz = c.z - player.pos.z;
        const want = Math.atan2(-dx, -dz);
        this.yaw = angleDamp(this.yaw, want, 5, dt);
        const hd = Math.hypot(dx, dz);
        const wantP = clamp(Math.atan2(player.pos.y + 1.6 - c.y, hd) * 0.6 + 0.18, -0.2, 0.7);
        this.pitch = damp(this.pitch, wantP, 3, dt);
      } else if (player && this.mode === 'follow' && G.mode === 'free' && this.mouseIdle > 1.6 &&
        !player.castHold && !player.climbing && !player.mantle && input && input.down('KeyW') && !input.down('KeyS') && !input.down('KeyA') && !input.down('KeyD')) {
        // A quiet exploration assist, delayed after manual orbit and limited to a
        // small correction. It never fights strafing, combat aim or the mouse.
        const delta = wrapAngle(player.yaw + Math.PI - this.yaw);
        if (Math.abs(delta) < 1.25) this.yaw += clamp(delta * 0.65, -0.3, 0.3) * dt;
      }
    }
    if (player) {
      const leadK = this.mode === 'follow' && !player.castHold && !player.lockTarget && !player.climbing ? 1 : 0;
      tmp2.copy(player.vel || tmp2.set(0, 0, 0)).setY(0).multiplyScalar((player.gliding ? 0.18 : 0.115) * leadK).clampLength(0, 1.05);
      if (!this.initialized) { this.lead.set(0, 0, 0); this.boom = this.dist; }
      this.lead.lerp(tmp2, 1 - Math.exp(-dt * 5));
      this.target.copy(player.pos).add(this.lead); this.target.y += player.swimming ? 1.3 : 1.55;
      if (!this.initialized) { this.smoothT.copy(this.target); this.initialized = true; }
      this.smoothT.x = damp(this.smoothT.x, this.target.x, 18, dt);
      this.smoothT.z = damp(this.smoothT.z, this.target.z, 18, dt);
      this.smoothT.y = damp(this.smoothT.y, this.target.y, 9, dt);
      // distance intent
      let want = 5.2;
      if (player.gliding) want = 6.4;
      else if (player.sprinting) want = 5.8;
      if (G.bossActive) want += 1.6;
      if (player.aimZoom) want -= 0.9;
      this.distT = want;
    }
    this.dist = damp(this.dist, this.distT, 4, dt);
    // perfect dodge: snap-zoom in, then hold a slightly tighter frame while time is slowed
    const slow = G.slowmo > 0;
    if (slow && !this.slowPrev) { this.punchFov(-7); this.kr.v[2] += 0.25; }
    this.slowPrev = slow;
    this.fovT = (this.mode === 'cine' && G.mode === 'dialogue' ? 50 : player && player.sprinting ? 63 : 58) - 3.5 * (G.slowK || 0);
    this.fov = damp(this.fov, this.fovT, 5, dt);
    if (this.pendAmt > 0) { this._applyKick(this.pendDir, this.pendAmt); this.pendAmt = 0; }
    springStep(this.kp, dt, 18, 0.68);
    springStep(this.kr, dt, 20, 0.7);
    springStep(this.kf, dt, 13, 0.72);

    let pk = 0;
    const F = this.push;
    if (F) {
      F.t += dt;
      const a = F.t < F.dur ? F.t / F.dur : 1 - (F.t - F.dur) / F.out;
      if (a <= 0) this.push = null; else pk = F.t < F.dur ? 1 - (1 - a) ** 3 : a * a * (3 - 2 * a);
    }
    const cy = Math.cos(this.pitch);
    const back = tmp.set(Math.sin(this.yaw) * cy, Math.sin(this.pitch), Math.cos(this.yaw) * cy);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const look = this.lookAtP.copy(this.smoothT).addScaledVector(this.right, this.shoulder);
    let d = this.dist + (F ? F.dist * pk : 0);
    // terrain collision: march from look point outward
    const W = G.world;
    if (W) {
      const steps = Math.max(16, Math.ceil(d / 0.18));
      for (let i = 1; i <= steps; i++) {
        const t = (i / steps) * d;
        const x = look.x + back.x * t, y = look.y + back.y * t, z = look.z + back.z * t;
        if (y < W.h(x, z) + 0.4 || W.col && W.col.pointHit(x, y, z, 0.22, true)) { d = Math.max(0.55, t - 0.35); break; }
      }
    }
    // Retract immediately to remain outside terrain; release the obstruction
    // slowly so walking along a crest cannot pump the camera boom in and out.
    this.obstructed = d < this.dist - 0.1;
    this.boom = d < this.boom ? d : damp(this.boom, d, 4.5, dt);
    d = this.boom;
    let px = look.x + back.x * d, py = look.y + back.y * d, pz = look.z + back.z * d;
    if (W) py = Math.max(py, W.h(px, pz) + 0.35, 0.35);

    if (this.mode === 'cine') {
      this.cine.k = damp(this.cine.k, 1, 3.2, dt);
    } else this.cine.k = damp(this.cine.k, 0, 4, dt);
    const k = this.cine.k;
    if (k > 0.001) {
      px = lerp(px, this.cine.pos.x, k); py = lerp(py, this.cine.pos.y, k); pz = lerp(pz, this.cine.pos.z, k);
      look.lerp(this.cine.look, k);
    }
    if (this.mode === 'cine' && G.mode === 'dialogue' && G.dialogue && G.dialogue.tw) {
      const speaker = G.npcs?.list.find(n => n.talking) || (G.companion?.talking ? G.companion : player);
      if (speaker) {
        // Keep the selected shoulder, with the speaker on a third and eyes above centre.
        const dx = this.cine.look.x - this.cine.pos.x, dz = this.cine.look.z - this.cine.pos.z, hd = Math.hypot(dx, dz) || 1;
        const rx = -dz / hd, rz = dx / hd;
        const side = (speaker.pos.x - this.cine.look.x) * rx + (speaker.pos.z - this.cine.look.z) * rz < 0 ? -1 : 1;
        const d = Math.hypot(speaker.pos.x - this.cine.pos.x, speaker.pos.z - this.cine.pos.z);
        const third = d * Math.tan(this.fov * Math.PI / 360) * this.cam.aspect / 3;
        const along = (speaker.pos.x - this.cine.look.x) * rx + (speaker.pos.z - this.cine.look.z) * rz - side * third;
        const head = speaker.rig && speaker.rig.B.head;
        const eyeY = head ? head.getWorldPosition(tmp2).y + 0.04 * (speaker.rig.s ?? 1) : speaker.pos.y + (speaker.headH ?? 1.55);
        tmp2.set(rx * along, clamp(eyeY - this.cine.look.y - third / this.cam.aspect, -0.65, 0.25), rz * along);
        this.dialogueOffset.lerp(tmp2, 1 - Math.exp(-dt * 5));
      }
    } else this.dialogueOffset.multiplyScalar(Math.exp(-dt * 8));
    look.addScaledVector(this.dialogueOffset, k);
    this.pos.set(px, py, pz);
    // shake: smooth-noise trauma (translation + rotation) plus spring impulses
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    const sh = this.trauma * this.trauma;
    const t = G.realTime * 18;
    const cine = 1 - k * 0.6;
    const oy = (noise1(t, 2) * 0.16) * sh * cine + this.kp.x[1] * cine;
    const oxs = noise1(t, 1) * sh * 0.2 * cine + this.kp.x[0] * cine;
    const fz = -Math.sin(this.yaw), fzz = -Math.cos(this.yaw);
    const ofw = this.kp.x[2] * cine;
    this.cam.position.set(px + this.right.x * oxs + fz * ofw, py + oy, pz + this.right.z * oxs + fzz * ofw);
    this.cam.lookAt(look);
    this.basePos.set(px, py, pz);
    this.cam.getWorldDirection(this.baseDir);
    const pitch = (noise1(t * 0.9, 3) * 0.016 * sh + this.kr.x[0]) * cine;
    const yawJ = (noise1(t * 0.9, 4) * 0.012 * sh + this.kr.x[1]) * cine;
    const roll = (noise1(t * 0.7, 5) * 0.045 * sh + this.kr.x[2] + (F ? F.roll * pk : 0)) * cine;
    if (pitch) this.cam.rotateX(pitch);
    if (yawJ) this.cam.rotateY(yawJ);
    if (roll) this.cam.rotateZ(roll);
    const fov = clamp(this.fov + this.kf.x[0] + (F ? F.fov * pk : 0), 35, 90);
    if (Math.abs(this.cam.fov - fov) > 0.01) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
    this.forward.copy(this.baseDir);
  }

  // Ray from camera through screen center (unshaken, so hits don't jitter aim)
  aimRay(out = { o: new THREE.Vector3(), d: new THREE.Vector3() }) {
    if (!this.initialized) { out.o.copy(this.cam.position); this.cam.getWorldDirection(out.d); return out; }
    out.o.copy(this.basePos);
    out.d.copy(this.baseDir);
    return out;
  }
  // Horizontal forward/right for movement
  moveBasis() {
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return { f, r };
  }
  faceYaw(yawWorld) { this.yaw = wrapAngle(yawWorld + Math.PI); }
}
