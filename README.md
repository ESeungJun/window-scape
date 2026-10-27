# 하늘섬 날씨 (SKY ISLE)

하늘에 떠 있는 로우폴리 섬으로 실제 날씨를 보여주는 웹 앱. 섬 가장자리에서 폭포가 구름바다로 떨어지고,
시간대·날씨·계절에 따라 하늘색, 조명, 비·눈·번개·무지개, 나뭇잎 색이 바뀐다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 타입 검사 + 프로덕션 빌드
```

## 데스크톱 위젯 (macOS, Tauri)

바탕화면에 띄워 두는 위젯 앱. 테두리 없는 둥근 창으로 처음엔 화면 우상단에 뜨고, 메뉴 막대 아이콘에서 배치를 바꾼다.

```bash
# 처음 한 번: Rust 설치 (https://rustup.rs)
npm run tauri dev                 # 위젯 개발 실행
npm run tauri build -- --bundles app   # src-tauri/target/release/bundle/macos/하늘섬 날씨.app
```

- 위쪽 띠를 끌면 창이 옮겨지고, 오른쪽 아래 모서리를 끌면 크기가 바뀐다. 위치·크기는 다음 실행 때도 유지된다.
- 메뉴 막대 아이콘: 바탕화면에 고정(다른 창 아래) / 항상 위에 표시 / 우상단·좌상단으로 옮기기 / 로그인 시 자동 실행 / 종료.
- 창 크기에 따라 정보량이 바뀐다(작으면 섬과 기온, 크면 웹과 같은 화면). 배터리를 아끼려고 30fps 로 그린다.

## 웹 옵션

- **쇼케이스 모드**: `F` 키, 보기 설정의 '화면 → 쇼케이스', 또는 `?showcase` 주소로 켠다.
  베이지 배경 위 둥근 창에 화면을 담아 보여준다(영상 녹화용).
- **현재 위치**: 좌표를 소수 2자리(약 1km)로 줄여서만 쓰고, 기기 위치는 저장하지 않는다.
- **보안 헤더**: 배포 빌드의 `index.html` 에 CSP 메타 태그가 들어간다(`vite.config.ts`).

## 구조

| 경로 | 역할 |
|---|---|
| `src/data/weather.ts` | Open-Meteo 예보·지명 검색, 날씨 코드 → 연출 상태 변환, 현지 시간대·계절 계산 |
| `src/scene/env.ts` | 시간대·날씨·계절 프리셋을 합친 연출 값과 보간 |
| `src/scene/island.ts` | 섬(땅·바위 받침·강·폭포·마을·나무·떠다니는 작은 섬) |
| `src/scene/clouds.ts` | 섬 주변 구름과 아래 구름바다 |
| `src/scene/precipitation.ts` | 비·눈·번개·무지개 |
| `src/scene/sky.ts` | 하늘 그라디언트, 해·달, 별 |
| `src/scene/world.ts` | 렌더러·카메라·조명, 프레임 루프 |
| `src/widget.ts` | 데스크톱 위젯 창 꾸미기(끌어 옮기기·크기 조절 손잡이) |
| `src-tauri/` | Tauri 앱: 창 설정, 메뉴 막대 아이콘, 배치·자동 실행 |
| `src/ui/*` | 현재 날씨, 7일·시간별 예보, 보기 설정, 검색, 배경 소리 |

섬은 전부 코드로 만든다. Blender 모델로 바꾸려면 `island.ts` 에서 `.glb` 를 `GLTFLoader` 로 불러와
같은 `group` 에 넣고, 계절에 따라 색을 바꿀 머티리얼 이름만 맞추면 된다.

날씨 데이터: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). 무료 API 는 비상업 용도 전용이라,
상업 서비스로 배포하려면 유료 플랜이 필요하다.
