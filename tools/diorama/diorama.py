# Blender 4.5 headless: 장면 파일의 배치대로 디오라마를 조합하고 낮/밤 조명을 텍스처에 구워 GLB 로 내보낸다.
# usage: Blender -b -P diorama.py -- <scene.py> <mid_dir> <out_dir> [preview|bake] [samples]
# 장면 파일은 바닥·요소를 만들고 NAME, LAMPS[(loc, power, color)], CAM_LOC, CAM_TARGET, GLOW 를 정한다.
import bpy, bmesh, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SCENE, MID, OUT = argv[0], argv[1], argv[2]
MODE = argv[3] if len(argv) > 3 else 'preview'
SAMPLES = int(argv[4]) if len(argv) > 4 else 64
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
# GPU 가 잡히면(Apple Silicon 의 Metal, NVIDIA 의 OptiX/CUDA, AMD 의 HIP) GPU 로 굽는다. 몇 배 빠르다
_prefs = bpy.context.preferences.addons['cycles'].preferences
for _kind in ('METAL', 'OPTIX', 'CUDA', 'HIP'):
    try:
        _prefs.compute_device_type = _kind
        _prefs.get_devices()
    except Exception:
        continue
    _gpus = [d for d in _prefs.devices if d.type != 'CPU']
    if _gpus:
        for d in _prefs.devices:
            d.use = d.type != 'CPU'
        scene.cycles.device = 'GPU'
        print('render device:', _kind, [d.name for d in _gpus])
        break
scene.cycles.samples = SAMPLES
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'

statics = []  # 구울 물체들


def import_part(name, height, x, y, rot_deg=0.0):
    """mid/<name>.glb 를 불러와 높이를 맞추고 발밑을 (x,y,0)에 둔다. 정면은 -Y(카메라 쪽)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MID, name + '.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    # 부모(빈 노드)를 떼고 변환을 적용
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    for o in new:
        if o != obj and o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # 데이터·재질을 이 물체 전용으로(같은 모델을 여러 번 놓아도 따로 굽게)
    obj.data = obj.data.copy()
    obj.data.materials[0] = obj.data.materials[0].copy()
    bb = [Vector(c) for c in obj.bound_box]
    minz = min(v.z for v in bb); maxz = max(v.z for v in bb)
    cx = (min(v.x for v in bb) + max(v.x for v in bb)) / 2
    cy = (min(v.y for v in bb) + max(v.y for v in bb)) / 2
    s = height / (maxz - minz)
    obj.data.transform(__import__('mathutils').Matrix.Translation((-cx, -cy, -minz)))
    obj.scale = (s, s, s)
    obj.rotation_mode = 'XYZ'  # glTF 로 불러오면 쿼터니언 모드라 오일러 각이 무시된다
    # Tripo 모델은 불러오면 정면이 +X 라 -90° 돌려 -Y(카메라 쪽)를 보게 한 뒤 rot_deg 만큼 더 돌린다
    obj.rotation_euler = (0, 0, math.radians(rot_deg - 90))
    obj.location = (x, y, 0)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.name = f'{name}_{len(statics)}'
    # 클레이처럼 무광
    for m in obj.data.materials:
        b = m.node_tree.nodes.get('Principled BSDF')
        if b:
            b.inputs['Metallic'].default_value = 0.0
            for l in list(b.inputs['Metallic'].links) + list(b.inputs['Roughness'].links):
                m.node_tree.links.remove(l)
            b.inputs['Roughness'].default_value = 0.75
    statics.append(obj)
    return obj


def proc_material(name, build):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    build(nt, nt.nodes['Principled BSDF'])
    return m


def wood(nt, b):
    n, l = nt.nodes, nt.links
    tc = n.new('ShaderNodeTexCoord')
    wave = n.new('ShaderNodeTexWave'); wave.wave_type = 'BANDS'; wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 6.0; wave.inputs['Distortion'].default_value = 1.5
    wave.inputs['Detail'].default_value = 4.0
    l.new(tc.outputs['Object'], wave.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.16, 0.07, 0.03, 1)
    ramp.color_ramp.elements[1].color = (0.36, 0.17, 0.07, 1)
    l.new(wave.outputs['Fac'], ramp.inputs['Fac'])
    l.new(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.45


def cobble(nt, b):
    """줄지어 깔린 둥근 사각 돌. 돌마다 가운데가 솟고 가장자리로 갈수록 어두워진다."""
    n, l = nt.nodes, nt.links
    tc = n.new('ShaderNodeTexCoord')
    brick = n.new('ShaderNodeTexBrick')
    brick.offset = 0.5; brick.squash = 1.0
    brick.inputs['Scale'].default_value = 2.3
    brick.inputs['Mortar Size'].default_value = 0.035
    brick.inputs['Mortar Smooth'].default_value = 1.0
    brick.inputs['Bias'].default_value = 0.0
    brick.inputs['Brick Width'].default_value = 0.42
    brick.inputs['Row Height'].default_value = 0.3
    brick.inputs['Color1'].default_value = (0.50, 0.46, 0.42, 1)
    brick.inputs['Color2'].default_value = (0.64, 0.60, 0.55, 1)
    brick.inputs['Mortar'].default_value = (0.20, 0.18, 0.16, 1)
    l.new(tc.outputs['Object'], brick.inputs['Vector'])
    # 돌 표면의 얼룩
    noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 30.0
    l.new(tc.outputs['Object'], noise.inputs['Vector'])
    mix = n.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 0.25
    l.new(brick.outputs['Color'], mix.inputs['A'])
    l.new(noise.outputs['Color'], mix.inputs['B'])
    l.new(mix.outputs['Result'], b.inputs['Base Color'])
    # 줄눈(Fac=1)에서 돌 가운데로 둥글게 솟는 높이
    inv = n.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
    l.new(brick.outputs['Fac'], inv.inputs[1])
    dome = n.new('ShaderNodeMath'); dome.operation = 'POWER'; dome.inputs[1].default_value = 0.35
    l.new(inv.outputs['Value'], dome.inputs[0])
    bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.9; bump.inputs['Distance'].default_value = 0.05
    l.new(dome.outputs['Value'], bump.inputs['Height'])
    l.new(bump.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.8


def grass(nt, b):
    n, l = nt.nodes, nt.links
    tc = n.new('ShaderNodeTexCoord')
    noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 14.0
    l.new(tc.outputs['Object'], noise.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.10, 0.25, 0.05, 1)
    ramp.color_ramp.elements[1].color = (0.25, 0.48, 0.10, 1)
    l.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    l.new(ramp.outputs['Color'], b.inputs['Base Color'])
    bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.3
    l.new(noise.outputs['Fac'], bump.inputs['Height'])
    l.new(bump.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.9


def ground_obj(name, mesh_fn, mat):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new(); mesh_fn(bm); bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    statics.append(obj)
    return obj



def sand(nt, b):
    n, l = nt.nodes, nt.links
    tc = n.new('ShaderNodeTexCoord')
    noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 40.0
    l.new(tc.outputs['Object'], noise.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.55, 0.40, 0.24, 1)
    ramp.color_ramp.elements[1].color = (0.80, 0.64, 0.42, 1)
    l.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    l.new(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.95


def solid(color, rough=0.8):
    def build(nt, b):
        b.inputs['Base Color'].default_value = (*color, 1)
        b.inputs['Roughness'].default_value = rough
    return build


def disc_mesh(r, z=0.0, cx=0.0, cy=0.0, ry=None, seg=96):
    def build(bm):
        bm.faces.new([bm.verts.new((cx + math.cos(i / seg * math.tau) * r, cy + math.sin(i / seg * math.tau) * (ry or r), z)) for i in range(seg)])
    return build


def wood_base(R):
    def base_mesh(bm):
        M = __import__('mathutils').Matrix
        bmesh.ops.create_cone(bm, cap_ends=True, segments=96, radius1=R + 0.25, radius2=R + 0.12, depth=0.55, matrix=M.Translation((0, 0, -0.33)))
        bmesh.ops.create_cone(bm, cap_ends=True, segments=96, radius1=R + 0.05, radius2=R, depth=0.12, matrix=M.Translation((0, 0, -0.06)))
    ground_obj('base', base_mesh, proc_material('wood', wood))
    ground_obj('grass', disc_mesh(R, 0.004), proc_material('grass', grass))


BIG = ('base', 'grass', 'plaza')
exec(open(SCENE).read())

# ── 조명
world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); scene.collection.objects.link(sun)
sun.data.angle = math.radians(8)
lamps = []
for loc, power, color in LAMPS:
    l = bpy.data.objects.new('pt', bpy.data.lights.new('pt', 'POINT')); scene.collection.objects.link(l)
    l.location = loc; l.data.energy = power; l.data.color = color; l.data.shadow_soft_size = 0.15
    lamps.append(l)


def set_light(night):
    if night:
        bg.inputs['Color'].default_value = (0.05, 0.07, 0.16, 1); bg.inputs['Strength'].default_value = 0.6
        sun.data.energy = 0.35; sun.data.color = (0.6, 0.7, 1.0)
        sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    else:
        bg.inputs['Color'].default_value = (0.75, 0.78, 0.9, 1); bg.inputs['Strength'].default_value = 0.7
        sun.data.energy = 3.6; sun.data.color = (1.0, 0.85, 0.68)
        sun.rotation_euler = (math.radians(55), 0, math.radians(-40))
    for l in lamps:
        l.hide_render = not night


# 창문 불빛: 밤에는 텍스처의 노란 창문색을 스스로 빛나게 한다
def window_glow(on):
    for obj in statics:
        if not obj.name.startswith(GLOW):
            continue
        for m in obj.data.materials:
            nt = m.node_tree; b = nt.nodes['Principled BSDF']
            tex = next((n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.outputs['Color'].links
                        and any(l.to_socket == b.inputs['Base Color'] for l in n.outputs['Color'].links)), None)
            if not tex:
                continue
            g = nt.nodes.get('glowmask')
            if not g:
                hsv = nt.nodes.new('ShaderNodeSeparateColor'); hsv.mode = 'HSV'
                nt.links.new(tex.outputs['Color'], hsv.inputs['Color'])
                # 노란 계열(H 0.09~0.17) 이면서 밝은 곳
                h1 = nt.nodes.new('ShaderNodeMapRange'); h1.inputs['From Min'].default_value = 0.08; h1.inputs['From Max'].default_value = 0.1
                h2 = nt.nodes.new('ShaderNodeMapRange'); h2.inputs['From Min'].default_value = 0.18; h2.inputs['From Max'].default_value = 0.16
                v = nt.nodes.new('ShaderNodeMapRange'); v.inputs['From Min'].default_value = 0.7; v.inputs['From Max'].default_value = 0.85
                s = nt.nodes.new('ShaderNodeMapRange'); s.inputs['From Min'].default_value = 0.3; s.inputs['From Max'].default_value = 0.45
                nt.links.new(hsv.outputs['Red'], h1.inputs['Value']); nt.links.new(hsv.outputs['Red'], h2.inputs['Value'])
                nt.links.new(hsv.outputs['Blue'], v.inputs['Value']); nt.links.new(hsv.outputs['Green'], s.inputs['Value'])
                m1 = nt.nodes.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'
                m2 = nt.nodes.new('ShaderNodeMath'); m2.operation = 'MULTIPLY'
                g = nt.nodes.new('ShaderNodeMath'); g.operation = 'MULTIPLY'; g.name = 'glowmask'
                nt.links.new(h1.outputs['Result'], m1.inputs[0]); nt.links.new(h2.outputs['Result'], m1.inputs[1])
                nt.links.new(v.outputs['Result'], m2.inputs[0]); nt.links.new(s.outputs['Result'], m2.inputs[1])
                nt.links.new(m1.outputs['Value'], g.inputs[0]); nt.links.new(m2.outputs['Value'], g.inputs[1])
                nt.links.new(tex.outputs['Color'], b.inputs['Emission Color'])
                nt.links.new(g.outputs['Value'], b.inputs['Emission Strength'])
            b.inputs['Emission Strength'].default_value = 0
            # 꺼짐: 마스크 연결을 끊는다
            links = b.inputs['Emission Strength'].links
            if on and not links:
                nt.links.new(g.outputs['Value'], b.inputs['Emission Strength'])
            elif not on and links:
                nt.links.remove(links[0])
            if on:
                # 마스크 0~1 에 세기를 곱한다
                mul = nt.nodes.get('glowgain') or nt.nodes.new('ShaderNodeMath')
                mul.name = 'glowgain'; mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 6.0
                nt.links.new(g.outputs['Value'], mul.inputs[0])
                nt.links.new(mul.outputs['Value'], b.inputs['Emission Strength'])


# ── 카메라(컨셉 이미지 각도)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam)
cam.data.lens = 50
cam.location = CAM_LOC
d = Vector(CAM_TARGET) - cam.location
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
scene.render.resolution_x, scene.render.resolution_y = 1200, 900

if MODE == 'preview':
    for night in (False, True):
        set_light(night); window_glow(night)
        scene.render.filepath = os.path.join(OUT, 'preview_' + ('night' if night else 'day') + '.png')
        bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, NAME + '.blend'))
    sys.exit(0)

# ── 굽기: 물체마다 낮·밤 두 장을 구워, 낮은 baseColor, 밤은 emissive 텍스처로 내보낸다
scene.cycles.bake_type = 'COMBINED'
bk = scene.render.bake
bk.use_pass_direct = bk.use_pass_indirect = True
bk.use_pass_diffuse = bk.use_pass_emit = True
bk.use_pass_glossy = bk.use_pass_transmission = False
bk.margin = 8


def size_for(obj):
    return 2048 if obj.name.startswith(BIG) else 512


def ensure_uv(obj):
    if obj.data.uv_layers:
        return
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(island_margin=0.01)
    bpy.ops.object.mode_set(mode='OBJECT')


images = {}
for night in (False, True):
    set_light(night); window_glow(night)
    tag = 'night' if night else 'day'
    for obj in statics:
        ensure_uv(obj)
        sz = size_for(obj)
        # 빛 세기를 그대로 담도록 실수형으로 굽는다(저장할 때 렌더와 같은 색 보정을 입힌다)
        img = bpy.data.images.new(f'{obj.name}_{tag}', sz, sz, float_buffer=True)
        mat = obj.data.materials[0]
        node = mat.node_tree.nodes.new('ShaderNodeTexImage'); node.image = img; node.name = 'bake_' + tag
        mat.node_tree.nodes.active = node
        bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type='COMBINED')
        path = os.path.join(OUT, 'tex', img.name + '.png')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # save_render 는 장면의 보기 변환(AgX)을 적용해 저장한다 → 미리보기 렌더와 같은 색감
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_depth = '8'
        img.save_render(path, scene=scene)
        img = bpy.data.images.load(path)
        img.name = f'{obj.name}_{tag}_out'
        images[(obj.name, tag)] = img
        print('baked', obj.name, tag, flush=True)

# 내보낼 재질: 낮 텍스처 → Base Color, 밤 텍스처 → Emission (앱에서 둘을 섞는다)
for obj in statics:
    mat = bpy.data.materials.new(obj.name + '_baked'); mat.use_nodes = True
    nt = mat.node_tree; b = nt.nodes['Principled BSDF']
    for tag, sock in (('day', 'Base Color'), ('night', 'Emission Color')):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = images[(obj.name, tag)]
        nt.links.new(t.outputs['Color'], b.inputs[sock])
    b.inputs['Emission Strength'].default_value = 1.0
    obj.data.materials.clear(); obj.data.materials.append(mat)

bpy.ops.object.select_all(action='DESELECT')
for obj in statics:
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, NAME + '.glb'), use_selection=True,
                          export_image_format='JPEG', export_jpeg_quality=88, export_apply=True)
print('exported', flush=True)
