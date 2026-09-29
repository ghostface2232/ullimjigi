// Story director: chapters, quests, dialogue and world events.
// Each chapter is an async script that resumes from saved flags.
import * as THREE from 'three';
import { G, EL_INFO } from '../core/context.js';
import { NPC, makeCat, makeGhost } from './npcs.js';
import { makeHumanoid, CHAR } from './characters.js';
import { POI, regionAt } from '../world/layout.js';
import { MEMORIES } from '../world/world.js';
import { THEME_NOTES } from '../core/music.js';
import { PAL } from '../render/vfx.js';
import { pick, randRange, rand, fillName, clamp, lerp } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const GV = (x, dy, z) => new THREE.Vector3(x, G.world.h(x, z) + dy, z); // ground-relative
const KBD = (k) => `<kbd>${k}</kbd>`;

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
  set(k, v = true) { this.flags[k] = v; }
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
      G.hud.banner(type === 'main' ? '새로운 이야기' : '곁가지 이야기', title, '', type === 'main' ? '#f1d48a' : '#bfe8ff', 2800);
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
    q.state = 'done'; q.obj = ''; q.markers = [];
    G.audio.play('quest_done');
    G.hud.banner('여정 완료', q.title, reward || '', '#f1d48a', 3000);
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
    G.world.col.addBox(19.3, 25.2, 0.85, 0.5, -0.6, -10, 30);
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
    const B = (id, arr) => { const n = this.npc(id); if (n) n.barks = arr; };
    const ch = this.chapter;
    if (ch === 'prologue') {
      B('mora', ['천천히 해도 된단다.', '후후, 발이 가볍구나.']);
    } else if (ch === 'post') {
      B('mora', ['라— 라라…', '바람이 좋네요.', '누가 종을 치나 봐요. 듣기 좋아라.']);
    } else B('mora', ch === 'mora' ? ['…세하야, 추운데 어디 가니.', '라라… 이 다음이 뭐였더라.'] : ['조심해서 다니거라.', '…종소리가 좋구나.', '할미는 여기서 기다리마.']);
    B('bau', ch === 'village' && !this.flag('v_defend') ? ['종이 안 울어… 쇠가 입을 다물었어.', '이놈의 종, 사십 년 동안 한 번도 이런 적 없었는디.'] : ['종은 세게 치는 게 아니라 오래 치는 겨.', '오늘도 종이 잘 울었구먼.', '허리가 쑤시는 거 보니 비 오겄네.']);
    B('dodam', ['누룽지야~! 어디 있어~!', '마법사님 멋있다아…', '저도 크면 울림지기 될 거예요!']);
    if (this.flag('catSaved')) B('dodam', ['누룽지가 요즘 저만 따라다녀요!', '마법사님! 오늘은 뭐 물리치러 가요?', '저 물수제비 열세 번 떴어요! 진짜로요!']);
    B('isol', ['흥미롭군… 아주 흥미로워.', '가설 17번도 기각인가…', '잉크가 또 떨어졌군.']);
    B('danbi', ['꿀빵 나왔어요~ 따끈따끈한 꿀빵!', '아이고 허리야.', '밥은 먹고 다니는 거지?']);
    B('farmer', ['올해 무는 잘 들었는디… 잿빛 것들이 밭을 밟고 다녀.', '에잉, 두더지 녀석들.']);
    B('fisher', ['오늘은 입질이 좋네요~', '호수 한가운데 섬에 뭔가 있던데… 고양이 같았어요.']);
    B('elder', ['장이야!', '에헴, 요즘 젊은이들은 장기를 몰라.', '멍군이다, 멍군!']);
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
    this.setupNPCs();
    G.world.sky.hush = this.hushBase;
    // restore lantern states handled by game
    this.run().catch((e) => console.error('story', e));
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
  setChapter(c) { this.chapter = c; this.positionNPCs(); this.refreshBarks(); G.game.save(true); }

  update(dt) {
    if (this.dead) return;
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
    // seeds
    for (const s of G.world.seeds) {
      if (s.taken) continue;
      if (this.seeds.has(s.i)) { s.taken = true; s.g.visible = false; continue; }
      if (Math.hypot(P.pos.x - s.x, P.pos.z - s.z) < 1.4 && Math.abs(P.pos.y - s.y) < 2.5) this.takeSeed(s);
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
    if (!P.grounded && P.vel.y < -6 && this.once('hint_glide') && this.flag('p_fire')) this.hint(`공중에서 ${KBD('Space')} 누르고 있기: 활공 — 기력을 소모합니다`, 5);
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
        await this.say('mora', '…세하야, 일어났니? 벌써 해가 등성이를 넘었구나.');
        await this.say('mora', '…아니지. 아니야. {n:아}. 이 할미 정신 좀 보렴. 네 어미 이름이 왜 자꾸 입에 붙는지.');
        const c = await this.choose(['괜찮아요, 할머니.', '…엄마 얘기 해 주세요.']);
        if (c === 0) await this.say('mora', '그래, 그래. 넌 늘 괜찮다고 하지. 그 말버릇도 제 어미를 꼭 닮았구나.');
        else await this.say('mora', '허허, 아침부터 옛날이야기를 조르는 게냐. …나중에. 오늘 일을 다 마치면 들려주마. 약속하지.');
        await this.say('mora', '자, 오늘이 무슨 날인지는 잊지 않았겠지? *첫 울림*을 시험하는 날이란다.');
        await this.say('mora', '이 할미가 네 나이 땐 벌써 참새 떼를 불꽃으로 몰고 다녔지. …흠흠, 그건 자랑할 일이 아니었구나.');
        await this.say('mora', '우선 몸부터 풀자꾸나. 저기 빛나는 표식 세 개를 차례로 밟고 오너라.');
      });
      this.set('p_intro');
    }
    this.quest('q_morning', '종이 울리지 않는 아침', '모라 할머니와 함께 첫 울림을 시험하는 날. 할머니는 요즘 자꾸 엄마 이름으로 나를 부른다.');
    if (!this.flag('p_run')) {
      const mk = W.runMarkers;
      let n = 0;
      this.hint(`${KBD('W')}${KBD('A')}${KBD('S')}${KBD('D')} 이동 · ${KBD('Shift')} 누르고 있기: 달리기 · ${KBD('Space')} 점프<br><small>화면을 클릭하면 마우스로 시점을 돌릴 수 있습니다</small>`, 12);
      for (const m of mk) m.mesh.material.opacity = 0.7;
      while (n < 3) {
        const next = mk.find((m) => !m.done);
        this.obj('q_morning', `빛나는 표식 밟기 (${n}/3)`, mk.filter((m) => !m.done).map((m) => ({ x: m.x, z: m.z, h: 1.5 })));
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
      this.obj('q_morning', '모라에게 돌아가기', [{ x: mora.pos.x, z: mora.pos.z, h: 2.5 }]);
      await this.wait(() => this.near(mora.pos.x, mora.pos.z, 4.5));
      await this.conv(async () => {
        await this.say('mora', '후후, 발은 빠르구나. 넘어지지도 않고. 좋아, 좋아.');
        await this.say('mora', '그럼 지팡이를 들어 보렴. 마음속으로 조용히… 네 안에서 울리는 소리를 느껴 보는 거야.');
        await this.say('mora', '그 소리를 저 *떠 있는 수정*들에게 보내 주렴. 세 개 모두.');
      });
      this.hint(`${KBD('마우스')} 조준 · ${KBD('좌클릭')} 비전 화살 — 누르고 있으면 연사`, 10);
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
        await this.say('mora', '그래! 그 소리란다. …네 울림은 맑구나. 꼭 새벽 종소리 같아.');
        await this.say('mora', '이제 [불의 노래|fire]를 가르쳐 주마. 불은 성급한 녀석이라, 네가 망설이면 먼저 달려 나가 버린단다.');
        await this.say('mora', '그러니 망설이지 말고… 그렇다고 서두르지도 말고. 불이란 그런 거야. 사람 마음처럼.');
      });
      await this.unlockElement('fire', '타오르는 노래. 적을 불태우고, 불씨를 밝힌다.');
      this.hint(`${KBD('2')} 또는 ${KBD('휠')} 속성 전환 · 화염으로 화로에 불을 붙이세요`, 10);
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
        await this.say('mora', '따뜻하구나. …이 탑에 불이 이렇게 환하게 켜진 게 얼마 만인지.');
        await this.say('mora', '마지막이다. 불의 노래를 *크게* 불러 보렴. 오른손에 힘을 모아서— 저 허수아비 영감들에게!');
      });
      this.hint(`${KBD('우클릭')} 고유 마법 — [화염구] · 마나를 소모합니다`, 10);
      this.obj('q_morning', '허수아비에게 화염구 날리기', W.training.dummies.map((d) => ({ x: d.pos.x, z: d.pos.z, h: 3 })));
      let ok = false;
      for (const d of W.training.dummies) d.onHit = (el) => { if (el === 'fire' && G.time - (this.heavyFireT || -9) < 3.5) ok = true; };
      await this.wait(() => ok);
      this.set('p_heavy');
      await this.sleep(1.2);
    }
    if (!this.flag('p_fight')) {
      await this.conv(async () => {
        await this.say('mora', '허허허! 아이고, 허수아비 영감이 놀라 자빠졌구나. 잘했다, 아주 잘했어.');
        await this.say('mora', '…………');
        await this.say('mora', '…이상하구나.');
        G.cameraRig.setCine(V(-2, 30, 138), V(4, 12, 60));
        await this.say('mora', '해가 이만큼 올랐는데… 마을 종이 울리지 않아. 오십 년 동안 하루도 거른 적 없던 종이.', { cam: false });
        this.hushBase = 0.35;
        G.audio.play('dissolve', { pos: G.player.pos });
        await this.say('mora', '{n:아}, 내 뒤로— …아니, 아니다.', { cam: true });
        await this.say('mora', '네가 해 보렴. 이 할미가 뒤에 있으마. 저것들은 *허깨비*. 제 노래를 잃어버린 것들이란다.');
        await this.say('mora', '불을 싫어하지. 겁먹지 말거라. 저것들도 한때는 누군가였으니, 미워할 것도 없단다.');
      });
      this.hint(`${KBD('Shift')} 짧게 누르기: 순간이동 — 잠깐 무적 · ${KBD('T')} 대상 고정`, 10);
      this.obj('q_morning', '허깨비들을 물리치기');
      const lv = 1;
      const wave = (defs) => defs.map(([t, x, z]) => { const e = G.enemies.spawn(t, V(x, 0, z), lv); e.aggro(); G.vfx.burst(e.center(), 'hush', 10, { size: 1 }); return e; });
      let es = wave([['ashling', 10, 124], ['ashling', 4, 120], ['ashling', 16, 130]]);
      await this.wait(() => es.every((e) => !e.alive));
      await this.sleep(1.2);
      this.cSay && null;
      G.hud.bark(mora, '또 온다! 이번엔 섞여 있구나!');
      es = wave([['ooze', 12, 124], ['ashling', 2, 118], ['wailer', 16, 132]]);
      await this.sleep(1.5);
      this.hint('<b>울음탈</b>은 멀리서 구체를 쏜다 — 마법으로 구체를 맞혀 없앨 수 있다<br><b>잿물</b>은 쓰러뜨리면 둘로 갈라진다', 8);
      await this.wait(() => G.enemies.list.filter((e) => e.alive && !e.boss).length === 0 && es.every((e) => !e.alive));
      this.set('p_fight');
      await this.sleep(1.5);
    }
    if (!this.flag('p_end')) {
      mora.pose.kneel = true;
      await this.conv(async () => {
        await this.say('mora', '…후우. 괜찮다, 괜찮아. 조금 어지러울 뿐이란다.');
        await this.say('mora', '들어 보렴. 이 골짜기에는 종이 세 개 있단다. 종이 울리는 동안, *고요*는 이곳에 내려오지 못해.');
        await this.say('mora', '첫째 종은 마을에 있고, 둘째 종은… 둘째는…');
        await this.say('mora', '……');
        await this.say('mora', '이상하지. 수백 번 부른 노래인데, 그다음 구절이 생각나지 않는구나.');
        const c = await this.choose(['할머니, 쉬셔야 해요.', '제가 마을에 가 볼게요.']);
        mora.pose.kneel = false;
        if (c === 0) await this.say('mora', '그래, 쉬마. 대신 네가 이 늙은 발 대신 뛰어 주겠니?');
        else await this.say('mora', '…그래. 그 말을 기다렸는지도 모르겠구나.');
        await this.say('mora', '마을에 내려가 *바우 영감*을 찾거라. 종지기 노릇을 한 지 사십 년 된 고집쟁이지만, 종에 대해선 누구보다 잘 안단다.');
        await this.say('mora', '그리고— 가는 길에 *등석*이 보이면 불을 밝혀 두렴. 불 밝힌 등석은 길 잃은 이를 집으로 데려다준단다.');
        await this.say('mora', '…다녀오너라, {n:아}.');
      });
      this.set('p_end');
    }
    this.done('q_morning');
    this.set('prologueDone');
    this.quest('q_bell', '침묵한 종', '마을의 종이 울리지 않았다. 모라 할머니는 기억이 흐려지는 듯하다. 하늬 마을의 종지기, 바우 영감을 찾아가자.');
    this.obj('q_bell', '하늬 마을로 내려가 바우 영감 찾기', [{ x: POI.bellTower.x, z: POI.bellTower.z, h: 16 }]);
    this.hint(`${KBD('Tab')} 여정 · 마법서 — 원소 반응과 조작을 확인할 수 있습니다 · ${KBD('M')} 지도`, 8);
    this.chapter = 'village'; this.refreshBarks();
    G.game.save(true);
  }

  // ------------------------------------------------------------ chapter 1: village
  async village() {
    const W = G.world;
    const dodam = this.npc('dodam');
    if (!this.flag('v_arrive')) {
      this.obj('q_bell', '하늬 마을로 내려가 바우 영감 찾기', [{ x: POI.bellTower.x, z: POI.bellTower.z, h: 16 }]);
      await this.wait(() => this.near(POI.village.x, POI.village.z, 50) && G.mode === 'free');
      const P = G.player.pos;
      const tx = P.x + (0 - P.x) * 0.15, tz = P.z + (20 - P.z) * 0.15;
      dodam.walkTo(tx + 1.5, tz - 1.5, 5);
      await this.wait(() => !dodam.walkTarget || dodam.pos.distanceTo(G.player.pos) < 3);
      await this.conv(async () => {
        await this.say('dodam', '우와아! 마법사님이다! 모라 할머니네 탑에서 온 마법사님 맞죠? 맞죠?');
        await this.say('dodam', '봤어요? 아침에 종이 안 울렸어요! 우리 아빠가 그러는데 백 년 만에 처음이래요! 아, 아빠가 백 살이라는 건 아니고요, 할아버지의 할아버지의… 아무튼 엄청 오래됐대요!');
        const c = await this.choose(['바우 영감님은 어디 계셔?', '종이 왜 안 울린 거야?']);
        if (c === 1) await this.say('dodam', '몰라요! 그래서 무서워요… 아, 아니에요, 안 무서워요! 저 하나도 안 무서워요. 진짜진짜로요.');
        await this.say('dodam', '바우 할아버지는 종탑 앞에서 종 줄 붙잡고 한숨만 푹푹 쉬고 계세요. 저쪽이요, 저쪽! 제일 높은 거!');
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
      await this.say('narr', '손을 대자, 차가운 돌 안쪽에서 희미한 바람 소리가 난다…', { cam: false });
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
      await this.say('boreum', '킁킁. 모라의 냄새가 나는구나. 그 늙은 여우 할멈, 아직 숨은 붙어 있느냐?');
      const c = await this.choose(['…여우가 말을 해?', '모라 할머니를 아세요?']);
      if (c === 0) await this.say('boreum', '여우라니! 이 몸은 하늬바람의 정령, *보름*이니라! 무엄하도다. …그래도 뭐, 틀린 말은 아니다만.');
      else await this.say('boreum', '알다마다. 오십 년 전, 그 할멈이 이 몸을 이 종에 묶었느니라. 좋은 뜻이었지. 그래서 더 괘씸하고.');
      await this.say('boreum', '들어라, 꼬마 울림지기. 종이 우는 건 쇠가 울어서가 아니다. *기억하는 이*가 노래해야 종이 대답하느니라.');
      await this.say('boreum', '모라가 매일 새벽 노래했기에 이 종은 오십 년을 울었다. 헌데 그 노래가 흐려지고 있어.');
      await this.say('boreum', '할멈이… 잊어 가고 있는 게야.');
      const c2 = await this.choose(['할머니를 도울 방법이 있어?', '…그럴 리 없어.']);
      if (c2 === 1) await this.say('boreum', '이 몸도 그렇게 믿고 싶느니라. 그러니 종소리가 멈춘 게지.');
      await this.say('boreum', '…해가 기울면 놈들이 몰려온다. 종이 침묵한 마을은 고요에게 빈집이나 다름없으니.');
      await this.say('boreum', '네가 이 마을을 지켜 낸다면, 이 몸이 너를 믿어 보마. 그리고 이 몸의 노래를 빌려주지.');
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
    this.cSay('온다. 셋… 아니, 더 많구나. 흩어져서 올 게다. 마을 안으로 들이지 마라!');
    G.hud.bark(this.npc('bau'), '이놈들! 내 창은 아직 안 녹슬었어!');
    const lv = G.enemies.levelFor(0);
    const spawnAt = (t, x, z) => { const e = G.enemies.spawn(t, V(x + randRange(-2, 2), 0, z + randRange(-2, 2)), lv); e.aggro(); G.vfx.burst(e.center(), 'hush', 10, { size: 1 }); return e; };
    const waves = [
      { say: '북쪽 길이다!', units: [['ashling', 0, -26], ['ashling', 4, -28], ['ashling', -4, -24], ['moth', 0, -30], ['moth', 2, -30]] },
      { say: '서쪽에서도 온다!', units: [['ashling', -44, 16], ['ooze', -46, 20], ['ashling', -44, 22], ['wailer', -48, 12]] },
      { say: '동쪽이다, 꼬마! 마지막이다, 버텨라!', units: [['ashling', 44, 12], ['ashling', 46, 16], ['wailer', 48, 8], ['wailer', 44, 22], ['oozeFire', 42, 18]] },
    ];
    let i = 0;
    for (const w of waves) {
      i++;
      this.obj('q_bell', `해 질 녘, 마을을 지키기 (${i}/3)`);
      this.cSay(w.say);
      const es = w.units.map(([t, x, z]) => spawnAt(t, x, z));
      if (i === 3) this.hint('<b>불잿물</b>은 쓰러질 때 폭발한다 — 적들 가까이에서 터뜨려라', 7);
      await this.wait(() => es.every((e) => !e.alive) && G.enemies.list.filter((e) => e.alive).length === 0);
      await this.sleep(1.5);
    }
  }

  async windAndBell() {
    const C = G.companion;
    await this.conv(async () => {
      await this.say('boreum', '…흥. 제법이구나. 모라 녀석, 사람 보는 눈은 여전하군.');
      await this.say('boreum', '약속대로다. 이 몸의 노래를 빌려주마. *하늬바람*이니라. 흐르는 것은 막을 수 없느니.');
    });
    await this.unlockElement('wind', '흐르는 노래. 적을 띄우고 밀어내며, 불과 한기를 퍼뜨린다.');
    this.hint(`${KBD('3')} 바람 · ${KBD('Q')} <b>엮기</b> — 직전에 쓰던 속성과 지금 속성을 엮어 강력한 마법을 쓴다<br><small>예: 화염 → 바람으로 바꾼 뒤 Q = 화염 회오리</small>`, 12);
    await this.sleep(1);
    await this.conv(async () => {
      await this.say('boreum', '자, 이제 종을 울려 보자꾸나. 네 울림과 이 몸의 바람을 실어서.');
      await this.ringVillageBell();
      for (const id of ['dodam', 'isol', 'danbi', 'farmer', 'elder']) this.npc(id).show(true);
      this.npc('dodam').setPos(3, 20, Math.PI);
      this.npc('isol').setPos(10, 21, Math.PI * 0.8);
      await this.say('bau', '…울었어. 울었다고! 허허, 사십 년 들은 소리인디, 오늘은 왜 이리 눈물이 나는겨.');
      await this.say('dodam', '우와아아! 들었어요? 들었어요?! 종이 울었어요! 마법사님이 울렸어요!');
      await this.say('isol', '보셨습니까? 방금 골짜기 전체의 *울림 밀도*가— 아, 죄송합니다. 흥분하면 전문 용어가 튀어나와서요.');
      await this.say('isol', '정령님 말씀대로라면, 나머지 두 종은 *서리봉 성소*와 *천둥 고원*에 있습니다. 북쪽 설산과, 서쪽의 옛 성소 터지요.');
      await this.say('boreum', '그래. 두 성소 모두 고요의 장막에 덮여 있을 게다. 성소를 깨워야 종에 닿을 수 있느니라.');
      await this.say('isol', '지도에 표시해 두었습니다. 그리고… 이건 사적인 부탁인데요.');
      await this.say('isol', '골짜기 곳곳에 유난히 강한 개체들이 있다고 합니다. 이름까지 붙은 것들이요. 혹시 쓰러뜨리시면 알려 주세요. 연구에… 네, 꼭 필요합니다.');
      await this.say('boreum', '순서는 네 마음대로 하거라. 다만 서두르는 게 좋을 게야. 모라의 노래는 기다려 주지 않으니.');
    });
    this.npc('dodam').setPos(0, 24, 0.5); this.npc('isol').setPos(18, 26.5, -0.6); this.npc('bau').setPos(9, 16.5, 0.2);
    this.done('q_bell', '하늬바람의 노래를 얻었다.');
    this.set('v_wind'); this.set('worldOpen'); this.set('bountyActive');
    this.quest('q_bounty', '이름 붙은 것들', '이솔은 이름까지 붙은 강한 개체들을 조사하고 있다. 뿌리 삼킨 돌무덤(속삭이는 숲), 세 자매 울음탈(동쪽 벼랑), 눈먼 파수꾼(북쪽 설원)을 쓰러뜨리자.', 'side');
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
    this.quest('q_bells', '두 개의 종', '보름에 따르면 남은 두 종은 북쪽 서리봉 성소와 서쪽 천둥 고원에 있다. 성소를 덮은 고요의 장막을 걷어 내고 종을 울려야 한다.');
    this.updateBells();
    await Promise.all([this.frostShrine(), this.stormShrine()]);
    if (this.dead) return;
    this.done('q_bells');
    await this.sleep(2);
    this.cSay('두 종이 울렸다. …이제 모라에게 돌아가자꾸나. 마지막 구절을 들어야 한다.', null, 6);
    this.quest('q_song', '모라의 노래', '두 종이 울렸다. 모라 할머니에게 돌아가 마지막 구절을 들어야 한다.');
    this.obj('q_song', '모라의 탑으로 돌아가기', [{ x: -20, z: 132, h: 2.4 }]);
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
      this.cSay('에취! …정령은 감기 따위 안 걸린다. 방금 건 바람 소리니라. 흠흠, 저기 장막이 보이느냐? 주위 화로 셋에 불을 지피면 성소가 깨어날 게다.', 'frost_arrive', 8);
      if (!this.flag('f_guard')) {
        this.set('f_guard');
        const lv = G.enemies.levelFor(1);
        for (const [t, a] of [['ashlingFrost', 0.5], ['ashlingFrost', 2.6], ['oozeFrost', 4.4]]) G.enemies.spawn(t, V(S.pos.x + Math.cos(a) * 16, 0, S.pos.z + Math.sin(a) * 16), lv);
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
      this.cSay('장막이 걷혔다! 안으로 들어가 보자꾸나.', null, 4);
    } else this.openSealInstant(S);
    if (!this.flag('f_echo')) {
      await this.wait(() => this.near(S.pos.x, S.pos.z, 6.5) && G.mode === 'free');
      await this.echoFrost(S);
      this.set('f_echo');
    }
    if (!this.flag('f_boss')) {
      await this.bossFight(() => {
        const lv = G.enemies.levelFor(1) + 1;
        const b = G.enemies.spawn('bruteFrost', V(S.pos.x, 0, S.pos.z + 2.2), lv, { elite: true, name: '서리무덤 파수꾼', leash: 999, hpMul: 1.6 });
        b.aggro();
        G.vfx.burst(b.center(), 'frostmist', 30, { size: 2 }); G.vfx.burst(b.center(), 'hush', 20, { size: 1.5 });
        G.audio.play('boss_roar', { pos: b.pos });
        G.hud.bossBar(b, '서리무덤 파수꾼 — 잊힌 성소의 파수꾼');
        const adds = [G.enemies.spawn('ashlingFrost', V(S.pos.x + 5, 0, S.pos.z - 2), lv - 1), G.enemies.spawn('ashlingFrost', V(S.pos.x - 5, 0, S.pos.z - 2), lv - 1)];
        adds.forEach((e) => e.aggro());
        this.cSay('서리무덤이다! 저놈의 얼음 갑옷엔 서리가 통하지 않는다. 불로 태워서 갑옷을 녹이거라!', null, 6);
        return b;
      }, S.pos, 30);
      this.set('f_boss');
    }
    if (!this.flag('f_learn')) {
      await this.sleep(1);
      await this.learnAtShrine(S, 'frost');
      this.set('f_learn');
    }
    if (!this.flag('frostBell')) {
      this.cSay('종이 기다리고 있다. 가서 울려 주거라.', 'frost_bellhint');
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
      await this.say('narr', '성소 한가운데, 희미한 빛이 사람의 모습을 빚는다. …오래전 이곳에 남겨진 *메아리*다.');
      await this.say('seha', '엄마. 이 노래를 여기 두고 갈게.');
      await this.say('seha', '엄마는 매일 새벽 노래하느라 한 번도 늦잠을 못 잤잖아. 그러니까 이번엔 내가 조금 나눠 들게.');
      await this.say('seha', '…우리 {n}, 요즘 밤마다 울어서 엄마 고생시키지? 그 애한테 이 노래 불러 줘. 내가 부르던 것처럼, 조금 틀리게.');
      await this.say('seha', '금방 갔다 올게. 고요의 틈 너머에 카엘 아저씨가 아직 있다면… 데려올게.');
      ghost.pose.kneel = false;
      await this.sleep(0.6);
      G.vfx.burst(ghost.headPos(), 'soul', 40, { el: 'frost' });
      ghost.show(false);
      await this.say('boreum', '……');
      await this.say('boreum', '…세하. 그 아이였구나. 이 몸의 꼬리를 잡아당기며 놀던 꼬맹이가.');
      const c = await this.choose(['…엄마.', '(말없이 서 있는다)']);
      if (c === 0) await this.say('boreum', '그래. 네 어미다. 네 목도리, 그 아이 것과 똑같은 색이로구나. 모라가 떠 준 게지.');
      else await this.say('boreum', '…말하지 않아도 된다. 이 몸도 가끔은 말이 없을 때가 있느니라. 아주 가끔.');
      await this.say('boreum', '…꼬마. 성소가 떨고 있다. 뭔가 깨어난다!');
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
      if (el === 'frost') await this.say('seha', '고요한 노래야. 차갑지만… 모든 걸 멈춰 세워서, 지켜 주는 노래.', { cam: false, name: '세하의 메아리' });
      else await this.say('kael', '외치는 노래다. 잊히지 않으려는 자들의, 마지막 외침.', { cam: false, name: '카엘의 메아리' });
    });
    G.game.musicOverride = null;
    await this.unlockElement(el, el === 'frost' ? '고요한 노래. 한기를 쌓아 얼리고, 물 위에 얼음 발판을 만든다.' : '외치는 노래. 순식간에 적중하며, 젖거나 언 적에게 치명적이다.');
    if (el === 'frost') this.hint(`서리로 <b>얼린</b> 적을 번개나 강한 마법으로 치면 <b>파쇄</b> · 불로 녹이면 <b>융해</b><br><small>서리 마법은 물 위에 얼음 발판을 만든다</small>`, 10);
    else this.hint(`<b>젖은</b> 적에게 번개 → <b>감전 연쇄</b> · <b>불타는</b> 적에게 번개 → <b>과부하</b><br><small>불 + 서리 엮기(증기 폭발)는 적을 모두 적신다</small>`, 10);
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
      await this.say('boreum', el === 'frost' ? '…울렸다. 멀리서도 들렸을 게다. 모라에게도.' : '두 번째든 세 번째든, 종소리는 언제 들어도 좋구나. …흥, 방금 건 못 들은 걸로 하거라.');
    });
    this.set(el + 'Bell');
    const mem = el === 'frost' ? 'musicbox' : 'badge';
    const m = G.world.memoryObjs[mem];
    if (m && !this.memories[mem]) { m.g.visible = true; G.hud.toast('어딘가에서 희미하게 반짝이는 것이 있다…'); }
    this.updateBells();
    G.game.save(true);
  }

  async stormShrine() {
    const S = G.world.shrines.storm;
    if (this.flag('stormBell')) { if (S.sealed) this.openSealInstant(S); return; }
    if (!this.flag('s_open')) {
      await this.wait(() => this.near(S.pos.x, S.pos.z, 46));
      this.cSay('번개 냄새… 여긴 늘 화가 나 있는 곳이었지. 저 바람개비들이 보이느냐? 이 몸의 바람으로 돌려 보거라.', 'storm_arrive', 8);
      for (const w of S.wheels) w.onActive = () => { const n = S.wheels.filter((x) => x.active).length; G.hud.toast(`바람개비 ${n} / 3`); };
      await this.wait(() => S.wheels.every((w) => w.active));
      await this.sleep(0.5);
      await this.openSeal(S);
      this.set('s_open');
      this.cSay('장막이 걷혔다. …조심하거라. 안에 뭔가 있다.', null, 4);
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
            G.cameraRig.setCine(V(S.pos.x + 8.5, S.y + 3, S.pos.z + 3.5), V(S.pos.x + 3.2, S.y + 2, S.pos.z + 0.5));
            G.audio.play('dissolve', { pos: k.pos });
            G.vfx.burst(k.center(), 'hush', 30, { size: 1.5 });
            await this.say('kaelShadow', '…돌아… 가라…', { cam: false });
            await this.say('kaelShadow', '이곳은… 잊힌 자의… 자리…', { cam: false });
            await this.say('boreum', '저건— 설마?! 아니, 고요에 삼켜진 기사의 껍데기로구나. 이름마저 빼앗긴…', { cam: false });
          });
        }
        k.setState('idle'); k.aggroed = true;
        G.audio.play('boss_roar', { pos: k.pos });
        G.hud.bossBar(k, '무명의 기사 — 이름을 빼앗긴 자');
        this.cSay('녀석은 번개를 먹고 자랐다, 번개는 잘 안 통한다! 불태우거나 얼려라!', null, 5);
        return k;
      }, S.pos, 34);
      this.set('s_boss');
      await this.kaelScene(S, knight);
    }
    if (!this.flag('s_learn')) {
      await this.learnAtShrine(S, 'storm');
      this.set('s_learn');
    }
    if (!this.flag('stormBell')) {
      this.cSay('자, 종을 울리자꾸나.', 'storm_bellhint');
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
      await this.say('kael', '…그대의 노래가 들렸다. 따뜻하고… 성급한. 모라의 불을 닮았군.');
      kael.pose.kneel = false;
      await this.say('kael', '나는 카엘. 오십 년 전, 모라와 함께 고요를 봉인했던 기사다.');
      await this.say('kael', '봉인에는 문지기가 필요했다. 고요의 틈 안에서 문을 붙드는 자. 그자는 세상에서 잊힌다. 그게 대가였지.');
      await this.say('kael', '나는 자원했다. 모라는 반대했고. 나는 웃으며 말했지. "괜찮아. 네가 기억해 주면 돼."');
      await this.say('kael', '…잔인한 말이었다. 그녀는 정말로 오십 년을, 매일 새벽, 나를 기억하며 노래했으니까.');
      await this.say('kael', '그 노래가 종을 울렸고, 종이 봉인을 지탱했다. 모라의 기억이 곧 이 골짜기의 자물쇠였던 거다.');
      const c = await this.choose(['할머니는 지금 모든 걸 잊어 가고 있어요.', '당신 이름을 할머니께 전할게요.']);
      if (c === 0) {
        await this.say('kael', '…알고 있다. 문 너머에서도 느껴졌지. 노래가 가늘어지는 게.');
        await this.say('kael', '사람은 잊는다. 그건 죄가 아니야. 오십 년을 붙들고 있던 게 기적이었지.');
      } else {
        await this.say('kael', '……');
        await this.say('kael', '…아니. 그대 마음대로 해라. 나는 이제 그 말을 부탁할 자격이 없으니.');
        this.set('promiseKael');
      }
      await this.say('kael', '그리고 들어라. 세하가 왔었다. 십오 년 전, 문 너머로.');
      await this.say('kael', '그 아이는 나를 데리러 왔다가… 문을 함께 붙들어 주었다. 그 아이도 지금 거기 있다. 잊힌 채로.');
      await this.say('kael', '번개의 노래를 받아라, 울림지기. 그리고 틈으로 와라. 이번엔— 아무도 혼자 문을 붙들지 않게.');
      G.vfx.burst(kael.headPos(), 'soul', 50, { el: 'storm' });
      kael.show(false);
    });
    G.game.musicOverride = null;
    G.scene.remove(kael.root);
    G.npcs.list.splice(G.npcs.list.indexOf(kael), 1); delete G.npcs.map.kael;
  }

  async bossFight(make, center, radius) {
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
      await this.wait(() => this.near(center.x, center.z, 7) && G.mode === 'free');
    }
  }

  // ------------------------------------------------------------ chapter 3: Mora's song
  async moraChapter() {
    this.quest('q_song', '모라의 노래', '두 종이 울렸다. 모라 할머니에게 돌아가 마지막 구절을 들어야 한다.');
    if (!this.flag('m_talk')) {
      this.obj('q_song', '모라의 탑으로 돌아가기', [{ x: -20, z: 132, h: 2.4 }]);
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
    this.quest('q_rift', '고요의 틈', '골짜기가 스스로를 기억하기 시작했다. 이제 고요의 틈으로 가서, 문을 붙들고 있는 이들을 만나야 한다.');
    this.obj('q_rift', '고요의 틈으로', [{ x: POI.rift.x, z: POI.rift.z, h: 10 }]);
    this.setChapter('rift');
  }

  async moraMain() {
    const mora = this.npc('mora');
    G.game.musicOverride = 'memory';
    await this.conv(async () => {
      await this.say('mora', '…어머, 손님이 오셨네. 이 늙은이한테 무슨 볼일이시우?');
      await this.say('boreum', '…모라.');
      await this.say('mora', '세하니? 세하야, 이제 왔구나. 저녁은 먹었니? 엄마가 수제비 끓여 놨는데.');
      const c = await this.choose(['…응, 엄마. 나 왔어.', '할머니, 저예요. {n}.']);
      if (c === 0) {
        await this.say('mora', '그래, 그래. 우리 세하. 어디 갔다 이제 와. 엄마가 얼마나 기다렸는데.');
        await this.say('mora', '…많이 컸구나. 꼭 딴사람 같아.');
      } else {
        await this.say('mora', '{n}…?');
        await this.say('mora', '…{n}. 그래. 우리 {n}. 아이고, 내가 또. 미안하구나. 할미가 요새 자꾸 이래.');
      }
      await this.say('narr', '할머니의 눈빛이, 잠시 맑아진다.');
      await this.say('mora', '얘야. 할미가 정신이 맑을 때 말해 둘 게 있다. 잘 들으렴.');
      await this.say('mora', '세 번째 종 말이다. …그건 성소에 있는 게 아니란다.');
      await this.say('mora', '셋째 종은 *사람*이야. 골짜기의 노래를 기억하는 모든 사람. 오십 년 전엔 그게 나 하나뿐이었지. 그래서 그렇게 무거웠던 게야.');
      await this.say('mora', '고요는 잊힌 것들이 모여 생긴 슬픔이란다. 싸워서 없앨 수 있는 게 아니야. 기억해 줘야 해. …함께.');
      await this.say('mora', '마을 사람들에게 가서 잊힌 이름들을 들려주렴. 카엘. 세하. 그리고 이 할미 이름도— 언젠가 내가 나를 잊거든.');
      await this.say('mora', '그러고 나서 틈으로 가거라. 이번엔 혼자 문을 붙들지 말고. …약속해 주겠니?');
      await this.choose(['약속할게요.']);
      if (!G.player.hasHat) {
        await this.say('mora', '…고맙다. 이 모자 받으렴. 좀 크겠지만, 너도 금방 자랄 게다.');
        G.player.setHat(true); this.set('hat');
        G.audio.play('unlock');
        G.hud.banner('모라의 선물', '모라의 모자', '오래된 보랏빛 모자. 챙이 조금 휘어 있다.', '#c9a8ff');
      } else await this.say('mora', '…그 모자, 잘 어울리는구나. 내 것보다 훨씬.');
      await this.say('mora', '……');
      await this.say('mora', '…세하야, 추운데 들어가자꾸나. 바람이 차다.');
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
      await this.say('bau', '자, 다들 모였쥬? 어… 그라니께, 노래를 부르면 된다는 거여?', { cam: false });
      await this.say('isol', '네. 기록에 따르면, 가사는 중요하지 않습니다. 기억하는 마음이 중요하지요. …아마도요.', { cam: false });
      await this.say('dodam', '누룽지도 같이 불러요! 누룽지는 음치지만요!', { cam: false });
      await this.say('danbi', '아이고, 이 나이에 노래라니. 그래도… 세하 그 애가 좋아하던 노래니까.', { cam: false });
      await this.say('narr', '골짜기 사람들이, 하나둘 노래를 시작한다. 서툴고, 조금씩 틀린 음으로.', { cam: false });
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
      await this.say('boreum', '…들리느냐, 꼬마. 이것이 셋째 종이다.', { cam: false });
      await this.say('boreum', '모라가 오십 년 동안 혼자 짊어진 걸, 이제 모두가 나눠 들었느니라. 가자. 틈이 기다린다.', { cam: false });
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
    this.quest('q_rift', '고요의 틈', '골짜기가 스스로를 기억하기 시작했다. 이제 고요의 틈으로 가서, 문을 붙들고 있는 이들을 만나야 한다.');
    this.obj('q_rift', '고요의 틈으로', [{ x: POI.rift.x, z: POI.rift.z, h: 10 }]);
    const R = G.world.rift;
    await this.wait(() => this.near(POI.rift.x, POI.rift.z, 70));
    this.cSay('…저 너머는 소리가 없다. 이 몸의 바람조차 거기선 숨을 죽이지.', 'rift_near', 6);
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
    }, R.center, 40);
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
      await this.say('kael', '왔군. …모라의 불을 닮은 녀석.');
      await this.say('seha', '{n}…? {n} 맞지? 세상에. 이렇게 컸구나.');
      await this.say('seha', '미안해. 금방 온다고 해 놓고. 엄마가— 할머니가 많이 힘들었지?');
      const ch = await this.choose(['보고 싶었어요.', '같이 돌아가요.']);
      if (ch === 0) await this.say('seha', '나도. 매일. 잊혀 있는 동안에도, 그건 안 잊혔어.');
      else await this.say('seha', '…그럴 수 있다면 좋을 텐데. 우린 너무 오래 잊혀 있었어. 하지만 괜찮아. 네가 우리를 기억해 주면, 그걸로 충분해.');
      await this.say('kael', '문이 버티지 못한다. 심장이 깨어난다.');
      await this.say('seha', '들어, {n}. 심장은 결계로 스스로를 감싸. 결계마다 다른 노래가 필요해.');
      await this.say('seha', '[불|fire]에는 [서리|frost]를, [서리|frost]에는 [불|fire]을, [번개|storm]에는 [바람|wind]을, [바람|wind]에는 [번개|storm]를.');
      await this.say('kael', '결계가 모두 깨지면 심장이 드러난다. 그때가 기회다. 가진 노래를 모두 쏟아부어라.');
      await this.say('boreum', '…드디어로구나. 꼬마, 이 몸의 꼬리를 걸고 말하건대— 넌 혼자가 아니니라.');
    });
    this.hint('결계의 색을 보고 <b>약점 속성</b>으로 공격하세요 · 충격파는 점프나 순간이동으로 피할 수 있습니다', 9);
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
      if (kael) await this.say('kael', '문이 닫힌다. 이번엔 붙들 필요가 없군. 골짜기가 스스로를 기억하니까.');
      if (seha) {
        await this.say('seha', '{n}. 엄마한테 전해 줘. …아니, 전하지 않아도 돼. 엄마가 잊어도, 우린 엄마를 기억할게.');
        await this.say('seha', '그러니까 너도, 할머니를 잘 기억해 줘. 할머니가 너를 잊는 날이 와도.');
      }
      if (kael && this.flag('promiseKael')) await this.say('kael', '…그리고 울림지기. 모라에게— 아니다. 그대가 약속했었지. 믿겠다.');
    });
    for (const g of this.ghosts || []) { G.vfx.burst(g.headPos(), 'soul', 40, { el: 'gold' }); g.show(false); }
    await this.fade(true, 2.5, true);
    this.done('q_rift');
    this.chapter = 'post';
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
      await this.say('mora', '…어머, 누구시더라.');
      await this.say('mora', '이상하지. 처음 보는 얼굴인데, 댁을 보니까 노래 하나가 떠오르네.');
      await this.say('mora', '라— 라라… 이 다음이 뭐였더라.');
      await this.choose(['(이어서 노래한다)']);
      G.game.musicOverride = 'memory';
      await this.sleep(1.5);
      const tps = [V(6, 20, 10), V(POI.frost.x, 62, POI.frost.z), V(POI.storm.x, 40, POI.storm.z)];
      for (let k = 0; k < 3; k++) { G.audio.play('bell', { pos: G.player.pos.clone().add(V(0, 0, -30)), f: [146.8, 196, 220][k] }); await this.sleep(1.4); void tps; }
      await this.say('mora', '…그래, 그거야. 그거였어.');
      await this.say('mora', '고마워요. 누군지는 모르겠지만… 꼭, 오래 알던 사람 같네.');
      await this.say('boreum', '…늙은 여우 할멈. 잘 자거라. 내일도 이 몸이 깨워 주마.');
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
      '— 끝 —\n\n골짜기는 계속됩니다. 남은 노래 씨앗과 기억을 찾아보세요.',
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
    if (id === 'bau' && ch === 'village' && this.flag('v_arrive') && !this.flag('v_bau')) return this.conv(async () => {
      await this.say('bau', '…왔는감.');
      await this.say('bau', '모라 할매가 보냈구먼. 그 할매 발소리보다 네 발소리가 먼저 들릴 날이 올 줄 알았지.');
      await this.say('bau', '종 얘기 들으러 왔쥬? …그려. 안 울어. 줄을 당겨도 쇠가 입을 꾹 다문 것 같어.');
      await this.say('bau', '사십 년을 매일 새벽 당겼는디, 이런 일은 처음이여.');
      const c = await this.choose(['모라 할머니가 편찮으세요.', '종을 살펴봐도 될까요?']);
      if (c === 0) { await this.say('bau', '…그 할매가? 허, 쇠도 녹슨다더니.'); await this.say('bau', '그라믄 더더욱 서둘러야겄네.'); }
      else await this.say('bau', '살펴봐. 근디 조심혀.');
      await this.say('bau', '요새 밤마다 종탑 위에서 뭔가 번쩍혀. 꼬리 같은 게 말여. 나는 늙어서 헛것을 보는 줄 알았는디…');
      await this.say('bau', '아, 그리고 저기 여관에 묵는 *학자 양반*이 요 며칠 종탑 주변을 자꾸 기웃거리더만. 그 양반도 뭘 아는 눈치여.');
      this.set('v_bau');
    });
    if (id === 'isol' && ch === 'village' && this.flag('v_bau') && !this.flag('v_isol')) return this.conv(async () => {
      await this.say('isol', '실례합니다만— 방금 "종"이라고 하셨습니까? 아, 먼저 인사를. 저는 이솔. 왕립 학술원 소속… 이었던, 현재는 독립 연구자입니다.');
      await this.say('isol', '제 연구 주제는 *고요*입니다. 네, 그 고요요. 기억에서 떨어져 나간 존재가 울림을 잃고 잿빛이 되는 현상.');
      await this.say('isol', '참고로 말씀드리자면, 학계에서는 대부분 전설로 취급합니다. 덕분에 제 연구비도 전설이 되었지요. 하하… 하.');
      await this.say('isol', '제 가설은 이렇습니다. 이 골짜기의 종들은 단순한 종이 아니라 *기억의 닻*이다. 누군가 종을 울릴 때마다, 골짜기 전체가 스스로를 "기억해 내는" 겁니다.');
      await this.say('isol', '그런데 첫째 종이 침묵했다는 건… 닻을 붙들던 손이 느슨해졌다는 뜻이겠지요.');
      const c = await this.choose(['그 손이… 모라 할머니인가요?', '어떻게 하면 다시 울릴 수 있죠?']);
      if (c === 0) { await this.say('isol', '…!'); await this.say('isol', '그렇다면 많은 게 설명됩니다. 이 골짜기엔 매일 새벽, 종보다 먼저 일어나 노래하는 사람이 있다는 소문이 있었거든요.'); }
      else await this.say('isol', '그걸 알아내는 게 제 일이었는데, 솔직히 말씀드리면 막혀 있었습니다. 가설 16개가 모두 기각됐지요.');
      await this.say('isol', '종탑 꼭대기에서 무언가 움직인다는 목격담이 있습니다. 종탑 아래 *제단*에 손을 대 보시겠습니까? 마법사라면… 반응이 있을지도요.');
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
    return this.conv(async () => { for (const l of this.ambientTalk(id)) await this.say(l[0], l[1]); });
  }

  ambientTalk(id) {
    const ch = this.chapter;
    const post = ch === 'post';
    const T = {
      mora: ch === 'prologue' ? [['mora', '천천히 하렴. 서두르는 불은 금방 꺼진단다.']]
        : post ? [['mora', '어머, 또 오셨네. 이상하게 댁이 오면 마음이 편해요.'], ['mora', '라— 라라… 이 노래, 누가 가르쳐 줬더라.']]
          : ch === 'mora' ? [['mora', '세하야, 바람이 차다. 목도리 잘 여미렴.']]
            : [['mora', '다녀왔니. …할미는 여기 앉아서 골짜기를 보는 게 좋단다. 저기 어디쯤, 옛날 생각이 떨어져 있을 것 같아서.'], ['mora', '무리하지 말거라. 등석에서 쉬어 가는 것도 용기란다.']],
      bau: post ? [['bau', '요새는 새벽마다 애들이 종 치겠다고 줄을 서. 허허, 내 자리 뺏기게 생겼어.']]
        : [['bau', '종은 세게 치는 게 아니라 오래 치는 겨. 누가 가르쳐 줬는지는 까먹었는디… 그 말은 안 까먹었어.'], ['bau', '북쪽 길은 눈이 쌓여서 미끄러워. 서쪽 고원은 번개가 잦고. 조심혀.']],
      dodam: this.flag('catSaved') ? [['dodam', '누룽지가 요즘 저만 졸졸 따라다녀요! 마법사님 덕분이에요!'], ['dodam', '저 나중에 커서 마법사님 같은 울림지기 될 거예요. 불도 쏘고, 번개도 쏘고! …근데 무서운 건 빼고요.']]
        : [['dodam', '마법사님, 마법 한 번만 보여 주세요! 한 번만요! …아, 지금 바쁘시구나.']],
      isol: [['isol', '관찰 기록에 따르면, 반응 현상은 상태의 조합에 달려 있습니다. 얼린 뒤 번개, 적신 뒤 번개, 불태운 뒤 바람… 흥미롭지요.'], ['isol', '참고로 말씀드리자면, 울음탈의 구체는 마법으로 상쇄할 수 있습니다. 제가 몸으로 확인했… 아닙니다.']],
      danbi: [['danbi', '아이고, 밥은 먹고 다니니? 자, 꿀빵 하나 먹고 가.'], ['danbi', '할머니는 요즘 어떠시니? …그래. 가끔 들러서 얼굴 보여 드려.']],
      farmer: [['farmer', '올해 무는 잘 들었는디, 밤마다 허깨비들이 밭을 밟고 다녀. 종이 다시 우니께 좀 덜하구먼.'], ['farmer', '재나방 놈들, 등불만 켜면 몰려들어. 불로 한 방이면 떨어지긴 허지만.']],
      fisher: [['fisher', '호수에 얼음을 띄우는 마법사가 있다는 소문 들었어요! 혹시 당신이에요? 와, 한 번만 보여 줘요!'], ['fisher', '거울 호수는 비친 걸 오래 기억한대요. 그래서 물이 이렇게 맑은가 봐요.']],
      elder: [['elder', '에헴. 장기는 기다림의 놀이여. 요즘 젊은이들은 그걸 몰라.'], ['elder', '옛날에 파란 깃털 투구를 쓴 기사가 이 마을에 있었는디… 이름이 뭐였더라. 에잉, 장이야!']],
    };
    const arr = T[id] || [['villager', '좋은 날이네요.']];
    if (id === 'danbi') G.player.heal(G.player.maxHp);
    return [pick(arr)];
  }

  async tellNames(id) {
    const L = {
      bau: [['bau', '카엘…? 카엘이라… 어이구, 그려! 그 기사 양반! 내가 코흘리개일 적에 막대기로 창 쓰는 법 가르쳐 줬던! 파란 깃털 투구 쓰고!'], ['bau', '그 양반이 종 줄 당기는 법도 가르쳐 줬어. "바우야, 종은 세게 치는 게 아니라 오래 치는 거다." …그려. 그랬지. 내가 그걸 왜 잊고 살았을꼬.']],
      danbi: [['danbi', '세하? 아이고, 세하! 우리 가게 꿀빵을 제일 좋아하던 그 애! 늘 두 개 사서 하나는 엄마 드리고…'], ['danbi', '어째서 여태 그 애 생각을 못 했을까. 이렇게 또렷한데. …얘, 너 눈매가 그 애를 똑 닮았구나.']],
      dodam: [['dodam', '카엘 기사님이랑 세하 누나 이야기요? 저 처음 들어요! …근데 이상해요. 처음 듣는데 왠지 알 것 같아요.'], ['dodam', '제가 안 까먹게 매일 누룽지한테 이야기해 줄게요! 누룽지는 까먹어도, 저는 안 까먹어요!']],
      isol: [['isol', '기록하겠습니다. 카엘, 번개의 기사. 세하, 서리의 울림지기. 모라, 오십 년의 새벽을 노래한 사람.'], ['isol', '기록은 잊지 않습니다. 사람보다 느리지만, 사람보다 오래 기억하지요. …이게 학자가 할 수 있는 일입니다.']],
    }[id];
    await this.conv(async () => {
      await this.say('narr', '카엘과 세하, 그리고 모라의 이야기를 들려주었다.');
      for (const l of L) await this.say(l[0], l[1]);
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
      await this.say('dodam', '마법사님… 저기요, 혹시… 고양이 봤어요? 주황색이고요, 이름은 누룽지예요. 누룽지처럼 생겨서 누룽지예요.');
      await this.say('dodam', '어제 저녁에 호수 쪽으로 나비 쫓아가더니 안 와요. 누룽지는 수영도 못하는데…');
      const c = await this.choose(['내가 찾아볼게.', '고양이는 원래 잘 돌아와.']);
      if (c === 1) await this.say('dodam', '누룽지는 바보라서 안 돌아와요! …제발요.');
      await this.say('dodam', '진짜요? 약속이에요! 새끼손가락 걸어요! …아 맞다, 마법사님 장갑 꼈지.');
    });
    this.quest('q_cat', '누룽지를 찾아서', '도담이의 고양이 누룽지가 거울 호수 쪽으로 가서 돌아오지 않았다. 호숫가 어부 말로는, 호수 가운데 섬에서 고양이를 본 것 같다고 한다.', 'side');
    this.obj('q_cat', '거울 호수 근처에서 누룽지 찾기 — 울음소리에 귀 기울이기');
    this.cSay('서리의 노래가 있다면 물 위에 얼음을 띄울 수 있을 텐데. 없다면… 헤엄이라도 치거라.', 'cat_hint');
  }
  async pickCat() {
    await this.conv(async () => {
      G.audio.play('cat', { pos: this.cat.root.position });
      await this.say('narr', '누룽지는 잠깐 경계하더니, 이내 어깨 위로 폴짝 올라탔다. 따뜻하고 무겁다.');
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
      await this.say('dodam', '누룽지!!! 너 어디 갔었어! 바보! 바보 고양이!');
      await this.say('dodam', '…고마워요, 마법사님. 진짜진짜로요.');
      await this.say('dodam', '이거, 제 보물인데요, 드릴게요. 행운 조약돌이에요. 물수제비 열두 번 뜬 돌이에요! 제 최고 기록이요!');
    });
    this.set('catSaved');
    G.player.maxStamina += 20; G.player.stamina = G.player.maxStamina;
    G.player.addXP(40);
    this.done('q_cat', '도담의 행운 조약돌 — 최대 기력이 늘었다.');
    this.refreshBarks();
  }

  async danbiMemory() {
    await this.conv(async () => {
      await this.say('danbi', '아이고, 이게 누구야! 모라 할머니네 손주 아니니? 밥은 먹고 다니니? 얼굴이 반쪽이네, 반쪽.');
      await this.say('danbi', '할머니는 요새 통 빵 사러 안 오시더라. 매일 새벽 종 치기 전에 제일 먼저 오시던 양반이…');
      await this.say('danbi', '참, 할머니가 예전에 그러시더라. 젊을 적 소중한 걸 골짜기 여기저기에 두고 왔다고.');
      await this.say('danbi', '"잊어버리지 않으려고 일부러 두고 왔지" 하시면서 웃으시던데. 무슨 말인지 원…');
      await this.say('danbi', '혹시 찾게 되면 할머니께 가져다드려. 기억이란 게, 물건을 보면 돌아오기도 하거든. 자, 꿀빵이나 하나 먹고 가!');
    });
    G.player.heal(G.player.maxHp);
    this.startMemoryQuest();
  }
  startMemoryQuest() {
    if (this.quests.q_memory) return;
    this.quest('q_memory', '모라의 기억', '모라 할머니는 젊은 날 소중한 것들을 골짜기 곳곳에 두고 왔다고 한다. 찾아서 할머니께 가져다드리자. 반짝이는 무언가를 따라가 보자.', 'side');
    this.updateMemoryObj();
  }
  updateMemoryObj() {
    const n = Object.values(this.memories).filter((v) => v === 'given').length;
    const have = Object.values(this.memories).filter((v) => v === 'have').length;
    this.obj('q_memory', have ? `모라에게 기억의 물건 전하기 (${have}개 가지고 있음)` : `기억의 물건 찾기 (${n}/4 전함)`, have ? [{ x: -20, z: 132, h: 2.4 }] : []);
  }
  takeMemory(m) {
    m.taken = true; m.g.visible = false;
    this.memories[m.id] = 'have';
    G.audio.play('pickup'); G.audio.play('echo', { pos: m.pos });
    G.vfx.burst(m.pos, 'soul', 30, { el: 'arcane' });
    G.hud.banner('모라의 기억', m.name, m.desc, '#c9a8ff');
    this.startMemoryQuest();
    this.updateMemoryObj();
    this.cSay('그건… 모라의 물건이로구나. 이 몸도 기억난다. 가져다주거라.', 'mem_found');
  }
  async deliverMemories() {
    const ids = Object.keys(this.memories).filter((k) => this.memories[k] === 'have');
    G.game.musicOverride = 'memory';
    for (const id of ids) {
      await this.conv(async () => {
        if (id === 'hairpin') {
          await this.say('mora', '이건… 어머나. 은방울꽃 핀이로구나. 세하가 열 살 때 호숫가에서 잃어버렸다고 울고불고했던…');
          await this.say('mora', '그 애가 얼마나 울었는지 몰라. 그래서 내가 호수를 다 뒤졌지. 결국 못 찾았는데, 네가 찾아왔구나.');
          await this.say('mora', '세하는 울다 지쳐서 이렇게 말했단다. "엄마, 괜찮아. 핀은 잃어버려도, 예뻤던 건 안 잃어버리잖아."');
          await this.say('mora', '…그 애는 가끔 나보다 어른 같았어.');
        } else if (id === 'book') {
          await this.say('mora', '노을 들판의 그 나무 아래서… 이 책에 꽃을 누르던 사람이 있었지.');
          await this.say('mora', '이름이… 이름이 분명 있었는데. 첫 장에 적어 두었는데, 번졌구나.');
          await this.say('mora', '우스운 사람이었어. 기사면서 꽃 이름은 나보다 더 많이 알았지. "모라, 이건 물망초야. 나를 잊지 말라는 뜻이래."');
          await this.say('mora', '…그래 놓고. 그래 놓고 제가 먼저 잊혀 버렸지.');
        } else if (id === 'musicbox') {
          await this.say('mora', '이 오르골은… 세하가 서리봉에 올라갈 때 들고 간 거란다.');
          await this.say('mora', '그 애는 돌아오지 않았어. 너를 내 품에 맡기고, "금방 올게, 엄마" 하고서.');
          await this.say('mora', '떠나기 전날 밤에 그 애가 묻더라. "엄마가 이 노래를 잊으면 어떡해?"');
          await this.say('mora', '그래서 말해 줬단다. *"노래는 한 사람만 기억하는 게 아니란다."*');
          await this.say('mora', '…그 말을 한 게 나였는데. 정작 나는 혼자 기억하려고만 했구나.');
        } else if (id === 'badge') {
          await this.say('mora', '…카엘.');
          await this.say('mora', '카엘. 그래, 그 이름이었어. 어떻게 이걸 잊을 수 있었을까. 오십 년을 매일 부르던 이름을.');
          await this.say('mora', '뒷면에 뭐라고 적혀 있니? …"내가 잊혀도, 너는 노래해."');
          await this.say('mora', '바보 같은 사람. 끝까지 멋있는 척은.');
        }
      });
      this.memories[id] = 'given';
      G.player.addXP(35);
    }
    G.game.musicOverride = null;
    const n = Object.values(this.memories).filter((v) => v === 'given').length;
    if (n >= 4 && !this.flag('memDone')) {
      this.set('memDone');
      await this.conv(async () => {
        await this.say('mora', '얘야. 할미가 오늘은 이상하게 머리가 맑구나. 네가 가져다준 것들 덕분이겠지.');
        await this.say('mora', '이것들은 네가 가지고 있으렴. 할미가 또 잊어버리면, 네가 다시 보여 주면 되잖니. …그렇게 하자꾸나.');
        if (!G.player.hasHat) await this.say('mora', '그리고 이 모자도. 할미가 젊을 적 쓰던 거란다. 이제 네 차례야.');
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
    await this.conv(async () => {
      await this.say('isol', '정말입니까? 이름 붙은 개체를…! 잠시만요, 받아 적겠습니다.');
      await this.say('isol', '흥미롭군요. 강한 개체일수록 이름을 가지고 있습니다. 누군가 그것들을 기억했다는 뜻이겠지요. 두려움으로라도.');
      await this.say('isol', '고요는 이름을 먹고 자라지만… 이름은 또 고요를 붙잡아 두기도 한다. 모순이군요. 아주 아름다운 모순.');
      await this.say('isol', '약소하지만, 연구비에서 떼어 드리는 사례입니다. …네, 연구비가 거의 없긴 합니다만.');
    });
    G.player.addXP(80 * n);
    this.counters.bountyNew = 0;
    this.updateBounty();
  }

  async readGrave() {
    await this.conv(async () => {
      await this.say('sign', '이름이 새겨지지 않은 비석. 누군가 매일 들꽃을 놓고 간 흔적이 있다.');
      if (this.chapter === 'post' || this.flag('m_choir')) await this.say('sign', '비석 아래쪽에, 서툰 글씨가 새로 새겨져 있다. *"세하. 그리고 카엘. 잊지 않을게."*');
      else if (this.flag('f_echo')) await this.say('sign', '…이 비석은 세하를 위한 것이었을까. 이름을 새기지 못한 건, 돌아올 거라 믿었기 때문일까.');
    });
  }

  // ------------------------------------------------------------ elements, seeds
  async unlockElement(el, desc) {
    G.player.unlock(el);
    G.audio.play('unlock');
    G.vfx.burst(G.player.center(), 'soul', 50, { el });
    G.vfx.ring(G.player.pos, PAL[el].core, 6, 1, { thick: 0.2 });
    G.vfx.circle(G.player.pos, PAL[el].glow, 3, 2, { spin: 2 });
    G.hud.banner('새로운 노래', `${EL_INFO[el].name}의 노래`, desc + `<br><small>${['arcane', 'fire', 'wind', 'frost', 'storm'].indexOf(el) + 1}번 키로 선택</small>`, EL_INFO[el].css, 4500);
    await this.sleep(0.5);
  }

  takeSeed(s) {
    s.taken = true; s.g.visible = false;
    this.seeds.add(s.i);
    const n = this.seeds.size;
    G.audio.play('seed', { m: THEME_NOTES[(n - 1) % THEME_NOTES.length] });
    G.vfx.burst(s.orb.getWorldPosition(new THREE.Vector3()), 'soul', 30, { el: 'heal' });
    G.vfx.ring(new THREE.Vector3(s.x, s.y, s.z), PAL.heal.core, 3, 0.6);
    G.hud.toast(`노래 씨앗 <b>${n} / 16</b>`);
    if (n % 4 === 0) {
      const k = n / 4;
      const P = G.player;
      const kind = ['heart', 'stamina', 'mana', 'heart'][k - 1];
      if (kind === 'heart') P.maxHp += 4; else if (kind === 'stamina') P.maxStamina += 25; else P.maxMana += 25;
      P.hp = P.maxHp; P.mana = P.maxMana; P.stamina = P.maxStamina;
      G.hud.updateHearts();
      G.audio.play('levelup');
      G.hud.banner('노래 씨앗', '울림이 깊어졌다', kind === 'heart' ? '생명력의 그릇이 하나 늘었다.' : kind === 'stamina' ? '기력이 늘었다.' : '마나가 늘었다.', '#9fffb0');
    } else if (n === 1) this.cSay('오호, 노래 씨앗이로구나! 잊힌 노래의 작은 조각이니라. 넷을 모으면 네 울림이 깊어질 게다. 귀를 기울이면 소리로 찾을 수 있지.', 'seed1', 7);
  }

  // ------------------------------------------------------------ hooks
  onKill(e) { this.inc('kills'); if (e.elite && this.once('elite1')) this.cSay('이름까지 붙은 놈을 쓰러뜨리다니. 제법이구나.'); }
  onCast(kind, el) {
    if (kind === 'heavy' && el === 'fire') this.heavyFireT = G.time;
    if (kind === 'weave' && this.once('weave1')) this.cSay('오호! 두 노래를 엮었구나. 모라도 그걸 익히는 데 삼 년은 걸렸느니라.');
  }
  onReaction(r) {
    const L = {
      melt: '오호! 녹여 버렸구나! 그것이 *융해*니라. 불은 얼음을 이긴다.',
      shatter: '와장창! 언 것은 깨지기 마련이지. *파쇄*로다!',
      conduct: '젖은 놈들에게 번개라니, 짓궂구나! *감전 연쇄*니라.',
      overload: '불에 번개를 더하면 터진다. 당연한 이치지. *과부하*!',
      firestorm: '바람이 불을 옮겼구나. 이 몸의 바람이 쓸모가 있지 않느냐?',
      thermal: '불타는 놈에게 서리를! *열충격*이로구나.',
      flashfreeze: '젖은 것은 순식간에 언다. *순간 빙결*!',
      blizzard: '한기를 바람에 실었구나. *눈보라*로다.',
    };
    if (L[r] && this.once('react_' + r)) this.cSay(L[r]);
  }
  onBossPhase(b, n) {
    if (b.type === 'knight' && n === 2) { G.hud.bark({ headPos: () => b.center().add(V(0, 1.5, 0)), speaker: 'kaelShadow' }, '모… 라…'); this.cSay('놈이 번개를 부른다! 발밑을 조심하거라!'); }
    if (b.type === 'heart') {
      const S = this.npc('seha'), K = this.npc('kael');
      if (n === 2) { if (S) G.hud.bark(S, '{n}, 지치지 마! 네 노래는 혼자가 아니야!'); this.cSay('놈이 허깨비들을 부른다! 결계부터 깨라!'); }
      if (n === 3) {
        if (K) G.hud.bark(K, '광선이다! 뛰어넘어라!');
        G.hud.companion('…잊는 건… 아프지 않아… 조용해질 뿐이야… 너도 쉬고 싶지 않니…', 5);
        setTimeout(() => this.cSay('귀 기울이지 마라! 저건 슬픔이 하는 말이다!'), 5200);
      }
    }
  }
  onHeartExposed() { const S = this.npc('seha'); if (S && this.once('exposed1')) G.hud.bark(S, '지금이야! 가진 노래를 전부!'); else this.cSay('심장이 드러났다! 지금이다!'); }

  regionComment(id) {
    const L = {
      lake: '거울 호수는 비친 것을 오래 기억한다더구나. 세하가 여기서 자주 놀았지.',
      woods: '속삭이는 숲… 재나방이 많은 곳이다. 불을 준비하거라.',
      meadow: '노을 들판. 해 질 녘이 제일 곱지. 모라가 좋아하던 곳이니라.',
      bluffs: '이 벼랑 위에선 골짜기가 한눈에 보이지. 떨어지면 활공하거라.',
      rift: '……이 몸의 꼬리털이 곤두서는구나.',
      frostpass: '에취! 눈이다, 눈. 발밑 조심하거라.',
    };
    if (L[id]) this.cSay(L[id], 'reg_' + id);
  }

  companionChatter() {
    const P = G.player.pos;
    const n = G.world.sky.night;
    const reg = regionAt(P.x, P.z).id;
    const pool = [
      '바람이 좋구나. 이런 날엔 꼬리털이 반들반들해지지.',
      '하늬바람은 서쪽에서 분다. 그래서 이 골짜기 이름이 하늬인 게야. 몰랐느냐?',
      '배가 고프구나. 정령도 배가 고프냐고? …기분 탓이니라.',
      '모라는 젊을 적 성미가 불같았느니라. 지금도 그렇지만.',
      '가끔 멈춰서 귀를 기울여 보거라. 노래 씨앗 소리가 들릴지도 모른다.',
      '서두르는 것도 좋지만, 가끔은 경치도 보거라. 이 골짜기, 제법 곱지 않느냐?',
    ];
    if (n > 0.5) pool.push('밤하늘을 보거라. 저 별들도 누군가 기억해 주니까 빛나는 게야.', '반딧불이는 잊힌 이들의 작은 노래라는 옛말이 있느니라. 믿거나 말거나.');
    if (G.player.hp <= 4) return '너, 숨이 가쁘구나. 등석에서 쉬어 가거라. 용감한 것과 무모한 건 다르니라.';
    if (reg === 'rift' && this.chapter !== 'post') return '…이곳은 소리가 없구나. 빨리 끝내자.';
    if (!this.flag('worldOpen')) return null;
    return pick(pool);
  }
}
