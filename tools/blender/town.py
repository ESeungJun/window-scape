# 도시 건물(유럽풍 연립주택·둥근 탑). props.py 가 불러 쓴다.
import math
import bmesh
from lib import (BUSH, DARKWOOD, GLASS, STONE, WOOD, bake, blob, box, cyl, finish, mat, new_obj)

TRIM = mat('trim', '#fbf7ee', 0.7, 0.03)
AWNINGS = [mat('awning_r', '#d9574a', 0.8, 0.05), mat('awning_g', '#4f9a7a', 0.8, 0.05), mat('awning_b', '#4f7fb8', 0.8, 0.05)]


def townhouse(name, floors, wall, roof, style, awning):
    """유럽풍 연립주택(벽 바닥 1x1, 기준점 바닥 가운데, 앞 = -Y)"""
    fh = 0.5
    h = floors * fh + 0.08
    P = [box(f'{name}_plinth', (1.04, 1.04, 0.1), (0, 0, 0.05), STONE, bevel=0.02),
         box(f'{name}_wall', (1.0, 1.0, h), (0, 0, h / 2), wall, bevel=0.02),
         box(f'{name}_cornice', (1.09, 1.09, 0.07), (0, 0, h), TRIM, bevel=0.02)]
    for k in range(1, floors):
        P.append(box(f'{name}_band', (1.025, 1.025, 0.03), (0, 0, 0.08 + k * fh), TRIM, bevel=0.008))
    # 창: 네 면, 층마다 두 개. 1층 앞면은 가게
    for side in range(4):
        ry = side * math.pi / 2
        c, s = math.cos(ry), math.sin(ry)

        def at(dx, dy, z):
            return (dx * c - dy * s, dx * s + dy * c, z)
        rot = (0, 0, ry)
        for f in range(floors):
            if f == 0 and side == 0:
                continue
            z = 0.08 + f * fh + fh * 0.52
            for dx in (-0.24, 0.24):
                P.append(box(f'{name}_g', (0.17, 0.03, 0.26), at(dx, -0.505, z), GLASS, rot=rot, bevel=0.004))
                P.append(box(f'{name}_f', (0.22, 0.025, 0.31), at(dx, -0.498, z), TRIM, rot=rot, bevel=0.004))
                P.append(box(f'{name}_sill', (0.24, 0.06, 0.025), at(dx, -0.53, z - 0.16), TRIM, rot=rot, bevel=0.004))
            # 앞면 홀수 층 가운데 발코니
            if side == 0 and f % 2 == 1:
                P.append(box(f'{name}_balc', (0.46, 0.16, 0.035), at(0, -0.58, z - 0.17), TRIM, rot=rot, bevel=0.006))
                for k in range(6):
                    P.append(box(f'{name}_bp', (0.018, 0.018, 0.13), at(-0.21 + k * 0.084, -0.65, z - 0.09), DARKWOOD, rot=rot, bevel=0))
                P.append(box(f'{name}_br', (0.46, 0.02, 0.02), at(0, -0.65, z - 0.02), DARKWOOD, rot=rot, bevel=0))
    # 1층 가게: 큰 진열창, 문, 차양
    P.append(box(f'{name}_shop', (0.5, 0.03, 0.28), (-0.15, -0.505, 0.3), GLASS, bevel=0.004))
    P.append(box(f'{name}_shopf', (0.56, 0.025, 0.33), (-0.15, -0.498, 0.3), TRIM, bevel=0.004))
    P.append(box(f'{name}_door', (0.18, 0.03, 0.34), (0.3, -0.505, 0.27), WOOD, bevel=0.006))
    P.append(box(f'{name}_awn', (0.95, 0.24, 0.025), (0, -0.6, 0.5), awning, rot=(-0.45, 0, 0), bevel=0.006))
    # 지붕
    top = h + 0.035
    if style == 'gable':
        pitch = math.radians(48)
        rise = 0.55 * math.tan(pitch)
        for sx in (-1, 1):
            P.append(box(f'{name}_roof', (0.62 / math.cos(pitch), 1.12, 0.06), (sx * 0.29, 0, top + rise / 2 + 0.02), roof,
                         rot=(0, sx * pitch, 0), bevel=0.02))
        for sy in (-1, 1):
            bm = bmesh.new()
            vs = [bm.verts.new(v) for v in ((-0.52, 0, 0), (0.52, 0, 0), (0, 0, rise))]
            face = bm.faces.new(vs)
            bmesh.ops.solidify(bm, geom=[face], thickness=0.04)
            g = new_obj(f'{name}_gable', bm)
            g.location = (0, sy * 0.5, top - 0.01)
            P.append(finish(g, wall, smooth=False))
            P.append(box(f'{name}_gw', (0.14, 0.03, 0.18), (0, sy * 0.52, top + rise * 0.35), GLASS, bevel=0.004))
    elif style == 'mansard':
        P.append(cyl(f'{name}_mansard', 0.76, 0.5, 0.42, (0, 0, top + 0.21), roof, seg=4, rot=(0, 0, math.pi / 4), bevel=0.02))
        P.append(box(f'{name}_mtop', (0.72, 0.72, 0.04), (0, 0, top + 0.43), roof, bevel=0.01))
        for side in range(4):
            ry = side * math.pi / 2
            c, s = math.cos(ry), math.sin(ry)
            out = (s * 0.42, -c * 0.42)
            P.append(box(f'{name}_dorm', (0.18, 0.12, 0.2), (out[0], out[1], top + 0.2), wall, rot=(0, 0, ry), bevel=0.01))
            P.append(box(f'{name}_dormg', (0.11, 0.02, 0.12), (s * 0.485, -c * 0.485, top + 0.2), GLASS, rot=(0, 0, ry), bevel=0.003))
            P.append(box(f'{name}_dormr', (0.22, 0.17, 0.03), (out[0], out[1], top + 0.32), roof, rot=(0, 0, ry), bevel=0.006))
    else:
        for side in range(4):
            ry = side * math.pi / 2
            P.append(box(f'{name}_parapet', (1.08, 0.06, 0.12), (0.51 * math.sin(ry), -0.51 * math.cos(ry), top + 0.06), TRIM,
                         rot=(0, 0, ry), bevel=0.01))
        for k in range(5):
            P.append(blob(f'{name}_pot', 0.08, (-0.3 + k * 0.15, 0.2, top + 0.08), BUSH, scale=(1, 1, 0.8), sub=2, disp=0.02, disp_size=0.08))
    P.append(box(f'{name}_chim', (0.12, 0.12, 0.35), (0.3, 0.25, top + 0.35), STONE, bevel=0.01))
    return bake(P, name, origin=(0, 0, 0))


def round_tower(name, h, wall, roof, dome):
    """둥근 탑(반지름 0.55, 기준점 바닥 가운데)"""
    r = 0.55
    P = [cyl(f'{name}_plinth', r + 0.05, r + 0.05, 0.12, (0, 0, 0.06), STONE, seg=24, bevel=0.02),
         cyl(f'{name}_body', r, r, h, (0, 0, h / 2), wall, seg=32)]
    for f in range(int(h / 0.5)):
        z = 0.12 + f * 0.5 + 0.28
        P.append(cyl(f'{name}_band', r + 0.015, r + 0.015, 0.03, (0, 0, 0.12 + f * 0.5), TRIM, seg=32))
        for k in range(6):
            a = k / 6 * math.tau + (f % 2) * 0.5
            P.append(box(f'{name}_g', (0.15, 0.03, 0.24), (math.cos(a) * (r + 0.005), math.sin(a) * (r + 0.005), z), GLASS,
                         rot=(0, 0, a + math.pi / 2), bevel=0.004))
            P.append(box(f'{name}_f', (0.2, 0.02, 0.29), (math.cos(a) * r, math.sin(a) * r, z), TRIM, rot=(0, 0, a + math.pi / 2), bevel=0.004))
    P.append(cyl(f'{name}_cornice', r + 0.07, r + 0.07, 0.07, (0, 0, h), TRIM, seg=32, bevel=0.01))
    if dome:
        P.append(blob(f'{name}_dome', r * 1.02, (0, 0, h + 0.03), roof, scale=(1, 1, 0.9), sub=4))
        P.append(cyl(f'{name}_spire', 0.03, 0.01, 0.35, (0, 0, h + r * 0.9 + 0.15), DARKWOOD, seg=8))
    else:
        P.append(cyl(f'{name}_cone', r * 1.15, 0.02, 1.0, (0, 0, h + 0.5), roof, seg=32, bevel=0.01))
    return bake(P, name, origin=(0, 0, 0))
