# 도시 테마: 운하가 가로지르는 구시가 디오라마. 앱: public/models/city.glb + city_light.png(라이트맵)
#   blender -b -P tools/blender/city.py -- public/models glb 384
#   ffmpeg -i public/models/city_light.png -c:v libwebp -quality 90 public/models/city_light.webp  (png 는 지운다)
# 네모난 땅 조각: 가운데를 지나는 돌 운하(아치 다리 둘), 운하를 감싸 도는 돌길(자동차가 돈다),
# 뒤쪽 두 변을 따라 늘어선 파스텔 회벽 집들, 시계탑 교회와 분수 광장, 노천카페, 앞쪽 공원.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: F401,F403
import lib
import look
import tile
from tile import smooth, three

W = D = 16.0
H = math.pi / 2
CX0, CX1 = 0.4, 2.8  # 운하 양쪽 둑(x). 타일 격자(0.2)에 맞춘다
BED, LEVEL = TOP - 0.8, TOP - 0.38
RING, RW = 5.3, 1.0  # 순환 도로 반 크기, 폭

PAVE = mat('pave', '#ddd2bf', 0.95, 0.07, 9.0)
ROAD = mat('road', '#8e8780', 0.9, 0.08, 12.0)
QUAY = mat('quay', '#b9ab95', 0.9, 0.08, 6.0)
PAVE_LIGHT = mat('pave_light', '#ebe2d0', 0.95, 0.05, 9.0)
CURB = mat('curb', '#cfc4b0', 0.9, 0.05, 6.0)
SLATE = banded('roof_slate', ['#5f6b74', '#6b7882', '#56616a'], 14.0, 0.3, 0.3, 0.8)
WALLS = [mat(f'wall_{k}', c, 0.9, 0.05, 8.0) for k, c in enumerate(
    ('#efe4cf', '#ebc9a6', '#efd9a0', '#e8bcae', '#cdd6b8', '#c3d5dc', '#f3efe7', '#e6c08e'))]
SHUTTERS = [mat(f'shutter_{k}', c, 0.8, 0.04) for k, c in enumerate(('#6f8a6a', '#5f7f9c', '#a8664a', '#5e6f6a'))]
AWNINGS = [(CLOTH_R, CLOTH_W), (look.CLOTH_G, CLOTH_W), (look.CLOTH_B, CLOTH_W)]
ROOFS = [TILE, ROOF_RED, ROOF_BROWN, SLATE]


def in_canal(x):
    return CX0 < x < CX1


def height(x, y):
    if CX0 + 0.01 < x < CX1 - 0.01:
        return BED
    return TOP


lib.surface = height
look.surface = height


def paint(x, y, z):
    if z < TOP - 0.1:
        return QUAY
    # 앞쪽 공원(앞 두 변 안쪽 띠)
    if (x > RING + 0.9 and y < RING - 1.5) or (y < -RING - 0.9 and x > -RING + 1.5 and not in_canal(x)):
        return GRASS
    return PAVE


tile.build(W, D, height, paint, water=LEVEL, step=0.2)
tile.liquid_plane('liquid_canal', W, D, height, LEVEL, step=0.2)

# 운하 둑: 돌벽 + 갓돌
for sx, x in ((-1, CX0), (1, CX1)):
    o = box(f'quay_wall_{sx}', (0.16, D, TOP - BED), (x - sx * 0.08, 0, (TOP + BED) / 2), QUAY, bevel=0.01)
    o = box(f'quay_cap_{sx}', (0.26, D, 0.07), (x - sx * 0.04, 0, TOP + 0.03), CURB, bevel=0.02)
    for k in range(40):
        yy = -D / 2 + (k + 0.5) * D / 40
        if rnd.random() < 0.25:
            o = cyl(f'bollard_{sx}_{k}', 0.045, 0.05, 0.16, (x + sx * 0.3, yy, TOP + 0.08), DARKWOOD, seg=8, bevel=0.01)

# ── 순환 도로 ────────────────────────────────────────
def ring_points(r, n=96):
    pts = []
    for k in range(n):
        a = k / n * math.tau
        c, s = math.cos(a), math.sin(a)
        # 둥근 모서리 사각형 위의 점(초타원으로 근사)
        e = 6
        k_ = (abs(c) ** e + abs(s) ** e) ** (-1 / e)
        pts.append(Vector((c * k_ * r, s * k_ * r)))
    return pts


def ribbon(name, pts, width, z, m, closed=True):
    bm = bmesh.new()
    L, R_ = [], []
    n = len(pts)
    for i, p in enumerate(pts):
        a, b = pts[(i - 1) % n], pts[(i + 1) % n]
        if not closed:
            a, b = pts[max(i - 1, 0)], pts[min(i + 1, n - 1)]
        tan = (b - a).normalized()
        side = Vector((-tan.y, tan.x)) * width / 2
        L.append(bm.verts.new((p.x + side.x, p.y + side.y, z)))
        R_.append(bm.verts.new((p.x - side.x, p.y - side.y, z)))
    for i in range(n if closed else n - 1):
        j = (i + 1) % n
        bm.faces.new([L[i], R_[i], R_[j], L[j]])
    return finish(new_obj(name, bm), m)


ROUTE = ring_points(RING)
ribbon('road', ROUTE, RW, TOP + 0.012, ROAD)
ribbon('curb_out', ring_points(RING + RW / 2 + 0.05), 0.1, TOP + 0.03, CURB)
ribbon('curb_in', ring_points(RING - RW / 2 - 0.05), 0.1, TOP + 0.03, CURB)
for p in ROUTE[::2]:
    block(p.x, p.y, RW * 0.75)
# 도로가 운하를 건너는 곳: 돌 아치 다리


def arch_bridge(name, x, y, span, width, rail=True):
    deck = box(f'{name}_deck', (span, width, 0.5), (0, 0, TOP - 0.2), QUAY, bevel=0.03)
    cut = cyl(f'{name}_cut', 0.95, 0.95, width + 0.4, (0, 0, BED - 0.25), QUAY, seg=32, rot=(H, 0, 0))
    b = deck.modifiers.new('arch', 'BOOLEAN')
    b.operation = 'DIFFERENCE'
    b.object = cut
    bpy.context.view_layer.objects.active = deck
    bpy.ops.object.modifier_apply(modifier='bevel')
    bpy.ops.object.modifier_apply(modifier='arch')
    bpy.data.objects.remove(cut, do_unlink=True)
    P = [deck]
    if rail:
        for s in (-1, 1):
            P.append(box(f'{name}_rail', (span, 0.12, 0.22), (0, s * (width / 2 - 0.06), TOP + 0.16), PAVE_LIGHT, bevel=0.03))
            for e in (-1, 1):
                P.append(box(f'{name}_post', (0.18, 0.18, 0.32), (e * span / 2, s * (width / 2 - 0.06), TOP + 0.2), PAVE_LIGHT, bevel=0.03))
    # 아치 이맛돌
    for k in range(9):
        a = math.pi * (k + 0.5) / 9
        for s in (-1, 1):
            P.append(box(f'{name}_vous', (0.12, 0.04, 0.18), (math.cos(a) * 1.0, s * (width / 2 + 0.01), BED - 0.25 + math.sin(a) * 1.0),
                         CURB, rot=(0, -a + H, 0), bevel=0.01))
    o = bake(P, name, origin=(0, 0, 0))
    o.location = (x, y, 0)
    return o


MID = (CX0 + CX1) / 2
for s in (-1, 1):
    arch_bridge(f'bridge_{s}', MID, s * RING, CX1 - CX0 + 0.6, RW + 0.5)
arch_bridge('bridge_foot', MID, 0.6, CX1 - CX0 + 0.6, 0.8)

# ── 집 ───────────────────────────────────────────────


def townhouse(name, x, y, rot, w, d, floors, wall, roof, shop=None, side_gable=False):
    """좁은 구시가 집(앞 = -y): 돌 1층(가게 창·차양 또는 문), 회벽 위층(덧창 창·꽃상자), 처마 돌림띠, 기와 지붕, 굴뚝"""
    P = []
    gh, fh = 0.72, 0.6
    top = gh + floors * fh
    sh = SHUTTERS[rnd.randrange(len(SHUTTERS))]
    P.append(box(f'{name}_wall', (w, d, top - gh), (0, 0, gh + (top - gh) / 2), wall, bevel=0.02))
    P.append(box(f'{name}_ground', (w + 0.02, d + 0.02, gh), (0, 0, gh / 2), PAVE_LIGHT if shop else wall, bevel=0.02))
    P.append(box(f'{name}_band', (w + 0.08, d + 0.08, 0.06), (0, 0, gh), PAVE_LIGHT, bevel=0.015))
    P.append(box(f'{name}_eave', (w + 0.1, d + 0.1, 0.08), (0, 0, top - 0.02), PAVE_LIGHT, bevel=0.02))
    fy = -d / 2 - 0.02
    if shop:
        a, b = shop
        P.append(box(f'{name}_shopglass', (w * 0.62, 0.03, 0.42), (-w * 0.1, fy, 0.36), GLASS, bevel=0.01))
        P.append(box(f'{name}_shopframe', (w * 0.66, 0.025, 0.46), (-w * 0.1, fy + 0.008, 0.36), DARKWOOD, bevel=0.01))
        n = max(4, round(w * 0.66 / 0.1))
        for k in range(n):
            P.append(box(f'{name}_awn', (w * 0.7 / n, 0.38, 0.02), (-w * 0.1 - w * 0.35 + (k + 0.5) * w * 0.7 / n, fy - 0.17, 0.66),
                         a if k % 2 else b, rot=(0.32, 0, 0), bevel=0.004))
        P.append(box(f'{name}_door', (0.2, 0.03, 0.46), (w / 2 - 0.17, fy, 0.24), DARKWOOD, bevel=0.01))
    else:
        P.append(box(f'{name}_door', (0.26, 0.03, 0.5), (0, fy, 0.26), DARKWOOD, bevel=0.01))
        P.append(box(f'{name}_doorframe', (0.34, 0.025, 0.56), (0, fy + 0.008, 0.28), PAVE_LIGHT, bevel=0.01))
        P.append(box(f'{name}_step', (0.4, 0.14, 0.05), (0, fy - 0.06, 0.025), STONE, bevel=0.015))
    n = max(1, round(w / 0.42))

    def window(cx, cz, ry, fy_):
        c, s = math.cos(ry), math.sin(ry)
        off = lambda dx, dy, dz=0: (cx * c - (fy_ + dy) * s + dx * c, cx * s + (fy_ + dy) * c + dx * s, cz + dz)
        P.append(box(f'{name}_glass', (0.16, 0.03, 0.26), off(0, 0), GLASS, rot=(0, 0, ry), bevel=0.005))
        P.append(box(f'{name}_frame', (0.21, 0.02, 0.31), off(0, 0.008), PAVE_LIGHT, rot=(0, 0, ry), bevel=0.006))
        P.append(box(f'{name}_sill', (0.24, 0.07, 0.03), off(0, -0.03, -0.16), PAVE_LIGHT, rot=(0, 0, ry), bevel=0.008))
        for e in (-1, 1):
            P.append(box(f'{name}_shut', (0.08, 0.02, 0.29), off(e * 0.14, -0.005), sh, rot=(0, 0, ry), bevel=0.005))

    for f in range(floors):
        cz = gh + f * fh + fh * 0.52
        for k in range(n):
            cx = (k - (n - 1) / 2) * w / n
            window(cx, cz, 0, fy)
            if rnd.random() < 0.35:
                P.append(box(f'{name}_flowerbox', (0.2, 0.06, 0.05), (cx, fy - 0.06, cz - 0.12), DARKWOOD, bevel=0.008))
                for j in range(3):
                    P.append(blob(f'{name}_fl', 0.035, (cx + (j - 1) * 0.06, fy - 0.06, cz - 0.08),
                                  CLOTH_R if rnd.random() < 0.6 else look.CROP, sub=1))
            window(cx, cz, math.pi, fy)
    pitch = math.radians(rnd.choice((38, 45, 50)))
    Q = []
    if side_gable:
        rise = look.tile_roof(Q, name, d, w, top, pitch, roof)
        for q in Q:
            q.location = (-q.location.y, q.location.x, q.location.z)
            q.rotation_euler.z += H
    else:
        rise = look.tile_roof(Q, name, w, d, top, pitch, roof)
    P += Q
    gw, gy = (d, w) if side_gable else (w, d)
    for s in (-1, 1):
        bm = bmesh.new()
        vs = [bm.verts.new(v) for v in ((-gw / 2, 0, 0), (gw / 2, 0, 0), (0, 0, rise))]
        bmesh.ops.solidify(bm, geom=[bm.faces.new(vs)], thickness=0.04)
        g = new_obj(f'{name}_gable', bm)
        g.location = (0, s * gy / 2, top)
        if side_gable:
            g.location = (s * gy / 2, 0, top)
            g.rotation_euler.z = H
        P.append(finish(g, wall, smooth=False))
    if not side_gable:
        # 앞 박공 다락 창
        P.append(box(f'{name}_attic', (0.14, 0.03, 0.18), (0, fy, top + rise * 0.35), GLASS, bevel=0.005))
        P.append(box(f'{name}_atticf', (0.19, 0.02, 0.23), (0, fy + 0.008, top + rise * 0.35), PAVE_LIGHT, bevel=0.006))
    cx = (rnd.random() - 0.5) * w * 0.5
    P.append(box(f'{name}_chim', (0.18, 0.18, 0.5), (cx, d * 0.2, top + rise * 0.6), wall, bevel=0.02))
    P.append(box(f'{name}_chimcap', (0.24, 0.24, 0.05), (cx, d * 0.2, top + rise * 0.6 + 0.26), PAVE_LIGHT, bevel=0.01))
    o = bake(P, name, origin=(0, 0, 0))
    o.location = (x, y, TOP - 0.02)
    o.rotation_euler = (0, 0, rot)
    block(x, y, max(w, d) * 0.6)
    return o


def row(prefix, start, end, rot, depth, floors_rng, shops=0.4, skip=None):
    """start→end 직선을 따라 폭이 제각각인 집을 빈틈없이 잇는다(앞 = rot 방향의 -y)"""
    a, b = Vector(start), Vector(end)
    L = (b - a).length
    t = 0.0
    k = 0
    out = []
    while t < L - 0.5:
        w = min(0.9 + rnd.random() * 0.6, L - t)
        c = a + (b - a) * ((t + w / 2) / L)
        if not (skip and skip(c)):
            floors = rnd.randint(*floors_rng)
            shop = AWNINGS[rnd.randrange(3)] if rnd.random() < shops else None
            out.append(townhouse(f'{prefix}_{k}', c.x, c.y, rot, w - 0.02, depth, floors, WALLS[rnd.randrange(len(WALLS))],
                                 ROOFS[rnd.randrange(len(ROOFS))], shop, side_gable=rnd.random() < 0.3))
        t += w
        k += 1
    return out


FACE_PX = H  # 앞(-y)이 +x 를 보게
skip_canal = lambda c: CX0 - 0.6 < c.x < CX1 + 0.6
row('house_l', (-7.0, -6.6), (-7.0, 7.4), FACE_PX, 1.6, (2, 3))  # 뒤 왼쪽 변: +x 를 본다
row('house_b', (-6.0, 7.0), (7.4, 7.0), 0.0, 1.6, (2, 3), skip=skip_canal)  # 뒤 오른쪽 변: -y 를 본다
row('house_e', (3.6, -3.9), (3.6, 4.0), FACE_PX, 1.4, (1, 2), shops=0.6, skip=lambda c: abs(c.y - 0.6) < 0.9)

# ── 교회와 분수 광장 ───────────────────────────────────
CH = Vector((-2.4, 2.2))
P = []
P.append(box('ch_nave', (1.9, 2.8, 1.6), (0, 0.6, 0.8), WALLS[6], bevel=0.03))
P.append(box('ch_plinth', (2.0, 2.9, 0.2), (0, 0.6, 0.1), STONE, bevel=0.02))
Q = []
rise = look.tile_roof(Q, 'ch', 1.9, 2.8, 1.6, math.radians(45), ROOF_RED)
for q in Q:
    q.location.y += 0.6
P += Q
bm = bmesh.new()
f = bm.faces.new([bm.verts.new(v) for v in ((-0.95, 0, 0), (0.95, 0, 0), (0, 0, rise))])
bmesh.ops.solidify(bm, geom=[f], thickness=0.04)
g = new_obj('ch_gable', bm)
g.location = (0, 0.6 + 1.4, 1.6)
P.append(finish(g, WALLS[6], smooth=False))
for k in range(3):
    P.append(box('ch_win', (0.03, 0.2, 0.6), (0.96, -0.2 + k * 0.7, 0.95), GLASS, bevel=0.01))
    P.append(box('ch_win', (0.03, 0.2, 0.6), (-0.96, -0.2 + k * 0.7, 0.95), GLASS, bevel=0.01))
# 종탑(앞)
tw = 1.05
P.append(box('ch_tower', (tw, tw, 3.4), (0, -1.05, 1.7), WALLS[6], bevel=0.03))
P.append(box('ch_tbase', (tw + 0.1, tw + 0.1, 0.5), (0, -1.05, 0.25), STONE, bevel=0.02))
for z in (1.6, 2.6, 3.4):
    P.append(box('ch_tband', (tw + 0.08, tw + 0.08, 0.07), (0, -1.05, z), PAVE_LIGHT, bevel=0.015))
P.append(box('ch_door', (0.42, 0.03, 0.72), (0, -1.05 - tw / 2 - 0.02, 0.36), DARKWOOD, bevel=0.012))
P.append(cyl('ch_doorarch', 0.21, 0.21, 0.03, (0, -1.05 - tw / 2 - 0.02, 0.72), DARKWOOD, seg=16, rot=(H, 0, 0)))
for a in range(4):
    c, s = math.cos(a * H), math.sin(a * H)
    off = lambda dx, dy, dz: (dx * c - dy * s, -1.05 + dx * s + dy * c, dz)
    P.append(cyl('ch_clock', 0.26, 0.26, 0.04, off(0, -tw / 2 - 0.02, 2.1), WALLS[6], seg=24, rot=(H, 0, a * H)))
    P.append(cyl('ch_clockr', 0.3, 0.3, 0.03, off(0, -tw / 2 - 0.01, 2.1), DARKWOOD, seg=24, rot=(H, 0, a * H)))
    P.append(box('ch_hand', (0.03, 0.02, 0.2), off(0.0, -tw / 2 - 0.05, 2.18), DARKWOOD, rot=(0, 0, a * H)))
    P.append(box('ch_hand2', (0.15, 0.02, 0.03), off(0.06, -tw / 2 - 0.05, 2.1), DARKWOOD, rot=(0, 0, a * H)))
    for e in (-1, 1):
        P.append(box('ch_bell', (0.16, 0.04, 0.42), off(e * 0.2, -tw / 2 - 0.005, 2.95), DARKWOOD, rot=(0, 0, a * H), bevel=0.01))
spire = cyl('ch_spire', 0.82, 0.02, 1.7, (0, -1.05, 3.4 + 0.85), SLATE, seg=4, rot=(0, 0, math.pi / 4), bevel=0.02)
P.append(spire)
P.append(cyl('ch_cross', 0.015, 0.015, 0.4, (0, -1.05, 5.35), DARKWOOD, seg=6))
P.append(box('ch_crossb', (0.2, 0.025, 0.025), (0, -1.05, 5.42), DARKWOOD))
church = bake(P, 'church', origin=(0, 0, 0))
church.location = (CH.x, CH.y, TOP - 0.02)
church.rotation_euler = (0, 0, -0.0)
block(CH.x, CH.y + 0.2, 2.0)

FT = Vector((-2.2, -1.6))
ribbon('plaza_ring', [FT + Vector((math.cos(a), math.sin(a))) * 1.25 for a in [k / 48 * math.tau for k in range(48)]], 0.9, TOP + 0.006,
       PAVE_LIGHT)
P = [cyl('ft_basin', 0.72, 0.75, 0.24, (0, 0, 0.12), STONE, seg=32, bevel=0.03),
     cyl('ft_water', 0.64, 0.64, 0.04, (0, 0, 0.2), WATER, seg=32),
     cyl('ft_col', 0.09, 0.12, 0.62, (0, 0, 0.4), STONE, seg=12, bevel=0.02),
     cyl('ft_bowl', 0.32, 0.12, 0.12, (0, 0, 0.68), STONE, seg=20, bevel=0.03),
     cyl('ft_bwater', 0.27, 0.27, 0.03, (0, 0, 0.72), WATER, seg=20),
     cyl('ft_top', 0.04, 0.06, 0.26, (0, 0, 0.84), STONE, seg=10),
     blob('ft_ball', 0.07, (0, 0, 0.98), STONE, sub=2)]
look.place(bake(P, 'fountain', origin=(0, 0, 0)), FT.x, FT.y, 0, 1.1)
for k in range(4):
    a = k / 4 * math.tau + 0.4
    p = FT + Vector((math.cos(a), math.sin(a))) * 1.75
    look.bench(f'bench_p{k}', p.x, p.y, a + H)

# 노천카페: 파라솔 탁자(교회 옆 길가)
def parasol(name, x, y, cloth):
    P = [cyl(f'{name}_pole', 0.015, 0.015, 0.8, (0, 0, 0.4), DARKWOOD, seg=6),
         cyl(f'{name}_top', 0.42, 0.02, 0.18, (0, 0, 0.84), cloth, seg=8, bevel=0.01),
         cyl(f'{name}_table', 0.16, 0.16, 0.03, (0, 0, 0.36), WOOD, seg=12),
         cyl(f'{name}_leg', 0.02, 0.03, 0.36, (0, 0, 0.18), DARKWOOD, seg=6)]
    for k in range(2):
        a = k * math.pi + 0.5
        P.append(box(f'{name}_chair', (0.13, 0.13, 0.03), (math.cos(a) * 0.3, math.sin(a) * 0.3, 0.2), DARKWOOD, bevel=0.008))
        P.append(box(f'{name}_chairb', (0.03, 0.13, 0.16), (math.cos(a) * 0.37, math.sin(a) * 0.37, 0.28), DARKWOOD, rot=(0, 0, a),
                     bevel=0.008))
    return look.place(bake(P, name, origin=(0, 0, 0)), x, y, rnd.random(), 0.45)


cafe = [Vector((-0.3, -3.6)), Vector((-1.2, -3.9)), Vector((-0.4, -2.5))]
for k, p in enumerate(cafe):
    parasol(f'parasol_{k}', p.x, p.y, (CLOTH_R, CLOTH_W, look.CLOTH_G)[k])
# 사람들
for k, (p, rot, shirt, pose) in enumerate((
        (FT + Vector((1.0, -0.6)), 2.4, look.CLOTH_B, 'stand'), (FT + Vector((-0.9, 0.8)), -0.6, CLOTH_R, 'wave'),
        (cafe[0] + Vector((0.3, 0.05)), 3.4, look.CLOTH_G, 'sit'), (cafe[1] + Vector((-0.3, 0.1)), 0.2, CLOTH_W, 'sit'),
        (Vector((MID + 0.1, 0.6)), 0.0, CLOTH_R, 'stand'), (Vector((-4.6, -4.6)), 0.8, look.CLOTH_B, 'stand'),
        (Vector((6.4, -3.0)), 2.0, look.CLOTH_G, 'stand'), (Vector((-1.2, 4.6)), -1.2, CLOTH_W, 'stand'))):
    o = look.villager(f'man_{k}', p.x, p.y, rot, shirt, hat=k % 3 == 0, pose=pose)
    o.scale = (1.3, 1.3, 1.3)
    if in_canal(p.x):
        o.location.z = TOP + 0.08

# 운하: 묶어 둔 배, 앱이 움직이는 배(mover_boat)
BOAT = mat('boat_blue', '#4f7f9c', 0.6, 0.04)
for k, (yy, rot) in enumerate(((-2.6, 0.05), (3.0, -0.04), (-6.8, 0.0))):
    o = look.rowboat(f'moored_{k}', CX0 + 0.42 if k % 2 else CX1 - 0.42, yy, LEVEL - 0.03, H + rot)
    o.scale = (1.35, 1.35, 1.35)
# 다리 아치 밑을 지나도록 낮은 짐배(뱃사공 + 상자)
P = [blob('mb_hull', 0.3, (0, 0, 0.0), BOAT, scale=(2.3, 0.75, 0.3), sub=3),
     blob('mb_in', 0.28, (0, 0, 0.04), DARKWOOD, scale=(2.2, 0.66, 0.12), sub=3)]
for k in range(3):
    P += look.crate('mb_crate', (-0.25 + k * 0.17, (k % 2) * 0.08 - 0.04, 0.1), 0.12)
boat = bake(P, 'mover_boat', origin=(0, 0, 0))
boat.location = (MID, -4.0, LEVEL)
boat.rotation_euler = (0, 0, H)
boat.scale = (1.3, 1.3, 1.3)

# 자동차(앱이 순환 도로를 따라 움직인다)
for k, (c, kind) in enumerate((('#d9583b', 'hatch'), ('#4f86b8', 'hatch'), ('#e8c25a', 'hatch'), ('#f2efe8', 'van'))):
    o = look.car(f'mover_car_{k}', c, kind)
    p = ROUTE[k * 24]
    o.location = (p.x, p.y, TOP + 0.02)
    o.scale = (1.3, 1.3, 1.3)

# ── 가로등, 공원 나무 ─────────────────────────────────
lamps = []
for k, p in enumerate(ring_points(RING + RW / 2 + 0.35, 20)):
    if in_canal(p.x) or not tile.free(p.x, p.y, 0.15, W, D):
        continue
    lamps.append(look.lantern(f'lamp_{k}', p.x, p.y))
    lamps[-1].scale = (1.4, 1.4, 1.4)
trees = 0
for i in range(4000):
    if trees >= 26:
        break
    x, y = tile.pick(W, D, 0.4)
    park = (x > RING + 0.8 and y < RING - 1.5) or (y < -RING - 0.8 and x > -RING + 1.5)
    plaza = (Vector((x, y)) - FT).length > 2.3 and -4.6 < x < -0.2 and -4.6 < y < 4.6
    if not (park or (plaza and rnd.random() < 0.15)) or in_canal(x) or abs(x - CX0) < 0.5 or abs(x - CX1) < 0.5:
        continue
    h = (0.85 + rnd.random() * 0.35) * 1.3
    if not tile.free(x, y, 0.42 * h, W, D, 0.4):
        continue
    look.cloud_tree(f'tree_{trees}', x, y, h, ('orange', 'green', 'red', 'green', 'yellow')[trees % 5])
    block(x, y, 0.4 * h)
    trees += 1
print('trees', trees, flush=True)
for i in range(16):
    for _ in range(50):
        x, y = tile.pick(W, D, 0.4)
        if (x > RING + 0.8 or y < -RING - 0.8) and not in_canal(x) and tile.free(x, y, 0.25, W, D):
            bush(f'bush_{i}', x, y, 0.2)
            block(x, y, 0.25)
            break

setup_render((12.8 * 1.2, -14.4 * 1.2, 9.6 * 1.2), (0, 0, -0.6))

# 도로 중심선(앱 좌표): 차가 오른쪽 차선을 달리게 앱이 옆으로 비낀다
layout = {
    'paths': {'ring': [three(p, TOP + 0.02) for p in ROUTE[::3]], 'canal': [three(Vector((MID, y)), LEVEL) for y in (-7.2, 0, 7.2)]},
    'lights': [three(Vector((CH.x, CH.y - 1.05 - 0.9)), 1.0), three(FT, 1.2), three(cafe[0], 1.0)]
              + [three(o.location, 1.2) for o in lamps[::3]],
}

if MODE == 'glb':
    out = os.path.abspath(OUT)
    export_glb(os.path.join(out, 'city.glb'), lightmap=os.path.join(out, 'city_light.png'), samples=SAMPLES, layout=layout)
if MODE == 'preview':
    scene.render.filepath = os.path.join(OUT, 'preview.png')
    bpy.ops.render.render(write_still=True)
    print('done', flush=True)
