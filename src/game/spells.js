// Spells: bolts (LMB), signature spells (RMB), weaves (Q, two elements fused),
// ultimates (F, skill-tree capstones) and lingering fields. Skill-tree ranks
// modify most of them through `R(id)`.
import * as THREE from 'three';
import { G, EL_INFO } from '../core/context.js';
import { PAL } from '../render/vfx.js';
import { U } from '../render/materials.js';
import { randRange, rand, clamp, pick } from '../core/util.js';
import { NODES, ULTS } from './skills.js';

const UP = new THREE.Vector3(0, 1, 0);
const RAIN_C = new THREE.Color(0.55, 0.65, 0.85);
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const R = (id) => (G.skills ? G.skills.r(id) : 0);

export const BOLT = {
  arcane: { name: '비전 화살', cost: 0, cd: 0.26, desc: '빠르고 정확한 기본 마법. 마나를 쓰지 않는다.' },
  fire: { name: '불씨 탄', cost: 3, cd: 0.34, desc: '적을 불태운다. 한기 서린 적을 녹여 큰 피해(융해).' },
  wind: { name: '바람 칼날', cost: 3, cd: 0.36, desc: '여러 적을 꿰뚫고 밀어낸다. 불·한기·전기를 퍼뜨린다.' },
  frost: { name: '서리 파편', cost: 3, cd: 0.4, desc: '세 갈래 얼음 파편. 한기가 세 번 쌓이면 얼어붙는다. 물을 얼린다.' },
  storm: { name: '전격', cost: 4, cd: 0.42, desc: '즉시 적중하고 옆의 적에게 튄다. 젖은 적·언 적에게 치명적.' },
  water: { name: '물방울 탄', cost: 3, cd: 0.32, desc: '적을 적신다. 젖은 적은 번개에 감전되고 서리에 얼어붙는다. 불타는 적에게는 불을 끄는 대신 피해가 준다.' },
};
export const HEAVY = {
  arcane: { name: '비전 파동', cost: 18, cd: 3.5, desc: '주위를 밀쳐내는 충격파. 적의 투사체를 지운다.' },
  fire: { name: '화염구', cost: 26, cd: 4, desc: '거대한 불덩이가 폭발하며 넓은 범위를 불태운다.' },
  wind: { name: '돌풍', cost: 20, cd: 3.2, desc: '전방의 적을 공중으로 띄운다. 공중에서 쓰면 상승 기류를 탄다.' },
  frost: { name: '서리 창', cost: 24, cd: 4, desc: '땅을 따라 얼음 가시가 솟구친다. 물 위엔 얼음 길을 만든다.' },
  storm: { name: '낙뢰', cost: 28, cd: 4.5, desc: '조준한 곳에 하늘의 번개를 내리꽂는다.' },
  water: { name: '해일', cost: 22, cd: 3.8, desc: '앞으로 밀려가는 물결이 적을 밀쳐 내고 모두 적신다. 적의 투사체를 삼킨다.' },
};
export const WEAVE = {
  'fire+frost': { name: '증기 폭발', desc: '거대한 증기 폭발. 휘말린 적은 모두 젖는다 — 번개와 함께라면.' },
  'fire+storm': { name: '플라즈마 구체', desc: '느리게 나아가며 주변 적을 지지다 폭발하는 구체.' },
  'fire+wind': { name: '화염 회오리', desc: '적을 빨아들이며 불태우는 회오리가 앞으로 나아간다.' },
  'frost+storm': { name: '결정 폭풍', desc: '얼음 파편과 번개가 한 지역에 쏟아진다. 파쇄가 연달아 일어난다.' },
  'frost+wind': { name: '눈보라 장막', desc: '주위에 눈보라를 두른다. 적은 얼어붙고, 받는 피해가 줄어든다.' },
  'storm+wind': { name: '뇌운', desc: '적을 쫓아다니며 번개를 내리치는 먹구름.' },
  'fire+water': { name: '끓는 샘', desc: '땅속에서 끓는 물기둥이 연달아 솟구쳐 적을 띄우고, 데우고, 적신다.' },
  'frost+water': { name: '빙하 해일', desc: '거대한 물결이 밀려가며 휩쓴 적을 모두 얼려 버린다.' },
  'storm+water': { name: '전류 소용돌이', desc: '적을 빨아들이는 소용돌이에 전류가 흐른다. 젖은 적은 계속 감전된다.' },
  'water+wind': { name: '폭풍우', desc: '비바람의 벽이 앞으로 휩쓸며 적을 밀어내고 적신다. 불을 끈다.' },
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
export function ultInfo(el) { const id = ULTS[el]; return id ? NODES[id] : null; }

const BURST_OF = { fire: 'fire', frost: 'ice', storm: 'electric', wind: 'wind', water: 'water', arcane: 'arcane' };
// projectile ribbon looks, keyed by trail type
const RIBBON = {
  arcane: { el: 'arcane', width: 0.2, life: 0.16 },
  fire: { el: 'fire', width: 0.26, life: 0.2, wave: 0.6 },
  bigfire: { el: 'fire', width: 0.85, life: 0.32, wave: 0.8 },
  plasma: { el: 'fire', width: 0.75, life: 0.3, wave: 1, core: PAL.storm.core },
  frost: { el: 'frost', width: 0.08, life: 0.11 },
  water: { el: 'water', width: 0.2, life: 0.2, wave: 0.5 },
  hush: { el: 'hush', width: 0.24, life: 0.26, wave: 0.3 },
};
// trail sprite emission rates (per second) so density doesn't depend on frame rate
const TRAIL_RATE = { arcane: 70, fire: 90, bigfire: 160, plasma: 110, wind: 120, frost: 50, water: 80, hush: 70 };

// Streaky water shader for waves / whirlpools
const WAVE_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const WAVE_FS = `
  uniform vec3 uColor; uniform vec3 uFoam; uniform float uAlpha; uniform float uTime;
  varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
  float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
  void main(){
    float n = n2(vec2(vUv.x * 14.0, vUv.y * 4.0 - uTime * 5.0)) * 0.6 + n2(vec2(vUv.x * 30.0 + uTime, vUv.y * 9.0 - uTime * 8.0)) * 0.4;
    float foam = smoothstep(0.62, 0.95, vUv.y + n * 0.25) + smoothstep(0.7, 0.9, n) * 0.4;
    float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * smoothstep(0.0, 0.1, vUv.y);
    vec3 col = mix(uColor * (0.7 + n * 0.6), uFoam, clamp(foam, 0.0, 1.0));
    float a = edge * uAlpha * (0.45 + foam * 0.4);
    gl_FragColor = vec4(col, a);
  }`;

// ------------------------------------------------------------------
export class Spells {
  constructor() {
    this.list = [];
    this.zones = [];
    this.channel = null;
    this.heat = { n: 0, t: -9 };
    const cg = new THREE.TorusGeometry(0.7, 0.07, 4, 18, Math.PI * 0.9);
    cg.rotateZ(Math.PI * 0.05);
    this.crescentGeo = cg;
    this.shardGeo = new THREE.OctahedronGeometry(0.12, 0); this.shardGeo.scale(0.7, 0.7, 2.6);
    const wg = new THREE.CylinderGeometry(3.4, 3.8, 2.6, 24, 4, true, -Math.PI * 0.32, Math.PI * 0.64);
    wg.translate(0, 1.3, 0);
    this.waveGeo = wg;
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
    p.trailAcc = 0;
    if (p.orb) p.mesh = G.vfx.orb(p.el === 'hush' ? 'hush' : p.el, p.orb, { halo: p.trail === 'bigfire' || p.trail === 'plasma' ? 2.6 : 4, haloI: p.trail === 'bigfire' || p.trail === 'plasma' ? 0.22 : p.owner === 'enemy' ? 0.28 : 0.38 });
    const rc = RIBBON[p.trail];
    if (rc) p.ribbon = G.vfx.ribbon({ ...rc, follow: p.pos, width: rc.width * (p.ribW ?? 1) });
    if (p.meshType === 'crescent') {
      // two tip streaks for the wind blade
      p.tipA = p.pos.clone(); p.tipB = p.pos.clone();
      p.ribA = G.vfx.ribbon({ el: 'wind', width: 0.12, life: 0.14, follow: p.tipA });
      p.ribB = G.vfx.ribbon({ el: 'wind', width: 0.12, life: 0.14, follow: p.tipB });
    }
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
    if (p.ribbon) { p.ribbon.release(); p.ribbon = null; }
    if (p.ribA) { p.ribA.release(); p.ribB.release(); p.ribA = p.ribB = null; }
    if (p.mesh) { if (p.orb) G.vfx.disposeOrb(p.mesh); else { G.scene.remove(p.mesh); p.mesh.material.dispose(); } }
    if (p.light) G.vfx.releaseLight(p.light);
  }

  rayEnemies(o, d, maxT = 45, extra = 0.35, skip = null) {
    let best = null, bt = maxT;
    for (const e of this.enemies) {
      if (!e.alive || !e.hittable || (skip && skip.has(e))) continue;
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
  nearestEnemy(pos, r, not = null) {
    let best = null, bd = r;
    for (const e of this.enemies) { if (!e.alive || !e.hittable || e === not) continue; const d = e.center().distanceTo(pos); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  eatEnemyShots(pos, r, reflect = false, P = 10) {
    for (const q of [...this.list]) {
      if (q.owner !== 'enemy' || q.pos.distanceTo(pos) > r) continue;
      if (!reflect) { G.vfx.burst(q.pos, 'water', 8); this.remove(q); continue; }
      const tgt = this.nearestEnemy(q.pos, 40);
      G.vfx.burst(q.pos, 'water', 10); G.audio.play('impact_water', { pos: q.pos, gap: 0.05 });
      this.remove(q);
      const dir = tgt ? tmp.subVectors(tgt.center(), q.pos).normalize().clone() : q.vel.clone().normalize().negate();
      this.projectile({ el: 'water', pos: q.pos, vel: dir.multiplyScalar(26), r: 0.35, life: 2.5, dmg: P * 0.9, orb: 0.3, trail: 'water', knock: 4, homing: tgt, homingRate: 3, source: 'player' });
    }
  }

  // "과열": consecutive fire casts ramp damage
  fireMul() {
    const lv = R('f_overheat');
    if (!lv) return 1;
    if (G.time - this.heat.t < 2) this.heat.n = Math.min(5, this.heat.n + 1); else this.heat.n = 0;
    this.heat.t = G.time;
    if (this.heat.n >= 2) G.vfx.burst(G.player.staffTip(), 'ember', this.heat.n * 2, { speed: 3 });
    return 1 + 0.06 * lv * this.heat.n;
  }

  // ============================================================
  // Bolts
  // ============================================================
  bolt(el, origin, aim, P) {
    const dir = tmp2.subVectors(aim, origin).normalize().clone();
    const A = G.audio, V = G.vfx;
    A.play('cast_' + el, { pos: origin });
    V.cast(el, origin, dir, 'bolt');
    G.cameraRig.kick && G.cameraRig.kick(tmp.copy(dir).negate(), 0.05);
    switch (el) {
      case 'arcane':
        this.projectile({ el, pos: origin, vel: dir.clone().multiplyScalar(46), r: 0.28, life: 1.4, dmg: P * (1 + 0.12 * R('a_focus')), orb: 0.16, trail: 'arcane', knock: 2.5, pierce: R('a_pierce'), source: 'player' });
        break;
      case 'fire': {
        const m = (1 + 0.12 * R('f_heat')) * this.fireMul();
        const splash = R('f_splash') ? { r: 2.2, dmg: P * 0.4, el: 'fire' } : null;
        this.projectile({ el, pos: origin, vel: dir.clone().multiplyScalar(36), r: 0.3, life: 1.6, dmg: P * 1.1 * m, orb: 0.22, trail: 'fire', knock: 3, splash, source: 'player' });
        break;
      }
      case 'wind':
        this.projectile({ el, pos: origin, vel: dir.clone().multiplyScalar(34), r: 0.75, life: 1.1, dmg: P * 0.85 * (1 + 0.12 * R('w_edge')), pierce: 3 + (R('w_edge') >= 3 ? 2 : 0), meshType: 'crescent', trail: 'wind', knock: 8, lift: 2.5, source: 'player' });
        break;
      case 'frost': {
        const five = R('i_edge') >= 3;
        const angs = five ? [-0.11, -0.055, 0, 0.055, 0.11] : [-0.055, 0, 0.055];
        for (const a of angs) {
          const d = dir.clone().applyAxisAngle(UP, a);
          this.projectile({ el, pos: origin, vel: d.multiplyScalar(46), r: 0.24, life: 1.2, dmg: P * 0.5 * (1 + 0.12 * R('i_edge')), status: 0.55, meshType: 'shard', trail: 'frost', knock: 1.5, source: 'player' });
        }
        break;
      }
      case 'water': {
        const splash = R('wa_pressure') >= 3 ? { r: 2, dmg: P * 0.25, el: 'water' } : null;
        this.projectile({ el, pos: origin, vel: dir.clone().multiplyScalar(40), r: 0.3, life: 1.5, dmg: P * 0.9 * (1 + 0.12 * R('wa_pressure')), orb: 0.2, trail: 'water', knock: 4.5, splash, grav: 2.2, source: 'player' });
        break;
      }
      case 'storm': {
        const hitE = this.rayEnemies(origin, dir, 48, 0.5);
        const end = hitE ? hitE.e.center().clone() : aim.clone();
        if (!hitE && end.distanceTo(origin) > 48) end.copy(origin).addScaledVector(dir, 48);
        V.lightning(origin, end, { width: 0.09, dur: 0.16, branches: 1, jag: 0.08 });
        V.lightning(origin, end, { width: 0.03, dur: 0.1, branches: 0, jag: 0.14, segs: 10 });
        V.flash(end, 0xffe070, 30, 10, 0.15);
        V.impact('storm', end, { dir, target: hitE ? hitE.e : null, scale: 0.8 });
        if (hitE) {
          G.combat.hit(hitE.e, { dmg: P * 1.05 * (1 + 0.12 * R('s_charge')), el, pos: end, dir, knock: 2, source: 'player' });
          const jumps = 1 + R('s_chain');
          const cm = 0.6 + 0.1 * R('s_chain');
          const done = new Set([hitE.e]);
          let from = end, last = hitE.e;
          for (let j = 0; j < jumps; j++) {
            let best = null, bd = 7.5;
            for (const o of this.enemies) { if (done.has(o) || !o.alive || !o.hittable) continue; const d = o.center().distanceTo(last.center()); if (d < bd) { bd = d; best = o; } }
            if (!best) break;
            done.add(best);
            const bc = best.center();
            V.lightning(from, bc, { width: 0.06, dur: 0.18, branches: 0 });
            V.burst(bc, 'electric', 6, { speed: 5 });
            A.play('zap', { pos: bc, gap: 0.03 });
            G.combat.hit(best, { dmg: P * cm, el, pos: bc, source: 'player', hitstop: 0 });
            from = bc; last = best;
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
        const big = R('a_wave');
        const rr = big ? 8.1 : 6;
        const c = feet.clone().add(new THREE.Vector3(0, 1, 0));
        V.cast('arcane', origin, dir, 'heavy');
        V.circle(feet, PAL.arcane.glow, 3.2 * (big ? 1.3 : 1), 0.6, { spin: 3 });
        V.ring(feet, PAL.arcane.core, rr + 0.5, 0.45, { thick: 0.3 });
        V.ring(feet, PAL.arcane.glow, rr - 1, 0.6, { thick: 0.12, y: 0.8 });
        V.shock(c, PAL.arcane.glow, rr, 0.45, { alpha: 0.6, flat: 0.55 });
        V.radial(feet, 30, { el: 'arcane', speed: rr * 3.2, up: 0.15, life: 0.45, y: 0.5 });
        V.burst(c, 'arcane', 30, { speed: 9 });
        V.flash(c, 0xb080ff, 70, 16, 0.4);
        V.decal(feet, 'rune', rr * 0.55, { dur: 2.4, spin: 1 });
        V.burst(feet, 'dust', 14, { speed: 10 });
        A.play('heavy_arcane', { pos: c }); A.play('gale', { pos: c, v: 0.7 });
        G.cameraRig.shake(0.3); G.cameraRig.punchFov && G.cameraRig.punchFov(3);
        G.world.grass.gust(feet.x, feet.z, 7, 1.5);
        for (const e of this.enemiesIn(c, rr)) {
          const d = tmp.subVectors(e.center(), c).setY(0).normalize().clone();
          G.combat.hit(e, { dmg: P * 2.2, el, pos: e.center(), dir: d, knock: 14, lift: 4, heavy: true, source: 'player' });
          if (big && e.alive && e.st && !e.boss) e.st.stun = Math.max(e.st.stun, 1.2);
        }
        for (const q of [...this.list]) if (q.owner === 'enemy' && q.pos.distanceTo(c) < rr + 1) { V.burst(q.pos, 'arcane', 10); this.remove(q); }
        this.targetsIn(c, rr, el);
        break;
      }
      case 'fire': {
        A.play('heavy_fire', { pos: origin });
        V.cast('fire', origin, dir, 'heavy');
        V.burst(origin, 'fire', 14, { speed: 3 });
        G.cameraRig.kick && G.cameraRig.kick(tmp.copy(dir).negate(), 0.18);
        const m = this.fireMul();
        this.projectile({
          el, pos: origin, vel: dir.clone().multiplyScalar(27), r: 0.6, life: 2.6, dmg: P * 3.2 * m, orb: 0.55, trail: 'bigfire', grav: 3,
          heavy: true, lightI: 30, lightD: 14, source: 'player',
          onImpact: (pos) => {
            this.explode(pos, 4.8, P * 3.2 * m, 'fire');
            if (R('f_blaze')) { const g = pos.clone(); g.y = G.world.ground(g.x, g.z, g.y + 2); this.field(g, { r: 3.6, dur: 4, every: 0.5, dmg: P * 0.3, el: 'fire', look: 'fire' }); }
          },
        });
        break;
      }
      case 'wind': {
        A.play('gale', { pos: origin }); A.play('cast_wind', { pos: origin, v: 0.6 });
        V.cast('wind', origin, dir, 'heavy');
        const flat = dir.clone().setY(0).normalize();
        const gl = R('w_gale');
        const range = 10 * (1 + 0.25 * gl), lift = 10 * (1 + 0.2 * gl);
        if (!player.grounded) {
          player.vel.y = 15; player.updraft = 0.6;
          A.play('updraft', { pos: feet });
          V.burst(feet, 'wind', 30, { radius: 1.2, vy: 6, speed: 4 });
          V.ring(feet, PAL.wind.core, 4, 0.5, { thick: 0.2 });
        }
        for (let i = 0; i < 24 + gl * 6; i++) {
          const a = randRange(-0.5, 0.5);
          const d = flat.clone().applyAxisAngle(UP, a).multiplyScalar(randRange(12, 22) * (1 + 0.25 * gl));
          V.add.emit({ p: [origin.x, origin.y - 0.3, origin.z], v: [d.x, randRange(0, 3), d.z], life: randRange(0.35, 0.6), size: randRange(0.3, 0.6), size1: 0.1, color: PAL.wind.core, color1: PAL.wind.glow, alpha: 0.6, alpha1: 0, drag: 2, shape: 0 });
        }
        // wind streaks fanning out + flattened dust swirls along the cone
        V.sparks(tmp.copy(origin).setY(origin.y - 0.4), flat, 36 + gl * 8, { el: 'wind', spread: 0.45, speed: 26 * (1 + 0.2 * gl), grav: -1, drag: 1.5, life: 0.5, w: 0.05, stretch: 0.05, maxL: 3.5, alpha: 0.8 });
        for (let k = 1; k <= 3; k++) { const gp = feet.clone().addScaledVector(flat, k * range * 0.28); gp.y = G.world.ground(gp.x, gp.z, gp.y + 3); G.later(() => { V.decal(gp, 'swirl', 1.6 + k * 0.5, { dur: 2.2 }); V.burst(gp, 'dust', 5, { speed: 6 }); }, k * 60); }
        V.circle(origin, PAL.wind.glow, 1.4, 0.3, { vertical: true, dir: flat, spin: -8 });
        G.cameraRig.kick && G.cameraRig.kick(flat, 0.2);
        G.world.grass.gust(feet.x + flat.x * 5, feet.z + flat.z * 5, 8, 2);
        for (const e of this.enemies) {
          if (!e.alive || !e.hittable) continue;
          const to = tmp.subVectors(e.center(), feet); const dist = to.length();
          to.y = 0; to.normalize();
          if (dist < range && to.dot(flat) > 0.5) {
            G.combat.hit(e, { dmg: P * 1.3, el, pos: e.center(), dir: flat.clone(), knock: 10, lift, heavy: true, source: 'player' });
          }
        }
        for (const t of G.world.targets) {
          const to = tmp.subVectors(t.pos, feet); const dist = to.length(); to.y = 0; to.normalize();
          if (dist < range + 2 && to.dot(flat) > 0.4) { t.baseHit && t.baseHit('wind'); t.onHit && t.onHit('wind'); }
        }
        if (R('w_vortex')) {
          const vp = feet.clone().addScaledVector(flat, range * 0.6);
          vp.y = G.world.ground(vp.x, vp.z, vp.y + 3);
          this.vortex(vp, { r: 6.5, dur: 2.5, pull: 7, el: 'wind', dmg: P * 0.2, scale: 0.8, noReact: true });
        }
        break;
      }
      case 'frost': {
        A.play('heavy_frost', { pos: origin });
        V.cast('frost', origin, dir, 'heavy');
        const flat = dir.clone().setY(0).normalize();
        const start = feet.clone().addScaledVector(flat, 1.8);
        const big = R('i_lance');
        const n = big ? 12 : 8, hw = big ? 2.4 : 1.9;
        V.circle(feet, PAL.frost.glow, 2, 0.8, { spin: 2 });
        if (R('i_mantle')) { player.barrier = Math.max(player.barrier, 3); V.burst(player.center(), 'ice', 16, { speed: 4 }); V.ring(feet, PAL.frost.core, 2.5, 0.4, { thick: 0.3 }); }
        const hitSet = new Set();
        for (let i = 0; i < n; i++) {
          G.later(() => {
            const p = start.clone().addScaledVector(flat, i * 1.7);
            const h = G.world.h(p.x, p.z);
            if (h < -0.3) { G.world.addIceFloe(p.x, p.z); return; }
            p.y = G.world.ground(p.x, p.z, player.pos.y + 3);
            const sc = 1.6 + i * 0.12;
            V.crystal(p, sc * 1.6, { width: sc * 0.6, life: 1.3 });
            V.crystal(p.clone().add(new THREE.Vector3(randRange(-0.6, 0.6), 0, randRange(-0.6, 0.6))), sc, { width: sc * 0.4, life: 1.2 });
            if (big) { const side = new THREE.Vector3(-flat.z, 0, flat.x).multiplyScalar(i % 2 ? 1.2 : -1.2); V.crystal(p.clone().add(side), sc * 0.8, { width: sc * 0.35, life: 1.1 }); }
            V.burst(p, 'ice', 6); V.burst(p, 'frostmist', 2); V.burst(p, 'shard', 4, { speed: 6 });
            V.decal(p, 'frost', sc * 1.1, { dur: 7 });
            if (i === n - 1) { V.ring(p, PAL.frost.core, 3.5, 0.35, { thick: 0.25 }); V.linger(p, 'frost', 1.5, 2); }
            A.play('ice_spike', { pos: p, gap: 0.01 });
            G.cameraRig.shake(0.08);
            for (const e of this.enemiesIn(p, hw)) {
              if (hitSet.has(e)) continue; hitSet.add(e);
              G.combat.hit(e, { dmg: P * 1.6, el, pos: e.center(), dir: flat.clone(), knock: 3, lift: 6, heavy: true, status: 1.6, source: 'player' });
            }
            this.targetsIn(p, hw, el);
          }, i * 55);
        }
        break;
      }
      case 'storm': {
        const tp = aim.clone();
        tp.y = G.world.ground(tp.x, tp.z, tp.y + 2);
        A.play('heavy_storm', { pos: tp });
        V.cast('storm', origin, dir, 'heavy');
        V.circle(tp, PAL.storm.glow, 3.4, 0.45, { spin: 6 });
        V.telegraph(tp, 3.8, 0.35, 0xffd84a);
        V.burst(tp, 'implode', 20, { el: 'storm', r: 3, life: 0.35 });
        G.later(() => {
          this.strike(tp, P * 3.4, 3.9, { big: true });
          if (R('s_aftershock')) {
            const done = new Set();
            for (let k = 0; k < 2; k++) G.later(() => {
              const e = this.enemies.filter((x) => x.alive && x.hittable && !done.has(x) && x.pos.distanceTo(tp) < 11).sort((a, b) => a.pos.distanceTo(tp) - b.pos.distanceTo(tp))[0];
              if (e) { done.add(e); this.strike(e.pos.clone().setY(G.world.ground(e.pos.x, e.pos.z, e.pos.y + 2)), P * 1.2, 1.8); }
              else this.strike(tp.clone().add(new THREE.Vector3(randRange(-4, 4), 0, randRange(-4, 4))), P * 1.2, 1.8);
            }, 300 + k * 260);
          }
        }, 350);
        break;
      }
      case 'water': {
        A.play('heavy_water', { pos: origin }); A.play('cast_water', { pos: origin });
        V.cast('water', origin, dir, 'heavy');
        const flat = dir.clone().setY(0).normalize();
        V.circle(feet, PAL.water.glow, 2.2, 0.6, { spin: 3 });
        V.decal(feet, 'wet', 2.4);
        G.cameraRig.kick && G.cameraRig.kick(flat, 0.15);
        if (R('wa_spring')) { player.heal(R('wa_spring')); V.burst(player.center(), 'heal', 12); }
        this.wave(feet.clone().addScaledVector(flat, 1.2), flat, {
          len: 17, speed: 21, half: 3.2, dmg: P * 1.8, el: 'water', knock: 14, lift: 3,
          bubble: R('wa_bubble') ? 2.5 : 0, reflect: !!R('wa_mirror'), P,
        });
        break;
      }
    }
  }

  // lightning bolt from the sky onto a ground point
  strike(tp, dmg, r, o = {}) {
    const V = G.vfx, A = G.audio;
    const sky = tp.clone().add(new THREE.Vector3(randRange(-3, 3), o.big ? 34 : 24, randRange(-3, 3)));
    V.lightning(sky, tp, { width: o.big ? 0.5 : 0.3, dur: o.big ? 0.4 : 0.3, branches: o.big ? 4 : 2, jag: 0.06 });
    if (o.big) V.lightning(sky.clone().add(new THREE.Vector3(2, 0, 1)), tp, { width: 0.2, dur: 0.3, branches: 1, jag: 0.1 });
    V.strike(tp, r, { big: o.big, dim: o.dim });
    A.play('thunder', { pos: tp, gap: o.big ? 0 : 0.15 });
    G.cameraRig.shake(o.big ? 0.55 : 0.25);
    if (o.big && G.cameraRig.punchFov) G.cameraRig.punchFov(2.5);
    const gu = G.renderer.grade.uniforms;
    if (!o.dim || o.big) { gu.uFlash.value = Math.max(gu.uFlash.value, o.big ? (o.dim ? 0.06 : 0.1) : 0.04); gu.uFlashColor.value.setRGB(1, 0.95, 0.8); }
    G.world.grass.gust(tp.x, tp.z, 6, 2);
    for (const e of this.enemiesIn(tp.clone().setY(tp.y + 1), r)) {
      G.combat.hit(e, { dmg, el: 'storm', pos: e.center(), dir: tmp.subVectors(e.center(), tp).setY(0).normalize().clone(), knock: 6, lift: 3, heavy: true, status: 2, source: 'player', hitstop: o.big ? 0.1 : 0.05, shake: o.big ? 0.4 : 0.15 });
    }
    this.targetsIn(tp, r, 'storm');
  }

  explode(pos, r, dmg, el = 'fire', o = {}) {
    const V = G.vfx, A = G.audio;
    const c = pos.clone();
    V.explode(el, c, r);
    A.play(el === 'water' ? 'splash' : 'explosion', { pos: c, v: r < 3 ? 0.7 : 1 });
    if (el === 'water') A.play('explosion', { pos: c, v: 0.5 });
    if (el === 'fire' && r >= 4) A.play('sizzle', { pos: c, d: 1.2 });
    const sh = o.shake ?? 0.5;
    G.cameraRig.shake(sh);
    if (G.cameraRig.punchFov && sh >= 0.3) G.cameraRig.punchFov(Math.min(4, sh * 4));
    G.renderer.grade.uniforms.uImpact.value = Math.max(G.renderer.grade.uniforms.uImpact.value, sh >= 0.3 ? 0.35 : 0.15);
    for (const e of this.enemiesIn(c, r)) {
      const d = e.center().distanceTo(c);
      const dir = tmp.subVectors(e.center(), c).setY(0.2).normalize().clone();
      G.combat.hit(e, { dmg: dmg * (1 - (d / r) * 0.45), el, pos: e.center(), dir, knock: o.knock ?? 12, lift: o.lift ?? 5, heavy: true, status: 1.5, source: 'player', hitstop: 0.08 });
    }
    for (const q of [...this.list]) if (q.owner === 'enemy' && q.pos.distanceTo(c) < r) this.remove(q);
    this.targetsIn(c, r, el);
  }

  // ------------------------------------------------------------
  // Lingering ground field (fire sea, plasma, etc.)
  field(pos, o) {
    const V = G.vfx;
    const z = { t: 0, tick: 0, n: 0 };
    const col = o.look === 'plasma' ? PAL.storm.glow : o.look === 'water' ? PAL.water.glow : PAL.fire.glow;
    V.circle(pos, col, o.r * 0.9, o.dur, { spin: 0.8, alpha: 0.45, intensity: 0.8 });
    V.decal(pos, 'scorch', o.r, { dur: o.dur + 3, glowDur: o.dur * 0.6 });
    if (o.look === 'plasma') V.decal(pos, 'char', o.r * 0.8, { dur: o.dur + 1, glowDur: o.dur * 0.5 });
    z.update = (dt) => {
      z.t += dt; z.tick -= dt;
      const k = Math.min(1, (o.dur - z.t) * 2);
      for (let i = 0; i < 3; i++) if (rand() < dt * 30 * k) {
        const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * o.r;
        const p = tmp.set(pos.x + Math.cos(a) * rr, pos.y + 0.1, pos.z + Math.sin(a) * rr);
        if (o.look === 'plasma' && rand() < 0.4) V.burst(p, 'electric', 1, { speed: 3 });
        else V.burst(p, 'fire', 1, { spread: 0.1, speed: 1.2, size: 1.1 });
      }
      if (rand() < dt * 1.5) G.audio.play('sizzle', { pos, gap: 0.3, v: 0.4 });
      if (o.look === 'plasma' && rand() < dt * 5) V.lightning(pos.clone().add(new THREE.Vector3(randRange(-o.r, o.r), 0.2, randRange(-o.r, o.r))), pos.clone().add(new THREE.Vector3(randRange(-o.r, o.r), 0.6, randRange(-o.r, o.r))), { width: 0.05, dur: 0.14, branches: 0, segs: 8 });
      if (rand() < dt * 3) V.burst(pos, 'ember', 1, { speed: 3 });
      if (z.tick <= 0) {
        z.tick = o.every; z.n++;
        const el = o.alt && z.n % 2 ? o.alt : o.el;
        for (const e of this.enemiesIn(pos.clone().setY(pos.y + 0.8), o.r)) G.combat.hit(e, { dmg: o.dmg, el, noReact: true, pos: e.center(), source: 'player', hitstop: 0, shake: 0, knock: 0, status: 0.5 });
        this.targetsIn(pos, o.r, o.el);
      }
      return z.t < o.dur;
    };
    this.zones.push(z);
    return z;
  }

  // Pulling whirl (wind vortex, water maelstrom)
  vortex(pos, o) {
    const V = G.vfx, A = G.audio;
    const tor = V.tornado(pos, { el: o.el, scale: o.scale ?? 1, alpha: o.alpha ?? 0.45 });
    if (o.flat) tor.grp.scale.y = o.flat;
    V.decal(pos, o.el === 'water' ? 'wet' : 'swirl', o.r * 0.7, { dur: o.dur + 2, spin: o.el === 'water' ? -0.8 : 1.5 });
    const z = { t: 0, tick: 0, snd: 0, rip: 0 };
    z.update = (dt) => {
      z.t += dt; z.tick -= dt; z.snd -= dt;
      tor.grp.position.copy(pos);
      if (z.snd <= 0) { z.snd = 0.7; A.play(o.el === 'water' ? 'cast_water' : 'gale', { pos, gap: 0.2 }); }
      for (const e of this.enemies) {
        if (!e.alive || !e.hittable || e.boss) continue;
        const to = tmp.subVectors(pos, e.pos); to.y = 0; const d = to.length();
        if (d < o.r && d > 0.6) e.pull && e.pull(to.normalize().multiplyScalar(dt * o.pull * (1 - d / (o.r * 1.4))));
      }
      if (o.el === 'water' && rand() < dt * 25) { const a = rand() * Math.PI * 2, rr = randRange(1, o.r); V.burst(tmp.set(pos.x + Math.cos(a) * rr, pos.y + 0.2, pos.z + Math.sin(a) * rr), 'water', 1, { speed: 2 }); }
      if (o.el === 'wind' && rand() < dt * 20) V.burst(pos, 'wind', 1, { radius: randRange(1, o.r * 0.6) });
      z.rip -= dt;
      if (z.rip <= 0) { z.rip = 0.45; V.ring(pos, o.el === 'water' ? PAL.water.core : PAL.wind.core, o.r * 0.85, 0.9, { thick: 0.06, r0: o.r * 0.2, alpha: 0.5, ease: 1.5 }); }
      if (rand() < dt * 10) V.swirl(pos, 1, { el: o.el === 'water' ? 'water' : 'wind', r: o.r * 0.6, speed: 12, h: 1.5, out: -0.5, rise: 0.4 });
      if (z.tick <= 0) {
        z.tick = o.every ?? 0.4;
        for (const e of this.enemiesIn(pos.clone().setY(pos.y + 1), o.r * 0.6)) {
          G.combat.hit(e, { dmg: o.dmg, el: o.el, noReact: !!o.noReact, pos: e.center(), source: 'player', hitstop: 0.01, shake: 0.02, knock: 0, status: 0.6 });
          o.onTick && o.onTick(e);
        }
        this.targetsIn(pos, o.r * 0.6, o.el);
      }
      if (z.t > o.dur) { tor.done = true; o.onEnd && o.onEnd(); return false; }
      return true;
    };
    this.zones.push(z);
    return z;
  }

  // Travelling wall of water (tidal wave / glacial wave / tempest)
  wave(start, dir, o) {
    const V = G.vfx, A = G.audio;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: (o.frost ? PAL.frost.glow : PAL.water.glow).clone().multiplyScalar(0.5) }, uFoam: { value: new THREE.Color(1.05, 1.2, 1.35) }, uAlpha: { value: 0 }, uTime: U.time },
      vertexShader: WAVE_VS, fragmentShader: WAVE_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(this.waveGeo, mat);
    m.renderOrder = 9;
    const sw = o.half / 3.2;
    m.scale.set(sw, o.height ?? 1, sw);
    G.scene.add(m);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const hit = new Set();
    let first = true;
    const pos = start.clone();
    const z = { t: 0, dist: 0, snd: 0, lastDecal: -9 };
    z.update = (dt) => {
      z.t += dt; z.snd -= dt;
      z.dist += o.speed * dt;
      pos.copy(start).addScaledVector(dir, z.dist);
      pos.y = G.world.ground(pos.x, pos.z, pos.y + 3);
      const k = z.dist / o.len;
      // mesh: arc faces travel direction (arc centre offset behind the front)
      m.position.copy(pos).addScaledVector(dir, -3.4 * sw);
      m.rotation.y = Math.atan2(dir.x, dir.z);
      const grow = Math.min(1, z.t * 6) * (1 - Math.max(0, k - 0.75) * 4);
      m.scale.y = Math.max(0.05, grow) * (o.height ?? 1);
      mat.uniforms.uAlpha.value = Math.max(0, grow);
      for (let i = 0; i < 4; i++) {
        const s = randRange(-o.half, o.half);
        const p = tmp.copy(pos).addScaledVector(side, s); p.y += randRange(0.3, 2.2) * (o.height ?? 1);
        V.burst(p, o.frost ? 'ice' : 'water', 1, { speed: 3 });
      }
      if (rand() < dt * 20) V.burst(tmp.copy(pos).addScaledVector(side, randRange(-o.half, o.half)), 'splash', 1, { speed: 3 });
      if (o.frost && rand() < dt * 10) { const p = tmp.copy(pos).addScaledVector(side, randRange(-o.half, o.half)); if (G.world.h(p.x, p.z) > -0.3) V.crystal(p.clone(), randRange(0.8, 1.6), { life: 1.2 }); else if (rand() < 0.3) G.world.addIceFloe(p.x, p.z); }
      if (z.snd <= 0) { z.snd = 0.25; A.play('splash', { pos, gap: 0.1 }); }
      G.world.grass.gust(pos.x, pos.z, o.half + 1, 1.2);
      // foam spray streaks off the crest + wet/frozen ground left behind
      if (rand() < dt * 30) { const q = tmp.copy(pos).addScaledVector(side, randRange(-o.half, o.half)); q.y += 2 * (o.height ?? 1); V.sparks(q, dir, 2, { el: o.frost ? 'frost' : 'water', spread: 0.5, speed: 8, grav: 14, life: 0.45, w: 0.04 }); }
      if (z.dist - z.lastDecal > 2.6) {
        z.lastDecal = z.dist;
        const dp = pos.clone().addScaledVector(dir, -1.5);
        V.decal(dp, o.frost ? 'frost' : 'wet', o.half * 0.9, { dur: o.frost ? 9 : 7, rot: Math.atan2(dir.x, dir.z) });
      }
      // hits: enemies inside the wave front band
      const near = [];
      for (const e of this.enemies) {
        if (!e.alive || !e.hittable || hit.has(e)) continue;
        const to = tmp.subVectors(e.pos, start); const along = to.dot(dir), lat = Math.abs(to.dot(side));
        if (along < z.dist + 1 && along > z.dist - 2.2 && lat < o.half + e.radius && Math.abs(e.pos.y - pos.y) < 4) near.push(e);
      }
      near.sort((a, b) => a.pos.distanceTo(pos) - b.pos.distanceTo(pos));
      for (const e of near) {
        hit.add(e);
        G.combat.hit(e, { dmg: o.dmg, el: o.el, pos: e.center(), dir: dir.clone(), knock: o.knock, lift: o.lift, heavy: true, status: 1.4, source: 'player', noReact: o.noReact });
        if (o.frost && e.alive && e.st && e.rig) G.combat.freeze(e, e.boss ? 1 : 3.5);
        if (o.bubble && first && e.alive) { G.combat.bubble(e, o.bubble); first = false; }
      }
      this.eatEnemyShots(pos.clone().setY(pos.y + 1.2), o.half + 0.5, o.reflect, o.P);
      this.targetsIn(pos.clone().setY(pos.y + 1), o.half, o.el);
      if (z.dist >= o.len) { G.scene.remove(m); mat.dispose(); V.burst(pos, 'splash', 10, { speed: 5 }); return false; }
      return true;
    };
    this.zones.push(z);
    return z;
  }

  // ============================================================
  // Ultimates (F)
  // ============================================================
  ult(el, origin, aim, P, player) {
    const V = G.vfx, A = G.audio;
    const feet = player.pos.clone();
    const dir = tmp2.subVectors(aim, origin).normalize().clone();
    const tp = aim.clone();
    if (tp.distanceTo(feet) > 30) tp.copy(feet).addScaledVector(dir, 30);
    tp.y = G.world.ground(tp.x, tp.z, tp.y + 2);
    const info = NODES[ULTS[el]];
    G.hud.castName(info.name, [el], true);
    A.play('ult_cast', { pos: origin });
    // one rune circle + a light pillar instead of stacked additive layers (keeps the frame readable)
    V.circle(feet, PAL[el].glow, 4.5, 1.2, { spin: 2.5, alpha: 0.5, intensity: 0.6 });
    V.ring(feet, PAL[el].core, 9, 0.8, { thick: 0.12, alpha: 0.5 });
    V.ultCast(el, feet, player.center());
    V.burst(player.center(), 'star', 1, { el, size: 3.2 });
    V.flash(player.center(), PAL[el].light, 50, 16, 0.5);
    G.hitstop = Math.max(G.hitstop, 0.12);
    G.cameraRig.shake(0.3);
    if (G.cameraRig.punchFov) G.cameraRig.punchFov(-4);
    G.renderer.grade.uniforms.uImpact.value = Math.max(G.renderer.grade.uniforms.uImpact.value, 0.4);
    switch (el) {
      case 'arcane': {
        V.circle(tp, PAL.arcane.glow, 6, 3, { spin: 1.5, alpha: 0.4, intensity: 0.6 });
        V.decal(tp, 'rune', 6, { dur: 3.4, glowDur: 2.5, spin: 0.6 });
        G.later(() => A.play('ult_boom', { pos: tp, el: 'arcane' }), 150);
        for (let i = 0; i < 14; i++) G.later(() => {
          const s = tp.clone().add(new THREE.Vector3(randRange(-6, 6), randRange(16, 22), randRange(-6, 6)));
          const tgt = this.nearestEnemy(tp, 14) ;
          const aimP = tgt ? tgt.center() : tp.clone().add(new THREE.Vector3(randRange(-5, 5), 0.5, randRange(-5, 5)));
          const v = tmp.subVectors(aimP, s).normalize().multiplyScalar(34);
          this.projectile({ el: 'arcane', pos: s, vel: v, r: 0.5, life: 2.5, dmg: P * 1.4, orb: 0.38, trail: 'arcane', ribW: 2.4, heavy: true, knock: 4, homing: tgt, homingRate: 4, source: 'player',
            onImpact: (pp) => this.explode(pp, 2.3, P * 1.4, 'arcane', { shake: 0.12, lift: 2, knock: 5 }) });
          A.play('cast_arcane', { pos: s, gap: 0.04 });
        }, 150 + i * 140);
        break;
      }
      case 'fire': {
        V.telegraph(tp, 7, 1.15, 0xff6a2a);
        const orb = G.vfx.orb('fire', 2.2, { halo: 2.8, haloI: 0.4 });
        const light = V.holdLight(PAL.fire.light, 60, 30);
        const from = tp.clone().add(new THREE.Vector3(-8, 42, -6));
        const opos = from.clone();
        const rib = V.ribbon({ el: 'fire', width: 3.2, life: 0.45, wave: 1, follow: opos });
        let t = 0, acc = 0;
        A.play('charge', { pos: tp }); A.play('heavy_fire', { pos: from });
        V.timer(1.15, (dt) => {
          t += dt; const k = Math.min(1, t / 1.15);
          orb.position.lerpVectors(from, tp, k * k); opos.copy(orb.position);
          orb.scale.setScalar(2.2 + k);
          if (light) light.l.position.copy(orb.position);
          acc += dt * 240;
          for (; acc >= 1; acc--) V.burst(orb.position, 'fire', 1, { spread: 1.2, speed: 2, size: 2.4 });
          if (rand() < dt * 30) V.burst(orb.position, 'smoke', 1, { size: 2 });
          if (rand() < dt * 40) V.burst(orb.position, 'ember', 1, { speed: 6 });
        }, () => {
          G.vfx.disposeOrb(orb); if (light) V.releaseLight(light); if (rib) rib.release();
          this.explode(tp.clone().setY(tp.y + 0.6), 7, P * 6, 'fire', { shake: 0.95, lift: 9, knock: 16 });
          V.ring(tp, PAL.fire.core, 16, 1, { thick: 0.08 });
          V.pillar(tp, PAL.fire.glow, 2.6, 22, 0.7, { core: PAL.fire.core, alpha: 0.7 });
          V.decal(tp, 'crack', 6.5, { glow: PAL.fire.glow, dur: 12, glowDur: 3 });
          V.shock(tp.clone().setY(tp.y + 1), PAL.fire.core, 12, 0.6, { alpha: 0.5, flat: 0.5 });
          const gu = G.renderer.grade.uniforms; gu.uFlash.value = Math.max(gu.uFlash.value, 0.14); gu.uFlashColor.value.setRGB(1, 0.75, 0.45);
          A.play('ult_boom', { pos: tp, el: 'fire' });
          G.hitstop = Math.max(G.hitstop, 0.1);
          if (G.cameraRig.punchFov) G.cameraRig.punchFov(6);
          this.field(tp, { r: 6, dur: 6, every: 0.5, dmg: P * 0.35, el: 'fire', look: 'fire' });
        });
        break;
      }
      case 'wind': {
        const tor = V.tornado(feet, { el: 'wind', scale: 2.6, alpha: 0.5 });
        A.play('ult_boom', { pos: feet, el: 'wind' });
        const z = { t: 0, tick: 0, dec: 0 };
        z.update = (dt) => {
          z.t += dt; z.tick -= dt;
          tor.grp.position.copy(player.pos);
          if (!player.grounded && player.vel.y < 4) { player.vel.y = Math.min(player.vel.y + dt * 30, 6); }
          if (rand() < dt * 30) V.burst(player.pos, 'wind', 1, { radius: randRange(2, 8), vy: 3 });
          if (rand() < dt * 12) V.swirl(player.pos, 2, { el: 'wind', r: 7, speed: 18, h: 4, out: -0.3, rise: 1.5, w: 0.06 });
          z.dec -= dt;
          if (z.dec <= 0 && player.grounded) { z.dec = 0.9; V.decal(player.pos, 'swirl', 6, { dur: 1.6, spin: 3 }); }
          G.world.grass.gust(player.pos.x, player.pos.z, 10, 1.6);
          for (const e of this.enemies) {
            if (!e.alive || !e.hittable || e.boss) continue;
            const to = tmp.subVectors(player.pos, e.pos); to.y = 0; const d = to.length();
            if (d < 12 && d > 4.5) e.pull && e.pull(to.normalize().multiplyScalar(dt * 6));
          }
          if (z.tick <= 0) {
            z.tick = 0.3;
            for (const e of this.enemiesIn(player.center(), 9)) G.combat.hit(e, { dmg: P * 0.45, el: 'wind', pos: e.center(), dir: tmp.subVectors(e.center(), player.pos).setY(0).normalize().clone(), knock: 2, lift: e.boss ? 0 : 7, source: 'player', hitstop: 0.01, shake: 0.03, status: 0.5 });
            this.targetsIn(player.pos, 9, 'wind');
            A.play('gale', { pos: player.pos, gap: 0.25 });
          }
          if (z.t > 5 || player.dead) { tor.done = true; return false; }
          return true;
        };
        this.zones.push(z);
        break;
      }
      case 'frost': {
        V.ring(feet, PAL.frost.core, 13, 0.6, { thick: 0.2 });
        V.ring(feet, PAL.white.core, 12, 0.9, { thick: 0.08, y: 1 });
        V.shock(player.center(), PAL.frost.core, 13, 0.6, { alpha: 0.5, flat: 0.4, pow: 3 });
        V.burst(player.center(), 'frostmist', 32, { spread: 6, size: 2 });
        V.burst(player.center(), 'snowflake', 60, { spread: 8 });
        V.decal(feet, 'frost', 12, { dur: 10, glowDur: 2.5 });
        V.radial(feet, 36, { el: 'frost', speed: 22, up: 0.15, life: 0.5 });
        A.play('freeze', { pos: feet }); A.play('react_flashfreeze', { pos: feet }); A.play('shatter', { pos: feet, v: 0.5 });
        for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, r = randRange(4, 11); const p = feet.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); p.y = G.world.ground(p.x, p.z, feet.y + 3); V.crystal(p, randRange(1.5, 3.2), { life: 2.1 }); }
        const frozen = [];
        for (const e of this.enemiesIn(player.center(), 12)) {
          if (e.boss || !e.rig) G.combat.addChill(e, 3); else { G.combat.freeze(e, 4); frozen.push(e); }
        }
        G.later(() => {
          V.ring(player.pos, PAL.frost.core, 15, 0.5, { thick: 0.3 });
          V.shock(player.center(), PAL.white.glow, 14, 0.45, { alpha: 0.45, flat: 0.5 });
          G.cameraRig.shake(0.6); if (G.cameraRig.punchFov) G.cameraRig.punchFov(4);
          A.play('ult_boom', { pos: player.pos, el: 'frost' });
          for (const e of frozen) {
            if (!e.alive) continue;
            G.combat.breakIce(e, true); e.st.frozen = 0;
            V.burst(e.center(), 'ice', 16, { speed: 10, size: 1.3 });
            V.react('shatter', e.center(), { r: 2.5 });
            G.combat.hit(e, { dmg: P * 2.5, el: 'frost', noReact: true, heavy: true, pos: e.center(), knock: 8, lift: 4, source: 'player', hitstop: 0.06 });
          }
          A.play('shatter', { pos: player.pos });
        }, 2000);
        break;
      }
      case 'storm': {
        V.circle(feet, PAL.storm.glow, 8, 3.2, { spin: 1, alpha: 0.3, intensity: 0.5 });
        A.play('ult_boom', { pos: feet, el: 'storm' });
        let n = 0;
        const z = { t: 0, tick: 0.1 };
        z.update = (dt) => {
          z.t += dt; z.tick -= dt;
          if (z.tick <= 0 && n < 10) {
            z.tick = 0.3; n++;
            const cand = this.enemies.filter((e) => e.alive && e.hittable && e.pos.distanceTo(player.pos) < 20);
            const e = cand.length ? pick(cand) : null;
            const p = e ? e.pos.clone() : player.pos.clone().add(new THREE.Vector3(randRange(-12, 12), 0, randRange(-12, 12)));
            p.y = G.world.ground(p.x, p.z, p.y + 3);
            this.strike(p, P * 2, 2.6, { big: n % 3 === 0, dim: true });
          }
          return n < 10;
        };
        this.zones.push(z);
        break;
      }
      case 'water': {
        V.circle(tp, PAL.water.glow, 9, 4.2, { spin: -1.5, alpha: 0.35, intensity: 0.55 });
        this.vortex(tp, {
          r: 11, dur: 4, pull: 11, el: 'water', dmg: P * 0.25, every: 0.4, scale: 1.8, flat: 0.55, alpha: 0.38,
          onEnd: () => {
            this.explode(tp.clone().setY(tp.y + 0.8), 7, P * 5, 'water', { shake: 0.8, lift: 9, knock: 12 });
            V.ring(tp, PAL.water.core, 14, 0.8, { thick: 0.1 });
            V.pillar(tp, PAL.water.glow, 2.8, 16, 0.8, { core: PAL.water.core, alpha: 0.6 });
            for (let k = 0; k < 40; k++) V.add.emit({ p: [tp.x + randRange(-2, 2), tp.y + 0.3, tp.z + randRange(-2, 2)], v: [randRange(-4, 4), randRange(14, 24), randRange(-4, 4)], life: randRange(0.8, 1.4), size: randRange(0.3, 0.6), size1: 0.1, color: PAL.water.core, color1: PAL.water.glow, alpha: 0.9, alpha1: 0, drag: 0.6, grav: 22, shape: 2 });
            A.play('ult_boom', { pos: tp, el: 'water' });
          },
        });
        break;
      }
    }
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
          V.burst(c, 'steam', 40, { spread: 3, size: 1.6 });
          V.burst(c, 'steamjet', 20, { speed: 14 });
          V.burst(c, 'glow', 1, { el: 'white', size: 6, life: 0.25, alpha: 0.5 });
          V.burst(c, 'ice', 24, { speed: 12 }); V.burst(c, 'fire', 24, { speed: 9 });
          V.shock(c, PAL.white.glow, 7, 0.5, { alpha: 0.6 });
          V.sparks(c, null, 24, { pal: PAL.frost, speed: 20, life: 0.5 }); V.sparks(c, null, 18, { pal: PAL.fire, speed: 16, life: 0.5 });
          V.decal(tp, 'wet', 6); V.linger(tp, 'water', 3, 3);
          A.play('react_scald', { pos: c });
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
        V.cast('storm', origin, dir, 'weave');
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
              A.play('zap', { pos: e.center(), gap: 0.05 });
              G.combat.hit(e, { dmg: P * 0.55, el: rand() < 0.5 ? 'storm' : 'fire', pos: e.center(), source: 'player', hitstop: 0.02, shake: 0.05 });
            } else V.lightning(orb.pos, orb.pos.clone().add(new THREE.Vector3(randRange(-3, 3), randRange(-3, 1), randRange(-3, 3))), { width: 0.05, dur: 0.12, branches: 0 });
          }
        };
        orb.onImpact = (pos) => { this.explode(pos, 5.5, P * 3, 'fire', { shake: 0.6 }); V.burst(pos, 'electric', 30, { speed: 12 }); V.arcs(pos, 5, 3); V.decal(pos, 'char', 4); A.play('chain', { pos }); };
        break;
      }
      case 'fire+wind': {
        const pos = feet.clone().addScaledVector(flat, 3);
        const tor = V.tornado(pos, { el: 'fire', scale: 1 });
        const z = { t: 0, dur: R('h_wildfire') ? 7.5 : 5, pos, tick: 0, h: tor, snd: 0, dec: 0 };
        z.update = (dt) => {
          z.t += dt; z.tick -= dt; z.snd -= dt;
          pos.addScaledVector(flat, dt * 5.5);
          pos.y = G.world.ground(pos.x, pos.z, pos.y + 3);
          tor.grp.position.copy(pos);
          if (rand() < dt * 40) V.burst(tmp.copy(pos).add(new THREE.Vector3(randRange(-1.2, 1.2), randRange(0, 5), randRange(-1.2, 1.2))), 'fire', 1, { speed: 2 });
          if (rand() < dt * 10) V.burst(pos, 'ember', 1, { speed: 6 });
          z.dec -= dt;
          if (z.dec <= 0) { z.dec = 0.45; V.decal(pos, 'scorch', 2.2, { dur: 8, glowDur: 1.8 }); }
          if (z.snd <= 0) { z.snd = 0.6; A.play('cast_fire', { pos, gap: 0.1 }); A.play('gale', { pos, gap: 0.3 }); }
          G.world.grass.gust(pos.x, pos.z, 4, 1.2);
          for (const e of this.enemies) {
            if (!e.alive || !e.hittable || e.boss) continue;
            const to = tmp.subVectors(pos, e.pos); to.y = 0; const d = to.length();
            if (d < 7 && d > 0.5 && e.pull) { e.pull(to.normalize().multiplyScalar(dt * 9)); }
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
              if (rand() < 0.5) V.decal(p, 'frost', 1.6, { dur: 5 });
              for (const e of this.enemiesIn(p.clone().setY(p.y + 1), 2.2)) G.combat.hit(e, { dmg: P * 0.9, el: 'frost', pos: e.center(), source: 'player', hitstop: 0.02, shake: 0.05, status: 1 });
            } else {
              const tgt = this.enemiesIn(tp.clone().setY(tp.y + 1), 7.5);
              const hp = tgt.length && rand() < 0.75 ? pick(tgt).center() : p.clone().setY(p.y + 0.5);
              V.lightning(hp.clone().add(new THREE.Vector3(randRange(-2, 2), 20, randRange(-2, 2))), hp, { width: 0.2, dur: 0.2, branches: 1 });
              V.burst(hp, 'electric', 10); V.flash(hp, 0xffe070, 40, 10, 0.15);
              V.impact('storm', hp, { dir: UP.clone().negate(), scale: 0.8 });
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
          if (rand() < dt * 14) V.swirl(player.pos, 2, { pal: PAL.frost, r: 6, speed: 14, h: 3, out: 0, rise: 0.3, w: 0.035 });
          if (z.tick <= 0) {
            z.tick = 0.4;
            for (const e of this.enemiesIn(player.pos.clone().setY(player.pos.y + 1), 8)) G.combat.hit(e, { dmg: P * 0.35, el: 'frost', pos: e.center(), source: 'player', hitstop: 0, shake: 0, status: 0.9 });
            this.targetsIn(player.pos, 8, 'frost');
          }
          if (z.t > 5) { tor.done = true; return false; }
          return true;
        };
        this.zones.push(z);
        V.decal(feet, 'frost', 7, { dur: 7 });
        A.play('gale', { pos: feet }); A.play('freeze', { pos: feet }); A.play('react_blizzard', { pos: feet });
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
            V.burst(hp, 'electric', 12); V.flash(hp, 0xfff0a0, 70, 16, 0.25);
            if (e) V.impact('storm', hp, { dir: UP.clone().negate(), target: e, scale: 1.2 }); else V.strike(hp, 1.6, {});
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
      case 'fire+water': {
        // three boiling geysers erupting in a line toward the aim point
        const side = new THREE.Vector3(-flat.z, 0, flat.x);
        const pts = [tp.clone().addScaledVector(flat, -3.2).addScaledVector(side, -1.6), tp.clone(), tp.clone().addScaledVector(flat, 3.2).addScaledVector(side, 1.6)];
        pts.forEach((p, i) => {
          p.y = G.world.ground(p.x, p.z, p.y + 3);
          G.later(() => { V.telegraph(p, 2.8, 0.45, 0x9ad0ff); V.burst(p, 'steam', 6, { spread: 1 }); A.play('charge', { pos: p, gap: 0.05 }); }, i * 330);
          G.later(() => {
            A.play('steam', { pos: p }); A.play('splash', { pos: p }); A.play('explosion', { pos: p, v: 0.45 });
            V.ring(p, PAL.water.core, 4, 0.45, { thick: 0.25 });
            V.flash(p.clone().setY(p.y + 2), 0xcfe8ff, 60, 14, 0.35);
            V.pillar(p, PAL.water.glow, 1.3, 9, 0.6, { core: PAL.white.core, alpha: 0.55, rise: true });
            V.burst(p, 'steamjet', 16, { speed: 16 });
            V.decal(p, 'wet', 3); V.linger(p, 'water', 1.6, 2.5);
            for (let k = 0; k < 40; k++) V.add.emit({ p: [p.x + randRange(-0.6, 0.6), p.y + 0.2, p.z + randRange(-0.6, 0.6)], v: [randRange(-1.5, 1.5), randRange(12, 20), randRange(-1.5, 1.5)], life: randRange(0.6, 1.1), size: randRange(0.25, 0.5), size1: 0.08, color: PAL.water.core, color1: PAL.water.glow, alpha: 0.9, alpha1: 0, drag: 0.8, grav: 22, shape: 2 });
            V.burst(p.clone().setY(p.y + 2), 'steam', 24, { spread: 1.2, size: 1.6 });
            G.cameraRig.shake(0.3);
            for (const e of this.enemiesIn(p.clone().setY(p.y + 1), 2.8)) {
              G.combat.hit(e, { dmg: P * 1.6, el: 'fire', noReact: true, noStatus: true, pos: e.center(), dir: new THREE.Vector3(0, 1, 0), knock: 1, lift: 13, heavy: true, source: 'player', hitstop: 0.06 });
              if (e.alive && e.st) { e.st.wet = Math.max(e.st.wet, 9); e.st.burn = 0; }
            }
            this.targetsIn(p, 2.8, 'water');
          }, 450 + i * 330);
        });
        break;
      }
      case 'frost+water': {
        V.circle(feet, PAL.frost.glow, 3.2, 0.8, { spin: 3 });
        A.play('cast_water', { pos: origin }); A.play('freeze', { pos: origin });
        this.wave(feet.clone().addScaledVector(flat, 1.5), flat, { len: 22, speed: 16, half: 5.2, height: 1.5, dmg: P * 2.2, el: 'frost', noReact: true, knock: 6, lift: 1, frost: true, P });
        break;
      }
      case 'storm+water': {
        V.circle(tp, PAL.water.glow, 7, 4.5, { spin: -2 });
        V.circle(tp, PAL.storm.glow, 5, 4.5, { spin: 3, alt: true });
        let zap = 0;
        this.vortex(tp, {
          r: 9, dur: 4.5, pull: 9, el: 'water', dmg: P * 0.2, every: 0.45, scale: 1.2, flat: 0.7, alpha: 0.55, noReact: true,
          onTick: (e) => {
            if (!e.alive) return;
            G.combat.electrify(e, P * 0.22, 2);
            if ((zap++ % 2) === 0) { V.lightning(tp.clone().setY(tp.y + 3), e.center(), { width: 0.12, dur: 0.2, branches: 1 }); G.combat.hit(e, { dmg: P * 0.55, el: 'storm', noReact: true, pos: e.center(), source: 'player', hitstop: 0.02, shake: 0.05 }); A.play('impact_storm', { pos: e.center(), gap: 0.08 }); }
          },
        });
        break;
      }
      case 'water+wind': {
        const side = new THREE.Vector3(-flat.z, 0, flat.x);
        const pos = feet.clone().addScaledVector(flat, 2);
        const z = { t: 0, tick: 0, snd: 0 };
        V.circle(feet, PAL.wind.glow, 3, 0.8, { spin: 4 });
        z.update = (dt) => {
          z.t += dt; z.tick -= dt; z.snd -= dt;
          pos.addScaledVector(flat, dt * 4.5);
          pos.y = G.world.ground(pos.x, pos.z, pos.y + 3);
          for (let i = 0; i < 6; i++) {
            const s = randRange(-4.5, 4.5);
            const p = tmp.copy(pos).addScaledVector(side, s).addScaledVector(flat, randRange(-1.5, 1.5));
            V.streaks.emit({ p: [p.x, p.y + randRange(5, 8), p.z], v: [flat.x * 6, -24, flat.z * 6], life: 0.3, w: 0.018, stretch: 0.04, minL: 0.4, maxL: 1.2, color: RAIN_C, color1: RAIN_C, alpha: 0.55, alpha1: 0.35 });
          }
          if (rand() < dt * 25) V.burst(tmp.copy(pos).addScaledVector(side, randRange(-4.5, 4.5)), 'splash', 1, { speed: 3 });
          if (rand() < dt * 12) V.burst(tmp.copy(pos).addScaledVector(side, randRange(-4.5, 4.5)).setY(pos.y + 1), 'wind', 1, { radius: 0.5 });
          if (z.snd <= 0) { z.snd = 0.5; A.play('gale', { pos, gap: 0.2 }); A.play('splash', { pos, gap: 0.2, v: 0.5 }); }
          z.dec = (z.dec ?? 0) - dt;
          if (z.dec <= 0) { z.dec = 0.5; V.decal(pos, 'wet', 4.5, { dur: 8 }); }
          G.world.grass.gust(pos.x, pos.z, 5, 1.6);
          if (z.tick <= 0) {
            z.tick = 0.45;
            for (const e of this.enemies) {
              if (!e.alive || !e.hittable) continue;
              const to = tmp.subVectors(e.pos, pos); const along = to.dot(flat), lat = Math.abs(to.dot(side));
              if (Math.abs(along) < 2.5 && lat < 5) G.combat.hit(e, { dmg: P * 0.35, el: 'water', pos: e.center(), dir: flat.clone(), knock: 7, source: 'player', hitstop: 0.01, shake: 0.02, status: 1 });
            }
            this.targetsIn(pos.clone().setY(pos.y + 1), 5, 'water'); this.targetsIn(pos.clone().setY(pos.y + 1), 5, 'wind');
          }
          return z.t < 5;
        };
        this.zones.push(z);
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
          if (rand() < dt * 40) V.burst(end, BURST_OF[x] || 'wind', 2, { speed: 4 });
          if (rand() < dt * 30) V.burst(end, 'spark', 1, { el: x });
          z.dec = (z.dec ?? 0) - dt;
          if (z.dec <= 0 && !hitE) { z.dec = 0.3; V.decal(end, x === 'fire' ? 'scorch' : x === 'frost' ? 'frost' : x === 'water' ? 'wet' : x === 'storm' ? 'char' : 'swirl', 1.2, { dur: 5 }); }
          G.cameraRig.shake(0.02);
          if (z.tick <= 0) {
            z.tick = 0.1;
            if (hitE) G.combat.hit(hitE.e, { dmg: P * 0.38, el: x, pos: end, dir: d, source: 'player', hitstop: 0.012, shake: 0.03, knock: x === 'wind' || x === 'water' ? 3 : 0.5, status: 0.35 });
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
    const slow = G.slowmo > 0 ? 0.25 : 1;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (!p) continue;
      const pdt = p.owner === 'enemy' ? dt * slow : dt;
      p.life -= pdt;
      if (p.life <= 0) { if (p.onImpact) p.onImpact(p.pos.clone(), null); else if (p.owner === 'enemy') V.burst(p.pos, 'arcane', 6); this.remove(p); continue; }
      if (p.homing && p.homing.alive !== false) {
        const tc = p.homing.center ? p.homing.center() : p.homing.pos;
        const want = tmp.subVectors(tc, p.pos).normalize().multiplyScalar(p.vel.length());
        p.vel.lerp(want, clamp(p.homingRate * pdt, 0, 1));
      }
      p.vel.y -= p.grav * pdt;
      if (p.tick) p.tick(pdt);
      const len = p.vel.length() * pdt;
      const steps = Math.max(1, Math.ceil(len / 0.4));
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        p.pos.addScaledVector(p.vel, pdt / steps);
        dead = this.collide(p);
      }
      if (dead) continue;
      if (p.mesh) { p.mesh.position.copy(p.pos); this.orient(p); }
      if (p.light) p.light.l.position.copy(p.pos);
      if (p.tipA) {
        tmp.copy(p.vel).setY(0).normalize();
        const sx = -tmp.z * 0.62, sz = tmp.x * 0.62;
        p.tipA.set(p.pos.x + sx - tmp.x * 0.25, p.pos.y, p.pos.z + sz - tmp.z * 0.25);
        p.tipB.set(p.pos.x - sx - tmp.x * 0.25, p.pos.y, p.pos.z - sz - tmp.z * 0.25);
      }
      this.trail(p, pdt);
    }
    for (let i = this.zones.length - 1; i >= 0; i--) {
      let alive = false;
      try { alive = this.zones[i].update(dt); } catch (e) { console.warn(e); }
      if (!alive) this.zones.splice(i, 1);
    }
  }

  trail(p, dt) {
    const V = G.vfx;
    p.trailAcc = (p.trailAcc || 0) + dt * (TRAIL_RATE[p.trail] || 60);
    let n = Math.min(8, Math.floor(p.trailAcc));
    p.trailAcc -= n;
    if (!n) return;
    const vx = -p.vel.x * 0.05, vy = -p.vel.y * 0.05, vz = -p.vel.z * 0.05;
    for (let k = 0; k < n; k++) {
      switch (p.trail) {
        case 'arcane': V.burst(p.pos, 'trail', 1, { el: 'arcane', size: 0.28, vx, vy, vz, shape: rand() < 0.35 ? 4 : 0 }); break;
        case 'fire': V.burst(p.pos, 'fire', 1, { spread: 0.1, speed: 0.6, size: 0.6, life: 0.55 }); if (rand() < 0.2) V.burst(p.pos, 'ember', 1, { speed: 1.5 }); break;
        case 'bigfire':
          V.burst(p.pos, 'fire', 1, { spread: 0.35, speed: 1, size: 1.4 });
          if (rand() < 0.08) V.burst(p.pos, 'smoke', 1, { size: 0.8 });
          if (rand() < 0.12) V.burst(p.pos, 'ember', 1);
          break;
        case 'plasma': V.burst(p.pos, 'fire', 1, { spread: 0.4, speed: 1 }); if (rand() < 0.15) V.burst(p.pos, 'electric', 1, { spread: 0.6, speed: 3 }); break;
        case 'wind': V.burst(p.pos, 'trail', 1, { el: 'wind', size: 0.35, spread: 0.5, vx, vy, vz }); break;
        case 'frost': V.burst(p.pos, 'trail', 1, { el: 'frost', size: 0.2, spread: 0.05, shape: 2 }); if (rand() < 0.15) V.burst(p.pos, 'snowflake', 1, { spread: 0.1 }); break;
        case 'water':
          V.burst(p.pos, 'trail', 1, { el: 'water', size: 0.26, spread: 0.08, vx, vy, vz });
          if (rand() < 0.25) V.add.emit({ p: [p.pos.x, p.pos.y, p.pos.z], v: [vx * 2 + randRange(-1, 1), randRange(0, 1.5), vz * 2 + randRange(-1, 1)], life: 0.45, size: 0.09, color: PAL.water.core, color1: PAL.water.glow, alpha: 0.9, alpha1: 0, grav: 12, shape: 2 });
          break;
        case 'hush': V.burst(p.pos, 'trail', 1, { el: 'hush', size: 0.45, spread: 0.1 }); if (rand() < 0.15) V.burst(p.pos, 'hush', 1, { size: 0.3, spread: 0.1, alpha: 0.3 }); break;
      }
    }
  }

  splashAt(p, pos, skip = null) {
    const s = p.splash;
    if (!s) return;
    for (const e of this.enemiesIn(pos, s.r)) {
      if (e === skip) continue;
      G.combat.hit(e, { dmg: s.dmg, el: s.el, noReact: s.el === 'fire', pos: e.center(), source: 'player', hitstop: 0, shake: 0, status: 0.6 });
    }
    G.vfx.burst(pos, s.el === 'water' ? 'water' : 'fire', 12, { speed: 5 });
    G.vfx.ring(pos, PAL[s.el].glow, s.r + 0.3, 0.25, { thick: 0.3, y: 0 });
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
          this.splashAt(p, p.pos, e);
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
          pl.damage(p.dmg, { pos: p.pos.clone(), dir: p.vel.clone().normalize(), knock: 5, projectile: true });
          if (!pl.dodged) { V.burst(p.pos, 'arcane', 12); G.audio.play('orb_hit', { pos: p.pos }); this.remove(p); return true; }
        }
      }
    }
    // static colliders
    if (W.col.pointHit(p.pos.x, p.pos.y, p.pos.z, p.r * 0.4)) {
      if (p.onImpact) p.onImpact(p.pos.clone(), null); else this.impact(p, null);
      this.splashAt(p, p.pos);
      this.remove(p); return true;
    }
    const gh = W.h(p.pos.x, p.pos.z);
    // water
    if (p.pos.y < 0.05 && gh < -0.15) {
      if (p.owner === 'player') {
        if (p.el === 'frost') W.addIceFloe(p.pos.x, p.pos.z);
        else if (p.el === 'fire') { V.burst(p.pos, 'steam', 6); G.audio.play('fizzle', { pos: p.pos }); }
        else { V.burst(p.pos, 'splash', 6); V.burst(p.pos, 'trail', 8, { el: p.el === 'water' ? 'water' : 'frost', spread: 0.4 }); G.audio.play('splash', { pos: p.pos }); }
        if (p.onImpact && p.el !== 'fire') p.onImpact(p.pos.clone(), null);
      }
      this.remove(p); return true;
    }
    const plat = W.col.platformTop(p.pos.x, p.pos.z, p.pos.y, 0);
    if (p.pos.y < gh || (plat > -1e8 && p.pos.y < plat)) {
      p.pos.y = Math.max(gh, plat) + 0.05;
      if (p.onImpact) p.onImpact(p.pos.clone(), null); else this.impact(p, null, true);
      this.splashAt(p, p.pos);
      this.remove(p); return true;
    }
    return false;
  }

  impact(p, target, ground = false) {
    const V = G.vfx, A = G.audio;
    const pos = p.pos;
    if (p.owner === 'enemy') { V.burst(pos, 'arcane', 10); V.burst(pos, 'hush', 3); V.sparks(pos, null, 6, { el: 'hush', speed: 8, life: 0.3 }); return; }
    A.play('impact_' + p.el, { pos });
    const dir = p.vel.lengthSq() > 1e-6 ? p.vel.clone().normalize() : null;
    V.impact(p.el, pos, { dir, target, ground: ground || undefined, scale: p.heavy ? 1.4 : 1 });
    if (p.el === 'wind' && ground) G.world.grass.gust(pos.x, pos.z, 3, 1);
    if (ground && p.el !== 'wind') V.burst(pos, 'dust', 3, { speed: 3, size: 0.5 });
  }
}
