// Loose world objects with simple physics: powder barrels that blow up,
// boulders that roll downhill and flatten what they hit, crates that break
// or burn. They react to every element through world targets (spells call
// target.baseHit(el, src)), to wildfire under them, to the player walking
// into them and to each other. One InstancedMesh per kind.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from '../core/context.js';
import { toon } from '../render/materials.js';
import { mulberry32, clamp, smoothstep } from '../core/util.js';
import { CAMPS } from '../game/enemies.js';
import { POI } from './layout.js';

const GRAV = 26;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), m4 = new THREE.Matrix4(), sc = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

// per-kind physics: radius, height, mass, ground friction (1/s), whether it rolls on slopes
const KIND = {
  barrel: { r: 0.42, h: 1.0, mass: 1, fric: 3.5, roll: false, max: 48 },
  crate: { r: 0.46, h: 0.9, mass: 1.2, fric: 5, roll: false, max: 48 },
  boulder: { r: 1.0, h: 2.0, mass: 4, fric: 0.35, roll: true, max: 40 },
};
// how hard each element shoves (m/s of impulse on mass 1)
const PUSH = { wind: 11, water: 8, arcane: 5, storm: 2.5, fire: 1.5, frost: 1 };

const hexC = (h) => new THREE.Color(h);
function paint(geo, fn) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { fn(c, p.getX(i), p.getY(i), p.getZ(i), n ? n.getY(i) : 0); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
const strip = (g) => { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); return g; };

// Powder barrel: bellied staves, iron hoops, red band with a pale ember sigil
function barrelGeo() {
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.36 + Math.sin(t * Math.PI) * 0.07, t * 1.0)); }
  const body = strip(new THREE.LatheGeometry(pts, 14));
  body.computeVertexNormals();
  paint(body, (c, x, y, z) => {
    const a = Math.atan2(z, x), stave = Math.abs(((a / (Math.PI * 2)) * 14) % 1 - 0.5) < 0.06;
    c.copy(hexC(0x8a5a36)).multiplyScalar(stave ? 0.72 : 0.95 + 0.08 * Math.sin(a * 7));
    if (y > 0.4 && y < 0.62) { c.copy(hexC(0xb3322a)); if (Math.abs(x) < 0.12 && z > 0 && Math.abs(y - 0.51) < 0.07 + (0.12 - Math.abs(x)) * 0.5) c.copy(hexC(0xf0d8a0)); }
  });
  const parts = [body];
  for (const y of [0.1, 0.9, 0.34, 0.68]) {
    const r = 0.36 + Math.sin(y * Math.PI) * 0.07 + 0.012;
    const hoop = strip(new THREE.CylinderGeometry(r, r, 0.055, 14, 1, true)); hoop.translate(0, y, 0);
    paint(hoop, (c) => c.copy(hexC(0x3a3a40)));
    parts.push(hoop);
  }
  const lid = strip(new THREE.CircleGeometry(0.36, 14)); lid.rotateX(-Math.PI / 2); lid.translate(0, 0.995, 0);
  paint(lid, (c, x, y, z) => c.copy(hexC(0x6e4a2e)).multiplyScalar(Math.abs(x) < 0.02 ? 0.6 : 1));
  const fuse = strip(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 5)); fuse.translate(0.12, 1.07, 0.05);
  paint(fuse, (c) => c.copy(hexC(0xd9c79a)));
  parts.push(lid, fuse);
  return mergeGeometries(parts);
}
// Crate: planked box with a darker frame and a diagonal brace
function crateGeo() {
  const s = 0.9, parts = [];
  const box = strip(new THREE.BoxGeometry(s * 0.94, s * 0.94, s * 0.94, 1, 3, 1)); box.translate(0, s / 2, 0);
  paint(box, (c, x, y) => c.copy(hexC(0xb58a5a)).multiplyScalar(0.9 + 0.1 * ((Math.floor(y * 3.4) % 2) ? 1 : 0.4)));
  parts.push(box);
  const bar = (w, h, d, x, y, z, rz = 0) => { const g = strip(new THREE.BoxGeometry(w, h, d)); g.rotateZ(rz); g.translate(x, y, z); paint(g, (c) => c.copy(hexC(0x6f4d2f))); parts.push(g); };
  const e = s / 2, t = 0.08;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar(t, s, t, sx * (e - t / 2), e, sz * (e - t / 2));
  for (const sy of [0, 1]) for (const sz of [-1, 1]) bar(s, t, t, 0, sy * (s - t) + t / 2, sz * (e - t / 2));
  for (const sy of [0, 1]) for (const sx of [-1, 1]) bar(t, t, s, sx * (e - t / 2), sy * (s - t) + t / 2, 0);
  for (const sz of [-1, 1]) bar(s * 1.2, t * 0.8, 0.02, 0, e, sz * (e + 0.005), Math.PI / 4);
  return mergeGeometries(parts);
}
// Boulder: lumpy rounded stone, mossy on top, darker underside
function boulderGeo() {
  const rnd = mulberry32(9);
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    tmp.fromBufferAttribute(p, i);
    const k = 1 + (Math.sin(tmp.x * 3.1 + 1) * Math.sin(tmp.y * 2.7) * Math.sin(tmp.z * 3.3 + 2)) * 0.12 + (rnd() - 0.5) * 0.05;
    tmp.multiplyScalar(k); p.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  const ng = strip(g); ng.computeVertexNormals();
  paint(ng, (c, x, y, z, ny) => {
    c.copy(hexC(0x8d867c)).lerp(hexC(0x5d5953), smoothstep(0.2, -0.8, y)).multiplyScalar(0.92 + 0.12 * Math.sin(x * 5 + z * 3));
    if (ny > 0.55) c.lerp(hexC(0x5f8a3c), smoothstep(0.55, 0.85, ny) * 0.8);
  });
  return ng;
}

export class WorldObjects {
  constructor(scene, world) {
    this.W = world;
    this.list = [];
    this.meshes = {};
    const mat = toon(0xffffff, { vertexColors: true, rim: 0.25 });
    const geos = { barrel: barrelGeo(), crate: crateGeo(), boulder: boulderGeo() };
    for (const k in KIND) {
      const im = new THREE.InstancedMesh(geos[k], mat, KIND[k].max);
      im.count = 0; im.castShadow = true; im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.userData.noBake = true; im.frustumCulled = false;
      scene.add(im);
      this.meshes[k] = im;
    }
    this.place();
    this.rollLoop = null;
    this.dirty = true;
  }

  // ---------------------------------------------------------------- placement
  place() {
    const W = this.W, rnd = mulberry32(2024);
    // spots are picked on the original map's grid (Terrain.legacy) so every camp keeps its layout
    const L = W.terrain.legacy();
    const flatAt = (x, z) => L.normal(x, z).y > 0.86 && L.height(x, z) > 0.8 && !W.col.pointHit(x, L.height(x, z) + 0.5, z, 0.9);
    const near = (x, z, r) => this.list.some((b) => Math.hypot(b.pos.x - x, b.pos.z - z) < r);
    // no powder anywhere near where people live: a stray spark there would burn the home region
    const settled = (x, z) => Math.hypot(x - POI.village.x, z - POI.village.z) < 110
      || Math.hypot(x - POI.towerYard.x, z - POI.towerYard.z) < 60 || Math.hypot(x - POI.spawn.x, z - POI.spawn.z) < 60;
    for (const c of CAMPS) {
      if (c.elite) continue;
      // a couple of powder barrels and a crate at every camp: the camp's own supplies can be its undoing.
      // Camps close to the village keep only crates.
      const safe = settled(c.x, c.z);
      let nb = safe ? 2 : 0, nc = safe ? -1 : 0;
      for (let t = 0; t < 40 && (nb < 2 || nc < 1); t++) {
        const a = rnd() * Math.PI * 2, r = 3 + rnd() * 6;
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        if (!flatAt(x, z) || near(x, z, 1.4)) continue;
        if (nb < 2) { if (settled(x, z)) continue; this.add('barrel', x, z); nb++; if (rnd() < 0.5 && nb < 2) { this.add('barrel', x + 0.9, z + 0.3); nb++; } }
        else { this.add('crate', x, z); nc++; }
      }
      // a boulder perched uphill, ready to be sent down onto the camp
      for (let t = 0; t < 60; t++) {
        const a = rnd() * Math.PI * 2, r = 12 + rnd() * 16;
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        const h = L.height(x, z), n = L.normal(x, z);
        if (h - L.height(c.x, c.z) < 3.5 || n.y < 0.72 || n.y > 0.96 || near(x, z, 3)) continue;
        if (W.col.pointHit(x, h + 1, z, 1.4) || L.pathAt(x, z) > 0.3) continue;
        this.add('boulder', x, z, 0.85 + rnd() * 0.4);
        break;
      }
    }
    // crates by the village stalls and the tower yard (break them for a little mana)
    for (const [x, z] of [[12, 12], [-1, 29], [-10, 139], [24, 36]]) if (flatAt(x, z)) this.add('crate', x, z);
    // free boulders on open hillsides
    for (let t = 0, n = 0; t < 400 && n < 10; t++) {
      const x = (rnd() - 0.5) * 400, z = (rnd() - 0.5) * 400;
      if (Math.hypot(x, z) > 200 || Math.hypot(x - POI.village.x, z - POI.village.z) < 60) continue;
      const nn = L.normal(x, z);
      if (nn.y < 0.75 || nn.y > 0.92 || L.height(x, z) < 6 || near(x, z, 20) || W.col.pointHit(x, L.height(x, z) + 1, z, 1.4)) continue;
      this.add('boulder', x, z, 0.9 + rnd() * 0.5); n++;
    }
  }

  add(kind, x, z, s = 1) {
    const K = KIND[kind];
    if (this.list.filter((b) => b.kind === kind).length >= K.max) return null;
    const y = this.W.ground(x, z, 1e9);
    const b = {
      kind, s, r: K.r * s, h: K.h * s, mass: K.mass * s * s * s,
      pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), home: new THREE.Vector3(x, y, z),
      rot: new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * 6.28), yaw: 0,
      asleep: true, alive: true, hp: kind === 'crate' ? 3 : 1, fuse: 0, burn: 0, respawn: 0, stillT: 0, wetT: 0,
    };
    b.target = this.W.addTarget({ id: 'prop', ground: true, kind, pos: new THREE.Vector3(x, y + b.h * 0.5, z), r: b.r + 0.2, baseHit: (el, src) => this.hit(b, el, src) });
    this.list.push(b);
    return b;
  }

  // ---------------------------------------------------------------- reactions
  hit(b, el, src, o = {}) {
    if (!b.alive) return;
    // direction: projectile travel, else away from the player
    let dx, dz;
    if (src && src.vel) { dx = src.vel.x; dz = src.vel.z; }
    else if (o.from) { dx = b.pos.x - o.from.x; dz = b.pos.z - o.from.z; }
    else { dx = b.pos.x - G.player.pos.x; dz = b.pos.z - G.player.pos.z; }
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const push = (PUSH[el] ?? 2) * (o.power ?? 1) / Math.sqrt(b.mass);
    this.wake(b);
    b.vel.x += dx * push; b.vel.z += dz * push;
    if (el === 'wind' || o.power > 1.4) b.vel.y += push * (b.kind === 'boulder' ? 0.15 : 0.35);
    if (b.kind === 'barrel') {
      if ((el === 'fire' || el === 'storm') && b.wetT <= 0) {
        // a neighbouring blast shortens a fuse that is already burning: the explosion's own area
        // hit reaches this barrel first with the normal fuse, the chain hit follows right after
        const fuse = o.chain ? 0.28 : 1.1;
        if (b.fuse <= 0) this.light(b, fuse);
        else if (fuse < b.fuse) b.fuse = fuse;
      } else if (el === 'water' && b.fuse > 0) { b.fuse = 0; b.wetT = 12; G.vfx.burst(this.center(b), 'smoke', 6, { size: 1, alpha: 0.35, color: new THREE.Color(0.9, 0.92, 0.95) }); G.audio.play('fizzle', { pos: b.pos }); }
      else if (el === 'water') b.wetT = 12;
    } else if (b.kind === 'crate') {
      if (el === 'fire' && b.burn <= 0) b.burn = 3.2;
      else if (el !== 'fire') { b.hp -= el === 'wind' || el === 'arcane' || el === 'storm' ? 1.5 : 1; if (b.hp <= 0) this.breakCrate(b); }
    }
  }
  light(b, fuse) {
    b.fuse = fuse;
    G.audio.play('fuse_hiss', { pos: b.pos });
    if (G.story && G.story.once('barrel1')) G.hud.hint('<b>화약 통</b> — 불이나 번개에 닿으면 잠시 뒤 터진다. 적 사이로 굴려 보내거나, 물로 적셔 불씨를 끌 수 있다', 7);
  }
  explode(b) {
    b.alive = false; b.fuse = 0; b.respawn = 300;
    const c = this.center(b);
    const P = G.player;
    G.spells.explode(c, 5.2, P.power() * 3.4, 'fire', { knock: 15, lift: 7, shake: 0.7, big: true });
    G.vfx.chunks && G.vfx.chunks(c, 'wood', 10, { speed: 9 });
    if (this.W.fire) this.W.fire.ignite(c.x, c.z, 2.6, 0.8);
    // shove the player and other loose things
    const d = P.center().distanceTo(c);
    if (d < 4.5) P.damage(Math.round(8 * (1 - d / 6)), { dir: tmp.subVectors(P.pos, c).setY(0).normalize().clone(), knock: 12 });
    for (const o of this.list) {
      if (o === b || !o.alive) continue;
      const od = this.center(o).distanceTo(c);
      if (od < 6.5) this.hit(o, 'fire', null, { from: c, power: 2.2 * (1 - od / 8), chain: true });
    }
    this.hide(b);
  }
  breakCrate(b, burnt = false) {
    b.alive = false; b.respawn = 240;
    const c = this.center(b);
    G.vfx.chunks && G.vfx.chunks(c, 'wood', 8, { speed: 5 });
    G.audio.play('crate_break', { pos: c });
    if (!burnt) {
      const E = G.enemies;
      if (Math.random() < 0.7) for (let i = 0; i < 3; i++) E.pickups.push(E.makePickup(c, 'mana', { v: 5, i, n: 3 }));
      if (Math.random() < 0.3) E.pickups.push(E.makePickup(c, 'heal'));
    }
    this.hide(b);
  }
  hide(b) { b.target.r = -99; this.dirty = true; }
  wake(b) { b.asleep = false; b.stillT = 0; }
  center(b) { return tmp2.set(b.pos.x, b.pos.y + b.h * 0.5, b.pos.z).clone(); }
  // spells that land near objects without a direct target hit (area magic)
  onSpell(el, pos, r) {
    for (const b of this.list) {
      if (!b.alive) continue;
      const d = this.center(b).distanceTo(pos);
      if (d < r + b.r) this.hit(b, el, null, { from: pos, power: 1 + 0.5 * (1 - d / (r + b.r)) });
    }
  }

  // ---------------------------------------------------------------- simulation
  update(dt, playerPos) {
    const W = this.W, P = G.player;
    if (!dt) return;
    let fastest = null;
    for (const b of this.list) {
      if (!b.alive) {
        b.respawn -= dt;
        if (b.respawn <= 0 && playerPos.distanceTo(b.home) > 45) this.reset(b);
        continue;
      }
      // fuse / burning
      if (b.fuse > 0) {
        b.fuse -= dt;
        if (Math.random() < dt * 30) G.vfx.burst(tmp.set(b.pos.x + 0.12, b.pos.y + b.h + 0.1, b.pos.z + 0.05), 'spark', 1, { el: 'fire', speed: 2 });
        if (b.fuse <= 0) { this.explode(b); continue; }
      }
      if (b.burn > 0) {
        b.burn -= dt;
        if (Math.random() < dt * 20) G.vfx.burst(this.center(b), 'fire', 1, { spread: 0.35, speed: 0.8, size: 1.2 });
        if (b.burn <= 0) { this.breakCrate(b, true); continue; }
      }
      b.wetT = Math.max(0, b.wetT - dt * (W.weather && W.weather.rain > 0.3 ? 0 : 1));
      if (W.weather && W.weather.rain > 0.5 && b.kind === 'barrel') b.wetT = Math.max(b.wetT, 2);
      // wildfire underfoot
      if (W.fire && b.kind !== 'boulder' && W.fire.isBurning(b.pos.x, b.pos.z)) {
        if (b.kind === 'barrel' && b.fuse <= 0 && b.wetT <= 0) this.light(b, 1.1);
        if (b.kind === 'crate' && b.burn <= 0) b.burn = 3;
      }
      // the player leaning into it
      const px = b.pos.x - P.pos.x, pz = b.pos.z - P.pos.z, pd = Math.hypot(px, pz);
      const minD = b.r + 0.42;
      if (pd < minD && P.pos.y < b.pos.y + b.h - 0.2 && P.pos.y + 1.7 > b.pos.y && !P.climbing) {
        const nx = px / (pd || 1), nz = pz / (pd || 1);
        // separate
        P.pos.x = b.pos.x - nx * minD; P.pos.z = b.pos.z - nz * minD;
        const into = P.vel.x * nx + P.vel.z * nz;
        if (into > 0.5) {
          this.wake(b);
          const k = b.kind === 'boulder' ? 0.9 : 3;
          b.vel.x += nx * into * k * dt; b.vel.z += nz * into * k * dt;
          if (b.kind === 'boulder' && G.story && G.story.once('boulderPush')) G.hud.toast('바위를 밀고 있다 — 바람이나 물로 세게 밀어낼 수도 있다');
        }
      }
      if (b.asleep) continue;
      this.step(b, dt);
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (b.kind === 'boulder' && sp > 2 && (!fastest || sp > fastest.sp)) fastest = { b, sp };
    }
    // body vs body (few dozen, near the player only)
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i]; if (!a.alive || a.asleep) continue;
      for (let j = 0; j < this.list.length; j++) {
        const c = this.list[j]; if (i === j || !c.alive) continue;
        const dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z, d = Math.hypot(dx, dz), m = a.r + c.r;
        if (d >= m || d < 1e-4 || Math.abs(a.pos.y - c.pos.y) > Math.max(a.h, c.h)) continue;
        const nx = dx / d, nz = dz / d, rel = (a.vel.x - c.vel.x) * nx + (a.vel.z - c.vel.z) * nz;
        const push = (m - d) * 0.5;
        a.pos.x -= nx * push; a.pos.z -= nz * push; c.pos.x += nx * push; c.pos.z += nz * push;
        if (rel > 0) {
          const imp = rel * 1.2 / (1 / a.mass + 1 / c.mass);
          a.vel.x -= nx * imp / a.mass; a.vel.z -= nz * imp / a.mass;
          c.vel.x += nx * imp / c.mass; c.vel.z += nz * imp / c.mass;
          this.wake(c);
          if (rel > 3) G.audio.play(a.kind === 'boulder' || c.kind === 'boulder' ? 'boulder_thud' : 'crate_knock', { pos: a.pos, gap: 0.1 });
        }
      }
    }
    // rumble for the fastest rolling boulder
    if (fastest && !this.rollLoop && G.audio.ready) this.rollLoop = G.audio.loop('loop_roll', { pos: fastest.b.pos, v: 0.9, max: 60 });
    if (this.rollLoop) {
      if (!fastest) { this.rollLoop.stop(0.6); this.rollLoop = null; }
      else { this.rollLoop.set(fastest.b.pos); this.rollLoop.vol(clamp(fastest.sp / 10, 0.2, 1.1)); }
    }
    this.writeInstances();
  }

  step(b, dt) {
    const W = this.W, K = KIND[b.kind];
    b.vel.y -= GRAV * dt;
    const g0 = W.ground(b.pos.x, b.pos.z, b.pos.y + 0.5);
    const onGround = b.pos.y <= g0 + 0.05;
    if (onGround) {
      const n = W.terrain.normal(b.pos.x, b.pos.z, tmp);
      if (K.roll) { b.vel.x += n.x * GRAV * 0.71 * dt; b.vel.z += n.z * GRAV * 0.71 * dt; }
      else if (n.y < 0.8) { b.vel.x += n.x * GRAV * 0.5 * dt; b.vel.z += n.z * GRAV * 0.5 * dt; }
      const f = Math.exp(-K.fric * dt);
      b.vel.x *= f; b.vel.z *= f;
    }
    const ox = b.pos.x, oz = b.pos.z;
    b.pos.addScaledVector(b.vel, dt);
    // static colliders
    const bx = b.pos.x, bz = b.pos.z;
    if (W.col.resolve(b.pos, b.r, b.h)) {
      const nx = b.pos.x - bx, nz = b.pos.z - bz, nl = Math.hypot(nx, nz);
      if (nl > 1e-4) {
        const ux = nx / nl, uz = nz / nl, vn = b.vel.x * ux + b.vel.z * uz;
        if (vn < 0) { b.vel.x -= ux * vn * 1.4; b.vel.z -= uz * vn * 1.4; if (-vn > 3) G.audio.play(b.kind === 'boulder' ? 'boulder_thud' : 'crate_knock', { pos: b.pos, gap: 0.12 }); }
      }
    }
    // ground contact
    const g = W.ground(b.pos.x, b.pos.z, b.pos.y + 0.5);
    if (b.pos.y < g) {
      b.pos.y = g;
      if (b.vel.y < -4) { b.vel.y *= -0.25; if (b.kind === 'boulder') { G.audio.play('boulder_thud', { pos: b.pos, gap: 0.12 }); G.vfx.burst(b.pos, 'dust', 6, { speed: 3, size: 0.8 }); G.cameraRig.shake(clamp(0.25 - b.pos.distanceTo(G.player.pos) / 120, 0, 0.2)); } }
      else b.vel.y = 0;
    }
    // water: wood floats, stone sinks and is lost
    const wl = W.water.level;
    if (b.pos.y < wl - b.h * 0.3) {
      if (b.kind === 'boulder') { b.vel.multiplyScalar(Math.exp(-3 * dt)); if (b.pos.y < wl - 2.5) { b.alive = false; b.respawn = 60; this.hide(b); } }
      else { b.vel.y += (wl - b.h * 0.3 - b.pos.y) * 30 * dt; b.vel.multiplyScalar(Math.exp(-1.5 * dt)); if (b.kind === 'barrel') b.wetT = 20; }
    }
    // rolling: spin the stone around the axis perpendicular to travel
    const mx = b.pos.x - ox, mz = b.pos.z - oz, dist = Math.hypot(mx, mz);
    if (K.roll && dist > 1e-4) { tmp.set(mz, 0, -mx).normalize(); q1.setFromAxisAngle(tmp, dist / b.r); b.rot.premultiply(q1); }
    // crush enemies in the way
    const sp = Math.hypot(b.vel.x, b.vel.z);
    if (sp > 3.5) {
      for (const e of G.enemies.list) {
        if (!e.alive || !e.hittable || (e.hitBy && e.hitBy === b && G.time - e.hitByT < 0.6)) continue;
        const d = Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z);
        if (d < b.r + e.radius && Math.abs(e.pos.y - b.pos.y) < b.h + 0.5) {
          e.hitBy = b; e.hitByT = G.time;
          const dmg = (b.kind === 'boulder' ? (sp - 2) * 7 : (sp - 2) * 2.5) + G.player.power() * 0.5;
          G.combat.hit(e, { dmg, el: 'arcane', pos: e.center(), dir: new THREE.Vector3(b.vel.x / sp, 0.3, b.vel.z / sp), knock: sp * 1.4, lift: 4, heavy: sp > 7, source: 'player', noReact: true, hitstop: 0.06 });
          b.vel.multiplyScalar(b.kind === 'boulder' ? 0.85 : 0.5);
        }
      }
      const P = G.player;
      if (b.kind === 'boulder' && sp > 5 && Math.hypot(P.pos.x - b.pos.x, P.pos.z - b.pos.z) < b.r + 0.45 && Math.abs(P.pos.y - b.pos.y) < b.h && G.time - (b.hitPT || -9) > 1) {
        b.hitPT = G.time;
        P.damage(4, { dir: new THREE.Vector3(b.vel.x / sp, 0, b.vel.z / sp), knock: 10 });
      }
    }
    // settle
    if (sp < 0.25 && Math.abs(b.vel.y) < 0.5 && onGround) { b.stillT += dt; if (b.stillT > 1.2) { b.asleep = true; b.vel.set(0, 0, 0); } }
    else b.stillT = 0;
    // lost far from home (fell off the map / into a gorge)
    if (b.pos.distanceTo(b.home) > 140 || b.pos.y < -20) { b.alive = false; b.respawn = 30; this.hide(b); }
    b.target.pos.set(b.pos.x, b.pos.y + b.h * 0.5, b.pos.z);
    this.dirty = true;
  }

  reset(b) {
    b.alive = true; b.asleep = true; b.fuse = 0; b.burn = 0; b.wetT = 0; b.hp = b.kind === 'crate' ? 3 : 1;
    b.pos.copy(b.home); b.vel.set(0, 0, 0);
    b.target.r = b.r + 0.2; b.target.pos.set(b.pos.x, b.pos.y + b.h * 0.5, b.pos.z);
    this.dirty = true;
  }

  writeInstances() {
    if (!this.dirty) return;
    this.dirty = false;
    const n = { barrel: 0, crate: 0, boulder: 0 };
    for (const b of this.list) {
      if (!b.alive) continue;
      const im = this.meshes[b.kind];
      const i = n[b.kind]++;
      // boulder origin at its centre; barrels/crates stand on their base
      const cy = b.kind === 'boulder' ? b.pos.y + b.r * 0.85 : b.pos.y;
      // fuse: the barrel shivers and swells a little
      const swell = b.fuse > 0 ? 1 + Math.sin(G.time * 40) * 0.03 : 1;
      sc.set(b.s * swell, b.s * swell, b.s * swell);
      m4.compose(tmp.set(b.pos.x, cy, b.pos.z), b.rot, sc);
      im.setMatrixAt(i, m4);
    }
    for (const k in n) { this.meshes[k].count = n[k]; this.meshes[k].instanceMatrix.needsUpdate = true; }
  }
}
