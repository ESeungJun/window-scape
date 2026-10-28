# 사각 디오라마 타일 공용 도구(드라이브·도시·성·숲). 레퍼런스 디오라마처럼 네모난 땅 조각을 잘라 낸 모양:
# 높이 함수로 빚은 윗면(칸마다 재질), 지층이 드러난 옆면, 물이 있으면 옆면에 물 단면, 아래로 좁아지는 바위 밑동.
# 타일 축은 Blender x·y 와 같다. 앱 기본 시점이 대각선(CAM ≈ (0.66, -0.75))이라 모서리 하나가 카메라를 향한다.
# 물(liquid_)과 움직이는 것(mover_)은 앱이 따로 그린다(lib.dynamic).
import math
import bmesh
from mathutils import Vector
import lib
from lib import CLIFF, CLIFF_LEDGE, blob, finish, mat, new_obj, rnd

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


def build(W, D, height, paint, water=None, step=0.2, depth=1.5, under=4.0, top_mat=lib.GRASS):
    """W×D 타일. height(x, y) -> 윗면 높이, paint(x, y, z) -> 재질. water: 수면 높이(없으면 None)"""
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


def liquid_plane(name, W, D, height, level, step=0.4):
    """수면: 타일 전체 격자 중 땅이 수면 아래로 내려간 칸만. uv.x = 물가 정도(0.5 깊음 ~ 1 물가), uv.y = 흐름 좌표"""
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
                shore = smooth(0.35, 0.0, level - h)
                loop[uvl].uv = (0.5 + 0.5 * shore, x * 0.22 + y * 0.08)
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


def free(x, y, r, W, D, margin=0.3):
    return abs(x) < W / 2 - margin and abs(y) < D / 2 - margin and lib.free(x, y, r)


def pick(W, D, margin=0.3):
    return ((rnd.random() - 0.5) * (W - 2 * margin), (rnd.random() - 0.5) * (D - 2 * margin))


def three(p, h=None):
    """Blender (x, y[, z]) -> 앱 [x, y, z]"""
    z = h if h is not None else (p.z if len(p) > 2 else lib.surface(p.x, p.y))
    return [round(p.x, 3), round(z, 3), round(-p.y, 3)]
