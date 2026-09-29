// Composes the whole Hanui Vale: terrain, sky, water, grass, props,
// architecture, interactables, element targets and ambient life.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from '../core/context.js';
import { Terrain } from './terrain.js';
import { Sky } from './sky.js';
import { Water } from './water.js';
import { Grass } from './grass.js';
import { Props, makeTree } from './props.js';
import { Colliders } from './collision.js';
import { POI, PATHS, regionAt } from './layout.js';
import * as B from './buildings.js';
import { U } from '../render/materials.js';
import { crystalMaterial, crystalGeometry, crystalGlowSprite } from '../render/crystal.js';
import { rand, randRange, mulberry32, TAU } from '../core/util.js';

const tmp = new THREE.Vector3();

export const LANTERNS = [
  { id: 'tower', name: '모라의 언덕', x: -10, z: 127 },
  { id: 'village', name: '하늬 마을', x: 8, z: 31 },
  { id: 'lake', name: '거울 호수', x: -38, z: 38 },
  { id: 'meadow', name: '노을 들판', x: 70, z: 54 },
  { id: 'frostpass', name: '서리봉 오르막', x: -16, z: -96 },
  { id: 'frost', name: '서리봉 성소', x: -27, z: -148 },
  { id: 'stormroad', name: '서쪽 길', x: -98, z: -12 },
  { id: 'storm', name: '천둥 고원', x: -150, z: -30 },
  { id: 'riftroad', name: '잿빛 비탈', x: 74, z: -56 },
];

export const SEEDS = [
  [-45, 150], [26, 118], [-87, 67], [-112, 92], [-122, 140], [-66, 158], [62, 102], [112, 72],
  [150, -8], [42, -58], [-62, -62], [-8, -128], [-60, -150], [-142, -72], [-190, 22], [96, -152],
];

export const MEMORIES = {
  hairpin: { name: '은빛 머리핀', x: -47, z: 80, desc: '작은 은방울꽃이 새겨진 머리핀. 끝이 조금 휘어 있다.' },
  book: { name: '눌러 말린 꽃 책', x: 81.5, z: 66, desc: '들꽃이 곱게 눌린 낡은 책. 첫 장에 두 사람의 이름이 있었던 자국.' },
  musicbox: { name: '서리 오르골', x: -34, z: -163, desc: '태엽을 감으면 익숙한 노래가 흘러나오는 작은 오르골.', hidden: true },
  badge: { name: '기사의 휘장', x: -163, z: -30, desc: '번개 문양이 새겨진 청동 휘장. 뒷면에 누군가 긁어 쓴 글씨.', hidden: true },
};

export class World {
  constructor(scene, onProgress = () => {}) {
    this.scene = scene;
    this.col = new Colliders(16);
    this.interactables = [];
    this.targets = [];     // element targets
    this.anims = [];
    this.flames = [];      // {pos, lit, scale}
    this.chimneys = [];
    this.lanterns = {};
    this.seeds = [];
    this.memoryObjs = {};
    this.iceFloes = [];
    onProgress(0.1, '땅을 빚는 중…');
    this.terrain = new Terrain(1337);
    scene.add(this.terrain.mesh);
    onProgress(0.3, '하늘을 칠하는 중…');
    this.sky = new Sky(scene);
    this.water = new Water(scene, this.terrain);
    this.grass = new Grass(scene, this.terrain, this.water);
    onProgress(0.45, '숲을 가꾸는 중…');
    this.props = new Props(scene, this.terrain, this.col, G.settings.quality);
    onProgress(0.65, '마을을 짓는 중…');
    this.buildVillage();
    this.buildTowerHill();
    this.buildShrines();
    this.buildRift();
    this.buildLandmarks();
    this.buildLanterns();
    this.buildSeeds();
    this.buildMemories();
    this.ambT = 0;
    this.region = null;
    onProgress(0.72, '돌을 다듬는 중…');
    this.bakeStatics();
  }

  // Merge static building meshes per material into a few big meshes (draw-call reduction)
  bakeStatics() {
    const skip = new Set();
    const markSkip = (o) => { if (o && o.isObject3D) o.traverse((c) => skip.add(c)); };
    const roots = this.scene.children.filter((c) => c.isGroup && !c.userData.noBake);
    for (const r of roots) {
      for (const v of Object.values(r.userData || {})) {
        if (Array.isArray(v)) v.forEach(markSkip); else markSkip(v);
      }
    }
    for (const t of this.targets) markSkip(t.obj);
    const buckets = new Map();
    const CELL = 140;
    for (const r of roots) {
      r.updateMatrixWorld(true);
      r.traverse((m) => {
        if (!m.isMesh || skip.has(m) || m.isInstancedMesh || m.userData.isOutline) return;
        const mat = m.material;
        if (!mat || !(mat.isMeshToonMaterial || mat.userData.bake) || mat.transparent || (mat.userData.sway && mat.userData.sway.value > 0)) return;
        if (m.children.some((c) => !c.userData.isOutline)) return;
        const wp = m.getWorldPosition(new THREE.Vector3());
        const key = mat.uuid + '|' + Math.floor(wp.x / CELL) + ',' + Math.floor(wp.z / CELL) + '|' + (m.castShadow ? 1 : 0);
        if (!buckets.has(key)) buckets.set(key, { mat, cast: m.castShadow, list: [] });
        buckets.get(key).list.push(m);
      });
    }
    let merged = 0;
    for (const b of buckets.values()) {
      if (b.list.length < 2) continue;
      const geos = [];
      for (const m of b.list) {
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(k === 'color' && b.mat.vertexColors)) g.deleteAttribute(k);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (b.mat.vertexColors && !g.attributes.color) {
          const cc = new Float32Array(g.attributes.position.count * 4).fill(1);
          g.setAttribute('color', new THREE.BufferAttribute(cc, 4));
        } else if (g.attributes.color && g.attributes.color.itemSize === 3) {
          const src = g.attributes.color.array, cc = new Float32Array(g.attributes.position.count * 4);
          for (let i = 0; i < g.attributes.position.count; i++) { cc[i * 4] = src[i * 3]; cc[i * 4 + 1] = src[i * 3 + 1]; cc[i * 4 + 2] = src[i * 3 + 2]; cc[i * 4 + 3] = 0; }
          g.setAttribute('color', new THREE.BufferAttribute(cc, 4));
        }
        g.applyMatrix4(m.matrixWorld);
        geos.push(g);
      }
      const geo = mergeGeometries(geos, false);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, b.mat);
      mesh.castShadow = b.cast; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      for (const m of b.list) m.parent.remove(m);
      merged += b.list.length;
    }
    this.bakedCount = merged;
  }

  h(x, z) { return this.terrain.height(x, z); }
  ground(x, z, y = 1e9) {
    const t = this.terrain.height(x, z);
    const p = this.col.platformTop(x, z, y);
    const s = y < 1e8 ? this.col.surfaceTop(x, z, y) : -1e9;
    return Math.max(t, p, s);
  }
  // Solid building/landmark: box or circle collider whose top matches the mesh
  // (so it can be climbed and stood on). Pass `r` for a circle, `hw`/`hd` for a box.
  solid(obj, o) {
    const base = obj.position.y;
    const top = o.top ?? new THREE.Box3().setFromObject(obj).max.y;
    const c = o.r !== undefined
      ? this.col.addCircle(o.x ?? obj.position.x, o.z ?? obj.position.z, o.r, -10, top)
      : this.col.addBox(o.x ?? obj.position.x, o.z ?? obj.position.z, o.hw, o.hd, o.rot ?? obj.rotation.y, -10, top);
    if (o.topFn) c.topFn = o.topFn;
    if (o.climb === false) c.climb = false;
    if (o.noTop) c.noTop = true;
    c.base = base;
    return c;
  }
  place(obj, x, z, ry = 0, dy = 0) {
    obj.position.set(x, this.h(x, z) + dy, z);
    obj.rotation.y = ry;
    this.scene.add(obj);
    obj.updateMatrixWorld(true);
    return obj;
  }
  faceTo(px, pz, tx, tz) { return Math.atan2(tx - px, tz - pz); }

  addInteract(o) { this.interactables.push(o); return o; }
  addTarget(o) { this.targets.push(o); return o; }

  // ------------------------------------------------------------
  buildVillage() {
    const plaza = { x: 6, z: 14 };
    const rnd = mulberry32(88);
    const houses = [
      { id: 'bau', x: -19, z: 4, w: 7, d: 5.2, roof: B.MAT.roofTeal, wall: B.MAT.plasterWarm, porch: true },
      { id: 'bakery', x: 20, z: 2, w: 7, d: 6, roof: B.MAT.roofRed, wall: B.MAT.plaster, sign: 'bread', porch: true },
      { id: 'dodam', x: -17, z: 32, w: 6, d: 5, roof: B.MAT.roofBlue, wall: B.MAT.plasterSage },
      { id: 'inn', x: 22, z: 32, w: 8.5, d: 6.5, h: 2.7, floors: 2, roof: B.MAT.roofPlum, wall: B.MAT.plasterWarm, sign: 'inn', dormer: true },
      { id: 'h5', x: -3, z: 42, w: 6, d: 5, h: 2.7, floors: 2, roof: B.MAT.roofRed, wall: B.MAT.plasterRose },
      { id: 'h6', x: 14, z: 46, w: 5.2, d: 4.6, roof: B.MAT.roofTeal, wall: B.MAT.plaster },
      { id: 'h7', x: -30, z: 18, w: 5.6, d: 4.6, roof: B.MAT.roofPlum, wall: B.MAT.plasterRose },
      { id: 'h8', x: 31, z: 14, w: 6, d: 5, h: 2.7, floors: 2, roof: B.MAT.roofBlue, wall: B.MAT.plasterSage },
      { id: 'h9', x: -26, z: -8, w: 5, d: 4.4, roof: B.MAT.roofRed, wall: B.MAT.plasterWarm },
    ];
    this.houses = {};
    houses.forEach((hd, i) => {
      const g = B.house({ ...hd, seed: 10 + i });
      const ry = this.faceTo(hd.x, hd.z, plaza.x, plaza.z) + randRange(-0.12, 0.12);
      this.place(g, hd.x, hd.z, ry, -0.2);
      const u = g.userData, by = g.position.y;
      this.solid(g, { hw: u.w / 2, hd: u.d / 2, top: by + u.height, topFn: (lx, lz) => by + u.roofTop(lx, lz) });
      if (g.userData.chimney) this.chimneys.push(g.localToWorld(g.userData.chimney.clone()));
      this.houses[hd.id] = g;
    });
    // plaza: flagstone rings around the bell tower with a kerb
    const pv = new THREE.Group();
    const bx = POI.bellTower.x, bz = POI.bellTower.z, by0 = this.h(bx, bz);
    pv.position.set(bx, by0, bz); this.scene.add(pv);
    const tones = [0xb8ad9a, 0xa89e8c, 0xc2b8a4, 0x9c9282, 0xb0a490];
    for (let r = 3.8; r < 11.2; r += 0.92) {
      const n = Math.max(8, Math.round((TAU * r) / (1.05 + rnd() * 0.3)));
      const a0 = rnd() * TAU;
      for (let i = 0; i < n; i++) {
        if (rnd() < 0.04 && r > 9) continue; // a few missing stones at the worn edge
        const a = a0 + (i / n) * TAU, arc = (TAU * r) / n;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const dy = this.h(bx + x, bz + z) - by0;
        B.pstone(pv, arc * 0.93, 0.1, 0.84, tones[Math.floor(rnd() * tones.length)], x, dy + 0.03 + rnd() * 0.02, z, -a + Math.PI / 2);
      }
    }
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * TAU, r = 11.65;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      B.pstone(pv, (TAU * r) / 64 * 0.96, 0.18, 0.36, 0x8b8377, x, this.h(bx + x, bz + z) - by0 + 0.05, z, -a + Math.PI / 2);
    }
    // bell tower
    const bt = B.bellTower();
    this.place(bt, POI.bellTower.x, POI.bellTower.z, 0.1);
    this.solid(bt, { hw: 2.7, hd: 2.7, rot: 0.1 });
    this.bellTower = bt;
    this.bellSwing = 0;
    this.anims.push((dt) => {
      const b = bt.userData.bell;
      this.bellSwing *= Math.exp(-dt * 0.6);
      b.rotation.z = Math.sin(G.time * 3.2) * this.bellSwing;
      bt.userData.glow.material.uniforms.uAlpha.value = Math.min(1, this.bellSwing * 2);
    });
    // resonance tree: a hero broadleaf from the vegetation generator
    const tree = B.resonanceTree(() => makeTree('oak', 4711, { size: 3.3, trunkH: 5.2, r0: 0.78, limbs: 5, sub: 6, light: 0x9fd05e, dark: 0x3c7a36, deep: 0x285a2c, tip: 0xd2e88a, sway: 0.01, swayBase: 5 }));
    this.place(tree, -8, -2, 0.4);
    this.solid(tree, { r: 1.5, climb: false, noTop: true });
    this.col.addPlatform({ type: 'disc', x: -8, z: -2, r: 3.7, top: this.h(-8, -2) + 0.45 });
    this.resTree = tree;
    // windmill
    const wm = B.windmill();
    this.place(wm, 34, 50, this.faceTo(34, 50, 6, 14));
    this.solid(wm, { r: 3.2 });
    this.anims.push((dt) => { wm.userData.rotor.rotation.z += dt * 0.6 * U.wind.value; });
    // well, stalls, benches
    this.place(B.well(), -4, 16); this.col.addCircle(-4, 16, 1.5, this.h(-4, 16) - 1, this.h(-4, 16) + 1.2);
    const s1 = B.stall(B.MAT.clothRed); this.place(s1, 15, 9, this.faceTo(15, 9, 6, 14)); this.col.addBox(15, 9, 1.6, 0.8, s1.rotation.y, -10, this.h(15, 9) + 2.95);
    const s2 = B.stall(B.MAT.clothBlue); this.place(s2, -2, 26, this.faceTo(-2, 26, 6, 14)); this.col.addBox(-2, 26, 1.6, 0.8, s2.rotation.y, -10, this.h(-2, 26) + 2.95);
    for (const [x, z] of [[-12, 6], [-4, -6], [-12, -8]]) this.place(B.bench(), x, z, this.faceTo(x, z, -8, -2) + Math.PI);
    // fences at village edge
    for (const [x, z, r, l] of [[40, 30, 1.4, 12], [38, 4, 1.8, 10], [-38, 30, 1.7, 10], [-36, 2, 1.3, 12], [10, 58, 0.1, 14]]) this.place(B.fence(l), x, z, r);
    // dry-stone walls flanking the north road (the village gate) and at the edges
    for (const [x, z, r, l] of [[-12, -17, 0.25, 7], [4, -18, -0.2, 7], [-40, 8, 1.45, 6], [42, 20, 1.6, 6]]) {
      const w = B.stoneWall(l, rnd); this.place(w, x, z, r);
      this.col.addBox(x, z, l / 2, 0.32, r, -10, this.h(x, z) + w.userData.top);
    }
    // street lamps (their glass brightens at night with the house windows)
    const lamps = [[-2, 3], [15, 3.5], [16, 21], [-4, 22.5], [-11, 25], [25, 22], [9, 35], [-8, 36], [-6, -15], [0, -15], [30, 40]];
    this.lampPosts = [];
    for (const [x, z] of lamps) {
      const lp = B.lampPost(rnd); this.place(lp, x, z, this.faceTo(x, z, plaza.x, plaza.z));
      const c = this.col.addCircle(x, z, 0.25, -10, this.h(x, z) + 3.2); c.climb = false;
      this.lampPosts.push(lp);
    }
    // bunting from the belfry to four lamp posts around the plaza
    const bt0 = new THREE.Vector3(bx, by0 + 9.6, bz);
    for (const [x, z] of [[-2, 3], [15, 3.5], [16, 21], [-4, 22.5]]) {
      const dir = new THREE.Vector3(x - bx, 0, z - bz).normalize();
      const a = bt0.clone().addScaledVector(dir, 2.6), b = new THREE.Vector3(x, this.h(x, z) + 3.05, z);
      this.scene.add(B.bunting([a, b], rnd, { sag: 0.9 }));
    }
    this.scene.add(B.bunting([new THREE.Vector3(9, this.h(9, 35) + 3.0, 35), new THREE.Vector3(16, this.h(16, 21) + 3.05, 21)], rnd, { sag: 0.7 }));
    // washing lines behind houses
    for (const [x, z, r] of [[-23, 38, 0.4], [-35, 24, 1.3], [5, 50, -0.2]]) this.place(B.washingLine(4.5, rnd), x, z, r);
    // carts, hay, crate & barrel stacks
    const c1 = B.cart(rnd, { load: 1 }); this.place(c1, 27, 7, 0.7); this.col.addBox(27, 7, 1.3, 0.8, 0.7, -10, this.h(27, 7) + 1.2);
    const c2 = B.cart(rnd, { load: 0 }); this.place(c2, -25, 25, 2.3); this.col.addBox(-25, 25, 1.3, 0.8, 2.3, -10, this.h(-25, 25) + 1.2);
    const c3 = B.cart(rnd, { load: 2 }); this.place(c3, 39, 46, 1.2); this.col.addBox(39, 46, 1.3, 0.8, 1.2, -10, this.h(39, 46) + 1.3);
    const stack = (x, z, ry) => {
      const g = new THREE.Group();
      B.crate(g, 0, 0.36, 0, 0.72, 0.1, rnd); B.crate(g, 0.78, 0.33, 0.1, 0.66, -0.15, rnd); B.crate(g, 0.35, 1.05, 0.05, 0.64, 0.4, rnd);
      B.barrel(g, -0.8, 0, 0.2, rnd); B.barrel(g, -0.55, 0, -0.6, rnd);
      this.place(g, x, z, ry);
      this.col.addBox(x, z, 1.25, 0.65, ry, -10, this.h(x, z) + 1.35);
    };
    stack(17.8, 11.6, 0.4); stack(-5.2, 28.8, 2.6); stack(26.5, 36.5, -0.9); stack(-20.5, 9.5, 1.8);
    for (const [x, z, r] of [[36, 47, 0.3], [37.2, 48.6, 1.2], [30, 53, 2.2], [-30, -4, 0.6]]) {
      const g = new THREE.Group(); B.hayBale(g, 0, 0.3, 0, 1, 0); if (rnd() < 0.6) B.hayBale(g, 0.15, 0.85, 0.05, 0.9, 0.3);
      this.place(g, x, z, r); this.col.addBox(x, z, 0.6, 0.35, r, -10, this.h(x, z) + 0.6);
    }
    // vegetable gardens behind the houses
    for (const [x, z, r, w, d] of [[-10, 46, 0.2, 3.4, 2.2], [7, 51, -0.3, 3, 2], [-22, -13, 0.5, 3.2, 2.2], [-36, 13, 1.4, 3, 2], [28, 24, 0.9, 2.8, 1.8]]) {
      this.place(B.gardenPlot(w, d, rnd), x, z, r);
    }
    // planters around the plaza and well
    const pl = new THREE.Group();
    for (const [x, z] of [[-6.6, 13.5], [-1.5, 18.4], [11.5, 21.5], [0, 2.5]]) B.planter(pl, x, z, rnd, { len: 1.3, wid: 0.7, stone: true });
    for (const c of pl.children) c.position.y = this.h(c.position.x, c.position.z);
    this.scene.add(pl);
    // signposts
    const signs = [[-2, -6, 0.2, [{ ry: 0.2 }, { ry: -2.5 }]], [-26, 10, 1.5, [{ ry: 0.3 }, { ry: 2.9 }]], [24, -1, -0.8, [{ ry: -0.2 }, { ry: 2.4 }]], [5, 50, 3.1, [{ ry: 0.2 }, { ry: -0.5 }]]];
    for (const [x, z, r, t] of signs) { this.place(B.signpost(t), x, z, r); this.col.addCircle(x, z, 0.2, -10, this.h(x, z) + 2.6).climb = false; }
    // landscaping: blossom and shade trees, hedges and flower beds
    const P = this.props;
    for (const [x, z, s] of [[-24, 12, 1.0], [27, 25, 0.95], [-9, 39, 0.9], [-33, 30, 1.05], [36, 30, 0.9], [-14, -14, 1.0], [14, -10, 0.95]]) P.add('blossom', x, z, s, { col: 0.4, tall: 4 });
    for (const [x, z, s] of [[-36, 36, 1.0], [38, -4, 1.1], [-32, -18, 1.05], [33, 42, 0.95], [-38, -2, 1.0], [18, 56, 1.0]]) P.add('oak', x, z, s, { col: 0.45 });
    for (let i = 0; i < 70; i++) {
      const a = rnd() * TAU, r = 16 + rnd() * 22;
      const x = 3 + Math.cos(a) * r, z = 18 + Math.sin(a) * r;
      if (this.col.pointHit(x, this.h(x, z) + 0.5, z, 1.2) || this.terrain.pathAt(x, z) > 0.3) continue;
      if (Math.hypot(x - bx, z - bz) < 13) continue;
      if (rnd() < 0.45) P.add('bush', x, z, 0.6 + rnd() * 0.5);
      else P.add('flowers', x, z, 0.8 + rnd() * 0.4);
    }
  }

  buildTowerHill() {
    const t = B.moraTower();
    this.place(t, POI.tower.x, POI.tower.z, 0);
    this.solid(t, { r: 4.6 });
    const an = t.children.find((c) => c.userData && c.userData.roofTop);
    const ty = t.position.y;
    this.annexCol = this.col.addBox(POI.tower.x - 2, POI.tower.z - 6.2, an ? an.userData.w / 2 : 2.9, an ? an.userData.d / 2 : 2.5, 0, -10, ty + (an ? an.userData.height : 6));
    if (an) this.annexCol.topFn = (lx, lz) => ty + an.userData.roofTop(lx, lz);
    this.tower = t;
    this.anims.push(() => {
      t.userData.chimes.forEach((c, i) => { c.position.y = 16 + Math.sin(G.time * 1.5 + i) * 0.15 - (i % 2) * 0.4; c.rotation.y += 0.02; });
    });
    if (t.userData.chimney) this.chimneys.push(t.localToWorld(t.userData.chimney.clone()));
    // grave (Seha's nameless stone)
    const gr = B.grave();
    this.place(gr, POI.grave.x, POI.grave.z, this.faceTo(POI.grave.x, POI.grave.z, -14, 146));
    this.solid(gr, { r: 0.6 });
    const bench = B.bench(); this.place(bench, -20, 132, Math.PI);
    // training yard
    this.training = { targets: [], braziers: [], dummies: [] };
    for (const [x, z] of [[-9, 131], [-3, 127], [3, 131]]) {
      const tc = B.targetCrystal(0xb894ff);
      const y = this.h(x, z) + 1.8;
      tc.position.set(x, y, z); this.scene.add(tc);
      const tgt = this.addTarget({ id: 'tcrystal', pos: new THREE.Vector3(x, y, z), r: 0.9, obj: tc, alive: true, onHit: null });
      this.training.targets.push(tgt);
      this.anims.push(() => { if (!tgt.alive) return; tc.userData.c.rotation.y += 0.02; tc.position.y = y + Math.sin(G.time * 2 + x) * 0.15; tgt.pos.y = tc.position.y; tc.userData.ring.rotation.z += 0.01; });
    }
    for (const [x, z] of [[-9, 147], [4, 148], [-2, 153]]) this.training.braziers.push(this.makeBrazier(x, z, 'tbrazier'));
    for (const [x, z] of [[7, 137], [10, 142], [8, 147]]) {
      const d = B.dummy(); this.place(d, x, z, this.faceTo(x, z, -6, 142));
      this.solid(d, { r: 0.4, climb: false });
      const tgt = this.addTarget({ id: 'dummy', pos: new THREE.Vector3(x, this.h(x, z) + 1.5, z), r: 0.9, obj: d, wob: 0, onHit: null });
      tgt.baseHit = (el) => { tgt.wob = 1; tgt.wobEl = el; };
      this.training.dummies.push(tgt);
      this.anims.push((dt) => { tgt.wob = Math.max(0, tgt.wob - dt * 1.2); d.userData.pivot.rotation.z = Math.sin(G.time * 18) * tgt.wob * 0.25; d.userData.pivot.rotation.x = Math.cos(G.time * 13) * tgt.wob * 0.12; });
    }
    // path markers: three small lantern posts for movement tutorial
    this.runMarkers = [];
    for (const [x, z] of [[-2, 136], [-18, 137], [-20, 145.5]]) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.6), transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 24), mat);
      m.position.set(x, this.h(x, z) + 0.06, z); this.scene.add(m);
      const beamGeo = new THREE.CylinderGeometry(0.35, 0.8, 7, 16, 1, true); beamGeo.translate(0, 3.5, 0);
      const bcol = new Float32Array(beamGeo.attributes.position.count * 3);
      for (let i = 0; i < beamGeo.attributes.position.count; i++) { const k = 1 - beamGeo.attributes.position.getY(i) / 7; bcol[i * 3] = k; bcol[i * 3 + 1] = k; bcol[i * 3 + 2] = k; }
      beamGeo.setAttribute('color', new THREE.BufferAttribute(bcol, 3));
      const bmat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.45, 0.2), vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(beamGeo, bmat); m.add(beam);
      this.anims.push(() => { beam.rotation.y += 0.01; beam.scale.x = beam.scale.z = 1 + Math.sin(G.time * 3 + x) * 0.08; bmat.opacity = mat.opacity * (0.75 + Math.sin(G.time * 2.4 + x) * 0.25); });
      this.runMarkers.push({ mesh: m, x, z, done: false });
    }
    // hill dressing: training-yard furniture, herb garden, lamps, the grave's garden
    const rnd = mulberry32(21);
    const wr = B.weaponRack(rnd); this.place(wr, 12.6, 141, -Math.PI / 2); this.col.addBox(12.6, 141, 1.05, 0.25, -Math.PI / 2, -10, this.h(12.6, 141) + 1.3).climb = false;
    for (const [x, z] of [[12, 134.5], [11.5, 148.5]]) { const st = B.strawTarget(); this.place(st, x, z, this.faceTo(x, z, -6, 142)); this.col.addCircle(x, z, 0.5, -10, this.h(x, z) + 1.9).climb = false; }
    for (const [x, z, r, l] of [[14.5, 137, Math.PI / 2 + 0.05, 9], [14.2, 148, Math.PI / 2 - 0.08, 7]]) this.place(B.fence(l), x, z, r);
    for (const [x, z, r] of [[9.5, 152, 0.4], [-31.5, 162, 1.2]]) {
      const g = new THREE.Group(); B.hayBale(g, 0, 0.3, 0, 1, 0); B.hayBale(g, 1.15, 0.3, 0.1, 1, 0.1); B.hayBale(g, 0.55, 0.85, 0.05, 0.95, -0.2);
      this.place(g, x, z, r); this.col.addBox(x, z, 1.2, 0.4, r, -10, this.h(x, z) + 1.15);
    }
    this.place(B.gardenPlot(3.4, 2.2, rnd), -34, 147.5, 0.4);
    this.place(B.gardenPlot(2.6, 1.8, rnd), -35.5, 151.5, 0.3);
    const hp = new THREE.Group();
    for (const [x, z] of [[-21.3, 150.9], [-21.3, 155.1]]) B.planter(hp, x, z, rnd, { len: 0.8, wid: 0.8, stone: true });
    for (const c of hp.children) c.position.y = this.h(c.position.x, c.position.z);
    this.scene.add(hp);
    for (const [x, z] of [[-17, 141.5], [-12.5, 155.5], [-8, 132]]) {
      const lp = B.lampPost(rnd); this.place(lp, x, z, this.faceTo(x, z, -14, 146));
      this.col.addCircle(x, z, 0.25, -10, this.h(x, z) + 3.2).climb = false;
    }
    this.place(B.signpost([{ ry: -0.4 }, { ry: 2.6 }]), -9.5, 133.5, 0.6);
    // Seha's grave sits under a blossom tree in a patch of flowers
    this.props.add('blossom', -39.5, 132.5, 1.05, { col: 0.4, tall: 4, ry: 0.8 });
    for (let i = 0; i < 16; i++) {
      const a = rnd() * TAU, r = 2 + rnd() * 3.5;
      this.props.add('flowers', POI.grave.x + Math.cos(a) * r, POI.grave.z + Math.sin(a) * r, 0.8 + rnd() * 0.3, { v: [0, 3, 5][i % 3] });
    }
    // trees framing the tower on the hill's back side
    for (const [x, z, t, sc] of [[-40, 158, 'oak', 1.1], [-36, 167, 'birch', 1.0], [-19, 166, 'birch', 0.9], [-44, 147, 'oak', 0.95], [-14, 168, 'oak', 1.0], [-42, 166, 'pine', 0.9]]) this.props.add(t, x, z, sc, { col: 0.42 });
    for (let i = 0; i < 18; i++) {
      const a = rnd() * TAU, r = 7 + rnd() * 5;
      const x = POI.tower.x + Math.cos(a) * r, z = POI.tower.z + Math.sin(a) * r;
      if (this.col.pointHit(x, this.h(x, z) + 0.5, z, 1)) continue;
      this.props.add(rnd() < 0.5 ? 'bush' : 'flowers', x, z, 0.7 + rnd() * 0.4);
    }
  }

  makeBrazier(x, z, id) {
    const b = B.brazier(); this.place(b, x, z);
    this.col.addCircle(x, z, 0.5, -10, this.h(x, z) + 1.6);
    const fl = { pos: new THREE.Vector3(x, this.h(x, z) + b.userData.fireY, z), lit: false, scale: 1 };
    this.flames.push(fl);
    const tgt = this.addTarget({ id, pos: fl.pos.clone().add(new THREE.Vector3(0, -0.2, 0)), r: 1.1, obj: b, flame: fl, lit: false, onHit: null });
    tgt.baseHit = (el) => {
      if (el === 'fire' && !tgt.lit) {
        tgt.lit = fl.lit = true;
        b.userData.coal.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.2, 0.3) });
        G.audio.play('lantern', { pos: fl.pos });
        G.vfx.burst(fl.pos, 'fire', 24, { speed: 3 }); G.vfx.burst(fl.pos, 'ember', 12);
        G.vfx.flash(fl.pos, 0xff8a3a, 40, 12, 0.6);
        if (tgt.onLit) tgt.onLit(tgt);
      } else if ((el === 'frost' || el === 'wind' || el === 'water') && tgt.lit && !tgt.permanent) {
        tgt.lit = fl.lit = false;
        b.userData.coal.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.1, 0.1) });
        G.vfx.burst(fl.pos, 'smoke', 8); G.audio.play('fizzle', { pos: fl.pos });
        if (tgt.onOut) tgt.onOut(tgt);
      }
    };
    return tgt;
  }

  makeWindWheel(x, z, ry, id) {
    const w = B.windWheel(); this.place(w, x, z, ry);
    this.col.addCircle(x, z, 0.4, -10, this.h(x, z) + 3.5).climb = false;
    const tgt = this.addTarget({ id, pos: new THREE.Vector3(x, this.h(x, z) + 3.3, z), r: 1.6, obj: w, spin: 0, active: false, onHit: null });
    tgt.baseHit = (el) => {
      if (el === 'wind') {
        tgt.spin = 1;
        if (!tgt.active) {
          tgt.active = true;
          G.audio.play('updraft', { pos: tgt.pos });
          G.vfx.burst(tgt.pos, 'wind', 20, { radius: 1.5 });
          if (tgt.onActive) tgt.onActive(tgt);
        }
      }
    };
    this.anims.push((dt) => {
      const sp = tgt.active ? 1 : tgt.spin;
      w.userData.rotor.rotation.z += dt * (0.3 + sp * 9);
      tgt.spin = Math.max(0, tgt.spin - dt * 0.2);
      w.userData.glow.material.opacity = tgt.active ? 0.8 + Math.sin(G.time * 5) * 0.2 : 0;
    });
    return tgt;
  }

  buildShrines() {
    this.shrines = {};
    const mk = (el, p, ruined) => {
      const s = B.shrine(el, G.vfx.runeTex, { ruined });
      const y = this.h(p.x, p.z);
      s.position.set(p.x, y - 0.05, p.z);
      this.scene.add(s);
      this.col.addPlatform({ type: 'disc', x: p.x, z: p.z, r: 10.6, top: y + 0.35 });
      this.col.addPlatform({ type: 'disc', x: p.x, z: p.z, r: 9.3, top: y + 0.8 });
      this.col.addBox(p.x, p.z, 1.3, 1.3, 0, y, y + 3);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        this.col.addCircle(p.x + Math.cos(a) * 8.2, p.z + Math.sin(a) * 8.2, 0.7, y, y + 7);
      }
      for (const sx of [-1, 1]) this.col.addCircle(p.x + sx * 2, p.z - 5, 0.5, y, y + 7);
      const sealCol = this.col.addCircle(p.x, p.z, 11, y - 5, y + 12, 'seal');
      sealCol.climb = false; sealCol.noTop = true;
      const data = { el, group: s, pos: new THREE.Vector3(p.x, y + 0.8, p.z), sealCol, sealed: true, y };
      this.anims.push((dt) => {
        const c = s.userData.crystal; c.rotation.y += dt * 0.8; c.position.y = 4.2 + Math.sin(G.time * 1.6) * 0.2;
        if (data.bellSwing) { data.bellSwing *= Math.exp(-dt * 0.7); s.userData.bell.rotation.z = Math.sin(G.time * 3.5) * data.bellSwing; }
      });
      this.shrines[el] = data;
      return data;
    };
    const fs = mk('frost', POI.frost, false);
    fs.braziers = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      fs.braziers.push(this.makeBrazier(POI.frost.x + Math.cos(a) * 14, POI.frost.z + Math.sin(a) * 14, 'fbrazier'));
    }
    // ice crystal clusters around frost shrine: three cluster shapes, one instanced draw each
    const rnd = mulberry32(5);
    const iceMat = crystalMaterial({ ice: true, color: 0xcdeeff, glow: 0x7fd4ff, intensity: 0.55, seed: 2 });
    const iceGeos = [0, 1, 2].map((k) => crystalGeometry('cluster', { seed: 500 + k * 17, count: [7, 5, 9][k] }));
    const iceXf = [[], [], []];
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler();
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, r = 15 + rnd() * 14;
      const x = POI.frost.x + Math.cos(a) * r, z = POI.frost.z + Math.sin(a) * r;
      if (this.terrain.pathInfo(x, z).d < 6) continue;
      const s = 0.8 + rnd() * 2.2;
      e4.set((rnd() - 0.5) * 0.4, rnd() * 6.28, (rnd() - 0.5) * 0.4);
      m4.compose(tmp.set(x, this.h(x, z) - 0.3, z), q4.setFromEuler(e4), new THREE.Vector3(s * 1.15, s * 1.3, s * 1.15));
      iceXf[i % 3].push(m4.clone());
      if (s > 1.4) this.col.addCircle(x, z, s * 0.35, -10, this.h(x, z) + s * 2);
    }
    iceXf.forEach((list, k) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(iceGeos[k], iceMat, list.length);
      list.forEach((mx, j) => im.setMatrixAt(j, mx));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = true; im.receiveShadow = false;
      this.scene.add(im);
    });
    const ss = mk('storm', POI.storm, true);
    ss.wheels = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      const x = POI.storm.x + Math.cos(a) * 15, z = POI.storm.z + Math.sin(a) * 15;
      ss.wheels.push(this.makeWindWheel(x, z, this.faceTo(x, z, POI.storm.x, POI.storm.z), 'wheel'));
    }
    const rr = mulberry32(12);
    for (let i = 0; i < 16; i++) {
      const a = rr() * Math.PI * 2, r = 20 + rr() * 22;
      const x = POI.storm.x + Math.cos(a) * r, z = POI.storm.z + Math.sin(a) * r;
      if (Math.hypot(x - POI.storm.x, z - POI.storm.z) > 46) continue;
      const o = rr() < 0.4 ? B.ruinArch(rr) : B.pillarBroken(2 + rr() * 4, rr);
      this.place(o, x, z, rr() * 3);
      if (o.userData.pillars) {
        // one solid column per side (the arch between them stays open)
        for (const [lx, top] of o.userData.pillars) {
          const px = x + Math.cos(o.rotation.y) * lx, pz = z - Math.sin(o.rotation.y) * lx;
          this.col.addCircle(px, pz, 0.62, -10, o.position.y + top);
        }
      } else this.solid(o, { r: 0.7 });
    }
    // Kael's broken shield
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 6), B.MAT.bronze);
    sh.position.set(POI.storm.x + 5, this.h(POI.storm.x + 5, POI.storm.z + 12) + 0.4, POI.storm.z + 12); sh.rotation.set(1.2, 0.3, 0.2); this.scene.add(sh);
  }

  buildRift() {
    const g = B.riftGate();
    const y = this.h(POI.rift.x, POI.rift.z);
    g.position.set(POI.rift.x, y - 0.3, POI.rift.z);
    this.scene.add(g);
    this.rift = { group: g, y, center: new THREE.Vector3(POI.rift.x, y, POI.rift.z) };
    g.children.forEach((c) => {
      if (c.userData.monolith) { const cc = this.col.addCircle(POI.rift.x + c.position.x, POI.rift.z + c.position.z, 1.5, -10, 40); cc.climb = false; cc.noTop = true; }
    });
    // gate plinths are solid blocks you can stand on
    for (const sx of [-1, 1]) this.col.addBox(POI.rift.x + sx * 6.8, POI.rift.z - 14, 2.3, 2.3, 0, -10, y - 0.3 + 1.4);
  }

  buildLandmarks() {
    const rnd = mulberry32(606);
    const P = this.props;
    // Lake willow (hairpin): a big weeping willow with stones and flowers at its roots
    const willow = makeTree('willow', 21, { trunkH: 3.0, size: 2.3, light: 0xb7d86a, dark: 0x4c8a40 });
    this.place(willow, -49, 82, 0.4); this.solid(willow, { r: 0.7, climb: false, noTop: true });
    for (let i = 0; i < 10; i++) {
      const a = rnd() * TAU, r = 3 + rnd() * 4;
      P.add(i % 3 ? 'flowers' : 'pebbles', -49 + Math.cos(a) * r, 82 + Math.sin(a) * r, 0.9, { v: i % 3 ? 5 : undefined });
    }
    // Sunset meadow knoll: a golden lone tree, the bench, a ring of wildflowers
    const M = POI.meadow;
    const lone = makeTree('oak', 77, { trunkH: 3.8, size: 2.7, limbs: 4, sub: 6, r0: 0.42, light: 0xf2d06a, dark: 0xc0843a, deep: 0x84522a, tip: 0xf8e6a0, sway: 0.014, swayBase: 3.5 });
    this.place(lone, M.x, M.z, 0.3); this.solid(lone, { r: 0.7, climb: false, noTop: true });
    this.place(B.bench(), M.x + 2, M.z + 2.6, Math.PI * 0.25 + Math.PI);
    for (let i = 0; i < 46; i++) {
      const a = rnd() * TAU, r = 3.5 + rnd() * 9;
      const x = M.x + Math.cos(a) * r, z = M.z + Math.sin(a) * r;
      if (Math.hypot(x - (M.x + 2), z - (M.z + 2.6)) < 1.6) continue;
      P.add('flowers', x, z, 0.8 + rnd() * 0.5, { v: [1, 4, 2, 0][i % 4] });
    }
    for (const [dx, dz, s] of [[-5.5, 3, 0.9], [6, -4, 1.2], [-3, -6.5, 0.7]]) P.add('rock', M.x + dx, M.z + dz, s, { col: 0.8, v: 2 });
    // island tree
    const it = makeTree('oak', 5, { trunkH: 2.4, size: 1.4 }); this.place(it, POI.island.x + 1.5, POI.island.z - 1, 0);
    // fishing dock on the lake shore by the path's end (walkable platform)
    {
      const L = POI.lake;
      const s = new THREE.Vector3(-40, 0, 44), d = new THREE.Vector3(L.x - s.x, 0, L.z - s.z).normalize();
      for (let k = 0; k < 40 && this.h(s.x, s.z) > 0.25; k++) s.addScaledVector(d, 0.5);
      s.addScaledVector(d, -1.6);
      const len = 10, ry = Math.atan2(d.x, d.z);
      const dk = B.dock(len, 2.2, rnd);
      dk.position.set(s.x, 0.55, s.z); dk.rotation.y = ry; this.scene.add(dk);
      const c = s.clone().addScaledVector(d, len / 2);
      this.col.addPlatform({ type: 'box', x: c.x, z: c.z, hw: 1.1, hd: len / 2, rot: ry, top: 0.6 });
      // barrels & a crate of the fisher's things at the dock foot
      const fg = new THREE.Group(); B.barrel(fg, 0, 0, 0, rnd); B.crate(fg, 0.9, 0.3, 0.2, 0.6, 0.3, rnd);
      const fx = s.x - d.z * 1.8 - d.x * 0.5, fz = s.z + d.x * 1.8 - d.z * 0.5;
      this.place(fg, fx, fz, ry); this.col.addCircle(fx, fz, 0.8, -10, this.h(fx, fz) + 0.9);
    }
    // roadside furniture: milestones on every road, stone cairns up the frost pass,
    // broken walls along the western road, dead trees down the ashen slope
    const zoneClear = (x, z) => Math.hypot(x - POI.village.x, z - POI.village.z) > 44 && Math.hypot(x - POI.towerYard.x, z - POI.towerYard.z) > 26 &&
      Math.hypot(x - POI.frost.x, z - POI.frost.z) > 30 && Math.hypot(x - POI.storm.x, z - POI.storm.z) > 34 && Math.hypot(x - POI.rift.x, z - POI.rift.z) > 46 &&
      !LANTERNS.some((l) => Math.hypot(x - l.x, z - l.z) < 5);
    const along = (path, step, fn) => {
      let carry = step * 0.5;
      for (let i = 0; i < path.pts.length - 1; i++) {
        const [ax, az] = path.pts[i], [bx2, bz2] = path.pts[i + 1];
        const len = Math.hypot(bx2 - ax, bz2 - az), dx = (bx2 - ax) / len, dz = (bz2 - az) / len;
        for (let t = carry; t < len; t += step) fn(ax + dx * t, az + dz * t, dx, dz);
        carry = (carry - len) % step; if (carry < 0) carry += step;
      }
    };
    let side = 1;
    for (const path of PATHS) {
      along(path, 42, (x, z, dx, dz) => {
        side = -side;
        const ox = x - dz * 4.6 * side, oz = z + dx * 4.6 * side;
        if (!zoneClear(ox, oz) || this.h(ox, oz) < 0.5) return;
        this.place(B.milestone(rnd), ox, oz, Math.atan2(dx, dz) + Math.PI / 2 * side);
        this.col.addCircle(ox, oz, 0.35, -10, this.h(ox, oz) + 1.0);
      });
      if (path.id === 'frost') along(path, 26, (x, z, dx, dz) => {
        if (z > -45) return;
        side = -side;
        const ox = x - dz * (5.5 + rnd() * 2) * side, oz = z + dx * (5.5 + rnd() * 2) * side;
        if (!zoneClear(ox, oz)) return;
        const h = 1.0 + rnd() * 0.9;
        this.place(B.cairn(rnd, h), ox, oz, rnd() * 3);
        this.col.addCircle(ox, oz, 0.45, -10, this.h(ox, oz) + h * 0.8);
        if (rnd() < 0.6) this.place(B.cairn(rnd, h * 0.5), ox + 0.9, oz + 0.5, rnd() * 3);
      });
      if (path.id === 'storm') along(path, 30, (x, z, dx, dz) => {
        if (x > -55) return;
        side = -side;
        const ox = x - dz * (7 + rnd() * 3) * side, oz = z + dx * (7 + rnd() * 3) * side;
        if (!zoneClear(ox, oz)) return;
        const l = 3 + rnd() * 3, w = B.stoneWall(l, rnd, { h: 0.6 + rnd() * 0.6 });
        const r = Math.atan2(dx, dz) + Math.PI / 2 + (rnd() - 0.5) * 0.5;
        this.place(w, ox, oz, r);
        this.col.addBox(ox, oz, l / 2, 0.32, r, -10, this.h(ox, oz) + w.userData.top);
        if (rnd() < 0.5) { const pb = B.pillarBroken(1.5 + rnd() * 2, rnd); this.place(pb, ox + dx * 3, oz + dz * 3, rnd() * 3); this.solid(pb, { r: 0.7 }); }
      });
      if (path.id === 'rift') along(path, 18, (x, z, dx, dz) => {
        if (x < 40) return;
        side = -side;
        const ox = x - dz * (6 + rnd() * 6) * side, oz = z + dx * (6 + rnd() * 6) * side;
        if (Math.hypot(ox - POI.rift.x, oz - POI.rift.z) < 40) return;
        P.add('dead', ox, oz, 0.8 + rnd() * 0.4, { col: 0.35 });
      });
    }
    // an abandoned, tipped-over cart on the ashen slope
    const bc = B.cart(rnd, { load: 0 }); this.place(bc, 66, -48, 0.9, -0.1); bc.rotation.z = 0.35; bc.updateMatrixWorld(true);
    this.col.addBox(66, -48, 1.3, 0.8, 0.9, -10, this.h(66, -48) + 1.3);
  }

  buildLanterns() {
    for (const L of LANTERNS) {
      const g = B.lanternStone();
      this.place(g, L.x, L.z, rand() * 3);
      this.col.addCircle(L.x, L.z, 0.6, -10, this.h(L.x, L.z) + 3);
      const pos = new THREE.Vector3(L.x, this.h(L.x, L.z) + g.userData.flameY, L.z);
      const fl = { pos, lit: false, scale: 0.6 };
      this.flames.push(fl);
      const data = { ...L, group: g, flame: fl, lit: false, pos };
      data.setLit = (v) => {
        data.lit = fl.lit = v;
        g.userData.flame.visible = v;
        g.userData.cage.material.opacity = v ? 0.35 : 0;
      };
      this.lanterns[L.id] = data;
      this.addTarget({ id: 'lantern', pos: pos.clone(), r: 1, lantern: data, baseHit: (el) => { if (el === 'fire' && !data.lit && G.game) G.game.lightLantern(data); } });
    }
  }

  buildSeeds() {
    // luminous seed crystal above a glowing sprout
    const geo = crystalGeometry('prism', { double: true, sides: 5, radius: 0.55, tip: 0.6, seed: 17 });
    const mat = crystalMaterial({ color: 0xdcffb0, glow: 0xb8ff70, intensity: 1.25, seed: 4 });
    const sproutMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 1.1, 0.55) });
    SEEDS.forEach(([x, z], i) => {
      const y = this.h(x, z);
      const g = new THREE.Group(); g.position.set(x, y, z); g.userData.noBake = true;
      const sprout = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6, 5), sproutMat);
      sprout.position.y = 0.3; g.add(sprout);
      const orb = new THREE.Mesh(geo, mat);
      orb.scale.setScalar(0.2); orb.rotation.z = 0.12;
      orb.position.y = 0.9; g.add(orb);
      orb.add(crystalGlowSprite(0xb8ff70, 9, { intensity: 0.32 }));
      this.scene.add(g);
      this.seeds.push({ i, x, z, y, g, orb, taken: false, humT: rand() * 4 });
    });
  }

  buildMemories() {
    const memMat = crystalMaterial({ color: 0xf0e4ff, glow: 0xd0b0ff, intensity: 1.35, seed: 6 });
    for (const [id, m] of Object.entries(MEMORIES)) {
      const y = this.h(m.x, m.z);
      const g = new THREE.Group(); g.position.set(m.x, y + 0.5, m.z);
      const core = new THREE.Mesh(crystalGeometry('gem', { seed: 3 }), memMat);
      core.scale.setScalar(0.2); core.rotation.x = 0.35;
      core.add(crystalGlowSprite(0xd8c0ff, 8, { intensity: 0.35 }));
      g.add(core);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.03, 6, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.6, 2.4) }));
      g.add(halo);
      g.visible = !m.hidden;
      this.scene.add(g);
      this.memoryObjs[id] = { id, ...m, g, core, halo, taken: false, pos: new THREE.Vector3(m.x, y + 0.5, m.z) };
    }
  }

  // ------------------------------------------------------------
  // Ice floe (frost on water) — walkable
  addIceFloe(x, z) {
    if (this.iceFloes.length > 14) this.removeIceFloe(this.iceFloes[0]);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.3, 0.7, 6), G.vfx.iceMat);
    m.position.set(x, -0.1, z); m.rotation.y = rand() * 3; m.scale.set(0.01, 1, 0.01);
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    const plat = this.col.addPlatform({ type: 'disc', x, z, r: 1.55, top: 0.25 });
    const f = { m, plat, t: 0, life: 40 };
    this.iceFloes.push(f);
    G.vfx.burst(new THREE.Vector3(x, 0.2, z), 'ice', 10); G.vfx.burst(new THREE.Vector3(x, 0.2, z), 'frostmist', 5);
    G.audio.play('freeze', { pos: m.position });
    return f;
  }
  removeIceFloe(f) {
    const i = this.iceFloes.indexOf(f); if (i >= 0) this.iceFloes.splice(i, 1);
    this.scene.remove(f.m); this.col.removePlatform(f.plat);
    G.vfx.burst(f.m.position, 'ice', 8);
  }

  // ------------------------------------------------------------
  update(dt, camPos, playerPos) {
    U.time.value = G.time;
    U.wind.value = 1 + Math.sin(G.time * 0.3) * 0.35 + Math.sin(G.time * 1.1) * 0.15;
    this.sky.update(dt, playerPos, 1, camPos);
    this.water.update(this.sky);
    this.grass.update(dt, camPos, playerPos, this.sky);
    this.props.update(G.camera);
    const n = this.sky.night;
    B.windowMat.color.setRGB(1.6, 1.1, 0.5).multiplyScalar(0.25 + n * 1.3);
    for (const a of this.anims) a(dt);
    // flames
    this.ambT += dt;
    const q = G.settings.quality === 'low' ? 0.5 : 1;
    for (const f of this.flames) {
      if (!f.lit) continue;
      const d = f.pos.distanceTo(camPos);
      if (d > 60) continue;
      if (rand() < dt * 30 * q * f.scale) G.vfx.burst(f.pos, 'fire', 1, { spread: 0.18 * f.scale, speed: 0.6, size: 0.9 * f.scale, life: 0.9 });
      if (rand() < dt * 3 * q) G.vfx.burst(f.pos, 'ember', 1, { speed: 2 });
    }
    // lantern flame flicker
    for (const L of Object.values(this.lanterns)) if (L.lit) {
      const fm = L.group.userData.flame; fm.scale.setScalar(0.9 + Math.sin(G.time * 13 + L.x) * 0.15); fm.rotation.y += dt * 3;
    }
    // chimney smoke
    for (const c of this.chimneys) if (c.distanceTo(camPos) < 90 && rand() < dt * 2.5 * q) G.vfx.burst(c, 'smoke', 1, { spread: 0.2, size: 0.8, alpha: 0.28, color: new THREE.Color(0.75, 0.75, 0.78), color1: new THREE.Color(0.85, 0.85, 0.88) });
    // resonance tree lanterns
    if (this.resTree) this.resTree.userData.lanterns.forEach((l, i) => { l.position.y += Math.sin(G.time * 1.3 + i) * 0.002; });
    // seeds
    for (const s of this.seeds) {
      if (s.taken) continue;
      s.orb.position.y = 0.9 + Math.sin(G.time * 2 + s.i) * 0.15;
      s.orb.rotation.y += dt * 2;
      const d = Math.hypot(s.x - playerPos.x, s.z - playerPos.z);
      if (d < 40) {
        s.humT -= dt;
        if (s.humT <= 0) { s.humT = 3 + rand() * 2; G.audio.play('seed_hum', { pos: tmp.set(s.x, s.y + 1, s.z), m: 86 + (s.i % 5) * 2, key: 's' + s.i }); }
        if (rand() < dt * 4) G.vfx.burst(tmp.set(s.x, s.y + 0.9, s.z), 'soul', 1, { el: 'heal' });
      }
    }
    for (const m of Object.values(this.memoryObjs)) {
      if (m.taken || !m.g.visible) continue;
      m.core.rotation.y += dt * 1.5; m.halo.rotation.x = G.time * 0.8; m.halo.rotation.y = G.time * 0.5;
      m.g.position.y = m.pos.y + Math.sin(G.time * 1.8) * 0.12;
      if (rand() < dt * 5) G.vfx.burst(m.g.position, 'soul', 1, { el: 'arcane' });
    }
    // ice floes
    for (let i = this.iceFloes.length - 1; i >= 0; i--) {
      const f = this.iceFloes[i]; f.t += dt;
      const k = Math.min(1, f.t / 0.2); f.m.scale.set(k, 1, k);
      if (f.t > f.life) this.removeIceFloe(f);
    }
    // ambient particles
    const reg = regionAt(playerPos.x, playerPos.z);
    if (n > 0.5 && rand() < dt * 6 * q && reg.id !== 'rift') G.vfx.burst(playerPos, 'firefly', 1, { spread: 16 });
    if (n < 0.4 && rand() < dt * 5 * q) G.vfx.burst(playerPos, 'pollen', 1, { spread: 16 });
    if ((playerPos.z < -95 || playerPos.y > 42) && rand() < dt * 40 * q) G.vfx.burst(playerPos, 'snow', 1, { spread: 18 });
    if (reg.id === 'rift' && rand() < dt * 18 * q) G.vfx.burst(tmp.set(playerPos.x + randRange(-14, 14), playerPos.y, playerPos.z + randRange(-14, 14)), 'ash', 1, { spread: 1 });
  }
}
