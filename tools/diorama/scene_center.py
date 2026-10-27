# 포켓몬센터 장면
NAME = 'center'
R = 3.3
wood_base(R)
ground_obj('plaza', disc_mesh(2.45, 0.012, 0, -0.55, 1.9), proc_material('cobble', cobble))
import_part('center', 2.3, 0.15, 1.2, 0)
import_part('bench', 0.42, -1.5, -0.4, 55)
import_part('bench', 0.42, 1.05, -0.2, -15)
import_part('bench', 0.42, 0.55, -1.9, -25)
import_part('lamp', 1.05, 1.6, -0.55, 0)
for x, y, h in [(-2.55, 0.2, 0.55), (-2.3, -0.6, 0.48), (-2.05, 0.95, 0.5), (-2.65, -1.25, 0.4), (-1.75, -1.2, 0.36), (-1.3, 2.35, 0.45), (2.6, 1.5, 0.45), (2.85, 0.5, 0.4)]:
    import_part('bush', h, x, y, x * 40)
for x, y, h in [(-1.9, 1.9, 1.05), (-2.6, 1.1, 0.8), (2.1, 2.3, 0.9)]:
    import_part('tree', h, x, y, y * 50)
LAMPS = [((1.6, -0.55, 1.0), 25, (1.0, 0.72, 0.4)), ((0.15, -0.2, 0.5), 60, (1.0, 0.75, 0.45)), ((0.15, 1.2, 1.0), 120, (1.0, 0.8, 0.5))]
GLOW = ('center', 'lamp')
BIG = BIG + ('center',)
CAM_LOC, CAM_TARGET = (5.2, -9.4, 6.6), (0, 0.1, 0.55)
