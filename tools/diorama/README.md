# 포켓몬 디오라마 굽기

포켓몬 테마 네 장면(`src/scene/pokemon.ts`)은 Blender 에서 요소 모델을 조합하고 낮·밤 빛을 텍스처에 구운
GLB(`public/models/env/<name>.glb`)를 그대로 보여 준다. 앱은 그 위에 포켓몬·물·안개·밤 불빛만 실시간으로 얹는다.

| 파일 | 내용 |
| --- | --- |
| `diorama.py` | 공통 라이브러리: 요소 불러오기, 바닥 재질(나무 받침·잔디·돌바닥·모래), 낮/밤 조명, 굽기, GLB 내보내기 |
| `scene_<name>.py` | 장면별 배치(center·lake·city·battle) |
| `parts/*.glb` | 요소 모델(Tripo 이미지→3D 결과를 텍스처만 줄인 것) |

## 준비

- Blender 4.5 LTS (`brew install --cask blender`)
- gltf-transform: `npm i -g @gltf-transform/cli`

## 굽기

```sh
cd tools/diorama
B=/Applications/Blender.app/Contents/MacOS/Blender

# 미리보기(카메라 렌더 낮/밤 PNG + .blend): 배치 확인용, 몇 분
$B -b -P diorama.py -- scene_city.py parts out_city preview 32

# 굽기: 요소마다 낮·밤 텍스처를 구워 out_city/city.glb 로 내보낸다
$B -b -P diorama.py -- scene_city.py parts out_city bake 48
```

- GPU(Apple Silicon Metal, NVIDIA, AMD HIP)가 잡히면 자동으로 GPU 로 굽는다. 로그에 `render device:` 가 찍힌다.
- Intel 맥(i7-9750H, CPU)에서 장면당 약 40분(center 38분, lake 30분) 걸렸다.
- 텍스처는 `save_render` 로 저장해 AgX 색 변환을 그대로 입힌다(빠지면 앱 색이 Blender 렌더와 달라진다).

## 압축해서 앱에 넣기

```sh
gltf-transform optimize out_city/city.glb ../../public/models/env/city.glb \
  --compress meshopt --simplify-ratio 0.25 --simplify-error 0.0005 \
  --texture-size 2048 --texture-compress webp
```

- `--simplify-ratio` 를 0.06 처럼 세게 주면 Tripo 텍스처 아틀라스가 찢어져 건물이 일그러진다. 0.25 / 0.0005 는 원본과 눈으로 구분되지 않았다.
- meshopt 디코더는 `src/scene/models.ts` 의 로더에 걸려 있다.
- 결과 크기: center 6.8MB, lake 5.6MB.

## 확인

```sh
npm run dev -- --port 5179 --strictPort --host 127.0.0.1
THEME=poke-city node tools/shot.mjs city-day.jpg "setInterval(()=>__world.setSelection('day','clear','summer'),300)" 12000
```

`__world` 는 개발 서버에서만 열린다(`src/main.ts`).

## 진행 상황 (2026-10-28)

- [x] 포켓몬센터: 굽기·압축·앱 확인 완료(낮/밤)
- [x] 노을 호수: 굽기·압축 완료, 앱 낮 화면 확인
- [ ] 상록시티: `scene_city.py` 굽기 → 압축 → `public/models/env/city.glb`
- [ ] 체육관 배틀: `scene_battle.py` 굽기 → 압축 → `public/models/env/battle.glb`
- [ ] 네 장면 낮·밤·비 화면을 Blender 미리보기와 비교

## 다음 할 일

- 노을 호수: 큰 나무 윗부분이 화면 위로 잘린다 → `ScenicLake` 의 view target 을 올리거나 거리를 늘린다.
  라프라스가 옆을 보고 있어 카메라 쪽으로 더 돌리고, 피카츄·이상해씨를 조금 키운다.
- 상록시티·체육관 배틀: 굽고 나면 포켓몬 위치·크기·연못 위치(`ViridianCity`, `GymBattle`)를 화면에 맞춰 다듬는다.
- README: 새 스크린샷, 포켓몬 IP 고지(비공식 팬 작품).
- 추가 테마 후보: 수영장(물 포켓몬), 고스트 성, LoL(Riot "Legal Jibber Jabber" 고지 필요).
