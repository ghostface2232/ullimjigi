# AGENTS.md — 울림지기 개발 가이드

이 저장소에서 작업하는 사람과 코딩 에이전트를 위한 문서입니다. 게임 소개와 조작은 [README.md](README.md), 세계관·수치·기획은 [docs/DESIGN.md](docs/DESIGN.md), 맵·이야기·콘텐츠 확장 계획은 [docs/EXPANSION.md](docs/EXPANSION.md)를 보세요.

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
| `render/` | `renderer.js` | 렌더러, MSAA 컴포저, 블룸(`BloomPass`: 밉만 만들고 합성은 마지막 패스에서), 마지막 패스(`grade`: 화면 굴절·블룸 더하기·색보정·충격·톤매핑·sRGB를 한 번에 캔버스로) |
| | `materials.js` | 툰 재질(`toon`), 림 라이트, 바람 흔들림, 외곽선, 발광 재질 |
| | `particles.js` | CPU 시뮬레이션 + GPU 포인트 스프라이트 파티클. 모양 15종(불꽃 혀·흩어지는 연기·물방울·눈송이·잎·룬·전기 불꽃·거품 등), 3단 색 변화(`color`→`color2`→`color1`), 크기 곡선(`ease`), 소용돌이 난류 |
| | `fxmesh.js` | 메시 이펙트 부품: 노이즈로 일렁이며 침식되는 구체(`SPHERE_LOOK`: 불·연기·김·흙먼지·물·서리·비전·플라스마·번개·바람·먹구름), 초승달 베기(`slash`), 물보라 벽(`crown`), 물리 파편(`Debris`: 바위·얼음·불똥), 화면 굴절 물체(`Distort`) |
| | `crystal.js` | 수정 재질(`crystalMaterial`: 면 분할, 가짜 굴절, 내부 발광, 반짝임, 얼음 변형)과 모양(`crystalGeometry`: 기둥·군집·보석·조각), 후광 스프라이트 |
| | `vfx.js` | 파티클 프리셋, 조명 풀, 링, 룬 원진, 프랙탈 번개, 얼음 가시, 회오리, 광선, 경고 표시. 구체(`sphere`)·베기(`slash`)·물보라(`crownSplash`)·파편(`chunks`)·바람 선(`windLine`·`gustLines`)·굴절(`distort.ring`·`shell`·`haze`)·시전 모으기(`charge`)·습득 연출(`learn`). 속성별 레시피(`cast`·`impact`·`explode`·`strike`·`react`·`kill`·`dodge`·`ultCast`), 속도 방향 불꽃(`sparks`), 투사체 궤적(`ribbon`), 지형을 따르는 바닥 흔적(`decal`: 그을음·서리·물웅덩이·번개 자국 등), 충격 구체·빛기둥(`shock`·`pillar`), 잔여 효과(`linger`) |
| `world/` | `layout.js` | 랜드마크 좌표(`POI`), 길(`PATHS`), 지역(`REGIONS`) |
| | `terrain.js` | 1280m 높이맵 지형(2m 격자), 채색, 높이·법선·레이캐스트 조회. 256m 청크 25개가 거리별 4단계 LOD로 그려짐(`update`), 골짜기 바깥 땅(`outerHeight`)과 고개(`carvePasses`), 소품 배치용 옛 480m 격자(`legacy`) |
| | `sky.js` · `water.js` · `grass.js` | 하늘과 낮밤, 물, 풀(청크 단위 스트리밍) |
| | `props.js` | 식생·바위: 줄기·가지·잎 뭉치 구조로 기르는 수종(참나무·단풍·꽃나무·자작·포플러·버드나무·전나무·고사목), 덤불·고사리·들꽃·갈대·버섯·그루터기·통나무, 깎은 면 바위. 가까운/먼 모델 두 벌, 카메라 기준 인스턴스 재정렬(`Props.update`), `add`·`clear` |
| | `buildings.js` | 건물·소품 생성 함수(집·종탑·탑·풍차·우물·노점·성소·등석·화로·바람개비·틈의 문 등)와 마을 소품 조각(통·상자·수레·빨랫줄·깃발줄·가로등·텃밭·돌담·화분·이정표·돌탑·선착장) |
| | `collision.js` | 원·박스 충돌체와 밟을 수 있는 발판 |
| | `weather.js` · `wildfire.js` · `env.js` · `objects.js` | 날씨(비·뇌우·눈, 벼락), 들불 격자 시뮬레이션과 상승 기류, 마법↔환경 디스패처 `G.env`, 물리 소품(화약 통·상자·바위) |
| | `puzzles.js` | 작은 퍼즐: 잠든 노래 씨앗(`SEED_PUZZLES`), 반응으로만 열리는 상자(`CHESTS`), 불에 타는 가시덤불(`buildThicket`) |
| | `trials.js` | 시련: 노래하는 돌(`SingingStones`), 들불 오르기(`EmberClimb`). 가르치기 → 비틀기 → 조합 |
| | `world.js` | 위 모든 것의 배치, 등석·씨앗·기억 물건, 정적 메시 합치기, 환경 연출 |
| `game/` | `game.js` | 부팅, 타이틀, 메인 루프, 메뉴, 저장·불러오기, 사망, 등석, 음악 선택 |
| | `player.js` | 이동(달리기·순간이동·점프·활공·수영), 시전, 능력치 |
| | `camera.js` | 어깨 너머 카메라, 지형 충돌, 흔들림(부드러운 노이즈+회전), 방향성 반동(`kick`·`impact`), FOV 펀치, 대상 고정, 컷씬 카메라. 조준은 흔들림이 빠진 `aimRay()`를 씁니다 |
| | `spells.js` | 기본 마법, 모아 쏘기(`CHARGED`), 고유 마법, 엮기, 궁극기, 투사체, 지속 효과 영역(`field`·`vortex`·`wave`), 착탄 훅 `touch()` |
| | `fields.js` | 땅의 흔적(불길·서리밭·물웅덩이·김·대전된 땅과 그 변형): 생성·합치기(`add`), 두 번째 속성에 의한 변화(`infuse`→`mix`, `FIELD_MIX`), 소용돌이 연결(`bindWhirl`), 틱 효과·연출 |
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
| | `sketches.js` | 모라의 스케치북: 전망점에서 장면을 그려 연필 그림으로 바꾸기(`ink`), 시점 맞추기(`align`), 여정의 스케치 목록 |
| | `hud.js` | HUD 전반, 지도, 여정·마법서(반응 도감), 울림 나무 화면 |
| | `minimap.js` | 왼쪽 아래 원형 미니맵(북쪽 고정, 시야 부채꼴, 나침반 테두리, 목표·등석·마을 사람·추격 중인 적). 바탕은 64m 타일을 필요할 때 만들어 24장까지 보관 |

## 반드시 지킬 규칙

### 좌표와 높이
- 북쪽이 `-Z`입니다. 지면 높이는 `G.world.h(x, z)`, 발판까지 포함한 높이는 `G.world.ground(x, z, y)`로 구합니다.
- 맵은 원점 중심의 1280×1280m 정사각형입니다(`layout.js`의 `WORLD`). 하늬 골짜기는 가운데 반지름 약 214m의 분지이고, 둘레 산맥에 고개 다섯(`PASSES`: 남·동·서·북·북서)이 바깥 땅으로 이어집니다. 플레이어는 `WORLD.bound`(±612m) 안에만 있습니다. 크기를 직접 쓰지 말고 `terrain.half`·`size`·`inWorld()`를 쓰세요.
- **골짜기 안(반지름 약 230m)의 지형은 480m 시절과 한 칸도 다르지 않아야 합니다.** 바깥 땅은 `outerHeight`가 r 236~340에서 섞여 들어오고, 고개는 골짜기 안에서는 깎기만 합니다. 소품(`Props.scatter`)과 야영지 물건(`WorldObjects.place`)은 옛 격자(`terrain.legacy()`)로 자리를 고르므로 배치가 그대로입니다. 이 난수 순서가 흔들리면 골짜기 전체의 나무·바위가 바뀌니, 산포 루프에서는 `legacy()`의 `height`·`normal`·`grassAt`·`pathAt`를 쓰세요(`World` 생성이 끝나면 버립니다).
- 지형은 256m 청크(25개)마다 메시 하나이고, 카메라와의 거리로 LOD(2·4·8·16m 간격)를 고릅니다(`Terrain.update`, 월드 갱신과 스케치 렌더가 부름). 청크 테두리의 치마(skirt)가 LOD 사이 틈을 가립니다. 청크를 더 잘게 나누면 드로우콜마다 GPU 비용이 붙어(ANGLE/Metal에서 약 10µs) 오히려 느려졌습니다.
- **컷씬 카메라와 연출 위치는 반드시 지면 기준으로 잡으세요.** `story.js`의 `GV(x, dy, z)`를 쓰면 됩니다. 절대 y값을 쓰다가 카메라가 지형 아래로 들어간 적이 있습니다(마을 지면이 y≈8).

### 시간
- 게임 로직의 지연은 `G.later(fn, ms)`를 쓰세요. 게임 시간 기준이라 일시정지와 적중 정지를 따릅니다. `setTimeout`은 UI 연출에만 씁니다.
- `G.slowmo`(실제 시간 초)가 남아 있는 동안 적과 적 투사체는 1/4 속도로 움직입니다. 적 로직에서 `setTimeout`을 쓰면 이 감속을 따르지 않으니 상태 타이머나 `G.later`를 쓰세요.
- `G.time`은 게임 시간(적중 정지 중 느려짐), `G.realTime`은 실제 시간입니다.

### 재질과 발광
- `toon(color, opts)`는 같은 인자면 캐시된 재질을 돌려줍니다. **캐시된 재질을 직접 수정하지 마세요.** 개별로 바꿔야 하면 `{ nocache: true }`를 주세요. 적은 피격 번쩍임 때문에 모두 개별 재질입니다.
- 블룸 임계값이 1.35(선형 HDR)입니다. 빛나야 하는 것만 이 값을 넘기세요. 눈·설원처럼 밝은 표면의 알베도를 1 가까이 두면 화면이 하얗게 날아갑니다.
- 정점 색을 RGBA로 주면 알파가 **잎 마스크**입니다(1 = 잎, 0 = 줄기·돌). 잎의 투과광, 나무껍질 무늬, 잎 가장자리 깎기가 색상 대신 이 값을 봅니다. 그래서 단풍·꽃나무처럼 초록이 아닌 잎도 잎으로 처리됩니다. 알파가 없으면 예전처럼 색상으로 판정합니다.
- `toon(..., { noMoss: true })`는 `stone`·`rock` 질감에서 이끼를 뺍니다(틈의 바위).
- 여러 색의 작은 소품은 `MAT.paint`·`paintDS`·`paintWood`·`paintStone`(정점 색 재질)으로 만들면 색 수와 상관없이 칸마다 드로우콜 하나로 합쳐집니다(`buildings.js`의 `pbox`·`pball`·`pcyl`).


### 이펙트와 소리
- 이펙트는 가능하면 풀을 쓰는 `G.vfx` 함수로 만듭니다. 새 `Mesh`·재질을 매번 만들면 첫 사용 때 셰이더 컴파일로 끊기니, 새 부품을 풀에 넣었다면 `VFX.prewarm()`에도 추가하세요. 다른 파일이 가진 풀 재질은 `G.vfx.keep(mat, geo)`로 등록하면 prewarm에서 함께 컴파일됩니다(예: 해일 물벽).
- **재질을 쓰고 버리는 효과**(룬 원진, 구체 오브, 회오리, 광선 등)는 같은 프로그램을 쓰는 재질이 모두 dispose되면 three.js가 셰이더 프로그램을 해제해서, 다음 시전 때 다시 컴파일됩니다. 그래서 `prewarm()`이 버리지 않는 견본 재질(`_templates`)을 컴파일해 프로그램을 붙잡아 둡니다. 이런 효과를 새로 만들면 견본도 추가하세요.
- 프로그램은 출력 색공간·톤매핑별로 따로 만들어집니다. 장면은 컴포저의 HDR 렌더 타깃(선형)에 그려지므로 **미리 컴파일할 때는 `composer.readBuffer`를 렌더 타깃으로 잡고** 컴파일해야 합니다(`Game.compileScene`, `VFX.prewarm`). 캔버스(sRGB) 기준으로 컴파일하면 쓰이지 않는 프로그램 한 벌이 더 생기고 실제 사용 때 다시 컴파일됩니다.
- `Game.compileScene()`은 장면의 **숨은 물체까지** 잠깐 보이게 해서 컴파일합니다(`compile()`은 보이는 물체만 방문). 부팅 때와 이야기가 시작된 직후(동물·사람이 배치된 뒤) 한 번씩 부르고, 드라이버의 병렬 컴파일을 쓰므로 프레임을 막지 않습니다. 이야기 도중 새 종류의 재질을 가진 물체를 처음 만들면 이 함수를 다시 부르세요. 화면 굴절 재질은 조명·그림자가 없는 자기 장면에 그려지므로 `VFX.prewarm`이 `distortScene`·`distortRT` 기준으로 따로 컴파일합니다.
- 효과 조명 풀은 4개입니다(`VFX.lights`). 점광원은 세기가 0이어도 화면의 모든 조명 받는 픽셀이 반복문을 돌기 때문에 늘리지 마세요. 넘치면 가장 어두운(사라지는 중인) 조명을 새 섬광이 가져갑니다.
- 큰 구체(반지름 1.4m 이상)는 카메라에서 1.2~5.5m 안쪽 조각이 옅어집니다(`SPHERE_FS`). 가까운 화염구가 화면 전체를 덮지 않게 하기 위해서입니다. 작은 투사체 핵은 영향을 받지 않습니다.
- 구체(`sphere(look, pos, o)`)는 `dur <= 0`이면 `end()`를 부를 때까지 유지되고, `follow`에 벡터를 주면 따라갑니다. 투사체 핵은 `mini: true` 풀(16개)을 쓰고, 모자라면 프레넬 구로 대신합니다.
- 화면 굴절(`G.vfx.distort`)은 별도 장면에 그려 반해상도 목표에 오프셋을 쓰고, 마지막 패스(`grade`)가 그 오프셋으로 장면과 블룸을 함께 휘게 합니다. 활성 물체가 없으면 오프셋을 읽지 않습니다(`uDistort`). 그래픽 품질 '낮음'에서는 만들지 않습니다.
- 후처리는 장면 → 블룸 밉 → 마지막 패스 한 번뿐입니다. 전체 화면 패스를 새로 더하면 고해상도에서 프레임당 약 0.5~1ms가 늘어나니, 가능하면 `GradeShader`에 합치세요.
- 고유 마법은 `WINDUP`(속성별 0.1~0.2초) 동안 지팡이 끝에 힘을 모은 뒤(`charge_<속성>` 소리, `vfx.charge`) 그 순간의 조준점으로 나갑니다(`Spells.heavyRelease`).
- 기본 마법 입력은 `player.basicInput()`: 클릭 = 기본 마법(재사용 중 클릭은 0.2초 버퍼), 0.26초 넘게 누르면 모으기 시작(`vfx.charge`, `charge_hold`), `CHARGE_T`(0.75초)가 차면 `charge_ready`, 떼면 `player.castCharged()` → `Spells.charged()`. 조준점 고리는 `HUD.chargeRing`.
- 계속 나는 소리는 `G.audio.loop(name, { pos, v, max })`로 만들고 매 프레임 `set(pos)`, 끝날 때 `stop(fade)`를 부릅니다. 엔진이 준비되지 않았으면 아무것도 하지 않는 핸들이 돌아옵니다. `spells.js`의 `sndLoop()`를 쓰면 됩니다.
- 큰 마법의 마무리 소리는 `blast_<속성>`, 궁극기는 `ult_boom`(속성을 주면 `blast_<속성>`을 겹침)입니다. 같은 순간에 둘을 겹치지 않도록 `Spells.explode(..., { quiet: true })`를 쓰세요.
### 정적 메시 합치기 (`World.bakeStatics`)
- 부팅 시 씬 최상위 Group 안의 툰 메시를 재질·구역별로 하나로 합칩니다(드로우콜 약 1,450 → 500).
- **움직이거나 재질이 바뀌는 부분은 그 Group의 `userData`에 Object3D(또는 배열)로 넣어야 합치기에서 빠집니다.** 예: 종 `bell`, 풍차 `rotor`, 성소 `crystal`·`seal`. 상호작용 대상(`world.targets`)의 `obj`도 제외됩니다.
- 투명 재질과 흔들림(`sway`) 재질은 자동으로 제외됩니다. 정점 색 재질은 색을 유지한 채 합쳐지고, 공유 창문 재질(`windowMat`, `userData.bake`)도 합쳐집니다. 한 칸의 같은 재질은 그림자 여부와 상관없이 한 덩어리입니다.
- 합칠 필요가 없는 Group에는 `userData.noBake = true`를 주세요.
- 상호작용 대상(화로·바람개비·허수아비)은 합치기에서 빠지므로, 생성 함수 안에서 `consolidate(group, [움직이는 부분])`로 재질별로 미리 합칩니다.

### 식생 (`props.js`)
- 나무는 시드로 구조(뿌리가 퍼진 줄기, 가지, 가지 끝의 잎 뭉치)를 만들고 가까운 모델과 먼 모델을 같은 구조로 뽑습니다. 잎 뭉치의 법선은 수관 전체 쪽으로 기울여 부드러운 덩어리로 보이게 합니다.
- 종류·변형마다 가까운/먼 `InstancedMesh` 한 쌍과 그림자 대리(먼 모델, `SHADOW_LAYER`에만 있어 해의 그림자 카메라만 봄)가 있습니다. `Props.update(camera)`가 카메라가 움직일 때 거리·시야·그림자 반경으로 인스턴스를 다시 나눕니다. 나무의 가까운 모델 거리는 42m입니다.
- 배치는 `props.add(종류, x, z, 크기, { v, ry, dy, col, tall })`, 랜드마크 주변 비우기는 `props.clear(x, z, r, [종류])`(충돌체도 함께 제거)로 합니다. 메시는 다음 `update`에서 다시 만들어집니다.

### 등반과 충돌체
- 가파른 지형(법선 y < 0.64)과 충돌체 벽은 그쪽으로 계속 걸으면 붙잡습니다(`player.tryGrab` → `updateClimb`). 허리 높이(1.45m 미만) 턱은 뛰어넘고, 꼭대기에서는 `startMantle`로 올라섭니다. 등반 중 이동은 기력 10/초, 도약(<kbd>Space</kbd>) 20(기력이 20 미만이면 뛰지 않고 기력 고리가 흔들림, `hud.staminaShort`), 벽 차기(<kbd>S</kbd>+<kbd>Space</kbd>) 12(빠져나가는 수단이라 거절하지 않되 기력을 0으로 만들지는 않음), <kbd>Shift</kbd>는 놓기입니다.
- 충돌체 윗면은 바닥입니다(`Colliders.surfaceTop`, `World.ground`). 그래서 **충돌체 높이 `h1`은 실제 모양의 꼭대기와 맞아야 합니다.** 건물·지형지물은 `World.solid(obj, { r | hw, hd, top?, topFn?, climb?, noTop? })`로 등록하면 경계 상자에서 높이를 잽니다. 지붕처럼 기운 윗면은 `topFn(lx, lz)`(로컬 좌표), 나무 줄기처럼 올라설 수 없는 것은 `climb: false, noTop: true`를 주세요.
- `Player.teleport`는 등반·기어오르기·활공 상태를 풉니다. 플레이어 위치를 직접 바꿀 때는 이것을 쓰세요.
- 집은 `userData.roofTop(lx, lz)`(그룹 원점 기준 지붕 윗면 높이)를 주고, `buildVillage`가 이를 `topFn`으로 씁니다. `eave`·`roofH`·`roofHW`도 같은 선을 뜻합니다(`eave + roofH × max(0, 1 − |lx| / roofHW)`). 지붕 모양을 바꾸면 이 함수를 함께 고치세요. 모라의 탑과 풍차는 원뿔 모양 `topFn`을 씁니다.

### 날씨·들불·환경 (`world/weather.js`, `world/wildfire.js`, `world/env.js`)
- **날씨**(`G.world.weather`): 지역 기후(`CLIMATE`)에 따라 2.5~5분마다 맑음/흐림/비/뇌우 중 다음 상태를 고르고 25~40초에 걸쳐 바뀝니다. 서리봉(북쪽·고지대)에서는 눈으로 내립니다. 월드가 열리기 전·대화·보스전 중에는 다음 예정 시각을 기다리지 않고 곧바로 맑음으로 바뀌기 시작하며, 보스전 중에는 벼락이 떨어지지 않습니다. 연출에서 고정하려면 `weather.lock('rain')`, 풀려면 `lock(null)`.
  - 비: 1초마다 적을 젖게 하고(`e.st.wet`), 들불을 약화·소멸, 등반 중 미끄러짐(`player.updateClimb`), 지형·풀이 어두워짐(`U.wet`).
  - 뇌우: 5~13초마다 근처 높은 충돌체에 벼락(불씨·주변 피해). 번개 속성을 든 채 서 있으면 지팡이에 전기가 모였다가(경고음·불꽃 2.2초) 벼락이 떨어집니다.
  - 하늘은 `sky.overcast`, `sky.storm`으로 어두워지고 구름이 덮입니다.
- **들불**(`G.world.fire`): 지형 격자(2m)마다 연료(풀 비율)·상태(풀/타는 중/그을림)를 둡니다. 0.12초마다 이웃으로 번지며(기본 확률 낮음), 바람 방향·오르막일수록 빠르고 비에 약합니다. 불씨마다 **기세**(시작 1, 폭발·벼락 0.7~0.8)가 있어 번질 때마다 0.72배(바람 방향 0.8배)로 줄고 0.32 아래에서는 더 번지지 않습니다. 반경은 기세가, 채워지는 정도는 번짐 확률(0.04)이 정하므로 크기가 고르게 나옵니다(화약 통 하나 ≈ 150~300m², 15초 안팎에 꺼짐). 한 칸은 1.5~2.4초 탑니다. 동시에 타는 칸은 최대 360, 마을 광장은 연료가 없습니다. 탄 자리는 2.5~4분 뒤 다시 자랍니다. 번짐 지도(`U.burnTex`, R=그을림 G=불길)를 지형·풀 셰이더가 읽습니다.
  - 타는 칸 위 12m까지 약한 상승 기류가 생겨 활공하면 조금 떠오릅니다(`env.liftAt` → `player`). 불 위에 서 있으면 0.35초마다 피해, 적은 화염 피해.
  - `fire.ignite(x, z, r, vigor = 1)`, `fire.extinguish(x, z, r)`, `fire.fan(x, z, dirX, dirZ, r)`.
- **물리 소품**(`world/objects.js`, `G.world.objects`): 화약 통·상자·바위를 종류별 InstancedMesh 하나로 그립니다. 각 물체는 `world.targets`에 등록되어(`id: 'prop'`) 모든 마법의 `baseHit(el, src)`를 받습니다. 원소별 밀기(`PUSH`), 화염·번개 → 화약 통 도화선(1.1초, 연쇄 0.28초. 이미 타는 도화선도 이웃 폭발이 0.28초로 줄임) → `Spells.explode` 반경 5.2, 상자는 3번 맞으면 부서져 마나 방울(불에 타면 3초 뒤 재), 바위는 경사를 따라 구르며 적을 치고 물에 빠지면 가라앉습니다. 멈추면 잠들어 계산하지 않고, 사라진 것은 플레이어가 45m 밖에 있을 때 제자리에 다시 생깁니다. 배치는 `place()`(야영지마다 통 2·상자 1·오르막 바위 1). 마을 110m, 모라의 언덕·시작 오두막 60m 안에는 화약 통을 두지 않습니다(그 야영지는 상자 2개).
- **환경 디스패처**(`G.env`): 마법이 착탄하면 `G.env.onSpell({ el, pos, r, kind, source })`를 부릅니다. 화염은 풀에 불을 붙이고, 물·서리는 끄고, 바람은 불길을 바람 방향으로 번지게, 번개는 가끔 불씨를 만듭니다. 새 환경 규칙은 여기에 추가하세요.

### 작은 퍼즐 (`world/puzzles.js`)
- 새 규칙 없이 이미 있는 것만 씁니다: 월드 표적(`target.baseHit(el, src)`), 들불 격자, 땅의 흔적. 열기 판정은 `Puzzles.heatAt(pos, r)`(들불·`blaze`·`plasma`)입니다.
- 노래 씨앗 중 `SEED_PUZZLES`에 있는 것은 `s.locked`인 동안 주울 수 없고(`Story.update`), 풀리면 `Puzzles.wake(L)`가 봉오리를 열고 수정을 키웁니다. 씨앗 좌표는 `SEEDS`의 `[x, z, 지면 위 높이]`이고, 번호가 저장 키이므로 **순서를 바꾸지 마세요**. 퍼즐을 풀고 줍지 않은 채 불러오면 퍼즐은 처음 상태로 돌아갑니다.
- 상자(`CHESTS`)는 잠금(`ice`·`thorns`)이 풀린 뒤 <kbd>E</kbd>로 엽니다. 연 상자는 스토리 플래그 `chest_<id>`로 저장되고, 불러오면 열린 채로 놓입니다.
- 가시덤불은 불(마법·흔적·들불)에 타서 이웃 덤불과 발밑 풀로 번지고, 플레이어가 45m 밖에 있으면 200초 뒤 다시 자랍니다.
- 플레이어가 풀지 못하고 20초 넘게 머물면 보름이 한 번 귀띔합니다(`LINGER`). 안내 없이 알아채는지가 0단계의 시험이므로 더 빨리 말하게 하지 마세요.

### 시련 (`world/trials.js`)
- 한 곳에 메커니즘 하나를 **가르치기 → 비틀기 → 조합** 세 단계로 담습니다. 가까이 가면 배너로 목표만 한 줄 알립니다(방법은 말하지 않음). 마치면 스토리 플래그 `trial_<id>`, 울림점 1, 경험치 80.
- **노래하는 돌**(40, 148): 돌 다섯(`STONES`, 키가 클수록 높은 음)이 부른 구절(`PHRASES`)을 아무 마법으로 두드려 따라 부릅니다. 1단계는 부르는 돌이 빛나고, 2단계는 소리만(돌 위치에서 들림), 3단계는 두 구절을 잇되 가장 높은 돌이 얼어 있어 불로 녹여야 울립니다(녹이는 동안 진행은 유지). 틀리면 처음부터 다시 부릅니다. 가운데 돌에서 <kbd>E</kbd>로 다시 듣기.
- **들불 오르기**(106, 116): 오를 수 없는 현무암 기둥 셋(`POSTS`, `climb: false`). 높이는 실측값에 맞췄습니다: 들불 상승 기류 6~9m, 땅에서 돌풍 도약 약 10.5m, 기류 꼭대기에서 도약 약 15m, 활공은 3.3m에 1m 하강. 기둥을 옮기거나 이동·돌풍·들불 수치를 바꾸면 세 단계가 여전히 순서대로만 풀리는지 다시 재 보세요. 마지막 망대 둘레는 `layout.js`의 `PADS`(풀 없는 돌바닥)입니다.
- `PADS`는 지형 채색과 풀·연료(`terrain.gf`)를 함께 지웁니다. 새 시련이나 광장에 쓸 수 있습니다.

### 땅의 흔적과 착탄 훅
- 마법이 땅이나 영역에 닿는 지점에서는 `G.spells.touch(el, pos, r, kind)`를 부르세요. `kind`는 `'bolt' | 'heavy' | 'weave' | 'ult' | 'charged'`. 이 한 번의 호출이 ① 겹친 땅의 흔적을 변화시키고(`Fields.infuse`) ② 월드 시스템 훅 `G.env?.onSpell({ el, pos, r, kind, source })`를 부릅니다(`pos`는 착탄 지점 아래 지면, `charged`는 `'bolt'`로 전달). 흔적은 살아 있는 동안 0.5초마다 `kind: 'field'`로 같은 훅을 부릅니다. `G.env`가 없으면 아무 일도 없습니다.
- `explode()`·`strike()`·투사체 `impact()`·`wave()`는 이미 `touch()`를 부릅니다. `explode(..., { kind })`, `strike(..., { kind, charge: { r, dur } })`로 종류와 대전된 땅을 지정합니다. `onImpact`가 있는 투사체는 `impact()`를 거치지 않으므로 콜백 안에서 `explode()`나 `touch()`를 부르세요.
- 흔적 만들기: `G.spells.fields.add(kind, pos, { r, dur, dmg, maxR, noGround })` (`kind`: `blaze`·`plasma`·`rime`·`frostfog`·`puddle`·`steam`·`charged`·`shockfog`·`shockwater`). 같은 종류가 가까이 있으면 합쳐지고, 12개가 넘으면 오래된 것부터 지웁니다. 반응 뒤의 흔적은 `Combat.leave(kind, target, o)`로 발밑에 깝니다.
- 새 변화는 `fields.js`의 `mix()` `switch`와 `FIELD_MIX`(도감 이름·설명)에 함께 추가합니다. 흔적 틱 피해는 `source: 'dot'`(숫자는 `hud.damage(..., small)`로 직접)라 적중 정지·반동·게이지가 없습니다.
- 강한 비전(`kind !== 'bolt'`)은 흔적을 터뜨립니다(공명 폭발). 비전 화살은 공짜라 흔적을 건드리지 않습니다.

### 전투
- 모든 피해는 `G.combat.hit(target, h)`로 넣습니다. `h`의 주요 필드:
  - 필수: `dmg`, `el`
  - 선택: `pos`, `dir`, `knock`, `lift`, `heavy`, `status`, `noReact`, `noStatus`, `hitstop`, `shake`
  - `source`: `'player'`(치명타·피드백 있음), `'enemy'`, `'dot'`(숫자만), `'env'`, `'fall'`
- 반응은 `Combat.resolve` 한 곳에서 처리합니다. 연쇄 피해에는 `noReact: true`를 붙여 무한 연쇄를 막으세요.
- 적이 아닌 대상(예: 최종 보스의 결계판 `Plate`)은 `receive(h)`를 구현하면 `hit()`이 그쪽으로 넘깁니다.
- 적중 정지는 `G.hitstop`에 직접 쓰지 말고 `G.combat.stop(sec, force)`를 쓰세요. 한 프레임 안에서는 가장 센 값 + 나머지의 30%(최대 0.15초), 0.04초 미만은 0.3초에 한 번으로 제한됩니다(`force`로 무시). 궁극기 시전처럼 연출상 반드시 멈춰야 하는 곳만 직접 씁니다.
- 빙결이 저절로 풀리면 `st.thaw`(2.5초, 보스 5초) 동안 한기로는 다시 얼지 않습니다. `freeze()`를 직접 부르는 반응은 예외입니다.
- **보스 무너짐 게이지**(`enemies.js`의 `BREAK`, `t.brk`): `def.boss`이거나 `spawn(..., { brk: true })`로 만든 적은 경직 누적(`poise`) 대신 이 게이지를 씁니다. `onHit`에서 `breakFromHit`가 채우고, 가득 차면 `stagger(BREAK.down, true)` + `collapseFx`(→ `Story.onBossBreak`). 무너진 동안 `Combat.resolve`의 빈틈 배율이 1.5 → 1.75입니다. 게이지를 직접 더하려면 `addBreak(t, 양)`(최종 보스는 `heart.addBreak`). HUD의 금빛 줄은 `t.brk`가 있을 때만 보입니다.
- **보스 단계**: `t.phaseAt`(체력 비율 문턱 배열)을 `phaseCheck(t, t.phaseAt)`로 확인하면 `t.phase`가 오르고 `t.phaseMul`(`PHASE_DMG`: 1 / 1.2 / 1.4)이 `hurtPlayer`의 피해에 곱해집니다. 문턱은 체력바에 눈금으로 그려지고, 단계 대사는 `Story.onBossPhase(boss, n)`에 있습니다. 새 보스는 `phaseAt`과 단계별 패턴을 함께 주세요.

### 울림 나무 (스킬)
- 노드는 `skills.js`의 `TREES`에 데이터로 추가합니다: `{ id, name, tier, col, max, cost, req, kind, desc(r) }`. `req`는 **하나만** 익혀도 되는 선행 목록, `tier`는 나무에 쓴 점수 조건(`TIER_GATE = [0, 1, 2, 4, 7]`)과 화면 위치를, `col`(0~2)은 가로 위치를 정합니다. 속성 나무는 5단(0~4), 조화의 나무는 4단(0~3)이고 화면은 나무의 `maxTier`에 맞춰 배치됩니다. 조화 노드는 `els: [속성, 속성]`과 `req: ['h_weave']`를 씁니다.
- **기술(`kind: 'active'`)**: 각 속성 나무의 0단은 고유 마법을 여는 노드(`SIG` 맵: `a_sig`·`f_sig`·`w_sig`·`i_sig`·`s_sig`·`wa_sig`, `sigOf(el)`)이고, 조화의 0단 `h_weave`(`WEAVE_NODE`)가 엮기를 엽니다. `player.castHeavy`/`castWeave`는 `canHeavy()`/`canWeave()`로 이를 확인합니다. 기술 노드의 이름·설명의 마나·재사용 값은 `spells.js`의 `HEAVY`·`WEAVE_COST`를 **지연해서** 읽습니다(`spells.js`가 `skills.js`를 import하므로 모듈 평가 시점에 읽으면 순환 참조 오류).
- 이야기 보상이나 이전 저장 이전처럼 점수 없이 익히게 하려면 `G.skills.grant(id, { silent, quiet, sound })`를 씁니다. 받은 노드는 `granted`에 기록되어 "모두 잊기"에서 남고 환급되지 않습니다. `grantBasics()`는 깨우친 속성의 고유 마법과(속성 둘 이상이면) 엮기를 한꺼번에 줍니다.
- 익힐 때 공통 처리(소리 `skill_learn`/`skill_unlock_active`, `G.vfx.learn(나무, 종류, 위치)` 연출, 알림, HUD 갱신)는 `Skills.afterLearn`에 있습니다.
- 효과는 쓰는 쪽에서 `G.skills.r(id)`(단계) 또는 `G.skills.has(id)`로 조회합니다. `spells.js`·`combat.js`는 파일 안의 `R(id)` 도우미를 씁니다. 수치를 바꾸면 `desc`와 [docs/DESIGN.md](docs/DESIGN.md#울림-나무-스킬-트리)도 함께 고치세요.
- 궁극기는 `kind: 'ult'`이고 `ULTS`에 속성별로 등록합니다. 구현은 `Spells.ult(el, …)`.
- 울림점 지급은 `G.skills.gain(n, 이유)`로 합니다. 이유 문자열은 알림에 그대로 나옵니다.
- **울림의 갈림길**: 레벨업(`player.addXP`)은 울림점과 함께 `G.skills.cross`를 늘립니다. `Game.update`가 `crossroadsSafe()`(자유 이동·메뉴 없음·전투/대화 아님·지상)가 실제 시간 2.2초 이어지면(스크립트 전투의 파 사이 `sleep`보다 길게) 메뉴 id `'crossroads'`를 엽니다(`Game.openCrossroads` → `HUD.openCrossroads`). 카드는 `Skills.offer(3, seed)`가 고릅니다. <kbd>1</kbd>~<kbd>3</kbd>/클릭은 `HUD.crPick`, <kbd>Esc</kbd>는 `crKeep`(남은 갈림길 모두 넘기고 점수 보관), <kbd>K</kbd>는 `crTree`.

### UI와 입력
- **마우스 잠금**은 메뉴(`Game.openMenu`)에서만 풉니다. 대화·컷씬·사망 중에도 잠근 채 두고(선택지는 숫자·W/S·휠·클릭), 풀렸을 때는 아무 키나 클릭(사용자 제스처)이 `Input.wantLock()`을 보고 다시 잠급니다. "클릭하거나 아무 키나 누르면 이어집니다"는 자유 이동 중 1.2초 넘게 풀려 있을 때만 화면 아래에 조용히 뜹니다.
- **안내(`hud.hint`)**는 왼쪽 가장자리 카드입니다. 앞선 안내가 2.5초 안쪽이면 줄을 서고(최대 3개), 시간은 자유 이동 중에만 흐릅니다. 조준점 근처에 새 안내 UI를 두지 마세요.
- **배너(`hud.banner`)**는 전투 중(`hud.inCombat()`)이면 나침반 아래 얇은 띠(`.compact`, 최대 2.6초)로 줄어듭니다. 지역 이름(`areaTitle`)은 전투 중에 띄우지 않습니다.
- **아직 깨우치지 않은 속성은 UI 어디에도 보이지 않습니다**: 속성 슬롯(`.el.gone`), 마법서, 반응 도감('?' 표시), 울림 나무 탭, 모르는 속성이 낀 조화 노드('???'). 새 UI에서 속성 목록을 그릴 때도 `G.player.unlocked`로 거르세요.
- **미니맵**(`minimap.js`, `hud.minimap`): 큰 지도의 지형 이미지(`HUD.ensureMapBase`)를 1m당 3px로 키우고 건물 발자국(높이 1.6m 넘는 상자 충돌체)을 찍은 64m 타일을 보이는 만큼 만들어 두고(최근 24장), 초당 30번 반경 62m를 그립니다. 북쪽이 위로 고정이고, 화살표는 몸의 방향, 부채꼴은 카메라 방향입니다. 목표가 범위 밖이면 테두리에 붙이고 거리를 씁니다. 적은 플레이어를 쫓는 것(`aggroed`)만 보입니다. 대화 중에는 숨고, 메뉴가 열려 있으면 그리지 않습니다.
- **장식 스킨**(`src/styles-fantasy.css`, `styles.css` 다음에 불러옴): 밤하늘 남색 패널, 금색 이중 테두리와 모서리 금세공, 장식 구분선, 별가루 무늬, 룬 원진을 덧입히는 층입니다. 장식은 SVG 데이터 URI 변수(`--orn-tl`·`--orn-tr`·`--orn-bl`·`--orn-br`, `--orn-rule`, `--pat-stars`, `--orn-rune`, 요소가 많은 화면용 `--orn-rune-soft`, 로딩용 `--orn-rune-bright`·`--orn-star`·`--orn-spark`)이고 `scripts/ornaments.py`가 만듭니다. 로딩 화면의 도는 별 원진(`.load-rune`의 `lr-*`)만 애니메이션이 있고, 불러오기가 끝나면 `#loading.ready`에서 별이 한 번 피어납니다. 새 패널은 파일 머리의 선택자 목록에 더하면 같은 틀을 받습니다. 모두 정적 배경이니 반복 애니메이션이나 `backdrop-filter`를 더하지 마세요. 이미 `position: absolute`인 요소(`#dialogue` 등)에 틀 규칙의 `position: relative`가 걸리지 않게 주의하세요.
- **메뉴와 HUD 메시지**: 메뉴가 열리면 `#ui.menu-open`이 배너·안내·토스트·보름의 한마디를 숨기고, 배너 대기열과 표시 시간이 멈췄다가 메뉴가 닫힌 뒤 1.4초 더 보입니다. 설정은 일시정지 메뉴를 숨긴 채 열립니다.
- **숫자**: 계속 바뀌는 숫자(마나, 비용, 레벨, 거리)는 `tabular-nums`와 고정 폭으로 흔들리지 않게 합니다. 설정 슬라이더는 값(`.set-val`)을 옆에 보여 줍니다.
- **반복 애니메이션**: '지금 쓸 수 있다'는 상태(궁극기 준비, 울림 나무의 익힐 수 있는 노드)만 계속 숨쉬게 합니다. 울림점 배지는 점수를 받을 때 세 번 빛나고 멈춥니다.
- **UI 배율**: `HUD.applyScale()`이 창 크기(1600×900 = 1, 0.8제곱으로 완만하게, 0.68~1.5)와 설정 '인터페이스 크기'(`settings.ui`, 75~135%)로 `--ui`를 정하고, 고정 위치 패널과 메뉴 틀이 `zoom: var(--ui)`를 씁니다. `zoom`은 `vw`/`vh`도 키우므로 이 요소들 안에서 뷰포트 단위는 `calc(90vw / var(--ui))`처럼 나눠 쓰세요. 화면 좌표로 JS가 놓는 요소(적 체력바, 피해 숫자, 표식, 기력 고리)에는 `zoom`을 걸지 마세요.

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
- **종과 세계의 기억**: `Story.bellsRung()`(0~4: 첫째 종 `v_wind`, `frostBell`, `stormBell`, 합창 `m_choir`)이 색 보정 채도(`satFor`, 0.80 → 1.12, 종이 울린 뒤 몇 초에 걸쳐 돌아옴), 새소리 빈도(`Audio.updateAmbience`의 `bells`), 들판·밤·마을 음악의 악기 층(`Music.memory`)을 정합니다. 연출만 바뀌고 규칙은 없습니다.
- **모라의 스케치북**(`game/sketches.js`, `G.sketches`): 단비가 건네면 플래그 `sketchbook`. 각 쪽(`SKETCHES`)은 전망점 `eye`에서 `look`을 바라본 장면을 렌더 타깃에 그려 CPU로 연필 선·빗금으로 바꾼 이미지입니다(플레이어가 전망점 110m 안에 들어오거나 여정이 열리면 그림. 렌더 → 비동기 읽기 → 3ms씩 나눠 잉크 → 비동기 JPEG로 여러 프레임에 나눠 처리해 끊기지 않음, `Sketchbook.pump`는 메뉴 중에도 게임 루프가 부름). 종 뒤에 열리는 쪽(`after`)은 봉인이 그림에 남지 않도록 열린 뒤에 그립니다. 게임 카메라가 전망점 7m 안에서 같은 방향(방위 ±20°, 기울기는 두 배 관대)을 보면 그림이 화면에 겹쳐 보이고(`#sketch-view`, 곱하기 합성), 0.7초 유지하면 쪽의 기억이 열려 `sk_<id>`가 저장됩니다. 기억의 물건 4개는 해당 쪽을 맞추기 전까지 보이지 않습니다. 전망점을 옮기면 여정에서 그림을 보고 구도를 확인하세요.
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

`?dev` 모드는 `requestAnimationFrame` 대신 16ms 타이머로 루프를 돕니다. **브라우저 창이 가려져 있으면 rAF가 멈추기 때문입니다.** 보이는 창에서 실제 프레임을 재려면 `&raf`를 붙이세요(예: `?dev=skills&god&raf`). 일반 모드(타이틀부터)는 창이 보이는 상태에서만 확인할 수 있습니다.

### 테스트 스위치
주소에 `&god`(피해 없음), `&unseen`(적이 플레이어를 인지하지 않음)을 붙이거나 콘솔에서 `__G.dev.god = true`, `__G.dev.unseen = true`로 켭니다. 이동·등반·연출을 확인할 때 적에게 맞아 쓰러져 등석으로 돌아가는 일을 막아 줍니다. 적의 인지는 모두 `player.seen()`을 거칩니다.

### 콘솔에서 조작하기
`window.__G`로 게임 상태에 접근할 수 있습니다.
- **입력 흉내**: `G.input.keys.add('KeyW')`(누르고 있기), `G.input.pressed.add('KeyE')`(한 번 누르기), `G.input.mouse.pressed.add(0)`(클릭)
- **조준**: `G.player.lockTarget = 적`으로 대상을 고정하면 자동으로 조준됩니다.
- **흔적**: `G.spells.fields.add('puddle', 위치, { r: 3, dur: 8 })` 뒤 `G.spells.touch('storm', 위치, 1)`로 변화를 확인합니다. `G.spells.fields.list`로 살아 있는 흔적, `G.env = { onSpell: (o) => console.log(o) }`로 월드 훅 호출을 볼 수 있습니다.
- **모아 쏘기**: `G.input.mouse.pressed.add(0); G.input.mouse.buttons.add(0)` 뒤 1초 기다렸다가 `G.input.mouse.buttons.delete(0)`, 또는 바로 `G.spells.charged(속성, G.player.staffTip(), 조준점, G.player.power(), G.player)`.
- **스킬**: `G.skills.learn('wa_ult')`, `G.skills.grant('i_sig')`, `G.skills.points += 10`, `G.skills.gauge = 100` 후 `G.player.castUlt()`. 울림 가속은 `G.player.tryBlink(); G.player.damage(1)`로 확인합니다.
- **성능**: `G.game.perf`에서 프레임별 갱신·렌더 시간, 드로우콜, 삼각형 수를 봅니다.
- **스크립트 도구 제한**: 브라우저 자동화 도구는 한 번에 약 45초까지만 실행됩니다. 긴 전투 테스트는 백그라운드 루프로 돌리고 결과를 `window`에 담아 따로 확인하세요.
- **헤드리스 스크린숏**: 소프트웨어 렌더링(swiftshader)에서는 스크린숏이 수십 초~수 분 걸릴 수 있습니다. 찍기 직전에 `__G.renderer.render`를 잠시 빈 함수로 바꿨다가 되돌리면 빨라집니다. 전체 화면 `backdrop-filter`나 큰 요소의 무한 애니메이션은 소프트웨어 합성에서 매우 느리니 메뉴 연출에 쓰지 마세요.

### 성능 기준
프레임 목표는 게임 전반에서 60fps입니다. 1512×945 창(픽셀 배율 1.5, 약 320만 픽셀) 기준 GPU 측정값은 가만히 있을 때 약 4ms, 무거운 전투 순간(번개 궁극기·엮기) 5~8ms, CPU 갱신은 약 1.5ms입니다(Apple M5, 동기화 벤치마크 기준). 측정 방법: 게임을 멈추고(`G.paused = true`) `G.renderer.render()`를 수십 번 부른 뒤 `readPixels`로 GPU를 기다려 평균을 냅니다. 가려진 창에서는 GPU 시간 쿼리(`EXT_disjoint_timer_query`)가 클럭이 낮아 부풀려 나오니 쓰지 마세요.
마을 기준으로 드로우콜 약 500-900, 삼각형 약 100만입니다(헤드리스 측정, 식생·조형 캐릭터 포함). 800×629 창 기준 최근 측정값은 마을 광장 드로우콜 약 400, 삼각형 약 110만, 빽빽한 숲 안 드로우콜 약 170, 삼각형 약 85만입니다. 캐릭터는 사람형 6,500-10,000, 일반 적 2,500-10,000 삼각형이며 형태별로 기하를 공유합니다. 이보다 크게 늘어나는 변경은 합치기나 인스턴싱을 검토하세요.

## 알려진 한계와 할 일
- 실제 마우스 조작감과 소리는 사람이 직접 확인해야 합니다. 자동 테스트로는 오류 없이 실행되는 것까지만 확인했습니다.
- 보스 밸런스는 회피하지 않고 원소를 번갈아 쓰는 자동 조작 기준입니다(레벨 6 서리무덤 파수꾼 약 21초, 레벨 8 무명의 기사 약 21초, 무너짐 2회 안팎). 체력과 무너짐 게이지를 넣기 전에는 둘 다 약 10초였습니다. 사람 기준 목표는 각각 1분 안팎이고, 아직 사람이 직접 해 보며 맞추지는 않았습니다.
- 적 이동은 충돌체를 밀어내기만 하고 길찾기는 없습니다.
- 번들이 약 1.3MB(gzip 386KB) 한 덩어리입니다. 필요하면 코드 분할을 검토하세요.
- 그래픽 품질 '낮음'은 풀·그림자·소품 수만 줄이고, 새 질감·잎 가장자리 셰이더는 끄지 않습니다. 저사양 대응이 필요하면 여기부터 보세요.
- 적이 넘어졌다 일어나는 동작은 몸 전체를 기울이는 방식이며 별도의 일어서기 애니메이션은 없습니다.
