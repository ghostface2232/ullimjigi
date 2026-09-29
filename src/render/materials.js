// Toon materials with a soft two-band gradient (BotW-like), cool shadow tint,
// drifting cloud shadows, rim lighting, foliage translucency and wind sway,
// outline hulls for characters, and a global aerial-perspective fog.
import * as THREE from 'three';

export const U = {
  time: { value: 0 },
  wind: { value: 1 },
  rimColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
  // Shared noise texture (RGBA tileable fbm), created lazily below.
  noise: { value: null },
  // Cloud shadows: xy = drift offset (m), z = world scale (1/m), w = strength (0 = off)
  cloud: { value: new THREE.Vector4(0, 0, 1 / 900, 0.5) },
  // World-space direction towards the key light (sun or moon)
  sunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
  // Fraction of the key light that still reaches surfaces facing away from it
  // (tinted cool: BotW shadows are bluish, not grey)
  shadeTint: { value: new THREE.Color(0.3, 0.36, 0.52) },
  // Terrain heightmap (HalfFloat, set by Terrain) for ground-contact AO and
  // grime: uv = (xz + x) * y + z
  heightTex: { value: null },
  heightP: { value: new THREE.Vector4(240, 1 / 480, 0, 0) },
};

// ---------------------------------------------------------------------------
// Shared tileable noise texture. R: large fbm (cloud shapes), G: fbm (other
// seed), B: finer fbm, A: value noise. 256² with mipmaps, repeat-wrapped.
function makeNoiseTexture(N = 256) {
  const data = new Uint8Array(N * N * 4);
  const lattice = (P, seed) => {
    const a = new Float32Array(P * P);
    let s = seed >>> 0;
    for (let i = 0; i < a.length; i++) { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; a[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    return a;
  };
  const sm = (t) => t * t * (3 - 2 * t);
  const vnoise = (lat, P, x, y) => {
    const fx = x * P, fy = y * P;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const u = sm(fx - ix), v = sm(fy - iy);
    const x0 = ((ix % P) + P) % P, y0 = ((iy % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
    const a = lat[y0 * P + x0], b = lat[y0 * P + x1], c = lat[y1 * P + x0], d = lat[y1 * P + x1];
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
  const makeFbm = (base, oct, seed) => {
    const lats = [];
    for (let o = 0; o < oct; o++) lats.push({ P: base << o, lat: lattice(base << o, seed + o * 101) });
    return (x, y) => { let s = 0, a = 0.5, n = 0; for (const l of lats) { s += a * vnoise(l.lat, l.P, x, y); n += a; a *= 0.5; } return s / n; };
  };
  const fR = makeFbm(4, 6, 11), fG = makeFbm(6, 5, 71), fB = makeFbm(16, 4, 133), fA = makeFbm(32, 1, 977);
  const stretch = (v) => Math.min(1, Math.max(0, (v - 0.5) * 1.7 + 0.5));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, i = (y * N + x) * 4;
    data[i] = Math.round(stretch(fR(u, v)) * 255);
    data[i + 1] = Math.round(stretch(fG(u, v)) * 255);
    data[i + 2] = Math.round(stretch(fB(u, v)) * 255);
    data[i + 3] = Math.round(fA(u, v) * 255);
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
export function noiseTexture() {
  if (!U.noise.value) U.noise.value = makeNoiseTexture();
  return U.noise.value;
}
noiseTexture();

// ---------------------------------------------------------------------------
// Aerial perspective fog (global ShaderChunk override).
// Distance haze keeps the FogExp2 density curve, adds exponential height fog
// (valleys hazier than peaks), a per-channel extinction bias so far things
// shift towards blue, desaturation with distance, a bluer far-haze color and
// warm in-scattering towards the sun. The extra uniforms are shared plain
// objects: UniformsUtils.clone() copies them by reference, so every material
// (built-in or ShaderMaterial merging UniformsLib.fog) sees the same values.
// With all-zero values the result degrades to classic exp² fog.
export const FOG = {
  sunDir: { x: 0, y: 1, z: 0 },
  sunColor: { x: 0, y: 0, z: 0 },          // in-scatter color (already scaled)
  farColor: { x: 0, y: 0, z: 0, w: 0 },    // rgb far-haze color, w = blend amount
  height: { x: 0, y: 0.05, z: 0, w: 0 },   // x density at base, y falloff (1/m), z base height
};
const FOG_UNIFORMS = {
  fogSunDir: { value: FOG.sunDir },
  fogSunColor: { value: FOG.sunColor },
  fogFarColor: { value: FOG.farColor },
  fogHeight: { value: FOG.height },
};
Object.assign(THREE.UniformsLib.fog, FOG_UNIFORMS);
for (const lib of Object.values(THREE.ShaderLib)) {
  if (lib && lib.uniforms && lib.uniforms.fogColor) Object.assign(lib.uniforms, FOG_UNIFORMS);
}
THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogRay;
#endif`;
THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogRay = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogRay;
  uniform vec3 fogSunDir;
  uniform vec3 fogSunColor;
  uniform vec4 fogFarColor;
  uniform vec4 fogHeight;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
{
  float _fd = length( vFogRay );
  vec3 _rd = vFogRay / max( _fd, 1e-4 );
  #ifdef FOG_EXP2
    float _od = fogDensity * fogDensity * _fd * _fd;
  #else
    float _od = - log( max( 1.0 - smoothstep( fogNear, fogFar, vFogDepth ), 1e-4 ) );
  #endif
  if ( fogHeight.x > 0.0 ) {
    float _b = fogHeight.y;
    float _h0 = clamp( cameraPosition.y - fogHeight.z, -10.0, 400.0 );
    float _dy = clamp( vFogRay.y * _b, -30.0, 30.0 );
    float _k = abs( _dy ) > 1e-3 ? ( 1.0 - exp( - _dy ) ) / _dy : 1.0;
    _od += fogHeight.x * exp( - _b * _h0 ) * _fd * _k;
  }
  vec3 _f = 1.0 - exp( - _od * vec3( 0.84, 0.96, 1.14 ) );
  float _sun = pow( max( dot( _rd, fogSunDir ), 0.0 ), 7.0 );
  vec3 _fc = mix( fogColor, fogFarColor.rgb, fogFarColor.w * smoothstep( 30.0, 380.0, _fd ) );
  _fc += fogSunColor * _sun;
  float _lum = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( _lum ), min( _f.g * 0.45, 0.4 ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, _fc, _f );
}
#endif`;

// ---------------------------------------------------------------------------
let _grad = null;
// Lit fraction of the key light vs. N·L (0 = shade band, 1 = fully lit).
// Soft two-band terminator plus a faint top band.
export function gradientMap() {
  if (_grad) return _grad;
  const n = 64, data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const s = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    const v = 0.9 * s(0.43, 0.54, x) + 0.1 * s(0.8, 0.95, x);
    const b = Math.round(Math.min(1, v) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  _grad = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  _grad.minFilter = _grad.magFilter = THREE.LinearFilter;
  _grad.generateMipmaps = false;
  _grad.needsUpdate = true;
  return _grad;
}

// World-space dissolve (enemy deaths, spirits). uDissolve 0 = solid, 1 = gone.
const DISSOLVE_PARS = `
varying vec3 vDWP;
uniform float uDissolve;
uniform vec3 uDissolveColor;
float _dh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float _dn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(_dh(i), _dh(i+vec3(1,0,0)), f.x), mix(_dh(i+vec3(0,1,0)), _dh(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(_dh(i+vec3(0,0,1)), _dh(i+vec3(1,0,1)), f.x), mix(_dh(i+vec3(0,1,1)), _dh(i+vec3(1,1,1)), f.x), f.y), f.z); }
float _dnoise(){ return _dn(vDWP * 2.6) * 0.65 + _dn(vDWP * 7.0) * 0.35; }
`;
const DISSOLVE_CLIP = `
  #include <clipping_planes_fragment>
  if (uDissolve > 0.0 && _dnoise() < uDissolve * 1.08) discard;
`;
const DISSOLVE_VERT = `
  #include <project_vertex>
  {
    vec4 _dwp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      _dwp = instanceMatrix * _dwp;
    #endif
    vDWP = (modelMatrix * _dwp).xyz;
  }
`;

const RIM_FRAG = `
  if (uDissolve > 0.0) outgoingLight += uDissolveColor * smoothstep(uDissolve * 1.08 + 0.09, uDissolve * 1.08, _dnoise()) * 3.5;
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

// Key-light response. The directional light's shadow-map term and the cloud
// shadow are folded into the band instead of scaling the light, so cast and
// form shadows share the same cool shade color.
const TOON_LIGHT_PARS = `
varying vec3 vViewPosition;
struct ToonMaterial { vec3 diffuseColor; };
uniform sampler2D uNoiseTex;
uniform vec4 uCloud;
uniform vec3 uSunW;
uniform vec3 uShadeTint;
float _dirShadow = 1.0;
float _isDir = 0.0;
float _cloudSh = 1.0;
float _ndlOff = 0.0;
// Foliage mask from the vertex colour alpha (RGBA vertex colours only):
// 1 = leaves, 0 = wood/stone. -1 = not provided (fall back to hue tests).
float _leafM = -1.0;
float cloudShadowAt(vec3 p) {
  if (uCloud.w <= 0.0) return 1.0;
  vec2 q = p.xz + uSunW.xz * ((160.0 - p.y) / max(uSunW.y, 0.25));
  float c = texture2D(uNoiseTex, (q + uCloud.xy) * uCloud.z).r;
  return 1.0 - uCloud.w * smoothstep(0.5, 0.64, c);
}
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  float ndl = dot( geometryNormal, directLight.direction );
  if ( _isDir > 0.5 ) {
    #if defined( TOON_SOFT )
      float g = smoothstep( -0.12, 0.5, ndl + _ndlOff );
    #elif defined( TOON_FOLIAGE )
      float g = smoothstep( -0.28, 0.3, ndl + _ndlOff );
    #elif defined( USE_GRADIENTMAP )
      float g = texture2D( gradientMap, vec2( clamp( ndl * 0.5 + 0.5, 0.0, 1.0 ), 0.5 ) ).r;
    #else
      float g = smoothstep( -0.12, 0.08, ndl );
    #endif
    float lit = g * _dirShadow * _cloudSh;
    vec3 irr = directLight.color * mix( uShadeTint, vec3( 1.0 ), lit );
    reflectedLight.directDiffuse += irr * BRDF_Lambert( material.diffuseColor );
    #ifdef TOON_FOLIAGE
      float tr = pow( clamp( dot( -geometryViewDir, directLight.direction ), 0.0, 1.0 ), 3.0 );
      float leaf = _leafM >= 0.0 ? _leafM : smoothstep( 0.0, 0.06, material.diffuseColor.g - material.diffuseColor.r );
      reflectedLight.directDiffuse += directLight.color * material.diffuseColor * vec3( 1.0, 1.05, 0.7 ) * tr * leaf * 0.32 * ( 0.3 + 0.7 * _dirShadow * _cloudSh );
    #endif
  } else {
    vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
    reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
  }
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;
function toonLightsBegin() {
  return THREE.ShaderChunk.lights_fragment_begin
    .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight ); _isDir = 1.0;')
    .replace(/directLight\.color \*= \( directLight\.visible && receiveShadow \) \? getShadow\( directionalShadowMap/g, '_dirShadow = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap');
}
const LIGHTS_PRE = `
  _cloudSh = cloudShadowAt( vDWP );
  #ifdef TOON_FOLIAGE
    _ndlOff = ( _dn( vDWP * 1.9 ) - 0.5 ) * 0.9;
  #endif
  #ifdef TOON_SOFT
    _ndlOff = ( _dn( vDWP * 0.3 ) - 0.5 ) * 0.25;
  #endif
`;

// Terrain: painterly brush noise, rock strata on steep slopes.
const TERRAIN_VERT_PARS = `varying vec3 vWPos;\nvarying vec3 vWNrm;\n`;
const TERRAIN_FRAG_PARS = `
varying vec3 vWPos;
varying vec3 vWNrm;
float _h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float _vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(_h21(i), _h21(i+vec2(1,0)), f.x), mix(_h21(i+vec2(0,1)), _h21(i+vec2(1,1)), f.x), f.y); }
`;
const TERRAIN_FRAG = `
  #include <color_fragment>
  {
    vec3 wn = normalize(vWNrm);
    float slope = 1.0 - wn.y;
    // painterly brush strokes: anisotropic noise, rotated per region
    vec2 p = vWPos.xz;
    float ang = texture2D(uNoiseTex, p * 0.0021).a * 6.2832;
    mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    vec2 pr = R * p;
    float stroke = texture2D(uNoiseTex, pr * vec2(0.05, 0.16)).b;
    float n1 = _vn(p * 0.45);
    float n2 = _vn(p * 1.9 + 7.0);
    float macro = texture2D(uNoiseTex, p * 0.0037 + 0.31).g;
    float k = 0.9 + 0.1 * n1 + 0.05 * n2 + 0.12 * (stroke - 0.5) + 0.12 * (macro - 0.5);
    // macro hue drift: warm/olive vs. cool/teal patches (mostly on greens)
    float green = smoothstep(0.02, 0.12, diffuseColor.g - max(diffuseColor.r, diffuseColor.b));
    vec3 hue = mix(vec3(1.06, 1.02, 0.86), vec3(0.9, 1.0, 1.08), macro);
    diffuseColor.rgb *= mix(vec3(1.0), hue, green * 0.8) * k;
    // rock strata on cliffs
    float rock = smoothstep(0.2, 0.38, slope);
    if (rock > 0.0) {
      float wob = texture2D(uNoiseTex, p * 0.012).r * 5.0 + _vn(p * 0.3) * 1.2;
      float y = (vWPos.y + wob) * 0.3;
      float fw = fwidth(y);
      float detail = 1.0 - smoothstep(0.08, 0.35, fw);   // fade bands before they alias
      float band = fract(y);
      float bands = smoothstep(0.0, 0.1, band) * smoothstep(1.0, 0.6, band);
      float layer = _h21(vec2(floor(y), 3.1));
      vec3 strata = mix(vec3(0.88, 0.86, 0.9), vec3(1.06, 1.0, 0.92), layer) * mix(0.84, 1.02, bands);
      float chip = _vn(vec2(p.x + p.y, vWPos.y * 2.0) * 1.1);
      strata *= 0.95 + 0.1 * chip;
      diffuseColor.rgb *= mix(vec3(1.0), strata, rock * detail);
    }
  }
`;

// World-space procedural surface detail, chosen per material with opts.tex.
// Subtle on purpose: breaks up flat toon fills without fighting the style.
// Also: ground-contact AO + grime from the terrain heightmap.
const SURFACE_PARS = `
uniform sampler2D uHeightTex;
uniform vec4 uHeightP;
vec2 _hash2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
vec3 _voro(vec2 x){
  vec2 n = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = _hash2(n + g) * 0.76 + 0.12;
    vec2 r = g + o - f; float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = _hash2(n + g + 17.0).x; } else if (d < f2) f2 = d;
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
float groundAbove(vec3 p){
  return p.y - texture2D(uHeightTex, (p.xz + uHeightP.x) * uHeightP.y + uHeightP.z).r;
}
`;
const SURFACE_FRAG = `
  {
    vec3 _wn = transformNormalByInverseViewMatrix(normal, viewMatrix);
    vec3 _an = abs(_wn);
    vec3 _p = vDWP;
    bool _top = _an.y > max(_an.x, _an.z);
    // dominant-plane coords: (across, along) with 'along' vertical on walls
    vec2 _uv = _top ? _p.xz : vec2(_an.x > _an.z ? _p.z : _p.x, _p.y);
    float _above = groundAbove(_p);
    float _leafN = 0.5;
    #ifdef USE_COLOR_ALPHA
      _leafM = clamp(vColor.a, 0.0, 1.0);
    #endif
    #if defined( TEX_PLASTER )
    {
      float mott = texture2D(uNoiseTex, _uv * 0.11).g;
      float brush = texture2D(uNoiseTex, _uv * vec2(0.45, 0.12) + 0.3).b;
      diffuseColor.rgb *= 0.93 + 0.12 * mott + 0.06 * (brush - 0.5);
      float gr = 1.0 - smoothstep(0.05, 0.75 + mott * 0.5, _above);
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.8, 0.74, 0.66), gr * 0.55);
    }
    #elif defined( TEX_WOOD ) || defined( TEX_PLANKS )
    {
      vec2 g = _top ? _p.zx : _uv;
      float fw = fwidth(g.x) * 30.0;
      float grain = texture2D(uNoiseTex, vec2(g.x * 1.1, g.y * 0.05)).b;
      float st = sin(grain * 60.0 + g.x * 9.0) * 0.5 + 0.5;
      float detail = 1.0 - smoothstep(0.4, 1.2, fw);
      diffuseColor.rgb *= 0.92 + (0.12 * st - 0.05) * detail + 0.08 * (texture2D(uNoiseTex, g * 0.15).a - 0.5);
      #ifdef TEX_PLANKS
        float pk = fract(g.x / 0.24);
        float seam = smoothstep(0.0, 0.05, pk) * smoothstep(1.0, 0.95, pk);
        float pid = fract(sin(floor(g.x / 0.24) * 12.9898) * 43758.5453);
        diffuseColor.rgb *= mix(1.0, (0.62 + 0.38 * seam) * (0.92 + 0.14 * pid), detail);
      #endif
      diffuseColor.rgb *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.6, _above));
    }
    #elif defined( TEX_STONE )
    {
      vec2 suv = _top ? _uv * 1.5 : _uv * vec2(1.35, 2.3);
      vec3 v = _voro(suv);
      float fw = fwidth(suv.x) + fwidth(suv.y);
      float detail = 1.0 - smoothstep(0.25, 0.8, fw);
      float mortar = smoothstep(0.035, 0.11, v.y - v.x);
      float tone = 0.86 + 0.22 * v.z;
      vec3 hue = mix(vec3(1.03, 1.0, 0.95), vec3(0.95, 0.98, 1.04), fract(v.z * 7.3));
      float bump = 0.94 + 0.08 * smoothstep(0.0, 0.4, v.x);
      diffuseColor.rgb *= mix(vec3(0.95), hue * tone * mix(0.6, 1.0, mortar) * bump, detail);
      #ifndef NO_MOSS
      float moss = smoothstep(0.55, 0.85, texture2D(uNoiseTex, _p.xz * 0.05 + _p.y * 0.02).g) * (0.4 + 0.6 * (1.0 - smoothstep(0.0, 1.6, _above)));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.8, 0.45), moss * 0.55 * (_top ? 1.0 : 0.6));
      #endif
    }
    #elif defined( TEX_ROOF )
    {
      vec3 rd = normalize(cross(_wn, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
      float along = dot(_p, rd);
      float rc = _p.y / 0.2;
      float row = floor(rc), fr = fract(rc);
      float cc = along / 0.36 + row * 0.5;
      float fc = fract(cc);
      float fw = fwidth(rc) + fwidth(cc);
      float detail = 1.0 - smoothstep(0.35, 0.9, fw);
      float tid = fract(sin(dot(vec2(row, floor(cc)), vec2(12.9898, 78.233))) * 43758.5453);
      float lip = mix(1.06, 0.7, smoothstep(0.62, 1.0, fr));
      float gap = 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.07, min(fc, 1.0 - fc)));
      diffuseColor.rgb *= mix(vec3(1.0), vec3(lip * gap * (0.9 + 0.18 * tid)), detail);
      float moss = smoothstep(0.58, 0.85, texture2D(uNoiseTex, _p.xz * 0.08).g);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.38, 0.2) * dot(diffuseColor.rgb, vec3(0.5)) * 1.6, moss * 0.35);
    }
    #elif defined( TEX_ROCK )
    {
      vec3 w = _an / (_an.x + _an.y + _an.z);
      float cr = texture2D(uNoiseTex, _p.zy * 0.3).b * w.x + texture2D(uNoiseTex, _p.xz * 0.3).b * w.y + texture2D(uNoiseTex, _p.xy * 0.3).b * w.z;
      float fw = fwidth(cr) * 8.0;
      float crack = (1.0 - smoothstep(0.0, 0.02 + fw, abs(cr - 0.5))) * (1.0 - smoothstep(0.5, 1.5, fw));
      float grain = texture2D(uNoiseTex, _uv * 1.2).a;
      diffuseColor.rgb *= (0.9 + 0.16 * grain) * (1.0 - 0.3 * crack);
      #ifndef NO_MOSS
      float moss = smoothstep(0.45, 0.8, _wn.y + (texture2D(uNoiseTex, _p.xz * 0.15).g - 0.5) * 0.6);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.33, 0.1), moss * 0.5);
      #endif
    }
    #elif defined( TEX_BARK )
    {
      float brown = _leafM >= 0.0 ? 1.0 - _leafM : smoothstep(0.0, 0.035, diffuseColor.r - diffuseColor.g);
      if (brown > 0.0) {
        float a = (_an.x > _an.z ? _p.z : _p.x) * 2.2;
        float f = texture2D(uNoiseTex, vec2(a, _p.y * 0.12)).b;
        diffuseColor.rgb *= mix(1.0, mix(0.7, 1.08, smoothstep(0.3, 0.62, f)), brown);
      }
      float green = _leafM >= 0.0 ? _leafM : smoothstep(0.0, 0.05, diffuseColor.g - diffuseColor.r);
      #ifdef LEAFY_EDGE
        _leafN = _dn(_p * 3.3);
      #else
        _leafN = _dn(_p * 3.7);
      #endif
      diffuseColor.rgb *= mix(1.0, 0.84 + 0.3 * _leafN, green);
    }
    #endif
    #ifdef LEAFY_EDGE
    {
      // ragged, leafy crown silhouettes: cut away noisy bits where the
      // (smoothed) foliage normal turns away from the viewer
      float green = _leafM >= 0.0 ? _leafM : smoothstep(0.0, 0.05, diffuseColor.g - diffuseColor.r);
      if (green > 0.5) {
        float e = 1.0 - abs(dot(normal, normalize(vViewPosition)));
        #ifdef TEX_BARK
          float lf = _leafN * 0.55 + _dn(_p * 9.0) * 0.45;
        #else
          float lf = _dn(_p * 3.3) * 0.55 + _dn(_p * 9.0) * 0.45;
        #endif
        if (lf < (e - 0.4) * 1.6) discard;
        diffuseColor.rgb *= 1.0 - 0.18 * smoothstep(0.55, 0.3, lf) * smoothstep(0.2, 0.6, e);
      }
    }
    #endif
    #ifdef TOON_GROUND_AO
    {
      float ao = (1.0 - smoothstep(0.0, 0.6, _above)) * step(-0.8, _above);
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.62, 0.66, 0.74), ao);
    }
    #endif
  }
  #include <lights_toon_fragment>`;

const cache = new Map();

/**
 * Create (or reuse) a toon material.
 * opts: { emissive, emissiveIntensity, rim, vertexColors, flat, side, transparent, opacity, sway, swayBase, terrain, key,
 *         foliage (bool), leafy (ragged crown edges), tex ('plaster'|'wood'|'planks'|'stone'|'roof'|'rock'|'bark'), noAO (bool),
 *         noMoss (bool: no moss on 'stone'/'rock' surfaces) }
 * RGBA vertex colours: alpha is a foliage mask (1 = leaves) for translucency, bark detail and leafy edges.
 */
export function toon(color = 0xffffff, opts = {}) {
  const key = opts.nocache ? null : JSON.stringify([color, opts]);
  if (key && cache.has(key)) return cache.get(key);
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradientMap(),
    vertexColors: !!opts.vertexColors,
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
  const dissolve = { value: 0 };
  const dissolveColor = { value: new THREE.Color(0.8, 0.45, 1.6) };
  m.userData.dissolve = dissolve;
  m.userData.dissolveColor = dissolveColor;
  const isTerrain = !!opts.terrain;
  const hasSway = (opts.sway ?? 0) > 0;
  const foliage = opts.foliage ?? hasSway;
  const texKind = opts.tex || '';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDissolve = dissolve;
    sh.uniforms.uDissolveColor = dissolveColor;
    sh.uniforms.uRim = rim;
    sh.uniforms.uRimColor = U.rimColor;
    sh.uniforms.uTime = U.time;
    sh.uniforms.uWind = U.wind;
    sh.uniforms.uSway = sway;
    sh.uniforms.uSwayBase = swayBase;
    sh.uniforms.uNoiseTex = U.noise;
    sh.uniforms.uCloud = U.cloud;
    sh.uniforms.uSunW = U.sunDir;
    sh.uniforms.uShadeTint = U.shadeTint;
    sh.uniforms.uHeightTex = U.heightTex;
    sh.uniforms.uHeightP = U.heightP;
    let fs = sh.fragmentShader;
    const isToon = fs.includes('#include <lights_toon_pars_fragment>');
    let defs = '';
    if (isToon) {
      if (isTerrain) defs += '#define TOON_SOFT\n';
      else if (foliage) defs += '#define TOON_FOLIAGE\n';
      if (opts.leafy) defs += '#define LEAFY_EDGE\n';
      if (!isTerrain && !opts.noAO) defs += '#define TOON_GROUND_AO\n';
      if (texKind) defs += `#define TEX_${texKind.toUpperCase()}\n`;
      if (opts.noMoss) defs += '#define NO_MOSS\n';
      fs = fs.replace('#include <lights_toon_pars_fragment>', TOON_LIGHT_PARS + SURFACE_PARS)
        .replace('#include <lights_fragment_begin>', LIGHTS_PRE + toonLightsBegin());
      if (!isTerrain) fs = fs.replace('#include <lights_toon_fragment>', SURFACE_FRAG);
    } else {
      fs = 'uniform sampler2D uNoiseTex;\n' + fs;
    }
    fs = fs.replace('#include <opaque_fragment>', RIM_FRAG).replace('#include <clipping_planes_fragment>', DISSOLVE_CLIP);
    sh.fragmentShader = defs + 'uniform float uRim;\nuniform vec3 uRimColor;\n' + DISSOLVE_PARS + fs;
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\nuniform float uSway;\nuniform float uSwayBase;\nvarying vec3 vDWP;\n' + sh.vertexShader.replace('#include <project_vertex>', DISSOLVE_VERT);
    if (hasSway) sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', WIND_VERT);
    if (isTerrain) {
      sh.vertexShader = TERRAIN_VERT_PARS + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normal;');
      sh.fragmentShader = TERRAIN_FRAG_PARS + sh.fragmentShader.replace('#include <color_fragment>', TERRAIN_FRAG);
    }
  };
  m.customProgramCacheKey = () => `toon3|${hasSway}|${isTerrain}|${foliage}|${texKind}|${!!opts.noAO}|${!!opts.leafy}|${!!opts.noMoss}`;
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
