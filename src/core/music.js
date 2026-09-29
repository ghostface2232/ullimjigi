// Adaptive procedural music. Each mood is a small sequencer running at
// 8th-note resolution with synthesized instruments. The main leitmotif
// ("골짜기의 노래") appears on the title, in the village, at the bells and
// in the ending.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const R = Math.random;
const choose = (a) => a[Math.floor(R() * a.length)];

// Main theme in D major: [midi|null, length in 8ths]
export const THEME = [
  [69, 2], [74, 2], [76, 2], [78, 2],
  [76, 4], [74, 2], [71, 2],
  [69, 2], [71, 1], [74, 1], [76, 2], [81, 2],
  [78, 6], [null, 2],
  [79, 2], [78, 2], [76, 2], [74, 2],
  [71, 4], [69, 2], [66, 2],
  [67, 2], [69, 2], [71, 2], [76, 2],
  [74, 6], [null, 2],
];
// half-bar chords (root for bass, tones for pad/arp)
const THEME_CHORDS = [
  [38, [62, 66, 69]], [38, [62, 66, 69]],
  [43, [59, 62, 67]], [43, [59, 62, 67]],
  [47, [59, 62, 66]], [45, [57, 61, 64]],
  [38, [62, 66, 69]], [38, [57, 62, 66]],
  [43, [59, 62, 67]], [43, [59, 62, 67]],
  [47, [59, 62, 66]], [47, [59, 62, 66]],
  [40, [59, 64, 67]], [45, [57, 61, 64]],
  [38, [62, 66, 69]], [38, [62, 66, 69]],
];
// Flatten theme to per-8th events
function themeEvents() {
  const ev = []; let s = 0;
  for (const [m, l] of THEME) { if (m) ev.push({ s, m, l }); s += l; }
  return { ev, len: s };
}
const TE = themeEvents();
// Theme note sequence for song seeds
export const THEME_NOTES = THEME.filter((n) => n[0]).map((n) => n[0]);

class Mood {
  constructor(music, def) {
    this.m = music; this.a = music.a; this.def = def;
    const c = this.a.ctx;
    this.out = c.createGain(); this.out.gain.value = 0.0001;
    this.out.connect(this.a.music);
    this.rev = c.createGain(); this.rev.gain.value = def.rev ?? 0.5;
    this.out.connect(this.rev); this.rev.connect(this.a.revIn);
    this.step = 0;
    this.next = c.currentTime + 0.15;
    this.state = {};
    this.alive = true;
    this.out.gain.setTargetAtTime(def.vol ?? 1, c.currentTime, def.fadeIn ?? 1.2);
  }
  get spb() { return 60 / this.def.tempo / 2; }
  schedule() {
    const c = this.a.ctx;
    while (this.next < c.currentTime + 0.3) {
      try { this.def.step(this, this.step, this.next); } catch (e) { console.warn(e); }
      this.next += this.spb;
      this.step++;
    }
  }
  stop(fade = 1.5) {
    const c = this.a.ctx;
    this.out.gain.cancelScheduledValues(c.currentTime);
    this.out.gain.setTargetAtTime(0.0001, c.currentTime, fade / 3);
    this.alive = false;
    setTimeout(() => { try { this.out.disconnect(); this.rev.disconnect(); } catch (_) {} }, fade * 1000 + 3000);
  }

  // ---------- instruments ----------
  voice(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  piano(n, t, v = 0.5, d = 2.4) {
    const c = this.a.ctx, f = mtof(n);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v * 0.16, t + 0.005);
    g.gain.exponentialRampToValueAtTime(v * 0.05, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900 + v * 4200, t);
    lp.frequency.exponentialRampToValueAtTime(500 + v * 700, t + d * 0.7);
    lp.connect(g); g.connect(this.out);
    [[1, 1, 0], [2, 0.38, 3], [3, 0.12, -4], [4, 0.07, 5]].forEach(([h, amp, det]) => {
      const o = c.createOscillator(); o.frequency.value = f * h; o.detune.value = det;
      const pg = c.createGain(); pg.gain.value = amp;
      o.connect(pg); pg.connect(lp); o.start(t); o.stop(t + d + 0.1);
    });
  }
  celesta(n, t, v = 0.4, d = 1.6) {
    const c = this.a.ctx, f = mtof(n);
    const g = c.createGain(); this.voice(g, t, 0.003, v * 0.1, d); g.connect(this.out);
    const o = c.createOscillator(); o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + d + 0.1);
    const g2 = c.createGain(); this.voice(g2, t, 0.002, v * 0.03, d * 0.3); g2.connect(this.out);
    const o2 = c.createOscillator(); o2.frequency.value = f * 4; o2.connect(g2); o2.start(t); o2.stop(t + d);
  }
  pluck(n, t, v = 0.4, d = 0.9) {
    const c = this.a.ctx, f = mtof(n);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(400, t + d);
    const g = c.createGain(); this.voice(g, t, 0.003, v * 0.12, d);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    o.connect(lp); lp.connect(g); g.connect(this.out); o.start(t); o.stop(t + d + 0.1);
  }
  pad(notes, t, d = 4, v = 0.4, bright = 900) {
    const c = this.a.ctx;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = bright; lp.Q.value = 0.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v * 0.05, t + Math.min(1.5, d * 0.35));
    g.gain.setValueAtTime(v * 0.05, t + d * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.2);
    lp.connect(g); g.connect(this.out);
    for (const n of notes) {
      for (const det of [-9, 7]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(t + d + 1.3);
      }
    }
  }
  strings(n, t, d = 0.3, v = 0.5, bright = 1800) {
    const c = this.a.ctx;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = bright; lp.Q.value = 1.2;
    const g = c.createGain(); this.voice(g, t, Math.min(0.03, d * 0.2), v * 0.06, d);
    lp.connect(g); g.connect(this.out);
    for (const det of [-6, 0, 6]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + d + 0.1);
    }
  }
  legato(n, t, d = 1, v = 0.5) {
    const c = this.a.ctx;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v * 0.05, t + 0.12);
    g.gain.setValueAtTime(v * 0.05, t + d * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.4);
    lp.connect(g); g.connect(this.out);
    for (const det of [-8, 0, 8]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det;
      const vib = c.createOscillator(); vib.frequency.value = 5.2; const vg = c.createGain(); vg.gain.value = 4;
      vib.connect(vg); vg.connect(o.detune); vib.start(t); vib.stop(t + d + 0.5);
      o.connect(lp); o.start(t); o.stop(t + d + 0.5);
    }
  }
  bass(n, t, d = 0.5, v = 0.5) {
    const c = this.a.ctx;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    const g = c.createGain(); this.voice(g, t, 0.01, v * 0.22, d);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(n);
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = mtof(n - 12);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.out);
    o.start(t); o2.start(t); o.stop(t + d + 0.1); o2.stop(t + d + 0.1);
  }
  taiko(t, v = 0.8, f = 95) {
    const c = this.a.ctx;
    const g = c.createGain(); this.voice(g, t, 0.003, v * 0.5, 0.45); g.connect(this.out);
    const o = c.createOscillator(); o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.3);
    o.connect(g); o.start(t); o.stop(t + 0.5);
    const s = c.createBufferSource(); s.buffer = this.a.buf.white;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    const g2 = c.createGain(); this.voice(g2, t, 0.002, v * 0.25, 0.1);
    s.connect(lp); lp.connect(g2); g2.connect(this.out); s.start(t, R()); s.stop(t + 0.15);
  }
  hat(t, v = 0.3, d = 0.04) {
    const c = this.a.ctx;
    const s = c.createBufferSource(); s.buffer = this.a.buf.white;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = c.createGain(); this.voice(g, t, 0.002, v * 0.08, d);
    s.connect(hp); hp.connect(g); g.connect(this.out); s.start(t, R()); s.stop(t + d + 0.05);
  }
  choir(notes, t, d = 3, v = 0.5) {
    const c = this.a.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.05, t + 0.8);
    g.gain.setValueAtTime(v * 0.05, t + d * 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 800; f1.Q.value = 4;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 5;
    f1.connect(g); f2.connect(g); g.connect(this.out);
    for (const n of notes) for (const det of [-10, 10]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det;
      o.connect(f1); o.connect(f2); o.start(t); o.stop(t + d + 1.1);
    }
  }
  swell(n, t, d = 2, v = 0.4) {
    const c = this.a.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v * 0.05, t + d);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.15);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(n);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + d + 0.2);
  }
}

// ------------------------------------------------------------------
// Mood definitions
// ------------------------------------------------------------------
const DMAJ_PENTA = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83];
const AMIN_PENTA = [57, 60, 62, 64, 67, 69, 72, 74, 76];

function walker(st, scale, key = 'wi') {
  if (st[key] === undefined) st[key] = Math.floor(scale.length / 2);
  st[key] += choose([-2, -1, -1, 1, 1, 2, 0]);
  if (st[key] < 0) st[key] = 1; if (st[key] >= scale.length) st[key] = scale.length - 2;
  return scale[st[key]];
}

function themePlayer(inst, octave = 0, vel = 0.5) {
  return (m, s, t) => {
    const ts = s % TE.len;
    for (const e of TE.ev) if (e.s === ts) inst(m, e.m + octave, t, vel, e.l * m.spb);
  };
}

const MOODS = {
  silence: { tempo: 60, step() {} },

  title: {
    tempo: 64, rev: 0.7, vol: 1,
    step(m, s, t) {
      const loop = TE.len;
      const ts = s % loop;
      if (s < 16) { if (s === 0) m.pad([50, 57, 62, 66], t, 6, 0.5, 700); return; }
      const s2 = s - 16, t2 = s2 % loop;
      if (t2 % 4 === 0) {
        const ch = THEME_CHORDS[Math.floor(t2 / 4) % THEME_CHORDS.length];
        m.pad(ch[1], t, m.spb * 4.2, 0.45, 800);
        m.piano(ch[0] + 12, t, 0.25, 3);
      }
      for (const e of TE.ev) if (e.s === t2) m.piano(e.m, t, 0.42 + R() * 0.08, e.l * m.spb + 1.2);
      if (Math.floor(s2 / loop) % 2 === 1 && t2 % 2 === 1 && R() < 0.25) m.celesta(choose([81, 83, 86, 88, 90]), t, 0.3);
      void ts;
    },
  },

  field: {
    tempo: 76, rev: 0.65,
    step(m, s, t) {
      const st = m.state;
      const chords = [[38, [62, 66, 69, 73]], [35, [59, 62, 66, 69]], [43, [59, 62, 66, 67]], [45, [57, 62, 64, 66]]];
      if (s % 16 === 0) {
        const ch = chords[Math.floor(s / 16) % 4];
        m.pad(ch[1].map((n) => n - 12), t, m.spb * 16, 0.35, 650);
        if (R() < 0.8) m.piano(ch[0] + 12, t, 0.22, 3.5);
      }
      if (st.frag > 0) {
        const e = TE.ev[st.fragI];
        if (e && e.s - st.fragS === st.frag) { m.piano(e.m, t, 0.4, e.l * m.spb + 1.4); st.fragI++; }
        st.frag++;
        if (!TE.ev[st.fragI] || st.fragI > st.fragEnd) st.frag = 0;
        return;
      }
      if (s % 64 === 32 && R() < 0.5) {
        const start = choose([0, 4, 16]);
        st.fragI = TE.ev.findIndex((e) => e.s >= start * 2); st.fragS = TE.ev[st.fragI].s; st.frag = 1; st.fragEnd = st.fragI + 6;
        const e = TE.ev[st.fragI]; m.piano(e.m, t, 0.4, e.l * m.spb + 1.4); st.fragI++;
        return;
      }
      const p = s % 2 === 0 ? 0.3 : 0.1;
      if (R() < p) {
        const n = walker(st, DMAJ_PENTA);
        m.piano(n, t, 0.28 + R() * 0.18, 2.6);
        if (R() < 0.18) m.piano(n - choose([3, 5, 7]), t + 0.02, 0.2, 2.4);
      }
    },
  },

  night: {
    tempo: 58, rev: 0.75,
    step(m, s, t) {
      const st = m.state;
      const chords = [[41, [57, 60, 64, 65]], [40, [55, 59, 62, 64]], [38, [57, 60, 62, 65]], [45, [57, 60, 64, 67]]];
      if (s % 16 === 0) {
        const ch = chords[Math.floor(s / 16) % 4];
        m.pad(ch[1].map((n) => n - 12), t, m.spb * 16, 0.32, 520);
        m.piano(ch[0] + 12, t, 0.18, 4);
      }
      if (s % 2 === 0 && R() < 0.22) m.piano(walker(st, AMIN_PENTA), t, 0.24 + R() * 0.12, 3);
      if (R() < 0.05) m.celesta(choose([81, 84, 88, 91]), t, 0.22, 2.2);
    },
  },

  village: {
    tempo: 92, rev: 0.45,
    step(m, s, t) {
      const loop = TE.len;
      const t2 = s % loop, pass = Math.floor(s / loop);
      const ch = THEME_CHORDS[Math.floor(t2 / 4) % THEME_CHORDS.length];
      if (t2 % 4 === 0) m.bass(ch[0], t, m.spb * 3.5, 0.45);
      if (t2 % 4 === 2) m.bass(ch[0] + 7, t, m.spb * 1.8, 0.3);
      const arp = [ch[1][0], ch[1][1], ch[1][2], ch[1][1]];
      m.pluck(arp[t2 % 4] - 12, t, 0.3);
      if (t2 % 2 === 1) m.hat(t, 0.25);
      for (const e of TE.ev) if (e.s === t2) {
        m.piano(e.m + (pass % 2 ? 12 : 0), t, 0.42, e.l * m.spb + 0.8);
        if (pass % 2) m.celesta(e.m + 12, t, 0.18, 1.2);
      }
    },
  },

  combat: {
    tempo: 132, rev: 0.3, vol: 0.9, fadeIn: 0.4,
    step(m, s, t) {
      const prog = [[50, [62, 65, 69]], [46, [58, 62, 65]], [48, [60, 64, 67]], [45, [57, 61, 64]]];
      const bar = Math.floor(s / 8) % 4, b = s % 8;
      const ch = prog[bar];
      const pat = [0, 0, 12, 0, 7, 0, 10, 7];
      m.strings(ch[0] + pat[b], t, m.spb * 0.8, 0.55, 1500);
      if (b === 0 || b === 3 || b === 6) m.taiko(t, b === 0 ? 0.9 : 0.6);
      if (b % 2 === 1) m.hat(t, 0.35);
      if (b === 0) { m.bass(ch[0] - 12, t, m.spb * 2.5, 0.6); m.strings(ch[1][2] + 12, t, m.spb * 1.5, 0.35, 2600); }
      if (b === 4) m.bass(ch[0] - 12, t, m.spb * 1.5, 0.45);
      if (Math.floor(s / 32) % 2 === 1 && b === 0) m.legato(ch[1][0] + 12, t, m.spb * 7, 0.5);
    },
  },

  boss: {
    tempo: 144, rev: 0.4, vol: 0.95, fadeIn: 0.6,
    step(m, s, t) {
      const b = s % 8, bar = Math.floor(s / 8) % 4;
      const roots = [40, 41, 40, 43];
      const r = roots[bar];
      const pat = [0, 0, 1, 0, 3, 1, 0, 7];
      m.strings(r + 12 + pat[b], t, m.spb * 0.75, 0.6, 1700);
      if (b === 0 || b === 2 || b === 5) m.taiko(t, b === 0 ? 1 : 0.7, 80);
      if (b === 6) m.taiko(t, 0.5, 120);
      m.hat(t, b % 2 ? 0.4 : 0.2);
      if (b === 0) m.bass(r, t, m.spb * 3, 0.7);
      if (s % 32 === 0) m.choir([r + 24, r + 27, r + 31], t, m.spb * 30, 0.8);
      if (s % 16 === 8) m.legato(r + 24 + choose([0, 1, 3, 7]), t, m.spb * 6, 0.5);
    },
  },

  shrine: {
    tempo: 60, rev: 0.9,
    step(m, s, t) {
      const lyd = [62, 64, 66, 68, 69, 71, 73, 74, 76, 78, 80, 81];
      if (s % 32 === 0) { m.pad([38, 45, 50], t, m.spb * 32, 0.5, 450); m.pad([62, 69, 76], t + 0.5, m.spb * 30, 0.2, 1200); }
      if (R() < 0.12) m.celesta(choose(lyd) + 12, t, 0.2 + R() * 0.15, 2.5);
      if (s % 24 === 12 && R() < 0.5) m.swell(choose([74, 78, 81]), t, 2.5, 0.35);
    },
  },

  rift: {
    tempo: 50, rev: 0.9,
    step(m, s, t) {
      if (s % 24 === 0) { m.pad([26, 27, 38], t, m.spb * 24, 0.6, 300); m.choir([62, 63], t, m.spb * 20, 0.25); }
      if (R() < 0.07) m.celesta(choose([86, 87, 91, 92, 98]), t, 0.12, 3);
      if (s % 16 === 8 && R() < 0.4) m.swell(choose([50, 51, 57]), t, 3, 0.5);
    },
  },

  memory: {
    tempo: 60, rev: 0.85,
    step(m, s, t) {
      const loop = TE.len; const t2 = s % loop;
      if (t2 % 8 === 0) { const ch = THEME_CHORDS[Math.floor(t2 / 4) % 16]; m.pad(ch[1], t, m.spb * 8, 0.35, 600); }
      for (const e of TE.ev) if (e.s === t2) m.celesta(e.m, t, 0.32, e.l * m.spb + 1.5);
    },
  },

  ending: {
    tempo: 70, rev: 0.7,
    step(m, s, t) {
      const loop = TE.len; const t2 = s % loop, pass = Math.floor(s / loop);
      const ch = THEME_CHORDS[Math.floor(t2 / 4) % 16];
      if (t2 % 4 === 0) { m.pad(ch[1], t, m.spb * 4.2, 0.45, 900); m.bass(ch[0], t, m.spb * 3.8, 0.4); }
      m.pluck(ch[1][t2 % 3] + (pass ? 12 : 0), t, 0.2);
      for (const e of TE.ev) if (e.s === t2) {
        if (pass === 0) m.piano(e.m, t, 0.45, e.l * m.spb + 1.2);
        else { m.legato(e.m, t, e.l * m.spb, 0.6); m.piano(e.m + 12, t, 0.25, e.l * m.spb + 1); }
      }
    },
  },
};

export class Music {
  constructor(audio) { this.a = audio; this.cur = null; this.name = null; }
  setMood(name) {
    if (!this.a.ready || name === this.name) return;
    const def = MOODS[name];
    if (!def) return;
    if (this.cur) this.cur.stop(name === 'combat' || name === 'boss' ? 0.8 : 2.2);
    this.name = name;
    this.cur = new Mood(this, def);
  }
  update() { if (this.cur && this.a.ready) this.cur.schedule(); }
}
