// Round minimap (bottom-left), north-up like the big map, so the land keeps one orientation
// in memory; the player arrow turns with the body and a soft cone shows where the camera looks. The terrain is painted once into a high-resolution base (the big map's colours
// and hillshade, plus building footprints), then each frame a small window of it is drawn
// rotated around the player. A compass ring, the tracked quest marker (pinned to the rim with
// its distance when it lies outside), lit waystones, nearby villagers and enemies that are
// hunting you are drawn on top.
import { G } from '../core/context.js';

const PX_PER_M = 3;          // base resolution
const VIEW_R = 62;           // metres from the centre to the rim
const HALF = 240;            // world half-size (terrain is 480 m)
const CARD = [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2]];

export class Minimap {
  constructor(root) {
    this.root = root;
    this.cv = root.querySelector('canvas');
    this.g = this.cv.getContext('2d');
    this.t = 0;
    this.base = null;
    this.size = 0;
  }

  // Terrain colours with hillshade come from the big map's base image (241² for 480 m);
  // upscaled here with smoothing, then building footprints are stamped on crisply.
  buildBase(mapBase) {
    const S = HALF * 2 * PX_PER_M;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(mapBase, 0, 0, S, S);
    // soften and darken slightly so markers read on top
    g.fillStyle = 'rgba(20,16,10,0.16)'; g.fillRect(0, 0, S, S);
    // footprints of buildings and walls (large, tall boxes); trees and small props are skipped
    const W = G.world, seen = new Set();
    g.fillStyle = 'rgba(58,40,28,0.92)'; g.strokeStyle = 'rgba(255,236,200,0.55)'; g.lineWidth = 1.5;
    for (const arr of W.col.grid.values()) for (const k of arr) {
      if (seen.has(k)) continue; seen.add(k);
      if (k.type !== 'box' || k.hw * k.hd < 3 || k.noTop) continue;
      const ground = W.h(k.x, k.z);
      if (k.h1 - ground < 1.6 || k.h1 > 1e8) continue;
      g.save();
      g.translate((k.x + HALF) * PX_PER_M, (k.z + HALF) * PX_PER_M);
      g.rotate(-k.rot);
      g.fillRect(-k.hw * PX_PER_M, -k.hd * PX_PER_M, k.hw * 2 * PX_PER_M, k.hd * 2 * PX_PER_M);
      g.strokeRect(-k.hw * PX_PER_M, -k.hd * PX_PER_M, k.hw * 2 * PX_PER_M, k.hd * 2 * PX_PER_M);
      g.restore();
    }
    this.base = c;
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = Math.round(r.width * dpr);
    if (s && s !== this.size) { this.size = s; this.cv.width = this.cv.height = s; }
  }

  update(dt, mapBase) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1 / 30;
    if (!this.base) { if (!mapBase) return; this.buildBase(mapBase); }
    this.resize();
    if (!this.size) return;
    this.draw();
  }

  draw() {
    const g = this.g, S = this.size, c = S / 2, R = S / 2 - S * 0.07; // leave room for the ring
    const P = G.player, cr = G.cameraRig;
    const fx = -Math.sin(cr.yaw), fz = -Math.cos(cr.yaw);
    const view = Math.atan2(fx, -fz);      // camera bearing, clockwise from north
    const heading = 0;                      // north-up
    const k = R / VIEW_R;                   // screen px per metre
    g.clearRect(0, 0, S, S);
    // map disc
    g.save();
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#1c2a2c'; g.fillRect(0, 0, S, S);
    g.translate(c, c); g.rotate(-heading);
    const src = VIEW_R * 1.45; // enough to cover the disc at any rotation
    const sx = (P.pos.x - src + HALF) * PX_PER_M, sz = (P.pos.z - src + HALF) * PX_PER_M, sw = src * 2 * PX_PER_M;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, sx, sz, sw, sw, -src * k, -src * k, src * 2 * k, src * 2 * k);
    g.restore();
    // inner vignette
    const vg = g.createRadialGradient(c, c, R * 0.6, c, c, R);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.38)');
    g.fillStyle = vg; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();

    // world → minimap (relative bearing), clamped to the rim when `pin`
    const toMini = (x, z, pin) => {
      const dx = x - P.pos.x, dz = z - P.pos.z, d = Math.hypot(dx, dz);
      const b = Math.atan2(dx, -dz) - heading;
      let r = d * k, out = false;
      if (r > R - S * 0.05) { if (!pin) return null; r = R - S * 0.05; out = true; }
      return { x: c + Math.sin(b) * r, y: c - Math.cos(b) * r, d, out, b };
    };
    const u = S / 180; // marker scale (canvas is ~180 css px at scale 1)

    // villagers: soft dots so the village can be read at a glance
    for (const n of G.npcs.list) {
      if (!n.root || !n.root.visible) continue;
      const m = toMini(n.pos.x, n.pos.z); if (!m) continue;
      g.beginPath(); g.arc(m.x, m.y, 3 * u, 0, Math.PI * 2);
      g.fillStyle = '#f4efe2'; g.fill(); g.lineWidth = 1.2 * u; g.strokeStyle = 'rgba(0,0,0,.6)'; g.stroke();
    }
    // waystones
    for (const L of Object.values(G.world.lanterns)) {
      const m = toMini(L.x, L.z); if (!m) continue;
      g.save(); g.translate(m.x, m.y);
      g.beginPath(); g.moveTo(0, -5.5 * u); g.lineTo(4.5 * u, 3.5 * u); g.lineTo(-4.5 * u, 3.5 * u); g.closePath();
      g.fillStyle = L.lit ? '#ffc870' : 'rgba(150,150,150,.8)'; g.fill();
      g.lineWidth = 1.2 * u; g.strokeStyle = 'rgba(20,14,6,.85)'; g.stroke(); g.restore();
    }
    // enemies that are after you
    for (const e of G.enemies.list) {
      if (!e.alive || !e.aggroed) continue;
      const m = toMini(e.pos.x, e.pos.z); if (!m) continue;
      g.beginPath(); g.arc(m.x, m.y, (e.boss ? 5.5 : 3.6) * u, 0, Math.PI * 2);
      g.fillStyle = '#ff5a4a'; g.fill(); g.lineWidth = 1.2 * u; g.strokeStyle = 'rgba(40,0,0,.8)'; g.stroke();
    }
    // tracked quest marker: pinned to the rim with its distance when outside
    const qm = G.story && G.story.markers();
    if (qm) for (const q of qm) {
      const m = toMini(q.x, q.z, true);
      g.save(); g.translate(m.x, m.y);
      if (m.out) { // small chevron pointing outwards
        g.save(); g.rotate(m.b);
        g.beginPath(); g.moveTo(0, -9 * u); g.lineTo(4 * u, -4 * u); g.lineTo(-4 * u, -4 * u); g.closePath();
        g.fillStyle = '#f1d48a'; g.fill(); g.restore();
      }
      g.rotate(Math.PI / 4);
      const s = 5 * u;
      g.fillStyle = '#f1d48a'; g.fillRect(-s, -s, s * 2, s * 2);
      g.lineWidth = 1.5 * u; g.strokeStyle = '#2a1e0c'; g.strokeRect(-s, -s, s * 2, s * 2);
      g.restore();
      if (m.out) {
        const tx = c + (m.x - c) * 0.78, ty = c + (m.y - c) * 0.78;
        g.font = `600 ${10 * u}px 'Hahmlet', serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 3 * u; g.strokeStyle = 'rgba(0,0,0,.75)'; const txt = `${Math.round(m.d)}m`;
        g.strokeText(txt, tx, ty); g.fillStyle = '#f7e6b8'; g.fillText(txt, tx, ty);
      }
    }
    // the player: arrow for the body's facing, relative to the view direction
    const face = Math.atan2(Math.sin(P.yaw), -Math.cos(P.yaw)) - heading;
    // view cone
    const cone = g.createRadialGradient(c, c, 0, c, c, R * 0.55);
    cone.addColorStop(0, 'rgba(255,255,255,0.22)'); cone.addColorStop(1, 'rgba(255,255,255,0)');
    g.beginPath(); g.moveTo(c, c); g.arc(c, c, R * 0.55, view - Math.PI / 2 - 0.55, view - Math.PI / 2 + 0.55); g.closePath();
    g.fillStyle = cone; g.fill();
    g.save(); g.translate(c, c); g.rotate(face);
    g.beginPath(); g.moveTo(0, -9 * u); g.lineTo(6.5 * u, 7 * u); g.lineTo(0, 3.5 * u); g.lineTo(-6.5 * u, 7 * u); g.closePath();
    g.fillStyle = '#5ad0ff'; g.fill(); g.lineWidth = 1.8 * u; g.strokeStyle = '#fff'; g.stroke();
    g.restore();

    // compass ring
    const ringR = S / 2 - S * 0.035;
    g.beginPath(); g.arc(c, c, ringR, 0, Math.PI * 2);
    g.lineWidth = S * 0.07; g.strokeStyle = 'rgba(10,12,18,0.82)'; g.stroke();
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2);
    g.lineWidth = 1.5 * u; g.strokeStyle = 'rgba(241,212,138,0.55)'; g.stroke();
    // ticks every 30°
    for (let a = 0; a < 12; a++) {
      const b = (a * Math.PI) / 6 - heading;
      if (a % 3 === 0) continue;
      const x0 = c + Math.sin(b) * (ringR - 2 * u), y0 = c - Math.cos(b) * (ringR - 2 * u);
      const x1 = c + Math.sin(b) * (ringR + 2 * u), y1 = c - Math.cos(b) * (ringR + 2 * u);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineWidth = 1 * u; g.strokeStyle = 'rgba(244,239,226,0.45)'; g.stroke();
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [t, a] of CARD) {
      const b = a - heading;
      const x = c + Math.sin(b) * ringR, y = c - Math.cos(b) * ringR;
      g.font = `700 ${(t === 'N' ? 11 : 9) * u}px 'Cinzel', serif`;
      g.fillStyle = t === 'N' ? '#ff8a7a' : 'rgba(244,239,226,0.8)';
      g.fillText(t, x, y + 0.5 * u);
    }
  }
}
