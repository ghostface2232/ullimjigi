// Painted sky dome + day/night lighting controller.
import * as THREE from 'three';
import { U } from '../render/materials.js';
import { lerp, clamp, smoothstep } from '../core/util.js';

const SKY_VS = `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FS = `
uniform vec3 uTop, uHorizon, uBottom, uSunColor, uSunDir, uMoonDir, uCloud, uCloudShade;
uniform float uTime, uNight, uSunVis, uHush;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.65, y), 0.65));
  col = mix(col, uBottom, smoothstep(0.0, -0.3, y));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.22 + pow(sd, 48.0) * 0.5) * (1.0 - smoothstep(-0.1, 0.6, y) * 0.5) * uSunVis;
  col += uSunColor * smoothstep(0.99955, 0.9998, sd) * 8.0 * uSunVis;
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.8, 0.88, 1.0) * (smoothstep(0.9993, 0.99965, md) * 2.5 + pow(md, 64.0) * 0.18) * uNight;
  if (uNight > 0.01 && y > 0.0) {
    vec3 sp = d * 260.0; vec3 cell = floor(sp); float h = hash(cell);
    if (h > 0.985) { vec3 f = fract(sp) - 0.5; float s = smoothstep(0.12, 0.0, length(f));
      col += vec3(0.9, 0.95, 1.0) * s * uNight * (0.55 + 0.45 * sin(uTime * 2.0 + h * 90.0)) * smoothstep(0.0, 0.2, y) * 1.6; }
    float mw = smoothstep(0.35, 0.0, abs(d.x * 0.6 + d.z * 0.8 - 0.1)) * smoothstep(0.0, 0.5, y);
    col += vec3(0.25, 0.28, 0.45) * mw * fbm(d.xz * 6.0) * uNight * 0.5;
  }
  if (y > -0.05) {
    vec2 uv = d.xz / (max(y, 0.0) + 0.18) * 0.75 + vec2(uTime * 0.006, uTime * 0.0025);
    float c = fbm(uv * 1.1);
    float c2 = fbm(uv * 1.1 + vec2(0.08, 0.05));
    float cover = smoothstep(0.48, 0.74, c) * smoothstep(-0.05, 0.25, y);
    vec3 cc = mix(uCloud, uCloudShade, smoothstep(0.45, 0.85, c2) * 0.8);
    cc += uSunColor * pow(sd, 4.0) * 0.25 * uSunVis;
    col = mix(col, cc, cover * 0.92);
  }
  col = mix(col, vec3(0.32, 0.26, 0.4) * (0.6 + 0.4 * col), uHush * 0.55);
  gl_FragColor = vec4(col, 1.0);
}`;

// Keyframes: hour -> palette (sRGB hex)
const KEYS = [
  { h: 0, top: 0x060b20, hor: 0x1a2546, bot: 0x0c1226, sun: 0x8fa6ff, sunI: 0.35, hemiS: 0x31406e, hemiG: 0x1a1e2a, hemiI: 0.55, fog: 0x18223c, cloud: 0x2a3456, shade: 0x151b30, rim: 0.25, night: 1 },
  { h: 4.5, top: 0x101a3a, hor: 0x3d3f66, bot: 0x151a30, sun: 0x9aaaff, sunI: 0.3, hemiS: 0x3d4a78, hemiG: 0x221f2c, hemiI: 0.6, fog: 0x2b3050, cloud: 0x3d3f60, shade: 0x22263e, rim: 0.3, night: 0.9 },
  { h: 6, top: 0x3e5b9a, hor: 0xf4ab7e, bot: 0x6a5a6a, sun: 0xffb27a, sunI: 1.3, hemiS: 0x9aa3c8, hemiG: 0x6a5a50, hemiI: 1.0, fog: 0xe0ab94, cloud: 0xffd0b8, shade: 0xb07a88, rim: 0.8, night: 0.15 },
  { h: 8, top: 0x4f86d6, hor: 0xcfe3f0, bot: 0x9ab0c0, sun: 0xfff0dc, sunI: 2.5, hemiS: 0xbfd8ff, hemiG: 0x7a8a5a, hemiI: 1.25, fog: 0xc6dbeb, cloud: 0xffffff, shade: 0xb9c6d8, rim: 1, night: 0 },
  { h: 12.5, top: 0x3f7fd8, hor: 0xbcdaf2, bot: 0x9ab0c0, sun: 0xfffaf0, sunI: 2.8, hemiS: 0xc4ddff, hemiG: 0x7d8f58, hemiI: 1.3, fog: 0xbcd6ec, cloud: 0xffffff, shade: 0xbac8da, rim: 1, night: 0 },
  { h: 16.5, top: 0x4a7ed0, hor: 0xf0d8b0, bot: 0x9a9aa0, sun: 0xffe2b4, sunI: 2.4, hemiS: 0xc8d4f0, hemiG: 0x857f55, hemiI: 1.2, fog: 0xcfd9e2, cloud: 0xfff4e0, shade: 0xc4b8c0, rim: 1, night: 0 },
  { h: 18.6, top: 0x33447e, hor: 0xff9a60, bot: 0x5a4450, sun: 0xff8a4a, sunI: 1.4, hemiS: 0x9a88b0, hemiG: 0x5a4640, hemiI: 0.95, fog: 0xd08a70, cloud: 0xffb890, shade: 0x8a5a78, rim: 0.9, night: 0.1 },
  { h: 20, top: 0x141c44, hor: 0x5a4a78, bot: 0x1a1a2e, sun: 0xa0a8ff, sunI: 0.35, hemiS: 0x4a5080, hemiG: 0x252230, hemiI: 0.62, fog: 0x3a3a5e, cloud: 0x4a4468, shade: 0x2a2640, rim: 0.4, night: 0.75 },
  { h: 24, top: 0x060b20, hor: 0x1a2546, bot: 0x0c1226, sun: 0x8fa6ff, sunI: 0.35, hemiS: 0x31406e, hemiG: 0x1a1e2a, hemiI: 0.55, fog: 0x18223c, cloud: 0x2a3456, shade: 0x151b30, rim: 0.25, night: 1 },
];
const cA = new THREE.Color(), cB = new THREE.Color();
function lerpHex(a, b, t, out) { cA.set(a); cB.set(b); return out.copy(cA).lerp(cB, t); }

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.hour = 7.5;
    this.dayLength = 22 * 60; // seconds per full day
    this.hush = 0;
    this.uni = {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uMoonDir: { value: new THREE.Vector3() },
      uCloud: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
      uTime: U.time, uNight: { value: 0 }, uSunVis: { value: 1 }, uHush: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uni, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = -10;
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x7a8a5a, 1.2);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xbcd6ec, 0.0026);
    this.fogBase = 0.0026;
    this.cur = {};
  }

  setHour(h) { this.hour = ((h % 24) + 24) % 24; }

  update(dt, center, timeScale = 1) {
    this.hour = (this.hour + (dt * 24) / this.dayLength * timeScale) % 24;
    const h = this.hour;
    let i = 0;
    while (i < KEYS.length - 1 && KEYS[i + 1].h <= h) i++;
    const a = KEYS[i], b = KEYS[Math.min(i + 1, KEYS.length - 1)];
    const t = b.h > a.h ? smoothstep(0, 1, (h - a.h) / (b.h - a.h)) : 0;
    const u = this.uni;
    lerpHex(a.top, b.top, t, u.uTop.value);
    lerpHex(a.hor, b.hor, t, u.uHorizon.value);
    lerpHex(a.bot, b.bot, t, u.uBottom.value);
    lerpHex(a.cloud, b.cloud, t, u.uCloud.value);
    lerpHex(a.shade, b.shade, t, u.uCloudShade.value);
    const night = lerp(a.night, b.night, t);
    u.uNight.value = night;
    u.uHush.value = this.hush;

    // sun path: rises east (+x), sets west (-x), arcs south (+z)
    const ang = ((h - 6) / 12) * Math.PI;
    const sunDir = u.uSunDir.value.set(Math.cos(ang), Math.sin(ang), 0.35).normalize();
    u.uMoonDir.value.set(-Math.cos(ang), -Math.sin(ang) * 0.9 + 0.1, -0.3).normalize();
    const sunUp = sunDir.y;
    u.uSunVis.value = smoothstep(-0.12, 0.05, sunUp);
    lerpHex(a.sun, b.sun, t, u.uSunColor.value);

    // Directional light follows sun by day, moon by night
    const useMoon = sunUp < 0.02;
    const ldir = useMoon ? u.uMoonDir.value : sunDir;
    const lightDir = new THREE.Vector3(ldir.x, Math.max(ldir.y, 0.25), ldir.z).normalize();
    this.sun.position.copy(center).addScaledVector(lightDir, 120);
    this.sun.target.position.copy(center);
    lerpHex(a.sun, b.sun, t, this.sun.color);
    const hushDim = 1 - this.hush * 0.35;
    this.sun.intensity = lerp(a.sunI, b.sunI, t) * hushDim;
    lerpHex(a.hemiS, b.hemiS, t, this.hemi.color);
    lerpHex(a.hemiG, b.hemiG, t, this.hemi.groundColor);
    this.hemi.intensity = lerp(a.hemiI, b.hemiI, t);
    lerpHex(a.fog, b.fog, t, this.scene.fog.color);
    if (this.hush > 0) this.scene.fog.color.lerp(cA.set(0x4a4258), this.hush * 0.6);
    this.scene.fog.density = this.fogBase * (1 + this.hush * 1.4);
    U.rimColor.value.copy(this.sun.color).multiplyScalar(lerp(a.rim, b.rim, t) * 0.9);
    this.mesh.position.copy(center);
    this.night = night;
    // snap shadow camera to texel grid to avoid shimmering
    const sc = this.sun.shadow.camera;
    const texel = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
    this.sun.target.position.x = Math.round(center.x / texel) * texel;
    this.sun.target.position.z = Math.round(center.z / texel) * texel;
    this.sun.position.copy(this.sun.target.position).addScaledVector(lightDir, 120);
  }
}
