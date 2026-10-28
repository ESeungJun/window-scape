# 하늘섬을 Blender 안에서 직접 모델링한다(외부 모델 없음). 앱: public/models/island.glb + island_light.png(라이트맵)
#   blender -b -P tools/blender/island.py -- public/models glb 384
#   ffmpeg -i public/models/island_light.png -c:v libwebp -quality 90 public/models/island_light.webp  (png 는 지운다)
# 레퍼런스 디오라마처럼 넓은 섬(반지름 9)에 이야기가 있는 마을: 언덕 위 풍차, 바위 곶의 등대, 광장을 둘러싼 집 넷,
# 강과 다리, 모래 호숫가의 선착장·낚시 오두막·나룻배, 양 우리, 밭, 가장자리를 두른 숲.
# 배치는 scr(u, v) = 앱 기본 시점에서 본 화면 좌표(u 오른쪽, v 안쪽)로 잡는다.
# 끝에 찍는 RIVER·LAKE·POS 값은 앱(src/scene/island.ts)의 강·호수·밤 불빛 자리와 같게 맞춘다.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: F401,F403
import look

# 소품 배율(섬에 비해 큼직하게)
G = 1.35
# 집 정면(-y)이 카메라 쪽을 보는 회전
FACE = math.atan2(CAM.x, -CAM.y)
H = math.pi / 2


def grow(o, s=G, r=None):
    o.scale = (s, s, s)
    if r:
        block(o.location.x, o.location.y, r)
    return o


def at(c, rot, lx, ly):
    """c 를 기준으로 rot 만큼 돌린 지역 좌표(lx, ly)"""
    return Vector((c.x + lx * math.cos(rot) - ly * math.sin(rot), c.y + lx * math.sin(rot) + ly * math.cos(rot)))


def rim_at(u, v, k):
    """화면 방향 (u, v) 쪽 가장자리의 점(반지름 k 배)과 그 각도"""
    p = scr(u, v)
    a = math.atan2(p.y, p.x)
    return Vector((math.cos(a), math.sin(a))) * R * rim_b(a) * k, a


build_ground()
build_river()

# ── 호수: 모래 바닥(물은 앱이 그린다), 둘레 자갈 ─────────────
LROT = math.atan2(RIGHT.y, RIGHT.x)
blob('sand_lake', 1.0, (LAKE.x, LAKE.y, TOP - 0.04), SAND, scale=(LAKE_R[0] + 0.55, LAKE_R[1] + 0.5, 0.058), sub=4).rotation_euler = (0, 0, LROT)
blob('water_lake', 1.0, (LAKE.x, LAKE.y, TOP + 0.015), WATER, scale=(LAKE_R[0], LAKE_R[1], 0.01), sub=3).rotation_euler = (0, 0, LROT)
block(LAKE.x, LAKE.y, LAKE_R[0] + 0.4)
for k in range(26):
    if rnd.random() < 0.3:
        continue
    a = k / 26 * math.tau
    p = at(LAKE, LROT, math.cos(a) * (LAKE_R[0] + 0.62), math.sin(a) * (LAKE_R[1] + 0.58))
    blob(f'lake_pebble_{k}', 0.08 + rnd.random() * 0.07, (p.x, p.y, TOP + 0.02), STONE, scale=(1.3, 1, 0.6), sub=2, disp=0.03, disp_size=0.2)

# ── 언덕 위 풍차, 바위 곶의 등대 ─────────────────────────
block(HILL.x, HILL.y, HILL_R * 0.6)
grow(windmill(HILL.x, HILL.y, FACE), 1.3)
lh, la = rim_at(1.2, 6, 0.86)
grow(lighthouse(lh.x, lh.y), 1.35, 1.2)
for k in range(9):
    a = k / 9 * math.tau
    d = 1.0 + rnd.random() * 0.5
    look.boulder(f'lh_rock_{k}', lh.x + math.cos(a) * d, lh.y + math.sin(a) * d, 0.28 + rnd.random() * 0.25)

# ── 마을: 광장(우물)을 둘러싼 집 넷, 노점 ─────────────────
plaza = scr(-1.6, 0.2)
grow(well(plaza.x, plaza.y), 1.3, 0.8)
houses = [(scr(-4.6, -0.4), 1.35, 1.05, 1.15, 0.25), (scr(-3.3, -3.0), 1.15, 0.95, 1.0, -0.2),
          (scr(2.5, 3.4), 1.25, 1.0, 1.1, 0.15), (scr(-0.6, -2.9), 1.1, 0.9, 0.95, 0.1)]
for k, (p, w, d, h, turn) in enumerate(houses):
    grow(look.house(f'house_{k}', p.x, p.y, FACE + turn, w, d, h), G, 1.5)
stall = scr(-1.0, 1.9)
grow(look.market_stall(stall.x, stall.y, FACE), 1.3, 1.0)
for k, (u, v) in enumerate(((-0.1, 2.3), (0.05, 1.95))):
    grow(look.barrel(f'barrel_{k}', *scr(u, v)))

# 흙길: 광장에서 집마다, 다리 건너 양 우리로, 호숫가 모닥불로, 언덕 풍차로
P = lambda *uv: [tuple(scr(u, v)) for u, v in uv]
look.path('path_0', P((-1.6, 0.2), (-0.4, 0.5), (0.65, 0.9), (2.0, 1.2), (3.6, 1.6)))
look.path('path_1', P((-1.6, 0.2), (-3.0, 0.0), (-4.4, -0.6)))
look.path('path_2', P((-1.6, 0.2), (-2.4, -1.5), (-3.2, -2.6)))
look.path('path_3', P((-1.6, 0.2), (-1.0, -1.6), (-0.6, -2.6)))
look.path('path_4', P((-1.0, -1.6), (0.2, -3.6), (1.2, -5.2)))
look.path('path_5', P((-1.6, 0.2), (-2.4, 1.6), (-3.2, 2.6)))
look.path('path_6', P((0.65, 0.9), (1.6, 2.2), (2.4, 3.0)))
grow(look.signpost(*scr(-0.2, 0.15), FACE + 0.3))

# 다리: 강을 가로지르는 둥근 판자 다리
br = scr(0.65, 0.9)
tan = (scr(1.7, -1.2) - scr(0.6, 0.9)).normalized()
parts = [box(f'bridge_{k}', (0.16, 0.62, 0.05), ((k - 3) * 0.17, 0, 0.08 + 0.05 * math.cos((k - 3) / 3 * 1.2)), WOOD, bevel=0.012, seg=1)
         for k in range(7)]
for sy in (-0.3, 0.3):
    parts.append(box('bridge_rail', (1.2, 0.04, 0.04), (0, sy, 0.32), DARKWOOD, bevel=0.008))
    for sx in (-0.55, 0.0, 0.55):
        parts.append(box('bridge_post', (0.05, 0.05, 0.3), (sx, sy, 0.2), DARKWOOD, bevel=0.008))
o = bake(parts, 'bridge', origin=(0, 0, 0))
o.location = (br.x, br.y, TOP)
o.rotation_euler = (0, 0, math.atan2(tan.y, tan.x) + H)
grow(o, 1.2)

# ── 호숫가: 선착장 끝 낚시꾼, 나룻배, 물가 낚시 오두막, 모닥불 ─────
jb = at(LAKE, LROT, -0.6, -(LAKE_R[1] + 0.55))
ja = math.atan2(LAKE.y - jb.y, LAKE.x - jb.x)
fwd = Vector((math.cos(ja), math.sin(ja)))
grow(look.jetty(jb.x, jb.y, ja, n=7))
deck = TOP + 0.1 * G
fisher = grow(look.villager('man_fish', *(jb + fwd * 0.85 * G), ja, look.CLOTH_R, hat=True, pose='sit'))
fisher.location.z = deck - 0.2 * G
rod = jb + fwd * 1.2 * G
cyl('fish_rod', 0.01, 0.007, 1.1, (rod.x, rod.y, deck + 0.45), DARKWOOD, seg=5, rot=(0, 0.9, ja))
boat = at(LAKE, LROT, 0.7, 0.3)
grow(look.rowboat('boat', boat.x, boat.y, TOP - 0.02, LROT + 0.5), 1.2)
hut = at(LAKE, LROT, LAKE_R[0] + 0.15, 0.35)
grow(look.stilt_hut(hut.x, hut.y, LROT + H), 1.3)
camp = scr(1.0, -5.4)
grow(look.campfire(camp.x, camp.y), G, 0.55)
b0, b1 = at(camp, FACE, -0.8, 0.1), at(camp, FACE, 0.1, 0.85)
grow(look.bench('bench_0', b0.x, b0.y, FACE - 1.4))
grow(look.bench('bench_1', b1.x, b1.y, FACE + 3.0))
grow(look.villager('man_bench0', *at(b0, FACE - 1.4, 0, 0.04), FACE - 1.4 - H, look.CLOTH_B, pose='sit'))
grow(look.villager('man_bench1', *at(b1, FACE + 3.0, 0, 0.04), FACE + 3.0 - H, CLOTH_W, hat=True, pose='sit'))

# ── 양 우리, 밭 ────────────────────────────────────
pen = scr(4.6, 1.7)
c, s = RIGHT, -CAM
corner = lambda a, b: tuple(pen + c * a + s * b)
look.fence_line('pen', [corner(-1.1, -0.8), corner(1.1, -0.8), corner(1.1, 0.8), corner(-1.1, 0.8), corner(-1.1, -0.8)], gate=3)
block(pen.x, pen.y, 1.3)
for k, (a, b) in enumerate(((-0.5, -0.2), (0.2, 0.3), (0.6, -0.3), (-0.2, 0.4), (0.7, 0.4), (-1.6, -0.6))):
    p = pen + c * a + s * b
    grow(sheep(f'sheep_{k}', p.x, p.y, rnd.random() * math.tau), 1.5)
for k, (a, b) in enumerate(((-1.6, 0.6), (-1.9, 0.2))):
    p = pen + c * a + s * b
    grow(look.haystack(f'hay_{k}', p.x, p.y))
field = scr(-5.6, -2.6)
grow(look.crop_field('field', field.x, field.y, FACE + 0.2), 1.2)
block(field.x, field.y, 1.6)

# 섬 끝 전망대(앞 왼쪽 가장자리, 바깥을 본다)
e, a = rim_at(-1.2, -1.0, 0.93)
grow(look.lookout(e.x, e.y, a), 1.25)

# ── 마을 사람들 ────────────────────────────────────
grow(look.villager('man_vendor', *at(stall, FACE, 0.0, 0.42 * 1.3), FACE - H, look.CLOTH_G, hat=True))
grow(look.villager('man_buyer', *at(stall, FACE, 0.15, -0.85 * 1.3), FACE + H, look.CLOTH_R))
grow(look.villager('man_buyer2', *at(stall, FACE, -0.45, -0.95 * 1.3), FACE + H - 0.4, CLOTH_W))
grow(look.villager('man_well', *at(plaza, FACE, 0.5, -0.3), FACE + 2.6, look.CLOTH_R))
grow(look.villager('man_wave', *scr(-0.5, -0.6), FACE - H, look.CLOTH_B, pose='wave'))
grow(look.villager('man_bridge', br.x, br.y, FACE - H, look.CLOTH_G)).location.z = TOP + 0.1
grow(look.villager('man_shep', *(pen + c * -1.4 + s * -1.1), 0.4, look.CLOTH_G, hat=True))
grow(look.villager('man_field', *at(field, FACE, 0.0, -0.9), FACE - H, look.CLOTH_B, hat=True))
grow(look.villager('man_hut', *at(hut, LROT + H, -0.5, -0.1), LROT, CLOTH_W))
grow(look.villager('man_look', *at(e, a, 0.85, 0.15), a, CLOTH_W), 1.25).location.z = surface(e.x, e.y) + 0.05

# 길가 등불(밤에 점점이 켜진다)
for k, (u, v) in enumerate(((-0.9, 0.7), (-2.6, -0.4), (-1.8, -1.2), (-0.5, -1.2), (0.2, 0.4), (1.3, 1.3), (2.8, 1.6),
                            (0.6, -3.9), (-3.4, 1.3), (1.6, 2.6), (-3.6, -0.3))):
    grow(look.lantern(f'lantern_{k}', *scr(u, v)))

# ── 숲: 가장자리를 두르고, 안쪽엔 몇 그루만 ────────────────
kinds = ['cloud:orange', 'pine', 'oval:red', 'cloud:orange', 'oval:rust', 'pine', 'cloud:red', 'oval:orange', 'pine', 'cloud:yellow']
trees = 0
for i in range(8000):
    if trees >= 52:
        break
    x, y = pick(0.3, 0.95) if trees < 10 else pick(0.6, 0.95)
    h = (0.9 + rnd.random() * 0.55) * G
    # 앞쪽 가장자리(카메라 쪽)는 대부분 비워 섬 위가 가리지 않게
    if (x * CAM.x + y * CAM.y) / R > 0.55 and rnd.random() < 0.85:
        continue
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
for i in range(30):
    for _ in range(80):
        x, y = pick(0.3, 0.95)
        s_ = (0.12 + rnd.random() * 0.08) * 1.3
        if free(x, y, s_):
            bush(f'bush_{i}', x, y, s_)
            block(x, y, s_)
            break
for i in range(18):
    for _ in range(80):
        x, y = pick(0.86, 0.96)
        s_ = 0.18 + rnd.random() * 0.22
        if free(x, y, s_ * 0.8):
            look.boulder(f'rock_{i}', x, y, s_)
            break
flowers(260)

setup_render((12.8 * 1.4, -14.4 * 1.4, 8.6 * 1.4), (0, 0, -1.5))

# 앱과 맞출 자리(Blender (x, y) = 앱 (x, -z))
print('RIVER', [(round(p.x, 3), round(p.y, 3)) for p in river_points()], flush=True)
print('LAKE', round(LAKE.x, 3), round(LAKE.y, 3), LAKE_R, round(LROT, 4), flush=True)
for n in ('house_0', 'house_1', 'house_2', 'house_3', 'campfire', 'stilt_hut'):
    o = bpy.data.objects.get(n)
    print('POS', n, round(o.location.x, 2), round(o.location.y, 2), flush=True)

if MODE == 'glb':
    out = os.path.abspath(OUT)
    export_glb(os.path.join(out, 'island.glb'), lightmap=os.path.join(out, 'island_light.png'), samples=SAMPLES)
if MODE == 'preview':
    scene.render.filepath = os.path.join(OUT, 'preview.png')
    bpy.ops.render.render(write_still=True)
    print('done', flush=True)
