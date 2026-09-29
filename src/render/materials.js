// Toon materials with a soft two-band gradient (BotW-like), rim lighting,
// optional foliage wind sway and outline hulls for characters.
import * as THREE from 'three';

export const U = {
  time: { value: 0 },
  wind: { value: 1 },
  rimColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
};

let _grad = null;
export function gradientMap() {
  if (_grad) return _grad;
  const n = 64, data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const s = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    let v = 0.3 + 0.62 * s(0.44, 0.52, x) + 0.08 * s(0.86, 0.93, x);
    const b = Math.round(Math.min(1, v) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  _grad = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  _grad.minFilter = _grad.magFilter = THREE.LinearFilter;
  _grad.generateMipmaps = false;
  _grad.needsUpdate = true;
  return _grad;
}

const RIM_FRAG = `
  {
    vec3 _vd = normalize(vViewPosition);
    float _r = 1.0 - clamp(dot(normal, _vd), 0.0, 1.0);
    float _lit = clamp(dot(reflectedLight.directDiffuse, vec3(0.6)), 0.0, 1.0);
    outgoingLight += uRimColor * smoothstep(0.5, 1.0, _r) * uRim * (0.35 + 0.65 * _lit);
  }
  #include <opaque_fragment>`;

const WIND_VERT = `
  vec3 transformed = vec3(position);
  #ifdef USE_INSTANCING
    vec3 _ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  #else
    vec3 _ip = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
  #endif
  float _h = max(position.y - uSwayBase, 0.0);
  float _sw = sin(uTime * 1.35 + _ip.x * 0.15 + _ip.z * 0.11) * 0.6 + sin(uTime * 2.7 + _ip.x * 0.37) * 0.25;
  transformed.x += _sw * uWind * _h * uSway;
  transformed.z += cos(uTime * 1.1 + _ip.z * 0.2) * uWind * _h * uSway * 0.6;
`;

const TERRAIN_VERT_PARS = `varying vec3 vWPos;\n`;
const TERRAIN_FRAG_PARS = `
varying vec3 vWPos;
float _h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float _vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(_h21(i), _h21(i+vec2(1,0)), f.x), mix(_h21(i+vec2(0,1)), _h21(i+vec2(1,1)), f.x), f.y); }
`;
const TERRAIN_FRAG = `
  #include <color_fragment>
  {
    float n1 = _vn(vWPos.xz * 0.45);
    float n2 = _vn(vWPos.xz * 1.9 + 7.0);
    float n3 = _vn(vWPos.xz * 0.06 + 3.0);
    float n4 = _vn(vec2(vWPos.x * 0.9 + vWPos.z * 0.3, vWPos.z * 2.6));
    diffuseColor.rgb *= 0.88 + 0.12 * n1 + 0.06 * n2 + 0.10 * (n3 - 0.5) + 0.04 * n4;
  }
`;

const cache = new Map();

/**
 * Create (or reuse) a toon material.
 * opts: { emissive, emissiveIntensity, rim, vertexColors, flat, side, transparent, opacity, sway, swayBase, terrain, key }
 */
export function toon(color = 0xffffff, opts = {}) {
  const key = opts.nocache ? null : JSON.stringify([color, opts]);
  if (key && cache.has(key)) return cache.get(key);
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradientMap(),
    vertexColors: !!opts.vertexColors,
    flatShading: !!opts.flat,
    side: opts.side ?? THREE.FrontSide,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    depthWrite: opts.depthWrite ?? true,
  });
  patch(m, opts);
  if (key) cache.set(key, m);
  return m;
}

export function patch(m, opts = {}) {
  const rim = { value: opts.rim ?? 0.28 };
  m.userData.rim = rim;
  const sway = { value: opts.sway ?? 0 };
  const swayBase = { value: opts.swayBase ?? 0 };
  m.userData.sway = sway;
  const isTerrain = !!opts.terrain;
  const hasSway = (opts.sway ?? 0) > 0;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = rim;
    sh.uniforms.uRimColor = U.rimColor;
    sh.uniforms.uTime = U.time;
    sh.uniforms.uWind = U.wind;
    sh.uniforms.uSway = sway;
    sh.uniforms.uSwayBase = swayBase;
    sh.fragmentShader = 'uniform float uRim;\nuniform vec3 uRimColor;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', RIM_FRAG);
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\nuniform float uSway;\nuniform float uSwayBase;\n' + sh.vertexShader;
    if (hasSway) sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', WIND_VERT);
    if (isTerrain) {
      sh.vertexShader = TERRAIN_VERT_PARS + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = TERRAIN_FRAG_PARS + sh.fragmentShader.replace('#include <color_fragment>', TERRAIN_FRAG);
    }
  };
  m.customProgramCacheKey = () => `toon|${hasSway}|${isTerrain}`;
  return m;
}

// Outline hull (inverted normals extrusion)
const outlineCache = new Map();
export function outlineMat(color = 0x1a1410, width = 0.025) {
  const key = color + '|' + width;
  if (outlineCache.has(key)) return outlineCache.get(key);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  const w = { value: width };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uOutline = w;
    sh.vertexShader = 'uniform float uOutline;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normalize(normal) * uOutline;');
  };
  m.customProgramCacheKey = () => 'outline';
  outlineCache.set(key, m);
  return m;
}

export function addOutline(mesh, width = 0.025, color = 0x1a1410) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat(color, width));
  o.castShadow = false; o.receiveShadow = false;
  o.userData.isOutline = true;
  mesh.add(o);
  return o;
}

// Additive glowing material (HDR colors > 1 feed bloom)
const glowCache = new Map();
export function glowMat(color, intensity = 2, opts = {}) {
  const key = color + '|' + intensity + '|' + JSON.stringify(opts);
  if (!opts.nocache && glowCache.has(key)) return glowCache.get(key);
  const c = new THREE.Color(color).multiplyScalar(intensity);
  const m = new THREE.MeshBasicMaterial({
    color: c, transparent: true, opacity: opts.opacity ?? 1,
    blending: opts.normal ? THREE.NormalBlending : THREE.AdditiveBlending,
    depthWrite: false, side: opts.side ?? THREE.FrontSide, fog: opts.fog ?? true, toneMapped: true,
  });
  if (!opts.nocache) glowCache.set(key, m);
  return m;
}

// Emissive-only unlit material for lit windows, crystals etc.
export function emissiveMat(color, intensity = 1.5) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
}

// Fresnel glow shader (orbs, spirits, shields)
export function fresnelMat(core, edge, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCore: { value: new THREE.Color(core) },
      uEdge: { value: new THREE.Color(edge) },
      uIntensity: { value: opts.intensity ?? 2.5 },
      uAlpha: { value: opts.alpha ?? 1 },
      uTime: U.time,
      uPow: { value: opts.power ?? 1.6 },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uCore, uEdge; uniform float uIntensity, uAlpha, uTime, uPow;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPow);
        float flick = 0.9 + 0.1 * sin(uTime * 17.0 + vP.y * 9.0);
        vec3 col = mix(uCore, uEdge, f) * uIntensity * flick;
        float a = mix(0.85, 1.0, f) * uAlpha;
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: opts.normal ? THREE.NormalBlending : THREE.AdditiveBlending,
    side: opts.side ?? THREE.FrontSide,
  });
}

// Ghostly material for memory echoes and spirits
export function ghostMat(color = 0xbfe8ff, alpha = 0.55) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha }, uTime: U.time },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vY = wp.y;
        vec4 mv = viewMatrix * wp; vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uAlpha, uTime; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.4);
        float scan = 0.75 + 0.25 * sin(vY * 22.0 - uTime * 4.0);
        float a = (0.18 + f * 0.9) * uAlpha * scan;
        gl_FragColor = vec4(uColor * (1.4 + f * 1.6) * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
