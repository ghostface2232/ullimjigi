// Stylized water: depth-tinted body, animated normals, fresnel sky
// reflection, sun specular + glints, caustic shimmer in the shallows,
// cloud shadows and animated shoreline foam.
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
uniform vec3 uShallow, uDeep, uFoam, uSunDir, uSunColor, uSky, uSkyTop;
uniform float uNight;
uniform vec4 uCloud;
varying vec3 vW;
#include <fog_pars_fragment>
vec2 nrm2(vec2 uv){ vec4 t = texture2D(uNoiseTex, uv); return vec2(t.b, t.a) * 2.0 - 1.0; }
void main(){
  vec2 uv = (vW.xz + uHalf) / (2.0 * uHalf);
  float depth = texture2D(uDepth, uv).r * 12.0 - 2.0;
  if (depth < -0.05) discard;
  vec2 p = vW.xz;
  vec3 V = normalize(cameraPosition - vW);
  float dist = length(cameraPosition - vW);
  // animated normals: two scrolling layers + slow large swell
  vec2 n1 = nrm2(p * 0.045 + vec2(uTime * 0.012, uTime * 0.008));
  vec2 n2 = nrm2(p * 0.11 - vec2(uTime * 0.017, -uTime * 0.013));
  vec2 n3 = nrm2(p * 0.013 + vec2(-uTime * 0.004, uTime * 0.003));
  vec2 nd = (n1 * 0.5 + n2 * 0.3 + n3 * 0.45) * mix(0.22, 0.08, smoothstep(15.0, 120.0, dist));
  vec3 N = normalize(vec3(nd.x, 1.0, nd.y));
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.04 + 0.96 * pow(1.0 - ndv, 4.0);
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
  // sky reflection (fresnel)
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSky, uSkyTop, smoothstep(0.0, 0.9, R.y) * 0.6);
  vec3 col = mix(body, sky, clamp(fres, 0.0, 1.0) * 0.7);
  // sun specular: soft sheen + crisp toon glints
  float rs = max(dot(R, uSunDir), 0.0);
  col += uSunColor * (pow(rs, 60.0) * 0.35 + smoothstep(0.985, 0.992, rs) * 1.6) * cloud * (1.0 - uNight * 0.8);
  float sp = step(0.93, texture2D(uNoiseTex, p * 0.9 + n2 * 0.2 + uTime * 0.05).a) * pow(rs, 4.0);
  col += uSunColor * sp * 0.9 * cloud * (1.0 - uNight);
  // shoreline foam: solid lip + bands rolling in towards the shore, broken by noise
  float fn = texture2D(uNoiseTex, p * 0.18 + vec2(uTime * 0.02, 0.0)).g;
  float band = sin(depth * 5.0 - uTime * 1.7 + fn * 5.0);
  float lip = smoothstep(0.42, 0.05, depth + (fn - 0.5) * 0.3);
  float bands = smoothstep(0.7, 0.95, band) * smoothstep(1.5, 0.25, depth) * smoothstep(0.35, 0.65, fn);
  float foam = clamp(lip + bands * 0.8, 0.0, 1.0);
  col = mix(col, uFoam * (0.75 + 0.25 * cloud), foam * 0.9);
  float alpha = clamp(0.5 + smoothstep(0.0, 2.2, depth) * 0.42 + foam * 0.4 + fres * 0.2, 0.0, 0.97);
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
      uSunColor: { value: new THREE.Color(1, 1, 1) }, uSky: { value: new THREE.Color(0xbcd6ec) }, uSkyTop: { value: new THREE.Color(0x3f7fd8) },
      uNight: { value: 0 },
    }]);
    this.uni.uTime = U.time;
    this.uni.uCloud = U.cloud;
    this.uni.uNoiseTex = { value: noiseTexture() };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uni, vertexShader: VS, fragmentShader: FS, transparent: true, fog: true, depthWrite: false });
    const geo = new THREE.PlaneGeometry(terrain.size, terrain.size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = this.level;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this._c = new THREE.Color();
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
