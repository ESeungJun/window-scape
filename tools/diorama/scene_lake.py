# 노을 호수 장면: 언덕 위 큰 나무, 앞쪽 연못(물은 앱에서 그린다), 바위·꽃덤불
NAME = 'lake'
R = 3.3
HILL = (-1.1, 1.0, 0.95, 2.6)  # 언덕 중심 x, y, 높이, 퍼짐(앱의 같은 식과 맞춘다)


POND = (1.0, -0.9, 1.25)


def hill_z(x, y):
    hx, hy, hh, hs = HILL
    z = hh * math.exp(-((x - hx) ** 2 + (y - hy) ** 2) / hs)
    # 연못 둘레는 평평하게
    d = math.hypot(x - POND[0], y - POND[1])
    return z * min(1.0, max(0.0, (d - POND[2] - 0.3) / 0.8))


def hill_mesh(bm):
    # 둥근 판을 잘게 나눠 언덕 높이를 준다(가장자리는 0)
    n = 64
    rings = 40
    center = bm.verts.new((0, 0, hill_z(0, 0) + 0.006))
    prev = None
    first_ring = None
    for r in range(1, rings + 1):
        rr = R * r / rings
        ring = [bm.verts.new((math.cos(i / n * math.tau) * rr, math.sin(i / n * math.tau) * rr,
                              hill_z(math.cos(i / n * math.tau) * rr, math.sin(i / n * math.tau) * rr) * (1 - (r / rings) ** 6) + 0.006))
                for i in range(n)]
        if prev is None:
            for i in range(n):
                bm.faces.new((center, ring[i], ring[(i + 1) % n]))
        else:
            for i in range(n):
                bm.faces.new((prev[i], ring[i], ring[(i + 1) % n], prev[(i + 1) % n]))
        prev = ring


M = __import__('mathutils').Matrix
def base_mesh(bm):
    bmesh.ops.create_cone(bm, cap_ends=True, segments=96, radius1=R + 0.25, radius2=R + 0.12, depth=0.55, matrix=M.Translation((0, 0, -0.33)))
    bmesh.ops.create_cone(bm, cap_ends=True, segments=96, radius1=R + 0.05, radius2=R, depth=0.12, matrix=M.Translation((0, 0, -0.06)))
ground_obj('base', base_mesh, proc_material('wood', wood))
ground_obj('grass', hill_mesh, proc_material('grass', grass))
# 연못 자리: 모래 물가와 깊은 바닥
ground_obj('plaza', disc_mesh(POND[2] + 0.22, 0.014, POND[0], POND[1]), proc_material('sand', sand))
ground_obj('pondbed', disc_mesh(POND[2] - 0.05, 0.018, POND[0], POND[1]), proc_material('pondbed', solid((0.05, 0.16, 0.2), 0.6)))


def rock_mesh(seed, size):
    import random
    rnd = random.Random(seed)
    def build(bm):
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=size)
        for v in bm.verts:
            k = 1 + (rnd.random() - 0.5) * 0.25
            v.co.x *= k * 1.2; v.co.y *= k; v.co.z = max(v.co.z * 0.65 * k, -size * 0.15)
    return build


ROCK = proc_material('rock', solid((0.2, 0.2, 0.21), 0.7))
for i, (x, y, sz) in enumerate([(2.3, -0.4, 0.22), (2.45, -0.15, 0.14), (-0.1, -1.75, 0.18), (0.1, -1.95, 0.12), (2.1, -1.9, 0.2), (0.05, -0.2, 0.15), (-0.2, -0.05, 0.1)]):
    o = ground_obj(f'rock{i}', rock_mesh(i, sz), ROCK)
    o.location = (x, y, 0.0); o.rotation_euler = (0, 0, i * 1.3)

import_part('bigtree', 2.6, HILL[0] - 0.15, HILL[1] + 0.35, 20)
for o in statics[-1:]:
    o.location.z = hill_z(HILL[0] - 0.15, HILL[1] + 0.35) - 0.05
for x, y, h in [(-2.55, -0.6, 0.45), (-2.2, -1.4, 0.4), (-1.4, -2.2, 0.38), (-2.75, 0.5, 0.4), (2.6, 1.0, 0.4),
                (-1.7, -0.9, 0.3), (-0.6, -1.3, 0.28), (-2.0, 0.1, 0.32)]:
    import_part('bush', h, x, y, x * 60)
    statics[-1].location.z = hill_z(x, y) - 0.03
for x, y, h in [(1.9, 2.2, 0.95), (2.7, 1.5, 0.75), (-2.5, 1.9, 0.85)]:
    import_part('tree', h, x, y, y * 50)
    statics[-1].location.z = hill_z(x, y) - 0.03

LAMPS = [((HILL[0], HILL[1] - 0.5, 1.6), 18, (0.75, 1.0, 0.5)), ((POND[0], POND[1], 0.9), 10, (0.6, 0.8, 1.0))]
GLOW = ()
BIG = BIG + ('bigtree',)
CAM_LOC, CAM_TARGET = (5.2, -9.4, 6.6), (0, 0.1, 0.45)
