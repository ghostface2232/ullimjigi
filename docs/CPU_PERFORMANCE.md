# 울림지기 CPU 프레임 측정

2026-11-20 · HEAD `7a958edf`와 수정본 · Windows 11, Core i9-9900K, RTX 4090 (ANGLE D3D11), Chrome 157.0.8103.79.

높음에서 p95 12ms 이내인 장면은 2/12개, 16.6ms 이내인 장면은 4/12개였습니다. 최상에서 p95 16.6ms 이내인 장면은 3/12개였습니다. 품질별 10,200프레임 중 33ms를 넘긴 수정 후 프레임은 높음 24개, 최상 51개입니다.

## 측정 조건

다른 게임 사본이 일시정지 상태로 렌더링하던 초기 측정은 버렸습니다. 높음의 추가 반복 1회는 로컬 암벽 텍스처 요청이 ERR_NO_BUFFER_SPACE로 실패해 기준·수정본 한 쌍을 통째로 다시 측정했습니다. 표에는 그 사본을 닫고 측정 브라우저도 모두 종료한 뒤, 서버와 Chrome을 한 벌씩 띄워 얻은 값만 넣었습니다.

- 양쪽 모두 같은 Vite 설정(함수 이름을 보존한 프로덕션 번들, 소스맵), 1512×945 CSS 픽셀·DPR 1.5, 실제 그리기 버퍼 2268×1417, 동적 해상도 끔. 실행마다 새 프로필과 자동 할당한 로컬 포트를 썼습니다.
- `?dev=skills&god&unseen`에서 개발 타이머 대신 1/60초 고정 입력으로 실제 `Game.update`와 전체 `Renderer.render`를 구동했습니다. 짧은 프레임은 다음 60Hz 시점까지 쉬고 적중 정지·입력 종료를 적용했습니다. 전투에서만 적의 인지를 켰습니다. 오디오는 사용자 제스처로 시작하지 않았습니다. 수치는 `G.game.perf`와 같은 두 구간의 경과 시간입니다. WebGL 호출이 드라이버를 기다린 시간은 포함하며 화면 제출 간격·GPU 완료 시간·디스플레이 FPS를 측정하지는 않습니다.
- 각 품질에서 HEAD와 수정본을 번갈아 세 번 돌려 프레임을 합쳤습니다. p95·p99는 정렬 후 최근접 상위 순번, 최대는 세 실행 중 가장 긴 프레임입니다. 별도 교차 실행에서 같은 동작 중 CDP `Profiler.start/stop`을 호출했습니다. 프로파일러와 호출 횟수 계측기의 시간을 분포 표에 섞지 않았습니다.
- 좌표·시각·날씨·입력 프레임·난수 시드는 같습니다. 광장은 150프레임, 들불·전투는 5프레임, 나머지는 75프레임 정착시켰습니다. 야영지는 활성 반경 바깥에서 출발합니다. 이동 후 지형 작업·스폰·시전은 측정에 포함됩니다. 도착 직후 정착 프레임은 별도 프로파일로 아래에 실었습니다. 작업을 시간으로 나눠 처리하는 엔진과 비동기 스케치 인코딩 때문에 세 실행의 효과 수·작업 완료 프레임은 달라질 수 있습니다.
- 마을길은 전진 키로 달리다가 Shift를 더해 질주합니다. 남쪽 고개는 (33, 214)에서 (52, 353)까지 질주합니다. 전투는 실드·사수 등 다섯 종류 10체를 인식시킨 뒤 0·30프레임에 기본탄, 65에 고유 마법, 140에 엮기, 205에 궁극기를 입력합니다. 야영지에서 정상 생성된 다른 적도 세계에 남습니다. 스케치북은 실제 획득 플래그를 켜고 근처의 네 장이 생성되도록 합니다. 최상 수정본 1회는 준비 5프레임을 거친 뒤 살아서 추격 중인 적이 9체, 나머지는 10체 이상이었습니다. 지정한 다섯 시전은 매번 기록되었습니다.

## 프레임 분포

시간 단위는 ms입니다. 프레임 수는 빌드당 세 실행의 합입니다. 드로우콜은 게임 루프처럼 갱신 직후 카운터를 초기화한 뒤 반사·그림자·후처리를 포함해 더했습니다. 갱신 중 스케치 렌더는 갱신 시간에 들어갑니다.

### 높음

|장면 (프레임)|수정 전 평균 / p95 / p99 / 최대|수정 후 평균 / p95 / p99 / 최대|갱신 + 렌더 평균 (전 → 후)|16.6ms 초과 (전 → 후)|33ms 초과 (전 → 후)|평균 드로우콜 (전 → 후)|
|---|---:|---:|---:|---:|---:|---:|
|마을 광장 (480)|13.0 / 21.9 / 29.5 / 38.0|10.0 / 16.6 / 21.2 / 25.3|3.1 + 9.9 → 2.7 + 7.3|87 → 24|2 → 0|713 → 635|
|마을길 달리기·질주 (1260)|17.7 / 31.9 / 41.5 / 66.5|10.4 / 17.7 / 24.9 / 45.0|4.9 + 12.8 → 3.2 + 7.3|619 → 86|49 → 2|696 → 617|
|거울 호숫가 (480)|15.9 / 27.8 / 33.1 / 41.4|10.7 / 18.0 / 21.9 / 29.7|4.4 + 11.5 → 3.2 + 7.5|176 → 36|5 → 0|638 → 559|
|속삭이는 숲 (480)|8.6 / 15.5 / 18.4 / 25.3|6.6 / 10.5 / 14.7 / 16.6|2.3 + 6.3 → 1.9 + 4.6|12 → 0|0 → 0|378 → 361|
|남쪽 고개 횡단 (3300)|5.4 / 9.4 / 13.3 / 20.4|4.8 / 8.7 / 11.9 / 24.9|1.4 + 3.9 → 1.3 + 3.5|7 → 4|0 → 0|171 → 170|
|야영지 접근·생성 (540)|9.2 / 14.3 / 18.7 / 28.7|8.5 / 14.1 / 18.8 / 35.5|1.7 + 7.5 → 1.7 + 6.8|11 → 13|0 → 1|836 → 753|
|비 (480)|11.5 / 17.8 / 22.8 / 25.6|12.0 / 20.7 / 28.5 / 36.2|2.9 + 8.6 → 3.1 + 8.8|33 → 76|0 → 1|729 → 651|
|뇌우 (540)|11.4 / 18.4 / 21.7 / 24.1|13.9 / 25.6 / 33.0 / 36.4|2.9 + 8.6 → 3.5 + 10.4|41 → 164|0 → 4|729 → 651|
|밤 (480)|10.9 / 16.5 / 19.8 / 26.2|10.9 / 18.3 / 23.0 / 28.8|2.7 + 8.2 → 2.8 + 8.1|24 → 43|0 → 0|728 → 650|
|번지는 들불 (720)|9.7 / 15.6 / 22.2 / 24.3|9.6 / 19.6 / 24.2 / 31.1|3.0 + 6.8 → 3.1 + 6.5|24 → 61|0 → 0|553 → 485|
|10체 전투·복합 마법 (900)|15.3 / 26.9 / 33.5 / 48.4|16.2 / 28.6 / 36.4 / 59.3|5.1 + 10.2 → 5.7 + 10.5|239 → 345|12 → 16|727 → 660|
|스케치북 생성 (540)|11.8 / 19.2 / 24.0 / 27.0|11.3 / 20.7 / 25.1 / 32.9|3.6 + 8.1 → 3.8 + 7.6|64 → 71|0 → 0|578 → 545|

### 최상

|장면 (프레임)|수정 전 평균 / p95 / p99 / 최대|수정 후 평균 / p95 / p99 / 최대|갱신 + 렌더 평균 (전 → 후)|16.6ms 초과 (전 → 후)|33ms 초과 (전 → 후)|평균 드로우콜 (전 → 후)|
|---|---:|---:|---:|---:|---:|---:|
|마을 광장 (480)|11.7 / 18.1 / 22.4 / 28.5|11.2 / 17.7 / 22.3 / 28.8|2.8 + 8.9 → 2.8 + 8.4|40 → 37|0 → 0|859 → 761|
|마을길 달리기·질주 (1260)|15.4 / 23.9 / 31.0 / 44.2|14.9 / 24.3 / 33.4 / 50.3|4.1 + 11.3 → 4.1 + 10.8|375 → 361|7 → 13|1067 → 964|
|거울 호숫가 (480)|15.6 / 22.7 / 28.4 / 32.4|14.8 / 23.0 / 27.6 / 29.7|3.4 + 12.2 → 3.4 + 11.5|123 → 117|0 → 0|1062 → 938|
|속삭이는 숲 (480)|9.3 / 14.4 / 18.9 / 22.2|8.7 / 14.9 / 19.3 / 21.1|2.1 + 7.2 → 2.0 + 6.6|10 → 13|0 → 0|589 → 547|
|남쪽 고개 횡단 (3300)|6.2 / 10.5 / 14.0 / 23.4|6.0 / 10.5 / 14.8 / 24.7|1.6 + 4.6 → 1.5 + 4.4|6 → 12|0 → 0|280 → 270|
|야영지 접근·생성 (540)|13.2 / 20.7 / 25.3 / 26.7|12.0 / 19.7 / 26.3 / 28.3|3.0 + 10.2 → 2.7 + 9.2|109 → 72|0 → 0|1131 → 1017|
|비 (480)|12.7 / 21.0 / 30.1 / 37.6|11.0 / 18.2 / 22.5 / 29.3|3.4 + 9.3 → 3.1 + 7.9|58 → 37|2 → 0|883 → 785|
|뇌우 (540)|12.4 / 20.5 / 24.8 / 38.9|11.1 / 18.2 / 23.3 / 32.2|3.0 + 9.4 → 2.7 + 8.3|60 → 44|1 → 0|884 → 785|
|밤 (480)|11.0 / 16.9 / 20.7 / 21.3|10.7 / 16.4 / 20.3 / 24.2|2.8 + 8.3 → 2.7 + 8.0|25 → 23|0 → 0|867 → 769|
|번지는 들불 (720)|12.8 / 21.3 / 25.8 / 30.2|11.9 / 20.2 / 26.0 / 37.8|3.5 + 9.3 → 3.4 + 8.5|113 → 93|0 → 1|751 → 667|
|10체 전투·복합 마법 (900)|19.9 / 33.8 / 43.7 / 67.9|18.6 / 30.9 / 40.4 / 85.5|5.6 + 14.3 → 5.5 + 13.1|536 → 433|51 → 34|1008 → 961|
|스케치북 생성 (540)|16.1 / 27.5 / 38.5 / 45.2|13.6 / 23.7 / 32.3 / 41.3|4.2 + 12.0 → 3.7 + 9.9|185 → 100|8 → 3|933 → 867|

<details>
<summary>갱신과 렌더 각각의 평균 / p95 / p99 / 최대 (ms)</summary>

|품질·장면|수정 전 갱신|수정 후 갱신|수정 전 렌더|수정 후 렌더|
|---|---:|---:|---:|---:|
|높음 광장|3.1 / 5.3 / 8.7 / 12.7|2.7 / 4.1 / 7.3 / 12.6|9.9 / 16.7 / 24.2 / 31.7|7.3 / 12.2 / 15.2 / 17.1|
|높음 마을길|4.9 / 10.2 / 15.8 / 32.5|3.2 / 6.6 / 9.4 / 15.3|12.8 / 23.2 / 31.1 / 50.4|7.3 / 12.5 / 18.2 / 34.5|
|높음 호숫가|4.4 / 7.5 / 10.9 / 14.4|3.2 / 5.4 / 7.6 / 10.1|11.5 / 20.2 / 25.4 / 31.7|7.5 / 12.3 / 17.4 / 25.7|
|높음 숲|2.3 / 3.8 / 5.2 / 6.6|1.9 / 3.1 / 4.5 / 9.1|6.3 / 12.2 / 14.3 / 18.7|4.6 / 7.3 / 11.5 / 13.3|
|높음 남쪽 고개|1.4 / 2.8 / 6.4 / 14.2|1.3 / 2.7 / 5.9 / 9.5|3.9 / 6.9 / 9.3 / 15.1|3.5 / 6.3 / 8.9 / 20.2|
|높음 야영지|1.7 / 3.4 / 5.8 / 10.1|1.7 / 3.5 / 6.4 / 15.8|7.5 / 11.8 / 15.1 / 25.8|6.8 / 10.9 / 15.2 / 20.3|
|높음 비|2.9 / 4.6 / 6.6 / 11.9|3.1 / 5.7 / 7.4 / 12.3|8.6 / 12.8 / 16.8 / 20.6|8.8 / 16.0 / 22.3 / 30.0|
|높음 뇌우|2.9 / 4.6 / 5.8 / 10.7|3.5 / 6.8 / 8.6 / 11.5|8.6 / 14.1 / 16.3 / 21.1|10.4 / 19.5 / 26.1 / 31.1|
|높음 밤|2.7 / 4.1 / 5.3 / 9.5|2.8 / 4.4 / 7.9 / 11.4|8.2 / 12.5 / 16.0 / 18.1|8.1 / 13.6 / 17.1 / 23.5|
|높음 들불|3.0 / 6.5 / 9.8 / 13.5|3.1 / 8.4 / 11.4 / 14.5|6.8 / 11.2 / 14.8 / 19.1|6.5 / 11.7 / 16.2 / 28.0|
|높음 전투|5.1 / 9.7 / 13.0 / 18.6|5.7 / 10.7 / 15.9 / 39.9|10.2 / 18.1 / 23.4 / 38.1|10.5 / 18.2 / 22.9 / 53.3|
|높음 스케치북|3.6 / 7.9 / 11.3 / 15.8|3.8 / 9.3 / 14.5 / 23.2|8.1 / 13.6 / 16.5 / 23.2|7.6 / 13.0 / 16.8 / 21.6|
|최상 광장|2.8 / 4.3 / 6.0 / 12.2|2.8 / 4.5 / 6.0 / 8.5|8.9 / 13.9 / 17.2 / 19.0|8.4 / 13.6 / 18.1 / 25.3|
|최상 마을길|4.1 / 9.6 / 14.4 / 18.5|4.1 / 9.2 / 13.8 / 27.8|11.3 / 17.6 / 22.8 / 31.1|10.8 / 18.0 / 23.4 / 45.5|
|최상 호숫가|3.4 / 5.1 / 6.1 / 7.9|3.4 / 5.2 / 7.4 / 10.9|12.2 / 18.1 / 23.8 / 27.4|11.5 / 17.7 / 22.6 / 23.7|
|최상 숲|2.1 / 3.2 / 4.3 / 6.1|2.0 / 3.4 / 7.3 / 8.6|7.2 / 11.2 / 15.0 / 18.7|6.6 / 11.4 / 15.0 / 16.9|
|최상 남쪽 고개|1.6 / 3.6 / 5.9 / 17.9|1.5 / 3.6 / 6.0 / 11.8|4.6 / 7.7 / 10.0 / 15.4|4.4 / 7.8 / 11.2 / 16.2|
|최상 야영지|3.0 / 8.1 / 9.3 / 13.6|2.7 / 7.8 / 10.8 / 11.8|10.2 / 15.8 / 19.3 / 22.5|9.2 / 14.5 / 18.3 / 22.3|
|최상 비|3.4 / 8.2 / 12.4 / 17.8|3.1 / 8.0 / 11.8 / 13.5|9.3 / 15.6 / 17.7 / 25.2|7.9 / 12.4 / 16.3 / 18.3|
|최상 뇌우|3.0 / 4.9 / 7.2 / 10.1|2.7 / 4.2 / 5.9 / 12.0|9.4 / 15.8 / 19.3 / 32.4|8.3 / 14.0 / 18.6 / 21.9|
|최상 밤|2.8 / 3.9 / 5.6 / 8.1|2.7 / 4.3 / 5.5 / 7.8|8.3 / 12.6 / 16.8 / 18.5|8.0 / 12.5 / 15.9 / 20.1|
|최상 들불|3.5 / 9.4 / 11.5 / 17.5|3.4 / 9.2 / 11.3 / 19.9|9.3 / 15.5 / 18.0 / 25.5|8.5 / 14.0 / 17.9 / 25.2|
|최상 전투|5.6 / 10.5 / 15.8 / 27.9|5.5 / 10.5 / 16.7 / 29.3|14.3 / 23.7 / 33.0 / 63.6|13.1 / 22.1 / 29.0 / 80.8|
|최상 스케치북|4.2 / 9.4 / 16.3 / 21.7|3.7 / 9.5 / 14.2 / 25.7|12.0 / 19.6 / 24.5 / 33.5|9.9 / 16.3 / 21.6 / 30.9|

</details>

## 줄인 작업과 확인한 비용

|프로파일에서 찾은 비용|변경|작업량을 따로 센 결과 (HEAD → 수정본)|
|---|---|---|
|두 그림자 캐스케이드의 `WebGLShadowMap.renderObject → renderBufferDirect`|기존 140m 정적 묶음의 불투명 삼각형을 같은 깊이 컬링 방향끼리 합침. 풍차는 발광부를 분리하고 회전축에 고정된 날개를 합침|높음 광장 그림자 드로우/프레임, 정적 55.0 → 22.0, 풍차 37.9 → 19.0|
|인물의 재질별 그림자 제출과 `setProgram → getParameters`|마을 사람의 몸통은 동일한 스켈레톤·인덱스·깊이 조건에서 한 번 제출. 표정 메시와 장비는 종전 경로 사용. 고정 정점 구성을 쓰는 시전자·인스턴스에 깊이 재질을 재사용|광장 주민 그림자 드로우/프레임 62.0 → 36.0, 깊이 프로그램 키 계산/프레임 60.0 → 12.0|
|장면·리그의 `updateMatrixWorld`, `multiplyMatrices`, 그림자·카메라의 `projectObject` 순회|렌더 전 숨긴 최상위 개체는 건너뛰고 표시될 때 전체 갱신. 그릴 부착물이 없는 뼈 경로는 제출에서 제외. 동작 판정은 루트만 읽고 IK·옷자락 표적은 이미 구한 변환을 사용|광장 전체 로컬 행렬 합성/프레임 9333.4 → 5902.1, 월드 등 행렬곱/프레임 10750.2 → 7685.9|
|소품 재정렬 후 `WebGLAttributes.update → bufferSubData`|각 인스턴스 슬롯의 원본 번호와 마지막 페이드 값을 기억해 달라진 버퍼만 갱신. 아직 그리지 않은 슬롯의 업로드 범위를 유지|같은 300개 카메라 입력에서 비교한 275,848개 활성 성분이 일치. 소품 버퍼 전송 1,011,008 → 621,580바이트|
|지형의 `farSkin → vert → skyAt`, 풀 청크의 `Grass.build → Terrain.height`|고정된 원거리 암벽은 부팅 때 한 번 생성. 풀 후보는 잔디 가중치에 쓴 암벽 높이를 재사용|고개 구간 전체 지형 높이 호출 361641 → 254558, 해당 구간 Grass.build 85 → 85회. 원거리 암벽은 플레이 중 4 → 0회|
|첫 사용 시 `WebGLProgram.getUniforms → onFirstUse → getShaderInfoLog/getProgramInfoLog`|월드와 효과 견본의 링크·유니폼 조회를 부팅 중 수행. 기존 품질 변경·조명 변경 사전 컴파일도 유지|10체 전투 300프레임의 드라이버 프로그램 로그 조회 7 → 0회, 셰이더 로그 조회 14 → 0회. 첫 진입이나 새 조명 조합의 모든 지연이 사라지지는 않음|

프레임 시간은 모든 변경을 적용한 결과입니다. 위의 개별 수치는 호출·전송량으로 잰 직접 효과입니다. 예를 들어 광장 높음 p95는 21.9 → 16.6ms, 드로우콜 평균은 712.9 → 635.0회입니다. 횡단 중 미니맵 타일 생성 11 → 11회, 지도 탐험 칸 발견 100 → 100칸도 기록했습니다.

캐스케이드가 묶음 전체의 경계 구로 판정하면서 정적 그림자에 제출하는 삼각형은 늘었습니다. 높음에서 광장 프레임당 약 400만 → 405만 개, 고개 프레임당 약 29만 → 47만 개입니다. 이 수는 GPU에 제출한 삼각형이며 실제 화면을 덮은 픽셀 수는 별도입니다. 뇌우 벼락은 두 빌드 모두 정착 구간에 한 번 발생했고, 본 구간에는 비·바람과 그 여운이 남습니다.

## 함수별 비용과 긴 프레임

상위 세 함수는 프레임 안에서의 자기 시간 표본 합계를 프레임 수로 나눈 값(ms/프레임)입니다. 오른쪽은 별도 프로파일 실행에서 가장 긴 프레임의 상위 호출 스택과 표본 시간입니다. 샘플 간격과 OS 스케줄링 때문에 개별 표본으로 해당 함수의 정확한 실행 시간을 단정할 수 없습니다. 시간 측정 실행에서 발생한 개별 멈춤의 실제 스택은 프로파일 실행과 다를 수 있습니다.

### 높음 프로파일

|장면|수정 전 상위 함수|수정 후 상위 함수|수정 전 최악 프레임에서 가장 길게 잡힌 호출|수정 후 최악 프레임에서 가장 길게 잡힌 호출|
|---|---|---|---|---|
|마을 광장|`renderObject three.module.js:9569` 1.12<br>`updateMatrixWorld three.core.js:13067` 0.73<br>`multiplyMatrices three.core.js:10570` 0.73|`multiplyMatrices three.core.js:10570` 0.77<br>`renderObject three.module.js:9569` 0.57<br>`compose three.core.js:11030` 0.46|#81 · 32.3ms · `animate enemies.js:1076 ← update enemies.js:907 ← update enemies.js:3021` 3.1ms|#21 · 24.7ms · `obj.<computed> ← WebGLRenderer.render three.module.js:17674 ← render Pass.js:166` 8.2ms|
|마을길 달리기·질주|`renderObject three.module.js:9569` 1.31<br>`multiplyMatrices three.core.js:10570` 0.82<br>`updateMatrixWorld three.core.js:13067` 0.78|`multiplyMatrices three.core.js:10570` 0.59<br>`renderObject three.module.js:9569` 0.51<br>`setProgram three.module.js:18407` 0.46|#334 · 47.7ms · `getProgramInfoLog ← onFirstUse three.module.js:7022 ← WebGLProgram.getUniforms three.module.js:7121` 6.4ms|#112 · 26.3ms · `setProgram three.module.js:18407 ← WebGLRenderer.renderBufferDirect three.module.js:17233 ← renderObject three.module.js:18192` 3.2ms|
|거울 호숫가|`renderObject three.module.js:9569` 1.10<br>`updateMatrixWorld three.core.js:13067` 0.75<br>`projectObject three.module.js:17897` 0.72|`multiplyMatrices three.core.js:10570` 0.56<br>`compose three.core.js:11030` 0.45<br>`setProgram three.module.js:18407` 0.37|#127 · 32.4ms · `compose three.core.js:11030 ← updateMatrix three.core.js:13035 ← updateMatrixWorld three.core.js:13067` 4.3ms|#80 · 10.8ms · `multiplyMatrices three.core.js:10570 ← update three.core.js:25135 ← update three.module.js:4612` 1.6ms|
|속삭이는 숲|`renderObject three.module.js:9569` 0.62<br>`multiplyMatrices three.core.js:10570` 0.44<br>`compose three.core.js:11030` 0.42|`multiplyMatrices three.core.js:10570` 0.29<br>`renderObject three.module.js:9569` 0.26<br>`setProgram three.module.js:18407` 0.23|#24 · 18.8ms · `update three.module.js:4192 ← update three.module.js:4612 ← renderObject three.module.js:9569` 3.5ms|#15 · 12.1ms · `rotate ← draw minimap.js:92 ← obj.<computed>` 1.8ms|
|남쪽 고개 횡단|`updateMatrixWorld three.core.js:13067` 0.36<br>`compose three.core.js:11030` 0.33<br>`renderObject three.module.js:9569` 0.30|`projectObject three.module.js:17897` 0.22<br>`updateMatrixWorld three.core.js:13067` 0.19<br>`multiplyMatrices three.core.js:10570` 0.17|#849 · 23.2ms · `sampleGrid terrain.js:561 ← skyAt terrain.js:579 ← vert terrain.js:898` 5.0ms|#1 · 13.0ms · `lerp util.js:4 ← sampleGrid terrain.js:561 ← cliffAt terrain.js:372` 1.7ms|
|야영지 접근·생성|`renderObject three.module.js:9569` 0.58<br>`setProgram three.module.js:18407` 0.49<br>`multiplyMatrices three.core.js:10570` 0.39|`setProgram three.module.js:18407` 0.47<br>`WebGLRenderer.renderBufferDirect three.module.js:17233` 0.27<br>`projectObject three.module.js:17897` 0.27|#32 · 21.0ms · `setMaterial three.module.js:10409 ← WebGLRenderer.renderBufferDirect three.module.js:17233 ← renderObject three.module.js:9569` 4.8ms|#87 · 11.9ms · `build grass.js:299 ← obj.<computed> ← update grass.js:396` 4.8ms|
|비|`renderObject three.module.js:9569` 1.09<br>`multiplyMatrices three.core.js:10570` 0.77<br>`getParameters three.module.js:7357` 0.68|`multiplyMatrices three.core.js:10570` 0.43<br>`setProgram three.module.js:18407` 0.39<br>`renderObject three.module.js:9569` 0.32|#83 · 32.4ms · `renderObject three.module.js:9569 ← renderObject three.module.js:9569 ← renderObject three.module.js:9569` 3.5ms|#103 · 10.7ms · `setWorldQuat charkit.js:1303 ← legIK2 humanrig.js:1644 ← update humanrig.js:862` 1.7ms|
|뇌우|`renderObject three.module.js:9569` 0.95<br>`multiplyMatrices three.core.js:10570` 0.76<br>`getParameters three.module.js:7357` 0.64|`setProgram three.module.js:18407` 0.48<br>`multiplyMatrices three.core.js:10570` 0.38<br>`projectObject three.module.js:17897` 0.36|#68 · 26.1ms · `frontFace ← setFlipSided three.module.js:10449 ← setMaterial three.module.js:10409` 3.9ms|#176 · 23.1ms · `setProgram three.module.js:18407 ← WebGLRenderer.renderBufferDirect three.module.js:17233 ← renderObject three.module.js:18192` 3.3ms|
|밤|`renderObject three.module.js:9569` 0.97<br>`multiplyMatrices three.core.js:10570` 0.80<br>`compose three.core.js:11030` 0.69|`updateMatrixWorld three.core.js:13067` 0.47<br>`projectObject three.module.js:17897` 0.40<br>`setProgram three.module.js:18407` 0.38|#49 · 26.2ms · `update three.module.js:242 ← update three.module.js:4192 ← update three.module.js:4612` 4.7ms|#124 · 21.1ms · `multiplyMatrices three.core.js:10570 ← update three.core.js:25135 ← update three.module.js:4612` 3.2ms|
|번지는 들불|`renderObject three.module.js:9569` 0.79<br>`projectObject three.module.js:17897` 0.52<br>`multiplyMatrices three.core.js:10570` 0.46|`multiplyMatrices three.core.js:10570` 0.33<br>`renderObject three.module.js:9569` 0.27<br>`setProgram three.module.js:18407` 0.26|#7 · 39.8ms · `build grass.js:299 ← obj.<computed> ← update grass.js:396` 11.0ms|#111 · 15.9ms · `obj.<computed> ← WebGLRenderer.render three.module.js:17674 ← render renderer.js:575` 1.8ms|
|10체 전투·복합 마법|`renderObject three.module.js:9569` 1.28<br>`updateMatrixWorld three.core.js:13067` 0.86<br>`compose three.core.js:11030` 0.84|`multiplyMatrices three.core.js:10570` 0.61<br>`setProgram three.module.js:18407` 0.50<br>`renderObject three.module.js:9569` 0.39|#76 · 51.2ms · `update three.module.js:4192 ← update three.module.js:4612 ← projectObject three.module.js:17897` 3.8ms|#100 · 29.4ms · `restart hud.js:128 ← manaGain hud.js:141 ← gainMana player.js:711` 5.4ms|
|스케치북 생성|`renderObject three.module.js:9569` 1.02<br>`updateMatrixWorld three.core.js:13067` 0.69<br>`projectObject three.module.js:17897` 0.59|`ink sketches.js:216` 0.35<br>`setProgram three.module.js:18407` 0.32<br>`multiplyMatrices three.core.js:10570` 0.31|#8 · 35.3ms · `shape vfx.js:1351 ← regen vfx.js:1365 ← update vfx.js:1379` 7.9ms|#80 · 17.0ms · `bodyPose humanrig.js:1499 ← update humanrig.js:862 ← animate enemies.js:1076` 1.8ms|

### 최상 프로파일

|장면|수정 전 상위 함수|수정 후 상위 함수|수정 전 최악 프레임에서 가장 길게 잡힌 호출|수정 후 최악 프레임에서 가장 길게 잡힌 호출|
|---|---|---|---|---|
|마을 광장|`multiplyMatrices three.core.js:10570` 0.58<br>`getParameters three.module.js:7357` 0.48<br>`renderObject three.module.js:9569` 0.47|`multiplyMatrices three.core.js:10570` 0.35<br>`setProgram three.module.js:18407` 0.31<br>`WebGLRenderer.renderBufferDirect three.module.js:17233` 0.30|#20 · 13.1ms · `projectObject three.module.js:17897 ← projectObject three.module.js:17897 ← projectObject three.module.js:17897` 1.7ms|#99 · 9.4ms · `setFromRotationMatrix three.core.js:11523 ← setFromQuaternion three.core.js:11662 ← onQuaternionChange three.core.js:12042` 1.7ms|
|마을길 달리기·질주|`projectObject three.module.js:17897` 0.64<br>`getParameters three.module.js:7357` 0.55<br>`renderObject three.module.js:9569` 0.55|`setProgram three.module.js:18407` 0.55<br>`projectObject three.module.js:17897` 0.49<br>`multiplyMatrices three.core.js:10570` 0.48|#334 · 36.6ms · `sampleGrid terrain.js:561 ← skyAt terrain.js:579 ← vert terrain.js:898` 4.9ms|#106 · 34.6ms · `WebGLRenderer.renderBufferDirect three.module.js:17233 ← renderObject three.module.js:18192 ← renderObjects three.module.js:18165` 3.5ms|
|거울 호숫가|`projectObject three.module.js:17897` 0.76<br>`multiplyMatrices three.core.js:10570` 0.61<br>`getParameters three.module.js:7357` 0.55|`multiplyMatrices three.core.js:10570` 0.67<br>`setProgram three.module.js:18407` 0.55<br>`updateMatrixWorld three.core.js:13067` 0.47|#142 · 17.7ms · `(program) ← (root)` 1.6ms|#149 · 18.1ms · `multiplyMatrices three.core.js:10570 ← updateMatrixWorld three.core.js:13067 ← updateMatrixWorld three.core.js:13067` 1.6ms|
|속삭이는 숲|`setProgram three.module.js:18407` 0.37<br>`projectObject three.module.js:17897` 0.31<br>`getParameters three.module.js:7357` 0.28|`multiplyMatrices three.core.js:10570` 0.45<br>`projectObject three.module.js:17897` 0.36<br>`setProgram three.module.js:18407` 0.28|#32 · 8.4ms · `setProgram three.module.js:18407 ← WebGLRenderer.renderBufferDirect three.module.js:17233 ← renderObject three.module.js:9569` 1.7ms|#37 · 9.1ms · `(program) ← (root)` 1.7ms|
|남쪽 고개 횡단|`updateMatrixWorld three.core.js:13067` 0.34<br>`compose three.core.js:11030` 0.29<br>`projectObject three.module.js:17897` 0.24|`projectObject three.module.js:17897` 0.27<br>`multiplyMatrices three.core.js:10570` 0.20<br>`updateMatrixWorld three.core.js:13067` 0.20|#854 · 20.1ms · `renderObject three.module.js:18192 ← renderObjects three.module.js:18165 ← renderScene three.module.js:18015` 1.9ms|#1014 · 19.7ms · `renderObject three.module.js:9569 ← renderObject three.module.js:9569 ← WebGLShadowMap.render three.module.js:9143` 2.6ms|
|야영지 접근·생성|`setProgram three.module.js:18407` 0.65<br>`WebGLRenderer.renderBufferDirect three.module.js:17233` 0.44<br>`projectObject three.module.js:17897` 0.35|`setProgram three.module.js:18407` 0.74<br>`projectObject three.module.js:17897` 0.45<br>`WebGLRenderer.renderBufferDirect three.module.js:17233` 0.43|#18 · 20.0ms · `mass terrain.js:325 ← cliffAt terrain.js:372 ← height terrain.js:514` 3.3ms|#79 · 21.3ms · `(program) ← (root)` 3.0ms|
|비|`getParameters three.module.js:7357` 0.55<br>`setProgram three.module.js:18407` 0.45<br>`renderObject three.module.js:9569` 0.43|`setProgram three.module.js:18407` 0.54<br>`multiplyMatrices three.core.js:10570` 0.53<br>`renderObject three.module.js:9569` 0.48|#52 · 24.7ms · `length three.core.js:4505 ← normalize three.core.js:4517 ← setFromUnitVectors three.core.js:4353` 1.8ms|#14 · 20.5ms · `build grass.js:299 ← obj.<computed> ← update grass.js:396` 3.1ms|
|뇌우|`getParameters three.module.js:7357` 0.50<br>`multiplyMatrices three.core.js:10570` 0.41<br>`updateMatrixWorld three.core.js:13067` 0.39|`multiplyMatrices three.core.js:10570` 0.67<br>`setProgram three.module.js:18407` 0.50<br>`renderObject three.module.js:9569` 0.48|#170 · 12.5ms · `compose three.core.js:11030 ← updateMatrix three.core.js:13035 ← updateMatrixWorld three.core.js:13067` 1.7ms|#57 · 21.4ms · `update three.module.js:242 ← update three.module.js:4192 ← update three.module.js:4612` 3.1ms|
|밤|`getParameters three.module.js:7357` 0.48<br>`multiplyMatrices three.core.js:10570` 0.44<br>`setProgram three.module.js:18407` 0.41|`setProgram three.module.js:18407` 0.54<br>`projectObject three.module.js:17897` 0.37<br>`multiplyMatrices three.core.js:10570` 0.35|#129 · 10.8ms · `enable three.core.js:11829 ← getProgramCacheKeyBooleans three.module.js:7798 ← getProgramCacheKey three.module.js:7703` 1.7ms|#29 · 11.6ms · `uniformMatrix4fv ← setValueM4 three.module.js:5284 ← setValue three.module.js:6107` 3.1ms|
|번지는 들불|`projectObject three.module.js:17897` 0.54<br>`getParameters three.module.js:7357` 0.37<br>`compose three.core.js:11030` 0.32|`multiplyMatrices three.core.js:10570` 0.46<br>`setProgram three.module.js:18407` 0.40<br>`projectObject three.module.js:17897` 0.34|#14 · 25.3ms · `mass terrain.js:325 ← cliffAt terrain.js:372 ← height terrain.js:514` 3.1ms|#2 · 22.1ms · `build grass.js:299 ← obj.<computed> ← update grass.js:396` 3.3ms|
|10체 전투·복합 마법|`renderObject three.module.js:9569` 0.64<br>`projectObject three.module.js:17897` 0.62<br>`setProgram three.module.js:18407` 0.57|`projectObject three.module.js:17897` 1.08<br>`renderObject three.module.js:9569` 0.97<br>`multiplyMatrices three.core.js:10570` 0.94|#95 · 31.0ms · `getProgramCacheKey three.module.js:7703 ← getProgram three.module.js:18224 ← setProgram three.module.js:18407` 3.3ms|#247 · 45.1ms · `restart hud.js:128 ← manaGain hud.js:141 ← gainMana player.js:711` 9.7ms|
|스케치북 생성|`projectObject three.module.js:17897` 0.68<br>`setProgram three.module.js:18407` 0.56<br>`ink sketches.js:216` 0.43|`setProgram three.module.js:18407` 0.83<br>`renderObject three.module.js:9569` 0.65<br>`multiplyMatrices three.core.js:10570` 0.59|#0 · 18.2ms · `setProgram three.module.js:18407 ← WebGLRenderer.renderBufferDirect three.module.js:17233 ← renderObject three.module.js:18192` 3.3ms|#144 · 28.0ms · `flameHeat wildfire.js:284 ← update wildfire.js:319 ← obj.<computed>` 1.8ms|

<details>
<summary>비계측 실행의 가장 긴 프레임 (수정본)</summary>

같은 프레임의 갱신·렌더 분할과 당시 장면 상태입니다. 이것만으로 GC나 셰이더 컴파일을 판정할 수 없습니다.

|품질·장면|반복·프레임|갱신 + 렌더 (ms)|드로우콜|추격 적|암벽 작업|타는 칸|
|---|---|---:|---:|---:|---:|---:|
|높음 광장|C #105|12.6 + 12.7|635|0|0|0|
|높음 마을길|D #334|10.5 + 34.5|754|0|0|0|
|높음 호숫가|C #58|5.0 + 24.7|558|0|0|0|
|높음 숲|B #99|4.1 + 12.5|361|0|0|0|
|높음 남쪽 고개|D #755|4.7 + 20.2|153|0|0|0|
|높음 야영지|C #71|15.8 + 19.7|723|0|0|0|
|높음 비|B #18|6.2 + 30.0|651|0|0|0|
|높음 뇌우|B #43|6.7 + 29.7|651|0|0|0|
|높음 밤|D #91|10.4 + 18.4|649|0|0|0|
|높음 들불|D #22|3.1 + 28.0|485|0|0|39|
|높음 전투|D #95|33.4 + 25.9|767|7|0|26|
|높음 스케치북|C #14|23.2 + 9.7|571|1|0|42|
|최상 광장|C #154|3.5 + 25.3|761|0|0|0|
|최상 마을길|D #139|4.8 + 45.5|1004|0|0|0|
|최상 호숫가|C #6|10.9 + 18.8|937|0|0|0|
|최상 숲|C #99|4.2 + 16.9|547|0|0|0|
|최상 남쪽 고개|C #167|11.8 + 12.9|329|0|0|0|
|최상 야영지|C #13|11.4 + 16.9|995|0|0|0|
|최상 비|C #11|13.3 + 16.0|786|0|0|0|
|최상 뇌우|C #171|11.3 + 20.9|784|0|0|0|
|최상 밤|C #27|4.1 + 20.1|772|0|0|0|
|최상 들불|C #13|19.9 + 17.9|656|0|0|33|
|최상 전투|C #6|4.7 + 80.8|865|10|0|52|
|최상 스케치북|C #0|21.4 + 19.9|925|0|0|23|

</details>

<details>
<summary>일반 프레임과 33ms 초과 프레임에서 달라지는 함수</summary>

프로파일 실행별 하위 90% 프레임과 33ms 초과 프레임 각각에서 자기 시간 표본이 가장 큰 함수입니다. 표본 시간에는 드라이버가 반환하기까지 기다린 시간도 들어갑니다.

|품질·장면|HEAD 일반 / 지연|수정본 일반 / 지연|
|---|---|---|
|높음 광장|`renderObject three.module.js:9569` / 해당 표본 없음 (0프레임)|`multiplyMatrices three.core.js:10570` / 해당 표본 없음 (0프레임)|
|높음 마을길|`renderObject three.module.js:9569` / `renderObject three.module.js:9569` (6프레임)|`multiplyMatrices three.core.js:10570` / 해당 표본 없음 (0프레임)|
|높음 호숫가|`renderObject three.module.js:9569` / 해당 표본 없음 (0프레임)|`multiplyMatrices three.core.js:10570` / 해당 표본 없음 (0프레임)|
|높음 숲|`renderObject three.module.js:9569` / 해당 표본 없음 (0프레임)|`multiplyMatrices three.core.js:10570` / 해당 표본 없음 (0프레임)|
|높음 남쪽 고개|`updateMatrixWorld three.core.js:13067` / 해당 표본 없음 (0프레임)|`projectObject three.module.js:17897` / 해당 표본 없음 (0프레임)|
|높음 야영지|`renderObject three.module.js:9569` / 해당 표본 없음 (0프레임)|`setProgram three.module.js:18407` / 해당 표본 없음 (0프레임)|
|높음 비|`renderObject three.module.js:9569` / 해당 표본 없음 (0프레임)|`multiplyMatrices three.core.js:10570` / 해당 표본 없음 (0프레임)|
|높음 뇌우|`renderObject three.module.js:9569` / 해당 표본 없음 (0프레임)|`setProgram three.module.js:18407` / 해당 표본 없음 (0프레임)|
|높음 밤|`renderObject three.module.js:9569` / 해당 표본 없음 (0프레임)|`updateMatrixWorld three.core.js:13067` / 해당 표본 없음 (0프레임)|
|높음 들불|`renderObject three.module.js:9569` / `build grass.js:299` (2프레임)|`multiplyMatrices three.core.js:10570` / 해당 표본 없음 (0프레임)|
|높음 전투|`renderObject three.module.js:9569` / `renderObject three.module.js:9569` (16프레임)|`multiplyMatrices three.core.js:10570` / 해당 표본 없음 (0프레임)|
|높음 스케치북|`renderObject three.module.js:9569` / `shape vfx.js:1351` (1프레임)|`setProgram three.module.js:18407` / 해당 표본 없음 (0프레임)|
|최상 광장|`multiplyMatrices three.core.js:10570` / 해당 표본 없음 (0프레임)|`multiplyMatrices three.core.js:10570` / 해당 표본 없음 (0프레임)|
|최상 마을길|`projectObject three.module.js:17897` / `sampleGrid terrain.js:561` (1프레임)|`setProgram three.module.js:18407` / `setProgram three.module.js:18407` (1프레임)|
|최상 호숫가|`projectObject three.module.js:17897` / 해당 표본 없음 (0프레임)|`multiplyMatrices three.core.js:10570` / 해당 표본 없음 (0프레임)|
|최상 숲|`setProgram three.module.js:18407` / 해당 표본 없음 (0프레임)|`multiplyMatrices three.core.js:10570` / 해당 표본 없음 (0프레임)|
|최상 남쪽 고개|`updateMatrixWorld three.core.js:13067` / 해당 표본 없음 (0프레임)|`projectObject three.module.js:17897` / 해당 표본 없음 (0프레임)|
|최상 야영지|`setProgram three.module.js:18407` / 해당 표본 없음 (0프레임)|`setProgram three.module.js:18407` / 해당 표본 없음 (0프레임)|
|최상 비|`getParameters three.module.js:7357` / 해당 표본 없음 (0프레임)|`multiplyMatrices three.core.js:10570` / 해당 표본 없음 (0프레임)|
|최상 뇌우|`getParameters three.module.js:7357` / 해당 표본 없음 (0프레임)|`multiplyMatrices three.core.js:10570` / 해당 표본 없음 (0프레임)|
|최상 밤|`getParameters three.module.js:7357` / 해당 표본 없음 (0프레임)|`setProgram three.module.js:18407` / 해당 표본 없음 (0프레임)|
|최상 들불|`projectObject three.module.js:17897` / 해당 표본 없음 (0프레임)|`multiplyMatrices three.core.js:10570` / 해당 표본 없음 (0프레임)|
|최상 전투|`renderObject three.module.js:9569` / 해당 표본 없음 (0프레임)|`projectObject three.module.js:17897` / `projectObject three.module.js:17897` (25프레임)|
|최상 스케치북|`projectObject three.module.js:17897` / 해당 표본 없음 (0프레임)|`setProgram three.module.js:18407` / 해당 표본 없음 (0프레임)|

</details>

### 비용이 겹치는 구간

프로파일 실행에서 잰 포괄 시간입니다. 그림자는 스케치 렌더 안에서도 실행될 수 있어 열끼리 더할 수 없습니다. 각 칸은 수정 전 → 수정 후 p95(ms)입니다.

|품질·장면|그림자 제출|물 반사|적 갱신|주민 갱신|풀 청크 제작|지형 갱신|소품 재정렬|스케치북|
|---|---:|---:|---:|---:|---:|---:|---:|---:|
|높음 광장|8.5 → 5.3|0.0 → 0.0|1.1 → 1.0|2.3 → 2.1|0.0 → 0.0|0.1 → 0.1|0.0 → 0.1|0.0 → 0.0|
|높음 마을길|10.1 → 5.4|0.1 → 0.0|1.4 → 0.9|2.8 → 1.9|2.9 → 1.4|4.1 → 4.1|0.2 → 0.2|0.0 → 0.0|
|높음 호숫가|7.1 → 2.5|0.0 → 0.0|2.2 → 1.7|1.9 → 1.0|0.0 → 0.0|0.1 → 0.1|0.1 → 0.1|0.0 → 0.0|
|높음 남쪽 고개|2.7 → 1.2|0.0 → 0.0|0.1 → 0.1|0.1 → 0.1|1.8 → 1.7|0.1 → 0.1|0.1 → 0.1|0.0 → 0.0|
|높음 야영지|3.8 → 1.7|0.1 → 0.0|0.6 → 0.6|0.1 → 0.1|0.0 → 0.0|0.1 → 0.1|0.2 → 0.2|0.0 → 0.0|
|높음 전투|9.8 → 3.9|0.0 → 0.0|5.7 → 3.0|1.3 → 0.7|0.0 → 0.0|0.1 → 0.1|0.3 → 0.1|0.0 → 0.0|
|높음 스케치북|7.5 → 2.5|0.0 → 0.0|1.6 → 0.9|0.8 → 0.4|0.0 → 0.0|0.1 → 0.1|0.1 → 0.1|5.3 → 4.0|
|최상 광장|4.0 → 2.5|0.1 → 0.1|0.7 → 0.5|1.4 → 1.2|0.0 → 0.0|0.1 → 0.1|0.1 → 0.1|0.0 → 0.0|
|최상 마을길|3.9 → 2.9|2.8 → 2.8|0.6 → 0.5|1.2 → 1.2|5.0 → 4.6|4.9 → 5.0|0.2 → 0.2|0.0 → 0.0|
|최상 호숫가|4.2 → 3.3|3.2 → 2.9|1.5 → 1.5|1.1 → 1.0|0.0 → 0.0|0.1 → 0.1|0.0 → 0.0|0.0 → 0.0|
|최상 남쪽 고개|1.4 → 1.1|0.9 → 0.9|0.1 → 0.1|0.0 → 0.1|2.7 → 2.6|0.1 → 0.1|0.1 → 0.1|0.0 → 0.0|
|최상 야영지|2.3 → 2.4|2.1 → 2.2|0.6 → 0.3|0.0 → 0.1|7.0 → 6.8|0.1 → 0.1|0.2 → 0.1|0.0 → 0.0|
|최상 전투|4.3 → 8.5|2.7 → 5.2|2.7 → 4.4|0.6 → 1.1|0.0 → 0.0|0.1 → 0.1|0.2 → 0.1|0.0 → 0.0|
|최상 스케치북|3.3 → 4.5|2.6 → 4.0|1.0 → 1.2|0.4 → 0.5|0.0 → 0.0|0.1 → 0.1|0.1 → 0.1|4.3 → 5.2|

### 도착 직후

아래 최대값은 프로파일러를 켠 별도 정착 구간입니다. 측정 루프는 원래 부팅 중 타이틀에서 그리는 첫 장면까지 미루므로 광장의 첫 프레임에는 GPU 초기화 비용이 들어갑니다. 실제 시작 시점의 지연은 일반 게임 루프에서 따로 확인했습니다. 캠프 접근의 실제 생성은 정식 분포 표에 들어갑니다.

|품질|빌드|도착 최대 장면·프레임|갱신 + 렌더 (ms)|가장 긴 표본 스택|
|---|---|---|---:|---|
|높음|HEAD|plaza #0|107.4 + 4706.4|`getProgramInfoLog ← onFirstUse three.module.js:7022 ← WebGLProgram.getUniforms three.module.js:7121 ← setProgram three.module.js:18407`|
|높음|수정본|plaza #0|198.3 + 4373.1|`getProgramInfoLog ← onFirstUse three.module.js:7022 ← WebGLProgram.getUniforms three.module.js:7121 ← setProgram three.module.js:18407`|
|최상|HEAD|plaza #0|112.0 + 3533.2|`getProgramInfoLog ← onFirstUse three.module.js:7022 ← WebGLProgram.getUniforms three.module.js:7121 ← setProgram three.module.js:18407`|
|최상|수정본|plaza #0|93.1 + 3127.9|`getProgramInfoLog ← onFirstUse three.module.js:7022 ← WebGLProgram.getUniforms three.module.js:7121 ← setProgram three.module.js:18407`|

본 구간 전체에서 가비지 컬렉터로 분류된 표본은 높음 48.2 → 22.6ms, 최상 38.3 → 39.6ms였습니다. 개별 긴 프레임의 호출 스택에 GC가 잡힌 경우에만 그 프레임과 연관 지을 수 있습니다.

### 반복 간 차이와 남은 비용

- 높음에서 p95가 가장 높은 장면은 전투 (28.6ms), 단일 최장은 전투 (59.3ms)입니다. 수정본 p95 반복차가 가장 큰 뇌우 장면의 세 번 측정값은 29.9 / 13.5 / 20.1ms였습니다.
- 최상에서 p95가 가장 높은 장면은 전투 (30.9ms), 단일 최장은 전투 (85.5ms)입니다. 수정본 p95 반복차가 가장 큰 전투 장면의 세 번 측정값은 27.6 / 29.6 / 35.6ms였습니다.
- 높음 뇌우 p95는 18.4 → 25.6ms, 전투는 26.9 → 28.6ms였습니다. 뇌우는 드로우콜 감소에도 세 번 중 두 번에서 느려졌습니다. 최상 전투 p95는 33.8 → 30.9ms로 줄었지만 최장은 67.9 → 85.5ms로 늘었습니다. 최상 수정본의 최악 프레임에서는 갱신 4.7ms와 렌더 80.8ms가 기록됐고, 그 순간 살아 있는 프로그램 수는 전후 153개로 같았습니다. 이 비계측 프레임의 드라이버 내부 대기 원인은 특정하지 못했습니다.
- 고개 횡단은 남쪽 경로 한 곳입니다. 청크·풀·소품 캐시의 온도에 따라 첫 방문과 재방문이 달라집니다. 전투·반사·스케치 장면에서는 실제로 보이는 메시와 두 캐스케이드·별도 시점의 제출, 새 효과의 첫 사용이 여전히 한 프레임 안에 겹칩니다. 광장 정지 화면의 평균만으로 이 지연을 예측할 수 없습니다.
- 옷자락 방향을 한 번에 갱신하는 시도는 160개 자세에서 기존 뼈대 행렬과 최대 0.532까지 달라 제외했습니다. 최종 IK와 체인에서 같은 검사의 최대 오차는 0과 0입니다. 측정된 장면들에 대해 60fps를 보장할 수 없습니다. 가시 거리·밀도·그림자 또는 마법 효과 품질을 낮춘 대안은 시험하지 않았습니다.

### 일반 게임 루프의 부팅과 첫 플레이

새 프로필의 `?dev=skills`에서 게임 자체의 개발 타이머를 그대로 돌리고 `G.game.perf` 대입값을 기록했습니다. 타이틀 첫 렌더는 로딩 화면을 내리기 전에 실행됩니다. 그 다음 실제 플레이 첫 45프레임은 별도로 집계했습니다(품질별 1회).

|품질·빌드|로딩 중 타이틀 렌더 (ms)|플레이 첫 갱신 + 렌더 (ms)|첫 45프레임 p95 / 최대 (ms)|33ms 초과|
|---|---:|---:|---:|---:|
|높음 HEAD|1571.2|113.7 + 2713.9|45.9 / 2827.6|5|
|높음 수정본|1618.5|164.4 + 2371.4|33.2 / 2535.8|3|
|최상 HEAD|1717.2|173.8 + 2899.3|77.1 / 3073.1|26|
|최상 수정본|1632.6|177.8 + 2109.7|66.8 / 2287.5|15|

별도 실험에서 이야기 시작 직후 효과 견본과 모든 프로그램 유니폼을 한 번 더 예열했습니다. 높음은 573ms를 먼저 쓰고도 첫 렌더 1647ms, 최상은 472ms를 먼저 쓰고도 첫 렌더 2357ms가 남았습니다. 드라이버 조회를 앞당기는 것만으로 긴 첫 프레임을 해소하지 못해 이 중복 예열은 제외했습니다.

## 화면과 기능 검증

- 실제 게임에서 비교한 주민 그림자 8개, 인덱스 422,076개의 차이 0개, 바인드 행렬 최대 오차 0. 풀 후보 13,588개에서 원래 지면 높이와 최대 차이 0m.
- 같은 입력과 시점으로 찍은 전체 화면 PNG 네 쌍의 채널당 평균 절대 차이(0~255)는 광장 2.71, 호숫가 0.94, 숲 0.50, 최상 고정 호수 시점 2.36입니다. 좌우 비교에서 건물·절벽 윤곽·나무 배치·그림자는 같은 위치에 보입니다. 동료 자세와 입자, 호수 위 개체 위치, 높음 호숫가의 지역명 HUD 표시 시점은 캡처 간에 차이가 있습니다.
- `npx vite build --configLoader native` 통과. 기본 프로덕션 번들에서 `?dev=1`, `?dev=skills` 각각 45개 실제 게임 루프의 프레임 갱신을 관찰하고 페이지 예외·브라우저 오류·콘솔 오류를 확인했습니다.
- 별도 프로파일 실행에서 탐색 시작부터 부팅 준비까지 높음 26.0 → 27.3초, 최상 17.4 → 17.8초였습니다. 셰이더 사전 조회와 원거리 암벽 생성은 부팅 비용에 포함됩니다.
- 작업 증거의 `work/quiet-results.csv`에는 합계·갱신·렌더·드로우콜 각각의 평균·p95·p99·최대와 세 번의 p95를 보관했습니다. `work/README.md`에 재현 방법과 원시 프레임·CDP 프로파일 위치가 있습니다.

원본 화면 파일은 `plaza-before.png`·`plaza-after.png`, `lake-before.png`·`lake-after.png`, `woods-before.png`·`woods-after.png`, `lake-ultra-before.png`·`lake-ultra-after.png`입니다. `views-before-after.jpg`에서 네 쌍을 나란히 볼 수 있습니다.
