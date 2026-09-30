// 잿빛 들판 (working name): dry grassland and a burnt village site east of the bluffs.
export default {
  id: 'ashfield', name: '잿빛 들판', en: 'ASHEN FIELDS',
  dir: 0, lv: 3, music: 'field',
  climate: { clear: 7, cloudy: 2, rain: 0.6, storm: 0.8 },
  label: [440, 20],
  height: (x, z, f) => 22 + f.b * 12 + f.d * 3,
  // sun-bleached grass
  paint: (c, k, f, P) => c.lerp(P.dry, k * (0.45 + f.dry * 0.4)),
};
