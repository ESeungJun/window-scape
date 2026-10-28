# 숲 테마: 숲속 호숫가 통나무집 디오라마. 앱: public/models/forest.glb + forest_light.png(라이트맵)
#   blender -b -P tools/blender/forest.py -- public/models glb 384
#   ffmpeg -i public/models/forest_light.png -c:v libwebp -quality 90 public/models/forest_light.webp  (png 는 지운다)
# 네모난 땅 조각: 뒤쪽 바위 언덕과 빽빽한 전나무 숲, 언덕 밑 샘에서 시작한 개울이 앞쪽 호수로 흘러 가장자리에서 폭포로 떨어진다.
# 호숫가 통나무집(돌 굴뚝·현관), 선착장과 카누, 모닥불과 텐트, 장작더미.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: F401,F403
import lib
import look
import tile
from tile import smooth, poly_dist, three

W = D = 16.0
G = 1.35
FACE = math.atan2(CAM.x, -CAM.y)
H = math.pi / 2

LAKE, LRX, LRY = Vector((4.3, -2.9)), 3.0, 2.3
LEVEL = TOP - 0.08
STREAM = [Vector(p) for p in ((-4.6, 3.4), (-3.0, 2.2), (-1.2, 1.7), (0.4, 0.9), (1.6, -0.6), (2.6, -1.8))]
OUTLET = [Vector(p) for p in ((7.0, -2.6), (8.3, -2.5))]
HILL = Vector((-6.6, 6.4))


def lake_q(x, y):
    a = math.atan2(y - LAKE.y, x - LAKE.x)
    wob = 1 + 0.07 * math.sin(3 * a + 1) + 0.05 * math.sin(5 * a)
    return math.hypot((x - LAKE.x) / LRX, (y - LAKE.y) / LRY) / wob


def height(x, y):
    h = TOP
    # 뒤쪽 바위 언덕
    d = (Vector((x, y)) - HILL).length
    h += 2.6 * smooth(6.5, 1.0, d) + 0.25 * math.sin(x * 1.3) * math.cos(y * 1.1) * smooth(6.5, 3.0, d)
    # 잔물결 같은 땅 기복
    h += 0.06 * math.sin(x * 0.9 + 1) * math.sin(y * 0.8)
    # 호수와 물길
    q = min(lake_q(x, y), 1.0 + poly_dist((x, y), OUTLET) / 0.6)
    if q < 1.18:
        h = min(h, TOP - 0.62 * smooth(1.18, 0.55, q))
    # 개울 바닥
    sd = poly_dist((x, y), STREAM)
    h -= 0.2 * smooth(0.55, 0.15, sd) * smooth(5.5, 3.0, d)
    return h


lib.surface = height
look.surface = height

FOREST_FLOOR = mat('grass_dark', '#6f8a48', 0.95, 0.08, 4.0)


def paint(x, y, z):
    if z < LEVEL + 0.06 and lake_q(x, y) < 1.5:
        return SAND
    if z > TOP + 1.1:
        return ROCK if (Vector((x, y)) - HILL).length < 2.4 else FOREST_FLOOR
    q = lake_q(x, y)
    if q < 1.35 or poly_dist((x, y), STREAM) < 0.5:
        return SAND
    if x - y < -4.5:
        return FOREST_FLOOR
    return GRASS


tile.build(W, D, height, paint, water=LEVEL)
tile.liquid_plane('liquid_lake', W, D, height, LEVEL)
pts = catmull(STREAM, 10)
tile.liquid_ribbon('liquid_stream', pts, 0.5, lambda p, i: height(p.x, p.y) + 0.14 if i < 3 else LEVEL + 0.004)
for p in pts:
    block(p.x, p.y, 0.5)
for x in range(-4, 9):
    block(LAKE.x + x * 0.4, LAKE.y, 0)
block(LAKE.x, LAKE.y, max(LRX, LRY) + 0.3)
block(7.6, -2.6, 0.8)

# ── 통나무집 ─────────────────────────────────────────
LOG = mat('log', '#a06c45', 0.85, 0.12, 10.0)
LOG_END = mat('log_end', '#d2a679', 0.85, 0.08, 10.0)
SHINGLE = banded('roof_slate', ['#5f6b74', '#6b7882', '#56616a'], 14.0, 0.3, 0.3, 0.8)


def cabin(x, y, rot):
    """통나무집: 돌 기단, 모서리가 엇갈려 튀어나온 통나무 벽, 통나무 박공, 슬레이트 지붕, 돌 굴뚝, 현관 마루"""
    P = []
    w, d, h = 2.1, 1.7, 1.05
    r = 0.07
    P.append(box('cab_base', (w + 0.12, d + 0.12, 0.16), (0, 0, 0.08), STONE, bevel=0.03))
    look.stone_band(P, 'cab', w + 0.12, d + 0.12, 0.0, 1, 0.16)
    n = round((h - 0.16) / (2 * r * 0.92))
    for k in range(n):
        z = 0.16 + r + k * 2 * r * 0.92
        for s in (-1, 1):
            P.append(cyl('cab_logx', r, r, w + 0.34, (0, s * d / 2, z), LOG, seg=8, rot=(0, H, 0), bevel=0.01))
            P.append(cyl('cab_logy', r, r, d + 0.34, (s * w / 2, 0, z + r * 0.92), LOG, seg=8, rot=(H, 0, 0), bevel=0.01))
            for e in (-1, 1):
                P.append(cyl('cab_end', r * 0.8, r * 0.8, 0.02, (e * (w / 2 + 0.17), s * d / 2, z), LOG_END, seg=8, rot=(0, H, 0)))
    top = 0.16 + n * 2 * r * 0.92
    P.append(box('cab_core', (w - 0.04, d - 0.04, top), (0, 0, top / 2), LOG, bevel=0.0))
    pitch = math.radians(42)
    rise = look.tile_roof(P, 'cab', w + 0.15, d + 0.1, top, pitch, SHINGLE)
    # 박공: 짧아지는 통나무
    for s in (-1, 1):
        k = 0
        while True:
            z = top + r + k * 2 * r * 0.95
            L = (w + 0.15) * (1 - (z - top) / rise)
            if L < 0.25:
                break
            P.append(cyl('cab_gable', r, r, L, (0, s * d / 2, z), LOG, seg=8, rot=(0, H, 0), bevel=0.01))
            k += 1
    # 돌 굴뚝(오른쪽 옆벽 바깥)
    cx = w / 2 + 0.2
    for k in range(int((top + rise + 0.4) / 0.13)):
        P.append(box('cab_chim', (0.36 - (k % 2) * 0.03, 0.4 + (k % 2) * 0.03, 0.13), (cx, 0.15, 0.065 + k * 0.13), STONE,
                     rot=(0, 0, (k % 3 - 1) * 0.05), bevel=0.025))
    P.append(box('cab_chimcap', (0.42, 0.46, 0.06), (cx, 0.15, top + rise + 0.46), STONE, bevel=0.02))
    # 문, 창
    P.append(box('cab_door', (0.36, 0.05, 0.62), (-0.35, -d / 2 - r - 0.01, 0.16 + 0.31), DARKWOOD, bevel=0.012))
    P.append(box('cab_knob', (0.04, 0.03, 0.04), (-0.23, -d / 2 - r - 0.04, 0.47), STONE, bevel=0.01))

    def window(cx, cy, cz, ry):
        c, s = math.cos(ry), math.sin(ry)
        off = lambda dx, dy, dz=0: (cx + dx * c - dy * s, cy + dx * s + dy * c, cz + dz)
        P.append(box('cab_glass', (0.3, 0.03, 0.26), off(0, 0), GLASS, rot=(0, 0, ry), bevel=0.005))
        P.append(box('cab_frame', (0.38, 0.04, 0.34), off(0, 0.012), DARKWOOD, rot=(0, 0, ry), bevel=0.01))
        P.append(box('cab_mull', (0.025, 0.045, 0.28), off(0, -0.006), DARKWOOD, rot=(0, 0, ry), bevel=0))
        P.append(box('cab_mull', (0.32, 0.045, 0.025), off(0, -0.006), DARKWOOD, rot=(0, 0, ry), bevel=0))
        for sx in (-1, 1):
            P.append(box('cab_shut', (0.14, 0.03, 0.34), off(sx * 0.27, -0.01), WOOD, rot=(0, 0, ry), bevel=0.008))
    window(0.4, -d / 2 - r - 0.02, 0.62, 0)
    window(0, -d / 2 - r - 0.02, top + rise * 0.38, 0)
    window(-w / 2 - r - 0.02, 0, 0.6, -H)
    window(-0.3, d / 2 + r + 0.02, 0.6, math.pi)
    # 현관 마루와 지붕
    pd = 0.75
    for k in range(9):
        P.append(box('cab_porch', (w * 0.9 / 9 - 0.015, pd, 0.04), (-w * 0.45 + (k + 0.5) * w * 0.9 / 9, -d / 2 - pd / 2 - 0.05, 0.2), WOOD,
                     bevel=0.01, seg=1))
    for sx in (-1, 1):
        P.append(cyl('cab_post', 0.04, 0.04, 0.72, (sx * w * 0.42, -d / 2 - pd + 0.02, 0.56), LOG, seg=8))
        P.append(box('cab_rail', (0.04, pd - 0.05, 0.04), (sx * w * 0.42, -d / 2 - pd / 2 - 0.05, 0.48), LOG, bevel=0.01))
    P.append(box('cab_proof', (w * 0.98, pd + 0.2, 0.05), (0, -d / 2 - pd / 2 - 0.08, 0.95), SHINGLE, rot=(-0.3, 0, 0), bevel=0.012))
    for k in range(2):
        P.append(box('cab_step', (0.5, 0.18, 0.06), (0.4, -d / 2 - pd - 0.12 - k * 0.16, 0.14 - k * 0.07), STONE, bevel=0.02))
    P.append(box('cab_chair', (0.24, 0.24, 0.04), (0.55, -d / 2 - 0.35, 0.42), WOOD, bevel=0.01))
    P.append(box('cab_chairb', (0.24, 0.04, 0.26), (0.55, -d / 2 - 0.23, 0.55), WOOD, rot=(-0.2, 0, 0), bevel=0.01))
    o = bake(P, 'cabin', origin=(0, 0, 0))
    o.location = (x, y, height(x, y) - 0.04)
    o.rotation_euler = (0, 0, rot)
    block(x, y, 3.0)
    return o


CAB = Vector((-2.4, -2.2))
CROT = FACE - 0.25
grow = lambda o, s=G: (setattr(o, 'scale', (s, s, s)), o)[1]
grow(cabin(CAB.x, CAB.y, CROT), 1.25)


def at(c, rot, lx, ly):
    return Vector((c.x + lx * math.cos(rot) - ly * math.sin(rot), c.y + lx * math.sin(rot) + ly * math.cos(rot)))


# 장작더미(집 오른쪽), 도끼 꽂힌 그루터기
wp = at(CAB, CROT, 2.2, 0.4)
P = []
for row in range(3):
    for k in range(7 - row):
        P.append(cyl('wood_log', 0.07, 0.07, 0.6, (0, (k - (6 - row) / 2) * 0.145, 0.07 + row * 0.125), LOG, seg=8, rot=(0, H, 0), bevel=0.01))
        P.append(cyl('wood_end', 0.058, 0.058, 0.62, (0, (k - (6 - row) / 2) * 0.145, 0.07 + row * 0.125), LOG_END, seg=8, rot=(0, H, 0)))
o = bake(P, 'woodpile', origin=(0, 0, 0))
look.place(o, wp.x, wp.y, CROT, 0.7)
grow(o, 1.25)
st = at(CAB, CROT, 2.4, -0.9)
P = [cyl('stump', 0.2, 0.23, 0.28, (0, 0, 0.12), LOG, seg=12, bevel=0.03), cyl('stump_top', 0.18, 0.18, 0.02, (0, 0, 0.27), LOG_END, seg=12),
     box('axe_h', (0.03, 0.03, 0.4), (0.05, 0, 0.42), WOOD, rot=(0, 0.35, 0), bevel=0.008),
     box('axe_b', (0.14, 0.02, 0.09), (0.0, 0, 0.3), STONE, rot=(0, 0.35, 0), bevel=0.01)]
look.place(bake(P, 'stump', origin=(0, 0, 0)), st.x, st.y, 0.3, 0.35)

# ── 선착장과 카누 ────────────────────────────────────
jb = Vector((1.55, -3.4))
ja = math.atan2(LAKE.y - jb.y, LAKE.x - jb.x)
grow(look.jetty(jb.x, jb.y, ja, n=9), 1.35).location.z = LEVEL + 0.02
CANOE = mat('canoe', '#c45a3b', 0.6, 0.05)
P = [blob('canoe_hull', 0.32, (0, 0, 0.05), CANOE, scale=(2.4, 0.5, 0.36), sub=3),
     blob('canoe_in', 0.3, (0, 0, 0.1), DARKWOOD, scale=(2.35, 0.42, 0.2), sub=3)]
for sx in (-0.35, 0.35):
    P.append(box('canoe_seat', (0.08, 0.28, 0.025), (sx, 0, 0.11), WOOD, bevel=0.006))
P.append(box('paddle', (0.9, 0.04, 0.02), (0.1, 0.05, 0.15), WOOD, rot=(0, 0, 0.25), bevel=0.006))
canoe = bake(P, 'canoe', origin=(0, 0, 0))
cp = jb + Vector((math.cos(ja), math.sin(ja))) * 0.9 + Vector((-math.sin(ja), math.cos(ja))) * 0.62
canoe.location = (cp.x, cp.y, LEVEL - 0.02)
canoe.rotation_euler = (0, 0, ja + 0.12)
grow(canoe, 1.3)
lantern_dock = jb + Vector((math.cos(ja), math.sin(ja))) * 1.6 + Vector((-math.sin(ja), math.cos(ja))) * -0.32
o = look.lantern('lantern_dock', lantern_dock.x, lantern_dock.y)
o.location.z = LEVEL + 0.1
grow(o, 1.3)

# ── 모닥불, 텐트, 통나무 의자 ─────────────────────────
camp = Vector((-0.2, -5.4))
grow(look.campfire(camp.x, camp.y), G)
for k, a in enumerate((0.3, 2.2, 4.0)):
    p = camp + Vector((math.cos(a), math.sin(a))) * 0.95
    o = cyl(f'seat_log_{k}', 0.11, 0.11, 0.7, (p.x, p.y, height(p.x, p.y) + 0.1), LOG, seg=10, rot=(H, 0, a), bevel=0.02)
    block(p.x, p.y, 0.4)
TENT = mat('tent', '#d89a4a', 0.95, 0.04)
P = []
for s in (-1, 1):
    P.append(box('tent_side', (1.25, 0.03, 0.92), (0, s * 0.31, 0.37), TENT, rot=(s * 0.73, 0, 0), bevel=0.01))
P.append(cyl('tent_pole', 0.02, 0.02, 1.4, (0, 0, 0.68), DARKWOOD, seg=6, rot=(0, H, 0)))
bm = bmesh.new()
f = bm.faces.new([bm.verts.new(v) for v in ((0, -0.62, 0), (0, 0.62, 0), (0, 0, 0.68))])
bmesh.ops.solidify(bm, geom=[f], thickness=0.03)
back = new_obj('tent_back', bm)
back.location = (0.6, 0, 0)
P.append(finish(back, TENT, smooth=False))
tent = at(camp, FACE, -1.7, 1.0)
grow(look.place(bake(P, 'tent', origin=(0, 0, 0)), tent.x, tent.y, FACE + 1.9, 0.9), G)

# 개울 위 판자 다리, 흙길
br = Vector((0.4, 0.9))
tan = (STREAM[4] - STREAM[2]).normalized()
P = [box('fbridge', (0.14, 0.7, 0.05), ((k - 3) * 0.15, 0, 0.1 + 0.04 * math.cos((k - 3) / 3 * 1.2)), WOOD, bevel=0.012, seg=1) for k in range(7)]
o = bake(P, 'footbridge', origin=(0, 0, 0))
o.location = (br.x, br.y, TOP - 0.06)
o.rotation_euler = (0, 0, math.atan2(tan.y, tan.x) + H)
grow(o, 1.2)
door = at(CAB, CROT, 0.4 * 1.25, -2.0)
look.path('path_0', [tuple(door), tuple(at(CAB, CROT, 1.4, -2.6)), tuple(jb - Vector((math.cos(ja), math.sin(ja))) * 0.3)], width=0.36)
look.path('path_1', [tuple(door), tuple((door + camp) / 2 + Vector((0.3, 0))), tuple(camp + Vector((0.4, 0.5)))], width=0.32)
look.path('path_2', [tuple(at(CAB, CROT, 1.4, -2.6)), tuple(br - tan * 0.2 + Vector((-0.2, -0.6))), tuple(br)], width=0.3)
look.path('path_3', [tuple(br), (-1.2, 2.8), (-2.6, 4.4)], width=0.28)

# ── 샘의 바위, 언덕 바위, 쓰러진 통나무 ───────────────────
for k in range(8):
    a = k / 8 * math.tau
    p = STREAM[0] + Vector((math.cos(a), math.sin(a))) * (0.55 + rnd.random() * 0.2)
    look.boulder(f'spring_rock_{k}', p.x, p.y, 0.22 + rnd.random() * 0.2)
for k in range(14):
    a = rnd.random() * math.tau
    p = HILL + Vector((math.cos(a), math.sin(a))) * rnd.random() * 2.6
    if abs(p.x) < 7.6 and abs(p.y) < 7.6:
        look.boulder(f'hill_rock_{k}', p.x, p.y, 0.35 + rnd.random() * 0.45)
fl = Vector((-5.2, -1.4))
o = cyl('fallen_log', 0.16, 0.13, 2.0, (fl.x, fl.y, height(fl.x, fl.y) + 0.12), LOG, seg=10, rot=(H, 0, 0.7), bevel=0.02)
block(fl.x, fl.y, 1.0)

# ── 숲: 뒤쪽과 왼쪽은 빽빽한 전나무, 호숫가엔 단풍 몇 그루, 앞 모서리는 비운다 ──────
kinds = ['pine', 'pine', 'cloud:orange', 'pine', 'oval:red', 'pine', 'pine', 'cloud:rust', 'pine', 'oval:yellow']
trees = 0
for i in range(20000):
    if trees >= 95:
        break
    x, y = tile.pick(W, D, 0.35)
    front = x - y  # 클수록 카메라 쪽 모서리
    if front > 6.5 and rnd.random() < 0.92:
        continue
    if front > 1.5 and rnd.random() < 0.8:
        continue
    h = (0.95 + rnd.random() * 0.6) * G
    kind = kinds[trees % len(kinds)]
    if front < -3 and rnd.random() < 0.7:
        kind = 'pine'
    r = 0.38 * h if kind == 'pine' else 0.42 * h
    if not tile.free(x, y, r, W, D, 0.35) or height(x, y) < TOP - 0.05:
        continue
    if kind == 'pine':
        look.pine(f'tree_{trees}', x, y, h * (1.4 + rnd.random() * 0.5))
    elif kind.startswith('cloud'):
        look.cloud_tree(f'tree_{trees}', x, y, h, kind.split(':')[1])
    else:
        look.oval_tree(f'tree_{trees}', x, y, h * 1.15, kind.split(':')[1])
    block(x, y, r * 0.8)
    trees += 1
print('trees', trees, flush=True)
SHROOM = mat('shroom', '#c8553d', 0.6, 0.05)
for i in range(40):
    for _ in range(60):
        x, y = tile.pick(W, D, 0.4)
        s_ = 0.14 + rnd.random() * 0.1
        if tile.free(x, y, s_, W, D) and height(x, y) > TOP - 0.05:
            if i % 3 == 0:
                P = [cyl('shroom_stem', 0.025, 0.03, 0.1, (0, 0, 0.05), PLASTER, seg=8),
                     blob('shroom_cap', 0.06, (0, 0, 0.1), SHROOM, scale=(1, 1, 0.6), sub=2)]
                look.place(bake(P, f'shroom_{i}', origin=(0, 0, 0)), x, y, 0, 0.1)
            else:
                bush(f'bush_{i}', x, y, s_ * 1.3)
                block(x, y, s_)
            break
for i in range(12):
    for _ in range(60):
        x, y = tile.pick(W, D, 0.4)
        if tile.free(x, y, 0.3, W, D) and height(x, y) > TOP - 0.05:
            look.boulder(f'rock_{i}', x, y, 0.16 + rnd.random() * 0.2)
            break

setup_render((12.8 * 1.2, -14.4 * 1.2, 9.6 * 1.2), (0, 0, -0.6))

lights = [three(at(CAB, CROT, 0.4 * 1.25, -1.9), 1.1), three(camp, 0.6), three(lantern_dock, LEVEL + 1.1)]
layout = {
    'lights': lights,
    # 호수 물길이 가장자리(+x)로 떨어지는 폭포
    'falls': [{'origin': [W / 2 + 0.02, LEVEL, 2.55], 'outward': [1, 0, 0], 'width': 0.55, 'length': 11, 'reach': 0.9}],
    'smoke': three(Vector(at(CAB, CROT, (2.1 / 2 + 0.2) * 1.25, 0.15 * 1.25)), height(*CAB) + 2.5),
}

if MODE == 'glb':
    out = os.path.abspath(OUT)
    export_glb(os.path.join(out, 'forest.glb'), lightmap=os.path.join(out, 'forest_light.png'), samples=SAMPLES, layout=layout)
if MODE == 'preview':
    scene.render.filepath = os.path.join(OUT, 'preview.png')
    bpy.ops.render.render(write_still=True)
    print('done', flush=True)
