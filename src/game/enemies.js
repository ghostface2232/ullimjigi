// Enemies: base AI, core types, bosses, camps, level scaling and drops.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { newStatus } from './combat.js';
import { makeAshling, makeWailer, makeBrute, makeKnight, makeOoze, makeMoth, makeShieldBearer, makeArcher, makeRootHand, makeWatcher } from './characters.js';
import { fresnelMat, glowMat, toon } from '../render/materials.js';
import { PAL } from '../render/vfx.js';
import { crystalMaterial, crystalGeometry, crystalGlowSprite } from '../render/crystal.js';
import { clamp, damp, angleDamp, randRange, rand, pick, wrapAngle, lerp, josa } from '../core/util.js';
import { regionAt } from '../world/layout.js';

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const GRAV = 24;
const HUSH_EDGE = new THREE.Color(0.8, 0.45, 1.6);

// Resist multipliers: <1 resists, >1 weak. `water` is the 6th element.
// Flags: panic (burning panic), knockdown (big hits knock it over), dodge (0..1 chance to sidestep projectiles),
// frozenFall (fraction of max HP taken when a frozen flyer hits the ground).
export const DEF = {
  ashling: { name: '허깨비', hp: 42, dmg: 2, speed: 4.4, radius: 0.5, height: 1.5, xp: 6, aggro: 17, resist: { fire: 1.2 }, panic: true, knockdown: true, dodge: 0.22, make: () => makeAshling('normal') },
  ashlingFrost: { name: '서리 허깨비', hp: 50, dmg: 2, speed: 4.2, radius: 0.5, height: 1.5, xp: 8, aggro: 17, resist: { frost: 0.4, fire: 1.4 }, freezeAt: 5, panic: true, knockdown: true, dodge: 0.22, make: () => makeAshling('frost'), base: 'ashling' },
  wailer: { name: '울음탈', hp: 34, dmg: 2, speed: 3.6, radius: 0.55, height: 1.2, xp: 8, aggro: 24, resist: { storm: 1.3 }, flying: true, dodge: 0.3, frozenFall: 0.4, make: () => makeWailer() },
  brute: { name: '돌무덤', hp: 170, dmg: 4, speed: 2.6, radius: 1.1, height: 2.9, xp: 22, aggro: 16, armor: 0.5, kbResist: 0.7, resist: { water: 0.9 }, make: () => makeBrute('normal') },
  bruteFrost: { name: '서리무덤', hp: 190, dmg: 4, speed: 2.5, radius: 1.1, height: 2.9, xp: 26, aggro: 18, armor: 0.5, kbResist: 0.75, resist: { frost: 0.2, fire: 1.5, water: 0.8 }, immune: ['frost'], make: () => makeBrute('frost'), base: 'brute' },
  ooze: { name: '잿물', hp: 30, dmg: 2, speed: 4, radius: 0.62, height: 0.9, xp: 5, aggro: 15, resist: { wind: 1.3 }, make: () => makeOoze('ash'), base: 'ooze', variant: 'ash', deathStyle: 'flatten' },
  oozeFire: { name: '불잿물', hp: 34, dmg: 2, speed: 4, radius: 0.62, height: 0.9, xp: 7, aggro: 15, resist: { fire: 0, frost: 1.6, water: 2.0 }, immune: ['fire'], make: () => makeOoze('fire'), base: 'ooze', variant: 'fire', deathStyle: 'flatten', edge: new THREE.Color(2.2, 0.8, 0.2) },
  oozeFrost: { name: '서리잿물', hp: 34, dmg: 2, speed: 3.8, radius: 0.62, height: 0.9, xp: 7, aggro: 15, resist: { frost: 0, fire: 1.6, water: 0.8 }, immune: ['frost'], make: () => makeOoze('frost'), base: 'ooze', variant: 'frost', deathStyle: 'flatten', edge: new THREE.Color(0.6, 1.6, 2.4) },
  oozeWater: { name: '물잿물', hp: 34, dmg: 2, speed: 4, radius: 0.62, height: 0.9, xp: 7, aggro: 15, resist: { water: 0, storm: 1.6, fire: 0.7 }, immune: ['water'], make: () => makeOoze('water'), base: 'ooze', variant: 'water', deathStyle: 'flatten', edge: new THREE.Color(0.4, 1.2, 2.6) },
  moth: { name: '재나방', hp: 14, dmg: 1, speed: 7, radius: 0.4, height: 0.4, xp: 3, aggro: 20, resist: { fire: 2, wind: 1.6, water: 1.3 }, flying: true, frozenFall: 1.2, make: () => makeMoth(), base: 'moth' },
  shield: { name: '방패지기', hp: 90, dmg: 3, speed: 3.2, radius: 0.62, height: 2.0, xp: 16, aggro: 16, resist: { storm: 1.3, wind: 1.2 }, kbResist: 0.5, panic: false, make: () => makeShieldBearer() },
  archer: { name: '메아리 사수', hp: 30, dmg: 3, speed: 4.2, radius: 0.45, height: 1.75, xp: 10, aggro: 30, resist: { storm: 1.4, wind: 1.4 }, panic: true, knockdown: true, dodge: 0.45, make: () => makeArcher() },
  rootHand: { name: '뿌리손', hp: 70, dmg: 3, speed: 6, radius: 0.75, height: 2.2, xp: 14, aggro: 18, resist: { fire: 1.6, frost: 0.8, wind: 0.6, water: 0.6 }, kbResist: 0.95, freezeAt: 4, make: () => makeRootHand(), deathStyle: 'sink' },
  watcher: { name: '망루지기', hp: 260, dmg: 4, speed: 2.2, radius: 1.4, height: 3.9, xp: 60, aggro: 26, armor: 0.35, kbResist: 0.95, freezeAt: 8, freezeTime: 2, resist: { storm: 0.7, fire: 0.8, frost: 1.2, water: 1.3, wind: 0.6 }, make: () => makeWatcher(), deathStyle: 'sink', bigDeath: true },
  knight: { name: '무명의 기사', hp: 900, dmg: 3, speed: 4.4, radius: 0.8, height: 2.4, xp: 180, aggro: 30, resist: { storm: 0.5, water: 0.9 }, kbResist: 0.92, freezeAt: 8, freezeTime: 1.6, make: () => makeKnight(false), boss: true, deathStyle: 'kneel' },
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

// Uses Combat's own (side-effect free) reaction picker so shields know whether a
// hit is going to erupt into an elemental reaction.
function predictsReaction(t, h) {
  return !!G.combat.pickReaction(t.st, h.el || 'arcane', h);
}

const easeIn = (k) => k * k;
const smooth = (k) => k * k * (3 - 2 * k);

// Boss break meter (무너짐). Damage fills it a little, strong magic more, an elemental
// reaction most. Full → the boss collapses for `down` seconds and takes ×1.75 (instead of
// the usual ×1.5 opening). It drains after `hold` seconds without a hit and is locked for
// `lock` seconds after a collapse, so it rewards pressure and mixing elements over chip damage.
export const BREAK = { max: 100, perHp: 100, heavy: 5, reaction: 8, hold: 2.5, drain: 14, down: 4.5, lock: 5 };
const newBreak = (drain = BREAK.drain) => ({ v: 0, lastT: -99, down: 0, lock: 0, n: 0, drain });
// adds `amt`; true when this fills the meter (the caller starts the collapse)
function addBreak(t, amt) {
  const b = t.brk;
  if (!b || !t.alive || b.down > 0 || b.lock > 0 || !(amt > 0)) return false;
  b.v += amt; b.lastT = G.time;
  if (b.v < BREAK.max) return false;
  b.v = BREAK.max; b.down = BREAK.down; b.n++;
  return true;
}
function breakFromHit(t, h, dmg, reaction) {
  if (h.source === 'enemy' || h.source === 'dot' || h.source === 'fall') return false;
  return addBreak(t, (dmg / t.maxHp) * BREAK.perHp + (h.heavy ? BREAK.heavy : 0) + (reaction && reaction !== 'airborne' ? BREAK.reaction : 0));
}
function tickBreak(t, dt) {
  const b = t.brk;
  if (b.down > 0) {
    b.down -= dt;
    b.v = BREAK.max * Math.max(0, b.down) / BREAK.down;
    if (b.down <= 0) { b.v = 0; b.lock = BREAK.lock; }
  } else if (b.lock > 0) b.lock -= dt;
  else if (G.time - b.lastT > BREAK.hold) b.v = Math.max(0, b.v - b.drain * dt);
}
function collapseFx(t, pos) {
  G.hud.floatText(pos.clone().setY(pos.y + 1), '무너졌다!', '#ffd86a');
  G.audio.play('shatter', { pos }); G.audio.play('boss_roar', { pos, v: 0.5 });
  G.vfx.burst(pos, 'star', 1, { el: 'gold', size: 5, life: 0.4 });
  G.vfx.burst(pos, 'spark', 26, { el: 'gold', speed: 9 });
  G.combat.stop(0.14, true); G.cameraRig.shake(0.45);
  if (G.enemies) G.enemies.bossSpill(pos, 'break');
  if (G.story && G.story.onBossBreak) G.story.onBossBreak(t);
}

// Boss HP phases: each threshold (fraction of max HP) raises the phase by one; bosses read
// `this.phase` to change their pattern, and hits scale by PHASE_DMG[phase − 1].
const PHASE_DMG = [1, 1.2, 1.4];
function phaseCheck(t, at) {
  const frac = t.hp / t.maxHp;
  let want = 1;
  for (const a of at) if (frac <= a) want++;
  if (want <= t.phase) return false;
  t.phase = want; t.phaseMul = PHASE_DMG[want - 1] ?? PHASE_DMG[PHASE_DMG.length - 1];
  if (G.enemies) G.enemies.bossSpill(t.center(), 'phase');
  return true;
}

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
    this.orbit = rand() < 0.5 ? 1 : -1; this.orbitT = randRange(2, 5);
    this.poise = 0; this.poiseMax = this.maxHp * (def.boss ? 0.22 : this.base === 'brute' ? 0.5 : 0.35);
    // bosses (and story bosses built from ordinary types) use the break meter instead of poise
    this.brk = def.boss || opts.brk ? newBreak() : null;
    this.phase = 1; this.phaseMul = 1;
    this.atkGen = 0;
    this.rig = def.make();
    this.root = this.rig.root;
    this.root.rotation.order = 'YXZ';
    if (this.elite) {
      this.root.scale.setScalar(1.15);
      (this.rig.mats || []).forEach((m) => { if (m.userData.rim) m.userData.rim.value = 1.3; });
    }
    const tcol = this.elite ? 0xffd060 : TIERS[this.tier].col;
    if (tcol !== null) for (const m of this.rig.glowMats || []) m.color.set(tcol).multiplyScalar(2.6);
    if (this.tier >= 3) for (const m of this.rig.mats || []) m.color.multiplyScalar(0.55);
    this.root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) o.castShadow = true; });
    G.scene.add(this.root);
    this.dying = 0;
    this.barT = 0;
    this.hasToken = false;
    this.speedMul = 1;
    this.onDeath = opts.onDeath || null;
    this.leash = opts.leash ?? 42;
    // reactions & feel
    this.tilt = { x: 0, z: 0, vx: 0, vz: 0 };
    this.hitDir = new THREE.Vector3(0, 0, -1);
    this.lieW = 0; this.lieX = 0; this.lieZ = 0; this.downT = 0;
    this.glintFlash = 0;
    this.dodgeCD = randRange(0.6, 1.6);
    this.dodgeSkill = def.dodge ? Math.min(0.8, def.dodge + (this.elite ? 0.2 : 0) + this.tier * 0.05) : 0;
    this.burnRolled = false; this.panicT = 0; this.panicCD = 0;
    this.deathStyle = def.deathStyle || (def.flying ? 'fall' : 'topple');
    this.bigDeath = !!(def.boss || def.bigDeath || this.elite || this.base === 'brute');
    this.ghost = false; // burrowed: no pushing, not targetable
  }

  center() { return new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z); }
  receive(h) { return G.combat.resolve(this, h); }
  get flying() { return !!this.def.flying && this.st.frozen <= 0; }
  dist2Player() { return Math.hypot(G.player.pos.x - this.pos.x, G.player.pos.z - this.pos.z); }
  fwd(out = tmp) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  setState(s) { this.state = s; this.stateT = 0; this.glinted = false; this.telegraph = false; }
  aggro() {
    if (this.aggroed || !this.alive) return;
    this.aggroed = true;
    if (this.state === 'idle' || this.state === 'return') this.setState('alert');
    G.hud.alertMark(this);
    G.audio.play(this.base === 'brute' ? 'brute_roar' : this.base === 'wailer' ? 'wailer_wail' : 'enemy_alert', { pos: this.pos, gap: 0.2 });
    // wake neighbors of the same camp
    if (this.camp) for (const e of this.camp.members) if (e !== this && e.alive && !e.aggroed && e.pos.distanceTo(this.pos) < 20) G.later(() => e.aggro(), randRange(150, 500));
  }

  // world-space XZ push direction of a hit (from attacker toward this enemy)
  pushDir(h, out = tmp3) {
    if (h.dir && Math.hypot(h.dir.x, h.dir.z) > 0.2) out.set(h.dir.x, 0, h.dir.z);
    else if (h.pos) out.set(this.pos.x - h.pos.x, 0, this.pos.z - h.pos.z);
    else out.set(0, 0, 0);
    if (out.lengthSq() < 0.01) out.set(this.pos.x - G.player.pos.x, 0, this.pos.z - G.player.pos.z);
    if (out.lengthSq() < 1e-4) out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    return out.normalize();
  }
  // local frame components of a world XZ direction: lz along facing, lx along right
  local(d) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    return { lz: d.x * fx + d.z * fz, lx: d.x * fz - d.z * fx };
  }
  flinch(dir, amt) {
    const { lz, lx } = this.local(dir);
    this.tilt.vx += lz * amt * 14;
    this.tilt.vz += -lx * amt * 14;
    if (amt > 0.12 && this.rig.hurt) this.rig.hurt();
  }
  knockDown(dir) {
    if (!this.alive || this.flying || this.state === 'down' || this.state === 'getup') return;
    this.releaseToken();
    const { lz, lx } = this.local(dir);
    const l = Math.hypot(lz, lx) || 1;
    this.lieX = (lz / l) * 1.45; this.lieZ = (-lx / l) * 1.45;
    this.downT = randRange(1.1, 1.6) * (this.elite ? 0.7 : 1);
    this.telegraph = false;
    this.setState('down');
    G.later(() => { if (this.alive) { G.audio.play('body_fall', { pos: this.pos, v: 0.6, gap: 0.05 }); G.vfx.burst(this.pos, 'dust', 6, { speed: 3, size: 0.7 }); } }, 220);
  }
  updateDown(dt) {
    if (this.state === 'down') { if (this.stateT > this.downT) this.setState('getup'); }
    else if (this.stateT > 0.55) this.setState(this.aggroed ? 'chase' : 'idle');
  }

  onHit(h, dmg, reaction) {
    this.flash = h.blocked ? 0.2 : 1;
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
    const dir = this.pushDir(h);
    this.hitDir.copy(dir);
    if (h.source !== 'dot' && this.alive) {
      const amt = clamp(0.08 + (dmg / this.maxHp) * 1.5, 0.08, 0.5) * (h.heavy || reaction ? 1.5 : 1) * (1 - this.kbResist * 0.75) * (h.blocked ? 0.3 : 1);
      this.flinch(dir, amt);
    }
    if (this.brk) {
      if (breakFromHit(this, h, dmg, reaction)) { this.poise = 0; this.stagger(BREAK.down, true); collapseFx(this, this.center()); }
    } else if (this.poise > this.poiseMax && this.alive) {
      this.poise = 0;
      this.stagger(this.def.boss ? 2.4 : 1.1);
    } else if ((h.heavy || reaction) && this.base === 'ashling' && this.alive && this.state !== 'attack') this.stagger(0.45);
    // big hits knock light enemies off their feet
    if (this.def.knockdown && this.alive && !h.blocked) {
      const big = reaction === 'overload' || reaction === 'shatter' || reaction === 'thermal' || reaction === 'airborne' ||
        (h.heavy && ((h.knock ?? 0) >= 7 || (h.lift ?? 0) >= 3)) || dmg >= this.maxHp * 0.45;
      if (big && !this.airborne) this.knockDown(dir);
    }
    G.audio.play('enemy_hurt', { pos: this.pos, f: this.base === 'brute' ? 380 : this.base === 'wailer' ? 1100 : 720, gap: 0.08 });
  }
  // A delayed follow-up attack (second ring, next volley). It is dropped if the enemy was
  // staggered or collapsed (break meter), frozen or killed in the meantime.
  followUp(fn, ms) {
    const gen = this.atkGen;
    G.later(() => { if (this.alive && gen === this.atkGen && this.st.frozen <= 0) fn(); }, ms);
  }
  stagger(t, quiet = false) {
    this.releaseToken();
    this.atkGen++; // cancels queued follow-ups
    this.telegraph = false; this.slashing = false;
    if (this.state === 'down') { this.downT = Math.max(this.downT, this.stateT + t); return; }
    if (this.armor) this.st.armorBroken = Math.max(this.st.armorBroken, 6);
    this.setState('stagger'); this.staggerT = t;
    if (t > 1.5) { this.vulnerable = true; if (!quiet) G.hud.floatText(this.center(), '빈틈!', '#ffd86a'); }
  }
  pull(v) { if (this.kbResist < 0.8) { this.pos.x += v.x; this.pos.z += v.z; } }

  takeToken() {
    const M = G.enemies;
    if (this.hasToken) return true;
    if (M.tokens >= M.maxTokens) return false;
    M.tokens++; this.hasToken = true; return true;
  }
  releaseToken() { if (this.hasToken) { G.enemies.tokens--; this.hasToken = false; } }

  // BotW-like glint: a bright star flash on the enemy right before a dangerous attack lands
  glint(p, big = false) {
    const pt = p ? p.clone() : this.center().setY(this.pos.y + this.height * 0.85);
    G.vfx.burst(pt, 'star', 1, { el: 'white', size: big ? 3.6 : 2.6, life: 0.34 });
    G.vfx.burst(pt, 'glow', 1, { el: 'gold', size: big ? 1.8 : 1.2, life: 0.22 });
    G.audio.play('enemy_glint', { pos: pt, gap: 0.05 });
    this.glintFlash = 1;
    this.glinted = true;
    // exposed for perfect-dodge / parry timing elsewhere
    G.enemies.lastGlint = { t: G.time, e: this, pos: pt };
  }
  // fire the glint once when stateT crosses `at`
  glintAt(at, p, big) { if (!this.glinted && this.stateT >= at) this.glint(p, big); }

  // player projectile that will pass through us soon (time-to-closest-approach window)
  incomingThreat() {
    const c = this.center();
    for (const p of G.spells.list) {
      if (p.owner === 'enemy') continue;
      const vx = p.vel.x, vy = p.vel.y, vz = p.vel.z;
      const v2 = vx * vx + vy * vy + vz * vz;
      if (v2 < 9) continue;
      const rx = c.x - p.pos.x, ry = c.y - p.pos.y, rz = c.z - p.pos.z;
      const t = (rx * vx + ry * vy + rz * vz) / v2;
      if (t < 0.16 || t > 0.6) continue;
      const cx = rx - vx * t, cy = ry - vy * t, cz = rz - vz * t;
      const rr = this.radius + p.r + 0.35;
      if (cx * cx + cy * cy + cz * cz < rr * rr) return p;
    }
    return null;
  }
  tryDodge(dt) {
    this.dodgeCD -= dt;
    if (this.dodgeCD > 0 || this.airborne || this.dodgeSkill <= 0) return false;
    if (this.state !== 'chase' && this.state !== 'recover' && this.state !== 'alert') return false;
    const p = this.incomingThreat();
    if (!p) {
      // the player is aiming a heavy spell right at us: sometimes sidestep out of the line
      const P = G.player;
      if (P.aimZoom && rand() < dt * 0.8 * this.dodgeSkill) {
        const cy = G.cameraRig.yaw, fx = -Math.sin(cy), fz = -Math.cos(cy);
        const dx = this.pos.x - P.pos.x, dz = this.pos.z - P.pos.z, d = Math.hypot(dx, dz);
        if (d < 16 && (dx * fx + dz * fz) / (d || 1) > 0.985) {
          const side = tmp2.set(-fz, 0, fx);
          if (rand() < 0.5) side.negate();
          this.dodge(side, 10);
          return true;
        }
      }
      return false;
    }
    this.dodgeCD = 1.1;
    if (rand() > this.dodgeSkill) return false;
    const side = tmp2.set(-p.vel.z, 0, p.vel.x).normalize();
    if (side.x * (this.pos.x - p.pos.x) + side.z * (this.pos.z - p.pos.z) < 0) side.negate();
    this.dodge(side, 11);
    return true;
  }
  dodge(dir, speed = 11) {
    this.releaseToken();
    this.vel.x += dir.x * speed; this.vel.z += dir.z * speed;
    if (!this.flying) this.vel.y = Math.max(this.vel.y, 4.2);
    this.telegraph = false;
    this.setState('dodge');
    this.dodgeCD = randRange(2.2, 4);
    G.audio.play('enemy_swing', { pos: this.pos, gap: 0.1 });
    if (!this.flying) G.vfx.burst(this.pos, 'dust', 4, { speed: 2.5, size: 0.5 });
  }

  // BotW burning panic: flail and run erratically, rarely spreading the flames
  startPanic() {
    this.releaseToken();
    this.telegraph = false;
    this.setState('panic');
    this.panicT = Math.min(Math.max(this.st.burn, 1.6), randRange(2, 3.2));
    this.panicDir = rand() * Math.PI * 2; this.panicTurn = 0; this.spreadDone = false; this.spreadT = 0.5;
    G.audio.play('enemy_panic', { pos: this.pos, gap: 0.3 });
  }
  updatePanic(dt, mul) {
    this.panicT -= dt; this.panicTurn -= dt; this.spreadT -= dt;
    if (this.panicTurn <= 0) {
      this.panicTurn = randRange(0.3, 0.6);
      // mostly away from the player, but erratic
      const away = Math.atan2(this.pos.x - G.player.pos.x, this.pos.z - G.player.pos.z);
      this.panicDir = rand() < 0.5 ? away + randRange(-1.2, 1.2) : this.panicDir + randRange(-2, 2);
      if (this.pos.distanceTo(this.home) > this.leash * 0.8) this.panicDir = Math.atan2(this.home.x - this.pos.x, this.home.z - this.pos.z);
      if (rand() < 0.3) G.audio.play('enemy_panic', { pos: this.pos, gap: 0.6 });
    }
    const sp = this.def.speed * 1.2 * mul;
    this.pos.x += Math.sin(this.panicDir) * sp * dt; this.pos.z += Math.cos(this.panicDir) * sp * dt;
    this.yaw = angleDamp(this.yaw, this.panicDir, 10, dt);
    this.curSpeed = sp;
    if (rand() < dt * 12) G.vfx.burst(this.center().setY(this.pos.y + this.height * 0.9), 'fire', 1, { spread: 0.25, size: 0.7 });
    if (!this.spreadDone && this.spreadT <= 0) {
      this.spreadT = 0.6;
      for (const o of G.enemies.list) {
        if (o === this || !(o instanceof Enemy) || !o.alive || !o.hittable || o.st.burn > 0 || o.boss) continue;
        if (Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) > this.radius + o.radius + 0.9) continue;
        if (rand() < 0.35) {
          G.combat.applyStatus(o, 'fire', 0.6, (this.st.burnDmg || 1) / 0.14 * 0.6);
          G.vfx.burst(o.center(), 'fire', 8, { speed: 2 });
          this.spreadDone = true;
        }
        break;
      }
    }
    if (this.panicT <= 0 || this.st.burn <= 0) { this.panicCD = 4; this.setState(this.aggroed ? 'chase' : 'idle'); }
  }

  die(h) {
    if (!this.alive) return;
    this.alive = false; this.hittable = false;
    this.releaseToken();
    this.telegraph = false;
    this.dying = 0.001;
    G.combat.breakIce(this);
    const c = this.center();
    G.audio.play('enemy_die', { pos: c });
    G.vfx.burst(c, 'soul', this.def.boss ? 60 : 10, { el: 'gold' });
    G.vfx.burst(c, 'star', 1, { el: 'gold', size: 3 });
    G.vfx.flash(c, 0xffe0a0, 25, 10, 0.4);
    const xp = Math.round(this.def.xp * (1 + 0.45 * (this.level - 1)) * (this.elite ? 3 : 1));
    G.player.addXP(xp);
    G.hud.floatText(c.clone().setY(c.y + 0.6), `+${xp} XP`, '#f1d48a', 'info');
    G.enemies.drop(c, this);
    if (G.player.lockTarget === this) G.player.lockTarget = null;
    // fall direction and death pose (already lying → stay down the same way)
    this.lie0X = this.lieX * this.lieW; this.lie0Z = this.lieZ * this.lieW;
    if (this.lieW < 0.3) {
      const { lz, lx } = this.local(this.hitDir);
      const l = Math.hypot(lz, lx) || 1;
      this.lieX = (lz / l) * 1.5; this.lieZ = (-lx / l) * 1.5;
    }
    this.baseScale = this.root.scale.x;
    this.deathT1 = this.def.boss ? 1.0 : this.bigDeath ? 0.7 : 0.42;
    this.deathT2 = this.def.boss ? 2.2 : this.bigDeath ? 1.4 : 1.0;
    if (this.deathStyle === 'fall' && this.pos.y - G.world.ground(this.pos.x, this.pos.z, this.pos.y + 1) > 0.3) { this.airborne = true; this.vel.y = Math.min(this.vel.y, 1); }
    if (this.onDeath) this.onDeath(this);
    if (G.story) G.story.onKill(this);
  }

  // Collect the rig's materials for the world-space dissolve; hide outline hulls.
  beginDissolve() {
    const own = new Set(this.rig.mats || []);
    const D = (this._dis = { mats: [], hide: [], glow: [] });
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.isOutline) { o.visible = false; return; }
      const m = o.material;
      if (own.has(m)) return;
      if (m && m.userData && m.userData.dissolve) D.hide.push(o);
      else D.glow.push({ o, s: o.scale.clone() });
    });
    const edge = this.def.edge || (this.elite ? new THREE.Color(2.2, 1.5, 0.5) : HUSH_EDGE);
    for (const m of own) if (m.userData && m.userData.dissolve) { D.mats.push(m); m.userData.dissolveColor.value.copy(edge); }
    G.audio.play('enemy_dissolve', { pos: this.center(), v: this.bigDeath ? 1.2 : 0.8 });
    const c = this.center();
    G.vfx.burst(c, 'hush', this.bigDeath ? 10 : 5, { size: this.bigDeath ? 1.4 : 0.9, spread: this.radius });
  }
  setDissolve(v) {
    const D = this._dis;
    for (const m of D.mats) m.userData.dissolve.value = v;
    for (const o of D.hide) o.visible = v < 0.45;
    for (const g of D.glow) g.o.scale.copy(g.s).multiplyScalar(Math.max(0.001, 1 - v * 1.15));
    if (v > 0.35 && !D.noShadow) { D.noShadow = true; this.root.traverse((o) => { if (o.isMesh) o.castShadow = false; }); }
  }

  updateDying(dt) {
    this.dying += dt;
    const k = this.dying, T1 = this.deathT1, T2 = this.deathT2;
    const W = G.world;
    // corpse physics (flyers drop, launched bodies land)
    const gy = W.ground(this.pos.x, this.pos.z, this.pos.y + 1);
    if (this.deathStyle === 'fall' || this.airborne || this.pos.y > gy + 0.05) {
      this.vel.y -= GRAV * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= gy) {
        if (this.airborne || this.vel.y < -4) { G.vfx.burst(this.pos, 'dust', 6, { speed: 3, size: 0.6 }); G.audio.play('body_fall', { pos: this.pos, v: 0.6, gap: 0.05 }); }
        this.pos.y = gy; this.vel.y = 0; this.airborne = false;
      }
    }
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.vel.x = damp(this.vel.x, 0, 5, dt); this.vel.z = damp(this.vel.z, 0, 5, dt);
    // collapse pose
    const c = clamp(k / T1, 0, 1);
    let rx = 0, rz = 0, py = 0;
    const s = { ...(this.deathPose ? this.deathPose() : null), speed: 0, grounded: true, dead: true };
    switch (this.deathStyle) {
      case 'topple': {
        const e = easeIn(c);
        rx = lerp(this.lie0X, this.lieX, e); rz = lerp(this.lie0Z, this.lieZ, e);
        py = e * this.radius * 0.3;
        if (c >= 1 && !this._thud) { this._thud = true; G.audio.play('body_fall', { pos: this.pos, v: this.bigDeath ? 1 : 0.6, gap: 0.03 }); G.vfx.burst(this.pos, 'dust', this.bigDeath ? 16 : 7, { speed: this.bigDeath ? 6 : 3, size: this.bigDeath ? 1.2 : 0.7 }); if (this.bigDeath) G.cameraRig.shake(0.2); }
        break;
      }
      case 'flatten': {
        const e = smooth(c);
        this.root.scale.set(this.baseScale * (1 + 0.35 * e), this.baseScale * (1 - 0.62 * e), this.baseScale * (1 + 0.35 * e));
        break;
      }
      case 'fall': rx = this.airborne ? Math.sin(k * 9) * 0.4 : 1.3 * smooth(c); rz = 0.4 * smooth(c); break;
      case 'kneel': s.kneel = true; s.dead = false; break;
      case 'sink': break;
    }
    this.root.position.set(this.pos.x, this.pos.y + py, this.pos.z);
    this.root.rotation.set(rx, this.yaw, rz);
    this.rig.update(dt, s);
    // emissive: white death flash then a faint hush glow
    const f = k < 0.1 ? 3 * (1 - k / 0.1) : 0;
    for (const m of this.rig.mats || []) m.emissive.setRGB(f + 0.05 * c, f + 0.02 * c, f + 0.1 * c);
    // dissolve (flyers wait until they hit the ground, capped)
    const startAt = this.deathStyle === 'fall' && this.airborne && k < 2 ? Infinity : T1;
    if (k > startAt || this._dis) {
      if (!this._dis) { this.beginDissolve(); this.disT = 0; }
      this.disT += dt;
      const d = clamp(this.disT / T2, 0, 1);
      this.setDissolve(smooth(d) * 0.98 + d * 0.02);
      const cc = this.center();
      const R = this.radius * (this.deathStyle === 'topple' ? 1.4 : 0.9);
      if (rand() < 0.7) G.vfx.burst(tmp.set(cc.x + randRange(-R, R), this.pos.y + randRange(0.1, this.height * (this.deathStyle === 'topple' ? 0.5 : 0.9)), cc.z + randRange(-R, R)), 'ash', 2, { spread: 0.2 });
      if (rand() < 0.35) G.vfx.burst(tmp.set(cc.x + randRange(-R, R), this.pos.y + 0.3, cc.z + randRange(-R, R)), 'hush', 1, { size: this.bigDeath ? 1.1 : 0.7, spread: 0.2 });
      if (rand() < 0.6) G.vfx.burst(tmp.set(cc.x + randRange(-R, R), this.pos.y + randRange(0.2, this.height * 0.6), cc.z + randRange(-R, R)), 'trail', 1, { el: 'hush', vy: 2.2, size: 0.28, life: 0.7, grav: -1 });
      if (d >= 1) {
        const pc = this.pos.clone().setY(this.pos.y + 0.4);
        G.vfx.burst(pc, 'hush', this.bigDeath ? 14 : 6, { size: this.bigDeath ? 1.6 : 1, spread: this.radius });
        G.vfx.burst(pc, 'ash', this.bigDeath ? 24 : 10, { spread: this.radius });
        if (this.bigDeath) { G.vfx.ring(this.pos, PAL.hush.glow, this.radius * 3, 0.6, { thick: 0.15 }); G.vfx.burst(pc, 'soul', this.def.boss ? 40 : 12, { el: 'arcane' }); }
        this.remove();
        return false;
      }
    }
    return true;
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
    const hp0 = P.hp;
    P.damage(Math.max(1, Math.round(q * this.dmgMul * this.phaseMul)), { dir, knock, pos: this.center() });
    return P.hp < hp0;
  }

  update(dt) {
    if (this.dying > 0) return this.updateDying(dt);
    if (this.brk) tickBreak(this, dt);
    this.speedMul = G.combat.tick(this, dt);
    const st = this.st;
    const disabled = st.frozen > 0 || st.stun > 0;
    // physics
    const W = G.world;
    const ground = W.ground(this.pos.x, this.pos.z, this.pos.y + 1);
    const frozenFlyer = this.def.flying && st.frozen > 0;
    if (frozenFlyer && this.pos.y > ground + 0.3) this.airborne = true;
    if (this.flying && !this.airborne) {
      // hover handled by AI
    } else {
      this.vel.y -= GRAV * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= ground) {
        if (frozenFlyer && this.airborne) {
          // frozen flyers drop out of the sky and crack on the ground
          G.combat.breakIce(this, true);
          G.vfx.burst(this.center(), 'ice', 18, { speed: 7 }); G.vfx.burst(this.pos, 'frostmist', 4);
          G.audio.play('shatter', { pos: this.pos, gap: 0.1 });
          st.frozen = 0;
          G.combat.hit(this, { dmg: Math.max(1, this.maxHp * (this.def.frozenFall ?? 0.3)), el: 'frost', noReact: true, noStatus: true, source: 'fall', hitstop: 0.04, shake: 0.12 });
        } else if (this.airborne && this.vel.y < -9) {
          const fall = Math.round(this.maxHp * 0.06 + (-this.vel.y - 9) * 1.5);
          G.combat.hit(this, { dmg: fall, el: 'wind', noReact: true, noStatus: true, source: 'fall', hitstop: 0.03, shake: 0.1 });
          G.vfx.burst(this.pos, 'dust', 10, { speed: 4 });
          G.audio.play('land', { v: 1 });
        }
        const wasAir = this.airborne;
        this.pos.y = ground; this.vel.y = 0; this.airborne = false;
        if (wasAir && this.alive && this.def.knockdown && this.state !== 'down') this.knockDown(tmp2.set(this.vel.x, 0, this.vel.z).lengthSq() > 0.5 ? tmp2.normalize() : this.hitDir);
        if (!this.alive) return true;
      }
    }
    // knockback velocity
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    const fr = this.airborne ? 0.8 : 6;
    this.vel.x = damp(this.vel.x, 0, fr, dt); this.vel.z = damp(this.vel.z, 0, fr, dt);
    this.curSpeed = 0;
    // burning panic (rolled once per ignition)
    if (st.burn > 0) {
      if (!this.burnRolled && this.def.panic && !this.boss && !this.elite && st.frozen <= 0) {
        this.burnRolled = true;
        if (this.panicCD <= 0 && rand() < 0.6 && this.state !== 'down' && this.state !== 'getup' && G.mode !== 'cutscene') this.startPanic();
      }
    } else this.burnRolled = false;
    this.panicCD = Math.max(0, this.panicCD - dt);
    if (!disabled && G.mode !== 'cutscene') {
      if (this.state === 'down' || this.state === 'getup') this.updateDown(dt);
      else if (this.state === 'panic') this.updatePanic(dt, this.speedMul);
      else if (this.state === 'dodge') { this.facePlayer(dt, 8); if (this.stateT > 0.42) this.setState(this.aggroed ? 'chase' : 'idle'); }
      else {
        if (this.aggroed && !this.tryDodge(dt)) this.think(dt, this.speedMul);
        else if (!this.aggroed) this.think(dt, this.speedMul);
      }
    } else if (disabled) { this.releaseToken(); this.telegraph = false; }
    if (this.state === 'stagger') { this.staggerT -= dt; if (this.staggerT <= 0) { this.vulnerable = false; this.setState(this.aggroed ? 'chase' : 'idle'); } }
    // water: non-flyers avoid deep water
    if (!this.flying && W.h(this.pos.x, this.pos.z) < -0.8) { this.pos.x = damp(this.pos.x, this.home.x, 2, dt); this.pos.z = damp(this.pos.z, this.home.z, 2, dt); }
    // separation
    if (!this.ghost) {
      for (const o of G.enemies.list) {
        if (o === this || !o.alive || o.ghost || !o.pos) continue;
        const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
        const d = Math.hypot(dx, dz), m = this.radius + o.radius + 0.2;
        if (d < m && d > 0.001) { const push = (m - d) * 0.5; this.pos.x += (dx / d) * push; this.pos.z += (dz / d) * push; }
      }
      const P = G.player.pos;
      let dx = this.pos.x - P.x, dz = this.pos.z - P.z;
      if (Math.abs(dx) + Math.abs(dz) < 0.002) { dx = Math.sin(this.yaw) * -0.01; dz = Math.cos(this.yaw) * -0.01; }
      const d = Math.hypot(dx, dz), m = this.radius + 0.42;
      if (d < m && Math.abs(this.pos.y - P.y) < 1.8) { this.pos.x += (dx / d) * (m - d); this.pos.z += (dz / d) * (m - d); }
    }
    if (!this.ghost) W.col.resolve(this.pos, this.radius, this.height);
    this.stateT += dt;
    this.barT = Math.max(0, this.barT - dt);
    this.flash = Math.max(0, this.flash - dt * 7);
    this.glintFlash = Math.max(0, this.glintFlash - dt * 9);
    this.animate(dt, disabled);
    return true;
  }

  flashTo(v) {
    for (const m of this.rig.mats || []) m.emissive.setRGB(v, v, v);
  }
  animate(dt, disabled) {
    const st = this.st;
    const T = this.tilt;
    const frozen = st.frozen > 0;
    if (!frozen) {
      // damped spring: hit flinch tilts the body away from the blow, then wobbles back
      T.vx += (-150 * T.x - 12 * T.vx) * dt; T.vz += (-150 * T.z - 12 * T.vz) * dt;
      T.x = clamp(T.x + T.vx * dt, -0.75, 0.75); T.z = clamp(T.z + T.vz * dt, -0.75, 0.75);
      const lying = this.state === 'down';
      this.lieW = damp(this.lieW, lying ? 1 : 0, lying ? 9 : 4.5, dt);
    }
    let rx = T.x + this.lieX * this.lieW, rz = T.z + this.lieZ * this.lieW;
    let px = 0, py = this.lieW * this.radius * 0.3, pz = 0;
    if (this.state === 'stagger') rz += Math.sin(G.time * 4.2) * 0.07;
    const shocked = !frozen && st.stun > 0;
    if (shocked) { px = randRange(-0.035, 0.035); pz = randRange(-0.035, 0.035); rx += randRange(-0.05, 0.05); }
    this.root.position.set(this.pos.x + px, this.pos.y + py, this.pos.z + pz);
    this.root.rotation.set(rx, this.yaw, rz);
    // emissive tint: hit flash > frozen > burning > telegraph
    let r = 0, g = 0, b = 0;
    if (frozen) { r = 0.1; g = 0.35; b = 0.6; }
    else if (st.burn > 0) { const p = 0.25 + Math.sin(G.time * 12) * 0.1; r = p; g = p * 0.35; }
    else if (st.chill > 0) { const k = Math.min(st.chill, 3) / 3; r = 0.03 * k; g = 0.14 * k; b = 0.26 * k; } // frost creeping in, deepening per stack
    if (st.wet > 0 && !frozen) { const p = 0.05 + Math.max(0, Math.sin(G.time * 3 + this.pos.x)) * 0.05; g += p * 0.5; b += p; } // cool wet sheen
    if (shocked) { const p = rand() * 0.35; r += p; g += p; b += p * 0.3; }
    else if (st.electro > 0 && rand() < 0.18) { const p = 0.25 + rand() * 0.3; r += p; g += p * 0.95; b += p * 0.35; } // crackling charge
    if (this.telegraph) { const p = 0.3 + Math.sin(G.time * 30) * 0.25; r += p; g += p * 0.1; }
    if (this.vulnerable) { const p = 0.2 + Math.sin(G.time * 10) * 0.15; r += p; g += p * 0.8; }
    r += this.flash * 1.4 + this.glintFlash * 0.32; g += this.flash * 1.4 + this.glintFlash * 0.28; b += this.flash * 1.4 + this.glintFlash * 0.2;
    for (const m of this.rig.mats || []) m.emissive.setRGB(r, g, b);
    if (disabled && frozen) return;
    const s = this.animState ? this.animState() : { speed: this.curSpeed, grounded: !this.airborne };
    if (this.state === 'down' || (this.state === 'getup' && this.stateT < 0.25)) s.down = true;
    if (this.state === 'stagger') s.stagger = true;
    if (this.state === 'panic') { s.panic = true; s.speed = this.curSpeed; s.cast = false; }
    if (shocked) s.shock = true;
    this.rig.update(dt, s);
  }

  remove() {
    G.scene.remove(this.root);
    // free the per-enemy bone textures now rather than whenever the wrappers get collected
    this.root.traverse((o) => { if (o.isSkinnedMesh && o.skeleton && o.skeleton.boneTexture) o.skeleton.dispose(); });
    this.alive = false;
    this.releaseToken();
    const i = G.enemies.list.indexOf(this);
    if (i >= 0) G.enemies.list.splice(i, 1);
    if (this.camp) { const j = this.camp.members.indexOf(this); if (j >= 0) this.camp.members.splice(j, 1); }
    if (this.st && this.st.ice) G.combat.breakIce(this, true);
  }

  // ---- default AI (ashling) ----
  think(dt, mul) {
    const P = G.player;
    const d = this.dist2Player();
    const canSee = P.seen();
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
        this.orbitT -= dt;
        if (this.orbitT <= 0) { this.orbitT = randRange(2, 5); this.orbit = -this.orbit; }
        const hasT = d < 6 && this.attackCD <= 0 ? this.takeToken() : this.hasToken;
        // waiting enemies circle the player and strafe; the token holder closes in
        const orbitSp = hasT ? 0.5 : 0.85 + (P.aimZoom && d < 14 ? 0.6 : 0);
        const ang = Math.atan2(this.pos.x - P.pos.x, this.pos.z - P.pos.z) + this.orbit * orbitSp * dt;
        const want = d < 2.1 ? 1.8 : Math.min(d, 2.0);
        const ring = hasT ? want : Math.max(want, 4.2 + Math.sin(G.time * 0.7 + this.home.x) * 0.8);
        const tx = P.pos.x + Math.sin(ang) * ring, tz = P.pos.z + Math.cos(ang) * ring;
        this.moveToward(tx, tz, this.def.speed * mul * (d > 8 ? 1.15 : 0.95), dt, false);
        this.facePlayer(dt);
        if (hasT && d < 2.5 && this.attackCD <= 0) { this.setState('windup'); G.audio.play('enemy_alert', { pos: this.pos, gap: 0.3 }); }
        break;
      }
      case 'windup': {
        this.facePlayer(dt, 14);
        this.telegraph = true;
        const wind = this.elite ? 0.42 : 0.55;
        if (this.elite) this.glintAt(wind - 0.2, this.rig.p?.foreR ? this.rig.p.foreR.getWorldPosition(tmp2) : null);
        if (this.stateT > wind) { this.telegraph = false; this.setState('attack'); this.didHit = false; G.audio.play('enemy_swing', { pos: this.pos }); this.rig.flick && this.rig.flick(); }
        break;
      }
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
    const canSee = P.seen();
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
        this.orbitT -= dt;
        if (this.orbitT <= 0) { this.orbitT = randRange(3, 6); this.orbit = -this.orbit; }
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
        if (this.elite) this.glintAt(0.68, this.center().add(this.fwd(tmp2).multiplyScalar(0.45)));
        if (rand() < 0.5) G.vfx.burst(this.center(), 'trail', 1, { el: 'hush', spread: 0.6, size: 0.3 });
        if (this.stateT > 0.9) {
          this.telegraph = false; this.charge = 0;
          const c = this.center();
          const n = this.elite ? 3 : 1;
          for (let i = 0; i < n; i++) {
            const tgt = G.player.center();
            const dir = tgt.sub(c).normalize().applyAxisAngle(UP, (i - (n - 1) / 2) * 0.25);
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
  setState(s) { if (s !== 'charge') this.charge = 0; super.setState(s); }
  animState() { return { speed: this.curSpeed || 0, charge: this.charge }; }
  get flying() { return this.st.frozen <= 0 && !this.airborne; }
}

// ------------------------------------------------------------------
class Brute extends Enemy {
  constructor(type, pos, level, opts) {
    super(type, pos, level, opts);
    this.slamCD = 1; this.chargeCD = 4; this.novaCD = 3;
    if (this.brk) this.phaseAt = [0.6, 0.25];
  }
  update(dt) {
    if (this.dying > 0) return super.update(dt);
    // as a boss (the frost shrine's guardian): 60% → frost nova, 25% → double nova and charge-into-slam
    if (this.brk && this.alive && phaseCheck(this, this.phaseAt)) this.enterPhase();
    if (this.type === 'bruteFrost' && this.st.burn > 0) this.st.armorBroken = Math.max(this.st.armorBroken, 0.6);
    const broken = this.st.armorBroken > 0;
    if (this.rig.armor) this.rig.armor.forEach((a, i) => { a.visible = !broken || i % 3 === 2; });
    if (broken && !this._wasBroken) { G.vfx.burst(this.center(), 'dust', 14, { speed: 6, color: new THREE.Color(0.5, 0.48, 0.45) }); G.audio.play('brute_slam', { pos: this.pos }); G.hud.floatText(this.center(), '갑옷 파괴!', '#ffd86a'); }
    this._wasBroken = broken;
    return super.update(dt);
  }
  enterPhase() {
    const c = this.center();
    G.audio.play('boss_roar', { pos: this.pos });
    G.vfx.ring(this.pos, PAL.frost.glow, 9, 0.7, { thick: 0.3 });
    G.vfx.burst(c, 'frostmist', 24, { size: 2 }); G.vfx.burst(c, 'ice', 16, { speed: 8 });
    G.cameraRig.shake(0.3);
    this.novaCD = Math.min(this.novaCD, 1.5);
    if (G.story) G.story.onBossPhase(this, this.phase);
  }
  // ring of frost bursting out of the ground around the guardian (blink out or stand beyond it)
  frostNova(r) {
    const p = this.pos.clone();
    G.audio.play('shatter', { pos: p }); G.audio.play('brute_slam', { pos: p, v: 0.8 });
    G.vfx.ring(p, PAL.frost.glow, r, 0.45, { thick: 0.35 });
    G.vfx.burst(p, 'frostmist', 18, { size: 2.2, speed: 6 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      G.vfx.burst(tmp.set(p.x + Math.cos(a) * r * 0.7, p.y + 0.4, p.z + Math.sin(a) * r * 0.7), 'ice', 3, { speed: 6 });
    }
    G.cameraRig.shake(0.35);
    if (G.player.pos.distanceTo(p) < r) this.hurtPlayer(this.def.dmg * 0.9, 10);
  }
  think(dt, mul) {
    const P = G.player;
    const d = this.dist2Player();
    const canSee = P.seen();
    this.slamCD -= dt; this.chargeCD -= dt; this.novaCD -= dt;
    const slamWind = this.fastSlam ? 0.6 : this.elite ? 0.85 : 1.05;
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
        if (this.brk && this.phase >= 2 && d < 7 && this.novaCD <= 0) {
          this.setState('novaWind');
          G.vfx.telegraph(this.pos, 6.5, 1.1, 0x9ad8ff);
          G.audio.play('charge', { pos: this.pos });
        } else if (d < 4.2 && this.slamCD <= 0) {
          this.setState('slamWind');
          const f = this.fwd();
          this.slamPt = this.pos.clone().addScaledVector(f, 2.4);
          this.slamPt.y = G.world.ground(this.slamPt.x, this.slamPt.z, this.pos.y + 2);
          this.tele = G.vfx.telegraph(this.slamPt, 3.4, slamWind);
          G.audio.play('brute_roar', { pos: this.pos, gap: 0.5 });
        } else if (d > 8 && d < 20 && this.chargeCD <= 0) {
          this.setState('chargeWind');
        }
        break;
      case 'slamWind':
        this.telegraph = true;
        if (this.stateT < 0.4) this.facePlayer(dt, 4);
        this.glintAt(slamWind - 0.28, this.rig.p?.foreR ? this.rig.p.foreR.getWorldPosition(tmp2).setY(this.pos.y + this.height * 1.05) : null, true);
        if (this.stateT > slamWind) {
          this.telegraph = false;
          const p = this.slamPt;
          G.audio.play('brute_slam', { pos: p });
          G.vfx.burst(p, 'dust', 22, { speed: 9, size: 1.2 });
          G.vfx.ring(p, PAL.hush.glow, 4.5, 0.5, { thick: 0.3 });
          G.vfx.burst(p, 'hush', 8);
          const dd = G.player.pos.distanceTo(p);
          if (dd < 3.6) this.hurtPlayer(this.def.dmg, 12);
          G.cameraRig.shake(clamp(0.6 - dd * 0.03, 0.05, 0.6));
          this.slamCD = randRange(2.2, 3.5) * (this.phase >= 2 ? 0.8 : 1);
          this.fastSlam = false;
          this.setState('recover');
        }
        break;
      case 'novaWind':
        this.telegraph = true;
        this.glintAt(0.8, null, true);
        if (rand() < 0.5) G.vfx.burst(this.pos, 'frostmist', 1, { size: 1.4, speed: 2 });
        if (this.stateT > 1.1) {
          this.telegraph = false;
          this.frostNova(6.5);
          // last phase: a wider second ring catches those who only stepped back
          if (this.phase >= 3) {
            G.vfx.telegraph(this.pos, 10, 0.8, 0x9ad8ff);
            this.followUp(() => this.frostNova(10), 800);
          }
          this.novaCD = this.phase >= 3 ? randRange(6, 8) : randRange(8, 10);
          this.setState('recover');
        }
        break;
      case 'chargeWind':
        this.facePlayer(dt, 8);
        this.telegraph = true;
        this.glintAt(0.52, null, true);
        if (rand() < 0.4) G.vfx.burst(this.pos, 'dust', 1, { speed: 2 });
        if (this.stateT > 0.8) { this.telegraph = false; this.setState('charge'); this.hitDone = false; G.audio.play('brute_roar', { pos: this.pos }); }
        break;
      case 'charge': {
        const f = this.fwd();
        this.pos.addScaledVector(f, 13 * mul * dt);
        this.curSpeed = 10;
        if (rand() < 0.5) G.vfx.burst(this.pos, 'dust', 1, { speed: 3 });
        if (!this.hitDone && d < this.radius + 1.0) { this.hitDone = true; this.hurtPlayer(this.def.dmg, 14); }
        if (this.stateT > 1.1 || G.world.col.pointHit(this.pos.x + f.x * 1.5, this.pos.y + 1, this.pos.z + f.z * 1.5, 0.5)) {
          this.chargeCD = randRange(5, 8) * (this.phase >= 2 ? 0.8 : 1); G.cameraRig.shake(0.15);
          if (this.brk && this.phase >= 3) {
            // last phase: the charge ends in a quick slam
            this.fastSlam = true; this.facePlayer(1, 99);
            this.setState('slamWind');
            this.slamPt = this.pos.clone().addScaledVector(this.fwd(), 2.4);
            this.slamPt.y = G.world.ground(this.slamPt.x, this.slamPt.z, this.pos.y + 2);
            this.tele = G.vfx.telegraph(this.slamPt, 3.4, 0.6);
            G.audio.play('brute_roar', { pos: this.pos, gap: 0.3 });
          } else this.setState('recover');
        }
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
    if (this.state === 'chargeWind' || this.state === 'charge') s.charge = this.state === 'charge' ? 1 : 0.6;
    if (this.state === 'novaWind') s.cast = true, s.aimPitch = -1.5;
    if (this.state === 'stagger' && this.brk && this.brk.down > 0) s.kneel = true;
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
  update(dt) {
    // water oozes are always soaked: storm chains through them, frost flash-freezes them
    if (this.variant === 'water' && this.alive) this.st.wet = Math.max(this.st.wet, 1.5);
    return super.update(dt);
  }
  think(dt, mul) {
    const P = G.player;
    const d = this.dist2Player();
    const canSee = P.seen();
    this.landT = Math.max(0, this.landT - dt);
    if (this.hopping) {
      this.airT += dt;
      this.pos.addScaledVector(this.hopDir, this.hopSpeed * dt * mul);
      if (this.airT > 0.12 && this.vel.y === 0) {
        this.hopping = false; this.landT = 0.2;
        G.vfx.burst(this.pos, 'dust', 3, { speed: 2, size: 0.4 });
        if (this.variant === 'fire') G.vfx.burst(this.pos, 'fire', 4, { speed: 2 });
        if (this.variant === 'frost') G.vfx.burst(this.pos, 'frostmist', 2, { size: 0.6 });
        if (this.variant === 'water') G.vfx.burst(this.pos, 'splash', 4, { speed: 2.5, size: 0.6 * this.size });
        G.audio.play('land', { v: 0.4 * this.size, gap: 0.05 });
        if (this.aggroed && d < 1.1 + this.radius) this.hurtPlayer(this.def.dmg, 5);
      }
      return;
    }
    this.hopT -= dt * mul;
    const hop = (tx, tz, dist) => {
      const dx = tx - this.pos.x, dz = tz - this.pos.z, l = Math.hypot(dx, dz) || 1;
      this.hopDir.set(dx / l, 0, dz / l).applyAxisAngle(UP, randRange(-0.3, 0.3));
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
    G.vfx.burst(c, this.variant === 'fire' ? 'fire' : this.variant === 'frost' ? 'ice' : this.variant === 'water' ? 'water' : 'hush', 12, { speed: 4 });
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
    } else if (this.variant === 'water') {
      // bursts into a soaking splash: everything nearby is left wet (→ storm chains, frost freezes)
      const RW = R + 0.8;
      G.vfx.ring(pos, PAL.water.glow, RW * 1.2, 0.5, { thick: 0.3 });
      G.vfx.burst(c, 'splash', 22, { speed: 6, size: 1.1 }); G.vfx.burst(c, 'water', 26, { speed: 7 });
      G.audio.play('splash', { pos }); G.audio.play('impact_water', { pos });
      for (const e of G.enemies.list) {
        if (!e.alive || e === this || !(e instanceof Enemy)) continue;
        if (e.center().distanceTo(pos) < RW + (e.radius || 0.5)) { e.st.wet = Math.max(e.st.wet, 7); G.vfx.burst(e.center(), 'water', 6, { speed: 2 }); }
      }
      if (G.player.pos.distanceTo(pos) < RW) G.vfx.burst(G.player.center(), 'water', 8, { speed: 2 });
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
    const canSee = P.seen();
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
// 방패지기 — tower-shield guard. Frontal hits are blocked unless they are
// heavy spells or elemental reactions; attacks: shield bash and charging shove.
// ------------------------------------------------------------------
const GUARD_STATES = new Set(['alert', 'chase', 'bashWind', 'bash', 'shoveWind', 'shove', 'return', 'dodge']);
class ShieldBearer extends Enemy {
  constructor(pos, level, opts) {
    super('shield', pos, level, opts);
    this.guardBreakT = 0; this.strain = 0; this.strainT = 0;
    this.bashCD = randRange(0.8, 1.6); this.shoveCD = randRange(3, 5);
    this.blockTextT = 0;
  }
  get guarding() {
    return this.alive && this.guardBreakT <= 0 && this.st.frozen <= 0 && this.st.stun <= 0 && GUARD_STATES.has(this.state);
  }
  frontal(h) {
    if (!h.dir) return false;
    const hl = Math.hypot(h.dir.x, h.dir.z);
    if (hl < 0.35 || Math.abs(h.dir.y) > 0.8) return false; // overhead and area blasts get past the shield
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    return (-h.dir.x * fx - h.dir.z * fz) / hl > 0.342; // within ~70° of the facing
  }
  shieldPoint() { return this.pos.clone().addScaledVector(this.fwd(tmp2), 0.75).setY(this.pos.y + 1.15); }
  receive(h) {
    if (!this.alive) return 0;
    if (h.source === 'player' && this.guarding && this.frontal(h)) {
      if (predictsReaction(this, h)) { this.breakGuard(3.2); return G.combat.resolve(this, h); }
      if (h.heavy) { this.breakGuard(2.6); return G.combat.resolve(this, { ...h, dmg: h.dmg * 0.5, blocked: true }); }
      // blocked: clang, little damage, no status
      const sp = this.shieldPoint();
      G.vfx.burst(sp, 'spark', 12, { el: 'gold', speed: 7 });
      G.vfx.burst(sp, 'star', 1, { el: 'white', size: 1.6, life: 0.12 });
      G.vfx.ring(sp, PAL.gold.glow, 1.0, 0.18, { up: this.fwd(tmp).clone(), thick: 0.25, y: 0 });
      G.audio.play('shield_clang', { pos: sp, gap: 0.05 });
      if (this.blockTextT <= 0) { this.blockTextT = 0.5; G.hud.floatText(sp, '막힘', '#c9c0d8', 'info'); }
      this.strain += 1; this.strainT = 2.5;
      this.vel.x -= Math.sin(this.yaw) * 1.2; this.vel.z -= Math.cos(this.yaw) * 1.2;
      const dmg = G.combat.resolve(this, { ...h, dmg: h.dmg * 0.15, noStatus: true, noReact: true, knock: 0, lift: 0, blocked: true, hitstop: 0.05, shake: 0.08 });
      if (this.strain >= 6 && this.alive) this.breakGuard(2.2);
      return dmg;
    }
    return G.combat.resolve(this, h);
  }
  breakGuard(t) {
    if (!this.alive) return;
    this.guardBreakT = Math.max(this.guardBreakT, t);
    this.strain = 0;
    const sp = this.shieldPoint();
    G.audio.play('shield_break', { pos: sp, gap: 0.2 });
    G.vfx.burst(sp, 'spark', 22, { el: 'gold', speed: 9 }); G.vfx.burst(sp, 'dust', 6, { speed: 3 });
    G.hud.floatText(this.center().setY(this.pos.y + this.height), '방어 붕괴!', '#ffd86a');
    G.hitstop = Math.max(G.hitstop, 0.06);
    this.stagger(Math.min(2.2, t * 0.75));
  }
  update(dt) {
    if (this.dying > 0) return super.update(dt);
    this.guardBreakT = Math.max(0, this.guardBreakT - dt);
    this.blockTextT -= dt;
    this.strainT -= dt; if (this.strainT <= 0) this.strain = Math.max(0, this.strain - dt * 2);
    this.bashCD -= dt; this.shoveCD -= dt;
    // overload / shatter crack armor → knock the shield aside too
    const ab = this.st.armorBroken > 0;
    if (ab && !this._ab && this.guardBreakT <= 0) this.breakGuard(3);
    this._ab = ab;
    return super.update(dt);
  }
  think(dt, mul) {
    const P = G.player;
    const d = this.dist2Player();
    const canSee = P.seen();
    const turn = this.elite ? 4 : 3; // slow turning: blink behind it
    switch (this.state) {
      case 'idle':
        this.wanderT -= dt;
        if (this.wanderT <= 0) { this.wanderT = randRange(4, 7); this.wanderTo = new THREE.Vector3(this.home.x + randRange(-5, 5), 0, this.home.z + randRange(-5, 5)); }
        if (this.wanderTo && this.moveToward(this.wanderTo.x, this.wanderTo.z, 1.1 * mul, dt) < 0.4) this.wanderTo = null;
        if (canSee && d < this.def.aggro) this.aggro();
        break;
      case 'alert':
        this.facePlayer(dt, 6);
        if (this.stateT > 0.7) this.setState('chase');
        break;
      case 'chase': {
        if (!canSee) { if (this.stateT > 2) this.setState('return'); break; }
        if (this.pos.distanceTo(this.home) > this.leash && d > 14) { this.aggroed = false; this.setState('return'); break; }
        this.facePlayer(dt, turn);
        const hasT = d < 5 && this.bashCD <= 0 ? this.takeToken() : this.hasToken;
        const ring = hasT ? 1.8 : 3.4;
        this.orbitT -= dt;
        if (this.orbitT <= 0) { this.orbitT = randRange(2.5, 5); this.orbit = -this.orbit; }
        const ang = Math.atan2(this.pos.x - P.pos.x, this.pos.z - P.pos.z) + this.orbit * 0.3 * dt;
        if (d > ring + 0.3 || d < ring - 0.6) this.moveToward(P.pos.x + Math.sin(ang) * ring, P.pos.z + Math.cos(ang) * ring, this.def.speed * mul * (d > 9 ? 1.1 : 0.75), dt, false);
        if (hasT && d < 2.7 && this.bashCD <= 0) { this.setState('bashWind'); G.audio.play('enemy_alert', { pos: this.pos, gap: 0.3 }); }
        else if (d > 5.5 && d < 13 && this.shoveCD <= 0) { this.setState('shoveWind'); G.audio.play('brute_roar', { pos: this.pos, gap: 0.5 }); }
        break;
      }
      case 'bashWind': {
        const wind = this.elite ? 0.5 : 0.65;
        this.facePlayer(dt, 5);
        this.telegraph = true;
        this.glintAt(wind - 0.22, this.shieldPoint().setY(this.pos.y + 1.7));
        if (this.stateT > wind) { this.telegraph = false; this.didHit = false; this.setState('bash'); G.audio.play('enemy_swing', { pos: this.pos }); }
        break;
      }
      case 'bash': {
        const f = this.fwd();
        if (this.stateT < 0.18) this.pos.addScaledVector(f, 8 * dt * mul);
        if (!this.didHit && this.stateT > 0.08) {
          this.didHit = true;
          if (this.playerInArc(2.7, 0.3)) { if (this.hurtPlayer(this.def.dmg, 11)) { G.audio.play('shield_clang', { pos: this.shieldPoint() }); G.cameraRig.shake(0.25); } }
          G.vfx.burst(this.shieldPoint(), 'dust', 5, { speed: 3, size: 0.6 });
        }
        if (this.stateT > 0.3) { this.bashCD = randRange(2, 3.4); this.setState('recover'); }
        break;
      }
      case 'shoveWind':
        this.facePlayer(dt, 6);
        this.telegraph = true;
        this.glintAt(0.55, this.shieldPoint().setY(this.pos.y + 1.7), true);
        if (rand() < 0.5) G.vfx.burst(this.pos, 'dust', 1, { speed: 2 });
        if (this.stateT > 0.8) { this.telegraph = false; this.hitDone = false; this.setState('shove'); G.audio.play('brute_roar', { pos: this.pos, gap: 0.2 }); }
        break;
      case 'shove': {
        this.facePlayer(dt, 1.2);
        const f = this.fwd();
        this.pos.addScaledVector(f, 11 * mul * dt);
        this.curSpeed = 9;
        if (rand() < 0.6) G.vfx.burst(this.pos, 'dust', 1, { speed: 3 });
        if (!this.hitDone && d < this.radius + 1.0 && this.playerInArc(this.radius + 1.2, 0.2)) { this.hitDone = true; if (this.hurtPlayer(this.def.dmg * 1.3, 15)) { G.audio.play('shield_clang', { pos: this.shieldPoint() }); G.cameraRig.shake(0.35); } }
        if (this.stateT > 0.9 || this.hitDone || G.world.col.pointHit(this.pos.x + f.x * 1.2, this.pos.y + 1, this.pos.z + f.z * 1.2, 0.5)) { this.shoveCD = randRange(6, 8); this.setState('recover'); }
        break;
      }
      case 'recover':
        // shield lowered: the punish window
        if (this.stateT > 0.9) { this.releaseToken(); this.setState('chase'); }
        break;
      case 'return': {
        this.releaseToken();
        const dd = this.moveToward(this.home.x, this.home.z, this.def.speed * 1.1, dt);
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * dt * 0.25);
        if (dd < 1) { this.aggroed = false; this.setState('idle'); }
        if (canSee && d < this.def.aggro * 0.6 && this.stateT > 2) { this.aggroed = false; this.aggro(); }
        break;
      }
    }
  }
  animState() {
    return {
      speed: this.curSpeed || 0, grounded: !this.airborne,
      guard: this.guarding,
      bash: this.state === 'bash' || this.state === 'shove' || (this.state === 'bashWind' && this.stateT > 0.35),
      broken: this.guardBreakT > 0,
    };
  }
}

// ------------------------------------------------------------------
// 메아리 사수 — keeps its distance, paints an aiming line, then looses a fast arrow
// ------------------------------------------------------------------
let arrowGeo = null;
function getArrowGeo() {
  if (arrowGeo) return arrowGeo;
  const shaft = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 5); shaft.rotateX(Math.PI / 2);
  const head = new THREE.ConeGeometry(0.09, 0.3, 5); head.rotateX(Math.PI / 2); head.translate(0, 0, 0.66);
  const pos = [...shaft.attributes.position.array, ...head.attributes.position.array];
  const idx = [...shaft.index.array, ...head.index.array.map((i) => i + shaft.attributes.position.count)];
  arrowGeo = new THREE.BufferGeometry();
  arrowGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  arrowGeo.setIndex(idx);
  return arrowGeo;
}
class Archer extends Enemy {
  constructor(pos, level, opts) {
    super('archer', pos, level, opts);
    this.shootCD = randRange(1.2, 2.4); this.repoT = randRange(2, 4);
    this.aimDir = new THREE.Vector3(); this.line = null; this.draw = 0;
    this.want = randRange(14.5, 18);
  }
  setState(s) {
    if (this.state === 'aim' && s !== 'aim') this.endLine();
    super.setState(s);
  }
  endLine() { if (this.line) { this.line.done = true; this.line = null; } this.draw = 0; }
  die(h) { this.endLine(); super.die(h); }
  remove() { this.endLine(); super.remove(); }
  bowTip() { return this.center().addScaledVector(this.fwd(tmp2), 0.55).setY(this.pos.y + this.height * 0.82); }
  lineOfSight(from, to) {
    const dir = tmp.subVectors(to, from); const L = dir.length(); dir.normalize();
    const t = G.world.terrain.raycast(from, dir, L);
    return t === null || t > L - 0.6;
  }
  think(dt, mul) {
    const P = G.player;
    const d = this.dist2Player();
    const canSee = P.seen();
    const M = G.enemies;
    switch (this.state) {
      case 'idle':
        this.wanderT -= dt;
        if (this.wanderT <= 0) { this.wanderT = randRange(3, 6); this.wanderTo = new THREE.Vector3(this.home.x + randRange(-6, 6), 0, this.home.z + randRange(-6, 6)); }
        if (this.wanderTo && this.moveToward(this.wanderTo.x, this.wanderTo.z, 1.2 * mul, dt) < 0.3) this.wanderTo = null;
        if (canSee && d < this.def.aggro) this.aggro();
        break;
      case 'alert':
        this.facePlayer(dt, 10);
        if (this.stateT > 0.5) this.setState('chase');
        break;
      case 'chase': {
        if (!canSee) { if (this.stateT > 2) this.setState('return'); break; }
        if (this.pos.distanceTo(this.home) > this.leash + 6 && d > 22) { this.aggroed = false; this.setState('return'); break; }
        const away = Math.atan2(this.pos.x - P.pos.x, this.pos.z - P.pos.z);
        if (d < 8) {
          // too close: back-pedal, or hop back if cornered
          if (d < 4.5 && this.dodgeCD <= 0) { this.dodge(tmp2.set(Math.sin(away), 0, Math.cos(away)), 12); break; }
          this.moveToward(this.pos.x + Math.sin(away) * 3, this.pos.z + Math.cos(away) * 3, this.def.speed * 1.15 * mul, dt, false);
        } else {
          this.repoT -= dt;
          if (this.repoT <= 0) { this.repoT = randRange(2.5, 4.5); this.orbit = -this.orbit; this.want = randRange(14.5, 18.5); }
          const ang = away + this.orbit * 0.3 * dt;
          const ring = clamp(d, this.want - 1.5, this.want + 1.5);
          this.moveToward(P.pos.x + Math.sin(ang) * ring, P.pos.z + Math.cos(ang) * ring, this.def.speed * mul * (d > 21 ? 1.1 : 0.7), dt, false);
        }
        this.facePlayer(dt, 8);
        this.shootCD -= dt;
        if (this.shootCD <= 0 && d > 5 && d < 32 && G.time - M.lastShot > 0.55) {
          if (this.lineOfSight(this.bowTip(), P.center())) { M.lastShot = G.time; this.setState('aim'); G.audio.play('arrow_draw', { pos: this.pos }); }
          else { this.shootCD = 0.6; this.want = Math.max(9, this.want - 3); }
        }
        break;
      }
      case 'aim': {
        const wind = this.elite ? 0.8 : 0.95, lockAt = wind - 0.32;
        const tip = this.bowTip();
        if (!this.line) this.line = G.vfx.beam('hush', { width: 0.02 });
        if (this.stateT < lockAt) {
          // track (with slight lead), then lock: the last moment is fixed and readable
          const tgt = G.player.center().addScaledVector(G.player.vel, 0.18);
          this.aimDir.subVectors(tgt, tip).normalize();
          this.facePlayer(dt, 12);
        } else {
          this.glintAt(lockAt, tip);
          this.line.width = 0.045 + Math.sin(G.time * 60) * 0.012;
        }
        this.draw = Math.min(1, this.stateT / lockAt);
        const t = G.world.terrain.raycast(tip, this.aimDir, 42);
        this.line.set(tip, tip.clone().addScaledVector(this.aimDir, t ?? 42));
        if (this.stateT > wind) { this.fire(tip); this.setState('loose'); }
        break;
      }
      case 'loose':
        if (this.stateT > 0.35) { this.shootCD = randRange(2.2, 3.4) * (this.elite ? 0.8 : 1); this.setState('chase'); }
        break;
      case 'return': {
        const dd = this.moveToward(this.home.x, this.home.z, this.def.speed * 1.2, dt);
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * dt * 0.3);
        if (dd < 1) { this.aggroed = false; this.setState('idle'); }
        if (canSee && d < this.def.aggro * 0.6 && this.stateT > 2) { this.aggroed = false; this.aggro(); }
        break;
      }
    }
  }
  fire(tip) {
    const mesh = new THREE.Mesh(getArrowGeo(), new THREE.MeshBasicMaterial({ color: PAL.hush.core.clone().multiplyScalar(1.3) }));
    mesh.position.copy(tip);
    G.scene.add(mesh);
    G.spells.projectile({ owner: 'enemy', el: 'hush', pos: tip, vel: this.aimDir.clone().multiplyScalar(this.elite ? 38 : 32), r: 0.3, life: 1.5, dmg: Math.max(1, Math.round(this.def.dmg * this.dmgMul)), mesh, trail: 'hush' });
    G.audio.play('arrow_loose', { pos: tip });
    G.vfx.burst(tip, 'trail', 6, { el: 'hush', spread: 0.2, size: 0.3 });
  }
  animState() {
    const aiming = this.state === 'aim' || (this.state === 'loose' && this.stateT < 0.2);
    let pitch = 0;
    if (aiming) pitch = -Math.asin(clamp(this.aimDir.y, -0.9, 0.9));
    return { speed: this.curSpeed || 0, grounded: !this.airborne, aim: aiming, draw: this.state === 'aim' ? this.draw : 0, aimPitch: pitch };
  }
}

// ------------------------------------------------------------------
// 뿌리손 — swims under the soil (untargetable), erupts beneath the player
// behind a ground telegraph, then stays up long enough to be punished.
// ------------------------------------------------------------------
let spikeGeo = null;
class RootHand extends Enemy {
  constructor(pos, level, opts) {
    super('rootHand', pos, level, { ...opts, state: 'buried' });
    this.emerge = 0; this.hittable = false; this.ghost = true;
    this.target = new THREE.Vector3(); this.slapCD = 0; this.rumbleT = 0; this.trailT = 0;
    this.yaw = 0;
  }
  receive(h) { if (!this.hittable) return 0; return super.receive(h); }
  aggro() {
    if (this.aggroed || !this.alive) return;
    this.aggroed = true;
    G.hud.alertMark(this);
    G.audio.play('burrow', { pos: this.pos, gap: 0.3 });
    if (this.state === 'buried' || this.state === 'return') this.setState('burrow');
    if (this.camp) for (const e of this.camp.members) if (e !== this && e.alive && !e.aggroed && e.pos.distanceTo(this.pos) < 20) G.later(() => e.aggro(), randRange(150, 500));
  }
  setBuried(b) { this.ghost = b; this.hittable = !b; if (b && G.player.lockTarget === this) G.player.lockTarget = null; }
  underground(dt, tx, tz, speed) {
    this.moveToward(tx, tz, speed, dt, false);
    this.curSpeed = 0;
    this.trailT -= dt;
    if (this.trailT <= 0) { this.trailT = 0.07; G.vfx.burst(this.pos, 'dust', 1, { speed: 1.5, size: 0.7, color: new THREE.Color(0.42, 0.34, 0.26) }); }
    this.rumbleT -= dt;
    if (this.rumbleT <= 0) { this.rumbleT = 0.8; G.audio.play('burrow', { pos: this.pos, d: 0.8 }); }
  }
  think(dt, mul) {
    const P = G.player;
    const d = this.dist2Player();
    const canSee = P.seen();
    this.slapCD -= dt;
    switch (this.state) {
      case 'buried':
      case 'idle':
        this.setBuried(true);
        this.emerge = damp(this.emerge, 0, 5, dt);
        if (canSee && d < this.def.aggro) this.aggro();
        break;
      case 'alert': this.setState('burrow'); break;
      case 'burrow': {
        this.setBuried(true);
        this.emerge = damp(this.emerge, 0, 6, dt);
        if (!canSee) { if (this.stateT > 2) this.setState('return'); break; }
        if (this.pos.distanceTo(this.home) > this.leash && d > 14) { this.aggroed = false; this.setState('return'); break; }
        this.underground(dt, P.pos.x, P.pos.z, this.def.speed * mul);
        if ((d < 2.6 && this.stateT > (this.dove ? 2.2 : 1.2)) || this.stateT > 5) {
          this.dove = false;
          // lock the eruption point (fair: the player sees it and can move)
          this.target.copy(P.pos).addScaledVector(tmp2.set(P.vel.x, 0, P.vel.z), 0.15);
          this.target.y = G.world.ground(this.target.x, this.target.z, P.pos.y + 1);
          this.windT = this.elite ? 0.8 : 0.95;
          this.tele = G.vfx.telegraph(this.target, 2.1, this.windT, 0xff5a2a);
          G.audio.play('burrow', { pos: this.target, d: 1 });
          this.setState('surfaceWind');
        }
        break;
      }
      case 'surfaceWind': {
        this.underground(dt, this.target.x, this.target.z, 12);
        if (rand() < 0.5) G.vfx.burst(tmp.set(this.target.x + randRange(-1.2, 1.2), this.target.y, this.target.z + randRange(-1.2, 1.2)), 'dust', 1, { speed: 2, size: 0.6, color: new THREE.Color(0.42, 0.34, 0.26) });
        this.glintAt(this.windT - 0.22, this.target.clone().setY(this.target.y + 0.6));
        if (d < 12) G.cameraRig.shake(0.02);
        if (this.stateT > this.windT) {
          this.pos.x = this.target.x; this.pos.z = this.target.z;
          this.setBuried(false);
          this.yaw = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
          this.erupt();
          this.setState('strike');
        }
        break;
      }
      case 'strike':
        this.emerge = Math.min(1, this.emerge + dt * 9);
        if (this.stateT > 0.35) this.setState('exposed');
        break;
      case 'exposed': {
        this.emerge = damp(this.emerge, 1, 8, dt);
        this.yaw = angleDamp(this.yaw, Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z), 2.5, dt);
        const stay = (this.elite ? 2.6 : 3.3) + (this.st.burn > 0 ? 2 : 0);
        if (canSee && d < 2.9 && this.slapCD <= 0) { this.setState('slapWind'); break; }
        if (this.stateT > stay && this.st.burn <= 0) { this.setState('dive'); G.audio.play('burrow', { pos: this.pos, d: 0.6 }); }
        break;
      }
      case 'slapWind':
        this.facePlayer(dt, 6);
        this.telegraph = true;
        this.glintAt(0.3, this.center().setY(this.pos.y + 2.1));
        if (this.stateT > 0.52) {
          this.telegraph = false;
          G.audio.play('enemy_swing', { pos: this.pos });
          if (this.playerInArc(3.1, 0.2)) this.hurtPlayer(this.def.dmg, 10);
          G.vfx.burst(this.center().addScaledVector(this.fwd(tmp2), 1.4), 'dust', 6, { speed: 4, size: 0.7 });
          this.slapCD = randRange(1.8, 2.8);
          this.setState('exposed');
          this.stateT = 1.2;
        }
        break;
      case 'dive':
        this.emerge = Math.max(0, this.emerge - dt * 2.2);
        if (rand() < 0.5) G.vfx.burst(this.pos, 'dust', 1, { speed: 3, size: 0.8, color: new THREE.Color(0.42, 0.34, 0.26) });
        if (this.emerge < 0.35) this.setBuried(true);
        if (this.emerge <= 0) { this.dove = true; this.setState('burrow'); }
        break;
      case 'return': {
        this.setBuried(true);
        this.emerge = damp(this.emerge, 0, 6, dt);
        this.underground(dt, this.home.x, this.home.z, this.def.speed);
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * dt * 0.3);
        if (this.pos.distanceTo(this.home) < 1) { this.aggroed = false; this.setState('buried'); }
        break;
      }
      case 'stagger': this.setBuried(false); break;
      default: this.setState(this.emerge > 0.5 ? 'dive' : 'burrow'); break; // chase / dodge / etc. from shared logic
    }
  }
  deathPose() { return { emerge: this.emerge }; }
  erupt() {
    const p = this.target;
    G.audio.play('root_burst', { pos: p });
    G.vfx.burst(p, 'dust', 26, { speed: 8, size: 1.3, color: new THREE.Color(0.48, 0.38, 0.28) });
    G.vfx.burst(p, 'hush', 6, { size: 0.9 });
    G.vfx.ring(p, PAL.hush.glow, 2.8, 0.35, { thick: 0.3 });
    G.cameraRig.shake(0.25);
    // ring of thorny roots stabbing upward
    if (!spikeGeo) { spikeGeo = new THREE.ConeGeometry(0.16, 1.6, 5); spikeGeo.translate(0, 0.8, 0); }
    const mat = toon(0x3a2c20, { rim: 0.5, flat: true });
    const spikes = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rand() * 0.4, r = randRange(0.9, 1.9);
      const m = new THREE.Mesh(spikeGeo, mat);
      m.position.set(p.x + Math.cos(a) * r, G.world.ground(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, p.y + 2) - 0.1, p.z + Math.sin(a) * r);
      m.rotation.set(Math.sin(a) * 0.35, rand() * 3, -Math.cos(a) * 0.35);
      m.scale.setScalar(0.01); m.castShadow = true;
      G.scene.add(m); spikes.push({ m, s: randRange(0.7, 1.25) });
    }
    G.vfx.timer(0.9, (dt, k) => {
      const g = k < 0.18 ? k / 0.18 : k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      for (const s of spikes) s.m.scale.set(s.s * Math.max(0.01, g), s.s * Math.max(0.01, g * (1.1 - 0.1 * g)), s.s * Math.max(0.01, g));
    }, () => { for (const s of spikes) G.scene.remove(s.m); });
    const P = G.player;
    const dd = Math.hypot(P.pos.x - p.x, P.pos.z - p.z);
    if (dd < 2.2 && P.pos.y - p.y < 2.4 && !P.dead) {
      // thrown up and away from the hand
      const dir = dd > 0.15 ? new THREE.Vector3(P.pos.x - p.x, 0, P.pos.z - p.z).normalize() : new THREE.Vector3(Math.sin(this.yaw + Math.PI), 0, Math.cos(this.yaw + Math.PI));
      const hp0 = P.hp;
      P.damage(Math.max(1, Math.round(this.def.dmg * this.dmgMul)), { dir, knock: 9, pos: p.clone() });
      if (P.hp < hp0) P.vel.y = Math.max(P.vel.y, 8);
    }
  }
  animState() {
    return { emerge: this.emerge, grip: this.state === 'slapWind' ? 0.9 : this.state === 'burrow' ? 0.8 : 0.3, strike: this.state === 'strike' || (this.state === 'slapWind' && this.stateT > 0.4) };
  }
  updateDying(dt) {
    this.emerge = Math.max(0.35, this.emerge - dt * 0.4);
    return super.updateDying(dt);
  }
}

// ------------------------------------------------------------------
// 망루지기 — mini-boss: a forgotten watchtower construct. Its eye paints a
// line, then sweeps a scorching beam; close in and it stomps. Hit the eye while
// it charges to stun it.
// ------------------------------------------------------------------
class Watcher extends Enemy {
  constructor(pos, level, opts) {
    super('watcher', pos, level, opts);
    this.headYaw = 0; this.beamCD = randRange(2, 3); this.stompCD = 2; this.charge = 0;
    this.sweep = null; this.line = null;
    this.bigDeath = true;
  }
  eyePos() { return this.rig.eyeTip.getWorldPosition(new THREE.Vector3()); }
  endBeams() { if (this.line) { this.line.done = true; this.line = null; } if (this.sweep) { this.sweep.b.done = true; this.sweep = null; } this.charge = 0; }
  setState(s) { if ((this.state === 'beamCharge' || this.state === 'beamSweep') && s !== 'beamSweep') this.endBeams(); super.setState(s); }
  die(h) { this.endBeams(); super.die(h); }
  remove() { this.endBeams(); super.remove(); }
  receive(h) {
    if (!this.alive) return 0;
    if (h.source === 'player' && h.pos && h.pos.distanceTo(this.eyePos()) < 1.0) {
      G.hud.floatText(this.eyePos(), '약점!', '#ffd86a');
      const dmg = G.combat.resolve(this, { ...h, dmg: h.dmg * 1.6 });
      if (this.alive && this.state === 'beamCharge') { this.endBeams(); this.stagger(2.6); G.audio.play('shatter', { pos: this.eyePos() }); }
      return dmg;
    }
    return G.combat.resolve(this, h);
  }
  onHit(h, dmg, reaction) {
    super.onHit(h, dmg, reaction);
    // poise stagger interrupts the beam
    if (this.state === 'stagger') this.endBeams();
  }
  relYaw(worldYaw) { return wrapAngle(worldYaw - this.yaw); }
  think(dt, mul) {
    const P = G.player;
    const d = this.dist2Player();
    const canSee = P.seen();
    const toP = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    this.beamCD -= dt; this.stompCD -= dt;
    switch (this.state) {
      case 'idle':
        this.headYaw = Math.sin(G.time * 0.6 + this.home.x) * 1.1;
        this.wanderT -= dt;
        if (this.wanderT <= 0) { this.wanderT = randRange(5, 9); this.wanderTo = new THREE.Vector3(this.home.x + randRange(-6, 6), 0, this.home.z + randRange(-6, 6)); }
        if (this.wanderTo && this.moveToward(this.wanderTo.x, this.wanderTo.z, 1.0 * mul, dt) < 0.5) this.wanderTo = null;
        if (canSee && d < this.def.aggro) this.aggro();
        break;
      case 'alert':
        this.headYaw = clamp(this.relYaw(toP), -1.6, 1.6);
        this.charge = Math.min(0.6, this.stateT);
        if (this.stateT > 1.0) { this.charge = 0; this.setState('chase'); }
        break;
      case 'chase': {
        if (!canSee) { if (this.stateT > 3) this.setState('return'); break; }
        if (this.pos.distanceTo(this.home) > this.leash && d > 18) { this.aggroed = false; this.setState('return'); break; }
        this.yaw = angleDamp(this.yaw, toP, 1.4, dt);
        this.headYaw = clamp(this.relYaw(toP), -1.6, 1.6);
        if (d > 14) this.moveToward(P.pos.x, P.pos.z, this.def.speed * mul, dt, false);
        else if (d < 7 && this.stompCD > 0) this.moveToward(this.pos.x - Math.sin(toP) * 3, this.pos.z - Math.cos(toP) * 3, this.def.speed * 0.8 * mul, dt, false);
        if (d < 5.5 && this.stompCD <= 0) {
          this.setState('stompWind');
          this.tele = G.vfx.telegraph(this.pos.clone().setY(G.world.ground(this.pos.x, this.pos.z)), 5, 0.95);
          G.audio.play('brute_roar', { pos: this.pos });
        } else if (this.beamCD <= 0 && d < 30 && d > 5) {
          this.setState('beamCharge');
          G.audio.play('sentinel_charge', { pos: this.pos, d: 1.3 });
        }
        break;
      }
      case 'beamCharge': {
        const wind = this.elite ? 1.1 : 1.3, lockAt = wind - 0.35;
        this.yaw = angleDamp(this.yaw, toP, 2, dt);
        this.charge = Math.min(1, this.stateT / wind);
        this.telegraph = this.stateT > lockAt;
        const eye = this.eyePos();
        if (!this.line) this.line = G.vfx.beam('gold', { width: 0.04 });
        if (this.stateT < lockAt) {
          this.headYaw = clamp(this.relYaw(toP), -1.6, 1.6);
          this.aimAt = P.pos.clone();
        } else this.glintAt(lockAt, eye, true);
        this.line.width = this.stateT < lockAt ? 0.04 : 0.08 + Math.sin(G.time * 60) * 0.03;
        this.line.set(eye, this.aimAt.clone().setY(G.world.ground(this.aimAt.x, this.aimAt.z, this.aimAt.y + 2) + 0.3));
        if (rand() < 0.6) G.vfx.burst(eye, 'trail', 1, { el: 'gold', spread: 0.3, size: 0.4 });
        if (this.stateT > wind) {
          if (this.line) { this.line.done = true; this.line = null; }
          const a0 = Math.atan2(this.aimAt.x - this.pos.x, this.aimAt.z - this.pos.z);
          const dir = rand() < 0.5 ? 1 : -1;
          this.sweep = { b: G.vfx.beam('gold', { width: 0.9 }), a0: a0 - dir * 0.75, a1: a0 + dir * 0.75, t: 0, dur: this.elite ? 1.4 : 1.8, hit: false, R: Math.max(12, Math.min(26, d + 8)), D: Math.max(4, Math.hypot(this.aimAt.x - this.pos.x, this.aimAt.z - this.pos.z)) };
          G.audio.play('beam', { pos: this.pos, d: this.sweep.dur });
          this.setState('beamSweep');
        }
        break;
      }
      case 'beamSweep': {
        const S = this.sweep;
        if (!S) { this.setState('chase'); break; }
        S.t += dt;
        const k = clamp(S.t / S.dur, 0, 1);
        const a = lerp(S.a0, S.a1, smooth(k));
        this.headYaw = clamp(this.relYaw(a), -1.9, 1.9);
        this.charge = 1;
        const eye = this.eyePos();
        let ex = this.pos.x + Math.sin(a) * S.R, ez = this.pos.z + Math.cos(a) * S.R;
        // slope the beam through waist height at the aimed range; the terrain march below cuts it where it meets the ground
        const ay = G.world.ground(this.pos.x + Math.sin(a) * S.D, this.pos.z + Math.cos(a) * S.D, eye.y + 5) + 0.75;
        const end = new THREE.Vector3(ex, eye.y + (ay - eye.y) * (S.R / S.D), ez);
        // walls and terrain block the beam: hiding behind cover works
        {
          const L = eye.distanceTo(end), n = Math.ceil(L / 0.8);
          for (let i = 3; i <= n; i++) {
            tmp.lerpVectors(eye, end, i / n);
            if (G.world.col.pointHit(tmp.x, tmp.y, tmp.z, 0.2) || tmp.y < G.world.h(tmp.x, tmp.z) - 0.05) { end.copy(tmp); ex = end.x; ez = end.z; break; }
          }
        }
        S.b.set(eye, end);
        // damage: player near the ground segment (jump/glide over it, blink through, or hide)
        const Pp = P.pos;
        const ax = this.pos.x, az = this.pos.z, dx = ex - ax, dz = ez - az;
        const tt = clamp(((Pp.x - ax) * dx + (Pp.z - az) * dz) / (dx * dx + dz * dz), 0, 1);
        const dd = Math.hypot(Pp.x - (ax + dx * tt), Pp.z - (az + dz * tt));
        const by = lerp(eye.y, end.y, tt) - Pp.y; // beam height relative to the player's feet
        if (!S.hit && dd < 1.0 && by > -0.35 && by < 1.9 && !P.dead) { S.hit = true; P.damage(Math.round(this.def.dmg * 1.4 * this.dmgMul), { dir: new THREE.Vector3(-dz, 0, dx).normalize(), knock: 9 }); if (!P.dodged) G.vfx.burst(P.center(), 'fire', 12, { speed: 4 }); }
        if (rand() < 0.9) G.vfx.burst(end, 'fire', 2, { speed: 2, size: 0.8 });
        if (rand() < 0.5) G.vfx.burst(end, 'ember', 2, { speed: 3 });
        if (rand() < 0.4) G.vfx.burst(tmp.set(ax + dx * rand(), end.y, az + dz * rand()), 'trail', 1, { el: 'gold', size: 0.6, spread: 0.3 });
        if (k >= 1) { S.b.done = true; this.sweep = null; this.charge = 0; this.beamCD = randRange(4.5, 6.5); this.setState('recover'); }
        break;
      }
      case 'stompWind':
        this.telegraph = true;
        this.glintAt(0.65, this.center().setY(this.pos.y + this.height * 0.9), true);
        if (this.stateT > 0.95) {
          this.telegraph = false;
          const p = this.pos.clone(); p.y = G.world.ground(p.x, p.z);
          G.audio.play('brute_slam', { pos: p }); G.audio.play('shockwave', { pos: p });
          G.vfx.burst(p, 'dust', 30, { speed: 10, size: 1.4 }); G.vfx.ring(p, PAL.gold.glow, 5.5, 0.5, { thick: 0.3 }); G.vfx.burst(p, 'hush', 8);
          const dd = Math.hypot(G.player.pos.x - p.x, G.player.pos.z - p.z);
          if (dd < 5 && G.player.pos.y - p.y < 1.5) this.hurtPlayer(this.def.dmg, 14);
          G.cameraRig.shake(clamp(0.7 - dd * 0.03, 0.1, 0.7));
          this.stompCD = randRange(3.5, 5);
          this.setState('recover');
        }
        break;
      case 'recover':
        if (this.stateT > 1.1) this.setState('chase');
        break;
      case 'return':
        if (this.moveToward(this.home.x, this.home.z, this.def.speed * 1.3, dt, true) < 1) { this.aggroed = false; this.setState('idle'); }
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * dt * 0.15);
        break;
    }
  }
  animState() {
    return {
      speed: this.curSpeed || 0, headYaw: this.headYaw, headK: this.state === 'beamSweep' ? 30 : 6,
      charge: this.charge, stomp: this.state === 'stompWind' ? smooth(clamp(this.stateT / 0.8, 0, 1)) : 0, stagger: this.state === 'stagger',
    };
  }
}

// ------------------------------------------------------------------
// Boss: the Ashen Knight (Kael's forgotten shadow)
// ------------------------------------------------------------------
class Knight extends Enemy {
  constructor(pos, level, opts) {
    super('knight', pos, level, { ...opts, leash: 999 });
    this.boss = true;
    this.phaseAt = [0.66, 0.33];
    this.cd = { combo: 0.5, dash: 3, wave: 6, bolts: 8 };
    this.combo = 0;
    this.state = 'dormant';
    this.summoned = false;
  }
  swordPoint() { const e = this.rig.p.swordEdge; return e ? e.getWorldPosition(new THREE.Vector3()) : this.center().setY(this.pos.y + this.height); }
  think(dt, mul) {
    const P = G.player;
    const d = this.dist2Player();
    for (const k in this.cd) this.cd[k] -= dt;
    // 66% → lightning bolts and a double shockwave; 33% → four-cut combo, double dash, bolts in two waves
    if (this.state !== 'dormant' && phaseCheck(this, this.phaseAt)) {
      if (G.story) G.story.onBossPhase(this, this.phase);
      G.audio.play('boss_roar', { pos: this.pos });
      G.vfx.ring(this.pos, PAL.storm.core, this.phase === 3 ? 14 : 10, 0.8, { thick: 0.3 });
      G.vfx.burst(this.center(), 'electric', 24, { speed: 9 });
      G.cameraRig.shake(0.3);
      this.cd.bolts = Math.min(this.cd.bolts, 2);
    }
    const P3 = this.phase >= 3, lastCut = P3 ? 3 : 2;
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
        else if (d > 6 && d < 16 && this.cd.dash <= 0) { this.dashLeft = P3 ? 2 : 1; this.setState('dashWind'); }
        else if (this.cd.wave <= 0 && d > 4) this.setState('waveWind');
        else if (this.phase >= 2 && this.cd.bolts <= 0) this.setState('boltsWind');
        break;
      }
      case 'slashWind': {
        const wind = (P3 ? [0.45, 0.3, 0.3, 0.62] : [0.5, 0.32, 0.62])[this.combo];
        this.facePlayer(dt, 10);
        this.telegraph = this.stateT > wind * 0.4;
        if (this.combo === lastCut) this.glintAt(wind - 0.22, this.swordPoint(), true);
        if (this.stateT > wind) {
          this.telegraph = false;
          this.slashing = true;
          G.audio.play('sword', { pos: this.pos });
          const f = this.fwd();
          this.pos.addScaledVector(f, 1.2);
          if (this.combo < lastCut) { if (this.playerInArc(3.4, 0.1)) this.hurtPlayer(this.def.dmg * 0.8, 7); }
          else {
            const p = this.pos.clone().addScaledVector(f, 2.2); p.y = G.world.ground(p.x, p.z, p.y + 3);
            G.vfx.ring(p, PAL.storm.glow, 4, 0.4, { thick: 0.3 }); G.vfx.burst(p, 'electric', 20, { speed: 8 }); G.vfx.burst(p, 'dust', 12, { speed: 6 });
            G.audio.play('impact_storm', { pos: p }); G.cameraRig.shake(0.35);
            if (G.player.pos.distanceTo(p) < 3.6) this.hurtPlayer(this.def.dmg * 1.5, 10);
            if (P3) this.shockwave(p, 9, 12);
          }
          this.setState('slash');
        }
        break;
      }
      case 'slash':
        if (this.stateT > 0.22) {
          this.slashing = false;
          this.combo++;
          if (this.combo <= lastCut) this.setState('slashWind');
          else { this.cd.combo = randRange(1.9, 2.9); this.setState('recover'); }
        }
        break;
      case 'dashWind':
        this.facePlayer(dt, 10);
        this.telegraph = true;
        const dw = this.dashLeft === 1 && P3 ? 0.42 : 0.6; // the follow-up dash comes quicker
        this.glintAt(dw - 0.22, this.swordPoint(), true);
        if (rand() < 0.5) G.vfx.burst(this.pos, 'electric', 1, { speed: 2, spread: 0.6 });
        if (this.stateT > dw) { this.telegraph = false; this.hitDone = false; this.setState('dash'); G.audio.play('sword', { pos: this.pos }); G.audio.play('blink'); G.vfx.burst(this.pos, 'dust', 10, { speed: 5 }); }
        break;
      case 'dash': {
        const f = this.fwd();
        this.pos.addScaledVector(f, 19 * dt * mul);
        this.slashing = true;
        G.vfx.burst(this.center(), 'trail', 3, { el: 'storm', spread: 0.6, size: 0.6 });
        // afterimage streak and scorched ground
        G.vfx.burst(this.center().setY(this.pos.y + this.height * 0.3), 'trail', 2, { el: 'hush', spread: 0.5, size: 0.8, life: 0.4 });
        if (rand() < 0.6) G.vfx.burst(this.pos, 'electric', 1, { speed: 3 });
        if (rand() < 0.5) G.vfx.burst(this.pos, 'dust', 1, { speed: 2 });
        if (!this.hitDone && d < 1.8) { this.hitDone = true; this.hurtPlayer(this.def.dmg * 1.25, 12); }
        if (this.stateT > 0.42) {
          this.slashing = false;
          if (--this.dashLeft > 0) this.setState('dashWind');
          else { this.cd.dash = randRange(4, 6); this.setState('recover'); }
        }
        break;
      }
      case 'waveWind':
        this.telegraph = true;
        if (this.stateT < 0.1) { G.vfx.telegraph(this.pos, 3, 0.9, 0xffd84a); G.audio.play('charge', { pos: this.pos }); }
        this.glintAt(0.68, this.swordPoint());
        if (this.stateT > 0.9) {
          this.telegraph = false;
          this.cd.wave = this.phase >= 2 ? 6 : 9;
          this.shockwave(this.pos.clone(), 18, 13);
          if (this.phase >= 2) this.followUp(() => this.shockwave(this.pos.clone(), 18, 13), 650);
          this.setState('recover');
        }
        break;
      case 'boltsWind':
        this.telegraph = true;
        if (this.stateT < 0.05) {
          this.boltPts = this.boltVolley(4);
          G.audio.play('charge', { pos: this.pos });
        }
        if (this.stateT > 0.9) {
          this.telegraph = false;
          this.boltStrike(this.boltPts);
          // last phase: a second volley lands where the player dodged to
          if (P3) this.followUp(() => { const pts = this.boltVolley(3); this.followUp(() => this.boltStrike(pts), 900); }, 250);
          this.cd.bolts = P3 ? 6 : 7;
          this.setState('recover');
        }
        break;
      case 'recover':
        if (this.stateT > (P3 ? 0.45 : this.phase === 2 ? 0.6 : 0.9)) this.setState('chase');
        break;
      case 'stagger': this.hittable = true; break;
    }
  }
  boltVolley(n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const p = G.player.pos.clone().add(new THREE.Vector3(i === 0 ? 0 : randRange(-5, 5), 0, i === 0 ? 0 : randRange(-5, 5)));
      p.y = G.world.ground(p.x, p.z, p.y + 3);
      pts.push(p); G.vfx.telegraph(p, 2.2, 0.9, 0xffd84a);
    }
    return pts;
  }
  boltStrike(pts) {
    for (const p of pts) {
      G.vfx.lightning(p.clone().setY(p.y + 28), p, { width: 0.35, dur: 0.3, branches: 2 });
      G.vfx.burst(p, 'electric', 16, { speed: 8 });
      if (G.player.pos.distanceTo(p) < 2.3) this.hurtPlayer(this.def.dmg, 6);
    }
    G.audio.play('thunder', { pos: pts[0] });
    G.cameraRig.shake(0.3);
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
      if (!hit && Math.abs(dd - r) < 0.9 && P.pos.y - G.world.ground(P.pos.x, P.pos.z) < 0.6) { hit = true; this.hurtPlayer(this.def.dmg, 8); }
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
  fire: { weak: 'frost', weak2: 'water', color: 0xff6a3a, name: '화염' },
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
    const weak = WARD[this.ward].weak, weak2 = WARD[this.ward].weak2;
    let mult = h.el === weak ? 3 : weak2 && h.el === weak2 ? 2.4 : h.el === 'arcane' ? 0.35 : 0.12;
    let dmg = Math.max(1, Math.round(h.dmg * mult));
    this.hp -= dmg; this.flash = 1; this.barT = 5;
    G.hud.damage(this.pos, dmg, h.el, false, null);
    if (mult < 1) { if (rand() < 0.4) G.hud.floatText(this.pos.clone().setY(this.pos.y + 0.8), `저항 — ${josa(({ fire: '화염', frost: '서리', storm: '번개', wind: '바람' })[weak], '이')} 필요하다`, '#c9c0d8', 'info'); G.audio.play('hit_armor', { pos: this.pos }); }
    else { G.audio.play('shatter', { pos: this.pos, gap: 0.1 }); G.vfx.burst(this.pos, 'spark', 12, { el: h.el }); G.hitstop = Math.max(G.hitstop, 0.05); G.cameraRig.shake(0.15); }
    // the right element on a ward also wears the heart down (break meter)
    if (mult >= 1 && h.source !== 'dot') this.heart.addBreak(4);
    if (this.hp <= 0) { this.die(); this.heart.addBreak(10); }
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
    this.maxHp = Math.round(1400 * (1 + 0.18 * (level - 1))); this.hp = this.maxHp;
    this.brk = newBreak(6); // drains slowly: ward hits between volleys count too
    this.phaseMul = 1; this.phaseAt = [0.66, 0.33];
    this.atkGen = 0; // bumped by a collapse to cancel queued orbs and shockwaves
    this.alive = true; this.hittable = false; this.radius = 1.9; this.height = 3;
    this.st = newStatus(); this.resist = {}; this.armor = 0; this.freezeAt = 10; this.freezeTime = 1.5;
    this.pos = center.clone().setY(center.y + 6); this.home = this.pos.clone();
    this.core = new THREE.Group();
    // dark faceted heart-stone with a violet core that burns brighter when exposed
    const crystal = new THREE.Mesh(crystalGeometry('gem', { sides: 7, table: 0.5, crown: 0.62, pavilion: 0.95, seed: 66 }), crystalMaterial({ color: 0x3a2458, glow: 0xb080ff, intensity: 1.2, rim: 1.3, seed: 5, nocache: true }));
    crystal.scale.set(1.6, 1.9, 1.6); crystal.rotation.x = Math.PI;
    this.core.add(crystal);
    // shards orbiting the heart (spun by `inner`) and a soft violet halo
    const inner = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const sh = new THREE.Mesh(crystalGeometry('shard', { seed: 700 + i }), crystal.material);
      sh.scale.setScalar(0.45 + (i % 3) * 0.12);
      sh.position.set(Math.cos(a) * 2.5, (i % 2 ? 0.5 : -0.6), Math.sin(a) * 2.5);
      sh.rotation.set(Math.PI + (i % 2 ? 0.4 : -0.3), a, (i % 2 ? 0.3 : -0.4));
      inner.add(sh);
    }
    this.core.add(inner);
    this.core.add(crystalGlowSprite(0xa070ff, 9, { intensity: 0.4 }));
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
  onHit(h, dmg, reaction) {
    this.flash = 1;
    if (breakFromHit(this, h, dmg, reaction)) this.collapse();
  }
  addBreak(v) { if (addBreak(this, v)) this.collapse(); }
  // Collapse: any wards left shatter at once, and the heart sinks low and stays exposed longer.
  collapse() {
    this.atkGen++;
    const wasExposed = this.exposed > 0;
    for (const p of this.plates) if (p.alive) p.die();
    this.plates = [];
    if (!wasExposed) this.expose();
    this.exposed += BREAK.down;
    collapseFx(this, this.core.position);
  }
  expose() {
    this.exposed = 11.5;
    G.hud.floatText(this.core.position, '심장이 드러났다!', '#ffd86a');
    G.audio.play('shatter', { pos: this.core.position });
    G.vfx.ring(this.center0, PAL.hush.core, 12, 1, { thick: 0.2 });
    if (G.story) G.story.onHeartExposed();
  }
  die() {
    this.alive = false; this.hittable = false;
    for (const b of this.beams) b.done = true;
    for (const p of this.plates) p.remove();
    if (G.story) G.story.onKill(this);
  }
  spawnPlates() {
    const pool = ['fire', 'frost', 'storm', 'wind'];
    const n = this.phase === 3 ? 4 : 3;
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
    const cu = this.crystal.material.uniforms;
    cu.uIntensity.value = 1.2 + this.flash * 0.8 + (this.exposed > 0 ? 0.9 + Math.sin(G.time * 10) * 0.4 : 0);
    cu.uFlash.value = this.flash * 0.6;
    this.inner.rotation.y += dt * 0.9;
    this.crystal.rotation.y -= dt * 0.4;
    this.tendrils.forEach((t, i) => {
      const a = t.userData.a + this.spin * 0.3;
      t.position.set(Math.cos(a) * 2.2, -1 + Math.sin(G.time * 2 + i) * 0.3, Math.sin(a) * 2.2);
      t.rotation.set(Math.PI + Math.sin(G.time * 1.3 + i) * 0.4, 0, Math.cos(a) * 0.5);
    });
    this.core.scale.setScalar(breathe);
    G.combat.tick(this, dt);
    tickBreak(this, dt);
    if (this.state === 'dormant') { this.core.position.y = this.pos.y + Math.sin(G.time) * 0.3; return true; }
    // phase checks
    const frac = this.hp / this.maxHp;
    const want = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
    if (want > this.phase) { this.phase = want; this.phaseMul = PHASE_DMG[want - 1]; G.enemies.bossSpill(this.core.position, 'phase'); if (G.story) G.story.onBossPhase(this, want); G.audio.play('boss_roar', { pos: this.core.position }); }
    // plates / exposure cycle
    this.plates = this.plates.filter((p) => p.update(dt));
    if (this.exposed > 0) {
      this.exposed -= dt;
      this.hittable = true; this.vulnerable = true;
      this.core.position.y = damp(this.core.position.y, this.center0.y + (this.brk.down > 0 ? 1.4 : 2.6), 3, dt);
      if (this.exposed <= 0) { this.hittable = false; this.vulnerable = false; this.spawnPlates(); }
    } else {
      this.core.position.y = damp(this.core.position.y, this.pos.y + Math.sin(G.time) * 0.3, 2, dt);
      this.hittable = false;
      if (this.plates.length === 0) this.expose();
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
    const gen = this.atkGen;
    const c = this.core.position.clone();
    const n = 6 + this.phase * 2;
    G.audio.play('wailer_charge', { pos: c });
    for (let i = 0; i < n; i++) {
      G.later(() => {
        if (!this.alive || gen !== this.atkGen) return;
        const toP = G.player.center().sub(c).normalize();
        const a = (i / n) * Math.PI * 2;
        const side = new THREE.Vector3(Math.cos(a), 0.3, Math.sin(a)).multiplyScalar(0.8);
        const dir = toP.clone().add(side).normalize();
        G.spells.enemyOrb(c.clone().addScaledVector(dir, 2), dir, { speed: 9 + this.phase, dmg: Math.round(2 * (1 + 0.12 * (this.level - 1)) * this.phaseMul), homing: G.player, homingRate: 1.1, size: 0.35 });
        G.audio.play('wailer_shot', { pos: c, gap: 0.03 });
      }, i * 90);
    }
  }
  wave() {
    const gen = this.atkGen;
    const c = this.center0.clone();
    const n = this.phase >= 2 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      G.later(() => {
        if (!this.alive || gen !== this.atkGen) return;
        G.vfx.telegraph(c, 4, 0.7, 0xb080ff);
        G.later(() => {
          if (!this.alive || gen !== this.atkGen) return;
          G.audio.play('shockwave', { pos: c }); G.cameraRig.shake(0.35);
          let r = 2, hit = false;
          const maxR = 34, sp = 12;
          G.vfx.ring(c, PAL.hush.core, maxR, maxR / sp, { thick: 0.04, r0: 2 });
          G.vfx.timer(maxR / sp, (dt) => {
            r += sp * dt;
            const P = G.player;
            const dd = Math.hypot(P.pos.x - c.x, P.pos.z - c.z);
            if (!hit && Math.abs(dd - r) < 1 && P.pos.y - G.world.ground(P.pos.x, P.pos.z) < 0.6) { hit = true; P.damage(Math.round(4 * (1 + 0.12 * (this.level - 1)) * this.phaseMul), { dir: new THREE.Vector3(P.pos.x - c.x, 0, P.pos.z - c.z).normalize(), knock: 8 }); }
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
            if (dd < 1.1 && !airborne && tt > 0.08) P.damage(Math.round(3 * (1 + 0.12 * (this.level - 1)) * this.phaseMul), { dir: new THREE.Vector3(-dz, 0, dx).normalize(), knock: 8 });
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
  { id: 'northroad', x: -6, z: -58, units: ['ashling', 'ashling', 'shield', 'wailer'], gate: 'world' },
  { id: 'frostpass', x: -30, z: -118, units: ['ashlingFrost', 'ashlingFrost', 'oozeFrost'], gate: 'world' },
  { id: 'frostridge', x: -62, z: -128, units: ['ashlingFrost', 'bruteFrost'], gate: 'world' },
  { id: 'westroad', x: -120, z: 4, units: ['ashling', 'oozeFire', 'wailer'], gate: 'world' },
  { id: 'plateau', x: -146, z: -58, units: ['brute', 'shield', 'moth', 'moth', 'moth'], gate: 'world' },
  { id: 'riftroad', x: 66, z: -48, units: ['ashling', 'ashling', 'archer', 'oozeFire'], gate: 'world' },
  { id: 'riftgate', x: 98, z: -88, units: ['brute', 'wailer', 'archer', 'moth', 'moth'], gate: 'world' },
  { id: 'nehills', x: 58, z: -8, units: ['wailer', 'wailer', 'oozeFrost'], gate: 'world' },
  { id: 'woods', x: -84, z: 118, units: ['moth', 'moth', 'moth', 'moth', 'ooze'], gate: 'world' },
  // overhaul camps
  { id: 'lakeshore', x: -46, z: 76, units: ['oozeWater', 'oozeWater', 'ashling'], gate: 'world' },
  { id: 'lakesouth', x: -92, z: 100, units: ['oozeWater', 'ooze', 'archer'], gate: 'world' },
  { id: 'meadowroots', x: 84, z: 72, units: ['rootHand', 'rootHand', 'ooze'], gate: 'world' },
  { id: 'woodroots', x: -60, z: 132, units: ['rootHand', 'moth', 'moth'], gate: 'world' },
  { id: 'stormroad', x: -86, z: -8, units: ['shield', 'archer', 'ashling'], gate: 'world' },
  { id: 'frostwatch', x: -2, z: -92, units: ['archer', 'archer', 'ashlingFrost'], gate: 'world' },
  { id: 'bluffwatch', x: 138, z: -12, units: ['watcher'], names: ['빛을 잃은 망루지기'], gate: 'world' },
  { id: 'eliteWoods', x: -118, z: 150, units: ['brute'], names: ['뿌리 삼킨 돌무덤'], elite: true, gate: 'bounty', bounty: 1 },
  { id: 'eliteBluffs', x: 156, z: 30, units: ['wailer', 'wailer', 'wailer'], names: ['세 자매 울음탈 · 첫째', '세 자매 울음탈 · 둘째', '세 자매 울음탈 · 막내'], elite: true, gate: 'bounty', bounty: 2 },
  { id: 'eliteNorth', x: 40, z: -150, units: ['bruteFrost', 'ashlingFrost'], names: ['눈먼 파수꾼', null], elite: true, gate: 'bounty', bounty: 3 },
];

const tmpP = new THREE.Vector3(), side = new THREE.Vector3();
export class EnemyManager {
  constructor() {
    this.list = [];
    this.bosses = [];
    this.tokens = 0; this.maxTokens = 2;
    this.lastShot = -99;
    this.lastGlint = null; // { t, e, pos } — most recent dangerous-attack glint
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
    else if (type === 'shield') e = new ShieldBearer(pos, level, opts);
    else if (type === 'archer') e = new Archer(pos, level, opts);
    else if (type === 'rootHand') e = new RootHand(pos, level, opts);
    else if (type === 'watcher') e = new Watcher(pos, level, opts);
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
    for (const e of this.list) if (e.alive && e.aggroed && e.state !== 'return' && e.state !== 'idle' && e.state !== 'buried') return true;
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
    G.later(() => {
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

  // Mana motes: normal 3 × 5, heavies (brute/watcher/boss) 5 × 6, elites 6 × 6.
  // They burst out, hover for a beat, then home in on an accelerating curve.
  drop(pos, e) {
    const heavy = e.base === 'brute' || e.type === 'watcher' || e.boss;
    const [n, v] = e.elite ? [6, 6] : heavy ? [5, 6] : [3, 5];
    for (let i = 0; i < n; i++) this.pickups.push(this.makePickup(pos, 'mana', { v, i, n }));
    if (rand() < (e.elite || e.type === 'watcher' ? 0.8 : 0.25)) this.pickups.push(this.makePickup(pos, 'heal'));
  }
  // A little relief in a long fight: a boss entering a new phase lets fall a heart and a few
  // mana motes, a collapse (break gauge) a few motes. Kept small on purpose.
  bossSpill(pos, kind) {
    const n = kind === 'phase' ? 4 : 3;
    for (let i = 0; i < n; i++) this.pickups.push(this.makePickup(pos, 'mana', { v: 6, i, n }));
    if (kind === 'phase') this.pickups.push(this.makePickup(pos, 'heal'));
  }
  makePickup(pos, kind, o = {}) {
    if (kind === 'mana') {
      const m = G.vfx.acquireOrb('frost', 0.075, { halo: 0.62, haloI: 0.7 });
      m.position.copy(pos);
      const a = ((o.i || 0) / (o.n || 1)) * Math.PI * 2 + randRange(-0.4, 0.4), sp = randRange(3.2, 5.2);
      const v = new THREE.Vector3(Math.cos(a) * sp, randRange(3.2, 5.4), Math.sin(a) * sp);
      const live = this.pickups.filter((p) => p.rib).length;
      const rib = live < 12 && G.vfx.ribbon ? G.vfx.ribbon({ el: 'frost', width: 0.075, life: 0.24, follow: m.position }) : null;
      // hover a little longer for later motes so they stream in one after another
      return { m, kind, v, t: 0, val: o.v || 5, rib, home: 0.55 + (o.i || 0) * 0.07 + randRange(0, 0.08), ph: rand() * 6.28, orb: true };
    }
    const m = new THREE.Mesh(G.vfx.orbGeo, glowMat(0x7aff8a, 2.2));
    m.scale.setScalar(0.2);
    m.position.copy(pos);
    G.scene.add(m);
    const v = new THREE.Vector3(randRange(-3, 3), randRange(3, 6), randRange(-3, 3));
    return { m, kind, v, t: 0, home: 0.6, ph: 0 };
  }
  removePickup(i) {
    const p = this.pickups[i];
    if (p.rib) p.rib.release();
    if (p.orb) G.vfx.releaseOrb(p.m); else G.scene.remove(p.m);
    this.pickups.splice(i, 1);
  }
  absorbPickup(p, pc) {
    const P = G.player;
    if (p.kind === 'heal') { P.heal(2); G.audio.play('heal'); G.hud.floatText(pc, '+♥', '#8fff9a', 'heal'); return; }
    // streak of motes → rising pitch
    this.moteN = G.realTime - (this.moteT || -9) < 0.45 ? Math.min(12, (this.moteN || 0) + 1) : 0;
    this.moteT = G.realTime;
    P.gainMana(p.val, { src: 'orb', n: this.moteN });
    if (G.audio.S && G.audio.S.mana_orb) G.audio.play('mana_orb', { n: this.moteN, gap: 0.03 });
    else G.audio.play('pickup', { gap: 0.05 });
    G.vfx.burst(pc, 'star', 1, { el: 'frost', size: 0.9, size1: 0.1, life: 0.16 });
    G.vfx.burst(pc, 'trail', 3, { el: 'frost', spread: 0.35, size: 0.18, life: 0.3 });
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
    // pickups: burst out → hover → accelerate home
    const P = G.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      const pc = P.center();
      const pos = p.m.position;
      const d = pos.distanceTo(pc);
      const gy = G.world.ground(pos.x, pos.z, pos.y) + 0.55;
      if (p.t < 0.32) {
        // burst out
        p.v.y -= 9 * dt; p.v.multiplyScalar(1 - dt * 2.2);
        if (pos.y < gy) { pos.y = gy; p.v.y = Math.abs(p.v.y) * 0.3; }
      } else if (p.t < p.home || d > 26 || P.dead) {
        // hover / wait: drift to a gentle bob above the ground
        p.v.multiplyScalar(Math.max(0, 1 - dt * 6));
        const ty = Math.max(gy, pos.y) + Math.sin(G.time * 3 + p.ph) * 0.12;
        pos.y += (ty - pos.y) * Math.min(1, dt * 4);
      } else {
        // home in on an accelerating, slightly curving path
        const k = p.t - p.home;
        const sp = Math.min(34, 3 + k * k * 70 + k * 10);
        const dir = tmpP.subVectors(pc, pos).normalize();
        side.set(-dir.z, 0.35, dir.x).multiplyScalar(Math.max(0, 1 - k * 2.5) * Math.sin(p.ph) * sp * 0.6);
        p.v.lerp(dir.multiplyScalar(sp).add(side), Math.min(1, dt * (4 + k * 18)));
      }
      pos.addScaledVector(p.v, dt);
      if (p.orb) {
        const pulse = 1 + Math.sin(G.time * 14 + p.ph) * 0.18;
        p.m.scale.setScalar(0.075 * pulse * (p.t < 0.12 ? p.t / 0.12 : 1));
        if (Math.random() < dt * 14) G.vfx.burst(pos, 'trail', 1, { el: 'frost', size: 0.16, spread: 0.05, life: 0.3 });
        if (!p.rib && Math.random() < dt * 4) G.vfx.burst(pos, 'star', 1, { el: 'frost', size: 0.35, size1: 0.02, life: 0.2 });
      } else if (Math.random() < dt * 10) G.vfx.burst(pos, 'trail', 1, { el: 'heal', size: 0.2 });
      const got = p.t > p.home && d < 0.85;
      if (got || p.t > 25) {
        if (got) this.absorbPickup(p, pc);
        this.removePickup(i);
      }
    }
  }
}
