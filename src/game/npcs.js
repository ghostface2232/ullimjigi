// NPCs and the Boreum companion.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { makeHumanoid, makeFox, makeCat, makeGhost, CHAR } from './characters.js';
import { damp, angleDamp, randRange, rand, pick, wrapAngle, clamp } from '../core/util.js';

export const SPEAKERS = {
  mora: { name: '모라', voice: { f: 250, type: 'triangle', formant: 950, d: 0.065, v: 0.085, slide: 0.94 } },
  boreum: { name: '보름', voice: { f: 760, type: 'sine', formant: 2300, d: 0.04, v: 0.07, slide: 1.12 } },
  bau: { name: '바우 영감', voice: { f: 120, type: 'sawtooth', formant: 620, d: 0.075, v: 0.07, slide: 0.9 } },
  dodam: { name: '도담', voice: { f: 560, type: 'square', formant: 1900, d: 0.032, v: 0.045, slide: 1.06 } },
  isol: { name: '이솔', voice: { f: 390, type: 'triangle', formant: 1500, d: 0.042, v: 0.07, slide: 1.0 } },
  danbi: { name: '단비 아주머니', voice: { f: 310, type: 'triangle', formant: 1150, d: 0.055, v: 0.08, slide: 0.97 } },
  kael: { name: '카엘', voice: { f: 140, type: 'sawtooth', formant: 720, d: 0.085, v: 0.06, slide: 0.95 } },
  kaelShadow: { name: '잿빛 기사', voice: { f: 95, type: 'sawtooth', formant: 420, d: 0.1, v: 0.06, slide: 0.8 } },
  seha: { name: '세하', voice: { f: 440, type: 'sine', formant: 1650, d: 0.05, v: 0.075, slide: 1.02 } },
  hush: { name: '고요', voice: { f: 80, type: 'sawtooth', formant: 380, d: 0.12, v: 0.05, slide: 0.85 } },
  villager: { name: '마을 사람', voice: { f: 280, type: 'triangle', formant: 1000, d: 0.05, v: 0.07 } },
  farmer: { name: '농부 달구', voice: { f: 200, type: 'triangle', formant: 800, d: 0.06, v: 0.07 } },
  fisher: { name: '어부 소라', voice: { f: 360, type: 'triangle', formant: 1300, d: 0.05, v: 0.07 } },
  elder: { name: '장기 두는 할아버지', voice: { f: 170, type: 'sawtooth', formant: 700, d: 0.07, v: 0.06 } },
  narr: { name: '', voice: null },
  sign: { name: '', voice: null },
  player: { name: '{n}', voice: { f: 340, type: 'triangle', formant: 1200, d: 0.05, v: 0.06 } },
};

export class NPC {
  constructor(id, charKey, x, z, yaw = 0, opts = {}) {
    this.id = id;
    this.speaker = opts.speaker || id;
    this.rig = opts.rig || makeHumanoid(CHAR[charKey]);
    this.root = this.rig.root;
    this.root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) o.castShadow = true; });
    G.scene.add(this.root);
    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = yaw; this.homeYaw = yaw;
    this.onTalk = null;
    this.barks = [];
    this.barkT = randRange(3, 10);
    this.walkTarget = null; this.walkRes = null;
    this.speed = 0;
    this.talking = false;
    this.visible = true;
    this.pose = {};
    this.float = opts.float || 0;
    this.headH = opts.headH ?? 1.75 * (CHAR[charKey]?.scale ?? 1);
    this.snap();
  }
  snap() { this.pos.y = G.world.ground(this.pos.x, this.pos.z, this.pos.y + 2) + this.float; this.root.position.copy(this.pos); this.root.rotation.y = this.yaw; }
  setPos(x, z, yaw) { this.pos.set(x, 0, z); if (yaw !== undefined) { this.yaw = yaw; this.homeYaw = yaw; } this.walkTarget = null; this.snap(); }
  show(v) { this.visible = v; this.root.visible = v; }
  headPos() { return new THREE.Vector3(this.pos.x, this.pos.y + this.headH, this.pos.z); }
  walkTo(x, z, speed = 2.2) {
    this.walkTarget = new THREE.Vector3(x, 0, z); this.walkSpeed = speed;
    return new Promise((res) => { this.walkRes = res; });
  }
  update(dt) {
    if (!this.visible) return;
    const P = G.player;
    const far = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    const lod = far < 95 || this.talking;
    if (this.root.visible !== lod) this.root.visible = lod;
    if (!lod) return;
    const ol = far < 22;
    if (this._ol !== ol) { this._ol = ol; this.root.traverse((o) => { if (o.userData.isOutline) o.visible = ol; }); }
    this.speed = 0;
    if (this.walkTarget) {
      const dx = this.walkTarget.x - this.pos.x, dz = this.walkTarget.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) { this.walkTarget = null; this.homeYaw = this.yaw; const r = this.walkRes; this.walkRes = null; r && r(); }
      else {
        const s = Math.min(d, this.walkSpeed * dt);
        this.pos.x += (dx / d) * s; this.pos.z += (dz / d) * s;
        this.yaw = angleDamp(this.yaw, Math.atan2(dx, dz), 8, dt);
        this.speed = this.walkSpeed;
      }
    }
    this.pos.y = damp(this.pos.y, G.world.ground(this.pos.x, this.pos.z, this.pos.y + 2) + this.float, 12, dt);
    const dp = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    // look at player when close
    const toP = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    if (!this.walkTarget) {
      if (this.talking) this.yaw = angleDamp(this.yaw, toP, 4, dt);
      else if (!this.pose.sit) this.yaw = angleDamp(this.yaw, this.homeYaw, 2, dt);
    }
    const rel = wrapAngle(toP - this.yaw);
    const look = (dp < 7 || this.talking) && Math.abs(rel) < 1.9 ? rel : 0;
    if (this.rig.lookYaw !== undefined) { this.rig.lookYaw = clamp(look, -1, 1); this.rig.lookPitch = dp < 7 ? -0.05 : 0; }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.rig.update(dt, { speed: this.speed, grounded: true, talk: this.talking, sit: this.pose.sit, wave: this.pose.wave, kneel: this.pose.kneel, lookYaw: look });
    // ambient barks
    this.barkT -= dt;
    if (this.barks.length && this.barkT <= 0 && dp < 8 && G.mode === 'free' && !G.enemies.inCombat()) {
      this.barkT = randRange(18, 32);
      G.hud.bark(this, typeof this.barks === 'function' ? this.barks() : pick(this.barks));
    }
  }
}

// ------------------------------------------------------------------
export class Companion {
  constructor() {
    this.rig = makeFox();
    this.root = this.rig.root;
    G.scene.add(this.root);
    this.pos = new THREE.Vector3();
    this.active = false;
    this.root.visible = false;
    this.chatT = 90;
    this.said = new Set();
    this.yaw = 0;
    this.override = null; // position override for cutscenes
    this.speaker = 'boreum';
    this.talking = false;
    this.lineQueue = [];
  }
  show(v) { this.active = v; this.root.visible = v; }
  headPos() { return this.pos.clone().add(new THREE.Vector3(0, 0.3, 0)); }
  place(p) { this.pos.copy(p); this.root.position.copy(p); }
  update(dt) {
    if (!this.active) return;
    const P = G.player;
    let target;
    const other = G.dialogue && G.dialogue.active ? G.dialogue.lastOther : null;
    if (this.override) target = this.override;
    else if (other && other !== this && !this.talking && G.mode !== 'free') {
      // in conversation: step aside to the player's outer side, away from the over-the-shoulder camera
      const dx = other.pos.x - P.pos.x, dz = other.pos.z - P.pos.z, dl = Math.hypot(dx, dz) || 1;
      target = new THREE.Vector3(P.pos.x - (dz / dl) * 1.5 - (dx / dl) * 0.4, P.pos.y + 1.7 + Math.sin(G.time * 1.4) * 0.1, P.pos.z + (dx / dl) * 1.5 - (dz / dl) * 0.4);
    } else {
      const cr = G.cameraRig;
      const bx = Math.sin(P.yaw), bz = Math.cos(P.yaw);
      const rx = Math.cos(cr.yaw), rz = -Math.sin(cr.yaw);
      target = new THREE.Vector3(P.pos.x - rx * 1.1 - bx * 0.6, P.pos.y + 1.9 + Math.sin(G.time * 1.4) * 0.15, P.pos.z - rz * 1.1 - bz * 0.6);
      if (P.gliding) target.y += 0.6;
    }
    const k = this.override ? 3 : 4.5;
    this.pos.x = damp(this.pos.x, target.x, k, dt);
    this.pos.y = damp(this.pos.y, target.y, k, dt);
    this.pos.z = damp(this.pos.z, target.z, k, dt);
    const d = Math.hypot(this.pos.x - P.pos.x, this.pos.z - P.pos.z);
    if (d > 25) this.pos.copy(target);
    const face = this.talking ? Math.atan2(G.camera.position.x - this.pos.x, G.camera.position.z - this.pos.z) : Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z) * 0 + P.yaw;
    this.yaw = angleDamp(this.yaw, face, 3, dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.rig.update(dt, { talk: this.talking });
    if (Math.random() < dt * 6) G.vfx.burst(this.pos.clone().add(new THREE.Vector3(0, -0.1, -0.3)), 'trail', 1, { el: 'wind', size: 0.18, spread: 0.2, life: 0.6 });
    // idle chatter
    if (G.mode === 'free' && !G.enemies.inCombat()) {
      this.chatT -= dt;
      if (this.chatT <= 0) { this.chatT = randRange(80, 140); const l = G.story && G.story.companionChatter(); if (l) this.say(l); }
    }
  }
  say(text, once = null, dur) {
    if (!this.active) return;
    if (once) {
      // persisted through the story so one-time lines don't repeat after loading a save
      if (G.story) { if (!G.story.once('c:' + once)) return; } else if (this.said.has(once)) return;
      this.said.add(once);
    }
    G.hud.companion(text, dur);
    G.audio.play('fox', { gap: 1 });
  }
}

export class NPCs {
  constructor() { this.list = []; this.map = {}; }
  add(npc) { this.list.push(npc); this.map[npc.id] = npc; return npc; }
  get(id) { return this.map[id]; }
  update(dt) { for (const n of this.list) n.update(dt); }
}

export { makeCat, makeGhost };
