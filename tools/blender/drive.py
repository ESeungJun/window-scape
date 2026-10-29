# 드라이브 테마: 바닷가 해안도로 디오라마. 앱: public/models/drive.glb + drive_light.png(라이트맵)
#   blender -b -P tools/blender/drive.py -- public/models glb 384
#   ffmpeg -i public/models/drive_light.png -c:v libwebp -quality 90 public/models/drive_light.webp  (png 는 지운다)
# 해안도로 한 구간: 양쪽 바위 곶의 터널을 잇는 길(자동차가 터널에서 나와 다른 터널로 들어간다),
# 앞쪽은 모래사장과 바다(파라솔·탈의실·선착장), 돛단배, 뒤쪽 언덕엔 하얀 집들·휴게소·풍력 발전기.
# 둘레(far_*)는 수평선까지 트인 바다와 바위섬 등대, 곶 너머로 이어지는 해안도로, 뒤쪽 산과 바닷가 마을.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: F401,F403
import lib
import look
import tile
from tile import smooth, poly_dist, three

W = D = 16.0
H = math.pi / 2
FACE = math.atan2(CAM.x, -CAM.y)
LEVEL = TOP - 0.06
ROADZ = TOP + 0.3
ROAD = [Vector(p) for p in ((-70.0, -64.0), (-42.0, -38.5), (-26.0, -24.5), (-15.0, -13.0), (-9.2, -8.0), (-6.6, -5.9), (-3.6, -3.5),
                            (-0.6, -0.9), (2.4, 1.3), (5.0, 3.7), (7.0, 6.0), (9.2, 8.0), (15.5, 13.0), (26.0, 23.0), (42.0, 38.0), (70.0, 63.0))]
CAPES = [Vector((-7.6, -7.6)), Vector((7.7, 7.6))]
ISLET = Vector((16.3, 0.7))  # 등대 바위섬(타일 밖 바다, 옆으로 비켜 앞을 가리지 않게)
ISLES = [Vector((26.0, -20.0)), Vector((40.0, -6.0)), Vector((15.0, -34.0))]  # 먼 바위섬
PORTAL = 2.2  # 곶 중심에서 터널 입구까지


def coast(x, y):
    """바다 쪽으로 갈수록 커지는 값(해안선 기준 거리)과 그 지점의 해안선 위치"""
    s = (x - y) / math.sqrt(2)
    t = (x + y) / math.sqrt(2)
    return s, 2.3 + 0.45 * math.sin(t * 0.55 + 1.0) + 0.25 * math.sin(t * 1.3)


def cape(x, y):
    return min((Vector((x, y)) - c).length for c in CAPES)


def height(x, y):
    s, sc = coast(x, y)
    # 뒤쪽 언덕
    h = ROADZ + 2.6 * smooth(-1.0, -9.5, s) + 0.35 * math.sin(x * 0.9 + 0.4) * math.cos(y * 0.7) * smooth(-1.0, -5.0, s)
    # 길은 평평하게
    rd = poly_dist((x, y), ROAD)
    cd = cape(x, y)
    if cd > PORTAL:
        h = h + (ROADZ - h) * smooth(1.5, 0.75, rd)
    # 바닷가: 길 → 모래사장 → 바다
    if s > sc - 1.2:
        k = smooth(sc - 1.2, sc + 1.6, s)
        h = h + (TOP - 0.02 - h) * k
    if s > sc + 1.6:
        h = TOP - 0.02 - 0.95 * smooth(sc + 1.6, sc + 4.0, s)
    # 터널이 뚫린 바위 곶(터널 입구까지는 길 폭만큼 깎아 낸다)
    ch = ROADZ + 2.4 * smooth(3.4, 1.4, cd) + 0.3 * math.sin(x * 2.1) * math.sin(y * 1.7) * smooth(3.4, 2.0, cd)
    if cd > PORTAL - 0.05:
        ch = ch + (ROADZ - ch) * smooth(1.0, 0.7, rd)
    if cd < 3.4:
        h = max(h, ch)
    return h


def far_land(x, y):
    """먼 땅: 뒤쪽은 산 능선, 앞쪽은 깊어지는 바다(해안선은 그대로 이어진다)"""
    s, sc = coast(x, y)
    a = math.atan2(y, x)
    ridge = 0.6 + 0.3 * math.sin(a * 4 + 0.9) + 0.1 * math.sin(x * 0.2) * math.cos(y * 0.17)
    return 9.0 * ridge * smooth(-10, -40, s)


def hfar(x, y):
    t = smooth(0, 12, max(abs(x), abs(y)) - W / 2)
    h = height(x, y) + far_land(x, y) * t
    # 바위섬(등대 섬과 먼 섬들)
    for c, r, top in [(ISLET, 1.7, 1.55)] + [(c, 2.6, 2.4) for c in ISLES]:
        d = (Vector((x, y)) - c).length
        h = max(h, TOP - 1.0 + top * smooth(r, r * 0.35, d))
    return h


lib.surface = hfar
look.surface = hfar


def slope(x, y):
    e = 0.15
    return math.hypot(hfar(x + e, y) - hfar(x - e, y), hfar(x, y + e) - hfar(x, y - e)) / (2 * e)


def paint(x, y, z):
    s, sc = coast(x, y)
    if ((cape(x, y) < 3.0 and z > ROADZ + 0.5) or min((Vector((x, y)) - c).length for c in [ISLET] + ISLES) < 1.8 or slope(x, y) > 1.3
            or z > ROADZ + 5.5):
        return ROCK
    if s > sc - 0.6 and z < ROADZ - 0.05:
        return SAND
    return GRASS


tile.build(W, D, height, paint, water=LEVEL, ground=True)
tile.liquid_plane('liquid_sea', W, D, height, LEVEL)
def paint_far(x, y, z):
    """먼 땅: 기울기 대신 높이로만 고른다(길쭉한 먼 칸에서 기울기 판정이 들쭉날쭉해진다)"""
    s_, sc_ = coast(x, y)
    if (cape(x, y) < 3.0 and z > ROADZ + 0.5) or min((Vector((x, y)) - c).length for c in [ISLET] + ISLES) < 1.8 or z > ROADZ + 5.5:
        return ROCK
    if s_ > sc_ - 0.6 and z < ROADZ - 0.05:
        return SAND
    return GRASS


tile.surround('far_ground', W, D, 0.2, hfar, paint_far, keep=10.0)
tile.liquid_far('liquid_sea_far', W, D, hfar, LEVEL, margin=0.8)

# ── 도로: 아스팔트, 가운데 점선, 바다 쪽 가드레일 ─────────────
ASPHALT = mat('road', '#5d5f66', 0.9, 0.05, 10.0)
PAINT_W = mat('paint', '#f1ece0', 0.8, 0.02)
RAIL = mat('rail', '#d8dadf', 0.5, 0.03)
full = catmull(ROAD, 12)
pts = [p for p in full if abs(p.x) < 7.95 and abs(p.y) < 7.95]
bm = bmesh.new()
L, R_ = [], []
for i, p in enumerate(pts):
    tan = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
    side = Vector((-tan.y, tan.x)) * 0.62
    L.append(bm.verts.new((p.x + side.x, p.y + side.y, ROADZ + 0.015)))
    R_.append(bm.verts.new((p.x - side.x, p.y - side.y, ROADZ + 0.015)))
for i in range(len(pts) - 1):
    bm.faces.new([L[i], R_[i], R_[i + 1], L[i + 1]])
finish(new_obj('road', bm), ASPHALT)
for p in pts:
    block(p.x, p.y, 0.95)
# 곶 너머로 이어지는 길(먼 풍경)
for k, part in enumerate(([p for p in full if p.x < -7.6 and p.y < -7.6], [p for p in full if p.x > 7.6 and p.y > 7.6])):
    bm = bmesh.new()
    L, R_ = [], []
    for i, p in enumerate(part):
        tan = (part[min(i + 1, len(part) - 1)] - part[max(i - 1, 0)]).normalized()
        side = Vector((-tan.y, tan.x)) * 0.62
        L.append(bm.verts.new((p.x + side.x, p.y + side.y, ROADZ + 0.015)))
        R_.append(bm.verts.new((p.x - side.x, p.y - side.y, ROADZ + 0.015)))
    for i in range(len(part) - 1):
        bm.faces.new([L[i], R_[i], R_[i + 1], L[i + 1]])
    finish(new_obj(f'far_road_{k}', bm), ASPHALT)
dist = 0.0
P = []
for i in range(1, len(pts)):
    a, b = pts[i - 1], pts[i]
    seg = (b - a).length
    tan = (b - a).normalized()
    t = 0.0
    while t < seg:
        c = a + tan * t
        if (dist + t) % 0.6 < 0.3 and cape(c.x, c.y) > 2.2 and abs(c.x) < 7.9 and abs(c.y) < 7.9:
            P.append(box('dash', (0.26, 0.05, 0.01), (c.x, c.y, ROADZ + 0.022), PAINT_W, rot=(0, 0, math.atan2(tan.y, tan.x)), bevel=0))
        t += 0.1
    dist += seg
bake(P, 'road_dash')
P = []
for i in range(0, len(pts) - 1, 2):
    p = pts[i]
    tan = (pts[i + 1] - p).normalized()
    side = Vector((tan.y, -tan.x))  # 바다 쪽(오른쪽 아래)
    if side.x - side.y < 0:
        side = -side
    q = p + side * 0.82
    if cape(q.x, q.y) < 2.9 or abs(q.x) > 7.8 or abs(q.y) > 7.8:
        continue
    P.append(box('rail_post', (0.05, 0.05, 0.26), (q.x, q.y, ROADZ + 0.13), RAIL, bevel=0.01))
    nxt = pts[min(i + 2, len(pts) - 1)] + side * 0.82
    if cape(nxt.x, nxt.y) >= 2.9:
        m = (q + nxt) / 2
        P.append(box('rail_bar', ((nxt - q).length + 0.04, 0.03, 0.08), (m.x, m.y, ROADZ + 0.22), RAIL, rot=(0, 0, math.atan2(tan.y, tan.x)),
                     bevel=0.01))
bake(P, 'guardrail')

# 터널 입구: 곶 둘레를 지나는 곳에 돌 아치(안은 어둡게)
TUNNEL = mat('tunnel', '#2a2a2e', 1.0, 0.0)
portals = []
for c, far in [(c, f) for c in CAPES for f in (False, True)]:
    # 타일 쪽 입구와 곶 너머(먼 풍경 쪽) 출구
    side = [k for k in range(1, len(full) - 1) if ((full[k] - c).dot(c) > 0) == far]
    i = min(side, key=lambda k: abs((full[k] - c).length - PORTAL))
    p = full[i]
    tan = (full[i + 1] - full[i - 1]).normalized()
    if (c - p).dot(tan) < 0:
        tan = -tan
    face = box('portal', (0.5, 1.95, 1.6), (0, 0, 0.75), STONE, bevel=0.03)
    cut = box('portal_cut', (1.2, 1.24, 0.75), (0, 0, 0.3), STONE, bevel=0.0)
    cut2 = cyl('portal_cut2', 0.62, 0.62, 1.2, (0, 0, 0.65), STONE, seg=24, rot=(0, H, 0))
    for c_ in (cut, cut2):
        b = face.modifiers.new('cut', 'BOOLEAN')
        b.operation = 'DIFFERENCE'
        b.object = c_
    bpy.context.view_layer.objects.active = face
    for m in list(face.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    for c_ in (cut, cut2):
        bpy.data.objects.remove(c_, do_unlink=True)
    PP = [face, box('portal_dark', (1.6, 1.3, 1.5), (0.85, 0, 0.6), TUNNEL, bevel=0.0),
          box('portal_cap', (0.62, 2.05, 0.12), (0, 0, 1.58), STONE, bevel=0.03)]
    for k in range(11):
        a = math.pi * k / 10
        PP.append(box('portal_vous', (0.54, 0.12, 0.16), (-0.02, math.cos(a) * 0.68, 0.65 + math.sin(a) * 0.68), CLIFF_LEDGE[1],
                      rot=(-a + H, 0, 0), bevel=0.012))
    o = bake(PP, f'{"far_" if far else ""}portal_{len(portals)}', origin=(0, 0, 0))
    o.location = (p.x, p.y, ROADZ)
    o.rotation_euler = (0, 0, math.atan2(tan.y, tan.x))
    o.scale = (1.1, 1.1, 1.1)
    portals.append(p)

# ── 바닷가 ─────────────────────────────────────────
def beach_point(t, off):
    """해안선을 따라 t, 해안선에서 바다 쪽으로 off 떨어진 점"""
    s = coast(t / math.sqrt(2), t / math.sqrt(2))[1] + off
    return Vector(((t + s) / math.sqrt(2), (t - s) / math.sqrt(2)))


def parasol(name, p, cloth):
    P = [cyl(f'{name}_pole', 0.015, 0.015, 0.85, (0, 0, 0.42), WOOD, seg=6),
         cyl(f'{name}_top', 0.48, 0.02, 0.2, (0, 0, 0.86), cloth, seg=8, bevel=0.01, rot=(0.15, 0, 0))]
    o = bake(P, name, origin=(0, 0, 0))
    o.location = (p.x, p.y, height(p.x, p.y) - 0.02)
    block(p.x, p.y, 0.5)
    return o


TOWELS = [mat(f'towel_{k}', c, 0.95, 0.03) for k, c in enumerate(('#e9a23b', '#5f9fc4', '#e46f5a', '#f2ece0'))]
for k, t in enumerate((-3.6, -1.6, 0.6, 2.4)):
    p = beach_point(t, 0.2)
    o = parasol(f'parasol_{k}', p, (CLOTH_R, look.CLOTH_B, TOWELS[0], CLOTH_W)[k])
    o.scale = (1.3, 1.3, 1.3)
    q = p + Vector((0.4, 0.15))
    box(f'towel_{k}', (0.62, 0.32, 0.015), (q.x, q.y, height(q.x, q.y) + 0.005), TOWELS[k], rot=(0, 0, FACE + 0.3 * k), bevel=0.005)
# 탈의실(줄무늬 오두막) 줄
for k in range(4):
    p = beach_point(-6.6 + k * 0.85, -0.55)
    cl = (CLOTH_R, look.CLOTH_B, look.CLOTH_G, TOWELS[0])[k]
    P = [box('hut_body', (0.55, 0.5, 0.7), (0, 0, 0.35), CLOTH_W, bevel=0.02)]
    for j in range(4):
        P.append(box('hut_stripe', (0.08, 0.52, 0.7), (-0.2 + j * 0.135, 0, 0.35), cl, bevel=0.005))
    P.append(cyl('hut_roof', 0.48, 0.03, 0.3, (0, 0, 0.84), cl, seg=4, rot=(0, 0, math.pi / 4), bevel=0.01))
    P.append(box('hut_door', (0.24, 0.03, 0.46), (0, -0.26, 0.25), DARKWOOD, bevel=0.008))
    o = bake(P, f'beach_hut_{k}', origin=(0, 0, 0))
    o.location = (p.x, p.y, height(p.x, p.y) - 0.02)
    o.rotation_euler = (0, 0, -math.pi / 4 + 0.0)
    o.scale = (1.25, 1.25, 1.25)
    block(p.x, p.y, 0.5)
# 구조대 망루
p = beach_point(-0.5, 0.8)
P = []
for sx in (-1, 1):
    for sy in (-1, 1):
        P.append(cyl('tower_leg', 0.025, 0.025, 0.9, (sx * 0.2, sy * 0.2, 0.45), WOOD, seg=6, rot=(sy * 0.12, -sx * 0.12, 0)))
P += [box('tower_seat', (0.5, 0.5, 0.05), (0, 0, 0.9), WOOD, bevel=0.01), box('tower_back', (0.5, 0.05, 0.4), (0, 0.24, 1.1), CLOTH_R, bevel=0.01),
      cyl('tower_shade', 0.4, 0.02, 0.18, (0, 0, 1.45), CLOTH_W, seg=8)]
o = bake(P, 'lifeguard', origin=(0, 0, 0))
o.location = (p.x, p.y, height(p.x, p.y) - 0.02)
o.rotation_euler = (0, 0, FACE)
o.scale = (1.3, 1.3, 1.3)
block(p.x, p.y, 0.5)
# 선착장과 배
jb = beach_point(4.2, 1.0)
ja = -math.pi / 4
grow = lambda o, s: (setattr(o, 'scale', (s, s, s)), o)[1]
j = grow(look.jetty(jb.x, jb.y, ja, n=12), 1.4)
j.location.z = LEVEL + 0.04
bt = jb + Vector((math.cos(ja), math.sin(ja))) * 1.3 + Vector((-math.sin(ja), math.cos(ja))) * -0.55
o = grow(look.rowboat('boat_0', bt.x, bt.y, LEVEL - 0.03, ja + 0.1), 1.4)

# 바위섬 등대
grow(lighthouse(ISLET.x, ISLET.y + 0.1), 1.05)
for k in range(10):
    a = k / 10 * math.tau
    p = ISLET + Vector((math.cos(a), math.sin(a))) * (1.1 + rnd.random() * 0.45)
    look.boulder(f'islet_rock_{k}', p.x, p.y, 0.25 + rnd.random() * 0.25)

# ── 뒤쪽 언덕: 하얀 집, 휴게소, 풍력 발전기 ─────────────
WHITE = mat('wall_white', '#f3efe6', 0.9, 0.03, 8.0)
houses = [(Vector((-3.9, 0.4)), 1.3, 1.0, 1.0), (Vector((-1.2, 2.6)), 1.15, 0.95, 0.95), (Vector((-6.2, -1.6)), 1.2, 1.0, 1.0)]
for k, (p, w, d, h) in enumerate(houses):
    grow(look.house(f'house_{k}', p.x, p.y, FACE + 0.15 * (k - 1), w, d, h), 1.3)
# 휴게소: 큰 유리창, 줄무늬 차양, 지붕 간판, 주차장
DINER = mat('diner', '#efe2c4', 0.9, 0.04, 8.0)
dp = Vector((1.6, -0.6))
P = [box('diner_body', (2.0, 1.2, 0.85), (0, 0, 0.43), DINER, bevel=0.04),
     box('diner_roof', (2.2, 1.4, 0.1), (0, 0, 0.9), TILE, bevel=0.03),
     box('diner_glass', (1.5, 0.03, 0.42), (-0.1, -0.61, 0.46), GLASS, bevel=0.01),
     box('diner_frame', (1.56, 0.025, 0.48), (-0.1, -0.605, 0.46), DARKWOOD, bevel=0.01),
     box('diner_door', (0.28, 0.03, 0.56), (0.78, -0.61, 0.28), DARKWOOD, bevel=0.01),
     box('diner_sign', (1.2, 0.08, 0.3), (0, 0.1, 1.12), CLOTH_R, bevel=0.03),
     box('diner_signtxt', (0.9, 0.09, 0.1), (0, 0.1, 1.12), CLOTH_W, bevel=0.01)]
for k in range(10):
    P.append(box('diner_awn', (0.2, 0.42, 0.02), (-1.0 + 0.1 + k * 0.2, -0.78, 0.76), CLOTH_R if k % 2 else CLOTH_W, rot=(0.35, 0, 0), bevel=0.004))
o = bake(P, 'diner', origin=(0, 0, 0))
o.location = (dp.x, dp.y, ROADZ - 0.02)
o.rotation_euler = (0, 0, -math.pi / 4)
o.scale = (1.25, 1.25, 1.25)
block(dp.x, dp.y, 1.6)
look.place(look.car('parked_car', '#7fae8a'), dp.x - 1.4, dp.y - 1.0, -math.pi / 4 + H, 0.6).scale = (1.3, 1.3, 1.3)
for k, p in enumerate((Vector((0.0, -1.7)), Vector((2.9, 0.6)))):
    o = parasol(f'diner_parasol_{k}', p, TOWELS[1] if k else CLOTH_R)
    o.scale = (1.2, 1.2, 1.2)

turbines = []
for k, p in enumerate((Vector((-4.6, 4.4)), Vector((-1.4, 6.4)))):
    z = height(p.x, p.y)
    P = [cyl('tb_tower', 0.09, 0.05, 3.4, (0, 0, 1.7), CLOTH_W, seg=12), cyl('tb_base', 0.2, 0.22, 0.12, (0, 0, 0.06), STONE, seg=12)]
    body = bake(P, f'turbine_{k}', origin=(0, 0, 0))
    body.location = (p.x, p.y, z - 0.05)
    nac = box(f'tb_nac_{k}', (0.16, 0.42, 0.16), (p.x, p.y + 0.08, z + 3.42), CLOTH_W, bevel=0.05)
    R = [blob('tb_hub', 0.09, (0, 0, 0), CLOTH_W, scale=(1, 1.4, 1), sub=2)]
    for j in range(3):
        a = j / 3 * math.tau
        R.append(box('tb_blade', (0.1, 0.03, 1.35), (math.sin(a) * 0.7, 0, math.cos(a) * 0.7), CLOTH_W, rot=(0, a, 0), bevel=0.02))
    rotor = bake(R, f'mover_rotor_{k}', origin=(0, 0, 0))
    rotor.location = (p.x, p.y - 0.18, z + 3.42)
    block(p.x, p.y, 0.6)

# 돛단배(앱이 바다 위를 돈다)
SAIL_C = mat('sail_c', '#f5efe2', 0.9, 0.03)
P = [blob('sb_hull', 0.28, (0, 0, 0.02), CLOTH_W, scale=(2.2, 0.75, 0.42), sub=3), blob('sb_deck', 0.25, (0, 0, 0.08), WOOD, scale=(2.1, 0.62, 0.12), sub=3),
     cyl('sb_mast', 0.02, 0.018, 1.5, (0.08, 0, 0.8), DARKWOOD, seg=6)]
for nm, verts in (('sb_sail', ((0.12, 0, 0.2), (0.12, 0, 1.5), (0.75, 0, 0.22))), ('sb_jib', ((0.02, 0, 0.25), (0.02, 0, 1.3), (-0.55, 0, 0.25)))):
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new(v) for v in verts])
    bmesh.ops.solidify(bm, geom=[f], thickness=0.02)
    P.append(finish(new_obj(nm, bm), SAIL_C if nm == 'sb_sail' else CLOTH_R, smooth=False))
sb = bake(P, 'mover_sailboat', origin=(0, 0, 0))
sb.location = (5.8, -2.8, LEVEL)
sb.scale = (1.3, 1.3, 1.3)

for k, (c, kind) in enumerate((('#d9583b', 'hatch'), ('#4f86b8', 'van'), ('#e8c25a', 'hatch'))):
    o = look.car(f'mover_car_{k}', c, kind)
    p = pts[20 + k * 18]
    o.location = (p.x, p.y, ROADZ + 0.02)
    o.scale = (1.3, 1.3, 1.3)

# ── 나무: 언덕과 길가 ─────────────────────────────────
trees = 0
for i in range(10000):
    if trees >= 46:
        break
    x, y = tile.pick(W, D, 0.4)
    s, sc = coast(x, y)
    if s > sc - 1.3 or cape(x, y) < 1.8:
        continue
    hh = (0.95 + rnd.random() * 0.5) * 1.3
    if not tile.free(x, y, 0.42 * hh, W, D, 0.4):
        continue
    if rnd.random() < 0.5:
        look.pine(f'tree_{trees}', x, y, hh * 1.4)
    else:
        look.cloud_tree(f'tree_{trees}', x, y, hh, ('green', 'orange', 'red', 'yellow')[trees % 4])
    block(x, y, 0.36 * hh)
    trees += 1
print('trees', trees, flush=True)
for i in range(24):
    for _ in range(60):
        x, y = tile.pick(W, D, 0.4)
        s, sc = coast(x, y)
        if s < sc - 1.0 and tile.free(x, y, 0.22, W, D):
            bush(f'bush_{i}', x, y, 0.2)
            block(x, y, 0.22)
            break
for c in CAPES:
    for k in range(7):
        a = rnd.random() * math.tau
        p = c + Vector((math.cos(a), math.sin(a))) * (1.0 + rnd.random() * 1.6)
        if abs(p.x) < 7.7 and abs(p.y) < 7.7 and poly_dist(p, ROAD) > 0.9:
            look.boulder(f'cape_rock_{k}_{c.x:.0f}', p.x, p.y, 0.3 + rnd.random() * 0.35)

# ── 둘레: 언덕의 나무, 해안 마을 둘 ───────────────────────
spots, items = [], []
for k in range(1400):
    x, y = (rnd.random() - 0.5) * 120, (rnd.random() - 0.5) * 120
    s_, sc_ = coast(x, y)
    if max(abs(x), abs(y)) - W / 2 < 2.0 or s_ > sc_ - 1.6 or math.hypot(x, y) > 62 or poly_dist((x, y), ROAD) < 1.4 or cape(x, y) < 2.5:
        continue
    z = hfar(x, y)
    if z > ROADZ + 7.5:
        continue
    spots.append((x, y, z - 0.05, (1.5 + rnd.random() * 0.8) * 1.3, 'pine' if rnd.random() < 0.55 else LEAF[('green', 'orange', 'green')[k % 3]]))
for vc in (Vector((-20.0, -14.0)), Vector((17.0, 24.0))):
    for k in range(16):
        p = vc + Vector(((rnd.random() - 0.5) * 7, (rnd.random() - 0.5) * 7))
        if poly_dist(p, ROAD) < 1.3 or coast(p.x, p.y)[0] > coast(p.x, p.y)[1] - 1.4:
            continue
        items.append((p.x, p.y, hfar(p.x, p.y) - 0.05, 0.9 + rnd.random() * 0.4, 0.9, 0.75 + 0.6 * rnd.randint(0, 1), 0.45, FACE + (rnd.random() - 0.5) * 0.3,
                      WHITE, (TILE, ROOF_RED)[k % 2]))
print('far trees', len(spots), 'houses', len(items), flush=True)
tile.far_trees('far_trees', spots)
tile.far_houses('far_town', items)

setup_render((12.8 * 1.5, -14.4 * 1.5, 9.6 * 1.5), (0, 0, -0.6))

layout = {
    'ground': tile.heightmap(hfar),
    # 길 중심선(터널 안에서 시작해 반대편 터널 안에서 끝난다)
    'paths': {'road': [three(p, ROADZ + 0.02) for p in pts[::2]],
              'sea': [three(Vector((5.9 + math.cos(a) * 1.5 + math.sin(a) * 0.2, -2.9 + math.sin(a) * 1.1 + math.cos(a) * 0.9)), LEVEL)
                      for a in [k / 12 * math.tau for k in range(12)]]},
    'lights': [three(ISLET, TOP + 4.4), three(dp + Vector((0.0, -1.0)), ROADZ + 0.9)]
              + [three(houses[k][0] + CAM * 1.0, ROADZ + 0.8) for k in (0, 2)],
}

if MODE == 'glb':
    out = os.path.abspath(OUT)
    export_glb(os.path.join(out, 'drive.glb'), lightmap=os.path.join(out, 'drive_light.png'), samples=SAMPLES, layout=layout)
if MODE == 'preview':
    scene.render.filepath = os.path.join(OUT, 'preview.png')
    bpy.ops.render.render(write_still=True)
    print('done', flush=True)
