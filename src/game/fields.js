// Lingering elemental ground fields ("땅의 흔적"): burning ground, rime, puddles,
// steam, charged ground and their hybrids. Fields are left by signature spells,
// weaves, ultimates, charged bolts and some reactions. A second element that lands
// inside a field transforms it into a named variant with its own effect
// (`FIELD_MIX`), so the battlefield itself becomes part of the reaction web.
//
// Entry points (all owned by Spells as `G.spells.fields`):
//   add(kind, groundPos, { r, dur, dmg, P, src })  — create (or merge into) a field
//   infuse(el, pos, r, kind)                      — an element touches this area
//   bindWhirl(zone, pos, r, el, tornadoHandle)     — register a vortex zone as a field
//   at(pos, pad)                                   — field under a point (wind blade pickup)
import * as THREE from 'three';
import { G, EL_INFO } from '../core/context.js';
import { PAL } from '../render/vfx.js';
import { rand, randRange } from '../core/util.js';

const R = (id) => (G.skills ? G.skills.r(id) : 0);
const NOLOOP = { set() {}, vol() {}, stop() {} };
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const C = (r, g, b) => new THREE.Color(r, g, b);
const STEAM_C = C(0.92, 0.95, 1.0), STEAM_C1 = C(0.82, 0.86, 0.92);
const MIST_C = C(0.86, 0.95, 1.05), MIST_C1 = C(0.75, 0.88, 1.0);
const SMOKE_C = C(0.14, 0.12, 0.12), SMOKE_C1 = C(0.32, 0.31, 0.32);
const FIRE_W = C(3.2, 2.6, 1.8);
const MAX_FIELDS = 12;

// el: the element the field carries (what a wind blade picks up, what it applies)
export const FIELDS = {
  blaze: { name: '불길', el: 'fire', color: '#ff8a4a', decal: 'scorch', every: 0.5, loop: 'loop_fire', dmgK: 0.16 },
  plasma: { name: '불벼락 자리', el: 'fire', alt: 'storm', color: '#ffc070', decal: 'char', every: 0.4, loop: 'loop_storm', dmgK: 0.3 },
  rime: { name: '서리밭', el: 'frost', color: '#9fe6ff', decal: 'frost', every: 0.5 },
  frostfog: { name: '서리 안개', el: 'frost', color: '#cff4ff', decal: 'frost', every: 0.5, loop: 'loop_blizzard', dmgK: 0.08 },
  puddle: { name: '물웅덩이', el: 'water', color: '#6fb4ff', decal: 'wet', every: 0.5 },
  steam: { name: '김 구름', el: 'water', color: '#e8f4ff', decal: null, every: 0.5 },
  charged: { name: '대전된 땅', el: 'storm', color: '#ffe45c', decal: 'char', every: 0.45, loop: 'loop_storm', dmgK: 0.12 },
  shockfog: { name: '번개 안개', el: 'storm', color: '#fff27a', decal: null, every: 0.4, loop: 'loop_storm', dmgK: 0.22 },
  shockwater: { name: '전류 웅덩이', el: 'storm', color: '#bfe8ff', decal: 'wet', every: 0.4, dmgK: 0.18 },
};

// Transformations (codex). Keyed `<field>+<element>`; `whirl:<el>` for vortices.
export const FIELD_MIX = {
  'blaze+storm': { name: '과열 방전', color: '#ffb060', desc: '불길에 번개 → 불길 전체가 터지며 갑옷을 부수고, 불벼락 자리가 남는다.' },
  'blaze+frost': { name: '열충격 안개', color: '#ffd0f0', desc: '불길에 서리 → 한꺼번에 식으며 터지고, 김 구름이 피어오른다.' },
  'blaze+water': { name: '끓는 김', color: '#ffe6d0', desc: '불길에 물 → 불이 꺼지며 뜨거운 김 구름이 된다. 김 속의 적은 느려지고 젖는다.' },
  'blaze+wind': { name: '들불', color: '#ff7a3a', desc: '불길에 바람 → 불길이 넓게 번지고 오래 타며, 주변 적에게 불이 옮겨붙는다.' },
  'rime+fire': { name: '해빙', color: '#ffb070', desc: '서리밭에 화염 → 얼음이 녹아 물웅덩이가 되고, 안의 적이 젖는다.' },
  'rime+storm': { name: '얼음 방전', color: '#d8f6ff', desc: '서리밭에 번개 → 얼음이 한꺼번에 부서지며 안의 적을 할퀴고 감전시킨다.' },
  'rime+wind': { name: '눈보라', color: '#bfefff', desc: '서리밭에 바람 → 서리가 휘날려 더 넓은 서리 안개가 된다.' },
  'rime+water': { name: '빙판', color: '#8fe3ff', desc: '서리밭에 물 → 안의 적이 그대로 얼어붙고 서리밭이 오래 남는다.' },
  'puddle+storm': { name: '전류 웅덩이', color: '#fff27a', desc: '물웅덩이에 번개 → 안의 적이 모두 감전되어 멈추고, 웅덩이에 전류가 흐른다.' },
  'puddle+frost': { name: '빙판', color: '#8fe3ff', desc: '물웅덩이에 서리 → 웅덩이가 얼어 안의 적이 얼어붙는다.' },
  'puddle+fire': { name: '끓는 김', color: '#ffe6d0', desc: '물웅덩이에 화염 → 물이 끓어 김 구름이 된다.' },
  'puddle+wind': { name: '물보라', color: '#8ab8ff', desc: '물웅덩이에 바람 → 물보라가 흩날려 넓은 범위의 적을 적신다.' },
  'steam+storm': { name: '번개 안개', color: '#fff27a', desc: '김 구름에 번개 → 전기가 흐르는 안개가 되어 안의 적을 계속 감전시킨다.' },
  'steam+frost': { name: '서리 안개', color: '#cff4ff', desc: '김 구름에 서리 → 김이 얼어붙는 안개가 되고, 걷히면 서리밭이 남는다.' },
  'steam+wind': { name: '흩날리는 김', color: '#e8f4ff', desc: '김 구름에 바람 → 김이 넓게 퍼지며 주변 적을 적신다.' },
  'steam+fire': { name: '열기 폭발', color: '#ffc8a0', desc: '김 구름에 화염 → 뜨거운 김이 한꺼번에 터진다.' },
  'charged+water': { name: '전류 웅덩이', color: '#fff27a', desc: '대전된 땅에 물 → 물이 전류를 머금어 안의 적이 감전된다.' },
  'charged+fire': { name: '과열 방전', color: '#ffb060', desc: '대전된 땅에 화염 → 폭발하며 불벼락 자리가 된다.' },
  'charged+wind': { name: '뇌전 확산', color: '#ffe45c', desc: '대전된 땅에 바람 → 전기가 흩어지며 넓은 범위의 적을 감전시킨다.' },
  'charged+frost': { name: '초전도 서리', color: '#d9f0ff', desc: '대전된 땅에 서리 → 서리밭이 되고, 안의 적은 갑옷이 부서진다.' },
  'whirl:wind': { name: '물든 회오리', color: '#9fffd8', desc: '바람 소용돌이에 다른 속성 → 회오리가 그 속성으로 물들어 빨아들인 적에게 옮긴다.' },
  'whirl:water': { name: '소용돌이 변화', color: '#8ab8ff', desc: '물 소용돌이에 번개 → 전류가 흐르고, 서리 → 얼어붙어 무너지고, 화염 → 끓어 김이 된다.' },
  arcane: { name: '공명 폭발', color: '#c9a8ff', desc: '땅의 흔적에 강한 비전 마법 → 흔적이 품은 속성이 한꺼번에 터진다.' },
};

// hybrid fields reuse the codex entry of the transformation they resemble
const ALIAS = {
  'shockwater+frost': 'puddle+frost', 'shockfog+wind': 'charged+wind', 'shockwater+wind': 'charged+wind',
  'plasma+water': 'blaze+water', 'shockwater+fire': 'puddle+fire', 'frostfog+fire': 'puddle+fire',
  'plasma+wind': 'blaze+wind', 'frostfog+wind': 'rime+wind',
};

// the element a field hands to a wind blade / arcane detonation
const carry = (f) => (f.kind === 'whirl' ? (f.zone.infused || f.el) : f.def.el);

export class Fields {
  constructor() {
    this.list = [];
    this.envT = 0;
  }

  get enemies() { return G.enemies ? G.enemies.list : []; }
  power() { return G.player ? G.player.power() : 10; }

  // enemies standing in a field (horizontal radius, near its ground height)
  inside(f, pad = 0, rr = f.r) {
    const out = [];
    for (const e of this.enemies) {
      if (!e.alive || !e.hittable) continue;
      const dx = e.pos.x - f.pos.x, dz = e.pos.z - f.pos.z;
      if (dx * dx + dz * dz > (rr + e.radius + pad) ** 2) continue;
      if (e.pos.y - f.pos.y > 3.2 || e.pos.y - f.pos.y < -2.5) continue;
      out.push(e);
    }
    return out;
  }

  at(pos, pad = 0) {
    for (const f of this.list) {
      if (f.ended || f.t < 0.05) continue;
      const dx = pos.x - f.pos.x, dz = pos.z - f.pos.z;
      if (dx * dx + dz * dz < (f.r + pad) ** 2 && pos.y - f.pos.y < 4 && pos.y - f.pos.y > -1.5) return f;
    }
    return null;
  }

  // ------------------------------------------------------------
  add(kind, pos, o = {}) {
    const def = FIELDS[kind];
    if (!def || !G.world) return null;
    const W = G.world;
    const g = pos.clone();
    if (!o.noGround) {
      g.y = W.ground(g.x, g.z, g.y + 2);
      if (Math.abs(g.y - pos.y) > 4) return null; // mid-air: nothing to lie on
    }
    // standing water: fire fields fizzle, everything else floats as-is
    const overWater = W.h(g.x, g.z) < -0.2 && g.y <= W.h(g.x, g.z) + 0.05;
    if (overWater && (kind === 'blaze' || kind === 'plasma')) { G.vfx.burst(g, 'steam', 6, { spread: 1 }); return null; }
    const P = o.P ?? this.power();
    const r = o.r ?? 2.5, dur = o.dur ?? 4;
    // merge into a nearby field of the same kind instead of stacking visuals
    for (const f of this.list) {
      if (f.ended || f.kind !== kind) continue;
      const d = Math.hypot(f.pos.x - g.x, f.pos.z - g.z);
      if (d < Math.max(f.r, r) * 0.7) {
        f.dur = Math.max(f.dur, f.t + dur);
        const nr = Math.min(o.maxR ?? 8, Math.max(f.r, r, d + r * 0.6));
        if (nr > f.r * 1.2) { f.r = nr; this.dress(f, true); } else f.r = nr;
        if (o.dmg) f.dmg = Math.max(f.dmg, o.dmg);
        return f;
      }
    }
    const f = {
      kind, def, el: def.el, pos: g, r, dur, t: 0, tick: rand() * 0.2, P, src: o.src || 'player',
      dmg: o.dmg ?? (def.dmgK ?? 0) * P, every: o.every ?? def.every, acc: 0, mixCD: 0, envT: rand() * 0.5, n: 0,
    };
    this.dress(f);
    this.list.push(f);
    while (this.list.filter((x) => !x.ended).length > MAX_FIELDS) {
      const old = this.list.find((x) => !x.ended && x.kind !== 'whirl');
      if (!old) break;
      this.end(old, 0.6);
    }
    return f;
  }

  // ground visuals + loop sound for a field (called again when it grows or changes kind)
  dress(f, grow = false) {
    const V = G.vfx, def = f.def;
    const left = Math.max(0.5, f.dur - f.t);
    if (f.decal) V.endDecal(f.decal, f.decalSeq, grow ? 0.3 : 0.8);
    f.decal = null;
    if (def.decal) {
      const glowDur = def.decal === 'scorch' || def.decal === 'char' ? left * 0.7 : undefined;
      f.decal = V.decal(f.pos, def.decal, f.r * (def.decal === 'wet' ? 1.05 : 0.95), { dur: left + (def.decal === 'scorch' || def.decal === 'char' ? 5 : 1.5), glowDur, glowA: f.kind === 'shockwater' ? 1.4 : 1 });
      f.decalSeq = f.decal ? f.decal.seq : 0;
    }
    if (f.haze) { f.haze.end(); f.haze = null; }
    // heat shimmer only over real fire seas: a live haze keeps the screen-refraction pass on
    if ((f.kind === 'blaze' || f.kind === 'plasma') && f.r >= 3) f.haze = V.distort.haze(f.pos, f.r * 1.8, 0, { h: 1.3, amp: 0.012 });
    if (!grow) {
      if (f.snd) f.snd.stop(0.4);
      f.snd = def.loop ? this.loop(def.loop, f.pos, f.kind === 'blaze' ? 0.7 : 0.5) : NOLOOP;
    }
    if (f.kind === 'rime' && !grow) {
      // a few low ice blades break through the ground at the rim
      const n = Math.min(6, 2 + Math.round(f.r));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.28 + rand() * 0.5, rr = f.r * randRange(0.35, 0.85);
        const p = tmp.set(f.pos.x + Math.cos(a) * rr, f.pos.y, f.pos.z + Math.sin(a) * rr).clone();
        p.y = G.world.ground(p.x, p.z, f.pos.y + 1.5);
        V.crystal(p, randRange(0.45, 0.85), { width: randRange(0.3, 0.55), life: Math.min(6, left), quiet: true, tiltX: Math.sin(a) * 0.5, tiltZ: -Math.cos(a) * 0.5 });
      }
    }
  }
  loop(name, pos, v) {
    const A = G.audio;
    if (!A || !A.loop) return NOLOOP;
    try { return A.loop(name, { pos, v }) || NOLOOP; } catch (e) { return NOLOOP; }
  }

  end(f, fade = 0.8) {
    if (f.ended) return;
    f.ended = true;
    if (f.decal) {
      // scorch & char keep their dark stain for a while after the fire is gone
      const stain = f.def && (f.def.decal === 'scorch' || f.def.decal === 'char');
      if (!stain) G.vfx.endDecal(f.decal, f.decalSeq, fade);
    }
    if (f.haze) { f.haze.end(); f.haze = null; }
    if (f.snd) { f.snd.stop(0.5); f.snd = null; }
    if (f.zone && !f.zone.over) f.zone.kill = true;
  }

  // change a field into another kind in place
  morph(f, kind, o = {}) {
    const def = FIELDS[kind];
    f.kind = kind; f.def = def; f.el = def.el;
    f.t = 0; f.dur = o.dur ?? 4; f.r = o.r ?? f.r;
    f.dmg = o.dmg ?? (def.dmgK ?? 0) * f.P; f.every = def.every; f.tick = 0.15;
    this.dress(f);
    return f;
  }

  clear() { for (const f of this.list) this.end(f, 0.3); this.list.length = 0; }

  // vortex zones (wind / water whirl) take part in transformations too
  bindWhirl(zone, pos, r, el, tor) {
    const f = { kind: 'whirl', def: { name: '소용돌이', el }, el, pos, r, dur: 1e9, t: 0, zone, tor, mixCD: 0, envT: 0, P: this.power() };
    this.list.push(f);
    return f;
  }

  // ------------------------------------------------------------
  // An element touches an area: transform the fields it overlaps and tell the
  // world systems (wildfire, weather, water ice). kind: bolt|heavy|weave|ult|field|charged
  infuse(el, pos, r = 1, kind = 'bolt', src = 'player') {
    if (!el || el === 'hush') return 0;
    let n = 0;
    for (const f of [...this.list]) {
      if (f.ended || f.mixCD > 0 || f.t < 0.12) continue;
      const dx = pos.x - f.pos.x, dz = pos.z - f.pos.z;
      if (dx * dx + dz * dz > (f.r + r) ** 2) continue;
      if (pos.y - f.pos.y > 4.5 || pos.y - f.pos.y < -2) continue;
      if (this.mix(f, el, kind, src)) n++;
    }
    return n;
  }

  // the core transformation table. Returns true when something happened.
  mix(f, el, kind, src) {
    const V = G.vfx, A = G.audio, CB = G.combat;
    const c = f.pos, P = this.power();
    const same = el === f.el || el === f.def.alt;
    if (f.kind === 'whirl') return this.mixWhirl(f, el, kind);
    if (el === 'arcane') {
      if (kind === 'bolt') return false; // arcane arrows are free: only real spells detonate fields
      return this.detonate(f);
    }
    if (same) {
      // feeding a field its own element keeps it alive a little longer
      if (f.dur - f.t < 6) f.dur += 0.8;
      f.mixCD = 0.3;
      return false;
    }
    const key = `${f.kind}+${el}`;
    const hitAll = (list, h) => { for (const e of list) CB.hit(e, { pos: e.center(), source: 'player', noReact: true, hitstop: 0.02, shake: 0.04, ...h }); };
    const ringFx = (col, rr = f.r) => { V.ring(c, col, rr * 1.25, 0.45, { thick: 0.22 }); V.distort.ring(c, rr * 1.8, 0.45, { flat: true, amp: 0.035 }); };
    let done = true;
    switch (key) {
      // --- burning ground
      case 'blaze+storm':
      case 'charged+fire': {
        const rr = f.r * 1.15;
        V.explode('fire', tmp.copy(c).setY(c.y + 0.6), rr * 0.9);
        V.strike(c, rr * 0.6, { dim: true });
        A.play('overload', { pos: c });
        hitAll(this.inside(f, 0.5, rr), { dmg: P * 1.4, el: 'fire', knock: 10, lift: 4, heavy: true, status: 1 });
        for (const e of this.inside(f, 0.5, rr)) if (e.st) e.st.armorBroken = Math.max(e.st.armorBroken, 6);
        G.cameraRig.shake(0.35);
        this.morph(f, 'plasma', { dur: 3.2, dmg: P * 0.3 });
        break;
      }
      case 'blaze+frost': {
        V.react('thermal', tmp.copy(c).setY(c.y + 0.8), { r: f.r });
        A.play('react_thermal', { pos: c });
        hitAll(this.inside(f, 0.4), { dmg: P * 1.0, el: 'frost', knock: 6, status: 0.6 });
        for (const e of this.inside(f, 0.4)) if (e.st) { e.st.burn = 0; e.st.wet = Math.max(e.st.wet, 4); }
        this.morph(f, 'steam', { dur: 4 });
        break;
      }
      case 'blaze+water':
      case 'puddle+fire': {
        A.play('steam', { pos: c }); A.play('fizzle', { pos: c });
        V.burst(tmp.copy(c).setY(c.y + 0.4), 'steamjet', 14, { speed: 9 });
        V.burst(c, 'steam', 16, { spread: f.r * 0.6, size: 1.5 });
        if (f.kind === 'blaze') for (const e of this.inside(f, 0.4)) if (e.st) e.st.burn = 0;
        hitAll(this.inside(f, 0.4), { dmg: P * (R('h_scald') ? 0.9 : 0.5), el: 'fire', noStatus: true, knock: 3, lift: 2 });
        this.morph(f, 'steam', { dur: 4.5, r: f.r * 1.1 });
        break;
      }
      case 'blaze+wind': {
        const nr = Math.min(7.5, f.r * 1.45);
        V.ring(c, PAL.fire.core, nr * 1.2, 0.5, { thick: 0.35 });
        V.radial(c, 22, { el: 'fire', speed: 14, up: 0.2, life: 0.45 });
        V.burst(c, 'fire', 22, { spread: nr * 0.6, speed: 4, size: 1.5 });
        A.play('react_firestorm', { pos: c }); A.play('gale', { pos: c, v: 0.6 });
        for (const e of this.inside(f, 2, nr)) CB.ignite(e, 5, P * 0.18);
        f.r = nr; f.dur = Math.max(f.dur, f.t + 3.5) + 2; f.dmg *= 1.2;
        this.dress(f, true);
        if (R('h_wildfire')) f.dur += 2;
        break;
      }
      // --- rime
      case 'rime+fire': {
        V.react('melt', tmp.copy(c).setY(c.y + 0.5));
        A.play('melt', { pos: c }); A.play('steam', { pos: c, v: 0.5 });
        V.burst(c, 'steam', 12, { spread: f.r * 0.5, size: 1.2 });
        hitAll(this.inside(f, 0.4), { dmg: P * 0.8, el: 'fire', noStatus: true, status: 0 });
        for (const e of this.inside(f, 0.4)) if (e.st) { e.st.chill = 0; e.st.wet = Math.max(e.st.wet, 6); }
        this.morph(f, 'puddle', { dur: 6 });
        break;
      }
      case 'rime+storm': {
        V.react('shatter', tmp.copy(c).setY(c.y + 0.6), { r: f.r });
        V.chunks(c, 'ice', 18, { speed: 11, up: 0.8, size: 0.14 });
        for (let i = 0; i < 4; i++) { const a = rand() * 6.28, rr = f.r * randRange(0.3, 1); V.lightning(tmp.copy(c).setY(c.y + 0.1), tmp2.set(c.x + Math.cos(a) * rr, c.y + 0.2, c.z + Math.sin(a) * rr).clone(), { width: 0.06, dur: 0.25, branches: 1, jag: 0.25, segs: 8 }); }
        A.play('shatter', { pos: c }); A.play('zap', { pos: c });
        hitAll(this.inside(f, 0.5), { dmg: P * 1.3, el: 'frost', knock: 5, lift: 3, heavy: true, noStatus: true });
        for (const e of this.inside(f, 0.5)) if (e.alive && e.st) { e.st.shock = Math.max(e.st.shock, 2.5); e.st.stun = Math.max(e.st.stun, 0.6); }
        G.cameraRig.shake(0.3);
        this.end(f, 0.4);
        break;
      }
      case 'rime+wind': {
        V.react('blizzard', tmp.copy(c).setY(c.y + 0.8), { r: f.r * 1.4 });
        A.play('react_blizzard', { pos: c });
        for (const e of this.inside(f, 1.5, f.r * 1.4)) CB.applyStatus(e, 'frost', 1.2, P);
        this.morph(f, 'frostfog', { dur: 3.5, r: Math.min(8, f.r * 1.4) });
        break;
      }
      case 'rime+water':
      case 'puddle+frost':
      case 'shockwater+frost': {
        V.react('flashfreeze', tmp.copy(c).setY(c.y + 0.6));
        V.ring(c, PAL.frost.core, f.r * 1.3, 0.5, { thick: 0.25 });
        A.play('react_flashfreeze', { pos: c });
        for (const e of this.inside(f, 0.3)) if (e.alive && e.st && e.rig && !e.boss) CB.freeze(e, 2.4); else if (e.alive) CB.applyStatus(e, 'frost', 2, P);
        this.morph(f, 'rime', { dur: 7, r: f.r });
        break;
      }
      // --- water
      case 'puddle+storm':
      case 'charged+water': {
        V.react('conduct', tmp.copy(c).setY(c.y + 0.4));
        for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28 + rand() * 0.5, rr = f.r * randRange(0.5, 1); V.lightning(tmp.copy(c).setY(c.y + 0.12), tmp2.set(c.x + Math.cos(a) * rr, c.y + 0.12, c.z + Math.sin(a) * rr).clone(), { width: 0.07, dur: 0.3, branches: 1, jag: 0.2, segs: 10, color: PAL.water.core, glow: PAL.storm.glow }); }
        A.play('chain', { pos: c }); A.play('react_shortcircuit', { pos: c, v: 0.7 });
        const eD = P * 0.18 * (1 + 0.4 * R('s_conduct')) * (R('h_thunderrain') ? 2 : 1);
        for (const e of this.inside(f, 0.4)) { CB.hit(e, { dmg: P * 0.8, el: 'storm', pos: e.center(), noReact: true, source: 'player', hitstop: 0.02, shake: 0.05, status: 1 }); if (e.alive && e.st) { e.st.stun = Math.max(e.st.stun, 1.1); CB.electrify(e, eD, 3); } }
        this.morph(f, 'shockwater', { dur: 4 });
        break;
      }
      case 'puddle+wind':
      case 'steam+wind': {
        const rr = f.r * 2;
        V.react('monsoon', tmp.copy(c).setY(c.y + 0.6), { r: rr });
        A.play('react_monsoon', { pos: c });
        for (const e of this.inside(f, 1, rr)) { if (e.st) { e.st.wet = Math.max(e.st.wet, R('wa_soak') ? 12 : 7); e.st.burn = 0; } V.burst(e.center(), 'water', 6); }
        if (f.kind === 'steam') for (const e of this.inside(f, 1, rr)) if (e.st) e.st.steam = Math.max(e.st.steam, 2);
        this.end(f, 0.5);
        break;
      }
      // --- steam
      case 'steam+storm': {
        V.react('stormspread', tmp.copy(c).setY(c.y + 1), { r: f.r });
        A.play('react_stormspread', { pos: c }); A.play('zap', { pos: c });
        this.morph(f, 'shockfog', { dur: 4.5 });
        break;
      }
      case 'steam+frost': {
        V.burst(tmp.copy(c).setY(c.y + 1), 'snowflake', 30, { spread: f.r * 0.6 });
        V.burst(c, 'frostmist', 10, { spread: f.r * 0.6, size: 1.6 });
        A.play('freeze', { pos: c }); A.play('react_blizzard', { pos: c, v: 0.6 });
        for (const e of this.inside(f, 0.5)) CB.applyStatus(e, 'frost', 1.5, P);
        this.morph(f, 'frostfog', { dur: 3.5 });
        f.thenRime = true;
        break;
      }
      case 'steam+fire': {
        V.explode('fire', tmp.copy(c).setY(c.y + 1), f.r * 0.8);
        V.burst(c, 'steamjet', 18, { speed: 12 });
        A.play('react_scald', { pos: c }); A.play('explosion', { pos: c, v: 0.6 });
        hitAll(this.inside(f, 0.5), { dmg: P * 1.1, el: 'fire', knock: 8, lift: 3, heavy: true, noStatus: true });
        this.end(f, 0.4);
        break;
      }
      // --- charged ground
      case 'charged+wind':
      case 'shockfog+wind':
      case 'shockwater+wind': {
        const rr = f.r * 2;
        V.react('stormspread', tmp.copy(c).setY(c.y + 0.8), { r: rr });
        A.play('react_stormspread', { pos: c });
        for (const e of this.inside(f, 1, rr)) { V.lightning(tmp.copy(c).setY(c.y + 0.5), e.center(), { width: 0.07, dur: 0.22, branches: 0 }); if (e.st) { e.st.shock = Math.max(e.st.shock, 3); e.st.stun = Math.max(e.st.stun, 0.5); } CB.hit(e, { dmg: P * 0.5, el: 'storm', pos: e.center(), noReact: true, noStatus: true, source: 'player', hitstop: 0 }); }
        this.end(f, 0.5);
        break;
      }
      case 'charged+frost': {
        V.react('superconduct', tmp.copy(c).setY(c.y + 0.6));
        A.play('react_superconduct', { pos: c });
        for (const e of this.inside(f, 0.4)) if (e.st) { e.st.armorBroken = Math.max(e.st.armorBroken, 6); CB.applyStatus(e, 'frost', 1, P); }
        this.morph(f, 'rime', { dur: 5 });
        break;
      }
      case 'plasma+water':
      case 'shockwater+fire':
      case 'frostfog+fire': {
        A.play('steam', { pos: c }); V.burst(c, 'steam', 16, { spread: f.r * 0.6, size: 1.5 });
        this.morph(f, 'steam', { dur: 3.5 });
        break;
      }
      case 'plasma+wind':
      case 'frostfog+wind': {
        const st = f.kind === 'plasma' ? 'fire' : 'frost';
        V.react(st === 'fire' ? 'firestorm' : 'blizzard', tmp.copy(c).setY(c.y + 0.8), { r: f.r * 1.8 });
        for (const e of this.inside(f, 1, f.r * 1.8)) CB.applyStatus(e, st, 1.2, P);
        this.end(f, 0.5);
        break;
      }
      default: done = false;
    }
    if (!done) return false;
    f.mixCD = 0.35;
    this.announce(key, c);
    return true;
  }

  // arcane signature / charged arrow into a field: everything it holds goes off at once
  detonate(f) {
    const V = G.vfx, A = G.audio, P = this.power();
    const el = carry(f), c = f.pos;
    const rr = f.r * 1.1;
    V.react('resonance', tmp.copy(c).setY(c.y + 0.8));
    V.explode(el, tmp.copy(c).setY(c.y + 0.5), rr * 0.8);
    V.circle(c, PAL.arcane.glow, rr * 0.9, 0.5, { spin: 4, alpha: 0.6 });
    A.play('react_resonance', { pos: c }); A.play('blast_arcane', { pos: c, v: 0.6 });
    for (const e of this.inside(f, 0.6, rr)) G.combat.hit(e, { dmg: P * 1.3 * (1 + 0.15 * R('a_echo')), el, pos: e.center(), dir: tmp2.subVectors(e.center(), c).setY(0.3).normalize().clone(), noReact: true, knock: 9, lift: 4, heavy: true, status: 1.2, source: 'player', hitstop: 0.05 });
    G.cameraRig.shake(0.3);
    if (f.kind === 'whirl') f.zone.kill = true;
    this.end(f, 0.4);
    this.announce('arcane', c);
    return true;
  }

  mixWhirl(f, el, kind) {
    const z = f.zone, V = G.vfx, A = G.audio, c = f.pos;
    if (el === 'arcane') return kind === 'bolt' ? false : this.detonate(f);
    if (el === f.el || el === z.infused) return false;
    if (f.el === 'wind') {
      if (z.infused) return false;
      z.infused = el;
      if (f.tor && f.tor.setEl) f.tor.setEl(el);
      V.burst(tmp.copy(c).setY(c.y + 1.5), el === 'storm' ? 'electric' : el === 'frost' ? 'ice' : el, 24, { speed: 7 });
      V.ring(c, PAL[el].core, f.r, 0.5, { thick: 0.2 });
      A.play('cast_' + el, { pos: c }); A.play('gale', { pos: c, v: 0.6 });
      f.mixCD = 0.4;
      this.announce('whirl:wind', c, `${EL_INFO[el].name} 회오리`);
      return true;
    }
    // water whirl
    const P = this.power();
    if (el === 'storm') {
      if (z.infused) return false;
      z.infused = 'storm';
      V.react('conduct', tmp.copy(c).setY(c.y + 0.6));
      A.play('chain', { pos: c });
      this.announce('whirl:water', c, '전류 소용돌이');
    } else if (el === 'frost') {
      V.react('flashfreeze', tmp.copy(c).setY(c.y + 0.6));
      A.play('react_flashfreeze', { pos: c });
      for (const e of this.inside(f, 0.3)) if (e.alive && e.st && e.rig && !e.boss) G.combat.freeze(e, 2.5); else if (e.alive) G.combat.applyStatus(e, 'frost', 2, P);
      z.kill = true;
      this.add('rime', c, { r: f.r * 0.8, dur: 7, P, noGround: true });
      this.announce('whirl:water', c, '얼어붙은 소용돌이');
    } else if (el === 'fire') {
      A.play('steam', { pos: c }); V.burst(c, 'steamjet', 18, { speed: 10 });
      z.kill = true;
      this.add('steam', c, { r: f.r * 0.8, dur: 4.5, P, noGround: true });
      this.announce('whirl:water', c, '끓는 소용돌이');
    } else return false;
    f.mixCD = 0.5;
    return true;
  }

  announce(key, pos, label) {
    key = ALIAS[key] || key;
    const m = FIELD_MIX[key];
    if (!m) return;
    const name = label || m.name;
    if (G.hud && G.hud.floatText) G.hud.floatText(tmp.copy(pos).setY(pos.y + 1.2), name, m.color, 'react');
    G.audio.play('field_mix', { pos, gap: 0.08 });
    const K = G.skills;
    if (K) {
      K.charge(4);
      if (K.discover('f:' + key) && G.hud.discovered) G.hud.discovered('f:' + key);
    }
    if (G.combat && G.combat.chainUp) G.combat.chainUp('f:' + key);
    if (G.player && G.player.stats) G.player.stats.fieldMixes = (G.player.stats.fieldMixes || 0) + 1;
  }

  // ------------------------------------------------------------
  update(dt) {
    // shared emission budget: many overlapping fields thin out their ambience
    // instead of stacking overdraw (big soft sprites are fill-rate heavy)
    let live = 0;
    for (const f of this.list) if (!f.ended && f.kind !== 'whirl') live++;
    this.rateK = Math.min(1, 5 / Math.max(1, live)) * (G.settings && G.settings.quality === 'low' ? 0.5 : 1);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      if (f.ended) { this.list.splice(i, 1); continue; }
      if (f.kind === 'whirl') {
        f.mixCD -= dt;
        if (f.zone.over) { this.list.splice(i, 1); continue; }
        f.envT -= dt;
        if (f.envT <= 0) { f.envT = 0.5; this.env(f); }
        continue;
      }
      f.t += dt; f.tick -= dt; f.mixCD -= dt; f.envT -= dt;
      const left = f.dur - f.t;
      const k = Math.min(1, left * 1.5, f.t * 6);
      if (f.snd && f.snd.set) f.snd.set(f.pos);
      this.visuals(f, dt, k);
      if (f.tick <= 0) { f.tick = f.every; f.n++; this.tickField(f); }
      if (f.envT <= 0) { f.envT = 0.5; this.env(f); }
      if (left <= 0) {
        const then = f.thenRime;
        this.end(f);
        if (then) this.add('rime', f.pos, { r: f.r * 0.8, dur: 5, P: f.P, noGround: true });
        this.list.splice(i, 1);
      }
    }
  }

  env(f) {
    const env = G.env;
    if (env && env.onSpell) env.onSpell({ el: carry(f), pos: f.pos.clone(), r: f.r, kind: 'field', source: f.src });
  }

  tickField(f) {
    const CB = G.combat, P = f.P;
    const list = this.inside(f);
    if (!list.length) return;
    const dot = (e, el, dmg, status = 0.5) => {
      CB.hit(e, { dmg, el, noReact: true, pos: e.center(), source: 'dot', hitstop: 0, shake: 0, knock: 0, status });
      if (e.alive && dmg >= 1) G.hud.damage(e.center(), Math.max(1, Math.round(dmg)), el, false, null, true);
    };
    switch (f.kind) {
      case 'blaze': for (const e of list) dot(e, 'fire', f.dmg, 0.6); break;
      case 'plasma': { const el = f.n % 2 ? 'storm' : 'fire'; for (const e of list) dot(e, el, f.dmg, 0.5); break; }
      case 'rime': for (const e of list) CB.applyStatus(e, 'frost', 0.45, P); break;
      case 'frostfog': for (const e of list) dot(e, 'frost', f.dmg, 0.7); break;
      case 'puddle': for (const e of list) if (e.st && !(e.immune && e.immune.includes('water'))) { e.st.wet = Math.max(e.st.wet, 3); if (e.st.burn > 0) e.st.burn = 0; } break;
      case 'steam': for (const e of list) if (e.st) { e.st.steam = Math.max(e.st.steam, 1.2); e.st.wet = Math.max(e.st.wet, 2.5); if (e.st.burn > 0) e.st.burn = 0; } break;
      case 'charged': for (const e of list) { dot(e, 'storm', f.dmg, 0.35); } break;
      case 'shockfog': for (const e of list) { dot(e, 'storm', f.dmg, 0.6); if (e.st) { e.st.steam = Math.max(e.st.steam, 1); e.st.stun = Math.max(e.st.stun, 0.15); } } break;
      case 'shockwater': for (const e of list) { dot(e, 'storm', f.dmg, 0.4); if (e.alive && e.st) { e.st.wet = Math.max(e.st.wet, 2); e.st.stun = Math.max(e.st.stun, 0.12); } } break;
    }
  }

  // ambient emission for each field kind (rate scales with area, capped)
  visuals(f, dt, k) {
    const V = G.vfx, c = f.pos, r = f.r;
    const area = Math.min(2.4, (r * r) / 5 + 0.4) * (this.rateK ?? 1);
    const pt = () => { const a = rand() * 6.28, rr = Math.sqrt(rand()) * r; return tmp.set(c.x + Math.cos(a) * rr, c.y + 0.08, c.z + Math.sin(a) * rr); };
    const every = (rate) => rand() < dt * rate * area * k;
    switch (f.kind) {
      case 'blaze':
      case 'plasma': {
        // flame tongues standing above the grass, denser toward the middle
        for (let i = 0; i < 4; i++) if (every(10)) {
          const a = rand() * 6.28, rr = Math.pow(rand(), 0.7) * r, p = tmp.set(c.x + Math.cos(a) * rr, c.y + randRange(0.05, 0.3), c.z + Math.sin(a) * rr);
          const hk = 1 - 0.5 * (rr / r);
          V.add.emit({ p: [p.x, p.y, p.z], v: [randRange(-0.3, 0.3), randRange(1.4, 2.8) * hk, randRange(-0.3, 0.3)], life: randRange(0.4, 0.8), size: randRange(0.6, 1.15) * hk * (0.4 + 0.6 * k), size1: 0.12, ease: 0.7, color: FIRE_W, color2: PAL.fire.core, mid: 0.2, color1: PAL.fire.deep, alpha: 0.9, alpha1: 0, drag: 2, grav: -2.5, shape: 7 });
        }
        if (every(3)) { const p = pt(); V.add.emit({ p: [p.x, p.y + 0.15, p.z], v: [0, 0.3, 0], life: 0.5, size: randRange(1.2, 1.8), size1: 0.6, color: PAL.fire.glow, color1: PAL.fire.deep, alpha: 0.18 * k, alpha1: 0, shape: 0 }); }
        if (every(4)) V.burst(pt(), 'ember', 1, { speed: 3 });
        if (every(1.6)) { const p = pt(); V.norm.emit({ p: [p.x, p.y + 0.5, p.z], v: [randRange(-0.3, 0.3), randRange(0.8, 1.4), randRange(-0.3, 0.3)], life: randRange(1.4, 2.2), size: 0.4, size1: 1.8, ease: 0.6, color: SMOKE_C, color1: SMOKE_C1, alpha: 0.28 * k, alpha1: 0, drag: 1, grav: -0.2, shape: 8, fadeIn: 0.2 }); }
        if (f.kind === 'plasma' && every(2.5)) { const a = pt().clone(); V.lightning(a, pt().clone().setY(c.y + randRange(0.3, 1)), { width: 0.05, dur: 0.14, branches: 0, segs: 8 }); }
        if (every(0.5)) G.audio.play('sizzle', { pos: c, gap: 0.4, v: 0.35 });
        break;
      }
      case 'rime':
        if (every(4)) { const p = pt(); V.norm.emit({ p: [p.x, p.y + 0.1, p.z], v: [randRange(-0.4, 0.4), randRange(0.05, 0.25), randRange(-0.4, 0.4)], life: randRange(1.4, 2.2), size: 0.5, size1: randRange(1.6, 2.4), ease: 0.6, color: MIST_C, color1: MIST_C1, alpha: 0.22 * k, alpha1: 0, drag: 1.2, shape: 8, fadeIn: 0.25 }); }
        // rime glints on the grass tips + a cold ground haze
        for (let i = 0; i < 2; i++) if (every(7)) { const p = pt(); V.add.emit({ p: [p.x, p.y + randRange(0.1, 0.55), p.z], v: [0, randRange(0.02, 0.12), 0], life: randRange(0.35, 0.7), size: randRange(0.12, 0.24), size1: 0.02, color: PAL.frost.core, color1: PAL.frost.glow, alpha: k, alpha1: 0, shape: rand() < 0.5 ? 10 : 4 }); }
        if (every(1.2)) { const p = pt(); V.norm.emit({ p: [p.x, p.y + 0.25, p.z], v: [0, 0.05, 0], life: 1.6, size: 1.4, size1: 2.2, color: MIST_C, color1: MIST_C1, alpha: 0.16 * k, alpha1: 0, drag: 1, shape: 8, fadeIn: 0.3 }); }
        break;
      case 'frostfog':
        for (let i = 0; i < 2; i++) if (every(5)) { const p = pt(); V.norm.emit({ p: [p.x, p.y + randRange(0.2, 1.6), p.z], v: [randRange(-0.8, 0.8), randRange(-0.1, 0.3), randRange(-0.8, 0.8)], life: randRange(1.2, 1.8), size: 0.7, size1: randRange(1.8, 2.4), ease: 0.6, color: MIST_C, color1: MIST_C1, alpha: 0.26 * k, alpha1: 0, drag: 1, shape: 8, fadeIn: 0.25 }); }
        if (every(10)) V.burst(pt().setY(c.y + randRange(0.5, 2.5)), 'snowflake', 1, { spread: 0.3 });
        break;
      case 'puddle':
        if (every(0.9)) V.ring(pt(), PAL.water.core, randRange(0.4, 0.9), 0.7, { thick: 0.06, alpha: 0.35, y: 0.06, r0: 0.05 });
        if (every(2)) { const p = pt(); V.norm.emit({ p: [p.x, p.y + 0.05, p.z], v: [randRange(-0.2, 0.2), randRange(0.3, 0.7), randRange(-0.2, 0.2)], life: randRange(0.8, 1.3), size: 0.3, size1: 1.0, color: STEAM_C, color1: STEAM_C1, alpha: 0.1 * k, alpha1: 0, drag: 1, shape: 8, fadeIn: 0.2 }); }
        break;
      case 'steam':
      case 'shockfog':
        for (let i = 0; i < 2; i++) if (every(5)) { const p = pt(); V.norm.emit({ p: [p.x, p.y + randRange(0.1, 1.4), p.z], v: [randRange(-0.4, 0.4), randRange(0.4, 1.1), randRange(-0.4, 0.4)], life: randRange(1.3, 2.1), size: 0.8, size1: randRange(1.9, 2.6), ease: 0.6, color: STEAM_C, color1: STEAM_C1, alpha: 0.3 * k, alpha1: 0, drag: 1, grav: -0.2, shape: 8, fadeIn: 0.3 }); }
        if (f.kind === 'shockfog' && every(3.5)) { const a = pt().clone().setY(c.y + randRange(0.4, 2)); V.lightning(a, pt().clone().setY(c.y + randRange(0.4, 2)), { width: 0.05, dur: 0.16, branches: 1, segs: 8, jag: 0.25 }); if (rand() < 0.4) G.audio.play('zap', { pos: a, gap: 0.12, v: 0.5 }); }
        break;
      case 'charged':
      case 'shockwater':
        if (every(4)) { const a = pt().clone(); a.y += 0.1; V.lightning(a, pt().clone().setY(c.y + 0.15), { width: 0.045, dur: 0.14, branches: 0, segs: 8, jag: 0.28, color: f.kind === 'shockwater' ? PAL.water.core : undefined }); }
        if (every(6)) { const p = pt(); V.add.emit({ p: [p.x, p.y + 0.05, p.z], v: [randRange(-1.2, 1.2), randRange(0.5, 2), randRange(-1.2, 1.2)], life: randRange(0.1, 0.25), size: randRange(0.12, 0.24), size1: 0.03, color: PAL.storm.core, color1: PAL.storm.glow, alpha: k, alpha1: 0, drag: 5, shape: 13 }); }
        if (f.kind === 'shockwater' && every(0.8)) V.ring(pt(), PAL.storm.core, randRange(0.4, 0.8), 0.5, { thick: 0.06, alpha: 0.35, y: 0.06, r0: 0.05 });
        break;
    }
  }
}
