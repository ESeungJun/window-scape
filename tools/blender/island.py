# 하늘섬을 Blender 안에서 직접 모델링한다(외부 모델 없음). 앱: public/models/island.glb + island_light.png(라이트맵)
#   blender -b -P tools/blender/island.py -- public/models glb 384
#   ffmpeg -i public/models/island_light.png -c:v libwebp -quality 90 public/models/island_light.webp  (png 는 지운다)
# 새 룩: 물체는 적게, 빈 풀밭은 넉넉하게, 소품마다 사연(집 둘·풍차·등대·우물·노점·모닥불·양 우리·전망대).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: F401,F403
import look

# ── 장면 조립 ─────────────────────────────────────────
# 섬에 비해 소품을 큼직하게(레퍼런스처럼 집·나무가 섬을 꽉 채워 보이게)
G = 1.35


def grow(o, s=G, r=None):
    o.scale = (s, s, s)
    if r:
        block(o.location.x, o.location.y, r)
    return o


build_ground()
build_river()
block(HILL.x, HILL.y, HILL_R * 0.9)
grow(windmill(HILL.x, HILL.y, 0.4), 1.25)
lh = Vector((math.cos(-2.4), math.sin(-2.4))) * R * rim_b(-2.4) * 0.82
grow(lighthouse(lh.x, lh.y), 1.3, 1.0)

# 집 둘(문이 카메라 쪽을 본다)과 그 앞 흙길
grow(look.house('house_0', 1.9, 2.6, 0.55, 1.35, 1.05, 1.15), G, 1.5)
grow(look.house('house_1', -1.4, -2.6, -0.35, 1.1, 0.9, 1.0), G, 1.3)
look.path('path_0', [(1.6, 1.6), (0.9, 0.7), (0.3, -0.6), (-0.6, -1.6), (-1.1, -1.9)])
look.path('path_1', [(0.3, -0.6), (1.0, -1.9), (1.2, -3.0)])
look.path('path_2', [(-1.1, -1.9), (-2.4, -2.4), (lh.x * 0.82, lh.y * 0.82)], 0.24)

grow(well(0.15, 1.25), 1.3, 0.65)
grow(look.market_stall(3.0, 0.7, 0.35), 1.3, 1.0)
grow(look.barrel('barrel_0', 3.85, 1.35))
grow(look.barrel('barrel_1', 4.05, 1.05))
grow(look.signpost(0.75, -0.25, 0.4))

# 모닥불과 둘러앉는 벤치
fx, fy = 1.35, -3.35
grow(look.campfire(fx, fy), G, 0.55)
grow(look.bench('bench_0', fx - 0.8, fy + 0.12, -1.4))
grow(look.bench('bench_1', fx + 0.12, fy + 0.8, 3.0))

# 양 우리(곧은 울타리) + 양 다섯
px, py = 3.7, 2.9
look.fence_line('pen', [(px - 0.9, py - 0.7), (px + 0.9, py - 0.7), (px + 0.9, py + 0.7), (px - 0.9, py + 0.7), (px - 0.9, py - 0.7)], gate=0)
block(px, py, 1.15)
for k, (dx, dy) in enumerate(((-0.4, -0.2), (0.2, 0.25), (0.5, -0.25), (-0.2, 0.35), (1.25, -0.95))):
    grow(sheep(f'sheep_{k}', px + dx, py + dy, rnd.random() * math.tau), 1.5)
grow(look.haystack('hay_0', px - 1.25, py + 0.6))
grow(look.haystack('hay_1', px - 1.55, py + 0.2))

# 섬 끝 전망대(앞쪽 가장자리, 바깥을 본다)
a = -1.25
e = Vector((math.cos(a), math.sin(a))) * R * rim_b(a) * 0.93
grow(look.lookout(e.x, e.y, a), 1.25)

# 나무: 머스터드 뭉게구름·황토 달걀·적갈·전나무. 빈 풀밭이 남도록 적게
kinds = ['cloud:orange', 'pine', 'oval:red', 'cloud:orange', 'oval:rust', 'pine', 'cloud:red', 'oval:orange', 'pine']
trees = 0
for i in range(4000):
    if trees >= 20:
        break
    x, y = pick(0.35, 0.9)
    h = (0.9 + rnd.random() * 0.5) * G
    if not free(x, y, 0.42 * h):
        continue
    kind = kinds[trees % len(kinds)]
    if kind == 'pine':
        look.pine(f'tree_{trees}', x, y, h * 1.35)
    elif kind.startswith('cloud'):
        look.cloud_tree(f'tree_{trees}', x, y, h, kind.split(':')[1])
    else:
        look.oval_tree(f'tree_{trees}', x, y, h * 1.15, kind.split(':')[1])
    block(x, y, 0.36 * h + 0.05)
    trees += 1
print('trees', trees, flush=True)
for i in range(14):
    for _ in range(60):
        x, y = pick(0.3, 0.95)
        s = (0.12 + rnd.random() * 0.08) * 1.3
        if free(x, y, s):
            bush(f'bush_{i}', x, y, s)
            block(x, y, s)
            break
# 가장자리 바위
for i in range(10):
    for _ in range(60):
        x, y = pick(0.86, 0.96)
        s = 0.18 + rnd.random() * 0.2
        if free(x, y, s * 0.8):
            look.boulder(f'rock_{i}', x, y, s)
            break
flowers(110)

setup_render((12.8, -14.4, 8.6), (0, 0, -1.5))

if MODE == 'glb':
    out = os.path.abspath(OUT)
    export_glb(os.path.join(out, 'island.glb'), lightmap=os.path.join(out, 'island_light.png'), samples=SAMPLES)
if MODE == 'preview':
    scene.render.filepath = os.path.join(OUT, 'preview.png')
    bpy.ops.render.render(write_still=True)
    print('done', flush=True)
