// Damage resolution, elemental statuses and reactions (incl. skill-tree modifiers).
import * as THREE from 'three';
import { G, EL_INFO } from '../core/context.js';
import { randRange, rand, clamp } from '../core/util.js';
import { PAL } from '../render/vfx.js';

const tmp = new THREE.Vector3();

// els: [status that was on the target, element that triggers it] — used by the reaction codex.
export const REACTIONS = {
  melt: { name: '융해', color: '#ffb070', els: ['frost', 'fire'], desc: '얼어붙거나 한기가 쌓인 적에게 화염 → 2.2배 피해, 적이 젖는다.' },
  evaporate: { name: '증발', color: '#e8f4ff', els: ['water', 'fire'], desc: '젖은 적에게 화염 → 1.6배 피해.' },
  thermal: { name: '열충격', color: '#ffd0f0', els: ['fire', 'frost'], desc: '불타는 적에게 서리 → 1.8배, 주변에 폭발 피해.' },
  flashfreeze: { name: '순간 빙결', color: '#8fe3ff', els: ['water', 'frost'], desc: '젖은 적에게 서리, 또는 한기 서린 적에게 물 → 즉시 얼어붙는다.' },
  shatter: { name: '파쇄', color: '#d8f6ff', els: ['frost', 'storm'], desc: '얼어붙은 적에게 번개나 강한 마법 → 3배 피해, 주변 파편, 갑옷 파괴.' },
  conduct: { name: '감전 연쇄', color: '#fff27a', els: ['water', 'storm'], desc: '젖은 적에게 번개 → 주변의 젖은 적 모두에게 전류가 흐르고, 감전 지속 피해를 입힌다.' },
  overload: { name: '과부하', color: '#ff9a4a', els: ['fire', 'storm'], desc: '불타는 적에게 번개 → 폭발, 갑옷 파괴.' },
  firestorm: { name: '화염 확산', color: '#ff7a3a', els: ['fire', 'wind'], desc: '불타는 적에게 바람 → 주변 적에게 불이 옮겨붙는다.' },
  blizzard: { name: '눈보라', color: '#bfefff', els: ['frost', 'wind'], desc: '한기 서린 적에게 바람 → 주변 적에게 한기가 퍼진다.' },
  stormspread: { name: '뇌전 확산', color: '#ffe45c', els: ['storm', 'wind'], desc: '감전된 적에게 바람 → 주변 적도 감전된다.' },
  extinguish: { name: '소화', color: '#9cc8ff', els: ['fire', 'water'], desc: '불타는 적에게 물 → 불이 꺼지고 피해가 절반으로 줄어든다. (조화: 끓는 김으로 바뀐다)' },
  scald: { name: '끓는 김', color: '#ffe6d0', els: ['fire', 'water'], desc: '[조화] 불타는 적에게 물 → 끓는 김이 터져 1.6배 피해와 광역 피해.' },
  shortcircuit: { name: '누전', color: '#b8e4ff', els: ['storm', 'water'], desc: '감전된 적에게 물 → 1.4배 피해, 적이 경직되고 감전 지속 피해.' },
  superconduct: { name: '초전도', color: '#d9f0ff', els: ['frost', 'storm'], desc: '[조화] 한기만 서린 적에게 번개 → 1.6배 피해, 갑옷 파괴.' },
  monsoon: { name: '장대비', color: '#8ab8ff', els: ['water', 'wind'], desc: '[조화] 젖은 적에게 바람 → 물보라가 주변 적을 모두 적신다.' },
  resonance: { name: '공명', color: '#c9a8ff', els: ['*', 'arcane'], desc: '상태 이상에 걸린 적에게 비전 → 추가 피해.' },
  airborne: { name: '공중 강타', color: '#9fffd8', els: ['wind', '*'], desc: '바람에 띄워진 적은 더 큰 피해를 받는다.' },
};

export function newStatus() {
  return {
    burn: 0, burnDmg: 0, burnTick: 0, chill: 0, chillT: 0, frozen: 0, shock: 0, stun: 0, wet: 0, armorBroken: 0, ice: null,
    electro: 0, electroDmg: 0, electroTick: 0, steam: 0, bubble: 0, bubbleMesh: null, wetFrozen: false, thaw: 0,
  };
}

const K = () => G.skills;
const R = (id) => (G.skills ? G.skills.r(id) : 0);

export class Combat {
  constructor() { this.killCount = 0; this.hs = { frame: -1, base: 0, max: 0, sum: 0, light: -9 }; }

  // Hitstop aggregation: within one frame the strongest stop wins plus 30% of the
  // rest (capped), and light stops (< 0.04 s) are rate-limited so rapid multi-hit
  // spells (vortex ticks, crystal storm, beams) don't keep the game crawling.
  stop(v, force = false) {
    if (!(v > 0)) return;
    const S = this.hs, now = G.realTime;
    if (S.frame !== now) { S.frame = now; S.base = G.hitstop; S.max = 0; S.sum = 0; }
    if (v < 0.04 && !force) {
      if (S.max === 0 && now - S.light < 0.3) return;
      S.light = now;
    }
    S.max = Math.max(S.max, v); S.sum += v;
    G.hitstop = Math.max(S.base, Math.min(0.15, S.max + 0.3 * (S.sum - S.max)));
  }

  // lingering field under a target (reaction aftermath); skipped for high flyers
  leave(kind, t, o) {
    const F = G.spells && G.spells.fields;
    if (!F || !t.pos) return null;
    const g = t.pos.clone(); g.y = G.world.ground(g.x, g.z, g.y + 1);
    if (t.pos.y - g.y > 3) return null;
    return F.add(kind, g, { ...o, noGround: true });
  }

  others(target, pos, r) {
    const out = [];
    for (const e of G.enemies.list) {
      if (!e.alive || e === target || !e.hittable) continue;
      if (e.center().distanceTo(pos) < r + e.radius) out.push(e);
    }
    return out;
  }

  // ------------------------------------------------------------
  hit(target, h) {
    if (!target || !target.alive) return 0;
    if (target.receive) return target.receive(h);
    return this.resolve(target, h);
  }

  pickReaction(st, el, h) {
    if (h.noReact) return null;
    let r = null;
    if (el === 'fire') {
      if (st.frozen > 0 || st.chill >= 1) r = 'melt';
      else if (st.wet > 0) r = 'evaporate';
    } else if (el === 'frost') {
      if (st.burn > 0) r = 'thermal';
      else if (st.wet > 0) r = 'flashfreeze';
    } else if (el === 'storm') {
      if (st.frozen > 0) r = 'shatter';
      else if (st.wet > 0) r = 'conduct';
      else if (st.burn > 0) r = 'overload';
      else if (st.chill >= 1 && R('h_superconduct')) r = 'superconduct';
    } else if (el === 'wind') {
      if (st.burn > 0) r = 'firestorm';
      else if (st.frozen > 0 || st.chill >= 1) r = 'blizzard';
      else if (st.shock > 0) r = 'stormspread';
      else if (st.wet > 0 && R('h_monsoon')) r = 'monsoon';
    } else if (el === 'water') {
      if (st.burn > 0) r = R('h_scald') ? 'scald' : 'extinguish';
      else if (st.frozen > 0 || st.chill >= 1) r = 'flashfreeze';
      else if (st.shock > 0 || st.electro > 0) r = 'shortcircuit';
    } else if (el === 'arcane') {
      if (st.burn > 0 || st.chill > 0 || st.frozen > 0 || st.shock > 0 || st.wet > 0 || st.electro > 0) r = 'resonance';
    }
    if (!r && h.heavy && st.frozen > 0 && el !== 'frost' && el !== 'water') r = 'shatter';
    return r;
  }

  resolve(t, h) {
    if (!t.alive) return 0;
    const st = t.st;
    const el = h.el || 'arcane';
    const P = h.dmg;
    const byPlayer = h.source !== 'enemy' && h.source !== 'env' && h.source !== 'fall';
    let dmg = P;
    let reaction = this.pickReaction(st, el, h);
    let applyStatus = true;
    const c = t.center();
    const pos = h.pos || c;

    let hs = h.hitstop ?? (h.heavy ? 0.06 : 0.035);
    let shake = h.shake ?? (h.heavy ? 0.22 : 0.06);
    const V = G.vfx, A = G.audio;
    const impact = (v) => { G.renderer.grade.uniforms.uImpact.value = Math.max(G.renderer.grade.uniforms.uImpact.value, v); };
    switch (reaction) {
      case 'melt':
        dmg *= 2.2 * (R('h_thermal') ? 1.4 : 1); st.frozen = 0; st.chill = 0; st.wet = 5; st.wetFrozen = false; applyStatus = false;
        this.breakIce(t);
        this.leave('puddle', t, { r: 2, dur: 4 });
        V.react('melt', c);
        A.play('melt', { pos: c }); A.play('steam', { pos: c, v: 0.5 }); hs = 0.09; shake = 0.3;
        break;
      case 'evaporate':
        dmg *= 1.6; st.wet = 0; applyStatus = false;
        this.leave('steam', t, { r: 2.2, dur: 3 });
        V.react('evaporate', c); A.play('steam', { pos: c }); A.play('sizzle', { pos: c, d: 0.4 }); hs = 0.07;
        break;
      case 'thermal': {
        const big = R('h_thermal');
        dmg *= 1.8 * (big ? 1.4 : 1); st.burn = 0; applyStatus = false;
        if (!(t.immune && t.immune.includes('water'))) st.wet = Math.max(st.wet, 4);
        const rr = big ? 5 : 3.5;
        V.react('thermal', c, { r: rr });
        A.play('react_thermal', { pos: c });
        for (const o of this.others(t, c, rr)) this.hit(o, { dmg: P * 0.8, el: 'frost', noReact: true, pos: o.center(), dir: tmp.subVectors(o.center(), c).normalize().clone(), knock: 6 });
        hs = 0.09; shake = 0.3;
        break;
      }
      case 'flashfreeze': {
        dmg *= 1.3; st.wet = 0; applyStatus = false;
        const perma = R('h_permafrost');
        this.freeze(t, 3.2 * (perma ? 2 : 1));
        if (perma) st.wetFrozen = true;
        this.leave('rime', t, { r: 1.8, dur: 3.5 });
        V.react('flashfreeze', c);
        A.play('react_flashfreeze', { pos: c });
        hs = 0.08; shake = 0.2;
        break;
      }
      case 'shatter': {
        const br = R('i_brittle');
        dmg *= 3.0 * (1 + 0.3 * br) * (st.wetFrozen && R('h_permafrost') ? 1.4 : 1);
        st.frozen = 0; st.chill = 0; st.armorBroken = 8; st.wetFrozen = false; applyStatus = el === 'storm' ? false : applyStatus;
        this.breakIce(t, true);
        const rr = 4.2 * (1 + 0.25 * br);
        st.chill = Math.max(st.chill, 1); st.chillT = 3.5; // ice dust clings: the next frost hit refreezes sooner
        this.leave('rime', t, { r: Math.min(4, rr * 0.6), dur: 3.5 });
        V.react('shatter', c, { r: rr });
        A.play('shatter', { pos: c });
        for (const o of this.others(t, c, rr)) this.hit(o, { dmg: P * 1.0, el: 'frost', noReact: true, pos: o.center(), knock: 8 });
        hs = 0.14; shake = 0.55; impact(0.6);
        break;
      }
      case 'conduct': {
        dmg *= 1.5; st.wet = 0; st.stun = Math.max(st.stun, 1.5); applyStatus = false;
        const rain = R('h_thunderrain'), cond = R('s_conduct');
        const range = 11 * (1 + 0.3 * cond) * (rain ? 1.5 : 1);
        const eDmg = P * 0.2 * (1 + 0.4 * cond) * (rain ? 2 : 1);
        this.electrify(t, eDmg, 4);
        const chained = [];
        for (const o of G.enemies.list) {
          if (!o.alive || o === t || !o.hittable || !o.st || o.st.wet <= 0) continue;
          if (o.center().distanceTo(c) < range) chained.push(o);
        }
        let from = c.clone();
        for (const o of chained) {
          const oc = o.center();
          V.lightning(from, oc, { width: 0.12, dur: 0.35, branches: 1 });
          V.lightning(from, oc, { width: 0.04, dur: 0.22, branches: 0, jag: 0.2, segs: 10, color: PAL.water.core, glow: PAL.water.glow });
          o.st.wet = 0; o.st.stun = Math.max(o.st.stun, 1.5);
          this.hit(o, { dmg: P * 1.2, el: 'storm', noReact: true, pos: oc, hitstop: 0 });
          this.electrify(o, eDmg, 4);
          V.burst(oc, 'electric', 14);
          from = oc;
        }
        this.leave('shockwater', t, { r: 2.4, dur: 2.5 });
        V.react('conduct', c);
        A.play('chain', { pos: c }); A.play('splash', { pos: c, v: 0.5 });
        hs = 0.1; shake = 0.35;
        break;
      }
      case 'overload': {
        const oc = R('s_overload');
        dmg *= 2.2 * (1 + 0.25 * oc); st.burn = 0; st.armorBroken = 8; applyStatus = false;
        const rr = 5 * (1 + 0.2 * oc);
        V.react('overload', c, { r: rr });
        A.play('overload', { pos: c });
        for (const o of this.others(t, c, rr)) this.hit(o, { dmg: P * 1.5, el: 'fire', noReact: true, pos: o.center(), dir: tmp.subVectors(o.center(), c).normalize().clone(), knock: 14, lift: 5 });
        h.knock = (h.knock || 0) + 12; h.lift = 5;
        if (R('h_firebolt')) this.leave('plasma', t, { r: 3.2, dur: 3, dmg: P * 0.35 });
        else this.leave('blaze', t, { r: 2.2, dur: 2.5, dmg: P * 0.12 });
        hs = 0.12; shake = 0.5; impact(0.5);
        break;
      }
      case 'firestorm': {
        dmg *= 1.4;
        const cr = R('w_carrier');
        const rr = 7 * (1 + 0.3 * cr);
        V.react('firestorm', c, { r: rr });
        A.play('react_firestorm', { pos: c });
        const lit = [];
        for (const o of this.others(t, c, rr)) {
          V.burst(o.center(), 'fire', 10);
          V.lightning(c, o.center(), { color: PAL.fire.core, glow: PAL.fire.glow, width: 0.1, dur: 0.25, branches: 0, jag: 0.08, segs: 8 });
          this.ignite(o, 5 + 2 * cr, P * (0.2 + 0.05 * cr));
          this.hit(o, { dmg: P * 0.6, el: 'fire', noReact: true, pos: o.center(), hitstop: 0 });
          lit.push(o);
        }
        if (R('h_wildfire')) {
          G.later(() => {
            for (const s of lit) {
              if (!s.alive) continue;
              for (const o of this.others(s, s.center(), 5)) if (!lit.includes(o) && o !== t) { this.ignite(o, 5, P * 0.2); V.burst(o.center(), 'fire', 8); V.lightning(s.center(), o.center(), { color: PAL.fire.core, glow: PAL.fire.glow, width: 0.06, dur: 0.2, branches: 0 }); }
            }
          }, 450);
        }
        hs = 0.08;
        break;
      }
      case 'blizzard': {
        dmg *= 1.3;
        const cr = R('w_carrier');
        V.react('blizzard', c, { r: 7 * (1 + 0.3 * cr) });
        A.play('react_blizzard', { pos: c });
        for (const o of this.others(t, c, 7 * (1 + 0.3 * cr))) { V.sparks(c, tmp.subVectors(o.center(), c).normalize(), 5, { el: 'frost', spread: 0.15, speed: 18, grav: 0, life: 0.35, w: 0.035 }); this.addChill(o, 2 + cr); this.hit(o, { dmg: P * 0.4, el: 'frost', noReact: true, pos: o.center(), hitstop: 0 }); }
        hs = 0.07;
        break;
      }
      case 'stormspread': {
        dmg *= 1.3;
        const cr = R('w_carrier');
        for (const o of this.others(t, c, 7 * (1 + 0.3 * cr))) { V.lightning(c, o.center(), { width: 0.08, dur: 0.25, branches: 0 }); o.st.shock = 3 + cr; o.st.stun = Math.max(o.st.stun, 0.6); this.hit(o, { dmg: P * 0.5, el: 'storm', noReact: true, pos: o.center(), hitstop: 0 }); }
        V.react('stormspread', c, { r: 7 * (1 + 0.3 * cr) });
        A.play('react_stormspread', { pos: c });
        break;
      }
      case 'extinguish': {
        dmg *= 0.5; st.burn = 0; applyStatus = true;
        V.react('extinguish', c);
        A.play('react_extinguish', { pos: c }); A.play('fizzle', { pos: c });
        this.steamCloud(c, t);
        hs = 0.04;
        break;
      }
      case 'scald': {
        dmg *= 1.6; st.burn = 0; applyStatus = true;
        V.react('scald', c, { r: 3.5 });
        A.play('react_scald', { pos: c }); A.play('steam', { pos: c, v: 0.6 });
        for (const o of this.others(t, c, 3.5)) this.hit(o, { dmg: P * 0.8, el: 'fire', noReact: true, noStatus: true, pos: o.center(), dir: tmp.subVectors(o.center(), c).normalize().clone(), knock: 7, lift: 3 });
        this.steamCloud(c, t);
        if (!R('wa_steam')) this.leave('steam', t, { r: 2.4, dur: 3 });
        hs = 0.1; shake = 0.35; impact(0.35);
        break;
      }
      case 'shortcircuit': {
        dmg *= 1.4; st.stun = Math.max(st.stun, 0.8); applyStatus = true;
        this.electrify(t, P * 0.18 * (1 + 0.4 * R('s_conduct')), 3);
        V.react('shortcircuit', c);
        A.play('react_shortcircuit', { pos: c }); A.play('fizzle', { pos: c });
        hs = 0.08; shake = 0.25;
        break;
      }
      case 'superconduct': {
        dmg *= 1.6; st.armorBroken = 8; applyStatus = true;
        V.react('superconduct', c);
        A.play('react_superconduct', { pos: c }); A.play('impact_storm', { pos: c });
        hs = 0.1; shake = 0.3;
        break;
      }
      case 'monsoon': {
        dmg *= 1.2;
        V.react('monsoon', c, { r: 6 });
        A.play('react_monsoon', { pos: c }); A.play('splash', { pos: c });
        for (const o of this.others(t, c, 6)) { o.st.wet = Math.max(o.st.wet, R('wa_soak') ? 12 : 7); V.burst(o.center(), 'water', 8); V.sparks(c, tmp.subVectors(o.center(), c).normalize(), 4, { el: 'water', spread: 0.2, speed: 14, grav: 6, life: 0.4 }); }
        hs = 0.06;
        break;
      }
      case 'resonance': {
        const ec = R('a_echo');
        dmg *= [1.3, 1.55, 1.8][ec];
        if (ec) { if (st.burn > 0) st.burn += ec; if (st.shock > 0) st.shock += ec; if (st.wet > 0) st.wet += ec; if (st.frozen > 0) st.frozen += ec * 0.5; if (st.electro > 0) st.electro += ec; }
        V.react('resonance', c);
        A.play('react_resonance', { pos: c, gap: 0.08 });
        if (R('h_prism')) {
          let n = 0;
          if (st.burn > 0) { n++; st.burn = 0; V.burst(c, 'fire', 12, { speed: 5 }); }
          if (st.frozen > 0 || st.chill > 0) { n++; st.chill = 0; V.burst(c, 'ice', 12, { speed: 5 }); }
          if (st.shock > 0 || st.electro > 0) { n++; st.shock = 0; st.electro = 0; V.burst(c, 'electric', 12, { speed: 5 }); }
          if (st.wet > 0) { n++; st.wet = 0; V.burst(c, 'water', 12, { speed: 5 }); }
          if (n) {
            dmg *= 1 + 0.3 * n;
            V.react('prism', c, { r: 3 + n });
            A.play('react_prism', { pos: c }); hs = 0.06 + n * 0.02; shake = 0.15 + n * 0.08;
          }
        }
        break;
      }
    }

    // airborne bonus
    if (t.airborne && h.source === 'player') { dmg *= 1.3; if (!reaction && h.heavy) { reaction = 'airborne'; V.react('airborne', c); } }

    // apply status of element
    if (applyStatus && !h.noStatus) this.applyStatus(t, el, h.status ?? 1, P);

    // tree-driven vulnerability
    if (byPlayer) {
      if (st.burn > 0 && R('f_kindle')) dmg *= 1 + 0.08 * R('f_kindle');
      if ((st.shock > 0 || st.electro > 0) && R('s_static')) dmg *= 1.12;
    }

    // resistances & armor
    dmg *= t.resist?.[el] ?? 1;
    if (t.armor && st.armorBroken <= 0 && !reaction) { dmg *= 1 - t.armor; if (h.source === 'player') A.play('hit_armor', { pos: c }); }
    if (t.vulnerable) dmg *= 1.5;
    let crit = false;
    if (h.source === 'player' && rand() < 0.08) { crit = true; dmg *= 1.6; }
    dmg = Math.max(1, Math.round(dmg * randRange(0.94, 1.06)));

    t.hp -= dmg;
    t.lastHitT = G.time;
    t.poise = (t.poise ?? 0) + dmg * (reaction ? 2.2 : h.heavy ? 1.4 : 0.6);

    // feedback
    if (h.source !== 'enemy' && h.source !== 'dot') {
      this.stop(hs + (crit ? 0.025 : 0), !!reaction || crit);
      G.cameraRig.shake(shake);
      G.hud.damage(c, dmg, el, crit, reaction);
      if (reaction && REACTIONS[reaction]) {
        G.hud.reaction(c, REACTIONS[reaction]);
        if (K() && K().discover(reaction)) G.hud.discovered && G.hud.discovered(reaction);
      }
      if (reaction && G.story) G.story.onReaction(reaction);
      if (reaction && G.player) G.player.stats.reactions++;
      if (reaction && reaction !== 'airborne' && byPlayer) this.chainUp(reaction);
      // reactions feed the mana pool (+3 each) so mixing elements sustains casting
      if (reaction && reaction !== 'airborne' && h.source === 'player' && G.player && G.player.gainMana) G.player.gainMana(3, { src: 'reaction' });
      const big = !!h.heavy || !!reaction;
      A.play('hit', { pos: c, el, heavy: big, v: h.heavy ? 1 : 0.8, gap: 0.03 });
      if (crit) A.play('crit', { pos: c, gap: 0.05 });
      const hd = h.dir || (G.camera ? tmp.subVectors(c, G.camera.position).normalize() : null);
      V.hit(pos, hd, el, { heavy: big, crit });
      if (byPlayer && G.cameraRig.kick) {
        G.cameraRig.kick(hd, (reaction ? 0.3 : h.heavy ? 0.2 : 0.06) + (crit ? 0.1 : 0));
        if (reaction && shake >= 0.3 && G.cameraRig.punchFov) G.cameraRig.punchFov(1.5 + shake * 3);
      }
      if (byPlayer && K()) K().charge(reaction ? 7 : h.heavy ? 2.5 : 1.2);
    }
    t.onHit && t.onHit(h, dmg, reaction);
    if (t.hp <= 0) {
      t.hp = 0;
      if (h.source !== 'enemy') { this.stop(h.source === 'dot' ? 0.05 : 0.09, true); G.cameraRig.shake(0.2); }
      if (byPlayer) {
        A.play('kill', { pos: c, gap: 0.06 });
        V.kill(c, el);
        if (h.source !== 'dot' && G.cameraRig.kick) G.cameraRig.kick(h.dir || tmp.subVectors(c, G.camera.position).normalize(), 0.25);
      }
      if (byPlayer) this.onKill(t);
      this.popBubble(t);
      t.die(h);
    }
    return dmg;
  }

  // Reaction chain: reactions within 4s of each other build a streak that
  // charges the ultimate gauge faster and pays out bonus XP when it ends.
  chainUp(reaction) {
    const c = this.chain || (this.chain = { n: 0, t: 0, kinds: new Set() });
    if (G.time - c.t > 4) { c.n = 0; c.kinds.clear(); }
    c.n++; c.t = G.time; c.kinds.add(reaction);
    if (c.n >= 2) {
      if (K()) K().charge(1.5 * Math.min(c.n, 6));
      G.hud.chain && G.hud.chain(c.n, c.kinds.size);
      if (c.n === 5 || c.n === 10) G.audio.play('ult_ready');
    }
    const id = (this.chainId = (this.chainId || 0) + 1);
    G.later(() => {
      if (id !== this.chainId) return;
      if (c.n >= 3 && G.player && G.state === 'play') {
        const xp = Math.round(c.n * 2 + c.kinds.size * 4);
        G.player.addXP(xp);
        G.hud.chainEnd && G.hud.chainEnd(c.n, xp);
      }
      c.n = 0; c.kinds.clear();
    }, 4200);
  }

  // kill-time tree effects (before die() clears statuses)
  onKill(t) {
    const st = t.st, c = t.center(), V = G.vfx;
    if (K()) K().charge(t.elite ? 15 : t.boss ? 30 : 6);
    if (st.burn > 0 && R('f_ashwalk')) {
      const P = G.player; P.mana = Math.min(P.maxMana, P.mana + 8);
      for (const o of this.others(t, c, 5)) { this.ignite(o, 5, st.burnDmg || 3); V.lightning(c, o.center(), { color: PAL.fire.core, glow: PAL.fire.glow, width: 0.07, dur: 0.22, branches: 0 }); }
      V.burst(c, 'ember', 20, { speed: 7 });
    }
    if (st.frozen > 0 && R('i_splinter')) {
      const P = G.player.power();
      V.burst(c, 'ice', 30, { speed: 10, size: 1.2 }); V.ring(c, PAL.frost.core, 5, 0.4, { y: -0.8, thick: 0.25 });
      G.audio.play('shatter', { pos: c, v: 0.7 });
      V.sparks(c, null, 20, { pal: PAL.frost, speed: 18, grav: 10, life: 0.5, w: 0.05 });
      for (const o of this.others(t, c, 4.5)) { this.hit(o, { dmg: P, el: 'frost', noReact: true, pos: o.center(), knock: 6, hitstop: 0 }); this.addChill(o, 2); }
    }
  }

  applyStatus(t, el, amt, P) {
    const st = t.st;
    if (!st) return;
    if (t.immune && t.immune.includes(el)) return;
    if (el === 'fire') this.ignite(t, 3 + 2 * amt + 2 * R('f_kindle'), P * 0.14 * (1 + 0.15 * R('f_heat')));
    else if (el === 'frost') this.addChill(t, amt * (1 + 0.3 * R('i_deep')));
    else if (el === 'storm') { if (st.shock <= 0) st.stun = Math.max(st.stun, 0.35 * amt); st.shock = 2.5 + (R('s_static') ? 1.5 : 0); }
    else if (el === 'water' || el === 'wet') { st.wet = Math.max(st.wet, R('wa_soak') ? 12 : 7); if (st.burn > 0) st.burn = 0; }
  }

  ignite(t, dur, dmg) {
    const st = t.st;
    if (!st || (t.immune && t.immune.includes('fire'))) return;
    if (st.wet > 0) { st.wet = Math.max(0, st.wet - 3); G.vfx.burst(t.center(), 'steam', 3); return; }
    st.burn = Math.max(st.burn, dur); st.burnDmg = Math.max(st.burnDmg * 0.8, dmg);
  }

  electrify(t, dmg, dur) {
    const st = t.st;
    if (!st || (t.immune && t.immune.includes('storm'))) return;
    st.electro = Math.max(st.electro, dur); st.electroDmg = Math.max(st.electroDmg * 0.7, dmg); st.electroTick = Math.min(st.electroTick || 0.5, 0.5);
  }

  steamCloud(c, t) {
    const lv = R('wa_steam');
    if (!lv) return;
    const rr = 3 + lv, dur = 2 + lv;
    G.vfx.burst(c, 'steam', 18, { spread: rr * 0.6, size: 1.5 });
    for (const o of [t, ...this.others(t, c, rr)]) if (o.st) o.st.steam = Math.max(o.st.steam, dur);
    this.leave('steam', t, { r: rr * 0.8, dur: dur + 1 });
  }

  addChill(t, n) {
    const st = t.st;
    if (!st) return;
    if (st.frozen > 0) { st.frozen = Math.max(st.frozen, 1.5); return; }
    // just thawed: chill still builds (and slows) but cannot refreeze yet, so rime
    // fields and frost spam can't lock an enemy down forever
    if (st.thaw > 0) { st.chill = Math.min(st.chill + n * 0.5, (t.freezeAt ?? 3) - 0.25); st.chillT = 3.5; return; }
    st.chill += n; st.chillT = 3.5;
    if (st.chill >= (t.freezeAt ?? 3)) { st.chill = 0; this.freeze(t, t.freezeTime ?? 3); }
  }

  freeze(t, dur) {
    const st = t.st;
    st.frozen = dur + (t.boss ? 0 : 0.6 * R('i_deep'));
    G.audio.play('freeze', { pos: t.center() });
    G.vfx.burst(t.center(), 'frostmist', 8);
    G.vfx.burst(t.center(), 'shard', 6, { speed: 4 });
    if (t.pos && t.rig) G.vfx.decal(t.pos, 'frost', Math.max(1.2, t.radius * 2.2), { dur: Math.min(12, dur + 2) });
    if (!st.ice && t.pos && t.rig) {
      const g = new THREE.Group();
      const n = 6;
      // a ring of leaning ice prisms encasing the body
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(G.vfx.iceGeo ? G.vfx.iceGeo(i) : G.vfx.crystalGeo, G.vfx.iceMatT);
        const a = (i / n) * Math.PI * 2 + rand() * 0.3;
        const s = t.radius * randRange(1.3, 1.8);
        m.position.set(Math.cos(a) * t.radius * 0.45, -0.1, Math.sin(a) * t.radius * 0.45);
        m.rotation.set(Math.sin(a) * 0.35, a, -Math.cos(a) * 0.35);
        m.scale.set(s, t.height * randRange(0.42, 0.6), s);
        g.add(m);
      }
      g.position.copy(t.pos);
      G.scene.add(g);
      st.ice = g;
    }
  }
  breakIce(t, big = false) {
    const st = t.st;
    if (st && st.ice) {
      G.scene.remove(st.ice);
      st.ice = null;
      G.vfx.burst(t.center(), 'ice', big ? 4 : 14);
      if (!big) G.audio.play('impact_frost', { pos: t.center() });
    }
  }

  bubble(t, dur) {
    const st = t.st;
    if (!st || t.boss || !t.rig) return;
    st.bubble = Math.max(st.bubble, dur);
    if (!st.bubbleMesh) {
      st.bubbleMesh = G.vfx.orb('water', Math.max(t.radius, t.height * 0.5) * 1.35);
      st.bubbleMesh.material.uniforms.uIntensity.value = 0.55;
      st.bubbleMesh.renderOrder = 13;
      st.bubbleBase = t.pos.y;
    }
    G.audio.play('impact_water', { pos: t.center() });
  }
  popBubble(t) {
    const st = t.st;
    if (!st || !st.bubbleMesh) return;
    G.vfx.burst(t.center(), 'water', 24, { speed: 6 }); G.vfx.burst(t.center(), 'splash', 8);
    G.vfx.crown(t.center(), 18, { speed: 7 });
    if (t.pos) G.vfx.decal(t.pos, 'wet', 2.2);
    G.audio.play('splash', { pos: t.center() }); G.audio.play('impact_water', { pos: t.center() });
    G.vfx.disposeOrb(st.bubbleMesh); st.bubbleMesh = null; st.bubble = 0;
  }

  // per-frame status ticking; returns movement multiplier
  tick(t, dt) {
    const st = t.st;
    const c = t.center();
    const V = G.vfx;
    if (st.burn > 0) {
      st.burn -= dt; st.burnTick -= dt;
      if (rand() < dt * 25) V.burst(tmp.copy(c).add(new THREE.Vector3(randRange(-0.3, 0.3), randRange(-0.5, 0.6) * t.height * 0.5, randRange(-0.3, 0.3))), 'fire', 1, { spread: 0.2, size: 0.8 });
      if (st.burnTick <= 0) {
        st.burnTick = 0.5;
        this.hit(t, { dmg: st.burnDmg, el: 'fire', noReact: true, noStatus: true, pos: c, hitstop: 0, shake: 0, source: 'dot' });
        if (t.alive) G.hud.damage(c, Math.max(1, Math.round(st.burnDmg)), 'fire', false, null, true);
      }
      if (st.wet > 0) { st.burn = 0; V.burst(c, 'steam', 3); }
    }
    if (st.electro > 0 && t.alive) {
      st.electro -= dt; st.electroTick -= dt;
      if (rand() < dt * 14) V.burst(tmp.copy(c).add(new THREE.Vector3(randRange(-0.5, 0.5), randRange(-0.6, 0.6), randRange(-0.5, 0.5))), 'electric', 1, { speed: 2 });
      if (st.electroTick <= 0) {
        st.electroTick = 0.5;
        st.stun = Math.max(st.stun, 0.08);
        if (rand() < 0.6) V.lightning(c, tmp.copy(c).add(new THREE.Vector3(randRange(-1, 1), randRange(-0.8, 1), randRange(-1, 1))), { width: 0.04, dur: 0.12, branches: 0, segs: 6 });
        this.hit(t, { dmg: st.electroDmg, el: 'storm', noReact: true, noStatus: true, pos: c, hitstop: 0, shake: 0, source: 'dot' });
        if (t.alive) G.hud.damage(c, Math.max(1, Math.round(st.electroDmg)), 'storm', false, null, true);
      }
    }
    if (st.chill > 0) {
      st.chillT -= dt;
      if (st.chillT <= 0) { st.chill = Math.max(0, st.chill - 1); st.chillT = 1.5; }
      if (rand() < dt * 6 * st.chill) V.burst(c, 'frostmist', 1, { spread: 0.4, size: 0.4, alpha: 0.3 });
      if (rand() < dt * 3 * st.chill) V.burst(c, 'snowflake', 1, { spread: 0.5 });
    }
    if (st.frozen > 0) {
      st.frozen -= dt;
      if (st.ice) st.ice.position.copy(t.pos);
      if (st.frozen <= 0) { this.breakIce(t); st.wetFrozen = false; st.thaw = t.boss ? 5 : 2.5; }
    }
    if (st.shock > 0) {
      st.shock -= dt;
      if (rand() < dt * 10) V.burst(tmp.copy(c).add(new THREE.Vector3(randRange(-0.4, 0.4), randRange(-0.5, 0.5), randRange(-0.4, 0.4))), 'electric', 2, { speed: 3 });
    }
    if (st.wet > 0) {
      st.wet -= dt;
      if (rand() < dt * 8) G.vfx.norm.emit({ p: [c.x + randRange(-0.3, 0.3), c.y + randRange(0, 0.5), c.z + randRange(-0.3, 0.3)], v: [0, -2, 0], life: 0.5, size: 0.09, size1: 0.06, color: WET_C, color1: WET_C1, alpha: 0.9, alpha1: 0.3, grav: 9, shape: 9 });
    }
    if (st.steam > 0) {
      st.steam -= dt;
      if (rand() < dt * 5) V.burst(c, 'steam', 1, { spread: 0.6, size: 0.7 });
    }
    if (st.bubble > 0) {
      st.bubble -= dt;
      st.stun = Math.max(st.stun, 0.1);
      if (t.vel) { const want = (st.bubbleBase ?? t.pos.y) + 1.2; t.vel.y = Math.max(t.vel.y, (want - t.pos.y) * 4 + 24 * dt); }
      if (st.bubbleMesh) { st.bubbleMesh.position.copy(t.center()); st.bubbleMesh.rotation.y += dt; st.bubbleMesh.scale.setScalar(Math.max(t.radius, t.height * 0.5) * 1.35 * (1 + Math.sin(G.time * 6) * 0.04)); }
      if (st.bubble <= 0 || !t.alive) this.popBubble(t);
    }
    if (st.stun > 0) st.stun -= dt;
    if (st.thaw > 0) st.thaw -= dt;
    if (st.armorBroken > 0) st.armorBroken -= dt;
    let mul = 1;
    if (st.chill > 0) mul *= 1 - 0.18 * Math.min(st.chill, 4);
    if (st.shock > 0) mul *= 0.75;
    if (st.steam > 0) mul *= 0.6;
    if (st.wet > 0 && R('wa_soak')) mul *= 0.85;
    return clamp(mul, 0.2, 1);
  }

  clear(t) {
    this.breakIce(t);
    this.popBubble(t);
    Object.assign(t.st, newStatus());
  }
}

const WET_C = new THREE.Color(0.8, 0.92, 1.05), WET_C1 = new THREE.Color(0.6, 0.8, 1.0);
export function elColor(el) { return EL_INFO[el]?.css ?? '#fff'; }
