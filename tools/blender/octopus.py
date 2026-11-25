"""Build the Octoventure blue-ringed octopus hero and export public/models/octopus.glb.

Run:
    /opt/blender/blender -b --python tools/blender/octopus.py

A cute toon Hapalochlaena: warm golden body, cream arm undersides, crisp
bright blue rings with a navy outline. Rings are a separate material so
the game can flash them; the body material can be tinted for camouflage.

Scale
-----
The in-game octopus is 20 cm = 0.63 world units (1 cm = 0.0315 u). This
glb is built at that final size. Hookup must use visual scale 1.0 and
must NOT apply CONFIG.octopus.size (0.42) to the mesh (that scale is for
the old unscaled ~1.5 u procedural model). Keep this.sz = 0.42 for
movement, camera and collision.

Orientation
-----------
Modelled in Blender with +Z up and the face toward -Y; the glTF exporter
(export_yup=True) maps that to +Y up, +Z forward. Origin is on the
ground, under the centre of the mantle, when crawling.

Arms
----
Eight arms, arm0 at the front (+Z after export). Each is
arm{i}_seg0 .. arm{i}_seg4 + arm{i}_tip (6 bones).
"""

from __future__ import annotations

import json
import math
import shutil
import struct
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[2]
GLB_PATH = ROOT / "public" / "models" / "octopus.glb"
PREVIEW_REPO = ROOT / "tools" / "blender" / "octopus-preview.png"
PREVIEW_REPO_SIDE = ROOT / "tools" / "blender" / "octopus-preview-side.png"
PREVIEW_REPO_SWIM = ROOT / "tools" / "blender" / "octopus-swim.png"
PREVIEW_REPO_WALK = ROOT / "tools" / "blender" / "octopus-walk.png"
PREVIEW_WORKSPACE = Path("/workspace/octopus-preview.png")
PREVIEW_SIDE = Path("/workspace/octopus-preview-side.png")
PREVIEW_SWIM = Path("/workspace/octopus-swim.png")
PREVIEW_WALK = Path("/workspace/octopus-walk.png")

CM = 0.0315
# 20 cm total span (arm tip to opposite tip) ≈ 0.63 u
SPAN_CM = 20.0
EXPORT_SPAN = SPAN_CM * CM

# Warm golden body, cream underside, electric blue rings.
BODY = (0xDC / 255, 0x9C / 255, 0x14 / 255, 1.0)        # #DC9C14, reads as #D9A21E mustard-ochre under Workbench
BELLY = (0xF6 / 255, 0xE4 / 255, 0xB8 / 255, 1.0)       # #F6E4B8
RING = (0x1E / 255, 0x6B / 255, 0xFF / 255, 1.0)        # #1E6BFF electric blue
RING_EDGE = (0x0A / 255, 0x1C / 255, 0x66 / 255, 1.0)   # #0A1C66 navy outline
RING_CORE = (0x4A / 255, 0x3C / 255, 0x18 / 255, 1.0)   # #4A3C18 dark olive-brown centre
EYE = (0x1A / 255, 0x1A / 255, 0x1A / 255, 1.0)
HIGHLIGHT = (1.0, 1.0, 1.0, 1.0)
BEAK = (0x3A / 255, 0x2C / 255, 0x22 / 255, 1.0)
SUCKER = (0xF3 / 255, 0xD9 / 255, 0xA8 / 255, 1.0)

FPS = 24
IDLE_FRAMES = 72          # 3.0 s
WALK_FRAMES = 24          # 1.0 s
SWIM_FRAMES = 28          # ~1.17 s
SWIM_IDLE_FRAMES = 72     # 3.0 s
BITE_FRAMES = 10          # ~0.42 s
VENOM_FRAMES = 18         # 0.75 s
INK_FRAMES = 12           # 0.5 s
SCOOP_FRAMES = 12         # 0.5 s
THREAT_FRAMES = 24        # 1.0 s
CELEB_FRAMES = 20         # ~0.83 s

N_ARMS = 8
ARM_SEGS = 6  # seg0..seg4 + tip


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
                  bpy.data.actions, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            block.remove(item)
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = max(WALK_FRAMES, IDLE_FRAMES)
    scene.render.fps = FPS
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def make_mat(name, color, roughness=0.85, metallic=0.0, emission=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = color
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    # Blender 4.x: Emission Color + Emission Strength
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = color if emission else (0, 0, 0, 1)
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat


def set_coat(mat, weight, roughness=0.22):
    """Soft satin coat so the elytra read as glossy-ish, not chrome."""
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if not bsdf:
        return mat
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = weight
    if "Coat Roughness" in bsdf.inputs:
        bsdf.inputs["Coat Roughness"].default_value = roughness
    return mat


def apply_all(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)


def shade_smooth(obj):
    mesh = obj.data
    if hasattr(mesh, "shade_smooth"):
        mesh.shade_smooth()
    else:
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))


def add_uv_sphere(name, radius, segments, rings, loc, scale=None):
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=radius, segments=segments, ring_count=rings, location=loc
    )
    obj = bpy.context.active_object
    obj.name = name
    if scale:
        obj.scale = scale
    apply_all(obj)
    shade_smooth(obj)
    return obj


def ellipsoid_normal(center, half, point):
    """Outward normal of an axis-aligned ellipsoid, so discs sit flush."""
    local = Vector(point) - Vector(center)
    n = Vector((
        local.x / (half.x * half.x + 1e-12),
        local.y / (half.y * half.y + 1e-12),
        local.z / (half.z * half.z + 1e-12),
    ))
    if n.length < 1e-9:
        n = Vector((0.0, 0.0, 1.0))
    n.normalize()
    return n


def add_surface_disc(name, surface, normal, radius, thickness=0.30, segments=16, rings=3, inset=0.12):
    """A smooth flattened disc, thin axis along the surface normal, slightly inset."""
    n = Vector(normal)
    if n.length < 1e-9:
        n = Vector((0.0, 0.0, 1.0))
    n.normalize()
    loc = Vector(surface) - n * (radius * inset)
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=1.0, segments=segments, ring_count=rings, location=(0.0, 0.0, 0.0)
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (radius, radius, radius * thickness)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(n)
    obj.location = loc
    apply_all(obj)
    shade_smooth(obj)
    return obj


def add_cylinder_between(name, p0, p1, radius, verts=6):
    a, b = Vector(p0), Vector(p1)
    direction = b - a
    length = direction.length
    mid = (a + b) * 0.5
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=radius, depth=length, location=mid
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    if length > 1e-9:
        obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    apply_all(obj)
    shade_smooth(obj)
    return obj


def curve_tube(name, points, radius, reso_u=5, bevel_res=2):
    """A low-poly tube along Bezier points (each is (x,y,z))."""
    curve = bpy.data.curves.new(name + "_crv", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = reso_u
    curve.bevel_depth = radius
    curve.bevel_resolution = bevel_res
    curve.fill_mode = "FULL"
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for bp, p in zip(spline.bezier_points, points):
        bp.co = Vector(p)
        bp.handle_left_type = "AUTO"
        bp.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.active_object
    obj.name = name
    apply_all(obj)
    shade_smooth(obj)
    return obj


def assign_group(obj, group_name, weight=1.0):
    vg = obj.vertex_groups.new(name=group_name)
    n = len(obj.data.vertices)
    if n:
        vg.add(list(range(n)), weight, "REPLACE")


def assign_weights(obj, pairs):
    """pairs: list of (group_name, weight). Replaces each named group."""
    n = len(obj.data.vertices)
    if not n:
        return
    idx = list(range(n))
    for group_name, weight in pairs:
        vg = obj.vertex_groups.get(group_name) or obj.vertex_groups.new(name=group_name)
        vg.add(idx, weight, "REPLACE")


def set_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def join_objects(name, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    obj.location = (0.0, 0.0, 0.0)
    shade_smooth(obj)
    try:
        bpy.ops.object.shade_smooth()
    except Exception:
        pass
    return obj


def triangle_count(obj):
    mesh = obj.data
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


# ---------------------------------------------------------------------------
# Build the ant at final game scale
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Build the beetle at final game scale
# ---------------------------------------------------------------------------
def build_armature(bones):
    data = bpy.data.armatures.new("OctopusArmature")
    data.display_type = "OCTAHEDRAL"
    arm = bpy.data.objects.new("OctopusArmature", data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    edit = {}
    for name, parent, head, tail in bones:
        eb = data.edit_bones.new(name)
        eb.head = Vector(head)
        eb.tail = Vector(tail)
        if (eb.tail - eb.head).length < 1e-6:
            eb.tail = eb.head + Vector((0, 0, 0.02 * CM))
        # Keep a tiny bone even if the original was short.
        if (eb.tail - eb.head).length < 0.004 * CM:
            direction = (Vector(tail) - Vector(head))
            if direction.length < 1e-9:
                direction = Vector((0, 0, 1))
            eb.tail = eb.head + direction.normalized() * (0.05 * CM)
        edit[name] = eb
    for name, parent, _h, _t in bones:
        if parent:
            edit[name].parent = edit[parent]
            edit[name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def bind(mesh, arm):
    mesh.parent = arm
    mesh.parent_type = "OBJECT"
    mod = mesh.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    mod.use_vertex_groups = True
    mod.use_bone_envelopes = False


def ensure_action(arm, name, frame_end):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    if hasattr(action, "use_frame_range"):
        action.use_frame_range = True
        action.frame_start = 0
        action.frame_end = frame_end
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    # Blender 4.4+ action slots: assign if the API is present.
    if hasattr(action, "slots"):
        try:
            if len(action.slots) == 0:
                action.slots.new(id_type="OBJECT", name=arm.name)
            if hasattr(arm.animation_data, "action_slot") and action.slots:
                arm.animation_data.action_slot = action.slots[0]
        except Exception as exc:
            print("action slot note:", exc)
    return action


def key_euler(pb, frame, euler, interpolation="BEZIER"):
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = euler
    pb.keyframe_insert(data_path="rotation_euler", frame=frame)
    if pb.id_data.animation_data and pb.id_data.animation_data.action:
        action = pb.id_data.animation_data.action
        for fc in action.fcurves:
            if fc.data_path == f'pose.bones["{pb.name}"].rotation_euler':
                for kp in fc.keyframe_points:
                    if int(kp.co.x) == frame:
                        kp.interpolation = interpolation
                        kp.handle_left_type = "AUTO"
                        kp.handle_right_type = "AUTO"



def key_quat(pb, frame, quat, interpolation="BEZIER"):
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = Quaternion(quat)
    pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
    if pb.id_data.animation_data and pb.id_data.animation_data.action:
        action = pb.id_data.animation_data.action
        for fc in action.fcurves:
            if fc.data_path == f'pose.bones["{pb.name}"].rotation_quaternion':
                for kp in fc.keyframe_points:
                    if int(kp.co.x) == frame:
                        kp.interpolation = interpolation
                        kp.handle_left_type = "AUTO"
                        kp.handle_right_type = "AUTO"


def push_nla(arm, action, name):
    if arm.animation_data is None:
        arm.animation_data_create()
    # Leave the action as the active one too; also stash a unique NLA track.
    # Remove a previous track of the same name if the script is re-run in-session.
    for tr in list(arm.animation_data.nla_tracks):
        if tr.name == name:
            arm.animation_data.nla_tracks.remove(tr)
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    start = int(action.frame_range[0])
    strip = track.strips.new(name, start, action)
    strip.action = action
    try:
        strip.action_frame_start = action.frame_range[0]
        strip.action_frame_end = action.frame_range[1]
    except Exception:
        pass




# ---------------------------------------------------------------------------
# Preview render
# ---------------------------------------------------------------------------
def export_glb():
    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Clear any leftover action so export uses stored actions.
    arm = bpy.data.objects.get("OctopusArmature")
    if arm and arm.animation_data:
        arm.animation_data.action = None
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        export_copyright="Octoventure",
        use_selection=False,
        use_visible=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_skins=True,
        export_all_influences=False,
        export_morph=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_nla_strips=True,
        export_def_bones=False,
        export_anim_single_armature=True,
        export_reset_pose_bones=True,
        export_optimize_animation_size=True,
        export_force_sampling=False,
        export_bake_animation=False,
        export_rest_position_armature=True,
        export_draco_mesh_compression_enable=False,
        export_extras=False,
        export_action_filter=False,
        export_extra_animations=True,
    )
    print("exported:", GLB_PATH, "bytes", GLB_PATH.stat().st_size)



def add_flat_disc(name, center, normal, radius, segments=14, lift=0.006):
    """A filled flat disc decal, used for the dark ring centres."""
    n = Vector(normal)
    if n.length < 1e-9:
        n = Vector((0.0, 0.0, 1.0))
    n.normalize()
    verts = [(0.0, 0.0, 0.0)]
    for i in range(segments):
        a = (i / segments) * 2.0 * math.pi
        verts.append((radius * math.cos(a), radius * math.sin(a), 0.0))
    faces = []
    for i in range(segments):
        faces.append((0, i + 1, 1 + (i + 1) % segments))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(n)
    obj.location = Vector(center) + n * (lift * CM)
    apply_all(obj)
    shade_smooth(obj)
    return obj


def add_flat_ring(name, center, normal, inner, outer, segments=18, lift=0.007):
    """A truly flat annulus decal (no thickness) sitting flush on the skin."""
    n = Vector(normal)
    if n.length < 1e-9:
        n = Vector((0.0, 0.0, 1.0))
    n.normalize()
    verts = []
    for i in range(segments):
        a = (i / segments) * 2.0 * math.pi
        c, s = math.cos(a), math.sin(a)
        verts.append((outer * c, outer * s, 0.0))
        verts.append((inner * c, inner * s, 0.0))
    faces = []
    for i in range(segments):
        j = (i + 1) % segments
        oi, ii = i * 2, i * 2 + 1
        oj, ij = j * 2, j * 2 + 1
        faces.append((oi, oj, ij, ii))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(n)
    obj.location = Vector(center) + n * (lift * CM)
    apply_all(obj)
    shade_smooth(obj)
    return obj


def add_annulus(name, center, normal, inner, outer, thickness, segments=12):
    # Kept for compatibility; rings now use the flat decal helper.
    return add_flat_ring(name, center, normal, inner, outer, segments=max(segments, 16))


def on_ellipsoid(center, half, direction, embed=1.0):
    d = Vector(direction)
    if d.length < 1e-9:
        d = Vector((0.0, 0.0, 1.0))
    d.normalize()
    return Vector(center) + Vector((half.x * d.x, half.y * d.y, half.z * d.z)) * embed


def arm_dir(i):
    """Unit direction of arm i in the XY plane. arm0 faces Blender -Y (export +Z)."""
    ang = i * (2.0 * math.pi / N_ARMS)
    return Vector((math.sin(ang), -math.cos(ang), 0.0))


def arm_bone(i, k):
    return f"arm{i}_tip" if k == ARM_SEGS - 1 else f"arm{i}_seg{k}"


def arm_joints():
    """Rest-pose joint offsets along one arm, in cm."""
    # 7 joints (6 bones). Arms are ~7.7 cm from the crown, about 1.4x the
    # ~5.5 cm mantle, plump and tip-curled for a cute silhouette.
    lengths = (1.45, 1.45, 1.35, 1.25, 1.15, 1.05)
    pts = [Vector((0.0, 0.0, 0.0))]
    x = 0.0
    for length in lengths:
        x += length
        pts.append(Vector((x, 0.0, 0.0)))
    return pts, lengths


# Rest-pose arm path in centimetres. Shared by the mesh and the armature.
ARM_ALONG = [0.0, 1.45, 2.90, 4.25, 5.50, 6.65, 7.70]
ARM_HEIGHT = [1.35, 0.98, 0.55, 0.32, 0.26, 0.42, 0.85]
ARM_RADII = [1.10, 0.96, 0.80, 0.62, 0.46, 0.32, 0.16]
ARM_SPREAD = 0.72  # crown radius, cm
ARM_LOOPS = 22     # rings of verts along each arm (smooth bends)


def world_joint(i, k):
    d = arm_dir(i)
    t = ARM_ALONG[k] / ARM_ALONG[-1]
    # slight inward pull toward the tip so the arm isn't a stiff spoke
    radial = ARM_SPREAD + ARM_ALONG[k] - 0.45 * t * t
    return Vector((
        d.x * radial * CM,
        d.y * radial * CM,
        ARM_HEIGHT[k] * CM,
    ))


def lerp_path(points, radii, count):
    """Evenly resample a polyline (and its radii) to `count` points."""
    pts = [Vector(p) for p in points]
    segs = [ (pts[i + 1] - pts[i]).length for i in range(len(pts) - 1) ]
    total = sum(segs) or 1.0
    out_p, out_r = [], []
    for j in range(count):
        target = (j / (count - 1)) * total
        acc = 0.0
        placed = False
        for i, length in enumerate(segs):
            if acc + length >= target or i == len(segs) - 1:
                t = 0.0 if length < 1e-12 else min(1.0, max(0.0, (target - acc) / length))
                out_p.append(pts[i].lerp(pts[i + 1], t))
                out_r.append((1.0 - t) * radii[i] + t * radii[i + 1])
                placed = True
                break
            acc += length
        if not placed:
            out_p.append(pts[-1])
            out_r.append(radii[-1])
    return out_p, out_r


def add_tapered_tube(name, points, radii, circ=8):
    """One continuous smooth tapered tube with a rounded tip."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    verts = []
    # stable frames along the path
    frames = []
    ref_up = Vector((0.0, 0.0, 1.0))
    for i, p in enumerate(pts):
        if i < n - 1:
            tangent = (pts[i + 1] - p)
        else:
            tangent = (p - pts[i - 1])
        if tangent.length < 1e-12:
            tangent = Vector((0.0, 1.0, 0.0))
        tangent.normalize()
        up = ref_up
        if abs(tangent.dot(up)) > 0.92:
            up = Vector((1.0, 0.0, 0.0))
        side = tangent.cross(up)
        if side.length < 1e-12:
            side = Vector((1.0, 0.0, 0.0))
        side.normalize()
        norm = side.cross(tangent).normalized()
        frames.append((norm, side, tangent))
        ref_up = norm
        for j in range(circ):
            a = (j / circ) * 2.0 * math.pi
            verts.append(p + radii[i] * (math.cos(a) * norm + math.sin(a) * side))
    # rounded tip vertex just past the last ring
    tip = pts[-1] + frames[-1][2] * (radii[-1] * 0.85)
    tip_index = len(verts)
    verts.append(tip)

    faces = []
    for i in range(n - 1):
        for j in range(circ):
            a = i * circ + j
            b = i * circ + (j + 1) % circ
            c = (i + 1) * circ + (j + 1) % circ
            d = (i + 1) * circ + j
            faces.append((a, b, c, d))
    last = (n - 1) * circ
    for j in range(circ):
        faces.append((last + j, last + (j + 1) % circ, tip_index))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    shade_smooth(obj)
    return obj


def skin_along_chain(obj, bone_names, joints):
    """Soft weight blend along a polyline of rest joints (one bone per span)."""
    joints = [Vector(j) for j in joints]
    spans = [(joints[k + 1] - joints[k]).length for k in range(len(joints) - 1)]
    total = sum(spans) or 1.0
    # cumulative length at each joint
    cum = [0.0]
    for length in spans:
        cum.append(cum[-1] + length)
    n_bones = len(bone_names)
    for name in bone_names:
        if obj.vertex_groups.get(name) is None:
            obj.vertex_groups.new(name=name)
    for v in obj.data.vertices:
        # closest parameter along the polyline
        best_s = 0.0
        best_d = 1e9
        acc = 0.0
        for k, length in enumerate(spans):
            a, b = joints[k], joints[k + 1]
            ab = b - a
            if length < 1e-12:
                continue
            t = max(0.0, min(1.0, (v.co - a).dot(ab) / (length * length)))
            proj = a + ab * t
            d = (v.co - proj).length
            if d < best_d:
                best_d = d
                best_s = (acc + t * length) / total
            acc += length
        x = best_s * n_bones
        weights = {}
        for k in range(n_bones):
            center = k + 0.5
            dist = abs(x - center)
            w = max(0.0, 1.0 - dist / 1.20)
            if w > 0.01:
                weights[k] = w
        ssum = sum(weights.values()) or 1.0
        for k, w in weights.items():
            obj.vertex_groups[bone_names[k]].add([v.index], w / ssum, "REPLACE")


def paint_downside_belly(obj, body_mat, belly_mat, z_thresh=-0.18, max_z=None, hide_front=False):
    if body_mat.name not in obj.data.materials:
        obj.data.materials.append(body_mat)
    if belly_mat.name not in obj.data.materials:
        obj.data.materials.append(belly_mat)
    body_i = list(obj.data.materials).index(body_mat)
    belly_i = list(obj.data.materials).index(belly_mat)
    for poly in obj.data.polygons:
        center = poly.center
        use = poly.normal.z < z_thresh
        if max_z is not None and center.z > max_z:
            use = False
        # keep the face and chin gold so the remesh edge isn't a jagged cream scallop
        if hide_front and center.y < -0.6 * CM and center.z > 1.45 * CM:
            use = False
        poly.material_index = belly_i if use else body_i


def join_and_remesh(name, objects, voxel, smooth_iter=10):
    obj = join_objects(name, objects)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new("Remesh", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = voxel
    bpy.ops.object.modifier_apply(modifier="Remesh")
    lap = obj.modifiers.new("Lap", "LAPLACIANSMOOTH")
    lap.iterations = 8
    if hasattr(lap, "lambda_factor"):
        lap.lambda_factor = 0.45
    bpy.ops.object.modifier_apply(modifier="Lap")
    sm = obj.modifiers.new("Smooth", "SMOOTH")
    sm.factor = 1.0
    sm.iterations = smooth_iter
    bpy.ops.object.modifier_apply(modifier="Smooth")
    shade_smooth(obj)
    print(f"remeshed {name}: {triangle_count(obj)} tris, voxel={voxel:.5f}")
    return obj


def paint_body_weights(obj):
    names = ["body", "mantle0", "mantle1", "mantle2", "head"]
    for name in names:
        if obj.vertex_groups.get(name) is None:
            obj.vertex_groups.new(name=name)
    # Approximate bone regions in world / object space (applied, origin at 0).
    body_c = Vector((0.0, 0.15, 1.45)) * CM
    head_c = Vector((0.0, -1.50, 2.50)) * CM
    m0_c = Vector((0.0, 0.20, 3.10)) * CM
    m1_c = Vector((0.0, 1.70, 3.35)) * CM
    m2_c = Vector((0.0, 3.40, 3.30)) * CM
    centers = {
        "body": body_c,
        "head": head_c,
        "mantle0": m0_c,
        "mantle1": m1_c,
        "mantle2": m2_c,
    }
    # Stretch so the mantle chain prefers the upper back and the head the front.
    scales = {
        "body": Vector((1.0, 1.0, 1.4)),
        "head": Vector((1.0, 0.85, 1.0)),
        "mantle0": Vector((1.0, 1.1, 1.0)),
        "mantle1": Vector((1.0, 1.0, 0.9)),
        "mantle2": Vector((1.0, 0.9, 1.0)),
    }
    for v in obj.data.vertices:
        weights = {}
        for name, c in centers.items():
            d = v.co - c
            s = scales[name]
            dist = Vector((d.x / s.x, d.y / s.y, d.z / s.z)).length
            w = max(0.0, 1.0 - dist / (2.8 * CM))
            if name == "head" and v.co.y > 0.4 * CM:
                w *= 0.15
            if name.startswith("mantle") and v.co.y < -1.8 * CM:
                w *= 0.2
            if name == "body" and v.co.z > 2.6 * CM:
                w *= 0.25
            if w > 0.02:
                weights[name] = w
        if not weights:
            weights["body"] = 1.0
        ssum = sum(weights.values())
        for name, w in weights.items():
            obj.vertex_groups[name].add([v.index], w / ssum, "REPLACE")


def snap_to_mesh(obj, guess):
    """Closest surface point and normal on an applied mesh."""
    ok, loc, normal, _idx = obj.closest_point_on_mesh(Vector(guess))
    if ok:
        n = Vector(normal)
        if n.length < 1e-9:
            n = (Vector(guess) - Vector((0.0, 0.4, 2.5)) * CM)
        n.normalize()
        return Vector(loc), n
    return Vector(guess), Vector((0.0, 0.0, 1.0))


def add_ring_decal(parts, tag, surface, normal, radius_cm, group, mats, lift=0.008, segments=14):
    """Photo-like ring: olive-brown core, electric blue band, thin navy edge."""
    r = radius_cm * CM
    edge = add_flat_ring(tag + "_edge", surface, normal, r * 0.82, r * 1.06, segments=segments, lift=lift)
    set_material(edge, mats["ringEdge"])
    assign_group(edge, group)
    parts.append(edge)
    band = add_flat_ring(tag, surface, normal, r * 0.56, r * 0.90, segments=segments, lift=lift + 0.002)
    set_material(band, mats["rings"])
    assign_group(band, group)
    parts.append(band)
    core = add_flat_disc(tag + "_core", surface, normal, r * 0.60, segments=segments, lift=lift + 0.004)
    set_material(core, mats["ringCore"])
    assign_group(core, group)
    parts.append(core)


def build_web(parts, mats, attach):
    """Subtle webbing between neighbouring arm bases around the crown."""
    inner_r = 0.28 * CM
    # two concentric rings of 8*3 verts for a soft scalloped web
    steps = N_ARMS * 3
    inner = []
    outer = []
    crown_z = 1.22 * CM
    for s in range(steps):
        ang = s * (2.0 * math.pi / steps)
        # scallop: higher and slightly more extended between arms
        phase = (s % 3) / 3.0
        scallop = math.sin(phase * math.pi)
        d = Vector((math.sin(ang), -math.cos(ang), 0.0))
        iz = crown_z + 0.10 * CM
        oz = crown_z + 0.02 * CM + 0.10 * CM * scallop
        inner.append(d * inner_r + Vector((0.0, 0.0, iz)))
        # outer sits on the arm bases (radius close to ARM_SPREAD)
        orad = (ARM_SPREAD + 0.35 + 0.28 * scallop) * CM
        outer.append(d * orad + Vector((0.0, 0.0, oz)))
    verts = inner + outer
    faces = []
    for s in range(steps):
        t = (s + 1) % steps
        faces.append((s, t, steps + t, steps + s))
    mesh = bpy.data.meshes.new("web")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new("web", mesh)
    bpy.context.collection.objects.link(obj)
    shade_smooth(obj)
    set_material(obj, mats["body"])
    assign_group(obj, "body")
    parts.append(obj)
    return obj


def build_meshes(mats):
    """Return (parts, bones). Face toward Blender -Y."""
    parts = []
    bones = []

    # --- one continuous swept-back teardrop, softly pointed at the rear ---
    # Head in front, mantle leaning back behind it into a rounded point.
    blobs = []
    head_c = Vector((0.0, -1.50, 2.50)) * CM
    blobs.append(add_uv_sphere("blob_head", 1.0, 14, 9, head_c,
                               scale=Vector((2.00, 1.80, 1.65)) * CM))
    # mid / neck, keeps the head and mantle one smooth volume
    blobs.append(add_uv_sphere("blob_mid", 1.0, 14, 9,
                               Vector((0.0, 0.25, 2.75)) * CM,
                               scale=Vector((2.15, 1.95, 2.00)) * CM))
    # fat mid-back of the mantle, slightly higher than the head
    mantle_c = Vector((0.0, 2.15, 3.30)) * CM
    blobs.append(add_uv_sphere("blob_mantle", 1.0, 16, 10, mantle_c,
                               scale=Vector((2.35, 2.70, 2.35)) * CM))
    # taper toward the tip
    blobs.append(add_uv_sphere("blob_taper", 1.0, 12, 8,
                               Vector((0.0, 3.70, 3.40)) * CM,
                               scale=Vector((1.70, 1.85, 1.70)) * CM))
    # softly pointed rounded tip, leaning back
    blobs.append(add_uv_sphere("blob_tip", 1.0, 10, 7,
                               Vector((0.0, 4.90, 3.30)) * CM,
                               scale=Vector((1.05, 1.35, 1.05)) * CM))
    # lower crown, so arms have a body to merge into
    blobs.append(add_uv_sphere("blob_crown", 1.0, 12, 8,
                               Vector((0.0, 0.05, 1.55)) * CM,
                               scale=Vector((1.85, 1.70, 1.15)) * CM))
    # raised eye bumps on the upper sides of the head (not the front)
    for side, tag in ((1, "L"), (-1, "R")):
        blobs.append(add_uv_sphere(
            f"blob_eye_{tag}", 1.0, 10, 7,
            Vector((side * 1.55, -1.52, 3.38)) * CM,
            scale=Vector((0.70, 0.58, 0.62)) * CM,
        ))
    for b in blobs:
        set_material(b, mats["body"])
    body = join_and_remesh("body_shell", blobs, voxel=0.26 * CM, smooth_iter=16)
    paint_body_weights(body)
    paint_downside_belly(body, mats["body"], mats["belly"], z_thresh=-0.40, max_z=1.85 * CM, hide_front=True)
    parts.append(body)

    # Beak under the front of the head, at the arm crown.
    beak_c = Vector((0.0, -0.30, 1.28)) * CM
    beak = add_uv_sphere("beak", 1.0, 8, 6, beak_c, scale=Vector((0.34, 0.30, 0.26)) * CM)
    set_material(beak, mats["beak"])
    assign_group(beak, "beak")
    parts.append(beak)

    # Eyes: big, cute, sitting high on the side bumps, with catchlights.
    eye_bones = {}
    eye_pts = []
    for side, name in ((1, "eye_L"), (-1, "eye_R")):
        guess = Vector((side * 1.62, -1.60, 3.42)) * CM
        surface, normal = snap_to_mesh(body, guess)
        # park the eye slightly proud of the bump, kept on the upper side
        tip = surface + normal * (0.26 * CM)
        eye_r = 0.62 * CM
        eye = add_uv_sphere(name, eye_r, 14, 10, tip)
        set_material(eye, mats["eye"])
        assign_group(eye, name)
        parts.append(eye)
        hl_dir = (normal + Vector((-side * 0.20, -0.25, 0.50))).normalized()
        hl = add_uv_sphere(name + "_hl", 0.19 * CM, 8, 6, tip + hl_dir * (eye_r * 0.72))
        set_material(hl, mats["highlight"])
        assign_group(hl, name)
        parts.append(hl)
        eye_bones[name] = (tip - normal * (0.15 * CM), tip)
        eye_pts.append(tip)

    # Rings: dense, even, photo-like (brown core, blue band, navy edge).
    # Directions cover the upper and side mantle, skipping the face and belly.
    mantle_rings = [
        ((0.00,  0.12, 0.98), 0.38),
        ((0.00,  0.50, 0.84), 0.36),
        ((0.00,  0.82, 0.52), 0.34),
        ((0.00,  0.96, 0.18), 0.30),
        ((0.38,  0.18, 0.90), 0.34),
        ((-0.38,  0.18, 0.90), 0.34),
        ((0.62,  0.08, 0.74), 0.36),
        ((-0.62,  0.08, 0.74), 0.36),
        ((0.82,  0.22, 0.48), 0.32),
        ((-0.82,  0.22, 0.48), 0.32),
        ((0.50,  0.55, 0.62), 0.33),
        ((-0.50,  0.55, 0.62), 0.33),
        ((0.72,  0.55, 0.28), 0.30),
        ((-0.72,  0.55, 0.28), 0.30),
        ((0.40,  0.82, 0.30), 0.28),
        ((-0.40,  0.82, 0.30), 0.28),
        ((0.55, -0.12, 0.78), 0.32),
        ((-0.55, -0.12, 0.78), 0.32),
        ((0.28,  0.35, 0.88), 0.26),
        ((-0.28,  0.35, 0.88), 0.26),
        ((0.88, -0.22, 0.42), 0.30),
        ((-0.88, -0.22, 0.42), 0.30),
        ((0.78, -0.28, 0.58), 0.28),
        ((-0.78, -0.28, 0.58), 0.28),
    ]
    origin = Vector((0.0, 1.80, 3.10)) * CM
    placed = []
    for i, (d, rad) in enumerate(mantle_rings):
        direction = Vector(d).normalized()
        guess = origin + Vector((direction.x * 2.5, direction.y * 3.4, direction.z * 2.5)) * CM
        surface, normal = snap_to_mesh(body, guess)
        if surface.y < -2.05 * CM and surface.z > 2.2 * CM:
            continue
        if normal.z < -0.30:
            continue
        if any((surface - e).length < 0.95 * CM for e in eye_pts):
            continue
        if any((surface - p).length < 0.72 * CM for p in placed):
            continue
        group = "head" if surface.y < -0.5 * CM else ("mantle2" if surface.y > 3.2 * CM else "mantle1")
        add_ring_decal(parts, f"mring_{i}", surface, normal, rad, group, mats, segments=14)
        placed.append(surface)

    # A few smaller rings on the sides of the head, behind the eyes.
    head_rings = [
        ((0.95,  0.15, 0.20), 0.24),
        ((0.70,  0.35, 0.45), 0.22),
        ((1.00, -0.15, 0.10), 0.22),
        ((0.90,  0.00, 0.40), 0.20),
        ((-0.95,  0.15, 0.20), 0.24),
        ((-0.70,  0.35, 0.45), 0.22),
        ((-1.00, -0.15, 0.10), 0.22),
        ((-0.90,  0.00, 0.40), 0.20),
    ]
    for i, (d, rad) in enumerate(head_rings):
        direction = Vector(d).normalized()
        guess = head_c + Vector((direction.x * 2.05, direction.y * 1.85, direction.z * 1.70)) * CM
        surface, normal = snap_to_mesh(body, guess)
        if any((surface - e).length < 0.90 * CM for e in eye_pts):
            continue
        add_ring_decal(parts, f"hring_{i}", surface, normal, rad, "head", mats, segments=14)
        placed.append(surface)

    # Tiny pale speckles in the gaps on the mantle (subtle, cute).
    speckles = [
        (0.18, 0.28, 0.94), ( -0.18, 0.62, 0.74),
        (0.30, 0.70, 0.50), ( -0.48, 0.30, 0.80),
        (0.58, 0.40, 0.40), ( -0.22, 0.88, 0.28),
        (0.10, 0.05, 0.98), ( -0.70, 0.10, 0.55),
    ]
    for i, d in enumerate(speckles):
        direction = Vector(d).normalized()
        guess = origin + Vector((direction.x * 2.5, direction.y * 3.4, direction.z * 2.5)) * CM
        surface, normal = snap_to_mesh(body, guess)
        if any((surface - p).length < 0.40 * CM for p in placed):
            continue
        if any((surface - e).length < 1.0 * CM for e in eye_pts):
            continue
        if normal.z < 0.05:
            continue
        sp = add_flat_disc(f"speckle_{i}", surface, normal, 0.07 * CM, segments=8, lift=0.007)
        set_material(sp, mats["belly"])
        assign_group(sp, "mantle1")
        parts.append(sp)
        placed.append(surface)

    # --- eight continuous arms ---
    attach = []
    for i in range(N_ARMS):
        d = arm_dir(i)
        joints = [world_joint(i, k) for k in range(ARM_SEGS + 1)]
        names = [arm_bone(i, k) for k in range(ARM_SEGS)]
        attach.append(joints[0])
        dense, dense_r = lerp_path(joints, [r * CM for r in ARM_RADII], ARM_LOOPS)
        # start the tube slightly inside the crown so it merges with the body
        dense[0] = dense[0] - d * (0.28 * CM) + Vector((0.0, 0.0, 0.04 * CM))
        tube = add_tapered_tube(f"arm{i}", dense, dense_r, circ=8)
        set_material(tube, mats["body"])
        skin_along_chain(tube, names, joints)
        paint_downside_belly(tube, mats["body"], mats["belly"], z_thresh=-0.12)
        parts.append(tube)

        # A line of rings along the top of the arm, shrinking toward the tip.
        n_arm_rings = 7
        for s_i in range(n_arm_rings):
            s = 0.14 + 0.74 * (s_i / (n_arm_rings - 1))
            idx = min(int(s * (len(dense) - 1)), len(dense) - 1)
            p = dense[idx]
            outward = Vector((d.x * 0.22, d.y * 0.22, 1.0)).normalized()
            surface = p + outward * (dense_r[idx] * 0.98)
            # radius tracks the local arm width so rings stay as full circles
            rad = 0.20 * (1.0 - 0.42 * s)
            k = min(int(s * ARM_SEGS), ARM_SEGS - 1)
            add_ring_decal(
                parts, f"aring_{i}_{s_i}", surface, outward, rad, names[k], mats,
                lift=0.014, segments=10,
            )

        # A row of small sucker bumps along the underside.
        for s_i, s in enumerate((0.22, 0.38, 0.52, 0.66, 0.80)):
            idx = min(int(s * (len(dense) - 1)), len(dense) - 1)
            p = dense[idx]
            suc_r = (0.12 - 0.05 * s) * CM
            suc = add_uv_sphere(
                f"arm{i}_s{s_i}", suc_r, 5, 3,
                p + Vector((0.0, 0.0, -dense_r[idx] * 0.88)),
            )
            set_material(suc, mats["sucker"])
            assign_group(suc, names[min(int(s * ARM_SEGS), ARM_SEGS - 1)])
            parts.append(suc)

        for k in range(ARM_SEGS):
            parent = "body" if k == 0 else names[k - 1]
            bones.append((names[k], parent, joints[k], joints[k + 1]))

    build_web(parts, mats, attach)

    build_web(parts, mats, attach)

    # Armature bones for the body
    root_tail = Vector((0.0, 0.0, 0.4)) * CM
    body_head = Vector((0.0, 0.0, 0.5)) * CM
    body_tail = Vector((0.0, 0.0, 1.5)) * CM
    m0 = Vector((0.0, -0.3, 3.05)) * CM
    m1 = Vector((0.0,  1.30, 3.30)) * CM
    m2 = Vector((0.0,  2.90, 3.40)) * CM
    m3 = Vector((0.0,  4.70, 3.25)) * CM
    h0 = head_c + Vector((0, 0.4, -0.2)) * CM
    h1 = head_c + Vector((0, -0.8, 0.2)) * CM
    bk0 = beak_c + Vector((0, 0.15, 0.05)) * CM
    bk1 = beak_c + Vector((0, -0.25, -0.05)) * CM

    core = [
        ("root", None, Vector((0.0, 0.0, 0.0)), root_tail),
        ("body", "root", body_head, body_tail),
        ("mantle0", "body", m0, m1),
        ("mantle1", "mantle0", m1, m2),
        ("mantle2", "mantle1", m2, m3),
        ("head", "body", h0, h1),
        ("eye_L", "head", eye_bones["eye_L"][0], eye_bones["eye_L"][1]),
        ("eye_R", "head", eye_bones["eye_R"][0], eye_bones["eye_R"][1]),
        ("beak", "head", bk0, bk1),
    ]
    bones = core + bones
    return parts, bones



def key_loc(pb, frame, loc, interpolation="BEZIER"):
    pb.location = Vector(loc)
    pb.keyframe_insert(data_path="location", frame=frame)
    if pb.id_data.animation_data and pb.id_data.animation_data.action:
        ad = pb.id_data.animation_data.action
        data_path = f'pose.bones["{pb.name}"].location'
        for fc in ad.fcurves:
            if fc.data_path == data_path:
                for kp in fc.keyframe_points:
                    if int(kp.co.x) == frame:
                        kp.interpolation = interpolation


def key_scale(pb, frame, scale, interpolation="BEZIER"):
    pb.scale = Vector(scale)
    pb.keyframe_insert(data_path="scale", frame=frame)
    if pb.id_data.animation_data and pb.id_data.animation_data.action:
        ad = pb.id_data.animation_data.action
        data_path = f'pose.bones["{pb.name}"].scale'
        for fc in ad.fcurves:
            if fc.data_path == data_path:
                for kp in fc.keyframe_points:
                    if int(kp.co.x) == frame:
                        kp.interpolation = interpolation


def zero_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0.0, 0.0, 0.0)
        pb.location = (0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)


def key_zero(arm, frame, extra=()):
    """Keyframe a rest euler on a default bone set (mantle, head, beak, all arms)."""
    names = ["body", "mantle0", "mantle1", "mantle2", "head", "beak", "eye_L", "eye_R"]
    for i in range(N_ARMS):
        for k in range(ARM_SEGS):
            names.append(arm_bone(i, k))
    names.extend(extra)
    for name in names:
        pb = arm.pose.bones.get(name)
        if not pb:
            continue
        key_euler(pb, frame, (0, 0, 0))
        key_scale(pb, frame, (1, 1, 1))
        key_loc(pb, frame, (0, 0, 0))


def arm_curl(amount, lift=0.0, swing=0.0, flare=0.0):
    """Per-segment eulers (rx, ry, rz) for a soft curl / lift / swing / flare.

    In rest, each arm bone points along the arm (outward and slightly down).
    rx lifts the arm, rz curls inward, ry rolls / swings.
    """
    poses = []
    for k in range(ARM_SEGS):
        t = k / (ARM_SEGS - 1)
        rx = math.radians(lift * (0.5 + 0.8 * t) + amount * 8 * t)
        ry = math.radians(swing * (1.0 - 0.4 * t))
        rz = math.radians(flare * (0.4 + 0.6 * t) + amount * 14 * t)
        poses.append((rx, ry, rz))
    return poses


def key_arm(arm, i, frame, poses):
    for k, eul in enumerate(poses):
        pb = arm.pose.bones[arm_bone(i, k)]
        key_euler(pb, frame, eul)


def animate_idle(arm):
    action = ensure_action(arm, "idle", IDLE_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    # Gentle breathing: mantle scale pulse, tip curls.
    for fr, pulse, curl in (
        (0, 1.00, 0.15),
        (18, 1.05, 0.35),
        (36, 0.97, 0.10),
        (54, 1.04, 0.40),
        (72, 1.00, 0.15),
    ):
        key_scale(arm.pose.bones["mantle1"], fr, (1.0, 1.0, pulse))
        key_scale(arm.pose.bones["mantle2"], fr, (1.0, 1.0, 0.5 + 0.5 * pulse))
        key_euler(arm.pose.bones["head"], fr, (math.radians(2 * (pulse - 1) * 8), 0, 0))
        for i in range(N_ARMS):
            phase = 0.12 * math.sin((fr / IDLE_FRAMES) * 2 * math.pi + i * 0.7)
            key_arm(arm, i, fr, arm_curl(curl + phase, lift=2, flare=2))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "idle")
    return action


def animate_walk(arm):
    action = ensure_action(arm, "walk", WALK_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    # A travelling wave around the arms, body slightly bobbing.
    for fr in (0, 6, 12, 18, 24):
        u = fr / WALK_FRAMES
        bob = math.sin(u * 2 * math.pi)
        key_euler(arm.pose.bones["body"], fr, (math.radians(-4), 0, math.radians(3 * bob)))
        key_scale(arm.pose.bones["mantle1"], fr, (1.0, 1.0, 1.0 + 0.06 * bob))
        key_euler(arm.pose.bones["head"], fr, (math.radians(-2 + 3 * bob), 0, 0))
        for i in range(N_ARMS):
            phase = u * 2 * math.pi + i * (2 * math.pi / N_ARMS)
            wave = math.sin(phase)
            # lift when wave > 0, plant and pull when wave < 0
            lift = 12 * max(0.0, wave)
            curl = 0.20 + 0.35 * max(0.0, -wave)
            swing = 16 * math.cos(phase)  # reach / retract along the circle
            key_arm(arm, i, fr, arm_curl(curl, lift=lift, swing=swing, flare=4))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "walk")
    return action



def _zero_arm_quat(arm, i):
    for k in range(ARM_SEGS):
        pb = arm.pose.bones[arm_bone(i, k)]
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))


def swim_targets(arm, i, flare):
    """World-space polyline for a trailing swim arm.

    Travel is +Z after export (Blender -Y is forward, +Y is behind).
    Arms stream back and slightly down; the front arm tucks under, never
    crossing the face. `flare` 1 = spread, 0 = swept together.
    """
    _zero_arm_quat(arm, i)
    bpy.context.view_layer.update()
    pb = arm.pose.bones[arm_bone(i, 0)]
    start = arm.matrix_world @ pb.head
    d = arm_dir(i)
    length = 7.2 * CM
    pts = [Vector(start)]
    for k in range(1, ARM_SEGS + 1):
        s = k / ARM_SEGS
        if d.y < -0.70:
            # Front arm: drop immediately and trail under the body, slightly aside.
            lat = Vector((0.50 * CM, 0.0, 0.0)) * (0.35 + 0.75 * flare) * math.sin(s * math.pi)
            back = Vector((0.0, 1.0, 0.0)) * (s * length)
            down = Vector((0.0, 0.0, -1.0)) * ((0.85 * s + 0.20) * CM)
        elif d.y > 0.70:
            # Rear arms already point back; stream them and spread with flare.
            lat = Vector((d.x, 0.0, 0.0)) * ((1.0 + 2.4 * flare) * s * CM)
            back = Vector((0.0, 1.0, 0.0)) * (s * length * 0.90)
            down = Vector((0.0, 0.0, -0.25 * s * CM))
        else:
            # Side arms: trail +Y, flare out on X, stay below the mantle.
            lat = Vector((d.x, 0.0, 0.0)) * ((1.2 + 3.0 * flare) * (0.35 + 0.65 * s) * CM)
            back = Vector((0.0, 1.0, 0.0)) * (s * length)
            down = Vector((0.0, 0.0, -0.50 * s * CM))
        pts.append(start + lat + back + down)
    return pts


def pose_arm_to_points(arm, i, targets):
    """Aim each arm bone's +Y at the next target, after parents are posed."""
    for k in range(ARM_SEGS):
        pb = arm.pose.bones[arm_bone(i, k)]
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))
        bpy.context.view_layer.update()
        desired = (Vector(targets[k + 1]) - Vector(targets[k]))
        if desired.length < 1e-12:
            continue
        desired.normalize()
        dir_arm = (arm.matrix_world.inverted().to_3x3() @ desired).normalized()
        cur = pb.y_axis.normalized()
        q = cur.rotation_difference(dir_arm)
        pb.rotation_quaternion = q @ pb.rotation_quaternion
        bpy.context.view_layer.update()


def key_arm_quat(arm, i, frame):
    """Key the posed aim as XYZ eulers so every clip shares one rotation mode."""
    for k in range(ARM_SEGS):
        pb = arm.pose.bones[arm_bone(i, k)]
        pb.rotation_mode = "XYZ"
        key_euler(pb, frame, tuple(pb.rotation_euler))


def animate_swim(arm):
    action = ensure_action(arm, "swim", SWIM_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    # Pulse: flare out, then sweep the arms back together behind the body.
    # Body is pitched nose-down so travel reads +Z (Blender -Y) and horizontal.
    keys = (
        (0,  0.85, 24, 0.45, 1.55),
        (7,  1.00, 26, 0.95, 1.70),
        (14, 0.38, 23, 0.30, 1.45),
        (21, 0.10, 22, 0.20, 1.35),
        (28, 0.85, 24, 0.45, 1.55),
    )
    for fr, flare, pitch, jet, lift_cm in keys:
        key_scale(arm.pose.bones["mantle1"], fr, (1.0 + 0.08 * (1 - jet), 1.0, 0.90 + 0.18 * jet))
        key_scale(arm.pose.bones["mantle2"], fr, (1.0, 1.0, 0.86 + 0.22 * jet))
        key_euler(arm.pose.bones["body"], fr, (math.radians(pitch), 0, 0))
        key_loc(arm.pose.bones["body"], fr, (0.0, 0.0, lift_cm * CM))
        # Chin slightly tucked so the eyes stay high on the sides, not wheeled at the front.
        key_euler(arm.pose.bones["head"], fr, (math.radians(-10 + 3 * jet), 0, 0))
        bpy.context.view_layer.update()
        for i in range(N_ARMS):
            targets = swim_targets(arm, i, flare)
            pose_arm_to_points(arm, i, targets)
            key_arm_quat(arm, i, fr)
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "swim")
    return action


def animate_swim_idle(arm):
    action = ensure_action(arm, "swimIdle", SWIM_IDLE_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    for fr, pulse, drift in (
        (0, 1.00, 0.0),
        (18, 1.04, 0.4),
        (36, 0.98, 0.1),
        (54, 1.05, 0.5),
        (72, 1.00, 0.0),
    ):
        key_scale(arm.pose.bones["mantle1"], fr, (1.0, 1.0, pulse))
        key_euler(arm.pose.bones["body"], fr, (math.radians(18), 0, 0))
        key_loc(arm.pose.bones["body"], fr, (0.0, 0.0, 1.2 * CM))
        for i in range(N_ARMS):
            phase = drift * math.sin(i * 0.9 + fr * 0.08)
            # spread in a soft 3D star, slightly lifted off a flat plane
            lift = 6 + 3 * phase
            if i == 0:
                lift = -8 + 2 * phase  # front arm stays down, never over the face
            key_arm(arm, i, fr, arm_curl(0.20 + 0.15 * phase, lift=lift, flare=6))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "swimIdle")
    return action


def animate_bite(arm):
    action = ensure_action(arm, "bite", BITE_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    # 0 rest, 3 lunge, 6 recover, 10 rest
    keys = {
        0: "rest",
        3: "lunge",
        6: "recover",
        10: "rest",
    }
    for fr, pose in keys.items():
        if pose == "rest":
            key_zero(arm, fr)
            continue
        lunge = 1.0 if pose == "lunge" else 0.35
        key_euler(arm.pose.bones["body"], fr, (math.radians(-12 * lunge), 0, 0))
        key_euler(arm.pose.bones["head"], fr, (math.radians(-8 * lunge), 0, 0))
        key_euler(arm.pose.bones["beak"], fr, (math.radians(-25 * lunge), 0, 0))
        key_loc(arm.pose.bones["body"], fr, (0, -0.35 * CM * lunge, 0))
        for i in range(N_ARMS):
            # front arms flare more
            front = math.cos(i * (2 * math.pi / N_ARMS))  # 1 at arm0
            key_arm(arm, i, fr, arm_curl(0.1, lift=8 + 22 * lunge * (0.5 + 0.5 * max(0, front)), flare=16 * lunge))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "bite")
    return action


def animate_venom(arm):
    action = ensure_action(arm, "venomBite", VENOM_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    # hold the lunge so the game can flash the rings
    keys = {0: 0.0, 3: 1.0, 10: 1.0, 14: 0.3, 18: 0.0}
    for fr, lunge in keys.items():
        if lunge == 0.0:
            key_zero(arm, fr)
            continue
        key_euler(arm.pose.bones["body"], fr, (math.radians(-14 * lunge), 0, 0))
        key_euler(arm.pose.bones["head"], fr, (math.radians(-10 * lunge), 0, 0))
        key_euler(arm.pose.bones["beak"], fr, (math.radians(-30 * lunge), 0, 0))
        key_loc(arm.pose.bones["body"], fr, (0, -0.4 * CM * lunge, 0))
        key_scale(arm.pose.bones["mantle1"], fr, (1.08, 1.0, 1.10))
        for i in range(N_ARMS):
            front = math.cos(i * (2 * math.pi / N_ARMS))
            key_arm(arm, i, fr, arm_curl(0.15, lift=10 + 24 * lunge * (0.5 + 0.5 * max(0, front)), flare=18 * lunge))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "venomBite")
    return action


def animate_ink(arm):
    action = ensure_action(arm, "ink", INK_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    for fr, squeeze, jet in ((0, 0.0, 0.0), (4, 1.0, 0.4), (7, 0.7, 1.0), (12, 0.0, 0.0)):
        if squeeze == 0.0 and jet == 0.0:
            key_zero(arm, fr)
            continue
        key_scale(arm.pose.bones["mantle1"], fr, (1.15 - 0.25 * squeeze, 1.0, 0.75 + 0.1 * jet))
        key_scale(arm.pose.bones["mantle2"], fr, (1.1, 1.0, 0.7 + 0.15 * squeeze))
        key_euler(arm.pose.bones["body"], fr, (math.radians(8 * jet), 0, 0))
        key_loc(arm.pose.bones["body"], fr, (0, 0.3 * CM * jet, 0))
        for i in range(N_ARMS):
            key_arm(arm, i, fr, arm_curl(0.25 + 0.3 * squeeze, lift=6, flare=-8 * jet))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "ink")
    return action


def animate_scoop(arm):
    action = ensure_action(arm, "scoop", SCOOP_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    # arm0 reaches forward/out ~1.5 body lengths, curls, pulls back under the body.
    # Other arms stay in a calm idle curl.
    idle = arm_curl(0.18, lift=2, flare=2)
    # reach: straighten and extend forward (negative flare, some lift)
    reach = []
    for k in range(ARM_SEGS):
        tt = k / (ARM_SEGS - 1)
        # lift at the shoulder and uncurl so the arm stretches forward
        reach.append((math.radians(22 - 10 * tt), 0.0, math.radians(-8 * tt)))
    curl_pose = arm_curl(0.95, lift=16, flare=10)
    retract = arm_curl(0.55, lift=2, flare=16)
    for fr, pose in ((0, "rest"), (4, "reach"), (7, "curl"), (10, "retract"), (12, "rest")):
        for i in range(1, N_ARMS):
            key_arm(arm, i, fr, idle)
        key_euler(arm.pose.bones["head"], fr, (math.radians(-4 if pose != "rest" else 0), 0, 0))
        if pose == "rest":
            key_arm(arm, 0, fr, idle)
        elif pose == "reach":
            key_arm(arm, 0, fr, reach)
        elif pose == "curl":
            key_arm(arm, 0, fr, curl_pose)
        else:
            key_arm(arm, 0, fr, retract)
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "scoop")
    return action


def animate_threat(arm):
    action = ensure_action(arm, "threat", THREAT_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    for fr, puff in ((0, 0.0), (6, 1.0), (18, 1.0), (24, 0.0)):
        if puff == 0.0:
            key_zero(arm, fr)
            continue
        key_scale(arm.pose.bones["mantle1"], fr, (1.12, 1.0, 1.16))
        key_scale(arm.pose.bones["mantle2"], fr, (1.08, 1.0, 1.10))
        key_euler(arm.pose.bones["head"], fr, (math.radians(-6), 0, 0))
        for i in range(N_ARMS):
            key_arm(arm, i, fr, arm_curl(0.12, lift=22 * puff, flare=10 * puff))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "threat")
    return action


def animate_celebrate(arm):
    action = ensure_action(arm, "celebrate", CELEB_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    # A little bounce and a happy twirl of the body.
    for fr, yaw, hop, flare in (
        (0, 0, 0.0, 0.0),
        (5, 90, 1.0, 1.0),
        (10, 180, 0.2, 0.7),
        (15, 270, 1.0, 1.0),
        (20, 360, 0.0, 0.0),
    ):
        if hop == 0.0 and yaw == 0:
            key_zero(arm, fr)
            continue
        if yaw == 360 and hop == 0.0:
            key_zero(arm, fr)
            continue
        key_euler(arm.pose.bones["body"], fr, (math.radians(-6 * hop), math.radians(yaw), 0))
        key_loc(arm.pose.bones["body"], fr, (0, 0, 0.8 * CM * hop))
        key_scale(arm.pose.bones["mantle1"], fr, (1.0, 1.0, 1.0 + 0.08 * hop))
        for i in range(N_ARMS):
            key_arm(arm, i, fr, arm_curl(0.15, lift=8 + 16 * flare, flare=8 * flare))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "celebrate")
    return action


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------
def render_preview(arm):
    scene = bpy.context.scene
    vs = scene.view_settings
    for name in ("Standard", "Khronos PBR Neutral", "AgX"):
        try:
            vs.view_transform = name
            break
        except Exception:
            continue
    try:
        vs.look = "None"
    except Exception:
        pass
    vs.exposure = 0.22
    vs.gamma = 1.0

    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True

    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "MATERIAL"
    shading.show_shadows = False
    shading.show_cavity = False
    shading.use_world_space_lighting = True
    if hasattr(shading, "studio_light"):
        for cand in ("outdoor.sl", "plain.sl", "studio.sl", "Default"):
            try:
                shading.studio_light = cand
                print("studio_light:", cand)
                break
            except Exception:
                pass
    print("preview engine:", scene.render.engine, "view_transform:", vs.view_transform)

    world = bpy.data.worlds.new("OctoPreviewWorld") if "OctoPreviewWorld" not in bpy.data.worlds else bpy.data.worlds["OctoPreviewWorld"]
    world.use_nodes = False
    world.color = (0.95, 0.92, 0.86)
    scene.world = world
    if hasattr(shading, "background_type"):
        shading.background_type = "WORLD"

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 50
    cam_data.clip_start = 0.001
    cam_data.clip_end = 20
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam

    def add_light(name, typ, loc, energy, color=(1, 1, 1)):
        data = bpy.data.lights.new(name, typ)
        data.energy = energy
        data.color = color
        obj = bpy.data.objects.new(name, data)
        obj.location = Vector(loc) * CM
        bpy.context.collection.objects.link(obj)
        return obj

    add_light("Key", "SUN", (8, -12, 16), 2.0, (1.0, 0.97, 0.92))
    add_light("Fill", "AREA", (-8, -5, 8), 40.0, (0.85, 0.9, 1.0))

    def _composite_cream(src, dst):
        script = (
            "from PIL import Image; "
            "im = Image.open(%r).convert('RGBA'); "
            "bg = Image.new('RGBA', im.size, (245, 236, 220, 255)); "
            "Image.alpha_composite(bg, im).convert('RGB').save(%r, 'PNG')"
        ) % (str(src), str(dst))
        subprocess.check_call(["/usr/bin/python3", "-c", script])

    def _aim(loc, look):
        cam.location = Vector(loc) * CM
        direction = Vector(look) * CM - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    def _shot(path, loc, look, action_name="idle", frame=0):
        _aim(loc, look)
        if arm.animation_data:
            arm.animation_data.use_nla = False
            arm.animation_data.action = bpy.data.actions.get(action_name)
        scene.frame_set(frame)
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        _composite_cream(path, path)
        print("preview:", path)

    # Front 3/4 slightly from above, so the spread arms and face read clearly.
    view_34 = ((10.0, -14.5, 8.6), (0.0, 0.2, 2.6))
    view_side = ((18.5, 1.4, 5.6), (0.0, 0.8, 2.5))
    PREVIEW_REPO.parent.mkdir(parents=True, exist_ok=True)
    _shot(PREVIEW_REPO, *view_34, "idle", 8)
    shutil.copy2(PREVIEW_REPO, PREVIEW_WORKSPACE)
    _shot(PREVIEW_SIDE, *view_side, "idle", 8)
    shutil.copy2(PREVIEW_SIDE, PREVIEW_REPO_SIDE)
    _shot(PREVIEW_WALK, *view_34, "walk", 8)
    shutil.copy2(PREVIEW_WALK, PREVIEW_REPO_WALK)
    _shot(PREVIEW_SWIM, *view_34, "swim", 10)
    shutil.copy2(PREVIEW_SWIM, PREVIEW_REPO_SWIM)
    # QA frames
    _shot(Path("/tmp/octo-top.png"), (0.4, -0.6, 22.0), (0.0, 0.0, 0.0), "idle", 8)
    _shot(Path("/tmp/octo-swim-side.png"), *view_side, "swim", 10)
    _shot(Path("/tmp/octo-swim-front.png"), (0.0, -16.0, 4.0), (0.0, 0.5, 2.4), "swim", 10)
    _shot(Path("/tmp/octo-swim-flare.png"), *view_34, "swim", 7)
    _shot(Path("/tmp/octo-swim-tuck.png"), *view_34, "swim", 21)
    _shot(Path("/tmp/octo-bite.png"), *view_34, "bite", 3)
    _shot(Path("/tmp/octo-scoop.png"), *view_34, "scoop", 5)
    _shot(Path("/tmp/octo-threat.png"), *view_34, "threat", 10)

    if arm.animation_data:
        arm.animation_data.action = None
        arm.animation_data.use_nla = True
    for name in ("PreviewCam", "Key", "Fill"):
        obj = bpy.data.objects.get(name)
        if obj:
            bpy.data.objects.remove(obj, do_unlink=True)


def inspect_glb(path, expected_span):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise SystemExit(f"not a GLB: magic={magic!r}")
    chunk_len, chunk_type = struct.unpack_from("<I4s", data, 12)
    gltf = json.loads(data[20:20 + chunk_len])
    meshes = gltf.get("meshes", [])
    tris = 0
    for mesh in meshes:
        for prim in mesh.get("primitives", []):
            acc = gltf["accessors"][prim["indices"]]
            tris += acc["count"] // 3
    anims = [a["name"] for a in gltf.get("animations", [])]
    skins = gltf.get("skins", [])
    joints = (skins[0].get("joints") if skins else None)
    joint_names = []
    if joints:
        nodes = gltf.get("nodes", [])
        joint_names = [nodes[j].get("name") for j in joints]
    report = {
        "bytes": path.stat().st_size,
        "triangles": tris,
        "animations": anims,
        "skins": len(skins),
        "joints": len(joint_names) if joint_names else 0,
        "bones": joint_names,
        "materials": [m["name"] for m in gltf.get("materials", [])],
        "expected_span": expected_span,
    }
    print("GLB inspect:", json.dumps(report, indent=2))
    if tris == 0 or tris > 16000:
        raise SystemExit(f"triangle count {tris} out of range (1–16000)")
    if path.stat().st_size > int(1.5 * 1024 * 1024):
        print("WARNING: glb is over 1.5 MB")
    want = {"idle", "walk", "swim", "swimIdle", "bite", "venomBite", "ink", "scoop", "threat", "celebrate"}
    have = set(anims)
    missing = sorted(want - have)
    if missing:
        lower = {a.lower() for a in anims}
        if not (want <= {a for a in have} or want <= lower):
            raise SystemExit(f"missing animations {missing}; have {anims}")
    print("clips ok:", anims)
    print("bone count:", len(joint_names))
    return report


def main():
    clear_scene()
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = max(
        IDLE_FRAMES, WALK_FRAMES, SWIM_FRAMES, SWIM_IDLE_FRAMES,
        BITE_FRAMES, VENOM_FRAMES, INK_FRAMES, SCOOP_FRAMES,
        THREAT_FRAMES, CELEB_FRAMES,
    )
    scene.render.fps = FPS

    mats = {
        "body": set_coat(make_mat("body", BODY, roughness=0.42, metallic=0.0), 0.18, 0.28),
        "belly": make_mat("belly", BELLY, roughness=0.70, metallic=0.0),
        "rings": set_coat(make_mat("rings", RING, roughness=0.16, metallic=0.15, emission=0.35), 0.40, 0.16),
        "ringEdge": make_mat("ringEdge", RING_EDGE, roughness=0.45, metallic=0.0),
        "ringCore": make_mat("ringCore", RING_CORE, roughness=0.55, metallic=0.0),
        "eye": make_mat("eye", EYE, roughness=0.16, metallic=0.0),
        "highlight": make_mat("highlight", HIGHLIGHT, roughness=0.22, metallic=0.0, emission=0.35),
        "beak": make_mat("beak", BEAK, roughness=0.55, metallic=0.0),
        "sucker": make_mat("sucker", SUCKER, roughness=0.65, metallic=0.0),
    }
    parts, bones = build_meshes(mats)
    mesh = join_objects("Octopus", parts)
    tris = triangle_count(mesh)
    print(f"joined mesh triangles: {tris}")
    if tris > 16000:
        raise SystemExit(f"too many triangles: {tris}")
    arm = build_armature(bones)
    bind(mesh, arm)
    animate_idle(arm)
    animate_walk(arm)
    animate_swim(arm)
    animate_swim_idle(arm)
    animate_bite(arm)
    animate_venom(arm)
    animate_ink(arm)
    animate_scoop(arm)
    animate_threat(arm)
    animate_celebrate(arm)
    render_preview(arm)
    export_glb()
    inspect_glb(GLB_PATH, EXPORT_SPAN)
    print("done")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
