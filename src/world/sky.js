// Painted sky dome + day/night lighting controller. Also drives the shared
// lighting uniforms (cloud shadows, cool shade tint, aerial fog) and draws
// distant mountain-range silhouettes on the horizon.
import * as THREE from 'three';
import { U, FOG, noiseTexture } from '../render/materials.js';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { lerp, clamp, smoothstep, createNoise2D, ridged } from '../core/util.js';
import { POI } from './layout.js';
import { tier } from '../render/quality.js';
import { Clouds, CLOUD } from '../render/clouds.js';

const SKY_VS = `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FS = `
const float C_MID = ${CLOUD.mid.toFixed(1)}, C_FAR = ${CLOUD.far.toFixed(1)}, DOME_S = ${CLOUD.domeS.toFixed(3)};
uniform vec3 uTop, uHorizon, uBottom, uSunColor, uSunDir, uMoonDir, uCloud, uCloudShade, uCam, uLightDir;
uniform float uTime, uNight, uSunVis, uHush, uCover, uRift;
uniform vec4 uCloudW;
uniform sampler2D uNoiseTex, uCloudMap;
uniform vec3 uSnapCam;
uniform vec2 uDrift;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
// Cumulus from the dome map (render/clouds.js): rgb = sun energy, height in the cloud and
// distance, each weighted by opacity; a = opacity.
vec4 cloudAt(vec3 d){
  // re-aim through the middle of the layer, so the map follows the drift and the camera's
  // travel since it was drawn
  float tm = (C_MID - uCam.y) / max(d.y, 0.03);
  vec3 q = normalize(uCam + d * tm + vec3(uDrift.x, 0.0, uDrift.y) - uSnapCam);
  return texture2D(uCloudMap, q.xz / (1.0 + max(q.y, 0.0)) * (0.5 * DOME_S) + 0.5);
}
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float sd = dot(d, uSunDir);
  float sdp = max(sd, 0.0);
  // base gradient: pale horizon to deep zenith
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.03, 0.8, y), 0.5));
  // horizon band: warm glow towards the sun (sunrise / sunset), cooler away from it
  float hb = exp(-max(y, 0.0) * 5.0);
  col += uSunColor * pow(sdp, 3.0) * hb * 0.5 * uSunVis;
  col *= mix(vec3(1.0), vec3(0.93, 0.97, 1.06), (1.0 - sdp) * hb * 0.5);
  col = mix(col, uBottom, 1.0 - smoothstep(-0.25, 0.0, y));
  // sun halo and disk
  col += uSunColor * (pow(sdp, 16.0) * 0.25 + pow(sdp, 180.0) * 0.8) * uSunVis;
  col += uSunColor * smoothstep(0.99955, 0.9998, sd) * 8.0 * uSunVis;
  // moon
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.46, 0.62, 0.92) * pow(md, 96.0) * 0.08 * uNight;
  if (md > 0.9994 && uNight > 0.01) {
    vec3 right = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, uMoonDir);
    vec2 m = vec2(dot(d, right), dot(d, up)) / 0.028;
    float radius = length(m), aa = max(fwidth(radius), 0.005);
    float disk = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, radius);
    vec3 mn = vec3(m, sqrt(max(1.0 - dot(m, m), 0.0)));
    float phase = smoothstep(-0.08, 0.12, dot(mn, normalize(vec3(0.7, 0.18, 0.7))));
    float mare = texture2D(uNoiseTex, m * 0.32 + 0.37).g;
    vec3 moon = vec3(0.64, 0.76, 0.9) * (0.8 + 0.2 * mare) * (0.08 + 1.2 * phase);
    col = mix(col, moon, disk * uNight);
  }
  // stars + milky way
  if (uNight > 0.01 && y > 0.0) {
    vec2 sp = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, asin(clamp(y, -1.0, 1.0)) / 3.1415927 + 0.5) * vec2(1000.0, 500.0);
    float h = hash(vec3(floor(sp), 19.0));
    float starAA = max(length(fwidth(sp)) * 0.5, 0.04);
    if (h > 0.996) {
      float r = mix(0.12, 0.24, fract(h * 317.0));
      float s = 1.0 - smoothstep(r - starAA, r + starAA, length(fract(sp) - 0.5));
      vec3 st = mix(vec3(0.66, 0.8, 1.0), vec3(1.0, 0.84, 0.67), fract(h * 137.0));
      col += st * s * uNight * (0.92 + 0.08 * sin(uTime * 0.7 + h * 90.0)) * smoothstep(0.02, 0.22, y) * 1.3;
    }
    float mw = smoothstep(0.35, 0.0, abs(d.x * 0.6 + d.z * 0.8 - 0.1)) * smoothstep(0.0, 0.5, y);
    col += vec3(0.25, 0.28, 0.45) * mw * texture2D(uNoiseTex, d.xz * 1.6).g * uNight * 0.6;
  }
  if (y > 0.0) {
    vec4 cl = cloudAt(d);
    if (cl.a > 0.004) {
      vec3 k = cl.rgb / cl.a;
      // the map's edge, a little tightened: soft, but not smeared
      float a = smoothstep(0.02, 0.84, cl.a);
      // two soft tones: sunlit white over a pale shade that gathers at the base
      float tone = smoothstep(0.18, 0.78, k.r) * (0.6 + 0.4 * smoothstep(0.05, 0.65, k.g));
      vec3 cc = mix(uCloudShade, uCloud, tone);
      // thin edges glow when the sun is behind them
      cc += uSunColor * pow(sdp, 8.0) * cl.a * (1.0 - cl.a) * 2.2 * uSunVis;
      // far clouds sink into the horizon haze
      float dist = k.b * C_FAR;
      cc = mix(cc, mix(uHorizon, uCloud, 0.4), 1.0 - exp(-dist / 15000.0));
      a *= 1.0 - smoothstep(0.82, 1.0, k.b);
      col = mix(col, cc, a);
    }
  }
  col = mix(col, vec3(0.32, 0.26, 0.4) * (0.6 + 0.4 * col), uHush * 0.55);
  col *= mix(vec3(1.0), vec3(0.32, 0.23, 0.43), uRift);
  gl_FragColor = vec4(col, 1.0);
}`;

// Three depth-separated ranges share one mesh and one draw call. Broad foothills support
// the middle ridges; only the far skyline gets the sharp alpine accents.
const RANGE_VS = `
attribute float aH;
attribute float aLayer;
varying float vH; varying float vLayer; varying vec3 vN; varying vec3 vW;
void main(){
  vH = aH; vLayer = aLayer; vN = normal;
  vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const RANGE_FS = `
uniform vec3 uHorizon, uTop, uSunColor, uSunDir, uCloudShade;
uniform float uNight, uHush;
uniform sampler2D uNoiseTex;
varying float vH; varying float vLayer; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 n = normalize(vN);
  float near = 1.0 - vLayer;
  // body color: cool, slightly lavender; darker when back-lit by a low sun
  vec3 body = mix(uTop * 1.15, uCloudShade, 0.5);
  float toSun = max(dot(normalize(vec3(vW.x, 0.0, vW.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
  float lowSun = 1.0 - smoothstep(0.05, 0.4, uSunDir.y);
  body *= 1.0 - 0.35 * toSun * lowSun;
  float contrast = mix(0.32, 0.6, near) + 0.2 * toSun * lowSun;
  vec3 c = mix(uHorizon, body, contrast);
  float l = dot(n, normalize(vec3(uSunDir.x, max(uSunDir.y, 0.1), uSunDir.z)));
  c *= 0.92 + 0.14 * smoothstep(-0.2, 0.5, l);
  c += uSunColor * smoothstep(0.1, 0.8, l) * 0.04 * near * (1.0 - lowSun * 0.5);
  float nz = texture2D(uNoiseTex, vW.xz * 0.004 + vW.y * 0.002).b;
  float snow = smoothstep(0.62, 0.8, vH + (nz - 0.5) * 0.25) * smoothstep(0.25, 0.7, n.y + 0.4);
  c = mix(c, uHorizon * 1.05 + uSunColor * 0.06, snow * mix(0.35, 0.6, near) * (1.0 - uNight * 0.6));
  // aerial haze: base of the ranges dissolves into the horizon
  c = mix(uHorizon, c, smoothstep(0.02, 0.5, vH) * mix(0.75, 1.0, near));
  c = mix(c, vec3(0.32, 0.26, 0.4) * (0.6 + 0.4 * c), uHush * 0.55);
  gl_FragColor = vec4(c, 1.0);
}`;

function rangeGeometry() {
  const noise = createNoise2D(9001);
  const rings = [
    { r: 980, h0: 35, h1: 140, k: 1.6, off: 17 },
    { r: 1330, h0: 90, h1: 250, k: 2.2, off: 0 },
    { r: 1740, h0: 140, h1: 380, k: 1.6, off: 40 },
  ];
  const pos = [], hs = [], ls = [], idx = [];
  const N = 240, ROWS = 4;
  rings.forEach((R, li) => {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const cx = Math.cos(a), sz = Math.sin(a);
      const rg = ridged(noise, cx * R.k + R.off, sz * R.k - R.off, li === 0 ? 3 : 5);
      // Rounded shoulders carry the silhouette; sharper ridges are secondary accents.
      const shoulder = noise(cx * R.k + R.off + 7, sz * R.k - R.off - 13) * 0.5 + 0.5;
      const peak = clamp(shoulder * 0.68 + rg * 0.32, 0, 1);
      // the southern horizon is open sea: the ranges sink away there
      const top = (R.h0 + (R.h1 - R.h0) * peak) * (1 - 0.92 * smoothstep(0.25, 0.8, sz));
      const rr = R.r + (noise(cx * 3 + 11 + li, sz * 3) * 50);
      for (let j = 0; j <= ROWS; j++) {
        const t = j / ROWS;
        const y = lerp(-140, top, t);
        // slopes lean back so ridges read as volumes rather than walls
        const back = (1 - t) * (-90 + noise(cx * 5 + R.off, sz * 5 + t * 0.7) * 90) + t * 30;
        pos.push(cx * (rr + back), y, sz * (rr + back));
        hs.push(Math.max(0, y) / R.h1); ls.push(li / (rings.length - 1));
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < ROWS; j++) {
      const a = base + i * (ROWS + 1) + j, b = a + ROWS + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(hs, 1));
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(ls, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // camera is inside the rings: flip normals to face inward
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

// Keyframes: hour -> palette (sRGB hex)
const KEYS = [
  { h: 0, top: 0x0b1630, hor: 0x304367, bot: 0x162239, sun: 0xb4c9ed, sunI: 0.65, hemiS: 0x60758f, hemiG: 0x303b41, hemiI: 0.85, fog: 0x27374f, cloud: 0x485b79, shade: 0x273650, rim: 0.25, night: 1 },
  { h: 4.5, top: 0x101a3a, hor: 0x3d3f66, bot: 0x151a30, sun: 0xb1c7ee, sunI: 0.5, hemiS: 0x667b9e, hemiG: 0x343747, hemiI: 0.8, fog: 0x2b3050, cloud: 0x3d3f60, shade: 0x22263e, rim: 0.3, night: 0.9 },
  { h: 6, top: 0x3e5b9a, hor: 0xf4ab7e, bot: 0x6a5a6a, sun: 0xffb27a, sunI: 1.3, hemiS: 0x9aa3c8, hemiG: 0x6a5a50, hemiI: 1.0, fog: 0xe0ab94, cloud: 0xffd0b8, shade: 0xa87890, rim: 0.8, night: 0.15 },
  { h: 8, top: 0x2f74d6, hor: 0xb4dcf4, bot: 0x9ab0c0, sun: 0xfff0dc, sunI: 2.5, hemiS: 0xbfd8ff, hemiG: 0x7a8a5a, hemiI: 1.25, fog: 0xc6dbeb, cloud: 0xffffff, shade: 0xc0d2ee, rim: 1, night: 0 },
  { h: 12.5, top: 0x397dcc, hor: 0xb0d6e7, bot: 0x9ab0c0, sun: 0xfffaf0, sunI: 2.8, hemiS: 0xc4ddff, hemiG: 0x7d8f58, hemiI: 1.3, fog: 0xbcd6ec, cloud: 0xf3f1e5, shade: 0x829ac1, rim: 1, night: 0 },
  { h: 16.5, top: 0x4478b8, hor: 0xe9c99c, bot: 0x8492a0, sun: 0xffe1ab, sunI: 2.35, hemiS: 0xafbeda, hemiG: 0x686d45, hemiI: 1.0, fog: 0xaebeca, cloud: 0xffead0, shade: 0x849aba, rim: 1, night: 0 },
  { h: 17.4, top: 0x4776b0, hor: 0xebbc87, bot: 0x777b91, sun: 0xffca83, sunI: 2.25, hemiS: 0xa1acd0, hemiG: 0x62633f, hemiI: 0.82, fog: 0x9cadbd, cloud: 0xffdfae, shade: 0x778aaa, rim: 0.95, night: 0 },
  { h: 18.6, top: 0x3b5790, hor: 0xf0ad70, bot: 0x656b87, sun: 0xffb367, sunI: 2.0, hemiS: 0x9399bf, hemiG: 0x58533b, hemiI: 0.72, fog: 0x9faebd, cloud: 0xffc391, shade: 0x667ba1, rim: 0.9, night: 0 },
  { h: 19.4, top: 0x293c73, hor: 0xc58e99, bot: 0x454961, sun: 0xb2c2e7, sunI: 0.5, hemiS: 0x7e92bb, hemiG: 0x434252, hemiI: 0.74, fog: 0x7586a5, cloud: 0xbba1bc, shade: 0x5c6b8c, rim: 0.6, night: 0.55 },
  { h: 20, top: 0x141c44, hor: 0x5a4a78, bot: 0x1a1a2e, sun: 0xb2bee8, sunI: 0.55, hemiS: 0x6b769d, hemiG: 0x30313f, hemiI: 0.82, fog: 0x3a3a5e, cloud: 0x4a4468, shade: 0x2a2640, rim: 0.4, night: 0.75 },
  { h: 24, top: 0x0b1630, hor: 0x304367, bot: 0x162239, sun: 0xb4c9ed, sunI: 0.65, hemiS: 0x60758f, hemiG: 0x303b41, hemiI: 0.85, fog: 0x27374f, cloud: 0x485b79, shade: 0x273650, rim: 0.25, night: 1 },
];
const cA = new THREE.Color(), cB = new THREE.Color(), cT = new THREE.Color();
function lerpHex(a, b, t, out) { cA.set(a); cB.set(b); return out.copy(cA).lerp(cB, t); }
const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

const _lightDir = new THREE.Vector3();

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.hour = 7.5;
    this.dayLength = 22 * 60; // seconds per full day
    this.hush = 0;
    this.overcast = 0; // 0 clear … 1 fully clouded (Weather)
    this.storm = 0;    // thunderstorm darkness
    this.cloudT = 0;
    this.uni = {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uMoonDir: { value: new THREE.Vector3() },
      uCloud: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
      uTime: U.time, uNight: { value: 0 }, uSunVis: { value: 1 }, uHush: { value: 0 }, uRift: { value: 0 },
      uCover: { value: 0.53 }, uCloudW: U.cloud, uNoiseTex: { value: noiseTexture() }, uCam: { value: new THREE.Vector3() },
      uLightDir: U.sunDir,
    };
    this.clouds = new Clouds();
    // Keep stable uniform objects: terrain may be constructed before the sky.
    this.clouds.uni.uCloudLayout = U.cloudLayout;
    this.clouds.uni.uCloudWind = U.cloudWind;
    Object.assign(this.uni, this.clouds.uni);
    const mat = new THREE.ShaderMaterial({ uniforms: this.uni, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), mat);
    // Drawn last among opaques so early-z skips every covered pixel.
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1000;
    scene.add(this.mesh);

    const rmat = new THREE.ShaderMaterial({
      uniforms: {
        uHorizon: this.uni.uHorizon, uTop: this.uni.uTop, uSunColor: this.uni.uSunColor, uSunDir: this.uni.uSunDir,
        uCloudShade: this.uni.uCloudShade, uNight: this.uni.uNight, uHush: this.uni.uHush, uNoiseTex: this.uni.uNoiseTex,
      },
      vertexShader: RANGE_VS, fragmentShader: RANGE_FS, side: THREE.DoubleSide, fog: false,
    });
    this.ranges = new THREE.Mesh(rangeGeometry(), rmat);
    this.ranges.frustumCulled = false; this.ranges.renderOrder = 999;
    this.ranges.userData.noBake = true;
    scene.add(this.ranges);

    // Key light with two shadow cascades fitted to the view (three's SunLight): its position
    // is the direction towards the light, and shadow.camera.far is how far shadows reach.
    this.sun = new SunLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00022;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.radius = 3.2; // PCF disk in atlas texels: soft painterly shadow edges
    this.applyQuality();
    scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x7a8a5a, 1.2);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xbcd6ec, 0.003);
    this.fogBase = 0.0026;
    this.cur = {};
  }

  applyQuality() {
    const T = tier(), sh = this.sun.shadow;
    this.clouds.applyQuality();
    if (!T.shadowMap) return; // shadows are switched off on the renderer
    sh.mapSize.set(T.shadowMap, T.shadowMap);
    sh.camera.far = T.shadowDist;
  }

  setHour(h) { this.hour = ((h % 24) + 24) % 24; }

  update(dt, center, timeScale = 1, camPos = null) {
    this.hour = (this.hour + (dt * 24) / this.dayLength * timeScale) % 24;
    const h = this.hour;
    let i = 0;
    while (i < KEYS.length - 1 && KEYS[i + 1].h <= h) i++;
    const a = KEYS[i], b = KEYS[Math.min(i + 1, KEYS.length - 1)];
    const t = b.h > a.h ? smoothstep(0, 1, (h - a.h) / (b.h - a.h)) : 0;
    const u = this.uni;
    const eye = camPos || center;
    const valley = 1 - smoothstep(205, 236, Math.hypot(eye.x, eye.z));
    U.valleyLight.value = valley;
    const evening = smoothstep(16, 17.4, h) * (1 - smoothstep(19.2, 20, h));
    const frost = valley * (1 - smoothstep(28, 72, Math.hypot(eye.x - POI.frost.x, eye.z - POI.frost.z)));
    lerpHex(a.top, b.top, t, u.uTop.value);
    lerpHex(a.hor, b.hor, t, u.uHorizon.value);
    lerpHex(a.bot, b.bot, t, u.uBottom.value);
    lerpHex(a.cloud, b.cloud, t, u.uCloud.value);
    lerpHex(a.shade, b.shade, t, u.uCloudShade.value);
    const night = lerp(a.night, b.night, t);
    u.uNight.value = night;
    u.uHush.value = this.hush;
    const oc = this.overcast, st = this.storm;
    u.uCover.value = 0.53 - oc * 0.36;
    // grey the sky and clouds under heavy cover
    cT.setRGB(0.52, 0.56, 0.62).multiplyScalar(1 - night * 0.8 - st * 0.35);
    u.uTop.value.lerp(cT, oc * 0.75); u.uHorizon.value.lerp(cT, oc * 0.6);
    u.uCloud.value.lerp(cT.multiplyScalar(1.25), oc * 0.7); u.uCloudShade.value.multiplyScalar(1 - oc * 0.35 - st * 0.25);
    u.uCam.value.copy(camPos || center);

    // sun path: rises east (+x), sets west (-x), arcs south (+z)
    // Summer daylight lasts from 05:36 to 19:12: the 18.6 palette still has a low sun.
    // Remap both halves of the orbit so midnight remains continuous over a 24-hour wrap.
    const solar = (h - 5.6 + 24) % 24;
    const ang = (solar < 13.6 ? solar / 13.6 : 1 + (solar - 13.6) / 10.4) * Math.PI;
    const sunset = valley * evening * (1 - smoothstep(17.7, 18.75, h));
    const sunDir = u.uSunDir.value.set(Math.cos(ang), Math.sin(ang) * (1 - 0.41 * sunset), 0.35).normalize();
    u.uMoonDir.value.set(-Math.cos(ang), -Math.sin(ang) * 0.9 + 0.1, -0.3).normalize();
    const sunUp = sunDir.y;
    const sunVis = smoothstep(-0.12, 0.05, sunUp);
    u.uSunVis.value = sunVis;
    lerpHex(a.sun, b.sun, t, u.uSunColor.value);

    u.uSunColor.value.lerp(cA.setRGB(1, 0.72, 0.45), sunset);
    // Directional light follows sun by day, moon by night
    const useMoon = sunUp < 0.02;
    const ldir = useMoon ? u.uMoonDir.value : sunDir;
    const lightDir = _lightDir.set(ldir.x, Math.max(ldir.y, 0.12), ldir.z).normalize();
    this.sun.position.copy(lightDir);
    this.sun.color.copy(u.uSunColor.value);
    // r186 snaps each cascade to its own grid. The same PCF disk thus widens in metres
    // in the far cascade. Tighten the near footprint and keep low-angle acne biased.
    this.sun.shadow.radius = lerp(3.2, tier().shadowRadius, valley);
    this.sun.shadow.normalBias = lerp(0.05, 0.023 + 0.016 * (1 - lightDir.y), valley);
    const hushDim = 1 - this.hush * 0.35;
    // Hide the sun/moon direction handoff below the horizon instead of spinning shadows.
    const handoff = smoothstep(0.025, 0.12, Math.abs(sunUp));
    this.sun.intensity = lerp(a.sunI, b.sunI, t) * handoff * hushDim * (1 - oc * 0.62 - st * 0.15);
    u.uSunVis.value *= 1 - oc * 0.85;
    lerpHex(a.hemiS, b.hemiS, t, this.hemi.color);
    lerpHex(a.hemiG, b.hemiG, t, this.hemi.groundColor);
    this.hemi.intensity = lerp(a.hemiI, b.hemiI, t) * (1 - st * 0.25);
    this.hemi.color.lerp(cA.set(0x9aa4b4), oc * 0.5);
    // Earth lends warm light to soffits and downward planes. Snow returns a brighter,
    // blue-white fill to the shrine. Leave amber local lights in charge at night.
    this.hemi.groundColor.lerp(cA.set(0xc49b70), valley * (0.31 + evening * 0.28) * (1 - night));
    this.hemi.groundColor.lerp(cA.set(0xb8d4e5), frost * (0.66 - night * 0.44));
    this.hemi.color.lerp(cA.set(0x9eafd8), valley * evening * 0.52);
    this.hemi.color.lerp(cA.set(0x8599c0), valley * night * 0.52);
    this.hemi.intensity *= 1 + valley * (0.22 * evening + 0.20 * night);
    lerpHex(a.fog, b.fog, t, this.scene.fog.color);
    if (this.hush > 0) this.scene.fog.color.lerp(cA.set(0x4a4258), this.hush * 0.6);
    this.scene.fog.color.lerp(cA.set(0x8c96a4).multiplyScalar(1 - night * 0.75 - st * 0.3), oc * 0.55);
    // Distance haze is quadratic near the camera: less density preserves foreground values.
    this.scene.fog.density = this.fogBase * (1 - evening * 0.38) * (1 + this.hush * 1.4 + oc * 0.9 + st * 0.6);
    U.rimColor.value.copy(this.sun.color).multiplyScalar(lerp(a.rim, b.rim, t) * 0.9);
    this.mesh.position.copy(center);
    // The backdrop follows only a fraction of travel: distant ridges have restrained
    // parallax, and remain beyond the world boundary even at the outer passes.
    this.ranges.position.set((camPos || center).x * 0.65, 0, (camPos || center).z * 0.65);
    this.night = night;
    // how strongly the air lights up in shafts: full under a clear sun, faint by moonlight
    this.shaft = (sunVis * (1 - night) + 0.18 * night) * (1 - oc * 0.85) * (1 - this.hush * 0.5);

    // --- shared lighting uniforms ---------------------------------------
    U.sunDir.value.copy(lightDir);
    U.skyRefl.value.copy(u.uHorizon.value).lerp(u.uTop.value, 0.45).multiplyScalar(0.9 * (1 - night * 0.55));
    // cool shade tint: sky color normalized to a fixed share of the key light
    cT.copy(this.hemi.color);
    const l = Math.max(lum(cT), 1e-3);
    cT.multiplyScalar(1 / l);
    cT.r = lerp(1, cT.r, 1.25); cT.g = lerp(1, cT.g, 1.25); cT.b = lerp(1, cT.b, 1.25);
    U.shadeTint.value.copy(cT).multiplyScalar(lerp(0.3, 0.42, night) * (1 - this.hush * 0.2));
    // The toon shadow band is multiplied by the key colour. Counter its amber cast
    // in shade so the sky can put blue/violet into recesses at sunset.
    const shade = U.shadeTint.value;
    shade.r *= 1 - valley * (0.08 + 0.11 * evening) * (1 - night);
    shade.b *= 1 + valley * evening * 0.64;
    // The terrain/water read the cumulus layout and wind through U.cloudLayout/cloudWind.
    // U.cloud.xy remains the legacy approximation used by other materials.
    this.cloudT += dt;
    // the sky's cumulus: drift, slow rise of the billows, cover and light
    const W = 80000; // every noise period divides this, so wrapping never shows
    this.clouds.wind.set((this.cloudT * 9) % W, (this.cloudT * 3.6) % W, (this.cloudT * 1.5) % W);
    this.clouds.cover = 0.7 + oc * 0.3;
    this.clouds.deck = smoothstep(0.3, 1, oc);
    this.clouds.light.copy(lightDir);
    const cw = U.cloud.value;
    cw.x = -this.cloudT * 3.2; cw.y = -this.cloudT * 1.3;
    cw.w = 0.42 * smoothstep(0.05, 0.3, sunUp) * (1 - night) * (1 - oc * 0.8);
    // aerial perspective
    FOG.sunDir.x = sunDir.x; FOG.sunDir.y = sunDir.y; FOG.sunDir.z = sunDir.z;
    const golden = 1 - smoothstep(0.15, 0.55, sunUp);
    const scat = (0.12 + 0.22 * golden) * sunVis * (1 - this.hush * 0.7) * (1 - oc * 0.8);
    FOG.sunColor.x = u.uSunColor.value.r * scat; FOG.sunColor.y = u.uSunColor.value.g * scat; FOG.sunColor.z = u.uSunColor.value.b * scat;
    cT.copy(u.uHorizon.value).lerp(u.uTop.value, 0.18 + evening * 0.37);
    cT.lerp(u.uTop.value, valley * (0.19 + evening * 0.12) * (1 - night) * (1 - oc));
    if (this.hush > 0) cT.lerp(cA.set(0x4a4258), this.hush * 0.6);
    FOG.farColor.x = cT.r; FOG.farColor.y = cT.g; FOG.farColor.z = cT.b; FOG.farColor.w = 0.75;
    // valley mist: thicker around dawn, thinner at midday
    const dawn = Math.exp(-((h - 6.5) * (h - 6.5)) / 3);
    FOG.height.x = (0.002 + 0.004 * dawn + 0.0015 * night) * (1 - evening * 0.65) * (1 + this.hush);
    FOG.height.y = 0.045 + evening * 0.015;
    FOG.height.z = -3;
    FOG.height.w = valley * (1 - night * 0.8) * (1 - oc * 0.65) * (1 - dawn * 0.55);
  }
}
