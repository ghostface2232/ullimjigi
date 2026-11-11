// Authored models (GLB files exported from Blender into public/models/).
// The rest of the game is built in code and synchronously, so every model is loaded once,
// before the world and the characters are made; after that `model(name)` hands out the
// parsed glTF. Each group of assets lists its files in its own manifest
// (public/models/<group>.json: an array of names without ".glb").
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const GROUPS = ['chars', 'monsters', 'props', 'buildings'];
const cache = new Map();

export async function preloadModels() {
  const loader = new GLTFLoader();
  const lists = await Promise.all(GROUPS.map(async (g) => {
    try { const r = await fetch(`./models/${g}.json`); return r.ok ? await r.json() : []; } catch (_) { return []; }
  }));
  await Promise.all(lists.flat().map(async (n) => {
    try { cache.set(n, await loader.loadAsync(`./models/${n}.glb`)); } catch (e) { console.warn('model failed to load:', n, e); }
  }));
}

// The parsed glTF ({ scene, animations, ... }) or null when the file is missing.
// Clone meshes / skeletons before changing them: the cache is shared.
export const model = (name) => cache.get(name) || null;
