// Game orchestrator: boot, title, main loop, menus, save/load.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { Input } from '../core/input.js';
import { AudioEngine } from '../core/audio.js';
import { Music } from '../core/music.js';
import { Renderer } from '../render/renderer.js';
import { VFX } from '../render/vfx.js';
import { World, LANTERNS } from '../world/world.js';
import { POI, regionAt } from '../world/layout.js';
import { CameraRig } from './camera.js';
import { Combat } from './combat.js';
import { Spells } from './spells.js';
import { EnemyManager, DEF } from './enemies.js';
import { NPCs, Companion } from './npcs.js';
import { Player } from './player.js';
import { Dialogue } from './dialogue.js';
import { HUD } from './hud.js';
import { Story } from './story.js';
import { Skills } from './skills.js';
import { fillName } from '../core/util.js';

const SAVE_KEY = 'ullimjigi_save_v1';
const SET_KEY = 'ullimjigi_settings';
const $ = (s) => document.querySelector(s);
const DEV = new URLSearchParams(location.search).has('dev');
const raf = (fn) => (DEV ? setTimeout(fn, 16) : requestAnimationFrame(fn));
const nextFrame = () => new Promise((r) => raf(() => r()));

const INTRO = [
  '태초에, 세상은 노래로 빚어졌다.',
  '불은 타오르는 노래를,\n서리는 고요한 노래를,\n번개는 외치는 노래를,\n바람은 흐르는 노래를 불렀다.',
  '사람들은 그 노래를 듣고, 빌려 부르는 법을 배웠다.\n우리는 그들을 *울림지기*라 불렀다.',
  '그러나 모든 노래에는 끝이 있다.\n잊힌 노래는 소리를 잃고,\n소리를 잃은 것들은 잿빛이 되어 떠돈다.',
  '사람들은 그것을 *고요*라 불렀다.',
  '하늬 골짜기.\n세 개의 종이 울리는 동안, 고요는 이곳에 닿지 못했다.',
  '그리고 오늘 아침—\n종소리가 들리지 않았다.',
];

export class Game {
  constructor() {
    G.game = this;
    this.timers = [];
    this.lastT = performance.now();
    this.musicOverride = null;
    this.combatHold = 0;
    this.respawn = null;
    this.busy = false;
    this.menu = null;
  }

  loadSettings() {
    try { Object.assign(G.settings, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (_) {}
  }
  saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(G.settings)); } catch (_) {} }

  progress(p, text) {
    $('.load-fill').style.width = `${Math.round(p * 100)}%`;
    if (text) $('.load-text').textContent = text;
  }

  async boot() {
    this.loadSettings();
    const canvas = $('#game');
    G.input = new Input(canvas);
    G.audio = new AudioEngine();
    G.music = new Music(G.audio);
    G.later = (fn, ms) => this.timers.push({ t: G.time + ms / 1000, fn });
    this.progress(0.02, '골짜기의 노래를 조율하는 중…');
    await nextFrame();
    G.renderer = new Renderer(canvas);
    G.scene = G.renderer.scene; G.camera = G.renderer.camera;
    G.vfx = new VFX(G.scene);
    await nextFrame();
    G.world = new World(G.scene, (p, t) => this.progress(p, t));
    this.progress(0.75, '사람들을 깨우는 중…');
    await nextFrame();
    G.cameraRig = new CameraRig(G.camera);
    G.combat = new Combat();
    G.spells = new Spells();
    G.enemies = new EnemyManager();
    G.npcs = new NPCs();
    G.skills = new Skills();
    G.player = new Player(G.scene);
    G.companion = new Companion();
    G.dialogue = new Dialogue();
    G.hud = new HUD();
    G.player.teleport(POI.spawn.x, POI.spawn.z, 2.2);
    G.player.root.visible = false;
    G.world.grass.setQuality(G.settings.quality);
    this.bindUI();
    this.progress(0.88, '마법을 예열하는 중…');
    await nextFrame();
    await this.warmup();
    this.progress(1, '준비되었습니다');
    G.state = 'title';
    G.world.sky.setHour(17.4);
    G.cameraRig.mode = 'title';
    this.loop();
    const ld = $('#loading');
    if (DEV) {
      ld.classList.add('hidden');
      G.playerName = '리안';
      this.devStart(new URLSearchParams(location.search).get('dev'));
      return;
    }
    $('.load-text').textContent = '클릭하여 시작';
    $('.load-text').style.animation = 'nextBob 1.4s infinite';
    await new Promise((r) => ld.addEventListener('click', r, { once: true }));
    G.audio.init();
    G.music.setMood('title');
    ld.style.opacity = 0;
    setTimeout(() => ld.classList.add('hidden'), 1000);
    this.showTitle();
  }

  devStart(preset) {
    if (preset === 'continue') { $('#title-screen').classList.add('hidden'); this.continueGame(); return; }
    const P = G.player;
    const pro = ['p_intro', 'p_run', 'p_bolt', 'p_fire', 'p_heavy', 'p_fight', 'p_end', 'prologueDone'];
    const vil = ['v_arrive', 'v_bau', 'v_isol', 'v_altar', 'v_defend', 'v_wind', 'worldOpen', 'bountyActive'];
    const bel = ['f_guard', 'f_open', 'f_echo', 'f_boss', 'f_learn', 'frostBell', 's_open', 's_boss', 's_learn', 'stormBell'];
    const mor = ['m_talk', 'm_names', 'm_choir'];
    const P_ = {
      village: { ch: 'village', flags: pro, els: ['arcane', 'fire'], lv: 2, pos: [4, 60] },
      bells: { ch: 'bells', flags: [...pro, ...vil], els: ['arcane', 'fire', 'wind'], lv: 4, pos: [8, 24] },
      frost: { ch: 'bells', flags: [...pro, ...vil], els: ['arcane', 'fire', 'wind'], lv: 5, pos: [-30, -140] },
      storm: { ch: 'bells', flags: [...pro, ...vil, 'f_guard', 'f_open', 'f_echo', 'f_boss', 'f_learn', 'frostBell'], els: ['arcane', 'fire', 'wind', 'frost'], lv: 6, pos: [-150, -24] },
      mora: { ch: 'mora', flags: [...pro, ...vil, ...bel, 'water_learn'], els: ['arcane', 'fire', 'wind', 'frost', 'storm', 'water'], lv: 8, pos: [-16, 128] },
      rift: { ch: 'rift', flags: [...pro, ...vil, ...bel, ...mor, 'water_learn'], els: ['arcane', 'fire', 'wind', 'frost', 'storm', 'water'], lv: 10, pos: [96, -90] },
      lake: { ch: 'bells', flags: [...pro, ...vil], els: ['arcane', 'fire', 'wind'], lv: 4, pos: [-34, 52] },
      skills: { ch: 'mora', flags: [...pro, ...vil, ...bel, 'water_learn'], els: ['arcane', 'fire', 'wind', 'frost', 'storm', 'water'], lv: 12, pos: [4, 60] },
    }[preset];
    if (!P_) { this.startPlay(new Story(), null); return; }
    const flags = {}; P_.flags.forEach((f) => (flags[f] = true));
    const story = new Story({ chapter: P_.ch, flags, quests: {}, counters: {}, seeds: [], memories: {}, said: [], hush: 0.12 });
    P.unlocked = new Set(P_.els); P.element = P_.els[P_.els.length - 1]; P.prevElement = P_.els[P_.els.length - 2];
    P.level = P_.lv; P.maxHp = 20 + Math.floor(P_.lv / 2) * 4; P.hp = P.maxHp; P.maxMana = 100 + (P_.lv - 1) * 6; P.mana = P.maxMana;
    for (const L of Object.values(G.world.lanterns)) L.setLit(true);
    G.skills.points = Skills.expected(P_.lv, story);
    G.skills.earned = G.skills.points;
    // techniques must be learned now; presets get the ones their story point implies for free
    G.skills.grantBasics();
    if (preset === 'skills') G.skills.gauge = 100;
    G.world.sky.setHour(10);
    this.startPlay(story, { player: { pos: P_.pos, yaw: 0 } });
  }

  async warmup() {
    const grp = new THREE.Group();
    const rigs = Object.values(DEF).map((d) => d.make());
    rigs.forEach((r, i) => { r.root.position.set(i * 2, -50, 0); grp.add(r.root); });
    const orb = G.vfx.orb('fire', 0.3); grp.add(orb);
    const tor = G.vfx.tornado(new THREE.Vector3(0, -50, 0)); tor.done = true;
    const bm = G.vfx.beam('arcane'); bm.done = true;
    G.vfx.rings.forEach((r) => (r.m.visible = true));
    G.scene.add(grp);
    // compile against the HDR scene target: programs are keyed by output colour space /
    // tone mapping, and the frame is drawn into the composer's target, not the canvas
    const R = G.renderer.renderer, prevRT = R.getRenderTarget();
    const rt = G.renderer.composer && G.renderer.composer.readBuffer;
    if (rt) R.setRenderTarget(rt);
    let pr = null;
    try { pr = R.compileAsync(G.scene, G.camera); } catch (_) { try { R.compile(G.scene, G.camera); } catch (e) { /* ignore */ } }
    R.setRenderTarget(prevRT);
    try { if (pr) await pr; } catch (_) { /* ignore */ }
    G.vfx.rings.forEach((r) => (r.m.visible = false));
    G.scene.remove(grp);
    G.vfx.disposeOrb(orb);
  }

  // ------------------------------------------------------------ UI
  bindUI() {
    document.querySelectorAll('.tbtn').forEach((b) => {
      b.addEventListener('mouseenter', () => G.audio.play('ui_hover'));
      b.addEventListener('click', (e) => { e.stopPropagation(); G.audio.play('ui_click'); this.onButton(b.dataset.act); });
    });
    $('#name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.onButton('name-ok'); e.stopPropagation(); });
    document.querySelectorAll('.jr-tabs button').forEach((b) => b.addEventListener('click', () => { G.audio.play('page'); G.hud.drawJournal(b.dataset.tab); this.jTab = b.dataset.tab; }));
    document.querySelectorAll('[data-set]').forEach((el) => {
      const k = el.dataset.set;
      if (el.type === 'checkbox') el.checked = !!G.settings[k]; else el.value = G.settings[k];
      el.addEventListener('input', () => {
        G.settings[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
        G.audio.applyVolumes();
        if (k === 'quality') { G.renderer.applyQuality(); G.world.grass.setQuality(el.value); }
        this.saveSettings();
      });
    });
    $('#game').addEventListener('click', () => {
      if (G.state === 'play' && G.mode === 'free' && !this.menu && !G.input.locked && !G.player.dead) G.input.requestLock();
    });
    $('#map-canvas').addEventListener('click', (e) => this.onMapClick(e));
    G.input.onLockChange = (locked) => {
      $('#click-to-play').classList.toggle('hidden', locked || G.state !== 'play' || !!this.menu);
      if (!locked && G.state === 'play' && !this.menu && G.mode === 'free' && !G.player.dead && !this.ignoreUnlock) this.openMenu('pause');
      this.ignoreUnlock = false;
    };
  }

  onButton(act) {
    switch (act) {
      case 'new': {
        if (this.hasSave() && !this.confirmNew) { this.confirmNew = true; G.hud.toast('저장된 여정이 있습니다. 한 번 더 누르면 새로 시작합니다.'); return; }
        $('#name-entry').classList.remove('hidden'); $('#name-input').focus(); break;
      }
      case 'name-cancel': $('#name-entry').classList.add('hidden'); break;
      case 'name-ok': {
        const n = ($('#name-input').value || '').trim() || '리안';
        G.playerName = n.slice(0, 8);
        $('#name-entry').classList.add('hidden');
        this.newGame();
        break;
      }
      case 'continue': if (this.hasSave()) this.continueGame(); break;
      case 'settings': this.prevMenu = this.menu; this.openMenu('settings'); break;
      case 'settings-close': this.closeMenu(); if (G.state === 'play' && this.prevMenu === 'pause') this.openMenu('pause'); break;
      case 'resume': this.closeMenu(); break;
      case 'journal': this.closeMenu(); this.openMenu('journal'); break;
      case 'skills': this.closeMenu(); this.openMenu('skills'); break;
      case 'skills-reset': G.hud.skillReset(); break;
      case 'cr-keep': G.hud.crKeep(); break;
      case 'cr-tree': G.hud.crTree(); break;
      case 'save': this.save(false); break;
      case 'title': this.save(true); location.reload(); break;
    }
  }

  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (_) { return false; } }

  showTitle() {
    $('#title-screen').classList.remove('hidden');
    $('[data-act="continue"]').disabled = !this.hasSave();
  }

  openMenu(name) {
    if (this.menu === name) return;
    if (this.menu && name !== 'settings') this.closeMenu();
    this.menu = name;
    this.ignoreUnlock = true;
    G.input.exitLock();
    G.paused = true;
    G.audio.play(name === 'crossroads' ? (G.audio.S && G.audio.S.levelup_open ? 'levelup_open' : 'ui_open') : 'ui_open');
    $('#click-to-play').classList.add('hidden');
    if (name === 'pause') $('#pause').classList.remove('hidden');
    if (name === 'settings') $('#settings').classList.remove('hidden');
    if (name === 'map') { G.hud.drawMap(); $('#map').classList.remove('hidden'); }
    if (name === 'journal') { G.hud.drawJournal(this.jTab || 'quests'); $('#journal').classList.remove('hidden'); }
    if (name === 'skills') { $('#skills').classList.remove('hidden'); G.hud.openSkills(); }
    if (name === 'crossroads') $('#crossroads').classList.remove('hidden');
  }
  // Level-up crossroads: opens once the player is safe (free play, out of combat, on the ground)
  openCrossroads() {
    const K = G.skills;
    if (!K.offer().length) { K.cross = 0; return; }
    this.openMenu('crossroads');
    if (!G.hud.openCrossroads()) { K.cross = 0; this.closeMenu(); }
  }
  crossroadsSafe() {
    const P = G.player;
    return G.state === 'play' && !this.menu && G.mode === 'free' && !P.dead && !this.busy && !G.paused
      && !G.enemies.inCombat() && !G.bossActive && G.slowmo <= 0 && P.grounded && !P.swimming && P.blinkT <= 0;
  }
  closeMenu() {
    if (!this.menu) return;
    for (const id of ['#pause', '#settings', '#map', '#journal', '#skills', '#crossroads']) $(id).classList.add('hidden');
    this.menu = null;
    G.paused = false;
    G.audio.play('ui_close');
    if (G.state === 'play') { G.input.requestLock(); $('#click-to-play').classList.toggle('hidden', G.input.locked); }
    G.input.clear();
  }

  // ------------------------------------------------------------ flow
  async newGame() {
    this.confirmNew = false;
    try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
    $('#title-screen').classList.add('hidden');
    G.music.setMood('silence');
    await this.intro();
    this.startPlay(new Story(), null);
  }

  async intro() {
    G.state = 'intro';
    const el = $('#intro'), tx = el.querySelector('.intro-text');
    el.classList.remove('hidden');
    G.music.setMood('memory');
    let skip = false;
    const onKey = (e) => { if (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter') skip = true; };
    window.addEventListener('keydown', onKey);
    const wait = async (ms) => { const t = performance.now(); while (performance.now() - t < ms && !skip) await nextFrame(); };
    for (const line of INTRO) {
      if (skip) break;
      tx.innerHTML = line.replace(/\*([^*]+)\*/g, '<em style="color:#f1d48a;font-style:normal">$1</em>').replace(/\n/g, '<br>');
      tx.classList.add('show');
      await wait(3600 + line.length * 45);
      tx.classList.remove('show');
      await wait(1700);
    }
    window.removeEventListener('keydown', onKey);
    const f = $('#fade'); f.style.transition = 'opacity 0.1s'; f.style.opacity = 1;
    el.classList.add('hidden');
    G.bell = true;
    G.audio.play('bell', { f: 146.8 });
    await new Promise((r) => setTimeout(r, 400));
  }

  continueGame() {
    let d;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (_) { return; }
    if (!d) return;
    $('#title-screen').classList.add('hidden');
    G.playerName = d.name || '리안';
    const P = G.player;
    P.level = d.player.level; P.xp = d.player.xp; P.maxHp = d.player.maxHp; P.hp = Math.max(4, d.player.hp);
    P.maxMana = d.player.maxMana; P.mana = P.maxMana; P.maxStamina = d.player.maxStamina; P.stamina = P.maxStamina;
    P.unlocked = new Set(d.player.unlocked); P.element = d.player.element; P.prevElement = d.player.prev;
    if (d.player.hat) P.setHat(true);
    const story0 = new Story(d.story);
    let techMigrated = false;
    if (d.skills) techMigrated = G.skills.load(d.skills);
    else { G.skills.points = Skills.expected(P.level, story0); G.skills.earned = G.skills.points; G.skills.grantBasics(); this.migratedSkills = true; }
    for (const id of d.lanterns || []) if (G.world.lanterns[id]) G.world.lanterns[id].setLit(true);
    this.respawn = d.respawn ? G.world.lanterns[d.respawn] : null;
    G.world.sky.setHour(d.hour ?? 9);
    const f = $('#fade'); f.style.transition = 'opacity 0.1s'; f.style.opacity = 1;
    this.startPlay(story0, d);
    if (techMigrated) setTimeout(() => G.hud.toast('울림 나무가 새로 자랐다 — 뿌리에 <b>기술</b>이 돋았다. 이미 쓰던 고유 마법과 엮기는 그대로 익힌 채다.', 6000), 3000);
    if (this.migratedSkills) setTimeout(() => G.hud.banner('새로운 울림', '울림 나무', `지금까지의 여정으로 <b>울림점 ${G.skills.points}점</b>을 모았다.<br><kbd>K</kbd> 울림 나무에서 속성마다 새로운 노래를 익힐 수 있다.`, '#f1d48a', 6000), 2500);
  }

  startPlay(story, d) {
    G.story = story;
    G.state = 'play'; G.mode = 'free';
    G.cameraRig.mode = 'follow';
    G.player.root.visible = true;
    G.hud.show(true);
    G.hud.updateHearts(); G.hud.updateXP(); G.hud.updateSpells();
    if (d && d.player.pos) {
      const [x, z] = d.player.pos;
      G.player.teleport(x, z, d.player.yaw ?? 0);
    } else G.player.teleport(POI.spawn.x, POI.spawn.z, 2.2);
    story.start();
    G.input.requestLock();
    if (d) {
      const f = $('#fade'); f.style.transition = 'opacity 1.2s'; f.style.opacity = 0;
      G.hud.areaTitle(regionAt(G.player.pos.x, G.player.pos.z).name, regionAt(G.player.pos.x, G.player.pos.z).en);
    }
    $('#click-to-play').classList.toggle('hidden', G.input.locked);
  }

  save(auto = true) {
    if (G.state !== 'play' || !G.story) return;
    const P = G.player;
    const d = {
      v: 1, name: G.playerName, hour: G.world.sky.hour,
      player: { level: P.level, xp: P.xp, maxHp: P.maxHp, hp: P.hp, maxMana: P.maxMana, maxStamina: P.maxStamina, unlocked: [...P.unlocked], element: P.element, prev: P.prevElement, hat: P.hasHat, pos: G.mode === 'free' && !P.dead ? [P.lastSafe.x, P.lastSafe.z] : null, yaw: P.yaw },
      lanterns: Object.values(G.world.lanterns).filter((l) => l.lit).map((l) => l.id),
      respawn: this.respawn ? this.respawn.id : null,
      story: G.story.save(),
      skills: G.skills.save(),
    };
    if (!d.player.pos) delete d.player.pos;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch (e) { console.warn(e); }
    if (!auto) G.hud.toast('여정을 기록했다.');
  }

  // ------------------------------------------------------------ lanterns & death
  lightLantern(L) {
    if (L.lit) return;
    L.setLit(true);
    G.audio.play('lantern', { pos: L.pos });
    G.vfx.burst(L.pos, 'fire', 30, { speed: 3 }); G.vfx.burst(L.pos, 'soul', 20, { el: 'gold' });
    G.vfx.ring(L.pos.clone().setY(L.pos.y - 2.2), 0xffd88a, 5, 0.8);
    G.vfx.flash(L.pos, 0xffb060, 60, 14, 0.8);
    G.hud.banner('등석을 밝혔다', L.name, '쓰러지면 이곳에서 깨어납니다 · 지도에서 이곳으로 이동할 수 있습니다', '#ffc870', 3000);
    this.respawn = L;
    G.player.heal(G.player.maxHp);
    if (G.story && G.story.once('lantern_first')) G.hud.hint(`${'<kbd>E</kbd>'} 밝힌 등석에서 쉬면 체력을 회복하고 시간을 보낼 수 있습니다 · ${'<kbd>M</kbd>'} 지도에서 등석을 눌러 빠르게 이동`, 8);
    this.save(true);
  }
  async useLantern(L) {
    if (!L.lit) {
      if (!G.player.unlocked.has('fire')) { G.hud.toast('불의 노래가 필요하다.'); return; }
      G.player.castHold = 0.8; G.player.rig.flick();
      G.vfx.lightning(G.player.staffTip(), L.pos, { color: new THREE.Color(3, 1.5, 0.4), width: 0.05, dur: 0.2, branches: 0 });
      this.lightLantern(L);
      return;
    }
    this.respawn = L;
    G.player.heal(G.player.maxHp);
    G.player.refillMana();
    G.audio.play('heal');
    G.vfx.burst(G.player.center(), 'heal', 20);
    G.dialogue.begin();
    await G.dialogue.say('narr', `등석의 불빛이 따뜻하다. 체력이 모두 회복되었다. 잠시 쉬어 갈까?`);
    const c = await G.dialogue.choose(['아침까지 쉬기', '한낮까지 쉬기', '저녁까지 쉬기', '그만 일어나기']);
    G.dialogue.end();
    if (c < 3) {
      const f = $('#fade'); f.style.transition = 'opacity 0.8s'; f.style.opacity = 1;
      await new Promise((r) => setTimeout(r, 900));
      G.world.sky.setHour([6.5, 12, 18][c]);
      G.enemies.resetCamps();
      await new Promise((r) => setTimeout(r, 500));
      f.style.opacity = 0;
      G.hud.toast('시간이 흘렀다. 잿빛 것들이 다시 모여든다…');
    }
    this.save(true);
  }

  async onPlayerDeath() {
    G.audio.play('dissolve', { pos: G.player.pos });
    G.renderer.grade.uniforms.uMono.value = 1;
    G.lockHold = true;
    await new Promise((r) => setTimeout(r, 900));
    $('#death').classList.remove('hidden');
    await new Promise((r) => setTimeout(r, 2600));
    const f = $('#fade'); f.style.transition = 'opacity 0.8s'; f.style.opacity = 1;
    await new Promise((r) => setTimeout(r, 900));
    $('#death').classList.add('hidden');
    G.renderer.grade.uniforms.uMono.value = 0;
    const L = this.respawn;
    const P = G.player;
    if (L) P.teleport(L.x + 1.5, L.z + 1.5, 0);
    else if (G.story && G.story.flag('prologueDone')) P.teleport(10, 22, Math.PI);
    else P.teleport(POI.spawn.x, POI.spawn.z, 2.2);
    P.hp = P.maxHp; P.mana = P.maxMana; P.stamina = P.maxStamina; P.exhausted = false;
    P.dead = false; P.invuln = 2;
    for (const e of G.enemies.list) if (e.aggroed && !e.boss && e.setState) { e.aggroed = false; e.setState('return'); }
    G.hud.updateHearts();
    await new Promise((r) => setTimeout(r, 300));
    f.style.opacity = 0;
  }

  async onMapClick(e) {
    const L = G.hud.mapClick(e);
    if (!L || G.mode !== 'free' || G.bossActive) return;
    G.audio.play('magic_circle');
    this.closeMenu();
    const f = $('#fade'); f.style.transition = 'opacity 0.6s'; f.style.opacity = 1;
    G.vfx.burst(G.player.center(), 'arcane', 30);
    await new Promise((r) => setTimeout(r, 700));
    G.player.teleport(L.x + 1.6, L.z + 1.6, 0);
    this.respawn = L;
    await new Promise((r) => setTimeout(r, 300));
    f.style.opacity = 0;
    G.vfx.burst(G.player.center(), 'arcane', 30);
    G.audio.play('blink');
  }

  // ------------------------------------------------------------ interaction
  updateInteract() {
    G.interactCD = Math.max(0, (G.interactCD || 0) - G.dt);
    if (G.mode !== 'free' || this.busy || G.player.dead) { G.hud.prompt(null); return; }
    const P = G.player.pos;
    let best = null, bd = 1e9;
    for (const n of G.npcs.list) {
      if (!n.visible || !n.onTalk) continue;
      const d = Math.hypot(n.pos.x - P.x, n.pos.z - P.z);
      if (d < 2.8 && d < bd) { bd = d; best = { label: `이야기하기 — ${fillName(({ mora: '모라', bau: '바우 영감', dodam: '도담', isol: '이솔', danbi: '단비 아주머니', farmer: '농부 달구', fisher: '어부 소라', elder: '장기 두는 할아버지' })[n.id] || n.id, G.playerName)}`, action: () => n.onTalk() }; }
    }
    for (const it of G.world.interactables) {
      if (!it.enabled()) continue;
      const p = typeof it.pos === 'function' ? it.pos() : it.pos;
      const d = Math.hypot(p.x - P.x, p.z - P.z);
      if (d < it.r && Math.abs(p.y - P.y) < 4 && d < bd) { bd = d; best = { label: it.dyn ? it.dyn() : it.label, action: it.action }; }
    }
    G.hud.prompt(best ? best.label : null);
    if (best && G.input.hit('KeyE') && G.interactCD <= 0) {
      G.input.consume('KeyE');
      this.busy = true;
      Promise.resolve(best.action()).catch((e) => console.error(e)).finally(() => { this.busy = false; });
    }
  }

  // ------------------------------------------------------------ music
  pickMood() {
    if (this.musicOverride) return this.musicOverride;
    if (G.state === 'title') return 'title';
    if (G.state !== 'play') return null;
    if (G.bossActive) return 'boss';
    const fight = G.enemies.inCombat();
    if (fight) this.combatHold = 5;
    if (this.combatHold > 0) return 'combat';
    const reg = regionAt(G.player.pos.x, G.player.pos.z);
    const night = G.world.sky.night > 0.5;
    if (reg.music === 'rift' && G.story && G.story.chapter !== 'post') return 'rift';
    if (reg.music === 'shrine') return 'shrine';
    if (reg.music === 'village' && !night) return 'village';
    return night ? 'night' : 'field';
  }

  // ------------------------------------------------------------ loop
  loop() {
    raf(() => this.loop());
    const now = performance.now();
    const raw = Math.min((now - this.lastT) / 1000, 0.05);
    this.lastT = now;
    G.realTime += raw;
    let dt = raw;
    if (G.hitstop > 0) { G.hitstop -= raw; dt = raw * 0.04; }
    if (G.paused) dt = 0;
    G.dt = dt;
    G.time += dt;
    const t0 = performance.now();
    try { this.update(dt, raw); } catch (e) { console.error(e); }
    const t1 = performance.now();
    const inf = G.renderer.renderer.info; inf.autoReset = false; inf.reset();
    try { G.renderer.render(raw); } catch (e) { console.error(e); }
    this.perf = { update: t1 - t0, render: performance.now() - t1, calls: G.renderer.renderer.info.render.calls, tris: G.renderer.renderer.info.render.triangles };
    G.input.endFrame();
  }

  update(dt, raw) {
    const I = G.input;
    // global keys
    if (G.state === 'play') {
      if (this.menu === 'crossroads') {
        if (I.hit('Escape')) G.hud.crKeep();
        else if (I.hit('KeyK')) G.hud.crTree();
        else ['Digit1', 'Digit2', 'Digit3'].forEach((k, i) => { if (I.hit(k)) G.hud.crPick(i); });
      } else if (this.menu) {
        if (I.hit('Escape') || (this.menu === 'map' && I.hit('KeyM')) || (this.menu === 'journal' && (I.hit('Tab') || I.hit('KeyJ'))) || (this.menu === 'skills' && I.hit('KeyK'))) { const m = this.menu; this.closeMenu(); if (m === 'settings' && this.prevMenu === 'pause') this.openMenu('pause'); }
      } else if (G.mode === 'free' && !G.player.dead) {
        if (I.hit('Escape')) this.openMenu('pause');
        else if (I.hit('KeyM')) this.openMenu('map');
        else if (I.hit('Tab') || I.hit('KeyJ')) this.openMenu('journal');
        else if (I.hit('KeyK')) this.openMenu('skills');
      }
    }
    // pending level-up crossroads: wait for a calm moment (and for the level-up banner to finish)
    if (G.skills && G.skills.cross > 0 && G.state === 'play') {
      this.crCalm = this.crossroadsSafe() ? (this.crCalm || 0) + raw : 0;
      if (this.crCalm > 2.2 && (!G.hud.bannerBusy || this.crCalm > 5)) { this.crCalm = 0; this.openCrossroads(); }
    } else this.crCalm = 0;
    // timers
    for (let i = this.timers.length - 1; i >= 0; i--) if (G.time >= this.timers[i].t) { const t = this.timers[i]; this.timers.splice(i, 1); try { t.fn(); } catch (e) { console.error(e); } }

    const P = G.player;
    if (G.slowmo > 0 && !G.paused) G.slowmo = Math.max(0, G.slowmo - raw);
    const sm = G.slowmo > 0 ? 0.25 : 1;
    const gu = G.renderer.grade.uniforms;
    G.slowK = (G.slowK || 0) + ((G.slowmo > 0 ? Math.min(1, G.slowmo * 2) : 0) - (G.slowK || 0)) * Math.min(1, raw * 8);
    if (gu.uSlowmo) gu.uSlowmo.value = G.slowK;
    if (G.audio.ready) G.audio.setMuffle(G.slowK * 0.85);
    if (G.state === 'play') {
      if (dt > 0) {
        P.update(dt, I);
        G.spells.update(dt);
        G.enemies.update(dt * sm);
        G.npcs.update(dt);
        G.companion.update(dt);
        if (G.story) G.story.update(dt);
      }
      G.dialogue.update(raw);
      this.updateInteract();
      this.combatHold -= dt;
    }
    // camera
    if (G.state === 'title' || G.state === 'intro') {
      const t = G.realTime * 0.025;
      const c = new THREE.Vector3(-4, 12, 70);
      G.camera.position.set(c.x + Math.cos(t) * 95, 48 + Math.sin(t * 0.7) * 6, c.z + Math.sin(t) * 95);
      G.camera.lookAt(c.x, 10, c.z - 10);
      G.world.update(raw, G.camera.position, new THREE.Vector3(c.x + Math.cos(t) * 40, 10, c.z + Math.sin(t) * 40));
    } else {
      G.cameraRig.update(raw, P, I);
      G.world.update(dt, G.camera.position, P.pos);
    }
    G.vfx.add.setScale(G.renderer.renderer.domElement.height, G.camera.fov);
    G.vfx.norm.setScale(G.renderer.renderer.domElement.height, G.camera.fov);
    const fog = G.scene.fog;
    for (const ps of [G.vfx.add, G.vfx.norm]) { ps.mat.uniforms.uFogDensity.value = fog.density; ps.mat.uniforms.uFogColor.value.copy(fog.color); }
    G.vfx.update(dt);
    // audio
    if (G.audio.ready) {
      G.audio.setListener(G.camera.position, G.cameraRig.yaw);
      const reg = regionAt(P.pos.x, P.pos.z);
      G.audio.updateAmbience(raw, {
        altitude: P.pos.y, gliding: P.gliding, speed: Math.hypot(P.vel.x, P.vel.y, P.vel.z), hour: G.world.sky.hour,
        rift: reg.id === 'rift' && G.story && G.story.chapter !== 'post', water: Math.max(0, 1 - Math.hypot(P.pos.x - POI.lake.x, P.pos.z - POI.lake.z) / 55),
      });
      const mood = this.pickMood();
      if (mood) G.music.setMood(mood);
      G.music.update();
    }
    if (G.state === 'play') G.hud.update(raw);
    if (I.locked && (G.state !== 'play' || G.mode !== 'free' || this.menu || G.player.dead)) { this.ignoreUnlock = true; I.exitLock(); }
    const ctp = $('#click-to-play');
    const wantCtp = G.state === 'play' && !I.locked && !this.menu && G.mode === 'free' && !G.player.dead;
    if (ctp.classList.contains('hidden') === wantCtp) ctp.classList.toggle('hidden', !wantCtp);
  }
}
