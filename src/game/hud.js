// DOM HUD: vitals, compass, spell bar, world-anchored labels, banners, map & journal.
import * as THREE from 'three';
import { G, ELEMENTS, EL_INFO, EL_SVG, ICON, fillIcons, iconImage } from '../core/context.js';
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
  // dark rim for any backdrop, the filled quarters, a glint on the upper lobe, then a fine cream edge
  return `<svg viewBox="0 0 26 24"><path d="${HEART_PATH}" fill="rgba(10,10,24,.8)" stroke="rgba(7,9,20,.9)" stroke-width="3.4" stroke-linejoin="round"/>
    <g clip-path="url(#heartClip)" fill="url(#heartFill)">${fill}</g>
    ${q ? '<ellipse cx="7" cy="7.3" rx="1.9" ry=".9" transform="rotate(-40 7 7.3)" fill="#fff" fill-opacity=".55"/>' : ''}
    <path d="${HEART_PATH}" fill="none" stroke="#ffe9d8" stroke-opacity="${q ? 0.9 : 0.45}" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
}
// 'verb — target' labels: the part after the dash is set apart
const dashed = (t) => { const i = t.indexOf(' — '); return i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i + 3)]; };
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// enemy status marks, in the icon family
const STATUS = [
  ['burn', 'fire', EL_INFO.fire.css], ['chill', 'frost', EL_INFO.frost.css], ['frozen', 'frost', '#ffffff'], ['shock', 'storm', EL_INFO.storm.css],
  ['wet', 'water', EL_INFO.water.css], ['electro', 'storm', '#fff3a8'], ['steam', 'wind', '#e8f4ff'],
];

export class HUD {
  constructor() {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    defs.setAttribute('width', 0); defs.setAttribute('height', 0); defs.style.position = 'absolute';
    defs.innerHTML = `<defs><clipPath id="heartClip"><path d="${HEART_PATH}"/></clipPath><linearGradient id="heartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8d98"/><stop offset=".55" stop-color="#ec3a55"/><stop offset="1" stop-color="#b81f3f"/></linearGradient></defs>`;
    document.body.appendChild(defs);
    fillIcons();
    this.el = {
      hud: $('#hud'), hearts: $('#hearts'), manaFill: $('.mana-fill'), manaGhost: $('.mana-ghost'), mana: $('#mana'),
      xpFill: $('.xp-fill'), xpLv: $('.xp-lv'), compassStrip: $('.compass-strip'), compassMarkers: $('.compass-markers'),
      qtTitle: $('.qt-title'), qtObj: $('.qt-obj'), crosshair: $('#crosshair'), lock: $('#lock-marker'),
      stamina: $('#stamina'), stFill: $('.st-fill'), elements: $('#elements'), weaveSlot: $('#weave-slot'),
      weaveIcons: $('.weave-icons'), weaveName: $('.weave-name'), weaveT: $('#weave-slot .act-t'), heavyName: $('#heavy-slot .hn'), heavyT: $('#heavy-slot .act-t'), heavyIco: $('.heavy-ico'),
      ultPct: $('.ult-pct'), lv: $('#xpbar'), saveMark: $('#save-mark'),
      boss: $('#boss-bar'), bossName: $('.boss-name'), bossEpi: $('.boss-epi'), bossFill: $('.boss-fill'), bossGhost: $('.boss-ghost'), bossTrack: $('.boss-track'), bossBreak: $('.boss-break'), bossBreakFill: $('.boss-break-fill'),
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
    this.awarenessMarks = new Map();
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
    this.qmark = document.createElement('div'); this.qmark.className = 'wmark'; this.qmark.innerHTML = `${ICON.quest}<span class="d"></span>`; this.el.markers.appendChild(this.qmark);
    this.qmarkD = this.qmark.querySelector('.d');
    this.barkEls = [];
  }
  // world-anchored elements move by `translate` (compositor only, and it composes with their
  // own transform animations) instead of left / top
  at(el, x, y) { el.style.translate = `${Math.round(x)}px ${Math.round(y)}px`; }
  // a small mark next to the minimap whenever the journey is written down
  saved() { this.restart(this.el.saveMark, 'show'); }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }
  // Interface size follows the window (1600×900 = 1, eased so it neither balloons on big
  // screens nor shrinks to unreadable on small ones) times the player's own setting.
  applyScale() {
    const fit = Math.min(innerWidth / 1600, innerHeight / 900);
    const s = clamp(Math.pow(fit, 0.8), 0.68, 1.5) * clamp((G.settings.ui ?? 100) / 100, 0.75, 1.35);
    document.documentElement.style.setProperty('--ui', s.toFixed(3));
    this.uiScale = s;
    this.compassHalf = 0;
    this.minimap?.resize(); // a zoom change need not reach the minimap's resize observer
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
    if (hurt) this.restart(this.el.hearts, 'hurt');
    this.lastMax = P.maxHp;
  }
  updateXP() {
    const P = G.player;
    // the emblem's rim is the XP bar (path length 100)
    this.el.xpFill.style.strokeDashoffset = 100 - clamp(P.xp / xpNeed(P.level), 0, 1) * 100;
    if (this.shownLv !== P.level) {
      if (this.shownLv !== undefined && P.level > this.shownLv) this.restart(this.el.lv, 'up');
      this.shownLv = P.level;
      this.el.xpLv.textContent = P.level;
    }
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
      const card = { 0: '북', 90: '동', 180: '남', 270: '서' }[d];
      html += card ? `<span class="card" data-a="${d}">${card}</span>` : `<span class="${d % 45 === 0 ? 'mid' : 'tick'}" data-a="${d}"></span>`;
    }
    this.el.compassStrip.innerHTML = html;
    this.compassItems = [...this.el.compassStrip.children].map((e) => ({ e, a: (+e.dataset.a * Math.PI) / 180 }));
    this.cmarks = new Map();
  }
  compassPos(heading, ang) {
    const rel = wrapAngle(ang - heading);
    if (Math.abs(rel) > Math.PI * 0.55) return null;
    return this.compassHalf + (rel / (Math.PI / 2)) * 260; // 260 px per quarter turn, whatever the strip's width
  }
  updateCompass() {
    const cr = G.cameraRig;
    const fx = -Math.sin(cr.yaw), fz = -Math.cos(cr.yaw);
    const heading = Math.atan2(fx, -fz);
    this.compassHalf ||= this.el.compassStrip.clientWidth / 2 || 260; // measured once per resize
    for (const it of this.compassItems) {
      const x = this.compassPos(heading, it.a);
      if (x === null) it.e.style.display = 'none';
      else { it.e.style.display = ''; it.e.style.left = x + 'px'; }
    }
    const P = G.player.pos;
    const marks = [];
    const q = G.story && G.story.markers();
    if (q) for (const m of q) marks.push({ id: 'q' + m.x + m.z, x: m.x, z: m.z, cls: 'quest', sym: 'quest', dist: true });
    for (const L of Object.values(G.world.lanterns)) if (L.lit) marks.push({ id: 'L' + L.id, x: L.x, z: L.z, cls: 'way', sym: 'waystone' });
    marks.push({ id: 'village', x: POI.bellTower.x, z: POI.bellTower.z, cls: 'home', sym: 'home' });
    if (G.story && G.story.flag('prologueDone')) marks.push({ id: 'tower', x: POI.tower.x, z: POI.tower.z, cls: 'tower', sym: 'tower' });
    const seen = new Set();
    for (const m of marks) {
      seen.add(m.id);
      let e = this.cmarks.get(m.id);
      if (!e) {
        // built once; afterwards only its position (and the distance text, when it changes) is touched
        e = document.createElement('div'); e.className = 'cm ' + m.cls;
        e.innerHTML = ICON[m.sym] + (m.dist ? '<span class="dist"></span>' : '');
        e._d = e.querySelector('.dist');
        this.el.compassMarkers.appendChild(e); this.cmarks.set(m.id, e);
      }
      const ang = Math.atan2(m.x - P.x, -(m.z - P.z));
      const x = this.compassPos(heading, ang);
      const d = Math.hypot(m.x - P.x, m.z - P.z);
      const show = x !== null && (d >= 4 || m.dist);
      if (e._show !== show) { e._show = show; e.style.display = show ? '' : 'none'; }
      if (!show) continue;
      e.style.left = x + 'px';
      if (e._d) { const t = Math.round(d) + 'm'; if (e._t !== t) { e._t = t; e._d.textContent = t; } }
    }
    for (const [id, e] of this.cmarks) if (!seen.has(id)) { e.remove(); this.cmarks.delete(id); }
  }

  // ---------------- quest tracker ----------------
  setTracker(title, obj, flash = true) {
    this.el.qtTitle.textContent = title || '';
    if (this.el.qtObj.textContent !== obj) {
      this.el.qtObj.innerHTML = obj || '';
      if (flash) { this.restart(this.el.qtObj, 'flash'); this.restart($('.qt-ico'), 'flash'); }
    }
    $('#quest-tracker').style.opacity = title ? 1 : 0;
  }

  // ---------------- spells ----------------
  buildElements() {
    this.el.elements.innerHTML = ELEMENTS.map((e, i) => `<div class="el" data-el="${e}" style="color:${EL_INFO[e].css};--c:${EL_INFO[e].css}">${EL_SVG[e]}<span class="key">${i + 1}</span></div>`).join('');
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
    // Slots show whether a skill can be cast through their colour (.nomana), not a mana number.
    this.el.weaveCost.innerHTML = wKnown ? '' : '미습득';
    const hKnown = P.canHeavy();
    this.el.heavySlot.classList.toggle('locked', !hKnown);
    this.el.heavySlot.classList.toggle('hidden', !hKnown && !(G.skills && Object.values(SIG).some((id) => G.skills.has(id))));
    this.el.heavyName.textContent = HEAVY[P.element].name;
    this.el.heavySlot.style.setProperty('--c', EL_INFO[P.element].css);
    this.el.heavyIco.innerHTML = hKnown ? EL_SVG[P.element] : ICON.lock;
    this.el.heavyCost.innerHTML = hKnown ? '' : '미습득';
    this.el.tickH.style.setProperty('--tc', EL_INFO[P.element].css);
    if (!wKnown) this.el.weaveIcons.innerHTML = `<span>${ICON.lock}</span>`;
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
    if (this.ultEl !== P.element) { this.ultEl = P.element; $('.ult-ico').innerHTML = EL_SVG[P.element]; }
  }
  updateSP(flash = false) {
    const K = G.skills; if (!K) return;
    const b = this.el.sp;
    b.classList.toggle('hidden', K.points <= 0);
    b.querySelector('b').textContent = K.points;
    if (flash) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
  }
  ultReady() { const u = this.el.ult; u.classList.remove('flash'); void u.offsetWidth; u.classList.add('flash'); }
  ultShort() { this.restart(this.el.ult, 'bump'); this.toast(`울림 게이지가 아직 차지 않았다 — 적을 맞히고, 특히 <b>원소 반응</b>을 일으키면 빨리 찬다`); }
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
    this.restart(k === 'weave' ? this.el.weaveSlot : this.el.heavySlot, 'bump');
  }
  // an action button's cooldown: a dark wedge that shrinks, with the seconds left on top.
  // Only writes when the shown value changes.
  coolSlot(slot, tEl, left, total) {
    const k = total > 0 && left > 0 ? Math.round(clamp(left / total, 0, 1) * 200) / 200 : 0;
    if (slot._k !== k) {
      if (slot._k > 0 && k === 0) this.restart(slot, 'done'); // ready again: one pulse
      slot._k = k; slot.style.setProperty('--cd', k); slot.classList.toggle('cooling', k > 0);
    }
    const t = left > 0.05 ? (left < 10 ? left.toFixed(1) : String(Math.ceil(left))) : '';
    if (slot._t !== t) { slot._t = t; tEl.textContent = t; }
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
  // The name of a charged shot or a weave, in the action lane at the right above the spell bar
  // (see styles.css). One node, reused: a new cast replaces the name still showing.
  castName(name, els, big = false) {
    let d = this.castEl;
    if (!d) { d = this.castEl = document.createElement('div'); this.el.hud.appendChild(d); }
    const known = els.filter((e) => EL_INFO[e]);
    d.className = 'castname' + (big ? ' big' : '');
    d.style.setProperty('--c', known.length ? EL_INFO[known[0]].css : '#f1d48a');
    d.innerHTML = `${known.map((e) => `<i style="color:${EL_INFO[e].css}">${EL_SVG[e]}</i>`).join('')}<span>${esc(name)}</span>`;
    this.restart(d, 'show');
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
    // each number drifts a little to its own side as it rises, so a burst of hits fans out
    d.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 36)}px`);
    if (crit) d.innerHTML = `<i>${ICON.spark}</i><span>${n}</span>`; else d.textContent = n;
    // spread sideways rather than upwards: the nameplate stands just above a short enemy's centre
    this.addFloat(d, pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, 0.05 + Math.random() * 0.4, (Math.random() - 0.5) * 0.9)), 1000);
  }
  // A reaction's name stands just above the struck enemy's nameplate (found from the hit position
  // when the caller does not pass the target), so it never lands on the plate or the numbers.
  reaction(pos, info, target) {
    const d = document.createElement('div');
    d.className = 'dmg react';
    d.style.color = info.color;
    d.textContent = info.name;
    target ||= G.enemies && G.enemies.list.find((e) => e.alive && e.center().distanceToSquared(pos) < 0.01);
    this.addFloat(d, pos.clone().add(new THREE.Vector3(0, 1.3, 0)), 1400, target);
  }
  floatText(pos, text, color = '#fff', cls = 'info') {
    const d = document.createElement('div');
    d.className = 'dmg ' + cls;
    d.style.color = color;
    d.textContent = text;
    this.addFloat(d, pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 1200);
  }
  addFloat(el, pos, ms, plateOf = null) {
    this.el.dmg.appendChild(el);
    const f = { el, pos, t: ms / 1000, plateOf };
    this.floats.push(f);
    this.placeFloat(f);
    if (this.floats.length > 60) { const o = this.floats.shift(); o.el.remove(); }
  }
  placeFloat(f) {
    // riding on a nameplate: its top edge as placed this frame (after stacking)
    const b = f.plateOf && this.barPool.get(f.plateOf);
    if (b && b._sx !== undefined) {
      if (!f.vis) { f.vis = true; f.el.style.display = ''; }
      this.at(f.el, b._sx, b._sy - b._sh - 16 * Math.max(1, this.uiScale || 1));
      return;
    }
    const p = this.project(f.pos);
    if (f.vis !== p.vis) { f.vis = p.vis; f.el.style.display = p.vis ? '' : 'none'; }
    if (p.vis) this.at(f.el, p.x, p.y);
  }
  showAwareness(e) {
    const p = this.project(v3.copy(e.pos).setY(e.pos.y + e.height + 0.65));
    let mark = this.awarenessMarks.get(e);
    if (!p.vis) { if (mark) mark.hidden = true; return; }
    if (!mark) {
      mark = document.createElement('div');
      mark.className = 'awareness-mark'; mark.setAttribute('aria-label', '경계 중');
      mark.innerHTML = ICON.point + '<i></i>';
      this.el.bars.appendChild(mark); this.awarenessMarks.set(e, mark);
    }
    mark.hidden = false;
    mark.style.setProperty('--awareness', e.awareness.toFixed(2));
    this.at(mark, p.x, p.y);
  }
  alertMark(e) {
    const d = document.createElement('div');
    d.className = 'alert-mark'; d.innerHTML = ICON.alert;
    // anchored where the nameplate is (styles.css lifts it above the plate), not on top of it
    this.addFloat(d, e.center().setY(e.pos.y + e.height + 0.5), 900);
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
  // A one-liner at the bottom of the screen. Boreum's unless `who` names another speaker:
  // { name, color } (both optional).
  companion(text, dur, who) {
    const c = this.el.comp;
    const name = (who && who.name) || '보름', col = who && who.color;
    c.innerHTML = `<b${col ? ` style="color:${col}"` : ''}>${esc(fillName(name, G.playerName))}</b>${fillName(text, G.playerName).replace(/\*([^*]+)\*/g, '<em>$1</em>')}`;
    c.style.setProperty('--who', col || '');
    c.classList.add('show');
    this.compT = dur ?? 3.5 + text.length * 0.06;
    let n = 0;
    const v = { f: 760, type: 'sine', formant: 2300, d: 0.035, v: 0.05, slide: 1.12 };
    const iv = setInterval(() => { if (n++ > Math.min(14, text.length / 3)) clearInterval(iv); else G.audio.blip(v); }, 70);
  }
  prompt(text) {
    if (!text) { if (this.promptText !== null) { this.promptText = null; this.el.prompt.classList.add('hidden'); } return; }
    if (this.promptText === text) return;
    this.promptText = text;
    this.el.prompt.classList.remove('hidden');
    const [verb, what] = dashed(text);
    this.el.promptT.innerHTML = esc(verb) + (what ? `<em>${esc(what)}</em>` : '');
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
    const [nm, epithet] = dashed(name || target.name);
    this.el.bossName.textContent = nm; this.el.bossEpi.textContent = epithet;
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
    if (showSt) this.at(this.el.stamina, sp.x + 70, sp.y - 30);
    // the HUD steps aside when nothing needs it (styles.css #hud.calm / #hud.fight): calm after a few
    // seconds out of a fight with health, mana, stamina and cooldowns all full
    const fight = this.inCombat();
    const still = G.mode === 'free' && !fight && P.hp >= P.maxHp && P.mana >= P.maxMana && sf >= 0.995 && P.cd.heavy <= 0 && P.cd.weave <= 0 && !P.lockTarget;
    this.calmT = still ? (this.calmT || 0) + dt : 0;
    const calm = this.calmT > 4;
    if (this.calm !== calm) { this.calm = calm; this.el.hud.classList.toggle('calm', calm); }
    if (this.fight !== fight) { this.fight = fight; this.el.hud.classList.toggle('fight', fight); }
    // cooldowns
    this.coolSlot(this.el.weaveSlot, this.el.weaveT, P.cd.weave, WEAVE_CD);
    this.coolSlot(this.el.heavySlot, this.el.heavyT, P.cd.heavy, P.cd.heavyMax || 0);
    if (G.skills && !this.el.ult.classList.contains('hidden')) {
      const k = clamp(G.skills.gauge / ULT_COST, 0, 1), pct = Math.floor(k * 100);
      if (this.ultPct !== pct) {
        this.ultPct = pct;
        this.el.ultGauge.style.strokeDashoffset = 100 - pct;
        this.el.ultPct.textContent = pct >= 100 ? '준비됨' : pct + '%';
      }
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
    let over = false, aimed = null;
    if (G.mode === 'free') {
      const cam = G.camera; const d = new THREE.Vector3(); cam.getWorldDirection(d);
      for (const e of G.enemies.list) {
        if (!e.alive || !e.hittable) continue;
        const to = v3.subVectors(e.center(), cam.position); const dist = to.length();
        if (dist > 60) continue;
        if (Math.acos(clamp(to.dot(d) / dist, -1, 1)) < 0.06 + Math.atan2(e.radius, dist)) { over = true; aimed = e; break; }
      }
    }
    this.el.crosshair.classList.toggle('enemy', over);
    this.el.crosshair.style.opacity = G.mode === 'free' ? 1 : 0;
    // lock marker
    if (P.lockTarget && P.lockTarget.alive) {
      const p = this.project(P.lockTarget.center());
      this.el.lock.classList.toggle('hidden', !p.vis);
      this.at(this.el.lock, p.x, p.y);
    } else this.el.lock.classList.add('hidden');
    // enemy bars. Only one carries its full name: the locked target, else the one under the
    // crosshair, else the nearest; the rest show level, health and marks. Bars that would land
    // on top of each other are stacked upwards, the named one first, then by distance.
    const seen = new Set(), placed = (this._placed ||= []);
    placed.length = 0;
    let nearest = null, nd = 1e9;
    for (const e of G.enemies.list) {
      if (!e.alive || (e.boss && e === this.bossTarget)) continue;
      const d = e.pos.distanceTo(P.pos);
      if (e.state === 'investigate') this.showAwareness(e);
      e._barD = (e.barT > 0 || (e.aggroed && d < 30) || P.lockTarget === e) && d < 45 ? d : -1;
      if (e._barD >= 0 && d < nd) { nd = d; nearest = e; }
    }
    for (const [e, mark] of this.awarenessMarks) if (!e.alive || e.state !== 'investigate') {
      mark.remove(); this.awarenessMarks.delete(e);
    }
    const lockE = P.lockTarget && P.lockTarget.alive && P.lockTarget._barD >= 0 ? P.lockTarget : null;
    const named = lockE || (aimed && aimed._barD >= 0 ? aimed : nearest);
    const uw = Math.max(1, this.uiScale || 1), bw = 118 * uw;
    const shown = (this._shown ||= []);
    shown.length = 0;
    for (const e of G.enemies.list) if (e.alive && !(e.boss && e === this.bossTarget) && e._barD >= 0) shown.push(e);
    shown.sort((a, b) => (a === named ? -1 : a._barD) - (b === named ? -1 : b._barD));
    for (const e of shown) {
      const p = this.project(v3.copy(e.center()).setY(e.pos.y + e.height + 0.5));
      if (!p.vis) continue;
      seen.add(e);
      // a bar covers [y - bh, y] above its anchor; step it up past any bar already placed there
      const full = e === named, bh = (full ? 52 : 34) * uw;
      p.y = Math.max(p.y, 84 * (this.uiScale || 1) + bh); // an enemy towering over the camera: keep its bar under the compass
      for (let k = 0, hit = true; hit && k < 4; k++) {
        hit = false;
        for (let i = 0; i < placed.length; i += 3) if (Math.abs(p.x - placed[i]) < bw && p.y > placed[i + 1] - placed[i + 2] && p.y - bh < placed[i + 1]) { p.y = placed[i + 1] - placed[i + 2]; hit = true; }
      }
      placed.push(p.x, p.y, bh);
      let b = this.barPool.get(e);
      if (!b) {
        b = document.createElement('div');
        b.className = 'ebar' + (e.elite ? ' elite' : '');
        const weak = Object.entries(e.resist || {}).filter(([k, v]) => v >= 1.2 && EL_INFO[k]).map(([k]) => `<i class="wk" style="color:${EL_INFO[k].css}" title="약점">${EL_SVG[k]}</i>`).join('');
        const imm = (e.immune || []).filter((k) => EL_INFO[k]).map((k) => `<i class="wk im" style="color:${EL_INFO[k].css}" title="면역">${EL_SVG[k]}</i>`).join('');
        b.innerHTML = `<div class="en">${e.name || ''}</div><div class="erow"><b class="elv">${e.level}</b><div class="etrack"><i class="eghost"></i><i class="efill"></i>${e.armor ? '<i class="armor"></i>' : ''}</div></div><div class="emeta"><span class="st"></span><span class="wks">${weak}${imm}</span></div>`;
        this.el.bars.appendChild(b); this.barPool.set(e, b);
        b._fill = b.querySelector('.efill'); b._ghost = b.querySelector('.eghost'); b._st = b.querySelector('.st'); b._ar = b.querySelector('.armor');
      }
      this.at(b, p.x, p.y);
      b._sx = p.x; b._sy = p.y; b._sh = bh; // where reaction names ride (placeFloat)
      if (b._full !== full) { b._full = full; b.classList.toggle('brief', !full); }
      // health in half-percent steps: the bar (and its trailing ghost) is only written when it moves
      const hp = Math.round(clamp(e.hp / e.maxHp, 0, 1) * 200) / 2;
      if (b._hp !== hp) { b._hp = hp; b._fill.style.width = b._ghost.style.width = hp + '%'; }
      // status marks: a key of the active ones, rebuilt only when the set changes
      const st = e.st; let s = '';
      for (const [k] of STATUS) if (st[k] > 0 && !(k === 'chill' && st.frozen > 0)) s += k + ' ';
      if (b._s !== s) {
        b._s = s;
        b._st.innerHTML = STATUS.filter(([k]) => s.includes(k + ' ')).map(([k, el, col]) => `<i class="${k === 'frozen' || k === 'electro' ? 'hot' : ''}" style="color:${col}">${EL_SVG[el]}</i>`).join('');
      }
      const ar = st.armorBroken > 0 ? 0 : 1;
      if (b._ar && b._arv !== ar) { b._arv = ar; b._ar.style.opacity = ar; }
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
      this.at(b.el, p.x, p.y);
    }
    // quest world marker
    const qm = G.story && G.story.markers();
    if (qm && qm.length && G.mode === 'free') {
      const m = qm[0];
      const gy = G.world.h(m.x, m.z);
      const p = this.project(v3.set(m.x, gy + (m.h ?? 3.5), m.z));
      const d = Math.hypot(m.x - P.pos.x, m.z - P.pos.z);
      this.qmark.style.display = p.vis && d > 8 ? '' : 'none';
      this.at(this.qmark, p.x, p.y);
      const t = Math.round(d) + 'm';
      if (this.qmarkT !== t) { this.qmarkT = t; this.qmarkD.textContent = t; }
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
    this.mapView = { x: P.x, z: P.z, span: 520 }; this.mapSig = null; this.mapHover = null;
    this.clampMap();
    // draw at the resolution the canvas is shown at (the map page is laid out by now)
    const cv = $('#map-canvas'), px = Math.round(cv.clientWidth * (this.uiScale || 1) * Math.min(2, window.devicePixelRatio || 1));
    if (px > 200 && cv.width !== px) cv.width = cv.height = px;
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
    // sizes below are in CSS px at the size the canvas is shown
    const u = S / (cv.clientWidth || 760);
    this.mapRedraw ||= () => { if (G.game.menu === 'map') this.drawMap(); };
    const icon = (name, col, sx, sz, s) => { const im = iconImage(name, col, this.mapRedraw); if (im) g.drawImage(im, sx - (s * u) / 2, sz - (s * u) / 2, s * u, s * u); };
    g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
    const names = [], label = (...a) => names.push(a);
    const letter = (x, z, t, c = '#fff', size = 15) => { const [sx, sz] = w2s(x, z); g.font = `700 ${size * u}px 'HeirOfLight', 'ForgedBlade', serif`; g.lineWidth = 3.5 * u; g.strokeStyle = 'rgba(8,10,20,.82)'; g.strokeText(t, sx, sz); g.fillStyle = c; g.fillText(t, sx, sz); };
    label(0, 38, '하늬 마을', '#fff4d8', 17);
    label(POI.tower.x, POI.tower.z + 12, '모라의 탑', '#e0d0ff');
    label(POI.lake.x, POI.lake.z, '거울 호수', '#d8f0ff');
    const S_ = G.story;
    if (S_ && S_.flag('worldOpen')) {
      label(POI.frost.x, POI.frost.z + 14, '서리봉 성소', '#bfefff');
      label(POI.storm.x, POI.storm.z + 16, '천둥 고원', '#ffe890');
      label(POI.rift.x, POI.rift.z + 18, '고요의 틈', '#d0b0ff');
    }
    label(POI.meadow.x, POI.meadow.z + 10, '노을 들판', '#ffe0b0', 14);
    for (const r of OUTER) if (r.name && r.label && G.atlas.seen(r.label[0], r.label[1])) label(r.label[0], r.label[1], r.name, '#f4ecd8', 19);
    // waystones
    this.mapLanterns = [];
    for (const L of Object.values(G.world.lanterns)) {
      const [sx, sz] = w2s(L.x, L.z);
      if (sx < -20 || sz < -20 || sx > S + 20 || sz > S + 20) continue;
      const hot = L.lit && this.mapHover === L;
      if (hot) { // hovered: a halo and its name, so fast travel shows what it will do
        g.beginPath(); g.arc(sx, sz, 15 * u, 0, Math.PI * 2); g.fillStyle = 'rgba(255,226,168,.22)'; g.fill(); g.lineWidth = 1.5 * u; g.strokeStyle = '#fff4d0'; g.stroke();
      }
      icon('waystone', L.lit ? '#ffc870' : '#8d8f9a', sx, sz, hot ? 24 : L.lit ? 20 : 15);
      if (L.lit) this.mapLanterns.push({ L, sx, sz });
      if (hot) {
        const t = `${L.name || '등석'}  ·  이동`;
        g.font = `500 ${15 * u}px 'ForgedBlade', sans-serif`;
        const w = g.measureText(t).width + 24 * u, y = sz - 38 * u;
        g.fillStyle = 'rgba(9,12,26,.92)'; g.beginPath(); g.roundRect(sx - w / 2, y, w, 26 * u, 13 * u); g.fill(); g.lineWidth = u; g.strokeStyle = 'rgba(241,212,138,.7)'; g.stroke();
        g.fillStyle = '#fff2cc'; g.fillText(t, sx, y + 18 * u);
      }
    }
    // quest markers
    const qm = S_ && S_.markers();
    if (qm) for (const m of qm) { const [sx, sz] = w2s(m.x, m.z); icon('quest', '#f1d48a', sx, sz, 24); }
    for (const a of names) letter(...a);
    // player
    const P = G.player; const [px, pz] = w2s(P.pos.x, P.pos.z);
    g.save(); g.translate(px, pz); g.rotate(-P.yaw + Math.PI);
    g.beginPath(); g.moveTo(0, -12 * u); g.lineTo(8 * u, 9 * u); g.lineTo(0, 4.5 * u); g.lineTo(-8 * u, 9 * u); g.closePath();
    g.lineWidth = 5 * u; g.strokeStyle = '#0a0c18'; g.stroke(); g.fillStyle = '#5ad0ff'; g.fill(); g.lineWidth = 1.5 * u; g.strokeStyle = '#fff'; g.stroke(); g.restore();
    // scale bar: 100 m
    const bar = 100 * k, bx = S - bar - 22 * u, by = S - 20 * u;
    g.fillStyle = 'rgba(9,12,26,.7)'; g.beginPath(); g.roundRect(bx - 10 * u, by - 22 * u, bar + 20 * u, 32 * u, 4 * u); g.fill();
    g.fillStyle = '#f1eadb'; g.fillRect(bx, by, bar, 1.5 * u); g.fillRect(bx, by - 4 * u, 1.5 * u, 6 * u); g.fillRect(bx + bar - 1.5 * u, by - 4 * u, 1.5 * u, 6 * u);
    g.font = `700 ${12.5 * u}px 'HeirOfLight', serif`; g.fillText('100m', bx + bar / 2, by - 7 * u);
    // legend
    const mk = (ic, col, t, sub = '') => `<div class="mk"><span class="ico" style="color:${col}">${ICON[ic]}</span><span>${t}${sub ? `<small>${sub}</small>` : ''}</span></div>`;
    // the side panel is rebuilt only when what it lists changes (hovering redraws the canvas often)
    const lit = Object.values(G.world.lanterns).filter((L) => L.lit);
    const sig = lit.map((L) => L.id).join() + '|' + (G.story ? G.story.seedCount() : 0) + '|' + Math.round(P.pos.x / 4) + ',' + Math.round(P.pos.z / 4);
    const keys = $('.map-keys');
    if (this.mapSig !== sig) {
      this.mapSig = sig;
      const dist = (L) => Math.hypot(L.x - P.pos.x, L.z - P.pos.z);
      keys.innerHTML = `<div class="mk-row">${mk('player', '#5ad0ff', '현재 위치')}${mk('quest', '#f1d48a', '목표')}${mk('waystone', '#ffc870', '밝힌 등석')}${mk('waystone', '#8d8f9a', '잠든 등석')}${mk('seed', '#bfe8c8', `노래 씨앗 ${G.story ? G.story.seedCount() : 0} / 16`)}</div>`
        + `<div class="mk-sec">등석으로 이동<b>${lit.length}</b></div><div class="mk-list">${lit.sort((a, b) => dist(a) - dist(b)).map((L) => `<button class="mk-way${dist(L) < 6 ? ' here' : ''}" data-id="${L.id}"><span class="ico">${ICON.waystone}</span><span>${L.name || '등석'}</span><em>${dist(L) < 6 ? '이곳' : Math.round(dist(L)) + 'm'}</em></button>`).join('') || '<p class="mk-none">아직 밝힌 등석이 없다. 등석을 밝히면 이곳에서 바로 이동할 수 있다.</p>'}</div>`
        + `<div class="keys mk-keys"><span><i class="ico" style="width:16px;height:16px;color:var(--gold)">${ICON.controls}</i>휠 · 확대와 축소</span><span><i class="ico" style="width:16px;height:16px;color:var(--gold)">${ICON.mouseL}</i>끌기 · 지도 옮기기</span></div>`;
      for (const b of keys.querySelectorAll('.mk-way:not(.here)')) {
        const L = G.world.lanterns[b.dataset.id];
        b.addEventListener('mouseenter', () => { G.audio.play('ui_hover'); this.mapHover = L; this.drawMap(); });
        b.addEventListener('mouseleave', () => { if (this.mapHover === L) { this.mapHover = null; this.drawMap(); } });
        b.addEventListener('click', () => G.game.travel(L));
      }
    }
    for (const b of keys.querySelectorAll('.mk-way')) b.classList.toggle('hot', !!this.mapHover && b.dataset.id === String(this.mapHover.id));
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
    const cv = $('#map-canvas');
    let best = null, bd = 22 * (cv.width / (cv.clientWidth || cv.width));
    for (const m of this.mapLanterns || []) { const d = Math.hypot(m.sx - x, m.sz - y); if (d < bd) { bd = d; best = m.L; } }
    return best;
  }

  // ---------------- journal ----------------
  // the hub's tab bar and header follow the open page
  hubState(menu, tab) {
    const key = menu === 'journal' ? `journal:${tab}` : menu;
    let title = '';
    for (const b of document.querySelectorAll('.hub-nav button')) { const on = b.dataset.nav === key; b.classList.toggle('on', on); if (on) title = b.querySelector('span').textContent; }
    $('.hub-title b').textContent = title;
    $('.hub-lv').textContent = G.player.level;
    $('.hub-sp').textContent = G.skills ? G.skills.points : 0;
  }
  drawJournal(tab = 'quests') {
    const body = $('.jr-body');
    this.hubState('journal', tab);
    body.scrollTop = 0;
    const S = G.story, P = G.player;
    const ico = (n, col) => `<span class="ico"${col ? ` style="color:${col}"` : ''}>${ICON[n] || EL_SVG[n]}</span>`;
    const sec = (t, sub = '', cnt = '') => `<div class="jsec">${t}${sub ? `<small>${sub}</small>` : ''}${cnt ? `<span class="cnt">${cnt}</span>` : ''}</div>`;
    const mana = (n) => `<span class="tag"><i></i>${n}</span>`;
    if (tab === 'quests') {
      const qs = S ? Object.values(S.quests) : [];
      const act = qs.filter((q) => q.state === 'active'), done = qs.filter((q) => q.state === 'done');
      const row = (q) => `<div class="jq ${q.state === 'done' ? 'done' : q.type === 'main' ? 'main' : ''}">${ico(q.state === 'done' ? 'check' : q.type === 'main' ? 'quest' : 'side')}<h3>${q.title}<small>${q.type === 'main' ? '이야기' : '곁가지'}</small></h3><p>${fillName(q.desc || '', G.playerName)}</p>${q.state === 'active' && q.obj ? `<p class="obj">${q.obj}</p>` : ''}</div>`;
      body.innerHTML = `<div class="jcols"><div>${sec('진행 중', '', act.length || '')}${act.map(row).join('') || '<p class="jempty">진행 중인 여정이 없다.</p>'}</div>
        <div>${sec('지난 여정', '', done.length || '')}${done.map(row).join('') || '<p class="jempty">아직 마친 여정이 없다.</p>'}</div></div>`;
    } else if (tab === 'spells') {
      const K = G.skills;
      const chip = (i, t, v) => `<span class="chip"><i data-ico>${ICON[i]}</i><span>${t}</span><b>${v}</b></span>`;
      let h = sec('속성의 노래') + `<div class="jstat">${chip('spark', '레벨', P.level)}${chip('diamond', '마법 위력', P.power().toFixed(1))}${chip('point', '울림점', K ? K.points : 0)}${chip('mana', '마나', `${Math.floor(P.mana)} / ${P.maxMana}`)}</div>`
        + `<p class="jnote">마나는 전투 중 초당 ${P.manaRegenRate(true).toFixed(1)}, 전투 밖 초당 ${P.manaRegenRate(false)} 회복된다 (마지막 시전 1.4초 뒤부터). 적을 쓰러뜨리면 떨어지는 마나 방울, 원소 반응(+3), 완벽 회피(+15)로 되찾는다.</p>`;
      const row = (inp, name, tags, desc, off = false) => `<div class="sp-row${off ? ' off' : ''}"><div class="in">${inp}</div><div><h5>${name}${tags}</h5><p>${desc}</p></div></div>`;
      for (const e of ELEMENTS) {
        if (!P.unlocked.has(e)) continue;
        const ult = ultInfo(e), hasUlt = K && K.ultFor(e), col = EL_INFO[e].css;
        const heavy = K && !K.has(SIG[e])
          ? row(`${ico('mouseR')}우클릭`, HEAVY[e].name, mana(HEAVY[e].cost), `아직 익히지 못한 기술. 울림 나무(<kbd>K</kbd>) ${EL_INFO[e].name}의 뿌리에서 울림점 ${NODES[SIG[e]].cost}점으로 익히거나, 레벨이 오를 때 <b>울림의 갈림길</b>에서 고를 수 있다.`, true)
          : row(`${ico('mouseR')}우클릭`, HEAVY[e].name, `${mana(HEAVY[e].cost)}<span class="tag cd">재사용 ${HEAVY[e].cd}초</span>`, HEAVY[e].desc);
        h += `<div class="jsp" style="--c:${col}"><div class="ic">${EL_SVG[e]}</div><div><h4>${EL_INFO[e].name}의 노래${K ? `<small>울림 나무 ${K.spentIn(e)}점</small>` : ''}</h4><p>${EL_INFO[e].desc}</p>`
          + row(`${ico('mouseL')}좌클릭`, BOLT[e].name, BOLT[e].cost ? mana(BOLT[e].cost) : '', BOLT[e].desc)
          + row(`${ico('mouseL')}길게 눌러 떼기`, CHARGED[e].name, mana(CHARGED[e].cost), CHARGED[e].desc)
          + heavy
          + row('<kbd>F</kbd>궁극기', ult.name, hasUlt ? '' : '<span class="tag cd">울림 나무 끝에서 익힐 수 있다</span>', ult.desc(1).replace('궁극기 (F). ', ''), !hasUlt)
          + '</div></div>';
      }
      if (P.unlocked.size < ELEMENTS.length) h += `<p class="jsp-more">아직 듣지 못한 노래가 골짜기 어딘가에 잠들어 있다.</p>`;
      const wk = !K || K.has(WEAVE_NODE);
      h += sec('엮기', `<kbd>Q</kbd> 지금 속성 + 직전 속성 · 마나 ${WEAVE_COST} · 재사용 ${WEAVE_CD}초`)
        + (wk ? '' : `<p class="jnote">아직 익히지 못한 기술. 두 가지 속성을 깨우친 뒤 울림 나무(<kbd>K</kbd>) 조화의 뿌리 <b>두 노래 엮기</b>를 익히면 쓸 수 있다.</p>`) + `<div class="react-grid" style="opacity:${wk ? 1 : 0.6}">`;
      for (const [k, w] of Object.entries(WEAVE)) {
        const els = k === 'arcane' ? ['arcane'] : k.split('+');
        if (!els.every((e) => P.unlocked.has(e))) continue;
        h += `<div><span class="rc">${k === 'arcane' ? '비전 + 아무 속성' : els.map((e) => `<span style="color:${EL_INFO[e].css}">${EL_INFO[e].name}</span>`).join(' + ')}</span><b>${w.name}</b><br>${w.desc}</div>`;
      }
      const disc = K ? K.discovered : new Set();
      h += '</div>' + sec('원소 반응 도감', '', `${[...disc].filter((r) => REACTIONS[r]).length} / ${Object.keys(REACTIONS).length} 발견`) + '<div class="react-grid codex">';
      // unknown elements show as a plain '?', and so does the recipe that needs them
      const known = (e) => e === '*' || P.unlocked.has(e);
      const ic = (e) => (e === '*' ? `<span class="cx-any">${ICON.spark}</span>` : !known(e) ? '<span class="cx-any">?</span>' : `<span style="color:${EL_INFO[e].css}">${EL_SVG[e]}</span>`);
      for (const [id, r] of Object.entries(REACTIONS)) {
        const d = disc.has(id);
        const hid = !d && !r.els.every(known);
        h += `<div class="cx ${d ? '' : 'unk'}"><span class="cx-els">${ic(r.els[0])}<i>+</i>${ic(r.els[1])}</span><span><b style="color:${d ? r.color : '#8a8478'}">${d ? r.name : '???'}</b><br>${hid ? '아직 모르는 노래가 있어야 일어난다.' : r.desc}</span></div>`;
      }
      h += '</div>';
      // lingering fields and what a second element turns them into
      const fm = Object.entries(FIELD_MIX);
      h += sec('땅의 흔적', '불길·서리밭·물웅덩이·김·대전된 땅에 다른 속성을 더하면 모습이 바뀐다', `${fm.filter(([k]) => disc.has('f:' + k)).length} / ${fm.length} 발견`) + '<div class="react-grid codex">';
      for (const [k, m] of fm) {
        const d = disc.has('f:' + k);
        const [from, by] = k.includes('+') ? k.split('+') : k.startsWith('whirl:') ? [null, k.slice(6)] : [null, 'arcane'];
        const src = from ? `<span class="cx-f" style="color:${FIELDS[from].color}">${FIELDS[from].name}</span>` : `<span class="cx-any">${k.startsWith('whirl:') ? ICON.whirl : ICON.spark}</span>`;
        const hid = !d && (!known(by) || (from && !P.unlocked.has(FIELDS[from].el || 'arcane')));
        h += `<div class="cx ${d ? '' : 'unk'}"><span class="cx-els">${hid && from ? '<span class="cx-any">?</span>' : src}<i>+</i>${ic(by)}</span><span><b style="color:${d ? m.color : '#8a8478'}">${d ? m.name : '???'}</b><br>${hid ? '아직 모르는 노래가 있어야 일어난다.' : m.desc}</span></div>`;
      }
      body.innerHTML = h + '</div>';
    } else if (tab === 'memories') {
      let h = (G.sketches ? G.sketches.html() : '') + sec('모라의 기억', '골짜기에 두고 온 것들');
      for (const [id, m] of Object.entries(MEMORIES)) {
        const st = S ? S.memoryState(id) : 'none';
        h += `<div class="jq ${st === 'given' ? 'done' : st === 'none' ? 'unk' : ''}">${ico(st === 'given' ? 'check' : st === 'none' ? 'lock' : 'memory')}<h3>${st === 'none' ? '???' : m.name}${st === 'given' ? '<small>전해 줌</small>' : st === 'have' ? '<small>가지고 있음</small>' : ''}</h3><p>${st === 'none' ? '아직 찾지 못했다.' : m.desc}</p></div>`;
      }
      h += sec('노래 씨앗', '', `${S ? S.seedCount() : 0} / 16`) + `<p class="jnote">골짜기 곳곳에서 들려오는 작은 노랫소리를 따라가면 씨앗을 찾을 수 있다. 네 개를 모을 때마다 울림이 깊어진다.</p>`;
      body.innerHTML = h;
    } else {
      // keys: plain strings are keycaps, '@name' is a glyph from the icon family
      const rows = [
        [['W', 'A', 'S', 'D'], '이동'], [['@controls'], '시점 · 조준 (화면 클릭 시 마우스 고정)'], [['Shift'], '누르고 있기: 달리기'], [['Shift'], '짧게: 순간이동 (회피, 무적 시간)'],
        [['Space'], G.story && G.story.flag('glide') ? '점프 / 공중에서 누르고 있기: 활공' : '점프'], [['@mouseL'], '기본 마법 (누르고 있다가 떼면 모아 쏘기)'], [['@mouseR'], '고유 마법 (울림 나무에서 익힌 속성만)'], [['Q'], '엮기: 현재 속성 + 직전 속성 (조화 · 두 노래 엮기)'],
        [['F'], '궁극기 (울림 게이지가 가득 찼을 때)'], [['1', '~', '6', '휠'], '속성 전환'], [['T', '휠 클릭'], '대상 고정'], [['E'], '대화 · 조사 · 상호작용'], [['M'], '지도 (등석 클릭: 빠른 이동)'], [['Tab', 'J'], '여정 · 마법서'], [['K'], '울림 나무 (스킬 트리)'], [['1', '2', '3'], '울림의 갈림길에서 고르기 (레벨업 후)'], [['Esc'], '일시 정지'],
      ];
      const key = (k) => (k[0] === '@' ? ico(k.slice(1)) : k === '~' ? '<span>~</span>' : `<kbd>${k}</kbd>`);
      const tips = [
        '속성을 번갈아 쓰면 적에게 쌓인 상태와 반응한다. 얼리고 → 번개로 부수고, 물로 적시고 → 번개로 감전시키고, 불태우고 → 바람으로 퍼뜨려라. 불타는 적에게 물을 끼얹으면 불이 꺼지며 피해가 준다.',
        '공격이 닿기 직전 순간이동으로 피하면 <b>완벽 회피</b> — 잠시 적이 느려진다.', '적을 맞히고 반응을 일으키면 울림 게이지가 차고, 가득 차면 <kbd>F</kbd> 궁극기를 쓸 수 있다.',
        '레벨이 오르면 <b>울림의 갈림길</b>이 열린다. 고유 마법·엮기·궁극기 같은 기술은 하나씩 익혀야 쓸 수 있다.', '마나는 전투 중엔 천천히 찬다. 적이 떨어뜨리는 마나 방울을 모으고, 반응을 일으켜라.',
        '울음탈이 쏘는 구체는 마법으로 맞혀 없앨 수 있다.', '활공 중 바람의 고유 마법을 쓰면 상승 기류를 탄다.', '서리 마법은 물 위에 얼음 발판을 만든다.', '등석을 밝히면 체력을 회복하고, 쓰러졌을 때 그곳에서 깨어난다.',
      ];
      body.innerHTML = `<div class="ctrl-wrap"><div>${sec('조작')}<div class="ctrl-grid">${rows.map(([k, v]) => `<span class="k">${k.map(key).join('')}</span><span>${v}</span>`).join('')}</div></div>
        <div>${sec('요령')}<ul class="tips">${tips.map((t) => `<li>${t}</li>`).join('')}</ul></div></div>`;
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
    const btn = $('[data-act="skills-reset"]'), label = '모두 잊기 · 울림점 되돌리기';
    const disarm = () => { this.skResetArm = false; btn.classList.remove('armed'); btn.textContent = label; };
    if (!this.skResetArm) { this.skResetArm = true; btn.classList.add('armed'); btn.textContent = '한 번 더 누르면 모두 잊는다'; clearTimeout(this.skResetT); this.skResetT = setTimeout(disarm, 3000); return; }
    clearTimeout(this.skResetT); disarm();
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
    this.hubState('skills');
    // tabs
    const tabs = root.querySelector('.sk-tabs');
    tabs.innerHTML = TREE_ORDER.filter((t) => t === 'harmony' || K.treeOpen(t)).map((t) => {
      const open = K.treeOpen(t);
      const col = t === 'harmony' ? '#f1d48a' : EL_INFO[t].css;
      const icon = t === 'harmony' ? ICON.harmony : EL_SVG[t];
      return `<button class="sk-tab ${t === this.skTree ? 'on' : ''} ${open ? '' : 'locked'}" data-t="${t}" style="color:${col}"><span class="ti">${icon}</span><span class="tn">${TREES[t].name}</span><span class="tp">${open ? K.spentIn(t) : ICON.lock}</span></button>`;
    }).join('');
    tabs.querySelectorAll('.sk-tab').forEach((b) => b.addEventListener('click', () => {
      if (!K.treeOpen(b.dataset.t)) { G.audio.play('mana_empty'); this.toast(b.dataset.t === 'harmony' ? '조화의 나무는 두 가지 속성을 깨우친 뒤에 열린다.' : `${EL_INFO[b.dataset.t].name}의 노래를 아직 모른다.`); return; }
      G.audio.play('page'); this.skTree = b.dataset.t; this.skSel = null; this.drawSkills();
    }));
    // nodes
    const T = TREES[this.skTree];
    const col = this.skTree === 'harmony' ? '#f1d48a' : EL_INFO[this.skTree].css;
    root.querySelector('.sk-motto').innerHTML = `<b style="color:${col}">${T.name}의 나무</b><span>${T.motto}</span>${this.skTree !== 'harmony' ? `<span>이 나무에 쓴 울림점<em>${K.spentIn(this.skTree)}</em></span>` : '<span>두 속성 나무에 각각 2점 이상</span>'}`;
    const box = root.querySelector('.sk-tree');
    const W = box.clientWidth || 560, H = box.clientHeight || 470;
    const maxT = T.maxTier || 4;
    // top margin leaves room for the motto + the ult diamond, bottom for the root node's name
    const tight = H < 480; // a short tree (big UI scale on a small window) keeps less margin
    const top = Math.max(T.harmony ? 74 : tight ? 38 : 50, H * 0.1), bot = Math.max(tight ? 44 : 60, H * 0.12);
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
    const harmIcon = ICON.harmony;
    nodes.innerHTML = T.nodes.map((n) => {
      const p = pos(n);
      const r = K.r(n.id);
      const why = K.blocker(n.id);
      const state = r >= n.max ? 'max' : r > 0 ? 'some' : !why ? 'avail' : 'locked';
      let icon;
      const veil = veiled(n);
      if (n.kind === 'harmony') icon = `<span class="pair">${n.els.map((e) => e === '*' ? `<span style="color:#f1d48a">${ICON.spark}</span>` : !elKnown(e) ? '<span style="color:#8a8478">?</span>' : `<span style="color:${EL_INFO[e].css}">${EL_SVG[e]}</span>`).join('')}</span>`;
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
      box.innerHTML = `<div class="si-empty"><div class="si-k">울림점</div><div class="si-big">${K.points}</div><p>레벨이 오를 때마다 울림점 2점을 얻고 <b>울림의 갈림길</b>이 열린다. 보스, 이름 붙은 것들, 모라의 기억, 노래 씨앗 넷도 울림점을 준다.</p><p>나무의 뿌리는 <b>기술</b>이다. 고유 마법(우클릭)과 엮기(Q)는 익혀야 쓸 수 있고, 뿌리를 익혀야 위의 갈래가 열린다. 끝에는 <b>궁극기(F)</b>가 기다린다.</p><p>노드를 눌러 살펴보고, 한 번 더 누르면 익힌다.</p>${learned.length ? `<div class="si-k" style="margin-top:18px">이 나무에서 익힌 노래</div><ul>${learned.map((n) => `<li>${n.name}${n.max > 1 ? `<span>${K.r(n.id)} / ${n.max}</span>` : ''}</li>`).join('')}</ul>` : ''}</div>`;
      return;
    }
    const n = NODES[id];
    if (veiled(n)) {
      box.innerHTML = `<div class="si-head" style="color:#8a8478"><div class="si-kind">조화</div><div class="si-name">???</div></div><div class="si-row"><p>아직 듣지 못한 노래와 엮이는 갈래. 그 노래를 깨우치면 모습을 드러낸다.</p></div>`;
      return;
    }
    const r = K.r(id);
    const why = K.blocker(id);
    const col = n.tree === 'harmony' ? '#f1d48a' : EL_INFO[n.tree].css;
    const kind = n.kind === 'ult' ? '궁극기 · F' : n.kind === 'active' ? (n.sig ? '기술 · 고유 마법 · 우클릭' : '기술 · 엮기 · Q') : n.kind === 'harmony' ? `조화 · ${n.els.map((e) => (e === '*' ? '아무 두 속성' : EL_INFO[e].name)).join(' + ')}` : n.max > 1 ? `지속 효과 · 최대 ${n.max}단계` : '지속 효과';
    const cur = r > 0 ? `<div class="si-row"><span class="si-k">지금</span><p>${n.desc(r)}</p></div>` : '';
    const next = r < n.max ? `<div class="si-row"><span class="si-k">${r > 0 ? '다음 단계' : '익히면'}</span><p>${n.desc(r + 1)}</p></div>` : '<div class="si-row"><span class="si-k">완성</span><p>이 노래를 모두 익혔다.</p></div>';
    const btn = r < n.max ? `<button class="sk-learn ${why ? 'off' : ''}" data-id="${id}">${why ? `<span class="ico">${ICON.lock}</span>${why}` : `익히기 · 울림점 <b>${n.cost}</b>`}</button>` : '';
    const pips = n.max > 1 ? `<div class="si-rank"><span class="pips">${Array.from({ length: n.max }, (_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('')}</span>${r} / ${n.max}</div>` : '';
    box.innerHTML = `<div class="si-head" style="color:${col}"><div class="si-kind">${kind}</div><div class="si-name">${n.name}</div>${pips}</div>${cur}${next}${btn}`;
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
    root.querySelector('.cr-lv').innerHTML = `레벨 <b>${P.level}</b>${K.cross > 1 ? ` <span>· 남은 갈림길 ${K.cross}</span>` : ''}`;
    root.querySelector('.cr-desc').innerHTML = '울림이 깊어지며 노래의 길이 갈라진다. 한 갈래를 골라 익히자.';
    const q = root.querySelector('.cr-quote');
    if (G.story && G.story.flag('v_altar') && G.story.once('c:cross1')) {
      q.innerHTML = '<b>보름</b>갈림길이로구나. 노래는 한 번에 한 갈래씩 깊어진다. 욕심은 다음 갈림길에 부리거라.';
      q.classList.remove('hidden');
      let k = 0; const iv = setInterval(() => { if (k++ > 10) clearInterval(iv); else G.audio.blip({ f: 760, type: 'sine', formant: 2300, d: 0.035, v: 0.05, slide: 1.12 }); }, 70);
    } else q.classList.add('hidden');
    root.querySelector('.cr-pts').innerHTML = `<i data-ico>${ICON.point}</i><span>울림점</span><b>${K.points}</b>`;
    const harmIcon = ICON.harmony;
    const cards = root.querySelector('.cr-cards');
    cards.innerHTML = offers.map((c, i) => {
      const n = c.n, r = c.r, col = treeColor(n.tree);
      const tag = n.kind === 'ult' ? '궁극기' : n.kind === 'active' ? (n.id === WEAVE_NODE ? '새 기술 · 조화' : '새 기술') : n.kind === 'harmony' ? '조화' : `강화${n.max > 1 ? ` ${r} → ${r + 1}` : ''}`;
      let icon;
      if (n.kind === 'harmony') icon = `<span class="pair">${n.els.map((e) => (e === '*' ? `<span style="color:#f1d48a">${ICON.spark}</span>` : `<span style="color:${EL_INFO[e].css}">${EL_SVG[e]}</span>`)).join('')}</span>`;
      else icon = n.tree === 'harmony' ? harmIcon : EL_SVG[n.tree];
      const pips = n.max > 1 ? `<span class="cr-pips">${Array.from({ length: n.max }, (_, k) => `<i class="${k < r ? 'on' : k === r ? 'next' : ''}"></i>`).join('')}</span>` : '';
      const tree = n.tree === 'harmony' ? '조화의 나무' : `${TREES[n.tree].name}의 나무`;
      return `<button class="cr-card k-${n.kind}${isTechnique(n) ? ' tech' : ''}" data-i="${i}" style="--c:${col};--d:${120 + i * 110}ms">
        <span class="cr-glow"></span>
        <span class="cr-top"><kbd class="cr-key">${i + 1}</kbd><span class="cr-tag">${tag}</span></span>
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
    $('#crossroads .cr-pts').innerHTML = `<i data-ico>${ICON.point}</i><span>울림점</span><b>${K.points}</b>`;
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
