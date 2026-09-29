# AGENTS.md — 울림지기 개발 가이드

이 저장소에서 작업하는 사람과 코딩 에이전트를 위한 문서입니다. 게임 소개와 조작은 [README.md](README.md), 세계관·수치·기획은 [docs/DESIGN.md](docs/DESIGN.md)를 보세요.

## 개요

- **스택**: Three.js r186 + Vite 8. 런타임 의존성은 `three` 하나뿐입니다.
- **에셋**: 모델, 텍스처, 효과음, 음악을 모두 코드로 생성합니다. 외부 파일은 `public/fonts/`의 폰트뿐입니다.
- **언어**: UI와 대사는 모두 한국어입니다. 코드 식별자와 주석은 영어입니다.
- **규모**: `src/` 아래 약 11,400줄, 31개 파일.

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
→ Combat → Spells → EnemyManager → NPCs → Player → Companion → Dialogue → HUD
```

프레임 갱신 순서(`Game.update`): 타이머(`G.later`) → Player → Spells → Enemies → NPCs → Companion → Story → Dialogue → 상호작용 → Camera → World → VFX → Audio/Music → HUD → 렌더.

| 폴더 | 파일 | 역할 |
|---|---|---|
| `core/` | `context.js` | 전역 `G`, 설정, 속성 목록(`ELEMENTS`, `EL_INFO`, `EL_SVG`) |
| | `util.js` | 수학, 시드 노이즈, 조사 처리(`josa`, `fillName`) |
| | `input.js` | 키보드·마우스, 포인터 고정, 프레임 단위 눌림 판정 |
| | `audio.js` | WebAudio 합성 효과음 라이브러리(`S.*`), 공간 음향, 환경음 |
| | `music.js` | 분위기별 절차적 음악(`MOODS`), 주제 선율 `THEME` |
| `render/` | `renderer.js` | 렌더러, MSAA 컴포저, 블룸, 색보정·충격 패스(`grade`) |
| | `materials.js` | 툰 재질(`toon`), 림 라이트, 바람 흔들림, 외곽선, 발광 재질 |
| | `particles.js` | CPU 시뮬레이션 + GPU 포인트 스프라이트 파티클 |
| | `vfx.js` | 파티클 프리셋, 조명 풀, 링, 룬 원진, 번개, 얼음, 회오리, 광선, 경고 표시 |
| `world/` | `layout.js` | 랜드마크 좌표(`POI`), 길(`PATHS`), 지역(`REGIONS`) |
| | `terrain.js` | 높이맵 지형, 채색, 높이·법선·레이캐스트 조회 |
| | `sky.js` · `water.js` · `grass.js` | 하늘과 낮밤, 물, 풀(청크 단위 스트리밍) |
| | `props.js` · `buildings.js` | 나무·바위 인스턴싱, 건물 생성 함수 |
| | `collision.js` | 원·박스 충돌체와 밟을 수 있는 발판 |
| | `world.js` | 위 모든 것의 배치, 등석·씨앗·기억 물건, 정적 메시 합치기, 환경 연출 |
| `game/` | `game.js` | 부팅, 타이틀, 메인 루프, 메뉴, 저장·불러오기, 사망, 등석, 음악 선택 |
| | `player.js` | 이동(달리기·순간이동·점프·활공·수영), 시전, 능력치 |
| | `camera.js` | 어깨 너머 카메라, 지형 충돌, 흔들림, 대상 고정, 컷씬 카메라 |
| | `spells.js` | 기본 마법, 고유 마법, 엮기, 투사체, 지속 효과 영역 |
| | `combat.js` | 피해 계산, 상태 이상, 원소 반응 |
| | `enemies.js` | 적 정의(`DEF`), 레벨 단계, AI 클래스, 보스, 무리(`CAMPS`), 드롭 |
| | `characters.js` | 절차적 캐릭터 리그와 애니메이션, 적 몸체 |
| | `npcs.js` · `dialogue.js` | NPC와 보름(동료), 대화창(타자 효과·목소리·선택지) |
| | `story.js` | 장별 스크립트, 퀘스트, 곁가지, NPC 대화 분기, 이벤트 훅 |
| | `hud.js` | HUD 전반, 지도, 여정·마법서 |

## 반드시 지킬 규칙

### 좌표와 높이
- 북쪽이 `-Z`입니다. 지면 높이는 `G.world.h(x, z)`, 발판까지 포함한 높이는 `G.world.ground(x, z, y)`로 구합니다.
- **컷씬 카메라와 연출 위치는 반드시 지면 기준으로 잡으세요.** `story.js`의 `GV(x, dy, z)`를 쓰면 됩니다. 절대 y값을 쓰다가 카메라가 지형 아래로 들어간 적이 있습니다(마을 지면이 y≈8).

### 시간
- 게임 로직의 지연은 `G.later(fn, ms)`를 쓰세요. 게임 시간 기준이라 일시정지와 적중 정지를 따릅니다. `setTimeout`은 UI 연출에만 씁니다.
- `G.time`은 게임 시간(적중 정지 중 느려짐), `G.realTime`은 실제 시간입니다.

### 재질과 발광
- `toon(color, opts)`는 같은 인자면 캐시된 재질을 돌려줍니다. **캐시된 재질을 직접 수정하지 마세요.** 개별로 바꿔야 하면 `{ nocache: true }`를 주세요. 적은 피격 번쩍임 때문에 모두 개별 재질입니다.
- 블룸 임계값이 1.35(선형 HDR)입니다. 빛나야 하는 것만 이 값을 넘기세요. 눈·설원처럼 밝은 표면의 알베도를 1 가까이 두면 화면이 하얗게 날아갑니다.

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

### 적 추가
1. `enemies.js`의 `DEF`에 항목을 추가합니다(`name`, `hp`, `dmg`, `speed`, `radius`, `height`, `xp`, `aggro`, `resist`, `make`).
2. `characters.js`에 몸체 생성 함수를 만듭니다. `rig.mats`(개별 툰 재질, 피격 번쩍임용)와 `rig.glowMats`(레벨 단계 색이 입혀지는 발광 재질)를 반드시 채우세요.
3. 행동이 다르면 `Enemy`를 상속한 클래스를 만들고 `EnemyManager.spawn()` 분기에 추가합니다.
4. 필드에 배치하려면 `CAMPS`에 넣습니다.

이름은 `TIERS`(해묵은 / 잊힌 / 이름 없는)와 정예 수식어가 자동으로 붙습니다.

### 스토리
- 각 장은 `async` 함수이고, **플래그를 보고 이미 끝난 단계는 건너뛰도록** 짭니다. 저장 후 불러오면 같은 함수가 처음부터 다시 실행되기 때문입니다.
- 대기 도구:
  - `this.wait(cond)`: 매 프레임 조건 검사
  - `this.sleep(sec)`: 게임 시간 기준 대기
  - `this.conv(async () => {...})`: 대화 모드 진입과 종료를 감쌈
- NPC에게 말을 걸면 항상 `talkNPC(id)`로 들어옵니다. 메인 스토리 → 곁가지 → 일상 대화 순으로 분기합니다.
- 대사 표기:
  - `*강조*`: 금색 강조
  - `[텍스트|fire]`: 속성 색 (`fire`/`frost`/`storm`/`wind`/`arcane`)
  - `{n}`, `{n:이}`, `{n:을}`, `{n:아}` 등: 플레이어 이름 + 받침에 맞는 조사
- 인물별 말투는 [docs/DESIGN.md](docs/DESIGN.md#인물과-말투)를 따르세요. 한 인물의 말투가 흔들리면 몰입이 크게 깨집니다.

### 저장
- `localStorage`의 `ullimjigi_save_v1`(진행)과 `ullimjigi_settings`(설정)를 씁니다.
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
| `rift` | 4장 (틈 입구 근처) |
| `continue` | 저장 불러오기 |

`?dev` 모드는 `requestAnimationFrame` 대신 16ms 타이머로 루프를 돕니다. **브라우저 창이 가려져 있으면 rAF가 멈추기 때문입니다.** 일반 모드(타이틀부터)는 창이 보이는 상태에서만 확인할 수 있습니다.

### 콘솔에서 조작하기
`window.__G`로 게임 상태에 접근할 수 있습니다.
- **입력 흉내**: `G.input.keys.add('KeyW')`(누르고 있기), `G.input.pressed.add('KeyE')`(한 번 누르기), `G.input.mouse.pressed.add(0)`(클릭)
- **조준**: `G.player.lockTarget = 적`으로 대상을 고정하면 자동으로 조준됩니다.
- **성능**: `G.game.perf`에서 프레임별 갱신·렌더 시간, 드로우콜, 삼각형 수를 봅니다.
- **스크립트 도구 제한**: 브라우저 자동화 도구는 한 번에 약 45초까지만 실행됩니다. 긴 전투 테스트는 백그라운드 루프로 돌리고 결과를 `window`에 담아 따로 확인하세요.

### 성능 기준
마을 기준으로 드로우콜 약 500, 삼각형 약 32만입니다. 이보다 크게 늘어나는 변경은 합치기나 인스턴싱을 검토하세요.

## 알려진 한계와 할 일
- 실제 마우스 조작감과 소리는 사람이 직접 확인해야 합니다. 자동 테스트로는 오류 없이 실행되는 것까지만 확인했습니다.
- 보스 밸런스는 회피하지 않는 자동 조작 기준입니다(서리무덤 파수꾼 약 15초, 무명의 기사 약 23초). 사람 기준 목표는 각각 1분 안팎입니다.
- 적 이동은 충돌체를 밀어내기만 하고 길찾기는 없습니다.
- 등반은 없습니다. 활공, 순간이동, 공중에서 쓰는 바람 고유 마법(상승 기류)으로 대신합니다.
- 번들이 약 940KB(gzip 270KB) 한 덩어리입니다. 필요하면 코드 분할을 검토하세요.
