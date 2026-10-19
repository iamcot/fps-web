"""
Chuẩn hoá thùng gỗ thành khối đơn vị 1x1x1 m, tâm ở gốc (Y lên) rồi xuất glb. Game scale theo kích thước thùng trên map.
Dùng:
  blender -b assets/source/texture/Crate.blend --python tools/blender/crate_tool.py -- client/public/models/crate.glb
"""
import bpy, sys
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1]
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert objs, "không có mesh"

mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector((min(mn[i], w[i]) for i in range(3)))
        mx = Vector((max(mx[i], w[i]) for i in range(3)))
center = (mn + mx) / 2
size = mx - mn

# File gốc (Blender 2.79) chỉ có màu viewport, node vật liệu trống nên glb mất màu: dựng lại Principled BSDF từ diffuse_color
for m in bpy.data.materials:
    m.use_nodes = True
    m.node_tree.nodes.clear()
    bsdf = m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = m.diffuse_color
    bsdf.inputs['Roughness'].default_value = 0.85
    out_node = m.node_tree.nodes.new('ShaderNodeOutputMaterial')
    m.node_tree.links.new(bsdf.outputs['BSDF'], out_node.inputs['Surface'])

bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
    # scale quanh gốc object, nên vị trí phải chia size luôn: (vị trí - tâm) / size
    o.scale = Vector((o.scale[0] / size[0], o.scale[1] / size[1], o.scale[2] / size[2]))
    o.location = Vector(((o.location[i] - center[i]) / size[i] for i in range(3)))
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, use_selection=True)
print("CRATE_OK", list(size))
