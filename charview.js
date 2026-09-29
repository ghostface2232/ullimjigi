// Local character viewer (dev only, not part of the game build).
import * as THREE from 'three';
import { G } from './src/core/context.js';
import { U, toon } from './src/render/materials.js';
import * as C from './src/game/characters.js';

const q = new URLSearchParams(location.search);
const W = +(q.get('w') || 960), H = +(q.get('h') || 540);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc4e0);
const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 200);
G.scene = scene; G.camera = cam;
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
const sd = new THREE.Vector3(0.45, 0.8, 0.55).normalize();
sun.position.copy(sd).multiplyScalar(30); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 80 });
scene.add(sun, sun.target);
U.sunDir.value.copy(sd);
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x7a8a5a, 1.2));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), toon(0x7fa860, { noAO: true }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const NPC = ['player', 'mora', 'bau', 'dodam', 'isol', 'danbi', 'villagerA', 'villagerB', 'villagerC', 'seha', 'kael'];
const EN = {
  ashling: () => C.makeAshling('normal'), ashlingFrost: () => C.makeAshling('frost'), wailer: () => C.makeWailer(), brute: () => C.makeBrute('normal'),
  bruteFrost: () => C.makeBrute('frost'), knight: () => C.makeKnight(false), ooze: () => C.makeOoze('ash'), oozeFire: () => C.makeOoze('fire'), oozeFrost: () => C.makeOoze('frost'), oozeWater: () => C.makeOoze('water'), moth: () => C.makeMoth(),
  shield: () => C.makeShieldBearer(), archer: () => C.makeArcher(), rootHand: () => C.makeRootHand(), watcher: () => C.makeWatcher(),
};
function make(key) {
  if (CHAR_OK(key)) return C.makeHumanoid(C.CHAR[key]);
  if (key === 'fox') return C.makeFox();
  if (key === 'cat') return C.makeCat();
  if (key === 'ghostSeha') return C.makeGhost(C.makeHumanoid(C.CHAR.seha), 0xbfe8ff, 0.8);
  if (key === 'ghostKael') return C.makeGhost(C.makeHumanoid(C.CHAR.kael), 0x9ad0ff, 0.85);
  if (key === 'spectral') return C.makeKnight(true);
  return EN[key]();
}
function CHAR_OK(k) { return !!C.CHAR[k]; }

const rigs = [];
const set = q.get('set') || 'npcs';
let keys;
if (set === 'npcs') keys = NPC.concat(['fox', 'cat']);
else if (set === 'enemies') keys = Object.keys(EN);
else keys = set.split(',');
const views = q.get('views');
let x = 0;
const t0 = performance.now();
for (const k of keys) {
  const n = views ? views.split(',').length : 1;
  for (let i = 0; i < n; i++) {
    const r = make(k);
    const box = new THREE.Box3().setFromObject(r.root);
    const w = Math.max(0.6, box.max.x - box.min.x) * 1.05 + 0.25;
    r.key = k; r.state = {};
    r.root.rotation.y = views ? (+views.split(',')[i] * Math.PI) / 180 : +(q.get('yaw') || 0) * Math.PI / 180;
    r.root.position.set(x + w / 2, k === 'fox' || k === 'wailer' ? 1.3 : k === 'moth' ? 0.6 : 0, 0);
    r.root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) o.castShadow = true; });
    x += w;
    scene.add(r.root); rigs.push(r);
  }
}
const buildMs = performance.now() - t0;
for (const r of rigs) r.root.position.x -= x / 2;
// frame
function frame(zoom = 1, ty = null) {
  const box = new THREE.Box3();
  for (const r of rigs) box.expandByObject(r.root);
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const d = Math.max(s.x / (2 * Math.tan((cam.fov * Math.PI) / 360) * cam.aspect), s.y / (2 * Math.tan((cam.fov * Math.PI) / 360))) * 1.08 / zoom + s.z;
  const el = +(q.get('el') || 8) * Math.PI / 180;
  cam.position.set(c.x, (ty ?? c.y) + Math.sin(el) * d, c.z + Math.cos(el) * d);
  cam.lookAt(c.x, ty ?? c.y, c.z);
}
frame(+(q.get('zoom') || 1), q.get('ty') ? +q.get('ty') : null);
let t = 0;
function step(n = 1, dt = 1 / 30) {
  for (let i = 0; i < n; i++) {
    t += dt; G.time = t; G.realTime = t; U.time.value = t;
    for (const r of rigs) { const s = typeof r.state === 'function' ? r.state(t) : r.state; r.update(dt, s); }
  }
}
function render() { renderer.render(scene, cam); }
let tris = 0;
const info = {};
for (const r of rigs) {
  let n = 0; r.root.traverse((o) => { if (o.isMesh && o.visible && o.geometry) { const g = o.geometry; const c = (g.index ? Math.min(g.index.count, g.drawRange.count) : g.attributes.position.count) / 3; n += c; } });
  info[r.key] = Math.round(n);
}
// simulate one rig for n steps: st(t) -> state, mv: velocity [vx, vz] (moves the root), yawRate
function sim(r, n, dt, st, mv = null, yawRate = 0) {
  for (let i = 0; i < n; i++) {
    t += dt; G.time = t; U.time.value = t;
    if (mv) { r.root.position.x += mv[0] * dt; r.root.position.z += mv[1] * dt; }
    if (yawRate) r.root.rotation.y += yawRate * dt;
    r.update(dt, typeof st === 'function' ? st(i * dt) : st);
  }
}
window.V = { THREE, G, C, rigs, scene, cam, step, render, frame, info, buildMs, sim, setAll(s) { for (const r of rigs) r.state = s; } };
step(10);
render();
renderer.info.autoReset = true;
window.V.ready = true;
document.getElementById('lab').textContent = 'build ' + buildMs.toFixed(0) + 'ms  draws ' + renderer.info.render.calls + '  tris ' + renderer.info.render.triangles;
