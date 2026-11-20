// The Heart's armour pivots and skinned arms share geometry and baked maps from the model cache.
import * as THREE from 'three';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { G } from '../core/context.js';
import { angleDamp, damp } from '../core/util.js';
import { U } from '../render/materials.js';
import { model } from '../render/models.js';

function paintFirmament(mat, floor, sky) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSealHeight = floor;
    shader.uniforms.uInterior = { value: mat.name === 'InnerFirmament' ? 1 : 0 };
    shader.uniforms.uRiftSky = sky;
    shader.vertexShader = 'varying float vRiftY;\n' + shader.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\nvRiftY = (modelMatrix * vec4(transformed, 1.0)).y;');
    shader.fragmentShader = 'varying float vRiftY; uniform float uSealHeight, uInterior; uniform vec3 uRiftSky;\n' + shader.fragmentShader
      .replace('#include <emissivemap_fragment>', `
        vec3 look = normalize(vViewPosition);
        vec2 skyUv = vEmissiveMapUv;
        #if defined(USE_NORMALMAP_TANGENTSPACE) && !defined(USE_TANGENT)
          // The sculpt uses a separate atlas, so derive the view offset in the sky chart's frame.
          mat3 skyFrame = getTangentFrame(-vViewPosition, nonPerturbedNormal, vEmissiveMapUv);
          skyUv += vec2(dot(look, skyFrame[0]), dot(look, skyFrame[1])) * .023;
        #endif
        vec3 distant = texture2D(emissiveMap, skyUv).rgb;
        totalEmissiveRadiance *= distant;
      `)
      .replace('#include <opaque_fragment>', `
        float heightBand = smoothstep(2.0, 13.0, vRiftY - uSealHeight);
        outgoingLight *= mix(vec3(.52,.53,.84), vec3(.81,.74,1.04), heightBand);
        float cavity = 0.0;
        #ifdef USE_AOMAP
          cavity = 1.0 - ambientOcclusion;
        #endif
        float cloud = smoothstep(.005, .066, distant.b);
        float stars = smoothstep(.058, .36, distant.g);
        vec3 gas = mix(vec3(.014,.024,.13), vec3(.21,.046,.46), cloud);
        float grazing = pow(1.0 - clamp(dot(normal,look), 0.0, 1.0), 3.22);
        outgoingLight += gas * (.23 + .80 * cloud + .61 * cavity + .20 * uInterior) +
          grazing * mix(vec3(.16,.14,.36),vec3(.40,.22,.64),heightBand) * (0.86 + 0.14 * clamp(uRiftSky.b,0.0,1.0));
        outgoingLight += stars * vec3(.69,.85,1.03);
        outgoingLight = min(outgoingLight, vec3(1.28));
        #include <opaque_fragment>
      `);
  };
  mat.customProgramCacheKey = () => 'hush-firmament';
}

const floorY = { value: 0 };
const wardParts = ['WardPlate', 'Drops', 'Quills'];
const fractures = [[0, 0, 8.8], [-7, 9, 3.7], [5.4, 9.4, 4.3]];
const emitter = (name) => name === 'EyeLight' || name === 'EyeCorona' || name === 'WardLight' || name === 'VioletGaze';

// Keep the encounter playable if the model request fails, like the authored rift gate.
function fallbackKit() {
  const root = new THREE.Group();
  function piece(name, geometry, color, y = 0) {
    const mat = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = name; mesh.position.y = y; root.add(mesh);
    return mesh;
  }
  const core = piece('BlackCore', new THREE.SphereGeometry(1.35, 20, 14), 0x151121, 6);
  core.scale.z = 0.8;
  const eye = piece('Eye', new THREE.SphereGeometry(1, 16, 6), 0xa3e8ff, 6);
  eye.scale.set(1.6, 0.09, 0.08); eye.position.z = 1.08;
  eye.material.name = 'EyeLight'; eye.material.emissive.setRGB(2.2, 3.3, 4.2);
  const plate = piece('WardPlate', new THREE.OctahedronGeometry(1), 0xb49761);
  plate.scale.set(0.86, 1.35, 0.33);
  for (const name of ['Drops', 'Quills']) {
    const gem = piece(name, new THREE.OctahedronGeometry(0.42), 0xffffff);
    gem.position.z = 0.34; gem.material.name = 'WardLight';
  }
  return root;
}

export function prepareHeart() {
  const kit = cloneRig(model('mn_heart')?.scene || fallbackKit());
  const materials = new Map();
  const rigid = new Set(), skinned = new Set();
  kit.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const source = mesh.material;
    if (!materials.has(source)) {
      const mat = source.clone();
      if (mat.emissiveMap && ['DeepFirmament', 'InnerFirmament', 'CarvedBasalt'].includes(mat.name)) paintFirmament(mat, floorY, U.skyRefl);
      else if (!emitter(mat.name)) {
        mat.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
            'outgoingLight = min(outgoingLight, vec3(1.28));\n#include <opaque_fragment>');
        };
        mat.customProgramCacheKey = () => 'hush-armour';
      }
      materials.set(source, mat);
    }
    mesh.material = materials.get(source);
    const samples = mesh.isSkinnedMesh ? skinned : rigid;
    if (!samples.has(source)) {
      samples.add(source);
      G.vfx.keep(mesh.material, mesh.geometry, mesh.skeleton);
    }
  });
  return kit;
}

export function heartWard(kit, ward, color) {
  const group = new THREE.Group();
  const face = kit.getObjectByName('WardPlate').clone(true);
  const glyph = kit.getObjectByName(ward === 'fire' || ward === 'frost' ? 'Drops' : 'Quills').clone(true);
  let ink;
  glyph.traverse((m) => {
    if (m.material?.name !== 'WardLight') return;
    if (!ink) {
      ink = m.material.clone();
      ink.color.setHex(color); ink.emissive.copy(ink.color); ink.emissiveIntensity = 2.6;
    }
    m.material = ink;
  });
  group.add(face, glyph);
  return { group, ink, orbit: glyph.getObjectByName('WardOrbit' + glyph.name) };
}

export class HeartBody {
  constructor(heart, kit) {
    this.heart = heart;
    this.root = cloneRig(kit);
    for (const name of wardParts) this.root.getObjectByName(name).removeFromParent();
    this.root.position.y = -6;
    heart.core.add(this.root);
    this.eye = this.root.getObjectByName('Eye');
    this.eyeScale = this.eye.scale.clone();
    this.iris = [];
    this.eye.traverse((m) => {
      if (!m.isMesh || !emitter(m.material.name)) return;
      const mat = m.material = m.material.clone();
      this.iris.push({ mat, strength: mat.emissiveIntensity });
    });
    this.parts = this.root.children.filter((p) => /^(Tip|Spur|Tine|Crown|Breast)/.test(p.name))
      .map((p) => ({ p, home: p.position.clone(), side: p.name.endsWith('R') ? 1 : -1 }));
    this.lenses = this.root.children.filter(p => p.name.startsWith('SealLens'))
      .map(part => ({ part, height: part.scale.y }));
    this.shards = this.root.children.filter(p => p.name.startsWith('Fracture'))
      .map(part => ({ part, home: part.position.clone(), side: part.name.endsWith('R') ? 1 : -1 }));
    const clips = model('mn_heart')?.animations || [];
    this.mixer = new THREE.AnimationMixer(this.root);
    this.poses = clips.filter(clip => clip.name === 'SealWindup' || clip.name === 'SealUnbound')
      .map(clip => {
        const action = this.mixer.clipAction(clip).play();
        action.paused = true; action.time = clip.duration; action.weight = 0;
        return { action, windup: clip.name === 'SealWindup' };
      });
    this.arms = [];
    for (const suffix of ['L', 'R']) {
      const arm = this.root.getObjectByName('UpperArm' + suffix);
      if (!arm) continue;
      const joints = ['UpperArm', 'Forearm', 'Wrist'].map(name => this.root.getObjectByName(name + suffix));
      this.arms.push({ side: suffix === 'L' ? -1 : 1, joints, base: joints.map(b => b.quaternion.clone()) });
    }
    this.castKind = ''; this.castStart = 0; this.castWind = 0; this.releaseAt = -Infinity;
    this.buckle = 0;
    this.vortex = this.root.getObjectByName('Vortex');
    this.vortexScale = this.vortex?.scale.clone();
    this.skirt = this.root.getObjectByName('VortexSkirt');
    this.skirtScale = this.skirt?.scale.clone();
    this.stage = 0; this.split = 0; this.open = 0;
    this.yaw = Math.atan2(G.player.pos.x - heart.center0.x, G.player.pos.z - heart.center0.z);
    heart.core.rotation.y = this.yaw;
    floorY.value = heart.center0.y;
    const portal = G.world.rift.group.userData.portal;
    this.portal = portal;
    this.portalScale = portal.scale.clone();
    this.cracks = [];
  }

  gather(kind, duration) {
    this.castKind = kind; this.castStart = G.time; this.castWind = duration; this.releaseAt = -Infinity;
  }

  release() { this.releaseAt = G.time; }

  hands(wind, impulse, buckle, death, breath) {
    // Restore the mixer's previous output first. Three skips unchanged tracks
    // when the weights hold, including during pauses and the long break pose.
    for (const { joints, base } of this.arms) {
      for (let i = 0; i < joints.length; i++) joints[i].quaternion.copy(base[i]);
    }
    this.mixer.update(0);
    for (const { joints, base, side } of this.arms) {
      for (let i = 0; i < joints.length; i++) base[i].copy(joints[i].quaternion);
      const [arm, fore, wrist] = joints;
      const sweep = this.castKind === 'beam', wave = this.castKind === 'wave';
      arm.rotation.x += -.045 * breath - .25 * wind - (wave ? .14 : .50) * impulse + .30 * death;
      arm.rotation.z += side * (.035 * breath + (wave ? .68 : .27) * wind
        + (wave ? -.56 : .46) * impulse - .65 * buckle - .80 * death);
      fore.rotation.x += -.09 * breath - .46 * wind + .59 * impulse + .32 * buckle;
      fore.rotation.y += side * (.44 * wind - .66 * impulse + .25 * death);
      wrist.rotation.z += side * (.21 * wind - .31 * impulse - .27 * buckle);
      const recoil = this.heart.flash * (1 - death);
      fore.rotation.x -= .31 * recoil; arm.rotation.z += side * .18 * recoil;
      if (sweep) arm.rotation.y += side * .76 * impulse;
      if (death) wrist.rotation.x += death * .76;
    }
  }

  update(dt) {
    const h = this.heart, t = G.time;
    this.yaw = angleDamp(this.yaw, Math.atan2(G.player.pos.x - h.center0.x, G.player.pos.z - h.center0.z), 5, dt);
    h.core.rotation.y = this.yaw;
    this.stage = damp(this.stage, h.phase >= 2 ? 1 : 0, 2.5, dt);
    this.split = damp(this.split, h.phase === 3 ? 1 : 0, 2.3, dt);
    this.open = damp(this.open, h.exposed > 0 ? 1 : 0, 5, dt);
    const breath = Math.sin(t * 1.55);
    if (h.brk.down > 0) { this.castKind = ''; this.releaseAt = -Infinity; }
    this.buckle = damp(this.buckle, h.brk.down > 0 ? 1 : 0, h.brk.down > 0 ? 7 : 2.8, dt);
    const age = G.time - this.releaseAt;
    const windup = this.castKind && age === Infinity
      ? THREE.MathUtils.smoothstep(G.time - this.castStart, 0, this.castWind * .73) : 0;
    const impulse = 1 - THREE.MathUtils.smoothstep(age, .07, this.castKind === 'beam' ? 1.55 : .62);
    for (const { action, windup: isWindup } of this.poses) {
      action.weight = isWindup ? windup * .78 : this.split * (1 - windup) * .80;
    }
    this.hands(windup, impulse, this.buckle, 0, breath);
    for (const { part, height } of this.lenses) {
      part.scale.y = height * (1 + .045 * breath + .16 * this.open);
    }
    for (const { part, home, side } of this.shards) {
      part.position.copy(home);
      part.position.x += side * (.17 * this.stage + .52 * this.split);
      part.position.y += .10 * this.stage + .13 * this.split + .035 * Math.sin(t + home.y);
      part.rotation.z = side * (.045 * this.stage + .14 * this.split);
    }
    this.root.rotation.z = Math.sin(t * 0.68) * 0.013 + h.flash * .043 - this.buckle * .065;
    this.root.scale.set(1 + breath * .009, 1 + breath * .006, 1);
    this.eye.scale.set(this.eyeScale.x * (.65 + .58 * this.open + .13 * this.split),
      this.eyeScale.y * (.50 + .96 * this.open + .21 * this.split), this.eyeScale.z);
    for (const { mat, strength } of this.iris) {
      mat.emissiveIntensity = strength * (.85 + .65 * this.open + .48 * this.split + h.flash * .35);
    }
    for (const { p, home, side } of this.parts) {
      p.position.copy(home);
      if (p.name.startsWith('Breast')) {
        p.position.x += side * this.split * .76;
        p.rotation.z = side * this.split * .23;
        p.rotation.y = side * this.split * .36;
      } else {
        const tip = p.name.startsWith('Tip');
        const lift = tip ? 1.55 : .25;
        p.position.y += Math.sin(t * .88 + home.x) * .095 + lift * this.stage;
        p.position.x += side * this.stage * (tip ? 1.23 : .34);
        p.rotation.z = side * ((tip ? -.25 : .085) * this.stage + Math.sin(t + home.y) * .018);
      }
    }
    if (this.vortex) {
      this.vortex.rotation.y = Math.sin(t * .56) * .13;
      const width = 1 + this.stage * .46 + this.split * .18;
      const height = h.core.position.y - h.center0.y;
      this.vortex.position.y = 6 - height;
      this.vortex.scale.copy(this.vortexScale);
      if (this.skirt) {
        this.skirt.position.y = 6 - height;
        this.skirt.rotation.y = t * .22;
        this.skirt.scale.copy(this.skirtScale);
        this.skirt.scale.x *= width; this.skirt.scale.z *= width;
      }
      this.vortex.scale.y *= Math.max(.16, height / 6);
    }
    const distance = Math.hypot(G.player.pos.x - h.center0.x, G.player.pos.z - h.center0.z);
    G.world.sky.uni.uRift.value = (this.stage * .76 + this.split * .24) * (1 - THREE.MathUtils.smoothstep(distance, 40, 85));
    this.portal.material.uniforms.uRift.value = this.split;
    this.portal.scale.copy(this.portalScale);
    this.portal.scale.x *= 1 + this.split * 1.95;
    this.portal.scale.y *= 1 + this.split * 1.28;
    if (h.phase === 3) this.fracture();
  }

  death(t) {
    const fold = THREE.MathUtils.smoothstep(t, .08, 1.52);
    const fall = THREE.MathUtils.smoothstep(t, .7, 2.95);
    // The arms lose their suspension before the seal disappears beneath them.
    this.hands(0, 0, this.buckle * (1 - fold), fold, 0);
    this.root.rotation.z = -.08 * fold - .08 * fall;
    this.deathY ??= this.heart.core.position.y;
    this.heart.core.position.y = THREE.MathUtils.lerp(this.deathY, this.heart.center0.y, fall);
    this.heart.core.scale.setScalar(1 - .985 * fall);
    this.eye.scale.y = this.eyeScale.y * Math.max(.02, 1 - fold);
  }

  // Reuse the ground-decal pool. A full pool may recycle a mark during a long fight.
  fracture() {
    const h = this.heart;
    for (let i = 0; i < fractures.length; i++) {
      const old = this.cracks[i];
      if (old?.d.busy && old.d.seq === old.seq) continue;
      const [x, z, r] = fractures[i], at = h.center0.clone();
      at.x += x; at.z += z; at.y = G.world.ground(at.x, at.z, at.y + 3);
      const d = G.vfx.decal(at, 'crack', r, { rot: .7 + i * 1.87, dur: 86400, glowDur: 86400,
        alpha: 1.3, glow: new THREE.Color(.60,.115,.78), glowA: .86 });
      if (d) this.cracks[i] = { d, seq: d.seq };
    }
  }

  end() {
    for (const mark of this.cracks) if (mark) G.vfx.endDecal(mark.d, mark.seq, .28);
    this.cracks.length = 0;
    G.world.sky.uni.uRift.value = 0;
    this.portal.material.uniforms.uRift.value = 0;
    this.portal.scale.copy(this.portalScale);
  }

  dispose() {
    this.end();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    const skeletons = new Set();
    this.root.traverse(o => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
    for (const skeleton of skeletons) skeleton.dispose();
    for (const { mat } of this.iris) mat.dispose();
    this.iris.length = 0;
  }
}
