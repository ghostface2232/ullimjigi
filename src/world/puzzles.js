// Small puzzles made only from systems the world already has (phase 0 of
// docs/EXPANSION.md). Some song seeds sleep until the player wakes them, and a
// couple of chests open only to the right reaction. Everything answers through
// world targets (target.baseHit(el, src)), the wildfire grid and lingering
// fields; nothing here adds a rule of its own.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { toon } from '../render/materials.js';
import { crystalGeometry, crystalMaterial, crystalGlowSprite } from '../render/crystal.js';
import { mulberry32, clamp, rand, TAU, easeOutBack } from '../core/util.js';
import * as B from './buildings.js';
import { PAL } from '../render/vfx.js';

// seed index (world.js SEEDS) → what keeps it asleep
export const SEED_PUZZLES = {
  1: { kind: 'braziers', pts: [[-4.5, 2.5], [4.5, 2.5]] }, // light both fires
  2: { kind: 'buoy', r: 5 },                                 // hit the glass float drifting on the lake
  4: { kind: 'thorns', r: 2.8, n: 10 },                      // burn the thicket around it
  5: { kind: 'sky' },                                        // hangs in the air off Mora's hill: glide to it
  7: { kind: 'wheels', pts: [[-7, -3], [7, -3], [0, 7.5]] }, // three wind wheels turning at once
  12: { kind: 'ice' },                                       // melt the ice around it
};

// Chests that only a reaction opens. Opened chests are story flags `chest_<id>`.
export const CHESTS = [
  { id: 'frostwatch', x: 8, z: -106, ry: -2.2, lock: 'ice', xp: 45 },
  { id: 'riftroad', x: 57, z: -39, ry: 2.4, lock: 'thorns', xp: 45 },
];

// Borum's nudge when the player lingers by a sleeping seed without waking it
const LINGER = {
  braziers: '식은 화로 둘이 씨앗을 지키고 있구나. 씨앗이 온기를 기다리는 게로다.',
  ice: '얼음 속에 갇혔구나. 차갑게 잠든 것을 깨우는 법이야… 너도 알 테지?',
  wheels: '바람개비가 셋이로구나. 바람을 기다리는 모양이니라.',
  buoy: '저 유리 부표 안에 씨앗이 들었구나! 물결 따라 떠도니 잘 겨누거라.',
  thorns: '가시덤불이 씨앗을 칭칭 감쌌구나. 가시가 무엇에 약한지 생각해 보거라.',
  sky: '허공에 씨앗이 떠 있구나. 날개가 없으니… 높은 데서 뛰어내리는 수밖에.',
};
const LINGER_T = 20; // seconds nearby before Borum speaks
const HOLD_SPIN = 4;  // a puzzle wind wheel keeps turning this long after a gust

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

// ---------------------------------------------------------------- models
let budGeo = null;
function petalGeometry() {
  if (budGeo) return budGeo;
  // a cupped leaf standing on its base: green at the root, pale gold at the tip
  const g = new THREE.SphereGeometry(1, 8, 6, 0, TAU, 0, Math.PI);
  g.scale(0.16, 0.42, 0.07); g.translate(0, 0.4, 0.06);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), a = new THREE.Color(0x4f8f45), b = new THREE.Color(0xe8e0a0), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { c.copy(a).lerp(b, clamp(p.getY(i) / 0.8, 0, 1) ** 1.6); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return (budGeo = g);
}
// Closed bud of five petals around the seed; `open(k)` spreads them (0..1).
function makeBud() {
  const g = new THREE.Group(), petals = [];
  g.scale.setScalar(1.6);
  const mat = toon(0xffffff, { vertexColors: true, rim: 0.3, side: THREE.DoubleSide });
  for (let i = 0; i < 5; i++) {
    const piv = new THREE.Group(); piv.rotation.y = (i / 5) * TAU; g.add(piv);
    const m = new THREE.Mesh(petalGeometry(), mat); m.castShadow = true; piv.add(m);
    petals.push(m);
  }
  // a faint light inside so the bud reads from a distance
  const glow = crystalGlowSprite(0xb8ff70, 3, { intensity: 0.22 }); glow.position.y = 0.3; g.add(glow);
  const open = (k) => { for (const m of petals) m.rotation.x = -0.28 + k * 1.35; };
  open(0);
  return { g, open };
}

let thornGeo = null;
function thornGeometry() {
  if (thornGeo) return thornGeo;
  const rnd = mulberry32(41), parts = [];
  const dark = new THREE.Color(0x3b3526), olive = new THREE.Color(0x5d5a34), tip = new THREE.Color(0xb9a27a);
  const paint = (geo, fn) => {
    geo = geo.index ? geo.toNonIndexed() : geo; geo.deleteAttribute('uv');
    const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) { fn(c, p.getY(i)); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  };
  const cane = new THREE.Color(0x4a2e2a), caneTip = new THREE.Color(0x8a4a38);
  // a low tangled root mass
  for (let i = 0; i < 2; i++) {
    const s = new THREE.IcosahedronGeometry(0.4 + rnd() * 0.12, 1);
    s.scale(1.2, 0.6, 1.2); s.translate((rnd() - 0.5) * 0.5, 0.2 + i * 0.15, (rnd() - 0.5) * 0.5);
    parts.push(paint(s, (c, y) => c.copy(dark).lerp(olive, clamp(y, 0, 1) * 0.6)));
  }
  // bramble canes: rise, arch outward and droop, studded with pale thorns
  const up = new THREE.Vector3(0, 1, 0), tan = new THREE.Vector3(), side = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + (rnd() - 0.5) * 0.5, dx = Math.cos(a), dz = Math.sin(a);
    const h = 1.5 + rnd() * 0.9, reach = 0.8 + rnd() * 0.6, ox = (rnd() - 0.5) * 0.4, oz = (rnd() - 0.5) * 0.4;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(ox, 0, oz),
      new THREE.Vector3(ox + dx * reach * 0.15, h * 0.55, oz + dz * reach * 0.15),
      new THREE.Vector3(ox + dx * reach * 0.6, h, oz + dz * reach * 0.6),
      new THREE.Vector3(ox + dx * reach, h - 0.55 - rnd() * 0.4, oz + dz * reach),
    ]);
    const tube = new THREE.TubeGeometry(curve, 10, 0.045, 4, false);
    parts.push(paint(tube, (c, y) => c.copy(cane).lerp(caneTip, clamp(y / h, 0, 1))));
    for (let t = 0.2; t < 0.97; t += 0.1 + rnd() * 0.05) {
      const p = curve.getPoint(t); curve.getTangent(t, tan);
      side.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(tan).normalize();
      const th = new THREE.ConeGeometry(0.028, 0.16, 3); th.translate(0, 0.08, 0);
      q.setFromUnitVectors(up, side); th.applyQuaternion(q); th.translate(p.x, p.y, p.z);
      parts.push(paint(th, (c) => c.copy(tip)));
    }
    // a few dry leaves hang on
    if (rnd() < 0.6) {
      const p = curve.getPoint(0.45 + rnd() * 0.3);
      const lf = new THREE.TetrahedronGeometry(0.13); lf.scale(1, 0.35, 1.6); lf.rotateY(rnd() * TAU); lf.translate(p.x, p.y, p.z);
      parts.push(paint(lf, (c) => c.copy(olive).multiplyScalar(0.9 + rnd() * 0.3)));
    }
  }
  thornGeo = mergeParts(parts);
  thornGeo.computeVertexNormals();
  return thornGeo;
}
function mergeParts(parts) {
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array, o * 3); col.set(p.attributes.color.array, o * 3); o += p.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function chestModel() {
  const g = new THREE.Group();
  B.box(1.1, 0.58, 0.72, B.MAT.wood, 0, 0.29, 0, g);
  for (const x of [-0.42, 0.42]) B.box(0.08, 0.6, 0.76, B.MAT.iron, x, 0.3, 0, g);
  B.box(1.14, 0.06, 0.76, B.MAT.iron, 0, 0.03, 0, g);
  // lid hinged at the back edge
  const lid = new THREE.Group(); lid.position.set(0, 0.58, -0.36); g.add(lid);
  B.box(1.1, 0.24, 0.72, B.MAT.woodLight, 0, 0.12, 0.36, lid);
  for (const x of [-0.42, 0.42]) B.box(0.08, 0.26, 0.76, B.MAT.iron, x, 0.13, 0.36, lid);
  B.box(0.16, 0.2, 0.05, B.MAT.gold, 0, 0.02, 0.74, lid);
  const shine = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.3, 1), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  shine.position.set(0, 0.5, 0); g.add(shine);
  g.userData = { lid, shine };
  return g;
}

// a chunky ice prism standing on its base (y = 0), about 1.3 × sy tall
// clear enough to show what is trapped inside (same shader program as the spell ice)
let clearIce = null;
function iceBlock(sx, sy, sz, seed = 3) {
  clearIce ||= crystalMaterial({ ice: true, color: 0x8cc4ea, glow: 0x6fbfff, intensity: 0.2, transparent: true, opacity: 0.22, depthWrite: false, nocache: true });
  const m = new THREE.Mesh(crystalGeometry('prism', { sides: 7, radius: 1, height: 1, tip: 0.3, jitter: 0.3, seed }), clearIce);
  m.scale.set(sx, sy, sz); m.userData.base = m.scale.clone();
  m.renderOrder = 2;
  return m;
}

// ---------------------------------------------------------------- puzzles
export class Puzzles {
  constructor(world) {
    this.W = world;
    this.seedLocks = [];
    this.chests = [];
    this.thickets = [];
    this.lingerT = 0;
  }

  build() {
    for (const s of this.W.seeds) { const p = SEED_PUZZLES[s.i]; if (p) this.lockSeed(s, p); }
    for (const c of CHESTS) this.buildChest(c);
  }

  // Is something hot touching this spot? (wildfire, a burning field)
  heatAt(pos, r) {
    const F = this.W.fire;
    if (F && F.count()) {
      if (F.isBurning(pos.x, pos.z)) return true;
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; if (F.isBurning(pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r)) return true; }
    }
    const fl = G.spells && G.spells.fields ? G.spells.fields.list : [];
    for (const f of fl) if (!f.ended && (f.kind === 'blaze' || f.kind === 'plasma') && Math.hypot(f.pos.x - pos.x, f.pos.z - pos.z) < f.r + r && Math.abs(f.pos.y - pos.y) < 3) return true;
    return false;
  }

  // ------------------------------------------------ seeds
  lockSeed(s, p) {
    const L = { s, kind: p.kind, p, solved: false, t: 0, linger: 0 };
    s.locked = true; s.lock = L;
    const W = this.W, sprout = s.g.children[0];
    switch (p.kind) {
      case 'braziers': {
        L.bud = makeBud(); L.bud.g.position.y = 0.35; s.g.add(L.bud.g);
        s.orb.visible = false;
        L.parts = p.pts.map(([dx, dz]) => {
          const b = W.makeBrazier(s.x + dx, s.z + dz, 'sbrazier');
          b.onLit = () => { if (!L.solved && L.parts.every((q) => q.lit)) { L.parts.forEach((q) => (q.permanent = true)); this.wake(L); } };
          return b;
        });
        W.props.clear(s.x, s.z, 7);
        break;
      }
      case 'wheels': {
        L.bud = makeBud(); L.bud.g.position.y = 0.35; s.g.add(L.bud.g);
        s.orb.visible = false;
        L.parts = p.pts.map(([dx, dz]) => {
          const x = s.x + dx, z = s.z + dz;
          const w = W.makeWindWheel(x, z, W.faceTo(x, z, s.x, s.z) + Math.PI, 'swheel', { hold: HOLD_SPIN });
          w.onActive = () => {
            if (L.solved) return;
            if (L.parts.every((q) => q.active)) this.wake(L);
          };
          w.onStop = () => {
            // one wind wheel ran down while another was still turning: say so, once
            if (!L.solved && L.parts.some((q) => q.active)) G.story && G.story.cSay('하나씩 돌려서는 안 되겠구나. 셋이 한꺼번에 돌아야 하는 게야.', 'swheel_fail', 6);
          };
          return w;
        });
        W.props.clear(s.x, s.z, 10);
        break;
      }
      case 'ice': {
        L.melt = 0;
        L.block = iceBlock(0.62, 1.1, 0.62, 11); L.block.position.y = -0.05; s.g.add(L.block);
        L.target = W.addTarget({ id: 'sice', pos: new THREE.Vector3(s.x, s.y + 0.95, s.z), r: 1.1, baseHit: (el, src) => this.meltHit(L, el, src) });
        W.props.clear(s.x, s.z, 3);
        break;
      }
      case 'buoy': {
        sprout.visible = false;
        L.a = rand() * TAU; L.c = { x: s.x, z: s.z };
        const fl = new THREE.Group(); fl.userData.noBake = true; fl.scale.setScalar(1.25);
        const glass = new THREE.Mesh(crystalGeometry('gem', { sides: 10, seed: 5 }), crystalMaterial({ color: 0xd8ffe8, glow: 0xa8ffc8, intensity: 0.35, transparent: true, opacity: 0.45, depthWrite: false, nocache: true }));
        glass.scale.set(0.62, 0.55, 0.62); glass.position.y = 0.35; glass.renderOrder = 2; fl.add(glass);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.12, 6, 14), B.MAT.timberMoving); ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; fl.add(ring);
        for (let i = 0; i < 3; i++) { const net = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.018, 4, 18), B.MAT.iron); net.rotation.y = (i / 3) * Math.PI; net.position.y = 0.35; fl.add(net); }
        W.scene.add(fl);
        L.float = fl; L.glass = glass;
        s.g.position.y = -0.55; s.y = 0;
        L.target = W.addTarget({ id: 'sbuoy', pos: new THREE.Vector3(), r: 1, baseHit: () => this.breakBuoy(L) });
        this.moveBuoy(L, 0);
        break;
      }
      case 'thorns': {
        L.thicket = this.buildThicket(s.x, s.z, p.r, p.n, () => { if (!L.solved) this.wake(L); }, 7);
        break;
      }
      case 'sky': {
        // floats high off the ground (SEEDS dy): reachable only by gliding in
        sprout.visible = false; s.pickR = 2.4;
        s.locked = false; L.solved = true;
        break;
      }
    }
    this.seedLocks.push(L);
  }

  meltHit(L, el, src) {
    if (L.solved || el !== 'fire') return;
    const big = src && src.kind && src.kind !== 'bolt';
    this.addMelt(L, big ? 1 : 0.5);
  }
  addMelt(L, v) {
    const b = L.block, s = L.s;
    L.melt = Math.min(1, L.melt + v);
    b.scale.copy(b.userData.base).multiplyScalar(1 - L.melt * 0.35);
    tmp.set(s.x, s.y + 0.95, s.z);
    G.vfx.burst(tmp, 'steam', 8, { spread: 0.6 });
    G.audio.play('sizzle', { pos: tmp, gap: 0.15 });
    if (L.melt >= 1) {
      b.visible = false; this.W.targets.splice(this.W.targets.indexOf(L.target), 1);
      G.vfx.burst(tmp, 'ice', 16, { speed: 4 });
      if (G.vfx.chunks) G.vfx.chunks(tmp, 'ice', 6, { speed: 4 });
      G.audio.play('freeze', { pos: tmp, v: 0.6 });
      this.wake(L);
    }
  }

  moveBuoy(L, dt) {
    L.a += dt * 0.11;
    const s = L.s, x = L.c.x + Math.cos(L.a) * L.p.r, z = L.c.z + Math.sin(L.a) * L.p.r;
    const bob = Math.sin(G.time * 1.7 + L.a) * 0.08;
    if (!L.solved) {
      L.float.position.set(x, 0.02 + bob, z); L.float.rotation.y = L.a; L.float.rotation.z = Math.sin(G.time * 1.3) * 0.06;
      L.target.pos.set(x, 0.4, z);
      s.x = x; s.z = z;
    }
    s.g.position.set(s.x, -0.55 + bob, s.z);
  }
  breakBuoy(L) {
    if (L.solved) return;
    const p = L.float.position.clone().setY(0.4);
    this.W.scene.remove(L.float);
    this.W.targets.splice(this.W.targets.indexOf(L.target), 1);
    G.vfx.burst(p, 'water', 16, { speed: 3 });
    if (G.vfx.chunks) G.vfx.chunks(p, 'ice', 5, { speed: 3 });
    G.audio.play('crate_break', { pos: p, v: 0.5 });
    this.wake(L);
  }

  // The seed wakes: bud opens / ice gone, the crystal rises with a little arpeggio.
  wake(L) {
    const s = L.s;
    L.solved = true; L.t = 0;
    s.locked = false;
    s.orb.visible = true;
    // the wheels keep turning once the seed is awake
    if (L.kind === 'wheels') for (const w of L.parts) { w.hold = 0; w.active = true; }
    tmp.set(s.x, s.g.position.y + 0.9, s.z);
    G.audio.play('seed_wake', { pos: tmp });
    G.vfx.burst(tmp, 'soul', 24, { el: 'heal' });
    G.vfx.ring(tmp2.set(s.x, s.g.position.y + 0.05, s.z), PAL.heal.core, 2.2, 0.5, { thick: 0.12 });
  }

  // ------------------------------------------------ thorn thickets
  // A ring of thorn bushes that fire burns away (a bolt, a field, wildfire). Burning bushes
  // light their neighbours and the grass under them; a burnt thicket regrows in a few
  // minutes while the player is away.
  buildThicket(cx, cz, r, n, onClear, seed = 1) {
    const W = this.W, rnd = mulberry32(seed);
    const T = { bushes: [], onClear, cleared: false, regrow: 0, x: cx, z: cz, r };
    W.props.clear(cx, cz, r + 5); // a small clearing so the thicket reads from a distance
    const mat = toon(0xffffff, { vertexColors: true, rim: 0.2 });
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (rnd() - 0.5) * 0.15;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, y = W.h(x, z);
      const m = new THREE.Mesh(thornGeometry(), mat);
      const sc = 0.95 + rnd() * 0.3;
      m.scale.set(sc, sc * (0.95 + rnd() * 0.25), sc); m.rotation.y = rnd() * TAU;
      m.position.set(x, y - 0.1, z); m.castShadow = true; m.receiveShadow = true;
      m.userData.noBake = true;
      W.scene.add(m);
      const bush = { m, x, z, y, sc: m.scale.clone(), alive: true, burn: 0, col: null, T };
      bush.col = W.col.addCircle(x, z, 0.95 * sc, -10, y + 2.3 * sc);
      bush.col.climb = false; bush.col.noTop = true;
      bush.target = W.addTarget({ id: 'thorn', pos: new THREE.Vector3(x, y + 1.1, z), r: 1, baseHit: (el) => { if (el === 'fire') this.ignite(bush); } });
      T.bushes.push(bush);
    }
    this.thickets.push(T);
    return T;
  }
  ignite(b) {
    if (!b.alive || b.burn > 0) return;
    b.burn = 1.8;
    b.m.material = this.charMat || (this.charMat = toon(0x2e2622, { rim: 0.1 }));
    tmp.set(b.x, b.y + 1, b.z);
    G.audio.play('fire_catch', { pos: tmp, gap: 0.15 });
    G.vfx.burst(tmp, 'fire', 14, { spread: 0.7, speed: 2 });
    if (this.W.fire) this.W.fire.ignite(b.x, b.z, 1.2, 0.45);
  }
  updateThicket(T, dt, playerPos) {
    const q = G.settings.quality === 'low' ? 0.5 : 1;
    for (const b of T.bushes) {
      if (!b.alive) continue;
      if (b.burn <= 0) {
        // wildfire or a burning field under the bush sets it alight
        if ((this.W.fire.count() || (G.spells && G.spells.fields.list.length)) && this.heatAt(tmp.set(b.x, b.y, b.z), 0.8)) this.ignite(b);
        continue;
      }
      const was = b.burn;
      b.burn -= dt;
      tmp.set(b.x, b.y + 0.8 + rand() * 0.8, b.z);
      if (rand() < dt * 40 * q) G.vfx.burst(tmp, 'fire', 1, { spread: 0.6, speed: 1.4, size: 1.2 });
      if (rand() < dt * 8 * q) G.vfx.burst(tmp, 'ember', 1, { speed: 2.5 });
      // catch the neighbours partway through
      if (was > 1.2 && b.burn <= 1.2) for (const o of T.bushes) if (o !== b && o.alive && o.burn <= 0 && Math.hypot(o.x - b.x, o.z - b.z) < 2.6) this.ignite(o);
      const k = clamp(b.burn / 1.8, 0, 1);
      b.m.scale.copy(b.sc).multiplyScalar(0.35 + 0.65 * k);
      if (b.burn <= 0) {
        b.alive = false; b.m.visible = false;
        this.W.col.remove(b.col); b.target.r = -99;
        G.vfx.burst(tmp.set(b.x, b.y + 0.6, b.z), 'ash', 10, { spread: 0.8 });
        G.vfx.burst(tmp, 'smoke', 4, { spread: 0.5 });
      }
    }
    if (!T.cleared && T.bushes.some((b) => !b.alive)) {
      // one gap is enough to walk in
      T.cleared = true; T.regrow = 200;
      if (T.onClear) T.onClear();
    }
    if (T.cleared && !T.keepCleared) {
      T.regrow -= dt;
      if (T.regrow <= 0 && Math.hypot(playerPos.x - T.x, playerPos.z - T.z) > 45) this.regrowThicket(T);
    }
  }
  regrowThicket(T) {
    T.cleared = false;
    for (const b of T.bushes) {
      if (b.alive && b.burn <= 0) continue;
      b.alive = true; b.burn = 0; b.m.visible = true; b.m.scale.copy(b.sc); b.m.material = toon(0xffffff, { vertexColors: true, rim: 0.2 });
      b.col = this.W.col.addCircle(b.x, b.z, 0.95 * b.sc.x, -10, b.y + 2.3 * b.sc.y); b.col.climb = false; b.col.noTop = true;
      b.target.r = 1;
    }
  }

  // ------------------------------------------------ chests
  buildChest(c) {
    const W = this.W;
    const g = chestModel(); g.userData.noBake = true;
    W.place(g, c.x, c.z, c.ry);
    W.props.clear(c.x, c.z, c.lock === 'thorns' ? 5 : 3);
    const C = { ...c, g, opened: false, t: -1, y: W.h(c.x, c.z) };
    C.col = W.col.addBox(c.x, c.z, 0.58, 0.4, c.ry, -10, C.y + 0.85);
    if (c.lock === 'ice') {
      C.melt = 0;
      C.block = iceBlock(0.92, 0.95, 0.78, 21); C.block.position.set(c.x, C.y - 0.05, c.z); C.block.rotation.y = c.ry; W.scene.add(C.block);
      C.target = W.addTarget({ id: 'cice', pos: new THREE.Vector3(c.x, C.y + 0.6, c.z), r: 1.2, baseHit: (el, src) => { if (el === 'fire' && !C.opened) this.meltChest(C, src && src.kind && src.kind !== 'bolt' ? 1 : 0.5); } });
    } else if (c.lock === 'thorns') {
      C.thicket = this.buildThicket(c.x, c.z, 2.6, 9, null, 13);
    }
    // the lid opens with E once nothing holds it
    C.inter = W.addInteract({
      id: 'chest', pos: new THREE.Vector3(c.x, C.y + 0.6, c.z), r: 2.2, label: '상자 열기',
      enabled: () => !C.opened && this.chestFree(C),
      action: () => this.openChest(C),
    });
    this.chests.push(C);
  }
  chestFree(C) {
    if (C.lock === 'ice') return C.melt >= 1;
    if (C.lock === 'thorns') return C.thicket.cleared;
    return true;
  }
  meltChest(C, v) {
    if (C.melt >= 1) return;
    C.melt = Math.min(1, C.melt + v);
    const b = C.block;
    b.scale.copy(b.userData.base).multiplyScalar(1 - C.melt * 0.3);
    tmp.set(C.x, C.y + 0.6, C.z);
    G.vfx.burst(tmp, 'steam', 10, { spread: 0.8 });
    G.audio.play('sizzle', { pos: tmp, gap: 0.15 });
    if (C.melt >= 1) {
      b.visible = false; C.target.r = -99;
      G.vfx.burst(tmp, 'ice', 18, { speed: 4 });
      if (G.vfx.chunks) G.vfx.chunks(tmp, 'ice', 7, { speed: 4 });
      G.audio.play('freeze', { pos: tmp, v: 0.6 });
    }
  }
  openChest(C, silent = false) {
    if (C.opened) return;
    C.opened = true; C.t = silent ? 1 : 0;
    if (C.block) C.block.visible = false;
    if (C.target) C.target.r = -99;
    if (C.thicket) C.thicket.keepCleared = true;
    if (silent) { C.g.userData.lid.rotation.x = -1.9; return; }
    // XP goes in with the flag so a save can't keep the chest open without it
    G.player.addXP(C.xp);
    G.story && G.story.set('chest_' + C.id);
    const p = new THREE.Vector3(C.x, C.y + 0.8, C.z);
    G.audio.play('chest_open', { pos: p });
    G.vfx.burst(p, 'soul', 20, { el: 'fire' });
    G.vfx.flash && G.vfx.flash(p, 0xffd27a, 20, 6, 0.5);
    const E = G.enemies;
    G.later(() => {
      for (let i = 0; i < 4; i++) E.pickups.push(E.makePickup(p, 'mana', { v: 6, i, n: 4 }));
      E.pickups.push(E.makePickup(p, 'heal'));
      G.hud.toast(`상자를 열었다 — 경험치 <b>+${C.xp}</b>`);
    }, 450);
  }

  // ------------------------------------------------ update
  update(dt, playerPos) {
    const S = G.story;
    for (const L of this.seedLocks) {
      const s = L.s;
      if (L.kind === 'buoy' && !s.taken) this.moveBuoy(L, dt);
      if (L.bud && L.solved && L.t < 1) { L.t = Math.min(1, L.t + dt * 1.4); L.bud.open(easeOutBack(L.t)); }
      if (L.solved && L.grow !== 1 && s.orb.visible) { L.grow = Math.min(1, (L.grow || 0) + dt * 1.8); s.orb.scale.setScalar(0.2 * easeOutBack(L.grow)); }
      if (L.kind === 'ice' && !L.solved && this.heatAt(tmp.set(s.x, s.y + 0.3, s.z), 1)) this.addMelt(L, dt * 0.35);
      if (L.kind === 'thorns' && !s.taken) this.updateThicket(L.thicket, dt, playerPos);
      // Borum speaks up when the player lingers without solving
      if (!s.taken && S && G.mode === 'free') {
        const d = Math.hypot(playerPos.x - s.x, playerPos.z - s.z);
        const near = L.kind === 'sky' ? d < 26 && playerPos.y > s.y - 4 : L.kind === 'buoy' ? d < 22 : d < 10;
        if (!L.solved || L.kind === 'sky') {
          L.linger = near ? L.linger + dt : Math.max(0, L.linger - dt * 0.5);
          if (L.linger > LINGER_T) S.cSay(LINGER[L.kind], 'slock_' + L.kind, 7);
        }
      }
    }
    for (const C of this.chests) {
      if (!C.opened && S && S.flag('chest_' + C.id)) this.openChest(C, true);
      if (C.lock === 'ice' && !C.opened && C.melt < 1 && this.heatAt(tmp.set(C.x, C.y + 0.2, C.z), 1.2)) this.meltChest(C, dt * 0.35);
      if (C.thicket && !C.opened) this.updateThicket(C.thicket, dt, playerPos);
      if (C.t >= 0 && C.t < 1) {
        C.t = Math.min(1, C.t + dt * 1.6);
        const k = easeOutBack(C.t);
        C.g.userData.lid.rotation.x = -1.9 * k;
        C.g.userData.shine.material.opacity = Math.sin(C.t * Math.PI) * 0.9;
      }
    }
  }
}
