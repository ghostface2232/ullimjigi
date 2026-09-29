// DOM HUD: vitals, compass, spell bar, world-anchored labels, banners, map & journal.
import * as THREE from 'three';
import { G, ELEMENTS, EL_INFO, EL_SVG } from '../core/context.js';
import { BOLT, HEAVY, WEAVE, weaveInfo, WEAVE_CD } from './spells.js';
import { REACTIONS } from './combat.js';
import { xpNeed } from './player.js';
import { wrapAngle, clamp, fillName } from '../core/util.js';
import { LANTERNS, MEMORIES } from '../world/world.js';
import { POI } from '../world/layout.js';

const $ = (s) => document.querySelector(s);
const HEART_PATH = 'M13 22.5C5 16.2 1.2 12.3 1.2 7.6A5.6 5.6 0 0 1 13 5.2 5.6 5.6 0 0 1 24.8 7.6c0 4.7-3.8 8.6-11.8 14.9z';
const v3 = new THREE.Vector3();

function heartSVG(q) {
  const quads = [
    `<rect x="0" y="0" width="13" height="12" />`, `<rect x="13" y="0" width="13" height="12" />`,
    `<rect x="13" y="12" width="13" height="12" />`, `<rect x="0" y="12" width="13" height="12" />`,
  ];
  let fill = '';
  for (let i = 0; i < 4; i++) if (i < q) fill += quads[i];
  return `<svg viewBox="0 0 26 24"><path d="${HEART_PATH}" fill="rgba(40,8,14,.75)" stroke="#fff8ee" stroke-width="1.6"/>
    <g clip-path="url(#heartClip)" fill="#ff4d62">${fill}</g>
    <path d="M6.5 6.5c1.2-1.4 3-1.2 4 .3" stroke="rgba(255,255,255,.7)" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>`;
}

export class HUD {
  constructor() {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    defs.setAttribute('width', 0); defs.setAttribute('height', 0); defs.style.position = 'absolute';
    defs.innerHTML = `<defs><clipPath id="heartClip"><path d="${HEART_PATH}"/></clipPath></defs>`;
    document.body.appendChild(defs);
    this.el = {
      hud: $('#hud'), hearts: $('#hearts'), manaFill: $('.mana-fill'), manaGhost: $('.mana-ghost'), mana: $('#mana'),
      xpFill: $('.xp-fill'), xpLv: $('.xp-lv'), compassStrip: $('.compass-strip'), compassMarkers: $('.compass-markers'),
      qtTitle: $('.qt-title'), qtObj: $('.qt-obj'), crosshair: $('#crosshair'), lock: $('#lock-marker'),
      stamina: $('#stamina'), stFill: $('.st-fill'), elements: $('#elements'), weaveSlot: $('#weave-slot'),
      weaveIcons: $('.weave-icons'), weaveName: $('.weave-name'), weaveCd: $('.weave-cd'), heavyName: $('#heavy-slot .hn'), heavyCd: $('.heavy-cd'),
      boss: $('#boss-bar'), bossName: $('.boss-name'), bossFill: $('.boss-fill'), bossGhost: $('.boss-ghost'),
      bars: $('#enemy-bars'), dmg: $('#dmg-layer'), markers: $('#markers-layer'), prompt: $('#prompt'), promptT: $('#prompt .pt'),
      hint: $('#hint'), area: $('#area-title'), banner: $('#banner'), toasts: $('#toasts'), comp: $('#companion-line'), barks: $('#barks'),
    };
    this.floats = [];
    this.barPool = new Map();
    this.lastHp = -1;
    this.bannerQ = []; this.bannerBusy = false;
    this.hintT = 0; this.compT = 0;
    this.buildCompass();
    this.buildElements();
    this.bossTarget = null;
    this.qmark = document.createElement('div'); this.qmark.className = 'wmark'; this.qmark.innerHTML = '◆<span class="d"></span>'; this.el.markers.appendChild(this.qmark);
    this.barkEls = [];
    const style = document.createElement('style');
    style.textContent = `#hud.dlg #quest-tracker,#hud.dlg #crosshair,#hud.dlg #spellbar,#hud.dlg #compass,#hud.dlg #vitals,#hud.dlg #enemy-bars,#hud.dlg #stamina,#hud.dlg #prompt,#hud.dlg #hint,#hud.dlg #boss-bar{opacity:0!important;transition:opacity .4s}
      #quest-tracker,#crosshair,#spellbar,#compass,#vitals{transition:opacity .4s}
      .castname{position:absolute;left:50%;top:58%;transform:translateX(-50%);font-family:var(--blade);font-size:22px;letter-spacing:.2em;text-shadow:0 0 18px currentColor,0 2px 4px #000;animation:reactPop 1.6s ease-out forwards;white-space:nowrap}`;
    document.head.appendChild(style);
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  // ---------------- vitals ----------------
  updateHearts(hurt = false) {
    const P = G.player;
    const n = Math.ceil(P.maxHp / 4);
    let html = '';
    for (let i = 0; i < n; i++) {
      const q = clamp(P.hp - i * 4, 0, 4);
      html += `<div class="heart${hurt && q < 4 && P.hp - i * 4 > -4 && P.hp - i * 4 < 4 ? ' pop' : ''}${this.lastMax && i >= Math.ceil(this.lastMax / 4) ? ' new' : ''}">${heartSVG(q)}</div>`;
    }
    this.el.hearts.innerHTML = html;
    this.el.hearts.classList.toggle('low', P.hp <= 4);
    this.lastMax = P.maxHp;
  }
  updateXP() {
    const P = G.player;
    this.el.xpFill.style.width = `${(P.xp / xpNeed(P.level)) * 100}%`;
    this.el.xpLv.textContent = `Lv ${P.level}`;
  }
  manaShort() { const m = this.el.mana; m.classList.remove('short'); void m.offsetWidth; m.classList.add('short'); }

  // ---------------- compass ----------------
  buildCompass() {
    let html = '';
    for (let d = 0; d < 360; d += 15) {
      const card = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d];
      const mid = { 45: 'NE', 135: 'SE', 225: 'SW', 315: 'NW' }[d];
      html += card ? `<span class="card" data-a="${d}">${card}</span>` : mid ? `<span data-a="${d}" style="font-size:10px;opacity:.7">${mid}</span>` : `<span class="tick" data-a="${d}"></span>`;
    }
    this.el.compassStrip.innerHTML = html;
    this.compassItems = [...this.el.compassStrip.children].map((e) => ({ e, a: (+e.dataset.a * Math.PI) / 180 }));
    this.cmarks = new Map();
  }
  compassPos(heading, ang) {
    const rel = wrapAngle(ang - heading);
    if (Math.abs(rel) > Math.PI * 0.55) return null;
    return 260 + (rel / (Math.PI / 2)) * 260;
  }
  updateCompass() {
    const cr = G.cameraRig;
    const fx = -Math.sin(cr.yaw), fz = -Math.cos(cr.yaw);
    const heading = Math.atan2(fx, -fz);
    for (const it of this.compassItems) {
      const x = this.compassPos(heading, it.a);
      if (x === null) it.e.style.display = 'none';
      else { it.e.style.display = ''; it.e.style.left = x + 'px'; }
    }
    const P = G.player.pos;
    const marks = [];
    const q = G.story && G.story.markers();
    if (q) for (const m of q) marks.push({ id: 'q' + m.x + m.z, x: m.x, z: m.z, cls: 'quest', sym: '◆', dist: true });
    for (const L of Object.values(G.world.lanterns)) if (L.lit) marks.push({ id: 'L' + L.id, x: L.x, z: L.z, cls: '', sym: '<span style="color:#ffc870">▲</span>' });
    marks.push({ id: 'village', x: POI.bellTower.x, z: POI.bellTower.z, cls: '', sym: '<span style="color:#e8e0d0;font-size:11px">⌂</span>' });
    if (G.story && G.story.flag('prologueDone')) marks.push({ id: 'tower', x: POI.tower.x, z: POI.tower.z, cls: '', sym: '<span style="color:#b894ff;font-size:12px">✦</span>' });
    const seen = new Set();
    for (const m of marks) {
      seen.add(m.id);
      let e = this.cmarks.get(m.id);
      if (!e) { e = document.createElement('div'); e.className = 'cm ' + m.cls; this.el.compassMarkers.appendChild(e); this.cmarks.set(m.id, e); }
      const ang = Math.atan2(m.x - P.x, -(m.z - P.z));
      const x = this.compassPos(heading, ang);
      const d = Math.hypot(m.x - P.x, m.z - P.z);
      if (x === null || (d < 4 && !m.dist)) { e.style.display = 'none'; continue; }
      e.style.display = ''; e.style.left = x + 'px';
      e.innerHTML = m.sym + (m.dist ? `<span class="dist">${Math.round(d)}m</span>` : '');
    }
    for (const [id, e] of this.cmarks) if (!seen.has(id)) { e.remove(); this.cmarks.delete(id); }
  }

  // ---------------- quest tracker ----------------
  setTracker(title, obj, flash = true) {
    this.el.qtTitle.textContent = title || '';
    if (this.el.qtObj.textContent !== obj) {
      this.el.qtObj.innerHTML = obj || '';
      if (flash) { this.el.qtObj.classList.remove('flash'); void this.el.qtObj.offsetWidth; this.el.qtObj.classList.add('flash'); }
    }
    $('#quest-tracker').style.opacity = title ? 1 : 0;
  }

  // ---------------- spells ----------------
  buildElements() {
    this.el.elements.innerHTML = ELEMENTS.map((e, i) => `<div class="el" data-el="${e}" style="color:${EL_INFO[e].css}">${EL_SVG[e]}<span class="key">${i + 1}</span></div>`).join('');
    this.elNodes = {};
    for (const n of this.el.elements.children) this.elNodes[n.dataset.el] = n;
  }
  updateSpells(unlockEl) {
    const P = G.player;
    for (const e of ELEMENTS) {
      const n = this.elNodes[e];
      n.classList.toggle('locked', !P.unlocked.has(e));
      n.classList.toggle('active', P.element === e);
      n.classList.toggle('prev', P.prevElement === e && P.prevElement !== P.element);
      if (unlockEl === e) { n.classList.remove('unlock'); void n.offsetWidth; n.classList.add('unlock'); }
    }
    const info = weaveInfo(P.element, P.prevElement);
    const ok = info && P.unlocked.has(P.prevElement);
    this.el.weaveSlot.classList.toggle('off', !ok);
    if (ok) {
      this.el.weaveIcons.innerHTML = info.els.map((e) => `<span style="color:${EL_INFO[e].css}">${EL_SVG[e]}</span>`).join('');
      this.el.weaveName.textContent = info.name;
    } else { this.el.weaveIcons.innerHTML = ''; this.el.weaveName.textContent = P.unlocked.size > 1 ? '속성을 바꿔 엮기' : '엮기'; }
    this.el.heavyName.textContent = HEAVY[P.element].name;
    this.el.heavyName.style.color = EL_INFO[P.element].css;
  }
  cooldownFlash(k) {
    const n = k === 'weave' ? this.el.weaveSlot : $('#heavy-slot');
    n.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 200 });
  }
  castPulse() { const c = this.el.crosshair; c.classList.remove('cast'); void c.offsetWidth; c.classList.add('cast'); }
  castName(name, els) {
    const d = document.createElement('div');
    d.className = 'castname';
    d.style.color = EL_INFO[els[0]].css;
    d.textContent = name;
    this.el.hud.appendChild(d);
    setTimeout(() => d.remove(), 1700);
  }

  // ---------------- world-anchored ----------------
  project(pos, out = { x: 0, y: 0, vis: false }) {
    v3.copy(pos).project(G.camera);
    out.vis = v3.z < 1 && v3.z > -1 && Math.abs(v3.x) < 1.2 && Math.abs(v3.y) < 1.2;
    out.x = (v3.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-v3.y * 0.5 + 0.5) * window.innerHeight;
    return out;
  }
  damage(pos, n, el, crit, reaction, small = false) {
    const d = document.createElement('div');
    d.className = 'dmg' + (crit ? ' crit' : '') + (small ? ' small' : '');
    d.style.color = EL_INFO[el]?.css ?? '#fff';
    d.textContent = crit ? `${n}!` : n;
    this.addFloat(d, pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.5, (Math.random() - 0.5) * 0.8)), 1000);
  }
  reaction(pos, info) {
    const d = document.createElement('div');
    d.className = 'dmg react';
    d.style.color = info.color;
    d.textContent = info.name;
    this.addFloat(d, pos.clone().add(new THREE.Vector3(0, 1.3, 0)), 1400);
  }
  floatText(pos, text, color = '#fff', cls = 'info') {
    const d = document.createElement('div');
    d.className = 'dmg ' + cls;
    d.style.color = color;
    d.textContent = text;
    this.addFloat(d, pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 1200);
  }
  addFloat(el, pos, ms) {
    this.el.dmg.appendChild(el);
    const f = { el, pos, t: ms / 1000 };
    this.floats.push(f);
    this.placeFloat(f);
    if (this.floats.length > 60) { const o = this.floats.shift(); o.el.remove(); }
  }
  placeFloat(f) {
    const p = this.project(f.pos);
    f.el.style.display = p.vis ? '' : 'none';
    f.el.style.left = p.x + 'px'; f.el.style.top = p.y + 'px';
  }
  alertMark(e) {
    const d = document.createElement('div');
    d.className = 'alert-mark'; d.textContent = '!';
    this.addFloat(d, e.center().add(new THREE.Vector3(0, e.height * 0.7, 0)), 900);
  }
  playerHurt(n) {
    G.renderer.grade.uniforms.uHurt.value = 1;
  }

  bark(npc, text) {
    const d = document.createElement('div');
    d.className = 'bark';
    const sp = npc.speaker;
    d.innerHTML = `<b>${fillName(({ mora: '모라', bau: '바우 영감', dodam: '도담', isol: '이솔', danbi: '단비 아주머니', farmer: '농부 달구', fisher: '어부 소라', elder: '장기 두는 할아버지', kael: '카엘', seha: '세하' })[sp] || '', G.playerName)}</b>${fillName(text, G.playerName)}`;
    this.el.barks.appendChild(d);
    const b = { el: d, npc, t: 4 + text.length * 0.05 };
    this.barkEls.push(b);
  }
  companion(text, dur) {
    const c = this.el.comp;
    c.innerHTML = `<b>보름</b>${fillName(text, G.playerName)}`;
    c.classList.add('show');
    this.compT = dur ?? 3.5 + text.length * 0.06;
    let n = 0;
    const v = { f: 760, type: 'sine', formant: 2300, d: 0.035, v: 0.05, slide: 1.12 };
    const iv = setInterval(() => { if (n++ > Math.min(14, text.length / 3)) clearInterval(iv); else G.audio.blip(v); }, 70);
  }
  prompt(text) {
    if (!text) { this.el.prompt.classList.add('hidden'); return; }
    this.el.prompt.classList.remove('hidden');
    this.el.promptT.textContent = text;
  }
  hint(html, dur = 6) {
    const h = this.el.hint;
    h.innerHTML = html;
    h.classList.remove('hidden');
    h.style.animation = 'none'; void h.offsetWidth; h.style.animation = '';
    this.hintT = dur;
  }
  hideHint() { this.el.hint.classList.add('hidden'); this.hintT = 0; }
  areaTitle(name, en) {
    const a = this.el.area;
    a.querySelector('.at-name').textContent = name;
    a.querySelector('.at-sub').textContent = en;
    a.classList.remove('show'); void a.offsetWidth; a.classList.add('show');
  }
  banner(small, big, desc = '', color = '#fff', ms = 3800) {
    this.bannerQ.push({ small, big, desc, color, ms });
    if (!this.bannerBusy) this.nextBanner();
  }
  nextBanner() {
    const b = this.bannerQ.shift();
    if (!b) { this.bannerBusy = false; return; }
    this.bannerBusy = true;
    const el = this.el.banner;
    el.querySelector('.bn-small').textContent = b.small;
    const big = el.querySelector('.bn-big'); big.textContent = b.big; big.style.color = b.color;
    el.querySelector('.bn-desc').innerHTML = b.desc;
    el.classList.remove('hidden', 'out');
    setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.classList.add('hidden'); this.nextBanner(); }, 600); }, b.ms);
  }
  toast(html, ms = 3500) {
    const t = document.createElement('div');
    t.className = 'toast'; t.innerHTML = html;
    this.el.toasts.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 500); }, ms);
    while (this.el.toasts.children.length > 5) this.el.toasts.firstChild.remove();
  }
  bossBar(target, name) {
    this.bossTarget = target;
    if (!target) { this.el.boss.classList.add('hidden'); return; }
    this.el.boss.classList.remove('hidden');
    this.el.bossName.textContent = name || target.name;
  }

  // ---------------- per-frame ----------------
  update(dt) {
    const P = G.player;
    // mana & stamina
    const mf = (P.mana / P.maxMana) * 100;
    this.el.manaFill.style.width = mf + '%';
    this.el.manaGhost.style.width = mf + '%';
    this.el.mana.style.width = 180 + P.maxMana * 0.4 + 'px';
    const sf = P.stamina / P.maxStamina;
    this.el.stFill.style.strokeDashoffset = 251.3 * (1 - sf);
    const showSt = sf < 0.995 || P.sprinting || P.gliding;
    this.el.stamina.classList.toggle('on', showSt && G.mode === 'free');
    this.el.stamina.classList.toggle('tired', P.exhausted);
    const sp = this.project(v3.set(P.pos.x, P.pos.y + 1.2, P.pos.z));
    this.el.stamina.style.left = sp.x + 70 + 'px'; this.el.stamina.style.top = sp.y - 30 + 'px';
    // cooldowns
    this.el.weaveCd.style.width = `${(P.cd.weave / WEAVE_CD) * 100}%`;
    this.el.heavyCd.style.width = `${P.cd.heavyMax ? (P.cd.heavy / P.cd.heavyMax) * 100 : 0}%`;
    const info = weaveInfo(P.element, P.prevElement);
    this.el.weaveSlot.classList.toggle('ready', !!info && P.unlocked.has(P.prevElement) && P.cd.weave <= 0 && P.mana >= 40);
    // grade uniforms
    const g = G.renderer.grade.uniforms;
    g.uHurt.value = Math.max(0, g.uHurt.value - dt * 2.2);
    g.uLowHp.value = P.hp <= 4 && !P.dead ? 1 : 0;
    g.uImpact.value = Math.max(0, g.uImpact.value - dt * 2.5);
    g.uFlash.value = Math.max(0, g.uFlash.value - dt * 2.5);
    if (P.hp <= 4 && !P.dead && G.mode === 'free') { this.hbT = (this.hbT || 0) - dt; if (this.hbT <= 0) { this.hbT = 1.1; G.audio.play('heartbeat'); } }
    // crosshair enemy state
    let over = false;
    if (G.mode === 'free') {
      const cam = G.camera; const d = new THREE.Vector3(); cam.getWorldDirection(d);
      for (const e of G.enemies.list) {
        if (!e.alive || !e.hittable) continue;
        const to = v3.subVectors(e.center(), cam.position); const dist = to.length();
        if (dist > 60) continue;
        if (Math.acos(clamp(to.dot(d) / dist, -1, 1)) < 0.06 + Math.atan2(e.radius, dist)) { over = true; break; }
      }
    }
    this.el.crosshair.classList.toggle('enemy', over);
    this.el.crosshair.style.opacity = G.mode === 'free' ? 1 : 0;
    // lock marker
    if (P.lockTarget && P.lockTarget.alive) {
      const p = this.project(P.lockTarget.center());
      this.el.lock.classList.toggle('hidden', !p.vis);
      this.el.lock.style.left = p.x + 'px'; this.el.lock.style.top = p.y + 'px';
    } else this.el.lock.classList.add('hidden');
    // enemy bars
    const seen = new Set();
    for (const e of G.enemies.list) {
      if (!e.alive || (e.boss && e === this.bossTarget)) continue;
      const d = e.pos.distanceTo(P.pos);
      const show = (e.barT > 0 || (e.aggroed && d < 30) || P.lockTarget === e) && d < 45;
      if (!show) continue;
      const p = this.project(v3.copy(e.center()).setY(e.pos.y + e.height + 0.5));
      if (!p.vis) continue;
      seen.add(e);
      let b = this.barPool.get(e);
      if (!b) {
        b = document.createElement('div');
        b.className = 'ebar' + (e.elite ? ' elite' : '');
        b.innerHTML = `<div class="elv"><span>Lv ${e.level}</span><span class="st"></span></div><div class="etrack"><div class="efill"></div></div>${e.armor ? '<div class="armor"></div>' : ''}`;
        this.el.bars.appendChild(b); this.barPool.set(e, b);
        b._fill = b.querySelector('.efill'); b._st = b.querySelector('.st'); b._ar = b.querySelector('.armor');
      }
      b.style.left = p.x + 'px'; b.style.top = p.y + 'px';
      b._fill.style.width = (e.hp / e.maxHp) * 100 + '%';
      const st = e.st; let s = '';
      if (st.burn > 0) s += `<i style="color:${EL_INFO.fire.css}"></i>`;
      if (st.chill > 0 || st.frozen > 0) s += `<i style="color:${EL_INFO.frost.css}${st.frozen > 0 ? ';box-shadow:0 0 8px #fff' : ''}"></i>`;
      if (st.shock > 0) s += `<i style="color:${EL_INFO.storm.css}"></i>`;
      if (st.wet > 0) s += `<i style="color:#4a8aff"></i>`;
      if (b._s !== s) { b._st.innerHTML = s; b._s = s; }
      if (b._ar) b._ar.style.opacity = st.armorBroken > 0 ? 0 : 1;
    }
    for (const [e, b] of this.barPool) if (!seen.has(e)) { b.remove(); this.barPool.delete(e); }
    // boss bar
    if (this.bossTarget) {
      const t = this.bossTarget;
      const f = Math.max(0, t.hp / t.maxHp) * 100;
      this.el.bossFill.style.width = f + '%'; this.el.bossGhost.style.width = f + '%';
      if (!t.alive && t.hp <= 0) setTimeout(() => this.bossBar(null), 1500);
    }
    // floats
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i]; f.t -= dt;
      if (f.t <= 0) { f.el.remove(); this.floats.splice(i, 1); continue; }
      this.placeFloat(f);
    }
    // barks
    for (let i = this.barkEls.length - 1; i >= 0; i--) {
      const b = this.barkEls[i]; b.t -= dt;
      if (b.t <= 0 || G.mode !== 'free') { b.el.remove(); this.barkEls.splice(i, 1); continue; }
      const p = this.project(b.npc.headPos().add(new THREE.Vector3(0, 0.55, 0)));
      b.el.style.display = p.vis ? '' : 'none';
      b.el.style.left = p.x + 'px'; b.el.style.top = p.y + 'px';
    }
    // quest world marker
    const qm = G.story && G.story.markers();
    if (qm && qm.length && G.mode === 'free') {
      const m = qm[0];
      const gy = G.world.h(m.x, m.z);
      const p = this.project(v3.set(m.x, gy + (m.h ?? 3.5), m.z));
      const d = Math.hypot(m.x - P.pos.x, m.z - P.pos.z);
      this.qmark.style.display = p.vis && d > 8 ? '' : 'none';
      this.qmark.style.left = p.x + 'px'; this.qmark.style.top = p.y + 'px';
      this.qmark.querySelector('.d').textContent = Math.round(d) + 'm';
    } else this.qmark.style.display = 'none';
    // hint / companion timers
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hideHint(); }
    if (this.compT > 0) { this.compT -= dt; if (this.compT <= 0) this.el.comp.classList.remove('show'); }
    this.compassT = (this.compassT || 0) - dt;
    if (this.compassT <= 0) { this.compassT = 0.05; this.updateCompass(); }
  }

  // ---------------- map ----------------
  drawMap() {
    const cv = $('#map-canvas'); const g = cv.getContext('2d');
    const S = cv.width, T = G.world.terrain;
    if (!this.mapBase) {
      const off = document.createElement('canvas'); off.width = off.height = T.N;
      const og = off.getContext('2d'); const img = og.createImageData(T.N, T.N);
      const toS = (c) => Math.round(Math.pow(Math.min(1, c), 1 / 2.2) * 255);
      for (let i = 0; i < T.N * T.N; i++) {
        const h = T.h[i];
        let r = T.col[i * 3], gg = T.col[i * 3 + 1], b = T.col[i * 3 + 2];
        // hillshade
        const ix = i % T.N, iz = Math.floor(i / T.N);
        const hl = T.h[iz * T.N + Math.max(0, ix - 1)], hu = T.h[Math.max(0, iz - 1) * T.N + ix];
        const shade = clamp(1 + (hl - h) * 0.06 + (hu - h) * 0.06, 0.6, 1.3);
        r *= shade; gg *= shade; b *= shade;
        if (h < 0) { const k = clamp(-h / 6, 0, 1); r = 0.25 - k * 0.15; gg = 0.55 - k * 0.2; b = 0.62 - k * 0.1; }
        img.data[i * 4] = toS(r); img.data[i * 4 + 1] = toS(gg); img.data[i * 4 + 2] = toS(b); img.data[i * 4 + 3] = 255;
      }
      og.putImageData(img, 0, 0);
      this.mapBase = off;
    }
    g.imageSmoothingEnabled = true;
    g.drawImage(this.mapBase, 0, 0, S, S);
    // parchment tint
    g.fillStyle = 'rgba(40,30,15,0.18)'; g.fillRect(0, 0, S, S);
    const w2s = (x, z) => [((x + 240) / 480) * S, ((z + 240) / 480) * S];
    const label = (x, z, t, c = '#fff', size = 14) => { const [sx, sz] = w2s(x, z); g.font = `${size}px 'Hahmlet', serif`; g.fillStyle = 'rgba(0,0,0,.6)'; g.textAlign = 'center'; g.fillText(t, sx + 1, sz + 1); g.fillStyle = c; g.fillText(t, sx, sz); };
    label(0, 38, '하늬 마을', '#fff4d8', 16);
    label(POI.tower.x, POI.tower.z + 12, '모라의 탑', '#e0d0ff');
    label(POI.lake.x, POI.lake.z, '거울 호수', '#d8f0ff');
    const S_ = G.story;
    if (S_ && S_.flag('worldOpen')) {
      label(POI.frost.x, POI.frost.z + 14, '서리봉 성소', '#bfefff');
      label(POI.storm.x, POI.storm.z + 16, '천둥 고원', '#ffe890');
      label(POI.rift.x, POI.rift.z + 18, '고요의 틈', '#d0b0ff');
    }
    label(POI.meadow.x, POI.meadow.z + 10, '노을 들판', '#ffe0b0', 12);
    // lanterns
    this.mapLanterns = [];
    for (const L of Object.values(G.world.lanterns)) {
      const [sx, sz] = w2s(L.x, L.z);
      g.beginPath(); g.arc(sx, sz, L.lit ? 7 : 5, 0, Math.PI * 2);
      g.fillStyle = L.lit ? '#ffc870' : 'rgba(80,80,80,.8)'; g.fill();
      g.strokeStyle = '#1a1208'; g.lineWidth = 2; g.stroke();
      if (L.lit) this.mapLanterns.push({ L, sx, sz });
    }
    // quest markers
    const qm = S_ && S_.markers();
    if (qm) for (const m of qm) { const [sx, sz] = w2s(m.x, m.z); g.fillStyle = '#f1d48a'; g.save(); g.translate(sx, sz); g.rotate(Math.PI / 4); g.fillRect(-7, -7, 14, 14); g.strokeStyle = '#000'; g.strokeRect(-7, -7, 14, 14); g.restore(); }
    // player
    const P = G.player; const [px, pz] = w2s(P.pos.x, P.pos.z);
    g.save(); g.translate(px, pz); g.rotate(-P.yaw + Math.PI);
    g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath();
    g.fillStyle = '#5ad0ff'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); g.restore();
    // legend
    $('.map-keys').innerHTML = `<div><span style="color:#5ad0ff">▲</span> 현재 위치</div><div><span style="color:#f1d48a">◆</span> 목표</div><div><span style="color:#ffc870">●</span> 밝힌 등석<br><small style="opacity:.7">— 클릭하면 그곳으로 이동</small></div><div style="margin-top:14px;opacity:.8">노래 씨앗 ${G.story ? G.story.seedCount() : 0} / 16</div>`;
  }
  mapClick(ev) {
    const cv = $('#map-canvas');
    const r = cv.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * cv.width, y = ((ev.clientY - r.top) / r.height) * cv.height;
    for (const m of this.mapLanterns || []) if (Math.hypot(m.sx - x, m.sz - y) < 14) return m.L;
    return null;
  }

  // ---------------- journal ----------------
  drawJournal(tab = 'quests') {
    const body = $('.jr-body');
    document.querySelectorAll('.jr-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const S = G.story, P = G.player;
    if (tab === 'quests') {
      const qs = S ? Object.values(S.quests) : [];
      const act = qs.filter((q) => q.state === 'active'), done = qs.filter((q) => q.state === 'done');
      const row = (q) => `<div class="jq ${q.state === 'done' ? 'done' : ''}"><h3>${q.title}<small>${q.type === 'main' ? '이야기' : '곁가지'}</small></h3><p>${fillName(q.desc || '', G.playerName)}</p>${q.state === 'active' && q.obj ? `<p class="obj">▸ ${q.obj}</p>` : ''}</div>`;
      body.innerHTML = `<div class="jsec">진행 중</div>${act.map(row).join('') || '<p style="opacity:.6">진행 중인 여정이 없다.</p>'}<div class="jsec">지난 여정</div>${done.map(row).join('') || '<p style="opacity:.6">—</p>'}`;
    } else if (tab === 'spells') {
      let h = `<div class="jsec">속성의 노래 · 레벨 ${P.level} · 마법 위력 ${P.power().toFixed(1)}</div>`;
      for (const e of ELEMENTS) {
        const u = P.unlocked.has(e);
        h += `<div class="jsp ${u ? '' : 'locked'}"><div class="ic" style="color:${EL_INFO[e].css}">${EL_SVG[e]}</div><div><h4 style="color:${EL_INFO[e].css}">${u ? EL_INFO[e].name + '의 노래' : '??? 의 노래'}</h4>${u ? `<p>${EL_INFO[e].desc}</p><p><b>좌클릭 · ${BOLT[e].name}</b> — ${BOLT[e].desc}</p><p><b>우클릭 · ${HEAVY[e].name}</b> (마나 ${HEAVY[e].cost}) — ${HEAVY[e].desc}</p>` : '<p>아직 배우지 못한 노래.</p>'}</div></div>`;
      }
      h += `<div class="jsec">엮기 (Q) — 지금 속성 + 직전 속성 · 마나 40</div><div class="react-grid">`;
      for (const [k, w] of Object.entries(WEAVE)) {
        const els = k === 'arcane' ? ['arcane'] : k.split('+');
        const u = els.every((e) => P.unlocked.has(e));
        h += `<div style="opacity:${u ? 1 : 0.35}"><b>${k === 'arcane' ? '비전 + 아무 속성' : els.map((e) => EL_INFO[e].name).join(' + ')} → ${w.name}</b><br>${w.desc}</div>`;
      }
      h += `</div><div class="jsec">원소 반응</div><div class="react-grid">`;
      for (const r of Object.values(REACTIONS)) h += `<div><b style="color:${r.color}">${r.name}</b> — ${r.desc}</div>`;
      h += '</div>';
      body.innerHTML = h;
    } else if (tab === 'memories') {
      let h = `<div class="jsec">모라의 기억 — 골짜기에 두고 온 것들</div>`;
      for (const [id, m] of Object.entries(MEMORIES)) {
        const st = S ? S.memoryState(id) : 'none';
        h += `<div class="jq ${st === 'given' ? 'done' : ''}"><h3>${st === 'none' ? '???' : m.name}<small>${st === 'given' ? '전해 줌' : st === 'have' ? '가지고 있음' : ''}</small></h3><p>${st === 'none' ? '아직 찾지 못했다.' : m.desc}</p></div>`;
      }
      h += `<div class="jsec">노래 씨앗</div><p>골짜기 곳곳에서 들려오는 작은 노랫소리를 따라가면 씨앗을 찾을 수 있다. 네 개를 모을 때마다 울림이 깊어진다.<br>모은 씨앗: <b>${S ? S.seedCount() : 0} / 16</b></p>`;
      body.innerHTML = h;
    } else {
      const rows = [
        ['W A S D', '이동'], ['마우스', '시점 · 조준 (화면 클릭 시 마우스 고정)'], ['Shift 누르기', '달리기'], ['Shift 짧게', '순간이동 (회피, 무적 시간)'],
        ['Space', '점프 / 공중에서 누르고 있기: 활공'], ['좌클릭', '기본 마법 (누르고 있으면 연사)'], ['우클릭', '고유 마법'], ['Q', '엮기: 현재 속성 + 직전 속성'],
        ['1 ~ 5 / 휠', '속성 전환'], ['T / 휠 클릭', '대상 고정'], ['E', '대화 · 조사 · 상호작용'], ['M', '지도 (등석 클릭: 빠른 이동)'], ['Tab / J', '여정 · 마법서'], ['Esc', '일시 정지'],
      ];
      body.innerHTML = `<div class="jsec" style="text-align:center">조작</div><div class="ctrl-grid">${rows.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('')}</div>
        <div class="jsec" style="text-align:center;margin-top:30px">요령</div><p style="max-width:620px;margin:0 auto;opacity:.85">· 속성을 번갈아 쓰면 적에게 쌓인 상태와 반응한다. 얼리고 → 번개로 부수고, 적시고 → 번개로 감전시키고, 불태우고 → 바람으로 퍼뜨려라.<br>· 흐느낌의 구체는 마법으로 맞혀 없앨 수 있다.<br>· 활공 중 바람의 고유 마법을 쓰면 상승 기류를 탄다.<br>· 서리 마법은 물 위에 얼음 발판을 만든다.<br>· 등석을 밝히면 체력을 회복하고, 쓰러졌을 때 그곳에서 깨어난다.</p>`;
    }
  }
}
