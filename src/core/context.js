// Global game context. Every system registers itself here so modules can
// reach each other without long constructor chains.
export const G = {
  time: 0,          // scaled game time (seconds)
  realTime: 0,      // unscaled time
  dt: 0,
  timeScale: 1,
  hitstop: 0,       // seconds of real time remaining in hit-stop
  slowmo: 0,        // seconds of real time remaining in perfect-dodge slow motion (enemies run at 1/4 speed)
  state: 'loading', // loading | title | intro | play
  mode: 'free',     // free | dialogue | cutscene
  paused: false,
  // test switches: ?god (no damage) · ?unseen (enemies ignore you). Also togglable from the console.
  dev: (() => { const q = new URLSearchParams(location.search); return { god: q.has('god'), unseen: q.has('unseen') }; })(),
  settings: {
    master: 80, music: 60, sfx: 90, sens: 100, quality: 'high', invertY: false, ui: 100,
  },
};

export const ELEMENTS = ['arcane', 'fire', 'wind', 'frost', 'storm', 'water'];

export const EL_INFO = {
  arcane: { name: '비전', color: 0xb894ff, core: 0xf1e6ff, css: '#b894ff', desc: '자신의 울림을 그대로 쏘아 보내는 기본 마법.' },
  fire: { name: '화염', color: 0xff7a1a, core: 0xfff0b0, css: '#ff8a3a', desc: '타오르는 노래. 적을 불태워 지속 피해를 입힌다.' },
  wind: { name: '바람', color: 0x5dffb0, core: 0xeafff4, css: '#7dffc3', desc: '흐르는 노래. 적을 밀어내고 띄워 올리며, 주변으로 속성을 퍼뜨린다.' },
  frost: { name: '서리', color: 0x5ccfff, core: 0xffffff, css: '#8fe3ff', desc: '고요한 노래. 한기를 쌓아 적을 얼리고, 수면 위에 얼음 발판을 만든다.' },
  storm: { name: '번개', color: 0xffcf2a, core: 0xfffbe0, css: '#ffd84a', desc: '외치는 노래. 순식간에 적중하며, 젖거나 언 적에게 치명적이다.' },
  water: { name: '물', color: 0x3d8bff, core: 0xd8f0ff, css: '#5aa2ff', desc: '맑게 흐르는 노래. 적을 적셔 번개와 서리에 취약하게 만들고, 불길을 잠재운다.' },
};

// One icon family for the whole interface: a 24-unit grid, single colour (currentColor),
// closed shapes filled with even-odd cut-outs, open shapes drawn with a 2-unit round stroke.
// FI = filled glyph, LI = line glyph; a line glyph may carry filled parts (stroke="none").
const FI = (d) => `<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" stroke="currentColor" stroke-width=".7" stroke-linejoin="round">${d}</svg>`;
const LI = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const P = (d, a = '') => `<path d="${d}"${a}/>`;
const SOLID = ' fill="currentColor" stroke="none"';

// Element glyphs (HUD slots, journal, skill tree, enemy weaknesses and status marks)
export const EL_SVG = {
  arcane: FI(P('M12 1.6Q13 11 22.4 12 13 13 12 22.4 11 13 1.6 12 11 11 12 1.6z') + P('M19 3.4Q19.3 5.7 21.6 6 19.3 6.300 19 8.600 18.700 6.300 16.400 6 18.700 5.700 19 3.400z')),
  fire: FI(P('M12.6 1.700c.3 3.500 2.700 5.200 4.400 7.700 1.200 1.700 2 3.500 2 5.500a7 7 0 0 1-14 0c0-2.500 1.100-4.600 2.900-6.300.1 1.800.8 3 2 3.500-.6-3.700.5-7.200 2.700-10.400zM12 13.300c-1.500 1.700-2.400 2.900-2.400 4.300a2.400 2.400 0 0 0 4.800 0c0-1.400-.9-2.600-2.400-4.300z')),
  wind: LI(P('M3 8.500h10.500a3 3 0 1 0-3-3') + P('M3 12.500h15.500a3 3 0 1 1-3 3') + P('M3 16.500h7a2.500 2.500 0 1 1-2.500 2.500')),
  frost: LI(P('M12 2v20M3.340 7l17.320 10M3.340 17 20.660 7') + P('M9.600 4.300 12 6.600l2.400-2.300M9.600 19.700 12 17.400l2.400 2.300M3.700 11l3.200-.9-.8-3.200M20.300 13l-3.200.9.800 3.200M3.700 13l3.200.9-.8 3.200M20.300 11l-3.200-.9.800-3.200') + P('M12 9.400l2.250 1.300v2.600L12 14.600l-2.250-1.300v-2.600z', SOLID)),
  storm: FI(P('M14 1.600 4.400 13.500h5.900L8.800 22.400 19.600 9.700h-6.300z')),
  water: FI(P('M12 1.700c3.200 4.300 6.800 8 6.800 12.300a6.800 6.800 0 0 1-13.600 0C5.200 9.700 8.800 6 12 1.700zM8.300 13.400H9.900c.2 1.500 1.100 2.500 2.600 2.800v1.600c-2.400-.3-4-1.900-4.200-4.400z')),
};

// Interface glyphs: markers, menu tabs, key hints, states
export const ICON = {
  quest: FI(P('M12 2 20.500 12 12 22 3.500 12zM12 7.600 8.300 12 12 16.400 15.700 12z')),
  side: LI(P('M12 3.200 19.500 12 12 20.800 4.500 12z')),
  diamond: FI(P('M12 3 19.600 12 12 21 4.400 12z')),
  spark: FI(P('M12 2Q12.900 11.100 22 12 12.900 12.900 12 22 11.100 12.900 2 12 11.100 11.100 12 2z')),
  waystone: FI(P('M12 1.800 6.200 7h11.600zM7.800 8.400h8.400v7.200H7.800zM10.300 10.300v3.400h3.400v-3.400zM5.800 17h12.400v2.200H5.800zM8.800 20.400h6.400V22H8.800z')),
  home: FI(P('M12 2.800 2.800 11h2.700v9.400h4.700v-5.600h3.600v5.600h4.700V11h2.700z')),
  tower: FI(P('M7.800 21.200V9.400L6.400 8.200V3.400h2.300v1.900h2.100V3.400h2.400v1.900h2.100V3.400h2.300v4.800l-1.400 1.200v11.800zM10.800 21.200h2.400v-4.600a1.200 1.200 0 0 0-2.400 0z')),
  seed: FI(P('M11 4.200c3.800-.9 6.600.3 8.200 3.200-2.700 1.900-5 2.300-6.400 1.400v8.400a3.500 3.500 0 1 1-1.800-3.060z')),
  player: FI(P('M12 2.400 19.200 20.800 12 16.600 4.800 20.800z')),
  map: LI(P('M3.500 6.200 9 4l6 2.200L20.500 4v13.800L15 20l-6-2.200L3.500 20zM9 4v13.800M15 6.200V20')),
  journal: LI(P('M3.500 5.600c2.900-1.300 5.800-1.200 8.500.6 2.700-1.800 5.600-1.900 8.500-.6v13.200c-2.900-1.300-5.800-1.200-8.500.6-2.700-1.800-5.600-1.900-8.500-.6zM12 6.200v13.200')),
  spellbook: LI(P('M6.500 3h11.500v15H7a2 2 0 0 0 0 4h11') + P('M5 20V4.500A1.500 1.500 0 0 1 6.500 3') + P('M12 6.300Q12.400 10.100 16.200 10.500 12.400 10.900 12 14.700 11.600 10.900 7.800 10.500 11.600 10.100 12 6.300z', SOLID)),
  memory: LI(P('M4 4.500h16v15H4z') + P('M4 16.500l4.600-5.200 3.600 3.900 2.600-2.600 5.200 5') + P('M15.800 7.300a1.500 1.500 0 1 0 .01 0z', SOLID)),
  controls: LI(P('M12 2.800a5.200 5.200 0 0 1 5.200 5.200v8a5.200 5.200 0 0 1-10.400 0V8A5.200 5.200 0 0 1 12 2.800zM12 6.500v4')),
  tree: LI(P('M12 21.200v-6.600M12 14.600 6.200 9.800V7M12 14.600l5.800-4.800V7M12 14.600V8.500') + P('M12 2.600a2.300 2.300 0 1 0 .01 0zM6.200 2.600a2 2 0 1 0 .01 0zM17.800 2.600a2 2 0 1 0 .01 0z', SOLID)),
  settings: LI(P('M3.500 6.500h8M16.500 6.500h4M3.500 12h3M11.500 12h9M3.500 17.500h9.500M18 17.500h2.500') + P('M14 4.300a2.200 2.200 0 1 0 .01 0zM9 9.800a2.200 2.200 0 1 0 .01 0zM15.500 15.300a2.200 2.200 0 1 0 .01 0z', SOLID)),
  resume: FI(P('M7.500 4.200 19.500 12 7.500 19.800z')),
  save: LI(P('M6.500 3.500h11v17.300L12 16.600l-5.500 4.200z') + P('M9.500 8h5M9.500 11.500h5')),
  exit: LI(P('M13.500 4H5.500v16h8M10.500 12h10M17 8.200 20.800 12 17 15.800')),
  lock: FI(P('M7.700 10V7.800a4.300 4.300 0 0 1 8.600 0V10h1.500v10.500H6.200V10zM9.700 10h4.600V7.800a2.300 2.300 0 0 0-4.600 0zM11 13.800v3.200h2v-3.200z')),
  check: LI(P('M4.800 12.600 9.800 17.500 19.400 7')),
  harmony: LI(P('M8.800 6.200a5.800 5.800 0 1 0 .01 0zM15.200 6.200a5.800 5.800 0 1 0 .01 0z')),
  whirl: LI(P('M12 3.500a8.500 8.500 0 1 0 .01 0zM12 8.300a3.700 3.700 0 1 0 .01 0z')),
  point: FI(P('M12 2.200 20.200 9.500 12 21.800 3.800 9.500zM12 5.200 7.300 9.400h9.400zM7.600 11.200 12 17.800l4.400-6.600z')),
  mana: FI(P('M12 2.500 18.500 12 12 21.500 5.500 12z')),
  fork: LI(P('M12 21.500v-7.500M12 14 6 8.500V3.500M12 14l6-5.500V3.500M3.800 5.700 6 3.500l2.200 2.200M15.800 5.700 18 3.500l2.200 2.200')),
  mouseL: LI(P('M12 2.800a5.200 5.200 0 0 1 5.200 5.200v8a5.200 5.200 0 0 1-10.400 0V8A5.200 5.200 0 0 1 12 2.800zM12 2.800v7.700M6.800 10.500h10.400') + P('M11 3.900v5.600H7.800V8A4.200 4.200 0 0 1 11 3.900z', SOLID)),
  mouseR: LI(P('M12 2.800a5.200 5.200 0 0 1 5.200 5.200v8a5.200 5.200 0 0 1-10.400 0V8A5.200 5.200 0 0 1 12 2.800zM12 2.800v7.700M6.800 10.500h10.400') + P('M13 3.900v5.600h3.200V8A4.200 4.200 0 0 0 13 3.900z', SOLID)),
  alert: FI(P('M10.600 3h2.800l-.5 11.500h-1.800zM12 17.200a1.900 1.900 0 1 0 .01 0z')),
  skull: FI(P('M12 2.800a8 8 0 0 1 8 8c0 2.700-1.200 4.700-3 6v3.400H7V16.800c-1.800-1.300-3-3.300-3-6a8 8 0 0 1 8-8zM8.800 9.300a2 2 0 1 0 .01 0zM15.200 9.300a2 2 0 1 0 .01 0zM12 13.500l-1.300 2.500h2.600z')),
};
// A glyph as a small bitmap for canvas drawing (map, minimap): one per name and colour, with a
// dark rim so it reads on any terrain. The SVG is rasterised once (drawing an SVG image straight
// to a canvas would rasterise it again on every call). Returns null for the frame or two the
// image takes to decode; `onReady` is called once when it becomes available.
const ICON_IMG = new Map();
export function iconImage(name, color = '#fff', onReady) {
  const key = name + color;
  let it = ICON_IMG.get(key);
  if (!it) {
    const src = ICON[name] || EL_SVG[name];
    const open = src.slice(0, src.indexOf('>') + 1), inner = src.slice(open.length, -6);
    const svg = open.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" ').replace('0 0 24 24', '-3 -3 30 30')
      + `<style>.rim *{stroke:#0a0c18!important;stroke-width:4.6px!important;fill:#0a0c18!important}</style><g class="rim">${inner}</g>${inner}</svg>`;
    const im = new Image();
    it = { cv: null, wait: [] };
    im.onload = () => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 72;
      cv.getContext('2d').drawImage(im, 0, 0, 72, 72);
      it.cv = cv;
      for (const f of it.wait) f();
      it.wait = null;
    };
    im.src = 'data:image/svg+xml,' + encodeURIComponent(svg.replace(/currentColor/g, color));
    ICON_IMG.set(key, it);
  }
  if (!it.cv && onReady && it.wait && !it.wait.includes(onReady)) it.wait.push(onReady);
  return it.cv;
}
// Fill static markup: <i data-ico="name"> gets its glyph (element names work too)
export function fillIcons(root = document) {
  for (const e of root.querySelectorAll('[data-ico]')) e.innerHTML = ICON[e.dataset.ico] || EL_SVG[e.dataset.ico] || '';
}
