// Pooled particle system rendered as point sprites with procedural shapes.
// shape: 0 glow, 1 hot spark, 2 shard/diamond, 3 smoke puff, 4 star, 5 ring, 6 streak
// Sprites can rotate (rot/spin) and stretch along their screen-space velocity
// (sparks and streaks do by default). Alpha softens where a sprite meets the
// terrain (heightmap) and right in front of the camera.
import * as THREE from 'three';
import { U } from './materials.js';

const VS = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
attribute float aShape;
attribute vec3 aVel;
attribute vec2 aRot; // x: angle (rad), y: stretch amount (0 = none)
uniform float uScale;
uniform float uFogDensity;
uniform vec2 uViewport;
uniform sampler2D uHeightTex;
uniform vec4 uHeightP;
varying vec4 vColor;
varying float vShape;
varying float vFog;
varying float vDist;
varying vec2 vDir;
varying float vStretch;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mv;
  gl_Position = clip;
  float size = min(aSize * uScale / max(-mv.z, 0.2), 900.0);
  // orientation: explicit angle, or along the projected velocity when stretching
  float ang = aRot.x;
  float stretch = 1.0;
  if (aRot.y > 0.0) {
    vec4 c1 = projectionMatrix * (modelViewMatrix * vec4(position + aVel * 0.05, 1.0));
    vec2 d = (c1.xy / c1.w - clip.xy / clip.w) * uViewport * 0.5;
    float len = length(d);
    if (len > 0.01) {
      ang = atan(-d.y, d.x) - 1.5707963;
      stretch = 1.0 + clamp(len * 0.6 * aRot.y / max(size, 1.0), 0.0, 4.0);
    }
  }
  gl_PointSize = min(size * stretch, 1024.0);
  vDir = vec2(cos(ang), sin(ang));
  vStretch = stretch;
  vColor = aColor; vShape = aShape;
  float dd = -mv.z;
  vDist = dd;
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * dd * dd);
  // soften sprites that sink into the ground
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float gh = texture2D(uHeightTex, (wp.xz + uHeightP.x) * uHeightP.y + uHeightP.z).r;
  float above = wp.y - gh;
  vColor.a *= mix(0.4, 1.0, smoothstep(-aSize * 0.2, aSize * 0.3, above));
}`;

const FS = /* glsl */ `
uniform vec3 uFogColor;
uniform float uAdditive;
varying vec4 vColor;
varying float vShape;
varying float vFog;
varying float vDist;
varying vec2 vDir;
varying float vStretch;
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main(){
  vec2 p0 = gl_PointCoord * 2.0 - 1.0;
  // rotate into the particle frame; x across, y along the motion/orientation
  vec2 p = vec2(p0.x * vDir.x + p0.y * vDir.y, -p0.x * vDir.y + p0.y * vDir.x);
  p.x *= vStretch;
  float d = length(p);
  float a;
  vec3 tint = vec3(1.0);
  if (vShape < 0.5) { a = pow(max(1.0 - d, 0.0), 1.7); }
  else if (vShape < 1.5) {
    // hot spark: bright core, tapered tail
    a = pow(max(1.0 - d, 0.0), 2.6) + smoothstep(0.3, 0.0, d) * 0.9;
    a *= mix(1.0, 0.6, smoothstep(0.0, -1.0, p.y));
  }
  else if (vShape < 2.5) {
    float q = abs(p.x) * 1.8 + abs(p.y) * 0.9;
    a = smoothstep(1.0, 0.8, q);
    a *= 0.75 + 0.35 * step(0.0, p.x * 0.6 + p.y * 0.3); // two-tone facet
    a += smoothstep(0.28, 0.0, q) * 0.8;
  }
  else if (vShape < 3.5) {
    // lumpy smoke puff with a soft lit top
    float n = vn(p * 2.2 + vDir * 3.0) * 0.6 + vn(p * 4.7 - vDir.yx * 2.0) * 0.4;
    float r = d + (n - 0.5) * 0.55;
    a = smoothstep(1.0, 0.25, r) * 0.9;
    tint = vec3(mix(0.82, 1.08, smoothstep(0.6, -0.6, p0.y)));
  }
  else if (vShape < 4.5) {
    float cx = smoothstep(0.14, 0.0, abs(p.x)) * smoothstep(1.0, 0.0, abs(p.y));
    float cy = smoothstep(0.14, 0.0, abs(p.y)) * smoothstep(1.0, 0.0, abs(p.x));
    a = max(cx, cy) + pow(max(1.0 - d, 0.0), 4.0);
  }
  else if (vShape < 5.5) { a = smoothstep(0.2, 0.0, abs(d - 0.72)); }
  else { a = smoothstep(0.3, 0.0, abs(p.x)) * smoothstep(1.0, 0.15, abs(p.y)) * mix(1.0, 0.5, smoothstep(0.2, -1.0, p.y)); }
  if (a < 0.004) discard;
  float al = vColor.a * a;
  if (uAdditive > 0.5) {
    al *= smoothstep(0.3, 2.0, vDist);
    gl_FragColor = vec4(vColor.rgb * tint * (1.0 - vFog * 0.9), al);
  } else {
    al *= smoothstep(0.2, 1.2, vDist);
    gl_FragColor = vec4(mix(vColor.rgb * tint, uFogColor, vFog), al);
  }
}`;

export class Particles {
  constructor(scene, max = 6000, additive = true) {
    this.max = max; this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 4); this.c1 = new Float32Array(max * 4);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.shape = new Float32Array(max);
    this.turb = new Float32Array(max);
    this.fadeIn = new Float32Array(max);
    this.rot = new Float32Array(max); this.spin = new Float32Array(max); this.stretch = new Float32Array(max);

    const g = (this.geo = new THREE.BufferGeometry());
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aShape = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aColor', this.aColor);
    g.setAttribute('aShape', this.aShape);
    g.setAttribute('aVel', this.aVel);
    g.setAttribute('aRot', this.aRot);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS,
      uniforms: {
        uScale: { value: 400 },
        uFogDensity: { value: 0.004 },
        uFogColor: { value: new THREE.Color() },
        uAdditive: { value: additive ? 1 : 0 },
        uViewport: { value: new THREE.Vector2(1280, 720) },
        uHeightTex: U.heightTex,
        uHeightP: U.heightP,
      },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 10 : 9;
    scene.add(this.points);
  }

  /**
   * o: { p:[x,y,z] | Vector3, v:[x,y,z], life, size, size1, color:Color|hex, color1, alpha, alpha1, drag, grav, shape, turb, fadeIn,
   *      rot (initial angle, rad), spin (rad/s), stretch (velocity stretch amount; sparks/streaks default on) }
   */
  emit(o) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3, i4 = i * 4;
    const p = o.p;
    this.pos[i3] = p.x ?? p[0]; this.pos[i3 + 1] = p.y ?? p[1]; this.pos[i3 + 2] = p.z ?? p[2];
    const v = o.v || [0, 0, 0];
    this.vel[i3] = v.x ?? v[0]; this.vel[i3 + 1] = v.y ?? v[1]; this.vel[i3 + 2] = v.z ?? v[2];
    this.life[i] = this.maxLife[i] = o.life ?? 1;
    this.s0[i] = o.size ?? 1; this.s1[i] = o.size1 ?? this.s0[i];
    const c = o.color, c1 = o.color1 ?? c;
    this.c0[i4] = c.r; this.c0[i4 + 1] = c.g; this.c0[i4 + 2] = c.b; this.c0[i4 + 3] = o.alpha ?? 1;
    this.c1[i4] = c1.r; this.c1[i4 + 1] = c1.g; this.c1[i4 + 2] = c1.b; this.c1[i4 + 3] = o.alpha1 ?? 0;
    this.drag[i] = o.drag ?? 0; this.grav[i] = o.grav ?? 0;
    const sh = (this.shape[i] = o.shape ?? 0);
    this.turb[i] = o.turb ?? 0; this.fadeIn[i] = o.fadeIn ?? 0;
    // smoke and shards get a random orientation + slow spin unless specified
    const tumble = sh > 1.5 && sh < 3.5;
    this.rot[i] = o.rot ?? (tumble ? Math.random() * Math.PI * 2 : 0);
    this.spin[i] = o.spin ?? (tumble ? (Math.random() - 0.5) * (sh < 2.5 ? 6 : 1.2) : 0);
    this.stretch[i] = o.stretch ?? (sh > 5.5 ? 1 : sh > 0.5 && sh < 1.5 ? 0.6 : 0);
  }

  update(dt, time) {
    const P = this.pos, V = this.vel, ap = this.aPos.array, as = this.aSize.array, ac = this.aColor.array, ash = this.aShape.array;
    const av = this.aVel.array, ar = this.aRot.array;
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this._kill(i); continue; }
      const i3 = i * 3, i4 = i * 4;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      V[i3] *= dr; V[i3 + 1] = V[i3 + 1] * dr - this.grav[i] * dt; V[i3 + 2] *= dr;
      const tb = this.turb[i];
      if (tb > 0) {
        const ph = time * 3 + i * 1.7;
        V[i3] += Math.sin(ph) * tb * dt; V[i3 + 2] += Math.cos(ph * 1.3) * tb * dt; V[i3 + 1] += Math.sin(ph * 0.7) * tb * 0.5 * dt;
      }
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      ap[i3] = P[i3]; ap[i3 + 1] = P[i3 + 1]; ap[i3 + 2] = P[i3 + 2];
      av[i3] = V[i3]; av[i3 + 1] = V[i3 + 1]; av[i3 + 2] = V[i3 + 2];
      this.rot[i] += this.spin[i] * dt;
      ar[i * 2] = this.rot[i]; ar[i * 2 + 1] = this.stretch[i];
      as[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const c0 = this.c0, c1 = this.c1;
      let fi = 1;
      if (this.fadeIn[i] > 0) fi = Math.min(1, t / this.fadeIn[i]);
      ac[i4] = c0[i4] + (c1[i4] - c0[i4]) * t;
      ac[i4 + 1] = c0[i4 + 1] + (c1[i4 + 1] - c0[i4 + 1]) * t;
      ac[i4 + 2] = c0[i4 + 2] + (c1[i4 + 2] - c0[i4 + 2]) * t;
      ac[i4 + 3] = (c0[i4 + 3] + (c1[i4 + 3] - c0[i4 + 3]) * t) * fi;
      ash[i] = this.shape[i];
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    if (this.count > 0) {
      for (const [a, n] of [[this.aPos, 3], [this.aSize, 1], [this.aColor, 4], [this.aShape, 1], [this.aVel, 3], [this.aRot, 2]]) {
        a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, this.count * n);
      }
    }
  }

  _kill(i) {
    const j = --this.count;
    if (i === j) return;
    const cp3 = (a) => { a[i * 3] = a[j * 3]; a[i * 3 + 1] = a[j * 3 + 1]; a[i * 3 + 2] = a[j * 3 + 2]; };
    const cp4 = (a) => { a[i * 4] = a[j * 4]; a[i * 4 + 1] = a[j * 4 + 1]; a[i * 4 + 2] = a[j * 4 + 2]; a[i * 4 + 3] = a[j * 4 + 3]; };
    cp3(this.pos); cp3(this.vel); cp4(this.c0); cp4(this.c1);
    this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
    this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j];
    this.shape[i] = this.shape[j]; this.turb[i] = this.turb[j]; this.fadeIn[i] = this.fadeIn[j];
    this.rot[i] = this.rot[j]; this.spin[i] = this.spin[j]; this.stretch[i] = this.stretch[j];
  }

  setScale(h, fov) {
    this.mat.uniforms.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360));
    // viewport in device pixels (h is the drawing-buffer height)
    const aspect = typeof window !== 'undefined' ? window.innerWidth / Math.max(1, window.innerHeight) : 16 / 9;
    this.mat.uniforms.uViewport.value.set(h * aspect, h);
  }
}
