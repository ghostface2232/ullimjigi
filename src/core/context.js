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
    master: 80, music: 60, sfx: 90, sens: 100, quality: 'high', invertY: false,
  },
};

export const ELEMENTS = ['arcane', 'fire', 'wind', 'frost', 'storm', 'water'];

export const EL_INFO = {
  arcane: { name: '비전', color: 0xb894ff, core: 0xf1e6ff, css: '#b894ff', desc: '자신의 울림을 그대로 쏘아 보내는 기본 마법.' },
  fire: { name: '화염', color: 0xff7a1a, core: 0xfff0b0, css: '#ff8a3a', desc: '타오르는 노래. 적을 불태워 지속 피해를 입힌다.' },
  wind: { name: '바람', color: 0x5dffb0, core: 0xeafff4, css: '#7dffc3', desc: '흐르는 노래. 적을 밀어내고 띄워 올리며, 상태를 퍼뜨린다.' },
  frost: { name: '서리', color: 0x5ccfff, core: 0xffffff, css: '#8fe3ff', desc: '고요한 노래. 한기를 쌓아 적을 얼린다. 물 위에 얼음을 만든다.' },
  storm: { name: '번개', color: 0xffcf2a, core: 0xfffbe0, css: '#ffd84a', desc: '외치는 노래. 순식간에 적중하며, 젖거나 언 적에게 치명적이다.' },
  water: { name: '물', color: 0x3d8bff, core: 0xd8f0ff, css: '#5aa2ff', desc: '되비추는 노래. 적을 적셔 번개와 서리를 부르고, 불을 꺼뜨린다.' },
};

// Inline SVG glyphs for each element (used by HUD & journal)
export const EL_SVG = {
  arcane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6z"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/></svg>',
  fire: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3-1-3 0-6 1-9.5z" opacity=".95"/><path d="M12 13c.5 1.5 2 2.2 2 4a2 2 0 0 1-4 0c0-1 .6-1.8 2-4z" fill="#fff6d0"/></svg>',
  wind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h8a2.5 2.5 0 1 1-2.5 2.5"/></svg>',
  frost: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5M4 10.5l3.3-.8L6.5 6.5M20 13.5l-3.3.8.8 3.2M4 13.5l3.3.8-.8 3.2M20 10.5l-3.3-.8.8-3.2"/></svg>',
  storm: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 2L4 13.5h6.5L9 22l10-12.5h-6.8z"/></svg>',
  water: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5C9 7 5.5 10.6 5.5 14.6a6.5 6.5 0 0 0 13 0C18.5 10.6 15 7 12 2.5z" opacity=".95"/><path d="M9 14.8a3 3 0 0 0 3 3" fill="none" stroke="#e6f4ff" stroke-width="1.6" stroke-linecap="round"/></svg>',
};
