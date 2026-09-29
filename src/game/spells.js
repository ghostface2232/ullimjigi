// Spells: bolts (LMB), signature spells (RMB) and weaves (Q, two elements fused).
import * as THREE from 'three';
import { G, EL_INFO } from '../core/context.js';
import { PAL } from '../render/vfx.js';
import { randRange, rand, clamp, pick } from '../core/util.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

export const BOLT = {
  arcane: { name: '비전 화살', cost: 0, cd: 0.26, desc: '빠르고 정확한 기본 마법. 마나를 쓰지 않는다.' },
  fire: { name: '불씨 탄', cost: 3, cd: 0.34, desc: '적을 불태운다. 한기 서린 적을 녹여 큰 피해(융해).' },
  wind: { name: '바람 칼날', cost: 3, cd: 0.36, desc: '여러 적을 꿰뚫고 밀어낸다. 불·한기·전기를 퍼뜨린다.' },
  frost: { name: '서리 파편', cost: 3, cd: 0.4, desc: '세 갈래 얼음 파편. 한기가 세 번 쌓이면 얼어붙는다. 물을 얼린다.' },
  storm: { name: '전격', cost: 4, cd: 0.42, desc: '즉시 적중하고 옆의 적에게 튄다. 젖은 적·언 적에게 치명적.' },
};
export const HEAVY = {
  arcane: { name: '비전 파동', cost: 18, cd: 3.5, desc: '주위를 밀쳐내는 충격파. 적의 투사체를 지운다.' },
  fire: { name: '화염구', cost: 26, cd: 4, desc: '거대한 불덩이가 폭발하며 넓은 범위를 불태운다.' },
  wind: { name: '돌풍', cost: 20, cd: 3.2, desc: '전방의 적을 공중으로 띄운다. 공중에서 쓰면 상승 기류를 탄다.' },
  frost: { name: '서리 창', cost: 24, cd: 4, desc: '땅을 따라 얼음 가시가 솟구친다. 물 위엔 얼음 길을 만든다.' },
  storm: { name: '낙뢰', cost: 28, cd: 4.5, desc: '조준한 곳에 하늘의 번개를 내리꽂는다.' },
};
export const WEAVE = {
  'fire+frost': { name: '증기 폭발', desc: '거대한 증기 폭발. 휘말린 적은 모두 젖는다 — 번개와 함께라면.' },
  'fire+storm': { name: '플라즈마 구체', desc: '느리게 나아가며 주변 적을 지지다 폭발하는 구체.' },
  'fire+wind': { name: '화염 회오리', desc: '적을 빨아들이며 불태우는 회오리가 앞으로 나아간다.' },
  'frost+storm': { name: '결정 폭풍', desc: '얼음 파편과 번개가 한 지역에 쏟아진다. 파쇄가 연달아 일어난다.' },
  'frost+wind': { name: '눈보라 장막', desc: '주위에 눈보라를 두른다. 적은 얼어붙고, 받는 피해가 줄어든다.' },
  'storm+wind': { name: '뇌운', desc: '적을 쫓아다니며 번개를 내리치는 먹구름.' },
  arcane: { name: '비전 광선', desc: '짝지은 속성으로 물든 광선을 내뿜는다. 계속 조준할 수 있다.' },
};
export const WEAVE_COST = 40, WEAVE_CD = 9;
export function weaveInfo(a, b) {
  if (!a || !b || a === b) return null;
  if (a === 'arcane' || b === 'arcane') {
    const x = a === 'arcane' ? b : a;
    return { key: 'arcane', el: x, els: [a, b], name: `비전 광선 · ${EL_INFO[x].name}`, desc: WEAVE.arcane.desc };
  }
  const key = [a, b].sort().join('+');
  return { key, els: [a, b], ...WEAVE[key] };
}

// ------------------------------------------------------------------
export class Spells {
  constructor() {
    this.list = [];
    this.zones = [];
    this.channel = null;
    const cg = new THREE.TorusGeometry(0.7, 0.07, 4, 18, Math.PI * 0.9);
    cg.rotateZ(Math.PI * 0.05);
    this.crescentGeo = cg;
    this.shardGeo = new THREE.OctahedronGeometry(0.12, 0); this.shardGeo.scale(0.7, 0.7, 2.6);
  }

  get enemies() { return G.enemies.list; }

  // ------------------------------------------------------------
  projectile(o) {
    const p = {
      owner: 'player', el: 'arcane', r: 0.25, life: 2, dmg: 10, heavy: false, pierce: 0, hitSet: new Set(),
      grav: 0, knock: 3, lift: 0, status: 1, trail: null, orb: 0, mesh: null, light: null, homing: null, homingRate: 0,
      ...o,
    };
    p.pos = o.pos.clone(); p.vel = o.vel.clone();
    if (p.orb) p.mesh = G.vfx.orb(p.el === 'hush' ? 'hush' : p.el, p.orb);
    if (p.meshType === 'crescent') {
      p.mesh = new THREE.Mesh(this.crescentGeo, new THREE.MeshBasicMaterial({ color: PAL.wind.core.clone().multiplyScalar(1.1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      G.scene.add(p.mesh);
    }
    if (p.meshType === 'shard') {
      p.mesh = new THREE.Mesh(this.shardGeo, new THREE.MeshBasicMaterial({ color: PAL.frost.core.clone().multiplyScalar(0.9) }));
      G.scene.add(p.mesh);
    }
    if (p.lightI) p.light = G.vfx.holdLight(PAL[p.el]?.light ?? 0xffffff, p.lightI, p.lightD ?? 10);
    if (p.mesh) { p.mesh.position.copy(p.pos); this.orient(p); }
    this.list.push(p);
    return p;
  }
  orient(p) {
    if (!p.mesh || p.orb) return;
    tmp.copy(p.pos).add(p.vel);
    p.mesh.lookAt(tmp);
    if (p.meshType === 'crescent') p.mesh.rotateX(Math.PI / 2);
  }
  remove(p) {
    const i = this.list.indexOf(p); if (i >= 0) this.list.splice(i, 1);
    if (p.mesh) { if (p.orb) G.vfx.disposeOrb(p.mesh); else { G.scene.remove(p.mesh); p.mesh.material.dispose(); } }
    if (p.light) G.vfx.releaseLight(p.light);
  }

  rayEnemies(o, d, maxT = 45, extra = 0.35) {
    let best = null, bt = maxT;
    for (const e of this.enemies) {
      if (!e.alive || !e.hittable) continue;
      const c = e.center();
      const ocx = c.x - o.x, ocy = c.y - o.y, ocz = c.z - o.z;
      const t = ocx * d.x + ocy * d.y + ocz * d.z;
      if (t < 0 || t > bt) continue;
      const d2 = ocx * ocx + ocy * ocy + ocz * ocz - t * t;
      const rr = e.radius + extra;
      if (d2 < rr * rr) { bt = t; best = e; }
    }
    return best ? { e: best, t: bt } : null;
  }

  targetsIn(pos, r, el, src) {
    for (const t of G.world.targets) {
      if (t.pos.distanceTo(pos) < r + t.r) { t.baseHit && t.baseHit(el, src); t.onHit && t.onHit(el, src); }
    }
  }

  enemiesIn(pos, r) {
    const out = [];
    for (const e of this.enemies) if (e.alive && e.hittable && e.center().distanceTo(pos) < r + e.radius) out.push(e);
    return out;
  }

  // ============================================================
  // Bolts
  // ============================================================
  bolt(el, origin, aim, P) {
    const dir = tmp2.subVectors(aim, origin).normalize().clone();
    const A = G.audio, V = G.vfx;
    A.play('cast_' + el, { pos: origin });
    V.burst(origin, 'glow', 1, { el, size: 1.2, life: 0.12 });
    V.circle(origin, PAL[el].glow, 0.45, 0.18, { vertical: true, dir, spin: 8, intensity: 1.4 });
    switch (el) {
      case 'arcane':
        this.projectile({ el, pos: origin, vel: dir.clone().multiplyScalar(46), r: 0.28, life: 1.4, dmg: P, orb: 0.16, trail: 'arcane', knock: 2.5, source: 'player' });
        break;
      case 'fire':
        this.projectile({ el, pos: origin, vel: dir.clone().multiplyScalar(36), r: 0.3, life: 1.6, dmg: P * 1.1, orb: 0.22, trail: 'fire', knock: 3, source: 'player' });
        break;
      case 'wind':
        this.projectile({ el, pos: origin, vel: dir.clone().multiplyScalar(34), r: 0.75, life: 1.1, dmg: P * 0.85, pierce: 3, meshType: 'crescent', trail: 'wind', knock: 8, lift: 2.5, source: 'player' });
        break;
      case 'frost':
        for (const a of [-0.055, 0, 0.055]) {
          const d = dir.clone().applyAxisAngle(UP, a);
          this.projectile({ el, pos: origin, vel: d.multiplyScalar(46), r: 0.24, life: 1.2, dmg: P * 0.5, status: 0.55, meshType: 'shard', trail: 'frost', knock: 1.5, source: 'player' });
        }
        break;
      case 'storm': {
        const hitE = this.rayEnemies(origin, dir, 48, 0.5);
        const end = hitE ? hitE.e.center().clone() : aim.clone();
        if (!hitE && end.distanceTo(origin) > 48) end.copy(origin).addScaledVector(dir, 48);
        V.lightning(origin, end, { width: 0.09, dur: 0.16, branches: 1, jag: 0.08 });
        V.flash(end, 0xffe070, 30, 10, 0.15);
        V.burst(end, 'electric', 12);
        if (hitE) {
          G.combat.hit(hitE.e, { dmg: P * 1.05, el, pos: end, dir, knock: 2, source: 'player' });
          let best = null, bd = 7.5;
          for (const o of this.enemies) { if (o === hitE.e || !o.alive || !o.hittable) continue; const d = o.center().distanceTo(end); if (d < bd) { bd = d; best = o; } }
          if (best) {
            V.lightning(end, best.center(), { width: 0.06, dur: 0.18, branches: 0 });
            G.combat.hit(best, { dmg: P * 0.6, el, pos: best.center(), source: 'player', hitstop: 0 });
          }
        } else {
          G.audio.play('impact_storm', { pos: end });
          this.targetsIn(end, 1.2, el);
        }
        break;
      }
    }
  }

  // ============================================================
  // Signature (heavy) spells
  // ============================================================
  heavy(el, origin, aim, P, player) {
    const A = G.audio, V = G.vfx;
    const dir = tmp2.subVectors(aim, origin).normalize().clone();
    const feet = player.pos.clone();
    switch (el) {
      case 'arcane': {
        const c = feet.clone().add(new THREE.Vector3(0, 1, 0));
        V.circle(feet, PAL.arcane.glow, 3.2, 0.6, { spin: 3 });
        V.ring(feet, PAL.arcane.core, 6.5, 0.45, { thick: 0.3 });
        V.ring(feet, PAL.arcane.glow, 5, 0.6, { thick: 0.12, y: 0.8 });
        V.burst(c, 'arcane', 40, { speed: 9 });
        V.flash(c, 0xb080ff, 70, 16, 0.4);
        A.play('impact_arcane', { pos: c }); A.play('gale', { pos: c });
        G.cameraRig.shake(0.3);
        G.world.grass.gust(feet.x, feet.z, 7, 1.5);
        for (const e of this.enemiesIn(c, 6)) {
          const d = tmp.subVectors(e.center(), c).setY(0).normalize().clone();
          G.combat.hit(e, { dmg: P * 2.2, el, pos: e.center(), dir: d, knock: 14, lift: 4, heavy: true, source: 'player' });
        }
        for (const q of [...this.list]) if (q.owner === 'enemy' && q.pos.distanceTo(c) < 7) { V.burst(q.pos, 'arcane', 10); this.remove(q); }
        this.targetsIn(c, 6, el);
        break;
      }
      case 'fire': {
        A.play('cast_fire', { pos: origin }); A.play('charge', { pos: origin });
        V.circle(origin, PAL.fire.glow, 1.2, 0.35, { vertical: true, dir, spin: 6 });
        V.burst(origin, 'fire', 20, { speed: 3 });
        this.projectile({
          el, pos: origin, vel: dir.clone().multiplyScalar(27), r: 0.6, life: 2.6, dmg: P * 3.2, orb: 0.55, trail: 'bigfire', grav: 3,
          heavy: true, lightI: 30, lightD: 14, source: 'player',
          onImpact: (pos) => this.explode(pos, 4.8, P * 3.2, 'fire'),
        });
        break;
      }
      case 'wind': {
        A.play('gale', { pos: origin });
        const flat = dir.clone().setY(0).normalize();
        if (!player.grounded) {
          player.vel.y = 15; player.updraft = 0.6;
          A.play('updraft', { pos: feet });
          V.burst(feet, 'wind', 30, { radius: 1.2, vy: 6, speed: 4 });
          V.ring(feet, PAL.wind.core, 4, 0.5, { thick: 0.2 });
        }
        for (let i = 0; i < 40; i++) {
          const a = randRange(-0.5, 0.5);
          const d = flat.clone().applyAxisAngle(UP, a).multiplyScalar(randRange(12, 22));
          V.add.emit({ p: [origin.x, origin.y - 0.3, origin.z], v: [d.x, randRange(0, 3), d.z], life: randRange(0.35, 0.6), size: randRange(0.3, 0.6), size1: 0.1, color: PAL.wind.core, color1: PAL.wind.glow, alpha: 0.7, alpha1: 0, drag: 2, shape: 0 });
        }
        V.circle(origin, PAL.wind.glow, 1.4, 0.3, { vertical: true, dir: flat, spin: -8 });
        G.world.grass.gust(feet.x + flat.x * 5, feet.z + flat.z * 5, 8, 2);
        for (const e of this.enemies) {
          if (!e.alive || !e.hittable) continue;
          const to = tmp.subVectors(e.center(), feet); const dist = to.length();
          to.y = 0; to.normalize();
          if (dist < 10 && to.dot(flat) > 0.5) {
            G.combat.hit(e, { dmg: P * 1.3, el, pos: e.center(), dir: flat.clone(), knock: 10, lift: 10, heavy: true, source: 'player' });
          }
        }
        for (const t of G.world.targets) {
          const to = tmp.subVectors(t.pos, feet); const dist = to.length(); to.y = 0; to.normalize();
          if (dist < 12 && to.dot(flat) > 0.4) { t.baseHit && t.baseHit('wind'); t.onHit && t.onHit('wind'); }
        }
        break;
      }
      case 'frost': {
        A.play('cast_frost', { pos: origin });
        const flat = dir.clone().setY(0).normalize();
        const start = feet.clone().addScaledVector(flat, 1.8);
        V.circle(feet, PAL.frost.glow, 2, 0.8, { spin: 2 });
        const hitSet = new Set();
        for (let i = 0; i < 8; i++) {
          G.later(() => {
            const p = start.clone().addScaledVector(flat, i * 1.7);
            const h = G.world.h(p.x, p.z);
            if (h < -0.3) { G.world.addIceFloe(p.x, p.z); return; }
            p.y = G.world.ground(p.x, p.z, player.pos.y + 3);
            const sc = 1.6 + i * 0.12;
            V.crystal(p, sc * 1.6, { width: sc * 0.6, life: 1.3 });
            V.crystal(p.clone().add(new THREE.Vector3(randRange(-0.6, 0.6), 0, randRange(-0.6, 0.6))), sc, { width: sc * 0.4, life: 1.2 });
            V.burst(p, 'ice', 8); V.burst(p, 'frostmist', 3);
            A.play('ice_spike', { pos: p, gap: 0.01 });
            G.cameraRig.shake(0.08);
            for (const e of this.enemiesIn(p, 1.9)) {
              if (hitSet.has(e)) continue; hitSet.add(e);
              G.combat.hit(e, { dmg: P * 1.6, el, pos: e.center(), dir: flat.clone(), knock: 3, lift: 6, heavy: true, status: 1.6, source: 'player' });
            }
            this.targetsIn(p, 1.9, el);
          }, i * 55);
        }
        break;
      }
      case 'storm': {
        const tp = aim.clone();
        tp.y = G.world.ground(tp.x, tp.z, tp.y + 2);
        A.play('charge', { pos: tp });
        V.circle(tp, PAL.storm.glow, 3.4, 0.45, { spin: 6 });
        V.telegraph(tp, 3.8, 0.35, 0xffd84a);
        G.later(() => {
          const sky = tp.clone().add(new THREE.Vector3(randRange(-3, 3), 34, randRange(-3, 3)));
          V.lightning(sky, tp, { width: 0.5, dur: 0.4, branches: 4, jag: 0.06 });
          V.lightning(sky.clone().add(new THREE.Vector3(2, 0, 1)), tp, { width: 0.2, dur: 0.3, branches: 1, jag: 0.1 });
          V.ring(tp, PAL.storm.core, 5, 0.4, { thick: 0.3 });
          V.burst(tp, 'electric', 40, { speed: 12 }); V.burst(tp, 'dust', 14, { speed: 7 }); V.burst(tp.clone().setY(tp.y + 1), 'star', 1, { el: 'storm', size: 7 });
          V.flash(tp.clone().setY(tp.y + 3), 0xfff0a0, 80, 30, 0.45);
          V.scorch(tp, 3, 0x000000, 8);
          A.play('thunder', { pos: tp });
          G.cameraRig.shake(0.55);
          G.renderer.grade.uniforms.uFlash.value = 0.18;
          G.renderer.grade.uniforms.uFlashColor.value.setRGB(1, 0.95, 0.8);
          G.world.grass.gust(tp.x, tp.z, 6, 2);
          for (const e of this.enemiesIn(tp.clone().setY(tp.y + 1), 3.9)) {
            G.combat.hit(e, { dmg: P * 3.4, el, pos: e.center(), dir: tmp.subVectors(e.center(), tp).setY(0).normalize().clone(), knock: 6, lift: 3, heavy: true, status: 2, source: 'player', hitstop: 0.1, shake: 0.4 });
          }
          this.targetsIn(tp, 4, el);
        }, 350);
        break;
      }
    }
  }

  explode(pos, r, dmg, el = 'fire', o = {}) {
    const V = G.vfx, A = G.audio;
    const c = pos.clone();
    const gy = G.world.ground(c.x, c.z, c.y + 2);
    const nearGround = c.y - gy < 2.5;
    V.burst(c, 'glow', 1, { el, size: r * 1.1, size1: r * 1.7, life: 0.22, alpha: 0.55 });
    V.burst(c, 'star', 1, { el, size: r * 1.6, life: 0.16 });
    V.burst(c, el === 'fire' ? 'fire' : 'arcane', 40, { speed: 8, spread: 0.8, size: 1.2, alpha: 0.6 });
    V.burst(c, 'ember', 30, { speed: 10 });
    V.burst(c, 'smoke', 14, { spread: 1.5, size: 1.6 });
    V.burst(c, 'spark', 24, { el, speed: 14 });
    if (nearGround) { const g = c.clone(); g.y = gy; V.ring(g, PAL[el].glow, r * 1.3, 0.5, { thick: 0.25 }); V.scorch(g, r * 0.9); V.burst(g, 'dust', 16, { speed: 9 }); G.world.grass.gust(g.x, g.z, r * 1.6, 2); }
    V.flash(c, PAL[el].light, 60, r * 5, 0.5);
    A.play('explosion', { pos: c });
    G.cameraRig.shake(o.shake ?? 0.5);
    G.renderer.grade.uniforms.uImpact.value = Math.max(G.renderer.grade.uniforms.uImpact.value, 0.35);
    for (const e of this.enemiesIn(c, r)) {
      const d = e.center().distanceTo(c);
      const dir = tmp.subVectors(e.center(), c).setY(0.2).normalize().clone();
      G.combat.hit(e, { dmg: dmg * (1 - (d / r) * 0.45), el, pos: e.center(), dir, knock: 12, lift: 5, heavy: true, status: 1.5, source: 'player', hitstop: 0.08 });
    }
    for (const q of [...this.list]) if (q.owner === 'enemy' && q.pos.distanceTo(c) < r) this.remove(q);
    this.targetsIn(c, r, el);
  }

  // ============================================================
  // Weaves
  // ============================================================
  weave(a, b, origin, aim, P, player) {
    const info = weaveInfo(a, b);
    if (!info) return false;
    const A = G.audio, V = G.vfx;
    A.play('weave', { pos: origin });
    const feet = player.pos.clone();
    const ca = PAL[info.els[0]].glow, cb = PAL[info.els[1]].glow;
    V.circle(feet, ca, 2.6, 0.8, { spin: 3 });
    V.circle(feet, cb, 1.8, 0.8, { spin: -4, alt: true });
    V.burst(origin, 'star', 1, { el: info.els[0], size: 4 });
    G.hud.banner && G.hud.castName(info.name, info.els);
    const dir = tmp2.subVectors(aim, origin).normalize().clone();
    const flat = dir.clone().setY(0).normalize();
    const tp = aim.clone();
    if (tp.distanceTo(feet) > 26) tp.copy(feet).addScaledVector(dir, 26);
    tp.y = G.world.ground(tp.x, tp.z, tp.y + 2);

    switch (info.key) {
      case 'fire+frost': {
        V.circle(tp, PAL.frost.glow, 5, 0.6, { spin: 4 });
        V.circle(tp, PAL.fire.glow, 3.4, 0.6, { spin: -5, alt: true });
        V.telegraph(tp, 6.2, 0.5, 0xffc0a0);
        G.later(() => {
          const c = tp.clone().setY(tp.y + 1);
          V.burst(c, 'steam', 45, { spread: 3, size: 1.6 });
          V.burst(c, 'glow', 1, { el: 'white', size: 6, life: 0.25, alpha: 0.5 });
          V.burst(c, 'ice', 30, { speed: 12 }); V.burst(c, 'fire', 30, { speed: 9 });
          V.ring(tp, PAL.white.core, 8, 0.6, { thick: 0.25 }); V.ring(tp, PAL.frost.glow, 6, 0.8, { thick: 0.12, y: 1 });
          V.flash(c, 0xffffff, 70, 24, 0.5);
          A.play('steam', { pos: c }); A.play('explosion', { pos: c, v: 0.7 });
          G.cameraRig.shake(0.6); G.renderer.grade.uniforms.uImpact.value = 0.5;
          G.world.grass.gust(tp.x, tp.z, 9, 2);
          for (const e of this.enemiesIn(c, 6.5)) {
            G.combat.hit(e, { dmg: P * 4.4, el: 'fire', noReact: true, noStatus: true, pos: e.center(), dir: tmp.subVectors(e.center(), c).setY(0.3).normalize().clone(), knock: 14, lift: 6, heavy: true, source: 'player', hitstop: 0.12 });
            if (e.alive) { e.st.wet = 9; e.st.burn = 0; }
          }
          this.targetsIn(c, 6.5, 'fire');
        }, 500);
        break;
      }
      case 'fire+storm': {
        const orb = this.projectile({ el: 'fire', pos: origin, vel: dir.clone().multiplyScalar(8), r: 0.8, life: 4.5, dmg: P * 3, orb: 0.8, trail: 'plasma', heavy: true, lightI: 40, lightD: 14, source: 'player', noCollideEnemies: true });
        orb.zapT = 0;
        orb.tick = (dt) => {
          orb.zapT -= dt;
          orb.mesh.scale.setScalar(0.8 + Math.sin(G.time * 20) * 0.08);
          if (orb.zapT <= 0) {
            orb.zapT = 0.22;
            const near = this.enemiesIn(orb.pos, 8);
            if (near.length) {
              const e = pick(near);
              V.lightning(orb.pos, e.center(), { width: 0.1, dur: 0.18, branches: 1 });
              G.combat.hit(e, { dmg: P * 0.55, el: rand() < 0.5 ? 'storm' : 'fire', pos: e.center(), source: 'player', hitstop: 0.02, shake: 0.05 });
            } else V.lightning(orb.pos, orb.pos.clone().add(new THREE.Vector3(randRange(-3, 3), randRange(-3, 1), randRange(-3, 3))), { width: 0.05, dur: 0.12, branches: 0 });
          }
        };
        orb.onImpact = (pos) => { this.explode(pos, 5.5, P * 3, 'fire', { shake: 0.6 }); V.burst(pos, 'electric', 40, { speed: 12 }); A.play('chain', { pos }); };
        break;
      }
      case 'fire+wind': {
        const pos = feet.clone().addScaledVector(flat, 3);
        const tor = V.tornado(pos, { el: 'fire', scale: 1 });
        const z = { t: 0, dur: 5, pos, tick: 0, h: tor, snd: 0 };
        z.update = (dt) => {
          z.t += dt; z.tick -= dt; z.snd -= dt;
          pos.addScaledVector(flat, dt * 5.5);
          pos.y = G.world.ground(pos.x, pos.z, pos.y + 3);
          tor.grp.position.copy(pos);
          if (rand() < dt * 40) V.burst(tmp.copy(pos).add(new THREE.Vector3(randRange(-1.2, 1.2), randRange(0, 5), randRange(-1.2, 1.2))), 'fire', 1, { speed: 2 });
          if (rand() < dt * 10) V.burst(pos, 'ember', 1, { speed: 6 });
          if (z.snd <= 0) { z.snd = 0.6; A.play('cast_fire', { pos, gap: 0.1 }); A.play('gale', { pos, gap: 0.3 }); }
          G.world.grass.gust(pos.x, pos.z, 4, 1.2);
          for (const e of this.enemies) {
            if (!e.alive || !e.hittable || e.boss) continue;
            const to = tmp.subVectors(pos, e.pos); to.y = 0; const d = to.length();
            if (d < 7 && d > 0.5) { e.pull(to.normalize().multiplyScalar(dt * 9)); }
          }
          if (z.tick <= 0) {
            z.tick = 0.25;
            for (const e of this.enemiesIn(pos.clone().setY(pos.y + 1.5), 3)) G.combat.hit(e, { dmg: P * 0.5, el: 'fire', pos: e.center(), source: 'player', hitstop: 0.015, shake: 0.03, knock: 0, status: 0.5 });
            this.targetsIn(pos.clone().setY(pos.y + 1.5), 3, 'fire'); this.targetsIn(pos.clone().setY(pos.y + 1.5), 3, 'wind');
          }
          if (z.t > z.dur) { tor.done = true; return false; }
          return true;
        };
        this.zones.push(z);
        break;
      }
      case 'frost+storm': {
        V.circle(tp, PAL.frost.glow, 7, 3.2, { spin: 1.5 });
        V.circle(tp, PAL.storm.glow, 5, 3.2, { spin: -2, alt: true });
        const z = { t: 0, tick: 0 };
        z.update = (dt) => {
          z.t += dt; z.tick -= dt;
          if (z.tick <= 0) {
            z.tick = 0.14;
            const p = tp.clone().add(new THREE.Vector3(randRange(-6, 6), 0, randRange(-6, 6)));
            p.y = G.world.ground(p.x, p.z, tp.y + 4);
            if (rand() < 0.5) {
              V.crystal(p, randRange(1.5, 2.8), { life: 0.5 });
              V.burst(p, 'ice', 6); A.play('ice_spike', { pos: p, gap: 0.05 });
              for (const e of this.enemiesIn(p.clone().setY(p.y + 1), 2.2)) G.combat.hit(e, { dmg: P * 0.9, el: 'frost', pos: e.center(), source: 'player', hitstop: 0.02, shake: 0.05, status: 1 });
            } else {
              const tgt = this.enemiesIn(tp.clone().setY(tp.y + 1), 7.5);
              const hp = tgt.length && rand() < 0.75 ? pick(tgt).center() : p.clone().setY(p.y + 0.5);
              V.lightning(hp.clone().add(new THREE.Vector3(randRange(-2, 2), 20, randRange(-2, 2))), hp, { width: 0.2, dur: 0.2, branches: 1 });
              V.burst(hp, 'electric', 10); V.flash(hp, 0xffe070, 40, 10, 0.15);
              A.play('impact_storm', { pos: hp, gap: 0.05 });
              for (const e of this.enemiesIn(hp, 2.2)) G.combat.hit(e, { dmg: P * 1.0, el: 'storm', pos: e.center(), source: 'player', hitstop: 0.03, shake: 0.08 });
            }
            this.targetsIn(tp, 7, rand() < 0.5 ? 'frost' : 'storm');
          }
          return z.t < 3.2;
        };
        this.zones.push(z);
        break;
      }
      case 'frost+wind': {
        const tor = V.tornado(feet, { el: 'frost', scale: 2.2, alpha: 0.45 });
        player.barrier = 5;
        const z = { t: 0, tick: 0 };
        z.update = (dt) => {
          z.t += dt; z.tick -= dt;
          tor.grp.position.copy(player.pos);
          for (let i = 0; i < 3; i++) if (rand() < dt * 30) {
            const a = rand() * Math.PI * 2, r = randRange(1.5, 8);
            V.norm.emit({ p: [player.pos.x + Math.cos(a) * r, player.pos.y + randRange(0.2, 3), player.pos.z + Math.sin(a) * r], v: [-Math.sin(a) * 9, randRange(-0.5, 1), Math.cos(a) * 9], life: 0.7, size: randRange(0.1, 0.25), color: PAL.white.core, color1: PAL.frost.glow, alpha: 0.9, alpha1: 0, shape: 0 });
          }
          if (rand() < dt * 8) V.burst(player.pos, 'frostmist', 1, { spread: 5, size: 1.2, alpha: 0.25 });
          if (z.tick <= 0) {
            z.tick = 0.4;
            for (const e of this.enemiesIn(player.pos.clone().setY(player.pos.y + 1), 8)) G.combat.hit(e, { dmg: P * 0.35, el: 'frost', pos: e.center(), source: 'player', hitstop: 0, shake: 0, status: 0.9 });
            this.targetsIn(player.pos, 8, 'frost');
          }
          if (z.t > 5) { tor.done = true; return false; }
          return true;
        };
        this.zones.push(z);
        A.play('gale', { pos: feet }); A.play('freeze', { pos: feet });
        break;
      }
      case 'storm+wind': {
        const cloudPos = tp.clone().setY(tp.y + 9);
        const cloud = [];
        for (let i = 0; i < 10; i++) {
          const m = new THREE.Mesh(G.vfx.orbGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.18, 0.17, 0.26), transparent: true, opacity: 0 }));
          m.scale.set(randRange(1.2, 2.2), randRange(0.7, 1.1), randRange(1.2, 2.2));
          m.userData.off = new THREE.Vector3(randRange(-2.5, 2.5), randRange(-0.4, 0.4), randRange(-2.5, 2.5));
          G.scene.add(m); cloud.push(m);
        }
        const z = { t: 0, tick: 0.3 };
        z.update = (dt) => {
          z.t += dt; z.tick -= dt;
          const near = this.enemiesIn(cloudPos.clone().setY(cloudPos.y - 8), 12);
          if (near.length) { const c = near[0].pos; cloudPos.x += (c.x - cloudPos.x) * dt * 1.5; cloudPos.z += (c.z - cloudPos.z) * dt * 1.5; }
          cloudPos.y = G.world.ground(cloudPos.x, cloudPos.z, 100) + 9;
          const alpha = Math.min(1, z.t * 3) * Math.min(1, (5.4 - z.t) * 2);
          cloud.forEach((m, i) => { m.position.copy(cloudPos).add(m.userData.off); m.position.y += Math.sin(G.time * 2 + i) * 0.2; m.material.opacity = alpha * 0.85; });
          if (rand() < dt * 6) V.lightning(cloudPos.clone().add(new THREE.Vector3(randRange(-2, 2), 0, randRange(-2, 2))), cloudPos.clone().add(new THREE.Vector3(randRange(-3, 3), randRange(-1, 1), randRange(-3, 3))), { width: 0.05, dur: 0.12, branches: 0 });
          if (z.tick <= 0 && z.t < 5) {
            z.tick = 0.42;
            const tg = this.enemiesIn(cloudPos.clone().setY(cloudPos.y - 8), 9);
            const e = tg.length ? pick(tg) : null;
            const hp = e ? e.center() : cloudPos.clone().add(new THREE.Vector3(randRange(-4, 4), -9, randRange(-4, 4)));
            V.lightning(cloudPos.clone(), hp, { width: 0.28, dur: 0.25, branches: 2 });
            V.burst(hp, 'electric', 16); V.flash(hp, 0xfff0a0, 70, 16, 0.25);
            A.play('thunder', { pos: hp, gap: 0.2 });
            G.cameraRig.shake(0.15);
            if (e) G.combat.hit(e, { dmg: P * 1.6, el: 'storm', pos: hp, source: 'player', status: 1.5, knock: 2 });
            this.targetsIn(hp, 2, 'storm');
          }
          if (z.t > 5.5) { cloud.forEach((m) => { G.scene.remove(m); m.material.dispose(); }); return false; }
          return true;
        };
        this.zones.push(z);
        A.play('gale', { pos: cloudPos });
        break;
      }
      case 'arcane': {
        const x = info.el;
        const beam = V.beam(x, { width: 0.55 });
        const z = { t: 0, tick: 0 };
        this.channel = z;
        A.play('beam', { pos: origin, d: 2.4 });
        z.update = (dt) => {
          z.t += dt; z.tick -= dt;
          const o = player.staffTip();
          const aimP = player.aimPoint(60);
          const d = tmp.subVectors(aimP, o).normalize().clone();
          const hitE = this.rayEnemies(o, d, 40, 0.4);
          let end;
          if (hitE) end = o.clone().addScaledVector(d, hitE.t);
          else { const tt = G.world.terrain.raycast(o, d, 40); end = o.clone().addScaledVector(d, tt ?? 40); }
          beam.set(o, end);
          if (rand() < dt * 40) V.burst(end, x === 'fire' ? 'fire' : x === 'frost' ? 'ice' : x === 'storm' ? 'electric' : 'wind', 2, { speed: 4 });
          if (rand() < dt * 30) V.burst(end, 'spark', 1, { el: x });
          G.cameraRig.shake(0.02);
          if (z.tick <= 0) {
            z.tick = 0.1;
            if (hitE) G.combat.hit(hitE.e, { dmg: P * 0.38, el: x, pos: end, dir: d, source: 'player', hitstop: 0.012, shake: 0.03, knock: x === 'wind' ? 3 : 0.5, status: 0.35 });
            this.targetsIn(end, 1.2, x);
            if (x === 'frost' && end.y < 0.3 && G.world.h(end.x, end.z) < -0.3 && rand() < 0.3) G.world.addIceFloe(end.x, end.z);
          }
          if (z.t > 2.4 || player.dead) { beam.done = true; this.channel = null; return false; }
          return true;
        };
        this.zones.push(z);
        break;
      }
    }
    return true;
  }

  // ============================================================
  // Enemy projectiles
  // ============================================================
  enemyOrb(pos, dir, o = {}) {
    return this.projectile({
      owner: 'enemy', el: 'hush', pos, vel: dir.clone().multiplyScalar(o.speed ?? 11), r: o.r ?? 0.35, life: o.life ?? 4,
      dmg: o.dmg ?? 2, orb: o.size ?? 0.3, trail: 'hush', homing: o.homing ?? null, homingRate: o.homingRate ?? 0.8,
    });
  }

  // ============================================================
  update(dt) {
    const V = G.vfx;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (!p) continue;
      p.life -= dt;
      if (p.life <= 0) { if (p.onImpact) p.onImpact(p.pos.clone(), null); else if (p.owner === 'enemy') V.burst(p.pos, 'arcane', 6); this.remove(p); continue; }
      if (p.homing && p.homing.alive !== false) {
        const tc = p.homing.center ? p.homing.center() : p.homing.pos;
        const want = tmp.subVectors(tc, p.pos).normalize().multiplyScalar(p.vel.length());
        p.vel.lerp(want, clamp(p.homingRate * dt, 0, 1));
      }
      p.vel.y -= p.grav * dt;
      if (p.tick) p.tick(dt);
      const len = p.vel.length() * dt;
      const steps = Math.max(1, Math.ceil(len / 0.4));
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        p.pos.addScaledVector(p.vel, dt / steps);
        dead = this.collide(p);
      }
      if (dead) continue;
      if (p.mesh) { p.mesh.position.copy(p.pos); this.orient(p); if (p.meshType === 'crescent') p.mesh.rotateZ(dt * 0); }
      if (p.light) p.light.l.position.copy(p.pos);
      this.trail(p, dt);
    }
    for (let i = this.zones.length - 1; i >= 0; i--) {
      let alive = false;
      try { alive = this.zones[i].update(dt); } catch (e) { console.warn(e); }
      if (!alive) this.zones.splice(i, 1);
    }
  }

  trail(p, dt) {
    const V = G.vfx;
    const vx = -p.vel.x * 0.05, vy = -p.vel.y * 0.05, vz = -p.vel.z * 0.05;
    switch (p.trail) {
      case 'arcane': for (let k = 0; k < 3; k++) V.burst(p.pos, 'trail', 1, { el: 'arcane', size: 0.3, vx, vy, vz, shape: k === 0 ? 4 : 0 }); break;
      case 'fire': V.burst(p.pos, 'fire', 2, { spread: 0.12, speed: 0.6, size: 0.7, life: 0.6 }); if (rand() < 0.3) V.burst(p.pos, 'ember', 1, { speed: 1.5 }); break;
      case 'bigfire': V.burst(p.pos, 'fire', 6, { spread: 0.4, speed: 1, size: 1.4 }); V.burst(p.pos, 'smoke', rand() < 0.3 ? 1 : 0, { size: 0.8 }); if (rand() < 0.5) V.burst(p.pos, 'ember', 1); break;
      case 'plasma': V.burst(p.pos, 'fire', 3, { spread: 0.4, speed: 1 }); if (rand() < 0.4) V.burst(p.pos, 'electric', 1, { spread: 0.6, speed: 3 }); break;
      case 'wind': for (let k = 0; k < 3; k++) V.burst(p.pos, 'trail', 1, { el: 'wind', size: 0.4, spread: 0.5, vx, vy, vz }); break;
      case 'frost': V.burst(p.pos, 'trail', 2, { el: 'frost', size: 0.22, spread: 0.05, shape: 2 }); break;
      case 'hush': V.burst(p.pos, 'trail', 2, { el: 'hush', size: 0.5, spread: 0.1 }); if (rand() < 0.3) V.burst(p.pos, 'hush', 1, { size: 0.3, spread: 0.1, alpha: 0.3 }); break;
    }
  }

  collide(p) {
    const V = G.vfx;
    const W = G.world;
    if (p.owner === 'player') {
      // intercept enemy orbs
      for (const q of this.list) {
        if (q.owner !== 'enemy' || q === p) continue;
        if (q.pos.distanceTo(p.pos) < q.r + p.r + 0.25) {
          V.burst(q.pos, 'arcane', 14); V.burst(q.pos, 'spark', 8, { el: p.el }); G.audio.play('impact_arcane', { pos: q.pos });
          this.remove(q);
          if (!p.heavy) { this.impact(p, null); this.remove(p); return true; }
        }
      }
      if (!p.noCollideEnemies) for (const e of this.enemies) {
        if (!e.alive || !e.hittable || p.hitSet.has(e)) continue;
        const c = e.center();
        if (c.distanceTo(p.pos) < p.r + e.radius) {
          p.hitSet.add(e);
          if (p.onImpact) { p.onImpact(p.pos.clone(), e); this.remove(p); return true; }
          G.combat.hit(e, { dmg: p.dmg, el: p.el, pos: p.pos.clone(), dir: p.vel.clone().normalize(), knock: p.knock, lift: p.lift, status: p.status, heavy: p.heavy, source: 'player' });
          this.impact(p, e);
          if (p.pierce-- <= 0) { this.remove(p); return true; }
        }
      }
      for (const t of W.targets) {
        if (t.pos.distanceTo(p.pos) < t.r + p.r) {
          t.baseHit && t.baseHit(p.el, p); t.onHit && t.onHit(p.el, p);
          if (p.onImpact) p.onImpact(p.pos.clone(), null); else this.impact(p, null);
          this.remove(p); return true;
        }
      }
    } else {
      const pl = G.player;
      if (!pl.dead) {
        const pc = tmp.copy(pl.pos); pc.y += 0.9;
        if (pc.distanceTo(p.pos) < p.r + 0.55) {
          pl.damage(p.dmg, { pos: p.pos.clone(), dir: p.vel.clone().normalize(), knock: 5 });
          V.burst(p.pos, 'arcane', 12); G.audio.play('orb_hit', { pos: p.pos });
          this.remove(p); return true;
        }
      }
    }
    // static colliders
    if (W.col.pointHit(p.pos.x, p.pos.y, p.pos.z, p.r * 0.4)) {
      if (p.onImpact) p.onImpact(p.pos.clone(), null); else this.impact(p, null);
      this.remove(p); return true;
    }
    const gh = W.h(p.pos.x, p.pos.z);
    // water
    if (p.pos.y < 0.05 && gh < -0.15) {
      if (p.owner === 'player') {
        if (p.el === 'frost') W.addIceFloe(p.pos.x, p.pos.z);
        else if (p.el === 'fire') { V.burst(p.pos, 'steam', 6); G.audio.play('fizzle', { pos: p.pos }); }
        else { V.burst(p.pos, 'trail', 8, { el: 'frost', spread: 0.4 }); G.audio.play('splash', { pos: p.pos }); }
        if (p.onImpact && p.el !== 'fire') p.onImpact(p.pos.clone(), null);
      }
      this.remove(p); return true;
    }
    const plat = W.col.platformTop(p.pos.x, p.pos.z, p.pos.y, 0);
    if (p.pos.y < gh || (plat > -1e8 && p.pos.y < plat)) {
      p.pos.y = Math.max(gh, plat) + 0.05;
      if (p.onImpact) p.onImpact(p.pos.clone(), null); else this.impact(p, null, true);
      this.remove(p); return true;
    }
    return false;
  }

  impact(p, target, ground = false) {
    const V = G.vfx, A = G.audio;
    const pos = p.pos;
    if (p.owner === 'enemy') { V.burst(pos, 'arcane', 10); V.burst(pos, 'hush', 3); return; }
    A.play('impact_' + p.el, { pos });
    switch (p.el) {
      case 'arcane': V.burst(pos, 'arcane', 14, { speed: 5 }); V.ring(pos, PAL.arcane.glow, 1.2, 0.25, { y: 0, thick: 0.3, up: p.vel.clone().normalize().negate() }); break;
      case 'fire': V.burst(pos, 'fire', 16, { speed: 4 }); V.burst(pos, 'ember', 8); V.burst(pos, 'smoke', 3, { size: 0.6 }); V.flash(pos, 0xff8a3a, 25, 8, 0.2); break;
      case 'wind': V.burst(pos, 'wind', 14, { radius: 0.6 }); if (ground) G.world.grass.gust(pos.x, pos.z, 3, 1); break;
      case 'frost': V.burst(pos, 'ice', 8, { speed: 5 }); V.burst(pos, 'frostmist', 2, { size: 0.5 }); break;
    }
    if (ground && p.el !== 'wind') V.burst(pos, 'dust', 4, { speed: 3, size: 0.5 });
  }
}
