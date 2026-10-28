# 새 룩(레퍼런스 디오라마)의 모양들: 뭉게구름 나무, 돌 기단·기와 지붕 집, 이야기 있는 소품.
# 질감은 텍스처가 아니라 모양(돌 한 장, 기와 한 줄, 판자 한 장)으로 낸다. 모든 모서리는 둥글게.
import math
import bmesh
from mathutils import Matrix, Vector
import lib
from lib import (CLOTH_R, CLOTH_W, DARKWOOD, FIRE, GLASS, HAY, LEAF, PATH, PINE, PLASTER, PUMPKIN, ROCK, STONE, TILE, TRUNK, WOOD,
                 bake, blob, block, box, catmull, cyl, finish, mat, new_obj, rnd)

SKIN = mat('skin', '#e9b994', 0.8, 0.03)
HAIR = mat('hair', '#5a3a28', 0.85, 0.05)
CLOTH_B = mat('cloth_b', '#5f7f9c', 0.95, 0.03)
CLOTH_G = mat('cloth_g', '#7d9670', 0.95, 0.03)
PANTS = mat('pants', '#4d4640', 0.95, 0.03)


def surface(x, y):
    return lib.surface(x, y)


def lumpy(name, spheres, m, voxel, smooth=6, keep=0.3):
    """구 여러 개를 하나로 녹여 뭉게뭉게한 덩어리로(복셀로 다시 짜고 다듬은 뒤 면 수를 줄인다)"""
    bm = bmesh.new()
    for (cx, cy, cz), r in spheres:
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=r, matrix=Matrix.Translation((cx, cy, cz)))
    o = new_obj(name, bm)
    rm = o.modifiers.new('remesh', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = voxel
    sm = o.modifiers.new('smooth', 'SMOOTH')
    sm.factor = 0.6
    sm.iterations = smooth
    dc = o.modifiers.new('decimate', 'DECIMATE')
    dc.ratio = keep
    return finish(o, m)


# ── 나무 ─────────────────────────────────────────────

def trunk(name, x, y, z, h, branches=2):
    P = [cyl(f'{name}_trunk', 0.075 * h, 0.045 * h, 0.8 * h, (x, y, z + 0.4 * h), TRUNK, seg=10, bevel=0.012)]
    for k in range(branches):
        a = rnd.random() * math.tau
        P.append(cyl(f'{name}_br{k}', 0.032 * h, 0.018 * h, 0.32 * h, (x + math.cos(a) * 0.07 * h, y + math.sin(a) * 0.07 * h, z + 0.62 * h),
                     TRUNK, seg=6, rot=(math.cos(a + 1.57) * 0.75, math.sin(a + 1.57) * 0.75, 0)))
    return P


def cloud_tree(name, x, y, h, leaf):
    """뭉게구름 나무: 둥근 덩어리 서너 개가 모인 잎"""
    z = surface(x, y) - 0.03
    P = trunk(name, x, y, z, h)
    cz = z + 0.98 * h
    sph = []
    clumps = rnd.randint(3, 4)
    for k in range(clumps):
        a = k / clumps * math.tau + rnd.random() * 0.6
        d = 0.2 * h
        c = Vector((x + math.cos(a) * d, y + math.sin(a) * d, cz + (rnd.random() - 0.4) * 0.16 * h))
        cr = (0.24 + rnd.random() * 0.06) * h
        sph.append((tuple(c), cr))
        # 덩어리마다 작은 혹
        for j in range(4):
            b = rnd.random() * math.tau
            e = rnd.random() * 0.9 - 0.2
            off = Vector((math.cos(b) * math.cos(e), math.sin(b) * math.cos(e), math.sin(e))) * cr * 0.8
            sph.append((tuple(c + off), cr * (0.45 + rnd.random() * 0.15)))
    sph.append(((x, y, cz + 0.22 * h), 0.27 * h))
    P.append(lumpy(f'{name}_crown', sph, LEAF[leaf], 0.035 * h))
    return bake(P, name, origin=(x, y, z))


def oval_tree(name, x, y, h, leaf):
    """길쭉한 달걀 모양 나무(위로 갈수록 좁다)"""
    z = surface(x, y) - 0.03
    P = trunk(name, x, y, z, h, branches=1)
    sph = []
    for k in range(5):
        t = k / 4
        r = (0.26 - t * 0.12) * h
        sph.append(((x + (rnd.random() - 0.5) * 0.04 * h, y + (rnd.random() - 0.5) * 0.04 * h, z + (0.72 + t * 0.62) * h), r))
    for j in range(5):
        b = rnd.random() * math.tau
        sph.append(((x + math.cos(b) * 0.16 * h, y + math.sin(b) * 0.16 * h, z + (0.75 + rnd.random() * 0.45) * h), 0.13 * h))
    P.append(lumpy(f'{name}_crown', sph, LEAF[leaf], 0.03 * h))
    return bake(P, name, origin=(x, y, z))


def pine(name, x, y, h):
    """층층이 쌓인 둥근 원뿔 전나무"""
    z = surface(x, y) - 0.03
    P = [cyl(f'{name}_trunk', 0.06 * h, 0.04 * h, 0.35 * h, (x, y, z + 0.17 * h), TRUNK, seg=8)]
    for k in range(4):
        t = k / 4
        r = (0.4 - t * 0.27) * h
        dz = z + (0.28 + t * 0.58) * h
        P.append(cyl(f'{name}_t{k}', r, r * 0.08, 0.46 * h, (x, y, dz + 0.23 * h), PINE, seg=16, bevel=0.03 * h))
    return bake(P, name, origin=(x, y, z))


# ── 집 ───────────────────────────────────────────────

def stone_band(P, name, w, d, z0, rows, rh, m=STONE):
    """벽 둘레에 돌을 한 장씩 쌓는다(줄마다 엇갈리게)"""
    for side in range(4):
        L = w if side % 2 == 0 else d
        out = (d if side % 2 == 0 else w) / 2
        ry = side * math.pi / 2
        c, s = math.cos(ry), math.sin(ry)
        for r in range(rows):
            x = -L / 2 - (0.06 if r % 2 else 0)
            while x < L / 2:
                sw = min(0.13 + rnd.random() * 0.1, L / 2 - x + 0.02)
                cx = x + sw / 2
                if sw > 0.04:
                    dx, dy = cx, -out - 0.012
                    P.append(box(f'{name}_st', (sw - 0.018, 0.05, rh - 0.018), (dx * c - dy * s, dx * s + dy * c, z0 + r * rh + rh / 2), m,
                                 rot=(0, 0, ry), bevel=0.014, seg=2))
                x += sw


# True 면 기와를 한 장씩 대신 줄마다 긴 띠 하나로 얹는다(집이 많은 도시: 삼각형을 크게 줄인다)
ROW_ROOF = False


def tile_roof(P, name, w, d, top, pitch, m=TILE):
    """기와 지붕: 줄마다 기와를 한 장씩 얹어 줄과 칸이 모양으로 보이게(ROW_ROOF 면 줄만)"""
    over = 0.16
    slope = (w / 2 + over) / math.cos(pitch)
    rise = (w / 2) * math.tan(pitch)
    rows = max(4, round(slope / 0.12))
    cols = max(5, round((d + 0.3) / 0.13))
    tw, th = (d + 0.3) / cols, slope / rows
    for sx in (-1, 1):
        th_ = sx * pitch
        cx, zc = sx * (w / 4 + over / 2) * 0.98, top + rise / 2 - 0.02
        # 기와 밑판
        P.append(box(f'{name}_deck', (slope, d + 0.3, 0.05), (cx, 0, zc), DARKWOOD, rot=(0, th_, 0), bevel=0.01, seg=1))
        for r in range(rows):
            lx = -slope / 2 + (r + 0.5) * th
            if ROW_ROOF:
                lz = 0.045
                px = cx + lx * math.cos(th_) + lz * math.sin(th_)
                pz = zc - lx * math.sin(th_) + lz * math.cos(th_)
                P.append(box(f'{name}_tile', (th * 1.04, d + 0.26, 0.04), (px, 0, pz), m, rot=(0, th_, 0), bevel=0.013, seg=1))
                continue
            for k in range(cols):
                v = -(d + 0.3) / 2 + (k + 0.5) * tw + (tw / 2 if r % 2 else 0)
                if abs(v) > (d + 0.3) / 2 - tw * 0.3:
                    continue
                # 밑판 좌표(lx, 위로 lz)를 지붕 기울기만큼 돌려 놓는다
                lz = 0.045
                px = cx + lx * math.cos(th_) + lz * math.sin(th_)
                pz = zc - lx * math.sin(th_) + lz * math.cos(th_)
                P.append(box(f'{name}_tile', (th * 1.04, tw - 0.014, 0.04), (px, v, pz), m, rot=(0, th_, 0), bevel=0.013, seg=1))
    P.append(cyl(f'{name}_ridge', 0.05, 0.05, d + 0.34, (0, 0, top + rise + 0.03), m, seg=12, rot=(math.pi / 2, 0, 0)))
    return rise


def house(name, x, y, rot, w, d, h, roof=TILE):
    """돌 기단 + 크림 회벽 + 기와 지붕 집(앞 = -y)"""
    P = []
    base_h = h * 0.38
    P.append(box(f'{name}_core', (w - 0.02, d - 0.02, base_h), (0, 0, base_h / 2), STONE, bevel=0.02))
    stone_band(P, name, w, d, 0.0, 3, base_h / 3)
    P.append(box(f'{name}_wall', (w, d, h - base_h), (0, 0, base_h + (h - base_h) / 2), PLASTER, bevel=0.03, seg=3))
    top = h
    pitch = math.radians(40)
    rise = tile_roof(P, name, w, d, top, pitch, roof)
    # 박공(삼각 벽)
    for sy in (-1, 1):
        bm = bmesh.new()
        vs = [bm.verts.new(v) for v in ((-w / 2, 0, 0), (w / 2, 0, 0), (0, 0, rise))]
        f = bm.faces.new(vs)
        bmesh.ops.solidify(bm, geom=[f], thickness=0.04)
        g = new_obj(f'{name}_gable', bm)
        g.location = (0, sy * d / 2, top)
        P.append(finish(g, PLASTER, smooth=False))
    # 굴뚝(돌)
    cx, cy = w * 0.22, d * 0.18
    for k in range(5):
        P.append(box(f'{name}_chim', (0.22, 0.22, 0.1), (cx, cy, top + rise * 0.45 + k * 0.1 + 0.05), STONE, rot=(0, 0, (k % 2) * 0.08), bevel=0.02))
    # 문: 판자
    for k in range(4):
        P.append(box(f'{name}_door', (0.075, 0.04, 0.48), (-0.115 + k * 0.077, -d / 2 - 0.02, 0.26), WOOD, bevel=0.01, seg=1))
    P.append(box(f'{name}_lintel', (0.4, 0.05, 0.06), (0, -d / 2 - 0.025, 0.53), DARKWOOD, bevel=0.012))
    P.append(box(f'{name}_step', (0.42, 0.18, 0.06), (0, -d / 2 - 0.1, 0.03), STONE, bevel=0.02))

    def window(cx, cy, cz, ry):
        rot = (0, 0, ry)
        c, s = math.cos(ry), math.sin(ry)
        off = lambda dx, dy, dz=0: (cx + dx * c - dy * s, cy + dx * s + dy * c, cz + dz)
        P.append(box(f'{name}_glass', (0.18, 0.03, 0.2), off(0, 0), GLASS, rot=rot, bevel=0.005))
        P.append(box(f'{name}_frame', (0.24, 0.025, 0.26), off(0, 0.008), DARKWOOD, rot=rot, bevel=0.008))
        P.append(box(f'{name}_mull', (0.02, 0.035, 0.2), off(0, -0.004), DARKWOOD, rot=rot, bevel=0))
        P.append(box(f'{name}_sill', (0.28, 0.07, 0.03), off(0, -0.03, -0.13), STONE, rot=rot, bevel=0.01))

    wz = base_h + (h - base_h) * 0.5
    for sx in (-1, 1):
        window(sx * w * 0.27, -d / 2 - 0.02, wz, 0)
        window(sx * w * 0.27, d / 2 + 0.02, wz, math.pi)
    window(w / 2 + 0.02, 0, wz, math.pi / 2)
    window(-w / 2 - 0.02, 0, wz, -math.pi / 2)
    o = bake(P, name, origin=(0, 0, 0))
    o.location = (x, y, surface(x, y) - 0.03)
    o.rotation_euler = (0, 0, rot)
    block(x, y, max(w, d) * 1.1)
    return o


# ── 소품 ─────────────────────────────────────────────

def place(o, x, y, rot=0.0, r=0.3):
    o.location = (x, y, surface(x, y) - 0.01)
    o.rotation_euler = (0, 0, rot)
    block(x, y, r)
    return o


def crate(name, loc, s=0.16):
    P = [box(f'{name}_c', (s, s, s), loc, WOOD, bevel=0.012)]
    for dz in (-s * 0.32, s * 0.32):
        P.append(box(f'{name}_band', (s + 0.01, s + 0.01, 0.025), (loc[0], loc[1], loc[2] + dz), DARKWOOD, bevel=0.005))
    return P


def market_stall(x, y, rot):
    """노점: 기둥 넷, 판매대, 줄무늬 차양, 상자에 담긴 호박·사과"""
    P = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(cyl('stall_post', 0.03, 0.03, 0.95 if sy < 0 else 1.1, (sx * 0.5, sy * 0.3, (0.95 if sy < 0 else 1.1) / 2), WOOD, seg=8))
    P.append(box('stall_counter', (1.1, 0.4, 0.07), (0, -0.12, 0.5), WOOD, bevel=0.015))
    P.append(box('stall_front', (1.06, 0.04, 0.42), (0, -0.31, 0.27), DARKWOOD, bevel=0.01))
    for k in range(8):
        P.append(box('stall_awn', (0.145, 0.82, 0.02), (-0.51 + k * 0.146, 0, 1.03), CLOTH_R if k % 2 else CLOTH_W, rot=(-0.28, 0, 0), bevel=0.006))
    for k in range(3):
        cx = -0.33 + k * 0.33
        P += crate('stall_crate', (cx, -0.12, 0.6), 0.2)
        for j in range(3):
            P.append(blob('stall_fruit', 0.045, (cx + (j - 1) * 0.055, -0.12 + (j % 2) * 0.04, 0.72), PUMPKIN if k != 1 else CLOTH_R, sub=2))
    P += crate('stall_crate2', (0.75, 0.1, 0.09), 0.18)
    P += crate('stall_crate3', (0.72, -0.2, 0.08), 0.16)
    return place(bake(P, 'stall', origin=(0, 0, 0)), x, y, rot, 0.8)


def bench(name, x, y, rot):
    P = [box(f'{name}_seat{k}', (0.6, 0.07, 0.03), (0, -0.04 + k * 0.08, 0.2), WOOD, bevel=0.01) for k in range(2)]
    P.append(box(f'{name}_back', (0.6, 0.03, 0.12), (0, 0.1, 0.33), WOOD, rot=(0.2, 0, 0), bevel=0.01))
    for sx in (-0.25, 0.25):
        P.append(box(f'{name}_leg', (0.05, 0.2, 0.2), (sx, 0.02, 0.1), DARKWOOD, bevel=0.01))
    return place(bake(P, name, origin=(0, 0, 0)), x, y, rot, 0.35)


def campfire(x, y):
    """모닥불: 돌 고리, 엇갈린 장작, 불꽃(밤에 앱이 불빛을 얹는다)"""
    P = []
    for k in range(9):
        a = k / 9 * math.tau
        P.append(blob('fire_stone', 0.075, (math.cos(a) * 0.26, math.sin(a) * 0.26, 0.04), ROCK, scale=(1.2, 1, 0.75), sub=2))
    for k in range(3):
        a = k / 3 * math.pi
        P.append(cyl('fire_log', 0.035, 0.035, 0.36, (0, 0, 0.07), WOOD, seg=8, rot=(math.pi / 2, 0, a), bevel=0.01))
    P.append(blob('fire_flame', 0.1, (0, 0, 0.15), FIRE, scale=(1, 1, 1.5), sub=2))
    return place(bake(P, 'campfire', origin=(0, 0, 0)), x, y, 0, 0.4)


def signpost(x, y, rot):
    P = [cyl('sign_post', 0.03, 0.03, 0.75, (0, 0, 0.375), WOOD, seg=8, bevel=0.005)]
    for k, (z, a) in enumerate(((0.62, 0.3), (0.48, -0.5))):
        P.append(box('sign_board', (0.34, 0.03, 0.09), (0.12 * math.cos(a), 0.12 * math.sin(a), z), WOOD, rot=(0, 0, a), bevel=0.01))
    return place(bake(P, 'signpost', origin=(0, 0, 0)), x, y, rot, 0.2)


def barrel(name, x, y):
    P = [cyl(f'{name}_b', 0.11, 0.11, 0.26, (0, 0, 0.13), WOOD, seg=14, bevel=0.03)]
    for z in (0.05, 0.21):
        P.append(cyl(f'{name}_ring', 0.115, 0.115, 0.02, (0, 0, z), DARKWOOD, seg=14))
    return place(bake(P, name, origin=(0, 0, 0)), x, y, 0, 0.15)


def fence_line(name, pts, gate=None):
    """곧은 울타리(점들을 잇는다). gate 번째 칸은 비운다"""
    P = []
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        n = max(1, round((b - a).length / 0.45))
        for k in range(n):
            p = a.lerp(b, k / n)
            P.append(box(f'{name}_p', (0.06, 0.06, 0.34), (p.x, p.y, surface(p.x, p.y) + 0.15), WOOD, bevel=0.015))
        if gate == i:
            continue
        mid = (a + b) / 2
        ang = math.atan2(b.y - a.y, b.x - a.x)
        for zz in (0.13, 0.26):
            P.append(box(f'{name}_r', ((b - a).length + 0.04, 0.035, 0.045), (mid.x, mid.y, surface(mid.x, mid.y) + zz), WOOD,
                         rot=(0, 0, ang), bevel=0.01))
    P.append(box(f'{name}_p', (0.06, 0.06, 0.34), (pts[-1][0], pts[-1][1], surface(*pts[-1]) + 0.15), WOOD, bevel=0.015))
    return bake(P, name)


def path(name, pts, width=0.3):
    """흙길: 땅 위에 얇게 깐 띠"""
    pts = catmull([Vector(p) for p in pts], 8)
    bm = bmesh.new()
    L, Rr = [], []
    for i, p in enumerate(pts):
        tan = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = Vector((-tan.y, tan.x)) * width / 2 * (0.85 + 0.3 * rnd.random())
        L.append(bm.verts.new((p.x + side.x, p.y + side.y, surface(p.x + side.x, p.y + side.y) + 0.008)))
        Rr.append(bm.verts.new((p.x - side.x, p.y - side.y, surface(p.x - side.x, p.y - side.y) + 0.008)))
    for i in range(len(pts) - 1):
        bm.faces.new([L[i], Rr[i], Rr[i + 1], L[i + 1]])
    return finish(new_obj(name, bm), PATH)


def boulder(name, x, y, s):
    o = blob(name, s, (x, y, surface(x, y) + s * 0.15), ROCK, scale=(1.25, 1, 0.7), sub=3, disp=0.12 * s, disp_size=1.2 * s)
    o.rotation_euler = (0, 0, rnd.random() * math.tau)
    block(x, y, s)
    return o


def haystack(name, x, y):
    o = blob(name, 0.22, (x, y, surface(x, y) + 0.12), HAY, scale=(1, 1, 1.1), sub=3, disp=0.03, disp_size=0.08)
    block(x, y, 0.28)
    return o


def lookout(x, y, ang):
    """섬 끝에 튀어나온 나무 전망대(난간 + 망원경)"""
    P = []
    for k in range(7):
        P.append(box('deck_plank', (1.3, 0.12, 0.04), (0.45, -0.39 + k * 0.13, 0.0), WOOD, bevel=0.012, seg=1))
    for sx in (0.0, 1.05):
        for sy in (-0.42, 0.42):
            P.append(cyl('deck_post', 0.03, 0.03, 0.4, (sx, sy, 0.2), DARKWOOD, seg=8))
    for sy in (-0.42, 0.42):
        P.append(box('deck_rail', (1.1, 0.035, 0.035), (0.52, sy, 0.38), DARKWOOD, bevel=0.008))
    P.append(box('deck_rail', (0.035, 0.88, 0.035), (1.06, 0, 0.38), DARKWOOD, bevel=0.008))
    for k in range(3):
        P.append(cyl('deck_beam', 0.035, 0.035, 0.7, (0.2 + k * 0.4, 0, -0.3), DARKWOOD, seg=8, rot=(0, -0.6, 0)))
    P.append(cyl('scope', 0.03, 0.04, 0.3, (0.8, 0.0, 0.5), DARKWOOD, seg=10, rot=(0, 1.2, 0)))
    P.append(cyl('scope_leg', 0.012, 0.012, 0.45, (0.8, 0.0, 0.22), DARKWOOD, seg=6))
    o = bake(P, 'lookout', origin=(0, 0, 0))
    o.location = (x, y, surface(x, y) + 0.02)
    o.rotation_euler = (0, 0, ang)
    block(x, y, 0.5)
    return o


def villager(name, x, y, rot, shirt=CLOTH_B, hat=False, pose='stand'):
    """마을 사람: 다리 둘, 통통한 몸통, 팔, 둥근 머리(모자 또는 머리카락). pose: stand·sit·wave"""
    sit = pose == 'sit'
    z0 = 0.2 if sit else 0.0
    P = []
    for s in (-1, 1):
        if sit:
            P.append(cyl(f'{name}_thigh', 0.032, 0.03, 0.16, (0.07, s * 0.045, 0.21), PANTS, seg=8, rot=(0, math.pi / 2, 0)))
            P.append(cyl(f'{name}_shin', 0.03, 0.028, 0.2, (0.15, s * 0.045, 0.1), PANTS, seg=8))
        else:
            P.append(cyl(f'{name}_leg', 0.032, 0.028, 0.2, (0, s * 0.045, 0.1), PANTS, seg=8))
    P.append(cyl(f'{name}_body', 0.075, 0.095, 0.24, (0, 0, z0 + 0.32), shirt, seg=14, bevel=0.03))
    for s in (-1, 1):
        up = pose == 'wave' and s > 0
        P.append(cyl(f'{name}_arm', 0.024, 0.022, 0.19, (0, s * 0.11, z0 + (0.46 if up else 0.32)), shirt, seg=8,
                     rot=(s * (2.6 if up else 0.18), 0, 0)))
        P.append(blob(f'{name}_hand', 0.026, (0, s * (0.14 if up else 0.125), z0 + (0.56 if up else 0.22)), SKIN, sub=1))
    P.append(blob(f'{name}_head', 0.075, (0, 0, z0 + 0.53), SKIN, sub=2))
    if hat:
        P.append(cyl(f'{name}_brim', 0.11, 0.11, 0.015, (0, 0, z0 + 0.58), HAY, seg=14))
        P.append(cyl(f'{name}_crown', 0.06, 0.07, 0.06, (0, 0, z0 + 0.61), HAY, seg=12, bevel=0.01))
    else:
        P.append(blob(f'{name}_hair', 0.078, (-0.012, 0, z0 + 0.56), HAIR, scale=(1, 1, 0.75), sub=2))
    o = bake(P, name, origin=(0, 0, 0))
    o.location = (x, y, surface(x, y) - 0.01)
    o.rotation_euler = (0, 0, rot)
    return o


def rowboat(name, x, y, z, rot):
    """나룻배: 둥근 선체, 안쪽 바닥, 가로 좌석, 노 둘"""
    P = [blob(f'{name}_hull', 0.3, (0, 0, 0.06), WOOD, scale=(1.6, 0.62, 0.38), sub=3)]
    P.append(blob(f'{name}_in', 0.27, (0, 0, 0.11), DARKWOOD, scale=(1.55, 0.55, 0.22), sub=3))
    P.append(box(f'{name}_seat', (0.06, 0.34, 0.03), (0.05, 0, 0.14), WOOD, bevel=0.008))
    for s in (-1, 1):
        P.append(cyl(f'{name}_oar', 0.012, 0.012, 0.6, (-0.05, s * 0.2, 0.13), WOOD, seg=6, rot=(0, math.pi / 2, s * 0.35)))
    o = bake(P, name, origin=(0, 0, 0))
    o.location = (x, y, z)
    o.rotation_euler = (0, 0, rot)
    return o


def jetty(x, y, rot, n=5):
    """물가 나무 선착장: 판자 n장, 말뚝, 끝에 낚싯대 통"""
    P = []
    for k in range(n):
        P.append(box('jetty_plank', (0.13, 0.5, 0.04), (k * 0.14, 0, 0.06), WOOD, bevel=0.012, seg=1))
    for k in (0, n - 1):
        for s in (-1, 1):
            P.append(cyl('jetty_pile', 0.035, 0.035, 0.3, (k * 0.14, s * 0.24, 0.0), DARKWOOD, seg=8))
    P += crate('jetty_box', (0.1, 0.12, 0.16), 0.14)
    o = bake(P, 'jetty', origin=(0, 0, 0))
    o.location = (x, y, surface(x, y))
    o.rotation_euler = (0, 0, rot)
    block(x, y, 0.4)
    return o


def lantern(name, x, y):
    """길가 등불: 돌 받침, 가는 기둥, 지붕 있는 등(밤에 불빛)"""
    P = [cyl(f'{name}_base', 0.07, 0.08, 0.08, (0, 0, 0.04), STONE, seg=10, bevel=0.015),
         cyl(f'{name}_post', 0.022, 0.026, 0.7, (0, 0, 0.42), DARKWOOD, seg=8),
         box(f'{name}_lamp', (0.1, 0.1, 0.13), (0, 0, 0.82), GLASS, bevel=0.012),
         cyl(f'{name}_roof', 0.1, 0.02, 0.09, (0, 0, 0.93), DARKWOOD, seg=4, rot=(0, 0, math.pi / 4))]
    return place(bake(P, name, origin=(0, 0, 0)), x, y, 0, 0.15)


def stilt_hut(x, y, rot):
    """물가 낚시 오두막: 말뚝 위 판자 마루, 판자 벽, 기와 지붕, 문·창, 사다리, 통"""
    P = []
    deck = 0.32
    for i in range(10):
        P.append(box('hut_plank', (0.14, 1.3, 0.04), (-0.7 + i * 0.155, 0, deck), WOOD, bevel=0.012, seg=1))
    for sx in (-0.7, 0.0, 0.7):
        for sy in (-0.58, 0.58):
            P.append(cyl('hut_pile', 0.045, 0.05, 0.6, (sx, sy, deck - 0.3), DARKWOOD, seg=8))
    w, d, h = 0.95, 0.8, 0.62
    P.append(box('hut_core', (w - 0.04, d - 0.04, h), (0.15, 0.1, deck + h / 2), WOOD, bevel=0.02))
    for k in range(7):
        P.append(box('hut_board', (0.12, 0.03, h), (0.15 - w / 2 + 0.07 + k * 0.135, 0.1 - d / 2, deck + h / 2), DARKWOOD if k % 3 == 0 else WOOD,
                     bevel=0.008, seg=1))
    Q = []
    rise = tile_roof(Q, 'hut', w + 0.1, d + 0.1, h, math.radians(38))
    for q in Q:
        q.location.x += 0.15
        q.location.y += 0.1
        q.location.z += deck
    P += Q
    for sy in (-1, 1):
        bm = bmesh.new()
        vs = [bm.verts.new(v) for v in ((-(w + 0.1) / 2, 0, 0), ((w + 0.1) / 2, 0, 0), (0, 0, rise))]
        bmesh.ops.solidify(bm, geom=[bm.faces.new(vs)], thickness=0.04)
        g = new_obj('hut_gable', bm)
        g.location = (0.15, 0.1 + sy * (d + 0.1) / 2, deck + h)
        P.append(finish(g, WOOD, smooth=False))
    P.append(box('hut_door', (0.26, 0.04, 0.44), (-0.05, 0.1 - d / 2 - 0.03, deck + 0.22), DARKWOOD, bevel=0.01))
    P.append(box('hut_glass', (0.18, 0.03, 0.16), (0.38, 0.1 - d / 2 - 0.035, deck + 0.4), GLASS, bevel=0.005))
    P.append(box('hut_frame', (0.24, 0.025, 0.22), (0.38, 0.1 - d / 2 - 0.025, deck + 0.4), DARKWOOD, bevel=0.006))
    for k in range(4):
        P.append(box('hut_rung', (0.3, 0.03, 0.03), (-0.75, -0.62, deck - 0.08 - k * 0.1), WOOD, bevel=0.005))
    P += crate('hut_crate', (-0.5, -0.4, deck + 0.09), 0.16)
    P.append(cyl('hut_barrel', 0.1, 0.1, 0.24, (-0.5, 0.35, deck + 0.12), WOOD, seg=12, bevel=0.025))
    o = bake(P, 'stilt_hut', origin=(0, 0, 0))
    o.location = (x, y, surface(x, y))
    o.rotation_euler = (0, 0, rot)
    block(x, y, 1.0)
    return o


CROP = mat('crop', '#7f9a50', 0.95, 0.08, 6.0)


def crop_field(name, x, y, rot, rows=5, cols=7):
    """밭: 흙 바닥 위 이랑마다 채소 포기, 한 줄은 호박"""
    P = [box(f'{name}_soil', (cols * 0.32 + 0.2, rows * 0.36 + 0.1, 0.06), (0, 0, 0.0), lib.DIRT, bevel=0.03)]
    for r in range(rows):
        yy = (r - (rows - 1) / 2) * 0.36
        P.append(box(f'{name}_ridge', (cols * 0.32, 0.16, 0.05), (0, yy, 0.04), lib.DIRT, bevel=0.025))
        for c in range(cols):
            xx = (c - (cols - 1) / 2) * 0.32
            if r == 2:
                P.append(blob(f'{name}_pump', 0.09, (xx, yy, 0.12), PUMPKIN, scale=(1.15, 1.15, 0.85), sub=2))
            else:
                P.append(blob(f'{name}_leaf', 0.1, (xx, yy, 0.12), CROP, scale=(1, 1, 0.8), sub=2))
    return place(bake(P, name, origin=(0, 0, 0)), x, y, rot, max(rows * 0.36, cols * 0.32) * 0.6)


# ── 탈것 ─────────────────────────────────────────────
CAR_GLASS = mat('car_glass', '#3b4752', 0.25, 0.02)
TIRE = mat('tire', '#2e2e32', 0.9, 0.03)


def car(name, color, kind='hatch'):
    """작은 자동차(앞 = +x, 기준점 = 바닥 가운데). kind: hatch·van. 앱이 길을 따라 움직인다(mover_)"""
    body = mat(f'car_{color}', color, 0.45, 0.04)
    van = kind == 'van'
    L, Wd = (0.95, 0.46) if not van else (1.05, 0.48)
    P = [box(f'{name}_body', (L, Wd, 0.2), (0, 0, 0.17), body, bevel=0.06, seg=3)]
    cl, cx = (0.52, -0.06) if not van else (0.8, -0.1)
    P.append(box(f'{name}_cab', (cl, Wd - 0.06, 0.2 if not van else 0.26), (cx, 0, 0.35 if not van else 0.38), body, bevel=0.06, seg=3))
    # 유리: 앞·뒤·옆
    P.append(box(f'{name}_wf', (0.04, Wd - 0.12, 0.13), (cx + cl / 2 - 0.005, 0, 0.36), CAR_GLASS, rot=(0, -0.35, 0), bevel=0.01))
    P.append(box(f'{name}_wb', (0.04, Wd - 0.12, 0.12), (cx - cl / 2 + 0.005, 0, 0.36), CAR_GLASS, rot=(0, 0.3, 0), bevel=0.01))
    for s in (-1, 1):
        P.append(box(f'{name}_ws', (cl - 0.14, 0.03, 0.12), (cx, s * (Wd / 2 - 0.025), 0.37), CAR_GLASS, bevel=0.01))
        for wx in (L / 2 - 0.2, -L / 2 + 0.2):
            P.append(cyl(f'{name}_tire', 0.1, 0.1, 0.08, (wx, s * (Wd / 2 - 0.02), 0.1), TIRE, seg=14, rot=(math.pi / 2, 0, 0), bevel=0.02))
            P.append(cyl(f'{name}_hub', 0.045, 0.045, 0.09, (wx, s * (Wd / 2 - 0.02), 0.1), STONE, seg=10, rot=(math.pi / 2, 0, 0)))
        P.append(box(f'{name}_head', (0.03, 0.08, 0.05), (L / 2 + 0.005, s * 0.15, 0.2), GLASS, bevel=0.01))
        P.append(box(f'{name}_tail', (0.03, 0.07, 0.04), (-L / 2 - 0.005, s * 0.16, 0.21), CLOTH_R, bevel=0.01))
    P.append(box(f'{name}_bump', (0.06, Wd + 0.02, 0.06), (L / 2, 0, 0.1), STONE, bevel=0.02))
    P.append(box(f'{name}_bumpb', (0.06, Wd + 0.02, 0.06), (-L / 2, 0, 0.1), STONE, bevel=0.02))
    return bake(P, name, origin=(0, 0, 0))
