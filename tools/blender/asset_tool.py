"""
Dùng:
  blender -b <file.blend> --python tools/blender/asset_tool.py -- inspect
  blender -b <file.blend> --python tools/blender/asset_tool.py -- normalize <params.json> <out.glb>
  blender -b --python tools/blender/asset_tool.py -- inspect-character <model.glb> [<preview_dir>]
  blender -b --python tools/blender/asset_tool.py -- prep-mixamo <in.glb> <out.fbx>
  blender -b --python tools/blender/asset_tool.py -- build-character <team_rigged.fbx> <anims_dir> <out.glb>
(gun_tool.py cũ chỉ còn là lối tắt gọi file này.)
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

# ---------------------------------------------------------------- inspect-character
def inspect_character(glb_path, preview_dir=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    scene = bpy.context.scene
    all_meshes = mesh_objects()
    objs = [o for o in all_meshes if len(o.vertex_groups) > 0] or all_meshes  # mesh có skin = thân nhân vật
    stray = [o.name for o in all_meshes if o not in objs]
    mn, mx = world_bbox(objs)
    name = os.path.splitext(os.path.basename(glb_path))[0]

    # Mesh: tam giác, material, vertex group
    meshes = []
    for o in objs:
        meshes.append({
            "name": o.name, "tris": tri_count(o),
            "materials": [s.material.name for s in o.material_slots if s.material],
            "vertex_groups": [g.name for g in o.vertex_groups],
            "dimensions": [round(v, 4) for v in o.dimensions],
            "bbox_world_min": [round(v, 3) for v in (o.matrix_world @ Vector(o.bound_box[0]))],
        })

    # Texture
    images = []
    for im in bpy.data.images:
        if im.type != 'IMAGE':
            continue
        images.append({"name": im.name, "size": list(im.size),
                       "bytes_packed": len(im.packed_file.data) if im.packed_file else 0})

    # Armature: cây xương + độ dài
    arms = []
    for a in [o for o in scene.objects if o.type == 'ARMATURE']:
        mw = a.matrix_world
        bones = {}
        def bone_info(b):
            h = mw @ b.head_local
            if b.children:   # tail của importer glTF là giá trị đệm; dùng head của xương con đầu tiên
                length = (mw @ b.children[0].head_local - h).length
            else:
                length = None
            return {"head": [round(v, 3) for v in h], "length_to_child": round(length, 4) if length is not None else None}
        def tree(b):
            return {"name": b.name, **bone_info(b), "children": [tree(c) for c in b.children]}
        for b in a.data.bones:
            bones[b.name] = bone_info(b)
        arms.append({
            "name": a.name, "scale": list(a.scale), "bone_count": len(bones),
            "tree": [tree(b) for b in a.data.bones if b.parent is None],
            "has_finger_bones": any(k in n.lower() for n in bones for k in ("thumb", "index", "pinky", "finger")),
            "arm_candidates": {
                "upper_arm": [n for n in bones if n.lower().endswith("arm") and "fore" not in n.lower() and "lower" not in n.lower()],
                "forearm": [n for n in bones if "forearm" in n.lower() or "lowerarm" in n.lower()],
                "hand": [n for n in bones if n.lower().endswith("hand")],
            },
        })

    anims = [{"name": ac.name, "frames": list(ac.frame_range)} for ac in bpy.data.actions]

    height = mx.z - mn.z
    report = {
        "file": glb_path, "blender": bpy.app.version_string,
        "bbox_min": [round(v, 3) for v in mn], "bbox_max": [round(v, 3) for v in mx],
        "height_z": round(height, 4), "feet_z": round(mn.z, 4), "head_top_z": round(mx.z, 4),
        "total_tris": sum(m["tris"] for m in meshes),
        "stray_meshes_excluded_from_bbox": stray,
        "meshes": meshes, "images": images, "armatures": arms, "animations": anims,
    }

    # Hướng mặt: so sánh khối tâm đỉnh trong vùng đầu theo trục Y (mũi/mặt thường nhô ra phía trước
    # nên lệch về một phía so với đỉnh tâm hộp đầu). Chỉ là ước lượng.
    if objs:
        dg = bpy.context.evaluated_depsgraph_get()
        head_pts = []
        for o in objs:
            me = o.evaluated_get(dg).to_mesh()
            for v in me.vertices:
                w = o.matrix_world @ v.co
                if w.z > mn.z + height * 0.88:
                    head_pts.append(w)
        if head_pts:
            ymin = min(p.y for p in head_pts); ymax = max(p.y for p in head_pts)
            ymid = (ymin + ymax) / 2
            ymean = sum(p.y for p in head_pts) / len(head_pts)
            xmean = sum(p.x for p in head_pts) / len(head_pts)
            report["facing_estimate"] = {
                "head_y_range": [round(ymin, 3), round(ymax, 3)],
                "head_vertex_mean_y_minus_mid": round(ymean - ymid, 4),
                "note": "Ước lượng thô, cần xác nhận bằng ảnh preview",
            }

    print("INSPECT_CHARACTER_JSON_BEGIN")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    print("INSPECT_CHARACTER_JSON_END")

    if preview_dir:
        os.makedirs(preview_dir, exist_ok=True)
        render_previews(name, preview_dir, mn, mx)

def render_previews(name, out_dir, mn, mx):
    from math import pi
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = 600; scene.render.resolution_y = 900
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.world = bpy.data.worlds.new("w"); scene.world.color = (0.5, 0.5, 0.5)
    scene.display.shading.background_type = 'WORLD' if hasattr(scene.display.shading, "background_type") else 'WORLD'
    cam_data = bpy.data.cameras.new("cam"); cam_data.type = 'ORTHO'
    cam_data.ortho_scale = (mx.z - mn.z) * 1.2
    cam = bpy.data.objects.new("cam", cam_data); scene.collection.objects.link(cam); scene.camera = cam
    c = (mn + mx) / 2; d = max(mx.z - mn.z, 1) * 3
    # chính diện: camera ở −Y nhìn về +Y (nhìn thấy mặt nếu mặt hướng −Y); nghiêng 90°: camera ở +X
    for label, pos, rot in (("front", Vector((c.x, c.y - d, c.z)), (pi / 2, 0, 0)),
                            ("side", Vector((c.x + d, c.y, c.z)), (pi / 2, 0, pi / 2))):
        cam.location = pos; cam.rotation_euler = Euler(rot, 'XYZ')
        scene.render.filepath = os.path.join(out_dir, f"{name}_{label}.png")
        bpy.ops.render.render(write_still=True)
        print("PREVIEW", scene.render.filepath)

# ---------------------------------------------------------------- prep-mixamo
def prep_mixamo(glb_path, out_path, target_height=1.8):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    scene = bpy.context.scene
    # xoá mesh lạ không skin (Icosphere) và armature cũ, giữ mesh thân
    for o in list(scene.objects):
        if o.type == 'MESH' and len(o.vertex_groups) == 0:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in list(scene.objects):
        if o.type == 'ARMATURE':
            for c in o.children:
                mw = c.matrix_world.copy(); c.parent = None; c.matrix_world = mw
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = mesh_objects()
    for o in meshes:
        for m in [m for m in o.modifiers if m.type == 'ARMATURE']:
            o.modifiers.remove(m)
        o.vertex_groups.clear()
    # gộp mesh thân thành 1
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1: bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # scale cao 1,8m, chân z=0, tâm ngang ở gốc
    mn, mx = world_bbox([body])
    s = target_height / (mx.z - mn.z)
    body.scale = (s, s, s)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mn, mx = world_bbox([body])
    body.location = Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    # mặt −Y: kiểm tra trước (inspect-character xác nhận cả 2 model đã quay −Y), không xoay thêm
    for im in bpy.data.images:
        if im.type == 'IMAGE' and im.packed_file is None and im.size[0] > 0:
            im.pack()
    bpy.ops.file.pack_all()
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    bpy.ops.export_scene.fbx(filepath=out_path, path_mode='COPY', embed_textures=True,
                             use_selection=False, object_types={'MESH'}, add_leaf_bones=False)
    mn, mx = world_bbox([body])
    print("PREP_MIXAMO", out_path, "height", round(mx.z - mn.z, 4), "min", list(mn), "max", list(mx))

def check_fbx(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    objs = mesh_objects()
    mn, mx = world_bbox(objs)
    print("CHECK_FBX", path, "meshes", [o.name for o in objs], "tris", sum(tri_count(o) for o in objs),
          "height", round(mx.z - mn.z, 4), "feet", round(mn.z, 4), "bbox", [round(v, 3) for v in mn], [round(v, 3) for v in mx],
          "images", [(i.name, list(i.size)) for i in bpy.data.images if i.type == 'IMAGE'])

# ---------------------------------------------------------------- build-character
ROOT_MOTION_LIMIT = 0.3   # m: chỉ khử trôi gốc ở animation có hips lệch ngang lớn hơn mức này (death_*)

def _action_fcurves(act):
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                for fc in cb.fcurves:
                    yield fc

def build_character(rigged_path, anims_dir, out_path):
    import glob
    from mathutils import Vector
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=rigged_path)
    scene = bpy.context.scene
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')
    body = next(o for o in scene.objects if o.type == 'MESH')
    for ac in list(bpy.data.actions):          # action kèm file rigged (1 khung T-pose) không dùng
        bpy.data.actions.remove(ac)
    # Mixamo gắn ảnh rác 0x0 vào Emission (+ Normal Map không ảnh): sẽ ra nhân vật trắng toát. Gỡ hết.
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        tree = mat.node_tree
        bsdf = next(n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED')
        for n in [n for n in tree.nodes if n.type == 'TEX_IMAGE' and (n.image is None or n.image.size[0] == 0)]:
            tree.nodes.remove(n)
        for n in [n for n in tree.nodes if n.type == 'NORMAL_MAP']:
            tree.nodes.remove(n)
        for sock in ('Emission Color',):
            for l in list(bsdf.inputs[sock].links):
                tree.links.remove(l)
        bsdf.inputs['Emission Color'].default_value = (0, 0, 0, 1)
        bsdf.inputs['Emission Strength'].default_value = 0.0
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 0.9
    for im in list(bpy.data.images):           # ảnh rác 0x0 do Mixamo tạo
        if im.size[0] == 0:
            bpy.data.images.remove(im)

    # 1) Apply transform: armature scale 0.01 / xoay 90° (cm, Y-up của FBX) -> mét, Z-up
    mw = body.matrix_world.copy()
    body.parent = None
    body.matrix_world = mw
    for o in (arm, body):
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    body.parent = arm
    body.matrix_parent_inverse = Matrix.Identity(4)
    for m in body.modifiers:
        if m.type == 'ARMATURE':
            m.object = arm
    body.name = "char1"; arm.name = "Armature"
    for im in bpy.data.images:
        if im.type == 'IMAGE' and im.packed_file is None:
            im.pack()

    # 2) Nạp từng animation: lấy action, đổi tên theo file, xoá armature tạm
    ad = arm.animation_data_create()
    hips_rest = arm.data.bones['mixamorig:Hips'].matrix_local.to_3x3()
    report = []
    for f in sorted(glob.glob(os.path.join(anims_dir, "*.fbx"))):
        name = os.path.splitext(os.path.basename(f))[0]
        before_a = set(bpy.data.actions); before_o = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=f)
        new = [a for a in bpy.data.actions if a not in before_a]
        for o in [o for o in bpy.data.objects if o not in before_o]:
            bpy.data.objects.remove(o, do_unlink=True)
        if not new:
            print("WARN no action in", f); continue
        act = new[0]; act.name = name; act.use_fake_user = True
        # đơn vị: keyframe vị trí của file anim tính bằng cm, armature giờ tính bằng mét
        for fc in _action_fcurves(act):
            if fc.data_path.endswith(".location"):
                for kp in fc.keyframe_points:
                    kp.co.y *= 0.01; kp.handle_left.y *= 0.01; kp.handle_right.y *= 0.01
                fc.update()
        # 3) Khử trôi gốc ở xương Hips (theo hệ armature, chỉ trục ngang), giữ chiều cao
        fcs = {fc.array_index: fc for fc in _action_fcurves(act) if fc.data_path == 'pose.bones["mixamorig:Hips"].location'}
        drift = 0.0
        if len(fcs) == 3:
            n = len(fcs[0].keyframe_points)
            vecs = [hips_rest @ Vector((fcs[0].keyframe_points[i].co.y, fcs[1].keyframe_points[i].co.y, fcs[2].keyframe_points[i].co.y)) for i in range(n)]
            hx = [v.x for v in vecs]; hy = [v.y for v in vecs]
            drift = max(max(hx) - min(hx), max(hy) - min(hy))
            if drift > ROOT_MOTION_LIMIT:
                inv = hips_rest.inverted()
                x0, y0 = vecs[0].x, vecs[0].y
                for i, v in enumerate(vecs):
                    loc = inv @ Vector((x0, y0, v.z))
                    for k in range(3):
                        kp = fcs[k].keyframe_points[i]
                        kp.co.y = loc[k]; kp.handle_left.y = loc[k]; kp.handle_right.y = loc[k]
                for k in range(3): fcs[k].update()
        report.append((name, round(act.frame_range[1] - act.frame_range[0] + 1), round(drift, 2), drift > ROOT_MOTION_LIMIT))

    # 4) Mỗi action một NLA strip (tắt) để exporter xuất đủ
    for name, *_ in report:
        act = bpy.data.actions[name]
        ad.action = act
        ad.action_slot = act.slots[0]
        tr = ad.nla_tracks.new(); tr.name = name
        st = tr.strips.new(name, 1, act)
        st.action_slot = act.slots[0]
        st.mute = True
    ad.action = None

    # 5) Nén texture về tối đa 2048
    for im in bpy.data.images:
        if im.type == 'IMAGE' and max(im.size) > 2048:
            im.scale(2048, 2048)

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_yup=True,
                              export_animations=True, export_nla_strips=True,
                              export_image_format='WEBP', export_apply=False)
    for r in report:
        print("ANIM", r)
    print("BUILT", out_path)

if mode == "inspect":
    inspect()
elif mode == "build-character":
    build_character(argv[1], argv[2], argv[3])
elif mode == "prep-mixamo":
    prep_mixamo(argv[1], argv[2])
elif mode == "check-fbx":
    check_fbx(argv[1])
elif mode == "inspect-character":
    inspect_character(argv[1], argv[2] if len(argv) > 2 else None)
elif mode == "normalize":
    normalize(argv[1], argv[2])
else:
    print("unknown mode", mode)