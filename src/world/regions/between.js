// Between-lands in the diagonal directions: nameless country crossed on the way somewhere.
export const northeast = {
  id: 'northeast', name: null, en: null,
  dir: -45, lv: 3, music: 'field',
  height: (x, z, f) => 36 + f.b * 20 + f.rg * 18,
  paint: (c, k, f, P) => c.lerp(P.dry, k * 0.5 * (0.45 + f.dry * 0.4)),
};
export const southeast = {
  id: 'southeast', name: null, en: null,
  dir: 45, lv: 2, music: 'field',
  height: (x, z, f) => 18 + f.b * 16 + f.d * 4 + f.rg * 6,   // wooded hills down to the sea
};
export const southwest = {
  id: 'southwest', name: null, en: null,
  dir: 135, lv: 3, music: 'field',
  height: (x, z, f) => 30 + f.b * 18 + f.rg * 16,            // rough headlands
};
