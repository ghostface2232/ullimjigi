// Trials (phase 0 of docs/EXPANSION.md): one mechanism per place, taught, then
// twisted, then combined. Built only from systems the world already has.
//   노래하는 돌 (singing stones): play back the phrases the stones sing by striking
//     them with any spell. Teach: the stones light as they sing. Twist: they only
//     sing (taller stone = higher note, and the sound comes from the stone). Combine:
//     both phrases in a row, and the tallest stone is frozen until melted.
//   들불 오르기 (ember climb): smooth basalt lookouts nobody can climb. Teach: burn
//     the grass and ride the heat up. Twist: the next post is too tall for heat or a
//     wind leap alone, so leap at the top of the heat. Combine: the last lookout is
//     out of reach from the ground (it stands in a stone yard where nothing burns);
//     leap and glide to it from the post before.
// Finished trials are story flags `trial_<id>` and give a resonance point.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { toon } from '../render/materials.js';
import { crystalGeometry, crystalMaterial } from '../render/crystal.js';
import { TAU, mulberry32 } from '../core/util.js';
import * as B from './buildings.js';

const tmp = new THREE.Vector3();
const XP = 80;

function banner(name, sub) { G.hud.banner('시련', name, sub, '#f1d48a', 4200); }
// Rewards are granted in the same step as the flag (which marks the story for saving),
// so an auto-save can never keep the completion without them. Only the banner waits.
function finishTrial(id, name, pos) {
  G.skills.gain(1, '시련을 마쳤다');
  G.player.addXP(XP);
  G.story && G.story.set('trial_' + id);
  G.audio.play('quest_done');
  G.vfx.burst(pos, 'soul', 40, { el: 'fire' });
  G.vfx.ring(pos, new THREE.Color(2.2, 1.7, 0.7), 6, 0.8, { thick: 0.18 });
  G.later(() => G.hud.banner('시련', `${name} — 마침`, '울림이 깊어졌다', '#f1d48a', 4200), 700);
}

// ---------------------------------------------------------------- singing stones
const PHRASES = [[69, 74, 76, 78], [76, 74, 71], [69, 74, 76, 78, 76, 74, 71]];
const STONES = [74, 69, 78, 71, 76];          // around the ring (heights give the pitch away)
const HEIGHT = { 69: 1.6, 71: 2.0, 74: 2.5, 76: 2.9, 78: 3.3 };
const GAP = 0.62;                              // seconds between sung notes
const RUNE_IDLE = new THREE.Color(0.22, 0.2, 0.3), RUNE_LIT = new THREE.Color(2.4, 1.9, 0.9), RUNE_DONE = new THREE.Color(1.5, 1.2, 0.55);

class SingingStones {
  constructor(W, x, z) {
    this.W = W; this.x = x; this.z = z; this.y = W.h(x, z);
    this.id = 'stones'; this.name = '노래하는 돌';
    this.stage = 0; this.k = 0; this.singing = 0; this.started = false; this.done = false; this.lastHit = -9; this.away = 0;
    this.stones = [];
    this.build();
  }
  build() {
    const W = this.W, rnd = mulberry32(5);
    W.props.clear(this.x, this.z, 12);
    // central stone with a resting crystal and three stage lamps
    const ped = new THREE.Group(); ped.userData.noBake = true;
    B.cyl(1.0, 1.2, 0.5, 8, B.MAT.ruin, 0, 0.25, 0, ped);
    B.cyl(0.55, 0.7, 0.6, 8, B.MAT.stone, 0, 0.8, 0, ped);
    const cmat = crystalMaterial({ color: 0xf0e0b0, glow: 0xffd070, intensity: 0.5, nocache: true });
    const crystal = new THREE.Mesh(crystalGeometry('gem', { seed: 8 }), cmat); crystal.scale.setScalar(0.3); crystal.position.y = 1.5; ped.add(crystal);
    this.lamps = [0, 1, 2].map((i) => {
      const a = (i / 3) * TAU + 0.5;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: RUNE_IDLE.clone() }));
      m.position.set(Math.cos(a) * 0.85, 0.55, Math.sin(a) * 0.85); ped.add(m);
      return m;
    });
    W.place(ped, this.x, this.z);
    W.col.addCircle(this.x, this.z, 1.1, -10, this.y + 1.1);
    this.ped = ped; this.crystal = crystal; this.cmat = cmat;
    // five standing stones, each with a rune band that lights when it rings
    STONES.forEach((m, i) => {
      const a = (i / STONES.length) * TAU - Math.PI / 2;
      const sx = this.x + Math.cos(a) * 6.5, sz = this.z + Math.sin(a) * 6.5, h = HEIGHT[m];
      const g = new THREE.Group(); g.userData.noBake = true;
      B.box(0.9, h, 0.55, B.MAT.ruin, 0, h / 2, 0, g, { ry: rnd() * 0.2 });
      B.box(1.05, 0.25, 0.7, B.MAT.stoneDark, 0, 0.12, 0, g);
      const rune = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.12, 0.6), new THREE.MeshBasicMaterial({ color: RUNE_IDLE.clone() }));
      rune.position.y = h * 0.72; g.add(rune);
      W.place(g, sx, sz, Math.atan2(this.x - sx, this.z - sz));
      W.col.addBox(sx, sz, 0.45, 0.28, g.rotation.y, -10, W.h(sx, sz) + h);
      const st = { m, g, rune, h, x: sx, z: sz, glow: 0, frozen: false, ice: null };
      st.pos = new THREE.Vector3(sx, W.h(sx, sz) + h * 0.6, sz);
      st.target = W.addTarget({ id: 'stone', pos: st.pos, r: 0.9, baseHit: (el, src) => this.hit(st, el, src) });
      this.stones.push(st);
    });
    this.inter = W.addInteract({
      id: 'stones', pos: new THREE.Vector3(this.x, this.y + 1, this.z), r: 2.4, label: '노래 다시 듣기',
      enabled: () => this.started && !this.done && !this.singing,
      action: () => this.sing(),
    });
  }
  stone(m) { return this.stones.find((s) => s.m === m); }

  // The stones sing the current phrase (lit only while teaching).
  sing(delay = 0) {
    const ph = PHRASES[this.stage], lights = this.stage === 0;
    this.singing = ph.length * GAP + delay + 0.4;
    this.k = 0;
    G.later(() => { this.crystalPulse = 1; }, delay * 1000);
    ph.forEach((m, i) => G.later(() => {
      const st = this.stone(m);
      G.audio.play('stone_note', { pos: st.pos, m });
      if (lights) st.glow = 1;
    }, (delay + i * GAP) * 1000));
  }
  hit(st, el, src) {
    if (!this.started || this.singing > 0) return;
    // an area spell touching several stones at once rings only the first
    if (G.time - this.lastHit < 0.2) return;
    this.lastHit = G.time;
    if (st.frozen) {
      if (el === 'fire') this.melt(st, src && src.kind && src.kind !== 'bolt' ? 1 : 0.5);
      else G.audio.play('stone_thud', { pos: st.pos });
      return;
    }
    G.audio.play('stone_note', { pos: st.pos, m: st.m });
    st.glow = 1;
    if (this.done) return; // free play once the trial is over
    const ph = PHRASES[this.stage];
    if (st.m === ph[this.k]) {
      this.k++;
      if (this.k >= ph.length) this.stageDone();
    } else {
      this.k = 0;
      this.singing = 1.2; // a short hush before they sing again
      G.later(() => { G.audio.play('stone_thud', { pos: tmp.set(this.x, this.y + 1, this.z) }); for (const s of this.stones) s.glow = -0.6; }, 250);
      G.later(() => this.sing(), 1300);
    }
  }
  melt(st, v) {
    st.melt = Math.min(1, (st.melt || 0) + v);
    st.ice.scale.copy(st.ice.userData.base).multiplyScalar(1 - st.melt * 0.3);
    G.vfx.burst(st.pos, 'steam', 8, { spread: 0.6 });
    G.audio.play('sizzle', { pos: st.pos, gap: 0.15 });
    if (st.melt >= 1) {
      st.frozen = false; st.ice.visible = false;
      G.vfx.burst(st.pos, 'ice', 14, { speed: 4 });
      G.audio.play('freeze', { pos: st.pos, v: 0.6 });
    }
  }
  freeze(st) {
    st.frozen = true; st.melt = 0;
    if (!st.ice) {
      const m = new THREE.Mesh(crystalGeometry('prism', { sides: 7, radius: 1, height: 1, tip: 0.3, jitter: 0.3, seed: 31 }), clearIce());
      m.scale.set(0.8, st.h / 1.1, 0.6); m.userData.base = m.scale.clone(); m.renderOrder = 2;
      m.position.set(st.x, this.W.h(st.x, st.z) - 0.05, st.z); m.rotation.y = st.g.rotation.y;
      this.W.scene.add(m); st.ice = m;
    }
    st.ice.visible = true; st.ice.scale.copy(st.ice.userData.base);
    G.vfx.burst(st.pos, 'frostmist', 10, { spread: 0.8 });
    G.audio.play('freeze', { pos: st.pos });
  }
  stageDone() {
    this.lamps[this.stage].material.color.copy(RUNE_LIT);
    this.stage++;
    this.singing = 2;
    G.later(() => G.audio.play('seed_wake', { pos: tmp.set(this.x, this.y + 1.5, this.z) }), 350);
    if (this.stage >= PHRASES.length) { this.finish(); return; }
    // the last round: the tallest stone ices over
    if (this.stage === 2) G.later(() => this.freeze(this.stone(78)), 1200);
    this.sing(2.2);
  }
  finish(silent = false) {
    this.done = true; this.started = true;
    for (const l of this.lamps) l.material.color.copy(RUNE_LIT);
    for (const s of this.stones) { s.frozen = false; if (s.ice) s.ice.visible = false; }
    if (silent) return;
    PHRASES[2].forEach((m, i) => G.later(() => { const st = this.stone(m); G.audio.play('stone_note', { pos: st.pos, m }); st.glow = 1; }, 900 + i * 300));
    G.later(() => finishTrial(this.id, this.name, tmp.set(this.x, this.y + 1, this.z).clone()), 900 + 7 * 300);
  }
  update(dt, P) {
    const S = G.story;
    if (!this.done && S && S.flag('trial_' + this.id)) this.finish(true);
    const d = Math.hypot(P.x - this.x, P.z - this.z);
    if (!this.started && d < 13 && G.mode === 'free') {
      this.started = true;
      banner(this.name, '돌이 부르는 노래를 마법으로 두드려 따라 부르자');
      this.sing(1.2);
    }
    if (this.started && !this.done) {
      // walked away mid-phrase: start the phrase over on return
      this.away = d > 30 ? this.away + dt : 0;
      if (this.away > 5) { this.k = 0; this.away = 0; this.started = false; }
    }
    this.singing = Math.max(0, this.singing - dt);
    this.crystalPulse = Math.max(0, (this.crystalPulse || 0) - dt * 0.7);
    this.crystal.rotation.y += dt * 0.6;
    this.crystal.position.y = 1.5 + Math.sin(G.time * 1.4) * 0.06;
    this.cmat.uniforms.uIntensity.value = 0.5 + (this.singing > 0 ? 0.6 : 0) + this.crystalPulse;
    for (const s of this.stones) {
      s.glow += (0 - s.glow) * Math.min(1, dt * 2.2);
      const c = s.rune.material.color;
      if (this.done) c.copy(RUNE_DONE).lerp(RUNE_LIT, Math.max(0, s.glow));
      else if (s.glow >= 0) c.copy(RUNE_IDLE).lerp(RUNE_LIT, s.glow);
      else c.copy(RUNE_IDLE).multiplyScalar(1 + s.glow);
    }
  }
}

let iceMat = null;
function clearIce() {
  return (iceMat ||= crystalMaterial({ ice: true, color: 0x8cc4ea, glow: 0x6fbfff, intensity: 0.2, transparent: true, opacity: 0.22, depthWrite: false, nocache: true }));
}

// ---------------------------------------------------------------- ember climb
// Post heights (m above their ground) come from measured moves: burning grass lifts a
// glider 6-9 m, a wind leap from the ground about 10.5 m, a leap at the top of the heat
// about 15 m, and a glide loses 1 m per 3.3 m. Posts are 14-16 m apart so a leap from
// one post alone does not reach the next.
const POSTS = [
  { x: 96, z: 126, h: 6, r: 1.6 },                // heat
  { x: 108, z: 116, h: 13, r: 1.7 },              // heat + a wind leap
  { x: 118, z: 104, h: 18, r: 2.4, goal: true },  // leap and glide from the post before
];
const EMBER_HINT = [
  '매끈해서 붙잡을 데가 없구나. …불길 위로는 뜨거운 바람이 솟는다지.',
  '뜨거운 바람만으로는 모자라구나. 가장 높이 떴을 때 바람을 부려 보거라.',
  '마지막 망대는 땅에서는 닿지 않겠구나. 바로 앞 기둥 위에서 바람을 타 보거라.',
];

class EmberClimb {
  constructor(W) {
    this.W = W; this.id = 'ember'; this.name = '들불 오르기';
    this.cx = 106; this.cz = 116;
    this.started = false; this.done = false; this.reached = 0; this.linger = 0;
    this.posts = [];
    this.build();
  }
  build() {
    const W = this.W;
    const basalt = toon(0x3a3740, { flat: true, rim: 0.45, tex: 'rock', noMoss: true });
    for (const [i, p] of POSTS.entries()) {
      W.props.clear(p.x, p.z, p.r + 3);
      const y = W.h(p.x, p.z);
      const g = new THREE.Group(); g.userData.noBake = true;
      // a hexagonal basalt column with a slightly wider cap and a lamp on top
      B.cyl(p.r * 0.92, p.r * 1.08, p.h, 6, basalt, 0, p.h / 2, 0, g);
      B.cyl(p.r * 1.12, p.r, 0.35, 6, B.MAT.stoneDark, 0, p.h - 0.17, 0, g);
      B.cyl(p.r * 1.3, p.r * 1.45, 0.5, 6, B.MAT.stoneDark, 0, 0.1, 0, g);
      const lamp = B.brazier(); lamp.scale.setScalar(p.goal ? 0.9 : 0.55);
      lamp.position.set(p.r * 0.5, p.h, 0); g.add(lamp);
      W.place(g, p.x, p.z, i * 0.7);
      const c = W.col.addCircle(p.x, p.z, p.r * 1.1, -10, y + p.h);
      c.climb = false;
      const fl = { pos: lamp.localToWorld(new THREE.Vector3(0, lamp.userData.fireY, 0)), lit: false, scale: p.goal ? 1 : 0.55 };
      W.flames.push(fl);
      this.posts.push({ ...p, y, top: y + p.h, g, lamp, fl, lit: false });
    }
  }
  light(post, loud = true) {
    if (post.lit) return;
    post.lit = post.fl.lit = true;
    post.lamp.userData.coal.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.2, 0.3) });
    if (!loud) return;
    G.audio.play('lantern', { pos: post.fl.pos });
    G.vfx.burst(post.fl.pos, 'fire', 18, { speed: 3 });
    G.vfx.flash(post.fl.pos, 0xff8a3a, 30, 12, 0.5);
  }
  finish(silent = false) {
    this.done = true; this.started = true;
    for (const p of this.posts) this.light(p, !silent);
    if (!silent) finishTrial(this.id, this.name, this.posts[2].fl.pos.clone());
  }
  update(dt, P) {
    const S = G.story;
    if (!this.done && S && S.flag('trial_' + this.id)) this.finish(true);
    if (this.done) return;
    const d = Math.hypot(P.x - this.cx, P.z - this.cz);
    // the climb is all gliding on hot air: it wakes once Borum has lent the wind (story flag 'glide')
    if (!this.started && d < 30 && G.mode === 'free' && S && S.flag('glide')) { this.started = true; banner(this.name, '가장 높은 망대 꼭대기에 올라서자'); }
    if (!this.started) return;
    // standing on a post top lights its lamp; the last one ends the trial
    const pl = G.player;
    for (const [i, p] of this.posts.entries()) {
      if (p.lit || !pl.grounded) continue;
      if (Math.hypot(P.x - p.x, P.z - p.z) < p.r * 1.15 && P.y > p.top - 0.4 && P.y < p.top + 1.6) {
        this.light(p);
        this.reached = Math.max(this.reached, i + 1);
        if (p.goal) this.finish();
      }
    }
    // Borum helps only when the player has been stuck at the next post for a while
    const next = this.posts[this.reached];
    if (next && d < 40 && G.mode === 'free') {
      this.linger += dt;
      if (this.linger > 35) { S && S.cSay(EMBER_HINT[this.reached], 'ember' + this.reached, 7); this.linger = 0; }
    } else this.linger = 0;
  }
}

export class Trials {
  constructor(world) {
    this.list = [new SingingStones(world, 40, 148), new EmberClimb(world)];
  }
  update(dt, playerPos) { for (const t of this.list) t.update(dt, playerPos); }
}
