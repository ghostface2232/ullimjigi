// Sample-level generators (plain JS) for the texture buffers and reverb impulses.
// Textures are sparse event streams (fire pops, bubbles, ice pings, electric arcs)
// that would cost hundreds of nodes to synthesize live; as looping buffers they
// play through a single BufferSource + filter.

const TAU = Math.PI * 2;
const rnd = Math.random;
const logU = (a, b) => a * Math.pow(b / a, rnd());

function mono(ctx, sec) {
  const sr = ctx.sampleRate;
  const b = ctx.createBuffer(1, Math.floor(sr * sec), sr);
  return { b, d: b.getChannelData(0), sr, n: b.length };
}
// Poisson event times (seconds) at `rate` per second over `sec`
function events(rate, sec) {
  const out = []; let t = -Math.log(1 - rnd()) / rate;
  while (t < sec) { out.push(t); t += -Math.log(1 - rnd()) / rate; }
  return out;
}
// remove DC / rumble and scale to a target peak
function finish(d, peak = 0.9, hp = 0.995) {
  let x1 = 0, y1 = 0, m = 0;
  for (let i = 0; i < d.length; i++) { const y = hp * (y1 + d[i] - x1); x1 = d[i]; y1 = y; d[i] = y; const a = Math.abs(y); if (a > m) m = a; }
  if (m > 0) { const k = peak / m; for (let i = 0; i < d.length; i++) d[i] *= k; }
}

// Fire crackle: sparse pops with power-law loudness, sometimes clustered.
function crackle(ctx) {
  const { b, d, sr, n } = mono(ctx, 3);
  for (const t of events(34, 3)) {
    const burst = rnd() < 0.3 ? 2 + Math.floor(rnd() * 3) : 1;
    let tt = t;
    for (let k = 0; k < burst; k++) {
      const amp = 0.08 + 0.92 * Math.pow(rnd(), 3);
      const len = Math.floor(sr * logU(0.0004, 0.004));
      const i0 = Math.floor(tt * sr);
      const sgn = rnd() < 0.5 ? -1 : 1;
      d[i0 % n] += sgn * amp;
      for (let j = 1; j < len; j++) d[(i0 + j) % n] += (rnd() * 2 - 1) * amp * Math.exp(-j / (len * 0.25));
      tt += logU(0.002, 0.018);
    }
  }
  finish(d, 0.95, 0.99);
  return b;
}
// Fizz: dense tiny pops (sizzle, steam, frying, frost forming).
function fizz(ctx) {
  const { b, d, sr, n } = mono(ctx, 3);
  for (const t of events(650, 3)) {
    const amp = 0.1 + 0.9 * Math.pow(rnd(), 2);
    const len = Math.floor(sr * logU(0.0001, 0.0009)) + 2;
    const i0 = Math.floor(t * sr);
    for (let j = 0; j < len; j++) d[(i0 + j) % n] += (rnd() * 2 - 1) * amp * (1 - j / len);
  }
  finish(d, 0.9, 0.97);
  return b;
}
// Bubbles / droplets: sines with an exponential upward sweep (the physical
// "bloop" of a bubble resonating as it closes at the surface).
function bubbles(ctx) {
  const { b, d, sr, n } = mono(ctx, 4);
  for (const t of events(20, 4)) {
    const f0 = logU(380, 2800);
    const life = logU(0.012, 0.05) * Math.min(1.6, 1000 / f0 + 0.5);
    const rise = 1.4 + rnd() * 1.4;
    const k = Math.log(rise) / life;
    const tau = life * 0.3;
    const amp = 0.15 + 0.85 * Math.pow(rnd(), 1.6);
    const i0 = Math.floor(t * sr), len = Math.floor(life * sr * 1.4);
    let ph = 0;
    for (let j = 0; j < len; j++) {
      const tt = j / sr;
      ph += (TAU * f0 * Math.exp(k * Math.min(tt, life))) / sr;
      const e = Math.min(1, tt / 0.0008) * Math.exp(-tt / tau);
      d[(i0 + j) % n] += Math.sin(ph) * amp * e;
    }
  }
  finish(d, 0.9, 0.995);
  return b;
}
// Tinkle: sparse glassy pings (inharmonic free-bar partials) for ice / sparkle.
function tinkle(ctx) {
  const { b, d, sr, n } = mono(ctx, 3);
  const R = [1, 2.756, 5.404], A = [1, 0.35, 0.16];
  for (const t of events(11, 3)) {
    const f0 = logU(2100, 6200), amp = 0.2 + 0.8 * Math.pow(rnd(), 2), tau = logU(0.03, 0.14);
    const i0 = Math.floor(t * sr), len = Math.floor(tau * 5 * sr);
    for (let p = 0; p < 3; p++) {
      const f = f0 * R[p]; if (f > sr * 0.45) continue;
      const w = (TAU * f) / sr, tp = tau / (1 + p * 1.3), ph0 = rnd() * TAU;
      for (let j = 0; j < len; j++) d[(i0 + j) % n] += Math.sin(ph0 + w * j) * A[p] * amp * Math.exp(-j / (tp * sr));
    }
    d[i0 % n] += (rnd() * 2 - 1) * amp * 0.3;
  }
  finish(d, 0.9, 0.99);
  return b;
}
// Arcs: electric crackle — irregular bursts of dense clicks, occasional big snaps.
function arcs(ctx) {
  const { b, d, sr, n } = mono(ctx, 3);
  let t = 0;
  while (t < 3) {
    const dur = logU(0.004, 0.05), amp = 0.2 + 0.8 * rnd();
    let tt = t;
    while (tt < t + dur) {
      const i0 = Math.floor(tt * sr), a = amp * (0.3 + 0.7 * rnd()), sg = rnd() < 0.5 ? -1 : 1;
      d[i0 % n] += sg * a; d[(i0 + 1) % n] -= sg * a * 0.6; d[(i0 + 2) % n] += sg * a * 0.2;
      tt += logU(0.00015, 0.002);
    }
    if (rnd() < 0.12) { const i0 = Math.floor(t * sr); for (let j = 0; j < 30; j++) d[(i0 + j) % n] += (rnd() * 2 - 1) * Math.exp(-j / 8); }
    t += dur + logU(0.006, 0.09);
  }
  finish(d, 0.9, 0.98);
  return b;
}

export function makeTextures(ctx) {
  return { crackle: crackle(ctx), fizz: fizz(ctx), bubbles: bubbles(ctx), tinkle: tinkle(ctx), arcs: arcs(ctx) };
}

// Stereo reverb impulse: sparse early reflections + decorrelated diffuse tail
// split into three bands with separate decay times (highs die first).
export function makeIR(ctx, o) {
  const { len = 2.8, pre = 0.02, rt = [3, 2.4, 1], fc = [450, 3800], bands = [1, 0.75, 0.32], er = 10, erSpan = 0.08, erGain = 0.5, fade = 0.05 } = o;
  const sr = ctx.sampleRate, N = Math.floor(sr * len);
  const buf = ctx.createBuffer(2, N, sr);
  const a1 = 1 - Math.exp((-TAU * fc[0]) / sr), a2 = 1 - Math.exp((-TAU * fc[1]) / sr);
  const k = rt.map((r) => Math.exp(-6.9078 / (r * sr)));
  const p0 = Math.floor(pre * sr), fadeN = Math.max(1, fade * sr), endN = Math.floor(N * 0.85);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let l1 = 0, l2 = 0, eL = bands[0], eM = bands[1], eH = bands[2];
    for (let i = p0; i < N; i++) {
      const w = rnd() * 2 - 1;
      l1 += a1 * (w - l1); l2 += a2 * (w - l2);
      const j = i - p0;
      let s = l1 * 2.2 * eL + (l2 - l1) * eM + (w - l2) * eH;
      eL *= k[0]; eM *= k[1]; eH *= k[2];
      s *= 1 - Math.exp(-j / (fadeN / 3));
      if (i > endN) s *= 0.5 + 0.5 * Math.cos((Math.PI * (i - endN)) / (N - endN));
      d[i] = s;
    }
    // early reflections: a few distinct taps per channel, slightly smeared and darker
    for (let r = 0; r < er; r++) {
      const ts = pre * 0.4 + Math.pow(rnd(), 1.4) * erSpan;
      const i0 = Math.floor(ts * sr);
      const g = erGain * (0.35 + 0.65 * rnd()) * (rnd() < 0.5 ? -1 : 1) * Math.exp(-ts * 12);
      for (let j = 0; j < 6 && i0 + j < N; j++) d[i0 + j] += g * [1, 0.7, 0.45, 0.25, 0.12, 0.05][j];
    }
  }
  return buf;
}

// Soft master clip: linear up to 0.85, smooth knee to 1.0
export function softClipCurve() {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1, a = Math.abs(x);
    c[i] = Math.sign(x) * (a < 0.85 ? a : 0.85 + 0.15 * Math.tanh((a - 0.85) / 0.15));
  }
  return c;
}
