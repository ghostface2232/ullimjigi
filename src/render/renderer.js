import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { G } from '../core/context.js';
import { U } from './materials.js'; // also installs the global aerial-perspective fog chunks before any compile
import { tier } from './quality.js';
import { bakeSurfaces } from './surfaces.js';

// Layer of shadow-only proxy meshes (props.js): never in the view, drawn in the shadow pass.
export const SHADOW_LAYER = 5;

// Bloom that stops after compositing its mips. The grade pass adds the result while it
// already reads the frame, instead of a separate full-resolution additive blend.
class BloomPass extends UnrealBloomPass {
  constructor(...args) {
    super(...args);
    // r186's compatibility gain is 3, and its five mip weights sum to 3.
    // Normalize both: strength now means the fraction scattered out of the bright source.
    this.compositeMaterial.fragmentShader = this.compositeMaterial.fragmentShader.replace('3.0 * bloomStrength', 'bloomStrength / 3.0');
    this.highPassUniforms.smoothWidth.value = 0.3;
    this.highPassUniforms.uValleyLight = U.valleyLight;
    // Threshold before the 2x reduction so thin emissive lines contribute
    // their share even when their neighbours are dark.
    this.materialHighPassFilter.fragmentShader = /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float luminosityThreshold, smoothWidth, uValleyLight;
      varying vec2 vUv;
      vec3 extractLight(vec3 c) {
        return c * smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, luminance(c));
      }
      void main() {
        vec3 mean = texture2D(tDiffuse, vUv).rgb;
        vec3 bright = extractLight(mean);
        if (uValleyLight > 0.0) {
          vec2 d = 0.5 / vec2(textureSize(tDiffuse, 0));
          vec3 sum = extractLight(texture2D(tDiffuse, vUv - d).rgb)
                   + extractLight(texture2D(tDiffuse, vUv + vec2(d.x, -d.y)).rgb)
                   + extractLight(texture2D(tDiffuse, vUv + vec2(-d.x, d.y)).rgb)
                   + extractLight(texture2D(tDiffuse, vUv + d).rgb);
          bright = mix(bright, 0.25 * sum, uValleyLight);
        }
        gl_FragColor = vec4(bright, 1.0);
      }`;
    // The bilinear Gaussian taps must conserve DC energy through every downsample.
    for (const m of this.separableBlurMaterials) {
      const u = m.uniforms;
      const sum = u.centerWeight.value + 2 * u.gaussianWeights.value.reduce((a, b) => a + b, 0);
      u.centerWeight.value /= sum;
      u.gaussianWeights.value = u.gaussianWeights.value.map(w => w / sum);
    }
  }
  get texture() { return this.renderTargetsHorizontal[0].texture; }
  render(renderer, writeBuffer, readBuffer) {
    renderer.getClearColor(this._oldClearColor);
    this._oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    const q = this._fsQuad;
    this.highPassUniforms.tDiffuse.value = readBuffer.texture;
    this.highPassUniforms.luminosityThreshold.value = this.threshold;
    q.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright); renderer.clear(); q.render(renderer);
    let inp = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i];
      q.material = m;
      m.uniforms.colorTexture.value = inp.texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]); renderer.clear(); q.render(renderer);
      m.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]); renderer.clear(); q.render(renderer);
      inp = this.renderTargetsVertical[i];
    }
    const c = this.compositeMaterial;
    q.material = c;
    c.uniforms.bloomStrength.value = this.strength;
    c.uniforms.bloomRadius.value = this.radius;
    c.uniforms.bloomTintColors.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]); renderer.clear(); q.render(renderer);
    renderer.setClearColor(this._oldClearColor, this._oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }
}

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Depth effects at half resolution, one target: R = ambient occlusion, G = sun shafts,
// B = view depth / far (what the blur and the upsample in the grade pass weigh by).
// Occlusion is the "scalable ambient obscurance" estimator on positions and normals rebuilt
// from the depth buffer. Shafts march the view ray through the sun's shadow cascades and the
// drifting cloud shadows (same mapping as the ground), finely near the camera and coarsely far.
const FX_FS = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uProjInv, uCamWorld;
uniform vec2 uPx;
uniform float uValleyLight;
uniform vec4 uAo;      // radius (m), strength, fade start, fade end (m)
uniform vec3 uProj;    // projection[1][1], aspect, far
varying vec2 vUv;
#ifdef SHAFTS
uniform sampler2DShadow tShadow;
uniform mat4 uShadowMat[2];
uniform vec4 uCascade[2];
uniform sampler2D uNoiseTex;
uniform vec4 uCloud;
uniform vec3 uSunW;
uniform vec4 uShaft;   // march distance (m), density, height falloff (1/m), shadow reach (m)
#endif
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 viewPos(vec2 uv){
  vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).r * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
void main(){
  vec3 P = viewPos(vUv);
  float z = -P.z;
  float ao = 1.0;
  #ifdef AO
  if (z > 0.0 && z < uAo.w) {
    // normal from the nearer neighbour on each axis, so silhouettes do not bend it
    vec3 Pr = viewPos(vUv + vec2(uPx.x, 0.0)), Pl = viewPos(vUv - vec2(uPx.x, 0.0));
    vec3 Pu = viewPos(vUv + vec2(0.0, uPx.y)), Pd = viewPos(vUv - vec2(0.0, uPx.y));
    vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
    vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
    vec3 N = cross(dx, dy);
    float nl = dot(N, N);
    N = nl > 1e-14 ? N * inversesqrt(nl) : vec3(0.0, 0.0, 1.0);
    float R = uAo.x, R2 = R * R;
    float rUv = min(R * uProj.x * 0.5 / z, 0.1);
    float phi = ign(gl_FragCoord.xy) * 6.2831853;
    // Follow the reconstructed pixel footprint. A fixed depth-proportional
    // offset erases a boot or chair leg well before the AO distance fade.
    float footprint = min(length(dx), length(dy));
    float bias = mix(0.03 + 0.004 * z, clamp(0.012 + 0.35 * footprint, 0.012, 0.075), uValleyLight);
    float sum = 0.0;
    for (int i = 0; i < 10; i++) {
      float a = (float(i) + 0.5) / 10.0;
      float th = float(i) * 2.3999632 + phi;
      vec2 o = vec2(cos(th), sin(th)) * a * rUv; o.x /= uProj.y;
      vec3 v = viewPos(vUv + o) - P;
      float vv = dot(v, v), f = max(R2 - vv, 0.0);
      sum += f * f * f * max((dot(v, N) - bias) / (vv + 0.02), 0.0);
    }
    float obscurance = sum * 5.0 * uAo.y / (R2 * R2 * R2 * 10.0);
    // Saturate gently: opposing faces at a contact can occlude ambient light
    // without turning a crease into a solid dark stripe.
    float A = mix(max(0.0, 1.0 - obscurance), 1.0 / (1.0 + 1.3 * obscurance), uValleyLight);
    ao = mix(A, 1.0, smoothstep(uAo.z, uAo.w, z));
    if (!(ao >= 0.0)) ao = 1.0;
  }
  #endif
  float shaft = 0.0;
  #ifdef SHAFTS
  if (uShaft.y > 0.0) {
    float dist = length(P);
    vec3 dirV = P / dist;
    vec3 dirW = (uCamWorld * vec4(dirV, 0.0)).xyz;
    vec3 camW = uCamWorld[3].xyz;
    float maxD = min(dist, uShaft.x);
    float j = ign(gl_FragCoord.xy + 31.7);
    float acc = 0.0, t0 = 0.0;
    for (int i = 0; i < SHAFT_STEPS; i++) {
      // quadratic spacing: thin slices through nearby trees, thick ones through far air
      float k1 = (float(i) + 1.0) / float(SHAFT_STEPS);
      float t1 = maxD * k1 * k1;
      float t = mix(t0, t1, j);
      vec3 pw = camW + dirW * t;
      float vz = -dirV.z * t;
      float lit = 1.0;
      if (vz < uShaft.w) {
        vec4 sc = (vz < uCascade[0].y ? uShadowMat[0] : uShadowMat[1]) * vec4(pw, 1.0);
        sc.xyz /= sc.w;
        if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) lit = texture(tShadow, vec3(sc.xy, sc.z - 0.0006));
      }
      if (uCloud.w > 0.0) {
        vec2 q = pw.xz + uSunW.xz * ((160.0 - pw.y) / max(uSunW.y, 0.25));
        lit *= 1.0 - uCloud.w * smoothstep(0.5, 0.64, texture2D(uNoiseTex, (q + uCloud.xy) * uCloud.z).r) * step(pw.y, 160.0);
      }
      // nearer air counts for more, so the gaps between nearby crowns show as beams
      acc += lit * exp(-max(pw.y, 0.0) * uShaft.z - t * 0.011) * (t1 - t0);
      t0 = t1;
    }
    // sharply forward-peaked phase: the air glows when looking towards the light
    float mu = max(dot(dirW, uSunW), 0.0), mu2 = mu * mu, mu4 = mu2 * mu2;
    float phase = 0.05 + 0.95 * mu4 * mu4 * mu2;
    shaft = 1.0 - exp(-acc * uShaft.y * phase);
  }
  #endif
  gl_FragColor = vec4(ao, shaft, min(z / uProj.z, 1.0), 1.0);
}
`;

const BLUR_FS = /* glsl */ `
uniform sampler2D tFx;
uniform vec2 uDir;
uniform float uValleyLight;
varying vec2 vUv;
void main(){
  vec4 c = texture2D(tFx, vUv);
  vec2 acc = c.rg * 0.2;
  float ws = 0.2, tol = c.b * mix(0.025, 0.012, uValleyLight) + 1.5e-5;
  for (int i = 1; i <= 4; i++) {
    float w0 = 0.2 - 0.04 * float(i);
    for (int s = -1; s <= 1; s += 2) {
      vec4 t = texture2D(tFx, vUv + uDir * float(i * s));
      float w = w0 * max(0.0, 1.0 - abs(t.b - c.b) / tol);
      acc += t.rg * w; ws += w;
    }
  }
  gl_FragColor = vec4(acc / ws, c.b, 1.0);
}
`;

// Final pass, straight to the canvas, so the frame is read and written once after the scene:
// screen-space refraction, depth of field (dialogue shots), sharpening, occlusion and sun
// shafts, bloom add, colour grade, then tone mapping + sRGB and a dither against banding.
// The scene target's alpha is an occlusion mask: opaque surfaces write 1, grass less.
// Refraction offsets come from effect meshes (shock rings, shells, heat haze) drawn into a
// half-res float target; they bend the scene and its bloom with a slight chromatic split.
const GRADE_FS = /* glsl */ `
uniform sampler2D tDiffuse, tBloom, tDistort, tDepth, tFx;
uniform vec2 uFxRes, uPx, uNF;
uniform vec3 uAoTint, uShaftColor, uGlareColor;
uniform vec4 uDof, uSunScr;
uniform float uSharp, uBloomScatter, uValleyLight;
uniform float uDistort, uTime, uImpact, uHurt, uLowHp, uSat, uVignette, uFlash, uMono, uAspect, uSlowmo;
uniform vec3 uFlashColor;
varying vec2 vUv;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float linZ(vec2 uv){ return uNF.x * uNF.y / (uNF.y - texture2D(tDepth, uv).r * (uNF.y - uNF.x)); }
// circle of confusion, 0..1: soft behind the focus, a little in front of it
float cocAt(float z){
  return clamp((z - uDof.y * 1.25) / (uDof.y * uDof.z + 0.5), 0.0, 1.0) + 0.5 * clamp((uDof.y * 0.5 - z) / (uDof.y * 0.4), 0.0, 1.0);
}
void main(){
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  vec2 off = vec2(0.0);
  if (uDistort > 0.5) off = clamp(texture2D(tDistort, uv).xy, vec2(-0.08), vec2(0.08));
  float ca = uImpact * 0.010;
  vec2 ur = uv - c * ca + off * 1.08, ug = uv + off, ub = uv + c * ca + off * 0.92;
  vec4 mid = texture2D(tDiffuse, ug);
  vec3 sc = mid.rgb;
  bool split = uImpact > 0.0 || uDistort > 0.5;
  if (split) {
    sc.r = texture2D(tDiffuse, ur).r;
    sc.b = texture2D(tDiffuse, ub).b;
  }
  #ifdef USE_DEPTH
    float zc = linZ(ug);
  #endif
  float soft = 0.0;
  #ifdef DOF
  if (uDof.x > 0.004) {
    float cc = cocAt(zc) * uDof.x;
    if (cc > 0.01) {
      vec3 acc = sc; float ws = 1.0;
      for (int i = 0; i < 20; i++) {
        float th = float(i) * 2.3999632;
        vec2 o = vec2(cos(th), sin(th)) * sqrt((float(i) + 0.5) / 20.0) * cc * uDof.w; o.x /= uAspect;
        float zt = linZ(ug + o);
        // sharp things in front of a soft pixel do not smear into it
        float w = zt >= zc ? 1.0 : clamp(cocAt(zt) * uDof.x / cc, 0.0, 1.0);
        acc += texture2D(tDiffuse, ug + o).rgb * w; ws += w;
      }
      sc = acc / ws;
      soft = clamp(cc * 3.0, 0.0, 1.0);
    }
  }
  #endif
  #ifdef SHARP
  {
    float nb = (texture2D(tDiffuse, ug + vec2(uPx.x, 0.0)).g + texture2D(tDiffuse, ug - vec2(uPx.x, 0.0)).g
      + texture2D(tDiffuse, ug + vec2(0.0, uPx.y)).g + texture2D(tDiffuse, ug - vec2(0.0, uPx.y)).g) * 0.25;
    // Relative contrast limit: dark edges and bright seams cannot acquire ringing halos.
    float detail = clamp(mid.g - nb, -0.035, 0.035);
    sc *= 1.0 + clamp(detail / max(mid.g, 0.08), -0.12, 0.12) * uSharp * (1.0 - soft);
  }
  #endif
  #ifdef FX
  {
    // joint-bilateral upsample of the half-res effects: weigh the four texels by depth match
    vec2 st = ug * uFxRes - 0.5, f = fract(st), ipx = 1.0 / uFxRes;
    vec2 b0 = (floor(st) + 0.5) * ipx;
    vec4 s00 = texture2D(tFx, b0), s10 = texture2D(tFx, b0 + vec2(ipx.x, 0.0));
    vec4 s01 = texture2D(tFx, b0 + vec2(0.0, ipx.y)), s11 = texture2D(tFx, b0 + ipx);
    float zn = min(zc / uNF.y, 1.0), tol = zn * mix(0.018, 0.010, uValleyLight) + 1.5e-5;
    vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y)
      * max(vec4(0.0), 1.0 - abs(vec4(s00.b, s10.b, s01.b, s11.b) - zn) / tol);
    float ws = w.x + w.y + w.z + w.w;
    vec2 fx = ws > 1e-5 ? (s00.rg * w.x + s10.rg * w.y + s01.rg * w.z + s11.rg * w.w) / ws : vec2(1.0, 0.0);
    // occlusion cools and darkens what it shades; glowing pixels are left alone
    float lsc = dot(sc, vec3(0.2126, 0.7152, 0.0722));
    float occ = (1.0 - fx.r) * (1.0 - smoothstep(0.9, 2.2, lsc)) * clamp(mid.a, 0.0, 1.0);
    sc *= mix(vec3(1.0), uAoTint, occ);
    sc += uShaftColor * fx.g;
    #if FX_DEBUG == 1
      sc = vec3(fx.r);
    #elif FX_DEBUG == 2
      sc = vec3(fx.g);
    #endif
  }
  #endif
  // Scatter, rather than duplicate, the bright source. Matches bloom's soft extraction.
  float bloomGate = smoothstep(1.35, 1.65, dot(mid.rgb, vec3(0.2126, 0.7152, 0.0722)));
  vec3 col = sc * (1.0 - uBloomScatter * bloomGate);
  if (uSunScr.z > 0.001) {
    // looking into the sun: a veil of glare around it and faint ghosts along the line
    // through the centre of the lens
    vec2 sv = (uv - uSunScr.xy) * vec2(uAspect, 1.0);
    float sd = length(sv);
    float veil = exp(-sd * 5.5) * 0.35 + exp(-sd * 22.0) * 0.6;
    vec2 ax = (uSunScr.xy - 0.5) * vec2(uAspect, 1.0), pc = c * vec2(uAspect, 1.0);
    float g1 = smoothstep(0.07, 0.0, length(pc + ax * 0.45)) * 0.10;
    float g2 = smoothstep(0.035, 0.0, length(pc + ax * 0.9)) * 0.14;
    float g3 = smoothstep(0.16, 0.1, length(pc + ax * 1.6)) * smoothstep(0.08, 0.14, length(pc + ax * 1.6)) * 0.05;
    col += uGlareColor * (veil + g1 + g2 + g3) * uSunScr.z;
  }
  vec3 scatter = texture2D(tBloom, ug).rgb;
  if (split) {
    scatter.r = texture2D(tBloom, ur).r;
    scatter.b = texture2D(tBloom, ub).b;
  }
  col += scatter;
  if (uImpact > 0.02) {
    vec3 acc = col;
    for (int i = 1; i < 6; i++) { vec2 o = ug - c * float(i) * 0.014 * uImpact; acc += texture2D(tDiffuse, o).rgb + texture2D(tBloom, o).rgb; }
    col = mix(col, acc / 6.0, clamp(uImpact * 1.4, 0.0, 1.0));
  }
  // faint brightening where the refraction is strongest (shock front sheen)
  col *= 1.0 + min(length(off) * 3.0, 0.12);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat * (1.0 - uMono));
  // painterly split tone: cool shadows, warm highlights
  col *= mix(vec3(0.97, 0.99, 1.035), vec3(1.025, 1.0, 0.975), smoothstep(0.02, 0.9, l));
  // gentle shadow lift (soft, low-contrast BotW look)
  col += vec3(0.006, 0.008, 0.014) * (1.0 - smoothstep(0.0, 0.25, l));
  float d = length(c * vec2(uAspect, 1.0) * vec2(0.8, 1.0));
  float v = smoothstep(0.95, 0.35, d);
  col *= mix(1.0 - uVignette, 1.0, v);
  if (uSlowmo > 0.001) {
    float s = clamp(uSlowmo, 0.0, 1.0);
    float ls = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3(ls) * vec3(0.78, 0.93, 1.18) + vec3(0.0, 0.004, 0.012), s * 0.72);
    float pulse = 0.5 + 0.5 * sin(uTime * 4.5);
    float ring = smoothstep(0.3, 0.95, d);
    col *= 1.0 - s * ring * (0.38 + 0.14 * pulse);
    col += vec3(0.25, 0.5, 0.9) * s * smoothstep(0.55, 1.05, d) * 0.06 * (0.6 + 0.4 * pulse);
  }
  float edge = smoothstep(0.35, 0.9, d);
  float hurt = uHurt * 0.75 + uLowHp * (0.28 + 0.14 * sin(uTime * 6.0));
  col = mix(col, vec3(0.55, 0.02, 0.04) * (0.6 + l), clamp(edge * hurt, 0.0, 0.85));
  col += uFlashColor * uFlash;
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // 8-bit output: break up banding in the sky and fog gradients
  gl_FragColor.rgb += (ign(gl_FragCoord.xy) + ign(gl_FragCoord.xy + 47.0) - 1.0) / 255.0;
}
`;

const fsMat = (o) => new THREE.ShaderMaterial({ vertexShader: QUAD_VS, depthTest: false, depthWrite: false, ...o });

export class Renderer {
  constructor(canvas) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    // three tests shadow casters against the *view* camera's layers, so a shadow-only layer
    // has to be visible to that camera exactly while the shadow pass runs (the view's own
    // draw list is already built by then)
    const drawShadows = r.shadowMap.render;
    r.shadowMap.render = function (lights, scene, camera) {
      camera.layers.enable(SHADOW_LAYER);
      try { drawShadows.call(this, lights, scene, camera); } finally { camera.layers.disable(SHADOW_LAYER); }
    };
    const surf = bakeSurfaces(r);
    U.surfA.value = surf.a; U.surfN.value = surf.n;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 2400);
    this.dyn = 1;          // dynamic resolution scale (1 = the tier's full pixel ratio)
    this.dynamic = false;  // set by the game loop when real frames are being presented
    this.setupPipeline();
    window.addEventListener('resize', () => this.resize());
    this.applyQuality();
  }

  pixelRatio() {
    const T = tier(), dpr = window.devicePixelRatio || 1;
    return (T.dpr < 1 ? T.dpr : Math.min(dpr, T.dpr)) * this.dyn;
  }

  setupPipeline() {
    this.quad = new FullScreenQuad(null);
    // distortion objects live in their own scene and render into a half-res float target
    this.distortScene = new THREE.Scene();
    this.distortRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.bloom = new BloomPass(new THREE.Vector2(256, 256), 0.28, 0.18, 1.35);
    const fxRT = () => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.fxA = fxRT(); this.fxB = fxRT();
    this.fxMat = fsMat({
      fragmentShader: FX_FS,
      uniforms: {
        uValleyLight: U.valleyLight, tDepth: { value: null }, uProjInv: { value: this.camera.projectionMatrixInverse }, uCamWorld: { value: this.camera.matrixWorld },
        uPx: { value: new THREE.Vector2() }, uAo: { value: new THREE.Vector4(1.1, 1.0, 140, 220) }, uProj: { value: new THREE.Vector3(1, 1, 2400) },
        tShadow: { value: null }, uShadowMat: { value: [new THREE.Matrix4(), new THREE.Matrix4()] }, uCascade: { value: [new THREE.Vector4(), new THREE.Vector4()] },
        uNoiseTex: U.noise, uCloud: U.cloud, uSunW: U.sunDir, uShaft: { value: new THREE.Vector4(320, 0, 0.01, 0) },
      },
    });
    this.blurMat = fsMat({ fragmentShader: BLUR_FS, uniforms: { uValleyLight: U.valleyLight, tFx: { value: null }, uDir: { value: new THREE.Vector2() } } });
    // other systems drive the look through grade.uniforms
    this.grade = fsMat({
      fragmentShader: GRADE_FS,
      uniforms: {
        uValleyLight: U.valleyLight, tDiffuse: { value: null }, tBloom: { value: this.bloom.texture }, tDistort: { value: this.distortRT.texture },
        tDepth: { value: null }, tFx: { value: this.fxA.texture },
        uFxRes: { value: new THREE.Vector2(1, 1) }, uPx: { value: new THREE.Vector2(1, 1) }, uNF: { value: new THREE.Vector2(0.1, 2400) },
        uAoTint: { value: new THREE.Color(0.2, 0.24, 0.36) }, uShaftColor: { value: new THREE.Color(0, 0, 0) },
        // sun on screen: uv xy, strength z (0 when off screen, hidden or below the horizon)
        uSunScr: { value: new THREE.Vector4(0.5, 0.5, 0, 0) }, uGlareColor: { value: new THREE.Color(1, 0.9, 0.7) },
        // amount, focus distance (m), far range (× focus), largest blur radius (screen heights)
        uDof: { value: new THREE.Vector4(0, 4, 0.9, 0.012) },
        uSharp: { value: 0.3 }, uBloomScatter: { value: this.bloom.strength },
        uDistort: { value: 0 }, uTime: { value: 0 }, uImpact: { value: 0 }, uHurt: { value: 0 }, uLowHp: { value: 0 },
        uSat: { value: 1.12 }, uVignette: { value: 0.2 }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color(1, 1, 1) },
        uMono: { value: 0 }, uAspect: { value: 1 },
        // 0..1 slow-motion look (perfect dodge): desaturate, cool tint, pulsing vignette
        uSlowmo: { value: 0 },
      },
    });
  }

  // The HDR scene target (4× MSAA). A depth texture is attached only when a tier's effects read it.
  buildSceneTarget(depth) {
    if (this.sceneRT) { this.sceneRT.depthTexture?.dispose(); this.sceneRT.dispose(); }
    const rt = (this.sceneRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
    if (depth) rt.depthTexture = new THREE.DepthTexture(4, 4);
    // `composer.readBuffer` is what the scene is drawn into: precompiles target it (Game.compileScene, VFX.prewarm)
    this.composer = { readBuffer: rt };
    this.grade.uniforms.tDiffuse.value = rt.texture;
    this.grade.uniforms.tDepth.value = this.fxMat.uniforms.tDepth.value = rt.depthTexture || null;
  }

  applyQuality() {
    const T = tier(), r = this.renderer;
    this.effectsWarm = false;
    r.shadowMap.enabled = T.shadowMap > 0;
    const fx = T.ao || T.shafts, depth = fx || T.dof;
    this.fxOn = fx;
    this.fxMat.uniforms.uAo.value.set(T.aoRadius, T.aoStrength, 90, 170);
    this.grade.uniforms.uSharp.value = T.sharp;
    const def = (m, d) => { if (JSON.stringify(m.defines) !== JSON.stringify(d)) { m.defines = d; m.needsUpdate = true; } };
    const fd = {};
    if (T.ao) fd.AO = 1;
    if (T.shafts) { fd.SHAFTS = 1; fd.SHAFT_STEPS = T.shadowMap >= 4096 ? 24 : 14; }
    def(this.fxMat, fd);
    const gd = {};
    if (depth) gd.USE_DEPTH = 1;
    if (fx) gd.FX = 1;
    if (T.dof) gd.DOF = 1;
    if (T.sharp > 0) gd.SHARP = 1;
    gd.FX_DEBUG = this.debugFx | 0; // dev: 1 shows the occlusion buffer, 2 the shafts (set, then applyQuality())
    def(this.grade, gd);
    if (!this.sceneRT || !!this.sceneRT.depthTexture !== depth) this.buildSceneTarget(depth);
    this.dyn = 1;
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    const W = Math.max(4, Math.round(w * pr)), H = Math.max(4, Math.round(h * pr));
    this.sceneRT.setSize(W, H);
    this.bloom.setSize(W, H);
    const hw = Math.max(4, Math.round(W * 0.5)), hh = Math.max(4, Math.round(H * 0.5));
    this.distortRT.setSize(hw, hh);
    this.fxA.setSize(hw, hh); this.fxB.setSize(hw, hh);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const u = this.grade.uniforms;
    u.uAspect.value = w / h;
    u.uPx.value.set(1 / W, 1 / H);
    u.uFxRes.value.set(hw, hh);
    this.fxMat.uniforms.uPx.value.set(1 / W, 1 / H);
  }

  // Hold the frame rate by trading resolution: shrink when frames run long, creep back up
  // once they have been on time for a while (called once per presented frame).
  pace(dt) {
    if (!this.dynamic || G.paused) return;
    const P = (this._pace ||= { slow: 0, ok: 0, wait: 6 });
    if (dt > 1 / 50) { P.slow += dt; P.ok = 0; } else { P.ok += dt; P.slow = Math.max(0, P.slow - dt * 0.5); }
    let next = this.dyn;
    if (P.slow > 0.6 && this.dyn > 0.6) { next = Math.max(0.6, this.dyn - 0.1); P.wait = Math.min(60, P.wait * 2); }
    else if (P.ok > P.wait && this.dyn < 1) next = Math.min(1, this.dyn + 0.1);
    if (next !== this.dyn) { this.dyn = next; P.slow = 0; P.ok = 0; this.resize(); }
  }

  // Sun glare: where the sun is on screen, and whether anything stands in front of it
  // (a ray against the terrain and the colliders' rough shapes would be overkill: the depth
  // buffer of the last frame at that pixel says it).
  glare(dt) {
    const u = this.grade.uniforms, sky = G.world && G.world.sky, cam = this.camera;
    let want = 0;
    if (sky && sky.uni.uSunVis.value > 0.05 && this.sceneRT.depthTexture) {
      const v = (this._sv ||= new THREE.Vector3()).copy(sky.uni.uSunDir.value).multiplyScalar(1000).add(cam.position).project(cam);
      if (v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1) {
        u.uSunScr.value.x = v.x * 0.5 + 0.5; u.uSunScr.value.y = v.y * 0.5 + 0.5;
        const edge = Math.min(1, (1.1 - Math.max(Math.abs(v.x), Math.abs(v.y))) * 4);
        want = edge * sky.uni.uSunVis.value * (this._sunSeen ?? 1);
        // read the depth under the sun once every few frames (async, never stalls)
        if (((this._gf = (this._gf || 0) + 1) % 6) === 0 && !this._gp) this.probeSun(u.uSunScr.value.x, u.uSunScr.value.y);
      }
      u.uGlareColor.value.copy(sky.sun.color).multiplyScalar(0.55);
    }
    u.uSunScr.value.z += (want - u.uSunScr.value.z) * Math.min(1, dt * 6);
  }
  probeSun(x, y) {
    const r = this.renderer, rt = this.fxB;
    if (!this.fxOn || !r.readRenderTargetPixelsAsync) { this._sunSeen = 1; return; }
    // fxB.b holds view depth / far after the last frame's effect pass: 1 = sky
    const px = (this._px ||= new Uint16Array(4));
    this._gp = r.readRenderTargetPixelsAsync(rt, Math.min(rt.width - 1, Math.max(0, Math.floor(x * rt.width))), Math.min(rt.height - 1, Math.max(0, Math.floor(y * rt.height))), 1, 1, px)
      .then(() => { this._sunSeen = THREE.DataUtils.fromHalfFloat(px[2]) > 0.6 ? 1 : 0; }, () => { this._sunSeen = 1; })
      .finally(() => { this._gp = null; });
  }

  // Occlusion + shafts into fxB, blurred across and down with depth as the guide.
  fxPass() {
    const r = this.renderer, q = this.quad, cam = this.camera, f = this.fxMat.uniforms, g = this.grade.uniforms, T = tier();
    f.uProj.value.set(cam.projectionMatrix.elements[5], cam.aspect, cam.far);
    const sky = G.world && G.world.sky;
    const map = sky && sky.sun.shadow.map;
    let shaft = 0;
    if (T.shafts && map && map.depthTexture && r.shadowMap.enabled) {
      const sh = sky.sun.shadow;
      f.tShadow.value = map.depthTexture;
      f.uShadowMat.value[0] = sh.getMatrix(0); f.uShadowMat.value[1] = sh.getMatrix(1);
      f.uCascade.value[0] = sh._cascadeData[0]; f.uCascade.value[1] = sh._cascadeData[1];
      f.uShaft.value.w = sh._cascadeData[1].y;
      shaft = sky.shaft;
    }
    f.uShaft.value.y = shaft > 0 ? 0.012 : 0;
    if (sky) {
      g.uShaftColor.value.copy(sky.sun.color).multiplyScalar(sky.sun.intensity * 0.3 * shaft);
      g.uAoTint.value.copy(U.shadeTint.value).multiplyScalar(1.15);
    }
    q.material = this.fxMat;
    r.setRenderTarget(this.fxB); q.render(r);
    const b = this.blurMat.uniforms;
    q.material = this.blurMat;
    b.tFx.value = this.fxB.texture; b.uDir.value.set(1 / this.fxA.width, 0);
    r.setRenderTarget(this.fxA); q.render(r);
    b.tFx.value = this.fxA.texture; b.uDir.value.set(0, 1 / this.fxA.height);
    r.setRenderTarget(this.fxB); q.render(r);
    g.tFx.value = this.fxB.texture;
  }

  render(dt) {
    const r = this.renderer, u = this.grade.uniforms, cam = this.camera;
    this.pace(dt);
    // The world's final lights/fog are now present. Start the existing HDR template
    // compilation before the first playable frame (and after a quality switch), rather
    // than waiting for VFX.update's one-second lighting check during the first spell.
    if (!this.effectsWarm && G.state === 'play' && G.vfx) {
      this.effectsWarm = true;
      G.vfx.prewarm();
    }
    u.uTime.value = G.realTime;
    const sky = G.world?.sky;
    const valley = U.valleyLight.value;
    const night = sky?.night ?? 0;
    this.bloom.strength = 0.28 + valley * (-0.065 + 0.15 * night);
    this.bloom.radius = 0.18 + valley * (-0.12 + 0.08 * night);
    u.uBloomScatter.value = this.bloom.strength;
    u.uNF.value.set(cam.near, cam.far);
    // depth of field: dialogue and cutscene shots focus on what the camera looks at
    const rig = G.cameraRig;
    const dof = rig && G.state === 'play' && G.mode !== 'free' ? rig.cine.k : 0;
    u.uDof.value.x = dof;
    if (dof > 0) u.uDof.value.y = Math.max(1.2, cam.position.distanceTo(rig.lookAtP));
    this.glare(dt);
    const D = G.vfx && G.vfx.distort;
    const on = !!(D && D.active);
    u.uDistort.value = on ? 1 : 0;
    if (on) {
      const prevA = r.getClearAlpha();
      r.getClearColor(this._cc || (this._cc = new THREE.Color()));
      r.setRenderTarget(this.distortRT);
      r.setClearColor(0x000000, 0); r.clear(true, false, false);
      r.render(this.distortScene, cam);
      r.setClearColor(this._cc, prevA);
    }
    // the next band of the sky's cloud map
    if (G.world && G.world.sky) G.world.sky.clouds.render(r, cam.position);
    // water mirrors the world on the top tier: that view is drawn first
    // (once the sun's shadow map exists: the mirrored view reuses it)
    const water = G.world && G.world.water;
    // one scene-graph update serves the mirrored and the main view
    const sc = this.scene, auto = sc.matrixWorldAutoUpdate;
    if (auto) { sc.updateMatrixWorld(); sc.matrixWorldAutoUpdate = false; }
    if (water && (!r.shadowMap.enabled || G.world.sky.sun.shadow.map)) water.reflect(r, sc, cam, tier().reflect, this.sceneRT.width, this.sceneRT.height);
    r.setRenderTarget(this.sceneRT);
    r.render(sc, cam);
    sc.matrixWorldAutoUpdate = auto;
    this.bloom.render(r, null, this.sceneRT);
    if (this.fxOn) this.fxPass();
    r.setRenderTarget(null);
    this.quad.material = this.grade;
    this.quad.render(r);
  }
}
