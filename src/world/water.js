// Stylized water: depth-tinted color, shoreline foam, sun glints.
import * as THREE from 'three';
import { U } from '../render/materials.js';

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
uniform vec3 uShallow, uDeep, uFoam, uSunDir, uSunColor, uSky;
uniform float uNight;
varying vec3 vW;
#include <fog_pars_fragment>
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec2 uv = (vW.xz + uHalf) / (2.0 * uHalf);
  float depth = texture2D(uDepth, uv).r * 12.0 - 2.0;
  if (depth < -0.05) discard;
  vec2 p = vW.xz;
  float w1 = n2(p * 0.35 + vec2(uTime * 0.25, uTime * 0.18));
  float w2 = n2(p * 0.8 - vec2(uTime * 0.3, -uTime * 0.22));
  float w = w1 * 0.6 + w2 * 0.4;
  vec3 N = normalize(vec3((w1 - 0.5) * 0.35, 1.0, (w2 - 0.5) * 0.35));
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 5.5, depth));
  col = mix(col, uSky, fres * 0.55);
  // toon-ish sun glint
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 180.0);
  col += uSunColor * step(0.5, spec) * 1.6 * (1.0 - uNight * 0.7);
  // sparkles
  float sp = step(0.985, n2(p * 3.0 + uTime * 0.8)) * step(0.6, w);
  col += uSunColor * sp * 0.8 * (1.0 - uNight);
  // shoreline foam bands
  float band = sin(depth * 6.0 - uTime * 1.6 + w * 3.0);
  float foam = smoothstep(0.55, 0.0, depth) + smoothstep(0.85, 1.0, band) * smoothstep(1.4, 0.3, depth) * 0.8;
  col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.85);
  float alpha = clamp(0.55 + smoothstep(0.0, 2.0, depth) * 0.4 + foam * 0.4, 0.0, 0.96);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}`;

export class Water {
  constructor(scene, terrain) {
    this.level = 0;
    this.uni = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uDepth: { value: terrain.depthTexture() }, uHalf: { value: terrain.half }, uTime: { value: 0 },
      uShallow: { value: new THREE.Color(0x5fd0c8) }, uDeep: { value: new THREE.Color(0x1d5f96) },
      uFoam: { value: new THREE.Color(0xf4fbff) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) }, uSky: { value: new THREE.Color(0xbcd6ec) }, uNight: { value: 0 },
    }]);
    this.uni.uTime = U.time;
    const mat = new THREE.ShaderMaterial({ uniforms: this.uni, vertexShader: VS, fragmentShader: FS, transparent: true, fog: true, depthWrite: false });
    const geo = new THREE.PlaneGeometry(terrain.size, terrain.size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = this.level;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }
  update(sky) {
    const u = this.uni;
    u.uSunDir.value.copy(sky.uni.uSunDir.value);
    u.uSunColor.value.copy(sky.sun.color);
    u.uSky.value.copy(sky.uni.uHorizon.value);
    u.uNight.value = sky.night;
    const n = sky.night;
    u.uShallow.value.setHex(0x5fd0c8).lerp(new THREE.Color(0x1f4a5a), n * 0.8);
    u.uDeep.value.setHex(0x1d5f96).lerp(new THREE.Color(0x0a1830), n * 0.8);
    u.uFoam.value.setHex(0xf4fbff).multiplyScalar(1 - n * 0.6);
  }
}
