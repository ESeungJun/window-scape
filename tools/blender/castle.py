# 움직이는 성 테마: 네 다리로 초원을 걷는 성 디오라마. 앱: public/models/castle.glb + castle_light.png(라이트맵)
#   blender -b -P tools/blender/castle.py -- public/models glb 384
#   ffmpeg -i public/models/castle_light.png -c:v libwebp -quality 90 public/models/castle_light.webp  (png 는 지운다)
# 지평선까지 트인 초원(둘레는 밭 조각보·산울타리·나무숲·먼 언덕, far_*) 한가운데: 완만한 초원 언덕, 연못을 도는 농장 길, 가운데를 크게 도는 흙길(성이 걷는다), 연못과 갈대, 붉은 헛간과 곡물 창고, 양 우리, 밭, 오두막.
# 성은 특정 작품의 디자인을 옮기지 않은 독자 디자인: 구리 선체 위에 돌 탑과 반목조 오두막을 얹고, 프로펠러와 빨랫줄, 새 다리 넷.
# 성(mover_castle)과 다리·몸통은 앱이 움직인다(src/scene/castle.ts).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: F401,F403
import lib
import look
import tile
from tile import smooth, three

W = D = 16.0
H = math.pi / 2
FACE = math.atan2(CAM.x, -CAM.y)
POND, POND_R = Vector((0.9, -1.0)), 1.7
LEVEL = TOP + 0.05


def base(x, y):
    s = (x - y) / math.sqrt(2)  # 클수록 카메라 쪽
    return (TOP + 0.3 + 0.32 * math.sin(x * 0.55 + 0.6) * math.cos(y * 0.48 - 0.3) + 0.18 * math.sin(x * 1.1 + y * 0.7)
            + 1.5 * smooth(-3.0, -10.5, s))


def loop_points(n=120):
    pts = []
    for k in range(n):
        a = k / n * math.tau
        r = 4.9 + 0.55 * math.sin(2 * a + 0.8) + 0.3 * math.sin(3 * a + 2.0)
        c, s = math.cos(a), math.sin(a)
        e = 4
        k_ = (abs(c) ** e + abs(s) ** e) ** (-1 / e)
        pts.append(Vector((c * k_ * r, s * k_ * r)))
    return pts


LOOP = loop_points()
LOOPZ = [base(p.x, p.y) for p in LOOP]


def loop_near(x, y):
    p = Vector((x, y))
    i = min(range(len(LOOP)), key=lambda k: (LOOP[k] - p).length_squared)
    # 이웃 선분까지 거리로 다듬는다
    best = (LOOP[i] - p).length
    for j in (i - 1, (i + 1) % len(LOOP)):
        best = min(best, tile.seg_dist(p, LOOP[i], LOOP[j]))
    return best, LOOPZ[i]


def farm(x, y):
    """가운데 농장 땅(연못 둘레 길을 고르게 편 땅)"""
    h = base(x, y)
    d, z = loop_near(x, y)
    if d < 1.6:
        h = h + (z - 0.02 - h) * smooth(1.6, 0.8, d)
    pd = (Vector((x, y)) - POND).length
    if pd < POND_R + 0.6:
        h = min(h, LEVEL + 0.08 - 0.5 * smooth(POND_R + 0.6, POND_R - 0.6, pd))
    return h


def roam_points(n=240):
    """성이 걷는 넓은 길: 농장 둘레 밭 사이를 크게 돌고, 카메라 쪽(앞)에서는 연못 가까이까지 들어온다"""
    pts = []
    for k in range(n):
        a = k / n * math.tau
        dip = a - (-math.pi / 4) % math.tau
        dip = (dip + math.pi) % math.tau - math.pi
        r = 13.0 + 1.6 * math.sin(3 * a + 2.3) + 0.8 * math.sin(5 * a + 0.4) - 8.4 * math.exp(-dip * dip / 0.16)
        pts.append(Vector((math.cos(a) * r, math.sin(a) * r)))
    return pts


ROAM = roam_points()
ROAM_LINE = ROAM + [ROAM[0]]


def far_land(x, y):
    """먼 땅: 완만한 구릉, 더 멀리 둥근 언덕 능선"""
    r = math.hypot(x, y)
    a = math.atan2(y, x)
    ridge = 0.6 + 0.25 * math.sin(a * 2 + 0.7) + 0.15 * math.sin(a * 5 + 2.1)
    return (TOP + 0.3 + 0.7 * math.sin(x * 0.12 + 0.6) * math.cos(y * 0.1 - 0.3) * smooth(8, 20, r)
            + 1.5 * smooth(-3.0, -10.5, (x - y) / math.sqrt(2)) + 7 * ridge * smooth(30, 80, r))


def raw(x, y):
    t = smooth(0, 12, max(abs(x), abs(y)) - W / 2)
    return farm(x, y) * (1 - t) + far_land(x, y) * t


# 길 높이: 땅 높이를 길을 따라 고르게(성이 덜컹이지 않게)
_rz = [raw(p.x, p.y) for p in ROAM]
ROAMZ = [sum(_rz[(i + k) % len(ROAM)] for k in range(-6, 7)) / 13 for i in range(len(ROAM))]


def roam_near(x, y):
    p = Vector((x, y))
    i = min(range(len(ROAM)), key=lambda k: (ROAM[k] - p).length_squared)
    best = min(tile.seg_dist(p, ROAM[i], ROAM[j % len(ROAM)]) for j in (i - 1, i + 1))
    return best, ROAMZ[i]


def hfar(x, y):
    h = raw(x, y)
    if abs(x) < 17 and abs(y) < 17:
        d, z = roam_near(x, y)
        if d < 2.0:
            h = h + (z - 0.02 - h) * smooth(2.0, 1.0, d)
    return h


height = hfar
lib.surface = height
look.surface = height


def paint(x, y, z):
    if (Vector((x, y)) - POND).length < POND_R + 0.35:
        return SAND
    return GRASS


tile.build(W, D, height, paint, water=None, ground=True)


# 밭 조각보: 축에 맞춘 네모 밭(가장자리가 격자 선에 붙어 곧게 나온다)
FW, FD = 5.2, 4.6
WHEAT = mat('wheat', '#dcc372', 0.95, 0.1, 8.0)
PLOWED = mat('plowed', '#a07a55', 0.95, 0.1, 10.0)
FIELD_GREEN = mat('field_green', '#8fae58', 0.95, 0.08, 6.0)
FIELDS = [GRASS, GRASS, FIELD_GREEN, WHEAT, GRASS_DARK, PLOWED, GRASS, WHEAT]


def field_of(x, y):
    i, j = math.floor((x + 1.3) / FW), math.floor((y - 0.7) / FD)
    return FIELDS[int(tile.speckle(i * 1.7, j * 2.3) * len(FIELDS))]


def paint_far(x, y, z):
    d = max(abs(x), abs(y)) - W / 2
    if d < 2.5 or z > TOP + 5.0:
        return GRASS
    return field_of(x, y)


tile.surround('far_ground', W, D, 0.2, hfar, paint_far, keep=8.0)
tile.liquid_plane('liquid_pond', W, D, lambda x, y: height(x, y) if (Vector((x, y)) - POND).length < POND_R + 0.8 else 9.0, LEVEL, step=0.2)
block(POND.x, POND.y, POND_R + 0.4)

# 흙길(성이 걷는 길)
bm = bmesh.new()
L, R_ = [], []
for i, p in enumerate(LOOP):
    tan = (LOOP[(i + 1) % len(LOOP)] - LOOP[i - 1]).normalized()
    for side, out in ((0.55, L), (-0.55, R_)):
        q = p + Vector((-tan.y, tan.x)) * side * (0.9 + 0.2 * math.sin(i * 1.7))
        out.append(bm.verts.new((q.x, q.y, height(q.x, q.y) + 0.04)))
for i in range(len(LOOP)):
    j = (i + 1) % len(LOOP)
    bm.faces.new([L[i], R_[i], R_[j], L[j]])
finish(new_obj('loop_path', bm), PATH)
for p in LOOP[::2]:
    block(p.x, p.y, 1.1)

# 성이 걷는 넓은 흙길: 가운데 땅 안쪽은 굽고(roam_path), 바깥은 먼 풍경(far_roam)
inside = lambda p: abs(p.x) < 8.3 and abs(p.y) < 8.3
n = len(ROAM)
start_i = next(i for i in range(n) if not inside(ROAM[i]) and inside(ROAM[(i + 1) % n]))
order = [(start_i + k) % n for k in range(n + 1)]
runs, cur, cur_in = [], [order[0]], True
for i in order[1:]:
    cur.append(i)
    if inside(ROAM[i]) != cur_in:
        runs.append((cur_in, cur))
        cur, cur_in = [i], inside(ROAM[i])
runs.append((cur_in, cur))
for k, (is_in, idx) in enumerate(runs):
    bm = bmesh.new()
    L, R_ = [], []
    for i in idx:
        tan = (ROAM[(i + 1) % n] - ROAM[i - 1]).normalized()
        for side, out in ((0.75, L), (-0.75, R_)):
            q = ROAM[i] + Vector((-tan.y, tan.x)) * side * (0.9 + 0.15 * math.sin(i * 1.3))
            out.append(bm.verts.new((q.x, q.y, height(q.x, q.y) + 0.04)))
    for j in range(len(idx) - 1):
        bm.faces.new([L[j], R_[j], R_[j + 1], L[j + 1]])
    finish(new_obj(('roam_path_' if is_in else 'far_roam_') + str(k), bm), PATH)
for p in ROAM[::2]:
    if inside(p):
        block(p.x, p.y, 1.6)

# ── 연못: 갈대, 연잎, 오리, 둘레 돌 ──────────────────────
REED = mat('reed', '#7f9a50', 0.95, 0.06)
REED_TOP = mat('reed_top', '#8a5a3c', 0.9, 0.05)
LILY = mat('lily', '#6f9a4a', 0.8, 0.05)
DUCK = mat('duck', '#f4efe4', 0.8, 0.03)
BEAK = mat('beak', '#e09a3b', 0.7, 0.03)
P = []
for k in range(26):
    a = rnd.random() * math.tau
    r = POND_R * (0.95 + rnd.random() * 0.3)
    p = POND + Vector((math.cos(a), math.sin(a))) * r
    if (p - Vector((3.0, -3.0))).length < 1.5:
        continue
    for j in range(3):
        q = p + Vector(((rnd.random() - 0.5) * 0.18, (rnd.random() - 0.5) * 0.18))
        hh = 0.35 + rnd.random() * 0.3
        P.append(cyl('reed', 0.012, 0.006, hh, (q.x, q.y, LEVEL + hh / 2 - 0.05), REED, seg=4, rot=((rnd.random() - 0.5) * 0.3, (rnd.random() - 0.5) * 0.3, 0)))
        if j == 0:
            P.append(cyl('reed_top', 0.022, 0.022, 0.1, (q.x, q.y, LEVEL + hh - 0.02), REED_TOP, seg=6))
for k in range(7):
    a = rnd.random() * math.tau
    p = POND + Vector((math.cos(a), math.sin(a))) * POND_R * rnd.random() * 0.75
    P.append(cyl('lily', 0.13, 0.13, 0.012, (p.x, p.y, LEVEL + 0.008), LILY, seg=10))
bake(P, 'pond_plants')
for k, (dx, dy, rot) in enumerate(((0.3, 0.4, 0.5), (-0.4, -0.2, 2.6))):
    P = [blob('duck_body', 0.09, (0, 0, 0.05), DUCK, scale=(1.4, 1, 0.8), sub=2), blob('duck_head', 0.05, (0.1, 0, 0.13), DUCK, sub=2),
         cyl('duck_beak', 0.02, 0.005, 0.06, (0.16, 0, 0.13), BEAK, seg=6, rot=(0, H, 0))]
    o = bake(P, f'duck_{k}', origin=(0, 0, 0))
    o.location = (POND.x + dx, POND.y + dy, LEVEL)
    o.rotation_euler = (0, 0, rot)
    o.scale = (1.3, 1.3, 1.3)
for k in range(14):
    a = k / 14 * math.tau + rnd.random() * 0.3
    p = POND + Vector((math.cos(a), math.sin(a))) * (POND_R + 0.4)
    if rnd.random() < 0.6:
        blob(f'pond_stone_{k}', 0.1 + rnd.random() * 0.08, (p.x, p.y, height(p.x, p.y) + 0.02), STONE, scale=(1.3, 1, 0.6), sub=2,
             disp=0.03, disp_size=0.2)
look.jetty(POND.x + POND_R * 0.8, POND.y + POND_R * 0.75, -2.3, n=4).scale = (1.2, 1.2, 1.2)

# ── 농장: 붉은 헛간, 곡물 창고, 양 우리, 밭, 건초 ─────────────
BARN = mat('barn', '#b04a3a', 0.85, 0.08, 10.0)
BARN_TRIM = mat('barn_trim', '#f1ece0', 0.85, 0.03)
grow = lambda o, s=1.3: (setattr(o, 'scale', (s, s, s)), o)[1]
bp = Vector((-5.7, 5.3))
P = [box('barn_body', (1.8, 1.4, 1.05), (0, 0, 0.53), BARN, bevel=0.03)]
for k in range(13):
    P.append(box('barn_board', (0.03, 1.42, 1.0), (-0.84 + k * 0.14, 0, 0.53), BARN, bevel=0.005))
# 맞배 + 꺾인 지붕(위 완만, 아래 가파름)
for s in (-1, 1):
    P.append(box('barn_roof_lo', (0.62, 1.6, 0.06), (s * 0.68, 0, 1.25), ROOF_BLUE, rot=(0, s * 1.0, 0), bevel=0.015))
    P.append(box('barn_roof_hi', (0.58, 1.6, 0.06), (s * 0.27, 0, 1.58), ROOF_BLUE, rot=(0, s * 0.42, 0), bevel=0.015))
for s in (-1, 1):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in ((-0.9, 0, 0), (0.9, 0, 0), (0.48, 0, 0.5), (0, 0, 0.72), (-0.48, 0, 0.5))]
    bmesh.ops.solidify(bm, geom=[bm.faces.new(vs)], thickness=0.04)
    g = new_obj('barn_gable', bm)
    g.location = (0, s * 0.7, 1.05)
    P.append(finish(g, BARN, smooth=False))
P.append(box('barn_door', (0.7, 0.04, 0.72), (0, -0.72, 0.36), BARN, bevel=0.01))
for sx in (-1, 1):
    P.append(box('barn_x', (0.05, 0.03, 0.98), (0, -0.745, 0.36), BARN_TRIM, rot=(0, sx * 0.77, 0), bevel=0.005))
P.append(box('barn_frame', (0.78, 0.03, 0.8), (0, -0.735, 0.38), BARN_TRIM, bevel=0.01))
P.append(box('barn_loft', (0.3, 0.04, 0.3), (0, -0.72, 1.35), GLASS, bevel=0.01))
P.append(box('barn_loftf', (0.36, 0.03, 0.36), (0, -0.715, 1.35), BARN_TRIM, bevel=0.01))
barn = bake(P, 'barn', origin=(0, 0, 0))
look.place(barn, bp.x, bp.y, FACE, 1.6)
grow(barn, 1.35)
sp = bp + Vector((1.9, 1.3))
P = [cyl('silo', 0.42, 0.42, 1.9, (0, 0, 0.95), CLOTH_W, seg=20, bevel=0.02), blob('silo_top', 0.43, (0, 0, 1.9), ROOF_BLUE, scale=(1, 1, 0.6), sub=3)]
for z in (0.4, 0.9, 1.4):
    P.append(cyl('silo_band', 0.435, 0.435, 0.04, (0, 0, z), STONE, seg=20))
grow(look.place(bake(P, 'silo', origin=(0, 0, 0)), sp.x, sp.y, 0, 0.7), 1.3)
pen = Vector((-5.7, -5.5))
corner = lambda a, b: (pen.x + a, pen.y + b)
look.fence_line('pen', [corner(-1.2, -1.3), corner(1.2, -1.3), corner(1.2, 1.3), corner(-1.2, 1.3), corner(-1.2, -1.3)], gate=1)
block(pen.x, pen.y, 1.6)
for k, (a, b) in enumerate(((-0.5, -0.4), (0.3, 0.2), (0.6, -0.6), (-0.3, 0.7), (0.5, 0.8))):
    grow(sheep(f'sheep_{k}', pen.x + a, pen.y + b, rnd.random() * math.tau), 1.5)
for k, (dx, dy) in enumerate(((1.4, -1.0), (0.9, -1.6), (-1.4, -1.9))):
    grow(look.haystack(f'hay_{k}', bp.x + dx, bp.y + dy))
field = Vector((-1.4, 6.9))
grow(look.crop_field('field', field.x, field.y, 0.0, rows=4, cols=8), 1.2)
block(field.x, field.y, 2.0)
for k, (p, w, d, h, roof) in enumerate(((Vector((6.5, 4.2)), 1.15, 0.95, 1.0, TILE), (Vector((3.9, 6.6)), 1.1, 0.9, 0.95, ROOF_BROWN))):
    grow(look.house(f'house_{k}', p.x, p.y, FACE + 0.2 * (k - 0.5), w, d, h, roof), 1.3)
look.fence_line('fence_a', [(6.4, 0.6), (7.4, 1.8), (7.5, 4.0)])
look.fence_line('fence_b', [(-7.5, -2.6), (-6.6, -3.4)])
look.signpost(1.4, 6.3, FACE + 0.4).scale = (1.3, 1.3, 1.3)

# ── 걷는 성 ──────────────────────────────────────────
COPPER = mat('copper', '#b8794c', 0.45, 0.06, 6.0)
IRON = mat('iron', '#4a4d55', 0.5, 0.05, 6.0)
BRASS = mat('brass', '#c9a24e', 0.4, 0.04)
CSTONE = mat('castle_stone', '#cfc3ae', 0.9, 0.08, 6.0)
HIP = 1.25  # 엉덩이 관절 높이(땅에서)
BODY = 1.42


def castle_body():
    """몸통(앞 = +x, 기준점 = 땅 가운데): 구리 선체, 돌 탑, 반목조 오두막, 작은 탑, 굴뚝, 발코니, 빨랫줄"""
    P = []
    z0 = BODY
    P.append(cyl('c_hull', 1.0, 0.82, 0.55, (0, 0, z0 + 0.27), COPPER, seg=24, bevel=0.05))
    P.append(cyl('c_keel', 0.78, 0.45, 0.25, (0, 0, z0 - 0.1), IRON, seg=24, bevel=0.04))
    P.append(cyl('c_band', 1.02, 1.02, 0.07, (0, 0, z0 + 0.45), IRON, seg=24))
    for k in range(24):
        a = k / 24 * math.tau
        P.append(blob('c_rivet', 0.025, (math.cos(a) * 1.02, math.sin(a) * 1.02, z0 + 0.45), BRASS, sub=1))
    # 앞 둥근 눈창, 옆 동그란 창
    P.append(cyl('c_eye', 0.2, 0.2, 0.05, (0.9, 0, z0 + 0.25), GLASS, seg=20, rot=(0, H, 0)))
    P.append(cyl('c_eyering', 0.25, 0.25, 0.04, (0.88, 0, z0 + 0.25), BRASS, seg=20, rot=(0, H, 0)))
    for a in (1.2, 2.2, -1.2, -2.2):
        c, s = math.cos(a), math.sin(a)
        P.append(cyl('c_port', 0.09, 0.09, 0.04, (c * 0.92, s * 0.92, z0 + 0.25), GLASS, seg=14, rot=(H, 0, a + H)))
        P.append(cyl('c_portr', 0.12, 0.12, 0.03, (c * 0.9, s * 0.9, z0 + 0.25), BRASS, seg=14, rot=(H, 0, a + H)))
    top = z0 + 0.55
    # 돌 탑(뒤 왼쪽)
    tx, ty = -0.3, 0.25
    P.append(cyl('c_tower', 0.5, 0.55, 1.7, (tx, ty, top + 0.85), CSTONE, seg=16, bevel=0.03))
    for k in range(5):
        P.append(cyl('c_tband', 0.56 - k * 0.006, 0.56 - k * 0.006, 0.05, (tx, ty, top + 0.15 + k * 0.38), STONE, seg=16))
    for k in range(10):
        a = k / 10 * math.tau
        P.append(box('c_merlon', (0.16, 0.12, 0.16), (tx + math.cos(a) * 0.5, ty + math.sin(a) * 0.5, top + 1.78), CSTONE, rot=(0, 0, a),
                     bevel=0.02))
    P.append(cyl('c_tcap', 0.55, 0.55, 0.06, (tx, ty, top + 1.7), STONE, seg=16))
    for a, z in ((0.2, top + 0.6), (-0.5, top + 1.2), (1.6, top + 0.9)):
        c, s = math.cos(a), math.sin(a)
        P.append(box('c_twin', (0.04, 0.14, 0.22), (tx + c * 0.52, ty + s * 0.52, z), GLASS, rot=(0, 0, a), bevel=0.01))
        P.append(box('c_twinf', (0.035, 0.19, 0.27), (tx + c * 0.51, ty + s * 0.51, z), DARKWOOD, rot=(0, 0, a), bevel=0.01))
    # 탑 꼭대기 돛대 + 프로펠러(따로 된 부품, 앱이 돌린다)
    P.append(cyl('c_mast', 0.025, 0.02, 0.9, (tx, ty, top + 2.2), IRON, seg=6))
    # 반목조 오두막(앞 오른쪽)
    cx, cy = 0.3, -0.25
    w, d, h = 1.0, 0.95, 0.72
    P.append(box('c_cot', (w, d, h), (cx, cy, top + h / 2), PLASTER, bevel=0.02))
    for k in range(5):
        P.append(box('c_beam', (0.05, d + 0.02, h), (cx - w / 2 + 0.02 + k * (w - 0.04) / 4, cy, top + h / 2), DARKWOOD, bevel=0.005))
    P.append(box('c_beamh', (w + 0.02, d + 0.02, 0.05), (cx, cy, top + h * 0.5), DARKWOOD, bevel=0.005))
    for sx in (-1, 1):
        P.append(box('c_cwin', (0.04, 0.18, 0.2), (cx + sx * (w / 2 + 0.01), cy + 0.15, top + h * 0.72), GLASS, bevel=0.008))
        P.append(box('c_cwin', (0.2, 0.04, 0.2), (cx + 0.2 * sx, cy - d / 2 - 0.01, top + h * 0.72), GLASS, bevel=0.008))
    Q = []
    look.tile_roof(Q, 'c_cot', w, d, top + h, math.radians(42), TILE)
    for q in Q:
        q.location.x += cx
        q.location.y += cy
    P += Q
    for s in (-1, 1):
        bm = bmesh.new()
        vs = [bm.verts.new(v) for v in ((-w / 2, 0, 0), (w / 2, 0, 0), (0, 0, (w / 2) * math.tan(math.radians(42))))]
        bmesh.ops.solidify(bm, geom=[bm.faces.new(vs)], thickness=0.04)
        g = new_obj('c_gable', bm)
        g.location = (cx, cy + s * d / 2, top + h)
        P.append(finish(g, PLASTER, smooth=False))
    # 작은 탑(오두막 앞 모서리) + 깃발
    sx_, sy_ = cx + 0.55, cy - 0.45
    P.append(cyl('c_turret', 0.2, 0.22, 1.05, (sx_, sy_, top + 0.52), CSTONE, seg=12, bevel=0.02))
    P.append(cyl('c_turroof', 0.3, 0.02, 0.6, (sx_, sy_, top + 1.35), ROOF_BLUE, seg=12, bevel=0.02))
    P.append(box('c_turwin', (0.04, 0.1, 0.16), (sx_ + 0.21, sy_, top + 0.75), GLASS, bevel=0.008))
    P.append(cyl('c_flagpole', 0.01, 0.01, 0.4, (sx_, sy_, top + 1.8), IRON, seg=4))
    P.append(box('c_flag', (0.26, 0.01, 0.14), (sx_ - 0.13, sy_, top + 1.92), CLOTH_R, bevel=0.0))
    # 굴뚝(오두막 뒤, 벽돌) — 연기는 앱이 그린다
    for k in range(6):
        P.append(box('c_chim', (0.2, 0.2, 0.13), (cx + 0.15, cy + 0.25, top + h + 0.3 + k * 0.13), ROOF_RED, rot=(0, 0, (k % 2) * 0.1), bevel=0.02))
    P.append(cyl('c_chimpot', 0.06, 0.07, 0.15, (cx + 0.15, cy + 0.25, top + h + 1.1), IRON, seg=8))
    # 발코니(탑 앞)와 화분
    P.append(cyl('c_balc', 0.38, 0.38, 0.05, (tx + 0.5, ty + 0.3, top + 0.95), WOOD, seg=12))
    for k in range(9):
        a = -H + k / 8 * math.pi
        P.append(box('c_brail', (0.02, 0.02, 0.18), (tx + 0.5 + math.cos(a) * 0.36, ty + 0.3 + math.sin(a) * 0.36, top + 1.05), DARKWOOD))
    P.append(cyl('c_pot', 0.06, 0.05, 0.08, (tx + 0.7, ty + 0.3, top + 1.02), ROOF_RED, seg=8))
    P.append(blob('c_plant', 0.08, (tx + 0.7, ty + 0.3, top + 1.1), look.CROP, sub=2))
    # 빨랫줄(탑과 작은 탑 사이)
    a3, b3 = Vector((tx + 0.4, ty - 0.3, top + 1.5)), Vector((sx_, sy_, top + 1.0))
    mid = (a3 + b3) / 2
    ln = cyl('c_line', 0.006, 0.006, (b3 - a3).length, tuple(mid), DARKWOOD, seg=4)
    ln.rotation_euler = (b3 - a3).to_track_quat('Z', 'Y').to_euler()
    P.append(ln)
    for k, cl in enumerate((CLOTH_W, look.CLOTH_B, CLOTH_R, TILE)):
        q = a3.lerp(b3, 0.2 + k * 0.2)
        P.append(box('c_cloth', (0.1, 0.02, 0.14), (q.x, q.y, q.z - 0.08), cl, rot=(0, 0, math.atan2(b3.y - a3.y, b3.x - a3.x)), bevel=0.0))
    # 구리 관(선체를 감싼다)
    for k in range(3):
        a = 2.6 + k * 0.35
        P.append(cyl('c_pipe', 0.04, 0.04, 0.9, (math.cos(a) * 0.95, math.sin(a) * 0.95, top + 0.35), BRASS, seg=8))
    P.append(cyl('c_lamp', 0.07, 0.07, 0.12, (1.0, 0.0, z0 + 0.6), GLASS, seg=8))
    # 다리 받침(엉덩이 관절)
    for hx, hy in HIPS:
        P.append(blob('c_hipball', 0.16, (hx, hy, HIP), IRON, sub=2))
        P.append(cyl('c_hipmount', 0.12, 0.16, 0.25, (hx, hy, HIP + 0.15), COPPER, seg=10))
    return bake(P, 'castle_body', origin=(0, 0, 0))


HIPS = [(0.5, 0.55), (0.5, -0.55), (-0.5, 0.55), (-0.5, -0.55)]


def leg(k, hx, hy):
    """새 다리: 위 다리(엉덩이 기준) → 아래 다리(무릎 기준) → 세 발가락"""
    knee = HIP * 0.52
    up = [cyl(f'leg{k}_thigh', 0.1, 0.075, HIP - knee, (0, 0, -(HIP - knee) / 2), COPPER, seg=10, bevel=0.02),
          cyl(f'leg{k}_piston', 0.03, 0.03, (HIP - knee) * 0.8, (0.12, 0, -(HIP - knee) / 2), BRASS, seg=6)]
    upper = bake(up, f'leg_{k}_upper', origin=(0, 0, 0))
    lo = [blob(f'leg{k}_knee', 0.1, (0, 0, 0), IRON, sub=2),
          cyl(f'leg{k}_shin', 0.065, 0.05, knee, (0, 0, -knee / 2), IRON, seg=10, bevel=0.015)]
    for j, a in enumerate((-0.6, 0.0, 0.6)):
        lo.append(box(f'leg{k}_toe', (0.24, 0.05, 0.04), (math.cos(a) * 0.1, math.sin(a) * 0.1, -knee + 0.02), IRON, rot=(0, 0, a), bevel=0.012))
    lo.append(blob(f'leg{k}_heel', 0.06, (0, 0, -knee + 0.04), IRON, sub=2))
    lower = bake(lo, f'leg_{k}_lower', origin=(0, 0, 0))
    upper.location = (hx, hy, HIP)
    lower.parent = upper
    lower.location = (0, 0, -(HIP - knee))
    return upper


start = ROAM[60]
root = box('mover_castle', (0.02, 0.02, 0.02), (0, 0, -0.2), IRON, bevel=0.0)
body = castle_body()
body.parent = root
for k, (hx, hy) in enumerate(HIPS):
    leg(k, hx, hy).parent = root
R = [blob('prop_hub', 0.05, (0, 0, 0), BRASS, sub=2)]
for j in range(3):
    a = j / 3 * math.tau
    R.append(box('prop_blade', (0.06, 0.02, 0.42), (math.sin(a) * 0.22, 0, math.cos(a) * 0.22), WOOD, rot=(0, a, 0), bevel=0.01))
prop = bake(R, 'castle_prop', origin=(0, 0, 0))
prop.parent = body
prop.location = (-0.3 + 0.06, 0.25, BODY + 0.55 + 2.55)
prop.rotation_euler = (0, 0, H)
smoke = box('castle_smoke', (0.01, 0.01, 0.01), (0.3 + 0.15, -0.25 + 0.25, BODY + 0.55 + 0.72 + 1.2), IRON, bevel=0.0)
smoke.parent = body
root.location = (start.x, start.y, ROAMZ[60])
root.scale = (1.4, 1.4, 1.4)

# ── 나무, 덤불, 들꽃 ──────────────────────────────────
trees = 0
for i in range(8000):
    if trees >= 28:
        break
    x, y = tile.pick(W, D, 0.4)
    if (x - y) / math.sqrt(2) > 5.0 and rnd.random() < 0.8:
        continue
    # 길 안쪽(연못 둘레)은 성이 가리지 않게 드문드문
    if math.hypot(x, y) < 4.0 and rnd.random() < 0.85:
        continue
    hh = (0.9 + rnd.random() * 0.5) * 1.35
    if not tile.free(x, y, 0.42 * hh, W, D, 0.4):
        continue
    kind = trees % 5
    if kind == 4:
        look.pine(f'tree_{trees}', x, y, hh * 1.4)
    elif kind == 2:
        look.oval_tree(f'tree_{trees}', x, y, hh * 1.15, 'red')
    else:
        look.cloud_tree(f'tree_{trees}', x, y, hh, ('orange', 'green', 'red', 'yellow')[kind])
    block(x, y, 0.4 * hh)
    trees += 1
print('trees', trees, flush=True)
for i in range(30):
    for _ in range(60):
        x, y = tile.pick(W, D, 0.4)
        if tile.free(x, y, 0.22, W, D):
            bush(f'bush_{i}', x, y, 0.22)
            block(x, y, 0.22)
            break
# ── 둘레: 밭 가장자리 산울타리, 나무숲 ─────────────────────
spots = []
for axis_, size, off in ((0, FW, -1.3), (1, FD, 0.7)):
    for k in range(-12, 13):
        c = k * size + off
        if tile.speckle(k, axis_ + 0.5) < 0.35:
            continue
        t = -60.0
        while t < 60.0:
            x, y = (c, t) if axis_ == 0 else (t, c)
            t += 0.42 + rnd.random() * 0.12
            if max(abs(x), abs(y)) - W / 2 < 2.5 or math.hypot(x, y) > 48 or rnd.random() < 0.08:
                continue
            if abs(math.hypot(x, y) - 13) < 4.5 and tile.poly_dist((x, y), ROAM_LINE) < 1.4:
                continue
            spots.append((x, y, hfar(x, y) - 0.05, 0.6 + rnd.random() * 0.25, ('bush', BUSH)))
for g in range(70):
    cx_, cy_ = (rnd.random() - 0.5) * 120, (rnd.random() - 0.5) * 120
    if max(abs(cx_), abs(cy_)) - W / 2 < 4 or math.hypot(cx_, cy_) > 60:
        continue
    for j in range(rnd.randint(3, 9)):
        x, y = cx_ + (rnd.random() - 0.5) * 4, cy_ + (rnd.random() - 0.5) * 4
        if math.hypot(x, y) < 20 and tile.poly_dist((x, y), ROAM_LINE) < 2.2:
            continue
        spots.append((x, y, hfar(x, y) - 0.05, (1.6 + rnd.random() * 0.9) * 1.35,
                      'pine' if rnd.random() < 0.25 else LEAF[('green', 'orange', 'red', 'yellow', 'green')[rnd.randrange(5)]]))
print('far spots', len(spots), flush=True)
tile.far_trees('far_trees', spots)

cols = ['#ffffff', '#f2d14a', '#f29ab8', '#b9a2ff', '#ef6a5a']
bms = [bmesh.new() for _ in cols]
for c in range(40):
    for _ in range(40):
        cx_, cy_ = tile.pick(W, D, 0.5)
        if tile.free(cx_, cy_, 0.3, W, D):
            break
    k = c % len(cols)
    for j in range(9):
        fx, fy = cx_ + (rnd.random() - 0.5) * 0.7, cy_ + (rnd.random() - 0.5) * 0.7
        if not tile.free(fx, fy, 0.0, W, D):
            continue
        z = height(fx, fy) + 0.05
        bmesh.ops.create_icosphere(bms[k], subdivisions=1, radius=0.04 + rnd.random() * 0.015, matrix=Matrix.Translation((fx, fy, z)))
for k, c in enumerate(cols):
    finish(new_obj(f'flowers_{k}', bms[k]), mat(f'flower_{k}', c, 0.6, 0.05))

if os.environ.get('CLOSE'):
    setup_render((start.x + 6.5, start.y - 7.5, 5.0), (start.x, start.y, 2.0))
else:
    setup_render((12.8 * 1.5, -14.4 * 1.5, 9.6 * 1.5), (0, 0, -0.6))

layout = {
    'ground': tile.heightmap(hfar),
    'paths': {'loop': [three(p, z) for p, z in list(zip(ROAM, ROAMZ))[::3]]},
    'lights': [three(bp + CAM * 1.4, 1.2)] + [three(bpy.data.objects[f'house_{k}'].location.xy + CAM * 0.95, 1.2) for k in range(2)],
}

if MODE == 'glb':
    out = os.path.abspath(OUT)
    export_glb(os.path.join(out, 'castle.glb'), lightmap=os.path.join(out, 'castle_light.png'), samples=SAMPLES, layout=layout)
if MODE == 'preview':
    scene.render.filepath = os.path.join(OUT, 'preview.png')
    bpy.ops.render.render(write_still=True)
    print('done', flush=True)
