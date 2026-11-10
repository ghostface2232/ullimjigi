// Local sky viewer (dev only, not part of the game build): the real renderer and sky over a
// bare ground, for tuning clouds and the sky palette without booting the game.
//   ?h=13 hour · yaw / pitch in degrees · fov · y camera height · oc overcast 0..1
//   q quality tier · spin=1 turn slowly · speed time scale of the day
import * as THREE from 'three';
import { G } from './src/core/context.js';
import { Renderer } from './src/render/renderer.js';
import { Sky } from './src/world/sky.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? +q.get(k) : d);
G.settings.quality = q.get('q') || 'ultra';
const canvas = document.getElementById('game');
const R = new Renderer(canvas);
G.renderer = R; G.scene = R.scene; G.camera = R.camera;
R.resize();
const sky = new Sky(R.scene);
G.world = { sky };
sky.setHour(num('h', 13));
sky.overcast = num('oc', 0);
const ground = new THREE.Mesh(new THREE.CircleGeometry(2400, 48), new THREE.MeshLambertMaterial({ color: 0x6f9a52 }));
ground.rotation.x = -Math.PI / 2;
R.scene.add(ground);
const cam = R.camera;
cam.fov = num('fov', 58); cam.updateProjectionMatrix();
const view = { yaw: num('yaw', 0), pitch: num('pitch', 18), speed: num('speed', 0), spin: num('spin', 0) };
const pos = new THREE.Vector3(num('x', 0), num('y', 12), num('z', 0));
let last = performance.now();
function frame() {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  G.realTime = now / 1000;
  view.yaw += view.spin * dt * 6;
  cam.position.copy(pos);
  cam.rotation.set(THREE.MathUtils.degToRad(view.pitch), THREE.MathUtils.degToRad(-view.yaw), 0, 'YXZ');
  cam.updateMatrixWorld();
  sky.update(dt, pos, view.speed, pos);
  R.render(dt);
}
setInterval(frame, 16);
window.__sky = { sky, R, cam, view, pos, G };
