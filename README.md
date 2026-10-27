# 하늘섬 날씨 (SKY ISLE)

하늘에 떠 있는 로우폴리 섬으로 실제 날씨를 보여주는 웹 앱. 섬 가장자리에서 폭포가 구름바다로 떨어지고,
시간대·날씨·계절에 따라 하늘색, 조명, 비·눈·번개·무지개, 나뭇잎 색이 바뀐다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 타입 검사 + 프로덕션 빌드
```

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
| `src/ui/*` | 현재 날씨, 7일·시간별 예보, 보기 설정, 검색, 배경 소리 |

섬은 전부 코드로 만든다. Blender 모델로 바꾸려면 `island.ts` 에서 `.glb` 를 `GLTFLoader` 로 불러와
같은 `group` 에 넣고, 계절에 따라 색을 바꿀 머티리얼 이름만 맞추면 된다.

날씨 데이터: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0)
