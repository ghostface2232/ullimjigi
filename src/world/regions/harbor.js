// 물결포구 (working name): the southern coast beyond the south pass; the second town will stand here.
export default {
  id: 'harbor', name: '물결포구', en: 'RIPPLE COVE',
  dir: 90, lv: 2, music: 'field',
  climate: { clear: 4, cloudy: 3, rain: 3, storm: 0.8 },
  label: [30, 470],
  height: (x, z, f) => 22 + f.b * 12 + f.d * 4,
};
