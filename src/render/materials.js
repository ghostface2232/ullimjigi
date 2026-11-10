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
  // Wildfire burn map on the heightmap grid (same uv as heightTex): R = scorched, G = burning
  burnTex: { value: (() => { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1); t.needsUpdate = true; return t; })() },
  // Rain wetness of exposed surfaces, 0..1 (set by Weather)
  wet: { value: 0 },
  // See-through foliage: leaves on the line from the camera (a) to the player (b) within radius r thin out (dithered)
  seeA: { value: new THREE.Vector3() },
  seeB: { value: new THREE.Vector3() },
  seeR: { value: 0 },
  // Leaf-clump atlas for foliage cards (created lazily by leafTexture())
  leaf: { value: null },
  // Surface detail arrays (surfaces.js, baked by the Renderer) and the terrain's ground-layer
  // weights on the heightmap grid: R grass, G earth, B sand, A snow (the rest is rock / paving)
  surfA: { value: null },
  surfN: { value: null },
  splatTex: { value: null },
  paveTex: { value: null },
  // sky colour mirrored by glossy and wet surfaces (set by Sky)
  skyRefl: { value: new THREE.Color(0.5, 0.6, 0.75) },
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
// Leaf-clump atlas (2x2 variants) for foliage cards: alpha = leaf shapes, rgb = a tint
// multiplier (leaves underneath are darker, each has a lit and a shaded half and a midrib).
// Colour and coverage are drawn on separate canvases so the tint does not go dark where
// the alpha fades (canvas pixels are premultiplied).
function makeLeafTexture(S = 512) {
  const C = S / 2;
  const mk = () => { const cv = document.createElement('canvas'); cv.width = cv.height = S; return cv.getContext('2d'); };
  const gc = mk(), ga = mk();
  gc.fillStyle = 'rgb(170,170,170)'; gc.fillRect(0, 0, S, S);
  ga.fillStyle = '#000'; ga.fillRect(0, 0, S, S);
  let s = 90210;
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const grey = (v) => { const k = Math.round(Math.min(255, Math.max(0, v))); return 'rgb(' + k + ',' + k + ',' + k + ')'; };
  for (let v = 0; v < 4; v++) {
    const cx = (v % 2) * C + C / 2, cy = Math.floor(v / 2) * C + C / 2;
    const n = 18 + v * 3;
    for (let i = 0; i < n; i++) {
      const under = i < n * 0.45;
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.26 * C;
      const L = (0.17 + rnd() * 0.06) * C * (under ? 1.08 : 1), W = L * (0.42 + rnd() * 0.14);
      const rot = a + (rnd() - 0.5) * 1.6;
      const tone = under ? 132 + rnd() * 28 : 206 + rnd() * 48;
      for (const g of [gc, ga]) {
        g.save();
        g.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d); g.rotate(rot); g.translate(-L * 0.35, 0);
        g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(L * 0.42, -W, L, 0); g.quadraticCurveTo(L * 0.42, W, 0, 0); g.closePath();
        if (g === ga) { g.fillStyle = '#fff'; g.fill(); } else {
          const gr = g.createLinearGradient(0, -W * 0.5, 0, W * 0.5);
          gr.addColorStop(0, grey(tone * 1.04)); gr.addColorStop(0.5, grey(tone)); gr.addColorStop(0.52, grey(tone * 0.88)); gr.addColorStop(1, grey(tone * 0.82));
          g.fillStyle = gr; g.fill();
          g.strokeStyle = grey(tone * 0.7); g.lineWidth = S / 512; g.stroke();
        }
        g.restore();
      }
    }
  }
  const dc = gc.getImageData(0, 0, S, S).data, da = ga.getImageData(0, 0, S, S).data;
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S * 4; i += 4) { data[i] = dc[i]; data[i + 1] = dc[i + 1]; data[i + 2] = dc[i + 2]; data[i + 3] = da[i]; }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
export function leafTexture() {
  if (!U.leaf.value) U.leaf.value = makeLeafTexture();
  return U.leaf.value;
}

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
    // exp² up to 240 m (the vale's near look), then growing only linearly, so ridges and
    // landmarks half a kilometre away and more stay readable as hazy silhouettes
    float _dn = min( _fd, 240.0 );
    float _od = fogDensity * fogDensity * ( _dn * _dn + 140.0 * max( _fd - 240.0, 0.0 ) );
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
const SEE_PARS = `
uniform vec3 uSeeA;
uniform vec3 uSeeB;
uniform float uSeeR;
// 0..1: how much a leaf at p should dissolve so the player stays visible through the canopy
float seeFade(vec3 p){
  if (uSeeR <= 0.0) return 0.0;
  vec3 ab = uSeeB - uSeeA;
  float L = max(length(ab), 0.001);
  float s = clamp(dot(p - uSeeA, ab) / (L * L), 0.0, 1.0);
  float d = length(p - (uSeeA + ab * s));
  float inFront = 1.0 - smoothstep(L - 1.8, L - 0.6, s * L);
  float tube = (1.0 - smoothstep(uSeeR * 0.55, uSeeR, d)) * inFront;
  float close = 1.0 - smoothstep(1.2, 3.4, distance(p, uSeeA));
  return max(tube, close);
}
`;
const DISSOLVE_CLIP = `
  #include <clipping_planes_fragment>
  if (uDissolve > 0.0 && _dnoise() < uDissolve * 1.08) discard;
  #ifdef LEAF_CARDS
  if (vCard.z >= 0.0) {
    // one of the four clumps in the atlas; edges go to MSAA coverage (alphaToCoverage)
    float _v = floor(vCard.z * 3.999);
    vec4 _lf = texture2D(uLeafTex, (clamp(vCard.xy, 0.01, 0.99) + vec2(mod(_v, 2.0), floor(_v * 0.5))) * 0.5, -0.75);
    float _a = clamp((_lf.a - 0.42) / max(fwidth(_lf.a), 0.02) + 0.5, 0.0, 1.0);
    if (_a < 0.03) discard;
    diffuseColor.a = _a;
    diffuseColor.rgb *= _lf.rgb * 1.22;
    _isCard = 1.0;
  }
  #endif
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
  #ifdef LEAF_CARDS
    // foliage card: its four vertices sit at one point and spread out facing the viewer,
    // each card turned by its seed and rustling a little in the wind
    vCard = vec3(0.0, 0.0, -1.0);
    if (aCard.z > 0.0) {
      float _cs = length(modelMatrix[0].xyz);
      #ifdef USE_INSTANCING
        _cs *= (length(instanceMatrix[0].xyz) + length(instanceMatrix[1].xyz)) * 0.5;
      #endif
      float _cr = aCard.w * 6.2831853 + sin(uTime * (1.1 + aCard.w * 1.7) + aCard.w * 47.0) * 0.13 * uWind;
      float _cc = cos(_cr), _sn = sin(_cr);
      mvPosition.xy += vec2(aCard.x * _cc - aCard.y * _sn, aCard.x * _sn + aCard.y * _cc) * aCard.z * _cs;
      gl_Position = projectionMatrix * mvPosition;
      vCard = vec3(aCard.xy * 0.5 + 0.5, aCard.w);
    }
  #endif
`;

const RIM_FRAG = `
  if (uDissolve > 0.0) outgoingLight += uDissolveColor * smoothstep(uDissolve * 1.08 + 0.09, uDissolve * 1.08, _dnoise()) * 3.5;
  {
    vec3 _vd = normalize(vViewPosition);
    float _r = 1.0 - clamp(dot(normal, _vd), 0.0, 1.0);
    float _lit = clamp(dot(reflectedLight.directDiffuse, vec3(0.6)), 0.0, 1.0);
    outgoingLight += uRimColor * smoothstep(0.5, 1.0, _r) * uRim * (0.35 + 0.65 * _lit);
    #ifdef SURF_SPEC
      // the sky in smooth and wet surfaces, strongest at grazing angles
      float _gl = 1.0 - _rough;
      outgoingLight += uSkyRefl * ((0.04 + 0.96 * _r * _r * _r * _r * _r) * _gl * _gl * _cav * _specK);
    #endif
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

// Key-light response (the sky's SunLight). Its shadow-map term and the cloud
// shadow are folded into the band instead of scaling the light, so cast and
// form shadows share the same cool shade color. Surfaces with a detail layer
// (surfaces.js) shade their relief with a softer ramp, a GGX highlight and a cavity term.
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
// detail-layer response: roughness, highlight strength (0 = none), cavity (1 = open)
float _rough = 0.9;
float _specK = 0.0;
float _cav = 1.0;
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
      float g = smoothstep( -0.16, 0.56, ndl + _ndlOff );
    #elif defined( TOON_FOLIAGE )
      float g = smoothstep( -0.28, 0.3, ndl + _ndlOff );
    #elif defined( SURF_LAYER )
      float g = smoothstep( -0.14, 0.42, ndl );
    #elif defined( USE_GRADIENTMAP )
      float g = texture2D( gradientMap, vec2( clamp( ndl * 0.5 + 0.5, 0.0, 1.0 ), 0.5 ) ).r;
    #else
      float g = smoothstep( -0.12, 0.08, ndl );
    #endif
    float lit = g * _dirShadow * _cloudSh;
    vec3 irr = directLight.color * mix( uShadeTint, vec3( 1.0 ), lit ) * mix( 1.0, _cav, 0.55 );
    reflectedLight.directDiffuse += irr * BRDF_Lambert( material.diffuseColor );
    if ( _specK > 0.0 ) {
      vec3 hv = normalize( directLight.direction + geometryViewDir );
      float nh = max( dot( geometryNormal, hv ), 0.0 ), a = _rough * _rough, a2 = a * a;
      float dd = nh * nh * ( a2 - 1.0 ) + 1.0;
      float fr = 0.04 + 0.96 * pow( 1.0 - max( dot( hv, geometryViewDir ), 0.0 ), 5.0 );
      reflectedLight.directDiffuse += directLight.color * ( min( a2 / ( 3.14159 * dd * dd ), 40.0 ) * fr * 0.25 * _specK * lit * max( ndl, 0.0 ) * _cav );
    }
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
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor ) * _cav;
}
#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;
function toonLightsBegin() {
  return THREE.ShaderChunk.lights_fragment_begin
    .replace('getSunLightInfo( sunLight, directLight );', 'getSunLightInfo( sunLight, directLight ); _isDir = 1.0;')
    .replace('directLight.color *= ( directLight.visible && receiveShadow ) ? getSunShadow( sunShadowMap', '_dirShadow = ( directLight.visible && receiveShadow ) ? getSunShadow( sunShadowMap');
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

// Terrain: macro brush variation on the vertex-painted palette, then the ground layers
// (turf, earth, rock, sand, snow, paving) blended by the splat map and by their heights.
const TERRAIN_VERT_PARS = `varying vec3 vWPos;\nvarying vec3 vWNrm;\n`;
const TERRAIN_FRAG_PARS = `
uniform sampler2D uBurnTex;
uniform sampler2D uSplatTex;
uniform sampler2D uPaveTex;
uniform float uWet;
varying vec3 vWPos;
varying vec3 vWNrm;
// cliff mesh (terrain.js skinMesh): rock or ground is decided by the slope of the surface
vec3 _fn = vec3(0.0, 1.0, 0.0);
float _rockK = 0.0;
#ifdef CLIFF_SKIN
varying vec3 vRock;
varying vec2 vEdge; // x: rim / crease, y: grass top
#endif
float _h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float _vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(_h21(i), _h21(i+vec2(1,0)), f.x), mix(_h21(i+vec2(0,1)), _h21(i+vec2(1,1)), f.x), f.y); }
`;
const TERRAIN_FRAG = `
  #include <color_fragment>
  #ifdef CLIFF_SKIN
  {
    _fn = normalize(vWNrm);
    // the tops of the gentler masses keep the ground's colour and grass; the rest is rock
    _rockK = 1.0 - smoothstep(0.4, 0.6, vEdge.y);
    vec3 rk = vRock;
    // faces turned to the sky are paler and warmer than the ones that lean out
    float up = smoothstep(-0.2, 0.7, _fn.y);
    rk *= (0.88 + 0.2 * up) * mix(vec3(0.95, 0.98, 1.05), vec3(1.05, 1.0, 0.94), up);
    // light gathers on the worn rims of the masses and drains from the creases between them
    rk *= 1.0 + pow(max(vEdge.x, 0.0), 0.7) * 0.5 - max(-vEdge.x, 0.0) * 0.45;
    // moss creeps over the lip from the grass above
    rk = mix(rk, diffuseColor.rgb * vec3(0.72, 0.8, 0.62), smoothstep(0.02, 0.4, vEdge.y) * 0.6);
    diffuseColor.rgb = mix(diffuseColor.rgb, rk, _rockK);
  }
  #endif
  {
    // painterly brush strokes: anisotropic noise, rotated per region
    vec2 p = vWPos.xz;
    float ang = texture2D(uNoiseTex, p * 0.0021).a * 6.2832;
    mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    vec2 pr = R * p;
    float stroke = texture2D(uNoiseTex, pr * vec2(0.05, 0.16)).b;
    float macro = texture2D(uNoiseTex, p * 0.0037 + 0.31).g;
    float k = 0.94 + 0.1 * (stroke - 0.5) + 0.14 * (macro - 0.5);
    // macro hue drift: warm/olive vs. cool/teal patches (mostly on greens)
    float green = smoothstep(0.02, 0.12, diffuseColor.g - max(diffuseColor.r, diffuseColor.b));
    vec3 hue = mix(vec3(1.06, 1.02, 0.86), vec3(0.9, 1.0, 1.08), macro);
    diffuseColor.rgb *= mix(vec3(1.0), hue, green * 0.8) * k;
  }
`;
// at the lighting stage (the normal exists by then): ground layers, wildfire, rain
const TERRAIN_SURF = `
  {
    vec3 wn = normalize(vWNrm);
    vec2 p = vWPos.xz;
    vec2 guv = (p + uHeightP.x) * uHeightP.y + uHeightP.z;
    vec4 sp = texture2D(uSplatTex, guv);
    #ifdef CLIFF_SKIN
      wn = _fn;
      // rock on the steep facets; grass (or snow, high up) on the tops
      sp = vec4((1.0 - _rockK) * (1.0 - sp.a), 0.0, 0.0, (1.0 - _rockK) * sp.a);
      float wRock = _rockK, wPave = 0.0;
    #else
      float slope = 1.0 - wn.y;
      float rest = clamp(1.0 - sp.r - sp.g - sp.b - sp.a, 0.0, 1.0);
      float wRock = rest * smoothstep(0.05, 0.24, slope), wPave = rest - wRock;
      // level bare ground is flagstones only where it was laid; elsewhere weathered stone
      float wBare = wPave * (1.0 - texture2D(uPaveTex, guv).r);
      wPave -= wBare;
    #endif
    vec3 alb = vec3(0.0), dW = vec3(0.0);
    float rgh = 0.0, cav = 0.0, ws = 0.0;
    vec4 a_, n_; float w_;
    // a layer wins where its own relief stands higher (grass between pebbles, not a blur)
    #define GROUND(L, UV, W0, TX, BX) if (W0 > 0.004) { a_ = texture(uSurfA, vec3(UV, L)); n_ = texture(uSurfN, vec3(UV, L)); w_ = W0 * (0.3 + a_.a); w_ *= w_; w_ *= w_; alb += a_.rgb * w_; dW += (TX * (n_.r * 2.0 - 1.0) + BX * (n_.g * 2.0 - 1.0)) * w_; rgh += n_.b * w_; cav += n_.a * w_; ws += w_; }
    const vec3 X = vec3(1.0, 0.0, 0.0), Y = vec3(0.0, 1.0, 0.0), Z = vec3(0.0, 0.0, 1.0);
    GROUND(0.0, p / 4.0, sp.r, X, Z)
    GROUND(1.0, p / 3.0, sp.g, X, Z)
    GROUND(3.0, p / 3.0, sp.b, X, Z)
    GROUND(4.0, p / 4.0, sp.a, X, Z)
    GROUND(10.0, p / 2.8, wPave, X, Z)
    #ifndef CLIFF_SKIN
    GROUND(12.0, p / 5.0, wBare, X, Z)
    #endif
    if (wRock > 0.004) {
      // rock: project from the sides so the brush strokes run up the face
      float bx = abs(wn.x), bz = abs(wn.z), bs = max(bx + bz, 1e-3);
      float wx = wRock * bx / bs, wz = wRock * bz / bs;
      GROUND(2.0, vWPos.zy / 7.0, wx, Z, Y)
      GROUND(2.0, vWPos.xy / 7.0, wz, X, Y)
    }
    if (ws > 0.0) {
      float iw = 1.0 / ws;
      diffuseColor.rgb *= alb * iw * 2.0;
      normal = normalize((viewMatrix * vec4(normalize(wn + dW * iw * 1.15), 0.0)).xyz);
      _rough = rgh * iw; _cav = cav * iw; _specK = 1.0;
    }
    #ifdef CLIFF_SKIN
      _cav *= 1.0 - 0.4 * max(-vEdge.x, 0.0) * _rockK;
    #endif
    // wildfire: scorched ground (patchy ash) and a hot rim while burning
    vec4 burn = texture2D(uBurnTex, guv);
    if (burn.r + burn.g > 0.002) {
      float ashN = _vn(p * 1.3);
      vec3 ash = mix(vec3(0.16, 0.14, 0.13), vec3(0.34, 0.3, 0.27), ashN);
      diffuseColor.rgb = mix(diffuseColor.rgb, ash, burn.r * (0.75 + 0.25 * ashN) * (1.0 - wRock * 0.6));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.08, 0.04), burn.g * 0.6);
    }
    // rain: darker, more saturated ground with a wet sheen
    diffuseColor.rgb *= 1.0 - uWet * (0.22 + 0.12 * wRock);
    _rough = mix(_rough, 0.22, uWet * 0.75);
  }
  #include <lights_toon_fragment>`;

// World-space surface detail, chosen per material with opts.tex: a baked layer from
// surfaces.js (albedo, relief, roughness) mapped on the dominant plane, plus ground-contact
// grime and moss. Also: ground-contact AO from the terrain heightmap.
const SURFACE_PARS = `
uniform sampler2D uHeightTex;
uniform vec4 uHeightP;
uniform sampler2DArray uSurfA;
uniform sampler2DArray uSurfN;
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
    vec3 _tx = (_top || _an.z >= _an.x) ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
    vec3 _bx = _top ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    float _above = groundAbove(_p);
    float _leafN = 0.5;
    #ifdef USE_COLOR_ALPHA
      _leafM = clamp(vColor.a, 0.0, 1.0);
    #endif
    #ifdef LEAF_CARDS
      // only card edges go to coverage: the vertex colour's alpha is the leaf mask (0 on
      // wood), which would otherwise make trunks vanish under alphaToCoverage
      if (_isCard < 0.5) diffuseColor.a = 1.0;
    #endif
    #ifdef SURF_LAYER
    {
      vec4 sa, sn; vec3 dW;
      float mixK = 1.0;
      #if defined( TEX_ROOF )
        // courses follow the eaves: across = along the ridge, up = world height
        vec3 rd = normalize(cross(_wn, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
        vec2 suv = vec2(dot(_p, rd) / 1.8, _p.y / 1.6);
        sa = texture(uSurfA, vec3(suv, SURF_LAYER)); sn = texture(uSurfN, vec3(suv, SURF_LAYER));
        dW = rd * (sn.r * 2.0 - 1.0) + normalize(vec3(0.0, 1.0, 0.0) - _wn * _wn.y + 1e-4) * (sn.g * 2.0 - 1.0);
      #elif defined( TEX_ROCK ) || defined( TEX_BARK )
        // rounded shapes: blend the three (rock) or two side (bark) projections
        vec3 bw = _an * _an;
        #ifdef TEX_BARK
          bw.y = 0.0;
          mixK = _leafM >= 0.0 ? 1.0 - _leafM : smoothstep(0.0, 0.035, diffuseColor.r - diffuseColor.g);
        #endif
        bw /= max(bw.x + bw.y + bw.z, 1e-4);
        vec4 ax = texture(uSurfA, vec3(_p.zy / SURF_TILE, SURF_LAYER)), nx = texture(uSurfN, vec3(_p.zy / SURF_TILE, SURF_LAYER));
        vec4 az = texture(uSurfA, vec3(_p.xy / SURF_TILE, SURF_LAYER)), nz = texture(uSurfN, vec3(_p.xy / SURF_TILE, SURF_LAYER));
        sa = ax * bw.x + az * bw.z; sn = nx * bw.x + nz * bw.z;
        dW = (vec3(0.0, 0.0, 1.0) * (nx.r * 2.0 - 1.0) + vec3(0.0, 1.0, 0.0) * (nx.g * 2.0 - 1.0)) * bw.x
           + (vec3(1.0, 0.0, 0.0) * (nz.r * 2.0 - 1.0) + vec3(0.0, 1.0, 0.0) * (nz.g * 2.0 - 1.0)) * bw.z;
        #ifdef TEX_ROCK
          vec4 ay = texture(uSurfA, vec3(_p.xz / SURF_TILE, SURF_LAYER)), ny = texture(uSurfN, vec3(_p.xz / SURF_TILE, SURF_LAYER));
          sa += ay * bw.y; sn += ny * bw.y;
          dW += (vec3(1.0, 0.0, 0.0) * (ny.r * 2.0 - 1.0) + vec3(0.0, 0.0, 1.0) * (ny.g * 2.0 - 1.0)) * bw.y;
        #endif
      #else
        #if defined( TEX_WOOD ) || defined( TEX_PLANKS )
          // boards run along the longer world axis of a floor, up a wall
          vec2 suv = (_top ? _p.zx : _uv) / SURF_TILE;
          if (_top) { _tx = vec3(0.0, 0.0, 1.0); _bx = vec3(1.0, 0.0, 0.0); }
        #else
          vec2 suv = _uv / SURF_TILE;
        #endif
        sa = texture(uSurfA, vec3(suv, SURF_LAYER)); sn = texture(uSurfN, vec3(suv, SURF_LAYER));
        dW = _tx * (sn.r * 2.0 - 1.0) + _bx * (sn.g * 2.0 - 1.0);
      #endif
      diffuseColor.rgb *= mix(vec3(1.0), sa.rgb * 2.0, mixK);
      _wn = normalize(_wn + dW * (SURF_BUMP * mixK));
      normal = normalize((viewMatrix * vec4(_wn, 0.0)).xyz);
      _rough = mix(0.9, sn.b, mixK); _cav = mix(1.0, sn.a, mixK); _specK = mixK;
    }
    #endif
    #if defined( TEX_PLASTER )
    {
      // damp, dirty foot of a wall
      float mott = texture2D(uNoiseTex, _uv * 0.11).g;
      float gr = 1.0 - smoothstep(0.05, 0.75 + mott * 0.5, _above);
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.8, 0.74, 0.66), gr * 0.55);
    }
    #elif defined( TEX_WOOD ) || defined( TEX_PLANKS )
    {
      diffuseColor.rgb *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.6, _above));
    }
    #elif defined( TEX_STONE )
    {
      #ifndef NO_MOSS
      float moss = smoothstep(0.55, 0.85, texture2D(uNoiseTex, _p.xz * 0.05 + _p.y * 0.02).g) * (0.4 + 0.6 * (1.0 - smoothstep(0.0, 1.6, _above)));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.8, 0.45), moss * 0.55 * (_top ? 1.0 : 0.6));
      #endif
    }
    #elif defined( TEX_ROOF )
    {
      float moss = smoothstep(0.58, 0.85, texture2D(uNoiseTex, _p.xz * 0.08).g);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.38, 0.2) * dot(diffuseColor.rgb, vec3(0.5)) * 1.6, moss * 0.35);
    }
    #elif defined( TEX_ROCK )
    {
      #ifndef NO_MOSS
      float moss = smoothstep(0.45, 0.8, _wn.y + (texture2D(uNoiseTex, _p.xz * 0.15).g - 0.5) * 0.6);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.33, 0.1), moss * 0.5);
      _rough = mix(_rough, 0.95, moss);
      #endif
    }
    #elif defined( TEX_BARK )
    {
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
        if (_isCard < 0.5) {
          float e = 1.0 - abs(dot(normal, normalize(vViewPosition)));
          #ifdef TEX_BARK
            float lf = _leafN * 0.55 + _dn(_p * 9.0) * 0.45;
          #else
            float lf = _dn(_p * 3.3) * 0.55 + _dn(_p * 9.0) * 0.45;
          #endif
          if (lf < (e - 0.4) * 1.6) discard;
          diffuseColor.rgb *= 1.0 - 0.18 * smoothstep(0.55, 0.3, lf) * smoothstep(0.2, 0.6, e);
        }
        float _sf = seeFade(_p);
        if (_sf > 0.0) {
          float _ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (_ign < _sf * 0.88) discard;
        }
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

// opts.tex -> [layer in the surface arrays, tile size (m), relief strength]
const SURF_OF = { plaster: [6, 2.6, 0.7], wood: [11, 1.0, 0.8], planks: [7, 1.5, 0.9], stone: [5, 2.2, 1.0], roof: [8, 1.6, 1.0], rock: [12, 3.2, 1.0], bark: [9, 1.1, 1.0] };

const cache = new Map();

/**
 * Create (or reuse) a toon material.
 * opts: { emissive, emissiveIntensity, rim, vertexColors, flat, side, transparent, opacity, sway, swayBase, terrain, key,
 *         foliage (bool), leafy (ragged crown edges), tex ('plaster'|'wood'|'planks'|'stone'|'roof'|'rock'|'bark'), noAO (bool),
 *         noMoss (bool: no moss on 'stone'/'rock' surfaces), lodFade (bool: per-instance `aFade` dither, props only),
 *         cards (bool: the geometry carries `aCard` foliage cards, see props.js Mesher.card) }
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
  const isTerrain = !!opts.terrain, isCliff = !!opts.cliff;
  const lodFade = !!opts.lodFade;
  const cards = !!opts.cards;
  if (cards) { m.alphaToCoverage = true; leafTexture(); }
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
    sh.uniforms.uSeeA = U.seeA; sh.uniforms.uSeeB = U.seeB; sh.uniforms.uSeeR = U.seeR;
    if (isTerrain) { sh.uniforms.uBurnTex = U.burnTex; sh.uniforms.uWet = U.wet; sh.uniforms.uSplatTex = U.splatTex; sh.uniforms.uPaveTex = U.paveTex; }
    sh.uniforms.uSurfA = U.surfA; sh.uniforms.uSurfN = U.surfN; sh.uniforms.uSkyRefl = U.skyRefl;
    if (cards) sh.uniforms.uLeafTex = U.leaf;
    let fs = sh.fragmentShader;
    const isToon = fs.includes('#include <lights_toon_pars_fragment>');
    let defs = '';
    if (isToon) {
      // rock props are lit like the cliffs they stand against (the terrain's soft ramp)
      if (isTerrain || texKind === 'rock') defs += '#define TOON_SOFT\n';
      else if (foliage) defs += '#define TOON_FOLIAGE\n';
      if (opts.leafy) defs += '#define LEAFY_EDGE\n';
      if (!isTerrain && !opts.noAO) defs += '#define TOON_GROUND_AO\n';
      if (texKind) defs += `#define TEX_${texKind.toUpperCase()}\n`;
      const sf = SURF_OF[texKind];
      if (sf) defs += `#define SURF_LAYER ${sf[0].toFixed(1)}\n#define SURF_TILE ${sf[1].toFixed(2)}\n#define SURF_BUMP ${sf[2].toFixed(2)}\n`;
      if (sf || isTerrain) defs += '#define SURF_SPEC\n';
      if (opts.noMoss) defs += '#define NO_MOSS\n';
      fs = fs.replace('#include <lights_toon_pars_fragment>', TOON_LIGHT_PARS + SURFACE_PARS)
        .replace('#include <lights_fragment_begin>', LIGHTS_PRE + toonLightsBegin());
      fs = fs.replace('#include <lights_toon_fragment>', isTerrain ? TERRAIN_SURF : SURFACE_FRAG);
    } else {
      fs = 'uniform sampler2D uNoiseTex;\n' + fs;
    }
    fs = fs.replace('#include <opaque_fragment>', RIM_FRAG).replace('#include <clipping_planes_fragment>', DISSOLVE_CLIP);
    if (isToon && opts.leafy) fs = SEE_PARS + fs;
    const cdef = cards ? '#define LEAF_CARDS\n' : '';
    sh.fragmentShader = defs + cdef + 'uniform float uRim;\nuniform vec3 uRimColor;\nuniform vec3 uSkyRefl;\nfloat _isCard = 0.0;\n#ifdef LEAF_CARDS\nvarying vec3 vCard;\nuniform sampler2D uLeafTex;\n#endif\n' + DISSOLVE_PARS + fs;
    sh.vertexShader = cdef + '#ifdef LEAF_CARDS\nattribute vec4 aCard;\nvarying vec3 vCard;\n#endif\nuniform float uTime;\nuniform float uWind;\nuniform float uSway;\nuniform float uSwayBase;\nvarying vec3 vDWP;\n' + sh.vertexShader.replace('#include <project_vertex>', DISSOLVE_VERT);
    if (lodFade) {
      // per-instance cross-fade between a near and a far model: > 0 dithers this instance out
      // by that fraction, < 0 keeps only that fraction; the two use the same pattern so they
      // add up to one whole object (props.js LOD band)
      sh.vertexShader = 'attribute float aFade;\nvarying float vFade;\n' + sh.vertexShader.replace('void main() {', 'void main() {\n  vFade = aFade;');
      sh.fragmentShader = 'varying float vFade;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (vFade != 0.0) {
    float _ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (vFade > 0.0 ? _ign < vFade : _ign >= -vFade) discard;
  }`);
    }
    if (hasSway) sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', WIND_VERT);
    if (isTerrain) {
      // (the define has to come before the declarations that test it)
      const cl = isCliff ? '#define CLIFF_SKIN\n' : '';
      sh.vertexShader = cl + TERRAIN_VERT_PARS + (isCliff ? 'attribute vec3 aRock;\nattribute vec2 aEdge;\nvarying vec3 vRock;\nvarying vec2 vEdge;\n' : '')
        + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normal;' + (isCliff ? '\nvRock = aRock; vEdge = aEdge;' : ''));
      sh.fragmentShader = cl + TERRAIN_FRAG_PARS + sh.fragmentShader.replace('#include <color_fragment>', TERRAIN_FRAG);
    }
  };
  m.customProgramCacheKey = () => `toon5|${hasSway}|${isTerrain}|${isCliff}|${foliage}|${texKind}|${!!opts.noAO}|${!!opts.leafy}|${!!opts.noMoss}|${lodFade}|${cards}`;
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
