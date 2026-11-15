// Local terrain viewer (dev only, not part of the game build): the real renderer, sky and
// terrain without the rest of the world, for working on landforms and ground materials.
//   ?x=&z= camera position · y height above ground · lx=&lz= look-at point · ly its height
//   h hour · fov · q quality tier
// window.__tv.shot(name) posts the canvas to the local capture receiver (see AGENTS.md).
import * as THREE from 'three';
import { G } from './src/core/context.js';
import { U } from './src/render/materials.js';
import { Renderer } from './src/render/renderer.js';
import { Sky } from './src/world/sky.js';
import { Terrain } from './src/world/terrain.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? +q.get(k) : d);
G.settings.quality = q.get('q') || 'ultra';
const R = new Renderer(document.getElementById('game'));
G.renderer = R; G.scene = R.scene; G.camera = R.camera;
R.resize();
const terrain = new Terrain(1337);
R.scene.add(terrain.mesh);
const sky = new Sky(R.scene);
G.world = { sky, terrain };
// a blank burn map: nothing is on fire here
U.burnTex.value = new THREE.DataTexture(new Uint8Array(4), 1, 1);
U.burnTex.value.needsUpdate = true;
sky.setHour(num('h', 13));
const cam = R.camera;
cam.fov = num('fov', 58); cam.updateProjectionMatrix();
const view = { p: [num('x', 70), num('y', 14), num('z', 150)], l: [num('lx', 116), num('ly', 6), num('lz', 188)] };
function place() {
  cam.position.set(view.p[0], terrain.height(view.p[0], view.p[2]) + view.p[1], view.p[2]);
  cam.lookAt(view.l[0], terrain.height(view.l[0], view.l[2]) + view.l[1], view.l[2]);
  cam.updateMatrixWorld();
}
function frame(dt = 0.016) {
  G.realTime = performance.now() / 1000;
  place();
  sky.update(dt, cam.position, 0, cam.position);
  terrain.update(cam, 4);
  R.render(dt);
}
setInterval(frame, 16);
async function shot(name, p, l, hour) {
  if (p) view.p = p;
  if (l) view.l = l;
  if (hour != null) sky.setHour(hour);
  for (let i = 0; i < 40; i++) frame();
  const blob = await new Promise((r) => R.renderer.domElement.toBlob(r, 'image/jpeg', 0.9));
  await fetch('http://127.0.0.1:5197/' + name, { method: 'POST', mode: 'no-cors', body: blob });
  return blob.size;
}
window.__tv = { terrain, sky, R, cam, view, shot, G };
