// Local tree viewer (dev only, not part of the game build): the real renderer, sky and toon
// materials over a flat lawn, for checking the trees of props.js from any side, from below
// and from inside the crown, near and far model side by side.
//   ?t=oak:0,pine:1   kind:variant of props.js TREES (a row of them)   far=1 the far models
//   both=1 near and far of each next to one another   gap spacing (m)   h hour   q quality tier
//   ex,ey,ez / lx,ly,lz  eye and look-at (default: a view of the whole row)   fov
//   atlas=1 shows the foliage atlas instead
import * as THREE from 'three';
import { G } from './src/core/context.js';
import { Renderer, SHADOW_LAYER } from './src/render/renderer.js';
import { Sky } from './src/world/sky.js';
import { toon, U, leafTexture } from './src/render/materials.js';
import { preloadModels } from './src/render/models.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? +q.get(k) : d);
G.settings.quality = q.get('q') || 'ultra';
const R = new Renderer(document.getElementById('game'));
G.renderer = R; G.scene = R.scene; G.camera = R.camera;
R.resize();
const sky = new Sky(R.scene);
G.world = { sky };
sky.setHour(num('h', 12));
await preloadModels();
const P = await import('./src/world/props.js');

const ground = new THREE.Mesh(new THREE.CircleGeometry(600, 48), toon(0x6f9a52, { noAO: true }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
R.scene.add(ground);

// the materials of Props (without the per-instance LOD fade, which needs instancing)
const leafy = { vertexColors: true, rim: 0.35, tex: 'bark', leafy: true, cards: true };
const MAT = {
  tree: toon(0xffffff, { ...leafy, sway: 0.028, swayBase: 2.4 }),
  fir: toon(0xffffff, { ...leafy, rim: 0.3, sway: 0.02, swayBase: 1.6 }),
  shrub: toon(0xffffff, { ...leafy, rim: 0.3, sway: 0.05, swayBase: 0 }),
  solid: toon(0xffffff, { vertexColors: true, rim: 0.3, tex: 'bark' }),
};
const matOf = (kind) => (kind.startsWith('pine') ? MAT.fir : kind === 'bush' ? MAT.shrub : kind === 'dead' ? MAT.solid : MAT.tree);

const items = [];
const gap = num('gap', 7), far = num('far', 0), both = num('both', 0), see = num('see', 0);
let x = 0;
const put = (kind, v, lod) => {
  const mat = matOf(kind);
  const m = new THREE.Mesh(P.TREES[kind][v](!!lod), mat);
  m.receiveShadow = true;
  // shadows as in the game: from the far model, in the shadow pass only
  if (kind !== 'bush') { const sh = new THREE.Mesh(P.TREES[kind][v](true), mat); sh.castShadow = true; sh.layers.set(SHADOW_LAYER); m.add(sh); }
  m.scale.set(1, kind === 'bush' ? 1 : 1.18, 1);
  m.position.x = x; x += gap;
  R.scene.add(m); items.push(m);
  return m;
};
for (const spec of (q.get('t') || 'oak:0').split(',')) {
  const [kind, v] = spec.split(':');
  if (both) { put(kind, +(v || 0), 0); put(kind, +(v || 0), 1); } else put(kind, +(v || 0), far);
}
for (const o of items) o.position.x -= (x - gap) / 2;

if (num('atlas', 0)) {
  const t = leafTexture();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ map: t, transparent: false }));
  m.material.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', 'vec4 _t = texture2D(map, vec2(vMapUv.x, 1.0 - vMapUv.y)); diffuseColor.rgb = mix(vec3(0.05, 0.1, 0.25), _t.rgb * vec3(0.5, 0.8, 0.4), _t.a);'); };
  m.position.set(0, 4.5, 3);
  R.scene.add(m);
}

const cam = R.camera;
cam.fov = num('fov', 50); cam.updateProjectionMatrix();
const span = Math.max(8, x);
const view = { eye: [num('ex', 0), num('ey', 3.2), num('ez', span * 0.9 + 6)], look: [num('lx', 0), num('ly', 4), num('lz', 0)] };
let last = performance.now(), frames = 0;
function frame() {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  G.realTime = now / 1000; G.time = G.realTime;
  U.time.value = G.time; U.wind.value = 1 + Math.sin(G.time * 0.3) * 0.35;
  cam.position.set(...view.eye); cam.lookAt(...view.look);
  cam.updateMatrixWorld();
  // see=1: foliage makes room as in the game, for a player standing 3.5 m in front of the camera
  if (see) {
    U.seeA.value.copy(cam.position);
    cam.getWorldDirection(U.seeB.value).multiplyScalar(3.5).add(cam.position); U.seeB.value.y = Math.max(1.3, U.seeB.value.y - 1.2);
    U.seeR.value = 2.1;
  }
  sky.update(dt, cam.position, 0, cam.position);
  R.render(dt);
  frames++;
}
setInterval(frame, 16);
const tris = () => items.map((m) => Math.round(m.geometry.index.count / 3));
window.__tv = { R, sky, cam, view, items, G, P, U, tris, get frames() { return frames; } };
