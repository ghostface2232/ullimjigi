// Mora's sketchbook (phase 0 of docs/EXPANSION.md). Danbi hands over the sketchbook Mora
// drew in as a young woman. Each page is a real view of the vale, drawn at runtime: the
// scene is rendered from the page's vantage point and turned into pencil lines on paper.
// Stand where she stood and look the same way, and the drawing settles over the world;
// hold it there and the page's memory opens. Four pages lead to the memory items (which
// stay hidden until then), two carry memories of their own.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { clamp } from '../core/util.js';

export const SKETCHES = [
  { id: 'hill', name: '언덕 위의 우리 집', eye: [-2, 128], look: [-27, 153, 8],
    text: '세하가 졸라서 그린 우리 집. 창가에 앉은 게 나, 문 앞에서 손 흔드는 게 세하란다. …언젠가 이 애의 아이도 여기서 자라겠지.' },
  { id: 'dawn', name: '새벽의 종탑', eye: [-8, 30], look: [6, 10, 9],
    text: '매일 새벽 종을 친다. 한 번 칠 때마다 한 사람의 이름을 불러. 오늘은 카엘, 내일도 카엘.' },
  { id: 'lake', mem: 'hairpin', name: '거울 호숫가', eye: [-40, 86], look: [-84, 64, 2],
    text: '세하 열 살. 은방울꽃 핀을 호수에 빠뜨리고 울었다. 아무리 뒤져도 없더구나. …언젠가 누가 찾아 주겠지.' },
  { id: 'meadow', mem: 'book', name: '노을 들판의 나무', eye: [96, 84], look: [81, 64, 4],
    text: '카엘이 꽃 이름을 가르쳐 준 나무. 물망초는 나를 잊지 말라는 뜻이래. 흥, 누가 잊는대.' },
  { id: 'frost', mem: 'musicbox', name: '서리봉 가는 길', eye: [-26, -140], look: [-34, -170, 3], after: 'frostBell',
    text: '세하가 오르골을 품에 안고 올라간 길. 금방 온다고 했지. 그 애는 늘 약속을 지키는 애였는데.' },
  { id: 'storm', mem: 'badge', name: '천둥 고원의 폐허', eye: [-150, -10], look: [-170, -24, 3], after: 'stormBell',
    text: '카엘이 마지막으로 서 있던 자리. 천둥이 칠 때마다 그 사람 이름을 불러 주는 것 같더라.' },
];
const EYE_H = 2.6;           // a normal over-the-shoulder camera height
const NEAR = 7;              // camera within this of the vantage point (m)
const CONE = 0.35;           // and facing within ~20°
const HOLD = 0.7;            // seconds lined up before the memory opens
const W_PX = 480;            // sketch width in pixels

export class Sketchbook {
  constructor() {
    this.img = {};             // id → data URL
    this.queue = [];
    this.hold = 0;
    this.busy = false;
    this.el = document.createElement('div');
    this.el.id = 'sketch-view';
    // under the HUD (dialogue, prompts) but over the game canvas
    const ui = document.getElementById('ui');
    if (ui) ui.parentNode.insertBefore(this.el, ui); else document.body.appendChild(this.el);
    this.showing = null;
  }

  get S() { return G.story; }
  owned() { return !!(this.S && this.S.flag('sketchbook')); }
  done(s) {
    if (this.S.flag('sk_' + s.id)) return true;
    return !!(s.mem && this.S.memories[s.mem]); // found before the sketchbook existed
  }
  open(s) { return !s.after || this.S.flag(s.after); }
  count() { return SKETCHES.filter((s) => this.done(s)).length; }

  // Draw the open pages (a few ms each), one per frame so nothing stalls. A page behind a
  // shrine is drawn only once its bell rings, so the seal does not end up in the drawing.
  prepare() { for (const s of SKETCHES) if (this.open(s) && !this.img[s.id] && !this.queue.includes(s)) this.queue.push(s); }

  // Render the view from the vantage point and ink it on paper.
  draw(s) {
    const R = G.renderer.renderer, W = G.world;
    const aspect = Math.max(1.2, Math.min(2, innerWidth / innerHeight));
    const w = W_PX, h = Math.round(W_PX / aspect);
    const cam = this.camFor(s, aspect);
    this.rt ||= new THREE.WebGLRenderTarget(w, h);
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    // leave people and the Hush out of it, bring nearby trees to full detail for this view
    const hide = [G.player.root, G.companion && G.companion.root, ...G.npcs.list.map((n) => n.root), ...G.enemies.list.map((e) => e.root)].filter(Boolean);
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    W.props.update(cam);
    R.setRenderTarget(this.rt); R.render(G.scene, cam); R.setRenderTarget(null);
    W.props.update(G.camera);
    hide.forEach((o, i) => (o.visible = vis[i]));
    const px = new Uint8Array(w * h * 4);
    R.readRenderTargetPixels(this.rt, 0, 0, w, h, px);
    this.img[s.id] = ink(px, w, h, s.id.length * 7 + s.eye[0]);
  }
  camFor(s, aspect) {
    const W = G.world, [ex, ez] = s.eye, [lx, lz, ly] = s.look;
    const cam = new THREE.PerspectiveCamera(G.camera.fov, aspect, 0.3, 1200);
    cam.position.set(ex, W.h(ex, ez) + EYE_H, ez);
    cam.lookAt(lx, W.h(lx, lz) + ly, lz);
    cam.updateMatrixWorld(true);
    return cam;
  }

  // How well the game camera lines up with a page (0..1).
  align(s) {
    const c = G.camera.position, [ex, ez] = s.eye;
    const d = Math.hypot(c.x - ex, c.z - ez);
    if (d > NEAR * 2.2) return 0;
    const [lx, lz, ly] = s.look, W = G.world;
    const want = new THREE.Vector3(lx - ex, W.h(lx, lz) + ly - (W.h(ex, ez) + EYE_H), lz - ez).normalize();
    const fwd = G.camera.getWorldDirection(new THREE.Vector3());
    // heading matters most; tilt is forgiven twice as much (the camera usually looks a little down)
    const yaw = Math.abs(Math.atan2(Math.sin(Math.atan2(fwd.x, fwd.z) - Math.atan2(want.x, want.z)), Math.cos(Math.atan2(fwd.x, fwd.z) - Math.atan2(want.x, want.z))));
    const tilt = Math.abs(Math.asin(clamp(fwd.y, -1, 1)) - Math.asin(clamp(want.y, -1, 1)));
    return clamp(1 - d / (NEAR * 2.2), 0, 1) ** 0.7 * clamp(1 - yaw / (CONE * 2), 0, 1) * clamp(1 - tilt / (CONE * 4), 0, 1);
  }

  update(dt) {
    const S = this.S;
    if (!S) return;
    // memory items stay hidden until their page is matched
    for (const s of SKETCHES) {
      const m = s.mem && G.world.memoryObjs[s.mem];
      if (m && !m.taken) m.g.visible = !!S.flag('sk_' + s.id);
    }
    if (!this.owned()) return;
    if (this.queue.length) { this.draw(this.queue.shift()); return; }
    if (SKETCHES.some((s) => this.open(s) && !this.img[s.id])) { this.prepare(); return; }
    if (this.busy) return;
    // the closest open page decides the overlay
    let best = null, k = 0;
    if (G.mode === 'free' && !G.player.dead) {
      for (const s of SKETCHES) {
        if (this.done(s) || !this.open(s) || !this.img[s.id]) continue;
        const a = this.align(s);
        if (a > k) { k = a; best = s; }
      }
    }
    const lined = k > 0.72;
    this.hold = lined ? this.hold + dt : Math.max(0, this.hold - dt * 2);
    this.show(best, best ? clamp((k - 0.15) / 0.6, 0, 1) * 0.55 : 0);
    if (best && this.hold > HOLD) { this.hold = 0; this.match(best); }
  }

  show(s, o, full = false) {
    if (s && this.showing !== s.id) { this.el.style.backgroundImage = `url(${this.img[s.id]})`; this.showing = s.id; }
    this.el.style.opacity = o.toFixed(3);
    this.el.classList.toggle('full', full);
  }

  // The drawing settles over the view; the memory is read out, then the page is kept.
  async match(s) {
    const S = this.S;
    this.busy = true;
    G.audio.play('page');
    this.show(s, 1, true);
    G.game.musicOverride = 'memory';
    await S.sleep(0.9);
    await S.conv(async () => {
      await S.say('mora', s.text, { cam: false, name: '모라의 스케치북' });
    });
    S.set('sk_' + s.id);
    this.show(s, 0, true);
    await S.sleep(0.4);
    this.show(null, 0);
    G.game.musicOverride = null;
    const m = s.mem && G.world.memoryObjs[s.mem];
    if (m && !S.memories[s.mem]) {
      m.g.visible = true;
      G.audio.play('echo', { pos: m.pos });
      G.vfx.burst(m.pos, 'soul', 24, { el: 'arcane' });
      G.hud.toast('그림 속 그 자리에서 무언가 희미하게 반짝인다…');
    } else if (!s.mem) {
      G.player.addXP(35);
      G.skills.gain(1, '모라의 기억을 되찾았다');
    }
    S.updateMemoryObj();
    this.busy = false;
  }

  // Journal page: the sketches found so far.
  html() {
    if (!this.owned()) return '';
    const cards = SKETCHES.map((s) => {
      const done = this.done(s), open = this.open(s), img = this.img[s.id];
      const pic = open && img ? `<img src="${img}" alt="">` : '<span class="sk-blank">?</span>';
      return `<figure class="sk ${done ? 'done' : ''} ${open ? '' : 'locked'}">${pic}<figcaption>${open ? s.name : '아직 흐릿한 그림'}${done ? ' <b>✓</b>' : ''}</figcaption>${done ? `<p>${s.text}</p>` : ''}</figure>`;
    }).join('');
    return `<div class="jsec">모라의 스케치북 — 그림 속 자리에 서서 같은 곳을 바라보자 · ${this.count()} / ${SKETCHES.length}</div><div class="sk-grid">${cards}</div>`;
  }
}

// Pencil on paper from a rendered view: luminance edges for outlines, three bands of
// hatching for shade, warm paper with grain, and a soft hand-drawn border.
function ink(px, w, h, seed) {
  const L = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((h - 1 - y) * w + x) * 4; // read-back is bottom-up
    const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    L[y * w + x] = Math.pow(l / (1 + l * 0.6) * 1.6, 0.6);
  }
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'), out = g.createImageData(w, h), o = out.data;
  let r = seed | 0; const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const wob = new Float32Array(h); for (let y = 0; y < h; y++) wob[y] = Math.sin(y * 0.11 + seed) * 1.4 + Math.sin(y * 0.031) * 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = (xx, yy) => L[clamp(yy, 0, h - 1) * w + clamp(xx, 0, w - 1)];
    const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
    const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
    const e = Math.hypot(gx, gy), l = L[y * w + x];
    // outlines, fainter in bright sky so clouds stay light
    let k = Math.min(1, Math.max(0, (e - 0.12) / 0.35)) * 0.9 * (1 - 0.7 * clamp((l - 0.7) / 0.22, 0, 1));
    const xw = x + wob[y];
    if (l < 0.62 && ((xw + y) % 6 + 6) % 6 < 1) k += 0.3 * (0.62 - l) / 0.62 + 0.1;
    if (l < 0.42 && ((xw - y) % 6 + 6) % 6 < 1) k += 0.32;
    if (l < 0.24 && ((xw + y * 0.3) % 4 + 4) % 4 < 1) k += 0.3;
    // fade the ink toward an uneven border
    const bx = Math.min(x, w - 1 - x) / w, by = Math.min(y, h - 1 - y) / h;
    const edge = clamp((Math.min(bx * 1.6, by * 1.6 * (w / h) / 1.6) - 0.02 - rnd() * 0.012) / 0.07, 0, 1);
    k = clamp(k * edge, 0, 0.92);
    const grain = 0.96 + rnd() * 0.04;
    const i = (y * w + x) * 4;
    o[i] = (244 * (1 - k) + 58 * k) * grain;
    o[i + 1] = (234 * (1 - k) + 52 * k) * grain;
    o[i + 2] = (214 * (1 - k) + 48 * k) * grain;
    o[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  return cv.toDataURL('image/jpeg', 0.86);
}
