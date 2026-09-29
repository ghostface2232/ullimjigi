// Skill trees ("울림 나무"): per-element trees bought with resonance points,
// plus a harmony tree of cross-element combo effects and element ultimates.
import { G, ELEMENTS, EL_INFO } from '../core/context.js';

// Point gates per tier (points already spent in that tree)
export const TIER_GATE = [0, 1, 3, 6];
export const ULT_COST = 100;

const pct = (v) => `${Math.round(v * 100)}%`;
const ranked = (vals, fmt = (v) => v) => (r) => fmt(vals[Math.max(0, Math.min(vals.length - 1, r - 1))]);

// Node: { id, name, tier, col, max, cost, req:[any-of], kind: 'passive'|'active'|'ult'|'harmony', desc(rank) }
// `desc(r)` describes the effect at rank r (1-based).
export const TREES = {
  arcane: {
    name: '비전', motto: '자신의 울림을 벼리는 길',
    nodes: [
      { id: 'a_focus', name: '비전 집중', tier: 0, col: 1, max: 3, cost: 1, desc: (r) => `비전 화살 피해 +${12 * r}%.` },
      { id: 'a_pierce', name: '꿰뚫는 화살', tier: 1, col: 0, max: 1, cost: 1, req: ['a_focus'], desc: () => '비전 화살이 적 하나를 꿰뚫고 날아간다.' },
      { id: 'a_flow', name: '울림 순환', tier: 1, col: 2, max: 2, cost: 1, req: ['a_focus'], desc: (r) => `마나 회복 속도 +${20 * r}%.` },
      { id: 'a_wave', name: '밀물 파동', tier: 2, col: 0, max: 1, cost: 2, req: ['a_pierce'], desc: () => '비전 파동의 범위가 35% 넓어지고, 맞은 적은 1.2초 동안 기절한다.' },
      { id: 'a_echo', name: '공명 증폭', tier: 2, col: 1, max: 2, cost: 2, req: ['a_pierce', 'a_flow'], desc: ranked(['공명 반응 배율 1.3 → 1.55. 비전이 적의 상태 이상을 1초 늘린다.', '공명 반응 배율 1.3 → 1.8. 비전이 적의 상태 이상을 2초 늘린다.']) },
      { id: 'a_afterimage', name: '잔상', tier: 2, col: 2, max: 1, cost: 2, req: ['a_flow'], desc: () => '순간이동한 자리에 비전 폭발(0.9P)이 남는다. 완벽 회피의 울림 가속이 1.5초 길어진다.' },
      { id: 'a_ult', name: '별의 노래', tier: 3, col: 1, max: 1, cost: 3, kind: 'ult', req: ['a_wave', 'a_echo', 'a_afterimage'], desc: () => '궁극기 (F). 조준한 곳에 유도 별똥별 14발이 쏟아진다. 한 발에 1.4P.' },
    ],
  },
  fire: {
    name: '화염', motto: '타오르고, 번지고, 태우는 길',
    nodes: [
      { id: 'f_heat', name: '달군 불씨', tier: 0, col: 1, max: 3, cost: 1, desc: (r) => `불씨 탄 피해 +${12 * r}%, 화상 피해 +${15 * r}%.` },
      { id: 'f_splash', name: '튀는 불씨', tier: 1, col: 0, max: 1, cost: 1, req: ['f_heat'], desc: () => '불씨 탄이 터지며 반경 2.2 안의 적에게 0.4P 피해와 화상을 입힌다.' },
      { id: 'f_kindle', name: '잉걸불', tier: 1, col: 2, max: 2, cost: 1, req: ['f_heat'], desc: (r) => `화상 지속 +${2 * r}초. 불타는 적이 받는 모든 피해 +${8 * r}%.` },
      { id: 'f_blaze', name: '불바다', tier: 2, col: 0, max: 1, cost: 2, req: ['f_splash'], desc: () => '화염구가 터진 자리에 4초간 불길이 남는다 (0.5초마다 0.3P, 화상).' },
      { id: 'f_overheat', name: '과열', tier: 2, col: 1, max: 2, cost: 2, req: ['f_splash', 'f_kindle'], desc: (r) => `2초 안에 연달아 쓰는 화염 마법은 겹칠 때마다 피해 +${6 * r}% (최대 5겹).` },
      { id: 'f_ashwalk', name: '재의 걸음', tier: 2, col: 2, max: 1, cost: 2, req: ['f_kindle'], desc: () => '불타는 적을 쓰러뜨리면 마나 8을 되찾고, 불이 주변 적에게 옮겨붙는다.' },
      { id: 'f_ult', name: '태양의 노래', tier: 3, col: 1, max: 1, cost: 3, kind: 'ult', req: ['f_blaze', 'f_overheat', 'f_ashwalk'], desc: () => '궁극기 (F). 하늘에서 거대한 불덩이가 떨어져 반경 7에 6P 피해, 6초간 불바다를 남긴다.' },
    ],
  },
  wind: {
    name: '바람', motto: '흐르고, 띄우고, 옮기는 길',
    nodes: [
      { id: 'w_edge', name: '날 선 바람', tier: 0, col: 1, max: 3, cost: 1, desc: (r) => `바람 칼날 피해 +${12 * r}%.${r >= 3 ? ' 관통 +2.' : ''}` },
      { id: 'w_tailwind', name: '순풍', tier: 1, col: 0, max: 1, cost: 1, req: ['w_edge'], desc: () => '활공할 때 기력 소모 −40%, 활공 속도 +25%.' },
      { id: 'w_gale', name: '드센 돌풍', tier: 1, col: 2, max: 2, cost: 1, req: ['w_edge'], desc: (r) => `돌풍 범위 +${25 * r}%, 띄우는 힘 +${20 * r}%.` },
      { id: 'w_dash', name: '질풍 걸음', tier: 2, col: 0, max: 1, cost: 2, req: ['w_tailwind'], desc: () => '순간이동 거리 +40%, 기력 소모 −30%. 공중에서 두 번 순간이동할 수 있다.' },
      { id: 'w_carrier', name: '바람의 전령', tier: 2, col: 1, max: 2, cost: 2, req: ['w_tailwind', 'w_gale'], desc: (r) => `화염 확산·눈보라·뇌전 확산의 범위 +${30 * r}%, 옮기는 상태가 ${r >= 2 ? '훨씬 ' : ''}강해진다.` },
      { id: 'w_vortex', name: '소용돌이', tier: 2, col: 2, max: 1, cost: 2, req: ['w_gale'], desc: () => '돌풍이 지나간 자리에 2.5초간 적을 끌어당기는 소용돌이가 남는다.' },
      { id: 'w_ult', name: '폭풍의 눈', tier: 3, col: 1, max: 1, cost: 3, kind: 'ult', req: ['w_dash', 'w_carrier', 'w_vortex'], desc: () => '궁극기 (F). 5초간 거대한 회오리를 두른다. 주위 적을 끊임없이 띄우고 할퀸다 (0.3초마다 0.45P).' },
    ],
  },
  frost: {
    name: '서리', motto: '멈추고, 가두고, 부수는 길',
    nodes: [
      { id: 'i_edge', name: '시린 파편', tier: 0, col: 1, max: 3, cost: 1, desc: (r) => `서리 파편 피해 +${12 * r}%.${r >= 3 ? ' 파편이 다섯 갈래로 날아간다.' : ''}` },
      { id: 'i_deep', name: '뼛속 한기', tier: 1, col: 0, max: 2, cost: 1, req: ['i_edge'], desc: (r) => `서리 마법이 쌓는 한기 +${30 * r}%, 빙결 시간 +${(0.6 * r).toFixed(1)}초.` },
      { id: 'i_lance', name: '빙하 창', tier: 1, col: 2, max: 1, cost: 1, req: ['i_edge'], desc: () => '서리 창의 얼음 가시가 8개에서 12개로 늘고, 폭이 넓어진다.' },
      { id: 'i_brittle', name: '부서지는 얼음', tier: 2, col: 0, max: 2, cost: 2, req: ['i_deep'], desc: (r) => `파쇄 피해 +${30 * r}%, 파쇄 범위 +${25 * r}%.` },
      { id: 'i_mantle', name: '서리 갑옷', tier: 2, col: 1, max: 1, cost: 2, req: ['i_deep', 'i_lance'], desc: () => '서리 창을 쓰면 3초간 받는 피해가 40% 줄어든다.' },
      { id: 'i_splinter', name: '얼음 조각', tier: 2, col: 2, max: 1, cost: 2, req: ['i_lance'], desc: () => '얼어붙은 채 쓰러진 적이 산산조각 나며 주변에 1P 피해와 한기 2를 퍼뜨린다.' },
      { id: 'i_ult', name: '겨울의 노래', tier: 3, col: 1, max: 1, cost: 3, kind: 'ult', req: ['i_brittle', 'i_mantle', 'i_splinter'], desc: () => '궁극기 (F). 반경 12 안의 모든 적을 즉시 얼린다 (보스는 한기 3). 2초 뒤 한꺼번에 부서지며 2.5P.' },
    ],
  },
  storm: {
    name: '번개', motto: '외치고, 잇고, 터뜨리는 길',
    nodes: [
      { id: 's_charge', name: '충전', tier: 0, col: 1, max: 3, cost: 1, desc: (r) => `전격 피해 +${12 * r}%.` },
      { id: 's_chain', name: '연쇄 번개', tier: 1, col: 0, max: 2, cost: 1, req: ['s_charge'], desc: (r) => `전격이 튀는 적 +${r}, 튄 번개의 피해 60% → ${60 + 10 * r}%.` },
      { id: 's_static', name: '정전기', tier: 1, col: 2, max: 1, cost: 1, req: ['s_charge'], desc: () => '감전 지속 +1.5초. 감전된 적이 받는 모든 피해 +12%.' },
      { id: 's_aftershock', name: '여진', tier: 2, col: 0, max: 1, cost: 2, req: ['s_chain'], desc: () => '낙뢰가 떨어진 뒤 주변 적 둘에게 작은 벼락(1.2P)이 뒤따른다.' },
      { id: 's_overload', name: '과충전', tier: 2, col: 1, max: 2, cost: 2, req: ['s_chain', 's_static'], desc: (r) => `과부하 반응 피해 +${25 * r}%, 폭발 범위 +${20 * r}%.` },
      { id: 's_conduct', name: '전도', tier: 2, col: 2, max: 2, cost: 2, req: ['s_static'], desc: (r) => `감전 연쇄의 사거리 +${30 * r}%, 감전 지속 피해 +${40 * r}%.` },
      { id: 's_ult', name: '천둥의 노래', tier: 3, col: 1, max: 1, cost: 3, kind: 'ult', req: ['s_aftershock', 's_overload', 's_conduct'], desc: () => '궁극기 (F). 3초 동안 반경 20 안의 적에게 벼락 10발이 떨어진다 (한 발에 2P, 감전).' },
    ],
  },
  water: {
    name: '물', motto: '적시고, 되비추고, 품는 길',
    nodes: [
      { id: 'wa_pressure', name: '수압', tier: 0, col: 1, max: 3, cost: 1, desc: (r) => `물방울 탄 피해 +${12 * r}%.${r >= 3 ? ' 맞은 자리가 터지며 주변 적을 적신다.' : ''}` },
      { id: 'wa_soak', name: '흠뻑', tier: 1, col: 0, max: 1, cost: 1, req: ['wa_pressure'], desc: () => '젖음이 7초에서 12초로 늘고, 젖은 적은 15% 느려진다.' },
      { id: 'wa_spring', name: '맑은 샘', tier: 1, col: 2, max: 2, cost: 1, req: ['wa_pressure'], desc: (r) => `해일을 쓰면 생명력을 하트 ${r === 1 ? '¼' : '½'}칸 되찾는다.` },
      { id: 'wa_bubble', name: '물방울 감옥', tier: 2, col: 0, max: 1, cost: 2, req: ['wa_soak'], desc: () => '해일에 맞은 가장 가까운 적을 2.5초간 물방울에 가둔다 (행동 불가, 떠오름).' },
      { id: 'wa_mirror', name: '되비추는 물결', tier: 2, col: 1, max: 1, cost: 2, req: ['wa_soak', 'wa_spring'], desc: () => '해일이 적의 투사체를 삼키고, 주인에게 되돌려 보낸다.' },
      { id: 'wa_steam', name: '김서림', tier: 2, col: 2, max: 2, cost: 2, req: ['wa_spring'], desc: (r) => `소화가 일어나면 짙은 김이 피어올라 반경 ${3 + r}의 적이 ${2 + r}초간 40% 느려진다.` },
      { id: 'wa_ult', name: '바다의 노래', tier: 3, col: 1, max: 1, cost: 3, kind: 'ult', req: ['wa_bubble', 'wa_mirror', 'wa_steam'], desc: () => '궁극기 (F). 조준한 곳에 4초간 소용돌이가 일어 적을 빨아들이고 적신 뒤, 무너지며 5P.' },
    ],
  },
  harmony: {
    name: '조화', motto: '두 노래가 만나는 자리',
    harmony: true,
    nodes: [
      { id: 'h_thunderrain', name: '벼락비', els: ['water', 'storm'], tier: 0, col: 0, max: 1, cost: 2, kind: 'harmony', desc: () => '젖은 적에게 번개 → 감전 연쇄의 감전 지속 피해가 2배, 연쇄 범위가 50% 넓어진다.' },
      { id: 'h_scald', name: '끓는 김', els: ['fire', 'water'], tier: 0, col: 1, max: 1, cost: 2, kind: 'harmony', desc: () => '불타는 적에게 물 → 소화가 더 이상 피해를 줄이지 않는다. 대신 끓는 김이 터져 1.6배 피해와 반경 3.5에 0.8P.' },
      { id: 'h_permafrost', name: '영구동토', els: ['frost', 'water'], tier: 0, col: 2, max: 1, cost: 2, kind: 'harmony', desc: () => '순간 빙결 시간이 2배. 젖은 채 얼어붙은 적의 파쇄 피해 +40%.' },
      { id: 'h_wildfire', name: '들불', els: ['fire', 'wind'], tier: 1, col: 0, max: 1, cost: 2, kind: 'harmony', desc: () => '화염 확산으로 옮겨붙은 불이 한 번 더 번진다. 화염 회오리 지속 +50%.' },
      { id: 'h_superconduct', name: '초전도', els: ['frost', 'storm'], tier: 1, col: 1, max: 1, cost: 2, kind: 'harmony', desc: () => '얼지 않고 한기만 서린 적에게 번개 → 초전도: 1.6배 피해, 갑옷 파괴, 한기 유지.' },
      { id: 'h_monsoon', name: '장대비', els: ['water', 'wind'], tier: 1, col: 2, max: 1, cost: 2, kind: 'harmony', desc: () => '젖은 적에게 바람 → 물보라가 흩날려 반경 6의 적을 모두 적신다.' },
      { id: 'h_firebolt', name: '불벼락', els: ['fire', 'storm'], tier: 2, col: 0, max: 1, cost: 2, kind: 'harmony', desc: () => '과부하가 터진 자리에 3초간 불길과 전류가 남는다 (0.4초마다 0.35P, 화상·감전).' },
      { id: 'h_thermal', name: '열교차', els: ['fire', 'frost'], tier: 2, col: 1, max: 1, cost: 2, kind: 'harmony', desc: () => '열충격·융해 피해 +40%. 열충격의 폭발 범위가 넓어진다.' },
      { id: 'h_prism', name: '프리즘', els: ['arcane', '*'], tier: 2, col: 2, max: 1, cost: 2, kind: 'harmony', desc: () => '공명이 적의 상태 이상을 모두 터뜨린다. 터뜨린 상태 하나마다 피해 +30%.' },
    ],
  },
};

export const TREE_ORDER = ['arcane', 'fire', 'wind', 'frost', 'storm', 'water', 'harmony'];

export const NODES = {};
for (const [tree, t] of Object.entries(TREES)) for (const n of t.nodes) { n.tree = tree; n.kind = n.kind || 'passive'; n.req = n.req || []; NODES[n.id] = n; }

export const ULTS = { arcane: 'a_ult', fire: 'f_ult', wind: 'w_ult', frost: 'i_ult', storm: 's_ult', water: 'wa_ult' };

// ------------------------------------------------------------------
export class Skills {
  constructor() {
    this.ranks = {};
    this.points = 0;
    this.earned = 0;
    this.gauge = 0;          // ultimate gauge 0..ULT_COST
    this.discovered = new Set(); // reaction ids seen
  }

  r(id) { return this.ranks[id] || 0; }
  has(id) { return this.r(id) > 0; }

  spentIn(tree) {
    let s = 0;
    for (const n of TREES[tree].nodes) s += this.r(n.id) * n.cost;
    return s;
  }
  treeOpen(tree) {
    const P = G.player;
    if (tree === 'harmony') return [...P.unlocked].filter((e) => e !== 'arcane').length >= 2;
    return P.unlocked.has(tree);
  }

  // why a node cannot be learned (null = can learn)
  blocker(id) {
    const n = NODES[id]; if (!n) return '알 수 없는 노래';
    const P = G.player;
    if (this.r(id) >= n.max) return '모두 익혔다';
    if (!this.treeOpen(n.tree)) return n.tree === 'harmony' ? '두 가지 이상의 속성을 깨우쳐야 한다' : `${EL_INFO[n.tree].name}의 노래를 아직 모른다`;
    if (n.kind === 'harmony') {
      for (const e of n.els) {
        if (e === '*') {
          const others = [...P.unlocked].filter((x) => x !== 'arcane' && this.spentIn(x) >= 2);
          if (others.length < 2) return '비전 외 두 속성에 각각 2점 이상';
          continue;
        }
        if (!P.unlocked.has(e)) return `${EL_INFO[e].name}의 노래가 필요하다`;
        if (this.spentIn(e) < 2) return `${EL_INFO[e].name} 나무에 2점 이상 필요`;
      }
    } else {
      if (this.spentIn(n.tree) < TIER_GATE[n.tier]) return `이 나무에 ${TIER_GATE[n.tier]}점 이상 필요`;
      if (n.req.length && !n.req.some((q) => this.has(q))) return `선행: ${n.req.map((q) => NODES[q].name).join(' 또는 ')}`;
    }
    if (this.points < n.cost) return `울림점 ${n.cost}점 필요`;
    return null;
  }

  learn(id) {
    if (this.blocker(id)) return false;
    const n = NODES[id];
    this.points -= n.cost;
    this.ranks[id] = this.r(id) + 1;
    G.audio.play('skill_learn');
    if (n.kind === 'ult' && this.r(id) === 1) G.hud.toast(`궁극기 <b>${n.name}</b> — <kbd>F</kbd> 로 쓴다 (울림 게이지가 가득 찼을 때)`, 5000);
    G.hud.updateSpells && G.hud.updateSpells();
    return true;
  }

  gain(n, why) {
    if (n <= 0) return;
    this.points += n; this.earned += n;
    if (G.hud && why) G.hud.toast(`울림점 <b>+${n}</b> · ${why} — <kbd>K</kbd> 울림 나무`, 4200);
    if (G.hud && G.hud.updateSP) G.hud.updateSP(true);
    if (G.story && G.story.once('sp_first')) setTimeout(() => G.hud.hint('<kbd>K</kbd> <b>울림 나무</b> — 울림점을 써서 속성마다 새로운 노래를 익힐 수 있습니다<br><small>나무에 점수를 쌓을수록 깊은 갈래가 열리고, 끝에는 궁극기가 있습니다</small>', 9), 1500);
  }

  // Ultimate gauge
  charge(v) {
    if (!Object.values(ULTS).some((id) => this.has(id))) return;
    const was = this.gauge >= ULT_COST;
    this.gauge = Math.min(ULT_COST, this.gauge + v);
    if (!was && this.gauge >= ULT_COST) { G.audio.play('ult_ready'); if (G.hud.ultReady) G.hud.ultReady(); }
  }
  ultFor(el) { const id = ULTS[el]; return id && this.has(id) ? id : null; }

  discover(reaction) {
    if (this.discovered.has(reaction)) return false;
    this.discovered.add(reaction); return true;
  }

  // Refund everything (used by the "잊기" / respec button)
  reset() {
    let back = 0;
    for (const [id, r] of Object.entries(this.ranks)) back += (NODES[id]?.cost || 0) * r;
    this.ranks = {}; this.points += back;
    return back;
  }

  save() { return { ranks: this.ranks, points: this.points, earned: this.earned, gauge: Math.round(this.gauge), disc: [...this.discovered] }; }
  load(d) {
    if (!d) return;
    this.ranks = {}; for (const [k, v] of Object.entries(d.ranks || {})) if (NODES[k]) this.ranks[k] = Math.min(v, NODES[k].max);
    this.points = d.points ?? 0; this.earned = d.earned ?? this.points; this.gauge = d.gauge ?? 0;
    this.discovered = new Set(d.disc || []);
  }

  // Points a player at this progress point should have (for old saves / dev presets)
  static expected(level, story) {
    let n = 2 * (level - 1);
    if (story) {
      if (story.flag('f_boss')) n += 2;
      if (story.flag('s_boss')) n += 2;
      if (story.chapter === 'post') n += 3;
      n += Math.floor(story.seedCount() / 4);
      n += Object.values(story.memories || {}).filter((v) => v === 'given' || v === 'have').length;
      for (let i = 1; i <= 3; i++) if (story.flag('bounty' + i)) n += 1;
    }
    return n;
  }
}

export function skillIcon(tree) { return tree === 'harmony' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8.5" cy="12" r="5.5"/><circle cx="15.5" cy="12" r="5.5"/></svg>' : null; }
export { ELEMENTS };
