# 모든 테마가 함께 쓰는 소품 모음(나무·집·덤불·바위·양·가로등·우물·건초·울타리). 앱: public/models/props.glb
#   blender -b -P tools/blender/props.py -- <out_dir> [preview|glb]
# 소품마다 기준점이 바닥 가운데, 앞(문)은 -Y(앱에서는 +Z)다. 앱(src/scene/props.ts)이 이름으로 찾아 복제한다.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
from lib import *  # noqa: F401,F403

lib.surface = lambda x, y: 0.0
LEAF_ANY = mat('leaf', '#ec8f2c', 0.85, 0.22, 4.0, 0.5)
lib.LEAF['any'] = LEAF_ANY

made = []


def keep(o, x):
    """기준점을 (x, 0, 0) 바닥에 두고 목록에 넣는다(미리보기에서는 x 로 늘어놓는다)"""
    scene.cursor.location = (x, 0, 0)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    made.append(o)
    return o


x = 0.0
for i in range(3):
    keep(leafy_tree(f'tree_leafy_{i}', x, 0, 1.0, 'any'), x)
    x += 1.6
for i in range(2):
    keep(pine_tree(f'tree_pine_{i}', x, 0, 1.25), x)
    x += 1.4
houses = [(1.3, 1.0, 1.0, ROOF_RED, SHUTTER_G), (1.05, 0.85, 0.9, ROOF_BLUE, SHUTTER_B),
          (0.95, 0.8, 0.85, ROOF_BROWN, SHUTTER_G), (1.2, 0.9, 1.25, ROOF_RED, SHUTTER_B)]
for i, (w, d, h, roof, sh) in enumerate(houses):
    o = house(f'house_{i}', x, 0, 0, w, d, h, roof, sh)
    o.location.z = 0
    made.append(o)
    x += 2.0
for i in range(3):
    keep(bush(f'bush_{i}', x, 0, 0.3), x)
    x += 1.0
for i in range(3):
    o = rock(f'rock_{i}', x, 0, 0.3)
    keep(bake([o], f'rock_{i}'), x)
    x += 1.0
o = sheep('sheep', x, 0, 0)
made.append(o)
x += 1.0
made.append(lamp(x, 0))
x += 1.0
made.append(well(x, 0))
x += 1.2
o = hay(x, 0)
keep(bake([o], 'hay'), x)
x += 1.0
keep(box('fence_post', (0.06, 0.06, 0.34), (x, 0, 0.17), WOOD, bevel=0.012), x)
x += 0.5
# 울타리 가로대: 길이 1(x 방향), 앱에서 늘려 쓴다
keep(box('fence_rail', (1.0, 0.035, 0.045), (x, 0, 0), WOOD, bevel=0.008), x)

# 도시 건물: 연립주택 6종 + 둥근 탑 2종
from town import AWNINGS, round_tower, townhouse  # noqa: E402
walls = [mat(f'wall_{i}', c, 0.85, 0.05, 10.0) for i, c in enumerate(['#f6c1c7', '#bcd9f2', '#f9e2a7', '#bfe3d5', '#f3efe6', '#cdbfe8'])]
roofs = [banded('roof_slate', ['#56657e', '#66768f', '#56657e'], 18.0, 0.3, 0.4, 0.7), ROOF_RED,
         banded('roof_teal', ['#3f7f86', '#4f9298', '#3f7f86'], 18.0, 0.3, 0.4, 0.7)]
for i, (fl, style) in enumerate([(2, 'gable'), (3, 'mansard'), (3, 'gable'), (4, 'mansard'), (2, 'flat'), (4, 'gable')]):
    x += 1.4
    o = townhouse(f'town_{i}', fl, walls[i], roofs[i % 3], style, AWNINGS[i % 3])
    o.location = (x, 0, 0)
    made.append(o)
for i, dome in enumerate((False, True)):
    x += 1.6
    o = round_tower(f'tower_{i}', 3.0, walls[4 - i * 3], roofs[1 + i], dome)
    o.location = (x, 0, 0)
    made.append(o)

if MODE == 'glb':
    for o in made:
        o.location = (0, 0, 0)
    export_glb(os.path.abspath(os.path.join(OUT, 'props.glb')), join=False)

if MODE == 'preview':
    setup_render((x / 2, -9, 3.5), (x / 2, 0, 0.6))
    scene.camera.data.angle = math.radians(60)
    scene.render.resolution_x, scene.render.resolution_y = 1800, 500
    scene.render.filepath = os.path.join(OUT, 'props.png')
    bpy.ops.render.render(write_still=True)
    print('done', flush=True)
