// Over-the-shoulder orbit camera with terrain collision, trauma shake,
// lock-on assist and cinematic framing for dialogue.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { clamp, damp, angleDamp, lerp, wrapAngle } from '../core/util.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

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
  }

  shake(a) { this.trauma = Math.min(1, this.trauma + a); }
  punchFov(a) { this.fov += a; }

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
    this.fovT = player && player.sprinting ? 63 : 58;
    this.fov = damp(this.fov, this.fovT, 5, dt);

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
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const sh = this.trauma * this.trauma;
    const t = G.realTime * 30;
    const ox = (Math.sin(t * 1.1) + Math.sin(t * 2.3) * 0.5) * sh * 0.35;
    const oy = (Math.sin(t * 1.7 + 3) + Math.sin(t * 3.1) * 0.5) * sh * 0.3;
    this.cam.position.set(px + this.right.x * ox, py + oy, pz + this.right.z * ox);
    this.cam.lookAt(look);
    this.cam.rotateZ((Math.sin(t * 0.9) * sh) * 0.04);
    if (Math.abs(this.cam.fov - this.fov) > 0.01) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }
    this.cam.getWorldDirection(this.forward);
  }

  // Ray from camera through screen center
  aimRay(out = { o: new THREE.Vector3(), d: new THREE.Vector3() }) {
    out.o.copy(this.cam.position);
    this.cam.getWorldDirection(out.d);
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
