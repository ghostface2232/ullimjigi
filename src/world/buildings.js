// Procedural architecture & set dressing.
import * as THREE from 'three';
import { toon, fresnelMat, glowMat, U } from '../render/materials.js';
import { mulberry32 } from '../core/util.js';

export const MAT = {
  stone: toon(0xb8ad9a, { flat: true, rim: 0.2 }),
  stoneDark: toon(0x8b8377, { flat: true, rim: 0.2 }),
  stoneBlue: toon(0x9aa3ad, { flat: true, rim: 0.25 }),
  plaster: toon(0xf2e4c6, { rim: 0.2 }),
  timber: toon(0x6a4a34, { rim: 0.15 }),
  wood: toon(0x9c7250, { rim: 0.2 }),
  woodLight: toon(0xc49a6c, { rim: 0.2 }),
  roofRed: toon(0xb85a3e, { flat: true, rim: 0.25, side: THREE.DoubleSide }),
  roofTeal: toon(0x3f8088, { flat: true, rim: 0.25, side: THREE.DoubleSide }),
  roofBlue: toon(0x4f68a8, { flat: true, rim: 0.25, side: THREE.DoubleSide }),
  roofPlum: toon(0x7d5690, { flat: true, rim: 0.25, side: THREE.DoubleSide }),
  roofMora: toon(0x3a3f86, { flat: true, rim: 0.45, side: THREE.DoubleSide }),
  bronze: toon(0xc79a4c, { rim: 0.9, emissive: 0x2a1a04 }),
  gold: toon(0xf0c860, { rim: 1, emissive: 0x5a3a08 }),
  cloth: toon(0xd8c8a8, { side: THREE.DoubleSide }),
  clothRed: toon(0xc0473a, { side: THREE.DoubleSide }),
  clothBlue: toon(0x4a6fb0, { side: THREE.DoubleSide }),
  straw: toon(0xd9b86a, { rim: 0.2 }),
  dark: toon(0x2a2420),
  iron: toon(0x4a4a50, { rim: 0.5 }),
  ruin: toon(0xa8a092, { flat: true, rim: 0.2 }),
  ruinMoss: toon(0x7f9a6a, { flat: true, rim: 0.2 }),
  hushRock: toon(0x3a3444, { flat: true, rim: 0.6 }),
};
export const windowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.1, 0.5) });
export const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

function mesh(geo, mat, x = 0, y = 0, z = 0, parent, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (o.rx) m.rotation.x = o.rx; if (o.ry) m.rotation.y = o.ry; if (o.rz) m.rotation.z = o.rz;
  m.castShadow = o.cast ?? true; m.receiveShadow = o.recv ?? true;
  if (parent) parent.add(m);
  return m;
}
export const box = (w, h, d, mat, x, y, z, p, o) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, p, o);
export const cyl = (rt, rb, h, seg, mat, x, y, z, p, o) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, p, o);

function gable(w, d, h, over) {
  const hw = w / 2 + over, hd = d / 2 + over;
  const roof = new THREE.BufferGeometry();
  const r = [
    -hw, 0, -hd, -hw, 0, hd, 0, h, hd, -hw, 0, -hd, 0, h, hd, 0, h, -hd,
    hw, 0, hd, hw, 0, -hd, 0, h, -hd, hw, 0, hd, 0, h, -hd, 0, h, hd,
  ];
  roof.setAttribute('position', new THREE.Float32BufferAttribute(r, 3));
  roof.computeVertexNormals();
  const gh = h * (1 - (w / 2) / hw) * 0 + h;
  const gab = new THREE.BufferGeometry();
  const g = [
    -w / 2, 0, d / 2, w / 2, 0, d / 2, 0, gh * (1 - over / hw * 0.2), d / 2,
    w / 2, 0, -d / 2, -w / 2, 0, -d / 2, 0, gh * (1 - over / hw * 0.2), -d / 2,
  ];
  gab.setAttribute('position', new THREE.Float32BufferAttribute(g, 3));
  gab.computeVertexNormals();
  return { roof, gab };
}

// ------------------------------------------------------------------
export function house(opts = {}) {
  const rnd = mulberry32(opts.seed ?? 1);
  const g = new THREE.Group();
  const w = opts.w ?? 6, d = opts.d ?? 5, wallH = opts.h ?? 3.4;
  const roofMat = opts.roof ?? [MAT.roofRed, MAT.roofTeal, MAT.roofBlue, MAT.roofPlum][Math.floor(rnd() * 4)];
  box(w + 0.3, 0.8, d + 0.3, MAT.stone, 0, 0.2, 0, g);
  box(w, wallH, d, MAT.plaster, 0, 0.6 + wallH / 2, 0, g);
  // timber frame
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.2, wallH, 0.2, MAT.timber, sx * w / 2, 0.6 + wallH / 2, sz * d / 2, g);
  box(w + 0.1, 0.18, 0.12, MAT.timber, 0, 0.6 + wallH * 0.55, d / 2 + 0.02, g);
  box(w + 0.1, 0.18, 0.12, MAT.timber, 0, 0.6 + wallH * 0.55, -d / 2 - 0.02, g);
  box(0.12, 0.18, d + 0.1, MAT.timber, w / 2 + 0.02, 0.6 + wallH * 0.55, 0, g);
  box(0.12, 0.18, d + 0.1, MAT.timber, -w / 2 - 0.02, 0.6 + wallH * 0.55, 0, g);
  box(w + 0.1, 0.2, d + 0.1, MAT.timber, 0, 0.6 + wallH, 0, g);
  // roof
  const rh = opts.roofH ?? w * 0.45;
  const { roof, gab } = gable(w, d, rh, 0.55);
  const rm = mesh(roof, roofMat, 0, 0.6 + wallH, 0, g);
  const gm = mesh(gab, MAT.plaster, 0, 0.6 + wallH, 0, g);
  void rm; void gm;
  box(0.25, 0.25, d + 1.2, MAT.timber, 0, 0.6 + wallH + rh + 0.02, 0, g);
  // door (front +z)
  const doorX = (rnd() - 0.5) * (w - 2.4);
  box(1.1, 2.0, 0.15, MAT.dark, doorX, 0.6 + 1.0, d / 2 + 0.05, g);
  box(1.4, 0.12, 0.6, MAT.timber, doorX, 0.6 + 2.2, d / 2 + 0.3, g);
  box(1.6, 0.25, 0.8, MAT.stoneDark, doorX, 0.2, d / 2 + 0.55, g);
  // windows
  const winY = 0.6 + wallH * 0.62;
  const addWin = (x, z, ry) => {
    const wg = new THREE.Group(); wg.position.set(x, winY, z); wg.rotation.y = ry; g.add(wg);
    box(0.9, 0.9, 0.1, windowMat, 0, 0, 0.02, wg, { cast: false });
    box(1.1, 0.12, 0.2, MAT.timber, 0, -0.52, 0.08, wg);
    box(0.08, 0.95, 0.14, MAT.timber, 0, 0, 0.07, wg);
    box(0.4, 1.0, 0.06, opts.shutter ?? MAT.roofTeal, -0.7, 0, 0.1, wg);
    box(0.4, 1.0, 0.06, opts.shutter ?? MAT.roofTeal, 0.7, 0, 0.1, wg);
    if (rnd() < 0.6) {
      box(1.0, 0.25, 0.35, MAT.wood, 0, -0.68, 0.22, wg);
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), toon([0xff7a9a, 0xffd25a, 0xffffff, 0xb08aff][i % 4]));
        f.position.set(-0.35 + i * 0.23, -0.5, 0.25); wg.add(f);
      }
    }
  };
  const wx = doorX > 0 ? -w / 4 : w / 4;
  addWin(wx, d / 2 + 0.01, 0);
  addWin(0, -d / 2 - 0.01, Math.PI);
  addWin(w / 2 + 0.01, 0, Math.PI / 2);
  if (w > 5.5) addWin(-w / 2 - 0.01, 0, -Math.PI / 2);
  // chimney
  let chimney = null;
  if (opts.chimney !== false) {
    const cx = w * 0.25 * (rnd() < 0.5 ? -1 : 1), cz = -d * 0.2;
    const cy = 0.6 + wallH + rh * 0.55;
    box(0.7, rh * 0.9 + 0.8, 0.7, MAT.stoneDark, cx, cy, cz, g);
    chimney = new THREE.Vector3(cx, cy + rh * 0.45 + 0.5, cz);
  }
  // porch barrels / crates
  if (rnd() < 0.6) cyl(0.35, 0.3, 0.8, 10, MAT.wood, w / 2 + 0.7, 0.4, d / 2 - 0.3, g);
  if (rnd() < 0.5) box(0.7, 0.7, 0.7, MAT.woodLight, -w / 2 - 0.6, 0.35, d / 2 - 0.5, g, { ry: 0.3 });
  g.userData = { w: w + 0.4, d: d + 0.4, height: 0.6 + wallH + rh, chimney };
  return g;
}

// ------------------------------------------------------------------
export function moraTower() {
  const g = new THREE.Group();
  const rnd = mulberry32(99);
  const H = 15;
  const tg = new THREE.CylinderGeometry(3.5, 4.3, H, 14, 6);
  const p = tg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + Math.sin(y * 0.3) * 0.15 + (rnd() - 0.5) * 0.12);
    p.setZ(i, p.getZ(i) + (rnd() - 0.5) * 0.12);
  }
  tg.computeVertexNormals();
  mesh(tg, MAT.stone, 0, H / 2, 0, g);
  cyl(4.6, 4.8, 1.2, 14, MAT.stoneDark, 0, 0.6, 0, g);
  cyl(4.1, 4.1, 0.45, 14, MAT.stoneDark, 0, 6, 0, g);
  // balcony
  const bal = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.12, 6, 28), MAT.timber);
  bal.rotation.x = Math.PI / 2; bal.position.y = H + 0.9; g.add(bal);
  cyl(4.7, 4.7, 0.3, 20, MAT.wood, 0, H, 0, g);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    cyl(0.07, 0.07, 0.9, 5, MAT.timber, Math.cos(a) * 4.6, H + 0.45, Math.sin(a) * 4.6, g);
  }
  // crooked witch-hat roof
  const rg = new THREE.ConeGeometry(5.6, 8, 16, 8, true);
  const rp = rg.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const y = rp.getY(i) + 4, t = y / 8;
    rp.setX(i, rp.getX(i) + t * t * t * 2.4);
    rp.setY(i, rp.getY(i) - Math.sin(t * Math.PI) * 0.4);
  }
  rg.computeVertexNormals();
  mesh(rg, MAT.roofMora, 0, H + 1 + 4, 0, g);
  const brim = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.18, 6, 32), MAT.gold);
  brim.rotation.x = Math.PI / 2; brim.position.y = H + 1.05; g.add(brim);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), glowMat(0xffd88a, 3));
  star.position.set(2.4, H + 1 + 8.3, 0); g.add(star);
  // windows
  for (let i = 0; i < 4; i++) {
    const a = i * 1.6 + 0.4, y = 3.5 + i * 2.8;
    const wm = new THREE.Mesh(new THREE.CircleGeometry(0.55, 16), windowMat);
    const r = 4.3 - (y / H) * 0.8 + 0.05;
    wm.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    wm.lookAt(wm.position.x * 2, y, wm.position.z * 2);
    g.add(wm);
    const fr = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.08, 6, 16), MAT.timber);
    fr.position.copy(wm.position); fr.rotation.copy(wm.rotation); g.add(fr);
  }
  // door facing +x (towards training yard)
  box(0.3, 2.6, 1.6, MAT.dark, 4.25, 1.9, 0, g);
  box(0.5, 0.3, 2.1, MAT.timber, 4.35, 3.3, 0, g);
  box(2.2, 0.35, 2.4, MAT.stoneDark, 5.2, 0.15, 0, g);
  // telescope
  const tel = cyl(0.18, 0.28, 2.4, 8, MAT.bronze, -3, H + 1.6, 1.5, g, { rz: 0.9, rx: 0.3 });
  void tel;
  // annex cottage
  const an = house({ w: 5, d: 4.2, h: 2.8, roof: MAT.roofMora, seed: 5, chimney: true });
  an.position.set(-2, 0, -6.2); an.rotation.y = Math.PI; g.add(an);
  // banners
  const ban = new THREE.Mesh(new THREE.PlaneGeometry(1, 3, 1, 6), MAT.clothBlue);
  ban.position.set(3.7, 10, 2.2); ban.rotation.y = 1.0; g.add(ban);
  // hanging crystal chimes
  const chimes = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.25;
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), glowMat([0xb894ff, 0xff8a3a, 0x7dffc3, 0x8fe3ff, 0xffd84a][i], 2.2));
    c.position.set(Math.cos(a) * 5.2, H + 0.4 - (i % 2) * 0.4, Math.sin(a) * 5.2);
    g.add(c); chimes.push(c);
  }
  g.userData = { chimes, chimney: an.userData.chimney ? an.userData.chimney.clone().applyEuler(an.rotation).add(an.position) : null };
  return g;
}

// ------------------------------------------------------------------
export function bellTower() {
  const g = new THREE.Group();
  box(5.2, 1, 5.2, MAT.stoneDark, 0, 0.5, 0, g);
  box(4.4, 9, 4.4, MAT.stone, 0, 5, 0, g);
  for (const y of [3.5, 7]) box(4.6, 0.3, 4.6, MAT.stoneDark, 0, y, 0, g);
  box(1.4, 2.4, 0.2, MAT.dark, 0, 2.2, 2.25, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.6, 4.2, 0.6, MAT.timber, sx * 1.9, 11.6, sz * 1.9, g);
  box(4.8, 0.4, 4.8, MAT.wood, 0, 9.6, 0, g);
  box(4.8, 0.4, 4.8, MAT.timber, 0, 13.8, 0, g);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 4, 4, 1), MAT.roofTeal);
  roof.position.y = 16; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
  const fin = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), MAT.gold); fin.position.y = 18.3; g.add(fin);
  // bell (lathe)
  const pts = [];
  const prof = [[0, 0], [0.25, 0], [0.4, -0.2], [0.55, -0.9], [0.7, -1.5], [1.05, -2.0], [1.1, -2.15], [0.95, -2.15]];
  for (const [x, y] of prof) pts.push(new THREE.Vector2(x, y));
  const bellGeo = new THREE.LatheGeometry(pts, 20);
  const pivot = new THREE.Group(); pivot.position.y = 13.4; g.add(pivot);
  const bell = new THREE.Mesh(bellGeo, MAT.bronze); bell.castShadow = true; pivot.add(bell);
  const clap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), MAT.iron); clap.position.y = -1.9; pivot.add(clap);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), fresnelMat(0xfff0c0, 0xffc860, { intensity: 1.5, alpha: 0 }));
  glow.position.y = -1.2; pivot.add(glow);
  g.userData = { bell: pivot, glow };
  return g;
}

// ------------------------------------------------------------------
const EL_HEX = { fire: 0xff7a2a, frost: 0x6cd0ff, storm: 0xffd84a, wind: 0x6effc0, arcane: 0xa070ff };
export function shrine(el, runeTex, opts = {}) {
  const g = new THREE.Group();
  const rnd = mulberry32(el.length * 31);
  const stone = el === 'frost' ? MAT.stoneBlue : MAT.ruin;
  cyl(10.5, 11, 0.5, 32, MAT.stoneDark, 0, 0.1, 0, g);
  cyl(9.2, 9.5, 0.6, 32, stone, 0, 0.55, 0, g);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ map: runeTex, color: new THREE.Color(EL_HEX[el]).multiplyScalar(0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.87; g.add(floor);
  // pillars
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + Math.PI / N;
    const broken = opts.ruined ? rnd() < 0.5 : rnd() < 0.15;
    const h = broken ? 1.5 + rnd() * 2.5 : 6;
    const x = Math.cos(a) * 8.2, z = Math.sin(a) * 8.2;
    cyl(0.55, 0.65, h, 8, stone, x, 0.85 + h / 2, z, g);
    box(1.5, 0.4, 1.5, MAT.stoneDark, x, 1.0, z, g);
    if (!broken) {
      box(1.5, 0.45, 1.5, MAT.stoneDark, x, 0.85 + h + 0.2, z, g);
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), glowMat(EL_HEX[el], 1.2));
      orb.position.set(x, 0.85 + h + 0.8, z); g.add(orb);
    } else {
      const chunk = mesh(new THREE.DodecahedronGeometry(0.6, 0), stone, x + rnd() * 2 - 1, 0.4, z + rnd() * 2 - 1, g);
      chunk.rotation.set(rnd() * 3, rnd() * 3, 0);
    }
  }
  // altar
  box(2.6, 0.6, 2.6, MAT.stoneDark, 0, 1.15, 0, g);
  box(1.6, 1.0, 1.6, stone, 0, 1.95, 0, g);
  box(2.0, 0.25, 2.0, MAT.stoneDark, 0, 2.55, 0, g);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), fresnelMat(0xffffff, EL_HEX[el], { intensity: 1.6 }));
  crystal.scale.set(0.8, 1.4, 0.8);
  crystal.position.y = 4.2; g.add(crystal);
  // bell arch (behind altar, -z)
  for (const sx of [-1, 1]) cyl(0.4, 0.45, 5.5, 8, stone, sx * 2, 0.85 + 2.75, -5, g);
  box(5.2, 0.6, 1, MAT.stoneDark, 0, 6.5, -5, g);
  const pts = [[0, 0], [0.18, 0], [0.3, -0.15], [0.38, -0.6], [0.5, -1.0], [0.72, -1.35], [0.76, -1.45], [0.6, -1.45]].map(([x, y]) => new THREE.Vector2(x, y));
  const pivot = new THREE.Group(); pivot.position.set(0, 6.2, -5); g.add(pivot);
  const bell = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), MAT.bronze); bell.castShadow = true; pivot.add(bell);
  // seal dome
  const seal = new THREE.Mesh(new THREE.SphereGeometry(11, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), fresnelMat(0x2a1640, 0x9a6aff, { intensity: 1.1, power: 2.2, side: THREE.DoubleSide }));
  seal.position.y = 0.2; g.add(seal);
  g.userData = { crystal, bell: pivot, seal, floor };
  return g;
}

// ------------------------------------------------------------------
export function lanternStone() {
  const g = new THREE.Group();
  box(1.0, 0.4, 1.0, MAT.stoneDark, 0, 0.2, 0, g);
  cyl(0.22, 0.3, 1.3, 8, MAT.stone, 0, 1.05, 0, g);
  box(0.9, 0.2, 0.9, MAT.stoneDark, 0, 1.8, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.14, 0.7, 0.14, MAT.stone, sx * 0.34, 2.25, sz * 0.34, g);
  const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), flameMat.clone());
  flame.position.y = 2.2; flame.visible = false; g.add(flame);
  const cage = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.0, 0.4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  cage.position.y = 2.25; g.add(cage);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.6, 4), MAT.stoneDark);
  roof.position.y = 2.9; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), MAT.stone); knob.position.y = 3.25; g.add(knob);
  g.userData = { flame, cage, flameY: 2.25 };
  return g;
}

export function brazier() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    cyl(0.06, 0.08, 1.4, 5, MAT.iron, Math.cos(a) * 0.35, 0.65, Math.sin(a) * 0.35, g, { rz: Math.cos(a) * 0.25, rx: -Math.sin(a) * 0.25 });
  }
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.4, 0.5, 12, 1, true), MAT.iron);
  bowl.material = toon(0x4a4a50, { rim: 0.5, side: THREE.DoubleSide });
  bowl.position.y = 1.45; bowl.castShadow = true; g.add(bowl);
  cyl(0.5, 0.5, 0.05, 12, MAT.dark, 0, 1.35, 0, g);
  const coal = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.1, 0.1) }));
  coal.position.y = 1.45; coal.scale.y = 0.5; g.add(coal);
  g.userData = { coal, fireY: 1.6 };
  return g;
}

export function windWheel() {
  const g = new THREE.Group();
  cyl(0.12, 0.16, 3.4, 6, MAT.timber, 0, 1.7, 0, g);
  box(0.5, 0.5, 0.5, MAT.stoneDark, 0, 0.25, 0, g);
  const rotor = new THREE.Group(); rotor.position.set(0, 3.3, 0.25); g.add(rotor);
  cyl(0.18, 0.18, 0.3, 8, MAT.bronze, 0, 0, 0, rotor, { rx: Math.PI / 2 });
  const cols = [MAT.clothRed, MAT.cloth, MAT.clothBlue, MAT.cloth];
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group(); arm.rotation.z = (i / 4) * Math.PI * 2; rotor.add(arm);
    box(0.08, 1.4, 0.06, MAT.timber, 0, 0.75, 0, arm);
    const sail = box(0.5, 1.1, 0.03, cols[i], 0.28, 0.85, 0.02, arm);
    sail.rotation.y = 0.3;
  }
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), glowMat(0x6effc0, 2, { nocache: true, opacity: 0 }));
  rotor.add(glow);
  g.userData = { rotor, glow };
  return g;
}

export function windmill() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 9, 8), MAT.plaster);
  body.position.y = 4.5; body.castShadow = true; g.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.8, 3, 8), MAT.roofRed); roof.position.y = 10.5; roof.castShadow = true; g.add(roof);
  box(1, 2, 0.2, MAT.dark, 0, 1.4, 3.05, g, { rx: -0.1 });
  const rotor = new THREE.Group(); rotor.position.set(0, 8.2, 3.0); g.add(rotor);
  cyl(0.3, 0.3, 0.6, 8, MAT.timber, 0, 0, 0, rotor, { rx: Math.PI / 2 });
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group(); arm.rotation.z = (i / 4) * Math.PI * 2; rotor.add(arm);
    box(0.2, 6, 0.15, MAT.timber, 0, 3, 0.3, arm);
    box(1.4, 4.6, 0.05, MAT.cloth, 0.8, 3.6, 0.35, arm);
  }
  g.userData = { rotor };
  return g;
}

export function well() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 1.1, 14, 1, true), toon(0xb8ad9a, { flat: true, side: THREE.DoubleSide }));
  ring.position.y = 0.55; ring.castShadow = true; g.add(ring);
  cyl(1.1, 1.1, 0.05, 14, new THREE.MeshBasicMaterial({ color: 0x1a3a4a }), 0, 0.7, 0, g);
  for (const sx of [-1, 1]) box(0.18, 2.4, 0.18, MAT.timber, sx * 1.2, 1.7, 0, g);
  const r = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.1, 4), MAT.roofRed); r.position.y = 3.3; r.rotation.y = Math.PI / 4; r.castShadow = true; g.add(r);
  cyl(0.12, 0.12, 2.4, 6, MAT.wood, 0, 2.4, 0, g, { rz: Math.PI / 2 });
  return g;
}

export function stall(color = MAT.clothRed) {
  const g = new THREE.Group();
  box(3, 1, 1.4, MAT.woodLight, 0, 0.5, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.12, 2.6, 0.12, MAT.timber, sx * 1.45, 1.3, sz * 0.65, g);
  const aw = box(3.4, 0.08, 2.0, color, 0, 2.6, 0.2, g); aw.rotation.x = 0.18;
  const fruitCols = [0xe0503a, 0xf0c040, 0x7ab84a, 0xff8a3a];
  for (let i = 0; i < 9; i++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), toon(fruitCols[i % 4]));
    f.position.set(-1.1 + (i % 5) * 0.55, 1.12, -0.3 + Math.floor(i / 5) * 0.4); g.add(f);
  }
  return g;
}

export function fence(len = 4) {
  const g = new THREE.Group();
  const n = Math.max(2, Math.round(len / 1.6));
  for (let i = 0; i <= n; i++) box(0.14, 1.1, 0.14, MAT.timber, -len / 2 + (i / n) * len, 0.55, 0, g);
  box(len, 0.1, 0.08, MAT.wood, 0, 0.85, 0, g);
  box(len, 0.1, 0.08, MAT.wood, 0, 0.45, 0, g);
  return g;
}

export function bench() {
  const g = new THREE.Group();
  box(2, 0.12, 0.55, MAT.wood, 0, 0.5, 0, g);
  box(2, 0.5, 0.08, MAT.wood, 0, 0.85, -0.25, g, { rx: -0.15 });
  for (const sx of [-1, 1]) box(0.1, 0.5, 0.5, MAT.timber, sx * 0.85, 0.25, 0, g);
  return g;
}

export function signpost(texts = []) {
  const g = new THREE.Group();
  cyl(0.08, 0.1, 2.4, 6, MAT.timber, 0, 1.2, 0, g);
  texts.forEach((t, i) => {
    const b = box(1.3, 0.3, 0.06, MAT.woodLight, 0.5, 2.0 - i * 0.4, 0, g);
    b.rotation.y = t.ry || 0;
  });
  return g;
}

export function grave() {
  const g = new THREE.Group();
  const s = box(0.9, 1.3, 0.25, MAT.stoneBlue, 0, 0.6, 0, g, { rx: -0.06 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.25, 12, 1, false, 0, Math.PI), MAT.stoneBlue);
  top.rotation.x = Math.PI / 2; top.rotation.z = Math.PI / 2; top.position.set(0, 1.25, 0); g.add(top);
  void s;
  for (let i = 0; i < 6; i++) {
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), toon([0xffffff, 0x9ad0ff, 0xfff0a0][i % 3]));
    f.position.set(-0.4 + i * 0.16, 0.1, 0.45 + (i % 2) * 0.1); g.add(f);
  }
  return g;
}

export function dummy() {
  const g = new THREE.Group();
  const pivot = new THREE.Group(); g.add(pivot);
  cyl(0.08, 0.1, 2.2, 6, MAT.timber, 0, 1.1, 0, pivot);
  cyl(0.06, 0.06, 1.6, 6, MAT.timber, 0, 1.6, 0, pivot, { rz: Math.PI / 2 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), MAT.straw); head.position.y = 2.3; head.castShadow = true; pivot.add(head);
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.2, 8, 1, true), toon(0x8a6a9a, { side: THREE.DoubleSide })); body.position.y = 1.2; body.rotation.x = Math.PI; body.castShadow = true; pivot.add(body);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.7, 8), MAT.roofMora); hat.position.y = 2.75; hat.rotation.z = 0.3; pivot.add(hat);
  g.userData = { pivot };
  return g;
}

export function targetCrystal(color = 0xb894ff) {
  const g = new THREE.Group();
  const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), fresnelMat(0xffffff, color, { intensity: 1.4 }));
  c.scale.set(0.8, 1.2, 0.8); g.add(c);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.04, 6, 24), glowMat(color, 1.5));
  ring.rotation.x = Math.PI / 2; g.add(ring);
  g.userData = { c, ring };
  return g;
}

export function ruinArch(rnd = Math.random) {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    const h = 5 + rnd() * 2;
    cyl(0.5, 0.6, h, 7, MAT.ruin, sx * 2.2, h / 2, 0, g);
  }
  if (rnd() < 0.6) box(5.6, 0.7, 1.1, MAT.ruinMoss, 0, 6.2, 0, g, { rz: (rnd() - 0.5) * 0.15 });
  return g;
}

export function pillarBroken(h = 3, rnd = Math.random) {
  const g = new THREE.Group();
  cyl(0.55, 0.65, h, 7, rnd() < 0.5 ? MAT.ruin : MAT.ruinMoss, 0, h / 2, 0, g, { rz: (rnd() - 0.5) * 0.1 });
  box(1.4, 0.4, 1.4, MAT.stoneDark, 0, 0.2, 0, g);
  return g;
}

export function riftGate() {
  const g = new THREE.Group();
  const rnd = mulberry32(777);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const h = 7 + rnd() * 9;
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), MAT.hushRock);
    c.scale.set(1.2 + rnd(), h, 1.2 + rnd());
    c.position.set(Math.cos(a) * (26 + rnd() * 4), h * 0.5, Math.sin(a) * (26 + rnd() * 4));
    c.rotation.set((rnd() - 0.5) * 0.5, rnd() * 3, (rnd() - 0.5) * 0.5);
    c.castShadow = true; g.add(c);
    const vein = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), glowMat(0x9a6aff, 2));
    vein.position.copy(c.position); vein.position.y = h * 0.8; g.add(vein);
  }
  // gate
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), MAT.hushRock);
    p.scale.set(1.6, 11, 1.6); p.position.set(sx * 5, 8, -14); p.rotation.z = -sx * 0.18; p.castShadow = true; g.add(p);
  }
  const portalMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uAlpha: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; uniform float uAlpha; varying vec2 vUv;
      void main(){ vec2 p = vUv * 2.0 - 1.0; p.y *= 0.7; float r = length(p); float a = atan(p.y, p.x);
        float sw = sin(a * 5.0 + r * 12.0 - uTime * 2.5) * 0.5 + 0.5;
        float m = smoothstep(1.0, 0.6, r);
        vec3 col = mix(vec3(0.05, 0.02, 0.1), vec3(0.8, 0.5, 1.6), sw * smoothstep(0.1, 0.9, r)) ;
        col += vec3(1.2, 0.9, 2.0) * smoothstep(0.95, 0.85, r) * smoothstep(0.7, 0.85, r);
        gl_FragColor = vec4(col, m * uAlpha); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(9, 14), portalMat);
  portal.position.set(0, 8, -14); g.add(portal);
  const heartAnchor = new THREE.Object3D(); heartAnchor.position.set(0, 7, 0); g.add(heartAnchor);
  g.userData = { portal, heartAnchor };
  return g;
}

export function resonanceTree() {
  // the village's great tree with hanging lanterns
  const g = new THREE.Group();
  const rnd = mulberry32(31337);
  const trunk = new THREE.CylinderGeometry(0.7, 1.4, 7, 10, 6);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.sin(y * 0.8) * 0.25); p.setZ(i, p.getZ(i) + Math.cos(y * 0.6) * 0.2); }
  trunk.computeVertexNormals();
  mesh(trunk, toon(0x6a4e3a, { rim: 0.2 }), 0, 3.5, 0, g);
  const leafMat = toon(0x7fbf5a, { sway: 0.015, swayBase: 5, rim: 0.4 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, r = i === 0 ? 0 : 3 + rnd() * 1.5;
    const s = 2.6 + rnd() * 1.2;
    const b = mesh(new THREE.IcosahedronGeometry(s, 1), leafMat, Math.cos(a) * r, 8 + rnd() * 2 + (i === 0 ? 2 : 0), Math.sin(a) * r, g);
    b.scale.y = 0.8;
  }
  const lanterns = [];
  for (let i = 0; i < 10; i++) {
    const a = rnd() * Math.PI * 2, r = 2.5 + rnd() * 3.5;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), glowMat(0xffc870, 2.5, { nocache: true }));
    l.position.set(Math.cos(a) * r, 5.4 + rnd() * 1.4, Math.sin(a) * r); g.add(l); lanterns.push(l);
  }
  g.userData = { lanterns };
  return g;
}
