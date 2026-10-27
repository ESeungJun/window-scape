# 체육관 배틀 장면: 선을 그린 잔디 경기장, 뒤·양옆 관중석, 조명탑(포켓몬은 앱에서 양쪽에 둔다)
import numpy as np
NAME = 'battle'
R = 3.3
wood_base(R)
FW, FH = 4.3, 2.9  # 경기장 가로(x)·세로(y)


def field_image():
    W, H = 1536, 1024
    img = np.zeros((H, W, 4), dtype=np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    # 잔디 깎은 줄무늬
    stripe = ((xx // 96) % 2).astype(np.float32)
    g = np.stack([0.20 + stripe * 0.03, 0.42 + stripe * 0.04, 0.10 + stripe * 0.02], -1)
    img[..., :3] = g
    img[..., 3] = 1
    line = np.zeros((H, W), bool)
    t = 10
    m = 40
    line |= (np.abs(xx - m) < t) & (yy > m - t) & (yy < H - m + t)
    line |= (np.abs(xx - (W - m)) < t) & (yy > m - t) & (yy < H - m + t)
    line |= (np.abs(yy - m) < t) & (xx > m - t) & (xx < W - m + t)
    line |= (np.abs(yy - (H - m)) < t) & (xx > m - t) & (xx < W - m + t)
    line |= np.abs(xx - W / 2) < t
    r = np.hypot(xx - W / 2, yy - H / 2)
    line |= np.abs(r - 190) < t
    for bx in (m, W - m - 220):
        line |= (((np.abs(xx - bx) < t) | (np.abs(xx - (bx + 220)) < t)) & (np.abs(yy - H / 2) < 170))
        line |= ((np.abs(np.abs(yy - H / 2) - 170) < t) & (xx > bx) & (xx < bx + 220))
    img[line, :3] = 0.92
    # 가운데 몬스터볼
    ball = r < 95
    img[ball & (yy > H / 2), :3] = (0.75, 0.12, 0.1)   # 이미지 아래(v 작음)가 앞쪽
    img[ball & (yy <= H / 2), :3] = 0.92
    img[ball & (np.abs(yy - H / 2) < 9), :3] = 0.08
    img[r < 32, :3] = 0.08
    img[r < 20, :3] = 0.92
    im = bpy.data.images.new('field', W, H)
    im.pixels.foreach_set(img.ravel())
    im.pack()
    return im


def field(nt, b):
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = field_image()
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.9


def field_mesh(bm):
    vs = [bm.verts.new(p) for p in ((-FW / 2, -FH / 2 - 0.2, 0.012), (FW / 2, -FH / 2 - 0.2, 0.012), (FW / 2, FH / 2 - 0.2, 0.012), (-FW / 2, FH / 2 - 0.2, 0.012))]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.new()
    for loop, c in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = c


ground_obj('plaza', field_mesh, proc_material('field', field))
import_part('bleacher', 0.5, -1.15, 1.75, 0)
import_part('bleacher', 0.5, 1.15, 1.75, 0)
import_part('bleacher', 0.5, -2.55, -0.25, 90)
import_part('bleacher', 0.5, 2.55, -0.25, -90)
import_part('flood', 1.7, -2.6, 1.75, 35)
import_part('flood', 1.7, 2.6, 1.75, -35)
for x, y, h in [(-2.5, -2.0, 0.7), (2.5, -2.0, 0.7), (-0.2, 2.85, 0.6), (-2.95, 0.9, 0.55), (2.95, 0.9, 0.55)]:
    import_part('tree', h, x, y, x * 30)
for x, y, h in [(-1.4, -2.55, 0.28), (1.4, -2.55, 0.28), (0, -2.75, 0.25)]:
    import_part('bush', h, x, y, x * 40)

LAMPS = [((-2.5, 1.6, 1.75), 160, (1.0, 0.95, 0.85)), ((2.5, 1.6, 1.75), 160, (1.0, 0.95, 0.85))]
GLOW = ('flood',)
CAM_LOC, CAM_TARGET = (5.2, -9.4, 6.6), (0, 0.0, 0.3)
