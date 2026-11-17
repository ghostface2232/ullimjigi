// Local character viewer (dev only, not part of the game build).
import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { G } from './src/core/context.js';
import { U, toon } from './src/render/materials.js';
import * as HR from './src/game/humanrig.js';
import { preloadModels } from './src/render/models.js';
import { Renderer } from './src/render/renderer.js';

await preloadModels();

// ?wip: load work-in-progress models from ref/blender/wip/ instead of public/models/
if (new URLSearchParams(location.search).has('wip')) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  for (const k of Object.keys(HR.CHAR)) {
    try { HR.MODEL_OVERRIDE[k] = await new GLTFLoader().loadAsync(`./ref/blender/wip/ch_${k}.glb?t=${Date.now()}`); } catch (_) { /* no wip model */ }
  }
}

// people always load; a creature or enemy module that fails to load (mid-edit) only drops its own set
const C = { ...HR };
for (const load of [() => import('./src/game/creatures.js'), () => import('./src/game/enemybodies.js'), () => import('./src/game/enemycreatures.js')]) {
  try { Object.assign(C, await load()); } catch (e) { console.warn('charview: module failed to load', e); }
}

const q = new URLSearchParams(location.search);
const pipelineOn = q.has('pipeline');
const W = pipelineOn ? innerWidth : +(q.get('w') || 960), H = pipelineOn ? innerHeight : +(q.get('h') || 540);
G.settings.quality = q.get('q') || 'high';
const pipeline = pipelineOn ? new Renderer(document.createElement('canvas')) : null;
const renderer = pipeline ? pipeline.renderer : new THREE.WebGLRenderer({ antialias: true });
if (!pipeline) { renderer.setSize(W, H); renderer.setPixelRatio(1); }
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 0.92;
if (!pipeline) renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = pipeline ? pipeline.scene : new THREE.Scene();
scene.background = new THREE.Color(0x9cc4e0);
const cam = pipeline ? pipeline.camera : new THREE.PerspectiveCamera(30, W / H, 0.05, 200);
cam.fov = 30; cam.near = 0.05; cam.far = 200; cam.updateProjectionMatrix();
G.scene = scene; G.camera = cam;
if (pipeline) G.renderer = pipeline;
const sun = new SunLight(0xffffff, 2.5);   // the game's key light, so the toon and skin shading match
const sd = new THREE.Vector3(0.45, 0.8, 0.55).normalize();
sun.position.copy(sd); sun.castShadow = true;
sun.shadow.bias = -0.00022; sun.shadow.normalBias = 0.05; sun.shadow.radius = 3.2; sun.shadow.camera.far = 40;
scene.add(sun);
U.sunDir.value.copy(sd);
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x7a8a5a, 1.2);
scene.add(hemi);
function light(night = false) {
  scene.background.set(night ? 0x142139 : 0x9cc4e0);
  sun.color.set(night ? 0xb4caff : 0xffffff); sun.intensity = night ? 0.45 : 2.5;
  hemi.color.set(night ? 0x6b83b4 : 0xbfd8ff); hemi.groundColor.set(night ? 0x424452 : 0x7a8a5a); hemi.intensity = night ? 0.4 : 1.2;
  U.rimColor.value.copy(sun.color).multiplyScalar(night ? 0.22 : 0.9);
  U.skyRefl.value.set(night ? 0x45577e : 0xa4bfdf);
  U.cloud.value.w = 0;
}
light(q.has('night'));
if (pipeline) pipeline.grade.uniforms.uSat.value = +(q.get('sat') || 1.12);
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
function can(key) {
  if (CHAR_OK(key) || key.startsWith('ghost')) return true;
  if (key === 'fox') return !!C.makeFox;
  if (key === 'cat') return !!C.makeCat;
  return !!C.makeKnight && !!C.makeWailer;
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
  if (!can(k)) continue;
  const n = views ? views.split(',').length : 1;
  for (let i = 0; i < n; i++) {
    const r = make(k);
    const box = new THREE.Box3().setFromObject(r.root);
    const w = (Math.max(0.6, box.max.x - box.min.x) * 1.05 + 0.25) * +(q.get('sp') || 1);   // sp < 1 packs the views (head close-ups)
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
function render() {
  if (pipeline) {
    renderer.info.autoReset = false; renderer.info.reset();
    pipeline.render(1 / 60);
    renderer.info.autoReset = true;
  } else renderer.render(scene, cam);
}
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
// orbit the camera about a point (yaw 0 = in front of a character facing +Z)
function look(x, y, z, dist, yaw = 0, el = 0, fov = 30) {
  const a = (yaw * Math.PI) / 180, e = (el * Math.PI) / 180;
  cam.fov = fov; cam.updateProjectionMatrix();
  cam.position.set(x + Math.sin(a) * Math.cos(e) * dist, y + Math.sin(e) * dist, z + Math.cos(a) * Math.cos(e) * dist);
  cam.lookAt(x, y, z);
}
// post the canvas to the local capture receiver (dev tooling)
async function shot(name) {
  render();
  // Pass an explicit receiver belonging to this viewer's operator; no shared capture port.
  const receiver = q.get('receiver');
  if (!receiver) return renderer.domElement.toDataURL('image/png');
  const blob = await new Promise((r) => renderer.domElement.toBlob(r, 'image/jpeg', 0.93));
  await fetch(receiver.replace(/\/$/, '') + '/' + name + '.jpg', { method: 'POST', mode: 'no-cors', body: blob });
  return name;
}
function setSun(x, y, z) { sd.set(x, y, z).normalize(); sun.position.copy(sd); U.sunDir.value.copy(sd); }
// Deterministic motion bench. All time comes from fixed simulation steps; samples
// include solved ankles as well as the contact targets, so a locked target alone
// cannot conceal an unreachable/sliding foot. No wall clock or rAF is involved.
const motion = { name: '', time: 0, trace: [], follow: true };
const floor = (x, z) => motion.name === 'slope' ? z * 0.32 + x * 0.1 : motion.name === 'stairs' ? Math.max(0, Math.min(8, Math.floor((z + 1) / 0.65))) * 0.12 : 0;
const steps = new THREE.Group(); scene.add(steps);
function terrain() {
  ground.visible = motion.name !== 'stairs';
  ground.rotation.x = -Math.PI / 2;
  ground.rotation.y = ground.rotation.z = 0;
  const gp = ground.geometry.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setZ(i, motion.name === 'slope' ? floor(gp.getX(i), -gp.getY(i)) : 0);
  gp.needsUpdate = true; ground.geometry.computeVertexNormals(); ground.geometry.computeBoundingSphere();
  for (const m of [...steps.children]) { steps.remove(m); m.geometry.dispose(); }
  if (motion.name === 'stairs') for (let i = -12; i < 32; i++) {
    const z = (i + 0.5) * 0.65 - 1, h = floor(0, z);
    const m = new THREE.Mesh(new THREE.BoxGeometry(8, h + 0.15, 0.65), ground.material);
    m.position.set(0, (h - 0.15) / 2, z); m.receiveShadow = true; steps.add(m);
  }
  G.world = { ground: (x, z) => floor(x, z), h: floor };
}
motion.start = (name = 'flat') => {
  motion.name = name; motion.time = 0; motion.trace = []; terrain();
  for (const r of rigs) {
    r.root.position.set(0, r.key === 'fox' ? 1.3 : 0, 0); r.root.rotation.set(0, 0, 0);
    r.prevPos = null; r.prevYaw = 0; r.yawRate = 0; r.vel?.set(0, 0, 0); r.acc?.set(0, 0, 0);
    if (r.feet) for (const f of r.feet) f.init = false;
    for (const ch of r.chains || []) ch.init = false;
    r.phase = 0; r.gestures?.splice(0);
    if (r.p.staff) {
      const g = r.p.staff; r.B.handR.add(g); g.position.set(-0.004, -r.L.hand * 0.36, 0.004); g.quaternion.identity(); g.scale.setScalar(1);
      r.stowed = false; r.stowK = 1;
    }
    r.t = 0;
    if (r.idle) Object.assign(r.idle, { side: 1, sideV: 1, sideT: 20, breath: 0, fidT: 30 });
    if (r.cast) { r.cast.wt = -1; r.cast.rt = 9; r.cast.clip = null; }
    for (const sp of [r.land, r.drive, r.bank, r.castSp]) if (sp) sp.x = sp.v = 0;
    if (r.w) for (const k of Object.keys(r.w)) r.w[k] = 0;
    r.prevGrounded = true; r.ikW = 1; r.pelvisDrop = 0;
    r.update(1 / 60, { grounded: true });
  }
  render(); return name;
};
motion.step = (n = 1, dt = 1 / 60) => {
  for (let i = 0; i < n; i++) {
    const prev = motion.time; motion.time += dt; const at = motion.time, name = motion.name;
    t += dt; G.time = t; G.realTime = t; U.time.value = t;
    for (const r of rigs) {
      let speed = 0, yaw = 0, vy = 0, grounded = true;
      const state = {};
      if (['flat', 'slope', 'stairs', 'transition', 'fox'].includes(name)) {
        speed = at < 0.3 ? 0 : at < 0.7 ? (at - 0.3) / 0.4 * 1.4 : at < 1.7 ? 1.4 : at < 2 ? 1.4 + (at - 1.7) / 0.3 * 4.2 : 5.6;
        if (name === 'transition') { yaw = Math.PI * 0.5 * THREE.MathUtils.smoothstep(at, 2.2, 2.8); speed *= 1 - THREE.MathUtils.smoothstep(at, 3, 3.45); }
      }
      if (name === 'landing' || name === 'jump') {
        const a = at - 0.35, v = name === 'jump' ? 9.6 : 0, y0 = name === 'jump' ? 0 : 4;
        const y = y0 + v * a - 13 * a * a;
        grounded = name === 'jump' && a < 0 || a >= 0 && y <= 0; vy = grounded || a < 0 ? 0 : v - 26 * a;
        r.root.position.y = grounded ? 0 : a < 0 ? y0 : y;
      }
      if (['glide', 'swim', 'climb', 'mantle', 'dodge'].includes(name)) {
        state.glide = name === 'glide'; state.swim = name === 'swim'; state.climb = name === 'climb' || name === 'mantle';
        grounded = name === 'dodge'; speed = name === 'dodge' && at > 0.35 && at < 0.51 ? 42 : 0;
        state.dash = speed > 16; state.climbMove = 1; state.climbPhase = at * 0.8;
        state.mantle = name === 'mantle' ? Math.min(1, at / 1.5) : 0; vy = name === 'glide' ? -2.6 : 0;
        r.root.position.y = name === 'glide' ? 1.2 : 0;
      }
      if (name === 'cast') {
        state.cast = at > 0.3 && at < 2.7; state.aimPitch = 0.12;
        if (prev < 0.35 && at >= 0.35) r.windup('heavy', 0.2, 'fire');
        if (prev < 0.55 && at >= 0.55) r.flick('heavy', 'fire');
        if (prev < 1.5 && at >= 1.5) r.windup('ult', 0.4, 'arcane');
        if (prev < 1.9 && at >= 1.9) r.flick('ult', 'arcane');
      }
      if (name === 'talk') state.talk = true;
      r.root.rotation.y = yaw;
      r.root.position.x += Math.sin(yaw) * speed * dt; r.root.position.z += Math.cos(yaw) * speed * dt;
      if (['flat', 'slope', 'stairs', 'transition'].includes(name)) r.root.position.y = floor(r.root.position.x, r.root.position.z);
      r.update(dt, { ...state, speed, grounded, vy }); r.root.updateMatrixWorld(true);
      const row = { time: at, key: r.key, root: r.root.position.toArray(), speed, grounded, plants: r.footPlants?.map(f => f.n) || [], feet: [] };
      for (const f of r.feet || []) {
        const ankle = r.B['foot' + f.n].getWorldPosition(new THREE.Vector3()), target = r.ankleOf(f, new THREE.Vector3());
        row.feet.push({ side: f.n, planted: f.planted && !f.stepping && grounded && r.ikW > 0.99, sole: f.pos.toArray(), ankle: ankle.toArray(), target: target.toArray(), error: ankle.distanceTo(target), pitch: f.pitch, slopePitch: f.slopePitch || 0 });
      }
      motion.trace.push(row);
    }
  }
  if (motion.follow && rigs[0]) {
    const p = rigs[0].root.position;
    look(p.x, p.y + 0.95, p.z, rigs[0].key === 'fox' ? 4 : 5.7, 38, 6, 30);
  }
  render(); return motion.trace.at(-1);
};
window.V = { THREE, G, C, rigs, scene, cam, step, render, frame, info, buildMs, sim, look, shot, setSun, light, renderer, pipeline, motion, setAll(s) { for (const r of rigs) r.state = s; } };
step(10);
render();
if (q.has('motion')) { motion.start(q.get('motion')); motion.step(Math.max(0, Math.min(600, +(q.get('frame') || 0)))); }
renderer.info.autoReset = true;
window.V.ready = true;
document.getElementById('lab').textContent = 'build ' + buildMs.toFixed(0) + 'ms  draws ' + renderer.info.render.calls + '  tris ' + renderer.info.render.triangles;
