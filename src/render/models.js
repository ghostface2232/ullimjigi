// Authored models (GLB files exported from Blender into public/models/).
// The rest of the game is built in code and synchronously, so every model is loaded once,
// before the world and the characters are made; after that `model(name)` hands out the
// parsed glTF. Each group of assets lists its files in its own manifest
// (public/models/<group>.json: an array of names without ".glb").
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { tier } from './quality.js';

const GROUPS = ['chars', 'monsters', 'props', 'buildings'];
const cache = new Map();
const groupOf = new Map();
// Met only in their own fights: their textures upload when those begin.
const LATE = new Set(['mn_knight', 'mn_warden', 'mn_heart']);

export async function preloadModels() {
  const loader = new GLTFLoader();
  const lists = await Promise.all(GROUPS.map(async (g) => {
    try { const r = await fetch(`./models/${g}.json`); return r.ok ? await r.json() : []; } catch (_) { return []; }
  }));
  lists.forEach((l, i) => l.forEach((n) => groupOf.set(n, GROUPS[i])));
  await Promise.all(lists.flat().map(async (n) => {
    try { cache.set(n, await loader.loadAsync(`./models/${n}.glb`)); } catch (e) { console.warn('model failed to load:', n, e); }
  }));
  const cap = tier().texCap;
  if (cap) await Promise.all([...sources().keys()].map((s) => shrink(s, cap)));
}

// The parsed glTF ({ scene, animations, ... }) or null when the file is missing.
// Clone meshes / skeletons before changing them: the cache is shared.
export const model = (name) => cache.get(name) || null;

// Upload the textures of everything met in free play now, while the loading screen is up:
// the first sight of a new enemy type no longer stalls a frame on it. A decoded image stays
// in the page's memory as long as its texture holds it, and nothing uploads an authored
// texture twice, so the images are closed once on the GPU (their size stays readable).
// Call it once the world and the people are built: sampler settings are fixed at upload.
export function uploadModelTextures(renderer) {
  const late = new Set();
  for (const n of LATE) if (cache.has(n)) textures(cache.get(n), late);
  // monsters are dressed when they spawn and people may first appear later in the story
  // (creatures.js surfaced() and humanrig.js set the same)
  for (const [n, g] of cache) if (groupOf.get(n) === 'monsters' || groupOf.get(n) === 'chars') for (const t of textures(g)) t.anisotropy = Math.max(t.anisotropy, 4);
  for (const [s, texs] of sources()) {
    if (texs.some((t) => late.has(t))) { releaseAfterUpload(s, texs); continue; }
    for (const t of texs) renderer.initTexture(t);
    release(s);
  }
}

function textures(g, out = new Set()) {
  g.scene.traverse((o) => {
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m) for (const k in m) if (m[k] && m[k].isTexture) out.add(m[k]);
    }
  });
  return out;
}
// image source -> the textures drawing from it
function sources() {
  const all = new Set();
  for (const g of cache.values()) textures(g, all);
  const by = new Map();
  for (const t of all) { if (!by.has(t.source)) by.set(t.source, []); by.get(t.source).push(t); }
  return by;
}

// Lower tiers keep the authored look with smaller textures (halving a side quarters the memory).
async function shrink(s, cap) {
  const im = s.data;
  if (!im || typeof createImageBitmap !== 'function' || Math.max(im.width, im.height) <= cap) return;
  const k = cap / Math.max(im.width, im.height);
  try {
    // alpha is a glow mask and normals are data: no premultiplying, no colour conversion
    s.data = await createImageBitmap(im, { resizeWidth: Math.round(im.width * k), resizeHeight: Math.round(im.height * k), resizeQuality: 'high', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    im.close?.();
    s.needsUpdate = true;
  } catch (e) { console.warn('texture resize failed', e); }
}

function release(s) {
  const im = s.data;
  if (!im || !im.close) return;
  const { width, height } = im;
  im.close();
  s.data = { width, height };
}
// Boss textures upload when their fight first draws them. Textures that share an image and
// its sampler settings reuse one upload without reporting it, so such an image is kept.
function releaseAfterUpload(s, texs) {
  const left = new Set(texs);
  for (const t of texs) {
    const prev = t.onUpdate;
    t.onUpdate = (tex) => { if (prev) prev(tex); left.delete(t); if (!left.size) release(s); };
  }
}
