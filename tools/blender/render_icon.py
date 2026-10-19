"""
Render icon vũ khí dạng bóng trắng phẳng (nền trong suốt, nòng chĩa trái) từ file .glb ĐÃ CHUẨN HOÁ (nòng +Y, trên +Z sau khi import).

Dùng:
  blender -b --python tools/blender/render_icon.py -- <model.glb> <client/public/icons/weapons/ak47.png>

Camera orthographic đặt ở phía −X nhìn về +X, trục lên +Z → +Y hiện ở bên trái màn hình → nòng chĩa trái.
Kết quả PNG 512×256. HUD ưu tiên <key>.png, không có thì dùng <key>.svg cùng thư mục.
"""
import bpy, sys, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 2:
    raise SystemExit("usage: blender -b --python render_icon.py -- <model.glb> <out.png>")
src, out = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit("không có mesh trong " + src)

mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector((min(mn[i], w[i]) for i in range(3)))
        mx = Vector((max(mx[i], w[i]) for i in range(3)))
center = (mn + mx) / 2
size = mx - mn

cam_data = bpy.data.cameras.new("icon_cam")
cam_data.type = 'ORTHO'
# Cạnh dài nhất của bbox (theo trục hiện trên màn hình: Y ngang, Z dọc) × 1,1; khung 2:1 nên chiều ngang là cạnh quyết định
cam_data.ortho_scale = max(size.y, size.z * 2) * 1.1
cam = bpy.data.objects.new("icon_cam", cam_data)
bpy.context.scene.collection.objects.link(cam)
cam.location = Vector((center.x - max(size.x, 1.0) - 5, center.y, center.z))
cam.rotation_euler = (1.5707963, 0, 1.5707963)   # nhìn về +X, trục lên +Z
bpy.context.scene.camera = cam

sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.render.resolution_x, sc.render.resolution_y = 512, 256
sc.render.film_transparent = True
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.render.filepath = os.path.abspath(out)
sh = sc.display.shading
sh.light = 'FLAT'
sh.color_type = 'SINGLE'
sh.single_color = (1, 1, 1)
sh.show_cavity = False
sh.show_shadows = False
sh.show_object_outline = False
sh.show_specular_highlight = False
sc.view_settings.view_transform = 'Standard'

os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
bpy.ops.render.render(write_still=True)
print("icon ->", out)
