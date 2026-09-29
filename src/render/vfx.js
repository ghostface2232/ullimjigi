// Visual effects toolkit: particle presets, flash lights, shockwave rings,
// rune circles, lightning, ice crystals, tornados, beams and telegraphs.
import * as THREE from 'three';
import { Particles } from './particles.js';
import { fresnelMat, toon, U } from './materials.js';
import { G } from '../core/context.js';
import { randRange, rand, easeOutBack, clamp, mulberry32 } from '../core/util.js';

const C = (r, g, b) => new THREE.Color(r, g, b);
export const PAL = {
  arcane: { core: C(2.4, 1.9, 3.2), glow: C(1.2, 0.55, 2.6), deep: C(0.35, 0.12, 0.8), light: 0xa070ff },
  fire: { core: C(4.0, 2.6, 0.9), glow: C(3.0, 0.9, 0.12), deep: C(1.1, 0.12, 0.02), light: 0xff7a2a },
  frost: { core: C(2.4, 3.0, 3.4), glow: C(0.6, 1.8, 3.2), deep: C(0.15, 0.45, 1.2), light: 0x6cd0ff },
  storm: { core: C(3.6, 3.4, 2.2), glow: C(3.2, 2.4, 0.4), deep: C(1.4, 0.6, 1.6), light: 0xffd84a },
  wind: { core: C(2.0, 3.2, 2.6), glow: C(0.5, 2.4, 1.4), deep: C(0.1, 0.6, 0.4), light: 0x6effc0 },
  hush: { core: C(1.6, 1.2, 2.4), glow: C(0.7, 0.35, 1.4), deep: C(0.12, 0.06, 0.2), light: 0x8a5aff },
  heal: { core: C(2.2, 3.2, 2.0), glow: C(0.6, 2.4, 0.8), deep: C(0.1, 0.5, 0.1), light: 0x8aff9a },
  gold: { core: C(3.4, 2.9, 1.8), glow: C(2.4, 1.6, 0.5), deep: C(0.8, 0.5, 0.1), light: 0xffd88a },
  white: { core: C(3, 3, 3), glow: C(1.8, 1.8, 2), deep: C(0.5, 0.5, 0.6), light: 0xffffff },
};

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();

// ------------------------------------------------------------------
function runeTexture(seed = 7, detail = 1) {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rnd = mulberry32(seed);
  g.translate(S / 2, S / 2);
  g.strokeStyle = '#fff'; g.fillStyle = '#fff';
  g.shadowColor = '#fff'; g.shadowBlur = 6;
  const circ = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
  circ(244, 5); circ(230, 2); circ(172, 3); circ(156, 1.5); circ(62, 2.5);
  // runes ring
  const N = 28;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    g.save(); g.rotate(a); g.translate(0, -201); g.lineWidth = 2.4;
    g.beginPath();
    const k = 3 + Math.floor(rnd() * 3);
    let x = (rnd() - 0.5) * 16, y = (rnd() - 0.5) * 18;
    g.moveTo(x, y);
    for (let j = 0; j < k; j++) {
      x = Math.round((rnd() - 0.5) * 2) * 8; y = Math.round((rnd() - 0.5) * 2) * 9;
      if (rnd() < 0.3) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    if (rnd() < 0.4) { g.beginPath(); g.arc((rnd() - 0.5) * 10, (rnd() - 0.5) * 10, 2.5, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }
  // hexagram
  g.lineWidth = 2.5;
  for (let t = 0; t < 2; t++) {
    g.beginPath();
    for (let i = 0; i <= 3; i++) {
      const a = (i / 3) * Math.PI * 2 + t * Math.PI / 3 - Math.PI / 2;
      const x = Math.cos(a) * 156, y = Math.sin(a) * 156;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  if (detail) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      g.beginPath(); g.lineWidth = 2; g.arc(Math.cos(a) * 112, Math.sin(a) * 112, 14, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(Math.cos(a) * 112, Math.sin(a) * 112, 4, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath(); g.lineWidth = 1.2;
      g.moveTo(Math.cos(a) * 62, Math.sin(a) * 62); g.lineTo(Math.cos(a) * 92, Math.sin(a) * 92); g.stroke();
    }
  }
  g.beginPath(); g.arc(0, 0, 10, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function softDiscTexture() {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv); return t;
}

const RING_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const RING_FS = `
  uniform vec3 uColor; uniform float uAlpha; uniform float uThick; uniform float uFill; uniform float uTime; uniform float uNoise;
  varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
  void main(){
    vec2 p = vUv * 2.0 - 1.0; float d = length(p);
    if (d > 1.0) discard;
    float band = smoothstep(1.0, 1.0 - uThick * 0.35, d) * smoothstep(1.0 - uThick, 1.0 - uThick * 0.4, d);
    float fill = (1.0 - smoothstep(0.0, 1.0, d)) * 0.0 + smoothstep(0.2, 1.0, d) * uFill;
    float ang = atan(p.y, p.x);
    float n = mix(1.0, 0.6 + 0.4 * sin(ang * 13.0 + uTime * 6.0) * sin(ang * 7.0 - uTime * 3.0), uNoise);
    float a = (band + fill) * uAlpha * n;
    gl_FragColor = vec4(uColor * a, a);
  }`;

const TORNADO_FS = `
  uniform vec3 uColor; uniform vec3 uCore; uniform float uAlpha; uniform float uTime; uniform float uSpeed;
  varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
  float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
  void main(){
    vec2 uv = vUv; uv.x += uTime * uSpeed + uv.y * 0.6;
    float n = n2(vec2(uv.x * 9.0, uv.y * 3.0 - uTime * 2.0)) * 0.6 + n2(vec2(uv.x * 18.0, uv.y * 6.0 - uTime * 3.0)) * 0.4;
    float stripes = smoothstep(0.45, 0.8, n);
    float edge = smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
    float a = stripes * edge * uAlpha;
    vec3 col = mix(uColor, uCore, smoothstep(0.7, 1.0, n));
    gl_FragColor = vec4(col * a, a);
  }`;

// ------------------------------------------------------------------
export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.add = new Particles(scene, 8000, true);
    this.norm = new Particles(scene, 3000, false);
    this.fx = [];
    this.runeTex = runeTexture(7, 1);
    this.runeTex2 = runeTexture(23, 0);
    this.discTex = softDiscTexture();

    // Light pool
    this.lights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 14, 1.4);
      l.castShadow = false;
      scene.add(l);
      this.lights.push({ l, t: 0, dur: 0, peak: 0, follow: null, held: false });
    }

    // Ring pool
    this.ringGeo = new THREE.PlaneGeometry(2, 2);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(this.ringGeo, new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 1 }, uThick: { value: 0.2 }, uFill: { value: 0 }, uTime: U.time, uNoise: { value: 0 } },
        vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      m.visible = false; m.renderOrder = 8; m.frustumCulled = false;
      scene.add(m);
      this.rings.push({ m, busy: false });
    }

    // Geometries
    this.orbGeo = new THREE.IcosahedronGeometry(1, 3);
    this.crystalGeo = new THREE.OctahedronGeometry(1, 0);
    this.crystalGeo.scale(0.45, 1, 0.45);
    this.crystalGeo.translate(0, 0.9, 0);
    this.iceMat = toon(0xc8f2ff, { emissive: 0x3a8ab0, emissiveIntensity: 0.9, rim: 1.2, flat: true });
    this.iceMatT = toon(0xc8f2ff, { emissive: 0x3a8ab0, emissiveIntensity: 0.9, rim: 1.2, flat: true, transparent: true, opacity: 0.8, nocache: true });
    this.cylGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
    this.cylGeo.translate(0, 0.5, 0);
  }

  // ---------------- lights ----------------
  flash(pos, color, intensity = 30, distance = 14, dur = 0.25) {
    let best = null;
    for (const s of this.lights) if (!s.held && (!best || s.l.intensity < best.l.intensity)) best = s;
    if (!best) return;
    best.l.position.copy(pos);
    best.l.color.set(color);
    best.l.distance = distance;
    best.peak = intensity; best.t = 0; best.dur = dur; best.follow = null;
    best.l.intensity = intensity;
  }
  holdLight(color, intensity = 18, distance = 10) {
    const s = this.lights.find((s) => !s.held && s.l.intensity < 0.5) || this.lights.find((s) => !s.held);
    if (!s) return null;
    s.held = true; s.l.color.set(color); s.l.intensity = intensity; s.l.distance = distance; s.peak = intensity; s.dur = 0;
    return s;
  }
  releaseLight(s) { if (s) { s.held = false; s.t = 0; s.dur = 0.15; s.peak = s.l.intensity; } }

  // ---------------- particles ----------------
  burst(pos, preset, n = 12, o = {}) {
    const P = this.presets[preset];
    if (!P) return;
    const q = G.settings.quality === 'low' ? 0.5 : 1;
    const cnt = Math.max(1, Math.round(n * q));
    for (let i = 0; i < cnt; i++) P.call(this, pos, o, i, cnt);
  }

  // ---------------- rings ----------------
  ring(pos, color, radius = 4, dur = 0.5, o = {}) {
    const r = this.rings.find((r) => !r.busy);
    if (!r) return;
    r.busy = true;
    const m = r.m, u = m.material.uniforms;
    m.visible = true;
    m.position.copy(pos); m.position.y += o.y ?? 0.15;
    m.rotation.set(o.rx ?? 0, 0, o.rz ?? 0);
    if (o.up) m.quaternion.setFromUnitVectors(tmpV.set(0, 1, 0), o.up);
    u.uColor.value.copy(color instanceof THREE.Color ? color : new THREE.Color(color));
    u.uThick.value = o.thick ?? 0.18; u.uFill.value = o.fill ?? 0; u.uNoise.value = o.noise ?? 0;
    const r0 = o.r0 ?? 0.2;
    let t = 0;
    this.fx.push({
      update: (dt) => {
        t += dt; const k = clamp(t / dur, 0, 1);
        const e = 1 - Math.pow(1 - k, 3);
        const s = r0 + (radius - r0) * e;
        m.scale.set(s, s, s);
        u.uAlpha.value = (o.alpha ?? 1) * (1 - k) * (1 - k);
        if (k >= 1) { m.visible = false; r.busy = false; return false; }
        return true;
      },
    });
  }

  // ---------------- rune circle ----------------
  circle(pos, color, size = 2, dur = 1, o = {}) {
    const mat = new THREE.MeshBasicMaterial({
      map: o.alt ? this.runeTex2 : this.runeTex, color: (color instanceof THREE.Color ? color.clone() : new THREE.Color(color)).multiplyScalar(o.intensity ?? 1.6),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    m.renderOrder = 7;
    if (o.vertical) {
      m.position.copy(pos);
      if (o.dir) m.lookAt(tmpV.copy(pos).add(o.dir));
    } else {
      m.rotation.x = -Math.PI / 2;
      m.position.copy(pos); m.position.y += 0.08;
    }
    this.scene.add(m);
    let t = 0;
    const spin = o.spin ?? 1.2;
    const h = {
      mesh: m, done: false, follow: o.follow || null, offset: o.offset || null,
      end() { h.done = true; },
      update: (dt) => {
        t += dt;
        const inT = Math.min(1, t / 0.18);
        const s = size * (o.grow ? 0.5 + 0.5 * easeOutBack(inT) : easeOutBack(inT));
        let alpha = inT;
        if (dur > 0 && t > dur) h.done = true;
        if (h.done) { h.out = (h.out || 0) + dt / 0.3; alpha = Math.max(0, 1 - h.out); }
        m.scale.set(s * (1 + (h.out || 0) * 0.3), s * (1 + (h.out || 0) * 0.3), 1);
        mat.opacity = alpha * (o.alpha ?? 0.9);
        if (o.vertical) m.rotateZ(dt * spin); else m.rotation.z += dt * spin;
        if (h.follow) {
          m.position.copy(h.follow.position || h.follow);
          if (h.offset) m.position.add(h.offset);
          if (!o.vertical) m.position.y += 0.08;
        }
        if (h.done && alpha <= 0) { this.scene.remove(m); mat.dispose(); m.geometry.dispose(); return false; }
        return true;
      },
    };
    this.fx.push(h);
    return h;
  }

  // ---------------- lightning ----------------
  lightning(from, to, o = {}) {
    const color = o.color || PAL.storm.core;
    const width = o.width ?? 0.18;
    const dur = o.dur ?? 0.22;
    const segs = o.segs ?? 14;
    const strands = [{ a: from.clone(), b: to.clone(), w: width, jag: o.jag ?? 0.12 }];
    const nb = o.branches ?? 2;
    for (let i = 0; i < nb; i++) {
      const t = randRange(0.25, 0.75);
      const a = from.clone().lerp(to, t);
      const len = from.distanceTo(to) * randRange(0.2, 0.4);
      const b = a.clone().add(tmpV.set(randRange(-1, 1), randRange(-0.6, 0.3), randRange(-1, 1)).normalize().multiplyScalar(len));
      strands.push({ a, b, w: width * 0.5, jag: 0.18 });
    }
    const meshes = [];
    for (const s of strands) {
      for (const layer of [0, 1]) {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array((segs + 1) * 2 * 3);
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const idx = [];
        for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        geo.setIndex(idx);
        const col = layer === 0 ? color.clone().multiplyScalar(1.6) : (o.glow || PAL.storm.glow).clone().multiplyScalar(0.55);
        const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 11;
        this.scene.add(m);
        meshes.push({ m, s, layer, pts: [] });
      }
    }
    const regen = () => {
      for (const mm of meshes) {
        if (mm.layer === 1 && mm.pts.length) continue;
        const { a, b, jag } = mm.s;
        const len = a.distanceTo(b);
        const pts = [];
        for (let i = 0; i <= segs; i++) {
          const t = i / segs;
          const p = a.clone().lerp(b, t);
          if (i > 0 && i < segs) {
            const amp = len * jag * Math.sin(t * Math.PI);
            p.x += randRange(-1, 1) * amp; p.y += randRange(-1, 1) * amp; p.z += randRange(-1, 1) * amp;
          }
          pts.push(p);
        }
        mm.pts = pts;
        const twin = meshes.find((x) => x.s === mm.s && x.layer === 1);
        if (twin) twin.pts = pts;
      }
    };
    regen();
    let t = 0, rt = 0;
    this.fx.push({
      update: (dt) => {
        t += dt; rt += dt;
        if (rt > 0.05) { rt = 0; for (const mm of meshes) if (mm.layer === 0) mm.pts = []; regen(); }
        const cam = G.camera.position;
        const k = t / dur;
        const fl = (0.6 + rand() * 0.4) * (1 - k * k);
        for (const mm of meshes) {
          const arr = mm.m.geometry.attributes.position.array;
          const pts = mm.pts; const w = mm.s.w * (mm.layer ? 5 : 1);
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const pa = pts[Math.max(0, i - 1)], pb = pts[Math.min(pts.length - 1, i + 1)];
            tmpV.subVectors(pb, pa).normalize();
            tmpV2.subVectors(cam, p).normalize();
            tmpV3.crossVectors(tmpV, tmpV2).normalize().multiplyScalar(w * (1 - 0.6 * (i / pts.length)));
            arr[i * 6] = p.x + tmpV3.x; arr[i * 6 + 1] = p.y + tmpV3.y; arr[i * 6 + 2] = p.z + tmpV3.z;
            arr[i * 6 + 3] = p.x - tmpV3.x; arr[i * 6 + 4] = p.y - tmpV3.y; arr[i * 6 + 5] = p.z - tmpV3.z;
          }
          mm.m.geometry.attributes.position.needsUpdate = true;
          mm.m.material.opacity = fl;
        }
        if (t >= dur) {
          for (const mm of meshes) { this.scene.remove(mm.m); mm.m.geometry.dispose(); mm.m.material.dispose(); }
          return false;
        }
        return true;
      },
    });
  }

  // ---------------- orbs ----------------
  orb(el, size = 0.3) {
    const p = PAL[el] || PAL.arcane;
    const mat = fresnelMat(p.core, p.glow, { intensity: 1.2 });
    const m = new THREE.Mesh(this.orbGeo, mat);
    m.scale.setScalar(size);
    m.renderOrder = 12;
    this.scene.add(m);
    return m;
  }
  disposeOrb(m) { this.scene.remove(m); m.material.dispose(); }

  // ---------------- ice crystal ----------------
  crystal(pos, height = 2, o = {}) {
    const m = new THREE.Mesh(this.crystalGeo, o.transparent ? this.iceMatT : this.iceMat);
    m.position.copy(pos);
    m.rotation.set(randRange(-0.25, 0.25) + (o.tiltX || 0), rand() * Math.PI * 2, randRange(-0.25, 0.25) + (o.tiltZ || 0));
    m.castShadow = true;
    m.scale.set(0.001, 0.001, 0.001);
    this.scene.add(m);
    let t = 0;
    const life = o.life ?? 1.4;
    const w = o.width ?? height * 0.45;
    this.fx.push({
      update: (dt) => {
        t += dt;
        if (t < 0.16) {
          const k = easeOutBack(t / 0.16);
          m.scale.set(w * k, height * k, w * k);
        } else if (t > life) {
          const k = (t - life) / 0.18;
          if (k >= 1) {
            this.burst(m.position.clone().add(tmpV.set(0, height * 0.5, 0)), 'ice', 8, { spread: height * 0.4 });
            this.scene.remove(m);
            return false;
          }
          m.scale.set(w * (1 - k), height * (1 - k * 0.3), w * (1 - k));
        }
        return true;
      },
    });
    return m;
  }

  // ---------------- tornado ----------------
  tornado(pos, o = {}) {
    const p = PAL[o.el || 'wind'];
    const grp = new THREE.Group();
    grp.position.copy(pos);
    const mats = [];
    const layers = [[1.3, 3.2, 7, 0.9], [0.9, 2.3, 6, 1.4], [0.5, 1.4, 5, 2.1]];
    for (const [rb, rt, h, sp] of layers) {
      const geo = new THREE.CylinderGeometry(rt, rb, h, 20, 6, true); geo.translate(0, h / 2, 0);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: p.glow.clone() }, uCore: { value: p.core.clone() }, uAlpha: { value: 0 }, uTime: U.time, uSpeed: { value: sp } },
        vertexShader: RING_VS, fragmentShader: TORNADO_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      mats.push(mat);
      const m = new THREE.Mesh(geo, mat); m.renderOrder = 9; grp.add(m);
    }
    grp.scale.setScalar(o.scale ?? 1);
    this.scene.add(grp);
    const h = {
      grp, alpha: 0, done: false,
      update: (dt) => {
        h.alpha = h.done ? Math.max(0, h.alpha - dt * 2.5) : Math.min(1, h.alpha + dt * 4);
        for (const m of mats) m.uniforms.uAlpha.value = h.alpha * (o.alpha ?? 0.9);
        grp.rotation.y += dt * 6;
        if (h.done && h.alpha <= 0) { this.scene.remove(grp); grp.traverse((c) => c.geometry && c.geometry.dispose()); mats.forEach((m) => m.dispose()); return false; }
        return true;
      },
    };
    this.fx.push(h);
    return h;
  }

  // ---------------- beam ----------------
  beam(el, o = {}) {
    const p = PAL[el] || PAL.arcane;
    const grp = new THREE.Group();
    const core = new THREE.Mesh(this.cylGeo, new THREE.MeshBasicMaterial({ color: p.core.clone().multiplyScalar(1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glow = new THREE.Mesh(this.cylGeo, new THREE.MeshBasicMaterial({ color: p.glow.clone().multiplyScalar(0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    core.renderOrder = 12; glow.renderOrder = 11;
    grp.add(core, glow);
    this.scene.add(grp);
    const h = {
      grp, width: o.width ?? 0.25, alpha: 0, done: false,
      set(a, b) {
        const len = a.distanceTo(b);
        grp.position.copy(a);
        tmpV.subVectors(b, a).normalize();
        grp.quaternion.setFromUnitVectors(tmpV2.set(0, 1, 0), tmpV);
        const w = h.width * (0.85 + Math.sin(G.time * 40) * 0.15);
        core.scale.set(w * 0.45, len, w * 0.45);
        glow.scale.set(w * 1.6, len, w * 1.6);
      },
      update: (dt) => {
        h.alpha = h.done ? Math.max(0, h.alpha - dt * 5) : Math.min(1, h.alpha + dt * 10);
        core.material.opacity = h.alpha; glow.material.opacity = h.alpha * 0.7;
        if (h.done && h.alpha <= 0) { this.scene.remove(grp); core.material.dispose(); glow.material.dispose(); return false; }
        return true;
      },
    };
    this.fx.push(h);
    return h;
  }

  // ---------------- telegraph (enemy warnings) ----------------
  telegraph(pos, radius, dur, color = 0xff3a2a, o = {}) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(1.5) }, uAlpha: { value: 0 }, uThick: { value: 0.08 }, uFill: { value: 0.35 }, uTime: U.time, uNoise: { value: 0 } },
      vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.copy(pos); m.position.y += 0.2; m.renderOrder = 8;
    m.scale.setScalar(radius);
    this.scene.add(m);
    const inner = new THREE.Mesh(this.ringGeo, mat.clone());
    inner.material.uniforms.uFill.value = 0.6; inner.material.uniforms.uThick.value = 0.15;
    inner.position.copy(m.position); inner.renderOrder = 8;
    this.scene.add(inner);
    let t = 0;
    const h = {
      mesh: m, done: false,
      update: (dt) => {
        t += dt; const k = clamp(t / dur, 0, 1);
        if (o.follow) { m.position.copy(o.follow); m.position.y += 0.2; inner.position.copy(m.position); }
        mat.uniforms.uAlpha.value = Math.min(1, t * 6) * (0.7 + 0.3 * Math.sin(t * 20));
        inner.scale.setScalar(Math.max(0.01, radius * k));
        inner.material.uniforms.uAlpha.value = 0.8;
        if (t >= dur || h.done) {
          this.scene.remove(m); this.scene.remove(inner); mat.dispose(); inner.material.dispose();
          return false;
        }
        return true;
      },
    };
    this.fx.push(h);
    return h;
  }

  // ---------------- scorch decal ----------------
  scorch(pos, radius = 2.5, color = 0x000000, dur = 6) {
    const mat = new THREE.MeshBasicMaterial({ map: this.discTex, color, transparent: true, opacity: 0.5, depthWrite: false });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.copy(pos); m.position.y += 0.06; m.scale.setScalar(radius); m.rotation.y = rand() * 6;
    m.renderOrder = 2;
    this.scene.add(m);
    let t = 0;
    this.fx.push({ update: (dt) => { t += dt; mat.opacity = 0.5 * (1 - t / dur); if (t >= dur) { this.scene.remove(m); mat.dispose(); return false; } return true; } });
  }

  // generic timed callback effect
  timer(dur, fn, end) {
    let t = 0;
    this.fx.push({ update: (dt) => { t += dt; fn && fn(dt, t / dur, t); if (t >= dur) { end && end(); return false; } return true; } });
  }

  update(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      let alive = false;
      try { alive = this.fx[i].update(dt); } catch (e) { console.warn('fx', e); }
      if (!alive) this.fx.splice(i, 1);
    }
    for (const s of this.lights) {
      if (s.held) continue;
      if (s.dur > 0) {
        s.t += dt;
        const k = clamp(1 - s.t / s.dur, 0, 1);
        s.l.intensity = s.peak * k * k;
        if (k <= 0) { s.dur = 0; s.l.intensity = 0; }
      }
    }
    this.add.update(dt, G.time);
    this.norm.update(dt, G.time);
  }
}

// ------------------------------------------------------------------
// Particle presets. `this` = VFX.  (pos, opts, index, count)
// ------------------------------------------------------------------
const rv = (s) => randRange(-s, s);
function sphereDir(out, s = 1) { const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u); out[0] = r * Math.cos(a) * s; out[1] = u * s; out[2] = r * Math.sin(a) * s; return out; }
const D = [0, 0, 0];
const GREY = C(0.12, 0.11, 0.13), GREY2 = C(0.3, 0.29, 0.31);

VFX.prototype.presets = {
  fire(p, o) {
    const s = o.spread ?? 0.4, sp = o.speed ?? 2;
    sphereDir(D, sp);
    this.add.emit({ p: [p.x + rv(s), p.y + rv(s), p.z + rv(s)], v: [D[0] + (o.vx || 0), Math.abs(D[1]) + 1.5 + (o.vy || 0), D[2] + (o.vz || 0)], life: randRange(0.35, 0.8) * (o.life || 1),
      size: randRange(0.5, 1.1) * (o.size || 1), size1: randRange(0.1, 0.3), color: PAL.fire.core, color1: PAL.fire.deep, alpha: o.alpha ?? 0.75, alpha1: 0, drag: 2, grav: -2.5, shape: 0 });
  },
  ember(p, o) {
    const sp = o.speed ?? 5;
    sphereDir(D, sp);
    this.add.emit({ p: [p.x, p.y, p.z], v: [D[0], Math.abs(D[1]) * 1.2 + 1, D[2]], life: randRange(0.6, 1.4),
      size: randRange(0.06, 0.14), color: PAL.fire.core, color1: PAL.fire.glow, alpha: 1, alpha1: 0, drag: 1.8, grav: 3, shape: 1, turb: 4 });
  },
  smoke(p, o) {
    const s = o.spread ?? 0.6;
    this.norm.emit({ p: [p.x + rv(s), p.y + rv(s) * 0.5, p.z + rv(s)], v: [rv(0.8), randRange(0.8, 2), rv(0.8)], life: randRange(1.2, 2.2),
      size: randRange(0.8, 1.4) * (o.size || 1), size1: randRange(2.2, 3.4) * (o.size || 1), color: o.color || GREY, color1: o.color1 || GREY2, alpha: o.alpha ?? 0.45, alpha1: 0, drag: 1.2, grav: -0.3, shape: 3, fadeIn: 0.1 });
  },
  spark(p, o) {
    const c = PAL[o.el || 'fire'];
    sphereDir(D, o.speed ?? 9);
    this.add.emit({ p: [p.x, p.y, p.z], v: [D[0], D[1] + 2, D[2]], life: randRange(0.25, 0.55), size: randRange(0.08, 0.16), size1: 0.02,
      color: c.core, color1: c.glow, alpha: 1, alpha1: 0.2, drag: 3.5, grav: 14, shape: 1 });
  },
  ice(p, o) {
    const s = o.spread ?? 0.3;
    sphereDir(D, o.speed ?? 6);
    this.add.emit({ p: [p.x + rv(s), p.y + rv(s), p.z + rv(s)], v: [D[0], Math.abs(D[1]) + 2, D[2]], life: randRange(0.5, 1),
      size: randRange(0.15, 0.35) * (o.size || 1), size1: 0.05, color: PAL.frost.core, color1: PAL.frost.glow, alpha: 1, alpha1: 0, drag: 1.5, grav: 16, shape: 2 });
  },
  frostmist(p, o) {
    const s = o.spread ?? 0.8;
    this.norm.emit({ p: [p.x + rv(s), p.y + rv(s) * 0.4, p.z + rv(s)], v: [rv(1), randRange(0.2, 1), rv(1)], life: randRange(0.9, 1.6),
      size: randRange(0.8, 1.5) * (o.size || 1), size1: randRange(2, 3.2) * (o.size || 1), color: C(0.82, 0.93, 1.0), color1: C(0.7, 0.85, 1.0), alpha: o.alpha ?? 0.35, alpha1: 0, drag: 1.5, grav: 0.2, shape: 3, fadeIn: 0.15 });
  },
  electric(p, o) {
    const s = o.spread ?? 0.3;
    sphereDir(D, o.speed ?? 8);
    this.add.emit({ p: [p.x + rv(s), p.y + rv(s), p.z + rv(s)], v: [D[0], D[1], D[2]], life: randRange(0.12, 0.35),
      size: randRange(0.15, 0.35), size1: 0.05, color: PAL.storm.core, color1: PAL.storm.glow, alpha: 1, alpha1: 0, drag: 6, grav: 0, shape: 4 });
  },
  wind(p, o, i, n) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.3, r = o.radius ?? 0.8, sp = o.speed ?? 6;
    const ca = Math.cos(a), sa = Math.sin(a);
    this.add.emit({ p: [p.x + ca * r, p.y + rv(0.4), p.z + sa * r], v: [-sa * sp + ca * 2 + (o.vx || 0), randRange(0.5, 2) + (o.vy || 0), ca * sp + sa * 2 + (o.vz || 0)], life: randRange(0.4, 0.8),
      size: randRange(0.25, 0.5), size1: 0.05, color: PAL.wind.core, color1: PAL.wind.glow, alpha: 0.8, alpha1: 0, drag: 2.5, grav: 0, shape: o.shape ?? 0 });
  },
  arcane(p, o) {
    const s = o.spread ?? 0.3;
    sphereDir(D, o.speed ?? 4);
    this.add.emit({ p: [p.x + rv(s), p.y + rv(s), p.z + rv(s)], v: [D[0], D[1] + 1, D[2]], life: randRange(0.35, 0.8),
      size: randRange(0.18, 0.4), size1: 0.02, color: PAL.arcane.core, color1: PAL.arcane.glow, alpha: 1, alpha1: 0, drag: 3, grav: -0.5, shape: rand() < 0.4 ? 4 : 0 });
  },
  trail(p, o) {
    const c = PAL[o.el || 'arcane'];
    const s = o.spread ?? 0.08;
    this.add.emit({ p: [p.x + rv(s), p.y + rv(s), p.z + rv(s)], v: [rv(0.5) + (o.vx || 0), rv(0.5) + (o.vy || 0), rv(0.5) + (o.vz || 0)], life: o.life ?? randRange(0.18, 0.35),
      size: (o.size ?? 0.35) * randRange(0.7, 1.1), size1: 0.02, color: c.core, color1: c.glow, alpha: o.alpha ?? 0.9, alpha1: 0, drag: 2, grav: o.grav ?? 0, shape: o.shape ?? 0 });
  },
  heal(p, o) {
    const s = o.spread ?? 0.5;
    this.add.emit({ p: [p.x + rv(s), p.y + rv(0.3), p.z + rv(s)], v: [rv(0.3), randRange(1, 2.5), rv(0.3)], life: randRange(0.7, 1.3),
      size: randRange(0.15, 0.3), size1: 0.02, color: PAL.heal.core, color1: PAL.heal.glow, alpha: 1, alpha1: 0, drag: 1, shape: 4 });
  },
  ash(p, o) {
    const s = o.spread ?? 0.5;
    this.norm.emit({ p: [p.x + rv(s), p.y + rv(s), p.z + rv(s)], v: [rv(1), randRange(0.5, 2.5), rv(1)], life: randRange(1, 2),
      size: randRange(0.1, 0.25), size1: 0.05, color: C(0.15, 0.12, 0.2), color1: C(0.35, 0.3, 0.45), alpha: 0.9, alpha1: 0, drag: 1, grav: -0.4, shape: 2, turb: 3 });
  },
  hush(p, o) {
    const s = o.spread ?? 0.6;
    this.norm.emit({ p: [p.x + rv(s), p.y + rv(s) * 0.5, p.z + rv(s)], v: [rv(0.6), randRange(0.3, 1.2), rv(0.6)], life: randRange(1.2, 2.2),
      size: randRange(0.6, 1.2) * (o.size || 1), size1: randRange(1.8, 2.8) * (o.size || 1), color: C(0.2, 0.17, 0.26), color1: C(0.4, 0.36, 0.48), alpha: o.alpha ?? 0.4, alpha1: 0, drag: 1, grav: -0.2, shape: 3, fadeIn: 0.2 });
  },
  dust(p, o) {
    const a = rand() * Math.PI * 2, sp = (o.speed ?? 5) * randRange(0.6, 1);
    this.norm.emit({ p: [p.x + Math.cos(a) * 0.5, p.y + 0.2, p.z + Math.sin(a) * 0.5], v: [Math.cos(a) * sp, randRange(0.3, 1.5), Math.sin(a) * sp], life: randRange(0.6, 1.2),
      size: randRange(0.6, 1.1) * (o.size || 1), size1: randRange(1.8, 2.8) * (o.size || 1), color: o.color || C(0.62, 0.55, 0.42), color1: o.color || C(0.7, 0.64, 0.52), alpha: 0.5, alpha1: 0, drag: 3, grav: -0.2, shape: 3 });
  },
  steam(p, o) {
    const s = o.spread ?? 1;
    this.norm.emit({ p: [p.x + rv(s), p.y + rv(s) * 0.4, p.z + rv(s)], v: [rv(2), randRange(1.5, 4), rv(2)], life: randRange(1.2, 2.2),
      size: randRange(1, 2) * (o.size || 1), size1: randRange(3.5, 5) * (o.size || 1), color: C(0.95, 0.97, 1), color1: C(0.85, 0.88, 0.92), alpha: 0.55, alpha1: 0, drag: 1.4, grav: -0.5, shape: 3, fadeIn: 0.08 });
  },
  soul(p, o) {
    const c = PAL[o.el || 'gold'];
    this.add.emit({ p: [p.x + rv(0.4), p.y + rv(0.4), p.z + rv(0.4)], v: [rv(0.5), randRange(1.2, 2.6), rv(0.5)], life: randRange(1.4, 2.6),
      size: randRange(0.15, 0.35), size1: 0.05, color: c.core, color1: c.glow, alpha: 1, alpha1: 0, drag: 0.5, grav: -0.3, shape: rand() < 0.5 ? 4 : 0, turb: 2 });
  },
  glow(p, o) {
    const c = PAL[o.el || 'gold'];
    this.add.emit({ p: [p.x, p.y, p.z], v: [0, 0, 0], life: o.life ?? 0.2, size: o.size ?? 2, size1: o.size1 ?? (o.size ?? 2) * 1.5,
      color: o.color || c.core, color1: o.color1 || c.glow, alpha: o.alpha ?? 1, alpha1: 0, shape: 0 });
  },
  star(p, o) {
    const c = PAL[o.el || 'white'];
    this.add.emit({ p: [p.x, p.y, p.z], v: [0, 0, 0], life: o.life ?? 0.25, size: o.size ?? 2.5, size1: o.size1 ?? 0.5,
      color: c.core, color1: c.glow, alpha: 1, alpha1: 0, shape: 4 });
  },
  firefly(p, o) {
    this.add.emit({ p: [p.x + rv(o.spread ?? 10), p.y + randRange(0.5, 3), p.z + rv(o.spread ?? 10)], v: [rv(0.3), rv(0.2), rv(0.3)], life: randRange(3, 6),
      size: randRange(0.08, 0.14), color: C(2.2, 2.6, 0.8), color1: C(1.2, 1.6, 0.3), alpha: 1, alpha1: 0, drag: 0, grav: 0, shape: 0, turb: 1.2, fadeIn: 0.4 });
  },
  pollen(p, o) {
    this.add.emit({ p: [p.x + rv(o.spread ?? 14), p.y + randRange(0.3, 4), p.z + rv(o.spread ?? 14)], v: [randRange(0.2, 0.8), rv(0.15), randRange(0, 0.4)], life: randRange(3, 6),
      size: randRange(0.04, 0.08), color: C(1.4, 1.35, 1.0), color1: C(1.0, 1.0, 0.8), alpha: 0.9, alpha1: 0, drag: 0, shape: 0, turb: 0.6, fadeIn: 0.3 });
  },
  snow(p, o) {
    this.norm.emit({ p: [p.x + rv(o.spread ?? 16), p.y + randRange(4, 12), p.z + rv(o.spread ?? 16)], v: [randRange(0.5, 1.5), randRange(-1.6, -0.8), rv(0.4)], life: randRange(4, 7),
      size: randRange(0.06, 0.14), color: C(1, 1, 1), color1: C(1, 1, 1), alpha: 0.95, alpha1: 0.5, drag: 0, shape: 0, turb: 0.8, fadeIn: 0.1 });
  },
};
