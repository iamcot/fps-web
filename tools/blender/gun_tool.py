"""
Dùng:
  blender -b <file.blend> --python tools/blender/gun_tool.py -- inspect
  blender -b <file.blend> --python tools/blender/gun_tool.py -- normalize <params.json> <out.glb>
"""
import bpy, sys, json, os
from mathutils import Vector, Matrix, Euler
from math import radians

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
mode = argv[0] if argv else "inspect"

def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']

def world_bbox(objs):
    mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector((min(mn[i], w[i]) for i in range(3)))
            mx = Vector((max(mx[i], w[i]) for i in range(3)))
    return mn, mx

def tri_count(o):
    me = o.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)

def inspect():
    objs = mesh_objects()
    mn, mx = world_bbox(objs) if objs else (Vector(), Vector())
    report = {
        "blender": bpy.app.version_string,
        "unit_scale": bpy.context.scene.unit_settings.scale_length,
        "bbox_min": list(mn), "bbox_max": list(mx),
        "size": list(mx - mn),
        "total_tris": sum(tri_count(o) for o in objs),
        "objects": [{
            "name": o.name, "type": o.type,
            "parent": o.parent.name if o.parent else None,
            "location": list(o.matrix_world.translation),
            "dimensions": list(o.dimensions),
            "tris": tri_count(o) if o.type == 'MESH' else 0,
            "materials": [s.material.name for s in getattr(o, "material_slots", []) if s.material],
        } for o in bpy.context.scene.objects],
        "images": [{
            "name": im.name, "filepath": im.filepath,
            "packed": im.packed_file is not None,
            "exists": im.packed_file is not None or os.path.exists(bpy.path.abspath(im.filepath)),
            "size": list(im.size),
        } for im in bpy.data.images if im.type == 'IMAGE'],
    }
    print("INSPECT_JSON_BEGIN")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    print("INSPECT_JSON_END")

def normalize(params_path, out_path):
    p = json.load(open(params_path, encoding="utf-8"))
    scene = bpy.context.scene

    # 1) Gom mọi object gốc (không có parent) vào một Empty "GunRoot"
    root = bpy.data.objects.new("GunRoot", None)
    scene.collection.objects.link(root)
    for o in list(scene.objects):
        if o is not root and o.parent is None:
            mw = o.matrix_world.copy()
            o.parent = root
            o.matrix_world = mw

    # 2) Biến đổi: dời điểm tay cầm về gốc, xoay, scale
    grip = Vector(p.get("grip", [0, 0, 0]))           # toạ độ tay cầm, hệ Blender, TRƯỚC biến đổi
    rot = p.get("rotate_deg", [0, 0, 0])               # xoay XYZ (độ) để nòng chĩa +Y, trên là +Z
    s = p.get("scale", 1.0)
    M = Matrix.Scale(s, 4) @ Euler([radians(a) for a in rot], 'XYZ').to_matrix().to_4x4() @ Matrix.Translation(-grip)
    root.matrix_world = M

    # 3) Thêm Empty muzzle / eject (toạ độ hệ Blender, TRƯỚC biến đổi)
    # anchors (plan 10): {"hand_r": [...], "hand_l": [...], "mag": [...]} cùng hệ toạ độ với muzzle
    pts = {k: p[k] for k in ("muzzle", "eject") if k in p}
    pts.update(p.get("anchors", {}))
    for name in pts:
        if bpy.data.objects.get(name) is None:
            e = bpy.data.objects.new(name, None)
            e.empty_display_size = 0.02
            scene.collection.objects.link(e)
            e.parent = root
            e.matrix_parent_inverse = Matrix.Identity(4)
            e.location = Vector(pts[name])

    # 4) Đổi tên object theo map (ví dụ băng đạn)
    for old, new in p.get("rename", {}).items():
        o = bpy.data.objects.get(old)
        if o: o.name = new

    # 5) Giảm polygon nếu cần
    ratio = p.get("decimate_ratio")
    if ratio and ratio < 1.0:
        for o in mesh_objects():
            m = o.modifiers.new("Decimate", 'DECIMATE')
            m.ratio = ratio

    # 6) Tìm texture bị mất đường dẫn trong thư mục của file .blend
    try:
        bpy.ops.file.find_missing_files(directory=os.path.dirname(bpy.data.filepath))
    except Exception as ex:
        print("find_missing_files:", ex)

    # 6b) Tái tạo materials: Blender 5.x glTF exporter bỏ qua pbrMetallicRoughness khi
    # material tree có FRAME node cha, nhiều Material Output, hoặc blend_method=HASHED
    # (legacy từ file .blend cũ). Cách chắc nhất: xoá sạch và rebuild với Principled BSDF.
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        tree = mat.node_tree
        pbsdf = next((n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        bc = list(pbsdf.inputs['Base Color'].default_value) if pbsdf else [0.8, 0.8, 0.8, 1.0]
        tree.nodes.clear()
        out_node = tree.nodes.new('ShaderNodeOutputMaterial')
        out_node.location = (300, 0)
        bsdf_node = tree.nodes.new('ShaderNodeBsdfPrincipled')
        bsdf_node.location = (0, 0)
        bsdf_node.inputs['Base Color'].default_value = bc
        tree.links.new(bsdf_node.outputs['BSDF'], out_node.inputs['Surface'])
        print(f"  rebuilt material '{mat.name}' base_color={[round(v, 3) for v in bc[:3]]}")

    # 7) Xuất GLB
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_animations=False,
    )
    print("EXPORTED", out_path)

if mode == "inspect":
    inspect()
elif mode == "normalize":
    normalize(argv[1], argv[2])
else:
    print("unknown mode", mode)