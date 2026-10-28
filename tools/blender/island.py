# 하늘섬을 Blender 안에서 직접 모델링한다(외부 모델 없음). 앱: public/models/island.glb
#   blender -b -P tools/blender/island.py -- <out_dir> [preview|glb] [samples]
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: F401,F403

# ── 장면 조립 ─────────────────────────────────────────

build_ground()
build_river()
block(HILL.x, HILL.y, HILL_R * 0.9)
windmill(HILL.x, HILL.y, 0.4)
lighthouse(*(Vector((math.cos(-2.4), math.sin(-2.4))) * R * rim_b(-2.4) * 0.82))
houses = [(1.5, 2.4, 0.2, 1.3, 1.0, 1.0, ROOF_RED, SHUTTER_G), (-1.6, -2.7, 2.6, 1.05, 0.85, 0.9, ROOF_BLUE, SHUTTER_B),
          (3.3, 1.9, -0.5, 0.9, 0.8, 0.8, ROOF_BROWN, SHUTTER_G), (0.8, -3.6, 3.3, 0.9, 0.75, 0.8, ROOF_RED, SHUTTER_B),
          (-3.7, -1.2, 1.4, 0.85, 0.75, 0.75, ROOF_BROWN, SHUTTER_G)]
for i, (x, y, r, w, d, h, roof, sh) in enumerate(houses):
    if free(x, y, 0.6):
        house(f'house_{i}', x, y, r, w, d, h, roof, sh)
stepping_stones([(1.2, 1.6), (0.6, 0.2), (0.4, -1.4), (-1.2, -2.0)])
for x, y in ((0.3, 1.2), (-0.9, -1.6), (3.0, 0.7)):
    if free(x, y, 0.2):
        lamp(x, y)
for i in range(300):
    x, y = pick(0.15, 0.55)
    if free(x, y, 0.5):
        well(x, y)
        break
for i in range(400):
    x, y = pick(0.2, 0.6)
    if free(x, y, 1.25):
        fence_ring('pasture', x, y, 1.05, rnd.random() * math.tau)
        block(x, y, 1.15)
        for k in range(4):
            a = k / 4 * math.tau + rnd.random()
            d = 0.25 + rnd.random() * 0.45
            sheep(f'sheep_{k}', x + math.cos(a) * d, y + math.sin(a) * d, rnd.random() * math.tau)
        break
for i in range(4):
    for _ in range(100):
        x, y = pick(0.3, 0.8)
        if free(x, y, 0.3):
            sheep(f'sheep_free_{i}', x, y, rnd.random() * math.tau)
            block(x, y, 0.3)
            break
for i in range(5):
    for _ in range(100):
        x, y = pick(0.2, 0.7)
        if free(x, y, 0.25):
            hay(x, y)
            break

# 나무: 단풍 + 전나무
palette = ['orange', 'orange', 'red', 'yellow', 'green', 'red', 'orange']
trees = 0
for i in range(3000):
    if trees >= 58:
        break
    x, y = pick(0.25, 0.9)
    h = 0.85 + rnd.random() * 0.6
    if not free(x, y, 0.32 * h):
        continue
    if rnd.random() < 0.38:
        pine_tree(f'tree_{trees}', x, y, h * 1.25)
    else:
        leafy_tree(f'tree_{trees}', x, y, h, palette[trees % len(palette)])
    block(x, y, 0.3 * h + 0.05)
    trees += 1
print('trees', trees, flush=True)
for i in range(70):
    for _ in range(40):
        x, y = pick(0.2, 0.97)
        s = 0.13 + rnd.random() * 0.12
        if free(x, y, s * 0.8):
            bush(f'bush_{i}', x, y, s)
            block(x, y, s)
            break
for i in range(16):
    x, y = pick(0.86, 0.97)
    if free(x, y, 0.1):
        rock(f'rock_{i}', x, y, 0.15 + rnd.random() * 0.2)
flowers(260)

setup_render((12.8, -14.4, 8.6), (0, 0, -1.5))

# 구름바다(미리보기용)
for i in range(26):
    a = rnd.random() * math.tau
    r = 9 + rnd.random() * 18
    blob(f'cloud_{i}', 1.0 + rnd.random() * 1.0, (math.cos(a) * r, math.sin(a) * r, -13 + rnd.random() * 1.5), mat('cloud', '#ffffff', 1.0, 0),
         scale=(1.6, 1.2, 0.55), sub=3, disp=0.4, disp_size=1.2)


if MODE == 'glb':
    export_glb(os.path.abspath(os.path.join(OUT, 'island.glb')))
if MODE == 'preview':
    scene.render.filepath = os.path.join(OUT, 'preview.png')
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(OUT, 'island.blend')))
    print('done', flush=True)
