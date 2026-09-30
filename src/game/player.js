// Player: movement (run, sprint, blink, jump, glide, swim), casting and stats.
import * as THREE from 'three';
import { G, ELEMENTS } from '../core/context.js';
import { makeHumanoid, CHAR } from './characters.js';
import { BOLT, HEAVY, WEAVE_COST, WEAVE_CD, CHARGED, CHARGE_T, weaveInfo } from './spells.js';
import { ULT_COST, SIG, WEAVE_NODE } from './skills.js';
import { clamp, damp, angleDamp, lerp, randRange, josa } from '../core/util.js';
import { PAL } from '../render/vfx.js';
import { toon, addOutline } from '../render/materials.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const GRAV = 26;
const CLIMB_JUMP_COST = 20;

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
    this.lmbT = 0; this.boltBuf = 0; this.charge = null; // basic spell: tap = bolt, hold = charged shot
    this.castHold = 0; this.manaDelay = 0;
    this.manaLowArmed = true; this.manaFullArmed = false; this.manaFullT = -99; this.manaMuteT = -99; this.lockedMsgT = -99;
    this.regenRate = 0;
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
    // climbing: { kind: 'terrain'|'shape', nx, nz, sx, sz (surface point, terrain) } · mantle: ledge pull-up
    this.climbing = null; this.mantle = null; this.regrabT = 0; this.pushT = 0; this.climbJump = 0;
    this.climbPhase = 0; this.climbMove = 0; this.slipT = 0;
    this.stats = { casts: 0, bolts: 0, heavies: 0, weaves: 0, reactions: 0 };
    this.hasHat = false;
  }

  power() { return 10 * (1 + 0.14 * (this.level - 1)); }
  center() { return new THREE.Vector3(this.pos.x, this.pos.y + 0.95, this.pos.z); }

  teleport(x, z, yaw) {
    this.pos.set(x, G.world.ground(x, z) + 0.05, z);
    this.vel.set(0, 0, 0);
    this.climbing = null; this.mantle = null; this.grounded = true;
    if (this.gliding) { this.gliding = false; if (this.glideCircle) { this.glideCircle.end(); this.glideCircle = null; } }
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
    // unshaken view ray, so camera shake/kick never nudges the aim
    const { o, d } = G.cameraRig.aimRay();
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

  // can enemies perceive the player right now?
  seen() { return !this.dead && G.mode === 'free' && !G.dev.unseen; }
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
    if (act && input.up('ShiftLeft') && this.shiftT < 0.2) { if (this.climbing) this.letGo(); else if (!this.mantle) this.tryBlink(moving ? move : null); }
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
      if (!this.swimming && !G.spells.channel && !this.climbing && !this.mantle) {
        this.basicInput(input);
        if (input.mHit(2) && this.cd.heavy <= 0) this.castHeavy();
        else if (input.mHit(2)) G.hud.cooldownFlash('heavy');
        if (input.hit('KeyQ')) this.castWeave();
        if (input.hit('KeyF')) this.castUlt();
      } else if (this.charge) this.endCharge(false);
    } else if (this.charge) this.endCharge(false);
    this.aimZoom = act && input.mDown(2);
    const cdRate = G.slowmo > 0 ? 2.5 : 1;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt * cdRate);
    this.dodgeCD = Math.max(0, this.dodgeCD - dt);
    this.castHold = Math.max(0, this.castHold - dt);
    if (G.spells.channel) this.castHold = 0.3;
    if (this.lockTarget && (!this.lockTarget.alive || this.lockTarget.pos.distanceTo(this.pos) > 40)) this.lockTarget = null;

    if (this.mantle) this.updateMantle(dt);
    else if (this.climbing) this.updateClimb(dt, ix, iz, act, input);
    else {
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
      const wantGlide = act && input.down('Space') && !this.grounded && !this.swimming && (this.gliding || this.vel.y < 0) && !this.exhausted && this.stamina > 0 && this.coyote < -0.1;
      if (wantGlide && !this.gliding) { G.audio.play('glide'); this.gliding = true; this.glideCircle = G.vfx.circle(this.pos, PAL[this.element].glow, 1.2, 0, { follow: this.root, offset: new THREE.Vector3(0, 2.6, 0), spin: 2, alpha: 0.7 }); }
      if (!wantGlide && this.gliding) { this.gliding = false; if (this.glideCircle) { this.glideCircle.end(); this.glideCircle = null; } }

      // --- vertical physics
      if (this.blinkT <= 0) this.vel.y -= GRAV * dt * (this.updraft > 0 ? 0.3 : 1);
      this.updraft = Math.max(0, this.updraft - dt);
      if (this.gliding) this.vel.y = Math.max(this.vel.y, -2.6);
      // hot air over wildfire (and other heat sources) carries a glider up
      const lift = G.env ? G.env.liftAt(this.pos.x, this.pos.y, this.pos.z) : 0;
      if (lift > 0.02) {
        if (this.gliding) { this.vel.y += GRAV * dt * Math.min(0.85, lift); this.vel.y = damp(this.vel.y, 1 + 4.5 * lift, 2.2, dt); }
        else if (!this.grounded) this.vel.y += 4 * lift * dt;
        if (this.gliding && G.story && G.story.once('updraft1')) G.hud.toast('뜨거운 바람이 몸을 들어 올린다!');
      }
      this.vel.y = Math.max(this.vel.y, -42);

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
      const bd = W.terrain.bound;
      this.pos.x = clamp(this.pos.x, -bd, bd); this.pos.z = clamp(this.pos.z, -bd, bd);

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
      this.tryGrab(dt, move, moving, act);
    }
    this.regrabT = Math.max(0, this.regrabT - dt);

    // --- stamina
    let drain = 0;
    if (this.sprinting) drain = 16;
    if (this.gliding) drain = G.skills && G.skills.has('w_tailwind') ? 4.5 : 7.5;
    if (this.swimming && moving) drain = 6;
    if (this.climbing && this.climbMove > 0.1) drain = 10;
    if (drain) { this.stamina -= drain * dt; this.staminaUse = 1.2; }
    else if (this.grounded || this.swimming) this.stamina += (this.exhausted ? 22 : 34) * dt * (this.staminaUse > 0 ? 0 : 1);
    this.staminaUse = Math.max(0, (this.staminaUse || 0) - dt);
    if (this.stamina <= 0) {
      this.stamina = 0;
      if (!this.exhausted) { this.exhausted = true; G.audio.play('mana_empty'); }
      if (this.swimming) this.drown();
      if (this.climbing) this.letGo(true);
    }
    if (this.exhausted && this.stamina >= this.maxStamina * 0.35) this.exhausted = false;
    this.stamina = Math.min(this.maxStamina, this.stamina);

    // --- mana & hp regen
    const inCombat = G.enemies.inCombat();
    this.manaDelay -= dt;
    this.regenRate = this.manaDelay <= 0 && this.mana < this.maxMana ? this.manaRegenRate(inCombat) : 0;
    if (this.regenRate > 0) this.mana = Math.min(this.maxMana, this.mana + dt * this.regenRate);
    this.manaWatch();
    this.invuln = Math.max(0, this.invuln - dt);
    this.barrier = Math.max(0, this.barrier - dt);
    if (!inCombat && G.time - this.lastHurt > 6 && this.hp < this.maxHp && !this.dead) {
      this.regenT += dt;
      if (this.regenT > 2.5) { this.regenT = 0; this.hp = Math.min(this.maxHp, this.hp + 1); G.hud.updateHearts(); }
    }

    // --- facing
    const aiming = !this.climbing && !this.mantle && (this.castHold > 0 || this.lockTarget || G.spells.channel);
    if (this.climbing) this.yaw = angleDamp(this.yaw, Math.atan2(-this.climbing.nx, -this.climbing.nz), 14, dt);
    else if (aiming) {
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
      cast: this.castHold > 0 && !this.climbing, aimPitch, glide: this.gliding, swim: this.swimming, talk: this.talking,
      climb: !!this.climbing || !!this.mantle, climbPhase: this.climbPhase, climbMove: this.climbMove, mantle: this.mantle ? this.mantle.t / this.mantle.dur : 0,
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

  // ---------------- climbing ----------------
  // Any steep cliff (terrain normal.y < 0.64) or solid shape (walls, rocks,
  // pillars) can be grabbed by pushing into it. Low ledges are vaulted.
  canGrab() {
    return !this.swimming && !this.exhausted && this.stamina > 1 && this.regrabT <= 0 && this.blinkT <= 0 && !this.dead;
  }
  tryGrab(dt, move, moving, act) {
    if (!act || !moving || !this.canGrab()) { this.pushT = 0; return; }
    const W = G.world;
    const ml = Math.hypot(move.x, move.z) || 1, mx = move.x / ml, mz = move.z / ml;
    // solid shapes first (buildings, rocks)
    const w = W.col.wallNear(this.pos.x, this.pos.y, this.pos.z, 0.62, 1.6);
    if (w && -(mx * w.nx + mz * w.nz) > 0.55) {
      const rise = w.top - this.pos.y;
      if (rise > 0.3 && !w.c.noTop && rise < 1.45 && this.pos.y + 0.2 > w.c.h0) {
        // waist-high ledge: vault over it after a short push
        this.pushT += dt;
        const k = this.inset(w.c), tx = w.px - w.nx * k, tz = w.pz - w.nz * k;
        if (this.pushT > (this.grounded ? 0.08 : 0)) this.startMantle(tx, Math.max(w.top, W.col.topAt(w.c, tx, tz)), tz, 0.32);
        return;
      }
      if (rise >= 1.45) {
        this.pushT += dt;
        if (this.pushT > (this.grounded ? 0.12 : 0)) this.startClimb({ kind: 'shape', c: w.c, nx: w.nx, nz: w.nz });
        return;
      }
    }
    // steep terrain ahead: find where the cliff face crosses chest height
    let d0 = 0, hit = -1;
    for (const d of [0.3, 0.55, 0.8, 1.05]) {
      if (W.h(this.pos.x + mx * d, this.pos.z + mz * d) > this.pos.y + 0.6) { hit = d; break; }
      d0 = d;
    }
    if (hit > 0) {
      for (let i = 0; i < 5; i++) { const m = (d0 + hit) / 2; if (W.h(this.pos.x + mx * m, this.pos.z + mz * m) > this.pos.y + 0.6) hit = m; else d0 = m; }
      const sx = this.pos.x + mx * hit, sz = this.pos.z + mz * hit;
      const n = W.terrain.normal(sx, sz, tmp2);
      const hl = Math.hypot(n.x, n.z) || 1, nhx = n.x / hl, nhz = n.z / hl;
      if (n.y < 0.64 && -(mx * nhx + mz * nhz) > 0.5 && W.col.platformTop(sx, sz, this.pos.y + 0.6) < -1e8) {
        this.pushT += dt;
        if (this.pushT > (this.grounded ? 0.15 : 0)) this.startClimb({ kind: 'terrain', nx: nhx, nz: nhz, sx, sz });
        return;
      }
    }
    this.pushT = 0;
  }
  // how far past the lip to step when pulling up onto a shape
  inset(c) { return c.type === 'circle' ? Math.min(0.9, c.r * 0.75) : Math.min(0.9, Math.min(c.hw, c.hd) * 0.9); }
  startClimb(c) {
    this.climbing = c;
    this.pushT = 0; this.climbJump = 0; this.slipT = 0;
    this.gliding = false;
    if (this.glideCircle) { this.glideCircle.end(); this.glideCircle = null; }
    this.grounded = false; this.sprinting = false;
    this.vel.set(0, 0, 0);
    this.lockTarget = null;
    this.snapClimb();
    G.audio.play('climb_grab', { pos: this.pos });
    if (G.story && G.story.once('climb1')) G.hud.hint('<b>등반</b> — 가파른 벽이나 바위를 향해 계속 걸으면 붙잡는다<br><small><kbd>W A S D</kbd> 오르내리기 · <kbd>Space</kbd> 도약(기력 소모) · <kbd>S</kbd>+<kbd>Space</kbd> 벽 차고 뛰기 · <kbd>Shift</kbd> 놓기</small>', 9);
  }
  // Keep the body pressed against the grabbed surface. Returns false if it's gone.
  snapClimb() {
    const C = this.climbing, W = G.world;
    if (C.kind === 'terrain') {
      const n = W.terrain.normal(C.sx, C.sz, tmp2);
      const hl = Math.hypot(n.x, n.z) || 1;
      C.nx = n.x / hl; C.nz = n.z / hl; C.ny = n.y;
      this.pos.set(C.sx + C.nx * 0.34, W.h(C.sx, C.sz) - 0.25, C.sz + C.nz * 0.34);
      return true;
    }
    const w = W.col.wallNear(this.pos.x, this.pos.y, this.pos.z, 1.2, 1.6);
    if (!w) return false;
    C.c = w.c; C.nx = w.nx; C.nz = w.nz; C.top = w.top;
    this.pos.x = w.px + w.nx * 0.44; this.pos.z = w.pz + w.nz * 0.44;
    return true;
  }
  updateClimb(dt, ix, iz, act, input) {
    const W = G.world, C = this.climbing;
    // climb jump: a burst of stamina for a quick lunge; S + Space kicks off the wall
    if (act && input.hit('Space') && this.climbJump <= 0) {
      if (iz < -0.3) { this.wallKick(); return; }
      // the lunge costs its full price up front; too tired for it, the wheel flashes
      // instead of starting a jump that would exhaust the player and drop them off the wall
      if (this.stamina >= CLIMB_JUMP_COST) {
        this.stamina -= CLIMB_JUMP_COST; this.staminaUse = 1.2;
        this.climbJump = 0.34; this.cjDir = [ix, Math.abs(ix) + Math.abs(iz) < 0.2 ? 1 : iz];
        G.audio.play('climb_jump', { pos: this.pos });
        G.vfx.burst(this.center(), 'dust', 5, { speed: 2.5, size: 0.4 });
      } else if (G.hud.staminaShort) G.hud.staminaShort();
    }
    let mx = ix, my = iz, speed = 2.3;
    if (this.climbJump > 0) {
      this.climbJump -= dt;
      [mx, my] = this.cjDir; speed = 7.4;
      const l = Math.hypot(mx, my) || 1; mx /= l; my /= l;
    }
    if (this.exhausted) { mx = 0; my = Math.min(my, 0); }
    const moving = Math.abs(mx) + Math.abs(my) > 0.05;
    this.climbMove = damp(this.climbMove, moving ? 1 : 0, 10, dt);
    if (moving) this.climbPhase += dt * speed * 0.62;
    // rain makes rock slick: now and then the grip slips
    if (G.world.weather && G.world.weather.wet > 0.4 && moving && my > 0 && this.climbJump <= 0) {
      this.slipT += dt;
      if (this.slipT > 2.2) { this.slipT = 0; my = -3.5; G.hud.floatText && G.hud.floatText(this.center(), '미끄러진다!', '#bfe0ff'); G.audio.play('climb_slip', { pos: this.pos }); }
    }
    // right (when facing the wall) and surface-up vectors
    const rx = C.nz, rz = -C.nx;
    if (C.kind === 'terrain') {
      // surface-up = (-n_h·cosθ, sinθ): drift into the cliff by n.y per metre and let the heightfield supply the rise
      const ny = C.ny ?? 0.4, k = speed * dt;
      C.sx += (-C.nx * ny * my + rx * mx) * k;
      C.sz += (-C.nz * ny * my + rz * mx) * k;
      this.snapClimb();
      const n = W.terrain.normal(C.sx, C.sz, tmp2);
      if (n.y > 0.72) {
        // slope eased off: top out (going up) or step down onto it
        if (my >= 0) this.startMantle(C.sx - C.nx * 0.4, W.h(C.sx - C.nx * 0.4, C.sz - C.nz * 0.4), C.sz - C.nz * 0.4, 0.34);
        else this.endClimb();
        return;
      }
    } else {
      this.pos.y += my * speed * dt;
      this.pos.x += rx * mx * speed * dt; this.pos.z += rz * mx * speed * dt;
      if (!this.snapClimb()) { this.letGo(); return; }
      const top = C.top;
      if (!C.c.noTop && this.pos.y + 1.15 >= top && my > 0) {
        const tx = this.pos.x - C.nx * (0.44 + this.inset(C.c)), tz = this.pos.z - C.nz * (0.44 + this.inset(C.c));
        this.startMantle(tx, Math.max(top, W.col.topAt(C.c, tx, tz)), tz, 0.42);
        return;
      }
      if (this.pos.y + 1.4 > C.c.h1) this.pos.y = C.c.h1 - 1.4; // can't climb past an unwalkable top
      const g = W.ground(this.pos.x, this.pos.z, this.pos.y + 0.4);
      if (this.pos.y <= g + 0.02) {
        this.pos.y = g;
        if (my < 0 || this.exhausted) { this.endClimb(); return; }
      }
      // a grabbed boulder or wall can hand over to steep terrain above it
      const tn = W.terrain.normal(this.pos.x, this.pos.z, tmp2);
      if (W.h(this.pos.x, this.pos.z) > this.pos.y + 0.1 && tn.y < 0.64) {
        this.climbing = { kind: 'terrain', nx: C.nx, nz: C.nz, sx: this.pos.x - C.nx * 0.34, sz: this.pos.z - C.nz * 0.34 };
      }
    }
    W.col.resolve(this.pos, 0.3, 1.6);
    // grip noises
    if (moving) {
      this.stepT -= dt * speed * 0.8;
      if (this.stepT <= 0) { this.stepT = 1; G.audio.play('step', { pos: this.pos, surface: 'stone', gap: 0.1, v: 0.5 }); if (Math.random() < 0.35) G.vfx.burst(this.center(), 'dust', 1, { speed: 1, size: 0.3 }); }
    }
  }
  wallKick() {
    const C = this.climbing;
    // kicking off is also the way out, so it is never refused, but it cannot exhaust you mid-air
    this.stamina = Math.max(1, this.stamina - 12); this.staminaUse = 1.2;
    this.climbing = null; this.regrabT = 0.45;
    this.vel.set(C.nx * 6.5, 7.5, C.nz * 6.5);
    this.yaw = Math.atan2(C.nx, C.nz);
    this.grounded = false; this.coyote = -1;
    G.audio.play('jump');
    G.vfx.burst(this.center(), 'dust', 6, { speed: 3, size: 0.45 });
  }
  letGo(tired = false) {
    const C = this.climbing;
    if (!C) return;
    this.climbing = null;
    this.regrabT = tired ? 1.2 : 0.4;
    this.vel.set(C.nx * 1.6, tired ? -1 : 0, C.nz * 1.6);
    this.grounded = false; this.coyote = -1;
    if (tired) G.audio.play('climb_slip', { pos: this.pos });
  }
  endClimb() {
    this.climbing = null; this.regrabT = 0.3;
    this.vel.set(0, 0, 0); this.grounded = true;
    this.pos.y = G.world.ground(this.pos.x, this.pos.z, this.pos.y + 0.6);
  }
  startMantle(x, y, z, dur) {
    this.climbing = null; this.pushT = 0;
    this.gliding = false;
    if (this.glideCircle) { this.glideCircle.end(); this.glideCircle = null; }
    this.mantle = { t: 0, dur, from: this.pos.clone(), to: new THREE.Vector3(x, y, z) };
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(x - this.pos.x, z - this.pos.z);
    G.audio.play('climb_mantle', { pos: this.pos });
  }
  updateMantle(dt) {
    const M = this.mantle;
    M.t += dt;
    const k = Math.min(1, M.t / M.dur);
    // rise first, then roll forward over the lip
    const ky = 1 - (1 - Math.min(1, k * 1.6)) ** 2;
    const kh = Math.max(0, (k - 0.35) / 0.65); const kh2 = kh * kh * (3 - 2 * kh);
    this.pos.set(lerp(M.from.x, M.to.x, kh2), lerp(M.from.y, M.to.y, ky), lerp(M.from.z, M.to.z, kh2));
    if (k >= 1) {
      this.mantle = null;
      this.pos.y = G.world.ground(this.pos.x, this.pos.z, this.pos.y + 0.6);
      this.grounded = true; this.vel.set(0, 0, 0); this.regrabT = 0.25;
      G.audio.play('step', { pos: this.pos, surface: G.world.terrain.surfaceAt(this.pos.x, this.pos.z) });
    }
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

  // ---------------- mana ----------------
  // Mana is a real constraint: slow regen in combat, fast out of combat.
  // Gains in combat come from kill motes, reactions and perfect dodges.
  manaRegenRate(inCombat) {
    if (!inCombat) return 22;
    const flow = 1 + 0.25 * (G.skills ? G.skills.r('a_flow') : 0);
    return (5 + 0.25 * this.level) * flow;
  }
  gainMana(n, o = {}) {
    if (n <= 0 || this.dead) return 0;
    const before = this.mana;
    this.mana = Math.min(this.maxMana, this.mana + n);
    const got = this.mana - before;
    if (got > 0 && G.hud && G.hud.manaGain) G.hud.manaGain(got, o);
    return got;
  }
  refillMana(quiet = false) { this.mana = this.maxMana; if (quiet) this.manaMuteT = G.realTime; }
  // low / full cues (rate-limited, with hysteresis)
  manaWatch() {
    const k = this.mana / this.maxMana;
    if (k < 0.2 && this.manaLowArmed) { this.manaLowArmed = false; if (!this.dead && G.mode === 'free') G.audio.play('mana_low', { gap: 2 }); }
    else if (k > 0.35) this.manaLowArmed = true;
    if (k < 0.6) this.manaFullArmed = true;
    if (k >= 0.999 && this.manaFullArmed) {
      this.manaFullArmed = false;
      if (G.realTime - this.manaFullT > 8 && G.realTime - this.manaMuteT > 1.5 && G.mode === 'free') { this.manaFullT = G.realTime; G.audio.play('mana_full'); if (G.hud.manaFull) G.hud.manaFull(); }
    }
  }
  spend(cost) {
    if (G.slowmo > 0 && cost < 10) return true;
    if (this.mana < cost) { G.hud.manaShort(cost); G.audio.play('mana_empty', { gap: 0.3 }); return false; }
    this.mana -= cost; this.manaDelay = 1.4; return true;
  }
  // technique not learned yet: short, gap-limited feedback
  lockedTech(kind, name) {
    G.hud.cooldownFlash(kind);
    G.audio.play('mana_empty', { gap: 0.3 });
    if (G.realTime - this.lockedMsgT < 2.2) return;
    this.lockedMsgT = G.realTime;
    G.hud.toast(`<b>${name}</b>${josa(name, '은').slice(name.length)} 아직 익히지 못한 기술이다 — <kbd>K</kbd> 울림 나무`, 3200);
  }
  canHeavy(el = this.element) { return !G.skills || G.skills.has(SIG[el]); }
  canWeave() { return !G.skills || G.skills.has(WEAVE_NODE); }

  // Basic spell input: a click fires a bolt (a click during the cooldown is buffered
  // briefly); keeping the button held past a short beat gathers a charged shot that is
  // released with the button once full (CHARGE_T). Releasing early just cancels it.
  // (hold timing runs on wall-clock time so hitstop, slow motion or long frames don't stretch the charge)
  basicInput(input) {
    const now = performance.now() / 1000;
    if (input.mHit(0)) { this.lmbT = now; this.boltBuf = now + 0.2; }
    if (this.boltBuf > now && this.cd.bolt <= 0 && !this.charge) { this.boltBuf = 0; this.castBolt(); }
    if (input.mDown(0)) {
      if (!this.charge && now - this.lmbT > 0.26 && this.boltBuf <= now) this.beginCharge();
      if (this.charge) this.updateCharge();
    } else if (this.charge) this.endCharge(this.charge.ready);
  }
  beginCharge() {
    const el = this.element;
    this.charge = { el, t0: performance.now() / 1000, ready: false, fx: G.vfx.charge(el, () => this.staffTip(), CHARGE_T, { big: 0.85, hold: 60 }) };
    G.audio.play('charge_hold', { pos: this.staffTip() });
  }
  updateCharge() {
    const c = this.charge;
    if (c.el !== this.element) { this.endCharge(false); return; }
    this.castHold = Math.max(this.castHold, 0.35);
    const k = Math.min(1, (performance.now() / 1000 - c.t0) / CHARGE_T);
    if (!c.ready && k >= 1) {
      c.ready = true;
      const tip = this.staffTip();
      G.audio.play('charge_ready', { pos: tip });
      G.vfx.burst(tip, 'star', 1, { el: c.el, size: 2.2, life: 0.16 });
      G.vfx.ring(tip, PAL[c.el].core, 1.1, 0.3, { y: 0, thick: 0.3, up: G.camera.position.clone().sub(tip).normalize() });
    }
    if (G.hud.chargeRing) G.hud.chargeRing(k, c.ready, c.el, this.mana >= CHARGED[c.el].cost);
  }
  endCharge(fire) {
    const c = this.charge;
    this.charge = null;
    if (c.fx) c.fx.end();
    if (G.hud.chargeRing) G.hud.chargeRing(0, false, c.el);
    if (fire && c.el === this.element) this.castCharged();
  }
  castCharged() {
    const el = this.element, def = CHARGED[el];
    if (!this.spend(def.cost)) return;
    this.cd.bolt = Math.max(this.cd.bolt, 0.4);
    this.castHold = 1.0;
    this.rig.flick();
    G.spells.charged(el, this.staffTip(), this.aimPoint(), this.power(), this);
    G.hud.castPulse();
    this.stats.casts++; this.stats.charged = (this.stats.charged || 0) + 1;
    if (G.story) G.story.onCast('charged', el);
    if (G.story && G.story.once && G.story.once('charged1')) G.hud.hint(`<b>모아 쏘기 · ${def.name}</b> — 좌클릭을 누르고 있다가 고리가 차면 뗀다<br><small>모아 쏘기와 고유 마법은 땅에 흔적(불길·서리밭·물웅덩이…)을 남긴다. 흔적에 다른 속성을 더하면 모습이 바뀐다</small>`, 8);
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
    if (!this.canHeavy(el)) { this.lockedTech('heavy', def.name); return; }
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
    if (!this.canWeave()) { this.lockedTech('weave', '두 노래 엮기'); return; }
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
    G.vfx.burst(this.center(), 'star', 1, { el: 'white', size: 3.2 });
    G.vfx.ring(this.pos, PAL.white.core, 7, 0.5, { thick: 0.15, alpha: 0.6 });
    G.renderer.grade.uniforms.uImpact.value = Math.max(G.renderer.grade.uniforms.uImpact.value, 0.45);
    G.hitstop = Math.max(G.hitstop, 0.05);
    if (G.skills) G.skills.charge(12);
    this.gainMana(15, { src: 'dodge' });
    this.invuln = Math.max(this.invuln, 0.5);
    this.stamina = Math.min(this.maxStamina, this.stamina + 20);
    if (G.story && G.story.once('perfect1')) G.hud.hint('<b>완벽 회피</b> — 공격이 닿기 직전 <kbd>Shift</kbd> 순간이동으로 피하면 울림이 가속한다<br><small>잠시 적이 느려지고, 기본 마법의 마나가 들지 않으며, 재사용 대기가 빨라진다</small>', 8);
  }

  // --------------------------------------------------------------
  damage(amount, o = {}) {
    if (this.dead || G.mode !== 'free' || G.state !== 'play' || G.dev.god) return;
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
      this.hp = this.maxHp; this.refillMana(true);
      G.audio.play('levelup');
      if (G.skills) { G.skills.gain(2 * up); G.skills.cross = Math.min(5, (G.skills.cross || 0) + up); }
      const calm = G.mode === 'free' && !G.enemies.inCombat();
      G.hud.banner('LEVEL UP', `울림이 깊어졌다 — Lv ${this.level}`, `마법의 위력이 강해졌다.${this.level % 2 === 0 ? ' 생명력의 그릇이 늘었다.' : ''}<br><b style="color:#f1d48a">울림점 +${2 * up}</b> · <b>울림의 갈림길</b>이 열린다${calm ? '' : ' — 싸움이 끝나면 새 기술을 고를 수 있다'}`, '#f1d48a');
      G.vfx.burst(this.center(), 'soul', 30, { el: 'gold' });
      G.vfx.ring(this.pos, PAL.gold.core, 4, 0.8, { thick: 0.2 });
      G.hud.updateHearts();
    }
    G.hud.updateXP();
  }
}
