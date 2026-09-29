// Damage resolution, elemental statuses and reactions.
import * as THREE from 'three';
import { G, EL_INFO } from '../core/context.js';
import { randRange, rand, clamp } from '../core/util.js';
import { PAL } from '../render/vfx.js';

const tmp = new THREE.Vector3();

export const REACTIONS = {
  melt: { name: '융해', color: '#ffb070', desc: '얼어붙거나 한기가 쌓인 적에게 화염 → 큰 피해, 적이 젖는다.' },
  evaporate: { name: '증발', color: '#e8f4ff', desc: '젖은 적에게 화염 → 추가 피해.' },
  thermal: { name: '열충격', color: '#ffd0f0', desc: '불타는 적에게 서리 → 주변에 폭발 피해.' },
  flashfreeze: { name: '순간 빙결', color: '#8fe3ff', desc: '젖은 적에게 서리 → 즉시 얼어붙는다.' },
  shatter: { name: '파쇄', color: '#d8f6ff', desc: '얼어붙은 적에게 번개나 강한 마법 → 막대한 피해, 갑옷 파괴.' },
  conduct: { name: '감전 연쇄', color: '#fff27a', desc: '젖은 적에게 번개 → 주변의 모든 젖은 적에게 전류가 흐른다.' },
  overload: { name: '과부하', color: '#ff9a4a', desc: '불타는 적에게 번개 → 폭발, 갑옷 파괴.' },
  firestorm: { name: '화염 확산', color: '#ff7a3a', desc: '불타는 적에게 바람 → 주변 적에게 불이 옮겨붙는다.' },
  blizzard: { name: '눈보라', color: '#bfefff', desc: '한기 서린 적에게 바람 → 주변 적에게 한기가 퍼진다.' },
  stormspread: { name: '뇌전 확산', color: '#ffe45c', desc: '감전된 적에게 바람 → 주변 적도 감전된다.' },
  resonance: { name: '공명', color: '#c9a8ff', desc: '상태 이상에 걸린 적에게 비전 → 추가 피해.' },
  airborne: { name: '공중 강타', color: '#9fffd8', desc: '바람에 띄워진 적은 더 큰 피해를 받는다.' },
};

export function newStatus() {
  return { burn: 0, burnDmg: 0, burnTick: 0, chill: 0, chillT: 0, frozen: 0, shock: 0, stun: 0, wet: 0, armorBroken: 0, ice: null };
}

export class Combat {
  constructor() { this.killCount = 0; }

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

  resolve(t, h) {
    if (!t.alive) return 0;
    const st = t.st;
    const el = h.el || 'arcane';
    const P = h.dmg;
    let dmg = P;
    let reaction = null;
    let applyStatus = true;
    const c = t.center();
    const pos = h.pos || c;

    if (!h.noReact) {
      if (el === 'fire') {
        if (st.frozen > 0 || st.chill >= 1) reaction = 'melt';
        else if (st.wet > 0) reaction = 'evaporate';
      } else if (el === 'frost') {
        if (st.burn > 0) reaction = 'thermal';
        else if (st.wet > 0) reaction = 'flashfreeze';
      } else if (el === 'storm') {
        if (st.frozen > 0) reaction = 'shatter';
        else if (st.wet > 0) reaction = 'conduct';
        else if (st.burn > 0) reaction = 'overload';
      } else if (el === 'wind') {
        if (st.burn > 0) reaction = 'firestorm';
        else if (st.frozen > 0 || st.chill >= 1) reaction = 'blizzard';
        else if (st.shock > 0) reaction = 'stormspread';
      } else if (el === 'arcane') {
        if (st.burn > 0 || st.chill > 0 || st.frozen > 0 || st.shock > 0 || st.wet > 0) reaction = 'resonance';
      }
      if (!reaction && h.heavy && st.frozen > 0 && el !== 'frost') reaction = 'shatter';
    }

    let hs = h.hitstop ?? (h.heavy ? 0.06 : 0.035);
    let shake = h.shake ?? (h.heavy ? 0.22 : 0.06);
    const V = G.vfx, A = G.audio;
    switch (reaction) {
      case 'melt':
        dmg *= 2.2; st.frozen = 0; st.chill = 0; st.wet = 5; applyStatus = false;
        this.breakIce(t);
        V.burst(c, 'steam', 10, { size: 0.8 }); V.burst(c, 'ice', 10); V.burst(c, 'fire', 14, { speed: 4 });
        A.play('melt', { pos: c }); hs = 0.09; shake = 0.3;
        break;
      case 'evaporate':
        dmg *= 1.6; st.wet = 0; applyStatus = false;
        V.burst(c, 'steam', 12, { size: 0.9 }); A.play('steam', { pos: c }); hs = 0.07;
        break;
      case 'thermal': {
        dmg *= 1.8; st.burn = 0; applyStatus = false;
        V.burst(c, 'steam', 14); V.ring(c, PAL.frost.glow, 4, 0.4, { y: -0.8 }); V.flash(c, 0xbfe8ff, 50, 12, 0.3);
        A.play('steam', { pos: c });
        for (const o of this.others(t, c, 3.5)) this.hit(o, { dmg: P * 0.8, el: 'frost', noReact: true, pos: o.center(), dir: tmp.subVectors(o.center(), c).normalize().clone(), knock: 6 });
        hs = 0.09; shake = 0.3;
        break;
      }
      case 'flashfreeze':
        dmg *= 1.3; st.wet = 0; applyStatus = false;
        this.freeze(t, 3.2);
        hs = 0.08;
        break;
      case 'shatter': {
        dmg *= 3.0; st.frozen = 0; st.chill = 0; st.armorBroken = 8; applyStatus = el === 'storm' ? false : applyStatus;
        this.breakIce(t, true);
        V.burst(c, 'ice', 36, { speed: 11, size: 1.4 }); V.burst(c, 'frostmist', 10); V.burst(c, 'star', 1, { size: 5, el: 'frost' });
        V.ring(c, PAL.frost.core, 5, 0.45, { y: -0.8, thick: 0.25 });
        V.flash(c, 0xd8f6ff, 90, 16, 0.35);
        A.play('shatter', { pos: c });
        for (const o of this.others(t, c, 4.2)) this.hit(o, { dmg: P * 1.0, el: 'frost', noReact: true, pos: o.center(), knock: 8 });
        hs = 0.14; shake = 0.55;
        G.renderer.grade.uniforms.uImpact.value = Math.max(G.renderer.grade.uniforms.uImpact.value, 0.6);
        break;
      }
      case 'conduct': {
        dmg *= 1.5; st.wet = 0; st.stun = Math.max(st.stun, 1.5); applyStatus = false;
        const chained = [];
        for (const o of G.enemies.list) {
          if (!o.alive || o === t || !o.hittable || o.st.wet <= 0) continue;
          if (o.center().distanceTo(c) < 11) chained.push(o);
        }
        let from = c.clone();
        for (const o of chained) {
          const oc = o.center();
          V.lightning(from, oc, { width: 0.12, dur: 0.35, branches: 1 });
          o.st.wet = 0; o.st.stun = Math.max(o.st.stun, 1.5);
          this.hit(o, { dmg: P * 1.2, el: 'storm', noReact: true, pos: oc, hitstop: 0 });
          V.burst(oc, 'electric', 14);
          from = oc;
        }
        V.burst(c, 'electric', 20); V.flash(c, 0xffe86a, 60, 14, 0.3);
        A.play('chain', { pos: c });
        hs = 0.1; shake = 0.35;
        break;
      }
      case 'overload': {
        dmg *= 2.2; st.burn = 0; st.armorBroken = 8; applyStatus = false;
        V.burst(c, 'fire', 30, { speed: 7 }); V.burst(c, 'electric', 20); V.burst(c, 'ember', 16);
        V.ring(c, PAL.fire.glow, 5.5, 0.5, { y: -0.8, thick: 0.3 }); V.flash(c, 0xffa040, 90, 16, 0.4);
        A.play('overload', { pos: c });
        for (const o of this.others(t, c, 5)) this.hit(o, { dmg: P * 1.5, el: 'fire', noReact: true, pos: o.center(), dir: tmp.subVectors(o.center(), c).normalize().clone(), knock: 14, lift: 5 });
        h.knock = (h.knock || 0) + 12; h.lift = 5;
        hs = 0.12; shake = 0.5;
        G.renderer.grade.uniforms.uImpact.value = Math.max(G.renderer.grade.uniforms.uImpact.value, 0.5);
        break;
      }
      case 'firestorm': {
        dmg *= 1.4;
        V.burst(c, 'fire', 24, { speed: 6 }); V.burst(c, 'wind', 16, { radius: 1.5 });
        A.play('impact_fire', { pos: c });
        for (const o of this.others(t, c, 7)) {
          V.burst(o.center(), 'fire', 10);
          o.st.burn = Math.max(o.st.burn, 5); o.st.burnDmg = Math.max(o.st.burnDmg, P * 0.2);
          this.hit(o, { dmg: P * 0.6, el: 'fire', noReact: true, pos: o.center(), hitstop: 0 });
        }
        hs = 0.08;
        break;
      }
      case 'blizzard': {
        dmg *= 1.3;
        V.burst(c, 'frostmist', 14, { size: 1.2 }); V.burst(c, 'ice', 14);
        A.play('freeze', { pos: c });
        for (const o of this.others(t, c, 7)) { this.addChill(o, 2); this.hit(o, { dmg: P * 0.4, el: 'frost', noReact: true, pos: o.center(), hitstop: 0 }); }
        hs = 0.07;
        break;
      }
      case 'stormspread': {
        dmg *= 1.3;
        for (const o of this.others(t, c, 7)) { V.lightning(c, o.center(), { width: 0.08, dur: 0.25, branches: 0 }); o.st.shock = 3; o.st.stun = Math.max(o.st.stun, 0.6); this.hit(o, { dmg: P * 0.5, el: 'storm', noReact: true, pos: o.center(), hitstop: 0 }); }
        A.play('chain', { pos: c });
        break;
      }
      case 'resonance':
        dmg *= 1.3;
        V.burst(c, 'arcane', 8);
        break;
    }

    // airborne bonus
    if (t.airborne && h.source === 'player') { dmg *= 1.3; if (!reaction && h.heavy) reaction = 'airborne'; }

    // apply status of element
    if (applyStatus && !h.noStatus) this.applyStatus(t, el, h.status ?? 1, P);

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
      G.hitstop = Math.max(G.hitstop, hs);
      G.cameraRig.shake(shake);
      G.hud.damage(c, dmg, el, crit, reaction);
      if (reaction && REACTIONS[reaction]) G.hud.reaction(c, REACTIONS[reaction]);
      if (reaction && G.story) G.story.onReaction(reaction);
      A.play('hit_flesh', { pos: c, v: h.heavy ? 1 : 0.7 });
      V.burst(pos, 'spark', h.heavy ? 14 : 7, { el });
      V.burst(pos, 'star', 1, { el, size: h.heavy ? 3.5 : 2, life: 0.12 });
    }
    t.onHit && t.onHit(h, dmg, reaction);
    if (t.hp <= 0) {
      t.hp = 0;
      if (h.source !== 'enemy') { G.hitstop = Math.max(G.hitstop, 0.09); G.cameraRig.shake(0.2); }
      t.die(h);
    }
    return dmg;
  }

  applyStatus(t, el, amt, P) {
    const st = t.st;
    if (t.immune && t.immune.includes(el)) return;
    if (el === 'fire') { st.burn = Math.max(st.burn, 3 + 2 * amt); st.burnDmg = Math.max(st.burnDmg * 0.8, P * 0.14); }
    else if (el === 'frost') this.addChill(t, amt);
    else if (el === 'storm') { if (st.shock <= 0) st.stun = Math.max(st.stun, 0.35 * amt); st.shock = 2.5; }
    else if (el === 'wet') st.wet = Math.max(st.wet, 7);
  }

  addChill(t, n) {
    const st = t.st;
    if (st.frozen > 0) { st.frozen = Math.max(st.frozen, 1.5); return; }
    st.chill += n; st.chillT = 3.5;
    if (st.chill >= (t.freezeAt ?? 3)) { st.chill = 0; this.freeze(t, t.freezeTime ?? 3); }
  }

  freeze(t, dur) {
    const st = t.st;
    st.frozen = dur;
    G.audio.play('freeze', { pos: t.center() });
    G.vfx.burst(t.center(), 'frostmist', 8);
    if (!st.ice) {
      const g = new THREE.Group();
      const n = 6;
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(G.vfx.crystalGeo, G.vfx.iceMatT);
        const a = (i / n) * Math.PI * 2;
        const s = t.radius * 1.1;
        m.position.set(Math.cos(a) * t.radius * 0.5, 0, Math.sin(a) * t.radius * 0.5);
        m.rotation.set(Math.sin(a) * 0.5, a, Math.cos(a) * 0.5);
        m.scale.set(s, t.height * 0.55, s);
        g.add(m);
      }
      g.position.copy(t.pos);
      G.scene.add(g);
      st.ice = g;
    }
  }
  breakIce(t, big = false) {
    const st = t.st;
    if (st.ice) {
      G.scene.remove(st.ice);
      st.ice = null;
      G.vfx.burst(t.center(), 'ice', big ? 4 : 14);
      if (!big) G.audio.play('impact_frost', { pos: t.center() });
    }
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
    if (st.chill > 0) {
      st.chillT -= dt;
      if (st.chillT <= 0) { st.chill = Math.max(0, st.chill - 1); st.chillT = 1.5; }
      if (rand() < dt * 6 * st.chill) V.burst(c, 'frostmist', 1, { spread: 0.4, size: 0.4, alpha: 0.3 });
    }
    if (st.frozen > 0) {
      st.frozen -= dt;
      if (st.ice) st.ice.position.copy(t.pos);
      if (st.frozen <= 0) this.breakIce(t);
    }
    if (st.shock > 0) {
      st.shock -= dt;
      if (rand() < dt * 10) V.burst(tmp.copy(c).add(new THREE.Vector3(randRange(-0.4, 0.4), randRange(-0.5, 0.5), randRange(-0.4, 0.4))), 'electric', 2, { speed: 3 });
    }
    if (st.wet > 0) {
      st.wet -= dt;
      if (rand() < dt * 8) G.vfx.add.emit({ p: [c.x + randRange(-0.3, 0.3), c.y + randRange(0, 0.5), c.z + randRange(-0.3, 0.3)], v: [0, -2, 0], life: 0.5, size: 0.1, color: PAL.frost.glow, alpha: 0.8, alpha1: 0, grav: 9, shape: 2 });
    }
    if (st.stun > 0) st.stun -= dt;
    if (st.armorBroken > 0) st.armorBroken -= dt;
    let mul = 1;
    if (st.chill > 0) mul *= 1 - 0.18 * st.chill;
    if (st.shock > 0) mul *= 0.75;
    return clamp(mul, 0.2, 1);
  }

  clear(t) {
    this.breakIce(t);
    Object.assign(t.st, newStatus());
  }
}

export function elColor(el) { return EL_INFO[el]?.css ?? '#fff'; }
