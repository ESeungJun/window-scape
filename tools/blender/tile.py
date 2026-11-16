# 사각 디오라마 타일 공용 도구(드라이브·도시·성·숲). 레퍼런스 디오라마처럼 네모난 땅 조각을 잘라 낸 모양:
# 높이 함수로 빚은 윗면(칸마다 재질), 지층이 드러난 옆면, 물이 있으면 옆면에 물 단면, 아래로 좁아지는 바위 밑동.
# 땅에 놓인 테마(ground=True)는 옆면·밑동 대신 surround 로 타일 둘레를 지평선까지 이어 붙인다(far_*: 굽지 않는 먼 풍경).
# 타일 축은 Blender x·y 와 같다. 앱 기본 시점이 대각선(CAM ≈ (0.66, -0.75))이라 모서리 하나가 카메라를 향한다.
# 물(liquid_)과 움직이는 것(mover_)은 앱이 따로 그린다(lib.dynamic).
import math
import bmesh
from mathutils import Matrix, Vector
import lib
from lib import CLIFF, CLIFF_LEDGE, blob, finish, mat, new_obj, rnd

SHADOW_R = 18.0  # 앱 그림자 범위(world.ts 땅 테마 ±16)를 조금 넘는 반지름
# 먼 나무·집 꼭대기 높이(1 간격 격자). heightmap 이 땅 높이와 함께 넣어 앱 카메라가 그 속으로 파고들지 않게 한다
TOPS = {}


def mark_top(x, y, r, h, half=40.0):
    """(x, y) 둘레 반지름 r(+ 두 칸)의 격자점에 꼭대기 높이 h 를 남긴다(바로 옆 나무·집 위로도 카메라가 뜨게)"""
    if abs(x) > half + r + 2 or abs(y) > half + r + 2:
        return
    r += 2.0
    for gx in range(math.floor(x - r), math.ceil(x + r) + 1):
        for gy in range(math.floor(y - r), math.ceil(y + r) + 1):
            if (gx - x) ** 2 + (gy - y) ** 2 <= r * r and TOPS.get((gx, gy), -9.0) < h:
                TOPS[(gx, gy)] = h
WATER_SIDE = mat('water_side', '#4f9cc4', 0.3, 0.04, 2.0)


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
    return (p - (a + ab * t)).length


def poly_dist(p, pts):
    """점 p 에서 꺾은선 pts 까지 거리"""
    p = Vector(p)
    return min(seg_dist(p, pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def build(W, D, height, paint, water=None, step=0.2, depth=1.5, under=4.0, top_mat=lib.GRASS, ground=False):
    """W×D 타일. height(x, y) -> 윗면 높이, paint(x, y, z) -> 재질. water: 수면 높이(없으면 None).
    ground: 둘레를 surround 로 잇는 땅 테마(옆면·밑동을 만들지 않는다)"""
    nx, ny = round(W / step), round(D / step)
    xs = [-W / 2 + W * i / nx for i in range(nx + 1)]
    ys = [-D / 2 + D * j / ny for j in range(ny + 1)]
    H = [[height(x, y) for y in ys] for x in xs]

    # 윗면
    bm = bmesh.new()
    V = [[bm.verts.new((xs[i], ys[j], H[i][j])) for j in range(ny + 1)] for i in range(nx + 1)]
    mats, idx = [], {}
    for i in range(nx):
        for j in range(ny):
            f = bm.faces.new([V[i][j], V[i + 1][j], V[i + 1][j + 1], V[i][j + 1]])
            z = (H[i][j] + H[i + 1][j] + H[i + 1][j + 1] + H[i][j + 1]) / 4
            m = paint((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2, z)
            if m.name not in idx:
                idx[m.name] = len(mats)
                mats.append(m)
            f.material_index = idx[m.name]
            f.smooth = True
    top = new_obj('tile_top', bm)
    for m in mats:
        top.data.materials.append(m)
    if ground:
        return H, xs, ys

    # 옆면: 둘레를 따라 지층 벽(층 무늬가 보이게 세로로 잘게 나눈다). 물 아래 땅이면 물 단면을 얹는다
    z0 = lib.TOP - depth
    ring = ([(xs[i], ys[0], H[i][0]) for i in range(nx)] + [(xs[nx], ys[j], H[nx][j]) for j in range(ny)]
            + [(xs[i], ys[ny], H[i][ny]) for i in range(nx, 0, -1)] + [(xs[0], ys[j], H[0][j]) for j in range(ny, 0, -1)])
    ring.append(ring[0])
    rows = 16
    bm = bmesh.new()
    # 맨 위 한 줄은 풀 띠(잔디가 덮인 흙 단면), 물 아래 땅은 흙만
    lip = 0.14
    cols = []
    for x, y, z in ring:
        ks = [z0 + (z - lip - z0) * k / rows for k in range(rows + 1)] + [z]
        cols.append([bm.verts.new((x, y, kz)) for kz in ks])
    for c in range(len(cols) - 1):
        for k in range(rows + 1):
            f = bm.faces.new([cols[c][k], cols[c + 1][k], cols[c + 1][k + 1], cols[c][k + 1]])
            wet = water is not None and min(ring[c][2], ring[c + 1][2]) < water + 0.02
            f.material_index = 1 if k == rows and not wet else 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    side = finish(new_obj('tile_side', bm), CLIFF, smooth=False)
    side.data.materials.append(top_mat)
    if water is not None:
        bm = bmesh.new()
        for c in range(len(ring) - 1):
            (ax, ay, az), (bx, by, bz) = ring[c], ring[c + 1]
            if az < water - 0.005 or bz < water - 0.005:
                vs = [bm.verts.new(v) for v in ((ax, ay, min(az, water)), (bx, by, min(bz, water)), (bx, by, water), (ax, ay, water))]
                bm.faces.new(vs)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        # 바깥(타일 중심 반대)을 보게
        for f in bm.faces:
            if f.normal.dot(f.calc_center_median().to_2d().to_3d()) < 0:
                f.normal_flip()
        finish(new_obj('tile_waterside', bm), WATER_SIDE, smooth=False)

    # 밑판(옆면 아래를 막는다) + 아래로 좁아지는 바위 밑동
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.25, radius2=1.0, depth=under)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=lib.Matrix.Rotation(math.pi / 4, 3, 'Z'), verts=bm.verts)
    for v in bm.verts:
        v.co.x *= W / 2 * math.sqrt(2) * 0.99
        v.co.y *= D / 2 * math.sqrt(2) * 0.99
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=10, use_grid_fill=True)
    for v in bm.verts:
        t = (under / 2 - v.co.z) / under  # 0 위 ~ 1 아래
        k = 1 - 0.08 * ((v.co.z * 2.2) % 1.0) ** 2
        v.co.x *= k
        v.co.y *= k
        v.co.x += t * t * 0.6
    o = new_obj('tile_under', bm)
    o.location = (0, 0, z0 - under / 2 + 0.01)
    finish(o, CLIFF, sub=1, disp=0.3, disp_size=0.9)
    for i in range(36):
        a = rnd.random() * math.tau
        t = rnd.random() ** 1.6 * 0.7
        r = (1 - t) * 0.97
        c = Vector((math.cos(a), math.sin(a)))
        # 사각 둘레로 밀어낸다
        c /= max(abs(c.x) / (W / 2), abs(c.y) / (D / 2))
        s_ = (0.3 + rnd.random() * 0.35) * (1 - t * 0.5)
        o = blob(f'tile_rock_{i}', s_, (c.x * r, c.y * r, z0 - t * under), CLIFF_LEDGE[i % 2], scale=(1.7, 1.4, 0.42), sub=2,
                 disp=0.1 * s_, disp_size=0.8 * s_)
        o.rotation_euler = (0, 0, a + math.pi / 2)
    return H, xs, ys


def still_uv(x, y, shore):
    """고인 물(바다·호수·연못)의 uv: u = 물가 정도(0.5 깊음 ~ 1 물가). v 는 쓰지 않는다(앱이 위치로 일렁임을 그린다)"""
    return 0.5 + 0.5 * shore, 0.0


def liquid_plane(name, W, D, height, level, step=0.4, uv=still_uv):
    """수면: 타일 전체 격자 중 땅이 수면 아래로 내려간 칸만. uv(x, y, 물가 정도 0~1) → (u, v).
    강은 u = 강폭 방향(0.5 가운데 ~ 0·1 둑), v = 흐르는 방향 거리를 준다(앱 강물 셰이더가 v 방향으로 흘린다)"""
    nx, ny = round(W / step), round(D / step)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    for i in range(nx):
        for j in range(ny):
            cs = [(-W / 2 + W * (i + a) / nx, -D / 2 + D * (j + b) / ny) for a, b in ((0, 0), (1, 0), (1, 1), (0, 1))]
            hs = [height(x, y) for x, y in cs]
            if min(hs) > level + 0.02:
                continue
            f = bm.faces.new([bm.verts.new((x, y, level)) for x, y in cs])
            for loop, (x, y), h in zip(f.loops, cs, hs):
                loop[uvl].uv = uv(x, y, smooth(0.35, 0.0, level - h))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    o = new_obj(name, bm)
    o.data.materials.append(lib.WATER)
    return o


def liquid_ribbon(name, pts, width, zfn):
    """흐르는 물 띠(개울·운하). uv.x = 폭 방향 0~1, uv.y = 흐른 거리"""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    rowsv, dist = [], [0.0]
    for i in range(1, len(pts)):
        dist.append(dist[-1] + (pts[i] - pts[i - 1]).length)
    for i, p in enumerate(pts):
        tan = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = Vector((-tan.y, tan.x)) * width / 2
        z = zfn(p, i)
        rowsv.append((bm.verts.new((p.x + side.x, p.y + side.y, z)), bm.verts.new((p.x - side.x, p.y - side.y, z))))
    for i in range(len(pts) - 1):
        f = bm.faces.new([rowsv[i][0], rowsv[i][1], rowsv[i + 1][1], rowsv[i + 1][0]])
        for loop, uv in zip(f.loops, ((0, dist[i]), (1, dist[i]), (1, dist[i + 1]), (0, dist[i + 1]))):
            loop[uvl].uv = (uv[0], uv[1] * 0.8)
    o = new_obj(name, bm)
    o.data.materials.append(lib.WATER)
    return o


def speckle(x, y):
    """칸마다 고정된 0~1 난수(재질 경계를 점점이 섞을 때)"""
    v = math.sin(x * 127.1 + y * 311.7) * 43758.5453
    return v - math.floor(v)


def free(x, y, r, W, D, margin=0.3):
    return abs(x) < W / 2 - margin and abs(y) < D / 2 - margin and lib.free(x, y, r)


def pick(W, D, margin=0.3):
    return ((rnd.random() - 0.5) * (W - 2 * margin), (rnd.random() - 0.5) * (D - 2 * margin))


def three(p, h=None):
    """Blender (x, y[, z]) -> 앱 [x, y, z]"""
    z = h if h is not None else (p.z if len(p) > 2 else lib.surface(p.x, p.y))
    return [round(p.x, 3), round(z, 3), round(-p.y, 3)]


def axis(half, step, R, grow=1.16, keep=4.0):
    """타일 안과 그 바깥 keep 까지는 step 간격(타일 가장자리 점과 맞물리고, 물가·재질 경계가 계단지지 않게),
    그 밖으로 갈수록 성기게 R 까지"""
    n = round(2 * half / step)
    inner = [-half + 2 * half * i / n for i in range(n + 1)]
    out, x, s_ = [], half, step
    while x < R:
        if x >= half + keep:
            s_ *= grow
        x = min(R, x + s_)
        out.append(x)
    return [-v for v in reversed(out)] + inner + out


def surround(name, W, D, step, hfar, paint, R=110.0, keep=4.0):
    """타일 바깥을 지평선까지 잇는 땅(far_ground). hfar(x, y): 높이(타일 가장자리에선 타일과 같아야 한다).
    keep: 타일 둘레 이만큼은 촘촘한 격자(긴 물가·길이 계단지지 않게)"""
    xs, ys = axis(W / 2, step, R, keep=keep), axis(D / 2, step, R, keep=keep)
    bm = bmesh.new()
    V = {}
    for i, x in enumerate(xs):
        for j, y in enumerate(ys):
            if abs(x) <= W / 2 - 1e-6 and abs(y) <= D / 2 - 1e-6:
                continue
            V[i, j] = bm.verts.new((x, y, hfar(x, y)))
    mats, idx = [], {}
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if abs(cx) < W / 2 and abs(cy) < D / 2:
                continue
            vs = [V[i, j], V[i + 1, j], V[i + 1, j + 1], V[i, j + 1]]
            f = bm.faces.new(vs)
            m = paint(cx, cy, sum(v.co.z for v in vs) / 4)
            if m.name not in idx:
                idx[m.name] = len(mats)
                mats.append(m)
            f.material_index = idx[m.name]
            f.smooth = True
    o = new_obj(name, bm)
    for m in mats:
        o.data.materials.append(m)
    return o


def liquid_far(name, W, D, hfar, level, R=110.0, step=0.4, margin=0.02, uv=still_uv):
    """타일 바깥 수면(먼 바다·강). 땅이 수면 아래인 칸만. uv 는 liquid_plane 과 같다.
    margin 을 크게 주면 물가 칸 너머까지 수면을 깔아 물가 선이 땅과 수면이 만나는 매끈한 선이 된다"""
    xs, ys = axis(W / 2, step, R, 1.25), axis(D / 2, step, R, 1.25)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            cs = [(xs[i + a], ys[j + b]) for a, b in ((0, 0), (1, 0), (1, 1), (0, 1))]
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if abs(cx) < W / 2 and abs(cy) < D / 2:
                continue
            hs = [hfar(x, y) for x, y in cs]
            if min(hs) > level + margin:
                continue
            f = bm.faces.new([bm.verts.new((x, y, level)) for x, y in cs])
            for loop, (x, y), h in zip(f.loops, cs, hs):
                loop[uvl].uv = uv(x, y, smooth(0.35, 0.0, level - h))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    o = new_obj(name, bm)
    o.data.materials.append(lib.WATER)
    return o


def far_trees(name, spots):
    """먼 숲: 면이 적은 나무(흔들리지 않는다). 재질마다 한 물체. spots: (x, y, z, 키, 'pine' | 잎 재질 | ('bush' | 'cypress' | 'umbrella', 재질))"""
    bms = {}
    # 그림자 범위(가운데에서 약 18) 밖은 '_distant' 물체로 나눈다(앱이 그림자를 그리지 않는다)
    get = lambda m: bms.setdefault((m.name, near), (m, bmesh.new()))[1]
    for x, y, z, h, kind in spots:
        near = math.hypot(x, y) < SHADOW_R
        mark_top(x, y, 0.4 * h, z + 1.05 * h)
        typ, m = kind if isinstance(kind, tuple) else (kind, kind)
        if typ == 'bush':
            # 덤불(울타리 덤불): 줄기 없이 낮은 공
            bmesh.ops.create_icosphere(get(m), subdivisions=1, radius=0.5 * h,
                                       matrix=lib.Matrix.Translation((x, y, z + 0.25 * h)) @ lib.Matrix.Diagonal((1, 1, 0.8, 1)))
            continue
        if typ == 'cypress':
            # 사이프러스: 줄기 없이 가늘고 긴 방추
            bmesh.ops.create_cone(get(m), cap_ends=True, segments=6, radius1=0.15 * h, radius2=0.01 * h, depth=0.9 * h,
                                  matrix=lib.Matrix.Translation((x, y, z + 0.5 * h)))
            bmesh.ops.create_cone(get(m), cap_ends=True, segments=6, radius1=0.04 * h, radius2=0.15 * h, depth=0.12 * h,
                                  matrix=lib.Matrix.Translation((x, y, z + 0.05 * h)))
            continue
        if typ == 'umbrella':
            # 우산소나무: 긴 줄기 위 납작한 우산 같은 잎
            bmesh.ops.create_cone(get(lib.TRUNK), cap_ends=False, segments=5, radius1=0.05 * h, radius2=0.035 * h, depth=0.8 * h,
                                  matrix=lib.Matrix.Translation((x, y, z + 0.4 * h)))
            bmesh.ops.create_icosphere(get(m), subdivisions=1, radius=0.42 * h,
                                       matrix=lib.Matrix.Translation((x, y, z + 0.82 * h)) @ lib.Matrix.Diagonal((1, 1, 0.32, 1)))
            continue
        bmesh.ops.create_cone(get(lib.TRUNK), cap_ends=False, segments=5, radius1=0.06 * h, radius2=0.04 * h, depth=0.4 * h,
                              matrix=lib.Matrix.Translation((x, y, z + 0.2 * h)))
        if kind == 'pine':
            for k in range(2):
                bmesh.ops.create_cone(get(lib.PINE), cap_ends=True, segments=7, radius1=(0.36 - k * 0.12) * h, radius2=0.02 * h,
                                      depth=0.62 * h, matrix=lib.Matrix.Translation((x, y, z + (0.62 + k * 0.4) * h)))
        else:
            bmesh.ops.create_icosphere(get(kind), subdivisions=2, radius=0.34 * h,
                                       matrix=lib.Matrix.Translation((x, y, z + 0.72 * h)) @ lib.Matrix.Diagonal((1, 1, 0.85, 1)))
    for (_, near), (m, bm) in bms.items():
        o = new_obj(f'{name}_{m.name}' + ('' if near else '_distant'), bm)
        o.data.materials.append(m)
        for p in o.data.polygons:
            p.use_smooth = m is not lib.PINE


def far_houses(name, items, glass=None):
    """먼 마을: 벽 상자 + 지붕 + 층마다 창(밤에 불이 켜진다). 재질마다 한 물체.
    items: (x, y, z, 폭, 깊이, 벽 높이, 지붕 높이, 회전, 벽 재질, 지붕 재질[, 'gable' | 'hip' | 'flat']). gable 은 폭 방향이 용마루,
    flat 은 지붕 재질로 얇은 옥상판(지붕 높이는 쓰지 않는다)"""
    glass = glass or lib.GLASS
    bms = {}
    get = lambda m: bms.setdefault((m.name, near), (m, bmesh.new()))[1]
    for it in items:
        x, y, z, w, d, h, rh, rot, wall, roof = it[:10]
        style = it[10] if len(it) > 10 else 'gable'
        near = math.hypot(x, y) < SHADOW_R
        mark_top(x, y, max(w, d) / 2, z + h + rh)
        if style == 'hip' and d > w:
            # 용마루가 긴 쪽을 따라가게 돌린다
            w, d, rot = d, w, rot + math.pi / 2
        M = lib.Matrix.Translation((x, y, z)) @ lib.Matrix.Rotation(rot, 4, 'Z')
        V = lambda bm, *vs: [bm.verts.new(M @ Vector(v)) for v in vs]
        bmesh.ops.create_cube(get(wall), size=1.0, matrix=M @ lib.Matrix.Translation((0, 0, h / 2)) @ lib.Matrix.Diagonal((w, d, h, 1)))
        bm = get(roof)
        o = 0.1
        if style == 'flat':
            bmesh.ops.create_cube(bm, size=1.0, matrix=M @ lib.Matrix.Translation((0, 0, h + 0.04)) @ lib.Matrix.Diagonal((w + 0.06, d + 0.06, 0.08, 1)))
        elif style == 'hip':
            r_ = (w - d) / 2
            A, B, C, D_, R1, R2 = V(bm, (-w / 2 - o, -d / 2 - o, h), (w / 2 + o, -d / 2 - o, h), (w / 2 + o, d / 2 + o, h),
                                   (-w / 2 - o, d / 2 + o, h), (-r_, 0, h + rh), (r_ + 1e-3, 0, h + rh))
            bm.faces.new([A, B, R2, R1])
            bm.faces.new([C, D_, R1, R2])
            bm.faces.new([D_, A, R1])
            bm.faces.new([B, C, R2])
        else:
            vs = V(bm, (-w / 2 - o, -d / 2 - o, h), (w / 2 + o, -d / 2 - o, h), (w / 2 + o, 0, h + rh), (-w / 2 - o, 0, h + rh),
                   (-w / 2 - o, d / 2 + o, h), (w / 2 + o, d / 2 + o, h))
            bm.faces.new([vs[0], vs[1], vs[2], vs[3]])
            bm.faces.new([vs[5], vs[4], vs[3], vs[2]])
            # 박공 삼각 벽은 벽 재질
            bw = get(wall)
            for sx in (-1, 1):
                tv = V(bw, (sx * w / 2, -d / 2, h), (sx * w / 2, d / 2, h), (sx * w / 2, 0, h + rh))
                bw.faces.new(tv if sx > 0 else tv[::-1])
        floors = max(1, round((h - 0.3) / 0.6))
        bays = max(1, round(w / 0.5))
        bg = get(glass)
        for f in range(floors):
            zc = 0.45 + f * 0.6
            for k in range(bays):
                cx = (k - (bays - 1) / 2) * w / bays
                for sy in (-1, 1):
                    yy = sy * (d / 2 + 0.01)
                    q = V(bg, (cx - 0.08, yy, zc - 0.13), (cx + 0.08, yy, zc - 0.13), (cx + 0.08, yy, zc + 0.13), (cx - 0.08, yy, zc + 0.13))
                    bg.faces.new(q if sy < 0 else q[::-1])
    for (_, near), (m, bm) in bms.items():
        o = new_obj(f'{name}_{m.name}' + ('' if near else '_distant'), bm)
        o.data.materials.append(m)


def heightmap(hfn, half=40.0, n=81):
    """앱 카메라가 땅속(과 먼 나무·집 속)으로 들어가지 않게 쓰는 높이 격자(앱 좌표: x, z = -y). h[i * n + j] = 높이(x_i, z_j).
    TOPS 가 1 간격 격자라 half·n 은 격자점이 정수가 되게 둔다"""
    # 가운데 땅의 나무·집도 넣는다(카메라가 타일 가장자리 큰 나무 속으로 들어가지 않게). 바닥·물처럼 넓은 것은 뺀다
    for o in lib.bpy.data.objects:
        if o.type != 'MESH' or o.name.startswith(('far_', 'liquid_', 'mover_')):
            continue
        cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
        x0, x1 = min(c.x for c in cs), max(c.x for c in cs)
        y0, y1 = min(c.y for c in cs), max(c.y for c in cs)
        r = max(x1 - x0, y1 - y0) / 2
        if r < 3.0:
            mark_top((x0 + x1) / 2, (y0 + y1) / 2, r, max(c.z for c in cs), half)
    g = [-half + 2 * half * k / (n - 1) for k in range(n)]
    return {'half': half, 'n': n, 'h': [round(max(hfn(x, -z), TOPS.get((round(x), round(-z)), -9.0)), 2) for x in g for z in g]}




# 미니어처 단면(위에서 아래로): 윗면이 살짝 넘친 턱 → 겉흙(위쪽은 짙은 부엽토) → 자갈 섞인 흙 → 울퉁불퉁한 보랏빛 암반.
# 색은 재질 대신 꼭짓점 색('Paint')에 직접 칠한다(lib.export_glb 가 그대로 옮긴다). 재질은 흰 무광 하나.
CASE_PAINT = mat('case_paint', '#ffffff', 0.95, 0.0)
SOIL_COLS = ['#a2653e', '#8f5636', '#b07450', '#7f4c31', '#9a603c']
HUMUS = '#5e3f2b'
GRAVEL_COLS = ['#b49a7a', '#a08868', '#c4ab88']
BEDROCK_COLS = ['#5f5878', '#48425c', '#6a6384', '#514a66']
CRACK = '#3b3650'
PEBBLE_COLS = ['#9a8e7e', '#86796a', '#a99c88', '#7a7064', '#b2a48e']
BOULDER_COLS = ['#5e5874', '#534d68', '#686180']
# 암반 두께: 자갈층 아래로 내려가는 깊이
STRATA_DEPTH = 1.6


def _mix(a, b, t):
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3))


def _ramp(cols, t):
    """cols(선형 색) 사이를 t(0~1)로 고른다"""
    t = min(max(t, 0.0), 1.0) * (len(cols) - 1)
    i = min(int(t), len(cols) - 2)
    return _mix(cols[i], cols[i + 1], t - i)


def _top_color(m):
    """윗면 재질의 대표 색(선형). 단면 위 턱을 윗면과 같은 색으로 칠할 때 쓴다"""
    if m.node_tree:
        ramp = next((nd for nd in m.node_tree.nodes if nd.type == 'VALTORGB'), None)
        if ramp:
            els = ramp.color_ramp.elements
            return tuple(sum(e.color[i] for e in els) / len(els) for i in range(3))
        b = m.node_tree.nodes.get('Principled BSDF')
        if b:
            return tuple(b.inputs['Base Color'].default_value[:3])
    return tuple(lib.lin('#9aae62')[:3])


def _paint(o, color_of):
    """꼭짓점마다 color_of(꼭짓점 번호) 색을 'Paint' 속성에 칠한다"""
    me = o.data
    attr = me.color_attributes.new('Paint', 'BYTE_COLOR', 'CORNER')
    cache = {}
    for li, lp in enumerate(me.loops):
        vi = lp.vertex_index
        if vi not in cache:
            cache[vi] = color_of(vi)
        attr.data[li].color = (*cache[vi], 1)


def case(W, D, hfn, water=None, paint=None):
    """미니어처 모양(앱 설정)일 때만 보이는 땅 단면(case_*: 굽지 않는다). 지평선 모양에서는 앱이 숨긴다.
    paint(x, y, z) -> 윗면 재질(있으면 턱을 그 색으로). 물이 있으면 물 단면을 얹는다.
    1. 가장자리 한 바퀴의 땅 높이와 층 경계(겉흙·자갈·암반)를 정한다.
    2. 벽을 세로로 잘게 나눈 격자로 세우고, 층마다 다른 세기로 바깥쪽에 울퉁불퉁 민다(암반이 가장 크게).
    3. 꼭짓점 색으로 층 색·띠·금·움푹한 곳 그늘을 칠한다.
    4. 윗면 가장자리에 살짝 넘친 턱, 자갈층에 박힌 돌, 암반에 튀어나온 바위를 붙인다."""
    from mathutils import noise as mn
    L = lambda h: tuple(lib.lin(h)[:3])
    soil_c, grav_c, rock_c = [L(c) for c in SOIL_COLS], [L(c) for c in GRAVEL_COLS], [L(c) for c in BEDROCK_COLS]
    humus, crack = L(HUMUS), L(CRACK)

    step = 0.2
    nx, ny = round(W / step), round(D / step)
    edge = ([(-W / 2 + W * i / nx, -D / 2) for i in range(nx)] + [(W / 2, -D / 2 + D * i / ny) for i in range(ny)]
            + [(W / 2 - W * i / nx, D / 2) for i in range(nx)] + [(-W / 2, D / 2 - D * i / ny) for i in range(ny)])
    n = len(edge)

    def out(x, y):
        """바깥쪽 방향(모서리에서는 대각선)"""
        ox = 1 if x >= W / 2 - 1e-3 else -1 if x <= -W / 2 + 1e-3 else 0
        oy = 1 if y >= D / 2 - 1e-3 else -1 if y <= -D / 2 + 1e-3 else 0
        return ox, oy
    normals = [out(x, y) for x, y in edge]
    hs = [hfn(x, y) for x, y in edge]
    z0 = min(hs) - 1.2
    along = [step * i for i in range(n)]
    wave = lambda i, k, ph: math.sin(along[i] * k + ph) * 0.5 + math.sin(along[i] * k * 2.3 + ph * 1.7) * 0.25
    soil_lo = [max(min(hs[i] - 0.8 + wave(i, 0.9, 0.3) * 0.22, hs[i] - 0.45), z0 + 0.3) for i in range(n)]
    grav_lo = [min(z0 - 0.35 + wave(i, 0.6, 2.1) * 0.22, soil_lo[i] - 0.25) for i in range(n)]
    # 바닥은 고르지 않게(아래에서 올려다볼 일은 거의 없지만 옆에서 보면 끝이 들쭉날쭉)
    bot = [z0 - STRATA_DEPTH - 0.18 * abs(mn.noise(Vector((along[i] * 0.7, 3.1, 0.0)))) * 2 for i in range(n)]

    # 2. 벽 격자. 위 한 줄은 밀지 않아 윗면 가장자리와 맞닿는다
    rows = 34

    def push(x, y, z, i):
        p = Vector((x * 1.0, y * 1.0, z))
        if z > soil_lo[i]:
            # 겉흙: 잔 요철. 위로 갈수록 0(턱 아래로 숨는다)
            fade = min(1.0, (hs[i] - z) / 0.25)
            return fade * (0.035 + 0.03 * mn.noise(p * 2.2))
        if z > grav_lo[i]:
            return 0.05 + 0.035 * mn.noise(p * 3.0)
        # 암반: 큰 덩어리 + 잔 요철, 덩어리는 위아래로 납작하게(층이 진 바위)
        q = Vector((p.x * 0.8, p.y * 0.8, p.z * 1.6))
        return 0.09 + 0.08 * mn.noise(q) + 0.03 * mn.noise(p * 3.5)

    bm = bmesh.new()
    grid, info = [], []
    for i, (x, y) in enumerate(edge):
        ox, oy = normals[i]
        top, lo = hs[i] - 0.02, bot[i]
        col = []
        for k in range(rows + 1):
            z = top + (lo - top) * k / rows
            d = 0.0 if k == 0 else push(x, y, z, i)
            col.append(bm.verts.new((x + ox * d, y + oy * d, z)))
            info.append((i, x, y, z, d))
        grid.append(col)
    for i in range(n):
        j = (i + 1) % n
        for k in range(rows):
            bm.faces.new([grid[i][k + 1], grid[j][k + 1], grid[j][k], grid[i][k]])
    bm.faces.new([grid[i][rows] for i in range(n)][::-1])
    wall = new_obj('case_ground', bm)

    # 3. 꼭짓점 색
    def wall_color(vi):
        i, x, y, z, d = info[vi]
        p = Vector((x, y, z))
        jit = 0.06 * mn.noise(p * 4.0)
        if z > soil_lo[i] + jit:
            t = 0.5 + 0.5 * math.sin(z * 9.0 + mn.noise(p * 0.8) * 2.4)
            c = _ramp(soil_c, t)
            depth = hs[i] - z
            if depth < 0.22:
                c = _mix(humus, c, smooth(0.06, 0.22, depth))
            if z - soil_lo[i] < 0.05:
                c = _mix(c, humus, 0.45)
        elif z > grav_lo[i] + jit:
            t = 0.5 + 0.5 * mn.noise(p * 9.0)
            c = _ramp(grav_c, t)
            if z - grav_lo[i] < 0.05:
                c = _mix(c, crack, 0.35)
        else:
            t = 0.5 + 0.5 * math.sin(z * 6.0 + (x + y) * 0.35 + mn.noise(p * 0.6) * 1.8)
            c = _ramp(rock_c, t)
            nz = mn.noise(Vector((p.x * 1.7, p.y * 1.7, p.z * 3.2)))
            if abs(nz) < 0.05:
                c = _mix(c, crack, 0.75)
        # 움푹 들어간 곳은 어둡게, 맨 아래로 갈수록 조금 어둡게
        shade = 0.82 + 0.18 * min(1.0, d / 0.12) if d > 0 else 1.0
        shade *= 1.0 - 0.18 * smooth(grav_lo[i] - 0.4, bot[i], z)
        return tuple(v * shade for v in c)
    # 부드러운 음영: 꼭짓점을 이웃 면과 나눠 써서 파일이 작고, 흙·바위 덩어리가 점토처럼 둥글게 보인다
    finish(wall, CASE_PAINT, smooth=True)
    _paint(wall, wall_color)

    # 4-1. 턱: 윗면 가장자리에서 바깥으로 살짝 나왔다가 물방울처럼 들쭉날쭉 내려온다. 물가(땅이 수면 아래)는 뺀다
    dry = [water is None or hs[i] >= water - 0.005 for i in range(n)]
    lip_col = [(_top_color(paint(x, y, hs[i])) if paint else L('#9aae62')) for i, (x, y) in enumerate(edge)]
    bm = bmesh.new()
    lip, lip_info = [], []
    for i, (x, y) in enumerate(edge):
        ox, oy = normals[i]
        drip = 0.07 + 0.06 * max(0.0, mn.noise(Vector((along[i] * 2.6, 7.7, 0.0)))) * 2
        pts = [(-0.04, 0.012), (0.05, -0.005), (0.06, -drip * 0.6), (0.035, -drip)]
        col = []
        for k, (o_, dz) in enumerate(pts):
            col.append(bm.verts.new((x + ox * o_, y + oy * o_, hs[i] + dz)))
            lip_info.append((i, k))
        lip.append(col)
    for i in range(n):
        j = (i + 1) % n
        if not (dry[i] and dry[j]):
            continue
        for k in range(3):
            bm.faces.new([lip[i][k + 1], lip[j][k + 1], lip[j][k], lip[i][k]])
    loose = [v for v in bm.verts if not v.link_faces]
    keep_info = [lip_info[k] for k, v in enumerate(bm.verts) if v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    if bm.faces:
        o = new_obj('case_lip', bm)
        finish(o, CASE_PAINT, smooth=True)
        # 아래쪽 끝은 그늘이 지게 조금 어둡게
        _paint(o, lambda vi: tuple(v * (1.0 - 0.12 * keep_info[vi][1]) for v in lip_col[keep_info[vi][0]]))
    else:
        bm.free()

    # 4-2. 자갈층에 반쯤 박힌 돌과 암반에서 튀어나온 바위. 공용 rnd 를 쓰면 뒤에 오는 배치가 바뀌므로 따로 둔다
    r_ = lib.random.Random(11)
    bm = bmesh.new()
    owner = []
    def stone(i, z, r, d, cols):
        x, y = edge[i]
        ox, oy = normals[i]
        g = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
        vs = g['verts']
        bmesh.ops.scale(bm, vec=Vector((r_.uniform(1.0, 1.7), r_.uniform(1.0, 1.7), r_.uniform(0.55, 0.85))), verts=vs)
        bmesh.ops.rotate(bm, verts=vs, cent=Vector(), matrix=Matrix.Rotation(r_.uniform(0, 6.28), 3, 'Z'))
        # 벽 속으로 반 넘게 묻는다(튀어나온 쪽만 보인다)
        bmesh.ops.translate(bm, vec=Vector((x + ox * (d - r * 0.15), y + oy * (d - r * 0.15), z)), verts=vs)
        c = r_.choice(cols)
        k = r_.uniform(0.85, 1.08)
        owner.extend([tuple(v * k for v in c)] * len(vs))
    pcols, bcols = [L(c) for c in PEBBLE_COLS], [L(c) for c in BOULDER_COLS]
    for _ in range(520):
        i = r_.randrange(n)
        lo, hi = grav_lo[i], soil_lo[i]
        if hi - lo < 0.2:
            continue
        z = r_.uniform(lo + 0.06, hi - 0.06)
        x, y = edge[i]
        stone(i, z, r_.uniform(0.07, 0.15), push(x, y, z, i), pcols)
    for _ in range(45):
        i = r_.randrange(n)
        z = r_.uniform(bot[i] + 0.25, grav_lo[i] - 0.15)
        x, y = edge[i]
        stone(i, z, r_.uniform(0.12, 0.26), push(x, y, z, i), bcols)
    o = new_obj('case_pebbles', bm)
    finish(o, CASE_PAINT, smooth=True)
    _paint(o, lambda vi: owner[vi])

    if water is not None:
        bm = bmesh.new()
        for i in range(n):
            j = (i + 1) % n
            (ax, ay), (bx, by) = edge[i], edge[j]
            if hs[i] < water - 0.005 or hs[j] < water - 0.005:
                bm.faces.new([bm.verts.new(v) for v in ((ax, ay, min(hs[i], water)), (bx, by, min(hs[j], water)), (bx, by, water), (ax, ay, water))])
        for f in bm.faces:
            if f.normal.dot(f.calc_center_median().to_2d().to_3d()) < 0:
                f.normal_flip()
        if bm.faces:
            finish(new_obj('case_water', bm), WATER_SIDE, smooth=False)
        else:
            bm.free()
