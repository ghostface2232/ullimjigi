// Water: depth-tinted body, wave normals from a moving height field, planar reflection of
// the world (top quality tier; the sky gradient otherwise), fresnel, sun glitter, caustic
// shimmer in the shallows, cloud shadows and animated shoreline foam.
import * as THREE from 'three';
import { U, noiseTexture } from '../render/materials.js';

const VS = `
varying vec3 vW;
#include <fog_pars_vertex>
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FS = `
uniform sampler2D uDepth; uniform float uHalf; uniform float uTime;
uniform sampler2D uNoiseTex;
uniform sampler2D tRefl;
uniform mat4 uReflMat;
uniform float uRefl;
uniform vec3 uShallow, uDeep, uFoam, uSunDir, uSunColor, uSky, uSkyTop;
uniform float uNight;
uniform vec4 uCloud;
varying vec3 vW;
#include <fog_pars_fragment>
// moving height field: three wave trains of different size crossing each other
float waveH(vec2 p){
  float h = texture2D(uNoiseTex, p * 0.011 + vec2(uTime * 0.004, uTime * 0.003)).r * 1.0;
  h += texture2D(uNoiseTex, p * 0.037 - vec2(uTime * 0.011, -uTime * 0.008)).g * 0.42;
  h += texture2D(uNoiseTex, p * 0.12 + vec2(uTime * 0.021, uTime * 0.017)).b * 0.16;
  return h;
}
void main(){
  vec2 uv = (vW.xz + uHalf) / (2.0 * uHalf);
  float depth = texture2D(uDepth, uv).r * 12.0 - 2.0;
  if (depth < -0.05) discard;
  vec2 p = vW.xz;
  vec3 V = normalize(cameraPosition - vW);
  float dist = length(cameraPosition - vW);
  // normal from the slope of the height field; ripples calm down in the distance and in the shallows
  float e = 0.35;
  float h0 = waveH(p), hx = waveH(p + vec2(e, 0.0)), hz = waveH(p + vec2(0.0, e));
  float amp = mix(1.0, 0.3, smoothstep(20.0, 160.0, dist)) * (0.35 + 0.65 * smoothstep(0.0, 1.5, depth));
  vec2 nd = vec2(h0 - hx, h0 - hz) / e * 0.55 * amp;
  vec3 N = normalize(vec3(nd.x, 1.0, nd.y));
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
  // cloud shadow on the surface
  vec2 q = p + uSunDir.xz * (160.0 / max(uSunDir.y, 0.25));
  float cloud = 1.0 - uCloud.w * smoothstep(0.5, 0.64, texture2D(uNoiseTex, (q + uCloud.xy) * uCloud.z).r);
  // body: turquoise shallows → deep blue, darker in cloud shadow
  float dk = smoothstep(0.0, 6.0, depth);
  vec3 body = mix(uShallow, uDeep, dk) * (0.72 + 0.28 * cloud);
  // caustic shimmer on the lake bed in the shallows
  float c1 = texture2D(uNoiseTex, p * 0.21 + vec2(uTime * 0.03, uTime * 0.02)).b;
  float c2 = texture2D(uNoiseTex, p * 0.26 - vec2(uTime * 0.025, -uTime * 0.03)).b;
  float caus = pow(1.0 - abs(c1 - c2) * 2.2, 8.0);
  body += uSunColor * caus * 0.35 * smoothstep(3.0, 0.4, depth) * smoothstep(0.0, 0.3, depth) * cloud * (1.0 - uNight);
  // what the surface mirrors: the world (planar reflection, bent by the waves) or the sky gradient
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSky, uSkyTop, smoothstep(0.0, 0.9, R.y) * 0.6);
  if (uRefl > 0.5) {
    vec4 rc = uReflMat * vec4(vW.x + nd.x * (0.7 + dist * 0.02), vW.y, vW.z + nd.y * (0.7 + dist * 0.02), 1.0);
    vec3 rf = texture2D(tRefl, clamp(rc.xy / rc.w, 0.002, 0.998)).rgb;
    sky = min(rf, vec3(6.0));
  }
  // a still lake mirrors more than physics alone would give it (this is the Mirror Lake), but
  // looking down into it the bed shows through instead of a patchwork of mirrored cloud
  vec3 col = mix(body, sky, uRefl > 0.5 ? clamp(0.1 + fres * 1.6, 0.0, 0.95) : clamp(fres + 0.1, 0.0, 1.0) * 0.7);
  // sun glitter: a soft sheen plus crisp glints on the wave crests
  float rs = max(dot(R, uSunDir), 0.0);
  col += uSunColor * (pow(rs, 90.0) * 0.5 + smoothstep(0.988, 0.994, rs) * 1.6) * cloud * (1.0 - uNight * 0.8);
  float sp = step(0.93, texture2D(uNoiseTex, p * 0.9 + nd * 0.6 + uTime * 0.05).a) * pow(rs, 5.0);
  col += uSunColor * sp * 0.9 * cloud * (1.0 - uNight);
  // shoreline foam: solid lip + bands rolling in towards the shore, broken by noise
  float fn = texture2D(uNoiseTex, p * 0.18 + vec2(uTime * 0.02, 0.0)).g;
  float band = sin(depth * 5.0 - uTime * 1.7 + fn * 5.0);
  float lip = smoothstep(0.42, 0.05, depth + (fn - 0.5) * 0.3);
  float bands = smoothstep(0.7, 0.95, band) * smoothstep(1.5, 0.25, depth) * smoothstep(0.35, 0.65, fn);
  float foam = clamp(lip + bands * 0.8, 0.0, 1.0);
  col = mix(col, uFoam * (0.75 + 0.25 * cloud), foam * 0.9);
  float alpha = clamp(0.5 + smoothstep(0.0, 2.2, depth) * 0.42 + foam * 0.4 + fres * 0.3, 0.0, 0.98);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}`;

const CELL = 64; // water lookup grid (m) for "is any water in view"
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3();
const _plane = new THREE.Plane(), _clip = new THREE.Vector4(), _q = new THREE.Vector4();
const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();

export class Water {
  constructor(scene, terrain) {
    this.level = 0;
    this.uni = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uDepth: { value: terrain.depthTexture() }, uHalf: { value: terrain.half }, uTime: { value: 0 },
      uShallow: { value: new THREE.Color(0x5fd0c8) }, uDeep: { value: new THREE.Color(0x1d5f96) },
      uFoam: { value: new THREE.Color(0xf4fbff) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) }, uSky: { value: new THREE.Color(0xbcd6ec) }, uSkyTop: { value: new THREE.Color(0x3f7fd8) },
      uNight: { value: 0 }, tRefl: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uRefl: { value: 0 },
    }]);
    this.uni.uTime = U.time;
    this.uni.uCloud = U.cloud;
    this.uni.uNoiseTex = { value: noiseTexture() };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uni, vertexShader: VS, fragmentShader: FS, transparent: true, fog: true, depthWrite: false });
    // wider than the map: the southern sea runs on to the horizon (the depth texture clamps
    // at the border, so only the open sea continues past it)
    const geo = new THREE.PlaneGeometry(terrain.size * 3, terrain.size * 3, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = this.level;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this._c = new THREE.Color();
    // cells of the map that hold open water, for the reflection pass's "is it needed" test
    this.cells = [];
    const T = terrain, n = Math.ceil(T.size / CELL), per = CELL / T.step;
    for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) {
      let wet = false;
      for (let iz = cz * per; iz <= Math.min(T.seg, (cz + 1) * per) && !wet; iz += 2) for (let ix = cx * per; ix <= Math.min(T.seg, (cx + 1) * per); ix += 2) if (T.h[iz * T.N + ix] < -0.15) { wet = true; break; }
      if (wet) this.cells.push(new THREE.Vector3(-T.half + (cx + 0.5) * CELL, 0, -T.half + (cz + 0.5) * CELL));
    }
    this.vcam = new THREE.PerspectiveCamera();
    this.frustum = new THREE.Frustum(); // the mirrored view (props keep what it sees, Props.update)
    this.reflecting = false;
  }

  // Is open water within reach of this view?
  inView(camera) {
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_pm);
    const p = camera.position;
    _sph.radius = CELL * 0.75;
    for (const c of this.cells) {
      if (Math.abs(c.x - p.x) > 520 || Math.abs(c.z - p.z) > 520) continue;
      _sph.center.copy(c);
      if (_fr.intersectsSphere(_sph)) return true;
    }
    // the southern sea runs past the map edge
    return p.z > 300 && camera.getWorldDirection(_f).z > -0.3;
  }

  // Planar reflection: draw the scene from the camera mirrored in the water plane into a
  // half-size target. Called by the renderer before the main pass. scale 0 = off.
  reflect(renderer, scene, camera, scale, w, h) {
    const on = scale > 0 && camera.position.y > this.level + 0.05 && this.inView(camera);
    this.uni.uRefl.value = on ? 1 : 0;
    this.reflecting = on;
    if (!on) return;
    const W = Math.max(4, Math.round(w * scale)), H = Math.max(4, Math.round(h * scale));
    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
      this.uni.tRefl.value = this.rt.texture;
    }
    if (this.rt.width !== W || this.rt.height !== H) this.rt.setSize(W, H);
    const v = this.vcam, L = this.level;
    camera.getWorldDirection(_f);
    _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    v.position.set(camera.position.x, 2 * L - camera.position.y, camera.position.z);
    v.up.set(_u.x, -_u.y, _u.z);
    v.lookAt(_t.set(v.position.x + _f.x, v.position.y - _f.y, v.position.z + _f.z));
    v.near = camera.near; v.far = camera.far;
    v.updateMatrixWorld();
    v.projectionMatrix.copy(camera.projectionMatrix);
    v.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    this.uni.uReflMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(v.projectionMatrix).multiply(v.matrixWorldInverse);
    _pm.multiplyMatrices(v.projectionMatrix, v.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(_pm);
    // oblique near plane (Lengyel): nothing below the surface gets into the mirror image
    _plane.setFromNormalAndCoplanarPoint(_u.set(0, 1, 0), _t.set(0, L - 0.12, 0)).applyMatrix4(v.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const pe = v.projectionMatrix.elements;
    _q.x = (Math.sign(_clip.x) + pe[8]) / pe[0];
    _q.y = (Math.sign(_clip.y) + pe[9]) / pe[5];
    _q.z = -1;
    _q.w = (1 + pe[10]) / pe[14];
    _clip.multiplyScalar(2 / _clip.dot(_q));
    pe[2] = _clip.x; pe[6] = _clip.y; pe[10] = _clip.z + 1; pe[14] = _clip.w;
    // the sun's shadow maps from the last main pass are reused as they are
    const auto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    this.mesh.visible = false;
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, v);
    this.mesh.visible = true;
    renderer.shadowMap.autoUpdate = auto;
  }

  update(sky) {
    const u = this.uni;
    u.uSunDir.value.copy(sky.uni.uSunDir.value);
    u.uSunColor.value.copy(sky.sun.color).multiplyScalar(Math.min(1.2, sky.sun.intensity * 0.45));
    u.uSky.value.copy(sky.uni.uHorizon.value);
    u.uSkyTop.value.copy(sky.uni.uTop.value).lerp(sky.uni.uHorizon.value, 0.25);
    u.uNight.value = sky.night;
    const n = sky.night;
    u.uShallow.value.setHex(0x4fc4be).lerp(this._c.setHex(0x1f4a5a), n * 0.8);
    u.uDeep.value.setHex(0x1a5a92).lerp(this._c.setHex(0x0a1830), n * 0.8);
    u.uFoam.value.setHex(0xeef8ff).multiplyScalar(1 - n * 0.6);
  }
}
