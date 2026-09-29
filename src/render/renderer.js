import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { G } from '../core/context.js';
import './materials.js'; // installs the global aerial-perspective fog chunks before any compile

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uImpact: { value: 0 },
    uHurt: { value: 0 },
    uLowHp: { value: 0 },
    uSat: { value: 1.12 },
    uVignette: { value: 0.32 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uMono: { value: 0 },
    uAspect: { value: 1 },
    // 0..1 slow-motion look (perfect dodge): desaturate, cool tint, pulsing vignette
    uSlowmo: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uImpact, uHurt, uLowHp, uSat, uVignette, uFlash, uMono, uAspect, uSlowmo;
    uniform vec3 uFlashColor;
    varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float ca = 0.0012 + uImpact * 0.010;
      vec3 col;
      col.r = texture2D(tDiffuse, uv - c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + c * ca).b;
      if (uImpact > 0.02) {
        vec3 acc = col;
        for (int i = 1; i < 6; i++) acc += texture2D(tDiffuse, uv - c * float(i) * 0.014 * uImpact).rgb;
        col = mix(col, acc / 6.0, clamp(uImpact * 1.4, 0.0, 1.0));
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat * (1.0 - uMono));
      // painterly split tone: cool shadows, warm highlights
      col *= mix(vec3(0.95, 0.99, 1.07), vec3(1.04, 1.0, 0.95), smoothstep(0.02, 0.9, l));
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
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Renderer {
  constructor(canvas) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 2400);
    this.setupComposer();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  pixelRatio() {
    const q = G.settings.quality;
    const dpr = window.devicePixelRatio || 1;
    return q === 'high' ? Math.min(dpr, 1.5) : q === 'medium' ? Math.min(dpr, 1) : 0.75;
  }

  setupComposer() {
    const r = this.renderer;
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.5, 1.35);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  applyQuality() {
    const q = G.settings.quality;
    this.renderer.shadowMap.enabled = q !== 'low';
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.grade.uniforms.uAspect.value = w / h;
  }

  render(dt) {
    const u = this.grade.uniforms;
    u.uTime.value = G.realTime;
    this.composer.render(dt);
  }
}
