// Story director: chapters, quests, dialogue and world events.
// Each chapter is an async script that resumes from saved flags.
import * as THREE from 'three';
import { G, EL_INFO, ELEMENTS } from '../core/context.js';
import { NPC, makeCat, makeGhost } from './npcs.js';
import { makeHumanoid, CHAR } from './characters.js';
import { POI, regionAt } from '../world/layout.js';
import { MEMORIES } from '../world/world.js';
import { THEME_NOTES } from '../core/music.js';
import { Sketchbook } from './sketches.js';
import { PAL } from '../render/vfx.js';
import { HEAVY, weaveInfo } from './spells.js';
import { SIG, WEAVE_NODE, NODES } from './skills.js';
import { REACTIONS } from './combat.js';
import { pick, randRange, rand, fillName, clamp, lerp, josa } from '../core/util.js';

// grade saturation for the number of bells rung: muted in the silent vale, full at four
const satFor = (bells) => 1.12 - (4 - bells) * 0.08;

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const GV = (x, dy, z) => new THREE.Vector3(x, G.world.h(x, z) + dy, z); // ground-relative
const KBD = (k) => `<kbd>${k}</kbd>`;
// A name owned by another table (reaction, spell) inside a line: *name* plus the particle that fits it
const EM = (name, k) => `*${name}*${k ? josa(name, k).slice(name.length) : ''}`;
const RX = (id, k) => EM(REACTIONS[id]?.name ?? id, k);

export class Story {
  constructor(data = null) {
    this.flags = {}; this.chapter = 'prologue';
    this.quests = {}; this.track = null;
    this.counters = {};
    this.seeds = new Set();
    this.memories = {};
    this.waiters = [];
    this.saidOnce = new Set();
    this.dead = false;
    this.lastRegion = null; this.regionT = 0;
    this.hushBase = 0;
    if (data) this.load(data);
  }

  // ------------------------------------------------------------ state
  flag(k) { return !!this.flags[k]; }
  set(k, v = true) { this.flags[k] = v; this.dirty = true; }
  count(k, d = 0) { return this.counters[k] ?? d; }
  inc(k, n = 1) { this.counters[k] = this.count(k) + n; return this.counters[k]; }
  seedCount() { return this.seeds.size; }
  memoryState(id) { return this.memories[id] || 'none'; }

  progressLevel() {
    switch (this.chapter) {
      case 'prologue': return 1;
      case 'village': return 2;
      case 'bells': return 4 + 2 * ((this.flag('frostBell') ? 1 : 0) + (this.flag('stormBell') ? 1 : 0));
      case 'mora': return 9;
      case 'rift': return 10;
      default: return 11;
    }
  }

  save() {
    return {
      chapter: this.chapter, flags: this.flags, quests: this.quests, track: this.track, counters: this.counters,
      seeds: [...this.seeds], memories: this.memories, said: [...this.saidOnce], hush: this.hushBase,
    };
  }
  load(d) {
    this.chapter = d.chapter; this.flags = d.flags || {}; this.quests = d.quests || {}; this.track = d.track;
    this.counters = d.counters || {}; this.seeds = new Set(d.seeds || []); this.memories = d.memories || {};
    this.saidOnce = new Set(d.said || []); this.hushBase = d.hush ?? 0;
  }

  // ------------------------------------------------------------ helpers
  wait(cond) { return new Promise((res) => this.waiters.push({ cond, res })); }
  sleep(sec) { const t = G.time + sec; return this.wait(() => G.time >= t); }
  near(x, z, r) { const p = G.player.pos; return Math.hypot(p.x - x, p.z - z) < r; }
  say(who, text, o) { return G.dialogue.say(who, text, o); }
  choose(opts) { return G.dialogue.choose(opts); }
  async conv(fn, o = {}) {
    G.dialogue.begin(o);
    try { await fn(); } catch (e) { console.error(e); }
    G.dialogue.end();
  }
  async lines(list) { await G.dialogue.lines(list); }
  npc(id) { return G.npcs.get(id); }
  hint(h, d) { G.hud.hint(h, d); }
  cSay(t, once, dur) { if (G.companion) G.companion.say(t, once, dur); }
  once(k) { if (this.saidOnce.has(k)) return false; this.saidOnce.add(k); return true; }
  fade(on, sec = 0.8, white = false) {
    const f = document.getElementById('fade');
    f.classList.toggle('white', white);
    f.style.transition = `opacity ${sec}s`;
    f.style.opacity = on ? 1 : 0;
    return new Promise((r) => setTimeout(r, sec * 1000 + 50));
  }

  quest(id, title, desc, type = 'main') {
    if (this.quests[id] && this.quests[id].state === 'done') return;
    const isNew = !this.quests[id];
    this.quests[id] = this.quests[id] || { id, title, desc, type, state: 'active', obj: '', markers: [] };
    Object.assign(this.quests[id], { title, desc });
    if (type === 'main') this.track = id;
    if (isNew) {
      G.audio.play('quest_start');
      G.hud.banner(type === 'main' ? '새로운 이야기' : '곁가지 이야기', title, '', type === 'main' ? '#f1d48a' : '#bfe8ff', 2800, { minor: true });
    }
    this.refreshTracker();
  }
  obj(id, text, markers = []) {
    const q = this.quests[id];
    if (!q) return;
    q.obj = text; q.markers = markers;
    this.refreshTracker();
  }
  done(id, reward) {
    const q = this.quests[id];
    if (!q || q.state === 'done') return;
    q.state = 'done'; q.obj = ''; q.markers = []; this.dirty = true;
    G.audio.play('quest_done');
    G.hud.banner('여정 완료', q.title, reward || '', '#f1d48a', 3000, { minor: true });
    if (this.track === id) this.track = null;
    this.refreshTracker();
  }
  trackedQuest() {
    if (this.track && this.quests[this.track]?.state === 'active') return this.quests[this.track];
    return Object.values(this.quests).find((q) => q.state === 'active' && q.type === 'main') || Object.values(this.quests).find((q) => q.state === 'active');
  }
  refreshTracker() {
    const q = this.trackedQuest();
    if (!q) { G.hud.setTracker('', ''); return; }
    G.hud.setTracker(q.title, q.obj);
  }
  markers() { const q = this.trackedQuest(); return q ? q.markers : null; }

  // ------------------------------------------------------------ world setup
  setupNPCs() {
    if (G.npcs.get('mora')) return; // already built (the story restarted in this session)
    const add = (id, key, x, z, yaw, o) => { const n = G.npcs.add(new NPC(id, key, x, z, yaw, o)); n.onTalk = () => this.talkNPC(id); return n; };
    add('mora', 'mora', -6, 142, -2.2);
    add('bau', 'bau', 9, 16.5, 0.2);
    add('dodam', 'dodam', 0, 24, 0.5);
    add('isol', 'isol', 18, 26.5, -0.6);
    add('danbi', 'danbi', 13, 7.5, 0.4);
    add('farmer', 'villagerA', 36, 36, -1.2, { speaker: 'farmer' });
    add('fisher', 'villagerB', -42, 47, -1.9, { speaker: 'fisher' });
    add('elder', 'villagerC', -12.5, 6.5, 2.3, { speaker: 'elder' });
    // isol's table
    const tb = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.9), new THREE.MeshToonMaterial({ color: 0x9c7250 }));
    top.position.y = 0.85; top.castShadow = true; tb.add(top);
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshBasicMaterial({ color: 0xf4ecd8 }));
    paper.rotation.x = -Math.PI / 2; paper.position.y = 0.9; tb.add(paper);
    for (const sx of [-0.7, 0.7]) for (const sz of [-0.35, 0.35]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 0.06), new THREE.MeshToonMaterial({ color: 0x6a4a34 })); l.position.set(sx, 0.42, sz); tb.add(l); }
    tb.position.set(19.3, G.world.h(19.3, 25.2), 25.2); tb.rotation.y = -0.6; G.scene.add(tb);
    G.world.col.addBox(19.3, 25.2, 0.85, 0.5, -0.6, -10, G.world.h(19.3, 25.2) + 0.9);
    // cat
    const cat = (this.cat = makeCat());
    cat.pos = V(POI.island.x - 0.8, 0, POI.island.z + 0.6);
    cat.root.position.set(cat.pos.x, G.world.h(cat.pos.x, cat.pos.z), cat.pos.z);
    G.scene.add(cat.root);
    this.catMeowT = 3;
    this.interacts();
    this.positionNPCs();
    this.refreshBarks();
  }

  positionNPCs() {
    const ch = this.chapter;
    const mora = this.npc('mora');
    mora.pose = {};
    if (ch === 'prologue') { mora.setPos(-6, 142, -2.2); }
    else if (ch === 'post') { mora.setPos(-20, 132.1, Math.PI); mora.pose.sit = true; }
    else { mora.setPos(-20, 132.1, Math.PI); mora.pose.sit = true; }
    this.npc('elder').pose.sit = true;
    this.npc('elder').setPos(-12.5, 6.5, 2.3);
    if (this.flag('catSaved')) { this.cat.root.visible = true; this.cat.pos.set(1.2, 0, 23.5); this.cat.root.position.set(1.2, G.world.h(1.2, 23.5), 23.5); }
    const boreumOn = this.flag('v_altar');
    if (G.companion) {
      G.companion.show(boreumOn);
      if (boreumOn) G.companion.place(G.player.pos.clone().add(V(-1, 2, 0)));
    }
  }

  refreshBarks() {
    // Passing remarks are picked when spoken, so they follow the story, the weather and the hour.
    const B = (id, fn) => { const n = this.npc(id); if (n) n.barks = () => pick(fn()); };
    const f = (k) => this.flag(k);
    const rain = () => G.world.weather && G.world.weather.rain > 0.3;
    const night = () => G.world.sky.night > 0.5;
    B('mora', () => {
      const ch = this.chapter;
      if (ch === 'prologue') return ['서두를 것 없단다.', '옳지, 옳지.', '후후, 발이 가볍구나.'];
      if (ch === 'post') return ['라— 라라…', '바람이 좋네요.', '누가 종을 치나 봐요. 듣기 좋아라.'];
      if (ch === 'mora' || ch === 'rift') return ['…세하야, 추운데 어디 가니.', '라라… 이다음이 뭐였더라.', '수제비 다 불겠네…'];
      return ['발밑 조심하고.', '할미는 여기 앉아 있으마.', this.bellsRung() ? '…종소리가 곱기도 하지.' : '…오늘은 아침이 참 길구나.'];
    });
    B('bau', () => {
      if (this.chapter === 'village' && !f('v_defend')) return ['종이 왜 이리 먹통이여…', '사십 년에 이런 일은 처음이여.'];
      if (rain()) return ['거 봐, 무릎이 쑤신 게 비 올 거 같다 했더니만.', '줄이 젖으면 무거운디…'];
      return ['종은 세게 치는 게 아니라 오래 치는 겨.', '오늘도 종이 잘 울었구먼.', '무릎이 쑤셔. 비 오겄네.', ...(this.chapter === 'post' ? ['새벽 종? 내일은 도담이 차례여.'] : [])];
    });
    B('dodam', () => {
      if (night()) return ['하아암… 안 졸려요. 진짜로요.', '별이 엄청 많아요! 백 개? 천 개?'];
      if (f('catSaved')) return ['누룽지가 요즘 저만 따라다녀요!', '마법사님! 오늘은 뭐 물리치러 가요?', '저 물수제비 열세 번 떴어요! 진짜로요!'];
      return ['누룽지야~! 밥 먹자~!', '마법사님 멋있다아…', '저도 크면 울림지기 될 거예요!'];
    });
    B('isol', () => ['흥미롭군… 아주 흥미로워.', f('name_isol') ? '가설 17번, 채택. …좋은 울림이군.' : '가설 17번… 아직 백지로군.', rain() ? '이런, 적어 둔 글씨가 다 번지는군.' : '잉크가 또 떨어졌군. 연구비처럼.']);
    B('danbi', () => ['꿀빵 나왔어요~ 따끈따끈한 꿀빵!', '아이고 허리야.', '밥은 먹고 다니는 거지?', rain() ? '비 오는 날엔 빵 냄새가 멀리 가.' : '두 개 싸 줄까?']);
    B('farmer', () => (this.bellsRung() ? ['종이 우니께 밭이 조용허네.', '무야, 무야, 잘 크거라.', '에잉, 두더지 녀석들.'] : ['잿빛 것들이 또 밭을 밟았어…', '에잉, 두더지 녀석들.']));
    B('fisher', () => ['오늘은 입질이 좋네요~', f('catSaved') ? '누룽지, 그건 미끼야! 내 미끼!' : '저기 섬에 주황색 뭐가 있던데…', night() ? '별이 호수에 다 내려왔네요.' : '물이 맑으니 마음도 맑네요.']);
    B('elder', () => (f('m_choir') || this.chapter === 'post' ? ['장이야! …받아 봐, 카엘 양반.', '멍군이다, 멍군!', '에헴, 요즘 젊은이들은 장기를 몰라.'] : ['장이야!', '에헴, 요즘 젊은이들은 장기를 몰라.', '…자네 차례여. 어이.']));
  }

  interacts() {
    const W = G.world;
    // village altar (Boreum)
    W.addInteract({ id: 'altar', pos: V(6, W.h(6, 13.3) + 1, 13.3), r: 2.4, label: '종의 제단 살펴보기', enabled: () => this.chapter === 'village' && this.flag('v_isol') && !this.flag('v_altar'), action: () => this.altarScene() });
    // grave
    W.addInteract({ id: 'grave', pos: V(POI.grave.x, W.h(POI.grave.x, POI.grave.z) + 1, POI.grave.z), r: 2.2, label: '비석 읽기', enabled: () => true, action: () => this.readGrave() });
    // signposts
    for (const [x, z, t] of [[-2, -6, '↑ 북쪽: 서리봉 · 성소 가는 길 (눈길 조심)'], [-26, 10, '← 서쪽: 천둥 고원 · 옛 성소 터\n↙ 거울 호수'], [24, -1, '↗ 북동쪽: 잿빛 비탈 — 출입 금지!\n(바우 영감 백)'], [5, 50, '↓ 남쪽: 모라의 언덕\n→ 동쪽: 노을 들판']]) {
      W.addInteract({ id: 'sign', pos: V(x, W.h(x, z) + 1.5, z), r: 2, label: '표지판 읽기', enabled: () => true, action: () => this.conv(async () => { await this.say('sign', t.replace('\n', '  ·  ')); }) });
    }
    // lantern stones
    for (const L of Object.values(W.lanterns)) {
      W.addInteract({ id: 'lantern', pos: L.pos.clone(), r: 2.4, label: L.lit ? '등석에서 쉬기' : '등석 밝히기', enabled: () => this.chapter !== 'prologue' || this.flag('p_fire'), dyn: () => (L.lit ? '등석에서 쉬기' : '등석 밝히기'), action: () => G.game.useLantern(L) });
    }
    // cat
    W.addInteract({ id: 'cat', pos: () => this.cat.root.position.clone().setY(this.cat.root.position.y + 0.3), r: 2, label: '누룽지 안아 올리기', enabled: () => this.quests.q_cat?.state === 'active' && !this.flag('catCarried') && !this.flag('catSaved'), action: () => this.pickCat() });
    // shrine bells
    for (const el of ['frost', 'storm']) {
      const S = W.shrines[el];
      W.addInteract({ id: 'bell_' + el, pos: V(S.pos.x, S.y + 2, S.pos.z - 3.8), r: 2.8, label: '성소의 종 울리기', enabled: () => this.flag(el === 'frost' ? 'f_learn' : 's_learn') && !this.flag(el + 'Bell'), action: () => this.ringShrineBell(el) });
    }
  }

  // ------------------------------------------------------------ main loop
  start() {
    // the fireball is Mora's gift in the prologue: make sure it stays learned on any save past that point
    if (this.flag('p_heavy') && G.skills && !G.skills.has('f_sig')) G.skills.grant('f_sig', { silent: true });
    this.setupNPCs();
    G.world.sky.hush = this.hushBase;
    G.renderer.grade.uniforms.uSat.value = satFor(this.bellsRung());
    G.sketches ||= new Sketchbook();
    // saves from before the sketchbook: whoever started Mora's memories already has it
    if (this.quests.q_memory && !this.flag('sketchbook')) this.flags.sketchbook = true;
    // saves from before gliding was Borum's gift: anyone past the first bell already has it
    if (this.flag('v_wind') && !this.flag('glide')) this.flags.glide = true;
    // a shrine whose bell already rang stays open on any later save: frostShrine / stormShrine,
    // which reopen it, only run during chapter 2 (the music box and the badge lie inside)
    for (const el of ['frost', 'storm']) if (this.flag(el + 'Bell')) this.openSealInstant(G.world.shrines[el]);
    // restore lantern states handled by game
    this.run().catch((e) => console.error('story', e));
    this.lakeSong().catch((e) => console.error('lake', e));
  }
  async run() {
    if (this.chapter === 'prologue') await this.prologue();
    if (this.dead) return;
    if (this.chapter === 'village') await this.village();
    if (this.dead) return;
    if (this.chapter === 'bells') await this.bells();
    if (this.dead) return;
    if (this.chapter === 'mora') await this.moraChapter();
    if (this.dead) return;
    if (this.chapter === 'rift') await this.riftChapter();
    if (this.dead) return;
    this.postgame();
  }
  // How many bells ring again (0..4). The vale gets its colour, birdsong and music back
  // with each one (saturation here, birds in Audio.updateAmbience, instruments in music.js).
  bellsRung() {
    if (this.chapter === 'rift' || this.chapter === 'post') return 4;
    return (this.flag('v_wind') ? 1 : 0) + (this.flag('frostBell') ? 1 : 0) + (this.flag('stormBell') ? 1 : 0) + (this.flag('m_choir') ? 1 : 0);
  }
  setChapter(c) { this.chapter = c; this.positionNPCs(); this.refreshBarks(); G.game.save(true); }

  update(dt) {
    if (this.dead) return;
    // checkpoint: save once the player is back in free play after any story progress
    if (this.dirty && G.mode === 'free' && !G.player.dead && !G.bossActive && G.player.grounded && !G.enemies.inCombat()) { this.dirty = false; G.game.save(true); }
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i];
      let r = false;
      try { r = w.cond(); } catch (e) { console.warn(e); }
      if (r) { this.waiters.splice(i, 1); w.res(r); }
    }
    const P = G.player;
    // region titles
    this.regionT -= dt;
    const reg = regionAt(P.pos.x, P.pos.z);
    if (reg.id !== this.lastRegion && G.mode === 'free') {
      if (this.regionT <= 0 && this.lastRegion !== null) { G.hud.areaTitle(reg.name, reg.en); this.regionT = 12; this.regionComment(reg.id); }
      this.lastRegion = reg.id;
    }
    // hush atmosphere
    const riftD = Math.hypot(P.pos.x - POI.rift.x, P.pos.z - POI.rift.z);
    const local = clamp(1 - (riftD - 40) / 60, 0, 1) * (this.chapter === 'post' ? 0.2 : 0.6);
    G.world.sky.hush = lerp(G.world.sky.hush, Math.min(1, this.hushBase + local), dt * 0.5);
    // colour blooms back over a few seconds after a bell
    const bells = this.bellsRung(), gu = G.renderer.grade.uniforms;
    gu.uSat.value = lerp(gu.uSat.value, satFor(bells), Math.min(1, dt * 0.35));
    G.music.memory = bells;
    if (G.sketches) G.sketches.update(dt);
    // seeds
    for (const s of G.world.seeds) {
      if (s.taken) continue;
      if (this.seeds.has(s.i)) { s.taken = true; s.g.visible = false; continue; }
      if (s.locked) continue; // still asleep: see world/puzzles.js
      if (Math.hypot(P.pos.x - s.x, P.pos.z - s.z) < (s.pickR || 1.4) && Math.abs(P.pos.y - s.y) < 2.5) this.takeSeed(s);
    }
    // memories
    for (const m of Object.values(G.world.memoryObjs)) {
      if (m.taken) continue;
      if (this.memories[m.id]) { m.taken = true; m.g.visible = false; continue; }
      if (m.g.visible && m.g.position.distanceTo(P.center()) < 1.6) this.takeMemory(m);
    }
    // cat
    if (this.cat && !this.flag('catSaved') && !this.flag('catCarried')) {
      this.cat.update(dt);
      this.catMeowT -= dt;
      if (this.catMeowT <= 0) { this.catMeowT = randRange(4, 7); if (this.near(POI.island.x, POI.island.z, 45)) G.audio.play('cat', { pos: this.cat.root.position }); }
    } else if (this.cat && this.flag('catSaved')) this.cat.update(dt);
    // carried cat delivery
    if (this.flag('catCarried') && !this.flag('catSaved') && this.near(this.npc('dodam').pos.x, this.npc('dodam').pos.z, 3) && G.mode === 'free' && !this.catBusy) { this.catBusy = true; this.deliverCat(); }
    // glide hint
    if (!P.grounded && P.vel.y < -6 && this.flag('glide') && this.once('hint_glide')) this.hint(`공중에서 ${KBD('Space')} 누르고 있기: 활공 — 기력을 쓴다`, 5);
  }

  // ------------------------------------------------------------ prologue
  async prologue() {
    const mora = this.npc('mora');
    const W = G.world;
    if (!this.flag('p_intro')) {
      G.world.sky.setHour(7.1);
      G.player.teleport(POI.spawn.x - 5, POI.spawn.z - 2, 2.2);
      await this.sleep(0.6);
      await this.fade(false, 1.6);
      await this.conv(async () => {
        await this.say('mora', '…세하야, 해가 등성이를 다 넘었다. 얼른 일어나렴.', { expr: 'tender' });
        await this.say('mora', '…아이고, 이 할미 정신 좀 봐라. {n:아}, 요샌 왜 자꾸 네 어미 이름이 먼저 튀어나오는지 모르겠구나.', { expr: 'worried', gesture: 'sigh' });
        const c = await this.choose(['괜찮아요, 할머니.', '…엄마 얘기 해 주세요.']);
        if (c === 0) await this.say('mora', '그래, 그래. 넌 늘 괜찮다지. 그 말버릇까지 제 어미를 빼닮았어.', { expr: 'smile' });
        else { this.set('askedMother'); await this.say('mora', '후후, 아침 댓바람부터 옛날얘기를 조르니? …나중에. 오늘 일 다 마치면 들려주마. 약속이다.', { expr: 'smile', gesture: 'laugh' }); }
        await this.say('mora', '자, 오늘이 무슨 날인지는 안 잊었겠지. *첫 울림*을 시험하는 날이란다.', { expr: 'smile', gesture: 'nod' });
        await this.say('mora', '이 할미는 네 나이 때 불꽃으로 참새 떼를 몰고 다녔지. …흠흠. 그건 본받지 말고.', { expr: 'laugh' });
        await this.say('mora', '몸부터 풀자꾸나. 마당에 빛나는 자리 셋, 차례로 밟고 오너라.', { gesture: 'point' });
      });
      this.set('p_intro');
    }
    this.quest('q_morning', '종이 울리지 않는 아침', '첫 울림을 시험하는 날. 할머니는 요즘 자꾸 나를 엄마 이름으로 부른다.');
    if (!this.flag('p_run')) {
      const mk = W.runMarkers;
      let n = 0;
      this.hint(`${KBD('W')}${KBD('A')}${KBD('S')}${KBD('D')} 이동 · ${KBD('Shift')} 누르고 있기: 달리기 · ${KBD('Space')} 점프<br><small>화면을 클릭하면 마우스로 시점을 돌린다</small>`, 12);
      for (const m of mk) m.mesh.material.opacity = 0.7;
      while (n < 3) {
        const next = mk.find((m) => !m.done);
        this.obj('q_morning', `빛나는 자리 밟기 (${n}/3)`, mk.filter((m) => !m.done).map((m) => ({ x: m.x, z: m.z, h: 1.5 })));
        await this.wait(() => mk.some((m) => !m.done && this.near(m.x, m.z, 1.5)));
        const m = mk.find((m) => !m.done && this.near(m.x, m.z, 1.5));
        m.done = true; n++;
        G.audio.play('seed', { m: THEME_NOTES[n - 1] });
        G.vfx.burst(m.mesh.position, 'soul', 16, { el: 'gold' }); G.vfx.ring(m.mesh.position, PAL.gold.core, 2, 0.5);
        m.mesh.material.opacity = 0;
        void next;
      }
      this.set('p_run');
    }
    if (!this.flag('p_bolt')) {
      this.obj('q_morning', '할머니에게 돌아가기', [{ x: mora.pos.x, z: mora.pos.z, h: 2.5 }]);
      await this.wait(() => this.near(mora.pos.x, mora.pos.z, 4.5));
      await this.conv(async () => {
        await this.say('mora', '후후, 발이 가볍구나. 넘어지지도 않고. 좋아, 좋아.', { expr: 'smile' });
        await this.say('mora', '이제 지팡이를 들어 보렴. 가만히 숨을 고르면, 네 안에서 울리는 소리가 들릴 게다.', { gesture: 'handToChest' });
        await this.say('mora', '그 소리로 저기 *떠 있는 수정*들을 맞혀 보렴. 세 개 다 말이다.', { gesture: 'point' });
      });
      this.hint(`${KBD('마우스')} 조준 · ${KBD('좌클릭')} 비전 화살 — 누르고 있다가 떼면 모아 쏜다`, 10);
      let n = 0;
      for (const t of W.training.targets) {
        t.onHit = () => {
          if (!t.alive) return;
          t.alive = false; n++;
          G.vfx.burst(t.pos, 'arcane', 30, { speed: 6 }); G.vfx.burst(t.pos, 'ice', 12);
          G.audio.play('shatter', { pos: t.pos });
          G.scene.remove(t.obj);
          t.pos.set(0, -999, 0);
          this.obj('q_morning', `떠 있는 수정 맞히기 (${n}/3)`, W.training.targets.filter((x) => x.alive).map((x) => ({ x: x.pos.x, z: x.pos.z, h: 3 })));
        };
      }
      this.obj('q_morning', '떠 있는 수정 맞히기 (0/3)', W.training.targets.map((x) => ({ x: x.pos.x, z: x.pos.z, h: 3 })));
      await this.wait(() => n >= 3);
      this.set('p_bolt');
    } else for (const t of W.training.targets) { G.scene.remove(t.obj); t.pos.set(0, -999, 0); t.alive = false; }
    if (!this.flag('p_fire')) {
      await this.sleep(0.6);
      await this.conv(async () => {
        await this.say('mora', '그래, 그 소리란다. 맑기도 하지. …음이 살짝 엇나가는 건 집안 내림이니 어쩌겠니.', { expr: 'tender', gesture: 'handToChest' });
        await this.say('mora', '이번엔 [불의 노래|fire]다. 불은 성질이 급해서, 네가 망설이면 저 혼자 먼저 뛰쳐나간단다.', { expr: 'smile' });
        await this.say('mora', '그러니 망설이지 말고. 그렇다고 서두르지도 말고. …밥 뜸 들이는 거랑 매한가지야.');
      });
      await this.unlockElement('fire', '타오르는 노래. 닿은 것을 태우고, 꺼진 불씨를 다시 밝힌다.');
      this.hint(`${KBD('2')} 또는 ${KBD('휠')} 속성 전환 · 화염으로 화로에 불을 붙이자`, 10);
      let n = W.training.braziers.filter((b) => b.lit).length;
      const upd = () => this.obj('q_morning', `화로 세 개에 불 붙이기 (${n}/3)`, W.training.braziers.filter((b) => !b.lit).map((b) => ({ x: b.pos.x, z: b.pos.z, h: 2.5 })));
      for (const b of W.training.braziers) { b.permanent = true; b.onLit = () => { n = W.training.braziers.filter((x) => x.lit).length; upd(); }; }
      upd();
      await this.wait(() => W.training.braziers.every((b) => b.lit));
      this.set('p_fire');
    } else for (const b of W.training.braziers) b.baseHit('fire');
    if (!this.flag('p_heavy')) {
      await this.sleep(0.8);
      await this.conv(async () => {
        await this.say('mora', '따뜻하구나. …이 탑이 이렇게 환한 게 얼마 만인지.', { expr: 'tender' });
        await this.say('mora', '마지막이다. 불의 노래엔 흥얼거리는 법이 있고, *목청껏* 부르는 법이 있단다.', { expr: 'smile' });
        await this.say('mora', '불을 크게 뭉쳐서 저 허수아비 영감들한테 날려 보렴! 이 할미가 네 나이 때 처음 익힌 재주란다.', { gesture: 'point' });
      });
      if (!G.skills.has('f_sig')) {
        G.skills.grant('f_sig', { quiet: true, sound: 'skill_unlock_active' });
        G.hud.banner('새로운 기술', HEAVY.fire.name, `화염을 고르고 ${KBD('우클릭')} — 거대한 불덩이를 던져 넓게 불태운다<br><small>마나 ${HEAVY.fire.cost} · 재사용 ${HEAVY.fire.cd}초 · 다른 속성의 고유 마법은 울림 나무에서 하나씩 익힌다</small>`, EL_INFO.fire.css, 4600);
      }
      this.hint(`${KBD('우클릭')} 고유 마법 — <b style="color:${EL_INFO.fire.css}">${HEAVY.fire.name}</b> · 마나 ${HEAVY.fire.cost} 소모<br><small>마나는 싸우는 동안 천천히 차오른다 — 아껴 쓰자</small>`, 10);
      this.obj('q_morning', '허수아비에게 화염구 날리기', W.training.dummies.map((d) => ({ x: d.pos.x, z: d.pos.z, h: 3 })));
      let ok = false;
      for (const d of W.training.dummies) d.onHit = (el) => { if (el === 'fire' && G.time - (this.heavyFireT || -9) < 3.5) ok = true; };
      await this.wait(() => ok);
      this.set('p_heavy');
      await this.sleep(1.2);
    }
    if (!this.flag('p_fight')) {
      await this.conv(async () => {
        await this.say('mora', '아이고, 허수아비 영감 수염 다 태웠구나! 호호, 잘했다. 아주 잘했어.', { expr: 'laugh', gesture: 'laugh' });
        await this.say('mora', '……', { expr: 'neutral', gesture: 'lookAround' });
        await this.say('mora', '…이상하구나.', { expr: 'worried' });
        // from the hill, out over the vale toward the bell tower that should have rung by now
        G.cameraRig.setCine(GV(-2, 6, 138), GV(POI.bellTower.x, 14, POI.bellTower.z));
        await this.say('mora', '해가 저만큼 올랐는데, 종이 안 울어. 오십 년을 하루도 거른 적 없는 종이.', { cam: false });
        this.hushBase = 0.35;
        G.audio.play('dissolve', { pos: G.player.pos });
        await this.say('mora', '{n:아}, 이 할미 뒤로 물러서— …아니, 아니다.', { expr: 'surprised', cam: true });
        await this.say('mora', '네가 맞서 보렴. 할미가 뒤를 봐주마. 저건 *허깨비*란다. 제 노래를 잃어버리고 떠도는 것들이지.', { expr: 'determined', gesture: 'nod' });
        await this.say('mora', '불을 무서워하니 겁낼 것 없다. …미워할 것도 없고. 저것들도 한때는 이 골짜기에 살던 누군가였으니.', { expr: 'sad' });
      });
      this.hint(`${KBD('Shift')} 짧게 누르기: 순간이동 — 잠깐 무적 · ${KBD('T')} 대상 고정`, 10);
      this.obj('q_morning', '허깨비 물리치기');
      const lv = 1;
      const wave = (defs) => defs.map(([t, x, z]) => { const e = G.enemies.spawnEncounter(t, V(x, 0, z), lv); G.vfx.burst(e.center(), 'hush', 10, { size: 1 }); return e; });
      // They come up the hill road. The yard is a mesa: anything set down on its flanks stands
      // under a cliff, further from the road than enemy navigation searches.
      const yard = V(8, 0, 126);
      await this.scriptedWave(() => wave([['ashling', -5, 114], ['ashling', -3, 110], ['ashling', -7, 118]]), yard, 45);
      await this.sleep(1.2);
      G.hud.bark(mora, '또 온다! 이번엔 다른 놈들도 섞여 있구나!');
      G.later(() => this.hint('<b>울음탈</b>은 멀리서 구체를 쏜다 — 마법으로 구체를 맞혀 없앨 수 있다<br><b>잿물</b>은 쓰러뜨리면 둘로 갈라진다', 8), 1500);
      await this.scriptedWave(() => wave([['ooze', -4, 120], ['ashling', -6, 113], ['wailer', -3, 108]]), yard, 45);
      this.set('p_fight');
      await this.sleep(1.5);
    }
    if (!this.flag('p_end')) {
      mora.pose.kneel = true;
      await this.conv(async () => {
        await this.say('mora', '…후우. 괜찮다, 괜찮아. 좀 어지러울 뿐이야.', { expr: 'hurt', gesture: 'sigh' });
        await this.say('mora', '잘 들으렴. 이 골짜기엔 종이 셋 있단다. 종이 우는 동안은 *고요*가 내려오지 못해.');
        await this.say('mora', '첫째는 마을에 있고, 둘째는… 둘째는…', { expr: 'worried' });
        await this.say('mora', '……');
        await this.say('mora', '이상하지. 종을 깨우던 노래도… 수백 번을 불렀는데 다음 구절이 입에서만 맴도는구나.', { expr: 'sad' });
        const c = await this.choose(['할머니, 쉬셔야 해요.', '제가 마을에 가 볼게요.']);
        mora.pose.kneel = false;
        if (c === 0) await this.say('mora', '그래, 쉬마. 대신 네가 이 늙은 다리 노릇 좀 해 주겠니?', { expr: 'smile' });
        else await this.say('mora', '…그래. 그 말을 기다렸는지도 모르겠구나.', { expr: 'tender' });
        await this.say('mora', '마을에 내려가 *바우 영감*을 찾거라. 사십 년 묵은 고집쟁이지만, 종 일이라면 그이만 한 사람이 없단다.');
        await this.say('mora', '가는 길에 *등석*이 보이거든 불을 밝혀 두렴. 불 켜진 등석은 길 잃은 사람을 집에 데려다준단다.');
        await this.say('mora', '…다녀오너라, {n:아}.', { expr: 'tender', gesture: 'wave' });
      });
      this.set('p_end');
    }
    this.done('q_morning');
    this.set('prologueDone');
    this.quest('q_bell', '침묵한 종', '오십 년을 거른 적 없다는 아침 종이 울리지 않았다. 할머니는 노래의 다음 구절을 잊었다. 마을의 종지기 바우 영감을 찾아가자.');
    this.obj('q_bell', '하늬 마을로 내려가 바우 영감 찾기', [{ x: POI.bellTower.x, z: POI.bellTower.z, h: 16 }]);
    this.hint(`${KBD('Tab')} 여정 · 마법서 — 원소 반응과 조작을 다시 볼 수 있다 · ${KBD('M')} 지도`, 8);
    this.chapter = 'village'; this.refreshBarks();
    G.game.save(true);
  }

  // ------------------------------------------------------------ chapter 1: village
  async village() {
    const W = G.world;
    const dodam = this.npc('dodam');
    if (!this.flag('v_arrive')) {
      this.obj('q_bell', '하늬 마을로 내려가 바우 영감 찾기', [{ x: POI.bellTower.x, z: POI.bellTower.z, h: 16 }]);
      await this.wait(() => (this.near(POI.village.x, POI.village.z, 50) && G.mode === 'free') || this.flag('v_bau'));
      // Dodam spots the player and runs up to them, re-aiming at wherever they are now;
      // once close, the player stops so the two actually meet face to face
      if (!this.flag('v_bau')) G.hud.bark(dodam, '어? 어어! 마법사님이다!');
      let met = false;
      await this.wait(() => {
        if (this.flag('v_bau') || this.flag('v_arrive')) return true; // went to Bau first
        const P = G.player.pos;
        const dx = dodam.pos.x - P.x, dz = dodam.pos.z - P.z, d = Math.hypot(dx, dz);
        if (d < 10) G.player.frozenInput = true;
        if (d < 2.2) { met = true; return true; }
        const k = 1.7 / Math.max(d, 1e-3);
        dodam.walkTarget = null; dodam.walkRes = null;
        dodam.walkTo(P.x + dx * k, P.z + dz * k, 6.5);
        return false;
      });
      dodam.walkTarget = null; dodam.walkRes = null;
      G.player.frozenInput = false;
      if (met && !this.flag('v_arrive')) await this.conv(async () => {
        await this.say('dodam', '우와아! 진짜 마법사님이다! 언덕 위 탑에서 내려온 거 맞죠? 맞죠?', { expr: 'laugh', gesture: 'wave' });
        await this.say('dodam', '오늘 아침에 종이 안 울렸어요! 아빠가 그러는데 백 년 만에 처음이래요!', { expr: 'surprised' });
        await this.say('dodam', '아, 아빠가 백 살이라는 건 아니고요. 할아버지의 할아버지 때부터… 아무튼 엄청 오래전부터요!', { gesture: 'shake' });
        const c = await this.choose(['바우 영감님은 어디 계셔?', '종이 왜 안 울린 거야?']);
        if (c === 1) await this.say('dodam', '몰라요! 그래서 좀 무서… 아니, 안 무서워요! 저 하나도 안 무서워요. 진짜진짜로요.', { expr: 'worried', gesture: 'shake' });
        await this.say('dodam', '바우 할아버지는 종탑 앞에서 종 줄만 붙잡고 계세요. 한숨을 푹, 푹 쉬면서요. 저기 제일 높은 탑이요!', { gesture: 'point' });
      });
      dodam.walkTo(0, 24, 3.5);
      this.set('v_arrive');
    }
    if (!this.flag('v_bau')) {
      this.obj('q_bell', '종탑 앞의 바우 영감과 이야기하기', [{ x: 9, z: 16.5, h: 2.6 }]);
      await this.wait(() => this.flag('v_bau'));
    }
    if (!this.flag('v_isol')) {
      this.obj('q_bell', '여관 앞의 학자 이솔 만나기', [{ x: 18, z: 26.5, h: 2.6 }]);
      await this.wait(() => this.flag('v_isol'));
    }
    if (!this.flag('v_altar')) {
      this.obj('q_bell', '종탑 아래 제단 살펴보기', [{ x: 6, z: 13.3, h: 2 }]);
      await this.wait(() => this.flag('v_altar'));
    }
    if (!this.flag('v_defend')) {
      await this.defendVillage();
      this.set('v_defend');
    }
    if (!this.flag('v_wind')) {
      await this.windAndBell();
    }
    this.setChapter('bells');
  }

  async altarScene() {
    const W = G.world;
    const C = G.companion;
    await this.conv(async () => {
      G.cameraRig.setCine(GV(12, 3, 24), GV(6, 3.5, 12));
      await this.say('narr', '손을 대자, 차가운 돌 속에서 가느다란 바람 소리가 샌다…', { cam: false });
      G.audio.play('updraft', { pos: GV(6, 7, 10) });
      C.show(true);
      C.override = GV(6, 7.5, 12.8);
      C.place(GV(6, 11, 11));
      G.vfx.burst(GV(6, 7.5, 12.8), 'wind', 40, { radius: 1.5, speed: 6 });
      G.vfx.burst(GV(6, 7.5, 12.8), 'star', 1, { el: 'wind', size: 5 });
      await this.sleep(0.9);
      C.override = GV(6, 2.6, 14.4);
      await this.sleep(1.2);
      G.audio.play('fox');
      await this.say('boreum', '누가 감히 이 몸의 낮잠을— …흠?');
      await this.say('boreum', '킁킁. 모라 냄새로구나. 그 늙은 여우 할멈, 아직 숨은 붙어 있느냐?');
      const c = await this.choose(['…여우가 말을 해?', '우리 할머니를 알아?']);
      if (c === 0) await this.say('boreum', '여우라니! 이 몸은 하늬바람의 정령, *보름*이니라! …뭐, 생김새가 그리 보이는 것까진 봐주마.');
      else await this.say('boreum', '알다마다. 오십 년 전 이 몸을 이 종에 묶어 둔 게 그 할멈이니라. 좋은 뜻으로. …그래서 더 괘씸하지.');
      await this.say('boreum', '오십 년을 새벽마다 그 할멈 노래에 잠을 깼느니라. 시끄러워서 원.');
      await this.say('boreum', '…헌데 오늘은, 아무도 이 몸을 깨우지 않더구나.');
      await this.say('boreum', '종은 쇠가 우는 게 아니다, 꼬마. *기억하는 이*가 불러야 대답하는 게지. 할멈이… 노래를 잊어 가고 있는 게야.');
      const c2 = await this.choose(['할머니를 도울 방법이 있어?', '…그럴 리 없어.']);
      if (c2 === 1) await this.say('boreum', '이 몸도 그리 믿고 싶었다. 그래서 여태 자는 척을 한 게고.');
      await this.say('boreum', '해가 기울면 놈들이 온다. 종소리가 끊긴 마을은 고요에겐 빈집이나 다름없으니.');
      await this.say('boreum', '오늘 저녁, 이 마을을 지켜 보거라. 해내면— 이 몸의 노래를 빌려주마.');
    });
    C.override = null;
    this.set('v_altar');
  }

  async defendVillage() {
    this.obj('q_bell', '해 질 녘, 마을을 지키기');
    await this.fade(true, 1);
    G.world.sky.setHour(18.4);
    for (const id of ['dodam', 'isol', 'danbi', 'farmer', 'elder']) this.npc(id).show(false);
    this.npc('bau').setPos(8, 15.5, 0);
    G.player.teleport(6, 22, Math.PI);
    await this.sleep(0.4);
    await this.fade(false, 1.2);
    this.cSay('온다. 셋… 아니, 기척이 훨씬 많구나. 한 놈도 마을 안에 들이지 마라!');
    G.hud.bark(this.npc('bau'), '이놈들! 종은 못 쳐도 창은 쓸 줄 알어!');
    const lv = G.enemies.levelFor(0);
    const spawnAt = (t, x, z) => { const e = G.enemies.spawnEncounter(t, V(x + randRange(-2, 2), 0, z + randRange(-2, 2)), lv); G.vfx.burst(e.center(), 'hush', 10, { size: 1 }); return e; };
    const waves = [
      { say: '북쪽 길이다!', units: [['ashling', 0, -26], ['ashling', 4, -28], ['ashling', -4, -24], ['moth', 0, -30], ['moth', 2, -30]] },
      { say: '서쪽! 호수 쪽에서도 기어 온다!', units: [['ashling', -44, 16], ['ooze', -46, 20], ['ashling', -44, 22], ['wailer', -48, 12]] },
      { say: '동쪽이다, 꼬마! 이게 마지막 떼다!', units: [['ashling', 44, 12], ['ashling', 46, 16], ['wailer', 48, 8], ['wailer', 44, 22], ['oozeFire', 42, 18]] },
    ];
    let i = 0;
    for (const w of waves) {
      i++;
      this.obj('q_bell', `해 질 녘, 마을을 지키기 (${i}/3)`);
      this.cSay(w.say);
      if (i === 1 && this.once('dodge_tut')) G.later(() => {
        this.cSay('꼬마, 하나 일러 주마. 놈이 덮치는 순간에 맞춰 피해 보거라. 세상이 잠깐 느려질 게다. 이 몸의 바람이 네 편이니.', null, 7);
        this.hint(`적의 공격이 닿기 직전 ${KBD('Shift')} 짧게: 순간이동 — 딱 맞추면 <b>완벽 회피</b><br><small>잠시 적이 느려지고, 기본 마법에 마나가 들지 않는다</small>`, 10);
      }, 2500);
      if (i === 3) this.hint('<b>불잿물</b>은 쓰러질 때 폭발한다 — 적들 한가운데서 터뜨리자', 7);
      await this.scriptedWave(() => w.units.map(([t, x, z]) => spawnAt(t, x, z)), V(4, 0, 16), 80);
      await this.sleep(1.5);
    }
  }

  async windAndBell() {
    const C = G.companion;
    await this.conv(async () => {
      await this.say('boreum', '…흥. 제법이구나. 그 할멈, 사람 보는 눈 하나는 안 늙었어.');
      await this.say('boreum', '약속은 약속이다. 이 몸의 노래를 빌려주마. *하늬바람*이니라. 흐르는 건 아무도 못 막지.');
    });
    await this.unlockElement('wind', '흐르는 노래. 적을 띄우고 밀어내며, 불과 한기를 멀리 실어 나른다.');
    // Borum lends the wind itself too: gliding starts here, at the end of the first act
    await this.conv(async () => {
      await this.say('boreum', '덤도 있다. 바람은 부리기만 해선 반쪽이야. *올라탈 줄*도 알아야지.');
      await this.say('boreum', '높은 데서 뛰어내려 보거라. 이 몸이 받쳐 주마. 불길 위로 솟는 더운 바람을 타면 더 높이 날 수 있을 게다.');
    });
    this.set('glide');
    G.hud.banner('바람 타기', '하늬바람의 선물', `공중에서 ${KBD('Space')} 누르고 있기: <b>활공</b> — 기력을 쓴다`, '#9ff0d0', 5000);
    const weaveName = NODES[WEAVE_NODE].name, whirl = weaveInfo('fire', 'wind').name;
    if (G.skills.has(WEAVE_NODE)) this.hint(`${KBD('3')} 바람 · ${KBD('Q')} <b>엮기</b> — 직전에 쓰던 속성과 지금 속성을 엮어 강력한 마법을 쓴다<br><small>예: 화염 → 바람으로 바꾼 뒤 Q = ${whirl} · 고유 마법 <b>${HEAVY.wind.name}</b>${josa(HEAVY.wind.name, '은').slice(HEAVY.wind.name.length)} 울림 나무에서 익힌다</small>`, 12);
    else this.hint(`${KBD('3')} 바람 · 고유 마법 <b>${HEAVY.wind.name}</b>${josa(HEAVY.wind.name, '와').slice(HEAVY.wind.name.length)} <b>엮기</b>는 울림 나무(${KBD('K')})나 울림의 갈림길에서 익힌다<br><small>조화의 뿌리 「${weaveName}」를 익히면 ${KBD('Q')}로 두 속성을 엮는다 — 예: 화염 → 바람 = ${whirl}</small>`, 12);
    await this.sleep(1);
    await this.conv(async () => {
      await this.say('boreum', '자, 종을 깨우자꾸나. 네 울림에 이 몸의 바람을 실어서.');
      await this.ringVillageBell();
      for (const id of ['dodam', 'isol', 'danbi', 'farmer', 'elder']) this.npc(id).show(true);
      this.npc('dodam').setPos(3, 20, Math.PI);
      this.npc('isol').setPos(10, 21, Math.PI * 0.8);
      // the village from above the south road, for the line about its colour coming back
      G.cameraRig.setCine(GV(20, 15, 62), GV(4, 9, 8));
      await this.say('boreum', '보거라, 꼬마. 골짜기에 다시 숨이 도는구나. 날이 밝으면 알 게다. 종이 울릴 때마다 바랬던 빛깔도 조금씩 돌아온다는 걸.', { cam: false });
      await this.say('bau', '…울었어, 종이 울었다니께! 허허, 사십 년 들은 소린디… 오늘은 왜 이리 눈시울이 시큰거리는겨.', { expr: 'laugh', gesture: 'handToChest' });
      await this.say('dodam', '들었어요? 들었어요?! 종이 울었어요! 마법사님이 울렸어요!', { expr: 'laugh', gesture: 'wave' });
      await this.say('isol', '보셨습니까? 방금 골짜기 전체의 *울림 밀도*가— …죄송합니다. 흥분하면 용어가 튀어나와서.', { expr: 'surprised' });
      await this.say('isol', '남은 종은 둘입니다. 북쪽 *서리봉 성소*, 서쪽 *천둥 고원*. 지도에 표시해 뒀습니다.', { gesture: 'point' });
      await this.say('boreum', '둘 다 고요의 장막에 가로막혀 있을 게다. 장막부터 걷어 내야 종에 손이 닿느니라.');
      await this.say('isol', '그리고 사적인 부탁이 하나 있습니다. 골짜기에 *이름이 붙은* 강한 개체들이 있답니다. 쓰러뜨리시면 제게도 알려 주십시오. 연구에… 네, 절실합니다.', { expr: 'worried', gesture: 'bow' });
      await this.say('boreum', '순서는 네 마음이다. 다만 꾸물대진 말거라. …할멈의 기억이, 우리를 마냥 기다려 주진 않을 테니.');
    });
    this.npc('dodam').setPos(0, 24, 0.5); this.npc('isol').setPos(18, 26.5, -0.6); this.npc('bau').setPos(9, 16.5, 0.2);
    this.done('q_bell', '하늬바람의 노래를 얻었다.');
    this.set('v_wind'); this.set('worldOpen'); this.set('bountyActive');
    this.quest('q_bounty', '이름 붙은 것들', '이름이 붙었다는 건, 누군가 아직 기억한다는 뜻. 이솔은 그런 개체 셋을 궁금해한다. 뿌리 삼킨 돌무덤(속삭이는 숲), 세 자매 울음탈(동쪽 벼랑), 눈먼 파수꾼(북쪽 설원).', 'side');
    this.updateBounty();
    this.track = null;
  }

  async ringVillageBell() {
    const W = G.world;
    const bp = V(6, W.h(6, 10) + 13, 10);
    G.cameraRig.setCine(GV(18, 3.5, 30), bp);
    await this.sleep(0.8);
    for (let k = 0; k < 3; k++) {
      W.bellSwing = 0.35;
      G.audio.play('bell', { pos: bp, f: 146.8 });
      G.vfx.ring(V(6, W.h(6, 10), 10), PAL.gold.core, 70, 3.5, { thick: 0.04 });
      G.vfx.burst(bp, 'soul', 30, { el: 'gold' });
      G.vfx.flash(bp, 0xffe0a0, 80, 40, 1);
      G.cameraRig.shake(0.1);
      this.hushBase = Math.max(0, this.hushBase - 0.06);
      await this.sleep(1.8);
    }
    this.hushBase = 0.18;
    G.world.sky.hush = 0.18;
  }

  // ------------------------------------------------------------ chapter 2: bells
  updateBells() {
    const f = this.flag('frostBell'), s = this.flag('stormBell');
    const mk = [];
    if (!f) mk.push({ x: POI.frost.x, z: POI.frost.z, h: 8 });
    if (!s) mk.push({ x: POI.storm.x, z: POI.storm.z, h: 8 });
    this.obj('q_bells', `${f ? '✓' : '·'} 서리봉 성소의 종 울리기<br>${s ? '✓' : '·'} 천둥 고원의 종 울리기`, mk);
  }
  async bells() {
    this.quest('q_bells', '두 개의 종', '남은 종은 둘. 북쪽 서리봉 성소와 서쪽 천둥 고원. 성소를 덮은 고요의 장막부터 걷어야 종에 손이 닿는다. 어느 쪽부터 갈지는 내 마음이다.');
    this.updateBells();
    await Promise.all([this.frostShrine(), this.stormShrine()]);
    if (this.dead) return;
    this.done('q_bells');
    await this.sleep(2);
    this.cSay('두 종이 다 울렸구나. …할멈에게 돌아가자. 노래의 다음 구절을 아는 건 그 할멈뿐이니.', null, 6);
    this.quest('q_song', '모라의 노래', '두 종이 울렸다. 셋째 종이 어디 있는지는 할머니만 안다. 할머니가 아직 기억하고 있다면.');
    this.obj('q_song', '할머니의 탑으로 돌아가기', [{ x: -20, z: 132, h: 2.4 }]);
    this.setChapter('mora');
  }

  async openSeal(S) {
    G.world.col.remove(S.sealCol);
    const seal = S.group.userData.seal;
    G.audio.play('stone', { pos: S.pos, d: 2 });
    G.audio.play('magic_circle', { pos: S.pos });
    G.vfx.burst(S.pos.clone().setY(S.pos.y + 4), 'hush', 30, { spread: 6, size: 2 });
    G.vfx.timer(2, (dt, k) => { seal.material.uniforms.uAlpha.value = 1 - k; seal.scale.setScalar(1 + k * 0.1); }, () => { S.group.remove(seal); });
    S.sealed = false;
    S.group.userData.floor.material.color.multiplyScalar(2.2);
  }

  async frostShrine() {
    const S = G.world.shrines.frost;
    if (this.flag('frostBell')) { if (S.sealed) this.openSealInstant(S); return; }
    if (!this.flag('f_open')) {
      await this.wait(() => this.near(S.pos.x, S.pos.z, 42));
      this.cSay('에취! …크흠, 눈가루가 코에 들어간 게다. 저기 성소를 감싼 장막 보이느냐? 둘레의 화로 셋에 불을 붙이면 걷힐 게다.', 'frost_arrive', 8);
      if (!this.flag('f_guard')) {
        this.set('f_guard');
        const lv = G.enemies.levelFor(1);
        for (const [t, a] of [['ashlingFrost', 0.5], ['ashlingFrost', 2.6], ['oozeFrost', 4.4]]) G.enemies.spawnEncounter(t, V(S.pos.x + Math.cos(a) * 16, 0, S.pos.z + Math.sin(a) * 16), lv);
      }
      for (const b of S.braziers) b.onLit = () => {
        const n = S.braziers.filter((x) => x.lit).length;
        G.hud.toast(`성소의 화로 ${n} / 3`);
      };
      await this.wait(() => S.braziers.every((b) => b.lit));
      S.braziers.forEach((b) => (b.permanent = true));
      await this.sleep(0.5);
      await this.openSeal(S);
      this.set('f_open');
      this.cSay('장막이 걷혔다. …안이 너무 조용하구나. 들어가 보자.', null, 4);
    } else this.openSealInstant(S);
    if (!this.flag('f_echo')) {
      await this.wait(() => this.near(S.pos.x, S.pos.z, 6.5) && G.mode === 'free');
      await this.echoFrost(S);
      this.set('f_echo');
    }
    if (!this.flag('f_boss')) {
      await this.bossFight(() => {
        const lv = G.enemies.levelFor(1) + 1;
        const b = G.enemies.spawnEncounter('bruteFrost', V(S.pos.x, 0, S.pos.z + 2.2), lv, { elite: true, name: '서리무덤 파수꾼', warden: true, leash: 999, hpMul: 5.5, brk: true });
        b.aggro();
        G.vfx.burst(b.center(), 'frostmist', 30, { size: 2 }); G.vfx.burst(b.center(), 'hush', 20, { size: 1.5 });
        G.audio.play('boss_roar', { pos: b.pos });
        G.hud.bossBar(b, '서리무덤 파수꾼 — 무엇을 지키는지 잊은 것');
        const adds = [G.enemies.spawnEncounter('ashlingFrost', V(S.pos.x + 5, 0, S.pos.z - 2), lv - 1), G.enemies.spawnEncounter('ashlingFrost', V(S.pos.x - 5, 0, S.pos.z - 2), lv - 1)];
        adds.forEach((e) => { e.scripted = true; e.aggro(); });
        this.cSay('서리무덤이다! 저 얼음 갑옷에 서리는 안 먹힌다. 불을 붙여라— 타는 동안엔 갑옷이 녹느니라!', null, 6);
        return b;
      }, S.pos, 30, '숨은 돌렸느냐. 저놈 갑옷은 불이 붙어 있는 동안에만 무른다. 불부터 붙이고 몰아치거라.');
      this.set('f_boss');
      G.skills.gain(2, '서리무덤 파수꾼을 잠재웠다');
    }
    if (!this.flag('f_learn')) {
      await this.sleep(1);
      await this.learnAtShrine(S, 'frost');
      this.set('f_learn');
    }
    if (!this.flag('frostBell')) {
      this.cSay('종이 기다린다. 가서 깨워 주거라.', 'frost_bellhint');
      await this.wait(() => this.flag('frostBell'));
    }
  }
  openSealInstant(S) {
    if (!S.sealed) return;
    G.world.col.remove(S.sealCol); S.group.remove(S.group.userData.seal); S.sealed = false;
    if (S.braziers) S.braziers.forEach((b) => { if (!b.lit) b.baseHit('fire'); b.permanent = true; });
    if (S.wheels) S.wheels.forEach((w) => w.baseHit('wind'));
  }

  async echoFrost(S) {
    const seha = makeGhost(makeHumanoid(CHAR.seha), 0xbfe8ff, 0.8);
    const ghost = G.npcs.add(new NPC('seha', 'seha', S.pos.x, S.pos.z - 1.6, 0, { rig: seha }));
    ghost.pose.kneel = true;
    G.audio.play('echo', { pos: S.pos });
    G.vfx.burst(ghost.headPos(), 'soul', 40, { el: 'frost' });
    G.game.musicOverride = 'memory';
    await this.conv(async () => {
      await this.say('narr', '성소 한가운데, 희미한 빛이 모여 사람의 모습을 이룬다. 오래전 이곳에 남기고 간 *메아리*다.');
      await this.say('seha', '엄마. 이 노래, 여기 두고 갈게.', { expr: 'tender' });
      await this.say('seha', '엄마는 새벽마다 노래하느라 늦잠 한 번 못 잤잖아. 그러니까 이번엔 내가 좀 나눠 들게.', { expr: 'smile' });
      await this.say('seha', '우리 {n}, 요즘 밤마다 울지? 이 노래 불러 줘. 내가 부르던 것처럼— 조금 틀리게.', { expr: 'laugh' });
      await this.say('seha', '금방 갔다 올게. 틈 너머에 카엘 아저씨가 아직 있으면… 손 잡고 끌고 올게.', { expr: 'determined' });
      ghost.pose.kneel = false;
      await this.sleep(0.6);
      G.vfx.burst(ghost.headPos(), 'soul', 40, { el: 'frost' });
      ghost.show(false);
      await this.say('boreum', '……');
      await this.say('boreum', '…세하. 그 꼬맹이였구나. 어릴 적에 이 몸의 꼬리를 잡아당기고 도망치던 녀석이.');
      const c = await this.choose(['…엄마.', '(말없이 서 있는다)']);
      if (c === 0) await this.say('boreum', '그래. 네 어미다. …네 목도리가 그 아이 것과 색이 똑같구나. 할멈이 같은 실로 떴겠지.');
      else await this.say('boreum', '…말 안 해도 된다. 이 몸도 가끔은 입을 다물 줄 아느니라. 아주 가끔.');
      await this.say('boreum', '…꼬마, 물러서라! 바닥이 흔들린다, 얼음 밑에서 뭔가 깨어난다!');
    });
    G.game.musicOverride = null;
    G.scene.remove(ghost.root);
    G.npcs.list.splice(G.npcs.list.indexOf(ghost), 1); delete G.npcs.map.seha;
  }

  async learnAtShrine(S, el) {
    const crystal = S.group.userData.crystal;
    const cp = crystal.getWorldPosition(new THREE.Vector3());
    G.game.musicOverride = 'memory';
    await this.conv(async () => {
      G.cameraRig.setCine(G.player.pos.clone().add(V(4, 3, 4)), cp);
      await this.sleep(0.5);
      G.vfx.timer(1.6, (dt, k) => { crystal.position.lerp(S.group.worldToLocal(G.player.center()), k * 0.08); crystal.scale.multiplyScalar(1 - k * 0.03); }, () => { crystal.visible = false; });
      await this.sleep(1.7);
      if (el === 'frost') await this.say('seha', '고요한 서리의 노래야. 손끝은 차갑지만, 소중한 걸 얼음 속에 감싸 지켜 주는 노래란다.', { cam: false, name: '세하의 메아리' });
      else await this.say('kael', '외치는 번개의 노래다. 나 여기 있다고, 잊지 말라고 끝내 터뜨리는 외침이지.', { cam: false, name: '카엘의 메아리' });
    });
    G.game.musicOverride = null;
    await this.unlockElement(el, el === 'frost' ? '고요한 노래. 한기로 적을 얼리고, 물 위에 얼음 발판을 놓는다.' : '외치는 노래. 눈 깜짝할 새 적을 꿰뚫으며, 젖거나 언 적에게 특히 매섭다.');
    const rn = (id) => REACTIONS[id].name;
    if (el === 'frost') this.hint(`서리로 <b>얼린</b> 적을 ${G.player.unlocked.has('storm') ? '번개나 ' : ''}강한 마법으로 치면 <b>${rn('shatter')}</b> · 불로 녹이면 <b>${rn('melt')}</b><br><small>서리 마법은 물 위에 얼음 발판을 만든다</small>`, 10);
    else this.hint(`<b>젖은</b> 적에게 번개 → <b>${rn('conduct')}</b> · <b>불타는</b> 적에게 번개 → <b>${rn('overload')}</b><br><small>${G.player.unlocked.has('frost') ? `불 + 서리 엮기(${weaveInfo('fire', 'frost').name})는 적을 모두 적신다` : '비를 맞은 적은 이미 젖어 있다'}</small>`, 10);
  }

  async ringShrineBell(el) {
    const S = G.world.shrines[el];
    const bp = S.group.userData.bell.getWorldPosition(new THREE.Vector3());
    await this.conv(async () => {
      G.cameraRig.setCine(bp.clone().add(V(6, 1, 9)), bp);
      await this.sleep(0.6);
      for (let k = 0; k < 2; k++) {
        S.bellSwing = 0.4;
        G.audio.play('bell', { pos: bp, f: el === 'frost' ? 196 : 220 });
        G.vfx.ring(S.pos, PAL[el].core, 60, 3, { thick: 0.05 });
        G.vfx.burst(bp, 'soul', 30, { el });
        G.vfx.flash(bp, PAL[el].light, 80, 30, 1);
        await this.sleep(2);
      }
      this.hushBase = Math.max(0.06, this.hushBase - 0.05);
      await this.say('boreum', el === 'frost' ? '…맑게도 울리는구나. 언덕 위 할멈 귀에도 닿았을 게다.' : '몇 번을 들어도, 종소리란 건 참… …흥. 방금 건 바람 소리니라.');
    });
    this.set(el + 'Bell');
    const mem = el === 'frost' ? 'musicbox' : 'badge';
    const m = G.world.memoryObjs[mem];
    // its sketchbook page can now be found (the item itself shows once the page is matched)
    if (m && !this.memories[mem] && this.flag('sketchbook')) G.hud.toast('스케치북의 흐릿하던 그림 한 장이 또렷해졌다…');
    this.updateBells();
    G.game.save(true);
  }

  async stormShrine() {
    const S = G.world.shrines.storm;
    if (this.flag('stormBell')) { if (S.sealed) this.openSealInstant(S); return; }
    if (!this.flag('s_open')) {
      await this.wait(() => this.near(S.pos.x, S.pos.z, 46));
      this.cSay('킁. 매캐한 번개 냄새… 이 고원은 예나 지금이나 성미가 사납지. 저 바람개비 셋, 이 몸의 바람으로 돌려 보거라.', 'storm_arrive', 8);
      for (const w of S.wheels) w.onActive = () => { const n = S.wheels.filter((x) => x.active).length; G.hud.toast(`바람개비 ${n} / 3`); };
      await this.wait(() => S.wheels.every((w) => w.active));
      await this.sleep(0.5);
      await this.openSeal(S);
      this.set('s_open');
      this.cSay('장막이 걷혔다. …털이 선다. 안에 누가 서 있구나.', null, 4);
    } else this.openSealInstant(S);
    if (!this.flag('s_boss')) {
      await this.wait(() => this.near(S.pos.x, S.pos.z, 7) && G.mode === 'free');
      let first = true;
      const knight = await this.bossFight(async () => {
        const lv = G.enemies.levelFor(1) + 1;
        const k = G.enemies.spawn('knight', V(S.pos.x + 3.2, 0, S.pos.z + 0.5), lv);
        k.pos.y = S.y + 0.8; k.yaw = Math.PI / 2;
        if (first) {
          first = false;
          await this.conv(async () => {
            // inside the pillar ring, between two pillars (they stand at r 8.2, every 45° from 22.5°), facing the knight
            G.cameraRig.setCine(V(S.pos.x + 7.4, S.y + 2.9, S.pos.z - 1.2), V(S.pos.x + 3.2, S.y + 2.1, S.pos.z + 0.5));
            G.audio.play('dissolve', { pos: k.pos });
            G.vfx.burst(k.center(), 'hush', 30, { size: 1.5 });
            await this.say('kaelShadow', '…돌아… 가라…', { cam: false });
            await this.say('kaelShadow', '여긴… 잊힌 자가… 지키는 자리…', { cam: false });
            await this.say('boreum', '저 칼 쥐는 버릇은— …아니다. 이름마저 빼앗긴 빈 껍데기일 뿐이야. 정신 차려라, 꼬마!', { cam: false });
          });
        }
        k.setState('idle'); k.aggroed = true;
        G.audio.play('boss_roar', { pos: k.pos });
        G.hud.bossBar(k, '무명의 기사 — 이름을 내어 준 자');
        this.cSay(`껍데기 주제에 칼은 살아 있구나! 한 가지 노래만 부르지 마라— ${G.player.unlocked.has('frost') ? '불과 서리를 번갈아 몰아쳐라!' : '불과 바람을 섞어 몰아쳐라!'}`, null, 5);
        return k;
      }, S.pos, 34, G.player.unlocked.has('frost') ? '놈은 세 번 연달아 벤다. 마지막 베기가 땅을 가르니 잘 피하고, 틈이 보일 때 얼려 두거라.' : '놈은 세 번 연달아 벤다. 마지막 베기가 땅을 가르니 잘 피해야 한다.');
      this.set('s_boss');
      G.skills.gain(2, '무명의 기사가 이름을 되찾았다');
      await this.kaelScene(S, knight);
    }
    if (!this.flag('s_learn')) {
      await this.learnAtShrine(S, 'storm');
      this.set('s_learn');
    }
    if (!this.flag('stormBell')) {
      this.cSay('자, 종 차례다. 이 고원이 조용해서야 쓰겠느냐.', 'storm_bellhint');
      await this.wait(() => this.flag('stormBell'));
    }
  }

  async kaelScene(S, knight) {
    const kp = knight.pos.clone();
    const rig = makeGhost(makeHumanoid(CHAR.kael), 0x9ad0ff, 0.85);
    const kael = G.npcs.add(new NPC('kael', 'kael', kp.x, kp.z, knight.yaw, { rig }));
    kael.pose.kneel = true;
    G.game.musicOverride = 'memory';
    G.audio.play('echo', { pos: kp });
    G.vfx.burst(kael.headPos(), 'soul', 50, { el: 'storm' });
    await this.conv(async () => {
      await this.say('kael', '…덕분에 정신이 들었다. 따뜻하면서도 어딘가 성급한 울림이더군. 꼭 모라의 불을 닮았어.', { expr: 'tender' });
      kael.pose.kneel = false;
      await this.say('kael', '카엘이다. 오십 년 전, 모라와 함께 고요를 틈에 가둔 기사.', { gesture: 'handToChest' });
      await this.say('kael', '그날 틈의 문을 닫으려면 누군가 안에서 붙들고 있어야 했다. 문 너머에 남은 자는 사람들의 기억에서 지워진다. 그게 대가였지.');
      await this.say('kael', '그래서 내가 남겠다고 나섰다. 모라는 길길이 뛰며 말렸지만, 난 웃으면서 그랬지. "괜찮아. 네가 기억해 주면 돼."', { expr: 'smile' });
      await this.say('kael', '…잔인한 말이었다. 그 사람은 정말로 기억했으니까. 오십 년을, 새벽마다.', { expr: 'sad', gesture: 'sigh' });
      await this.say('kael', '종을 울린 것도, 내가 문 너머에서 버티게 해 준 것도 다 그 노래였다. …오십 년 동안 이 골짜기를 지킨 건 그 사람의 기억이었던 셈이지.');
      const c = await this.choose(['할머니는 지금 모든 걸 잊어 가고 있어요.', '당신 이름을 할머니께 전할게요.']);
      if (c === 0) {
        await this.say('kael', '…안다. 문 너머에서도 느꼈지. 들려오던 노랫소리가 실처럼 가늘어지는 걸.', { expr: 'sad' });
        await this.say('kael', '사람은 잊는다. 그건 죄가 아니야. 오십 년을 붙든 쪽이 기적이었지.', { expr: 'tender', gesture: 'shake' });
      } else {
        await this.say('kael', '……', { expr: 'surprised' });
        await this.say('kael', '…아니. 그대 마음 가는 대로 해라. 내가 무언가를 부탁할 자격은, 오십 년 전에 다 써 버렸으니.', { expr: 'sad' });
        this.set('promiseKael');
      }
      await this.say('kael', '그리고 한 가지 더. 십오 년 전에 세하가 문 너머로 찾아왔었다.');
      await this.say('kael', '나를 데리러 와 놓고는… 차마 문을 놓지 못하고 같이 붙들더군. 고집이 꼭 제 어미야. 그 애도 아직 저 너머에 있다.', { expr: 'sad' });
      await this.say('kael', '번개의 노래를 가져가라, 울림지기. 그리고 틈으로 와라. 이번엔— 아무도 혼자 문을 붙들지 않게.', { expr: 'determined', gesture: 'nod' });
      G.vfx.burst(kael.headPos(), 'soul', 50, { el: 'storm' });
      kael.show(false);
    });
    G.game.musicOverride = null;
    G.scene.remove(kael.root);
    G.npcs.list.splice(G.npcs.list.indexOf(kael), 1); delete G.npcs.map.kael;
  }

  // Scripted fight that restarts cleanly if the player falls: leftover enemies are
  // cleared and the wave is spawned again once the player is back on their feet.
  async scriptedWave(spawn, center, radius = 70) {
    for (;;) {
      const es = spawn();
      for (const e of es) { e.scripted = true; e.aggro(); }
      const inArea = () => G.enemies.list.filter((e) => e.alive && !e.boss && e.pos && Math.hypot(e.pos.x - center.x, e.pos.z - center.z) < radius);
      const res = await this.wait(() => (es.every((e) => !e.alive) && inArea().length === 0 ? 'win' : G.player.dead ? 'lose' : null));
      if (res === 'win') return;
      for (const e of [...G.enemies.list]) if (e.alive && !e.boss && e.pos && Math.hypot(e.pos.x - center.x, e.pos.z - center.z) < radius && e.remove) e.remove();
      await this.wait(() => !G.player.dead && G.mode === 'free');
      await this.sleep(1.5);
      this.cSay(pick(['또 온다. 이번엔 숨부터 고르거라.', '괜찮다, 꼬마. 한 번 넘어졌다고 노래가 끝나진 않느니라.', '놈들이 다시 몰려온다. 너무 에워싸이지 않게 움직이거라.']));
    }
  }

  async bossFight(make, center, radius, tip = null) {
    for (;;) {
      const boss = await make();
      G.bossActive = true;
      const res = await this.wait(() => (!boss.alive && boss.hp <= 0 ? 'win' : G.player.dead ? 'lose' : null));
      G.bossActive = false;
      if (res === 'win') { setTimeout(() => G.hud.bossBar(null), 1600); return boss; }
      boss.remove ? boss.remove() : null;
      G.hud.bossBar(null);
      for (const e of [...G.enemies.list]) if (e.alive && e.pos && e.pos.distanceTo(center) < radius + 10 && e.remove) e.remove();
      await this.wait(() => !G.player.dead && G.mode === 'free');
      await this.sleep(1.2);
      if (tip) this.cSay(tip, null, 7);
      await this.wait(() => this.near(center.x, center.z, 7) && G.mode === 'free');
    }
  }

  // ------------------------------------------------------------ chapter 3: Mora's song
  async moraChapter() {
    this.quest('q_song', '모라의 노래', '두 종이 울렸다. 셋째 종이 어디 있는지는 할머니만 안다. 할머니가 아직 기억하고 있다면.');
    if (!this.flag('m_talk')) {
      this.obj('q_song', '할머니의 탑으로 돌아가기', [{ x: -20, z: 132, h: 2.4 }]);
      await this.wait(() => this.flag('m_talk'));
    }
    if (!this.flag('m_names')) {
      const upd = () => this.obj('q_song', `마을 사람들에게 잊힌 이름 전하기 (${this.count('names')}/4)`, ['bau', 'danbi', 'dodam', 'isol'].filter((id) => !this.flag('name_' + id)).map((id) => ({ x: this.npc(id).pos.x, z: this.npc(id).pos.z, h: 2.6 })));
      upd();
      this.namesUpd = upd;
      await this.wait(() => this.count('names') >= 4 && G.mode === 'free');
      this.set('m_names');
    }
    if (!this.flag('m_choir')) {
      await this.sleep(1.5);
      await this.choirScene();
      this.set('m_choir');
    }
    this.done('q_song');
    this.quest('q_rift', '고요의 틈', '골짜기가 스스로를 기억하기 시작했다. 이제 틈으로 간다. 오십 년, 그리고 십오 년째 문을 붙들고 있는 두 사람에게.');
    this.obj('q_rift', '고요의 틈으로', [{ x: POI.rift.x, z: POI.rift.z, h: 10 }]);
    this.setChapter('rift');
  }

  async moraMain() {
    const mora = this.npc('mora');
    G.game.musicOverride = 'memory';
    await this.conv(async () => {
      await this.say('mora', '…어머, 손님이 오셨네. 이 늙은이한테 무슨 볼일이시우?', { expr: 'smile' });
      await this.say('boreum', '…모라.');
      await this.say('mora', '세하니? 이제 오니. 저녁은 먹었고? 엄마가 수제비 끓여 놨는데.', { expr: 'tender' });
      const c = await this.choose(['…응, 엄마. 나 왔어.', '할머니, 저예요. {n}.']);
      if (c === 0) {
        await this.say('mora', '그래, 그래. 우리 세하. 금방 온다더니, 해가 다 졌잖니.', { expr: 'tender', gesture: 'handToChest' });
        await this.say('mora', '…많이 컸구나. 꼭 딴사람 같아.');
      } else {
        await this.say('mora', '{n}…?', { expr: 'surprised' });
        await this.say('mora', '…{n}. 그래, 우리 {n}. 아이고, 내가 또. 할미가 요새 자꾸 이런다.', { expr: 'sad', gesture: 'sigh' });
      }
      await this.say('narr', '할머니의 눈이, 잠깐 맑아진다.');
      await this.say('mora', '얘야. 할미 정신이 맑을 때 일러둘 게 있다. 잘 들으렴.', { expr: 'determined' });
      await this.say('mora', '셋째 종 말이다. 그건 성소에 있는 게 아니란다.');
      await this.say('mora', '셋째 종은 *사람*이야. 이 골짜기의 노래를 기억하는 사람들 말이다. 오십 년 전엔 그게 나 혼자뿐이었지. …그러니 버거울 수밖에.', { expr: 'tender', gesture: 'handToChest' });
      await this.say('mora', '고요는 미워서 내려오는 게 아니란다. 추워서 오는 게야. 아무도 불러 주질 않으니까.', { expr: 'sad' });
      await this.say('mora', '*노래는 한 사람만 기억하는 게 아니란다.* 네 어미 떠나던 밤에 내가 해 준 말인데… 정작 나는 그 말을 잊고, 오십 년을 혼자 다 짊어지고 살았구나.', { expr: 'sad', gesture: 'shake' });
      await this.say('mora', '마을 사람들에게 가서 잊힌 이름들을 들려주렴. 카엘. 세하. …언젠가 내가 나를 잊거든, 이 할미 이름도.');
      await this.say('mora', '그러고 나서 틈으로 가거라. 이번엔 누구도 혼자 문을 붙들지 않게. …약속해 주겠니?', { expr: 'worried' });
      await this.choose(['약속할게요.']);
      if (!G.player.hasHat) {
        await this.say('mora', '…고맙다. 이 모자 받으렴. 좀 클 게다. 괜찮아, 넌 금방 자라니까.', { expr: 'smile' });
        G.player.setHat(true); this.set('hat');
        G.audio.play('unlock');
        G.hud.banner('모라의 선물', '모라의 모자', '세월이 내려앉아 빛바랜 보랏빛 모자. 오십 번의 겨울바람을 맞으며 챙 한쪽이 부드럽게 휘어 있다.', '#c9a8ff');
      } else await this.say('mora', '…그 모자, 잘 어울리는구나. 이 할미가 쓸 때보다 훨씬.', { expr: 'smile' });
      await this.say('mora', '……', { expr: 'neutral' });
      await this.say('mora', '…세하야, 바람이 차다. 그만 들어가자꾸나.', { expr: 'tender' });
    });
    G.game.musicOverride = null;
    this.set('m_talk');
  }

  async choirScene() {
    await this.fade(true, 1.2);
    G.world.sky.setHour(19.2);
    const spots = { bau: [4, 16, Math.PI], danbi: [9, 17, Math.PI], dodam: [1, 18, Math.PI], isol: [12, 19, Math.PI], farmer: [-1, 20, Math.PI], fisher: [14, 21, Math.PI], elder: [6, 20, Math.PI] };
    for (const [id, [x, z, y]] of Object.entries(spots)) { const n = this.npc(id); n.pose.sit = false; n.setPos(x, z, y); n.show(true); }
    G.player.teleport(6, 24, Math.PI);
    await this.sleep(0.3);
    await this.fade(false, 1.2);
    G.game.musicOverride = 'ending';
    await this.conv(async () => {
      G.cameraRig.setCine(GV(6, 3.2, 31), GV(6, 3, 14));
      await this.say('bau', '다들 모였는감. …그러니께, 종 줄 대신 목청을 쓰라는 거여?', { cam: false, gesture: 'think' });
      await this.say('isol', '네. 기록에 따르면 가사는 중요하지 않습니다. 틀려도 됩니다. …아마도요.', { cam: false, gesture: 'nod' });
      await this.say('dodam', this.flag('catSaved') ? '누룽지도 같이 불러요! 누룽지는 음치지만요!' : '제가 제일 크게 부를게요! 누룽지가 어디 있든 들리게요!', { cam: false, expr: 'laugh' });
      await this.say('danbi', '아이고, 이 나이에 노래라니. …그래도 세하 그 애가 흥얼대던 거니까. 조금 틀려도 흉보기 없기다.', { cam: false, expr: 'tender' });
      await this.say('narr', '한 사람, 또 한 사람 목소리를 보탠다. 서툴고 저마다 조금씩 틀린 음으로, 밤하늘에 노랫소리가 퍼져 나간다.', { cam: false });
      const W = G.world;
      const bp = V(6, W.h(6, 10) + 13, 10);
      for (let k = 0; k < 4; k++) {
        W.bellSwing = 0.3;
        G.audio.play('bell', { pos: bp, f: [146.8, 196, 220, 293.6][k] });
        G.vfx.ring(V(6, W.h(6, 10), 10), [PAL.gold, PAL.frost, PAL.storm, PAL.wind][k].core, 90, 4, { thick: 0.04 });
        G.vfx.burst(bp, 'soul', 40, { el: ['gold', 'frost', 'storm', 'wind'][k] });
        for (const n of G.npcs.list) if (n.visible) G.vfx.burst(n.headPos(), 'soul', 6, { el: 'gold' });
        await this.sleep(1.6);
      }
      this.hushBase = 0.04;
      await this.say('boreum', '…들리느냐, 꼬마. 이게 셋째 종이다.', { cam: false });
      await this.say('boreum', '할멈이 오십 년 동안 혼자 짊어졌던 짐을, 이제 온 마을이 나눠 들었구나. …가자, 문 앞에서 기다리는 이들이 있다.', { cam: false });
    });
    G.game.musicOverride = null;
    await this.fade(true, 1);
    this.npc('bau').setPos(9, 16.5, 0.2); this.npc('dodam').setPos(0, 24, 0.5); this.npc('isol').setPos(18, 26.5, -0.6);
    this.npc('danbi').setPos(13, 7.5, 0.4); this.npc('farmer').setPos(36, 36, -1.2); this.npc('fisher').setPos(-42, 47, -1.9);
    this.npc('elder').setPos(-12.5, 6.5, 2.3); this.npc('elder').pose.sit = true;
    await this.fade(false, 1);
  }

  // ------------------------------------------------------------ chapter 4: the rift
  async riftChapter() {
    this.quest('q_rift', '고요의 틈', '골짜기가 스스로를 기억하기 시작했다. 이제 틈으로 간다. 오십 년, 그리고 십오 년째 문을 붙들고 있는 두 사람에게.');
    this.obj('q_rift', '고요의 틈으로', [{ x: POI.rift.x, z: POI.rift.z, h: 10 }]);
    const R = G.world.rift;
    await this.wait(() => this.near(POI.rift.x, POI.rift.z, 70));
    this.cSay('…저 너머엔 소리가 없다. 이 몸의 바람도 거기선 숨을 죽이지.', 'rift_near', 6);
    await this.wait(() => this.near(POI.rift.x, POI.rift.z, 24) && G.mode === 'free');
    let first = true;
    const heart = await this.bossFight(async () => {
      if (first) { first = false; await this.gateScene(R); }
      const h = G.enemies.spawnHeart(R.center, G.enemies.levelFor(2) + 1);
      h.state = 'active';
      h.spawnPlates();
      G.hud.bossBar(h, '이름 삼킨 자 — 고요의 심장');
      G.audio.play('boss_roar', { pos: h.core.position });
      return h;
    }, R.center, 40, '서두를 것 없다. 결계의 빛깔을 보고 반대되는 노래로 깨뜨리거라.');
    await this.endingScene(heart);
  }

  async gateScene(R) {
    const c = R.center;
    const ks = makeGhost(makeHumanoid(CHAR.kael), 0x9ad0ff, 0.8);
    const kael = G.npcs.add(new NPC('kael', 'kael', c.x - 3.2, c.z - 11, 0, { rig: ks }));
    const ss = makeGhost(makeHumanoid(CHAR.seha), 0xbfe8ff, 0.8);
    const seha = G.npcs.add(new NPC('seha', 'seha', c.x + 3.2, c.z - 11, 0, { rig: ss }));
    this.ghosts = [kael, seha];
    G.audio.play('echo', { pos: c });
    await this.conv(async () => {
      await this.say('kael', '왔군. …모라의 불을 닮은 녀석.', { expr: 'smile' });
      await this.say('seha', '{n}…? {n} 맞지? 세상에. 언제 이렇게 컸어.', { expr: 'surprised', gesture: 'handToChest' });
      await this.say('seha', '미안해. 금방 온다 해 놓고선— 그 금방이 너무 길었지. 그동안 할머니랑 얼마나 고생 많았을까.', { expr: 'sad' });
      const ch = await this.choose(['보고 싶었어요.', '같이 돌아가요.']);
      if (ch === 0) await this.say('seha', '나도, 매일 보고 싶었어. 이 너머에 갇혀 있는 동안에도 너만은 못 잊겠더라.', { expr: 'tender' });
      else {
        await this.say('seha', '…그럴 수 있으면 얼마나 좋을까. 하지만 우린 이 너머에 너무 오래 남았어. 괜찮아, 네가 기억해 주면—', { expr: 'sad', gesture: 'shake' });
        await this.say('kael', '세하야, 그만. …그 모진 말은 내가 오십 년 전에 한 걸로 충분하다.', { expr: 'sad', gesture: 'shake' });
      }
      await this.say('kael', '물러서라, 문이 더는 못 버틴다! 오래 버티는 것 하나는 자신 있었건만… 안에서 심장이 깨어난다.', { expr: 'determined' });
      await this.say('seha', '잘 들어, {n:아}. 심장은 결계를 여러 겹 두르고 있어. 결계마다 통하는 노래가 달라.', { expr: 'determined', gesture: 'point' });
      await this.say('seha', '[불|fire]엔 [서리|frost], [서리|frost]엔 [불|fire]. [번개|storm]엔 [바람|wind], [바람|wind]엔 [번개|storm]. 반대되는 노래로 쳐야 깨져.');
      if (G.player.unlocked.has('water')) await this.say('seha', '…어? 너, 물의 노래도 아네. 내가 호숫가에서 흥얼대던 거. 그럼 [불|fire] 결계엔 [물|water]도 먹혀.', { expr: 'surprised' });
      await this.say('kael', '결계가 다 깨지면 심장이 드러난다. 그때다. 아낄 것 없다, 가진 노래를 전부 쏟아라.', { gesture: 'nod' });
      await this.say('boreum', '…꼬마. 아니, *{n}*. 이 몸의 꼬리를 걸고 말하마. 넌 혼자가 아니다.');
    });
    this.hint('결계의 색을 보고 <b>약점 속성</b>으로 치자 · 충격파는 점프나 순간이동으로 피한다', 9);
  }

  async endingScene(heart) {
    G.game.musicOverride = 'silence';
    await this.sleep(2.5);
    await this.conv(async () => {
      G.cameraRig.setCine(heart.center0.clone().add(V(8, 6, 14)), heart.center0.clone().setY(heart.center0.y + 5));
      await this.say('hush', '…기억해… 줄 거니…?', { cam: false });
      await this.choose(['기억할게.']);
      await this.say('hush', '…그럼… 됐어…', { cam: false });
    }, { cutscene: true });
    this.hushBase = 0;
    G.world.sky.hush = 0.2;
    for (let i = 0; i < 20; i++) G.vfx.burst(heart.center0.clone().add(V(randRange(-10, 10), randRange(1, 8), randRange(-10, 10))), 'soul', 8, { el: 'gold' });
    G.game.musicOverride = 'ending';
    const [kael, seha] = this.ghosts || [];
    await this.conv(async () => {
      if (kael) await this.say('kael', '문이 닫힌다. …이번엔 안에서 붙들고 서 있을 사람이 없어도 되겠군. 골짜기 사람들이 다 함께 기억해 주고 있으니.', { expr: 'smile' });
      if (seha) {
        await this.say('seha', '{n:아}, 할머니한테 전해 줘. …아니다, 안 전해도 돼. 엄마가 날 잊어도, 내가 엄마를 기억하면 되니까.', { expr: 'tender' });
        await this.say('seha', '그러니까 너도 할머니를 기억해 줘. 언젠가 할머니가 너를 잊는 날이 와도. …노래는, 조금 틀리게 불러도 괜찮으니까.', { expr: 'tender', gesture: 'nod' });
      }
      if (kael && this.flag('promiseKael')) await this.say('kael', '…그리고 울림지기. 모라에게— …아니다. 그대가 약속했지. 믿겠다.', { expr: 'smile', gesture: 'nod' });
    });
    for (const g of this.ghosts || []) { G.vfx.burst(g.headPos(), 'soul', 40, { el: 'gold' }); g.show(false); }
    await this.fade(true, 2.5, true);
    this.done('q_rift');
    this.chapter = 'post';
    G.skills.gain(3, '이름 삼킨 자를 달랬다');
    this.positionNPCs(); this.refreshBarks();
    // epilogue at dawn
    G.world.sky.setHour(6.1);
    for (const g of this.ghosts || []) { G.scene.remove(g.root); const i = G.npcs.list.indexOf(g); if (i >= 0) G.npcs.list.splice(i, 1); delete G.npcs.map[g.id]; }
    G.enemies.clearAll();
    G.player.teleport(-17, 128, Math.PI);
    await this.sleep(0.5);
    await this.fade(false, 2.5, true);
    G.game.musicOverride = 'silence';
    await this.conv(async () => {
      const mora = this.npc('mora');
      await this.say('narr', '새벽. 모라의 언덕.');
      await this.say('mora', '…어머, 누구시더라.', { expr: 'surprised' });
      await this.say('mora', '이상하지. 처음 뵙는 얼굴인데, 댁을 보니 노래 하나가 떠오르네.', { expr: 'tender' });
      await this.say('mora', '라— 라라… 이다음이 뭐였더라.', { gesture: 'think' });
      await this.choose(['(이어서 노래한다)']);
      G.game.musicOverride = 'memory';
      // from behind the two of them, out over the dawn vale while the bells answer
      G.cameraRig.setCine(GV(-21.5, 4.6, 147), GV(POI.bellTower.x, 12, POI.bellTower.z));
      await this.sleep(1.5);
      const tps = [V(6, 20, 10), V(POI.frost.x, 62, POI.frost.z), V(POI.storm.x, 40, POI.storm.z)];
      for (let k = 0; k < 3; k++) { G.audio.play('bell', { pos: G.player.pos.clone().add(V(0, 0, -30)), f: [146.8, 196, 220][k] }); await this.sleep(1.4); void tps; }
      await this.say('mora', '…그래, 그거야. 그거였어.', { expr: 'laugh' });
      await this.say('mora', '고마워요. 뉘신지는 몰라도… 꼭 오래 알던 사람 같네.', { expr: 'tender', gesture: 'bow' });
      await this.say('mora', '이 노래는요, 우리 딸이 좋아하던 거예요. 세하라고… 꼭 한 군데를 틀리게 부르는 버릇이 있었지요.', { expr: 'smile' });
      await this.say('mora', '우습죠. 그 애 얼굴은 흐릿한데, 그 애가 틀리던 음은 이렇게 또렷해요.', { expr: 'sad' });
      if (this.flag('askedMother')) await this.say('narr', '오늘 일을 다 마치면 들려주겠다던 옛날이야기. 할머니는 누구에게 하는 말인지도 잊은 채, 아침의 약속을 지키셨다.');
      if (this.flag('promiseKael')) {
        const k = await this.choose(['(카엘이라는 이름을 들려준다)', '(말없이 곁에 앉는다)']);
        if (k === 0) {
          this.set('keptPromise');
          await this.say('mora', '카엘…', { expr: 'surprised' });
          await this.say('mora', '처음 듣는 이름인데, 이상하게 가슴께가 따뜻해지네요. 좋은 사람이었나 봐요.', { expr: 'tender', gesture: 'handToChest' });
          await this.say('mora', '…그래요. 좋은 사람이었을 거예요. 끝까지 혼자 멋있는 척하는.', { expr: 'laugh' });
        } else await this.say('narr', '말하지 않아도 괜찮을 것 같았다. 노래가 대신 전해 줄 테니까.');
      }
      await this.say('mora', '누가 그러더라고요. 노래는 한 사람만 기억하는 게 아니라고. …누가 그랬더라.', { expr: 'tender' });
      await this.say('boreum', '…늙은 여우 할멈. 푹 자 두거라. 새벽엔 이 몸이 깨워 주마. 오십 년 치 빚이 있으니.');
      void mora;
    });
    await this.credits();
    G.game.musicOverride = null;
    G.game.save(true);
    this.postgame();
  }

  async credits() {
    const intro = document.getElementById('intro');
    const tx = intro.querySelector('.intro-text');
    intro.classList.remove('hidden');
    intro.style.background = 'rgba(3,4,7,0.9)';
    const cards = [
      '"노래는 한 사람만 기억하는 게 아니란다."',
      '울림지기 — 하늬 골짜기의 노래',
      '모라 · 보름 · 바우 · 도담 · 이솔 · 단비\n그리고 카엘과 세하',
      '잊힌 모든 이름에게',
      '— 끝 —\n\n골짜기의 아침은 계속됩니다.\n아직 잠든 노래 씨앗과, 두고 온 기억들이 기다립니다.',
    ];
    G.mode = 'cutscene';
    let skip = false;
    const onKey = (e) => { if (e.code === 'Space' || e.code === 'Escape') skip = true; };
    window.addEventListener('keydown', onKey);
    const wait = async (ms) => { const t = performance.now(); while (performance.now() - t < ms && !skip) await new Promise((r) => setTimeout(r, 50)); };
    for (const c of cards) {
      if (skip) break;
      tx.innerHTML = c.replace(/\n/g, '<br>');
      tx.classList.add('show');
      await wait(4200);
      tx.classList.remove('show');
      await wait(1700);
    }
    window.removeEventListener('keydown', onKey);
    G.mode = 'free';
    intro.classList.add('hidden');
    intro.style.background = '';
  }

  postgame() {
    this.chapter = 'post';
    this.set('worldOpen');
    this.refreshBarks();
  }

  // ------------------------------------------------------------ NPC talk router
  async talkNPC(id) {
    const n = this.npc(id);
    const ch = this.chapter;
    // --- main story beats first
    if (id === 'bau' && ch === 'village' && !this.flag('v_bau')) return this.conv(async () => {
      // talked to Bau first: skip Dodam's greeting instead of blocking the quest
      if (!this.flag('v_arrive')) { this.set('v_arrive'); const d = this.npc('dodam'); d.walkTarget = null; d.walkRes = null; G.player.frozenInput = false; d.walkTo(0, 24, 3.5); }
      await this.say('bau', '…왔는감.', { gesture: 'nod' });
      await this.say('bau', '모라 할매가 보냈겄지. 언젠간 그 할매 대신 네가 올 줄 알았어.');
      await this.say('bau', '종 말이여, 도통 울지를 않어. 아무리 줄을 당겨도 그냥 먹통이여.');
      await this.say('bau', '사십 년을 새벽마다 당겼는디, 당기는 손끝이 이리 허전한 건 처음이여.', { expr: 'sad', gesture: 'sigh' });
      const c = await this.choose(['모라 할머니가 편찮으세요.', '종을 살펴봐도 될까요?']);
      if (c === 0) { await this.say('bau', '…그 할매가? 허긴, 무쇠도 세월 가면 녹이 스는디 사람 몸이야 오죽허겄어.', { expr: 'sad' }); await this.say('bau', '그럼 더 서둘러야겄네.'); }
      else await this.say('bau', '그려, 볼 테면 봐. 근디 줄은 건들지 말어. 그건 내 일이여.', { gesture: 'crossArms' });
      await this.say('bau', '요새 밤마다 종탑 꼭대기서 뭐가 번쩍혀. 꼬랑지 같은 게. 늙어서 헛것을 보나 했는디…', { expr: 'worried', gesture: 'think' });
      await this.say('bau', '참, 저기 여관에 묵는 *학자 양반*한테도 가 봐. 며칠째 종탑을 기웃거리는 게 뭘 좀 아는 눈치여.', { gesture: 'point' });
      this.set('v_bau');
    });
    if (id === 'isol' && ch === 'village' && this.flag('v_bau') && !this.flag('v_isol')) return this.conv(async () => {
      await this.say('isol', '실례합니다. 엿들으려던 건 아닌데… 종 이야기가 들려서요. 이솔이라고 합니다.', { gesture: 'bow' });
      await this.say('isol', '왕립 학술원 소속… 이었던, 현재는 독립 연구자지요. 연구 주제는 *고요*입니다.');
      await this.say('isol', '사람들의 기억에서 사라진 것들이 울림을 잃고 잿빛으로 변하는 현상 말입니다.');
      await this.say('isol', '참고로 말씀드리자면, 학계에선 전설 취급입니다. 덕분에 제 연구비도 전설이 되었지요. 하하… 하.', { expr: 'laugh', gesture: 'shrug' });
      await this.say('isol', '제 가설로는, 이 골짜기의 종은 기억을 붙드는 *닻*입니다. 울릴 때마다 골짜기가 옛 기억을 되찾는 거지요.', { expr: 'determined' });
      await this.say('isol', '그런데 그 종이 멈췄다는 건… 닻줄을 쥐고 있던 손에 힘이 빠졌다는 뜻입니다.', { expr: 'worried' });
      const c = await this.choose(['그 사람이… 모라 할머니인가요?', '어떻게 하면 다시 울릴 수 있죠?']);
      if (c === 0) { await this.say('isol', '…!', { expr: 'surprised' }); await this.say('isol', '그럼 소문이 맞았군요. 새벽마다 종보다 먼저 일어나 노래하는 분이 계신다는 소문이요.'); }
      else await this.say('isol', '그걸 알아내는 게 제 일인데… 가설 열여섯 개가 전부 빗나갔습니다. 열일곱 번째는 아직 백지고요.', { gesture: 'sigh' });
      await this.say('isol', '종탑 아래 *제단*에 손을 대 보시겠습니까? 저는 세 번 해 봤는데 아무 반응이 없더군요. 마법사라면 다를지도 모릅니다.', { gesture: 'point' });
      this.set('v_isol');
    });
    if (id === 'mora' && ch === 'mora' && !this.flag('m_talk')) return this.moraMain();
    if (ch === 'mora' && this.flag('m_talk') && ['bau', 'danbi', 'dodam', 'isol'].includes(id) && !this.flag('name_' + id)) return this.tellNames(id);
    // --- side quest beats
    if (id === 'mora' && Object.values(this.memories).includes('have')) return this.deliverMemories();
    if (id === 'dodam' && this.flag('worldOpen') && !this.quests.q_cat) return this.catStart();
    if (id === 'isol' && this.quests.q_bounty && this.count('bountyNew') > 0) return this.bountyReport();
    if (id === 'danbi' && this.flag('worldOpen') && !this.quests.q_memory) return this.danbiMemory();
    // --- ambient talk
    return this.conv(async () => { for (const l of this.ambientTalk(id)) await this.say(l[0], l[1], l[2] || {}); });
  }

  // Daily talk: one line, or a short exchange (an array of lines). The pool follows the story
  // (chapter, bells rung, what the speaker has been told), the weather and the hour.
  ambientTalk(id) {
    const ch = this.chapter, post = ch === 'post';
    const f = (k) => this.flag(k), bells = this.bellsRung();
    const rain = G.world.weather && G.world.weather.rain > 0.3, night = G.world.sky.night > 0.5;
    const fox = G.companion && G.companion.active;
    const has = (el) => G.player.unlocked.has(el);
    const L = [];
    const add = (...e) => L.push(...e);
    switch (id) {
      case 'mora':
        if (ch === 'prologue') add(['mora', '천천히 하렴. 서두르는 불은 금방 꺼진단다.', { expr: 'smile' }], ['mora', '오늘따라 아침이 조용하구나. …아니다, 하던 거 마저 하렴.', { expr: 'worried' }]);
        else if (post) add(
          ['mora', '어머, 또 오셨네. 이상하지, 댁이 오면 마음이 놓여요.', { expr: 'smile' }],
          ['mora', '라— 라라… 이 노래, 누가 가르쳐 줬더라.', { gesture: 'think' }],
          ['mora', '수제비 좀 들고 가요. 늘 두 그릇을 끓이게 되네. 버릇인가 봐.', { expr: 'tender' }],
          ['mora', '새벽마다 누가 창을 톡톡 쳐요. 바람이겠지요. 꼬리 달린 바람.', { expr: 'laugh' }]);
        else if (ch === 'mora' || ch === 'rift') {
          add(['mora', '세하야, 바람이 차다. 목도리 잘 여미렴.', { expr: 'tender' }], ['mora', '…손님, 우리 딸 못 보셨수? 금방 온다고 나갔는데.', { expr: 'worried' }]);
          if (f('m_choir')) add(['mora', '아까는 마을 쪽에서 노랫소리가 들리더구나. 여럿이서 부르는 게… 참 듣기 좋더라.', { expr: 'smile' }]);
        } else {
          add(['mora', '다녀왔니. 할미는 여기 앉아 골짜기를 내려다보고 있었단다. 이렇게 가만히 바라보고 있으면 잊었던 옛날 일이 떠오를 것 같아서.', { expr: 'tender' }],
            ['mora', '무리하지 말거라. 등석에서 쉬어 가는 것도 용기란다.', { expr: 'smile' }]);
          if (bells >= 1) add(['mora', '종소리가 돌아왔더구나. …네가 깨운 게지? 말 안 해도 안다, 소리 끝에 네 버릇이 묻어나거든.', { expr: 'smile' }]);
          if (bells >= 2) add(['mora', '얘야, 할미가 아침은 먹었던가? …그래, 먹었구나. 네가 그렇다면 그런 게지.', { expr: 'worried' }]);
          if (fox) add([['mora', '거기 털뭉치도 왔구나. 낮잠은 실컷 잤고?', { expr: 'smile' }], ['boreum', '…털뭉치라니. 오십 년 만에 건네는 말이 고작 그거냐, 할멈.']]);
        }
        break;
      case 'bau':
        if (ch === 'village' && !f('v_defend')) { add(['bau', '종 줄은 내가 쥐고 있을 텨. 너는 네 볼일 봐.'], ['bau', '제단은 종탑 밑이여. 사십 년을 쓸고 닦았는디, 그 돌은 늘 차갑더구먼.', { gesture: 'point' }]); break; }
        add(f('name_bau') ? ['bau', '종은 세게 치는 게 아니라 오래 치는 겨. 인제는 누가 한 말인지도 알어.', { gesture: 'nod' }]
          : ['bau', '종은 세게 치는 게 아니라 오래 치는 겨. 누가 가르쳐 줬는지는 까먹었는디… 말은 안 까먹었어.']);
        if (post) add(['bau', '요샌 새벽마다 애들이 종 치겄다고 줄을 서. 허허, 내 자리 뺏기게 생겼어.', { expr: 'laugh' }],
          ['bau', '그 양반이 깎아 준 막대기 창, 헛간에서 찾았어. …닦아서 종탑에 세워 놨어.', { expr: 'tender' }]);
        else add(['bau', '북쪽 길은 눈이 쌓여 미끄럽고, 서쪽 고원은 번개가 잦어. 무릎 쑤시는 날은 가지 말어.']);
        if (rain) add(['bau', '거 봐, 무릎이 쑤신 게 비 올 거 같다 했더니만. 줄이 젖으면 무거운디.', { gesture: 'sigh' }]);
        if (bells >= 3 && !post) add(['bau', '바람결에 종소리가 둘 더 실려 와. 북쪽 하나, 서쪽 하나. …귀는 아직 안 늙었어.', { expr: 'smile' }]);
        if (fox) add([['bau', '종탑 꼭대기서 번쩍이던 꼬랑지가 너였구먼.'], ['boreum', '꼬랑지가 아니라 꼬리니라. 사십 년을 밑에서 한숨만 쉬던 게 너였고.'], ['bau', '…다 듣고 있었어?', { expr: 'surprised' }]]);
        break;
      case 'dodam':
        if (night) add(['dodam', '쉿! 저 원래 자야 되는 시간이에요. 마법사님은 저 못 본 거예요.', { gesture: 'lookAround' }]);
        if (f('catSaved')) add(['dodam', '누룽지가 요즘 저만 졸졸 따라다녀요! 마법사님 덕분이에요!', { expr: 'laugh' }],
          ['dodam', '저 커서 울림지기 될 거예요. 불도 쏘고, 하늘도 날고! …근데 무서운 건 빼고요.']);
        else {
          add(['dodam', '마법사님, 마법 한 번만 보여 주세요! 한 번만요! …아, 지금 바쁘시구나.']);
          if (this.quests.q_cat) add(['dodam', '누룽지 찾았어요? 아직이에요? …괜찮아요. 저 기다리는 거 잘해요. 진짜로요.', { expr: 'worried' }]);
        }
        if (f('v_wind')) add(['dodam', '종이 다시 울어서 좋아요! 안 울 땐 아침이 온 건지 안 온 건지 헷갈렸거든요.']);
        if (post) add(['dodam', '비석에 글씨 새긴 거 저예요. 삐뚤빼뚤해도요, 안 까먹겠다고 했으니까요.', { expr: 'determined' }]);
        if (fox) add([['dodam', '여우님! 꼬리 한 번만 만져 봐도 돼요? 한 번만요!', { expr: 'laugh' }], ['boreum', '안 된다. …한 번만이다. 결대로 쓸어라.']]);
        break;
      case 'isol':
        add(['isol', '관찰해 보니 원소 반응은 *순서*가 핵심이더군요. 먼저 물들이고, 다른 노래로 치는 거지요.', { gesture: 'think' }],
          ['isol', '참고로 말씀드리자면, 울음탈의 구체는 마법으로 맞혀 지울 수 있습니다. 제가 몸으로 확인… 아닙니다.']);
        if (bells >= 2) add(['isol', '종이 하나 울릴 때마다 새소리가 늘어납니다. 세어 봤습니다. 한가해서가 아니라, 연구입니다.']);
        if (rain) add(['isol', '비 오는 날엔 잉크가 번집니다. 그래서 요샌 중요한 건 소리 내어 읽어 둡니다. 듣는 사람이 있으면 더 좋고요.']);
        if (post) add(['isol', '학술원에 논문을 보냈습니다. 제목은 「닻은 사람이다」. 반려되겠지요. 괜찮습니다. 여기선 다들 읽어 줬으니까요.', { expr: 'smile' }]);
        else if (f('name_isol')) add(['isol', '가설 18번을 세울 차례인데… 서두르지 않으렵니다. 17번을 좀 더 들여다보고 싶어서요.', { expr: 'tender' }]);
        if (fox) add([['isol', '정령님, 꼬리털 한 올만… 순수하게 연구 목적으로…', { gesture: 'bow' }], ['boreum', '한 올에 꿀빵 열 개니라.'], ['isol', '…연구비가.', { expr: 'sad' }]]);
        break;
      case 'danbi':
        add(['danbi', '아이고, 밥은 먹고 다니니? 자, 꿀빵 가져가. 하나는 가면서 먹고, 하나는 할머니 갖다 드려.', { expr: 'smile' }],
          ['danbi', '할머니는 좀 어떠시니? …그래. 자주 들러서 얼굴 보여 드려. 얼굴이 약이야.', { expr: 'tender' }]);
        if (f('name_danbi')) add(['danbi', '자, 꿀빵 두 개. 이젠 왜 두 개씩 싸는지 알고 주는 거야. 세하 몫까지 네가 먹어.', { expr: 'tender' }]);
        if (rain) add(['danbi', '비 오는 날은 반죽이 말을 안 들어. 그래도 구웠다. 식기 전에 먹고 가.']);
        if (night) add(['danbi', '이 시간까지 돌아다니니? 자, 오늘 남은 빵 가져가. 식었어도 꿀빵은 꿀빵이다.']);
        if (post) add(['danbi', '할머니가 어제 오셨어. 날 못 알아보시면서 "늘 먹던 걸로" 하시는 거 있지. 손은 다 기억하는 거야.', { expr: 'laugh' }]);
        if (fox) add([['danbi', '거기 여우 손님도 하나 들어. 꿀 듬뿍 발랐어.'], ['boreum', '여우가 아니… …듬뿍이라 했느냐.']]);
        break;
      case 'farmer':
        add(['farmer', '재나방 놈들은 등불만 켜면 몰려와. 불 한 방이면 우수수 떨어지긴 혀.']);
        if (post) add(['farmer', '올해 무는 달어. 종소리 듣고 큰 무라 그려. …웃지 말어, 먹어 보믄 알어.', { expr: 'laugh' }]);
        else if (bells >= 1) add(['farmer', '종이 우니께 밭이 조용혀. 무도 발 뻗고 자는 것 같어.', { expr: 'smile' }]);
        else add(['farmer', '무는 잘 들었는디, 밤마다 허깨비가 밭을 밟고 다녀. 무가 놀라서 바람 들겄어.', { expr: 'worried' }]);
        if (rain) add(['farmer', '비 오네. 무한테는 보약이여. 나한테는 신경통이고.']);
        break;
      case 'fisher':
        add(['fisher', '거울 호수는 비친 걸 오래 기억한대요. 그래서 전 낚시할 때 표정 관리해요.', { expr: 'smile' }]);
        if (has('frost')) add(['fisher', '호수에 얼음 띄우는 마법사가 있다던데… 혹시? 와! 근데 물고기 놀라니까 저쪽 가서 해 주세요!', { expr: 'surprised' }]);
        add(f('catSaved') ? ['fisher', '그 귤… 아니 고양이요, 요샌 제 고기 바구니 옆에 딱 붙어 있어요. 은혜를 생선으로 받겠대요.', { expr: 'laugh' }]
          : ['fisher', '저기 섬에 주황색 뭐가 있어요. 처음엔 큰 귤인 줄 알았는데, 귤은 안 울잖아요.', { gesture: 'think' }]);
        if (f('water_learn')) add(['fisher', '요새 호수에서 가끔 노랫소리가 나요. 무섭진 않아요. 물고기들도 가만히 듣더라고요.']);
        if (rain) add(['fisher', '비 오는 날이 입질은 제일 좋아요. 옷은 제일 안 마르고요.']);
        if (night) add(['fisher', '밤엔 별이 호수에 다 내려와요. 낚싯대를 던지면 별이 걸릴 것 같다니까요.']);
        break;
      case 'elder':
        if (post) add(['elder', '오십 년 만에 저쪽 수를 내가 대신 뒀어. …졌어. 내가 나한테. 허허.', { expr: 'laugh' }], ['elder', '에헴. 장기는 기다림의 놀이여. 오십 년 기다려 본 내가 알어.']);
        else if (f('m_choir')) add(['elder', '카엘이여, 카엘! 저쪽에 앉던 양반! 기사 주제에 수 무르자고 떼쓰던 양반이여!', { expr: 'laugh' }],
          ['elder', '이름이 나오니께 얼굴도 따라 나와. 장기는 참 못 뒀어, 그 양반. 그래도 끝까지 앉아 있었지.', { expr: 'tender' }]);
        else add(['elder', '에헴. 장기는 기다림의 놀이여. 요즘 젊은이들은 그걸 몰라.'],
          ['elder', '이 판은 오십 년째 저쪽 차례여. 누구랑 두던 건지는 까먹었는디… 판은 못 치우겄어.', { gesture: 'think' }],
          ['elder', '옛날에 파란 깃털 투구 쓴 기사가 살았는디… 이름이 뭐였더라. 에잉, 장이야!']);
        break;
      default: add(['villager', '좋은 날이네요.']);
    }
    if (id === 'danbi') G.player.heal(G.player.maxHp);
    // not the same thing twice in a row
    this.lastTalk ||= {};
    let i = Math.floor(rand() * L.length);
    if (L.length > 1 && i === this.lastTalk[id]) i = (i + 1) % L.length;
    this.lastTalk[id] = i;
    const e = L[i];
    return Array.isArray(e[0]) ? e : [e];
  }

  async tellNames(id) {
    const L = {
      bau: [['bau', '카엘…? 카엘이라… 어이구, 그려! 파란 깃털 투구! 코흘리개인 나한테 막대기로 창 쓰는 법 가르쳐 준 양반!', { expr: 'surprised', gesture: 'laugh' }], ['bau', '종 줄 당기는 법도 그 양반한테 배운 겨. "바우야, 종은 세게 치는 게 아니라 오래 치는 거다." …여태 그 말만 기억하고, 정작 말을 해 준 사람은 까맣게 잊고 있었구먼.', { expr: 'sad', gesture: 'handToChest' }]],
      danbi: [['danbi', '세하? 아이고, 세하! 꿀빵을 꼭 두 개씩 사 가던 애! 하나는 제 입에, 하나는 엄마 몫으로.', { expr: 'surprised' }], ['danbi', `${this.quests.q_memory ? '…내가 왜 너만 보면 두 개씩 쥐여 줬나 했더니.' : '…내가 왜 꿀빵을 꼭 두 개씩 짝지어 굽나 했더니.'} 손이 먼저 알고 있었네. 얘, 너 눈매가 그 애를 쏙 뺐다.`, { expr: 'tender', gesture: 'handToChest' }]],
      dodam: [['dodam', '카엘 기사님이랑 세하 누나요? 처음 들어요! …근데 이상해요. 처음 듣는데 아는 사람 같아요.', { expr: 'surprised' }], ['dodam', this.flag('catSaved') ? '제가 안 까먹게 매일 누룽지한테 얘기해 줄게요! 누룽지는 까먹어도 돼요. 제가 또 얘기해 주면 되니까요!' : '제가 안 까먹게 매일매일 소리 내서 불러 볼게요! 혹시 제가 까먹으면요, 마법사님이 또 알려 주면 되잖아요!', { expr: 'determined', gesture: 'nod' }]],
      isol: [['isol', '받아 적겠습니다. 카엘, 번개의 기사. 세하, 서리의 울림지기. 모라, 오십 년의 새벽을 노래한 사람.', { gesture: 'nod' }], ['isol', '기록은 사람보다 느리지만, 한 번 적어 두면 사람보다 오래 남는 법이지요. …가설 17번, 닻은 종이 아니라 사람이다. 채택이군요.', { expr: 'tender' }]],
    }[id];
    await this.conv(async () => {
      await this.say('narr', '카엘. 세하. 그리고 모라. 세 이름을 차례로 들려주었다.');
      for (const l of L) await this.say(l[0], l[1], l[2] || {});
    });
    this.set('name_' + id);
    this.inc('names');
    G.vfx.burst(this.npc(id).headPos(), 'soul', 20, { el: 'gold' });
    G.audio.play('seed', { m: THEME_NOTES[this.count('names') + 3] });
    if (this.namesUpd) this.namesUpd();
  }

  // ------------------------------------------------------------ side quests
  async catStart() {
    await this.conv(async () => {
      await this.say('dodam', '마법사님… 혹시 고양이 못 봤어요? 주황색이고요, 이름은 누룽지예요. 누룽지처럼 생겨서 누룽지예요.', { expr: 'worried' });
      await this.say('dodam', '어제 저녁에 나비 쫓아서 호수 쪽으로 갔는데 안 와요. 누룽지는 헤엄도 못 치는데…', { expr: 'sad' });
      const c = await this.choose(['내가 찾아볼게.', '고양이는 원래 잘 돌아와.']);
      if (c === 1) await this.say('dodam', '누룽지는 바보라서 못 돌아와요! …제발요.', { expr: 'worried', gesture: 'shake' });
      await this.say('dodam', '진짜요? 약속이에요! 새끼손가락 걸어요! …아 맞다. 마법사님 장갑.', { expr: 'laugh' });
    });
    this.quest('q_cat', '누룽지를 찾아서', '도담이의 고양이 누룽지가 나비를 쫓아 거울 호수 쪽으로 가서는 돌아오지 않았다. 주황색이고, 헤엄은 못 친다. 어부 소라는 호수 한가운데 섬에서 주황색 뭔가를 봤다고 한다.', 'side');
    this.obj('q_cat', '거울 호수에서 누룽지 찾기 — 울음소리에 귀 기울이기');
    this.cSay(G.player.unlocked.has('frost') ? '고양이가 섬에 있다면— 서리로 물 위에 얼음을 놓아 건너거라. 이 몸은 안 젖는다, 떠서 가니.' : '고양이가 섬에 있다면 헤엄을 쳐야겠구나. 이 몸은 안 젖는다, 떠서 가니.', 'cat_hint');
  }
  async pickCat() {
    await this.conv(async () => {
      G.audio.play('cat', { pos: this.cat.root.position });
      await this.say('narr', '누룽지는 한참 노려보더니, 제 발로 어깨에 올라탔다. 따뜻하고, 생각보다 무겁다.');
    });
    this.set('catCarried');
    G.player.carry = this.cat;
    this.cat.root.position.set(0.22, 1.62, -0.05);
    G.player.rig.p.torso.add(this.cat.root);
    this.cat.root.scale.setScalar(0.9);
    this.obj('q_cat', '누룽지를 도담에게 데려다주기', [{ x: this.npc('dodam').pos.x, z: this.npc('dodam').pos.z, h: 2 }]);
  }
  async deliverCat() {
    G.player.carry = null;
    G.player.rig.p.torso.remove(this.cat.root);
    G.scene.add(this.cat.root);
    this.cat.root.scale.setScalar(1);
    const d = this.npc('dodam');
    this.cat.root.position.set(d.pos.x + 1.2, G.world.h(d.pos.x + 1.2, d.pos.z), d.pos.z);
    await this.conv(async () => {
      await this.say('dodam', '누룽지!!! 어디 갔었어! 바보! 바보 고양이!', { expr: 'laugh' });
      await this.say('dodam', '…고마워요, 마법사님. 진짜진짜로요.', { expr: 'tender', gesture: 'bow' });
      await this.say('dodam', '이거 드릴게요. 제 보물 1호예요. 물수제비 열두 번 뜬 돌이요! 제 최고 기록이에요!', { expr: 'smile' });
    });
    this.set('catSaved');
    G.player.maxStamina += 20; G.player.stamina = G.player.maxStamina;
    G.player.addXP(40);
    this.done('q_cat', '도담의 행운 조약돌 — 최대 기력이 늘었다.');
    this.refreshBarks();
  }

  async danbiMemory() {
    await this.conv(async () => {
      await this.say('danbi', '아이고, 이게 누구야! 모라 할머니네 손주! 밥은 먹고 다니니? 얼굴이 반쪽이네, 반쪽.', { expr: 'surprised', gesture: 'wave' });
      await this.say('danbi', this.flag('name_danbi') ? '자, 꿀빵 두 개 가져가. 하나는 가면서 먹고, 하나는 세하 몫이니… 그것도 네가 먹어.' : '자, 꿀빵 두 개 가져가. 하나는 가면서 먹고, 하나는… 어머, 나 좀 봐. 왜 자꾸 두 개씩 싸지.', { expr: 'smile' });
      await this.say('danbi', '할머니가 요샌 통 안 오셔. 새벽 종 치기도 전에 제일 먼저 오시던 양반이.', { expr: 'worried' });
      await this.say('danbi', '참, 이거 가져가렴. 할머니가 오래전에 맡겨 두신 스케치북이야. 젊을 적에 골짜기 풍경을 그리셨대.', { gesture: 'handToChest' });
      await this.say('danbi', '소중한 물건들을 그림 속 자리에 하나씩 두고 오셨다더라. "안 잊으려고 일부러 두고 왔지" 하고 웃으시는데, 무슨 뜻인지 원.', { gesture: 'shrug' });
      await this.say('danbi', '그림을 그린 그 자리에 직접 가서 같은 곳을 바라봐 보렴. 할머니가 두고 온 게 보일지 누가 아니.');
      await this.say('danbi', '뭐라도 찾거든 할머니께 갖다 드리고. 기억이란 게, 손에 쥐여 주면 돌아오기도 하거든.', { expr: 'tender' });
    });
    G.player.heal(G.player.maxHp);
    this.set('sketchbook');
    G.hud.banner('모라의 스케치북', '젊은 모라가 그린 골짜기', `그림 속 자리에 서서 같은 곳을 바라보자<br><small>${KBD('J')} 여정 → 기억에서 볼 수 있다</small>`, '#c9a8ff', 5200);
    this.startMemoryQuest();
  }
  startMemoryQuest() {
    if (this.quests.q_memory) return;
    this.quest('q_memory', '모라의 기억', '할머니는 젊은 날 소중한 것들을 골짜기 곳곳에 두고 왔다고 한다. 안 잊으려고, 일부러. 스케치북 속 그 자리에 서서 같은 곳을 바라보면 두고 온 것이 보일지도 모른다. 찾으면 할머니 손에 쥐여 드리자.', 'side');
    this.updateMemoryObj();
  }
  updateMemoryObj() {
    const n = Object.values(this.memories).filter((v) => v === 'given').length;
    const have = Object.values(this.memories).filter((v) => v === 'have').length;
    const sk = G.sketches && this.flag('sketchbook') ? ` · 스케치 ${G.sketches.count()}/6` : '';
    this.obj('q_memory', have ? `할머니께 기억의 물건 전하기 (${have}개 가지고 있음)` : `스케치 속 자리 찾기 (물건 ${n}/4 전함${sk})`, have ? [{ x: -20, z: 132, h: 2.4 }] : []);
  }
  takeMemory(m) {
    m.taken = true; m.g.visible = false;
    this.memories[m.id] = 'have'; this.dirty = true;
    G.skills.gain(1, '모라의 기억을 찾았다');
    G.audio.play('pickup'); G.audio.play('echo', { pos: m.pos });
    G.vfx.burst(m.pos, 'soul', 30, { el: 'arcane' });
    G.hud.banner('모라의 기억', m.name, m.desc, '#c9a8ff');
    this.startMemoryQuest();
    this.updateMemoryObj();
    this.cSay('킁. …할멈의 그리운 냄새가 밴 물건이로구나. 오래도 기다렸겠다. 할멈에게 가져다주거라.', 'mem_found');
  }
  async deliverMemories() {
    const ids = Object.keys(this.memories).filter((k) => this.memories[k] === 'have');
    G.game.musicOverride = 'memory';
    if (this.chapter === 'mora' || this.chapter === 'post') await this.conv(async () => {
      await this.say('narr', '물건을 손에 쥐여 드리자, 할머니의 눈이 잠깐 또렷해진다.');
    });
    for (const id of ids) {
      await this.conv(async () => {
        if ( id === 'hairpin' ) {
          await this.say('mora', '이건… 어머나, 은방울꽃 핀이구나! 세하가 열 살 때 호수에 빠뜨리고선 서럽게 울고불고하던 거란다.', { expr: 'surprised' });
          await this.say('mora', '어찌나 울던지, 이 할미가 치마 걷고 호수를 다 뒤졌지. 끝내 못 찾았는데… 네가 찾아왔구나.', { expr: 'smile' });
          await this.say('mora', '그 애가 울다 지쳐서 그러더라. "엄마, 괜찮아. 핀은 잃어버려도, 예뻤던 건 안 잃어버리잖아."', { expr: 'tender' });
          await this.say('mora', '…그 애는 가끔 나보다 어른 같았어.', { expr: 'sad' });
        } else if (id === 'book') {
          await this.say('mora', '노을 들판 그 나무 아래서… 이 책에 꽃을 눌러 넣던 사람이 있었지.', { expr: 'tender' });
          if (this.memories.badge === 'given') await this.say('mora', '첫 장의 이름은 번졌지만… 괜찮다, 이젠 안단다. 카엘이었지. 아까 본 휘장 덕분에 이 책 주인도 다시 기억해 냈구나.', { expr: 'smile' });
          else await this.say('mora', '이름이… 분명 있었는데. 첫 장에 적어 뒀는데, 번져 버렸구나.', { expr: 'worried' });
          await this.say('mora', '우스운 사람이었어. 기사 주제에 꽃 이름은 나보다 잘 알았지. "모라, 이건 물망초야. 나를 잊지 말라는 뜻이래."', { expr: 'smile' });
          await this.say('mora', '…그래 놓고선, 자기가 먼저 사람들 기억에서 사라져 버렸지.', { expr: 'sad', gesture: 'sigh' });
        } else if (id === 'musicbox') {
          await this.say('mora', '이 오르골은… 세하가 서리봉에 오르던 날 품에 넣고 간 거란다.');
          await this.say('mora', '그 애는 안 돌아왔어. 너를 내 품에 안겨 놓고, "금방 올게, 엄마" 하고는.', { expr: 'sad' });
          await this.say('mora', '떠나기 전날 밤에 그 애가 묻더구나. "엄마가 이 노래를 잊으면 어떡해?"');
          await this.say('mora', '그래서 일러 줬지. *"노래는 한 사람만 기억하는 게 아니란다."*', { expr: 'tender' });
          if (this.flag('m_talk')) await this.say('mora', '…요전에 너한테도 이 말을 했지? 후후. 이번엔 이 할미가 안 잊었구나.', { expr: 'smile' });
          else await this.say('mora', '…그 말을 한 게 나였는데. 정작 나는 혼자 기억하려고만 들었구나.', { expr: 'sad' });
        } else if (id === 'badge') {
          await this.say('mora', '…카엘.', { expr: 'surprised' });
          await this.say('mora', '카엘. 그래, 그 이름이야. 어떻게 이걸 잊니. 오십 년을 새벽마다 부르던 이름을.', { gesture: 'handToChest' });
          await this.say('mora', '뒤에 뭐라고 긁어 놨니? …"내가 잊혀도, 너는 노래해."');
          await this.say('mora', '참 바보 같은 사람이지. 끝까지 멋있는 척은 혼자 다 하고.', { expr: 'laugh' });
        }
      });
      this.memories[id] = 'given'; this.dirty = true;
      G.player.addXP(35);
    }
    G.game.musicOverride = null;
    const n = Object.values(this.memories).filter((v) => v === 'given').length;
    if (n >= 4 && !this.flag('memDone')) {
      this.set('memDone');
      await this.conv(async () => {
        await this.say('mora', '얘야. 오늘은 이상하게 머리가 맑구나. 네가 주워다 준 것들 덕이겠지.', { expr: 'smile' });
        await this.say('mora', '이건 네가 갖고 있으렴. 할미가 또 잊어버리거든, 그때 다시 보여 주면 되잖니. …그러면 되는 거야.', { expr: 'tender', gesture: 'nod' });
        if (!G.player.hasHat) await this.say('mora', '그리고 이 모자도. 할미가 젊을 적에 쓰던 거란다. 이제 네 차례야.', { expr: 'smile' });
      });
      if (!G.player.hasHat) { G.player.setHat(true); this.set('hat'); }
      G.player.maxMana += 30; G.player.mana = G.player.maxMana;
      this.done('q_memory', '모라의 모자 · 최대 마나가 크게 늘었다.');
    } else this.updateMemoryObj();
  }

  onBounty(n) {
    if (this.flag('bounty' + n)) return;
    this.set('bounty' + n);
    this.inc('bountyNew');
    G.skills.gain(1, '이름 붙은 것을 쓰러뜨렸다');
    G.hud.toast(`이름 붙은 것을 쓰러뜨렸다 — 이솔에게 알려 주자`);
    this.updateBounty();
  }
  updateBounty() {
    const done = [1, 2, 3].filter((i) => this.flag('bounty' + i)).length;
    if (!this.quests.q_bounty) return;
    const names = ['뿌리 삼킨 돌무덤 (속삭이는 숲)', '세 자매 울음탈 (동쪽 벼랑)', '눈먼 파수꾼 (북쪽 설원)'];
    const pts = [[-118, 150], [156, 30], [40, -150]];
    this.obj('q_bounty', names.map((t, i) => `${this.flag('bounty' + (i + 1)) ? '✓' : '·'} ${t}`).join('<br>') + (this.count('bountyNew') ? '<br>▸ 이솔에게 보고하기' : ''), this.count('bountyNew') ? [{ x: 18, z: 26.5, h: 2.6 }] : pts.filter((_, i) => !this.flag('bounty' + (i + 1))).map(([x, z]) => ({ x, z, h: 4 })));
    if (done >= 3 && !this.count('bountyNew')) this.done('q_bounty', '이솔의 연구 노트를 받았다.');
  }
  async bountyReport() {
    const n = this.count('bountyNew');
    const all = [1, 2, 3].every((i) => this.flag('bounty' + i));
    await this.conv(async () => {
      await this.say('isol', '정말입니까? 이름 붙은 개체를…! 잠시만요, 펜이. 펜이 어디…', { expr: 'surprised', gesture: 'lookAround' });
      await this.say('isol', '흥미롭군요. 강한 개체일수록 이름이 있습니다. 누군가 그것을 기억한다는 뜻이지요. 두려움으로라도.', { gesture: 'think' });
      await this.say('isol', '모든 걸 지우는 고요 속에서 이름만큼은 남아 형체를 붙들고 있다니, 참 묘한 일입니다.', { expr: 'tender' });
      if (all) await this.say('isol', '이걸로 셋 다군요. 제 노트 사본을 드리겠습니다. 읽는 사람이 둘이면, 이 기록도 두 배는 오래 갈 테니까요.', { expr: 'smile', gesture: 'bow' });
      else await this.say('isol', '약소하지만 연구비에서 떼어 드리는 사례입니다. …네, 떼어 낼 연구비가 남아 있었다는 게 저도 놀랍습니다.', { gesture: 'shrug' });
    });
    G.player.addXP(80 * n);
    this.counters.bountyNew = 0; this.dirty = true;
    this.updateBounty();
  }

  // ------------------------------------------------------------ side: the lake's song (water)
  lakeSpot() {
    if (this._lake) return this._lake;
    const L = POI.lake;
    for (let r = 30; r < 60; r += 0.5) {
      const x = L.x + r * 0.97, z = L.z - r * 0.24;
      if (G.world.h(x, z) > 0.45) { this._lake = { x, z, wx: L.x + (r - 3.5) * 0.97, wz: L.z - (r - 3.5) * 0.24 }; return this._lake; }
    }
    this._lake = { x: -40, z: 52, wx: -44, wz: 53 };
    return this._lake;
  }
  async lakeSong() {
    if (this.flag('water_learn') || G.player.unlocked.has('water')) return;
    await this.wait(() => this.flag('worldOpen') && G.mode === 'free');
    const spot = this.lakeSpot();
    if (!this.quests.q_lake) {
      await this.sleep(this.flag('v_wind') && !this.flag('frostBell') && !this.flag('stormBell') ? 40 : 4);
      await this.wait(() => G.mode === 'free');
      this.cSay('…쉿. 거울 호수 쪽이다. 귀에 익은 노래가 실려 오는구나. 가 보지 않겠느냐?', null, 6);
      this.quest('q_lake', '거울 호수의 메아리', '보름이 거울 호수 쪽에서 귀에 익은 노래를 들었다고 한다. 누구의 노래인지는 말해 주지 않았다. 호숫가에 가서 귀를 기울여 보자.', 'side');
    }
    this.obj('q_lake', '거울 호숫가에서 귀 기울이기', [{ x: spot.x, z: spot.z, h: 2.6 }]);
    await this.wait(() => this.near(spot.x, spot.z, 7) && G.mode === 'free' && !G.enemies.inCombat());
    await this.lakeScene(spot);
  }
  async lakeScene(spot) {
    const W = G.world;
    const rig = makeGhost(makeHumanoid(CHAR.seha), 0xa8d8ff, 0.8);
    rig.root.scale.setScalar(0.72);
    const face = Math.atan2(spot.wx - spot.x, spot.wz - spot.z);
    const ghost = G.npcs.add(new NPC('seha', 'seha', spot.wx, spot.wz, face + Math.PI, { rig, float: Math.max(0, 0.05 - W.h(spot.wx, spot.wz)), headH: 1.3 }));
    G.audio.play('echo', { pos: ghost.root.position });
    G.vfx.burst(ghost.headPos(), 'soul', 30, { el: 'water' });
    for (let i = 0; i < 3; i++) G.vfx.ring(V(spot.wx, 0.08, spot.wz), PAL.water.core, 4 + i * 3, 1.6 + i * 0.4, { thick: 0.06 });
    await this.conv(async () => {
      G.cameraRig.setCine(V(spot.x + (spot.x - spot.wx) * 0.9 + 2.5, W.h(spot.x, spot.z) + 2.4, spot.z + (spot.z - spot.wz) * 0.9 + 2), V(spot.wx, 1.1, spot.wz));
      await this.say('boreum', '…수면을 보거라. 호수가 뭔가를 되비추고 있다.', { cam: false });
      await this.say('narr', '잔잔한 물 위에 어린 소녀가 비친다. 물가에 쪼그려 앉아, 물을 떠 올렸다 흘려보내며 흥얼거린다.', { cam: false });
      await this.say('seha', '엄마, 봐 봐! 물은 불러 주는 대로 모양이 바뀌어. 내가 웃으면 웃고, 찡그리면 같이 찡그려.', { expr: 'laugh', name: '어린 세하의 메아리' });
      await this.say('seha', '물이 차가워지면 서리가 되고, 뜨거워지면 김이 되잖아. 그러니까 물의 노래를 알면 다른 노래들이랑도 친해질 수 있대!', { expr: 'smile', name: '어린 세하의 메아리' });
      await this.say('seha', '엄마 노래는 너무 뜨거워. 난 이 물의 노래가 좋아. 시원하고, 조금 슬프고… 물에 비친 걸 오래오래 기억해 주거든.', { expr: 'tender', name: '어린 세하의 메아리' });
      await this.say('boreum', '세하 그 꼬맹이, 어릴 적엔 여기서 살다시피 했지. 호수는 비친 걸 오래 기억한다더니… 네게 되비춰 주는구나.');
      const c = await this.choose(['(수면에 손을 담근다)', '(메아리를 따라 흥얼거린다)']);
      if (c === 0) await this.say('narr', '차가운 물이 손가락 사이로 스민다. 물결이 번지고, 소녀의 모습이 천천히 흐려진다.');
      else await this.say('narr', '조금 틀린 음으로 따라 부르자, 소녀가 고개를 들고 이쪽을 보며 웃은 것 같았다.');
      await this.say('seha', '…헤헤. 틀렸다. 그래도 좋다.', { expr: 'laugh', name: '어린 세하의 메아리' });
    });
    G.vfx.burst(ghost.headPos(), 'soul', 40, { el: 'water' });
    G.scene.remove(ghost.root);
    G.npcs.list.splice(G.npcs.list.indexOf(ghost), 1); delete G.npcs.map.seha;
    await this.unlockElement('water', '맑게 흐르는 노래. 적을 흠뻑 적시고 불을 재운다. 젖은 적은 다른 노래에 크게 반응한다.');
    this.set('water_learn');
    const rn = (id) => REACTIONS[id].name, has = (el) => G.player.unlocked.has(el);
    // only pair water with songs the player already has
    const pairs = [has('storm') && `젖은 적에게 [번개] → <b>${rn('conduct')}</b>와 감전 지속 피해`, has('frost') && `젖은 적에게 [서리] → <b>${rn('flashfreeze')}</b>`].filter(Boolean);
    this.hint(`${KBD('6')} 물 · ${pairs.length ? pairs.join(' · ') : '적을 적신다 — 젖은 적은 뒤이은 노래에 크게 반응한다'}<br><small>불타는 적에게 물을 끼얹으면 <b>${rn('extinguish')}</b> — 불은 꺼지지만 피해가 절반으로 준다</small>`, 12);
    this.done('q_lake', '물의 노래를 얻었다.');
    await this.sleep(1.5);
    this.cSay(`물의 노래라… 그 꼬맹이, 별걸 다 두고 갔구나. 울림 나무(K)에 물의 갈래가 돋았을 게다.${G.skills.has(SIG.water) ? '' : ` 뿌리의 ${EM(HEAVY.water.name)}부터 익혀 보거라.`}`, null, 7);
  }

  async readGrave() {
    await this.conv(async () => {
      await this.say('sign', '이름 없는 비석. 그 앞에 들꽃이 놓여 있다. 시든 것 위에 새것, 그 위에 또 새것.');
      if (this.chapter === 'post' || this.flag('m_choir')) await this.say('sign', '비석 아래쪽에 서툰 글씨가 새로 새겨져 있다. *"세하. 카엘. 안 까먹을게요."* …도담이 글씨다.');
      else if (this.flag('f_echo')) await this.say('sign', '…세하를 위한 비석이었을까. 이름을 새기지 않은 건, 돌아올 거라 믿어서였을까.');
    });
  }

  // ------------------------------------------------------------ elements, seeds
  async unlockElement(el, desc) {
    G.player.unlock(el);
    G.audio.play('unlock');
    G.vfx.burst(G.player.center(), 'soul', 50, { el });
    G.vfx.ring(G.player.pos, PAL[el].core, 6, 1, { thick: 0.2 });
    G.vfx.circle(G.player.pos, PAL[el].glow, 3, 2, { spin: 2 });
    // signature spells are techniques now: say where to learn this one (the prologue fireball is granted by Mora)
    const K = G.skills, sig = SIG[el];
    let learn = '';
    if (K && sig && !K.has(sig) && !(el === 'fire' && !this.flag('p_heavy'))) {
      learn = K.points >= 1
        ? `<br><small>고유 마법 <b>${HEAVY[el].name}</b> — 지금 ${KBD('K')} 울림 나무에서 바로 익힐 수 있다 (울림점 1)</small>`
        : `<br><small>고유 마법 <b>${HEAVY[el].name}</b> — 다음 레벨업의 <b>울림의 갈림길</b>이나 ${KBD('K')} 울림 나무에서 익힐 수 있다</small>`;
    }
    G.hud.banner('새로운 노래', `${EL_INFO[el].name}의 노래`, desc + `<br><small>${ELEMENTS.indexOf(el) + 1}번 키로 선택</small>` + learn, EL_INFO[el].css, learn ? 5600 : 4500);
    await this.sleep(0.5);
  }

  takeSeed(s) {
    s.taken = true; s.g.visible = false;
    this.seeds.add(s.i); this.dirty = true;
    const n = this.seeds.size;
    G.audio.play('seed', { m: THEME_NOTES[(n - 1) % THEME_NOTES.length] });
    G.vfx.burst(s.orb.getWorldPosition(new THREE.Vector3()), 'soul', 30, { el: 'heal' });
    G.vfx.ring(new THREE.Vector3(s.x, s.y, s.z), PAL.heal.core, 3, 0.6);
    G.hud.toast(`노래 씨앗 <b>${n} / 16</b>`);
    if (n % 4 === 0) {
      const k = n / 4;
      G.skills.gain(1, '노래 씨앗 넷이 울렸다');
      const P = G.player;
      const kind = ['heart', 'stamina', 'mana', 'heart'][k - 1];
      if (kind === 'heart') P.maxHp += 4; else if (kind === 'stamina') P.maxStamina += 25; else P.maxMana += 25;
      P.hp = P.maxHp; P.mana = P.maxMana; P.stamina = P.maxStamina;
      G.hud.updateHearts();
      G.audio.play('levelup');
      G.hud.banner('노래 씨앗', '울림이 깊어졌다', kind === 'heart' ? '최대 체력이 한 칸 늘었다.' : kind === 'stamina' ? '기력이 늘었다.' : '마나가 늘었다.', '#9fffb0', 3800, { minor: true });
    } else if (n === 1) this.cSay('오호, 노래 씨앗이로구나. 잊힌 노래가 맺힌 작은 씨앗이지. 넷을 모으면 네 울림이 깊어진다. 소리가 나니 귀로 찾거라.', 'seed1', 7);
  }

  // ------------------------------------------------------------ hooks
  onKill(e) { this.inc('kills'); if (e.elite && this.once('elite1')) this.cSay('이름 붙은 놈을 눕혔구나. …누가 저걸 그리 오래 기억했을꼬.'); }
  onCast(kind, el) {
    if (kind === 'heavy' && el === 'fire') this.heavyFireT = G.time;
    if (kind === 'weave' && this.once('weave1')) this.cSay('오호, 두 노래를 한 숨에 엮었구나! 할멈은 그거 익히는 데 삼 년 걸렸느니라. …이 말은 비밀이다.');
    if (kind === 'ult' && this.once('ult1')) this.cSay('…허. 털이 다 섰다. 방금 그건 이 몸도 처음 보는구나.');
  }
  // Borum names each reaction the first time it happens (names come from combat.js)
  onReaction(r) {
    const L = {
      melt: () => `얼음이 불을 만났으니 버틸 재간이 있나. ${RX('melt', '이다')}. 녹은 놈은 젖기까지 하느니라.`,
      evaporate: () => `젖은 놈을 불로 지졌구나. ${RX('evaporate', '이다')}. 김이 걷히기 전에 한 대 더 먹이거라.`,
      shatter: () => `와장창! 속이 다 시원하구나. 언 것은 세게 치면 깨진다. ${RX('shatter')}니라.`,
      conduct: () => `젖은 놈들한테 번개라니, 짓궂기는. ${RX('conduct', '이다')}. 젖은 놈은 죄다 같이 떤다.`,
      overload: () => `불붙은 놈한테 번개를 꽂았으니 크게 터지지. ${RX('overload', '이다')}! …귀가 다 먹먹하구나.`,
      firestorm: () => `바람이 불을 옆 놈한테 옮겼다. ${RX('firestorm', '이다')}. 이 몸의 바람, 쓸 만하지 않으냐?`,
      thermal: () => `뜨겁게 달궈 놓고 단숨에 얼렸구나! ${RX('thermal', '이다')}. 달아오른 쇠도 찬물을 만나면 갈라지는 법이지.`,
      flashfreeze: () => `젖은 건 눈 깜짝할 새 언다. ${RX('flashfreeze', '이다')}! 겨울에 빨래 널어 본 놈은 다 아는 이치지.`,
      blizzard: () => `한기를 바람에 태웠구나. ${RX('blizzard', '이다')}. 둘레 놈들까지 이가 딱딱 부딪칠 게야.`,
      stormspread: () => `찌릿한 걸 바람에 실어 날랐구나. ${RX('stormspread', '이다')}. 옆에 선 죄로 다 같이 떤다.`,
      extinguish: () => `아이고, 불타는 놈한테 물을 끼얹어 불만 꺼 줬구나. ${RX('extinguish', '이다')}. 물은 ${G.player.unlocked.has('storm') || G.player.unlocked.has('frost') ? '번개나 서리와' : '다른 노래와'} 함께 쓰거라.`,
      scald: () => `물과 불이 만나 뜨거운 김이 터졌구나! ${RX('scald', '이다')}. …이 몸의 꼬리까지 눅눅해졌느니라.`,
      shortcircuit: () => `찌릿한 놈한테 물을 끼얹었구나. ${RX('shortcircuit', '이다')}. 전기가 물길 따라 온몸을 돈다.`,
      superconduct: () => `한기 서린 몸엔 번개가 막힘없이 흐르지. ${RX('superconduct', '이다')}! 갑옷이고 뭐고 소용없다.`,
      monsoon: () => `젖은 놈한테 바람을 불어 물보라를 날렸구나. ${RX('monsoon', '이다')}. 옆에 선 놈들까지 다 젖었다.`,
      resonance: () => `물든 놈을 비전으로 쳤구나. ${RX('resonance', '이다')}. 품고 있던 힘이 한 번 더 터져 나오는 법이지.`,
    };
    // (kept for when Borum is there to say it: a reaction can happen before he joins)
    if (L[r] && G.companion && G.companion.active && this.once('react_' + r)) this.cSay(L[r]());
  }
  onBossPhase(b, n) {
    const shadow = { headPos: () => b.center().add(V(0, 1.5, 0)), speaker: 'kaelShadow' };
    if (b.type === 'bruteFrost') {
      if (n === 2) this.cSay('한기를 뿜는다! 발밑이 하얘지거든 얼른 빠져나오거라!');
      if (n === 3) this.cSay('고리가 두 겹이다! 첫 고리 피했다고 마음 놓지 마라. 돌진 뒤엔 곧장 내려찍는다!');
    }
    if (b.type === 'knight' && n === 2) { G.hud.bark(shadow, '모… 라…'); this.cSay('…방금 저놈이 뭐라 했느냐. —번개가 떨어진다! 발밑을 보거라!'); }
    if (b.type === 'knight' && n === 3) { G.hud.bark(shadow, '…문을… 붙들어야…'); this.cSay('이젠 네 번 연달아 벤다! 마지막 베기까지 보고 움직여라!'); }
    if (b.type === 'heart') {
      const S = this.npc('seha'), K = this.npc('kael');
      if (n === 2) { if (S) G.hud.bark(S, '{n:아}, 숨 쉬어! 우리도 같이 부르고 있어!'); this.cSay('허깨비를 부른다! 한눈팔지 말고 결계부터 깨라!'); }
      if (n === 3) {
        if (K) G.hud.bark(K, '광선이다! 뛰어넘어라!');
        // the Hush speaks from the heart itself, not in Borum's line
        G.hud.bark({ headPos: () => b.core.position.clone().add(V(0, 2.5, 0)), speaker: 'hush' }, '…잊는 건… 아프지 않아… 조용해질 뿐이야… 너도 쉬고 싶지 않니…');
        setTimeout(() => this.cSay('귀 기울이지 마라, 꼬마! 혼자 추워서 네 발목을 잡으려는 소리다!'), 5200);
      }
    }
  }
  // a boss's break meter filled (see BREAK in enemies.js)
  onBossBreak(b) {
    if (this.once('break1')) this.cSay('놈의 자세가 무너졌다! 지금이다— 가진 힘을 있는 대로 쏟아부어라!');
    else if (Math.random() < 0.4) this.cSay(pick(['또 주저앉았다! 몰아쳐라!', '옳지! 노래를 섞으니 배겨 내질 못하는구나!', '무릎 꿇었다— 지금이다, 꼬마!']));
    void b;
  }
  onHeartExposed() { const S = this.npc('seha'); if (S && this.once('exposed1')) G.hud.bark(S, '지금이야! 아끼지 마!'); else this.cSay('심장이 드러났다! 쏟아부어라!'); }

  regionComment(id) {
    const L = {
      village: '마을이다. 빵 굽는 냄새가… 흠흠. 정령은 배 안 고프다.',
      tower: '할멈의 언덕이다. …창에 불이 켜졌는지부터 보게 되는구나.',
      lake: '거울 호수다. 물이 이리 맑으면 꼬리 비춰 보기에 좋지. …뭘 보느냐. 정령도 몸단장은 한다.',
      woods: '속삭이는 숲이다. 재나방이 끓는 데지. 불 하나면 우수수 떨어지니, 손에 불 쥐고 가거라.',
      meadow: '노을 들판이다. 할멈이 젊어서 뻔질나게 드나들던 데지. 누구랑 왔는지는… 이 몸 입으론 말 못 한다.',
      bluffs: this.flag('glide') ? '벼랑 끝이다. 골짜기가 한눈에 드는구나. 떨어지거든 당황 말고 바람을 타거라.' : '벼랑 끝이다. 골짜기가 한눈에 드는구나. 발밑은 네가 챙겨라. 이 몸은 날 줄 아니.',
      rift: '……꼬리털이 선다. 여기선 바람조차 숨을 죽이고 지나간다.',
      frostpass: '눈이다, 눈. 춥냐고? 이 몸은 털이 있다. 걱정은 네 발밑에나 하거라.',
    };
    if (L[id]) this.cSay(L[id], 'reg_' + id);
  }

  // Borum's idle remarks: what he notices right now comes first, the rest is his small talk.
  companionChatter() {
    const P = G.player.pos;
    const reg = regionAt(P.x, P.z).id;
    const post = this.chapter === 'post';
    if (G.player.hp <= 4) return '숨이 가쁘구나. 등석에서 쉬어 가거라. 용감한 것과 무모한 것은 한 끗 차이니라.';
    if (reg === 'rift' && !post) return '…소리가 없구나, 여긴. 오래 머물 데가 못 된다.';
    if (!this.flag('worldOpen')) return null;
    const pool = [
      '바람이 좋구나. 이런 날엔 가만히 있어도 바람이 꼬리털을 다 빗어 주지.',
      '하늬바람은 서쪽에서 분다. 그래서 여기가 하늬 골짜기인 게야. …몰랐다는 얼굴이로구나.',
      '배가 고프… 아니다. 정령은 배가 안 고프다. 빵집 굴뚝 쪽은 그냥 본 게다.',
      '할멈은 젊어서 성미가 불같았느니라. 지금은 불씨 같지. 꺼진 줄 알고 만지면 덴다.',
      '가끔은 걸음을 멈추고 귀를 기울여 보거라. 노래 씨앗은 눈보다 소리로 찾는 게 빠르니라.',
      '그리 앞만 보고 뛰지 말고 주위 경치도 좀 둘러보거라. 이만하면 볼만한 골짜기 아니냐.',
      '종에 묶여 오십 년이다. 심심했냐고? …종 속은 낮잠 자기에 그만이니라.',
    ];
    const bells = this.bellsRung(), W = G.world.weather;
    if (G.world.sky.night > 0.5) pool.push('밤하늘 좀 보거라. 저 별들도 누가 기억해 주니 빛나는 게야.', '반딧불이는 잊힌 이들의 작은 노래라더구나. 믿거나 말거나.');
    if (W && W.rain > 0.3) pool.push(G.player.unlocked.has('storm') ? '비다. 이 몸은 젖는 게 질색이니라. …번개를 부리기엔 좋은 날이다만.' : '비다. 이 몸은 젖는 게 질색이니라. 젖은 풀엔 불도 잘 안 붙으니 알아 두거라.');
    if (post) pool.push('할멈은 오늘도 흥얼대더구나. 가사는 잊어도 가락은 남는 법이지.', '요샌 새벽이 바쁘다. 할멈 창을 두드려야 하거든. …꼬리로 말이다.');
    else if (bells >= 2) pool.push('새소리가 늘었구나. 종 하나 깨울 때마다 골짜기가 뭔가를 하나씩 떠올리는 게야.');
    else pool.push('골짜기 빛깔이 물 빠진 천 같구나. 종이 다 울던 시절엔 이렇지 않았느니라.');
    return pick(pool);
  }
}
