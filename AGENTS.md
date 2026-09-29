# AGENTS.md — 울림지기 개발 가이드

이 저장소에서 작업하는 사람과 코딩 에이전트를 위한 문서입니다. 게임 소개와 조작은 [README.md](README.md), 세계관·수치·기획은 [docs/DESIGN.md](docs/DESIGN.md)를 보세요.

## 개요

- **스택**: Three.js r186 + Vite 8. 런타임 의존성은 `three` 하나뿐입니다.
- **에셋**: 모델, 텍스처, 효과음, 음악을 모두 코드로 생성합니다. 외부 파일은 `public/fonts/`의 폰트뿐입니다.
- **언어**: UI와 대사는 모두 한국어입니다. 코드 식별자와 주석은 영어입니다.
- **규모**: `src/` 아래 약 24,000줄, 45개 파일.

```bash
npm install
npm run dev              # http://localhost:5188 (PORT 환경변수로 변경 가능)
npx vite build           # 문법·번들 오류 확인용으로 가장 빠름
```

테스트 러너는 없습니다. 검증은 빌드 확인과 브라우저 실행(아래 "테스트 방법")으로 합니다.

## 구조

모든 시스템은 `src/core/context.js`의 전역 객체 **`G`**에 등록되고, 서로 `G.player`, `G.world`처럼 참조합니다. 생성자에 의존성을 넘기지 않습니다.

`Game.boot()`의 생성 순서가 중요합니다. World가 Player보다 먼저 만들어져야 정적 메시 합치기(bakeStatics)에 캐릭터가 섞이지 않습니다.

```
Input → Audio/Music → Renderer(scene, camera) → VFX → World → CameraRig
→ Combat → Spells → EnemyManager → NPCs → Skills → Player → Companion → Dialogue → HUD
```

프레임 갱신 순서(`Game.update`): 타이머(`G.later`) → 울림 가속(`G.slowmo`) → Player → Spells → Enemies(울림 가속 중엔 dt × 0.25) → NPCs → Companion → Story → Dialogue → 상호작용 → Camera → World → VFX → Audio/Music → HUD → 렌더.

| 폴더 | 파일 | 역할 |
|---|---|---|
| `core/` | `context.js` | 전역 `G`, 설정, 속성 목록(`ELEMENTS` 6종, `EL_INFO`, `EL_SVG`) |
| | `util.js` | 수학, 시드 노이즈, 조사 처리(`josa`, `fillName`) |
| | `input.js` | 키보드·마우스, 포인터 고정, 프레임 단위 눌림 판정 |
| | `audio.js` | WebAudio 합성 엔진: 공간 음향(거리 고역 감쇠), 근거리·원거리 두 잔향, 리미터, 환경음, 반복음(`loop`), `OfflineAudioContext` 사전 렌더 변주 |
| | `sfx/*.js` | 효과음 레시피(`spells`·`combat`·`ui`·`legacy`), 반복음(`loops`), 미리 만든 소리 질감(`textures`), 사전 렌더 목록(`registry`) |
| | `music.js` | 분위기별 절차적 음악(`MOODS`), 주제 선율 `THEME` |
| `render/` | `renderer.js` | 렌더러, MSAA 컴포저, 화면 굴절 패스(`distort`: 충격파·열기 아지랑이), 블룸, 색보정·충격 패스(`grade`) |
| | `materials.js` | 툰 재질(`toon`), 림 라이트, 바람 흔들림, 외곽선, 발광 재질 |
| | `particles.js` | CPU 시뮬레이션 + GPU 포인트 스프라이트 파티클. 모양 15종(불꽃 혀·흩어지는 연기·물방울·눈송이·잎·룬·전기 불꽃·거품 등), 3단 색 변화(`color`→`color2`→`color1`), 크기 곡선(`ease`), 소용돌이 난류 |
| | `fxmesh.js` | 메시 이펙트 부품: 노이즈로 일렁이며 침식되는 구체(`SPHERE_LOOK`: 불·연기·김·흙먼지·물·서리·비전·플라스마·번개·바람·먹구름), 초승달 베기(`slash`), 물보라 벽(`crown`), 물리 파편(`Debris`: 바위·얼음·불똥), 화면 굴절 물체(`Distort`) |
| | `crystal.js` | 수정 재질(`crystalMaterial`: 면 분할, 가짜 굴절, 내부 발광, 반짝임, 얼음 변형)과 모양(`crystalGeometry`: 기둥·군집·보석·조각), 후광 스프라이트 |
| | `vfx.js` | 파티클 프리셋, 조명 풀, 링, 룬 원진, 프랙탈 번개, 얼음 가시, 회오리, 광선, 경고 표시. 구체(`sphere`)·베기(`slash`)·물보라(`crownSplash`)·파편(`chunks`)·바람 선(`windLine`·`gustLines`)·굴절(`distort.ring`·`shell`·`haze`)·시전 모으기(`charge`)·습득 연출(`learn`). 속성별 레시피(`cast`·`impact`·`explode`·`strike`·`react`·`kill`·`dodge`·`ultCast`), 속도 방향 불꽃(`sparks`), 투사체 궤적(`ribbon`), 지형을 따르는 바닥 흔적(`decal`: 그을음·서리·물웅덩이·번개 자국 등), 충격 구체·빛기둥(`shock`·`pillar`), 잔여 효과(`linger`) |
| `world/` | `layout.js` | 랜드마크 좌표(`POI`), 길(`PATHS`), 지역(`REGIONS`) |
| | `terrain.js` | 높이맵 지형, 채색, 높이·법선·레이캐스트 조회 |
| | `sky.js` · `water.js` · `grass.js` | 하늘과 낮밤, 물, 풀(청크 단위 스트리밍) |
| | `props.js` · `buildings.js` | 나무·바위 인스턴싱, 건물 생성 함수 |
| | `collision.js` | 원·박스 충돌체와 밟을 수 있는 발판 |
| | `world.js` | 위 모든 것의 배치, 등석·씨앗·기억 물건, 정적 메시 합치기, 환경 연출 |
| `game/` | `game.js` | 부팅, 타이틀, 메인 루프, 메뉴, 저장·불러오기, 사망, 등석, 음악 선택 |
| | `player.js` | 이동(달리기·순간이동·점프·활공·수영), 시전, 능력치 |
| | `camera.js` | 어깨 너머 카메라, 지형 충돌, 흔들림(부드러운 노이즈+회전), 방향성 반동(`kick`·`impact`), FOV 펀치, 대상 고정, 컷씬 카메라. 조준은 흔들림이 빠진 `aimRay()`를 씁니다 |
| | `spells.js` | 기본 마법, 고유 마법, 엮기, 궁극기, 투사체, 지속 효과 영역(`field`·`vortex`·`wave`) |
| | `combat.js` | 피해 계산, 상태 이상, 원소 반응(`pickReaction`), 연쇄 반응, 울림 나무 수정치 |
| | `skills.js` | 울림 나무(스킬 트리) 데이터 `TREES`, 울림점, 궁극기 게이지, 반응 도감 |
| | `enemies.js` | 적 정의(`DEF`), 레벨 단계, AI 클래스, 보스, 무리(`CAMPS`), 드롭 |
| | `characters.js` | 캐릭터 팩토리 모음(재수출)과 리그 계약·표정/몸짓 API 설명 |
| | `charkit.js` | 조각 도구(`tube`·`blob`·`sheet`), 뼈대 정의 `SkelDef`, 자동 스킨 가중치, 그린 얼굴·재 균열·줄무늬 재질, 스킨 외곽선, 2본 IK, 베를레 사슬(`Chain`) |
| | `humanoid.js` · `humanrig.js` | 사람형 몸·옷·머리카락·모자·소품 조각(`CHAR` 항목별로 한 번 생성), 사람형 리그(발 디딤 IK, 상태 블렌딩, 표정, 몸짓), `makeGhost` |
| | `creatures.js` | 비사람형 리그 바탕 `CreatureRig`, 보름(`makeFox`), 누룽지(`makeCat`) |
| | `enemybodies.js` · `enemycreatures.js` | 적 몸체: 사람형 리그 위(허깨비·돌무덤·기사·방패지기·사수)와 생물 리그(울음탈·잿물·재나방·뿌리손·망루지기) |
| | `npcs.js` · `dialogue.js` | NPC와 보름(동료), 대화창(타자 효과·목소리·선택지) |
| | `story.js` | 장별 스크립트, 퀘스트, 곁가지, NPC 대화 분기, 이벤트 훅 |
| | `hud.js` | HUD 전반, 지도, 여정·마법서(반응 도감), 울림 나무 화면 |

## 반드시 지킬 규칙

### 좌표와 높이
- 북쪽이 `-Z`입니다. 지면 높이는 `G.world.h(x, z)`, 발판까지 포함한 높이는 `G.world.ground(x, z, y)`로 구합니다.
- **컷씬 카메라와 연출 위치는 반드시 지면 기준으로 잡으세요.** `story.js`의 `GV(x, dy, z)`를 쓰면 됩니다. 절대 y값을 쓰다가 카메라가 지형 아래로 들어간 적이 있습니다(마을 지면이 y≈8).

### 시간
- 게임 로직의 지연은 `G.later(fn, ms)`를 쓰세요. 게임 시간 기준이라 일시정지와 적중 정지를 따릅니다. `setTimeout`은 UI 연출에만 씁니다.
- `G.slowmo`(실제 시간 초)가 남아 있는 동안 적과 적 투사체는 1/4 속도로 움직입니다. 적 로직에서 `setTimeout`을 쓰면 이 감속을 따르지 않으니 상태 타이머나 `G.later`를 쓰세요.
- `G.time`은 게임 시간(적중 정지 중 느려짐), `G.realTime`은 실제 시간입니다.

### 재질과 발광
- `toon(color, opts)`는 같은 인자면 캐시된 재질을 돌려줍니다. **캐시된 재질을 직접 수정하지 마세요.** 개별로 바꿔야 하면 `{ nocache: true }`를 주세요. 적은 피격 번쩍임 때문에 모두 개별 재질입니다.
- 블룸 임계값이 1.35(선형 HDR)입니다. 빛나야 하는 것만 이 값을 넘기세요. 눈·설원처럼 밝은 표면의 알베도를 1 가까이 두면 화면이 하얗게 날아갑니다.


### 이펙트와 소리
- 이펙트는 가능하면 풀을 쓰는 `G.vfx` 함수로 만듭니다. 새 `Mesh`·재질을 매번 만들면 첫 사용 때 셰이더 컴파일로 끊기니, 새 부품을 풀에 넣었다면 `VFX.prewarm()`에도 추가하세요.
- 구체(`sphere(look, pos, o)`)는 `dur <= 0`이면 `end()`를 부를 때까지 유지되고, `follow`에 벡터를 주면 따라갑니다. 투사체 핵은 `mini: true` 풀(16개)을 쓰고, 모자라면 프레넬 구로 대신합니다.
- 화면 굴절(`G.vfx.distort`)은 별도 장면에 그려 반해상도 목표에 오프셋을 쓰고, 활성 물체가 없으면 패스가 꺼집니다. 그래픽 품질 '낮음'에서는 만들지 않습니다.
- 고유 마법은 `WINDUP`(속성별 0.1~0.2초) 동안 지팡이 끝에 힘을 모은 뒤(`charge_<속성>` 소리, `vfx.charge`) 그 순간의 조준점으로 나갑니다(`Spells.heavyRelease`).
- 계속 나는 소리는 `G.audio.loop(name, { pos, v, max })`로 만들고 매 프레임 `set(pos)`, 끝날 때 `stop(fade)`를 부릅니다. 엔진이 준비되지 않았으면 아무것도 하지 않는 핸들이 돌아옵니다. `spells.js`의 `sndLoop()`를 쓰면 됩니다.
- 큰 마법의 마무리 소리는 `blast_<속성>`, 궁극기는 `ult_boom`(속성을 주면 `blast_<속성>`을 겹침)입니다. 같은 순간에 둘을 겹치지 않도록 `Spells.explode(..., { quiet: true })`를 쓰세요.
### 정적 메시 합치기 (`World.bakeStatics`)
- 부팅 시 씬 최상위 Group 안의 툰 메시를 재질·구역별로 하나로 합칩니다(드로우콜 약 1,450 → 500).
- **움직이거나 재질이 바뀌는 부분은 그 Group의 `userData`에 Object3D(또는 배열)로 넣어야 합치기에서 빠집니다.** 예: 종 `bell`, 풍차 `rotor`, 성소 `crystal`·`seal`. 상호작용 대상(`world.targets`)의 `obj`도 제외됩니다.
- 투명 재질과 흔들림(`sway`) 재질은 자동으로 제외됩니다.
- 합칠 필요가 없는 Group에는 `userData.noBake = true`를 주세요.

### 전투
- 모든 피해는 `G.combat.hit(target, h)`로 넣습니다. `h`의 주요 필드:
  - 필수: `dmg`, `el`
  - 선택: `pos`, `dir`, `knock`, `lift`, `heavy`, `status`, `noReact`, `noStatus`, `hitstop`, `shake`
  - `source`: `'player'`(치명타·피드백 있음), `'enemy'`, `'dot'`(숫자만), `'env'`, `'fall'`
- 반응은 `Combat.resolve` 한 곳에서 처리합니다. 연쇄 피해에는 `noReact: true`를 붙여 무한 연쇄를 막으세요.
- 적이 아닌 대상(예: 최종 보스의 결계판 `Plate`)은 `receive(h)`를 구현하면 `hit()`이 그쪽으로 넘깁니다.

### 울림 나무 (스킬)
- 노드는 `skills.js`의 `TREES`에 데이터로 추가합니다: `{ id, name, tier, col, max, cost, req, kind, desc(r) }`. `req`는 **하나만** 익혀도 되는 선행 목록, `tier`는 나무에 쓴 점수 조건(`TIER_GATE = [0, 1, 2, 4, 7]`)과 화면 위치를, `col`(0~2)은 가로 위치를 정합니다. 속성 나무는 5단(0~4), 조화의 나무는 4단(0~3)이고 화면은 나무의 `maxTier`에 맞춰 배치됩니다. 조화 노드는 `els: [속성, 속성]`과 `req: ['h_weave']`를 씁니다.
- **기술(`kind: 'active'`)**: 각 속성 나무의 0단은 고유 마법을 여는 노드(`SIG` 맵: `a_sig`·`f_sig`·`w_sig`·`i_sig`·`s_sig`·`wa_sig`, `sigOf(el)`)이고, 조화의 0단 `h_weave`(`WEAVE_NODE`)가 엮기를 엽니다. `player.castHeavy`/`castWeave`는 `canHeavy()`/`canWeave()`로 이를 확인합니다. 기술 노드의 이름·설명의 마나·재사용 값은 `spells.js`의 `HEAVY`·`WEAVE_COST`를 **지연해서** 읽습니다(`spells.js`가 `skills.js`를 import하므로 모듈 평가 시점에 읽으면 순환 참조 오류).
- 이야기 보상이나 이전 저장 이전처럼 점수 없이 익히게 하려면 `G.skills.grant(id, { silent, quiet, sound })`를 씁니다. 받은 노드는 `granted`에 기록되어 "모두 잊기"에서 남고 환급되지 않습니다. `grantBasics()`는 깨우친 속성의 고유 마법과(속성 둘 이상이면) 엮기를 한꺼번에 줍니다.
- 익힐 때 공통 처리(소리 `skill_learn`/`skill_unlock_active`, `G.vfx.learn(나무, 종류, 위치)` 연출, 알림, HUD 갱신)는 `Skills.afterLearn`에 있습니다.
- 효과는 쓰는 쪽에서 `G.skills.r(id)`(단계) 또는 `G.skills.has(id)`로 조회합니다. `spells.js`·`combat.js`는 파일 안의 `R(id)` 도우미를 씁니다. 수치를 바꾸면 `desc`와 [docs/DESIGN.md](docs/DESIGN.md#울림-나무-스킬-트리)도 함께 고치세요.
- 궁극기는 `kind: 'ult'`이고 `ULTS`에 속성별로 등록합니다. 구현은 `Spells.ult(el, …)`.
- 울림점 지급은 `G.skills.gain(n, 이유)`로 합니다. 이유 문자열은 알림에 그대로 나옵니다.
- **울림의 갈림길**: 레벨업(`player.addXP`)은 울림점과 함께 `G.skills.cross`를 늘립니다. `Game.update`가 `crossroadsSafe()`(자유 이동·메뉴 없음·전투/대화 아님·지상)가 실제 시간 2.2초 이어지면(스크립트 전투의 파 사이 `sleep`보다 길게) 메뉴 id `'crossroads'`를 엽니다(`Game.openCrossroads` → `HUD.openCrossroads`). 카드는 `Skills.offer(3, seed)`가 고릅니다. <kbd>1</kbd>~<kbd>3</kbd>/클릭은 `HUD.crPick`, <kbd>Esc</kbd>는 `crKeep`(남은 갈림길 모두 넘기고 점수 보관), <kbd>K</kbd>는 `crTree`.

### 마나
- 소모는 `player.spend(cost)`, 회복은 `player.gainMana(n, { src, n })`로 합니다(HUD 반짝임 포함). 자연 회복은 `manaRegenRate(inCombat)`: 마지막 소모 1.4초 뒤부터 전투 중 `(5 + 0.25 × 레벨) × (1 + 0.25 × a_flow)`, 전투 밖 22/초.
- 적 처치 마나 방울은 `EnemyManager.drop`/`makePickup`/`absorbPickup`(enemies.js 끝부분)에 있습니다. 반응 +3은 `Combat.resolve`, 완벽 회피 +15는 `player.perfectDodge`.
- 마법 비용은 `spells.js`(`BOLT[el].cost`, `HEAVY[el].cost`, `WEAVE_COST`)가 원본입니다. HUD·설명에 숫자를 하드코딩하지 마세요.
- 관련 소리: `mana_orb`(`{ n }` 연속 흡수 수), `mana_low`, `mana_full`, `mana_empty`, `levelup_open`, `skill_pick`, `skill_unlock_active`. 새 이름은 `G.audio.S`에 없으면 기존 소리(`pickup`, `skill_learn`, `ui_open`)로 대체합니다.

### 원소 반응 추가
1. `combat.js`의 `REACTIONS`에 `{ name, color, els: [상태, 발동 속성], desc }`를 넣습니다(`els`는 반응 도감 아이콘).
2. `pickReaction()`에 조건을, `resolve()`의 `switch`에 효과를 추가합니다. 연쇄 피해에는 `noReact: true`.
3. 보름의 첫 반응 대사는 `story.js`의 `onReaction`에 넣습니다.

### 적 추가
1. `enemies.js`의 `DEF`에 항목을 추가합니다(`name`, `hp`, `dmg`, `speed`, `radius`, `height`, `xp`, `aggro`, `resist`, `make`).
2. `enemybodies.js`(사람형) 또는 `enemycreatures.js`(생물형)에 몸체 생성 함수를 만들고 `characters.js`에서 재수출합니다. `rig.mats`(개별 툰 재질, 피격 번쩍임·디졸브용)와 `rig.glowMats`(레벨 단계 색이 입혀지는 발광 재질)를 반드시 채우세요. 몸은 재질 그룹마다 스킨 메시 하나로 나뉘므로 메시마다 재질이 하나입니다. 발광 재질은 `glowBasic()`으로 만들면 디졸브 중간에 숨겨지고, 재 균열 재질(`crackMat`)에 그 색 객체를 넘기면 균열도 단계 색을 따릅니다.
3. 행동이 다르면 `Enemy`를 상속한 클래스를 만들고 `EnemyManager.spawn()` 분기에 추가합니다.
4. 필드에 배치하려면 `CAMPS`에 넣습니다.

이름은 `TIERS`(해묵은 / 잊힌 / 이름 없는)와 정예 수식어가 자동으로 붙습니다.

### 스토리
- 각 장은 `async` 함수이고, **플래그를 보고 이미 끝난 단계는 건너뛰도록** 짭니다. 저장 후 불러오면 같은 함수가 처음부터 다시 실행되기 때문입니다.
- 대기 도구:
  - `this.wait(cond)`: 매 프레임 조건 검사
  - `this.sleep(sec)`: 게임 시간 기준 대기
  - `this.conv(async () => {...})`: 대화 모드 진입과 종료를 감쌈
  - `this.scriptedWave(spawnFn, center, radius)`: 스크립트 전투 한 파. 플레이어가 쓰러지면 남은 적을 지우고 다시 생성합니다. 적이 모두 죽어야 끝나는 전투는 반드시 이것으로 감싸세요.
  - `this.bossFight(make, center, radius, tip)`: 보스전. 쓰러지면 보스를 초기화하고, 다시 다가가기 전에 보름이 `tip`을 말합니다.
- 체크포인트: `set()`, `done()`, 기억·씨앗·보고 같은 진행이 일어나면 `this.dirty`가 서고, 플레이어가 전투 밖·지상·자유 상태가 되는 순간 자동 저장합니다. 새 진행 지점을 만들면 `this.dirty = true`를 잊지 마세요.
- 보름의 `cSay(text, onceKey)` 1회성 대사는 `Story.saidOnce`에 `c:` 접두어로 저장됩니다.
- NPC에게 말을 걸면 항상 `talkNPC(id)`로 들어옵니다. 메인 스토리 → 곁가지 → 일상 대화 순으로 분기합니다.
- 대사 표기:
  - `*강조*`: 금색 강조
  - `[텍스트|fire]`: 속성 색 (`fire`/`frost`/`storm`/`wind`/`arcane`)
  - `{n}`, `{n:이}`, `{n:을}`, `{n:아}` 등: 플레이어 이름 + 받침에 맞는 조사
- 연기: `this.say(who, text, { expr, gesture })`로 화자의 표정(`smile`·`sad`·`surprised`·`worried`·`tender`·`determined`·`laugh` 등)과 몸짓(`nod`·`shake`·`bow`·`point`·`sigh`·`shrug`·`handToChest`·`wave`·`think` 등)을 지정합니다. 화자는 자동으로 플레이어를 바라보고, 대화가 끝나면 표정이 돌아옵니다. 목록은 `characters.js` 머리말에 있습니다.
- 대화창: <kbd>L</kbd> 지난 대사, <kbd>Esc</kbd> 길게 누르기로 빨리 넘기기(선택지에서는 멈춤). 화자가 바뀌면 카메라가 0.65초 동안 블렌드되고 말하는 동안 천천히 다가갑니다. 컷씬에서 `G.cameraRig.setCine`을 직접 부르면 대화 카메라는 자동으로 손을 뗍니다.
- 인물별 말투는 [docs/DESIGN.md](docs/DESIGN.md#인물과-말투)를 따르세요. 한 인물의 말투가 흔들리면 몰입이 크게 깨집니다.

### 저장
- `localStorage`의 `ullimjigi_save_v1`(진행)과 `ullimjigi_settings`(설정)를 씁니다. 울림 나무는 `skills` 필드(`v: 2`, 단계, 남은 점수, 게이지, 반응 도감, `granted`, 남은 갈림길 `cross`)에 들어갑니다. `skills`가 없는 이전 저장은 `Skills.expected()`로 점수를 계산해 지급하고, `skills.v`가 없거나 2 미만이면 `grantBasics()`로 이미 쓰던 고유 마법과 엮기를 무료로 줍니다. `p_heavy` 플래그가 있으면 `Story.start`가 `f_sig`를 보장합니다.
- 저장 형식을 바꾸면 기존 저장과 호환되는지 확인하세요. `Story.load`는 없는 필드에 기본값을 넣어 줍니다.

## 테스트 방법

### 개발용 프리셋
주소에 `?dev=<프리셋>`을 붙이면 타이틀을 건너뜁니다.

| 프리셋 | 시작 지점 |
|---|---|
| `1` | 프롤로그 |
| `village` | 1장 |
| `bells` | 2장 시작 (마을) |
| `frost` | 서리봉 성소 앞 |
| `storm` | 천둥 고원 앞 (서리 완료) |
| `mora` | 3장 |
| `rift` | 4장 (틈 입구 근처, 물 포함 6속성) |
| `lake` | 2장, 물의 노래를 얻기 전 거울 호숫가 |
| `skills` | 3장, 6속성·Lv 12·울림점 26점·게이지 가득 (스킬 테스트용) |

`1`을 뺀 프리셋은 깨우친 속성의 고유 마법과 엮기를 무료로 받습니다(`grantBasics`). 갈림길을 보려면 `__G.player.addXP(5000)` 후 자유 이동 상태로 두세요(`village` 프리셋은 시작하자마자 대화가 이어지므로 `skills`가 편합니다).
| `continue` | 저장 불러오기 |

캐릭터만 따로 보려면 개발 서버에서 `/charview.html`을 엽니다(게임 빌드에는 포함되지 않는 뷰어).

`?dev` 모드는 `requestAnimationFrame` 대신 16ms 타이머로 루프를 돕니다. **브라우저 창이 가려져 있으면 rAF가 멈추기 때문입니다.** 일반 모드(타이틀부터)는 창이 보이는 상태에서만 확인할 수 있습니다.

### 콘솔에서 조작하기
`window.__G`로 게임 상태에 접근할 수 있습니다.
- **입력 흉내**: `G.input.keys.add('KeyW')`(누르고 있기), `G.input.pressed.add('KeyE')`(한 번 누르기), `G.input.mouse.pressed.add(0)`(클릭)
- **조준**: `G.player.lockTarget = 적`으로 대상을 고정하면 자동으로 조준됩니다.
- **스킬**: `G.skills.learn('wa_ult')`, `G.skills.grant('i_sig')`, `G.skills.points += 10`, `G.skills.gauge = 100` 후 `G.player.castUlt()`. 울림 가속은 `G.player.tryBlink(); G.player.damage(1)`로 확인합니다.
- **성능**: `G.game.perf`에서 프레임별 갱신·렌더 시간, 드로우콜, 삼각형 수를 봅니다.
- **스크립트 도구 제한**: 브라우저 자동화 도구는 한 번에 약 45초까지만 실행됩니다. 긴 전투 테스트는 백그라운드 루프로 돌리고 결과를 `window`에 담아 따로 확인하세요.
- **헤드리스 스크린숏**: 소프트웨어 렌더링(swiftshader)에서는 스크린숏이 수십 초~수 분 걸릴 수 있습니다. 찍기 직전에 `__G.renderer.render`를 잠시 빈 함수로 바꿨다가 되돌리면 빨라집니다. 전체 화면 `backdrop-filter`나 큰 요소의 무한 애니메이션은 소프트웨어 합성에서 매우 느리니 메뉴 연출에 쓰지 마세요.

### 성능 기준
마을 기준으로 드로우콜 약 500-900, 삼각형 약 100만입니다(헤드리스 측정, 식생·조형 캐릭터 포함). 캐릭터는 사람형 6,500-10,000, 일반 적 2,500-10,000 삼각형이며 형태별로 기하를 공유합니다. 이보다 크게 늘어나는 변경은 합치기나 인스턴싱을 검토하세요.

## 알려진 한계와 할 일
- 실제 마우스 조작감과 소리는 사람이 직접 확인해야 합니다. 자동 테스트로는 오류 없이 실행되는 것까지만 확인했습니다.
- 보스 밸런스는 회피하지 않는 자동 조작 기준입니다(서리무덤 파수꾼 약 15초, 무명의 기사 약 23초). 사람 기준 목표는 각각 1분 안팎입니다.
- 적 이동은 충돌체를 밀어내기만 하고 길찾기는 없습니다.
- 등반은 없습니다. 활공, 순간이동, 공중에서 쓰는 바람 고유 마법(상승 기류)으로 대신합니다.
- 번들이 약 1.3MB(gzip 386KB) 한 덩어리입니다. 필요하면 코드 분할을 검토하세요.
- 그래픽 품질 '낮음'은 풀·그림자·소품 수만 줄이고, 새 질감·잎 가장자리 셰이더는 끄지 않습니다. 저사양 대응이 필요하면 여기부터 보세요.
- 적이 넘어졌다 일어나는 동작은 몸 전체를 기울이는 방식이며 별도의 일어서기 애니메이션은 없습니다.
