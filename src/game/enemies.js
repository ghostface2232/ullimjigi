// Enemies: base AI, core types, bosses, camps, level scaling and drops.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { newStatus } from './combat.js';
import { makeAshling, makeWailer, makeBrute, makeKnight, makeOoze, makeMoth } from './characters.js';
import { fresnelMat, glowMat, toon } from '../render/materials.js';
import { PAL } from '../render/vfx.js';
import { clamp, damp, angleDamp, randRange, rand, pick, wrapAngle, lerp } from '../core/util.js';
import { regionAt } from '../world/layout.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const GRAV = 24;

export const DEF = {
  ashling: { name: '허깨비', hp: 42, dmg: 2, speed: 4.4, radius: 0.5, height: 1.5, xp: 6, aggro: 17, resist: { fire: 1.2 }, make: () => makeAshling('normal') },
  ashlingFrost: { name: '서리 허깨비', hp: 50, dmg: 2, speed: 4.2, radius: 0.5, height: 1.5, xp: 8, aggro: 17, resist: { frost: 0.4, fire: 1.4 }, freezeAt: 5, make: () => makeAshling('frost'), base: 'ashling' },
  wailer: { name: '울음탈', hp: 34, dmg: 2, speed: 3.6, radius: 0.55, height: 1.2, xp: 8, aggro: 24, resist: { storm: 1.3 }, flying: true, make: () => makeWailer() },
  brute: { name: '돌무덤', hp: 170, dmg: 4, speed: 2.6, radius: 1.1, height: 2.9, xp: 22, aggro: 16, armor: 0.5, kbResist: 0.7, make: () => makeBrute('normal') },
  bruteFrost: { name: '서리무덤', hp: 190, dmg: 4, speed: 2.5, radius: 1.1, height: 2.9, xp: 26, aggro: 18, armor: 0.5, kbResist: 0.75, resist: { frost: 0.2, fire: 1.5 }, immune: ['frost'], make: () => makeBrute('frost'), base: 'brute' },
  ooze: { name: '잿물', hp: 30, dmg: 2, speed: 4, radius: 0.62, height: 0.9, xp: 5, aggro: 15, resist: { wind: 1.3 }, make: () => makeOoze('ash'), base: 'ooze', variant: 'ash' },
  oozeFire: { name: '불잿물', hp: 34, dmg: 2, speed: 4, radius: 0.62, height: 0.9, xp: 7, aggro: 15, resist: { fire: 0, frost: 1.6 }, immune: ['fire'], make: () => makeOoze('fire'), base: 'ooze', variant: 'fire' },
  oozeFrost: { name: '서리잿물', hp: 34, dmg: 2, speed: 3.8, radius: 0.62, height: 0.9, xp: 7, aggro: 15, resist: { frost: 0, fire: 1.6 }, immune: ['frost'], make: () => makeOoze('frost'), base: 'ooze', variant: 'frost' },
  moth: { name: '재나방', hp: 14, dmg: 1, speed: 7, radius: 0.4, height: 0.4, xp: 3, aggro: 20, resist: { fire: 2, wind: 1.6 }, flying: true, make: () => makeMoth(), base: 'moth' },
  knight: { name: '무명의 기사', hp: 950, dmg: 4, speed: 4.4, radius: 0.8, height: 2.4, xp: 180, aggro: 30, resist: { storm: 0.5 }, kbResist: 0.92, freezeAt: 8, freezeTime: 1.6, make: () => makeKnight(false), boss: true },
};

// Level tiers: how long a thing has been forgotten
export const TIERS = [
  { pre: '', col: null },
  { pre: '해묵은 ', col: 0xffb050 },
  { pre: '잊힌 ', col: 0xff4a6a },
  { pre: '이름 없는 ', col: 0xeef4ff },
];
export const tierOf = (lv) => (lv >= 10 ? 3 : lv >= 7 ? 2 : lv >= 4 ? 1 : 0);
const EPITHETS = ['새벽을 등진', '녹슨 종의', '울지 않는', '재를 뒤집어쓴', '천 번 잊힌', '빛을 삼킨', '돌아오지 못한'];

export class Enemy {
  constructor(type, pos, level, opts = {}) {
    const def = DEF[type];
    this.type = type; this.def = def; this.base = def.base || type;
    this.level = level; this.elite = !!opts.elite;
    this.tier = def.boss ? 0 : tierOf(level);
    this.name = opts.name || ((this.elite ? pick(EPITHETS) + ' ' : '') + TIERS[this.tier].pre + def.name);
    const hpMul = 1 + 0.18 * (level - 1);
    this.maxHp = Math.round(def.hp * hpMul * (this.elite ? 1.8 : 1) * (opts.hpMul ?? 1));
    this.hp = this.maxHp;
    this.dmgMul = (1 + 0.12 * (level - 1)) * (this.elite ? 1.3 : 1);
    this.radius = def.radius * (this.elite ? 1.15 : 1); this.height = def.height * (this.elite ? 1.15 : 1);
    this.armor = def.armor ?? 0; this.resist = def.resist; this.immune = def.immune;
    this.freezeAt = def.freezeAt ?? (this.base === 'brute' ? 4 : 3); this.freezeTime = def.freezeTime ?? 3;
    this.kbResist = def.kbResist ?? 0;
    this.pos = pos.clone(); this.vel = new THREE.Vector3(); this.yaw = rand() * Math.PI * 2;
    this.home = pos.clone();
    this.st = newStatus();
    this.alive = true; this.hittable = true;
    this.state = opts.state ?? 'idle'; this.stateT = 0;
    this.aggroed = false; this.attackCD = randRange(0.5, 1.5);
    this.flash = 0; this.airborne = false;
    this.camp = opts.camp || null;
    this.wanderT = randRange(1, 4); this.wanderTo = null;
    this.orbit = rand() < 0.5 ? 1 : -1;
    this.poise = 0; this.poiseMax = this.maxHp * (def.boss ? 0.22 : this.base === 'brute' ? 0.5 : 0.35);
    this.rig = def.make();
    this.root = this.rig.root;
    if (this.elite) {
      this.root.scale.setScalar(1.15);
      (this.rig.mats || []).forEach((m) => { if (m.userData.rim) m.userData.rim.value = 1.3; });
    }
    const tcol = this.elite ? 0xffd060 : TIERS[this.tier].col;
    if (tcol !== null) for (const m of this.rig.glowMats || []) m.color.set(tcol).multiplyScalar(2.6);
    if (this.tier >= 3) for (const m of this.rig.mats || []) m.color.multiplyScalar(0.55);
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    G.scene.add(this.root);
    this.dying = 0;
    this.barT = 0;
    this.hasToken = false;
    this.speedMul = 1;
    this.onDeath = opts.onDeath || null;
    this.leash = opts.leash ?? 42;
  }

  center() { return new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z); }
  receive(h) { return G.combat.resolve(this, h); }
  get flying() { return !!this.def.flying && this.st.frozen <= 0; }
  dist2Player() { return Math.hypot(G.player.pos.x - this.pos.x, G.player.pos.z - this.pos.z); }

  setState(s) { this.state = s; this.stateT = 0; }
  aggro() {
    if (this.aggroed || !this.alive) return;
    this.aggroed = true;
    if (this.state === 'idle' || this.state === 'return') this.setState('alert');
    G.hud.alertMark(this);
    G.audio.play(this.base === 'brute' ? 'brute_roar' : this.base === 'wailer' ? 'wailer_wail' : 'enemy_alert', { pos: this.pos, gap: 0.2 });
    // wake neighbors of the same camp
    if (this.camp) for (const e of this.camp.members) if (e !== this && e.alive && !e.aggroed && e.pos.distanceTo(this.pos) < 20) setTimeout(() => e.aggro(), randRange(150, 500));
  }

  onHit(h, dmg, reaction) {
    this.flash = 1;
    this.barT = 6;
    if (!this.aggroed) this.aggro();
    const kb = 1 - this.kbResist;
    if (h.knock && h.dir) {
      this.vel.x += h.dir.x * h.knock * kb; this.vel.z += h.dir.z * h.knock * kb;
    }
    if (h.lift && kb > 0.2 && !this.def.boss) {
      this.vel.y = Math.max(this.vel.y, h.lift * kb);
      if (h.lift * kb > 3) this.airborne = true;
    }
    if (this.poise > this.poiseMax && this.alive) {
      this.poise = 0;
      this.stagger(this.def.boss ? 2.4 : 1.1);
    } else if ((h.heavy || reaction) && this.base === 'ashling' && this.alive && this.state !== 'attack') this.stagger(0.45);
    if (this.hasToken && (this.state === 'windup')) { /* interrupted */ }
    G.audio.play('enemy_hurt', { pos: this.pos, f: this.base === 'brute' ? 380 : this.base === 'wailer' ? 1100 : 720, gap: 0.08 });
  }
  stagger(t) {
    this.releaseToken();
    if (this.armor) this.st.armorBroken = Math.max(this.st.armorBroken, 6);
    this.setState('stagger'); this.staggerT = t;
    if (t > 1.5) { this.vulnerable = true; G.hud.floatText(this.center(), '빈틈!', '#ffd86a'); }
  }
  pull(v) { if (this.kbResist < 0.8) { this.pos.x += v.x; this.pos.z += v.z; } }

  takeToken() {
    const M = G.enemies;
    if (this.hasToken) return true;
    if (M.tokens >= M.maxTokens) return false;
    M.tokens++; this.hasToken = true; return true;
  }
  releaseToken() { if (this.hasToken) { G.enemies.tokens--; this.hasToken = false; } }

  die(h) {
    if (!this.alive) return;
    this.alive = false; this.hittable = false;
    this.releaseToken();
    this.dying = 0.001;
    G.combat.breakIce(this);
    const c = this.center();
    G.audio.play('enemy_die', { pos: c });
    G.vfx.burst(c, 'soul', this.def.boss ? 60 : 16, { el: 'gold' });
    G.vfx.burst(c, 'ash', 16, { spread: this.radius });
    G.vfx.burst(c, 'star', 1, { el: 'gold', size: 3 });
    G.vfx.flash(c, 0xffe0a0, 25, 10, 0.4);
    const xp = Math.round(this.def.xp * (1 + 0.45 * (this.level - 1)) * (this.elite ? 3 : 1));
    G.player.addXP(xp);
    G.hud.floatText(c.clone().setY(c.y + 0.6), `+${xp} XP`, '#f1d48a', 'info');
    G.enemies.drop(c, this);
    if (G.player.lockTarget === this) G.player.lockTarget = null;
    if (this.onDeath) this.onDeath(this);
    if (G.story) G.story.onKill(this);
  }

  // shared movement helper
  moveToward(tx, tz, speed, dt, face = true) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return d;
    const k = Math.min(1, (speed * dt) / d);
    this.pos.x += dx * k; this.pos.z += dz * k;
    if (face) this.yaw = angleDamp(this.yaw, Math.atan2(dx, dz), 8, dt);
    this.curSpeed = speed;
    return d;
  }
  facePlayer(dt, k = 10) {
    const p = G.player.pos;
    this.yaw = angleDamp(this.yaw, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), k, dt);
  }
  playerInArc(range, arcCos = 0.3, from = this.pos) {
    const P = G.player;
    if (P.dead) return false;
    const dx = P.pos.x - from.x, dz = P.pos.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d > range + 0.4 || Math.abs(P.pos.y - this.pos.y) > 2.5) return false;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    return (dx * fx + dz * fz) / (d || 1) > arcCos;
  }
  hurtPlayer(q, knock = 6) {
    const P = G.player;
    const dir = tmp.subVectors(P.pos, this.pos).setY(0).normalize().clone();
    P.damage(Math.max(1, Math.round(q * this.dmgMul)), { dir, knock, pos: this.center() });
  }

  update(dt) {
    if (this.dying > 0) {
      this.dying += dt;
      const k = this.dying;
      if (k < 0.25) { this.flashTo(3); }
      else {
        const s = Math.max(0.001, 1 - (k - 0.25) / 0.6);
        this.root.scale.setScalar(s * (this.elite ? 1.15 : 1));
        this.root.position.y -= dt * 0.5;
        if (rand() < 0.6) G.vfx.burst(this.center(), 'ash', 2, { spread: this.radius * s });
      }
      if (k > 0.9) { this.remove(); return false; }
      return true;
    }
    this.speedMul = G.combat.tick(this, dt);
    const st = this.st;
    const disabled = st.frozen > 0 || st.stun > 0;
    // physics
    const W = G.world;
    const ground = W.ground(this.pos.x, this.pos.z, this.pos.y + 1);
    if (this.flying && !this.airborne) {
      // hover handled by AI
    } else {
      this.vel.y -= GRAV * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= ground) {
        if (this.airborne && this.vel.y < -9) {
          const fall = Math.round(this.maxHp * 0.06 + (-this.vel.y - 9) * 1.5);
          G.combat.hit(this, { dmg: fall, el: 'wind', noReact: true, noStatus: true, source: 'fall', hitstop: 0.03, shake: 0.1 });
          G.vfx.burst(this.pos, 'dust', 10, { speed: 4 });
          G.audio.play('land', { v: 1 });
        }
        this.pos.y = ground; this.vel.y = 0; this.airborne = false;
      }
    }
    // knockback velocity
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    const fr = this.airborne ? 0.8 : 6;
    this.vel.x = damp(this.vel.x, 0, fr, dt); this.vel.z = damp(this.vel.z, 0, fr, dt);
    this.curSpeed = 0;
    if (!disabled && G.mode !== 'cutscene') this.think(dt, this.speedMul);
    else if (disabled) this.releaseToken();
    if (this.state === 'stagger') { this.staggerT -= dt; if (this.staggerT <= 0) { this.vulnerable = false; this.setState(this.aggroed ? 'chase' : 'idle'); } }
    // water: non-flyers avoid deep water
    if (!this.flying && W.h(this.pos.x, this.pos.z) < -0.8) { this.pos.x = damp(this.pos.x, this.home.x, 2, dt); this.pos.z = damp(this.pos.z, this.home.z, 2, dt); }
    // separation
    for (const o of G.enemies.list) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz), m = this.radius + o.radius + 0.2;
      if (d < m && d > 0.001) { const push = (m - d) * 0.5; this.pos.x += (dx / d) * push; this.pos.z += (dz / d) * push; }
    }
    {
      const P = G.player.pos;
      const dx = this.pos.x - P.x, dz = this.pos.z - P.z;
      const d = Math.hypot(dx, dz), m = this.radius + 0.42;
      if (d < m && d > 0.001 && Math.abs(this.pos.y - P.y) < 1.8) { this.pos.x += (dx / d) * (m - d); this.pos.z += (dz / d) * (m - d); }
    }
    W.col.resolve(this.pos, this.radius, this.height);
    this.stateT += dt;
    this.barT = Math.max(0, this.barT - dt);
    this.flash = Math.max(0, this.flash - dt * 7);
    this.animate(dt, disabled);
    return true;
  }

  flashTo(v) {
    for (const m of this.rig.mats || []) m.emissive.setRGB(v, v, v);
  }
  animate(dt, disabled) {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const st = this.st;
    // emissive tint: hit flash > frozen > burning > telegraph
    let r = 0, g = 0, b = 0;
    if (st.frozen > 0) { r = 0.1; g = 0.35; b = 0.6; }
    else if (st.burn > 0) { const p = 0.25 + Math.sin(G.time * 12) * 0.1; r = p; g = p * 0.35; }
    if (this.telegraph) { const p = 0.3 + Math.sin(G.time * 30) * 0.25; r += p; g += p * 0.1; }
    if (this.vulnerable) { const p = 0.2 + Math.sin(G.time * 10) * 0.15; r += p; g += p * 0.8; }
    r += this.flash * 1.4; g += this.flash * 1.4; b += this.flash * 1.4;
    for (const m of this.rig.mats || []) m.emissive.setRGB(r, g, b);
    if (disabled && st.frozen > 0) return;
    const s = this.animState ? this.animState() : { speed: this.curSpeed, grounded: !this.airborne };
    this.rig.update(dt, s);
  }

  remove() {
    G.scene.remove(this.root);
    this.alive = false;
    const i = G.enemies.list.indexOf(this);
    if (i >= 0) G.enemies.list.splice(i, 1);
    if (this.camp) { const j = this.camp.members.indexOf(this); if (j >= 0) this.camp.members.splice(j, 1); }
  }

  // ---- default AI (ashling) ----
  think(dt, mul) {
    const P = G.player;
    const d = this.dist2Player();
    const canSee = !P.dead && G.mode === 'free';
    switch (this.state) {
      case 'idle':
        this.wanderT -= dt;
        if (this.wanderT <= 0) { this.wanderT = randRange(3, 6); this.wanderTo = new THREE.Vector3(this.home.x + randRange(-6, 6), 0, this.home.z + randRange(-6, 6)); }
        if (this.wanderTo) { if (this.moveToward(this.wanderTo.x, this.wanderTo.z, 1.3 * mul, dt) < 0.3) this.wanderTo = null; }
        if (canSee && d < this.def.aggro) this.aggro();
        break;
      case 'alert':
        this.facePlayer(dt, 12);
        if (this.stateT < 0.1) this.vel.y = Math.max(this.vel.y, 3);
        if (this.stateT > 0.55) this.setState('chase');
        break;
      case 'chase': {
        if (!canSee) { if (this.stateT > 2) this.setState('return'); break; }
        if (this.pos.distanceTo(this.home) > this.leash && d > 14) { this.aggroed = false; this.setState('return'); break; }
        this.attackCD -= dt;
        const ang = Math.atan2(this.pos.x - P.pos.x, this.pos.z - P.pos.z) + this.orbit * 0.5 * dt;
        const want = d < 2.1 ? 1.8 : Math.min(d, 2.0);
        const hasT = d < 6 && this.attackCD <= 0 ? this.takeToken() : this.hasToken;
        const ring = hasT ? want : Math.max(want, 4.2);
        const tx = P.pos.x + Math.sin(ang) * ring, tz = P.pos.z + Math.cos(ang) * ring;
        this.moveToward(tx, tz, this.def.speed * mul * (d > 8 ? 1.15 : 0.95), dt, false);
        this.facePlayer(dt);
        if (hasT && d < 2.5 && this.attackCD <= 0) { this.setState('windup'); G.audio.play('enemy_alert', { pos: this.pos, gap: 0.3 }); }
        break;
      }
      case 'windup':
        this.facePlayer(dt, 14);
        this.telegraph = true;
        if (this.stateT > (this.elite ? 0.42 : 0.55)) { this.telegraph = false; this.setState('attack'); this.didHit = false; G.audio.play('enemy_swing', { pos: this.pos }); this.rig.flick && this.rig.flick(); }
        break;
      case 'attack': {
        const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
        const sp = this.stateT < 0.18 ? 9 : 0;
        this.pos.x += fx * sp * dt * mul; this.pos.z += fz * sp * dt * mul;
        if (!this.didHit && this.stateT > 0.1) {
          this.didHit = true;
          if (this.playerInArc(2.3, 0.25)) this.hurtPlayer(this.def.dmg, 6);
          const tip = this.center().add(new THREE.Vector3(fx * 1.2, 0, fz * 1.2));
          G.vfx.burst(tip, 'hush', 4, { size: 0.5 });
        }
        if (this.stateT > 0.25) { this.setState('recover'); }
        break;
      }
      case 'recover':
        if (this.stateT > 0.7) { this.releaseToken(); this.attackCD = randRange(1.2, 2.4); this.setState('chase'); }
        break;
      case 'return': {
        this.releaseToken();
        const dd = this.moveToward(this.home.x, this.home.z, this.def.speed * 1.2, dt);
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * dt * 0.3);
        if (dd < 1) { this.aggroed = false; this.setState('idle'); }
        if (canSee && d < this.def.aggro * 0.6 && this.stateT > 2) { this.aggroed = false; this.aggro(); }
        break;
      }
      case 'stagger': break;
    }
  }
  animState() {
    return { speed: this.curSpeed || 0, grounded: !this.airborne, cast: this.state === 'windup' || this.state === 'attack', aimPitch: -0.3 };
  }
}

// ------------------------------------------------------------------
class Wailer extends Enemy {
  constructor(pos, level, opts) {
    super('wailer', pos, level, opts);
    this.hover = 2.6; this.shootCD = randRange(1.5, 3); this.charge = 0;
    this.pos.y = G.world.ground(pos.x, pos.z) + this.hover;
  }
  think(dt, mul) {
    const P = G.player;
    const W = G.world;
    const gy = W.ground(this.pos.x, this.pos.z, this.pos.y);
    const wantY = Math.max(gy, W.water.level) + this.hover + Math.sin(G.time * 1.3 + this.home.x) * 0.3;
    this.pos.y = damp(this.pos.y, wantY, 3, dt);
    this.vel.y = 0;
    const d = this.dist2Player();
    const canSee = !P.dead && G.mode === 'free';
    switch (this.state) {
      case 'idle':
        this.wanderT -= dt;
        if (this.wanderT <= 0) { this.wanderT = randRange(3, 6); this.wanderTo = new THREE.Vector3(this.home.x + randRange(-8, 8), 0, this.home.z + randRange(-8, 8)); }
        if (this.wanderTo) this.moveToward(this.wanderTo.x, this.wanderTo.z, 1.5 * mul, dt);
        if (canSee && d < this.def.aggro) this.aggro();
        break;
      case 'alert': this.facePlayer(dt); if (this.stateT > 0.6) this.setState('chase'); break;
      case 'chase': {
        if (!canSee) break;
        if (this.pos.distanceTo(this.home) > this.leash + 10 && d > 20) { this.aggroed = false; this.setState('return'); break; }
        const ang = Math.atan2(this.pos.x - P.pos.x, this.pos.z - P.pos.z) + this.orbit * 0.35 * dt;
        const ring = d < 8 ? 13 : d > 16 ? 11 : d;
        this.moveToward(P.pos.x + Math.sin(ang) * ring, P.pos.z + Math.cos(ang) * ring, this.def.speed * mul * (d < 6 ? 1.6 : 1), dt, false);
        this.facePlayer(dt);
        this.shootCD -= dt;
        if (this.shootCD <= 0 && d < 26) { this.setState('charge'); G.audio.play('wailer_charge', { pos: this.pos }); }
        break;
      }
      case 'charge':
        this.facePlayer(dt);
        this.charge = Math.min(1, this.stateT / 0.9);
        this.telegraph = true;
        if (rand() < 0.5) G.vfx.burst(this.center(), 'trail', 1, { el: 'hush', spread: 0.6, size: 0.3 });
        if (this.stateT > 0.9) {
          this.telegraph = false; this.charge = 0;
          const c = this.center();
          const n = this.elite ? 3 : 1;
          for (let i = 0; i < n; i++) {
            const tgt = G.player.center();
            const dir = tgt.sub(c).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (i - (n - 1) / 2) * 0.25);
            G.spells.enemyOrb(c.clone(), dir, { speed: 11, dmg: Math.round(2 * this.dmgMul), homing: n === 1 ? G.player : null, homingRate: 0.9 });
          }
          G.audio.play('wailer_shot', { pos: c });
          this.shootCD = randRange(2.4, 3.6);
          this.setState('chase');
        }
        break;
      case 'return':
        this.moveToward(this.home.x, this.home.z, 4, dt);
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * dt * 0.3);
        if (this.pos.distanceTo(this.home) < 3) { this.aggroed = false; this.setState('idle'); }
        break;
    }
  }
  animState() { return { speed: this.curSpeed || 0, charge: this.charge }; }
  get flying() { return this.st.frozen <= 0 && !this.airborne; }
}

// ------------------------------------------------------------------
class Brute extends Enemy {
  constructor(type, pos, level, opts) {
    super(type, pos, level, opts);
    this.slamCD = 1; this.chargeCD = 4;
  }
  update(dt) {
    if (this.type === 'bruteFrost' && this.st.burn > 0) this.st.armorBroken = Math.max(this.st.armorBroken, 0.6);
    const broken = this.st.armorBroken > 0;
    if (this.rig.armor) this.rig.armor.forEach((a, i) => { a.visible = !broken || i % 3 === 2; });
    if (broken && !this._wasBroken) { G.vfx.burst(this.center(), 'dust', 14, { speed: 6, color: new THREE.Color(0.5, 0.48, 0.45) }); G.audio.play('brute_slam', { pos: this.pos }); G.hud.floatText(this.center(), '갑옷 파괴!', '#ffd86a'); }
    this._wasBroken = broken;
    return super.update(dt);
  }
  think(dt, mul) {
    const P = G.player;
    const d = this.dist2Player();
    const canSee = !P.dead && G.mode === 'free';
    this.slamCD -= dt; this.chargeCD -= dt;
    switch (this.state) {
      case 'idle':
        this.wanderT -= dt;
        if (this.wanderT <= 0) { this.wanderT = randRange(4, 7); this.wanderTo = new THREE.Vector3(this.home.x + randRange(-5, 5), 0, this.home.z + randRange(-5, 5)); }
        if (this.wanderTo && this.moveToward(this.wanderTo.x, this.wanderTo.z, 1.0 * mul, dt) < 0.4) this.wanderTo = null;
        if (canSee && d < this.def.aggro) this.aggro();
        break;
      case 'alert':
        this.facePlayer(dt, 6);
        if (this.stateT > 1.0) this.setState('chase');
        break;
      case 'chase':
        if (!canSee) break;
        if (this.pos.distanceTo(this.home) > this.leash && d > 16) { this.aggroed = false; this.setState('return'); break; }
        this.moveToward(P.pos.x, P.pos.z, this.def.speed * mul, dt);
        if (d < 4.2 && this.slamCD <= 0) {
          this.setState('slamWind');
          const f = tmp.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          this.slamPt = this.pos.clone().addScaledVector(f, 2.4);
          this.slamPt.y = G.world.ground(this.slamPt.x, this.slamPt.z, this.pos.y + 2);
          this.tele = G.vfx.telegraph(this.slamPt, 3.4, this.elite ? 0.85 : 1.05);
          G.audio.play('brute_roar', { pos: this.pos, gap: 0.5 });
        } else if (d > 8 && d < 20 && this.chargeCD <= 0) {
          this.setState('chargeWind');
        }
        break;
      case 'slamWind':
        this.telegraph = true;
        if (this.stateT < 0.4) this.facePlayer(dt, 4);
        if (this.stateT > (this.elite ? 0.85 : 1.05)) {
          this.telegraph = false;
          const p = this.slamPt;
          G.audio.play('brute_slam', { pos: p });
          G.vfx.burst(p, 'dust', 22, { speed: 9, size: 1.2 });
          G.vfx.ring(p, PAL.hush.glow, 4.5, 0.5, { thick: 0.3 });
          G.vfx.burst(p, 'hush', 8);
          const dd = G.player.pos.distanceTo(p);
          if (dd < 3.6) this.hurtPlayer(this.def.dmg, 12);
          G.cameraRig.shake(clamp(0.6 - dd * 0.03, 0.05, 0.6));
          this.slamCD = randRange(2.2, 3.5);
          this.setState('recover');
        }
        break;
      case 'chargeWind':
        this.facePlayer(dt, 8);
        this.telegraph = true;
        if (this.stateT > 0.8) { this.telegraph = false; this.setState('charge'); this.hitDone = false; G.audio.play('brute_roar', { pos: this.pos }); }
        break;
      case 'charge': {
        const f = tmp.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        this.pos.addScaledVector(f, 13 * mul * dt);
        this.curSpeed = 10;
        if (rand() < 0.5) G.vfx.burst(this.pos, 'dust', 1, { speed: 3 });
        if (!this.hitDone && d < this.radius + 1.0) { this.hitDone = true; this.hurtPlayer(this.def.dmg, 14); }
        if (this.stateT > 1.1 || G.world.col.pointHit(this.pos.x + f.x * 1.5, this.pos.y + 1, this.pos.z + f.z * 1.5, 0.5)) { this.chargeCD = randRange(5, 8); this.setState('recover'); G.cameraRig.shake(0.15); }
        break;
      }
      case 'recover':
        if (this.stateT > 1.2) this.setState('chase');
        break;
      case 'return':
        if (this.moveToward(this.home.x, this.home.z, this.def.speed * 1.3, dt) < 1) { this.aggroed = false; this.setState('idle'); }
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * dt * 0.2);
        break;
    }
  }
  animState() {
    const s = { speed: this.curSpeed || 0, grounded: !this.airborne };
    if (this.state === 'slamWind' || this.state === 'alert') s.wave = false, s.cast = true, s.aimPitch = -1.3;
    if (this.state === 'recover' && this.stateT < 0.3) s.cast = true, s.aimPitch = 0.6;
    return s;
  }
}

// ------------------------------------------------------------------
// 잿물 — hopping ooze that splits; elemental variants burst on death
// ------------------------------------------------------------------
class Ooze extends Enemy {
  constructor(type, pos, level, opts = {}) {
    super(type, pos, level, opts);
    this.size = opts.size ?? 1;
    this.variant = this.def.variant;
    if (this.size < 1) {
      this.maxHp = Math.max(6, Math.round(this.maxHp * 0.4)); this.hp = this.maxHp;
      this.radius *= this.size; this.height *= this.size;
      this.root.scale.setScalar(this.size * (this.elite ? 1.15 : 1));
      this.def = { ...this.def, xp: Math.round(this.def.xp * 0.4) };
    }
    this.hopT = randRange(0.3, 1.2); this.hopping = false; this.airT = 0; this.landT = 0;
    this.hopDir = new THREE.Vector3();
  }
  think(dt, mul) {
    const P = G.player;
    const d = this.dist2Player();
    const canSee = !P.dead && G.mode === 'free';
    this.landT = Math.max(0, this.landT - dt);
    if (this.hopping) {
      this.airT += dt;
      this.pos.addScaledVector(this.hopDir, this.hopSpeed * dt * mul);
      if (this.airT > 0.12 && this.vel.y === 0) {
        this.hopping = false; this.landT = 0.2;
        G.vfx.burst(this.pos, 'dust', 3, { speed: 2, size: 0.4 });
        if (this.variant === 'fire') G.vfx.burst(this.pos, 'fire', 4, { speed: 2 });
        if (this.variant === 'frost') G.vfx.burst(this.pos, 'frostmist', 2, { size: 0.6 });
        G.audio.play('land', { v: 0.4 * this.size, gap: 0.05 });
        if (this.aggroed && d < 1.1 + this.radius) this.hurtPlayer(this.def.dmg, 5);
      }
      return;
    }
    this.hopT -= dt * mul;
    const hop = (tx, tz, dist) => {
      const dx = tx - this.pos.x, dz = tz - this.pos.z, l = Math.hypot(dx, dz) || 1;
      this.hopDir.set(dx / l, 0, dz / l).applyAxisAngle(new THREE.Vector3(0, 1, 0), randRange(-0.3, 0.3));
      this.hopSpeed = Math.min(dist, 4.5) / 0.55;
      this.yaw = Math.atan2(dx, dz);
      this.vel.y = 6.2; this.hopping = true; this.airT = 0;
    };
    switch (this.state) {
      case 'idle':
        if (this.hopT <= 0) { this.hopT = randRange(1.5, 3); hop(this.home.x + randRange(-4, 4), this.home.z + randRange(-4, 4), 1.5); }
        if (canSee && d < this.def.aggro) this.aggro();
        break;
      case 'alert': this.facePlayer(dt); if (this.stateT > 0.4) this.setState('chase'); break;
      case 'chase':
        if (!canSee) break;
        if (this.pos.distanceTo(this.home) > this.leash && d > 14) { this.aggroed = false; this.setState('return'); break; }
        if (this.hopT <= 0) { this.hopT = randRange(0.45, 0.9); hop(P.pos.x, P.pos.z, d); }
        break;
      case 'return':
        if (this.hopT <= 0) { this.hopT = 0.5; hop(this.home.x, this.home.z, 4); }
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * dt * 0.3);
        if (this.pos.distanceTo(this.home) < 2) { this.aggroed = false; this.setState('idle'); }
        break;
    }
  }
  animState() { return { squash: this.hopping ? (this.vel.y > 0 ? 0.35 : -0.05) : this.landT > 0 ? -0.45 : this.hopT < 0.15 && this.aggroed ? -0.3 : 0 }; }
  die(h) {
    super.die(h);
    const pos = this.pos.clone();
    const c = this.center();
    G.vfx.burst(c, this.variant === 'fire' ? 'fire' : this.variant === 'frost' ? 'ice' : 'hush', 12, { speed: 4 });
    if (this.size >= 1) {
      for (let i = 0; i < 2; i++) {
        const a = rand() * Math.PI * 2;
        const e = G.enemies.spawn(this.type, pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8)), this.level, { size: 0.55, camp: this.camp, onDeath: this.onDeath });
        if (this.camp) this.camp.members.push(e);
        e.vel.set(Math.cos(a) * 4, 5, Math.sin(a) * 4);
        e.aggro();
      }
    }
    const R = this.size >= 1 ? 3.4 : 2.2;
    if (this.variant === 'fire') {
      G.vfx.telegraph(pos, R, 0.55, 0xff6a2a);
      G.later(() => {
        const ep = pos.clone().setY(pos.y + 0.5);
        G.vfx.burst(ep, 'glow', 1, { el: 'fire', size: R * 1.8, life: 0.25 });
        G.vfx.burst(ep, 'fire', 36, { speed: 7, size: 1.3 }); G.vfx.burst(ep, 'ember', 16, { speed: 8 }); G.vfx.burst(ep, 'smoke', 8, { size: 1.2 });
        G.vfx.ring(pos, PAL.fire.glow, R * 1.2, 0.4, { thick: 0.3 }); G.vfx.scorch(pos, R * 0.8);
        G.vfx.flash(ep, 0xff7a2a, 90, 14, 0.4);
        G.audio.play('explosion', { pos: ep, v: 0.7 });
        G.cameraRig.shake(0.3);
        for (const e of G.enemies.list) if (e.alive && e.hittable && e.center().distanceTo(pos) < R + e.radius) G.combat.hit(e, { dmg: G.player.power() * 1.6, el: 'fire', pos: e.center(), dir: new THREE.Vector3().subVectors(e.pos, pos).setY(0).normalize(), knock: 8, lift: 4, source: 'env' });
        if (G.player.pos.distanceTo(pos) < R) this.hurtPlayer(3, 10);
      }, 550);
    } else if (this.variant === 'frost') {
      G.vfx.ring(pos, PAL.frost.core, R * 1.3, 0.5, { thick: 0.3 });
      G.vfx.burst(c, 'frostmist', 12, { size: 1.2 }); G.vfx.burst(c, 'ice', 20, { speed: 7 });
      G.audio.play('freeze', { pos });
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; G.vfx.crystal(pos.clone().add(new THREE.Vector3(Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2)), 1.2, { life: 1.2, tiltX: Math.sin(a) * 0.5, tiltZ: -Math.cos(a) * 0.5 }); }
      for (const e of G.enemies.list) if (e.alive && e.hittable && !e.boss && e.center().distanceTo(pos) < R + e.radius + 0.6) G.combat.addChill(e, 3);
      if (G.player.pos.distanceTo(pos) < R * 0.8) this.hurtPlayer(1, 4);
    }
  }
}

// ------------------------------------------------------------------
// 재나방 — swarming moths that dive
// ------------------------------------------------------------------
class Moth extends Enemy {
  constructor(pos, level, opts) {
    super('moth', pos, level, opts);
    this.ang = rand() * Math.PI * 2; this.rad = randRange(3, 5.5); this.alt = randRange(1.3, 2.8);
    this.diveCD = randRange(1.5, 4.5);
    this.pos.y = G.world.ground(pos.x, pos.z) + this.alt;
    this.diveDir = new THREE.Vector3();
  }
  get flying() { return this.st.frozen <= 0 && !this.airborne; }
  think(dt, mul) {
    const P = G.player;
    const W = G.world;
    const d = this.dist2Player();
    const canSee = !P.dead && G.mode === 'free';
    const gy = Math.max(W.ground(this.pos.x, this.pos.z, this.pos.y), W.water.level);
    const flyTo = (tx, ty, tz, k) => {
      this.pos.x = damp(this.pos.x, tx, k * mul, dt); this.pos.y = damp(this.pos.y, ty, k * mul, dt); this.pos.z = damp(this.pos.z, tz, k * mul, dt);
      this.yaw = angleDamp(this.yaw, Math.atan2(tx - this.pos.x, tz - this.pos.z), 8, dt);
    };
    this.vel.y = 0;
    this.ang += dt * 1.7 * this.orbit;
    switch (this.state) {
      case 'idle':
        flyTo(this.home.x + Math.cos(this.ang) * 3, gy + this.alt + Math.sin(G.time * 3 + this.rad) * 0.4, this.home.z + Math.sin(this.ang) * 3, 2);
        if (canSee && d < this.def.aggro) this.aggro();
        break;
      case 'alert': if (this.stateT > 0.3) this.setState('chase'); break;
      case 'chase': {
        if (!canSee) break;
        if (this.pos.distanceTo(this.home) > this.leash + 10 && d > 20) { this.aggroed = false; this.setState('return'); break; }
        const pg = W.ground(P.pos.x, P.pos.z, P.pos.y + 1);
        flyTo(P.pos.x + Math.cos(this.ang) * this.rad, Math.max(pg, P.pos.y) + this.alt + Math.sin(G.time * 4 + this.rad) * 0.5, P.pos.z + Math.sin(this.ang) * this.rad, 2.8);
        this.diveCD -= dt;
        if (this.diveCD <= 0 && d < 9) { this.setState('diveWind'); G.audio.play('wailer_charge', { pos: this.pos, gap: 0.4 }); }
        break;
      }
      case 'diveWind':
        this.telegraph = true;
        this.facePlayer(dt, 14);
        if (this.stateT > 0.4) { this.telegraph = false; this.diveDir.copy(P.center()).sub(this.pos).normalize(); this.setState('dive'); this.hitDone = false; G.audio.play('enemy_swing', { pos: this.pos }); }
        break;
      case 'dive':
        this.pos.addScaledVector(this.diveDir, 15 * dt * mul);
        this.pos.y = Math.max(this.pos.y, gy + 0.3);
        if (rand() < 0.6) G.vfx.burst(this.pos, 'ash', 1, { spread: 0.1 });
        if (!this.hitDone && P.center().distanceTo(this.pos) < 0.95) { this.hitDone = true; this.hurtPlayer(this.def.dmg, 3); }
        if (this.stateT > 0.5) { this.diveCD = randRange(2.5, 5); this.setState('chase'); }
        break;
      case 'return':
        flyTo(this.home.x, gy + this.alt, this.home.z, 1.5);
        if (this.pos.distanceTo(this.home) < 4) { this.aggroed = false; this.setState('idle'); }
        break;
    }
  }
  animState() { return { dive: this.state === 'dive' || this.state === 'diveWind' }; }
}

// ------------------------------------------------------------------
// Boss: the Ashen Knight (Kael's forgotten shadow)
// ------------------------------------------------------------------
class Knight extends Enemy {
  constructor(pos, level, opts) {
    super('knight', pos, level, { ...opts, leash: 999 });
    this.boss = true;
    this.phase = 1;
    this.cd = { combo: 0.5, dash: 3, wave: 6, bolts: 8 };
    this.combo = 0;
    this.state = 'dormant';
    this.summoned = false;
  }
  think(dt, mul) {
    const P = G.player;
    const d = this.dist2Player();
    for (const k in this.cd) this.cd[k] -= dt;
    if (this.phase === 1 && this.hp < this.maxHp * 0.5) {
      this.phase = 2;
      if (G.story) G.story.onBossPhase(this, 2);
      G.audio.play('boss_roar', { pos: this.pos });
      G.vfx.ring(this.pos, PAL.storm.core, 10, 0.8, { thick: 0.3 });
    }
    const sword = this.rig.p.swordEdge;
    if (this.slashing && sword) {
      const wp = sword.getWorldPosition(tmp2);
      for (let i = 0; i < 3; i++) G.vfx.burst(wp, 'trail', 1, { el: 'storm', spread: 0.3, size: 0.45, life: 0.25 });
    }
    switch (this.state) {
      case 'dormant': this.hittable = false; break;
      case 'idle': this.hittable = true; this.setState('chase'); break;
      case 'chase': {
        this.hittable = true;
        this.moveToward(P.pos.x, P.pos.z, (d > 10 ? 5.5 : 3.8) * mul, dt);
        if (d < 3.6 && this.cd.combo <= 0) { this.combo = 0; this.setState('slashWind'); }
        else if (d > 6 && d < 16 && this.cd.dash <= 0) this.setState('dashWind');
        else if (this.cd.wave <= 0 && d > 4) this.setState('waveWind');
        else if (this.phase === 2 && this.cd.bolts <= 0) this.setState('boltsWind');
        break;
      }
      case 'slashWind': {
        const wind = [0.5, 0.32, 0.62][this.combo];
        this.facePlayer(dt, 10);
        this.telegraph = this.stateT > wind * 0.4;
        if (this.stateT > wind) {
          this.telegraph = false;
          this.slashing = true;
          G.audio.play('sword', { pos: this.pos });
          const f = tmp.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          this.pos.addScaledVector(f, 1.2);
          if (this.combo < 2) { if (this.playerInArc(3.4, 0.1)) this.hurtPlayer(this.def.dmg, 7); }
          else {
            const p = this.pos.clone().addScaledVector(f, 2.2); p.y = G.world.ground(p.x, p.z, p.y + 3);
            G.vfx.ring(p, PAL.storm.glow, 4, 0.4, { thick: 0.3 }); G.vfx.burst(p, 'electric', 20, { speed: 8 }); G.vfx.burst(p, 'dust', 12, { speed: 6 });
            G.audio.play('impact_storm', { pos: p }); G.cameraRig.shake(0.35);
            if (G.player.pos.distanceTo(p) < 3.6) this.hurtPlayer(this.def.dmg * 1.5, 10);
          }
          this.setState('slash');
        }
        break;
      }
      case 'slash':
        if (this.stateT > 0.22) {
          this.slashing = false;
          this.combo++;
          if (this.combo < 3) this.setState('slashWind');
          else { this.cd.combo = randRange(1.6, 2.6); this.setState('recover'); }
        }
        break;
      case 'dashWind':
        this.facePlayer(dt, 10);
        this.telegraph = true;
        if (this.stateT > 0.6) { this.telegraph = false; this.hitDone = false; this.setState('dash'); G.audio.play('sword', { pos: this.pos }); G.audio.play('blink'); }
        break;
      case 'dash': {
        const f = tmp.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        this.pos.addScaledVector(f, 19 * dt * mul);
        this.slashing = true;
        G.vfx.burst(this.center(), 'trail', 3, { el: 'storm', spread: 0.6, size: 0.6 });
        if (!this.hitDone && d < 1.8) { this.hitDone = true; this.hurtPlayer(this.def.dmg * 1.25, 12); }
        if (this.stateT > 0.42) { this.slashing = false; this.cd.dash = randRange(4, 6); this.setState('recover'); }
        break;
      }
      case 'waveWind':
        this.telegraph = true;
        if (this.stateT < 0.1) { G.vfx.telegraph(this.pos, 3, 0.9, 0xffd84a); G.audio.play('charge', { pos: this.pos }); }
        if (this.stateT > 0.9) {
          this.telegraph = false;
          this.cd.wave = this.phase === 2 ? 6 : 9;
          this.shockwave(this.pos.clone(), 18, 13);
          if (this.phase === 2) G.later(() => this.alive && this.shockwave(this.pos.clone(), 18, 13), 650);
          this.setState('recover');
        }
        break;
      case 'boltsWind':
        this.telegraph = true;
        if (this.stateT < 0.05) {
          this.boltPts = [];
          for (let i = 0; i < 4; i++) {
            const p = G.player.pos.clone().add(new THREE.Vector3(i === 0 ? 0 : randRange(-5, 5), 0, i === 0 ? 0 : randRange(-5, 5)));
            p.y = G.world.ground(p.x, p.z, p.y + 3);
            this.boltPts.push(p); G.vfx.telegraph(p, 2.2, 0.9, 0xffd84a);
          }
          G.audio.play('charge', { pos: this.pos });
        }
        if (this.stateT > 0.9) {
          this.telegraph = false;
          for (const p of this.boltPts) {
            G.vfx.lightning(p.clone().setY(p.y + 28), p, { width: 0.35, dur: 0.3, branches: 2 });
            G.vfx.burst(p, 'electric', 16, { speed: 8 });
            if (G.player.pos.distanceTo(p) < 2.3) this.hurtPlayer(this.def.dmg, 6);
          }
          G.audio.play('thunder', { pos: this.boltPts[0] });
          G.cameraRig.shake(0.3);
          this.cd.bolts = 7;
          this.setState('recover');
        }
        break;
      case 'recover':
        if (this.stateT > (this.phase === 2 ? 0.5 : 0.8)) this.setState('chase');
        break;
      case 'stagger': this.hittable = true; break;
    }
  }
  shockwave(center, maxR, speed) {
    G.audio.play('shockwave', { pos: center });
    G.vfx.burst(center, 'dust', 20, { speed: 8 });
    G.cameraRig.shake(0.3);
    let r = 1, hit = false;
    G.vfx.ring(center, PAL.storm.glow, maxR, maxR / speed, { thick: 0.05, r0: 1 });
    G.vfx.timer(maxR / speed, (dt) => {
      r += speed * dt;
      const P = G.player;
      const dd = Math.hypot(P.pos.x - center.x, P.pos.z - center.z);
      if (!hit && Math.abs(dd - r) < 0.9 && P.pos.y - G.world.ground(P.pos.x, P.pos.z) < 0.6 && P.blinkT <= 0) { hit = true; this.hurtPlayer(this.def.dmg, 8); }
      if (Math.random() < 0.8) { const a = Math.random() * Math.PI * 2; G.vfx.burst(tmp.set(center.x + Math.cos(a) * r, center.y + 0.3, center.z + Math.sin(a) * r), 'electric', 1, { speed: 2 }); }
    });
  }
  animState() {
    const s = { speed: this.curSpeed || 0, grounded: true };
    if (this.state === 'slashWind') { s.cast = true; s.aimPitch = -1.2 + this.stateT; }
    if (this.state === 'slash') { s.cast = true; s.aimPitch = 0.8; }
    if (this.state === 'dashWind' || this.state === 'dash') { s.cast = true; s.aimPitch = 0; }
    if (this.state === 'waveWind') { s.cast = true; s.aimPitch = -1.6; }
    if (this.state === 'dormant' || this.state === 'stagger') s.kneel = true;
    return s;
  }
}

// ------------------------------------------------------------------
// Final boss: The Heart of the Hush — warded plates + exposed core
// ------------------------------------------------------------------
const WARD = {
  fire: { weak: 'frost', color: 0xff6a3a, name: '화염' },
  frost: { weak: 'fire', color: 0x6cd0ff, name: '서리' },
  storm: { weak: 'wind', color: 0xffd84a, name: '번개' },
  wind: { weak: 'storm', color: 0x6effc0, name: '바람' },
};
class Plate {
  constructor(heart, ward, idx, n) {
    this.heart = heart; this.ward = ward; this.idx = idx; this.n = n;
    this.alive = true; this.hittable = true;
    this.radius = 1.3; this.height = 2;
    this.maxHp = Math.round(90 * (1 + 0.18 * (heart.level - 1))); this.hp = this.maxHp;
    this.st = newStatus(); this.level = heart.level; this.name = `${WARD[ward].name}의 결계`;
    this.pos = new THREE.Vector3();
    const g = new THREE.CylinderGeometry(1.2, 1.2, 0.35, 6); g.rotateX(Math.PI / 2);
    this.mesh = new THREE.Mesh(g, fresnelMat(0x222233, WARD[ward].color, { intensity: 1.4, normal: false }));
    const rune = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ map: G.vfx.runeTex2, color: new THREE.Color(WARD[ward].color).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.add(rune);
    G.scene.add(this.mesh);
    this.flash = 0;
    this.barT = 0;
  }
  center() { return this.pos.clone(); }
  receive(h) {
    if (!this.alive) return 0;
    const weak = WARD[this.ward].weak;
    let mult = h.el === weak ? 3 : h.el === 'arcane' ? 0.35 : 0.12;
    let dmg = Math.max(1, Math.round(h.dmg * mult));
    this.hp -= dmg; this.flash = 1; this.barT = 5;
    G.hud.damage(this.pos, dmg, h.el, false, null);
    if (mult < 1) { if (rand() < 0.4) G.hud.floatText(this.pos.clone().setY(this.pos.y + 0.8), `저항 — ${WARD[weak] ? '' : ''}${({ fire: '화염', frost: '서리', storm: '번개', wind: '바람' })[weak]}이 필요하다`, '#c9c0d8', 'info'); G.audio.play('hit_armor', { pos: this.pos }); }
    else { G.audio.play('shatter', { pos: this.pos, gap: 0.1 }); G.vfx.burst(this.pos, 'spark', 12, { el: h.el }); G.hitstop = Math.max(G.hitstop, 0.05); G.cameraRig.shake(0.15); }
    if (this.hp <= 0) this.die();
    return dmg;
  }
  die() {
    this.alive = false; this.hittable = false;
    G.scene.remove(this.mesh);
    G.vfx.burst(this.pos, 'ice', 20, { speed: 9 }); G.vfx.burst(this.pos, 'star', 1, { el: 'white', size: 5 });
    G.vfx.flash(this.pos, WARD[this.ward].color, 80, 14, 0.4);
    G.audio.play('shatter', { pos: this.pos });
    G.hud.floatText(this.pos, '결계 붕괴!', '#ffd86a');
    G.hitstop = Math.max(G.hitstop, 0.1); G.cameraRig.shake(0.4);
    const i = G.enemies.list.indexOf(this); if (i >= 0) G.enemies.list.splice(i, 1);
  }
  update(dt) {
    if (!this.alive) return false;
    const h = this.heart;
    const a = h.spin + (this.idx / this.n) * Math.PI * 2;
    this.pos.set(h.core.position.x + Math.cos(a) * 3.6, h.core.position.y + Math.sin(G.time * 1.5 + this.idx) * 0.4, h.core.position.z + Math.sin(a) * 3.6);
    this.mesh.position.copy(this.pos);
    this.mesh.lookAt(h.core.position);
    this.flash = Math.max(0, this.flash - dt * 5);
    this.mesh.material.uniforms.uIntensity.value = 1.4 + this.flash * 2;
    this.barT = Math.max(0, this.barT - dt);
    return true;
  }
  remove() { G.scene.remove(this.mesh); this.alive = false; }
}

class Heart {
  constructor(center, level) {
    this.boss = true; this.type = 'heart'; this.name = '이름 삼킨 자'; this.def = { xp: 0, name: '이름 삼킨 자', boss: true };
    this.level = level;
    this.center0 = center.clone();
    this.maxHp = Math.round(2000 * (1 + 0.18 * (level - 1))); this.hp = this.maxHp;
    this.alive = true; this.hittable = false; this.radius = 1.9; this.height = 3;
    this.st = newStatus(); this.resist = {}; this.armor = 0; this.freezeAt = 10; this.freezeTime = 1.5;
    this.pos = center.clone().setY(center.y + 6); this.home = this.pos.clone();
    this.core = new THREE.Group();
    const crystal = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), fresnelMat(0x1a0a2a, 0xb080ff, { intensity: 1.6, power: 1.3, normal: true }));
    crystal.material.depthWrite = true;
    this.core.add(crystal);
    const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.6, 3.5) }));
    this.core.add(inner);
    this.tendrils = [];
    for (let i = 0; i < 8; i++) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.25, 4, 5), toon(0x2a2236, { rim: 1, nocache: true }));
      t.userData.a = (i / 8) * Math.PI * 2; this.core.add(t); this.tendrils.push(t);
    }
    this.crystal = crystal; this.inner = inner;
    this.core.position.copy(this.pos);
    G.scene.add(this.core);
    this.plates = [];
    this.spin = 0; this.cycle = 0;
    this.state = 'dormant'; this.stateT = 0;
    this.exposed = 0; this.phase = 1;
    this.atkT = 3; this.flash = 0; this.barT = 0;
    this.beams = [];
    this.addsCD = 10;
  }
  center() { return this.core.position.clone(); }
  receive(h) {
    if (!this.hittable) return 0;
    return G.combat.resolve(this, h);
  }
  onHit(h, dmg) { this.flash = 1; }
  die() {
    this.alive = false; this.hittable = false;
    for (const b of this.beams) b.done = true;
    for (const p of this.plates) p.remove();
    if (G.story) G.story.onKill(this);
  }
  spawnPlates() {
    const pool = ['fire', 'frost', 'storm', 'wind'];
    const n = this.phase === 1 ? 3 : 4;
    const picks = [];
    const unl = [...G.player.unlocked];
    for (let i = 0; i < n; i++) {
      let w = pool[(this.cycle + i) % 4];
      if (!unl.includes(WARD[w].weak)) w = pool.find((x) => unl.includes(WARD[x].weak)) || w;
      picks.push(w);
    }
    this.plates = picks.map((w, i) => new Plate(this, w, i, n));
    for (const p of this.plates) G.enemies.list.push(p);
    this.cycle++;
    G.audio.play('magic_circle', { pos: this.core.position });
  }
  update(dt) {
    if (!this.alive) {
      this.dyingT = (this.dyingT || 0) + dt;
      this.core.scale.setScalar(Math.max(0.01, 1 - this.dyingT / 3));
      this.core.rotation.y += dt * (3 + this.dyingT * 6);
      if (Math.random() < 0.6) G.vfx.burst(this.core.position, 'soul', 3, { el: 'gold' });
      if (this.dyingT > 3) { G.scene.remove(this.core); return false; }
      return true;
    }
    this.stateT += dt;
    this.spin += dt * (0.6 + this.phase * 0.2);
    this.flash = Math.max(0, this.flash - dt * 5);
    this.barT = 5;
    const breathe = 1 + Math.sin(G.time * 2) * 0.05;
    this.crystal.material.uniforms.uIntensity.value = 1.6 + this.flash * 2 + (this.exposed > 0 ? 0.8 + Math.sin(G.time * 10) * 0.4 : 0);
    this.inner.rotation.y += dt * 2; this.inner.rotation.x += dt;
    this.crystal.rotation.y -= dt * 0.4;
    this.tendrils.forEach((t, i) => {
      const a = t.userData.a + this.spin * 0.3;
      t.position.set(Math.cos(a) * 2.2, -1 + Math.sin(G.time * 2 + i) * 0.3, Math.sin(a) * 2.2);
      t.rotation.set(Math.PI + Math.sin(G.time * 1.3 + i) * 0.4, 0, Math.cos(a) * 0.5);
    });
    this.core.scale.setScalar(breathe);
    G.combat.tick(this, dt);
    if (this.state === 'dormant') { this.core.position.y = this.pos.y + Math.sin(G.time) * 0.3; return true; }
    // phase checks
    const frac = this.hp / this.maxHp;
    const want = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
    if (want > this.phase) { this.phase = want; if (G.story) G.story.onBossPhase(this, want); G.audio.play('boss_roar', { pos: this.core.position }); }
    // plates / exposure cycle
    this.plates = this.plates.filter((p) => p.update(dt));
    if (this.exposed > 0) {
      this.exposed -= dt;
      this.hittable = true; this.vulnerable = true;
      this.core.position.y = damp(this.core.position.y, this.center0.y + 2.6, 3, dt);
      if (this.exposed <= 0) { this.hittable = false; this.vulnerable = false; this.spawnPlates(); }
    } else {
      this.core.position.y = damp(this.core.position.y, this.pos.y + Math.sin(G.time) * 0.3, 2, dt);
      this.hittable = false;
      if (this.plates.length === 0) {
        this.exposed = 9;
        G.hud.floatText(this.core.position, '심장이 드러났다!', '#ffd86a');
        G.audio.play('shatter', { pos: this.core.position });
        G.vfx.ring(this.center0, PAL.hush.core, 12, 1, { thick: 0.2 });
        if (G.story) G.story.onHeartExposed();
      }
    }
    // attacks
    this.atkT -= dt; this.addsCD -= dt;
    if (this.atkT <= 0 && this.exposed <= 0) {
      const opts = ['volley', 'wave'];
      if (this.phase >= 2 && this.addsCD <= 0) opts.push('adds');
      if (this.phase >= 3) opts.push('beam', 'beam');
      const a = pick(opts);
      this[a]();
      this.atkT = a === 'beam' ? 6 : (this.phase === 3 ? 2.4 : this.phase === 2 ? 3 : 3.6);
    }
    for (let i = this.beams.length - 1; i >= 0; i--) if (!this.beams[i].tick(dt)) this.beams.splice(i, 1);
    return true;
  }
  volley() {
    const c = this.core.position.clone();
    const n = 6 + this.phase * 2;
    G.audio.play('wailer_charge', { pos: c });
    for (let i = 0; i < n; i++) {
      G.later(() => {
        if (!this.alive) return;
        const toP = G.player.center().sub(c).normalize();
        const a = (i / n) * Math.PI * 2;
        const side = new THREE.Vector3(Math.cos(a), 0.3, Math.sin(a)).multiplyScalar(0.8);
        const dir = toP.clone().add(side).normalize();
        G.spells.enemyOrb(c.clone().addScaledVector(dir, 2), dir, { speed: 9 + this.phase, dmg: Math.round(2 * (1 + 0.12 * (this.level - 1))), homing: G.player, homingRate: 1.1, size: 0.35 });
        G.audio.play('wailer_shot', { pos: c, gap: 0.03 });
      }, i * 90);
    }
  }
  wave() {
    const c = this.center0.clone();
    const n = this.phase >= 2 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      G.later(() => {
        if (!this.alive) return;
        G.vfx.telegraph(c, 4, 0.7, 0xb080ff);
        G.later(() => {
          if (!this.alive) return;
          G.audio.play('shockwave', { pos: c }); G.cameraRig.shake(0.35);
          let r = 2, hit = false;
          const maxR = 34, sp = 12;
          G.vfx.ring(c, PAL.hush.core, maxR, maxR / sp, { thick: 0.04, r0: 2 });
          G.vfx.timer(maxR / sp, (dt) => {
            r += sp * dt;
            const P = G.player;
            const dd = Math.hypot(P.pos.x - c.x, P.pos.z - c.z);
            if (!hit && Math.abs(dd - r) < 1 && P.pos.y - G.world.ground(P.pos.x, P.pos.z) < 0.6 && P.blinkT <= 0) { hit = true; P.damage(Math.round(4 * (1 + 0.12 * (this.level - 1))), { dir: new THREE.Vector3(P.pos.x - c.x, 0, P.pos.z - c.z).normalize(), knock: 8 }); }
            if (Math.random() < 0.9) { const a = Math.random() * Math.PI * 2; G.vfx.burst(tmp.set(c.x + Math.cos(a) * r, c.y + 0.4, c.z + Math.sin(a) * r), 'hush', 1, { size: 0.6, spread: 0.2 }); }
          });
        }, 700);
      }, k * 1300);
    }
  }
  adds() {
    this.addsCD = 16;
    const live = G.enemies.list.filter((e) => e.alive && !e.boss && e.type !== undefined && !(e instanceof Plate)).length;
    if (live > 4) return;
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI * 2;
      const p = this.center0.clone().add(new THREE.Vector3(Math.cos(a) * 14, 0, Math.sin(a) * 14));
      p.y = G.world.ground(p.x, p.z);
      G.vfx.burst(p, 'hush', 12, { size: 1.2 });
      const e = G.enemies.spawn(i === 2 && this.phase >= 3 ? 'wailer' : 'ashling', p, Math.max(1, this.level - 1));
      e.aggro();
    }
  }
  beam() {
    const c = this.center0;
    const n = 2;
    for (let k = 0; k < n; k++) {
      const b = G.vfx.beam('arcane', { width: 0.8 });
      const start = rand() * Math.PI * 2 + k * Math.PI;
      let t = 0; const dur = 5.5, R = 26;
      let warn = G.vfx.telegraph(c, 2, 0.9, 0xb080ff);
      void warn;
      G.audio.play('beam', { pos: c, d: dur });
      this.beams.push({
        tick: (dt) => {
          t += dt;
          const a = start + (t < 0.9 ? 0 : (t - 0.9) * 0.75 * (this.phase >= 3 ? 1.3 : 1));
          const end = new THREE.Vector3(c.x + Math.cos(a) * R, 0, c.z + Math.sin(a) * R);
          end.y = G.world.ground(end.x, end.z, 40) + 0.4;
          const from = this.core.position.clone();
          b.width = t < 0.9 ? 0.12 : 0.9;
          b.set(from, end);
          if (t > 0.9) {
            // damage: distance from player to ground segment center->end
            const P = G.player;
            const ax = c.x, az = c.z, bx = end.x, bz = end.z;
            const dx = bx - ax, dz = bz - az;
            const l2 = dx * dx + dz * dz;
            const tt = clamp(((P.pos.x - ax) * dx + (P.pos.z - az) * dz) / l2, 0, 1);
            const px = ax + dx * tt, pz = az + dz * tt;
            const dd = Math.hypot(P.pos.x - px, P.pos.z - pz);
            const airborne = P.pos.y - G.world.ground(P.pos.x, P.pos.z) > 1.1;
            if (dd < 1.1 && !airborne && tt > 0.08 && P.blinkT <= 0) P.damage(Math.round(3 * (1 + 0.12 * (this.level - 1))), { dir: new THREE.Vector3(-dz, 0, dx).normalize(), knock: 8 });
            if (Math.random() < 0.8) G.vfx.burst(end, 'hush', 1, { size: 0.8 });
            if (Math.random() < 0.8) G.vfx.burst(tmp.set(ax + dx * Math.random(), end.y, az + dz * Math.random()), 'trail', 1, { el: 'arcane', size: 0.6, spread: 0.3 });
          }
          if (t > dur || !this.alive) { b.done = true; return false; }
          return true;
        },
      });
    }
  }
  remove() { G.scene.remove(this.core); for (const p of this.plates) p.remove(); }
}

// ------------------------------------------------------------------
// Camps (spawn groups) and manager
// ------------------------------------------------------------------
export const CAMPS = [
  { id: 'southfield', x: 40, z: 92, units: ['ooze', 'ooze', 'ashling'], gate: 'world' },
  { id: 'eastmeadow', x: 96, z: 34, units: ['moth', 'moth', 'moth', 'moth', 'wailer'], gate: 'world' },
  { id: 'lakewest', x: -112, z: 64, units: ['wailer', 'wailer', 'ooze'], gate: 'world' },
  { id: 'northroad', x: -6, z: -58, units: ['ashling', 'ashling', 'ashling', 'wailer'], gate: 'world' },
  { id: 'frostpass', x: -30, z: -118, units: ['ashlingFrost', 'ashlingFrost', 'oozeFrost'], gate: 'world' },
  { id: 'frostridge', x: -62, z: -128, units: ['ashlingFrost', 'bruteFrost'], gate: 'world' },
  { id: 'westroad', x: -120, z: 4, units: ['ashling', 'oozeFire', 'wailer'], gate: 'world' },
  { id: 'plateau', x: -146, z: -58, units: ['brute', 'ashling', 'moth', 'moth', 'moth'], gate: 'world' },
  { id: 'riftroad', x: 66, z: -48, units: ['ashling', 'ashling', 'ashling', 'oozeFire'], gate: 'world' },
  { id: 'riftgate', x: 98, z: -88, units: ['brute', 'wailer', 'wailer', 'moth', 'moth'], gate: 'world' },
  { id: 'nehills', x: 58, z: -8, units: ['wailer', 'wailer', 'oozeFrost'], gate: 'world' },
  { id: 'woods', x: -84, z: 118, units: ['moth', 'moth', 'moth', 'moth', 'ooze'], gate: 'world' },
  { id: 'eliteWoods', x: -118, z: 150, units: ['brute'], names: ['뿌리 삼킨 돌무덤'], elite: true, gate: 'bounty', bounty: 1 },
  { id: 'eliteBluffs', x: 156, z: 30, units: ['wailer', 'wailer', 'wailer'], names: ['세 자매 울음탈 · 첫째', '세 자매 울음탈 · 둘째', '세 자매 울음탈 · 막내'], elite: true, gate: 'bounty', bounty: 2 },
  { id: 'eliteNorth', x: 40, z: -150, units: ['bruteFrost', 'ashlingFrost'], names: ['눈먼 파수꾼', null], elite: true, gate: 'bounty', bounty: 3 },
];

export class EnemyManager {
  constructor() {
    this.list = [];
    this.bosses = [];
    this.tokens = 0; this.maxTokens = 2;
    this.pickups = [];
    this.camps = CAMPS.map((c) => ({ ...c, members: [], spawned: false, cleared: false }));
    this.checkT = 0;
  }

  levelFor(offset = 0) {
    const base = (G.story ? G.story.progressLevel() : 1) + offset;
    const pl = G.player ? G.player.level : 1;
    return Math.max(1, Math.round(base + (pl - base) * 0.35));
  }

  spawn(type, pos, level, opts = {}) {
    let e;
    if (type === 'wailer') e = new Wailer(pos, level, opts);
    else if (type === 'brute' || type === 'bruteFrost') e = new Brute(type, pos, level, opts);
    else if (type === 'knight') e = new Knight(pos, level, opts);
    else if (type === 'moth') e = new Moth(pos, level, opts);
    else if (DEF[type].base === 'ooze') e = new Ooze(type, pos, level, opts);
    else e = new Enemy(type, pos, level, opts);
    e.pos.y = type === 'wailer' || type === 'moth' ? e.pos.y : G.world.ground(pos.x, pos.z);
    this.list.push(e);
    return e;
  }
  spawnHeart(center, level) {
    const h = new Heart(center, level);
    this.list.push(h);
    this.bosses.push(h);
    return h;
  }

  inCombat() {
    for (const e of this.list) if (e.alive && e.aggroed && e.state !== 'return' && e.state !== 'idle') return true;
    return !!G.bossActive;
  }

  campAllowed(c) {
    if (!G.story) return false;
    if (c.gate === 'world') return G.story.flag('worldOpen');
    if (c.gate === 'bounty') return G.story.flag('bountyActive') && !G.story.flag('bounty' + c.bounty);
    return false;
  }

  resetCamps() {
    for (const c of this.camps) {
      if (c.members.some((m) => m.aggroed)) continue;
      for (const m of c.members) m.remove();
      c.members = []; c.spawned = false; c.cleared = false;
    }
  }

  updateCamps() {
    const P = G.player.pos;
    for (const c of this.camps) {
      const d = Math.hypot(P.x - c.x, P.z - c.z);
      if (!c.spawned && !c.cleared && d < 80 && d > 30 && this.campAllowed(c)) {
        c.spawned = true;
        const reg = regionAt(c.x, c.z);
        const lv = this.levelFor((reg.lv || 0) + (c.elite ? 2 : 0));
        c.units.forEach((u, i) => {
          const a = (i / c.units.length) * Math.PI * 2;
          const p = new THREE.Vector3(c.x + Math.cos(a) * 3, 0, c.z + Math.sin(a) * 3);
          const e = this.spawn(u, p, lv, { camp: c, elite: c.elite && (i === 0 || c.units.length <= 3), name: c.names ? c.names[i] || undefined : undefined, onDeath: () => this.checkCamp(c) });
          c.members.push(e);
        });
      } else if (c.spawned && d > 130 && !c.members.some((m) => m.aggroed)) {
        for (const m of [...c.members]) m.remove();
        c.members = []; c.spawned = false;
      }
    }
  }
  checkCamp(c) {
    setTimeout(() => {
      if (c.members.every((m) => !m.alive)) {
        c.cleared = true;
        if (c.bounty && G.story) G.story.onBounty(c.bounty);
      }
    }, 100);
  }

  clearAll(keepBoss = false) {
    for (const e of [...this.list]) { if (keepBoss && e.boss) continue; e.remove ? e.remove() : null; }
    this.list = this.list.filter((e) => keepBoss && e.boss);
    this.tokens = 0;
    for (const c of this.camps) { c.members = []; c.spawned = false; }
  }

  drop(pos, e) {
    const n = e.base === 'brute' ? 4 : 2;
    for (let i = 0; i < n; i++) this.pickups.push(this.makePickup(pos, 'mana'));
    if (rand() < (e.elite ? 0.8 : 0.25)) this.pickups.push(this.makePickup(pos, 'heal'));
  }
  makePickup(pos, kind) {
    const m = new THREE.Mesh(G.vfx.orbGeo, glowMat(kind === 'heal' ? 0x7aff8a : 0x6cc6ff, 2.2));
    m.scale.setScalar(kind === 'heal' ? 0.2 : 0.1);
    m.position.copy(pos);
    G.scene.add(m);
    const v = new THREE.Vector3(randRange(-3, 3), randRange(3, 6), randRange(-3, 3));
    return { m, kind, v, t: 0 };
  }

  update(dt) {
    this.checkT -= dt;
    if (this.checkT <= 0) { this.checkT = 0.5; this.updateCamps(); }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e instanceof Plate) continue;
      const alive = e.update(dt);
      if (alive === false && this.list[i] === e) this.list.splice(i, 1);
    }
    this.tokens = Math.max(0, this.tokens);
    // pickups
    const P = G.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      const pc = P.center();
      const d = p.m.position.distanceTo(pc);
      if (p.t > 0.5 && d < 7) {
        p.v.lerp(pc.sub(p.m.position).normalize().multiplyScalar(14), Math.min(1, dt * 6));
      } else {
        p.v.y -= 12 * dt;
        const gy = G.world.ground(p.m.position.x, p.m.position.z, p.m.position.y) + 0.4;
        if (p.m.position.y < gy) { p.m.position.y = gy; p.v.set(p.v.x * 0.5, Math.abs(p.v.y) * 0.3, p.v.z * 0.5); }
        p.v.x *= 1 - dt * 2; p.v.z *= 1 - dt * 2;
      }
      p.m.position.addScaledVector(p.v, dt);
      if (Math.random() < dt * 10) G.vfx.burst(p.m.position, 'trail', 1, { el: p.kind === 'heal' ? 'heal' : 'frost', size: 0.2 });
      if ((p.t > 0.5 && d < 0.9) || p.t > 20) {
        if (p.t <= 20) {
          if (p.kind === 'heal') { P.heal(2); G.audio.play('heal'); G.hud.floatText(pc, '+♥', '#8fff9a', 'heal'); }
          else { P.mana = Math.min(P.maxMana, P.mana + 7); G.audio.play('pickup', { gap: 0.05 }); }
        }
        G.scene.remove(p.m);
        this.pickups.splice(i, 1);
      }
    }
  }
}
