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
    this.kr.v[2] += lx * 0.7 * a + (Math.random() - 0.5) * 0.3 * a;
  }
  // one-call hit feel: kick + trauma + optional FOV punch
  impact(dir, amt = 0.3, fov = 0) {
    this.kick(dir, amt);
    this.shake(amt * 0.5);
    if (fov) this.punchFov(fov);
  }

  // Cinematic: frame a speaker (and player) from a pleasant angle
  frame(focus, other, opts = {}) {
    const mid = tmp.copy(focus).lerp(other || focus, other ? 0.35 : 0);
    const dir = tmp2.subVectors(focus, other || tmp2.set(focus.x + 1, focus.y, focus.z)).setY(0).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(opts.side ?? 1);
    const d = opts.dist ?? 3.4;
    const pos = mid.clone().add(dir.clone().multiplyScalar(-d * 0.55)).add(side.multiplyScalar(d)).add(new THREE.Vector3(0, opts.h ?? 1.7, 0));
    const look = mid.clone().add(new THREE.Vector3(0, opts.lookH ?? 1.45, 0));
    this.setCine(pos, look);
  }
  setCine(pos, look) {
    this.mode = 'cine';
    this.cine.pos.copy(pos); this.cine.look.copy(look);
  }
  release() { this.mode = 'follow'; }

  update(dt, player, input) {
    const S = G.settings;
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
      }
    }
    if (player) {
      this.target.copy(player.pos); this.target.y += 1.55;
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
    this.fovT = (player && player.sprinting ? 63 : 58) - 3.5 * (G.slowK || 0);
    this.fov = damp(this.fov, this.fovT, 5, dt);
    if (this.pendAmt > 0) { this._applyKick(this.pendDir, this.pendAmt); this.pendAmt = 0; }
    springStep(this.kp, dt, 15, 0.42);
    springStep(this.kr, dt, 17, 0.4);
    springStep(this.kf, dt, 11, 0.55);

    const cy = Math.cos(this.pitch);
    const back = tmp.set(Math.sin(this.yaw) * cy, Math.sin(this.pitch), Math.cos(this.yaw) * cy);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const look = this.lookAtP.copy(this.smoothT).addScaledVector(this.right, this.shoulder);
    let d = this.dist;
    // terrain collision: march from look point outward
    const W = G.world;
    if (W) {
      for (let i = 1; i <= 10; i++) {
        const t = (i / 10) * d;
        const x = look.x + back.x * t, y = look.y + back.y * t, z = look.z + back.z * t;
        if (y < W.h(x, z) + 0.4) { d = Math.max(0.8, t - 0.4); break; }
      }
    }
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
    this.pos.set(px, py, pz);
    // shake: smooth-noise trauma (translation + rotation) plus spring impulses
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    const sh = this.trauma * this.trauma;
    const t = G.realTime * 24;
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
    const roll = (noise1(t * 0.7, 5) * 0.045 * sh + this.kr.x[2]) * cine;
    if (pitch) this.cam.rotateX(pitch);
    if (yawJ) this.cam.rotateY(yawJ);
    if (roll) this.cam.rotateZ(roll);
    const fov = clamp(this.fov + this.kf.x[0], 35, 90);
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
