# 창밖날씨 테마들을 Blender 안에서 직접 모델링하는 공용 도구(재질·모양·나무·집·소품·조명·내보내기).
# 장면 스크립트(island.py, props.py)가 불러 쓴다.
# 좌표: Blender 는 Z 가 위. 앱(three.js)의 (x, y, z) = Blender (x, -y... ) 가 아니라
#   three (x, y, z)  ->  Blender (x, -z, y)
# 섬 반지름 R, 윤곽 rimFactor, 윗면 높이 TOP, 강 경로는 앱(src/scene/kit.ts, island.ts)과 같게 맞춘다.
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'out_island'
MODE = argv[1] if len(argv) > 1 else 'preview'
SAMPLES = int(argv[2]) if len(argv) > 2 else 96
os.makedirs(OUT, exist_ok=True)
rnd = random.Random(7)
# 앱(glb)은 실시간으로 그리므로 둥근 면의 세분을 한 단계 낮춘다
SUB_DROP = 1 if MODE == 'glb' else 0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
COL = scene.collection

R, TOP = 9.0, 0.25
# 앱 기본 시점에서 본 방향: CAM = 섬에서 카메라 쪽, RIGHT = 화면 오른쪽(Blender xy)
CAM, RIGHT = Vector((0.664, -0.747)), Vector((0.747, 0.664))


def scr(u, v):
    """화면 기준 좌표(u 오른쪽, v 안쪽 = 화면 위) -> Blender xy. 배치를 앱에서 보이는 구도로 잡는다"""
    return RIGHT * u - CAM * v


HILL, HILL_R = scr(-3.4, 3.2), 2.8


def rim(a):
    return 1 + 0.1 * math.sin(3 * a + 0.7) + 0.06 * math.sin(5 * a + 2.1) + 0.04 * math.sin(7 * a + 4)


def three_angle(a):
    """앱의 xz 평면 각도 -> Blender xy 평면 각도(z 가 뒤집힌다)"""
    return -a


def rim_b(a):
    """Blender 각도 a 의 윤곽 배율"""
    return rim(-a)


def surface(x, y):
    d = (Vector((x, y)) - HILL).length / HILL_R
    return max(TOP, 0.15 + 0.42 * HILL_R * math.sqrt(1 - d * d)) if d < 1 else TOP


# ── 재질 ─────────────────────────────────────────────

def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


_mats = {}


def mat(name, hexcol, rough=0.8, var=0.12, scale=5.0, bump=0.0, emit=None, alpha=None):
    """색 얼룩(var)과 잔 요철(bump)이 있는 클레이 같은 무광 재질"""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    n, l = nt.nodes, nt.links
    b = n['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    base = lin(hexcol)
    if var > 0:
        tc = n.new('ShaderNodeTexCoord')
        nz = n.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = scale
        nz.inputs['Detail'].default_value = 3.0
        l.new(tc.outputs['Object'], nz.inputs['Vector'])
        ramp = n.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.3
        ramp.color_ramp.elements[1].position = 0.7
        ramp.color_ramp.elements[0].color = tuple(c * (1 - var) for c in base[:3]) + (1,)
        ramp.color_ramp.elements[1].color = tuple(min(1, c * (1 + var)) for c in base[:3]) + (1,)
        l.new(nz.outputs['Fac'], ramp.inputs['Fac'])
        l.new(ramp.outputs['Color'], b.inputs['Base Color'])
        if bump > 0:
            bp = n.new('ShaderNodeBump')
            bp.inputs['Strength'].default_value = bump
            l.new(nz.outputs['Fac'], bp.inputs['Height'])
            l.new(bp.outputs['Normal'], b.inputs['Normal'])
    else:
        b.inputs['Base Color'].default_value = base
    if emit:
        b.inputs['Emission Color'].default_value = lin(emit)
        b.inputs['Emission Strength'].default_value = 1.5
    if alpha is not None:
        b.inputs['Alpha'].default_value = alpha
    _mats[name] = m
    return m


def banded(name, colors, axis_scale=3.0, distortion=2.0, bump=0.4, rough=0.9):
    """층이 진 바위(절벽)·기와(지붕)처럼 한 방향으로 띠가 지는 재질"""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    n, l = nt.nodes, nt.links
    b = n['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    tc = n.new('ShaderNodeTexCoord')
    wave = n.new('ShaderNodeTexWave')
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = axis_scale
    wave.inputs['Distortion'].default_value = distortion
    wave.inputs['Detail'].default_value = 3.0
    l.new(tc.outputs['Object'], wave.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    for i, c in enumerate(colors):
        e = els[i] if i < 2 else els.new(0)
        e.position = i / (len(colors) - 1)
        e.color = lin(c)
    l.new(wave.outputs['Fac'], ramp.inputs['Fac'])
    l.new(ramp.outputs['Color'], b.inputs['Base Color'])
    bp = n.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = bump
    l.new(wave.outputs['Fac'], bp.inputs['Height'])
    l.new(bp.outputs['Normal'], b.inputs['Normal'])
    _mats[name] = m
    return m


# 색상표(모든 테마 공통). 레퍼런스 디오라마의 채도 낮고 따뜻한 색에서 뽑았다
GRASS = mat('grass', '#9aae62', 0.95, 0.08, 3.0)
GRASS_DARK = mat('grass_dark', '#6f8a48', 0.95, 0.08, 4.0)
DIRT = mat('dirt', '#a2653e', 0.95, 0.1, 6.0)
CLIFF = banded('cliff', ['#a2653e', '#8f5636', '#b07450', '#7f4c31', '#9a603c'], 1.6, 2.0, 0.6)
STONE = mat('stone', '#a8a29a', 0.9, 0.1, 8.0)
ROCK = mat('rock', '#9c9c9e', 0.9, 0.1, 3.0)
PATH = mat('path', '#d9c39a', 0.95, 0.06, 6.0)
SAND = mat('sand', '#e8d8b6', 0.95, 0.05, 6.0)
WOOD = mat('wood', '#8a5a3c', 0.85, 0.12, 14.0)
DARKWOOD = mat('darkwood', '#5e4330', 0.85, 0.1, 14.0)
PLASTER = mat('plaster', '#eee5d4', 0.9, 0.04, 10.0)
TRUNK = mat('trunk', '#7a5a42', 0.9, 0.1, 10.0)
ROOF_RED = banded('roof_red', ['#c8653d', '#d27448', '#bb5c37'], 14.0, 0.3, 0.3, 0.8)
ROOF_BLUE = banded('roof_blue', ['#6f8496', '#7d93a6', '#677b8c'], 14.0, 0.3, 0.3, 0.8)
ROOF_BROWN = banded('roof_brown', ['#9a6a48', '#a87656', '#8f6142'], 14.0, 0.3, 0.3, 0.8)
TILE = mat('tile', '#c8653d', 0.85, 0.1, 9.0)
GLASS = mat('glass', '#5d6f7c', 0.4, 0, emit='#ffc46b')
SHUTTER_G = mat('shutter_g', '#7d9670', 0.8, 0.05)
SHUTTER_B = mat('shutter_b', '#7a8fa3', 0.8, 0.05)
SAIL = mat('sail', '#efe6d4', 0.95, 0.05, 6.0)
WOOL = mat('wool', '#f4efe4', 1.0, 0.04, 20.0)
SHEEP_FACE = mat('sheep_face', '#4a4040', 0.85, 0.05)
WATER = mat('water', '#6fb4d0', 0.1, 0.05, 3.0)
FOAM = mat('foam', '#eef6fa', 0.6, 0)
LH_RED = mat('lh_red', '#c8653d', 0.8, 0.04)
LH_WHITE = mat('lh_white', '#eee5d4', 0.8, 0.03)
HAY = mat('hay', '#dcbb6a', 0.95, 0.12, 18.0)
PUMPKIN = mat('pumpkin', '#d98a3e', 0.7, 0.08)
CLOTH_R = mat('cloth_r', '#c8653d', 0.95, 0.03)
CLOTH_W = mat('cloth_w', '#eee5d4', 0.95, 0.03)
FIRE = mat('fire', '#ffb04a', 0.9, 0, emit='#ffb04a')
# 잎: 앱에서 계절 색으로 바뀐다(leaf_orange = 머스터드, leaf_red = 황토, leaf_rust = 적갈)
LEAF = {
    'orange': mat('leaf_orange', '#e2b65a', 0.95, 0.08, 4.0),
    'red': mat('leaf_red', '#cf8a45', 0.95, 0.08, 4.0),
    'rust': mat('leaf_rust', '#b8673a', 0.95, 0.08, 4.0),
    'yellow': mat('leaf_yellow', '#e2b65a', 0.95, 0.08, 4.0),
    'green': mat('leaf_green', '#7f9a50', 0.95, 0.08, 4.0),
}
CLIFF_LEDGE = [mat('ledge_a', '#8a5a3f', 0.95, 0.08, 4.0), mat('ledge_b', '#a07858', 0.95, 0.08, 4.0)]
PINE = mat('pine', '#4f7a57', 0.95, 0.08, 5.0)
BUSH = mat('bush', '#7f9a50', 0.95, 0.08, 5.0)

# ── 모양 도우미 ───────────────────────────────────────

_tex = {}


def cloud_tex(size):
    key = round(size, 3)
    if key not in _tex:
        t = bpy.data.textures.new(f'clouds_{key}', 'CLOUDS')
        t.noise_scale = size
        t.noise_depth = 2
        _tex[key] = t
    return _tex[key]


def finish(o, m, smooth=True, bevel=0.0, seg=3, sub=0, disp=0.0, disp_size=0.5):
    o.data.materials.append(m)
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    if bevel > 0:
        b = o.modifiers.new('bevel', 'BEVEL')
        b.width = bevel
        b.segments = seg
        b.limit_method = 'ANGLE'
        b.harden_normals = True
    if sub:
        s = o.modifiers.new('sub', 'SUBSURF')
        s.levels = s.render_levels = sub
    if disp:
        d = o.modifiers.new('disp', 'DISPLACE')
        d.texture = cloud_tex(disp_size)
        d.texture_coords = 'GLOBAL'
        d.strength = disp
        d.mid_level = 0.5
    return o


def new_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    COL.objects.link(o)
    return o


def box(name, size, loc, m, rot=(0, 0, 0), bevel=0.02, seg=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    o = new_obj(name, bm)
    o.location = loc
    o.rotation_euler = rot
    return finish(o, m, bevel=bevel, seg=seg)


def cyl(name, r1, r2, depth, loc, m, seg=16, rot=(0, 0, 0), bevel=0.0, sub=0, disp=0.0, disp_size=0.5, caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth)
    o = new_obj(name, bm)
    o.location = loc
    o.rotation_euler = rot
    return finish(o, m, bevel=bevel, sub=sub, disp=disp, disp_size=disp_size)


def blob(name, r, loc, m, scale=(1, 1, 1), sub=3, disp=0.0, disp_size=0.5):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=max(1, sub - SUB_DROP), radius=r)
    o = new_obj(name, bm)
    o.location = loc
    o.scale = scale
    return finish(o, m, disp=disp, disp_size=disp_size)


def bake(objs, name, origin=None):
    """모디파이어를 적용하고 한 물체로 합친다. origin 을 주면 그 점을 기준점으로"""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target='MESH')
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    if origin is not None:
        scene.cursor.location = origin
        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    return o


def group(name, parts, loc, rot_z=0.0):
    e = bpy.data.objects.new(name, None)
    COL.objects.link(e)
    for p in parts:
        p.parent = e
    e.location = loc
    e.rotation_euler = (0, 0, rot_z)
    return e


# 겹치지 않게 놓기
taken = []


def free(x, y, r):
    return all((x - a) ** 2 + (y - b) ** 2 > (r + c) ** 2 for a, b, c in taken)


def block(x, y, r):
    taken.append((x, y, r))


def pick(inner, outer):
    a = rnd.random() * math.tau
    r = (inner + (outer - inner) * math.sqrt(rnd.random())) * R * rim_b(a)
    return math.cos(a) * r, math.sin(a) * r


# ── 섬 바닥 ───────────────────────────────────────────

def rim_cylinder(name, r, depth, z, m, bevel, seg=128, taper=1.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r * taper, radius2=r, depth=depth)
    for v in bm.verts:
        a = math.atan2(v.co.y, v.co.x)
        f = rim_b(a)
        v.co.x *= f
        v.co.y *= f
    o = new_obj(name, bm)
    o.location = (0, 0, z)
    return finish(o, m, bevel=bevel, seg=5)


def build_ground():
    # 윗면 잔디(둥근 모서리) + 흙띠 + 아래로 뾰족한 절벽
    rim_cylinder('ground_grass', R, 0.34, TOP - 0.17, GRASS, 0.16)
    rim_cylinder('ground_dirt', R * 0.985, 0.7, TOP - 0.62, DIRT, 0.1, taper=0.96)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=64, radius1=0.4, radius2=R * 0.93, depth=8.5)
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 0.1], cuts=34)
    for v in bm.verts:
        a = math.atan2(v.co.y, v.co.x)
        f = rim_b(a)
        # 층진 바위: 높이마다 턱이 지게(톱니 모양으로 안쪽으로 물러난다), 층 두께는 둘레를 따라 조금씩 다르다
        layer = (v.co.z * 2.6 + 0.35 * math.sin(a * 3 + 1.0)) % 1.0
        f *= 1 - 0.07 * layer * layer
        v.co.x *= f
        v.co.y *= f
        t = (4.25 - v.co.z) / 8.5  # 0 위 ~ 1 아래
        v.co.x += t * t * 0.9
        v.co.y += t * t * 0.5
    cliff = new_obj('ground_cliff', bm)
    cliff.location = (0, 0, TOP - 0.95 - 4.25)
    finish(cliff, CLIFF, sub=1, disp=0.35, disp_size=0.9)
    # 절벽에 박힌 바위 덩어리(위쪽에 많이)
    for i in range(80):
        a = rnd.random() * math.tau
        t = rnd.random() ** 1.7 * 0.75
        z = TOP - 0.95 - t * 8.5
        r = (R * 0.93 * (1 - t) + 0.4 * t) * rim_b(a) * 0.96
        c = Vector((math.cos(a) * r + t * t * 0.9, math.sin(a) * r + t * t * 0.5, z))
        s_ = (0.32 + rnd.random() * 0.4) * (1 - t * 0.6)
        # 절벽과 같은 흙·바위 색의 납작한 판(층진 턱처럼 보이게), 절반쯤 파묻는다
        o = blob(f'cliff_rock_{i}', s_, tuple(c * 0.97 + Vector((0, 0, c.z * 0.03))), CLIFF_LEDGE[i % 2], scale=(1.7, 1.4, 0.42), sub=2,
                 disp=0.1 * s_, disp_size=0.8 * s_)
        o.rotation_euler = (0, 0, a + math.pi / 2)
    # 언덕
    blob('ground_hill', HILL_R, (HILL.x, HILL.y, 0.15), GRASS, scale=(1, 1, 0.42), sub=4, disp=0.08, disp_size=0.8)


# ── 강(앱의 강 경로와 같다) ─────────────────────────────

def river_points():
    a = three_angle(0.42)
    edge = Vector((math.cos(a), math.sin(a))) * R * rim_b(a)
    # 언덕 옆 샘 -> 마을 오른쪽 -> 다리 -> 앞쪽 호수(LAKE) -> 가장자리 폭포
    return [scr(-0.5, 5.6), scr(0.9, 3.2), scr(0.6, 0.9), scr(1.7, -1.2), LAKE.copy(), edge * 0.9, edge]


LAKE, LAKE_R = scr(3.3, -3.4), (2.0, 1.5)


def catmull(pts, n):
    out = []
    P = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1])
    return out


def build_river():
    pts = catmull(river_points(), 16)
    for p in pts:
        block(p.x, p.y, 0.55)
    bm = bmesh.new()
    left, right = [], []
    for i, p in enumerate(pts):
        tan = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = Vector((-tan.y, tan.x)) * 0.36
        left.append(bm.verts.new((p.x + side.x, p.y + side.y, TOP + 0.012)))
        right.append(bm.verts.new((p.x - side.x, p.y - side.y, TOP + 0.012)))
    for i in range(len(pts) - 1):
        bm.faces.new([left[i], right[i], right[i + 1], left[i + 1]])
    finish(new_obj('water_river', bm), WATER)
    # 강둑 자갈
    for i in range(0, len(pts) - 2, 2):
        p = pts[i]
        tan = (pts[i + 1] - p).normalized()
        for s in (-1, 1):
            if rnd.random() < 0.55:
                side = Vector((-tan.y, tan.x)) * s * (0.42 + rnd.random() * 0.1)
                blob(f'pebble_{i}_{s}', 0.07 + rnd.random() * 0.06, (p.x + side.x, p.y + side.y, TOP + 0.02), STONE,
                     scale=(1.3, 1, 0.6), sub=2, disp=0.03, disp_size=0.2)
    # 폭포 시트(미리보기용, 앱에서는 코드 폭포가 그린다)
    a = three_angle(0.42)
    out = Vector((math.cos(a), math.sin(a)))
    o = Vector((out.x, out.y)) * R * rim_b(a)
    side = Vector((-out.y, out.x))
    bm = bmesh.new()
    rows = []
    for k in range(25):
        s = k / 24
        c = o + out * (1.4 * (1 - math.exp(-s * 6)))
        z = TOP - s * 14
        w = 0.36 * (1 + s * 1.4)
        rows.append((bm.verts.new((c.x + side.x * w, c.y + side.y * w, z)), bm.verts.new((c.x - side.x * w, c.y - side.y * w, z))))
    for k in range(24):
        bm.faces.new([rows[k][0], rows[k][1], rows[k + 1][1], rows[k + 1][0]])
    finish(new_obj('water_fall', bm), mat('fall', '#d8f0ff', 0.2, 0, alpha=0.85))


# ── 나무 ─────────────────────────────────────────────

def leafy_tree(name, x, y, h, color):
    z = surface(x, y) - 0.03
    parts = [cyl(f'{name}_trunk', 0.075 * h, 0.05 * h, 0.75 * h, (x, y, z + 0.37 * h), TRUNK, seg=8, bevel=0.01)]
    # 가지 둘
    for k in range(2):
        a = rnd.random() * math.tau
        br = cyl(f'{name}_br{k}', 0.03 * h, 0.018 * h, 0.35 * h, (x + math.cos(a) * 0.08 * h, y + math.sin(a) * 0.08 * h, z + 0.6 * h),
                 TRUNK, seg=6, rot=(math.cos(a + 1.57) * 0.7, math.sin(a + 1.57) * 0.7, 0))
        parts.append(br)
    cz = z + 0.95 * h
    n = rnd.randint(6, 9)
    leaf = LEAF[color]
    parts.append(blob(f'{name}_top', 0.36 * h, (x, y, cz + 0.12 * h), leaf, sub=3, disp=0.07 * h, disp_size=0.25 * h))
    for k in range(n):
        a = k / n * math.tau + rnd.random() * 0.5
        rr = (0.22 + rnd.random() * 0.12) * h
        d = (0.24 + rnd.random() * 0.1) * h
        parts.append(blob(f'{name}_b{k}', rr, (x + math.cos(a) * d, y + math.sin(a) * d, cz + (rnd.random() - 0.6) * 0.22 * h), leaf,
                          sub=3, disp=0.06 * h, disp_size=0.22 * h))
    return bake(parts, name, origin=(x, y, z))


def pine_tree(name, x, y, h):
    z = surface(x, y) - 0.03
    parts = [cyl(f'{name}_trunk', 0.06 * h, 0.04 * h, 0.4 * h, (x, y, z + 0.2 * h), TRUNK, seg=8)]
    tiers = 4
    for k in range(tiers):
        t = k / tiers
        r = (0.42 - t * 0.28) * h
        dz = z + (0.3 + t * 0.62) * h
        parts.append(cyl(f'{name}_t{k}', r, r * 0.12, 0.42 * h, (x, y, dz + 0.21 * h), PINE, seg=14, sub=1, disp=0.035 * h, disp_size=0.15 * h))
    return bake(parts, name, origin=(x, y, z))


def bush(name, x, y, s):
    z = surface(x, y)
    parts = []
    for k in range(rnd.randint(2, 4)):
        a = rnd.random() * math.tau
        parts.append(blob(f'{name}_{k}', s * (0.7 + rnd.random() * 0.4), (x + math.cos(a) * s * 0.6, y + math.sin(a) * s * 0.6, z + s * 0.35),
                          BUSH, scale=(1, 1, 0.75), sub=2, disp=0.08 * s, disp_size=0.3 * s))
    return bake(parts, name)


# ── 집 ───────────────────────────────────────────────

def house(name, x, y, rot, w, d, h, roof, shutter):
    """반목조 집: 돌 기단, 회벽, 나무 뼈대, 처마 깊은 기와지붕, 굴뚝, 덧창·창가 화분"""
    P = []
    P.append(box(f'{name}_base', (w + 0.1, d + 0.1, 0.16), (0, 0, 0.08), STONE, bevel=0.03))
    P.append(box(f'{name}_wall', (w, d, h), (0, 0, 0.16 + h / 2), PLASTER, bevel=0.025))
    top = 0.16 + h
    # 나무 뼈대: 모서리 기둥, 가운데 가로대
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.append(box(f'{name}_post', (0.07, 0.07, h), (sx * w / 2, sy * d / 2, 0.16 + h / 2), DARKWOOD, bevel=0.01))
    for sy in (-1, 1):
        P.append(box(f'{name}_beam', (w + 0.04, 0.06, 0.06), (0, sy * (d / 2 + 0.01), 0.16 + h * 0.55), DARKWOOD, bevel=0.01))
        P.append(box(f'{name}_beam_t', (w + 0.04, 0.06, 0.06), (0, sy * (d / 2 + 0.01), top - 0.03), DARKWOOD, bevel=0.01))
    # 박공(삼각 벽)
    pitch = math.radians(42)
    rise = (w / 2) * math.tan(pitch)
    for sy in (-1, 1):
        bm = bmesh.new()
        vs = [bm.verts.new(v) for v in ((-w / 2, 0, 0), (w / 2, 0, 0), (0, 0, rise))]
        f = bm.faces.new(vs)
        bmesh.ops.solidify(bm, geom=[f], thickness=0.04)
        g = new_obj(f'{name}_gable', bm)
        g.location = (0, sy * d / 2, top)
        P.append(finish(g, PLASTER, smooth=False))
        P.append(box(f'{name}_gx', (0.05, 0.05, rise * 0.8), (0, sy * (d / 2 + 0.02), top + rise * 0.4), DARKWOOD, bevel=0.01))
    # 지붕 두 장(처마가 튀어나온다)
    slope = (w / 2 + 0.18) / math.cos(pitch)
    for sx in (-1, 1):
        P.append(box(f'{name}_roof', (slope, d + 0.34, 0.08),
                     (sx * (w / 4 + 0.09) * 0.98, 0, top + rise / 2 - 0.01 + 0.04),
                     roof, rot=(0, sx * pitch, 0), bevel=0.03, seg=3))
    P.append(cyl(f'{name}_ridge', 0.055, 0.055, d + 0.38, (0, 0, top + rise + 0.05), roof, seg=12, rot=(math.pi / 2, 0, 0)))
    # 굴뚝
    P.append(box(f'{name}_chim', (0.2, 0.2, 0.55), (w * 0.22, -d * 0.2, top + rise * 0.6 + 0.15), STONE, bevel=0.02))
    P.append(box(f'{name}_chimcap', (0.26, 0.26, 0.05), (w * 0.22, -d * 0.2, top + rise * 0.6 + 0.44), DARKWOOD, bevel=0.01))
    # 문(앞 = -y)
    P.append(box(f'{name}_door', (0.26, 0.04, 0.44), (0, -d / 2 - 0.02, 0.16 + 0.22), WOOD, bevel=0.015))
    P.append(box(f'{name}_doorframe', (0.34, 0.03, 0.5), (0, -d / 2 - 0.005, 0.16 + 0.25), DARKWOOD, bevel=0.01))
    P.append(box(f'{name}_step', (0.4, 0.16, 0.06), (0, -d / 2 - 0.1, 0.03), STONE, bevel=0.02))
    # 창문: 앞·뒤 두 개씩, 옆 한 개
    def window(cx, cy, cz, ry):
        rot = (0, 0, ry)
        c, s = math.cos(ry), math.sin(ry)
        off = lambda dx, dy: (cx + dx * c - dy * s, cy + dx * s + dy * c, cz)
        P.append(box(f'{name}_glass', (0.2, 0.03, 0.22), off(0, 0), GLASS, rot=rot, bevel=0.005))
        P.append(box(f'{name}_frame', (0.25, 0.025, 0.27), off(0, 0.008), PLASTER, rot=rot, bevel=0.005))
        for k in (-1, 1):
            P.append(box(f'{name}_shut', (0.09, 0.03, 0.26), off(k * 0.17, -0.01), shutter, rot=rot, bevel=0.008))
        P.append(box(f'{name}_box', (0.26, 0.08, 0.06), (off(0, -0.05)[0], off(0, -0.05)[1], cz - 0.15), WOOD, rot=rot, bevel=0.01))
        for k in range(4):
            fl = off(-0.09 + k * 0.06, -0.06)
            P.append(blob(f'{name}_fl', 0.032, (fl[0], fl[1], cz - 0.1), mat('flower_r', '#e8475a', 0.6, 0) if k % 2 else mat('flower_y', '#ffd24a', 0.6, 0), sub=1))
    wz = 0.16 + h * 0.62
    for sx in (-1, 1):
        window(sx * w * 0.28, -d / 2 - 0.02, wz, 0)
        window(sx * w * 0.28, d / 2 + 0.02, wz, math.pi)
    window(w / 2 + 0.02, 0, wz, math.pi / 2)
    window(-w / 2 - 0.02, 0, wz, -math.pi / 2)
    o = bake(P, name, origin=(0, 0, 0))
    o.location = (x, y, surface(x, y) - 0.04)
    o.rotation_euler = (0, 0, rot)
    block(x, y, max(w, d) * 1.15)
    return o


# ── 풍차 ─────────────────────────────────────────────

def windmill(x, y, rot):
    z = surface(x, y) - 0.08
    P = [cyl('mill_base', 0.78, 0.72, 0.3, (0, 0, 0.15), STONE, seg=10, bevel=0.03),
         cyl('mill_tower', 0.68, 0.44, 2.3, (0, 0, 0.3 + 1.15), PLASTER, seg=10, bevel=0.025)]
    # 판자 띠
    for k in range(3):
        zz = 0.6 + k * 0.7
        r = 0.68 - (zz - 0.3) / 2.3 * 0.24
        P.append(cyl(f'mill_band{k}', r + 0.02, r + 0.015, 0.06, (0, 0, zz), DARKWOOD, seg=10))
    P.append(cyl('mill_cap', 0.56, 0.08, 0.75, (0, 0, 2.6 + 0.37), ROOF_RED, seg=10, bevel=0.02))
    P.append(cyl('mill_rim', 0.58, 0.56, 0.08, (0, 0, 2.62), DARKWOOD, seg=10))
    # 문·창
    P.append(box('mill_door', (0.3, 0.05, 0.5), (0, -0.72, 0.55), WOOD, bevel=0.015))
    P.append(box('mill_win', (0.18, 0.05, 0.22), (0, -0.56, 1.7), GLASS, bevel=0.01))
    P.append(box('mill_winf', (0.24, 0.04, 0.28), (0, -0.55, 1.7), DARKWOOD, bevel=0.01))
    # 발코니
    P.append(cyl('mill_balc', 0.82, 0.82, 0.05, (0, 0, 1.2), WOOD, seg=16))
    for k in range(16):
        a = k / 16 * math.tau
        P.append(box('mill_rail', (0.03, 0.03, 0.22), (math.cos(a) * 0.8, math.sin(a) * 0.8, 1.33), DARKWOOD, bevel=0.0))
    P.append(cyl('mill_railtop', 0.81, 0.81, 0.025, (0, 0, 1.44), DARKWOOD, seg=16, caps=False))
    body = bake(P, 'mill_body', origin=(0, 0, 0))
    body.location = (x, y, z)
    body.rotation_euler = (0, 0, rot)
    # 날개: 회전축이 기준점인 따로 된 물체(앱에서 돌린다)
    H = [cyl('hub', 0.11, 0.11, 0.3, (0, 0, 0), DARKWOOD, seg=12, rot=(math.pi / 2, 0, 0))]
    for k in range(4):
        a = k * math.pi / 2
        c, s = math.cos(a), math.sin(a)
        H.append(box('arm', (0.07, 0.05, 1.9), (c * 0.0 + s * 0.95, -0.12, c * 0.95), WOOD, rot=(0, a, 0), bevel=0.01))
        # 살(격자) + 천
        for j in range(7):
            t = 0.45 + j * 0.22
            H.append(box('slat', (0.36, 0.025, 0.025), (s * t + c * 0.2, -0.13, c * t - s * 0.2), WOOD, rot=(0, a, 0), bevel=0.0))
        H.append(box('cloth', (0.3, 0.012, 1.3), (s * 1.12 + c * 0.2, -0.14, c * 1.12 - s * 0.2), SAIL, rot=(0, a, 0), bevel=0.0))
    hub = bake(H, 'mill_hub', origin=(0, 0, 0))
    hub.parent = body
    hub.location = (0, -0.62, 2.25)
    block(x, y, 1.0)
    return body


# ── 등대 ─────────────────────────────────────────────

def lighthouse(x, y):
    z = surface(x, y) - 0.05
    P = [cyl('lh_base', 0.62, 0.58, 0.28, (0, 0, 0.14), STONE, seg=16, bevel=0.03)]
    for k in range(6):
        r1 = 0.48 - k * 0.04
        P.append(cyl(f'lh_{k}', r1, r1 - 0.04, 0.42, (0, 0, 0.28 + 0.21 + k * 0.42), LH_RED if k % 2 else LH_WHITE, seg=24, bevel=0.01))
    top = 0.28 + 6 * 0.42
    P.append(cyl('lh_gallery', 0.42, 0.42, 0.07, (0, 0, top + 0.035), DARKWOOD, seg=24))
    for k in range(20):
        a = k / 20 * math.tau
        P.append(box('lh_rail', (0.025, 0.025, 0.2), (math.cos(a) * 0.4, math.sin(a) * 0.4, top + 0.17), DARKWOOD, bevel=0))
    P.append(cyl('lh_railtop', 0.405, 0.405, 0.02, (0, 0, top + 0.27), DARKWOOD, seg=24, caps=False))
    P.append(cyl('lh_lamp', 0.22, 0.22, 0.34, (0, 0, top + 0.24), GLASS, seg=16))
    P.append(cyl('lh_roof', 0.3, 0.04, 0.32, (0, 0, top + 0.57), LH_RED, seg=16, bevel=0.02))
    P.append(blob('lh_ball', 0.05, (0, 0, top + 0.75), DARKWOOD, sub=2))
    P.append(box('lh_door', (0.2, 0.05, 0.34), (0, -0.47, 0.45), WOOD, bevel=0.01))
    o = bake(P, 'lighthouse', origin=(0, 0, 0))
    o.location = (x, y, z)
    block(x, y, 0.8)
    return o


# ── 소품 ─────────────────────────────────────────────

def sheep(name, x, y, rot):
    z = surface(x, y)
    P = [blob(f'{name}_body', 0.2, (0, 0, 0.26), WOOL, scale=(1.35, 1, 0.95), sub=3, disp=0.06, disp_size=0.06)]
    P.append(blob(f'{name}_head', 0.085, (0.27, 0, 0.32), SHEEP_FACE, scale=(1.3, 0.9, 1), sub=2))
    P.append(blob(f'{name}_tuft', 0.07, (0.24, 0, 0.4), WOOL, sub=2, disp=0.02, disp_size=0.03))
    for s in (-1, 1):
        P.append(blob(f'{name}_ear', 0.035, (0.25, s * 0.08, 0.36), SHEEP_FACE, scale=(0.6, 1.6, 0.5), sub=1))
    for dx in (-0.13, 0.13):
        for dy in (-0.08, 0.08):
            P.append(cyl(f'{name}_leg', 0.028, 0.024, 0.16, (dx, dy, 0.08), SHEEP_FACE, seg=6))
    o = bake(P, name, origin=(0, 0, 0))
    o.location = (x, y, z)
    o.rotation_euler = (0, 0, rot)
    return o


def fence_ring(name, cx, cy, radius, gate):
    n = max(10, round(radius * 10))
    P = []
    for i in range(n):
        a = i / n * math.tau
        P.append(box(f'{name}_p', (0.06, 0.06, 0.34), (math.cos(a) * radius, math.sin(a) * radius, 0.17), WOOD, bevel=0.012))
        mid = a + math.pi / n
        if abs(math.atan2(math.sin(mid - gate), math.cos(mid - gate))) < math.pi / n:
            continue
        L = 2 * radius * math.sin(math.pi / n)
        rr = radius * math.cos(math.pi / n)
        for zz in (0.13, 0.26):
            P.append(box(f'{name}_r', (L + 0.04, 0.035, 0.045), (math.cos(mid) * rr, math.sin(mid) * rr, zz), WOOD, rot=(0, 0, mid + math.pi / 2), bevel=0.008))
    o = bake(P, name, origin=(0, 0, 0))
    o.location = (cx, cy, surface(cx, cy) - 0.02)
    return o


def well(x, y):
    z = surface(x, y)
    P = [cyl('well_ring', 0.34, 0.36, 0.36, (0, 0, 0.18), STONE, seg=20, bevel=0.03, disp=0.025, disp_size=0.08),
         cyl('well_water', 0.28, 0.28, 0.02, (0, 0, 0.3), WATER, seg=20)]
    for s in (-1, 1):
        P.append(box('well_post', (0.06, 0.06, 0.7), (s * 0.3, 0, 0.55), DARKWOOD, bevel=0.01))
    P.append(cyl('well_axle', 0.025, 0.025, 0.66, (0, 0, 0.72), DARKWOOD, seg=8, rot=(0, math.pi / 2, 0)))
    for s in (-1, 1):
        P.append(box('well_roof', (0.78, 0.3, 0.04), (0, s * 0.12, 0.98), ROOF_RED, rot=(s * 0.75, 0, 0), bevel=0.012))
    P.append(cyl('well_bucket', 0.07, 0.06, 0.1, (0.0, 0.0, 0.55), WOOD, seg=10))
    o = bake(P, 'well', origin=(0, 0, 0))
    o.location = (x, y, z)
    block(x, y, 0.5)
    return o


def rock(name, x, y, s):
    o = blob(name, s, (x, y, surface(x, y) + s * 0.1), STONE, scale=(1.2, 1, 0.65), sub=2, disp=0.35 * s, disp_size=0.6 * s)
    o.rotation_euler = (0, 0, rnd.random() * math.tau)
    return o


def hay(x, y):
    z = surface(x, y)
    o = cyl('hay', 0.16, 0.16, 0.26, (x, y, z + 0.16), HAY, seg=16, rot=(math.pi / 2, 0, rnd.random() * math.pi), bevel=0.04)
    block(x, y, 0.25)
    return o


def lamp(x, y):
    z = surface(x, y)
    P = [cyl('lamp_post', 0.03, 0.04, 0.9, (0, 0, 0.45), DARKWOOD, seg=8),
         box('lamp_box', (0.12, 0.12, 0.16), (0, 0, 0.95), GLASS, bevel=0.01),
         cyl('lamp_cap', 0.11, 0.02, 0.1, (0, 0, 1.08), DARKWOOD, seg=8)]
    o = bake(P, 'lamp', origin=(0, 0, 0))
    o.location = (x, y, z)
    block(x, y, 0.2)
    return o


def stepping_stones(points):
    for i in range(len(points) - 1):
        a, b = Vector(points[i]), Vector(points[i + 1])
        n = max(1, int((b - a).length / 0.36))
        for k in range(n):
            p = a.lerp(b, k / n) + Vector(((rnd.random() - 0.5) * 0.1, (rnd.random() - 0.5) * 0.1))
            if not free(p.x, p.y, 0.05) and k:
                pass
            cyl('stone_step', 0.15, 0.17, 0.05, (p.x, p.y, surface(p.x, p.y) + 0.01), PATH, seg=8, bevel=0.02,
                rot=(0, 0, rnd.random() * math.pi))
            block(p.x, p.y, 0.22)


def flowers(count):
    colors = ['#ffffff', '#ffd84a', '#ff9ec4', '#b9a2ff', '#ff6a5a']
    bms = [bmesh.new() for _ in colors]
    placed = 0
    for i in range(count * 8):
        if placed >= count:
            break
        x, y = pick(0.05, 0.95)
        if not free(x, y, 0.02):
            continue
        # 무리 지어 핀다
        k = i % len(colors)
        for j in range(rnd.randint(3, 7)):
            fx, fy = x + (rnd.random() - 0.5) * 0.35, y + (rnd.random() - 0.5) * 0.35
            if not free(fx, fy, 0.0):
                continue
            z = surface(fx, fy) + 0.05
            bmesh.ops.create_icosphere(bms[k], subdivisions=1, radius=0.035 + rnd.random() * 0.015, matrix=Matrix.Translation((fx, fy, z)))
            bmesh.ops.create_cone(bms[k], cap_ends=False, segments=4, radius1=0.006, radius2=0.006, depth=0.06,
                                  matrix=Matrix.Translation((fx, fy, z - 0.03)))
            placed += 1
    for k, c in enumerate(colors):
        finish(new_obj(f'flowers_{k}', bms[k]), mat(f'flower_{k}', c, 0.6, 0.05))


def setup_render(cam_loc, cam_target):
    """Cycles·하늘·해·카메라"""

    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    scene.cycles.device = 'CPU'
    for kind in ('OPTIX', 'CUDA', 'HIP', 'METAL'):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
        except Exception:
            continue
        gpus = [d for d in prefs.devices if d.type != 'CPU']
        if gpus:
            for d in prefs.devices:
                d.use = d.type != 'CPU'
            scene.cycles.device = 'GPU'
            print('render device:', kind, [d.name for d in gpus], flush=True)
            break
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'

    world = bpy.data.worlds.new('sky')
    scene.world = world
    world.use_nodes = True
    wn = world.node_tree.nodes
    bg = wn['Background']
    bg.inputs['Color'].default_value = lin('#cfe3f5')
    bg.inputs['Strength'].default_value = 1.0

    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    COL.objects.link(sun)
    sun.data.energy = 3.2
    sun.data.color = (1.0, 0.9, 0.78)
    sun.data.angle = math.radians(12)
    sun.rotation_euler = (math.radians(48), 0, math.radians(-35))

    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    COL.objects.link(cam)
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle = math.radians(38)
    cam.location = cam_loc
    cam.rotation_euler = (Vector(cam_target) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = 1200, 800



GROUND_MATS = {'grass', 'grass_dark', 'path', 'cliff', 'dirt', 'sand', 'ledge_a', 'ledge_b'}
GROUND_UV_SCALE = 4.0


def bake_lightmap(path, size, samples):
    """하늘에서만 오는 흰 간접광 + 틈 그늘(AO)을 라이트맵 한 장에 굽는다(해·불빛은 굽지 않는다).
    앱이 이 값에 시간대·날씨의 하늘색을 곱하고 해는 실시간으로 얹는다. 꽃은 너무 잘아서 뺀다."""
    objs = [o for o in bpy.data.objects if o.type == 'MESH' and not o.name.startswith('flowers_')]
    for o in objs:
        uv = o.data.uv_layers.new(name='lightmap')
        o.data.uv_layers.active = uv
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0015, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    # 넓은 땅(잔디·흙길·절벽)은 화면에서 크게 보이므로 라이트맵 해상도를 더 준다(섬 단위로 같은 배율이라 모양은 그대로)
    for o in objs:
        names = [m.name if m else '' for m in o.data.materials]
        uv = o.data.uv_layers['lightmap'].data
        for poly in o.data.polygons:
            if names and names[poly.material_index] in GROUND_MATS:
                for li in poly.loop_indices:
                    uv[li].uv *= GROUND_UV_SCALE
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(margin=0.0015, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')

    img = bpy.data.images.new('lightmap', size, size, float_buffer=True)
    # 굽는 동안만: 불빛을 끄고, 꼭짓점 색을 바탕색에 곱해 튀는 빛 색이 맞게, 구울 그림을 고른다
    undo = []
    for m in {s.material for o in objs for s in o.material_slots if s.material}:
        nt = m.node_tree
        b = nt.nodes['Principled BSDF']
        em = b.inputs['Emission Strength'].default_value
        b.inputs['Emission Strength'].default_value = 0
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1
        mix.inputs[6].default_value = b.inputs['Base Color'].default_value
        nt.links.new(vc.outputs['Color'], mix.inputs[7])
        nt.links.new(mix.outputs[2], b.inputs['Base Color'])
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        nt.nodes.active = tex
        undo.append((m, b, em, [vc, mix, tex]))
    world = scene.world or bpy.data.worlds.new('sky')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    scene.cycles.samples = samples
    scene.render.bake.margin = 6
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=6, use_clear=True)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    print('lightmap', path, flush=True)
    for m, b, em, nodes in undo:
        b.inputs['Emission Strength'].default_value = em
        for nd in nodes:
            m.node_tree.nodes.remove(nd)


def export_glb(path, join=True, lightmap=None, size=2048, samples=512, layout=None):
    # 미리보기 전용(물·구름·조명·카메라)은 빼고, 앱에서 바꾸지 않는 물체는 하나로 합친다
    for o in list(bpy.data.objects):
        if o.name.startswith(('water_', 'cloud_')) or o.type in ('LIGHT', 'CAMERA'):
            bpy.data.objects.remove(o, do_unlink=True)
    # 노드로 만든 얼룩·띠는 glTF 로 못 내보내므로, 꼭짓점 색에 새겨 넣고 재질은 평균 색으로 바꾼다
    paint = {}
    for m in bpy.data.materials:
        if not m.node_tree:
            continue
        b = m.node_tree.nodes.get('Principled BSDF')
        if not b:
            continue
        ramp = next((nd for nd in m.node_tree.nodes if nd.type == 'VALTORGB'), None)
        wave = next((nd for nd in m.node_tree.nodes if nd.type == 'TEX_WAVE'), None)
        nz = next((nd for nd in m.node_tree.nodes if nd.type == 'TEX_NOISE'), None)
        if ramp and wave:
            # 띠(절벽·기와): 꼭짓점 색이 곧 색, 재질은 흰색
            paint[m.name] = ('band', [tuple(e.color[:3]) for e in ramp.color_ramp.elements], wave.inputs['Scale'].default_value)
            b.inputs['Base Color'].default_value = (1, 1, 1, 1)
        elif ramp and nz:
            els = ramp.color_ramp.elements
            lo, hi = els[0].color, els[1].color
            mid = [(lo[i] + hi[i]) / 2 for i in range(3)]
            var = (hi[0] - lo[0]) / max(1e-4, hi[0] + lo[0])
            paint[m.name] = ('noise', var, nz.inputs['Scale'].default_value)
            # 꼭짓점 색(평균 0.9)을 곱하므로 재질은 그만큼 밝게
            b.inputs['Base Color'].default_value = tuple(min(1, c / 0.9) for c in mid) + (1,)
        for sock in ('Base Color', 'Normal'):
            for l in list(b.inputs[sock].links):
                m.node_tree.links.remove(l)
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.objects:
        o.select_set(o.type == 'MESH')
    bpy.ops.object.convert(target='MESH')
    # 안 보이는 면(섬 바닥 층들이 맞닿는 덮개)은 지운다. 라이트맵 자리를 아낀다
    hidden = {'ground_grass': lambda n: n.z < -0.9, 'ground_dirt': lambda n: abs(n.z) > 0.9, 'ground_cliff': lambda n: n.z > 0.9}
    for name, test in hidden.items():
        o = bpy.data.objects.get(name)
        if not o:
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if test(f.normal)], context='FACES')
        bm.to_mesh(o.data)
        bm.free()
    # 언덕은 땅 속에 묻힌 아래쪽을 지운다
    o = bpy.data.objects.get('ground_hill')
    if o:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if (o.matrix_world @ f.calc_center_median()).z < TOP - 0.06], context='FACES')
        bm.to_mesh(o.data)
        bm.free()
    if join:
        keep = lambda o: o.name.startswith(('tree_', 'mill_', 'flowers_')) or o.parent is not None
        rest = [o for o in bpy.data.objects if o.type == 'MESH' and not keep(o)]
        bake(rest, 'static')
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.objects:
        o.select_set(o.type in ('MESH', 'EMPTY'))
    bpy.ops.object.convert(target='MESH')
    from mathutils import noise as mnoise
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        me = o.data
        attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
        mw = o.matrix_world
        for poly in me.polygons:
            mname = me.materials[poly.material_index].name if me.materials else ''
            rule = paint.get(mname)
            for li in poly.loop_indices:
                co = mw @ me.vertices[me.loops[li].vertex_index].co
                if not rule:
                    c = (1, 1, 1)
                elif rule[0] == 'band':
                    cols, sc = rule[1], rule[2]
                    t = 0.5 + 0.5 * math.sin(co.z * sc * 1.4 + mnoise.noise(co * 0.6) * 2.2)
                    f = t * (len(cols) - 1)
                    i0 = min(int(f), len(cols) - 2)
                    k = f - i0
                    c = tuple(cols[i0][j] * (1 - k) + cols[i0 + 1][j] * k for j in range(3))
                else:
                    var, sc = rule[1], rule[2]
                    n = mnoise.noise(co * sc * 0.5)
                    v = 0.9 + n * min(0.12, var * 0.9)
                    c = (v, v, v)
                attr.data[li].color = (*c, 1)
        me.color_attributes.active_color = attr
    if lightmap:
        bake_lightmap(lightmap, size, samples)
    if layout is not None:
        # 앱이 쓸 자리(강 경로·불빛 등)를 'layout' 빈 물체의 extras 로 함께 내보낸다(앱: userData.layout)
        import json
        e = bpy.data.objects.new('layout', None)
        COL.objects.link(e)
        e['layout'] = json.dumps(layout)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_apply=True, export_extras=True,
                              export_vertex_color='ACTIVE', export_draco_mesh_compression_enable=True,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12)
    print('exported', path, flush=True)


