// DOM HUD: vitals, compass, spell bar, world-anchored labels, banners, map & journal.
import * as THREE from 'three';
import { G, ELEMENTS, EL_INFO, EL_SVG } from '../core/context.js';
import { BOLT, HEAVY, CHARGED, WEAVE, weaveInfo, WEAVE_CD, WEAVE_COST, ultInfo } from './spells.js';
import { TREES, TREE_ORDER, NODES, ULTS, ULT_COST, TIER_GATE, SIG, WEAVE_NODE, isTechnique, treeColor } from './skills.js';
import { REACTIONS } from './combat.js';
import { FIELD_MIX, FIELDS } from './fields.js';
import { xpNeed } from './player.js';
import { wrapAngle, clamp, fillName, josa } from '../core/util.js';
import { LANTERNS, MEMORIES } from '../world/world.js';
import { POI } from '../world/layout.js';
import { OUTER } from '../world/regions/index.js';
import { Minimap } from './minimap.js';

// Elements the player has not awakened stay hidden everywhere in the UI.
const elKnown = (e) => e === '*' || G.player.unlocked.has(e);
const veiled = (n) => n.kind === 'harmony' && !n.els.every(elKnown);

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
      boss: $('#boss-bar'), bossName: $('.boss-name'), bossFill: $('.boss-fill'), bossGhost: $('.boss-ghost'), bossTrack: $('.boss-track'), bossBreak: $('.boss-break'), bossBreakFill: $('.boss-break-fill'),
      bars: $('#enemy-bars'), dmg: $('#dmg-layer'), markers: $('#markers-layer'), prompt: $('#prompt'), promptT: $('#prompt .pt'),
      hint: $('#hint'), area: $('#area-title'), banner: $('#banner'), toasts: $('#toasts'), comp: $('#companion-line'), barks: $('#barks'),
      sp: $('#sp-badge'), ult: $('#ult-slot'), ultName: $('#ult-slot .un'), ultGauge: $('#ult-slot .ug'),
      manaTrack: $('.mana-track'), manaPrev: $('.mana-preview'), tickH: $('.mana-tick.t-heavy'), tickW: $('.mana-tick.t-weave'),
      manaNum: $('.mana-num b'), manaMax: $('.mana-num span'), heavySlot: $('#heavy-slot'), heavyCost: $('.heavy-cost'), weaveCost: $('.weave-cost'),
      chNote: $('.ch-note'), crBadge: $('#cr-badge'), crBadgeSub: $('#cr-badge small'),
    };
    this.mv = {};
    this.skTree = 'arcane'; this.skSel = null;
    this.floats = [];
    this.barPool = new Map();
    this.lastHp = -1;
    this.bannerQ = []; this.bannerBusy = false;
    this.hintT = 0; this.hintAge = 0; this.hintQ = []; this.compT = 0;
    this.buildCompass();
    this.buildElements();
    this.minimap = new Minimap($('#minimap'));
    this.mapInput();
    this.applyScale();
    window.addEventListener('resize', () => this.applyScale());
    this.bossTarget = null;
    this.qmark = document.createElement('div'); this.qmark.className = 'wmark'; this.qmark.innerHTML = '◆<span class="d"></span>'; this.el.markers.appendChild(this.qmark);
    this.barkEls = [];
    const style = document.createElement('style');
    style.textContent = `#hud.dlg #quest-tracker,#hud.dlg #crosshair,#hud.dlg #spellbar,#hud.dlg #compass,#hud.dlg #vitals,#hud.dlg #enemy-bars,#hud.dlg #stamina,#hud.dlg #prompt,#hud.dlg #hint,#hud.dlg #boss-bar,#hud.dlg #minimap{opacity:0!important;transition:opacity .4s}
      #quest-tracker,#crosshair,#spellbar,#compass,#vitals{transition:opacity .4s}
      .castname{position:absolute;left:50%;top:58%;transform:translateX(-50%);font-family:var(--blade);font-size:22px;letter-spacing:.2em;text-shadow:0 0 18px currentColor,0 2px 4px #000;animation:reactPop 1.6s ease-out forwards;white-space:nowrap}
      .castname.big{top:30%;font-family:var(--title);font-size:46px;letter-spacing:.3em;animation:ultPop 2.2s ease-out forwards}`;
    document.head.appendChild(style);
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }
  // Interface size follows the window (1600×900 = 1, eased so it neither balloons on big
  // screens nor shrinks to unreadable on small ones) times the player's own setting.
  applyScale() {
    const fit = Math.min(innerWidth / 1600, innerHeight / 900);
    const s = clamp(Math.pow(fit, 0.8), 0.68, 1.5) * clamp((G.settings.ui ?? 100) / 100, 0.75, 1.35);
    document.documentElement.style.setProperty('--ui', s.toFixed(3));
    this.uiScale = s;
  }

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
  restart(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  // not enough mana: bar shake + red flash, "마나 부족" under the crosshair (rate-limited)
  manaShort(cost) {
    this.restart(this.el.mana, 'short');
    clearTimeout(this.shortT); this.shortT = setTimeout(() => this.el.mana.classList.remove('short'), 650);
    const now = performance.now();
    if (now - (this.noteT || 0) > 900) {
      this.noteT = now;
      const P = G.player;
      this.el.chNote.innerHTML = `마나 부족${cost ? ` <small>${Math.floor(P.mana)} / ${cost}</small>` : ''}`;
      this.restart(this.el.chNote, 'show');
    }
  }
  manaGain(n, o = {}) {
    const now = performance.now();
    if (now - (this.gainT || 0) > 90) { this.gainT = now; this.restart(this.el.manaTrack, 'gain'); }
    if (o.src === 'dodge') this.floatText(G.player.center().add(v3.set(0.4, 0.2, 0)), `+${Math.round(n)} 마나`, '#9fdcff', 'info');
  }
  manaFull() { this.restart(this.el.manaTrack, 'full'); }

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
      // an element the player has not awakened stays out of sight: finding it is the surprise
      n.classList.toggle('gone', !P.unlocked.has(e));
      n.classList.toggle('active', P.element === e);
      n.classList.toggle('prev', P.prevElement === e && P.prevElement !== P.element);
      if (unlockEl === e) { n.classList.remove('unlock'); void n.offsetWidth; n.classList.add('unlock'); }
    }
    const info = weaveInfo(P.element, P.prevElement);
    const wKnown = P.canWeave();
    const ok = wKnown && info && P.unlocked.has(P.prevElement);
    this.el.weaveSlot.classList.toggle('off', !ok);
    this.el.weaveSlot.classList.toggle('locked', !wKnown);
    this.el.weaveSlot.classList.toggle('hidden', P.unlocked.size < 2 && !wKnown);
    if (ok) {
      this.el.weaveIcons.innerHTML = info.els.map((e) => `<span style="color:${EL_INFO[e].css}">${EL_SVG[e]}</span>`).join('');
      this.el.weaveName.textContent = info.name;
    } else { this.el.weaveIcons.innerHTML = ''; this.el.weaveName.textContent = !wKnown ? '엮기' : P.unlocked.size > 1 ? '속성을 바꿔 엮기' : '엮기'; }
    this.el.weaveCost.innerHTML = wKnown ? `<i></i>${WEAVE_COST}` : '미습득';
    const hKnown = P.canHeavy();
    this.el.heavySlot.classList.toggle('locked', !hKnown);
    this.el.heavySlot.classList.toggle('hidden', !hKnown && !(G.skills && Object.values(SIG).some((id) => G.skills.has(id))));
    this.el.heavyName.textContent = HEAVY[P.element].name;
    this.el.heavyName.style.color = hKnown ? EL_INFO[P.element].css : '';
    this.el.heavyCost.innerHTML = hKnown ? `<i></i>${HEAVY[P.element].cost}` : '미습득';
    this.el.tickH.style.setProperty('--tc', EL_INFO[P.element].css);
    this.updateUlt();
    this.updateSP();
  }
  updateUlt() {
    const K = G.skills, P = G.player;
    const any = K && Object.values(ULTS).some((id) => K.has(id));
    this.el.ult.classList.toggle('hidden', !any);
    if (!any) return;
    const id = K.ultFor(P.element);
    this.el.ult.classList.toggle('none', !id);
    this.el.ultName.textContent = id ? NODES[id].name : '궁극기 없음';
    this.el.ult.style.color = EL_INFO[P.element].css;
  }
  updateSP(flash = false) {
    const K = G.skills; if (!K) return;
    const b = this.el.sp;
    b.classList.toggle('hidden', K.points <= 0);
    b.querySelector('b').textContent = K.points;
    if (flash) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
  }
  ultReady() { const u = this.el.ult; u.classList.remove('flash'); void u.offsetWidth; u.classList.add('flash'); }
  ultShort() { this.el.ult.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 200 }); this.toast(`울림 게이지가 아직 차지 않았다 — 적을 맞히고, 특히 <b>원소 반응</b>을 일으키면 빨리 찬다`); }
  chain(n, kinds) {
    let el = this.chainEl;
    if (!el) { el = this.chainEl = document.createElement('div'); el.className = 'chain'; this.el.hud.appendChild(el); }
    el.innerHTML = `<span class="cn">${n}</span><span class="cl">연쇄 반응${kinds > 1 ? ` · ${kinds}종` : ''}</span>`;
    el.classList.remove('bump', 'out'); void el.offsetWidth; el.classList.add('bump');
    clearTimeout(this.chainT); this.chainT = setTimeout(() => el.classList.add('out'), 3800);
  }
  chainEnd(n, xp) { if (this.chainEl) { this.chainEl.innerHTML = `<span class="cn">${n}</span><span class="cl">연쇄 반응 · +${xp} XP</span>`; this.chainEl.classList.add('out'); } }
  discovered(r) {
    if (r.startsWith('f:')) {
      const m = FIELD_MIX[r.slice(2)];
      if (m) this.toast(`<span style="color:${m.color}">땅의 흔적 변화 발견 — <b>${m.name}</b></span> · ${m.desc}`, 5200);
      return;
    }
    const info = REACTIONS[r];
    if (!info) return;
    this.toast(`<span style="color:${info.color}">새로운 반응 발견 — <b>${info.name}</b></span> · ${info.desc}`, 5200);
  }
  cooldownFlash(k) {
    const n = k === 'weave' ? this.el.weaveSlot : this.el.heavySlot;
    n.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 200 });
  }
  // charged basic spell: a ring around the crosshair fills while the button is held
  chargeRing(k, ready, el, affordable = true) {
    let r = this.chargeEl;
    if (!r) { r = this.chargeEl = document.createElement('div'); r.className = 'ch-charge'; this.el.crosshair.appendChild(r); }
    if (k <= 0) { r.classList.remove('on', 'ready', 'short'); return; }
    r.style.setProperty('--k', k.toFixed(3));
    r.style.setProperty('--c', EL_INFO[el]?.css ?? '#fff');
    r.classList.add('on');
    r.classList.toggle('ready', ready);
    r.classList.toggle('short', !affordable);
  }
  castPulse() { const c = this.el.crosshair; c.classList.remove('cast'); void c.offsetWidth; c.classList.add('cast'); }
  castName(name, els, big = false) {
    const d = document.createElement('div');
    d.className = 'castname' + (big ? ' big' : '');
    d.style.color = EL_INFO[els[0]].css;
    d.textContent = name;
    this.el.hud.appendChild(d);
    setTimeout(() => d.remove(), big ? 2300 : 1700);
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
    c.innerHTML = `<b>보름</b>${fillName(text, G.playerName).replace(/\*([^*]+)\*/g, '<em>$1</em>')}`;
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
  // Tutorial tips sit in a card at the left edge, away from the aim point. A tip that
  // arrives while another is still fresh waits its turn, and the timer only runs in free
  // play so a tip shown during a dialogue is not lost behind it.
  hint(html, dur = 6) {
    const h = this.el.hint;
    if (this.hintT > 0 && this.hintAge < 2.5 && h.innerHTML !== html) {
      if (!this.hintQ.some((q) => q.html === html) && this.hintQ.length < 3) this.hintQ.push({ html, dur });
      return;
    }
    this.hintAge = 0;
    h.innerHTML = html;
    h.classList.remove('hidden');
    h.style.animation = 'none'; void h.offsetWidth; h.style.animation = '';
    this.hintT = dur;
  }
  hideHint() {
    this.el.hint.classList.add('hidden'); this.hintT = 0;
    const q = this.hintQ.shift();
    if (q) setTimeout(() => this.hint(q.html, q.dur), 400);
  }
  // not enough stamina for a climbing lunge: the wheel shakes red
  staminaShort() {
    const e = this.el.stamina;
    e.classList.remove('short'); void e.offsetWidth; e.classList.add('short');
    G.audio.play('mana_empty', { v: 0.5 });
  }
  inCombat() { return !!(G.bossActive || (G.enemies && G.enemies.inCombat())); }
  areaTitle(name, en) {
    if (!name || this.inCombat()) return; // nameless between-lands; a region name mid-fight is noise
    const a = this.el.area;
    a.querySelector('.at-name').textContent = name;
    a.querySelector('.at-sub').textContent = en;
    a.classList.remove('show'); void a.offsetWidth; a.classList.add('show');
  }
  // o.minor: frequent notices (quests, waystones, seeds, level-ups) always use the slim ribbon
  // under the compass; the full band is kept for rare moments (a new song, Mora's memories…)
  banner(small, big, desc = '', color = '#fff', ms = 3800, o = {}) {
    this.bannerQ.push({ small, big, desc, color, ms, minor: !!o.minor });
    if (!this.bannerBusy) this.nextBanner();
  }
  nextBanner() {
    if (G.game && G.game.menu && this.bannerQ.length) { this.bannerBusy = true; setTimeout(() => this.nextBanner(), 300); return; }
    const b = this.bannerQ.shift();
    if (!b) { this.bannerBusy = false; return; }
    this.bannerBusy = true;
    const el = this.el.banner;
    el.querySelector('.bn-small').textContent = b.small;
    const big = el.querySelector('.bn-big'); big.textContent = b.big; big.style.color = b.color;
    el.querySelector('.bn-desc').innerHTML = b.desc;
    // in a fight the banner shrinks to a thin ribbon under the compass instead of a band across the middle
    const compact = this.inCombat();
    el.classList.toggle('compact', compact);
    el.classList.toggle('minor', !compact && b.minor);
    el.classList.remove('hidden', 'out');
    // a menu opened on top (the level-up crossroads, the map…) holds the banner; it gets a
    // moment of its own once the menu closes instead of bleeding through the menu
    const finish = () => {
      if (G.game && G.game.menu) { this.bannerHeld = true; setTimeout(finish, 300); return; }
      if (this.bannerHeld) { this.bannerHeld = false; setTimeout(finish, 1400); return; }
      el.classList.add('out'); setTimeout(() => { el.classList.add('hidden'); this.nextBanner(); }, 600);
    };
    setTimeout(finish, compact ? Math.min(b.ms, 2600) : b.ms);
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
    // phase thresholds as notches on the health bar
    for (const n of this.el.bossTrack.querySelectorAll('.boss-notch')) n.remove();
    for (const a of target.phaseAt || []) {
      const n = document.createElement('i'); n.className = 'boss-notch'; n.style.left = a * 100 + '%';
      this.el.bossTrack.appendChild(n);
    }
    this.el.bossBreak.classList.toggle('hidden', !target.brk);
    this.bossBrk = null;
    if (target.brk && G.story && G.story.once('hint_break')) this.hint('<b>무너짐</b> — 보스 체력 아래의 금빛 줄<br><small>강한 마법과 <b>원소 반응</b>으로 채우면 보스가 무너져 잠시 무방비가 된다. 한동안 맞히지 않으면 줄어든다</small>', 9);
  }

  // ---------------- mana bar ----------------
  updateMana() {
    const P = G.player, E = this.el, mv = this.mv;
    const max = P.maxMana, m = P.mana, pc = (v) => `${clamp(v / max, 0, 1) * 100}%`;
    const w = Math.round(Math.min(330, 150 + max * 0.5));
    if (mv.w !== w) { mv.w = w; E.manaTrack.style.width = w + 'px'; }
    E.manaFill.style.width = pc(m); E.manaGhost.style.width = pc(m);
    const mi = Math.floor(m);
    if (mv.m !== mi) { mv.m = mi; E.manaNum.textContent = mi; }
    if (mv.max !== max) { mv.max = max; E.manaMax.textContent = `/ ${max}`; }
    const free = G.slowmo > 0;
    const hKnown = P.canHeavy(), wKnown = P.canWeave();
    const hc = hKnown ? HEAVY[P.element].cost : 0;
    const hOk = !hKnown || m >= hc || (free && hc < 10), wOk = !wKnown || m >= WEAVE_COST;
    // cost ticks
    const tk = `${hc}|${wKnown}|${max}`;
    if (mv.tk !== tk) {
      mv.tk = tk;
      E.tickH.style.display = hc > 0 ? '' : 'none'; E.tickH.style.left = pc(hc);
      E.tickW.style.display = wKnown ? '' : 'none'; E.tickW.style.left = pc(WEAVE_COST);
    }
    E.tickH.classList.toggle('short', !hOk); E.tickW.classList.toggle('short', !wOk);
    // preview: what the current signature spell would take from the pool
    if (hc > 0 && hOk && !free) { E.manaPrev.style.display = ''; E.manaPrev.style.left = pc(m - hc); E.manaPrev.style.width = pc(hc); }
    else E.manaPrev.style.display = 'none';
    const low = hKnown ? m < hc : m / max < 0.2;
    if (mv.low !== low) { mv.low = low; E.mana.classList.toggle('low', low); }
    const regen = P.regenRate > 0;
    if (mv.regen !== regen) { mv.regen = regen; E.mana.classList.toggle('regen', regen); }
    if (mv.hno !== !hOk) { mv.hno = !hOk; E.heavySlot.classList.toggle('nomana', !hOk); }
    if (mv.wno !== !wOk) { mv.wno = !wOk; E.weaveSlot.classList.toggle('nomana', !wOk); }
    const info = weaveInfo(P.element, P.prevElement);
    E.weaveSlot.classList.toggle('ready', wKnown && !!info && P.unlocked.has(P.prevElement) && P.cd.weave <= 0 && wOk);
  }

  // ---------------- per-frame ----------------
  update(dt) {
    const P = G.player;
    if (G.mode === 'free' && !G.game.menu) this.minimap.update(dt, this.ensureMapBase());
    // mana & stamina
    this.updateMana();
    const sf = P.stamina / P.maxStamina;
    this.el.stFill.style.strokeDashoffset = 251.3 * (1 - sf);
    const showSt = sf < 0.995 || P.sprinting || P.gliding || !!P.climbing;
    this.el.stamina.classList.toggle('on', showSt && G.mode === 'free');
    this.el.stamina.classList.toggle('tired', P.exhausted);
    const sp = this.project(v3.set(P.pos.x, P.pos.y + 1.2, P.pos.z));
    this.el.stamina.style.left = sp.x + 70 + 'px'; this.el.stamina.style.top = sp.y - 30 + 'px';
    // cooldowns
    this.el.weaveCd.style.width = `${(P.cd.weave / WEAVE_CD) * 100}%`;
    this.el.heavyCd.style.width = `${P.cd.heavyMax ? (P.cd.heavy / P.cd.heavyMax) * 100 : 0}%`;
    if (G.skills && !this.el.ult.classList.contains('hidden')) {
      const k = G.skills.gauge / ULT_COST;
      this.el.ultGauge.style.strokeDashoffset = 119.4 * (1 - k);
      this.el.ult.classList.toggle('ready', k >= 1 && !this.el.ult.classList.contains('none'));
    }
    // pending level-up crossroads badge
    const cr = G.skills && G.skills.cross > 0 && G.game.menu !== 'crossroads';
    if (this.el.crBadge.classList.contains('hidden') === !!cr) this.el.crBadge.classList.toggle('hidden', !cr);
    if (cr) {
      const t = G.enemies.inCombat() ? '전투가 끝나면 고를 수 있다' : G.mode !== 'free' ? '이야기가 끝나면 고를 수 있다' : '곧 열린다';
      if (this.el.crBadgeSub.textContent !== t) this.el.crBadgeSub.textContent = t;
    }
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
        const weak = Object.entries(e.resist || {}).filter(([k, v]) => v >= 1.2 && EL_INFO[k]).map(([k]) => `<i class="wk" style="color:${EL_INFO[k].css}" title="약점">${EL_SVG[k]}</i>`).join('');
        const imm = (e.immune || []).filter((k) => EL_INFO[k]).map((k) => `<i class="wk im" style="color:${EL_INFO[k].css}" title="면역">${EL_SVG[k]}</i>`).join('');
        b.innerHTML = `<div class="en">${e.name || ''}</div><div class="elv"><span>Lv ${e.level}</span><span class="st"></span><span class="wks">${weak}${imm}</span></div><div class="etrack"><div class="efill"></div></div>${e.armor ? '<div class="armor"></div>' : ''}`;
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
      if (st.electro > 0) s += `<i style="color:${EL_INFO.storm.css};box-shadow:0 0 6px ${EL_INFO.storm.css}"></i>`;
      if (st.steam > 0) s += `<i style="color:#e8f4ff;opacity:.8"></i>`;
      if (b._s !== s) { b._st.innerHTML = s; b._s = s; }
      if (b._ar) b._ar.style.opacity = st.armorBroken > 0 ? 0 : 1;
    }
    for (const [e, b] of this.barPool) if (!seen.has(e)) { b.remove(); this.barPool.delete(e); }
    // boss bar
    if (this.bossTarget) {
      const t = this.bossTarget;
      const f = Math.max(0, t.hp / t.maxHp) * 100;
      this.el.bossFill.style.width = f + '%'; this.el.bossGhost.style.width = f + '%';
      const b = t.brk;
      if (b) {
        const st = b.down > 0 ? 'down' : b.lock > 0 ? 'lock' : '';
        this.el.bossBreakFill.style.width = (b.v / 100) * 100 + '%';
        if (this.bossBrk !== st) { this.bossBrk = st; this.el.bossBreak.classList.toggle('down', st === 'down'); this.el.bossBreak.classList.toggle('lock', st === 'lock'); }
      }
      if (!t.alive && t.hp <= 0 && this.bossGone !== t) { this.bossGone = t; setTimeout(() => this.bossBar(null), 1500); }
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
    if (this.hintT > 0 && G.mode === 'free' && !G.paused) { this.hintT -= dt; this.hintAge += dt; if (this.hintT <= 0) this.hideHint(); }
    if (this.compT > 0) { this.compT -= dt; if (this.compT <= 0) this.el.comp.classList.remove('show'); }
    this.compassT = (this.compassT || 0) - dt;
    if (this.compassT <= 0) { this.compassT = 0.05; this.updateCompass(); }
  }

  // ---------------- map ----------------
  // Terrain colours with hillshade, one pixel per terrain sample; shared by the map and the minimap.
  ensureMapBase() {
    if (this.mapBase) return this.mapBase;
    const T = G.world.terrain;
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
    return this.mapBase;
  }
  // Map view: centre and width in metres. Opens on the player; the wheel zooms about the
  // cursor, dragging pans. Places not yet seen lie under fog (G.atlas).
  openMap() {
    const P = G.player.pos;
    this.mapView = { x: P.x, z: P.z, span: 520 };
    this.clampMap();
    this.drawMap();
  }
  clampMap() {
    const T = G.world.terrain, V = this.mapView;
    V.span = clamp(V.span, 200, T.size);
    V.x = clamp(V.x, -T.half + V.span / 2, T.half - V.span / 2);
    V.z = clamp(V.z, -T.half + V.span / 2, T.half - V.span / 2);
  }
  // canvas pixel under a mouse event
  mapPx(ev) {
    const cv = $('#map-canvas'), r = cv.getBoundingClientRect();
    return [((ev.clientX - r.left) / r.width) * cv.width, ((ev.clientY - r.top) / r.height) * cv.height];
  }
  mapInput() {
    const cv = $('#map-canvas');
    let drag = null;
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.mapView) return;
      const V = this.mapView, S = cv.width, [px, py] = this.mapPx(e);
      const wx = V.x + (px / S - 0.5) * V.span, wz = V.z + (py / S - 0.5) * V.span;
      V.span *= Math.pow(1.0015, e.deltaY);
      this.clampMap();
      // keep the point under the cursor where it was
      V.x = wx - (px / S - 0.5) * V.span; V.z = wz - (py / S - 0.5) * V.span;
      this.clampMap();
      this.drawMap();
    }, { passive: false });
    cv.addEventListener('mousedown', (e) => { if (e.button === 0 && this.mapView) drag = { p: this.mapPx(e), x: this.mapView.x, z: this.mapView.z, moved: false }; });
    window.addEventListener('mouseup', () => { if (drag) this.mapDragged = drag.moved; drag = null; });
    cv.addEventListener('mousemove', (e) => {
      if (drag) {
        const [px, py] = this.mapPx(e), V = this.mapView, k = V.span / cv.width;
        if (Math.hypot(px - drag.p[0], py - drag.p[1]) > 5) drag.moved = true;
        if (drag.moved) { V.x = drag.x - (px - drag.p[0]) * k; V.z = drag.z - (py - drag.p[1]) * k; this.clampMap(); this.drawMap(); }
        return;
      }
      const L = this.mapClick(e);
      if (L === this.mapHover) return;
      this.mapHover = L;
      if (L) G.audio.play('ui_hover');
      this.drawMap();
    });
  }

  drawMap() {
    const cv = $('#map-canvas'); const g = cv.getContext('2d');
    const S = cv.width;
    this.ensureMapBase();
    if (!this.mapView) this.openMap();
    const T = G.world.terrain, V = this.mapView, k = S / V.span;
    const x0 = V.x - V.span / 2, z0 = V.z - V.span / 2;
    const w2s = (x, z) => [(x - x0) * k, (z - z0) * k];
    // terrain: one base pixel per 2 m sample (pixel centres on the samples)
    const bk = 1 / T.step;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(this.mapBase, (x0 + T.half) * bk + 0.5, (z0 + T.half) * bk + 0.5, V.span * bk, V.span * bk, 0, 0, S, S);
    // parchment tint
    g.fillStyle = 'rgba(40,30,15,0.18)'; g.fillRect(0, 0, S, S);
    // fog over what hasn't been seen: the atlas mask (one pixel per cell) scaled up smoothly
    // gives soft edges; it is cut out of a flat fog layer
    const fog = (this.mapFog ||= document.createElement('canvas'));
    if (fog.width !== S) fog.width = fog.height = S;
    const fg = fog.getContext('2d');
    fg.globalCompositeOperation = 'source-over';
    fg.fillStyle = '#1d2230'; fg.fillRect(0, 0, S, S);
    fg.fillStyle = this.mapFogPattern(fg); fg.fillRect(0, 0, S, S);
    fg.globalCompositeOperation = 'destination-out';
    fg.imageSmoothingEnabled = true;
    fg.drawImage(G.atlas.maskCanvas(), (-T.half - x0) * k, (-T.half - z0) * k, T.size * k, T.size * k);
    g.drawImage(fog, 0, 0);
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
    for (const r of OUTER) if (r.name && r.label && G.atlas.seen(r.label[0], r.label[1])) label(r.label[0], r.label[1], r.name, '#f4ecd8', 17);
    // lanterns
    this.mapLanterns = [];
    for (const L of Object.values(G.world.lanterns)) {
      const [sx, sz] = w2s(L.x, L.z);
      if (sx < -20 || sz < -20 || sx > S + 20 || sz > S + 20) continue;
      g.beginPath(); g.arc(sx, sz, L.lit ? 7 : 5, 0, Math.PI * 2);
      g.fillStyle = L.lit ? '#ffc870' : 'rgba(80,80,80,.8)'; g.fill();
      g.strokeStyle = '#1a1208'; g.lineWidth = 2; g.stroke();
      if (L.lit) this.mapLanterns.push({ L, sx, sz });
      if (L.lit && this.mapHover === L) {
        // hovered waystone: halo and its name, so fast travel shows what it will do
        g.beginPath(); g.arc(sx, sz, 13, 0, Math.PI * 2); g.lineWidth = 2.5; g.strokeStyle = '#fff4d0'; g.stroke();
        g.font = "600 17px 'Hahmlet', serif"; g.textAlign = 'center';
        const t = `${L.name || '등석'} — 이동`;
        g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(t, sx, sz - 20);
        g.fillStyle = '#ffe2a8'; g.fillText(t, sx, sz - 20);
      }
    }
    // quest markers
    const qm = S_ && S_.markers();
    if (qm) for (const m of qm) { const [sx, sz] = w2s(m.x, m.z); g.fillStyle = '#f1d48a'; g.save(); g.translate(sx, sz); g.rotate(Math.PI / 4); g.fillRect(-7, -7, 14, 14); g.strokeStyle = '#000'; g.strokeRect(-7, -7, 14, 14); g.restore(); }
    // player
    const P = G.player; const [px, pz] = w2s(P.pos.x, P.pos.z);
    g.save(); g.translate(px, pz); g.rotate(-P.yaw + Math.PI);
    g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath();
    g.fillStyle = '#5ad0ff'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); g.restore();
    // scale bar: 100 m
    const bar = 100 * k;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(S - bar - 30, S - 34, bar + 16, 22);
    g.fillStyle = '#f4ecd8'; g.fillRect(S - bar - 22, S - 20, bar, 2);
    g.font = "12px 'Hahmlet', serif"; g.textAlign = 'center'; g.fillText('100m', S - bar / 2 - 22, S - 24);
    // legend
    $('.map-keys').innerHTML = `<div><span style="color:#5ad0ff">▲</span> 현재 위치</div><div><span style="color:#f1d48a">◆</span> 목표</div><div><span style="color:#ffc870">●</span> 밝힌 등석<br><small style="opacity:.7">— 클릭하면 그곳으로 이동</small></div><div style="margin-top:14px;opacity:.8">노래 씨앗 ${G.story ? G.story.seedCount() : 0} / 16</div><div style="margin-top:14px;opacity:.6;font-size:12px;line-height:1.6">휠 · 확대와 축소<br>끌기 · 지도 옮기기</div>`;
  }
  // soft cloudy blotches over the fog (a seamless tile: every blob is drawn wrapped), made once
  mapFogPattern(g) {
    if (!this._fogPat) {
      const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
      const x = c.getContext('2d');
      for (let i = 0; i < 70; i++) {
        const cx = Math.random() * n, cy = Math.random() * n, r = 14 + Math.random() * 40, a = 0.03 + Math.random() * 0.05;
        for (const ox of [-n, 0, n]) for (const oy of [-n, 0, n]) {
          const gr = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
          gr.addColorStop(0, `rgba(170,180,210,${a})`); gr.addColorStop(1, 'rgba(170,180,210,0)');
          x.fillStyle = gr; x.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2);
        }
      }
      this._fogPat = c;
    }
    return g.createPattern(this._fogPat, 'repeat');
  }
  mapClick(ev) {
    if (this.mapDragged) { this.mapDragged = false; return null; } // the end of a drag is not a click
    const [x, y] = this.mapPx(ev);
    // generous target (about 40 px on screen): the nearest lit waystone within reach
    let best = null, bd = 24;
    for (const m of this.mapLanterns || []) { const d = Math.hypot(m.sx - x, m.sz - y); if (d < bd) { bd = d; best = m.L; } }
    return best;
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
      const K = G.skills;
      let h = `<div class="jsec">속성의 노래 · 레벨 ${P.level} · 마법 위력 ${P.power().toFixed(1)} · 울림점 ${K ? K.points : 0} (<kbd>K</kbd> 울림 나무)</div><p style="opacity:.75;font-size:13px">마나 ${Math.floor(P.mana)} / ${P.maxMana} · 전투 중 초당 ${P.manaRegenRate(true).toFixed(1)}, 전투 밖 초당 ${P.manaRegenRate(false)} 회복 (마지막 시전 1.4초 뒤부터). 적을 쓰러뜨리면 떨어지는 마나 방울, 원소 반응(+3), 완벽 회피(+15)로 되찾는다.</p>`;
      for (const e of ELEMENTS) {
        const u = P.unlocked.has(e);
        if (!u) continue;
        const ult = ultInfo(e);
        const hasUlt = K && K.ultFor(e);
        h += `<div class="jsp ${u ? '' : 'locked'}"><div class="ic" style="color:${EL_INFO[e].css}">${EL_SVG[e]}</div><div><h4 style="color:${EL_INFO[e].css}">${u ? EL_INFO[e].name + '의 노래' : '??? 의 노래'}${u && K ? `<small>울림 나무 ${K.spentIn(e)}점</small>` : ''}</h4>${u ? `<p>${EL_INFO[e].desc}</p><p><b>좌클릭 · ${BOLT[e].name}</b>${BOLT[e].cost ? ` (마나 ${BOLT[e].cost})` : ''} — ${BOLT[e].desc}</p><p><b>좌클릭 누르고 있다가 떼기 · ${CHARGED[e].name}</b> (마나 ${CHARGED[e].cost}) — ${CHARGED[e].desc}</p>${K && !K.has(SIG[e]) ? `<p style="opacity:.6"><b>우클릭 · ${HEAVY[e].name}</b> (마나 ${HEAVY[e].cost}) — 아직 익히지 못한 기술. 울림 나무(<kbd>K</kbd>) ${EL_INFO[e].name}의 뿌리에서 울림점 ${NODES[SIG[e]].cost}점으로 익히거나, 레벨이 오를 때 <b>울림의 갈림길</b>에서 고를 수 있다.</p>` : `<p><b>우클릭 · ${HEAVY[e].name}</b> (마나 ${HEAVY[e].cost} · 재사용 ${HEAVY[e].cd}초) — ${HEAVY[e].desc}</p>`}<p style="opacity:${hasUlt ? 1 : 0.5}"><b>F · ${ult.name}</b> ${hasUlt ? '' : '(울림 나무 끝에서 익힐 수 있다)'} — ${ult.desc(1).replace('궁극기 (F). ', '')}</p>` : '<p>아직 배우지 못한 노래.</p>'}</div></div>`;
      }
      if (P.unlocked.size < ELEMENTS.length) h += `<p class="jsp-more">아직 듣지 못한 노래가 골짜기 어딘가에 잠들어 있다.</p>`;
      const wk = !K || K.has(WEAVE_NODE);
      h += `<div class="jsec">엮기 (Q) — 지금 속성 + 직전 속성 · 마나 ${WEAVE_COST} · 재사용 ${WEAVE_CD}초</div>${wk ? '' : `<p style="opacity:.7">아직 익히지 못한 기술. 두 가지 속성을 깨우친 뒤 울림 나무(<kbd>K</kbd>) 조화의 뿌리 <b>두 노래 엮기</b>를 익히면 쓸 수 있다.</p>`}<div class="react-grid" style="opacity:${wk ? 1 : 0.6}">`;
      for (const [k, w] of Object.entries(WEAVE)) {
        const els = k === 'arcane' ? ['arcane'] : k.split('+');
        const u = els.every((e) => P.unlocked.has(e));
        if (!u) continue;
        h += `<div><b>${k === 'arcane' ? '비전 + 아무 속성' : els.map((e) => EL_INFO[e].name).join(' + ')} → ${w.name}</b><br>${w.desc}</div>`;
      }
      const disc = K ? K.discovered : new Set();
      h += `</div><div class="jsec">원소 반응 도감 — ${[...disc].filter((r) => REACTIONS[r]).length} / ${Object.keys(REACTIONS).length} 발견</div><div class="react-grid codex">`;
      // unknown elements show as a plain '?', and so does the recipe that needs them
      const known = (e) => e === '*' || P.unlocked.has(e);
      const ic = (e) => (e === '*' ? '<span class="cx-any">✦</span>' : !known(e) ? '<span class="cx-any">?</span>' : `<span style="color:${EL_INFO[e].css}">${EL_SVG[e]}</span>`);
      for (const [id, r] of Object.entries(REACTIONS)) {
        const d = disc.has(id);
        const hid = !d && !r.els.every(known);
        h += `<div class="cx ${d ? '' : 'unk'}"><span class="cx-els">${ic(r.els[0])}<i>+</i>${ic(r.els[1])}</span><span><b style="color:${d ? r.color : '#8a8478'}">${d ? r.name : '??? '}</b> — ${hid ? '아직 모르는 노래가 있어야 일어난다.' : r.desc}</span></div>`;
      }
      h += '</div>';
      // lingering fields and what a second element turns them into
      const fm = Object.entries(FIELD_MIX);
      h += `<div class="jsec">땅의 흔적 — 불길·서리밭·물웅덩이·김·대전된 땅에 다른 속성을 더하면 모습이 바뀐다 · ${fm.filter(([k]) => disc.has('f:' + k)).length} / ${fm.length} 발견</div><div class="react-grid codex">`;
      for (const [k, m] of fm) {
        const d = disc.has('f:' + k);
        const [from, by] = k.includes('+') ? k.split('+') : k.startsWith('whirl:') ? [null, k.slice(6)] : [null, 'arcane'];
        const src = from ? `<span class="cx-f" style="color:${FIELDS[from].color}">${FIELDS[from].name}</span>` : k.startsWith('whirl:') ? '<span class="cx-any">◎</span>' : '<span class="cx-any">✦</span>';
        const hid = !d && (!known(by) || (from && !P.unlocked.has(FIELDS[from].el || 'arcane')));
        h += `<div class="cx ${d ? '' : 'unk'}"><span class="cx-els">${hid && from ? '<span class="cx-any">?</span>' : src}<i>+</i>${ic(by)}</span><span><b style="color:${d ? m.color : '#8a8478'}">${d ? m.name : '??? '}</b> — ${hid ? '아직 모르는 노래가 있어야 일어난다.' : m.desc}</span></div>`;
      }
      h += '</div>';
      body.innerHTML = h;
    } else if (tab === 'memories') {
      let h = (G.sketches ? G.sketches.html() : '') + `<div class="jsec">모라의 기억 — 골짜기에 두고 온 것들</div>`;
      for (const [id, m] of Object.entries(MEMORIES)) {
        const st = S ? S.memoryState(id) : 'none';
        h += `<div class="jq ${st === 'given' ? 'done' : ''}"><h3>${st === 'none' ? '???' : m.name}<small>${st === 'given' ? '전해 줌' : st === 'have' ? '가지고 있음' : ''}</small></h3><p>${st === 'none' ? '아직 찾지 못했다.' : m.desc}</p></div>`;
      }
      h += `<div class="jsec">노래 씨앗</div><p>골짜기 곳곳에서 들려오는 작은 노랫소리를 따라가면 씨앗을 찾을 수 있다. 네 개를 모을 때마다 울림이 깊어진다.<br>모은 씨앗: <b>${S ? S.seedCount() : 0} / 16</b></p>`;
      body.innerHTML = h;
    } else {
      const rows = [
        ['W A S D', '이동'], ['마우스', '시점 · 조준 (화면 클릭 시 마우스 고정)'], ['Shift 누르기', '달리기'], ['Shift 짧게', '순간이동 (회피, 무적 시간)'],
        ['Space', G.story && G.story.flag('glide') ? '점프 / 공중에서 누르고 있기: 활공' : '점프'], ['좌클릭', '기본 마법 (누르고 있다가 떼면 모아 쏘기)'], ['우클릭', '고유 마법 (울림 나무에서 익힌 속성만)'], ['Q', '엮기: 현재 속성 + 직전 속성 (조화 · 두 노래 엮기)'],
        ['F', '궁극기 (울림 게이지가 가득 찼을 때)'], ['1 ~ 6 / 휠', '속성 전환'], ['T / 휠 클릭', '대상 고정'], ['E', '대화 · 조사 · 상호작용'], ['M', '지도 (등석 클릭: 빠른 이동)'], ['Tab / J', '여정 · 마법서'], ['K', '울림 나무 (스킬 트리)'], ['1 / 2 / 3', '울림의 갈림길에서 고르기 (레벨업 후)'], ['Esc', '일시 정지'],
      ];
      body.innerHTML = `<div class="jsec" style="text-align:center">조작</div><div class="ctrl-grid">${rows.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('')}</div>
        <div class="jsec" style="text-align:center;margin-top:30px">요령</div><p style="max-width:620px;margin:0 auto;opacity:.85">· 속성을 번갈아 쓰면 적에게 쌓인 상태와 반응한다. 얼리고 → 번개로 부수고, 물로 적시고 → 번개로 감전시키고, 불태우고 → 바람으로 퍼뜨려라. 불타는 적에게 물을 끼얹으면 불이 꺼지며 피해가 준다.<br>· 공격이 닿기 직전 순간이동으로 피하면 <b>완벽 회피</b> — 잠시 적이 느려진다.<br>· 적을 맞히고 반응을 일으키면 울림 게이지가 차고, 가득 차면 <kbd>F</kbd> 궁극기를 쓸 수 있다.<br>· 레벨이 오르면 <b>울림의 갈림길</b>이 열린다. 고유 마법·엮기·궁극기 같은 기술은 하나씩 익혀야 쓸 수 있다.<br>· 마나는 전투 중엔 천천히 찬다. 적이 떨어뜨리는 마나 방울을 모으고, 반응을 일으켜라.<br>· 흐느낌의 구체는 마법으로 맞혀 없앨 수 있다.<br>· 활공 중 바람의 고유 마법을 쓰면 상승 기류를 탄다.<br>· 서리 마법은 물 위에 얼음 발판을 만든다.<br>· 등석을 밝히면 체력을 회복하고, 쓰러졌을 때 그곳에서 깨어난다.</p>`;
    }
  }

  // ---------------- skill trees (울림 나무) ----------------
  openSkills() {
    const P = G.player, K = G.skills;
    if (!K.treeOpen(this.skTree)) this.skTree = 'arcane';
    if (!this.skBound) {
      this.skBound = true;
      window.addEventListener('keydown', (e) => {
        if (G.game.menu !== 'skills') return;
        if (e.code === 'Enter' && this.skSel) { this.skLearn(this.skSel); e.preventDefault(); }
        const i = TREE_ORDER.indexOf(this.skTree);
        if (e.code === 'KeyQ' || e.code === 'KeyE') {
          const list = TREE_ORDER.filter((t) => K.treeOpen(t));
          const j = list.indexOf(this.skTree);
          this.skTree = list[(j + (e.code === 'KeyE' ? 1 : -1) + list.length) % list.length];
          this.skSel = null; G.audio.play('page'); this.drawSkills();
        }
        void i;
      });
    }
    this.skSel = null;
    this.drawSkills();
    void P;
  }
  skillReset() {
    const K = G.skills;
    if (!this.skResetArm) { this.skResetArm = true; this.toast('한 번 더 누르면 익힌 노래를 모두 잊고 울림점을 되돌려 받습니다.'); setTimeout(() => (this.skResetArm = false), 3000); return; }
    this.skResetArm = false;
    const n = K.reset();
    G.audio.play('dissolve');
    this.toast(`익힌 노래를 잊었다. 울림점 <b>${n}</b>점을 되찾았다.${K.granted.size ? ' <small>(이야기에서 얻은 기술은 남는다)</small>' : ''}`);
    this.drawSkills(); this.updateSpells(); this.updateSP();
  }
  skLearn(id) {
    const K = G.skills;
    const why = K.blocker(id);
    if (why) { G.audio.play('mana_empty'); const n = document.querySelector(`.sk-node[data-id="${id}"]`); if (n) n.animate([{ transform: 'translate(-50%,-50%) translateX(-5px)' }, { transform: 'translate(-50%,-50%) translateX(5px)' }, { transform: 'translate(-50%,-50%)' }], { duration: 220 }); this.drawSkillInfo(id); return; }
    K.learn(id);
    this.drawSkills();
    const n = document.querySelector(`.sk-node[data-id="${id}"]`);
    if (n) { n.classList.add('just'); }
    this.updateSpells(); this.updateSP();
  }
  drawSkills() {
    const K = G.skills, P = G.player;
    const root = document.querySelector('#skills');
    root.querySelector('.sk-points b').textContent = K.points;
    // tabs
    const tabs = root.querySelector('.sk-tabs');
    tabs.innerHTML = TREE_ORDER.filter((t) => t === 'harmony' || K.treeOpen(t)).map((t) => {
      const open = K.treeOpen(t);
      const col = t === 'harmony' ? '#f1d48a' : EL_INFO[t].css;
      const icon = t === 'harmony' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8.5" cy="12" r="5.5"/><circle cx="15.5" cy="12" r="5.5"/></svg>' : EL_SVG[t];
      return `<button class="sk-tab ${t === this.skTree ? 'on' : ''} ${open ? '' : 'locked'}" data-t="${t}" style="color:${col}"><span class="ti">${icon}</span><span class="tn">${TREES[t].name}</span><span class="tp">${open ? K.spentIn(t) : '🔒'}</span></button>`;
    }).join('');
    tabs.querySelectorAll('.sk-tab').forEach((b) => b.addEventListener('click', () => {
      if (!K.treeOpen(b.dataset.t)) { G.audio.play('mana_empty'); this.toast(b.dataset.t === 'harmony' ? '조화의 나무는 두 가지 속성을 깨우친 뒤에 열린다.' : `${EL_INFO[b.dataset.t].name}의 노래를 아직 모른다.`); return; }
      G.audio.play('page'); this.skTree = b.dataset.t; this.skSel = null; this.drawSkills();
    }));
    // nodes
    const T = TREES[this.skTree];
    const col = this.skTree === 'harmony' ? '#f1d48a' : EL_INFO[this.skTree].css;
    root.querySelector('.sk-motto').innerHTML = `<b style="color:${col}">${T.name}의 나무</b><span>${T.motto}</span>${this.skTree !== 'harmony' ? `<span>이 나무에 쓴 울림점 <em>${K.spentIn(this.skTree)}</em></span>` : '<span>두 속성 나무에 각각 2점 이상</span>'}`;
    const box = root.querySelector('.sk-tree');
    const W = box.clientWidth || 560, H = box.clientHeight || 470;
    const maxT = T.maxTier || 4;
    // top margin leaves room for the motto + the ult diamond, bottom for the root node's name
    const top = Math.max(T.harmony ? 74 : 50, H * 0.1), bot = Math.max(60, H * 0.12);
    const ty = (t) => top + (H - top - bot) * (1 - t / maxT);
    const pos = (n) => ({ x: W * (0.2 + n.col * 0.3), y: ty(n.tier) });
    const nodes = root.querySelector('.sk-nodes');
    const lines = root.querySelector('.sk-lines');
    lines.setAttribute('viewBox', `0 0 ${W} ${H}`);
    let lh = '';
    // tier gate labels
    if (this.skTree !== 'harmony') for (let t = 1; t <= maxT; t++) {
      // between the upper tier's names and the lower tier's orbs
      const y = (ty(t) + 52 + ty(t - 1) - (t === 1 ? 52 : 40)) / 2;
      const ok = K.spentIn(this.skTree) >= TIER_GATE[t];
      lh += `<text x="10" y="${y - 4}" class="sk-gate ${ok ? 'ok' : ''}">${TIER_GATE[t]}점</text><line x1="10" x2="${W - 10}" y1="${y}" y2="${y}" class="sk-gateline ${ok ? 'ok' : ''}"/>`;
    }
    for (const n of T.nodes) {
      const b = pos(n);
      // harmony: every node needs the weaving root, but only draw the root's fan to the first row;
      // higher rows hang from the node below them (visual only) to keep the tree readable
      let links = n.req.map((q) => ({ q, a: pos(NODES[q]) }));
      if (n.kind === 'harmony' && n.tier > 1) {
        const below = T.nodes.find((m) => m.kind === 'harmony' && m.tier === n.tier - 1 && m.col === n.col);
        links = below ? [{ q: below.id, a: pos(below), faint: true }] : links;
      }
      for (const { q, a, faint } of links) {
        const lit = !faint && K.has(q) && K.has(n.id), avail = !faint && K.has(q) && !K.has(n.id);
        const my = (a.y + b.y) / 2;
        lh += `<path d="M${a.x} ${a.y} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}" class="sk-link ${lit ? 'lit' : avail ? 'avail' : ''}" style="--c:${col}"/>`;
      }
    }
    lines.innerHTML = lh;
    const kindName = { passive: '', active: '', ult: '궁극기', harmony: '조화' };
    const harmIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8.5" cy="12" r="5.5"/><circle cx="15.5" cy="12" r="5.5"/></svg>';
    nodes.innerHTML = T.nodes.map((n) => {
      const p = pos(n);
      const r = K.r(n.id);
      const why = K.blocker(n.id);
      const state = r >= n.max ? 'max' : r > 0 ? 'some' : !why ? 'avail' : 'locked';
      let icon;
      const veil = veiled(n);
      if (n.kind === 'harmony') icon = `<span class="pair">${n.els.map((e) => e === '*' ? '<span style="color:#f1d48a">✦</span>' : !elKnown(e) ? '<span style="color:#8a8478">?</span>' : `<span style="color:${EL_INFO[e].css}">${EL_SVG[e]}</span>`).join('')}</span>`;
      else icon = `<span class="gl" style="color:${col}">${this.skTree === 'harmony' ? harmIcon : EL_SVG[this.skTree]}</span>`;
      const pips = n.max > 1 ? `<span class="pips">${Array.from({ length: n.max }, (_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('')}</span>` : '';
      return `<div class="sk-node ${state} k-${n.kind} ${this.skSel === n.id ? 'sel' : ''}" data-id="${n.id}" style="left:${p.x}px;top:${p.y}px;--c:${col}">${n.kind === 'active' ? '<span class="sk-badge">기술</span>' : n.kind === 'ult' ? '<span class="sk-badge ult">궁극기</span>' : ''}<div class="sk-orb">${icon}${pips}</div><div class="sk-name">${veil ? '???' : n.name}${n.kind === 'harmony' ? `<small>${kindName[n.kind]}</small>` : ''}</div></div>`;
    }).join('');
    nodes.querySelectorAll('.sk-node').forEach((el) => {
      const id = el.dataset.id;
      el.addEventListener('mouseenter', () => { G.audio.play('ui_hover'); this.drawSkillInfo(id); });
      el.addEventListener('mouseleave', () => this.drawSkillInfo(this.skSel));
      el.addEventListener('click', () => {
        if (this.skSel === id) { this.skLearn(id); return; }
        this.skSel = id; G.audio.play('ui_click');
        nodes.querySelectorAll('.sk-node').forEach((x) => x.classList.toggle('sel', x.dataset.id === id));
        this.drawSkillInfo(id);
      });
      el.addEventListener('dblclick', () => this.skLearn(id));
    });
    this.drawSkillInfo(this.skSel);
    void P;
  }
  drawSkillInfo(id) {
    const K = G.skills;
    const box = document.querySelector('#skills .sk-info');
    if (!id) {
      const T = TREES[this.skTree];
      const learned = T.nodes.filter((n) => K.has(n.id));
      box.innerHTML = `<div class="si-empty"><div class="si-k">울림점</div><div class="si-big">${K.points}</div><p>레벨이 오를 때마다 울림점 2점을 얻고 <b>울림의 갈림길</b>이 열린다. 보스, 이름 붙은 것들, 모라의 기억, 노래 씨앗 넷도 울림점을 준다.</p><p>나무의 뿌리는 <b>기술</b>이다. 고유 마법(우클릭)과 엮기(Q)는 익혀야 쓸 수 있고, 뿌리를 익혀야 위의 갈래가 열린다. 끝에는 <b>궁극기(F)</b>가 기다린다.</p><p>노드를 눌러 살펴보고, 한 번 더 누르면 익힌다.</p>${learned.length ? `<div class="si-k" style="margin-top:14px">이 나무에서 익힌 노래</div><ul>${learned.map((n) => `<li>${n.name}${n.max > 1 ? ` ${K.r(n.id)}/${n.max}` : ''}</li>`).join('')}</ul>` : ''}</div>`;
      return;
    }
    const n = NODES[id];
    if (veiled(n)) {
      box.innerHTML = `<div class="si-head" style="color:#8a8478"><div class="si-name">???</div><div class="si-kind">조화</div></div><div class="si-row"><p>아직 듣지 못한 노래와 엮이는 갈래. 그 노래를 깨우치면 모습을 드러낸다.</p></div>`;
      return;
    }
    const r = K.r(id);
    const why = K.blocker(id);
    const col = n.tree === 'harmony' ? '#f1d48a' : EL_INFO[n.tree].css;
    const kind = n.kind === 'ult' ? '궁극기 · F' : n.kind === 'active' ? (n.sig ? '기술 · 고유 마법 · 우클릭' : '기술 · 엮기 · Q') : n.kind === 'harmony' ? `조화 · ${n.els.map((e) => (e === '*' ? '아무 두 속성' : EL_INFO[e].name)).join(' + ')}` : n.max > 1 ? `지속 효과 · 최대 ${n.max}단계` : '지속 효과';
    const cur = r > 0 ? `<div class="si-row"><span class="si-k">지금</span><p>${n.desc(r)}</p></div>` : '';
    const next = r < n.max ? `<div class="si-row"><span class="si-k">${r > 0 ? '다음 단계' : '익히면'}</span><p>${n.desc(r + 1)}</p></div>` : '<div class="si-row"><span class="si-k">완성</span><p>이 노래를 모두 익혔다.</p></div>';
    const btn = r < n.max ? `<button class="sk-learn ${why ? 'off' : ''}" data-id="${id}">${why ? why : `익히기 · 울림점 ${n.cost}`}</button>` : '';
    box.innerHTML = `<div class="si-head" style="color:${col}"><div class="si-name">${n.name}</div><div class="si-kind">${kind}</div>${n.max > 1 ? `<div class="si-rank">${r} / ${n.max}</div>` : ''}</div>${cur}${next}${btn}`;
    const b = box.querySelector('.sk-learn');
    if (b) b.addEventListener('click', () => this.skLearn(id));
  }
  // ---------------- level-up crossroads (울림의 갈림길) ----------------
  // Returns false when there is nothing to offer.
  openCrossroads() {
    const K = G.skills, P = G.player;
    const offers = K.offer(3, P.level * 7 + K.cross);
    if (!offers.length) return false;
    this.crOffers = offers; this.crBusy = false;
    const root = $('#crossroads');
    root.querySelector('.cr-lv').innerHTML = `LEVEL ${P.level}${K.cross > 1 ? ` <span>· 남은 갈림길 ${K.cross}</span>` : ''}`;
    root.querySelector('.cr-desc').innerHTML = '울림이 깊어지며 노래의 길이 갈라진다. 한 갈래를 골라 익히자.';
    const q = root.querySelector('.cr-quote');
    if (G.story && G.story.flag('v_altar') && G.story.once('c:cross1')) {
      q.innerHTML = '<b>보름</b>갈림길이로구나. 노래는 한 번에 한 갈래씩 깊어지는 법이니라. 욕심내지 말고, 지금 네게 필요한 것을 고르거라.';
      q.classList.remove('hidden');
      let k = 0; const iv = setInterval(() => { if (k++ > 10) clearInterval(iv); else G.audio.blip({ f: 760, type: 'sine', formant: 2300, d: 0.035, v: 0.05, slide: 1.12 }); }, 70);
    } else q.classList.add('hidden');
    root.querySelector('.cr-pts').innerHTML = `울림점 <b>${K.points}</b>`;
    const harmIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8.5" cy="12" r="5.5"/><circle cx="15.5" cy="12" r="5.5"/></svg>';
    const cards = root.querySelector('.cr-cards');
    cards.innerHTML = offers.map((c, i) => {
      const n = c.n, r = c.r, col = treeColor(n.tree);
      const tag = n.kind === 'ult' ? '궁극기' : n.kind === 'active' ? (n.id === WEAVE_NODE ? '새 기술 · 조화' : '새 기술') : n.kind === 'harmony' ? '조화' : `강화${n.max > 1 ? ` ${r} → ${r + 1}` : ''}`;
      let icon;
      if (n.kind === 'harmony') icon = `<span class="pair">${n.els.map((e) => (e === '*' ? '<span style="color:#f1d48a">✦</span>' : `<span style="color:${EL_INFO[e].css}">${EL_SVG[e]}</span>`)).join('')}</span>`;
      else icon = n.tree === 'harmony' ? harmIcon : EL_SVG[n.tree];
      const pips = n.max > 1 ? `<span class="cr-pips">${Array.from({ length: n.max }, (_, k) => `<i class="${k < r ? 'on' : k === r ? 'next' : ''}"></i>`).join('')}</span>` : '';
      const tree = n.tree === 'harmony' ? '조화의 나무' : `${TREES[n.tree].name}의 나무`;
      return `<button class="cr-card k-${n.kind}${isTechnique(n) ? ' tech' : ''}" data-i="${i}" style="--c:${col};--d:${120 + i * 110}ms">
        <span class="cr-glow"></span>
        <span class="cr-top"><span class="cr-key">${i + 1}</span><span class="cr-tag">${tag}</span></span>
        <span class="cr-icon" style="color:${col}">${icon}</span>
        <span class="cr-tree">${tree}</span>
        <span class="cr-name">${n.name}</span>${pips}
        <span class="cr-text">${n.desc(r + 1)}</span>
        <span class="cr-cost">울림점 <b>${n.cost}</b></span>
      </button>`;
    }).join('');
    cards.querySelectorAll('.cr-card').forEach((b) => {
      b.addEventListener('mouseenter', () => { if (!this.crBusy) G.audio.play('ui_hover'); });
      b.addEventListener('click', (e) => { e.stopPropagation(); this.crPick(+b.dataset.i); });
    });
    this.restart(root.querySelector('.cr-head'), 'in');
    return true;
  }
  crPick(i) {
    if (this.crBusy || G.game.menu !== 'crossroads') return;
    const c = this.crOffers && this.crOffers[i];
    if (!c) return;
    const K = G.skills;
    const card = document.querySelector(`#crossroads .cr-card[data-i="${i}"]`);
    if (K.blocker(c.id)) { G.audio.play('mana_empty'); if (card) card.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 220 }); return; }
    this.crBusy = true;
    const tech = isTechnique(c.n);
    K.learn(c.id, { sound: tech ? 'skill_unlock_active' : 'skill_pick', quiet: true });
    K.cross = Math.max(0, K.cross - 1);
    document.querySelectorAll('#crossroads .cr-card').forEach((b) => b.classList.add(b === card ? 'picked' : 'gone'));
    $('#crossroads .cr-pts').innerHTML = `울림점 <b>${K.points}</b>`;
    if (tech) (this.crBanners = this.crBanners || []).push(c.n);
    setTimeout(() => {
      if (G.game.menu !== 'crossroads') return;
      if (K.cross > 0 && K.offer().length) { G.audio.play(G.audio.S && G.audio.S.levelup_open ? 'levelup_open' : 'page'); this.openCrossroads(); return; }
      K.cross = 0;
      G.game.closeMenu();
      this.flushCrBanners();
    }, 950);
  }
  flushCrBanners() {
    for (const n of this.crBanners || []) {
      let d;
      if (n.sig) d = `${josa(EL_INFO[n.el].name, '을')} 고르고 <kbd>우클릭</kbd> · 마나 ${HEAVY[n.el].cost} · 재사용 ${HEAVY[n.el].cd}초`;
      else if (n.id === WEAVE_NODE) d = `속성을 바꾼 뒤 <kbd>Q</kbd> — 지금 속성과 직전 속성을 엮는다 · 마나 ${WEAVE_COST}`;
      else d = '울림 게이지가 가득 차면 <kbd>F</kbd> — 적을 맞히고 원소 반응을 일으키면 빨리 찬다';
      this.banner(n.kind === 'ult' ? '새로운 궁극기' : '새로운 기술', n.name, d, treeColor(n.tree), 4200);
    }
    this.crBanners = [];
  }
  crKeep() {
    const K = G.skills;
    if (this.crBusy) return;
    K.cross = 0;
    G.game.closeMenu();
    this.toast(`울림점 <b>${K.points}</b>점을 간직했다 — 언제든 <kbd>K</kbd> 울림 나무에서 쓸 수 있다`, 4200);
  }
  crTree() {
    if (this.crBusy) return;
    G.skills.cross = 0;
    const n = this.crOffers && this.crOffers[0];
    if (n) this.skTree = n.n.tree;
    G.game.openMenu('skills');
  }
}
