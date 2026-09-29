// Player: movement (run, sprint, blink, jump, glide, swim), casting and stats.
import * as THREE from 'three';
import { G, ELEMENTS } from '../core/context.js';
import { makeHumanoid, CHAR } from './characters.js';
import { BOLT, HEAVY, WEAVE_COST, WEAVE_CD, weaveInfo } from './spells.js';
import { ULT_COST } from './skills.js';
import { clamp, damp, angleDamp, lerp, randRange } from '../core/util.js';
import { PAL } from '../render/vfx.js';
import { toon, addOutline } from '../render/materials.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const GRAV = 26;

export function xpNeed(lv) { return Math.round(30 * Math.pow(lv, 1.6)); }

export class Player {
  constructor(scene) {
    this.rig = makeHumanoid(CHAR.player);
    this.root = this.rig.root;
    scene.add(this.root);
    this.root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) o.castShadow = true; });
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.grounded = true;
    this.coyote = 0; this.jumpBuf = 0;
    this.level = 1; this.xp = 0;
    this.maxHp = 20; this.hp = 20;          // quarter-hearts
    this.maxMana = 100; this.mana = 100;
    this.maxStamina = 100; this.stamina = 100;
    this.exhausted = false;
    this.element = 'arcane'; this.prevElement = null;
    this.unlocked = new Set(['arcane']);
    this.cd = { bolt: 0, heavy: 0, weave: 0 };
    this.castHold = 0; this.manaDelay = 0;
    this.invuln = 0; this.barrier = 0; this.updraft = 0;
    this.lockTarget = null;
    this.dead = false;
    this.sprinting = false; this.gliding = false; this.swimming = false;
    this.blinkT = 0; this.blinkDir = new THREE.Vector3(); this.airBlink = 1; this.blinkAt = -99; this.dodgeCD = 0; this.dodged = false;
    this.shiftT = 0;
    this.stepT = 0;
    this.regenT = 0; this.lastHurt = -99;
    this.aimZoom = false;
    this.lastSafe = new THREE.Vector3();
    this.glideCircle = null;
    this.fallStartY = 0;
    this.carry = null;
    this.stats = { casts: 0, bolts: 0, heavies: 0, weaves: 0, reactions: 0 };
    this.hasHat = false;
  }

  power() { return 10 * (1 + 0.14 * (this.level - 1)); }
  center() { return new THREE.Vector3(this.pos.x, this.pos.y + 0.95, this.pos.z); }

  teleport(x, z, yaw) {
    this.pos.set(x, G.world.ground(x, z) + 0.05, z);
    this.vel.set(0, 0, 0);
    if (yaw !== undefined) { this.yaw = yaw; G.cameraRig.faceYaw(yaw); }
    this.root.position.copy(this.pos);
    this.lastSafe.copy(this.pos);
    G.cameraRig.initialized = false;
  }

  setHat(on) {
    if (on === this.hasHat) return;
    this.hasHat = on;
    const head = this.rig.p.head;
    if (on) {
      const hr = 0.165;
      const hm = toon(0x4a3070, { rim: 0.5 });
      const g = new THREE.Group(); g.name = 'moraHat';
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(hr * 2.4, hr * 2.4, 0.025, 20), hm); brim.position.y = hr * 0.75; brim.rotation.x = -0.1; g.add(brim);
      const cg = new THREE.ConeGeometry(hr * 1.1, hr * 4, 12, 6);
      const p = cg.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i) + hr * 2, t = y / (hr * 4); p.setZ(i, p.getZ(i) - t * t * hr * 1.8); }
      cg.computeVertexNormals();
      const cone = new THREE.Mesh(cg, hm); cone.position.y = hr * 0.75 + hr * 2; cone.rotation.x = -0.1; g.add(cone);
      const band = new THREE.Mesh(new THREE.TorusGeometry(hr * 1.07, 0.02, 6, 16), toon(0xd8a860)); band.position.y = hr * 0.82; band.rotation.x = Math.PI / 2 - 0.1; g.add(band);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; addOutline(o, 0.012); } });
      head.add(g);
    }
  }

  // --------------------------------------------------------------
  aimRayPoint(maxD = 80) {
    const cam = G.cameraRig.cam;
    const o = cam.position.clone();
    const d = new THREE.Vector3(); cam.getWorldDirection(d);
    // start the ray at the player's depth so enemies behind the player aren't hit
    const skip = Math.max(0, tmp.subVectors(this.pos, o).dot(d));
    return { o, d, skip };
  }
  aimPoint(maxD = 80) {
    if (this.lockTarget && this.lockTarget.alive) return this.lockTarget.center().clone();
    const { o, d, skip } = this.aimRayPoint(maxD);
    // soft aim assist
    let best = null, bestA = 0.06;
    for (const e of G.enemies.list) {
      if (!e.alive || !e.hittable) continue;
      const c = e.center();
      const to = tmp.subVectors(c, o); const dist = to.length();
      if (dist > maxD || dist < skip) continue;
      const ang = Math.acos(clamp(to.dot(d) / dist, -1, 1));
      const allow = bestA + Math.atan2(e.radius, dist);
      if (ang < allow) { bestA = ang - Math.atan2(e.radius, dist); best = c.clone(); }
    }
    if (best) return best;
    const start = o.clone().addScaledVector(d, skip);
    const t = G.world.terrain.raycast(start, d, maxD);
    if (t !== null) return start.addScaledVector(d, t);
    return start.addScaledVector(d, maxD);
  }
  staffTip() {
    const out = new THREE.Vector3();
    const ay = G.cameraRig.yaw;
    const fx = -Math.sin(ay), fz = -Math.cos(ay);
    const rx = Math.cos(ay), rz = -Math.sin(ay);
    out.set(this.pos.x + fx * 0.65 + rx * 0.22, this.pos.y + 1.45, this.pos.z + fz * 0.65 + rz * 0.22);
    return out;
  }

  // --------------------------------------------------------------
  selectElement(el) {
    if (!this.unlocked.has(el) || el === this.element) return;
    this.prevElement = this.element;
    this.element = el;
    G.audio.play('element_switch', { el });
    G.vfx.burst(this.staffTip(), 'star', 1, { el, size: 1.5 });
    G.vfx.burst(this.staffTip(), 'trail', 8, { el, spread: 0.2, size: 0.3 });
    G.hud.updateSpells();
  }
  unlock(el) {
    this.unlocked.add(el);
    this.selectElement(el);
    G.hud.updateSpells(el);
  }

  canAct() { return G.mode === 'free' && !this.dead && G.state === 'play' && !G.paused; }

  // --------------------------------------------------------------
  update(dt, input) {
    const W = G.world;
    const act = this.canAct() && !this.frozenInput;
    const cr = G.cameraRig;
    // --- input
    let ix = 0, iz = 0;
    if (act) {
      if (input.down('KeyW')) iz += 1; if (input.down('KeyS')) iz -= 1;
      if (input.down('KeyD')) ix += 1; if (input.down('KeyA')) ix -= 1;
    }
    const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
    const { f, r } = cr.moveBasis();
    const move = tmp.set(f.x * iz + r.x * ix, 0, f.z * iz + r.z * ix);
    const moving = move.lengthSq() > 0.01;

    // shift: tap = blink, hold = sprint
    if (act && input.hit('ShiftLeft')) this.shiftT = 0;
    if (act && input.down('ShiftLeft')) this.shiftT += dt;
    if (act && input.up('ShiftLeft') && this.shiftT < 0.2) this.tryBlink(moving ? move : null);
    this.sprinting = act && input.down('ShiftLeft') && this.shiftT >= 0.2 && moving && !this.exhausted && this.grounded && !this.swimming && this.castHold <= 0;

    // --- element selection & casting
    if (act) {
      const keys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
      keys.forEach((k, i) => { if (input.hit(k)) this.selectElement(ELEMENTS[i]); });
      if (input.mouse.wheel) {
        const list = ELEMENTS.filter((e) => this.unlocked.has(e));
        const i = list.indexOf(this.element);
        const n = list[(i + (input.mouse.wheel > 0 ? 1 : -1) + list.length) % list.length];
        this.selectElement(n);
      }
      if (input.hit('KeyT') || input.mHit(1)) this.toggleLock();
      if (!this.swimming && !G.spells.channel) {
        if (input.mDown(0) && this.cd.bolt <= 0) this.castBolt();
        if (input.mHit(2) && this.cd.heavy <= 0) this.castHeavy();
        else if (input.mHit(2)) G.hud.cooldownFlash('heavy');
        if (input.hit('KeyQ')) this.castWeave();
        if (input.hit('KeyF')) this.castUlt();
      }
    }
    this.aimZoom = act && input.mDown(2);
    const cdRate = G.slowmo > 0 ? 2.5 : 1;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt * cdRate);
    this.dodgeCD = Math.max(0, this.dodgeCD - dt);
    this.castHold = Math.max(0, this.castHold - dt);
    if (G.spells.channel) this.castHold = 0.3;
    if (this.lockTarget && (!this.lockTarget.alive || this.lockTarget.pos.distanceTo(this.pos) > 40)) this.lockTarget = null;

    // --- horizontal movement
    let speed = this.swimming ? 3.4 : this.sprinting ? 9.2 : 5.6;
    if (this.castHold > 0 && this.grounded) speed *= 0.72;
    if (G.spells.channel) speed *= 0.4;
    if (this.carry) speed *= 0.9;
    const accel = this.grounded ? 14 : 5;
    if (this.blinkT > 0) {
      this.blinkT -= dt;
      const bs = G.skills && G.skills.has('w_dash') ? 58 : 42;
      this.vel.x = this.blinkDir.x * bs; this.vel.z = this.blinkDir.z * bs;
      if (this.blinkT <= 0) { this.vel.x *= 0.25; this.vel.z *= 0.25; }
      if (Math.random() < 0.9) G.vfx.burst(tmp2.copy(this.pos).setY(this.pos.y + 1), 'trail', 3, { el: this.element, spread: 0.4, size: 0.5, life: 0.4 });
    } else if (this.gliding) {
      const gs = G.skills && G.skills.has('w_tailwind') ? 11.3 : 9;
      this.vel.x = damp(this.vel.x, move.x * gs + (moving ? 0 : Math.sin(this.yaw) * 5), 2.5, dt);
      this.vel.z = damp(this.vel.z, move.z * gs + (moving ? 0 : Math.cos(this.yaw) * 5), 2.5, dt);
    } else {
      this.vel.x = damp(this.vel.x, move.x * speed, accel, dt);
      this.vel.z = damp(this.vel.z, move.z * speed, accel, dt);
    }

    // --- jump / glide
    if (this.grounded) { this.coyote = 0.12; this.airBlink = G.skills && G.skills.has('w_dash') ? 2 : 1; } else this.coyote -= dt;
    if (act && input.hit('Space')) this.jumpBuf = 0.15; else this.jumpBuf -= dt;
    if (this.jumpBuf > 0 && this.coyote > 0 && !this.swimming) {
      this.vel.y = 9.6; this.grounded = false; this.coyote = 0; this.jumpBuf = 0;
      G.audio.play('jump');
      G.vfx.burst(this.pos, 'dust', 4, { speed: 2, size: 0.4 });
    }
    const wantGlide = act && input.down('Space') && !this.grounded && !this.swimming && this.vel.y < 0 && !this.exhausted && this.stamina > 0 && this.coyote < -0.1;
    if (wantGlide && !this.gliding) { G.audio.play('glide'); this.gliding = true; this.glideCircle = G.vfx.circle(this.pos, PAL[this.element].glow, 1.2, 0, { follow: this.root, offset: new THREE.Vector3(0, 2.6, 0), spin: 2, alpha: 0.7 }); }
    if (!wantGlide && this.gliding) { this.gliding = false; if (this.glideCircle) { this.glideCircle.end(); this.glideCircle = null; } }

    // --- vertical physics
    if (this.blinkT <= 0) this.vel.y -= GRAV * dt * (this.updraft > 0 ? 0.3 : 1);
    this.updraft = Math.max(0, this.updraft - dt);
    if (this.gliding) this.vel.y = Math.max(this.vel.y, -2.6);
    this.vel.y = Math.max(this.vel.y, -42);
    const prevGround = W.ground(this.pos.x, this.pos.z, this.pos.y + 0.6);

    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    // steep slope blocking
    const n = W.terrain.normal(nx, nz, tmp2);
    const plat = W.col.platformTop(nx, nz, this.pos.y + 0.6);
    if (n.y < 0.64 && plat < -1e8 && this.grounded && !this.swimming) {
      const dh = W.h(nx, nz) - W.h(this.pos.x, this.pos.z);
      if (dh > 0) {
        const dl = Math.hypot(n.x, n.z) || 1;
        const dx = n.x / dl, dz = n.z / dl;
        const into = this.vel.x * dx + this.vel.z * dz;
        if (into < 0) { this.vel.x -= into * dx; this.vel.z -= into * dz; }
        this.vel.x += dx * 6 * dt * 10; this.vel.z += dz * 6 * dt * 10;
      }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    W.col.resolve(this.pos, 0.42, 1.8);
    const rr = Math.hypot(this.pos.x, this.pos.z);
    if (rr > 214) { this.pos.x *= 214 / rr; this.pos.z *= 214 / rr; }

    // --- ground & water
    const ground = W.ground(this.pos.x, this.pos.z, this.pos.y + 0.6);
    const waterDepth = W.water.level - ground;
    const wasGrounded = this.grounded;
    if (waterDepth > 1.15 && this.pos.y < W.water.level - 0.9 && this.blinkT <= 0) {
      if (!this.swimming) { G.audio.play('splash', { pos: this.pos }); G.vfx.burst(this.pos.clone().setY(0.1), 'trail', 16, { el: 'frost', spread: 0.8, size: 0.4 }); }
      this.swimming = true; this.gliding = false;
      this.pos.y = damp(this.pos.y, W.water.level - 1.05, 8, dt);
      this.vel.y = 0; this.grounded = false;
    } else {
      this.swimming = false;
      if (this.pos.y <= ground) {
        if (!wasGrounded) this.onLand(this.vel.y);
        this.pos.y = ground; this.vel.y = Math.max(0, this.vel.y);
        this.grounded = true;
      } else if (wasGrounded && this.pos.y - ground < 0.45 && this.vel.y <= 0) {
        this.pos.y = ground; this.vel.y = 0; this.grounded = true; // stick to slopes going down
      } else this.grounded = false;
    }
    if (this.grounded && !this.swimming && waterDepth < 0.5) {
      if (G.time % 1 < dt) this.lastSafe.copy(this.pos);
    }
    void prevGround;

    // --- stamina
    let drain = 0;
    if (this.sprinting) drain = 16;
    if (this.gliding) drain = G.skills && G.skills.has('w_tailwind') ? 4.5 : 7.5;
    if (this.swimming && moving) drain = 6;
    if (drain) { this.stamina -= drain * dt; this.staminaUse = 1.2; }
    else if (this.grounded || this.swimming) this.stamina += (this.exhausted ? 22 : 34) * dt * (this.staminaUse > 0 ? 0 : 1);
    this.staminaUse = Math.max(0, (this.staminaUse || 0) - dt);
    if (this.stamina <= 0) {
      this.stamina = 0;
      if (!this.exhausted) { this.exhausted = true; G.audio.play('mana_empty'); }
      if (this.swimming) this.drown();
    }
    if (this.exhausted && this.stamina >= this.maxStamina * 0.35) this.exhausted = false;
    this.stamina = Math.min(this.maxStamina, this.stamina);

    // --- mana & hp regen
    this.manaDelay -= dt;
    const flow = 1 + 0.2 * (G.skills ? G.skills.r('a_flow') : 0);
    if (this.manaDelay <= 0) this.mana = Math.min(this.maxMana, this.mana + dt * (10 + this.level * 0.6) * flow);
    this.invuln = Math.max(0, this.invuln - dt);
    this.barrier = Math.max(0, this.barrier - dt);
    const inCombat = G.enemies.inCombat();
    if (!inCombat && G.time - this.lastHurt > 6 && this.hp < this.maxHp && !this.dead) {
      this.regenT += dt;
      if (this.regenT > 2.5) { this.regenT = 0; this.hp = Math.min(this.maxHp, this.hp + 1); G.hud.updateHearts(); }
    }

    // --- facing
    const aiming = this.castHold > 0 || this.lockTarget || G.spells.channel;
    if (aiming) {
      const ty = this.lockTarget ? Math.atan2(this.lockTarget.pos.x - this.pos.x, this.lockTarget.pos.z - this.pos.z) : Math.atan2(-Math.sin(cr.yaw), -Math.cos(cr.yaw));
      this.yaw = angleDamp(this.yaw, ty, 18, dt);
    } else if (moving || this.gliding) {
      const hv = Math.hypot(this.vel.x, this.vel.z);
      if (hv > 0.5) this.yaw = angleDamp(this.yaw, Math.atan2(this.vel.x, this.vel.z), this.grounded ? 12 : 5, dt);
    }

    // --- footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && hs > 1) {
      this.stepT -= dt * hs * 0.36;
      if (this.stepT <= 0) { this.stepT = 1; G.audio.play('step', { pos: this.pos, surface: W.terrain.surfaceAt(this.pos.x, this.pos.z), gap: 0.1 }); if (this.sprinting) G.vfx.burst(this.pos, 'dust', 1, { speed: 1.5, size: 0.35 }); }
    }
    if (this.swimming && hs > 0.5 && Math.random() < dt * 8) G.vfx.burst(this.pos.clone().setY(0.05), 'trail', 2, { el: 'frost', spread: 0.5, size: 0.3 });

    // --- visuals
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const aimPitch = aiming ? clamp(-cr.pitch * 0.8 + 0.1, -0.6, 0.6) : 0;
    this.rig.update(dt, {
      speed: this.swimming ? hs : this.grounded ? hs : 0, grounded: this.grounded, vy: this.vel.y,
      cast: this.castHold > 0, aimPitch, glide: this.gliding, swim: this.swimming, talk: this.talking,
    });
    if (this.rig.p.gem) {
      const c = PAL[this.element].core;
      this.rig.p.gem.material.color.setRGB(c.r * 0.8, c.g * 0.8, c.b * 0.8);
      this.rig.p.gem.rotation.y += dt * 3;
    }
    if (this.invuln > 0 && this.blinkT <= 0 && this.hurtFlash > 0) this.root.visible = Math.floor(G.realTime * 20) % 2 === 0;
    else this.root.visible = true;
    this.hurtFlash = Math.max(0, (this.hurtFlash || 0) - dt);
    if (this.barrier > 0 && Math.random() < dt * 20) G.vfx.burst(this.center(), 'trail', 1, { el: 'frost', spread: 0.9, size: 0.25 });
    if (this.carry) { this.carry.root.position.set(0.22, 1.62, -0.05); this.carry.update(dt); }
  }

  onLand(vy) {
    const fall = -vy;
    if (fall > 6) { G.audio.play('land', { v: Math.min(1, fall / 20) }); G.vfx.burst(this.pos, 'dust', Math.min(10, Math.floor(fall / 2)), { speed: 3, size: 0.6 }); }
    if (fall > 8) this.rig.p.hips.position.y -= 0.12;
    if (fall > 24 && !this.gliding) {
      const dmg = Math.min(12, Math.floor((fall - 24) / 3) + 2);
      this.damage(dmg, { fall: true });
      G.cameraRig.shake(0.4);
    }
    if (this.gliding && this.glideCircle) { this.glideCircle.end(); this.glideCircle = null; }
    this.gliding = false;
  }

  tryBlink(dir) {
    if (this.blinkT > 0 || this.exhausted || this.stamina < 18 || this.swimming) return;
    if (!this.grounded && this.airBlink <= 0) return;
    if (!this.grounded) this.airBlink--;
    const dash = G.skills && G.skills.has('w_dash');
    this.stamina -= dash ? 15 : 22; this.staminaUse = 0.6;
    this.blinkAt = G.time;
    if (G.skills && G.skills.has('a_afterimage')) {
      const at = this.center();
      G.later(() => {
        G.vfx.burst(at, 'arcane', 24, { speed: 6 }); G.vfx.ring(at.clone().setY(at.y - 0.9), PAL.arcane.glow, 3.4, 0.35, { thick: 0.3 });
        G.audio.play('impact_arcane', { pos: at });
        for (const e of G.spells.enemiesIn(at, 2.6)) G.combat.hit(e, { dmg: this.power() * 0.9, el: 'arcane', pos: e.center(), dir: tmp.subVectors(e.center(), at).setY(0).normalize().clone(), knock: 6, source: 'player', hitstop: 0.03 });
      }, 120);
    }
    const d = dir ? dir.clone().normalize() : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.blinkDir.copy(d);
    this.blinkT = 0.16;
    this.invuln = Math.max(this.invuln, 0.32);
    if (!this.grounded) this.vel.y = Math.max(this.vel.y, 2);
    G.audio.play('blink');
    const c = this.center();
    G.vfx.burst(c, 'arcane', 18, { speed: 4 });
    G.vfx.burst(c, 'star', 1, { el: this.element, size: 3 });
    G.vfx.circle(c, PAL[this.element].glow, 0.9, 0.2, { vertical: true, dir: d, spin: 10 });
    G.renderer.grade.uniforms.uImpact.value = Math.max(G.renderer.grade.uniforms.uImpact.value, 0.18);
  }

  toggleLock() {
    if (this.lockTarget) { this.lockTarget = null; return; }
    const cr = G.cameraRig;
    const fwd = new THREE.Vector3(-Math.sin(cr.yaw), 0, -Math.cos(cr.yaw));
    let best = null, bs = -1;
    for (const e of G.enemies.list) {
      if (!e.alive || !e.hittable) continue;
      const to = tmp.subVectors(e.pos, this.pos); const d = to.length();
      if (d > 32) continue;
      to.y = 0; to.normalize();
      const s = to.dot(fwd) * 2 - d / 32;
      if (s > bs && to.dot(fwd) > 0.2) { bs = s; best = e; }
    }
    this.lockTarget = best;
    if (best) G.audio.play('ui_click');
  }

  spend(cost) {
    if (G.slowmo > 0 && cost < 10) return true;
    if (this.mana < cost) { G.hud.manaShort(); G.audio.play('mana_empty', { gap: 0.3 }); return false; }
    this.mana -= cost; this.manaDelay = 0.9; return true;
  }

  castBolt() {
    const el = this.element, def = BOLT[el];
    if (!this.spend(def.cost)) { this.cd.bolt = 0.3; return; }
    this.cd.bolt = def.cd;
    this.castHold = 0.9;
    this.rig.flick();
    const origin = this.staffTip();
    const aim = this.aimPoint();
    G.spells.bolt(el, origin, aim, this.power());
    G.hud.castPulse();
    this.stats.casts++; this.stats.bolts++;
    if (G.story) G.story.onCast('bolt', el);
  }
  castHeavy() {
    const el = this.element, def = HEAVY[el];
    if (!this.spend(def.cost)) return;
    this.cd.heavy = def.cd; this.cd.heavyMax = def.cd;
    this.castHold = 1.0;
    this.rig.flick();
    const origin = this.staffTip();
    G.spells.heavy(el, origin, this.aimPoint(), this.power(), this);
    G.cameraRig.shake(0.08);
    this.stats.casts++; this.stats.heavies++;
    if (G.story) G.story.onCast('heavy', el);
  }
  castWeave() {
    const a = this.element, b = this.prevElement;
    const info = weaveInfo(a, b);
    if (!info || !this.unlocked.has(b)) { G.hud.toast('두 가지 속성을 번갈아 고르면 <b>엮기(Q)</b>를 쓸 수 있다.'); return; }
    if (this.cd.weave > 0) { G.hud.cooldownFlash('weave'); return; }
    if (!this.spend(WEAVE_COST)) return;
    this.cd.weave = WEAVE_CD;
    this.castHold = 1.2;
    this.rig.flick();
    G.spells.weave(a, b, this.staffTip(), this.aimPoint(), this.power(), this);
    G.hitstop = Math.max(G.hitstop, 0.05);
    G.cameraRig.shake(0.15);
    this.stats.casts++; this.stats.weaves++;
    if (G.story) G.story.onCast('weave', info.key);
  }

  castUlt() {
    const K = G.skills;
    const el = this.element;
    const id = K && K.ultFor(el);
    if (!id) { G.hud.toast(K && Object.keys(K.ranks).some((k) => k.endsWith('_ult')) ? '이 속성의 궁극기를 아직 익히지 못했다. <kbd>K</kbd> 울림 나무' : '궁극기는 울림 나무(<kbd>K</kbd>) 각 속성의 끝에서 익힐 수 있다.'); return; }
    if (K.gauge < ULT_COST) { G.hud.ultShort && G.hud.ultShort(); G.audio.play('mana_empty', { gap: 0.3 }); return; }
    K.gauge = 0;
    this.castHold = 1.4;
    this.rig.flick();
    this.invuln = Math.max(this.invuln, 0.6);
    G.spells.ult(el, this.staffTip(), this.aimPoint(), this.power(), this);
    this.stats.casts++;
    if (G.story && G.story.onCast) G.story.onCast('ult', el);
  }

  // Perfect dodge: an attack connecting during blink i-frames triggers "울림 가속" (slow motion)
  perfectDodge(o) {
    if (this.dodgeCD > 0) return;
    this.dodgeCD = 5;
    const dur = 2.6 + (G.skills && G.skills.has('a_afterimage') ? 1.5 : 0);
    G.slowmo = dur; G.slowmoMax = dur;
    G.audio.play('perfect_dodge');
    G.hud.floatText(this.center().add(new THREE.Vector3(0, 0.6, 0)), '완벽 회피!', '#bfe8ff', 'react');
    G.vfx.burst(this.center(), 'star', 1, { el: 'white', size: 6 });
    G.vfx.ring(this.pos, PAL.white.core, 7, 0.5, { thick: 0.15 });
    G.renderer.grade.uniforms.uImpact.value = Math.max(G.renderer.grade.uniforms.uImpact.value, 0.45);
    G.hitstop = Math.max(G.hitstop, 0.05);
    if (G.skills) G.skills.charge(12);
    this.invuln = Math.max(this.invuln, 0.5);
    this.stamina = Math.min(this.maxStamina, this.stamina + 20);
    if (G.story && G.story.once('perfect1')) G.hud.hint('<b>완벽 회피</b> — 공격이 닿기 직전 <kbd>Shift</kbd> 순간이동으로 피하면 울림이 가속한다<br><small>잠시 적이 느려지고, 기본 마법의 마나가 들지 않으며, 재사용 대기가 빨라진다</small>', 8);
  }

  // --------------------------------------------------------------
  damage(amount, o = {}) {
    if (this.dead || G.mode !== 'free' || G.state !== 'play') return;
    this.dodged = false;
    if (!o.fall && (this.blinkT > 0 || G.time - this.blinkAt < 0.3)) { this.dodged = true; this.perfectDodge(o); return; }
    if (!o.fall && this.invuln > 0) return;
    let a = amount;
    if (this.barrier > 0) a = Math.max(1, Math.round(a * 0.6));
    this.hp -= a;
    this.lastHurt = G.time;
    this.invuln = 0.7; this.hurtFlash = 0.7;
    this.rig.hurt();
    G.audio.play('player_hurt');
    G.cameraRig.shake(0.35);
    G.hitstop = Math.max(G.hitstop, 0.05);
    G.hud.playerHurt(a);
    if (o.dir && o.knock) { this.vel.x += o.dir.x * o.knock; this.vel.z += o.dir.z * o.knock; if (this.grounded) this.vel.y = 3; this.grounded = false; }
    G.vfx.burst(this.center(), 'spark', 8, { el: 'hush' });
    if (this.hp <= 0) { this.hp = 0; this.die(); }
    G.hud.updateHearts(true);
  }
  heal(q) {
    this.hp = Math.min(this.maxHp, this.hp + q);
    G.hud.updateHearts();
  }
  die() {
    this.dead = true;
    this.gliding = false;
    if (this.glideCircle) { this.glideCircle.end(); this.glideCircle = null; }
    G.game.onPlayerDeath();
  }
  drown() {
    if (this.dead) return;
    G.hud.toast('물살에 휩쓸렸다…');
    this.hp = Math.max(1, this.hp - 4); G.hud.updateHearts(true);
    G.audio.play('splash', { pos: this.pos });
    this.teleport(this.lastSafe.x, this.lastSafe.z);
    this.stamina = this.maxStamina * 0.5; this.exhausted = false;
  }

  addXP(n) {
    this.xp += n;
    let up = 0;
    while (this.xp >= xpNeed(this.level)) {
      this.xp -= xpNeed(this.level);
      this.level++;
      up++;
      this.maxMana += 6;
      if (this.level % 2 === 0) this.maxHp += 4;
    }
    if (up) {
      this.hp = this.maxHp; this.mana = this.maxMana;
      G.audio.play('levelup');
      if (G.skills) G.skills.gain(2 * up);
      G.hud.banner('LEVEL UP', `울림이 깊어졌다 — Lv ${this.level}`, `마법의 위력이 강해졌다.${this.level % 2 === 0 ? ' 생명력의 그릇이 늘었다.' : ''}<br><b style="color:#f1d48a">울림점 +${2 * up}</b> · <kbd>K</kbd> 울림 나무에서 새 노래를 익히자`, '#f1d48a');
      G.vfx.burst(this.center(), 'soul', 30, { el: 'gold' });
      G.vfx.ring(this.pos, PAL.gold.core, 4, 0.8, { thick: 0.2 });
      G.hud.updateHearts();
    }
    G.hud.updateXP();
  }
}
