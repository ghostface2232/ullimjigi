// Water: depth-tinted body, wave normals from a moving height field, planar reflection of
// the world (top quality tier; the sky gradient otherwise), fresnel, sun glitter, caustic
// shimmer in the shallows, cloud shadows and animated shoreline foam.
import * as THREE from 'three';
import { U, noiseTexture } from '../render/materials.js';
import { CLOUD, CLOUD_SHADOW } from '../render/clouds.js';

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
const float C_MID = ${CLOUD.mid.toFixed(1)}, DOME_S = ${CLOUD.domeS.toFixed(3)};
uniform sampler2D uDepth; uniform float uHalf; uniform float uTime;
uniform sampler2D uNoiseTex;
uniform sampler2D uBed;
uniform vec4 uHeightP;
uniform sampler2D tRefl;
uniform mat4 uReflMat;
uniform float uRefl;
uniform vec2 uReflMax;
uniform vec3 uShallow, uDeep, uFoam, uSunDir, uSunColor, uSky, uSkyTop, uCloudLight;
uniform float uNight, uSunVisible, uValleyLight;
uniform sampler2D uCloudDome;
uniform vec3 uCloudLit, uCloudShade, uCloudSnap;
uniform vec2 uCloudDrift;
uniform vec4 uCloud;
varying vec3 vW;
${CLOUD_SHADOW}
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
  // Keep the broad sky reflection continuous across the lake. Short facets
  // remain legible at the bank and lose contrast towards the opposite shore.
  amp *= 1.0 - uValleyLight * (0.16 + 0.40 * smoothstep(10.0, 70.0, dist));
  vec2 nd = vec2(h0 - hx, h0 - hz) / e * 0.55 * amp;
  vec3 N = normalize(vec3(nd.x, 1.0, nd.y));
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
  // cloud shadow on the surface
  float cloud = landscapeCloudShadow(vW, uCloudLight, uCloud.w);
  // Refract the view ray onto the heightfield bed. This is terrain-only refraction, so
  // it needs no scene copy and never samples an above-water object through the lake.
  vec3 through = refract(-V, N, 0.75);
  vec2 bedP = p + through.xz * min(max(depth, 0.0), 8.0) / max(-through.y, 0.3);
  vec2 bedUV = (bedP + uHalf) / (2.0 * uHalf);
  if (texture2D(uDepth, bedUV).r * 12.0 - 2.0 < 0.0) bedP = p;
  vec3 bed = texture2D(uBed, (bedP + uHeightP.x) * uHeightP.y + uHeightP.z).rgb;
  // Red light is absorbed first; the bed falls gradually into a cool, quiet deep body.
  vec3 transmission = exp(-max(depth, 0.0) * vec3(0.58, 0.24, 0.17));
  bed *= mix(vec3(0.14, 0.22, 0.36), vec3(0.72) + uSunColor * 0.3, 1.0 - uNight);
  vec3 body = bed * transmission + mix(uShallow, uDeep, 1.0 - exp(-max(depth, 0.0) * 0.28)) * (1.0 - transmission);
  body *= 0.72 + 0.28 * cloud;
  // caustic shimmer on the lake bed in the shallows
  float c1 = texture2D(uNoiseTex, p * 0.21 + vec2(uTime * 0.03, uTime * 0.02)).b;
  float c2 = texture2D(uNoiseTex, p * 0.26 - vec2(uTime * 0.025, -uTime * 0.03)).b;
  float caus = pow(max(1.0 - abs(c1 - c2) * 2.2, 0.0), 8.0);
  body += uSunColor * caus * 0.13 * (1.0 - smoothstep(0.4, 3.0, depth)) * smoothstep(0.0, 0.3, depth) * cloud * (1.0 - uNight);
  // what the surface mirrors: the world (planar reflection, bent by the waves) or the sky gradient
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSky, uSkyTop, pow(smoothstep(0.0, 0.8, R.y), 0.5));
  // On tiers without a mirror pass, reflect the same cloud dome rather than a flat band.
  if (uRefl < 0.5 && R.y > 0.02) {
    float travel = (C_MID - vW.y) / max(R.y, 0.03);
    vec3 aim = normalize(vW + R * travel + vec3(uCloudDrift.x, 0.0, uCloudDrift.y) - uCloudSnap);
    vec4 cl = texture2D(uCloudDome, aim.xz / (1.0 + max(aim.y, 0.0)) * (0.5 * DOME_S) + 0.5);
    vec3 k = cl.rgb / max(cl.a, 0.004);
    float tone = smoothstep(0.18, 0.78, k.r) * (0.6 + 0.4 * smoothstep(0.05, 0.65, k.g));
    vec3 cc = mix(uCloudShade, uCloudLit, tone);
    sky = mix(sky, cc, smoothstep(0.02, 0.84, cl.a) * (1.0 - smoothstep(0.82, 1.0, k.b)));
  }
  if (uRefl > 0.5) {
    vec4 rc = uReflMat * vec4(vW.x + nd.x * (0.7 + dist * 0.02), vW.y, vW.z + nd.y * (0.7 + dist * 0.02), 1.0);
    vec3 rf = texture2D(tRefl, clamp(rc.xy / rc.w, vec2(0.002), uReflMax)).rgb;
    sky = rf;
  }
  // a still lake mirrors more than physics alone would give it (this is the Mirror Lake), but
  // looking down into it the bed shows through instead of a patchwork of mirrored cloud
  // Compress reflected HDR energy by one scalar, preserving hue instead of clipping RGB.
  float reflectionPeak = max(sky.r, max(sky.g, sky.b));
  sky /= 1.0 + max(reflectionPeak - 0.65, 0.0) * 0.8;
  vec3 col = mix(body, sky, clamp(0.04 + fres * 0.86, 0.04, 0.9));
  // sun glitter: a soft sheen plus crisp glints on the wave crests
  float rs = max(dot(R, uSunDir), 0.0);
  float sp = step(0.96, texture2D(uNoiseTex, p * 0.9 + nd * 0.6 + uTime * 0.05).a) * pow(rs, 12.0);
  vec3 glint = uSunColor * (pow(rs, 180.0) * 0.18 + smoothstep(0.998, 0.9995, rs) * 0.5 + sp * 0.12) * cloud * uSunVisible * (1.0 - uNight);
  glint *= 0.7 / (0.7 + max(glint.r, max(glint.g, glint.b)));
  col += glint;
  // shoreline foam: solid lip + bands rolling in towards the shore, broken by noise
  float fn = texture2D(uNoiseTex, p * 0.18 + vec2(uTime * 0.02, 0.0)).g;
  float band = sin(depth * 6.5 - uTime * 1.15 + fn * 3.0);
  float edgeAA = max(fwidth(depth), 0.025);
  float lip = 1.0 - smoothstep(0.06 - edgeAA, 0.18 + edgeAA, depth + (fn - 0.5) * 0.16);
  float bands = smoothstep(0.78, 0.96, band) * (1.0 - smoothstep(0.25, 1.25, depth)) * smoothstep(0.32, 0.64, fn);
  float foam = clamp(lip * (0.5 + 0.5 * fn) + bands * 0.55, 0.0, 1.0);
  col = mix(col, uFoam * (0.75 + 0.25 * cloud), foam * 0.9);
  float alpha = smoothstep(-0.04, 0.16, depth) * clamp(0.88 + foam * 0.1 + fres * 0.12, 0.0, 0.98);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}`;

const CELL = 64; // water lookup grid (m) for "is any water in view"
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3();
const _plane = new THREE.Plane(), _clip = new THREE.Vector4(), _q = new THREE.Vector4();
const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();
const _win = new THREE.Matrix4(), _box = [0, 0, 0, 0];
const _cq = [0, 1, 2, 3].map(() => new THREE.Vector4());

export class Water {
  constructor(scene, terrain) {
    this.level = 0;
    this.uni = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uDepth: { value: terrain.depthTexture() }, uHalf: { value: terrain.half }, uTime: { value: 0 },
      uShallow: { value: new THREE.Color(0x5fd0c8) }, uDeep: { value: new THREE.Color(0x1d5f96) },
      uFoam: { value: new THREE.Color(0xf4fbff) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) }, uSky: { value: new THREE.Color(0xbcd6ec) }, uSkyTop: { value: new THREE.Color(0x3f7fd8) },
      uNight: { value: 0 }, tRefl: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uRefl: { value: 0 }, uReflMax: { value: new THREE.Vector2(0.998, 0.998) },
    }]);
    this.uni.uCloudDome = { value: null };
    this.uni.uCloudLit = { value: new THREE.Color() }; this.uni.uCloudShade = { value: new THREE.Color() };
    this.uni.uCloudSnap = { value: new THREE.Vector3() }; this.uni.uCloudDrift = { value: new THREE.Vector2() };
    this.uni.uSunVisible = { value: 0 };
    this.uni.uTime = U.time;
    this.uni.uCloud = U.cloud;
    this.uni.uCloudLayout = U.cloudLayout;
    this.uni.uCloudWind = U.cloudWind;
    this.uni.uCloudLight = U.sunDir;
    this.uni.uValleyLight = U.valleyLight;
    this.uni.uBed = U.groundTex;
    this.uni.uHeightP = U.heightP;
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
    // each also keeps the box of its wet samples, which bounds the reflection's window
    for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      let wet = false;
      for (let iz = cz * per; iz <= Math.min(T.seg, (cz + 1) * per); iz += 2) for (let ix = cx * per; ix <= Math.min(T.seg, (cx + 1) * per); ix += 2) {
        const h = T.h[iz * T.N + ix];
        if (h < -0.15) wet = true;
        if (h >= 0.05) continue; // the shader draws water up to about here
        const x = -T.half + ix * T.step, z = -T.half + iz * T.step;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
      if (!wet) continue;
      const c = new THREE.Vector3(-T.half + (cx + 0.5) * CELL, 0, -T.half + (cz + 0.5) * CELL);
      c.box = [x0, z0, x1, z1];
      // water at the map's edge runs on past it (the sea): such a cell opens the whole view
      c.open = x0 <= -T.half + 4 || z0 <= -T.half + 4 || x1 >= T.half - 4 || z1 >= T.half - 4;
      this.cells.push(c);
    }
    this.vcam = new THREE.PerspectiveCamera();
    this.frustum = new THREE.Frustum(); // the mirrored view (props keep what it sees, Props.update)
    this.reflecting = false;
    this.seen = []; // wet cells in the last view
    this.skip = []; // objects left out of the mirrored view
    this.sea = false;
  }

  // Is open water within reach of this view? Keeps the wet cells it sees for window().
  inView(camera) {
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_pm);
    const p = camera.position, seen = this.seen;
    seen.length = 0;
    _sph.radius = CELL * 0.75;
    for (const c of this.cells) {
      if (Math.abs(c.x - p.x) > 520 || Math.abs(c.z - p.z) > 520) continue;
      _sph.center.copy(c);
      if (_fr.intersectsSphere(_sph)) seen.push(c);
    }
    // the southern sea runs past the map edge
    this.sea = p.z > 300 && camera.getWorldDirection(_f).z > -0.3;
    return seen.length > 0 || this.sea;
  }

  // Where water can show in the mirror image: the outline of the wet boxes in view on the
  // water plane through the mirror camera m (the frame the target is drawn and read in),
  // clipped to the near plane, as an NDC box. false = the whole view (the open sea).
  window(m) {
    if (this.sea || this.seen.some((c) => c.open)) return false;
    const e = m.elements, L = this.level, M = 2 * 2 + 6, EPS = 0.05; // sample spacing + wave lookup offset
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y, w) => { x /= w; y /= w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    for (const c of this.seen) {
      for (let i = 0; i < 4; i++) {
        const B = c.box, x = i === 1 || i === 2 ? B[2] + M : B[0] - M, z = i >= 2 ? B[3] + M : B[1] - M;
        _cq[i].set(e[0] * x + e[4] * L + e[8] * z + e[12], e[1] * x + e[5] * L + e[9] * z + e[13], 0, e[3] * x + e[7] * L + e[11] * z + e[15]);
      }
      for (let i = 0; i < 4; i++) {
        const a = _cq[i], b = _cq[(i + 1) & 3];
        if (a.w > EPS) add(a.x, a.y, a.w);
        if ((a.w > EPS) !== (b.w > EPS)) { const t = (EPS - a.w) / (b.w - a.w); add(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, EPS); }
      }
    }
    _box[0] = Math.max(-1, x0); _box[1] = Math.max(-1, y0); _box[2] = Math.min(1, x1); _box[3] = Math.min(1, y1);
    return _box;
  }

  // Planar reflection: draw the scene from the camera mirrored in the water plane into a
  // half-size target. Called by the renderer before the main pass. scale 0 = off.
  // Only the window where water can show is drawn: three then also culls everything the
  // window cannot see, which is most of the scene unless the camera looks over the lake.
  reflect(renderer, scene, camera, scale, w, h) {
    const off = () => { this.uni.uRefl.value = 0; this.reflecting = false; };
    if (!(scale > 0 && camera.position.y > this.level + 0.05 && this.inView(camera))) return off();
    const W = Math.max(4, Math.round(w * scale)), H = Math.max(4, Math.round(h * scale));
    const v = this.vcam, L = this.level;
    camera.getWorldDirection(_f);
    _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    v.position.set(camera.position.x, 2 * L - camera.position.y, camera.position.z);
    v.up.set(_u.x, -_u.y, _u.z);
    v.lookAt(_t.set(v.position.x + _f.x, v.position.y - _f.y, v.position.z + _f.z));
    v.near = camera.near; v.far = camera.far;
    v.updateMatrixWorld();
    v.projectionMatrix.copy(camera.projectionMatrix);
    // the window in whole target pixels (2 px apron for filtering), then exactly that sub-frustum
    _pm.multiplyMatrices(v.projectionMatrix, v.matrixWorldInverse);
    const box = this.window(_pm);
    let px0 = 0, py0 = 0, px1 = W, py1 = H;
    if (box) {
      px0 = Math.max(0, Math.floor((box[0] * 0.5 + 0.5) * W) - 2); px1 = Math.min(W, Math.ceil((box[2] * 0.5 + 0.5) * W) + 2);
      py0 = Math.max(0, Math.floor((box[1] * 0.5 + 0.5) * H) - 2); py1 = Math.min(H, Math.ceil((box[3] * 0.5 + 0.5) * H) + 2);
    }
    if (px1 - px0 < 4 || py1 - py0 < 4) return off();
    this.uni.uRefl.value = 1;
    this.reflecting = true;
    if (!this.rt) {
      this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
      this.rt.scissorTest = true;
      this.uni.tRefl.value = this.rt.texture;
    }
    if (this.rt.width !== W || this.rt.height !== H) this.rt.setSize(W, H);
    const sw = px1 - px0, sh = py1 - py0;
    const nx0 = px0 / W * 2 - 1, nx1 = px1 / W * 2 - 1, ny0 = py0 / H * 2 - 1, ny1 = py1 / H * 2 - 1;
    v.projectionMatrix.premultiply(_win.set(
      2 / (nx1 - nx0), 0, 0, -(nx1 + nx0) / (nx1 - nx0),
      0, 2 / (ny1 - ny0), 0, -(ny1 + ny0) / (ny1 - ny0),
      0, 0, 1, 0, 0, 0, 0, 1));
    v.projectionMatrixInverse.copy(v.projectionMatrix).invert();
    // the window fills [0, sw/W] x [0, sh/H] of the target
    const fx = sw / W, fy = sh / H;
    this.rt.viewport.set(0, 0, sw, sh);
    this.rt.scissor.set(0, 0, sw, sh);
    this.uni.uReflMax.value.set(fx - 0.5 / W, fy - 0.5 / H);
    this.uni.uReflMat.value.set(0.5 * fx, 0, 0, 0.5 * fx, 0, 0.5 * fy, 0, 0.5 * fy, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(v.projectionMatrix).multiply(v.matrixWorldInverse);
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
    const shown = this.skip.map((o) => { const s = o.visible; o.visible = false; return s; });
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, v);
    this.skip.forEach((o, i) => { o.visible = shown[i]; });
    this.mesh.visible = true;
    renderer.shadowMap.autoUpdate = auto;
  }

  update(sky) {
    // Shared uniform objects see the cloud map published later in the same render frame.
    this.uni.uCloudDome = sky.clouds.uni.uCloudMap;
    this.uni.uCloudSnap = sky.clouds.uni.uSnapCam; this.uni.uCloudDrift = sky.clouds.uni.uDrift;
    this.uni.uCloudLit = sky.uni.uCloud; this.uni.uCloudShade = sky.uni.uCloudShade;
    this.uni.uSunVisible = sky.uni.uSunVis;
    const u = this.uni;
    u.uSunDir.value.copy(sky.uni.uSunDir.value);
    u.uSunColor.value.copy(sky.sun.color).multiplyScalar(Math.min(1.2, sky.sun.intensity * 0.45));
    u.uSky.value.copy(sky.uni.uHorizon.value);
    u.uSkyTop.value.copy(sky.uni.uTop.value);
    u.uNight.value = sky.night;
    const n = sky.night;
    u.uShallow.value.setHex(0x58b7ad).lerp(this._c.setHex(0x1f4a5a), n * 0.8);
    u.uDeep.value.setHex(0x245c83).lerp(this._c.setHex(0x0a1830), n * 0.8);
    u.uFoam.value.setHex(0xdceaf0).multiplyScalar(1 - n * 0.72);
  }
}
