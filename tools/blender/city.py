# 도시 테마: 피렌체를 모티브로 한 강변 옛 도시 디오라마. 앱: public/models/city.glb + city_light.png(라이트맵)
#   blender -b -P tools/blender/city.py -- public/models glb 256
#   ffmpeg -i public/models/city_light.png -c:v libwebp -quality 90 public/models/city_light.webp  (png 는 지운다)
# 가운데를 흐르는 넓은 강(아르노 같은)과 가게가 얹힌 옛 다리(베키오 다리 같은), 순환 도로가 건너는 세 아치 돌다리,
# 왼쪽 둑에는 붉은 팔각 돔 성당과 줄무늬 종탑·세례당, 흉벽 탑이 선 시청 궁전과 광장,
# 강을 따라 늘어선 황토·크림색 팔라초(초록 덧창, 낮은 모임지붕, 처마, 옥상 정자), 오른쪽 둑에는 사이프러스 정원.
# 둘레(far_*)는 크기·높이·지붕이 제각각인 시가지와 먼 돔·종탑, 이어지는 강과 다리, 그 너머 사이프러스·올리브 언덕과 빌라.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: F401,F403
import lib
import look
import tile
from tile import smooth, three

W = D = 16.0
H = math.pi / 2
RX0, RX1 = 2.0, 4.8  # 강 양쪽 둑(x). 타일 격자(0.2)에 맞춘다
MID = (RX0 + RX1) / 2
BED, LEVEL = TOP - 0.8, TOP - 0.38
RC, RXR, RYR, RW = 0.6, 6.0, 5.4, 1.0  # 순환 도로 가운데 x, 반 크기(x, y), 폭
PV_Y = -0.6  # 옛 다리 자리(y)

PAVE = mat('pave', '#d8ccb6', 0.95, 0.07, 9.0)
PIAZZA = mat('piazza', '#e6dccb', 0.95, 0.05, 7.0)
ROAD = mat('road', '#8e8780', 0.9, 0.08, 12.0)
QUAY = mat('quay', '#b6a68a', 0.9, 0.08, 6.0)
CURB = mat('curb', '#cfc4b0', 0.9, 0.05, 6.0)
PIETRA = mat('pietra', '#8f8c86', 0.9, 0.05, 8.0)  # 회색 사암(창틀·띠)
RUSTIC = mat('rustic', '#c4b08c', 0.9, 0.12, 5.0)  # 거친 돌 1층
MARBLE = mat('marble', '#efeae0', 0.7, 0.03, 8.0)
MARBLE_G = mat('marble_g', '#55705a', 0.7, 0.04, 8.0)
MARBLE_P = mat('marble_p', '#d7a596', 0.7, 0.04, 8.0)
DOME = banded('dome', ['#bf5f3a', '#c96a43', '#b45634'], 10.0, 0.3, 0.3, 0.8)
GOLD = mat('gold', '#d9b25a', 0.4, 0.03)
COTTO = [banded(f'cotto_{k}', c, 14.0, 0.3, 0.3, 0.85) for k, c in enumerate((
    ['#b9603d', '#c46c47', '#ad5636'], ['#c87850', '#d18459', '#bd6e48'], ['#a85a3c', '#b36443', '#9d5236']))]
WALLS = [mat(f'wall_{k}', c, 0.9, 0.05, 8.0) for k, c in enumerate(
    ('#ead3a4', '#ddb47c', '#cf9a68', '#f0e4c8', '#dcae92', '#e7c88e', '#c99872', '#efdcb4'))]
SHUT = [mat('shut_g', '#55684a', 0.8, 0.04), mat('shut_b', '#6a5038', 0.8, 0.04)]
CYPRESS = mat('cypress', '#3f5a3d', 0.95, 0.08, 5.0)
UMBRELLA = mat('umbrella', '#5f7a45', 0.95, 0.08, 5.0)
OLIVE = mat('olive', '#9aa17a', 0.95, 0.08, 5.0)
FIELD = [GRASS, mat('field_dry', '#c8b878', 0.95, 0.08, 4.0), mat('field_olive', '#a9ad7c', 0.95, 0.08, 4.0), GRASS_DARK]


def in_river(x):
    return RX0 < x < RX1


def height(x, y):
    if RX0 + 0.01 < x < RX1 - 0.01:
        return BED
    return TOP


lib.surface = height
look.surface = height


def garden(x, y):
    """오른쪽 둑 앞 정원, 앞쪽 강변 공원"""
    return (x > RX1 + 0.4 and y < -1.4) or (y < -RYR - 0.7 and x < RX0 - 0.3)


def piazza(x, y):
    return (-3.9 < x < -0.1 and -2.9 < y < 0.3) or (-4.7 < x < -0.3 and -4.9 < y < -2.6)


def paint(x, y, z):
    # 먼 강둑은 물 밑만 둑 색으로(굵은 격자에서도 물가 선이 계단지지 않게). 타일 가까이는 타일처럼 돌둑 전체
    if z < (TOP - 0.1 if abs(y) < D / 2 + 3 else LEVEL):
        return QUAY
    if garden(x, y):
        return GRASS
    if piazza(x, y):
        return PIAZZA
    return PAVE


tile.build(W, D, height, paint, water=LEVEL, step=0.2, ground=True)
tile.liquid_plane('liquid_river', W, D, height, LEVEL, step=0.2, uv=lambda x, y, s: (0.5 + (x - MID) / (RX1 - RX0), -y * 0.3))

# ── 둘레 시가지: 크기가 제각각인 구역, 강은 구역 밖에서 굽이치며 이어진다 ─────────
CITY_R = 40.0
PER = W / 2 + 1.2


def spans_out(seed):
    r = random.Random(seed)
    out, t = [], PER
    while t < CITY_R + 8:
        b = 3.6 + r.random() * 3.6
        out.append((t, t + b))
        t += b + 0.9 + r.random() * 0.6
    return out


XS = [(-W / 2, W / 2)] + spans_out(1) + [(-b, -a) for a, b in spans_out(2)]
YS = [(-D / 2, D / 2)] + spans_out(3) + [(-b, -a) for a, b in spans_out(4)]


def span_of(v, spans):
    return next((sp for sp in spans if sp[0] <= v <= sp[1]), None)


def river_x(y):
    """강 가운데 x. 타일 가까이는 곧고, 멀어질수록 S 자로 굽이친다"""
    return MID + smooth(D / 2 + 1, D / 2 + 14, abs(y)) * 6.5 * math.sin(y * 0.085)


def corridor(x, y):
    """강과 양쪽 둑길"""
    return abs(x - river_x(y)) < (RX1 - RX0) / 2 + 1.4


def hriver(x, y):
    """굽은 강의 땅 높이: 타일 가장자리에선 타일과 같은 곧은 돌둑, 멀어질수록 비스듬한 둑"""
    d = abs(x - river_x(y))
    soft = TOP - (TOP - BED) * (1 - smooth((RX1 - RX0) / 2 - 0.9, (RX1 - RX0) / 2 + 0.5, d))
    return height(x, y) + (soft - height(x, y)) * smooth(D / 2, D / 2 + 3, abs(y))


def hills(x, y):
    r = math.hypot(x, y)
    a = math.atan2(y, x)
    # 뒤쪽(북쪽 언덕 마을 쪽)이 더 높다
    return (5.0 + 3.0 * max(0.0, math.sin(a))) * (0.6 + 0.3 * math.sin(a * 3 + 0.5) + 0.15 * math.sin(a * 7 + 1.3)) \
        * smooth(CITY_R + 2, 80, r) * smooth(1.6, 6.0, abs(x - river_x(y)))


def hfar(x, y):
    return hriver(x, y) + hills(x, y)


def belt(x, y):
    """앞쪽 두 변을 감싼 공원 띠(집이 가운데 타일을 가리지 않게)와 시가지 사이사이 공원 구역"""
    if max(abs(x) - W / 2, abs(y) - D / 2) < 8.0 and (x > W / 2 + 0.1 or y < -D / 2 - 0.1):
        return True
    sx, sy = span_of(x, XS), span_of(y, YS)
    return bool(sx and sy and (sx, sy) != (XS[0], YS[0]) and (cell((sx[0] + sx[1]) / 2, (sy[0] + sy[1]) / 2, 3.1) * 2654435761 >> 9) % 4 == 0)


def cell(x, y, s):
    return math.floor(x / s) * 7 + math.floor(y / s) * 13


def paint_far(x, y, z):
    # 먼 강둑은 물 밑만 둑 색으로(굵은 격자에서도 물가 선이 계단지지 않게). 타일 가까이는 타일처럼 돌둑 전체
    if z < (TOP - 0.1 if abs(y) < D / 2 + 3 else LEVEL):
        return QUAY
    if math.hypot(x, y) > CITY_R + 3:
        # 언덕: 밭·올리브밭·풀밭 조각보
        return FIELD[(cell(x + 3, y, 7.0) * 2654435761 >> 7) % len(FIELD)]
    sx, sy = span_of(x, XS), span_of(y, YS)
    if sx and sy and not corridor(x, y):
        inset = min(x - sx[0], sx[1] - x, y - sy[0], sy[1] - y)
        if belt(x, y) and inset > 0.3:
            return GRASS
        if inset > 1.9:
            return GRASS if (cell(x, y, 5) % 3) else PIAZZA  # 안뜰 정원·광장
    return PAVE


tile.surround('far_ground', W, D, 0.2, hfar, paint_far, keep=6.0)
tile.liquid_far('liquid_river_far', W, D, hfar, LEVEL, margin=0.3, uv=lambda x, y, s: (0.5 + (x - river_x(y)) / (RX1 - RX0), -y * 0.3))

# 강둑: 돌벽 + 갓돌
for sx, x in ((-1, RX0), (1, RX1)):
    box(f'quay_wall_{sx}', (0.16, D, TOP - BED), (x - sx * 0.08, 0, (TOP + BED) / 2), QUAY, bevel=0.01)
    box(f'quay_cap_{sx}', (0.26, D, 0.07), (x - sx * 0.04, 0, TOP + 0.03), CURB, bevel=0.02)


# ── 모양 도우미 ───────────────────────────────────────

def lathe(name, prof, seg, m, rot0=0.0, cap=True):
    """(반지름, 높이) 단면을 seg 각으로 돌린 면(성당 돔·북·탑)"""
    bm = bmesh.new()
    rings = [[bm.verts.new((r * math.cos(rot0 + k * math.tau / seg), r * math.sin(rot0 + k * math.tau / seg), z)) for k in range(seg)]
             for r, z in prof]
    for a, b in zip(rings, rings[1:]):
        for k in range(seg):
            j = (k + 1) % seg
            bm.faces.new([a[k], a[j], b[j], b[k]])
    if cap and prof[-1][0] > 0:
        bm.faces.new(rings[-1])
    return finish(new_obj(name, bm), m, smooth=False)


def ribs(name, prof, seg, m, rot0=0.0, w=0.035, out=0.02):
    """돔 모서리마다 흰 갈비뼈 띠"""
    bm = bmesh.new()
    for k in range(seg):
        a = rot0 + k * math.tau / seg
        c, s = math.cos(a), math.sin(a)
        L, R_ = [], []
        for r, z in prof:
            rr = r + out
            L.append(bm.verts.new((rr * c - w * s, rr * s + w * c, z)))
            R_.append(bm.verts.new((rr * c + w * s, rr * s - w * c, z)))
        for i in range(len(prof) - 1):
            bm.faces.new([R_[i], L[i], L[i + 1], R_[i + 1]])
    return finish(new_obj(name, bm), m, smooth=False)


def hip_roof(name, w, d, z, rise, m, o=0.14):
    """낮은 모임지붕(용마루는 긴 쪽)"""
    sw = d > w
    if sw:
        w, d = d, w
    r_ = (w - d) / 2
    bm = bmesh.new()
    P_ = lambda x, y, zz: bm.verts.new((y, x, zz) if sw else (x, y, zz))
    A, B, C, D_ = P_(-w / 2 - o, -d / 2 - o, z), P_(w / 2 + o, -d / 2 - o, z), P_(w / 2 + o, d / 2 + o, z), P_(-w / 2 - o, d / 2 + o, z)
    R1, R2 = P_(-r_, 0, z + rise), P_(r_ + 1e-3, 0, z + rise)
    faces = ([A, B, R2, R1], [C, D_, R1, R2], [D_, A, R1], [B, C, R2])
    for f in faces:
        bm.faces.new(f[::-1] if sw else f)
    return finish(new_obj(name, bm), m, smooth=False)


def gable_prism(name, w, L, z, rise, m, o=0.08):
    """박공 지붕(용마루는 y 방향, 길이 L)"""
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in ((-w / 2 - o, -L / 2, z), (w / 2 + o, -L / 2, z), (0, -L / 2, z + rise),
                                     (-w / 2 - o, L / 2, z), (w / 2 + o, L / 2, z), (0, L / 2, z + rise))]
    bm.faces.new([v[1], v[4], v[5], v[2]])
    bm.faces.new([v[3], v[0], v[2], v[5]])
    return finish(new_obj(name, bm), m, smooth=False)


def arched_bridge(name, x, y, span, width, arches, r, sz, rail_m, deck_m=QUAY):
    """돌다리: 강바닥까지 내려간 돌벽에 아치를 뚫는다(sz: 아치 세로 비율)"""
    deck = box(f'{name}_deck', (span, width, TOP + 0.06 - BED), (0, 0, (TOP + 0.06 + BED) / 2), deck_m, bevel=0.03)
    bpy.context.view_layer.objects.active = deck
    bpy.ops.object.modifier_apply(modifier='bevel')
    step = (RX1 - RX0) / arches
    for k in range(arches):
        cut = cyl(f'{name}_cut', r, r, width + 0.4, ((k - (arches - 1) / 2) * step, 0, BED), deck_m, seg=28, rot=(H, 0, 0))
        cut.scale = (1, sz, 1)
        b = deck.modifiers.new('arch', 'BOOLEAN')
        b.operation = 'DIFFERENCE'
        b.object = cut
        bpy.context.view_layer.objects.active = deck
        bpy.ops.object.modifier_apply(modifier='arch')
        bpy.data.objects.remove(cut, do_unlink=True)
    P = [deck]
    for s in (-1, 1):
        if rail_m:
            P.append(box(f'{name}_rail', (span, 0.1, 0.2), (0, s * (width / 2 - 0.05), TOP + 0.15), rail_m, bevel=0.02))
        # 아치 이맛돌
        for k in range(arches):
            cx = (k - (arches - 1) / 2) * step
            for j in range(9):
                a = math.pi * (j + 0.5) / 9
                P.append(box(f'{name}_vous', (0.1, 0.03, 0.14), (cx + math.cos(a) * (r + 0.05), s * (width / 2 + 0.01),
                                                                  BED + math.sin(a) * (r + 0.05) * sz), CURB, rot=(0, -a + H, 0), bevel=0))
    o = bake(P, name, origin=(0, 0, 0))
    o.location = (x, y, 0)
    return o


# ── 순환 도로(강을 두 번 건넌다) ───────────────────────────
def ring_points(rx, ry, n=96):
    pts = []
    for k in range(n):
        a = k / n * math.tau
        c, s = math.cos(a), math.sin(a)
        e = 6
        k_ = (abs(c) ** e + abs(s) ** e) ** (-1 / e)
        pts.append(Vector((RC + c * k_ * rx, s * k_ * ry)))
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


ROUTE = ring_points(RXR, RYR)
ribbon('road', ROUTE, RW, TOP + 0.012, ROAD)
ribbon('curb_out', ring_points(RXR + RW / 2 + 0.05, RYR + RW / 2 + 0.05), 0.1, TOP + 0.03, CURB)
ribbon('curb_in', ring_points(RXR - RW / 2 - 0.05, RYR - RW / 2 - 0.05), 0.1, TOP + 0.03, CURB)
for p in ROUTE[::2]:
    block(p.x, p.y, RW * 0.75)
for s in (-1, 1):
    arched_bridge(f'bridge_{s}', MID, s * RYR, RX1 - RX0 + 0.6, RW + 0.4, 3, 0.4, 1.4, CURB)

# ── 베키오 다리 같은 옛 다리: 낮은 세 아치 위로 작은 가게들이 양쪽에 매달리고 한쪽 위로 긴 회랑 ─────
SHOPS = [WALLS[1], WALLS[5], WALLS[2], WALLS[0], WALLS[6]]
P = [arched_bridge('pv', 0, 0, RX1 - RX0 + 0.5, 1.1, 3, 0.42, 1.1, None, RUSTIC)]
L = RX1 - RX0 + 0.3
n = 9
for s in (-1, 1):
    for k in range(n):
        if k == n // 2:
            continue  # 가운데는 강이 보이는 빈 터
        cx = -L / 2 + (k + 0.5) * L / n
        w = L / n - 0.03
        h = 0.5 + ((k * 7 + (s + 1) * 3) % 4) * 0.08
        dep = 0.42 + (k % 3) * 0.06
        cy = s * (0.55 - dep / 2 + 0.16)  # 다리 밖으로 조금 튀어나온다
        wall = SHOPS[(k + (s + 1)) % len(SHOPS)]
        P.append(box('pv_shop', (w, dep, h), (cx, cy, TOP + h / 2), wall, bevel=0.01))
        # 튀어나온 가게 밑 나무 받침
        P.append(box('pv_sporto', (w - 0.06, 0.12, 0.06), (cx, s * 0.6, TOP - 0.05), DARKWOOD, bevel=0))
        for e in (-1, 1):
            P.append(box('pv_brace', (0.04, 0.04, 0.3), (cx + e * w * 0.3, s * 0.62, TOP - 0.2), DARKWOOD, rot=(s * 0.5, 0, 0), bevel=0))
        # 지붕(바깥으로 기운 외쪽 지붕), 가게 문·창
        P.append(box('pv_roof', (w + 0.04, dep + 0.08, 0.04), (cx, cy, TOP + h + 0.04), COTTO[k % 3], rot=(-s * 0.18, 0, 0), bevel=0))
        P.append(box('pv_glass', (w * 0.6, 0.02, 0.22), (cx, cy - s * (dep / 2 + 0.005), TOP + 0.2), GLASS, bevel=0))
        P.append(box('pv_door', (w * 0.7, 0.02, 0.32), (cx, cy - s * (-dep / 2 - 0.005), TOP + 0.2), DARKWOOD, bevel=0))
        P.append(box('pv_win', (0.1, 0.02, 0.12), (cx, cy + s * (dep / 2 + 0.005), TOP + h - 0.18), GLASS, bevel=0))
# 위쪽 회랑(뒤쪽 가게 줄 위로)
P.append(box('pv_corridor', (L + 0.4, 0.34, 0.32), (0, 0.45, TOP + 0.95), WALLS[1], bevel=0.01))
P.append(gable_prism('pv_corroof', 0.34, L + 0.4, TOP + 1.11, 0.12, COTTO[0]))
P[-1].rotation_euler.z = H
for k in range(12):
    P.append(box('pv_cwin', (0.08, 0.02, 0.1), (-L / 2 - 0.1 + (k + 0.5) * (L + 0.4) / 12, 0.45 - 0.18, TOP + 0.97), GLASS, bevel=0))
# 가운데 빈 터: 세 아치 열린 회랑
for e in (-1, 1):
    P.append(box('pv_pier', (0.07, 0.07, 0.6), (e * 0.14, 0.45, TOP + 0.3), RUSTIC, bevel=0))
pv = bake(P, 'ponte', origin=(0, 0, 0))
pv.location = (MID, PV_Y, 0)

# ── 팔라초 ───────────────────────────────────────────


def palazzo(name, x, y, rot, w, d, floors, wall, roof, altana=False):
    """피렌체 팔라초(앞 = -y): 거친 돌 1층과 아치 대문, 회벽 위층(사암 창틀·초록 덧창), 층 띠, 넓은 처마, 낮은 모임지붕"""
    P = []
    gh, fh = 0.62, 0.5
    top = gh + floors * fh
    sh = SHUT[0] if rnd.random() < 0.75 else SHUT[1]
    P.append(box(f'{name}_wall', (w, d, top - gh), (0, 0, gh + (top - gh) / 2), wall, bevel=0.01))
    P.append(box(f'{name}_ground', (w + 0.03, d + 0.03, gh), (0, 0, gh / 2), RUSTIC, bevel=0.02))
    for f in range(floors):
        P.append(box(f'{name}_band', (w + 0.05, d + 0.05, 0.035), (0, 0, gh + f * fh), PIETRA, bevel=0))
    fy = -d / 2 - 0.02
    # 아치 대문
    P.append(box(f'{name}_door', (0.26, 0.03, 0.36), (0, fy, 0.18), DARKWOOD, bevel=0))
    P.append(cyl(f'{name}_arch', 0.13, 0.13, 0.03, (0, fy, 0.36), DARKWOOD, seg=10, rot=(H, 0, 0)))
    P.append(cyl(f'{name}_archs', 0.17, 0.17, 0.02, (0, fy + 0.012, 0.36), PIETRA, seg=10, rot=(H, 0, 0)))
    n = max(1, round(w / 0.42))
    for k in range(n):
        cx = (k - (n - 1) / 2) * w / n
        if abs(cx) > 0.3:
            P.append(box(f'{name}_gwin', (0.12, 0.03, 0.18), (cx, fy, 0.38), GLASS, bevel=0))
    for f in range(floors):
        cz = gh + f * fh + fh * 0.5
        for k in range(n):
            cx = (k - (n - 1) / 2) * w / n
            for s in (-1, 1):
                yy = s * (d / 2 + 0.015)
                P.append(box(f'{name}_glass', (0.14, 0.02, 0.26), (cx, yy, cz), GLASS, bevel=0))
                P.append(box(f'{name}_frame', (0.19, 0.012, 0.31), (cx, yy - s * 0.006, cz + 0.005), PIETRA, bevel=0))
                if s < 0:
                    for e in (-1, 1):
                        P.append(box(f'{name}_shut', (0.075, 0.02, 0.27), (cx + e * 0.135, yy + s * 0.005, cz), sh, bevel=0))
    # 넓은 처마(나무 서까래가 받친다) + 낮은 모임지붕
    P.append(box(f'{name}_gronda', (w + 0.26, d + 0.26, 0.05), (0, 0, top + 0.02), DARKWOOD, bevel=0))
    rise = min(w, d) * 0.28
    P.append(hip_roof(f'{name}_roof', w + 0.12, d + 0.12, top + 0.045, rise, roof, o=0.0))
    if altana:
        # 옥상 정자(기둥 넷 위 작은 지붕)
        ax = w * 0.22
        for ex in (-1, 1):
            for ey in (-1, 1):
                P.append(box(f'{name}_alt_p', (0.05, 0.05, 0.4), (ax + ex * 0.24, ey * 0.18, top + rise * 0.5 + 0.2), wall, bevel=0))
        P.append(box(f'{name}_alt_f', (0.56, 0.44, 0.06), (ax, 0, top + rise * 0.5), wall, bevel=0))
        P.append(hip_roof(f'{name}_alt_r', 0.56, 0.44, top + rise * 0.5 + 0.4, 0.14, roof, o=0.06))
    cx = (rnd.random() - 0.5) * w * 0.5
    P.append(box(f'{name}_chim', (0.14, 0.14, 0.35), (cx, d * 0.22, top + rise * 0.6), wall, bevel=0))
    P.append(box(f'{name}_chimcap', (0.2, 0.2, 0.04), (cx, d * 0.22, top + rise * 0.6 + 0.19), roof, bevel=0))
    o = bake(P, name, origin=(0, 0, 0))
    o.location = (x, y, TOP - 0.02)
    o.rotation_euler = (0, 0, rot)
    block(x, y, max(w, d) * 0.6)
    return o


def tower_house(name, x, y, rot, wall):
    """좁고 높은 탑집(돌), 꼭대기 흉벽"""
    P = [box(f'{name}_body', (0.8, 0.8, 3.6), (0, 0, 1.8), wall, bevel=0.01)]
    for k in range(5):
        for s in (-1, 1):
            P.append(box(f'{name}_win', (0.12, 0.02, 0.22), (0, s * 0.41, 0.8 + k * 0.6), GLASS, bevel=0))
    for i in range(4):
        for j in range(3):
            c, s_ = math.cos(i * H), math.sin(i * H)
            dx, dy = -0.3 + j * 0.3, -0.42
            P.append(box(f'{name}_mer', (0.16, 0.1, 0.18), (dx * c - dy * s_, dx * s_ + dy * c, 3.69), wall, rot=(0, 0, i * H), bevel=0))
    o = bake(P, name, origin=(0, 0, 0))
    o.location = (x, y, TOP - 0.02)
    o.rotation_euler = (0, 0, rot)
    block(x, y, 0.6)
    return o


ROUTE_LOOP = ROUTE + ROUTE[:1]


def on_road(c, w, d, rot):
    """집 자리(처마 포함)가 순환 도로에 걸치는지: 바닥 네모 위 3x3 점 중 하나라도 차도 안이면"""
    co, si = math.cos(rot), math.sin(rot)
    for u in (-1, 0, 1):
        for v in (-1, 0, 1):
            dx, dy = u * (w / 2 + 0.15), v * (d / 2 + 0.15)
            if tile.poly_dist((c.x + dx * co - dy * si, c.y + dx * si + dy * co), ROUTE_LOOP) < RW / 2 + 0.12:
                return True
    return False


def row(prefix, start, end, rot, depth, floors_rng, skip=None, towers=0.0):
    """start→end 직선을 따라 폭이 제각각인 팔라초를 빈틈없이 잇는다(앞 = rot 방향의 -y)"""
    a, b = Vector(start), Vector(end)
    L = (b - a).length
    t = 0.0
    k = 0
    while t < L - 0.6:
        w = min(0.95 + rnd.random() * 1.15, L - t)
        c = a + (b - a) * ((t + w / 2) / L)
        if not (skip and skip(c)) and not on_road(c, w, depth, rot):
            wall = WALLS[rnd.randrange(len(WALLS))]
            if rnd.random() < towers and w > 0.9:
                tower_house(f'{prefix}_t{k}', c.x, c.y, rot, RUSTIC if rnd.random() < 0.5 else wall)
            else:
                palazzo(f'{prefix}_{k}', c.x, c.y, rot, w - 0.03, depth * (0.85 + rnd.random() * 0.15), rnd.randint(*floors_rng), wall,
                        COTTO[rnd.randrange(3)], altana=w > 1.3 and rnd.random() < 0.35)
        t += w
        k += 1


skip_pv = lambda c: abs(c.y - PV_Y) < 0.9
row('pal_lf', (1.1, -4.7), (1.1, PV_Y), H, 1.0, (2, 3), skip_pv)  # 성당이 가리지 않게 낮게
row('pal_lb', (1.1, PV_Y), (1.1, 4.7), H, 1.0, (3, 5), skip_pv, towers=0.15)
row('pal_w', (-4.35, -1.8), (-4.35, 4.7), H, 0.8, (2, 4))
row('pal_r', (5.6, PV_Y + 0.9), (5.6, 4.7), -H, 0.8, (3, 4), towers=0.2)
row('pal_ow', (-7.0, -7.5), (-7.0, 7.5), H, 1.6, (3, 5), towers=0.1)
row('pal_ob', (-6.0, 7.0), (7.5, 7.0), 0.0, 1.6, (3, 5), lambda c: RX0 - 0.6 < c.x < RX1 + 0.6, towers=0.1)

# ── 성당: 줄무늬 대리석 본당과 정면, 팔각 북 위 붉은 갈비뼈 돔과 등탑, 세 반원 제단 ─────────
DX, DY = -2.1, 3.25  # 돔 가운데
NAVE_Y0, NAVE_Y1, NW, NH = -0.2, 2.45, 1.5, 1.55
P = []
nc = (NAVE_Y0 + NAVE_Y1) / 2
P.append(box('du_nave', (NW, NAVE_Y1 - NAVE_Y0, NH), (0, nc - DY, NH / 2), MARBLE, bevel=0.01))
P.append(gable_prism('du_roof', NW, NAVE_Y1 - NAVE_Y0, NH, 0.45, DOME))
P[-1].location.y = nc - DY
for z in (0.08, NH * 0.55, NH - 0.05):
    P.append(box('du_band', (NW + 0.03, NAVE_Y1 - NAVE_Y0 + 0.03, 0.06), (0, nc - DY, z), MARBLE_G, bevel=0))
for k in range(6):
    yy = NAVE_Y0 + 0.2 + k * (NAVE_Y1 - NAVE_Y0 - 0.4) / 5 - DY
    for s in (-1, 1):
        P.append(box('du_pil', (0.04, 0.07, NH), (s * (NW / 2 + 0.015), yy, NH / 2), MARBLE_G, bevel=0))
        if k < 5:
            P.append(box('du_win', (0.02, 0.12, 0.34), (s * (NW / 2 + 0.01), yy + 0.24, NH * 0.75), GLASS, bevel=0))
            P.append(box('du_panel', (0.02, 0.26, 0.4), (s * (NW / 2 + 0.008), yy + 0.24, NH * 0.28), MARBLE_P, bevel=0))
# 정면(더 높고 넓다): 세 문, 장미창, 녹·분홍 판
FY = NAVE_Y0 - DY - 0.06
FH = NH + 0.65
P.append(box('du_facade', (NW + 0.4, 0.14, FH), (0, FY, FH / 2), MARBLE, bevel=0.01))
bm = bmesh.new()
f = bm.faces.new([bm.verts.new(v) for v in ((-NW / 2 - 0.2, 0, 0), (NW / 2 + 0.2, 0, 0), (0, 0, 0.42))])
bmesh.ops.solidify(bm, geom=[f], thickness=0.14)
g = new_obj('du_fgable', bm)
g.location = (0, FY + 0.07, FH)
P.append(finish(g, MARBLE, smooth=False))
for z in (0.55, 1.2, FH - 0.04):
    P.append(box('du_fband', (NW + 0.42, 0.16, 0.05), (0, FY, z), MARBLE_G, bevel=0))
for e in (-1, 0, 1):
    hh = 0.46 if e == 0 else 0.34
    P.append(box('du_door', (0.22 if e == 0 else 0.16, 0.03, hh), (e * 0.55, FY - 0.07, hh / 2), DARKWOOD, bevel=0))
    P.append(box('du_dframe', (0.32 if e == 0 else 0.24, 0.02, hh + 0.1), (e * 0.55, FY - 0.065, (hh + 0.1) / 2), MARBLE_P, bevel=0))
    for z in (0.85, 1.5):
        P.append(box('du_fpanel', (0.22, 0.02, 0.4), (e * 0.62, FY - 0.075, z), MARBLE_P if e else MARBLE_G, bevel=0))
P.append(cyl('du_rose', 0.22, 0.22, 0.03, (0, FY - 0.08, 1.62), GLASS, seg=16, rot=(H, 0, 0)))
P.append(cyl('du_rosef', 0.28, 0.28, 0.02, (0, FY - 0.072, 1.62), MARBLE_G, seg=16, rot=(H, 0, 0)))
# 세 반원 제단(왼·오른·뒤)과 작은 반구 지붕
for ax, ay in ((-1, 0), (1, 0), (0, 1)):
    cx, cy = ax * 1.05, ay * 1.05
    P.append(cyl('du_apse', 0.58, 0.58, 1.15, (cx, cy, 0.575), MARBLE, seg=8, rot=(0, 0, math.pi / 8)))
    P.append(cyl('du_apseb', 0.6, 0.6, 0.06, (cx, cy, 1.15), MARBLE_G, seg=8, rot=(0, 0, math.pi / 8)))
    P.append(cyl('du_apser', 0.62, 0.05, 0.4, (cx, cy, 1.38), DOME, seg=8, rot=(0, 0, math.pi / 8)))
# 팔각 북
R8 = math.pi / 8
DR = 0.95
P.append(lathe('du_drum', [(DR, 0), (DR, 2.55)], 8, MARBLE, R8, cap=False))
for z in (1.6, 2.1, 2.5):
    P.append(lathe('du_drumb', [(DR + 0.025, z), (DR + 0.025, z + 0.06)], 8, MARBLE_G, R8, cap=False))
for k in range(8):
    a = R8 + (k + 0.5) * math.tau / 8
    r = DR * math.cos(math.pi / 8) + 0.01
    P.append(cyl('du_oc', 0.1, 0.1, 0.02, (math.cos(a) * r, math.sin(a) * r, 2.3), GLASS, seg=10, rot=(H, 0, a + H)))
# 갈비뼈 돔(끝이 뾰족한 아치 단면)
prof = []
for i in range(9):
    p = i / 8 * 1.36
    prof.append((max(DR * math.cos(p) ** 0.75, 0.2), 2.56 + 1.55 * math.sin(p)))
P.append(lathe('du_dome', prof, 8, DOME, R8))
P.append(ribs('du_ribs', prof, 8, MARBLE, R8))
# 등탑
LZ = prof[-1][1]
P.append(lathe('du_lantern', [(0.22, LZ), (0.2, LZ + 0.38)], 8, MARBLE, R8))
P.append(cyl('du_lcone', 0.24, 0.02, 0.36, (0, 0, LZ + 0.56), MARBLE, seg=8, rot=(0, 0, R8)))
P.append(blob('du_ball', 0.06, (0, 0, LZ + 0.78), GOLD, sub=2))
P.append(box('du_cross', (0.02, 0.02, 0.18), (0, 0, LZ + 0.92), GOLD, bevel=0))
duomo = bake(P, 'duomo', origin=(0, 0, 0))
duomo.location = (DX, DY, TOP - 0.02)
block(DX, DY, 1.7)
block(DX, (NAVE_Y0 + NAVE_Y1) / 2, 1.3)

# 종탑: 네 귀 초록 기둥, 층 띠, 위층일수록 큰 창, 내민 처마
CX_, CY_ = -0.55, -0.55
P = [box('ca_body', (0.62, 0.62, 4.3), (0, 0, 2.15), MARBLE, bevel=0.005)]
for ex in (-1, 1):
    for ey in (-1, 1):
        P.append(box('ca_corner', (0.08, 0.08, 4.3), (ex * 0.3, ey * 0.3, 2.15), MARBLE_G, bevel=0))
for z in (0.5, 1.1, 1.75, 2.45, 3.25, 4.25):
    P.append(box('ca_band', (0.66, 0.66, 0.05), (0, 0, z), MARBLE_G, bevel=0))
for i in range(4):
    c, s = math.cos(i * H), math.sin(i * H)
    for z, h_, w_ in ((1.42, 0.3, 0.1), (2.1, 0.4, 0.12), (2.85, 0.5, 0.18), (3.75, 0.7, 0.26)):
        P.append(box('ca_win', (w_, 0.02, h_), (-0.32 * s, -0.32 * c, z), GLASS, rot=(0, 0, -i * H), bevel=0))
    P.append(box('ca_panel', (0.3, 0.02, 0.3), (-0.315 * s, -0.315 * c, 0.8), MARBLE_P, rot=(0, 0, -i * H), bevel=0))
P.append(box('ca_cornice', (0.8, 0.8, 0.08), (0, 0, 4.34), MARBLE, bevel=0.01))
campanile = bake(P, 'campanile', origin=(0, 0, 0))
campanile.location = (CX_, CY_, TOP - 0.02)
block(CX_, CY_, 0.5)

# 세례당: 팔각, 줄무늬, 낮은 팔각 지붕과 작은 등탑
BX_, BY_ = -2.1, -1.75
P = [lathe('ba_body', [(0.6, 0), (0.6, 1.05)], 8, MARBLE, R8, cap=False)]
for z in (0.05, 0.5, 1.0):
    P.append(lathe('ba_band', [(0.62, z), (0.62, z + 0.05)], 8, MARBLE_G, R8, cap=False))
P.append(lathe('ba_attic', [(0.56, 1.05), (0.56, 1.3)], 8, MARBLE, R8, cap=False))
P.append(lathe('ba_roof', [(0.64, 1.3), (0.12, 1.62)], 8, MARBLE, R8))
P.append(lathe('ba_lantern', [(0.1, 1.62), (0.1, 1.82)], 8, MARBLE, R8))
P.append(blob('ba_ball', 0.04, (0, 0, 1.86), GOLD, sub=1))
for k in range(8):
    a = R8 + (k + 0.5) * math.tau / 8
    r = 0.6 * math.cos(math.pi / 8) + 0.01
    P.append(box('ba_panel', (0.02, 0.18, 0.32), (math.cos(a) * r, math.sin(a) * r, 0.75), MARBLE_G, rot=(0, 0, a), bevel=0))
P.append(box('ba_door', (0.02, 0.18, 0.34), (0, -0.56, 0.17), GOLD, rot=(0, 0, H), bevel=0))
bapt = bake(P, 'baptistery', origin=(0, 0, 0))
bapt.location = (BX_, BY_, TOP - 0.02)
block(BX_, BY_, 0.75)

# ── 시청 궁전: 거친 돌 몸채, 내민 흉벽 회랑, 앞쪽에 높은 탑 ─────────
PX, PY = -3.65, -3.75
P = [box('pa_body', (1.5, 1.3, 2.3), (0, 0, 1.15), RUSTIC, bevel=0.01)]
P.append(box('pa_gallery', (1.66, 1.46, 0.28), (0, 0, 2.38), RUSTIC, bevel=0))
for s in (-1, 1):
    for z in (0.95, 1.65):
        for k in range(4):
            P.append(box('pa_win', (0.14, 0.02, 0.3), (-0.55 + k * 0.37, s * 0.66, z), GLASS, bevel=0))
            P.append(cyl('pa_warch', 0.1, 0.1, 0.02, (-0.55 + k * 0.37, s * 0.665, z + 0.15), PIETRA, seg=8, rot=(H, 0, 0)))
    P.append(box('pa_door', (0.24, 0.02, 0.4), (0.3, s * 0.66, 0.2), DARKWOOD, bevel=0))
for i in range(4):
    L_ = 1.66 if i % 2 == 0 else 1.46
    off = 1.46 / 2 if i % 2 == 0 else 1.66 / 2
    c, s_ = math.cos(i * H), math.sin(i * H)
    n_ = int(L_ / 0.2)
    for k in range(n_):
        dx = -L_ / 2 + (k + 0.5) * L_ / n_
        dy = -off + 0.04
        P.append(box('pa_mer', (0.09, 0.07, 0.14), (dx * c - dy * s_, dx * s_ + dy * c, 2.59), RUSTIC, rot=(0, 0, i * H), bevel=0))
P.append(hip_roof('pa_roof', 1.36, 1.16, 2.52, 0.25, COTTO[0], o=0))
# 탑(앞면 위에서 솟는다)
TX, TY = 0.15, -0.45
P.append(box('pa_tower', (0.42, 0.42, 1.9), (TX, TY, 2.52 + 0.95), RUSTIC, bevel=0))
P.append(box('pa_tgal', (0.56, 0.56, 0.2), (TX, TY, 4.5), RUSTIC, bevel=0))
for i in range(4):
    c, s_ = math.cos(i * H), math.sin(i * H)
    for k in range(3):
        dx, dy = -0.18 + k * 0.18, -0.26
        P.append(box('pa_tmer', (0.08, 0.06, 0.12), (TX + dx * c - dy * s_, TY + dx * s_ + dy * c, 4.66), RUSTIC, rot=(0, 0, i * H), bevel=0))
P.append(box('pa_clock', (0.2, 0.02, 0.2), (TX, TY - 0.22, 3.7), MARBLE, bevel=0))
for ex in (-1, 1):
    for ey in (-1, 1):
        P.append(box('pa_col', (0.05, 0.05, 0.45), (TX + ex * 0.13, TY + ey * 0.13, 4.83), RUSTIC, bevel=0))
P.append(box('pa_bell', (0.12, 0.12, 0.14), (TX, TY, 4.8), GOLD, bevel=0))
P.append(cyl('pa_spire', 0.24, 0.02, 0.42, (TX, TY, 5.27), COTTO[2], seg=4, rot=(0, 0, math.pi / 4)))
palace = bake(P, 'palazzo_vecchio', origin=(0, 0, 0))
palace.location = (PX, PY, TOP - 0.02)
block(PX, PY, 1.0)

# 광장 분수(넵투누스 같은 조각)와 흰 조각상
FT = Vector((-1.8, -3.55))
P = [cyl('ft_basin', 0.5, 0.52, 0.18, (0, 0, 0.09), MARBLE, seg=8, rot=(0, 0, R8), bevel=0.02),
     cyl('ft_water', 0.45, 0.45, 0.03, (0, 0, 0.15), WATER, seg=8, rot=(0, 0, R8)),
     cyl('ft_ped', 0.1, 0.12, 0.3, (0, 0, 0.3), MARBLE, seg=8),
     blob('ft_body', 0.07, (0, 0, 0.55), MARBLE, scale=(0.8, 0.6, 1.8), sub=2),
     blob('ft_head', 0.04, (0, 0, 0.72), MARBLE, sub=1)]
look.place(bake(P, 'fountain', origin=(0, 0, 0)), FT.x, FT.y, 0, 0.75)
P = [box('st_base', (0.2, 0.2, 0.3), (0, 0, 0.15), MARBLE, bevel=0.01),
     blob('st_body', 0.06, (0, 0, 0.44), MARBLE, scale=(0.8, 0.6, 1.9), sub=2), blob('st_head', 0.035, (0, 0, 0.62), MARBLE, sub=1)]
look.place(bake(P, 'statue', origin=(0, 0, 0)), PX + 0.95, PY - 0.8, 0, 0.2)

# 노천카페: 파라솔 탁자(성당 광장 가장자리)
def parasol(name, x, y, cloth):
    P = [cyl(f'{name}_pole', 0.015, 0.015, 0.8, (0, 0, 0.4), DARKWOOD, seg=6),
         cyl(f'{name}_top', 0.4, 0.02, 0.16, (0, 0, 0.84), cloth, seg=8, bevel=0.01),
         cyl(f'{name}_table', 0.15, 0.15, 0.03, (0, 0, 0.36), WOOD, seg=10),
         cyl(f'{name}_leg', 0.02, 0.03, 0.36, (0, 0, 0.18), DARKWOOD, seg=6)]
    for k in range(2):
        a = k * math.pi + 0.5
        P.append(box(f'{name}_chair', (0.13, 0.13, 0.03), (math.cos(a) * 0.3, math.sin(a) * 0.3, 0.2), DARKWOOD, bevel=0))
    return look.place(bake(P, name, origin=(0, 0, 0)), x, y, rnd.random(), 0.45)


cafe = [Vector((-0.6, -2.3)), Vector((-1.0, -1.5)), Vector((-0.5, -3.3))]
for k, p in enumerate(cafe):
    parasol(f'parasol_{k}', p.x, p.y, (CLOTH_W, look.CLOTH_G, CLOTH_W)[k])


# 강: 묶어 둔 나룻배, 앱이 움직이는 배(mover_boat, 다리 아치 밑을 지나도록 낮게)
for k, (yy, rot) in enumerate(((-3.0, 0.05), (2.6, -0.04), (-6.8, 0.0))):
    o = look.rowboat(f'moored_{k}', RX0 + 0.42 if k % 2 else RX1 - 0.42, yy, LEVEL - 0.03, H + rot)
    o.scale = (1.35, 1.35, 1.35)
BOAT = mat('boat_green', '#4f6f58', 0.6, 0.04)
P = [blob('mb_hull', 0.3, (0, 0, 0.0), BOAT, scale=(2.4, 0.7, 0.28), sub=3),
     blob('mb_in', 0.28, (0, 0, 0.035), DARKWOOD, scale=(2.3, 0.62, 0.1), sub=3),
     cyl('mb_pole', 0.012, 0.012, 0.9, (-0.45, 0.0, 0.3), DARKWOOD, seg=6, rot=(0, 0.5, 0))]
boat = bake(P, 'mover_boat', origin=(0, 0, 0))
boat.location = (MID, -4.0, LEVEL)
boat.rotation_euler = (0, 0, H)
boat.scale = (1.3, 1.3, 1.3)

# 작은 자동차(앱이 순환 도로를 따라 움직인다): 크림·빨강·민트·하늘
for k, c in enumerate(('#efe4c6', '#c8453a', '#9fcbb7', '#8fb3d1')):
    o = look.car(f'mover_car_{k}', c, 'hatch')
    p = ROUTE[k * 24]
    o.location = (p.x, p.y, TOP + 0.02)
    o.scale = (1.25, 1.25, 1.25)

# ── 대관람차: 타일 오른쪽 공원(먼 풍경 쪽), 바퀴 면이 카메라를 본다.
#    바퀴(mover_wheel)는 앱이 제 축으로 돌리고 곤돌라(mover_gondola_k)는 늘 아래로 매달리게 따로 움직인다 ─────
WHEEL_M = mat('wheel', '#f2efe8', 0.5, 0.03)
GONDOLA = [mat(f'gondola_{k}', c, 0.6, 0.04) for k, c in enumerate(('#e58f6f', '#7fb3c8', '#f0c95a', '#9cc59a'))]
WC, WR, WZ, NG = Vector((10.2, 1.0)), 2.4, 3.1, 12  # 가운데, 바퀴 반지름, 축 높이(땅에서), 곤돌라 수
WROT = math.atan2(CAM.y, CAM.x)  # 바퀴 축(로컬 x)이 카메라 쪽을 보게


def ring(name, r, x, m):
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.035, major_segments=48, minor_segments=6, location=(x, 0, 0), rotation=(0, H, 0))
    o = bpy.context.object
    o.name = name
    return finish(o, m)


P = [cyl('wh_hub', 0.13, 0.13, 0.42, (0, 0, 0), WHEEL_M, seg=12, rot=(0, H, 0))]
for sx in (-0.13, 0.13):
    P.append(ring('wh_rim', WR, sx, WHEEL_M))
    P.append(ring('wh_rim_in', WR * 0.62, sx, WHEEL_M))
for k in range(NG):
    a = k / NG * math.tau
    for sx in (-0.13, 0.13):
        P.append(box('wh_spoke', (0.025, 0.025, WR), (sx, -math.sin(a) * WR / 2, math.cos(a) * WR / 2), WHEEL_M, rot=(a, 0, 0), bevel=0))
    P.append(box('wh_bar', (0.3, 0.03, 0.03), (0, -math.sin(a) * WR, math.cos(a) * WR), WHEEL_M, rot=(a, 0, 0), bevel=0))
for k in range(NG * 2):
    a = (k + 0.5) / (NG * 2) * math.tau
    for sx in (-0.15, 0.15):
        P.append(blob('wh_bulb', 0.035, (sx, -math.sin(a) * WR, math.cos(a) * WR), GLASS, sub=1))
wheel = bake(P, 'mover_wheel', origin=(0, 0, 0))
wheel.location = (WC.x, WC.y, TOP + WZ)
wheel.rotation_euler = (0, 0, WROT)
# 받침: 양쪽 A자 다리, 바닥판, 매표소
P = [box('wh_base', (1.1, 2.8, 0.1), (0, 0, 0.05), CURB, bevel=0.02),
     box('wh_booth', (0.5, 0.5, 0.55), (0.1, -1.55, 0.28), WALLS[1], bevel=0.02),
     box('wh_booth_roof', (0.62, 0.62, 0.06), (0.1, -1.55, 0.58), COTTO[0], bevel=0.02),
     box('wh_booth_win', (0.03, 0.3, 0.18), (0.36, -1.55, 0.34), GLASS, bevel=0.005)]
L_ = math.hypot(1.3, WZ)
b_ = math.atan2(1.3, WZ)
for sx in (-0.32, 0.32):
    for sy in (-1, 1):
        P.append(box('wh_leg', (0.07, 0.07, L_), (sx, sy * 0.65, WZ / 2), WHEEL_M, rot=(sy * b_, 0, 0), bevel=0.01))
    P.append(box('wh_brace', (0.04, 1.4, 0.04), (sx, 0, WZ * 0.4), WHEEL_M, bevel=0.005))
P.append(cyl('wh_axle', 0.05, 0.05, 0.75, (0, 0, WZ), WHEEL_M, seg=8, rot=(0, H, 0)))
stand = bake(P, 'far_wheel_stand', origin=(0, 0, 0))
stand.location = (WC.x, WC.y, TOP)
stand.rotation_euler = (0, 0, WROT)
for k in range(NG):
    a = k / NG * math.tau
    m = GONDOLA[k % len(GONDOLA)]
    P = [cyl('gd_hang', 0.012, 0.012, 0.14, (0, 0, -0.07), WHEEL_M, seg=6),
         cyl('gd_roof', 0.24, 0.03, 0.1, (0, 0, -0.17), m, seg=4, rot=(0, 0, math.pi / 4), bevel=0.01),
         box('gd_body', (0.26, 0.3, 0.24), (0, 0, -0.32), m, bevel=0.03),
         box('gd_win', (0.27, 0.31, 0.09), (0, 0, -0.29), GLASS, bevel=0.01)]
    g = bake(P, f'mover_gondola_{k}', origin=(0, 0, 0))
    g.location = (WC.x + math.sin(WROT) * math.sin(a) * WR, WC.y - math.cos(WROT) * math.sin(a) * WR, TOP + WZ + math.cos(a) * WR)
tile.mark_top(WC.x, WC.y, WR, TOP + WZ + WR + 0.4)

# ── 정원의 사이프러스·우산소나무, 가로등 ─────────────────────


def cypress(name, x, y, h):
    z = height(x, y) - 0.03
    P = [cyl(f'{name}_trunk', 0.04 * h, 0.03 * h, 0.15 * h, (x, y, z + 0.075 * h), TRUNK, seg=6),
         blob(f'{name}_crown', 0.13 * h, (x, y, z + 0.55 * h), CYPRESS, scale=(1, 1, 3.6), sub=2)]
    return bake(P, name, origin=(x, y, z))


def umbrella_pine(name, x, y, h):
    z = height(x, y) - 0.03
    lean = (rnd.random() - 0.5) * 0.25
    P = [cyl(f'{name}_trunk', 0.045 * h, 0.03 * h, 0.85 * h, (x + lean * 0.4 * h, y, z + 0.42 * h), TRUNK, seg=8, rot=(0, lean, 0))]
    sph = [((x + lean * 0.85 * h + math.cos(a) * 0.22 * h, y + math.sin(a) * 0.22 * h, z + 0.9 * h), 0.2 * h)
           for a in [k / 5 * math.tau + rnd.random() for k in range(5)]]
    sph.append(((x + lean * 0.85 * h, y, z + 0.95 * h), 0.22 * h))
    P.append(look.lumpy(f'{name}_crown', sph, UMBRELLA, 0.04 * h))
    return bake(P, name, origin=(x, y, z))


trees = 0
for i in range(4000):
    if trees >= 34:
        break
    x, y = tile.pick(W, D, 0.4)
    if not garden(x, y) or in_river(x) or abs(x - RX1) < 0.5 or abs(x - RX0) < 0.5:
        continue
    h = (1.0 + rnd.random() * 0.4) * 1.3
    if not tile.free(x, y, 0.3 if trees % 3 else 0.6, W, D, 0.4):
        continue
    if trees % 3 == 2:
        umbrella_pine(f'tree_{trees}', x, y, h * 1.2)
        block(x, y, 0.65)
    else:
        cypress(f'tree_{trees}', x, y, h * 1.25)
        block(x, y, 0.25)
    trees += 1
print('trees', trees, flush=True)
lamps = []
for k, p in enumerate(ring_points(RXR + RW / 2 + 0.3, RYR + RW / 2 + 0.3, 20)):
    if in_river(p.x) or not tile.free(p.x, p.y, 0.15, W, D):
        continue
    lamps.append(look.lantern(f'lamp_{k}', p.x, p.y))
    lamps[-1].scale = (1.4, 1.4, 1.4)

# ── 둘레 시가지: 제각각인 팔라초·탑집, 광장의 성당·돔·종탑, 강 다리, 언덕의 빌라·사이프러스·올리브 ─────
items, spots = [], []
Hr = lambda: COTTO[rnd.randrange(3)]
Wr = lambda: WALLS[rnd.randrange(len(WALLS))]
plazas = []
for sx in XS:
    for sy in YS:
        if sx == XS[0] and sy == YS[0]:
            continue
        x0, x1 = sx
        y0, y1 = sy
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if math.hypot(cx, cy) > CITY_R or corridor(cx, cy):
            continue
        if (cell(cx, cy, 5) % 5) == 0 and x1 - x0 > 4.5 and y1 - y0 > 4.5:
            plazas.append((cx, cy))  # 성당 광장
        for side in range(4):
            # 길을 따라 집을 잇는다(앞 = 길 쪽), 깊이·높이·지붕이 제각각
            t = (x0 if side < 2 else y0 + 1.2)
            b = (x1 if side < 2 else y1 - 1.2)
            while t < b - 0.6:
                w = min(1.0 + rnd.random() * 1.6, b - t)
                c = t + w / 2
                t += w
                dd = 1.1 + rnd.random() * 0.8
                if side < 2:
                    x, y, rot = c, (y0 + dd / 2 if side == 0 else y1 - dd / 2), (0.0 if side == 0 else math.pi)
                else:
                    x, y, rot = (x0 + dd / 2 if side == 2 else x1 - dd / 2), c, (-H if side == 2 else H)
                if corridor(x, y) or (abs(x) < W / 2 + 0.3 and abs(y) < D / 2 + 0.3) or belt(x, y) or rnd.random() < 0.22:
                    continue
                if rnd.random() < 0.04:
                    items.append((x, y, TOP - 0.02, 0.9, 0.9, 4.0 + rnd.random() * 1.5, 0.3, rot, RUSTIC, Hr(), 'hip'))
                    continue
                floors = rnd.randint(2, 5)
                items.append((x, y, TOP - 0.02, w - 0.04, dd, 0.7 + floors * 0.55, min(w, dd) * 0.28, rot, Wr(), Hr(),
                              'hip' if rnd.random() < 0.8 else 'gable'))
        if belt(cx, cy):
            # 공원: 우산소나무·사이프러스
            for k in range(int((x1 - x0) * (y1 - y0) / 2.2)):
                x, y = x0 + 0.7 + rnd.random() * (x1 - x0 - 1.4), y0 + 0.7 + rnd.random() * (y1 - y0 - 1.4)
                if belt(x, y) and not corridor(x, y) and (Vector((x, y)) - WC).length > 3.0:
                    spots.append((x, y, TOP - 0.03, 1.6 + rnd.random() * 0.6, ('umbrella', UMBRELLA) if k % 3 else ('cypress', CYPRESS)))
            continue
        for k in range(rnd.randint(0, 2)):
            x, y = x0 + 2.2 + rnd.random() * max(0.1, x1 - x0 - 4.4), y0 + 2.2 + rnd.random() * max(0.1, y1 - y0 - 4.4)
            spots.append((x, y, TOP - 0.03, 1.6 + rnd.random() * 0.6, ('cypress', CYPRESS) if k % 2 else ('umbrella', UMBRELLA)))
print('far houses', len(items), 'plazas', len(plazas), flush=True)

# 먼 성당들(광장 가운데): 줄무늬 정면 + 박공 본당 + 종탑, 일부는 돔
P = []
for k, (cx, cy) in enumerate(plazas[:10]):
    rot = (k % 2) * H
    Q = [box('far_ch_nave', (1.4, 2.6, 1.6), (0, 0, 0.8), MARBLE if k % 2 else WALLS[3], bevel=0),
         gable_prism('far_ch_roof', 1.4, 2.6, 1.6, 0.42, COTTO[k % 3], o=0.05),
         box('far_ch_front', (1.6, 0.1, 2.0), (0, -1.33, 1.0), MARBLE, bevel=0),
         box('far_ch_band', (1.62, 0.12, 0.08), (0, -1.33, 1.3), MARBLE_G, bevel=0),
         box('far_ch_tower', (0.5, 0.5, 3.4), (0.95, 0.8, 1.7), RUSTIC if k % 2 else MARBLE, bevel=0),
         cyl('far_ch_spire', 0.3, 0.02, 0.5, (0.95, 0.8, 3.65), COTTO[0], seg=4, rot=(0, 0, math.pi / 4))]
    if k % 3 == 0:
        dp = [(max(0.75 * math.cos(p) ** 0.75, 0.15), 2.3 + 1.1 * math.sin(p)) for p in [i / 5 * 1.36 for i in range(6)]]
        Q += [lathe('far_ch_drum', [(0.75, 1.5), (0.75, 2.3)], 8, MARBLE, R8, cap=False), lathe('far_ch_dome', dp, 8, DOME, R8),
              lathe('far_ch_lant', [(0.14, dp[-1][1]), (0.12, dp[-1][1] + 0.3)], 8, MARBLE, R8)]
        Q[-3].location.y = Q[-2].location.y = Q[-1].location.y = 0.9
    for q in Q:
        x_, y_ = q.location.x, q.location.y
        c, s = math.cos(rot), math.sin(rot)
        q.location = (cx + x_ * c - y_ * s, cy + x_ * s + y_ * c, q.location.z + TOP - 0.02)
        q.rotation_euler.z += rot
    P += Q
bake(P, 'far_churches_distant')

# 먼 언덕 위 요새(별 모양 성벽·모서리 보루·가운데 궁): 뒤쪽 언덕 능선의 랜드마크
FORT = Vector((-16.0, 52.0))
fz = hfar(FORT.x, FORT.y) - 0.3
P = [box('far_fort_wall', (7.0, 7.0, 1.6), (0, 0, 0.8), RUSTIC, bevel=0), box('far_fort_top', (6.4, 6.4, 1.7), (0, 0, 0.85), GRASS, bevel=0),
     box('far_fort_palace', (2.6, 1.8, 2.0), (0, 0.4, 2.6), WALLS[0], bevel=0)]
for sx in (-1, 1):
    for sy in (-1, 1):
        P.append(cyl('far_fort_bastion', 1.0, 1.2, 1.9, (sx * 3.5, sy * 3.5, 0.95), RUSTIC, seg=5, rot=(0, 0, math.atan2(sy, sx))))
P.append(hip_roof('far_fort_roof', 2.6, 1.8, 3.6, 0.6, COTTO[1]))
P[-1].location.y += 0.4
for q in P:
    q.location = (q.location.x + FORT.x, q.location.y + FORT.y, q.location.z + fz)
bake(P, 'far_fort_distant')
tile.mark_top(FORT.x, FORT.y, 5.0, fz + 4.3)

# 강을 건너는 먼 다리(길마다)
P = []
for sy in YS:
    for y in (sy[0] - 0.5, sy[1] + 0.5):
        if D / 2 + 0.5 < abs(y) < CITY_R:
            # 강을 똑바로 가로지르게 강 굽이만큼 돌린다
            rx, a = river_x(y), math.atan2(-(river_x(y + 0.1) - river_x(y - 0.1)) / 0.2, 1)
            c, s = math.cos(a), math.sin(a)
            P.append(box('far_bridge', (RX1 - RX0 + 0.6, 1.0, 0.18), (rx, y, TOP - 0.06), QUAY, rot=(0, 0, a), bevel=0))
            for s_ in (-1, 1):
                P.append(box('far_bridge_rail', (RX1 - RX0 + 0.6, 0.08, 0.14), (rx - s * s_ * 0.46, y + c * s_ * 0.46, TOP + 0.08), CURB,
                             rot=(0, 0, a), bevel=0))
bake(P, 'far_bridges')

# 언덕: 사이프러스 줄, 올리브 숲, 우산소나무, 빌라
for k in range(1400):
    a = rnd.random() * math.tau
    r = CITY_R + 4 + rnd.random() * 34
    x, y = math.cos(a) * r, math.sin(a) * r
    if abs(x - river_x(y)) < 4:
        continue
    z = hfar(x, y) - 0.05
    u = rnd.random()
    if u < 0.5:
        spots.append((x, y, z, 0.9 + rnd.random() * 0.3, ('bush', OLIVE)))
    elif u < 0.85:
        spots.append((x, y, z, 2.2 + rnd.random() * 0.8, ('cypress', CYPRESS)))
    else:
        spots.append((x, y, z, 2.4 + rnd.random() * 0.8, ('umbrella', UMBRELLA)))
for k in range(36):
    a = rnd.random() * math.tau
    r = CITY_R + 6 + rnd.random() * 26
    x, y = math.cos(a) * r, math.sin(a) * r
    if abs(x - river_x(y)) < 5:
        continue
    rot = rnd.random() * math.tau
    items.append((x, y, hfar(x, y) - 0.1, 2.2 + rnd.random(), 1.6 + rnd.random() * 0.6, 1.6 + rnd.random() * 0.6, 0.5, rot,
                  WALLS[rnd.choice((0, 3, 7))], Hr(), 'hip'))
    # 빌라로 오르는 사이프러스 길
    c, s = math.cos(rot), math.sin(rot)
    for j in range(1, 7):
        for e in (-1, 1):
            px, py = x + (-s * (1.6 + j * 0.9)) + c * e * 0.7, y + (c * (1.6 + j * 0.9)) + s * e * 0.7
            spots.append((px, py, hfar(px, py) - 0.05, 2.4, ('cypress', CYPRESS)))
print('far items', len(items), 'trees', len(spots), flush=True)
tile.far_houses('far_town', items)
tile.far_trees('far_trees', spots)

# 먼 성당(종탑·돔)도 카메라 높이 격자에 넣는다(먼 집·나무는 tile 이 넣는다)
for cx, cy in plazas[:10]:
    tile.mark_top(cx, cy, 2.0, TOP + 4.0)

setup_render((12.8 * 1.5, -14.4 * 1.5, 9.6 * 1.5), (0, 0, -0.6))

# 도로 중심선(앱 좌표): 차가 오른쪽 차선을 달리게 앱이 옆으로 비낀다
layout = {
    'ground': tile.heightmap(hfar),
    'paths': {'ring': [three(p, TOP + 0.02) for p in ROUTE[::3]], 'river': [three(Vector((MID, y)), LEVEL) for y in (-7.2, 0, 7.2)]},
    'lights': [three(WC, TOP + WZ), three(Vector((DX, NAVE_Y0 - 0.6)), 1.0), three(FT, 1.2), three(cafe[0], 1.0), three(Vector((MID, PV_Y)), 1.0)]
              + [three(o.location, 1.2) for o in lamps[::3]],
}

if MODE == 'glb':
    out = os.path.abspath(OUT)
    export_glb(os.path.join(out, 'city.glb'), lightmap=os.path.join(out, 'city_light.png'), samples=SAMPLES, layout=layout)
if MODE == 'preview':
    scene.render.filepath = os.path.join(OUT, 'preview.png')
    bpy.ops.render.render(write_still=True)
    print('done', flush=True)
