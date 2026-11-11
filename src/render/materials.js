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
  // more maps on the height grid (terrain.js buildMesh): colour of level ground, distance to
  // the nearest road, the smooth ground's normal; and the palette the shader paints rock and
  // roads from
  groundTex: { value: null },
  pathTex: { value: null },
  tnormTex: { value: null },
  terrPal: { value: Array.from({ length: 9 }, () => new THREE.Color()) },
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
// Foliage atlas (4x4 tiles) for the cards of props.js: alpha = the shapes, rgb = a tint
// multiplier (what lies underneath is darker; a leaf has a lit and a shaded half and a midrib).
//   row 0: broadleaf clumps
//   row 1: needle sprays (two; the twig runs along u from the left edge) and needle tufts (two)
//   row 2: the snow lying on those four
//   row 3: willow strands (two; hanging from v = 0) and blossom clusters (two)
// Colour and coverage are drawn on separate canvases so the tint does not go dark where
// the alpha fades (canvas pixels are premultiplied).
function makeLeafTexture(S = 2048) {
  const C = S / 4;
  const mk = () => { const cv = document.createElement('canvas'); cv.width = cv.height = S; return cv.getContext('2d', { willReadFrequently: true }); };
  const gc = mk(), ga = mk();
  gc.fillStyle = 'rgb(170,170,170)'; gc.fillRect(0, 0, S, S);
  ga.fillStyle = '#000'; ga.fillRect(0, 0, S, S);
  let s = 90210;
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const grey = (v) => { const k = Math.round(Math.min(255, Math.max(0, v))); return 'rgb(' + k + ',' + k + ',' + k + ')'; };
  // Shapes are queued (the random numbers drawn once) and then painted on both canvases.
  // sx, sy: units of the tile's own space (pixels by default; metres for the strands).
  const paint = (v, ops, sx = 1, sy = 1) => {
    for (const g of [gc, ga]) {
      g.save();
      g.beginPath(); g.rect((v % 4) * C, Math.floor(v / 4) * C, C, C); g.clip();
      g.translate((v % 4) * C, Math.floor(v / 4) * C); g.scale(sx, sy);
      for (const op of ops) op(g, g === ga);
      g.restore();
    }
  };
  const leaf = (ops, x, y, rot, L, W, tone, lw) => ops.push((g, A) => {
    g.save();
    g.translate(x, y); g.rotate(rot); g.translate(-L * 0.35, 0);
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(L * 0.42, -W, L, 0); g.quadraticCurveTo(L * 0.42, W, 0, 0); g.closePath();
    if (A) { g.fillStyle = '#fff'; g.fill(); } else {
      const gr = g.createLinearGradient(0, -W * 0.5, 0, W * 0.5);
      gr.addColorStop(0, grey(tone * 1.04)); gr.addColorStop(0.5, grey(tone)); gr.addColorStop(0.52, grey(tone * 0.88)); gr.addColorStop(1, grey(tone * 0.82));
      g.fillStyle = gr; g.fill();
      g.strokeStyle = grey(tone * 0.7); g.lineWidth = lw; g.stroke();
    }
    g.restore();
  });
  const line = (ops, x0, y0, x1, y1, w, tone) => ops.push((g, A) => {
    g.strokeStyle = A ? '#fff' : grey(tone); g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  });
  const poly = (ops, pts, tone) => ops.push((g, A) => {
    g.fillStyle = A ? '#fff' : grey(tone);
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill();
  });
  // soft round shape, lit from the upper left (snow, petals)
  const blob = (ops, x, y, rx, ry, rot, tone, edge = 0.8) => ops.push((g, A) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.scale(rx, ry);
    g.beginPath(); g.arc(0, 0, 1, 0, 7);
    if (A) g.fillStyle = '#fff'; else {
      const gr = g.createRadialGradient(-0.25, -0.3, 0.1, 0, 0, 1);
      gr.addColorStop(0, grey(tone)); gr.addColorStop(1, grey(tone * edge));
      g.fillStyle = gr;
    }
    g.fill(); g.restore();
  });
  // -- row 0: clumps of broad leaves
  for (let v = 0; v < 4; v++) {
    const ops = [], n = 18 + v * 3;
    for (let i = 0; i < n; i++) {
      const under = i < n * 0.45;
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.26 * C;
      const L = (0.17 + rnd() * 0.06) * C * (under ? 1.08 : 1), W = L * (0.42 + rnd() * 0.14);
      const rot = a + (rnd() - 0.5) * 1.6;
      const tone = under ? 132 + rnd() * 28 : 206 + rnd() * 48;
      leaf(ops, C / 2 + Math.cos(a) * d, C / 2 + Math.sin(a) * d, rot, L, W, tone, C / 256);
    }
    paint(v, ops);
  }
  // -- rows 1 and 2: conifer. A twig is a dark tapering body (so a spray keeps its mass at a
  // distance) under needles that point forward on both sides.
  const twig = (ops, x, y, ang, len, tone) => {
    const ca = Math.cos(ang), sa = Math.sin(ang), bw = len * 0.12 + C * 0.012;
    poly(ops, [[x, y], [x + ca * len * 0.3 - sa * bw, y + sa * len * 0.3 + ca * bw], [x + ca * len * 0.96, y + sa * len * 0.96], [x + ca * len * 0.3 + sa * bw, y + sa * len * 0.3 - ca * bw]], tone * 0.66);
    const nl = Math.max(0.05 * C, len * 0.2), step = 0.019 * C;
    for (let d = step * 0.6; d < len; d += step) {
      const t = d / len, l = nl * (1 - 0.5 * t);
      for (const sd of [-1, 1]) {
        const na = ang + sd * (0.8 - 0.25 * t + (rnd() - 0.5) * 0.3), ll = l * (0.75 + rnd() * 0.45);
        line(ops, x + ca * d, y + sa * d, x + ca * d + Math.cos(na) * ll, y + sa * d + Math.sin(na) * ll, C * 0.0115, tone * (0.84 + rnd() * 0.3));
      }
    }
    line(ops, x, y, x + ca * len * 0.9, y + sa * len * 0.9, C * 0.008, tone * 0.55);
  };
  // snow resting along the inner part of each twig: needle tips stay out
  const snowOn = (twigs) => {
    const ops = [];
    for (const [x, y, ang, len] of twigs) {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let d = len * 0.04; d < len * 0.74; d += C * 0.05) {
        const t = d / len, r = C * (0.07 - 0.03 * t) * (0.75 + rnd() * 0.5);
        const fit = (q) => Math.min(C - r - 3, Math.max(r + 3, q));   // (whole inside the tile)
        blob(ops, fit(x + ca * d + (rnd() - 0.5) * r * 0.5), fit(y + sa * d + (rnd() - 0.5) * r * 0.5), r, r * (0.7 + rnd() * 0.2), ang, 226 + rnd() * 29, 0.82);
      }
    }
    return ops;
  };
  for (let v = 4; v < 8; v++) {
    const ops = [], twigs = [];
    if (v < 6) {
      // spray: side twigs alternate along the main one, longest before the middle
      const x0 = 0.04 * C, x1 = 0.86 * C, bow = (rnd() - 0.5) * 0.07 * C, n = 7;
      for (let k = 0; k < n; k++) for (const sd of [-1, 1]) {
        const t = 0.04 + ((k + (sd > 0 ? 0.5 : 0)) / n) * 0.8;
        const len = C * 0.5 * Math.pow(Math.sin(Math.PI * (0.17 + 0.8 * t)), 0.9) * (0.85 + rnd() * 0.22);
        twigs.push([x0 + (x1 - x0) * t, 0.5 * C + Math.sin(t * Math.PI) * bow, sd * (0.84 - 0.3 * t + (rnd() - 0.5) * 0.14), len, (176 + rnd() * 62) * (0.84 + 0.2 * t)]);
      }
      twigs.push([x0, 0.5 * C, 0, x1 - x0 + 0.08 * C, 226]);
    } else {
      // tuft: twigs of every length all round a centre (a ragged ball, not a star)
      const n = 17 + (v - 6) * 2;
      for (let k = 0; k < n; k++) twigs.push([0.5 * C + (rnd() - 0.5) * 0.06 * C, 0.5 * C + (rnd() - 0.5) * 0.06 * C, k * 2.3999632 + rnd() * 0.4, C * (0.25 + rnd() * 0.17), k % 3 ? 196 + rnd() * 56 : 148 + rnd() * 30]);
    }
    // darker ones underneath
    twigs.sort((a, b) => a[4] - b[4]);
    for (const tw of twigs) twig(ops, tw[0], tw[1], tw[2], tw[3], tw[4]);
    paint(v, ops);
    paint(v + 4, snowOn(twigs));
  }
  // -- row 3: willow strands, drawn in metres on a 0.6 x 2.4 m tile
  for (let v = 12; v < 14; v++) {
    const ops = [];
    for (let k = 0; k < 4; k++) {
      const x0 = 0.1 + k * 0.133 + (rnd() - 0.5) * 0.04, len = 1.5 + rnd() * 0.82, ph = rnd() * 6.3, base = k % 2 ? 150 : 205;
      const xa = (y) => x0 + Math.sin(y * 2.1 + ph) * 0.028 * Math.min(1, y * 2);
      for (let y = 0; y < len - 0.06; y += 0.06) line(ops, xa(y), y, xa(y + 0.06), y + 0.06, 0.0075, base * 0.56);
      let sd = 1;
      for (let y = 0.02; y < len; y += 0.046 + rnd() * 0.02) {
        sd = -sd;
        const L = (0.105 + rnd() * 0.05) * (1 - 0.45 * Math.pow(y / len, 3));
        leaf(ops, xa(y) + sd * 0.012, y + L * 0.3, Math.PI / 2 - sd * (0.32 + rnd() * 0.42), L, L * (0.19 + rnd() * 0.06), base + rnd() * 46, 0.0022);
      }
    }
    paint(v, ops, C / 0.6, C / 2.4);
  }
  // -- row 3: blossom clusters over a few leaves
  for (let v = 14; v < 16; v++) {
    const ops = [];
    for (let i = 0; i < 6; i++) {
      const a = rnd() * Math.PI * 2, d = (0.1 + rnd() * 0.2) * C, L = (0.2 + rnd() * 0.06) * C;
      leaf(ops, C / 2 + Math.cos(a) * d, C / 2 + Math.sin(a) * d, a + (rnd() - 0.5), L, L * 0.44, 118 + rnd() * 30, C / 256);
    }
    const n = 11 + (v - 14) * 2;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.31 * C, fr = (0.07 + rnd() * 0.03) * C;
      const x = C / 2 + Math.cos(a) * d, y = C / 2 + Math.sin(a) * d, r0 = rnd() * 6.3, tone = i < n * 0.4 ? 178 + rnd() * 22 : 224 + rnd() * 31;
      for (let k = 0; k < 5; k++) {
        const pa = r0 + k * 1.2566;
        blob(ops, x + Math.cos(pa) * fr * 0.56, y + Math.sin(pa) * fr * 0.56, fr * 0.56, fr * 0.43, pa, tone, 0.86);
      }
      blob(ops, x, y, fr * 0.2, fr * 0.2, 0, tone * 0.6, 0.9);
    }
    paint(v, ops);
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
    // one of the sixteen tiles of the atlas; edges go to MSAA coverage (alphaToCoverage)
    float _v = floor(vCard.z);
    vec4 _lf = texture2D(uLeafTex, (clamp(vCard.xy, 0.01, 0.99) + vec2(mod(_v, 4.0), floor(_v * 0.25))) * 0.25, -0.75);
    float _a = clamp((_lf.a - 0.42) / max(fwidth(_lf.a), 0.02) + 0.5, 0.0, 1.0) * (1.0 - vCard.w);
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
    // foliage, textured from the atlas: aCard = (corner x, corner y, kind, tile + seed).
    //   kind < 0: a sheet that stays where the mesh puts it (needle sprays, boughs)
    //   0 < kind < 100: a card whose four vertices sit at one point and spread out facing the
    //     viewer (half-width = kind), turned by its seed and rustling a little in the wind
    //   kind > 100: a hanging strand: a strip down the tree's vertical that turns about it to
    //     face the viewer (half-width = kind - 100); its lower end (y = 1) swings
    vCard = vec4(0.0, 0.0, -1.0, 0.0);
    if (aCard.z != 0.0) {
      vCard = vec4(aCard.xy * 0.5 + 0.5, aCard.w, 0.0);
      // foliage in the camera's way (too close to it, or between it and the player) makes room
      // whole: cards and strands shrink, sheets thin out through their coverage. No stipple.
      float _keep = 1.0;
      #ifdef LEAF_SEE
        _keep = 1.0 - seeFade(vDWP);
      #endif
      if (aCard.z < 0.0) vCard.w = smoothstep(0.3, 0.7, 1.0 - _keep);
      if (aCard.z > 0.0) {
        float _fr = fract(aCard.w);
        float _cs = length(modelMatrix[0].xyz);
        vec3 _up = modelViewMatrix[1].xyz;
        #ifdef USE_INSTANCING
          _cs *= (length(instanceMatrix[0].xyz) + length(instanceMatrix[1].xyz)) * 0.5;
          _up = (modelViewMatrix * vec4(instanceMatrix[1].xyz, 0.0)).xyz;
        #endif
        if (aCard.z < 100.0) {
          float _cr = _fr * 6.2831853 + sin(uTime * (1.1 + _fr * 1.7) + _fr * 47.0) * 0.13 * uWind;
          float _cc = cos(_cr), _sn = sin(_cr);
          mvPosition.xy += vec2(aCard.x * _cc - aCard.y * _sn, aCard.x * _sn + aCard.y * _cc) * aCard.z * _cs * _keep;
        } else {
          vec3 _sd = cross(normalize(_up), normalize(mvPosition.xyz));
          _sd /= max(length(_sd), 0.25);
          float _lo = aCard.y * 0.5 + 0.5;
          mvPosition.xyz += _sd * (aCard.x * (aCard.z - 100.0) * _cs * _keep + sin(uTime * (0.8 + _fr * 0.9) + _fr * 40.0) * 0.16 * uWind * _lo * _lo);
        }
        gl_Position = projectionMatrix * mvPosition;
      }
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
      #ifdef LEAF_CARDS
        // foliage cards seen from their far side (looking up into a crown): the sun that
        // reaches them comes through the leaves
        reflectedLight.directDiffuse += directLight.color * material.diffuseColor * vec3( 1.0, 1.1, 0.5 ) * ( clamp( -ndl - _ndlOff, 0.0, 1.0 ) * _isCard * 0.55 * _dirShadow * _cloudSh );
      #endif
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
uniform sampler2D uGroundTex;
uniform sampler2D uSplatTex;
uniform sampler2D uPaveTex;
uniform sampler2D uPathTex;
uniform sampler2D uTNormTex;
uniform vec3 uPal[9]; // rock, rockDark, rockWarm, rockCool, dirt, dirtDark, dirtLight, worn, grassDark
uniform float uWet;
varying vec3 vWPos;
varying vec3 vWNrm;
// worked out once per pixel (TERRAIN_FRAG), used again at the lighting stage (TERRAIN_SURF)
vec3 _wn = vec3(0.0, 1.0, 0.0);
float _wG = 0.0, _wD = 0.0, _wS = 0.0, _wN = 0.0, _wRock = 0.0, _wPave = 0.0, _wBare = 0.0, _moss = 0.0, _beds = 0.0, _yb = 0.0;
#ifdef CLIFF_SKIN
varying vec2 vEdge; // x: open to the sky (1) or shut in, y: 1 on a top that grows grass
#endif
float _h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float _vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(_h21(i), _h21(i+vec2(1,0)), f.x), mix(_h21(i+vec2(0,1)), _h21(i+vec2(1,1)), f.x), f.y); }
`;
// (after the samplers are declared)
const TERRAIN_FN = `
// Bicubic (B-spline) read of a map on the 2 m height grid, as four bilinear taps: nothing of
// the grid is left in what comes back, so colours and layer borders can be drawn per pixel.
vec4 _bic(sampler2D t, vec2 uv){
  vec2 sz = vec2(textureSize(t, 0)), st = uv * sz - 0.5, i = floor(st), f = st - i;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0, w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0, w3 = f * f * f / 6.0;
  vec2 g0 = w0 + w1, g1 = 1.0 - g0;
  vec2 p0 = (i + w1 / g0 - 0.5) / sz, p1 = (i + w3 / g1 + 1.5) / sz;
  // (explicit gradients: the taps jump at every texel, which would send the mip level wild)
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  return g0.y * (g0.x * textureGrad(t, p0, dx, dy) + g1.x * textureGrad(t, vec2(p1.x, p0.y), dx, dy))
       + g1.y * (g0.x * textureGrad(t, vec2(p0.x, p1.y), dx, dy) + g1.x * textureGrad(t, p1, dx, dy));
}
`;
const TERRAIN_FRAG = `
  #include <color_fragment>
  {
    vec2 p = vWPos.xz;
    vec2 guv0 = (p + uHeightP.x) * uHeightP.y + uHeightP.z;
    // the maps are read through a small warp, so no border drawn from them runs straight
    vec2 wq = (texture2D(uNoiseTex, p * 0.027).rg - 0.5) * 3.2 + (texture2D(uNoiseTex, p * 0.19).gb - 0.5) * 0.7;
    vec2 guv = guv0 + wq * uHeightP.y;
    vec3 gc = _bic(uGroundTex, guv).rgb;
    vec4 sp = _bic(uSplatTex, guv);
    float pv = _bic(uPaveTex, guv).r;
    float rockK, fringe = 0.0;
    #ifdef CLIFF_SKIN
    {
      // the true face of the triangle says wall or top (the smooth normal turns too slowly),
      // and lights the rock as the planes it is cut into, their edges only slightly eased
      vec3 Tx = dFdx(vWPos), Ty = dFdy(vWPos);
      vec3 gn = normalize(cross(Tx, Ty));
      if (gn.y < 0.0) gn = -gn;
      _wn = normalize(mix(normalize(vWNrm), gn, 0.4));
      float steep = 1.0 - smoothstep(0.62, 0.78, gn.y);
      // (for the tops: by the smooth normal, unless the face itself is level: a ramp at the
      // foot of the rock has triangles leaning either way, and would be cut in saw teeth)
      float steepT = (1.0 - smoothstep(0.62, 0.78, normalize(vWNrm).y)) * (1.0 - smoothstep(0.9, 0.97, gn.y));
      float nq = texture2D(uNoiseTex, p * 0.31).b;
      // grass keeps to the gentle tops marked for it (in patches where the mark is partial)...
      float top = smoothstep(0.42, 0.58, vEdge.y + (texture2D(uNoiseTex, p * 0.055).b - 0.5) * 0.5 + (nq - 0.5) * 0.12) * (1.0 - steepT);
      // ...and hangs over the lip of the wall below in a ragged fringe: the mark falls from 1
      // to 0 down the first row of the wall, and its gradient turns that into metres
      float ex = dFdx(vEdge.y), ey = dFdy(vEdge.y);
      float ta = dot(Tx, Tx), tb = dot(Tx, Ty), tc = dot(Ty, Ty);
      vec3 eg = ((tc * ex - tb * ey) * Tx + (ta * ey - tb * ex) * Ty) / max(ta * tc - tb * tb, 1e-12);
      float lip = (1.0 - vEdge.y) / max(length(eg), 1e-3);
      float len = 0.12 + 0.6 * texture2D(uNoiseTex, p * 0.23).g * (0.4 + 1.2 * nq);
      // (only where the mark really falls away downwards: a face between two grass tops has no lip)
      fringe = steep * smoothstep(0.03, 0.12, eg.y) * smoothstep(0.35, 0.65, eg.y / max(length(eg), 1e-3)) * (1.0 - smoothstep(0.55, 1.0, lip / len));
      rockK = 1.0 - max(top, fringe);
      fringe *= 1.0 - top;
      _moss = 0.16 * smoothstep(0.0, 0.5, vEdge.y) + 0.12 * (1.0 - smoothstep(0.2, 0.8, vEdge.x));
    }
    #else
    {
      // the smooth ground's own normal, the same at every level of detail
      vec4 tn = _bic(uTNormTex, guv0);
      vec2 nxz = (tn.rb * 65280.0 + tn.ga * 255.0) / 65535.0 * 2.0 - 1.0;
      _wn = normalize(vec3(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.0)), nxz.y));
      rockK = smoothstep(0.84, 0.7, _wn.y + (texture2D(uNoiseTex, p * 0.21).b - 0.5) * 0.1);
    }
    #endif
    // rock: grey, warmer or cooler by region; faces turned to the sky are paler and warmer
    // than the ones that lean out
    vec2 q3 = p + vWPos.y * vec2(0.61, 0.37);
    vec3 rockC = mix(uPal[0], uPal[1], smoothstep(0.3, 0.8, texture2D(uNoiseTex, q3 * 0.0125).r));
    rockC = mix(rockC, uPal[2], smoothstep(0.45, 0.8, texture2D(uNoiseTex, p * 0.005 + 0.37).g) * 0.5);
    rockC = mix(rockC, uPal[3], smoothstep(0.45, 0.8, texture2D(uNoiseTex, p * 0.0033 + 0.71).r) * 0.45);
    // Bedded country (lower down, by region): the beds dip a little and roll slowly, so no
    // bedding plane is a level line across the map (_yb: height measured along the beds).
    // Up a cliff the rock comes in units: thin beds, then a massive band, then beds again.
    // Each bed has its own tone, some warmer, the odd one dark.
    _yb = vWPos.y + (texture2D(uNoiseTex, p * 0.006 + 0.9).r - 0.5) * 5.0 + dot(p, vec2(0.05, -0.035));
    float unit = texture2D(uNoiseTex, vec2(0.37 + p.x * 0.0006 + p.y * 0.0004, _yb * 0.012)).g;
    _beds = smoothstep(0.44, 0.56, texture2D(uNoiseTex, p * 0.0031 + 0.57).g + clamp((30.0 - vWPos.y) * 0.004, -0.15, 0.15)) * smoothstep(0.36, 0.46, unit);
    float bed = texture2D(uNoiseTex, vec2(0.11 + p.x * 0.0005 - p.y * 0.0003, _yb * 0.055)).b;
    float bedT = (floor(bed * 5.0) + smoothstep(0.35, 0.65, fract(bed * 5.0))) / 5.0;
    rockC *= 1.0 + _beds * (bedT - 0.5) * 0.3;
    rockC = mix(rockC, rockC * vec3(1.1, 1.0, 0.86), _beds * smoothstep(0.55, 0.75, unit) * 0.6);
    float up = smoothstep(-0.2, 0.7, _wn.y);
    rockC *= (0.98 + 0.16 * up) * mix(vec3(0.99, 0.99, 1.01), vec3(1.06, 1.01, 0.93), up);
    // (snow, ash and wet sand lie on rock too)
    rockC = mix(rockC, gc, max(sp.b, max(sp.g, sp.a * 0.5)));
    vec3 col = mix(gc, rockC, rockK);
    col = mix(col, uPal[8], rockK * (1.0 - rockK) * 0.5 * sp.r);
    col *= mix(vec3(1.0), vec3(0.6, 0.76, 0.5), fringe);
    #ifdef CLIFF_SKIN
      // shut-in rock is darker and cooler: walls deepen below their lips, gullies most of all
      col *= mix(vec3(0.74, 0.78, 0.86), vec3(1.0), smoothstep(0.0, 0.9, vEdge.x));
    #endif
    // roads: the edge is drawn here from the distance to the road, so it is as crisp as the
    // pixel, ragged with noise; trampled grass along it, packed earth in the middle
    float pd = texture2D(uPathTex, guv0).r * uHeightP.w;
    float pf = 1.0 - smoothstep(1.6, 3.3, pd + (texture2D(uNoiseTex, p * 0.045).r - 0.5) * 1.6 + (texture2D(uNoiseTex, p * 0.31).g - 0.5) * 0.5);
    float over = max(max(sp.a, sp.g), pv);
    float road = smoothstep(0.3, 0.8, pf) * (1.0 - over);
    col = mix(col, uPal[7], smoothstep(0.05, 0.4, pf) * (1.0 - smoothstep(0.45, 0.85, pf)) * 0.45 * (1.0 - sp.b) * (1.0 - over));
    float gN = texture2D(uNoiseTex, p * 0.0045 + 0.13).g;
    vec3 dirtC = mix(mix(uPal[4], uPal[5], gN * 0.45), uPal[6], smoothstep(0.75, 1.0, pf) * smoothstep(0.4, 0.75, texture2D(uNoiseTex, p * 0.075).b) * 0.5);
    col = mix(col, dirtC, road * 0.94);
    diffuseColor.rgb *= col;
    // layer weights: grass, earth, sand, snow; what is left is rock (slopes) or bare / laid stone
    _wG = sp.r * (1.0 - road) * (1.0 - rockK);
    _wD = max(road * (1.0 - sp.b), sp.g * (1.0 - rockK));
    _wS = sp.b;
    _wN = sp.a * (1.0 - 0.55 * rockK);
    float rest = clamp(1.0 - _wG - _wD - _wS - _wN, 0.0, 1.0);
    #ifdef CLIFF_SKIN
      _wRock = rest;
    #else
      _wRock = rest * smoothstep(0.05, 0.24, 1.0 - _wn.y);
      _wPave = (rest - _wRock) * pv;
      _wBare = rest - _wRock - _wPave;
    #endif
  }
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
    vec3 wn = _wn;
    vec2 p = vWPos.xz;
    vec2 guv = (p + uHeightP.x) * uHeightP.y + uHeightP.z;
    vec3 alb = vec3(0.0), dW = vec3(0.0);
    float rgh = 0.0, cav = 0.0, ws = 0.0;
    vec4 a_, n_; float w_;
    _tileSeed(p + vWPos.y * vec2(0.61, 0.37));
    // a layer wins where its own relief stands higher (grass between pebbles, not a blur)
    #define GROUND(L, UV, W0, TX, BX, TURN) if (W0 > 0.004) { _layer(L, UV, TURN, a_, n_); w_ = W0 * (0.3 + a_.a); w_ *= w_; w_ *= w_; alb += a_.rgb * w_; dW += (TX * (n_.r * 2.0 - 1.0) + BX * (n_.g * 2.0 - 1.0)) * w_; rgh += n_.b * w_; cav += n_.a * w_; ws += w_; }
    const vec3 X = vec3(1.0, 0.0, 0.0), Y = vec3(0.0, 1.0, 0.0), Z = vec3(0.0, 0.0, 1.0);
    GROUND(0.0, p / 4.0, _wG, X, Z, 1.0)
    GROUND(1.0, p / 3.0, _wD, X, Z, 1.0)
    GROUND(3.0, p / 3.0, _wS, X, Z, 0.0)
    GROUND(4.0, p / 4.0, _wN, X, Z, 1.0)
    GROUND(10.0, p / 2.8, _wPave, X, Z, 1.0)
    GROUND(12.0, p / 5.0, _wBare, X, Z, 1.0)
    if (_wRock > 0.004) {
      // rock: projected from the sides on a face (bedding runs level), from above on a top
      vec3 bw = abs(wn); bw *= bw; bw *= bw; bw /= bw.x + bw.y + bw.z;
      float wx = _wRock * bw.x, wy = _wRock * bw.y, wz = _wRock * bw.z;
      #define ROCK(L, T, W) { float k_ = (W); if (k_ > 0.004) { GROUND(L, vWPos.zy / (T), wx * k_, Z, Y, 0.0) GROUND(L, vWPos.xy / (T), wz * k_, X, Y, 0.0) GROUND(L, p / (T), wy * k_, X, Z, 1.0) } }
      // Two kinds of bedrock, each over its own country (thin beds lower down, big jointed
      // blocks higher up), the blocks in two sizes. Far away both are read much larger: at
      // its true size the relief would shrink to an even grain, and a cliff seen from afar
      // shows its great ledges, not its small ones.
      float farK = smoothstep(40.0, 150.0, length(cameraPosition - vWPos));
      // (beds are laid along the dipping, rolling bedding, and come thick and thin)
      #define BEDS(L, T, W) { float k_ = (W); if (k_ > 0.004) { GROUND(L, vec2(vWPos.z, _yb) / (T), wx * k_, Z, Y, 0.0) GROUND(L, vec2(vWPos.x, _yb) / (T), wz * k_, X, Y, 0.0) GROUND(L, p / (T), wy * k_, X, Z, 1.0) } }
      float beds = _beds;
      float big = smoothstep(0.48, 0.56, texture2D(uNoiseTex, p * 0.0047 + 0.21).r);
      float thick = smoothstep(0.5, 0.6, texture2D(uNoiseTex, vec2(0.63 + p.x * 0.0005, _yb * 0.021)).r);
      ROCK(2.0, 9.0, (1.0 - beds) * (1.0 - farK) * (1.0 - big))
      ROCK(2.0, 16.0, (1.0 - beds) * (1.0 - farK) * big)
      ROCK(2.0, 33.0, (1.0 - beds) * farK)
      BEDS(13.0, 6.5, beds * (1.0 - farK) * (1.0 - thick))
      BEDS(13.0, 12.0, beds * (1.0 - farK) * thick)
      BEDS(13.0, 26.0, beds * farK)
    }
    float iw = 1.0 / max(ws, 1e-5);
    diffuseColor.rgb *= ws > 0.0 ? alb * iw * 2.0 : vec3(1.0);
    // (rock: the relief comes and goes over a face, strong in one stretch and worn nearly
    // smooth in the next, and is read more gently from afar, or a far wall is all one grain)
    float rf = _wRock * (1.0 - mix(0.15, 0.75, texture2D(uNoiseTex, p * 0.013 + vWPos.y * 0.021 + 0.7).r) * (0.45 + 0.55 * smoothstep(40.0, 150.0, length(cameraPosition - vWPos))));
    vec3 pn = normalize(wn + dW * iw * 1.15 * (1.0 - _wRock + rf));
    normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz);
    if (ws > 0.0) { _rough = rgh * iw; _cav = cav * iw; _specK = 1.0; }
    if (_wRock > 0.05) {
      // moss: on whatever faces the sky at the scale of the relief (the tops of ledges and
      // blocks, never the risers), in damp stretches of country, thicker under grass tops
      // and in shut-in places; none under snow
      float mf = texture2D(uNoiseTex, p * 0.61 + vWPos.y * 0.37).b;
      float damp = texture2D(uNoiseTex, p * 0.021 + vWPos.y * 0.013 + 0.4).g + _moss;
      float moss = smoothstep(0.42, 0.74, pn.y + (mf - 0.5) * 0.4) * smoothstep(0.4, 0.62, damp) * _wRock * (1.0 - smoothstep(0.05, 0.3, _wN));
      diffuseColor.rgb = mix(diffuseColor.rgb, uPal[8] * vec3(1.0, 1.12, 0.7) * (0.75 + 0.5 * mf), moss * 0.85);
      _rough = mix(_rough, 0.95, moss);
    }
    // wildfire: scorched ground (patchy ash) and a hot rim while burning
    vec4 burn = texture2D(uBurnTex, guv);
    if (burn.r + burn.g > 0.002) {
      float ashN = _vn(p * 1.3);
      vec3 ash = mix(vec3(0.16, 0.14, 0.13), vec3(0.34, 0.3, 0.27), ashN);
      diffuseColor.rgb = mix(diffuseColor.rgb, ash, burn.r * (0.75 + 0.25 * ashN) * (1.0 - _wRock * 0.6));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.08, 0.04), burn.g * 0.6);
    }
    // rain: darker, more saturated ground with a wet sheen
    diffuseColor.rgb *= 1.0 - uWet * (0.22 + 0.12 * _wRock);
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
// A layer of the surface arrays without its repeat showing: every pixel reads two copies of
// the tile, each shifted (and, with turn, rotated: for layers with no direction of their
// own) by an amount picked from a slowly wandering index, and cross-fades from one to the
// next where the index steps (by height, so the fade is not a blur).
vec2 _toA = vec2(0.0), _toB = vec2(0.0);
mat2 _trA = mat2(1.0), _trB = mat2(1.0);
float _tf = 0.0;
void _tileSeed(vec2 q){
  float l = texture2D(uNoiseTex, q * 0.0061).r * 9.0 + texture2D(uNoiseTex, q * 0.041).g * 1.6;
  float ia = floor(l), aa = ia * 2.3999, ab = aa + 2.3999;
  _tf = l - ia;
  _toA = sin(vec2(3.0, 7.0) * ia); _toB = sin(vec2(3.0, 7.0) * (ia + 1.0));
  _trA = mat2(cos(aa), sin(aa), -sin(aa), cos(aa)); _trB = mat2(cos(ab), sin(ab), -sin(ab), cos(ab));
}
void _layer(float L, vec2 uv, float turn, out vec4 a, out vec4 n){
  mat2 ra = turn > 0.5 ? _trA : mat2(1.0), rb = turn > 0.5 ? _trB : mat2(1.0);
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  // (a layer with a direction is only shifted along it: bedding has to run on unbroken)
  vec2 oa = turn > 0.5 ? _toA : vec2(_toA.x, 0.0), ob = turn > 0.5 ? _toB : vec2(_toB.x, 0.0);
  vec3 ua = vec3(ra * uv + oa, L), ub = vec3(rb * uv + ob, L);
  vec4 a0 = textureGrad(uSurfA, ua, ra * dx, ra * dy), a1 = textureGrad(uSurfA, ub, rb * dx, rb * dy);
  float m = smoothstep(0.3, 0.7, _tf + (a1.a - a0.a) * 0.6);
  a = mix(a0, a1, m);
  vec4 n0 = textureGrad(uSurfN, ua, ra * dx, ra * dy), n1 = textureGrad(uSurfN, ub, rb * dx, rb * dy);
  // (the relief of a turned copy is turned back into the frame of uv)
  n0.rg = (n0.rg * 2.0 - 1.0) * ra * 0.5 + 0.5; n1.rg = (n1.rg * 2.0 - 1.0) * rb * 0.5 + 0.5;
  n = mix(n0, n1, m);
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
        // (cards, strands and sheets make room in the vertex stage instead: LEAF_CARDS)
        float _sf = _isCard > 0.5 ? 0.0 : seeFade(_p);
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
    if (isTerrain) { sh.uniforms.uBurnTex = U.burnTex; sh.uniforms.uWet = U.wet; sh.uniforms.uSplatTex = U.splatTex; sh.uniforms.uPaveTex = U.paveTex; sh.uniforms.uGroundTex = U.groundTex; sh.uniforms.uPathTex = U.pathTex; sh.uniforms.uTNormTex = U.tnormTex; sh.uniforms.uPal = U.terrPal; }
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
      fs = fs.replace('#include <lights_toon_pars_fragment>', TOON_LIGHT_PARS + SURFACE_PARS + (isTerrain ? TERRAIN_FN : ''))
        .replace('#include <lights_fragment_begin>', LIGHTS_PRE + toonLightsBegin());
      fs = fs.replace('#include <lights_toon_fragment>', isTerrain ? TERRAIN_SURF : SURFACE_FRAG);
    } else {
      fs = 'uniform sampler2D uNoiseTex;\n' + fs;
    }
    fs = fs.replace('#include <opaque_fragment>', RIM_FRAG).replace('#include <clipping_planes_fragment>', DISSOLVE_CLIP);
    if (isToon && opts.leafy) fs = SEE_PARS + fs;
    const cdef = cards ? '#define LEAF_CARDS\n' : '';
    sh.fragmentShader = defs + cdef + 'uniform float uRim;\nuniform vec3 uRimColor;\nuniform vec3 uSkyRefl;\nfloat _isCard = 0.0;\n#ifdef LEAF_CARDS\nvarying vec4 vCard;\nuniform sampler2D uLeafTex;\n#endif\n' + DISSOLVE_PARS + fs;
    // (leafy card foliage moves out of the camera's way in the vertex stage: seeFade there too)
    const vsee = cards && isToon && opts.leafy ? '#define LEAF_SEE\n' + SEE_PARS : '';
    sh.vertexShader = cdef + vsee + '#ifdef LEAF_CARDS\nattribute vec4 aCard;\nvarying vec4 vCard;\n#endif\nuniform float uTime;\nuniform float uWind;\nuniform float uSway;\nuniform float uSwayBase;\nvarying vec3 vDWP;\n' + sh.vertexShader.replace('#include <project_vertex>', DISSOLVE_VERT);
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
      sh.vertexShader = cl + TERRAIN_VERT_PARS + (isCliff ? 'attribute vec2 aEdge;\nvarying vec2 vEdge;\n' : '')
        + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normal;' + (isCliff ? '\nvEdge = aEdge;' : ''));
      sh.fragmentShader = cl + TERRAIN_FRAG_PARS + sh.fragmentShader.replace('#include <color_fragment>', TERRAIN_FRAG);
    }
  };
  m.customProgramCacheKey = () => `toon6|${hasSway}|${isTerrain}|${isCliff}|${foliage}|${texKind}|${!!opts.noAO}|${!!opts.leafy}|${!!opts.noMoss}|${lodFade}|${cards}`;
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
