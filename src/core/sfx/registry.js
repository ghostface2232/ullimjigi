// Shared registries for the procedural sound library.
// S: one-shot sounds  — S[name] = function (o), called with `this` = AudioEngine.
// B: baked recipes    — B[name] = { dur, n, stereo, fn(out, i) }; rendered once with
//                       OfflineAudioContext at init, played back as buffers (live fallback
//                       runs the same recipe into the realtime graph until ready).
// L: continuous loops — L[name] = function (inp, o) -> { mod?: AudioParam[] }, see AudioEngine.loop.
export const S = {};
export const B = {};
export const L = {};

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const pick = (a) => a[Math.floor(Math.random() * a.length)];
// D major pentatonic (the theme key), high register for sparkles
export const PENTA = [74, 76, 78, 81, 83, 86, 88, 90, 93, 95, 98];
export const ELS = ['arcane', 'fire', 'frost', 'storm', 'wind', 'water'];

// Voice budget priority: 0 = first to drop, 1 = droppable under heavy load, 2 (default) = always plays.
export const PRIO = {
  step: 0, fizzle: 0, enemy_hurt: 0, ice_spike: 0, zap: 0, sizzle: 0, whoosh: 0, mana_orb: 0,
  splash: 1, steam: 1, gale: 1, chain: 1, hit: 1, hit_flesh: 1, hit_armor: 1, crit: 1, orb_hit: 1, crystal_hum: 1,
};
for (const el of ELS) { PRIO['cast_' + el] = 1; PRIO['impact_' + el] = 1; PRIO['whiz_' + el] = 0; }

// Random pitch spread in semitones so repeated casts/impacts never sound identical.
export const VARY_PREFIX = [['cast_', 0.7], ['impact_', 0.9], ['heavy_', 0.5], ['hit', 1.1], ['enemy_', 0.8], ['react_', 0.4],
  ['charge_', 0.3], ['blast_', 0.45], ['whiz_', 1.2]];
export const VARY = {
  explosion: 0.9, thunder: 1.2, ice_spike: 1.4, gale: 0.8, steam: 0.7, shatter: 0.6, chain: 0.8, overload: 0.6, melt: 0.6, freeze: 0.5, fizzle: 1.2, splash: 1.2,
  crit: 0.5, kill: 0.3, zap: 2, sizzle: 1.5, whoosh: 1.2, orb_hit: 1, brute_slam: 0.6, sword: 1, blink: 0.4, charge: 0.4, weave: 0.2, ult_boom: 0.3,
  crystal_break: 0.5, crystal_hum: 0.15, mana_low: 0, mana_full: 0, mana_orb: 0, levelup_open: 0, skill_pick: 0, skill_unlock_active: 0,
  updraft: 0.4, perfect_dodge: 0.2, ult_cast: 0.2,
};
export function varyFor(name) {
  if (name in VARY) return VARY[name];
  for (const [p, v] of VARY_PREFIX) if (name.startsWith(p)) return v;
  return 0;
}
