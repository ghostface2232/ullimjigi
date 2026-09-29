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
    G.mode = 'free';
    this.lb.classList.remove('on');
    this.box.classList.add('hidden');
    document.getElementById('hud').classList.remove('dlg');
    G.cameraRig.release();
    G.interactCD = 0.4;
    for (const n of G.npcs.list) n.talking = false;
    if (G.companion) G.companion.talking = false;
    G.input.consume('KeyE'); G.input.consume('Space'); G.input.mouse.pressed.delete(0);
  }

  resolveSpeaker(who) {
    if (who === 'player') return G.player;
    if (who === 'boreum' && G.companion && G.companion.active) return G.companion;
    return G.npcs.get(who) || null;
  }

  frameOn(obj, opts = {}) {
    const P = G.player;
    if (!obj) return;
    let focus;
    if (obj === G.player) {
      // frame player, looking at the last other speaker if any
      const other = this.lastOther;
      if (other) { focus = P.pos.clone(); G.cameraRig.frame(focus, other.pos.clone ? other.pos.clone().setY(P.pos.y) : P.pos, { side: -1, dist: 3.2 }); }
      return;
    }
    this.lastOther = obj;
    focus = obj.pos.clone();
    if (obj === G.companion) focus.y -= 1.3;
    const dist = opts.dist ?? (obj.headH && obj.headH < 1.3 ? 2.6 : 3.4);
    G.cameraRig.frame(focus, P.pos.clone().setY(focus.y), { side: opts.side ?? 1, dist, h: (obj.headH ?? 1.7) * 0.95, lookH: (obj.headH ?? 1.7) * 0.85 });
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
