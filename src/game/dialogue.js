// Dialogue box: typewriter text with per-speaker voice blips, choices and
// cinematic camera framing.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { fillName } from '../core/util.js';
import { SPEAKERS } from './npcs.js';

function parse(text) {
  // *emphasis*  and  [text|cls]
  const segs = [];
  const re = /\*([^*]+)\*|\[([^|\]]+)\|(\w+)\]/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) segs.push({ t: text.slice(last, m.index), c: null });
    if (m[1] !== undefined) segs.push({ t: m[1], c: 'em' });
    else segs.push({ t: m[2], c: m[3] });
    last = re.lastIndex;
  }
  if (last < text.length) segs.push({ t: text.slice(last), c: null });
  const total = segs.reduce((a, s) => a + [...s.t].length, 0);
  return { segs, total };
}
function render(parsed, n) {
  let out = '', left = n;
  for (const s of parsed.segs) {
    if (left <= 0) break;
    const chars = [...s.t];
    const part = chars.slice(0, left).join('').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
    left -= chars.length;
    if (s.c === 'em') out += `<em>${part}</em>`;
    else if (s.c) out += `<span class="${s.c}">${part}</span>`;
    else out += part;
  }
  return out;
}

export class Dialogue {
  constructor() {
    this.box = document.getElementById('dialogue');
    this.nameEl = this.box.querySelector('.dlg-name');
    this.textEl = this.box.querySelector('.dlg-text');
    this.choicesEl = this.box.querySelector('.dlg-choices');
    this.nextEl = this.box.querySelector('.dlg-next');
    this.lb = document.getElementById('letterbox');
    this.active = false;
    this.cur = null;
    this.depth = 0;
    this.box.addEventListener('mousedown', (e) => { if (e.button === 0) G.input.mouse.pressed.add(0); });
    // backlog + skip affordances
    this.log = [];
    this.keysEl = document.createElement('div'); this.keysEl.className = 'dlg-keys';
    this.keysEl.innerHTML = '<span><kbd>L</kbd> 지난 대사</span><span class="dlg-skip"><kbd>Esc</kbd> 누르고 있기: 빨리 넘기기<i></i></span>';
    this.box.appendChild(this.keysEl);
    this.skipBar = this.keysEl.querySelector('.dlg-skip i');
    this.logEl = document.createElement('div'); this.logEl.id = 'dlg-log'; this.logEl.className = 'hidden';
    document.getElementById('ui').appendChild(this.logEl);
    this.logOpen = false;
    this.tw = null;
  }

  begin(opts = {}) {
    this.depth++;
    if (this.active) return;
    this.active = true;
    this.prevMode = G.mode;
    G.mode = opts.cutscene ? 'cutscene' : 'dialogue';
    this.lb.classList.add('on');
    document.getElementById('hud').classList.add('dlg');
    G.player.talking = false;
  }
  end() {
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth > 0) return;
    this.active = false;
    this.tw = null; this.ffwd = false;
    if (this.logOpen) this.toggleLog(false);
    G.mode = 'free';
    this.lb.classList.remove('on');
    this.box.classList.add('hidden');
    document.getElementById('hud').classList.remove('dlg');
    G.cameraRig.release();
    G.interactCD = 0.4;
    if (G.state === 'play' && !G.game.menu && !G.player.dead) G.input.requestLock();
    for (const n of G.npcs.list) n.talking = false;
    if (G.companion) G.companion.talking = false;
    G.input.consume('KeyE'); G.input.consume('Space'); G.input.mouse.pressed.delete(0);
  }

  resolveSpeaker(who) {
    if (who === 'player') return G.player;
    if (who === 'boreum' && G.companion && G.companion.active) return G.companion;
    return G.npcs.get(who) || null;
  }

  // Over-the-shoulder shot: camera behind `from`, looking at `subject`'s face
  shot(from, subject, side = 1) {
    const sub = subject.pos.clone();
    if (subject === G.companion) sub.y -= 1.3;
    const headH = subject.headH ?? 1.65;
    const dir = sub.clone().sub(from).setY(0);
    let dist = dir.length();
    if (dist < 0.4) { dir.set(Math.sin(G.player.yaw), 0, Math.cos(G.player.yaw)); dist = 1; }
    dir.normalize();
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    const back = Math.max(1.5, Math.min(3, dist * 0.45 + 1.3));
    const cam = from.clone().addScaledVector(dir, -back).addScaledVector(right, 1.25 * side);
    cam.y = Math.max(from.y, sub.y) + 1.85;
    const g = G.world.ground(cam.x, cam.z, cam.y + 2);
    cam.y = Math.max(cam.y, g + 1.3);
    const look = sub.clone(); look.y += headH * 0.86;
    this.moveCam(cam, look);
  }

  // Blend between dialogue shots instead of hard-cutting, then drift gently
  // toward the speaker while the line plays. Story code that calls
  // G.cameraRig.setCine directly takes over (detected in update()).
  moveCam(cam, look) {
    const R = G.cameraRig;
    const blend = R.mode === 'cine' && R.cine.k > 0.6 && R.cine.pos.distanceTo(cam) > 0.3;
    this.tw = { p0: R.cine.pos.clone(), l0: R.cine.look.clone(), p1: cam.clone(), l1: look.clone(), t: blend ? 0 : 1, dur: 0.65, drift: 0 };
    if (!blend) R.setCine(cam, look);
    this.twLast = R.cine.pos.clone();
  }
  updateCam(dt) {
    const tw = this.tw, R = G.cameraRig;
    if (!tw || R.mode !== 'cine') return;
    if (this.twLast && R.cine.pos.distanceToSquared(this.twLast) > 1e-6) { this.tw = null; return; } // someone else took the camera
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const k = tw.t * tw.t * (3 - 2 * tw.t);
    tw.drift = Math.min(1, tw.drift + dt / 9);
    const push = 0.07 * tw.drift * tw.drift;
    const p = tw.p0.clone().lerp(tw.p1, k);
    p.lerp(tw.l1, push);
    const l = tw.l0.clone().lerp(tw.l1, k);
    R.cine.pos.copy(p); R.cine.look.copy(l);
    this.twLast = R.cine.pos.clone();
  }

  toggleLog(v = !this.logOpen) {
    this.logOpen = v;
    this.logEl.classList.toggle('hidden', !v);
    if (v) {
      this.logEl.innerHTML = `<div class="lg-frame"><div class="lg-title">지난 대사</div><div class="lg-body">${this.log.map((l) => `<div class="lg-row ${l.narr ? 'narr' : ''}">${l.name ? `<b>${l.name}</b>` : ''}<p>${l.html}</p></div>`).join('')}</div><div class="lg-close"><kbd>L</kbd> 닫기</div></div>`;
      const b = this.logEl.querySelector('.lg-body'); b.scrollTop = b.scrollHeight;
      G.audio.play('page');
    }
  }

  frameOn(obj, opts = {}) {
    const P = G.player;
    if (!obj) return;
    if (obj === P) {
      const other = this.lastOther;
      if (other) this.shot(other.pos.clone().setY(other === G.companion ? other.pos.y - 1.3 : other.pos.y), P, -1);
      return;
    }
    this.lastOther = obj;
    this.shot(P.pos, obj, opts.side ?? 1);
  }

  say(who, text, opts = {}) {
    const sp = SPEAKERS[who] || { name: who, voice: SPEAKERS.villager.voice };
    const name = fillName(opts.name ?? sp.name, G.playerName);
    const obj = opts.target || this.resolveSpeaker(who);
    for (const n of G.npcs.list) n.talking = false;
    if (G.companion) G.companion.talking = false;
    if (obj && obj !== G.player) obj.talking = true;
    if (obj && opts.cam !== false) this.frameOn(obj, opts);
    this.box.classList.remove('hidden');
    this.nameEl.textContent = name;
    this.textEl.classList.toggle('narr', who === 'narr');
    this.choicesEl.innerHTML = '';
    this.nextEl.classList.remove('on');
    const parsed = parse(fillName(text, G.playerName));
    this.log.push({ name, html: render(parsed, parsed.total), narr: who === 'narr' || who === 'sign' });
    if (this.log.length > 80) this.log.shift();
    return new Promise((res) => {
      this.cur = { parsed, n: 0, t: 0, voice: sp.voice, res, done: false, blip: 0, hold: opts.hold ?? 0, auto: opts.auto };
      this.textEl.innerHTML = '';
    });
  }

  choose(options) {
    this.box.classList.remove('hidden');
    this.nextEl.classList.remove('on');
    this.choicesEl.innerHTML = '';
    return new Promise((res) => {
      const btns = options.map((o, i) => {
        const b = document.createElement('button');
        b.className = 'dlg-choice';
        b.innerHTML = `<span style="opacity:.5;margin-right:10px">${i + 1}</span>${fillName(o, G.playerName)}`;
        b.addEventListener('click', (e) => { e.stopPropagation(); pick(i); });
        b.addEventListener('mouseenter', () => { this.sel = i; mark(); });
        this.choicesEl.appendChild(b);
        return b;
      });
      this.sel = 0;
      const mark = () => btns.forEach((b, i) => b.classList.toggle('sel', i === this.sel));
      mark();
      const pick = (i) => {
        if (!this.choosing) return;
        this.choosing = null;
        G.audio.play('ui_click');
        this.choicesEl.innerHTML = '';
        G.input.consume('KeyE'); G.input.consume('Space'); G.input.mouse.pressed.delete(0);
        res(i);
      };
      this.choosing = { n: options.length, pick, mark };
      G.audio.play('ui_hover');
    });
  }

  update(dt) {
    const I = G.input;
    this.updateCam(dt);
    if (!this.active && !this.cur && !this.choosing) return;
    if (I.pressed.has('KeyL')) { this.toggleLog(); I.consume('KeyL'); }
    if (this.logOpen) { if (I.pressed.has('Escape')) this.toggleLog(false); I.consume('KeyE'); I.consume('Space'); I.mouse.pressed.delete(0); return; }
    // hold Esc to fast-forward (stops at choices)
    const held = I.heldFor('Escape');
    this.ffwd = held > 0.6;
    this.skipBar.style.width = `${Math.min(1, held / 0.6) * 100}%`;
    this.keysEl.classList.toggle('ff', this.ffwd);
    if (this.choosing) {
      const c = this.choosing;
      for (let i = 0; i < c.n; i++) if (I.pressed.has('Digit' + (i + 1))) return c.pick(i);
      if (I.pressed.has('KeyW') || I.pressed.has('ArrowUp') || I.mouse.wheel < 0) { this.sel = (this.sel - 1 + c.n) % c.n; c.mark(); G.audio.play('ui_hover'); }
      if (I.pressed.has('KeyS') || I.pressed.has('ArrowDown') || I.mouse.wheel > 0) { this.sel = (this.sel + 1) % c.n; c.mark(); G.audio.play('ui_hover'); }
      if (I.advance()) c.pick(this.sel);
      return;
    }
    const c = this.cur;
    if (!c) return;
    if (!c.done) {
      c.t -= dt;
      if (this.ffwd) c.n = c.parsed.total - 1;
      const adv = I.advance();
      if (adv && c.n > 2) { c.n = c.parsed.total; I.consume('KeyE'); I.consume('Space'); I.mouse.pressed.delete(0); }
      while (c.t <= 0 && c.n < c.parsed.total) {
        c.n++;
        const ch = this.charAt(c.parsed, c.n - 1);
        let delay = 1 / 40;
        if (ch === '…') delay = 0.22;
        else if (ch === '.' || ch === '!' || ch === '?') delay = 0.16;
        else if (ch === ',') delay = 0.08;
        c.t += delay;
        if (c.voice && ch.trim() && !'.,!?…—~'.includes(ch)) {
          c.blip++;
          if (c.blip % 2 === 1) G.audio.blip(c.voice);
        }
      }
      this.textEl.innerHTML = render(c.parsed, c.n);
      if (c.n >= c.parsed.total) { c.done = true; c.wait = c.hold; this.nextEl.classList.add('on'); }
    } else {
      c.wait -= dt;
      if (this.ffwd) { c.ffT = (c.ffT || 0) + dt; if (c.ffT > 0.06) this.finish(); return; }
      if (c.auto !== undefined) { c.auto -= dt; if (c.auto <= 0) this.finish(); return; }
      if (c.wait <= 0 && I.advance()) { I.consume('KeyE'); I.consume('Space'); I.mouse.pressed.delete(0); G.audio.play('page'); this.finish(); }
    }
  }
  charAt(parsed, i) {
    for (const s of parsed.segs) { const a = [...s.t]; if (i < a.length) return a[i]; i -= a.length; }
    return '';
  }
  finish() {
    const c = this.cur; this.cur = null;
    this.nextEl.classList.remove('on');
    c.res();
  }

  // Convenience: run a list of [who, text] lines
  async lines(list) {
    for (const l of list) {
      if (typeof l === 'function') { await l(); continue; }
      await this.say(l[0], l[1], l[2] || {});
    }
  }
}
