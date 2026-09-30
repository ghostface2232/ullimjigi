// What the player has seen of the world, for the map's fog. The map is split into CELL-metre
// cells; walking (or gliding) reveals the cells within REVEAL metres. The vale is known from
// the start: it is home. Saved as a base64 bitset (about 1 KB).
import { G } from '../core/context.js';

const CELL = 16;
const REVEAL = 90;       // metres around the player
const HOME_R = 236;      // the vale and its ring

export class Atlas {
  constructor(terrain) {
    this.half = terrain.half;
    this.n = Math.ceil(terrain.size / CELL);
    this.bits = new Uint8Array(this.n * this.n);
    this.t = 0;
    this.version = 0;    // bumped when something new is revealed (the map redraws its fog)
    this.mask = null;    // n×n canvas, opaque where revealed
    this.reset();
  }

  reset() {
    this.bits.fill(0);
    const n = this.n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * CELL - this.half, z = (j + 0.5) * CELL - this.half;
      if (Math.hypot(x, z) < HOME_R) this.bits[j * n + i] = 1;
    }
    this.version++;
  }

  cell(x, z) {
    const i = Math.floor((x + this.half) / CELL), j = Math.floor((z + this.half) / CELL);
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i;
  }
  seen(x, z) { const c = this.cell(x, z); return c >= 0 && this.bits[c] === 1; }

  // Reveal everything within r metres of (x, z) (also used by lookouts later).
  reveal(x, z, r = REVEAL) {
    const n = this.n, i0 = Math.max(0, Math.floor((x - r + this.half) / CELL)), i1 = Math.min(n - 1, Math.floor((x + r + this.half) / CELL));
    const j0 = Math.max(0, Math.floor((z - r + this.half) / CELL)), j1 = Math.min(n - 1, Math.floor((z + r + this.half) / CELL));
    let fresh = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i;
      if (this.bits[k]) continue;
      const cx = (i + 0.5) * CELL - this.half, cz = (j + 0.5) * CELL - this.half;
      if (Math.hypot(cx - x, cz - z) < r) { this.bits[k] = 1; fresh++; }
    }
    if (fresh) this.version++;
    return fresh;
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0 || !G.player) return;
    this.t = 0.5;
    const p = G.player.pos;
    // from high up you see further
    const r = REVEAL + Math.min(80, Math.max(0, p.y - G.world.h(p.x, p.z)) * 0.8);
    // ask for an autosave now and then while exploring, not on every new cell
    this.pending = (this.pending || 0) + this.reveal(p.x, p.z, r);
    if (this.pending > 60 && G.story) { G.story.dirty = true; this.pending = 0; }
  }

  // Revealed cells as a canvas covering the whole map (opaque = seen), four pixels per cell
  // and blurred so the fog has soft, rounded edges. Rebuilt when something changed.
  maskCanvas() {
    if (this.mask && this.maskV === this.version) return this.mask;
    const n = this.n, U = 4;
    const lo = (this.maskLo ||= Object.assign(document.createElement('canvas'), { width: n, height: n }));
    const lg = lo.getContext('2d'), img = lg.createImageData(n, n);
    for (let k = 0; k < n * n; k++) { img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = 255; img.data[k * 4 + 3] = this.bits[k] ? 255 : 0; }
    lg.putImageData(img, 0, 0);
    const c = (this.mask ||= Object.assign(document.createElement('canvas'), { width: n * U, height: n * U }));
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.filter = `blur(${U * 0.9}px)`;
    g.imageSmoothingEnabled = true;
    g.drawImage(lo, 0, 0, c.width, c.height);
    g.filter = 'none';
    this.maskV = this.version;
    return c;
  }

  save() {
    const n = this.bits.length, bytes = new Uint8Array(Math.ceil(n / 8));
    for (let k = 0; k < n; k++) if (this.bits[k]) bytes[k >> 3] |= 1 << (k & 7);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return { cell: CELL, n: this.n, bits: btoa(s) };
  }
  load(d) {
    this.reset();
    if (!d || d.cell !== CELL || d.n !== this.n || !d.bits) return;
    const s = atob(d.bits);
    for (let k = 0; k < this.bits.length; k++) if ((s.charCodeAt(k >> 3) >> (k & 7)) & 1) this.bits[k] = 1;
    this.version++;
  }
}
