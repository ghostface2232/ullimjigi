// Humanoid rig: type building (geometry + skeleton per CHAR entry), procedural
// animation, faces, expressions and gestures. See characters.js for the contract.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { toon, addOutline, glowMat, ghostMat } from '../render/materials.js';
import { damp, clamp, lerp, rand } from '../core/util.js';
import { Sculpt, tube, blob, sheet, prof, sstep, mix, TAU, instance, bodyMat, faceMat, crackMat, ghostSkinMat, ik2, setWorldQuat, rotateTowards, Chain, Spring, SkelDef, clothMat, SURF, faceMat2, olMat, skinMat, eyeMat } from './charkit.js';
import * as HB from './humanoid.js';
import { crystalMaterial, crystalGeometry, crystalGlowSprite } from '../render/crystal.js';
import { model } from '../render/models.js';

const V3 = THREE.Vector3;
const _v1 = new V3(), _v2 = new V3(), _v3 = new V3(), _v4 = new V3(), _v5 = new V3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const _m1 = new THREE.Matrix4();
const _q2Pole = new V3();
const wrapA = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const ease = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------------------
// Preset characters. Proportions: adults stand about 6.7 heads tall (ADULT), children
// keep a head of the same real size on a short body. Garment keys are read by humanType.
const ADULT = { headR: 0.128, legLen: 0.88, torsoK: 0.86, limb: 0.9, neckW: 0.95 };
export const CHAR = {
  // young echo-keeper: cream tunic, hooded blue mantle and cape, the family's red scarf
  player: { ...ADULT, headR: 0.132, legLen: 0.86, torsoLen: 0.97, skin: 0xf3d2b2, top: 0xeee2c4, pants: 0x3e4a5e, boots: 0x6a4a30, hair: 0x5a3a26, hairStyle: 'fringe', hat: 'hood', hatColor: 0x2f5a8a, cape: 0x2f5a8a, lining: 0x1e2c48, capeLen: 0.62, scarf: 0xc8463c, staff: {}, belt: 0x7a5a38, sleeve: 0xeee2c4, gloves: 0x6a4a30, outline: true, brows: true, eyeColor: 0x3e6a8a, tunic: 0xeee2c4, tunicLen: 0.3, tunicVent: 0.32, tunicTrim: 0x2f5a8a, mantle: true, pouch: true, charm: true, bootH: 0.55, bootStrap: true, noCuff: true, fem: 0.25, blush: true },
  // grandmother witch: flared purple robe, fringed shawl with a brooch, crumpled hat
  mora: { scale: 0.86, headR: 0.14, legLen: 0.8, torsoK: 0.9, limb: 0.9, skin: 0xefcdb4, top: 0x6a4a8a, robe: 0x5a3a7a, robeLen: 0.72, robeFlare: 1.3, robeTrim: 0xd8a860, pants: 0x3a2a4a, hair: 0xe8e4e0, hairStyle: 'bun', hat: 'witch', hatColor: 0x4a3070, hatBand: 0xd8a860, hunch: 0.28, glasses: true, cane: true, sleeve: 0x6a4a8a, sleeveFlare: true, blush: true, outline: true, age: 1, eyeColor: 0x5a4a3a, shawl: 0x8a6a5a, mantleLen: 1.25, gem: 0xe07a3a, sash: 0xd8a860, collar: 'frill', collarColor: 0xf0e8dc, fem: 1, browColor: 0xc8c4c0, bootH: 0, laces: false },
  // bell-keeper and village head: leather vest, wrapped forearms, a bell at his belt
  bau: { scale: 1.08, bodyW: 1.35, belly: true, headR: 0.136, legLen: 0.84, limb: 1.05, skin: 0xe6b894, top: 0x8a6a4a, vest: 0x5a4030, vestLeather: true, vestTrim: 'cord', pants: 0x4a3a2a, hairStyle: 'bald', hair: 0xf0f0f0, beard: 0xf0f0f0, mustache: true, spear: true, brows: true, outline: true, age: 0.8, bushyBrows: true, nose: 1.35, jaw: 1, eyeColor: 0x4a3a2a, bareArms: true, sleeveShort: 'top', armWrap: true, belt: 0x4a3020, beltW: 0.027, charm: true, kneePatch: 'patch', bootH: 0.35 },
  // village child: peaked cap, braces, shorts and scuffed shoes
  dodam: { scale: 0.68, skin: 0xf6d6b8, top: 0x6aa0d8, pants: 0x7a5a3a, hair: 0x3a2a1a, hairStyle: 'spiky', hat: 'cap', hatColor: 0xe07a3a, hatBand: 0xb85a2a, blush: true, outline: true, stride: 2.6, headR: 0.19, kid: 1, freckles: 0.8, eyeColor: 0x7a4a26, eyeSoft: 1, pupilR: 0.36, lidRest: 0.04, smileRest: 0.14, eyeDiv: 0.006,
    // his everyday smile is a closed one, bright and round-eyed; the teeth are for laughing
    exprs: { smile: { mOpen: 0, smile: 0.95, cheek: 0.3, open: 1.06, raise: 0.28, btilt: 0.25 }, grin: { mOpen: 0.22 } }, legLen: 0.72, torsoLen: 0.9, bootH: 0, pantsLoose: 0.012, bareArms: true, sleeveShort: 'top', sleeveHem: 'collar', shorts: 0.72, socks: 0.42, suspenders: 0x8a3a30, collar: 'fold', collarColor: 0xf4f0e4, boots: 0x7a4a30 },
  // wandering scholar: long buttoned coat, satchel with a scroll, round glasses
  isol: { ...ADULT, scale: 1.02, skin: 0xf0d0b4, top: 0x3f7a5a, sleeve: 0x3f7a5a, pants: 0x3a3a44, hair: 0x2a2030, hairStyle: 'bob', glasses: true, book: true, satchel: true, scarf: 0xd8c070, outline: true, eyeColor: 0x2a3a4a, bodyW: 0.9, legLen: 0.86, tunic: 0x3f7a5a, tunicLen: 0.46, tunicOpen: 0.2, tunicTrim: 0xd8c070, buttons: 4, belt: 0x4a3a2a, cuff: 'fold', cuffColor: 0xe8dcc0, fem: 0.5, bootH: 0.6 },
  // baker: kerchief, puff-sleeved dress, big apron tied in a bow
  danbi: { scale: 0.96, bodyW: 1.25, belly: true, headR: 0.138, legLen: 0.82, limb: 1.0, skin: 0xf0c8a4, top: 0xd87a5a, robe: 0xc06a4a, robeLen: 0.7, robeTrim: 0xf4ecd8, apron: 0xf4ecd8, apronTie: 'collar', hair: 0x6a3a24, hat: 'scarf', hatColor: 0xe8c050, hatBand: 0xd8a840, blush: true, outline: true, fem: 1, faceRound: 1, eyeColor: 0x4a2a1a, sleeve: 0xd87a5a, sleevePuff: 0.35, cuff: 'fold', cuffColor: 0xf4ecd8, collar: 'frill', collarColor: 0xf4ecd8, age: 0.3, bootH: 0.2, laces: false },
  villagerA: { ...ADULT, scale: 1.0, skin: 0xe8c0a0, top: 0x9a7a4a, pants: 0x4a4a3a, hair: 0x2a2a2a, hairStyle: 'short', outline: true, belt: 0x5a4028, eyeColor: 0x2a2018, jaw: 0.6, neckerchief: 0xb04a3a, cuff: 'fold', kneePatch: 'patch', suspenders: 0x5a4028, bootH: 0.4 },
  villagerB: { ...ADULT, scale: 0.95, skin: 0xf2d0b0, top: 0x7a9a6a, robe: 0x5a7a5a, robeLen: 0.72, robeTrim: 0xe8dcc0, pants: 0x3a3a2a, hair: 0x8a5a2a, hairStyle: 'long', outline: true, fem: 1, eyeColor: 0x3a5a3a, sash: 0xe8dcc0, collar: 'fold', collarColor: 0xf0e8d8, sleevePuff: 0.25, cuff: 'frill', cuffColor: 0xf0e8d8, blush: true, bootH: 0.2, laces: false },
  villagerC: { scale: 0.9, headR: 0.138, legLen: 0.82, torsoK: 0.9, limb: 0.9, skin: 0xe0b890, top: 0xa05a4a, pants: 0x4a3a3a, hair: 0xd0d0d0, hairStyle: 'short', beard: 0xd0d0d0, hunch: 0.2, cane: true, outline: true, age: 1, eyeColor: 0x3a3028, beardLen: 1.2, belt: 0x4a3024, vest: 0x6a5a48, collar: 'stand', bootH: 0.3, jaw: 0.5 },
  seha: { ...ADULT, scale: 0.98, skin: 0xf2d4b8, top: 0xdde8f4, robe: 0x9ac0e0, robeLen: 0.78, robeTrim: 0xf4f4f8, hair: 0x5a3a26, hairStyle: 'long', scarf: 0xc8463c, outline: false, fem: 1, eyeColor: 0x3e6a8a, hairLen: 0.5, sash: 0xf4f4f8, cuff: 'frill', sleevePuff: 0.2, bootH: 0.2, laces: false },
  kael: { scale: 1.18, bodyW: 1.2, headR: 0.132, legLen: 0.86, skin: 0xe0c0a0, top: 0x7a7a88, pants: 0x4a4a54, hat: 'helmet', hatColor: 0x9a9aa8, plume: 0x3a6ad0, cape: 0x2a4a9a, lining: 0x1a2a5a, capeLen: 0.95, outline: false, armor: true, metal: 0x9a9aa8, gloves: 0x5a5a66, boots: 0x5a5a66, eyeColor: 0x3a4a6a, hairStyle: 'none', noEars: true, noCuff: true, laces: false },
};

// colors for material keys
function palette(c) {
  const dk = (x, k) => new THREE.Color(x).multiplyScalar(k).getHex();
  const top = c.top ?? 0xe8dcc0, sleeve = c.sleeve ?? top, boots = c.boots ?? 0x5a3e2a, hair = c.hair ?? 0x5a3a24, glove = c.gloves ?? 0x6a4a30;
  return {
    skin: c.skin ?? 0xf2cfae, top, sleeve, pants: c.pants ?? 0x5a4a3a, boots,
    sole: dk(boots, 0.45), bootCuff: dk(boots, 1.28), lace: 0xe6dcc4, hair, hairIn: dk(hair, 0.6), pin: 0xc89a48, hat: c.hatColor ?? 0x5a3a8a, hatBand: c.hatBand ?? 0xd8b060,
    scarf: c.scarf ?? 0xc8463c, cape: c.cape ?? 0x2f4a7a, lining: c.lining ?? dk(c.cape ?? 0x2f4a7a, 0.55), belt: c.belt ?? 0x6a4a2a, buckle: 0xd0a850,
    glove, gloveCuff: dk(glove, 0.78), beard: c.beard ?? hair, frame: 0x3a3028, metal: c.metal ?? c.hatColor ?? 0x9a9aa8, trim: c.trim ?? 0xd8b060, gold: 0xe0b450, visor: 0x101014,
    plume: c.plume ?? 0x3a6ad0, satchel: 0x8a6a44, strap: 0x5a4028, apron: c.apron ?? 0xf4ecd8, vest: c.vest ?? 0x5a4030, robe: c.robe ?? top,
    tunic: c.tunic ?? top, dark: 0x201a24, shawl: c.shawl ?? 0x8a6a5a, pouch: 0x6a4a30, sleeveIn: dk(sleeve, 0.5),
    cuff: c.cuffColor ?? dk(sleeve, 0.72), collar: c.collarColor ?? dk(top, 1.18), placket: dk(c.tunic ?? top, 0.82), button: c.button ?? 0xe8d8a8, gem: c.gem ?? 0x48c0d0,
    bracer: 0x6a4a30, wrap: 0xe6dcc8, sock: 0xf0ece0, cord: 0x3a2a20, paper: 0xf0e6cc, patch: dk(c.pants ?? 0x5a4a3a, 1.45), sash: c.sash ?? 0xd8b060,
    neckerchief: c.neckerchief ?? 0xb04a3a, suspenders: c.suspenders ?? 0x5a4028, tunicTrim: c.tunicTrim ?? 0xd8b060, robeTrim: c.robeTrim ?? 0xd8b060,
  };
}
// surface response per material key (charkit clothMat); unlisted keys are woven cloth
const LEATHER = ['boots', 'bootCuff', 'belt', 'glove', 'gloveCuff', 'satchel', 'strap', 'pouch', 'bracer'];
const METAL = ['buckle', 'gold', 'trim', 'pin', 'frame', 'metal'];
const MATTE = ['sole', 'lace', 'cord', 'paper', 'button', 'visor', 'dark'];
function surfOf(c) {
  const m = {};
  for (const k of LEATHER) m[k] = SURF.leather;
  for (const k of METAL) m[k] = SURF.metal;
  for (const k of MATTE) m[k] = SURF.matte;
  for (const k of ['hair', 'hairIn', 'beard']) m[k] = SURF.hair;
  m.gem = SURF.gem;
  if (c.vestLeather) m.vest = SURF.leather;
  return (k) => m[k] ?? SURF.cloth;
}

// Code-built geometry for a type (every enemy on the humanoid base, and any person without a model)
function sculptType(c, cc, L, def, pal, { capeCh, scarfCh, plumeCh, hairCh, extraCh }) {
  const S = new Sculpt(def);
  if (c.body !== false) HB.body(S, L, cc, {});
  if (c.head !== false) HB.head(S, L, cc);
  if (c.hairStyle !== 'none') HB.hair(S, L, cc);
  if (hairCh) HB.hairBack(S, L, cc, hairCh.map((h) => h.names));
  if (c.beard) HB.beard(S, L, cc);
  if (c.mustache) HB.mustache(S, L, cc);
  if (c.bushyBrows) HB.bushyBrows(S, L, cc);
  if (c.glasses) HB.glasses(S, L, cc);
  if (c.armor) HB.armor(S, L, cc);
  if (c.collar) HB.collar(S, L, cc, 'collar', c.collar);
  if (c.buttons) HB.placket(S, L, cc, 'placket', c.buttons);
  if (c.suspenders) HB.suspenders(S, L, cc, 'suspenders');
  if (c.vest) HB.vest(S, L, cc, 'vest');
  if (c.tunic) HB.skirt(S, L, cc, 'tunic', { bottom: L.H - (c.tunicLen ?? 0.3), flare: 0.5, folds: 8, uTop: 0.4, hipBias: 0.7, vent: c.tunicVent, open: c.tunicOpen, trim: c.tunicTrim ? 'tunicTrim' : null, trim2: c.tunicTrim ? 'trim' : null });
  let robeZ = null;
  if (c.robe) robeZ = HB.skirt(S, L, cc, 'robe', { bottom: Math.max(0.05, L.H - (c.robeLen ?? 0.7)), flare: (c.robeFlare ?? 1) * 0.9, folds: 11, uTop: 0.36, nv: 9, hipBias: 0.45, trim: c.robeTrim ? 'robeTrim' : null, trim2: c.robeTrim ? 'robeTrim' : null });
  if (c.apron) HB.apron(S, L, cc, 'apron', robeZ);
  if (c.belt || c.tunic) HB.belt(S, L, cc, 'belt', c.tunic ? 0.41 : 0.39);
  if (c.sash) HB.sash(S, L, cc, 'sash', 0.4);
  if (c.satchel) HB.satchel(S, L, cc);
  if (c.shawl) HB.mantle(S, L, cc, 'shawl', 'shawl');
  else if (c.mantle) HB.mantle(S, L, cc, 'cape', 'lining');
  if (capeCh && !c.shawl) HB.cape(S, L, cc, capeCh, 'cape', 'lining');
  if (scarfCh) HB.scarf(S, L, cc, scarfCh);
  else if (c.neckerchief) HB.neckerchief(S, L, cc, 'neckerchief');
  if (c.hat === 'hood') { HB.hood(S, L, cc, 'hood', 'hoodIn', [['hoodUp', 1], ['hoodUpN', 1.5]]); HB.hoodDown(S, L, cc, 'hoodDn', 'hoodDnIn', ['hoodDn']); }
  else if (c.hat && c.hat !== 'hood') HB.hat(S, L, cc, c.hat);
  if (plumeCh) HB.plume(S, L, plumeCh[0]);
  if (c.sculpt) c.sculpt(S, L, def, extraCh);
  const colorOf = (k) => pal[k] ?? (k === 'hood' || k === 'hoodDn' ? pal.cape : k === 'hoodIn' || k === 'hoodDnIn' ? pal.lining : 0xff00ff);
  return S.build({ color: colorOf, group: c.group || ((k) => (k === 'skin' ? 'skin' : 'main')), surf: surfOf(c) });
}

// A second-generation model (ref/blender/c2_*.py) has eyeballs of its own and brings bones the
// code skeleton lacks (fingers, eyes, hair and cloth chains named c_<kind><n>_<k>).
function isV2(gltf) {
  let v2 = false;
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh && o.material.name === 'CH_eye') v2 = true; });
  return v2;
}
function modelBones(gltf, def, key) {
  let sk = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh && (!sk || o.skeleton.bones.length > sk.bones.length)) sk = o.skeleton; });
  const chains = {}, p = new V3();
  const visit = (b) => {
    if (b.isBone) {
      b.getWorldPosition(p);
      if (!def.has(b.name)) {
        def.add(b.name, b.parent && b.parent.isBone ? b.parent.name : 'hips', p.x, p.y, p.z);
        const m = /^c_([a-z]+)(\d+)_(\d+)$/.exec(b.name);
        if (m) (chains[m[1] + m[2]] || (chains[m[1] + m[2]] = { kind: m[1], names: [] })).names.push(b.name);
      } else if (p.distanceTo(def.pos(b.name)) > 0.004 && b.name !== 'jaw') console.warn(`ch_${key}: bone ${b.name} is ${(p.distanceTo(def.pos(b.name)) * 1000).toFixed(1)} mm off the game skeleton`);
    }
    for (const k of b.children) visit(k);
  };
  visit(gltf.scene);
  return Object.values(chains).map((ch) => {
    const last = def.b[def.i(ch.names[ch.names.length - 1])], a = last.pos, b = def.b[last.parent].pos;
    return { ...ch, tail: a.clone().multiplyScalar(2).sub(b) };
  });
}

// Geometry from an authored glTF: its primitives (materials CH_skin / CH_main) become the draw
// groups of one geometry in bind space, joints are re-indexed to this skeleton by bone name,
// and `onrm` carries normals welded across split vertices for the outline hull.
function fromModel(gltf, def) {
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  // the head (shape keys) stays a geometry of its own: morph textures cover every vertex of a geometry
  const face = meshes.filter((m) => m.geometry.morphAttributes.position);
  const built = mergeModel(meshes.filter((m) => !m.geometry.morphAttributes.position), def);
  // baked maps per material group: albedo, tangent-space normal map, ORM (occlusion, roughness, metal)
  built.tex = {};
  for (const m of meshes) {
    const mt = m.material;
    if (mt.map) { built.tex[mt.name.replace(/^CH_/, '')] = { map: mt.map, normalMap: mt.normalMap, orm: mt.roughnessMap }; for (const t of [mt.map, mt.normalMap, mt.roughnessMap]) if (t) t.anisotropy = 4; }
  }
  if (face.length) {
    const f = mergeModel(face, def);
    const src = face[0], dict = src.morphTargetDictionary;
    built.face = { geo: f.geo, morphs: Object.keys(dict).sort((a, b) => dict[a] - dict[b]), spec: JSON.parse((src.parent.userData && src.parent.userData.face) || src.userData.face || '{}') };
    built.tris += f.tris;
  }
  return built;
}
function mergeModel(meshes, def) {
  let nv = 0, ni = 0;
  for (const m of meshes) { nv += m.geometry.attributes.position.count; ni += m.geometry.index.count; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3), ON = new Float32Array(nv * 3), UV = new Float32Array(nv * 2);
  const SI = new Uint16Array(nv * 4), SW = new Float32Array(nv * 4), OL = new Float32Array(nv), SF = new Float32Array(nv);
  const I = new Uint32Array(ni);
  const geo = new THREE.BufferGeometry(), mats = [];
  const nm = meshes[0] && meshes[0].geometry.morphAttributes.position ? meshes[0].geometry.morphAttributes.position.length : 0;
  const MP = []; for (let k = 0; k < nm; k++) MP.push(new Float32Array(nv * 3));
  let vo = 0, io = 0;
  for (const m of meshes) {
    const a = m.geometry.attributes, n = a.position.count;
    const map = m.skeleton.bones.map((b) => def.map[b.name] ?? 0);
    const ol = a._olw, sf = a._surf, col = a.color, uv = a.uv, mp = m.geometry.morphAttributes.position;
    for (let k = 0; k < n; k++) {
      const v = vo + k;
      P[v * 3] = a.position.getX(k); P[v * 3 + 1] = a.position.getY(k); P[v * 3 + 2] = a.position.getZ(k);
      N[v * 3] = a.normal.getX(k); N[v * 3 + 1] = a.normal.getY(k); N[v * 3 + 2] = a.normal.getZ(k);
      C[v * 3] = col ? col.getX(k) : 1; C[v * 3 + 1] = col ? col.getY(k) : 1; C[v * 3 + 2] = col ? col.getZ(k) : 1;
      if (uv) { UV[v * 2] = uv.getX(k); UV[v * 2 + 1] = uv.getY(k); }
      for (let j = 0; j < 4; j++) { SI[v * 4 + j] = map[a.skinIndex.getComponent(k, j)]; SW[v * 4 + j] = a.skinWeight.getComponent(k, j); }
      OL[v] = ol ? ol.getX(k) : 1; SF[v] = sf ? sf.getX(k) : 0;
      if (mp) for (let q = 0; q < nm; q++) { MP[q][v * 3] = mp[q].getX(k); MP[q][v * 3 + 1] = mp[q].getY(k); MP[q][v * 3 + 2] = mp[q].getZ(k); }
    }
    const idx = m.geometry.index;
    for (let k = 0; k < idx.count; k++) I[io + k] = idx.getX(k) + vo;
    geo.addGroup(io, idx.count, mats.length);
    mats.push(m.material.name.replace(/^CH_/, ''));
    vo += n; io += idx.count;
  }
  const acc = new Map();
  const keyOf = (v) => Math.round(P[v * 3] * 2e4) + '|' + Math.round(P[v * 3 + 1] * 2e4) + '|' + Math.round(P[v * 3 + 2] * 2e4);
  for (let v = 0; v < nv; v++) {
    const k = keyOf(v); let s = acc.get(k);
    if (!s) acc.set(k, (s = [0, 0, 0]));
    s[0] += N[v * 3]; s[1] += N[v * 3 + 1]; s[2] += N[v * 3 + 2];
  }
  for (let v = 0; v < nv; v++) {
    const s = acc.get(keyOf(v)), l = Math.hypot(s[0], s[1], s[2]) || 1;
    ON[v * 3] = s[0] / l; ON[v * 3 + 1] = s[1] / l; ON[v * 3 + 2] = s[2] / l;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('onrm', new THREE.BufferAttribute(ON, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
  geo.setAttribute('olw', new THREE.BufferAttribute(OL, 1));
  geo.setAttribute('surf', new THREE.BufferAttribute(SF, 1));
  geo.setIndex(new THREE.BufferAttribute(I, 1));
  if (nm) { geo.morphAttributes.position = MP.map((x) => new THREE.BufferAttribute(x, 3)); geo.morphTargetsRelative = true; }
  geo.computeBoundingSphere();
  return { geo, mats, tris: ni / 3, stats: {} };
}

// ---------------------------------------------------------------------------
// Humanoid type (geometry + skeleton), cached per config object
const TYPES = new Map();
// dev viewer: parsed glTFs that stand in for the shipped models (charview.html?wip)
export const MODEL_OVERRIDE = {};
// proportions of the modelled (second-generation) characters, laid over their CHAR entry
const V2 = {
  player: { headR: 0.142, irisR: 0.6 },
};
// Hooks for custom types (enemies): c.bones(def, L) -> chain specs added before
// finalize; c.sculpt(S, L, def, chains) adds parts; c.group(key) -> material group
// ('skin' | 'main' | custom); c.face === false skips the painted face.
export function humanType(c) {
  let T = TYPES.get(c);
  if (T) return T;
  // an authored model (public/models/ch_<key>.glb) replaces the code-built body; without one
  // the character is sculpted here
  const key = Object.keys(CHAR).find((k) => CHAR[k] === c);
  const authored = key ? (MODEL_OVERRIDE[key] || model('ch_' + key)) : null;
  const v2 = !!authored && isV2(authored);
  if (v2 && V2[key]) { const cv = { ...c, ...V2[key] }; TYPES.set(cv, null); const Tv = humanType2(cv, key, authored); TYPES.set(c, Tv); return Tv; }
  return humanType2(c, key, authored);
}
function humanType2(c, key, authored) {
  let T;
  const v2 = !!authored && isV2(authored);
  const t0 = performance.now();
  const L = HB.layout(c);
  const def = HB.skeleton(c, L);
  const chains = [];
  const cc = { ...c };
  // garment chains
  let capeCh = null, scarfCh = null, plumeCh = null, hairCh = null;
  if (c.cape && !v2) capeCh = HB.capeBones(def, L, c);
  if (c.scarf && !v2) scarfCh = HB.scarfBones(def, L, c);
  if (c.plume && !v2) plumeCh = HB.plumeBones(def, L);
  if (c.hairStyle === 'long' && !v2) {
    hairCh = [];
    for (const [ci, x] of [[0, 0.05], [1, -0.05]]) {
      const names = []; let parent = 'head';
      const p0 = L.HC.clone().add(new V3(x, -L.hr * 0.3, -L.hr * 0.95));
      const len = (c.hairLen ?? 0.42) + L.hr * 0.3;
      for (let k = 0; k < 3; k++) { const nm = `hair${ci}_${k}`; const p = p0.clone().add(new V3(0, -k * len / 3, -0.01 * k)); def.add(nm, parent, p.x, p.y, p.z); names.push(nm); parent = nm; }
      hairCh.push({ names, tail: p0.clone().add(new V3(0, -len, -0.04)) });
    }
  }
  if (c.hat === 'hood' && !v2) {
    // collapsible bones so the hood can be lowered (outline hull included)
    const hp = def.pos('head'), np = def.pos('neck'), cp = def.pos('chest');
    def.add('hoodUp', 'head', hp.x, hp.y, hp.z, [L.HC.x, L.HC.y + L.hr, L.HC.z]);
    def.add('hoodUpN', 'neck', np.x, np.y, np.z, [hp.x, hp.y, hp.z]);
    def.add('hoodDn', 'chest', cp.x, L.NY - 0.05, cp.z - 0.05, [0, L.NY + 0.05, -0.08]);
    // back and crown locks, drawn in under the raised hood
    def.add('hairB', 'head', L.HC.x, L.HC.y, L.HC.z, [L.HC.x, L.HC.y + L.hr, L.HC.z]);
  }
  let extraCh = null;
  if (c.bones) extraCh = c.bones(def, L);
  if (v2) extraCh = (extraCh || []).concat(modelBones(authored, def, key));
  def.finalize();
  const pal = { ...palette(c), ...(c.colors || {}) };
  const built = authored ? fromModel(authored, def) : sculptType(c, cc, L, def, pal, { capeCh, scarfCh, plumeCh, hairCh, extraCh });
  if (capeCh) chains.push(...capeCh.map((ch) => ({ ...ch, kind: 'cape' })));
  if (scarfCh) chains.push(...scarfCh.map((ch) => ({ ...ch, kind: 'scarf' })));
  if (plumeCh) chains.push(...plumeCh.map((ch) => ({ ...ch, kind: 'plume' })));
  if (hairCh) chains.push(...hairCh.map((ch) => ({ ...ch, kind: 'hair' })));
  if (extraCh) chains.push(...extraCh);
  T = { c, L, def, built, chains, face: c.face === false ? null : HB.faceParams(c, L), pal, ms: 0, v2 };
  // rigid props
  if (c.staff) { T.staff = HB.staffGeo(); T.gem = HB.gemGeo(); }
  if (c.cane) T.cane = HB.rigidGeo((S2) => {
    tube(S2, 'wood', 'r', { pts: [new V3(0, 0, -0.62), new V3(0.005, 0, 0), new V3(0, 0, 0.35), new V3(0, 0.05, 0.42), new V3(0, 0.12, 0.4)], seg: 7, steps: 14, ref: new V3(0, 1, 0), r: (u) => 0.016 + 0.004 * Math.sin(u * 40), cap0: 0.5, cap1: 1 });
    tube(S2, 'band', 'r', { pts: [new V3(0, 0.12, 0.4), new V3(0, 0.1, 0.32)], seg: 6, steps: 3, r: 0.008, ref: new V3(0, 1, 0) });
  }, { wood: 0x6a4a30, band: 0xc8a050 });
  if (c.spear) T.spear = HB.rigidGeo((S2) => {
    tube(S2, 'wood', 'r', { pts: [new V3(0, 0, -0.6), new V3(0, 0, 0.6), new V3(0, 0, 1.55)], seg: 7, steps: 14, ref: new V3(0, 1, 0), r: (u) => 0.02 - u * 0.004, cap0: 0.5 });
    tube(S2, 'band', 'r', { pts: [new V3(0, 0, 1.5), new V3(0, 0, 1.6)], seg: 8, steps: 2, ref: new V3(0, 1, 0), r: 0.026 });
    tube(S2, 'steel', 'r', { pts: [new V3(0, 0, 1.58), new V3(0, 0, 1.72), new V3(0, 0, 1.86)], seg: 4, steps: 6, ref: new V3(0, 1, 0), r: (u) => [0.045 * Math.sin(Math.min(1, u * 1.6 + 0.2) * Math.PI) + 0.004, 0.012], cap1: 1 });
  }, { wood: 0x7a5a3a, band: 0x9a7a48, steel: 0xc0c0c8 });
  if (c.book) T.book = HB.rigidGeo((S2) => {
    tube(S2, 'cover', 'r', { pts: [new V3(0, -0.11, 0), new V3(0, 0.11, 0)], seg: 4, steps: 1, ref: new V3(0, 0, 1), r: [0.12, 0.028], shape: (u, a) => 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))), flat0: true, flat1: true, twist: () => Math.PI / 4 });
    tube(S2, 'pages', 'r', { pts: [new V3(0.004, -0.1, 0), new V3(0.004, 0.1, 0)], seg: 4, steps: 1, ref: new V3(0, 0, 1), r: [0.11, 0.022], shape: (u, a) => 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))), flat0: true, flat1: true, twist: () => Math.PI / 4 });
  }, { cover: 0x8a3a3a, pages: 0xf0e6cc });
  T.ms = performance.now() - t0;
  TYPES.set(c, T);
  return T;
}

// ---------------------------------------------------------------------------
// Expressions (face shader targets)
const EXPR = {
  neutral: { open: 1, tilt: 0, lower: 0, happy: 0, raise: 0, btilt: 0, furrow: 0, mOpen: 0, smile: 0.12, mW: 1, round: 0 },
  smile: { open: 0.92, tilt: 0, lower: 0.4, happy: 0, raise: 0.25, btilt: 0.1, furrow: 0, mOpen: 0.12, smile: 0.9, mW: 1.1, round: 0 },
  sad: { open: 0.72, tilt: -0.45, lower: 0.05, happy: 0, raise: 0.15, btilt: 0.9, furrow: 0.2, mOpen: 0, smile: -0.65, mW: 0.9, round: 0 },
  surprised: { open: 1.28, tilt: 0, lower: 0, happy: 0, raise: 1, btilt: 0.15, furrow: 0, mOpen: 0.55, smile: 0, mW: 0.62, round: 0.8 },
  angry: { open: 0.82, tilt: 0.65, lower: 0.15, happy: 0, raise: -0.3, btilt: -1, furrow: 1, mOpen: 0.06, smile: -0.55, mW: 0.95, round: 0 },
  worried: { open: 0.98, tilt: -0.3, lower: 0, happy: 0, raise: 0.45, btilt: 0.8, furrow: 0.45, mOpen: 0.04, smile: -0.3, mW: 0.8, round: 0.1 },
  tender: { open: 0.72, tilt: -0.1, lower: 0.3, happy: 0, raise: 0.12, btilt: 0.35, furrow: 0, mOpen: 0, smile: 0.5, mW: 0.95, round: 0 },
  laugh: { open: 0, tilt: 0, lower: 0.6, happy: 1, raise: 0.4, btilt: 0.2, furrow: 0, mOpen: 0.6, smile: 1, mW: 1.15, round: 0 },
  hurt: { open: 0.1, tilt: 0.4, lower: 0.5, happy: 0, raise: -0.2, btilt: 0.6, furrow: 1, mOpen: 0.3, smile: -0.8, mW: 1.05, round: 0 },
  sleepy: { open: 0.35, tilt: -0.1, lower: 0.1, happy: 0, raise: -0.1, btilt: 0.1, furrow: 0, mOpen: 0, smile: 0.05, mW: 0.9, round: 0 },
  determined: { open: 0.9, tilt: 0.3, lower: 0.2, happy: 0, raise: -0.1, btilt: -0.45, furrow: 0.5, mOpen: 0, smile: -0.1, mW: 0.95, round: 0 },
};
const EXPR_KEYS = Object.keys(EXPR.neutral);
// The modelled people (second-generation heads) have more to move: cheeks that rise and carry
// the lower lids, a pout, the wings of the nose, each mouth corner and each brow on its own.
// asym / basym: the left corner / brow does more (+) or less (-) than the right.
const X0 = { open: 1, tilt: 0, lower: 0, happy: 0, raise: 0, btilt: 0, furrow: 0, mOpen: 0, smile: 0.1, mW: 1, round: 0, cheek: 0, pout: 0, sneer: 0, asym: 0, basym: 0, blush: 0 };
const EXPR2 = {
  neutral: {},
  // a warm smile: brows relaxed and a touch raised, eyes open with a squint from below only,
  // cheeks up, the mouth a soft open curve
  smile: { open: 1.04, cheek: 0.42, raise: 0.22, btilt: 0.22, smile: 0.85, mOpen: 0.13, blush: 0.35 },
  grin: { cheek: 0.75, raise: 0.3, btilt: 0.2, smile: 1, mOpen: 0.3, mW: 1.05, blush: 0.4 },
  sad: { open: 0.8, tilt: -0.35, raise: 0.1, btilt: 0.9, furrow: 0.25, smile: -0.5, pout: 0.6, mW: 0.92 },
  surprised: { open: 1.2, raise: 0.9, btilt: 0.12, mOpen: 0.42, smile: 0, mW: 0.72, round: 0.7 },
  angry: { open: 0.92, tilt: 0.6, lower: 0.25, raise: -0.35, btilt: -1, furrow: 1, mOpen: 0.05, smile: -0.45, sneer: 0.6 },
  worried: { tilt: -0.25, raise: 0.35, btilt: 0.85, furrow: 0.4, smile: -0.25, pout: 0.3, mW: 0.88, basym: 0.15 },
  tender: { open: 0.97, lower: 0.1, cheek: 0.4, raise: 0.12, btilt: 0.4, smile: 0.5, blush: 0.4 },
  laugh: { open: 0, happy: 1, cheek: 1, raise: 0.5, btilt: 0.3, mOpen: 0.5, smile: 1, mW: 1, blush: 0.5 },
  hurt: { open: 0.05, tilt: 0.35, lower: 0.45, cheek: 0.6, raise: -0.6, btilt: 0.4, furrow: 1, mOpen: 0.2, smile: -0.5, sneer: 0.9, mW: 1.05, asym: 0.25 },
  sleepy: { open: 0.42, tilt: -0.1, raise: -0.12, btilt: 0.15, smile: 0, mW: 0.94 },
  determined: { open: 0.93, tilt: 0.28, lower: 0.2, raise: -0.12, btilt: -0.45, furrow: 0.5, smile: -0.04, pout: 0.15, mW: 0.92 },
  smirk: { lower: 0.12, cheek: 0.25, raise: 0.12, smile: 0.62, asym: 0.85, basym: 0.6 },
  pout: { open: 0.92, cheek: 0.15, raise: -0.05, btilt: 0.45, furrow: 0.35, smile: -0.2, pout: 1, mW: 0.9 },
  excited: { open: 1.1, cheek: 0.5, raise: 0.6, btilt: 0.15, smile: 0.95, mOpen: 0.4, mW: 1.05, blush: 0.4 },
  scared: { open: 1.22, raise: 0.65, btilt: 0.9, furrow: 0.5, mOpen: 0.28, smile: -0.3, mW: 0.84, round: 0.2 },
  thinking: { open: 0.92, raise: 0.18, basym: 0.8, furrow: 0.2, smile: 0, pout: 0.3, mW: 0.9, asym: -0.3 },
  shy: { open: 0.82, lower: 0.12, cheek: 0.45, raise: 0.08, btilt: 0.4, smile: 0.45, mW: 0.92, blush: 0.9 },
  disgust: { open: 0.82, lower: 0.35, raise: -0.2, btilt: -0.2, furrow: 0.7, mOpen: 0.06, smile: -0.4, sneer: 1 },
};
for (const k in EXPR2) EXPR2[k] = { ...X0, ...EXPR2[k] };
const EXPR2_KEYS = Object.keys(X0);
// what stays of the last expression for a couple of seconds: the mouth and cheeks, a little of the brows; never the lids
const LINGER = { smile: 0.28, cheek: 0.3, pout: 0.25, btilt: 0.2, furrow: 0.2, raise: 0.12, blush: 0.6 };
// how fast each part of the face answers (rad/s of its spring): lids first, then brows, the mouth, the cheeks
const FACE_W = { open: 21, tilt: 19, lower: 19, happy: 19, raise: 15, btilt: 15, furrow: 15, basym: 12, mOpen: 13, smile: 11, mW: 11, round: 13, cheek: 10, pout: 11, sneer: 13, asym: 9, blush: 5 };
// Mouth shapes of speech: [jaw, round, wide] for the vowel of a Hangul syllable (jungseong index)
const VOWEL = [[0.8, 0, 0.1], [0.45, 0, 0.55], [0.8, 0, 0.1], [0.45, 0, 0.55], [0.6, 0.2, 0], [0.42, 0, 0.5], [0.6, 0.2, 0], [0.42, 0, 0.5], [0.4, 0.85, 0], [0.55, 0.5, 0], [0.45, 0.4, 0.2],
  [0.4, 0.5, 0.2], [0.4, 0.85, 0], [0.2, 1, 0], [0.45, 0.6, 0], [0.4, 0.5, 0.2], [0.2, 0.7, 0.3], [0.2, 1, 0], [0.16, 0, 0.4], [0.16, 0, 0.6], [0.16, 0, 0.8]];
function viseme(ch, out) {
  const code = ch.charCodeAt(0) - 0xac00;
  if (code >= 0 && code < 11172) {
    const v = VOWEL[Math.floor((code % 588) / 28)], cho = Math.floor(code / 588), jong = code % 28;
    out.o = v[0]; out.r = v[1]; out.w = v[2];
    out.shut = cho === 6 || cho === 7 || cho === 8 || cho === 17 ? 1 : jong === 16 || jong === 17 || jong === 26 ? 0.6 : 0;      // lips meet on m, b, p
  } else if (/[A-Za-z0-9]/.test(ch)) { const h = ch.charCodeAt(0) % 5; out.o = 0.3 + 0.1 * h; out.r = h === 1 ? 0.7 : 0; out.w = h === 3 ? 0.6 : 0; out.shut = 0; }
  else { out.o = 0; out.r = 0; out.w = 0; out.shut = 0; }
  return out;
}

// ---------------------------------------------------------------------------
// Gestures: fn(q, t, w, rig) adds to the pose; dur in seconds
const GEST = {
  nod: { dur: 0.9, fn: (q, t, w) => { q.headx += Math.sin(t * TAU * 2.2) * 0.22 * w * (t < 0.8 ? 1 : 0) + 0.08 * w; q.neckx += 0.06 * w; } },
  shake: { dur: 1.0, fn: (q, t, w) => { q.heady += Math.sin(t * TAU * 2.6) * 0.38 * w; q.headx += 0.08 * w; } },
  bow: { dur: 1.6, fn: (q, t, w) => { const k = Math.sin(Math.min(1, t / 1.4) * Math.PI) * w; q.spinex += 0.35 * k; q.chestx += 0.35 * k; q.headx += 0.25 * k; q.armLx -= 0.25 * k; q.armRx -= 0.25 * k; q.foreLx -= 0.4 * k; q.foreRx -= 0.4 * k; q.armLz -= 0.2 * k; q.armRz += 0.2 * k; q.hipsPY -= 0.02 * k; } },
  point: { dur: 1.8, hand: 'R', fn: (q, t, w) => { q.armRx = lerp(q.armRx, -1.45, w); q.armRz = lerp(q.armRz, 0.1, w); q.foreRx = lerp(q.foreRx, -0.1, w); q.handRx = lerp(q.handRx, 0.1, w); q.fingR = lerp(q.fingR, 0.05, w); q.chesty -= 0.2 * w; q.heady -= 0.15 * w; } },
  laugh: { dur: 1.6, expr: 'laugh', fn: (q, t, w) => { const b = Math.abs(Math.sin(t * TAU * 3.2)) * w; q.chestx -= 0.12 * w - 0.08 * b; q.headx -= 0.25 * w + 0.06 * b; q.clavLz += 0.08 * b; q.clavRz -= 0.08 * b; q.armLx -= 0.3 * w; q.armRx -= 0.3 * w; q.foreLx -= 0.9 * w; q.foreRx -= 0.9 * w; q.armLz -= 0.15 * w; q.armRz += 0.15 * w; } },
  sigh: { dur: 1.8, fn: (q, t, w) => { const inh = Math.sin(Math.min(1, t / 0.7) * Math.PI * 0.5), exh = sstep(0.7, 1.5, t); const k = (inh * (1 - exh) * 0.6 - exh * 0.8) * w; q.chestx -= k * 0.12; q.clavLz += k * 0.14; q.clavRz -= k * 0.14; q.headx -= k * 0.2; q.hipsPY += k * 0.008; } },
  shrug: { dur: 1.3, fn: (q, t, w) => { const k = Math.sin(Math.min(1, t / 1.2) * Math.PI) * w; q.clavLz += 0.22 * k; q.clavRz -= 0.22 * k; q.armLz += 0.3 * k; q.armRz -= 0.3 * k; q.foreLx -= 1.2 * k; q.foreRx -= 1.2 * k; q.foreLy -= 1.0 * k; q.foreRy += 1.0 * k; q.headz += 0.15 * k; q.fingL -= 0.3 * k; q.fingR -= 0.3 * k; } },
  handToChest: { dur: 2.2, hand: 'R', fn: (q, t, w) => { q.armRx = lerp(q.armRx, -0.55, w); q.armRz = lerp(q.armRz, 0.42, w); q.armRy = lerp(q.armRy, 0.3, w); q.foreRx = lerp(q.foreRx, -1.95, w); q.foreRy = lerp(q.foreRy, 0.5, w); q.handRz = lerp(q.handRz, 0.3, w); q.fingR = lerp(q.fingR, 0.1, w); q.headx += 0.12 * w; q.chestx += 0.05 * w; } },
  wave: { dur: 2.0, hand: 'L', fn: (q, t, w) => { q.armLx = lerp(q.armLx, -0.4, w); q.armLz = lerp(q.armLz, 2.5 + Math.sin(t * 10) * 0.05, w); q.foreLx = lerp(q.foreLx, -0.2, w); q.foreLz = lerp(q.foreLz, Math.sin(t * 9) * 0.45, w); q.handLx = lerp(q.handLx, -0.3, w); q.fingL = lerp(q.fingL, 0, w); q.headz -= 0.08 * w; } },
  think: { dur: 2.6, hand: 'R', fn: (q, t, w) => { q.armRx = lerp(q.armRx, -0.9, w); q.armRz = lerp(q.armRz, 0.3, w); q.foreRx = lerp(q.foreRx, -2.2, w); q.foreRy = lerp(q.foreRy, 0.4, w); q.handRx = lerp(q.handRx, 0.4, w); q.fingR = lerp(q.fingR, 0.9, w); q.armLx = lerp(q.armLx, -0.4, w); q.armLz = lerp(q.armLz, -0.35, w); q.foreLx = lerp(q.foreLx, -1.5, w); q.headx -= 0.08 * w; q.headz += 0.1 * w; q.heady += 0.15 * w; } },
  beckon: { dur: 1.6, hand: 'R', fn: (q, t, w) => { q.armRx = lerp(q.armRx, -1.0, w); q.foreRx = lerp(q.foreRx, -1.2 - Math.max(0, Math.sin(t * 12)) * 0.6, w); q.handRx = lerp(q.handRx, -0.5, w); q.fingR = lerp(q.fingR, 0.6 + Math.sin(t * 12) * 0.5, w); q.heady -= 0.1 * w; } },
  lookAround: { dur: 2.6, fn: (q, t, w) => { q.heady += Math.sin(t * 2.4) * 0.6 * w; q.chesty += Math.sin(t * 2.4) * 0.15 * w; q.headx -= 0.05 * w; } },
  crossArms: { dur: Infinity, fn: (q, t, w) => { q.armLx = lerp(q.armLx, -0.55, w); q.armLz = lerp(q.armLz, -0.28, w); q.foreLx = lerp(q.foreLx, -1.65, w); q.foreLy = lerp(q.foreLy, -0.9, w); q.armRx = lerp(q.armRx, -0.6, w); q.armRz = lerp(q.armRz, 0.28, w); q.foreRx = lerp(q.foreRx, -1.6, w); q.foreRy = lerp(q.foreRy, 0.9, w); q.fingL = lerp(q.fingL, 0.6, w); q.fingR = lerp(q.fingR, 0.6, w); q.chestx -= 0.04 * w; } },
  // small talk beats (used automatically while speaking)
  beatR: { dur: 1.1, hand: 'R', fn: (q, t, w) => { const k = Math.sin(Math.min(1, t / 1.0) * Math.PI) * w; q.armRx -= 0.35 * k; q.foreRx -= 0.8 * k; q.foreRy += 0.6 * k; q.fingR -= 0.25 * k; q.heady -= 0.06 * k; } },
  beatL: { dur: 1.1, hand: 'L', fn: (q, t, w) => { const k = Math.sin(Math.min(1, t / 1.0) * Math.PI) * w; q.armLx -= 0.35 * k; q.foreLx -= 0.8 * k; q.foreLy -= 0.6 * k; q.fingL -= 0.25 * k; q.heady += 0.06 * k; } },
  beatBoth: { dur: 1.2, fn: (q, t, w) => { const k = Math.sin(Math.min(1, t / 1.1) * Math.PI) * w; q.armRx -= 0.3 * k; q.armLx -= 0.3 * k; q.foreRx -= 0.9 * k; q.foreLx -= 0.9 * k; q.foreRy += 0.7 * k; q.foreLy -= 0.7 * k; q.headx += 0.05 * k; } },
  // idle fidgets of the people (left arm and head only: the right hand may hold a staff or cane)
  fidHip: { dur: 7, fid: 1, hand: 'L', fn: (q, t, w, rig) => { rig.lik.wt = w; q.armLz = lerp(q.armLz, 0.5, w); q.handLx = lerp(q.handLx, 0.9, w); q.handLz = lerp(q.handLz, -0.5, w); q.fingL = lerp(q.fingL, 0.5, w); q.clavLz += 0.08 * w; q.chesty -= 0.06 * w; } },
  fidNeck: { dur: 2.8, fid: 1, fn: (q, t, w) => { const k = Math.sin(Math.min(1, t / 2.6) * Math.PI) * w, s = Math.sin(t * 2.3); q.headz += 0.3 * s * k; q.neckz += 0.1 * s * k; q.headx -= 0.08 * k; q.clavLz += 0.14 * k; q.clavRz -= 0.14 * k; q.chestx -= 0.07 * k; } },
  fidScratch: { dur: 2.4, fid: 1, hand: 'L', fn: (q, t, w) => { q.armLx = lerp(q.armLx, -1.15, w); q.armLz = lerp(q.armLz, 1.5, w); q.armLy = lerp(q.armLy, -0.6, w); q.foreLx = lerp(q.foreLx, -2.35, w); q.handLx = lerp(q.handLx, 0.3, w); q.fingL = lerp(q.fingL, 0.7 + Math.sin(t * 16) * 0.35, w); q.headx += 0.14 * w; q.headz -= 0.12 * w; q.heady += 0.1 * w; } },
  fidBounce: { dur: 2.6, fid: 1, fn: (q, t, w) => { const k = Math.sin(Math.min(1, t / 2.4) * Math.PI) * w, b = Math.sin(t * 7); q.hipsPY += Math.max(0, b) * 0.02 * k; q.armLx += b * 0.4 * k; q.armRx -= b * 0.25 * k; q.headz += Math.sin(t * 3.5) * 0.12 * k; q.chesty += Math.sin(t * 3.5) * 0.12 * k; } },
  fidLook: { dur: 3.2, fid: 1, fn: (q, t, w) => { const k = Math.sin(Math.min(1, t / 3) * Math.PI) * w, s = Math.sin(t * 1.9); q.heady += s * 0.75 * k; q.chesty += s * 0.2 * k; q.hipsy += s * 0.06 * k; q.headx -= 0.06 * k; } },
};

// Gait of the people (HumanRig `person`) for a normalised speed (m/s of a scale-1 body): cycles
// per second (one cycle = two steps) and the share of it a foot stays on the ground. The ground
// covered in one stance (speed x duty / freq) stays near 0.8 m, the reach of these legs; the
// faster gaits buy the rest of the stride as flight.
const GAIT = [[0, 1.0, 0.64], [1.4, 1.2, 0.6], [2.2, 1.55, 0.54], [3.0, 1.6, 0.42], [3.6, 1.62, 0.34], [5.6, 1.75, 0.25], [9.2, 2.2, 0.2], [12, 2.45, 0.19]];
function gaitOf(v, out) {
  let k = 1;
  while (k < GAIT.length - 1 && GAIT[k][0] < v) k++;
  const a = GAIT[k - 1], b = GAIT[k], u = clamp((v - a[0]) / (b[0] - a[0]), 0, 1);
  out.freq = mix(a[1], b[1], u); out.duty = mix(a[2], b[2], u);
  return out;
}
// How a build moves (people only): read from the CHAR entry, overridden by o.style
function personStyle(c) {
  const age = c.age ?? 0, kid = c.kid ?? 0, heavy = clamp(((c.bodyW ?? 1) - 1) * 2.5 + (c.belly ? 0.3 : 0), 0, 1), fem = c.fem ?? 0;
  return {
    cadence: 1 + 0.08 * kid - 0.08 * age,                 // children patter, the old take their time
    arm: 1 + 0.25 * kid - 0.35 * age - 0.15 * heavy,      // arm swing
    bounce: 1 + 0.5 * kid - 0.4 * age + 0.15 * heavy,     // vertical travel
    sway: 1 + 0.9 * heavy + 0.25 * fem + 0.3 * age,       // side to side over the supporting foot
    twist: 1 + 0.2 * fem + 0.2 * kid - 0.3 * age,         // hips against shoulders
    lift: 1 + 0.25 * kid - 0.3 * age,                     // how high the feet come
    base: 1 + 0.5 * heavy - 0.15 * fem,                   // stance width
    armHang: 0.08 + 0.1 * heavy,
    head: 1 + 0.8 * kid,                                  // head bob
  };
}

// Casting with a staff (people). A pose is given in the body's frame, metres at scale 1 (x to the
// character's left, y up, z ahead): h right hand, d the staff's direction (butt to head), l left
// hand, cy / cx the chest's turn (right shoulder ahead) and bow, hy hips up or down, open: the left hand.
// A clip is anticipation A -> contact C (reached at the end of the wind-up: the release frame, where the
// effect leaves the head of the staff, so C has it in front of the body) -> follow-through F -> back to the stance.
const CP = (o) => ({ h: [-0.25, 1.2, 0.3], d: [0.08, 0.3, 0.95], l: [0.24, 1.1, 0.2], cy: 0.3, cx: 0.07, hy: -0.035, open: 1, ...o });
const CAST = {
  stance: CP({}),
  // charged shot: A is the fully drawn hold (blended in by the `charge` state), C the thrust
  charged: { rec: 0.4, tf: 0.07,
    A: CP({ h: [-0.32, 1.25, -0.08], d: [0.14, 0.32, 0.94], l: [0.02, 1.3, 0.5], cy: -0.5, cx: -0.12, hy: -0.07, open: 0.6 }),
    C: CP({ h: [-0.2, 1.3, 0.47], d: [0.05, 0.24, 0.97], l: [0.28, 1.02, -0.04], cy: 0.6, cx: 0.18, hy: -0.06, open: 0 }),
    F: CP({ h: [-0.16, 1.26, 0.5], d: [0.04, 0.14, 0.99], l: [0.32, 0.98, -0.12], cy: 0.75, cx: 0.26, hy: -0.09, open: 0 }) },
  // arcane: the butt of the staff is slammed on the ground
  heavy_arcane: { rec: 0.5, tf: 0.06,
    A: CP({ h: [-0.22, 1.52, 0.2], d: [0, 1, 0.06], l: [0.26, 1.22, 0.14], cy: 0.1, cx: -0.06, hy: 0.03 }),
    C: CP({ h: [-0.2, 0.9, 0.3], d: [0, 1, 0.04], l: [0.32, 0.98, 0.2], cy: 0.12, cx: 0.2, hy: -0.13 }),
    F: CP({ h: [-0.2, 0.86, 0.3], d: [0.02, 1, 0.1], l: [0.36, 0.9, 0.16], cy: 0.12, cx: 0.26, hy: -0.17 }) },
  // fire: an overhand throw
  heavy_fire: { rec: 0.5, tf: 0.1,
    A: CP({ h: [-0.34, 1.6, -0.14], d: [-0.15, 0.6, -0.78], l: [0.14, 1.32, 0.42], cy: -0.5, cx: -0.12, hy: 0.0, open: 0.8 }),
    C: CP({ h: [-0.2, 1.5, 0.4], d: [0.05, 0.36, 0.93], l: [0.26, 1.06, 0.0], cy: 0.45, cx: 0.14, hy: -0.03, open: 0 }),
    F: CP({ h: [-0.04, 1.06, 0.42], d: [0.2, -0.28, 0.94], l: [0.3, 1.0, -0.12], cy: 0.72, cx: 0.3, hy: -0.07, open: 0 }) },
  // wind: a wide level sweep from right to left
  heavy_wind: { rec: 0.5, tf: 0.1,
    A: CP({ h: [-0.46, 1.25, 0.04], d: [-0.86, 0.14, 0.5], l: [0.3, 1.16, 0.12], cy: -0.45, cx: 0.02, hy: -0.03 }),
    C: CP({ h: [-0.2, 1.25, 0.42], d: [-0.08, 0.12, 0.99], l: [0.33, 1.1, -0.04], cy: 0.25, cx: 0.08, hy: -0.04 }),
    F: CP({ h: [0.12, 1.22, 0.36], d: [0.82, 0.1, 0.56], l: [0.36, 1.02, -0.16], cy: 0.78, cx: 0.1, hy: -0.05 }) },
  // frost: swung low and raked up along the ground
  heavy_frost: { rec: 0.5, tf: 0.12,
    A: CP({ h: [-0.33, 0.96, -0.08], d: [-0.2, -0.55, -0.8], l: [0.22, 1.1, 0.3], cy: -0.4, cx: 0.2, hy: -0.12 }),
    C: CP({ h: [-0.22, 0.98, 0.38], d: [0, -0.34, 0.94], l: [0.3, 1.02, 0.02], cy: 0.3, cx: 0.25, hy: -0.1 }),
    F: CP({ h: [-0.2, 1.46, 0.4], d: [0.05, 0.76, 0.64], l: [0.32, 1.0, -0.1], cy: 0.46, cx: -0.05, hy: 0.02 }) },
  // storm: thrust up at the sky, chopped down when the bolt lands (C2 at `beat` seconds after the release)
  heavy_storm: { rec: 0.5, tf: 0.05, beat: 0.35,
    A: CP({ h: [-0.25, 1.02, 0.2], d: [0, 0.92, 0.38], l: [0.26, 1.08, 0.16], cy: 0.1, cx: 0.1, hy: -0.08 }),
    C: CP({ h: [-0.2, 1.4, 0.42], d: [0, 0.2, 1], l: [0.32, 1.0, 0.08], cy: 0.15, cx: -0.1, hy: 0.035 }),
    F: CP({ h: [-0.2, 1.78, 0.1], d: [0, 0.99, 0.1], l: [0.34, 0.98, 0.06], cy: 0.15, cx: -0.12, hy: 0.045 }),
    C2: CP({ h: [-0.15, 1.1, 0.48], d: [0.05, -0.06, 1], l: [0.3, 1.0, -0.08], cy: 0.34, cx: 0.28, hy: -0.1, open: 0 }) },
  // water: both hands on the staff, pushed out from the chest
  heavy_water: { rec: 0.5, tf: 0.1, two: 0.4,
    A: CP({ h: [-0.16, 1.24, 0.14], d: [0.96, 0.24, 0.08], cy: 0, cx: -0.1, hy: 0.0, open: 0 }),
    C: CP({ h: [-0.15, 1.3, 0.48], d: [0.97, 0.2, 0.1], cy: 0.04, cx: 0.18, hy: -0.05, open: 0 }),
    F: CP({ h: [-0.15, 1.3, 0.52], d: [0.97, 0.2, 0.12], cy: 0.04, cx: 0.24, hy: -0.07, open: 0 }) },
  // weave: staff and off hand cross before the chest, then both arms are flung open
  weave: { rec: 0.6, tf: 0.1,
    A: CP({ h: [0.05, 1.3, 0.3], d: [0.6, 0.76, 0.2], l: [-0.13, 1.25, 0.32], cy: 0.02, cx: 0.12, hy: -0.04, open: 0 }),
    C: CP({ h: [-0.3, 1.3, 0.4], d: [-0.18, 0.5, 0.85], l: [0.3, 1.3, 0.36], cy: 0.1, cx: -0.02, hy: -0.01 }),
    F: CP({ h: [-0.5, 1.32, 0.04], d: [-0.55, 0.62, 0.55], l: [0.5, 1.34, 0.04], cy: 0.0, cx: -0.16, hy: 0.02 }) },
  // ultimate: raised overhead on the toes, brought down at the aim
  ult: { rec: 0.7, tf: 0.1,
    A: CP({ h: [-0.2, 1.82, -0.02], d: [0.05, 0.97, -0.2], l: [0.48, 1.06, 0.0], cy: 0.05, cx: -0.14, hy: 0.05 }),
    C: CP({ h: [-0.2, 1.4, 0.44], d: [0.03, 0.3, 0.95], l: [0.4, 1.0, -0.06], cy: 0.4, cx: 0.15, hy: -0.04 }),
    F: CP({ h: [-0.18, 1.14, 0.5], d: [0.05, -0.02, 1], l: [0.36, 0.96, -0.12], cy: 0.5, cx: 0.3, hy: -0.1, open: 0.3 }) },
};
// gliding hangs from the staff: level overhead, a hand on either side of the grip
// (elbows stay bent and below the hands: the mantle cannot follow arms raised straight up)
const GLIDE = CP({ h: [-0.3, 1.68, 0.24], d: [1, 0.02, 0], l: [0.3, 1.69, 0.24], cy: 0, cx: 0, hy: 0, open: 0 });
function cpMix(out, a, b, w) {
  for (let i = 0; i < 3; i++) { out.h[i] = a.h[i] + (b.h[i] - a.h[i]) * w; out.d[i] = a.d[i] + (b.d[i] - a.d[i]) * w; out.l[i] = a.l[i] + (b.l[i] - a.l[i]) * w; }
  out.cy = a.cy + (b.cy - a.cy) * w; out.cx = a.cx + (b.cx - a.cx) * w; out.hy = a.hy + (b.hy - a.hy) * w; out.open = a.open + (b.open - a.open) * w;
  return out;
}

// A gesture made with the other hand (the one it wants is holding something): the pose is
// mirrored, the gesture applied, and the pose mirrored back.
const FLIP_SWAP = [['armLx', 'armRx', 1], ['armLy', 'armRy', -1], ['armLz', 'armRz', -1], ['foreLx', 'foreRx', 1], ['foreLy', 'foreRy', -1], ['foreLz', 'foreRz', -1], ['handLx', 'handRx', 1], ['handLy', 'handRy', -1], ['handLz', 'handRz', -1],
  ['fingL', 'fingR', 1], ['thumbL', 'thumbR', 1], ['clavLy', 'clavRy', -1], ['clavLz', 'clavRz', -1]];
const FLIP_NEG = ['hipsy', 'hipsz', 'spiney', 'spinez', 'chesty', 'chestz', 'necky', 'neckz', 'heady', 'headz'];
function flipPose(q) {
  for (const [a, b, s] of FLIP_SWAP) { const t = q[a]; q[a] = q[b] * s; q[b] = t * s; }
  for (const k of FLIP_NEG) q[k] = -q[k];
}

// pose channels
const POSE_KEYS = ['hipsx', 'hipsy', 'hipsz', 'hipsPX', 'hipsPY', 'hipsPZ', 'spinex', 'spiney', 'spinez', 'chestx', 'chesty', 'chestz', 'neckx', 'necky', 'neckz', 'headx', 'heady', 'headz', 'jawx',
  'clavLy', 'clavLz', 'clavRy', 'clavRz', 'armLx', 'armLy', 'armLz', 'armRx', 'armRy', 'armRz', 'foreLx', 'foreLy', 'foreLz', 'foreRx', 'foreRy', 'foreRz', 'handLx', 'handLy', 'handLz', 'handRx', 'handRy', 'handRz',
  'fingL', 'fingR', 'thumbL', 'thumbR', 'thighLx', 'thighLy', 'thighLz', 'thighRx', 'thighRy', 'thighRz', 'shinLx', 'shinRx', 'footLx', 'footRx', 'toeLx', 'toeRx'];
function newPose() { const q = {}; for (const k of POSE_KEYS) q[k] = 0; return q; }

// ---------------------------------------------------------------------------
// Base rig (shared API for every character)
export class Rig {
  constructor() {
    this.root = new THREE.Group();
    this.t = rand() * 10;
    this.lookYaw = 0; this.lookPitch = 0;
    this.mats = []; this.glowMats = [];
    this.expression = 'neutral'; this.gestureName = null;
  }
  update() {}
  hurt() {}
  flick() {}
  windup() {}
  gust() {}
  setExpression() {}
  gesture() { return 0; }
  lookAt() {}
}
// camera distance for LOD
function camDist(root) {
  const c = G.camera;
  if (!c) return 0;
  const e = root.matrixWorld.elements;
  return Math.hypot(c.position.x - e[12], c.position.y - e[13], c.position.z - e[14]);
}
function groundAt(x, z, y) {
  const W = G.world;
  if (W && W.ground) return W.ground(x, z, y + 0.6);
  return y;
}

// ---------------------------------------------------------------------------
// Humanoid rig
export class HumanRig extends Rig {
  constructor(T, o = {}) {
    super();
    const c = T.c;
    this.T = T; this.c = c;
    // people (makeHumanoid) move with the gaits, idle life and action poses below; rigs built
    // directly (enemies) keep the first-generation motion their own pose hooks were written against
    this.person = !!o.person;
    this.s = c.scale ?? 1;
    this.L = T.L;
    const body = (this.body = new THREE.Group()); body.scale.setScalar(this.s); this.root.add(body);
    // materials (per instance): 'skin' carries the painted face, 'main' is vertex colored.
    // Types may add groups (e.g. enemies: 'skin' = ash-crack body, 'glow' = tier glow).
    const pal = T.pal;
    const M = (this.M = {});
    const F2 = T.built.face;      // authored, sculpted head
    if (T.v2) {
      M.skin = skinMat({ tex: T.built.tex.skin }); M.eye = eyeMat(c.eyeColor ?? 0x3a5a7a, { iris: c.irisR, pupil: c.pupilR, soft: c.eyeSoft });
      this.faceU = { v2: true };
    } else if (F2) {
      const sp = F2.spec, F = T.face || HB.faceParams(c, T.L);
      M.skin = faceMat2(pal.skin);
      const u = M.skin.userData.face;
      u.uFaceC.value.set(T.L.HC.x, T.L.HC.y, T.L.HC.z, T.L.hr);
      u.uEyeA.value.set(sp.ex, sp.ey, sp.a, sp.tilt); u.uEyeB.value.set(sp.bU, sp.bL, sp.re, sp.zc);
      u.uIris.value.set(F.iris); u.uLash.value.set(F.lash);
      u.uMouthP.value.set(sp.my, sp.mw, sp.lipU, sp.lipL);
      u.uCheek.value.set(F.blush, F.wrinkles, F.freckles, 0.2 + 0.1 * (c.fem ?? 0));
      u.uLook.value.z = 0.52 + 0.04 * (c.kid ?? 0); u.uLook.value.w = 0.42;
      u.uFaceX.value.set(F.fringeY, sp.noseY, F.lip, F.lowLash);
      this.faceU = u;
    } else if (T.face) {
      M.skin = faceMat(pal.skin);
      const F = T.face, u = M.skin.userData.face;
      u.uFaceC.value.set(F.center.x, F.center.y, F.center.z, F.R);
      u.uEyeP.value.set(...F.eye);
      u.uIris.value.set(F.iris); u.uLash.value.set(F.lash);
      u.uBrowP.value.set(...F.browP); u.uBrow.value.w = F.browT; u.uBrowC.value.set(F.browC);
      u.uMouthP.value.set(F.mouthY, F.lipDark, 1, 1); u.uMouth.value.z = F.mouthW;
      u.uCheek.value.set(F.blush, F.wrinkles, F.freckles, F.lashT);
      u.uLook.value.z = F.irisR; u.uLook.value.w = F.pupil;
      u.uFaceX.value.set(F.fringeY, F.noseY, F.lip, F.lowLash);
      this.faceU = u;
    } else this.faceU = null;
    M.main = clothMat({ rim: o.rim ?? 0.34, tex: T.v2 ? T.built.tex.main : null });
    M.main.userData.cloth.uHairC.value.set(T.L.HC.x, T.L.HC.y, T.L.HC.z, T.L.hr);
    if (o.mats) Object.assign(M, o.mats);
    this.mats = Object.values(M).filter((m) => m.isMeshToonMaterial);
    this.glowMats = Object.values(M).filter((m) => !m.isMeshToonMaterial);
    const I = instance(body, T.def, T.built, M, { outline: o.outline ?? (c.outline ? (T.v2 ? 0.0024 : 0.0048) : 0), outlineTint: !o.mats, main: 'main' });
    this.B = I.by; this.mesh = I.mesh; this.skeleton = I.skeleton; this.outline = I.outline;
    this.meshes = I.meshes;
    if (F2) {
      // the head: its own skinned mesh (and outline hull) on the same skeleton, driven by shape keys
      const fm = new THREE.SkinnedMesh(F2.geo, M.skin);
      fm.name = 'face'; body.add(fm); fm.bind(I.skeleton, I.mesh.bindMatrix); fm.castShadow = true; fm.boundingSphere = I.mesh.boundingSphere;
      this.meshes.push(fm);
      this.morph = fm.morphTargetInfluences; this.morphIdx = Object.fromEntries(F2.morphs.map((n, i) => [n, i]));
      if (I.outline) {
        const ol = new THREE.SkinnedMesh(F2.geo, I.outline.material);
        ol.bind(I.skeleton, I.mesh.bindMatrix); ol.castShadow = false; ol.userData.isOutline = true; ol.boundingSphere = I.mesh.boundingSphere; ol.morphTargetInfluences = this.morph;
        body.add(ol);
      }
    }
    // rest data
    this.rest = {};
    for (const b of I.bones) this.rest[b.name] = b.position.clone();
    const B = this.B;
    // modelled hands: every finger joint flexes about the knuckle line, towards the palm
    if (B.f1aL) this.hands = ['L', 'R'].map((n, k) => {
      const sd = k ? -1 : 1, P = (b) => T.def.pos(b + n);
      const d = P('f2b').clone().sub(P('f2a')).normalize();
      const ax = P('f4a').clone().sub(P('f1a')).normalize();
      if (_v1.crossVectors(ax, d).x * -sd < 0) ax.negate();
      const tdir = P('thb').clone().sub(P('tha')).normalize();
      const tax = _v2.crossVectors(tdir, _v3.set(-sd, 0, 0)).normalize().clone();
      if (_v1.crossVectors(tax, tdir).x * -sd < 0) tax.negate();
      return { n, ax, d: d.clone().multiplyScalar(-sd), tax };
    });
    const P = (this.p = {});
    P.hips = B.hips; P.legL = B.thighL; P.legR = B.thighR; P.shinL = B.shinL; P.shinR = B.shinR;
    P.armL = B.armL; P.armR = B.armR; P.foreL = B.foreL; P.foreR = B.foreR; P.handL = B.handL; P.handR = B.handR;
    // head anchor at the head center (hats, etc.)
    const ha = new THREE.Group(); ha.name = 'headAnchor';
    ha.position.copy(T.L.HC).sub(T.def.pos('head')); B.head.add(ha); P.head = ha; this.headAnchor = ha;
    // carry anchor following the chest; local frame == root frame at rest (unscaled)
    const ta = new THREE.Group(); ta.name = 'carryAnchor';
    const cp = T.def.pos('chest');
    ta.position.set(-cp.x, -cp.y + (T.L.SY + 0.05 - 1.62 / this.s) , -cp.z);
    ta.scale.setScalar(1 / this.s);
    B.chest.add(ta); P.torso = ta;
    // props
    this.props = [];
    if (T.staff) this.addStaff(T);
    if (T.cane) this.addHeld(T.cane, 'handR', (g) => {
      const lan = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), glowMat(0xffc060, 2.4)); lan.position.set(0, 0.12, 0.34); g.add(lan);
      const cageM = toon(0x3a3028, { rim: 0.5 });
      const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.1, 6, 1, true), cageM); cage.position.set(0, 0.12, 0.34); g.add(cage);
      P.lantern = lan;
    });
    if (T.spear) this.addHeld(T.spear, 'handR');
    if (T.book) this.addHeld(T.book, 'handL', (g) => { g.rotation.set(0.1, 0, 0.0); g.position.set(-0.03, -0.07, 0.02); });
    // chains
    this.chains = T.chains.map((ch) => {
      const bones = ch.names.map((n) => B[n]);
      const last = ch.names[ch.names.length - 1];
      const tail = ch.tail.clone().sub(T.def.pos(last));
      const cols = [];
      const L = T.L, bwf = 0.75 + 0.25 * L.bw;
      const cp = T.def.pos('chest'), hp = T.def.pos('hips');
      const col = (obj, base, x, y, z, r) => cols.push({ obj, off: new V3(x - base.x, y - base.y, z - base.z), r });
      if (ch.kind === 'cape') { col(B.chest, cp, 0, L.SY - 0.1, 0.03, 0.16 * bwf); col(B.hips, hp, 0, L.H - 0.02, 0, 0.15 * bwf); }
      if (ch.kind === 'scarf') col(B.chest, cp, 0, L.SY - 0.05, 0.06, 0.2 * bwf);
      if (ch.kind === 'hair') { col(B.head, T.def.pos('head'), L.HC.x, L.HC.y, L.HC.z, L.hr * 1.08); col(B.chest, cp, 0, L.SY - 0.1, 0.03, 0.15 * bwf); }
      // (modelled characters wear trousers cut with ease: wider legs under the skirt)
      if (ch.kind === 'skirt') for (const th of [B.thighL, B.thighR]) for (const y of T.v2 ? [-0.06, -0.12, -0.18, -0.24, -0.3] : [-0.06, -0.17, -0.28]) cols.push({ obj: th, off: new V3(0, y, 0.005), r: (T.v2 ? 0.112 : 0.094) * bwf * (c.limb ?? 1) });
      if (ch.kind === 'skirt' && ch.names.length > 2) for (const sh of [B.shinL, B.shinR]) for (const y of [-0.08, -0.22]) cols.push({ obj: sh, off: new V3(0, y, 0), r: 0.075 * bwf });
      else if (ch.kind !== 'plume') { cols.push({ obj: B.thighL, off: new V3(0, -0.2, 0), r: 0.1 * bwf }); cols.push({ obj: B.thighR, off: new V3(0, -0.2, 0), r: 0.1 * bwf }); }
      const opts = ch.opts || { cape: { stiff: 0.06, stiffTip: 0.02, damp: 0.1, grav: 9, drag: 1 }, scarf: { stiff: 0.05, stiffTip: 0.01, damp: 0.06, grav: 7, drag: 1.4 }, plume: { stiff: 0.12, stiffTip: 0.05, damp: 0.12, grav: 2, drag: 0.8 }, hair: { stiff: 0.14, stiffTip: 0.06, damp: 0.12, grav: 6, drag: 0.5 }, skirt: { stiff: 0.3, stiffTip: 0.16, damp: 0.25, grav: 5, drag: 0.4 } }[ch.kind];
      // (people: a skirt hangs heavier and catches less air, and each thigh is one capsule down to
      // the knee: cloth is pushed straight off the limb and lies along it, in front and behind)
      let own = null;
      if (this.person && ch.kind === 'skirt') {
        own = { grav: 12, drag: 0.1 };
        cols.length = 0;
        const kn = T.def.pos('shinL').clone().sub(T.def.pos('thighL'));
        for (const th of [B.thighL, B.thighR]) cols.push({ obj: th, a: new V3(0, -0.03, 0.004), b: new V3(0, kn.y * 1.04, kn.z + 0.004), r: (T.v2 ? 0.112 : 0.094) * bwf * (c.limb ?? 1) * this.s });
        if (ch.names.length > 2) for (const sh of [B.shinL, B.shinR]) cols.push({ obj: sh, off: new V3(0, -0.15, 0), r: 0.075 * bwf });
      }
      const chn = new Chain(bones, tail, { ...opts, ...own, colliders: cols });
      chn.kind = ch.kind;
      chn.order = +(/(\d+)_\d+$/.exec(ch.names[0]) || [0, 0])[1];
      return chn;
    });
    // the panels of a skirt in order round the hips (neighbours share what pushes them out)
    this.skirt = this.person ? this.chains.filter((ch) => ch.kind === 'skirt').sort((a, b) => a.order - b.order) : [];
    if (this.skirt.length < 4) this.skirt = [];
    // state
    this.w = { climb: 0, cast: 0, air: 0, glide: 0, talk: 0, swim: 0, sit: 0, kneel: 0, hurt: 0, wave: 0, spread: 0, down: 0, stagger: 0, shock: 0, panic: 0, dead: 0, dash: 0, gait: 0, run: 0, sprint: 0 };
    this.q = newPose();
    this.phase = rand();
    this.style = { hunch: c.hunch ?? 0, cadence: c.stride ? c.stride / 1.7 : 1, lift: 1, armHang: 0.08, kneeBend: 0, sway: 1, ...(this.person ? personStyle(c) : null), ...(o.style || {}) };
    this.gt = { freq: 1, duty: 0.6 };
    this.idle = { side: rand() < 0.5 ? 1 : -1, sideT: 2 + rand() * 6, lean: 0, fidT: 5 + rand() * 8, breath: rand() * 6 };
    this.lean = new V3();        // smoothed lean: x sideways, z forward
    this.lik = { w: 0, wt: 0 };  // left hand resting on the hip (a fidget)
    this.slope = 0;
    this.hipY = T.L.H;
    this.height = (T.L.HC.y + T.L.hr * 1.1) * this.s;
    this.vel = new V3(); this.velL = new V3(); this.prevPos = null; this.prevYaw = 0; this.yawRate = 0; this.acc = new V3();
    this.moveDir = new V3(0, 0, 1);
    this.feet = [0, 1].map((k) => ({ side: k ? -1 : 1, n: k ? 'R' : 'L', plant: new V3(), pos: new V3(), from: new V3(), to: new V3(), planted: false, stepping: 0, stepDur: 0.22, pitch: 0, init: false, lift: 0, yaw: 0, sg0: 0, p0: 0, tilt: 0, x0: 0, l0: 0 }));
    this.pelvisDrop = 0;
    this.footPlants = []; // contacts from this update, consumed by Player after posing
    this.drive = new Spring(180, 20); this.bank = new Spring(140, 18);
    this.land = new Spring(160, 16); this.landImpulse = 0;
    this.prevGrounded = true; this.prevVy = 0; this.airT = 0;
    this.castK = 0; this.castKind = 'bolt'; this.castV = 0; this.castSp = new Spring(260, 18);
    // staff casting (people): the running clip, its wind-up and release clocks, the smoothed pose
    this.cast = { clip: null, el: null, wt: -1, dur: 0, rt: 9, two: 0, toes: 0, cur: CP({}), tgt: CP({}), tmp: CP({}), init: false };
    this.charge = 0;
    this.hurtSp = new Spring(200, 14);
    // face
    this.fx = {}; this.ft = {};
    for (const k of EXPR_KEYS) { this.fx[k] = EXPR.neutral[k]; this.ft[k] = EXPR.neutral[k]; }
    // the modelled people: sprung expression channels, what lingers of the last expression, speech
    this.face2 = this.person && T.v2;
    if (this.face2) {
      this.fv = {}; this.fr = {};
      for (const k of EXPR2_KEYS) { this.fx[k] = X0[k]; this.ft[k] = X0[k]; this.fv[k] = 0; this.fr[k] = 0; }
      const kid = c.kid ?? 0, age = c.age ?? 0;
      // a face of its own: how big and quick it plays, the lids' rest, which corner smiles more
      // (a lopsided smile gives an adult face character; on a child it reads as a smirk)
      this.fs = { amp: 1 - 0.12 * age, speed: 1 + 0.15 * kid - 0.2 * age, lid: c.lidRest ?? 0, smile: c.smileRest ?? 0, side: (rand() < 0.5 ? 1 : -1) * (0.04 + 0.08 * rand()) * (1 - kid), seed: rand() * 100, ...(c.faceStyle || {}) };
      // the cheeks, for the flush of a smile (skinMat uBlush)
      const hc = T.L.HC, hr = T.L.hr;
      M.skin.userData.skin.uBlush.value.set(0.52 * hr, hc.y - 0.3 * hr, hc.z + 0.7 * hr, 0.3 * hr);
      this.vis = { o: 0, r: 0, w: 0, shut: 0 }; this.visT = { o: 0, r: 0, w: 0, shut: 0 }; this.visN = 0; this.browFlash = 0; this.nod = 0;
      this.gaze = { away: 0, awayT: 2 + rand() * 4, ax: 0, ay: 0, flip: 1 };
      this.blinkDur = 0.2;
    }
    this.expression = 'neutral'; this.exprHold = 0; this.exprPrev = 'neutral';
    this.blinkT = 1 + rand() * 3; this.blink = 0; this.dblBlink = false;
    this.eyeLook = new V3(); this.eyeT = 0; this.eyeTarget = new V3(); this.lookPoint = null;
    this.talkN = 0; this.talkV = 0; this.beatT = 2;
    this.gestures = [];
    this.idleT = 3 + rand() * 4; this.idleLook = 0; this.idleLookT = 0;
    this.lod = 0;
    this.hatChildren = -1;
    this.ikW = 1;
    this.flickT = 9;
    this.hold = o.hold !== undefined ? o.hold : c.staff ? 'staff' : c.cane ? 'cane' : c.spear ? 'spear' : null;
    this.castPose = o.castPose ?? true; // built-in staff casting pose (enemies supply their own)
    this.poseHook = o.pose || null;   // (q, s, rig, dt): edit the pose before it is written to bones
    this.postHook = o.post || null;   // (s, rig, dt): after IK / secondary motion (props, glows)
  }
  addStaff(T) {
    const P = this.p;
    const g = new THREE.Group(); g.name = 'staff';
    const m = new THREE.Mesh(T.staff, toon(0xffffff, { vertexColors: true, rim: 0.45 })); m.castShadow = true; g.add(m);
    if (this.c.outline) addOutline(m, 0.004, 0x2a1c18);
    const top = HB.STAFF.len - HB.STAFF.below;
    // faceted, double-terminated crystal (long axis = local Y, laid onto the staff);
    // material.color is the tint *and* glow colour (player.js retints it per element)
    const gemMat = crystalMaterial({ color: new THREE.Color(2, 1.6, 3), intensity: 1.25, sparkle: 1.2, nocache: true });
    const gem = new THREE.Mesh(crystalGeometry('prism', { double: true, sides: 6, radius: 0.4, tip: 0.5, seed: 13 }), gemMat);
    gem.scale.setScalar(0.07);
    gem.position.set(0, 0.0, top + 0.02); gem.rotation.x = Math.PI / 2; g.add(gem);
    const halo = crystalGlowSprite(0xcfb8ff, 5.2, { nocache: true });
    halo.onBeforeRender = () => { halo.material.color.copy(gemMat.color).multiplyScalar(0.16); };
    gem.add(halo);
    const tip = new THREE.Object3D(); tip.position.set(0, 0, top + 0.05); g.add(tip);
    // grip point in the right fist
    g.position.set(-0.004, -this.L.hand * 0.36, 0.004);
    this.B.handR.add(g);
    P.staff = g; P.gem = gem; P.tip = tip;
    this.props.push(g);
  }
  addHeld(geo, bone, extra) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true, rim: 0.5 })); m.castShadow = true; g.add(m);
    if (this.c.outline) addOutline(m, 0.004, 0x2a1c18);
    g.position.set(0, -this.L.hand * 0.36, 0.004);
    if (extra) extra(g);
    this.B[bone].add(g);
    this.props.push(g);
    return g;
  }

  // ---------------------------------------------------------------- API
  hurt() { this.w.hurt = 1; this.hurtSp.v += 9; this.hurtSide = rand() < 0.5 ? -1 : 1; if (this.faceU) this.setExpression('hurt', 0.45); }
  // release of a spell (the frame its effect leaves the staff). kind: 'bolt' | 'charged' | 'heavy' | 'weave' | 'ult'
  flick(kind = 'bolt', el = null) {
    this.castKind = kind; this.flickT = 0; this.castSp.v -= kind === 'heavy' ? 14 : kind === 'ult' ? 10 : 11;
    const C = this.cast;
    C.clip = this.castClip(kind, el); C.el = el; C.wt = -1; C.rt = 0;
    if (this.person && this.hold === 'staff') {
      // Spells sample staffTip immediately, before the next animation update.
      // Commit the contact pose now so the projectile leaves the visible crystal.
      this.w.cast = 1; this.w.climb = this.w.swim = 0;
      const staff = this.p.staff;
      if (staff && (staff.parent !== this.B.handR || this.stowK < 1)) {
        this.B.handR.add(staff); staff.position.set(-0.004, -this.L.hand * 0.36, 0.004); staff.quaternion.identity();
        this.stowed = false; this.stowK = 1;
      }
      this.update(0, { ...this.lastState, cast: true, climb: false, swim: false });
    }
  }
  // start of a spell's anticipation: the pose reaches its contact after `dur` seconds and holds there until flick()
  windup(kind, dur = 0.15, el = null) {
    const C = this.cast;
    C.clip = this.castClip(kind, el); C.el = el; C.wt = 0; C.dur = Math.max(dur, 0.02); C.rt = 9;
  }
  castClip(kind, el) { return kind === 'heavy' ? CAST['heavy_' + el] || CAST.heavy_arcane : kind === 'weave' ? CAST.weave : kind === 'ult' ? CAST.ult : kind === 'charged' ? CAST.charged : null; }
  // a push of air into cape, skirt and hair (the recoil of a blast): dir in world space, strength 0..1
  gust(dir, strength = 0.5) {
    for (const ch of this.chains) ch.kick(dir, strength * (ch.kind === 'skirt' ? 0.02 : 0.05));
  }
  setExpression(name, hold = 0) {
    if (hold > 0) { if (!this.exprHold) this.exprPrev = this.expression; this.exprHold = hold; } else { this.exprHold = 0; this.exprPrev = name; }
    if (this.face2) {
      // (a CHAR entry may play an expression its own way: `exprs: { smile: { ... } }`)
      const own = this.c.exprs && this.c.exprs[name], base = EXPR2[name] || EXPR2.neutral, e = own ? { ...base, ...own } : base, changed = name !== this.expression;
      // a feeling does not switch off: part of the last expression stays and fades (facePerson)
      for (const k of EXPR2_KEYS) { if (changed) this.fr[k] = (this.ft[k] + this.fr[k] - e[k]) * (LINGER[k] ?? 0); this.ft[k] = e[k]; }
      if (changed && this.blink <= 0 && rand() < 0.6 && name !== 'surprised' && name !== 'scared') this.blinkT = 0.04 + rand() * 0.1;     // most changes of expression come with a blink
      if (name === 'surprised' || name === 'scared') this.blinkT = Math.max(this.blinkT, 1.2);
      this.expression = name;
      return;
    }
    const e = EXPR[name] || EXPR.neutral;
    this.expression = name;
    for (const k of EXPR_KEYS) this.ft[k] = e[k];
  }
  gesture(name, o = {}) {
    if (name === null) { for (const g of this.gestures) g.out = true; this.gestureName = null; return 0; }
    const def = GEST[name];
    if (!def) return 0;
    // replace a running gesture on the same limbs
    for (const g of this.gestures) if (!g.def.small || def.small) g.out = true;
    const sp = o.speed ?? 1;
    this.gestures.push({ name, def, t: 0, w: 0, sp, amp: o.amp ?? 1, out: false });
    if (def.expr && this.faceU) this.setExpression(def.expr, def.dur / sp);
    if (!name.startsWith('beat') && !name.startsWith('fid')) this.gestureName = name;
    return def.dur / sp;
  }
  lookAt(p) { this.lookPoint = p ? (this.lookPoint || new V3()).copy(p) : null; }

  landImpact(vy) {
    const imp = clamp(-vy / 22, 0.12, 1);
    this.land.v = Math.min(this.land.v, -(2 + 7 * imp)); this.landImpulse = imp;
    this.landPending = true;
    if (this.person) { this.ikW = 1; for (const f of this.feet) f.init = false; }
    if (this.person) this.gust(_v1.set(0, 1, 0), imp * 0.45);
  }

  // ---------------------------------------------------------------- update
  update(dt, s = {}) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.lastState = s;
    this.footPlants.length = 0;
    this.t += dt;
    const W = this.w;
    const root = this.root;
    root.updateMatrixWorld();
    // --- root motion (world velocity, yaw rate)
    const e = root.matrixWorld.elements;
    _v1.set(e[12], e[13], e[14]);
    const yaw = Math.atan2(e[8], e[10]);
    if (this.prevPos && _v1.distanceToSquared(this.prevPos) > 1.5 * 1.5) {
      // teleported: re-seat feet and cloth
      this.prevPos.copy(_v1); this.vel.set(0, 0, 0); this.acc.set(0, 0, 0);
      for (const f of this.feet) f.init = false;
      for (const ch of this.chains) ch.init = false;
      this.prevYaw = yaw; this.yawRate = 0;
      this.drive.x = this.drive.v = this.bank.x = this.bank.v = 0;
      this.land.x = this.land.v = 0;
    }
    if (this.prevPos && dt > 0) {
      _v2.subVectors(_v1, this.prevPos).multiplyScalar(1 / dt);
      if (_v2.lengthSq() > 60 * 60) _v2.set(0, 0, 0);
      const pv = _v3.copy(this.vel);
      this.vel.lerp(_v2, 1 - Math.exp(-dt * 14));
      this.acc.lerp(_v4.subVectors(this.vel, pv).multiplyScalar(1 / dt), 1 - Math.exp(-dt * 6));
      this.yawRate = damp(this.yawRate, wrapA(yaw - this.prevYaw) / dt, 10, dt);
    } else this.prevPos = new V3();
    this.prevPos.copy(_v1); this.prevYaw = yaw;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    this.velL.set(this.vel.x * cy - this.vel.z * sy, this.vel.y, this.vel.x * sy + this.vel.z * cy);
    const accF = this.acc.x * sy + this.acc.z * cy;
    const dist = camDist(root);
    this.lod = dist < 26 ? 0 : dist < 60 ? 1 : 2;
    const vis = root.visible && this.lod < 2;

    // --- state weights
    const speed = Math.min(s.speed ?? 0, 60);
    const grounded = s.grounded !== false;
    const lie = Math.max(W.down, W.dead);
    const casting = s.cast || (this.person && (this.cast.wt >= 0 || (s.charge ?? 0) > 0.01 || (this.cast.clip && this.cast.rt < this.cast.clip.rec)));
    W.cast = damp(W.cast, casting ? 1 : 0, casting ? 16 : 5, dt);
    W.climb = damp(W.climb, s.climb ? 1 : 0, s.climb ? 14 : 8, dt);
    W.air = damp(W.air, !grounded && !s.glide && !s.swim && !s.climb ? 1 : 0, 12, dt);
    W.glide = damp(W.glide, s.glide ? 1 : 0, 7, dt);
    W.swim = damp(W.swim, s.swim ? 1 : 0, 6, dt);
    W.talk = damp(W.talk, s.talk ? 1 : 0, 6, dt);
    W.sit = damp(W.sit, s.sit ? 1 : 0, 4, dt);
    W.kneel = damp(W.kneel, s.kneel ? 1 : 0, 4, dt);
    W.wave = damp(W.wave, s.wave ? 1 : 0, 6, dt);
    W.spread = damp(W.spread, s.spread ? 1 : 0, 6, dt);
    W.down = damp(W.down, s.down ? 1 : 0, s.down ? 12 : 4, dt);
    W.stagger = damp(W.stagger, s.stagger ? 1 : 0, 8, dt);
    W.shock = damp(W.shock, s.shock ? 1 : 0, 20, dt);
    W.panic = damp(W.panic, s.panic ? 1 : 0, 10, dt);
    W.dead = damp(W.dead, s.dead ? 1 : 0, 6, dt);
    const dashing = s.dash ?? speed > 16;
    W.dash = damp(W.dash, dashing ? 1 : 0, dashing ? 45 : 12, dt);
    W.hurt = Math.max(0, W.hurt - dt * 3);
    const spn = Math.min(speed, 12) / this.s;
    const P = this.person;
    W.gait = damp(W.gait, spn > 0.2 && grounded ? 1 : 0, spn > 0.2 ? 18 : 10, dt);
    W.run = damp(W.run, P ? sstep(2.3, 4.0, spn) : sstep(2.6, 5.2, spn), P ? 7 : 5, dt);
    const sprint = P ? (W.sprint = damp(W.sprint, sstep(6.6, 8.6, spn), 6, dt)) : sstep(6.5, 9, spn);
    if (!grounded) this.airT += dt; else this.airT = 0;
    // landing impact
    if (grounded && !this.prevGrounded && !s.swim) {
      if (!this.landPending) this.landImpact(this.prevVy);
    }
    this.landPending = false;
    this.prevGrounded = grounded; this.prevVy = s.vy ?? 0;
    this.land.step(0, dt);
    this.castSp.step(0, dt); this.hurtSp.step(0, dt);
    this.flickT += dt;

    // --- pose
    const q = this.q;
    for (const k of POSE_KEYS) q[k] = 0;
    const st = this.style;
    const t = this.t;
    // gait phase
    let freq = (1.0 + 0.3 * spn) * st.cadence;
    let duty = mix(0.6, 0.34, sstep(1.5, 7, spn));
    if (P) {
      gaitOf(spn, this.gt); freq = this.gt.freq * st.cadence; duty = this.gt.duty;
      // sideways and backwards the legs cannot reach as far: shorter, quicker steps
      const vl = Math.hypot(this.velL.x, this.velL.z), fwd = vl > 0.3 ? Math.max(0, this.velL.z / vl) : 1;
      freq *= Math.max(1, (spn * duty / freq) / mix(0.44, 0.9, fwd));
    }
    if (W.gait > 0.01) this.phase = (this.phase + dt * freq) % 1;
    const ph = this.phase * TAU;
    const gw = W.gait * (1 - W.air) * (1 - W.glide) * (1 - W.swim) * (1 - W.climb) * (1 - W.dash) * (1 - W.sit) * (1 - lie);
    const run = W.run;
    const hold = this.hold;
    const idle = 1 - W.gait;
    if (P) this.bodyPose(q, dt, s, ph, duty, gw, spn, speed, accF);
    else {
    // idle breathing & weight shift
    const breath = Math.sin(t * 2.1);
    const shift = Math.sin(t * 0.45) * 0.6 + Math.sin(t * 0.21) * 0.4;
    q.hipsPX += shift * 0.012 * idle * st.sway;
    q.hipsz += shift * 0.025 * idle * st.sway;
    q.spinez -= shift * 0.02 * idle;
    q.chestx += breath * 0.012 * idle - st.hunch * 0.6;
    q.spinex += st.hunch * 0.5;
    q.neckx -= st.hunch * 0.2;
    q.headx -= st.hunch * 0.35;
    q.clavLz += breath * 0.015 * idle; q.clavRz -= breath * 0.015 * idle;
    // arms at rest
    q.armLz += st.armHang + 0.02 * breath * idle; q.armRz -= st.armHang + 0.02 * breath * idle;
    q.foreLx -= 0.14; q.foreRx -= 0.14;
    q.fingL += 0.35; q.fingR += 0.35; q.thumbL += 0.2; q.thumbR += 0.2;
    q.handLz -= 0.05; q.handRz += 0.05;
    // locomotion upper body. fwdL: 1 when the left foot is in front (contact at phase 0)
    const fwdL = Math.cos(ph);
    const aSw = (0.4 + 0.35 * run + 0.25 * sprint) * gw;
    q.armLx += fwdL * aSw;            // left arm back while the left leg is forward
    q.armRx -= fwdL * aSw;
    q.foreLx -= (0.2 + 1.15 * run + 0.2 * sprint) * gw + Math.max(0, -fwdL) * 0.25 * gw;
    q.foreRx -= (0.2 + 1.15 * run + 0.2 * sprint) * gw + Math.max(0, fwdL) * 0.25 * gw;
    q.armLz += 0.1 * run * gw; q.armRz -= 0.1 * run * gw;
    q.fingL += 0.8 * run * gw; q.fingR += 0.8 * run * gw;
    q.hipsy -= fwdL * (0.12 + 0.06 * run) * gw;
    q.chesty += fwdL * (0.14 + 0.1 * run) * gw;
    q.heady -= fwdL * 0.05 * gw;
    q.spinex += (0.03 + 0.1 * run + 0.12 * sprint) * gw + clamp(accF * 0.025, -0.15, 0.22) * gw;
    q.chestx += 0.04 * run * gw;
    q.headx -= (0.02 + 0.08 * run + 0.1 * sprint) * gw;
    // held props: staff / cane / spear upright in the right fist, book in the left
    if (hold && W.climb < 0.5) {
      q.armRx = q.armRx * 0.35 + (hold === 'cane' ? -0.3 : -0.12);
      q.armRz += hold === 'staff' ? -0.16 : -0.1;
      q.foreRx = (hold === 'cane' ? -0.95 : -1.3) - 0.25 * run * gw;
      q.foreRy = -0.1; q.handRx = hold === 'cane' ? -0.3 : 0.1; q.handRz = -0.05;
      q.fingR = 1.4; q.thumbR = 1.1;
    }
    if (this.c.book) { q.armLx = q.armLx * 0.3 - 0.15; q.foreLx = -1.25; q.foreLy = -0.6; q.handLz = 0.25; q.handLx = 0.2; q.fingL = 0.7; }
    // lean into turns
    const turnLean = clamp(this.yawRate * speed * 0.018, -0.3, 0.3) * gw;
    q.spinez -= turnLean; q.heady += clamp(this.yawRate * 0.08, -0.3, 0.3);
    // bob, sway & roll: walking peaks at mid-stance, running dips at mid-stance
    const mid = ph - duty * Math.PI;
    const bob = Math.cos(mid * 2);
    q.hipsPY += (bob * (0.016 * (1 - run) - 0.028 * run) - 0.025 * run - 0.03 * sprint) * gw;
    q.hipsPX += Math.cos(mid) * 0.018 * gw * (1 - run * 0.7) * st.sway;
    q.hipsz += Math.cos(mid) * 0.05 * gw * (1 - run * 0.5);
    q.spinez -= Math.cos(mid) * 0.03 * gw;
    }

    // --- air: takeoff stretch, tuck while rising, reach down while falling
    const vy = s.vy ?? 0;
    if (P) this.actionPose(q, dt, s, vy, speed);
    else {
    if (W.air > 0.01) {
      const a = W.air;
      const rising = sstep(-2, 3, vy), fall = 1 - rising;
      const fl = Math.sin(t * 7.5), fl2 = Math.sin(t * 6.1 + 1);
      q.armLx = lerp(q.armLx, -0.5 * rising - 0.3 * fall + fl * 0.25 * fall, a); q.armRx = lerp(q.armRx, -0.5 * rising - 0.3 * fall - fl2 * 0.25 * fall, a);
      q.armLz = lerp(q.armLz, 0.55 + 0.75 * fall, a); q.armRz = lerp(q.armRz, -0.55 - 0.75 * fall, a);
      q.foreLx = lerp(q.foreLx, -0.7 + 0.3 * fall, a); q.foreRx = lerp(q.foreRx, -0.7 + 0.3 * fall, a);
      q.thighLx = lerp(q.thighLx, -0.95 * rising - 0.5 * fall + fl * 0.12 * fall, a); q.shinLx = lerp(q.shinLx, 1.35 * rising + 0.75 * fall, a);
      q.thighRx = lerp(q.thighRx, 0.1 - 0.25 * rising - 0.1 * fall - fl * 0.12 * fall, a); q.shinRx = lerp(q.shinRx, 0.7 * rising + 0.9 * fall, a);
      q.thighLz = lerp(q.thighLz, 0.06 + 0.1 * fall, a); q.thighRz = lerp(q.thighRz, -0.06 - 0.1 * fall, a);
      q.footLx = lerp(q.footLx, 0.3, a); q.footRx = lerp(q.footRx, 0.45, a);
      q.spinex = lerp(q.spinex, 0.12 * rising + 0.06 * fall, a); q.headx = lerp(q.headx, -0.1 * rising + 0.15 * fall, a);
      q.fingL = lerp(q.fingL, 0.2, a); q.fingR = lerp(q.fingR, 0.2, a);
    }
    // --- dash (blink)
    if (W.dash > 0.01) {
      const a = W.dash;
      q.spinex = lerp(q.spinex, 0.55, a); q.chestx = lerp(q.chestx, 0.2, a); q.headx = lerp(q.headx, -0.5, a);
      q.armLx = lerp(q.armLx, 0.9, a); q.armRx = lerp(q.armRx, 0.9, a); q.armLz = lerp(q.armLz, 0.3, a); q.armRz = lerp(q.armRz, -0.3, a);
      q.thighLx = lerp(q.thighLx, -0.7, a); q.shinLx = lerp(q.shinLx, 1.4, a); q.thighRx = lerp(q.thighRx, 0.5, a); q.shinRx = lerp(q.shinRx, 1.0, a);
    }
    // --- glide: arms spread like wings, legs trailing
    if (W.glide > 0.01) {
      const a = W.glide;
      const fl = Math.sin(t * 5) * 0.05;
      q.spinex = lerp(q.spinex, 0.35, a); q.chestx = lerp(q.chestx, 0.1, a); q.headx = lerp(q.headx, -0.35, a);
      q.armLx = lerp(q.armLx, -0.15, a); q.armRx = lerp(q.armRx, -0.15, a); q.armLz = lerp(q.armLz, 1.35 + fl, a); q.armRz = lerp(q.armRz, -1.35 - fl, a);
      q.foreLx = lerp(q.foreLx, -0.15, a); q.foreRx = lerp(q.foreRx, -0.15, a); q.fingL = lerp(q.fingL, 0.1, a); q.fingR = lerp(q.fingR, 0.1, a);
      q.thighLx = lerp(q.thighLx, 0.35, a); q.thighRx = lerp(q.thighRx, 0.55, a); q.shinLx = lerp(q.shinLx, 0.5, a); q.shinRx = lerp(q.shinRx, 0.3, a);
      q.footLx = lerp(q.footLx, 0.7, a); q.footRx = lerp(q.footRx, 0.7, a);
      q.spinez = lerp(q.spinez, clamp(-this.yawRate * 0.25, -0.4, 0.4), a);
    }
    }
    // --- swim: breaststroke
    if (W.swim > 0.01) {
      const a = W.swim;
      const sp = Math.min(1, speed / 2);
      const cyc = t * (2.2 + sp * 1.2);
      const st2 = Math.sin(cyc), ct = Math.cos(cyc);
      q.hipsx = lerp(q.hipsx, 0.35 + 0.95 * sp, a); q.spinex = lerp(q.spinex, 0.1, a); q.chestx = lerp(q.chestx, -0.1 * sp, a);
      q.neckx = lerp(q.neckx, -0.4 * sp, a); q.headx = lerp(q.headx, -0.6 * sp - 0.1, a);
      q.armLx = lerp(q.armLx, -1.6 + st2 * 0.4 * (0.4 + sp), a); q.armRx = lerp(q.armRx, -1.6 + st2 * 0.4 * (0.4 + sp), a);
      q.armLz = lerp(q.armLz, 0.3 + (0.5 + 0.5 * ct) * 0.9 * (0.3 + sp), a); q.armRz = lerp(q.armRz, -0.3 - (0.5 + 0.5 * ct) * 0.9 * (0.3 + sp), a);
      q.foreLx = lerp(q.foreLx, -0.3 - (0.5 - 0.5 * ct) * 1.0, a); q.foreRx = lerp(q.foreRx, -0.3 - (0.5 - 0.5 * ct) * 1.0, a);
      q.fingL = lerp(q.fingL, 0.05, a); q.fingR = lerp(q.fingR, 0.05, a);
      const kick = Math.sin(cyc + 1.2);
      q.thighLx = lerp(q.thighLx, 0.1 + kick * 0.35 * sp, a); q.thighRx = lerp(q.thighRx, 0.1 + kick * 0.35 * sp, a);
      q.thighLz = lerp(q.thighLz, 0.25 * (0.5 + 0.5 * kick), a); q.thighRz = lerp(q.thighRz, -0.25 * (0.5 + 0.5 * kick), a);
      q.shinLx = lerp(q.shinLx, 0.5 + 0.6 * (0.5 - 0.5 * kick), a); q.shinRx = lerp(q.shinRx, 0.5 + 0.6 * (0.5 - 0.5 * kick), a);
      q.footLx = lerp(q.footLx, 0.9, a); q.footRx = lerp(q.footRx, 0.9, a);
      q.hipsPY = lerp(q.hipsPY, Math.sin(cyc) * 0.02, a);
    }
    // --- climb: body pressed to the wall, hands reaching up in turn, knees stepping
    if (W.climb > 0.01) {
      const a = W.climb;
      const cp = (s.climbPhase ?? 0) * TAU, mv = s.climbMove ?? 0;
      const reachL = 0.5 + 0.5 * Math.sin(cp), reachR = 1 - reachL;
      const lift = s.mantle ?? 0; // 0..1 while pulling up over a ledge
      const push = sstep(0.3, 0.8, lift);
      q.hipsx = lerp(q.hipsx, 0.25 - push * 0.3, a); q.spinex = lerp(q.spinex, 0.18 + push * 0.5, a); q.chestx = lerp(q.chestx, 0.05, a);
      q.headx = lerp(q.headx, -0.45 + push * 0.5, a); q.hipsPZ = lerp(q.hipsPZ, 0.1, a);
      // arms: one high, one lower, swapping as we climb; mantle pushes down on the lip
      const hiL = mix(-2.2 - 0.5 * reachL * mv, -1.0, push), hiR = mix(-2.2 - 0.5 * reachR * mv, -1.0, push);
      q.armLx = lerp(q.armLx, hiL, a); q.armRx = lerp(q.armRx, hiR, a);
      q.armLz = lerp(q.armLz, 0.28, a); q.armRz = lerp(q.armRz, -0.28, a);
      q.foreLx = lerp(q.foreLx, -0.55 - 0.5 * (1 - reachL) * mv - push * 0.9, a); q.foreRx = lerp(q.foreRx, -0.55 - 0.5 * (1 - reachR) * mv - push * 0.9, a);
      q.handLx = lerp(q.handLx, 0.5, a); q.handRx = lerp(q.handRx, 0.5, a);
      q.fingL = lerp(q.fingL, 1.1, a); q.fingR = lerp(q.fingR, 1.1, a);
      // legs: opposite leg bends up with the reaching arm
      q.thighLx = lerp(q.thighLx, -0.35 - 0.75 * reachR * mv - push * 0.6, a); q.thighRx = lerp(q.thighRx, -0.35 - 0.75 * reachL * mv, a);
      q.shinLx = lerp(q.shinLx, 0.55 + 0.8 * reachR * mv + push * 0.5, a); q.shinRx = lerp(q.shinRx, 0.55 + 0.8 * reachL * mv, a);
      q.thighLz = lerp(q.thighLz, 0.12, a); q.thighRz = lerp(q.thighRz, -0.12, a);
      q.footLx = lerp(q.footLx, 0.35, a); q.footRx = lerp(q.footRx, 0.35, a);
      q.hipsPY = lerp(q.hipsPY, Math.sin(cp * 2) * 0.03 * mv, a);
    }
    // --- sit (on a bench / ground edge)
    if (W.sit > 0.01) {
      const a = W.sit;
      q.hipsPY = lerp(q.hipsPY, -this.hipY * 0.46, a); q.hipsPZ = lerp(q.hipsPZ, -0.06, a);
      q.thighLx = lerp(q.thighLx, -1.45, a); q.thighRx = lerp(q.thighRx, -1.4, a); q.thighLz = lerp(q.thighLz, 0.08, a); q.thighRz = lerp(q.thighRz, -0.1, a);
      q.shinLx = lerp(q.shinLx, 1.45, a); q.shinRx = lerp(q.shinRx, 1.3, a);
      q.spinex = lerp(q.spinex, 0.12 + st.hunch * 0.5, a);
      q.armLx = lerp(q.armLx, -0.55, a); q.armRx = lerp(q.armRx, -0.5, a); q.foreLx = lerp(q.foreLx, -0.5, a); q.foreRx = lerp(q.foreRx, -0.55, a);
      q.armLz = lerp(q.armLz, 0.05, a); q.armRz = lerp(q.armRz, -0.05, a);
    }
    // --- kneel (one knee down)
    if (W.kneel > 0.01) {
      const a = W.kneel;
      q.hipsPY = lerp(q.hipsPY, -this.hipY * 0.42, a); q.hipsPZ = lerp(q.hipsPZ, -0.04, a);
      q.thighLx = lerp(q.thighLx, -1.45, a); q.shinLx = lerp(q.shinLx, 1.5, a); q.footLx = lerp(q.footLx, 0.0, a);
      q.thighRx = lerp(q.thighRx, 0.2, a); q.shinRx = lerp(q.shinRx, 1.75, a); q.footRx = lerp(q.footRx, 0.5, a); q.toeRx = lerp(q.toeRx, -0.9, a);
      q.spinex = lerp(q.spinex, 0.2, a); q.chestx = lerp(q.chestx, 0.1, a); q.headx = lerp(q.headx, 0.3, a);
      q.armLx = lerp(q.armLx, -0.7, a); q.foreLx = lerp(q.foreLx, -0.9, a); q.armLz = lerp(q.armLz, 0.1, a);
      q.armRx = lerp(q.armRx, -0.2, a); q.foreRx = lerp(q.foreRx, -0.3, a);
    }
    // --- knocked down / dead: limp body (the enemy tilts the root)
    if (lie > 0.01 && !P) {
      const a = lie;
      const tw = Math.sin(t * 3) * 0.05 * W.down;
      q.spinex = lerp(q.spinex, -0.1, a); q.chestx = lerp(q.chestx, -0.1, a); q.headx = lerp(q.headx, -0.3 + tw, a); q.heady = lerp(q.heady, 0.4, a);
      q.armLx = lerp(q.armLx, -2.3, a); q.armRx = lerp(q.armRx, -2.0, a); q.armLz = lerp(q.armLz, 0.7, a); q.armRz = lerp(q.armRz, -0.5, a);
      q.foreLx = lerp(q.foreLx, -0.4, a); q.foreRx = lerp(q.foreRx, -0.9, a);
      q.thighLx = lerp(q.thighLx, -0.3 + tw, a); q.thighRx = lerp(q.thighRx, 0.1, a); q.shinLx = lerp(q.shinLx, 0.6, a); q.shinRx = lerp(q.shinRx, 0.2, a);
      q.fingL = lerp(q.fingL, 0.5, a); q.fingR = lerp(q.fingR, 0.5, a); q.jawx = lerp(q.jawx, 0.2, a);
    }
    // --- stagger / panic / shock
    if (W.stagger > 0.01) {
      const a = W.stagger;
      q.spinex += (0.3 + Math.sin(t * 4.3) * 0.12) * a; q.spinez += Math.sin(t * 2.6) * 0.12 * a; q.headx += 0.4 * a; q.headz += Math.sin(t * 3.1) * 0.2 * a;
      q.armLx = lerp(q.armLx, 0.25 + Math.sin(t * 3.1) * 0.15, a); q.armRx = lerp(q.armRx, 0.2 + Math.sin(t * 3.4 + 1) * 0.15, a);
      q.shinLx += 0.3 * a; q.shinRx += 0.2 * a; q.hipsPY -= 0.05 * a;
    }
    if (W.panic > 0.01) {
      const a = W.panic;
      q.armLx = lerp(q.armLx, -2.7 + Math.sin(t * 17) * 0.7, a); q.armRx = lerp(q.armRx, -2.7 + Math.sin(t * 17 + 2.1) * 0.7, a);
      q.armLz = lerp(q.armLz, 0.45 + Math.sin(t * 13) * 0.35, a); q.armRz = lerp(q.armRz, -0.45 - Math.sin(t * 13 + 1) * 0.35, a);
      q.chesty += Math.sin(t * 11) * 0.25 * a; q.heady += Math.sin(t * 15) * 0.5 * a; q.headx -= 0.4 * a; q.spinex -= 0.2 * a;
      q.jawx += 0.35 * a;
    }
    if (W.shock > 0.01) {
      const a = W.shock;
      const j = () => (rand() - 0.5) * a;
      q.armLx += j() * 0.9; q.armRx += j() * 0.9; q.armLz = lerp(q.armLz, 0.9, a); q.armRz = lerp(q.armRz, -0.9, a);
      q.spinez += j() * 0.25; q.headx += j() * 0.3; q.thighLx += j() * 0.35; q.thighRx += j() * 0.35; q.fingL = lerp(q.fingL, -0.2, a); q.fingR = lerp(q.fingR, -0.2, a); q.jawx += 0.3 * a;
    }
    // --- cast (upper body): staff arm raised towards the aim, off-hand gesture, release kick
    const pitch = s.aimPitch ?? 0;
    const kick = -this.castSp.x;                    // 0 → ~1 on release, springs back
    const ft = this.flickT;
    if (W.cast > 0.01 && this.castPose && this.person && hold === 'staff') this.castPerson(q, dt, s, pitch, kick);
    else if (W.cast > 0.01 && this.castPose) {
      const a = W.cast;
      const kind = this.castKind;
      let ax = -0.72 - pitch * 0.5, az = 0.22, fx = -0.45, hx = 0, lx = -0.8, lz = 0.25, lfx = -0.9;
      if (kind === 'heavy') { ax = -1.0 - pitch * 0.5 - sstep(0.25, 0, ft) * 1.2; fx = -0.2; lx = -1.2; lfx = -0.4; lz = 0.1; }
      else if (kind === 'weave') { const sp = Math.max(0, 1 - ft / 0.7); az = 0.22 + Math.sin(ft * 14) * 0.4 * sp; lx = -0.6 - Math.sin(ft * 14 + 1) * 0.5 * sp; lz = 0.4; }
      else if (kind === 'ult') { const up = sstep(0.45, 0, ft); ax = mix(-0.8 - pitch * 0.5, -2.9, up); fx = mix(-0.4, -0.05, up); lx = mix(-0.9, -2.6, up); lz = mix(0.25, 0.3, up); lfx = mix(-0.8, -0.1, up); }
      q.armRx = lerp(q.armRx, ax - kick * 0.35, a); q.armRz = lerp(q.armRz, az, a); q.armRy = lerp(q.armRy, 0.1, a);
      q.foreRx = lerp(q.foreRx, fx + kick * 0.2, a); q.handRx = lerp(q.handRx, hx - pitch * 0.3 - kick * 0.4, a); q.fingR = lerp(q.fingR, 1.35, a);
      q.armLx = lerp(q.armLx, lx - kick * 0.25, a * 0.85); q.armLz = lerp(q.armLz, lz + kick * 0.25, a * 0.85); q.foreLx = lerp(q.foreLx, lfx, a * 0.85);
      q.handLx = lerp(q.handLx, -0.3, a); q.fingL = lerp(q.fingL, -0.15 + kick * 0.3, a); q.handLz = lerp(q.handLz, -0.25, a);
      q.chesty = lerp(q.chesty, 0.3 + kick * 0.25, a); q.spiney += 0.12 * a; q.chestx += (0.06 - pitch * 0.25 + kick * 0.1) * a;
      q.headx += pitch * 0.35 * a; q.heady -= 0.25 * a; q.hipsPY -= kick * 0.015;
    }
    // --- wave (state flag)
    if (W.wave > 0.01) GEST.wave.fn(q, t, W.wave, this);
    // --- talk: flapping mouth + beat gestures
    const typing = s.talk && (!G.dialogue || !G.dialogue.cur || !G.dialogue.cur.done);
    if (W.talk > 0.01) {
      q.headx += Math.sin(t * 4.3) * 0.035 * W.talk; q.headz += Math.sin(t * 1.7) * 0.04 * W.talk; q.heady += Math.sin(t * 0.9) * 0.06 * W.talk;
      if (typing && this.faceU) { this.beatT -= dt; if (this.beatT <= 0) { this.beatT = 1.6 + rand() * 2.4; if (!this.gestures.length && W.gait < 0.2 && W.sit < 0.5 && W.kneel < 0.5) this.gesture(['beatR', 'beatL', 'beatBoth', 'beatR'][Math.floor(rand() * 4)], { amp: 0.8 }); } }
    }
    // --- one-shot gestures
    this.lik.wt = 0;
    for (let i = this.gestures.length - 1; i >= 0; i--) {
      const g = this.gestures[i];
      if (g.def.fid && (s.talk || W.gait > 0.3 || W.cast > 0.1 || W.air > 0.1)) g.out = true;      // fidgets give way to anything else
      g.t += dt * g.sp;
      const dur = g.def.dur;
      const inW = Math.min(1, g.t / 0.2), outW = g.out ? g.w - dt * 4 : dur === Infinity ? 1 : Math.min(1, (dur - g.t) / 0.3);
      g.w = Math.max(0, Math.min(inW, outW));
      if ((dur !== Infinity && g.t >= dur) || (g.out && g.w <= 0)) { this.gestures.splice(i, 1); if (this.gestureName === g.name) this.gestureName = null; continue; }
      // the hand it wants may be full (staff, cane or spear in the right, a book in the left)
      const flip = P && g.def.hand && g.def.hand === (hold ? 'R' : this.c.book ? 'L' : null);
      if (flip) flipPose(q);
      g.def.fn(q, g.t, g.w * g.amp * (1 - W.cast), this);
      if (flip) flipPose(q);
    }
    // --- idle life: occasional glances
    if (idle > 0.8 && !s.talk && W.cast < 0.1) {
      this.idleT -= dt;
      if (this.idleT <= 0) { this.idleT = 3 + rand() * 5; this.idleLookT = rand() < 0.5 ? (rand() - 0.5) * 1.1 : 0; }
      this.idleLook = damp(this.idleLook, this.idleLookT, 3, dt);
    } else this.idleLook = damp(this.idleLook, 0, 4, dt);
    // --- hurt flinch (additive)
    const hk = this.hurtSp.x * 0.1 + W.hurt * 0.3;
    q.spinex -= hk * 0.8; q.chestx -= hk * 0.5; q.headx -= hk * 0.9; q.armLx -= hk * 1.2; q.armRx -= hk * 1.2; q.armLz += hk * 0.6; q.armRz -= hk * 0.6; q.foreLx -= hk * 1.2; q.foreRx -= hk * 1.2;
    if (P) { const hs = this.hurtSide ?? 1; q.chesty += hk * 0.7 * hs; q.spinez += hk * 0.35 * hs; q.headz -= hk * 0.5 * hs; q.clavLz += hk * 0.5; q.clavRz -= hk * 0.5; q.hipsPY -= Math.abs(hk) * 0.05; q.hipsPZ -= hk * 0.06; }
    // --- landing squash
    const lk = this.land.x;
    if (P) {
      // the legs take the fall: hips sink, the body folds over them, arms out for balance; springs back
      const im = this.landImpulse;
      q.hipsPY += lk * (0.07 + 0.2 * im); q.hipsPZ += lk * 0.05 * im;
      q.spinex -= lk * (0.25 + 0.35 * im); q.chestx -= lk * 0.15; q.headx += lk * 0.25;
      q.armLx += lk * 0.5; q.foreLx += lk * 0.5; q.armLz -= lk * 0.45; q.armRz += lk * 0.25; q.armRx += lk * 0.25; q.fingL += lk * 0.5;
    } else {
    q.hipsPY += lk * 0.03 * (0.6 + this.landImpulse);
    q.spinex -= lk * 0.08; q.headx += lk * 0.05; q.armLz -= lk * 0.08; q.armRz += lk * 0.08;
    }
    // --- head look
    let lyaw = s.lookYaw ?? this.lookYaw, lpitch = this.lookPitch;
    if (this.lookPoint) {
      // head turns toward a world point (dialogue partner, camera, ...)
      const lp = this.lookPoint;
      const dx = lp.x - e[12], dz = lp.z - e[14];
      lyaw = wrapA(Math.atan2(dx, dz) - yaw);
      lpitch = -Math.atan2(lp.y - (e[13] + this.height * 0.92), Math.hypot(dx, dz) + 1e-3);
    }
    const lookY = clamp(lyaw + this.idleLook, -1.1, 1.1), lookP = clamp(lpitch, -0.5, 0.5);
    this.headYaw = damp(this.headYaw ?? 0, lookY * (1 - lie), 7, dt);
    this.headPitch = damp(this.headPitch ?? 0, lookP, 7, dt);
    q.heady += this.headYaw * 0.7; q.necky += this.headYaw * 0.3; q.chesty += this.headYaw * 0.12;
    q.headx += this.headPitch * 0.8; q.neckx += this.headPitch * 0.2;
    q.headx -= W.swim * 0.2;
    q.jawx += (this.talkV ?? 0) * 0.12;
    if (this.face2) q.headx += this.nod * 0.035 - this.browFlash * 0.01;

    if (this.poseHook) this.poseHook(q, s, this, dt);
    // --- write FK to bones
    const B = this.B;
    const hipsRest = this.rest.hips;
    B.hips.position.set(hipsRest.x + q.hipsPX, hipsRest.y + q.hipsPY, hipsRest.z + q.hipsPZ);
    B.hips.rotation.set(q.hipsx, q.hipsy, q.hipsz);
    B.spine.rotation.set(q.spinex, q.spiney, q.spinez);
    B.chest.rotation.set(q.chestx, q.chesty, q.chestz);
    B.neck.rotation.set(q.neckx, q.necky, q.neckz);
    B.head.rotation.set(q.headx, q.heady, q.headz);
    B.jaw.rotation.set(q.jawx, 0, 0);
    B.clavL.rotation.set(0, q.clavLy, q.clavLz); B.clavR.rotation.set(0, q.clavRy, q.clavRz);
    B.armL.rotation.set(q.armLx, q.armLy, q.armLz); B.armR.rotation.set(q.armRx, q.armRy, q.armRz);
    B.foreL.rotation.set(q.foreLx, q.foreLy, q.foreLz); B.foreR.rotation.set(q.foreRx, q.foreRy, q.foreRz);
    B.handL.rotation.set(q.handLx, q.handLy, q.handLz); B.handR.rotation.set(q.handRx, q.handRy, q.handRz);
    // fingers curl towards the palm (inward = -x for the left hand)
    B.fingL.rotation.set(0, 0, -q.fingL * 0.8); B.fingBL.rotation.set(0, 0, -q.fingL * 0.9); B.thumbL.rotation.set(-q.thumbL * 0.3, 0, -q.thumbL * 0.5);
    B.fingR.rotation.set(0, 0, q.fingR * 0.8); B.fingBR.rotation.set(0, 0, q.fingR * 0.9); B.thumbR.rotation.set(-q.thumbR * 0.3, 0, q.thumbR * 0.5);
    B.thighL.rotation.set(q.thighLx, q.thighLy, q.thighLz); B.thighR.rotation.set(q.thighRx, q.thighRy, q.thighRz);
    B.shinL.rotation.set(q.shinLx, 0, 0); B.shinR.rotation.set(q.shinRx, 0, 0);
    B.footL.rotation.set(q.footLx, 0, 0); B.footR.rotation.set(q.footRx, 0, 0);
    B.toeL.rotation.set(q.toeLx, 0, 0); B.toeR.rotation.set(q.toeRx, 0, 0);
    if (this.hands) for (const h of this.hands) {
      const curl = q['fing' + h.n], th = q['thumb' + h.n];
      for (let f = 1; f <= 4; f++) {
        const k = 0.88 + 0.06 * f;
        B['f' + f + 'a' + h.n].quaternion.setFromAxisAngle(h.ax, curl * 0.8 * k);
        B['f' + f + 'b' + h.n].quaternion.setFromAxisAngle(h.ax, curl * 0.95 * k);
        B['f' + f + 'c' + h.n].quaternion.setFromAxisAngle(h.ax, curl * 0.6 * k);
      }
      B['tha' + h.n].quaternion.setFromAxisAngle(h.d, th * 0.45).multiply(_q1.setFromAxisAngle(h.tax, th * 0.25));
      B['thb' + h.n].quaternion.setFromAxisAngle(h.tax, th * 0.4);
      B['thc' + h.n].quaternion.setFromAxisAngle(h.tax, th * 0.45);
    }
    root.updateMatrixWorld(true);
    // --- held pole: orient the fist so the staff stands upright / points at the aim
    if (hold && W.swim < 0.9) {
      const re = root.matrixWorld.elements;
      const rs = root.scale.x || 1;
      _v3.set(re[4], re[5], re[6]).multiplyScalar(1 / rs);   // up
      _v4.set(re[8], re[9], re[10]).multiplyScalar(1 / rs);  // forward
      _v5.set(re[0], re[1], re[2]).multiplyScalar(1 / rs);   // left
      let tilt = hold === 'cane' ? 0.22 : 0.1;
      if (P) tilt = this.holdTilt(tilt, ph, gw);
      else tilt += Math.cos(ph) * 0.12 * gw - run * gw * 0.9 - W.air * 0.5 + W.glide * 1.2;
      let ct = W.cast * (hold === 'staff' ? 1 : 0);
      if (P && hold === 'staff') {
        _v1.copy(_v3).multiplyScalar(Math.cos(tilt)).addScaledVector(_v4, Math.sin(tilt)).addScaledVector(_v5, -0.06);
        ct = Math.max(ct, W.glide);
        if (ct > 0.001) {
          // casting, gliding: both hands go where the clip puts them, the staff points where it says
          const cp = this.cast.cur, k = this.s * rs, lw = ct * (1 - W.climb);
          _v2.set(cp.h[0] * k, cp.h[1] * k, cp.h[2] * k).applyMatrix4(root.matrixWorld);
          ik2(B.armR, B.foreR, B.handR.position, _v2, _q2Pole.set(-0.55 * k, 0.75 * k, -0.4 * k).applyMatrix4(root.matrixWorld), lw);
          _v2.set(cp.l[0] * k, cp.l[1] * k, cp.l[2] * k).applyMatrix4(root.matrixWorld);
          ik2(B.armL, B.foreL, B.handL.position, _v2, _q2Pole.set(0.55 * k, 0.75 * k, -0.4 * k).applyMatrix4(root.matrixWorld), lw);
          _v2.copy(_v5).multiplyScalar(cp.d[0]).addScaledVector(_v3, cp.d[1]).addScaledVector(_v4, cp.d[2]).normalize();
          _v1.normalize().lerp(_v2, ct);
        }
        _v1.normalize();
      } else {
      tilt = mix(tilt, 0.5 + kick * 0.55 - pitch * 0.6 - (this.castKind === 'ult' ? sstep(0.45, 0, ft) * 0.5 : 0), ct);
      _v1.copy(_v3).multiplyScalar(Math.cos(tilt)).addScaledVector(_v4, Math.sin(tilt)).addScaledVector(_v5, -0.06 * (1 - ct)).normalize();
      }
      B.handR.getWorldQuaternion(_q1);
      _v2.set(0, 0, 1).applyQuaternion(_q1);
      rotateTowards(B.handR, _v2, _v1, (P && ct > 0.5 ? 1 : 0.9) * (1 - lie) * (1 - W.shock) * (1 - W.panic) * (1 - W.climb));
      B.handR.updateMatrixWorld(true);
    }

    // --- a hand on the hip
    this.lik.w = damp(this.lik.w, this.lik.wt, 10, dt);
    if (P && this.lik.w > 0.01) {
      const k = this.s * (root.scale.x || 1), hp = this.rest.thighL;
      B.hips.localToWorld(_v2.set(hp.x + 0.075, hp.y + 0.1, hp.z + 0.02));
      ik2(B.armL, B.foreL, B.handL.position, _v2, _q2Pole.set(0.7 * k, this.L.SY * k, -0.45 * k).applyMatrix4(root.matrixWorld), this.lik.w);
    }
    // --- legs: planted-foot IK when standing / walking
    const upright = Math.abs(root.rotation.x) < 0.2 && Math.abs(root.rotation.z) < 0.2;
    const ikTarget = grounded && !s.climb && !s.dash && upright && W.swim < 0.5 && W.glide < 0.5 && lie < 0.2 && W.sit < 0.5 && W.kneel < 0.5 && W.dash < 0.5 && this.lod < 2 ? 1 : 0;
    this.ikW = damp(this.ikW, ikTarget, ikTarget ? 10 : 14, dt);
    if (this.ikW > 0.01 && vis) { if (P) this.legIK2(dt, speed, freq, duty, gw); else this.legIK(dt, speed, spn, freq, duty, gw, run); }
    else { for (const f of this.feet) f.init = false; this.pelvisDrop = damp(this.pelvisDrop, 0, 8, dt); }

    // --- secondary motion
    if (vis && this.lod === 0) {
      _v5.copy(this.vel).multiplyScalar(-1);
      const SK = this.skirt;
      for (const ch of this.chains) ch.step(dt, _v5, true, SK.length > 0 && ch.kind === 'skirt');
      if (SK.length) {
        // a thigh lifts one panel; cloth is one piece, so its neighbours rise part of the way with it
        const n = SK.length;
        for (let k = 1; k < SK[0].n; k++) {
          for (let i = 0; i < n; i++) SK[i].d = (SK[i].d || new V3()).subVectors(SK[i].p[k], SK[i].t[k]);
          for (let i = 0; i < n; i++) { const a = SK[(i + n - 1) % n].d, b = SK[(i + 1) % n].d, P = SK[i].p[k]; if (P && SK[i].n === SK[0].n) P.addScaledVector(_v1.addVectors(a, b).multiplyScalar(0.5).sub(SK[i].d), 0.4); }
        }
        for (const ch of SK) ch.orient();
      }
    } else if (this.chains.length) for (const ch of this.chains) ch.init = false;

    // --- the staff rides on the back while both hands are needed (climbing, swimming)
    if (P && this.p.staff) {
      const stow = W.climb > 0.5 || W.swim > 0.5, g = this.p.staff;
      if (stow !== !!this.stowed) {
        this.stowed = stow; this.stowK = 0;
        (stow ? B.chest : B.handR).attach(g);
        this.stowFrom = { pos: g.position.clone(), quat: g.quaternion.clone() };
      }
      if (this.stowK < 1) {
        this.stowK = Math.min(1, this.stowK + dt / 0.22);
        if (stow) { _v2.set(0.03, -0.12, -0.15); _q2.setFromAxisAngle(_v1.set(1, 0, 0), -Math.PI / 2).premultiply(_q1.setFromAxisAngle(_v1.set(0, 0, 1), 0.45)); }
        else { _v2.set(-0.004, -this.L.hand * 0.36, 0.004); _q2.identity(); }
        g.position.lerpVectors(this.stowFrom.pos, _v2, ease(this.stowK));
        g.quaternion.slerpQuaternions(this.stowFrom.quat, _q2, ease(this.stowK));
      }
    }
    // --- face
    if (this.faceU && this.lod < 2) this.updateFace(dt, s, typing);
    // --- player's hat (from player.setHat): lower the hood, fit the hat
    if (this.B.hoodUp || this.T.v2) this.hoodCheck();
    if (this.postHook) this.postHook(s, this, dt);
  }

  // ---------------------------------------------------------------- people: actions
  // Jump (launch stretch, tuck, open apex, reach for the ground), blink dash, glide, collapse.
  actionPose(q, dt, s, vy, speed) {
    const W = this.w, t = this.t;
    const vl = Math.hypot(this.velL.x, this.velL.z), fz = vl > 0.5 ? this.velL.z / vl : 1, fx = vl > 0.5 ? this.velL.x / vl : 0;
    if (W.air > 0.01) {
      const a = W.air, at = this.airT;
      if (at < 0.03) this.lead = Math.cos(this.phase * TAU) > 0 ? 1 : -1;        // the leg that was ahead at take-off leads
      // weights of the four poses along the arc
      let wl = sstep(0.16, 0.02, at) * sstep(2, 6, vy), wr = sstep(1.5, 6, vy) * (1 - wl), wf = sstep(-1.5, -8, vy), wa = Math.max(0, 1 - wl - wr - wf);
      const long = sstep(0.75, 1.5, at) * wf, fl = Math.sin(t * 8.5) * long, fl2 = Math.sin(t * 7.3 + 1.3) * long;
      const P4 = (l, r, ap, f) => l * wl + r * wr + ap * wa + f * wf;
      const L = this.lead > 0 ? 'L' : 'R', T = this.lead > 0 ? 'R' : 'L';
      const run = Math.min(1, vl / 5);                    // a running jump is a long stride through the air
      q['thigh' + L + 'x'] = lerp(q['thigh' + L + 'x'], P4(-0.3, -1.35, -1.0 - 0.15 * run, -0.55 - 0.2 * run) + fl * 0.12, a); q['shin' + L + 'x'] = lerp(q['shin' + L + 'x'], P4(0.2, 1.7, 1.25 - 0.3 * run, 0.45), a);
      q['thigh' + T + 'x'] = lerp(q['thigh' + T + 'x'], P4(0.5, 0.45 + 0.25 * run, 0.2 + 0.35 * run, -0.15) - fl * 0.12, a); q['shin' + T + 'x'] = lerp(q['shin' + T + 'x'], P4(0.05, 0.6, 0.85, 0.5), a);
      q['foot' + L + 'x'] = lerp(q['foot' + L + 'x'], P4(0.75, 0.5, 0.35, 0.05), a); q['foot' + T + 'x'] = lerp(q['foot' + T + 'x'], P4(0.9, 0.85, 0.7, 0.15), a);
      q.thighLz = lerp(q.thighLz, 0.05 + 0.1 * wf, a); q.thighRz = lerp(q.thighRz, -0.05 - 0.1 * wf, a);
      // free arm: thrown up at the launch, out at the top, up and wide in the fall; the staff arm swings back, then lifts
      q.armLx = lerp(q.armLx, P4(-2.3, -1.7, -0.5, -0.3) + fl2 * 0.2, a); q.armLz = lerp(q.armLz, P4(0.2, 0.4, 1.15, 1.4) + fl * 0.1, a);
      q.foreLx = lerp(q.foreLx, P4(-0.4, -0.7, -0.35, -0.3), a); q.fingL = lerp(q.fingL, P4(0.6, 0.3, 0.0, 0.1), a);
      q.armRx = lerp(q.armRx, P4(0.5, 0.7, 0.1, -0.4) - fl2 * 0.12, a); q.armRz = lerp(q.armRz, P4(-0.35, -0.5, -0.95, -1.1), a); q.foreRx = lerp(q.foreRx, P4(-0.7, -0.6, -0.5, -0.5), a);
      q.spinex = lerp(q.spinex, P4(-0.16, 0.14 + 0.1 * run, 0.02, 0.14 - 0.12 * run), a); q.chestx = lerp(q.chestx, P4(-0.12, 0.08, -0.06, 0.06), a);
      q.headx = lerp(q.headx, P4(-0.2, -0.15, 0.02, 0.22), a);
      q.hipsy += this.lead * -0.16 * (wr + wa) * a; q.chesty += this.lead * 0.2 * (wr + wa) * a;
      this.airTilt = P4(-0.5, -1.0, -0.35, 0.3);          // the staff trails on the way up and lifts ahead on the way down
    }
    // blink dash: thrown along the way it goes, limbs trailing
    if (W.dash > 0.01) {
      const a = W.dash;
      q.hipsx = lerp(q.hipsx, 0.2 * fz, a); q.spinex = lerp(q.spinex, 0.5 * fz, a); q.chestx = lerp(q.chestx, 0.2 * fz, a); q.headx = lerp(q.headx, -0.55 * fz, a);
      q.spinez = lerp(q.spinez, -0.45 * fx, a); q.hipsz = lerp(q.hipsz, -0.2 * fx, a); q.headz = lerp(q.headz, 0.3 * fx, a);
      q.armLx = lerp(q.armLx, 1.0 * fz, a); q.armRx = lerp(q.armRx, 0.6 * fz, a); q.armLz = lerp(q.armLz, 0.35 + 0.5 * Math.max(0, -fx), a); q.armRz = lerp(q.armRz, -0.35 - 0.5 * Math.max(0, fx), a);
      q.foreLx = lerp(q.foreLx, -0.35, a); q.foreRx = lerp(q.foreRx, -0.6, a);
      q.thighLx = lerp(q.thighLx, -0.85 * fz, a); q.shinLx = lerp(q.shinLx, 1.35, a); q.thighRx = lerp(q.thighRx, 0.55 * fz, a); q.shinRx = lerp(q.shinRx, 0.75, a);
      q.thighLz = lerp(q.thighLz, 0.5 * Math.max(0, fx) + 0.05, a); q.thighRz = lerp(q.thighRz, -0.5 * Math.max(0, -fx) - 0.05, a);
      q.footLx = lerp(q.footLx, 0.6, a); q.footRx = lerp(q.footRx, 0.8, a); q.hipsPY = lerp(q.hipsPY, -0.12, a);
    }
    // glide: hanging from the staff held level overhead in both hands, legs trailing and swinging
    if (W.glide > 0.01) {
      const a = W.glide, C = this.cast;
      if (W.cast < 0.02) { cpMix(C.cur, C.cur, GLIDE, 1 - Math.exp(-dt * 12)); C.init = true; }
      const sw = Math.sin(t * 2.3) * 0.05, bank = clamp(-this.yawRate * 0.3, -0.45, 0.45), drag = clamp(speed * 0.035, 0, 0.4);
      this.swing = damp(this.swing ?? 0, clamp((this.acc.x * Math.sin(this.prevYaw) + this.acc.z * Math.cos(this.prevYaw)) * -0.03, -0.4, 0.4), 3, dt);
      q.hipsx = lerp(q.hipsx, 0.1 + drag * 0.5 + this.swing, a); q.spinex = lerp(q.spinex, -0.06, a); q.chestx = lerp(q.chestx, -0.1, a); q.headx = lerp(q.headx, 0.12 - drag * 0.4, a);
      q.hipsz = lerp(q.hipsz, bank * 0.6, a); q.spinez = lerp(q.spinez, bank * 0.3, a); q.headz = lerp(q.headz, -bank * 0.5, a);
      q.thighLx = lerp(q.thighLx, 0.12 + drag * 0.5 + sw, a); q.thighRx = lerp(q.thighRx, 0.3 + drag * 0.5 - sw, a); q.shinLx = lerp(q.shinLx, 0.55 + sw, a); q.shinRx = lerp(q.shinRx, 0.3 - sw, a);
      q.thighLz = lerp(q.thighLz, 0.04, a); q.thighRz = lerp(q.thighRz, -0.04, a);
      q.footLx = lerp(q.footLx, 0.75, a); q.footRx = lerp(q.footRx, 0.7, a);
      q.fingL = lerp(q.fingL, 1.3, a); q.fingR = lerp(q.fingR, 1.4, a);
      q.clavLz = lerp(q.clavLz, 0.25, a); q.clavRz = lerp(q.clavRz, -0.25, a);
    }
    // collapse: the knees give, the body folds and rolls onto its side, then lies still
    this.deadT = s.dead ? (this.deadT ?? 0) + dt : 0;
    if (W.dead > 0.01 || W.down > 0.01) {
      const a = Math.max(W.dead, W.down), td = s.dead ? this.deadT : 9;
      const k1 = ease(clamp(td / 0.38, 0, 1)), k2 = clamp((td - 0.3) / 0.5, 0, 1), k2e = k2 * k2 * (3 - 2 * k2), settle = Math.exp(-Math.max(0, td - 0.8) * 9) * Math.sin(Math.max(0, td - 0.8) * 22) * 0.04;
      const H = this.hipY;
      q.hipsPY = lerp(q.hipsPY, mix(-H * 0.42 * k1, -(H - 0.13) + settle, k2e), a); q.hipsPX = lerp(q.hipsPX, -0.3 * k2e, a); q.hipsPZ = lerp(q.hipsPZ, -0.08 * k1, a);
      q.hipsz = lerp(q.hipsz, 1.42 * k2e, a); q.hipsx = lerp(q.hipsx, 0.25 * k1 * (1 - k2e), a); q.hipsy = lerp(q.hipsy, -0.35 * k2e, a);
      q.spinex = lerp(q.spinex, 0.45 * k1 - 0.2 * k2e, a); q.chestx = lerp(q.chestx, 0.3 * k1 - 0.1 * k2e, a); q.spinez = lerp(q.spinez, -0.12 * k2e, a);
      q.headx = lerp(q.headx, 0.5 * k1 - 0.2 * k2e, a); q.headz = lerp(q.headz, -0.3 * k2e, a); q.heady = lerp(q.heady, 0.25 * k2e, a);
      q.thighLx = lerp(q.thighLx, -1.0 * k1 + 0.25 * k2e, a); q.shinLx = lerp(q.shinLx, 1.75 * k1 - 0.6 * k2e, a); q.thighRx = lerp(q.thighRx, -0.75 * k1 + 0.4 * k2e, a); q.shinRx = lerp(q.shinRx, 1.6 * k1 - 0.9 * k2e, a);
      q.footLx = lerp(q.footLx, 0.5 * k1, a); q.footRx = lerp(q.footRx, 0.6 * k1, a);
      q.armLx = lerp(q.armLx, 0.25 * k1 - 0.9 * k2e, a); q.armLz = lerp(q.armLz, 0.15 + 0.2 * k2e, a); q.foreLx = lerp(q.foreLx, -0.3 - 0.6 * k2e, a);
      q.armRx = lerp(q.armRx, 0.1 * k1 - 0.5 * k2e, a); q.armRz = lerp(q.armRz, -0.2 - 0.9 * k2e, a); q.foreRx = lerp(q.foreRx, -0.4 - 0.3 * k2e, a);
      q.fingL = lerp(q.fingL, 0.5, a); q.fingR = lerp(q.fingR, 0.6, a); q.jawx = lerp(q.jawx, 0.12 * k2e, a);
    }
  }

  // ---------------------------------------------------------------- people: casting
  // Body channels and the smoothed pose (hands, staff direction) of the running cast clip; the
  // arms are solved to it after the pose is on the bones (update, held pole).
  castPerson(q, dt, s, pitch, kick) {
    const C = this.cast, W = this.w, a = W.cast, S = CAST.stance, T = C.tgt, clip = C.clip;
    this.charge = damp(this.charge, s.charge ?? 0, 18, dt);
    if (C.wt >= 0) C.wt += dt;
    C.rt += dt;
    let two = 0, toes = 0;
    if (clip && C.wt >= 0) {
      // wind-up: into the anticipation, then accelerating into the contact, held until the release
      const u = Math.min(1, C.wt / C.dur), wc = sstep(0.5, 0.92, u);
      cpMix(T, S, clip.A, ease(Math.min(1, u / 0.55)));
      cpMix(T, T, clip.C, wc * wc);
      two = clip.two ? 1 : 0;
    } else if (clip && C.rt < clip.rec + 0.3) {
      const t = C.rt;
      if (clip.beat) {
        // two beats: held at the contact, then the second strike
        cpMix(T, clip.C, clip.F, 1 - Math.exp(-t / clip.tf));
        const w2 = sstep(clip.beat - 0.07, clip.beat + 0.01, t); cpMix(T, T, clip.C2, w2 * w2);
        cpMix(T, T, S, sstep(clip.beat + 0.16, clip.beat + clip.rec, t));
      } else {
        cpMix(T, clip.C, clip.F, 1 - Math.exp(-t / clip.tf));
        cpMix(T, T, S, sstep(clip.tf * 1.6, clip.rec, t));
      }
      two = clip.two ? 1 - sstep(clip.rec * 0.5, clip.rec, t) : 0;
    } else {
      cpMix(T, S, CAST.charged.A, ease(this.charge));
      if (this.charge > 0.9) { const tr = (this.charge - 0.9) * 10; T.h[0] += Math.sin(this.t * 47) * 0.004 * tr; T.h[1] += Math.sin(this.t * 53) * 0.004 * tr; }     // the strain of holding it
    }
    // a bolt (and every release) jabs along the aim and springs back
    T.h[2] += kick * 0.2; T.h[1] += kick * 0.03; T.d[1] -= kick * 0.1; T.cy += kick * 0.3; T.l[2] -= kick * 0.1; T.l[1] -= kick * 0.05; T.cx += kick * 0.1; T.hy -= kick * 0.03;
    // aim up or down: the staff and both hands turn about the shoulders
    const cp_ = Math.cos(pitch * 0.9), sp_ = Math.sin(pitch * 0.9), dy = T.d[1], dz = T.d[2];
    T.d[1] = dy * cp_ + dz * sp_; T.d[2] = dz * cp_ - dy * sp_;
    T.h[1] += pitch * 0.22 * T.h[2] / 0.3; T.l[1] += pitch * 0.18;
    C.two = damp(C.two, two, 20, dt);
    if (C.two > 0.01) for (let i = 0; i < 3; i++) T.l[i] = mix(T.l[i], T.h[i] + T.d[i] * 0.4, C.two);     // the left hand holds the staff too
    // smooth what the clips say (clips can be cut short by the next release at any time)
    const cur = C.cur;
    if (!C.init || a < 0.05 || C.rt === 0) { cpMix(cur, T, T, 0); C.init = true; }
    else cpMix(cur, cur, T, 1 - Math.exp(-dt * 34));
    C.toes = damp(C.toes, clamp(cur.hy / 0.045, 0, 1), 14, dt);
    // body
    q.chesty = lerp(q.chesty, cur.cy * 0.65, a); q.spiney += cur.cy * 0.35 * a; q.hipsy += cur.cy * 0.15 * a;
    q.spinex += cur.cx * 0.55 * a; q.chestx += (cur.cx * 0.45 - pitch * 0.2) * a;
    q.heady -= cur.cy * 0.75 * a; q.headx += (pitch * 0.35 - cur.cx * 0.6) * a;
    q.hipsPY += cur.hy * a; q.hipsPZ += cur.cx * 0.06 * a;
    q.fingR = lerp(q.fingR, 1.4, a); q.thumbR = lerp(q.thumbR, 1.1, a);
    q.fingL = lerp(q.fingL, mix(1.2, -0.1, cur.open) * (1 - C.two) + 1.3 * C.two, a); q.thumbL = lerp(q.thumbL, mix(1, 0.1, cur.open), a);
    q.handLx = lerp(q.handLx, -0.35 * cur.open, a); q.handLz = lerp(q.handLz, -0.2 * cur.open, a);
  }

  // ---------------------------------------------------------------- people: body
  // Idle life and the upper body of the three gaits. The legs come from legIK2 on the same phase
  // (left foot strikes at phase 0, right at 0.5).
  bodyPose(q, dt, s, ph, duty, gw, spn, speed, accF) {
    const st = this.style, W = this.w, t = this.t, I = this.idle, c = this.c;
    const run = W.run, sprint = W.sprint, idle = 1 - W.gait;
    // Acceleration compresses the supporting leg; braking carries the chest back
    // past rest for a short settling beat. Input can lead the hips into a turn.
    const drive = this.drive.step(clamp(accF * 0.012, -0.19, 0.19), dt) * (1 - W.air) * (1 - W.climb) * (1 - W.swim);
    q.hipsPY -= Math.abs(drive) * 0.1;
    q.hipsPZ -= drive * 0.07; q.spinex += drive * 0.45; q.chestx += drive * 0.55; q.headx -= drive * 0.55;
    const intent = s.moveYaw === undefined || s.cast ? 0 : wrapA(s.moveYaw - this.prevYaw);
    q.chesty += clamp(intent * 0.15, -0.2, 0.2) * gw;
    q.heady += clamp(intent * 0.3, -0.35, 0.35) * gw;
    // which way the body travels in its own frame (the player backs away and sidesteps while aiming)
    const vl = Math.hypot(this.velL.x, this.velL.z);
    const fz = vl > 0.3 ? this.velL.z / vl : 1, fx = vl > 0.3 ? this.velL.x / vl : 0;
    const fwd = Math.max(0, fz);
    // --- breathing: quick in, slow out; deeper after a run
    I.breath += dt * (1.75 + 1.4 * I.lean);
    I.lean = damp(I.lean, run * W.gait, run * W.gait > I.lean ? 0.5 : 0.12, dt);        // out of breath: builds while running, fades slowly
    const bph = I.breath, breath = Math.sin(bph) + 0.28 * Math.sin(2 * bph + 0.6), bk = (0.012 + 0.02 * I.lean) * (1 - 0.5 * gw);
    q.chestx -= breath * bk; q.spinex += breath * bk * 0.35; q.neckx += breath * bk * 0.4;
    q.clavLz += breath * bk * 1.3; q.clavRz -= breath * bk * 1.3;
    q.hipsPY += breath * 0.0015 * idle;
    // --- standing weight: settled on one leg, changing sides now and then
    I.sideT -= dt * idle;
    if (I.sideT <= 0) { I.sideT = 5 + rand() * 9; I.side = -I.side * (0.6 + 0.4 * rand()); }
    I.sideV = damp(I.sideV ?? I.side, I.side, 1.4, dt);
    const side = I.sideV * idle * st.sway * (1 - W.talk * 0.4), drift = Math.sin(t * 0.43) * 0.5 + Math.sin(t * 0.19 + 1.3) * 0.5;
    q.hipsPX += (side * 0.04 + drift * 0.006 * idle);
    q.hipsz += side * 0.065; q.hipsPY -= Math.abs(side) * 0.012;
    q.spinez -= side * 0.05 + drift * 0.01 * idle; q.chestz -= side * 0.03; q.neckz += side * 0.02; q.headz += side * 0.03; q.hipsy -= side * 0.06; q.chesty += side * 0.05;
    // now and then something to do with a free hand, a stiff neck or restless feet
    if (idle > 0.9 && !s.talk && !s.sit && !s.kneel && !s.dead && W.cast < 0.05 && W.air < 0.05 && W.swim < 0.05 && W.climb < 0.05 && !this.gestures.length) {
      I.fidT -= dt;
      if (I.fidT <= 0) {
        const kid = c.kid ?? 0, r = rand();
        I.fidT = (8 + rand() * 12) / (1 + 0.8 * kid);
        this.gesture(kid && r < 0.4 ? 'fidBounce' : c.book ? (r < 0.6 ? 'fidLook' : 'fidNeck') : r < 0.28 ? 'fidHip' : r < 0.5 ? 'fidNeck' : r < 0.66 ? 'fidScratch' : 'fidLook', { speed: 1 - 0.25 * (c.age ?? 0) });
      }
    }
    // posture
    q.chestx -= st.hunch * 0.6; q.spinex += st.hunch * 0.5; q.neckx -= st.hunch * 0.2; q.headx -= st.hunch * 0.35;
    // --- arms at rest: elbows a little bent, loose hands, a slow sway of their own
    const hang = st.armHang;
    q.armLz += hang + 0.012 * breath; q.armRz -= hang + 0.012 * breath;
    q.armLx += 0.03 + Math.sin(t * 0.7 + 1) * 0.012 * idle; q.armRx += 0.03 + Math.sin(t * 0.63) * 0.012 * idle;
    q.foreLx -= 0.2; q.foreRx -= 0.2; q.foreLy -= 0.12; q.foreRy += 0.12;
    q.fingL += 0.42; q.fingR += 0.42; q.thumbL += 0.25; q.thumbR += 0.25;
    q.handLz -= 0.06; q.handRz += 0.06; q.handLx += 0.06; q.handRx += 0.06;
    if (gw > 0.001) {
      // --- travel: lean, counter-rotation, bounce
      const sw = Math.cos(ph - 0.2);                 // +1: left leg ahead, so left arm back
      const swF = Math.cos(ph - 0.75);               // forearms and hands trail the upper arms
      const mid = ph - duty * Math.PI, bob = Math.cos(mid * 2);      // +1 at mid-stance of either foot
      const hit = Math.cos(mid * 2 + 0.9);            // just after a foot strikes
      const tw = st.twist ?? 1, arm = st.arm ?? 1, bn = st.bounce ?? 1;
      const slope = this.slope;
      const lean = (0.06 + 0.17 * run + 0.15 * sprint) * fz + clamp(accF * 0.016, -0.16, 0.2) + slope * 0.35;
      this.lean.z = damp(this.lean.z, lean, 9, dt);
      this.lean.x = damp(this.lean.x, fx * (0.03 + 0.07 * run), 9, dt);
      const lz = this.lean.z * gw, lx = this.lean.x * gw;
      q.hipsx += lz * 0.25; q.spinex += lz * 0.4; q.chestx += lz * 0.35;
      q.neckx -= lz * 0.3; q.headx -= lz * 0.5;                                  // the head stays level
      q.spinez -= lx; q.chestz -= lx * 0.5; q.headz += lx * 0.8;
      // the pelvis follows the leading leg, the shoulders go the other way, the head looks ahead
      const hy = -sw * (0.09 + 0.07 * run + 0.04 * sprint) * tw * gw * (0.3 + 0.7 * fwd);
      const cy = sw * (0.1 + 0.12 * run + 0.06 * sprint) * tw * gw * (0.3 + 0.7 * fwd);
      q.hipsy += hy; q.spiney += (cy - hy) * 0.4; q.chesty += (cy - hy) * 0.6;
      q.necky -= cy * 0.35; q.heady -= cy * 0.55;
      // vertical travel: a walk is highest over the supporting leg, a run lowest; the chest and
      // head take each footfall a moment after the hips
      const amp = (0.015 * (1 - run) - (0.03 + 0.004 * sprint) * run) * bn;
      q.hipsPY += (bob * amp - (0.03 * run + 0.02 * sprint)) * gw;
      q.chestx += hit * (0.012 + 0.022 * run) * bn * gw; q.headx -= Math.cos(mid * 2 + 1.7) * (0.01 + 0.02 * run) * (st.head ?? 1) * gw;
      // over the supporting foot: the hips shift and tip, the spine keeps the shoulders level
      const sway = Math.cos(mid) * st.sway * gw;
      q.hipsPX += sway * (0.02 - 0.012 * run);
      q.hipsz += sway * (0.05 - 0.02 * run);
      q.spinez -= sway * (0.035 - 0.01 * run); q.chestz -= sway * 0.012; q.headz += sway * 0.01;
      // --- arms swing from the shoulder, opposite the legs: nearly straight at a walk, folded
      // at a run (the elbow opens behind and closes in front), pumping high in a sprint
      // The whole swing stays in the plane of travel, elbows pointing back (never out); only in
      // front does the forearm turn a little across the body.
      const aA = (mix(0.46, 0.68, run) + 0.2 * sprint) * arm * gw * (0.25 + 0.75 * fwd);
      const aC = (-0.02 + 0.12 * run) * gw;                                      // a runner's swing is centred a little behind the body
      const wFL = 0.5 - 0.5 * swF, wFR = 0.5 + 0.5 * swF;                        // 1 when that forearm is in front
      const fB = mix(0.15, 1.25, run) + 0.2 * sprint, fF = mix(0.5, 1.75, run);  // elbow: open behind, closed in front
      q.armLx += aC + sw * aA; q.armRx += aC - sw * aA;
      q.foreLx = lerp(q.foreLx, -mix(fB, fF, wFL), gw); q.foreRx = lerp(q.foreRx, -mix(fB, fF, wFR), gw);
      q.clavLy -= sw * 0.08 * run * gw; q.clavRy -= sw * 0.08 * run * gw;
      q.armLz -= (0.03 + 0.02 * run) * gw; q.armRz += (0.03 + 0.02 * run) * gw;
      const wUL = 0.5 - 0.5 * sw, wUR = 0.5 + 0.5 * sw;
      q.armLy -= wUL * (0.1 + 0.16 * run) * gw; q.armRy += wUR * (0.1 + 0.16 * run) * gw;
      q.handLx += swF * 0.1 * gw; q.handRx -= swF * 0.1 * gw;
      q.fingL += (0.35 * run + 0.5 * sprint) * gw; q.fingR += (0.35 * run + 0.5 * sprint) * gw; q.thumbL += 0.3 * run * gw; q.thumbR += 0.3 * run * gw;
    } else { this.lean.z = damp(this.lean.z, 0, 9, dt); this.lean.x = damp(this.lean.x, 0, 9, dt); }
    // lean into turns: the whole column banks, the head turns first
    const bank = this.bank.step(clamp(this.yawRate * speed * 0.018, -0.34, 0.34), dt) * gw;
    q.hipsz -= bank * 0.35; q.spinez -= bank * 0.45; q.chestz -= bank * 0.2; q.headz += bank * 0.35;
    q.heady += clamp(this.yawRate * 0.09, -0.4, 0.4); q.chesty += clamp(this.yawRate * 0.03, -0.15, 0.15);
    // --- held things
    const hold = this.hold;
    if (hold && W.climb < 0.5) {
      const sw = Math.cos(ph - 0.2);
      if (hold === 'staff') {
        // standing and walking: upright at the side like a walking staff. Running: carried low
        // along the body, head forward, the arm pumping a little with the stride
        const carry = run * gw;
        q.armRx = mix(-0.1 + q.armRx * 0.3, 0.38 - sw * 0.14 - 0.1 * sprint, carry);
        q.armRz += -0.14 - 0.1 * carry; q.armRy = mix(0, -0.1, carry);
        q.foreRx = mix(-0.98 - Math.max(0, -sw) * 0.14 * gw, -0.95 + sw * 0.1 - 0.12 * sprint, carry);
        q.foreRy = -0.1; q.handRx = 0.1; q.handRz = -0.05;
      } else {
        q.armRx = q.armRx * 0.35 + (hold === 'cane' ? -0.3 : -0.12);
        q.armRz += -0.1;
        q.foreRx = (hold === 'cane' ? -0.95 : -1.3) - 0.25 * run * gw;
        q.foreRy = -0.1; q.handRx = hold === 'cane' ? -0.3 : 0.1; q.handRz = -0.05;
      }
      q.fingR = 1.4; q.thumbR = 1.1;
    }
    if (c.book) { q.armLx = q.armLx * 0.3 - 0.15; q.foreLx = -1.25; q.foreLy = -0.6; q.handLz = 0.25; q.handLx = 0.2; q.fingL = 0.7; }
  }
  // angle of a held pole from upright towards the front (people)
  holdTilt(tilt, ph, gw) {
    const W = this.w, carry = W.run * gw;
    if (this.hold !== 'staff') return tilt + Math.cos(ph) * 0.12 * gw - carry * 0.9 - W.air * 0.5 + W.glide * 1.2;
    tilt += Math.cos(ph - 0.6) * 0.1 * gw * (1 - carry);
    tilt = mix(tilt, 1.27 + 0.08 * W.sprint + Math.cos(ph * 2 - 0.8) * 0.045, carry);
    return mix(tilt, this.airTilt ?? -0.5, W.air);
  }

  // ---------------------------------------------------------------- people: legs
  // Feet stay where they were planted through stance (no sliding) and roll from heel to toe;
  // the swing is shaped (the heel flicks up behind, the knee drives through, the foot waits for
  // the ground before it lands); only supporting legs pull the pelvis down, so a run has flight.
  ankleOf(f, out) {
    const k = this.s * this.root.scale.x, ah = this.L.ankleY * k, bh = ah - 0.056 * k, bd = 0.112 * k, hb = 0.05 * k;
    const p = f.pitch + f.tilt, cp = Math.cos(p), sp = Math.sin(p);
    let fw, y;
    if (p >= 0) { fw = bd * (1 - cp) + (ah - bh) * sp; y = bh + (ah - bh) * cp + bd * sp; }       // on the ball of the foot
    else { fw = -hb * (1 - cp) + ah * sp; y = ah * cp - hb * sp; }                                  // on the heel
    _e1.set(f.slopePitch || 0, f.yaw, f.roll || 0, 'YXZ');
    out.set(0, y, fw).applyEuler(_e1).add(f.pos);
    _e1.order = 'XYZ';
    return out;
  }
  legIK2(dt, speed, freq, duty, gw) {
    const root = this.root, s = this.s, rs = root.scale.x, k = s * rs, B = this.B, st = this.style, W = this.w;
    const run = W.run, sprint = W.sprint;
    const e = root.matrixWorld.elements, ry = root.position.y;
    const fwdX = e[8] / rs, fwdZ = e[10] / rs, sideX = e[0] / rs, sideZ = e[2] / rs;
    const yaw = Math.atan2(fwdX, fwdZ);
    const vh = Math.hypot(this.vel.x, this.vel.z);
    if (vh > 0.3) this.moveDir.set(this.vel.x / vh, 0, this.vel.z / vh); else this.moveDir.set(fwdX, 0, fwdZ);
    const fz = this.moveDir.x * fwdX + this.moveDir.z * fwdZ, fwd = Math.max(0, fz);      // 1 ahead .. -1 backing away
    const D = speed * duty / freq;                             // ground covered during one stance
    const ahead = mix(0.42, 0.36, run) * D;                    // the foot lands nearer the body than it leaves it (most of all at a run)
    const liftH = (mix(0.06, 0.3, run) + 0.1 * sprint) * k * (st.lift ?? 1) * (0.5 + 0.5 * fwd);
    const strike = mix(-0.36, 0.0, run) * fwd + 0.14 * sprint - 0.25 * (1 - fwd) * Math.max(0, -fz);      // heel first at a walk, flat at a run, the ball in a sprint
    // feet fall nearer the line of travel at speed, and wide apart when stepping sideways
    const footW = this.L.hipX * 1.05 * k * (st.base ?? 1) * (1 - (0.25 + 0.3 * run) * fwd * gw) * (1 + 0.9 * Math.abs(this.moveDir.x * sideX + this.moveDir.z * sideZ) * gw);
    const toeOut = (0.13 - 0.06 * gw) * (st.base ?? 1);
    const lean = this.idle.sideV ?? 0;                          // standing weight: +1 on the left leg
    const cs = this.hold === 'staff' && this.castPose ? sstep(0.2, 0.8, W.cast) : 0;
    const moving = gw > 0.12 && speed > 0.2;
    const turning = Math.abs(this.yawRate) > 1.2;
    let stepping = this.feet.some((f) => f.stepping > 0);
    // the ground under the body rises or falls along the way: lean and stride follow it
    this.slope = damp(this.slope, moving && vh > 0.5 ? clamp(this.vel.y / vh, -0.5, 0.5) : 0, 5, dt);
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i], sd = f.side;
      // standing, the free leg rests a little ahead and out, its knee loose
      const free = moving ? 0 : Math.max(0, -sd * lean) * (1 - cs);
      // casting stance: staff side ahead, feet apart
      const rx = sd * (footW + (0.035 * free + 0.05 * cs) * k), rz = ((sd > 0 ? 0.02 : -0.02) + 0.075 * free + (sd > 0 ? -0.12 : 0.17) * cs) * k;
      const restX = e[12] + sideX * rx + fwdX * rz, restZ = e[14] + sideZ * rx + fwdZ * rz;
      if (!f.init) {
        const fw = B['foot' + f.n].getWorldPosition(_v1);
        f.pos.set(fw.x, groundAt(fw.x, fw.z, ry), fw.z); f.plant.copy(f.pos); f.planted = true; f.stepping = 0; f.init = true; f.yaw = yaw + sd * toeOut; f.pitch = 0; f.tilt = 0; f.slopePitch = f.roll = 0;
      }
      if (moving) {
        const pk = (this.phase + (sd > 0 ? 0 : 0.5)) % 1;
        if (pk < duty) {
          if (!f.planted) {
            f.plant.set(f.pos.x, groundAt(f.pos.x, f.pos.z, ry), f.pos.z); f.planted = true; f.yaw = yaw + sd * toeOut * (1 - run);
            if (this.ikW > 0.8) this.footPlants.push(f);
          }
          f.pos.copy(f.plant);
          const ss = pk / duty;
          f.pitch = strike * (1 - sstep(0, mix(0.22, 0.16, run), ss)) + mix(0.78, 1.0, run) * sstep(mix(0.5, 0.28, run), 1, ss) * (0.3 + 0.7 * fwd);
        } else {
          const sg = (pk - duty) / (1 - duty);
          const mx = this.moveDir.x, mz = this.moveDir.z;
          if (f.planted) {
            // toe-off: from here the foot is steered in the body's frame (along and across the way)
            f.planted = false; f.sg0 = Math.min(sg, 0.7); f.p0 = f.pitch; f.from.copy(f.pos);
            const ox = f.pos.x - restX, oz = f.pos.z - restZ;
            f.x0 = ox * mx + oz * mz; f.l0 = oz * mx - ox * mz;
          }
          const u = clamp((sg - f.sg0) / (1 - f.sg0), 0, 1);
          const Tsw = (1 - duty) / freq, remain = (1 - sg) * Tsw;
          const ly = groundAt(restX + mx * ahead + this.vel.x * remain, restZ + mz * ahead + this.vel.z * remain, ry);
          // along the way: the foot trails off the toe, swings through, reaches a little past
          // its landing spot and sweeps back to meet the ground (a runner's retraction)
          const ua = mix(1, 0.84, run), tq = Math.min(1, u / ua), tr = Math.max(0, (u - ua) / (1 - ua + 1e-6));
          const over = run * Math.min(0.17 * k, 0.5 * speed * (1 - ua) * Tsw);
          const s0 = -0.35 * speed * Tsw * ua;
          const t2 = tq * tq, t3 = t2 * tq;
          const xs = f.x0 * (2 * t3 - 3 * t2 + 1) + s0 * (t3 - 2 * t2 + tq) + (ahead + over) * (3 * t2 - 2 * t3) - over * tr * tr;
          const ls = f.l0 * (1 - ease(u));
          const hump = Math.pow(Math.sin(Math.PI * Math.pow(u, mix(1, 0.74, run))), 0.85);
          const sx = restX + mx * xs - mz * ls, sz = restZ + mz * xs + mx * ls;
          // Clear stair noses during swing, without snapping to a new surface at contact.
          const clearance = groundAt(sx, sz, ry);
          f.pos.set(sx, Math.max(mix(f.from.y, ly, ease(u)), clearance) + liftH * hump, sz);
          const flick = (0.2 + 0.6 * run) * Math.sin(Math.PI * Math.min(1, u / 0.5)) * fwd;
          f.pitch = mix(f.p0 + flick, strike, sstep(0.25, 0.88, u));
          f.yaw += wrapA(yaw + sd * toeOut * (1 - run) - f.yaw) * Math.min(1, dt * 14);
        }
        f.tilt = damp(f.tilt, 0, 12, dt);
        f.stepping = 0;
      } else {
        // standing: step to the rest spot when too far off (turning, stopping, pushed)
        if (f.stepping > 0) {
          f.stepping = Math.max(0, f.stepping - dt / f.stepDur);
          const sg = 1 - f.stepping, ee = ease(sg);
          f.to.set(restX, groundAt(restX, restZ, ry), restZ);
          f.pos.set(mix(f.from.x, f.to.x, ee), mix(f.from.y, f.to.y, ee) + 0.06 * k * Math.sin(Math.PI * sg), mix(f.from.z, f.to.z, ee));
          f.pitch = mix(f.p0, 0, sstep(0, 0.5, sg)) + Math.sin(Math.PI * sg) * 0.3;
          f.yaw += wrapA(yaw + sd * toeOut - f.yaw) * ee * 0.5;
          if (f.stepping === 0) { f.plant.copy(f.to); f.planted = true; f.yaw = yaw + sd * toeOut; if (speed > 0.2 && this.ikW > 0.8) this.footPlants.push(f); }
        } else if (!f.planted) { f.from.copy(f.pos); f.p0 = f.pitch; f.stepping = 1; f.stepDur = 0.17; stepping = true; }
        else {
          f.pos.copy(f.plant);
          f.pitch = damp(f.pitch, 0, 10, dt);
          f.tilt = damp(f.tilt, this.cast.toes * 0.5, 16, dt);          // up on the toes (a spell raised overhead)
          const err = Math.hypot(f.plant.x - restX, f.plant.z - restZ), twist = Math.abs(wrapA(f.yaw - yaw - sd * toeOut));
          // (into a casting stance both feet go at once, quickly: a short hop)
          if ((!stepping || cs > 0.5) && (err > 0.085 * k || twist > 0.6 || (turning && (err > 0.06 * k || twist > 0.25)))) { f.from.copy(f.plant); f.p0 = 0; f.stepping = 1; f.stepDur = cs > 0.5 ? 0.13 : turning ? 0.18 : err > 0.2 * k ? 0.24 : 0.36; f.planted = false; stepping = true; }
        }
      }
      // Fit a small sole-sized plane to the same walkable surface as collision.
      // A stair edge is a height discontinuity, not a steep ramp to roll onto.
      const sn = Math.sin(f.yaw), cn = Math.cos(f.yaw), r = 0.09 * k;
      const hf = groundAt(f.pos.x + sn * r, f.pos.z + cn * r, ry), hb = groundAt(f.pos.x - sn * r, f.pos.z - cn * r, ry);
      const hl = groundAt(f.pos.x + cn * r, f.pos.z - sn * r, ry), hr = groundAt(f.pos.x - cn * r, f.pos.z + sn * r, ry);
      const hc = groundAt(f.pos.x, f.pos.z, ry), dh = hf - hb, ds = hl - hr;
      const onGround = f.planted && f.stepping === 0;
      f.slopePitch = damp(f.slopePitch || 0, onGround && Math.abs(hf + hb - 2 * hc) < 0.025 * k && Math.abs(dh) < 0.15 * k ? clamp(-Math.atan2(dh, 2 * r), -0.6, 0.6) : 0, 24, dt);
      f.roll = damp(f.roll || 0, onGround && Math.abs(hl + hr - 2 * hc) < 0.025 * k && Math.abs(ds) < 0.15 * k ? clamp(Math.atan2(ds, 2 * r), -0.45, 0.45) : 0, 24, dt);
    }
    // pelvis: low enough for the supporting legs to reach their ankles (a swinging foot only counts at a walk)
    const hipsB = B.hips;
    const legL = (this.legLen ?? (this.legLen = this.rest.shinL.length() + this.rest.footL.length())) * k * 0.992;
    let drop = 0;
    for (const f of this.feet) {
      B['thigh' + f.n].getWorldPosition(_v1);
      this.ankleOf(f, _v2);
      const h = Math.hypot(_v1.x - _v2.x, _v1.z - _v2.z), dy = _v1.y - _v2.y;
      const need = (h < legL ? dy - Math.sqrt(legL * legL - h * h) : dy) * (f.planted || !moving ? 1 : 1 - run);
      drop = Math.max(drop, need);
    }
    const tgt = -Math.max(0, Math.min(drop, 0.5 * k));
    // Reach is a hard constraint. Smooth the recovery upward, never the correction
    // downward: easing into an unreachable plant makes the ankle skate.
    this.pelvisDrop = tgt < this.pelvisDrop ? tgt : damp(this.pelvisDrop, tgt, 12, dt);
    hipsB.position.y += (this.pelvisDrop * this.ikW) / k;
    hipsB.updateMatrixWorld(true);
    for (const f of this.feet) {
      const th = B['thigh' + f.n], sh = B['shin' + f.n], ft = B['foot' + f.n];
      th.getWorldPosition(_v1);
      this.ankleOf(f, _v2);
      // knees point where the foot points, a little outwards
      _v3.set(_v1.x + Math.sin(f.yaw) + sideX * f.side * 0.05, _v1.y - 0.2, _v1.z + Math.cos(f.yaw) + sideZ * f.side * 0.05);
      ik2(th, sh, ft.position, _v2, _v3, this.ikW);
      _e1.set(f.slopePitch || 0, f.yaw, f.roll || 0, 'YXZ');
      _q1.setFromEuler(_e1).multiply(_q2.setFromAxisAngle(_v4.set(1, 0, 0), f.pitch + f.tilt));
      setWorldQuat(ft, _q1, this.ikW);
      _e1.order = 'XYZ';
      B['toe' + f.n].rotation.x = -Math.max(0, f.pitch + f.tilt) * (f.planted ? 0.95 : 0.3) * this.ikW;
      ft.updateMatrixWorld(true);
    }
  }

  legIK(dt, speed, spn, freq, duty, gw, run) {
    const root = this.root;
    const s = this.s;
    const rs = root.scale.x;
    const B = this.B;
    const e = root.matrixWorld.elements;
    const ry = root.position.y;
    const fwdX = e[8] / rs, fwdZ = e[10] / rs, sideX = e[0] / rs, sideZ = e[2] / rs;
    // move direction in world (from measured velocity if moving)
    const vh = Math.hypot(this.vel.x, this.vel.z);
    if (vh > 0.3) this.moveDir.set(this.vel.x / vh, 0, this.vel.z / vh);
    else this.moveDir.set(fwdX, 0, fwdZ);
    const reach = speed * duty / (2 * freq);
    const lift = mix(0.07, 0.2, run) * s * rs * this.style.lift;
    const ankleH = this.L.ankleY * s * rs;
    const footW = this.L.hipX * 1.05 * s * rs;
    const moving = gw > 0.35 && speed > 0.25;
    const turning = Math.abs(this.yawRate) > 1.2;
    let stepping = this.feet.some((f) => f.stepping > 0);
    for (let k = 0; k < 2; k++) {
      const f = this.feet[k];
      const sd = f.side;
      // rest spot under the hip
      const rx = sd * footW, rz = (sd > 0 ? 0.03 : -0.02) * s * rs;
      const restX = e[12] + sideX * rx + fwdX * rz, restZ = e[14] + sideZ * rx + fwdZ * rz;
      if (!f.init) {
        const fw = B['foot' + f.n].getWorldPosition(_v1);
        f.pos.set(fw.x, groundAt(fw.x, fw.z, ry), fw.z); f.plant.copy(f.pos); f.planted = true; f.stepping = 0; f.init = true;
      }
      if (moving) {
        const pk = (this.phase + (sd > 0 ? 0 : 0.5)) % 1;
        if (pk < duty) {
          if (!f.planted) { f.plant.set(f.pos.x, groundAt(f.pos.x, f.pos.z, ry), f.pos.z); f.planted = true; }
          f.pos.copy(f.plant);
          const ss = pk / duty;
          f.pitch = -0.25 * (1 - sstep(0, 0.18, ss)) + (0.35 + 0.35 * run) * sstep(0.6, 1, ss);
        } else {
          if (f.planted) { f.from.copy(f.pos); f.planted = false; }
          const sg = (pk - duty) / (1 - duty);
          const remain = (1 - sg) * (1 - duty) / freq;
          const lx = restX + this.moveDir.x * reach + this.vel.x * remain, lz = restZ + this.moveDir.z * reach + this.vel.z * remain;
          const ly = groundAt(lx, lz, ry);
          const ee = ease(sg);
          f.pos.set(mix(f.from.x, lx, ee), mix(f.from.y, ly, ee) + lift * Math.pow(Math.sin(Math.PI * sg), 0.8), mix(f.from.z, lz, ee));
          f.pitch = mix(0.7 * (0.5 + run), -0.2, sstep(0, 0.6, sg)) * (1 - sstep(0.85, 1, sg)) - 0.2 * sstep(0.7, 1, sg);
        }
        f.stepping = 0;
      } else {
        // idle: step to the rest spot when too far off (turning, stopping, pushed)
        if (f.stepping > 0) {
          f.stepping = Math.max(0, f.stepping - dt / f.stepDur);
          const sg = 1 - f.stepping;
          const ee = ease(sg);
          f.to.set(restX, groundAt(restX, restZ, ry), restZ);
          f.pos.set(mix(f.from.x, f.to.x, ee), mix(f.from.y, f.to.y, ee) + 0.06 * s * rs * Math.sin(Math.PI * sg), mix(f.from.z, f.to.z, ee));
          f.pitch = Math.sin(Math.PI * sg) * 0.25;
          if (f.stepping === 0) { f.plant.copy(f.to); f.planted = true; }
        } else {
          if (!f.planted) { f.from.copy(f.pos); f.stepping = 1; f.stepDur = 0.16; stepping = true; }
          else {
            f.pos.copy(f.plant);
            f.pitch = damp(f.pitch, 0, 10, dt);
            const err = Math.hypot(f.plant.x - restX, f.plant.z - restZ);
            if (!stepping && (err > 0.17 * s * rs || (turning && err > 0.06 * s * rs))) { f.from.copy(f.plant); f.stepping = 1; f.stepDur = turning ? 0.18 : 0.24; f.planted = false; stepping = true; }
          }
        }
      }
    }
    // pelvis: lower so both ankles are reachable
    const hipsB = B.hips;
    let drop = 0;
    for (const f of this.feet) {
      const th = B['thigh' + f.n];
      th.getWorldPosition(_v1);
      const ax = f.pos.x, ay = f.pos.y + ankleH + Math.max(0, f.pitch) * 0.1 * s * rs, az = f.pos.z;
      const legL = (this.legLen ?? (this.legLen = this.rest['shin' + f.n].length() + this.rest['foot' + f.n].length())) * s * rs * 0.985;
      const h = Math.hypot(_v1.x - ax, _v1.z - az);
      const dy = _v1.y - ay;
      const need = h < legL ? dy - Math.sqrt(legL * legL - h * h) : dy;
      drop = Math.max(drop, need);
    }
    // world-space drop (negative), eased; applied on top of the FK pelvis height
    const tgt = -Math.max(0, Math.min(drop, 0.5 * s * rs));
    this.pelvisDrop = tgt < this.pelvisDrop ? damp(this.pelvisDrop, tgt, 30, dt) : damp(this.pelvisDrop, tgt, 10, dt);
    hipsB.position.y += (this.pelvisDrop * this.ikW) / (s * rs);
    hipsB.updateMatrixWorld(true);
    // IK per leg
    for (const f of this.feet) {
      const th = B['thigh' + f.n], sh = B['shin' + f.n], ft = B['foot' + f.n];
      th.getWorldPosition(_v1);
      _v2.set(f.pos.x, f.pos.y + ankleH + Math.max(0, f.pitch) * 0.1 * s * rs, f.pos.z);
      _v3.set(_v1.x + fwdX * 1 + sideX * f.side * 0.12, _v1.y - 0.2, _v1.z + fwdZ * 1 + sideZ * f.side * 0.12);
      ik2(th, sh, ft.position, _v2, _v3, this.ikW);
      // foot flat on the ground, pitched by the gait
      root.getWorldQuaternion(_q1);
      _e1.set(f.pitch, f.side * 0.08, 0);
      _q2.setFromEuler(_e1);
      _q1.multiply(_q2);
      setWorldQuat(ft, _q1, this.ikW);
      B['toe' + f.n].rotation.x = -Math.max(0, f.pitch) * 0.9 * this.ikW;
      ft.updateMatrixWorld(true);
    }
  }

  hoodCheck() {
    const ha = this.headAnchor;
    if (ha.children.length === this.hatChildren) return;
    this.hatChildren = ha.children.length;
    const hat = ha.children.find((o) => o.name === 'moraHat');
    const B = this.B;
    const up = !hat;
    if (this.T.v2 && this.B.c_hat) this.B.c_hat.scale.setScalar(hat ? 0.86 : 1);     // the crown hair tucks under the hat
    const k = (x) => (x ? 1 : 1e-4);
    if (B.hoodUp) { B.hoodUp.scale.setScalar(k(up)); B.hoodUpN.scale.setScalar(k(up)); B.hoodDn.scale.setScalar(k(!up)); }
    if (B.hairB) B.hairB.scale.setScalar(up ? 0.9 : 1);
    // the hat mesh (player.js) is modelled for a 0.165 m head
    if (hat) { const hs = this.L.hr / 0.158; hat.scale.setScalar(1.12 * hs); hat.position.set(0, 0.03 * hs, -0.008 * hs); }
  }

  // ---------------------------------------------------------------- people: face
  // Expressions on springs (lids lead, brows, mouth and cheeks follow, each with a little
  // overshoot), blinks that come with changes of gaze and feeling, eyes that dart and lead the
  // head, a mouth that shapes the syllables of the line being spoken.
  facePerson(dt, s, typing) {
    const fx = this.fx, fv = this.fv, ft = this.ft, fr = this.fr, W = this.w, F = this.fs, t = this.t, G_ = this.gaze;
    if (this.exprHold > 0) { this.exprHold -= dt; if (this.exprHold <= 0) { this.exprHold = 0; this.setExpression(this.exprPrev); } }
    const h = Math.min(dt, 1 / 30), fade = Math.exp(-dt / 2.4);
    for (const k of EXPR2_KEYS) {
      const w = FACE_W[k] * F.speed;
      fr[k] *= fade;
      fv[k] += (w * w * (ft[k] + fr[k] - fx[k]) - 1.3 * w * fv[k]) * h; fx[k] += fv[k] * h;
    }
    // --- blink: quick to close, slower to open; more while talking, long and heavy when sleepy
    const sleepy = clamp(1 - fx.open * 1.6, 0, 1) * (1 - fx.happy);
    this.blinkT -= dt * (1 + 0.4 * W.talk);
    if (this.blinkT <= 0 && this.blink <= 0) {
      this.blink = 1e-4; this.blinkDur = 0.19 + 0.22 * sleepy + rand() * 0.04;
      this.blinkT = this.dblBlink ? 0.26 : 1.6 + rand() * rand() * 7;
      this.dblBlink = !this.dblBlink && rand() < 0.16;
    }
    let bl = 0;
    if (this.blink > 0) {
      this.blink += dt / this.blinkDur;
      const b = this.blink;
      if (b >= 1) this.blink = 0; else bl = b < 0.3 ? ease(b / 0.3) : b < 0.42 ? 1 : 1 - ease((b - 0.42) / 0.58);
    }
    // --- gaze: small darts all the time; in talk the eyes hold the other's face and break away
    // now and then; larger shifts bring a blink along
    this.eyeT -= dt;
    let lx, ly;
    const lp = this.lookPoint;
    if (this.eyeT <= 0) {
      const px = this.eyeTarget.x, py = this.eyeTarget.y;
      if (lp) { this.eyeT = 0.5 + rand() * 1.6; G_.flip = -G_.flip; this.eyeTarget.set(G_.flip * (0.03 + rand() * 0.05), (rand() - 0.6) * 0.1, 0); }      // from one eye to the other, down to the mouth
      else { this.eyeT = 0.5 + rand() * 2.4; const big = rand() < 0.3 && W.gait < 0.3; this.eyeTarget.set((rand() - 0.5) * (big ? 1.0 : 0.4), (rand() - 0.5) * (big ? 0.5 : 0.22), 0); }
      if (Math.hypot(this.eyeTarget.x - px, this.eyeTarget.y - py) > 0.4 && this.blink <= 0 && rand() < 0.6) this.blinkT = Math.min(this.blinkT, 0.03);
    }
    if (lp) {
      // looking away to think, then back
      G_.awayT -= dt;
      if (G_.awayT <= 0) { G_.awayT = 3 + rand() * 6; G_.away = 0.35 + rand() * 0.6; G_.ax = (rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.3); G_.ay = rand() < 0.6 ? -0.3 - rand() * 0.2 : 0.25; }
      if (G_.away > 0) { G_.away -= dt; if (G_.away <= 0 && rand() < 0.7) this.blinkT = Math.min(this.blinkT, 0.02); }
      this.B.head.getWorldPosition(_v1);
      _v2.subVectors(lp, _v1);
      this.B.head.getWorldQuaternion(_q1).invert();
      _v2.applyQuaternion(_q1);
      lx = clamp(Math.atan2(_v2.x, _v2.z) * 2.5, -1, 1); ly = clamp(Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z)) * 2.5, -1, 1);
      if (G_.away > 0) { lx += G_.ax; ly += G_.ay; }
    } else {
      lx = clamp(((s.lookYaw ?? this.lookYaw) + this.idleLook - (this.headYaw ?? 0)) * 2.2, -1, 1);       // the eyes get there before the head
      ly = clamp(this.lookPitch * 2, -1, 1);
    }
    lx = clamp(lx + this.eyeTarget.x, -1, 1); ly = clamp(ly + this.eyeTarget.y, -1, 1);
    // a turning head carries a blink
    const hv = Math.abs((this.headYaw ?? 0) - (this.headYaw0 ?? 0)) / Math.max(dt, 1e-4); this.headYaw0 = this.headYaw ?? 0;
    if (hv > 2.2 && this.blink <= 0 && this.blinkT > 0.5 && rand() < dt * 6) this.blinkT = 0.02;
    this.eyeLook.x = damp(this.eyeLook.x, lx, 32, dt); this.eyeLook.y = damp(this.eyeLook.y, ly, 32, dt);
    // --- speech: the mouth takes the shape of the syllable being typed, rests on pauses
    const V = this.vis, VT = this.visT;
    if (typing) {
      this.visN -= dt;
      if (this.visN <= 0) {
        this.visN = 0.075 + rand() * 0.035;
        const D = G.dialogue, cur = D && D.cur;
        if (cur && D.charAt) {
          viseme(D.charAt(cur.parsed, Math.max(0, cur.n - 1)) || ' ', VT);
          const stress = 0.75 + rand() * 0.5;
          VT.o *= stress;
          if (VT.o > 0.5 && rand() < 0.35) { this.browFlash = 0.5 + rand() * 0.5; this.nod = 1; }       // a stressed syllable lifts the brows and dips the head
        } else { VT.o = rand() < 0.2 ? 0.05 : 0.2 + rand() * 0.5; VT.r = rand() < 0.3 ? rand() : 0; VT.w = rand() < 0.3 ? rand() : 0; VT.shut = 0; }
      }
    } else { VT.o = 0; VT.r = 0; VT.w = 0; VT.shut = 0; }
    V.shut = damp(V.shut, VT.shut, 40, dt); VT.shut = damp(VT.shut, 0, 14, dt);
    V.o = damp(V.o, VT.o * (1 - V.shut), 24, dt); V.r = damp(V.r, VT.r, 18, dt); V.w = damp(V.w, VT.w, 18, dt);
    this.talkV = V.o;
    this.browFlash = damp(this.browFlash, 0, 5, dt); this.nod = damp(this.nod, 0, 7, dt);
    // --- to the shape keys. Deviations from rest play bigger on a child's face, smaller on an old one
    const A = (k) => X0[k] + (fx[k] - X0[k]) * F.amp;
    const m = this.morph, ix = this.morphIdx, set = (n, v) => { if (ix[n] !== undefined) m[ix[n]] = v; };
    const ex = this.eyeLook.x, ey = this.eyeLook.y;
    const happy = clamp(A('happy'), 0, 1), cheek = clamp(A('cheek'), 0, 1.2);
    // (a resting lid a little lowered suits a child's large eyes; it lifts out of the way of a smile)
    const open = fx.open * (1 - bl) * (1 - W.dead) - F.lid * (1 - bl) * clamp(2 - fx.open * 1.6, 0, 1) * clamp(1 - cheek * 2, 0, 1);
    // closing follows an arc over the eyeball: through the half-closed key to the closed one
    const cl = clamp(clamp(1 - open, 0, 1) * (1 - happy * (1 - bl)) + Math.max(0, -ey) * 0.22, 0, 1);
    set('blinkH', 1 - Math.abs(2 * cl - 1)); set('blink', Math.max(0, 2 * cl - 1));
    set('wide', clamp((open - 1) * 3.2 + Math.max(0, ey) * 0.3, 0, 0.85));
    // tilt and lower lid narrow the eye on top of `open`: together they stop short of shutting it
    const room = clamp(1 - cl * 1.6, 0, 1);
    set('happy', happy * (1 - bl)); set('lidLow', A('lower') * (1 - happy) * (0.45 + 0.55 * room)); set('lidTilt', A('tilt') * (0.5 + 0.5 * room));
    set('cheek', cheek * (1 - 0.6 * happy));         // (laughing eyes: `happy` already carries the lower lid, the upper lashes must stay clear)
    const mo = clamp(A('mOpen') + V.o * (1 - fx.mOpen * 0.6) + W.panic * 0.5, 0, 1.2);
    const sm = A('smile') + F.smile - V.shut * 0.1, asym = clamp(fx.asym + (F.side * 0.6 + Math.sin(t * 0.31 + F.seed) * 0.03 * Math.sign(F.side)) * (1 - happy), -1, 1);
    this.M.skin.userData.skin.uBlushK.value = clamp(fx.blush, 0, 1) * (1 - W.dead);
    set('mOpen', mo);
    set('smileL', clamp(sm * (1 + asym), 0, 1.05)); set('smileR', clamp(sm * (1 - asym), 0, 1.05)); set('smile', clamp(sm, 0, 1));
    set('frown', clamp(-sm, 0, 1));
    set('round', clamp(A('round') + V.r * 0.8 + Math.max(0, 1 - fx.mW) * 1.2, 0, 1)); set('wideM', clamp((fx.mW - 1) * 2.5 + V.w * 0.5, 0, 1));
    set('pout', clamp(A('pout') + V.shut * 0.25, 0, 1)); set('sneer', clamp(A('sneer'), 0, 1));
    const up = A('raise') + this.browFlash * 0.22 + Math.max(0, ey) * 0.18 + Math.sin(t * 0.47 + F.seed * 2) * 0.03, bas = clamp(fx.basym, -1, 1);
    set('browUpL', clamp(up * (1 + bas) + Math.max(0, bas) * 0.5, 0, 1.2)); set('browUpR', clamp(up * (1 - bas) + Math.max(0, -bas) * 0.5, 0, 1.2)); set('browUp', clamp(up, 0, 1));
    set('browDown', clamp(-up, 0, 1) + Math.abs(bas) * 0.15);
    set('browTilt', clamp(A('btilt'), 0, 1)); set('browAngry', clamp(-A('btilt'), 0, 1)); set('browFurrow', clamp(A('furrow'), 0, 1));
    const B = this.B;
    if (B.eyeL) {
      // the eyes rest a few degrees apart: the lid openings sit outside the eyeballs' centres, so
      // parallel eyes read as crossed, most of all when the lids open wide
      const dv = this.c.eyeDiv ?? 0.03;
      B.eyeL.rotation.set(-ey * 0.3, ex * 0.42 + dv, 0); B.eyeR.rotation.set(-ey * 0.3, ex * 0.42 - dv, 0);
      this.M.eye.userData.eye.uEyeR.value.setFromMatrix4(_m1.makeRotationFromEuler(_e1.set(-ey * 0.3, ex * 0.42, 0)));
    }
  }

  updateFace(dt, s, typing) {
    if (this.face2) return this.facePerson(dt, s, typing);
    const u = this.faceU;
    const fx = this.fx, ftg = this.ft;
    if (this.exprHold > 0) { this.exprHold -= dt; if (this.exprHold <= 0) { this.exprHold = 0; this.setExpression(this.exprPrev); } }
    const k = 1 - Math.exp(-dt / 0.08);
    for (const key of EXPR_KEYS) fx[key] += (ftg[key] - fx[key]) * k;
    // blink
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 1; this.blinkT = this.dblBlink ? 0.22 : 2 + rand() * 3.5; this.dblBlink = !this.dblBlink && rand() < 0.2; }
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt / 0.16);
    const bl = this.blink > 0 ? Math.sin(this.blink * Math.PI) : 0;
    // eyes: saccades + look target
    this.eyeT -= dt;
    if (this.eyeT <= 0) { this.eyeT = 0.6 + rand() * 2.2; this.eyeTarget.set((rand() - 0.5) * 0.5, (rand() - 0.5) * 0.3, 0); }
    let lx = this.eyeTarget.x + clamp(((s.lookYaw ?? this.lookYaw) - (this.headYaw ?? 0)) * 2.2, -1, 1);
    let ly = this.eyeTarget.y + clamp(this.lookPitch * 2, -1, 1);
    if (this.lookPoint) {
      this.B.head.getWorldPosition(_v1);
      _v2.subVectors(this.lookPoint, _v1);
      this.B.head.getWorldQuaternion(_q1).invert();
      _v2.applyQuaternion(_q1);
      lx = clamp(Math.atan2(_v2.x, _v2.z) * 2.5, -1, 1); ly = clamp(Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z)) * 2.5, -1, 1);
    }
    this.eyeLook.x = damp(this.eyeLook.x, lx, 25, dt); this.eyeLook.y = damp(this.eyeLook.y, ly, 25, dt);
    // talking mouth: syllable-like noise
    if (typing) {
      this.talkN -= dt;
      if (this.talkN <= 0) { this.talkN = 0.07 + rand() * 0.09; this.talkTo = rand() < 0.2 ? 0.05 : 0.2 + rand() * 0.5; }
      this.talkV = damp(this.talkV, this.talkTo, 22, dt);
    } else this.talkV = damp(this.talkV, 0, 14, dt);
    const open = fx.open * (1 - bl) * (1 - this.w.dead);
    if (this.T.v2) {
      // modelled head: shape keys for the expression, eye bones for the gaze
      const m = this.morph, ix = this.morphIdx, set = (n, v) => { if (ix[n] !== undefined) m[ix[n]] = v; };
      const mo = clamp(fx.mOpen + this.talkV * (1 - fx.mOpen * 0.6) + this.w.panic * 0.5, 0, 1.2);
      const ex = this.eyeLook.x, ey = this.eyeLook.y;
      // closing follows an arc over the eyeball: through the half-closed key to the closed one
      const cl = clamp(clamp(1 - open, 0, 1) * (1 - fx.happy) + Math.max(0, -ey) * 0.22, 0, 1);
      set('blinkH', 1 - Math.abs(2 * cl - 1)); set('blink', Math.max(0, 2 * cl - 1));
      set('wide', clamp((open - 1) * 3.5 + Math.max(0, ey) * 0.3, 0, 1));
      // tilt and lower lid narrow the eye on top of `open`: together they stop short of shutting it
      const room = clamp(1 - cl * 1.6, 0, 1);
      set('happy', fx.happy); set('lidLow', fx.lower * (1 - fx.happy) * (0.45 + 0.55 * room)); set('lidTilt', fx.tilt * (0.5 + 0.5 * room));
      set('mOpen', mo); set('smile', Math.max(0, fx.smile)); set('frown', Math.max(0, -fx.smile));
      set('round', clamp(fx.round + this.talkV * 0.25 + Math.max(0, 1 - fx.mW) * 1.2, 0, 1)); set('wideM', clamp((fx.mW - 1) * 2.5, 0, 1));
      set('browUp', Math.max(0, fx.raise)); set('browDown', Math.max(0, -fx.raise));
      set('browTilt', Math.max(0, fx.btilt)); set('browAngry', Math.max(0, -fx.btilt)); set('browFurrow', fx.furrow);
      const B = this.B;
      if (B.eyeL) {
        // the eyes rest a few degrees apart: the lid openings sit outside the eyeballs' centres, so
        // parallel eyes read as crossed, most of all when the lids open wide
        const dv = this.c.eyeDiv ?? 0.03;
        B.eyeL.rotation.set(-ey * 0.3, ex * 0.42 + dv, 0); B.eyeR.rotation.set(-ey * 0.3, ex * 0.42 - dv, 0);
        this.M.eye.userData.eye.uEyeR.value.setFromMatrix4(_m1.makeRotationFromEuler(_e1.set(-ey * 0.3, ex * 0.42, 0)));
      }
      return;
    }
    if (this.morph) {
      // sculpted head: the expression drives shape keys; only the gaze stays in the shader
      const m = this.morph, ix = this.morphIdx, mo = clamp(fx.mOpen + this.talkV * (1 - fx.mOpen * 0.6) + this.w.panic * 0.5, 0, 1.2);
      m[ix.happy] = fx.happy; m[ix.blink] = clamp(1 - open, 0, 1) * (1 - fx.happy); m[ix.wide] = clamp((open - 1) * 3, 0, 1);
      m[ix.lidTilt] = fx.tilt; m[ix.lidLow] = fx.lower * (1 - fx.happy);
      m[ix.mOpen] = mo; m[ix.smile] = fx.smile; m[ix.round] = fx.round + this.talkV * 0.2 - (fx.mW - 1) * 1.5;
      m[ix.browUp] = fx.raise; m[ix.browTilt] = fx.btilt; m[ix.browFurrow] = fx.furrow;
      u.uLook.value.x = this.eyeLook.x; u.uLook.value.y = this.eyeLook.y;
      return;
    }
    u.uEyeS.value.set(open, fx.tilt, fx.lower, fx.happy);
    u.uLook.value.x = this.eyeLook.x; u.uLook.value.y = this.eyeLook.y;
    u.uBrow.value.x = fx.raise; u.uBrow.value.y = fx.btilt; u.uBrow.value.z = fx.furrow;
    u.uMouth.value.x = clamp(fx.mOpen + this.talkV * (1 - fx.mOpen * 0.6) + this.w.panic * 0.5, 0, 1.2);
    u.uMouth.value.y = fx.smile; u.uMouth.value.w = fx.round + this.talkV * 0.2;
    u.uMouth.value.z = this.T.face.mouthW * fx.mW;
  }
}

// ---------------------------------------------------------------------------
export function makeHumanoid(c = {}) {
  const T = humanType(c);
  return new HumanRig(T, { person: true });
}

// Ghost echo: every mesh switches to a skinned additive fresnel material. A
// depth-only pre-pass (drawn in the transparent queue just before) keeps only the
// frontmost surface, so inner layers (body under clothes) don't show through.
const ghostDepth = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true });
export function makeGhost(rig, color = 0xbfe8ff, alpha = 0.6) {
  const gm = ghostSkinMat(color, alpha);
  const drop = [], meshes = [];
  rig.root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.isOutline) { drop.push(o); return; }
    meshes.push(o);
  });
  for (const o of drop) o.parent.remove(o);
  for (const o of meshes) {
    o.material = gm; o.castShadow = false; o.renderOrder = 11;
    const d = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, ghostDepth) : new THREE.Mesh(o.geometry, ghostDepth);
    if (o.isSkinnedMesh) { d.bind(o.skeleton, o.bindMatrix); d.boundingSphere = o.boundingSphere; }
    d.position.copy(o.position); d.quaternion.copy(o.quaternion); d.scale.copy(o.scale);
    d.renderOrder = 10; d.castShadow = false; d.userData.ghostDepth = true;
    o.parent.add(d);
  }
  rig.ghostMat = gm;
  rig.faceU = null;
  return rig;
}
