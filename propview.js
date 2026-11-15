// Local prop viewer (dev only, not part of the game build): the real renderer, sky and toon
// materials over a flat lawn, for checking props and rocks in the game's lighting.
//   ?p=dummy,fence:9,bench  builders from buildings.js (":" passes numeric arguments), "rock:<name>:<lod>" (names in ref/blender/props/rocks.py),
//                           "house:<id>" (authored houses, ids in src/world/world.js), "shrine:<element>[:r]", bellTower, moraTower, windmill, riftGate
//   h hour · yaw / pitch degrees · dist · ty look-at height · tx · q quality tier · gap spacing
import * as THREE from 'three';
import { G } from './src/core/context.js';
import { Renderer } from './src/render/renderer.js';
import { Sky } from './src/world/sky.js';
import { toon } from './src/render/materials.js';
import { preloadModels } from './src/render/models.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? +q.get(k) : d);
G.settings.quality = q.get('q') || 'ultra';
const R = new Renderer(document.getElementById('game'));
G.renderer = R; G.scene = R.scene; G.camera = R.camera;
R.resize();
const sky = new Sky(R.scene);
G.world = { sky };
sky.setHour(num('h', 14));
await preloadModels();
const B = await import('./src/world/buildings.js');
const P = await import('./src/world/props.js');

const ground = new THREE.Mesh(new THREE.CircleGeometry(600, 48), toon(0x6f9a52, { noAO: true }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
R.scene.add(ground);

const items = [];
let x = 0;
const gap = num('gap', 0.6);
for (const spec of (q.get('p') || 'dummy').split(',')) {
  const [name, ...args] = spec.split(':');
  let o;
  if (name === 'rock') {
    const geo = P.rockModel(args[0] || 'roundA', +(args[1] || 0));
    o = new THREE.Mesh(geo, P.rockMaterial());
    if (args[2]) o.scale.setScalar(+args[2]);
    o.castShadow = o.receiveShadow = true;
    const g = new THREE.Group(); g.add(o); o = g;
  } else {
    const a = args.map((v) => (v === '' ? undefined : +v));
    // set-dressing pieces take (parent, x, y, z, ...)
    if (['barrel', 'crate', 'hayBale'].includes(name)) { o = new THREE.Group(); B[name](o, 0, name === 'barrel' ? 0 : 0.35, 0, ...a); }
    else if (name === 'signpost') o = B.signpost([{ ry: 0.2 }, { ry: -2.5 }]);
    else if (name === 'woodpile') { o = new THREE.Group(); B.woodpile(o, 0, 0); }
    else if (name === 'planter') { o = new THREE.Group(); B.planter(o, 0, 0, Math.random, { stone: !!a[0] }); }
    else if (name === 'stall') o = B.stall(a[0] ? B.MAT.clothBlue : B.MAT.clothRed);
    else if (name === 'house') { o = B.house({ id: args[0], planter: false, woodpile: false }); o.position.y = -0.2; }   // authored house by id ("house:inn")
    else if (name === 'shrine') o = B.shrine(args[0] || 'frost', new THREE.Texture(), { ruined: args[1] === 'r' });
    else o = B[name](...a);
  }
  const box = new THREE.Box3().setFromObject(o);
  o.position.x = x - box.min.x;
  if (name === 'targetCrystal') o.position.y = 1.8;
  x += box.max.x - box.min.x + gap;
  R.scene.add(o); items.push(o);
  o.traverse((m) => { if (m.isMesh && m.material.isMeshToonMaterial) m.castShadow = true; });
}
for (const o of items) o.position.x -= (x - gap) / 2;
const all = new THREE.Box3(); for (const o of items) all.expandByObject(o);

const cam = R.camera;
cam.fov = num('fov', 30); cam.updateProjectionMatrix();
const view = { yaw: num('yaw', 25), pitch: num('pitch', 12), dist: num('dist', 0), tx: num('tx', 0), ty: num('ty', (all.max.y + all.min.y) / 2), tz: num('tz', 0) };
if (!view.dist) {
  const s = all.getSize(new THREE.Vector3());
  const t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  view.dist = Math.max(s.x / (2 * t * cam.aspect), s.y / (2 * t)) * 1.15 + s.z;
}
let last = performance.now(), frames = 0;
function frame() {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  G.realTime = now / 1000; G.time = G.realTime;
  const yaw = THREE.MathUtils.degToRad(view.yaw), pitch = THREE.MathUtils.degToRad(view.pitch);
  cam.position.set(view.tx + Math.sin(yaw) * Math.cos(pitch) * view.dist, view.ty + Math.sin(pitch) * view.dist, view.tz + Math.cos(yaw) * Math.cos(pitch) * view.dist);
  cam.lookAt(view.tx, view.ty, view.tz);
  cam.updateMatrixWorld();
  sky.update(dt, cam.position, 0, cam.position);
  R.render(dt);
  frames++;
}
setInterval(frame, 16);
const tris = () => { let n = 0; for (const o of items) o.traverse((m) => { if (m.isMesh && m.geometry) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return Math.round(n); };
window.__pv = { R, sky, cam, view, items, G, B, tris, get frames() { return frames; } };
// headless check: render with the given view and POST the canvas to a local collector
window.__pv.shot = async (name, v = {}) => {
  Object.assign(view, v);
  for (let i = 0; i < 4; i++) frame();
  const blob = await new Promise((r) => R.renderer.domElement.toBlob(r, 'image/jpeg', 0.93));
  await fetch(`http://127.0.0.1:5197/${name}.jpg`, { method: 'POST', mode: 'no-cors', body: blob });
};
