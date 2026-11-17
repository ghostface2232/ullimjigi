// Local terrain viewer (dev only, not part of the game build): the real renderer, sky and
// terrain without the rest of the world, for working on landforms and ground materials.
//   ?x=&z= camera position · y height above ground · lx=&lz= look-at point · ly its height
//   h hour · fov · q quality tier · preset valley/village/cliff/frost/lake/outer · paused=1
// window.__tv.shot(name) returns a PNG blob; optional receiver=<own URL> posts it there.
import * as THREE from 'three';
import { G } from './src/core/context.js';
import { U } from './src/render/materials.js';
import { Renderer } from './src/render/renderer.js';
import { Sky } from './src/world/sky.js';
import { Terrain } from './src/world/terrain.js';
import { Water } from './src/world/water.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? +q.get(k) : d);
G.settings.quality = q.get('q') || 'ultra';
const R = new Renderer(document.getElementById('game'));
G.renderer = R; G.scene = R.scene; G.camera = R.camera;
R.resize();
const terrain = new Terrain(1337);
R.scene.add(terrain.mesh);
const sky = new Sky(R.scene);
const water = new Water(R.scene, terrain);
G.world = { sky, terrain, water };
// a blank burn map: nothing is on fire here
U.burnTex.value = new THREE.DataTexture(new Uint8Array(4), 1, 1);
U.burnTex.value.needsUpdate = true;
sky.setHour(num('h', 13));
const cam = R.camera;
cam.fov = num('fov', 58); cam.updateProjectionMatrix();
// Heights are offsets above the sampled ground, just like the game's cutscene cameras.
const presets = {
  valley: { p: [65, 55, 140], l: [0, 10, 0] },
  village: { p: [16, 3, 35], l: [4, 0.5, 15] },
  cliff: { p: [70, 14, 150], l: [116, 6, 188] },
  frost: { p: [-34, 10, -156], l: [-34, 0, -180] },
  lake: { p: [-43, 3, 69], l: [-85, 2, 55] },
  outer: { p: [44, 5, 285], l: [53, 12, 430] },
};
const preset = presets[q.get('preset')] || presets.cliff;
const view = { p: [num('x', preset.p[0]), num('y', preset.p[1]), num('z', preset.p[2])], l: [num('lx', preset.l[0]), num('ly', preset.l[1]), num('lz', preset.l[2])] };
function place() {
  cam.position.set(view.p[0], terrain.height(view.p[0], view.p[2]) + view.p[1], view.p[2]);
  cam.lookAt(view.l[0], terrain.height(view.l[0], view.l[2]) + view.l[1], view.l[2]);
  cam.updateMatrixWorld();
}
function frame(dt = 0.016) {
  G.time += dt; G.realTime += dt; U.time.value = G.time;
  place();
  sky.update(dt, cam.position, 0, cam.position);
  water.update(sky);
  terrain.update(cam, 4);
  R.render(dt);
}
let paused = q.has('paused');
setInterval(() => { if (!paused) frame(); }, 16);
frame(0);
async function shot(name, p, l, hour) {
  paused = true;
  if (p) view.p = p;
  if (l) view.l = l;
  if (hour != null) sky.setHour(hour);
  G.time = G.realTime = sky.cloudT = 0;
  sky.clouds.force = true;
  // Finish the same requested LOD before every capture, yielding between small jobs.
  // A timeout is an explicit failure, never an unnoticed picture of a coarse fallback.
  const deadline = performance.now() + 120000;
  place();
  do {
    terrain.update(cam, 12);
    await new Promise((r) => setTimeout(r, 0));
    if (performance.now() > deadline) throw new Error('Terrain capture is still building cliff detail');
  } while (terrain.jobs.length);
  frame(0); // establish the shadow maps used by the planar reflection
  frame(0); // capture in this task, before the default framebuffer can be cleared
  const blob = await new Promise((r) => R.renderer.domElement.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Terrain capture returned no image');
  const receiver = q.get('receiver');
  if (receiver) await fetch(new URL(name, receiver), { method: 'POST', mode: 'no-cors', body: blob });
  return blob;
}
window.__tv = { terrain, sky, water, R, cam, view, presets, shot, frame, G, setPaused: (value) => { paused = value; } };
