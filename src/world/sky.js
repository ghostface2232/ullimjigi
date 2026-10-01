// Painted sky dome + day/night lighting controller. Also drives the shared
// lighting uniforms (cloud shadows, cool shade tint, aerial fog) and draws
// distant mountain-range silhouettes on the horizon.
import * as THREE from 'three';
import { U, FOG, noiseTexture } from '../render/materials.js';
import { lerp, clamp, smoothstep, createNoise2D, ridged } from '../core/util.js';

const CLOUD_H = 160; // cloud layer height (m), shared with ground cloud shadows

const SKY_VS = `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FS = `
uniform vec3 uTop, uHorizon, uBottom, uSunColor, uSunDir, uMoonDir, uCloud, uCloudShade, uCam;
uniform float uTime, uNight, uSunVis, uHush, uCover;
uniform vec4 uCloudW;
uniform sampler2D uNoiseTex;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float cloudDens(vec2 uv){
  return texture2D(uNoiseTex, uv).r + (texture2D(uNoiseTex, uv * 4.3 + vec2(0.37, 0.11)).b - 0.5) * 0.24;
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
  col = mix(col, uBottom, smoothstep(0.0, -0.25, y));
  // sun halo and disk
  col += uSunColor * (pow(sdp, 16.0) * 0.25 + pow(sdp, 180.0) * 0.8) * uSunVis;
  col += uSunColor * smoothstep(0.99955, 0.9998, sd) * 8.0 * uSunVis;
  // moon
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.8, 0.88, 1.0) * (smoothstep(0.9993, 0.99965, md) * 2.5 + pow(md, 64.0) * 0.18) * uNight;
  // stars + milky way
  if (uNight > 0.01 && y > 0.0) {
    vec3 sp = d * 260.0; vec3 cell = floor(sp); float h = hash(cell);
    if (h > 0.985) { vec3 f = fract(sp) - 0.5; float s = smoothstep(0.12, 0.0, length(f));
      col += vec3(0.9, 0.95, 1.0) * s * uNight * (0.55 + 0.45 * sin(uTime * 2.0 + h * 90.0)) * smoothstep(0.0, 0.2, y) * 1.6; }
    float mw = smoothstep(0.35, 0.0, abs(d.x * 0.6 + d.z * 0.8 - 0.1)) * smoothstep(0.0, 0.5, y);
    col += vec3(0.25, 0.28, 0.45) * mw * texture2D(uNoiseTex, d.xz * 1.6).g * uNight * 0.6;
  }
  // painterly cumulus layer (same world mapping as the ground cloud shadows)
  if (y > -0.03) {
    float yy = max(y, 0.0);
    vec2 wp = uCam.xz + d.xz * (${CLOUD_H.toFixed(1)} - uCam.y) / (yy + 0.045);
    vec2 uv = (wp + uCloudW.xy) * uCloudW.z;
    float dens = cloudDens(uv);
    float cov = smoothstep(uCover, uCover + 0.13, dens);
    if (cov > 0.001) {
      vec2 toSun = normalize(uSunDir.xz + vec2(1e-4)) * 0.02;
      float ds = cloudDens(uv + toSun);
      float lit = smoothstep(0.2, 0.8, 0.55 - (ds - dens) * 7.0);
      float thick = smoothstep(uCover + 0.06, uCover + 0.34, dens);
      vec3 cc = mix(uCloudShade, uCloud, mix(lit, 1.0, 0.2) * (1.0 - thick * 0.4));
      // silver lining on thin edges, strongest near the sun
      float edge = cov * (1.0 - smoothstep(uCover + 0.02, uCover + 0.16, dens));
      cc += uSunColor * edge * (pow(sdp, 5.0) * 1.2 + 0.12) * uSunVis;
      cc += uSunColor * pow(sdp, 8.0) * 0.25 * uSunVis;
      // distant clouds sink into the horizon haze
      cc = mix(uHorizon, cc, 0.35 + 0.65 * smoothstep(0.02, 0.3, y));
      col = mix(col, cc, cov * smoothstep(0.0, 0.12, y) * 0.96);
    }
    // high cirrus wisps
    vec2 cw = (uCam.xz + d.xz * 700.0 / (yy + 0.08) + uCloudW.xy * 1.7) * uCloudW.z * 0.45;
    cw = vec2(cw.x * 0.6 + cw.y * 0.8, (cw.y * 0.6 - cw.x * 0.8) * 3.5);
    float ci = smoothstep(0.56, 0.86, texture2D(uNoiseTex, cw).g) * smoothstep(0.04, 0.4, y) * (1.0 - cov);
    col = mix(col, uCloud + uSunColor * pow(sdp, 4.0) * 0.3 * uSunVis, ci * 0.32);
  }
  col = mix(col, vec3(0.32, 0.26, 0.4) * (0.6 + 0.4 * col), uHush * 0.55);
  gl_FragColor = vec4(col, 1.0);
}`;

// Distant mountain silhouettes (two rings), hazed towards the horizon color.
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
    { r: 1080, h0: 90, h1: 300, k: 2.2, off: 0 },
    { r: 1360, h0: 150, h1: 440, k: 1.6, off: 40 },
  ];
  const pos = [], hs = [], ls = [], idx = [];
  const N = 240, ROWS = 4;
  rings.forEach((R, li) => {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const cx = Math.cos(a), sz = Math.sin(a);
      const rg = ridged(noise, cx * R.k + R.off, sz * R.k - R.off, 5);
      const peak = Math.pow(clamp(rg, 0, 1), 1.35);
      // the southern horizon is open sea: the ranges sink away there
      const top = (R.h0 + (R.h1 - R.h0) * peak) * (1 - 0.92 * smoothstep(0.25, 0.8, sz));
      const rr = R.r + (noise(cx * 3 + 11 + li, sz * 3) * 50);
      for (let j = 0; j <= ROWS; j++) {
        const t = j / ROWS;
        const y = lerp(-60, top, t);
        // slopes lean back so ridges read as volumes rather than walls
        const back = (1 - t) * -40 + t * 30;
        pos.push(cx * (rr + back), y, sz * (rr + back));
        hs.push(Math.max(0, y) / R.h1); ls.push(li);
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
  { h: 0, top: 0x060b20, hor: 0x1a2546, bot: 0x0c1226, sun: 0x8fa6ff, sunI: 0.35, hemiS: 0x31406e, hemiG: 0x1a1e2a, hemiI: 0.55, fog: 0x18223c, cloud: 0x2a3456, shade: 0x151b30, rim: 0.25, night: 1 },
  { h: 4.5, top: 0x101a3a, hor: 0x3d3f66, bot: 0x151a30, sun: 0x9aaaff, sunI: 0.3, hemiS: 0x3d4a78, hemiG: 0x221f2c, hemiI: 0.6, fog: 0x2b3050, cloud: 0x3d3f60, shade: 0x22263e, rim: 0.3, night: 0.9 },
  { h: 6, top: 0x3e5b9a, hor: 0xf4ab7e, bot: 0x6a5a6a, sun: 0xffb27a, sunI: 1.3, hemiS: 0x9aa3c8, hemiG: 0x6a5a50, hemiI: 1.0, fog: 0xe0ab94, cloud: 0xffd0b8, shade: 0xa87890, rim: 0.8, night: 0.15 },
  { h: 8, top: 0x4a82d4, hor: 0xcfe3f0, bot: 0x9ab0c0, sun: 0xfff0dc, sunI: 2.5, hemiS: 0xbfd8ff, hemiG: 0x7a8a5a, hemiI: 1.25, fog: 0xc6dbeb, cloud: 0xffffff, shade: 0xaebfd8, rim: 1, night: 0 },
  { h: 12.5, top: 0x3a78d4, hor: 0xbcdaf2, bot: 0x9ab0c0, sun: 0xfffaf0, sunI: 2.8, hemiS: 0xc4ddff, hemiG: 0x7d8f58, hemiI: 1.3, fog: 0xbcd6ec, cloud: 0xffffff, shade: 0xb0c0d8, rim: 1, night: 0 },
  { h: 16.5, top: 0x4478cc, hor: 0xf0d8b0, bot: 0x9a9aa0, sun: 0xffe2b4, sunI: 2.4, hemiS: 0xc8d4f0, hemiG: 0x857f55, hemiI: 1.2, fog: 0xcfd9e2, cloud: 0xfff4e0, shade: 0xbcb0c4, rim: 1, night: 0 },
  { h: 18.6, top: 0x33447e, hor: 0xff9a60, bot: 0x5a4450, sun: 0xff8a4a, sunI: 1.4, hemiS: 0x9a88b0, hemiG: 0x5a4640, hemiI: 0.95, fog: 0xd08a70, cloud: 0xffb890, shade: 0x80567a, rim: 0.9, night: 0.1 },
  { h: 20, top: 0x141c44, hor: 0x5a4a78, bot: 0x1a1a2e, sun: 0xa0a8ff, sunI: 0.35, hemiS: 0x4a5080, hemiG: 0x252230, hemiI: 0.62, fog: 0x3a3a5e, cloud: 0x4a4468, shade: 0x2a2640, rim: 0.4, night: 0.75 },
  { h: 24, top: 0x060b20, hor: 0x1a2546, bot: 0x0c1226, sun: 0x8fa6ff, sunI: 0.35, hemiS: 0x31406e, hemiG: 0x1a1e2a, hemiI: 0.55, fog: 0x18223c, cloud: 0x2a3456, shade: 0x151b30, rim: 0.25, night: 1 },
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
      uTime: U.time, uNight: { value: 0 }, uSunVis: { value: 1 }, uHush: { value: 0 },
      uCover: { value: 0.53 }, uCloudW: U.cloud, uNoiseTex: { value: noiseTexture() }, uCam: { value: new THREE.Vector3() },
    };
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

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2.6; // wider PCF disk: soft painterly shadow edges at no extra taps
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x7a8a5a, 1.2);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xbcd6ec, 0.003);
    this.fogBase = 0.003;
    this.cur = {};
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
    const ang = ((h - 6) / 12) * Math.PI;
    const sunDir = u.uSunDir.value.set(Math.cos(ang), Math.sin(ang), 0.35).normalize();
    u.uMoonDir.value.set(-Math.cos(ang), -Math.sin(ang) * 0.9 + 0.1, -0.3).normalize();
    const sunUp = sunDir.y;
    const sunVis = smoothstep(-0.12, 0.05, sunUp);
    u.uSunVis.value = sunVis;
    lerpHex(a.sun, b.sun, t, u.uSunColor.value);

    // Directional light follows sun by day, moon by night
    const useMoon = sunUp < 0.02;
    const ldir = useMoon ? u.uMoonDir.value : sunDir;
    const lightDir = _lightDir.set(ldir.x, Math.max(ldir.y, 0.25), ldir.z).normalize();
    this.sun.position.copy(center).addScaledVector(lightDir, 120);
    this.sun.target.position.copy(center);
    lerpHex(a.sun, b.sun, t, this.sun.color);
    const hushDim = 1 - this.hush * 0.35;
    this.sun.intensity = lerp(a.sunI, b.sunI, t) * hushDim * (1 - oc * 0.62 - st * 0.15);
    u.uSunVis.value *= 1 - oc * 0.85;
    lerpHex(a.hemiS, b.hemiS, t, this.hemi.color);
    lerpHex(a.hemiG, b.hemiG, t, this.hemi.groundColor);
    this.hemi.intensity = lerp(a.hemiI, b.hemiI, t) * (1 - st * 0.25);
    this.hemi.color.lerp(cA.set(0x9aa4b4), oc * 0.5);
    lerpHex(a.fog, b.fog, t, this.scene.fog.color);
    if (this.hush > 0) this.scene.fog.color.lerp(cA.set(0x4a4258), this.hush * 0.6);
    this.scene.fog.color.lerp(cA.set(0x8c96a4).multiplyScalar(1 - night * 0.75 - st * 0.3), oc * 0.55);
    this.scene.fog.density = this.fogBase * (1 + this.hush * 1.4 + oc * 0.9 + st * 0.6);
    U.rimColor.value.copy(this.sun.color).multiplyScalar(lerp(a.rim, b.rim, t) * 0.9);
    this.mesh.position.copy(center);
    // the far ranges stay at one distance wherever you are on the map (they are the horizon)
    this.ranges.position.set((camPos || center).x, 0, (camPos || center).z);
    this.night = night;

    // --- shared lighting uniforms ---------------------------------------
    U.sunDir.value.copy(lightDir);
    // cool shade tint: sky color normalized to a fixed share of the key light
    cT.copy(this.hemi.color);
    const l = Math.max(lum(cT), 1e-3);
    cT.multiplyScalar(1 / l);
    cT.r = lerp(1, cT.r, 1.25); cT.g = lerp(1, cT.g, 1.25); cT.b = lerp(1, cT.b, 1.25);
    U.shadeTint.value.copy(cT).multiplyScalar(lerp(0.3, 0.42, night) * (1 - this.hush * 0.2));
    // cloud shadows drift with the sky clouds
    this.cloudT += dt;
    const cw = U.cloud.value;
    cw.x = -this.cloudT * 3.2; cw.y = -this.cloudT * 1.3;
    cw.w = 0.42 * smoothstep(0.05, 0.3, sunUp) * (1 - night) * (1 - oc * 0.8);
    // aerial perspective
    FOG.sunDir.x = sunDir.x; FOG.sunDir.y = sunDir.y; FOG.sunDir.z = sunDir.z;
    const golden = 1 - smoothstep(0.15, 0.55, sunUp);
    const scat = (0.22 + 0.5 * golden) * sunVis * (1 - this.hush * 0.7) * (1 - oc * 0.8);
    FOG.sunColor.x = u.uSunColor.value.r * scat; FOG.sunColor.y = u.uSunColor.value.g * scat; FOG.sunColor.z = u.uSunColor.value.b * scat;
    cT.copy(u.uHorizon.value).lerp(u.uTop.value, 0.18);
    if (this.hush > 0) cT.lerp(cA.set(0x4a4258), this.hush * 0.6);
    FOG.farColor.x = cT.r; FOG.farColor.y = cT.g; FOG.farColor.z = cT.b; FOG.farColor.w = 0.75;
    // valley mist: thicker around dawn, thinner at midday
    const dawn = Math.exp(-((h - 6.5) * (h - 6.5)) / 3);
    FOG.height.x = (0.0022 + 0.004 * dawn + 0.002 * night) * (1 + this.hush);
    FOG.height.y = 0.045;
    FOG.height.z = 0;

    // snap shadow camera to texel grid to avoid shimmering
    const sc = this.sun.shadow.camera;
    const texel = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
    this.sun.target.position.x = Math.round(center.x / texel) * texel;
    this.sun.target.position.z = Math.round(center.z / texel) * texel;
    this.sun.position.copy(this.sun.target.position).addScaledVector(lightDir, 120);
  }
}
